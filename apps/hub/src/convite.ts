// O segredo do convite vem depois do `#` da ligação (docs/22 §2): o navegador
// nunca o envia ao servidor. Lê-se uma vez e tira-se da barra de endereço.

const FORMATO = /^euc_[A-Za-z0-9_-]{43}$/;

/** O segredo do fragmento (`#euc_…`), ou null se não houver um válido. */
export function segredoDoFragmento(fragmento: string): string | null {
  const valor = decodeURIComponent(fragmento.replace(/^#/, "")).trim();
  return FORMATO.test(valor) ? valor : null;
}

/** Lê o segredo e apaga-o da barra de endereço e do histórico. */
export function lerSegredoDaLigacao(): string | null {
  const segredo = segredoDoFragmento(window.location.hash);
  if (window.location.hash !== "") {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }
  return segredo;
}

/** A ligação de um convite, para quem convida a enviar. */
export function ligacaoDoConvite(origem: string, segredo: string): string {
  return `${origem}/convite#${segredo}`;
}
