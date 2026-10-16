import { criarCliente, type OpcoesDoCliente } from "./cliente.js";
import { ErroDoSdk } from "./erros.js";
import type { paths as CaminhosAdministracao } from "./gerado/administracao.js";
import type { paths as CaminhosLoja } from "./gerado/loja.js";
import type { Cliente } from "./tipos.js";

export type { OpcoesDoCliente } from "./cliente.js";
export { ErroDaApi, ErroDeRede, ErroDoSdk } from "./erros.js";
export type { Problema } from "./erros.js";
export { itens, paginas } from "./paginacao.js";
export type { Pagina } from "./paginacao.js";
export type { Cliente, Pedido, Resposta, Sucesso } from "./tipos.js";
export type { CaminhosAdministracao, CaminhosLoja };

/** O cliente da API da Loja: chave pública (`eul_pk_…`) ou nenhuma. */
export type ClienteDaLoja = Cliente<CaminhosLoja>;
/** O cliente da API de Administração: chave de servidor (`eul_sk_…`). */
export type ClienteDeAdministracao = Cliente<CaminhosAdministracao>;

/**
 * Cliente da Loja, para frontends. Recusa uma chave de servidor: essa nunca
 * vai para um browser (docs/39 §5).
 */
export function criarLoja(opcoes: OpcoesDoCliente): ClienteDaLoja {
  if (opcoes.chave?.startsWith("eul_sk_") === true) {
    throw new ErroDoSdk(
      "criarLoja: recebeu uma chave de servidor (eul_sk_…); na Loja só a chave pública (eul_pk_…)",
    );
  }
  return criarCliente<CaminhosLoja>(opcoes);
}

/** Cliente da Administração, para servidores. Pede a chave de servidor. */
export function criarAdministracao(
  opcoes: OpcoesDoCliente & { chave: string },
): ClienteDeAdministracao {
  if (!opcoes.chave.startsWith("eul_sk_")) {
    throw new ErroDoSdk(
      "criarAdministracao: pede uma chave de servidor (eul_sk_…)",
    );
  }
  return criarCliente<CaminhosAdministracao>(opcoes);
}

/**
 * Uma chave de idempotência nova (UUID). Cria-se **uma por intenção** e
 * guarda-se para repetir o mesmo pedido; nunca uma nova a cada tentativa.
 */
export function novaChaveDeIdempotencia(): string {
  return globalThis.crypto.randomUUID();
}
