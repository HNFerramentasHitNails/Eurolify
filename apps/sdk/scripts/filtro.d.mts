export interface Contrato {
  openapi: string;
  paths: Record<string, Record<string, Operacao>>;
  [chave: string]: unknown;
}
export interface Operacao {
  "x-ambito"?: unknown;
  requestBody?: { content?: Record<string, unknown> };
  responses?: Record<string, { content?: Record<string, unknown> }>;
  [chave: string]: unknown;
}
export interface Fora {
  metodo: string;
  caminho: string;
  razao: string;
}
export const AMBITOS_DA_LOJA: string[];
export const AMBITOS_DO_HUB: string[];
export const CAMINHOS_FORA: RegExp[];
export function razaoDeExclusao(
  caminho: string,
  op: Operacao,
): string | undefined;
export function repartir(contrato: Contrato): {
  loja: Contrato;
  administracao: Contrato;
  fora: Fora[];
};
