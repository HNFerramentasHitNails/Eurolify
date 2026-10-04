import Fastify, { type FastifyServerOptions } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "typebox";

const RespostaSaude = Type.Object({ estado: Type.Literal("ok") });

/**
 * Cria a aplicação sem a pôr a ouvir, para os testes a chamarem por
 * `inject` e o `servidor.ts` a ligar à rede.
 */
export function criarApp(opcoes: FastifyServerOptions = {}) {
  const app = Fastify(opcoes).withTypeProvider<TypeBoxTypeProvider>();

  app.get("/health", { schema: { response: { 200: RespostaSaude } } }, () => ({
    estado: "ok" as const,
  }));

  return app;
}
