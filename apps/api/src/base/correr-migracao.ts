import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { migrar, PASTA_MIGRACOES } from "./migracoes.js";
import { pormenorDeMigracao } from "./pormenor-de-migracao.js";

export interface Saida {
  log: (texto: string) => void;
  erro: (texto: string) => void;
}

/**
 * Corre as migrações em falta e devolve o código de saída do processo (0 ou
 * 1). **Nunca lança o erro de uma migração:** o Node imprimiria o objecto
 * inteiro (o `detail`, o `where`, a mensagem), com valores das linhas, e a
 * saída vai para o registo da publicação no GitHub (revisão do #80, 3.ª, P1).
 * Escreve só onde falhou (pormenor-de-migracao.ts).
 */
export async function correrMigracao(
  url: string,
  saida: Saida,
  pasta: URL = PASTA_MIGRACOES,
): Promise<number> {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: url, max: 1 }),
    }),
  });
  try {
    const { results } = await migrar(db, pasta);
    const aplicadas = (results ?? []).filter((r) => r.status === "Success");
    saida.log(
      aplicadas.length === 0
        ? "migrar: nada em falta."
        : `migrar: aplicadas ${aplicadas.map((r) => r.migrationName).join(", ")}.`,
    );
    return 0;
  } catch (erro) {
    saida.erro(
      `migrar: falhou: ${pormenorDeMigracao(erro) ?? "erro sem campos do PostgreSQL"}`,
    );
    return 1;
  } finally {
    await db.destroy();
  }
}
