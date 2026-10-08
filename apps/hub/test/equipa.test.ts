import { describe, expect, it } from "vitest";
import { ErroHub } from "../src/api";
import { mensagemDeErro } from "../src/erros";
import { TEXTOS } from "../src/textos";

// A gestão da equipa e o convite com uma conta que já existe (docs/22 §10):
// as recusas da base têm texto próprio nas três línguas.

describe("os erros da gestão da equipa", () => {
  it("cada recusa tem texto próprio em cada língua", () => {
    const casos = [
      ["member.last_owner", "erroUltimoDono"],
      ["member.self_role_change", "erroProprioPapel"],
      ["member.not_found", "erroMembroNaoExiste"],
      ["invite.other_person", "erroConviteOutraPessoa"],
      ["invite.already_member", "erroJaMembro"],
    ] as const;
    for (const l of ["pt", "es", "en"] as const) {
      for (const [codigo, chave] of casos) {
        const e = new ErroHub(409, codigo, {}, "r", undefined);
        expect(mensagemDeErro(e, TEXTOS[l], l).texto).toBe(TEXTOS[l][chave]);
      }
    }
  });
});
