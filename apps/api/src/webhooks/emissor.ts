import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { enderecoPublico, validarUrlDeWebhook } from "./url.js";

// O envio HTTP para fora (docs/38 §6 e §8). Injectável: os testes trocam o
// emissor e não há rede. O verdadeiro resolve o nome, recusa se algum
// endereço não for público, liga-se ao endereço verificado (sem segunda
// resolução: contra DNS rebinding), não segue redirecções, não lê a resposta
// e acaba ao fim de 10 s.

export interface PedidoDeEnvio {
  url: string;
  corpo: string;
  cabecalhos: Record<string, string>;
}

/** O código HTTP, ou um código curto do erro (nunca texto do receptor). */
export type ResultadoDoEnvio = { estado: number } | { erro: string };

export type Emissor = (pedido: PedidoDeEnvio) => Promise<ResultadoDoEnvio>;

const LIMITE_MS = 10_000;

export function emissorHttps(
  resolver: (nome: string) => Promise<{ address: string; family: number }[]> = (
    nome,
  ) => lookup(nome, { all: true }),
  limiteMs = LIMITE_MS,
): Emissor {
  return async ({ url, corpo, cabecalhos }) => {
    let u: URL;
    try {
      u = new URL(validarUrlDeWebhook(url));
    } catch {
      return { erro: "webhooks.url_refused" };
    }
    let enderecos: { address: string; family: number }[];
    try {
      enderecos = await resolver(u.hostname);
    } catch {
      return { erro: "webhooks.dns" };
    }
    const escolhido = enderecos[0];
    if (
      escolhido === undefined ||
      enderecos.some((e) => !enderecoPublico(e.address))
    ) {
      return { erro: "webhooks.address_refused" };
    }
    return new Promise<ResultadoDoEnvio>((resolve) => {
      const pedido = request(
        {
          host: escolhido.address,
          family: escolhido.family,
          port: 443,
          path: `${u.pathname}${u.search}`,
          method: "POST",
          servername: u.hostname,
          headers: {
            ...cabecalhos,
            Host: u.host,
            "Content-Length": Buffer.byteLength(corpo).toString(),
          },
          timeout: limiteMs,
          agent: false,
        },
        (resposta) => {
          resposta.resume();
          resolve({ estado: resposta.statusCode ?? 0 });
        },
      );
      pedido.on("timeout", () => {
        pedido.destroy();
        resolve({ erro: "webhooks.timeout" });
      });
      pedido.on("error", () => {
        resolve({ erro: "webhooks.connection" });
      });
      pedido.end(corpo);
    });
  };
}
