// Motor de regras por país (docs/eurolify/architecture.md §4). Só tipos: os
// dados estão em registo.ts e a decisão em decidir.ts.

/** Os 27 Estados-membros, por código ISO 3166-1 (a Grécia é GR, não EL). */
export const CODIGOS_UE = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;

export type CodigoPais = (typeof CODIGOS_UE)[number];

/** Domínios que todo o país tem de ter revistos antes de uma venda. */
export const DOMINIOS_OBRIGATORIOS = [
  "consumidor",
  "iva",
  "faturacao",
  "privacidade_marketing",
  "produto_ambiente",
  "acessibilidade_plataforma",
  "pagamentos",
] as const;

/** Domínios que só contam quando a actividade os pede (canais, franchising…). */
export const DOMINIOS_CONDICIONAIS = [
  "distribuicao_concorrencia",
  "contratos_franchising",
  "agencia_comercial",
  "termos_plataforma_empresas",
] as const;

export type Dominio =
  | (typeof DOMINIOS_OBRIGATORIOS)[number]
  | (typeof DOMINIOS_CONDICIONAIS)[number];

/**
 * Estado da revisão de um domínio num país. «não aplicável» só existe com
 * justificação e prova: não é um atalho para «não sei».
 */
export type RevisaoDominio =
  | { estado: "por_verificar" }
  | { estado: "verificado"; verificadoEm: string; revistoPor: string }
  | {
      estado: "nao_aplicavel";
      justificacao: string;
      prova: string;
      revistoPor: string;
    };

export interface PerfilPais {
  codigo: CodigoPais;
  nome: string;
  dominios: Record<Dominio, RevisaoDominio>;
  /** null = territórios não mapeados: um território pedido não herda nada. */
  territorios: readonly string[] | null;
}

/**
 * Os estados legais de uma regra, num sítio só (revisão do #47, 2.ª, P2-B):
 * o tipo deriva desta lista, e o decidir e o validar lêem-na daqui.
 */
export const ESTADOS_LEGAIS = [
  "em_vigor",
  "adoptada_futura",
  "proposta",
  "revogada",
] as const;

export type EstadoLegal = (typeof ESTADOS_LEGAIS)[number];

export interface Regra {
  /**
   * Única em todo o registo: uma `id` identifica uma regra de um país e de um
   * domínio, nas suas várias versões. `regrasAplicadas` cita `id@versao`.
   */
  id: string;
  versao: number;
  dominio: Dominio;
  pais: CodigoPais;
  /** Vazio = vale para o país sem território especial. */
  territorios: readonly string[];
  estadoLegal: EstadoLegal;
  /**
   * Instantes ISO 8601 com fuso (instante.ts): `AAAA-MM-DDThh:mm:ss(.sss)?`
   * seguido de `Z` ou `±hh:mm`; a fracção tem no máximo 3 dígitos. Intervalo
   * meio-aberto: vale de `aplicaDesde` (incluído) até `aplicaAte` (excluído).
   */
  aplicaDesde: string;
  aplicaAte: string | null;
  base: { url: string; titulo: string; artigo: string };
  verificadaEm: string;
  revistaPor: string;
}

export interface Registo {
  versao: number;
  paises: readonly PerfilPais[];
  regras: readonly Regra[];
}

export interface PedidoDecisao {
  /** Vem de fora: pode não ser um dos 27. */
  pais: string;
  territorio?: string;
  /** Pelo menos um: uma lista vazia não pode sair «permitido». */
  dominios: readonly [Dominio, ...Dominio[]];
  /** Instante ISO 8601 com fuso (instante.ts). */
  momento: string;
}

export type Motivo =
  | { codigo: "codigo_pais_invalido"; pais: string }
  | { codigo: "pais_fora_da_ue"; pais: string }
  | { codigo: "momento_invalido"; momento: string }
  | { codigo: "sem_dominios" }
  | { codigo: "dominio_desconhecido"; dominio: string }
  | { codigo: "territorio_nao_mapeado"; territorio: string }
  | { codigo: "dominio_por_verificar"; dominio: Dominio }
  | { codigo: "sem_regra_em_vigor"; dominio: Dominio }
  | { codigo: "sem_regra_aplicada" };

export interface Decisao {
  estado: "permitido" | "revisao_necessaria" | "recusado";
  regrasAplicadas: readonly string[];
  versaoRegisto: number;
  motivos: readonly Motivo[];
}
