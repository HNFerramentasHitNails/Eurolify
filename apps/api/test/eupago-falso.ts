import { createHmac, randomBytes } from "node:crypto";
import type { ConfigPagamentos } from "../src/pagamentos/adaptador.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import { adaptadorEuPago } from "../src/pagamentos/eupago.js";

// Uma EuPago falsa para os testes: o adaptador verdadeiro (src/pagamentos/
// eupago.ts) com a rede trocada por respostas programáveis. Cada chamada fica
// registada (endereço, corpo, cabeçalhos) para os testes conferirem o que foi
// ao prestador.

export interface ChamadaEuPago {
  url: string;
  metodo: string;
  corpo: Record<string, unknown>;
  cabecalhos: Record<string, string>;
}

type Resposta = () => Response | Promise<Response>;

export const json = (estado: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), {
    status: estado,
    headers: { "content-type": "application/json" },
  });

export function eupagoFalso() {
  const chamadas: ChamadaEuPago[] = [];
  const respostas: {
    mbway?: Resposta;
    multibanco?: Resposta;
    info?: Resposta;
    teste?: Resposta;
    // O reembolso (docs/30 §13): o token OAuth, o pedido e a consulta.
    token?: Resposta;
    reembolso?: Resposta;
    consultaReembolso?: Resposta;
  } = {};
  let n = 0;
  const buscar = (async (url: string, init?: RequestInit) => {
    const endereco = url;
    const corpo = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as Record<string, unknown>;
    chamadas.push({
      url: endereco,
      metodo: init?.method ?? "GET",
      corpo,
      cabecalhos: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      ),
    });
    n += 1;
    if (endereco.endsWith("/api/v1.02/mbway/create")) {
      return (
        (await respostas.mbway?.()) ??
        json(201, {
          transactionStatus: "Success",
          transactionID: `t${String(n)}`,
          reference: String(1000000 + n),
        })
      );
    }
    if (endereco.endsWith("/clientes/rest_api/multibanco/create")) {
      return (
        (await respostas.multibanco?.()) ??
        json(200, {
          sucesso: true,
          estado: 0,
          resposta: "OK",
          referencia: String(100000000 + n),
          entidade: "12345",
          valor: String(corpo["valor"]),
          data_fim: corpo["data_fim"],
        })
      );
    }
    if (endereco.endsWith("/clientes/rest_api/multibanco/info")) {
      if (corpo["referencia"] === "000000000") {
        return (
          (await respostas.teste?.()) ??
          json(200, {
            sucesso: false,
            estado: -10,
            resposta: "Referência inexistente",
          })
        );
      }
      return (
        (await respostas.info?.()) ??
        json(200, {
          sucesso: true,
          estado: "pendente",
          referencia: corpo["referencia"],
        })
      );
    }
    if (endereco.endsWith("/api/auth/token")) {
      return (
        (await respostas.token?.()) ??
        json(200, {
          transactionStatus: "Success",
          access_token: `tok${String(n)}`,
          token_type: "Bearer",
          expires_in: "2026-10-11 12:00:00",
        })
      );
    }
    if (/\/api\/management\/v1\.02\/refund\/[^/]+$/.test(endereco)) {
      if (init?.method === "GET") {
        return (
          (await respostas.consultaReembolso?.()) ??
          json(200, {
            transactionStatus: "Success",
            refundList: { trid: "1", status: "reembolsado" },
          })
        );
      }
      return (
        (await respostas.reembolso?.()) ??
        json(201, { transactionStatus: "Success", refundId: String(9000 + n) })
      );
    }
    return json(404, { erro: "desconhecido" });
  }) as typeof fetch;
  const config: ConfigPagamentos = {
    chave: chavePagamentos(randomBytes(32).toString("base64")),
    adaptadores: { eupago: adaptadorEuPago(buscar) },
  };
  return { chamadas, respostas, config };
}

/** A assinatura dos avisos 2.0: HMAC-SHA256 do corpo em bruto, em base64. */
export const assinar = (corpo: string, segredo: string) =>
  createHmac("sha256", segredo).update(corpo, "utf8").digest("base64");

/** Um aviso 2.0 da EuPago, como a documentação o descreve (W, 09/10/2026). */
export const avisoEuPago = (t: {
  identifier: string;
  status: "Paid" | "Error" | "Cancel" | "Expired" | "Refund";
  valor: number;
  trid?: number;
  method?: string;
}) =>
  JSON.stringify({
    transactions: {
      entity: 12345,
      reference: 123456789,
      identifier: t.identifier,
      method: t.method ?? "Multibanco",
      amount: { value: t.valor, currency: "EUR" },
      fees: { value: 0.1, currency: "EUR" },
      date: "2026-10-09T12:00:00Z",
      trid: t.trid ?? 555,
      status: t.status,
    },
    channel: { name: "Produtos" },
  });
