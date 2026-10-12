import { writeFileSync } from "node:fs";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { vendas } from "../src/vendas/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A medição das vendas do dia e do mês (docs/35 §7; #367): medir antes de
// pré-calcular. Não corre na bateria normal: só com `MEDIR=1` (demora
// minutos a encher a base). O resultado vai para `MEDIR_SAIDA` (um ficheiro
// JSON), para se copiar para o desenho e para a memória.
//
// Três comerciantes com N encomendas cada (por omissão 100 000), espalhadas
// por 13 meses: ~80 % pagas, ~75 % faturadas, ~4 % reembolsadas (5 % das
// pagas) com nota de crédito. Cada pagamento tem três transições e cada
// documento três passos de rasto, como no caminho real (revisão do #385,
// P2-1).
//
// 🔴 Nunca contra o PostgreSQL da VPS: `criarBaseDeTeste` muda a
// palavra-passe do papel `eurolify_api` da instância e o `fechar` tira-lhe o
// LOGIN — a API deixava de entrar. Na VPS mede-se só a ler, com `EXPLAIN
// ANALYZE` pelo fluxo de medir (revisão do #385, P2-3). Com `MEDIR_GUARDAR=1`
// a base fica; limpar à mão: `DROP DATABASE <base>`, `ALTER ROLE
// eurolify_api NOLOGIN PASSWORD NULL` e `DROP ROLE <dono_…>`. Os dados entram em massa como superutilizador, com os gatilhos
// desligados só nessa preparação (como em vendas.test.ts); a consulta corre
// depois como a API, com o RLS.

const MEDIR = process.env["MEDIR"] === "1";
const N = Number(process.env["MEDIR_N"] ?? 100_000);
const VOLTAS = 5;

describe.skipIf(URL_BASE === undefined || !MEDIR)(
  "medição: vendas do dia e do mês",
  () => {
    let base: BaseDeTeste;
    const comerciantes: string[] = [];
    const resultado: Record<string, unknown> = { n_por_comerciante: N };

    async function semGatilhos(
      trx: Transaction<unknown>,
      tabelas: string[],
      fn: () => Promise<void>,
    ) {
      await sql`set local session_replication_role = replica`.execute(trx);
      const { rows } = await sql<{ tabela: string; nome: string }>`
        select c.relname as tabela, t.tgname as nome from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and t.tgenabled = 'A'
          and c.relname = any(${tabelas}::text[])`.execute(trx);
      for (const g of rows) {
        await sql`alter table ${sql.id(g.tabela)} disable trigger ${sql.id(g.nome)}`.execute(
          trx,
        );
      }
      await fn();
      for (const g of rows) {
        await sql`alter table ${sql.id(g.tabela)} enable always trigger ${sql.id(g.nome)}`.execute(
          trx,
        );
      }
    }

    async function encher(c: string) {
      await base.dono.transaction().execute((trx) =>
        semGatilhos(
          trx,
          [
            "encomenda",
            "pagamento",
            "transicao_pagamento",
            "documento_fiscal",
            "documento_conteudo",
            "documento_prova",
            "documento_rasto",
            "reembolso",
          ],
          async () => {
            // As encomendas: uniformes entre 01/10/2025 e 31/10/2026, em 3
            // canais e 4 mercados; 3 % canceladas.
            await sql`
              insert into encomenda (id, comerciante_id, loja_id, canal_id, mercado_id,
                entidade_legal_id, sessao_id, cliente_id, perfil_id, perfil_copia,
                contacto, entrega, finalidade, moeda, preco_inclui_iva, lingua,
                total_base, total_iva, total, portes, metodo_entrega,
                metodo_pagamento, aceitacoes, criada_por, estado, criada_em,
                emissor_fiscal)
              select gen_random_uuid(), ${c}::uuid, gen_random_uuid(),
                ('00000000-0000-4000-8000-00000000000' || (i % 3))::uuid,
                ('00000000-0000-4000-9000-00000000000' || (i % 4))::uuid,
                gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                gen_random_uuid(), '{}', '{}', '{}', 'consumo', 'EUR', true, 'pt',
                b, t - b, t, '{}', '{}', 'mb_way', '{}', 'medicao',
                case when i % 33 = 0 then 'cancelada_sem_pagamento' else 'paga' end,
                timestamptz '2025-10-01 00:00+01'
                  + (i::double precision / ${N}) * interval '395 days',
                'eurolify'
              from (select i, 1000 + (i * 7919) % 50000 as t,
                           ((1000 + (i * 7919) % 50000) * 100 / 123) as b
                    from generate_series(1, ${N}) as i) g`.execute(trx);
            // 80 % pagas: um pagamento capturado 1 a 30 minutos depois.
            await sql`
              insert into pagamento (id, comerciante_id, encomenda_id, conta_id,
                prestador, metodo, modo, montante, moeda, referencia, expira_em, estado)
              select gen_random_uuid(), e.comerciante_id, e.id, gen_random_uuid(),
                'eupago', 'mb_way', 'teste', e.total, e.moeda,
                md5(e.id::text || 'p'), e.criada_em + interval '1 day', 'capturado'
              from encomenda e
              where e.comerciante_id = ${c}::uuid and e.estado = 'paga'
                and (hashtext(e.id::text) & 1023) < 845`.execute(trx);
            await sql`
              insert into transicao_pagamento (comerciante_id, pagamento_id, de, para,
                origem, quem, em)
              select p.comerciante_id, p.id, x.de, x.para, 'aviso', 'prestador:eupago',
                e.criada_em + x.passo * ((abs(hashtext(p.id::text)) % 10) + 1)
                  * interval '1 minute'
              from pagamento p join encomenda e on e.id = p.encomenda_id
              cross join (values (null, 'criado', 0), ('criado', 'a_aguardar_cliente', 1),
                                 ('a_aguardar_cliente', 'autorizado', 2),
                                 ('autorizado', 'capturado', 3)) as x(de, para, passo)
              where p.comerciante_id = ${c}::uuid`.execute(trx);
            // 75 % (das pagas, quase todas) faturadas 5 minutos depois.
            await sql`
              insert into documento_fiscal (id, comerciante_id, encomenda_id,
                entidade_legal_id, modo, tipo, estado)
              select gen_random_uuid(), p.comerciante_id, p.encomenda_id,
                gen_random_uuid(), 'teste', 'fatura', 'emitido'
              from pagamento p
              where p.comerciante_id = ${c}::uuid and (hashtext(p.id::text) & 1023) < 960`.execute(
              trx,
            );
            await sql`
              insert into documento_conteudo (documento_id, comerciante_id, versao,
                conteudo, impressao, motivo, quem)
              select d.id, d.comerciante_id, 1,
                jsonb_build_object('moeda', 'EUR', 'linhas', '[]'::jsonb,
                  'totais', jsonb_build_object('base', e.total_base, 'iva', e.total_iva,
                    'total', e.total)),
                repeat('0', 64), 'medicao', 'medicao'
              from documento_fiscal d join encomenda e on e.id = d.encomenda_id
              where d.comerciante_id = ${c}::uuid`.execute(trx);
            await sql`
              insert into documento_prova (documento_id, comerciante_id, numero,
                linhas, totais, em_bruto)
              select d.id, d.comerciante_id, 'FT ' || left(d.id::text, 8), '[]',
                jsonb_build_object('base', e.total_base, 'iva', e.total_iva,
                  'total', e.total), '{}'
              from documento_fiscal d join encomenda e on e.id = d.encomenda_id
              where d.comerciante_id = ${c}::uuid`.execute(trx);
            await sql`
              insert into documento_rasto (documento_id, comerciante_id, passo, de,
                para, quem, em)
              select d.id, d.comerciante_id, 'estado', x.de, x.para,
                'sistema:documentos', e.criada_em + x.minutos * interval '1 minute'
              from documento_fiscal d join encomenda e on e.id = d.encomenda_id
              cross join (values (null, 'a_verificar', 31), ('a_verificar', 'pronto', 33),
                                 ('pronto', 'emitido', 35)) as x(de, para, minutos)
              where d.comerciante_id = ${c}::uuid`.execute(trx);
            // 5 % reembolsadas por inteiro 3 dias depois, com nota de crédito.
            await sql`
              insert into reembolso (id, comerciante_id, encomenda_id, pagamento_id,
                origem, problema_id, montante, moeda, estado, executado_em, via,
                decidido_por, referencia_prestador)
              select gen_random_uuid(), p.comerciante_id, p.encomenda_id, p.id,
                'problema', gen_random_uuid(), p.montante, p.moeda, 'executado',
                e.criada_em + interval '3 days', 'prestador', 'medicao', 'ref'
              from pagamento p join encomenda e on e.id = p.encomenda_id
              where p.comerciante_id = ${c}::uuid and (hashtext(p.id::text) & 1023) < 51`.execute(
              trx,
            );
            await sql`
              insert into documento_fiscal (id, comerciante_id, encomenda_id,
                entidade_legal_id, modo, tipo, estado, original_id, reembolso_id)
              select gen_random_uuid(), r.comerciante_id, r.encomenda_id,
                gen_random_uuid(), 'teste', 'nota_credito', 'emitido', f.id, r.id
              from reembolso r
              join documento_fiscal f on f.encomenda_id = r.encomenda_id and f.tipo = 'fatura'
              where r.comerciante_id = ${c}::uuid`.execute(trx);
            await sql`
              insert into documento_prova (documento_id, comerciante_id, numero,
                linhas, totais, em_bruto)
              select n.id, n.comerciante_id, 'NC ' || left(n.id::text, 8), '[]',
                jsonb_build_object('base', r.montante * 100 / 123,
                  'iva', r.montante - r.montante * 100 / 123, 'total', r.montante), '{}'
              from documento_fiscal n join reembolso r on r.id = n.reembolso_id
              where n.comerciante_id = ${c}::uuid`.execute(trx);
            // A nota de crédito com conteúdo e rasto, emitida com o reembolso:
            // entra no «creditado» (revisão do #385, P2-1).
            await sql`
              insert into documento_conteudo (documento_id, comerciante_id, versao,
                conteudo, impressao, motivo, quem)
              select n.id, n.comerciante_id, 1,
                jsonb_build_object('moeda', 'EUR', 'linhas', '[]'::jsonb,
                  'totais', jsonb_build_object('base', r.montante * 100 / 123,
                    'iva', r.montante - r.montante * 100 / 123, 'total', r.montante)),
                repeat('0', 64), 'medicao', 'medicao'
              from documento_fiscal n join reembolso r on r.id = n.reembolso_id
              where n.comerciante_id = ${c}::uuid`.execute(trx);
            await sql`
              insert into documento_rasto (documento_id, comerciante_id, passo, de,
                para, quem, em)
              select n.id, n.comerciante_id, 'estado', x.de, x.para,
                'sistema:documentos', r.executado_em + x.minutos * interval '1 minute'
              from documento_fiscal n join reembolso r on r.id = n.reembolso_id
              cross join (values (null, 'a_verificar', 1), ('a_verificar', 'pronto', 3),
                                 ('pronto', 'emitido', 5)) as x(de, para, minutos)
              where n.comerciante_id = ${c}::uuid`.execute(trx);
          },
        ),
      );
    }

    /** A primeira volta (fria) à parte, e a mediana e o máximo das seguintes. */
    async function medir(
      nome: string,
      pedido: { inicio: string; fim: string },
    ) {
      const tempos: number[] = [];
      for (let v = 0; v <= VOLTAS; v++) {
        const t0 = performance.now();
        const r = await vendas(base.api, comerciantes[0] ?? "", pedido);
        tempos.push(performance.now() - t0);
        expect(r.linhas.length).toBeGreaterThan(0);
      }
      const primeira = tempos.shift() ?? 0;
      tempos.sort((x, y) => x - y);
      resultado[nome] = {
        primeira_volta_ms: Math.round(primeira),
        mediana_ms: Math.round(tempos[Math.floor(VOLTAS / 2)] ?? 0),
        maximo_ms: Math.round(tempos.at(-1) ?? 0),
      };
    }

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      for (const nome of ["A", "B", "C"]) {
        comerciantes.push(
          await registarComerciante(base.api, {
            nome,
            lingua: "pt",
            fuso: "Europe/Lisbon",
          }),
        );
      }
      const t0 = performance.now();
      for (const c of comerciantes) await encher(c);
      // Como depois de uma carga real assentar: sem o VACUUM, a primeira
      // leitura grava os hint bits e não há mapa de visibilidade (revisão do
      // #385, P2-2).
      await sql`vacuum analyze`.execute(base.dono);
      resultado["encher_s"] = Math.round((performance.now() - t0) / 1000);
      const linhas: Record<string, number> = {};
      for (const t of [
        "encomenda",
        "pagamento",
        "documento_fiscal",
        "reembolso",
      ]) {
        const { rows } = await sql<{ n: string }>`
          select count(*)::text as n from ${sql.table(t)}`.execute(base.dono);
        linhas[t] = Number(rows[0]?.n ?? 0);
      }
      resultado["linhas"] = linhas;
    }, 1_800_000);

    afterAll(async () => {
      const saida = process.env["MEDIR_SAIDA"];
      if (saida !== undefined) {
        writeFileSync(saida, JSON.stringify(resultado, null, 2));
      }
      // Com MEDIR_GUARDAR=1, a base fica para se analisar o plano à mão.
      if (process.env["MEDIR_GUARDAR"] !== "1") await base.fechar();
    });

    it("mede o dia e o mês, com e sem os índices da 0068", async () => {
      const dia = { inicio: "2026-06-15", fim: "2026-06-16" };
      const mes = { inicio: "2026-06-01", fim: "2026-07-01" };
      await medir("dia_com_indices", dia);
      await medir("mes_com_indices", mes);
      resultado["base"] = new URL(base.urlApi).pathname.slice(1);
      resultado["comerciante"] = comerciantes[0];
      if (process.env["MEDIR_GUARDAR"] === "1") return;
      // Sem os índices novos: o que a 0068 poupa.
      await sql`drop index encomenda_por_criacao, transicao_pagamento_capturas,
        documento_rasto_emissoes, reembolso_por_execucao`.execute(base.dono);
      await medir("dia_sem_indices", dia);
      await medir("mes_sem_indices", mes);
    }, 1_800_000);
  },
);
