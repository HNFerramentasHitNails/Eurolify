import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aplicarEventos } from "../src/envios/etiquetas.js";
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

// Vários volumes numa expedição (docs/36 §23; migração 0101): o peso de
// cada caixa, com motivo, só antes da etiqueta e só num serviço que leve
// tantos volumes; uma etiqueta e um seguimento por volume; a expedição só
// fica entregue com todos os volumes entregues (L13); um volume perdido
// abre um problema e não a acaba; menos etiquetas do que volumes fica
// incerta.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("Envios: vários volumes", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  const eupago = eupagoFalso();
  const ctt = transportadoraFalsa();
  let s: Cenario;
  let outro: Cenario;

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
    // Quem expede recebe o aviso de «tentativa falhada» (docs/36 §20).
    await h.pessoaCom(s.c, "armazem");
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
  const versaoDe = async (expedicao: string, c: Cenario = s) =>
    Number((await ok(c.adm("GET", `/shipments/${expedicao}/label`)))["versao"]);
  const servico = async (expedicao: string, codigoServico: string) =>
    ok(
      s.adm("PUT", `/shipments/${expedicao}/service`, {
        versao: await versaoDe(expedicao),
        conta: s.conta,
        servico: codigoServico,
        motivo: "várias caixas",
      }),
    );
  const volumes = async (
    expedicao: string,
    volumesG: number[] | null,
    c: Cenario = s,
  ) =>
    c.adm("PUT", `/shipments/${expedicao}/volumes`, {
      versao: await versaoDe(expedicao, c),
      volumes_g: volumesG,
      motivo: "não cabe numa caixa",
    });
  const evento = (
    id: string,
    normalizado: "em_transito" | "entregue" | "perdida",
    em: string,
  ) => ({
    idExterno: id,
    estadoTransportadora: normalizado.toUpperCase(),
    estadoNormalizado: normalizado,
    em: new Date(em),
  });
  const problemas = async (encomenda: string) =>
    base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${s.c}, true)`.execute(
        trx,
      );
      return (
        await sql<{ descricao: string }>`select descricao from problema
          where encomenda_id = ${encomenda.replace(/^ord_/, "")}::uuid`.execute(
          trx,
        )
      ).rows.map((r) => r.descricao);
    });

  /** Uma expedição com 2 volumes no MULTI_48 e a etiqueta emitida. */
  async function comDoisVolumes() {
    ctt.estado.pedir = "emitir";
    ctt.estado.volumesDevolvidos = null;
    const a = await expedicaoPaga(s, s.metodoCtt, 2);
    await servico(a.expedicao, "MULTI_48");
    await ok(volumes(a.expedicao, [1200, 2800]));
    const e = await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    return { ...a, e };
  }

  it("os volumes só num serviço que os leve, até ao máximo dele, e cada um até ao peso máximo; com motivo no rasto", async () => {
    const a = await expedicaoPaga(s, s.metodoCtt, 2);
    // O vendido (EXPRESSO_48) é de uma caixa.
    expect(await codigo(volumes(a.expedicao, [1200, 2800]))).toEqual([
      400,
      "shipping.invalid_field",
    ]);
    await servico(a.expedicao, "MULTI_48");
    // O MULTI_48 leva 3, e cada caixa até 5 kg.
    expect(
      await codigo(volumes(a.expedicao, [1000, 1000, 1000, 1000])),
    ).toEqual([400, "shipping.invalid_field"]);
    expect(await codigo(volumes(a.expedicao, [1000, 6000]))).toEqual([
      400,
      "shipping.invalid_field",
    ]);
    // Uma caixa só não é «volumes» (o pedido recusa).
    expect((await volumes(a.expedicao, [1000])).statusCode).toBe(400);
    await ok(volumes(a.expedicao, [1200, 2800]));
    // Com volumes, o peso corrige-se neles.
    expect(
      await codigo(
        s.adm("PUT", `/shipments/${a.expedicao}/weight`, {
          versao: await versaoDe(a.expedicao),
          peso_g: 4000,
          motivo: "balança",
        }),
      ),
    ).toEqual([400, "shipping.invalid_field"]);
    const correcoes = (
      await ok(s.adm("GET", `/shipments/${a.expedicao}/corrections`))
    )["dados"] as Json[];
    expect(correcoes.at(-1)).toMatchObject({
      campo: "volumes",
      antes: null,
      depois: [1200, 2800],
      motivo: "não cabe numa caixa",
    });
    // A lista dos serviços diz quantos volumes cada um leva.
    const servicos = await ok(
      s.adm("GET", `/shipments/${a.expedicao}/services`),
    );
    expect(servicos["volumes_g"]).toEqual([1200, 2800]);
    expect(
      (servicos["opcoes"] as Json[]).map((o) => [
        o["servico"],
        o["max_volumes"],
      ]),
    ).toEqual([["MULTI_48", 3]]);
  });

  it("uma etiqueta e um seguimento por volume; o pedido leva o peso de cada caixa; os volumes não mudam com a etiqueta viva; anular leva-os todos", async () => {
    const { expedicao, e } = await comDoisVolumes();
    expect(ctt.estado.pedidos.at(-1)).toMatchObject({
      servico: "MULTI_48",
      pesoG: 4000,
      volumesG: [1200, 2800],
    });
    expect(e).toMatchObject({ etiqueta: "emitida", volumes_g: [1200, 2800] });
    const vs = e["volumes"] as Json[];
    expect(vs.map((v) => [v["volume"], v["peso_g"], v["ficheiro"]])).toEqual([
      [1, 1200, "pdf"],
      [2, 2800, "pdf"],
    ]);
    expect(vs[0]?.["seguimento"]).toBe(e["seguimento"]);
    expect(vs[1]?.["seguimento"]).not.toBe(e["seguimento"]);
    // O PDF de cada volume.
    const f2 = await s.adm(
      "GET",
      `/shipments/${expedicao}/label/file?volume=2`,
    );
    expect(f2.statusCode, f2.body).toBe(200);
    expect(f2.body).toContain("volume 2");
    expect(
      (await s.adm("GET", `/shipments/${expedicao}/label/file?volume=3`))
        .statusCode,
    ).toBe(404);
    // Com a etiqueta viva, os volumes não mudam.
    expect(await codigo(volumes(expedicao, [2000, 2000]))).toEqual([
      409,
      "shipping.label_exists",
    ]);
    // Anular leva os volumes todos.
    await ok(s.adm("POST", `/shipments/${expedicao}/label/void`));
    const depois = await ok(s.adm("GET", `/shipments/${expedicao}/label`));
    expect(
      (depois["volumes"] as Json[]).map((v) => [
        v["seguimento"],
        v["ficheiro"],
      ]),
    ).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("só fica entregue com todos os volumes entregues (L13); um volume perdido abre um problema e não acaba a expedição", async () => {
    const { expedicao, encomenda, e } = await comDoisVolumes();
    const [v1, v2] = (e["volumes"] as Json[]).map((v) =>
      String(v["seguimento"]),
    );
    ctt.estado.eventos.set(v1 ?? "", [
      evento("a1", "em_transito", "2026-11-14T09:00:00Z"),
      evento("a2", "entregue", "2026-11-15T10:00:00Z"),
    ]);
    ctt.estado.eventos.set(v2 ?? "", [
      evento("a1", "em_transito", "2026-11-14T09:00:00Z"),
    ]);
    await ok(s.adm("POST", `/shipments/${expedicao}/refresh`));
    let x = await ok(s.adm("GET", `/shipments/${expedicao}/label`));
    // Um volume entregue, o outro a caminho: expedida, não entregue.
    expect(x["estado_expedicao"]).toBe("expedida");
    const ev = (await ok(s.adm("GET", `/shipments/${expedicao}/events`)))[
      "dados"
    ] as Json[];
    // O mesmo identificador da transportadora em dois volumes conta duas
    // vezes, cada uma com o seu volume.
    expect(ev.map((v) => v["volume"]).sort()).toEqual([1, 1, 2]);
    ctt.estado.eventos.set(v2 ?? "", [
      evento("a1", "em_transito", "2026-11-14T09:00:00Z"),
      evento("a2", "entregue", "2026-11-16T11:00:00Z"),
    ]);
    await ok(s.adm("POST", `/shipments/${expedicao}/refresh`));
    x = await ok(s.adm("GET", `/shipments/${expedicao}/label`));
    expect(x["estado_expedicao"]).toBe("entregue");

    // Outra: um volume perdido.
    const outra = await comDoisVolumes();
    const [w1, w2] = (outra.e["volumes"] as Json[]).map((v) =>
      String(v["seguimento"]),
    );
    ctt.estado.eventos.set(w1 ?? "", [
      evento("b1", "entregue", "2026-11-15T10:00:00Z"),
    ]);
    ctt.estado.eventos.set(w2 ?? "", [
      evento("b2", "perdida", "2026-11-15T12:00:00Z"),
    ]);
    await ok(s.adm("POST", `/shipments/${outra.expedicao}/refresh`));
    const y = await ok(s.adm("GET", `/shipments/${outra.expedicao}/label`));
    expect(y["estado_expedicao"]).toBe("expedida");
    expect(
      (await problemas(outra.encomenda)).some((p) =>
        p.includes("volume 2 de 2"),
      ),
    ).toBe(true);
    expect(encomenda).not.toBe(outra.encomenda);
  });

  it("menos etiquetas do que volumes fica incerta; a consulta que as traz todas emite-a", async () => {
    ctt.estado.pedir = "emitir";
    ctt.estado.volumesDevolvidos = 1;
    const a = await expedicaoPaga(s, s.metodoCtt, 2);
    await servico(a.expedicao, "MULTI_48");
    await ok(volumes(a.expedicao, [1200, 2800]));
    const e = await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    expect(e).toMatchObject({ etiqueta: "incerta" });
    expect(String(e["motivo"])).toContain("1 etiquetas para 2 volumes");
    // Não se pede outra às cegas.
    expect(
      await codigo(s.adm("POST", `/shipments/${a.expedicao}/label`)),
    ).toEqual([409, "shipping.label_uncertain"]);
    // A transportadora passa a dar as duas.
    ctt.estado.volumesDevolvidos = null;
    const ref = [...ctt.estado.etiquetas.keys()].find((k) =>
      k.startsWith(a.expedicao.replace(/^shp_/, "")),
    );
    expect(ref).toBeDefined();
    const todas = ctt.estado.etiquetas.get(ref ?? "");
    const [p1] = todas?.volumes ?? [];
    ctt.estado.etiquetas.set(ref ?? "", {
      ...(p1 ?? {
        seguimento: "X",
        urlSeguimento: null,
        ficheiro: { formato: "pdf", conteudo: Buffer.from("%PDF-") },
      }),
      volumes: [
        p1 ?? {
          seguimento: "X",
          urlSeguimento: null,
          ficheiro: { formato: "pdf", conteudo: Buffer.from("%PDF-") },
        },
        {
          seguimento: "EA999999999PT",
          urlSeguimento: null,
          ficheiro: {
            formato: "pdf",
            conteudo: Buffer.from("%PDF-falso volume 2"),
          },
        },
      ],
    });
    await ok(s.adm("POST", `/shipments/${a.expedicao}/refresh`));
    const depois = await ok(s.adm("GET", `/shipments/${a.expedicao}/label`));
    expect(depois["etiqueta"]).toBe("emitida");
    expect((depois["volumes"] as Json[])[1]?.["seguimento"]).toBe(
      "EA999999999PT",
    );
  });

  it("isolamento: os volumes e os ficheiros de outro comerciante não se mudam nem se lêem", async () => {
    const { expedicao } = await comDoisVolumes();
    // O dono lê o volume 2; o outro comerciante não.
    expect(
      (await s.adm("GET", `/shipments/${expedicao}/label/file?volume=2`))
        .statusCode,
    ).toBe(200);
    expect(
      (await outro.adm("GET", `/shipments/${expedicao}/label/file?volume=2`))
        .statusCode,
    ).toBe(404);
    const a = await expedicaoPaga(s, s.metodoCtt, 2);
    expect(
      await codigo(
        outro.adm("PUT", `/shipments/${a.expedicao}/volumes`, {
          versao: await versaoDe(a.expedicao),
          volumes_g: [1000, 1000],
          motivo: "não é meu",
        }),
      ),
    ).toEqual([404, "shipping.not_found"]);
  });

  it("dois seguimentos ao mesmo tempo, um por volume, acabam entregue; um evento sem volume numa expedição com volumes é recusado (#453, P1-1 e P2-1)", async () => {
    const { expedicao } = await comDoisVolumes();
    const id = expedicao.replace(/^shp_/, "");
    const entregue = (n: string) => [
      evento(n, "entregue", "2026-11-15T10:00:00Z"),
    ];
    await Promise.all([
      aplicarEventos(base.api, s.c, id, entregue("c1"), "consulta", "teste", 1),
      aplicarEventos(base.api, s.c, id, entregue("c2"), "consulta", "teste", 2),
    ]);
    const x = await ok(s.adm("GET", `/shipments/${expedicao}/label`));
    expect(x["estado_expedicao"]).toBe("entregue");
    // Sem volume: recusado, nada se grava.
    const outra = await comDoisVolumes();
    await expect(
      aplicarEventos(
        base.api,
        s.c,
        outra.expedicao.replace(/^shp_/, ""),
        entregue("c3"),
        "aviso",
        "teste",
      ),
    ).rejects.toMatchObject({ codigo: "shipping.invalid_field" });
    const y = await ok(s.adm("GET", `/shipments/${outra.expedicao}/label`));
    expect(y["estado_expedicao"]).toBe("criada");
  });

  it("o aviso de «tentativa falhada» é por volume: o volume 2 parado avisa mesmo com o volume 1 a andar depois (#453, P2-2)", async () => {
    const { expedicao, e } = await comDoisVolumes();
    const id = expedicao.replace(/^shp_/, "");
    await aplicarEventos(
      base.api,
      s.c,
      id,
      [evento("d1", "em_transito", "2026-11-15T12:00:00Z")],
      "consulta",
      "teste",
      1,
    );
    await aplicarEventos(
      base.api,
      s.c,
      id,
      [
        {
          idExterno: "d2",
          estadoTransportadora: "AUSENTE",
          estadoNormalizado: "tentativa_falhada",
          em: new Date("2026-11-15T10:00:00Z"),
        },
      ],
      "consulta",
      "teste",
      2,
    );
    const avisos = await base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${s.c}, true)`.execute(
        trx,
      );
      return (
        await sql<{ dados: Json }>`select dados from notificacao
          where tipo = 'shipment.needs_attention'
            and dados->>'expedicao' = ${id}`.execute(trx)
      ).rows.map((r) => r.dados);
    });
    expect(avisos.length).toBeGreaterThan(0);
    expect(avisos[0]).toMatchObject({
      volume: 2,
      seguimento: (e["volumes"] as Json[])[1]?.["seguimento"],
    });
  });
});
