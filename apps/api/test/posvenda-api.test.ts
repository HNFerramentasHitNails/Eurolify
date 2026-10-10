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

// A pós-venda pela API (docs/30; migração 0052): o botão de livre
// resolução, a devolução até à inspecção e ao stock, a decisão e o
// reembolso manual, a nota de crédito pelo circuito dos documentos e o
// cancelamento de uma encomenda paga. O emissor é o de ensaio.

type Json = Record<string, unknown>;
const QUEM = "pessoa:teste";

describe.skipIf(URL_BASE === undefined)("API da pós-venda", () => {
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
          "customers:billing",
          "customers:exemptions",
          "returns:read",
          "returns:write",
          "refunds:read",
          "refunds:write",
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
    faturacao: Json | null = null,
    versoes: string[] = s.versoes,
  ) {
    const k = await checkoutCom(s, linhas);
    await preencher(s, k.token, undefined, nif);
    if (faturacao !== null) {
      await ok(pedir("PUT", `/checkout/${k.token}/billing`, faturacao));
    }
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes }),
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

  /** Traz para agora a próxima tentativa dos incertos (o emissor teve tempo). */
  const adiantar = (s: Cenario) =>
    sql`update documento_fiscal set proxima_em = now() - interval '1 minute'
      where comerciante_id = ${s.c}::uuid
        and estado in ('a_verificar', 'pronto', 'rascunho', 'incerto')
        and proxima_em < '9000-01-01'`.execute(base.dono);

  /** Corre a tarefa até o documento parar (no máximo 4 voltas). */
  const ateParar = async () => {
    for (let i = 0; i < 4; i++) {
      const r = await correr();
      expect(r.erros).toEqual([]);
      if (r.passos === 0) break;
    }
  };

  /** Os documentos da encomenda, por tipo (a fatura e as NC). */
  const documentosDe = async (s: Cenario, encomenda: string) => {
    const lista = (await ok(s.adm("GET", `/invoices?encomenda=${encomenda}`)))[
      "dados"
    ] as Json[];
    const todos = await Promise.all(
      lista.map((d) => ok(s.adm("GET", `/invoices/${String(d["id"])}`))),
    );
    return {
      fatura: todos.find((d) => d["tipo"] === "fatura") ?? null,
      notas: todos.filter((d) => d["tipo"] === "nota_credito"),
    };
  };

  /** Expede tudo numa expedição e, por omissão, entrega-a. */
  async function expedir(s: Cenario, encomenda: string, entregar = true) {
    const enc = await ok(s.adm("GET", `/orders/${encomenda}`));
    const x = await ok(
      s.adm("POST", `/orders/${encomenda}/shipments`, {
        linhas: (enc["linhas"] as Json[]).map((l) => ({
          linha: l["id"],
          quantidade: l["quantidade"],
        })),
      }),
      201,
    );
    await ok(
      s.adm("PATCH", `/shipments/${String(x["id"])}`, {
        versao: 1,
        estado: "expedida",
      }),
    );
    if (entregar) {
      await ok(
        s.adm("PATCH", `/shipments/${String(x["id"])}`, {
          versao: 2,
          estado: "entregue",
        }),
      );
    }
    return enc["linhas"] as Json[];
  }

  /** A entrega passa para há `dias` dias (o relógio do prazo). */
  const entregueHa = (encomenda: string, dias: number) =>
    base.dono.transaction().execute(async (t) => {
      await sql`alter table expedicao disable trigger expedicao_antes_de_gravar`.execute(
        t,
      );
      await sql`update expedicao set entregue_em = now() - make_interval(days => ${dias})
        where encomenda_id = ${encomenda.slice(4)}::uuid and estado = 'entregue'`.execute(
        t,
      );
      await sql`alter table expedicao enable always trigger expedicao_antes_de_gravar`.execute(
        t,
      );
    });

  const fisico = async (s: Cenario, v: string) => {
    const inv = (
      (await ok(s.adm("GET", `/inventory?variante=var_${v}`)))[
        "dados"
      ] as Json[]
    )[0] as Json;
    return [inv["fisico"], inv["reservado"]];
  };

  const estadoDoPagamento = (s: Cenario, encomenda: string) =>
    naBase(
      s,
      async (trx) =>
        (
          await trx
            .selectFrom("pagamento")
            .select("estado")
            .where("encomenda_id", "=", encomenda.slice(4))
            .orderBy("id")
            .executeTakeFirstOrThrow()
        ).estado,
    );

  /** Pede pelo botão, recebe e inspecciona tudo como revendável. */
  async function devolvidaEInspeccionada(
    s: Cenario,
    token: string,
    linhas: { linha: unknown; quantidade: number }[],
  ) {
    const w = await ok(
      pedir("POST", `/store/orders/${token}/withdrawal`, { linhas }),
      201,
    );
    const p = await ok(s.adm("GET", `/withdrawals/${String(w["pedido"])}`));
    const rma = String(p["devolucao"]);
    await ok(
      s.adm("POST", `/returns/${rma}/receive`, {
        versao: 1,
        linhas: linhas.map((l) => ({ linha: l.linha, recebida: l.quantidade })),
      }),
    );
    await ok(
      s.adm("POST", `/returns/${rma}/inspect`, {
        versao: 2,
        linhas: linhas.map((l) => ({
          linha: l.linha,
          estado_artigo: "revendavel",
          aceite: l.quantidade,
        })),
      }),
    );
    return rma;
  }

  it("o botão: dentro do prazo regista, confirma com data e hora e abre a devolução; sem dados pessoais", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 2]]);
    // Antes de expedir não há nada a devolver.
    let v = await ok(pedir("GET", `/store/orders/${e.token}/withdrawal`));
    expect(v).toMatchObject({
      encomenda: e.encomenda,
      consumidor: true,
      linhas: [],
    });
    const [linha] = await expedir(s, e.encomenda);
    v = await ok(pedir("GET", `/store/orders/${e.token}/withdrawal`));
    const hoje = new Date();
    const prazo = new Date(hoje.getTime() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(v["linhas"]).toEqual([
      expect.objectContaining({
        linha: linha?.["id"],
        disponivel: 2,
        dentro_do_prazo: true,
        prazo_ate: prazo,
      }),
    ]);
    expect(JSON.stringify(v)).not.toContain("rui@exemplo.pt");
    // Mais do que se expediu: recusado.
    expect(
      await codigo(
        pedir("POST", `/store/orders/${e.token}/withdrawal`, {
          linhas: [{ linha: linha?.["id"], quantidade: 3 }],
        }),
      ),
    ).toEqual([422, "returns.quantity_exceeded"]);
    const w = await ok(
      pedir("POST", `/store/orders/${e.token}/withdrawal`, {
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
      }),
      201,
    );
    expect(w).toMatchObject({
      estado: "aceite",
      confirmacao: {
        encomenda: e.encomenda,
        dentro_do_prazo: true,
        linhas: [{ linha: linha?.["id"], sku: "GEL-001", quantidade: 1 }],
      },
    });
    expect(String((w["confirmacao"] as Json)["recebido_em"]).slice(0, 10)).toBe(
      hoje.toISOString().slice(0, 10),
    );
    const p = await ok(s.adm("GET", `/withdrawals/${String(w["pedido"])}`));
    expect(p).toMatchObject({
      origem: "botao",
      contacto: "rui@exemplo.pt",
      estado: "aceite",
    });
    const d = await ok(s.adm("GET", `/returns/${String(p["devolucao"])}`));
    expect(d).toMatchObject({
      origem: "livre_resolucao",
      estado: "a_aguardar",
      pedido: w["pedido"],
      linhas: [{ linha: linha?.["id"], pedida: 1, recebida: null }],
      reembolsar_ate: prazo,
      dias_para_reembolsar: 14,
    });
    // Sobra 1 para devolver; o que já foi pedido não se pede outra vez.
    v = await ok(pedir("GET", `/store/orders/${e.token}/withdrawal`));
    expect((v["linhas"] as Json[])[0]?.["disponivel"]).toBe(1);
    // A ligação passa os 30 dias da confirmação e o botão continua (o
    // direito conta da entrega, não da ligação).
    await base.dono.transaction().execute(async (trx) => {
      await sql`alter table sessao_checkout disable trigger sessao_checkout_antes_de_gravar`.execute(
        trx,
      );
      await sql`update sessao_checkout set concluida_em = now() - interval '40 days'
        where id = ${e.sessao.slice(4)}::uuid`.execute(trx);
      await sql`alter table sessao_checkout enable always trigger sessao_checkout_antes_de_gravar`.execute(
        trx,
      );
    });
    expect(
      await codigo(pedir("GET", `/checkout/${e.token}/confirmation`)),
    ).toEqual([410, "checkout.expired"]);
    await ok(pedir("GET", `/store/orders/${e.token}/withdrawal`));
    expect(await eventos(s)).toEqual(
      expect.arrayContaining(["withdrawal.requested", "return.created"]),
    );
  });

  it("fora do prazo fica registado e uma pessoa decide; um profissional é mandado para o apoio (Q1)", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 1]]);
    const [linha] = await expedir(s, e.encomenda);
    await entregueHa(e.encomenda, 20);
    const v = await ok(pedir("GET", `/store/orders/${e.token}/withdrawal`));
    expect((v["linhas"] as Json[])[0]).toMatchObject({
      dentro_do_prazo: false,
    });
    const w = await ok(
      pedir("POST", `/store/orders/${e.token}/withdrawal`, {
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
      }),
      201,
    );
    expect(w).toMatchObject({
      estado: "fora_de_prazo",
      confirmacao: { dentro_do_prazo: false },
    });
    let p = await ok(s.adm("GET", `/withdrawals/${String(w["pedido"])}`));
    expect(p["devolucao"]).toBeNull();
    // Sem motivo, não se decide.
    expect(
      await codigo(
        s.adm("POST", `/withdrawals/${String(w["pedido"])}/decide`, {
          versao: 1,
          decisao: "aceitar",
        }),
      ),
    ).toEqual([400, "request.invalid"]);
    const r = await ok(
      s.adm("POST", `/withdrawals/${String(w["pedido"])}/decide`, {
        versao: 1,
        decisao: "aceitar",
        motivo: "o transportador atrasou a recolha",
      }),
    );
    expect(String(r["devolucao"])).toMatch(/^rma_/);
    p = await ok(s.adm("GET", `/withdrawals/${String(w["pedido"])}`));
    expect(p).toMatchObject({
      estado: "aceite",
      motivo_decisao: "o transportador atrasou a recolha",
      devolucao: r["devolucao"],
    });
    // Decidido não se decide outra vez.
    expect(
      await codigo(
        s.adm("POST", `/withdrawals/${String(w["pedido"])}/decide`, {
          versao: 2,
          decisao: "recusar",
          motivo: "engano",
        }),
      ),
    ).toEqual([409, "returns.invalid_transition"]);

    // Um profissional: o botão recusa e o apoio regista. A loja publica as
    // condições gerais e a privacidade para profissionais.
    const profissionais: string[] = [];
    for (const tipo of ["condicoes_gerais", "privacidade"]) {
      const t = await ok(
        s.adm("POST", "/legal-texts", {
          loja: `sto_${s.loja}`,
          tipo,
          pais: "PT",
          lingua: "pt",
          tipo_cliente: "profissional",
        }),
        201,
      );
      const v = await ok(
        s.adm("POST", `/legal-texts/${String(t["id"])}/versions`, {
          texto: `Texto de ${tipo} para profissionais.`,
        }),
        201,
      );
      await ok(
        s.adm(
          "POST",
          `/legal-texts/${String(t["id"])}/versions/${String(v["id"])}/publish`,
        ),
      );
      profissionais.push(String(v["id"]));
    }
    const prof = await paga(
      s,
      [[s.v1, 1]],
      null,
      {
        finalidade: "profissional",
        tipo: "empresa",
        nome_documento: "Rui, Lda",
        nif: "513207384",
      },
      profissionais,
    );
    const [lp] = await expedir(s, prof.encomenda);
    expect(
      (await ok(pedir("GET", `/store/orders/${prof.token}/withdrawal`)))[
        "consumidor"
      ],
    ).toBe(false);
    expect(
      await codigo(
        pedir("POST", `/store/orders/${prof.token}/withdrawal`, {
          linhas: [{ linha: lp?.["id"], quantidade: 1 }],
        }),
      ),
    ).toEqual([422, "returns.not_consumer"]);
    const a = await ok(
      s.adm("POST", "/withdrawals", {
        encomenda: prof.encomenda,
        linhas: [{ linha: lp?.["id"], quantidade: 1 }],
      }),
      201,
    );
    expect(a).toMatchObject({ estado: "aceite" });
    expect(String(a["devolucao"])).toMatch(/^rma_/);
  });

  it("devolução parcial: só o revendável aceite volta a stock; a decisão reembolsa o que se pagou pela linha; o manual fecha", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 3]]);
    const [linha] = await expedir(s, e.encomenda);
    expect(await fisico(s, s.v1)).toEqual([97, 0]);
    const w = await ok(
      pedir("POST", `/store/orders/${e.token}/withdrawal`, {
        linhas: [{ linha: linha?.["id"], quantidade: 3 }],
      }),
      201,
    );
    const rma = String(
      (await ok(s.adm("GET", `/withdrawals/${String(w["pedido"])}`)))[
        "devolucao"
      ],
    );
    // Não se decide antes da inspecção (Q3).
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/decide`, {
          versao: 1,
          linhas: [{ linha: linha?.["id"], quantidade: 1 }],
          motivo: "cedo",
        }),
      ),
    ).toEqual([409, "returns.invalid_transition"]);
    await ok(
      s.adm("POST", `/returns/${rma}/receive`, {
        versao: 1,
        linhas: [{ linha: linha?.["id"], recebida: 3 }],
        transportadora: "CTT",
      }),
    );
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/receive`, { versao: 2, linhas: [] }),
      ),
    ).toEqual([409, "returns.invalid_transition"]);
    // Aberto não volta a stock (Q5); não se aceita mais do que chegou.
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/inspect`, {
          versao: 2,
          linhas: [
            { linha: linha?.["id"], estado_artigo: "aberto", aceite: 1 },
          ],
        }),
      ),
    ).toEqual([400, "returns.invalid_field"]);
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/inspect`, {
          versao: 2,
          linhas: [
            { linha: linha?.["id"], estado_artigo: "revendavel", aceite: 4 },
          ],
        }),
      ),
    ).toEqual([422, "returns.quantity_exceeded"]);
    await ok(
      s.adm("POST", `/returns/${rma}/inspect`, {
        versao: 2,
        linhas: [
          { linha: linha?.["id"], estado_artigo: "revendavel", aceite: 2 },
        ],
      }),
    );
    expect(await fisico(s, s.v1)).toEqual([99, 0]);
    const movs = (
      await ok(s.adm("GET", `/inventory/movements?encomenda=${e.encomenda}`))
    )["dados"] as Json[];
    expect(movs.find((m) => m["tipo"] === "devolucao")).toMatchObject({
      quantidade: 2,
      origem: "devolucao",
    });
    // Não se reembolsa mais do que voltou.
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/decide`, {
          versao: 3,
          linhas: [{ linha: linha?.["id"], quantidade: 4 }],
          motivo: "devolução",
        }),
      ),
    ).toEqual([422, "refunds.exceeds_paid"]);
    const r = await ok(
      s.adm("POST", `/returns/${rma}/decide`, {
        versao: 3,
        linhas: [{ linha: linha?.["id"], quantidade: 2 }],
        motivo: "dois revendáveis; o aberto não se reembolsa",
      }),
      201,
    );
    // 2 de 3 unidades de 36,90 €: 24,60 €.
    expect(r["montante"]).toBe(2460);
    const rfd = String(r["reembolso"]);
    let x = await ok(s.adm("GET", `/refunds/${rfd}`));
    expect(x).toMatchObject({
      origem: "devolucao",
      devolucao: rma,
      estado: "a_executar",
      via: "manual",
      linhas: [
        { posicao: 1, linha: linha?.["id"], quantidade: 2, montante: 2460 },
      ],
    });
    // O montante transferido tem de ser o do reembolso.
    expect(
      await codigo(
        s.adm("POST", `/refunds/${rfd}/manual`, {
          versao: x["versao"],
          montante: 2000,
          data: "2026-10-10",
          referencia: "TRF-1",
        }),
      ),
    ).toEqual([400, "refunds.invalid_field"]);
    await ok(
      s.adm("POST", `/refunds/${rfd}/manual`, {
        versao: x["versao"],
        montante: 2460,
        data: "2026-10-10",
        referencia: "TRF-1",
      }),
    );
    x = await ok(s.adm("GET", `/refunds/${rfd}`));
    expect(x).toMatchObject({
      estado: "executado",
      prova: { data: "2026-10-10", referencia: "TRF-1" },
    });
    expect(JSON.stringify(x["prova"])).not.toContain("IBAN");
    expect(await estadoDoPagamento(s, e.encomenda)).toBe("reembolsado_parcial");
    // 2 de 3 devolvidas e reembolsadas: a encomenda fica devolvida em parte.
    expect((await ok(s.adm("GET", `/orders/${e.encomenda}`)))["estado"]).toBe(
      "devolvida_parcial",
    );
    expect((await ok(s.adm("GET", `/returns/${rma}`)))["estado"]).toBe(
      "fechada",
    );
    // Executado não se executa outra vez.
    expect(
      await codigo(
        s.adm("POST", `/refunds/${rfd}/manual`, {
          versao: x["versao"],
          montante: 2460,
          data: "2026-10-10",
          referencia: "TRF-2",
        }),
      ),
    ).toEqual([409, "refunds.invalid_transition"]);
    expect(await eventos(s)).toEqual(
      expect.arrayContaining([
        "return.received",
        "return.inspected",
        "return.decided",
        "refund.created",
        "refund.completed",
        "order.partially_returned",
      ]),
    );
  });

  it("um problema reembolsa sem mercadoria de volta; nunca acima do que se pagou nem em duplicado", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 1]]);
    const [linha] = await expedir(s, e.encomenda);
    const prb = await ok(
      s.adm("POST", "/problems", {
        encomenda: e.encomenda,
        tipo: "chegou_danificado",
        descricao: "frasco partido",
      }),
      201,
    );
    expect(
      await codigo(
        s.adm("POST", `/problems/${String(prb["id"])}/decide`, {
          versao: 1,
          linhas: [{ linha: linha?.["id"], quantidade: 2 }],
          motivo: "a mais",
        }),
      ),
    ).toEqual([422, "refunds.exceeds_paid"]);
    // A mesma decisão repetida (a mesma chave de idempotência): o mesmo
    // reembolso, nunca dois.
    const chave = randomUUID();
    const decidir = () =>
      pedir(
        "POST",
        `/problems/${String(prb["id"])}/decide`,
        {
          versao: 1,
          linhas: [{ linha: linha?.["id"], quantidade: 1 }],
          incluir_portes: true,
          motivo: "chegou partido",
        },
        { authorization: `Bearer ${s.servidor}`, "idempotency-key": chave },
      );
    const r1 = await ok(decidir(), 201);
    const r2 = await ok(decidir(), 201);
    expect(r2["reembolso"]).toBe(r1["reembolso"]);
    // 12,30 € do artigo e 4,99 € dos portes.
    expect(r1["montante"]).toBe(1230 + 499);
    expect(
      (
        (await ok(s.adm("GET", `/refunds?encomenda=${e.encomenda}`)))[
          "dados"
        ] as Json[]
      ).length,
    ).toBe(1);
    const x = await ok(s.adm("GET", `/refunds/${String(r1["reembolso"])}`));
    expect(x["linhas"]).toEqual([
      expect.objectContaining({ posicao: 1, portes: false, montante: 1230 }),
      expect.objectContaining({ posicao: 2, portes: true, montante: 499 }),
    ]);
    expect(
      (await ok(s.adm("GET", `/problems/${String(prb["id"])}`)))["estado"],
    ).toBe("decidido");
    // Outro problema na mesma linha já reembolsada: recusado.
    const outro = await ok(
      s.adm("POST", "/problems", {
        encomenda: e.encomenda,
        tipo: "outro",
        descricao: "outra vez",
      }),
      201,
    );
    expect(
      await codigo(
        s.adm("POST", `/problems/${String(outro["id"])}/decide`, {
          versao: 1,
          linhas: [{ linha: linha?.["id"], quantidade: 1 }],
          motivo: "duplicado",
        }),
      ),
    ).toEqual([422, "refunds.exceeds_paid"]);
    // Nem os portes outra vez: nada a reembolsar.
    expect(
      await codigo(
        s.adm("POST", `/problems/${String(outro["id"])}/decide`, {
          versao: 1,
          linhas: [],
          incluir_portes: true,
          motivo: "portes outra vez",
        }),
      ),
    ).toEqual([400, "refunds.invalid_field"]);
    // A base recusa um reembolso acima do pagamento, mesmo escrito à mão.
    const pag = await naBase(s, (trx) =>
      trx
        .selectFrom("pagamento")
        .select("id")
        .where("encomenda_id", "=", e.encomenda.slice(4))
        .executeTakeFirstOrThrow(),
    );
    await expect(
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        const { id } = await trx
          .insertInto("reembolso")
          .values({
            comerciante_id: s.c,
            encomenda_id: e.encomenda.slice(4),
            pagamento_id: pag.id,
            origem: "problema",
            problema_id: String(outro["id"]).slice(4),
            montante: 1,
            moeda: "EUR",
            via: "manual",
            decidido_por: "pessoa:teste",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("linha_reembolso")
          .values({
            reembolso_id: id,
            comerciante_id: s.c,
            posicao: 1,
            linha_encomenda_id: null,
            quantidade: 1,
            montante: 1,
          })
          .execute();
        await trx
          .updateTable("reembolso")
          .set({ estado: "a_executar", versao: 2 })
          .where("id", "=", id)
          .execute();
      }),
    ).rejects.toThrow(/refunds\.exceeds_paid/);
  });

  it("a nota de crédito: sai pelo circuito dos documentos com a taxa da fatura, parcial, e a fatura mostra o saldo", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    const e = await paga(s, [[s.v1, 2]], "501964843");
    await ateParar();
    const [linha] = await expedir(s, e.encomenda);
    const rma = await devolvidaEInspeccionada(s, e.token, [
      { linha: linha?.["id"], quantidade: 1 },
    ]);
    const r = await ok(
      s.adm("POST", `/returns/${rma}/decide`, {
        versao: 3,
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
        motivo: "livre resolução",
      }),
      201,
    );
    expect(String(r["nota_credito"])).toMatch(/^inv_/);
    await ateParar();
    const { fatura, notas } = await documentosDe(s, e.encomenda);
    expect(fatura?.["estado"]).toBe("emitido");
    expect(notas).toHaveLength(1);
    const nc = notas[0] as Json;
    expect(nc).toMatchObject({
      estado: "emitido",
      original: fatura?.["id"],
      reembolso: r["reembolso"],
    });
    expect((nc["prova"] as Json)["numero"]).toMatch(/^NC /);
    const conteudo = ((nc["conteudos"] as Json[])[0] as Json)[
      "conteudo"
    ] as Json;
    // A taxa e a proporção da fatura: 12,30 € = 10,00 € + 2,30 € de IVA.
    expect(conteudo).toMatchObject({
      tipo: "nota_credito",
      original: fatura?.["id"],
      totais: { base: 1000, iva: 230, total: 1230 },
    });
    expect(fatura).toMatchObject({
      notas_credito: [expect.objectContaining({ id: nc["id"], total: 1230 })],
      saldo: 2 * 1230 + 499 - 1230,
    });
    expect(await eventos(s)).toContain("invoice.issued");
    // Reembolsadas as duas unidades, a encomenda fica devolvida.
    const manual = async (rfd: string) => {
      const x = await ok(s.adm("GET", `/refunds/${rfd}`));
      await ok(
        s.adm("POST", `/refunds/${rfd}/manual`, {
          versao: x["versao"],
          montante: x["montante"],
          data: "2026-10-10",
          referencia: `TRF-${rfd.slice(-6)}`,
        }),
      );
    };
    await manual(String(r["reembolso"]));
    expect((await ok(s.adm("GET", `/orders/${e.encomenda}`)))["estado"]).toBe(
      "devolvida_parcial",
    );
    const rma2 = await devolvidaEInspeccionada(s, e.token, [
      { linha: linha?.["id"], quantidade: 1 },
    ]);
    const r2 = await ok(
      s.adm("POST", `/returns/${rma2}/decide`, {
        versao: 3,
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
        incluir_portes: true,
        motivo: "livre resolução: a entrega inicial reembolsa-se (Q4)",
      }),
      201,
    );
    expect(r2["montante"]).toBe(1230 + 499);
    await manual(String(r2["reembolso"]));
    expect((await ok(s.adm("GET", `/orders/${e.encomenda}`)))["estado"]).toBe(
      "devolvida",
    );
    expect(await estadoDoPagamento(s, e.encomenda)).toBe("reembolsado");
    await ateParar();
    const depois = await documentosDe(s, e.encomenda);
    expect(depois.notas.map((n) => n["estado"])).toEqual([
      "emitido",
      "emitido",
    ]);
    expect(depois.fatura?.["saldo"]).toBe(0);
    expect(await eventos(s)).toContain("order.returned");
  });

  it("a nota de crédito espera pela fatura; emitida a fatura, sai a seguir", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    const ligacao = await ligar(s, conta, []);
    const e = await paga(s, [[s.v1, 2]]);
    await ateParar();
    const [linha] = await expedir(s, e.encomenda);
    const rma = await devolvidaEInspeccionada(s, e.token, [
      { linha: linha?.["id"], quantidade: 1 },
    ]);
    await ok(
      s.adm("POST", `/returns/${rma}/decide`, {
        versao: 3,
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
        motivo: "livre resolução",
      }),
      201,
    );
    await ateParar();
    let docs = await documentosDe(s, e.encomenda);
    expect(docs.fatura).toMatchObject({
      estado: "retido",
      motivos: ["taxa_sem_mapa"],
    });
    expect(docs.notas[0]?.["estado"]).toBe("retido");
    expect(docs.notas[0]?.["motivos"]).toContain("original_por_emitir");
    const l = (
      (await ok(s.adm("GET", "/invoicing-connections")))["dados"] as Json[]
    ).find((x) => x["id"] === ligacao) as Json;
    await ok(
      s.adm("PATCH", `/invoicing-connections/${ligacao}`, {
        versao: l["versao"],
        taxas: [{ pais: "PT", taxa: 2300, emissor: "T23" }],
      }),
    );
    await ok(s.adm("POST", `/invoicing-connections/${ligacao}/test`));
    await ok(
      s.adm("POST", `/invoices/${String(docs.fatura?.["id"])}/recheck`, {
        versao: docs.fatura?.["versao"],
      }),
    );
    await ateParar();
    await adiantar(s);
    await ateParar();
    docs = await documentosDe(s, e.encomenda);
    expect(docs.fatura?.["estado"]).toBe("emitido");
    expect(docs.notas[0]?.["estado"]).toBe("emitido");
    expect(docs.fatura?.["saldo"]).toBe(2 * 1230 + 499 - 1230);
  });

  it("cancelar uma encomenda paga não expedida: liberta as reservas, reembolsa tudo e a fatura fica para o contabilista", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    const ligacao = await ligar(s, conta, []);
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    expect(await fisico(s, s.v1)).toEqual([100, 1]);
    // Sem refunds:write, não se cancela.
    const leitor = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Apoio",
        ambitos: ["returns:read", "returns:write", "refunds:read"],
      })
    ).segredo;
    expect(
      await codigo(
        pedir(
          "POST",
          `/orders/${e.encomenda}/cancel`,
          { motivo: "o cliente desistiu" },
          { authorization: `Bearer ${leitor}` },
        ),
      ),
    ).toEqual([403, "auth.forbidden"]);
    const r = await ok(
      s.adm("POST", `/orders/${e.encomenda}/cancel`, {
        motivo: "o cliente desistiu",
      }),
      201,
    );
    expect(r["montante"]).toBe(1230 + 499);
    expect(String(r["nota_credito"])).toMatch(/^inv_/);
    expect((await ok(s.adm("GET", `/orders/${e.encomenda}`)))["estado"]).toBe(
      "cancelada",
    );
    expect(await fisico(s, s.v1)).toEqual([100, 0]);
    expect(
      await codigo(
        s.adm("POST", `/orders/${e.encomenda}/cancel`, { motivo: "outra vez" }),
      ),
    ).toEqual([409, "returns.invalid_transition"]);
    expect(await eventos(s)).toContain("order.cancelled");
    // Corrigido o mapa, a fatura de uma encomenda reembolsada por inteiro
    // fica retida para o contabilista (C2).
    let docs = await documentosDe(s, e.encomenda);
    const l = (
      (await ok(s.adm("GET", "/invoicing-connections")))["dados"] as Json[]
    ).find((x) => x["id"] === ligacao) as Json;
    await ok(
      s.adm("PATCH", `/invoicing-connections/${ligacao}`, {
        versao: l["versao"],
        taxas: [{ pais: "PT", taxa: 2300, emissor: "T23" }],
      }),
    );
    await ok(s.adm("POST", `/invoicing-connections/${ligacao}/test`));
    await ok(
      s.adm("POST", `/invoices/${String(docs.fatura?.["id"])}/recheck`, {
        versao: docs.fatura?.["versao"],
      }),
    );
    await ateParar();
    docs = await documentosDe(s, e.encomenda);
    expect(docs.fatura).toMatchObject({
      estado: "retido",
      motivos: ["encomenda_reembolsada"],
    });

    // Uma encomenda expedida não se cancela: devolve-se.
    const x = await paga(s, [[s.v1, 1]]);
    await expedir(s, x.encomenda, false);
    expect(
      await codigo(
        s.adm("POST", `/orders/${x.encomenda}/cancel`, { motivo: "tarde" }),
      ),
    ).toEqual([409, "returns.invalid_transition"]);
  });

  it("a base guarda o que o código já confere: pedido a mais, linha acima do pago, cancelar expedida", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 1]]);
    const [linha] = await expedir(s, e.encomenda);
    const enc = e.encomenda.slice(4);
    const lid = String(linha?.["id"]).slice(4);
    // A mesma linha duas vezes no mesmo pedido: recusada antes da base.
    expect(
      await codigo(
        s.adm("POST", "/returns", {
          encomenda: e.encomenda,
          origem: "apoio",
          motivo: "repetida",
          linhas: [
            { linha: linha?.["id"], quantidade: 1 },
            { linha: linha?.["id"], quantidade: 1 },
          ],
        }),
      ),
    ).toEqual([400, "returns.invalid_field"]);
    const comQuem = <T>(
      fn: (trx: Parameters<Parameters<typeof naBase>[1]>[0]) => Promise<T>,
    ) =>
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        return fn(trx);
      });
    const armazem = s.armazem.slice(4);
    // Escrita à mão: por cima de uma devolução já pedida, passa o expedido.
    await ok(
      s.adm("POST", "/returns", {
        encomenda: e.encomenda,
        origem: "apoio",
        motivo: "a primeira",
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
      }),
      201,
    );
    await expect(
      comQuem(async (trx) => {
        const { id } = await trx
          .insertInto("devolucao")
          .values({
            comerciante_id: s.c,
            encomenda_id: enc,
            armazem_id: armazem,
            origem: "apoio",
            criada_por: "pessoa:teste",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("linha_devolucao")
          .values({
            devolucao_id: id,
            comerciante_id: s.c,
            linha_encomenda_id: lid,
            pedida: 1,
          })
          .execute();
      }),
    ).rejects.toThrow(/returns\.quantity_exceeded/);
    // Uma linha acima do que se pagou por ela, mesmo com o total abaixo do
    // pagamento (12,30 € pagos pela linha; 13,00 € pedidos; 17,29 € pagos).
    const pag = await naBase(s, (trx) =>
      trx
        .selectFrom("pagamento")
        .select("id")
        .where("encomenda_id", "=", enc)
        .executeTakeFirstOrThrow(),
    );
    const prb = await ok(
      s.adm("POST", "/problems", {
        encomenda: e.encomenda,
        tipo: "outro",
        descricao: "à mão",
      }),
      201,
    );
    await expect(
      comQuem(async (trx) => {
        const { id } = await trx
          .insertInto("reembolso")
          .values({
            comerciante_id: s.c,
            encomenda_id: enc,
            pagamento_id: pag.id,
            origem: "problema",
            problema_id: String(prb["id"]).slice(4),
            montante: 1300,
            moeda: "EUR",
            via: "manual",
            decidido_por: "pessoa:teste",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("linha_reembolso")
          .values({
            reembolso_id: id,
            comerciante_id: s.c,
            posicao: 1,
            linha_encomenda_id: lid,
            quantidade: 1,
            montante: 1300,
          })
          .execute();
        await trx
          .updateTable("reembolso")
          .set({ estado: "a_executar", versao: 2 })
          .where("id", "=", id)
          .execute();
      }),
    ).rejects.toThrow(/refunds\.exceeds_paid: uma linha/);
    // Com uma expedição em preparação (ainda não saiu), a encomenda em
    // preparação não se cancela: cancela-se primeiro a expedição.
    const outra = await paga(s, [[s.v1, 1]]);
    const lo = (
      (await ok(s.adm("GET", `/orders/${outra.encomenda}`)))["linhas"] as Json[]
    )[0] as Json;
    await ok(
      s.adm("POST", `/orders/${outra.encomenda}/shipments`, {
        linhas: [{ linha: lo["id"], quantidade: 1 }],
      }),
      201,
    );
    expect(
      (await ok(s.adm("GET", `/orders/${outra.encomenda}`)))["estado"],
    ).toBe("em_preparacao");
    expect(
      await codigo(
        s.adm("POST", `/orders/${outra.encomenda}/cancel`, {
          motivo: "desistiu",
        }),
      ),
    ).toEqual([409, "returns.invalid_transition"]);
  });

  it("os âmbitos: o armazém recebe e inspecciona mas não decide reembolsos; o vizinho não vê nada", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 1]]);
    const [linha] = await expedir(s, e.encomenda);
    const armazem = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Armazém",
        ambitos: ["returns:read", "returns:write"],
      })
    ).segredo;
    const arm = (m: "GET" | "POST", url: string, corpo?: unknown) =>
      pedir(m, url, corpo, { authorization: `Bearer ${armazem}` });
    const rma = await ok(
      arm("POST", "/returns", {
        encomenda: e.encomenda,
        origem: "comercial",
        motivo: "troca combinada",
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
      }),
      201,
    );
    const id = String(rma["id"]);
    await ok(
      arm("POST", `/returns/${id}/receive`, {
        versao: 1,
        linhas: [{ linha: linha?.["id"], recebida: 1 }],
      }),
    );
    await ok(
      arm("POST", `/returns/${id}/inspect`, {
        versao: 2,
        linhas: [
          { linha: linha?.["id"], estado_artigo: "danificado", aceite: 0 },
        ],
      }),
    );
    // Danificado: nada volta a stock.
    expect(await fisico(s, s.v1)).toEqual([99, 0]);
    expect(
      await codigo(
        arm("POST", `/returns/${id}/decide`, {
          versao: 3,
          linhas: [{ linha: linha?.["id"], quantidade: 1 }],
          motivo: "x",
        }),
      ),
    ).toEqual([403, "auth.forbidden"]);
    expect(await codigo(arm("GET", "/refunds"))).toEqual([
      403,
      "auth.forbidden",
    ]);
    // Inspeccionada não se cancela.
    expect(
      await codigo(
        arm("POST", `/returns/${id}/cancel`, { versao: 3, motivo: "x" }),
      ),
    ).toEqual([409, "returns.invalid_transition"]);
    // O vizinho: outro comerciante não vê a devolução.
    const vizinho = await cenario();
    expect(await codigo(vizinho.adm("GET", `/returns/${id}`))).toEqual([
      404,
      "returns.not_found",
    ]);
    expect(
      await codigo(
        vizinho.adm("POST", "/problems", {
          encomenda: e.encomenda,
          tipo: "outro",
          descricao: "x",
        }),
      ),
    ).toEqual([404, "returns.not_found"]);
  });

  it("com lotes, o aceite volta ao lote de onde saiu; uma devolução cancelada liberta as linhas", async () => {
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
            quantidade: 1,
            lote: { numero: "L-CEDO", validade: "2026-12-31" },
          },
          {
            variante: `var_${s.v1}`,
            quantidade: 5,
            lote: { numero: "L-TARDE", validade: "2027-06-30" },
          },
        ],
      }),
      201,
    );
    const e = await paga(s, [[s.v1, 3]]);
    const [linha] = await expedir(s, e.encomenda);
    // Saiu 1 do L-CEDO e 2 do L-TARDE.
    const lotes = async () =>
      (
        (
          (
            (await ok(s.adm("GET", `/inventory?variante=var_${s.v1}`)))[
              "dados"
            ] as Json[]
          )[0] as Json
        )["lotes"] as Json[]
      )
        .map((l) => [l["numero"], l["fisico"]])
        .sort();
    expect(await lotes()).toEqual([
      ["L-CEDO", 0],
      ["L-TARDE", 3],
    ]);
    // Uma devolução pedida e cancelada: as linhas voltam a estar livres.
    const rma = await ok(
      s.adm("POST", "/returns", {
        encomenda: e.encomenda,
        origem: "apoio",
        motivo: "combinado ao telefone",
        linhas: [{ linha: linha?.["id"], quantidade: 3 }],
      }),
      201,
    );
    expect(
      await codigo(
        s.adm("POST", "/returns", {
          encomenda: e.encomenda,
          origem: "apoio",
          motivo: "outra",
          linhas: [{ linha: linha?.["id"], quantidade: 1 }],
        }),
      ),
    ).toEqual([422, "returns.quantity_exceeded"]);
    await ok(
      s.adm("POST", `/returns/${String(rma["id"])}/cancel`, {
        versao: 1,
        motivo: "o cliente desistiu",
      }),
    );
    // Pela ordem da saída: o L-CEDO primeiro, depois o L-TARDE.
    await devolvidaEInspeccionada(s, e.token, [
      { linha: linha?.["id"], quantidade: 2 },
    ]);
    expect(await lotes()).toEqual([
      ["L-CEDO", 1],
      ["L-TARDE", 4],
    ]);
    const movs = (
      (await ok(s.adm("GET", `/inventory/movements?encomenda=${e.encomenda}`)))[
        "dados"
      ] as Json[]
    ).filter((m) => m["tipo"] === "devolucao");
    expect(movs.map((m) => m["quantidade"]).sort()).toEqual([1, 1]);
  });
});
