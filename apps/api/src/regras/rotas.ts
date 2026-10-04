import { Type, type Static } from "typebox";
import type { Registo } from "./tipos.js";

const EstadoDominio = Type.Union([
  Type.Literal("por_verificar"),
  Type.Literal("verificado"),
  Type.Literal("nao_aplicavel"),
]);

export const RespostaPaises = Type.Object({
  versaoRegisto: Type.Integer(),
  paises: Type.Array(
    Type.Object({
      codigo: Type.String(),
      nome: Type.String(),
      dominios: Type.Record(Type.String(), EstadoDominio),
      territoriosMapeados: Type.Boolean(),
    }),
  ),
});

/**
 * Corpo do GET /paises (docs/eurolify/architecture.md §4.3): a cobertura dos
 * 27 países, só com o estado da revisão de cada domínio. Sem dados pessoais e
 * sem a decisão, que é interna — os frontends não a refazem.
 */
export function coberturaPaises(
  registo: Registo,
): Static<typeof RespostaPaises> {
  return {
    versaoRegisto: registo.versao,
    paises: registo.paises.map((perfil) => ({
      codigo: perfil.codigo,
      nome: perfil.nome,
      dominios: Object.fromEntries(
        Object.entries(perfil.dominios).map(([dominio, revisao]) => [
          dominio,
          revisao.estado,
        ]),
      ),
      territoriosMapeados: perfil.territorios !== null,
    })),
  };
}
