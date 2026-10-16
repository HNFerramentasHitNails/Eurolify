import type { EstadoEncomenda, TransicaoDaEncomenda } from "./api";
import type { Textos } from "./textos";

// Apoio dos ecrãs das encomendas (docs/22 §35; issue #475). O Hub só mostra
// o que a API decide: o estado, os totais, a decisão de IVA de cada linha.
// Aqui só se escolhe o texto, se lê com cuidado o que a API copiou na
// encomenda (JSON livre) e se formata. Nada se calcula.

/** Pela ordem do ciclo de vida; o filtro da lista usa esta ordem. */
export const ESTADOS_ENCOMENDA: readonly EstadoEncomenda[] = [
  "a_aguardar_pagamento",
  "paga",
  "em_preparacao",
  "expedida_parcial",
  "expedida",
  "entregue",
  "concluida",
  "cancelada_sem_pagamento",
  "cancelada",
  "devolvida_parcial",
  "devolvida",
];

export const TEXTO_DO_ESTADO: Record<EstadoEncomenda, keyof Textos> = {
  a_aguardar_pagamento: "encomendaEstado_a_aguardar_pagamento",
  paga: "encomendaEstado_paga",
  cancelada_sem_pagamento: "encomendaEstado_cancelada_sem_pagamento",
  em_preparacao: "encomendaEstado_em_preparacao",
  expedida_parcial: "encomendaEstado_expedida_parcial",
  expedida: "encomendaEstado_expedida",
  entregue: "encomendaEstado_entregue",
  concluida: "encomendaEstado_concluida",
  cancelada: "encomendaEstado_cancelada",
  devolvida_parcial: "encomendaEstado_devolvida_parcial",
  devolvida: "encomendaEstado_devolvida",
};

/** O texto de um estado; um estado que o Hub não conhece sai como a API o deu. */
export function textoDoEstado(t: Textos, estado: string): string {
  const chave = (TEXTO_DO_ESTADO as Record<string, keyof Textos>)[estado];
  return chave === undefined ? estado : t[chave];
}

/** O filtro do endereço, ou null se não for um estado. */
export function estadoDoFiltro(valor: string | null): EstadoEncomenda | null {
  return ESTADOS_ENCOMENDA.find((e) => e === valor) ?? null;
}

/** O endereço da lista, sempre com o comerciante. */
export function enderecoEncomendas(
  comerciante: string,
  estado: EstadoEncomenda | null = null,
): string {
  const q = new URLSearchParams({ comerciante });
  if (estado !== null) q.set("estado", estado);
  return `/encomendas?${q.toString()}`;
}

/** O endereço da ficha de uma encomenda. */
export function enderecoEncomenda(
  comerciante: string,
  encomenda: string,
): string {
  return `/encomendas/${encomenda}?${new URLSearchParams({ comerciante }).toString()}`;
}

/** O fim do identificador, para distinguir as encomendas à vista. */
export const idCurto = (id: string) => id.slice(-8);

/**
 * A frase da contagem: vazia (com ou sem filtro), uma, várias, ou as mais
 * recentes quando chegou ao limite da API (nunca corta em silêncio).
 */
export function contagemDaLista(
  n: number,
  limite: number,
  comFiltro: boolean,
): keyof Textos {
  if (n === 0) return comFiltro ? "encomendasVazioNoFiltro" : "encomendasVazio";
  if (n >= limite) return "encomendasContagemMaximo";
  return n === 1 ? "encomendasContagemUm" : "encomendasContagem";
}

/** Um montante em cêntimos (a API guarda cêntimos, docs/22 §25.3). */
export function emCentimos(
  centimos: number,
  moeda: string,
  tag: string,
): string {
  const valor = centimos / 100;
  try {
    return new Intl.NumberFormat(tag, {
      style: "currency",
      currency: moeda,
    }).format(valor);
  } catch {
    // Uma moeda que o navegador não conhece: o número e o código.
    return `${valor.toFixed(2)} ${moeda}`.trim();
  }
}

const registo = (x: unknown): Record<string, unknown> | null =>
  typeof x === "object" && x !== null && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
const texto = (x: unknown): string | null =>
  typeof x === "string" && x.trim() !== "" ? x : null;

/** A decisão de IVA da linha, como o servidor a gravou (nunca recalculada). */
export type IvaDaLinha =
  | { tipo: "tributada"; taxa: number }
  | { tipo: "isenta" }
  | { tipo: "bloqueada" }
  | { tipo: "desconhecida" };

/**
 * Lê a decisão. A taxa vem em centésimas de ponto (2300 = 23 %), como a API
 * a grava (`apps/api/src/iva/decisao.ts`).
 */
export function ivaDaLinha(decisao: unknown): IvaDaLinha {
  const d = registo(decisao);
  if (d === null) return { tipo: "desconhecida" };
  if (d["resultado"] === "isenta") return { tipo: "isenta" };
  if (d["resultado"] === "bloqueada") return { tipo: "bloqueada" };
  const taxa = d["taxa"];
  if (
    d["resultado"] === "tributada" &&
    typeof taxa === "number" &&
    Number.isFinite(taxa)
  ) {
    return { tipo: "tributada", taxa };
  }
  return { tipo: "desconhecida" };
}

/** 2300 → «23», 600 → «6», 550 → «5,5». */
export function taxaEmTexto(taxa: number, tag: string): string {
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(
    taxa / 100,
  );
}

export interface MoradaLida {
  ponto: string | null;
  linhas: string[];
}

/** A morada de entrega copiada na encomenda; null se não vier nada legível. */
export function moradaDe(entrega: unknown): MoradaLida | null {
  const e = registo(entrega);
  if (e === null) return null;
  const ponto = registo(e["ponto"]);
  const linhas = [
    texto(e["linha1"]),
    texto(e["linha2"]),
    [texto(e["codigo_postal"]), texto(e["localidade"])]
      .filter((x) => x !== null)
      .join(" "),
    texto(e["pais"]),
  ].filter((x): x is string => x !== null && x !== "");
  if (linhas.length === 0 && ponto === null) return null;
  return { ponto: texto(ponto?.["nome"]), linhas };
}

export interface ContactoLido {
  nome: string | null;
  email: string | null;
  telefone: string | null;
}

export function contactoDe(contacto: unknown): ContactoLido | null {
  const c = registo(contacto);
  if (c === null) return null;
  const lido = {
    nome: texto(c["nome"]),
    email: texto(c["email"]),
    telefone: texto(c["telefone"]),
  };
  return lido.nome === null && lido.email === null && lido.telefone === null
    ? null
    : lido;
}

export interface PerfilLido {
  nome: string | null;
  nif: string | null;
}

/** O nome e o NIF da cópia do perfil de faturação; null se não vier. */
export function perfilDe(perfil: unknown): PerfilLido | null {
  const p = registo(perfil);
  if (p === null) return null;
  const lido = { nome: texto(p["nome_documento"]), nif: texto(p["nif"]) };
  return lido.nome === null && lido.nif === null ? null : lido;
}

/** O nome do método de entrega copiado, na língua pedida. */
export function nomeDoMetodo(metodo: unknown, lingua: string): string | null {
  const m = registo(metodo);
  if (m === null) return null;
  const n = m["nome"];
  if (typeof n === "string") return texto(n);
  const nomes = registo(n);
  if (nomes === null) return null;
  return (
    texto(nomes[lingua]) ?? texto(nomes["pt"]) ?? texto(Object.values(nomes)[0])
  );
}

/** A data-limite de entrega que o cliente viu (AAAA-MM-DD), se vier. */
export function dataLimiteDe(metodo: unknown): string | null {
  const d = registo(metodo)?.["data_limite"];
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** O total dos portes copiados na encomenda, em cêntimos, se vier. */
export function totalDosPortes(portes: unknown): number | null {
  const total = registo(portes)?.["total"];
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

/**
 * Quem fez a transição, em linguagem comum. Só o tipo e, numa pessoa, o
 * identificador para o nome; nunca o identificador técnico de uma chave.
 */
export type QuemFez =
  | { tipo: "pessoa"; pessoa: string | null }
  | { tipo: "chave" | "sistema" | "consumidor" | "prestador" | "operador" }
  | { tipo: "desconhecido" };

export function quemFez(t: TransicaoDaEncomenda): QuemFez {
  switch (t.tipo_de_autor) {
    case "pessoa": {
      const m = /^pessoa:per_(.+)$/.exec(t.quem);
      return { tipo: "pessoa", pessoa: m?.[1] ?? null };
    }
    case "agente":
    case "chave":
      return { tipo: "chave" };
    case "sistema":
    case "consumidor":
    case "prestador":
    case "operador":
      return { tipo: t.tipo_de_autor };
    default:
      return { tipo: "desconhecido" };
  }
}

export const TEXTO_DO_DOCUMENTO: Record<string, keyof Textos> = {
  a_verificar: "encomendaDocumento_a_verificar",
  retido: "encomendaDocumento_retido",
  pronto: "encomendaDocumento_pronto",
  rascunho: "encomendaDocumento_rascunho",
  emitido: "encomendaDocumento_emitido",
  incerto: "encomendaDocumento_incerto",
  divergente: "encomendaDocumento_divergente",
  resolvido: "encomendaDocumento_resolvido",
  fora: "encomendaDocumento_fora",
};

export const TEXTO_DO_EMISSOR: Record<string, keyof Textos> = {
  por_configurar: "encomendaEmissor_por_configurar",
  eurolify: "encomendaEmissor_eurolify",
  sistema_proprio: "encomendaEmissor_sistema_proprio",
};
