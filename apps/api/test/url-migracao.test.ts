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

  it("com a variável, migra com esse URL", () => {
    expect(
      decidirMigracao({ BASE_DADOS_URL_MIGRACAO: "postgres://x/y" }, ANTES),
    ).toEqual({ tipo: "migrar", url: "postgres://x/y" });
  });
});
