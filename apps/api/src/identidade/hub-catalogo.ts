import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import {
  ConsultaArtigos,
  listaDeArtigos,
  RespostaArtigos,
} from "../catalogo/rotas.js";
import { sessaoDo } from "./autenticacao.js";
import { erroConta } from "./sessoes.js";

// O catálogo no Hub (docs/22 §11; issue #199). No ensaio, o endereço do Hub
// só passa à API os caminhos /hub/ (nginx-hub.conf, revisão do #160, P1-1):
// a lista responde aqui com a mesma função, os mesmos filtros e a mesma
// resposta do GET /products (docs/14 §7.1), só com a sessão de uma pessoa
// cujo papel tem `catalog:read` (docs/21 §5: os quatro). O comerciante é o
// do cabeçalho, validado pela base com o membro activo (sessao_resolver).
// Só leitura: as escritas do catálogo com sessão ficam para quando houver
// ecrãs que as usem, cada uma com o seu desenho.

export function rotasDoCatalogoNoHub(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    "/hub/products",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "A lista de artigos do comerciante para o Hub: a mesma do GET /products (filtros, ordem, páginas e resposta), com a sessão de quem tem catalog:read (docs/22 §11.1).",
        querystring: ConsultaArtigos,
        response: { 200: RespostaArtigos, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      if (!sessao.ambitos.includes("catalog:read")) {
        throw erroConta("member.role_escalation", "o papel não lê o catálogo");
      }
      return listaDeArtigos(
        base,
        sessao.comercianteId ?? "",
        pedido.query,
        resposta,
      );
    },
  );
}
