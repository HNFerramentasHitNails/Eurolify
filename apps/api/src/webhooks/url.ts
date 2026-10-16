import { isIP } from "node:net";

// Para onde um webhook pode ir (docs/38 §3 e §8). O Eurolify faz o pedido a
// um endereço que o comerciante escolhe: sem regras, era uma porta aberta
// para a rede interna da VPS (SSRF; observability-security). Só https, na
// porta 443, sem credenciais no endereço, e nunca para um endereço privado,
// local ou reservado: verifica-se ao guardar e, outra vez, ao enviar, com o
// endereço a que o nome resolve nesse momento.

export class UrlRecusada extends Error {
  constructor(motivo: string) {
    super(`webhooks.url_invalid: ${motivo}`);
    this.name = "UrlRecusada";
  }
}

/** Um IPv4 público? Recusa os intervalos privados, locais e reservados. */
function ipv4Publico(ip: string): boolean {
  const p = ip.split(".").map(Number);
  const [a, b, c] = [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

/**
 * Um IPv6 público? Conservador: só o endereço global (2000::/3), sem a
 * documentação (2001:db8::/32) nem o 6to4 (2002::/16); os mapeados em IPv4
 * e o resto recusam-se.
 */
function ipv6Publico(ip: string): boolean {
  const h = ip.split(":");
  const primeiro = parseInt(h[0] ?? "", 16);
  if (Number.isNaN(primeiro) || (primeiro & 0xe000) !== 0x2000) return false;
  if (primeiro === 0x2002) return false;
  if (primeiro === 0x2001 && parseInt(h[1] ?? "", 16) === 0xdb8) return false;
  return true;
}

export function enderecoPublico(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Publico(ip);
  if (v === 6) return ipv6Publico(ip);
  return false;
}

const SUFIXOS_LOCAIS = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home",
  ".corp",
  ".intranet",
];

/**
 * Valida o endereço de uma subscrição e devolve-o normalizado. Lança
 * `UrlRecusada`. Não resolve nomes (isso é ao enviar).
 */
export function validarUrlDeWebhook(texto: string): string {
  let u: URL;
  try {
    u = new URL(texto);
  } catch {
    throw new UrlRecusada("não é um endereço");
  }
  if (u.protocol !== "https:") throw new UrlRecusada("só https");
  if (u.username !== "" || u.password !== "") {
    throw new UrlRecusada("sem credenciais no endereço");
  }
  if (u.port !== "" && u.port !== "443") {
    throw new UrlRecusada("só a porta 443");
  }
  if (u.hash !== "") throw new UrlRecusada("sem fragmento");
  const nome = u.hostname.toLowerCase().replace(/\.$/, "");
  if (nome.startsWith("["))
    throw new UrlRecusada("sem endereços IPv6 literais");
  if (isIP(nome) !== 0) {
    if (!enderecoPublico(nome)) throw new UrlRecusada("endereço não público");
  } else {
    if (
      !nome.includes(".") ||
      nome === "localhost" ||
      SUFIXOS_LOCAIS.some((s) => nome.endsWith(s))
    ) {
      throw new UrlRecusada("nome não público");
    }
  }
  if (u.href.length > 2000) throw new UrlRecusada("endereço demasiado longo");
  return u.href;
}
