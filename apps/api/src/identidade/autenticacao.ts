import type { Kysely } from "kysely";
import { rastoActual } from "../base/rasto.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { erroBase, ErroApi } from "../base/erros.js";
import { TIPOS_DE_IMAGEM, type BaseDados } from "../base/esquema.js";
import type { Ambito } from "./chaves.js";
import { resolverChave, type ContextoChave } from "./repositorio.js";
import {
  COOKIE_SESSAO,
  erroConta,
  resolverSessao,
  verificarSessao,
  type ConfigHub,
  type ContextoSessao,
} from "./sessoes.js";

// Autenticação por chave (docs/19 §5) e por sessão do Hub (docs/21 §3 e
// §4.6). Cada rota declara em `config.ambito` o que pede: «publico» (sem
// chave), «qualquer» (uma chave válida), um âmbito, «sessao» (uma sessão do
// Hub) ou «sessao_comerciante» (uma sessão e o cabeçalho
// Eurolify-Comerciante, com um membro activo). O comerciante do pedido sai
// sempre da chave ou do cabeçalho validado pela base, nunca do corpo nem do
// caminho. As rotas com `config.hub` (as do Hub, também as públicas como
// entrar) recusam escritas de outra origem ou sem JSON (CSRF, docs/21 §3).

export type AmbitoDaRota =
  Ambito | "publico" | "qualquer" | "sessao" | "sessao_comerciante";

const CABECALHO_COMERCIANTE = "eurolify-comerciante";
const FORMATO_COMERCIANTE =
  /^mer_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

declare module "fastify" {
  interface FastifyContextConfig {
    ambito?: AmbitoDaRota;
    /** Rota do Hub: escritas só da origem do Hub e em JSON. */
    hub?: boolean;
    /**
     * Rota do Hub que recebe os bytes de uma imagem em vez de JSON (só o
     * POST /hub/media/uploads; docs/22 §15.2). A origem continua obrigatória.
     */
    hubImagem?: boolean;
    /**
     * Rota da loja (API da Loja e checkout alojado): conta no limite por IP
     * da loja (revisão do #276, P2-9).
     */
    loja?: boolean;
  }
  interface FastifyRequest {
    /** A chave autenticada; `null` nas rotas públicas. */
    chave: ContextoChave | null;
    /** A sessão do Hub; `null` fora das rotas com sessão. */
    sessao: ContextoSessao | null;
  }
}

const MENSAGENS = {
  "auth.required": {
    status: 401,
    pt: "Falta a chave de acesso",
    en: "Missing access key",
  },
  "auth.invalid": {
    status: 401,
    pt: "Chave de acesso inválida",
    en: "Invalid access key",
  },
  "auth.forbidden": {
    status: 403,
    pt: "A chave não tem o âmbito desta operação",
    en: "The key lacks the scope for this operation",
  },
} as const;

function erro(codigo: keyof typeof MENSAGENS, detalhe?: string): ErroApi {
  const { status, pt, en } = MENSAGENS[codigo];
  return new ErroApi(codigo, status, { pt, en }, detalhe);
}

/** O segredo do cabeçalho `Authorization: Bearer …`, ou undefined. */
function segredoDe(pedido: FastifyRequest): string | undefined {
  const cabecalho = pedido.headers.authorization;
  if (typeof cabecalho !== "string") return undefined;
  const partes = /^Bearer[ ]+(\S+)$/i.exec(cabecalho.trim());
  return partes?.[1];
}

/** A escrita vem do Hub e em JSON (docs/21 §3); um GET não muda nada. */
export function conferirOrigem(
  pedido: FastifyRequest,
  hub: ConfigHub | undefined,
  aceitaImagem = false,
) {
  if (pedido.method === "GET") {
    // Um GET de outro site (uma imagem, um fetch sem CORS) não chega ao Hub:
    // com o cookie SameSite=Strict não traria sessão, e assim também não gasta
    // o limite por IP de quem visita esse site (revisão do #154, P2-1).
    if (pedido.headers["sec-fetch-site"] === "cross-site") {
      throw erroConta("auth.origin_rejected");
    }
    return;
  }
  if (hub === undefined) throw new Error("rota do Hub sem HUB_ORIGEM");
  if (pedido.headers.origin !== hub.origem) {
    throw erroConta("auth.origin_rejected");
  }
  const tipo = pedido.headers["content-type"];
  const base = typeof tipo === "string" ? tipo.split(";")[0] : undefined;
  const declarado = base?.trim().toLowerCase();
  // A única excepção: os bytes de uma imagem, só na rota que os recebe
  // (docs/22 §15.2). Um formulário de outro site não manda estes tipos sem
  // um pedido prévio de CORS, que a API não autoriza; e a origem já se
  // conferiu acima.
  if (
    aceitaImagem &&
    declarado !== undefined &&
    (TIPOS_DE_IMAGEM as readonly string[]).includes(declarado)
  ) {
    return;
  }
  if (declarado !== "application/json") {
    throw erroBase("media_type.unsupported", "as escritas do Hub são em JSON");
  }
}

/** O comerciante do cabeçalho Eurolify-Comerciante, sem o prefixo. */
function comercianteDe(pedido: FastifyRequest): string {
  const valor = pedido.headers[CABECALHO_COMERCIANTE];
  const partes =
    typeof valor === "string" ? FORMATO_COMERCIANTE.exec(valor) : null;
  const id = partes?.[1];
  if (id === undefined) throw erroConta("merchant.header_required");
  return id;
}

export function ligarAutenticacao(
  app: FastifyInstance,
  base: Kysely<BaseDados> | undefined,
  hub?: ConfigHub,
) {
  app.decorateRequest("chave", null);
  app.decorateRequest("sessao", null);

  app.addHook(
    "onRequest",
    async (pedido: FastifyRequest, resposta: FastifyReply) => {
      const config = pedido.routeOptions.config;
      const ambito = config.ambito;
      if (config.hub === true) {
        conferirOrigem(pedido, hub, config.hubImagem === true);
      }
      // Sem âmbito: o 404 (as rotas registadas têm sempre um, pela guarda).
      if (ambito === undefined || ambito === "publico") return;
      if (ambito === "sessao" || ambito === "sessao_comerciante") {
        if (base === undefined) {
          throw new Error("rota com sessão sem base de dados ligada");
        }
        const segredo = pedido.cookies[COOKIE_SESSAO];
        if (segredo === undefined || segredo === "") {
          throw erroConta("auth.session_required");
        }
        pedido.sessao =
          ambito === "sessao"
            ? await verificarSessao(base, segredo)
            : await resolverSessao(base, segredo, comercianteDe(pedido));
        // No Hub, quem age é a própria pessoa: fica também como quem
        // autorizou (docs/28 §3.2). Uma chave nunca autoriza. Com uma IA
        // declarada no pedido, o cookie não prova que a pessoa confirmou:
        // fica sem quem autorize (revisão do #334, P3-1).
        const rasto = rastoActual();
        if (rasto !== undefined) {
          // A base confere o `quem` com quem se autenticou (0062).
          rasto.autenticado = `pessoa:per_${pedido.sessao.pessoaId}`;
          if (rasto.ia === undefined) {
            rasto.autorizadoPor = `pessoa:per_${pedido.sessao.pessoaId}`;
          }
        }
        return;
      }
      const segredo = segredoDe(pedido);
      if (segredo === undefined) {
        void resposta.header("WWW-Authenticate", "Bearer");
        throw erro("auth.required");
      }
      if (base === undefined) {
        throw new Error("rota com chave sem base de dados ligada");
      }
      const chave = await resolverChave(base, segredo);
      if (chave === null) {
        // O mesmo erro para inventada, revogada e expirada (docs/19 §5).
        void resposta.header(
          "WWW-Authenticate",
          'Bearer error="invalid_token"',
        );
        throw erro("auth.invalid");
      }
      if (ambito !== "qualquer" && !chave.ambitos.includes(ambito)) {
        throw erro("auth.forbidden", `âmbito pedido: ${ambito}`);
      }
      pedido.chave = chave;
      // A base confere o `quem` com quem se autenticou (0062).
      const doPedido = rastoActual();
      if (doPedido !== undefined)
        doPedido.autenticado = `chave:key_${chave.chaveId}`;
      // Uma chave de um agente de IA (0057): a IA fica «declarado» mesmo sem
      // o cabeçalho Eurolify-IA, com fornecedor e modelo desconhecidos se
      // não vierem (docs/28 §3.3). Com o cabeçalho, fica o que ele diz.
      if (chave.agenteIa) {
        const rasto = rastoActual();
        if (rasto !== undefined && rasto.ia === undefined) {
          rasto.ia = { prova: "declarado" };
        }
      }
    },
  );
}

/** A chave do pedido, numa rota que a exige (nunca `null` lá). */
export function chaveDo(pedido: FastifyRequest): ContextoChave {
  if (pedido.chave === null) {
    throw new Error("rota sem chave: falta config.ambito na rota");
  }
  return pedido.chave;
}

/** A sessão do pedido, numa rota que a exige (nunca `null` lá). */
export function sessaoDo(pedido: FastifyRequest): ContextoSessao {
  if (pedido.sessao === null) {
    throw new Error("rota sem sessão: falta config.ambito na rota");
  }
  return pedido.sessao;
}
