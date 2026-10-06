import type { Kysely } from "kysely";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ErroApi } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import type { Ambito } from "./chaves.js";
import { resolverChave, type ContextoChave } from "./repositorio.js";

// Autenticação por chave (docs/19 §5). Cada rota declara em `config.ambito`
// o que pede: «publico» (sem chave), «qualquer» (uma chave válida) ou um
// âmbito. O comerciante do pedido sai sempre da chave, nunca do corpo nem do
// caminho.

export type AmbitoDaRota = Ambito | "publico" | "qualquer";

declare module "fastify" {
  interface FastifyContextConfig {
    ambito?: AmbitoDaRota;
  }
  interface FastifyRequest {
    /** A chave autenticada; `null` nas rotas públicas. */
    chave: ContextoChave | null;
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

export function ligarAutenticacao(
  app: FastifyInstance,
  base: Kysely<BaseDados> | undefined,
) {
  app.decorateRequest("chave", null);

  app.addHook(
    "onRequest",
    async (pedido: FastifyRequest, resposta: FastifyReply) => {
      const ambito = pedido.routeOptions.config.ambito;
      // Sem âmbito: o 404 (as rotas registadas têm sempre um, pela guarda).
      if (ambito === undefined || ambito === "publico") return;
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
