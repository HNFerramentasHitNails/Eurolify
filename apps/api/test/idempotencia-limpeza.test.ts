import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A limpeza diária da idempotência (migração 0013; docs/18 §4). A função é
// chamada pelo programa eurolify-limpeza da VPS com o papel eurolify_limpeza
// (não superutilizador, BYPASSRLS, só a idempotência; revisão do #119, P2-2);
// a API não a pode chamar.

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

    it("o papel da limpeza não é superutilizador, não tem palavra-passe e só toca na idempotência", async () => {
      const { rows } = await sql<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolcanlogin: boolean;
        tem_senha: boolean;
      }>`
        select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin,
               rolpassword is not null as tem_senha
        from pg_authid where rolname = 'eurolify_limpeza'`.execute(base.dono);
      expect(rows[0]).toEqual({
        rolsuper: false,
        rolbypassrls: true,
        rolcreaterole: false,
        rolcreatedb: false,
        rolcanlogin: true,
        tem_senha: false,
      });
      const { rows: tabelas } = await sql<{ tabela: string }>`
        select c.relname as tabela
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and (has_table_privilege('eurolify_limpeza', c.oid, 'SELECT')
            or has_table_privilege('eurolify_limpeza', c.oid, 'INSERT')
            or has_table_privilege('eurolify_limpeza', c.oid, 'UPDATE')
            or has_table_privilege('eurolify_limpeza', c.oid, 'DELETE'))
        order by 1`.execute(base.dono);
      expect(tabelas.map((t) => t.tabela)).toEqual(["idempotencia"]);
    });

    it("a função nasce fechada: sem PUBLIC na ACL, só o papel da limpeza a chama (revisão do #119, P3-4)", async () => {
      const { rows } = await sql<{
        publico: boolean;
        api: boolean;
        limpeza: boolean;
      }>`
        select exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as publico,
               has_function_privilege('eurolify_api', p.oid, 'EXECUTE') as api,
               has_function_privilege('eurolify_limpeza', p.oid, 'EXECUTE') as limpeza
        from pg_proc p where p.proname = 'idempotencia_apagar_expiradas'`.execute(
        base.dono,
      );
      expect(rows[0]).toEqual({ publico: false, api: false, limpeza: true });
    });

    it("código posto na função pelo dono corre com os direitos da limpeza, não de superutilizador (revisão do #119, P2-2)", async () => {
      // A sessão entra como eurolify_limpeza, como o programa da VPS (lá pelo
      // socket do contentor, sem palavra-passe; aqui com uma só para o teste).
      await sql`alter role eurolify_limpeza password 'so-para-testes'`.execute(
        base.dono,
      );
      const original = await sql<{ def: string }>`
        select pg_get_functiondef('idempotencia_apagar_expiradas()'::regprocedure) as def`.execute(
        base.dono,
      );
      const u = new URL(base.urlApi);
      u.username = "eurolify_limpeza";
      u.password = "so-para-testes";
      const cliente = new pg.Client({ connectionString: u.toString() });
      try {
        // O dono das tabelas troca a função por uma que tenta subir de papel.
        await sql`create or replace function idempotencia_apagar_expiradas()
          returns integer language plpgsql
          set search_path = pg_catalog, public, pg_temp as $f$
          begin
            reset role;
            execute 'alter role eurolify_api superuser';
            return 0;
          end $f$`.execute(base.dono);
        await cliente.connect();
        const erro = await cliente
          .query("select idempotencia_apagar_expiradas()")
          .then(
            () => "sem erro",
            (e: unknown) => String((e as { message?: unknown }).message),
          );
        expect(erro).toMatch(/permission denied|must be superuser|privilege/);
        const { rows } = await sql<{ rolsuper: boolean }>`
          select rolsuper from pg_roles where rolname = 'eurolify_api'`.execute(
          base.dono,
        );
        expect(rows[0]?.rolsuper).toBe(false);
      } finally {
        await cliente.end().catch(() => undefined);
        const def = original.rows[0]?.def;
        if (def !== undefined) await sql.raw(def).execute(base.dono);
        await sql`alter role eurolify_limpeza password null`.execute(base.dono);
      }
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
