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
import { correrTrabalho } from "../src/envios/etiquetas.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import { assinar, avisoEuPago, eupagoFalso } from "./eupago-falso.js";
import {
  assinarAviso,
  CHAVE_BOA,
  transportadoraFalsa,
} from "./transportadora-falsa.js";
import {
  adaptadorSendcloud,
  SERVICO_DE_TESTE,
} from "../src/envios/sendcloud.js";
import { opcao, PUBLICA, SECRETA, sendcloudFalsa } from "./sendcloud-falsa.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Os envios, parte B (docs/36 §3.3 a §3.5, §4, §8; migração 0079): a etiqueta
// pela conta e pelo serviço vendidos, com o peso da caixa; uma etiqueta viva
// por expedição; a incerta que nunca se repete às cegas; anular; o seguimento
// por consulta e por aviso assinado; perdida ⇒ um problema; e a volta da API
// que apaga os ficheiros. A transportadora é a de ensaio
// (test/transportadora-falsa.ts), com o contrato inteiro.

type Json = Record<string, unknown>;
const QUEM = "pessoa:teste";
const SEGREDO_PAGAMENTOS = "segredo-dos-avisos-123";
const SEGREDO_ENVIOS = "segredo-da-transportadora-1";

describe.skipIf(URL_BASE === undefined)("API dos envios (parte B)", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  const eupago = eupagoFalso();
  const ctt = transportadoraFalsa();
  const sc = sendcloudFalsa();
  const envios = {
    chave: chavePagamentos(randomBytes(32).toString("base64")),
    adaptadores: {
      ctt: ctt.adaptador,
      sendcloud: adaptadorSendcloud(sc.buscar),
    },
    // A transportadora que não responde desiste-se dela depressa (P2-6).
    tempoLimiteMs: 1000,
  };

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    app = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      undefined,
      undefined,
      { pedidos: 100_000, janelaMs: 60_000 },
      eupago.config,
      undefined,
      envios,
    );
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  const pedir = (
    metodo: "POST" | "PUT" | "GET" | "PATCH",
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
   * Um comerciante português com o mercado Portugal, um artigo de 30 g
   * publicado com 100 unidades, os textos legais, a régua dos pagamentos, uma
   * conta dos CTT pronta (com segredo dos avisos) e dois métodos: um com a
   * conta e o serviço EXPRESSO_48, outro manual.
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
      [{ sku: "GEL-001", unidade_de_venda: "unidade", peso_g: 30 }],
    );
    const v1 = (
      await comComerciante(base.api, c, (trx) =>
        trx
          .selectFrom("variante")
          .select("id")
          .where("artigo_id", "=", artigo)
          .executeTakeFirstOrThrow(),
      )
    ).id;
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
    await publicar(base.api, c, QUEM, {
      artigo_id: artigo,
      canal_id: canal,
      mercado_id: mercado,
    });
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
          "shipping:accounts",
          "orders:read",
          "payments:read",
          "payments:write",
          "payments:accounts",
          "inventory:read",
          "inventory:write",
          "fulfilment:read",
          "fulfilment:write",
          "returns:read",
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
    const armazem = String(
      (
        await ok(
          adm("POST", "/warehouses", { loja: `sto_${loja}`, nome: "Armazém" }),
          201,
        )
      )["id"],
    );
    await ok(
      adm("POST", "/inventory/receipts", {
        armazem,
        linhas: [{ variante: `var_${v1}`, quantidade: 100 }],
      }),
      201,
    );
    const contaPag = String(
      (
        await ok(
          adm("POST", "/payment-accounts", { prestador: "eupago", nome: "P" }),
          201,
        )
      )["id"],
    );
    await ok(
      adm("PUT", `/payment-accounts/${contaPag}/credentials`, {
        chave: "xxxx-xxxx-xxxx-xxxx",
        segredo_aviso: SEGREDO_PAGAMENTOS,
      }),
      204,
    );
    await ok(adm("POST", `/payment-accounts/${contaPag}/test`));
    await ok(
      adm("POST", "/payment-methods", {
        mercado: `mkt_${mercado}`,
        metodo: "multibanco",
        conta: contaPag,
      }),
      201,
    );
    const conta = String(
      (
        await ok(
          adm("POST", "/carrier-accounts", {
            transportadora: "ctt",
            nome: "CTT",
            remetente: {
              nome: "Armazém",
              linha1: "Rua 1",
              codigo_postal: "1000-001",
              localidade: "Lisboa",
              pais: "PT",
            },
          }),
          201,
        )
      )["id"],
    );
    await ok(
      adm("PUT", `/carrier-accounts/${conta}/credentials`, {
        credenciais: { chave: CHAVE_BOA },
        segredo_aviso: SEGREDO_ENVIOS,
      }),
      204,
    );
    await ok(adm("POST", `/carrier-accounts/${conta}/test`));
    const metodoCtt = String(
      (
        await ok(
          adm("POST", "/shipping-methods", {
            mercado: `mkt_${mercado}`,
            nome: { pt: "CTT Expresso" },
            tarifa: 499,
            conta,
            servico: "EXPRESSO_48",
          }),
          201,
        )
      )["id"],
    );
    const metodoManual = String(
      (
        await ok(
          adm("POST", "/shipping-methods", {
            mercado: `mkt_${mercado}`,
            nome: { pt: "Entrega pela loja" },
            tarifa: 299,
          }),
          201,
        )
      )["id"],
    );
    return {
      c,
      loja,
      mercado,
      canal,
      v1,
      publica,
      adm,
      versoes,
      armazem,
      contaPag,
      conta,
      metodoCtt,
      metodoManual,
    };
  }
  type Cenario = Awaited<ReturnType<typeof cenario>>;

  /** Uma encomenda paga (o aviso do Multibanco assinado) e uma expedição criada. */
  async function expedicaoPaga(s: Cenario, metodo: string, quantidade = 2) {
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
    await ok(
      pedir(
        "POST",
        `/store/carts/${String(carrinho["id"])}/lines`,
        { variante: `var_${s.v1}`, quantidade },
        segredo,
      ),
    );
    const token = String(
      (
        await ok(
          pedir(
            "POST",
            `/store/carts/${String(carrinho["id"])}/checkout`,
            undefined,
            segredo,
          ),
          201,
        )
      )["token"],
    );
    await ok(
      pedir("PUT", `/checkout/${token}/contact`, {
        email: "rui@exemplo.pt",
        nome: "Rui",
        telefone: "+351912345678",
      }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/delivery`, {
        pais: "PT",
        codigo_postal: "1000-001",
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
    await ok(pedir("PUT", `/checkout/${token}/delivery-method`, { metodo }));
    await ok(
      pedir("PUT", `/checkout/${token}/payment-method`, {
        metodo: "multibanco",
      }),
    );
    const resumo = await ok(pedir("GET", `/checkout/${token}/summary`));
    const e = await ok(
      pedir("POST", `/checkout/${token}/place`, {
        aceita_condicoes: true,
        versoes: (resumo["textos"] as Json[]).map((t) => t["versao"]),
        impressao: resumo["impressao"],
      }),
      201,
    );
    const encomenda = String(e["encomenda"]);
    const p = await ok(pedir("POST", `/checkout/${token}/payment`), 201);
    const pag = await ok(s.adm("GET", `/payments/${String(p["id"])}`));
    const corpo = avisoEuPago({
      identifier: String(pag["referencia"]),
      status: "Paid",
      valor: Number(pag["montante"]) / 100,
      trid: Math.floor(Math.random() * 1e9),
    });
    const r = await app.inject({
      method: "POST",
      url: `/webhooks/payments/${s.contaPag}`,
      headers: {
        "content-type": "application/json",
        "x-signature": assinar(corpo, SEGREDO_PAGAMENTOS),
      },
      payload: corpo,
    });
    expect(r.statusCode, r.body).toBe(200);
    const v = await ok(s.adm("GET", `/fulfilment/orders/${encomenda}`));
    const linha = (v["linhas"] as Json[])[0] as Json;
    const x = await ok(
      s.adm("POST", `/orders/${encomenda}/shipments`, {
        linhas: [{ linha: linha["id"], quantidade }],
      }),
      201,
    );
    return { encomenda, expedicao: String(x["id"]) };
  }

  /** Põe a etiqueta da expedição como mudada há `idade` (só nos testes). */
  async function envelhecer(c: string, expedicao: string, idade: string) {
    await comComerciante(base.dono, c, async (trx) => {
      await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
        trx,
      );
      await sql`update expedicao set etiqueta_em = now() - ${idade}::interval
        where id = ${expedicao.slice(4)}::uuid`.execute(trx);
    });
  }

  /** A vez da expedição na volta da API chegou. */
  const aVezChegou = (expedicao: string) =>
    sql`update trabalho_envio set quando = now() - interval '1 minute'
      where expedicao_id = ${expedicao.slice(4)}::uuid`.execute(base.dono);

  const versaoDe = async (expedicao: string) =>
    (
      await sql<{
        versao: number;
      }>`select versao from expedicao where id = ${expedicao.slice(4)}::uuid`.execute(
        base.dono,
      )
    ).rows[0]?.versao ?? 0;

  /** Um aviso da transportadora para a conta do cenário. */
  const avisoCtt = (s: Cenario, dados: Json, segredo = SEGREDO_ENVIOS) => {
    const corpo = JSON.stringify(dados);
    return app.inject({
      method: "POST",
      url: `/webhooks/carriers/ctt/${s.conta}`,
      headers: {
        "content-type": "application/json",
        "x-assinatura": assinarAviso(corpo, segredo),
      },
      payload: corpo,
    });
  };

  it("o percurso: a etiqueta com o serviço vendido e o peso da caixa, uma só viva, o ficheiro, e o seguimento até entregue (sem repetir eventos)", async () => {
    const s = await cenario();
    ctt.estado.pedir = "emitir";
    ctt.estado.consultar = "responde";
    await ok(
      s.adm("PUT", `/warehouses/${s.armazem}/packaging`, { embalagem_g: 150 }),
      204,
    );
    const { encomenda, expedicao } = await expedicaoPaga(s, s.metodoCtt, 2);
    const antes = ctt.estado.pedidos.length;
    const e = await ok(s.adm("POST", `/shipments/${expedicao}/label`));
    expect(e).toMatchObject({
      etiqueta: "emitida",
      tentativa: 1,
      conta: s.conta,
      transportadora: "ctt",
      servico: "EXPRESSO_48",
      // 2 × 30 g + 150 g de embalagem.
      peso_g: 210,
      ficheiro: "pdf",
      url_seguimento: expect.stringMatching(/^https:\/\//) as unknown,
    });
    const pedido = ctt.estado.pedidos[antes];
    expect(pedido).toMatchObject({
      referencia: `${expedicao.slice(4)}-1`,
      servico: "EXPRESSO_48",
      pesoG: 210,
      destinatario: {
        nome: "Rui",
        linha1: "Rua 2",
        codigo_postal: "1000-001",
        pais: "PT",
      },
    });
    // Só o que a entrega precisa (docs/36 §6): o serviço não pede telefone
    // nem e-mail, e não vão.
    expect(pedido?.destinatario.telefone).toBeUndefined();
    expect(pedido?.destinatario.email).toBeUndefined();
    // O ficheiro.
    const f = await s.adm("GET", `/shipments/${expedicao}/label/file`);
    expect(f.statusCode).toBe(200);
    expect(f.headers["content-type"]).toBe("application/pdf");
    expect(f.body).toContain("%PDF-falso");
    // Uma etiqueta viva: pedir outra não chega à transportadora.
    expect(
      await codigo(s.adm("POST", `/shipments/${expedicao}/label`)),
    ).toEqual([409, "shipping.label_exists"]);
    expect(ctt.estado.pedidos.length).toBe(antes + 1);
    // O seguimento: recolhida e entregue.
    ctt.estado.eventos.set(String(e["seguimento"]), [
      {
        idExterno: "ev-1",
        estadoTransportadora: "ACEITE",
        estadoNormalizado: "recolhida",
        em: new Date("2026-10-12T10:00:00Z"),
      },
      {
        idExterno: "ev-2",
        estadoTransportadora: "ENTREGUE",
        estadoNormalizado: "entregue",
        em: new Date("2026-10-13T15:00:00Z"),
      },
    ]);
    const r = await ok(s.adm("POST", `/shipments/${expedicao}/refresh`));
    expect(r).toMatchObject({ estado_expedicao: "entregue", novos: 2 });
    const enc = await ok(s.adm("GET", `/orders/${encomenda}`));
    expect(enc["estado"]).toBe("entregue");
    // Outra vez: os mesmos eventos não contam duas vezes.
    expect(
      await ok(s.adm("POST", `/shipments/${expedicao}/refresh`)),
    ).toMatchObject({ novos: 0 });
    const ev = (await ok(s.adm("GET", `/shipments/${expedicao}/events`)))[
      "dados"
    ] as Json[];
    expect(ev.map((x) => x["estado"])).toEqual(["recolhida", "entregue"]);
    // O ficheiro fica 30 dias depois de a expedição acabar (Q7).
    const { rows } = await sql<{
      dias: number;
    }>`select round(extract(epoch from quando - now()) / 86400) as dias
        from trabalho_envio where expedicao_id = ${expedicao.slice(4)}::uuid`.execute(
      base.dono,
    );
    expect(Number(rows[0]?.dias)).toBe(30);
  });

  it("a etiqueta incerta não se repete às cegas: consulta-se e fica emitida (existia) ou recusada (não chegou), e então pede-se outra", async () => {
    const s = await cenario();
    // Criada na transportadora, mas a resposta perdeu-se.
    ctt.estado.consultar = "responde";
    ctt.estado.pedir = "rede_mas_criada";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    expect(
      await ok(s.adm("POST", `/shipments/${a.expedicao}/label`)),
    ).toMatchObject({ etiqueta: "incerta" });
    ctt.estado.pedir = "emitir";
    const antes = ctt.estado.pedidos.length;
    expect(
      await codigo(s.adm("POST", `/shipments/${a.expedicao}/label`)),
    ).toEqual([409, "shipping.label_uncertain"]);
    expect(ctt.estado.pedidos.length).toBe(antes);
    expect(
      await ok(s.adm("POST", `/shipments/${a.expedicao}/refresh`)),
    ).toMatchObject({ etiqueta: "emitida", tentativa: 1, ficheiro: "pdf" });
    // Não chegou à transportadora: fica recusada e pede-se outra (tentativa 2).
    ctt.estado.pedir = "rede";
    const b = await expedicaoPaga(s, s.metodoCtt, 1);
    await ok(s.adm("POST", `/shipments/${b.expedicao}/label`));
    // Logo a seguir, «não existe» ainda pode ser a transportadora a
    // processar: não se conclui (revisão do #400, P2-2).
    expect(
      await ok(s.adm("POST", `/shipments/${b.expedicao}/refresh`)),
    ).toMatchObject({ etiqueta: "incerta" });
    await envelhecer(s.c, b.expedicao, "20 minutes");
    expect(
      await ok(s.adm("POST", `/shipments/${b.expedicao}/refresh`)),
    ).toMatchObject({ etiqueta: "recusada" });
    ctt.estado.pedir = "emitir";
    expect(
      await ok(s.adm("POST", `/shipments/${b.expedicao}/label`)),
    ).toMatchObject({ etiqueta: "emitida", tentativa: 2 });
    expect(ctt.estado.pedidos.at(-1)?.referencia).toBe(
      `${b.expedicao.slice(4)}-2`,
    );
    // Recusada pela transportadora: o motivo fica.
    ctt.estado.pedir = "recusar";
    const c = await expedicaoPaga(s, s.metodoCtt, 1);
    expect(
      await ok(s.adm("POST", `/shipments/${c.expedicao}/label`)),
    ).toMatchObject({
      etiqueta: "recusada",
      motivo: "código postal desconhecido",
    });
  });

  it("anular: a transportadora deixa ⇒ anulada e sem ficheiro; não deixa ⇒ continua emitida; um método manual não pede etiqueta", async () => {
    const s = await cenario();
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    const e = await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    ctt.estado.anular = "nao_permitido";
    expect(
      await codigo(s.adm("POST", `/shipments/${a.expedicao}/label/void`)),
    ).toEqual([409, "shipping.void_not_allowed"]);
    ctt.estado.anular = "anulada";
    expect(
      await ok(s.adm("POST", `/shipments/${a.expedicao}/label/void`)),
    ).toMatchObject({ etiqueta: "anulada", seguimento: null, ficheiro: null });
    expect(ctt.estado.anuladas).toContain(e["seguimento"]);
    expect(
      await codigo(s.adm("GET", `/shipments/${a.expedicao}/label/file`)),
    ).toEqual([404, "shipping.not_found"]);
    // Depois de anulada, pode pedir-se outra.
    expect(
      await ok(s.adm("POST", `/shipments/${a.expedicao}/label`)),
    ).toMatchObject({ etiqueta: "emitida", tentativa: 2 });
    // O método manual.
    const m = await expedicaoPaga(s, s.metodoManual, 1);
    expect(
      await codigo(s.adm("POST", `/shipments/${m.expedicao}/label`)),
    ).toEqual([400, "shipping.invalid_field"]);
  });

  it("o aviso assinado muda a expedição; sem assinatura não muda nada mas fica gravado; perdida abre um problema na pós-venda", async () => {
    const s = await cenario();
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    const e = await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    const dados = {
      referencia: `${a.expedicao.slice(4)}-1`,
      eventos: [
        {
          id: "av-1",
          estado: "EM_TRANSITO",
          normalizado: "em_transito",
          em: "2026-10-12T10:00:00Z",
        },
      ],
    };
    // Assinatura errada: 401 e nada muda, mas o aviso fica gravado.
    const falso = await avisoCtt(s, dados, "outro-segredo-qualquer");
    expect(falso.statusCode).toBe(401);
    expect(
      await ok(s.adm("GET", `/shipments/${a.expedicao}/label`)),
    ).toMatchObject({ estado_expedicao: "criada" });
    // Assinado: expedida.
    expect((await avisoCtt(s, dados)).statusCode).toBe(200);
    expect(
      await ok(s.adm("GET", `/shipments/${a.expedicao}/label`)),
    ).toMatchObject({ estado_expedicao: "expedida" });
    // Perdida, pelo número de seguimento: um problema para uma pessoa (Q4).
    const perdida = {
      seguimento: e["seguimento"],
      eventos: [
        {
          id: "av-2",
          estado: "EXTRAVIADO",
          normalizado: "perdida",
          em: "2026-10-14T10:00:00Z",
        },
      ],
    };
    expect((await avisoCtt(s, perdida)).statusCode).toBe(200);
    expect((await avisoCtt(s, perdida)).statusCode).toBe(200);
    expect(
      await ok(s.adm("GET", `/shipments/${a.expedicao}/label`)),
    ).toMatchObject({ estado_expedicao: "perdida" });
    const avisos = (
      await sql<{
        assinatura_valida: boolean;
        resultado: string | null;
      }>`select assinatura_valida, resultado from aviso_transportadora
          where comerciante_id = ${s.c}::uuid order by recebido_em, id`.execute(
        base.dono,
      )
    ).rows;
    expect(avisos.map((x) => x.assinatura_valida)).toEqual([
      false,
      true,
      true,
      true,
    ]);
    const problemas = (
      await sql<{
        tipo: string;
        descricao: string;
      }>`select tipo, descricao from problema
          where comerciante_id = ${s.c}::uuid`.execute(base.dono)
    ).rows;
    // Um só problema, mesmo com o aviso repetido.
    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.descricao).toContain("perdida");
    // O isolamento (revisão do #400, P2-7): um aviso bem assinado que chega
    // ao endereço da conta de outro comerciante, com a referência de uma
    // expedição deste, não lhe toca (fica «ignorado»).
    const outro = await cenario();
    const b = await expedicaoPaga(s, s.metodoCtt, 1);
    await ok(s.adm("POST", `/shipments/${b.expedicao}/label`));
    const alheio = {
      referencia: `${b.expedicao.slice(4)}-1`,
      eventos: [
        {
          id: "av-x",
          estado: "EM_TRANSITO",
          normalizado: "em_transito",
          em: "2026-10-12T10:00:00Z",
        },
      ],
    };
    expect((await avisoCtt(outro, alheio)).statusCode).toBe(200);
    expect(
      await ok(s.adm("GET", `/shipments/${b.expedicao}/label`)),
    ).toMatchObject({ estado_expedicao: "criada" });
    // Uma tentativa que já não é a viva também não (P3-1).
    expect(
      (
        await avisoCtt(s, {
          ...alheio,
          referencia: `${b.expedicao.slice(4)}-9`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      await ok(s.adm("GET", `/shipments/${b.expedicao}/label`)),
    ).toMatchObject({ estado_expedicao: "criada" });
    const resultados = (
      await sql<{
        resultado: string | null;
      }>`select resultado from aviso_transportadora
          where conta_id in (${outro.conta.slice(4)}::uuid, ${s.conta.slice(4)}::uuid)
          order by recebido_em desc, id desc limit 2`.execute(base.dono)
    ).rows;
    expect(resultados.map((x) => x.resultado)).toEqual([
      "ignorado",
      "ignorado",
    ]);
    // Uma conta que não existe responde como uma assinatura errada.
    const r = await app.inject({
      method: "POST",
      url: `/webhooks/carriers/ctt/cac_${randomUUID()}`,
      headers: {
        "content-type": "application/json",
        "x-assinatura": assinarAviso(JSON.stringify(alheio), SEGREDO_ENVIOS),
      },
      payload: JSON.stringify(alheio),
    });
    expect(r.statusCode).toBe(401);
    // As rotas novas, com expedições e armazéns de outro comerciante: não
    // existem.
    for (const [m, url] of [
      ["GET", `/shipments/${b.expedicao}/label`],
      ["GET", `/shipments/${b.expedicao}/label/file`],
      ["GET", `/shipments/${b.expedicao}/events`],
      ["POST", `/shipments/${b.expedicao}/refresh`],
      ["POST", `/shipments/${b.expedicao}/label/void`],
      ["POST", `/shipments/${b.expedicao}/label`],
    ] as const) {
      expect(await codigo(outro.adm(m, url)), url).toEqual([
        404,
        "shipping.not_found",
      ]);
    }
    expect(
      await codigo(
        outro.adm("PUT", `/warehouses/${s.armazem}/packaging`, {
          embalagem_g: 10,
        }),
      ),
    ).toEqual([404, "shipping.not_found"]);
  });

  it("duas pessoas a pedir a etiqueta ao mesmo tempo: a transportadora recebe um pedido só", async () => {
    const s = await cenario();
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    let soltar: () => void = () => undefined;
    ctt.estado.atraso = new Promise<void>((r) => {
      soltar = r;
    });
    const antes = ctt.estado.pedidos.length;
    try {
      const primeiro = s.adm("POST", `/shipments/${a.expedicao}/label`);
      // O segundo chega enquanto o primeiro espera pela transportadora.
      while (ctt.estado.pedidos.length === antes) {
        await new Promise((r) => setTimeout(r, 10));
      }
      const segundo = await codigo(
        s.adm("POST", `/shipments/${a.expedicao}/label`),
      );
      soltar();
      expect(segundo).toEqual([409, "shipping.label_exists"]);
      expect(await ok(primeiro)).toMatchObject({ etiqueta: "emitida" });
      expect(ctt.estado.pedidos.length).toBe(antes + 1);
    } finally {
      soltar();
      ctt.estado.atraso = null;
    }
  });

  it("o pedido que fica a meio (a transportadora não responde, ou a API reinicia) não prende a expedição: a volta passa-o a incerta e consulta", async () => {
    const s = await cenario();
    ctt.estado.consultar = "responde";
    // Não responde: o núcleo desiste ao fim do tempo-limite (P2-6).
    ctt.estado.pedir = "pendurar";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    expect(
      await ok(s.adm("POST", `/shipments/${a.expedicao}/label`)),
    ).toMatchObject({ etiqueta: "incerta" });
    // A API reiniciou a meio do pedido (P1-1): a etiqueta ficou «a_pedir».
    ctt.estado.pedir = "emitir";
    const b = await expedicaoPaga(s, s.metodoCtt, 1);
    const id = b.expedicao.slice(4);
    await comComerciante(base.dono, s.c, async (trx) => {
      await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
        trx,
      );
      await sql`update expedicao set etiqueta = 'a_pedir', etiqueta_tentativa = 1,
          conta_transportadora_id = ${s.conta.slice(4)}::uuid, transportadora = 'ctt',
          servico = 'EXPRESSO_48'
        where id = ${id}::uuid`.execute(trx);
    });
    // A transportadora chegou a criá-la.
    ctt.emitir(`${id}-1`);
    // Ainda dentro dos 5 minutos: a volta não lhe toca.
    await aVezChegou(b.expedicao);
    await correrTrabalho(base.api, envios);
    expect(
      await ok(s.adm("GET", `/shipments/${b.expedicao}/label`)),
    ).toMatchObject({ etiqueta: "a_pedir" });
    await envelhecer(s.c, b.expedicao, "10 minutes");
    await aVezChegou(b.expedicao);
    const r = await correrTrabalho(base.api, envios);
    expect(r.falhas).toBe(0);
    expect(
      await ok(s.adm("GET", `/shipments/${b.expedicao}/label`)),
    ).toMatchObject({ etiqueta: "incerta" });
    // Na volta seguinte, consulta-se pela referência e fica emitida.
    await aVezChegou(b.expedicao);
    await correrTrabalho(base.api, envios);
    expect(
      await ok(s.adm("GET", `/shipments/${b.expedicao}/label`)),
    ).toMatchObject({ etiqueta: "emitida", tentativa: 1, ficheiro: "pdf" });
  });

  it("com a etiqueta viva, a expedição não se cancela nem troca o número ou o serviço por fora", async () => {
    const s = await cenario();
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    expect(
      await codigo(
        s.adm("PATCH", `/shipments/${a.expedicao}`, {
          versao: await versaoDe(a.expedicao),
          estado: "cancelada",
        }),
      ),
    ).toEqual([409, "shipments.invalid_transition"]);
    expect(
      await codigo(
        s.adm("PATCH", `/shipments/${a.expedicao}`, {
          versao: await versaoDe(a.expedicao),
          seguimento: "OUTRO123PT",
        }),
      ),
    ).toEqual([409, "shipments.invalid_transition"]);
    // Anulada, já se cancela.
    ctt.estado.anular = "anulada";
    await ok(s.adm("POST", `/shipments/${a.expedicao}/label/void`));
    await ok(
      s.adm("PATCH", `/shipments/${a.expedicao}`, {
        versao: await versaoDe(a.expedicao),
        estado: "cancelada",
      }),
    );
  });

  it("os eventos fora de ordem aplicam-se pela data; um evento que contradiz uma expedição acabada abre um problema", async () => {
    const s = await cenario();
    ctt.estado.pedir = "emitir";
    ctt.estado.consultar = "responde";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    const e = await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    // Chegam ao contrário: entregue primeiro, recolhida depois.
    ctt.estado.eventos.set(String(e["seguimento"]), [
      {
        idExterno: "o-2",
        estadoTransportadora: "ENTREGUE",
        estadoNormalizado: "entregue",
        em: new Date("2026-10-13T15:00:00Z"),
      },
      {
        idExterno: "o-1",
        estadoTransportadora: "ACEITE",
        estadoNormalizado: "recolhida",
        em: new Date("2026-10-12T10:00:00Z"),
      },
      // Um evento que não se pode gravar descarta-se (P3-2).
      {
        idExterno: " ",
        estadoTransportadora: "X",
        estadoNormalizado: "outro",
        em: new Date("2026-10-12T11:00:00Z"),
      },
    ]);
    expect(
      await ok(s.adm("POST", `/shipments/${a.expedicao}/refresh`)),
    ).toMatchObject({ estado_expedicao: "entregue", novos: 2 });
    // Depois de entregue, a transportadora diz perdida: fica entregue, e
    // uma pessoa vê a contradição.
    ctt.estado.eventos.set(String(e["seguimento"]), [
      {
        idExterno: "o-3",
        estadoTransportadora: "EXTRAVIADO",
        estadoNormalizado: "perdida",
        em: new Date("2026-10-14T10:00:00Z"),
      },
    ]);
    expect(
      await ok(s.adm("POST", `/shipments/${a.expedicao}/refresh`)),
    ).toMatchObject({ estado_expedicao: "entregue", novos: 1 });
    const problemas = (
      await sql<{
        descricao: string;
      }>`select descricao from problema
          where comerciante_id = ${s.c}::uuid`.execute(base.dono)
    ).rows;
    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.descricao).toContain("já entregue");
  });

  it("a volta da API: segue a etiqueta até entregue e apaga o ficheiro quando o prazo dos 30 dias passa", async () => {
    const s = await cenario();
    ctt.estado.pedir = "emitir";
    ctt.estado.consultar = "responde";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    const e = await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    ctt.estado.eventos.set(String(e["seguimento"]), [
      {
        idExterno: "t-1",
        estadoTransportadora: "ENTREGUE",
        estadoNormalizado: "entregue",
        em: new Date("2026-10-13T15:00:00Z"),
      },
    ]);
    const id = a.expedicao.slice(4);
    // A vez da expedição chegou.
    await sql`update trabalho_envio set quando = now() - interval '1 minute'
      where expedicao_id = ${id}::uuid`.execute(base.dono);
    await correrTrabalho(base.api, envios);
    expect(
      await ok(s.adm("GET", `/shipments/${a.expedicao}/label`)),
    ).toMatchObject({ estado_expedicao: "entregue", ficheiro: "pdf" });
    // Passados os 30 dias: o ficheiro sai e o trabalho acaba.
    await sql`update trabalho_envio set quando = now() - interval '1 minute'
      where expedicao_id = ${id}::uuid`.execute(base.dono);
    await correrTrabalho(base.api, envios);
    expect(
      await ok(s.adm("GET", `/shipments/${a.expedicao}/label`)),
    ).toMatchObject({ ficheiro: null });
    const { rows } = await sql<{
      n: number;
    }>`select count(*)::int as n from trabalho_envio
        where expedicao_id = ${id}::uuid`.execute(base.dono);
    expect(rows[0]?.n).toBe(0);
  });

  it("os eventos de seguimento só se acrescentam, e a etiqueta só anda pelos caminhos certos", async () => {
    const s = await cenario();
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    await expect(
      comComerciante(base.dono, s.c, (trx) =>
        sql`update evento_seguimento set estado_normalizado = 'entregue'`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/shipping.immutable/);
    await expect(
      comComerciante(base.dono, s.c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await sql`update expedicao set etiqueta = 'por_pedir'
          where id = ${a.expedicao.slice(4)}::uuid`.execute(trx);
      }),
    ).rejects.toThrow(/shipping.invalid_transition/);
  });
  it("a Sendcloud (docs/36 §16): os serviços da conta guardados no teste, só o sem custo; a etiqueta; o aviso assinado faz consultar", async () => {
    const s = await cenario();
    sc.estado.servicos.set("PT", [
      opcao(SERVICO_DE_TESTE, { maxKg: "2.000" }),
      opcao("ctt:expresso_48"),
    ]);
    const conta = String(
      (
        await ok(
          s.adm("POST", "/carrier-accounts", {
            transportadora: "sendcloud",
            nome: "Sendcloud",
            remetente: {
              nome: "Armazém",
              linha1: "Rua 1",
              codigo_postal: "1000-001",
              localidade: "Lisboa",
              pais: "PT",
            },
          }),
          201,
        )
      )["id"],
    );
    await ok(
      s.adm("PUT", `/carrier-accounts/${conta}/credentials`, {
        credenciais: { chave_publica: PUBLICA, chave_secreta: SECRETA },
        segredo_aviso: SECRETA,
      }),
      204,
    );
    // Antes do teste, a conta não tem serviços.
    expect(
      (await ok(s.adm("GET", `/carrier-accounts/${conta}/services`)))["dados"],
    ).toEqual([]);
    await ok(s.adm("POST", `/carrier-accounts/${conta}/test`));
    const servicos = (
      await ok(s.adm("GET", `/carrier-accounts/${conta}/services`))
    )["dados"] as Json[];
    // Só o serviço sem custo (D2), para o país do mercado.
    expect(servicos.map((x) => [x["codigo"], x["paises"]])).toEqual([
      [SERVICO_DE_TESTE, ["PT"]],
    ]);
    // Um método com um serviço que a conta não tem é recusado.
    expect(
      await codigo(
        s.adm("POST", "/shipping-methods", {
          mercado: `mkt_${s.mercado}`,
          nome: { pt: "CTT por Sendcloud" },
          tarifa: 499,
          conta,
          servico: "ctt:expresso_48",
        }),
      ),
    ).toEqual([422, "shipping.service_unknown"]);
    const metodo = String(
      (
        await ok(
          s.adm("POST", "/shipping-methods", {
            mercado: `mkt_${s.mercado}`,
            nome: { pt: "Teste Sendcloud" },
            tarifa: 0,
            conta,
            servico: SERVICO_DE_TESTE,
          }),
          201,
        )
      )["id"],
    );
    const a = await expedicaoPaga(s, metodo, 1);
    const e = await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    expect(e).toMatchObject({
      etiqueta: "emitida",
      transportadora: "sendcloud",
      servico: SERVICO_DE_TESTE,
      ficheiro: "pdf",
    });
    const id = a.expedicao.slice(4);
    expect(sc.estado.envios.at(-1)?.referencia).toBe(`${id}-1`);
    // O aviso assinado (D4): sem eventos, marca a consulta para já.
    const corpo = JSON.stringify({
      action: "parcel_status_changed",
      parcel: { tracking_number: e["seguimento"] },
    });
    const r = await app.inject({
      method: "POST",
      url: `/webhooks/carriers/sendcloud/${conta}`,
      headers: {
        "content-type": "application/json",
        "sendcloud-signature": assinarAviso(corpo, SECRETA),
      },
      payload: corpo,
    });
    expect(r.statusCode, r.body).toBe(200);
    const { rows } = await sql<{
      segundos: number;
    }>`select extract(epoch from quando - now()) as segundos
        from trabalho_envio where expedicao_id = ${id}::uuid`.execute(
      base.dono,
    );
    expect(Number(rows[0]?.segundos)).toBeLessThanOrEqual(61);
    // A volta consulta e a expedição anda.
    sc.estado.eventos.set(String(e["seguimento"]), [
      {
        event_at: "2026-10-13T15:00:00Z",
        phase: "delivered",
        exception: "none",
        sub_status: "none",
      },
    ]);
    await aVezChegou(a.expedicao);
    await correrTrabalho(base.api, envios);
    expect(
      await ok(s.adm("GET", `/shipments/${a.expedicao}/label`)),
    ).toMatchObject({ estado_expedicao: "entregue" });
    // Um aviso atrasado numa expedição acabada não antecipa o apagamento do
    // ficheiro (30 dias, Q7; revisão do #406, P2-3).
    const r2 = await app.inject({
      method: "POST",
      url: `/webhooks/carriers/sendcloud/${conta}`,
      headers: {
        "content-type": "application/json",
        "sendcloud-signature": assinarAviso(corpo, SECRETA),
      },
      payload: corpo,
    });
    expect(r2.statusCode, r2.body).toBe(200);
    const depois = await sql<{
      dias: number;
    }>`select round(extract(epoch from quando - now()) / 86400) as dias
        from trabalho_envio where expedicao_id = ${id}::uuid`.execute(
      base.dono,
    );
    expect(Number(depois.rows[0]?.dias)).toBe(30);
    // A lista de serviços falha no teste: a conta continua pronta (P2-1).
    sc.estado.opcoesFalham = true;
    expect(
      await codigo(s.adm("POST", `/carrier-accounts/${conta}/test`)),
    ).toEqual([503, "shipping.carrier_unavailable"]);
    sc.estado.opcoesFalham = false;
    const contas = (await ok(s.adm("GET", "/carrier-accounts")))[
      "dados"
    ] as Json[];
    expect(contas.find((x) => x["id"] === conta)?.["estado"]).toBe("pronta");
    // A conta deixou de ter o serviço do método activo: a fotografia nova
    // é recusada, com o método (P2-2).
    sc.estado.servicos.set("PT", [opcao("ctt:expresso_48")]);
    const recusa = await s.adm("POST", `/carrier-accounts/${conta}/test`);
    expect(recusa.statusCode, recusa.body).toBe(409);
    expect(recusa.json<Json>()["codigo"]).toBe("shipping.service_in_use");
    expect(JSON.stringify(recusa.json())).toContain(`shm_${metodo.slice(4)}`);
    expect(
      (await ok(s.adm("GET", `/carrier-accounts/${conta}/services`)))["dados"],
    ).toHaveLength(1);
  });
});
