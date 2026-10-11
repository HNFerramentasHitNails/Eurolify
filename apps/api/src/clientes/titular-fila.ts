import { sql, type Kysely } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";

// A fila dos pedidos de apagamento (docs/23 §15.3; migração 0066): as
// encomendas que estavam em curso quando o titular pediu o apagamento
// limpam-se quando acabarem. Ex.: a Ana pede o apagamento com uma encomenda
// por expedir; 14 dias depois de entregue, a encomenda passa a concluída e,
// na volta seguinte, perde o contacto e a morada.

export const QUEM_DA_FILA = "sistema:titular";

export interface VoltaDaFila {
  limpas: number;
  /** Comerciantes com encomendas que falharam, com o código do erro. */
  falhas: { comerciante: string; falhas: number; erro: string | null }[];
}

/** Uma volta: limpa, comerciante a comerciante, as que já acabaram. */
export async function correrApagamentosPendentes(
  db: Kysely<BaseDados>,
  porVolta = 50,
): Promise<VoltaDaFila> {
  const volta: VoltaDaFila = { limpas: 0, falhas: [] };
  const { rows } = await sql<{
    c: string;
  }>`select titular_comerciantes_com_pendentes() as c`.execute(db);
  for (const { c } of rows) {
    // Um comerciante que falhe não pára os outros, e fica dito (revisão do
    // #374, P2-4). Cada encomenda corre à parte dentro da base.
    try {
      const r = await comComerciante(db, c, async (trx) => {
        await sql`select set_config('eurolify.quem', ${QUEM_DA_FILA}, true)`.execute(
          trx,
        );
        const { rows: x } = await sql<{
          r: { limpas: number; falhas: number; erro: string | null };
        }>`select titular_pendentes_aplicar(${porVolta}) as r`.execute(trx);
        return x[0]?.r ?? { limpas: 0, falhas: 0, erro: null };
      });
      volta.limpas += r.limpas;
      if (r.falhas > 0) {
        volta.falhas.push({ comerciante: c, falhas: r.falhas, erro: r.erro });
      }
    } catch (erro) {
      volta.falhas.push({
        comerciante: c,
        falhas: 1,
        erro: erro instanceof Error ? erro.name : "erro",
      });
    }
  }
  return volta;
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
        .then((v) => {
          if (v.limpas > 0) {
            registo.info(
              { limpas: v.limpas },
              "titular: encomendas limpas da fila",
            );
          }
          // Sem dados pessoais: o comerciante e o código do erro.
          for (const f of v.falhas) {
            registo.error(f, "titular: encomendas da fila que falharam");
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
