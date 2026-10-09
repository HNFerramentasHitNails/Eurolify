// O adaptador do VIES (docs/23 §13.2; a API REST pública da Comissão
// Europeia, medida a 09/10/2026). Só o servidor consulta; o resultado guarda-se
// como prova pela `vies_registar` (migração 0039). Tudo o que não traz
// `valid: true` ou `valid: false` é `indisponivel`, com o código do erro: um
// VIES em baixo nunca isenta uma venda (R7).

/** O endereço por omissão: a API REST do VIES. */
export const VIES_URL =
  "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";

/** O tempo máximo de uma consulta (**proposta**, §13.4): 10 s. */
export const TEMPO_MAXIMO_MS = 10_000;

export interface PedidoVies {
  pais: string;
  numero: string;
  /** O NIF do comerciante (Q7); sem ele, a resposta vem sem número de consulta. */
  requerente: { pais: string; numero: string } | null;
}

export interface RespostaVies {
  resultado: "valido" | "invalido" | "indisponivel";
  /** O `requestDate` do VIES, quando o há. */
  dataVies: Date | null;
  identificador: string | null;
  nome: string | null;
  morada: string | null;
  /** Só num `indisponivel`. */
  codigoErro: string | null;
  /** O requerente que acabou por ir no pedido (sai se o VIES o recusar). */
  requerente: { pais: string; numero: string } | null;
}

/** Quem consulta: o VIES verdadeiro, ou um falso nos testes. */
export type ConsultaVies = (pedido: PedidoVies) => Promise<RespostaVies>;

/** O prefixo fiscal que o VIES espera (a Grécia é EL). */
const paraVies = (pais: string) => (pais === "GR" ? "EL" : pais);

/**
 * Um texto do VIES: `"---"` ou vazio é «não devolveu». Cortado ao tamanho da
 * coluna da prova: um nome mais comprido fazia a gravação falhar e a linha
 * ficar sempre à frente da fila (revisão do #244, P2-1).
 */
function texto(v: unknown, maximo: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" || t === "---" ? null : t.slice(0, maximo);
}

/** Os códigos que dizem «pedidos a mais»: o país fica de fora nesta volta. */
export const CODIGOS_DE_EXCESSO = new Set([
  "MS_MAX_CONCURRENT_REQ",
  "GLOBAL_MAX_CONCURRENT_REQ",
]);

function semResposta(
  codigo: string,
  requerente: PedidoVies["requerente"],
): RespostaVies {
  return {
    resultado: "indisponivel",
    dataVies: null,
    identificador: null,
    nome: null,
    morada: null,
    codigoErro: codigo.slice(0, 100),
    requerente,
  };
}

async function umaConsulta(
  url: string,
  pedido: PedidoVies,
  tempoMaximoMs: number,
): Promise<RespostaVies> {
  const corpo: Record<string, string> = {
    countryCode: paraVies(pedido.pais),
    vatNumber: pedido.numero,
  };
  if (pedido.requerente !== null) {
    corpo["requesterMemberStateCode"] = paraVies(pedido.requerente.pais);
    corpo["requesterNumber"] = pedido.requerente.numero;
  }
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(tempoMaximoMs),
    });
  } catch (erro) {
    const nome = (erro as { name?: unknown }).name;
    return semResposta(
      nome === "TimeoutError" ? "TEMPO_ESGOTADO" : "SEM_LIGACAO",
      pedido.requerente,
    );
  }
  let json: unknown;
  try {
    json = await resposta.json();
  } catch (erro) {
    // O tempo pode acabar a meio do corpo (revisão do #244, P3-3).
    const nome = (erro as { name?: unknown }).name;
    return semResposta(
      nome === "TimeoutError" || nome === "AbortError"
        ? "TEMPO_ESGOTADO"
        : `HTTP_${String(resposta.status)}`,
      pedido.requerente,
    );
  }
  const j = (json ?? {}) as Record<string, unknown>;
  // Um corpo com `actionSucceed: false`, ou um `userError` que não seja
  // VALID/INVALID, é sem resposta, mesmo com `valid` (revisão do #244, P2-7:
  // um erro de rede do país não pode tornar um cliente inválido).
  const erroDoUtilizador = j["userError"];
  const comErro =
    j["actionSucceed"] === false ||
    (typeof erroDoUtilizador === "string" &&
      erroDoUtilizador !== "VALID" &&
      erroDoUtilizador !== "INVALID");
  if (
    comErro &&
    typeof erroDoUtilizador === "string" &&
    /^[A-Z_0-9]{1,80}$/.test(erroDoUtilizador)
  ) {
    return semResposta(erroDoUtilizador, pedido.requerente);
  }
  if (!comErro && resposta.ok && typeof j["valid"] === "boolean") {
    const data =
      typeof j["requestDate"] === "string" ? new Date(j["requestDate"]) : null;
    return {
      resultado: j["valid"] ? "valido" : "invalido",
      dataVies: data !== null && !Number.isNaN(data.getTime()) ? data : null,
      identificador: texto(j["requestIdentifier"], 100),
      nome: texto(j["name"], 500),
      morada: texto(j["address"], 1000),
      codigoErro: null,
      requerente: pedido.requerente,
    };
  }
  const envoltorios = j["errorWrappers"];
  const primeiro = Array.isArray(envoltorios)
    ? (envoltorios[0] as { error?: unknown } | undefined)
    : undefined;
  const codigo =
    typeof primeiro?.error === "string" &&
    /^[A-Z_0-9]{1,80}$/.test(primeiro.error)
      ? primeiro.error
      : `HTTP_${String(resposta.status)}`;
  return semResposta(codigo, pedido.requerente);
}

/**
 * A consulta ao VIES verdadeiro. Se o VIES recusar o requerente
 * (`INVALID_REQUESTER_INFO`), repete sem ele: a prova fica sem número de
 * consulta (§13.4).
 */
export function consultaVies(
  url: string = VIES_URL,
  tempoMaximoMs: number = TEMPO_MAXIMO_MS,
  /** A pausa antes de repetir sem requerente (P2-4): o país recusa pedidos seguidos. */
  pausaMs = 1000,
): ConsultaVies {
  return async (pedido) => {
    const r = await umaConsulta(url, pedido, tempoMaximoMs);
    if (
      r.codigoErro === "INVALID_REQUESTER_INFO" &&
      pedido.requerente !== null
    ) {
      if (pausaMs > 0) await new Promise((ok) => setTimeout(ok, pausaMs));
      return umaConsulta(url, { ...pedido, requerente: null }, tempoMaximoMs);
    }
    return r;
  };
}
