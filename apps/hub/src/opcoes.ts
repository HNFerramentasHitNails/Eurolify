// As opções do artigo na ficha (docs/22 §20.2): uma coluna por opção na
// tabela das variantes, com o valor de cada variante, e uma linha com as
// opções e os valores todos por cima. A API do Hub dá, em cada valor, as
// variantes que o têm (§20.1); aqui só se lê essa resposta.

/** Uma opção do artigo (GET /hub/products/{id}/options). */
export interface OpcaoArtigo {
  id: string;
  nome: string;
  posicao: number;
  /** Sobe com cada mudança à opção ou aos valores; as escritas pedem-na. */
  versao: number;
  valores: { id: string; valor: string; variantes: string[] }[];
}

/**
 * O valor da variante nesta opção, ou nulo se não tem nenhum (um rascunho
 * incompleto, docs/14 §3.3): o ecrã mostra «—».
 */
export function valorDaVariante(
  opcao: OpcaoArtigo,
  variante: string,
): string | null {
  return (
    opcao.valores.find((v) => v.variantes.includes(variante))?.valor ?? null
  );
}

/**
 * A linha por cima da tabela, sem o rótulo: «Tamanho (15 ml, 30 ml) · Cor
 * (Azul, Rosa)», com os valores todos pela ordem, também os que nenhuma
 * variante usa. Vazia num artigo sem opções (o ecrã não a mostra).
 */
export function linhaDasOpcoes(opcoes: OpcaoArtigo[]): string {
  return opcoes
    .map((o) => `${o.nome} (${o.valores.map((v) => v.valor).join(", ")})`)
    .join(" · ");
}

// A escrita das opções (docs/22 §21.3): o que o ecrã calcula para pedir à
// API. As regras (rascunho, repetidos, combinações) decide-as a API.

/** A ordem dos ids com o da posição `i` trocado com o vizinho (`passo` ±1). */
export function moverNaLista(
  ids: readonly string[],
  i: number,
  passo: -1 | 1,
): string[] | null {
  const j = i + passo;
  if (i < 0 || i >= ids.length || j < 0 || j >= ids.length) return null;
  const nova = [...ids];
  const a = nova[i];
  const b = nova[j];
  if (a === undefined || b === undefined) return null;
  nova[i] = b;
  nova[j] = a;
  return nova;
}

/** O tamanho máximo do nome de uma opção e de um valor (docs/14 §3.3). */
export const MAXIMO_TEXTO_OPCAO = 100;

/**
 * Os valores de «Criar opção», um por linha: sem os espaços nas pontas, sem
 * as linhas vazias e sem os exactamente iguais (o pedido recusava-os com um
 * erro genérico; revisão do #297, P3-2). Os iguais sem distinguir
 * maiúsculas recusa-os a API, com o texto dela.
 */
export function valoresDoTexto(texto: string): string[] {
  return [
    ...new Set(
      texto
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== ""),
    ),
  ];
}

/** As variantes activas que têm um valor nesta opção. */
export function variantesComValor(
  opcao: OpcaoArtigo,
  variantes: { id: string; estado: string }[],
): string[] {
  return variantes
    .filter((v) => v.estado === "activa")
    .filter((v) => valorDaVariante(opcao, v.id) !== null)
    .map((v) => v.id);
}

/**
 * As variantes activas a que falta um valor em alguma opção (num rascunho
 * pode faltar; activar recusa, docs/14 §3.3). Sem opções, nenhuma.
 */
export function variantesIncompletas(
  opcoes: OpcaoArtigo[],
  variantes: { id: string; estado: string }[],
): string[] {
  return variantes
    .filter((v) => v.estado === "activa")
    .filter((v) => opcoes.some((o) => valorDaVariante(o, v.id) === null))
    .map((v) => v.id);
}
