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

const CHAVE_PUBLICA = /^eul_pk_[a-z2-7]{52}$/;
const CHAVE_DE_SERVIDOR = /^eul_sk_[a-z2-7]{52}$/;

/**
 * Cliente da Loja, para frontends. Só aceita a chave pública: a de servidor
 * nunca vai para um browser (docs/39 §5). As mensagens não repetem a chave.
 */
export function criarLoja(opcoes: OpcoesDoCliente): ClienteDaLoja {
  if (opcoes.chave !== undefined && !CHAVE_PUBLICA.test(opcoes.chave)) {
    throw new ErroDoSdk(
      "criarLoja: a chave não tem o formato de uma chave pública (eul_pk_…)",
    );
  }
  return criarCliente<CaminhosLoja>(opcoes, { loja: true });
}

/**
 * Cliente da Administração, para servidores. Pede a chave de servidor e
 * https (excepto em localhost ou 127.0.0.1, para ensaios).
 */
export function criarAdministracao(
  opcoes: OpcoesDoCliente & { chave: string },
): ClienteDeAdministracao {
  if (!CHAVE_DE_SERVIDOR.test(opcoes.chave)) {
    throw new ErroDoSdk(
      "criarAdministracao: a chave não tem o formato de uma chave de servidor (eul_sk_…)",
    );
  }
  let anfitriao: string;
  let protocolo: string;
  try {
    ({ hostname: anfitriao, protocol: protocolo } = new URL(opcoes.url));
  } catch {
    throw new ErroDoSdk("criarAdministracao: url inválido");
  }
  if (
    protocolo !== "https:" &&
    !(protocolo === "http:" && ["localhost", "127.0.0.1"].includes(anfitriao))
  ) {
    throw new ErroDoSdk(
      "criarAdministracao: a chave de servidor só segue por https (ou http em localhost)",
    );
  }
  return criarCliente<CaminhosAdministracao>(opcoes, { loja: false });
}

/**
 * Uma chave de idempotência nova (UUID). Cria-se **uma por intenção** e
 * guarda-se para repetir o mesmo pedido; nunca uma nova a cada tentativa.
 */
export function novaChaveDeIdempotencia(): string {
  return globalThis.crypto.randomUUID();
}
