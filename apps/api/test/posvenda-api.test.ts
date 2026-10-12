import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  classificarArtigo,
  criarArtigo,
  mudarEstadoArtigo,
} from "../src/catalogo/repositorio.js";
import { publicar } from "../src/catalogo/publicacao.js";
import { canonico } from "../src/checkout/repositorio.js";
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
import { AdaptadorMoloni } from "../src/faturacao/moloni.js";
import { correrDocumentos } from "../src/faturacao/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import { correrApagamentosPendentes } from "../src/clientes/titular-fila.js";
import { correrAvisosDePrazo } from "../src/posvenda/prazo.js";
import {
  correrNotificacoes,
  enviarUma,
} from "../src/notificacoes/repositorio.js";
import { CorreioDeEnsaio, ErroCorreio } from "../src/notificacoes/correio.js";
import { correrConfirmacoes } from "../src/posvenda/prestador.js";
import { assinar, avisoEuPago, eupagoFalso, json } from "./eupago-falso.js";
import { moloniFalso } from "./moloni-falso.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A pós-venda pela API (docs/30; migração 0058): o botão de livre
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
  const moloni = moloniFalso();
  const faturacao = {
    chave: chavePagamentos(randomBytes(32).toString("base64")),
    adaptadores: {
      ensaio,
      moloni: new AdaptadorMoloni({
        clientId: "dev-eurolify",
        clientSecret: "segredo-do-developer",
        empresasPermitidas: [String(moloni.empresa)],
        fetch: moloni.fetch,
      }),
    },
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
          "catalog:read",
          "merchant:read",
          "catalog:write",
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

  /** Regista a transferência manual do reembolso inteiro. */
  const manual = async (s: Cenario, rfd: string) => {
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

  it("o apagamento numa encomenda paga e concluída: o contacto e os textos saem, a cópia fiscal fica, o aviso do prestador fica resumo (docs/23 §15)", async () => {
    const s = await cenario();
    // Com a fatura emitida pelo emissor de ensaio (o documento fiscal fica).
    await ligar(s, `c-${randomUUID()}`);
    const e = await paga(s, [[s.v1, 1]], "501964843");
    await ateParar();
    const id = e.encomenda.slice(4);
    expect((await documentosDe(s, e.encomenda)).fatura?.["estado"]).toBe(
      "emitido",
    );
    // Um problema aberto e fechado, com texto livre.
    const prb = await ok(
      s.adm("POST", "/problems", {
        encomenda: e.encomenda,
        tipo: "chegou_danificado",
        descricao: "a Ana Silva diz que o frasco veio partido",
      }),
      201,
    );
    await ok(
      s.adm("POST", `/problems/${String(prb["id"])}/close`, {
        versao: 1,
        motivo: "resolvido com a Ana Silva por telefone",
      }),
    );
    // Expedida e entregue, com o nome de quem recebeu na prova.
    const enc = await ok(s.adm("GET", `/orders/${e.encomenda}`));
    const x = await ok(
      s.adm("POST", `/orders/${e.encomenda}/shipments`, {
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
    await ok(
      s.adm("PATCH", `/shipments/${String(x["id"])}`, {
        versao: 2,
        estado: "entregue",
        prova_entrega: "recebido pela Ana Silva",
      }),
    );
    // Concluída (a tarefa fá-lo 14 dias depois de entregue).
    await comComerciante(base.dono, s.c, async (trx) => {
      await sql`select set_config('eurolify.quem', 'sistema:encomendas', true)`.execute(
        trx,
      );
      await sql`update encomenda set estado = 'concluida'
        where id = ${id}::uuid`.execute(trx);
    });
    const ler = async () =>
      (
        await sql<{
          cliente_id: string;
          contacto: Json;
          entrega: Json;
          perfil_copia: Json;
        }>`select cliente_id, contacto, entrega, perfil_copia from encomenda
          where id = ${id}::uuid`.execute(base.dono)
      ).rows[0];
    const antes = await ler();
    const avisosAntes = (
      await sql<{ corpo: string }>`select a.corpo from aviso_pagamento a
        join pagamento p on p.id = a.pagamento_id
        where p.encomenda_id = ${id}::uuid order by a.id`.execute(base.dono)
    ).rows;
    expect(avisosAntes.length).toBeGreaterThan(0);
    // O documento fiscal, linha a linha, para comparar depois.
    const documentos = async () =>
      (
        await sql<{
          t: string;
        }>`select md5(c::text) || md5(coalesce(p::text, '')) as t
          from documento_fiscal d
          join documento_conteudo c on c.documento_id = d.id
          left join documento_prova p on p.documento_id = d.id
          where d.encomenda_id = ${id}::uuid order by c.documento_id, c.versao`.execute(
          base.dono,
        )
      ).rows.map((x) => x.t);
    const documentosAntes = await documentos();
    expect(documentosAntes.length).toBeGreaterThan(0);
    const r = await comComerciante(base.dono, s.c, async (trx) => {
      await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true)`.execute(
        trx,
      );
      return (
        await sql<{
          r: Json;
        }>`select cliente_pseudonimizar(${antes?.cliente_id}::uuid,
          ${`pseudonimizar cus_${String(antes?.cliente_id)}`}, 'teste') as r`.execute(
          trx,
        )
      ).rows[0]?.r;
    });
    expect(r).toMatchObject({
      encomendas_limpas: 1,
      encomendas_com_dados_fiscais_mantidos: 1,
      encomendas_por_acabar: 0,
      perfis_mantidos_por_obrigacao_fiscal: 1,
    });
    const depois = await ler();
    expect(depois?.contacto["email"]).toBe("(pseudonimizado)");
    expect(depois?.entrega["linha1"]).toBe("(pseudonimizado)");
    // A cópia de onde se emite o documento fiscal fica (grupo A).
    expect(depois?.perfil_copia).toEqual(antes?.perfil_copia);
    const prova = (
      await sql<{ prova_entrega: string }>`select prova_entrega from expedicao
        where encomenda_id = ${id}::uuid`.execute(base.dono)
    ).rows[0]?.prova_entrega;
    expect(prova).toBe("(pseudonimizado)");
    const avisos = (
      await sql<{ corpo: string }>`select a.corpo from aviso_pagamento a
        join pagamento p on p.id = a.pagamento_id
        where p.encomenda_id = ${id}::uuid order by a.id`.execute(base.dono)
    ).rows;
    expect(avisos).toHaveLength(avisosAntes.length);
    for (const a of avisos) {
      // O resumo leva a chave do rasto (0054): 8 hex, não o sha256 do corpo.
      expect(JSON.parse(a.corpo)).toEqual({
        pseudonimizado: true,
        resumo: expect.stringMatching(/^[0-9a-f]{8}$/) as unknown,
      });
    }
    // O documento fiscal fica igual (grupo A).
    expect(await documentos()).toEqual(documentosAntes);
    // O texto livre do problema e os motivos das transições.
    expect(
      (
        await sql<{ descricao: string }>`select descricao from problema
          where encomenda_id = ${id}::uuid`.execute(base.dono)
      ).rows,
    ).toEqual([{ descricao: "(pseudonimizado)" }]);
    const motivosPagamento = (
      await sql<{ motivo: string }>`select t.motivo from transicao_pagamento t
        join pagamento p on p.id = t.pagamento_id
        where p.encomenda_id = ${id}::uuid and t.motivo is not null`.execute(
        base.dono,
      )
    ).rows.map((x) => x.motivo);
    expect(motivosPagamento.every((m) => m === "(pseudonimizado)")).toBe(true);
    // A sessão de checkout desta encomenda fica vazia.
    expect(
      (
        await sql<Json>`select s.email, s.nome, s.telefone, s.entrega, s.faturacao
          from sessao_checkout s join encomenda e on e.sessao_id = s.id
          where e.id = ${id}::uuid`.execute(base.dono)
      ).rows[0],
    ).toEqual({
      email: null,
      nome: null,
      telefone: null,
      entrega: null,
      faturacao: null,
    });
    // Uma livre resolução pedida depois guarda «sem e-mail», não o marcador.
    await ok(
      pedir("POST", `/store/orders/${e.token}/withdrawal`, {
        linhas: [
          { linha: (enc["linhas"] as Json[])[0]?.["id"], quantidade: 1 },
        ],
      }),
      201,
    );
    expect(
      (
        await sql<{
          contacto: string;
        }>`select contacto from pedido_livre_resolucao
          where encomenda_id = ${id}::uuid`.execute(base.dono)
      ).rows,
    ).toEqual([{ contacto: "sem e-mail" }]);
    // O registo do negócio fica: o pagamento, as linhas e o estado.
    expect(await ok(s.adm("GET", `/orders/${e.encomenda}`))).toMatchObject({
      estado: "concluida",
      linhas: enc["linhas"],
    });
  });

  it("o apagamento numa devolvida em parte (14 dias depois de entregue) e numa expedida perdida (problema fechado, com ou sem reembolso): contam como acabadas, sem mudar o estado (revisão do #374, P1-1; Diogo, «A»)", async () => {
    const s = await cenario();
    const contactoDe = async (encomenda: string) =>
      (
        await sql<{ estado: string; email: unknown }>`select estado,
          contacto ->> 'email' as email from encomenda
          where id = ${encomenda.slice(4)}::uuid`.execute(base.dono)
      ).rows[0];
    const pseudonimizar = async (cen: Cenario, encomenda: string) => {
      const cliente = (
        await sql<{ cliente_id: string }>`select cliente_id from encomenda
          where id = ${encomenda.slice(4)}::uuid`.execute(base.dono)
      ).rows[0]?.cliente_id;
      return comComerciante(base.dono, cen.c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true)`.execute(
          trx,
        );
        return (
          await sql<{
            r: Json;
          }>`select cliente_pseudonimizar(${cliente}::uuid,
            ${`pseudonimizar cus_${String(cliente)}`}, 'teste') as r`.execute(
            trx,
          )
        ).rows[0]?.r;
      });
    };

    // Devolvida em parte: 2 de 3 devolvidas e reembolsadas. Só passaria a
    // `devolvida`; sem nada aberto, limpa-se.
    const d = await paga(s, [[s.v1, 3]]);
    const [linha] = await expedir(s, d.encomenda);
    const rma = await devolvidaEInspeccionada(s, d.token, [
      { linha: linha?.["id"], quantidade: 2 },
    ]);
    const r = await ok(
      s.adm("POST", `/returns/${rma}/decide`, {
        versao: 3,
        linhas: [{ linha: linha?.["id"], quantidade: 2 }],
        motivo: "dois revendáveis",
      }),
      201,
    );
    await manual(s, String(r["reembolso"]));
    expect(await contactoDe(d.encomenda)).toMatchObject({
      estado: "devolvida_parcial",
    });
    // Dentro dos 14 dias da entrega, como uma entregue: o resto ainda se
    // pode devolver; fica na fila.
    const antesD = await contactoDe(d.encomenda);
    expect(await pseudonimizar(s, d.encomenda)).toMatchObject({
      encomendas_limpas: 0,
      encomendas_por_acabar: 1,
    });
    expect(await contactoDe(d.encomenda)).toEqual(antesD);
    await entregueHa(d.encomenda, 15);
    expect((await correrApagamentosPendentes(base.api)).falhas).toEqual([]);
    expect(await contactoDe(d.encomenda)).toEqual({
      estado: "devolvida_parcial",
      email: "(pseudonimizado)",
    });

    // Expedida e perdida: até uma pessoa fechar o problema (ou o pagamento
    // deixar de estar capturado), o comerciante ainda reenvia (precisa da
    // morada) ou reembolsa; fica na fila.
    const perdida = async (cen: Cenario, comProblema = true) => {
      const p = await paga(cen, [[cen.v1, 1]]);
      const [l] = await expedir(cen, p.encomenda, false);
      const x = (
        await sql<{ id: string }>`select id from expedicao
          where encomenda_id = ${p.encomenda.slice(4)}::uuid`.execute(base.dono)
      ).rows[0];
      await ok(
        cen.adm("PATCH", `/shipments/shp_${String(x?.id)}`, {
          versao: 2,
          estado: "perdida",
        }),
      );
      const antes = await contactoDe(p.encomenda);
      expect(antes?.estado).toBe("expedida");
      expect(await pseudonimizar(cen, p.encomenda)).toMatchObject({
        encomendas_limpas: 0,
        encomendas_por_acabar: 1,
      });
      expect(await contactoDe(p.encomenda)).toEqual(antes);
      if (!comProblema) return { encomenda: p.encomenda, antes };
      const prb = await ok(
        cen.adm("POST", "/problems", {
          encomenda: p.encomenda,
          tipo: "em_falta",
          descricao: "a transportadora perdeu a encomenda",
        }),
        201,
      );
      // Com o problema aberto, continua na fila.
      expect((await correrApagamentosPendentes(base.api)).falhas).toEqual([]);
      expect(await contactoDe(p.encomenda)).toEqual(antes);
      return {
        encomenda: p.encomenda,
        antes,
        linha: l,
        problema: String(prb["id"]),
      };
    };
    // Reembolsado só o artigo, sem os portes: o pagamento fica
    // reembolsado em parte e o problema fecha-se com o reembolso.
    const s2 = await cenario();
    const a = await perdida(s2);
    const rp = await ok(
      s2.adm("POST", `/problems/${String(a.problema)}/decide`, {
        versao: 1,
        linhas: [{ linha: a.linha?.["id"], quantidade: 1 }],
        motivo: "perdida",
      }),
      201,
    );
    await manual(s2, String(rp["reembolso"]));
    expect(await estadoDoPagamento(s2, a.encomenda)).toBe(
      "reembolsado_parcial",
    );
    expect((await correrApagamentosPendentes(base.api)).falhas).toEqual([]);
    expect(await contactoDe(a.encomenda)).toEqual({
      estado: "expedida",
      email: "(pseudonimizado)",
    });
    // Resolvida fora (reenvio noutra encomenda): o problema fecha-se sem
    // reembolso e o pagamento fica capturado.
    const s3 = await cenario();
    const b = await perdida(s3);
    await ok(
      s3.adm("POST", `/problems/${String(b.problema)}/close`, {
        versao: 1,
        motivo: "reenviado noutra encomenda",
      }),
    );
    expect(await estadoDoPagamento(s3, b.encomenda)).toBe("capturado");
    expect((await correrApagamentosPendentes(base.api)).falhas).toEqual([]);
    expect(await contactoDe(b.encomenda)).toEqual({
      estado: "expedida",
      email: "(pseudonimizado)",
    });
    // Sem problema, numa disputa: em disputa fica (a prova de entrega é do
    // comerciante); perdida a disputa, o dinheiro voltou ao cliente.
    const s4 = await cenario();
    const c = await perdida(s4, false);
    const disputa = (estado: string) =>
      comComerciante(base.dono, s4.c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'sistema:teste', true),
          set_config('eurolify.origem', 'aviso', true)`.execute(trx);
        await sql`update pagamento set estado = ${estado}
          where encomenda_id = ${c.encomenda.slice(4)}::uuid`.execute(trx);
      });
    await disputa("em_disputa");
    expect((await correrApagamentosPendentes(base.api)).falhas).toEqual([]);
    expect(await contactoDe(c.encomenda)).toEqual(c.antes);
    await disputa("perdida");
    expect((await correrApagamentosPendentes(base.api)).falhas).toEqual([]);
    expect(await contactoDe(c.encomenda)).toEqual({
      estado: "expedida",
      email: "(pseudonimizado)",
    });
    // Quatro comerciantes e sete voltas da fila.
  }, 30_000);

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

  it("emitida fora do Eurolify: a NC que esperava pela fatura sai com ela, e um reembolso depois não pede NC (docs/29 §15, F5)", async () => {
    const s = await cenario();
    // Paga antes de a entidade escolher quem emite.
    const e = await paga(s, [[s.v1, 2]]);
    await ateParar();
    const [linha] = await expedir(s, e.encomenda);
    const decidir = async (descricao: string) => {
      const p = await ok(
        s.adm("POST", "/problems", {
          encomenda: e.encomenda,
          tipo: "chegou_danificado",
          descricao,
        }),
        201,
      );
      return ok(
        s.adm("POST", `/problems/${String(p["id"])}/decide`, {
          versao: 1,
          linhas: [{ linha: linha?.["id"], quantidade: 1 }],
          motivo: "partido",
        }),
        201,
      );
    };
    const r1 = await decidir("frasco partido");
    expect(String(r1["nota_credito"])).toMatch(/^inv_/);
    await ateParar();
    let { fatura, notas } = await documentosDe(s, e.encomenda);
    expect(fatura?.["estado"]).toBe("retido");
    expect(notas[0]?.["estado"]).toBe("retido");
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "sistema_proprio",
      }),
      204,
    );
    await ok(
      s.adm("POST", `/invoices/${String(fatura?.["id"])}/issued-elsewhere`, {
        versao: fatura?.["versao"],
        motivo: "faturada no sistema da loja",
        numero: "FT 2026/58",
      }),
    );
    ({ fatura, notas } = await documentosDe(s, e.encomenda));
    expect(fatura?.["estado"]).toBe("fora");
    // A NC sai com a fatura, sem número declarado: o da fatura não é o dela
    // (revisão do #386, P2-2).
    expect(notas[0]).toMatchObject({
      estado: "fora",
      emitida_fora: { numero_declarado: null, prova: false },
    });
    // E sai da fila «A decidir» (P2-5).
    const { rows: fila } = await naBase(s, (trx) =>
      sql<{
        caso: string;
      }>`select caso from documentos_casos_a_decidir()`.execute(trx),
    );
    expect(fila.map((x) => x.caso)).not.toContain(
      String(notas[0]?.["id"]).slice(4),
    );
    // Um reembolso depois: sem NC no Eurolify, e diz porquê.
    const r2 = await decidir("outro frasco partido");
    expect(r2["nota_credito"]).toBeNull();
    expect(
      await ok(s.adm("GET", `/refunds/${String(r2["reembolso"])}`)),
    ).toMatchObject({
      nota_credito: null,
      sem_nota_credito: "sistema_proprio",
    });
    // Pedir a NC devolve nada; e a base recusa criá-la directamente
    // (revisão do #386, P2-3).
    await expect(
      naBase(s, (trx) =>
        sql`select nota_credito_pedir(${String(r2["reembolso"]).slice(4)}::uuid)`.execute(
          trx,
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ nota_credito_pedir: null }] });
    await expect(
      sql`insert into documento_fiscal (comerciante_id, encomenda_id, entidade_legal_id,
          tipo, modo, original_id, reembolso_id)
        values (${s.c}::uuid, ${e.encomenda.slice(4)}::uuid, ${s.entidade}::uuid,
          'nota_credito', 'teste', ${String(fatura?.["id"]).slice(4)}::uuid,
          ${String(r2["reembolso"]).slice(4)}::uuid)`.execute(base.dono),
    ).rejects.toThrow(/invoices\.other_issuer/);
  });

  it("a nota de crédito de uma fatura do Moloni fica retida até se medir o related_id (docs/29 §13.6, M7)", async () => {
    const s = await cenario();
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "eurolify",
      }),
      204,
    );
    const portes = moloni.artigo(`PORTES-${randomUUID().slice(0, 8)}`);
    const cf = moloni.cliente("999999990", "Consumidor final");
    const l = await ok(
      s.adm("POST", "/invoicing-connections", {
        entidade_legal: `lgl_${s.entidade}`,
        adaptador: "moloni",
        serie: "500",
        taxas: [{ pais: "PT", taxa: 2300, emissor: "11" }],
        config: {
          lingua: "1",
          vencimento: "5",
          artigo_portes: String(portes.product_id),
          categoria: "77",
          unidade: "3",
          cliente_consumidor_final: String(cf.customer_id),
          metodos_pagamento: { multibanco: "9" },
        },
      }),
      201,
    );
    await ok(
      s.adm("PUT", `/invoicing-connections/${String(l["id"])}/credentials`, {
        credenciais: moloni.credenciais(),
      }),
      204,
    );
    await ok(s.adm("POST", `/invoicing-connections/${String(l["id"])}/test`));
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
    await manual(s, String(r["reembolso"]));
    await ateParar();
    const { fatura, notas } = await documentosDe(s, e.encomenda);
    expect(fatura?.["estado"]).toBe("emitido");
    expect(notas[0]).toMatchObject({
      estado: "retido",
      motivos: ["nota_credito_sem_adaptador"],
    });
    // Uma NC de uma fatura emitida pelo Eurolify nunca sai «fora»: nem pela
    // API, nem pela base (revisão do #386, P2-3).
    expect(
      await codigo(
        s.adm(
          "POST",
          `/invoices/${String(notas[0]?.["id"])}/issued-elsewhere`,
          {
            versao: notas[0]?.["versao"],
            motivo: "tentativa numa NC da fatura do Eurolify",
            numero: "NC 1",
          },
        ),
      ),
    ).toEqual([409, "invoices.invalid_transition"]);
    await expect(
      sql`update documento_fiscal set estado = 'fora'
        where id = ${String(notas[0]?.["id"]).slice(4)}::uuid`.execute(
        base.dono,
      ),
    ).rejects.toThrow(/invoices\.invalid_transition/);
    // Nenhuma NC chegou ao Moloni.
    expect(
      moloni.estado.pedidos.some((x) => x.metodo.startsWith("creditNotes/")),
    ).toBe(false);
    expect(moloni.estado.documentos.filter((d) => d.saft === "NC")).toEqual([]);
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
    // A NC espera que o dinheiro saia (revisão do #329, P1-4).
    await ateParar();
    const antes = await documentosDe(s, e.encomenda);
    expect(antes.notas[0]).toMatchObject({
      estado: "retido",
      motivos: ["reembolso_por_executar"],
    });
    await manual(s, String(r["reembolso"]));
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
    await manual(s, String(r2["reembolso"]));
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

  it("as vendas do dia (#367): uma venda real — checkout, captura, fatura, devolução, reembolso e NC — dá os quatro números", async (ctx) => {
    // O dia de hoje no fuso do comerciante. Se a meia-noite de Lisboa cair a
    // meio do caso, a venda fica em dois dias: confere-se antes de cada
    // consulta, já depois das escritas que ela conta (revisão do #387, P2-1).
    const hoje = () =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(
        new Date(),
      );
    const dia = hoje();
    const s = await cenario();
    await ligar(s, `c-${randomUUID()}`);
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
    // O devolvido conta no dia em que o reembolso se regista como executado
    // (docs/35 §1, `executado_em`), não na data da transferência que o
    // `manual` declara (revisão do #387, P3-5).
    await manual(s, String(r["reembolso"]));
    const leitor = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Vendas",
        ambitos: ["sales:read"],
      })
    ).segredo;
    const vendasDoDia = async () => {
      const v = await ok(
        pedir("GET", `/sales/summary?dia=${dia}`, undefined, {
          authorization: `Bearer ${leitor}`,
        }),
      );
      expect(v).toMatchObject({
        periodo: { fuso: "Europe/Lisbon", completo: false },
        modo: "teste",
      });
      const moedas = v["moedas"] as Json[];
      expect(moedas.map((m) => m["moeda"])).toEqual(["EUR"]);
      const m = moedas[0] as Json;
      // Uma linha só, com a moeda lida do conteúdo real da fatura: uma moeda
      // nula abriria um segundo bloco (revisão do #387, P3-3).
      expect(m["por_canal_e_mercado"]).toEqual([
        {
          canal: `chn_${s.canal}`,
          mercado: `mkt_${s.mercado}`,
          ...(m["total"] as Json),
        },
      ]);
      return m["total"] as Json;
    };
    // Executado o reembolso, a NC ainda não saiu (a tarefa dos documentos não
    // correu): o devolvido conta, e o sem IVA dele fica por conhecer (§3).
    if (hoje() !== dia) ctx.skip("a meia-noite de Lisboa caiu a meio do caso");
    const antes = await vendasDoDia();
    expect(antes["devolvido"]).toMatchObject({
      com_iva: 1230,
      sem_iva: 0,
      quantidade: 1,
      sem_iva_por_conhecer: { quantidade: 1, com_iva: 1230 },
    });
    expect(antes["faturado"]).toMatchObject({
      creditado: { com_iva: 0, sem_iva: 0, quantidade: 0 },
    });
    await ateParar();
    const { fatura, notas } = await documentosDe(s, e.encomenda);
    expect(fatura?.["estado"]).toBe("emitido");
    expect(notas.map((n) => n["estado"])).toEqual(["emitido"]);
    // Os valores fixos, não lidos da mesma coluna que a rota soma (revisão do
    // #387, P2-2): 2 × 12,30 € + 4,99 € de portes (abaixo dos 50,00 €), com
    // IVA a 23 % incluído = 20,00 € + 4,06 € sem IVA. O emissor de ensaio
    // devolve a mesma base que um recálculo daria; a regra de ler e nunca
    // recalcular prova-se com uma prova diferente em `vendas.test.ts`.
    const total = 2959;
    const semIva = 2406;
    if (hoje() !== dia) ctx.skip("a meia-noite de Lisboa caiu a meio do caso");
    const t = await vendasDoDia();
    expect(t).toMatchObject({
      encomendado: {
        com_iva: total,
        sem_iva: semIva,
        quantidade: 1,
        das_quais_canceladas: { com_iva: 0, sem_iva: 0, quantidade: 0 },
      },
      pago: { com_iva: total, sem_iva: semIva, quantidade: 1 },
      faturado: {
        com_iva: total,
        sem_iva: semIva,
        quantidade: 1,
        // A taxa e a proporção da fatura: 12,30 € = 10,00 € + 2,30 € de IVA.
        creditado: { com_iva: 1230, sem_iva: 1000, quantidade: 1 },
      },
      devolvido: { com_iva: 1230, sem_iva: 1000, quantidade: 1 },
    });
    const faturado = t["faturado"] as Json;
    const encomendado = t["encomendado"] as Json;
    for (const n of [
      encomendado,
      encomendado["das_quais_canceladas"],
      t["pago"],
      faturado,
      faturado["creditado"],
      t["devolvido"],
    ]) {
      expect(n).not.toHaveProperty("sem_iva_por_conhecer");
    }
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
    const r = await ok(
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
    await manual(s, String(r["reembolso"]));
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

  it("a NC sai pela ligação da fatura, não espera por uma fatura divergente sem a resolver e não passa o saldo (P1-2, P1-3)", async () => {
    const s = await cenario();
    const contaA = `a-${randomUUID()}`;
    const ligA = await ligar(s, contaA);
    const e = await paga(s, [[s.v1, 2]], "501964843");
    await ateParar();
    const [linha] = await expedir(s, e.encomenda);
    // A entidade passa a emitir por outra ligação.
    const la = (
      (await ok(s.adm("GET", "/invoicing-connections")))["dados"] as Json[]
    ).find((x) => x["id"] === ligA) as Json;
    await ok(
      s.adm("PATCH", `/invoicing-connections/${ligA}`, {
        versao: la["versao"],
        activa: false,
      }),
    );
    const contaB = `b-${randomUUID()}`;
    await ligar(s, contaB);
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
    await manual(s, String(r["reembolso"]));
    await ateParar();
    const docs = await documentosDe(s, e.encomenda);
    // A ligação da fatura está desligada: a NC fica retida, nunca vai à B.
    expect(docs.notas[0]).toMatchObject({
      estado: "retido",
      motivos: ["ligacao_sem_teste"],
    });
    expect(ensaio.conta(contaB).chamadas).not.toContain("criarRascunho");

    // Uma fatura divergente: a NC espera; resolvida, sai.
    const s2 = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s2, conta);
    ensaio.conta(conta).aoFechar = (doc) => ({
      ...doc,
      totais: {
        ...doc.totais,
        iva: doc.totais.iva + 1,
        total: doc.totais.total + 1,
      },
    });
    const e2 = await paga(s2, [[s2.v1, 2]], "501964843");
    await ateParar();
    delete ensaio.conta(conta).aoFechar;
    const [l2] = await expedir(s2, e2.encomenda);
    const rma2 = await devolvidaEInspeccionada(s2, e2.token, [
      { linha: l2?.["id"], quantidade: 2 },
    ]);
    const r2 = await ok(
      s2.adm("POST", `/returns/${rma2}/decide`, {
        versao: 3,
        linhas: [{ linha: l2?.["id"], quantidade: 1 }],
        motivo: "uma só",
      }),
      201,
    );
    await manual(s2, String(r2["reembolso"]));
    await ateParar();
    let d2 = await documentosDe(s2, e2.encomenda);
    expect(d2.fatura?.["estado"]).toBe("divergente");
    expect(d2.notas[0]).toMatchObject({
      estado: "retido",
      motivos: ["original_por_emitir"],
    });
    await ok(
      s2.adm("POST", `/invoices/${String(d2.fatura?.["id"])}/resolve`, {
        versao: d2.fatura?.["versao"],
        motivo: "visto com o contabilista",
      }),
    );
    // A primeira NC sai com 10,00 € a mais no emissor (fica divergente e
    // conta no creditado); a segunda passava o saldo da fatura.
    ensaio.conta(conta).aoFechar = (doc) => ({
      ...doc,
      totais: {
        ...doc.totais,
        base: doc.totais.base + 1000,
        total: doc.totais.total + 1000,
      },
    });
    await ateParar();
    delete ensaio.conta(conta).aoFechar;
    d2 = await documentosDe(s2, e2.encomenda);
    expect(d2.notas[0]?.["estado"]).toBe("divergente");
    // O segundo reembolso: a outra unidade e os portes.
    const outro = await ok(
      s2.adm("POST", "/problems", {
        encomenda: e2.encomenda,
        tipo: "outro",
        descricao: "a outra unidade",
      }),
      201,
    );
    const r3 = await ok(
      s2.adm("POST", `/problems/${String(outro["id"])}/decide`, {
        versao: 1,
        linhas: [{ linha: l2?.["id"], quantidade: 1 }],
        incluir_portes: true,
        motivo: "o resto",
      }),
      201,
    );
    await manual(s2, String(r3["reembolso"]));
    await ateParar();
    d2 = await documentosDe(s2, e2.encomenda);
    const nc2 = d2.notas.find((n) => n["reembolso"] === r3["reembolso"]);
    expect(nc2).toMatchObject({
      estado: "retido",
      motivos: ["credito_acima_do_saldo"],
    });
  });

  it("anular um reembolso antes da transferência: a devolução decide-se outra vez e a NC fica retida (P1-4); linhas repetidas recusadas (P1-1)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    const e = await paga(s, [[s.v1, 3]], "501964843");
    await ateParar();
    const [linha] = await expedir(s, e.encomenda);
    const rma = await devolvidaEInspeccionada(s, e.token, [
      { linha: linha?.["id"], quantidade: 1 },
    ]);
    // 1 unidade voltou; três vezes a mesma linha de 1 unidade: recusado.
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/decide`, {
          versao: 3,
          linhas: [
            { linha: linha?.["id"], quantidade: 1 },
            { linha: linha?.["id"], quantidade: 1 },
            { linha: linha?.["id"], quantidade: 1 },
          ],
          motivo: "repetida",
        }),
      ),
    ).toEqual([400, "refunds.invalid_field"]);
    const r = await ok(
      s.adm("POST", `/returns/${rma}/decide`, {
        versao: 3,
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
        incluir_portes: true,
        motivo: "engano: os portes não eram para reembolsar",
      }),
      201,
    );
    const rfd = String(r["reembolso"]);
    let x = await ok(s.adm("GET", `/refunds/${rfd}`));
    expect(
      await codigo(
        s.adm("POST", `/refunds/${rfd}/cancel`, { versao: x["versao"] }),
      ),
    ).toEqual([400, "request.invalid"]);
    await ok(
      s.adm("POST", `/refunds/${rfd}/cancel`, {
        versao: x["versao"],
        motivo: "os portes não se reembolsavam",
      }),
    );
    x = await ok(s.adm("GET", `/refunds/${rfd}`));
    expect(x["estado"]).toBe("cancelado");
    expect((await ok(s.adm("GET", `/returns/${rma}`)))["estado"]).toBe(
      "inspeccionada",
    );
    // Anulado não se executa.
    expect(
      await codigo(
        s.adm("POST", `/refunds/${rfd}/manual`, {
          versao: x["versao"],
          montante: x["montante"],
          data: "2026-10-10",
          referencia: "TRF-X",
        }),
      ),
    ).toEqual([409, "refunds.invalid_transition"]);
    await ateParar();
    const docs = await documentosDe(s, e.encomenda);
    expect(docs.notas[0]).toMatchObject({
      estado: "retido",
      motivos: ["reembolso_cancelado"],
    });
    // Decide-se outra vez, sem os portes: 12,30 €.
    const d = await ok(s.adm("GET", `/returns/${rma}`));
    const r2 = await ok(
      s.adm("POST", `/returns/${rma}/decide`, {
        versao: d["versao"],
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
        motivo: "livre resolução",
      }),
      201,
    );
    expect(r2["montante"]).toBe(1230);
    expect(await eventos(s)).toContain("refund.cancelled");
    // O reembolso de um cancelamento não se anula.
    const c = await paga(s, [[s.v1, 1]]);
    const rc = await ok(
      s.adm("POST", `/orders/${c.encomenda}/cancel`, { motivo: "desistiu" }),
      201,
    );
    const xc = await ok(s.adm("GET", `/refunds/${String(rc["reembolso"])}`));
    expect(
      await codigo(
        s.adm("POST", `/refunds/${String(rc["reembolso"])}/cancel`, {
          versao: xc["versao"],
          motivo: "não",
        }),
      ),
    ).toEqual([409, "refunds.invalid_transition"]);
  });

  it("fechar sem reembolso; o executado não muda; sem NC diz porquê e o evento leva as linhas (P2-5, P2-6, P2-8)", async () => {
    const s = await cenario();
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "sistema_proprio",
      }),
      204,
    );
    const e = await paga(s, [[s.v1, 2]]);
    const [linha] = await expedir(s, e.encomenda);
    const rma = await ok(
      s.adm("POST", "/returns", {
        encomenda: e.encomenda,
        origem: "comercial",
        motivo: "troca",
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
      }),
      201,
    );
    const id = String(rma["id"]);
    await ok(
      s.adm("POST", `/returns/${id}/receive`, { versao: 1, linhas: [] }),
    );
    await ok(
      s.adm("POST", `/returns/${id}/inspect`, {
        versao: 2,
        linhas: [
          { linha: linha?.["id"], estado_artigo: "em_falta", aceite: 0 },
        ],
      }),
    );
    // Nada voltou: fecha-se sem reembolso, com motivo.
    await ok(
      s.adm("POST", `/returns/${id}/close`, {
        versao: 3,
        motivo: "a caixa chegou vazia",
      }),
    );
    expect((await ok(s.adm("GET", `/returns/${id}`)))["estado"]).toBe(
      "fechada",
    );
    const prb = await ok(
      s.adm("POST", "/problems", {
        encomenda: e.encomenda,
        tipo: "atraso",
        descricao: "chegou um dia depois",
      }),
      201,
    );
    await ok(
      s.adm("POST", `/problems/${String(prb["id"])}/close`, {
        versao: 1,
        motivo: "dentro do prazo anunciado; nada a reembolsar",
      }),
    );
    // Um reembolso com sistema próprio: sem NC no Eurolify, e diz porquê.
    const p2 = await ok(
      s.adm("POST", "/problems", {
        encomenda: e.encomenda,
        tipo: "chegou_danificado",
        descricao: "frasco partido",
      }),
      201,
    );
    const r = await ok(
      s.adm("POST", `/problems/${String(p2["id"])}/decide`, {
        versao: 1,
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
        motivo: "partido",
      }),
      201,
    );
    expect(r["nota_credito"]).toBeNull();
    const rfd = String(r["reembolso"]);
    expect(await ok(s.adm("GET", `/refunds/${rfd}`))).toMatchObject({
      nota_credito: null,
      sem_nota_credito: "sistema_proprio",
    });
    const { rows } = await sql<{ dados: Json }>`select dados from evento_saida
      where comerciante_id = ${s.c}::uuid and tipo = 'refund.created'`.execute(
      base.dono,
    );
    expect(rows[0]?.dados).toMatchObject({
      montante: 1230,
      linhas: [
        {
          linha_encomenda_id: String(linha?.["id"]).slice(4),
          quantidade: 1,
          montante: 1230,
        },
      ],
    });
    await manual(s, rfd);
    // Executado, a prova não se apaga nem a via muda.
    await expect(
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await trx
          .updateTable("reembolso")
          .set({ via: "prestador", prova: JSON.stringify({}) })
          .where("id", "=", rfd.slice(4))
          .execute();
      }),
    ).rejects.toThrow(/refunds\.immutable/);
  });

  it("o prazo conta da última entrega; o pedido fica sempre registado; o botão vai na confirmação (P2-1, P2-3, P2-9, P2-10)", async () => {
    const s = await cenario();
    const e = await paga(s, [
      [s.v1, 1],
      [s.v2, 2],
    ]);
    const conf = await ok(pedir("GET", `/checkout/${e.token}/confirmation`));
    expect(conf["livre_resolucao"]).toBe(`/store/orders/${e.token}/withdrawal`);
    // Duas expedições: a primeira entregue há 20 dias, a segunda a caminho.
    const enc = await ok(s.adm("GET", `/orders/${e.encomenda}`));
    const [l1, l2] = enc["linhas"] as Json[];
    const expedicao = async (l: Json | undefined) => {
      const x = await ok(
        s.adm("POST", `/orders/${e.encomenda}/shipments`, {
          linhas: [{ linha: l?.["id"], quantidade: l?.["quantidade"] }],
        }),
        201,
      );
      await ok(
        s.adm("PATCH", `/shipments/${String(x["id"])}`, {
          versao: 1,
          estado: "expedida",
        }),
      );
      return String(x["id"]);
    };
    const x1 = await expedicao(l1);
    await ok(
      s.adm("PATCH", `/shipments/${x1}`, { versao: 2, estado: "entregue" }),
    );
    await entregueHa(e.encomenda, 20);
    const x2 = await expedicao(l2);
    let v = await ok(pedir("GET", `/store/orders/${e.token}/withdrawal`));
    // Falta entregar: o prazo ainda não começou.
    expect(
      (v["linhas"] as Json[]).map((l) => [
        l["dentro_do_prazo"],
        l["prazo_ate"],
      ]),
    ).toEqual([
      [true, null],
      [true, null],
    ]);
    await ok(
      s.adm("PATCH", `/shipments/${x2}`, { versao: 2, estado: "entregue" }),
    );
    v = await ok(pedir("GET", `/store/orders/${e.token}/withdrawal`));
    expect((v["linhas"] as Json[]).every((l) => l["dentro_do_prazo"])).toBe(
      true,
    );
    // A loja fica sem armazém activo: o pedido regista-se pendente.
    await base.dono.transaction().execute(async (t) => {
      await sql`alter table armazem disable trigger user`.execute(t);
      await sql`update armazem set estado = 'arquivado'
        where comerciante_id = ${s.c}::uuid`.execute(t);
      await sql`alter table armazem enable trigger user`.execute(t);
    });
    const w = await ok(
      pedir("POST", `/store/orders/${e.token}/withdrawal`, {
        linhas: [{ linha: l1?.["id"], quantidade: 1 }],
      }),
      201,
    );
    expect(w).toMatchObject({ estado: "pendente" });
    const p = await ok(s.adm("GET", `/withdrawals/${String(w["pedido"])}`));
    expect(p).toMatchObject({ estado: "pendente", devolucao: null });
    // O mesmo pedido outra vez não se grava (já espera por uma pessoa).
    expect(
      await codigo(
        pedir("POST", `/store/orders/${e.token}/withdrawal`, {
          linhas: [{ linha: l1?.["id"], quantidade: 1 }],
        }),
      ),
    ).toEqual([422, "returns.quantity_exceeded"]);
    const lista = (await ok(s.adm("GET", `/withdrawals?estado=pendente`)))[
      "dados"
    ] as Json[];
    expect(lista).toHaveLength(1);
  });

  it("dois pedidos ao mesmo tempo sobre a mesma linha: só um reembolso passa", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 1]]);
    const [linha] = await expedir(s, e.encomenda);
    const problemas = await Promise.all(
      [1, 2].map(() =>
        ok(
          s.adm("POST", "/problems", {
            encomenda: e.encomenda,
            tipo: "chegou_danificado",
            descricao: "partido",
          }),
          201,
        ),
      ),
    );
    const respostas = await Promise.all(
      problemas.map((p) =>
        s.adm("POST", `/problems/${String(p["id"])}/decide`, {
          versao: 1,
          linhas: [{ linha: linha?.["id"], quantidade: 1 }],
          motivo: "partido",
        }),
      ),
    );
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([201, 422]);
    expect(
      (
        (await ok(s.adm("GET", `/refunds?encomenda=${e.encomenda}`)))[
          "dados"
        ] as Json[]
      ).length,
    ).toBe(1);
  });

  it("a base: uma devolução reembolsa-se só inspeccionada e até ao que voltou", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 2]]);
    const [linha] = await expedir(s, e.encomenda);
    const lid = String(linha?.["id"]).slice(4);
    const rma = String(
      (
        await ok(
          s.adm("POST", "/returns", {
            encomenda: e.encomenda,
            origem: "apoio",
            motivo: "duas",
            linhas: [{ linha: linha?.["id"], quantidade: 2 }],
          }),
          201,
        )
      )["id"],
    );
    const pag = await naBase(s, (trx) =>
      trx
        .selectFrom("pagamento")
        .select("id")
        .where("encomenda_id", "=", e.encomenda.slice(4))
        .executeTakeFirstOrThrow(),
    );
    /** Um reembolso escrito à mão sobre a devolução, com `quantidade`. */
    const amao = (quantidade: number) =>
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
            origem: "devolucao",
            devolucao_id: rma.slice(4),
            montante: 1230 * quantidade,
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
            quantidade,
            montante: 1230 * quantidade,
          })
          .execute();
        await trx
          .updateTable("reembolso")
          .set({ estado: "a_executar", versao: 2 })
          .where("id", "=", id)
          .execute();
      });
    // Ainda a aguardar: a base recusa (Q3).
    await expect(amao(1)).rejects.toThrow(/não está inspeccionada/);
    await ok(
      s.adm("POST", `/returns/${rma}/receive`, {
        versao: 1,
        linhas: [{ linha: linha?.["id"], recebida: 1 }],
      }),
    );
    await ok(
      s.adm("POST", `/returns/${rma}/inspect`, {
        versao: 2,
        linhas: [
          { linha: linha?.["id"], estado_artigo: "revendavel", aceite: 1 },
        ],
      }),
    );
    // Voltou 1: reembolsar 2 é recusado pela base.
    await expect(amao(2)).rejects.toThrow(/mais do que voltou/);
    await amao(1);
  });

  // ------------------------------------- Parte 2: pelo prestador (docs/30 §13)

  /** A conta do cenário com as credenciais OAuth do reembolso (P1). */
  async function comOAuth(s: Cenario) {
    await ok(
      s.adm("PUT", `/payment-accounts/${s.conta}/credentials`, {
        chave: "xxxx-xxxx-xxxx-xxxx",
        segredo_aviso: SEGREDO,
        client_id: "cliente-1",
        client_secret: "segredo-oauth-1",
      }),
      204,
    );
    await ok(s.adm("POST", `/payment-accounts/${s.conta}/test`));
  }

  /** Uma encomenda paga por MB WAY, com o `trid` no aviso (P2). */
  async function pagaMbWay(
    s: Cenario,
    linhas: [string, number][],
    trid: number,
    nif: string | null = null,
  ) {
    const k = await checkoutCom(s, linhas);
    await preencher(s, k.token, undefined, nif);
    await ok(
      pedir("PUT", `/checkout/${k.token}/contact`, {
        email: "rui@exemplo.pt",
        nome: "Rui",
        telefone: "+351912345678",
      }),
    );
    await ok(
      pedir("PUT", `/checkout/${k.token}/payment-method`, { metodo: "mb_way" }),
    );
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
            trid,
            method: "Mbway",
          }),
        )
      ).statusCode,
    ).toBe(200);
    return { ...k, encomenda: String(e["encomenda"]), pagamento: pag };
  }

  /** Expede, abre um problema e decide-o: um reembolso de 12,30 € + 4,99 €. */
  async function reembolsoDeProblema(s: Cenario, encomenda: string) {
    const [linha] = await expedir(s, encomenda);
    const prb = await ok(
      s.adm("POST", "/problems", {
        encomenda,
        tipo: "chegou_danificado",
        descricao: "frasco partido",
      }),
      201,
    );
    const d = await ok(
      s.adm("POST", `/problems/${String(prb["id"])}/decide`, {
        versao: 1,
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
        incluir_portes: true,
        motivo: "chegou partido",
      }),
      201,
    );
    return {
      id: String(d["reembolso"]),
      problema: String(prb["id"]),
      linha: String(linha?.["id"]),
    };
  }

  const reembolso = (s: Cenario, id: string) =>
    ok(s.adm("GET", `/refunds/${id}`));
  const chamadasDeReembolso = () =>
    eupago.chamadas.filter((c) => /\/refund\/[0-9]+$/.test(c.url));
  const diferencas = (s: Cenario) =>
    naBase(s, (trx) =>
      trx
        .selectFrom("diferenca_pagamento")
        .select(["motivo", "estado", "prova", "resolvida_por"])
        .where("motivo", "in", [
          "reembolso_incerto",
          "reembolso_por_confirmar",
          "reembolso_desconhecido",
        ])
        .orderBy("criada_em")
        .execute(),
    );
  /** Muda à força o momento do pedido (o relógio da tarefa). */
  const pedidoHa = (id: string, minutos: number) =>
    base.dono.transaction().execute(async (t) => {
      await sql`alter table reembolso disable trigger reembolso_antes_de_gravar`.execute(
        t,
      );
      await sql`update reembolso set pedido_em = now() - make_interval(mins => ${minutos}),
        consultado_em = null where id = ${id.slice(4)}::uuid`.execute(t);
      await sql`alter table reembolso enable always trigger reembolso_antes_de_gravar`.execute(
        t,
      );
    });
  /** A EuPago falsa com as respostas por omissão (um teste não passa ao outro). */
  const limpar = () => {
    delete eupago.respostas.token;
    delete eupago.respostas.reembolso;
    delete eupago.respostas.consultaReembolso;
  };
  const confirmar = async () => {
    const r = await correrConfirmacoes(base.api, eupago.config);
    expect(r.erros).toEqual([]);
    return r;
  };

  it("pelo prestador (MB WAY): o trid do aviso, o pedido com OAuth, a_confirmar e a consulta dá executado; o pagamento, o problema e o evento seguem", async () => {
    limpar();
    const s = await cenario();
    await comOAuth(s);
    const e = await pagaMbWay(s, [[s.v1, 1]], 123456);
    expect(
      await naBase(s, async (trx) =>
        trx
          .selectFrom("pagamento")
          .select("id_transaccao_prestador")
          .where("encomenda_id", "=", e.encomenda.slice(4))
          .executeTakeFirstOrThrow(),
      ),
    ).toEqual({ id_transaccao_prestador: "123456" });
    const r = await reembolsoDeProblema(s, e.encomenda);
    const antes = (await reembolso(s, r.id))["versao"];
    const n = eupago.chamadas.length;
    expect(
      await ok(s.adm("POST", `/refunds/${r.id}/execute`, { versao: antes })),
    ).toEqual({ estado: "a_confirmar", versao: Number(antes) + 2 });
    const feitas = eupago.chamadas.slice(n);
    expect(feitas.map((c) => c.url.replace(/^https:\/\/[^/]+/, ""))).toEqual([
      "/api/auth/token",
      "/api/management/v1.02/refund/123456",
    ]);
    expect(feitas[0]?.corpo).toEqual({
      client_id: "cliente-1",
      client_secret: "segredo-oauth-1",
      grant_type: "client_credentials",
    });
    expect(feitas[1]?.corpo).toEqual({ amount: 17.29, reason: r.id });
    expect(feitas[1]?.cabecalhos["authorization"]).toMatch(/^Bearer tok/);
    const x = await reembolso(s, r.id);
    expect(x["via"]).toBe("prestador");
    expect(x["prestador"]).toEqual({
      pedido_em: expect.any(String) as string,
      pedido_por: expect.stringMatching(/^chave:/) as string,
      referencia: expect.stringMatching(/^[0-9]+$/) as string,
      recusa: null,
    });
    // Outra vez: o reembolso já não está a executar (nunca a dobrar, R7).
    expect(
      await codigo(
        s.adm("POST", `/refunds/${r.id}/execute`, { versao: x["versao"] }),
      ),
    ).toEqual([409, "refunds.invalid_transition"]);
    expect(chamadasDeReembolso().length).toBe(1);
    // A consulta diz «reembolsado» (E3): fica executado.
    await confirmar();
    const y = await reembolso(s, r.id);
    expect(y["estado"]).toBe("executado");
    // 17,29 € é o pagamento todo (12,30 € e os portes).
    expect(await estadoDoPagamento(s, e.encomenda)).toBe("reembolsado");
    expect((await ok(s.adm("GET", `/problems/${r.problema}`)))["estado"]).toBe(
      "fechado",
    );
    // A transição do pagamento feita pela tarefa fica ligada a quem pediu o
    // reembolso (docs/28 §3.7; 0060).
    const { rows: tr } = await sql<{ quem: string; a_pedido_de: Json | null }>`
      select t.quem, t.a_pedido_de from transicao_pagamento t
      join pagamento p on p.id = t.pagamento_id
      where p.encomenda_id = ${e.encomenda.slice(4)}::uuid and t.para = 'reembolsado'`.execute(
      base.dono,
    );
    expect(tr).toEqual([
      expect.objectContaining({
        quem: "sistema:reembolsos",
        a_pedido_de: expect.objectContaining({
          quem: expect.stringMatching(/^chave:/) as string,
        }) as unknown,
      }),
    ]);
    const ev = await eventos(s);
    expect(ev).toContain("refund.requested");
    expect(ev.indexOf("refund.requested")).toBeLessThan(
      ev.indexOf("refund.completed"),
    );
    // Executado, a tarefa não volta a consultar.
    const m = eupago.chamadas.length;
    await confirmar();
    expect(eupago.chamadas.length).toBe(m);
  });

  it("recusado fica falhado com o código; sem resposta fica incerto, nunca se repete, e só uma pessoa o reconcilia (P5, P7)", async () => {
    limpar();
    const s = await cenario();
    await comOAuth(s);
    const e = await pagaMbWay(s, [[s.v1, 1]], 223344);
    const r = await reembolsoDeProblema(s, e.encomenda);
    eupago.respostas.reembolso = () =>
      json(400, {
        transactionStatus: "Rejected",
        code: "BAD_REQUEST",
        text: "Service don't have direct refund",
      });
    let v = Number((await reembolso(s, r.id))["versao"]);
    const f = await ok(
      s.adm("POST", `/refunds/${r.id}/execute`, { versao: v }),
    );
    expect(f["estado"]).toBe("falhado");
    expect((await reembolso(s, r.id))["prestador"]).toEqual(
      expect.objectContaining({ recusa: "BAD_REQUEST", referencia: null }),
    );
    // Uma pessoa pede outra vez; o prestador não responde (5xx): incerto.
    eupago.respostas.reembolso = () => json(503, {});
    v = Number(f["versao"]);
    const i = await ok(
      s.adm("POST", `/refunds/${r.id}/execute`, { versao: v }),
    );
    expect(i["estado"]).toBe("incerto");
    expect(
      chamadasDeReembolso().filter((c) => c.url.endsWith("/223344")).length,
    ).toBe(2);
    expect(await diferencas(s)).toEqual([
      expect.objectContaining({
        motivo: "reembolso_incerto",
        estado: "aberta",
        prova: expect.objectContaining({ reembolso: r.id }) as unknown,
      }),
    ]);
    // A tarefa nunca o repete, nem a execução: só a reconciliação.
    await confirmar();
    expect(
      await codigo(
        s.adm("POST", `/refunds/${r.id}/execute`, { versao: i["versao"] }),
      ),
    ).toEqual([409, "refunds.invalid_transition"]);
    expect(
      chamadasDeReembolso().filter((c) => c.url.endsWith("/223344")).length,
    ).toBe(2);
    // Na base, voltar a executar um incerto sem motivo é recusado (P7).
    await expect(
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await trx
          .updateTable("reembolso")
          .set({ estado: "a_executar" })
          .where("id", "=", r.id.slice(4))
          .execute();
      }),
    ).rejects.toThrow(/pede o motivo/);
    // Sem o identificador do prestador, executado não se aceita.
    expect(
      await codigo(
        s.adm("POST", `/refunds/${r.id}/reconcile`, {
          versao: i["versao"],
          resultado: "executado",
          motivo: "visto no back-office",
        }),
      ),
    ).toEqual([400, "refunds.invalid_field"]);
    const k = await ok(
      s.adm("POST", `/refunds/${r.id}/reconcile`, {
        versao: i["versao"],
        resultado: "executado",
        motivo: "visto no back-office da EuPago",
        identificador: "9627",
      }),
    );
    expect(k["estado"]).toBe("executado");
    const x = await reembolso(s, r.id);
    expect(x["prova"]).toEqual(
      expect.objectContaining({ identificador: "9627" }),
    );
    // 17,29 € é o pagamento todo (12,30 € e os portes).
    expect(await estadoDoPagamento(s, e.encomenda)).toBe("reembolsado");
    expect(await diferencas(s)).toEqual([
      expect.objectContaining({
        motivo: "reembolso_incerto",
        estado: "resolvida",
        resolvida_por: expect.stringMatching(/^chave:/) as string,
      }),
    ]);
    delete eupago.respostas.reembolso;
  });

  it("só à mão: o Multibanco (Q8) e uma conta sem OAuth (refunds.manual_only)", async () => {
    limpar();
    const s = await cenario();
    // Multibanco, mesmo com o OAuth na conta.
    await comOAuth(s);
    const mb = await paga(s, [[s.v1, 1]]);
    const r1 = await reembolsoDeProblema(s, mb.encomenda);
    const v1 = (await reembolso(s, r1.id))["versao"];
    expect(
      await codigo(s.adm("POST", `/refunds/${r1.id}/execute`, { versao: v1 })),
    ).toEqual([422, "refunds.manual_only"]);
    expect((await reembolso(s, r1.id))["estado"]).toBe("a_executar");
    // MB WAY numa conta sem o OAuth.
    await ok(
      s.adm("PUT", `/payment-accounts/${s.conta}/credentials`, {
        chave: "xxxx-xxxx-xxxx-xxxx",
        segredo_aviso: SEGREDO,
      }),
      204,
    );
    await ok(s.adm("POST", `/payment-accounts/${s.conta}/test`));
    const mw = await pagaMbWay(s, [[s.v1, 1]], 334455);
    const r2 = await reembolsoDeProblema(s, mw.encomenda);
    const v2 = (await reembolso(s, r2.id))["versao"];
    const n = eupago.chamadas.length;
    expect(
      await codigo(s.adm("POST", `/refunds/${r2.id}/execute`, { versao: v2 })),
    ).toEqual([422, "refunds.manual_only"]);
    expect(eupago.chamadas.length).toBe(n);
    // O client_id sem o client_secret é recusado.
    expect(
      await codigo(
        s.adm("PUT", `/payment-accounts/${s.conta}/credentials`, {
          chave: "xxxx-xxxx-xxxx-xxxx",
          segredo_aviso: SEGREDO,
          client_id: "so-o-id",
        }),
      ),
    ).toEqual([400, "payments.invalid_field"]);
    // O manual continua a servir.
    await ok(
      s.adm("POST", `/refunds/${r2.id}/manual`, {
        versao: v2,
        montante: 1729,
        data: "2026-10-11",
        referencia: "TRF-1",
      }),
    );
  });

  it("a consulta: outro estado não muda nada; 7 dias sem «reembolsado» vão à fila uma vez; a chamada a meio passa a incerto; o aviso Refund acorda ou vai à fila (P6)", async () => {
    limpar();
    const s = await cenario();
    await comOAuth(s);
    const e = await pagaMbWay(s, [[s.v1, 1]], 445566);
    const r = await reembolsoDeProblema(s, e.encomenda);
    let v = (await reembolso(s, r.id))["versao"];
    await ok(s.adm("POST", `/refunds/${r.id}/execute`, { versao: v }));
    eupago.respostas.consultaReembolso = () =>
      json(200, {
        transactionStatus: "Success",
        refundList: { trid: "445566", status: "pendente" },
      });
    await confirmar();
    expect((await reembolso(s, r.id))["estado"]).toBe("a_confirmar");
    // Consultado há menos de um minuto: não se consulta outra vez.
    const n = eupago.chamadas.length;
    await confirmar();
    expect(eupago.chamadas.length).toBe(n);
    // Um aviso Refund deste pagamento acorda a consulta (sem marcar nada).
    const corpo = avisoEuPago({
      identifier: String(e.pagamento["referencia"]),
      status: "Refund",
      valor: 17.29,
      trid: 445566,
      method: "Mbway",
    });
    expect((await aviso(s, corpo)).statusCode).toBe(200);
    expect((await reembolso(s, r.id))["estado"]).toBe("a_confirmar");
    await confirmar();
    expect(eupago.chamadas.length).toBeGreaterThan(n);
    // 8 dias depois, ainda sem «reembolsado»: para a fila, uma vez.
    await pedidoHa(r.id, 8 * 24 * 60);
    await confirmar();
    await pedidoHa(r.id, 8 * 24 * 60);
    await confirmar();
    expect((await diferencas(s)).map((d) => d.motivo)).toEqual([
      "reembolso_por_confirmar",
    ]);
    // Aceite pelo prestador: «não saiu» é recusado (revisão do #350,
    // P1-1); a pessoa dá-o como executado e a diferença fecha.
    v = (await reembolso(s, r.id))["versao"];
    expect(
      await codigo(
        s.adm("POST", `/refunds/${r.id}/reconcile`, {
          versao: v,
          resultado: "nao_saiu",
          motivo: "não aparece no back-office",
        }),
      ),
    ).toEqual([409, "refunds.invalid_transition"]);
    expect(
      (
        await ok(
          s.adm("POST", `/refunds/${r.id}/reconcile`, {
            versao: v,
            resultado: "executado",
            motivo: "visto no back-office",
          }),
        )
      )["estado"],
    ).toBe("executado");
    expect((await diferencas(s))[0]?.estado).toBe("resolvida");
    // A chamada que fica a meio: ao fim de 5 minutos, incerto.
    delete eupago.respostas.consultaReembolso;
    let soltar: () => void = () => undefined;
    eupago.respostas.reembolso = () =>
      new Promise<Response>((ok_) => {
        soltar = () => {
          ok_(json(201, { transactionStatus: "Success", refundId: "77" }));
        };
      });
    const e3 = await pagaMbWay(s, [[s.v1, 1]], 445567);
    const r3 = await reembolsoDeProblema(s, e3.encomenda);
    v = (await reembolso(s, r3.id))["versao"];
    const emCurso = s.adm("POST", `/refunds/${r3.id}/execute`, { versao: v });
    for (
      let i = 0;
      i < 50 && (await reembolso(s, r3.id))["estado"] !== "a_pedir";
      i++
    ) {
      await new Promise((t) => setTimeout(t, 20));
    }
    expect((await reembolso(s, r3.id))["estado"]).toBe("a_pedir");
    await pedidoHa(r3.id, 6);
    await confirmar();
    expect((await reembolso(s, r3.id))["estado"]).toBe("incerto");
    soltar();
    // A resposta tardia não o tira do incerto: decide uma pessoa.
    expect((await ok(emCurso))["estado"]).toBe("incerto");
    delete eupago.respostas.reembolso;
    // Um aviso Refund de um pagamento sem reembolso pedido: para a fila.
    const outra = await pagaMbWay(s, [[s.v2, 2]], 556677);
    expect(
      (
        await aviso(
          s,
          avisoEuPago({
            identifier: String(outra.pagamento["referencia"]),
            status: "Refund",
            valor: 12.3,
            trid: 556677,
            method: "Mbway",
          }),
        )
      ).statusCode,
    ).toBe(200);
    expect((await diferencas(s)).map((d) => d.motivo)).toContain(
      "reembolso_desconhecido",
    );
  });

  it("voltar a a_executar confere outra vez os tectos (P8): um falhado não passa por cima de outro já pago", async () => {
    limpar();
    const s = await cenario();
    await comOAuth(s);
    const e = await pagaMbWay(s, [[s.v1, 1]], 667788);
    const r1 = await reembolsoDeProblema(s, e.encomenda);
    eupago.respostas.reembolso = () =>
      json(400, { transactionStatus: "Rejected", code: "BAD_REQUEST" });
    const v1 = (await reembolso(s, r1.id))["versao"];
    const f = await ok(
      s.adm("POST", `/refunds/${r1.id}/execute`, { versao: v1 }),
    );
    expect(f["estado"]).toBe("falhado");
    delete eupago.respostas.reembolso;
    // Falhado não conta: outro problema reembolsa a mesma linha, à mão.
    const prb = await ok(
      s.adm("POST", "/problems", {
        encomenda: e.encomenda,
        tipo: "outro",
        descricao: "outra vez",
      }),
      201,
    );
    const d = await ok(
      s.adm("POST", `/problems/${String(prb["id"])}/decide`, {
        versao: 1,
        linhas: [{ linha: r1.linha, quantidade: 1 }],
        incluir_portes: true,
        motivo: "reembolsar já",
      }),
      201,
    );
    const r2 = String(d["reembolso"]);
    await ok(
      s.adm("POST", `/refunds/${r2}/manual`, {
        versao: (await reembolso(s, r2))["versao"],
        montante: 1729,
        data: "2026-10-11",
        referencia: "TRF-2",
      }),
    );
    // Pedir outra vez o primeiro passaria o pago: a base recusa.
    const n = chamadasDeReembolso().length;
    expect(
      await codigo(
        s.adm("POST", `/refunds/${r1.id}/execute`, { versao: f["versao"] }),
      ),
    ).toEqual([422, "refunds.exceeds_paid"]);
    expect(chamadasDeReembolso().length).toBe(n);
    expect((await reembolso(s, r1.id))["estado"]).toBe("falhado");
  });

  // ---------------------------- Revisão do #350 (P1-1, P2-1 a P2-6)

  it("aceite pelo prestador não volta a pedir-se (P1-1); a recusa não passa à tentativa seguinte (P2-1); a base recusa os atalhos", async () => {
    limpar();
    const s = await cenario();
    await comOAuth(s);
    const e = await pagaMbWay(s, [[s.v1, 1]], 778899);
    const r = await reembolsoDeProblema(s, e.encomenda);
    // Primeiro recusado, depois aceite: a recusa antiga não aparece.
    eupago.respostas.reembolso = () =>
      json(400, { transactionStatus: "Rejected", code: "" });
    const v = (await reembolso(s, r.id))["versao"];
    const f = await ok(
      s.adm("POST", `/refunds/${r.id}/execute`, { versao: v }),
    );
    expect(f["estado"]).toBe("falhado");
    // Um código vazio fica «Rejected» (revisão do #350, P3).
    expect(((await reembolso(s, r.id))["prestador"] as Json)["recusa"]).toBe(
      "Rejected",
    );
    delete eupago.respostas.reembolso;
    eupago.respostas.consultaReembolso = () =>
      json(200, { transactionStatus: "Success", refundList: [] });
    await ok(
      s.adm("POST", `/refunds/${r.id}/execute`, { versao: f["versao"] }),
    );
    const x = await reembolso(s, r.id);
    expect(x["estado"]).toBe("a_confirmar");
    expect((x["prestador"] as Json)["recusa"]).toBeNull();
    // «Não saiu» sobre um pedido aceite: recusado, nunca se pede outra vez.
    expect(
      await codigo(
        s.adm("POST", `/refunds/${r.id}/reconcile`, {
          versao: x["versao"],
          resultado: "nao_saiu",
          motivo: "não aparece",
        }),
      ),
    ).toEqual([409, "refunds.invalid_transition"]);
    // Um motivo só de espaços não é motivo.
    expect(
      (
        await s.adm("POST", `/refunds/${r.id}/reconcile`, {
          versao: x["versao"],
          resultado: "executado",
          motivo: "   ",
        })
      ).statusCode,
    ).toBe(400);
    // A base: nem a_confirmar → a_executar (com motivo), nem mudar a
    // referência do prestador, nem o trid do pagamento.
    const naBaseComo = (
      fn: (
        t: Parameters<Parameters<typeof comComerciante>[2]>[0],
      ) => Promise<unknown>,
    ) =>
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true),
          set_config('eurolify.motivo', 'tentar', true),
          set_config('eurolify.origem', 'pessoa', true)`.execute(trx);
        await fn(trx);
      });
    await expect(
      naBaseComo((t) =>
        t
          .updateTable("reembolso")
          .set({ estado: "a_executar" })
          .where("id", "=", r.id.slice(4))
          .execute(),
      ),
    ).rejects.toThrow(/a_confirmar → a_executar/);
    await expect(
      naBaseComo((t) =>
        t
          .updateTable("reembolso")
          .set({ referencia_prestador: "1" })
          .where("id", "=", r.id.slice(4))
          .execute(),
      ),
    ).rejects.toThrow(/só se grava quando ele aceita/);
    await expect(
      naBaseComo((t) =>
        t
          .updateTable("pagamento")
          .set({ id_transaccao_prestador: "1" })
          .where("encomenda_id", "=", e.encomenda.slice(4))
          .execute(),
      ),
    ).rejects.toThrow(/não muda/);
    // Uma lista vazia na consulta não conta como reembolsado (P2-5).
    await confirmar();
    expect((await reembolso(s, r.id))["estado"]).toBe("a_confirmar");
    // A pessoa dá-o como executado (a referência do prestador é a prova).
    expect(
      (
        await ok(
          s.adm("POST", `/refunds/${r.id}/reconcile`, {
            versao: x["versao"],
            resultado: "executado",
            motivo: "visto no back-office",
          }),
        )
      )["estado"],
    ).toBe("executado");
    // Na base, um reembolso que não está a executar não salta para a_confirmar.
    const outro = await pagaMbWay(s, [[s.v1, 1]], 778900);
    const r2 = await reembolsoDeProblema(s, outro.encomenda);
    await expect(
      naBaseComo((t) =>
        t
          .updateTable("reembolso")
          .set({ estado: "a_confirmar", referencia_prestador: "5" })
          .where("id", "=", r2.id.slice(4))
          .execute(),
      ),
    ).rejects.toThrow(
      /a_executar → a_confirmar|só se grava|pedido ao prestador/,
    );
  });

  it("dois pedidos ao mesmo tempo saem uma vez; durante o pedido não se pede outro; sem token nada sai; aceite sem referência fica incerto (P2-6)", async () => {
    limpar();
    const s = await cenario();
    await comOAuth(s);
    const e = await pagaMbWay(s, [[s.v1, 1]], 889900);
    const r = await reembolsoDeProblema(s, e.encomenda);
    let soltar: () => void = () => undefined;
    eupago.respostas.reembolso = () =>
      new Promise<Response>((fim) => {
        soltar = () => {
          fim(json(201, { transactionStatus: "Success", refundId: "5001" }));
        };
      });
    const v = (await reembolso(s, r.id))["versao"];
    const n = chamadasDeReembolso().length;
    const [a, b] = [
      s.adm("POST", `/refunds/${r.id}/execute`, { versao: v }),
      s.adm("POST", `/refunds/${r.id}/execute`, { versao: v }),
    ];
    for (
      let i = 0;
      i < 50 && (await reembolso(s, r.id))["estado"] !== "a_pedir";
      i++
    ) {
      await new Promise((t) => setTimeout(t, 20));
    }
    // Durante o pedido, com a versão de agora: recusado (é o `a_pedir`).
    const agora = await reembolso(s, r.id);
    expect(agora["estado"]).toBe("a_pedir");
    expect(
      await codigo(
        s.adm("POST", `/refunds/${r.id}/execute`, { versao: agora["versao"] }),
      ),
    ).toEqual([409, "refunds.invalid_transition"]);
    soltar();
    const respostas = [await a, await b].map((x) => x.statusCode).sort();
    expect(respostas).toEqual([200, 409]);
    expect(chamadasDeReembolso().length - n).toBe(1);
    delete eupago.respostas.reembolso;
    // O token recusado: nada saiu, falhado com o motivo.
    const e2 = await pagaMbWay(s, [[s.v1, 1]], 889901);
    const r2 = await reembolsoDeProblema(s, e2.encomenda);
    eupago.respostas.token = () =>
      json(401, {
        transactionStatus: "Rejected",
        code: "TOKEN_INVALID",
        text: "Token is invalid",
      });
    const m = chamadasDeReembolso().length;
    const f = await ok(
      s.adm("POST", `/refunds/${r2.id}/execute`, {
        versao: (await reembolso(s, r2.id))["versao"],
      }),
    );
    expect(f["estado"]).toBe("falhado");
    expect(chamadasDeReembolso().length).toBe(m);
    delete eupago.respostas.token;
    // Aceite sem refundId: não se sabe o que saiu, incerto.
    eupago.respostas.reembolso = () =>
      json(201, { transactionStatus: "Success" });
    const i = await ok(
      s.adm("POST", `/refunds/${r2.id}/execute`, { versao: f["versao"] }),
    );
    expect(i["estado"]).toBe("incerto");
    delete eupago.respostas.reembolso;
  });

  it("outro comerciante não executa nem reconcilia; as credenciais OAuth nunca saem nem ficam em claro (P2-6)", async () => {
    limpar();
    const s = await cenario();
    await comOAuth(s);
    const e = await pagaMbWay(s, [[s.v1, 1]], 990011);
    const r = await reembolsoDeProblema(s, e.encomenda);
    const vizinho = await cenario();
    const v = (await reembolso(s, r.id))["versao"];
    expect(
      await codigo(
        vizinho.adm("POST", `/refunds/${r.id}/execute`, { versao: v }),
      ),
    ).toEqual([404, "refunds.not_found"]);
    expect(
      await codigo(
        vizinho.adm("POST", `/refunds/${r.id}/reconcile`, {
          versao: v,
          resultado: "nao_saiu",
          motivo: "vizinho",
        }),
      ),
    ).toEqual([404, "refunds.not_found"]);
    expect((await reembolso(s, r.id))["estado"]).toBe("a_executar");
    const contas = await s.adm("GET", "/payment-accounts");
    expect(contas.body).not.toContain("segredo-oauth-1");
    expect(contas.body).not.toContain("cliente-1");
    const { rows } = await sql<{ c: Buffer }>`
      select credenciais_cifra as c from conta_pagamento
      where id = ${s.conta.slice(4)}::uuid`.execute(base.dono);
    expect(rows[0]?.c.toString("latin1")).not.toContain("segredo-oauth-1");
  });

  it("o aviso Refund: depois de confirmado não é alarme; com um incerto vai à fila ao lado dele; dois reembolsos do mesmo pagamento são dois avisos (P2-3, P2-4)", async () => {
    limpar();
    const s = await cenario();
    await comOAuth(s);
    const e = await pagaMbWay(s, [[s.v1, 2]], 101112);
    const r = await reembolsoDeProblema(s, e.encomenda);
    await ok(
      s.adm("POST", `/refunds/${r.id}/execute`, {
        versao: (await reembolso(s, r.id))["versao"],
      }),
    );
    await confirmar();
    const refund = (valor: number, date: string) =>
      JSON.stringify({
        transactions: {
          entity: 12345,
          reference: 123456789,
          identifier: String(e.pagamento["referencia"]),
          method: "Mbway",
          amount: { value: valor, currency: "EUR" },
          date,
          trid: 101112,
          status: "Refund",
        },
      });
    // O aviso do reembolso já confirmado: sem alarme.
    expect(
      (await aviso(s, refund(17.29, "2026-10-11T10:00:00Z"))).statusCode,
    ).toBe(200);
    expect(await diferencas(s)).toEqual([]);
    // Um segundo reembolso, que o Eurolify não pediu: outro evento, à fila.
    expect((await aviso(s, refund(5, "2026-10-11T11:00:00Z"))).statusCode).toBe(
      200,
    );
    expect((await diferencas(s)).map((d) => d.motivo)).toEqual([
      "reembolso_desconhecido",
    ]);
    // Um reembolso incerto e o aviso dele: a prova vai à fila, ao lado.
    const prb = await ok(
      s.adm("POST", "/problems", {
        encomenda: e.encomenda,
        tipo: "outro",
        descricao: "a segunda unidade",
      }),
      201,
    );
    const d = await ok(
      s.adm("POST", `/problems/${String(prb["id"])}/decide`, {
        versao: 1,
        linhas: [{ linha: r.linha, quantidade: 1 }],
        motivo: "a segunda",
      }),
      201,
    );
    const r2 = String(d["reembolso"]);
    eupago.respostas.reembolso = () => json(503, {});
    expect(
      (
        await ok(
          s.adm("POST", `/refunds/${r2}/execute`, {
            versao: (await reembolso(s, r2))["versao"],
          }),
        )
      )["estado"],
    ).toBe("incerto");
    delete eupago.respostas.reembolso;
    expect(
      (await aviso(s, refund(12.3, "2026-10-11T12:00:00Z"))).statusCode,
    ).toBe(200);
    const fila = (await diferencas(s)).filter(
      (x) => x.motivo === "reembolso_incerto",
    );
    expect(fila).toHaveLength(2);
    expect(fila[1]?.prova).toEqual(
      expect.objectContaining({ reembolso: r2 }) as unknown,
    );
  });

  it("com fatura do Eurolify: a NC espera pela confirmação do prestador e sai depois (P2-6)", async () => {
    limpar();
    const s = await cenario();
    await ligar(s, `c-${randomUUID()}`);
    await comOAuth(s);
    const e = await pagaMbWay(s, [[s.v1, 1]], 121314, "501964843");
    await ateParar();
    const r = await reembolsoDeProblema(s, e.encomenda);
    await ok(
      s.adm("POST", `/refunds/${r.id}/execute`, {
        versao: (await reembolso(s, r.id))["versao"],
      }),
    );
    await ateParar();
    expect((await documentosDe(s, e.encomenda)).notas[0]).toMatchObject({
      estado: "retido",
      motivos: ["reembolso_por_executar"],
    });
    await confirmar();
    await ateParar();
    const { notas } = await documentosDe(s, e.encomenda);
    expect(notas.map((n) => n["estado"])).toEqual(["emitido"]);
  });

  // ------------------------------- O aviso do prazo do reembolso (docs/30 §14)

  /** O pedido de livre resolução da devolução passa para há `dias` dias. */
  const pedidoHaDias = (rma: string, dias: number) =>
    base.dono.transaction().execute(async (t) => {
      await sql`alter table pedido_livre_resolucao disable trigger pedido_livre_resolucao_antes_de_gravar`.execute(
        t,
      );
      // Ao meio-dia de Lisboa, há `dias` dias de calendário: longe da
      // meia-noite e da mudança de hora (revisão do #353).
      await sql`update pedido_livre_resolucao
        set recebido_em = (((now() at time zone 'Europe/Lisbon')::date - ${dias}::int)::timestamp
          + interval '12 hours') at time zone 'Europe/Lisbon'
        where id = (select pedido_livre_resolucao_id from devolucao where id = ${rma.slice(4)}::uuid)`.execute(
        t,
      );
      await sql`alter table pedido_livre_resolucao enable always trigger pedido_livre_resolucao_antes_de_gravar`.execute(
        t,
      );
      // O relógio da tarefa: a próxima volta olha para ela já.
      await sql`update tarefa_prazo_reembolso set quando = now()
        where devolucao_id = ${rma.slice(4)}::uuid`.execute(t);
    });
  const tarefaDoPrazo = async (rma: string) =>
    (
      await sql<{ quando: Date }>`select quando from tarefa_prazo_reembolso
        where devolucao_id = ${rma.slice(4)}::uuid`.execute(base.dono)
    ).rows[0] ?? null;
  const eventosDoPrazo = async (s: Cenario, rma: string) =>
    (
      await sql<{
        tipo: string;
        dados: Json;
      }>`select tipo, dados from evento_saida
        where comerciante_id = ${s.c}::uuid and agregado_id = ${rma.slice(4)}::uuid
          and tipo like 'refund.deadline%' order by id`.execute(base.dono)
    ).rows;
  const prazos = async () => {
    const r = await correrAvisosDePrazo(base.api);
    expect(r.erros).toEqual([]);
    return r;
  };
  const naLista = async (s: Cenario, prazo: "a_acabar" | "passado") =>
    (
      (await ok(s.adm("GET", `/returns?prazo_reembolso=${prazo}`)))[
        "dados"
      ] as Json[]
    ).map((d) => d["id"]);

  it("o aviso do prazo: 3 dias antes e quando passa, uma vez cada, como evento e na lista; fecha com o reembolso (R10, A1 a A5)", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 2]]);
    const [linha] = await expedir(s, e.encomenda);
    const w = await ok(
      pedir("POST", `/store/orders/${e.token}/withdrawal`, {
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
      }),
      201,
    );
    const rma = String(
      (await ok(s.adm("GET", `/withdrawals/${String(w["pedido"])}`)))[
        "devolucao"
      ],
    );
    // Acabada de pedir: 14 dias, e a tarefa marcada para daqui a 11.
    const d0 = await ok(s.adm("GET", `/returns/${rma}`));
    expect(d0["dias_para_reembolsar"]).toBe(14);
    const t0 = await tarefaDoPrazo(rma);
    expect(t0).not.toBeNull();
    expect(
      Math.round(((t0?.quando.getTime() ?? 0) - Date.now()) / 86_400_000),
    ).toBeGreaterThanOrEqual(10);
    // A tarefa olha cedo de mais: nada, e volta à hora certa.
    await sql`update tarefa_prazo_reembolso set quando = now()
      where devolucao_id = ${rma.slice(4)}::uuid`.execute(base.dono);
    await prazos();
    expect(await eventosDoPrazo(s, rma)).toEqual([]);
    expect(
      ((await tarefaDoPrazo(rma))?.quando.getTime() ?? 0) > Date.now(),
    ).toBe(true);
    // Faltam 2 dias: o aviso, uma vez, e a devolução na lista «a acabar».
    await pedidoHaDias(rma, 12);
    await prazos();
    await prazos();
    let ev = await eventosDoPrazo(s, rma);
    expect(ev).toEqual([
      expect.objectContaining({
        tipo: "refund.deadline_approaching",
        dados: expect.objectContaining({
          id: rma.slice(4),
          encomenda_id: e.encomenda.slice(4),
          dias: 2,
        }) as unknown,
      }),
    ]);
    // Sem dados pessoais no evento.
    expect(JSON.stringify(ev)).not.toContain("rui@exemplo.pt");
    expect(await naLista(s, "a_acabar")).toContain(rma);
    expect(await naLista(s, "passado")).not.toContain(rma);
    // Avisado, a tarefa volta no início do dia seguinte ao último (Lisboa).
    const quando = (await tarefaDoPrazo(rma))?.quando;
    const ate = String(
      (await ok(s.adm("GET", `/returns/${rma}`)))["reembolsar_ate"],
    );
    const { rows: hora } = await sql<{ esperada: Date }>`
      select ((${ate}::date + 1)::timestamp at time zone 'Europe/Lisbon') as esperada`.execute(
      base.dono,
    );
    expect(quando?.getTime()).toBe(hora[0]?.esperada.getTime());
    // Outra volta que a leia já avisada (a corrida): não avisa outra vez.
    await sql`update tarefa_prazo_reembolso set quando = now()
      where devolucao_id = ${rma.slice(4)}::uuid`.execute(base.dono);
    expect((await prazos()).avisados).toBe(0);
    expect((await eventosDoPrazo(s, rma)).length).toBe(1);
    // Passou: o segundo aviso, uma vez, e a tarefa acaba.
    await pedidoHaDias(rma, 15);
    await prazos();
    ev = await eventosDoPrazo(s, rma);
    expect(ev.map((x) => x.tipo)).toEqual([
      "refund.deadline_approaching",
      "refund.deadline_passed",
    ]);
    expect(ev[1]?.dados["dias"]).toBe(-1);
    expect(await tarefaDoPrazo(rma)).toBeNull();
    expect(await naLista(s, "passado")).toContain(rma);
    expect(await naLista(s, "a_acabar")).not.toContain(rma);
    // Os avisos não mudam nem se repetem.
    await expect(
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await trx
          .updateTable("devolucao")
          .set({ aviso_prazo_em: new Date() })
          .where("id", "=", rma.slice(4))
          .execute();
      }),
    ).rejects.toThrow(/um aviso do prazo não muda/);
    // O reembolso feito: a devolução fecha e sai da lista.
    await ok(
      s.adm("POST", `/returns/${rma}/receive`, {
        versao: 1,
        linhas: [{ linha: linha?.["id"], recebida: 1 }],
      }),
    );
    await ok(
      s.adm("POST", `/returns/${rma}/inspect`, {
        versao: 2,
        linhas: [
          { linha: linha?.["id"], estado_artigo: "revendavel", aceite: 1 },
        ],
      }),
    );
    const r = await ok(
      s.adm("POST", `/returns/${rma}/decide`, {
        versao: 3,
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
        motivo: "livre resolução",
      }),
      201,
    );
    await ok(
      s.adm("POST", `/refunds/${String(r["reembolso"])}/manual`, {
        versao: (await reembolso(s, String(r["reembolso"])))["versao"],
        montante: 1230,
        data: "2026-10-11",
        referencia: "TRF-9",
      }),
    );
    expect(await naLista(s, "passado")).not.toContain(rma);
  });

  it("o prazo no fuso do comerciante; sem livre resolução não há prazo nem tarefa; cancelada, a tarefa sai (A1, A2)", async () => {
    // 01/10 às 23:30 UTC é 02/10 às 00:30 em Lisboa: o prazo é 16/10, não 15/10.
    const { rows } = await sql<{ lisboa: string; utc: string }>`
      select to_char(posvenda_reembolsar_ate(timestamptz '2026-10-01 23:30:00+00', 'Europe/Lisbon'), 'YYYY-MM-DD') as lisboa,
             to_char(posvenda_reembolsar_ate(timestamptz '2026-10-01 23:30:00+00', 'UTC'), 'YYYY-MM-DD') as utc`.execute(
      base.dono,
    );
    expect(rows[0]).toEqual({ lisboa: "2026-10-16", utc: "2026-10-15" });
    const s = await cenario();
    const e = await paga(s, [[s.v1, 2]]);
    const [linha] = await expedir(s, e.encomenda);
    // Uma devolução do apoio: sem prazo legal, sem tarefa, e a base recusa
    // um aviso nela.
    const apoio = await ok(
      s.adm("POST", "/returns", {
        encomenda: e.encomenda,
        origem: "apoio",
        motivo: "troca combinada",
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
      }),
      201,
    );
    const rmaApoio = String(apoio["id"]);
    expect(
      (await ok(s.adm("GET", `/returns/${rmaApoio}`)))["reembolsar_ate"],
    ).toBeNull();
    expect(await tarefaDoPrazo(rmaApoio)).toBeNull();
    await expect(
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await trx
          .updateTable("devolucao")
          .set({ aviso_prazo_em: new Date() })
          .where("id", "=", rmaApoio.slice(4))
          .execute();
      }),
    ).rejects.toThrow(/só uma devolução de livre resolução/);
    // Uma de livre resolução cancelada: a tarefa sai, e não avisa.
    const w = await ok(
      pedir("POST", `/store/orders/${e.token}/withdrawal`, {
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
      }),
      201,
    );
    const rma = String(
      (await ok(s.adm("GET", `/withdrawals/${String(w["pedido"])}`)))[
        "devolucao"
      ],
    );
    expect(await tarefaDoPrazo(rma)).not.toBeNull();
    await ok(
      s.adm("POST", `/returns/${rma}/cancel`, {
        versao: 1,
        motivo: "o cliente desistiu",
      }),
    );
    expect(await tarefaDoPrazo(rma)).toBeNull();
    await pedidoHaDias(rma, 20);
    await prazos();
    expect(await eventosDoPrazo(s, rma)).toEqual([]);
  });

  it("revisão do #353: passado sem o aviso, duas voltas ao mesmo tempo, a base recusa fora de hora e na cancelada, anulado continua à espera, fora de prazo sem aviso", async () => {
    const s = await cenario();
    const e = await paga(s, [[s.v1, 2]]);
    const [linha] = await expedir(s, e.encomenda);
    const pedirUma = async () => {
      const w = await ok(
        pedir("POST", `/store/orders/${e.token}/withdrawal`, {
          linhas: [{ linha: linha?.["id"], quantidade: 1 }],
        }),
        201,
      );
      return String(
        (await ok(s.adm("GET", `/withdrawals/${String(w["pedido"])}`)))[
          "devolucao"
        ],
      );
    };
    const comoPessoa = (
      fn: (
        t: Parameters<Parameters<typeof comComerciante>[2]>[0],
      ) => Promise<unknown>,
    ) =>
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await fn(trx);
      });
    // A base recusa um aviso fora de hora (faltam 14 dias).
    const a = await pedirUma();
    await expect(
      comoPessoa((t) =>
        t
          .updateTable("devolucao")
          .set({ aviso_prazo_em: new Date() })
          .where("id", "=", a.slice(4))
          .execute(),
      ),
    ).rejects.toThrow(/ainda não é hora do aviso/);
    // Passado sem o primeiro aviso (a tarefa não correu): sai só o de
    // passado, e duas voltas ao mesmo tempo dão um evento.
    await pedidoHaDias(a, 16);
    const [r1, r2] = await Promise.all([
      correrAvisosDePrazo(base.api),
      correrAvisosDePrazo(base.api),
    ]);
    expect([...r1.erros, ...r2.erros]).toEqual([]);
    expect(r1.passados + r2.passados).toBe(1);
    expect((await eventosDoPrazo(s, a)).map((x) => x.tipo)).toEqual([
      "refund.deadline_passed",
    ]);
    // A outra volta que leu a tarefa antes de ela sair (a corrida): não
    // marca outra vez, não dá erro, não sai outro evento.
    await sql`insert into tarefa_prazo_reembolso (devolucao_id, comerciante_id, quando)
      values (${a.slice(4)}::uuid, ${s.c}::uuid, now())`.execute(base.dono);
    const r3 = await correrAvisosDePrazo(base.api);
    expect(r3.erros).toEqual([]);
    expect(r3.passados).toBe(0);
    expect((await eventosDoPrazo(s, a)).map((x) => x.tipo)).toEqual([
      "refund.deadline_passed",
    ]);
    // Numa cancelada, a base recusa marcar (a corrida com o cancelamento).
    await ok(
      s.adm("POST", `/returns/${a}/cancel`, { versao: 1, motivo: "desistiu" }),
    );
    // Fechada ou cancelada, já não conta os dias.
    expect(
      (await ok(s.adm("GET", `/returns/${a}`)))["dias_para_reembolsar"],
    ).toBeNull();
    const b = await pedirUma();
    await pedidoHaDias(b, 12);
    await ok(
      s.adm("POST", `/returns/${b}/cancel`, { versao: 1, motivo: "desistiu" }),
    );
    await expect(
      comoPessoa((t) =>
        t
          .updateTable("devolucao")
          .set({ aviso_prazo_em: new Date() })
          .where("id", "=", b.slice(4))
          .execute(),
      ),
    ).rejects.toThrow(/já não espera/);
    // Um reembolso anulado: a devolução volta a inspeccionada e a tarefa fica.
    const e2 = await paga(s, [[s.v1, 1]]);
    const [l2] = await expedir(s, e2.encomenda);
    const rma = await devolvidaEInspeccionada(s, e2.token, [
      { linha: l2?.["id"], quantidade: 1 },
    ]);
    const d = await ok(
      s.adm("POST", `/returns/${rma}/decide`, {
        versao: 3,
        linhas: [{ linha: l2?.["id"], quantidade: 1 }],
        motivo: "livre resolução",
      }),
      201,
    );
    expect(await tarefaDoPrazo(rma)).not.toBeNull();
    await ok(
      s.adm("POST", `/refunds/${String(d["reembolso"])}/cancel`, {
        versao: (await reembolso(s, String(d["reembolso"])))["versao"],
        motivo: "decisão errada",
      }),
    );
    expect((await ok(s.adm("GET", `/returns/${rma}`)))["estado"]).toBe(
      "inspeccionada",
    );
    expect(await tarefaDoPrazo(rma)).not.toBeNull();
    // Um pedido fora de prazo aceite pela loja: sem prazo legal, sem tarefa.
    const e3 = await paga(s, [[s.v1, 1]]);
    const [l3] = await expedir(s, e3.encomenda);
    await entregueHa(e3.encomenda, 20);
    const w = await ok(
      pedir("POST", `/store/orders/${e3.token}/withdrawal`, {
        linhas: [{ linha: l3?.["id"], quantidade: 1 }],
      }),
      201,
    );
    const aceite = await ok(
      s.adm("POST", `/withdrawals/${String(w["pedido"])}/decide`, {
        versao: 1,
        decisao: "aceitar",
        motivo: "gesto comercial",
      }),
    );
    const fora = String(aceite["devolucao"]);
    expect(
      (await ok(s.adm("GET", `/returns/${fora}`)))["reembolsar_ate"],
    ).toBeNull();
    expect(await tarefaDoPrazo(fora)).toBeNull();
  });

  // ------------------------------------- «Selado por higiene» (docs/30 §15)

  /** Marca (ou desmarca) o artigo do cenário pelo PATCH. */
  const selar = async (s: Cenario, selado = true) => {
    const a = await ok(s.adm("GET", `/products/prd_${s.artigo}`));
    return ok(
      s.adm("PATCH", `/products/prd_${s.artigo}`, {
        versao: a["versao"],
        selado_por_higiene: selado,
      }),
    );
  };

  /** Pede pelo botão, recebe tudo e inspecciona com os estados dados. */
  async function inspeccionadaCom(
    s: Cenario,
    token: string,
    linhas: { linha: unknown; quantidade: number; estado: string }[],
  ) {
    const w = await ok(
      pedir("POST", `/store/orders/${token}/withdrawal`, {
        linhas: linhas.map((l) => ({
          linha: l.linha,
          quantidade: l.quantidade,
        })),
      }),
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
          estado_artigo: l.estado,
          aceite: l.estado === "revendavel" ? l.quantidade : 0,
        })),
      }),
    );
    return rma;
  }

  it("selado por higiene: a marca no artigo, no resumo, na encomenda e na confirmação; mudada depois do resumo, não há encomenda (H1 a H3)", async () => {
    const s = await cenario();
    expect(
      (await ok(s.adm("GET", `/products/prd_${s.artigo}`)))[
        "selado_por_higiene"
      ],
    ).toBe(false);
    expect((await selar(s))["selado_por_higiene"]).toBe(true);
    // Só num físico (H1): um serviço não se sela.
    const servico = await criarArtigo(
      base.api,
      s.c,
      { tipo: "servico", nome: "Formação", categoria_fiscal: "normal" },
      [{ sku: "FORM-1", unidade_de_venda: "unidade" }],
    );
    expect(
      await codigo(
        s.adm("PATCH", `/products/prd_${servico}`, {
          versao: 1,
          selado_por_higiene: true,
        }),
      ),
    ).toEqual([422, "catalog.nature_incompatible"]);
    // O resumo mostra-a por linha; a encomenda e a confirmação também.
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    const r = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    expect(r["linhas"]).toEqual([
      expect.objectContaining({ sku: "GEL-001", selado_por_higiene: true }),
    ]);
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    const enc = await ok(s.adm("GET", `/orders/${String(e["encomenda"])}`));
    expect(enc["linhas"]).toEqual([
      expect.objectContaining({ sku: "GEL-001", selado_por_higiene: true }),
    ]);
    const conf = await ok(pedir("GET", `/checkout/${k.token}/confirmation`));
    expect(conf["linhas"]).toEqual([
      expect.objectContaining({ selado_por_higiene: true }),
    ]);
    // A marca muda entre o resumo e o botão: o cliente não viu a de agora.
    const k2 = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k2.token);
    const r2 = await ok(pedir("GET", `/checkout/${k2.token}/summary`));
    await selar(s, false);
    expect(
      await codigo(
        botao(k2.token, {
          aceita_condicoes: true,
          versoes: s.versoes,
          impressao: r2["impressao"],
        }),
      ),
    ).toEqual([409, "checkout.total_changed"]);
    // Sem a marca, a impressão é a de antes da marca existir: a fórmula
    // antiga, só montantes e versões (revisão do #363, P2-4).
    const r3 = await ok(pedir("GET", `/checkout/${k2.token}/summary`));
    expect(r3["impressao"]).not.toBe(r2["impressao"]);
    expect(
      (r3["linhas"] as Json[]).map((l) => l["selado_por_higiene"]),
    ).toEqual([false]);
    const sp = (x: unknown) => String(x).slice(4);
    const portes = r3["portes"] as Json;
    const antiga = {
      moeda: r3["moeda"],
      linhas: (r3["linhas"] as Json[]).map((l) => [
        sp(l["variante"]),
        l["quantidade"],
        l["base"],
        l["valor_iva"],
        l["total"],
      ]),
      portes: [
        sp(portes["metodo"]),
        portes["base"],
        portes["valor_iva"],
        portes["total"],
      ],
      total: (r3["totais"] as Json)["total"],
      textos: (r3["textos"] as Json[]).map((t) => sp(t["versao"])),
    };
    expect(r3["impressao"]).toBe(
      createHash("sha256").update(canonico(antiga)).digest("hex"),
    );
    // E ao contrário: marcada entre o resumo e o botão, também não.
    await selar(s, true);
    expect(
      await codigo(
        botao(k2.token, {
          aceita_condicoes: true,
          versoes: s.versoes,
          impressao: r3["impressao"],
        }),
      ),
    ).toEqual([409, "checkout.total_changed"]);
    // A base confere a cópia: com o artigo marcado, uma linha sem a marca
    // não entra.
    await expect(
      base.dono.transaction().execute(async (t) => {
        await sql`alter table linha_encomenda disable trigger linha_encomenda_antes_de_gravar`.execute(
          t,
        );
        await sql`insert into linha_encomenda (comerciante_id, encomenda_id, posicao,
            variante_id, sku, nome, quantidade, preco_unitario, preco, decisao_iva,
            base, iva, total, selado_por_higiene)
          select comerciante_id, encomenda_id, 99, variante_id, sku, nome, quantidade,
            preco_unitario, preco, decisao_iva, base, iva, total, false
          from linha_encomenda where encomenda_id = ${String(e["encomenda"]).slice(4)}::uuid`.execute(
          t,
        );
      }),
    ).rejects.toThrow(/checkout\.total_changed/);
  });

  it("selado por higiene: aberto, uma pessoa decide linha a linha; sem decisão não se decide nem fecha; a excepção não se reembolsa (H4 a H6)", async () => {
    const s = await cenario();
    await selar(s);
    const e = await paga(s, [
      [s.v1, 2],
      [s.v2, 2],
    ]);
    const [l1, l2] = await expedir(s, e.encomenda);
    // O botão continua (H4) e diz que o artigo é selado.
    const v = await ok(pedir("GET", `/store/orders/${e.token}/withdrawal`));
    expect((v["linhas"] as Json[]).map((l) => l["selado_por_higiene"])).toEqual(
      [true, true],
    );
    const rma = await inspeccionadaCom(s, e.token, [
      { linha: l1?.["id"], quantidade: 2, estado: "aberto" },
      { linha: l2?.["id"], quantidade: 2, estado: "revendavel" },
    ]);
    let d = await ok(s.adm("GET", `/returns/${rma}`));
    expect(d["linhas"]).toEqual([
      expect.objectContaining({
        linha: l1?.["id"],
        selado_por_higiene: true,
        higiene_a_decidir: true,
        decisao_higiene: null,
      }),
      // O selo intacto devolve-se como qualquer outro (H5).
      expect.objectContaining({
        linha: l2?.["id"],
        selado_por_higiene: true,
        higiene_a_decidir: false,
        decisao_higiene: null,
      }),
    ]);
    const todas = [
      { linha: l1?.["id"], quantidade: 2 },
      { linha: l2?.["id"], quantidade: 2 },
    ];
    // Sem a decisão: nem o reembolso, nem o fecho (sem omissão).
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/decide`, {
          versao: 3,
          linhas: todas,
          motivo: "livre resolução",
        }),
      ),
    ).toEqual([422, "returns.hygiene_decision_required"]);
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/decide`, {
          versao: 3,
          linhas: [{ linha: l2?.["id"], quantidade: 2 }],
          motivo: "livre resolução",
        }),
      ),
    ).toEqual([422, "returns.hygiene_decision_required"]);
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/close`, {
          versao: 3,
          motivo: "aberto",
        }),
      ),
    ).toEqual([422, "returns.hygiene_decision_required"]);
    // Numa linha que não voltou aberta não há decisão a dar.
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/decide`, {
          versao: 3,
          linhas: todas,
          motivo: "livre resolução",
          higiene: [
            { linha: l1?.["id"], decisao: "reembolsar" },
            { linha: l2?.["id"], decisao: "reembolsar" },
          ],
        }),
      ),
    ).toEqual([400, "returns.invalid_field"]);
    // A excepção não vai no reembolso; «reembolsar» vai.
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/decide`, {
          versao: 3,
          linhas: todas,
          motivo: "livre resolução",
          higiene: [{ linha: l1?.["id"], decisao: "excepcao_higiene" }],
        }),
      ),
    ).toEqual([400, "refunds.invalid_field"]);
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/decide`, {
          versao: 3,
          linhas: [{ linha: l2?.["id"], quantidade: 2 }],
          motivo: "livre resolução",
          higiene: [{ linha: l1?.["id"], decisao: "reembolsar" }],
        }),
      ),
    ).toEqual([400, "returns.invalid_field"]);
    // Fechar sem reembolso contradiz «reembolsar».
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma}/close`, {
          versao: 3,
          motivo: "aberto",
          higiene: [{ linha: l1?.["id"], decisao: "reembolsar" }],
        }),
      ),
    ).toEqual([400, "returns.invalid_field"]);
    // Nada ficou gravado das tentativas.
    d = await ok(s.adm("GET", `/returns/${rma}`));
    expect(d).toMatchObject({ estado: "inspeccionada", versao: 3 });
    expect((d["linhas"] as Json[])[0]?.["decisao_higiene"]).toBeNull();
    // As redes da base, sem o código à frente (cada uma desfeita):
    // um reembolso não leva a linha por decidir nem a da excepção, e a
    // devolução não fica decidida sem a linha «reembolsar» no reembolso.
    const naBaseComReembolso = (
      decisao: string | null,
      linhas: string[],
      depois?: string,
      mudarPara?: string,
    ) =>
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        if (decisao !== null) {
          await sql`update linha_devolucao set decisao_higiene = ${decisao}
            where devolucao_id = ${rma.slice(4)}::uuid
              and linha_encomenda_id = ${String(l1?.["id"]).slice(4)}::uuid`.execute(
            trx,
          );
        }
        const pag = await sql<{ id: string }>`select id from pagamento
          where encomenda_id = ${e.encomenda.slice(4)}::uuid`.execute(trx);
        const novo = await trx
          .insertInto("reembolso")
          .values({
            comerciante_id: s.c,
            encomenda_id: e.encomenda.slice(4),
            pagamento_id: String(pag.rows[0]?.id),
            origem: "devolucao",
            devolucao_id: rma.slice(4),
            montante: linhas.length,
            moeda: "EUR",
            via: "manual",
            decidido_por: "pessoa:teste",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        let posicao = 0;
        for (const linha of linhas) {
          posicao += 1;
          await trx
            .insertInto("linha_reembolso")
            .values({
              reembolso_id: novo.id,
              comerciante_id: s.c,
              posicao,
              linha_encomenda_id: linha.slice(4),
              quantidade: 1,
              montante: 1,
            })
            .execute();
        }
        if (mudarPara !== undefined) {
          await sql`update linha_devolucao set decisao_higiene = ${mudarPara}
            where devolucao_id = ${rma.slice(4)}::uuid
              and linha_encomenda_id = ${String(l1?.["id"]).slice(4)}::uuid`.execute(
            trx,
          );
        }
        if (depois !== undefined) {
          await sql`update devolucao set estado = ${depois}, versao = versao + 1
            where id = ${rma.slice(4)}::uuid`.execute(trx);
        }
        throw new Error("desfazer");
      });
    await expect(
      naBaseComReembolso(null, [String(l1?.["id"])]),
    ).rejects.toThrow(/returns\.hygiene_decision_required/);
    await expect(
      naBaseComReembolso("excepcao_higiene", [String(l1?.["id"])]),
    ).rejects.toThrow(/refunds\.invalid_field/);
    await expect(
      naBaseComReembolso("reembolsar", [String(l2?.["id"])], "decidida"),
    ).rejects.toThrow(/returns\.invalid_field/);
    // Com a linha num reembolso vivo, a decisão já não muda (revisão do
    // #363, P2-2): o rascunho com «reembolsar» não sai com a excepção.
    await expect(
      naBaseComReembolso(
        "reembolsar",
        [String(l1?.["id"])],
        undefined,
        "excepcao_higiene",
      ),
    ).rejects.toThrow(/returns\.invalid_transition/);
    // Com a linha no reembolso, a mesma decisão passa (até ao «desfazer»).
    await expect(
      naBaseComReembolso("reembolsar", [String(l1?.["id"])], "decidida"),
    ).rejects.toThrow(/desfazer/);
    // A excepção na linha aberta: reembolsa-se só a do selo intacto.
    const r = await ok(
      s.adm("POST", `/returns/${rma}/decide`, {
        versao: 3,
        linhas: [{ linha: l2?.["id"], quantidade: 2 }],
        motivo: "livre resolução; o verniz voltou aberto",
        higiene: [{ linha: l1?.["id"], decisao: "excepcao_higiene" }],
      }),
      201,
    );
    expect(r["montante"]).toBe(1230);
    d = await ok(s.adm("GET", `/returns/${rma}`));
    expect(d["estado"]).toBe("decidida");
    expect((d["linhas"] as Json[])[0]).toMatchObject({
      decisao_higiene: "excepcao_higiene",
      // Decidida, já não está por decidir (revisão do #363, P2-1).
      higiene_a_decidir: false,
    });
    // Decidida, a decisão já não muda; e não volta a vazia.
    for (const decisao of ["reembolsar", null]) {
      await expect(
        naBase(s, async (trx) => {
          await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
            trx,
          );
          await sql`update linha_devolucao set decisao_higiene = ${decisao}
            where devolucao_id = ${rma.slice(4)}::uuid
              and linha_encomenda_id = ${String(l1?.["id"]).slice(4)}::uuid`.execute(
            trx,
          );
        }),
      ).rejects.toThrow(
        decisao === null ? /returns\.immutable/ : /returns\.invalid_transition/,
      );
    }
  });

  it("selado por higiene: reembolsar como gesto da loja, e fechar com a excepção; numa devolução comercial não se aplica (H6, H7)", async () => {
    const s = await cenario();
    await selar(s);
    // Reembolsar a linha aberta, por decisão da loja.
    const e = await paga(s, [[s.v1, 1]]);
    const [l1] = await expedir(s, e.encomenda);
    const rma = await inspeccionadaCom(s, e.token, [
      { linha: l1?.["id"], quantidade: 1, estado: "aberto" },
    ]);
    const r = await ok(
      s.adm("POST", `/returns/${rma}/decide`, {
        versao: 3,
        linhas: [{ linha: l1?.["id"], quantidade: 1 }],
        motivo: "gesto da loja",
        higiene: [{ linha: l1?.["id"], decisao: "reembolsar" }],
      }),
      201,
    );
    expect(r["montante"]).toBe(1230);
    // Anulado o reembolso, a devolução volta a decidir-se: a decisão fica
    // gravada e pode mudar (revisão do #363, P2-5).
    const rfd = String(r["reembolso"]);
    const x = await ok(s.adm("GET", `/refunds/${rfd}`));
    await ok(
      s.adm("POST", `/refunds/${rfd}/cancel`, {
        versao: x["versao"],
        motivo: "afinal não é gesto",
      }),
    );
    let dv = await ok(s.adm("GET", `/returns/${rma}`));
    expect(dv["estado"]).toBe("inspeccionada");
    expect((dv["linhas"] as Json[])[0]).toMatchObject({
      decisao_higiene: "reembolsar",
      higiene_a_decidir: false,
    });
    await ok(
      s.adm("POST", `/returns/${rma}/close`, {
        versao: dv["versao"],
        motivo: "selo aberto: sem direito de livre resolução",
        higiene: [{ linha: l1?.["id"], decisao: "excepcao_higiene" }],
      }),
    );
    dv = await ok(s.adm("GET", `/returns/${rma}`));
    expect(dv).toMatchObject({
      estado: "fechada",
      linhas: [
        expect.objectContaining({ decisao_higiene: "excepcao_higiene" }),
      ],
    });
    // Fechar sem reembolso com a excepção.
    const e2 = await paga(s, [[s.v1, 1]]);
    const [m1] = await expedir(s, e2.encomenda);
    const rma2 = await inspeccionadaCom(s, e2.token, [
      { linha: m1?.["id"], quantidade: 1, estado: "aberto" },
    ]);
    await ok(
      s.adm("POST", `/returns/${rma2}/close`, {
        versao: 3,
        motivo: "selo aberto: sem direito de livre resolução",
        higiene: [{ linha: m1?.["id"], decisao: "excepcao_higiene" }],
      }),
    );
    expect(await ok(s.adm("GET", `/returns/${rma2}`))).toMatchObject({
      estado: "fechada",
      linhas: [
        expect.objectContaining({ decisao_higiene: "excepcao_higiene" }),
      ],
    });
    // Numa devolução comercial a marca não pede decisão nem a aceita (H7).
    const e3 = await paga(s, [[s.v1, 1]]);
    const [n1] = await expedir(s, e3.encomenda);
    const c = await ok(
      s.adm("POST", "/returns", {
        encomenda: e3.encomenda,
        origem: "comercial",
        motivo: "troca",
        linhas: [{ linha: n1?.["id"], quantidade: 1 }],
      }),
      201,
    );
    const rma3 = String(c["id"]);
    await ok(
      s.adm("POST", `/returns/${rma3}/receive`, {
        versao: 1,
        linhas: [{ linha: n1?.["id"], recebida: 1 }],
      }),
    );
    await ok(
      s.adm("POST", `/returns/${rma3}/inspect`, {
        versao: 2,
        linhas: [{ linha: n1?.["id"], estado_artigo: "aberto", aceite: 0 }],
      }),
    );
    expect(
      ((await ok(s.adm("GET", `/returns/${rma3}`)))["linhas"] as Json[])[0],
    ).toMatchObject({ selado_por_higiene: true, higiene_a_decidir: false });
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma3}/close`, {
          versao: 3,
          motivo: "troca",
          higiene: [{ linha: n1?.["id"], decisao: "excepcao_higiene" }],
        }),
      ),
    ).toEqual([400, "returns.invalid_field"]);
    await ok(
      s.adm("POST", `/returns/${rma3}/decide`, {
        versao: 3,
        linhas: [{ linha: n1?.["id"], quantidade: 1 }],
        motivo: "troca comercial",
      }),
      201,
    );
    // Sem a marca no artigo, a encomenda nova não é selada: aberta, não
    // pede nem aceita a decisão (a marca da encomenda é a que conta, H2).
    await selar(s, false);
    const e4 = await paga(s, [[s.v1, 1]]);
    const [q1] = await expedir(s, e4.encomenda);
    const rma4 = await inspeccionadaCom(s, e4.token, [
      { linha: q1?.["id"], quantidade: 1, estado: "aberto" },
    ]);
    expect(
      ((await ok(s.adm("GET", `/returns/${rma4}`)))["linhas"] as Json[])[0],
    ).toMatchObject({ selado_por_higiene: false, higiene_a_decidir: false });
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma4}/decide`, {
          versao: 3,
          linhas: [{ linha: q1?.["id"], quantidade: 1 }],
          motivo: "livre resolução",
          higiene: [{ linha: q1?.["id"], decisao: "reembolsar" }],
        }),
      ),
    ).toEqual([400, "returns.invalid_field"]);
    // Uma linha de outra devolução não se decide aqui.
    expect(
      await codigo(
        s.adm("POST", `/returns/${rma4}/decide`, {
          versao: 3,
          linhas: [{ linha: q1?.["id"], quantidade: 1 }],
          motivo: "livre resolução",
          higiene: [{ linha: m1?.["id"], decisao: "excepcao_higiene" }],
        }),
      ),
    ).toEqual([400, "returns.invalid_field"]);
    // E a encomenda selada de antes continua selada (rma2 fechou com a
    // excepção quando o artigo ainda estava marcado).
    expect(
      ((await ok(s.adm("GET", `/returns/${rma2}`)))["linhas"] as Json[])[0],
    ).toMatchObject({ selado_por_higiene: true });
    // Num problema, `higiene` não existe.
    const prb = await ok(
      s.adm("POST", "/problems", {
        encomenda: e3.encomenda,
        tipo: "atraso",
        descricao: "atrasou",
      }),
      201,
    );
    expect(
      (
        await codigo(
          s.adm("POST", `/problems/${String(prb["id"])}/close`, {
            versao: 1,
            motivo: "nada",
            higiene: [],
          }),
        )
      )[0],
    ).toBe(400);
  });

  // ---------------------------------------- O e-mail do aviso (docs/34)

  /** Uma pessoa com um papel no comerciante (as contas, sem o convite). */
  const membroCom = (s: Cenario, papel: string, nome: string) =>
    base.dono.transaction().execute(async (t) => {
      const email = `${nome.toLowerCase()}-${randomUUID().slice(0, 8)}@exemplo.pt`;
      const p = await sql<{ id: string }>`insert into pessoa (email, nome)
        values (${email}, ${nome}) returning id`.execute(t);
      const id = String(p.rows[0]?.id);
      const m = await sql<{
        id: string;
      }>`insert into membro (comerciante_id, pessoa_id, papel, convidado_por)
        values (${s.c}::uuid, ${id}::uuid, ${papel}, 'operador:teste') returning id`.execute(
        t,
      );
      return { pessoa: id, membro: String(m.rows[0]?.id), email };
    });
  const notificacoesDe = async (s: Cenario) =>
    (
      await sql<{
        id: string;
        tipo: string;
        pessoa_id: string;
        lingua: string;
        estado: string;
        tentativas: number;
        ultimo_erro: string | null;
      }>`select id, tipo, pessoa_id, lingua, estado, tentativas, ultimo_erro
        from notificacao where comerciante_id = ${s.c}::uuid order by criada_em, id`.execute(
        base.dono,
      )
    ).rows;
  /** Pede pelo botão e devolve a devolução (rma_…). */
  const devolucaoDeLivreResolucao = async (s: Cenario) => {
    const e = await paga(s, [[s.v1, 2]]);
    const [linha] = await expedir(s, e.encomenda);
    const w = await ok(
      pedir("POST", `/store/orders/${e.token}/withdrawal`, {
        linhas: [{ linha: linha?.["id"], quantidade: 1 }],
      }),
      201,
    );
    return {
      e,
      rma: String(
        (await ok(s.adm("GET", `/withdrawals/${String(w["pedido"])}`)))[
          "devolucao"
        ],
      ),
    };
  };
  const enviar = async (correio: CorreioDeEnsaio) => {
    const r = await correrNotificacoes(base.api, correio);
    expect(r.erros).toEqual([]);
    return r;
  };
  /** O relógio da fila: as que esperam ficam vencidas já. */
  const vencer = (s: Cenario) =>
    sql`update notificacao set proxima_em = now()
      where comerciante_id = ${s.c}::uuid and estado = 'a_enviar'`.execute(
      base.dono,
    );

  it("o e-mail do aviso: um por dono e gestor activos, sem dados do cliente, uma vez; a pessoa que sai fica cancelada; à 6.ª falha fica falhada (docs/34, N2 a N9)", async () => {
    const s = await cenario();
    const ana = await membroCom(s, "dono", "Ana");
    const bruno = await membroCom(s, "gestor", "Bruno");
    await membroCom(s, "armazem", "Carla");
    await membroCom(s, "apoio", "Duarte");
    const saiu = await membroCom(s, "gestor", "Eva");
    await sql`update membro set terminado_por = 'operador:teste'
      where id = ${saiu.membro}::uuid`.execute(base.dono);
    const desactivada = await membroCom(s, "dono", "Filipe");
    await sql`update pessoa set estado = 'desactivada'
      where id = ${desactivada.pessoa}::uuid`.execute(base.dono);
    const { e, rma } = await devolucaoDeLivreResolucao(s);
    await pedidoHaDias(rma, 12);
    await prazos();
    await prazos();
    // Uma por dono e gestor activos (N2), uma vez (N5), na língua do Hub.
    let n = await notificacoesDe(s);
    expect(n.map((x) => [x.pessoa_id, x.tipo, x.lingua, x.estado])).toEqual(
      expect.arrayContaining([
        [ana.pessoa, "refund.deadline_approaching", "pt", "a_enviar"],
        [bruno.pessoa, "refund.deadline_approaching", "pt", "a_enviar"],
      ]),
    );
    expect(n.length).toBe(2);
    const correio = new CorreioDeEnsaio();
    // Duas voltas ao mesmo tempo: cada e-mail sai uma vez.
    const [v1, v2] = await Promise.all([
      correrNotificacoes(base.api, correio),
      correrNotificacoes(base.api, correio),
    ]);
    expect(v1.enviadas + v2.enviadas).toBe(2);
    expect((await enviar(correio)).enviadas).toBe(0);
    // A volta que chega depois de outra a ter enviado não a envia outra vez.
    const jaEnviada = (await notificacoesDe(s))[0];
    const conta = {
      enviadas: 0,
      repetir: 0,
      falhadas: 0,
      canceladas: 0,
      apagadas: 0,
      servidor: null,
      erros: [],
    };
    await enviarUma(base.api, s.c, correio, String(jaEnviada?.id), conta);
    expect(conta.enviadas).toBe(0);
    expect(correio.enviados.length).toBe(2);
    expect(correio.enviados.map((m) => m.para).sort()).toEqual(
      [ana.email, bruno.email].sort(),
    );
    const m = correio.enviados[0];
    expect(m?.texto).toContain(rma);
    expect(m?.texto).toContain(e.encomenda);
    expect(m?.texto).toContain("(faltam 2 dias)");
    // A loja diz-se; o nome da pessoa não (P2-3, P2-4).
    expect(m?.texto).toContain("Na loja «Loja»");
    expect(m?.texto).not.toMatch(/Ana|Bruno/);
    expect(m?.assunto).toMatch(
      /^Livre resolução: reembolsar até \d{2}\/\d{2}\/\d{4}$/,
    );
    // Nenhum dado do cliente (N3).
    for (const x of correio.enviados) {
      expect(x.texto + x.assunto).not.toMatch(/rui|exemplo\.pt|Rua 2|Lisboa/i);
    }
    // A lista (N11): sem o endereço nem o texto.
    const lista = await ok(s.adm("GET", "/notifications?estado=enviada"));
    expect(lista["dados"]).toHaveLength(2);
    expect(JSON.stringify(lista)).not.toContain("@");
    expect((lista["dados"] as Json[])[0]).toMatchObject({
      referencia: rma,
      estado: "enviada",
      tentativas: 0,
    });
    // Passou: o Bruno saiu entretanto e o Gil passou a apoio (canceladas);
    // a Ana à 6.ª falha.
    const gil = await membroCom(s, "gestor", "Gil");
    await pedidoHaDias(rma, 15);
    await prazos();
    await sql`update membro set papel = 'apoio'
      where id = ${gil.membro}::uuid`.execute(base.dono);
    await sql`update membro set terminado_por = 'operador:teste'
      where comerciante_id = ${s.c}::uuid and pessoa_id = ${bruno.pessoa}::uuid
        and ate is null`.execute(base.dono);
    await sql`update notificacao set tentativas = 5
      where comerciante_id = ${s.c}::uuid and pessoa_id = ${ana.pessoa}::uuid
        and tipo = 'refund.deadline_passed'`.execute(base.dono);
    correio.falhas.push(new ErroCorreio("smtp_421", "destinatario_temporario"));
    const r = await enviar(correio);
    expect([r.canceladas, r.falhadas, r.enviadas]).toEqual([2, 1, 0]);
    n = await notificacoesDe(s);
    expect(
      n
        .filter((x) => x.tipo === "refund.deadline_passed")
        .map((x) => [x.pessoa_id, x.estado, x.tentativas, x.ultimo_erro]),
    ).toEqual(
      expect.arrayContaining([
        [bruno.pessoa, "cancelada", 0, "destinatario_inactivo"],
        [gil.pessoa, "cancelada", 0, "destinatario_inactivo"],
        [ana.pessoa, "falhada", 6, "smtp_421"],
      ]),
    );
    expect(
      (await ok(s.adm("GET", "/notifications?estado=falhada")))["dados"],
    ).toEqual([expect.objectContaining({ ultimo_erro: "smtp_421" })]);
    // A base: a API não grava notificações, uma terminada não muda e não se
    // apaga antes dos 90 dias.
    await expect(
      naBase(s, (trx) =>
        sql`insert into notificacao (comerciante_id, tipo, referencia, pessoa_id, lingua, dados)
          values (${s.c}::uuid, 'refund.deadline_passed', ${rma.slice(4)}::uuid,
            ${ana.pessoa}::uuid, 'pt', '{}')`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    const falhada = n.find((x) => x.estado === "falhada");
    await expect(
      naBase(s, (trx) =>
        sql`update notificacao set estado = 'a_enviar'
          where id = ${String(falhada?.id)}::uuid`.execute(trx),
      ),
    ).rejects.toThrow(/notifications\.immutable/);
    await expect(
      sql`delete from notificacao where id = ${String(falhada?.id)}::uuid`.execute(
        base.dono,
      ),
    ).rejects.toThrow(/notifications\.immutable/);
  });

  it("o e-mail do aviso: noutra língua sai em inglês; uma recusa definitiva falha logo; uma temporária repete mais tarde; outro comerciante não vê (docs/34, N4, N6, N11)", async () => {
    const s = await cenario();
    const s2 = await cenario();
    await sql`update comerciante set lingua = 'de' where id = ${s.c}::uuid`.execute(
      base.dono,
    );
    const ana = await membroCom(s, "dono", "Ana");
    const { rma } = await devolucaoDeLivreResolucao(s);
    await pedidoHaDias(rma, 12);
    await prazos();
    expect((await notificacoesDe(s)).map((x) => x.lingua)).toEqual(["en"]);
    // 550: definitiva, falha à primeira.
    const correio = new CorreioDeEnsaio();
    correio.falhas.push(new ErroCorreio("smtp_550", "destinatario_recusado"));
    expect((await enviar(correio)).falhadas).toBe(1);
    expect((await notificacoesDe(s))[0]).toMatchObject({
      estado: "falhada",
      tentativas: 1,
      ultimo_erro: "smtp_550",
    });
    // Passou: o servidor recusa (a palavra-passe, o DNS): não conta como
    // tentativa e pára a volta (P1-1); depois, uma falha temporária do
    // destinatário espera; vencida, sai em inglês.
    await pedidoHaDias(rma, 15);
    await prazos();
    correio.falhas.push(new ErroCorreio("smtp_535", "servidor"));
    const rs = await enviar(correio);
    expect([rs.servidor, rs.repetir, rs.falhadas]).toEqual(["smtp_535", 0, 0]);
    expect(
      (await notificacoesDe(s)).find((x) => x.estado === "a_enviar"),
    ).toMatchObject({ tentativas: 0, ultimo_erro: "smtp_535" });
    await vencer(s);
    correio.falhas.push(new ErroCorreio("smtp_451", "destinatario_temporario"));
    expect((await enviar(correio)).repetir).toBe(1);
    expect((await enviar(correio)).enviadas).toBe(0);
    // A 1.ª falha espera 1 minuto (N6), não os 10 da vez tomada.
    const { rows: hora } = await sql<{ segundos: number }>`
      select extract(epoch from proxima_em - now())::int as segundos
      from notificacao where comerciante_id = ${s.c}::uuid and estado = 'a_enviar'`.execute(
      base.dono,
    );
    expect(hora[0]?.segundos).toBeGreaterThan(30);
    expect(hora[0]?.segundos).toBeLessThanOrEqual(60);
    // O destino só se lê no comerciante dela (N9).
    const espera = (await notificacoesDe(s)).find(
      (x) => x.estado === "a_enviar",
    );
    const destino = (c: string) =>
      comComerciante(base.api, c, async (trx) =>
        (
          await sql<{
            email: string;
          }>`select email from notificacao_destino(${String(espera?.id)}::uuid)`.execute(
            trx,
          )
        ).rows.map((x) => x.email),
      );
    expect(await destino(s.c)).toEqual([ana.email]);
    expect(await destino(s2.c)).toEqual([]);
    await vencer(s);
    expect((await enviar(correio)).enviadas).toBe(1);
    expect(correio.enviados[0]).toMatchObject({
      para: ana.email,
      assunto: expect.stringMatching(
        /^Withdrawal: the refund deadline has passed \(\d{4}-\d{2}-\d{2}\)$/,
      ) as unknown,
    });
    expect(correio.enviados[0]?.texto).toContain("The last day to refund was");
    expect(
      (await notificacoesDe(s)).find((x) => x.estado === "enviada"),
    ).toMatchObject({ tentativas: 1, ultimo_erro: null });
    // A limpeza dos 90 dias (N9), também sem envios por fazer: a falhada
    // passa a ter terminado há 91 dias e sai na volta seguinte.
    await base.dono.transaction().execute(async (t) => {
      await sql`alter table notificacao disable trigger notificacao_antes_de_gravar`.execute(
        t,
      );
      await sql`update notificacao set terminada_em = now() - interval '91 days'
        where comerciante_id = ${s.c}::uuid and estado = 'falhada'`.execute(t);
      await sql`alter table notificacao enable always trigger notificacao_antes_de_gravar`.execute(
        t,
      );
    });
    expect((await enviar(correio)).apagadas).toBe(1);
    expect((await notificacoesDe(s)).map((x) => x.estado)).toEqual(["enviada"]);
    const { rows: restam } = await sql<{ n: number }>`select count(*)::int as n
      from tarefa_notificacao where comerciante_id = ${s.c}::uuid
        and quando <= now()`.execute(base.dono);
    expect(restam[0]?.n).toBe(0);
    // Outro comerciante não vê estas.
    expect((await ok(s2.adm("GET", "/notifications")))["dados"]).toEqual([]);
    expect(
      ((await ok(s.adm("GET", "/notifications")))["dados"] as Json[]).length,
    ).toBe(1);
  });

  it("o e-mail do aviso: uma devolução que já não espera não dá e-mail; o nome da loja vai numa linha só (revisão do #373, P2-2, P2-3)", async () => {
    const s = await cenario();
    await sql`update comerciante set nome = ${"Loja\n\nA sua conta foi suspensa"}
      where id = ${s.c}::uuid`.execute(base.dono);
    const ana = await membroCom(s, "dono", "Ana");
    const a = await devolucaoDeLivreResolucao(s);
    const b = await devolucaoDeLivreResolucao(s);
    await pedidoHaDias(a.rma, 12);
    await pedidoHaDias(b.rma, 12);
    await prazos();
    expect((await notificacoesDe(s)).length).toBe(2);
    // O servidor recusa à primeira: a volta pára e a segunda nem se tenta
    // (P1-1); nenhuma gasta uma tentativa.
    const correio = new CorreioDeEnsaio();
    correio.falhas.push(new ErroCorreio("smtp_535", "servidor"));
    const r0 = await enviar(correio);
    expect([r0.servidor, r0.enviadas, r0.repetir, r0.falhadas]).toEqual([
      "smtp_535",
      0,
      0,
      0,
    ]);
    expect((await notificacoesDe(s)).map((x) => x.tentativas)).toEqual([0, 0]);
    expect(correio.falhas).toEqual([]);
    expect(correio.enviados).toEqual([]);
    await vencer(s);
    // A primeira cancela-se antes do envio: o e-mail diria o contrário.
    await ok(
      s.adm("POST", `/returns/${a.rma}/cancel`, {
        versao: 1,
        motivo: "o cliente desistiu do pedido",
      }),
    );
    const r = await enviar(correio);
    expect([r.canceladas, r.enviadas]).toEqual([1, 1]);
    expect(
      (await notificacoesDe(s)).find((x) => x.estado === "cancelada"),
    ).toMatchObject({ ultimo_erro: "devolucao_ja_nao_espera" });
    expect(correio.enviados).toHaveLength(1);
    expect(correio.enviados[0]?.para).toBe(ana.email);
    expect(correio.enviados[0]?.texto).toContain(b.rma);
    expect(correio.enviados[0]?.texto).toContain(
      "Na loja «Loja A sua conta foi suspensa», ",
    );
  });
});
