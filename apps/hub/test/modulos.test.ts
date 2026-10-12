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
import { AMBITOS_DO_PAPEL } from "../../api/src/identidade/papeis";
import { FILAS } from "../../api/src/tarefas/filas";

// A entrada por módulos (docs/hub-modular-glassmorphism.md, «Primeira
// implementação»): só destinos que existem, pelos âmbitos do /hub/me, e o
// comerciante nunca escolhido sozinho entre vários.

// Os âmbitos de cada papel, da mesma lista da API (a base tem uma igual e
// o teste da API confere-as): se os papéis mudarem lá, este teste vê-o
// (revisão do #219, P2-6).
const AMBITOS = AMBITOS_DO_PAPEL;

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
  it("o dono vê a equipa, os artigos, «A decidir», a faturação e as chaves, por esta ordem", () => {
    expect(ids(modulosDe(comerciante("a", "dono")))).toEqual([
      "equipa",
      "artigos",
      "decidir",
      "faturacao",
      "chaves",
    ]);
  });

  it("o gestor e o apoio vêem a faturação e não as chaves; o armazém, nenhuma das duas (docs/22 §29.3)", () => {
    for (const papel of ["gestor", "apoio"] as const) {
      expect(ids(modulosDe(comerciante("a", papel))), papel).toEqual([
        "equipa",
        "artigos",
        "decidir",
        "faturacao",
      ]);
    }
    expect(ids(modulosDe(comerciante("a", "armazem")))).toEqual([
      "equipa",
      "artigos",
      "decidir",
    ]);
  });

  it("a faturação basta invoices:read ou tax:read", () => {
    expect(ids(modulosDe(comerciante("a", "apoio", ["tax:read"])))).toEqual([
      "equipa",
      "faturacao",
    ]);
    expect(
      ids(modulosDe(comerciante("a", "apoio", ["invoices:read"]))),
    ).toEqual(["equipa", "decidir", "faturacao"]);
  });

  it("«A decidir» pede os âmbitos que lêem as filas na régua da API (revisão do #396, P3-5)", () => {
    const decidir = MODULOS.find((m) => m.id === "decidir");
    const daApi = [...new Set(Object.values(FILAS).map((f) => f.ler))].sort();
    const pede = decidir?.ambitoNecessario;
    expect(Array.isArray(pede)).toBe(true);
    expect(Array.isArray(pede) ? [...(pede as string[])].sort() : []).toEqual(
      daApi,
    );
  });

  it("«A decidir» basta ler uma fila (docs/22 §28.3); sem nenhuma, não aparece", () => {
    expect(
      ids(modulosDe(comerciante("a", "armazem", ["returns:read"]))),
    ).toEqual(["equipa", "decidir"]);
    expect(
      ids(modulosDe(comerciante("a", "armazem", ["catalog:read"]))),
    ).toEqual(["equipa", "artigos"]);
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
      expect([
        "/equipa",
        "/artigos",
        "/a-decidir",
        "/faturacao",
        "/chaves",
      ]).toContain(new URL(destino, "https://h.test").pathname);
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
    expect(filtrarModulos(todos, "transportadoras", TEXTOS.pt)).toEqual([]);
  });
});

describe("o comerciante activo", () => {
  const a = comerciante("mer_a", "dono");
  const b = comerciante("mer_b", "apoio");

  it("sem comerciantes, vazio — também com um no endereço", () => {
    expect(escolherComerciante([], null)).toEqual({ tipo: "vazio" });
    expect(escolherComerciante([], "mer_a")).toEqual({ tipo: "vazio" });
  });

  it("com um só, escolhe-o — também com ?comerciante= vazio", () => {
    expect(escolherComerciante([a], null)).toEqual({
      tipo: "activo",
      comerciante: a,
    });
    expect(escolherComerciante([a], "")).toEqual({
      tipo: "activo",
      comerciante: a,
    });
    expect(escolherComerciante([a, b], "")).toEqual({
      tipo: "escolher",
      desconhecido: false,
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
