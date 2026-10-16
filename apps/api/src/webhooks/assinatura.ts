import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// A assinatura dos webhooks (docs/38 §4; headless-commerce, «Webhooks»).
// Cabeçalho `Eurolify-Signature: t=<segundos UTC>,v1=<HMAC-SHA256 em hex>`,
// o HMAC sobre `<t>.<corpo>` com o segredo da subscrição. O carimbo vai
// dentro do que se assina: quem o mudar para um corpo antigo não acerta, e o
// receptor recusa carimbos fora da janela (repetição). Cada tentativa assina
// com o carimbo do momento; o `id` do evento é o mesmo (idempotência).

/** A janela que o receptor deve aceitar (docs/38 §4, **C**: 5 minutos). */
export const TOLERANCIA_SEGUNDOS = 300;

/** Um segredo novo: `whsec_` e 32 bytes de acaso em base64url. */
export function novoSegredo(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

const hmac = (segredo: string, t: number, corpo: string) =>
  createHmac("sha256", segredo)
    .update(`${String(t)}.${corpo}`)
    .digest("hex");

export function assinar(segredo: string, corpo: string, t: number): string {
  return `t=${String(t)},v1=${hmac(segredo, t, corpo)}`;
}

export type ResultadoDaVerificacao =
  | { ok: true }
  | { ok: false; motivo: "formato" | "assinatura" | "carimbo_fora_da_janela" };

/**
 * O que o receptor faz (exportado para os testes e para o SDK): o formato, o
 * HMAC em tempo constante e o carimbo dentro da janela, para os dois lados.
 */
export function verificarAssinatura(
  segredo: string,
  corpo: string,
  cabecalho: string,
  agora: Date = new Date(),
  tolerancia: number = TOLERANCIA_SEGUNDOS,
): ResultadoDaVerificacao {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(cabecalho);
  if (m === null) return { ok: false, motivo: "formato" };
  const t = Number(m[1]);
  const esperado = Buffer.from(hmac(segredo, t, corpo), "hex");
  const recebido = Buffer.from(m[2] ?? "", "hex");
  if (
    esperado.length !== recebido.length ||
    !timingSafeEqual(esperado, recebido)
  ) {
    return { ok: false, motivo: "assinatura" };
  }
  if (Math.abs(Math.floor(agora.getTime() / 1000) - t) > tolerancia) {
    return { ok: false, motivo: "carimbo_fora_da_janela" };
  }
  return { ok: true };
}
