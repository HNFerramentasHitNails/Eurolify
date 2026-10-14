// Os erros dos documentos fiscais (docs/29 §7.2; migração 0050).

export type CodigoErroDocumentos =
  | "invoices.not_found"
  | "invoices.invalid_field"
  | "invoices.invalid_transition"
  | "invoices.version_conflict"
  | "invoices.issuer_not_ready"
  | "invoices.issuer_error"
  | "invoices.issuer_busy"
  | "invoices.uncertain"
  | "invoices.immutable"
  | "invoices.other_issuer"
  | "invoices.not_configured"
  | "invoices.account_in_use"
  | "invoices.retry";

export const ESTADO_DO_CODIGO: Record<CodigoErroDocumentos, number> = {
  "invoices.not_found": 404,
  "invoices.invalid_field": 400,
  "invoices.invalid_transition": 409,
  "invoices.version_conflict": 409,
  "invoices.issuer_not_ready": 422,
  "invoices.issuer_error": 502,
  "invoices.issuer_busy": 409,
  "invoices.uncertain": 409,
  "invoices.immutable": 409,
  "invoices.other_issuer": 409,
  "invoices.not_configured": 503,
  "invoices.account_in_use": 409,
  "invoices.retry": 503,
};

export class ErroDocumentos extends Error {
  constructor(
    readonly codigo: CodigoErroDocumentos,
    mensagem: string,
    readonly pormenor?: unknown,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroDocumentos";
  }
}

/**
 * A recusa da mesma conta do emissor noutra ligação (docs/29 §19, Q1 «B»):
 * nunca diz de que comerciante nem de que entidade.
 */
export const CONTA_EM_USO =
  "esta empresa do Moloni já está ligada a outra conta do Eurolify; se é sua, desligue-a lá primeiro, ou fale com o apoio do Eurolify";

/** Os erros da base com o código à frente (`invoices.x: …`). */
const DA_BASE: CodigoErroDocumentos[] = [
  "invoices.not_found",
  "invoices.invalid_field",
  "invoices.invalid_transition",
  "invoices.issuer_busy",
  "invoices.immutable",
  "invoices.other_issuer",
];

export function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error) || erro instanceof ErroDocumentos) return erro;
  const codigo = DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroDocumentos(codigo, erro.message, undefined, {
      cause: erro,
    });
  }
  if (erro.message.startsWith("invoices.order_not_paid:")) {
    return new ErroDocumentos("invoices.invalid_transition", erro.message);
  }
  const pg = erro as Error & { code?: string; constraint?: string };
  if (
    pg.code === "23505" &&
    pg.constraint === "ligacao_faturacao_uma_por_conta"
  ) {
    return new ErroDocumentos(
      "invoices.account_in_use",
      CONTA_EM_USO,
      undefined,
      { cause: erro },
    );
  }
  if (pg.code === "23505" && pg.constraint === "ligacao_faturacao_uma_activa") {
    return new ErroDocumentos(
      "invoices.invalid_field",
      "esta entidade já tem uma ligação activa",
      undefined,
      { cause: erro },
    );
  }
  if (
    pg.code === "23503" ||
    (pg.code === "22P02" && /uuid/.test(erro.message))
  ) {
    return new ErroDocumentos("invoices.not_found", "não existe", undefined, {
      cause: erro,
    });
  }
  if (pg.code === "23514" || pg.code === "22001") {
    return new ErroDocumentos(
      "invoices.invalid_field",
      "um valor do pedido não é aceite",
      undefined,
      { cause: erro },
    );
  }
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
    return new ErroDocumentos("invoices.retry", "tentar outra vez", undefined, {
      cause: erro,
    });
  }
  return erro;
}
