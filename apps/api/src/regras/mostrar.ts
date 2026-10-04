// Como um valor que veio de fora (registo ou pedido) aparece numa mensagem,
// sem nunca lançar (revisões do #50, P2-A e P2-3): um Symbol, um objecto sem
// protótipo, um toString que lança ou um Proxy revogado não rebentam a lista
// de erros nem a decisão.

/** É uma lista? Um Proxy revogado lança no Array.isArray: conta como não. */
function ehLista(v: unknown): boolean {
  try {
    return Array.isArray(v);
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
