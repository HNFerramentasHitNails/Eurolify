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
 * lêem-se na mesma transacção REPEATABLE READ: batem sempre certo entre si
 * (revisão do #150, P3-5; docs/18 §2a).
 */
export async function listarArtigos(
  db: Kysely<BaseDados>,
  comercianteId: string,
  filtro: FiltroDeArtigos,
  limite: number,
  depois: string | null,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
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
    },
    { soLeitura: true },
  );
}

/** A ficha de um artigo, com todas as variantes (também as arquivadas). */
export async function fichaDoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
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
    },
    { soLeitura: true },
  );
}

/** Os ids dos valores das opções de cada variante dada (por variante). */
async function valoresDas(
  trx: Kysely<BaseDados>,
  comercianteId: string,
  varianteIds: readonly string[],
): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>(varianteIds.map((id) => [id, []]));
  if (varianteIds.length === 0) return mapa;
  const linhas = await trx
    .selectFrom("variante_valor")
    .select(["variante_id", "valor_id"])
    .where("comerciante_id", "=", comercianteId)
    .where("variante_id", "in", varianteIds)
    .orderBy("valor_id")
    .execute();
  for (const l of linhas) mapa.get(l.variante_id)?.push(l.valor_id);
  return mapa;
}

/**
 * As variantes de um artigo (também as arquivadas), por posição e SKU, com os
 * valores das opções. Um artigo que não existe (ou de outro comerciante) é
 * `catalog.not_found`, não uma lista vazia.
 */
export async function variantesDoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const artigo = await trx
        .selectFrom("artigo")
        .select("id")
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
      const valores = await valoresDas(
        trx,
        comercianteId,
        variantes.map((v) => v.id),
      );
      return variantes.map((v) => ({ ...v, valores: valores.get(v.id) ?? [] }));
    },
    { soLeitura: true },
  );
}

/** Uma variante, com os valores das opções. */
export async function fichaDaVariante(
  db: Kysely<BaseDados>,
  comercianteId: string,
  varianteId: string,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const variante = await trx
        .selectFrom("variante")
        .selectAll()
        .where("id", "=", varianteId)
        .executeTakeFirst();
      if (variante === undefined) {
        throw new ErroCatalogo("catalog.not_found", `variante ${varianteId}`);
      }
      const valores = await valoresDas(trx, comercianteId, [variante.id]);
      return { ...variante, valores: valores.get(variante.id) ?? [] };
    },
    { soLeitura: true },
  );
}

/**
 * Procura uma variante pelo SKU (sem distinguir maiúsculas, P9) ou pelo GTIN
 * (o mesmo código em 8, 12, 13 ou 14 dígitos com zeros à esquerda, C4), também
 * arquivada: os dois são únicos por comerciante, por isso a lista tem uma ou
 * nenhuma. O comerciante vai explícito, além do RLS, para os índices servirem
 * (revisão do #80, P2-1).
 */
export async function procurarVariantes(
  db: Kysely<BaseDados>,
  comercianteId: string,
  filtro: { sku: string } | { gtin: string },
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      let consulta = trx
        .selectFrom("variante")
        .selectAll()
        .where("comerciante_id", "=", comercianteId);
      consulta =
        "sku" in filtro
          ? consulta.where(
              sql<string>`lower(sku)`,
              "=",
              sql<string>`lower(${filtro.sku})`,
            )
          : consulta
              .where("gtin", "is not", null)
              .where(
                sql<string>`lpad(gtin, 14, '0')`,
                "=",
                sql<string>`lpad(${filtro.gtin}, 14, '0')`,
              );
      const variantes = await consulta.execute();
      const valores = await valoresDas(
        trx,
        comercianteId,
        variantes.map((v) => v.id),
      );
      return variantes.map((v) => ({ ...v, valores: valores.get(v.id) ?? [] }));
    },
    { soLeitura: true },
  );
}
