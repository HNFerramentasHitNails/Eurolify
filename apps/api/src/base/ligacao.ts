import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { BaseDados } from "./esquema.js";

/** Abre a base com o utilizador dado no URL (a API usa o `eurolify_api`). */
export function abrirBase(url: string): Kysely<BaseDados> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // Um cliente parado que perde a ligação emite «error» no pool; sem quem o
  // trate, o processo cai (revisão do #110, P3-8). O pedido seguinte abre
  // outra ligação. A mensagem não leva o URL.
  pool.on("error", (erro) => {
    console.error(`base: ligação parada perdida (${erro.message})`);
  });
  return new Kysely<BaseDados>({ dialect: new PostgresDialect({ pool }) });
}
