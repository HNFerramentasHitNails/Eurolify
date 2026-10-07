import Fastify, { type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { Kysely } from "kysely";
import {
  erroBase,
  errosDoFastify,
  ligarErros,
  RESPOSTA_DE_ERRO,
} from "./base/erros.js";
import type { BaseDados } from "./base/esquema.js";
import { rotasDoCatalogo } from "./catalogo/rotas.js";
import { ligarAutenticacao } from "./identidade/autenticacao.js";
import { rotasDoHub } from "./identidade/hub.js";
import { rotasDasCredenciais } from "./identidade/hub-credenciais.js";
import { rotasDaPalavraPasse } from "./identidade/hub-palavra-passe.js";
import { rotasDasChavesDoHub } from "./identidade/hub-chaves.js";
import type { ConfigHub } from "./identidade/sessoes.js";
import { rotasDaIdentidade } from "./identidade/rotas.js";
import { REGISTO_INICIAL } from "./regras/registo.js";
import { coberturaPaises, RespostaPaises } from "./regras/rotas.js";
import type { Registo } from "./regras/tipos.js";
import { assegurarRegistoValido } from "./regras/validar.js";

const RespostaSaude = Type.Object({ estado: Type.Literal("ok") });

/**
 * As versões da API por data (docs/18 §3; headless-commerce, regra 7). Quem
 * chama pode pedir uma com o cabeçalho `Eurolify-Versao`; sem ele, recebe a
 * mais recente. Uma versão que não está aqui dá 400 version.unsupported. A
 * resposta diz sempre com que versão foi servida.
 */
export const VERSOES_API = ["2026-10"] as const;
export const VERSAO_API_ACTUAL = "2026-10";

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
/** As rotas que passaram a guarda do contrato, por aplicação (para os testes). */
const rotasPorApp = new WeakMap<
  object,
  { metodo: string; caminho: string }[]
>();
export function rotasRegistadas(app: object) {
  return rotasPorApp.get(app) ?? [];
}

export function criarApp(
  opcoes: FastifyServerOptions = {},
  registo: Registo = REGISTO_INICIAL,
  base?: Kysely<BaseDados>,
  /** Onde vive o Hub (HUB_ORIGEM); sem ele, as rotas do Hub não existem. */
  hub?: ConfigHub,
) {
  // Um registo incoerente não arranca: nada falha em silêncio.
  assegurarRegistoValido(registo);
  const app = Fastify({
    // Sem rotas HEAD automáticas: ficavam expostas e fora do contrato.
    exposeHeadRoutes: false,
    // Um campo que não está no esquema é recusado (400), não apagado em
    // silêncio, e um tipo errado não se converte: «nunca um erro engolido»
    // (headless-commerce, regra 3; revisão do #118, P2-1). Por omissão, o
    // @fastify/ajv-compiler apagava-os (removeAdditional) e convertia-os
    // (coerceTypes).
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    frameworkErrors: errosDoFastify,
    ...opcoes,
  }).withTypeProvider<TypeBoxTypeProvider>();

  ligarErros(app);
  app.addHook("onRequest", async (pedido, resposta) => {
    void resposta.header("Eurolify-Versao", VERSAO_API_ACTUAL);
    const pedida = pedido.headers["eurolify-versao"];
    if (pedida === undefined) return;
    if (
      typeof pedida !== "string" ||
      !(VERSOES_API as readonly string[]).includes(pedida)
    ) {
      throw erroBase(
        "version.unsupported",
        `versões suportadas: ${VERSOES_API.join(", ")}`,
      );
    }
  });
  // O cookie da sessão do Hub (docs/21 §3); as opções de cada cookie são
  // dadas ao escrevê-lo (sessoes.ts), nunca as de omissão da biblioteca.
  void app.register(cookie);
  ligarAutenticacao(app, base, hub);
  const registadas: { metodo: string; caminho: string }[] = [];
  rotasPorApp.set(app, registadas);
  // Nada fora do contrato (headless-commerce, regra 1): uma rota sem a
  // resposta de sucesso e a de erro não arranca. Só o /openapi.json, que é
  // o próprio contrato, fica de fora.
  app.addHook("onRoute", (rota) => {
    const esquema = rota.schema as
      | {
          hide?: boolean;
          response?: Record<string, unknown>;
          security?: unknown;
        }
      | undefined;
    // Só o próprio contrato se esconde dele.
    if (esquema?.hide === true && rota.url === "/openapi.json") return;
    const respostas = esquema?.response ?? {};
    const temSucesso = Object.keys(respostas).some((c) => /^2\d\d$/.test(c));
    // A resposta de erro tem de ser a do problema, não qualquer esquema
    // (revisão do #106, P2-4).
    if (
      !temSucesso ||
      respostas["4xx"] !== RESPOSTA_DE_ERRO["4xx"] ||
      respostas["5xx"] !== RESPOSTA_DE_ERRO["5xx"]
    ) {
      throw new Error(
        `rota ${String(rota.method)} ${rota.url} fora do contrato: falta a resposta de sucesso ou a de erro (docs/18 §3)`,
      );
    }
    // Cada rota diz que chave pede (docs/19 §4); uma rota sem âmbito não
    // arranca. As que pedem chave aparecem no contrato com a segurança.
    const ambito = rota.config?.ambito;
    if (ambito === undefined) {
      throw new Error(
        `rota ${String(rota.method)} ${rota.url} sem âmbito: falta config.ambito (docs/19 §4)`,
      );
    }
    // Uma rota com sessão é do Hub: sem `hub: true` ficava sem a guarda da
    // origem e do JSON (revisão do #142, P2-3).
    if (
      (ambito === "sessao" || ambito === "sessao_comerciante") &&
      rota.config?.hub !== true
    ) {
      throw new Error(
        `rota ${String(rota.method)} ${rota.url} com sessão sem config.hub (docs/21 §3)`,
      );
    }
    if (ambito !== "publico" && esquema !== undefined) {
      esquema.security =
        ambito === "sessao" || ambito === "sessao_comerciante"
          ? [{ sessao: [] }]
          : [{ chave: [] }];
    }
    registadas.push({ metodo: String(rota.method), caminho: rota.url });
  });
  void app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Eurolify API",
        version: "0.1.0",
        description:
          "Contrato da API do Eurolify (ADR-0025, docs/18). Os erros seguem o RFC 9457 (application/problem+json) com um `codigo` estável. As rotas com chave pedem `Authorization: Bearer eul_sk_…` (docs/19).",
      },
      components: {
        securitySchemes: {
          chave: {
            type: "http",
            scheme: "bearer",
            description: "Chave de API do comerciante (eul_sk_… ou eul_pk_…)",
          },
          sessao: {
            type: "apiKey",
            in: "cookie",
            name: "__Host-eurolify_sessao",
            description:
              "Sessão de uma pessoa no Hub (docs/21 §3); as escritas pedem o Origin do Hub e JSON",
          },
        },
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
      {
        config: { ambito: "publico" },
        schema: { response: { 200: RespostaSaude, ...RESPOSTA_DE_ERRO } },
      },
      () => ({ estado: "ok" as const }),
    );

    rotas.get(
      "/paises",
      {
        config: { ambito: "publico" },
        schema: { response: { 200: RespostaPaises, ...RESPOSTA_DE_ERRO } },
      },
      () => coberturaPaises(registo),
    );

    rotas.get(
      "/openapi.json",
      { config: { ambito: "publico" }, schema: { hide: true } },
      () => app.swagger(),
    );
    // As rotas que precisam da base só existem com ela (docs/19 §6).
    if (base !== undefined) {
      rotasDaIdentidade(rotas, base);
      rotasDoCatalogo(rotas, base);
    }
    if (base !== undefined && hub !== undefined) {
      rotasDoHub(rotas, base, hub);
      rotasDasCredenciais(rotas, base, hub);
      rotasDasChavesDoHub(rotas, base);
      if (hub.chaveTotp !== undefined) {
        rotasDaPalavraPasse(rotas, base, hub, hub.chaveTotp);
      }
    }
    feito();
  });

  return app;
}
