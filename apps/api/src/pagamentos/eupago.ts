import { createHmac, timingSafeEqual } from "node:crypto";
import type { MetodoPagamento } from "../base/esquema.js";
import {
  ErroDeRede,
  type AdaptadorPagamento,
  type AvisoNormalizado,
  type CredenciaisConta,
  type EstadoNoPrestador,
  type LeituraAviso,
  type PedidoCobranca,
  type ResultadoCobranca,
} from "./adaptador.js";

// O adaptador EuPago, só em modo teste nesta parte (docs/26, Q1). Escrito
// pela documentação pública da API (docs.eupago.pt, lida a 09/10/2026, **W**):
// - MB WAY: POST /api/v1.02/mbway/create, cabeçalho `Authorization: ApiKey …`;
//   o cliente tem 5 minutos para aprovar.
// - Multibanco: POST /clientes/rest_api/multibanco/create, chave no corpo.
// - Consulta: POST /clientes/rest_api/multibanco/info; só o estado
//   «pendente» está documentado.
// - Avisos 2.0: POST com `X-Signature`, um HMAC-SHA256 em base64; a página
//   não diz sobre o que se calcula: aqui, sobre o corpo em bruto (**C**, a
//   confirmar na sandbox: V4 do docs/26). A cifra dos avisos não se suporta.
// Nada disto foi corrido contra a sandbox (não há credenciais de teste).

const BASE_DE_TESTE = "https://sandbox.eupago.pt";

/** O tempo de uma chamada à EuPago (proposta). */
export const TEMPO_DA_CHAMADA_MS = 10_000;

type Buscar = typeof fetch;

/** Os cêntimos em euros com duas casas, como a EuPago os pede. */
const emEuros = (centimos: number) => Math.round(centimos) / 100;

/** A data de Lisboa (AAAA-MM-DD) do fim do prazo, para a referência. */
const dataDeLisboa = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

async function chamar(
  buscar: Buscar,
  url: string,
  corpo: unknown,
  cabecalhos: Record<string, string> = {},
): Promise<{ estado: number; json: Record<string, unknown> }> {
  let r: Response;
  try {
    r = await buscar(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...cabecalhos },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TEMPO_DA_CHAMADA_MS),
    });
  } catch (erro) {
    throw new ErroDeRede("a EuPago não respondeu", { cause: erro });
  }
  if (r.status >= 500) {
    throw new ErroDeRede(`a EuPago respondeu ${String(r.status)}`);
  }
  let json: unknown;
  try {
    json = await r.json();
  } catch (erro) {
    throw new ErroDeRede("a resposta da EuPago não se lê", { cause: erro });
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new ErroDeRede("a resposta da EuPago não é um objecto");
  }
  return { estado: r.status, json: json as Record<string, unknown> };
}

const texto = (v: unknown) =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : null;

/** O telefone do MB WAY: só números portugueses nesta parte (+351 e 9 algarismos). */
export function telefoneMbWay(
  e164: string | null,
): { countryCode: string; customerPhone: string } | null {
  const m = e164 === null ? null : /^\+351([0-9]{9})$/.exec(e164);
  return m === null
    ? null
    : { countryCode: "+351", customerPhone: m[1] as string };
}

const ESTADO_DO_AVISO: Record<string, EstadoNoPrestador> = {
  paid: "capturado",
  error: "falhado",
  cancel: "falhado",
  canceled: "falhado",
  expired: "expirado",
};

function normalizarTransaccao(t: unknown): AvisoNormalizado | null {
  if (typeof t !== "object" || t === null) return null;
  const x = t as Record<string, unknown>;
  const trid = texto(x["trid"]);
  const estadoTexto = texto(x["status"]);
  if (trid === null || estadoTexto === null) return null;
  const amount = x["amount"];
  let montante: number | null = null;
  let moeda: string | null = null;
  if (typeof amount === "object" && amount !== null) {
    const a = amount as Record<string, unknown>;
    const valor =
      typeof a["value"] === "number"
        ? a["value"]
        : typeof a["value"] === "string" &&
            /^[0-9]+(\.[0-9]{1,2})?$/.test(a["value"])
          ? Number(a["value"])
          : null;
    montante = valor === null ? null : Math.round(valor * 100);
    moeda = texto(a["currency"]);
  }
  return {
    idEvento: `${trid}:${estadoTexto.toLowerCase()}`,
    referencia: texto(x["identifier"]),
    estado: ESTADO_DO_AVISO[estadoTexto.toLowerCase()] ?? "desconhecido",
    montante,
    moeda,
  };
}

export function adaptadorEuPago(buscar: Buscar = fetch): AdaptadorPagamento {
  const base = BASE_DE_TESTE;
  return {
    prestador: "eupago",
    metodos: [
      "mb_way",
      "multibanco",
    ] as const satisfies readonly MetodoPagamento[],

    // A EuPago não documenta uma chamada só para confirmar a chave: consulta
    // uma referência que não existe e recusa se a resposta falar da chave
    // (**C**, a confirmar na sandbox).
    async testar(credenciais: CredenciaisConta) {
      const r = await chamar(
        buscar,
        `${base}/clientes/rest_api/multibanco/info`,
        {
          chave: credenciais.chave,
          referencia: "000000000",
        },
      );
      const resposta = texto(r.json["resposta"]) ?? "";
      if (
        r.estado === 401 ||
        r.estado === 403 ||
        /chave|api ?key/i.test(resposta)
      ) {
        throw new Error("a EuPago recusou a chave");
      }
    },

    async cobrar(
      credenciais: CredenciaisConta,
      pedido: PedidoCobranca,
    ): Promise<ResultadoCobranca> {
      if (pedido.moeda !== "EUR") {
        return { estado: "falhado", motivo: "moeda_nao_suportada" };
      }
      if (pedido.metodo === "mb_way") {
        const tel = telefoneMbWay(pedido.telefone);
        if (tel === null)
          return { estado: "falhado", motivo: "telefone_nao_suportado" };
        const r = await chamar(
          buscar,
          `${base}/api/v1.02/mbway/create`,
          {
            payment: {
              identifier: pedido.referencia,
              amount: { value: emEuros(pedido.montante), currency: "EUR" },
              customerPhone: tel.customerPhone,
              countryCode: tel.countryCode,
            },
          },
          { authorization: `ApiKey ${credenciais.chave}` },
        );
        if (texto(r.json["transactionStatus"]) === "Success") {
          return {
            estado: "a_aguardar_cliente",
            referenciaPrestador: texto(r.json["reference"]),
            instrucoes: { metodo: "mb_way", aprovar_na_aplicacao: true },
          };
        }
        if (r.estado >= 400 || texto(r.json["transactionStatus"]) !== null) {
          return {
            estado: "falhado",
            motivo:
              texto(r.json["code"]) ??
              texto(r.json["transactionStatus"]) ??
              "recusado",
          };
        }
        throw new ErroDeRede("a resposta da EuPago não diz o estado");
      }
      const dataFim = dataDeLisboa(pedido.expiraEm);
      const r = await chamar(
        buscar,
        `${base}/clientes/rest_api/multibanco/create`,
        {
          chave: credenciais.chave,
          valor: emEuros(pedido.montante),
          id: pedido.referencia,
          data_fim: dataFim,
          per_dup: 0,
        },
      );
      if (r.json["sucesso"] === true) {
        const entidade = texto(r.json["entidade"]);
        const referencia = texto(r.json["referencia"]);
        if (entidade === null || referencia === null) {
          throw new ErroDeRede(
            "a EuPago não devolveu a entidade e a referência",
          );
        }
        return {
          estado: "a_aguardar_cliente",
          referenciaPrestador: referencia,
          instrucoes: {
            metodo: "multibanco",
            entidade,
            referencia,
            montante: pedido.montante,
            data_fim: dataFim,
          },
        };
      }
      if (r.json["sucesso"] === false) {
        return {
          estado: "falhado",
          motivo: texto(r.json["resposta"]) ?? "recusado",
        };
      }
      throw new ErroDeRede("a resposta da EuPago não diz o estado");
    },

    async consultar(credenciais, pagamento) {
      if (pagamento.referenciaPrestador === null) return "desconhecido";
      const instrucoes = (pagamento.instrucoes ?? {}) as Record<
        string,
        unknown
      >;
      const r = await chamar(
        buscar,
        `${base}/clientes/rest_api/multibanco/info`,
        {
          chave: credenciais.chave,
          referencia: pagamento.referenciaPrestador,
          ...(typeof instrucoes["entidade"] === "string"
            ? { entidade: instrucoes["entidade"] }
            : {}),
        },
      );
      // Só «pendente» está documentado; o resto decide uma pessoa.
      return texto(r.json["estado"]) === "pendente"
        ? "a_aguardar_cliente"
        : "desconhecido";
    },

    lerAviso(cabecalhos, corpo, segredo): LeituraAviso {
      const assinatura = cabecalhos["x-signature"];
      let json: unknown;
      try {
        json = JSON.parse(corpo);
      } catch {
        json = null;
      }
      const transaccoes =
        typeof json === "object" && json !== null
          ? (json as Record<string, unknown>)["transactions"]
          : undefined;
      const lista = Array.isArray(transaccoes)
        ? transaccoes
        : transaccoes === undefined
          ? []
          : [transaccoes];
      const eventos = lista
        .map(normalizarTransaccao)
        .filter((e): e is AvisoNormalizado => e !== null);
      const idEvento = eventos[0]?.idEvento ?? null;
      if (typeof assinatura !== "string" || assinatura === "") {
        return { valido: false, idEvento };
      }
      const esperada = createHmac("sha256", segredo)
        .update(corpo, "utf8")
        .digest();
      const recebida = Buffer.from(assinatura, "base64");
      if (
        recebida.length !== esperada.length ||
        !timingSafeEqual(recebida, esperada)
      ) {
        return { valido: false, idEvento };
      }
      if (
        typeof json === "object" &&
        json !== null &&
        typeof (json as Record<string, unknown>)["data"] === "string"
      ) {
        throw new Error(
          "aviso cifrado: desligue a cifra dos avisos no canal da EuPago",
        );
      }
      if (eventos.length === 0) {
        throw new Error("o aviso não traz transacções que se leiam");
      }
      return { valido: true, eventos };
    },
  };
}
