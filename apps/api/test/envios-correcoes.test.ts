import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { comComerciante } from "../src/comerciante/repositorio.js";
import { porQueNaoServeACaixa } from "../src/envios/correcoes.js";
import { criarChave } from "../src/identidade/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { cenariosDeEnvios, type Cenario } from "./envios-cenario.js";
import { eupagoFalso } from "./eupago-falso.js";
import { hubDeTeste } from "./hub-de-teste.js";
import { transportadoraFalsa } from "./transportadora-falsa.js";

// Corrigir o peso e mudar o serviço de uma expedição, com motivo (docs/36
// §19; migração 0086). A etiqueta usa o corrigido e o escolhido; o vendido
// não muda; com uma etiqueta viva não se corrige; o serviço só se escolhe
// entre os que servem a caixa, pelo dono e pelo gestor, nunca por uma IA; e
// cada correcção fica no rasto com o motivo.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("Envios: corrigir a expedição", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  const eupago = eupagoFalso();
  const ctt = transportadoraFalsa();
  let s: Cenario;
  let outro: Cenario;
  const p: Record<string, string> = {};

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    h = hubDeTeste(base, {
      envios: {
        chave: chavePagamentos(randomBytes(32).toString("base64")),
        adaptadores: { ctt: ctt.adaptador },
        tempoLimiteMs: 1000,
      },
      pagamentos: eupago.config,
      limites: { pedidos: 100_000, janelaMs: 60_000 },
    });
    s = await apoio.cenario();
    outro = await apoio.cenario();
    for (const papel of ["dono", "gestor", "armazem"]) {
      p[papel] = (await h.pessoaCom(s.c, papel)).sessao;
    }
  }, 180_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  const apoio = cenariosDeEnvios(
    () => h.app,
    () => base,
  );
  const { ok, codigo, expedicaoPaga } = apoio;
  const como = (
    papel: string,
    metodo: "GET" | "PUT" | "POST",
    url: string,
    corpo?: unknown,
    cabecalhos?: Record<string, string>,
  ) =>
    h.pedir(metodo, url, {
      sessao: p[papel] ?? "",
      comerciante: s.c,
      ...(corpo === undefined ? {} : { corpo }),
      ...(cabecalhos === undefined ? {} : { cabecalhos }),
    });
  const okHub = async (
    r: Promise<{ statusCode: number; body: string }>,
    estado = 200,
  ) => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(estado);
    return x.body === "" ? {} : (JSON.parse(x.body) as Json);
  };
  const codigoHub = async (
    r: Promise<{ statusCode: number; body: string }>,
  ): Promise<[number, unknown]> => {
    const x = await r;
    return [x.statusCode, (JSON.parse(x.body) as Json)["codigo"]];
  };
  const versaoDe = async (expedicao: string) =>
    Number((await ok(s.adm("GET", `/shipments/${expedicao}/label`)))["versao"]);
  const ultimoPedido = () => ctt.estado.pedidos[ctt.estado.pedidos.length - 1];

  it("o peso corrigido vai na etiqueta, com o motivo no rasto; null volta ao calculado; com a etiqueta viva não se corrige", async () => {
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(s, s.metodoCtt, 2);
    const servicos = await ok(
      s.adm("GET", `/shipments/${a.expedicao}/services`),
    );
    // 2 × 30 g, sem embalagem no armazém.
    expect(servicos).toMatchObject({
      peso_calculado_g: 60,
      peso_corrigido_g: null,
      escolhido: null,
    });
    await ok(
      s.adm("PUT", `/shipments/${a.expedicao}/weight`, {
        versao: await versaoDe(a.expedicao),
        peso_g: 1450,
        motivo: "caixa grande, pesada na balança",
      }),
    );
    await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    expect(ultimoPedido()?.pesoG).toBe(1450);
    expect(
      await ok(s.adm("GET", `/shipments/${a.expedicao}/label`)),
    ).toMatchObject({ peso_g: 1450, peso_corrigido_g: 1450 });
    // Com a etiqueta emitida, não se corrige: anula-se primeiro.
    expect(
      await codigo(
        s.adm("PUT", `/shipments/${a.expedicao}/weight`, {
          versao: await versaoDe(a.expedicao),
          peso_g: 900,
          motivo: "afinal é menos",
        }),
      ),
    ).toEqual([409, "shipping.label_exists"]);
    ctt.estado.anular = "anulada";
    await ok(s.adm("POST", `/shipments/${a.expedicao}/label/void`));
    await ok(
      s.adm("PUT", `/shipments/${a.expedicao}/weight`, {
        versao: await versaoDe(a.expedicao),
        peso_g: null,
        motivo: "volta ao calculado",
      }),
    );
    await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    expect(ultimoPedido()?.pesoG).toBe(60);
    const rasto = (
      await ok(s.adm("GET", `/shipments/${a.expedicao}/corrections`))
    )["dados"] as Json[];
    expect(rasto).toMatchObject([
      {
        campo: "peso",
        antes: null,
        depois: 1450,
        motivo: "caixa grande, pesada na balança",
      },
      {
        campo: "peso",
        antes: 1450,
        depois: null,
        motivo: "volta ao calculado",
      },
    ]);
    expect(String(rasto[0]?.["quem"])).toMatch(/^chave:key_/);
  });

  it("o serviço escolhido vai na etiqueta e o vendido não muda; só os que servem a caixa", async () => {
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    const id = a.expedicao.replace(/^shp_/, "");
    const antes = await comComerciante(base.dono, s.c, (trx) =>
      trx
        .selectFrom("expedicao")
        .select("metodo_entrega")
        .where("id", "=", id)
        .executeTakeFirstOrThrow(),
    );
    const servicos = await ok(
      s.adm("GET", `/shipments/${a.expedicao}/services`),
    );
    const opcoes = (servicos["opcoes"] as Json[]).map((o) => [
      o["servico"],
      o["vendido"],
    ]);
    // O telefone está na encomenda; Espanha não serve uma morada em Portugal.
    expect(opcoes).toEqual([
      ["EXPRESSO_48", true],
      ["COM_TELEFONE", false],
    ]);
    const conta = s.conta;
    const mudar = (
      servico: string | null,
      motivo = "o serviço vendido deixou de servir",
    ) =>
      versaoDe(a.expedicao).then((versao) =>
        s.adm("PUT", `/shipments/${a.expedicao}/service`, {
          versao,
          conta: servico === null ? null : conta,
          servico,
          motivo,
        }),
      );
    expect(await codigo(mudar("SO_ESPANHA"))).toEqual([
      400,
      "shipping.invalid_field",
    ]);
    expect(await codigo(mudar("NAO_EXISTE"))).toEqual([
      422,
      "shipping.service_unknown",
    ]);
    // Sem motivo, não.
    expect((await mudar("COM_TELEFONE", "")).statusCode).toBe(400);
    // Uma versão que não é a lida dá conflito.
    expect(
      await codigo(
        s.adm("PUT", `/shipments/${a.expedicao}/service`, {
          versao: 99,
          conta,
          servico: "COM_TELEFONE",
          motivo: "versão antiga",
        }),
      ),
    ).toEqual([409, "shipping.version_conflict"]);
    // A conta de outro comerciante não existe aqui.
    expect(
      await codigo(
        s.adm("PUT", `/shipments/${a.expedicao}/service`, {
          versao: await versaoDe(a.expedicao),
          conta: outro.conta,
          servico: "EXPRESSO_48",
          motivo: "outra conta",
        }),
      ),
    ).toEqual([404, "shipping.not_found"]);
    await ok(mudar("COM_TELEFONE"));
    await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    expect(ultimoPedido()?.servico).toBe("COM_TELEFONE");
    expect(
      await ok(s.adm("GET", `/shipments/${a.expedicao}/label`)),
    ).toMatchObject({
      servico: "COM_TELEFONE",
      escolhido: { conta, servico: "COM_TELEFONE" },
    });
    // O vendido fica como foi vendido.
    const depois = await comComerciante(base.dono, s.c, (trx) =>
      trx
        .selectFrom("expedicao")
        .select("metodo_entrega")
        .where("id", "=", id)
        .executeTakeFirstOrThrow(),
    );
    expect(depois.metodo_entrega).toEqual(antes.metodo_entrega);
    const rasto = (
      await ok(s.adm("GET", `/shipments/${a.expedicao}/corrections`))
    )["dados"] as Json[];
    expect(rasto).toMatchObject([
      {
        campo: "servico",
        antes: null,
        depois: { conta, servico: "COM_TELEFONE" },
      },
    ]);
  });

  it("um método manual passa a ter etiqueta com um serviço escolhido; uma expedição já expedida não se corrige", async () => {
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(s, s.metodoManual, 1);
    expect(
      await codigo(s.adm("POST", `/shipments/${a.expedicao}/label`)),
    ).toEqual([400, "shipping.invalid_field"]);
    await ok(
      s.adm("PUT", `/shipments/${a.expedicao}/service`, {
        versao: await versaoDe(a.expedicao),
        conta: s.conta,
        servico: "EXPRESSO_48",
        motivo: "enviar pelos CTT em vez de entregar",
      }),
    );
    await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    expect(ultimoPedido()?.servico).toBe("EXPRESSO_48");

    const b = await expedicaoPaga(s, s.metodoManual, 1);
    await ok(
      s.adm("PATCH", `/shipments/${b.expedicao}`, {
        versao: await versaoDe(b.expedicao),
        estado: "expedida",
      }),
    );
    expect(
      await codigo(
        s.adm("PUT", `/shipments/${b.expedicao}/weight`, {
          versao: await versaoDe(b.expedicao),
          peso_g: 100,
          motivo: "depois de sair",
        }),
      ),
    ).toEqual([409, "shipping.invalid_transition"]);
  });

  it("pelo Hub: o armazém corrige o peso mas não muda o serviço; o gestor muda; uma IA declarada não", async () => {
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    const versao = async () =>
      Number(
        (
          await okHub(
            como("armazem", "GET", `/hub/shipments/${a.expedicao}/label`),
          )
        )["versao"],
      );
    await okHub(
      como("armazem", "PUT", `/hub/shipments/${a.expedicao}/weight`, {
        versao: await versao(),
        peso_g: 500,
        motivo: "pesada na balança",
      }),
    );
    const servicos = await okHub(
      como("armazem", "GET", `/hub/shipments/${a.expedicao}/services`),
    );
    expect(servicos["peso_corrigido_g"]).toBe(500);
    const corpo = async () => ({
      versao: await versao(),
      conta: s.conta,
      servico: "COM_TELEFONE",
      motivo: "o cliente pediu contacto",
    });
    expect(
      await codigoHub(
        como(
          "armazem",
          "PUT",
          `/hub/shipments/${a.expedicao}/service`,
          await corpo(),
        ),
      ),
    ).toEqual([403, "member.role_escalation"]);
    expect(
      await codigoHub(
        como(
          "gestor",
          "PUT",
          `/hub/shipments/${a.expedicao}/service`,
          await corpo(),
          { "eurolify-ia": "modelo=m" },
        ),
      ),
    ).toEqual([403, "shipping.ai_not_allowed"]);
    await okHub(
      como(
        "gestor",
        "PUT",
        `/hub/shipments/${a.expedicao}/service`,
        await corpo(),
      ),
    );
    const rasto = (
      await okHub(
        como("armazem", "GET", `/hub/shipments/${a.expedicao}/corrections`),
      )
    )["dados"] as Json[];
    expect(rasto.map((r) => r["campo"])).toEqual(["peso", "servico"]);
    expect(String(rasto[0]?.["quem"])).toMatch(/^pessoa:per_/);
  });

  // ------------------------------------------- Revisão do #429 (P1, P2)

  const pedirComChave = (
    segredo: string,
    metodo: "GET" | "PUT" | "POST",
    url: string,
    corpo?: unknown,
    extra: Record<string, string> = {},
  ) =>
    h.app.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${segredo}`,
        ...(metodo === "GET" ? {} : { "idempotency-key": crypto.randomUUID() }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
        ...extra,
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });
  const linhasDoRasto = async (expedicao: string) =>
    (
      await comComerciante(base.dono, s.c, (trx) =>
        trx
          .selectFrom("correcao_expedicao")
          .select("campo")
          .where("expedicao_id", "=", expedicao.replace(/^shp_/, ""))
          .execute(),
      )
    ).length;

  it("uma expedição acabada responde 409, nunca 500 (P1-1)", async () => {
    const a = await expedicaoPaga(s, s.metodoManual, 1);
    await ok(
      s.adm("PATCH", `/shipments/${a.expedicao}`, {
        versao: await versaoDe(a.expedicao),
        estado: "cancelada",
      }),
    );
    for (const [url, corpo] of [
      [
        `/shipments/${a.expedicao}/weight`,
        { peso_g: 100, motivo: "depois de cancelada" },
      ],
      [
        `/shipments/${a.expedicao}/service`,
        {
          conta: s.conta,
          servico: "EXPRESSO_48",
          motivo: "depois de cancelada",
        },
      ],
    ] as const) {
      expect(
        await codigo(
          s.adm("PUT", url, { versao: await versaoDe(a.expedicao), ...corpo }),
        ),
      ).toEqual([409, "shipping.invalid_transition"]);
    }
  });

  it("uma chave de agente de IA, ou uma chave com a IA declarada, não muda o serviço; nada fica no rasto (P1-2)", async () => {
    const gestora = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Gestora",
        ambitos: ["keys:write", "shipping:write", "fulfilment:read"],
      })
    ).segredo;
    const r = await pedirComChave(gestora, "POST", "/keys", {
      tipo: "servidor",
      nome: "Agente dos envios",
      ambitos: ["shipping:write", "fulfilment:read"],
      agente_ia: true,
    });
    expect(r.statusCode, r.body).toBe(201);
    const agente = String(r.json<Json>()["segredo"]);
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    const corpo = async () => ({
      versao: await versaoDe(a.expedicao),
      conta: s.conta,
      servico: "COM_TELEFONE",
      motivo: "a IA acha melhor",
    });
    const recusa = async (x: ReturnType<typeof pedirComChave>) => {
      const y = await x;
      return [y.statusCode, y.json<Json>()["codigo"]];
    };
    expect(
      await recusa(
        pedirComChave(
          agente,
          "PUT",
          `/shipments/${a.expedicao}/service`,
          await corpo(),
        ),
      ),
    ).toEqual([403, "shipping.ai_not_allowed"]);
    expect(
      await recusa(
        pedirComChave(
          gestora,
          "PUT",
          `/shipments/${a.expedicao}/service`,
          await corpo(),
          { "eurolify-ia": "modelo=m" },
        ),
      ),
    ).toEqual([403, "shipping.ai_not_allowed"]);
    expect(await linhasDoRasto(a.expedicao)).toBe(0);
  });

  it("recusas do §19.4: conta não pronta, peso acima do máximo, perigoso, etiqueta viva, sem motivo na base; o rasto de outro comerciante não se lê", async () => {
    ctt.estado.pedir = "emitir";
    // Uma conta por testar (rascunho) não serve.
    const rascunho = String(
      (
        await ok(
          s.adm("POST", "/carrier-accounts", {
            transportadora: "ctt",
            nome: "CTT por testar",
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
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    const mudar = async (conta: string, servico: string) =>
      codigo(
        s.adm("PUT", `/shipments/${a.expedicao}/service`, {
          versao: await versaoDe(a.expedicao),
          conta,
          servico,
          motivo: "experimentar",
        }),
      );
    expect(await mudar(rascunho, "EXPRESSO_48")).toEqual([
      422,
      "shipping.account_not_ready",
    ]);
    // 20 kg não cabem no COM_TELEFONE (máximo 10 kg).
    await ok(
      s.adm("PUT", `/shipments/${a.expedicao}/weight`, {
        versao: await versaoDe(a.expedicao),
        peso_g: 20_000,
        motivo: "caixa pesada",
      }),
    );
    expect(await mudar(s.conta, "COM_TELEFONE")).toEqual([
      400,
      "shipping.invalid_field",
    ]);
    // Com o COM_TELEFONE escolhido, um peso acima dele recusa-se já (P3-3).
    await ok(
      s.adm("PUT", `/shipments/${a.expedicao}/weight`, {
        versao: await versaoDe(a.expedicao),
        peso_g: 500,
        motivo: "afinal é leve",
      }),
    );
    await ok(
      s.adm("PUT", `/shipments/${a.expedicao}/service`, {
        versao: await versaoDe(a.expedicao),
        conta: s.conta,
        servico: "COM_TELEFONE",
        motivo: "o cliente pediu contacto",
      }),
    );
    expect(
      await codigo(
        s.adm("PUT", `/shipments/${a.expedicao}/weight`, {
          versao: await versaoDe(a.expedicao),
          peso_g: 20_000,
          motivo: "caixa pesada outra vez",
        }),
      ),
    ).toEqual([400, "shipping.invalid_field"]);
    const servicos = await ok(
      s.adm("GET", `/shipments/${a.expedicao}/services`),
    );
    expect(servicos["escolhido_nao_serve"]).toBeNull();
    // Com a etiqueta emitida, também não se muda o serviço.
    await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    expect(await mudar(s.conta, "EXPRESSO_48")).toEqual([
      409,
      "shipping.label_exists",
    ]);
    // A base recusa uma correcção sem motivo, mesmo por fora da API.
    const b = await expedicaoPaga(s, s.metodoCtt, 1);
    await expect(
      comComerciante(base.api, s.c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await trx
          .updateTable("expedicao")
          .set({ peso_corrigido_g: 10 })
          .where("id", "=", b.expedicao.replace(/^shp_/, ""))
          .execute();
      }),
    ).rejects.toThrow(/shipping.invalid_field/);
    // O rasto de um comerciante não se lê noutro.
    const doOutro = await comComerciante(base.api, outro.c, (trx) =>
      trx.selectFrom("correcao_expedicao").select("id").execute(),
    );
    expect(doOutro).toEqual([]);
  });

  it("uma variante sem peso: sem correcção a etiqueta não sai; com o peso corrigido, sai", async () => {
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    // O catálogo não deixa apagar o peso de uma variante à venda: o caso
    // (uma variante antiga, ou uma folha de kit sem peso) simula-se sem os
    // gatilhos, só neste teste.
    const semGatilhos = (peso: number | null) =>
      comComerciante(base.dono, s.c, async (trx) => {
        await sql`set local session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("variante")
          .set({ peso_g: peso })
          .where("id", "=", s.v1.replace(/^var_/, ""))
          .execute();
      });
    await semGatilhos(null);
    try {
      expect(
        await ok(s.adm("GET", `/shipments/${a.expedicao}/services`)),
      ).toMatchObject({ peso_calculado_g: null });
      expect(
        await codigo(s.adm("POST", `/shipments/${a.expedicao}/label`)),
      ).toEqual([400, "shipping.invalid_field"]);
      await ok(
        s.adm("PUT", `/shipments/${a.expedicao}/weight`, {
          versao: await versaoDe(a.expedicao),
          peso_g: 80,
          motivo: "pesada na balança",
        }),
      );
      await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
      expect(ultimoPedido()?.pesoG).toBe(80);
    } finally {
      await semGatilhos(30);
    }
  });
});

describe("porQueNaoServeACaixa (docs/36 §19)", () => {
  const servico = {
    codigo: "X",
    nome: { pt: "X" },
    paises: ["PT"],
    pesoMaxG: 1000,
    pedeTelefone: true,
    pedeEmail: false,
    aceitaOnu: ["UN1266"],
  };
  const caixa = {
    pais: "PT",
    ponto: false,
    temTelefone: true,
    pesoG: 500,
    onu: new Set<string>(),
  };
  it("o país, o peso, os perigosos e o telefone", () => {
    expect(porQueNaoServeACaixa(servico, caixa)).toBeNull();
    expect(porQueNaoServeACaixa(servico, { ...caixa, pais: "ES" })).toMatch(
      /país/,
    );
    expect(porQueNaoServeACaixa(servico, { ...caixa, pesoG: 1001 })).toMatch(
      /pesa/,
    );
    expect(
      porQueNaoServeACaixa(servico, { ...caixa, onu: new Set(["UN1993"]) }),
    ).toMatch(/perigosa/);
    expect(
      porQueNaoServeACaixa(servico, { ...caixa, onu: new Set(["UN1266"]) }),
    ).toBeNull();
    expect(
      porQueNaoServeACaixa(servico, { ...caixa, temTelefone: false }),
    ).toMatch(/telefone/);
    // A entrega vendida não muda com o serviço (docs/36 §21).
    expect(porQueNaoServeACaixa(servico, { ...caixa, ponto: true })).toMatch(
      /pontos de recolha/,
    );
    expect(porQueNaoServeACaixa({ ...servico, ponto: true }, caixa)).toMatch(
      /pontos de recolha/,
    );
    // Sem peso calculado, o máximo não se confere aqui (a etiqueta pede-o).
    expect(porQueNaoServeACaixa(servico, { ...caixa, pesoG: null })).toBeNull();
  });
});
