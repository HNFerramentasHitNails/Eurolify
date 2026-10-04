import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, type Kysely } from "kysely";
import {
  Migrator,
  type Migration,
  type MigrationProvider,
  type MigrationResultSet,
} from "kysely/migration";

/** A pasta das migrações, ao lado de `src/` e de `dist/`. */
export const PASTA_MIGRACOES = new URL("../../migracoes/", import.meta.url);

const NOME = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * Migrações em SQL à mão, numeradas, pelo migrador do Kysely (ADR-0025).
 * Só para a frente: não há `down` — desfazer é uma migração nova.
 */
class MigracoesSql implements MigrationProvider {
  constructor(private readonly pasta: URL) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const ficheiros = (await readdir(this.pasta)).sort();
    const migracoes: Record<string, Migration> = {};
    for (const ficheiro of ficheiros) {
      if (!ficheiro.endsWith(".sql")) continue;
      if (!NOME.test(ficheiro)) {
        throw new Error(`nome de migração inválido: ${ficheiro}`);
      }
      const texto = await readFile(
        join(fileURLToPath(this.pasta), ficheiro),
        "utf8",
      );
      migracoes[ficheiro.replace(/\.sql$/, "")] = {
        up: async (db) => {
          await sql.raw(texto).execute(db);
        },
      };
    }
    return migracoes;
  }
}

/** Aplica as migrações em falta. Lança com o erro da que falhou. */
export async function migrar(
  db: Kysely<unknown>,
  pasta: URL = PASTA_MIGRACOES,
): Promise<MigrationResultSet> {
  const migrador = new Migrator({
    db,
    provider: new MigracoesSql(pasta),
  });
  const resultado = await migrador.migrateToLatest();
  if (resultado.error !== undefined) {
    throw resultado.error instanceof Error
      ? resultado.error
      : new Error("a migração falhou", { cause: resultado.error });
  }
  return resultado;
}
