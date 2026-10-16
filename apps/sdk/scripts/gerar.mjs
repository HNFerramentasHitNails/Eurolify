#!/usr/bin/env node
// Gera os tipos do SDK a partir do contrato OpenAPI da API (docs/39 §3):
//   contrato/openapi.json  ->  src/gerado/loja.ts e src/gerado/administracao.ts
// Os ficheiros gerados não vão para o git: refazem-se em cada `tipos`,
// `teste` e `construir`. O contrato é que se junta, e um teste da API falha
// se ele divergir do que a API publica.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import { repartir } from "./filtro.mjs";

const aqui = (caminho) => fileURLToPath(new URL(caminho, import.meta.url));

const contrato = JSON.parse(
  readFileSync(aqui("../contrato/openapi.json"), "utf8"),
);
const { loja, administracao } = repartir(contrato);

const CABECALHO =
  "// GERADO por scripts/gerar.mjs a partir de contrato/openapi.json. Não editar.\n\n";

mkdirSync(aqui("../src/gerado"), { recursive: true });
for (const [nome, parte] of [
  ["loja", loja],
  ["administracao", administracao],
]) {
  const ast = await openapiTS(parte, { alphabetize: true });
  writeFileSync(aqui(`../src/gerado/${nome}.ts`), CABECALHO + astToString(ast));
}
