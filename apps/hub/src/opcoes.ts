// As opções do artigo na ficha (docs/22 §20.2): uma coluna por opção na
// tabela das variantes, com o valor de cada variante, e uma linha com as
// opções e os valores todos por cima. A API do Hub dá, em cada valor, as
// variantes que o têm (§20.1); aqui só se lê essa resposta.

/** Uma opção do artigo (GET /hub/products/{id}/options). */
export interface OpcaoArtigo {
  id: string;
  nome: string;
  posicao: number;
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
