import { randomBytes } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  criarEntidadeLegal,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarLigacao, noDocumentos } from "../src/faturacao/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A limpeza dos pedidos de autorização do emissor (migração 0099; docs/29
// §20; Q1 «a»: 30 dias). A função chama-a o programa eurolify-limpeza da VPS
// com o papel eurolify_limpeza; a API não a pode chamar nem apagar. Cada
// prazo testa-se dos dois lados: um dia depois apaga, um dia antes fica.

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    return String((erro as { message?: unknown }).message);
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)(
  "faturação: a limpeza dos pedidos de autorização (0099)",
  () => {
    let base: BaseDeTeste;
    let dono: Kysely<unknown>;
    const ids: Record<string, string> = {};

    /** Um comerciante com uma chave (quem pede) e uma ligação Moloni. */
    async function comLigacao(nome: string, nif: string) {
      const c = await registarComerciante(base.api, {
        nome,
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      await criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Dono",
        ambitos: ["invoices:accounts"] as never,
      });
      const entidade = await criarEntidadeLegal(base.api, c, {
        denominacao: `${nome}, Lda`,
        forma_juridica: "sociedade_por_quotas",
        pais: "PT",
        numero_fiscal: nif,
        morada_linha: "Rua de Teste, 1",
        morada_codigo_postal: "1000-001",
        morada_localidade: "Lisboa",
      });
      const ligacao = await noDocumentos(base.api, c, (trx) =>
        criarLigacao(
          trx,
          c,
          {
            entidade_legal: entidade,
            adaptador: "moloni",
            serie: "500",
            taxas: [],
            isencoes: [],
          },
          "teste",
        ),
      );
      return { c, ligacao };
    }

    /**
     * Um pedido criado há `criado` dias, com 10 minutos de validade; usado
     * `usado` dias atrás (ou nunca). Escrito pelo dono da base, como só os
     * testes podem (a API escreve sempre agora).
     */
    async function pedido(
      nome: string,
      l: { c: string; ligacao: string },
      criado: number,
      usado: number | null,
    ) {
      const { rows } = await sql<{ id: string }>`
        insert into autorizacao_faturacao
          (comerciante_id, ligacao_id, empresa, resumo, criada_por, criada_em, expira_em, usada_em)
        values (${l.c}::uuid, ${l.ligacao}::uuid, '401965', ${randomBytes(32)},
          'pessoa:per_teste',
          now() - make_interval(secs => ${criado * 86400}),
          now() - make_interval(secs => ${criado * 86400}) + interval '10 minutes',
          ${usado === null ? null : sql`now() - make_interval(secs => ${usado * 86400})`})
        returning id`.execute(dono);
      ids[nome] = rows[0]?.id ?? "";
    }

    const restantes = async () =>
      (
        await sql<{ id: string }>`select id from autorizacao_faturacao
          where id = any(${Object.values(ids)}::uuid[]) order by id`.execute(
          dono,
        )
      ).rows
        .map((r) => Object.keys(ids).find((k) => ids[k] === r.id))
        .sort();

    const emAtraso = async () =>
      Number(
        (
          await sql<{ n: string }>`
            select faturacao_autorizacoes_em_atraso() as n`.execute(dono)
        ).rows[0]?.n,
      );

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      dono = base.dono;
      const a = await comLigacao("Loja A", "501964843");
      const b = await comLigacao("Loja B", "509999981");
      // Expirado há 32 dias, sem uso: passou os 30 e o dia da limpeza.
      await pedido("expirado_32", a, 32, null);
      // Usado há 30,5 dias: passou os 30, ainda dentro do dia da limpeza.
      await pedido("usado_30_5", a, 31, 30.5);
      // Expirado há 29 dias: fica.
      await pedido("expirado_29", a, 29, null);
      // Usado há 29 dias: fica.
      await pedido("usado_29", a, 29.0001, 29);
      // Ainda válido: fica.
      await pedido("valido", a, 0, null);
      // Noutro comerciante, expirado há 40 dias: também se apaga.
      await pedido("outro_40", b, 40, null);
    }, 120_000);

    afterAll(async () => {
      await base.fechar();
    });

    it("só a limpeza chama as funções; a API não apaga nem as chama; a limpeza não lê a tabela", async () => {
      const { rows } = await sql<{
        nome: string;
        publico: boolean;
        api: boolean;
        limpeza: boolean;
      }>`
        select p.proname as nome,
               exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as publico,
               has_function_privilege('eurolify_api', p.oid, 'EXECUTE') as api,
               has_function_privilege('eurolify_limpeza', p.oid, 'EXECUTE') as limpeza
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('faturacao_autorizacoes_apagar', 'faturacao_autorizacoes_em_atraso',
                            'autorizacao_faturacao_apagavel', 'autorizacao_faturacao_comerciantes')
        order by 1`.execute(dono);
      expect(rows).toEqual([
        {
          nome: "autorizacao_faturacao_apagavel",
          publico: false,
          api: false,
          limpeza: false,
        },
        {
          nome: "autorizacao_faturacao_comerciantes",
          publico: false,
          api: false,
          limpeza: false,
        },
        {
          nome: "faturacao_autorizacoes_apagar",
          publico: false,
          api: false,
          limpeza: true,
        },
        {
          nome: "faturacao_autorizacoes_em_atraso",
          publico: false,
          api: false,
          limpeza: true,
        },
      ]);
      expect(
        await mensagemDoErro(
          sql`select faturacao_autorizacoes_apagar()`.execute(base.api),
        ),
      ).toMatch(/permission denied/);
      // A API não tem DELETE na tabela (o RLS avalia-se antes do privilégio,
      // por isso pergunta-se ao catálogo).
      const priv = await sql<{ apaga: boolean }>`
        select has_table_privilege('eurolify_api', 'autorizacao_faturacao', 'DELETE')
          as apaga`.execute(dono);
      expect(priv.rows[0]?.apaga).toBe(false);
      expect(
        await mensagemDoErro(
          dono.transaction().execute(async (trx) => {
            await sql`set local role eurolify_limpeza`.execute(trx);
            await sql`select count(*) from autorizacao_faturacao`.execute(trx);
          }),
        ),
      ).toMatch(/permission denied/);
    });

    it("dentro dos 30 dias o pedido não se apaga, nem pelo dono da base", async () => {
      expect(
        await mensagemDoErro(
          sql`delete from autorizacao_faturacao where id = ${ids["expirado_29"]}::uuid`.execute(
            dono,
          ),
        ),
      ).toMatch(/invoices\.immutable/);
      expect(
        await mensagemDoErro(
          sql`delete from autorizacao_faturacao where id = ${ids["valido"]}::uuid`.execute(
            dono,
          ),
        ),
      ).toMatch(/invoices\.immutable/);
    });

    it("a limpeza apaga o que passou os 30 dias, de todos os comerciantes, e a verificação deixa de avisar", async () => {
      // Antes: só o de 32 dias e o do outro comerciante passaram o dia da
      // limpeza.
      expect(await emAtraso()).toBe(2);
      const apagadas = await dono.transaction().execute(async (trx) => {
        await sql`set local role eurolify_limpeza`.execute(trx);
        const { rows } = await sql<{ n: number }>`
          select faturacao_autorizacoes_apagar() as n`.execute(trx);
        await sql`select faturacao_autorizacoes_em_atraso()`.execute(trx);
        return rows[0]?.n;
      });
      expect(apagadas).toBe(3);
      expect(await restantes()).toEqual(["expirado_29", "usado_29", "valido"]);
      expect(await emAtraso()).toBe(0);
      // Outra vez: nada a apagar.
      const outra = await sql<{ n: number }>`
        select faturacao_autorizacoes_apagar() as n`.execute(dono);
      expect(outra.rows[0]?.n).toBe(0);
    });
  },
);
