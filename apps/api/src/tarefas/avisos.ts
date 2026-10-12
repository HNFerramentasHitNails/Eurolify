import { sql, type Kysely } from "kysely";
import type { BaseDados, FilaTarefa } from "../base/esquema.js";
import { aplicarRasto, contextoDaTarefa } from "../base/rasto.js";
import { comComerciante } from "../comerciante/repositorio.js";

// O aviso de vencido (docs/33 R6; migração 0066; decisão DW): de hora a
// hora, os casos abertos cujo prazo passou ganham o aviso, uma vez por
// prazo — a marca na atribuição e o evento `task.overdue` (o gatilho da
// base). O prazo do reembolso fica de fora: tem os avisos da pós-venda
// (0063). O e-mail sai pela fila das notificações: o gatilho da linha
// `vencida` grava-o (migração 0071; docs/34 §12; decisão EB).

export const QUEM_DA_TAREFA = "sistema:tarefas";
const POR_VOLTA = 50;

export interface ResultadoAvisos {
  avisados: number;
  /** Os casos cuja vez falhou (`comerciante/fila/caso: código`): não param os outros. */
  erros: string[];
}

export async function correrAvisosDeTarefas(
  db: Kysely<BaseDados>,
  porVolta = POR_VOLTA,
): Promise<ResultadoAvisos> {
  const res: ResultadoAvisos = { avisados: 0, erros: [] };
  const { rows } = await sql<{
    c: string;
  }>`select tarefas_comerciantes() as c`.execute(db);
  for (const { c } of rows) {
    let lista: { fila: FilaTarefa; caso: string }[];
    try {
      lista = await comComerciante(
        db,
        c,
        async (trx) =>
          (
            await sql<{
              fila: FilaTarefa;
              caso: string;
            }>`select x.fila, x.caso from tarefas_por_avisar(${porVolta}) x`.execute(
              trx,
            )
          ).rows,
        { soLeitura: true },
      );
    } catch (erro) {
      res.erros.push(`${c}: ${codigoDe(erro)}`);
      continue;
    }
    // Cada caso na sua transacção: um que falhe não desfaz os outros.
    for (const { fila, caso } of lista) {
      try {
        await comComerciante(db, c, async (trx) => {
          await aplicarRasto(trx, contextoDaTarefa("tarefas", null));
          await sql`select set_config('eurolify.quem', ${QUEM_DA_TAREFA}, true)`.execute(
            trx,
          );
          const r = await sql<{
            marcado: boolean;
          }>`select tarefas_marcar_vencida(${fila}, ${caso}::uuid) as marcado`.execute(
            trx,
          );
          if (r.rows[0]?.marcado === true) res.avisados += 1;
        });
      } catch (erro) {
        res.erros.push(`${c}/${fila}/${caso}: ${codigoDe(erro)}`);
      }
    }
  }
  return res;
}

const codigoDe = (erro: unknown) =>
  erro instanceof Error
    ? (/^[a-z_]+\.[a-z_]+/.exec(erro.message)?.[0] ?? erro.name)
    : "erro";

export function agendarAvisosDeTarefas(
  base: Kysely<BaseDados>,
  registo: {
    info: (o: object, m: string) => void;
    error: (o: object, m: string) => void;
  },
): () => void {
  let aCorrer = false;
  const volta = () => {
    if (aCorrer) return;
    aCorrer = true;
    correrAvisosDeTarefas(base)
      .then((r) => {
        if (r.erros.length > 0) {
          registo.error({ erros: r.erros }, "tarefas: avisos com erros");
        }
        if (r.avisados > 0) {
          registo.info(r, "tarefas: avisos de vencido");
        }
      })
      .catch((erro: unknown) => {
        registo.error(
          { erro: erro instanceof Error ? erro.name : "erro" },
          "tarefas: a volta dos avisos falhou",
        );
      })
      .finally(() => {
        aCorrer = false;
      });
  };
  const t = setInterval(volta, 60 * 60 * 1000);
  t.unref();
  // A primeira volta pouco depois do arranque, não uma hora depois.
  const primeira = setTimeout(volta, 90_000);
  primeira.unref();
  return () => {
    clearInterval(t);
    clearTimeout(primeira);
  };
}
