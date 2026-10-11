import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import { ESTADOS_NOTIFICACAO, type BaseDados } from "../base/esquema.js";
import { iso, umDe } from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import { listarNotificacoes } from "./repositorio.js";

// A lista das notificações (docs/34, N11): o tipo, a pessoa, o estado, as
// tentativas e o último código; nunca o endereço nem o corpo.

export function rotasDasNotificacoes(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    "/notifications",
    {
      config: { ambito: "merchant:read" },
      schema: {
        description:
          "Os e-mails do Eurolify à equipa do comerciante, dos mais recentes (hoje, o aviso do prazo do reembolso aos donos e gestores; docs/34). Sem o endereço nem o texto. Uma «falhada» não sai sozinha: diz o código do último erro.",
        querystring: Type.Object(
          {
            estado: Type.Optional(umDe(ESTADOS_NOTIFICACAO)),
            limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            dados: Type.Array(Type.Record(Type.String(), Type.Unknown())),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido) => ({
      dados: (
        await listarNotificacoes(base, chaveDo(pedido).comercianteId, {
          ...(pedido.query.estado === undefined
            ? {}
            : { estado: pedido.query.estado }),
          limite: pedido.query.limite ?? 50,
        })
      ).map((n) => ({
        id: `ntf_${n.id}`,
        tipo: n.tipo,
        referencia: `rma_${n.referencia}`,
        pessoa: `per_${n.pessoa_id}`,
        lingua: n.lingua,
        estado: n.estado,
        tentativas: n.tentativas,
        proxima_em: n.estado === "a_enviar" ? iso(n.proxima_em) : null,
        ultimo_erro: n.ultimo_erro,
        criada_em: iso(n.criada_em),
        terminada_em: iso(n.terminada_em),
      })),
    }),
  );
}
