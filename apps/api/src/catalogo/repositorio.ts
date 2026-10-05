import type { Kysely, Transaction } from "kysely";
import type {
  BaseDados,
  EstadoArtigo,
  OrigemGtin,
  TipoArtigo,
  UnidadeDeConteudo,
  UnidadeDeVenda,
} from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";

// Acesso interno ao domínio Catálogo, parte 1: artigos e variantes
// (docs/14-dominio-catalogo.md §3.1, §3.2, §4.1 e §5; issue #77). Ainda sem
// API: abre com a fatia de identidade, como o Comerciante. As regras vivem na
// base (CHECK e triggers da migração 0002); aqui só se traduzem os erros e se
// impõe a versão nas escritas (§3.1: a escrita com versão antiga é recusada).

export type CodigoErroCatalogo =
  | "catalog.not_found"
  | "catalog.invalid_transition"
  | "catalog.type_disabled"
  | "catalog.immutable_identity"
  | "catalog.immutable_type"
  | "catalog.no_variants"
  | "catalog.not_draft"
  | "catalog.product_archived"
  | "catalog.variant_archived_is_final"
  | "catalog.version_conflict"
  | "catalog.sku_duplicate"
  | "catalog.gtin_duplicate"
  | "catalog.gtin_invalid";

export class ErroCatalogo extends Error {
  constructor(
    readonly codigo: CodigoErroCatalogo,
    mensagem: string,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroCatalogo";
  }
}

const CODIGOS_DA_BASE: readonly CodigoErroCatalogo[] = [
  "catalog.invalid_transition",
  "catalog.type_disabled",
  "catalog.immutable_identity",
  "catalog.immutable_type",
  "catalog.no_variants",
  "catalog.not_draft",
  "catalog.product_archived",
  "catalog.variant_archived_is_final",
];

/** As restrições da base que têm código próprio (§7.1). */
const RESTRICOES: Readonly<Record<string, CodigoErroCatalogo>> = {
  variante_sku_unico: "catalog.sku_duplicate",
  variante_gtin_unico: "catalog.gtin_duplicate",
  variante_gtin_digito_de_controlo: "catalog.gtin_invalid",
  variante_gtin_check: "catalog.gtin_invalid",
};

function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error)) return erro;
  const codigo = CODIGOS_DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroCatalogo(codigo, erro.message, { cause: erro });
  }
  const pg = erro as Error & { code?: string; constraint?: string };
  const daRestricao =
    pg.constraint === undefined ? undefined : RESTRICOES[pg.constraint];
  if (
    daRestricao !== undefined &&
    (pg.code === "23505" || pg.code === "23514")
  ) {
    return new ErroCatalogo(daRestricao, erro.message, { cause: erro });
  }
  return erro;
}

/** Corre `fn` no contexto do comerciante e traduz os erros do Catálogo. */
async function noCatalogo<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
): Promise<T> {
  try {
    return await comComerciante(db, comercianteId, fn);
  } catch (erro) {
    throw traduzir(erro);
  }
}

export interface DadosArtigo {
  tipo: TipoArtigo;
  nome: string;
  descricao?: string | null;
  marca?: string | null;
  categoria_fiscal?: string | null;
  /** Só quando a ficha nasce num sistema externo do comerciante (P5). */
  origem_ref?: string | null;
}

export interface DadosVariante {
  sku: string;
  unidade_de_venda: UnidadeDeVenda;
  gtin?: string | null;
  gtin_origem?: OrigemGtin | null;
  conteudo_quantidade?: number | null;
  conteudo_unidade?: UnidadeDeConteudo | null;
  peso_g?: number | null;
  comprimento_mm?: number | null;
  largura_mm?: number | null;
  altura_mm?: number | null;
  onu?: string | null;
  classe_adr?: string | null;
  posicao?: number;
}

/** Cria um artigo em rascunho, com as variantes dadas. Devolve o id. */
export async function criarArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosArtigo,
  variantes: readonly DadosVariante[] = [],
): Promise<string> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const { origem_ref, ...resto } = dados;
    const { id } = await trx
      .insertInto("artigo")
      .values({
        comerciante_id: comercianteId,
        ...resto,
        origem: origem_ref == null ? "eurolify" : "externo",
        origem_ref: origem_ref ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const variante of variantes) {
      await trx
        .insertInto("variante")
        .values({ comerciante_id: comercianteId, artigo_id: id, ...variante })
        .execute();
    }
    return id;
  });
}

export async function obterArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
) {
  const artigo = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("artigo")
      .selectAll()
      .where("id", "=", artigoId)
      .executeTakeFirst(),
  );
  if (artigo === undefined) {
    throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
  }
  return artigo;
}

/**
 * Lê o artigo na transacção e confirma a versão que quem chama leu: se outro
 * escreveu entretanto, `catalog.version_conflict` (§3.1). O `FOR UPDATE`
 * guarda a linha até ao fim da transacção.
 */
async function artigoNaVersao(
  trx: Transaction<BaseDados>,
  artigoId: string,
  versao: number,
) {
  const artigo = await trx
    .selectFrom("artigo")
    .select(["id", "estado", "versao"])
    .where("id", "=", artigoId)
    .forUpdate()
    .executeTakeFirst();
  if (artigo === undefined) {
    throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
  }
  if (artigo.versao !== versao) {
    throw new ErroCatalogo(
      "catalog.version_conflict",
      `artigo ${artigoId}: versão ${String(versao)} pedida, ${String(artigo.versao)} actual`,
    );
  }
  return artigo;
}

export type AlteracaoArtigo = Partial<
  Pick<DadosArtigo, "nome" | "descricao" | "marca" | "categoria_fiscal">
>;

/** Altera campos do artigo na versão lida; devolve a versão nova. */
export async function alterarArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  versao: number,
  alteracao: AlteracaoArtigo,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    await artigoNaVersao(trx, artigoId, versao);
    const { versao: nova } = await trx
      .updateTable("artigo")
      .set(alteracao)
      .where("id", "=", artigoId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    return nova;
  });
}

/**
 * Muda o estado do artigo (§4.1): activar, arquivar ou repor. A base valida a
 * transição e a variante activa; aqui confirma-se a versão lida.
 */
export async function mudarEstadoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  versao: number,
  para: EstadoArtigo,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    await artigoNaVersao(trx, artigoId, versao);
    const { versao: nova } = await trx
      .updateTable("artigo")
      .set({ estado: para })
      .where("id", "=", artigoId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    return nova;
  });
}

/** Apaga um artigo rascunho que nunca esteve activo (§4.1). */
export async function apagarRascunho(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    const resultado = await trx
      .deleteFrom("artigo")
      .where("id", "=", artigoId)
      .executeTakeFirst();
    if (resultado.numDeletedRows === 0n) {
      throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
    }
  });
}

/** Acrescenta uma variante a um artigo que não está arquivado. */
export async function criarVariante(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  dados: DadosVariante,
): Promise<string> {
  const { id } = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .insertInto("variante")
      .values({ comerciante_id: comercianteId, artigo_id: artigoId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

/** Arquiva uma variante; o artigo e as outras variantes ficam (C6). */
export async function arquivarVariante(
  db: Kysely<BaseDados>,
  comercianteId: string,
  varianteId: string,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    const resultado = await trx
      .updateTable("variante")
      .set({ estado: "arquivada" })
      .where("id", "=", varianteId)
      .executeTakeFirst();
    if (resultado.numUpdatedRows === 0n) {
      throw new ErroCatalogo("catalog.not_found", `variante ${varianteId}`);
    }
  });
}

/** Procura uma variante pelo SKU, também arquivada (o SKU não volta, P7). */
export async function varianteComSku(
  db: Kysely<BaseDados>,
  comercianteId: string,
  sku: string,
) {
  return noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("variante")
      .selectAll()
      .where("sku", "=", sku)
      .executeTakeFirst(),
  );
}
