import { sql, type Kysely } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";

// As sessões de checkout sem dados pessoais (docs/23 §15.4; migração 0077):
// 7 dias depois de expirar ou de ser abandonada, a sessão perde o e-mail, o
// nome, o telefone e as moradas. Ex.: a Ana preenche tudo e desiste a 1/10;
// a 8/10 a sessão fica só com o carrinho e o mercado.

export const QUEM_DA_LIMPEZA = "sistema:checkout";

export interface VoltaDaLimpeza {
  limpas: number;
  /** Comerciantes cuja volta falhou, com o nome do erro (sem dados). */
  falhas: { comerciante: string; erro: string }[];
}

/** Uma volta: comerciante a comerciante, até `porVolta` sessões cada. */
export async function correrLimpezaDasSessoes(
  db: Kysely<BaseDados>,
  porVolta = 500,
): Promise<VoltaDaLimpeza> {
  const volta: VoltaDaLimpeza = { limpas: 0, falhas: [] };
  const { rows } = await sql<{
    c: string;
  }>`select checkout_comerciantes_com_sessoes_a_limpar() as c`.execute(db);
  for (const { c } of rows) {
    // Um comerciante que falhe não pára os outros, e fica dito.
    try {
      volta.limpas += await comComerciante(db, c, async (trx) => {
        await sql`select set_config('eurolify.quem', ${QUEM_DA_LIMPEZA}, true)`.execute(
          trx,
        );
        // Repete enquanto vierem cheias, até 20 (um comerciante com muitas
        // sessões não acumula atraso; revisão do #402, P3-4).
        let total = 0;
        for (let i = 0; i < 20; i++) {
          const { rows: x } = await sql<{
            n: number;
          }>`select checkout_sessoes_limpar(${porVolta}) as n`.execute(trx);
          const n = x[0]?.n ?? 0;
          total += n;
          if (n < porVolta) break;
        }
        return total;
      });
    } catch (erro) {
      volta.falhas.push({
        comerciante: c,
        erro: erro instanceof Error ? erro.name : "erro",
      });
    }
  }
  return volta;
}

/** De hora a hora; a primeira volta logo ao arrancar. */
export function agendarLimpezaDasSessoes(
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
    correrLimpezaDasSessoes(base)
      .then((v) => {
        if (v.limpas > 0) {
          registo.info({ limpas: v.limpas }, "checkout: sessões limpas");
        }
        for (const f of v.falhas) {
          registo.error(f, "checkout: a limpeza das sessões falhou");
        }
      })
      .catch((erro: unknown) => {
        registo.error(
          { erro: erro instanceof Error ? erro.name : "erro" },
          "checkout: a volta da limpeza das sessões falhou",
        );
      })
      .finally(() => {
        aCorrer = false;
      });
  };
  volta();
  const t = setInterval(volta, 60 * 60 * 1000);
  t.unref();
  return () => {
    clearInterval(t);
  };
}
