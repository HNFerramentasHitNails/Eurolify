import { sql, type Kysely, type RawBuilder } from "kysely";
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
  /** Numa categoria (só nela, não nas subcategorias); tem de existir. */
  categoria?: string;
  /**
   * Com o nome ou a descrição por traduzir nesta língua (em falta ou
   * desactualizada), com a mesma regra da fila de traduções.
   */
  traducaoEmFalta?: string;
  /**
   * Alterados (`actualizado_em`) a partir deste instante, inclusive. O texto
   * ISO 8601 tal como veio: a base lê-o com os microssegundos (um `Date`
   * cortava-os ao milissegundo).
   */
  actualizadoDesde?: string;
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
      let consulta = trx
        .selectFrom("artigo")
        .where("artigo.comerciante_id", "=", comercianteId);
      if (filtro.categoria !== undefined) {
        // Uma categoria que não existe (ou de outro comerciante) é «não
        // existe», não uma lista vazia: um id mal copiado não passa por
        // «nenhum artigo».
        const categoria = await trx
          .selectFrom("categoria")
          .select("id")
          .where("comerciante_id", "=", comercianteId)
          .where("id", "=", filtro.categoria)
          .executeTakeFirst();
        if (categoria === undefined) {
          throw new ErroCatalogo(
            "catalog.not_found",
            `categoria ${filtro.categoria}`,
          );
        }
        const categoriaId = filtro.categoria;
        consulta = consulta.where((eb) =>
          eb.exists(
            eb
              .selectFrom("artigo_categoria as ac")
              .select("ac.artigo_id")
              .whereRef("ac.comerciante_id", "=", "artigo.comerciante_id")
              .whereRef("ac.artigo_id", "=", "artigo.id")
              .where("ac.categoria_id", "=", categoriaId),
          ),
        );
      }
      if (filtro.traducaoEmFalta !== undefined) {
        const lingua = filtro.traducaoEmFalta;
        await naoELinguaDeOrigem(trx, comercianteId, lingua);
        consulta = consulta.where(
          sql<boolean>`exists (
            select from texto_original o
            left join traducao t
              on t.comerciante_id = o.comerciante_id
             and t.recurso_id = o.recurso_id
             and t.campo = o.campo
             and t.lingua = ${lingua}
            where o.comerciante_id = artigo.comerciante_id
              and o.tipo = 'artigo'
              and o.recurso_id = artigo.id
              and ${porTraduzir(["em_falta", "desactualizada"])})`,
        );
      }
      if (filtro.actualizadoDesde !== undefined) {
        consulta = consulta.where(
          sql<boolean>`artigo.actualizado_em >= ${filtro.actualizadoDesde}::timestamptz`,
        );
      }
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
  // Pela ordem das opções do artigo (posição, depois id): com Cor e Tamanho,
  // a cor vem sempre primeiro (revisão do #159, P3-2).
  const linhas = await trx
    .selectFrom("variante_valor as vv")
    .innerJoin("opcao as o", (j) =>
      j
        .onRef("o.id", "=", "vv.opcao_id")
        .onRef("o.comerciante_id", "=", "vv.comerciante_id"),
    )
    .select(["vv.variante_id", "vv.valor_id"])
    .where("vv.comerciante_id", "=", comercianteId)
    .where("vv.variante_id", "in", varianteIds)
    .orderBy("o.posicao")
    .orderBy("o.id")
    .execute();
  for (const l of linhas) mapa.get(l.variante_id)?.push(l.valor_id);
  return mapa;
}

/** Onde a página anterior acabou: a ordem da lista é (posição, SKU, id). */
export interface PosicaoNaLista {
  posicao: number;
  sku: string;
  id: string;
}

/**
 * Uma página das variantes de um artigo (também as arquivadas), por posição,
 * SKU e id, com os valores das opções e o total (docs/18 §2a; revisão do
 * #159, P2-1). Um artigo que não existe (ou de outro comerciante) é
 * `catalog.not_found`, não uma lista vazia.
 */
export async function variantesDoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  limite: number,
  depois: PosicaoNaLista | null,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const artigo = await trx
        .selectFrom("artigo")
        .select("id")
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", artigoId)
        .executeTakeFirst();
      if (artigo === undefined) {
        throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
      }
      const doArtigo = trx
        .selectFrom("variante")
        .where("comerciante_id", "=", comercianteId)
        .where("artigo_id", "=", artigoId);
      const { total } = await doArtigo
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow();
      let pagina = doArtigo.selectAll();
      if (depois !== null) {
        pagina = pagina.where(
          sql<boolean>`(posicao, sku, id) > (${depois.posicao}::int, ${depois.sku}::text, ${depois.id}::uuid)`,
        );
      }
      const linhas = await pagina
        .orderBy("posicao")
        .orderBy("sku")
        .orderBy("id")
        .limit(limite + 1)
        .execute();
      const haMais = linhas.length > limite;
      const variantes = haMais ? linhas.slice(0, limite) : linhas;
      const ultima = haMais ? variantes.at(-1) : undefined;
      const valores = await valoresDas(
        trx,
        comercianteId,
        variantes.map((v) => v.id),
      );
      return {
        dados: variantes.map((v) => ({
          ...v,
          valores: valores.get(v.id) ?? [],
        })),
        total: Number(total),
        ultima:
          ultima === undefined
            ? null
            : { posicao: ultima.posicao, sku: ultima.sku, id: ultima.id },
      };
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
        .where("comerciante_id", "=", comercianteId)
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

/** Onde a página anterior acabou, numa lista ordenada por (posição, id). */
export interface PosicaoEId {
  posicao: number;
  id: string;
}

/** Os valores das opções dadas, pela posição (e id), agrupados por opção. */
async function valoresDasOpcoes(
  trx: Kysely<BaseDados>,
  comercianteId: string,
  opcaoIds: readonly string[],
): Promise<Map<string, { id: string; valor: string }[]>> {
  const mapa = new Map<string, { id: string; valor: string }[]>(
    opcaoIds.map((id) => [id, []]),
  );
  if (opcaoIds.length === 0) return mapa;
  const linhas = await trx
    .selectFrom("valor_opcao")
    .select(["id", "opcao_id", "valor"])
    .where("comerciante_id", "=", comercianteId)
    .where("opcao_id", "in", opcaoIds)
    .orderBy("posicao")
    .orderBy("id")
    .execute();
  for (const l of linhas) {
    mapa.get(l.opcao_id)?.push({ id: l.id, valor: l.valor });
  }
  return mapa;
}

/**
 * Uma página das opções do artigo, por posição e id, cada uma com os valores
 * todos (docs/18 §2a). Artigo inexistente (ou de outro comerciante) é
 * `catalog.not_found`.
 */
export async function opcoesDoArtigoPaginadas(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  limite: number,
  depois: PosicaoEId | null,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const artigo = await trx
        .selectFrom("artigo")
        .select("id")
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", artigoId)
        .executeTakeFirst();
      if (artigo === undefined) {
        throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
      }
      const doArtigo = trx
        .selectFrom("opcao")
        .where("comerciante_id", "=", comercianteId)
        .where("artigo_id", "=", artigoId);
      const { total } = await doArtigo
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow();
      let pagina = doArtigo.select(["id", "nome", "posicao", "artigo_id"]);
      if (depois !== null) {
        pagina = pagina.where(
          sql<boolean>`(posicao, id) > (${depois.posicao}::int, ${depois.id}::uuid)`,
        );
      }
      const linhas = await pagina
        .orderBy("posicao")
        .orderBy("id")
        .limit(limite + 1)
        .execute();
      const haMais = linhas.length > limite;
      const opcoes = haMais ? linhas.slice(0, limite) : linhas;
      const ultima = haMais ? opcoes.at(-1) : undefined;
      const valores = await valoresDasOpcoes(
        trx,
        comercianteId,
        opcoes.map((o) => o.id),
      );
      return {
        dados: opcoes.map((o) => ({ ...o, valores: valores.get(o.id) ?? [] })),
        total: Number(total),
        ultima:
          ultima === undefined
            ? null
            : { posicao: ultima.posicao, id: ultima.id },
      };
    },
    { soLeitura: true },
  );
}

/** Uma opção, com o artigo e os valores todos. */
export async function fichaDaOpcao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  opcaoId: string,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const opcao = await trx
        .selectFrom("opcao")
        .select(["id", "nome", "posicao", "artigo_id"])
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", opcaoId)
        .executeTakeFirst();
      if (opcao === undefined) {
        throw new ErroCatalogo("catalog.not_found", `opção ${opcaoId}`);
      }
      const valores = await valoresDasOpcoes(trx, comercianteId, [opcao.id]);
      return { ...opcao, valores: valores.get(opcao.id) ?? [] };
    },
    { soLeitura: true },
  );
}

/**
 * Uma página da composição do kit, pela ordem (posição) e pelo id do
 * componente. Vazia se a variante não é kit; variante inexistente (ou de
 * outro comerciante) é `catalog.not_found`.
 */
export async function composicaoDoKit(
  db: Kysely<BaseDados>,
  comercianteId: string,
  kitId: string,
  limite: number,
  depois: PosicaoEId | null,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const kit = await trx
        .selectFrom("variante")
        .select("id")
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", kitId)
        .executeTakeFirst();
      if (kit === undefined) {
        throw new ErroCatalogo("catalog.not_found", `variante ${kitId}`);
      }
      const doKit = trx
        .selectFrom("componente as c")
        .where("c.comerciante_id", "=", comercianteId)
        .where("c.kit_id", "=", kitId);
      const { total } = await doKit
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow();
      // O estado do componente: um arquivado que já estava no kit fica lá
      // (§3.4), e quem lê vê-o (revisão do #161, P3-5).
      let pagina = doKit
        .innerJoin("variante as v", (j) =>
          j
            .onRef("v.id", "=", "c.componente_id")
            .onRef("v.comerciante_id", "=", "c.comerciante_id"),
        )
        .select(["c.componente_id", "c.quantidade", "c.posicao", "v.estado"]);
      if (depois !== null) {
        pagina = pagina.where(
          sql<boolean>`(c.posicao, c.componente_id) > (${depois.posicao}::int, ${depois.id}::uuid)`,
        );
      }
      const linhas = await pagina
        .orderBy("c.posicao")
        .orderBy("c.componente_id")
        .limit(limite + 1)
        .execute();
      const haMais = linhas.length > limite;
      const dados = haMais ? linhas.slice(0, limite) : linhas;
      const ultima = haMais ? dados.at(-1) : undefined;
      return {
        dados,
        total: Number(total),
        ultima:
          ultima === undefined
            ? null
            : { posicao: ultima.posicao, id: ultima.componente_id },
      };
    },
    { soLeitura: true },
  );
}

// ---------------------------------------------------------- Traduções

/** Os recursos traduzíveis e os campos de cada um (0009). */
export const CAMPOS_TRADUZIVEIS = {
  artigo: ["nome", "descricao"],
  opcao: ["nome"],
  valor_opcao: ["valor"],
  categoria: ["nome", "endereco_amigavel"],
  colecao: ["nome", "descricao", "endereco_amigavel"],
} as const;
export type RecursoTraduzivel = keyof typeof CAMPOS_TRADUZIVEIS;

/**
 * O estado de uma tradução que existe (§4.3): completa se foi feita sobre o
 * original de agora; desactualizada se o original mudou, ficou vazio ou
 * deixou de existir. A única regra (revisão do #166, P2-2).
 */
export const estadoDaTraducao = (
  actual: string | null,
  original: string | null,
): "completa" | "desactualizada" =>
  actual === original ? "completa" : "desactualizada";

/**
 * O que está por traduzir numa língua (§4.3), sobre `texto_original as o`
 * com `traducao as t` dessa língua junta à esquerda: em falta, com original
 * e sem tradução; desactualizada, com tradução de outro original ou de um
 * original que ficou vazio. A única regra, para a fila e para o filtro dos
 * artigos.
 */
function porTraduzir(
  estados: readonly ("em_falta" | "desactualizada")[],
): RawBuilder<boolean> {
  const partes: RawBuilder<boolean>[] = [];
  if (estados.includes("em_falta")) {
    partes.push(
      sql<boolean>`(coalesce(btrim(o.texto), '') <> '' and t.id is null)`,
    );
  }
  if (estados.includes("desactualizada")) {
    partes.push(
      sql<boolean>`(t.id is not null and (t.original is distinct from o.texto or coalesce(btrim(o.texto), '') = ''))`,
    );
  }
  return partes.length === 0
    ? sql<boolean>`false`
    : sql<boolean>`(${sql.join(partes, sql` or `)})`;
}

/** A língua de origem não se traduz (§4.3). */
async function naoELinguaDeOrigem(
  trx: Kysely<BaseDados>,
  comercianteId: string,
  lingua: string,
) {
  const comerciante = await trx
    .selectFrom("comerciante")
    .select("lingua_origem")
    .where("id", "=", comercianteId)
    .executeTakeFirst();
  if (comerciante?.lingua_origem === lingua) {
    throw new ErroCatalogo(
      "catalog.translation_same_language",
      `${lingua} é a língua de origem`,
    );
  }
}

/**
 * Confirma que o recurso existe neste comerciante (o RLS esconde os de
 * outro); senão, `catalog.not_found`. Lido na transacção dada.
 */
export async function recursoTraduzivel(
  trx: Kysely<BaseDados>,
  comercianteId: string,
  tipo: RecursoTraduzivel,
  recursoId: string,
): Promise<void> {
  const linha = await trx
    .selectFrom(tipo)
    .select("id")
    .where("comerciante_id", "=", comercianteId)
    .where("id", "=", recursoId)
    .executeTakeFirst();
  if (linha === undefined) {
    throw new ErroCatalogo("catalog.not_found", `${tipo} ${recursoId}`);
  }
}

/**
 * As traduções de um recurso (de uma língua, se dada), por campo e língua,
 * com o estado calculado contra o original de agora (§4.3). Um recurso que
 * não existe é `catalog.not_found`. São poucas por natureza (os campos do
 * tipo × as línguas): a lista vai inteira.
 */
export async function traducoesParaApi(
  db: Kysely<BaseDados>,
  comercianteId: string,
  tipo: RecursoTraduzivel,
  recursoId: string,
  lingua: string | null,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      await recursoTraduzivel(trx, comercianteId, tipo, recursoId);
      // Na língua de origem não há traduções: diz-se, como na fila
      // (revisão do #166, P3-6).
      if (lingua !== null) {
        await naoELinguaDeOrigem(trx, comercianteId, lingua);
      }
      let consulta = trx
        .selectFrom("traducao as t")
        .leftJoin("texto_original as o", (j) =>
          j
            .onRef("o.comerciante_id", "=", "t.comerciante_id")
            .onRef("o.recurso_id", "=", "t.recurso_id")
            .onRef("o.campo", "=", "t.campo"),
        )
        .select([
          "t.campo",
          "t.lingua",
          "t.texto",
          "t.original",
          "o.texto as actual",
          "t.origem",
          "t.revista",
          "t.traduzido_em",
          "t.revisto_em",
        ])
        .where("t.comerciante_id", "=", comercianteId)
        .where("t.recurso_id", "=", recursoId);
      if (lingua !== null) consulta = consulta.where("t.lingua", "=", lingua);
      const linhas = await consulta
        .orderBy("t.campo")
        .orderBy("t.lingua")
        .execute();
      return linhas.map((l) => ({
        campo: l.campo,
        lingua: l.lingua,
        texto: l.texto,
        estado: estadoDaTraducao(l.actual, l.original),
        origem: l.origem,
        revista: l.revista,
        traduzido_em: l.traduzido_em,
        revisto_em: l.revisto_em,
      }));
    },
    { soLeitura: true },
  );
}

/** Onde a página da fila acabou: a ordem é (tipo, recurso, campo). */
export interface PosicaoNaFila {
  tipo: string;
  recursoId: string;
  campo: string;
}

/**
 * Uma página da fila de traduções de uma língua (§7.1): os campos com
 * original e sem tradução nessa língua (`em_falta`) e os que têm tradução de
 * um original que mudou ou ficou vazio (`desactualizada`), com o total. Para
 * a língua de origem não há fila (`catalog.translation_same_language`).
 */
export async function filaDeTraducoesPaginada(
  db: Kysely<BaseDados>,
  comercianteId: string,
  lingua: string,
  estados: readonly ("em_falta" | "desactualizada")[],
  limite: number,
  depois: PosicaoNaFila | null,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      await naoELinguaDeOrigem(trx, comercianteId, lingua);
      const fila = trx
        .selectFrom("texto_original as o")
        .leftJoin("traducao as t", (j) =>
          j
            .onRef("t.comerciante_id", "=", "o.comerciante_id")
            .onRef("t.recurso_id", "=", "o.recurso_id")
            .onRef("t.campo", "=", "o.campo")
            .on("t.lingua", "=", lingua),
        )
        .where("o.comerciante_id", "=", comercianteId)
        .where(porTraduzir(estados));
      const { total } = await fila
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow();
      let pagina = fila.select([
        "o.tipo",
        "o.recurso_id",
        "o.campo",
        "t.id as traducao",
      ]);
      if (depois !== null) {
        pagina = pagina.where(
          sql<boolean>`(o.tipo, o.recurso_id, o.campo) > (${depois.tipo}::text, ${depois.recursoId}::uuid, ${depois.campo}::text)`,
        );
      }
      const linhas = await pagina
        .orderBy("o.tipo")
        .orderBy("o.recurso_id")
        .orderBy("o.campo")
        .limit(limite + 1)
        .execute();
      const haMais = linhas.length > limite;
      const dados = haMais ? linhas.slice(0, limite) : linhas;
      const ultima = haMais ? dados.at(-1) : undefined;
      return {
        dados: dados.map((l) => ({
          tipo: l.tipo as RecursoTraduzivel,
          recursoId: l.recurso_id,
          campo: l.campo,
          estado:
            l.traducao === null
              ? ("em_falta" as const)
              : ("desactualizada" as const),
        })),
        total: Number(total),
        ultima:
          ultima === undefined
            ? null
            : {
                tipo: ultima.tipo,
                recursoId: ultima.recurso_id,
                campo: ultima.campo,
              },
      };
    },
    { soLeitura: true },
  );
}

// ------------------------------------------------ Categorias e colecções

/**
 * As categorias ou as colecções do comerciante, por ordem de criação (o id),
 * no formato das listas (docs/18 §2a), também as arquivadas se não se filtrar
 * pelo estado. O total, os ids e as fichas (`carregar`) lêem-se na mesma
 * transacção (revisão do #170, P3-1).
 */
export async function listarCategoriasOuColecoes<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  tabela: "categoria" | "colecao",
  estado: "activa" | "arquivada" | null,
  limite: number,
  depois: string | null,
  carregar: (
    trx: Kysely<BaseDados>,
    comercianteId: string,
    ids: readonly string[],
  ) => Promise<T[]>,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      let consulta = trx
        .selectFrom(tabela)
        .where("comerciante_id", "=", comercianteId);
      if (estado !== null) consulta = consulta.where("estado", "=", estado);
      const { total } = await consulta
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow();
      let pagina = consulta.select("id");
      if (depois !== null) pagina = pagina.where("id", ">", depois);
      const ids = (
        await pagina
          .orderBy("id")
          .limit(limite + 1)
          .execute()
      ).map((l) => l.id);
      const haMais = ids.length > limite;
      const daPagina = haMais ? ids.slice(0, limite) : ids;
      return {
        dados: await carregar(trx, comercianteId, daPagina),
        total: Number(total),
        ultimo: haMais ? (daPagina.at(-1) ?? null) : null,
      };
    },
    { soLeitura: true },
  );
}

/** Uma categoria; outra do comerciante, ou de outro, é `catalog.not_found`. */
export async function fichaDaCategoria(
  db: Kysely<BaseDados>,
  comercianteId: string,
  categoriaId: string,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const linha = await trx
        .selectFrom("categoria")
        .selectAll()
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", categoriaId)
        .executeTakeFirst();
      if (linha === undefined) {
        throw new ErroCatalogo("catalog.not_found", `categoria ${categoriaId}`);
      }
      return linha;
    },
    { soLeitura: true },
  );
}

/** As categorias dadas, pela ordem do id (para as listas). */
export async function categoriasPorId(
  db: Kysely<BaseDados>,
  comercianteId: string,
  ids: readonly string[],
) {
  if (ids.length === 0) return [];
  return noCatalogo(
    db,
    comercianteId,
    (trx) =>
      trx
        .selectFrom("categoria")
        .selectAll()
        .where("comerciante_id", "=", comercianteId)
        .where("id", "in", ids)
        .orderBy("id")
        .execute(),
    { soLeitura: true },
  );
}

/**
 * Uma colecção, com quantos artigos tem; outra do comerciante, ou de outro, é
 * `catalog.not_found`.
 */
export async function fichaDaColecao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  colecaoId: string,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const linha = await trx
        .selectFrom("colecao")
        .selectAll()
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", colecaoId)
        .executeTakeFirst();
      if (linha === undefined) {
        throw new ErroCatalogo("catalog.not_found", `colecção ${colecaoId}`);
      }
      const { total } = await trx
        .selectFrom("colecao_artigo")
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .where("comerciante_id", "=", comercianteId)
        .where("colecao_id", "=", colecaoId)
        .executeTakeFirstOrThrow();
      return { ...linha, total_artigos: Number(total) };
    },
    { soLeitura: true },
  );
}

/** As colecções dadas, pela ordem do id, com quantos artigos tem cada uma. */
export async function colecoesPorId(
  db: Kysely<BaseDados>,
  comercianteId: string,
  ids: readonly string[],
) {
  if (ids.length === 0) return [];
  return noCatalogo(
    db,
    comercianteId,
    (trx) =>
      trx
        .selectFrom("colecao as c")
        .selectAll("c")
        .select((eb) =>
          eb
            .selectFrom("colecao_artigo as ca")
            .select((e) => e.fn.countAll<string>().as("n"))
            .whereRef("ca.comerciante_id", "=", "c.comerciante_id")
            .whereRef("ca.colecao_id", "=", "c.id")
            .as("total_artigos"),
        )
        .where("c.comerciante_id", "=", comercianteId)
        .where("c.id", "in", ids)
        .orderBy("c.id")
        .execute(),
    { soLeitura: true },
  );
}

/**
 * Os artigos de uma colecção, pela ordem dela (posição e id), com o estado de
 * cada artigo, no formato das listas. Uma colecção que não existe é
 * `catalog.not_found`.
 */
export async function artigosDaColecaoPaginados(
  db: Kysely<BaseDados>,
  comercianteId: string,
  colecaoId: string,
  limite: number,
  depois: PosicaoEId | null,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const colecao = await trx
        .selectFrom("colecao")
        .select("id")
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", colecaoId)
        .executeTakeFirst();
      if (colecao === undefined) {
        throw new ErroCatalogo("catalog.not_found", `colecção ${colecaoId}`);
      }
      const daColecao = trx
        .selectFrom("colecao_artigo as ca")
        .where("ca.comerciante_id", "=", comercianteId)
        .where("ca.colecao_id", "=", colecaoId);
      const { total } = await daColecao
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow();
      let pagina = daColecao
        .innerJoin("artigo as a", (j) =>
          j
            .onRef("a.id", "=", "ca.artigo_id")
            .onRef("a.comerciante_id", "=", "ca.comerciante_id"),
        )
        .select(["ca.artigo_id", "ca.posicao", "a.estado"]);
      if (depois !== null) {
        pagina = pagina.where(
          sql<boolean>`(ca.posicao, ca.artigo_id) > (${depois.posicao}::int, ${depois.id}::uuid)`,
        );
      }
      const linhas = await pagina
        .orderBy("ca.posicao")
        .orderBy("ca.artigo_id")
        .limit(limite + 1)
        .execute();
      const haMais = linhas.length > limite;
      const dados = haMais ? linhas.slice(0, limite) : linhas;
      const ultima = haMais ? dados.at(-1) : undefined;
      return {
        dados,
        total: Number(total),
        ultima:
          ultima === undefined
            ? null
            : { posicao: ultima.posicao, id: ultima.artigo_id },
      };
    },
    { soLeitura: true },
  );
}

/**
 * As categorias de um artigo (fichas inteiras, também as arquivadas), pela
 * ordem do id. Um artigo que não existe é `catalog.not_found`. São poucas:
 * a API aceita até 100 por artigo, e a lista vai inteira.
 */
export async function categoriasDoArtigoParaApi(
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
        .select(["id", "versao"])
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", artigoId)
        .executeTakeFirst();
      if (artigo === undefined) {
        throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
      }
      const categorias = await trx
        .selectFrom("artigo_categoria as ac")
        .innerJoin("categoria as c", (j) =>
          j
            .onRef("c.id", "=", "ac.categoria_id")
            .onRef("c.comerciante_id", "=", "ac.comerciante_id"),
        )
        .selectAll("c")
        .where("ac.comerciante_id", "=", comercianteId)
        .where("ac.artigo_id", "=", artigoId)
        .orderBy("c.id")
        .execute();
      return { versao: artigo.versao, categorias };
    },
    { soLeitura: true },
  );
}
