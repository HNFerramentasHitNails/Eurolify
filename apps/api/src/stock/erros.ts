// Os erros do stock e das expedições (docs/27 §7.3). Ficam num ficheiro sem
// dependências para o Hub poder conferir os códigos que mostra (revisão do
// #418, P1-1).

export type CodigoErroStock =
  | "inventory.not_found"
  | "inventory.invalid_field"
  | "inventory.retry"
  | "inventory.version_conflict"
  | "inventory.insufficient"
  | "inventory.lot_required"
  | "inventory.negative"
  | "inventory.not_controlled"
  | "inventory.no_warehouse"
  | "inventory.policy_blocked"
  | "shipments.immutable"
  | "shipments.invalid_transition"
  | "shipments.line_not_in_order"
  | "shipments.quantity_exceeded"
  | "orders.invalid_transition";

export const ESTADO_DO_CODIGO: Record<CodigoErroStock, number> = {
  "inventory.not_found": 404,
  "inventory.invalid_field": 400,
  "inventory.retry": 503,
  "inventory.version_conflict": 409,
  "inventory.insufficient": 422,
  "inventory.lot_required": 422,
  "inventory.negative": 422,
  "inventory.not_controlled": 422,
  "inventory.no_warehouse": 422,
  "inventory.policy_blocked": 409,
  "shipments.immutable": 409,
  "shipments.invalid_transition": 409,
  "shipments.line_not_in_order": 422,
  "shipments.quantity_exceeded": 422,
  "orders.invalid_transition": 409,
};

export class ErroStock extends Error {
  constructor(
    readonly codigo: CodigoErroStock,
    mensagem: string,
    readonly pormenor?: unknown,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroStock";
  }
}
