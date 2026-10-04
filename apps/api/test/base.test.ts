import pg from "pg";
import { describe, expect, it } from "vitest";

// Neste computador não há PostgreSQL (os testes com base correm só no GitHub,
// decisão do Diogo de 04/10/2026): sem BASE_DADOS_URL o teste salta. No GitHub o
// fluxo põe EXIGIR_BASE=1, e aí saltar seria esconder uma falha.
const url = process.env["BASE_DADOS_URL"];
if (process.env["EXIGIR_BASE"] === "1" && url === undefined) {
  throw new Error(
    "EXIGIR_BASE=1 mas falta BASE_DADOS_URL: o teste da base não pode saltar",
  );
}

describe.skipIf(url === undefined)("ligação ao PostgreSQL", () => {
  it("liga e a versão é a 18 (ADR-0025)", async () => {
    const cliente = new pg.Client({ connectionString: url ?? "" });
    await cliente.connect();
    try {
      const resultado = await cliente.query<{ server_version_num: string }>(
        "SHOW server_version_num",
      );
      const versao = Number(resultado.rows[0]?.server_version_num);
      expect(Math.floor(versao / 10000)).toBe(18);
    } finally {
      await cliente.end();
    }
  });
});
