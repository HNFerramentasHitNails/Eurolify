import { describe, expect, it } from "vitest";
import { pormenorDeMigracao } from "../src/base/pormenor-de-migracao.js";

// O registo da publicação nunca leva valores das linhas (revisão do #80, 2.ª,
// P2-A): os erros abaixo têm a forma dos do `pg` (medida no PostgreSQL 18).

describe("pormenorDeMigracao", () => {
  it("uma linha recusada sai só com os nomes, sem os valores", () => {
    const erro = Object.assign(new Error("null value in column"), {
      code: "23502",
      schema: "public",
      table: "cliente",
      column: "nome",
      detail: "Failing row contains (1, a@b.pt, null).",
    });
    const texto = pormenorDeMigracao(erro);
    expect(texto).toBe("code=23502 schema=public table=cliente column=nome");
    expect(texto).not.toContain("a@b.pt");
    expect(texto).not.toContain("Failing row");
  });

  it("uma chave repetida de outra restrição também não leva o valor", () => {
    const erro = Object.assign(new Error("duplicate key"), {
      code: "23505",
      table: "cliente",
      constraint: "cliente_email_unico",
      detail: "Key (email)=(a@b.pt) already exists.",
    });
    expect(pormenorDeMigracao(erro)).toBe(
      "code=23505 table=cliente constraint=cliente_email_unico",
    );
  });

  it("o SKU repetido da 0003 sai com o pormenor, para se decidir à mão", () => {
    const erro = Object.assign(new Error("could not create unique index"), {
      code: "23505",
      table: "variante",
      constraint: "variante_sku_unico",
      detail:
        "Key (comerciante_id, lower(sku))=(01900000-0000-7000-8000-000000000001, gel-001) is duplicated.",
    });
    expect(pormenorDeMigracao(erro)).toContain("detail=Key (comerciante_id");
    expect(pormenorDeMigracao(erro)).toContain("gel-001");
  });

  it("sem campos do PostgreSQL, nada", () => {
    expect(pormenorDeMigracao(new Error("outro"))).toBeUndefined();
    expect(pormenorDeMigracao("texto")).toBeUndefined();
    expect(pormenorDeMigracao(null)).toBeUndefined();
  });
});
