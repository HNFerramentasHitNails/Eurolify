import { sql, type Kysely } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";

// O aviso quando o prazo legal de um pedido do titular passa (docs/23 §15.15,
// A1–A4; migração 0094; Diogo, 13/10/2026: Q-P3 «a»). Ex.: a Ana pediu o
// apagamento a 2/10; o prazo legal era 2/11; a 3/11 o pedido continua aberto
// e, na volta seguinte, os donos da loja recebem um e-mail, uma vez. A regra
// (aberto, sem aviso, o dia de hoje no fuso do comerciante depois do prazo em
// vigor) está na base; aqui só se marca o pedido e a base cria a notificação.

export const QUEM_DA_TAREFA = "sistema:prazos-titular";
const POR_VOLTA = 50;

export interface ResultadoAvisosDoTitular {
  avisados: number;
  /**
   * Os pedidos ou comerciantes cuja vez falhou (`comerciante[/pedido]:
   * código`): não param os outros, mas dizem-se. Sem dados pessoais.
   */
  erros: string[];
}

/** Uma volta: em cada comerciante, os pedidos por avisar (até `porVolta`). */
export async function correrAvisosDoTitular(
  db: Kysely<BaseDados>,
  porVolta = POR_VOLTA,
): Promise<ResultadoAvisosDoTitular> {
  const res: ResultadoAvisosDoTitular = { avisados: 0, erros: [] };
  const { rows } = await sql<{
    c: string;
  }>`select clientes_aviso_prazo_comerciantes() as c`.execute(db);
  for (const { c } of rows) {
    let lista: string[];
    try {
      lista = await comComerciante(db, c, async (trx) =>
        (
          await sql<{
            id: string;
          }>`select x as id from clientes_aviso_prazo_pendentes(${porVolta}) as x`.execute(
            trx,
          )
        ).rows.map((r) => r.id),
      );
    } catch (erro) {
      res.erros.push(`${c}: ${codigoDe(erro)}`);
      continue;
    }
    // Cada pedido na sua transacção: um que falhe não desfaz os outros. A
    // base volta a conferir a regra depois do bloqueio da linha (um pedido
    // fechado ou avisado entretanto não marca).
    for (const id of lista) {
      try {
        const marcou = await comComerciante(db, c, async (trx) => {
          await sql`select set_config('eurolify.quem', ${QUEM_DA_TAREFA}, true)`.execute(
            trx,
          );
          const { rows: r } = await sql<{
            m: boolean;
          }>`select clientes_aviso_prazo_marcar(${id}::uuid) as m`.execute(trx);
          return r[0]?.m === true;
        });
        if (marcou) res.avisados += 1;
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

/** De hora a hora, com a primeira volta pouco depois do arranque. */
export function agendarAvisosDoTitular(
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
    correrAvisosDoTitular(base)
      .then((r) => {
        if (r.erros.length > 0) {
          registo.error(
            { erros: r.erros },
            "titular: avisos do prazo legal com erros",
          );
        }
        if (r.avisados > 0) {
          registo.info(
            { avisados: r.avisados },
            "titular: avisos do prazo legal passado",
          );
        }
      })
      .catch((erro: unknown) => {
        registo.error(
          { erro: erro instanceof Error ? erro.name : "erro" },
          "titular: a volta dos avisos do prazo legal falhou",
        );
      })
      .finally(() => {
        aCorrer = false;
      });
  };
  const t = setInterval(volta, 60 * 60 * 1000);
  t.unref();
  const primeira = setTimeout(volta, 60_000);
  primeira.unref();
  return () => {
    clearInterval(t);
    clearTimeout(primeira);
  };
}
