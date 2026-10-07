// O segredo do convite vem depois do `#` da ligação (docs/22 §2): o navegador
// nunca o envia ao servidor. Lê-se uma vez e tira-se da barra de endereço.
// O `replaceState` limpa só a barra e a entrada desta sessão: o histórico do
// navegador guarda o endereço que se abriu, com o segredo (revisão do #158,
// P2-1; o risco que fica está no docs/22 §2).

const FORMATO = /^euc_[A-Za-z0-9_-]{43}$/;

/** O segredo do fragmento (`#euc_…`), ou null se não houver um válido. */
export function segredoDoFragmento(fragmento: string): string | null {
  let valor: string;
  try {
    valor = decodeURIComponent(fragmento.replace(/^#/, "")).trim();
  } catch {
    // Um fragmento mal formado (ex.: `#%E0`) não é um convite (P3-1).
    return null;
  }
  return FORMATO.test(valor) ? valor : null;
}

/** Lê o segredo e tira-o da barra de endereço. */
export function lerSegredoDaLigacao(): string | null {
  const fragmento = window.location.hash;
  if (fragmento !== "") {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }
  return segredoDoFragmento(fragmento);
}

/** A ligação de um convite, para quem convida a enviar. */
export function ligacaoDoConvite(origem: string, segredo: string): string {
  return `${origem}/convite#${segredo}`;
}
