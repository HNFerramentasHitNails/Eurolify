import { sql, type Kysely } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";

// A fila dos pedidos de apagamento (docs/23 §15.3; migração 0066): as
// encomendas que estavam em curso quando o titular pediu o apagamento
// limpam-se quando acabarem. Ex.: a Ana pede o apagamento com uma encomenda
// por expedir; 14 dias depois de entregue, a encomenda passa a concluída e,
// na volta seguinte, perde o contacto e a morada.

export const QUEM_DA_FILA = "sistema:titular";

/** Uma volta: limpa, comerciante a comerciante, as que já acabaram. */
export async function correrApagamentosPendentes(
  db: Kysely<BaseDados>,
  porVolta = 50,
): Promise<number> {
  let limpas = 0;
  const { rows } = await sql<{
    c: string;
  }>`select titular_comerciantes_com_pendentes() as c`.execute(db);
  for (const { c } of rows) {
    // Um comerciante que falhe não pára os outros (como as conclusões).
    try {
      limpas += await comComerciante(db, c, async (trx) => {
        await sql`select set_config('eurolify.quem', ${QUEM_DA_FILA}, true)`.execute(
          trx,
        );
        const { rows: r } = await sql<{
          n: number;
        }>`select titular_pendentes_aplicar(${porVolta}) as n`.execute(trx);
        return r[0]?.n ?? 0;
      });
    } catch {
      continue;
    }
  }
  return limpas;
}

/** De hora a hora (as encomendas concluem-se de hora a hora). */
export function agendarApagamentosPendentes(
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
      correrApagamentosPendentes(base)
        .then((n) => {
          if (n > 0) {
            registo.info({ limpas: n }, "titular: encomendas limpas da fila");
          }
        })
        .catch((erro: unknown) => {
          registo.error(
            { erro: erro instanceof Error ? erro.name : "erro" },
            "titular: a volta da fila de apagamento falhou",
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
