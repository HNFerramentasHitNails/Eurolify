import { afterEach, describe, expect, it, vi } from "vitest";
import { ErroHub } from "../src/api";
import {
  ErroDoEcra,
  falhaDeAccao,
  mensagemDeErro,
  PasskeyNaoAceite,
} from "../src/erros";
import {
  ReautenticacaoPorFazer,
  RecuperacaoNaoConcluida,
} from "../src/passkeys";
import { TEXTOS } from "../src/textos";

// Um 401 numa acção nem sempre é «sem sessão» (revisão do #174, P1-1): a API
// dá-o também a uma passkey recusada ou a um desafio fora de prazo, com a
// sessão ainda válida. Confirma-se com o /hub/me antes de mandar para Entrar.

const naoAutenticado = () =>
  new ErroHub(401, "auth.unauthenticated", {}, "req-1", undefined);

function respostaDoEu(estado: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            estado === 200
              ? {
                  pessoa: "per_x",
                  nome: "Ana",
                  email: "a@b.test",
                  comerciantes: [],
                }
              : { codigo: "auth.unauthenticated" },
          ),
          { status: estado, headers: { "content-type": "application/json" } },
        ),
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("o erro de uma acção", () => {
  it("um 401 com a sessão ainda aberta não tira a pessoa da conta: a passkey não foi aceite", async () => {
    respostaDoEu(200);
    const r = await falhaDeAccao(naoAutenticado());
    expect(r).toBeInstanceOf(PasskeyNaoAceite);
    expect(mensagemDeErro(r, TEXTOS.pt, "pt").texto).toBe(
      TEXTOS.pt.erroPasskeyNaoAceite,
    );
  });

  it("um 401 com a sessão acabada manda para Entrar (null)", async () => {
    respostaDoEu(401);
    expect(await falhaDeAccao(naoAutenticado())).toBeNull();
  });

  it("sem rede ao confirmar, fica na página com o erro da rede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("rede"))),
    );
    const r = await falhaDeAccao(naoAutenticado());
    expect(r).toBeInstanceOf(ErroHub);
    expect((r as ErroHub).estado).toBe(0);
  });

  it("outro erro passa como está, sem perguntar ao /hub/me", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const e = new ErroHub(409, "passkey.last_credential", {}, "r", undefined);
    expect(await falhaDeAccao(e)).toBe(e);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("os erros do ecrã e do segundo passo da recuperação têm texto próprio nas três línguas", () => {
    for (const l of ["pt", "es", "en"] as const) {
      expect(
        mensagemDeErro(new ErroDoEcra("erroCodigo"), TEXTOS[l], l).texto,
      ).toBe(TEXTOS[l].erroCodigo);
      expect(
        mensagemDeErro(new RecuperacaoNaoConcluida(), TEXTOS[l], l).texto,
      ).toBe(TEXTOS[l].erroRecuperarPasskey);
    }
  });

  it("sem reautenticação possível com passkey, diz que entre outra vez, sem vermelho (revisão do #177, P2-1)", () => {
    for (const l of ["pt", "es", "en"] as const) {
      expect(
        mensagemDeErro(new ReautenticacaoPorFazer(), TEXTOS[l], l),
      ).toEqual({ texto: TEXTOS[l].erroReautenticar, neutro: true });
    }
  });
});
