import { sql, type Kysely } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import {
  aplicarRasto,
  contextoDaTarefa,
  type OrigemDaTarefa,
} from "../base/rasto.js";
import { marcar, noPosVenda } from "./repositorio.js";

// O aviso do prazo do reembolso (R10; docs/30 §14; migração 0062; Diogo,
// 11/10/2026: «aprovado», docs/06, DQ). Uma vez quando faltam 3 dias ou
// menos (`refund.deadline_approaching`), uma vez quando passou
// (`refund.deadline_passed`). O evento põe-no o gatilho da base; aqui só se
// marca a devolução. Sem e-mail até haver notificações (A4).

/** Os dias antes do fim em que se avisa (A3; proposta, não lei). */
export const DIAS_DE_AVISO = 3;
export const QUEM_DA_TAREFA = "sistema:prazos";
const POR_VOLTA = 50;

export interface ResultadoPrazos {
  avisados: number;
  passados: number;
  reagendados: number;
  /** Os comerciantes cuja volta falhou: não pára os outros, mas diz-se. */
  erros: string[];
}

/** Uma volta: os avisos que chegaram à hora, em cada comerciante. */
export async function correrAvisosDePrazo(
  db: Kysely<BaseDados>,
  porVolta = POR_VOLTA,
): Promise<ResultadoPrazos> {
  const res: ResultadoPrazos = {
    avisados: 0,
    passados: 0,
    reagendados: 0,
    erros: [],
  };
  const { rows } = await sql<{
    c: string;
  }>`select posvenda_prazo_comerciantes() as c`.execute(db);
  for (const { c } of rows) {
    // Um comerciante que falhe não pára os outros (como as conclusões).
    try {
      await noPosVenda(db, c, async (trx) => {
        const { rows: lista } = await sql<{
          id: string;
          origem: OrigemDaTarefa | null;
          dias: number | null;
          aviso_prazo_em: Date | null;
        }>`select t as id, tarefa_origem('prazo_reembolso', t) as origem, x.dias,
             d.aviso_prazo_em
           from posvenda_prazo_tarefas(${porVolta}) as t
           join devolucao d on d.id = t
           left join lateral posvenda_prazo_da_devolucao(t) x on true`.execute(
          trx,
        );
        for (const d of lista) {
          // Cada aviso com a origem de quem pediu (docs/28 §3.7).
          await aplicarRasto(trx, contextoDaTarefa("prazos", d.origem));
          await marcar(trx, QUEM_DA_TAREFA);
          if (d.dias !== null && d.dias < 0) {
            // Passou (os dois de uma vez, se a tarefa não correu a tempo:
            // sai só o de passado).
            await trx
              .updateTable("devolucao")
              .set({ prazo_passado_em: new Date() })
              .where("id", "=", d.id)
              .where("prazo_passado_em", "is", null)
              .execute();
            res.passados += 1;
          } else if (
            d.dias !== null &&
            d.dias <= DIAS_DE_AVISO &&
            d.aviso_prazo_em === null
          ) {
            await trx
              .updateTable("devolucao")
              .set({ aviso_prazo_em: new Date() })
              .where("id", "=", d.id)
              .execute();
            res.avisados += 1;
          } else if (d.dias !== null) {
            // Cedo de mais: volta à hora do próximo aviso.
            await sql`select posvenda_prazo_reagendar(${d.id}::uuid)`.execute(
              trx,
            );
            res.reagendados += 1;
          }
        }
      });
    } catch (erro) {
      res.erros.push(erro instanceof Error ? erro.name : "erro");
    }
  }
  return res;
}

export function agendarAvisosDePrazo(
  base: Kysely<BaseDados>,
  registo: {
    info: (o: object, m: string) => void;
    error: (o: object, m: string) => void;
  },
): () => void {
  let aCorrer = false;
  const t = setInterval(
    () => {
      if (aCorrer) return;
      aCorrer = true;
      correrAvisosDePrazo(base)
        .then((r) => {
          if (r.erros.length > 0) {
            registo.error(
              { erros: r.erros },
              "pós-venda: avisos do prazo com erros",
            );
          }
          if (r.avisados + r.passados > 0) {
            registo.info(r, "pós-venda: avisos do prazo do reembolso");
          }
        })
        .catch((erro: unknown) => {
          registo.error(
            { erro: erro instanceof Error ? erro.name : "erro" },
            "pós-venda: a volta dos avisos do prazo falhou",
          );
        })
        .finally(() => {
          aCorrer = false;
        });
    },
    60 * 60 * 1000,
  );
  t.unref();
  return () => {
    clearInterval(t);
  };
}
