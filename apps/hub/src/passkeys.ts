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

function cancelado(erro: unknown): boolean {
  const nome =
    erro instanceof Error
      ? ((erro as { cause?: { name?: string } }).cause?.name ?? erro.name)
      : "";
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

/** Criar a conta a partir de um convite: o nome e uma passkey nova. */
export async function criarConta(
  convite: string,
  nome: string,
): Promise<ContaNova> {
  const opcoes = await pedir<PublicKeyCredentialCreationOptionsJSON>(
    "POST",
    "/hub/invitations/accept/options",
    { corpo: { convite } },
  );
  let credencial;
  try {
    credencial = await startRegistration({ optionsJSON: opcoes });
  } catch (erro) {
    if (cancelado(erro)) throw new Cancelado();
    throw erro;
  }
  return pedir<ContaNova>("POST", "/hub/invitations/accept-new", {
    corpo: { convite, nome, credencial },
  });
}
