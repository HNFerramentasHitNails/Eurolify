import Fastify, { type FastifyServerOptions } from "fastify";
import swagger from "@fastify/swagger";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { ligarErros, RESPOSTA_DE_ERRO } from "./base/erros.js";
import { REGISTO_INICIAL } from "./regras/registo.js";
import { coberturaPaises, RespostaPaises } from "./regras/rotas.js";
import type { Registo } from "./regras/tipos.js";
import { assegurarRegistoValido } from "./regras/validar.js";

const RespostaSaude = Type.Object({ estado: Type.Literal("ok") });

/**
 * Cria a aplicação sem a pôr a ouvir, para os testes a chamarem por
 * `inject` e o `servidor.ts` a ligar à rede. O registo de regras por país
 * pode ser trocado nos testes; por omissão é o de partida (tudo por verificar).
 *
 * Base comum (docs/18): erros RFC 9457 em todas as rotas e no 404, e o
 * contrato OpenAPI 3.1 gerado dos esquemas e publicado em /openapi.json.
 * Uma rota nova leva a resposta de sucesso e a de erro (RESPOSTA_DE_ERRO);
 * um teste falha se ficar fora do contrato.
 */
export function criarApp(
  opcoes: FastifyServerOptions = {},
  registo: Registo = REGISTO_INICIAL,
) {
  // Um registo incoerente não arranca: nada falha em silêncio.
  assegurarRegistoValido(registo);
  const app = Fastify(opcoes).withTypeProvider<TypeBoxTypeProvider>();

  ligarErros(app);
  // Nada fora do contrato (headless-commerce, regra 1): uma rota sem a
  // resposta de sucesso e a de erro não arranca. Só o /openapi.json, que é
  // o próprio contrato, fica de fora.
  app.addHook("onRoute", (rota) => {
    const esquema = rota.schema as
      { hide?: boolean; response?: Record<string, unknown> } | undefined;
    if (esquema?.hide === true) return;
    const respostas = Object.keys(esquema?.response ?? {});
    const temSucesso = respostas.some((c) => /^2\d\d$/.test(c));
    if (
      !temSucesso ||
      !respostas.includes("4xx") ||
      !respostas.includes("5xx")
    ) {
      throw new Error(
        `rota ${String(rota.method)} ${rota.url} fora do contrato: falta a resposta de sucesso ou a de erro (docs/18 §3)`,
      );
    }
  });
  void app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Eurolify API",
        version: "0.1.0",
        description:
          "Contrato da API do Eurolify (ADR-0025, docs/18). Os erros seguem o RFC 9457 (application/problem+json) com um `codigo` estável.",
      },
    },
    // Os esquemas partilhados ficam no contrato com o nome deles
    // (ex.: Problema), não «def-0».
    refResolver: {
      buildLocalReference: (json, _base, _fragmento, i) =>
        typeof json["$id"] === "string" ? json["$id"] : `def-${String(i)}`,
    },
  });

  // As rotas registam-se depois do swagger, num plugin, para entrarem no
  // contrato (o swagger só vê as rotas registadas depois dele).
  void app.register((rotas, _opcoes, feito) => {
    rotas.get(
      "/health",
      { schema: { response: { 200: RespostaSaude, ...RESPOSTA_DE_ERRO } } },
      () => ({ estado: "ok" as const }),
    );

    rotas.get(
      "/paises",
      { schema: { response: { 200: RespostaPaises, ...RESPOSTA_DE_ERRO } } },
      () => coberturaPaises(registo),
    );

    rotas.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());
    feito();
  });

  return app;
}
