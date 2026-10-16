// Os erros do checkout (docs/25 §8.4; migração 0041).

export type CodigoErroCheckout =
  | "checkout.not_found"
  | "checkout.invalid_field"
  | "checkout.retry"
  | "checkout.expired"
  | "checkout.closed"
  | "checkout.version_conflict"
  | "checkout.incomplete"
  | "checkout.legal_text_missing"
  | "checkout.legal_not_accepted"
  | "checkout.vat_blocked"
  | "checkout.total_changed"
  | "checkout.variant_unavailable"
  | "checkout.no_delivery_method"
  | "checkout.country_not_served"
  | "checkout.empty_cart"
  | "checkout.payment_unavailable"
  | "checkout.out_of_stock"
  | "checkout.pickup_point_required"
  | "checkout.pickup_point_unavailable"
  | "checkout.pickup_point_outside_zone"
  | "checkout.too_many_searches"
  | "checkout.carrier_unavailable"
  | "cart.not_open"
  | "cart.secret_invalid"
  | "cart.min_quantity"
  | "cart.too_many_lines"
  | "cart.limit_reached"
  | "legal.version_immutable"
  | "legal.duplicate"
  | "orders.immutable";

export const ESTADO_DO_CODIGO: Record<CodigoErroCheckout, number> = {
  "checkout.not_found": 404,
  "checkout.invalid_field": 400,
  "checkout.retry": 503,
  "checkout.expired": 410,
  "checkout.closed": 409,
  "checkout.version_conflict": 409,
  "checkout.incomplete": 422,
  "checkout.legal_text_missing": 422,
  "checkout.legal_not_accepted": 422,
  "checkout.vat_blocked": 422,
  "checkout.total_changed": 409,
  "checkout.variant_unavailable": 422,
  "checkout.no_delivery_method": 422,
  "checkout.country_not_served": 422,
  "checkout.empty_cart": 422,
  "checkout.payment_unavailable": 422,
  "checkout.out_of_stock": 422,
  // Entrega num ponto de recolha (docs/36 §21).
  "checkout.pickup_point_required": 422,
  "checkout.pickup_point_unavailable": 409,
  "checkout.pickup_point_outside_zone": 422,
  "checkout.too_many_searches": 429,
  "checkout.carrier_unavailable": 503,
  "cart.not_open": 409,
  "cart.secret_invalid": 404,
  "cart.min_quantity": 422,
  "cart.too_many_lines": 422,
  // O tecto de carrinhos abertos da loja (docs/25 §14).
  "cart.limit_reached": 429,
  "legal.version_immutable": 409,
  "legal.duplicate": 409,
  "orders.immutable": 409,
};

export class ErroCheckout extends Error {
  constructor(
    readonly codigo: CodigoErroCheckout,
    mensagem: string,
    readonly pormenor?: unknown,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroCheckout";
  }
}
