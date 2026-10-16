import { ErroDoSdk } from "./erros.js";
import type { Resposta } from "./tipos.js";

/** O formato das listas da API (docs/18 §2a). */
export interface Pagina<T> {
  dados: T[];
  total?: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}

/**
 * Percorre uma lista por cursor, página a página. `pedir` recebe o que falta
 * juntar à consulta (`{}` na primeira, `{ cursor }` nas seguintes):
 *
 *   paginas((mais) => admin.get("/products", { consulta: { ...mais } }))
 *
 * Nunca corta em silêncio: se a API diz que há mais mas não dá cursor, ou
 * repete um cursor, lança `ErroDoSdk` em vez de devolver a lista incompleta.
 */
export async function* paginas<T>(
  pedir: (mais: { cursor?: string }) => Promise<Resposta<Pagina<T>>>,
  /** Tecto de páginas, para um ciclo nunca ser infinito; por omissão 10 000. */
  maximo = 10_000,
): AsyncGenerator<Pagina<T>> {
  const vistos = new Set<string>();
  let cursor: string | undefined;
  for (let n = 0; n < maximo; n++) {
    const { dados } = await pedir(cursor === undefined ? {} : { cursor });
    yield dados;
    if (!dados.ha_mais) return;
    const seguinte = dados.cursor_seguinte;
    if (
      typeof seguinte !== "string" ||
      seguinte === "" ||
      vistos.has(seguinte)
    ) {
      throw new ErroDoSdk(
        "paginação: a API diz que há mais, mas o cursor falta ou repete-se",
      );
    }
    vistos.add(seguinte);
    cursor = seguinte;
  }
  throw new ErroDoSdk(`paginação: passou o tecto de ${String(maximo)} páginas`);
}

/** Como `paginas`, mas item a item. */
export async function* itens<T>(
  pedir: (mais: { cursor?: string }) => Promise<Resposta<Pagina<T>>>,
  maximo?: number,
): AsyncGenerator<T> {
  for await (const pagina of paginas(pedir, maximo)) {
    yield* pagina.dados;
  }
}
