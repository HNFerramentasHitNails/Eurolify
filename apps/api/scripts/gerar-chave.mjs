#!/usr/bin/env node
// Gera uma chave de servidor do Eurolify NO COMPUTADOR DE QUEM A VAI USAR
// (docs/19 §6). Só precisa do Node, sem dependências:
//
//   node apps/api/scripts/gerar-chave.mjs
//
// Mostra o SEGREDO (guarda-o já num cofre de palavras-passe; não se mostra
// outra vez e o Eurolify nunca o sabe) e o PREFIXO e o RESUMO, que são o que
// se põe no fluxo «operar» do GitHub. O resumo não deixa reconstruir o
// segredo. Mesmo formato de src/identidade/chaves.ts (um teste confere-o).
import { createHash, randomBytes } from "node:crypto";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function emBase32(bytes) {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += BASE32.charAt((valor >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) saida += BASE32.charAt((valor << (5 - bits)) & 31);
  return saida;
}

const segredo = "eul_sk_" + emBase32(randomBytes(32));
const prefixo = segredo.slice(0, 12);
const resumo = createHash("sha256").update(segredo, "utf8").digest("hex");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ segredo, prefixo, resumo }));
} else {
  console.log("SEGREDO (guardar já; não se volta a mostrar):");
  console.log("  " + segredo);
  console.log("");
  console.log("Para o fluxo «operar» do GitHub:");
  console.log("  prefixo: " + prefixo);
  console.log("  resumo:  " + resumo);
}
