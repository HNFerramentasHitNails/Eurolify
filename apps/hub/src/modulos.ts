import type { Eu } from "./api";
import type { Textos } from "./textos";

// A entrada por módulos (docs/hub-modular-glassmorphism.md, «Primeira
// implementação»). Uma só lista serve a grelha e a pesquisa. Só entram
// destinos que existem; a API decide o acesso em cada página, e esconder um
// módulo não é autorização.

export type Comerciante = Eu["comerciantes"][number];

export type IdModulo = "equipa" | "artigos" | "chaves";

export interface Modulo {
  id: IdModulo;
  /**
   * O âmbito que o papel tem de ter no `/hub/me` (docs/22 §13.2); null:
   * basta ser membro (a Equipa, `GET /hub/members`).
   */
  ambitoNecessario: string | null;
  caminho: "/equipa" | "/artigos" | "/chaves";
}

export const MODULOS: readonly Modulo[] = [
  { id: "equipa", ambitoNecessario: null, caminho: "/equipa" },
  { id: "artigos", ambitoNecessario: "catalog:read", caminho: "/artigos" },
  { id: "chaves", ambitoNecessario: "keys:write", caminho: "/chaves" },
];

/** Os módulos que o papel neste comerciante oferece, pela ordem fixa. */
export function modulosDe(c: Comerciante): Modulo[] {
  return MODULOS.filter(
    (m) =>
      m.ambitoNecessario === null || c.ambitos.includes(m.ambitoNecessario),
  );
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
