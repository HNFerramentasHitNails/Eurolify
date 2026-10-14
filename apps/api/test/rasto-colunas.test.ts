import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { comRasto } from "../src/base/rasto.js";
import {
  mudarEstado,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// O rasto de auditoria comum, passo 2 (docs/28 §4; migração 0053; #322): as
// tabelas do rasto gravam o canal, o pedido, a IA e quem autorizou, pelo
// gatilho único `rasto_completar()`.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };

interface LinhaDoRasto {
  canal: string | null;
  pedido: string | null;
  ia: unknown;
  autorizado_por: string | null;
  motivo?: string | null;
}

describe.skipIf(URL_BASE === undefined)(
  "rasto: as colunas do contexto (0053)",
  () => {
    let base: BaseDeTeste;
    let dono: Kysely<unknown>;
    let a: string;
    let escrita: string;
    let escritaId: string;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      dono = base.dono;
      a = await registarComerciante(base.api, NOVO);
      const e = await criarChave(base.dono, a, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Escrita",
        ambitos: ["catalog:read", "catalog:write"],
      });
      escrita = e.segredo;
      escritaId = e.id;
    }, 60_000);

    afterAll(async () => {
      await base.fechar();
    });

    it("um artigo criado pela API com chave e IA declarada: canal, pedido e IA; ninguém autorizou", async () => {
      let pedidoId = "";
      const app = criarApp(
        {
          logger: false,
          genReqId: () => {
            pedidoId = `req-${randomUUID()}`;
            return pedidoId;
          },
        },
        undefined,
        base.api,
      );
      const r = await app.inject({
        method: "POST",
        url: "/products",
        headers: {
          authorization: `Bearer ${escrita}`,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
          "eurolify-ia":
            "fornecedor=anthropic; modelo=claude-x; execucao=run_1",
        },
        payload: JSON.stringify({
          tipo: "fisico",
          nome: "Gel construtor",
          categoria_fiscal: "normal",
          variantes: [
            { sku: "GEL-RASTO", unidade_de_venda: "unidade", peso_g: 30 },
          ],
        }),
      });
      await app.close();
      expect(r.statusCode, r.body).toBe(201);
      const id = r.json<{ id: string }>().id.replace(/^prd_/, "");
      const { rows } = await sql<LinhaDoRasto & { quem: string }>`
      select quem, canal, pedido, ia, autorizado_por, motivo
      from alteracao_catalogo where artigo_id = ${id}::uuid`.execute(dono);
      expect(rows.length).toBeGreaterThan(0);
      for (const linha of rows) {
        expect(linha).toEqual({
          quem: `chave:key_${escritaId}`,
          canal: "api",
          pedido: pedidoId,
          ia: {
            fornecedor: "anthropic",
            modelo: "claude-x",
            execucao: "run_1",
            prova: "declarado",
          },
          // §3.2: uma chave nunca autoriza.
          autorizado_por: null,
          motivo: null,
        });
      }
    });

    it("no Hub, a pessoa que age fica como quem autorizou; a conta nova tem o canal e o pedido", async () => {
      const h = hubDeTeste(base);
      const p = await h.pessoaCom(a, "dono");
      // A conta criada pelo convite (rota sem sessão): canal e pedido, e a
      // própria pessoa como quem autorizou, porque provou quem é no pedido
      // (0064; Diogo, 11/10/2026).
      const criada = await sql<LinhaDoRasto>`
      select canal, pedido, ia, autorizado_por, motivo from evento_conta
      where pessoa_id = ${p.pessoa}::uuid and acto = 'conta_criada'`.execute(
        dono,
      );
      expect(criada.rows).toHaveLength(1);
      expect(criada.rows[0]).toMatchObject({
        canal: "hub",
        ia: null,
        autorizado_por: `pessoa:per_${p.pessoa}`,
      });
      expect(criada.rows[0]?.pedido).toMatch(/^[A-Za-z0-9._:-]+$/);
      // Gerar códigos novos (rota com sessão): a pessoa autorizou.
      const r = await h.pedir("POST", "/hub/recovery-codes", {
        sessao: p.sessao,
      });
      expect(r.statusCode, r.body).toBe(201);
      const { rows } = await sql<LinhaDoRasto & { acto: string }>`
      select acto, canal, autorizado_por from evento_conta
      where pessoa_id = ${p.pessoa}::uuid and acto = 'codigos_gerados'
      order by quando desc limit 1`.execute(dono);
      expect(rows[0]).toMatchObject({
        canal: "hub",
        autorizado_por: `pessoa:per_${p.pessoa}`,
      });
      await h.app.close();
    });

    it("quem escreve a linha não escolhe o contexto: o gatilho sobrepõe-no", async () => {
      const linha = await dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.canal', 'operador', true),
        set_config('eurolify.pedido', 'req-real', true)`.execute(trx);
        await sql`insert into alteracao_catalogo (comerciante_id, entidade,
          operacao, campos, quem, transacao, canal, pedido, autorizado_por)
        values (${a}::uuid, 'artigo', 'alterado', '{"nome": {}}', 'teste:x',
          gen_random_uuid(), 'hub', 'req-falso',
          'pessoa:per_00000000-0000-0000-0000-000000000000')
      `.execute(trx);
        const { rows } = await sql<LinhaDoRasto>`
        select canal, pedido, autorizado_por from alteracao_catalogo
        where quem = 'teste:x'`.execute(trx);
        return rows[0];
      });
      expect(linha).toEqual({
        canal: "operador",
        pedido: "req-real",
        autorizado_por: null,
      });
    });

    it("o motivo do contexto entra só onde a linha não o trouxe", async () => {
      const linhas = await dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.motivo', 'pedido do titular', true)`.execute(
          trx,
        );
        await sql`insert into alteracao_catalogo (comerciante_id, entidade,
          operacao, campos, quem, transacao)
        values (${a}::uuid, 'artigo', 'alterado', '{"nome": {}}', 'teste:motivo',
          gen_random_uuid())`.execute(trx);
        await sql`insert into alteracao_catalogo (comerciante_id, entidade,
          operacao, campos, quem, transacao, motivo)
        values (${a}::uuid, 'artigo', 'alterado', '{"nome": {}}', 'teste:motivo',
          gen_random_uuid(), 'o da linha')`.execute(trx);
        const { rows } = await sql<{ motivo: string | null }>`
        select motivo from alteracao_catalogo where quem = 'teste:motivo'
        order by id`.execute(trx);
        return rows;
      });
      expect(linhas).toEqual([
        { motivo: "pedido do titular" },
        { motivo: "o da linha" },
      ]);
    });

    it("a transição do comerciante guarda o seu motivo e o canal do contexto", async () => {
      await comRasto({ canal: "operador", pedido: "github-run:7" }, () =>
        mudarEstado(base.api, a, {
          de: "rascunho",
          para: "prova_pendente",
          motivo: "documentos pedidos",
          quem: "operador:github:1",
        }),
      );
      const { rows } = await sql<LinhaDoRasto>`
      select canal, pedido, ia, autorizado_por, motivo from transicao_estado
      where comerciante_id = ${a}::uuid and para = 'prova_pendente'`.execute(
        dono,
      );
      expect(rows).toEqual([
        {
          canal: "operador",
          pedido: "github-run:7",
          ia: null,
          autorizado_por: null,
          motivo: "documentos pedidos",
        },
      ]);
    });

    it("um motivo com mais de 500 caracteres corta-se, não desfaz a operação (revisão do #334, P1-1)", async () => {
      const motivo = await dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.motivo', ${"m".repeat(600)}, true)`.execute(
          trx,
        );
        await sql`insert into alteracao_catalogo (comerciante_id, entidade,
          operacao, campos, quem, transacao)
        values (${a}::uuid, 'artigo', 'alterado', '{"nome": {}}', 'teste:longo',
          gen_random_uuid())`.execute(trx);
        const { rows } = await sql<{ n: number }>`
        select length(motivo) as n from alteracao_catalogo
        where quem = 'teste:longo'`.execute(trx);
        return rows[0]?.n;
      });
      expect(motivo).toBe(500);
      // A transição do comerciante guarda o seu motivo inteiro.
      await mudarEstado(base.api, a, {
        de: "prova_pendente",
        para: "em_revisao",
        motivo: "x".repeat(600),
        quem: "operador:github:1",
      });
      const { rows } = await sql<{ n: number }>`
      select length(motivo) as n from transicao_estado
      where comerciante_id = ${a}::uuid and para = 'em_revisao'`.execute(dono);
      expect(rows).toEqual([{ n: 600 }]);
    });

    it("no Hub com uma IA declarada, o cookie não chega para dizer que a pessoa autorizou (P3-1)", async () => {
      const h = hubDeTeste(base);
      const p = await h.pessoaCom(a, "dono");
      const r = await h.app.inject({
        method: "POST",
        url: "/hub/recovery-codes",
        headers: {
          origin: "https://hub.exemplo.test",
          cookie: `__Host-eurolify_sessao=${p.sessao}`,
          "content-type": "application/json",
          "eurolify-ia": "modelo=m",
        },
        payload: "{}",
      });
      expect(r.statusCode, r.body).toBe(201);
      const { rows } = await sql<LinhaDoRasto>`
      select canal, ia, autorizado_por from evento_conta
      where pessoa_id = ${p.pessoa}::uuid and acto = 'codigos_gerados'
      order by quando desc limit 1`.execute(dono);
      expect(rows[0]).toMatchObject({
        canal: "hub",
        ia: { modelo: "m", prova: "declarado" },
        autorizado_por: null,
      });
      await h.app.close();
    });

    it("o rasto dos documentos fiscais também leva o contexto", async () => {
      const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from information_schema.columns
      where table_name = 'documento_rasto'
        and column_name in ('canal', 'pedido', 'ia', 'autorizado_por')`.execute(
        dono,
      );
      expect(rows).toEqual([{ n: 4 }]);
      const gatilhos = await sql<{ tabela: string }>`
      select c.relname as tabela from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname = 'rasto_completar' order by 1`.execute(dono);
      expect(gatilhos.rows.map((g) => g.tabela)).toEqual([
        "alteracao_catalogo",
        "alteracao_cliente",
        // A peça 21 (0066; docs/33 §4.2).
        "atribuicao_rasto",
        // As correcções da expedição (0086; docs/36 §19).
        "correcao_expedicao",
        "documento_rasto",
        "evento_conta",
        "historico_preco",
        // As recusas da empresa do emissor (0097; docs/29 §19.7).
        "recusa_conta_emissor",
        "transicao_encomenda",
        "transicao_estado",
        "transicao_pagamento",
      ]);
    });
  },
);
