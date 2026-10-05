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

export interface TabelaComerciante {
  id: string;
  estado: ColumnType<EstadoComerciante, EstadoComerciante | undefined>;
  estado_antes_de_suspenso: ColumnType<EstadoComerciante | null, never, never>;
  nome: string;
  lingua: string;
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
  criado_em: Instante;
}

export interface TabelaLoja {
  id: Generated<string>;
  comerciante_id: string;
  entidade_legal_id: string;
  nome: string;
  lingua_origem: string;
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

export interface TabelaTransicaoEstado {
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

export const ESTADOS_VARIANTE = ["activa", "arquivada"] as const;
export type EstadoVariante = (typeof ESTADOS_VARIANTE)[number];

export interface TabelaArtigo {
  id: Generated<string>;
  comerciante_id: string;
  tipo: TipoArtigo;
  estado: ColumnType<EstadoArtigo, EstadoArtigo | undefined>;
  nome: string;
  descricao: string | null;
  marca: string | null;
  categoria_fiscal: string | null;
  origem: ColumnType<
    "eurolify" | "externo",
    "eurolify" | "externo" | undefined
  >;
  origem_ref: string | null;
  ja_esteve_activo: ColumnType<boolean, never, never>;
  criado_em: ColumnType<Date, never, never>;
  actualizado_em: ColumnType<Date, never, never>;
  versao: ColumnType<number, never, never>;
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
}
