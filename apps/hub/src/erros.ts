import { api, ErroHub } from "./api";
import {
  Cancelado,
  JaRegistada,
  ReautenticacaoPorFazer,
  RecuperacaoNaoConcluida,
} from "./passkeys";
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
  "password.invalid_code": "erroCodigoTotpErrado",
  "password.not_pending": "erroPalavraPasseNaoPendente",
  "password.last_credential": "erroPalavraPasseUltima",
  "password.not_found": "erroPalavraPasseNaoExiste",
  "key.scope_escalation": "erroChaveAmbitosAMais",
  // Editar o artigo (docs/22 §13.2 e §13.3).
  "catalog.version_conflict": "artigoConflito",
  "catalog.external_field": "artigoExternoCampo",
  "catalog.name_required": "artigoNomeObrigatorio",
  // O motivo da API ao activar ou arquivar (revisão do #217, P2-5).
  "catalog.no_variants": "artigoSemVariantesActivas",
  "catalog.invalid_transition": "artigoTransicaoInvalida",
  "catalog.variant_archived_is_final": "artigoVarianteJaArquivada",
  // Criar o artigo (docs/22 §14.4), quando o ecrã não sabe o campo.
  "catalog.sku_duplicate": "artigoSkuDuplicado",
  "catalog.gtin_duplicate": "artigoGtinDuplicado",
  "catalog.gtin_invalid": "artigoGtinInvalido",
  "catalog.content_incomplete": "artigoConteudoIncompleto",
  // Alterar a variante (docs/22 §23): o peso de uma variante à venda.
  "catalog.published_in_use": "erroPublicadoEmUso",
  // Escrever as opções (docs/22 §21.3); o conflito de versão de uma opção
  // diz-o o próprio ecrã.
  "catalog.option_duplicate": "erroOpcaoDuplicada",
  "catalog.option_value_duplicate": "erroValorDuplicado",
  "catalog.not_draft": "erroNaoRascunho",
  "catalog.option_combination_duplicate": "erroCombinacaoRepetida",
  "catalog.options_incomplete": "erroOpcoesIncompletas",
  "catalog.order_mismatch": "erroOrdemDesactualizada",
  "catalog.option_repeated": "erroOpcaoRepetida",
  "key.merchant_inactive": "erroChaveComercianteInactivo",
  "key.not_found": "erroChaveNaoExiste",
  "key.already_revoked": "erroChaveJaRevogada",
  "key.last_key_writer": "erroChaveUltimaGestora",
  "key.invalid_expiry": "erroChaveExpira",
  "member.last_owner": "erroUltimoDono",
  "member.self_role_change": "erroProprioPapel",
  "member.not_found": "erroMembroNaoExiste",
  "invite.other_person": "erroConviteOutraPessoa",
  "invite.already_member": "erroJaMembro",
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
  if (erro instanceof ReautenticacaoPorFazer) {
    // Como a passkey cancelada: não é um erro, é um passo por fazer.
    return { texto: t.erroReautenticar, neutro: true };
  }
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
