import { sql, type Kysely } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { ErroPosVenda } from "./erros.js";
import { noPosVenda } from "./repositorio.js";

// O rasto da pós-venda (docs/30 §16; docs/28 §4; migração 0110; issue #480).
// As transições escrevem-nas os gatilhos da base, com o contexto do rasto
// (`rasto_completar()`); aqui só se lêem.

/** O que tem rasto na pós-venda, como o pedem as rotas `…/{id}/timeline`. */
export type AlvoDoRasto = "withdrawal" | "return" | "problem" | "refund";

const DO_ALVO = {
  withdrawal: {
    tabela: "pedido_livre_resolucao",
    entidades: ["pedido_livre_resolucao"],
    erro: "returns.not_found",
    nome: "o pedido de livre resolução",
  },
  // A etiqueta de devolução é da devolução (uma por devolução, 0093).
  return: {
    tabela: "devolucao",
    entidades: ["devolucao", "etiqueta_devolucao"],
    erro: "returns.not_found",
    nome: "a devolução",
  },
  problem: {
    tabela: "problema",
    entidades: ["problema"],
    erro: "returns.not_found",
    nome: "o problema",
  },
  refund: {
    tabela: "reembolso",
    entidades: ["reembolso"],
    erro: "refunds.not_found",
    nome: "o reembolso",
  },
} as const;

/**
 * A linha do tempo de um pedido, de uma devolução (com a etiqueta e as
 * decisões de higiene), de um problema ou de um reembolso: as transições com
 * o rasto comum (docs/28 §1). Só do comerciante da sessão: o RLS esconde o
 * resto, e um id de outro comerciante não existe.
 */
export async function rastoDaPosVenda(
  db: Kysely<BaseDados>,
  c: string,
  alvo: AlvoDoRasto,
  id: string,
) {
  const a = DO_ALVO[alvo];
  return noPosVenda(db, c, async (trx) => {
    const { rows } = await sql<{
      existe: number;
    }>`select 1 as existe from ${sql.table(a.tabela)} where id = ${id}::uuid and comerciante_id = ${c}::uuid`.execute(
      trx,
    );
    if (rows.length === 0) {
      throw new ErroPosVenda(a.erro, `${a.nome} não existe`);
    }
    return trx
      .selectFrom("transicao_posvenda")
      .select([
        "entidade",
        "campo",
        "linha_encomenda_id",
        "de",
        "para",
        "quem",
        "motivo",
        "em",
        "canal",
        "pedido",
        "ia",
        "autorizado_por",
        "a_pedido_de",
      ])
      .where("comerciante_id", "=", c)
      .where("entidade", "in", [...a.entidades])
      .where("entidade_id", "=", id)
      .orderBy("em")
      .orderBy("id")
      .execute();
  });
}
