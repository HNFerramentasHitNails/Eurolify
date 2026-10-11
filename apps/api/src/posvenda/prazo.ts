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

export const QUEM_DA_TAREFA = "sistema:prazos";
const POR_VOLTA = 50;

export interface ResultadoPrazos {
  avisados: number;
  passados: number;
  reagendados: number;
  /**
   * As devoluções cuja vez falhou (`comerciante/devolução: código`): não
   * param as outras, mas dizem-se (revisão do #353, P3-3).
   */
  erros: string[];
}

/**
 * Uma volta: os avisos que chegaram à hora, em cada comerciante. A regra (o
 * prazo, o limiar dos 3 dias, a devolução ainda à espera) está na base
 * (`posvenda_prazo_da_devolucao`), que também recusa um aviso fora de hora.
 */
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
    let lista: { id: string; origem: OrigemDaTarefa | null }[];
    try {
      lista = await noPosVenda(
        db,
        c,
        async (trx) =>
          (
            await sql<{
              id: string;
              origem: OrigemDaTarefa | null;
            }>`select t as id, tarefa_origem('prazo_reembolso', t) as origem
             from posvenda_prazo_tarefas(${porVolta}) as t`.execute(trx)
          ).rows,
      );
    } catch (erro) {
      res.erros.push(`${c}: ${codigoDe(erro)}`);
      continue;
    }
    // Cada devolução na sua transacção: uma que falhe não desfaz as outras.
    for (const { id, origem } of lista) {
      try {
        await noPosVenda(db, c, async (trx) => {
          // Com a origem de quem pediu (docs/28 §3.7).
          await aplicarRasto(trx, contextoDaTarefa("prazos", origem));
          await marcar(trx, QUEM_DA_TAREFA);
          const prazo = (
            await sql<{
              dias: number | null;
              a_avisar: boolean;
            }>`select x.dias, x.a_avisar
               from posvenda_prazo_da_devolucao(${id}::uuid) x`.execute(trx)
          ).rows[0];
          // O `where` volta a conferir depois do bloqueio da linha: uma
          // devolução cancelada ou fechada entretanto, ou outra volta ao
          // mesmo tempo, não marca nada (revisão do #353, P2-1 e P2-2).
          if (
            prazo?.dias !== null &&
            prazo?.dias !== undefined &&
            prazo.dias < 0
          ) {
            // Passou (se a tarefa não correu a tempo do primeiro, sai só o
            // de passado).
            const r = await trx
              .updateTable("devolucao")
              .set({ prazo_passado_em: sql<Date>`now()` })
              .where("id", "=", id)
              .where("estado", "not in", ["fechada", "cancelada"])
              .where("prazo_passado_em", "is", null)
              .executeTakeFirst();
            res.passados += Number(r.numUpdatedRows);
          } else if (prazo?.a_avisar === true) {
            const r = await trx
              .updateTable("devolucao")
              .set({ aviso_prazo_em: sql<Date>`now()` })
              .where("id", "=", id)
              .where("estado", "not in", ["fechada", "cancelada"])
              .where("aviso_prazo_em", "is", null)
              .executeTakeFirst();
            res.avisados += Number(r.numUpdatedRows);
            if (Number(r.numUpdatedRows) === 0) {
              await sql`select posvenda_prazo_reagendar(${id}::uuid)`.execute(
                trx,
              );
            }
          } else {
            // Cedo de mais (ou já sem hora): volta à hora do próximo aviso.
            await sql`select posvenda_prazo_reagendar(${id}::uuid)`.execute(
              trx,
            );
            res.reagendados += 1;
          }
        });
      } catch (erro) {
        res.erros.push(`${c}/${id}: ${codigoDe(erro)}`);
      }
    }
  }
  return res;
}

const codigoDe = (erro: unknown) =>
  erro instanceof Error
    ? (/^[a-z_]+\.[a-z_]+/.exec(erro.message)?.[0] ?? erro.name)
    : "erro";

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
  // A primeira volta pouco depois do arranque, não uma hora depois (P3-8).
  const primeira = setTimeout(() => {
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
      })
      .catch(() => undefined)
      .finally(() => {
        aCorrer = false;
      });
  }, 60_000);
  primeira.unref();
  return () => {
    clearInterval(t);
    clearTimeout(primeira);
  };
}
