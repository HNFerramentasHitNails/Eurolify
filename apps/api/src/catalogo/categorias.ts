import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados, EstadoCategoria } from "../base/esquema.js";
import { artigoNaVersao, ErroCatalogo, noCatalogo } from "./repositorio.js";

// Catálogo, parte 3a: categorias e colecções manuais (docs/14 §3.6, §3.7 e
// §3.1 «categorias»; migração 0007; issue #77). Como o resto do domínio,
// ainda sem API: as regras vivem na base; aqui só a versão lida, as listas
// inteiras e a ordem dos bloqueios.

export interface DadosCategoria {
  nome: string;
  endereco_amigavel: string;
  pai_id?: string | null;
  posicao?: number;
}

/**
 * A fila das categorias do comerciante, a mesma que o trigger da 0007 toma.
 * Toma-se antes de prender qualquer linha de categoria: se uma escrita
 * prendesse primeiro a linha de B e só depois esperasse pela fila, e outra,
 * já na fila, criasse uma filha de B (a chave estrangeira pede a linha de B),
 * esperavam uma pela outra (revisão do #97, P1-1). A chave na forma canónica
 * do uuid, como o trigger.
 */
async function filaDasCategorias(
  trx: Transaction<BaseDados>,
  comercianteId: string,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended('eurolify.categoria:' || ${comercianteId}::uuid::text, 0))`.execute(
    trx,
  );
}

/** Cria uma categoria activa (§3.6). Devolve o id. */
export async function criarCategoria(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosCategoria,
): Promise<string> {
  const { id } = await noCatalogo(db, comercianteId, async (trx) => {
    await filaDasCategorias(trx, comercianteId);
    return trx
      .insertInto("categoria")
      .values({ comerciante_id: comercianteId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow();
  });
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

/** Confirma a versão que quem chama leu (§3.1: a versão antiga é recusada). */
function confirmarVersao(
  linha: { versao: number } | undefined,
  tabela: string,
  id: string,
  versao: number,
): void {
  if (linha === undefined) {
    throw new ErroCatalogo("catalog.not_found", `${tabela} ${id}`);
  }
  if (linha.versao !== versao) {
    throw new ErroCatalogo(
      "catalog.version_conflict",
      `${tabela} ${id}: versão ${String(versao)} pedida, ${String(linha.versao)} actual`,
    );
  }
}

/**
 * A categoria, presa até ao fim, na versão lida. Quem chama já está na fila
 * das categorias (`filaDasCategorias`); o `FOR UPDATE` fica como defesa.
 */
async function categoriaNaVersao(
  trx: Transaction<BaseDados>,
  id: string,
  versao: number,
) {
  const linha = await trx
    .selectFrom("categoria")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  confirmarVersao(linha, "categoria", id, versao);
  return linha as NonNullable<typeof linha>;
}

/** A colecção, presa até ao fim, na versão lida. */
async function colecaoNaVersao(
  trx: Transaction<BaseDados>,
  id: string,
  versao: number,
) {
  const linha = await trx
    .selectFrom("colecao")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  confirmarVersao(linha, "colecao", id, versao);
  return linha as NonNullable<typeof linha>;
}

/**
 * Só os campos permitidos e só o que muda de facto: `undefined` quer dizer
 * «não mexer», e um valor igual ao actual não conta (a versão só sobe quando
 * algo muda; revisão do #97, P3-2). Um campo fora da lista é ignorado, mesmo
 * que chegue por fora do tipo (2.ª revisão do #97, P3-C).
 */
function soOQueMuda<T extends object>(
  alteracao: T,
  permitidos: readonly string[],
  actual: Record<string, unknown>,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(alteracao).filter(
      ([campo, valor]) =>
        permitidos.includes(campo) &&
        valor !== undefined &&
        valor !== actual[campo],
    ),
  ) as Partial<T>;
}

/**
 * Os ids na forma da base (minúsculas): o mesmo uuid em maiúsculas é o mesmo
 * id (2.ª revisão do #97, P3-B).
 */
function canonico(id: string): string {
  return id.toLowerCase();
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
    await filaDasCategorias(trx, comercianteId);
    const linha = await categoriaNaVersao(trx, categoriaId, versao);
    const campos = soOQueMuda(
      alteracao,
      ["nome", "endereco_amigavel", "posicao"],
      linha,
    );
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
  paiIdDado: string | null,
): Promise<number> {
  const paiId = paiIdDado === null ? null : canonico(paiIdDado);
  return noCatalogo(db, comercianteId, async (trx) => {
    await filaDasCategorias(trx, comercianteId);
    const linha = await categoriaNaVersao(trx, categoriaId, versao);
    if (linha.pai_id === paiId) return versao;
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
    await filaDasCategorias(trx, comercianteId);
    const linha = await categoriaNaVersao(trx, categoriaId, versao);
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
 * pode ficar; uma nova tem de estar activa (0007).
 */
export async function definirCategoriasDoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  versao: number,
  categoriaIdsDados: readonly string[],
): Promise<number> {
  const categoriaIds = categoriaIdsDados.map(canonico);
  return noCatalogo(db, comercianteId, async (trx) => {
    // A linha do artigo primeiro, como nas outras escritas do artigo: o que
    // não existe e a versão antiga recusam-se antes da lista repetida
    // (docs/14 §7.1; revisão do #170, P2-1).
    await artigoNaVersao(trx, artigoId, versao);
    if (new Set(categoriaIds).size !== categoriaIds.length) {
      throw new ErroCatalogo(
        "catalog.category_duplicate",
        "a mesma categoria duas vezes na lista",
      );
    }
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
    const linha = await colecaoNaVersao(trx, colecaoId, versao);
    const campos = soOQueMuda(
      alteracao,
      ["nome", "descricao", "endereco_amigavel"],
      linha,
    );
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
    const linha = await colecaoNaVersao(trx, colecaoId, versao);
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
  artigoIdsDados: readonly string[],
): Promise<number> {
  const artigoIds = artigoIdsDados.map(canonico);
  return noCatalogo(db, comercianteId, async (trx) => {
    // A colecção na versão lida antes da lista repetida (revisão do #170,
    // P2-1).
    await colecaoNaVersao(trx, colecaoId, versao);
    if (new Set(artigoIds).size !== artigoIds.length) {
      throw new ErroCatalogo(
        "catalog.collection_product_duplicate",
        "o mesmo artigo duas vezes na lista",
      );
    }
    // Os artigos que entram, presos contra o apagar (`FOR KEY SHARE`) antes
    // de mexer nas linhas da colecção: quem apaga um desses rascunhos espera
    // por esta substituição, ou acaba antes e aqui dá «não existe», em vez de
    // as duas transacções esperarem uma pela outra. Duas substituições não
    // chocam entre si (as duas só pedem `KEY SHARE`).
    if (artigoIds.length > 0) {
      const existem = await trx
        .selectFrom("artigo")
        .select("id")
        .where("comerciante_id", "=", comercianteId)
        .where("id", "in", artigoIds)
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
