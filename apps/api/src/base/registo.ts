import type { FastifyError, FastifyRequest } from "fastify";

// O que vai para o registo da API (servidor.ts). Está aqui para os testes
// usarem os mesmos serializadores (revisão do #110, P3-2).
/**
 * O token do checkout alojado é uma credencial (dá a sessão e os dados do
 * cliente): não vai para o registo (observability-security; revisão do #276,
 * P2-1).
 */
export const urlSemSegredos = (url: string) =>
  url
    .replace(/\/checkout\/[A-Za-z0-9_-]{43}/g, "/checkout/[token]")
    // O código e o valor da autorização de um emissor (docs/29 §17; revisão
    // do #407, P1-1): trocam-se por tokens enquanto valem.
    .replace(/([?&](?:code|state)=)[^&#]*/gi, "$1[tapado]")
    // O que se pesquisa no emissor pode ser o NIF ou o nome de um cliente
    // (docs/22 §32; revisão do #412, P1-1): dado pessoal, não vai.
    .replace(/(\/issuer-search\?(?:[^#]*&)?q=)[^&#]*/gi, "$1[tapado]")
    // O código postal da procura de pontos de recolha diz por onde o
    // cliente anda (docs/36 §21.5; revisão do #439, P2-2).
    .replace(/([?&]codigo_postal=)[^&#]*/gi, "$1[tapado]");

export const serializadores = {
  // Sem endereços IP nem cabeçalhos (a chave vai no Authorization): são dados
  // pessoais ou segredos (skill eu-gdpr-privacy, regra 7; docs/19 §5).
  req: (pedido: FastifyRequest) => ({
    id: pedido.id,
    metodo: pedido.method,
    url: urlSemSegredos(pedido.url),
  }),
  // Do erro só o tipo, o código, a mensagem e a pilha: um erro do pg traz no
  // `detail` os valores da linha (eu-gdpr-privacy, regra 7; revisão do #106,
  // P2-6).
  err: (erro: FastifyError) => ({
    type: erro.name,
    code: erro.code,
    message: erro.message,
    stack: erro.stack ?? "",
  }),
};
