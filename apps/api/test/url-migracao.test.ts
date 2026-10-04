import { describe, expect, it } from "vitest";
import {
  decidirMigracao,
  FIM_DA_REDE_SEM_BASE,
} from "../src/base/url-migracao.js";

const ANTES = new Date("2026-10-04T12:00:00Z");

describe("que base o migrador usa (revisão do #43, P1-4)", () => {
  it("sem a variável, antes da data de fim, avisa e não migra", () => {
    const decisao = decidirMigracao({}, ANTES);
    expect(decisao.tipo).toBe("sem_base");
  });

  it("sem a variável, a partir da data de fim, é erro", () => {
    expect(() => decidirMigracao({}, new Date(FIM_DA_REDE_SEM_BASE))).toThrow(
      /rede «sem base» acabou/,
    );
  });

  it("variável presente mas vazia é erro, não «sem base»", () => {
    for (const vazio of ["", "   "]) {
      expect(() =>
        decidirMigracao({ BASE_DADOS_URL_MIGRACAO: vazio }, ANTES),
      ).toThrow(/definida mas vazia/);
    }
  });

  it("um instante antes da data de fim ainda tolera a falta", () => {
    const antes = new Date(Date.parse(FIM_DA_REDE_SEM_BASE) - 1);
    expect(decidirMigracao({}, antes).tipo).toBe("sem_base");
  });

  it("um URL com espaços à volta migra com o URL limpo (revisão do #43, P2-2)", () => {
    expect(
      decidirMigracao({ BASE_DADOS_URL_MIGRACAO: " postgres://x/y \t" }, ANTES),
    ).toEqual({ tipo: "migrar", url: "postgres://x/y" });
  });

  it("um valor que não é um URL postgres é erro, sem mostrar o valor", () => {
    for (const mau of ['"postgres://u:segredo@x/y"', "u:segredo@x/y"]) {
      expect(() =>
        decidirMigracao({ BASE_DADOS_URL_MIGRACAO: mau }, ANTES),
      ).toThrow(/não começa por postgres:\/\//);
      try {
        decidirMigracao({ BASE_DADOS_URL_MIGRACAO: mau }, ANTES);
      } catch (erro) {
        expect(String(erro)).not.toContain("segredo");
      }
    }
  });

  it("com a variável, migra com esse URL", () => {
    expect(
      decidirMigracao({ BASE_DADOS_URL_MIGRACAO: "postgres://x/y" }, ANTES),
    ).toEqual({ tipo: "migrar", url: "postgres://x/y" });
  });
});
