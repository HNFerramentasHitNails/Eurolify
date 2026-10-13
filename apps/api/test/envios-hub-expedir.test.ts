import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

// O ecrã «Expedir» pelo Hub (docs/22 §33): a vista do armazém sem preços,
// NIF nem e-mail; a expedição criada pela pessoa; a etiqueta, o ficheiro,
// anular e consultar; o seguimento; marcar como expedida. O dono, o gestor e
// o armazém escrevem; o apoio só vê; outro comerciante não chega. Quem
// escreve fica `pessoa:per_…`.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("Hub: expedir", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  const eupago = eupagoFalso();
  const ctt = transportadoraFalsa();
  let s: Cenario;
  const p: Record<string, { pessoa: string; sessao: string }> = {};
  let outro = "";

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
    for (const papel of ["dono", "armazem", "apoio"]) {
      const x = await h.pessoaCom(s.c, papel);
      p[papel] = { pessoa: x.pessoa, sessao: x.sessao };
    }
    const b = await apoio.cenario();
    outro = b.c;
    const x = await h.pessoaCom(outro, "dono");
    p["donoB"] = { pessoa: x.pessoa, sessao: x.sessao };
  }, 180_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  const apoio = cenariosDeEnvios(
    () => h.app,
    () => base,
  );
  const como = (
    papel: string,
    metodo: "GET" | "POST" | "PATCH",
    url: string,
    corpo?: unknown,
  ) =>
    h.pedir(metodo, url, {
      sessao: p[papel]?.sessao ?? "",
      comerciante: papel === "donoB" ? outro : s.c,
      ...(corpo === undefined ? {} : { corpo }),
    });
  const ok = async (
    r: Promise<{ statusCode: number; body: string }>,
    estado = 200,
  ) => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(estado);
    return x.body === "" ? {} : (JSON.parse(x.body) as Json);
  };
  const codigo = async (
    r: Promise<{ statusCode: number; body: string }>,
  ): Promise<[number, unknown]> => {
    const x = await r;
    return [x.statusCode, (JSON.parse(x.body) as Json)["codigo"]];
  };

  it("o armazém vê a encomenda paga sem preços, NIF nem e-mail, cria a expedição, pede a etiqueta, descarrega-a e marca como expedida", async () => {
    ctt.estado.pedir = "emitir";
    ctt.estado.consultar = "responde";
    const { encomenda } = await apoio.expedicaoPaga(s, s.metodoCtt, 2, false);
    const lista = (await ok(como("armazem", "GET", "/hub/fulfilment/orders")))[
      "dados"
    ] as Json[];
    const e = lista.find((x) => x["id"] === encomenda);
    expect(Object.keys(e ?? {}).sort()).toEqual(
      [
        "id",
        "estado",
        "criada_em",
        "metodo_entrega",
        "entrega",
        "destinatario",
        "linhas",
      ].sort(),
    );
    expect(JSON.stringify(lista)).not.toContain("rui@exemplo.pt");
    const vista = await ok(
      como("armazem", "GET", `/hub/fulfilment/orders/${encomenda}`),
    );
    expect(vista["expedicoes"]).toEqual([]);
    // As chaves exactas: quem recebe e as linhas, sem preços (revisão do
    // #418, P2-6).
    expect(Object.keys(vista).sort()).toEqual(
      [
        "id",
        "estado",
        "criada_em",
        "metodo_entrega",
        "entrega",
        "destinatario",
        "linhas",
        "expedicoes",
      ].sort(),
    );
    expect(Object.keys(vista["destinatario"] as Json).sort()).toEqual([
      "nome",
      "telefone",
    ]);
    expect(Object.keys((vista["linhas"] as Json[])[0] ?? {}).sort()).toEqual(
      [
        "id",
        "posicao",
        "variante",
        "sku",
        "nome",
        "quantidade",
        "expedida",
      ].sort(),
    );
    const linha = (vista["linhas"] as Json[])[0] ?? {};
    const { id: expedicao } = (await ok(
      como("armazem", "POST", `/hub/orders/${encomenda}/shipments`, {
        linhas: [{ linha: linha["id"], quantidade: 2 }],
      }),
      201,
    )) as { id: string };
    // Repetir com tudo o que já saiu é recusado. Uma expedição parcial
    // repetida seria aceite: ver o teste seguinte (revisão do #418, P2-2).
    const repetida = await codigo(
      como("armazem", "POST", `/hub/orders/${encomenda}/shipments`, {
        linhas: [{ linha: linha["id"], quantidade: 2 }],
      }),
    );
    expect(repetida[0]).toBeGreaterThanOrEqual(400);
    expect(repetida[0]).toBeLessThan(500);
    const etiqueta = await ok(
      como("armazem", "POST", `/hub/shipments/${expedicao}/label`, {}),
    );
    expect(etiqueta).toMatchObject({ etiqueta: "emitida", ficheiro: "pdf" });
    expect(
      await ok(como("apoio", "GET", `/hub/shipments/${expedicao}/label`)),
    ).toMatchObject({ etiqueta: "emitida" });
    const ficheiro = await como(
      "apoio",
      "GET",
      `/hub/shipments/${expedicao}/label/file`,
    );
    expect(ficheiro.statusCode).toBe(200);
    expect(ficheiro.headers["cache-control"]).toBe("private, no-store");
    expect(
      (await ok(como("apoio", "GET", `/hub/shipments/${expedicao}/events`)))[
        "dados"
      ],
    ).toEqual([]);
    await ok(
      como("armazem", "POST", `/hub/shipments/${expedicao}/refresh`, {}),
    );
    const depois = await ok(
      como("armazem", "GET", `/hub/fulfilment/orders/${encomenda}`),
    );
    const x = (depois["expedicoes"] as Json[])[0] ?? {};
    await ok(
      como("armazem", "PATCH", `/hub/shipments/${expedicao}`, {
        versao: Number(x["versao"]),
        estado: "expedida",
      }),
    );
    // Quem: a pessoa, na expedição e na saída do stock.
    const { rows } = await sql<{
      criada_por: string;
      quem: string;
    }>`select e.criada_por, m.quem from expedicao e
        join movimento_stock m on m.expedicao_id = e.id and m.tipo = 'saida'
        where e.id = ${expedicao.slice(4)}::uuid`.execute(base.dono);
    expect(rows[0]).toEqual({
      criada_por: `pessoa:per_${p["armazem"]?.pessoa ?? ""}`,
      quem: `pessoa:per_${p["armazem"]?.pessoa ?? ""}`,
    });
    // E na transição da encomenda para expedida.
    const t = await sql<{ quem: string }>`select quem from transicao_encomenda
        where encomenda_id = ${encomenda.slice(4)}::uuid and para = 'expedida'`.execute(
      base.dono,
    );
    expect(t.rows.map((r) => r.quem)).toEqual([
      `pessoa:per_${p["armazem"]?.pessoa ?? ""}`,
    ]);
  });

  it("uma expedição parcial repetida é aceite (o servidor só recusa o que passa do que falta)", async () => {
    const { encomenda } = await apoio.expedicaoPaga(s, s.metodoCtt, 2, false);
    const linha =
      (
        (
          await ok(
            como("armazem", "GET", `/hub/fulfilment/orders/${encomenda}`),
          )
        )["linhas"] as Json[]
      )[0] ?? {};
    const corpo = { linhas: [{ linha: linha["id"], quantidade: 1 }] };
    await ok(
      como("armazem", "POST", `/hub/orders/${encomenda}/shipments`, corpo),
      201,
    );
    await ok(
      como("armazem", "POST", `/hub/orders/${encomenda}/shipments`, corpo),
      201,
    );
    expect(
      await codigo(
        como("armazem", "POST", `/hub/orders/${encomenda}/shipments`, corpo),
      ),
    ).toEqual([422, "shipments.quantity_exceeded"]);
  });

  it("anular a etiqueta e cancelar a expedição; num método manual, a transportadora e o seguimento à mão", async () => {
    ctt.estado.pedir = "emitir";
    ctt.estado.anular = "anulada";
    const a = await apoio.expedicaoPaga(s, s.metodoCtt, 1, false);
    const linha =
      (
        (
          await ok(como("dono", "GET", `/hub/fulfilment/orders/${a.encomenda}`))
        )["linhas"] as Json[]
      )[0] ?? {};
    const { id } = (await ok(
      como("dono", "POST", `/hub/orders/${a.encomenda}/shipments`, {
        linhas: [{ linha: linha["id"], quantidade: 1 }],
      }),
      201,
    )) as { id: string };
    await ok(como("dono", "POST", `/hub/shipments/${id}/label`, {}));
    // Com a etiqueta emitida não se cancela: anula-se primeiro (P1-2).
    const antes = await ok(
      como("dono", "GET", `/hub/fulfilment/orders/${a.encomenda}`),
    );
    expect(
      await codigo(
        como("dono", "PATCH", `/hub/shipments/${id}`, {
          versao: Number(((antes["expedicoes"] as Json[])[0] ?? {})["versao"]),
          estado: "cancelada",
        }),
      ),
    ).toEqual([409, "shipments.invalid_transition"]);
    expect(
      await ok(como("dono", "POST", `/hub/shipments/${id}/label/void`, {})),
    ).toMatchObject({ etiqueta: "anulada" });
    const vista = await ok(
      como("dono", "GET", `/hub/fulfilment/orders/${a.encomenda}`),
    );
    const x = (vista["expedicoes"] as Json[])[0] ?? {};
    await ok(
      como("dono", "PATCH", `/hub/shipments/${id}`, {
        versao: Number(x["versao"]),
        estado: "cancelada",
      }),
    );
    // Manual: a transportadora e o seguimento escritos à mão, e entregue.
    const m = await apoio.expedicaoPaga(s, s.metodoManual, 1);
    const lida = await ok(
      como("armazem", "GET", `/hub/fulfilment/orders/${m.encomenda}`),
    );
    let versao = Number(((lida["expedicoes"] as Json[])[0] ?? {})["versao"]);
    versao = Number(
      (
        await ok(
          como("armazem", "PATCH", `/hub/shipments/${m.expedicao}`, {
            versao,
            transportadora: "Estafeta da loja",
            seguimento: "LJ-001",
            estado: "expedida",
          }),
        )
      )["versao"],
    );
    await ok(
      como("armazem", "PATCH", `/hub/shipments/${m.expedicao}`, {
        versao,
        estado: "entregue",
      }),
    );
  });

  it("o apoio só vê; outro comerciante não chega; sem cache, também na recusa", async () => {
    const lista = (await ok(como("apoio", "GET", "/hub/fulfilment/orders")))[
      "dados"
    ] as Json[];
    const encomenda = String(lista[0]?.["id"]);
    const recusa = await como(
      "apoio",
      "POST",
      `/hub/orders/${encomenda}/shipments`,
      {
        linhas: [
          { linha: "oli_00000000-0000-7000-8000-000000000000", quantidade: 1 },
        ],
      },
    );
    expect(recusa.statusCode).toBe(403);
    expect(recusa.headers["cache-control"]).toBe("private, no-store");
    const qualquer = "shp_00000000-0000-7000-8000-000000000000";
    for (const [metodo, url] of [
      ["POST", `/hub/shipments/${qualquer}/label`],
      ["POST", `/hub/shipments/${qualquer}/label/void`],
      ["POST", `/hub/shipments/${qualquer}/refresh`],
      ["PATCH", `/hub/shipments/${qualquer}`],
    ] as const) {
      expect(
        await codigo(
          como("apoio", metodo, url, metodo === "PATCH" ? { versao: 1 } : {}),
        ),
      ).toEqual([403, "member.role_escalation"]);
    }
    // O dono de outro comerciante: nem a encomenda nem as expedições.
    expect(
      (
        (await ok(como("donoB", "GET", "/hub/fulfilment/orders")))[
          "dados"
        ] as Json[]
      ).some((x) => x["id"] === encomenda),
    ).toBe(false);
    expect(
      (
        await codigo(
          como("donoB", "GET", `/hub/fulfilment/orders/${encomenda}`),
        )
      )[0],
    ).toBe(404);
    const daOutra = (
      (await ok(como("dono", "GET", `/hub/fulfilment/orders/${encomenda}`)))[
        "expedicoes"
      ] as Json[]
    )[0];
    expect(daOutra).toBeDefined();
    {
      const id = String(daOutra?.["id"]);
      for (const [metodo, url] of [
        ["POST", `/hub/shipments/${id}/label`],
        ["POST", `/hub/shipments/${id}/label/void`],
        ["POST", `/hub/shipments/${id}/refresh`],
        ["GET", `/hub/shipments/${id}/events`],
      ] as const) {
        const r = await como(
          "donoB",
          metodo,
          url,
          metodo === "GET" ? undefined : {},
        );
        expect(r.statusCode, url).toBe(404);
        expect(r.headers["cache-control"], url).toBe("private, no-store");
      }
      const linhaDaOutra = String(
        ((
          (
            await ok(como("dono", "GET", `/hub/fulfilment/orders/${encomenda}`))
          )["linhas"] as Json[]
        )[0] ?? {})["id"],
      );
      expect(
        (
          await codigo(
            como("donoB", "POST", `/hub/orders/${encomenda}/shipments`, {
              linhas: [{ linha: linhaDaOutra, quantidade: 1 }],
            }),
          )
        )[0],
      ).toBe(404);
      expect(
        (await codigo(como("donoB", "GET", `/hub/shipments/${id}/label`)))[0],
      ).toBe(404);
      expect(
        (
          await codigo(como("donoB", "GET", `/hub/shipments/${id}/label/file`))
        )[0],
      ).toBe(404);
      expect(
        (
          await codigo(
            como("donoB", "PATCH", `/hub/shipments/${id}`, {
              versao: 1,
              estado: "cancelada",
            }),
          )
        )[0],
      ).toBe(404);
    }
  });
});
