import { randomBytes, randomUUID } from "node:crypto";
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
import { EmissorDeEnsaio } from "../src/faturacao/adaptador.js";
import { correrDocumentos } from "../src/faturacao/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import { assinar, avisoEuPago, eupagoFalso } from "./eupago-falso.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Os documentos fiscais pela API (docs/28; migração 0050): quem emite, a
// ligação ao emissor, a retenção com motivo, a emissão em dois passos, a
// prova lida de volta, o incerto reconciliado e as decisões de uma pessoa.
// O emissor é o de ensaio (Q5): nada sai para fora.

type Json = Record<string, unknown>;
const QUEM = "pessoa:teste";

describe.skipIf(URL_BASE === undefined)("API dos documentos fiscais", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  // Os métodos de pagamento vêm da régua (docs/26): uma conta EuPago de teste.
  const eupago = eupagoFalso();
  const ensaio = new EmissorDeEnsaio();
  const faturacao = {
    chave: chavePagamentos(randomBytes(32).toString("base64")),
    adaptadores: { ensaio },
  };
  /** Uma volta da tarefa dos documentos. */
  const correr = () => correrDocumentos(base.api, faturacao);

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
      faturacao,
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
          "payments:resolve",
          "inventory:read",
          "inventory:write",
          "inventory:policy",
          "fulfilment:read",
          "fulfilment:write",
          "invoices:read",
          "invoices:write",
          "invoices:accounts",
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
    // O armazém da loja e 100 unidades de cada variante (docs/27).
    const armazem = await ok(
      adm("POST", "/warehouses", { loja: `sto_${loja}`, nome: "Armazém" }),
      201,
    );
    await ok(
      adm("POST", "/inventory/receipts", {
        armazem: armazem["id"],
        linhas: [
          { variante: `var_${v1}`, quantidade: 100 },
          { variante: `var_${v2}`, quantidade: 100 },
        ],
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
    const entidadeId = entidade;
    return {
      entidade: entidadeId,
      armazem: String(armazem["id"]),
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
    nif: string | null = null,
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
        ...(nif === null ? {} : { nif }),
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

  /** Uma encomenda paga (o aviso do Multibanco assinado). */
  async function paga(
    s: Cenario,
    linhas: [string, number][],
    nif: string | null = null,
  ) {
    const k = await checkoutCom(s, linhas);
    await preencher(s, k.token, undefined, nif);
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    const p = await ok(pedir("POST", `/checkout/${k.token}/payment`), 201);
    const pag = await ok(s.adm("GET", `/payments/${String(p["id"])}`));
    expect(
      (
        await aviso(
          s,
          avisoEuPago({
            identifier: String(pag["referencia"]),
            status: "Paid",
            valor: Number(pag["montante"]) / 100,
            trid: Math.floor(Math.random() * 1e9),
          }),
        )
      ).statusCode,
    ).toBe(200);
    return { ...k, encomenda: String(e["encomenda"]) };
  }

  /** Liga a entidade ao emissor de ensaio, com a taxa PT 23 % e a M16. */
  async function ligar(
    s: Cenario,
    conta: string,
    taxas = [{ pais: "PT", taxa: 2300, emissor: "T23" }],
  ) {
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "eurolify",
      }),
      204,
    );
    const l = await ok(
      s.adm("POST", "/invoicing-connections", {
        entidade_legal: `lgl_${s.entidade}`,
        adaptador: "ensaio",
        serie: "LOJA",
        taxas,
        isencoes: [{ codigo: "M16", emissor: "I16" }],
      }),
      201,
    );
    const id = String(l["id"]);
    await ok(
      s.adm("PUT", `/invoicing-connections/${id}/credentials`, {
        credenciais: { conta },
      }),
      204,
    );
    expect(
      await ok(s.adm("POST", `/invoicing-connections/${id}/test`)),
    ).toEqual({ estado: "pronta", erro: null });
    return id;
  }

  /** O pedido de documento da encomenda. */
  const documentoDe = async (s: Cenario, encomenda: string) => {
    const lista = (await ok(s.adm("GET", `/invoices?encomenda=${encomenda}`)))[
      "dados"
    ] as Json[];
    if (lista[0] === undefined) return null;
    return ok(s.adm("GET", `/invoices/${String(lista[0]["id"])}`));
  };

  /** Traz para agora a próxima tentativa dos incertos (o emissor teve tempo). */
  const adiantar = (s: Cenario) =>
    sql`update documento_fiscal set proxima_em = now() - interval '1 minute'
      where comerciante_id = ${s.c}::uuid and estado = 'incerto'
        and proxima_em < '9000-01-01'`.execute(base.dono);

  /** Corre a tarefa até o documento parar (no máximo 4 voltas). */
  const ateParar = async () => {
    for (let i = 0; i < 4; i++) {
      const r = await correr();
      expect(r.erros).toEqual([]);
      if (r.passos === 0) break;
    }
  };

  it("sem emissor configurado: o pedido nasce ao pagar e fica retido, com o motivo", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 1]]);
    let d = await documentoDe(s, e.encomenda);
    expect(d).toMatchObject({
      estado: "a_verificar",
      tipo: "fatura",
      modo: "teste",
    });
    await ateParar();
    d = await documentoDe(s, e.encomenda);
    expect(d?.["estado"]).toBe("retido");
    expect(d?.["motivos"]).toEqual([
      "emissor_por_configurar",
      "ligacao_sem_teste",
    ]);
    // O conteúdo nasceu da encomenda: os montantes dela, a nota de carimbo.
    const conteudo = ((d?.["conteudos"] as Json[])[0] as Json)[
      "conteudo"
    ] as Json;
    expect(conteudo).toMatchObject({
      encomenda: e.encomenda,
      carimbo: "destino PT · IVA 23 %",
      totais: { total: 1230 + 499 },
    });
    expect((conteudo["linhas"] as Json[]).map((l) => l["descricao"])).toEqual([
      "Gel UV",
      "Portes — Correio",
    ]);
    const enc = await ok(s.adm("GET", `/orders/${e.encomenda}`));
    expect(enc).toMatchObject({
      emissor_fiscal: "por_configurar",
      documento: { estado: "retido" },
    });
    const tipos = await eventos(s);
    expect(tipos).toContain("invoice.requested");
    expect(tipos).toContain("invoice.held");
    // Uma encomenda por pagar não tem documento.
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    const porPagar = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    expect(await documentoDe(s, String(porPagar["encomenda"]))).toBeNull();
  });

  it("emite pelo emissor de ensaio: rascunho, conferir, fechar; a prova é o documento lido de volta", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    const e = await paga(s, [[s.v1, 2]], "501964843");
    await ateParar();
    const d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("emitido");
    const prova = d["prova"] as Json;
    expect(prova).toMatchObject({
      numero: "FT LOJA/1",
      nif: "501964843",
      divergencias: [],
      totais: { base: 2000 + 406, iva: 460 + 93, total: 2460 + 499 },
      tem_pdf: true,
    });
    expect(ensaio.conta(conta).chamadas).toEqual([
      "testar",
      "procurarEntidade",
      "criarRascunho",
      "lerDocumento",
      "fechar",
      "pdf",
    ]);
    // O documento leva a nossa referência e a nota de carimbo.
    const noEmissor = [...ensaio.conta(conta).documentos.values()];
    expect(noEmissor).toHaveLength(1);
    expect(noEmissor[0]?.referencia).toBe(d["id"]);
    const pdf = await s.adm("GET", `/invoices/${String(d["id"])}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    // O perfil fica usado num documento (R12).
    const enc = await ok(s.adm("GET", `/orders/${e.encomenda}`));
    const perfil = await naBase(s, (trx) =>
      trx
        .selectFrom("perfil_faturacao")
        .select("usado_em_documento")
        .where("id", "=", String(enc["perfil"]).slice(4))
        .executeTakeFirstOrThrow(),
    );
    expect(perfil.usado_em_documento).toBe(true);
    // O rasto tem cada passo; o evento invoice.issued saiu.
    expect(
      (d["rasto"] as Json[]).map((p) => p["para"]).filter(Boolean),
    ).toEqual(["a_verificar", "pronto", "rascunho", "emitido"]);
    expect(await eventos(s)).toContain("invoice.issued");
    // A prova e o rasto só se acrescentam; o pedido não se apaga.
    await expect(
      naBase(s, (trx) =>
        sql`update documento_prova set numero = 'X'`.execute(trx),
      ),
    ).rejects.toThrow();
    await expect(
      naBase(s, (trx) => sql`delete from documento_fiscal`.execute(trx)),
    ).rejects.toThrow();
    // As credenciais nunca saem pela API.
    const ligacoes = await ok(s.adm("GET", "/invoicing-connections"));
    expect(JSON.stringify(ligacoes)).not.toContain(conta);
  });

  it("com sistema próprio, a encomenda não tem documento e a base recusa criá-lo", async () => {
    const s = await cenario();
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "sistema_proprio",
      }),
      204,
    );
    const e = await paga(s, [[s.v1, 1]]);
    expect(await documentoDe(s, e.encomenda)).toBeNull();
    expect(
      (await ok(s.adm("GET", `/orders/${e.encomenda}`)))["emissor_fiscal"],
    ).toBe("sistema_proprio");
    await expect(
      comComerciante(base.dono, s.c, (trx) =>
        sql`insert into documento_fiscal (comerciante_id, encomenda_id, entidade_legal_id, modo)
          values (${s.c}::uuid, ${e.encomenda.slice(4)}::uuid, ${s.entidade}::uuid, 'teste')`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/invoices.other_issuer/);
    // O emissor da encomenda não muda, nem pela base.
    await expect(
      comComerciante(base.dono, s.c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await sql`update encomenda set emissor_fiscal = 'eurolify'
          where id = ${e.encomenda.slice(4)}::uuid`.execute(trx);
      }),
    ).rejects.toThrow(/orders.immutable/);
    // Mudar a entidade depois não muda a encomenda já feita (Q6).
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "eurolify",
      }),
      204,
    );
    expect(
      (await ok(s.adm("GET", `/orders/${e.encomenda}`)))["emissor_fiscal"],
    ).toBe("sistema_proprio");
  });

  it("uma taxa sem mapa retém; corrigido o mapa e testada a ligação, verifica-se outra vez e sai", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    const ligacao = await ligar(s, conta, []);
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    let d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d).toMatchObject({ estado: "retido", motivos: ["taxa_sem_mapa"] });
    // Não se liberta: resolve-se na configuração.
    expect(
      await codigo(
        s.adm("POST", `/invoices/${String(d["id"])}/release`, {
          versao: d["versao"],
          motivo_retencao: "taxa_sem_mapa",
          motivo: "tentar",
        }),
      ),
    ).toEqual([400, "invoices.invalid_field"]);
    const l = (
      (await ok(s.adm("GET", "/invoicing-connections")))["dados"] as Json[]
    ).find((x) => x["id"] === ligacao) as Json;
    await ok(
      s.adm("PATCH", `/invoicing-connections/${ligacao}`, {
        versao: l["versao"],
        taxas: [{ pais: "PT", taxa: 2300, emissor: "T23" }],
      }),
    );
    // Mudar o mapa obriga a testar outra vez.
    const depois = (
      (await ok(s.adm("GET", "/invoicing-connections")))["dados"] as Json[]
    ).find((x) => x["id"] === ligacao) as Json;
    expect(depois["estado"]).toBe("por_testar");
    await ok(s.adm("POST", `/invoicing-connections/${ligacao}/test`));
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/recheck`, {
        versao: d["versao"],
      }),
    );
    await ateParar();
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("emitido");
  });

  it("o emissor não responde ao fechar: incerto; a reconciliação encontra-o pela referência e não emite outro", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    ensaio.conta(conta).falhas.fechar = "rede";
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    let d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("incerto");
    expect(await eventos(s)).toContain("invoice.uncertain");
    ensaio.conta(conta).falhas = {};
    await adiantar(s);
    await ateParar();
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("emitido");
    // Um documento só, o número 1: nunca se repetiu o fechar.
    const docs = [...ensaio.conta(conta).documentos.values()];
    expect(docs.map((x) => [x.estado, x.numero])).toEqual([
      ["fechado", "FT LOJA/1"],
    ]);
    expect(
      ensaio.conta(conta).chamadas.filter((c) => c === "fechar"),
    ).toHaveLength(1);
  });

  it("o emissor não responde ao rascunho: a reconciliação adopta o rascunho que lá ficou", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    ensaio.conta(conta).falhas.criarRascunho = "rede";
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    expect((await documentoDe(s, e.encomenda))?.["estado"]).toBe("incerto");
    ensaio.conta(conta).falhas = {};
    await adiantar(s);
    await ateParar();
    expect((await documentoDe(s, e.encomenda))?.["estado"]).toBe("emitido");
    expect(ensaio.conta(conta).documentos.size).toBe(1);
    expect(
      ensaio.conta(conta).chamadas.filter((c) => c === "criarRascunho"),
    ).toHaveLength(1);
  });

  it("sem saber se ficou feito, ao fim de 3 tentativas vai para uma pessoa, que reconcilia lendo o emissor", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    ensaio.conta(conta).falhas = {
      fechar: "rede",
      procurarPorReferencia: "nao_sei",
    };
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    for (let i = 0; i < 3; i++) {
      await adiantar(s);
      await correr();
    }
    let d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d).toMatchObject({
      estado: "incerto",
      motivos: ["reconciliacao_manual"],
    });
    // Fora da tarefa: não volta a ser tentado sozinho.
    expect((await correr()).passos).toBe(0);
    ensaio.conta(conta).falhas = {};
    // Um documento do emissor com outra referência é recusado.
    expect(
      await codigo(
        s.adm("POST", `/invoices/${String(d["id"])}/reconcile`, {
          versao: d["versao"],
          resultado: "encontrado",
          motivo: "visto no emissor",
        }),
      ),
    ).toEqual([400, "invoices.invalid_field"]);
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/reconcile`, {
        versao: d["versao"],
        resultado: "encontrado",
        emissor_id: "doc-1",
        motivo: "visto no emissor: fechado com o número FT LOJA/1",
      }),
    );
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("emitido");
    expect((d["prova"] as Json)["numero"]).toBe("FT LOJA/1");
  });

  it("a entidade do emissor com outro NIF retém e não se liberta (R5)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    ensaio.conta(conta).aliases.set("501964843", {
      id: "E9",
      nif: "245245405",
      nome: "Outra pessoa",
    });
    const e = await paga(s, [[s.v1, 1]], "501964843");
    await ateParar();
    const d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d).toMatchObject({
      estado: "retido",
      motivos: ["entidade_do_emissor_diferente"],
    });
    expect(ensaio.conta(conta).documentos.size).toBe(0);
    expect(
      await codigo(
        s.adm("POST", `/invoices/${String(d["id"])}/release`, {
          versao: d["versao"],
          motivo_retencao: "entidade_do_emissor_diferente",
          motivo: "sair assim",
        }),
      ),
    ).toEqual([400, "invoices.invalid_field"]);
  });

  it("um rascunho que não bate com o pedido apaga-se e o documento fica retido, sem fechar (R6)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    ensaio.conta(conta).aoCriar = (doc) => ({
      ...doc,
      linhas: doc.linhas.map((l) => ({ ...l, taxa: 600 })),
    });
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    const d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d).toMatchObject({
      estado: "retido",
      motivos: ["totais_nao_batem"],
    });
    expect(ensaio.conta(conta).documentos.size).toBe(0);
    expect(ensaio.conta(conta).chamadas).not.toContain("fechar");
    expect((d["rasto"] as Json[]).map((p) => p["passo"])).toContain(
      "rascunho_apagado",
    );
  });

  it("a prova que não bate com o pedido fica divergente; uma pessoa decide (R7)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    ensaio.conta(conta).aoFechar = (doc) => ({
      ...doc,
      totais: {
        ...doc.totais,
        iva: doc.totais.iva + 1,
        total: doc.totais.total + 1,
      },
    });
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    let d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("divergente");
    expect((d["prova"] as Json)["divergencias"]).toEqual([
      { campo: "totais.iva", esperado: 230 + 93, obtido: 230 + 93 + 1 },
      { campo: "totais.total", esperado: 1230 + 499, obtido: 1230 + 499 + 1 },
    ]);
    expect(await eventos(s)).toContain("invoice.discrepancy");
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/resolve`, {
        versao: d["versao"],
        motivo: "visto com o contabilista: nota de crédito na fatia 11",
      }),
    );
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("resolvido");
  });

  it("o NIF de consumidor final retém; corrigido o NIF numa versão nova do conteúdo, sai com ele (Q4)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    const e = await paga(s, [[s.v1, 1]], "999999990");
    await ateParar();
    let d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d).toMatchObject({ estado: "retido", motivos: ["nif_recusado"] });
    // Não se corrigem montantes nem taxas.
    expect(
      await codigo(
        s.adm("POST", `/invoices/${String(d["id"])}/correct`, {
          versao: d["versao"],
          motivo: "tentar",
          total: 1,
        }),
      ),
    ).toEqual([400, "request.invalid"]);
    // Um NIF que a régua recusa não entra.
    expect(
      await codigo(
        s.adm("POST", `/invoices/${String(d["id"])}/correct`, {
          versao: d["versao"],
          motivo: "o cliente ligou",
          nif: "123456789",
        }),
      ),
    ).toEqual([400, "invoices.invalid_field"]);
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/correct`, {
        versao: d["versao"],
        motivo: "o cliente ligou com o NIF certo",
        nif: "263631656",
      }),
    );
    await ateParar();
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("emitido");
    expect((d["prova"] as Json)["nif"]).toBe("263631656");
    expect((d["conteudos"] as Json[]).map((c) => c["versao"])).toEqual([1, 2]);
    // O perfil da encomenda (com outro NIF) não fica marcado como usado.
    const enc = await ok(s.adm("GET", `/orders/${e.encomenda}`));
    const perfil = await naBase(s, (trx) =>
      trx
        .selectFrom("perfil_faturacao")
        .select("usado_em_documento")
        .where("id", "=", String(enc["perfil"]).slice(4))
        .executeTakeFirstOrThrow(),
    );
    expect(perfil.usado_em_documento).toBe(false);
  });

  it("libertar o NIF recusado vale como validação (R9); só com invoices:write", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    const e = await paga(s, [[s.v1, 1]], "999999990");
    await ateParar();
    const d = (await documentoDe(s, e.encomenda)) as Json;
    const leitor = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Só ler",
        ambitos: ["invoices:read"],
      })
    ).segredo;
    const corpo = {
      versao: d["versao"],
      motivo_retencao: "nif_recusado",
      motivo: "confirmado com o cliente: é o NIF dele",
    };
    expect(
      await codigo(
        pedir("POST", `/invoices/${String(d["id"])}/release`, corpo, {
          authorization: `Bearer ${leitor}`,
        }),
      ),
    ).toEqual([403, "auth.forbidden"]);
    expect(
      await codigo(
        pedir(
          "POST",
          "/invoicing-connections",
          {},
          { authorization: `Bearer ${leitor}` },
        ),
      ),
    ).toEqual([403, "auth.forbidden"]);
    await ok(s.adm("POST", `/invoices/${String(d["id"])}/release`, corpo));
    await ateParar();
    const depois = (await documentoDe(s, e.encomenda)) as Json;
    expect(depois).toMatchObject({
      estado: "emitido",
      validados: ["nif_recusado"],
    });
    expect(
      (depois["rasto"] as Json[]).some(
        (p) =>
          p["passo"] === "libertado" &&
          String(p["quem"]).startsWith("chave:key_"),
      ),
    ).toBe(true);
  });
});
