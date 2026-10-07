import { isIP } from "node:net";
import { performance } from "node:perf_hooks";

// O limite geral de pedidos por IP nas rotas do Hub (docs/21 §14; condição
// para ligar o Hub, §12). Conta em memória, numa janela fixa, por IP — um
// IPv6 pela rede /64, como os limites da base (0024, `ip_rede`). O IP nunca
// vai para registos nem para a base: só fica aqui, até a janela acabar.
// Ex.: com 20 pedidos por minuto, o 21.º pedido de 203.0.113.7 dentro do
// mesmo minuto recebe 429 e `Retry-After` com os segundos que faltam.

export interface RegraLimite {
  /** Pedidos aceites por janela. */
  pedidos: number;
  /** A janela, em milissegundos. */
  janelaMs: number;
}

/** Os limites do Hub (propostas, docs/21 §14; a rever com medições). */
export interface LimitesHub {
  /** As rotas públicas do Hub (entrar, recuperar, aceitar convites). */
  publicas: RegraLimite;
  /** Todas as rotas do Hub, públicas e com sessão. */
  todas: RegraLimite;
}

export const LIMITES_HUB: LimitesHub = {
  publicas: { pedidos: 20, janelaMs: 60_000 },
  todas: { pedidos: 300, janelaMs: 60_000 },
};

/** Os oito grupos de 16 bits de um IPv6, ou null se não for um. */
function gruposIpv6(ip: string): number[] | null {
  const semZona = ip.split("%")[0] ?? "";
  if (isIP(semZona) !== 6) return null;
  const [cabeca = "", cauda] = semZona.split("::");
  const partes = (texto: string): number[] => {
    if (texto === "") return [];
    const grupos: number[] = [];
    for (const p of texto.split(":")) {
      if (p.includes(".")) {
        const [a = 0, b = 0, c = 0, d = 0] = p.split(".").map(Number);
        grupos.push((a << 8) | b, (c << 8) | d);
      } else {
        grupos.push(parseInt(p, 16));
      }
    }
    return grupos;
  };
  const inicio = partes(cabeca);
  const fim = cauda === undefined ? [] : partes(cauda);
  const zeros = 8 - inicio.length - fim.length;
  return [...inicio, ...new Array<number>(Math.max(zeros, 0)).fill(0), ...fim];
}

/**
 * O que se conta: um IPv4 inteiro; um IPv6 pela rede /64 (quem tem um IPv6
 * tem normalmente a rede inteira); um IPv4 dentro de IPv6 (`::ffff:a.b.c.d`)
 * como o IPv4.
 */
export function chaveDoIp(ip: string): string {
  if (isIP(ip) === 4) return ip;
  const g = gruposIpv6(ip);
  if (g === null) return `?${ip}`;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    const [, , , , , , alto = 0, baixo = 0] = g;
    return `${String(alto >> 8)}.${String(alto & 255)}.${String(baixo >> 8)}.${String(baixo & 255)}`;
  }
  return `${g
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(":")}::/64`;
}

/**
 * Um contador por IP numa janela fixa. Guarda no máximo `maximo` IPs: os
 * contadores ficam por ordem de início da janela, e quando está cheio saem
 * primeiro os que já acabaram e depois os mais antigos — nunca percorre a
 * tabela inteira por pedido.
 */
export class LimitePorIp {
  private readonly contas = new Map<string, { desde: number; n: number }>();

  constructor(
    private readonly regra: RegraLimite,
    private readonly maximo = 100_000,
    // Monotónico: um relógio do sistema que recua não estica a janela
    // (revisão do #154, P3-6).
    private readonly agora: () => number = () => performance.now(),
  ) {}

  /** Conta um pedido. Devolve 0 se passa, ou os segundos até poder voltar. */
  contar(ip: string): number {
    const chave = chaveDoIp(ip);
    const t = this.agora();
    let conta = this.contas.get(chave);
    if (conta === undefined || t - conta.desde >= this.regra.janelaMs) {
      if (conta !== undefined) this.contas.delete(chave);
      this.arrumar(t);
      conta = { desde: t, n: 0 };
      this.contas.set(chave, conta);
    }
    conta.n += 1;
    if (conta.n <= this.regra.pedidos) return 0;
    return Math.max(
      1,
      Math.ceil((conta.desde + this.regra.janelaMs - t) / 1000),
    );
  }

  /** Quantos IPs estão a ser contados (para os testes). */
  get tamanho(): number {
    return this.contas.size;
  }

  /** Tira os contadores de janela acabada (chamado de minuto a minuto). */
  limpar() {
    this.arrumar(this.agora(), false);
  }

  private arrumar(t: number, abrirLugar = true) {
    for (const [chave, conta] of this.contas) {
      if (t - conta.desde < this.regra.janelaMs) break;
      this.contas.delete(chave);
    }
    while (abrirLugar && this.contas.size >= this.maximo) {
      const primeira = this.contas.keys().next();
      if (primeira.done === true) break;
      this.contas.delete(primeira.value);
    }
  }
}

/**
 * Os endereços do proxy em que se confia para o `X-Forwarded-For`
 * (`PROXY_CONFIAVEL`, separados por vírgulas, ou «nenhum»; docs/21 §12 e §14). Só
 * endereços exactos: uma rede ou «true» deixava qualquer cliente escolher o
 * IP que é contado. Vazio: não se confia em nenhum.
 */
export function proxyConfiavel(texto: string | undefined): string[] {
  // «nenhum»: a API recebe os clientes directamente, sem proxy.
  if (texto?.trim() === "nenhum") return [];
  const enderecos = (texto ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "");
  for (const e of enderecos) {
    if (isIP(e) === 0) {
      throw new Error(
        `PROXY_CONFIAVEL: «${e}» não é um endereço IP (só endereços exactos)`,
      );
    }
  }
  return enderecos;
}
