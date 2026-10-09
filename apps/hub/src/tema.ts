// O tema do Hub (docs/22 §4, issue #226): «automatico» segue o aparelho
// (prefers-color-scheme); «claro» e «escuro» ganham-lhe. Guarda-se no
// navegador como a língua (preferência, não dado pessoal; docs/22 §5).

export type Tema = "automatico" | "claro" | "escuro";
export const TEMAS: readonly Tema[] = ["automatico", "claro", "escuro"];

const CHAVE = "eurolify-hub-tema";

/** Um valor lido de fora (armazenamento, lista) só vale se for um tema. */
export function lerTema(valor: unknown): Tema {
  return valor === "claro" || valor === "escuro" ? valor : "automatico";
}

export function temaGuardado(): Tema {
  try {
    return lerTema(localStorage.getItem(CHAVE));
  } catch {
    // Sem armazenamento (navegação privada): segue o aparelho.
    return "automatico";
  }
}

/** «Automático» apaga a escolha: o navegador não fica com nada a mais. */
export function guardarTema(tema: Tema) {
  try {
    if (tema === "automatico") localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, tema);
  } catch {
    // Sem armazenamento: vale só nesta página.
  }
}

/**
 * Põe o tema na página: `data-tema` escolhe o bloco de tokens (tokens.css) e
 * `color-scheme` os controlos do próprio navegador.
 */
export function aplicarTema(tema: Tema, raiz: HTMLElement) {
  if (tema === "automatico") {
    delete raiz.dataset.tema;
    raiz.style.colorScheme = "";
  } else {
    raiz.dataset.tema = tema;
    raiz.style.colorScheme = tema === "claro" ? "light" : "dark";
  }
}
