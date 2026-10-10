// Os erros dos pagamentos (docs/26 §8.4; migração 0042).

export type CodigoErroPagamentos =
  | "payments.not_found"
  | "payments.invalid_field"
  | "payments.retry"
  | "payments.version_conflict"
  | "payments.method_unavailable"
  | "payments.live_exists"
  | "payments.provider_unavailable"
  | "payments.account_not_ready"
  | "payments.signature_invalid"
  | "payments.invalid_transition"
  | "payments.order_not_payable"
  | "payments.not_configured"
  | "payments.immutable"
  | "payments.issue_needs_person";

export const ESTADO_DO_CODIGO: Record<CodigoErroPagamentos, number> = {
  "payments.not_found": 404,
  "payments.invalid_field": 400,
  "payments.retry": 503,
  "payments.version_conflict": 409,
  "payments.method_unavailable": 422,
  "payments.live_exists": 409,
  "payments.provider_unavailable": 503,
  "payments.account_not_ready": 422,
  "payments.signature_invalid": 401,
  "payments.invalid_transition": 409,
  "payments.order_not_payable": 409,
  "payments.not_configured": 503,
  "payments.immutable": 409,
  "payments.issue_needs_person": 403,
};

export class ErroPagamentos extends Error {
  constructor(
    readonly codigo: CodigoErroPagamentos,
    mensagem: string,
    readonly pormenor?: unknown,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroPagamentos";
  }
}
