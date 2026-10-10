// Os erros de Clientes e perfis de faturação (docs/23; migração 0037).

export type CodigoErroClientes =
  | "customers.not_found"
  | "customers.invalid_field"
  | "customers.retry"
  | "customers.version_conflict"
  | "customers.invalid_transition"
  | "customers.immutable_identity"
  | "customers.name_required"
  | "customers.email_invalid"
  | "customers.phone_invalid"
  | "customers.language_invalid"
  | "customers.country_invalid"
  | "customers.nif_invalid"
  | "customers.nif_country_required"
  | "customers.company_requires_nif"
  | "customers.address_incomplete"
  | "customers.profile_used"
  | "customers.primary_profile"
  | "customers.tag_duplicate"
  | "customers.tag_in_use"
  | "customers.tag_archived"
  | "customers.change_without_who"
  | "customers.vies_not_applicable"
  | "customers.vies_disabled"
  | "customers.exemption_active"
  | "customers.exemption_by_person"
  | "customers.exemption_immutable"
  | "customers.exemption_reason_code"
  | "customers.merge_same"
  | "customers.merge_by_person"
  | "customers.merge_too_many_contacts"
  | "customers.duplicate_decided"
  | "customers.confirmation_required"
  | "customers.restricted";

export class ErroClientes extends Error {
  constructor(
    readonly codigo: CodigoErroClientes,
    mensagem: string,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroClientes";
  }
}
