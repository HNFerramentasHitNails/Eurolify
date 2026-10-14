import type { Textos } from "./textos";

// O ecrã «A decidir» (docs/22 §28): as funções sem ecrã — o filtro no
// endereço e no pedido, o motivo em linguagem comum e as horas no fuso do
// comerciante. A regra de quem vê, quem atribui e quem pode ser responsável
// é da API e da base (R2, R3); aqui nada a decide.

/**
 * As nove filas, pela ordem do `docs/33` §1, do `docs/29` §18 e do `docs/23`
 * §15.14 (só para mostrar e escolher).
 */
export const FILAS_TAREFAS = [
  "pagamento",
  "documento_fiscal",
  "duplicado_cliente",
  "prazo_reembolso",
  "livre_resolucao",
  "problema",
  "reembolso",
  "ligacao_faturacao",
  "pedido_titular",
] as const;
export type FilaTarefa = (typeof FILAS_TAREFAS)[number];

export const FILTROS_TAREFAS = ["todos", "meus", "sem", "vencidas"] as const;
export type FiltroTarefas = (typeof FILTROS_TAREFAS)[number];

export interface Tarefa {
  fila: FilaTarefa;
  /** Com o prefixo da fila (`pdi_…`, `inv_…`). */
  caso: string;
  motivo: string;
  entrou_em: string;
  encomenda: string | null;
  responsavel: string | null;
  prazo: string;
  prazo_definido: boolean;
  /** AAAA-MM-DD, o último dia legal, onde o há. */
  prazo_legal: string | null;
  vencida: boolean;
  aviso_vencido_em: string | null;
  versao: number;
}

export interface PaginaTarefas {
  dados: Tarefa[];
  filas: FilaTarefa[];
  totais: Record<string, number>;
  ha_mais: boolean;
  cursor_seguinte: string | null;
  fuso: string;
}

export interface PassoTarefa {
  acto: "atribuida" | "retirada" | "prazo_mudado" | "vencida";
  responsavel_antes: string | null;
  responsavel_depois: string | null;
  prazo_antes: string | null;
  prazo_depois: string | null;
  motivo: string | null;
  quem: string;
  em: string;
  passagem: string;
}

export interface CasoTarefa {
  tarefa: Tarefa;
  historico: PassoTarefa[];
  pode_ser_responsavel: string[];
}

export const filaValida = (x: string | null): x is FilaTarefa =>
  FILAS_TAREFAS.some((f) => f === x);

/** O filtro e a fila do endereço; um valor desconhecido não conta. */
export function doEndereco(consulta: string): {
  filtro: FiltroTarefas;
  fila: FilaTarefa | null;
} {
  const q = new URLSearchParams(consulta);
  const f = q.get("filtro");
  const fila = q.get("fila");
  return {
    filtro: FILTROS_TAREFAS.some((x) => x === f)
      ? (f as FiltroTarefas)
      : "todos",
    fila: filaValida(fila) ? fila : null,
  };
}

/** O endereço da página com o comerciante, o filtro e a fila. */
export function enderecoDe(
  comerciante: string,
  filtro: FiltroTarefas,
  fila: FilaTarefa | null,
): string {
  const q = new URLSearchParams({ comerciante });
  if (filtro !== "todos") q.set("filtro", filtro);
  if (fila !== null) q.set("fila", fila);
  return `/a-decidir?${q.toString()}`;
}

/** A consulta do `GET /hub/tasks` para o filtro, a fila e a página. */
export function consultaDe(
  filtro: FiltroTarefas,
  fila: FilaTarefa | null,
  cursor: string | null,
): string {
  const q = new URLSearchParams({ limite: "25" });
  if (filtro === "meus") q.set("responsavel", "eu");
  if (filtro === "sem") q.set("responsavel", "sem");
  if (filtro === "vencidas") q.set("vencida", "true");
  if (fila !== null) q.set("fila", fila);
  if (cursor !== null) q.set("cursor", cursor);
  return q.toString();
}

/**
 * O motivo em linguagem comum: cada código da fila (vários, separados por
 * vírgula, num documento com dois motivos) pelo seu texto; um código sem
 * texto mostra-se como está, nunca se esconde (docs/22 §28.3).
 */
export function motivoDe(t: Textos, motivo: string): string {
  const textos = t as Record<string, string>;
  return motivo
    .split(",")
    .map((c) => textos[`motivoTarefa_${c}`] ?? c)
    .join("; ");
}

/** Os últimos 4 caracteres do identificador, para a linha (o todo copia-se). */
export const curto = (id: string) => {
  const [prefixo] = id.split("_", 1);
  return `${prefixo ?? ""}_…${id.slice(-4)}`;
};

/** O desvio do fuso, em minutos, num instante (o que o relógio de lá marca). */
function desvio(instante: number, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instante));
  const v = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  const relogio = Date.UTC(
    v("year"),
    v("month") - 1,
    v("day"),
    v("hour"),
    v("minute"),
    v("second"),
  );
  return Math.round((relogio - Math.floor(instante / 1000) * 1000) / 60_000);
}

/**
 * «AAAA-MM-DDTHH:MM» no relógio do fuso → o instante (ISO, UTC). Numa hora
 * que não existe (o salto da mudança de hora) fica a seguinte; numa que se
 * repete (o recuo de Outubro), a segunda — a do horário de inverno
 * (revisão do #396, P3-1).
 */
export function instanteDe(dataHora: string, fuso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(dataHora);
  if (m === null) return null;
  const [, a, me, d, h, mi] = m.map(Number);
  const relogio = Date.UTC(a ?? 0, (me ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  let instante = relogio - desvio(relogio, fuso) * 60_000;
  instante = relogio - desvio(instante, fuso) * 60_000;
  return new Date(instante).toISOString();
}

/** O instante (ISO) no relógio do fuso, como «AAAA-MM-DDTHH:MM». */
export function relogioDe(iso: string, fuso: string): string {
  const instante = new Date(iso).getTime();
  return new Date(instante + desvio(instante, fuso) * 60_000)
    .toISOString()
    .slice(0, 16);
}

/**
 * O último instante que o prazo pode ter, no relógio do fuso: o fim do
 * último dia legal, que é a meia-noite do dia seguinte, como a base o conta
 * (`(prazo_legal + 1)::timestamp at time zone fuso`, R5; revisão do #396,
 * P3-2). Sem prazo legal, nenhum.
 */
export function limiteDoPrazo(prazoLegal: string | null): string | null {
  if (prazoLegal === null) return null;
  const d = new Date(`${prazoLegal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T00:00`;
}

/**
 * O âmbito que decide cada fila (docs/33 §1), só para o ecrã não oferecer o
 * que a API recusa; a API e a base decidem (R3). Um teste confere-a com a
 * régua da API (`apps/api/src/tarefas/filas.ts`), como os papéis.
 */
export const DECIDE_A_FILA: Record<FilaTarefa, string> = {
  pagamento: "payments:resolve",
  documento_fiscal: "invoices:write",
  duplicado_cliente: "customers:merge",
  prazo_reembolso: "refunds:write",
  livre_resolucao: "returns:write",
  problema: "refunds:write",
  reembolso: "refunds:write",
  ligacao_faturacao: "invoices:accounts",
  pedido_titular: "customers:privacy",
};

/** Há quanto tempo, em horas inteiras, de `desde` até `agora`. */
export const horasDesde = (desde: string, agora: number) =>
  Math.max(0, Math.floor((agora - new Date(desde).getTime()) / 3_600_000));
