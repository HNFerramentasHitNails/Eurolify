// Os erros dos envios (docs/36 §7.4; migração 0074).

export type CodigoErroEnvios =
  | "shipping.not_found"
  | "shipping.invalid_field"
  | "shipping.retry"
  | "shipping.version_conflict"
  | "shipping.immutable"
  | "shipping.not_configured"
  | "shipping.account_not_ready"
  | "shipping.service_unknown"
  | "shipping.carrier_unavailable"
  // Parte B (docs/36 §7.4).
  | "shipping.label_exists"
  | "shipping.label_uncertain"
  | "shipping.label_refused"
  | "shipping.void_not_allowed"
  | "shipping.invalid_transition"
  | "shipping.signature_invalid"
  // As contas pelo Hub (docs/22 §29): um método activo impede-o.
  | "shipping.account_in_use"
  | "shipping.service_in_use"
  // Uma IA não muda o serviço de uma expedição (docs/36 §19.3).
  | "shipping.ai_not_allowed";

export const ESTADO_DO_CODIGO: Record<CodigoErroEnvios, number> = {
  "shipping.not_found": 404,
  "shipping.invalid_field": 400,
  "shipping.retry": 503,
  "shipping.version_conflict": 409,
  "shipping.immutable": 409,
  "shipping.not_configured": 503,
  "shipping.account_not_ready": 422,
  "shipping.service_unknown": 422,
  "shipping.carrier_unavailable": 503,
  "shipping.label_exists": 409,
  "shipping.label_uncertain": 409,
  "shipping.label_refused": 422,
  "shipping.void_not_allowed": 409,
  "shipping.invalid_transition": 409,
  "shipping.signature_invalid": 401,
  "shipping.account_in_use": 409,
  "shipping.ai_not_allowed": 403,
  "shipping.service_in_use": 409,
};

export class ErroEnvios extends Error {
  constructor(
    readonly codigo: CodigoErroEnvios,
    mensagem: string,
    readonly pormenor?: unknown,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroEnvios";
  }
}
