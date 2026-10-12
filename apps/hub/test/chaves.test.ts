import { describe, expect, it } from "vitest";
import { AMBITOS_SERVIDOR, ErroHub, type ChaveApi } from "../src/api";
import { autorDe, chavesAPropor, estadoDaChave, fimDoDia } from "../src/chaves";
import { rotuloDoAmbito } from "../src/ecras/Chaves";
import { mensagemDeErro } from "../src/erros";
import { TEXTOS } from "../src/textos";

// O ecrã das chaves de API (docs/22 §9.3): só apresenta o que a API decide.

const chave = (mais: Partial<ChaveApi> = {}): ChaveApi => ({
  id: "key_1",
  tipo: "servidor",
  loja: null,
  nome: "Integração",
  ambitos: ["catalog:read"],
  prefixo: "eul_sk_abcd",
  criada_por: "pessoa:per_a",
  criada_em: "2026-10-01T10:00:00Z",
  expira_em: null,
  revogada_em: null,
  revogada_por: null,
  ultimo_uso_em: null,
  agente_ia: false,
  ...mais,
});

describe("as chaves de API no Hub", () => {
  const agora = new Date("2026-10-08T12:00:00Z");

  it("o estado: activa, revogada (mesmo com prazo) ou expirada", () => {
    expect(estadoDaChave(chave(), agora)).toEqual({ estado: "activa" });
    expect(
      estadoDaChave(chave({ expira_em: "2026-10-09T00:00:00Z" }), agora),
    ).toEqual({ estado: "activa" });
    expect(
      estadoDaChave(chave({ expira_em: "2026-10-08T11:59:59Z" }), agora),
    ).toEqual({ estado: "expirada", em: "2026-10-08T11:59:59Z" });
    expect(
      estadoDaChave(
        chave({
          revogada_em: "2026-10-02T10:00:00Z",
          expira_em: "2026-10-03T00:00:00Z",
        }),
        agora,
      ),
    ).toEqual({ estado: "revogada", em: "2026-10-02T10:00:00Z" });
  });

  it("quem criou: você, um membro, alguém que saiu, outra chave, o operador", () => {
    const membros = [
      {
        membro: "mbr_b",
        pessoa: "per_b",
        nome: "Rui",
        email: "rui@exemplo.test",
        papel: "gestor" as const,
        desde: "2026-10-01T10:00:00Z",
      },
    ];
    const chaves = [chave({ id: "key_9", nome: "Mãe" })];
    expect(autorDe("pessoa:per_a", "per_a", membros, chaves)).toEqual({
      autor: "voce",
    });
    expect(autorDe("pessoa:per_b", "per_a", membros, chaves)).toEqual({
      autor: "membro",
      nome: "Rui",
    });
    expect(autorDe("pessoa:per_z", "per_a", membros, chaves)).toEqual({
      autor: "antigo",
    });
    expect(autorDe("chave:key_9", "per_a", membros, chaves)).toEqual({
      autor: "chave",
      nome: "Mãe",
    });
    expect(autorDe("chave:key_0", "per_a", membros, chaves)).toEqual({
      autor: "chave",
      nome: null,
    });
    expect(autorDe("operador:github:1001", "per_a", membros, chaves)).toEqual({
      autor: "operador",
    });
    // Outro formato: não se afirma que a pessoa saiu (revisão do #183, P3-3).
    expect(autorDe("migracao inicial", "per_a", membros, chaves)).toEqual({
      autor: "desconhecido",
    });
  });

  it("expira no fim do dia escolhido; uma data que não existe é recusada", () => {
    const fim = fimDoDia("2026-12-31");
    expect(fim).not.toBeNull();
    const d = new Date(fim ?? "");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([
      2026, 11, 31, 23,
    ]);
    expect(fimDoDia("2026-02-30")).toBeNull();
    expect(fimDoDia("31/12/2026")).toBeNull();
    expect(fimDoDia("")).toBeNull();
  });

  it("cada âmbito tem rótulo nas três línguas, também os dos preços e do histórico (docs/22 §26.3)", () => {
    const conhecidos = [
      ...AMBITOS_SERVIDOR,
      "storefront",
      "catalog:history",
      "prices:read",
      "prices:write",
      "prices:history",
    ];
    for (const l of ["pt", "es", "en"] as const) {
      for (const a of conhecidos) {
        const rotulo = rotuloDoAmbito(TEXTOS[l], a);
        expect(rotulo, `${l} ${a}`).toBeTruthy();
        expect(rotulo, `${l} ${a}`).not.toBe(a);
      }
    }
    // Um âmbito que o ecrã não conhece sai com o nome técnico, nunca vazio.
    expect(rotuloDoAmbito(TEXTOS.pt, "orders:read")).toBe("orders:read");
  });

  it("os erros das chaves têm texto próprio nas três línguas", () => {
    const casos = [
      ["key.scope_escalation", "erroChaveAmbitosAMais"],
      ["key.merchant_inactive", "erroChaveComercianteInactivo"],
      ["key.not_found", "erroChaveNaoExiste"],
      ["key.already_revoked", "erroChaveJaRevogada"],
      ["key.last_key_writer", "erroChaveUltimaGestora"],
      ["key.invalid_expiry", "erroChaveExpira"],
    ] as const;
    for (const l of ["pt", "es", "en"] as const) {
      for (const [codigo, texto] of casos) {
        const e = new ErroHub(409, codigo, {}, "r", undefined);
        expect(mensagemDeErro(e, TEXTOS[l], l).texto).toBe(TEXTOS[l][texto]);
      }
    }
  });
});

describe("as chaves a propor depois de recuperar a conta (docs/22 §22; DC)", () => {
  const agora = new Date("2026-10-10T12:00:00Z");
  it("só as activas criadas por esta pessoa, da mais nova para a mais antiga", () => {
    const lista = [
      chave({ id: "key_velha", criada_em: "2026-10-01T10:00:00Z" }),
      chave({ id: "key_nova", criada_em: "2026-10-09T10:00:00Z" }),
      chave({ id: "key_outra", criada_por: "pessoa:per_b" }),
      chave({ id: "key_operador", criada_por: "operador:github:1" }),
      chave({ id: "key_chave", criada_por: "chave:key_x" }),
      chave({ id: "key_revogada", revogada_em: "2026-10-05T10:00:00Z" }),
      chave({ id: "key_expirada", expira_em: "2026-10-10T11:00:00Z" }),
      chave({ id: "key_prazo", expira_em: "2026-10-11T00:00:00Z" }),
    ];
    expect(chavesAPropor(lista, "per_a", agora).map((c) => c.id)).toEqual([
      "key_nova",
      "key_velha",
      "key_prazo",
    ]);
  });
  it("um prefixo parecido não conta como a mesma pessoa", () => {
    expect(
      chavesAPropor([chave({ criada_por: "pessoa:per_ab" })], "per_a", agora),
    ).toEqual([]);
  });
});
