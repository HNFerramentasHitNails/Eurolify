import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// O comerciante lido pelas funções das contas com o contexto dele, limitado à
// função (migração 0027; pedido #168). A base de teste tem um dono das tabelas
// como o da VPS (sem superutilizador nem BYPASSRLS): sem a 0027, aceitar um
// convite e o /hub/me davam 42704 lá. Aqui prova-se o que a 0027 promete: o
// contexto de quem chamou fica como estava, e sem contexto a leitura
// protegida continua recusada.

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    return String((erro as { message?: unknown }).message);
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)(
  "comerciante sem contexto (0027)",
  () => {
    let base: BaseDeTeste;
    let dono: Kysely<unknown>;
    let a: string;
    let b: string;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      dono = base.dono;
      a = await registarComerciante(base.api, {
        nome: "Loja A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      b = await registarComerciante(base.api, {
        nome: "Loja B",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
    }, 60_000);

    afterAll(async () => {
      await base.fechar();
    });

    it("lê o nome e o estado de um comerciante sem contexto de quem chama", async () => {
      const { rows } = await sql<{ nome: string; estado: string }>`
        select * from comerciante_resumo(${b}::uuid)`.execute(dono);
      expect(rows).toEqual([{ nome: "Loja B", estado: "rascunho" }]);
    });

    it("devolve o contexto que havia: o de A fica o de A depois de ler B", async () => {
      const depois = await dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
          trx,
        );
        await sql`select * from comerciante_resumo(${b}::uuid)`.execute(trx);
        const { rows } = await sql<{ valor: string }>`
          select current_setting('eurolify.comerciante') as valor`.execute(trx);
        return rows[0]?.valor;
      });
      expect(depois).toBe(a);
    });

    it("sem contexto antes, a leitura protegida continua recusada depois", async () => {
      const motivo = await mensagemDoErro(
        dono.transaction().execute(async (trx) => {
          await sql`select * from comerciante_resumo(${b}::uuid)`.execute(trx);
          // Como o dono das tabelas (o RLS vale para ele: FORCE).
          const { rows } = await sql<{ dono: string }>`
            select pg_get_userbyid(datdba) as dono from pg_database
            where datname = current_database()`.execute(trx);
          await sql`set local role ${sql.id(rows[0]?.dono ?? "")}`.execute(trx);
          await sql`select count(*) from comerciante`.execute(trx);
        }),
      );
      expect(motivo).toMatch(/invalid input syntax for type uuid/);
    });

    it("a API não chama a função", async () => {
      const motivo = await mensagemDoErro(
        sql`select * from comerciante_resumo(${a}::uuid)`.execute(base.api),
      );
      expect(motivo).toMatch(/permission denied/);
    });
  },
);
