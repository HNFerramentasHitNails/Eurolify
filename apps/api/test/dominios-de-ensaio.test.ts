import { describe, expect, it } from "vitest";
import {
  DOMINIO_DE_TESTE,
  emailAceiteNoConviteDoHub,
} from "../src/identidade/dominios-de-ensaio.js";
import { lerPedido } from "../src/identidade/operador.js";

// A rede temporária dos convites no ensaio (ADR-0019; Diogo, 13/10/2026).

describe("os endereços aceites nos convites do ensaio", () => {
  it("o Hub aceita os domínios de teste e só o domínio exacto da empresa", () => {
    for (const e of [
      "ana@loja.test",
      "ana@exemplo.test",
      "ana@x.example",
      "ana@x.invalid",
      "ana@example.com",
      "avisos@eurolify.eu",
      "  AVISOS@EUROLIFY.EU ",
    ]) {
      expect(emailAceiteNoConviteDoHub(e), e).toBe(true);
    }
    for (const e of [
      "maria.silva@gmail.com",
      "ana@eurolify.eu.exemplo.com",
      "ana@sub.eurolify.eu",
      "ana@eurolify.eu.",
      "ana@xeurolify.eu",
      "ana@test.pt",
      "ana@loja.test.pt",
      "a b@eurolify.eu",
      "@eurolify.eu",
      // Dois «@» ou um espaço (revisão do #417, P2-1).
      "maria@gmail.com@x.test",
      "maria@gmail.com@eurolify.eu",
      "a b@loja.test",
      "a@b@loja.test",
    ]) {
      expect(emailAceiteNoConviteDoHub(e), e).toBe(false);
    }
  });

  it("o operador continua só com os domínios de teste", () => {
    expect(DOMINIO_DE_TESTE.test("avisos@eurolify.eu")).toBe(false);
    const email = Buffer.from("avisos@eurolify.eu").toString("base64url");
    expect(() =>
      lerPedido(
        `convite 01234567-89ab-cdef-0123-456789abcdef ${email} dono ${"a".repeat(64)} github:1`,
      ),
    ).toThrow(/domínio reservado para testes/);
  });
});
