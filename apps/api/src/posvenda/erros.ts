// Os erros da pós-venda (docs/30; migração 0058).

export type CodigoErroPosVenda =
  | "returns.not_found"
  | "returns.invalid_field"
  | "returns.invalid_transition"
  | "returns.quantity_exceeded"
  | "returns.not_consumer"
  | "returns.no_warehouse"
  | "returns.version_conflict"
  | "returns.immutable"
  | "returns.retry"
  | "returns.hygiene_decision_required"
  | "refunds.not_found"
  | "refunds.invalid_field"
  | "refunds.invalid_transition"
  | "refunds.exceeds_paid"
  | "refunds.not_refundable"
  | "refunds.version_conflict"
  | "refunds.immutable"
  | "refunds.manual_only";

export const ESTADO_DO_CODIGO: Record<CodigoErroPosVenda, number> = {
  "returns.not_found": 404,
  "returns.invalid_field": 400,
  "returns.invalid_transition": 409,
  "returns.quantity_exceeded": 422,
  "returns.not_consumer": 422,
  "returns.no_warehouse": 422,
  "returns.version_conflict": 409,
  "returns.immutable": 409,
  "returns.retry": 503,
  // Uma linha selada voltou aberta: uma pessoa decide (docs/30 §15, H6).
  "returns.hygiene_decision_required": 422,
  "refunds.not_found": 404,
  "refunds.invalid_field": 400,
  "refunds.invalid_transition": 409,
  "refunds.exceeds_paid": 422,
  "refunds.not_refundable": 422,
  "refunds.version_conflict": 409,
  "refunds.immutable": 409,
  // Não se reembolsa pelo prestador (Multibanco, sem o trid, sem OAuth):
  // regista-se à mão (docs/30 §13).
  "refunds.manual_only": 422,
};

export class ErroPosVenda extends Error {
  constructor(
    readonly codigo: CodigoErroPosVenda,
    mensagem: string,
    readonly pormenor?: unknown,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroPosVenda";
  }
}

const DA_BASE = Object.keys(ESTADO_DO_CODIGO) as CodigoErroPosVenda[];

export function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error) || erro instanceof ErroPosVenda) return erro;
  const codigo = DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroPosVenda(codigo, erro.message, undefined, { cause: erro });
  }
  // As recusas do livro do stock e da encomenda chegam como erros dela.
  // As da faturação e dos pagamentos também (revisão do #329, P3-11).
  if (/^(inventory|orders|invoices|payments)\.[a-z_]+:/.test(erro.message)) {
    return new ErroPosVenda(
      "returns.invalid_transition",
      erro.message,
      undefined,
      {
        cause: erro,
      },
    );
  }
  const pg = erro as Error & { code?: string; constraint?: string };
  if (
    pg.code === "23503" ||
    (pg.code === "22P02" && /uuid/.test(erro.message))
  ) {
    return new ErroPosVenda("returns.not_found", "não existe", undefined, {
      cause: erro,
    });
  }
  if (pg.code === "23514" || pg.code === "22001") {
    return new ErroPosVenda(
      "returns.invalid_field",
      "um valor do pedido não é aceite",
      undefined,
      { cause: erro },
    );
  }
  if (pg.code === "23505") {
    return new ErroPosVenda(
      "returns.invalid_transition",
      "já existe (um pedido repetido)",
      undefined,
      { cause: erro },
    );
  }
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
    return new ErroPosVenda("returns.retry", "tentar outra vez", undefined, {
      cause: erro,
    });
  }
  return erro;
}
