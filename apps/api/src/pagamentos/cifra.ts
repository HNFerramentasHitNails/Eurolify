import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// As credenciais das contas de pagamento cifram-se com AES-256-GCM, com a
// chave fora da base (PAGAMENTOS_CHAVE; docs/26 Q3), como o segredo TOTP
// (identidade/palavra-passe.ts). A conta e o campo vão como dado associado:
// uma cifra copiada para outra conta, ou para o outro campo, não abre.

export interface ChavePagamentos {
  versao: string;
  chave: Buffer;
}

/** Lê `PAGAMENTOS_CHAVE` (32 bytes em base64) e `PAGAMENTOS_CHAVE_VERSAO`. */
export function chavePagamentos(base64: string, versao = "1"): ChavePagamentos {
  const chave = Buffer.from(base64, "base64");
  if (chave.length !== 32) {
    throw new Error("PAGAMENTOS_CHAVE: tem de ter 32 bytes em base64");
  }
  if (!/^[0-9A-Za-z_-]{1,20}$/.test(versao)) {
    throw new Error(
      "PAGAMENTOS_CHAVE_VERSAO: 1 a 20 letras, algarismos, _ ou -",
    );
  }
  return { versao, chave };
}

const aad = (contaId: string, campo: string) =>
  Buffer.from(`${contaId}:${campo}`, "utf8");

export function cifrar(
  texto: string,
  contaId: string,
  campo: "credenciais" | "segredo_aviso" | "sessao" | "webhook_segredo",
  chave: ChavePagamentos,
): Buffer {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave.chave, iv);
  cifra.setAAD(aad(contaId, campo));
  const corpo = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), corpo]);
}

export function decifrar(
  cifrado: Buffer,
  contaId: string,
  campo: "credenciais" | "segredo_aviso" | "sessao" | "webhook_segredo",
  chave: ChavePagamentos,
): string {
  const decifra = createDecipheriv(
    "aes-256-gcm",
    chave.chave,
    cifrado.subarray(0, 12),
  );
  decifra.setAAD(aad(contaId, campo));
  decifra.setAuthTag(cifrado.subarray(12, 28));
  return Buffer.concat([
    decifra.update(cifrado.subarray(28)),
    decifra.final(),
  ]).toString("utf8");
}
