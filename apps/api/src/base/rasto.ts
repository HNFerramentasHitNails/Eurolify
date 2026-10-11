import { AsyncLocalStorage } from "node:async_hooks";
import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados } from "./esquema.js";
import { erroBase } from "./erros.js";

// O contexto comum do rasto de auditoria (docs/28 §3.1; decisão DK; #322).
// Lê-se num só sítio — o pedido HTTP (app.ts) ou quem corre fora dele (o
// comando do operador) — e passa à base em cada transacção do comerciante
// (`comComerciante`), onde a função `contexto_do_rasto()` o confere.
// O `quem` e a `origem` continuam a ser postos por cada domínio, como antes;
// o `quem` vindo da autenticação fica para depois do passo 2 (#322). O
// `autorizadoPor` de uma sessão do Hub põe-no a autenticação.

/**
 * Os canais que `contexto_do_rasto()` aceita (0053). Uma lista, um sítio:
 * o tipo e o esquema das respostas saem daqui, e um teste confere-a com a
 * da base (revisão do #345, P2-3).
 */
export const CANAIS = [
  "hub",
  "api",
  "importacao",
  "integracao",
  "mcp",
  "sistema",
  "operador",
] as const;

export type Canal = (typeof CANAIS)[number];

export interface IaDoRasto {
  fornecedor?: string;
  modelo?: string;
  execucao?: string;
  /** docs/28 §3.3: «desconhecido» é não haver IA. */
  prova: "comprovado" | "declarado";
}

export interface ContextoRasto {
  canal: Canal;
  /** O identificador do pedido (o `instance` dos erros) ou da tarefa. */
  pedido?: string;
  ia?: IaDoRasto;
  /** `pessoa:per_…`: só com prova de que uma pessoa confirmou (§3.2). */
  autorizadoPor?: string;
  motivo?: string;
  /**
   * O pedido de origem de uma tarefa (docs/28 §3.7): o pedido e quem o fez.
   * Põe-no só quem corre uma tarefa com origem (`comOrigemDaTarefa`).
   */
  aPedidoDe?: { pedido?: string; quem?: string };
  /**
   * Quem se autenticou no pedido (`chave:key_…` ou `pessoa:per_…`). Põe-no a
   * autenticação; a base recusa um `quem` de chave ou de pessoa diferente
   * dele (0062; #322).
   */
  autenticado?: string;
}

/** A origem de uma tarefa como a base a guarda (0060, `tarefa_origem()`). */
export interface OrigemDaTarefa {
  a_pedido_de?: { pedido?: string; quem?: string };
  autorizado_por?: string;
  ia?: IaDoRasto;
}

/**
 * O contexto de uma tarefa do servidor (docs/28 §3.7; Diogo, 11/10/2026,
 * Q6): o canal «sistema» e o pedido `tarefa:<nome>` e, se a tarefa tiver
 * origem, o pedido de origem, quem autorizou e a IA **herdados** — uma
 * tarefa pedida por um agente sem pessoa a autorizar continua sem
 * autorização de uma pessoa.
 */
export function contextoDaTarefa(
  nome: string,
  guardada: OrigemDaTarefa | null,
): ContextoRasto {
  // Uma origem que a base já não aceitasse pararia a tarefa para sempre:
  // corre então sem origem (revisão do #351, P2-1).
  const origem = origemValida(guardada) ? guardada : null;
  return {
    canal: "sistema",
    pedido: `tarefa:${nome}`,
    ...(origem?.a_pedido_de === undefined
      ? {}
      : { aPedidoDe: origem.a_pedido_de }),
    ...(origem?.autorizado_por === undefined
      ? {}
      : { autorizadoPor: origem.autorizado_por }),
    ...(origem?.ia === undefined ? {} : { ia: origem.ia }),
  };
}

const TEXTO_DA_ORIGEM = /^.{1,200}$/su;
const AUTORIZADO =
  /^pessoa:per_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A origem passa as regras de `contexto_do_rasto()` (0060)? */
function origemValida(o: OrigemDaTarefa | null): boolean {
  if (o === null) return true;
  const a = o.a_pedido_de;
  if (a !== undefined) {
    if (a.pedido === undefined && a.quem === undefined) return false;
    if (a.pedido !== undefined && !PEDIDO_DO_RASTO.test(a.pedido)) return false;
    if (a.quem !== undefined && !TEXTO_DA_ORIGEM.test(a.quem)) return false;
  }
  if (o.autorizado_por !== undefined && !AUTORIZADO.test(o.autorizado_por)) {
    return false;
  }
  if (o.ia !== undefined) {
    const prova: string = o.ia.prova;
    if (prova !== "declarado" && prova !== "comprovado") return false;
    for (const v of [o.ia.fornecedor, o.ia.modelo, o.ia.execucao]) {
      if (v !== undefined && !/^.{1,100}$/su.test(v)) return false;
    }
  }
  return true;
}

const armazem = new AsyncLocalStorage<ContextoRasto>();

/** Corre `fn` com este contexto (fora de um pedido HTTP). */
export function comRasto<T>(contexto: ContextoRasto, fn: () => T): T {
  return armazem.run(contexto, fn);
}

/**
 * Põe o contexto para um comando de uma vez (o do operador), que corre do
 * princípio ao fim com ele. Num servidor, usar `comRasto`: o `enterWith`
 * passaria a quem chamou (o teste do rasto mostrou-o com o `inject`).
 */
export function entrarNoRasto(contexto: ContextoRasto): void {
  armazem.enterWith(contexto);
}

export function rastoActual(): ContextoRasto | undefined {
  return armazem.getStore();
}

/** A forma do identificador que `contexto_do_rasto()` aceita (0051). */
export const PEDIDO_DO_RASTO = /^[A-Za-z0-9._:-]{1,100}$/;

const VALOR_IA = /^[A-Za-z0-9._:/-]{1,100}$/;

/**
 * O cabeçalho `Eurolify-IA: fornecedor=…; modelo=…; execucao=…` (docs/28
 * §3.3): o que quem chama declara, gravado como «declarado», nunca como
 * verdade. Mal formado, é recusado (400), nunca ignorado em silêncio.
 */
export function iaDoCabecalho(valor: unknown): IaDoRasto | undefined {
  if (valor === undefined) return undefined;
  if (typeof valor !== "string" || valor.trim() === "") {
    throw erroBase("request.invalid", "cabeçalho Eurolify-IA mal formado");
  }
  const ia: IaDoRasto = { prova: "declarado" };
  for (const parte of valor.split(";")) {
    const [chave, ...resto] = parte.split("=");
    const nome = chave?.trim();
    const texto = resto.join("=").trim();
    if (
      (nome !== "fornecedor" && nome !== "modelo" && nome !== "execucao") ||
      !VALOR_IA.test(texto) ||
      ia[nome] !== undefined
    ) {
      throw erroBase(
        "request.invalid",
        "cabeçalho Eurolify-IA mal formado (fornecedor=…; modelo=…; execucao=…)",
      );
    }
    ia[nome] = texto;
  }
  return ia;
}

/**
 * Passa o contexto à transacção (`set_config(…, true)`: só nesta), numa só
 * ida à base. Sem contexto, nada se inventa: o canal fica vazio, isto é,
 * desconhecido (revisão do #327, P1-1). As tarefas da própria API correm
 * com o canal «sistema» posto por quem as agenda (servidor.ts).
 */
export async function aplicarRasto(
  trx: Transaction<BaseDados>,
  contexto: ContextoRasto | undefined = rastoActual(),
): Promise<void> {
  const ia = contexto?.ia === undefined ? "" : JSON.stringify(contexto.ia);
  const aPedidoDe =
    contexto?.aPedidoDe === undefined ? "" : JSON.stringify(contexto.aPedidoDe);
  await sql`select
      set_config('eurolify.a_pedido_de', ${aPedidoDe}, true),
      set_config('eurolify.autenticado', ${contexto?.autenticado ?? ""}, true),
      set_config('eurolify.canal', ${contexto?.canal ?? ""}, true),
      set_config('eurolify.pedido', ${contexto?.pedido ?? ""}, true),
      set_config('eurolify.ia', ${ia}, true),
      set_config('eurolify.autorizado_por', ${contexto?.autorizadoPor ?? ""}, true),
      set_config('eurolify.motivo', ${contexto?.motivo ?? ""}, true)`.execute(
    trx,
  );
}

/**
 * Abre uma transacção com o contexto do rasto, para as escritas que não
 * são de um comerciante (revisão do #327, P2-1): o comando do operador.
 */
export async function comRastoNaBase<T>(
  db: Kysely<BaseDados>,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await aplicarRasto(trx);
    return fn(trx);
  });
}
