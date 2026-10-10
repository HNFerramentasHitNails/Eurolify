import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  classificarArtigo,
  criarArtigo,
  definirComponentes,
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
import { correrConclusoes } from "../src/stock/repositorio.js";
import { assinar, avisoEuPago, eupagoFalso } from "./eupago-falso.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// O stock e as expedições pela API (docs/27; migração 0047): o saldo só por
// movimento, a reserva no botão final, os kits pelos componentes, os lotes na
// saída, a vista do armazém e os estados da encomenda depois de paga.

type Json = Record<string, unknown>;
const QUEM = "pessoa:teste";

describe.skipIf(URL_BASE === undefined)("API do stock e das expedições", () => {
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
          "payments:resolve",
          "inventory:read",
          "inventory:write",
          "inventory:policy",
          "fulfilment:read",
          "fulfilment:write",
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
    return {
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

  /** O saldo de uma variante no armazém do cenário. */
  const saldo = async (s: Cenario, variante: string) => {
    const dados = (
      await ok(s.adm("GET", `/inventory?variante=var_${variante}`))
    )["dados"] as Json[];
    const l = dados[0] ?? { fisico: 0, reservado: 0, disponivel: 0 };
    return {
      fisico: l["fisico"],
      reservado: l["reservado"],
      disponivel: l["disponivel"],
    };
  };

  /** Uma encomenda paga (o aviso do Multibanco assinado). */
  async function paga(s: Cenario, linhas: [string, number][]) {
    const k = await checkoutCom(s, linhas);
    await preencher(s, k.token);
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

  it("o livro: a entrada muda o saldo pelo movimento, com o antes e o depois; a API não escreve o saldo", async () => {
    const s = await cenario();
    expect(await saldo(s, s.v1)).toEqual({
      fisico: 100,
      reservado: 0,
      disponivel: 100,
    });
    await ok(
      s.adm("POST", "/inventory/receipts", {
        armazem: s.armazem,
        linhas: [{ variante: `var_${s.v1}`, quantidade: 5 }],
      }),
      201,
    );
    expect((await saldo(s, s.v1)).fisico).toBe(105);
    const movs = (
      await ok(s.adm("GET", `/inventory/movements?variante=var_${s.v1}`))
    )["dados"] as Json[];
    expect(movs[0]).toMatchObject({
      tipo: "entrada",
      quantidade: 5,
      fisico: { antes: 100, depois: 105 },
      reservado: { antes: 0, depois: 0 },
      quem: expect.stringMatching(/^chave:key_/) as unknown,
    });
    await expect(
      naBase(s, (trx) => sql`update saldo_stock set fisico = 999`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await sql`update movimento_stock set quantidade = 1`.execute(trx);
      }),
    ).rejects.toThrow();
    // Um ajuste: com motivo; nunca negativo; nunca abaixo do reservado.
    expect(
      await codigo(
        s.adm("POST", "/inventory/adjustments", {
          armazem: s.armazem,
          variante: `var_${s.v1}`,
          delta: -200,
          motivo: "contagem",
        }),
      ),
    ).toEqual([422, "inventory.negative"]);
    await ok(
      s.adm("POST", "/inventory/adjustments", {
        armazem: s.armazem,
        variante: `var_${s.v1}`,
        delta: -5,
        motivo: "partidos na prateleira",
      }),
      201,
    );
    expect((await saldo(s, s.v1)).fisico).toBe(100);
  });

  it("a reserva no botão final; o resumo bloqueia o que não há; cancelar sem pagamento liberta", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 2]]);
    await preencher(s, k.token);
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    expect(await saldo(s, s.v1)).toEqual({
      fisico: 100,
      reservado: 2,
      disponivel: 98,
    });
    // Ajustar para deixar só 98 físicos já não cabe (2 estão reservados e 98
    // ficariam com 96 disponíveis): abaixo do reservado recusa.
    expect(
      await codigo(
        s.adm("POST", "/inventory/adjustments", {
          armazem: s.armazem,
          variante: `var_${s.v1}`,
          delta: -99,
          motivo: "contagem",
        }),
      ),
    ).toEqual([422, "inventory.insufficient"]);
    await ok(
      s.adm("POST", "/inventory/adjustments", {
        armazem: s.armazem,
        variante: `var_${s.v1}`,
        delta: -97,
        motivo: "contagem",
      }),
      201,
    );
    expect(await saldo(s, s.v1)).toEqual({
      fisico: 3,
      reservado: 2,
      disponivel: 1,
    });
    const k2 = await checkoutCom(s, [[s.v1, 2]]);
    await preencher(s, k2.token);
    const r = await ok(pedir("GET", `/checkout/${k2.token}/summary`));
    expect(r["bloqueios"]).toContainEqual({
      onde: `stock:var_${s.v1}`,
      motivo: "sem_stock",
    });
    expect(
      await codigo(
        botao(k2.token, { aceita_condicoes: true, versoes: s.versoes }),
      ),
    ).toEqual([422, "checkout.out_of_stock"]);
    // A encomenda sem pagamento cancela às 24 h e a reserva volta.
    await sql`update tarefa_pagamento set quando = now() - interval '1 minute'
      where comerciante_id = ${s.c}::uuid and alvo_tipo = 'encomenda'`.execute(
      base.dono,
    );
    await correrTarefas(base.api, eupago.config);
    expect(
      (await ok(s.adm("GET", `/orders/${String(e["encomenda"])}`)))["estado"],
    ).toBe("cancelada_sem_pagamento");
    expect(await saldo(s, s.v1)).toEqual({
      fisico: 3,
      reservado: 0,
      disponivel: 3,
    });
    const movs = (
      await ok(
        s.adm(
          "GET",
          `/inventory/movements?encomenda=${String(e["encomenda"])}`,
        ),
      )
    )["dados"] as Json[];
    expect(movs.map((m) => m["tipo"]).sort()).toEqual([
      "libertacao",
      "reserva",
    ]);
  });

  it("a última unidade, dois botões ao mesmo tempo: uma encomenda só", async () => {
    const s = await cenario();
    await ok(
      s.adm("POST", "/inventory/adjustments", {
        armazem: s.armazem,
        variante: `var_${s.v1}`,
        delta: -99,
        motivo: "deixar uma",
      }),
      201,
    );
    const a = await checkoutCom(s, [[s.v1, 1]]);
    const b = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, a.token);
    await preencher(s, b.token);
    const corpo = { aceita_condicoes: true, versoes: s.versoes };
    const [ra, rb] = await Promise.all([
      botao(a.token, corpo),
      botao(b.token, corpo),
    ]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([201, 422]);
    expect(await saldo(s, s.v1)).toEqual({
      fisico: 1,
      reservado: 1,
      disponivel: 0,
    });
  });

  it("um kit não tem stock próprio: o disponível vem dos componentes, e vendê-lo reserva os componentes", async () => {
    const s = await cenario();
    const artigo = await criarArtigo(
      base.api,
      s.c,
      { tipo: "fisico", nome: "Kit", categoria_fiscal: "normal" },
      [{ sku: "KIT-001", unidade_de_venda: "unidade", peso_g: 100 }],
    );
    const kit = (
      await comComerciante(base.api, s.c, (trx) =>
        trx
          .selectFrom("variante")
          .select("id")
          .where("artigo_id", "=", artigo)
          .executeTakeFirstOrThrow(),
      )
    ).id;
    await definirComponentes(base.api, s.c, kit, [
      { varianteId: s.v1, quantidade: 2 },
      { varianteId: s.v2, quantidade: 1 },
    ]);
    await classificarArtigo(
      base.api,
      s.c,
      artigo,
      1,
      { familias: ["retalho_geral"], natureza_consumidor: "bem" },
      QUEM,
    );
    await mudarEstadoArtigo(base.api, s.c, artigo, 2, "activo");
    await definirPreco(base.api, s.c, QUEM, s.lista, kit, { montante: 2000 });
    expect(
      (
        await publicar(base.api, s.c, QUEM, {
          artigo_id: artigo,
          canal_id: s.canal,
          mercado_id: s.mercado,
        })
      ).publicada,
    ).toBe(true);
    // Deixa 7 de v1 (3 kits) e 100 de v2: o kit tem 3.
    await ok(
      s.adm("POST", "/inventory/adjustments", {
        armazem: s.armazem,
        variante: `var_${s.v1}`,
        delta: -93,
        motivo: "teste",
      }),
      201,
    );
    const k4 = await checkoutCom(s, [[kit, 4]]);
    await preencher(s, k4.token);
    expect(
      (await ok(pedir("GET", `/checkout/${k4.token}/summary`)))["bloqueios"],
    ).toContainEqual({ onde: `stock:var_${kit}`, motivo: "sem_stock" });
    const e = await paga(s, [[kit, 3]]);
    expect(await saldo(s, s.v1)).toMatchObject({ reservado: 6, disponivel: 1 });
    expect(await saldo(s, s.v2)).toMatchObject({
      reservado: 3,
      disponivel: 97,
    });
    // O kit nunca tem saldo próprio.
    expect(
      (await ok(s.adm("GET", `/inventory?variante=var_${kit}`)))["dados"],
    ).toEqual([]);
    // A composição muda depois da compra: a saída usa a do botão final
    // (revisão do #296, P1-3).
    await definirComponentes(base.api, s.c, kit, [
      { varianteId: s.v1, quantidade: 1 },
      { varianteId: s.v2, quantidade: 1 },
    ]);
    // Um kit não recebe stock próprio.
    expect(
      await codigo(
        s.adm("POST", "/inventory/receipts", {
          armazem: s.armazem,
          linhas: [{ variante: `var_${kit}`, quantidade: 1 }],
        }),
      ),
    ).toEqual([422, "inventory.not_controlled"]);
    // A expedição dá saída dos componentes.
    const v = await ok(s.adm("GET", `/fulfilment/orders/${e.encomenda}`));
    const linha = (v["linhas"] as Json[])[0] as Json;
    const x = await ok(
      s.adm("POST", `/orders/${e.encomenda}/shipments`, {
        linhas: [{ linha: linha["id"], quantidade: 3 }],
      }),
      201,
    );
    await ok(
      s.adm("PATCH", `/shipments/${String(x["id"])}`, {
        versao: 1,
        estado: "expedida",
      }),
    );
    expect(await saldo(s, s.v1)).toEqual({
      fisico: 1,
      reservado: 0,
      disponivel: 1,
    });
    expect(await saldo(s, s.v2)).toEqual({
      fisico: 97,
      reservado: 0,
      disponivel: 97,
    });
  });

  it("lotes: sem lote não entra; a saída leva o lote que expira primeiro; o saldo do lote baixa", async () => {
    const s = await cenario();
    const politica = (exige_lote: boolean) =>
      pedir(
        "PUT",
        `/variants/var_${s.v1}/stock-policy`,
        { politica: "controla", exige_lote },
        { authorization: `Bearer ${s.servidor}` },
      );
    // Com físico sem lote, não passa a exigir lote: a soma dos lotes tem de
    // ser o físico (revisão do #296, P1-1).
    expect(await codigo(politica(true))).toEqual([
      409,
      "inventory.policy_blocked",
    ]);
    // Os 100 iniciais saem do físico sem lote; passam a lotes com entradas.
    await ok(
      s.adm("POST", "/inventory/adjustments", {
        armazem: s.armazem,
        variante: `var_${s.v1}`,
        delta: -100,
        motivo: "recontagem por lotes",
      }),
      201,
    );
    await ok(politica(true), 204);
    expect(
      await codigo(
        s.adm("POST", "/inventory/receipts", {
          armazem: s.armazem,
          linhas: [{ variante: `var_${s.v1}`, quantidade: 5 }],
        }),
      ),
    ).toEqual([422, "inventory.lot_required"]);
    // Um ajuste também leva lote quando a variante o exige (P1-1).
    expect(
      await codigo(
        s.adm("POST", "/inventory/adjustments", {
          armazem: s.armazem,
          variante: `var_${s.v1}`,
          delta: 1,
          motivo: "achado",
        }),
      ),
    ).toEqual([422, "inventory.lot_required"]);
    await ok(
      s.adm("POST", "/inventory/receipts", {
        armazem: s.armazem,
        linhas: [
          {
            variante: `var_${s.v1}`,
            quantidade: 5,
            lote: { numero: "L-TARDE", validade: "2027-06-30" },
          },
          {
            variante: `var_${s.v1}`,
            quantidade: 5,
            lote: { numero: "L-CEDO", validade: "2026-12-31" },
          },
        ],
      }),
      201,
    );
    const e = await paga(s, [[s.v1, 2]]);
    const v = await ok(s.adm("GET", `/fulfilment/orders/${e.encomenda}`));
    const linha = (v["linhas"] as Json[])[0] as Json;
    const x = await ok(
      s.adm("POST", `/orders/${e.encomenda}/shipments`, {
        linhas: [{ linha: linha["id"], quantidade: 2 }],
      }),
      201,
    );
    await ok(
      s.adm("PATCH", `/shipments/${String(x["id"])}`, {
        versao: 1,
        estado: "expedida",
      }),
    );
    const movs = (
      await ok(s.adm("GET", `/inventory/movements?encomenda=${e.encomenda}`))
    )["dados"] as Json[];
    const saida = movs.find((m) => m["tipo"] === "saida") as Json;
    const lotes = (await ok(s.adm("GET", `/lots?variante=var_${s.v1}`)))[
      "dados"
    ] as Json[];
    const cedo = lotes.find((l) => l["numero"] === "L-CEDO") as Json;
    expect(saida).toMatchObject({
      lote: cedo["id"],
      quantidade: 2,
      expedicao: x["id"],
    });
    const inv = (
      (await ok(s.adm("GET", `/inventory?variante=var_${s.v1}`)))[
        "dados"
      ] as Json[]
    )[0] as Json;
    expect(
      (inv["lotes"] as Json[]).map((l) => [l["numero"], l["fisico"]]).sort(),
    ).toEqual([
      ["L-CEDO", 3],
      ["L-TARDE", 5],
    ]);
  });

  it("a expedição: a vista do armazém sem dados de faturação; parcial, total, entregue e concluída aos 14 dias", async () => {
    const s = await cenario();
    const e = await paga(s, [
      [s.v1, 2],
      [s.v2, 2],
    ]);
    // Uma chave só de expedição (o papel do armazém): vê a vista, não a encomenda.
    const armazem = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Armazém",
        ambitos: ["fulfilment:read", "fulfilment:write", "inventory:read"],
      })
    ).segredo;
    const arm = (m: "GET" | "POST" | "PATCH", url: string, corpo?: unknown) =>
      pedir(m, url, corpo, { authorization: `Bearer ${armazem}` });
    expect(await codigo(arm("GET", `/orders/${e.encomenda}`))).toEqual([
      403,
      "auth.forbidden",
    ]);
    const v = await ok(arm("GET", `/fulfilment/orders/${e.encomenda}`));
    expect(v).toMatchObject({
      estado: "paga",
      destinatario: { nome: "Rui" },
      entrega: { pais: "PT" },
    });
    const texto = JSON.stringify(v);
    expect(texto).not.toContain("rui@exemplo.pt");
    expect(texto).not.toContain("perfil");
    expect(texto).not.toContain("preco");
    const [l1, l2] = v["linhas"] as Json[];
    // Mais do que falta: recusado.
    expect(
      await codigo(
        arm("POST", `/orders/${e.encomenda}/shipments`, {
          linhas: [{ linha: l1?.["id"], quantidade: 3 }],
        }),
      ),
    ).toEqual([422, "shipments.quantity_exceeded"]);
    const x1 = await ok(
      arm("POST", `/orders/${e.encomenda}/shipments`, {
        linhas: [{ linha: l1?.["id"], quantidade: 2 }],
        transportadora: "CTT",
        servico: "Expresso",
      }),
      201,
    );
    await ok(
      arm("PATCH", `/shipments/${String(x1["id"])}`, {
        versao: 1,
        estado: "expedida",
        seguimento: "RR123456789PT",
      }),
    );
    expect((await ok(s.adm("GET", `/orders/${e.encomenda}`)))["estado"]).toBe(
      "expedida_parcial",
    );
    const x2 = await ok(
      arm("POST", `/orders/${e.encomenda}/shipments`, {
        linhas: [{ linha: l2?.["id"], quantidade: 2 }],
      }),
      201,
    );
    await ok(
      arm("PATCH", `/shipments/${String(x2["id"])}`, {
        versao: 1,
        estado: "expedida",
      }),
    );
    expect((await ok(s.adm("GET", `/orders/${e.encomenda}`)))["estado"]).toBe(
      "expedida",
    );
    await ok(
      arm("PATCH", `/shipments/${String(x1["id"])}`, {
        versao: 2,
        estado: "entregue",
      }),
    );
    expect((await ok(s.adm("GET", `/orders/${e.encomenda}`)))["estado"]).toBe(
      "expedida",
    );
    await ok(
      arm("PATCH", `/shipments/${String(x2["id"])}`, {
        versao: 2,
        estado: "entregue",
      }),
    );
    expect((await ok(s.adm("GET", `/orders/${e.encomenda}`)))["estado"]).toBe(
      "entregue",
    );
    // Uma expedição entregue não volta atrás.
    expect(
      await codigo(
        arm("PATCH", `/shipments/${String(x2["id"])}`, {
          versao: 3,
          estado: "perdida",
        }),
      ),
    ).toEqual([409, "shipments.immutable"]);
    // Concluída 14 dias depois de entregue.
    expect(await correrConclusoes(base.api)).toBe(0);
    await sql`update tarefa_encomenda set quando = now() - interval '1 minute'
      where comerciante_id = ${s.c}::uuid`.execute(base.dono);
    expect(await correrConclusoes(base.api)).toBe(1);
    const linha = (await ok(s.adm("GET", `/orders/${e.encomenda}/timeline`)))[
      "dados"
    ] as Json[];
    expect(linha.map((t) => t["para"])).toEqual([
      "a_aguardar_pagamento",
      "paga",
      "em_preparacao",
      "expedida_parcial",
      "expedida",
      "entregue",
      "concluida",
    ]);
    // As seis respostas do rasto (docs/28 §1; #322, passo 4): a primeira
    // transição veio da API, por uma chave, sem IA declarada nem pessoa a
    // autorizar.
    expect(linha[0]).toMatchObject({
      canal: "api",
      ia: {
        prova: "desconhecido",
        fornecedor: null,
        modelo: null,
        execucao: null,
      },
      autorizado_por: null,
    });
    expect(typeof linha[0]?.["pedido"]).toBe("string");
    for (const t of linha) {
      expect(Object.keys(t)).toEqual(
        expect.arrayContaining([
          "canal",
          "pedido",
          "ia",
          "autorizado_por",
          "motivo",
        ]),
      );
    }
    expect(await eventos(s)).toEqual(
      expect.arrayContaining([
        "order.preparing",
        "order.partially_shipped",
        "order.shipped",
        "order.delivered",
        "order.completed",
        "inventory.dispatched",
      ]),
    );
  });

  it("uma encomenda por pagar não se expede; e o vizinho não vê o stock nem os armazéns", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    const v = await ok(s.adm("GET", `/orders/${String(e["encomenda"])}`));
    const linha = (v["linhas"] as Json[])[0] as Json;
    expect(
      await codigo(
        s.adm("POST", `/orders/${String(e["encomenda"])}/shipments`, {
          linhas: [{ linha: linha["id"], quantidade: 1 }],
        }),
      ),
    ).toEqual([409, "orders.invalid_transition"]);
    const vizinho = await cenario();
    expect(
      ((await ok(vizinho.adm("GET", "/warehouses")))["dados"] as Json[]).map(
        (w) => w["id"],
      ),
    ).toEqual([vizinho.armazem]);
    expect(
      await codigo(
        vizinho.adm("POST", "/inventory/receipts", {
          armazem: s.armazem,
          linhas: [{ variante: `var_${s.v1}`, quantidade: 1 }],
        }),
      ),
    ).toEqual([404, "inventory.not_found"]);
  });

  it("vende sem stock: reserva acima do físico; o reservado pode passar o físico", async () => {
    const s = await cenario();
    await ok(
      pedir(
        "PUT",
        `/variants/var_${s.v2}/stock-policy`,
        { politica: "vende_sem_stock", exige_lote: false },
        { authorization: `Bearer ${s.servidor}` },
      ),
      204,
    );
    await ok(
      s.adm("POST", "/inventory/adjustments", {
        armazem: s.armazem,
        variante: `var_${s.v2}`,
        delta: -100,
        motivo: "esgotado",
      }),
      201,
    );
    const k = await checkoutCom(s, [[s.v2, 3]]);
    await preencher(s, k.token);
    await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    expect(await saldo(s, s.v2)).toEqual({
      fisico: 0,
      reservado: 3,
      disponivel: -3,
    });
  });

  it("uma expedição criada cancela-se: as linhas voltam a estar por expedir e a reserva fica", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 2]]);
    const v = await ok(s.adm("GET", `/fulfilment/orders/${e.encomenda}`));
    const linha = (v["linhas"] as Json[])[0] as Json;
    const x = await ok(
      s.adm("POST", `/orders/${e.encomenda}/shipments`, {
        linhas: [{ linha: linha["id"], quantidade: 2 }],
      }),
      201,
    );
    // Tudo atribuído: outra expedição não cabe.
    expect(
      await codigo(
        s.adm("POST", `/orders/${e.encomenda}/shipments`, {
          linhas: [{ linha: linha["id"], quantidade: 1 }],
        }),
      ),
    ).toEqual([422, "shipments.quantity_exceeded"]);
    await ok(
      s.adm("PATCH", `/shipments/${String(x["id"])}`, {
        versao: 1,
        estado: "cancelada",
      }),
    );
    // Cancelada não volta atrás nem sai.
    expect(
      await codigo(
        s.adm("PATCH", `/shipments/${String(x["id"])}`, {
          versao: 2,
          estado: "expedida",
        }),
      ),
    ).toEqual([409, "shipments.immutable"]);
    expect(await saldo(s, s.v1)).toEqual({
      fisico: 100,
      reservado: 2,
      disponivel: 98,
    });
    // As linhas voltam a estar por expedir: uma expedição nova sai.
    const x2 = await ok(
      s.adm("POST", `/orders/${e.encomenda}/shipments`, {
        linhas: [{ linha: linha["id"], quantidade: 2 }],
      }),
      201,
    );
    await ok(
      s.adm("PATCH", `/shipments/${String(x2["id"])}`, {
        versao: 1,
        estado: "expedida",
      }),
    );
    expect((await ok(s.adm("GET", `/orders/${e.encomenda}`)))["estado"]).toBe(
      "expedida",
    );
    expect(await saldo(s, s.v1)).toEqual({
      fisico: 98,
      reservado: 0,
      disponivel: 98,
    });
    const tipos = await eventos(s);
    expect(tipos).toContain("shipment.created");
    expect(tipos).toContain("shipment.cancelled");
    expect(tipos).toContain("shipment.dispatched");
  });

  it("a política: não deixa de controlar com reservas; só quem tem inventory:policy a muda", async () => {
    const s = await cenario();
    await paga(s, [[s.v1, 2]]);
    expect(
      await codigo(
        s.adm("PUT", `/variants/var_${s.v1}/stock-policy`, {
          politica: "nao_controla",
          exige_lote: false,
        }),
      ),
    ).toEqual([409, "inventory.policy_blocked"]);
    // O papel do armazém mexe no stock, não na política (revisão do #296, P2-9).
    const armazem = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Armazém",
        ambitos: [
          "fulfilment:read",
          "fulfilment:write",
          "inventory:read",
          "inventory:write",
        ],
      })
    ).segredo;
    expect(
      await codigo(
        pedir(
          "PUT",
          `/variants/var_${s.v2}/stock-policy`,
          { politica: "vende_sem_stock", exige_lote: false },
          { authorization: `Bearer ${armazem}` },
        ),
      ),
    ).toEqual([403, "auth.forbidden"]);
    // A política ficou como estava.
    const politica = await naBase(s, (trx) =>
      trx
        .selectFrom("politica_stock")
        .select(["politica", "actualizado_por"])
        .where("variante_id", "=", s.v1)
        .executeTakeFirst(),
    );
    expect(politica).toBeUndefined();
  });

  it("a vista do armazém não mostra uma encomenda por pagar", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    expect(
      (
        await codigo(
          s.adm("GET", `/fulfilment/orders/${String(e["encomenda"])}`),
        )
      )[0],
    ).toBe(404);
  });

  it("lotes: outra validade para o mesmo lote recusa; um lote fora de validade não sai", async () => {
    const s = await cenario();
    await ok(
      s.adm("POST", "/inventory/adjustments", {
        armazem: s.armazem,
        variante: `var_${s.v1}`,
        delta: -100,
        motivo: "recontagem por lotes",
      }),
      201,
    );
    await ok(
      s.adm("PUT", `/variants/var_${s.v1}/stock-policy`, {
        politica: "controla",
        exige_lote: true,
      }),
      204,
    );
    await ok(
      s.adm("POST", "/inventory/receipts", {
        armazem: s.armazem,
        linhas: [
          {
            variante: `var_${s.v1}`,
            quantidade: 5,
            lote: { numero: "L-VELHO", validade: "2020-01-31" },
          },
          {
            variante: `var_${s.v1}`,
            quantidade: 5,
            lote: { numero: "L-BOM", validade: "2099-12-31" },
          },
        ],
      }),
      201,
    );
    expect(
      await codigo(
        s.adm("POST", "/inventory/receipts", {
          armazem: s.armazem,
          linhas: [
            {
              variante: `var_${s.v1}`,
              quantidade: 1,
              lote: { numero: "L-BOM", validade: "2098-01-01" },
            },
          ],
        }),
      ),
    ).toEqual([400, "inventory.invalid_field"]);
    // Com lotes, deixar de exigir lote recusa.
    expect(
      await codigo(
        s.adm("PUT", `/variants/var_${s.v1}/stock-policy`, {
          politica: "controla",
          exige_lote: false,
        }),
      ),
    ).toEqual([409, "inventory.policy_blocked"]);
    const e = await paga(s, [[s.v1, 2]]);
    const v = await ok(s.adm("GET", `/fulfilment/orders/${e.encomenda}`));
    const linha = (v["linhas"] as Json[])[0] as Json;
    const x = await ok(
      s.adm("POST", `/orders/${e.encomenda}/shipments`, {
        linhas: [{ linha: linha["id"], quantidade: 2 }],
      }),
      201,
    );
    await ok(
      s.adm("PATCH", `/shipments/${String(x["id"])}`, {
        versao: 1,
        estado: "expedida",
      }),
    );
    const lotes = (await ok(s.adm("GET", `/lots?variante=var_${s.v1}`)))[
      "dados"
    ] as Json[];
    const bom = lotes.find((l) => l["numero"] === "L-BOM") as Json;
    const movs = (
      await ok(s.adm("GET", `/inventory/movements?encomenda=${e.encomenda}`))
    )["dados"] as Json[];
    expect(movs.find((m) => m["tipo"] === "saida")).toMatchObject({
      lote: bom["id"],
      quantidade: 2,
    });
  });

  it("um armazém arquivado não recebe stock", async () => {
    const s = await cenario();
    const outra = await criarLoja(base.api, s.c, {
      entidade_legal_id: (
        await naBase(s, (trx) =>
          trx
            .selectFrom("loja")
            .select("entidade_legal_id")
            .where("id", "=", s.loja)
            .executeTakeFirstOrThrow(),
        )
      ).entidade_legal_id,
      nome: "Segunda loja",
    });
    const a = await ok(
      s.adm("POST", "/warehouses", { loja: `sto_${outra}`, nome: "Velho" }),
      201,
    );
    await ok(
      s.adm("PATCH", `/warehouses/${String(a["id"])}`, {
        versao: 1,
        arquivar: true,
      }),
    );
    expect(
      await codigo(
        s.adm("POST", "/inventory/receipts", {
          armazem: a["id"],
          linhas: [{ variante: `var_${s.v1}`, quantidade: 1 }],
        }),
      ),
    ).toEqual([422, "inventory.no_warehouse"]);
  });
});
