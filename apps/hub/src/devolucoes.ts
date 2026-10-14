import {
  ErroHub,
  type DevolucaoNaLista,
  type EstadoDevolucao,
  type EtiquetaDevolucao,
} from "./api";
import { ErroDoEcra } from "./erros";
import { TEXTO_DO_CODIGO } from "./expedir";
import type { Textos } from "./textos";

// As devoluções no Hub (docs/36 §22.10; Diogo, 14/10/2026: «sim, aprovo;
// avança com o código»): só leitura da devolução e a etiqueta de devolução.
// O que se pode fazer vem do estado que a API dá; a API decide sempre.

export const ESTADOS_DEVOLUCAO: readonly EstadoDevolucao[] = [
  "a_aguardar",
  "recebida",
  "inspeccionada",
  "decidida",
  "fechada",
  "cancelada",
];

export const TEXTO_DO_ESTADO_DA_DEVOLUCAO: Record<
  EstadoDevolucao,
  keyof Textos
> = {
  a_aguardar: "devolucaoEstadoAAguardar",
  recebida: "devolucaoEstadoRecebida",
  inspeccionada: "devolucaoEstadoInspeccionada",
  decidida: "devolucaoEstadoDecidida",
  fechada: "devolucaoEstadoFechada",
  cancelada: "devolucaoEstadoCancelada",
};

export const TEXTO_DA_ORIGEM: Record<DevolucaoNaLista["origem"], keyof Textos> =
  {
    livre_resolucao: "devolucaoOrigemLivreResolucao",
    apoio: "devolucaoOrigemApoio",
    comercial: "devolucaoOrigemComercial",
  };

/** O filtro do endereço, ou null se não for um estado. */
export function estadoDoFiltro(valor: string | null): EstadoDevolucao | null {
  return ESTADOS_DEVOLUCAO.find((e) => e === valor) ?? null;
}

/** Igual ao da API (`MAX_TENTATIVAS`, 0093): depois disto, não se pede outra. */
export const MAX_TENTATIVAS = 10;
/** Igual ao da API: uma incerta só se anula 15 minutos depois. */
export const INCERTA_IDADE_MINIMA_MS = 15 * 60 * 1000;

export interface AccoesDaEtiqueta {
  pedir: boolean;
  anular: boolean;
  /** Uma incerta recente: o botão só serve a partir desta hora. */
  anularAPartirDe: Date | null;
  descarregar: boolean;
}

/**
 * O que se oferece na etiqueta de uma devolução. Sem `returns:write`, só se
 * descarrega. Pede-se numa devolução à espera, sem etiqueta viva nem
 * incerta; anula-se a emitida e a incerta (esta só 15 minutos depois).
 */
export function accoesDaEtiqueta(
  estado: EstadoDevolucao,
  etiqueta: EtiquetaDevolucao | null,
  escreve: boolean,
  agora: number,
): AccoesDaEtiqueta {
  const viva =
    etiqueta !== null &&
    (etiqueta.estado === "a_pedir" ||
      etiqueta.estado === "emitida" ||
      etiqueta.estado === "incerta");
  const pedir =
    escreve &&
    estado === "a_aguardar" &&
    !viva &&
    (etiqueta === null || etiqueta.tentativa < MAX_TENTATIVAS);
  const anular =
    escreve &&
    etiqueta !== null &&
    (etiqueta.estado === "emitida" || etiqueta.estado === "incerta");
  let anularAPartirDe: Date | null = null;
  if (anular && etiqueta.estado === "incerta") {
    const a = new Date(etiqueta.em).getTime() + INCERTA_IDADE_MINIMA_MS;
    if (a > agora) anularAPartirDe = new Date(a);
  }
  return {
    pedir,
    anular,
    anularAPartirDe,
    descarregar: etiqueta?.ficheiro === "pdf",
  };
}

/** Os erros deste ecrã que têm um texto próprio (os outros, como em Expedir). */
const TEXTO_DO_CODIGO_DA_DEVOLUCAO: Record<string, keyof Textos> = {
  "returns.not_found": "devolucaoNaoExiste",
  "shipping.not_found": "devolucaoNaoExiste",
  "shipping.label_exists": "etiquetaDevolucaoJaExiste",
  "shipping.label_uncertain": "etiquetaDevolucaoIncertaPrimeiro",
  "shipping.void_not_allowed": "etiquetaDevolucaoNaoAnulaAinda",
  "shipping.invalid_field": "etiquetaDevolucaoRecusadaPeloServidor",
  "shipping.carrier_unavailable": "etiquetaDevolucaoSemTransportadora",
};

/** Um erro do servidor neste ecrã, no texto dele. */
export function erroDaDevolucao(e: unknown): unknown {
  if (!(e instanceof ErroHub) || e.codigo === undefined) return e;
  const chave =
    TEXTO_DO_CODIGO_DA_DEVOLUCAO[e.codigo] ?? TEXTO_DO_CODIGO[e.codigo];
  return chave === undefined ? e : new ErroDoEcra(chave);
}
