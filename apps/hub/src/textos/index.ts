import { en } from "./en";
import { es } from "./es";
import { pt, type Textos } from "./pt";

export type Lingua = "pt" | "es" | "en";
export const LINGUAS: readonly Lingua[] = ["pt", "es", "en"];
export const NOMES_LINGUAS: Record<Lingua, string> = {
  pt: "Português",
  es: "Español",
  en: "English",
};
export const TAG_LINGUA: Record<Lingua, string> = {
  pt: "pt-PT",
  es: "es-ES",
  en: "en",
};
export const TEXTOS: Record<Lingua, Textos> = { pt, es, en };
export type { Textos };

/** Troca `{nome}` pelos valores. */
export function preencher(
  texto: string,
  valores: Record<string, string | number>,
): string {
  return texto.replace(/\{(\w+)\}/g, (inteiro, chave: string) =>
    chave in valores ? String(valores[chave]) : inteiro,
  );
}

const CHAVE = "eurolify-hub-lingua";

/** A língua guardada (preferência, não dado pessoal; docs/22 §5). */
export function linguaGuardada(): Lingua {
  try {
    const v = localStorage.getItem(CHAVE);
    if (v === "pt" || v === "es" || v === "en") return v;
  } catch {
    // Sem armazenamento (navegação privada): fica o português.
  }
  return "pt";
}

export function guardarLingua(l: Lingua) {
  try {
    localStorage.setItem(CHAVE, l);
  } catch {
    // Sem armazenamento: vale só nesta página.
  }
}
