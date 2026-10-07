import { describe, expect, it } from "vitest";
import { ErroHub } from "../src/api";
import { mensagemDeErro, semSessao } from "../src/erros";
import { Cancelado } from "../src/passkeys";
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

  it("sem rede, a cancelar a passkey e um erro qualquer", () => {
    expect(mensagemDeErro(erro(0), TEXTOS.pt, "pt").texto).toBe(
      TEXTOS.pt.erroRede,
    );
    expect(mensagemDeErro(new Cancelado(), TEXTOS.pt, "pt").texto).toBe(
      TEXTOS.pt.entrarCancelado,
    );
    expect(mensagemDeErro(new Error("x"), TEXTOS.pt, "pt").texto).toBe(
      TEXTOS.pt.erroGenerico,
    );
  });

  it("um 401 numa rota com sessão manda entrar; outro estado não", () => {
    expect(semSessao(erro(401, "auth.unauthenticated"))).toBe(true);
    expect(semSessao(erro(403, "auth.forbidden"))).toBe(false);
  });
});
