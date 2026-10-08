#!/usr/bin/env node
// Gera o convite do primeiro dono de um comerciante NO COMPUTADOR DO
// OPERADOR (docs/19 §6.0). Só precisa do Node, sem dependências:
//
//   node apps/api/scripts/gerar-convite.mjs [--hub https://hub.eurolify.eu]
//
// Mostra a LIGAÇÃO (leva o segredo depois do «#»: dá-se a quem vai ser dono,
// por um canal privado, e não se guarda) e o RESUMO, que é o que se põe no
// fluxo «operar» do GitHub. O resumo não deixa reconstruir o segredo. Mesmo
// formato de src/identidade/sessoes.ts (um teste confere-o).
import { createHash, randomBytes } from "node:crypto";

const i = process.argv.indexOf("--hub");
const hub = i === -1 ? "https://hub.eurolify.eu" : (process.argv[i + 1] ?? "");
if (!/^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/.test(hub)) {
  console.error(
    "--hub: um endereço https sem caminho (ex.: https://hub.eurolify.eu)",
  );
  process.exit(2);
}

const segredo = "euc_" + randomBytes(32).toString("base64url");
const resumo = createHash("sha256").update(segredo, "utf8").digest("hex");
const ligacao = `${hub}/convite#${segredo}`;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ segredo, resumo, ligacao }));
} else {
  console.log(
    "LIGAÇÃO (dar a quem vai ser dono; vale 7 dias e uma vez; não guardar):",
  );
  console.log("  " + ligacao);
  console.log("");
  console.log("Para o fluxo «operar» do GitHub (acção convite):");
  console.log("  resumo: " + resumo);
}
