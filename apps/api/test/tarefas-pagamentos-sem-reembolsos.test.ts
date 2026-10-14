import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import { correrAvisosDeTarefas } from "../src/tarefas/avisos.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// O reembolso incerto uma vez só em «A decidir» (migração 0106; Diogo,
// 14/10/2026, Q3 A; docs/22 §34): a fila `pagamento` deixa de ter as
// diferenças `reembolso_incerto` (o reembolso decide-se na fila `reembolso`);
// as outras continuam. Os casos entram pela base em modo `replica`, como em
// `tarefas-api.test.ts`.

interface Tarefa {
  fila: string;
  caso: string;
  motivo: string;
  responsavel: string | null;
}

describe.skipIf(URL_BASE === undefined)(
  "A fila de pagamentos sem o reembolso incerto",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let c = "";
    let chave = "";
    const dono = randomUUID();
    const casos = {
      incerto: randomUUID(),
      montante: randomUUID(),
      reembolsoIncerto: randomUUID(),
      porConfirmar: randomUUID(),
      desconhecido: randomUUID(),
      atribuido: randomUUID(),
    };

    const comoDono = (fn: (t: Transaction<unknown>) => Promise<unknown>) =>
      base.dono.transaction().execute(async (trx) => {
        await sql`set local session_replication_role = replica`.execute(trx);
        await fn(trx);
      });
    const fila = async () => {
      const r = await app.inject({
        method: "GET",
        url: "/tasks?fila=pagamento",
        headers: { authorization: `Bearer ${chave}` },
      });
      expect(r.statusCode, r.body).toBe(200);
      return r.json<{ dados: Tarefa[]; totais: Record<string, number> }>();
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
      );
      c = await registarComerciante(base.api, {
        nome: "Loja A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      chave = (
        await criarChave(base.dono, c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "Tudo",
          ambitos: ["payments:read", "payments:resolve", "tasks:assign"],
        })
      ).segredo;
      await comoDono(async (t) => {
        await sql`insert into pessoa (id, email, nome)
          values (${dono}, ${`${dono}@exemplo.pt`}, 'Pessoa')`.execute(t);
        await sql`insert into membro (id, comerciante_id, pessoa_id, papel, convidado_por)
          values (${randomUUID()}, ${c}, ${dono}, 'dono', 'operador:teste')`.execute(
          t,
        );
        for (const [id, motivo] of [
          [casos.incerto, "incerto"],
          [casos.montante, "montante_diferente"],
          [casos.reembolsoIncerto, "reembolso_incerto"],
          [casos.porConfirmar, "reembolso_por_confirmar"],
          [casos.desconhecido, "reembolso_desconhecido"],
          [casos.atribuido, "incerto"],
        ] as const) {
          await sql`insert into diferenca_pagamento (id, comerciante_id, motivo, criada_em)
            values (${id}, ${c}, ${motivo}, now() - interval '2 days')`.execute(
            t,
          );
        }
      });
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await base.fechar();
    });

    it("o reembolso incerto não aparece na fila; os outros motivos sim", async () => {
      const l = await fila();
      const ids = l.dados.map((x) => x.caso.replace(/^pdi_/, ""));
      // O reembolso incerto decide-se na fila do reembolso.
      expect(ids).not.toContain(casos.reembolsoIncerto);
      // Um pagamento incerto e um montante diferente continuam.
      expect(ids).toContain(casos.incerto);
      expect(ids).toContain(casos.montante);
      // Estes dois NÃO têm um reembolso incerto ou falhado a substituí-los na
      // fila `reembolso` (0106, desvio explicado): ficam.
      expect(ids).toContain(casos.porConfirmar);
      expect(ids).toContain(casos.desconhecido);
      expect(l.totais["pagamento"]).toBe(5);
    });

    it("a diferença continua na tabela, aberta (o ecrã do Hub lê-a de lá)", async () => {
      const { rows } = await sql<{ estado: string }>`
        select estado from diferenca_pagamento where id = ${casos.reembolsoIncerto}`.execute(
        base.dono,
      );
      expect(rows[0]?.estado).toBe("aberta");
    });

    it("uma atribuição já aberta de um caso que sai da fila fica guardada, sem efeito e sem aviso", async () => {
      const url = `/tasks/pagamento/pdi_${casos.atribuido}`;
      const r = await app.inject({
        method: "POST",
        url: `${url}/assign`,
        headers: {
          authorization: `Bearer ${chave}`,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
        },
        payload: JSON.stringify({ responsavel: `per_${dono}`, versao: 0 }),
      });
      expect(r.statusCode, r.body).toBe(200);
      expect((await fila()).dados.map((x) => x.caso)).toContain(
        `pdi_${casos.atribuido}`,
      );
      // O caso passa a reembolso incerto (como se a migração chegasse com a
      // atribuição já aberta).
      await comoDono(async (t) => {
        // O gatilho ALWAYS não deixa mudar o motivo: desliga-se só aqui.
        await sql`alter table diferenca_pagamento
          disable trigger diferenca_pagamento_antes_de_gravar`.execute(t);
        await sql`update diferenca_pagamento set motivo = 'reembolso_incerto'
          where id = ${casos.atribuido}`.execute(t);
        await sql`alter table diferenca_pagamento
          enable always trigger diferenca_pagamento_antes_de_gravar`.execute(t);
      });
      expect((await fila()).dados.map((x) => x.caso)).not.toContain(
        `pdi_${casos.atribuido}`,
      );
      const { rows } = await sql<{ responsavel: string | null; n: number }>`
        select a.responsavel, (select count(*)::int from atribuicao_rasto r
          where r.atribuicao_id = a.id) as n
        from atribuicao a where a.caso = ${casos.atribuido}`.execute(base.dono);
      // A linha e o rasto ficam como estavam.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.responsavel).toBe(dono);
      expect(rows[0]?.n).toBe(1);
      // Sem caso na fila, sem aviso de vencido para ele nem para o
      // reembolso incerto (os outros casos, velhos, avisam).
      const av = await correrAvisosDeTarefas(base.api);
      expect(av.erros).toEqual([]);
      const { rows: avisos } = await sql<{ n: number }>`
        select count(*)::int as n from atribuicao_rasto r
        join atribuicao a on a.id = r.atribuicao_id
        where r.acto = 'vencida' and a.caso in (${casos.atribuido}, ${casos.reembolsoIncerto})`.execute(
        base.dono,
      );
      expect(avisos[0]?.n).toBe(0);
    });
  },
);
