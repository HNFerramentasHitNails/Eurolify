import { sql, type Kysely } from "kysely";
import type { BaseDados, EstadoArtigo, TipoArtigo } from "../base/esquema.js";
import { ErroCatalogo, noCatalogo } from "./erros.js";

// Consultas do Catálogo para a API de Administração (docs/14 §7.1; docs/18
// §2a, listas). Só leem, sempre no contexto do comerciante da chave (RLS): um
// artigo de outro comerciante é «não existe».

export interface FiltroDeArtigos {
  estado?: EstadoArtigo;
  tipo?: TipoArtigo;
  /** O SKU de uma das variantes, sem distinguir maiúsculas (P9). */
  sku?: string;
  /** Parte do nome, sem distinguir maiúsculas. */
  texto?: string;
}

export interface PaginaDeArtigos<T> {
  dados: T[];
  /** Quantos artigos passam no filtro, todos e não só os desta página. */
  total: number;
  /** O id do último desta página, se houver mais (para o cursor). */
  ultimo: string | null;
}

/** `%`, `_` e `\` contam como letras na procura por parte do nome. */
function semCuringas(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Uma página de artigos por ordem do id (uuid v7: a ordem de criação), a
 * seguir a `depois`, e o total dos que passam no filtro (headless-commerce,
 * regra 4; lição 4.7: nenhuma lista cortada em silêncio). O total e a página
 * são duas leituras: com escritas ao mesmo tempo, podem não bater certo por
 * um ou dois (docs/18 §2a).
 */
export async function listarArtigos(
  db: Kysely<BaseDados>,
  comercianteId: string,
  filtro: FiltroDeArtigos,
  limite: number,
  depois: string | null,
) {
  return noCatalogo(db, comercianteId, async (trx) => {
    let consulta = trx.selectFrom("artigo");
    if (filtro.estado !== undefined) {
      consulta = consulta.where("estado", "=", filtro.estado);
    }
    if (filtro.tipo !== undefined) {
      consulta = consulta.where("tipo", "=", filtro.tipo);
    }
    if (filtro.texto !== undefined) {
      const padrao = `%${semCuringas(filtro.texto)}%`;
      consulta = consulta.where(sql<boolean>`nome ilike ${padrao}`);
    }
    if (filtro.sku !== undefined) {
      const sku = filtro.sku;
      consulta = consulta.where((eb) =>
        eb.exists(
          eb
            .selectFrom("variante as v")
            .select("v.id")
            .whereRef("v.artigo_id", "=", "artigo.id")
            .where(sql<boolean>`lower(v.sku) = lower(${sku})`),
        ),
      );
    }
    const { total } = await consulta
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirstOrThrow();
    let pagina = consulta.selectAll("artigo");
    if (depois !== null) pagina = pagina.where("artigo.id", ">", depois);
    const linhas = await pagina
      .orderBy("artigo.id")
      .limit(limite + 1)
      .execute();
    const haMais = linhas.length > limite;
    const dados = haMais ? linhas.slice(0, limite) : linhas;
    const ultimo = haMais ? (dados.at(-1)?.id ?? null) : null;
    return { dados, total: Number(total), ultimo };
  });
}

/** A ficha de um artigo, com todas as variantes (também as arquivadas). */
export async function fichaDoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
) {
  return noCatalogo(db, comercianteId, async (trx) => {
    const artigo = await trx
      .selectFrom("artigo")
      .selectAll()
      .where("id", "=", artigoId)
      .executeTakeFirst();
    if (artigo === undefined) {
      throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
    }
    const variantes = await trx
      .selectFrom("variante")
      .selectAll()
      .where("artigo_id", "=", artigoId)
      .orderBy("posicao")
      .orderBy("sku")
      .execute();
    return { artigo, variantes };
  });
}
