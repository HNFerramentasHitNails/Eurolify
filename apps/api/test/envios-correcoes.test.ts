import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comComerciante } from "../src/comerciante/repositorio.js";
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
});
