// A decisão de IVA de uma linha (docs/24 §5; a ordem do Bruno, skill
// eu-vat-oss-ioss, «A ordem da decisão»). Uma função pura: recebe tudo o que
// precisa (as tabelas, o comerciante, a linha, a encomenda e o momento) e não
// lê relógios, a base nem a rede. É a única sítio onde a regra vive (R1): o
// checkout, o Hub, as IAs e o documento usam-na, nunca a refazem.
//
// Na dúvida, não vende (`bloqueada`, com o motivo): nunca uma taxa à sorte
// (eu-vat-oss-ioss, «Regra zero»).

/** A versão do conjunto de regras (sobe a cada mudança desta função). */
export const VERSAO_REGRAS = "2026-10-09.2";

/**
 * As regras já validadas pelo contabilista (R8). Vazio enquanto as perguntas
 * V3 a V11 estão em aberto: até lá nenhuma decisão sai «verificada», mesmo com
 * uma taxa verificada (revisão do #256, P2-1).
 */
export const REGRAS_VALIDADAS: ReadonlySet<Regra> = new Set<Regra>([]);

/**
 * O maior montante (em cêntimos) que as contas fazem sem perder precisão:
 * `dividirArredondado(montante × 10000, …)` dobra o numerador (revisão do
 * #256, P2-3). Uns 2 250 milhões de euros por linha.
 */
export const MONTANTE_MAXIMO = Math.floor(Number.MAX_SAFE_INTEGER / 40_000);

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

/**
 * Os códigos de país atribuídos da ISO 3166-1 alfa-2 (249). Um código fora
 * desta lista bloqueia: nunca se trata como «fora da UE» (revisão do #256,
 * P1-1). Os territórios com tratamento próprio estão em `territorio_fiscal`.
 */
export const PAISES_ISO: ReadonlySet<string> = new Set(
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE
BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD
CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM
DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF
GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU
ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN
KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME
MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA
NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM
PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI
SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK
TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI
VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/),
);

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
    /** O fuso do comerciante: o dia da taxa conta-se nele (P2-2, C). */
    fuso: string;
  };
  linha: {
    categoria: string;
    natureza: NaturezaIva;
    /** O país do lugar da prestação, nos serviços e eventos. */
    local_prestacao: string | null;
    /** Em cêntimos da `moeda`. */
    montante: number;
    /** ISO 4217; só fica na evidência (a decisão não converte). */
    moeda: string;
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
  "montante_invalido",
  "fuso_invalido",
  "pais_invalido",
  "codigo_postal_em_falta",
  "codigo_postal_invalido",
  "b2b_sem_vies",
  "servico_b2b_por_validar",
  "taxa_sem_percentagem",
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
  | "servico_no_lugar"
  | "bloqueio";

export interface Evidencia {
  momento: string;
  /** O dia, no fuso do comerciante, com que se escolheu a taxa. */
  dia: string;
  moeda: string;
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
    /** `vvc_…`. */
    prova: string | null;
  } | null;
  /** A isenção usada (`exm_…`). */
  isencao: string | null;
  /** Havia uma isenção, mas de outro NIF: não contou (R3). */
  isencao_ignorada: boolean;
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
  // Sem código postal, só conta a linha do país todo (prefixo vazio).
  const cp = codigoPostal === null ? "" : codigoPostalLimpo(codigoPostal);
  let melhor: Territorio | null = null;
  for (const t of tabelas.territorios) {
    if (t.pais !== pais || !cp.startsWith(t.prefixo_cp)) continue;
    if (melhor === null || t.prefixo_cp.length > melhor.prefixo_cp.length) {
      melhor = t;
    }
  }
  return melhor;
}

/**
 * O dia (AAAA-MM-DD) do momento no fuso dado; `null` se o fuso não existe.
 * Uma taxa nova às 0 h de Lisboa vale às 23 h 30 UTC da véspera (P2-2). C:
 * não verifiquei se a lei de cada país conta o dia no fuso do vendedor.
 */
export function diaNoFuso(momento: Date, fuso: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(momento);
  } catch {
    return null;
  }
}

/** A taxa em vigor no dia (a de início mais recente até ele). */
export function taxaEmVigor(
  tabelas: Tabelas,
  pais: string,
  regiao: string | null,
  categoria: string,
  dia: string,
): Taxa | null {
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

export function decidirIva(
  tabelas: Tabelas,
  e: EntradaDecisao,
  opcoes: { regrasValidadas: ReadonlySet<Regra> } = {
    regrasValidadas: REGRAS_VALIDADAS,
  },
): Decisao {
  const territorio =
    e.entrega === null
      ? null
      : territorioDe(tabelas, e.entrega.pais, e.entrega.codigo_postal);
  const dia = diaNoFuso(e.momento, e.comerciante.fuso);
  const isencaoDoPerfil = e.perfil?.isencao ?? null;
  const isencaoConta =
    isencaoDoPerfil !== null &&
    isencaoDoPerfil.pais === e.perfil?.pais &&
    isencaoDoPerfil.numero === e.perfil.numero;
  const evidencia: Evidencia = {
    momento: e.momento.toISOString(),
    dia: dia ?? "",
    moeda: e.linha.moeda,
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
            prova:
              e.perfil.prova_vies === null
                ? null
                : `vvc_${e.perfil.prova_vies}`,
          },
    isencao: null,
    isencao_ignorada: isencaoDoPerfil !== null && !isencaoConta,
    taxa: null,
    // Só verdadeiro com a regra validada e a taxa verificada (R8, P2-1).
    verificado: false,
  };

  const bloqueia = (motivo: MotivoDeBloqueio): Decisao => ({
    resultado: "bloqueada",
    motivo,
    regra: "bloqueio",
    versao_regras: VERSAO_REGRAS,
    evidencia: { ...evidencia, verificado: false },
  });

  // 0. O que não se decide: na dúvida, não vende.
  const m0 = e.linha.montante;
  if (!Number.isSafeInteger(m0) || m0 < 0 || m0 > MONTANTE_MAXIMO) {
    return bloqueia("montante_invalido");
  }
  if (dia === null) return bloqueia("fuso_invalido");
  if (!PAISES_UE.has(e.comerciante.pais)) return bloqueia("pais_invalido");
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
    const taxa = taxaEmVigor(tabelas, pais, regiao, e.linha.categoria, dia);
    if (taxa === null) return bloqueia("taxa_em_falta");
    if (taxa.tipo === "isenta") {
      if (taxa.codigo_motivo === null) return bloqueia("motivo_em_falta");
      return isenta(taxa.codigo_motivo, "isento_natureza", taxa, pais, regiao);
    }
    if (taxa.percentagem === null) return bloqueia("taxa_sem_percentagem");
    const t = taxa.percentagem;
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
        verificado: taxa.verificado && opcoes.regrasValidadas.has(regra),
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
        dia,
      );
      if (taxaOrigem === null) return bloqueia("taxa_em_falta");
      // Isento por natureza na origem: o preço não leva IVA nenhum.
      if (taxaOrigem.tipo === "taxa") {
        if (taxaOrigem.percentagem === null) {
          return bloqueia("taxa_sem_percentagem");
        }
        base = dividirArredondado(
          e.linha.montante * 10000,
          10000 + taxaOrigem.percentagem,
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
    dia,
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
  // comerciante (a #D4248) e num território por validar, se for do NIF do
  // perfil (R3). Quem a deu responde por ela, com o código e o motivo.
  if (isencaoConta) {
    evidencia.isencao = `exm_${isencaoDoPerfil.id}`;
    if (isencaoDoPerfil.codigo_motivo === null) {
      return bloqueia("isencao_sem_codigo");
    }
    return isenta(
      isencaoDoPerfil.codigo_motivo,
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
    // A uma empresa de outro país (ou sem perfil), o lugar de um serviço
    // presencial pode ser o do cliente (P2-4): por validar (C).
    if (
      natureza === "servico_presencial" &&
      e.finalidade !== "consumo" &&
      e.perfil?.pais !== e.comerciante.pais
    ) {
      return bloqueia("servico_b2b_por_validar");
    }
    return tributa(e.comerciante.pais, null, "servico_no_lugar");
  }

  // Bens: a entrega decide.
  if (e.entrega === null) return bloqueia("entrega_em_falta");
  if (!PAISES_ISO.has(e.entrega.pais)) return bloqueia("pais_invalido");
  // Um país com territórios especiais precisa do código postal (P1-2).
  const prefixos = tabelas.territorios
    .filter((t) => t.pais === e.entrega?.pais && t.prefixo_cp !== "")
    .map((t) => t.prefixo_cp);
  if (prefixos.length > 0) {
    const cp =
      e.entrega.codigo_postal === null
        ? ""
        : codigoPostalLimpo(e.entrega.codigo_postal);
    if (cp === "") return bloqueia("codigo_postal_em_falta");
    const soAlgarismos = prefixos.every((x) => /^[0-9]+$/.test(x));
    if (!/^[0-9A-Z]+$/.test(cp) || (soAlgarismos && !/^[0-9]+$/.test(cp))) {
      return bloqueia("codigo_postal_invalido");
    }
  }
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
    e.momento.getTime() >= perfil.validado_em.getTime() &&
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

  // 3. Uma empresa sem VIES válido noutro país da UE não compra como
  // empresa: bloqueia (P1-3). Pode comprar como consumidor, e paga IVA.
  if (e.finalidade !== "consumo") return bloqueia("b2b_sem_vies");
  // Um consumidor: pelo regime declarado.
  if (e.comerciante.regime === "por_declarar") {
    return bloqueia("regime_por_declarar");
  }
  if (e.comerciante.regime === "origem") {
    return tributa(e.comerciante.pais, null, "distancia_origem");
  }
  return tributa(e.entrega.pais, regiao, "distancia_destino");
}
