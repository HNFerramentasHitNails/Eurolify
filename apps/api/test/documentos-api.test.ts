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
import { AdaptadorMoloni } from "../src/faturacao/moloni.js";
import { hojeEmLisboa, periodoDe } from "../src/faturacao/oss.js";
import {
  correrDocumentos,
  correrRenovacoes,
  processarDocumento,
} from "../src/faturacao/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import { assinar, avisoEuPago, eupagoFalso } from "./eupago-falso.js";
import { moloniFalso } from "./moloni-falso.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Os documentos fiscais pela API (docs/29; migração 0050): quem emite, a
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
  // O Moloni simulado (docs/29 §13): o relógio do adaptador anda à mão para
  // os tokens expirarem sem esperar uma hora.
  const moloni = moloniFalso();
  let relogio = 0;
  const faturacao: {
    chave: ReturnType<typeof chavePagamentos>;
    adaptadores: { ensaio: EmissorDeEnsaio; moloni: AdaptadorMoloni };
    retornoAutorizacao?: string;
  } = {
    chave: chavePagamentos(randomBytes(32).toString("base64")),
    adaptadores: {
      ensaio,
      moloni: new AdaptadorMoloni({
        clientId: "dev-eurolify",
        clientSecret: "segredo-do-developer",
        empresasPermitidas: [String(moloni.empresa)],
        redirectUri:
          "https://api.exemplo.test/invoicing-connections/moloni/callback",
        fetch: moloni.fetch,
        agora: () => Date.now() + relogio,
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
          "tax:read",
          "tax:write",
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
    // As transições trazem as seis respostas do rasto (docs/28 §1; #322):
    // a primeira veio do checkout, pela API.
    const transicoes = pag["transicoes"] as Json[];
    expect(transicoes.length).toBeGreaterThan(0);
    expect(transicoes[0]).toMatchObject({
      canal: "api",
      ia: { prova: "desconhecido", fornecedor: null },
      autorizado_por: null,
    });
    expect(Object.keys(transicoes[0] ?? {})).toEqual(
      expect.arrayContaining(["pedido", "motivo"]),
    );
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
    // Sem NIF na compra, a correcção só aceita um NIF do país da entidade
    // (a decisão de IVA foi nacional; P2-5).
    expect(
      await codigo(
        s.adm("POST", `/invoices/${String(d?.["id"])}/correct`, {
          versao: d?.["versao"],
          motivo: "o cliente mandou o NIF da empresa",
          nif: "ESB12345678",
        }),
      ),
    ).toEqual([400, "invoices.invalid_field"]);
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
      "procurarPorReferencia",
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
    // Cada passo traz as seis respostas do rasto (docs/28 §1; #322).
    for (const p of d["rasto"] as Json[]) {
      expect([null, "api", "sistema"]).toContain(p["canal"]);
      // Os passos da tarefa dizem a pedido de quem (docs/28 §3.7; Q6).
      if (p["canal"] === "sistema") {
        expect(p["a_pedido_de"]).not.toBeNull();
        expect(p["a_pedido_de_tipo"]).not.toBe("desconhecido");
      }
      expect(typeof (p["ia"] as Json)["prova"]).toBe("string");
      expect(Object.keys(p)).toEqual(
        expect.arrayContaining(["pedido", "autorizado_por", "motivo"]),
      );
    }
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

  it("cada linha vai com a taxa do emissor do seu par (país, taxa), nunca com outra do mesmo país", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta, [
      { pais: "PT", taxa: 600, emissor: "T6" },
      { pais: "PT", taxa: 2300, emissor: "T23" },
    ]);
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    expect((await documentoDe(s, e.encomenda))?.["estado"]).toBe("emitido");
    const pedido = ensaio.conta(conta).pedidos[0];
    expect(pedido?.linhas.map((l) => [l.taxa, l.taxa_emissor])).toEqual([
      [2300, "T23"],
      [2300, "T23"],
    ]);
    expect(pedido?.observacoes).toBe("destino PT · IVA 23 %");
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
    ensaio.conta(conta).falhas = { fechar: "rede" };
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    expect((await documentoDe(s, e.encomenda))?.["estado"]).toBe("incerto");
    ensaio.conta(conta).falhas = { procurarPorReferencia: "nao_sei" };
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
    // Retido antes de pedir o rascunho, não só ao conferi-lo.
    expect(ensaio.conta(conta).chamadas).not.toContain("criarRascunho");
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
    expect(d).toMatchObject({
      estado: "retido",
      motivos: ["nif_consumidor_final"],
    });
    // Não se liberta: corrige-se (R4, Q4).
    expect(
      await codigo(
        s.adm("POST", `/invoices/${String(d["id"])}/release`, {
          versao: d["versao"],
          motivo_retencao: "nif_consumidor_final",
          motivo: "o cliente diz que é este",
        }),
      ),
    ).toEqual([400, "invoices.invalid_field"]);
    // Corrigir para o NIF de consumidor final, ou para outro país, não entra.
    for (const nif of ["999999990", "ESB12345678"]) {
      expect(
        await codigo(
          s.adm("POST", `/invoices/${String(d["id"])}/correct`, {
            versao: d["versao"],
            motivo: "o cliente ligou",
            nif,
          }),
        ),
      ).toEqual([400, "invoices.invalid_field"]);
    }
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

  it("libertar o NIF recusado vale como validação (R9) e acaba numa correcção; só com invoices:write", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    // Paga antes de se escolher quem emite: fica retida.
    const e = await paga(s, [[s.v1, 1]], "501964843");
    await ateParar();
    let d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["motivos"]).toContain("emissor_por_configurar");
    // Um conteúdo com um NIF que a régua de hoje recusa (o caso de uma régua
    // que mudou depois da compra).
    const v1 = ((d["conteudos"] as Json[])[0] as Json)["conteudo"] as Json;
    const v2 = {
      ...v1,
      cliente: { ...(v1["cliente"] as Json), nif_escrito: "XX1" },
    };
    await naBase(s, (trx) =>
      trx
        .insertInto("documento_conteudo")
        .values({
          documento_id: String(d["id"]).slice(4),
          comerciante_id: s.c,
          versao: 2,
          conteudo: JSON.stringify(v2),
          impressao: "0".repeat(64),
          motivo: "teste: a régua mudou",
          quem: "pessoa:teste",
        })
        .execute(),
    );
    // Ainda sem emissor: o NIF também fica retido; libertá-lo vale só para
    // este conteúdo — corrigir outra coisa volta a pedir tudo (P1-5).
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/recheck`, {
        versao: d["versao"],
      }),
    );
    await ateParar();
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["motivos"]).toContain("nif_recusado");
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/release`, {
        versao: d["versao"],
        motivo_retencao: "nif_recusado",
        motivo: "confirmado com o cliente",
      }),
    );
    await ateParar();
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d).toMatchObject({ estado: "retido", validados: ["nif_recusado"] });
    expect(d["motivos"]).not.toContain("nif_recusado");
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/correct`, {
        versao: d["versao"],
        motivo: "o nome da empresa estava abreviado",
        nome_documento: "Rui Silva",
      }),
    );
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["validados"]).toEqual([]);
    await ateParar();
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["motivos"]).toContain("nif_recusado");
    // A entidade passa a emitir pelo Eurolify: a encomenda paga antes segue
    // (P2-1), e o NIF fica retido.
    await ligar(s, conta);
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/recheck`, {
        versao: d["versao"],
      }),
    );
    await ateParar();
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d).toMatchObject({ estado: "retido", motivos: ["nif_recusado"] });
    expect((d["rasto"] as Json[]).map((p) => p["passo"])).toContain(
      "emissor_decidido",
    );
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
    expect(
      (
        await pedir("GET", `/invoices/${String(d["id"])}/pdf`, undefined, {
          authorization: `Bearer ${
            (
              await criarChave(base.dono, s.c, {
                tipo: "servidor",
                criadaPor: "operador:teste",
                nome: "Sem faturas",
                ambitos: ["orders:read"],
              })
            ).segredo
          }`,
        })
      ).statusCode,
    ).toBe(403);
    // Um gestor decide a fila, mas não corrige nem liberta (P2-4).
    const gestor = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Gestor",
        ambitos: ["invoices:read", "invoices:write"],
      })
    ).segredo;
    expect(
      await codigo(
        pedir("POST", `/invoices/${String(d["id"])}/release`, corpo, {
          authorization: `Bearer ${gestor}`,
        }),
      ),
    ).toEqual([403, "auth.forbidden"]);
    expect(
      await codigo(
        pedir(
          "POST",
          `/invoices/${String(d["id"])}/correct`,
          { versao: d["versao"], motivo: "corrigir", nome_documento: "X" },
          { authorization: `Bearer ${gestor}` },
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

  it("um documento fechado no emissor sem a prova gravada prova-se, não se fecha outra vez (P1-1); recusas seguidas vão para uma pessoa (P1-2)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    ensaio.conta(conta).falhas.fechar = "erro";
    const e = await paga(s, [[s.v1, 1]]);
    expect((await correr()).erros).toHaveLength(1);
    let d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("rascunho");
    // A tentativa anterior chegou a fechar (o emissor fechou e a resposta
    // perdeu-se a meio da gravação): o documento está fechado lá.
    const noEmissor = [...ensaio.conta(conta).documentos.values()][0];
    if (noEmissor === undefined) throw new Error("sem rascunho");
    ensaio.conta(conta).documentos.set(noEmissor.id, {
      ...noEmissor,
      estado: "fechado",
      numero: "FT LOJA/7",
    });
    ensaio.conta(conta).falhas = {};
    await adiantar(s);
    await ateParar();
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("emitido");
    expect((d["prova"] as Json)["numero"]).toBe("FT LOJA/7");
    expect(
      ensaio.conta(conta).chamadas.filter((x) => x === "fechar"),
    ).toHaveLength(1);

    // Outra encomenda: o emissor recusa sempre fechar.
    ensaio.conta(conta).falhas.fechar = "erro";
    const e2 = await paga(s, [[s.v1, 1]]);
    for (let i = 0; i < 5; i++) {
      await adiantar(s);
      await correr();
    }
    d = (await documentoDe(s, e2.encomenda)) as Json;
    expect(d).toMatchObject({
      estado: "incerto",
      motivos: ["reconciliacao_manual"],
    });
    expect(
      (d["rasto"] as Json[]).filter((p) => p["passo"] === "falhou"),
    ).toHaveLength(5);
    // Fora da tarefa: não tapa a fila.
    expect((await correr()).passos).toBe(0);
  });

  it("duas voltas ao mesmo tempo sobre o mesmo pronto: uma ganha, a outra pára sem chamar o emissor (P1-3)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    const e = await paga(s, [[s.v1, 1]]);
    const d = (await documentoDe(s, e.encomenda)) as Json;
    const id = String(d["id"]).slice(4);
    expect(await processarDocumento(base.api, s.c, id, faturacao)).toBe(
      "pronto",
    );
    // Enquanto a primeira volta fala com o emissor (já reservou), começa
    // outra volta e uma pessoa tenta decidir.
    let segunda: PromiseSettledResult<string> | undefined;
    let pessoa: number | undefined;
    ensaio.conta(conta).antesDaProcura = async () => {
      [segunda] = await Promise.allSettled([
        processarDocumento(base.api, s.c, id, faturacao),
      ]);
      const agora = (await documentoDe(s, e.encomenda)) as Json;
      pessoa = (
        await s.adm("POST", `/invoices/${String(agora["id"])}/recheck`, {
          versao: agora["versao"],
        })
      ).statusCode;
    };
    expect(await processarDocumento(base.api, s.c, id, faturacao)).toBe(
      "rascunho",
    );
    expect(segunda?.status).toBe("rejected");
    expect(String((segunda as PromiseRejectedResult).reason)).toMatch(
      /outra volta/,
    );
    // A pessoa não decide um pronto (só retidos), mas nunca a meio.
    expect(pessoa).toBe(409);
    expect(
      ensaio.conta(conta).chamadas.filter((x) => x === "criarRascunho"),
    ).toHaveLength(1);
    await adiantar(s);
    await ateParar();
    expect((await documentoDe(s, e.encomenda))?.["estado"]).toBe("emitido");
    expect(ensaio.conta(conta).documentos.size).toBe(1);
  });

  it("desligar a ligação pára um documento já pronto (P2-6)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    const ligacao = await ligar(s, conta);
    const e = await paga(s, [[s.v1, 1]]);
    const d = (await documentoDe(s, e.encomenda)) as Json;
    const id = String(d["id"]).slice(4);
    expect(await processarDocumento(base.api, s.c, id, faturacao)).toBe(
      "pronto",
    );
    const l = (
      (await ok(s.adm("GET", "/invoicing-connections")))["dados"] as Json[]
    ).find((x) => x["id"] === ligacao) as Json;
    await ok(
      s.adm("PATCH", `/invoicing-connections/${ligacao}`, {
        versao: l["versao"],
        activa: false,
      }),
    );
    expect(await processarDocumento(base.api, s.c, id, faturacao)).toBe(
      "retido",
    );
    expect((await documentoDe(s, e.encomenda))?.["motivos"]).toEqual([
      "ligacao_sem_teste",
    ]);
    expect(ensaio.conta(conta).chamadas).not.toContain("criarRascunho");
  });

  it("uma taxa do emissor não serve dois pares; credenciais cifradas; outro comerciante não vê o documento", async () => {
    const s = await cenario();
    expect(
      await codigo(
        s.adm("POST", "/invoicing-connections", {
          entidade_legal: `lgl_${s.entidade}`,
          adaptador: "ensaio",
          taxas: [
            { pais: "PT", taxa: 2300, emissor: "T23" },
            { pais: "ES", taxa: 2100, emissor: "T23" },
          ],
        }),
      ),
    ).toEqual([400, "invoices.invalid_field"]);
    expect(
      await codigo(
        s.adm("POST", "/invoicing-connections", {
          entidade_legal: `lgl_${s.entidade}`,
          adaptador: "ensaio",
          isencoes: [
            { codigo: "M05", emissor: "I1" },
            { codigo: "M16", emissor: "I1" },
          ],
        }),
      ),
    ).toEqual([400, "invoices.invalid_field"]);
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    const cifra = await sql<{
      credenciais: Buffer;
    }>`select credenciais from ligacao_faturacao
      where comerciante_id = ${s.c}::uuid`.execute(base.dono);
    expect(cifra.rows[0]?.credenciais.toString("latin1")).not.toContain(conta);
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    const d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("emitido");
    const vizinho = await cenario();
    expect(
      await codigo(vizinho.adm("GET", `/invoices/${String(d["id"])}`)),
    ).toEqual([404, "invoices.not_found"]);
    // A base só deixa andar pelos caminhos da §4.1: um emitido não volta a
    // pronto, nem pela API com acesso à coluna.
    await expect(
      naBase(s, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await sql`update documento_fiscal set estado = 'pronto'
          where id = ${String(d["id"]).slice(4)}::uuid`.execute(trx);
      }),
    ).rejects.toThrow(/invoices.invalid_transition/);
    // A confirmação pública não mostra o estado fiscal (P2-10).
    const conf = await ok(pedir("GET", `/checkout/${e.token}/confirmation`));
    expect(conf).not.toHaveProperty("documento");
    expect(conf).not.toHaveProperty("emissor_fiscal");
  });
  // ------------------------------------------------ O Moloni (docs/29 §13)

  /** Liga a entidade ao Moloni simulado, com a configuração da §13.2. */
  async function ligarMoloni(s: Cenario) {
    const portes = moloni.artigo(`PORTES-${randomUUID().slice(0, 8)}`);
    const cf = moloni.cliente("999999990", "Consumidor final");
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "eurolify",
      }),
      204,
    );
    const l = await ok(
      s.adm("POST", "/invoicing-connections", {
        entidade_legal: `lgl_${s.entidade}`,
        adaptador: "moloni",
        serie: "500",
        taxas: [{ pais: "PT", taxa: 2300, emissor: "11" }],
        isencoes: [{ codigo: "M16", emissor: "M16" }],
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
    const id = String(l["id"]);
    const credenciais = moloni.credenciais();
    await ok(
      s.adm("PUT", `/invoicing-connections/${id}/credentials`, {
        credenciais,
      }),
      204,
    );
    expect(
      await ok(s.adm("POST", `/invoicing-connections/${id}/test`)),
    ).toEqual({ estado: "pronta", erro: null });
    return { id, credenciais, cf };
  }

  it("ligar o Moloni pela autorização dele: o código troca-se uma vez, só com o valor dado ao dono, e só para a empresa de teste (docs/29 §17)", async () => {
    const s = await cenario();
    const outro = await cenario();
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "eurolify",
      }),
      204,
    );
    const id = String(
      (
        await ok(
          s.adm("POST", "/invoicing-connections", {
            entidade_legal: `lgl_${s.entidade}`,
            adaptador: "moloni",
            serie: "500",
          }),
          201,
        )
      )["id"],
    );
    const pedido = await ok(
      s.adm("POST", `/invoicing-connections/${id}/authorize`, {
        empresa: String(moloni.empresa),
      }),
    );
    const estado = String(pedido["estado"]);
    const url = new URL(String(pedido["url"]));
    expect(url.origin + url.pathname).toBe(
      "https://www.moloni.pt/ac/root/oauth/",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "dev-eurolify",
      redirect_uri:
        "https://api.exemplo.test/invoicing-connections/moloni/callback",
      state: estado,
    });
    // O endereço de resposta não troca nada: mostra o código, ou reencaminha.
    const cod = moloni.codigoAutorizacao();
    const pagina = await pedir(
      "GET",
      `/invoicing-connections/moloni/callback?code=${cod}&state=${estado}`,
    );
    expect(pagina.statusCode).toBe(200);
    expect(pagina.headers["content-type"]).toMatch(/^text\/html/);
    expect(pagina.headers["cache-control"]).toBe("no-store");
    expect(pagina.body).toContain(cod);
    const mau = await pedir(
      "GET",
      `/invoicing-connections/moloni/callback?code=${encodeURIComponent("<script>x</script>")}`,
    );
    expect(mau.statusCode).toBe(400);
    expect(mau.body).not.toContain("<script>");
    faturacao.retornoAutorizacao = "https://hub.exemplo.test/faturacao/moloni";
    const volta = await pedir(
      "GET",
      `/invoicing-connections/moloni/callback?code=${cod}&state=${estado}`,
    );
    delete faturacao.retornoAutorizacao;
    expect(volta.statusCode).toBe(303);
    // No fragmento, que não sai do navegador (revisão do #407, P2-2).
    expect(volta.headers["location"]).toBe(
      `https://hub.exemplo.test/faturacao/moloni#code=${cod}&state=${estado}`,
    );
    // Outro valor, ou outro comerciante: não há pedido.
    expect(
      await codigo(
        s.adm("POST", `/invoicing-connections/${id}/authorize/complete`, {
          codigo: cod,
          estado: "x".repeat(43),
        }),
      ),
    ).toEqual([404, "invoices.not_found"]);
    expect(
      await codigo(
        outro.adm("POST", `/invoicing-connections/${id}/authorize/complete`, {
          codigo: cod,
          estado,
        }),
      ),
    ).toEqual([404, "invoices.not_found"]);
    // Só o dono.
    const gestor = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Gestor",
        ambitos: ["invoices:read"],
      })
    ).segredo;
    expect(
      await codigo(
        pedir(
          "POST",
          `/invoicing-connections/${id}/authorize`,
          { empresa: String(moloni.empresa) },
          { authorization: `Bearer ${gestor}` },
        ),
      ),
    ).toEqual([403, "auth.forbidden"]);
    await ok(
      s.adm("POST", `/invoicing-connections/${id}/authorize/complete`, {
        codigo: cod,
        estado,
      }),
      204,
    );
    expect(await ligacaoDe(s, id)).toMatchObject({ estado: "por_testar" });
    expect(
      await ok(s.adm("POST", `/invoicing-connections/${id}/test`)),
    ).toEqual({ estado: "pronta", erro: null });
    // Uma autorização gasta-se uma vez.
    expect(
      await codigo(
        s.adm("POST", `/invoicing-connections/${id}/authorize/complete`, {
          codigo: moloni.codigoAutorizacao(),
          estado,
        }),
      ),
    ).toEqual([409, "invoices.invalid_transition"]);
    // Uma empresa fora da lista de teste (M8): recusada antes de mandar o
    // dono ao Moloni (revisão do #407, P3-2).
    expect(
      await codigo(
        s.adm("POST", `/invoicing-connections/${id}/authorize`, {
          empresa: "999",
        }),
      ),
    ).toEqual([400, "invoices.invalid_field"]);
    expect(await ligacaoDe(s, id)).toMatchObject({ estado: "pronta" });
    // Credenciais que entram pela API fazem caducar as autorizações por
    // concluir (P3-1).
    const pendente = await ok(
      s.adm("POST", `/invoicing-connections/${id}/authorize`, {
        empresa: String(moloni.empresa),
      }),
    );
    await ok(
      s.adm("PUT", `/invoicing-connections/${id}/credentials`, {
        credenciais: moloni.credenciais(),
      }),
      204,
    );
    expect(
      await codigo(
        s.adm("POST", `/invoicing-connections/${id}/authorize/complete`, {
          codigo: moloni.codigoAutorizacao(),
          estado: pendente["estado"],
        }),
      ),
    ).toEqual([409, "invoices.invalid_transition"]);
    // Um código que o Moloni não conhece: a mesma recusa.
    const outraVez = await ok(
      s.adm("POST", `/invoicing-connections/${id}/authorize`, {
        empresa: String(moloni.empresa),
      }),
    );
    expect(
      await codigo(
        s.adm("POST", `/invoicing-connections/${id}/authorize/complete`, {
          codigo: "codigo-que-nao-existe",
          estado: outraVez["estado"],
        }),
      ),
    ).toEqual([502, "invoices.issuer_error"]);
    // A base não deixa voltar atrás uma autorização usada.
    await expect(
      sql`update autorizacao_faturacao set usada_em = null
        where comerciante_id = ${s.c}::uuid`.execute(base.dono),
    ).rejects.toThrow(/invoices\.immutable/);
  });

  const ligacaoDe = async (s: Cenario, id: string) =>
    (
      (await ok(s.adm("GET", "/invoicing-connections")))["dados"] as Json[]
    ).find((x) => x["id"] === id) as Json;

  it("pelo Moloni: o rascunho com a nossa referência, fechado, lido de volta; o artigo criado sem stock e o consumidor final", async () => {
    const s = await cenario();
    const { id, cf } = await ligarMoloni(s);
    expect(await ligacaoDe(s, id)).toMatchObject({
      adaptador: "moloni",
      config: { cliente_consumidor_final: String(cf.customer_id) },
    });
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    const d = await documentoDe(s, e.encomenda);
    expect(d?.["estado"]).toBe("emitido");
    const prova = d?.["prova"] as Json;
    expect(prova).toMatchObject({
      numero: expect.stringMatching(/^FT LOJA\/\d+$/) as unknown,
      serie: "500",
      nif: null,
      pais: null,
      divergencias: [],
    });
    const doc = moloni.estado.documentos.find(
      (x) => x.our_reference === `inv_${String(d?.["id"]).slice(4)}`,
    );
    expect(doc?.status).toBe(1);
    expect(doc?.customer_id).toBe(cf.customer_id);
    // O artigo não existia: criado pela referência = SKU, sem stock (M2).
    const artigo = moloni.estado.artigos.find(
      (a) =>
        a.reference.startsWith("GEL-") &&
        doc?.products.some((p) => Number(p["product_id"]) === a.product_id),
    );
    expect(artigo?.dados).toMatchObject({ has_stock: "0" });
    expect(artigo?.reference).toMatch(/^GEL-00/);
  });

  it("pelo Moloni com NIF: o cliente criado com os valores da ligação e o NIF lido do documento", async () => {
    const s = await cenario();
    await ligarMoloni(s);
    const e = await paga(s, [[s.v1, 1]], "501964843");
    await ateParar();
    const d = await documentoDe(s, e.encomenda);
    expect(d?.["estado"]).toBe("emitido");
    expect(d?.["prova"]).toMatchObject({ nif: "501964843", pais: "PT" });
    expect(
      moloni.estado.clientes.filter((x) => x.vat === "501964843").length,
    ).toBe(1);
  });

  it("os tokens renovam-se sozinhos, gravam-se cifrados e não põem a ligação por testar (§13.4)", async () => {
    const s = await cenario();
    const { id, credenciais } = await ligarMoloni(s);
    const antes = await ligacaoDe(s, id);
    // Duas horas depois: o token de acesso expirou.
    relogio += 2 * 3_600_000;
    try {
      const e = await paga(s, [[s.v1, 1]]);
      await ateParar();
      expect((await documentoDe(s, e.encomenda))?.["estado"]).toBe("emitido");
      const depois = await ligacaoDe(s, id);
      expect(depois).toMatchObject({
        estado: "pronta",
        versao: antes["versao"],
        credenciais_em: antes["credenciais_em"],
      });
      // O par antigo já não serve no Moloni; o novo ficou na base, cifrado.
      expect(moloni.estado.refresh.has(credenciais.refresh_token)).toBe(false);
      const { rows } = await sql<{ sessao: Buffer | null }>`
        select sessao from ligacao_faturacao where id = ${id.slice(4)}::uuid`.execute(
        base.dono,
      );
      expect(rows[0]?.sessao).not.toBeNull();
      expect(rows[0]?.sessao?.toString("latin1")).not.toContain("acc-");
      // A seguinte usa o par da sessão (o antigo daria invalid_grant).
      const e2 = await paga(s, [[s.v1, 2]]);
      await ateParar();
      expect((await documentoDe(s, e2.encomenda))?.["estado"]).toBe("emitido");
    } finally {
      relogio = 0;
    }
  });

  it("a autorização morta: a ligação fica com erro e o pedido retido, nada sai (§13.4)", async () => {
    const s = await cenario();
    const { id } = await ligarMoloni(s);
    relogio += 2 * 3_600_000;
    moloni.estado.falhas.renovacaoMorta = true;
    try {
      const e = await paga(s, [[s.v1, 1]]);
      await ateParar();
      expect(await documentoDe(s, e.encomenda)).toMatchObject({
        estado: "retido",
        motivos: ["ligacao_sem_teste"],
      });
      expect(await ligacaoDe(s, id)).toMatchObject({
        estado: "com_erro",
        erro: expect.stringMatching(/invalid_grant/) as unknown,
      });
    } finally {
      relogio = 0;
      moloni.estado.falhas.renovacaoMorta = false;
    }
  });

  it("a tarefa das renovações renova as ligações Moloni e marca as mortas", async () => {
    const s = await cenario();
    const { id } = await ligarMoloni(s);
    relogio += 8 * 24 * 3_600_000;
    try {
      const r = await correrRenovacoes(base.api, faturacao);
      expect(r.renovadas).toBeGreaterThanOrEqual(1);
      expect((await ligacaoDe(s, id))["estado"]).toBe("pronta");
      moloni.estado.falhas.renovacaoMorta = true;
      relogio += 8 * 24 * 3_600_000;
      const r2 = await correrRenovacoes(base.api, faturacao);
      expect(r2.erros).toBeGreaterThanOrEqual(1);
      expect((await ligacaoDe(s, id))["estado"]).toBe("com_erro");
    } finally {
      relogio = 0;
      moloni.estado.falhas.renovacaoMorta = false;
    }
  });

  it("mudar a configuração obriga a testar outra vez; credenciais novas apagam a sessão", async () => {
    const s = await cenario();
    const { id } = await ligarMoloni(s);
    const l = await ligacaoDe(s, id);
    await ok(
      s.adm("PATCH", `/invoicing-connections/${id}`, {
        versao: l["versao"],
        config: { ...(l["config"] as Json), vencimento: "6" },
      }),
    );
    expect((await ligacaoDe(s, id))["estado"]).toBe("por_testar");
    await ok(s.adm("POST", `/invoicing-connections/${id}/test`));
    // Uma renovação deixa sessão; credenciais novas apagam-na. A tarefa só
    // renova pela idade do par (revisão do #384, P2-1): 8 dias depois.
    relogio += 8 * 24 * 3_600_000;
    try {
      await correrRenovacoes(base.api, faturacao);
    } finally {
      relogio = 0;
    }
    const sessao = async () =>
      (
        await sql<{ sessao: Buffer | null }>`
          select sessao from ligacao_faturacao where id = ${id.slice(4)}::uuid`.execute(
          base.dono,
        )
      ).rows[0]?.sessao ?? null;
    expect(await sessao()).not.toBeNull();
    await ok(
      s.adm("PUT", `/invoicing-connections/${id}/credentials`, {
        credenciais: moloni.credenciais(),
      }),
      204,
    );
    expect(await sessao()).toBeNull();
    // Um id que não é id é recusado pela API (nunca um nome, regra 6).
    expect(
      await codigo(
        s.adm("PATCH", `/invoicing-connections/${id}`, {
          versao: (await ligacaoDe(s, id))["versao"],
          config: { lingua: "Português de Portugal" },
        }),
      ),
    ).toEqual([400, expect.any(String)]);
  });
  // ----------------------------- As correcções da revisão do #384 (Moloni)

  it("revisão P1-1: o fecho sem resposta fica incerto e a reconciliação adopta o fechado — uma só fatura", async () => {
    const s = await cenario();
    await ligarMoloni(s);
    moloni.estado.falhas.rede = new Set(["invoices/update"]);
    moloni.estado.falhas.getAllSemReferencia = true;
    try {
      const e = await paga(s, [[s.v1, 1]]);
      await ateParar();
      const d = await documentoDe(s, e.encomenda);
      expect(d?.["estado"]).toBe("incerto");
      moloni.estado.falhas.rede = new Set();
      await adiantar(s);
      await ateParar();
      const depois = await documentoDe(s, e.encomenda);
      expect(depois?.["estado"]).toBe("emitido");
      const ref = `inv_${String(d?.["id"]).slice(4)}`;
      expect(
        moloni.estado.documentos.filter((x) => x.our_reference === ref),
      ).toHaveLength(1);
    } finally {
      moloni.estado.falhas.rede = new Set();
      moloni.estado.falhas.getAllSemReferencia = false;
    }
  });

  it("revisão P2-8: duas renovações ao mesmo tempo gastam o par uma só vez (a ligação trancada)", async () => {
    const s = await cenario();
    const { id } = await ligarMoloni(s);
    relogio += 8 * 24 * 3_600_000;
    try {
      const [r1, r2] = await Promise.all([
        correrRenovacoes(base.api, faturacao),
        correrRenovacoes(base.api, faturacao),
      ]);
      expect(r1.erros + r2.erros).toBe(0);
      expect((await ligacaoDe(s, id))["estado"]).toBe("pronta");
    } finally {
      relogio = 0;
    }
  });

  it("revisão P2-2/P2-8: uma falha de rede ou o segredo do servidor errado na renovação não tocam na ligação", async () => {
    const s = await cenario();
    const { id } = await ligarMoloni(s);
    const antes = await ligacaoDe(s, id);
    relogio += 8 * 24 * 3_600_000;
    try {
      moloni.estado.falhas.recusar = new Set(["grant"]);
      expect(
        (await correrRenovacoes(base.api, faturacao)).erros,
      ).toBeGreaterThan(0);
      moloni.estado.falhas.recusar = new Set();
      moloni.estado.falhas.segredoErrado = true;
      expect(
        (await correrRenovacoes(base.api, faturacao)).erros,
      ).toBeGreaterThan(0);
      expect(await ligacaoDe(s, id)).toMatchObject({
        estado: "pronta",
        versao: antes["versao"],
      });
    } finally {
      relogio = 0;
      moloni.estado.falhas.recusar = new Set();
      moloni.estado.falhas.segredoErrado = false;
    }
  });

  it("revisão P2-8: a fila das renovações não se lê nem se escreve pela API, e o gatilho só aceita ids na configuração", async () => {
    const s = await cenario();
    const { id } = await ligarMoloni(s);
    await expect(
      naBase(s, (trx) => sql`select * from tarefa_renovacao`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    for (const config of [
      '{"lingua": "Português de Portugal"}',
      '{"metodos_pagamento": "9"}',
      '{"metodos_pagamento": {"multibanco": 9}}',
      '{"Lingua": "1"}',
    ]) {
      await expect(
        sql`update ligacao_faturacao set config = ${config}::jsonb
          where id = ${id.slice(4)}::uuid`.execute(base.dono),
      ).rejects.toThrow(/invoices\.invalid_field/);
    }
  });
  // ------------------------- Emitida fora do Eurolify (docs/29 §15; EA)

  /** Paga antes de a entidade escolher quem emite: retida por quem emite. */
  async function pagaAntesDeEscolher(s: Cenario) {
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    const d = (await documentoDe(s, e.encomenda)) as Json;
    // Sem emissor escolhido também não há ligação: os dois motivos.
    expect(d["estado"]).toBe("retido");
    expect(d["motivos"]).toContain("emissor_por_configurar");
    return { e, d };
  }

  it("emitida fora: a fatura retida de uma encomenda paga antes da escolha sai para o sistema próprio, com o número declarado", async () => {
    const s = await cenario();
    const { e, d } = await pagaAntesDeEscolher(s);
    const id = String(d["id"]);
    const corpo = {
      versao: d["versao"],
      motivo: "a loja passou a faturar no sistema dela",
      numero: "FT 2026/57",
    };
    // Com a entidade ainda por configurar, a resposta é configurar (F2).
    expect(
      await codigo(s.adm("POST", `/invoices/${id}/issued-elsewhere`, corpo)),
    ).toEqual([409, "invoices.invalid_transition"]);
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "sistema_proprio",
      }),
      204,
    );
    // O gestor não decide quem emite (Q-F1).
    const gestor = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Gestor",
        ambitos: ["invoices:read", "invoices:write"],
      })
    ).segredo;
    expect(
      await codigo(
        pedir("POST", `/invoices/${id}/issued-elsewhere`, corpo, {
          authorization: `Bearer ${gestor}`,
        }),
      ),
    ).toEqual([403, "auth.forbidden"]);
    // Sem número, recusa (Q-F2).
    expect(
      (
        await s.adm("POST", `/invoices/${id}/issued-elsewhere`, {
          versao: d["versao"],
          motivo: corpo.motivo,
        })
      ).statusCode,
    ).toBe(400);
    await ok(s.adm("POST", `/invoices/${id}/issued-elsewhere`, corpo));
    const depois = (await documentoDe(s, e.encomenda)) as Json;
    expect(depois).toMatchObject({
      estado: "fora",
      motivos: [],
      emissor_id: null,
      prova: null,
      emitida_fora: { numero_declarado: "FT 2026/57", prova: false },
    });
    const passo = (depois["rasto"] as Json[]).find((p) => p["para"] === "fora");
    expect(passo).toMatchObject({
      motivo: "a loja passou a faturar no sistema dela",
      dados: { numero_declarado: "FT 2026/57" },
    });
    // O evento diz o tipo (revisão do #386, P3).
    const { rows: ev } = await sql<{
      dados: Json;
    }>`select dados from evento_saida
      where comerciante_id = ${s.c}::uuid and tipo = 'invoice.issued_elsewhere'`.execute(
      base.dono,
    );
    expect(ev.map((x) => x.dados["tipo"])).toEqual(["fatura"]);
    expect(await eventos(s)).toContain("invoice.issued_elsewhere");
    // Fora da fila «A decidir» (F4) e final: não volta a nada.
    const { rows } = await naBase(s, (trx) =>
      sql<{
        caso: string;
      }>`select caso from documentos_casos_a_decidir()`.execute(trx),
    );
    expect(rows.map((r) => r.caso)).not.toContain(id.slice(4));
    expect(
      await codigo(
        s.adm("POST", `/invoices/${id}/recheck`, {
          versao: depois["versao"],
        }),
      ),
    ).toEqual([409, "invoices.invalid_transition"]);
    await expect(
      sql`update documento_fiscal set fora_numero = 'outro'
        where id = ${id.slice(4)}::uuid`.execute(base.dono),
    ).rejects.toThrow(/invoices\.immutable/);
    await expect(
      sql`update documento_fiscal set estado = 'retido', fora_numero = null
        where id = ${id.slice(4)}::uuid`.execute(base.dono),
    ).rejects.toThrow(/invoices\.immutable/);
  });

  it("emitida fora (revisão do #386): a base confere a escolha da entidade, a versão, a reserva e o número", async () => {
    const s = await cenario();
    const { d } = await pagaAntesDeEscolher(s);
    const id = String(d["id"]);
    // P2-4: retida por quem emite, mas a entidade ainda não escolheu — a
    // base recusa, mesmo sem a API.
    await expect(
      sql`update documento_fiscal set estado = 'fora', fora_numero = 'FT 1'
        where id = ${id.slice(4)}::uuid`.execute(base.dono),
    ).rejects.toThrow(/invoices\.invalid_transition/);
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "sistema_proprio",
      }),
      204,
    );
    // Sem número, a base também recusa a fatura (F3).
    await expect(
      sql`update documento_fiscal set estado = 'fora'
        where id = ${id.slice(4)}::uuid`.execute(base.dono),
    ).rejects.toThrow(/invoices\.invalid_transition|fora_com_numero/);
    // Um número com uma quebra de linha não entra (P3).
    await expect(
      sql`update documento_fiscal set estado = 'fora', fora_numero = ${"FT\n2026/1"}
        where id = ${id.slice(4)}::uuid`.execute(base.dono),
    ).rejects.toThrow(/fora_numero_check|violates check/);
    const corpo = {
      versao: d["versao"],
      motivo: "faturada no sistema da loja",
      numero: "FT 2026/59",
    };
    // P2-5: versão desactualizada e documento reservado pela tarefa.
    expect(
      await codigo(
        s.adm("POST", `/invoices/${id}/issued-elsewhere`, {
          ...corpo,
          versao: Number(d["versao"]) + 5,
        }),
      ),
    ).toEqual([409, "invoices.version_conflict"]);
    await sql`update documento_fiscal set reservado_ate = now() + interval '5 minutes'
      where id = ${id.slice(4)}::uuid`.execute(base.dono);
    expect(
      await codigo(s.adm("POST", `/invoices/${id}/issued-elsewhere`, corpo)),
    ).toEqual([503, "invoices.retry"]);
    await sql`update documento_fiscal set reservado_ate = null
      where id = ${id.slice(4)}::uuid`.execute(base.dono);
    await ok(s.adm("POST", `/invoices/${id}/issued-elsewhere`, corpo));
  });

  it("emitida fora: recusada numa fatura que não é o caso exacto (F2), também na base", async () => {
    const s = await cenario();
    // Retida por outro motivo (a ligação sem teste), com a entidade a emitir
    // pelo Eurolify.
    const conta = `c-${randomUUID()}`;
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "eurolify",
      }),
      204,
    );
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    const d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("retido");
    expect(
      await codigo(
        s.adm("POST", `/invoices/${String(d["id"])}/issued-elsewhere`, {
          versao: d["versao"],
          motivo: "tentativa fora do caso",
          numero: "FT 1",
        }),
      ),
    ).toEqual([409, "invoices.invalid_transition"]);
    // A base recusa o mesmo, mesmo sem a API.
    await expect(
      sql`update documento_fiscal set estado = 'fora', fora_numero = 'FT 1'
        where id = ${String(d["id"]).slice(4)}::uuid`.execute(base.dono),
    ).rejects.toThrow(/invoices\.invalid_transition/);
    // Uma fatura emitida também não.
    await ligar(s, conta);
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/recheck`, {
        versao: d["versao"],
      }),
    );
    await ateParar();
    const emitida = (await documentoDe(s, e.encomenda)) as Json;
    expect(emitida["estado"]).toBe("emitido");
    expect(
      await codigo(
        s.adm("POST", `/invoices/${String(d["id"])}/issued-elsewhere`, {
          versao: emitida["versao"],
          motivo: "tentativa numa emitida",
          numero: "FT 1",
        }),
      ),
    ).toEqual([409, "invoices.invalid_transition"]);
  });
  // ----------------------------------- O relatório OSS (docs/37; EF, #310)

  // O trimestre de hoje no fuso de Portugal, como o relatório (P2).
  const trimestreDeHoje = () => periodoDe(hojeEmLisboa(), "trimestre");
  // Uma linha do CSV em células: as vírgulas dentro de aspas não partem.
  const celulasCsv = (linha: string) => {
    const celulas: string[] = [];
    let actual = "";
    let aspas = false;
    for (let i = 0; i < linha.length; i += 1) {
      const ch = linha.charAt(i);
      if (aspas && ch === '"' && linha.charAt(i + 1) === '"') {
        actual += '"';
        i += 1;
      } else if (ch === '"') {
        aspas = !aspas;
      } else if (ch === "," && !aspas) {
        celulas.push(actual);
        actual = "";
      } else {
        actual += ch;
      }
    }
    celulas.push(actual);
    return celulas;
  };
  const relatorio = (s: Cenario, periodo: string) =>
    ok(
      s.adm(
        "GET",
        `/tax-reports/oss?entidade=lgl_${s.entidade}&periodo=${periodo}`,
      ),
    );

  it("relatório OSS: a venda nacional emitida entra no balde nacional, das provas; o período em curso não fecha", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    const e = await paga(s, [[s.v1, 2]]);
    await ateParar();
    const d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("emitido");
    const periodo = trimestreDeHoje();
    const r = await relatorio(s, periodo);
    const prova = d["prova"] as { totais: { base: number; iva: number } };
    const nacional = (r["baldes"] as Json[]).find(
      (b) => b["balde"] === "nacional",
    );
    expect(nacional).toMatchObject({
      base: prova.totais.base,
      iva: prova.totais.iva,
      linhas: [{ pais: "PT", taxa: 2300, documentos: 1 }],
    });
    expect(
      (r["baldes"] as Json[]).find((b) => b["balde"] === "oss")?.["linhas"],
    ).toEqual([]);
    expect(r["limiar"]).toMatchObject({ limiar: 1_000_000, passou: false });
    expect(r["impedimentos"]).toContainEqual({
      motivo: "periodo_em_curso",
      documentos: [],
    });
    expect(
      await codigo(
        s.adm("POST", "/tax-reports/oss/close", {
          entidade: `lgl_${s.entidade}`,
          periodo,
        }),
      ),
    ).toEqual([409, "tax_reports.not_closable"]);
    // Os registos do art. 63.º-C, em CSV.
    const csv = await s.adm(
      "GET",
      `/tax-reports/oss/records?entidade=lgl_${s.entidade}&periodo=${periodo}`,
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/^text\/csv/);
    // Com BOM, para a folha de cálculo ler os acentos (revisão do #392).
    expect(csv.body.startsWith("\uFEFF")).toBe(true);
    const linhas = csv.body.slice(1).trim().split("\r\n");
    expect(linhas[0]).toMatch(/^periodo,periodo_original,tipo,numero/);
    expect(linhas).toHaveLength(
      1 + (prova as unknown as { linhas: unknown[] }).linhas.length,
    );
    expect(linhas[1]).toContain(String((d["prova"] as Json)["numero"]));
    // Sem decisão do dono: «nao» e as três colunas vazias (P3-6).
    const cabecalho = celulasCsv(linhas[0] ?? "");
    for (const l of linhas.slice(1).map(celulasCsv)) {
      expect(l).toHaveLength(cabecalho.length);
      expect(l.slice(-4)).toEqual(["nao", "", "", ""]);
    }
  });

  it("relatório OSS: fechar um período passado congela-o; o que chega depois com data dele é alteração do período seguinte (P3, P4, P6)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    const corpo = { entidade: `lgl_${s.entidade}`, periodo: "2026-T3" };
    // Só o dono fecha (Q-O4).
    const gestor = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Gestor",
        ambitos: ["tax:read"],
      })
    ).segredo;
    expect(
      await codigo(
        pedir("POST", "/tax-reports/oss/close", corpo, {
          authorization: `Bearer ${gestor}`,
        }),
      ),
    ).toEqual([403, "auth.forbidden"]);
    const fechado = await ok(s.adm("POST", "/tax-reports/oss/close", corpo));
    expect(fechado["fechado"]).toMatchObject({ versao_regra: 1 });
    expect(
      await codigo(s.adm("POST", "/tax-reports/oss/close", corpo)),
    ).toEqual([409, "tax_reports.already_closed"]);
    const antes = await relatorio(s, "2026-T3");
    // Um período anterior ao último fechado já não se fecha (P1-B).
    expect((await relatorio(s, "2026-T2"))["impedimentos"]).toContainEqual({
      motivo: "periodo_posterior_fechado",
      documentos: [],
    });
    expect(
      await codigo(
        s.adm("POST", "/tax-reports/oss/close", {
          ...corpo,
          periodo: "2026-T2",
        }),
      ),
    ).toEqual([409, "tax_reports.not_closable"]);
    // Uma fatura que sai agora com a data de 15/09 (o emissor de ensaio
    // devolve a data que se lhe disser).
    ensaio.conta(conta).aoFechar = (doc) => ({ ...doc, data: "2026-09-15" });
    const e = await paga(s, [[s.v1, 2]]);
    await ateParar();
    delete ensaio.conta(conta).aoFechar;
    const d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("emitido");
    // O período fechado não muda (é a fotografia).
    expect(await relatorio(s, "2026-T3")).toEqual(antes);
    const t4 = await relatorio(s, "2026-T4");
    expect(t4["alteracoes"]).toEqual([
      expect.objectContaining({
        periodo_original: "2026-T3",
        balde: "nacional",
        pais: "PT",
        taxa: 2300,
        documentos: 1,
      }),
    ]);
    // A base não deixa mudar nem apagar um fecho.
    await expect(
      sql`update relatorio_oss_fecho set periodo = '2026-T2'
        where comerciante_id = ${s.c}::uuid`.execute(base.dono),
    ).rejects.toThrow(/tax_reports\.immutable/);
    await expect(
      sql`delete from relatorio_oss_fecho where comerciante_id = ${s.c}::uuid`.execute(
        base.dono,
      ),
    ).rejects.toThrow(/tax_reports\.immutable/);
    expect(await eventos(s)).toContain("tax_report.closed");
    // A API não lê fechos nem documentos declarados de outro comerciante.
    await expect(
      naBase(s, (trx) =>
        sql`select count(*) from relatorio_oss_fecho`.execute(trx),
      ),
    ).resolves.toMatchObject({ rows: [{ count: "1" }] });
    // Os registos do T4 trazem a alteração com o período de origem (P4).
    const registos = await s.adm(
      "GET",
      `/tax-reports/oss/records?entidade=lgl_${s.entidade}&periodo=2026-T4`,
    );
    expect(registos.statusCode).toBe(200);
    expect(registos.body).toContain(",2026-T3,fatura,");
  });

  it("relatório OSS: outro comerciante não lê nem fecha; dois fechos ao mesmo tempo dão um só", async () => {
    const s = await cenario();
    const outro = await cenario();
    const corpo = { entidade: `lgl_${s.entidade}`, periodo: "2026-T2" };
    expect(
      await codigo(
        outro.adm(
          "GET",
          `/tax-reports/oss?entidade=lgl_${s.entidade}&periodo=2026-T2`,
        ),
      ),
    ).toEqual([404, "tax_reports.not_found"]);
    expect(
      await codigo(outro.adm("POST", "/tax-reports/oss/close", corpo)),
    ).toEqual([404, "tax_reports.not_found"]);
    const respostas = await Promise.all([
      s.adm("POST", "/tax-reports/oss/close", corpo),
      s.adm("POST", "/tax-reports/oss/close", corpo),
    ]);
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      respostas.find((r) => r.statusCode === 409)?.json<Json>(),
    ).toMatchObject({ codigo: "tax_reports.already_closed" });
  });

  it("relatório OSS: uma fatura resolvida com a taxa diferente impede; o dono classifica-a uma vez e entra com a taxa da prova (P1-A)", async () => {
    const s = await cenario();
    const outro = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    // O emissor devolve a primeira linha a 21 % em vez de 23 %.
    ensaio.conta(conta).aoFechar = (doc) => ({
      ...doc,
      linhas: doc.linhas.map((l, i) => (i === 0 ? { ...l, taxa: 2100 } : l)),
    });
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    delete ensaio.conta(conta).aoFechar;
    let d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("divergente");
    const nacionalPT = (d["prova"] as Json)["linhas"] as Json[];
    const corpoDivergente = {
      documento: d["id"],
      linhas: nacionalPT.map(() => ({ balde: "nacional", pais: "PT" })),
      motivo: "ainda por resolver",
    };
    // Divergente ainda por resolver: não se classifica (3.ª revisão, P3-2).
    expect(
      await codigo(
        s.adm("POST", "/tax-reports/oss/classifications", corpoDivergente),
      ),
    ).toEqual([409, "tax_reports.not_classifiable"]);
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/resolve`, {
        versao: d["versao"],
        motivo: "aceite: a taxa sai na nota de crédito",
      }),
    );
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("resolvido");
    const periodo = trimestreDeHoje();
    expect((await relatorio(s, periodo))["impedimentos"]).toContainEqual({
      motivo: "linhas_desalinhadas",
      documentos: [d["id"]],
    });
    const provaLinhas = (d["prova"] as Json)["linhas"] as Json[];
    const corpo = {
      documento: d["id"],
      linhas: provaLinhas.map(() => ({ balde: "nacional", pais: "PT" })),
      motivo: "visto: declara-se à taxa da fatura emitida",
    };
    // Outro comerciante não o vê; uma linha a menos e uma data com a prova
    // datada são recusadas.
    expect(
      await codigo(
        outro.adm("POST", "/tax-reports/oss/classifications", corpo),
      ),
    ).toEqual([404, "tax_reports.not_found"]);
    expect(
      await codigo(
        s.adm("POST", "/tax-reports/oss/classifications", {
          ...corpo,
          linhas: corpo.linhas.slice(1),
        }),
      ),
    ).toEqual([400, "tax_reports.invalid"]);
    expect(
      await codigo(
        s.adm("POST", "/tax-reports/oss/classifications", {
          ...corpo,
          data: "2026-10-01",
        }),
      ),
    ).toEqual([400, "tax_reports.invalid"]);
    // O par balde/país tem de ser coerente (P2-A): OSS para o próprio país,
    // nacional noutro, exportação dentro da UE.
    for (const par of [
      { balde: "oss", pais: "PT" },
      { balde: "nacional", pais: "ES" },
      { balde: "exportacao", pais: "FR" },
    ]) {
      expect(
        await codigo(
          s.adm("POST", "/tax-reports/oss/classifications", {
            ...corpo,
            linhas: corpo.linhas.map(() => par),
          }),
        ),
      ).toEqual([400, "tax_reports.invalid"]);
    }
    // Só o dono classifica (tax:write).
    const leitor = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Leitor",
        ambitos: ["tax:read"],
      })
    ).segredo;
    expect(
      await codigo(
        pedir("POST", "/tax-reports/oss/classifications", corpo, {
          authorization: `Bearer ${leitor}`,
        }),
      ),
    ).toEqual([403, "auth.forbidden"]);
    await ok(s.adm("POST", "/tax-reports/oss/classifications", corpo));
    expect(
      await codigo(s.adm("POST", "/tax-reports/oss/classifications", corpo)),
    ).toEqual([409, "tax_reports.already_classified"]);
    const r = await relatorio(s, periodo);
    expect((r["impedimentos"] as Json[]).map((i) => i["motivo"])).not.toContain(
      "linhas_desalinhadas",
    );
    const nacional = (r["baldes"] as Json[]).find(
      (b) => b["balde"] === "nacional",
    ) as Json;
    expect(nacional["linhas"]).toContainEqual(
      expect.objectContaining({ pais: "PT", taxa: 2100, documentos: 1 }),
    );
    // Uma fatura que o relatório já classifica não se classifica à mão.
    const e2 = await paga(s, [[s.v1, 1]]);
    await ateParar();
    const d2 = (await documentoDe(s, e2.encomenda)) as Json;
    expect(d2["estado"]).toBe("emitido");
    expect(
      await codigo(
        s.adm("POST", "/tax-reports/oss/classifications", {
          ...corpo,
          documento: d2["id"],
        }),
      ),
    ).toEqual([409, "tax_reports.not_classifiable"]);
    // A base não deixa mudar a decisão.
    await expect(
      sql`update relatorio_oss_classificacao set motivo = 'outro'
        where comerciante_id = ${s.c}::uuid`.execute(base.dono),
    ).rejects.toThrow(/tax_reports\.immutable/);
  });

  it("relatório OSS: uma prova sem data impede; o dono dá-lhe uma data entre o pedido e hoje (P1-A; P2-B)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    ensaio.conta(conta).aoFechar = (doc) => ({ ...doc, data: null });
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    delete ensaio.conta(conta).aoFechar;
    const d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("emitido");
    const periodo = trimestreDeHoje();
    expect((await relatorio(s, periodo))["impedimentos"]).toContainEqual({
      motivo: "sem_data",
      documentos: [d["id"]],
    });
    const corpo = {
      documento: d["id"],
      linhas: ((d["prova"] as Json)["linhas"] as Json[]).map(() => ({
        balde: "nacional",
        pais: "PT",
      })),
      motivo: "a data está no PDF da fatura",
    };
    for (const data of [undefined, "2015-01-01", "2099-01-01"]) {
      expect(
        await codigo(
          s.adm(
            "POST",
            "/tax-reports/oss/classifications",
            data === undefined ? corpo : { ...corpo, data },
          ),
        ),
      ).toEqual([400, "tax_reports.invalid"]);
    }
    const hoje = hojeEmLisboa();
    await ok(
      s.adm("POST", "/tax-reports/oss/classifications", {
        ...corpo,
        data: hoje,
      }),
    );
    const r = await relatorio(s, periodo);
    expect((r["impedimentos"] as Json[]).map((i) => i["motivo"])).not.toContain(
      "sem_data",
    );
    expect(
      ((r["baldes"] as Json[]).find((b) => b["balde"] === "nacional") as Json)[
        "linhas"
      ],
    ).toContainEqual(expect.objectContaining({ pais: "PT", documentos: 1 }));
    // Os registos dizem que o balde e a data foram decididos à mão, por quem
    // e quando (3.ª revisão do #392, P3-6).
    // O dia da decisão é o de Lisboa: 23:30 UTC no Verão já é o dia
    // seguinte (a tabela não deixa mudar; só aqui, para o teste).
    await base.dono.transaction().execute(async (trx) => {
      await sql`alter table relatorio_oss_classificacao
        disable trigger relatorio_oss_classificacao_so_acrescenta`.execute(trx);
      await sql`update relatorio_oss_classificacao
        set decidido_em = '2026-07-01T23:30:00Z'
        where comerciante_id = ${s.c}::uuid`.execute(trx);
      await sql`alter table relatorio_oss_classificacao
        enable always trigger relatorio_oss_classificacao_so_acrescenta`.execute(
        trx,
      );
    });
    const csv = await s.adm(
      "GET",
      `/tax-reports/oss/records?entidade=lgl_${s.entidade}&periodo=${periodo}`,
    );
    expect(csv.statusCode).toBe(200);
    const [cabecalho, ...linhas] = csv.body
      .slice(1)
      .trim()
      .split("\r\n")
      .map(celulasCsv);
    expect(cabecalho?.slice(-4)).toEqual([
      "classificado",
      "data_decidida",
      "classificado_por",
      "classificado_em",
    ]);
    expect(linhas.length).toBeGreaterThan(0);
    for (const l of linhas) {
      expect(l).toHaveLength(cabecalho?.length ?? 0);
      const [classificado, data, por, em] = l.slice(-4);
      expect([classificado, data, em]).toEqual(["sim", hoje, "2026-07-02"]);
      expect(por).toMatch(/^(chave:key_|pessoa:per_)\S+$/);
    }
  });

  it("relatório OSS: uma prova com montantes negativos e sem data não se classifica, nem depois de resolvida (3.ª revisão do #392, P3-8)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    ensaio.conta(conta).aoFechar = (doc) => ({
      ...doc,
      data: null,
      linhas: doc.linhas.map((l, i) =>
        i === 0 ? { ...l, base: -l.base, iva: -l.iva } : l,
      ),
    });
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    delete ensaio.conta(conta).aoFechar;
    let d = (await documentoDe(s, e.encomenda)) as Json;
    // A conferência apanha os montantes trocados; resolve-se para chegar ao
    // relatório.
    expect(d["estado"]).toBe("divergente");
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/resolve`, {
        versao: d["versao"],
        motivo: "aceite para o teste",
      }),
    );
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("resolvido");
    const resposta = await s.adm("POST", "/tax-reports/oss/classifications", {
      documento: d["id"],
      linhas: ((d["prova"] as Json)["linhas"] as Json[]).map(() => ({
        balde: "nacional",
        pais: "PT",
      })),
      data: hojeEmLisboa(),
      motivo: "a data está no PDF da fatura",
    });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.body).toContain("tax_reports.not_classifiable");
    expect(resposta.body).toContain("sinal_inesperado");
  });

  it("relatório OSS: uma prova sem linhas declara-se à parte, fecha o período e sai nos registos sem valores (docs/37 §11, P3-7)", async () => {
    const s = await cenario();
    const conta = `c-${randomUUID()}`;
    await ligar(s, conta);
    // O emissor devolve uma fatura de 15/09 sem linhas.
    ensaio.conta(conta).aoFechar = (doc) => ({
      ...doc,
      data: "2026-09-15",
      linhas: [],
    });
    const e = await paga(s, [[s.v1, 1]]);
    await ateParar();
    delete ensaio.conta(conta).aoFechar;
    let d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("divergente");
    const aParte = {
      documento: d["id"],
      a_parte: true,
      motivo: "linhas no PDF, declaradas à mão",
    };
    const classificar = (corpo: Json) =>
      codigo(s.adm("POST", "/tax-reports/oss/classifications", corpo));
    // Por resolver: não (P3-2).
    expect(await classificar(aParte)).toEqual([
      409,
      "tax_reports.not_classifiable",
    ]);
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/resolve`, {
        versao: d["versao"],
        motivo: "aceite: a fatura saiu sem linhas",
      }),
    );
    d = (await documentoDe(s, e.encomenda)) as Json;
    expect(d["estado"]).toBe("resolvido");
    expect((await relatorio(s, "2026-T3"))["impedimentos"]).toContainEqual({
      motivo: "linhas_desalinhadas",
      documentos: [d["id"]],
    });
    // As linhas e à parte ao mesmo tempo, nenhum dos dois, linhas numa
    // prova sem linhas, ou uma data numa prova que já a tem: 400.
    for (const corpo of [
      { ...aParte, linhas: [{ balde: "nacional", pais: "PT" }] },
      { documento: d["id"], motivo: "x" },
      {
        documento: d["id"],
        motivo: "x",
        linhas: [{ balde: "nacional", pais: "PT" }],
      },
      { ...aParte, data: hojeEmLisboa() },
    ]) {
      expect(await classificar(corpo)).toEqual([400, "tax_reports.invalid"]);
    }
    // Uma prova com linhas não se declara à parte.
    const e2 = await paga(s, [[s.v1, 1]]);
    await ateParar();
    const d2 = (await documentoDe(s, e2.encomenda)) as Json;
    expect(await classificar({ ...aParte, documento: d2["id"] })).toEqual([
      409,
      "tax_reports.not_classifiable",
    ]);
    const feito = await ok(
      s.adm("POST", "/tax-reports/oss/classifications", aParte),
    );
    expect(feito["classificacao"]).toEqual({
      linhas: [],
      data: null,
      a_parte: true,
    });
    // Sai dos impedimentos e fica na lista à parte.
    const t3 = await relatorio(s, "2026-T3");
    expect(t3["impedimentos"]).toEqual([]);
    const declarados = (t3["a_parte"] as Json)["declarados"] as Json[];
    expect(declarados).toEqual([
      expect.objectContaining({
        documento: d["id"],
        data: "2026-09-15",
        alteracao_de: null,
        decidido_em: hojeEmLisboa(),
      }),
    ]);
    expect(
      (t3["baldes"] as Json[]).every(
        (b) => (b["linhas"] as Json[]).length === 0,
      ),
    ).toBe(true);
    // No limiar, conta nos excluídos.
    expect(
      ((t3["limiar"] as Json)["documentos_excluidos"] as number) >= 1,
    ).toBe(true);
    // Fecha-se o T3 com ele; a fotografia guarda a lista à parte.
    const fechado = await ok(
      s.adm("POST", "/tax-reports/oss/close", {
        entidade: `lgl_${s.entidade}`,
        periodo: "2026-T3",
      }),
    );
    expect((fechado["a_parte"] as Json)["declarados"]).toEqual(declarados);
    // Nos registos: uma linha, sem valores, marcada à parte.
    const csv = await s.adm(
      "GET",
      `/tax-reports/oss/records?entidade=lgl_${s.entidade}&periodo=2026-T3`,
    );
    expect(csv.statusCode).toBe(200);
    const [cabecalho, ...linhas] = csv.body
      .slice(1)
      .trim()
      .split("\r\n")
      .map(celulasCsv);
    expect(linhas).toHaveLength(1);
    const linha = Object.fromEntries(
      (cabecalho ?? []).map((c, i) => [c, linhas[0]?.[i]]),
    );
    expect(linha).toMatchObject({
      numero: (d["prova"] as Json)["numero"],
      balde: "",
      descricao: "",
      valor_tributavel: "",
      iva: "",
      classificado: "a_parte",
    });
    // A base guarda as duas formas e mais nenhuma.
    for (const [aParteNaBase, linhasNaBase] of [
      [true, '[{"balde":"nacional","pais":"PT"}]'],
      [false, "[]"],
    ] as const) {
      await expect(
        sql`insert into relatorio_oss_classificacao
          (comerciante_id, documento_id, linhas, a_parte, motivo, decidido_por)
          values (${s.c}::uuid, ${String(d2["id"]).slice(4)}::uuid,
            ${linhasNaBase}::jsonb, ${aParteNaBase}, 'x', 'teste')`.execute(
          base.dono,
        ),
      ).rejects.toThrow(/relatorio_oss_classificacao_linhas_check/);
    }
  });

  it("relatório OSS: as vendas emitidas fora do Eurolify ficam à parte, com o número declarado (Q-F3)", async () => {
    const s = await cenario();
    const { d } = await pagaAntesDeEscolher(s);
    await ok(
      s.adm("PUT", `/legal-entities/lgl_${s.entidade}/invoicing`, {
        emissor: "sistema_proprio",
      }),
      204,
    );
    await ok(
      s.adm("POST", `/invoices/${String(d["id"])}/issued-elsewhere`, {
        versao: d["versao"],
        motivo: "faturada no sistema da loja",
        numero: "FT 2026/90",
      }),
    );
    const r = await relatorio(s, trimestreDeHoje());
    expect((r["a_parte"] as Json)["emitidas_fora"]).toEqual([
      expect.objectContaining({
        documento: d["id"],
        numero_declarado: "FT 2026/90",
        pais: "PT",
      }),
    ]);
    for (const b of r["baldes"] as Json[]) expect(b["linhas"]).toEqual([]);
    expect(
      await codigo(
        s.adm(
          "GET",
          `/tax-reports/oss?entidade=lgl_${s.entidade}&periodo=2026-T9`,
        ),
      ),
    ).toEqual([400, expect.any(String)]);
  });
});
