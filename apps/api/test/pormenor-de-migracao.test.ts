import { describe, expect, it } from "vitest";
import { pormenorDeMigracao } from "../src/base/pormenor-de-migracao.js";

// O registo da publicação não leva valores das linhas, excepto o comerciante
// e o SKU da restrição do SKU (revisões do #80: 2.ª, P2-A; 4.ª, P3-1). Os
// erros abaixo têm a forma dos do `pg` (medida no PostgreSQL 18).

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
      schema: "public",
      table: "variante",
      constraint: "variante_sku_unico",
      detail:
        "Key (comerciante_id, lower(sku))=(01900000-0000-7000-8000-000000000001, gel-001) is duplicated.",
    });
    expect(pormenorDeMigracao(erro)).toContain("detail=Key (comerciante_id");
    expect(pormenorDeMigracao(erro)).toContain("gel-001");
  });

  it("a mesma restrição noutra tabela não leva o pormenor", () => {
    const erro = Object.assign(new Error("duplicate key"), {
      code: "23505",
      schema: "public",
      table: "cliente",
      constraint: "variante_sku_unico",
      detail: "Key (email)=(a@b.pt) already exists.",
    });
    expect(pormenorDeMigracao(erro)).not.toContain("a@b.pt");
  });

  it("sem campos do PostgreSQL, nada", () => {
    expect(pormenorDeMigracao(new Error("outro"))).toBeUndefined();
    expect(pormenorDeMigracao("texto")).toBeUndefined();
    expect(pormenorDeMigracao(null)).toBeUndefined();
  });
});
