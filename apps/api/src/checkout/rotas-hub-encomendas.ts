import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { CamposDoRasto, respostasDoRasto } from "../base/rasto-resposta.js";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import { ESTADOS_ENCOMENDA, type BaseDados } from "../base/esquema.js";
import { semPrefixo, umDe } from "../catalogo/rotas.js";
import { ferramentasDoHub } from "../envios/rotas-hub.js";
import { transicoesDaEncomenda } from "../stock/repositorio.js";
import { emStock, IdEncomenda } from "../stock/rotas.js";
import { lerEncomenda, listarEncomendas } from "./repositorio.js";
import { emCheckout, paraEncomenda } from "./rotas.js";

// Os ecrãs das encomendas no Hub (docs/22 §35; issue #475): a lista e a
// ficha, só leitura, com as mesmas funções das rotas da chave
// (`GET /orders`, `GET /orders/:id`, `GET /orders/:id/timeline`) e o mesmo
// âmbito (`orders:read`: o dono, o gestor e o apoio; o armazém não). A cópia
// do perfil de faturação de uma ficha pseudonimizada segue a regra de
// `paraEncomenda` (customers:billing). Nenhuma escrita.

export function rotasDasEncomendasNoHub(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const { daSessao } = ferramentasDoHub(base);
  const Livre = Type.Record(Type.String(), Type.Unknown());
  const LIMITE = 100;

  rotas.get(
    "/hub/orders",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "As encomendas pelo Hub (orders:read), das mais recentes, sem dados pessoais; `estado` filtra. `limite` diz quantas a API devolve, no máximo.",
        querystring: Type.Object({
          estado: Type.Optional(umDe(ESTADOS_ENCOMENDA)),
        }),
        response: {
          200: Type.Object({
            dados: Type.Array(Livre),
            limite: Type.Integer(),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, async () => {
        const s = daSessao(pedido, resposta, "orders:read");
        return {
          dados: (
            await listarEncomendas(
              base,
              s.comercianteId,
              LIMITE,
              pedido.query.estado,
            )
          ).map((e) => ({
            id: `ord_${e.id}`,
            estado: e.estado,
            total: Number(e.total),
            moeda: e.moeda,
            cliente: `cus_${e.cliente_id}`,
            criada_em: e.criada_em.toISOString(),
          })),
          limite: LIMITE,
        };
      }),
  );

  rotas.get(
    "/hub/orders/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Uma encomenda pelo Hub (orders:read), com as linhas e as cópias. A cópia do perfil de faturação de uma ficha pseudonimizada só sai com customers:billing.",
        params: Type.Object({ id: IdEncomenda }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, async () => {
        const s = daSessao(pedido, resposta, "orders:read");
        return paraEncomenda(
          await lerEncomenda(
            base,
            s.comercianteId,
            semPrefixo(pedido.params.id),
          ),
          s.ambitos.includes("customers:billing"),
        );
      }),
  );

  rotas.get(
    "/hub/orders/:id/timeline",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "As transições da encomenda pelo Hub (orders:read): de, para, quem, quando, o motivo e o rasto.",
        params: Type.Object({ id: IdEncomenda }),
        response: {
          200: Type.Object({
            dados: Type.Array(
              Type.Object({
                de: Type.Union([Type.String(), Type.Null()]),
                para: Type.String(),
                quem: Type.String(),
                em: Type.String({ format: "date-time" }),
                ...CamposDoRasto,
              }),
            ),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emStock(resposta, async () => {
        const s = daSessao(pedido, resposta, "orders:read");
        const id = semPrefixo(pedido.params.id);
        // Sem a encomenda neste comerciante é 404, não uma lista vazia.
        await emCheckout(resposta, () =>
          lerEncomenda(base, s.comercianteId, id),
        );
        return {
          dados: (await transicoesDaEncomenda(base, s.comercianteId, id)).map(
            (t) => ({
              de: t.de,
              para: t.para,
              quem: t.quem,
              em: t.em.toISOString(),
              ...respostasDoRasto(t),
            }),
          ),
        };
      }),
  );
}
