// Como um valor que veio de fora (registo ou pedido) se lê e aparece numa
// mensagem, sem nunca lançar (revisões do #50): um Symbol, um objecto sem
// protótipo, um toString que lança ou um Proxy revogado não rebentam a lista
// de erros nem a decisão — ficam listados ou recusados.
//
// Limite, escrito: um Proxy vivo cujas armadilhas lançam (por exemplo, numa
// leitura de propriedade) continua a rebentar. Não vem de JSON nem da base, e
// protegê-lo obrigava a envolver cada leitura do registo.

/**
 * É uma lista? Sem estreitar o tipo (o `Array.isArray` sobre uma lista só de
 * leitura dá `any[]`). Um Proxy revogado lança no `Array.isArray`: conta
 * como não.
 */
export function ehLista(v: unknown): boolean {
  try {
    return Array.isArray(v);
  } catch {
    return false;
  }
}

/**
 * É um objecto que se consegue ler (não null)? Sem estreitar o tipo. Um Proxy
 * revogado tem `typeof` «object» mas lança em qualquer leitura: conta como
 * não (revisão do #50, P2-1 da nona volta).
 */
export function ehObjecto(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  try {
    Reflect.ownKeys(v);
    return true;
  } catch {
    return false;
  }
}

/** O nome do tipo de um valor, em português. */
export function tipo(v: unknown): string {
  if (v === null) return "nulo";
  if (ehLista(v)) return "lista";
  switch (typeof v) {
    case "string":
      return "texto";
    case "number":
      return "número";
    case "boolean":
      return "booleano";
    case "bigint":
      return "bigint";
    case "symbol":
      return "símbolo";
    case "undefined":
      return "indefinido";
    case "function":
      return "função";
    default:
      return "objecto";
  }
}

/**
 * Texto tal como é; número, booleano, null, undefined, bigint e Symbol pelo
 * seu texto; listas, objectos e funções só pelo tipo, entre parênteses.
 */
export function valor(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "symbol") return v.toString();
  if (typeof v === "function" || (typeof v === "object" && v !== null)) {
    return `(${tipo(v)})`;
  }
  return String(v);
}
