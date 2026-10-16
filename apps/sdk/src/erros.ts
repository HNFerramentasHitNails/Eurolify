// Os erros do SDK (docs/39 §6). A API devolve sempre o mesmo formato (RFC
// 9457, com `codigo` estável); o SDK entrega-o tal e qual, sem o traduzir nem
// o engolir, e nunca devolve um erro como se fosse um sucesso.

/** O corpo `application/problem+json` da API (docs/18 §3). */
export interface Problema {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** O identificador do pedido: quem pede ajuda diz este. */
  instance: string;
  /** Código estável (ex.: `inventory.insufficient`): é por ele que se decide. */
  codigo: string;
  mensagem: { pt: string; en: string };
  erros?: { campo: string; mensagem: string }[];
}

/** A API respondeu com um erro. */
export class ErroDaApi extends Error {
  override readonly name = "ErroDaApi";
  readonly estado: number;
  /** O código estável do erro; `sdk.resposta_inesperada` se a resposta não era um problema. */
  readonly codigo: string;
  /** O problema como a API o mandou; ausente se a resposta não era um problema. */
  readonly problema: Problema | undefined;
  /** O identificador do pedido (`instance`), se a API o mandou. */
  readonly pedido: string | undefined;
  /** Segundos a esperar (cabeçalho `Retry-After`, nos 429/503), se houver. */
  readonly esperarSegundos: number | undefined;
  readonly cabecalhos: Headers;

  constructor(
    estado: number,
    problema: Problema | undefined,
    cabecalhos: Headers,
  ) {
    super(
      problema === undefined
        ? `a API respondeu ${String(estado)} sem um problema (RFC 9457)`
        : `${problema.codigo}: ${problema.mensagem.pt}`,
    );
    this.estado = estado;
    this.problema = problema;
    this.codigo = problema?.codigo ?? "sdk.resposta_inesperada";
    this.pedido = problema?.instance;
    this.cabecalhos = cabecalhos;
    const espera = Number(cabecalhos.get("retry-after"));
    this.esperarSegundos =
      Number.isFinite(espera) && cabecalhos.has("retry-after")
        ? espera
        : undefined;
  }
}

/** O pedido não chegou a ter resposta (rede, tempo esgotado, cancelado). */
export class ErroDeRede extends Error {
  override readonly name = "ErroDeRede";
  /**
   * Numa escrita, **não se sabe** se o servidor a fez: repetir só com a
   * mesma chave de idempotência (docs/39 §7).
   */
  readonly metodo: string;
  readonly caminho: string;

  constructor(metodo: string, caminho: string, causa: unknown) {
    super(`sem resposta de ${metodo.toUpperCase()} ${caminho}`, {
      cause: causa,
    });
    this.metodo = metodo;
    this.caminho = caminho;
  }
}

/** Uso errado do SDK ou resposta que o contrato não prevê (um erro nosso, não da API). */
export class ErroDoSdk extends Error {
  override readonly name = "ErroDoSdk";
}

function ehTexto(valor: unknown): valor is string {
  return typeof valor === "string";
}

/** Lê um problema do corpo; `undefined` se não tiver a forma do RFC 9457 do Eurolify. */
export function lerProblema(corpo: unknown): Problema | undefined {
  if (typeof corpo !== "object" || corpo === null) return undefined;
  const c = corpo as Record<string, unknown>;
  const m = c["mensagem"] as Record<string, unknown> | null | undefined;
  if (
    !ehTexto(c["codigo"]) ||
    !ehTexto(c["type"]) ||
    !ehTexto(c["title"]) ||
    !ehTexto(c["instance"]) ||
    typeof c["status"] !== "number" ||
    typeof m !== "object" ||
    m === null ||
    !ehTexto(m["pt"]) ||
    !ehTexto(m["en"])
  ) {
    return undefined;
  }
  return corpo as Problema;
}
