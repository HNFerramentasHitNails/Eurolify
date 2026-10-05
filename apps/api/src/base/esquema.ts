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
  origem: ColumnType<
    "eurolify" | "externo",
    "eurolify" | "externo" | undefined
  >;
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
}
