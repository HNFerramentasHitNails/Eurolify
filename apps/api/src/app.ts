import Fastify, { type FastifyServerOptions } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { REGISTO_INICIAL } from "./regras/registo.js";
import { coberturaPaises, RespostaPaises } from "./regras/rotas.js";
import type { Registo } from "./regras/tipos.js";

const RespostaSaude = Type.Object({ estado: Type.Literal("ok") });

/**
 * Cria a aplicação sem a pôr a ouvir, para os testes a chamarem por
 * `inject` e o `servidor.ts` a ligar à rede. O registo de regras por país
 * pode ser trocado nos testes; por omissão é o de partida (tudo por verificar).
 */
export function criarApp(
  opcoes: FastifyServerOptions = {},
  registo: Registo = REGISTO_INICIAL,
) {
  const app = Fastify(opcoes).withTypeProvider<TypeBoxTypeProvider>();

  app.get("/health", { schema: { response: { 200: RespostaSaude } } }, () => ({
    estado: "ok" as const,
  }));

  app.get("/paises", { schema: { response: { 200: RespostaPaises } } }, () =>
    coberturaPaises(registo),
  );

  return app;
}
