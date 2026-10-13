import { describe, expect, it } from "vitest";
import { ErroHub } from "../src/api";
import { mensagemDeErro, semSessao } from "../src/erros";
import { Cancelado, JaRegistada } from "../src/passkeys";
import { TEXTOS } from "../src/textos";

// O texto dos erros (docs/22 §3): códigos conhecidos com texto próprio nas
// três línguas; os outros com a mensagem da API e a referência.

const erro = (
  estado: number,
  codigo?: string,
  mensagens: { pt?: string; en?: string } = {},
  esperar?: number,
) => new ErroHub(estado, codigo, mensagens, "req-1", esperar);

describe("as mensagens de erro", () => {
  it("o limite por IP diz quantos segundos faltam", () => {
    expect(
      mensagemDeErro(erro(429, "rate_limit.exceeded", {}, 42), TEXTOS.pt, "pt")
        .texto,
    ).toContain("42");
  });

  it("um código conhecido tem texto próprio em cada língua", () => {
    for (const l of ["pt", "es", "en"] as const) {
      expect(
        mensagemDeErro(erro(400, "invite.invalid"), TEXTOS[l], l).texto,
      ).toBe(TEXTOS[l].erroConviteInvalido);
    }
  });

  it("os erros das passkeys da conta têm texto próprio (docs/22 §9.1)", () => {
    const casos = [
      ["passkey.last_credential", "erroUltimaPasskey"],
      ["passkey.already_registered", "erroPasskeyJaRegistada"],
      ["passkey.not_found", "erroPasskeyNaoExiste"],
    ] as const;
    for (const l of ["pt", "es", "en"] as const) {
      for (const [codigo, chave] of casos) {
        expect(mensagemDeErro(erro(409, codigo), TEXTOS[l], l).texto).toBe(
          TEXTOS[l][chave],
        );
      }
      // Recusada pelo navegador, antes da API: o mesmo texto.
      expect(mensagemDeErro(new JaRegistada(), TEXTOS[l], l).texto).toBe(
        TEXTOS[l].erroPasskeyJaRegistada,
      );
    }
  });

  it("um código desconhecido usa a mensagem da API e mostra a referência; em espanhol, a genérica", () => {
    const e = erro(409, "x.y", { pt: "Mensagem pt", en: "Message en" });
    expect(mensagemDeErro(e, TEXTOS.pt, "pt")).toEqual({
      texto: "Mensagem pt",
      referencia: "req-1",
    });
    expect(mensagemDeErro(e, TEXTOS.en, "en").texto).toBe("Message en");
    expect(mensagemDeErro(e, TEXTOS.es, "es").texto).toBe(
      TEXTOS.es.erroGenerico,
    );
  });

  it("os códigos dos ecrãs têm texto próprio em espanhol (revisão do #158, P2-3)", () => {
    for (const codigo of [
      "invite.used",
      "invite.not_found",
      "invite.invalid_email",
      "invite.email_not_allowed",
      "invite.invalid_role",
      "member.merchant_inactive",
      "auth.reauthentication_required",
      "auth.busy",
      "auth.origin_rejected",
    ]) {
      expect(
        mensagemDeErro(erro(409, codigo), TEXTOS.es, "es").texto,
        codigo,
      ).not.toBe(TEXTOS.es.erroGenerico);
    }
  });

  it("sem rede, a cancelar a passkey e um erro qualquer", () => {
    expect(mensagemDeErro(erro(0), TEXTOS.pt, "pt").texto).toBe(
      TEXTOS.pt.erroRede,
    );
    expect(mensagemDeErro(new Cancelado(), TEXTOS.pt, "pt")).toEqual({
      texto: TEXTOS.pt.entrarCancelado,
      neutro: true,
    });
    expect(mensagemDeErro(new Error("x"), TEXTOS.pt, "pt").texto).toBe(
      TEXTOS.pt.erroGenerico,
    );
  });

  it("um 401 numa rota com sessão manda entrar; outro estado não", () => {
    expect(semSessao(erro(401, "auth.unauthenticated"))).toBe(true);
    expect(semSessao(erro(403, "auth.forbidden"))).toBe(false);
  });
});
