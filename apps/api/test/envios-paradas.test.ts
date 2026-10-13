import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { comComerciante } from "../src/comerciante/repositorio.js";
import { avisarEncomendasParadas } from "../src/envios/paradas.js";
import { cancelarEncomendaPaga } from "../src/posvenda/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import { eupagoFalso } from "./eupago-falso.js";
import { transportadoraFalsa } from "./transportadora-falsa.js";
import { cenariosDeEnvios } from "./envios-cenario.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A encomenda parada perto da data-limite (docs/36 §18; migração 0085): a 5
// dias ou menos da data-limite que o cliente viu, com unidades que ainda não
// saíram, abre um problema da pós-venda, uma vez só; o dia é o da loja.

type Json = Record<string, unknown>;
const DIA = 24 * 60 * 60 * 1000;

describe.skipIf(URL_BASE === undefined)("Envios: encomendas paradas", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  const eupago = eupagoFalso();
  const ctt = transportadoraFalsa();
  const envios = {
    chave: chavePagamentos(randomBytes(32).toString("base64")),
    adaptadores: { ctt: ctt.adaptador },
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

  const { ok, cenario, expedicaoPaga } = cenariosDeEnvios(
    () => app,
    () => base,
  );

  /** O identificador sem o prefixo da API (`ord_…`), como está na base. */
  const id = (x: string) => x.replace(/^[a-z]+_/, "");

  /** A data-limite copiada na encomenda (a que o cliente viu). */
  async function dataLimiteDe(c: string, encomenda: string) {
    const e = await comComerciante(base.dono, c, (trx) =>
      trx
        .selectFrom("encomenda")
        .select("metodo_entrega")
        .where("id", "=", id(encomenda))
        .executeTakeFirstOrThrow(),
    );
    return String((e.metodo_entrega as Json)["data_limite"]);
  }

  /** Meio-dia UTC de `data` mais `dias`. */
  const meioDia = (data: string, dias: number) =>
    new Date(new Date(`${data}T12:00:00Z`).getTime() + dias * DIA);

  async function problemasDe(c: string, encomenda: string) {
    return comComerciante(base.dono, c, (trx) =>
      trx
        .selectFrom("problema")
        .select(["id", "tipo", "descricao", "estado", "criado_por"])
        .where("encomenda_id", "=", id(encomenda))
        .execute(),
    );
  }

  it("a 6 dias não abre; a 5 abre um problema de atraso, uma vez só, com as unidades e a data", async () => {
    const s = await cenario();
    const { encomenda } = await expedicaoPaga(s, s.metodoManual, 2, false);
    const limite = await dataLimiteDe(s.c, encomenda);
    expect(limite).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(
      (await avisarEncomendasParadas(base.api, meioDia(limite, -6))).falhas,
    ).toBe(0);
    expect(await problemasDe(s.c, encomenda)).toHaveLength(0);

    const r = await avisarEncomendasParadas(base.api, meioDia(limite, -5));
    expect(r.falhas).toBe(0);
    expect(r.abertos).toBeGreaterThanOrEqual(1);
    const ps = await problemasDe(s.c, encomenda);
    expect(ps).toHaveLength(1);
    const dd = `${limite.slice(8, 10)}/${limite.slice(5, 7)}/${limite.slice(0, 4)}`;
    expect(ps[0]).toMatchObject({
      tipo: "atraso",
      estado: "aberto",
      criado_por: "sistema:envios",
    });
    expect(ps[0]?.descricao).toContain(`2 unidades por expedir`);
    expect(ps[0]?.descricao).toContain(dd);
    // Sem dados pessoais na descrição.
    expect(ps[0]?.descricao).not.toContain("Rui");

    // A segunda volta (e a de depois da data) não abre outro.
    await avisarEncomendasParadas(base.api, meioDia(limite, -4));
    await avisarEncomendasParadas(base.api, meioDia(limite, 3));
    expect(await problemasDe(s.c, encomenda)).toHaveLength(1);

    // Aparece na lista «A decidir», na fila do problema.
    const lista = await ok(s.adm("GET", "/tasks?fila=problema"));
    const casos = (lista["dados"] ??
      lista["casos"] ??
      lista["itens"]) as Json[];
    expect(
      casos.some((x) => String(x["caso"]).endsWith(String(ps[0]?.id))),
    ).toBe(true);
  });

  it("depois da data-limite também abre; a expedição só criada não conta como saída, a expedida sim", async () => {
    const s = await cenario();
    // Uma expedição criada (ainda no armazém): continua parada.
    const a = await expedicaoPaga(s, s.metodoManual, 2, true);
    const limite = await dataLimiteDe(s.c, a.encomenda);
    // Outra, toda expedida, não abre.
    const b = await expedicaoPaga(s, s.metodoManual, 1, true);
    const versao = await comComerciante(base.dono, s.c, (trx) =>
      trx
        .selectFrom("expedicao")
        .select("versao")
        .where("id", "=", id(b.expedicao))
        .executeTakeFirstOrThrow(),
    );
    await ok(
      s.adm("PATCH", `/shipments/${b.expedicao}`, {
        versao: versao.versao,
        estado: "expedida",
      }),
    );
    await avisarEncomendasParadas(base.api, meioDia(limite, 2));
    expect(await problemasDe(s.c, a.encomenda)).toHaveLength(1);
    expect(await problemasDe(s.c, b.encomenda)).toHaveLength(0);
  });

  it("o dia é o da loja: o mesmo instante abre num fuso e não no outro", async () => {
    const s = await cenario();
    const { encomenda } = await expedicaoPaga(s, s.metodoManual, 1, false);
    const limite = await dataLimiteDe(s.c, encomenda);
    // 12:00 UTC do dia 6 antes: em Lisboa ainda é esse dia (não abre).
    const agora = meioDia(limite, -6);
    await avisarEncomendasParadas(base.api, agora);
    expect(await problemasDe(s.c, encomenda)).toHaveLength(0);
    // Em Kiritimati (UTC+14) já é o dia seguinte: 5 dias antes, abre.
    await comComerciante(base.dono, s.c, (trx) =>
      trx
        .updateTable("comerciante")
        .set({ fuso: "Pacific/Kiritimati" })
        .where("id", "=", s.c)
        .execute(),
    );
    await avisarEncomendasParadas(base.api, agora);
    const ps = await problemasDe(s.c, encomenda);
    expect(ps).toHaveLength(1);
    expect(ps[0]?.descricao).toContain("1 unidade por expedir");
  });

  it("o dia é o da loja, também a oeste: às 05:00 UTC do 5.º dia, em Pago Pago (UTC−11) ainda é o 6.º", async () => {
    const s = await cenario();
    const { encomenda } = await expedicaoPaga(s, s.metodoManual, 1, false);
    const limite = await dataLimiteDe(s.c, encomenda);
    await comComerciante(base.dono, s.c, (trx) =>
      trx
        .updateTable("comerciante")
        .set({ fuso: "Pacific/Pago_Pago" })
        .where("id", "=", s.c)
        .execute(),
    );
    const agora = new Date(meioDia(limite, -5).getTime() - 7 * 60 * 60 * 1000);
    await avisarEncomendasParadas(base.api, agora);
    expect(await problemasDe(s.c, encomenda)).toHaveLength(0);
    // Doze horas depois, lá também é o 5.º dia.
    await avisarEncomendasParadas(
      base.api,
      new Date(agora.getTime() + 12 * 60 * 60 * 1000),
    );
    expect(await problemasDe(s.c, encomenda)).toHaveLength(1);
  });

  it("a candidata entra ao pagar e sai ao avisar ou ao cancelar; cancelada não abre", async () => {
    const s = await cenario();
    const a = await expedicaoPaga(s, s.metodoManual, 1, false);
    const b = await expedicaoPaga(s, s.metodoManual, 1, false);
    const limite = await dataLimiteDe(s.c, a.encomenda);
    const candidatas = async () =>
      (
        await sql<{
          e: string;
        }>`select encomenda_id::text as e from tarefa_parada
           where comerciante_id = ${s.c}::uuid order by 1`.execute(base.dono)
      ).rows.map((r) => r.e);
    expect(await candidatas()).toEqual(
      [id(a.encomenda), id(b.encomenda)].sort(),
    );
    // A API não lê a tabela interna.
    await expect(
      comComerciante(base.api, s.c, (trx) =>
        sql`select 1 from tarefa_parada`.execute(trx),
      ),
    ).rejects.toThrow();
    await cancelarEncomendaPaga(
      base.api,
      s.c,
      id(b.encomenda),
      { motivo: "o cliente desistiu" },
      "pessoa:teste",
    );
    expect(await candidatas()).toEqual([id(a.encomenda)]);
    await avisarEncomendasParadas(base.api, meioDia(limite, 1));
    expect(await candidatas()).toEqual([]);
    expect(await problemasDe(s.c, a.encomenda)).toHaveLength(1);
    expect(
      (await problemasDe(s.c, b.encomenda)).filter((p) => p.tipo === "atraso"),
    ).toHaveLength(0);
  });

  it("duas voltas ao mesmo tempo abrem um problema só", async () => {
    const s = await cenario();
    const { encomenda } = await expedicaoPaga(s, s.metodoManual, 1, false);
    const limite = await dataLimiteDe(s.c, encomenda);
    const agora = meioDia(limite, -1);
    const [r1, r2] = await Promise.all([
      avisarEncomendasParadas(base.api, agora),
      avisarEncomendasParadas(base.api, agora),
    ]);
    expect(r1.falhas + r2.falhas).toBe(0);
    expect(await problemasDe(s.c, encomenda)).toHaveLength(1);
  });

  it("isolamento: cada comerciante vê só as suas; a marca não se muda nem apaga; sem data não abre nem falha", async () => {
    const s1 = await cenario();
    const s2 = await cenario();
    const e1 = await expedicaoPaga(s1, s1.metodoManual, 1, false);
    const e2 = await expedicaoPaga(s2, s2.metodoManual, 1, false);
    const limite = await dataLimiteDe(s1.c, e1.encomenda);
    // Na transacção de um comerciante, a função só devolve as dele.
    const doUm = await comComerciante(base.api, s1.c, async (trx) => {
      const { rows } = await sql<{
        encomenda_id: string;
      }>`select encomenda_id from envios_paradas(${meioDia(limite, 1)}, 100, null)`.execute(
        trx,
      );
      return rows.map((r) => r.encomenda_id);
    });
    expect(doUm).toContain(id(e1.encomenda));
    expect(doUm).not.toContain(id(e2.encomenda));

    const r = await avisarEncomendasParadas(base.api, meioDia(limite, 1));
    expect(r.falhas).toBe(0);
    const marcas1 = await comComerciante(base.api, s1.c, (trx) =>
      trx.selectFrom("encomenda_parada").select("encomenda_id").execute(),
    );
    expect(marcas1.map((m) => m.encomenda_id)).toEqual([id(e1.encomenda)]);
    // Só se acrescenta: nem o dono da base a muda ou apaga.
    for (const ordem of [
      sql`delete from encomenda_parada`,
      sql`update encomenda_parada set por_expedir = 9`,
    ]) {
      await expect(
        comComerciante(base.dono, s1.c, (trx) => ordem.execute(trx)),
      ).rejects.toThrow();
    }
    // A data que falta ou não é uma data não pára a volta.
    const { rows } = await sql<{
      a: string | null;
      b: string | null;
      c: string | null;
    }>`select envios_data_limite('{}'::jsonb)::text as a,
              envios_data_limite('{"data_limite":"2026-02-30"}'::jsonb)::text as b,
              envios_data_limite('{"data_limite":"2026-11-12"}'::jsonb)::text as c`.execute(
      base.dono,
    );
    expect(rows[0]).toEqual({ a: null, b: null, c: "2026-11-12" });
  });
});
