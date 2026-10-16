import { chavePagamentos, type ChavePagamentos } from "../pagamentos/cifra.js";

/**
 * Lê as chaves dos webhooks das variáveis de ambiente (revisão do #477,
 * P2-4): a actual (`WEBHOOKS_CHAVE`, versão por omissão «1») e, durante a
 * troca, a anterior (`WEBHOOKS_CHAVE_ANTERIOR`, com a versão obrigatória e
 * diferente), que só serve para **decifrar**. Mal postas, lança com o nome
 * da variável certa.
 */
export function lerChavesWebhooks(env: Record<string, string | undefined>): {
  chave?: ChavePagamentos;
  chaveAnterior?: ChavePagamentos;
} {
  const valor = (nome: string) => {
    const v = env[nome]?.trim();
    return v === undefined || v === "" ? undefined : v;
  };
  const ler = (nome: string, texto: string, versao: string) => {
    try {
      return chavePagamentos(texto, versao);
    } catch {
      throw new Error(
        `${nome}: tem de ter 32 bytes em base64, e a versão 1 a 20 letras, algarismos, _ ou -`,
      );
    }
  };
  const texto = valor("WEBHOOKS_CHAVE");
  const textoAnterior = valor("WEBHOOKS_CHAVE_ANTERIOR");
  const versaoAnterior = valor("WEBHOOKS_CHAVE_ANTERIOR_VERSAO");
  const chave =
    texto === undefined
      ? undefined
      : ler("WEBHOOKS_CHAVE", texto, valor("WEBHOOKS_CHAVE_VERSAO") ?? "1");
  if (textoAnterior === undefined) {
    if (versaoAnterior !== undefined) {
      throw new Error(
        "WEBHOOKS_CHAVE_ANTERIOR_VERSAO sem WEBHOOKS_CHAVE_ANTERIOR",
      );
    }
    return chave === undefined ? {} : { chave };
  }
  if (chave === undefined) {
    throw new Error("WEBHOOKS_CHAVE_ANTERIOR sem WEBHOOKS_CHAVE");
  }
  if (versaoAnterior === undefined) {
    throw new Error(
      "WEBHOOKS_CHAVE_ANTERIOR sem WEBHOOKS_CHAVE_ANTERIOR_VERSAO",
    );
  }
  const chaveAnterior = ler(
    "WEBHOOKS_CHAVE_ANTERIOR",
    textoAnterior,
    versaoAnterior,
  );
  if (chaveAnterior.versao === chave.versao) {
    throw new Error(
      "WEBHOOKS_CHAVE_ANTERIOR_VERSAO tem de ser diferente da WEBHOOKS_CHAVE_VERSAO",
    );
  }
  return { chave, chaveAnterior };
}
