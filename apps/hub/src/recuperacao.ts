// Apoio dos ecrãs de recuperar a conta (docs/22 §9.1).

/**
 * Um código de recuperação escrito como deve ser: só letras, algarismos,
 * espaços e hífenes, e 16 letras ou algarismos. O ecrã envia-o como foi
 * escrito; a API normaliza (maiúsculas; 0, 1 e 8 lidos como O, I e B).
 */
export function codigoBemEscrito(codigo: string): boolean {
  const limpo = codigo.trim();
  return (
    /^[A-Za-z0-9 -]{16,32}$/.test(limpo) &&
    limpo.replace(/[^A-Za-z0-9]/g, "").length === 16
  );
}

// O aviso de depois de recuperar fica até a pessoa o fechar, só neste
// navegador (a API não guarda «visto»). Guarda-se só «há aviso», nunca o
// código nem o e-mail.
const CHAVE = "eurolify-hub-recuperada";

export function marcarRecuperada() {
  try {
    localStorage.setItem(CHAVE, "1");
  } catch {
    // Sem armazenamento: o aviso aparece só agora.
  }
}

export function foiRecuperada(): boolean {
  try {
    return localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

export function fecharAvisoDeRecuperada() {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // Sem armazenamento: nada a apagar.
  }
}
