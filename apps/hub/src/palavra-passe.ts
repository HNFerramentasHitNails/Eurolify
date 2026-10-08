// Apoio dos ecrãs da palavra-passe com o TOTP (docs/22 §9.2). As regras são
// da API (12 a 256 caracteres; o código de 6 algarismos); aqui só se evita
// pedir o que vai ser recusado. A palavra-passe vai como foi escrita.

/** 12 a 256 caracteres, contados como a API os conta (por carácter). */
export function palavraPasseValida(palavra: string): boolean {
  // Por ponto de código, como o validador da API (não por unidade UTF-16).
  const n = Array.from(palavra).length;
  return n >= 12 && n <= 256;
}

/** O código como a API o quer: 6 algarismos, sem os espaços que se copiam. */
export function codigoTotpLimpo(codigo: string): string | null {
  const limpo = codigo.replace(/\s/g, "");
  return /^[0-9]{6}$/.test(limpo) ? limpo : null;
}

/** O segredo em grupos de 4, para se escrever à mão sem se perder. */
export const segredoEmGrupos = (segredo: string) =>
  segredo.replace(/(.{4})(?=.)/g, "$1 ");
