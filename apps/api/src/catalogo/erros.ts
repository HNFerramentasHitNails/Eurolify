import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";

// Os erros do Catálogo e a transacção dele, num módulo próprio: a
// publicação usa-os sem importar o repositório, que chama a reverificação
// (revisão do #146, P3-2).

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
  | "catalog.tax_category_unknown"
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
  // A ordem pedida não é exactamente a lista de agora (docs/14 §7.1).
  | "catalog.order_mismatch"
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
  | "catalog.translation_self_review"
  | "catalog.publish_blocked"
  | "catalog.published_by_required"
  | "catalog.media_quota_exceeded"
  | "catalog.published_in_use"
  // Um campo de um artigo que vem do sistema de gestão, mudado pelo Hub
  // (P5; docs/22 §13.3): altera-se lá. Só as rotas /hub/ o lançam.
  | "catalog.external_field";

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
  // Publicação (0019).
  "catalog.publish_blocked",
  "catalog.published_by_required",
  "catalog.published_in_use",
  "catalog.not_found",
  "catalog.invalid_field",
  // Da 0040 (o fim da rede CM): a categoria fiscal tem de existir.
  "catalog.tax_category_unknown",
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
  artigo_selado_so_em_bens: "catalog.nature_incompatible",
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
  "publicacao",
  "ficheiro",
  "media",
]);

export interface OpcoesDeTraducao {
  /** A operação apaga variantes: `componente_em_uso` quer dizer «em uso». */
  apagar?: boolean;
  /** Uma consulta: transacção só de leitura, num só momento (P3-5, #150). */
  soLeitura?: boolean;
}

/** O texto de um valor que a base recusou, sem o texto do PostgreSQL. */
export const TEXTO_VALOR_RECUSADO = "um valor do pedido não é aceite";

/**
 * O texto de cada código que vem de uma restrição ou de uma coluna
 * obrigatória da base, para o `detail` da API: nunca o do PostgreSQL
 * (docs/18 §2), que traz o nome da restrição (revisão do #291, P2-2).
 * Não diz qual é o SKU ou o GTIN repetido (pedido do Hub no #77): pela API,
 * o erro da base chega sem o pormenor da chave (medido a 10/10/2026, no
 * PostgreSQL 18.6, com o RLS na tabela); quem precisar procura-o (o Hub,
 * docs/22 §14.2). A base não distingue maiúsculas no SKU.
 */
const TEXTO_DA_BASE: Partial<Record<CodigoErroCatalogo, string>> = {
  "catalog.sku_duplicate":
    "já existe uma variante com este SKU (sem distinguir maiúsculas)",
  "catalog.sku_invalid": "o SKU não tem um formato aceite",
  "catalog.sku_required": "falta o SKU",
  "catalog.gtin_duplicate":
    "já existe uma variante com este GTIN (com ou sem zeros à esquerda)",
  "catalog.gtin_invalid": "o GTIN não é válido",
  "catalog.gtin_origin_required":
    "o GTIN precisa da origem, e a origem do GTIN",
  "catalog.content_incomplete":
    "a quantidade e a unidade do conteúdo vão juntas",
  "catalog.origin_ref_required":
    "só um artigo de sistema externo tem a referência, e precisa dela",
  "catalog.name_required": "falta o nome",
  "catalog.unit_required": "falta a unidade de venda",
  "catalog.component_cycle": "um kit não pode ser componente de si próprio",
  "catalog.component_duplicate": "este componente já está no kit",
  "catalog.option_duplicate": "o artigo já tem uma opção com este nome",
  "catalog.option_value_duplicate": "a opção já tem um valor com este texto",
  "catalog.option_repeated": "a variante já tem um valor desta opção",
  "catalog.nature_incompatible": "a natureza não serve para o tipo do artigo",
  "catalog.classification_invalid": "a classificação do artigo não é válida",
  "catalog.slug_invalid": "o endereço amigável não tem um formato aceite",
  "catalog.slug_duplicate": "o endereço amigável já existe",
  "catalog.category_cycle": "uma categoria não pode ficar dentro de si própria",
  "catalog.category_duplicate": "o artigo já está nesta categoria",
  "catalog.collection_product_duplicate": "o artigo já está nesta colecção",
};

function textoDaBase(codigo: CodigoErroCatalogo): string {
  return TEXTO_DA_BASE[codigo] ?? TEXTO_VALOR_RECUSADO;
}

/** Exportada para os testes; o resto do código usa-a por `noCatalogo`. */
export function traduzir(
  erro: unknown,
  opcoes: OpcoesDeTraducao = {},
): unknown {
  if (!(erro instanceof Error)) return erro;
  // Já traduzido: fica como está, com a causa original (a API traduz outra
  // vez o que sai do COMMIT; revisão do #153, 2.ª ronda, P3-C).
  if (erro instanceof ErroCatalogo) return erro;
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
    return new ErroCatalogo(daRestricao, textoDaBase(daRestricao), {
      cause: erro,
    });
  }
  const daColuna =
    pg.column === undefined ? undefined : OBRIGATORIAS[pg.column];
  if (pg.code === "23502" && daColuna !== undefined) {
    return new ErroCatalogo(daColuna, textoDaBase(daColuna), {
      cause: erro,
    });
  }
  // Outro valor recusado nestas tabelas (uma lista, um número): código
  // genérico (revisão do #78, 2.ª, P2-2).
  if (
    (pg.code === "23514" || pg.code === "23502") &&
    pg.table !== undefined &&
    TABELAS.has(pg.table)
  ) {
    return new ErroCatalogo("catalog.invalid_field", TEXTO_VALOR_RECUSADO, {
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
    return new ErroCatalogo(
      codigoDeValor,
      codigoDeValor === "catalog.not_found"
        ? "referência inexistente"
        : TEXTO_VALOR_RECUSADO,
      { cause: erro },
    );
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
  // 55P03: uma espera por um lock passou o `lock_timeout` (noCatalogo;
  // revisão do #139, P2-4).
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
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

/** O tempo máximo que uma operação espera por um lock (`lock_timeout`). */
export const ESPERA_MAXIMA = "5s";

/**
 * Corre `fn` no contexto do comerciante e traduz os erros do Catálogo.
 * Exportada só para os outros ficheiros do domínio (categorias.ts).
 *
 * Com uma transacção já aberta (a da idempotência de uma escrita da API,
 * docs/18 §4), corre nela, para a escrita e a resposta guardada irem juntas;
 * só a aceita se for do mesmo comerciante (o `eurolify.comerciante` dela).
 * Aí o `soLeitura` não se aplica: a transacção é de quem a abriu.
 */
export async function noCatalogo<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
  opcoes: OpcoesDeTraducao = {},
): Promise<T> {
  if (db.isTransaction) {
    const trx = db as Transaction<BaseDados>;
    try {
      const { rows } = await sql<{ comerciante: string | null }>`
        select current_setting('eurolify.comerciante', true) as comerciante`.execute(
        trx,
      );
      if (rows[0]?.comerciante !== comercianteId) {
        throw new Error(
          "noCatalogo: a transacção aberta é de outro comerciante (ou de nenhum)",
        );
      }
      await sql`select set_config('lock_timeout', ${ESPERA_MAXIMA}, true)`.execute(
        trx,
      );
      return await fn(trx);
    } catch (erro) {
      throw traduzir(erro, opcoes);
    }
  }
  try {
    return await comComerciante(
      db,
      comercianteId,
      async (trx) => {
        // Uma escrita não espera sem fim por outra que tenha o artigo, a
        // publicação ou um preço tomados: ao fim do prazo, `catalog.retry`
        // (revisão do #139, P2-4).
        await sql`select set_config('lock_timeout', ${ESPERA_MAXIMA}, true)`.execute(
          trx,
        );
        return fn(trx);
      },
      { soLeitura: opcoes.soLeitura === true },
    );
  } catch (erro) {
    throw traduzir(erro, opcoes);
  }
}
