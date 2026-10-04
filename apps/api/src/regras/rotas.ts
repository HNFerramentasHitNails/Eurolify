import { Type, type Static } from "typebox";
import {
  CODIGOS_UE,
  DOMINIOS_CONDICIONAIS,
  DOMINIOS_OBRIGATORIOS,
  type Dominio,
  type Registo,
} from "./tipos.js";

const EstadoDominio = Type.Union([
  Type.Literal("por_verificar"),
  Type.Literal("verificado"),
  Type.Literal("nao_aplicavel"),
]);

// O contrato lista os 27 códigos e os 11 domínios (revisão do #37, P2-6), em
// vez de aceitar qualquer texto. É contrato, não guarda: o serializador do
// Fastify usa o esquema como lista branca de campos e não valida o `enum`
// (medido na revisão do #40, P2-4) — quem recusa um código fora dos 27 é o
// validar.ts, ao arrancar.
const propriedadesDominios = Object.fromEntries(
  [...DOMINIOS_OBRIGATORIOS, ...DOMINIOS_CONDICIONAIS].map((dominio) => [
    dominio,
    EstadoDominio,
  ]),
) as Record<Dominio, typeof EstadoDominio>;

export const RespostaPaises = Type.Object({
  versaoRegisto: Type.Integer(),
  paises: Type.Array(
    Type.Object({
      codigo: Type.Enum(CODIGOS_UE),
      nome: Type.String(),
      dominios: Type.Object(propriedadesDominios),
      territoriosMapeados: Type.Boolean(),
    }),
  ),
});

type Resposta = Static<typeof RespostaPaises>;

/**
 * Corpo do GET /paises (docs/eurolify/architecture.md §4.3): a cobertura dos
 * 27 países, só com o estado da revisão de cada domínio. Sem dados pessoais,
 * sem quem reviu nem quando, e sem a decisão, que é interna — os frontends não
 * a refazem.
 */
export function coberturaPaises(registo: Registo): Resposta {
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
      ) as Resposta["paises"][number]["dominios"],
      territoriosMapeados: perfil.territorios !== null,
    })),
  };
}
