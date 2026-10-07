import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
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
  UNIDADES_DE_VENDA,
  type BaseDados,
} from "../base/esquema.js";
import { chaveDo } from "../identidade/autenticacao.js";
import { fichaDoArtigo, listarArtigos } from "./consultas.js";
import { ErroCatalogo } from "./erros.js";
import {
  NAO_VERIFICADO,
  publicacoesDoArtigo,
  verificarPublicacao,
  type Publicacao,
} from "./publicacao.js";

// API de Administração do Catálogo, parte 1: as consultas (docs/14 §7.1;
// pedido do Diogo, 07/10/2026: «sim, avança com as consultas da API do
// Catálogo»). Só leem, com uma chave de servidor com `catalog:read`. As
// escritas entram noutro pedido, com a Idempotency-Key (docs/18 §4).

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const idCom = (prefixo: string, descricao: string) =>
  Type.String({ pattern: `^${prefixo}_${UUID}$`, description: descricao });
const semPrefixo = (id: string) => id.slice(id.indexOf("_") + 1);

/**
 * Uma lista fechada de valores, com o tipo deles (o `Type.Union` de uma
 * lista feita com `map` perde o tipo dos literais no TypeScript).
 */
const umDe = <T extends string>(valores: readonly T[]) =>
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
const Instante = Type.String({ format: "date-time" });
const iso = (d: Date | null) => (d === null ? null : d.toISOString());

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
async function noCatalogoApi<T>(
  resposta: FastifyReply,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (erro) {
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

const RespostaArtigos = Type.Object({
  dados: Type.Array(ResumoArtigo),
  total: Type.Integer({
    description: "Quantos artigos passam no filtro, em todas as páginas",
  }),
  ha_mais: Type.Boolean(),
  cursor_seguinte: Type.Union([Type.String(), Type.Null()], {
    description: "Para pedir a página seguinte (`cursor`); nulo na última",
  }),
});

const ConsultaArtigos = Type.Object(
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

const ParametroArtigo = Type.Object({ id: idCom("prd", "prd_…") });

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
      "O que a verificação ainda não sabe ver (docs/06, CF): «sem impedimentos» não quer dizer «conforme»",
  }),
});

/**
 * A verificação guardada numa publicação: a lista do que não se verificava é
 * a do momento em que se guardou, e muda quando a Conformidade e a media
 * passarem a verificar-se (CF). Aqui fica aberta, para uma linha antiga não
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
function idDoCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!new RegExp(`^${UUID}$`).test(id)) {
    throw erroBase("request.invalid", "`cursor` não é um cursor desta lista");
  }
  return id;
}

// ------------------------------------------------------------ As rotas

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
          "Procura artigos do comerciante, por ordem de criação, com o total dos que passam no filtro (docs/14 §7.1; docs/18 §2a). Filtros: estado, tipo, SKU de uma variante (sem distinguir maiúsculas) e parte do nome.",
        querystring: ConsultaArtigos,
        response: { 200: RespostaArtigos, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const q = pedido.query;
      const limite = q.limite === undefined ? 25 : Number(q.limite);
      const depois = q.cursor === undefined ? null : idDoCursor(q.cursor);
      const pagina = await noCatalogoApi(resposta, () =>
        listarArtigos(
          base,
          chave.comercianteId,
          {
            ...(q.estado === undefined ? {} : { estado: q.estado }),
            ...(q.tipo === undefined ? {} : { tipo: q.tipo }),
            ...(q.sku === undefined ? {} : { sku: q.sku }),
            ...(q.texto === undefined ? {} : { texto: q.texto }),
          },
          limite,
          depois,
        ),
      );
      return {
        dados: pagina.dados.map(paraArtigo),
        total: pagina.total,
        ha_mais: pagina.ultimo !== null,
        cursor_seguinte:
          pagina.ultimo === null ? null : cursorDe(pagina.ultimo),
      };
    },
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
}
