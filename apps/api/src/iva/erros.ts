// Os erros do Motor de IVA (docs/24; migração 0040).

export type CodigoErroIva =
  | "tax.not_found"
  | "tax.invalid_field"
  | "tax.retry"
  | "tax.declaration_by_person"
  | "tax.invalid_registration"
  | "tax.profile_archived";

export class ErroIva extends Error {
  constructor(
    readonly codigo: CodigoErroIva,
    mensagem: string,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroIva";
  }
}
