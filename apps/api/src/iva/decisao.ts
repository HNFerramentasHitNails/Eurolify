// A decisão de IVA de uma linha (docs/24 §5; a ordem do Bruno, skill
// eu-vat-oss-ioss, «A ordem da decisão»). Uma função pura: recebe tudo o que
// precisa (as tabelas, o comerciante, a linha, a encomenda e o momento) e não
// lê relógios, a base nem a rede. É a única sítio onde a regra vive (R1): o
// checkout, o Hub, as IAs e o documento usam-na, nunca a refazem.
//
// Na dúvida, não vende (`bloqueada`, com o motivo): nunca uma taxa à sorte
// (eu-vat-oss-ioss, «Regra zero»).

/** A versão do conjunto de regras (sobe a cada mudança desta função). */
export const VERSAO_REGRAS = "2026-10-09.1";

/**
 * Há quanto tempo pode ter sido a última resposta «válido» do VIES para
 * isentar uma venda (docs/24 §5.2, ramo 2b). **C** — é a V5, para o
 * contabilista; até lá, 72 h (a revalidação é de noite, a cada 24 h).
 */
export const VIES_IDADE_MAXIMA_MS = 72 * 60 * 60 * 1000;

/** Os países da UE (o código ISO; a Grécia é GR). */
export const PAISES_UE: ReadonlySet<string> = new Set([
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
]);

export const NATUREZAS_IVA = [
  "bem",
  "servico_presencial",
  "acesso_evento_presencial",
  "servico_a_distancia",
  "servico_electronico",
  "vale",
] as const;
export type NaturezaIva = (typeof NATUREZAS_IVA)[number];

export type Finalidade = "consumo" | "profissional" | "revenda";

export interface Taxa {
  id: string;
  pais: string;
  regiao: string | null;
  categoria: string;
  tipo: "taxa" | "isenta";
  /** Centésimas de ponto: 2300 = 23 %. */
  percentagem: number | null;
  codigo_motivo: string | null;
  /** AAAA-MM-DD. */
  inicio: string;
  fonte: string;
  verificado: boolean;
}

export interface Territorio {
  pais: string;
  prefixo_cp: string;
  efeito: "fora_do_iva_ue" | "regiao" | "por_validar";
  regiao: string | null;
  nome: string;
}

export interface Motivo {
  pais: string;
  codigo: string;
  tipo: "exportacao" | "intracomunitaria" | "isento_natureza" | "outro";
}

export interface Tabelas {
  categorias: readonly { codigo: string; estado: string }[];
  taxas: readonly Taxa[];
  territorios: readonly Territorio[];
  motivos: readonly Motivo[];
}

export interface EntradaDecisao {
  momento: Date;
  comerciante: {
    /** O país da entidade legal que vende. */
    pais: string;
    regime: "origem" | "destino" | "por_declarar";
  };
  linha: {
    categoria: string;
    natureza: NaturezaIva;
    /** O país do lugar da prestação, nos serviços e eventos. */
    local_prestacao: string | null;
    /** Em cêntimos. */
    montante: number;
    preco_inclui_iva: boolean;
  };
  /** A morada de entrega (nos bens). */
  entrega: { pais: string; codigo_postal: string | null } | null;
  finalidade: Finalidade;
  perfil: {
    pais: string | null;
    numero: string | null;
    estado_vies: string;
    /** A data da última resposta definitiva do VIES ao NIF actual. */
    validado_em: Date | null;
    /** A prova usada (`vvc_…` sem prefixo). */
    prova_vies: string | null;
    isencao: {
      id: string;
      codigo_motivo: string | null;
      pais: string | null;
      numero: string | null;
    } | null;
  } | null;
}

export const MOTIVOS_DE_BLOQUEIO = [
  "categoria_por_validar",
  "natureza_bloqueada",
  "entrega_em_falta",
  "territorio_por_validar",
  "servico_fora_do_pais",
  "regime_por_declarar",
  "taxa_em_falta",
  "motivo_em_falta",
  "isencao_sem_codigo",
] as const;
export type MotivoDeBloqueio = (typeof MOTIVOS_DE_BLOQUEIO)[number];

export type Regra =
  | "isento_natureza"
  | "isencao_manual"
  | "vies_intracomunitaria"
  | "exportacao"
  | "nacional"
  | "distancia_destino"
  | "distancia_origem"
  | "b2b_sem_vies_origem"
  | "servico_no_lugar"
  | "bloqueio";

export interface Evidencia {
  momento: string;
  pais_comerciante: string;
  regime: string;
  categoria: string;
  natureza: NaturezaIva;
  finalidade: Finalidade;
  entrega: { pais: string; codigo_postal: string | null } | null;
  territorio: string | null;
  local_prestacao: string | null;
  perfil: { pais: string | null; numero: string | null } | null;
  vies: {
    estado: string;
    validado_em: string | null;
    prova: string | null;
  } | null;
  isencao: string | null;
  taxa: { id: string; fonte: string; verificado: boolean } | null;
  /** Falso quando entra uma taxa, um motivo ou um território por validar (R8). */
  verificado: boolean;
}

export type Decisao =
  | {
      resultado: "tributada" | "isenta";
      pais_imposto: string;
      regiao: string | null;
      /** Centésimas de ponto (0 numa isenta). */
      taxa: number;
      codigo_motivo: string | null;
      base: number;
      iva: number;
      total: number;
      regra: Regra;
      versao_regras: string;
      evidencia: Evidencia;
    }
  | {
      resultado: "bloqueada";
      motivo: MotivoDeBloqueio;
      regra: "bloqueio";
      versao_regras: string;
      evidencia: Evidencia;
    };

/** A divisão arredondada ao inteiro, metade para cima (positivos). */
export function dividirArredondado(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

/** O código postal sem espaços nem hífenes, em maiúsculas. */
export const codigoPostalLimpo = (cp: string) =>
  cp.replace(/[\s-]/g, "").toUpperCase();

/** O território da entrega: o prefixo mais comprido do país. */
export function territorioDe(
  tabelas: Tabelas,
  pais: string,
  codigoPostal: string | null,
): Territorio | null {
  if (codigoPostal === null) return null;
  const cp = codigoPostalLimpo(codigoPostal);
  let melhor: Territorio | null = null;
  for (const t of tabelas.territorios) {
    if (t.pais !== pais || !cp.startsWith(t.prefixo_cp)) continue;
    if (melhor === null || t.prefixo_cp.length > melhor.prefixo_cp.length) {
      melhor = t;
    }
  }
  return melhor;
}

/** A taxa em vigor no momento (a de início mais recente até ao dia). */
export function taxaEmVigor(
  tabelas: Tabelas,
  pais: string,
  regiao: string | null,
  categoria: string,
  momento: Date,
): Taxa | null {
  const dia = momento.toISOString().slice(0, 10);
  let melhor: Taxa | null = null;
  for (const t of tabelas.taxas) {
    if (t.pais !== pais || t.regiao !== regiao || t.categoria !== categoria) {
      continue;
    }
    if (t.inicio > dia) continue;
    if (melhor === null || t.inicio > melhor.inicio) melhor = t;
  }
  return melhor;
}

const motivoDo = (tabelas: Tabelas, pais: string, tipo: Motivo["tipo"]) =>
  tabelas.motivos.find((m) => m.pais === pais && m.tipo === tipo) ?? null;

export function decidirIva(tabelas: Tabelas, e: EntradaDecisao): Decisao {
  const territorio =
    e.entrega === null
      ? null
      : territorioDe(tabelas, e.entrega.pais, e.entrega.codigo_postal);
  const evidencia: Evidencia = {
    momento: e.momento.toISOString(),
    pais_comerciante: e.comerciante.pais,
    regime: e.comerciante.regime,
    categoria: e.linha.categoria,
    natureza: e.linha.natureza,
    finalidade: e.finalidade,
    entrega: e.entrega,
    territorio: territorio?.nome ?? null,
    local_prestacao: e.linha.local_prestacao,
    perfil:
      e.perfil === null
        ? null
        : { pais: e.perfil.pais, numero: e.perfil.numero },
    vies:
      e.perfil === null
        ? null
        : {
            estado: e.perfil.estado_vies,
            validado_em: e.perfil.validado_em?.toISOString() ?? null,
            prova: e.perfil.prova_vies,
          },
    isencao: null,
    taxa: null,
    // Fica falso quando entra uma taxa ou um motivo por validar (R8).
    verificado: true,
  };

  const bloqueia = (motivo: MotivoDeBloqueio): Decisao => ({
    resultado: "bloqueada",
    motivo,
    regra: "bloqueio",
    versao_regras: VERSAO_REGRAS,
    evidencia: { ...evidencia, verificado: false },
  });

  // 0. O que não se decide: na dúvida, não vende.
  const categoria = tabelas.categorias.find(
    (c) => c.codigo === e.linha.categoria,
  );
  if (categoria?.estado !== "activa") return bloqueia("categoria_por_validar");
  const natureza = e.linha.natureza;
  if (
    natureza === "servico_a_distancia" ||
    natureza === "servico_electronico" ||
    natureza === "vale"
  ) {
    return bloqueia("natureza_bloqueada");
  }

  /** Tributa à taxa (pais, regiao); com IVA ou sem IVA, como o mercado. */
  const tributa = (
    pais: string,
    regiao: string | null,
    regra: Regra,
  ): Decisao => {
    const taxa = taxaEmVigor(
      tabelas,
      pais,
      regiao,
      e.linha.categoria,
      e.momento,
    );
    if (taxa === null) return bloqueia("taxa_em_falta");
    if (taxa.tipo === "isenta") {
      if (taxa.codigo_motivo === null) return bloqueia("motivo_em_falta");
      return isenta(taxa.codigo_motivo, "isento_natureza", taxa, pais, regiao);
    }
    const t = taxa.percentagem ?? 0;
    let base: number;
    let iva: number;
    if (e.linha.preco_inclui_iva) {
      base = dividirArredondado(e.linha.montante * 10000, 10000 + t);
      iva = e.linha.montante - base;
    } else {
      base = e.linha.montante;
      iva = dividirArredondado(base * t, 10000);
    }
    return {
      resultado: "tributada",
      pais_imposto: pais,
      regiao,
      taxa: t,
      codigo_motivo: null,
      base,
      iva,
      total: base + iva,
      regra,
      versao_regras: VERSAO_REGRAS,
      evidencia: {
        ...evidencia,
        taxa: { id: taxa.id, fonte: taxa.fonte, verificado: taxa.verificado },
        verificado: evidencia.verificado && taxa.verificado,
      },
    };
  };

  /**
   * Isenta. Num preço com IVA, o cliente paga sem o IVA do país do
   * comerciante (docs/24 §10, Q1): é preciso a taxa de origem.
   */
  const isenta = (
    codigo: string,
    regra: Regra,
    taxaUsada: Taxa | null,
    pais: string,
    regiao: string | null,
  ): Decisao => {
    let base = e.linha.montante;
    let taxaOrigem: Taxa | null = taxaUsada;
    if (e.linha.preco_inclui_iva) {
      taxaOrigem = taxaEmVigor(
        tabelas,
        e.comerciante.pais,
        null,
        e.linha.categoria,
        e.momento,
      );
      if (taxaOrigem === null) return bloqueia("taxa_em_falta");
      // Isento por natureza na origem: o preço não leva IVA nenhum.
      if (taxaOrigem.tipo === "taxa") {
        base = dividirArredondado(
          e.linha.montante * 10000,
          10000 + (taxaOrigem.percentagem ?? 0),
        );
      }
    }
    return {
      resultado: "isenta",
      pais_imposto: pais,
      regiao,
      taxa: 0,
      codigo_motivo: codigo,
      base,
      iva: 0,
      total: base,
      regra,
      versao_regras: VERSAO_REGRAS,
      evidencia: {
        ...evidencia,
        taxa:
          taxaOrigem === null
            ? null
            : {
                id: taxaOrigem.id,
                fonte: taxaOrigem.fonte,
                verificado: taxaOrigem.verificado,
              },
        // Os códigos de motivo ainda são todos C (docs/24 §3.6).
        verificado: false,
      },
    };
  };

  // 1. Isento por natureza (no país do comerciante).
  const natural = taxaEmVigor(
    tabelas,
    e.comerciante.pais,
    null,
    e.linha.categoria,
    e.momento,
  );
  if (natural?.tipo === "isenta") {
    if (natural.codigo_motivo === null) return bloqueia("motivo_em_falta");
    return isenta(
      natural.codigo_motivo,
      "isento_natureza",
      natural,
      e.comerciante.pais,
      null,
    );
  }

  // 2a. A isenção manual: vale sempre, também com entrega no país do
  // comerciante (a #D4248), se for do NIF do perfil (R3).
  const isencao = e.perfil?.isencao ?? null;
  if (
    isencao !== null &&
    isencao.pais === e.perfil?.pais &&
    isencao.numero === e.perfil.numero
  ) {
    evidencia.isencao = isencao.id;
    if (isencao.codigo_motivo === null) return bloqueia("isencao_sem_codigo");
    return isenta(
      isencao.codigo_motivo,
      "isencao_manual",
      null,
      e.comerciante.pais,
      null,
    );
  }

  // Serviços e eventos presenciais: o lugar da prestação; na Fase 1 só no
  // país do comerciante (Q5).
  if (natureza !== "bem") {
    if (e.linha.local_prestacao !== e.comerciante.pais) {
      return bloqueia("servico_fora_do_pais");
    }
    return tributa(e.comerciante.pais, null, "servico_no_lugar");
  }

  // Bens: a entrega decide.
  if (e.entrega === null) return bloqueia("entrega_em_falta");
  if (territorio?.efeito === "por_validar") {
    return bloqueia("territorio_por_validar");
  }
  const foraDaUe =
    !PAISES_UE.has(e.entrega.pais) || territorio?.efeito === "fora_do_iva_ue";
  const regiao = territorio?.efeito === "regiao" ? territorio.regiao : null;
  const noPaisDoComerciante =
    !foraDaUe && e.entrega.pais === e.comerciante.pais;

  // 4. A entrega no país do comerciante anula o VIES e a exportação.
  if (noPaisDoComerciante) {
    return tributa(e.comerciante.pais, regiao, "nacional");
  }

  // 2c. Exportação (país terceiro ou território fora do IVA da UE).
  if (foraDaUe) {
    const m = motivoDo(tabelas, e.comerciante.pais, "exportacao");
    if (m === null) return bloqueia("motivo_em_falta");
    return isenta(m.codigo, "exportacao", null, e.comerciante.pais, null);
  }

  // 2b. VIES: empresa de outro país da UE, válida há pouco tempo, que declarou
  // comprar como profissional (ter NIF não basta, docs/23 R1).
  const perfil = e.perfil;
  const viesValido =
    perfil !== null &&
    e.finalidade !== "consumo" &&
    perfil.estado_vies === "valido" &&
    perfil.validado_em !== null &&
    e.momento.getTime() - perfil.validado_em.getTime() <=
      VIES_IDADE_MAXIMA_MS &&
    perfil.pais !== null &&
    PAISES_UE.has(perfil.pais) &&
    perfil.pais !== e.comerciante.pais;
  if (viesValido) {
    const m = motivoDo(tabelas, e.comerciante.pais, "intracomunitaria");
    if (m === null) return bloqueia("motivo_em_falta");
    return isenta(
      m.codigo,
      "vies_intracomunitaria",
      null,
      e.comerciante.pais,
      null,
    );
  }

  // 3. Paga IVA. Uma empresa sem VIES válido: à taxa do país do comerciante
  // (C). Um consumidor: pelo regime declarado.
  if (e.finalidade !== "consumo") {
    return tributa(e.comerciante.pais, null, "b2b_sem_vies_origem");
  }
  if (e.comerciante.regime === "por_declarar") {
    return bloqueia("regime_por_declarar");
  }
  if (e.comerciante.regime === "origem") {
    return tributa(e.comerciante.pais, null, "distancia_origem");
  }
  return tributa(e.entrega.pais, regiao, "distancia_destino");
}
