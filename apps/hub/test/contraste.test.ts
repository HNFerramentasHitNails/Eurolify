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

/**
 * O valor final de um token no tema, seguindo as cadeias var(--…) até ao
 * fim (global → semântico → componente): no escuro, o que o bloco escuro
 * redefine ganha ao claro, em qualquer nível.
 */
function resolver(tema: "claro" | "escuro", nome: string, passos = 0): string {
  if (passos > 5) throw new Error(`--${nome}: cadeia de var() longa demais`);
  const b = blocos();
  const bruto = valor(b[tema], nome) ?? valor(b.claro, nome);
  if (bruto === undefined) throw new Error(`sem --${nome}`);
  const ref = /^var\(--([\w-]+)\)$/.exec(bruto)?.[1];
  return ref === undefined ? bruto : resolver(tema, ref, passos + 1);
}

/** A cor final de um token, #rrggbb. */
function cor(tema: "claro" | "escuro", nome: string): string {
  const final = resolver(tema, nome);
  if (!/^#[0-9a-f]{6}$/i.test(final)) {
    throw new Error(`--${nome} não é uma cor #rrggbb (${final})`);
  }
  return final;
}

/** Uma opacidade em percentagem (`84%`), como 0,84. */
function opacidade(tema: "claro" | "escuro", nome: string): number {
  const bruto = resolver(tema, nome);
  const m = /^(\d+(?:\.\d+)?)%$/.exec(bruto);
  if (m?.[1] === undefined) throw new Error(`--${nome} não é uma percentagem`);
  return Number(m[1]) / 100;
}

/**
 * A cor que se vê: `frente` com opacidade `alfa` por cima de `fundo`
 * (o color-mix com transparent dá esta cor com esse alfa; o navegador
 * compõe-a sobre o que está atrás).
 */
function composta(frente: string, alfa: number, fundo: string): string {
  const canal = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) =>
      Math.round(alfa * canal(frente, i) + (1 - alfa) * canal(fundo, i))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
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

// A entrada por módulos (docs/hub-modular-glassmorphism.md): o fundo é um
// gradiente entre dois tons e o vidro é translúcido. Mede-se a cor que se
// vê nos dois extremos do gradiente (cada canal muda sempre no mesmo
// sentido, por isso o pior caso está num extremo); um alfa mais alto só
// aproxima a cor da do vidro, que também se mede opaca.
describe("os contrastes da entrada, com o vidro composto", () => {
  for (const tema of ["claro", "escuro"] as const) {
    for (const fundo of [
      "fundo-entrada-inicio",
      "fundo-entrada-fim",
    ] as const) {
      it(`${tema}: texto, secundário e ligações sobre ${fundo} ≥ 4,5:1`, () => {
        for (const n of ["texto", "texto-secundario", "accao-principal"]) {
          expect(
            contraste(cor(tema, n), cor(tema, fundo)),
            n,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });

      it(`${tema}: foco sobre ${fundo} ≥ 3:1`, () => {
        expect(
          contraste(cor(tema, "foco"), cor(tema, fundo)),
        ).toBeGreaterThanOrEqual(3);
      });

      for (const alfa of [
        "vidro-opacidade",
        "vidro-opacidade-forte",
      ] as const) {
        it(`${tema}: sobre o vidro (${alfa}) em ${fundo}, texto ≥ 4,5:1 e ícone ≥ 3:1`, () => {
          const vidro = composta(
            cor(tema, "vidro-cor"),
            opacidade(tema, alfa),
            cor(tema, fundo),
          );
          expect(contraste(cor(tema, "texto"), vidro)).toBeGreaterThanOrEqual(
            4.5,
          );
          expect(
            contraste(cor(tema, "accao-principal"), vidro),
          ).toBeGreaterThanOrEqual(3);
        });
      }
    }

    it(`${tema}: sobre o vidro opaco, texto ≥ 4,5:1 e ícone ≥ 3:1`, () => {
      const vidro = cor(tema, "vidro-cor");
      expect(contraste(cor(tema, "texto"), vidro)).toBeGreaterThanOrEqual(4.5);
      expect(
        contraste(cor(tema, "accao-principal"), vidro),
      ).toBeGreaterThanOrEqual(3);
    });
  }

  it("a cor composta está certa nos extremos", () => {
    expect(composta("#ffffff", 1, "#000000")).toBe("#ffffff");
    expect(composta("#ffffff", 0, "#000000")).toBe("#000000");
    expect(composta("#ffffff", 0.5, "#000000")).toBe("#808080");
  });
});
