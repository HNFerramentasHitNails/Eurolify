import type { Transaction } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { ErroPrecos } from "./erros.js";

// ------------------------------------- A pergunta da C2 do Catálogo (R4)

export type ImpedimentoDePreco = "prices.market_inactive" | "prices.no_price";

export interface VerificacaoDePreco {
  variante_id: string;
  com_preco: boolean;
  gratuito: boolean;
  impedimento: ImpedimentoDePreco | null;
}

/**
 * A mesma pergunta dentro de uma transacção já aberta no contexto do
 * comerciante: a publicação do Catálogo pergunta-a na sua (docs/14 §5, C2).
 * Os erros saem por traduzir: quem chama traduz-os no seu domínio.
 */
export async function verificarPrecosNa(
  trx: Transaction<BaseDados>,
  mercadoId: string,
  varianteIds: readonly string[],
): Promise<VerificacaoDePreco[]> {
  const mercado = await trx
    .selectFrom("mercado")
    .select("estado")
    .where("id", "=", mercadoId)
    .executeTakeFirst();
  if (mercado === undefined) {
    throw new ErroPrecos("prices.not_found", "mercado inexistente");
  }
  const precos =
    varianteIds.length === 0
      ? []
      : await trx
          .selectFrom("preco")
          .innerJoin("lista_precos", (j) =>
            j
              .onRef("lista_precos.comerciante_id", "=", "preco.comerciante_id")
              .onRef("lista_precos.id", "=", "preco.lista_id"),
          )
          .select(["preco.variante_id", "preco.gratuito"])
          .where("lista_precos.mercado_id", "=", mercadoId)
          .where("lista_precos.tipo", "=", "base")
          .where("lista_precos.estado", "=", "activa")
          .where("preco.variante_id", "in", [...varianteIds])
          .execute();
  const porVariante = new Map(precos.map((p) => [p.variante_id, p.gratuito]));
  return varianteIds.map((variante_id) => {
    const gratuito = porVariante.get(variante_id);
    const com_preco = gratuito !== undefined;
    const impedimento: ImpedimentoDePreco | null =
      mercado.estado !== "activo"
        ? "prices.market_inactive"
        : com_preco
          ? null
          : "prices.no_price";
    return {
      variante_id,
      com_preco,
      gratuito: gratuito ?? false,
      impedimento,
    };
  });
}
