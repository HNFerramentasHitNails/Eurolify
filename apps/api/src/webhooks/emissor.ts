import { lookup } from "node:dns/promises";
import { request as pedidoHttps } from "node:https";
import { isIP } from "node:net";
import { enderecoPublico, validarUrlDeWebhook } from "./url.js";

// O envio HTTP para fora (docs/38 §6 e §8). Injectável: os testes trocam o
// emissor e não há rede. O verdadeiro resolve o nome, recusa se algum
// endereço não for público, liga-se ao endereço verificado (sem segunda
// resolução: contra DNS rebinding), não segue redirecções e **não lê a
// resposta**: depois do código, destrói a ligação. Um prazo **total** de 10 s
// cobre tudo — o DNS, a ligação, o TLS, cabeçalhos a pingar, `100 Continue`
// sem fim — porque um receptor lento parava o publicador de todos os
// comerciantes (revisão do #477, P1-1 e P3-7).

export interface PedidoDeEnvio {
  url: string;
  corpo: string;
  cabecalhos: Record<string, string>;
}

/** O código HTTP, ou um código curto do erro (nunca texto do receptor). */
export type ResultadoDoEnvio = { estado: number } | { erro: string };

export type Emissor = (pedido: PedidoDeEnvio) => Promise<ResultadoDoEnvio>;

const LIMITE_MS = 10_000;

type Resolver = (
  nome: string,
) => Promise<{ address: string; family: number }[]>;

export interface OpcoesDoEmissor {
  resolver?: Resolver;
  /** O prazo total de cada pedido. */
  limiteMs?: number;
  /** Só os testes: quem decide se um endereço serve (por omissão, só os públicos). */
  endereco?: (ip: string) => boolean;
  /** Só os testes: troca o `https.request` (um servidor local sem TLS). */
  pedido?: typeof pedidoHttps;
}

export function emissorHttps(opcoes: OpcoesDoEmissor = {}): Emissor {
  const resolver: Resolver =
    opcoes.resolver ?? ((nome) => lookup(nome, { all: true }));
  const limiteMs = opcoes.limiteMs ?? LIMITE_MS;
  const serve = opcoes.endereco ?? enderecoPublico;
  const pedir = opcoes.pedido ?? pedidoHttps;
  return async ({ url, corpo, cabecalhos }) => {
    let u: URL;
    try {
      u = new URL(validarUrlDeWebhook(url));
    } catch {
      return { erro: "webhooks.url_refused" };
    }
    const sinal = AbortSignal.timeout(limiteMs);
    const aberto = new Promise<never>((_resolve, rejeitar) => {
      sinal.addEventListener("abort", () => {
        rejeitar(new Error("webhooks.timeout"));
      });
    });
    // Se a corrida acabar antes, o `aberto` rejeitado depois não é um erro.
    aberto.catch(() => undefined);
    let enderecos: { address: string; family: number }[];
    try {
      enderecos = await Promise.race([resolver(u.hostname), aberto]);
    } catch (erro) {
      return {
        erro:
          erro instanceof Error && erro.message === "webhooks.timeout"
            ? "webhooks.timeout"
            : "webhooks.dns",
      };
    }
    const escolhido = enderecos[0];
    if (escolhido === undefined || enderecos.some((e) => !serve(e.address))) {
      return { erro: "webhooks.address_refused" };
    }
    return new Promise<ResultadoDoEnvio>((resolve) => {
      let acabou = false;
      const acabar = (r: ResultadoDoEnvio) => {
        if (acabou) return;
        acabou = true;
        resolve(r);
      };
      const pedido = pedir(
        {
          host: escolhido.address,
          family: escolhido.family,
          port: 443,
          path: `${u.pathname}${u.search}`,
          method: "POST",
          // O SNI é o nome; com um IP literal não se põe (P3-5).
          ...(isIP(u.hostname) === 0 ? { servername: u.hostname } : {}),
          headers: {
            ...cabecalhos,
            Host: u.host,
            "Content-Length": Buffer.byteLength(corpo).toString(),
          },
          agent: false,
          signal: sinal,
        },
        (resposta) => {
          const estado = resposta.statusCode ?? 0;
          // Não se lê a resposta: fecha-se a ligação (um corpo sem fim não
          // prende nada).
          resposta.destroy();
          acabar({ estado });
        },
      );
      pedido.on("error", () => {
        acabar({
          erro: sinal.aborted ? "webhooks.timeout" : "webhooks.connection",
        });
      });
      // Os cabeçalhos informativos (1xx) a pingar também acabam no prazo.
      sinal.addEventListener("abort", () => {
        acabar({ erro: "webhooks.timeout" });
        pedido.destroy();
      });
      pedido.end(corpo);
    });
  };
}
