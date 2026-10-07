import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { hash, verify as verificarArgon2 } from "@node-rs/argon2";
import { generateSecret, generateURI, verify as verificarOtp } from "otplib";

// A palavra-passe com o TOTP (docs/21 §4.3 e §8; decisões CA e CG). O
// Argon2id e o TOTP calculam-se aqui; a base guarda o resumo, o segredo TOTP
// cifrado e o último passo aceite, e decide o resto (migração 0024).

/** A chave que cifra os segredos TOTP; vive fora da base (§8). */
export interface ChaveTotp {
  versao: number;
  chave: Buffer;
}

/** Lê `TOTP_CHAVE` (32 bytes em base64) e `TOTP_CHAVE_VERSAO` (1 por omissão). */
export function chaveTotp(base64: string, versao = "1"): ChaveTotp {
  const chave = Buffer.from(base64, "base64");
  if (chave.length !== 32) {
    throw new Error("TOTP_CHAVE: tem de ter 32 bytes em base64");
  }
  const v = Number(versao);
  if (!Number.isInteger(v) || v < 1 || v > 1000) {
    throw new Error("TOTP_CHAVE_VERSAO: inteiro entre 1 e 1000");
  }
  return { versao: v, chave };
}

// Argon2id (CG: RFC 9106 §4, segunda opção recomendada): 64 MiB, t=3, p=4,
// resultado de 256 bits; a biblioteca gera sais de 16 bytes (128 bits).
const ARGON2ID = 2;
const PARAMETROS = {
  algorithm: ARGON2ID,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
} as const;

// No máximo 2 Argon2id ao mesmo tempo (64 MiB cada) e 20 à espera; mais do
// que isso responde 503 (`auth.busy`) em vez de encher a memória e a fila da
// VPS (revisão do #147, P2-2; valores a medir na VPS).
const EM_CURSO_MAXIMO = 2;
const ESPERA_MAXIMA = 20;
let emCurso = 0;
const espera: (() => void)[] = [];

export class Ocupado extends Error {}

async function comVez<T>(fn: () => Promise<T>): Promise<T> {
  if (emCurso >= EM_CURSO_MAXIMO) {
    if (espera.length >= ESPERA_MAXIMA) throw new Ocupado("argon2 ocupado");
    await new Promise<void>((r) => espera.push(r));
  } else {
    emCurso += 1;
  }
  try {
    return await fn();
  } finally {
    const seguinte = espera.shift();
    if (seguinte === undefined) emCurso -= 1;
    else seguinte();
  }
}

export const resumirPalavraPasse = (palavra: string) =>
  comVez(() => hash(palavra, PARAMETROS));

let resumoFalso: Promise<string> | undefined;

/** O resumo falso calcula-se ao registar as rotas, não no primeiro pedido. */
export function prepararResumoFalso(): Promise<string> {
  resumoFalso ??= hash(randomBytes(32).toString("base64url"), PARAMETROS);
  return resumoFalso;
}

/**
 * Confere uma palavra-passe. Sem resumo (não há conta), confere contra o
 * resumo falso, para o tempo ser o mesmo (§8) — e devolve sempre falso. Um
 * erro do Argon2id lança, nos dois casos da mesma maneira.
 */
export async function conferirPalavraPasse(
  resumo: string | null,
  palavra: string,
): Promise<boolean> {
  const alvo = resumo ?? (await prepararResumoFalso());
  const certa = await comVez(() => verificarArgon2(alvo, palavra));
  return resumo !== null && certa;
}

/** Um segredo TOTP novo: 160 bits em base32 (o recomendado pelo RFC 4226). */
export const segredoTotpNovo = () => generateSecret({ length: 20 });

export const uriTotp = (segredo: string, email: string) =>
  generateURI({ issuer: "Eurolify", label: email, secret: segredo });

/**
 * Confere um código de seis dígitos: no máximo ±1 janela de 30 s, e só um
 * passo maior do que o último aceite (§8). Devolve o passo, ou null.
 */
export async function conferirCodigo(
  segredo: string,
  codigo: string,
  ultimoPasso: number,
): Promise<number | null> {
  if (!/^[0-9]{6}$/.test(codigo)) return null;
  try {
    const r = await verificarOtp({
      secret: segredo,
      token: codigo,
      epochTolerance: 30,
      afterTimeStep: ultimoPasso,
    });
    return r.valid && "timeStep" in r ? r.timeStep : null;
  } catch {
    return null;
  }
}

// O segredo TOTP cifra-se com AES-256-GCM; o identificador da pessoa vai
// como dado associado, para um segredo copiado para outra conta não abrir.

export function cifrarSegredo(
  segredo: string,
  pessoa: string,
  chave: ChaveTotp,
): Buffer {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave.chave, iv);
  cifra.setAAD(Buffer.from(pessoa, "utf8"));
  const corpo = Buffer.concat([cifra.update(segredo, "utf8"), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), corpo]);
}

export function decifrarSegredo(
  cifrado: Buffer,
  pessoa: string,
  chave: ChaveTotp,
): string {
  const decifra = createDecipheriv(
    "aes-256-gcm",
    chave.chave,
    cifrado.subarray(0, 12),
  );
  decifra.setAAD(Buffer.from(pessoa, "utf8"));
  decifra.setAuthTag(cifrado.subarray(12, 28));
  return Buffer.concat([
    decifra.update(cifrado.subarray(28)),
    decifra.final(),
  ]).toString("utf8");
}
