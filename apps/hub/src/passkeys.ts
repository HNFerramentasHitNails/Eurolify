import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { ErroHub, pedir, type ContaNova } from "./api";

// As passkeys no navegador (docs/22 §2 e §3). A assinatura verifica-se na API
// (docs/21 §11); aqui só se passam as opções ao navegador e a resposta à API.

export const temPasskeys = () => browserSupportsWebAuthn();

/** A pessoa fechou a janela da passkey (ou expirou): não é um erro. */
export class Cancelado extends Error {}

/**
 * O dispositivo já tem uma passkey desta conta: o navegador recusa-a antes
 * de chegar à API (a lista das que a pessoa já tem vai nas opções).
 */
export class JaRegistada extends Error {}

const nomeDoErro = (erro: unknown) =>
  erro instanceof Error
    ? ((erro as { cause?: { name?: string } }).cause?.name ?? erro.name)
    : "";

function cancelado(erro: unknown): boolean {
  const nome = nomeDoErro(erro);
  return nome === "NotAllowedError" || nome === "AbortError";
}

async function assinar(caminhoFinal: string) {
  const opcoes = await pedir<PublicKeyCredentialRequestOptionsJSON>(
    "POST",
    "/hub/session/options",
  );
  let credencial;
  try {
    credencial = await startAuthentication({ optionsJSON: opcoes });
  } catch (erro) {
    if (cancelado(erro)) throw new Cancelado();
    throw erro;
  }
  await pedir("POST", caminhoFinal, { corpo: { credencial } });
}

/** Entrar com uma passkey. */
export const entrar = () => assinar("/hub/session");

/** Autenticação recente (10 minutos), com uma passkey da mesma pessoa. */
export const reautenticar = () => assinar("/hub/session/reauthenticate");

/**
 * Corre `fn`; se a API pedir autenticação recente, pede a passkey e repete
 * uma vez (docs/22 §3).
 */
export async function comRecente<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (erro) {
    if (
      erro instanceof ErroHub &&
      erro.codigo === "auth.reauthentication_required"
    ) {
      await reautenticar();
      return fn();
    }
    throw erro;
  }
}

/** Pede as opções a `caminhoOpcoes` e cria uma passkey nova no navegador. */
async function registar(caminhoOpcoes: string, corpo?: unknown) {
  const opcoes = await pedir<PublicKeyCredentialCreationOptionsJSON>(
    "POST",
    caminhoOpcoes,
    corpo === undefined ? {} : { corpo },
  );
  try {
    return await startRegistration({ optionsJSON: opcoes });
  } catch (erro) {
    if (cancelado(erro)) throw new Cancelado();
    if (nomeDoErro(erro) === "InvalidStateError") throw new JaRegistada();
    throw erro;
  }
}

/** Criar a conta a partir de um convite: o nome e uma passkey nova. */
export async function criarConta(
  convite: string,
  nome: string,
): Promise<ContaNova> {
  const credencial = await registar("/hub/invitations/accept/options", {
    convite,
  });
  return pedir<ContaNova>("POST", "/hub/invitations/accept-new", {
    corpo: { convite, nome, credencial },
  });
}

/**
 * Acrescentar uma passkey à conta (docs/22 §9.1). Pede autenticação recente:
 * chama-se dentro de `comRecente`, que repete tudo depois da passkey.
 */
export async function acrescentarPasskey(nome: string): Promise<void> {
  const credencial = await registar("/hub/passkeys/options");
  await pedir("POST", "/hub/passkeys", { corpo: { nome, credencial } });
}

/**
 * Recuperar a conta com um código de recuperação e uma passkey nova (docs/22
 * §9.1). O código vai como foi escrito: a API normaliza-o. No fim há sessão.
 */
export async function recuperar(
  email: string,
  codigo: string,
  nomePasskey: string,
): Promise<void> {
  const credencial = await registar("/hub/recovery/options", {
    email,
    codigo,
  });
  try {
    await pedir("POST", "/hub/recovery", {
      corpo: {
        email,
        codigo,
        ...(nomePasskey === "" ? {} : { nome_passkey: nomePasskey }),
        credencial,
      },
    });
  } catch (erro) {
    // O e-mail e o código já passaram no primeiro passo: um 401 aqui é a
    // passkey nova ou o desafio fora de prazo (revisão do #174, P3-6).
    if (erro instanceof ErroHub && erro.estado === 401) {
      throw new RecuperacaoNaoConcluida();
    }
    throw erro;
  }
}

/** O segundo passo da recuperação foi recusado (a passkey nova ou o prazo). */
export class RecuperacaoNaoConcluida extends Error {}
