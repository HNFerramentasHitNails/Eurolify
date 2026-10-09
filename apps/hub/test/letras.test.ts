import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// As letras em tamanhos relativos (docs/22 §4, issue #237): seguem o tamanho
// de letra escolhido no navegador. Com o tamanho por omissão (16 px) ficam
// 16, 14 e 24 px, como antes.

const tokens = readFileSync(
  new URL("../src/tokens.css", import.meta.url),
  "utf8",
);
const estilos = readFileSync(
  new URL("../src/estilos.css", import.meta.url),
  "utf8",
);

const valor = (nome: string) =>
  new RegExp(`--${nome}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim();

describe("os tamanhos de letra", () => {
  it("estão em rem e dão 16, 14 e 24 px com a letra do navegador a 16 px", () => {
    for (const [nome, px] of [
      ["letra-base", 16],
      ["letra-pequena", 14],
      ["letra-titulo", 24],
    ] as const) {
      const v = valor(nome);
      expect(v, nome).toMatch(/^\d+(\.\d+)?rem$/);
      expect(Number.parseFloat(v ?? "") * 16, nome).toBe(px);
    }
  });

  it("os pontos em que as tabelas passam a cartões estão em em", () => {
    // Num @media, em é a letra do navegador: com letra grande, as tabelas
    // passam a cartões mais cedo em vez de obrigarem a deslocar (#237).
    const semComentarios = estilos.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(semComentarios).not.toMatch(/@media[^{]*width:\s*[\d.]+px/);
    expect(semComentarios).toContain("@media (max-width: 40em)");
    expect(semComentarios).toContain("@media (max-width: 60em)");
  });

  it("os pontos da grelha da entrada estão em rem e dão os mesmos px por omissão", () => {
    // Com letra grande, menos colunas e rótulos inteiros (revisão do #241).
    const semComentarios = estilos.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(semComentarios).not.toMatch(/@container[^{]*width:\s*[\d.]+px/);
    const pontos = [
      ...semComentarios.matchAll(/@container \(min-width: ([\d.]+)rem\)/g),
    ].map((m) => Number(m[1]) * 16);
    expect(pontos).toEqual([480, 640, 880, 1040]);
  });

  it("a grelha dos códigos de recuperação nunca passa a largura da coluna", () => {
    // 20ch cresce com a letra; com letra grande passava a largura do
    // telemóvel (revisão do #241, P2-2).
    expect(estilos).toContain("minmax(min(var(--largura-codigo), 100%), 1fr)");
  });

  it("nenhum tamanho de letra fica escrito em px nos estilos", () => {
    const semComentarios = estilos.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(semComentarios).not.toMatch(/font-size:\s*[\d.]+px/);
    expect(semComentarios).not.toMatch(/font:\s*[^;]*\d+px/);
  });
});
