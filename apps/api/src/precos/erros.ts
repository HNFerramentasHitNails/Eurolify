// Os erros de Preços e mercados, num módulo próprio: o Catálogo usa-os (pela
// pergunta da C2, verificacao.ts) sem importar o repositório de Preços, que
// por sua vez chama a reverificação do Catálogo (revisão do #146, P3-2).

export type CodigoErroPrecos =
  | "prices.not_found"
  | "prices.invalid_transition"
  | "prices.immutable_identity"
  | "prices.market_has_prices"
  | "prices.base_list_required"
  | "prices.base_list_in_use"
  | "prices.base_list_duplicate"
  | "prices.country_in_other_market"
  | "prices.defined_by_required"
  | "prices.list_archived"
  | "prices.version_conflict"
  | "prices.name_required"
  | "prices.country_invalid"
  | "prices.currency_invalid"
  | "prices.language_invalid"
  | "prices.main_language_not_listed"
  | "prices.free_only_at_zero"
  | "prices.amount_invalid"
  | "prices.quantity_invalid"
  | "prices.b2b_label_required"
  | "prices.priority_duplicate"
  | "prices.label_duplicate"
  | "prices.label_archived"
  | "prices.channel_market_duplicate"
  | "prices.channel_market_in_use"
  | "prices.published_variant"
  | "prices.invalid_field"
  | "prices.reduction_without_history"
  | "prices.reduction_not_lower"
  | "prices.reduction_active"
  | "prices.retry";

export class ErroPrecos extends Error {
  constructor(
    readonly codigo: CodigoErroPrecos,
    mensagem: string,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroPrecos";
  }
}
