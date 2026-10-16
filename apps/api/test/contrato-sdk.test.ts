import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { abrirBase } from "../src/base/ligacao.js";
import { ArmazenamentoEmDisco } from "../src/catalogo/armazenamento.js";

// O contrato OpenAPI que o SDK usa (docs/39 §3): a cópia em
// apps/sdk/contrato/openapi.json tem de ser a que a API publica agora. Não
// precisa de base de dados: a ligação só abre ao primeiro pedido, e este
// teste nunca faz nenhum. Depois de mudar uma rota:
//   ACTUALIZAR_CONTRATO=1 pnpm --filter @eurolify/api exec vitest run test/contrato-sdk.test.ts
const FICHEIRO = fileURLToPath(
  new URL("../../sdk/contrato/openapi.json", import.meta.url),
);

async function contratoActual(): Promise<string> {
  const base = abrirBase("postgres://contrato:contrato@127.0.0.1:1/contrato");
  const app = criarApp(
    {},
    undefined,
    base,
    undefined,
    new ArmazenamentoEmDisco("/nao-usado"),
  );
  try {
    await app.ready();
    return `${JSON.stringify(app.swagger(), null, 1)}\n`;
  } finally {
    await app.close();
    await base.destroy();
  }
}

describe("contrato do SDK", () => {
  it("a cópia em apps/sdk/contrato é a que a API publica", async () => {
    const actual = await contratoActual();
    if (process.env["ACTUALIZAR_CONTRATO"] === "1") {
      writeFileSync(FICHEIRO, actual);
    }
    expect(
      readFileSync(FICHEIRO, "utf8") === actual,
      "o contrato mudou: corra com ACTUALIZAR_CONTRATO=1 e junte apps/sdk/contrato/openapi.json (docs/39 §3)",
    ).toBe(true);
  });

  it("cada rota diz o âmbito no contrato (x-ambito)", async () => {
    const contrato = JSON.parse(await contratoActual()) as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    const sem: string[] = [];
    for (const [caminho, metodos] of Object.entries(contrato.paths)) {
      for (const [metodo, op] of Object.entries(metodos)) {
        if (typeof op["x-ambito"] !== "string") {
          sem.push(`${metodo} ${caminho}`);
        }
      }
    }
    expect(sem).toEqual([]);
  });
});
