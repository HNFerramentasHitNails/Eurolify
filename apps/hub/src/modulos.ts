import type { Eu } from "./api";
import type { Textos } from "./textos";

// A entrada por módulos (docs/hub-modular-glassmorphism.md, «Primeira
// implementação»). Uma só lista serve a grelha e a pesquisa. Só entram
// destinos que existem; a API decide o acesso em cada página, e esconder um
// módulo não é autorização.

export type Comerciante = Eu["comerciantes"][number];

export type IdModulo =
  "equipa" | "artigos" | "decidir" | "envios" | "faturacao" | "chaves";

export interface Modulo {
  id: IdModulo;
  /**
   * O âmbito que o papel tem de ter no `/hub/me` (docs/22 §13.2), ou uma
   * lista em que basta um (A decidir: ler pelo menos uma fila, docs/22
   * §28.3); null: basta ser membro (a Equipa, `GET /hub/members`).
   */
  ambitoNecessario: string | readonly string[] | null;
  caminho:
    | "/equipa"
    | "/artigos"
    | "/a-decidir"
    | "/envios"
    | "/faturacao"
    | "/chaves";
}

export const MODULOS: readonly Modulo[] = [
  { id: "equipa", ambitoNecessario: null, caminho: "/equipa" },
  { id: "artigos", ambitoNecessario: "catalog:read", caminho: "/artigos" },
  {
    id: "decidir",
    // Os âmbitos que lêem as filas (docs/33 R2): a API filtra as filas.
    ambitoNecessario: [
      "payments:read",
      "invoices:read",
      "customers:read",
      "returns:read",
      "refunds:read",
    ],
    caminho: "/a-decidir",
  },
  // As contas de transportadora (docs/22 §29): os quatro papéis vêem.
  { id: "envios", ambitoNecessario: "shipping:read", caminho: "/envios" },
  {
    id: "faturacao",
    // A ligação ao emissor (`invoices:read`) ou o relatório OSS (`tax:read`):
    // dono, gestor e apoio; o armazém não o vê (docs/22 §30.3).
    ambitoNecessario: ["invoices:read", "tax:read"],
    caminho: "/faturacao",
  },
  { id: "chaves", ambitoNecessario: "keys:write", caminho: "/chaves" },
];

/** Os módulos que o papel neste comerciante oferece, pela ordem fixa. */
export function modulosDe(c: Comerciante): Modulo[] {
  return MODULOS.filter((m) => {
    const a = m.ambitoNecessario;
    if (a === null) return true;
    return typeof a === "string"
      ? c.ambitos.includes(a)
      : a.some((x) => c.ambitos.includes(x));
  });
}

/** O endereço de um módulo, sempre com o comerciante. */
export function destinoDe(m: Modulo, comerciante: string): string {
  return `${m.caminho}?${new URLSearchParams({ comerciante }).toString()}`;
}

/**
 * O endereço da entrada com o comerciante escolhido, para o «Voltar» das
 * páginas de um comerciante não obrigar a escolher outra vez.
 */
export function entradaDe(comerciante: string | null): string {
  return comerciante === null
    ? "/"
    : `/?${new URLSearchParams({ comerciante }).toString()}`;
}

/** Sem maiúsculas, sem acentos e sem espaços nas pontas. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Filtra pelo nome do módulo e pelos termos fixos da língua. */
export function filtrarModulos(
  modulos: readonly Modulo[],
  consulta: string,
  t: Textos,
): Modulo[] {
  const q = normalizar(consulta);
  if (q === "") return [...modulos];
  return modulos.filter((m) =>
    normalizar(`${t[`modulo_${m.id}`]} ${t[`termos_${m.id}`]}`).includes(q),
  );
}

export type Escolha =
  | { tipo: "vazio" }
  | { tipo: "activo"; comerciante: Comerciante }
  | { tipo: "escolher"; desconhecido: boolean };

/**
 * O comerciante activo. O do endereço só vale se estiver na lista do
 * `/hub/me`; sem nenhum no endereço, só se escolhe sozinho quando há um.
 * Entre vários, nunca o primeiro.
 */
export function escolherComerciante(
  comerciantes: readonly Comerciante[],
  pedido: string | null,
): Escolha {
  if (comerciantes.length === 0) return { tipo: "vazio" };
  // `?comerciante=` sem valor conta como nenhum (revisão do #219, P3).
  if (pedido !== null && pedido !== "") {
    const c = comerciantes.find((x) => x.comerciante === pedido);
    return c === undefined
      ? { tipo: "escolher", desconhecido: true }
      : { tipo: "activo", comerciante: c };
  }
  const [unico] = comerciantes;
  return comerciantes.length === 1 && unico !== undefined
    ? { tipo: "activo", comerciante: unico }
    : { tipo: "escolher", desconhecido: false };
}
