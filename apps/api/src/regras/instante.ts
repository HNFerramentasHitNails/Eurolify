// A única leitura de datas do motor de regras (revisão do #37, P1-1). Só
// aceita ISO 8601 completo e com fuso: sem fuso, a mesma data dava decisões
// diferentes conforme o fuso do servidor; e o Date.parse sozinho aceita "1",
// "10/04/2026" ou 30 de Fevereiro (que passa para Março). O alcance do fuso
// (±00:00 a ±23:59) e a fracção (1 a 3 dígitos: o JavaScript só tem
// milissegundos) estão escritos aqui, para não dependerem do motor que corre
// (revisão do #40, P2-6). `-00:00` é recusado: na RFC 3339 (§4.3) quer dizer
// «fuso local desconhecido», o contrário do que este ficheiro exige (revisão
// do #45, P2-6).
const ISO_COM_FUSO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|\+(?:[01]\d|2[0-3]):[0-5]\d|-(?!00:00$)(?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Milissegundos desde 1970 (UTC), ou null se o texto não for um instante válido. */
export function instante(texto: string): number | null {
  // Sem coerção: uma lista com um texto lá dentro não é um instante (revisão
  // do #45, segunda volta, P2-2).
  const entrada: unknown = texto;
  if (typeof entrada !== "string") return null;
  const partes = ISO_COM_FUSO.exec(texto);
  if (partes === null) return null;
  const [ano, mes, dia, hora, minuto, segundo] = partes
    .slice(1, 7)
    .map(Number) as [number, number, number, number, number, number];
  if (mes < 1 || mes > 12 || hora > 23 || minuto > 59 || segundo > 59) {
    return null;
  }
  // O dia tem de existir nesse mês (sem passar para o seguinte).
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia < 1 || dia > ultimoDia) return null;
  const valor = Date.parse(texto);
  return Number.isNaN(valor) ? null : valor;
}
