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
  await sql`select
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
