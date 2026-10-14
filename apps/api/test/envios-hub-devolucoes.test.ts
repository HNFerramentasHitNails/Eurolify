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

// As devoluções e a etiqueta de devolução pelo Hub (docs/36 §22.10): a
// lista sem o motivo do cliente e com o limite à vista; a devolução com as
// linhas; só os serviços que servem; pedir, o ficheiro sem cache, uma viva,
// anular com a confirmação do painel; quem escreve fica `pessoa:per_…`;
// outro comerciante não chega.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("Hub: as devoluções", () => {
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
    for (const papel of ["armazem", "apoio"]) {
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
  const { ok, expedicaoPaga } = apoio;
  const como = (
    papel: string,
    metodo: "GET" | "POST",
    url: string,
    corpo?: unknown,
  ) =>
    h.pedir(metodo, url, {
      sessao: p[papel]?.sessao ?? "",
      comerciante: papel === "donoB" ? outro : s.c,
      ...(corpo === undefined ? {} : { corpo }),
    });
  const codigo = async (
    r: Promise<{ statusCode: number; body: string }>,
  ): Promise<[number, unknown]> => {
    const x = await r;
    return [x.statusCode, (JSON.parse(x.body) as Json)["codigo"]];
  };

  /** Uma devolução à espera de uma encomenda já expedida. */
  async function devolucao() {
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(s, s.metodoCtt, 1);
    const e = await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    ctt.estado.eventos.set(String(e["seguimento"]), [
      {
        idExterno: "r-1",
        estadoTransportadora: "ACEITE",
        estadoNormalizado: "recolhida",
        em: new Date("2026-11-14T09:00:00Z"),
      },
    ]);
    await ok(s.adm("POST", `/shipments/${a.expedicao}/refresh`));
    const v = await ok(s.adm("GET", `/fulfilment/orders/${a.encomenda}`));
    const linha = (v["linhas"] as Json[])[0] as Json;
    const r = await ok(
      s.adm("POST", "/returns", {
        encomenda: a.encomenda,
        origem: "apoio",
        motivo: "O Rui diz que a cor não é a da fotografia",
        linhas: [{ linha: linha["id"], quantidade: 1 }],
      }),
      201,
    );
    return String(r["id"]);
  }

  it("o armazém vê a lista sem o motivo, abre a devolução, vê só os serviços que servem, pede a etiqueta, descarrega-a e anula-a com a confirmação do painel", async () => {
    const rma = await devolucao();

    const lista = await ok(como("armazem", "GET", "/hub/returns"));
    expect(lista["limite"]).toBe(200);
    const linhaDaLista = (lista["dados"] as Json[]).find(
      (x) => x["id"] === rma,
    );
    expect(linhaDaLista).toMatchObject({
      estado: "a_aguardar",
      origem: "apoio",
    });
    // O motivo do cliente fica fora da lista (§22.10).
    expect(JSON.stringify(lista)).not.toContain("fotografia");
    const fechadas = await ok(
      como("armazem", "GET", "/hub/returns?estado=fechada"),
    );
    expect((fechadas["dados"] as Json[]).some((x) => x["id"] === rma)).toBe(
      false,
    );

    const d = await ok(como("armazem", "GET", `/hub/returns/${rma}`));
    expect(d).toMatchObject({
      id: rma,
      estado: "a_aguardar",
      motivo: "O Rui diz que a cor não é a da fotografia",
    });
    const linhas = d["linhas"] as Json[];
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ pedida: 1, recebida: null });
    expect(typeof linhas[0]?.["nome"]).toBe("string");
    expect(typeof linhas[0]?.["sku"]).toBe("string");

    // Ainda sem etiqueta.
    expect(
      await codigo(como("armazem", "GET", `/hub/returns/${rma}/label`)),
    ).toEqual([404, "shipping.not_found"]);

    // Só o serviço de morada para PT, sem telefone: nem o de pontos, nem o
    // que pede o telefone, nem o de Espanha.
    const servicos = await ok(
      como("armazem", "GET", `/hub/returns/${rma}/label/services`),
    );
    expect(servicos["estado"]).toBe("a_aguardar");
    expect(typeof servicos["peso_g"]).toBe("number");
    expect(
      (servicos["opcoes"] as Json[]).map((o) => [o["conta"], o["servico"]]),
    ).toEqual([[s.conta, "EXPRESSO_48"]]);

    const e = await ok(
      como("armazem", "POST", `/hub/returns/${rma}/label`, {
        conta: s.conta,
        servico: "EXPRESSO_48",
      }),
    );
    expect(e).toMatchObject({ estado: "emitida", ficheiro: "pdf" });
    // Uma viva: a segunda é recusada.
    expect(
      await codigo(
        como("armazem", "POST", `/hub/returns/${rma}/label`, {
          conta: s.conta,
          servico: "EXPRESSO_48",
        }),
      ),
    ).toEqual([409, "shipping.label_exists"]);

    const f = await como("armazem", "GET", `/hub/returns/${rma}/label/file`);
    expect(f.statusCode).toBe(200);
    expect(f.headers["content-type"]).toBe("application/pdf");
    expect(f.headers["cache-control"]).toBe("private, no-store");

    // A devolução fica com a transportadora e o seguimento da etiqueta.
    const depois = await ok(como("apoio", "GET", `/hub/returns/${rma}`));
    expect(depois["seguimento"]).toBe(e["seguimento"]);

    // Anular pede a confirmação do painel.
    expect(
      await codigo(
        como("armazem", "POST", `/hub/returns/${rma}/label/void`, {
          motivo: "o cliente vai entregar em mão",
        }),
      ),
    ).toEqual([400, "request.invalid"]);
    const anulada = await ok(
      como("armazem", "POST", `/hub/returns/${rma}/label/void`, {
        motivo: "o cliente vai entregar em mão",
        anulada_no_painel: true,
      }),
    );
    expect(anulada).toMatchObject({ estado: "anulada", ficheiro: null });

    // Quem escreveu fica a pessoa.
    const quem = await base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${s.c}, true)`.execute(
        trx,
      );
      return (
        await sql<{
          quem: string;
        }>`select quem from etiqueta_devolucao_historico
          where devolucao_id = ${rma.replace(/^rma_/, "")}::uuid
          order by em, id`.execute(trx)
      ).rows.map((r) => r.quem);
    });
    expect(quem.length).toBeGreaterThanOrEqual(2);
    expect(
      quem.every((q) => q === `pessoa:per_${p["armazem"]?.pessoa ?? ""}`),
    ).toBe(true);
  });

  it("outro comerciante não vê a devolução nem a etiqueta, e não pede nenhuma", async () => {
    const rma = await devolucao();
    const lista = await ok(como("donoB", "GET", "/hub/returns"));
    expect((lista["dados"] as Json[]).some((x) => x["id"] === rma)).toBe(false);
    expect(await codigo(como("donoB", "GET", `/hub/returns/${rma}`))).toEqual([
      404,
      "returns.not_found",
    ]);
    expect(
      await codigo(como("donoB", "GET", `/hub/returns/${rma}/label/services`)),
    ).toEqual([404, "shipping.not_found"]);
    const [estado] = await codigo(
      como("donoB", "POST", `/hub/returns/${rma}/label`, {
        conta: s.conta,
        servico: "EXPRESSO_48",
      }),
    );
    expect(estado).toBe(404);
    expect(
      (await como("donoB", "GET", `/hub/returns/${rma}/label/file`)).statusCode,
    ).toBe(404);
    // Com a etiqueta pedida pelo dono, o outro não a lê nem a anula.
    await ok(
      como("armazem", "POST", `/hub/returns/${rma}/label`, {
        conta: s.conta,
        servico: "EXPRESSO_48",
      }),
    );
    expect(
      (await como("donoB", "GET", `/hub/returns/${rma}/label`)).statusCode,
    ).toBe(404);
    expect(
      (
        await como("donoB", "POST", `/hub/returns/${rma}/label/void`, {
          motivo: "não é minha",
          anulada_no_painel: true,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await ok(como("armazem", "GET", `/hub/returns/${rma}/label`)))["estado"],
    ).toBe("emitida");
  });

  it("um estado que não existe no filtro é recusado", async () => {
    expect(
      await codigo(como("armazem", "GET", "/hub/returns?estado=perdida")),
    ).toEqual([400, "request.invalid"]);
  });

  it("sem sessão, nada", async () => {
    const r = await h.pedir("GET", "/hub/returns", { comerciante: s.c });
    expect(r.statusCode).toBe(401);
  });
});
