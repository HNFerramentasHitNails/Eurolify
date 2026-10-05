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
  | "catalog.component_in_use";

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
};

/** Colunas obrigatórias com código próprio (§7.1: C3). */
const OBRIGATORIAS: Readonly<Record<string, CodigoErroCatalogo>> = {
  nome: "catalog.name_required",
  sku: "catalog.sku_required",
  unidade_de_venda: "catalog.unit_required",
};

/** As tabelas deste domínio, para os erros que só se traduzem quando vêm delas. */
const TABELAS = new Set(["artigo", "variante", "componente"]);

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
  // Uma chave estrangeira que falha: o artigo (ou o comerciante) não existe
  // ou é de outro comerciante — o RLS esconde-o igual, sem oráculo.
  if (pg.code === "23503" && pg.table !== undefined && TABELAS.has(pg.table)) {
    return new ErroCatalogo("catalog.not_found", "referência inexistente", {
      cause: erro,
    });
  }
  return erro;
}

/** Corre `fn` no contexto do comerciante e traduz os erros do Catálogo. */
async function noCatalogo<T>(
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
    await sql`select pg_advisory_xact_lock(hashtextextended(${
      "eurolify.componente:" + comercianteId
    }, 0))`.execute(trx);
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
    // outro, que contam como inexistentes); presos até ao fim, para não se
    // apagarem entretanto.
    if (ids.length > 0) {
      const existem = await trx
        .selectFrom("variante")
        .select("id")
        .where("comerciante_id", "=", comercianteId)
        .where("id", "in", ids)
        .forShare()
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
