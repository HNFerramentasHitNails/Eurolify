import type { ColumnType, Generated } from "kysely";

// Tipos das tabelas das migrações 0001 (docs/15-dominio-comerciante.md §3) e
// 0002 (docs/14-dominio-catalogo.md §3). As
// listas de valores vivem nos CHECK da base; estes tipos espelham-nas e um
// teste confirma que a base aceita cada valor e recusa os outros.

export const ESTADOS_COMERCIANTE = [
  "rascunho",
  "prova_pendente",
  "em_revisao",
  "aprovado_limitado",
  "activo",
  "suspenso",
  "fechado",
] as const;
export type EstadoComerciante = (typeof ESTADOS_COMERCIANTE)[number];

export const TIPOS_CONTRATO = [
  "contrato_servico",
  "acordo_tratamento_dados",
] as const;
export type TipoContrato = (typeof TIPOS_CONTRATO)[number];

export type FinalidadeVerificacao =
  "identificacao_fiscal" | "contrato" | "prestador_pagamento";
export type OrigemVerificacao = "manual" | "vies" | "documento";
export type ResultadoVerificacao = "aceite" | "recusada" | "por_rever";

type Instante = ColumnType<Date, Date | string | undefined, never>;

/**
 * O contexto do rasto de auditoria (migração 0053; docs/28 §3.1): escreve-o
 * só o gatilho `rasto_completar()`, nunca o código. Vazio é «desconhecido».
 */
export interface ColunasDoRasto {
  canal: ColumnType<string | null, never, never>;
  pedido: ColumnType<string | null, never, never>;
  ia: ColumnType<Record<string, string> | null, never, never>;
  autorizado_por: ColumnType<string | null, never, never>;
  /** O pedido de origem de uma tarefa (0060; docs/28 §3.7). */
  a_pedido_de: ColumnType<
    { pedido?: string; quem?: string } | null,
    never,
    never
  >;
}

/** O motivo, nas tabelas do rasto que não o tinham (0053). */
export interface MotivoDoRasto {
  motivo: ColumnType<string | null, never, never>;
}

export interface TabelaComerciante {
  id: string;
  estado: ColumnType<EstadoComerciante, EstadoComerciante | undefined>;
  estado_antes_de_suspenso: ColumnType<EstadoComerciante | null, never, never>;
  nome: string;
  lingua: string;
  /** A língua do original do catálogo, uma só (docs/14 §9, P13; 0009). */
  lingua_origem: ColumnType<string, string | undefined, string>;
  fuso: string;
  criado_em: Instante;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

export interface TabelaEntidadeLegal {
  id: Generated<string>;
  comerciante_id: string;
  denominacao: string;
  forma_juridica: string;
  pais: string;
  numero_fiscal: string;
  morada_linha: string;
  morada_codigo_postal: string;
  morada_localidade: string;
  estado: ColumnType<"activa" | "arquivada", "activa" | undefined>;
  /** Quem emite o documento fiscal (migração 0050; ADR-0041). */
  emissor_fiscal: ColumnType<EmissorFiscal, never, EmissorFiscal>;
  criado_em: Instante;
}

export interface TabelaLoja {
  id: Generated<string>;
  comerciante_id: string;
  entidade_legal_id: string;
  nome: string;
  estado: ColumnType<"activa" | "arquivada", "activa" | undefined>;
  criado_em: Instante;
}

export interface TabelaAceitacaoContrato {
  id: Generated<string>;
  comerciante_id: string;
  tipo: TipoContrato;
  versao_texto: string;
  aceite_por: string;
  aceite_em: Instante;
}

export interface TabelaProvaVerificacao {
  id: Generated<string>;
  comerciante_id: string;
  entidade_legal_id: string;
  finalidade: FinalidadeVerificacao;
  origem: OrigemVerificacao;
  origem_detalhe: string;
  resultado: ResultadoVerificacao;
  verificado_em: Instante;
  rever_ate: Date | string | null;
  documento: string | null;
  registado_em: ColumnType<Date, never, never>;
}

export interface TabelaTransicaoEstado extends ColunasDoRasto {
  id: Generated<string>;
  comerciante_id: string;
  de: EstadoComerciante;
  para: EstadoComerciante;
  motivo: string;
  quem: string;
  quando: Instante;
}

// Catálogo, parte 1 (migração 0002; docs/14 §3.1 e §3.2).
export const TIPOS_ARTIGO = [
  "fisico",
  "servico",
  "digital",
  "bilhete",
  "cartao_oferta",
] as const;
export type TipoArtigo = (typeof TIPOS_ARTIGO)[number];

export const ESTADOS_ARTIGO = ["rascunho", "activo", "arquivado"] as const;
export type EstadoArtigo = (typeof ESTADOS_ARTIGO)[number];

export const UNIDADES_DE_VENDA = [
  "unidade",
  "par",
  "caixa",
  "embalagem",
  "conjunto",
] as const;
export type UnidadeDeVenda = (typeof UNIDADES_DE_VENDA)[number];

export const UNIDADES_DE_CONTEUDO = [
  "mg",
  "g",
  "kg",
  "ml",
  "cl",
  "l",
  "mm",
  "cm",
  "m",
  "m2",
  "m3",
] as const;
export type UnidadeDeConteudo = (typeof UNIDADES_DE_CONTEUDO)[number];

export const ORIGENS_GTIN = [
  "gs1_comerciante",
  "fornecedor",
  "interno",
] as const;
export type OrigemGtin = (typeof ORIGENS_GTIN)[number];

// De onde vem o artigo (migração 0002, `artigo_origem_check`): criado no
// Eurolify ou espelhado de um sistema externo, com `origem_ref` (auditoria
// docs/16, «Código»).
export const ORIGENS_ARTIGO = ["eurolify", "externo"] as const;
export type OrigemArtigo = (typeof ORIGENS_ARTIGO)[number];

export const ESTADOS_VARIANTE = ["activa", "arquivada"] as const;
export type EstadoVariante = (typeof ESTADOS_VARIANTE)[number];

// Catálogo: classificação do artigo (migração 0006; docs/14 §3.10). As
// famílias são as de eurolify-legal-briefing-eu/references/sectors.md, pela
// mesma ordem; `por_classificar` é a linha «qualquer família não classificada».
// «Educação e formação» separou-se da saúde (Diogo, 05/10/2026).
export const FAMILIAS_SETORIAIS = [
  "por_classificar",
  "retalho_geral",
  "texteis_calcado_joalharia",
  "cosmeticos_perfumaria",
  "alimentos_bebidas",
  "suplementos_novos_alimentos",
  "alcool_tabaco",
  "animais_plantas_sementes",
  "medicamentos",
  "dispositivos_medicos",
  "biocidas_fitofarmacos",
  "quimicos_misturas",
  "electronica_radio_electrodomesticos",
  "baterias",
  "brinquedos_infantis",
  "maquinas_ferramentas_epi",
  "construcao_medicao",
  "veiculos_pecas_drones",
  "cadeias_florestais_eudr",
  "usados_recondicionados",
  "personalizados_por_encomenda",
  "conteudos_servicos_digitais",
  "cartoes_oferta_vales",
  "servicos_gerais_instalacao",
  "saude_profissoes_reguladas",
  "educacao_formacao",
  "turismo_alojamento_eventos",
  "plataformas_intermediacao",
  "armas_explosivos_jogo",
] as const;
export type FamiliaSetorial = (typeof FAMILIAS_SETORIAIS)[number];

/**
 * As famílias que não se publicam até terem desenho e validação profissional
 * próprios (decisão do Diogo, 05/10/2026: «sim, aceito a lista»; docs/14 §3.10).
 */
export const FAMILIAS_RESTRITAS = [
  "medicamentos",
  "dispositivos_medicos",
  "biocidas_fitofarmacos",
  "alcool_tabaco",
  "armas_explosivos_jogo",
  "saude_profissoes_reguladas",
] as const satisfies readonly FamiliaSetorial[];

export const NATUREZAS_CONSUMIDOR = [
  "bem",
  "servico_presencial",
  "servico_humano_a_distancia",
  "acesso_com_data",
  "conteudo_digital",
  "servico_digital",
  "vale",
] as const;
export type NaturezaConsumidor = (typeof NATUREZAS_CONSUMIDOR)[number];

/** Que natureza cada tipo admite (docs/14 §3.10; a base recusa o resto). */
export const NATUREZAS_DO_TIPO: Readonly<
  Record<TipoArtigo, readonly NaturezaConsumidor[]>
> = {
  fisico: ["bem"],
  servico: ["servico_presencial", "servico_humano_a_distancia"],
  bilhete: ["acesso_com_data"],
  digital: ["conteudo_digital", "servico_digital"],
  cartao_oferta: ["vale"],
};

export const MODOS = ["presencial", "virtual"] as const;
export type Modo = (typeof MODOS)[number];

export interface TabelaArtigo {
  id: Generated<string>;
  comerciante_id: string;
  tipo: TipoArtigo;
  estado: ColumnType<EstadoArtigo, EstadoArtigo | undefined>;
  nome: string;
  descricao: string | null;
  marca: string | null;
  categoria_fiscal: string | null;
  origem: ColumnType<OrigemArtigo, OrigemArtigo | undefined>;
  origem_ref: string | null;
  ja_esteve_activo: ColumnType<boolean, never, never>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
  // Classificação (0006): só se mudam por `classificarArtigo`.
  familias: ColumnType<FamiliaSetorial[], never, FamiliaSetorial[]>;
  natureza_consumidor: ColumnType<
    NaturezaConsumidor | null,
    never,
    NaturezaConsumidor | null
  >;
  modo: ColumnType<Modo | null, never, Modo | null>;
  prestacao_inicio: ColumnType<Date | null, never, Date | null>;
  prestacao_fim: ColumnType<Date | null, never, Date | null>;
  local_pais: ColumnType<string | null, never, string | null>;
  local_territorio: ColumnType<string | null, never, string | null>;
  lazer_com_data: ColumnType<boolean, never, boolean>;
  // A marca «selado por higiene» (docs/30 §15, H1; migração 0065): só num
  // físico; muda-se pelo PATCH, não na criação.
  selado_por_higiene: ColumnType<boolean, never, boolean>;
  // Quem classificou vem de `eurolify.quem` (gatilho da 0006), não do SET.
  classificado_por: ColumnType<string | null, never, never>;
  classificado_em: ColumnType<Date | null, never, never>;
}

export interface TabelaVariante {
  id: Generated<string>;
  comerciante_id: string;
  artigo_id: string;
  sku: string;
  gtin: string | null;
  gtin_origem: OrigemGtin | null;
  unidade_de_venda: UnidadeDeVenda;
  conteudo_quantidade: number | null;
  conteudo_unidade: UnidadeDeConteudo | null;
  peso_g: number | null;
  comprimento_mm: number | null;
  largura_mm: number | null;
  altura_mm: number | null;
  onu: string | null;
  classe_adr: string | null;
  estado: ColumnType<EstadoVariante, "activa" | undefined, "arquivada">;
  posicao: ColumnType<number, number | undefined>;
  criado_em: ColumnType<Date, never, never>;
  // Migração 0048: sobe a cada mudança da linha; quem a sobe é o gatilho, a
  // API só a lê e a confere.
  versao: ColumnType<number, never, never>;
}

// Catálogo, parte 2a (migração 0004; docs/14 §3.4).
export interface TabelaComponente {
  comerciante_id: string;
  kit_id: string;
  componente_id: string;
  quantidade: number;
  posicao: ColumnType<number, number | undefined>;
}

// Catálogo, parte 2b (migração 0005; docs/14 §3.3).
export interface TabelaOpcao {
  id: Generated<string>;
  comerciante_id: string;
  artigo_id: string;
  nome: string;
  posicao: ColumnType<number, number | undefined>;
  criado_em: ColumnType<Date, never, never>;
  // Migração 0043: sobe com qualquer mudança à opção ou aos valores dela;
  // quem a sobe são os gatilhos da base, a API só a lê e a confere.
  versao: ColumnType<number, never, number>;
}

export interface TabelaValorOpcao {
  id: Generated<string>;
  comerciante_id: string;
  artigo_id: string;
  opcao_id: string;
  valor: string;
  posicao: ColumnType<number, number | undefined>;
  criado_em: ColumnType<Date, never, never>;
}

export interface TabelaVarianteValor {
  comerciante_id: string;
  artigo_id: string;
  variante_id: string;
  opcao_id: string;
  valor_id: string;
}

// Catálogo, parte 3a (migração 0007; docs/14 §3.6 e §3.7).
export const ESTADOS_CATEGORIA = ["activa", "arquivada"] as const;
export type EstadoCategoria = (typeof ESTADOS_CATEGORIA)[number];

export interface TabelaCategoria {
  id: Generated<string>;
  comerciante_id: string;
  pai_id: string | null;
  nome: string;
  endereco_amigavel: string;
  posicao: ColumnType<number, number | undefined>;
  estado: ColumnType<EstadoCategoria, never, EstadoCategoria>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

export interface TabelaArtigoCategoria {
  comerciante_id: string;
  artigo_id: string;
  categoria_id: string;
}

export interface TabelaColecao {
  id: Generated<string>;
  comerciante_id: string;
  nome: string;
  descricao: string | null;
  endereco_amigavel: string;
  estado: ColumnType<EstadoCategoria, never, EstadoCategoria>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

export interface TabelaColecaoArtigo {
  comerciante_id: string;
  colecao_id: string;
  artigo_id: string;
  posicao: number;
}

// Catálogo: as imagens dos artigos (migração 0028; docs/14 §3.5).
export const TIPOS_DE_IMAGEM = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type TipoDeImagem = (typeof TIPOS_DE_IMAGEM)[number];

export interface TabelaFicheiro {
  comerciante_id: string;
  resumo: string;
  tipo: TipoDeImagem;
  bytes: number;
  criado_em: ColumnType<Date, never, never>;
}

export interface TabelaMedia {
  id: Generated<string>;
  comerciante_id: string;
  artigo_id: ColumnType<string, string, never>;
  variante_id: ColumnType<string | null, string | null | undefined, never>;
  ficheiro_resumo: ColumnType<string, string, never>;
  texto_alternativo: string | null;
  posicao: number;
  principal: ColumnType<boolean, boolean | undefined, boolean>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

// As exportações (migração 0030; docs/14 §3.11; docs/06, CS). A linha só
// nasce com o ZIP feito; a API não a muda nem apaga.
export const DOMINIOS_EXPORTAVEIS = ["catalogo"] as const;
export type DominioExportavel = (typeof DOMINIOS_EXPORTAVEIS)[number];
export const FORMATO_DO_CATALOGO = "eurolify.catalogo/1";

export interface TabelaExportacao {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  dominios: ColumnType<DominioExportavel[], DominioExportavel[], never>;
  estado: ColumnType<"pronta", never, never>;
  formato: ColumnType<string, string, never>;
  bytes: ColumnType<string, number, never>;
  resumo: ColumnType<string, string, never>;
  criada_em: ColumnType<Date, never, never>;
  expira_em: ColumnType<Date, never, never>;
}

// A linha do tempo do Catálogo (migração 0033; docs/14 §3.12; C7). Só se
// lê: escrevem-na os gatilhos.
export const ENTIDADES_DA_LINHA_DO_TEMPO = [
  "artigo",
  "variante",
  "opcao",
  "valor_opcao",
  "variante_valor",
  "componente",
  "traducao",
  "artigo_categoria",
  "colecao_artigo",
  "media",
  "publicacao",
  "categoria",
  "colecao",
] as const;
export type EntidadeDaLinhaDoTempo =
  (typeof ENTIDADES_DA_LINHA_DO_TEMPO)[number];

export interface TabelaAlteracaoCatalogo extends ColunasDoRasto, MotivoDoRasto {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, never, never>;
  artigo_id: ColumnType<string | null, never, never>;
  entidade: ColumnType<EntidadeDaLinhaDoTempo, never, never>;
  entidade_id: ColumnType<string | null, never, never>;
  operacao: ColumnType<"criado" | "alterado" | "apagado", never, never>;
  campos: ColumnType<
    Record<string, { antes: unknown; depois: unknown }>,
    never,
    never
  >;
  quem: ColumnType<string, never, never>;
  origem: ColumnType<string | null, never, never>;
  transacao: ColumnType<string, never, never>;
  em: ColumnType<Date, never, never>;
}

// As importações (migração 0032; docs/14 §3.11; docs/06, CT).
export const FORMATOS_DE_IMPORTACAO = ["csv", "eurolify.catalogo/1"] as const;
export type FormatoDeImportacao = (typeof FORMATOS_DE_IMPORTACAO)[number];

export interface TabelaImportacao {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  formato: ColumnType<FormatoDeImportacao, FormatoDeImportacao, never>;
  resumo: ColumnType<string, string, never>;
  bytes: ColumnType<number, number, never>;
  estado: ColumnType<"analisada" | "aplicada", never, "aplicada">;
  relatorio: ColumnType<unknown, string, never>;
  plano: ColumnType<unknown, string, never>;
  resultado: ColumnType<unknown, never, string>;
  analisada_em: ColumnType<Date, never, never>;
  aplicada_em: ColumnType<Date | null, never, never>;
  expira_em: ColumnType<Date, never, never>;
}

// Catálogo, parte 3b (migração 0009; docs/14 §3.8 e §4.3).
export const ORIGENS_TRADUCAO = ["pessoa", "ia"] as const;
export type OrigemTraducao = (typeof ORIGENS_TRADUCAO)[number];

export interface TabelaTraducao {
  id: Generated<string>;
  comerciante_id: string;
  artigo_id: ColumnType<string | null, string | null | undefined, never>;
  opcao_id: ColumnType<string | null, string | null | undefined, never>;
  valor_opcao_id: ColumnType<string | null, string | null | undefined, never>;
  categoria_id: ColumnType<string | null, string | null | undefined, never>;
  colecao_id: ColumnType<string | null, string | null | undefined, never>;
  recurso_id: ColumnType<string, never, never>;
  campo: ColumnType<string, string, never>;
  lingua: ColumnType<string, string, never>;
  texto: string;
  original: ColumnType<string, never, never>;
  origem: OrigemTraducao;
  traduzido_por: ColumnType<string, never, never>;
  traduzido_em: ColumnType<Date, never, never>;
  revista: ColumnType<boolean, never, boolean>;
  revisto_por: ColumnType<string | null, never, never>;
  revisto_em: ColumnType<Date | null, never, never>;
}

/** Vista: os textos originais traduzíveis (0009). */
export interface VistaTextoOriginal {
  comerciante_id: string;
  tipo: string;
  recurso_id: string;
  campo: string;
  texto: string | null;
}

// Preços e mercados, parte 1 (migração 0017; docs/20 §3). Os montantes são
// bigint: o pg devolve-os como texto, e o repositório converte-os em número
// (o limite da base, 10^11 cêntimos, cabe num número exacto).
export const ESTADOS_MERCADO = ["rascunho", "activo", "arquivado"] as const;
export type EstadoMercado = (typeof ESTADOS_MERCADO)[number];
export const TIPOS_LISTA_PRECOS = ["base", "b2b"] as const;
export type TipoListaPrecos = (typeof TIPOS_LISTA_PRECOS)[number];

export interface TabelaMercado {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  loja_id: ColumnType<string, string, never>;
  nome: string;
  paises: string[];
  moeda: string;
  linguas: string[];
  lingua_principal: string;
  preco_inclui_iva: ColumnType<boolean, boolean | undefined, boolean>;
  estado: ColumnType<EstadoMercado, never, EstadoMercado>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

export interface TabelaCanal {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  loja_id: ColumnType<string, string, never>;
  nome: string;
  tipo: ColumnType<"online", never, never>;
  estado: ColumnType<"activo" | "arquivado", never, "activo" | "arquivado">;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

export interface TabelaCanalMercado {
  comerciante_id: string;
  loja_id: string;
  canal_id: string;
  mercado_id: string;
}

export interface TabelaListaPrecos {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  mercado_id: ColumnType<string, string, never>;
  nome: string;
  tipo: ColumnType<TipoListaPrecos, TipoListaPrecos, never>;
  etiqueta_id: string | null;
  prioridade: number | null;
  estado: ColumnType<"activa" | "arquivada", never, "activa" | "arquivada">;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

export interface TabelaPreco {
  comerciante_id: ColumnType<string, string, never>;
  lista_id: ColumnType<string, string, never>;
  variante_id: ColumnType<string, string, never>;
  montante: ColumnType<string, number, number>;
  gratuito: boolean;
  quantidade_minima: ColumnType<number, number | undefined, number>;
  multiplo: ColumnType<number, number | undefined, number>;
  definido_por: ColumnType<string, never, never>;
  definido_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

export interface TabelaHistoricoPreco extends ColunasDoRasto, MotivoDoRasto {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, never, never>;
  lista_id: ColumnType<string, never, never>;
  variante_id: ColumnType<string, never, never>;
  montante: ColumnType<string | null, never, never>;
  gratuito: ColumnType<boolean | null, never, never>;
  saiu: ColumnType<boolean, never, never>;
  moeda: ColumnType<string, never, never>;
  preco_inclui_iva: ColumnType<boolean, never, never>;
  em_vigor_desde: ColumnType<Date, never, never>;
  definido_por: ColumnType<string, never, never>;
}

// A redução anunciada (migração 0036; docs/20 §3.6 e §10.2).
export interface TabelaReducao {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, string, never>;
  lista_id: ColumnType<string, string, never>;
  variante_id: ColumnType<string, string, never>;
  montante: ColumnType<string, number, never>;
  preco_referencia: ColumnType<string, never, never>;
  inicio: ColumnType<Date, never, never>;
  fim: ColumnType<Date | null, Date | string | null | undefined, never>;
  terminada_em: ColumnType<Date | null, never, Date | string>;
  terminada_por: ColumnType<string | null, never, never>;
  criada_por: ColumnType<string, never, never>;
}

export const ESTADOS_PUBLICACAO = [
  "rascunho",
  "publicado",
  "arquivado",
] as const;
export type EstadoPublicacao = (typeof ESTADOS_PUBLICACAO)[number];

export const MOTIVOS_ARQUIVO_PUBLICACAO = [
  "retirada",
  "artigo_arquivado",
  "mercado_arquivado",
  "canal_arquivado",
  // Reverificação que falhou (migração 0023; docs/06, CJ).
  "verificacao_falhou",
] as const;
export type MotivoArquivoPublicacao =
  (typeof MOTIVOS_ARQUIVO_PUBLICACAO)[number];

// Catálogo, parte 4: publicação por canal × mercado (migração 0019; docs/14
// §3.9). Quem e quando publicou ou arquivou são postos pela base.
export interface TabelaPublicacao {
  id: Generated<string>;
  comerciante_id: string;
  artigo_id: string;
  loja_id: string;
  canal_id: string;
  mercado_id: string;
  estado: ColumnType<EstadoPublicacao, never, EstadoPublicacao>;
  variantes_fora: ColumnType<string[], string[] | undefined, string[]>;
  ultima_verificacao: ColumnType<unknown, never, string>;
  verificado_em: ColumnType<Date | null, never, Date>;
  publicado_por: ColumnType<string | null, never, never>;
  publicado_em: ColumnType<Date | null, never, never>;
  arquivado_por: ColumnType<string | null, never, never>;
  arquivado_em: ColumnType<Date | null, never, never>;
  motivo_arquivo: ColumnType<MotivoArquivoPublicacao | null, never, never>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

// Clientes e perfis de faturação, parte 1 (migração 0037; docs/23 §3). Os
// campos que a base põe (a régua do NIF, o principal, o estado do VIES, a
// marca de uso num documento) não se escrevem pela API.
export const ESTADOS_VIES = [
  "nao_aplicavel",
  "por_validar",
  "valido",
  "invalido",
  "indisponivel",
] as const;
export type EstadoVies = (typeof ESTADOS_VIES)[number];
export const ENTIDADES_DO_RASTO_CLIENTE = [
  "cliente",
  "perfil_faturacao",
  "etiqueta_cliente",
  "cliente_etiqueta",
  "consentimento",
  "duplicado_cliente",
] as const;
export type EntidadeDoRastoCliente =
  (typeof ENTIDADES_DO_RASTO_CLIENTE)[number];

export interface TabelaCliente {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  nome: string;
  emails: ColumnType<string[], string[] | undefined, string[]>;
  telefones: ColumnType<string[], string[] | undefined, string[]>;
  lingua: string | null;
  pais: string | null;
  estado: ColumnType<"activo" | "fundido" | "pseudonimizado", never, never>;
  fundido_em: ColumnType<string | null, never, never>;
  limitado: ColumnType<boolean, never, never>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

export interface TabelaPerfilFaturacao {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  cliente_id: ColumnType<string, string, never>;
  tipo: "particular" | "empresa";
  nome_documento: string;
  nif_escrito: string | null;
  pais_contribuinte: string | null;
  nif_numero: ColumnType<string | null, never, never>;
  morada_linha1: string | null;
  morada_linha2: string | null;
  morada_codigo_postal: string | null;
  morada_localidade: string | null;
  morada_pais: string | null;
  principal: ColumnType<boolean, never, boolean>;
  estado_vies: ColumnType<EstadoVies, never, never>;
  estado: ColumnType<"activo" | "arquivado", never, "activo" | "arquivado">;
  usado_em_documento: ColumnType<boolean, never, never>;
  /** O perfil de onde veio a cópia numa fusão (migração 0046); só a fusão o põe. */
  copiado_de: ColumnType<string | null, never, never>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

export interface TabelaEtiquetaCliente {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  nome: string;
  estado: ColumnType<"activa" | "arquivada", never, "activa" | "arquivada">;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
}

export interface TabelaClienteEtiqueta {
  comerciante_id: ColumnType<string, string, never>;
  cliente_id: ColumnType<string, string, never>;
  etiqueta_id: ColumnType<string, string, never>;
  posta_em: ColumnType<Date, never, never>;
}

export interface TabelaAlteracaoCliente extends ColunasDoRasto, MotivoDoRasto {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, never, never>;
  cliente_id: ColumnType<string | null, never, never>;
  entidade: ColumnType<EntidadeDoRastoCliente, never, never>;
  entidade_id: ColumnType<string | null, never, never>;
  operacao: ColumnType<"criado" | "alterado" | "apagado", never, never>;
  campos: ColumnType<
    Record<string, { antes: unknown; depois: unknown }>,
    never,
    never
  >;
  quem: ColumnType<string, never, never>;
  origem: ColumnType<string | null, never, never>;
  transacao: ColumnType<string, never, never>;
  em: ColumnType<Date, never, never>;
}

// O VIES e a isenção manual (migração 0039; docs/23 §13). A prova só a
// escreve a `vies_registar`; a isenção, a API, com quem e quando postos pela base.
export interface TabelaValidacaoVies {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, never, never>;
  perfil_id: ColumnType<string, never, never>;
  pais_consultado: ColumnType<string, never, never>;
  numero_consultado: ColumnType<string, never, never>;
  requerente_pais: ColumnType<string | null, never, never>;
  requerente_numero: ColumnType<string | null, never, never>;
  consultado_em: ColumnType<Date, never, never>;
  data_vies: ColumnType<Date | null, never, never>;
  resultado: ColumnType<"valido" | "invalido" | "indisponivel", never, never>;
  codigo_erro: ColumnType<string | null, never, never>;
  identificador_consulta: ColumnType<string | null, never, never>;
  nome_devolvido: ColumnType<string | null, never, never>;
  morada_devolvida: ColumnType<string | null, never, never>;
  motivo: ColumnType<
    "perfil_novo" | "nif_mudou" | "revalidacao" | "pedido",
    never,
    never
  >;
  quem: ColumnType<string, never, never>;
  registado_em: ColumnType<Date, never, never>;
}

export const CANAIS_CONSENTIMENTO = ["email", "sms", "whatsapp"] as const;
export type CanalConsentimento = (typeof CANAIS_CONSENTIMENTO)[number];

/** Uma declaração de consentimento (docs/23 §3.6; migração 0042): não se altera nem se apaga. */
export interface TabelaConsentimento {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  cliente_id: ColumnType<string, string, never>;
  canal: ColumnType<CanalConsentimento, CanalConsentimento, never>;
  finalidade: ColumnType<"marketing", "marketing" | undefined, never>;
  declaracao: ColumnType<"aceitou" | "retirou", "aceitou" | "retirou", never>;
  texto: ColumnType<string, string, never>;
  versao_texto: ColumnType<string, string, never>;
  onde: ColumnType<string, string, never>;
  declarado_em: ColumnType<Date, never, never>;
  quem: ColumnType<string, never, never>;
  /** O contacto a que a declaração se refere (0052); nulo nas antigas. */
  contacto: ColumnType<string | null, string, never>;
  via: ColumnType<"directa" | "dupla_confirmacao", never, never>;
  confirmacao_id: ColumnType<string | null, never, never>;
}

/** Os tipos de ficheiro de um anexo da isenção (0055). */
export const TIPOS_DE_ANEXO = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;
export type TipoDeAnexo = (typeof TIPOS_DE_ANEXO)[number];

/** Um anexo da isenção manual (0055): a prova, que não se altera. */
export interface TabelaAnexoIsencao {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  isencao_id: ColumnType<string, string, never>;
  nome: ColumnType<string | null, string | null, never>;
  tipo: ColumnType<TipoDeAnexo, TipoDeAnexo, never>;
  bytes: ColumnType<Buffer, Buffer, never>;
  tamanho: ColumnType<number, never, never>;
  resumo: ColumnType<string, never, never>;
  posto_por: ColumnType<string, never, never>;
  posto_em: ColumnType<Date, never, never>;
}

/** Um pedido de dupla confirmação (0052); a API só lê, sem o resumo. */
export interface TabelaConfirmacaoConsentimento {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, never, never>;
  cliente_id: ColumnType<string, never, never>;
  canal: ColumnType<"email" | "sms", never, never>;
  contacto: ColumnType<string, never, never>;
  texto: ColumnType<string, never, never>;
  versao_texto: ColumnType<string, never, never>;
  onde: ColumnType<string, never, never>;
  estado: ColumnType<
    "pendente" | "confirmada" | "expirada" | "cancelada" | "esgotada",
    never,
    never
  >;
  tentativas: ColumnType<number, never, never>;
  expira_em: ColumnType<Date, never, never>;
  pedida_por: ColumnType<string, never, never>;
  pedida_em: ColumnType<Date, never, never>;
  fechada_em: ColumnType<Date | null, never, never>;
  consentimento_id: ColumnType<string | null, never, never>;
}

export const SINAIS_DUPLICADO = [
  "nif_particular",
  "email",
  "telefone",
] as const;
export type SinalDuplicado = (typeof SINAIS_DUPLICADO)[number];
export const ESTADOS_DUPLICADO = [
  "por_decidir",
  "descartado",
  "fundido",
  "fechado",
] as const;
export type EstadoDuplicado = (typeof ESTADOS_DUPLICADO)[number];

/** Um par de fichas que talvez sejam a mesma pessoa (migração 0046); a API só lê. */
export interface TabelaDuplicadoCliente {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, never, never>;
  cliente_a: ColumnType<string, never, never>;
  cliente_b: ColumnType<string, never, never>;
  sinais: ColumnType<SinalDuplicado[], never, never>;
  forte: ColumnType<boolean, never, never>;
  estado: ColumnType<EstadoDuplicado, never, never>;
  motivo: ColumnType<string | null, never, never>;
  decidido_por: ColumnType<string | null, never, never>;
  decidido_em: ColumnType<Date | null, never, never>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  /** Desde quando está por decidir nesta passagem (0066; docs/33 §4.1). */
  por_decidir_desde: ColumnType<Date | null, never, never>;
}

export const TIPOS_PEDIDO_TITULAR = [
  "exportacao",
  "limitacao",
  "fim_da_limitacao",
  "apagamento",
] as const;
export type TipoPedidoTitular = (typeof TIPOS_PEDIDO_TITULAR)[number];

/** Um pedido do titular (migração 0049): só se acrescenta; escrevem-no as funções do dono. */
export interface TabelaPedidoTitular {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, never, never>;
  cliente_id: ColumnType<string, never, never>;
  tipo: ColumnType<TipoPedidoTitular, never, never>;
  verificacao: ColumnType<string, never, never>;
  quem: ColumnType<string, never, never>;
  em: ColumnType<Date, never, never>;
  resultado: ColumnType<Record<string, unknown>, never, never>;
}

export interface TabelaIsencaoManual {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  perfil_id: ColumnType<string, string, never>;
  pais_contribuinte: ColumnType<string | null, never, never>;
  nif_numero: ColumnType<string | null, never, never>;
  codigo_motivo: ColumnType<string | null, string | null | undefined, never>;
  motivo: ColumnType<string, string, never>;
  nota: ColumnType<string | null, string | null | undefined, never>;
  posta_por: ColumnType<string, never, never>;
  posta_em: ColumnType<Date, never, never>;
  motivo_retirada: ColumnType<string | null, never, string>;
  retirada_por: ColumnType<string | null, never, never>;
  retirada_em: ColumnType<Date | null, never, never>;
}

// O Motor de IVA (migração 0040; docs/24 §3). As tabelas globais só se
// lêem; a declaração do regime só se acrescenta.
export interface TabelaCategoriaFiscal {
  codigo: ColumnType<string, never, never>;
  descricao_pt: ColumnType<string, never, never>;
  descricao_en: ColumnType<string, never, never>;
  estado: ColumnType<"activa" | "por_validar" | "arquivada", never, never>;
}

export interface TabelaTaxaIva {
  id: ColumnType<string, never, never>;
  pais: ColumnType<string, never, never>;
  regiao: ColumnType<string | null, never, never>;
  categoria: ColumnType<string, never, never>;
  tipo: ColumnType<"taxa" | "isenta", never, never>;
  percentagem: ColumnType<number | null, never, never>;
  codigo_motivo: ColumnType<string | null, never, never>;
  inicio: ColumnType<Date | string, never, never>;
  fonte: ColumnType<string, never, never>;
  verificado: ColumnType<boolean, never, never>;
  verificado_por: ColumnType<string | null, never, never>;
}

export interface TabelaTerritorioFiscal {
  id: ColumnType<string, never, never>;
  pais: ColumnType<string, never, never>;
  prefixo_cp: ColumnType<string, never, never>;
  efeito: ColumnType<"fora_do_iva_ue" | "regiao" | "por_validar", never, never>;
  regiao: ColumnType<string | null, never, never>;
  nome: ColumnType<string, never, never>;
  fonte: ColumnType<string, never, never>;
}

export interface TabelaMotivoIva {
  pais: ColumnType<string, never, never>;
  codigo: ColumnType<string, never, never>;
  tipo: ColumnType<
    "exportacao" | "intracomunitaria" | "isento_natureza" | "outro",
    never,
    never
  >;
  descricao: ColumnType<string, never, never>;
  fonte: ColumnType<string, never, never>;
}

export interface TabelaDeclaracaoRegime {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, string, never>;
  entidade_legal_id: ColumnType<string, string, never>;
  regime: ColumnType<"origem" | "destino", "origem" | "destino", never>;
  oss_desde: ColumnType<Date | string | null, string | null | undefined, never>;
  registos: ColumnType<unknown, string | undefined, never>;
  declarado_por: ColumnType<string, never, never>;
  declarado_em: ColumnType<Date, never, never>;
}

// O checkout (migração 0041; docs/25): textos legais, métodos de entrega,
// carrinho, sessão e o núcleo da encomenda.
export const TIPOS_TEXTO_LEGAL = [
  "condicoes_gerais",
  "informacao_pre_contratual",
  "privacidade",
  "livre_resolucao",
  "garantia_legal",
] as const;
export type TipoTextoLegal = (typeof TIPOS_TEXTO_LEGAL)[number];
export type TipoCliente = "consumidor" | "profissional";
export type FinalidadeCompra = "consumo" | "profissional" | "revenda";

export interface TabelaTextoLegal {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  loja_id: ColumnType<string, string, never>;
  tipo: ColumnType<TipoTextoLegal, TipoTextoLegal, never>;
  pais: ColumnType<string, string, never>;
  lingua: ColumnType<string, string, never>;
  tipo_cliente: ColumnType<TipoCliente, TipoCliente, never>;
  criado_em: ColumnType<Date, never, never>;
}

export interface TabelaVersaoTextoLegal {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  texto_legal_id: ColumnType<string, string, never>;
  numero: ColumnType<number, never, never>;
  texto: string;
  estado: ColumnType<"rascunho" | "publicada", never, "publicada">;
  validado_por_jurista: ColumnType<boolean, boolean | undefined, boolean>;
  jurista: ColumnType<string | null, string | null | undefined, string | null>;
  validado_em: ColumnType<
    Date | string | null,
    string | null | undefined,
    string | null
  >;
  criada_por: ColumnType<string, string, never>;
  criada_em: ColumnType<Date, never, never>;
  publicada_por: ColumnType<string | null, never, never>;
  publicada_em: ColumnType<Date | null, never, never>;
}

export interface TabelaMetodoEntrega {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  loja_id: ColumnType<string, string, never>;
  mercado_id: ColumnType<string, string, never>;
  nome: ColumnType<Record<string, string>, string, string>;
  prazo: ColumnType<Record<string, string>, string | undefined, string>;
  tarifa: ColumnType<string, number, number>;
  gratis_a_partir_de: ColumnType<
    string | null,
    number | null | undefined,
    number | null
  >;
  pede_telefone: ColumnType<boolean, boolean | undefined, boolean>;
  estado: ColumnType<"activo" | "arquivado", never, "activo" | "arquivado">;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, Date>;
  versao: ColumnType<number, never, number>;
}

export interface TabelaCarrinho {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  loja_id: ColumnType<string, string, never>;
  canal_id: ColumnType<string, string, never>;
  mercado_id: ColumnType<string, string, string>;
  lingua: ColumnType<string, string, never>;
  estado: ColumnType<
    "aberto" | "em_checkout" | "convertido" | "expirado",
    never,
    "aberto" | "em_checkout" | "convertido" | "expirado"
  >;
  segredo_resumo: ColumnType<string, string, never>;
  expira_em: ColumnType<Date, never, Date>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, Date>;
  versao: ColumnType<number, never, number>;
}

export interface TabelaLinhaCarrinho {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  carrinho_id: ColumnType<string, string, never>;
  variante_id: ColumnType<string, string, never>;
  quantidade: number;
  criada_em: ColumnType<Date, never, never>;
}

export type EstadoSessaoCheckout =
  "aberta" | "concluida" | "expirada" | "abandonada";

export interface TabelaSessaoCheckout {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  loja_id: ColumnType<string, string, never>;
  carrinho_id: ColumnType<string, string, never>;
  mercado_id: ColumnType<string, string, string>;
  lingua: ColumnType<string, string, never>;
  token_resumo: ColumnType<string, string, never>;
  estado: ColumnType<EstadoSessaoCheckout, never, EstadoSessaoCheckout>;
  expira_em: ColumnType<Date, never, Date>;
  email: ColumnType<string | null, never, string | null>;
  nome: ColumnType<string | null, never, string | null>;
  telefone: ColumnType<string | null, never, string | null>;
  entrega: ColumnType<unknown, never, string | null>;
  finalidade: ColumnType<FinalidadeCompra, never, FinalidadeCompra>;
  faturacao: ColumnType<unknown, never, string | null>;
  metodo_entrega_id: ColumnType<string | null, never, string | null>;
  metodo_pagamento: ColumnType<string | null, never, string | null>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  concluida_em: ColumnType<Date | null, never, Date | null>;
  versao: ColumnType<number, never, never>;
}

export const ESTADOS_ENCOMENDA = [
  "a_aguardar_pagamento",
  "paga",
  "cancelada_sem_pagamento",
  "em_preparacao",
  "expedida_parcial",
  "expedida",
  "entregue",
  "concluida",
  "cancelada",
  "devolvida_parcial",
  "devolvida",
] as const;
export type EstadoEncomenda = (typeof ESTADOS_ENCOMENDA)[number];

export interface TabelaEncomenda {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  loja_id: ColumnType<string, string, never>;
  canal_id: ColumnType<string, string, never>;
  mercado_id: ColumnType<string, string, never>;
  entidade_legal_id: ColumnType<string, string, never>;
  sessao_id: ColumnType<string, string, never>;
  cliente_id: ColumnType<string, string, never>;
  perfil_id: ColumnType<string, string, never>;
  perfil_copia: ColumnType<unknown, string, never>;
  contacto: ColumnType<unknown, string, never>;
  entrega: ColumnType<unknown, string, never>;
  finalidade: ColumnType<FinalidadeCompra, FinalidadeCompra, never>;
  moeda: ColumnType<string, string, never>;
  preco_inclui_iva: ColumnType<boolean, boolean, never>;
  lingua: ColumnType<string, string, never>;
  total_base: ColumnType<string, number, never>;
  total_iva: ColumnType<string, number, never>;
  total: ColumnType<string, number, never>;
  portes: ColumnType<unknown, string, never>;
  metodo_entrega: ColumnType<unknown, string, never>;
  metodo_pagamento: ColumnType<string, string, never>;
  aceitacoes: ColumnType<unknown, string, never>;
  /** Copiado da entidade no botão final (0050); nunca muda. */
  emissor_fiscal: ColumnType<EmissorFiscal, never, never>;
  estado: ColumnType<EstadoEncomenda, never, EstadoEncomenda>;
  criada_por: ColumnType<string, string, never>;
  criada_em: ColumnType<Date, never, never>;
}

export interface TabelaLinhaEncomenda {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  encomenda_id: ColumnType<string, string, never>;
  posicao: ColumnType<number, number, never>;
  variante_id: ColumnType<string, string, never>;
  sku: ColumnType<string, string, never>;
  nome: ColumnType<string, string, never>;
  quantidade: ColumnType<number, number, never>;
  preco_unitario: ColumnType<string, number, never>;
  preco: ColumnType<unknown, string, never>;
  decisao_iva: ColumnType<unknown, string, never>;
  base: ColumnType<string, number, never>;
  iva: ColumnType<string, number, never>;
  total: ColumnType<string, number, never>;
  /** Copiada do artigo no botão final (docs/30 §15, H2; a base confere). */
  selado_por_higiene: ColumnType<boolean, boolean, never>;
}

// Pagamentos (migração 0044; docs/26).
export const METODOS_PAGAMENTO = ["mb_way", "multibanco"] as const;
export type MetodoPagamento = (typeof METODOS_PAGAMENTO)[number];
export const ESTADOS_PAGAMENTO = [
  "criado",
  "a_aguardar_cliente",
  "autorizado",
  "capturado",
  "falhado",
  "expirado",
  "anulado",
  "incerto",
  "reembolsado_parcial",
  "reembolsado",
  "em_disputa",
  "ganha",
  "perdida",
] as const;
export type EstadoPagamento = (typeof ESTADOS_PAGAMENTO)[number];
export type OrigemTransicao = "aviso" | "consulta" | "pessoa" | "sistema";
export const MOTIVOS_DIFERENCA = [
  "incerto",
  "aviso_sem_pagamento",
  "montante_diferente",
  "moeda_diferente",
  "transicao_impossivel",
  "pago_depois_de_cancelada",
  "pagamento_duplicado",
  // Os reembolsos pelo prestador (migração 0061; docs/30 §13).
  "reembolso_incerto",
  "reembolso_por_confirmar",
  "reembolso_desconhecido",
] as const;
export type MotivoDiferenca = (typeof MOTIVOS_DIFERENCA)[number];

export interface TabelaContaPagamento {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  prestador: ColumnType<"eupago", "eupago", never>;
  nome: ColumnType<string, string, string>;
  modo: ColumnType<"teste", never, never>;
  credenciais_cifra: ColumnType<Buffer | null, never, Buffer | null>;
  segredo_aviso_cifra: ColumnType<Buffer | null, never, Buffer | null>;
  chave_versao: ColumnType<string | null, never, string | null>;
  credenciais_em: ColumnType<Date | null, never, Date | null>;
  credenciais_por: ColumnType<string | null, never, string | null>;
  testada_em: ColumnType<Date | null, never, Date | null>;
  estado: ColumnType<
    "rascunho" | "pronta" | "arquivada",
    never,
    "rascunho" | "pronta" | "arquivada"
  >;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, Date>;
  versao: ColumnType<number, never, number>;
}

export interface TabelaMetodoPagamento {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  loja_id: ColumnType<string, string, never>;
  mercado_id: ColumnType<string, string, never>;
  metodo: ColumnType<MetodoPagamento, MetodoPagamento, never>;
  conta_id: ColumnType<string, string, string>;
  ordem: ColumnType<number, number | undefined, number>;
  prazo_minutos: ColumnType<number, number, number>;
  estado: ColumnType<"activo" | "arquivado", never, "activo" | "arquivado">;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, Date>;
  versao: ColumnType<number, never, number>;
}

export interface TabelaPagamento {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  encomenda_id: ColumnType<string, string, never>;
  conta_id: ColumnType<string, string, never>;
  prestador: ColumnType<"eupago", "eupago", never>;
  metodo: ColumnType<MetodoPagamento, MetodoPagamento, never>;
  modo: ColumnType<"teste", "teste", never>;
  montante: ColumnType<string, number, never>;
  moeda: ColumnType<string, string, never>;
  referencia: ColumnType<string, string, never>;
  referencia_prestador: ColumnType<string | null, never, string | null>;
  instrucoes: ColumnType<unknown, never, string | null>;
  /** O `trid` da EuPago, gravado uma vez do aviso (0061; docs/30 §13, P2). */
  id_transaccao_prestador: ColumnType<string | null, never, string>;
  estado: ColumnType<EstadoPagamento, never, EstadoPagamento>;
  expira_em: ColumnType<Date, Date, never>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, Date>;
}

export interface TabelaAvisoPagamento {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  conta_id: ColumnType<string, string, never>;
  id_evento: ColumnType<string, string, never>;
  corpo: ColumnType<string, string, never>;
  assinatura_valida: ColumnType<boolean, boolean, never>;
  pagamento_id: ColumnType<string | null, never, string | null>;
  resultado: ColumnType<string | null, never, string | null>;
  erro: ColumnType<string | null, never, string | null>;
  recebido_em: ColumnType<Date, never, never>;
  processado_em: ColumnType<Date | null, never, Date | null>;
}

export interface TabelaTransicaoPagamento extends ColunasDoRasto {
  id: Generated<string>;
  comerciante_id: ColumnType<string, never, never>;
  pagamento_id: ColumnType<string, never, never>;
  de: ColumnType<EstadoPagamento | null, never, never>;
  para: ColumnType<EstadoPagamento, never, never>;
  origem: ColumnType<OrigemTransicao, never, never>;
  aviso_id: ColumnType<string | null, never, never>;
  quem: ColumnType<string, never, never>;
  motivo: ColumnType<string | null, never, never>;
  em: ColumnType<Date, never, never>;
}

export interface TabelaDiferencaPagamento {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  pagamento_id: ColumnType<string | null, string | null, never>;
  aviso_id: ColumnType<string | null, string | null, never>;
  motivo: ColumnType<MotivoDiferenca, MotivoDiferenca, never>;
  prova: ColumnType<unknown, string, never>;
  estado: ColumnType<"aberta" | "resolvida", never, "resolvida">;
  resolucao: ColumnType<string | null, never, string>;
  resolvida_por: ColumnType<string | null, never, string>;
  resolvida_em: ColumnType<Date | null, never, Date>;
  criada_em: ColumnType<Date, never, never>;
}

// Stock e encomendas (migração 0047; docs/27).
export const POLITICAS_STOCK = [
  "controla",
  "nao_controla",
  "vende_sem_stock",
] as const;
export type PoliticaStock = (typeof POLITICAS_STOCK)[number];
export type TipoMovimento =
  "entrada" | "reserva" | "libertacao" | "saida" | "ajuste" | "devolucao";
export type OrigemMovimento =
  | "encomenda"
  | "expedicao"
  | "inventario"
  | "importacao"
  | "sistema_externo"
  | "devolucao";
export const ESTADOS_EXPEDICAO = [
  "criada",
  "expedida",
  "entregue",
  "devolvida_ao_remetente",
  "perdida",
  "cancelada",
] as const;
export type EstadoExpedicao = (typeof ESTADOS_EXPEDICAO)[number];

export interface TabelaArmazem {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  loja_id: ColumnType<string, string, never>;
  nome: ColumnType<string, string, string>;
  morada: ColumnType<unknown, string | undefined, string>;
  estado: ColumnType<"activo" | "arquivado", never, "activo" | "arquivado">;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, Date>;
  versao: ColumnType<number, never, number>;
}

export interface TabelaPoliticaStock {
  comerciante_id: ColumnType<string, string, never>;
  variante_id: ColumnType<string, string, never>;
  politica: ColumnType<PoliticaStock, PoliticaStock, PoliticaStock>;
  exige_lote: ColumnType<boolean, boolean | undefined, boolean>;
  actualizado_por: ColumnType<string, string, string>;
  actualizado_em: ColumnType<Date, never, Date>;
}

export interface TabelaLinhaEncomendaFolha {
  comerciante_id: ColumnType<string, string, never>;
  linha_encomenda_id: ColumnType<string, string, never>;
  variante_id: ColumnType<string, string, never>;
  por_unidade: ColumnType<number, number, never>;
}

export interface TabelaLote {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  variante_id: ColumnType<string, string, never>;
  numero: ColumnType<string, string, never>;
  validade: ColumnType<string | null, string | null | undefined, never>;
  criado_em: ColumnType<Date, never, never>;
}

export interface TabelaSaldoStock {
  comerciante_id: ColumnType<string, never, never>;
  armazem_id: ColumnType<string, never, never>;
  variante_id: ColumnType<string, never, never>;
  fisico: ColumnType<number, never, never>;
  reservado: ColumnType<number, never, never>;
}

export interface TabelaSaldoLote {
  comerciante_id: ColumnType<string, never, never>;
  armazem_id: ColumnType<string, never, never>;
  lote_id: ColumnType<string, never, never>;
  fisico: ColumnType<number, never, never>;
}

export interface TabelaMovimentoStock {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  armazem_id: ColumnType<string, string, never>;
  variante_id: ColumnType<string, string, never>;
  lote_id: ColumnType<string | null, string | null | undefined, never>;
  tipo: ColumnType<TipoMovimento, TipoMovimento, never>;
  quantidade: ColumnType<number, number, never>;
  origem: ColumnType<OrigemMovimento, OrigemMovimento, never>;
  encomenda_id: ColumnType<string | null, string | null | undefined, never>;
  expedicao_id: ColumnType<string | null, string | null | undefined, never>;
  devolucao_id: ColumnType<string | null, string | null | undefined, never>;
  motivo: ColumnType<string | null, string | null | undefined, never>;
  fisico_antes: ColumnType<number, never, never>;
  fisico_depois: ColumnType<number, never, never>;
  reservado_antes: ColumnType<number, never, never>;
  reservado_depois: ColumnType<number, never, never>;
  quem: ColumnType<string, never, never>;
  em: ColumnType<Date, never, never>;
}

export interface TabelaExpedicao {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  encomenda_id: ColumnType<string, string, never>;
  armazem_id: ColumnType<string, string, never>;
  metodo_entrega: ColumnType<unknown, string, never>;
  transportadora: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  servico: ColumnType<string | null, string | null | undefined, string | null>;
  seguimento: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  estado: ColumnType<EstadoExpedicao, never, EstadoExpedicao>;
  expedida_em: ColumnType<Date | null, never, never>;
  entregue_em: ColumnType<Date | null, never, never>;
  prova_entrega: ColumnType<string | null, never, string | null>;
  criada_por: ColumnType<string, string, never>;
  criada_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, number>;
}

export interface TabelaLinhaExpedicao {
  comerciante_id: ColumnType<string, string, never>;
  expedicao_id: ColumnType<string, string, never>;
  linha_encomenda_id: ColumnType<string, string, never>;
  quantidade: ColumnType<number, number, never>;
}

export interface TabelaTransicaoEncomenda extends ColunasDoRasto {
  id: Generated<string>;
  comerciante_id: ColumnType<string, never, never>;
  encomenda_id: ColumnType<string, never, never>;
  de: ColumnType<string | null, never, never>;
  para: ColumnType<string, never, never>;
  quem: ColumnType<string, never, never>;
  motivo: ColumnType<string | null, never, never>;
  em: ColumnType<Date, never, never>;
}

// Notificações (migrações 0067 e 0071; docs/34).
export const TIPOS_NOTIFICACAO = [
  "refund.deadline_approaching",
  "refund.deadline_passed",
  "task.overdue",
] as const;
export type TipoNotificacao = (typeof TIPOS_NOTIFICACAO)[number];
export const ESTADOS_NOTIFICACAO = [
  "a_enviar",
  "enviada",
  "falhada",
  "cancelada",
] as const;
export type EstadoNotificacao = (typeof ESTADOS_NOTIFICACAO)[number];

/** Grava-a o gatilho do aviso; a API só a lê e muda o estado. */
export interface TabelaNotificacao {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, never, never>;
  tipo: ColumnType<TipoNotificacao, never, never>;
  referencia: ColumnType<string, never, never>;
  pessoa_id: ColumnType<string, never, never>;
  lingua: ColumnType<"pt" | "es" | "en", never, never>;
  dados: ColumnType<Record<string, unknown>, never, never>;
  estado: ColumnType<EstadoNotificacao, never, EstadoNotificacao>;
  tentativas: ColumnType<number, never, number>;
  proxima_em: ColumnType<Date, never, Date>;
  ultimo_erro: ColumnType<string | null, never, string | null>;
  id_mensagem: ColumnType<string | null, never, string | null>;
  criada_em: ColumnType<Date, never, never>;
  terminada_em: ColumnType<Date | null, never, never>;
}

export interface BaseDados {
  comerciante: TabelaComerciante;
  entidade_legal: TabelaEntidadeLegal;
  loja: TabelaLoja;
  aceitacao_contrato: TabelaAceitacaoContrato;
  prova_verificacao: TabelaProvaVerificacao;
  transicao_estado: TabelaTransicaoEstado;
  artigo: TabelaArtigo;
  variante: TabelaVariante;
  componente: TabelaComponente;
  opcao: TabelaOpcao;
  valor_opcao: TabelaValorOpcao;
  variante_valor: TabelaVarianteValor;
  categoria: TabelaCategoria;
  artigo_categoria: TabelaArtigoCategoria;
  colecao: TabelaColecao;
  colecao_artigo: TabelaColecaoArtigo;
  ficheiro: TabelaFicheiro;
  media: TabelaMedia;
  exportacao: TabelaExportacao;
  importacao: TabelaImportacao;
  alteracao_catalogo: TabelaAlteracaoCatalogo;
  traducao: TabelaTraducao;
  texto_original: VistaTextoOriginal;
  mercado: TabelaMercado;
  canal: TabelaCanal;
  canal_mercado: TabelaCanalMercado;
  lista_precos: TabelaListaPrecos;
  preco: TabelaPreco;
  historico_preco: TabelaHistoricoPreco;
  reducao: TabelaReducao;
  publicacao: TabelaPublicacao;
  cliente: TabelaCliente;
  perfil_faturacao: TabelaPerfilFaturacao;
  etiqueta_cliente: TabelaEtiquetaCliente;
  cliente_etiqueta: TabelaClienteEtiqueta;
  alteracao_cliente: TabelaAlteracaoCliente;
  validacao_vies: TabelaValidacaoVies;
  isencao_manual: TabelaIsencaoManual;
  consentimento: TabelaConsentimento;
  duplicado_cliente: TabelaDuplicadoCliente;
  pedido_titular: TabelaPedidoTitular;
  confirmacao_consentimento: TabelaConfirmacaoConsentimento;
  anexo_isencao: TabelaAnexoIsencao;
  categoria_fiscal: TabelaCategoriaFiscal;
  taxa_iva: TabelaTaxaIva;
  territorio_fiscal: TabelaTerritorioFiscal;
  motivo_iva: TabelaMotivoIva;
  declaracao_regime: TabelaDeclaracaoRegime;
  texto_legal: TabelaTextoLegal;
  versao_texto_legal: TabelaVersaoTextoLegal;
  metodo_entrega: TabelaMetodoEntrega;
  carrinho: TabelaCarrinho;
  linha_carrinho: TabelaLinhaCarrinho;
  sessao_checkout: TabelaSessaoCheckout;
  encomenda: TabelaEncomenda;
  linha_encomenda: TabelaLinhaEncomenda;
  conta_pagamento: TabelaContaPagamento;
  metodo_pagamento: TabelaMetodoPagamento;
  pagamento: TabelaPagamento;
  aviso_pagamento: TabelaAvisoPagamento;
  transicao_pagamento: TabelaTransicaoPagamento;
  diferenca_pagamento: TabelaDiferencaPagamento;
  armazem: TabelaArmazem;
  politica_stock: TabelaPoliticaStock;
  lote: TabelaLote;
  saldo_stock: TabelaSaldoStock;
  saldo_lote: TabelaSaldoLote;
  movimento_stock: TabelaMovimentoStock;
  expedicao: TabelaExpedicao;
  linha_expedicao: TabelaLinhaExpedicao;
  transicao_encomenda: TabelaTransicaoEncomenda;
  linha_encomenda_folha: TabelaLinhaEncomendaFolha;
  ligacao_faturacao: TabelaLigacaoFaturacao;
  documento_fiscal: TabelaDocumentoFiscal;
  documento_conteudo: TabelaDocumentoConteudo;
  documento_prova: TabelaDocumentoProva;
  documento_rasto: TabelaDocumentoRasto;
  pedido_livre_resolucao: TabelaPedidoLivreResolucao;
  linha_livre_resolucao: TabelaLinhaLivreResolucao;
  devolucao: TabelaDevolucao;
  notificacao: TabelaNotificacao;
  linha_devolucao: TabelaLinhaDevolucao;
  problema: TabelaProblema;
  reembolso: TabelaReembolso;
  linha_reembolso: TabelaLinhaReembolso;
  atribuicao: TabelaAtribuicao;
  atribuicao_rasto: TabelaAtribuicaoRasto;
}

// Documentos fiscais (migração 0050; docs/29).

export const EMISSORES_FISCAIS = [
  "por_configurar",
  "eurolify",
  "sistema_proprio",
] as const;
export type EmissorFiscal = (typeof EMISSORES_FISCAIS)[number];

export const ADAPTADORES_FATURACAO = ["ensaio", "moloni"] as const;
export type AdaptadorFaturacao = (typeof ADAPTADORES_FATURACAO)[number];

export const ESTADOS_LIGACAO_FATURACAO = [
  "por_testar",
  "pronta",
  "com_erro",
] as const;
export type EstadoLigacaoFaturacao = (typeof ESTADOS_LIGACAO_FATURACAO)[number];

export const ESTADOS_DOCUMENTO = [
  "a_verificar",
  "retido",
  "pronto",
  "rascunho",
  "emitido",
  "incerto",
  "divergente",
  "resolvido",
  // Emitida no sistema próprio, fora do Eurolify (docs/29 §15; 0070).
  "fora",
] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

export interface TaxaDoEmissor {
  pais: string;
  /** Centésimas de ponto (2300 = 23 %). */
  taxa: number;
  emissor: string;
}

export interface IsencaoDoEmissor {
  codigo: string;
  emissor: string;
}

/**
 * A configuração de uma ligação (docs/29 §13.2): só identificadores do
 * emissor, nunca nomes. `metodos_pagamento` vai do método do Eurolify ao id
 * do método no emissor.
 */
export interface ConfigDaLigacao {
  [chave: string]: string | Record<string, string> | undefined;
  metodos_pagamento?: Record<string, string>;
}

export interface TabelaLigacaoFaturacao {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  entidade_legal_id: ColumnType<string, string, never>;
  adaptador: ColumnType<AdaptadorFaturacao, AdaptadorFaturacao, never>;
  modo: ColumnType<"teste", never, never>;
  estado: ColumnType<EstadoLigacaoFaturacao, never, EstadoLigacaoFaturacao>;
  activa: ColumnType<boolean, never, boolean>;
  credenciais: ColumnType<Buffer | null, never, Buffer | null>;
  credenciais_versao_chave: ColumnType<string | null, never, string | null>;
  credenciais_em: ColumnType<Date | null, never, Date | null>;
  credenciais_por: ColumnType<string | null, never, string | null>;
  serie: ColumnType<string | null, string | null, string | null>;
  taxas: ColumnType<TaxaDoEmissor[], string, string>;
  isencoes: ColumnType<IsencaoDoEmissor[], string, string>;
  /** Os ids do emissor por omissão (docs/29 §13.2; migração 0069). */
  config: ColumnType<ConfigDaLigacao, string | undefined, string>;
  /** Os tokens que o emissor renova sozinho, cifrados (§13.4). */
  sessao: ColumnType<Buffer | null, never, Buffer | null>;
  sessao_versao_chave: ColumnType<string | null, never, string | null>;
  sessao_em: ColumnType<Date | null, never, Date | null>;
  testada_em: ColumnType<Date | null, never, Date | null>;
  erro: ColumnType<string | null, never, string | null>;
  versao: ColumnType<number, never, number>;
  criada_por: ColumnType<string, string, never>;
  criada_em: ColumnType<Date, never, never>;
  actualizada_em: ColumnType<Date, never, never>;
}

export interface TabelaDocumentoFiscal {
  id: Generated<string>;
  comerciante_id: ColumnType<string, never, never>;
  encomenda_id: ColumnType<string, never, never>;
  entidade_legal_id: ColumnType<string, never, never>;
  tipo: ColumnType<"fatura" | "nota_credito", never, never>;
  original_id: ColumnType<string | null, never, never>;
  reembolso_id: ColumnType<string | null, never, never>;
  modo: ColumnType<"teste", never, never>;
  estado: ColumnType<EstadoDocumento, never, EstadoDocumento>;
  motivos: ColumnType<string[], never, string[]>;
  validados: ColumnType<string[], never, string[]>;
  ligacao_id: ColumnType<string | null, never, string | null>;
  emissor_id: ColumnType<string | null, never, string | null>;
  /** O número declarado no sistema próprio (docs/29 §15, F3; 0070). */
  fora_numero: ColumnType<string | null, never, string | null>;
  tentativas: ColumnType<number, never, number>;
  falhas: ColumnType<number, never, number>;
  proxima_em: ColumnType<Date, never, Date>;
  reservado_ate: ColumnType<Date | null, never, Date | null>;
  versao: ColumnType<number, never, number>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  /** Desde quando está na fila de uma pessoa (0066; docs/33 §4.1); põe-no o gatilho. */
  na_fila_desde: ColumnType<Date | null, never, never>;
}

export interface TabelaDocumentoConteudo {
  documento_id: ColumnType<string, string, never>;
  comerciante_id: ColumnType<string, string, never>;
  versao: ColumnType<number, number, never>;
  conteudo: ColumnType<unknown, string, never>;
  impressao: ColumnType<string, string, never>;
  motivo: ColumnType<string, string, never>;
  quem: ColumnType<string, string, never>;
  em: ColumnType<Date, never, never>;
}

export interface TabelaDocumentoProva {
  id: Generated<string>;
  documento_id: ColumnType<string, string, never>;
  comerciante_id: ColumnType<string, string, never>;
  numero: ColumnType<string, string, never>;
  serie: ColumnType<string | null, string | null, never>;
  data: ColumnType<string | null, string | null, never>;
  atcud: ColumnType<string | null, string | null, never>;
  nif: ColumnType<string | null, string | null, never>;
  nome: ColumnType<string | null, string | null, never>;
  pais: ColumnType<string | null, string | null, never>;
  linhas: ColumnType<unknown, string, never>;
  totais: ColumnType<unknown, string, never>;
  pdf: ColumnType<Buffer | null, Buffer | null, never>;
  em_bruto: ColumnType<unknown, string, never>;
  divergencias: ColumnType<unknown, string, never>;
  lida_em: ColumnType<Date, never, never>;
}

export interface TabelaDocumentoRasto extends ColunasDoRasto {
  id: Generated<string>;
  documento_id: ColumnType<string, string, never>;
  comerciante_id: ColumnType<string, string, never>;
  passo: ColumnType<string, string, never>;
  de: ColumnType<string | null, string | null, never>;
  para: ColumnType<string | null, string | null, never>;
  motivo: ColumnType<string | null, string | null, never>;
  quem: ColumnType<string, string, never>;
  dados: ColumnType<unknown, string | undefined, never>;
  em: ColumnType<Date, never, never>;
}

// Pós-venda (migração 0058; docs/30).

export const ESTADOS_ARTIGO_DEVOLVIDO = [
  "revendavel",
  "aberto",
  "danificado",
  "em_falta",
] as const;
export type EstadoArtigoDevolvido = (typeof ESTADOS_ARTIGO_DEVOLVIDO)[number];
export const ESTADOS_DEVOLUCAO = [
  "a_aguardar",
  "recebida",
  "inspeccionada",
  "decidida",
  "fechada",
  "cancelada",
] as const;
export type EstadoDevolucao = (typeof ESTADOS_DEVOLUCAO)[number];
export const TIPOS_PROBLEMA = [
  "chegou_danificado",
  "em_falta",
  "atraso",
  "outro",
] as const;
export type TipoProblema = (typeof TIPOS_PROBLEMA)[number];
export const ESTADOS_REEMBOLSO = [
  "rascunho",
  "a_executar",
  // Pelo prestador (0061; docs/30 §13): durante a chamada, e aceite à
  // espera da confirmação.
  "a_pedir",
  "a_confirmar",
  "executado",
  "falhado",
  "incerto",
  "cancelado",
] as const;
export type EstadoReembolso = (typeof ESTADOS_REEMBOLSO)[number];

export interface TabelaPedidoLivreResolucao {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  encomenda_id: ColumnType<string, string, never>;
  origem: ColumnType<"botao" | "apoio", "botao" | "apoio", never>;
  contacto: ColumnType<string, string, never>;
  recebido_em: ColumnType<Date, never, never>;
  prazo_ate: ColumnType<string | null, string | null, never>;
  dentro_do_prazo: ColumnType<boolean, boolean, never>;
  estado: ColumnType<
    "aceite" | "fora_de_prazo" | "pendente" | "recusado",
    "aceite" | "fora_de_prazo" | "pendente",
    "aceite" | "recusado"
  >;
  confirmacao: ColumnType<unknown, string, never>;
  decidido_por: ColumnType<string | null, never, string>;
  motivo_decisao: ColumnType<string | null, never, string | null>;
  versao: ColumnType<number, never, number>;
}

export interface TabelaLinhaLivreResolucao {
  pedido_id: ColumnType<string, string, never>;
  comerciante_id: ColumnType<string, string, never>;
  linha_encomenda_id: ColumnType<string, string, never>;
  quantidade: ColumnType<number, number, never>;
}

export interface TabelaDevolucao {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  encomenda_id: ColumnType<string, string, never>;
  armazem_id: ColumnType<string, string, never>;
  origem: ColumnType<
    "livre_resolucao" | "apoio" | "comercial",
    "livre_resolucao" | "apoio" | "comercial",
    never
  >;
  pedido_livre_resolucao_id: ColumnType<string | null, string | null, never>;
  motivo: ColumnType<string | null, string | null, never>;
  transportadora: ColumnType<string | null, string | null, string | null>;
  seguimento: ColumnType<string | null, string | null, string | null>;
  estado: ColumnType<EstadoDevolucao, never, EstadoDevolucao>;
  criada_por: ColumnType<string, string, never>;
  criada_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, number>;
  // Os avisos do prazo do reembolso, cada um uma vez (0063; docs/30 §14).
  aviso_prazo_em: ColumnType<Date | null, never, Date>;
  prazo_passado_em: ColumnType<Date | null, never, Date>;
}

export const DECISOES_HIGIENE = ["reembolsar", "excepcao_higiene"] as const;
export type DecisaoHigiene = (typeof DECISOES_HIGIENE)[number];

export interface TabelaLinhaDevolucao {
  devolucao_id: ColumnType<string, string, never>;
  comerciante_id: ColumnType<string, string, never>;
  linha_encomenda_id: ColumnType<string, string, never>;
  pedida: ColumnType<number, number, never>;
  recebida: ColumnType<number | null, never, number>;
  aceite: ColumnType<number | null, never, number>;
  estado_artigo: ColumnType<
    EstadoArtigoDevolvido | null,
    never,
    EstadoArtigoDevolvido
  >;
  /** H6 (docs/30 §15): só numa linha selada que voltou aberta. */
  decisao_higiene: ColumnType<DecisaoHigiene | null, never, DecisaoHigiene>;
}

export interface TabelaProblema {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  encomenda_id: ColumnType<string, string, never>;
  tipo: ColumnType<TipoProblema, TipoProblema, never>;
  descricao: ColumnType<string, string, never>;
  estado: ColumnType<
    "aberto" | "decidido" | "fechado",
    never,
    "aberto" | "decidido" | "fechado"
  >;
  criado_por: ColumnType<string, string, never>;
  criado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, number>;
}

export interface TabelaReembolso {
  id: Generated<string>;
  comerciante_id: ColumnType<string, string, never>;
  encomenda_id: ColumnType<string, string, never>;
  pagamento_id: ColumnType<string, string, never>;
  origem: ColumnType<
    "devolucao" | "problema" | "cancelamento",
    "devolucao" | "problema" | "cancelamento",
    never
  >;
  devolucao_id: ColumnType<string | null, string | null, never>;
  problema_id: ColumnType<string | null, string | null, never>;
  montante: ColumnType<string, number, never>;
  moeda: ColumnType<string, string, never>;
  via: ColumnType<
    "manual" | "prestador",
    "manual" | "prestador",
    "manual" | "prestador"
  >;
  estado: ColumnType<EstadoReembolso, never, EstadoReembolso>;
  prova: ColumnType<unknown, never, string>;
  executado_em: ColumnType<Date | null, never, Date>;
  decidido_por: ColumnType<string, string, never>;
  criado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, number>;
  // O pedido ao prestador (0061; docs/30 §13, P4 a P6).
  pedido_em: ColumnType<Date | null, never, Date>;
  pedido_por: ColumnType<string | null, never, string>;
  referencia_prestador: ColumnType<string | null, never, string>;
  falha: ColumnType<string | null, never, string>;
  consultado_em: ColumnType<Date | null, never, Date>;
  /** Desde quando está incerto ou falhado nesta passagem (0066; docs/33 §4.1). */
  na_fila_desde: ColumnType<Date | null, never, never>;
}

export interface TabelaLinhaReembolso {
  reembolso_id: ColumnType<string, string, never>;
  comerciante_id: ColumnType<string, string, never>;
  posicao: ColumnType<number, number, never>;
  linha_encomenda_id: ColumnType<string | null, string | null, never>;
  quantidade: ColumnType<number, number, never>;
  montante: ColumnType<string, number, never>;
}

// As tarefas das filas que pedem uma pessoa (migração 0066; docs/33; decisão
// DW). A API só lê: escrevem as funções do dono (`tarefas_atribuir`,
// `tarefas_mudar_prazo`, `tarefas_marcar_vencida`).

export const FILAS_TAREFAS = [
  "pagamento",
  "documento_fiscal",
  "duplicado_cliente",
  "prazo_reembolso",
  "livre_resolucao",
  "problema",
  "reembolso",
] as const;
export type FilaTarefa = (typeof FILAS_TAREFAS)[number];

export const ACTOS_ATRIBUICAO = [
  "atribuida",
  "retirada",
  "prazo_mudado",
  "vencida",
] as const;
export type ActoAtribuicao = (typeof ACTOS_ATRIBUICAO)[number];

/** Quem decide e até quando, numa passagem de um caso pela fila (docs/33 §4.2). */
export interface TabelaAtribuicao {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, never, never>;
  fila: ColumnType<FilaTarefa, never, never>;
  caso: ColumnType<string, never, never>;
  entrou_em: ColumnType<Date, never, never>;
  responsavel: ColumnType<string | null, never, never>;
  prazo: ColumnType<Date | null, never, never>;
  aviso_vencido_em: ColumnType<Date | null, never, never>;
  versao: ColumnType<number, never, never>;
  criada_em: ColumnType<Date, never, never>;
  actualizada_em: ColumnType<Date, never, never>;
}

/** O rasto da atribuição: só se acrescenta (0066). */
export interface TabelaAtribuicaoRasto {
  id: ColumnType<string, never, never>;
  comerciante_id: ColumnType<string, never, never>;
  atribuicao_id: ColumnType<string, never, never>;
  acto: ColumnType<ActoAtribuicao, never, never>;
  responsavel_antes: ColumnType<string | null, never, never>;
  responsavel_depois: ColumnType<string | null, never, never>;
  prazo_antes: ColumnType<Date | null, never, never>;
  prazo_depois: ColumnType<Date | null, never, never>;
  motivo: ColumnType<string | null, never, never>;
  quem: ColumnType<string, never, never>;
  em: ColumnType<Date, never, never>;
  canal: ColumnType<string | null, never, never>;
  pedido: ColumnType<string | null, never, never>;
  ia: ColumnType<unknown, never, never>;
  autorizado_por: ColumnType<string | null, never, never>;
  a_pedido_de: ColumnType<unknown, never, never>;
}
