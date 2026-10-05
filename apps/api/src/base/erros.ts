import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { Type, type Static } from "typebox";

// Erros num formato único, RFC 9457 (docs/18 §2; headless-commerce, regra 3).
// Os clientes e as IA decidem pelo `codigo`, que é estável; o texto pode
// mudar. Nunca um 200 com ok: false, nunca um erro engolido.

export const TIPO_PROBLEMA = "application/problem+json";

export const Problema = Type.Object(
  {
    type: Type.String({
      description: "URI relativo do código: /erros/<codigo>",
    }),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    detail: Type.Optional(Type.String()),
    instance: Type.String({ description: "Identificador do pedido" }),
    codigo: Type.String({ description: "Código estável do erro" }),
    mensagem: Type.Object({ pt: Type.String(), en: Type.String() }),
    erros: Type.Optional(
      Type.Array(
        Type.Object({
          campo: Type.String({ description: "Ponteiro JSON (RFC 6901)" }),
          mensagem: Type.String(),
        }),
      ),
    ),
  },
  { $id: "Problema", title: "Problema (RFC 9457)" },
);
export type Problema = Static<typeof Problema>;

/** Os códigos de partida (docs/18 §2); os de domínio entram com as rotas. */
export const CODIGOS_BASE = {
  "request.invalid": {
    status: 400,
    pt: "Pedido inválido",
    en: "Invalid request",
  },
  "route.not_found": {
    status: 404,
    pt: "Caminho não encontrado",
    en: "Route not found",
  },
  "payload.too_large": {
    status: 413,
    pt: "Corpo do pedido demasiado grande",
    en: "Payload too large",
  },
  "media_type.unsupported": {
    status: 415,
    pt: "Tipo de conteúdo não aceite",
    en: "Unsupported media type",
  },
  "internal.error": {
    status: 500,
    pt: "Erro interno",
    en: "Internal error",
  },
} as const;
export type CodigoBase = keyof typeof CODIGOS_BASE;

export function problema(
  codigo: CodigoBase,
  instancia: string,
  extra: { detail?: string; erros?: Problema["erros"] } = {},
): Problema {
  const { status, pt, en } = CODIGOS_BASE[codigo];
  return {
    type: `/erros/${codigo}`,
    title: pt,
    status,
    ...(extra.detail === undefined ? {} : { detail: extra.detail }),
    instance: instancia,
    codigo,
    mensagem: { pt, en },
    ...(extra.erros === undefined ? {} : { erros: extra.erros }),
  };
}

function enviar(resposta: FastifyReply, corpo: Problema) {
  return resposta.status(corpo.status).type(TIPO_PROBLEMA).send(corpo);
}

/** Qual dos códigos de partida corresponde a um erro do Fastify. */
function codigoDe(erro: FastifyError): CodigoBase {
  if (erro.validation !== undefined) return "request.invalid";
  if (erro.code === "FST_ERR_CTP_BODY_TOO_LARGE") return "payload.too_large";
  if (erro.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
    return "media_type.unsupported";
  }
  const estado = erro.statusCode ?? 500;
  if (estado >= 400 && estado < 500) return "request.invalid";
  return "internal.error";
}

/**
 * Liga o formato único aos erros e ao 404 da aplicação. Um erro 5xx nunca
 * mostra o pormenor ao cliente: vai só para o registo, com o identificador
 * do pedido, que é o `instance` da resposta.
 */
export function ligarErros(app: FastifyInstance) {
  app.addSchema(Problema);

  app.setNotFoundHandler((pedido: FastifyRequest, resposta: FastifyReply) =>
    enviar(resposta, problema("route.not_found", pedido.id)),
  );

  app.setErrorHandler(
    (erro: FastifyError, pedido: FastifyRequest, resposta: FastifyReply) => {
      const codigo = codigoDe(erro);
      if (codigo === "internal.error") {
        pedido.log.error({ err: erro }, "erro interno");
        return enviar(resposta, problema(codigo, pedido.id));
      }
      if (codigo === "request.invalid" && erro.validation !== undefined) {
        const onde = erro.validationContext ?? "body";
        return enviar(
          resposta,
          problema(codigo, pedido.id, {
            detail: erro.message,
            erros: erro.validation.map((v) => ({
              campo: `/${onde}${v.instancePath}`,
              mensagem: v.message ?? "inválido",
            })),
          }),
        );
      }
      return enviar(
        resposta,
        problema(codigo, pedido.id, { detail: erro.message }),
      );
    },
  );
}

/** A resposta de erro para pôr em cada rota do contrato (docs/18 §3). */
const conteudoDoProblema = {
  description: "Problema (RFC 9457)",
  content: { [TIPO_PROBLEMA]: { schema: Type.Ref("Problema") } },
};
export const RESPOSTA_DE_ERRO = {
  "4xx": conteudoDoProblema,
  "5xx": conteudoDoProblema,
} as const;
