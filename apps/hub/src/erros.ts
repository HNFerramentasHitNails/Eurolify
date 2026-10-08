import { api, ErroHub } from "./api";
import { Cancelado, JaRegistada, RecuperacaoNaoConcluida } from "./passkeys";
import { preencher, type Lingua, type Textos } from "./textos";

// O texto de um erro, na língua escolhida (docs/22 §3). Os códigos conhecidos
// têm texto próprio nas três línguas; os outros usam a mensagem da API (pt ou
// en) e, sem ela, uma genérica com a referência do pedido para o suporte.

export interface MensagemDeErro {
  texto: string;
  referencia?: string;
  /** Não é um erro (ex.: a passkey foi cancelada): mostra-se sem vermelho. */
  neutro?: boolean;
}

const POR_CODIGO: Record<string, keyof Textos> = {
  "auth.unauthenticated": "erroEntrada",
  "auth.session_required": "erroSemSessao",
  "auth.forbidden": "erroSemPermissao",
  "member.role_escalation": "erroSemPermissao",
  "auth.locked": "erroBloqueado",
  "invite.invalid": "erroConviteInvalido",
  "invite.account_exists": "conviteContaExiste",
  "invite.used": "erroConviteUsado",
  "invite.not_found": "erroConviteUsado",
  "invite.invalid_email": "erroEmail",
  "invite.invalid_role": "erroPapel",
  "member.merchant_inactive": "erroComercianteInactivo",
  "auth.reauthentication_required": "erroRecente",
  "auth.busy": "erroOcupado",
  "auth.origin_rejected": "erroOrigem",
  "person.invalid_name": "erroNome",
  "passkey.last_credential": "erroUltimaPasskey",
  "passkey.already_registered": "erroPasskeyJaRegistada",
  "passkey.not_found": "erroPasskeyNaoExiste",
};

/** Um erro conferido no próprio ecrã, com o texto já escolhido. */
export class ErroDoEcra extends Error {
  constructor(readonly chave: keyof Textos) {
    super(chave);
  }
}

/**
 * A passkey não foi aceite numa acção (de outra conta, ou o pedido demorou
 * mais de 5 minutos), com a sessão ainda aberta (revisão do #174, P1-1).
 */
export class PasskeyNaoAceite extends Error {}

export function mensagemDeErro(
  erro: unknown,
  t: Textos,
  lingua: Lingua,
): MensagemDeErro {
  if (erro instanceof Cancelado) {
    return { texto: t.entrarCancelado, neutro: true };
  }
  if (erro instanceof JaRegistada) return { texto: t.erroPasskeyJaRegistada };
  if (erro instanceof PasskeyNaoAceite)
    return { texto: t.erroPasskeyNaoAceite };
  if (erro instanceof RecuperacaoNaoConcluida) {
    return { texto: t.erroRecuperarPasskey };
  }
  if (erro instanceof ErroDoEcra) return { texto: t[erro.chave] };
  if (!(erro instanceof ErroHub)) return { texto: t.erroGenerico };
  if (erro.estado === 0) return { texto: t.erroRede };
  if (erro.codigo === "rate_limit.exceeded") {
    return {
      texto: preencher(t.erroMuitosPedidos, { s: erro.esperarSegundos ?? 60 }),
    };
  }
  const chave = erro.codigo === undefined ? undefined : POR_CODIGO[erro.codigo];
  if (chave !== undefined) return { texto: t[chave] };
  const daApi =
    lingua === "pt"
      ? erro.mensagens.pt
      : (erro.mensagens.en ?? erro.mensagens.pt);
  // Em espanhol, um código sem texto próprio fica com a mensagem genérica,
  // em vez de outra língua.
  const texto = lingua === "es" ? undefined : daApi;
  return {
    texto: texto ?? t.erroGenerico,
    ...(erro.referencia === undefined ? {} : { referencia: erro.referencia }),
  };
}

/**
 * A sessão acabou ou não existe (401 numa rota com sessão): o ecrã manda
 * para «Entrar». Só se usa nas rotas com sessão; nas de entrar, o 401 é a
 * recusa da passkey.
 */
export const semSessao = (erro: unknown) =>
  erro instanceof ErroHub && erro.estado === 401;

/**
 * O erro de uma ACÇÃO (com sessão), pronto a mostrar; `null` quando a sessão
 * acabou e o ecrã deve ir para «Entrar». Um 401 numa acção nem sempre é «sem
 * sessão»: a API também o dá a uma passkey recusada ou a um desafio fora de
 * prazo, com a sessão ainda válida. Confirma-se com o /hub/me (revisão do
 * #174, P1-1).
 */
export async function falhaDeAccao(erro: unknown): Promise<unknown> {
  if (!semSessao(erro)) return erro;
  try {
    await api.eu();
  } catch (e) {
    if (semSessao(e)) return null;
    // Sem rede ou outro erro: não se tira a pessoa da página.
    return e;
  }
  return new PasskeyNaoAceite();
}
