import { describe, expect, it } from "vitest";
import { codigoBemEscrito } from "../src/recuperacao";

// O código de recuperação confere-se no ecrã antes de pedir a passkey
// (docs/22 §9.1); a API normaliza o resto e é ela que decide.

describe("o código de recuperação escrito", () => {
  it("aceita o formato dos códigos e as formas que a API normaliza", () => {
    for (const c of [
      "ABCD-EFGH-IJKL-MNOP",
      "abcd-efgh-ijkl-mnop",
      "ABCDEFGHIJKLMNOP",
      "ABCD EFGH IJKL MNOP",
      " ABCD-EFGH-IJKL-MN0P ",
    ]) {
      expect(codigoBemEscrito(c), c).toBe(true);
    }
  });

  it("recusa um código curto, longo ou com outros caracteres", () => {
    for (const c of [
      "",
      "ABCD-EFGH-IJKL-MNO",
      "ABCD-EFGH-IJKL-MNOPQ",
      "ABCD-EFGH-IJKL-MNO!",
      "ABCD_EFGH_IJKL_MNOP",
      "----------------",
    ]) {
      expect(codigoBemEscrito(c), c).toBe(false);
    }
  });
});
