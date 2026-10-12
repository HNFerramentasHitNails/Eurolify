import { AsyncResource } from "node:async_hooks";
import { isIP } from "node:net";
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
import {
  LIMITE_LOJA,
  LIMITES_HUB,
  LimitePorIp,
  type RegraLimite,
} from "./base/limite.js";
import {
  comRasto,
  iaDoCabecalho,
  type ContextoRasto,
  type IaDoRasto,
  PEDIDO_DO_RASTO,
} from "./base/rasto.js";
import {
  guardaExportacoes,
  type Armazenamento,
} from "./catalogo/armazenamento.js";
import { rotasDoCatalogo } from "./catalogo/rotas.js";
import { rotasDaLinhaDoTempo } from "./catalogo/rotas-linha-do-tempo.js";
import { rotasDaMedia } from "./catalogo/rotas-media.js";
import { rotasDosClientes } from "./clientes/rotas.js";
import { rotasDoIva } from "./iva/rotas.js";
import { rotasDoCheckout } from "./checkout/rotas.js";
import type { ConfigPagamentos } from "./pagamentos/adaptador.js";
import { rotasDosPagamentos } from "./pagamentos/rotas.js";
import { rotasDoStock } from "./stock/rotas.js";
import type { ConfigFaturacao } from "./faturacao/adaptador.js";
import { rotasDosDocumentos } from "./faturacao/rotas.js";
import { rotasDaPosVenda } from "./posvenda/rotas.js";
import { rotasDasTarefas, rotasDasTarefasNoHub } from "./tarefas/rotas.js";
import { rotasDasVendas, rotasDasVendasNoHub } from "./vendas/rotas.js";
import { rotasDasNotificacoes } from "./notificacoes/rotas.js";
import type { ConsultaVies } from "./clientes/vies.js";
import { rotasDosPrecos } from "./precos/rotas.js";
import { rotasDasExportacoes } from "./exportacao/rotas.js";
import { rotasDasImportacoes } from "./importacao/rotas.js";
import {
  conferirOrigem,
  ligarAutenticacao,
} from "./identidade/autenticacao.js";
import { rotasDoHub } from "./identidade/hub.js";
import {
  rotasDasImagensNoHub,
  rotasDoCatalogoNoHub,
} from "./identidade/hub-catalogo.js";
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
  /**
   * Onde se guardam as imagens (MEDIA_PASTA; docs/06, CQ); sem ele, as rotas
   * da media não existem.
   */
  armazenamento?: Armazenamento,
  /** Quem consulta o VIES (docs/23 §13.2); sem ele, a consulta pedida dá 503. */
  vies?: ConsultaVies,
  /** O limite por IP das rotas da loja (por omissão, LIMITE_LOJA). */
  limiteLoja: RegraLimite = LIMITE_LOJA,
  /**
   * Os adaptadores dos prestadores e a chave das credenciais (docs/26 Q3);
   * sem eles, pagar e ligar contas dá 503 `payments.not_configured`.
   */
  pagamentos?: ConfigPagamentos,
  /**
   * Os adaptadores de faturação e a chave das credenciais (docs/29); sem
   * eles, ligar o emissor dá 503 `invoices.not_configured`.
   */
  faturacao?: ConfigFaturacao,
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
  // O contexto do rasto de auditoria (docs/28 §3.1, #322): o canal, o
  // identificador do pedido (o mesmo do `instance` dos erros) e a IA que
  // quem chama declara. Lido aqui, num só sítio; `comComerciante` passa-o à
  // base em cada transacção. Como no @fastify/request-context: o resto do
  // pedido corre dentro do `comRasto`, e o `preValidation` volta a entrar
  // nele, porque o fim do corpo chega no contexto da ligação, não no do
  // pedido (revisão do #327, P1-1).
  const recursosDoRasto = new WeakMap<object, AsyncResource>();
  app.addHook("onRequest", (pedido, _resposta, feito) => {
    let ia: IaDoRasto | undefined;
    try {
      ia = iaDoCabecalho(pedido.headers["eurolify-ia"]);
    } catch (erro) {
      feito(erro as Error);
      return;
    }
    const contexto: ContextoRasto = {
      // A marca que a guarda das rotas do Hub já impõe (revisão, P3-1).
      canal: pedido.routeOptions.config.hub === true ? "hub" : "api",
      // Um identificador que a base não aceitaria fica de fora (P3-3).
      ...(PEDIDO_DO_RASTO.test(pedido.id) ? { pedido: pedido.id } : {}),
      ...(ia === undefined ? {} : { ia }),
    };
    comRasto(contexto, () => {
      recursosDoRasto.set(pedido, new AsyncResource("eurolify-rasto"));
      feito();
    });
  });
  app.addHook("preValidation", (pedido, _resposta, feito) => {
    const recurso = recursosDoRasto.get(pedido);
    if (recurso === undefined) {
      feito();
      return;
    }
    recurso.runInAsyncScope(feito, pedido.raw);
  });
  // O cookie da sessão do Hub (docs/21 §3); as opções de cada cookie são
  // dadas ao escrevê-lo (sessoes.ts), nunca as de omissão da biblioteca.
  void app.register(cookie);
  // O limite por IP nas rotas da loja (a API da Loja e o checkout alojado):
  // sem ele, criavam-se carrinhos e sessões sem fim (revisão do #276, P2-9).
  {
    const naLoja = new LimitePorIp(limiteLoja);
    const arrumar = setInterval(() => {
      naLoja.limpar();
    }, limiteLoja.janelaMs);
    arrumar.unref();
    app.addHook("onClose", (_instancia, feito) => {
      clearInterval(arrumar);
      feito();
    });
    app.addHook("onRequest", async (pedido, resposta) => {
      if (pedido.routeOptions.config.loja !== true) return;
      const ip: unknown = pedido.ip;
      if (typeof ip !== "string" || isIP(ip) === 0 || ip.includes("%")) {
        throw erroBase(
          "request.invalid",
          "o endereço de quem pede não é um IP válido",
        );
      }
      const espera = naLoja.contar(ip);
      if (espera > 0) {
        void resposta.header("Retry-After", String(espera));
        throw erroBase("rate_limit.exceeded");
      }
    });
  }
  // O limite geral por IP nas rotas do Hub (docs/21 §14): depois da guarda
  // da origem (um pedido de outro site não gasta o limite de quem o visita;
  // revisão do #154, P2-1) e antes da sessão, para um pedido a mais não
  // chegar à base.
  if (hub !== undefined) {
    const limites = hub.limites ?? LIMITES_HUB;
    const todas = new LimitePorIp(limites.todas);
    const publicas = new LimitePorIp(limites.publicas);
    // Os contadores acabados saem de minuto a minuto, mesmo sem pedidos novos:
    // o IP não fica na memória além da janela (revisão do #154, P3-2).
    const arrumar = setInterval(
      () => {
        todas.limpar();
        publicas.limpar();
      },
      Math.min(limites.todas.janelaMs, limites.publicas.janelaMs),
    );
    arrumar.unref();
    app.addHook("onClose", (_instancia, feito) => {
      clearInterval(arrumar);
      feito();
    });
    app.addHook("onRequest", async (pedido, resposta) => {
      const config = pedido.routeOptions.config;
      if (config.hub !== true) return;
      conferirOrigem(pedido, hub, config.hubImagem === true);
      // Um endereço que não é IP (um proxy de confiança mal configurado, ou
      // a ligação já fechada) não se conta nem chega à base (P3-4, P3-5).
      const ip: unknown = pedido.ip;
      if (typeof ip !== "string" || isIP(ip) === 0 || ip.includes("%")) {
        throw erroBase(
          "request.invalid",
          "o endereço de quem pede não é um IP válido",
        );
      }
      const espera = Math.max(
        todas.contar(pedido.ip),
        config.ambito === "publico" ? publicas.contar(pedido.ip) : 0,
      );
      if (espera > 0) {
        void resposta.header("Retry-After", String(espera));
        throw erroBase("rate_limit.exceeded");
      }
    });
  }
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
          "Contrato da API do Eurolify (ADR-0025, docs/18). Os erros seguem o RFC 9457 (application/problem+json) com um `codigo` estável. As rotas com chave pedem `Authorization: Bearer eul_sk_…` (docs/19). Quem chama em nome de uma IA pode dizê-lo no cabeçalho `Eurolify-IA: fornecedor=…; modelo=…; execucao=…`, gravado no rasto como declarado; mal formado, dá 400 `request.invalid` (docs/28 §3.3).",
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
      rotasDaLinhaDoTempo(rotas, base);
      rotasDosPrecos(rotas, base);
      rotasDosClientes(rotas, base, vies);
      rotasDoIva(rotas, base);
      rotasDoCheckout(rotas, base);
      rotasDosPagamentos(rotas, base, pagamentos);
      rotasDoStock(rotas, base);
      rotasDosDocumentos(rotas, base, faturacao);
      rotasDaPosVenda(rotas, base, pagamentos);
      rotasDasTarefas(rotas, base);
      rotasDasVendas(rotas, base);
      rotasDasNotificacoes(rotas, base);
      rotasDasImportacoes(rotas, base);
      if (armazenamento !== undefined) {
        // Num plugin próprio: o leitor dos bytes das imagens fica só lá.
        void rotas.register((media, _o, pronto) => {
          rotasDaMedia(media, base, armazenamento);
          pronto();
        });
        // As exportações levam as imagens, por isso vivem com elas.
        if (guardaExportacoes(armazenamento)) {
          rotasDasExportacoes(rotas, base, armazenamento);
        }
      }
    }
    if (base !== undefined && hub !== undefined) {
      rotasDoHub(rotas, base, hub);
      rotasDasCredenciais(rotas, base, hub);
      rotasDasChavesDoHub(rotas, base);
      rotasDoCatalogoNoHub(rotas, base);
      rotasDasVendasNoHub(rotas, base);
      rotasDasTarefasNoHub(rotas, base);
      if (armazenamento !== undefined) {
        rotasDasImagensNoHub(rotas, base, armazenamento);
      }
      if (hub.chaveTotp !== undefined) {
        rotasDaPalavraPasse(rotas, base, hub, hub.chaveTotp);
      }
    }
    feito();
  });

  return app;
}
