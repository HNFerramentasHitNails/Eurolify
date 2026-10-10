import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  classificarArtigo,
  criarArtigo,
  mudarEstadoArtigo,
} from "../src/catalogo/repositorio.js";
import { publicar } from "../src/catalogo/publicacao.js";
import {
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  definirPreco,
  mudarEstadoMercado,
} from "../src/precos/repositorio.js";
import { TIPOS_TEXTO_LEGAL } from "../src/base/esquema.js";
import { correrTarefas } from "../src/pagamentos/repositorio.js";
import { assinar, avisoEuPago, eupagoFalso, json } from "./eupago-falso.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Os pagamentos pela API (docs/26; migração 0042): a conta EuPago de teste,
// a régua, o pagamento pelo token do checkout, os avisos assinados, o
// incerto e a fila de diferenças, as tarefas e a encomenda paga ou
// cancelada. A EuPago é falsa (test/eupago-falso.ts): o adaptador é o
// verdadeiro e a rede é trocada.

type Json = Record<string, unknown>;
const QUEM = "pessoa:teste";

describe.skipIf(URL_BASE === undefined)("API dos pagamentos", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  // Os métodos de pagamento vêm da régua (docs/26): uma conta EuPago de teste.
  const eupago = eupagoFalso();

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    // Um limite alto: os testes fazem muitos pedidos do mesmo IP.
    app = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      undefined,
      undefined,
      { pedidos: 100_000, janelaMs: 60_000 },
      eupago.config,
    );
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  const pedir = (
    metodo: "POST" | "PUT" | "GET" | "PATCH" | "DELETE",
    url: string,
    corpo?: unknown,
    cabecalhos: Record<string, string> = {},
  ) =>
    app.inject({
      method: metodo,
      url,
      headers: {
        ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
        ...cabecalhos,
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });
  type Resposta = Awaited<ReturnType<typeof pedir>>;
  /**
   * O botão final. Sem `impressao`, leva a do resumo pedido agora (o que o
   * cliente vê); com ela, a que se der (uma impressão velha, para o R3).
   */
  const botao = async (token: string, corpo: Json): Promise<Resposta> => {
    if (!("impressao" in corpo)) {
      const r = await pedir("GET", `/checkout/${token}/summary`);
      const impressao =
        r.statusCode === 200 ? r.json<Json>()["impressao"] : "0".repeat(64);
      return pedir("POST", `/checkout/${token}/place`, { ...corpo, impressao });
    }
    return pedir("POST", `/checkout/${token}/place`, corpo);
  };
  const ok = async (r: PromiseLike<Resposta>, estado = 200): Promise<Json> => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(estado);
    return x.statusCode === 204 ? {} : x.json();
  };
  const codigo = async (r: PromiseLike<Resposta>) => {
    const x = await r;
    return [
      x.statusCode,
      (x.json<Json>()["codigo"] as string | undefined) ?? null,
    ];
  };

  /**
   * Um comerciante português com a loja, o mercado Portugal (preço com IVA),
   * o canal, um artigo físico com duas variantes publicadas (12,30 € e
   * 6,15 €), os textos legais publicados para PT/pt/consumidor e um método
   * de entrega de 4,99 €, grátis a partir de 50,00 €.
   */
  async function cenario() {
    const c = await registarComerciante(base.api, {
      nome: "Loja",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const entidade = await criarEntidadeLegal(base.api, c, {
      denominacao: "Exemplo, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "509999990",
      morada_linha: "Rua 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
    const loja = await criarLoja(base.api, c, {
      entidade_legal_id: entidade,
      nome: "Loja online",
    });
    const mercado = await criarMercado(base.api, c, {
      loja_id: loja,
      nome: "Portugal",
      paises: ["PT"],
      moeda: "EUR",
      linguas: ["pt"],
      lingua_principal: "pt",
    });
    const lista = await criarLista(base.api, c, {
      mercado_id: mercado,
      nome: "Base PT",
      tipo: "base",
    });
    await mudarEstadoMercado(base.api, c, mercado, 1, "activo");
    const canal = await criarCanal(base.api, c, {
      loja_id: loja,
      nome: "Loja online",
    });
    await definirMercadosDoCanal(base.api, c, canal, [mercado]);
    const artigo = await criarArtigo(
      base.api,
      c,
      { tipo: "fisico", nome: "Gel UV", categoria_fiscal: "normal" },
      [
        { sku: "GEL-001", unidade_de_venda: "unidade", peso_g: 30 },
        { sku: "GEL-002", unidade_de_venda: "unidade", peso_g: 30 },
      ],
    );
    const [v1, v2] = (
      await comComerciante(base.api, c, (trx) =>
        trx
          .selectFrom("variante")
          .select("id")
          .where("artigo_id", "=", artigo)
          .orderBy("sku")
          .execute(),
      )
    ).map((v) => v.id);
    if (v1 === undefined || v2 === undefined)
      throw new Error("faltam variantes");
    await classificarArtigo(
      base.api,
      c,
      artigo,
      1,
      { familias: ["retalho_geral"], natureza_consumidor: "bem" },
      QUEM,
    );
    await mudarEstadoArtigo(base.api, c, artigo, 2, "activo");
    await definirPreco(base.api, c, QUEM, lista, v1, { montante: 1230 });
    await definirPreco(base.api, c, QUEM, lista, v2, {
      montante: 615,
      quantidade_minima: 2,
    });
    const r = await publicar(base.api, c, QUEM, {
      artigo_id: artigo,
      canal_id: canal,
      mercado_id: mercado,
    });
    expect(r.publicada).toBe(true);
    const publica = (
      await criarChave(base.dono, c, {
        tipo: "publica",
        lojaId: loja,
        criadaPor: "operador:teste",
        nome: "Loja",
        ambitos: ["storefront"],
      })
    ).segredo;
    const servidor = (
      await criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Dono",
        ambitos: [
          "legal:read",
          "legal:write",
          "shipping:read",
          "shipping:write",
          "orders:read",
          "payments:read",
          "payments:write",
          "payments:accounts",
        ],
      })
    ).segredo;
    const adm = (
      m: "POST" | "GET" | "PATCH" | "PUT",
      url: string,
      corpo?: unknown,
    ) => pedir(m, url, corpo, { authorization: `Bearer ${servidor}` });
    const versoes: string[] = [];
    for (const tipo of TIPOS_TEXTO_LEGAL) {
      const t = await ok(
        adm("POST", "/legal-texts", {
          loja: `sto_${loja}`,
          tipo,
          pais: "PT",
          lingua: "pt",
          tipo_cliente: "consumidor",
        }),
        201,
      );
      const v = await ok(
        adm("POST", `/legal-texts/${String(t["id"])}/versions`, {
          texto: `Texto de ${tipo}.`,
        }),
        201,
      );
      await ok(
        adm(
          "POST",
          `/legal-texts/${String(t["id"])}/versions/${String(v["id"])}/publish`,
        ),
      );
      versoes.push(String(v["id"]));
    }
    const metodo = await ok(
      adm("POST", "/shipping-methods", {
        mercado: `mkt_${mercado}`,
        nome: { pt: "Correio" },
        tarifa: 499,
        gratis_a_partir_de: 5000,
      }),
      201,
    );
    // A régua dos pagamentos (docs/26 §3.2): MB WAY e Multibanco numa conta
    // EuPago pronta.
    const conta = await ok(
      adm("POST", "/payment-accounts", {
        prestador: "eupago",
        nome: "Produtos",
      }),
      201,
    );
    await ok(
      adm("PUT", `/payment-accounts/${String(conta["id"])}/credentials`, {
        chave: "xxxx-xxxx-xxxx-xxxx",
        segredo_aviso: "segredo-dos-avisos-123",
      }),
      204,
    );
    await ok(adm("POST", `/payment-accounts/${String(conta["id"])}/test`));
    for (const metodo of ["mb_way", "multibanco"]) {
      await ok(
        adm("POST", "/payment-methods", {
          mercado: `mkt_${mercado}`,
          metodo,
          conta: conta["id"],
        }),
        201,
      );
    }
    return {
      conta: String(conta["id"]),
      c,
      loja,
      mercado,
      lista,
      canal,
      artigo,
      v1,
      v2,
      publica,
      servidor,
      adm,
      versoes,
      metodo: String(metodo["id"]),
    };
  }

  type Cenario = Awaited<ReturnType<typeof cenario>>;

  /** Um carrinho com as linhas, o checkout aberto e o token. */
  async function checkoutCom(s: Cenario, linhas: [string, number][]) {
    const loja = { authorization: `Bearer ${s.publica}` };
    const carrinho = await ok(
      pedir(
        "POST",
        "/store/carts",
        { canal: `chn_${s.canal}`, mercado: `mkt_${s.mercado}`, lingua: "pt" },
        loja,
      ),
      201,
    );
    const segredo = { ...loja, "x-cart-secret": String(carrinho["segredo"]) };
    for (const [v, q] of linhas) {
      await ok(
        pedir(
          "POST",
          `/store/carts/${String(carrinho["id"])}/lines`,
          { variante: `var_${v}`, quantidade: q },
          segredo,
        ),
      );
    }
    const sessao = await ok(
      pedir(
        "POST",
        `/store/carts/${String(carrinho["id"])}/checkout`,
        undefined,
        segredo,
      ),
      201,
    );
    return {
      carrinho: String(carrinho["id"]),
      segredo,
      token: String(sessao["token"]),
      sessao: String(sessao["sessao"]),
    };
  }

  /** Preenche o contacto, a entrega, a faturação e os métodos. */
  async function preencher(
    s: Cenario,
    token: string,
    entrega = { pais: "PT", codigo_postal: "1000-001" },
  ) {
    await ok(
      pedir("PUT", `/checkout/${token}/contact`, {
        email: "rui@exemplo.pt",
        nome: "Rui",
      }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/delivery`, {
        ...entrega,
        linha1: "Rua 2",
        localidade: "Lisboa",
      }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/billing`, {
        finalidade: "consumo",
        tipo: "particular",
        nome_documento: "Rui",
      }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/delivery-method`, { metodo: s.metodo }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/payment-method`, {
        metodo: "multibanco",
      }),
    );
  }

  const SEGREDO = "segredo-dos-avisos-123";

  /** O botão final feito: devolve o token e a encomenda (ord_). */
  async function encomenda(
    s: Cenario,
    metodo: "multibanco" | "mb_way" = "multibanco",
    telefone: string | null = null,
  ) {
    const k = await checkoutCom(s, [[s.v1, 2]]);
    await preencher(s, k.token);
    if (telefone !== null) {
      await ok(
        pedir("PUT", `/checkout/${k.token}/contact`, {
          email: "rui@exemplo.pt",
          nome: "Rui",
          telefone,
        }),
      );
    }
    if (metodo !== "multibanco") {
      await ok(pedir("PUT", `/checkout/${k.token}/payment-method`, { metodo }));
    }
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    return { ...k, encomenda: String(e["encomenda"]) };
  }

  /** Um aviso assinado para a conta do cenário. */
  const aviso = (
    s: Cenario,
    corpo: string,
    assinatura: string | null = assinar(corpo, SEGREDO),
  ) =>
    app.inject({
      method: "POST",
      url: `/webhooks/payments/${s.conta}`,
      headers: {
        "content-type": "application/json",
        ...(assinatura === null ? {} : { "x-signature": assinatura }),
      },
      payload: corpo,
    });

  const naBase = <T>(
    s: Cenario,
    fn: (
      trx: Parameters<Parameters<typeof comComerciante>[2]>[0],
    ) => Promise<T>,
  ) => comComerciante(base.api, s.c, fn);

  const eventos = async (s: Cenario) =>
    (
      await sql<{ tipo: string }>`select tipo from evento_saida
        where comerciante_id = ${s.c}::uuid order by id`.execute(base.dono)
    ).rows.map((r) => r.tipo);

  it("a conta: as credenciais cifradas e nunca devolvidas, só o dono as define, e só fica pronta com a chamada de teste", async () => {
    const s = await cenario();
    const nova = await ok(
      s.adm("POST", "/payment-accounts", {
        prestador: "eupago",
        nome: "Formação",
      }),
      201,
    );
    const id = String(nova["id"]);
    // Sem credenciais, o teste recusa.
    expect(await codigo(s.adm("POST", `/payment-accounts/${id}/test`))).toEqual(
      [422, "payments.account_not_ready"],
    );
    await ok(
      s.adm("PUT", `/payment-accounts/${id}/credentials`, {
        chave: "chave-secreta-da-loja-1234",
        segredo_aviso: SEGREDO,
      }),
      204,
    );
    // A EuPago recusa a chave: a conta não fica pronta.
    eupago.respostas.teste = () =>
      json(200, {
        sucesso: false,
        estado: -10,
        resposta: "Chave API inválida",
      });
    expect(await codigo(s.adm("POST", `/payment-accounts/${id}/test`))).toEqual(
      [422, "payments.account_not_ready"],
    );
    delete eupago.respostas.teste;
    await ok(s.adm("POST", `/payment-accounts/${id}/test`));
    const lista = (await ok(s.adm("GET", "/payment-accounts")))[
      "dados"
    ] as Json[];
    const lida = lista.find((c) => c["id"] === id) as Json;
    expect(lida).toMatchObject({
      estado: "pronta",
      modo: "teste",
      prestador: "eupago",
    });
    expect(JSON.stringify(lista)).not.toContain("chave-secreta-da-loja-1234");
    expect(JSON.stringify(lista)).not.toContain(SEGREDO);
    // Na base só a cifra.
    const guardado = (
      await sql<{
        t: string;
      }>`select encode(credenciais_cifra, 'escape') || encode(segredo_aviso_cifra, 'escape') as t
        from conta_pagamento where id = ${id.slice(4)}::uuid`.execute(base.dono)
    ).rows[0]?.t;
    expect(guardado).toBeDefined();
    expect(guardado).not.toContain("chave-secreta-da-loja-1234");
    expect(guardado).not.toContain(SEGREDO);
    // Credenciais novas: volta a rascunho até outro teste.
    await ok(
      s.adm("PUT", `/payment-accounts/${id}/credentials`, {
        chave: "outra-chave-da-loja-5678",
        segredo_aviso: SEGREDO,
      }),
      204,
    );
    const depois = (
      (await ok(s.adm("GET", "/payment-accounts")))["dados"] as Json[]
    ).find((c) => c["id"] === id);
    expect(depois).toMatchObject({ estado: "rascunho", testada_em: null });
    // Uma chave sem payments:accounts não define credenciais.
    const gestor = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Gestor",
        ambitos: ["payments:read", "payments:write"],
      })
    ).segredo;
    expect(
      await codigo(
        pedir(
          "PUT",
          `/payment-accounts/${id}/credentials`,
          { chave: "x".repeat(10), segredo_aviso: SEGREDO },
          { authorization: `Bearer ${gestor}` },
        ),
      ),
    ).toEqual([403, "auth.forbidden"]);
    // O modo real não existe nesta parte (a base recusa).
    await expect(
      sql`update conta_pagamento set modo = 'real' where id = ${id.slice(4)}::uuid`.execute(
        base.dono,
      ),
    ).rejects.toThrow();
  });

  it("a régua: o checkout lista só os métodos activos com a conta pronta, e recusa outro; um método arquivado depois bloqueia o botão final", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    const metodos = (
      await ok(pedir("GET", `/checkout/${k.token}/payment-methods`))
    )["dados"] as Json[];
    expect(metodos.map((m) => m["metodo"])).toEqual(["mb_way", "multibanco"]);
    expect(
      await codigo(
        pedir("PUT", `/checkout/${k.token}/payment-method`, {
          metodo: "cartao",
        }),
      ),
    ).toEqual([422, "checkout.payment_unavailable"]);
    // Um segundo método igual no mesmo mercado: recusado.
    expect(
      await codigo(
        s.adm("POST", "/payment-methods", {
          mercado: `mkt_${s.mercado}`,
          metodo: "multibanco",
          conta: s.conta,
        }),
      ),
    ).toEqual([400, "payments.invalid_field"]);
    await preencher(s, k.token);
    // Arquiva-se o Multibanco depois de escolhido: o resumo bloqueia.
    const regua = (await ok(s.adm("GET", "/payment-methods")))[
      "dados"
    ] as Json[];
    const mb = regua.find((m) => m["metodo"] === "multibanco") as Json;
    await ok(
      s.adm("PATCH", `/payment-methods/${String(mb["id"])}`, {
        versao: mb["versao"],
        arquivar: true,
      }),
    );
    const r = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    expect(r["bloqueios"]).toContainEqual({
      onde: "pagamento",
      motivo: "metodo_indisponivel",
    });
    expect(
      await codigo(
        botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      ),
    ).toEqual([422, "checkout.payment_unavailable"]);
  });

  it("Multibanco: a referência vem do prestador, o clique repetido não cobra outra vez, o aviso pago passa a encomenda a paga (uma vez só)", async () => {
    const s = await cenario();
    const k = await encomenda(s);
    const antes = eupago.chamadas.length;
    const p = await ok(pedir("POST", `/checkout/${k.token}/payment`), 201);
    expect(p).toMatchObject({
      metodo: "multibanco",
      estado: "a_aguardar_cliente",
      montante: 2 * 1230 + 499,
      moeda: "EUR",
      modo: "teste",
      instrucoes: { metodo: "multibanco", entidade: "12345", montante: 2959 },
    });
    // O que foi à EuPago: a nossa referência, o valor em euros, a chave.
    const chamada = eupago.chamadas[antes];
    expect(chamada?.url).toMatch(
      /sandbox\.eupago\.pt\/clientes\/rest_api\/multibanco\/create$/,
    );
    expect(chamada?.corpo).toMatchObject({
      chave: "xxxx-xxxx-xxxx-xxxx",
      valor: 29.59,
      per_dup: 0,
    });
    const pagamento = await ok(s.adm("GET", `/payments/${String(p["id"])}`));
    expect(chamada?.corpo["id"]).toBe(pagamento["referencia"]);
    // O clique repetido devolve o mesmo, sem nova chamada.
    const outra = await ok(pedir("POST", `/checkout/${k.token}/payment`), 200);
    expect(outra["id"]).toBe(p["id"]);
    expect(eupago.chamadas.length).toBe(antes + 1);
    // O aviso pago, assinado.
    const corpo = avisoEuPago({
      identifier: String(pagamento["referencia"]),
      status: "Paid",
      valor: 29.59,
    });
    expect((await aviso(s, corpo)).statusCode).toBe(200);
    const estado = await ok(pedir("GET", `/checkout/${k.token}/payment`));
    expect(estado).toMatchObject({
      encomenda: { estado: "paga" },
      pagamento: { estado: "capturado" },
    });
    // O mesmo aviso outra vez: 200, e não conta outra vez.
    expect((await aviso(s, corpo)).statusCode).toBe(200);
    const lido = await ok(s.adm("GET", `/payments/${String(p["id"])}`));
    expect(
      (lido["transicoes"] as Json[]).map((t) => [t["para"], t["origem"]]),
    ).toEqual([
      ["criado", "sistema"],
      ["a_aguardar_cliente", "consulta"],
      ["capturado", "aviso"],
    ]);
    const tipos = await eventos(s);
    expect(tipos.filter((t) => t === "order.paid")).toHaveLength(1);
    expect(tipos.filter((t) => t === "payment.captured")).toHaveLength(1);
    // Paga, já não se pede outro pagamento: devolve o capturado.
    expect(
      (await ok(pedir("POST", `/checkout/${k.token}/payment`), 200))["estado"],
    ).toBe("capturado");
  });

  it("MB WAY: o telemóvel português vai ao prestador; um aviso com outro montante não paga a encomenda (diferença)", async () => {
    const s = await cenario();
    // Sem telefone, falta; com um estrangeiro, bloqueia.
    const k0 = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k0.token);
    await ok(
      pedir("PUT", `/checkout/${k0.token}/payment-method`, {
        metodo: "mb_way",
      }),
    );
    expect(
      (await ok(pedir("GET", `/checkout/${k0.token}/summary`)))["em_falta"],
    ).toEqual(["telefone"]);
    await ok(
      pedir("PUT", `/checkout/${k0.token}/contact`, {
        email: "rui@exemplo.pt",
        nome: "Rui",
        telefone: "+34612345678",
      }),
    );
    expect(
      (await ok(pedir("GET", `/checkout/${k0.token}/summary`)))["bloqueios"],
    ).toContainEqual({
      onde: "pagamento",
      motivo: "mb_way_telefone_portugues",
    });
    const k = await encomenda(s, "mb_way", "+351912345678");
    const antes = eupago.chamadas.length;
    const p = await ok(pedir("POST", `/checkout/${k.token}/payment`), 201);
    expect(p).toMatchObject({ metodo: "mb_way", estado: "a_aguardar_cliente" });
    const chamada = eupago.chamadas[antes];
    expect(chamada?.cabecalhos["authorization"]).toBe(
      "ApiKey xxxx-xxxx-xxxx-xxxx",
    );
    expect(chamada?.corpo).toMatchObject({
      payment: {
        customerPhone: "912345678",
        countryCode: "+351",
        amount: { value: 29.59, currency: "EUR" },
      },
    });
    const pagamento = await ok(s.adm("GET", `/payments/${String(p["id"])}`));
    const r = await aviso(
      s,
      avisoEuPago({
        identifier: String(pagamento["referencia"]),
        status: "Paid",
        valor: 1,
        method: "Mbway",
      }),
    );
    expect(r.statusCode).toBe(200);
    expect(
      await ok(pedir("GET", `/checkout/${k.token}/payment`)),
    ).toMatchObject({
      encomenda: { estado: "a_aguardar_pagamento" },
      pagamento: { estado: "a_aguardar_cliente" },
    });
    const fila = (await ok(s.adm("GET", "/payment-issues?estado=aberta")))[
      "dados"
    ] as Json[];
    expect(fila).toContainEqual(
      expect.objectContaining({
        motivo: "montante_diferente",
        pagamento: p["id"],
        prova: { esperado: 2959, recebido: 100 },
      }),
    );
  });

  it("avisos: sem assinatura válida, 401 e nada se aplica (fica gravado); conta desconhecida, 404; sem pagamento, diferença", async () => {
    const s = await cenario();
    const k = await encomenda(s);
    const p = await ok(pedir("POST", `/checkout/${k.token}/payment`), 201);
    const pagamento = await ok(s.adm("GET", `/payments/${String(p["id"])}`));
    const corpo = avisoEuPago({
      identifier: String(pagamento["referencia"]),
      status: "Paid",
      valor: 29.59,
    });
    expect((await aviso(s, corpo, null)).statusCode).toBe(401);
    expect(
      (await aviso(s, corpo, assinar(corpo, "outro-segredo-qualquer")))
        .statusCode,
    ).toBe(401);
    expect((await aviso(s, corpo + " ")).statusCode).toBe(200);
    // O corpo com um espaço a mais é outro corpo: a assinatura dele confere.
    const guardados = await naBase(s, (trx) =>
      trx
        .selectFrom("aviso_pagamento")
        .select(["assinatura_valida", "resultado"])
        .orderBy("recebido_em")
        .execute(),
    );
    // Os dois inválidos têm o mesmo corpo: grava-se uma vez.
    expect(guardados.filter((a) => !a.assinatura_valida)).toEqual([
      { assinatura_valida: false, resultado: "assinatura_invalida" },
    ]);
    expect(guardados.filter((a) => a.assinatura_valida)).toEqual([
      { assinatura_valida: true, resultado: "aplicado" },
    ]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/webhooks/payments/pac_${randomUUID()}`,
          headers: { "content-type": "application/json", "x-signature": "x" },
          payload: corpo,
        })
      ).statusCode,
    ).toBe(404);
    // Um aviso de um pagamento que não conhecemos: diferença, 200.
    const estranho = avisoEuPago({
      identifier: "f".repeat(32),
      status: "Paid",
      valor: 5,
      trid: 9,
    });
    expect((await aviso(s, estranho)).statusCode).toBe(200);
    const fila = (await ok(s.adm("GET", "/payment-issues")))["dados"] as Json[];
    expect(fila.map((d) => d["motivo"])).toContain("aviso_sem_pagamento");
  });

  it("tempo esgotado ao cobrar: incerto e diferença, sem cobrar outra vez; um aviso não tira do incerto; uma pessoa decide", async () => {
    const s = await cenario();
    const k = await encomenda(s);
    eupago.respostas.multibanco = () => {
      throw new TypeError("fetch failed");
    };
    const antes = eupago.chamadas.length;
    const p = await ok(pedir("POST", `/checkout/${k.token}/payment`), 201);
    expect(p["estado"]).toBe("incerto");
    delete eupago.respostas.multibanco;
    // Outro clique: devolve o incerto, sem chamar o prestador.
    expect(
      (await ok(pedir("POST", `/checkout/${k.token}/payment`), 200))["estado"],
    ).toBe("incerto");
    expect(eupago.chamadas.length).toBe(antes + 1);
    const pagamento = await ok(s.adm("GET", `/payments/${String(p["id"])}`));
    // Um aviso pago não tira do incerto: vai para a fila.
    expect(
      (
        await aviso(
          s,
          avisoEuPago({
            identifier: String(pagamento["referencia"]),
            status: "Paid",
            valor: 29.59,
          }),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await ok(s.adm("GET", `/payments/${String(p["id"])}`)))["estado"],
    ).toBe("incerto");
    const fila = (await ok(s.adm("GET", "/payment-issues?estado=aberta")))[
      "dados"
    ] as Json[];
    expect(fila.map((d) => d["motivo"]).sort()).toEqual([
      "incerto",
      "transicao_impossivel",
    ]);
    const incerto = fila.find((d) => d["motivo"] === "incerto") as Json;
    // Uma pessoa viu a conta na EuPago e decide: pago.
    await ok(
      s.adm("POST", `/payment-issues/${String(incerto["id"])}/resolve`, {
        resolucao: "Visto no backoffice da EuPago: pago a 09/10.",
        pagamento: "capturado",
      }),
      204,
    );
    expect(
      await ok(pedir("GET", `/checkout/${k.token}/payment`)),
    ).toMatchObject({
      encomenda: { estado: "paga" },
      pagamento: { estado: "capturado" },
    });
    const transicoes = (await ok(s.adm("GET", `/payments/${String(p["id"])}`)))[
      "transicoes"
    ] as Json[];
    expect(transicoes.at(-1)).toMatchObject({
      para: "capturado",
      origem: "pessoa",
    });
    // Resolvida não se resolve outra vez.
    expect(
      await codigo(
        s.adm("POST", `/payment-issues/${String(incerto["id"])}/resolve`, {
          resolucao: "outra vez",
        }),
      ),
    ).toEqual([409, "payments.immutable"]);
  });

  it("recusado pelo prestador: falhado; tenta-se outro método da régua na mesma encomenda", async () => {
    const s = await cenario();
    const k = await encomenda(s, "mb_way", "+351912345678");
    eupago.respostas.mbway = () =>
      json(400, { transactionStatus: "Rejected", code: "INVALID_PHONE" });
    const p = await ok(pedir("POST", `/checkout/${k.token}/payment`), 201);
    expect(p["estado"]).toBe("falhado");
    delete eupago.respostas.mbway;
    const outro = await ok(
      pedir("POST", `/checkout/${k.token}/payment`, { metodo: "multibanco" }),
      201,
    );
    expect(outro).toMatchObject({
      metodo: "multibanco",
      estado: "a_aguardar_cliente",
    });
    expect(outro["id"]).not.toBe(p["id"]);
    // Dois vivos não: o índice da base recusa.
    await expect(
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await sql`insert into pagamento (comerciante_id, encomenda_id, conta_id, prestador,
            metodo, modo, montante, moeda, referencia, expira_em)
          select comerciante_id, encomenda_id, conta_id, prestador, metodo, modo, montante,
            moeda, ${"a".repeat(32)}, expira_em
          from pagamento where id = ${String(outro["id"]).slice(4)}::uuid`.execute(
          trx,
        );
      }),
    ).rejects.toThrow(/pagamento_um_vivo/);
  });

  it("as tarefas: o pendente que passou do prazo expira; a encomenda sem pagamento cancela às 24 h; um pago depois vai para a fila", async () => {
    const s = await cenario();
    const k = await encomenda(s);
    const p = await ok(pedir("POST", `/checkout/${k.token}/payment`), 201);
    const pagamento = await ok(s.adm("GET", `/payments/${String(p["id"])}`));
    const envelhecer = (tipo: string) =>
      sql`update tarefa_pagamento set quando = now() - interval '1 minute'
        where comerciante_id = ${s.c}::uuid and alvo_tipo = ${tipo}`.execute(
        base.dono,
      );
    // Ainda no prazo: nada.
    await correrTarefas(base.api, eupago.config);
    expect(
      (await ok(s.adm("GET", `/payments/${String(p["id"])}`)))["estado"],
    ).toBe("a_aguardar_cliente");
    // A encomenda passa das 24 h com o pagamento vivo: espera por ele.
    await envelhecer("encomenda");
    const r0 = await correrTarefas(base.api, eupago.config);
    expect(r0.canceladas).toBe(0);
    // O pagamento passa do prazo; a EuPago diz pendente: expirado.
    await envelhecer("pagamento");
    const r1 = await correrTarefas(base.api, eupago.config);
    expect(r1.expirados).toBe(1);
    expect(
      (await ok(s.adm("GET", `/payments/${String(p["id"])}`)))["estado"],
    ).toBe("expirado");
    await envelhecer("encomenda");
    const r2 = await correrTarefas(base.api, eupago.config);
    expect(r2.canceladas).toBe(1);
    expect(
      (await ok(pedir("GET", `/checkout/${k.token}/payment`)))["encomenda"],
    ).toEqual({
      id: k.encomenda,
      estado: "cancelada_sem_pagamento",
    });
    expect(await eventos(s)).toContain("order.cancelled");
    // Cancelada, já não se paga.
    expect(
      await codigo(
        pedir("POST", `/checkout/${k.token}/payment`, { metodo: "mb_way" }),
      ),
    ).toEqual([200, null]);
    // Um aviso pago que chega depois: não reabre nada, vai para a fila.
    expect(
      (
        await aviso(
          s,
          avisoEuPago({
            identifier: String(pagamento["referencia"]),
            status: "Paid",
            valor: 29.59,
          }),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await ok(pedir("GET", `/checkout/${k.token}/payment`)))["encomenda"],
    ).toMatchObject({
      estado: "cancelada_sem_pagamento",
    });
    const fila = (await ok(s.adm("GET", "/payment-issues?estado=aberta")))[
      "dados"
    ] as Json[];
    expect(fila.map((d) => d["motivo"])).toContain("transicao_impossivel");
  });

  it("um pagamento que ficou a meio (criado, sem resposta) passa a incerto pela tarefa; sem resposta da EuPago à consulta, adia", async () => {
    const s = await cenario();
    const k = await encomenda(s);
    const id = k.encomenda.slice(4);
    // Cria-se o pagamento sem chamar o prestador (como se o processo caísse).
    await naBase(s, async (trx) => {
      await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
        trx,
      );
      const conta = s.conta.slice(4);
      await sql`insert into pagamento (comerciante_id, encomenda_id, conta_id, prestador,
          metodo, modo, montante, moeda, referencia, expira_em)
        select comerciante_id, id, ${conta}::uuid, 'eupago', 'multibanco', 'teste', total,
          moeda, ${"b".repeat(32)}, now() + interval '1 hour'
        from encomenda where id = ${id}::uuid`.execute(trx);
    });
    await sql`update tarefa_pagamento set quando = now() - interval '1 minute'
      where comerciante_id = ${s.c}::uuid and alvo_tipo = 'pagamento'`.execute(
      base.dono,
    );
    const r = await correrTarefas(base.api, eupago.config);
    expect(r.incertos).toBe(1);
    const fila = (await ok(s.adm("GET", "/payment-issues?estado=aberta")))[
      "dados"
    ] as Json[];
    expect(fila.map((d) => d["motivo"])).toEqual(["incerto"]);
    // Um Multibanco vivo cuja consulta falha: adia, não muda.
    const k2 = await encomenda(s);
    await ok(pedir("POST", `/checkout/${k2.token}/payment`), 201);
    await sql`update tarefa_pagamento set quando = now() - interval '1 minute'
      where comerciante_id = ${s.c}::uuid and alvo_tipo = 'pagamento'`.execute(
      base.dono,
    );
    eupago.respostas.info = () => {
      throw new TypeError("fetch failed");
    };
    const r2 = await correrTarefas(base.api, eupago.config);
    delete eupago.respostas.info;
    expect(r2.adiadas).toBe(1);
    expect(r2.expirados).toBe(0);
  });

  it("a base guarda as regras: paga só com um pagamento capturado do mesmo montante; transições só para a frente; do incerto só por consulta ou pessoa; a fila só a resolve quem não é um processo", async () => {
    const s = await cenario();
    const k = await encomenda(s);
    const p = await ok(pedir("POST", `/checkout/${k.token}/payment`), 201);
    const pid = String(p["id"]).slice(4);
    const comQuem = (
      quem: string,
      origem: string,
      sqlTexto: ReturnType<typeof sql>,
    ) =>
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', ${quem}, true),
          set_config('eurolify.origem', ${origem}, true)`.execute(trx);
        await sqlTexto.execute(trx);
      });
    await expect(
      comQuem(
        "pessoa:teste",
        "pessoa",
        sql`update encomenda set estado = 'paga'
        where id = ${k.encomenda.slice(4)}::uuid`,
      ),
    ).rejects.toThrow(/order_not_paid/);
    await expect(
      comQuem(
        "pessoa:teste",
        "aviso",
        sql`update pagamento set estado = 'reembolsado'
        where id = ${pid}::uuid`,
      ),
    ).rejects.toThrow(/invalid_transition/);
    await expect(
      comQuem(
        "pessoa:teste",
        "",
        sql`update pagamento set estado = 'capturado'
        where id = ${pid}::uuid`,
      ),
    ).rejects.toThrow(/change_without_origin/);
    await expect(
      comQuem(
        "pessoa:teste",
        "aviso",
        sql`update pagamento set montante = 1
        where id = ${pid}::uuid`,
      ),
    ).rejects.toThrow(/permission denied/);
    // Mesmo o dono da base não muda as cópias (o gatilho).
    await expect(
      comComerciante(base.dono, s.c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await sql`update pagamento set montante = 1 where id = ${pid}::uuid`.execute(
          trx,
        );
      }),
    ).rejects.toThrow(/immutable/);
    await comQuem(
      "sistema:teste",
      "sistema",
      sql`update pagamento set estado = 'incerto'
      where id = ${pid}::uuid`,
    );
    await expect(
      comQuem(
        "prestador:eupago",
        "aviso",
        sql`update pagamento set estado = 'capturado'
        where id = ${pid}::uuid`,
      ),
    ).rejects.toThrow(/do incerto só/);
    // Uma diferença não a resolve um processo automático.
    await naBase(s, (trx) =>
      trx
        .insertInto("diferenca_pagamento")
        .values({
          comerciante_id: s.c,
          pagamento_id: pid,
          motivo: "incerto",
          prova: "{}",
        })
        .execute(),
    );
    await expect(
      naBase(s, (trx) =>
        sql`update diferenca_pagamento set estado = 'resolvida', resolucao = 'auto',
            resolvida_por = 'sistema:pagamentos', resolvida_em = now()`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/issue_needs_person/);
    // A API não escreve as transições nem as tarefas.
    await expect(
      naBase(s, (trx) =>
        sql`insert into transicao_pagamento (comerciante_id, pagamento_id, para, origem, quem)
            values (${s.c}::uuid, ${pid}::uuid, 'capturado', 'pessoa', 'x')`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      naBase(s, (trx) => sql`select * from tarefa_pagamento`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it("o comerciante vizinho não vê os pagamentos, as contas nem a fila; e um aviso para a conta de um não toca nos pagamentos do outro", async () => {
    const s = await cenario();
    const vizinho = await cenario();
    const k = await encomenda(s);
    const p = await ok(pedir("POST", `/checkout/${k.token}/payment`), 201);
    expect(
      await codigo(vizinho.adm("GET", `/payments/${String(p["id"])}`)),
    ).toEqual([404, "payments.not_found"]);
    expect(
      (
        (await ok(vizinho.adm("GET", "/payment-accounts")))["dados"] as Json[]
      ).map((c) => c["id"]),
    ).toEqual([vizinho.conta]);
    // O aviso vai para a conta do vizinho, com a referência do pagamento do
    // primeiro e a assinatura certa do vizinho: não o encontra.
    const pagamento = await ok(s.adm("GET", `/payments/${String(p["id"])}`));
    expect(
      (
        await aviso(
          vizinho,
          avisoEuPago({
            identifier: String(pagamento["referencia"]),
            status: "Paid",
            valor: 29.59,
          }),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await ok(s.adm("GET", `/payments/${String(p["id"])}`)))["estado"],
    ).toBe("a_aguardar_cliente");
    expect(
      (
        (await ok(vizinho.adm("GET", "/payment-issues")))["dados"] as Json[]
      ).map((d) => d["motivo"]),
    ).toEqual(["aviso_sem_pagamento"]);
  });

  it("sem a chave dos pagamentos no servidor, pagar dá 503 e nada se cria", async () => {
    const s = await cenario();
    const k = await encomenda(s);
    const semChave = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      undefined,
      undefined,
      { pedidos: 100_000, janelaMs: 60_000 },
      { adaptadores: eupago.config.adaptadores },
    );
    try {
      const r = await semChave.inject({
        method: "POST",
        url: `/checkout/${k.token}/payment`,
      });
      expect([r.statusCode, r.json<Json>()["codigo"]]).toEqual([
        503,
        "payments.not_configured",
      ]);
      const n = await naBase(s, (trx) =>
        trx
          .selectFrom("pagamento")
          .select((e) => e.fn.countAll<string>().as("n"))
          .executeTakeFirstOrThrow(),
      );
      expect(Number(n.n)).toBe(0);
    } finally {
      await semChave.close();
    }
  });
});
