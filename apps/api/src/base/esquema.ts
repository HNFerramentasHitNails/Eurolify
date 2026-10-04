import type { ColumnType, Generated } from "kysely";

// Tipos das tabelas da migração 0001 (docs/15-dominio-comerciante.md §3). As
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
}

export interface TabelaTransicaoEstado {
  id: Generated<string>;
  comerciante_id: string;
  de: EstadoComerciante;
  para: EstadoComerciante;
  motivo: string;
  quem: string;
  quando: Instante;
  transacao: ColumnType<string, never, never>;
}

export interface BaseDados {
  comerciante: TabelaComerciante;
  entidade_legal: TabelaEntidadeLegal;
  loja: TabelaLoja;
  aceitacao_contrato: TabelaAceitacaoContrato;
  prova_verificacao: TabelaProvaVerificacao;
  transicao_estado: TabelaTransicaoEstado;
}
