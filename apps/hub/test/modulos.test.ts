import { describe, expect, it } from "vitest";
import {
  destinoDe,
  entradaDe,
  escolherComerciante,
  filtrarModulos,
  MODULOS,
  modulosDe,
  normalizar,
  type Comerciante,
} from "../src/modulos";
import { TEXTOS } from "../src/textos";

// A entrada por módulos (docs/hub-modular-glassmorphism.md, «Primeira
// implementação»): só destinos que existem, pelos âmbitos do /hub/me, e o
// comerciante nunca escolhido sozinho entre vários.

// Os âmbitos de cada papel, como a base os dá hoje
// (apps/api/src/identidade/papeis.ts).
const AMBITOS = {
  dono: [
    "catalog:history",
    "catalog:import",
    "catalog:publish",
    "catalog:read",
    "catalog:write",
    "keys:write",
    "merchant:read",
    "merchant:write",
  ],
  gestor: [
    "catalog:history",
    "catalog:import",
    "catalog:publish",
    "catalog:read",
    "catalog:write",
    "merchant:read",
  ],
  armazem: ["catalog:read"],
  apoio: ["catalog:read", "merchant:read"],
} as const;

function comerciante(
  id: string,
  papel: keyof typeof AMBITOS,
  ambitos: readonly string[] = AMBITOS[papel],
): Comerciante {
  return {
    comerciante: id,
    nome: `Loja ${id}`,
    papel,
    membro: `mbr_${id}`,
    ambitos: [...ambitos],
  };
}

const ids = (l: readonly { id: string }[]) => l.map((m) => m.id);

describe("os módulos de cada papel", () => {
  it("o dono vê a equipa, os artigos e as chaves, por esta ordem", () => {
    expect(ids(modulosDe(comerciante("a", "dono")))).toEqual([
      "equipa",
      "artigos",
      "chaves",
    ]);
  });

  it("o gestor, o armazém e o apoio não vêem as chaves", () => {
    for (const papel of ["gestor", "armazem", "apoio"] as const) {
      expect(ids(modulosDe(comerciante("a", papel))), papel).toEqual([
        "equipa",
        "artigos",
      ]);
    }
  });

  it("sem catalog:read, nada de artigos; a equipa basta ser membro", () => {
    expect(ids(modulosDe(comerciante("a", "apoio", [])))).toEqual(["equipa"]);
  });

  it("um âmbito que o Hub não conhece não abre nenhum módulo", () => {
    expect(
      ids(modulosDe(comerciante("a", "apoio", ["catalog:history"]))),
    ).toEqual(["equipa"]);
  });

  it("cada módulo aponta para uma página que existe, nunca debaixo de /hub/", () => {
    for (const m of MODULOS) {
      const destino = destinoDe(m, "mer_1");
      expect(destino.startsWith("/hub/"), m.id).toBe(false);
      expect(["/equipa", "/artigos", "/chaves"]).toContain(
        new URL(destino, "https://h.test").pathname,
      );
      expect(
        new URL(destino, "https://h.test").searchParams.get("comerciante"),
      ).toBe("mer_1");
    }
  });

  it("o comerciante vai codificado no endereço", () => {
    expect(entradaDe("mer_a&b=c")).toBe("/?comerciante=mer_a%26b%3Dc");
    expect(entradaDe(null)).toBe("/");
  });
});

describe("a pesquisa de módulos", () => {
  const todos = modulosDe(comerciante("a", "dono"));

  it("sem nada escrito (ou só espaços), mostra todos", () => {
    expect(ids(filtrarModulos(todos, "", TEXTOS.pt))).toEqual(ids(todos));
    expect(ids(filtrarModulos(todos, "   ", TEXTOS.pt))).toEqual(ids(todos));
  });

  it("ignora maiúsculas, acentos e espaços nas pontas", () => {
    expect(ids(filtrarModulos(todos, "  EQUIPA ", TEXTOS.pt))).toEqual([
      "equipa",
    ]);
    expect(ids(filtrarModulos(todos, "catalogo", TEXTOS.pt))).toEqual([
      "artigos",
    ]);
    expect(normalizar(" Integrações ")).toBe("integracoes");
  });

  it("procura nos termos fixos de cada língua", () => {
    expect(ids(filtrarModulos(todos, "convites", TEXTOS.pt))).toEqual([
      "equipa",
    ]);
    expect(ids(filtrarModulos(todos, "productos", TEXTOS.es))).toEqual([
      "artigos",
    ]);
    expect(ids(filtrarModulos(todos, "keys", TEXTOS.en))).toEqual(["chaves"]);
  });

  it("nunca devolve um módulo que o papel não tem", () => {
    const doApoio = modulosDe(comerciante("a", "apoio"));
    expect(ids(filtrarModulos(doApoio, "chaves", TEXTOS.pt))).toEqual([]);
    expect(ids(filtrarModulos(doApoio, "api", TEXTOS.pt))).toEqual([]);
  });

  it("sem resultados, lista vazia", () => {
    expect(filtrarModulos(todos, "faturas", TEXTOS.pt)).toEqual([]);
  });
});

describe("o comerciante activo", () => {
  const a = comerciante("mer_a", "dono");
  const b = comerciante("mer_b", "apoio");

  it("sem comerciantes, vazio — também com um no endereço", () => {
    expect(escolherComerciante([], null)).toEqual({ tipo: "vazio" });
    expect(escolherComerciante([], "mer_a")).toEqual({ tipo: "vazio" });
  });

  it("com um só, escolhe-o", () => {
    expect(escolherComerciante([a], null)).toEqual({
      tipo: "activo",
      comerciante: a,
    });
  });

  it("com vários e nenhum no endereço, pede a escolha (nunca o primeiro)", () => {
    expect(escolherComerciante([a, b], null)).toEqual({
      tipo: "escolher",
      desconhecido: false,
    });
  });

  it("o do endereço só vale se estiver na lista", () => {
    expect(escolherComerciante([a, b], "mer_b")).toEqual({
      tipo: "activo",
      comerciante: b,
    });
    expect(escolherComerciante([a, b], "mer_x")).toEqual({
      tipo: "escolher",
      desconhecido: true,
    });
    expect(escolherComerciante([a], "mer_x")).toEqual({
      tipo: "escolher",
      desconhecido: true,
    });
  });
});
