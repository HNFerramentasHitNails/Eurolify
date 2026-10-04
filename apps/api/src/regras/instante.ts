// A única leitura de datas do motor de regras (revisão do #37, P1-1). Só
// aceita ISO 8601 completo e com fuso: sem fuso, a mesma data dava decisões
// diferentes conforme o fuso do servidor; e o Date.parse sozinho aceita "1",
// "10/04/2026" ou 30 de Fevereiro (que passa para Março).
//
// O alcance de cada campo é decidido aqui, não pelo motor de JavaScript
// (revisão do #40, P2-6): horas 00-23, minutos e segundos 00-59, fracção até
// 3 dígitos (o que o Date guarda), fuso `Z` ou ±00:00 a ±23:59.
const ISO_COM_FUSO =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,3})?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Milissegundos desde 1970 (UTC), ou null se o texto não for um instante válido. */
export function instante(texto: string): number | null {
  if (typeof texto !== "string") return null;
  const partes = ISO_COM_FUSO.exec(texto);
  if (partes === null) return null;
  const [ano, mes, dia] = partes.slice(1, 4).map(Number) as [
    number,
    number,
    number,
  ];
  if (mes < 1 || mes > 12) return null;
  // O dia tem de existir nesse mês (sem passar para o seguinte). O
  // setUTCFullYear não trata os anos 0–99 como 1900+, ao contrário do
  // Date.UTC (revisão do #47, P2 n.º 4).
  const fimDoMes = new Date(0);
  fimDoMes.setUTCFullYear(ano, mes, 0);
  const ultimoDia = fimDoMes.getUTCDate();
  if (dia < 1 || dia > ultimoDia) return null;
  const valor = Date.parse(texto);
  return Number.isNaN(valor) ? null : valor;
}
