import { describe, expect, it } from "vitest";
import { ErroHub } from "../src/api";
import { mensagemDeErro } from "../src/erros";
import {
  codigoTotpLimpo,
  palavraPasseValida,
  segredoEmGrupos,
} from "../src/palavra-passe";
import { TEXTOS } from "../src/textos";

// A palavra-passe com o TOTP no Hub (docs/22 §9.2): o ecrã só evita pedir o
// que a API recusa; as regras são dela.

describe("a palavra-passe e o código", () => {
  it("12 a 256 caracteres, contados por carácter", () => {
    expect(palavraPasseValida("a".repeat(11))).toBe(false);
    expect(palavraPasseValida("a".repeat(12))).toBe(true);
    expect(palavraPasseValida("a".repeat(256))).toBe(true);
    expect(palavraPasseValida("a".repeat(257))).toBe(false);
    // 12 caracteres com acentos e um emoji contam como 12.
    expect(palavraPasseValida("çãõéíóúâêô😀a")).toBe(true);
  });

  it("o código: 6 algarismos, os espaços copiados saem", () => {
    expect(codigoTotpLimpo("123456")).toBe("123456");
    expect(codigoTotpLimpo("123 456")).toBe("123456");
    expect(codigoTotpLimpo("12345")).toBeNull();
    expect(codigoTotpLimpo("12345a")).toBeNull();
    expect(codigoTotpLimpo("1234567")).toBeNull();
  });

  it("o segredo em grupos de 4", () => {
    expect(segredoEmGrupos("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
    expect(segredoEmGrupos("ABCDEFGH")).toBe("ABCD EFGH");
  });

  it("os erros da palavra-passe têm texto próprio nas três línguas", () => {
    const casos = [
      ["password.invalid_code", "erroCodigoTotpErrado"],
      ["password.not_pending", "erroPalavraPasseNaoPendente"],
      ["password.last_credential", "erroPalavraPasseUltima"],
      ["password.not_found", "erroPalavraPasseNaoExiste"],
    ] as const;
    for (const l of ["pt", "es", "en"] as const) {
      for (const [codigo, chave] of casos) {
        const e = new ErroHub(409, codigo, {}, "r", undefined);
        expect(mensagemDeErro(e, TEXTOS[l], l).texto).toBe(TEXTOS[l][chave]);
      }
    }
  });
});
