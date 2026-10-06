import { createHash, randomBytes } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { ErroApi } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import type { Ambito } from "./chaves.js";
import type { Papel } from "./papeis.js";

// Sessões das pessoas no Hub (docs/21 §3, §4.6 e §11; migrações 0018 e 0020).
// A sessão é uma linha na base com o resumo de um segredo de 256 bits; o
// cookie leva o segredo. A base decide (sessão válida, membro, papel); aqui
// só se lê o cookie, se chama a base e se traduzem os erros.

/** Onde vive o Hub: a origem exacta e o identificador WebAuthn (rpID). */
export interface ConfigHub {
  /** Ex.: `https://hub.exemplo.eu`, sem caminho nem barra no fim. */
  origem: string;
  /** O anfitrião da origem (docs/21 §3: o rpID é o anfitrião do Hub). */
  rpId: string;
}

/** Lê e valida a origem do Hub; só `https://anfitrião[:porta]`. */
export function configHub(origem: string): ConfigHub {
  let url: URL;
  try {
    url = new URL(origem);
  } catch {
    throw new Error("HUB_ORIGEM: não é um URL");
  }
  if (url.protocol !== "https:" || url.origin !== origem) {
    throw new Error(
      "HUB_ORIGEM: tem de ser só a origem em https (ex.: https://hub.exemplo.eu)",
    );
  }
  // Um IP não serve de rpID no WebAuthn (revisão do #142, P3-7).
  if (/^[0-9.]+$/.test(url.hostname) || url.hostname.startsWith("[")) {
    throw new Error("HUB_ORIGEM: o anfitrião tem de ser um nome, não um IP");
  }
  return { origem, rpId: url.hostname };
}

/** `__Host-`: só este anfitrião, sem Domain, Path=/ e Secure (docs/21 §3). */
export const COOKIE_SESSAO = "__Host-eurolify_sessao";
export const OPCOES_COOKIE = {
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "strict",
} as const;
/** O máximo da sessão (CD); a base corta antes, às 12 h sem uso. */
export const IDADE_MAXIMA_COOKIE = 30 * 24 * 60 * 60;

export const FORMATO_SESSAO = /^eus_[A-Za-z0-9_-]{43}$/;
export const FORMATO_CONVITE = /^euc_[A-Za-z0-9_-]{43}$/;

export const resumo = (texto: string) =>
  createHash("sha256").update(texto, "utf8").digest("hex");

/** Um segredo novo de 256 bits, com o prefixo dado. */
export function segredoNovo(prefixo: "eus" | "euc"): string {
  return `${prefixo}_${randomBytes(32).toString("base64url")}`;
}

/** O que a sessão dá ao pedido. Nunca vai para a resposta nem o registo. */
export interface ContextoSessao {
  segredo: string;
  sessaoId: string;
  pessoaId: string;
  recente: boolean;
  /** Só nas rotas com comerciante (cabeçalho Eurolify-Comerciante). */
  comercianteId: string | null;
  membroId: string | null;
  papel: Papel | null;
  ambitos: Ambito[];
}

const ERROS_DAS_CONTAS = {
  "auth.session_required": {
    status: 401,
    pt: "Falta a sessão: entre no Hub",
    en: "Missing session: sign in to the Hub",
  },
  "auth.unauthenticated": {
    status: 401,
    pt: "Sessão ou credencial inválida, expirada ou revogada",
    en: "Invalid, expired or revoked session or credential",
  },
  "auth.forbidden": {
    status: 403,
    pt: "Não é membro deste comerciante",
    en: "Not a member of this merchant",
  },
  "auth.reauthentication_required": {
    status: 403,
    pt: "Autentique-se outra vez para esta operação",
    en: "Authenticate again for this operation",
  },
  "auth.busy": {
    status: 503,
    pt: "Pedidos de entrada demais; tente daqui a pouco",
    en: "Too many sign-in requests; try again shortly",
  },
  "auth.origin_rejected": {
    status: 403,
    pt: "Pedido de outra origem recusado",
    en: "Request from another origin rejected",
  },
  "merchant.header_required": {
    status: 400,
    pt: "Falta o cabeçalho Eurolify-Comerciante (mer_…)",
    en: "Missing Eurolify-Comerciante header (mer_…)",
  },
  "invite.invalid": {
    status: 404,
    pt: "O convite não existe, já foi usado, foi cancelado ou expirou",
    en: "The invitation does not exist, was used, cancelled or expired",
  },
  "invite.account_exists": {
    status: 409,
    pt: "Já há uma conta com este e-mail; entre nela para aceitar",
    en: "An account with this e-mail already exists; sign in to accept",
  },
  "invite.other_person": {
    status: 403,
    pt: "O convite é para outro e-mail",
    en: "The invitation is for another e-mail",
  },
  "invite.already_member": {
    status: 409,
    pt: "Já é membro deste comerciante",
    en: "Already a member of this merchant",
  },
  "invite.invalid_email": {
    status: 422,
    pt: "E-mail inválido",
    en: "Invalid e-mail",
  },
  "invite.invalid_role": {
    status: 422,
    pt: "Papel desconhecido",
    en: "Unknown role",
  },
  "invite.not_found": {
    status: 404,
    pt: "O convite não existe neste comerciante",
    en: "Invitation not found for this merchant",
  },
  "invite.used": {
    status: 409,
    pt: "O convite já foi aceite ou cancelado",
    en: "The invitation was already accepted or cancelled",
  },
  "member.role_escalation": {
    status: 403,
    pt: "O seu papel não permite esta operação",
    en: "Your role does not allow this operation",
  },
  "member.self_role_change": {
    status: 403,
    pt: "Ninguém muda o seu próprio papel",
    en: "Nobody can change their own role",
  },
  "member.last_owner": {
    status: 409,
    pt: "É o último dono activo; nomeie outro dono antes",
    en: "This is the last active owner; appoint another owner first",
  },
  "member.not_found": {
    status: 404,
    pt: "O membro não existe neste comerciante",
    en: "Member not found for this merchant",
  },
  "member.merchant_inactive": {
    status: 403,
    pt: "Um comerciante suspenso ou fechado não convida nem muda papéis",
    en: "A suspended or closed merchant cannot invite or change roles",
  },
  "person.invalid_name": {
    status: 422,
    pt: "O nome tem de ter entre 1 e 100 caracteres",
    en: "The name must have between 1 and 100 characters",
  },
  "auth.locked": {
    status: 429,
    pt: "Tentativas a mais; tente daqui a 15 minutos",
    en: "Too many attempts; try again in 15 minutes",
  },
  "passkey.not_found": {
    status: 404,
    pt: "A passkey não existe nesta conta",
    en: "Passkey not found in this account",
  },
  "passkey.last_credential": {
    status: 409,
    pt: "É a última forma de entrar; acrescente outra antes",
    en: "This is the last way to sign in; add another first",
  },
  "passkey.already_registered": {
    status: 409,
    pt: "Esta passkey já está registada",
    en: "This passkey is already registered",
  },
} as const;
export type CodigoErroConta = keyof typeof ERROS_DAS_CONTAS;

export function erroConta(codigo: CodigoErroConta, detalhe?: string): ErroApi {
  const { status, pt, en } = ERROS_DAS_CONTAS[codigo];
  return new ErroApi(codigo, status, { pt, en }, detalhe);
}

/**
 * Traduz um erro da base das contas; o resto passa como está (dá 500, sem
 * pormenor ao cliente). O texto da base não vai para a resposta: só o código.
 */
export function traduzirConta(erro: unknown): unknown {
  if (!(erro instanceof Error)) return erro;
  const codigo = (Object.keys(ERROS_DAS_CONTAS) as CodigoErroConta[]).find(
    (c) => erro.message.startsWith(`${c}:`),
  );
  return codigo === undefined ? erro : erroConta(codigo);
}

export async function traduzindoConta<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (erro) {
    throw traduzirConta(erro);
  }
}

type Executor = Kysely<BaseDados> | Transaction<BaseDados>;

/** Valida a sessão do cookie (sem comerciante). */
export async function verificarSessao(
  db: Executor,
  segredo: string,
): Promise<ContextoSessao> {
  if (!FORMATO_SESSAO.test(segredo)) throw erroConta("auth.unauthenticated");
  return traduzindoConta(async () => {
    const { rows } = await sql<{
      sessao_id: string;
      pessoa_id: string;
      recente: boolean;
    }>`select * from sessao_verificar(${segredo})`.execute(db);
    const linha = rows[0];
    if (linha === undefined) throw erroConta("auth.unauthenticated");
    return {
      segredo,
      sessaoId: linha.sessao_id,
      pessoaId: linha.pessoa_id,
      recente: linha.recente,
      comercianteId: null,
      membroId: null,
      papel: null,
      ambitos: [],
    };
  });
}

/** Valida a sessão do cookie para o comerciante do cabeçalho (§4.6). */
export async function resolverSessao(
  db: Executor,
  segredo: string,
  comercianteId: string,
): Promise<ContextoSessao> {
  if (!FORMATO_SESSAO.test(segredo)) throw erroConta("auth.unauthenticated");
  return traduzindoConta(async () => {
    const { rows } = await sql<{
      sessao_id: string;
      pessoa_id: string;
      membro_id: string;
      papel: Papel;
      ambitos: Ambito[];
      recente: boolean;
    }>`select * from sessao_resolver(${segredo}, ${comercianteId}::uuid)`.execute(
      db,
    );
    const linha = rows[0];
    if (linha === undefined) throw erroConta("auth.unauthenticated");
    return {
      segredo,
      sessaoId: linha.sessao_id,
      pessoaId: linha.pessoa_id,
      recente: linha.recente,
      comercianteId,
      membroId: linha.membro_id,
      papel: linha.papel,
      ambitos: linha.ambitos,
    };
  });
}
