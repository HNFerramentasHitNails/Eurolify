import type { ChaveApi, Membros } from "./api";

// Apoio do ecrã das chaves de API (docs/22 §9.3): o estado de cada chave e
// quem a criou, em linguagem comum. A API decide tudo; isto só apresenta.

export type EstadoChave =
  | { estado: "activa" }
  | { estado: "revogada"; em: string }
  | { estado: "expirada"; em: string };

export function estadoDaChave(c: ChaveApi, agora: Date): EstadoChave {
  if (c.revogada_em !== null) return { estado: "revogada", em: c.revogada_em };
  if (c.expira_em !== null && new Date(c.expira_em) <= agora) {
    return { estado: "expirada", em: c.expira_em };
  }
  return { estado: "activa" };
}

export type Autor =
  | { autor: "voce" }
  | { autor: "membro"; nome: string }
  | { autor: "antigo" }
  | { autor: "chave"; nome: string | null }
  | { autor: "operador" }
  | { autor: "desconhecido" };

/** Quem criou uma chave: `pessoa:per_…`, `chave:key_…`, `operador:…`. */
export function autorDe(
  texto: string,
  eu: string,
  membros: Membros["membros"],
  chaves: readonly ChaveApi[],
): Autor {
  if (texto.startsWith("operador:")) return { autor: "operador" };
  if (texto.startsWith("pessoa:")) {
    const pessoa = texto.slice("pessoa:".length);
    if (pessoa === eu) return { autor: "voce" };
    const m = membros.find((x) => x.pessoa === pessoa);
    return m === undefined
      ? { autor: "antigo" }
      : { autor: "membro", nome: m.nome };
  }
  if (texto.startsWith("chave:")) {
    const id = texto.slice("chave:".length);
    return {
      autor: "chave",
      nome: chaves.find((c) => c.id === id)?.nome ?? null,
    };
  }
  // Outro formato (texto livre na base): não se afirma quem foi (revisão do
  // #183, P3-3).
  return { autor: "desconhecido" };
}

/**
 * O fim do dia escolhido (hora de quem escolhe), em ISO: «expira a 31/12»
 * vale até ao fim desse dia. `null` se a data não for válida.
 */
export function fimDoDia(data: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (m === null) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  if (
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() !== Number(m[2]) - 1 ||
    d.getDate() !== Number(m[3])
  ) {
    return null;
  }
  return d.toISOString();
}

/**
 * As chaves a propor revogar depois de recuperar a conta (docs/22 §22;
 * `docs/06`, DC): as activas que esta pessoa criou, da mais nova para a mais
 * antiga. Só se propõem; quem revoga é a pessoa, uma a uma.
 */
export function chavesAPropor(
  chaves: readonly ChaveApi[],
  pessoa: string,
  agora: Date,
): ChaveApi[] {
  return chaves
    .filter(
      (c) =>
        c.criada_por === `pessoa:${pessoa}` &&
        estadoDaChave(c, agora).estado === "activa",
    )
    .sort((a, b) => b.criada_em.localeCompare(a.criada_em));
}
