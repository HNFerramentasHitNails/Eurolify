import {
  CODIGOS_UE,
  DOMINIOS_CONDICIONAIS,
  DOMINIOS_OBRIGATORIOS,
  type CodigoPais,
  type Dominio,
  type PerfilPais,
  type Registo,
  type RevisaoDominio,
} from "./tipos.js";

// Nomes dos 27 em português. Nenhuma taxa, prazo ou transposição: cada regra
// entra com fonte oficial lida, data e revisor (docs/eurolify/compliance-gaps.md).
const NOMES: Record<CodigoPais, string> = {
  AT: "Áustria",
  BE: "Bélgica",
  BG: "Bulgária",
  HR: "Croácia",
  CY: "Chipre",
  CZ: "Chéquia",
  DK: "Dinamarca",
  EE: "Estónia",
  FI: "Finlândia",
  FR: "França",
  DE: "Alemanha",
  GR: "Grécia",
  HU: "Hungria",
  IE: "Irlanda",
  IT: "Itália",
  LV: "Letónia",
  LT: "Lituânia",
  LU: "Luxemburgo",
  MT: "Malta",
  NL: "Países Baixos",
  PL: "Polónia",
  PT: "Portugal",
  RO: "Roménia",
  SK: "Eslováquia",
  SI: "Eslovénia",
  ES: "Espanha",
  SE: "Suécia",
};

function todosPorVerificar(): Record<Dominio, RevisaoDominio> {
  const dominios = {} as Record<Dominio, RevisaoDominio>;
  for (const dominio of [...DOMINIOS_OBRIGATORIOS, ...DOMINIOS_CONDICIONAIS]) {
    dominios[dominio] = { estado: "por_verificar" };
  }
  return dominios;
}

/** Congela em profundidade: o `readonly` é só do compilador (revisão do #37, P2-4). */
function congelar<T>(valor: T): T {
  if (typeof valor === "object" && valor !== null && !Object.isFrozen(valor)) {
    for (const filho of Object.values(valor)) congelar(filho);
    Object.freeze(valor);
  }
  return valor;
}

/**
 * O registo de partida (versão 1, 04/10/2026): os 27 países, todos os
 * domínios por verificar, nenhum território mapeado, nenhuma regra. Com ele,
 * nenhuma decisão sai «permitido» — é o comportamento certo enquanto nada
 * estiver verificado. Congelado: mudar o registo é uma versão nova.
 */
export const REGISTO_INICIAL: Registo = congelar({
  versao: 1,
  paises: CODIGOS_UE.map((codigo): PerfilPais => ({
    codigo,
    nome: NOMES[codigo],
    dominios: todosPorVerificar(),
    territorios: null,
  })),
  regras: [],
});
