import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados, EstadoCategoria } from "../base/esquema.js";
import { artigoNaVersao, ErroCatalogo, noCatalogo } from "./repositorio.js";

// Catálogo, parte 3a: categorias e colecções manuais (docs/14 §3.6, §3.7 e
// §3.1 «categorias»; migração 0006; issue #77). Como o resto do domínio,
// ainda sem API: as regras vivem na base; aqui só a versão lida, as listas
// inteiras e a ordem dos bloqueios.

export interface DadosCategoria {
  nome: string;
  endereco_amigavel: string;
  pai_id?: string | null;
  posicao?: number;
}

/** Cria uma categoria activa (§3.6). Devolve o id. */
export async function criarCategoria(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosCategoria,
): Promise<string> {
  const { id } = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .insertInto("categoria")
      .values({ comerciante_id: comercianteId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

export async function obterCategoria(
  db: Kysely<BaseDados>,
  comercianteId: string,
  categoriaId: string,
) {
  const categoria = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("categoria")
      .selectAll()
      .where("id", "=", categoriaId)
      .executeTakeFirst(),
  );
  if (categoria === undefined) {
    throw new ErroCatalogo("catalog.not_found", `categoria ${categoriaId}`);
  }
  return categoria;
}

/** Todas as categorias do comerciante, também as arquivadas, pela ordem. */
export async function categoriasDoComerciante(
  db: Kysely<BaseDados>,
  comercianteId: string,
) {
  return noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("categoria")
      .selectAll()
      .where("comerciante_id", "=", comercianteId)
      .orderBy("pai_id", (o) => o.nullsFirst())
      .orderBy("posicao")
      .orderBy("id")
      .execute(),
  );
}

/** A linha da tabela, presa até ao fim, na versão que quem chama leu. */
async function naVersao(
  trx: Transaction<BaseDados>,
  tabela: "categoria" | "colecao",
  id: string,
  versao: number,
) {
  const linha = await trx
    .selectFrom(tabela)
    .select(["id", "estado", "versao"])
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (linha === undefined) {
    throw new ErroCatalogo("catalog.not_found", `${tabela} ${id}`);
  }
  if (linha.versao !== versao) {
    throw new ErroCatalogo(
      "catalog.version_conflict",
      `${tabela} ${id}: versão ${String(versao)} pedida, ${String(linha.versao)} actual`,
    );
  }
  return linha;
}

/** Só as chaves com valor: `undefined` quer dizer «não mexer». */
function soDefinidos<T extends object>(alteracao: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(alteracao).filter(([, valor]) => valor !== undefined),
  ) as Partial<T>;
}

export type AlteracaoCategoria = {
  [K in "nome" | "endereco_amigavel" | "posicao"]?:
    DadosCategoria[K] | undefined;
};

/** Altera o nome, o endereço ou a posição; devolve a versão nova. */
export async function alterarCategoria(
  db: Kysely<BaseDados>,
  comercianteId: string,
  categoriaId: string,
  versao: number,
  alteracao: AlteracaoCategoria,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    await naVersao(trx, "categoria", categoriaId, versao);
    const campos = soDefinidos(alteracao);
    if (Object.keys(campos).length === 0) return versao;
    const { versao: nova } = await trx
      .updateTable("categoria")
      .set(campos)
      .where("id", "=", categoriaId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    return nova;
  });
}

/**
 * Muda a categoria de sítio na árvore (`POST /categories/{id}/move`); `null`
 * põe-na na raiz. A base recusa ciclos e um pai arquivado.
 */
export async function moverCategoria(
  db: Kysely<BaseDados>,
  comercianteId: string,
  categoriaId: string,
  versao: number,
  paiId: string | null,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    await naVersao(trx, "categoria", categoriaId, versao);
    const { versao: nova } = await trx
      .updateTable("categoria")
      .set({ pai_id: paiId })
      .where("id", "=", categoriaId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    return nova;
  });
}

/** Arquiva ou repõe; pedir o estado em que já está não muda a versão. */
export async function mudarEstadoCategoria(
  db: Kysely<BaseDados>,
  comercianteId: string,
  categoriaId: string,
  versao: number,
  para: EstadoCategoria,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const linha = await naVersao(trx, "categoria", categoriaId, versao);
    if (linha.estado === para) return versao;
    const { versao: nova } = await trx
      .updateTable("categoria")
      .set({ estado: para })
      .where("id", "=", categoriaId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    return nova;
  });
}

/**
 * Substitui as categorias do artigo pela lista dada (§3.1, `categorias`), na
 * versão do artigo que quem chama leu; devolve a versão nova do artigo (a
 * mesma, se a lista não mudou). Uma categoria arquivada que o artigo já tinha
 * pode ficar; uma nova tem de estar activa (0006).
 */
export async function definirCategoriasDoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  versao: number,
  categoriaIds: readonly string[],
): Promise<number> {
  if (new Set(categoriaIds).size !== categoriaIds.length) {
    throw new ErroCatalogo(
      "catalog.category_duplicate",
      "a mesma categoria duas vezes na lista",
    );
  }
  return noCatalogo(db, comercianteId, async (trx) => {
    // A linha do artigo primeiro, como nas outras escritas do artigo.
    await artigoNaVersao(trx, artigoId, versao);
    const actuais = new Set(
      (
        await trx
          .selectFrom("artigo_categoria")
          .select("categoria_id")
          .where("comerciante_id", "=", comercianteId)
          .where("artigo_id", "=", artigoId)
          .execute()
      ).map((l) => l.categoria_id),
    );
    const sair = [...actuais].filter((id) => !categoriaIds.includes(id));
    const entrar = categoriaIds.filter((id) => !actuais.has(id));
    if (sair.length === 0 && entrar.length === 0) return versao;
    if (sair.length > 0) {
      await trx
        .deleteFrom("artigo_categoria")
        .where("comerciante_id", "=", comercianteId)
        .where("artigo_id", "=", artigoId)
        .where("categoria_id", "in", sair)
        .execute();
    }
    if (entrar.length > 0) {
      // Uma categoria de outro comerciante ou inexistente: a chave
      // estrangeira recusa («não existe», sem dizer qual).
      await trx
        .insertInto("artigo_categoria")
        .values(
          entrar.map((categoriaId) => ({
            comerciante_id: comercianteId,
            artigo_id: artigoId,
            categoria_id: categoriaId,
          })),
        )
        .execute();
    }
    return mexerNaVersao(trx, "artigo", artigoId);
  });
}

/** Sobe a versão (e a data) de uma linha cujo conteúdo mudou noutra tabela. */
async function mexerNaVersao(
  trx: Transaction<BaseDados>,
  tabela: "artigo" | "colecao",
  id: string,
): Promise<number> {
  // `nome = nome` não muda o nome; o trigger da tabela sobe a versão.
  const { rows } = await sql<{ versao: number }>`
    update ${sql.table(tabela)} set nome = nome
    where id = ${id} returning versao`.execute(trx);
  const nova = rows[0]?.versao;
  if (nova === undefined) {
    throw new ErroCatalogo("catalog.not_found", `${tabela} ${id}`);
  }
  return nova;
}

/** As categorias do artigo (ids), também as arquivadas. */
export async function categoriasDoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
): Promise<string[]> {
  const linhas = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("artigo_categoria")
      .select("categoria_id")
      .where("comerciante_id", "=", comercianteId)
      .where("artigo_id", "=", artigoId)
      .orderBy("categoria_id")
      .execute(),
  );
  return linhas.map((l) => l.categoria_id);
}

export interface DadosColecao {
  nome: string;
  endereco_amigavel: string;
  descricao?: string | null;
}

/** Cria uma colecção manual, activa e vazia (§3.7). Devolve o id. */
export async function criarColecao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosColecao,
): Promise<string> {
  const { id } = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .insertInto("colecao")
      .values({ comerciante_id: comercianteId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

export async function obterColecao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  colecaoId: string,
) {
  const colecao = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("colecao")
      .selectAll()
      .where("id", "=", colecaoId)
      .executeTakeFirst(),
  );
  if (colecao === undefined) {
    throw new ErroCatalogo("catalog.not_found", `colecção ${colecaoId}`);
  }
  return colecao;
}

export type AlteracaoColecao = {
  [K in "nome" | "endereco_amigavel" | "descricao"]?:
    DadosColecao[K] | undefined;
};

export async function alterarColecao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  colecaoId: string,
  versao: number,
  alteracao: AlteracaoColecao,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    await naVersao(trx, "colecao", colecaoId, versao);
    const campos = soDefinidos(alteracao);
    if (Object.keys(campos).length === 0) return versao;
    const { versao: nova } = await trx
      .updateTable("colecao")
      .set(campos)
      .where("id", "=", colecaoId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    return nova;
  });
}

export async function mudarEstadoColecao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  colecaoId: string,
  versao: number,
  para: EstadoCategoria,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const linha = await naVersao(trx, "colecao", colecaoId, versao);
    if (linha.estado === para) return versao;
    const { versao: nova } = await trx
      .updateTable("colecao")
      .set({ estado: para })
      .where("id", "=", colecaoId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    return nova;
  });
}

/**
 * Substitui os artigos da colecção pela lista dada, pela ordem dada
 * (`PUT /collections/{id}/products`), na versão lida; devolve a versão nova
 * (a mesma, se a lista e a ordem não mudaram).
 */
export async function definirArtigosDaColecao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  colecaoId: string,
  versao: number,
  artigoIds: readonly string[],
): Promise<number> {
  if (new Set(artigoIds).size !== artigoIds.length) {
    throw new ErroCatalogo(
      "catalog.collection_product_duplicate",
      "o mesmo artigo duas vezes na lista",
    );
  }
  return noCatalogo(db, comercianteId, async (trx) => {
    await naVersao(trx, "colecao", colecaoId, versao);
    // Os artigos que entram, presos contra o apagar antes de mexer nas linhas
    // da colecção, por uma ordem fixa: quem apaga um rascunho que está na
    // lista acaba primeiro, e aqui dá «não existe» em vez de as duas
    // transacções esperarem uma pela outra.
    if (artigoIds.length > 0) {
      const existem = await trx
        .selectFrom("artigo")
        .select("id")
        .where("comerciante_id", "=", comercianteId)
        .where("id", "in", artigoIds)
        .orderBy("id")
        .forKeyShare()
        .execute();
      if (existem.length !== artigoIds.length) {
        throw new ErroCatalogo("catalog.not_found", "artigo inexistente");
      }
    }
    const actuais = (
      await trx
        .selectFrom("colecao_artigo")
        .select("artigo_id")
        .where("comerciante_id", "=", comercianteId)
        .where("colecao_id", "=", colecaoId)
        .orderBy("posicao")
        .execute()
    ).map((l) => l.artigo_id);
    if (
      actuais.length === artigoIds.length &&
      actuais.every((id, i) => id === artigoIds[i])
    ) {
      return versao;
    }
    await trx
      .deleteFrom("colecao_artigo")
      .where("comerciante_id", "=", comercianteId)
      .where("colecao_id", "=", colecaoId)
      .execute();
    if (artigoIds.length > 0) {
      await trx
        .insertInto("colecao_artigo")
        .values(
          artigoIds.map((artigoId, posicao) => ({
            comerciante_id: comercianteId,
            colecao_id: colecaoId,
            artigo_id: artigoId,
            posicao,
          })),
        )
        .execute();
    }
    return mexerNaVersao(trx, "colecao", colecaoId);
  });
}

/** Os artigos da colecção (ids), pela ordem. */
export async function artigosDaColecao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  colecaoId: string,
): Promise<string[]> {
  const linhas = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("colecao_artigo")
      .select("artigo_id")
      .where("comerciante_id", "=", comercianteId)
      .where("colecao_id", "=", colecaoId)
      .orderBy("posicao")
      .execute(),
  );
  return linhas.map((l) => l.artigo_id);
}
