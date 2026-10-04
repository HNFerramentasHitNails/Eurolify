import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { migrar } from "./base/migracoes.js";

// Corre na publicação, antes de trocar a versão (eurolify-publicar). Liga-se
// com o utilizador dono das tabelas (BASE_DADOS_URL_MIGRACAO), nunca com o da
// API. Enquanto a VPS não tiver a base configurada (api.env vazio, ver
// preparar.sh), diz-o e sai sem erro, para não travar a publicação do resto.
const url = process.env["BASE_DADOS_URL_MIGRACAO"];

if (url === undefined || url === "") {
  console.log(
    "migrar: sem BASE_DADOS_URL_MIGRACAO — a base ainda não está configurada neste ambiente; nenhuma migração aplicada.",
  );
} else {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: url, max: 1 }),
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
