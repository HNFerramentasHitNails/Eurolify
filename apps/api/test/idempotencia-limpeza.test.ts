import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A limpeza diária da idempotência (migração 0013; docs/18 §4). A função é
// chamada pelo programa eurolify-limpeza da VPS como superutilizador (o dono
// destes testes também o é); a API não a pode chamar.

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    return String((erro as { message?: unknown }).message);
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)(
  "limpeza da idempotência (0013)",
  () => {
    let base: BaseDeTeste;
    let a: string;
    let b: string;

    const reserva = (comerciante: string, chave: string) =>
      sql`insert into idempotencia (comerciante_id, chave, metodo, caminho, resumo_corpo)
          values (${comerciante}::uuid, ${chave}, 'POST', '/keys', ${"0".repeat(64)})`.execute(
        base.dono,
      );

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      const novo = { nome: "Loja", lingua: "pt", fuso: "Europe/Lisbon" };
      a = await registarComerciante(base.api, novo);
      b = await registarComerciante(base.api, novo);
    }, 60_000);

    afterAll(async () => {
      await base.fechar();
    });

    it("apaga só as expiradas, de todos os comerciantes, e diz quantas", async () => {
      await reserva(a, "a-expirada");
      await reserva(a, "a-valida");
      await reserva(b, "b-expirada");
      await reserva(b, "b-daqui-a-um-minuto");
      await sql`update idempotencia set expira_em = now() - interval '1 second'
        where chave in ('a-expirada', 'b-expirada')`.execute(base.dono);
      // Ainda não expirou: fica.
      await sql`update idempotencia set expira_em = now() + interval '1 minute'
        where chave = 'b-daqui-a-um-minuto'`.execute(base.dono);
      const { rows } = await sql<{ n: number }>`
        select idempotencia_apagar_expiradas() as n`.execute(base.dono);
      expect(rows[0]?.n).toBe(2);
      const { rows: ficam } = await sql<{ chave: string }>`
        select chave from idempotencia order by chave`.execute(base.dono);
      expect(ficam.map((r) => r.chave)).toEqual([
        "a-valida",
        "b-daqui-a-um-minuto",
      ]);
      const { rows: outraVez } = await sql<{ n: number }>`
        select idempotencia_apagar_expiradas() as n`.execute(base.dono);
      expect(outraVez[0]?.n).toBe(0);
    });

    it("a API não a pode chamar", async () => {
      expect(
        await mensagemDoErro(
          sql`select idempotencia_apagar_expiradas()`.execute(base.api),
        ),
      ).toMatch(/permission denied/);
    });
  },
);
