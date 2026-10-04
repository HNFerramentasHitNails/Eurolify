import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { BaseDados } from "./esquema.js";

/** Abre a base com o utilizador dado no URL (a API usa o `eurolify_api`). */
export function abrirBase(url: string): Kysely<BaseDados> {
  return new Kysely<BaseDados>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: url, max: 10 }),
    }),
  });
}
