import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Os contrastes dos tokens, nos dois temas (eurolify-design, regra 4; docs/22
// §4): texto normal ≥ 4,5:1 (WCAG 2.x, 1.4.3) e o anel de foco ≥ 3:1 contra a
// superfície (1.4.11). Lidos do tokens.css, para o teste falhar se alguém
// mudar uma cor.

const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");

function blocos(): { claro: string; escuro: string } {
  const inicioEscuro = css.indexOf("@media (prefers-color-scheme: dark)");
  return { claro: css.slice(0, inicioEscuro), escuro: css.slice(inicioEscuro) };
}

function valor(texto: string, nome: string): string | undefined {
  return new RegExp(`--${nome}:\\s*([^;]+);`).exec(texto)?.[1]?.trim();
}

/** A cor final de um token semântico, resolvendo var(--global). */
function cor(tema: "claro" | "escuro", nome: string): string {
  const b = blocos();
  const bruto = valor(b[tema], nome) ?? valor(b.claro, nome);
  if (bruto === undefined) throw new Error(`sem --${nome}`);
  const ref = /^var\(--([\w-]+)\)$/.exec(bruto)?.[1];
  const final = ref === undefined ? bruto : valor(b.claro, ref);
  if (final === undefined || !/^#[0-9a-f]{6}$/i.test(final)) {
    throw new Error(`--${nome} não é uma cor #rrggbb (${String(final)})`);
  }
  return final;
}

function luminancia(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = c.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
}

const TEXTO = [
  ["texto", "superficie"],
  ["texto", "superficie-elevada"],
  ["texto-secundario", "superficie"],
  ["texto-secundario", "superficie-elevada"],
  ["accao-principal", "superficie"],
  ["accao-principal", "superficie-elevada"],
  ["texto-sobre-accao", "accao-principal"],
  ["estado-erro", "superficie"],
  ["estado-erro", "superficie-elevada"],
] as const;

describe("os contrastes dos tokens", () => {
  for (const tema of ["claro", "escuro"] as const) {
    for (const [frente, fundo] of TEXTO) {
      it(`${tema}: ${frente} sobre ${fundo} ≥ 4,5:1`, () => {
        expect(
          contraste(cor(tema, frente), cor(tema, fundo)),
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const fundo of ["superficie", "superficie-elevada"] as const) {
      it(`${tema}: foco, aviso e sucesso sobre ${fundo} ≥ 3:1`, () => {
        for (const n of ["foco", "estado-aviso", "estado-sucesso"]) {
          expect(
            contraste(cor(tema, n), cor(tema, fundo)),
            n,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});
