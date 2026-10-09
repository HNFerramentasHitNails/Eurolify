// Como se mostra o canal e o mercado de cada publicação na ficha (docs/22
// §18.2 e §19.2). O nome basta quando não se repete; quando outro canal
// (mercado) da mesma tabela tem o mesmo nome, junta-se a loja por baixo, e
// o identificador quando nem a loja os distingue. Cada coluna à parte.

/** O que uma linha da tabela traz para esta decisão. */
export interface LinhaDePublicacao {
  canal: string;
  mercado: string;
  canal_nome: string | null;
  mercado_nome: string | null;
  loja_nome: string | null;
}

/** O que a célula mostra: o nome e, por baixo, o que o distingue. */
export type Celula =
  | { tipo: "identificador"; identificador: string }
  | { tipo: "nome"; nome: string }
  | { tipo: "nome_e_loja"; nome: string; loja: string }
  | { tipo: "nome_e_identificador"; nome: string; identificador: string };

function celula(
  linhas: LinhaDePublicacao[],
  p: LinhaDePublicacao,
  id: (l: LinhaDePublicacao) => string,
  nome: (l: LinhaDePublicacao) => string | null,
): Celula {
  const n = nome(p);
  if (n === null) return { tipo: "identificador", identificador: id(p) };
  // Os outros canais (mercados) da tabela com o mesmo nome. A comparação
  // ignora os espaços nas pontas: à vista, «Loja online» e «Loja online »
  // são iguais (a base não os tira; revisão do #275, P3-2).
  const igual = (a: string | null, b: string | null) =>
    a !== null && b !== null && a.trim() === b.trim();
  const iguais = linhas.filter((l) => igual(nome(l), n) && id(l) !== id(p));
  if (iguais.length === 0) return { tipo: "nome", nome: n };
  const loja = p.loja_nome;
  if (loja !== null && iguais.every((l) => !igual(l.loja_nome, loja))) {
    return { tipo: "nome_e_loja", nome: n, loja };
  }
  return { tipo: "nome_e_identificador", nome: n, identificador: id(p) };
}

/** A célula do canal de uma publicação, olhando para a tabela toda. */
export function celulaDoCanal(
  linhas: LinhaDePublicacao[],
  p: LinhaDePublicacao,
): Celula {
  return celula(
    linhas,
    p,
    (l) => l.canal,
    (l) => l.canal_nome,
  );
}

/** A célula do mercado de uma publicação, olhando para a tabela toda. */
export function celulaDoMercado(
  linhas: LinhaDePublicacao[],
  p: LinhaDePublicacao,
): Celula {
  return celula(
    linhas,
    p,
    (l) => l.mercado,
    (l) => l.mercado_nome,
  );
}
