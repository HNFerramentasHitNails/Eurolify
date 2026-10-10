import { createHash, randomBytes } from "node:crypto";

// Chaves de API (docs/19 §3). O segredo mostra-se uma vez, ao criar; a base
// guarda só o resumo (sha256) e o prefixo visível. Com 256 bits de acaso, o
// sha256 sem sal chega: não há dicionário a tentar (proposta, docs/19 §3).

export const TIPOS_CHAVE = ["servidor", "publica"] as const;
export type TipoChave = (typeof TIPOS_CHAVE)[number];

/** Os âmbitos (docs/19 §4); a mesma lista do CHECK da migração 0010. */
export const AMBITOS = [
  "merchant:read",
  "merchant:write",
  "catalog:read",
  "catalog:write",
  "catalog:publish",
  "catalog:import",
  "catalog:history",
  "prices:read",
  "prices:write",
  "customers:read",
  "customers:write",
  "customers:billing",
  "customers:exemptions",
  "customers:merge",
  "tax:read",
  "tax:write",
  "legal:read",
  "legal:write",
  "shipping:read",
  "shipping:write",
  "orders:read",
  "keys:write",
  "storefront",
] as const;
export type Ambito = (typeof AMBITOS)[number];

const PREFIXO_DO_TIPO: Record<TipoChave, string> = {
  servidor: "eul_sk_",
  publica: "eul_pk_",
};

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Base32 (RFC 4648, minúsculas, sem preenchimento). */
function emBase32(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += BASE32.charAt((valor >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) saida += BASE32.charAt((valor << (5 - bits)) & 31);
  return saida;
}

/** 32 bytes em base32 dão 52 caracteres. */
export const FORMATO_SEGREDO = /^eul_(sk|pk)_[a-z2-7]{52}$/;

export interface ChaveNova {
  segredo: string;
  prefixo: string;
  resumo: string;
}

export function resumoDe(segredo: string): string {
  return createHash("sha256").update(segredo, "utf8").digest("hex");
}

export function gerarChave(tipo: TipoChave): ChaveNova {
  const segredo = PREFIXO_DO_TIPO[tipo] + emBase32(randomBytes(32));
  return {
    segredo,
    prefixo: segredo.slice(0, 12),
    resumo: resumoDe(segredo),
  };
}
