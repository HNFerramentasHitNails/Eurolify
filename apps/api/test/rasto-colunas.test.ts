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

// O rasto de auditoria comum, passo 2 (docs/28 §4; migração 0052; #322): as
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
  "rasto: as colunas do contexto (0052)",
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
      // A conta criada pelo convite (rota sem sessão): canal e pedido, ninguém
      // autenticado a autorizar ainda.
      const criada = await sql<LinhaDoRasto>`
      select canal, pedido, ia, autorizado_por, motivo from evento_conta
      where pessoa_id = ${p.pessoa}::uuid and acto = 'conta_criada'`.execute(
        dono,
      );
      expect(criada.rows).toHaveLength(1);
      expect(criada.rows[0]).toMatchObject({
        canal: "hub",
        ia: null,
        autorizado_por: null,
      });
      expect(criada.rows[0]?.pedido).toMatch(/^[A-Za-z0-9._:-]+$/);
      // Gerar códigos novos (rota com sessão): a pessoa autorizou.
      const r = await h.pedir("POST", "/hub/recovery-codes", {
        sessao: p.sessao,
      });
      expect(r.statusCode, r.body).toBe(201);
      const { rows } = await sql<LinhaDoRasto & { acto: string }>`
      select acto, canal, autorizado_por from evento_conta
      where pessoa_id = ${p.pessoa}::uuid and acto not in ('conta_criada', 'convite_aceite')
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

    it("um motivo com mais de 500 caracteres é recusado antes da base (revisão do #327, P3-8)", async () => {
      await expect(
        mudarEstado(base.api, a, {
          de: "prova_pendente",
          para: "rascunho",
          motivo: "x".repeat(501),
          quem: "operador:github:1",
        }),
      ).rejects.toThrow(/500 caracteres/);
    });
  },
);
