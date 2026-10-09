import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql, type Kysely, type Transaction } from "kysely";
import { Type, type Static, type TSchema } from "typebox";
import { erroBase, ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import {
  ESTADOS_ARTIGO,
  ESTADOS_PUBLICACAO,
  ESTADOS_VARIANTE,
  FAMILIAS_SETORIAIS,
  MODOS,
  MOTIVOS_ARQUIVO_PUBLICACAO,
  NATUREZAS_CONSUMIDOR,
  TIPOS_ARTIGO,
  ORIGENS_GTIN,
  UNIDADES_DE_CONTEUDO,
  UNIDADES_DE_VENDA,
  type BaseDados,
} from "../base/esquema.js";
import {
  comIdempotencia,
  type PedidoIdempotente,
} from "../base/idempotencia.js";
import { chaveDo } from "../identidade/autenticacao.js";
import type { ContextoChave } from "../identidade/repositorio.js";
import {
  CabecalhoIdempotencia,
  caminhoDe,
  chaveDeIdempotencia,
} from "../identidade/rotas.js";
import {
  CAMPOS_TRADUZIVEIS,
  filaDeTraducoesPaginada,
  recursoTraduzivel,
  traducoesParaApi,
  type PosicaoNaFila,
  type RecursoTraduzivel,
  artigosDaColecaoPaginados,
  categoriasDoArtigoParaApi,
  categoriasPorId,
  colecoesPorId,
  fichaDaCategoria,
  fichaDaColecao,
  listarCategoriasOuColecoes,
  composicaoDoKit,
  fichaDaOpcao,
  fichaDaVariante,
  fichaDoArtigo,
  listarArtigos,
  opcoesDoArtigoPaginadas,
  procurarVariantes,
  variantesDoArtigo,
  type PosicaoEId,
  type PosicaoNaLista,
} from "./consultas.js";
import { ErroCatalogo, traduzir } from "./erros.js";
import { apagarTraducao, definirTraducao } from "./traducoes.js";
import {
  NAO_VERIFICADO,
  publicacoesDoArtigo,
  publicar,
  retirarPublicacao,
  verificarPublicacao,
  type Publicacao,
} from "./publicacao.js";
import {
  alterarCategoria,
  alterarColecao,
  criarCategoria,
  criarColecao,
  definirArtigosDaColecao,
  definirCategoriasDoArtigo,
  moverCategoria,
  mudarEstadoCategoria,
  mudarEstadoColecao,
} from "./categorias.js";
import {
  alterarArtigo,
  apagarRascunho,
  acrescentarValor,
  arquivarVariante,
  classificarArtigo,
  criarArtigo,
  criarOpcao,
  criarVarianteComValores,
  definirComponentes,
  mudarEstadoArtigo,
} from "./repositorio.js";

// API de Administração do Catálogo (docs/14 §7.1), por partes, todas pedidas
// pelo Diogo a 07/10/2026: 1, as consultas (#150); 2, as escritas dos
// artigos e das publicações, com a Idempotency-Key (docs/18 §4; #153); 3, as
// variantes (#159); 4, as opções e a composição dos kits (#161); 5, as
// traduções (#166); 6, as categorias e as colecções. Cada rota pede o seu âmbito (`catalog:read`,
// `catalog:write` ou `catalog:publish`).

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const idCom = (prefixo: string, descricao: string) =>
  Type.String({ pattern: `^${prefixo}_${UUID}$`, description: descricao });
export const semPrefixo = (id: string) => id.slice(id.indexOf("_") + 1);

/**
 * Uma lista fechada de valores, com o tipo deles (o `Type.Union` de uma
 * lista feita com `map` perde o tipo dos literais no TypeScript).
 */
export const umDe = <T extends string>(valores: readonly T[]) =>
  Type.Unsafe<T>({ type: "string", enum: [...valores] });
const EstadoArtigo = umDe(ESTADOS_ARTIGO);
const TipoArtigo = umDe(TIPOS_ARTIGO);
const EstadoVariante = umDe(ESTADOS_VARIANTE);
const UnidadeDeVenda = umDe(UNIDADES_DE_VENDA);
const Familia = umDe(FAMILIAS_SETORIAIS);
const Natureza = umDe(NATUREZAS_CONSUMIDOR);
const Modo = umDe(MODOS);
const EstadoPublicacao = umDe(ESTADOS_PUBLICACAO);
const MotivoArquivo = umDe(MOTIVOS_ARQUIVO_PUBLICACAO);
const NaoVerificado = umDe(NAO_VERIFICADO);
export const Instante = Type.String({ format: "date-time" });
export const iso = (d: Date | null) => (d === null ? null : d.toISOString());

// ------------------------------------------------------------ Os erros

/**
 * O estado HTTP de cada código do Catálogo (**proposta**, docs/14 §7.1):
 * 404 o que não existe, 409 o que choca com o estado ou com outro registo,
 * 422 o que o servidor recusa por regra, 400 um valor mal formado, 503 o
 * repetível. Todos os códigos estão aqui: o compilador obriga a decidir cada
 * código novo (revisão do #150, P3-1).
 */
const ESTADO_DO_CODIGO: Record<ErroCatalogo["codigo"], number> = {
  "catalog.not_found": 404,
  "catalog.invalid_field": 400,
  "catalog.retry": 503,
  "catalog.version_conflict": 409,
  "catalog.invalid_transition": 409,
  "catalog.not_draft": 409,
  "catalog.variant_archived_is_final": 409,
  "catalog.sku_duplicate": 409,
  "catalog.gtin_duplicate": 409,
  "catalog.option_combination_duplicate": 409,
  "catalog.option_duplicate": 409,
  "catalog.option_value_duplicate": 409,
  "catalog.component_in_use": 409,
  "catalog.category_has_children": 409,
  "catalog.slug_duplicate": 409,
  "catalog.publish_blocked": 409,
  "catalog.published_in_use": 409,
  "catalog.type_disabled": 422,
  "catalog.immutable_identity": 422,
  "catalog.immutable_type": 422,
  "catalog.no_variants": 422,
  "catalog.name_required": 422,
  "catalog.origin_ref_required": 422,
  "catalog.sku_required": 422,
  "catalog.sku_invalid": 422,
  "catalog.unit_required": 422,
  "catalog.gtin_invalid": 422,
  "catalog.gtin_origin_required": 422,
  "catalog.content_incomplete": 422,
  "catalog.component_cycle": 422,
  "catalog.component_archived": 422,
  "catalog.component_duplicate": 422,
  "catalog.options_incomplete": 422,
  "catalog.option_repeated": 422,
  "catalog.option_values_required": 422,
  "catalog.classified_by_required": 422,
  "catalog.classification_invalid": 422,
  "catalog.nature_incompatible": 422,
  "catalog.category_cycle": 422,
  "catalog.category_archived": 422,
  "catalog.category_duplicate": 422,
  "catalog.slug_invalid": 422,
  "catalog.collection_product_duplicate": 422,
  "catalog.translated_by_required": 422,
  "catalog.translation_same_language": 422,
  "catalog.translation_no_original": 422,
  "catalog.translation_not_ai": 422,
  "catalog.translation_self_review": 422,
  "catalog.published_by_required": 422,
  // O espaço das imagens do comerciante acabou (docs/14 §3.5, **proposta**).
  "catalog.media_quota_exceeded": 409,
};

/**
 * Um erro do Catálogo no formato da API (RFC 9457, docs/18 §2), com o código
 * estável; outro erro passa como está (e dá 500 sem pormenor).
 */
function paraApi(erro: unknown): unknown {
  if (!(erro instanceof ErroCatalogo)) return erro;
  const status = ESTADO_DO_CODIGO[erro.codigo];
  const mensagens =
    erro.codigo === "catalog.not_found"
      ? { pt: "Não encontrado", en: "Not found" }
      : erro.codigo === "catalog.retry"
        ? {
            pt: "Outra operação tinha o registo tomado; tente outra vez",
            en: "Another operation held the record; try again",
          }
        : {
            pt: "Pedido recusado pelo Catálogo",
            en: "Rejected by the catalog",
          };
  // Um valor que a base recusou traz o texto do PostgreSQL: não sai para
  // fora (docs/18 §2: nunca SQL; revisão do #150, P3-3).
  const daBase =
    typeof (erro.cause as { code?: unknown } | undefined)?.code === "string";
  const detalhe =
    erro.codigo === "catalog.invalid_field" && daBase
      ? "um valor do pedido não é aceite"
      : erro.message;
  return new ErroApi(erro.codigo, status, mensagens, detalhe);
}

/**
 * Corre a consulta e devolve os erros do Catálogo no formato da API; um
 * `catalog.retry` leva `Retry-After: 1` (revisão do #150, P3-2).
 */
export async function noCatalogoApi<T>(
  resposta: FastifyReply,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (erroOriginal) {
    // Um erro que sai fora do `noCatalogo` (o COMMIT da transacção da
    // idempotência: uma restrição diferida, um conflito de serialização)
    // também se traduz (revisão do #153, P2-3). Um ErroCatalogo passa igual.
    const erro = traduzir(erroOriginal);
    if (erro instanceof ErroCatalogo && erro.codigo === "catalog.retry") {
      void resposta.header("Retry-After", "1");
    }
    throw paraApi(erro);
  }
}

// ---------------------------------------------------------- Os esquemas

const Variante = Type.Object({
  id: Type.String({ description: "var_…" }),
  sku: Type.String(),
  estado: EstadoVariante,
  unidade_de_venda: UnidadeDeVenda,
  gtin: Type.Union([Type.String(), Type.Null()]),
  gtin_origem: Type.Union([Type.String(), Type.Null()]),
  conteudo_quantidade: Type.Union([Type.Number(), Type.Null()]),
  conteudo_unidade: Type.Union([Type.String(), Type.Null()]),
  peso_g: Type.Union([Type.Integer(), Type.Null()]),
  comprimento_mm: Type.Union([Type.Integer(), Type.Null()]),
  largura_mm: Type.Union([Type.Integer(), Type.Null()]),
  altura_mm: Type.Union([Type.Integer(), Type.Null()]),
  onu: Type.Union([Type.String(), Type.Null()]),
  classe_adr: Type.Union([Type.String(), Type.Null()]),
  posicao: Type.Integer(),
  criado_em: Instante,
});

const CamposArtigo = {
  id: Type.String({ description: "prd_…" }),
  tipo: TipoArtigo,
  estado: EstadoArtigo,
  nome: Type.String(),
  descricao: Type.Union([Type.String(), Type.Null()]),
  marca: Type.Union([Type.String(), Type.Null()]),
  categoria_fiscal: Type.Union([Type.String(), Type.Null()]),
  origem: Type.String(),
  origem_ref: Type.Union([Type.String(), Type.Null()]),
  classificacao: Type.Object({
    familias: Type.Array(Familia),
    natureza_consumidor: Type.Union([Natureza, Type.Null()]),
    modo: Type.Union([Modo, Type.Null()]),
    prestacao_inicio: Type.Union([Instante, Type.Null()]),
    prestacao_fim: Type.Union([Instante, Type.Null()]),
    local_pais: Type.Union([Type.String(), Type.Null()]),
    local_territorio: Type.Union([Type.String(), Type.Null()]),
    lazer_com_data: Type.Boolean(),
    classificado_em: Type.Union([Instante, Type.Null()]),
  }),
  versao: Type.Integer(),
  criado_em: Instante,
  actualizado_em: Instante,
};
const ResumoArtigo = Type.Object(CamposArtigo);
const Artigo = Type.Object({
  ...CamposArtigo,
  variantes: Type.Array(Variante),
});

/** A variante sozinha: com o artigo e os valores das opções (`ovl_…`). */
const VarianteCompleta = Type.Object({
  ...Variante.properties,
  artigo: Type.String({ description: "prd_…" }),
  valores: Type.Array(Type.String({ description: "ovl_…" }), {
    description:
      "Os valores das opções da variante, um por opção do artigo (§3.3); vazio num artigo sem opções",
  }),
});

/** O formato das listas (docs/18 §2a), com variantes. */
const RespostaVariantes = Type.Object({
  dados: Type.Array(VarianteCompleta),
  total: Type.Integer({
    minimum: 0,
    description: "Quantas há ao todo, não só nesta página",
  }),
  ha_mais: Type.Boolean(),
  cursor_seguinte: Type.Union([Type.String(), Type.Null()], {
    description: "Para pedir a página seguinte (`cursor`); nulo na última",
  }),
});

/** O formato das listas (docs/18 §2a), com os itens dados. */
export const Lista = <T extends TSchema>(item: T) =>
  Type.Object({
    dados: Type.Array(item),
    total: Type.Integer({
      minimum: 0,
      description: "Quantos há ao todo, não só nesta página",
    }),
    ha_mais: Type.Boolean(),
    cursor_seguinte: Type.Union([Type.String(), Type.Null()], {
      description: "Para pedir a página seguinte (`cursor`); nulo na última",
    }),
  });

const OpcaoEsquema = Type.Object({
  id: Type.String({ description: "opt_…" }),
  artigo: Type.String({ description: "prd_…" }),
  nome: Type.String(),
  posicao: Type.Integer(),
  valores: Type.Array(
    Type.Object({
      id: Type.String({ description: "ovl_…" }),
      valor: Type.String(),
    }),
    { description: "Pela ordem (posição)" },
  ),
});

const ComponenteEsquema = Type.Object({
  variante: Type.String({ description: "var_… (o componente)" }),
  quantidade: Type.Integer({ minimum: 1 }),
  estado: EstadoVariante,
});

export const RespostaArtigos = Type.Object({
  dados: Type.Array(ResumoArtigo),
  total: Type.Integer({
    description: "Quantos artigos passam no filtro, em todas as páginas",
  }),
  ha_mais: Type.Boolean(),
  cursor_seguinte: Type.Union([Type.String(), Type.Null()], {
    description: "Para pedir a página seguinte (`cursor`); nulo na última",
  }),
});

export const ConsultaArtigos = Type.Object(
  {
    estado: Type.Optional(EstadoArtigo),
    tipo: Type.Optional(TipoArtigo),
    // Sem caracteres de controlo (o NUL a base recusa com texto dela;
    // revisão do #150, P3-3).
    sku: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 64,
        pattern: "^[^\\x00-\\x1f]+$",
      }),
    ),
    texto: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: "^[^\\x00-\\x1f]+$",
      }),
    ),
    categoria: Type.Optional(
      idCom(
        "cat",
        "cat_…: os artigos nessa categoria (não nas subcategorias); uma que não existe dá catalog.not_found",
      ),
    ),
    traducao_em_falta: Type.Optional(
      Type.String({
        pattern: "^[a-z]{2}$",
        description:
          "Uma língua (ISO 639-1): os artigos com o nome ou a descrição por traduzir nela (em falta ou desactualizada), como na fila de traduções; a língua de origem dá catalog.translation_same_language",
      }),
    ),
    actualizado_desde: Type.Optional(
      Type.String({
        format: "date-time",
        description:
          "Os artigos alterados (actualizado_em) a partir deste instante, inclusive; com o fuso (ex.: 2026-10-08T00:00:00Z)",
      }),
    ),
    limite: Type.Optional(
      Type.String({
        pattern: "^[1-9][0-9]?$|^100$",
        description: "1 a 100; por omissão, 25",
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        pattern: "^[A-Za-z0-9_-]{1,64}$",
        description: "O `cursor_seguinte` da página anterior",
      }),
    ),
  },
  { additionalProperties: false },
);

export const ParametroArtigo = Type.Object({ id: idCom("prd", "prd_…") });

const Impedimento = Type.Object(
  { codigo: Type.String() },
  {
    additionalProperties: true,
    description:
      "Um impedimento da verificação C2 (docs/14 §5): o código e, conforme o caso, as variantes (SKU), as línguas ou o que falta",
  },
);
const Verificacao = Type.Object({
  impedimentos: Type.Array(Impedimento),
  nao_verificado: Type.Array(NaoVerificado, {
    description:
      "O que a verificação ainda não sabe ver (docs/06, CF e CR): «sem impedimentos» não quer dizer «conforme»",
  }),
});

/**
 * A verificação guardada numa publicação: a lista do que não se verificava é
 * a do momento em que se guardou: uma linha de antes de 08/10/2026 diz
 * ainda `media`, que passou a verificar-se (CF e CR). Aqui fica aberta, para uma linha antiga não
 * dar 500 (revisão do #150, P2-3).
 */
const VerificacaoGuardada = Type.Object({
  impedimentos: Type.Array(Impedimento),
  nao_verificado: Type.Array(Type.String()),
});

const PublicacaoEsquema = Type.Object({
  id: Type.String({ description: "pub_…" }),
  artigo: Type.String({ description: "prd_…" }),
  canal: Type.String({ description: "chn_…" }),
  mercado: Type.String({ description: "mkt_…" }),
  estado: EstadoPublicacao,
  variantes_fora: Type.Array(Type.String({ description: "var_…" })),
  ultima_verificacao: Type.Union([VerificacaoGuardada, Type.Null()], {
    description:
      "A do último pedido de publicação, também se foi recusado (docs/14 §4.2)",
  }),
  verificado_em: Type.Union([Instante, Type.Null()]),
  publicado_em: Type.Union([Instante, Type.Null()]),
  arquivado_em: Type.Union([Instante, Type.Null()]),
  motivo_arquivo: Type.Union([MotivoArquivo, Type.Null()]),
  versao: Type.Integer(),
});
const RespostaPublicacoes = Type.Object({
  dados: Type.Array(PublicacaoEsquema),
});

const PedidoVerificar = Type.Object(
  {
    canal: idCom("chn", "chn_…"),
    mercado: idCom("mkt", "mkt_…"),
    variantes_fora: Type.Optional(
      Type.Array(idCom("var", "var_…"), { maxItems: 500 }),
    ),
  },
  { additionalProperties: false },
);

// ---------------------------------------------- Os esquemas das escritas

const Texto = (max: number) =>
  Type.String({ minLength: 1, maxLength: max, pattern: "\\S" });
const TextoOuNulo = (max: number) =>
  Type.Union([Type.String({ maxLength: max }), Type.Null()]);
/** Uma medida: inteiro positivo, como a base o pede (0002). */
const Medida = Type.Union([
  Type.Integer({ minimum: 1, maximum: 2147483647 }),
  Type.Null(),
]);
/** O código da categoria fiscal, no formato da base (0002). */
const CategoriaFiscal = Type.Union([
  Type.String({ pattern: "^[a-z][a-z0-9_]*$", maxLength: 64 }),
  Type.Null(),
]);

export const NovaVariante = Type.Object(
  {
    sku: Texto(64),
    unidade_de_venda: UnidadeDeVenda,
    gtin: Type.Optional(
      Type.Union([
        Type.String({ pattern: "^([0-9]{8}|[0-9]{12,14})$" }),
        Type.Null(),
      ]),
    ),
    gtin_origem: Type.Optional(Type.Union([umDe(ORIGENS_GTIN), Type.Null()])),
    conteudo_quantidade: Type.Optional(Medida),
    conteudo_unidade: Type.Optional(
      Type.Union([umDe(UNIDADES_DE_CONTEUDO), Type.Null()]),
    ),
    peso_g: Type.Optional(Medida),
    comprimento_mm: Type.Optional(Medida),
    largura_mm: Type.Optional(Medida),
    altura_mm: Type.Optional(Medida),
    onu: Type.Optional(
      Type.Union([Type.String({ pattern: "^UN[0-9]{4}$" }), Type.Null()]),
    ),
    classe_adr: Type.Optional(
      Type.Union([
        Type.String({ minLength: 1, maxLength: 16, pattern: "\\S" }),
        Type.Null(),
      ]),
    ),
    posicao: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 2147483647,
        description:
          "A ordem na ficha (as variantes lêem-se por posição e SKU)",
      }),
    ),
  },
  { additionalProperties: false },
);

/** Quantas variantes um artigo novo traz de uma vez (a criação e a importação). */
export const MAX_VARIANTES_POR_ARTIGO_NOVO = 100;

/** Os campos do artigo, como se criam (também os valida a importação). */
export const CamposDoArtigo = Type.Object({
  tipo: TipoArtigo,
  nome: Texto(200),
  descricao: Type.Optional(TextoOuNulo(10000)),
  marca: Type.Optional(TextoOuNulo(200)),
  categoria_fiscal: Type.Optional(CategoriaFiscal),
});

const PedidoCriarArtigo = Type.Object(
  {
    ...CamposDoArtigo.properties,
    variantes: Type.Array(NovaVariante, {
      minItems: 1,
      maxItems: MAX_VARIANTES_POR_ARTIGO_NOVO,
    }),
  },
  { additionalProperties: false },
);

const PedidoCriarVariante = Type.Object(
  {
    ...NovaVariante.properties,
    valores: Type.Optional(
      Type.Array(idCom("ovl", "ovl_…"), {
        maxItems: 20,
        uniqueItems: true,
        description:
          "Um valor por opção do artigo (§3.3). Num artigo com opções que já não é rascunho, a combinação tem de ficar completa e não repetida",
      }),
    ),
  },
  { additionalProperties: false },
);

const ParametroVariante = Type.Object({ id: idCom("var", "var_…") });

const ConsultaVariantesDoArtigo = Type.Object(
  {
    limite: Type.Optional(
      Type.String({
        pattern: "^[1-9][0-9]?$|^100$",
        description: "1 a 100; por omissão, 25",
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        pattern: "^[A-Za-z0-9_-]{1,400}$",
        description: "O `cursor_seguinte` da página anterior",
      }),
    ),
  },
  { additionalProperties: false },
);

const ConsultaVariantes = Type.Object(
  {
    sku: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 64,
        pattern: "^[^\\x00-\\x1f]+$",
      }),
    ),
    gtin: Type.Optional(
      Type.String({
        pattern: "^([0-9]{8}|[0-9]{12,14})$",
        description: "8, 12, 13 ou 14 dígitos; os zeros à esquerda não contam",
      }),
    ),
  },
  { additionalProperties: false },
);

export const ConsultaPagina = Type.Object(
  {
    limite: Type.Optional(
      Type.String({
        pattern: "^[1-9][0-9]?$|^100$",
        description: "1 a 100; por omissão, 25",
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        pattern: "^[A-Za-z0-9_-]{1,200}$",
        description: "O `cursor_seguinte` da página anterior",
      }),
    ),
  },
  { additionalProperties: false },
);

const PedidoCriarOpcao = Type.Object(
  {
    nome: Texto(100),
    valores: Type.Array(Texto(100), {
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      description: "Pelo menos um valor, pela ordem (§3.3)",
    }),
  },
  { additionalProperties: false },
);

const PedidoAcrescentarValor = Type.Object(
  { valor: Texto(100) },
  { additionalProperties: false },
);

const ParametroOpcao = Type.Object({ id: idCom("opt", "opt_…") });

const PedidoComposicao = Type.Object(
  {
    componentes: Type.Array(
      Type.Object(
        {
          variante: idCom("var", "var_…"),
          quantidade: Type.Integer({ minimum: 1, maximum: 2147483647 }),
        },
        { additionalProperties: false },
      ),
      {
        maxItems: 100,
        description:
          "A composição inteira, pela ordem; vazia, a variante deixa de ser kit",
      },
    ),
  },
  { additionalProperties: false },
);

/** O prefixo de cada recurso traduzível (docs/14 §3). */
const PREFIXO_DO_RECURSO = {
  artigo: "prd",
  opcao: "opt",
  valor_opcao: "ovl",
  categoria: "cat",
  colecao: "col",
} as const satisfies Record<RecursoTraduzivel, string>;
const RECURSO_DO_PREFIXO = Object.fromEntries(
  Object.entries(PREFIXO_DO_RECURSO).map(([tipo, prefixo]) => [prefixo, tipo]),
) as Record<string, RecursoTraduzivel>;

const IdRecurso = Type.String({
  pattern: `^(prd|opt|ovl|cat|col)_${UUID}$`,
  description: "prd_…, opt_…, ovl_…, cat_… ou col_…",
});
const Lingua = Type.String({
  pattern: "^[a-z]{2}$",
  description: "ISO 639-1, em minúsculas (ex.: es)",
});
const CampoTraduzivel = umDe([
  "nome",
  "descricao",
  "valor",
  "endereco_amigavel",
] as const);

const ParametrosTraducao = Type.Object({
  recurso: IdRecurso,
  campo: CampoTraduzivel,
  lingua: Lingua,
});

const ConsultaTraducoes = Type.Object(
  {
    resource: Type.Optional(IdRecurso),
    locale: Type.Optional(Lingua),
    estado: Type.Optional(
      Type.String({
        pattern: "^(em_falta|desactualizada)(,(em_falta|desactualizada))?$",
        description:
          "Só na fila: em_falta, desactualizada, ou as duas separadas por vírgula (por omissão, as duas)",
      }),
    ),
    limite: Type.Optional(
      Type.String({
        pattern: "^[1-9][0-9]?$|^100$",
        description: "Só na fila: 1 a 100; por omissão, 25",
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        pattern: "^[A-Za-z0-9_-]{1,400}$",
        description: "Só na fila: o `cursor_seguinte` da página anterior",
      }),
    ),
  },
  { additionalProperties: false },
);

const TraducaoEsquema = Type.Object({
  recurso: Type.String({ description: "prd_…, opt_…, ovl_…, cat_… ou col_…" }),
  campo: Type.String(),
  lingua: Type.String(),
  texto: Type.String(),
  estado: umDe(["completa", "desactualizada"] as const),
  origem: umDe(["pessoa", "ia"] as const),
  revista: Type.Boolean({
    description:
      "Só uma proposta de IA se revê, no Hub, por uma pessoa (não por chave); uma de pessoa fica falsa",
  }),
  traduzida_em: Instante,
  revista_em: Type.Union([Instante, Type.Null()]),
});

const PorTraduzirEsquema = Type.Object({
  recurso: Type.String({ description: "prd_…, opt_…, ovl_…, cat_… ou col_…" }),
  campo: Type.String(),
  estado: umDe(["em_falta", "desactualizada"] as const),
});

const PedidoTraduzir = Type.Object(
  {
    texto: Type.String({
      minLength: 1,
      maxLength: 20000,
      pattern: "\\S",
      description:
        "Nome e valor até 200 caracteres; descrição até 20 000; endereço amigável no formato da base",
    }),
    original_visto: Type.String({
      maxLength: 20000,
      description:
        "O texto original que quem traduziu viu; se entretanto mudou, catalog.version_conflict",
    }),
  },
  { additionalProperties: false },
);

const ComVersao = { versao: Type.Integer({ minimum: 1 }) };

const PedidoAlterarArtigo = Type.Object(
  {
    ...ComVersao,
    nome: Type.Optional(Texto(200)),
    descricao: Type.Optional(TextoOuNulo(10000)),
    marca: Type.Optional(TextoOuNulo(200)),
    categoria_fiscal: Type.Optional(CategoriaFiscal),
  },
  { additionalProperties: false },
);

const PedidoClassificar = Type.Object(
  {
    ...ComVersao,
    familias: Type.Array(Familia, { maxItems: 20 }),
    natureza_consumidor: Type.Union([Natureza, Type.Null()]),
    modo: Type.Optional(Type.Union([Modo, Type.Null()])),
    prestacao_inicio: Type.Optional(Type.Union([Instante, Type.Null()])),
    prestacao_fim: Type.Optional(Type.Union([Instante, Type.Null()])),
    local_pais: Type.Optional(
      Type.Union([Type.String({ pattern: "^[A-Z]{2}$" }), Type.Null()]),
    ),
    local_territorio: Type.Optional(TextoOuNulo(64)),
    lazer_com_data: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const PedidoVersao = Type.Object(ComVersao, {
  additionalProperties: false,
});

const PedidoPublicar = Type.Object(
  {
    canal: idCom("chn", "chn_…"),
    mercado: idCom("mkt", "mkt_…"),
    variantes_fora: Type.Optional(
      Type.Array(idCom("var", "var_…"), { maxItems: 500 }),
    ),
  },
  { additionalProperties: false },
);

const ParametroPublicacao = Type.Object({ id: idCom("pub", "pub_…") });

const RespostaPublicar = Type.Object({
  publicada: Type.Boolean({
    description:
      "Falso com impedimentos: nada muda além da verificação guardada (docs/14 §4.2)",
  }),
  verificacao: Verificacao,
  publicacao: Type.Union([PublicacaoEsquema, Type.Null()], {
    description:
      "Nula quando o canal não vende no mercado ou o artigo está em rascunho: não há onde a publicação exista",
  }),
});

// -------------------------------------------------------- As conversões

type FichaDoArtigo = Awaited<ReturnType<typeof fichaDoArtigo>>;
type LinhaArtigo = FichaDoArtigo["artigo"];
type LinhaVariante = FichaDoArtigo["variantes"][number];

function paraArtigo(a: LinhaArtigo) {
  return {
    id: `prd_${a.id}`,
    tipo: a.tipo,
    estado: a.estado,
    nome: a.nome,
    descricao: a.descricao,
    marca: a.marca,
    categoria_fiscal: a.categoria_fiscal,
    origem: a.origem,
    origem_ref: a.origem_ref,
    classificacao: {
      familias: a.familias,
      natureza_consumidor: a.natureza_consumidor,
      modo: a.modo,
      prestacao_inicio: iso(a.prestacao_inicio),
      prestacao_fim: iso(a.prestacao_fim),
      local_pais: a.local_pais,
      local_territorio: a.local_territorio,
      lazer_com_data: a.lazer_com_data,
      classificado_em: iso(a.classificado_em),
    },
    versao: a.versao,
    criado_em: a.criado_em.toISOString(),
    actualizado_em: a.actualizado_em.toISOString(),
  };
}

function paraVariante(v: LinhaVariante) {
  return {
    id: `var_${v.id}`,
    sku: v.sku,
    estado: v.estado,
    unidade_de_venda: v.unidade_de_venda,
    gtin: v.gtin,
    gtin_origem: v.gtin_origem,
    conteudo_quantidade: v.conteudo_quantidade,
    conteudo_unidade: v.conteudo_unidade,
    peso_g: v.peso_g,
    comprimento_mm: v.comprimento_mm,
    largura_mm: v.largura_mm,
    altura_mm: v.altura_mm,
    onu: v.onu,
    classe_adr: v.classe_adr,
    posicao: v.posicao,
    criado_em: v.criado_em.toISOString(),
  };
}

function paraVarianteCompleta(v: LinhaVariante & { valores: string[] }) {
  return {
    ...paraVariante(v),
    artigo: `prd_${v.artigo_id}`,
    valores: v.valores.map((id) => `ovl_${id}`),
  };
}

/**
 * A verificação guardada, normalizada: o que falte (uma linha escrita antes
 * de um campo existir) sai como lista vazia, não como 500 (revisão do #150,
 * P2-3).
 */
function verificacaoGuardada(valor: unknown) {
  if (valor === null || typeof valor !== "object") return null;
  const v = valor as { impedimentos?: unknown; nao_verificado?: unknown };
  const impedimentos = Array.isArray(v.impedimentos)
    ? v.impedimentos.filter(
        (i): i is { codigo: string } =>
          typeof (i as { codigo?: unknown } | null)?.codigo === "string",
      )
    : [];
  const naoVerificado = Array.isArray(v.nao_verificado)
    ? v.nao_verificado.filter((n): n is string => typeof n === "string")
    : [];
  return { impedimentos, nao_verificado: naoVerificado };
}

function paraPublicacao(p: Publicacao) {
  return {
    id: `pub_${p.id}`,
    artigo: `prd_${p.artigo_id}`,
    canal: `chn_${p.canal_id}`,
    mercado: `mkt_${p.mercado_id}`,
    estado: p.estado,
    variantes_fora: p.variantes_fora.map((v) => `var_${v}`),
    ultima_verificacao: verificacaoGuardada(p.ultima_verificacao),
    verificado_em: iso(p.verificado_em),
    publicado_em: iso(p.publicado_em),
    arquivado_em: iso(p.arquivado_em),
    motivo_arquivo: p.motivo_arquivo,
    versao: p.versao,
  };
}

/** O cursor é o id do último artigo da página, em base64url: opaco. */
const cursorDe = (id: string) => Buffer.from(id, "utf8").toString("base64url");
/**
 * O cursor das variantes: onde a página acabou (posição, SKU, id), em JSON
 * e base64url. Opaco para quem chama; validado ao voltar.
 */
const cursorDaVariante = (p: PosicaoNaLista) =>
  Buffer.from(JSON.stringify([p.posicao, p.sku, p.id]), "utf8").toString(
    "base64url",
  );
function posicaoDoCursor(cursor: string): PosicaoNaLista {
  let valor: unknown;
  try {
    valor = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    valor = null;
  }
  if (
    Array.isArray(valor) &&
    valor.length === 3 &&
    Number.isInteger(valor[0]) &&
    (valor[0] as number) >= 0 &&
    (valor[0] as number) <= 2147483647 &&
    typeof valor[1] === "string" &&
    valor[1].length >= 1 &&
    valor[1].length <= 64 &&
    typeof valor[2] === "string" &&
    new RegExp(`^${UUID}$`).test(valor[2])
  ) {
    return { posicao: valor[0] as number, sku: valor[1], id: valor[2] };
  }
  throw erroBase("request.invalid", "`cursor` não é um cursor desta lista");
}

/** O cursor das listas por (posição, id): em JSON e base64url, opaco. */
export const cursorPosicaoEId = (p: PosicaoEId) =>
  Buffer.from(JSON.stringify([p.posicao, p.id]), "utf8").toString("base64url");
function posicaoEIdDoCursor(cursor: string): PosicaoEId {
  let valor: unknown;
  try {
    valor = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    valor = null;
  }
  if (
    Array.isArray(valor) &&
    valor.length === 2 &&
    Number.isInteger(valor[0]) &&
    (valor[0] as number) >= 0 &&
    (valor[0] as number) <= 2147483647 &&
    typeof valor[1] === "string" &&
    new RegExp(`^${UUID}$`).test(valor[1])
  ) {
    return { posicao: valor[0] as number, id: valor[1] };
  }
  throw erroBase("request.invalid", "`cursor` não é um cursor desta lista");
}

export const paginaDe = (q: { limite?: string; cursor?: string }) => ({
  limite: q.limite === undefined ? 25 : Number(q.limite),
  depois: q.cursor === undefined ? null : posicaoEIdDoCursor(q.cursor),
});

function paraOpcao(o: {
  id: string;
  artigo_id: string;
  nome: string;
  posicao: number;
  valores: { id: string; valor: string }[];
}) {
  return {
    id: `opt_${o.id}`,
    artigo: `prd_${o.artigo_id}`,
    nome: o.nome,
    posicao: o.posicao,
    valores: o.valores.map((v) => ({ id: `ovl_${v.id}`, valor: v.valor })),
  };
}

const paraComponente = (c: {
  componente_id: string;
  quantidade: number;
  estado: "activa" | "arquivada";
}) => ({
  variante: `var_${c.componente_id}`,
  quantidade: c.quantidade,
  estado: c.estado,
});

/** Do id com prefixo ao tipo e ao uuid do recurso traduzível. */
function recursoDe(id: string): { tipo: RecursoTraduzivel; id: string } {
  const tipo = RECURSO_DO_PREFIXO[id.slice(0, id.indexOf("_"))];
  if (tipo === undefined) {
    throw erroBase("request.invalid", "recurso desconhecido");
  }
  return { tipo, id: semPrefixo(id) };
}

/** O campo tem de ser traduzível neste tipo de recurso (0009). */
function campoDe(tipo: RecursoTraduzivel, campo: string) {
  if (!(CAMPOS_TRADUZIVEIS[tipo] as readonly string[]).includes(campo)) {
    throw erroBase(
      "request.invalid",
      `${tipo} traduz-se em: ${CAMPOS_TRADUZIVEIS[tipo].join(", ")}`,
    );
  }
  return campo;
}

/**
 * O texto cabe no limite do campo (0009, `traducao_texto_comprimento` e
 * `traducao_endereco_valido`; revisão do #166, P2-5): recusa-se aqui, com o
 * campo e o limite na mensagem, em vez do erro genérico da base.
 */
function textoCabe(campo: string, texto: string) {
  // Conta-se por caracteres (pontos de código), como a base (`length`) e o
  // contrato; não por unidades UTF-16 (2.ª revisão do #166, P3-B). Os
  // limites repetem os da 0009: mudam-se nos dois sítios.
  const caracteres = Array.from(texto).length;
  if (campo === "endereco_amigavel") {
    if (caracteres > 100) {
      throw new ErroCatalogo(
        "catalog.slug_invalid",
        "o endereço amigável traduz-se com até 100 caracteres",
      );
    }
    return;
  }
  const limite = campo === "descricao" ? 20000 : 200;
  if (caracteres > limite) {
    throw new ErroCatalogo(
      "catalog.invalid_field",
      `o campo ${campo} traduz-se com até ${String(limite)} caracteres`,
    );
  }
}

const comPrefixoDo = (tipo: RecursoTraduzivel, id: string) =>
  `${PREFIXO_DO_RECURSO[tipo]}_${id}`;

/** O cursor da fila: (tipo, recurso, campo) em JSON e base64url. */
const cursorDaFila = (p: PosicaoNaFila) =>
  Buffer.from(JSON.stringify([p.tipo, p.recursoId, p.campo]), "utf8").toString(
    "base64url",
  );
function posicaoDaFila(cursor: string): PosicaoNaFila {
  let valor: unknown;
  try {
    valor = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    valor = null;
  }
  if (
    Array.isArray(valor) &&
    valor.length === 3 &&
    typeof valor[0] === "string" &&
    Object.hasOwn(CAMPOS_TRADUZIVEIS, valor[0]) &&
    typeof valor[1] === "string" &&
    new RegExp(`^${UUID}$`).test(valor[1]) &&
    typeof valor[2] === "string" &&
    /^[a-z_]{1,40}$/.test(valor[2])
  ) {
    return { tipo: valor[0], recursoId: valor[1], campo: valor[2] };
  }
  throw erroBase("request.invalid", "`cursor` não é um cursor desta lista");
}

/**
 * O GTIN e a origem dele vêm juntos (C4; 0002): recusa-se no contrato, com
 * uma mensagem que diz qual falta (revisão do #159, P3-5).
 */
function gtinComOrigem(
  variantes: readonly { gtin?: string | null; gtin_origem?: string | null }[],
) {
  for (const v of variantes) {
    const comGtin = v.gtin !== undefined && v.gtin !== null;
    const comOrigem = v.gtin_origem !== undefined && v.gtin_origem !== null;
    if (comGtin !== comOrigem) {
      throw erroBase(
        "request.invalid",
        comGtin ? "`gtin` pede `gtin_origem`" : "`gtin_origem` só com `gtin`",
      );
    }
  }
}

function idDoCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!new RegExp(`^${UUID}$`).test(id)) {
    throw erroBase("request.invalid", "`cursor` não é um cursor desta lista");
  }
  return id;
}

// ------------------------------------- Categorias e colecções (parte 6)

const EstadoCategoria = umDe(["activa", "arquivada"] as const);
const EnderecoAmigavel = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
  description:
    "Minúsculas sem acentos, algarismos e hífenes (ex.: unhas-de-gel); único por comerciante entre as categorias e, à parte, entre as colecções, também as arquivadas",
});
const Posicao = Type.Integer({ minimum: 0, maximum: 2147483647 });
const IdCategoria = idCom("cat", "cat_…");
const ParametroCategoria = Type.Object({ id: IdCategoria });
const ParametroColecao = Type.Object({ id: idCom("col", "col_…") });

const CategoriaEsquema = Type.Object({
  id: Type.String({ description: "cat_…" }),
  nome: Type.String(),
  endereco_amigavel: Type.String(),
  pai: Type.Union([Type.String({ description: "cat_…" }), Type.Null()]),
  posicao: Type.Integer(),
  estado: EstadoCategoria,
  versao: Type.Integer(),
  criada_em: Instante,
  actualizada_em: Instante,
});

const ColecaoEsquema = Type.Object({
  id: Type.String({ description: "col_…" }),
  nome: Type.String(),
  descricao: Type.Union([Type.String(), Type.Null()]),
  endereco_amigavel: Type.String(),
  estado: EstadoCategoria,
  total_artigos: Type.Integer({ minimum: 0 }),
  versao: Type.Integer(),
  criada_em: Instante,
  actualizada_em: Instante,
});

const ArtigoDaColecaoEsquema = Type.Object({
  artigo: Type.String({ description: "prd_…" }),
  posicao: Type.Integer(),
  estado: EstadoArtigo,
});

const CategoriasDoArtigoEsquema = Type.Object({
  artigo: Type.String({ description: "prd_…" }),
  versao: Type.Integer({ description: "A versão do artigo" }),
  categorias: Type.Array(CategoriaEsquema, {
    description: "Pela ordem do id, também as arquivadas",
  }),
});

const ConsultaCategoriasOuColecoes = Type.Object(
  {
    estado: Type.Optional(EstadoCategoria),
    limite: Type.Optional(
      Type.String({
        pattern: "^[1-9][0-9]?$|^100$",
        description: "1 a 100; por omissão, 25",
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        pattern: "^[A-Za-z0-9_-]{1,64}$",
        description: "O `cursor_seguinte` da página anterior",
      }),
    ),
  },
  { additionalProperties: false },
);

const PedidoCriarCategoria = Type.Object(
  {
    nome: Texto(200),
    endereco_amigavel: EnderecoAmigavel,
    pai: Type.Optional(
      Type.Union([IdCategoria, Type.Null()], {
        description: "cat_… activa; nulo ou ausente, na raiz",
      }),
    ),
    posicao: Type.Optional(Posicao),
  },
  { additionalProperties: false },
);

const PedidoAlterarCategoria = Type.Object(
  {
    versao: Type.Integer({ minimum: 1 }),
    nome: Type.Optional(Texto(200)),
    endereco_amigavel: Type.Optional(EnderecoAmigavel),
    posicao: Type.Optional(Posicao),
  },
  { additionalProperties: false },
);

const PedidoMoverCategoria = Type.Object(
  {
    versao: Type.Integer({ minimum: 1 }),
    pai: Type.Union([IdCategoria, Type.Null()], {
      description: "cat_… activa; nulo, para a raiz",
    }),
  },
  { additionalProperties: false },
);

const PedidoCategoriasDoArtigo = Type.Object(
  {
    versao: Type.Integer({ minimum: 1, description: "A versão do artigo" }),
    categorias: Type.Array(IdCategoria, {
      maxItems: 100,
      description:
        "A lista inteira; vazia, o artigo fica sem categorias. Uma nova tem de estar activa; uma arquivada que o artigo já tinha pode ficar",
    }),
  },
  { additionalProperties: false },
);

const PedidoCriarColecao = Type.Object(
  {
    nome: Texto(200),
    endereco_amigavel: EnderecoAmigavel,
    descricao: Type.Optional(TextoOuNulo(10000)),
  },
  { additionalProperties: false },
);

const PedidoAlterarColecao = Type.Object(
  {
    versao: Type.Integer({ minimum: 1 }),
    nome: Type.Optional(Texto(200)),
    endereco_amigavel: Type.Optional(EnderecoAmigavel),
    descricao: Type.Optional(TextoOuNulo(10000)),
  },
  { additionalProperties: false },
);

const PedidoArtigosDaColecao = Type.Object(
  {
    versao: Type.Integer({ minimum: 1, description: "A versão da colecção" }),
    artigos: Type.Array(idCom("prd", "prd_…"), {
      maxItems: 1000,
      description:
        "A lista inteira, pela ordem; vazia, a colecção fica sem artigos. Qualquer artigo, em qualquer estado (a loja só mostra os publicados)",
    }),
  },
  { additionalProperties: false },
);

interface LinhaCategoria {
  id: string;
  nome: string;
  endereco_amigavel: string;
  pai_id: string | null;
  posicao: number;
  estado: "activa" | "arquivada";
  versao: number;
  criado_em: Date;
  actualizado_em: Date;
}

const paraCategoria = (c: LinhaCategoria) => ({
  id: `cat_${c.id}`,
  nome: c.nome,
  endereco_amigavel: c.endereco_amigavel,
  pai: c.pai_id === null ? null : `cat_${c.pai_id}`,
  posicao: c.posicao,
  estado: c.estado,
  versao: c.versao,
  criada_em: c.criado_em.toISOString(),
  actualizada_em: c.actualizado_em.toISOString(),
});

const paraColecao = (c: {
  id: string;
  nome: string;
  descricao: string | null;
  endereco_amigavel: string;
  estado: "activa" | "arquivada";
  total_artigos: number | string | null;
  versao: number;
  criado_em: Date;
  actualizado_em: Date;
}) => ({
  id: `col_${c.id}`,
  nome: c.nome,
  descricao: c.descricao,
  endereco_amigavel: c.endereco_amigavel,
  estado: c.estado,
  total_artigos: Number(c.total_artigos ?? 0),
  versao: c.versao,
  criada_em: c.criado_em.toISOString(),
  actualizada_em: c.actualizado_em.toISOString(),
});

// --------------------------------------------------- A escrita idempotente

/** Sem corpo, `null` ou `{}`. */
const vazio = (corpo: unknown) =>
  corpo === undefined ||
  corpo === null ||
  (typeof corpo === "object" &&
    !Array.isArray(corpo) &&
    Object.keys(corpo).length === 0);

/** Quem escreve: a chave (`chave:key_…`, o formato das migrações 0012, 0014, 0015 e 0025). */
const quemDa = (chave: ContextoChave) => `chave:key_${chave.chaveId}`;

/**
 * Corre uma escrita do Catálogo com a Idempotency-Key (docs/18 §4): a
 * escrita e a resposta guardada vão na mesma transacção (`noCatalogo` corre
 * na transacção da idempotência). Repetir o pedido com a mesma chave devolve
 * a mesma resposta sem escrever outra vez.
 */
export async function escrever(
  base: Kysely<BaseDados>,
  pedido: FastifyRequest,
  resposta: FastifyReply,
  status: number,
  // Uma Transaction, nunca a base: com a base, o repositório abria outra
  // transacção e a escrita deixava de ir com a resposta guardada (revisão do
  // #153, P3-5).
  fn: (trx: Transaction<BaseDados>, chave: ContextoChave) => Promise<unknown>,
  local?: (corpo: unknown) => string,
  /**
   * O que conta como corpo para a idempotência, quando não é o JSON do
   * pedido (o envio de uma imagem: o resumo, o tipo e o tamanho, não os
   * bytes).
   */
  corpoIdempotente?: unknown,
) {
  const chave = chaveDo(pedido);
  const idempotente: PedidoIdempotente = {
    chave: chaveDeIdempotencia(pedido),
    metodo: pedido.method as PedidoIdempotente["metodo"],
    caminho: caminhoDe(pedido.url),
    // Sem corpo e `{}` são o mesmo pedido (revisão do #153, 2.ª ronda, P3-A).
    corpo:
      corpoIdempotente !== undefined
        ? corpoIdempotente
        : vazio(pedido.body)
          ? null
          : pedido.body,
  };
  const resultado = await noCatalogoApi(resposta, () =>
    comIdempotencia(
      base,
      chave.comercianteId,
      idempotente,
      async (trx) => {
        // Quem escreve fica na linha do tempo (docs/14 §3.12; migração
        // 0033): posto aqui, uma vez, para todas as escritas; sem ele, o
        // gatilho recusa a mudança.
        await sql`select set_config('eurolify.quem', ${quemDa(chave)}, true)`.execute(
          trx,
        );
        const corpo = await fn(trx, chave);
        return { status, corpo, guardar: corpo };
      },
      {
        aoFalharLimpeza: (erro) => {
          pedido.log.error(
            { err: erro },
            "idempotência: linha em curso por apagar",
          );
        },
      },
    ),
  );
  if (resultado.status === 204) return resposta.code(204).send();
  if (local !== undefined) {
    void resposta.header("Location", local(resultado.corpo));
  }
  return resposta.code(resultado.status).send(resultado.corpo);
}

/** A ficha do artigo como a API a devolve, lida na transacção dada. */
async function fichaNa(
  trx: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
) {
  const { artigo, variantes } = await fichaDoArtigo(
    trx,
    comercianteId,
    artigoId,
  );
  return { ...paraArtigo(artigo), variantes: variantes.map(paraVariante) };
}

// ------------------------------------------------------------ As rotas

/**
 * A lista de artigos (docs/14 §7.1): a mesma para `GET /products` (com a
 * chave) e `GET /hub/products` (com a sessão do Hub; docs/22 §11.1). Uma
 * função só, para os dois caminhos não se afastarem. **Outro chamador, fora
 * do catálogo:** `identidade/hub-catalogo.ts`; o teste
 * `hub-catalogo.test.ts` compara as duas respostas. Uma regra que dependa de
 * quem pede (a chave ou a pessoa) não entra aqui sem pensar nos dois
 * (revisão do #201, P2-2).
 */
export async function listaDeArtigos(
  base: Kysely<BaseDados>,
  comercianteId: string,
  q: Static<typeof ConsultaArtigos>,
  resposta: FastifyReply,
): Promise<Static<typeof RespostaArtigos>> {
  const limite = q.limite === undefined ? 25 : Number(q.limite);
  const depois = q.cursor === undefined ? null : idDoCursor(q.cursor);
  // O ano 0000 passa o formato `date-time` mas a base não o lê: recusa-se
  // aqui, com o código dos pedidos mal formados (revisão do #173, P3-6).
  if (q.actualizado_desde?.startsWith("0000-") === true) {
    throw erroBase(
      "request.invalid",
      "`actualizado_desde` fora do intervalo (o ano 0000 não existe)",
    );
  }
  const pagina = await noCatalogoApi(resposta, () =>
    listarArtigos(
      base,
      comercianteId,
      {
        ...(q.estado === undefined ? {} : { estado: q.estado }),
        ...(q.tipo === undefined ? {} : { tipo: q.tipo }),
        ...(q.sku === undefined ? {} : { sku: q.sku }),
        ...(q.texto === undefined ? {} : { texto: q.texto }),
        ...(q.categoria === undefined
          ? {}
          : { categoria: semPrefixo(q.categoria) }),
        ...(q.traducao_em_falta === undefined
          ? {}
          : { traducaoEmFalta: q.traducao_em_falta }),
        ...(q.actualizado_desde === undefined
          ? {}
          : { actualizadoDesde: q.actualizado_desde }),
      },
      limite,
      depois,
    ),
  );
  return {
    dados: pagina.dados.map(paraArtigo),
    total: pagina.total,
    ha_mais: pagina.ultimo !== null,
    cursor_seguinte: pagina.ultimo === null ? null : cursorDe(pagina.ultimo),
  };
}

export function rotasDoCatalogo(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    "/products",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "Procura artigos do comerciante, por ordem de criação, com o total dos que passam no filtro (docs/14 §7.1; docs/18 §2a). Filtros, que se juntam todos: estado, tipo, SKU de uma variante (sem distinguir maiúsculas), parte do nome, categoria, tradução em falta numa língua e alterados desde um instante.",
        querystring: ConsultaArtigos,
        response: { 200: RespostaArtigos, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      listaDeArtigos(
        base,
        chaveDo(pedido).comercianteId,
        pedido.query,
        resposta,
      ),
  );

  rotas.get(
    "/products/:id",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "A ficha de um artigo, com as variantes (também as arquivadas). Um artigo de outro comerciante é catalog.not_found.",
        params: ParametroArtigo,
        response: { 200: Artigo, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const { artigo, variantes } = await noCatalogoApi(resposta, () =>
        fichaDoArtigo(base, chave.comercianteId, semPrefixo(pedido.params.id)),
      );
      return { ...paraArtigo(artigo), variantes: variantes.map(paraVariante) };
    },
  );

  rotas.get(
    "/products/:id/variants",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "As variantes do artigo, também as arquivadas, por posição e SKU, com os valores das opções (pela ordem das opções), no formato das listas (docs/18 §2a).",
        params: ParametroArtigo,
        querystring: ConsultaVariantesDoArtigo,
        response: { 200: RespostaVariantes, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const q = pedido.query;
      const limite = q.limite === undefined ? 25 : Number(q.limite);
      const depois = q.cursor === undefined ? null : posicaoDoCursor(q.cursor);
      const pagina = await noCatalogoApi(resposta, () =>
        variantesDoArtigo(
          base,
          chave.comercianteId,
          semPrefixo(pedido.params.id),
          limite,
          depois,
        ),
      );
      return {
        dados: pagina.dados.map(paraVarianteCompleta),
        total: pagina.total,
        ha_mais: pagina.ultima !== null,
        cursor_seguinte:
          pagina.ultima === null ? null : cursorDaVariante(pagina.ultima),
      };
    },
  );

  rotas.get(
    "/variants",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "Procura uma variante pelo SKU (sem distinguir maiúsculas) ou pelo GTIN (8, 12, 13 ou 14 dígitos, o mesmo código com zeros à esquerda), também arquivada. Pede-se exactamente um dos dois. O SKU e o GTIN são únicos por comerciante: a lista tem uma variante ou nenhuma.",
        querystring: ConsultaVariantes,
        response: { 200: RespostaVariantes, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const { sku, gtin } = pedido.query;
      if ((sku === undefined) === (gtin === undefined)) {
        throw erroBase(
          "request.invalid",
          "pede-se exactamente um de `sku` ou `gtin`",
        );
      }
      const variantes = await noCatalogoApi(resposta, () =>
        procurarVariantes(
          base,
          chave.comercianteId,
          sku !== undefined ? { sku } : { gtin: gtin ?? "" },
        ),
      );
      // Uma ou nenhuma: a lista vai inteira, no formato de sempre.
      return {
        dados: variantes.map(paraVarianteCompleta),
        total: variantes.length,
        ha_mais: false,
        cursor_seguinte: null,
      };
    },
  );

  rotas.get(
    "/variants/:id",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description: "Uma variante, com o artigo e os valores das opções.",
        params: ParametroVariante,
        response: { 200: VarianteCompleta, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      return paraVarianteCompleta(
        await noCatalogoApi(resposta, () =>
          fichaDaVariante(
            base,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
          ),
        ),
      );
    },
  );

  rotas.get(
    "/products/:id/publications",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "As publicações do artigo por canal × mercado, com a última verificação e o motivo de quem as arquivou (docs/14 §3.9).",
        params: ParametroArtigo,
        response: { 200: RespostaPublicacoes, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const id = semPrefixo(pedido.params.id);
      // Um artigo que não existe é 404, não uma lista vazia (na mesma
      // transacção que as publicações).
      const publicacoes = await noCatalogoApi(resposta, () =>
        publicacoesDoArtigo(base, chave.comercianteId, id),
      );
      return { dados: publicacoes.map(paraPublicacao) };
    },
  );

  rotas.post(
    "/products/:id/publications/check",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "«Pode publicar?» (C2, docs/14 §5): a verificação num canal × mercado, sem escrever. Devolve os impedimentos e o que ainda não se verifica (nao_verificado). Não pede Idempotency-Key: não muda nada.",
        params: ParametroArtigo,
        body: PedidoVerificar,
        response: { 200: Verificacao, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const corpo = pedido.body;
      const verificacao = await noCatalogoApi(resposta, () =>
        verificarPublicacao(base, chave.comercianteId, {
          artigo_id: semPrefixo(pedido.params.id),
          canal_id: semPrefixo(corpo.canal),
          mercado_id: semPrefixo(corpo.mercado),
          variantes_fora: (corpo.variantes_fora ?? []).map(semPrefixo),
        }),
      );
      return verificacao;
    },
  );

  // ---------------------------------------------------------- Escritas
  // Parte 2 (pedido do Diogo, 07/10/2026: «sim, avança com as escritas da
  // API do Catálogo»). Todas pedem a Idempotency-Key; quem escreve é a chave.

  rotas.post(
    "/products",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Cria um artigo em rascunho, com as variantes (pelo menos uma; SKU único por comerciante, C3). Devolve a ficha.",
        headers: CabecalhoIdempotencia,
        body: PedidoCriarArtigo,
        response: { 201: Artigo, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        201,
        async (trx, chave) => {
          const { variantes, ...dados } = pedido.body;
          gtinComOrigem(variantes);
          const id = await criarArtigo(
            trx,
            chave.comercianteId,
            dados,
            variantes,
          );
          return fichaNa(trx, chave.comercianteId, id);
        },
        (corpo) => `/products/${(corpo as { id: string }).id}`,
      ),
  );

  rotas.patch(
    "/products/:id",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Altera o nome, a descrição, a marca ou a categoria fiscal, na `versao` lida (outra dá catalog.version_conflict). Um nome novo volta a verificar as publicações (docs/14 §4.2).",
        headers: CabecalhoIdempotencia,
        params: ParametroArtigo,
        body: PedidoAlterarArtigo,
        response: { 200: Artigo, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        const id = semPrefixo(pedido.params.id);
        const { versao, ...alteracao } = pedido.body;
        await alterarArtigo(trx, chave.comercianteId, id, versao, alteracao);
        return fichaNa(trx, chave.comercianteId, id);
      }),
  );

  rotas.put(
    "/products/:id/classification",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Classifica o artigo (docs/14 §3.10), na `versao` lida: substitui a classificação toda. Uma que deixa de servir tira as publicações de venda (docs/06, CJ).",
        headers: CabecalhoIdempotencia,
        params: ParametroArtigo,
        body: PedidoClassificar,
        response: { 200: Artigo, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        const id = semPrefixo(pedido.params.id);
        const { versao, prestacao_inicio, prestacao_fim, ...resto } =
          pedido.body;
        // O formato já o validou o esquema; um instante que o JavaScript não
        // lê (o segundo 60) recusa-se aqui, com o campo (revisão do #153,
        // P3-6). O Date guarda milissegundos: os microssegundos perdem-se.
        const data = (v: string | null | undefined) => {
          if (v === undefined || v === null) return v;
          const d = new Date(v);
          if (Number.isNaN(d.getTime())) {
            throw new ErroCatalogo(
              "catalog.invalid_field",
              `data inválida: ${v}`,
            );
          }
          return d;
        };
        await classificarArtigo(
          trx,
          chave.comercianteId,
          id,
          versao,
          {
            ...resto,
            ...(prestacao_inicio === undefined
              ? {}
              : { prestacao_inicio: data(prestacao_inicio) ?? null }),
            ...(prestacao_fim === undefined
              ? {}
              : { prestacao_fim: data(prestacao_fim) ?? null }),
          },
          quemDa(chave),
        );
        return fichaNa(trx, chave.comercianteId, id);
      }),
  );

  // `activate` e `restore` levam ambos a `activo`; cada um só parte do seu
  // estado (um rascunho não se «repõe», um arquivado não se «activa»). Pedir
  // o estado em que o artigo já está devolve a ficha sem mudar nada, nem a
  // versão (§4.1; revisão do #153, P2-2).
  for (const [caminho, de, estado, descricao] of [
    [
      "activate",
      "rascunho",
      "activo",
      "Activa um artigo em rascunho (C3: SKU e unidade em todas as variantes activas).",
    ],
    [
      "archive",
      "activo",
      "arquivado",
      "Arquiva um artigo activo; as publicações publicadas arquivam-se com ele.",
    ],
    [
      "restore",
      "arquivado",
      "activo",
      "Repõe um artigo arquivado como activo, sem o voltar a publicar.",
    ],
  ] as const) {
    rotas.post(
      `/products/:id/${caminho}`,
      {
        config: { ambito: "catalog:write" },
        schema: {
          description: `${descricao} Na \`versao\` lida; se o artigo já está nesse estado, nada muda.`,
          headers: CabecalhoIdempotencia,
          params: ParametroArtigo,
          body: PedidoVersao,
          response: { 200: Artigo, ...RESPOSTA_DE_ERRO },
        },
      },
      (pedido, resposta) =>
        escrever(base, pedido, resposta, 200, async (trx, chave) => {
          const id = semPrefixo(pedido.params.id);
          await mudarEstadoArtigo(
            trx,
            chave.comercianteId,
            id,
            pedido.body.versao,
            estado,
            de,
          );
          return fichaNa(trx, chave.comercianteId, id);
        }),
    );
  }

  rotas.delete(
    "/products/:id",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Apaga um artigo em rascunho que nunca esteve activo (com as variantes); outro dá catalog.not_draft.",
        headers: CabecalhoIdempotencia,
        params: ParametroArtigo,
        // `type: null`: o @fastify/swagger escreve o 204 sem `content`
        // (medido a 07/10/2026 no /openapi.json; revisão do #153).
        response: {
          204: Type.Null({ description: "Apagado; sem corpo" }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, async (trx, chave) => {
        await apagarRascunho(
          trx,
          chave.comercianteId,
          semPrefixo(pedido.params.id),
        );
        return null;
      }),
  );

  rotas.post(
    "/products/:id/variants",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Acrescenta uma variante ao artigo, activa, com os valores das opções (SKU único por comerciante, C3). Também num artigo arquivado (§4.1). Num artigo publicado, a variante nova nasce fora das publicações.",
        headers: CabecalhoIdempotencia,
        params: ParametroArtigo,
        body: PedidoCriarVariante,
        response: { 201: VarianteCompleta, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        201,
        async (trx, chave) => {
          const { valores, ...dados } = pedido.body;
          gtinComOrigem([dados]);
          const id = await criarVarianteComValores(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            dados,
            (valores ?? []).map(semPrefixo),
          );
          return paraVarianteCompleta(
            await fichaDaVariante(trx, chave.comercianteId, id),
          );
        },
        (corpo) => `/variants/${(corpo as { id: string }).id}`,
      ),
  );

  rotas.post(
    "/variants/:id/archive",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Arquiva a variante: é final, e o SKU não volta (P7). O artigo e as outras variantes ficam (C6). Se era a última à venda numa publicação, a publicação sai de venda (§8; docs/06, CJ). Uma variante já arquivada devolve-se sem mudar nada, como no artigo (§4.1). Sem corpo e sem `Content-Type`.",
        headers: CabecalhoIdempotencia,
        params: ParametroVariante,
        response: { 200: VarianteCompleta, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        if (!vazio(pedido.body)) {
          throw new ErroCatalogo(
            "catalog.invalid_field",
            "esta rota não leva corpo",
          );
        }
        const id = semPrefixo(pedido.params.id);
        await arquivarVariante(trx, chave.comercianteId, id);
        return paraVarianteCompleta(
          await fichaDaVariante(trx, chave.comercianteId, id),
        );
      }),
  );

  rotas.post(
    "/products/:id/publications",
    {
      config: { ambito: "catalog:publish" },
      schema: {
        description:
          "Publica o artigo num canal × mercado: corre a verificação (C2) e, sem impedimentos, põe-no à venda. Com impedimentos responde 200 com `publicada: false` e a lista: o artigo não fica à venda, só se guarda a verificação na publicação (que fica em rascunho; docs/14 §4.2). Ler sempre `publicada`, nunca só o estado HTTP. Repetir com a mesma Idempotency-Key devolve a resposta guardada, mesmo que entretanto o impedimento tenha sido resolvido: para verificar outra vez, uma chave nova.",
        headers: CabecalhoIdempotencia,
        params: ParametroArtigo,
        body: PedidoPublicar,
        response: { 200: RespostaPublicar, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        const corpo = pedido.body;
        const r = await publicar(trx, chave.comercianteId, quemDa(chave), {
          artigo_id: semPrefixo(pedido.params.id),
          canal_id: semPrefixo(corpo.canal),
          mercado_id: semPrefixo(corpo.mercado),
          variantes_fora: (corpo.variantes_fora ?? []).map(semPrefixo),
        });
        return {
          publicada: r.publicada,
          verificacao: r.verificacao,
          publicacao:
            r.publicacao === null ? null : paraPublicacao(r.publicacao),
        };
      }),
  );

  rotas.post(
    "/publications/:id/archive",
    {
      config: { ambito: "catalog:publish" },
      schema: {
        description:
          "Retira uma publicação de venda (publicado → arquivado, motivo `retirada`). Só se retira o que está publicado (outro estado dá catalog.invalid_transition). Sem corpo.",
        headers: CabecalhoIdempotencia,
        params: ParametroPublicacao,
        response: { 200: PublicacaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        // Sem corpo (ou `{}`): outro corpo recusa-se, depois da chave de
        // idempotência (revisão do #153, 2.ª ronda, P3-A).
        if (!vazio(pedido.body)) {
          throw new ErroCatalogo(
            "catalog.invalid_field",
            "esta rota não leva corpo",
          );
        }
        return paraPublicacao(
          await retirarPublicacao(
            trx,
            chave.comercianteId,
            quemDa(chave),
            semPrefixo(pedido.params.id),
          ),
        );
      }),
  );

  // ------------------------------------------- Opções e composição dos kits
  // Parte 4 (pedido do Diogo, 07/10/2026: «sim, avança com as opções e os
  // kits»; docs/14 §3.3, §3.4 e §7.1).

  rotas.get(
    "/products/:id/options",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "As opções do artigo (ex.: Cor, Tamanho), pela ordem, cada uma com os valores todos, no formato das listas (docs/18 §2a).",
        params: ParametroArtigo,
        querystring: ConsultaPagina,
        response: { 200: Lista(OpcaoEsquema), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const { limite, depois } = paginaDe(pedido.query);
      const pagina = await noCatalogoApi(resposta, () =>
        opcoesDoArtigoPaginadas(
          base,
          chave.comercianteId,
          semPrefixo(pedido.params.id),
          limite,
          depois,
        ),
      );
      return {
        dados: pagina.dados.map(paraOpcao),
        total: pagina.total,
        ha_mais: pagina.ultima !== null,
        cursor_seguinte:
          pagina.ultima === null ? null : cursorPosicaoEId(pagina.ultima),
      };
    },
  );

  rotas.get(
    "/options/:id",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description: "Uma opção, com o artigo e os valores todos.",
        params: ParametroOpcao,
        response: { 200: OpcaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      return paraOpcao(
        await noCatalogoApi(resposta, () =>
          fichaDaOpcao(base, chave.comercianteId, semPrefixo(pedido.params.id)),
        ),
      );
    },
  );

  rotas.post(
    "/products/:id/options",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Cria uma opção do artigo com os valores, pela ordem (§3.3). Só num artigo em rascunho; outro dá catalog.not_draft. O nome não se repete no artigo, nem um valor na opção, sem distinguir maiúsculas nem os espaços nas pontas (catalog.option_duplicate e catalog.option_value_duplicate, 409); valores exactamente iguais no próprio pedido dão 400.",
        headers: CabecalhoIdempotencia,
        params: ParametroArtigo,
        body: PedidoCriarOpcao,
        response: { 201: OpcaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        201,
        async (trx, chave) => {
          const opcao = await criarOpcao(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.nome,
            pedido.body.valores,
          );
          return paraOpcao(
            await fichaDaOpcao(trx, chave.comercianteId, opcao.id),
          );
        },
        (corpo) => `/options/${(corpo as { id: string }).id}`,
      ),
  );

  rotas.post(
    "/options/:id/values",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Acrescenta um valor à opção, no fim, em qualquer estado do artigo (§3.3); não se repete na opção, sem distinguir maiúsculas nem os espaços nas pontas. Devolve a opção com os valores todos.",
        headers: CabecalhoIdempotencia,
        params: ParametroOpcao,
        body: PedidoAcrescentarValor,
        response: { 201: OpcaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        201,
        async (trx, chave) => {
          const id = semPrefixo(pedido.params.id);
          await acrescentarValor(
            trx,
            chave.comercianteId,
            id,
            pedido.body.valor,
          );
          return paraOpcao(await fichaDaOpcao(trx, chave.comercianteId, id));
        },
        (corpo) => `/options/${(corpo as { id: string }).id}`,
      ),
  );

  rotas.get(
    "/variants/:id/components",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "A composição do kit (§3.4), pela ordem, no formato das listas (docs/18 §2a). Vazia se a variante não é kit.",
        params: ParametroVariante,
        querystring: ConsultaPagina,
        response: { 200: Lista(ComponenteEsquema), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const { limite, depois } = paginaDe(pedido.query);
      const pagina = await noCatalogoApi(resposta, () =>
        composicaoDoKit(
          base,
          chave.comercianteId,
          semPrefixo(pedido.params.id),
          limite,
          depois,
        ),
      );
      return {
        dados: pagina.dados.map(paraComponente),
        total: pagina.total,
        ha_mais: pagina.ultima !== null,
        cursor_seguinte:
          pagina.ultima === null ? null : cursorPosicaoEId(pagina.ultima),
      };
    },
  );

  rotas.put(
    "/variants/:id/components",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Substitui a composição do kit pela lista dada, pela ordem (§3.4); vazia, deixa de ser kit. A base recusa ciclos (catalog.component_cycle), componentes novos arquivados (catalog.component_archived) e mexer num kit arquivado; um componente arquivado que já estava no kit pode ficar. Sem `versao`: o último a escrever ganha. Devolve a composição inteira (no máximo 100), cada componente com o estado.",
        headers: CabecalhoIdempotencia,
        params: ParametroVariante,
        body: PedidoComposicao,
        response: { 200: Lista(ComponenteEsquema), ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        const id = semPrefixo(pedido.params.id);
        await definirComponentes(
          trx,
          chave.comercianteId,
          id,
          pedido.body.componentes.map((c) => ({
            varianteId: semPrefixo(c.variante),
            quantidade: c.quantidade,
          })),
        );
        const pagina = await composicaoDoKit(
          trx,
          chave.comercianteId,
          id,
          100,
          null,
        );
        return {
          dados: pagina.dados.map(paraComponente),
          total: pagina.total,
          ha_mais: false,
          cursor_seguinte: null,
        };
      }),
  );

  // ---------------------------------------------------------- Traduções
  // Parte 5 (pedido do Diogo, 08/10/2026: «sim, avança com as traduções»;
  // docs/14 §3.8, §4.3 e §7.1). Quem traduziu fica registado como a chave e
  // não sai nas respostas (proposta, docs/14 §7.1). Rever uma proposta
  // de IA não se faz por chave: faz-se no Hub, com a sessão de uma pessoa
  // (docs/06, CO; revisão do #166, P1-1).

  rotas.get(
    "/translations",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "Dois usos, exactamente um de cada vez. Com `resource`: as traduções desse recurso (de uma língua, com `locale`), cada uma com o estado contra o original de agora; são poucas, vão todas. Sem `resource`, com `locale`: a fila do que falta traduzir nessa língua (`estado`: em_falta, desactualizada), por páginas (docs/18 §2a); para a língua de origem dá catalog.translation_same_language.",
        querystring: ConsultaTraducoes,
        response: {
          200: Type.Union([Lista(TraducaoEsquema), Lista(PorTraduzirEsquema)]),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const q = pedido.query;
      if (q.resource !== undefined) {
        if (
          q.estado !== undefined ||
          q.limite !== undefined ||
          q.cursor !== undefined
        ) {
          throw erroBase(
            "request.invalid",
            "`estado`, `limite` e `cursor` são só da fila (sem `resource`)",
          );
        }
        const { tipo, id } = recursoDe(q.resource);
        const traducoes = await noCatalogoApi(resposta, () =>
          traducoesParaApi(
            base,
            chave.comercianteId,
            tipo,
            id,
            q.locale ?? null,
          ),
        );
        return {
          dados: traducoes.map((t) => ({
            recurso: comPrefixoDo(tipo, id),
            campo: t.campo,
            lingua: t.lingua,
            texto: t.texto,
            estado: t.estado,
            origem: t.origem,
            revista: t.revista,
            traduzida_em: t.traduzido_em.toISOString(),
            revista_em: iso(t.revisto_em),
          })),
          total: traducoes.length,
          ha_mais: false,
          cursor_seguinte: null,
        };
      }
      if (q.locale === undefined) {
        throw erroBase(
          "request.invalid",
          "pede-se `resource` (as traduções dele) ou `locale` (a fila)",
        );
      }
      const estados = (q.estado ?? "em_falta,desactualizada").split(",") as (
        "em_falta" | "desactualizada"
      )[];
      const limite = q.limite === undefined ? 25 : Number(q.limite);
      const depois = q.cursor === undefined ? null : posicaoDaFila(q.cursor);
      const pagina = await noCatalogoApi(resposta, () =>
        filaDeTraducoesPaginada(
          base,
          chave.comercianteId,
          q.locale ?? "",
          estados,
          limite,
          depois,
        ),
      );
      return {
        dados: pagina.dados.map((p) => ({
          recurso: comPrefixoDo(p.tipo, p.recursoId),
          campo: p.campo,
          estado: p.estado,
        })),
        total: pagina.total,
        ha_mais: pagina.ultima !== null,
        cursor_seguinte:
          pagina.ultima === null ? null : cursorDaFila(pagina.ultima),
      };
    },
  );

  /** A tradução de um campo numa língua, lida na transacção dada. */
  async function traducaoNa(
    trx: Transaction<BaseDados>,
    comercianteId: string,
    tipo: RecursoTraduzivel,
    id: string,
    campo: string,
    lingua: string,
  ) {
    const t = (
      await traducoesParaApi(trx, comercianteId, tipo, id, lingua)
    ).find((x) => x.campo === campo);
    if (t === undefined) {
      throw new ErroCatalogo(
        "catalog.not_found",
        `tradução ${id} ${campo} ${lingua}`,
      );
    }
    return {
      recurso: comPrefixoDo(tipo, id),
      campo: t.campo,
      lingua: t.lingua,
      texto: t.texto,
      estado: t.estado,
      origem: t.origem,
      revista: t.revista,
      traduzida_em: t.traduzido_em.toISOString(),
      revista_em: iso(t.revisto_em),
    };
  }

  rotas.put(
    "/translations/:recurso/:campo/:lingua",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Traduz um campo para uma língua, ou traduz outra vez (substitui o texto e apaga a revisão). Por chave, a tradução fica sempre como proposta de IA (`origem: ia`); as de pessoa gravam-se no Hub (docs/06, CP). `original_visto` é o texto original que quem traduziu viu: se mudou, catalog.version_conflict. Não se traduz para a língua de origem nem um campo sem original. Campos: artigo (nome, descricao), opção (nome), valor (valor), categoria (nome, endereco_amigavel), colecção (nome, descricao, endereco_amigavel).",
        headers: CabecalhoIdempotencia,
        params: ParametrosTraducao,
        body: PedidoTraduzir,
        response: { 200: TraducaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        const { tipo, id } = recursoDe(pedido.params.recurso);
        const campo = campoDe(tipo, pedido.params.campo);
        textoCabe(campo, pedido.body.texto);
        await recursoTraduzivel(trx, chave.comercianteId, tipo, id);
        await definirTraducao(trx, chave.comercianteId, quemDa(chave), {
          tipo,
          recursoId: id,
          campo,
          lingua: pedido.params.lingua,
          texto: pedido.body.texto,
          // Por chave, é sempre uma proposta de IA: só o Hub, com a sessão
          // de uma pessoa, grava traduções de pessoa (docs/06, CP).
          origem: "ia",
          originalVisto: pedido.body.original_visto,
        });
        return traducaoNa(
          trx,
          chave.comercianteId,
          tipo,
          id,
          campo,
          pedido.params.lingua,
        );
      }),
  );

  rotas.delete(
    "/translations/:recurso/:campo/:lingua",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Tira a tradução (o campo passa a «em falta» nessa língua). Tirar a tradução do nome de um artigo publicado num mercado dessa língua tira-o de venda (§8; CJ).",
        headers: CabecalhoIdempotencia,
        params: ParametrosTraducao,
        response: {
          204: Type.Null({ description: "Tirada; sem corpo" }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, async (trx, chave) => {
        const { tipo, id } = recursoDe(pedido.params.recurso);
        const campo = campoDe(tipo, pedido.params.campo);
        await recursoTraduzivel(trx, chave.comercianteId, tipo, id);
        await apagarTraducao(
          trx,
          chave.comercianteId,
          quemDa(chave),
          id,
          campo,
          pedido.params.lingua,
        );
        return null;
      }),
  );

  // ------------------------------------------- Categorias e colecções
  // Parte 6 (pedido do Diogo, 08/10/2026: «sim, avança com as categorias»;
  // docs/14 §3.6, §3.7 e §7.1). As regras vivem na base (0007) e no
  // repositório (`categorias.ts`): a árvore sem ciclos, o pai activo, os
  // endereços únicos, a versão. Categorias e colecções não se apagam:
  // arquivam-se.

  /** A ficha da categoria, lida na transacção dada. */
  const categoriaNa = async (
    trx: Kysely<BaseDados>,
    comercianteId: string,
    id: string,
  ) => paraCategoria(await fichaDaCategoria(trx, comercianteId, id));
  /** A ficha da colecção, lida na transacção dada. */
  const colecaoNa = async (
    trx: Kysely<BaseDados>,
    comercianteId: string,
    id: string,
  ) => paraColecao(await fichaDaColecao(trx, comercianteId, id));

  rotas.get(
    "/categories",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "As categorias do comerciante, por ordem de criação, também as arquivadas (filtro `estado`), no formato das listas (docs/18 §2a). A árvore monta-se pelo `pai` de cada uma.",
        querystring: ConsultaCategoriasOuColecoes,
        response: { 200: Lista(CategoriaEsquema), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const q = pedido.query;
      const limite = q.limite === undefined ? 25 : Number(q.limite);
      const depois = q.cursor === undefined ? null : idDoCursor(q.cursor);
      const { dados, total, ultimo } = await noCatalogoApi(resposta, () =>
        listarCategoriasOuColecoes(
          base,
          chave.comercianteId,
          "categoria",
          q.estado ?? null,
          limite,
          depois,
          categoriasPorId,
        ),
      );
      return {
        dados: dados.map(paraCategoria),
        total,
        ha_mais: ultimo !== null,
        cursor_seguinte: ultimo === null ? null : cursorDe(ultimo),
      };
    },
  );

  rotas.get(
    "/categories/:id",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description: "Uma categoria.",
        params: ParametroCategoria,
        response: { 200: CategoriaEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      return noCatalogoApi(resposta, () =>
        categoriaNa(base, chave.comercianteId, semPrefixo(pedido.params.id)),
      );
    },
  );

  rotas.post(
    "/categories",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Cria uma categoria activa, na raiz ou dentro de uma categoria activa (`pai`). O endereço amigável é único entre as categorias do comerciante, também as arquivadas (catalog.slug_duplicate).",
        headers: CabecalhoIdempotencia,
        body: PedidoCriarCategoria,
        response: { 201: CategoriaEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        201,
        async (trx, chave) => {
          const { pai, ...dados } = pedido.body;
          const id = await criarCategoria(trx, chave.comercianteId, {
            ...dados,
            pai_id: pai === undefined || pai === null ? null : semPrefixo(pai),
          });
          return categoriaNa(trx, chave.comercianteId, id);
        },
        (corpo) => `/categories/${(corpo as { id: string }).id}`,
      ),
  );

  rotas.patch(
    "/categories/:id",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Altera o nome, o endereço amigável ou a posição, na `versao` lida (outra dá catalog.version_conflict). Um valor igual ao actual não sobe a versão. Mudar de sítio na árvore é `POST /categories/{id}/move`.",
        headers: CabecalhoIdempotencia,
        params: ParametroCategoria,
        body: PedidoAlterarCategoria,
        response: { 200: CategoriaEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        const id = semPrefixo(pedido.params.id);
        const { versao, ...alteracao } = pedido.body;
        await alterarCategoria(trx, chave.comercianteId, id, versao, alteracao);
        return categoriaNa(trx, chave.comercianteId, id);
      }),
  );

  rotas.post(
    "/categories/:id/move",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Muda a categoria de sítio na árvore, na `versao` lida: para dentro de uma categoria activa (`pai`) ou para a raiz (`pai: null`). Uma categoria não fica dentro de si própria, nem por outra (catalog.category_cycle), nem uma activa dentro de uma arquivada (catalog.category_archived).",
        headers: CabecalhoIdempotencia,
        params: ParametroCategoria,
        body: PedidoMoverCategoria,
        response: { 200: CategoriaEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        const id = semPrefixo(pedido.params.id);
        const { versao, pai } = pedido.body;
        await moverCategoria(
          trx,
          chave.comercianteId,
          id,
          versao,
          pai === null ? null : semPrefixo(pai),
        );
        return categoriaNa(trx, chave.comercianteId, id);
      }),
  );

  for (const [caminho, estado, descricao] of [
    [
      "archive",
      "arquivada",
      "Arquiva a categoria. Os artigos ficam nela (§3.6). Uma categoria com subcategorias activas não se arquiva (catalog.category_has_children): arquiva-se de baixo para cima.",
    ],
    [
      "restore",
      "activa",
      "Repõe a categoria. Dentro de uma arquivada não se repõe (catalog.category_archived): repõe-se de cima para baixo.",
    ],
  ] as const) {
    rotas.post(
      `/categories/:id/${caminho}`,
      {
        config: { ambito: "catalog:write" },
        schema: {
          description: `${descricao} Na \`versao\` lida; se a categoria já está nesse estado, nada muda.`,
          headers: CabecalhoIdempotencia,
          params: ParametroCategoria,
          body: PedidoVersao,
          response: { 200: CategoriaEsquema, ...RESPOSTA_DE_ERRO },
        },
      },
      (pedido, resposta) =>
        escrever(base, pedido, resposta, 200, async (trx, chave) => {
          const id = semPrefixo(pedido.params.id);
          await mudarEstadoCategoria(
            trx,
            chave.comercianteId,
            id,
            pedido.body.versao,
            estado,
          );
          return categoriaNa(trx, chave.comercianteId, id);
        }),
    );
  }

  rotas.get(
    "/products/:id/categories",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "As categorias do artigo (também as arquivadas), com a versão do artigo, que é a que se manda para as mudar. São no máximo 100: a lista vai inteira.",
        params: ParametroArtigo,
        response: { 200: CategoriasDoArtigoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const id = semPrefixo(pedido.params.id);
      const { versao, categorias } = await noCatalogoApi(resposta, () =>
        categoriasDoArtigoParaApi(base, chave.comercianteId, id),
      );
      return {
        artigo: `prd_${id}`,
        versao,
        categorias: categorias.map(paraCategoria),
      };
    },
  );

  rotas.put(
    "/products/:id/categories",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Substitui as categorias do artigo pela lista dada, na `versao` do artigo lida (é uma escrita do artigo: sobe-lhe a versão, só se a lista mudou). Uma categoria nova tem de estar activa (catalog.category_archived); uma arquivada que o artigo já tinha pode ficar. A mesma categoria duas vezes dá catalog.category_duplicate.",
        headers: CabecalhoIdempotencia,
        params: ParametroArtigo,
        body: PedidoCategoriasDoArtigo,
        response: { 200: CategoriasDoArtigoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        const id = semPrefixo(pedido.params.id);
        await definirCategoriasDoArtigo(
          trx,
          chave.comercianteId,
          id,
          pedido.body.versao,
          pedido.body.categorias.map(semPrefixo),
        );
        const { versao, categorias } = await categoriasDoArtigoParaApi(
          trx,
          chave.comercianteId,
          id,
        );
        return {
          artigo: `prd_${id}`,
          versao,
          categorias: categorias.map(paraCategoria),
        };
      }),
  );

  rotas.get(
    "/collections",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "As colecções do comerciante, por ordem de criação, também as arquivadas (filtro `estado`), cada uma com quantos artigos tem, no formato das listas (docs/18 §2a).",
        querystring: ConsultaCategoriasOuColecoes,
        response: { 200: Lista(ColecaoEsquema), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const q = pedido.query;
      const limite = q.limite === undefined ? 25 : Number(q.limite);
      const depois = q.cursor === undefined ? null : idDoCursor(q.cursor);
      const { dados, total, ultimo } = await noCatalogoApi(resposta, () =>
        listarCategoriasOuColecoes(
          base,
          chave.comercianteId,
          "colecao",
          q.estado ?? null,
          limite,
          depois,
          colecoesPorId,
        ),
      );
      return {
        dados: dados.map(paraColecao),
        total,
        ha_mais: ultimo !== null,
        cursor_seguinte: ultimo === null ? null : cursorDe(ultimo),
      };
    },
  );

  rotas.get(
    "/collections/:id",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "Uma colecção, com quantos artigos tem; os artigos lêem-se em `GET /collections/{id}/products`.",
        params: ParametroColecao,
        response: { 200: ColecaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      return noCatalogoApi(resposta, () =>
        colecaoNa(base, chave.comercianteId, semPrefixo(pedido.params.id)),
      );
    },
  );

  rotas.get(
    "/collections/:id/products",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "Os artigos da colecção, pela ordem dela, cada um com o estado, no formato das listas (docs/18 §2a). Como na composição de um kit, um `PUT` reescreve a lista inteira: entre páginas, só é estável enquanto ninguém a substitui.",
        params: ParametroColecao,
        querystring: ConsultaPagina,
        response: { 200: Lista(ArtigoDaColecaoEsquema), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const { limite, depois } = paginaDe(pedido.query);
      const pagina = await noCatalogoApi(resposta, () =>
        artigosDaColecaoPaginados(
          base,
          chave.comercianteId,
          semPrefixo(pedido.params.id),
          limite,
          depois,
        ),
      );
      return {
        dados: pagina.dados.map((l) => ({
          artigo: `prd_${l.artigo_id}`,
          posicao: l.posicao,
          estado: l.estado,
        })),
        total: pagina.total,
        ha_mais: pagina.ultima !== null,
        cursor_seguinte:
          pagina.ultima === null ? null : cursorPosicaoEId(pagina.ultima),
      };
    },
  );

  rotas.post(
    "/collections",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Cria uma colecção manual, activa e vazia. O endereço amigável é único entre as colecções do comerciante, também as arquivadas (catalog.slug_duplicate).",
        headers: CabecalhoIdempotencia,
        body: PedidoCriarColecao,
        response: { 201: ColecaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        201,
        async (trx, chave) => {
          const id = await criarColecao(trx, chave.comercianteId, pedido.body);
          return colecaoNa(trx, chave.comercianteId, id);
        },
        (corpo) => `/collections/${(corpo as { id: string }).id}`,
      ),
  );

  rotas.patch(
    "/collections/:id",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Altera o nome, a descrição (nula, tira-a) ou o endereço amigável, na `versao` lida. Um valor igual ao actual não sobe a versão.",
        headers: CabecalhoIdempotencia,
        params: ParametroColecao,
        body: PedidoAlterarColecao,
        response: { 200: ColecaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        const id = semPrefixo(pedido.params.id);
        const { versao, ...alteracao } = pedido.body;
        await alterarColecao(trx, chave.comercianteId, id, versao, alteracao);
        return colecaoNa(trx, chave.comercianteId, id);
      }),
  );

  for (const [caminho, estado, descricao] of [
    [
      "archive",
      "arquivada",
      "Arquiva a colecção. A lista de artigos fica e ainda se pode mudar (prepara-se antes de a repor).",
    ],
    ["restore", "activa", "Repõe a colecção."],
  ] as const) {
    rotas.post(
      `/collections/:id/${caminho}`,
      {
        config: { ambito: "catalog:write" },
        schema: {
          description: `${descricao} Na \`versao\` lida; se a colecção já está nesse estado, nada muda.`,
          headers: CabecalhoIdempotencia,
          params: ParametroColecao,
          body: PedidoVersao,
          response: { 200: ColecaoEsquema, ...RESPOSTA_DE_ERRO },
        },
      },
      (pedido, resposta) =>
        escrever(base, pedido, resposta, 200, async (trx, chave) => {
          const id = semPrefixo(pedido.params.id);
          await mudarEstadoColecao(
            trx,
            chave.comercianteId,
            id,
            pedido.body.versao,
            estado,
          );
          return colecaoNa(trx, chave.comercianteId, id);
        }),
    );
  }

  rotas.put(
    "/collections/:id/products",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Substitui os artigos da colecção pela lista dada, pela ordem dada (até 1000), na `versao` da colecção lida; sobe-lhe a versão só se a lista ou a ordem mudaram. O mesmo artigo duas vezes dá catalog.collection_product_duplicate; um artigo que não existe, catalog.not_found. Devolve a colecção; os artigos lêem-se em `GET /collections/{id}/products`.",
        headers: CabecalhoIdempotencia,
        params: ParametroColecao,
        body: PedidoArtigosDaColecao,
        response: { 200: ColecaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        const id = semPrefixo(pedido.params.id);
        await definirArtigosDaColecao(
          trx,
          chave.comercianteId,
          id,
          pedido.body.versao,
          pedido.body.artigos.map(semPrefixo),
        );
        return colecaoNa(trx, chave.comercianteId, id);
      }),
  );
}
