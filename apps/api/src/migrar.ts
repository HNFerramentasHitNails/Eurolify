import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { migrar } from "./base/migracoes.js";
import { decidirMigracao } from "./base/url-migracao.js";

// Corre na publicação, antes de trocar a versão (eurolify-publicar). Liga-se
// com o utilizador dono das tabelas, nunca com o da API. A falta da variável
// só é tolerada até à data de fim em url-migracao.ts; um erro faz a
// publicação parar e ficar a versão anterior.
const decisao = decidirMigracao(process.env, new Date());

if (decisao.tipo === "sem_base") {
  console.log(decisao.aviso);
} else {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: decisao.url, max: 1 }),
    }),
  });
  try {
    const { results } = await migrar(db);
    const aplicadas = (results ?? []).filter((r) => r.status === "Success");
    console.log(
      aplicadas.length === 0
        ? "migrar: nada em falta."
        : `migrar: aplicadas ${aplicadas.map((r) => r.migrationName).join(", ")}.`,
    );
  } finally {
    await db.destroy();
  }
}
