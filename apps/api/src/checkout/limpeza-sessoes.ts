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
  /** Carrinhos expirados apagados (docs/25 §14; migração 0109). */
  carrinhos: number;
  /** Comerciantes cuja volta falhou, com o nome do erro (sem dados). */
  falhas: {
    tarefa: "sessoes" | "carrinhos";
    comerciante: string;
    erro: string;
  }[];
}

/** Uma volta: comerciante a comerciante, até `porVolta` sessões cada. */
export async function correrLimpezaDasSessoes(
  db: Kysely<BaseDados>,
  porVolta = 500,
): Promise<VoltaDaLimpeza> {
  const volta: VoltaDaLimpeza = { limpas: 0, carrinhos: 0, falhas: [] };
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
        tarefa: "sessoes",
        comerciante: c,
        erro: erro instanceof Error ? erro.name : "erro",
      });
    }
  }
  await correrLimpezaDosCarrinhos(db, volta, porVolta);
  return volta;
}

/**
 * Os carrinhos abertos que expiraram há mais de 7 dias e nunca tiveram
 * sessão (docs/25 §14), comerciante a comerciante, na mesma volta. Um
 * comerciante que falhe não pára os outros.
 */
async function correrLimpezaDosCarrinhos(
  db: Kysely<BaseDados>,
  volta: VoltaDaLimpeza,
  porVolta: number,
) {
  const { rows } = await sql<{
    c: string;
  }>`select checkout_comerciantes_com_carrinhos_a_limpar() as c`.execute(db);
  for (const { c } of rows) {
    try {
      volta.carrinhos += await comComerciante(db, c, async (trx) => {
        await sql`select set_config('eurolify.quem', ${QUEM_DA_LIMPEZA}, true)`.execute(
          trx,
        );
        let total = 0;
        for (let i = 0; i < 20; i++) {
          const { rows: x } = await sql<{
            n: number;
          }>`select checkout_carrinhos_limpar(${porVolta}) as n`.execute(trx);
          const n = x[0]?.n ?? 0;
          total += n;
          if (n < porVolta) break;
        }
        return total;
      });
    } catch (erro) {
      volta.falhas.push({
        tarefa: "carrinhos",
        comerciante: c,
        erro: erro instanceof Error ? erro.name : "erro",
      });
    }
  }
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
        if (v.carrinhos > 0) {
          registo.info(
            { carrinhos: v.carrinhos },
            "checkout: carrinhos expirados apagados",
          );
        }
        for (const f of v.falhas) {
          registo.error(
            f,
            f.tarefa === "sessoes"
              ? "checkout: a limpeza das sessões falhou"
              : "checkout: a limpeza dos carrinhos falhou",
          );
        }
      })
      .catch((erro: unknown) => {
        registo.error(
          { erro: erro instanceof Error ? erro.name : "erro" },
          "checkout: a volta da limpeza das sessões e dos carrinhos falhou",
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
