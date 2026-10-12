// Os erros dos envios (docs/36 §7.4; migração 0073).

export type CodigoErroEnvios =
  | "shipping.not_found"
  | "shipping.invalid_field"
  | "shipping.retry"
  | "shipping.version_conflict"
  | "shipping.immutable"
  | "shipping.not_configured"
  | "shipping.account_not_ready"
  | "shipping.service_unknown"
  | "shipping.carrier_unavailable";

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
