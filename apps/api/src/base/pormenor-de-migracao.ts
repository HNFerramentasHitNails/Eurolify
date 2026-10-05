// O que se pode escrever no registo da publicação quando uma migração falha
// (revisão do #80, 2.ª, P2-A). O `detail` do PostgreSQL pode trazer linhas
// inteiras («Failing row contains (…)»), com dados pessoais, e o registo vai
// para o GitHub: escrevem-se só os nomes (código, esquema, tabela, coluna,
// restrição), nunca valores. Excepção: as restrições desta lista, cujo
// pormenor só tem identificadores do catálogo (comerciante e SKU), e servem
// para decidir à mão o que se repete.
const PORMENOR_SEM_DADOS_PESSOAIS = new Set(["variante_sku_unico"]);

const NOMES = ["code", "schema", "table", "column", "constraint"] as const;

export function pormenorDeMigracao(erro: unknown): string | undefined {
  if (typeof erro !== "object" || erro === null) return undefined;
  const campos = erro as Partial<
    Record<(typeof NOMES)[number] | "detail", unknown>
  >;
  const partes = NOMES.flatMap((nome) => {
    const valor = campos[nome];
    return typeof valor === "string" && valor !== ""
      ? [`${nome}=${valor}`]
      : [];
  });
  if (
    campos.code === "23505" &&
    typeof campos.constraint === "string" &&
    PORMENOR_SEM_DADOS_PESSOAIS.has(campos.constraint) &&
    typeof campos.detail === "string"
  ) {
    partes.push(`detail=${campos.detail}`);
  }
  return partes.length === 0 ? undefined : partes.join(" ");
}
