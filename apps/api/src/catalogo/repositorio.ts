import { sql, type Kysely, type Transaction } from "kysely";
import type {
  BaseDados,
  EstadoArtigo,
  OrigemGtin,
  TipoArtigo,
  UnidadeDeConteudo,
  UnidadeDeVenda,
} from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import type { Classificacao } from "./classificacao.js";

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
  | "catalog.variant_archived_is_final"
  | "catalog.version_conflict"
  | "catalog.name_required"
  | "catalog.origin_ref_required"
  | "catalog.sku_required"
  | "catalog.sku_invalid"
  | "catalog.unit_required"
  | "catalog.sku_duplicate"
  | "catalog.gtin_duplicate"
  | "catalog.gtin_invalid"
  | "catalog.gtin_origin_required"
  | "catalog.content_incomplete"
  | "catalog.invalid_field"
  | "catalog.component_cycle"
  | "catalog.component_archived"
  | "catalog.component_duplicate"
  | "catalog.component_in_use"
  | "catalog.options_incomplete"
  | "catalog.option_combination_duplicate"
  | "catalog.option_duplicate"
  | "catalog.option_value_duplicate"
  | "catalog.option_repeated"
  | "catalog.option_values_required"
  | "catalog.retry"
  | "catalog.classified_by_required"
  | "catalog.classification_invalid"
  | "catalog.nature_incompatible"
  | "catalog.category_cycle"
  | "catalog.category_archived"
  | "catalog.category_has_children"
  | "catalog.category_duplicate"
  | "catalog.slug_invalid"
  | "catalog.slug_duplicate"
  | "catalog.collection_product_duplicate"
  | "catalog.translated_by_required"
  | "catalog.translation_same_language"
  | "catalog.translation_no_original"
  | "catalog.translation_not_ai"
  | "catalog.translation_self_review";

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
  "catalog.variant_archived_is_final",
  "catalog.component_cycle",
  "catalog.component_archived",
  "catalog.options_incomplete",
  "catalog.option_combination_duplicate",
  "catalog.classified_by_required",
  "catalog.category_cycle",
  "catalog.category_archived",
  "catalog.category_has_children",
  "catalog.translated_by_required",
  "catalog.translation_same_language",
  "catalog.translation_no_original",
  "catalog.translation_not_ai",
  "catalog.translation_self_review",
];

/** As restrições da base que têm código próprio (§7.1). */
const RESTRICOES: Readonly<Record<string, CodigoErroCatalogo>> = {
  variante_sku_unico: "catalog.sku_duplicate",
  variante_sku_check: "catalog.sku_invalid",
  variante_gtin_unico: "catalog.gtin_duplicate",
  variante_gtin_digito_de_controlo: "catalog.gtin_invalid",
  variante_gtin_check: "catalog.gtin_invalid",
  // O PostgreSQL verifica os CHECK por ordem alfabética do nome: um GTIN com
  // o dígito errado e sem origem cai aqui primeiro (revisão do #78, 2.ª, P2-2).
  variante_gtin_com_origem: "catalog.gtin_origin_required",
  variante_conteudo_completo: "catalog.content_incomplete",
  artigo_origem_com_referencia: "catalog.origin_ref_required",
  artigo_nome_check: "catalog.name_required",
  // Composição dos kits (0004).
  componente_nao_e_o_kit: "catalog.component_cycle",
  componente_pkey: "catalog.component_duplicate",
  // Opções (0005).
  opcao_nome_unico: "catalog.option_duplicate",
  valor_opcao_unico: "catalog.option_value_duplicate",
  // Dois valores da mesma opção para a mesma variante.
  variante_valor_pkey: "catalog.option_repeated",
  // Classificação (0006).
  artigo_natureza_do_tipo: "catalog.nature_incompatible",
  artigo_familias_validas: "catalog.classification_invalid",
  artigo_natureza_valida: "catalog.classification_invalid",
  artigo_modo_valido: "catalog.classification_invalid",
  artigo_modo_da_natureza: "catalog.classification_invalid",
  artigo_lazer_so_em_acesso: "catalog.classification_invalid",
  artigo_prestacao_datas: "catalog.classification_invalid",
  artigo_local_valido: "catalog.classification_invalid",
  artigo_classificado_por_valido: "catalog.classification_invalid",
  artigo_datas_so_na_prestacao: "catalog.classification_invalid",
  artigo_local_so_no_presencial: "catalog.classification_invalid",
  // Categorias e colecções (0007).
  categoria_nome_check: "catalog.name_required",
  colecao_nome_check: "catalog.name_required",
  categoria_endereco_valido: "catalog.slug_invalid",
  colecao_endereco_valido: "catalog.slug_invalid",
  categoria_endereco_unico: "catalog.slug_duplicate",
  colecao_endereco_unico: "catalog.slug_duplicate",
  categoria_nao_e_o_pai: "catalog.category_cycle",
  artigo_categoria_pkey: "catalog.category_duplicate",
  colecao_artigo_pkey: "catalog.collection_product_duplicate",
  // Traduções (0009).
  traducao_endereco_valido: "catalog.slug_invalid",
  traducao_endereco_unico_categoria: "catalog.slug_duplicate",
  traducao_endereco_unico_colecao: "catalog.slug_duplicate",
};

/** Colunas obrigatórias com código próprio (§7.1: C3). */
const OBRIGATORIAS: Readonly<Record<string, CodigoErroCatalogo>> = {
  nome: "catalog.name_required",
  sku: "catalog.sku_required",
  unidade_de_venda: "catalog.unit_required",
  endereco_amigavel: "catalog.slug_invalid",
};

/** As tabelas deste domínio, para os erros que só se traduzem quando vêm delas. */
const TABELAS = new Set([
  "artigo",
  "variante",
  "componente",
  "opcao",
  "valor_opcao",
  "variante_valor",
  "categoria",
  "artigo_categoria",
  "colecao",
  "colecao_artigo",
  "traducao",
]);

export interface OpcoesDeTraducao {
  /** A operação apaga variantes: `componente_em_uso` quer dizer «em uso». */
  apagar?: boolean;
}

/** Exportada para os testes; o resto do código usa-a por `noCatalogo`. */
export function traduzir(
  erro: unknown,
  opcoes: OpcoesDeTraducao = {},
): unknown {
  if (!(erro instanceof Error)) return erro;
  const codigo = CODIGOS_DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroCatalogo(codigo, erro.message, { cause: erro });
  }
  const pg = erro as Error & {
    code?: string;
    constraint?: string;
    column?: string;
    table?: string;
  };
  const daRestricao =
    pg.constraint === undefined ? undefined : RESTRICOES[pg.constraint];
  if (
    daRestricao !== undefined &&
    (pg.code === "23505" || pg.code === "23514")
  ) {
    return new ErroCatalogo(daRestricao, erro.message, { cause: erro });
  }
  const daColuna =
    pg.column === undefined ? undefined : OBRIGATORIAS[pg.column];
  if (pg.code === "23502" && daColuna !== undefined) {
    return new ErroCatalogo(daColuna, erro.message, { cause: erro });
  }
  // Outro valor recusado nestas tabelas (uma lista, um número): código
  // genérico (revisão do #78, 2.ª, P2-2).
  if (
    (pg.code === "23514" || pg.code === "23502") &&
    pg.table !== undefined &&
    TABELAS.has(pg.table)
  ) {
    return new ErroCatalogo("catalog.invalid_field", erro.message, {
      cause: erro,
    });
  }
  // Um valor que a base nem consegue ler (classe 22: um id que não é UUID,
  // um número decimal ou grande demais num inteiro, um carácter NUL). Um id
  // mal escrito é «não existe», como um id de outro comerciante (3.ª revisão,
  // P2-A). Fica de fora o que não vem destas funções (por exemplo um 42501 de
  // SQL escrito à mão): a validação dos pedidos é da camada da API.
  if (pg.code !== undefined && pg.code.startsWith("22")) {
    const codigoDeValor =
      pg.code === "22P02" && /type uuid/.test(erro.message)
        ? "catalog.not_found"
        : "catalog.invalid_field";
    return new ErroCatalogo(codigoDeValor, erro.message, { cause: erro });
  }
  // Apagar uma variante que é componente de um kit (0004), antes da regra
  // geral das chaves estrangeiras, que diria «não existe». A mesma restrição
  // falha ao inserir um componente que não existe (ou de outro comerciante):
  // aí é «não existe». Decide-o a operação, não a mensagem, que depende da
  // língua do servidor (revisão do #81, P2-4).
  if (
    pg.code === "23503" &&
    pg.constraint === "componente_em_uso" &&
    opcoes.apagar === true
  ) {
    return new ErroCatalogo(
      "catalog.component_in_use",
      "a variante é componente de um kit",
      { cause: erro },
    );
  }
  // Duas transacções que esperavam uma pela outra (40P01) ou um conflito de
  // serialização (40001): nada ficou gravado; tentar outra vez (revisão do
  // #83, P2-2).
  if (pg.code === "40P01" || pg.code === "40001") {
    return new ErroCatalogo("catalog.retry", "tentar outra vez", {
      cause: erro,
    });
  }
  // Uma chave estrangeira que falha: o artigo (ou o comerciante) não existe
  // ou é de outro comerciante — o RLS esconde-o igual, sem oráculo.
  if (pg.code === "23503" && pg.table !== undefined && TABELAS.has(pg.table)) {
    return new ErroCatalogo("catalog.not_found", "referência inexistente", {
      cause: erro,
    });
  }
  return erro;
}

/**
 * Corre `fn` no contexto do comerciante e traduz os erros do Catálogo.
 * Exportada só para os outros ficheiros do domínio (categorias.ts).
 */
export async function noCatalogo<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
  opcoes: OpcoesDeTraducao = {},
): Promise<T> {
  try {
    return await comComerciante(db, comercianteId, fn);
  } catch (erro) {
    throw traduzir(erro, opcoes);
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
export async function artigoNaVersao(
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

/**
 * Os campos que se podem alterar. Uma chave com `undefined` quer dizer «não
 * mexer» (como num PATCH em JSON que a traga vazia) e é ignorada.
 */
export type AlteracaoArtigo = {
  [K in "nome" | "descricao" | "marca" | "categoria_fiscal"]?:
    DadosArtigo[K] | undefined;
};

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
    // Nada para mudar: a versão fica (revisão do #78, P2-6). Uma chave com
    // `undefined` também não muda nada (3.ª revisão, P2-A).
    const campos = Object.fromEntries(
      Object.entries(alteracao).filter(([, valor]) => valor !== undefined),
    );
    if (Object.keys(campos).length === 0) return versao;
    const { versao: nova } = await trx
      .updateTable("artigo")
      .set(campos)
      .where("id", "=", artigoId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    return nova;
  });
}

function mesmaClassificacao(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const igual = (x: unknown, y: unknown) =>
    x instanceof Date && y instanceof Date
      ? x.getTime() === y.getTime()
      : JSON.stringify(x) === JSON.stringify(y);
  return Object.keys(b).every((chave) => igual(a[chave], b[chave]));
}

/**
 * Classifica o artigo (§3.10, «Classificação do artigo»; migração 0006) na
 * versão lida: substitui a classificação toda, com quem classificou (a data é
 * da base). A base recusa as combinações que o desenho não admite. Devolve a
 * versão nova. Os impedimentos para publicar dão-se em classificacao.ts.
 */
export async function classificarArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  versao: number,
  classificacao: Classificacao,
  quem: string,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    await artigoNaVersao(trx, artigoId, versao);
    const nova = {
      familias: [...new Set(classificacao.familias)].sort(),
      natureza_consumidor: classificacao.natureza_consumidor,
      modo: classificacao.modo ?? null,
      prestacao_inicio: classificacao.prestacao_inicio ?? null,
      prestacao_fim: classificacao.prestacao_fim ?? null,
      local_pais: classificacao.local_pais ?? null,
      local_territorio: classificacao.local_territorio ?? null,
      lazer_com_data: classificacao.lazer_com_data ?? false,
    };
    // A mesma classificação não sobe a versão (como em alterarArtigo; revisão
    // do #96, P3-2).
    const actual = await trx
      .selectFrom("artigo")
      .select([
        "familias",
        "natureza_consumidor",
        "modo",
        "prestacao_inicio",
        "prestacao_fim",
        "local_pais",
        "local_territorio",
        "lazer_com_data",
      ])
      .where("id", "=", artigoId)
      .executeTakeFirstOrThrow();
    if (mesmaClassificacao(actual, nova)) return versao;
    // Quem classificou: posto só nesta transacção (como no Comerciante); o
    // gatilho da 0006 escreve-o e recusa a mudança sem ele.
    await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
    const { versao: depois } = await trx
      .updateTable("artigo")
      .set(nova)
      .where("id", "=", artigoId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    return depois;
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
    const artigo = await artigoNaVersao(trx, artigoId, versao);
    // Já está nesse estado: nada muda e a versão fica (3.ª revisão, P3-1).
    if (artigo.estado === para) return versao;
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
  await noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const resultado = await trx
        .deleteFrom("artigo")
        .where("id", "=", artigoId)
        .executeTakeFirst();
      if (resultado.numDeletedRows === 0n) {
        throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
      }
    },
    { apagar: true },
  );
}

/** Acrescenta uma variante; também a um artigo arquivado (§4.1, opção a). */
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

/**
 * Procura uma variante pelo SKU, também arquivada (o SKU não volta, P7), sem
 * distinguir maiúsculas (P9, migração 0003).
 */
export async function varianteComSku(
  db: Kysely<BaseDados>,
  comercianteId: string,
  sku: string,
) {
  return noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("variante")
      .selectAll()
      // O comerciante explícito, além do RLS: o lower() não é «leakproof» e,
      // só com a política, o índice usava apenas o comerciante (revisão do
      // #80, P2-1).
      .where("comerciante_id", "=", comercianteId)
      .where(sql<string>`lower(sku)`, "=", sql<string>`lower(${sku})`)
      .executeTakeFirst(),
  );
}

export interface Componente {
  varianteId: string;
  quantidade: number;
}

/**
 * Substitui a composição do kit pela lista dada, pela ordem dada (§3.4; na
 * API, `PUT /variants/{id}/components`). Lista vazia: deixa de ser kit. A base
 * recusa ciclos, componentes novos arquivados e mexer num kit arquivado. Um
 * componente que já estava no kit fica (muda só a quantidade e a ordem), por
 * isso pode continuar mesmo arquivado (revisão do #81, P2-1).
 */
export async function definirComponentes(
  db: Kysely<BaseDados>,
  comercianteId: string,
  kitId: string,
  componentes: readonly Componente[],
): Promise<void> {
  const ids = componentes.map((c) => c.varianteId);
  if (new Set(ids).size !== ids.length) {
    throw new ErroCatalogo(
      "catalog.component_duplicate",
      "a mesma variante duas vezes na lista",
    );
  }
  await noCatalogo(db, comercianteId, async (trx) => {
    // Primeiro, o bloqueio do comerciante que o trigger também toma: as
    // substituições do mesmo comerciante ficam em fila num só ponto, antes de
    // prenderem linhas, e duas cruzadas (X em Y e Y em X) não se bloqueiam
    // uma à outra (revisão do #81, P2-2).
    // A chave na forma canónica do uuid, a mesma do trigger, seja qual for a
    // forma como o id chegou (revisão do #81, 2.ª, P3-2).
    await sql`select pg_advisory_xact_lock(hashtextextended('eurolify.componente:' || ${comercianteId}::uuid::text, 0))`.execute(
      trx,
    );
    // A linha do kit fica presa até ao fim.
    const kit = await trx
      .selectFrom("variante")
      .select("id")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", kitId)
      .forUpdate()
      .executeTakeFirst();
    if (kit === undefined) {
      throw new ErroCatalogo("catalog.not_found", `variante ${kitId}`);
    }
    // Os componentes têm de existir neste comerciante (o RLS esconde os de
    // outro, que contam como inexistentes). Não se prendem aqui: o trigger
    // prende cada componente novo (FOR SHARE) ao inseri-lo; se um for apagado
    // entre esta leitura e o INSERT, a chave estrangeira recusa e o erro é
    // «não existe» (revisão do #81, 2.ª, P2-3).
    if (ids.length > 0) {
      const existem = await trx
        .selectFrom("variante")
        .select("id")
        .where("comerciante_id", "=", comercianteId)
        .where("id", "in", ids)
        .execute();
      if (existem.length !== ids.length) {
        throw new ErroCatalogo("catalog.not_found", "componente inexistente");
      }
    }
    const actuais = new Set(
      (
        await trx
          .selectFrom("componente")
          .select("componente_id")
          .where("comerciante_id", "=", comercianteId)
          .where("kit_id", "=", kitId)
          .execute()
      ).map((l) => l.componente_id),
    );
    const sair = [...actuais].filter((id) => !ids.includes(id));
    if (sair.length > 0) {
      await trx
        .deleteFrom("componente")
        .where("comerciante_id", "=", comercianteId)
        .where("kit_id", "=", kitId)
        .where("componente_id", "in", sair)
        .execute();
    }
    let posicao = 0;
    for (const componente of componentes) {
      if (actuais.has(componente.varianteId)) {
        await trx
          .updateTable("componente")
          .set({ quantidade: componente.quantidade, posicao })
          .where("comerciante_id", "=", comercianteId)
          .where("kit_id", "=", kitId)
          .where("componente_id", "=", componente.varianteId)
          .execute();
      } else {
        await trx
          .insertInto("componente")
          .values({
            comerciante_id: comercianteId,
            kit_id: kitId,
            componente_id: componente.varianteId,
            quantidade: componente.quantidade,
            posicao,
          })
          .execute();
      }
      posicao += 1;
    }
  });
}

/** A composição do kit, pela ordem; vazia se a variante não é kit. */
export async function componentesDoKit(
  db: Kysely<BaseDados>,
  comercianteId: string,
  kitId: string,
): Promise<Componente[]> {
  const linhas = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("componente")
      .select(["componente_id", "quantidade"])
      .where("comerciante_id", "=", comercianteId)
      .where("kit_id", "=", kitId)
      .orderBy("posicao")
      .execute(),
  );
  return linhas.map((l) => ({
    varianteId: l.componente_id,
    quantidade: l.quantidade,
  }));
}

export interface Opcao {
  id: string;
  nome: string;
  valores: { id: string; valor: string }[];
}

/**
 * Cria uma opção do artigo com os valores dados, pela ordem (§3.3). Só num
 * rascunho (0005). Devolve a opção com os ids dos valores.
 */
export async function criarOpcao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  nome: string,
  valores: readonly string[],
): Promise<Opcao> {
  // Uma opção sem valores não deixava nenhuma variante completar-se (revisão
  // do #83, P3).
  if (valores.length === 0) {
    throw new ErroCatalogo(
      "catalog.option_values_required",
      "uma opção leva pelo menos um valor",
    );
  }
  return noCatalogo(db, comercianteId, async (trx) => {
    // A linha do artigo antes da fila dele, pela mesma ordem de quem apaga o
    // rascunho: a chave estrangeira da opção pede a linha do artigo, e o
    // trigger toma a fila antes dela — sem isto, criar uma opção e apagar o
    // rascunho podiam esperar um pelo outro (revisão do #83, 3.ª, P2-1).
    const artigo = await trx
      .selectFrom("artigo")
      .select("id")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", artigoId)
      .forKeyShare()
      .executeTakeFirst();
    if (artigo === undefined) {
      throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
    }
    await sql`select catalogo_fila_do_artigo(${comercianteId}::uuid, ${artigoId}::uuid)`.execute(
      trx,
    );
    const { n } = await trx
      .selectFrom("opcao")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("comerciante_id", "=", comercianteId)
      .where("artigo_id", "=", artigoId)
      .executeTakeFirstOrThrow();
    const opcao = await trx
      .insertInto("opcao")
      .values({
        comerciante_id: comercianteId,
        artigo_id: artigoId,
        nome,
        posicao: Number(n),
      })
      .returning(["id", "nome"])
      .executeTakeFirstOrThrow();
    const criados: { id: string; valor: string }[] = [];
    let posicao = 0;
    for (const valor of valores) {
      criados.push(
        await trx
          .insertInto("valor_opcao")
          .values({
            comerciante_id: comercianteId,
            artigo_id: artigoId,
            opcao_id: opcao.id,
            valor,
            posicao,
          })
          .returning(["id", "valor"])
          .executeTakeFirstOrThrow(),
      );
      posicao += 1;
    }
    return { ...opcao, valores: criados };
  });
}

/** Acrescenta um valor a uma opção, em qualquer estado do artigo. */
export async function acrescentarValor(
  db: Kysely<BaseDados>,
  comercianteId: string,
  opcaoId: string,
  valor: string,
): Promise<string> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const opcao = await trx
      .selectFrom("opcao")
      .select("artigo_id")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", opcaoId)
      .executeTakeFirst();
    if (opcao === undefined) {
      throw new ErroCatalogo("catalog.not_found", `opção ${opcaoId}`);
    }
    const { n } = await trx
      .selectFrom("valor_opcao")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("comerciante_id", "=", comercianteId)
      .where("opcao_id", "=", opcaoId)
      .executeTakeFirstOrThrow();
    const { id } = await trx
      .insertInto("valor_opcao")
      .values({
        comerciante_id: comercianteId,
        artigo_id: opcao.artigo_id,
        opcao_id: opcaoId,
        valor,
        posicao: Number(n),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
}

/** As opções do artigo com os valores, pela ordem. */
export async function opcoesDoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
): Promise<Opcao[]> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const opcoes = await trx
      .selectFrom("opcao")
      .select(["id", "nome"])
      .where("comerciante_id", "=", comercianteId)
      .where("artigo_id", "=", artigoId)
      .orderBy("posicao")
      .orderBy("criado_em")
      .execute();
    const valores = await trx
      .selectFrom("valor_opcao")
      .select(["id", "opcao_id", "valor"])
      .where("comerciante_id", "=", comercianteId)
      .where("artigo_id", "=", artigoId)
      .orderBy("posicao")
      .orderBy("criado_em")
      .execute();
    return opcoes.map((o) => ({
      ...o,
      valores: valores
        .filter((v) => v.opcao_id === o.id)
        .map(({ id, valor }) => ({ id, valor })),
    }));
  });
}

/**
 * Dá à variante os valores (um por opção), substituindo os que tinha. Num
 * artigo que já não é rascunho só se dão a uma variante sem valores (a que se
 * acabou de criar); a base verifica no fim a combinação (completa e sem
 * repetidos).
 */
export async function definirValoresDaVariante(
  db: Kysely<BaseDados>,
  comercianteId: string,
  varianteId: string,
  valorIds: readonly string[],
): Promise<void> {
  await noCatalogo(db, comercianteId, (trx) =>
    gravarValores(trx, comercianteId, varianteId, valorIds),
  );
}

async function gravarValores(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  varianteId: string,
  valorIds: readonly string[],
): Promise<void> {
  const variante = await trx
    .selectFrom("variante")
    .select(["artigo_id"])
    .where("comerciante_id", "=", comercianteId)
    .where("id", "=", varianteId)
    .executeTakeFirst();
  if (variante === undefined) {
    throw new ErroCatalogo("catalog.not_found", `variante ${varianteId}`);
  }
  // A fila do artigo antes de prender qualquer linha: os triggers só a tomam
  // depois de prender a linha que mudam, e quem apaga o rascunho toma-a antes
  // de prender as variantes — sem isto, os dois podiam esperar um pelo outro
  // (revisão do #83, 2.ª, P2-1).
  await sql`select catalogo_fila_do_artigo(${comercianteId}::uuid, ${variante.artigo_id}::uuid)`.execute(
    trx,
  );
  const unicos = [...new Set(valorIds)];
  const valores =
    unicos.length === 0
      ? []
      : await trx
          .selectFrom("valor_opcao")
          .select(["id", "opcao_id"])
          .where("comerciante_id", "=", comercianteId)
          .where("artigo_id", "=", variante.artigo_id)
          .where("id", "in", unicos)
          .execute();
  if (valores.length !== unicos.length) {
    throw new ErroCatalogo("catalog.not_found", "valor de opção inexistente");
  }
  const actuais = await trx
    .selectFrom("variante_valor")
    .select("opcao_id")
    .where("comerciante_id", "=", comercianteId)
    .where("variante_id", "=", varianteId)
    .execute();
  if (actuais.length > 0) {
    await trx
      .deleteFrom("variante_valor")
      .where("comerciante_id", "=", comercianteId)
      .where("variante_id", "=", varianteId)
      .execute();
  }
  for (const v of valores) {
    await trx
      .insertInto("variante_valor")
      .values({
        comerciante_id: comercianteId,
        artigo_id: variante.artigo_id,
        variante_id: varianteId,
        opcao_id: v.opcao_id,
        valor_id: v.id,
      })
      .execute();
  }
}

/**
 * Cria uma variante já com os valores das opções, na mesma transacção (num
 * artigo que não é rascunho, a combinação tem de ficar completa).
 */
export async function criarVarianteComValores(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  dados: DadosVariante,
  valorIds: readonly string[],
): Promise<string> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const { id } = await trx
      .insertInto("variante")
      .values({ comerciante_id: comercianteId, artigo_id: artigoId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow();
    await gravarValores(trx, comercianteId, id, valorIds);
    return id;
  });
}

/** Os ids dos valores da variante. */
export async function valoresDaVariante(
  db: Kysely<BaseDados>,
  comercianteId: string,
  varianteId: string,
): Promise<string[]> {
  const linhas = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("variante_valor")
      .select("valor_id")
      .where("comerciante_id", "=", comercianteId)
      .where("variante_id", "=", varianteId)
      .execute(),
  );
  return linhas.map((l) => l.valor_id).sort();
}
