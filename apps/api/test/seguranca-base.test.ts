import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aceitarContrato,
  criarEntidadeLegal,
  mudarEstado,
  registarComerciante,
  registarVerificacao,
} from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Migração 0008 (auditoria docs/16, «Segurança e dados»): o rasto do
// Comerciante só se acrescenta, também para o dono das tabelas; e as funções
// da base nascem fechadas. Contra o PostgreSQL 18 verdadeiro (ADR-0025).

/** As funções que a API pode chamar; qualquer outra tem de ser recusada. */
const FUNCOES_DA_API = [
  "catalogo_estado_do_artigo",
  "catalogo_fila_do_artigo",
  "catalogo_marcar_combinacoes",
  "catalogo_verificar_combinacoes",
  "comerciante_actual",
  "gtin_valido",
];

const RASTO = [
  "transicao_estado",
  "aceitacao_contrato",
  "prova_verificacao",
] as const;

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    return String((erro as { message?: unknown }).message);
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)("segurança da base (0008)", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    // Uma linha em cada tabela do rasto, pelo caminho da API.
    const id = await registarComerciante(base.api, {
      nome: "Loja de Teste",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const entidade = await criarEntidadeLegal(base.api, id, {
      denominacao: "Exemplo, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "123456789",
      morada_linha: "Rua de Teste, 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
    await mudarEstado(base.api, id, {
      de: "rascunho",
      para: "prova_pendente",
      motivo: "teste",
      quem: "teste",
    });
    await aceitarContrato(base.api, id, {
      tipo: "contrato_servico",
      versao_texto: "v1-teste",
      aceite_por: "teste",
    });
    await registarVerificacao(base.api, id, {
      entidade_legal_id: entidade,
      finalidade: "identificacao_fiscal",
      origem: "manual",
      origem_detalhe: "teste",
      resultado: "aceite",
    });
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  describe("o rasto só se acrescenta, também para o dono", () => {
    it("há uma linha em cada tabela do rasto", async () => {
      for (const tabela of RASTO) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from ${sql.table(tabela)}`.execute(
          base.dono,
        );
        expect(rows[0]?.n, tabela).toBe(1);
      }
    });

    it.each(RASTO)(
      "o dono não altera, não apaga nem esvazia %s",
      async (tabela) => {
        for (const consulta of [
          sql`update ${sql.table(tabela)} set comerciante_id = comerciante_id`,
          sql`delete from ${sql.table(tabela)}`,
          sql`truncate ${sql.table(tabela)}`,
        ]) {
          expect(await mensagemDoErro(consulta.execute(base.dono))).toMatch(
            /^audit\.append_only:/,
          );
        }
        const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from ${sql.table(tabela)}`.execute(base.dono);
        expect(rows[0]?.n).toBe(1);
      },
    );
  });

  describe("funções fechadas por omissão", () => {
    it("nenhuma função do esquema public fica aberta a PUBLIC", async () => {
      const { rows } = await sql<{ nome: string }>`
        select p.proname as nome
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proacl is null or exists (
            select 1 from aclexplode(p.proacl) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
        order by 1`.execute(base.dono);
      expect(rows.map((r) => r.nome)).toEqual([]);
    });

    it("a API só pode chamar as funções da lista", async () => {
      const { rows } = await sql<{ nome: string }>`
        select p.proname as nome
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and has_function_privilege('eurolify_api', p.oid, 'EXECUTE')
        order by 1`.execute(base.dono);
      expect(rows.map((r) => r.nome)).toEqual(FUNCOES_DA_API);
    });

    it("uma função nova de quem migra nasce fechada", async () => {
      await sql`create function funcao_nova_de_teste() returns int
        language sql as 'select 1'`.execute(base.dono);
      try {
        const { rows } = await sql<{ pode: boolean }>`
          select has_function_privilege('eurolify_api',
            'funcao_nova_de_teste()', 'EXECUTE') as pode`.execute(base.dono);
        expect(rows[0]?.pode).toBe(false);
      } finally {
        await sql`drop function funcao_nova_de_teste()`.execute(base.dono);
      }
    });
  });
});
