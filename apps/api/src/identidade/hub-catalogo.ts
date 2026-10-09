import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import type { Armazenamento } from "../catalogo/armazenamento.js";
import {
  enviarBytesDaMedia,
  imagensDeArtigo,
  MediaEsquema,
  ParametroMedia,
} from "../catalogo/rotas-media.js";
import {
  Artigo,
  ConsultaArtigos,
  ConsultaPagina,
  fichaDeArtigo,
  Lista,
  listaDeArtigos,
  ParametroArtigo,
  publicacoesDeArtigo,
  RespostaArtigos,
  RespostaPublicacoes,
} from "../catalogo/rotas.js";
import { TIPOS_DE_IMAGEM } from "../base/esquema.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sessaoDo } from "./autenticacao.js";
import { erroConta } from "./sessoes.js";

// O catálogo no Hub (docs/22 §11 e §12; issues #199 e #204). No ensaio, o endereço do Hub
// só passa à API os caminhos /hub/ (nginx-hub.conf, revisão do #160, P1-1):
// a lista, a ficha, as imagens e as publicações respondem aqui com as
// mesmas funções e respostas das rotas da API (docs/14 §7.1), só com a
// sessão de uma pessoa
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
    async (pedido, resposta) =>
      listaDeArtigos(
        base,
        comercianteLeitor(pedido, resposta),
        pedido.query,
        resposta,
      ),
  );

  // A ficha do artigo (docs/22 §12.1): as mesmas funções das rotas da API.
  rotas.get(
    "/hub/products/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "A ficha de um artigo para o Hub: a mesma do GET /products/{id}, com a sessão de quem tem catalog:read (docs/22 §12.1).",
        params: ParametroArtigo,
        response: { 200: Artigo, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      fichaDeArtigo(
        base,
        comercianteLeitor(pedido, resposta),
        pedido.params.id,
        resposta,
      ),
  );

  rotas.get(
    "/hub/products/:id/publications",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "As publicações de um artigo para o Hub: as mesmas do GET /products/{id}/publications (docs/22 §12.1).",
        params: ParametroArtigo,
        response: { 200: RespostaPublicacoes, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      publicacoesDeArtigo(
        base,
        comercianteLeitor(pedido, resposta),
        pedido.params.id,
        resposta,
      ),
  );
}

/**
 * As imagens no Hub (docs/22 §12.1): só existem com o armazenamento das
 * imagens, como as rotas da API delas.
 */
export function rotasDasImagensNoHub(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  armazenamento: Armazenamento,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    "/hub/products/:id/media",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "As imagens de um artigo para o Hub: as mesmas do GET /products/{id}/media (docs/22 §12.1).",
        params: ParametroArtigo,
        querystring: ConsultaPagina,
        response: { 200: Lista(MediaEsquema), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      imagensDeArtigo(
        base,
        comercianteLeitor(pedido, resposta),
        pedido.params.id,
        pedido.query,
        resposta,
      ),
  );

  rotas.get(
    "/hub/media/:id/file",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Os bytes de uma imagem para o Hub: os mesmos do GET /media/{id}/file, sem cache (docs/22 §12.1).",
        params: ParametroMedia,
        response: {
          200: {
            description: "A imagem",
            content: Object.fromEntries(
              TIPOS_DE_IMAGEM.map((t) => [
                t,
                { schema: { type: "string", format: "binary" } },
              ]),
            ),
          },
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      enviarBytesDaMedia(
        base,
        armazenamento,
        comercianteLeitor(pedido, resposta),
        pedido.params.id,
        pedido.log,
        resposta,
        "private, no-store",
      ),
  );
}

/**
 * O comerciante de quem lê o catálogo pelo Hub: a sessão com `catalog:read`
 * e o comerciante do cabeçalho, validado pela base. A resposta não fica em
 * nenhuma cache (o endereço é o mesmo para comerciantes diferentes; revisão
 * do #201, P3-3).
 */
function comercianteLeitor(
  pedido: FastifyRequest,
  resposta: FastifyReply,
): string {
  const sessao = sessaoDo(pedido);
  // Hoje os quatro papéis têm catalog:read (docs/21 §5): esta recusa só se
  // alcança se um papel novo não o tiver (revisão do #201, P3-1).
  if (!sessao.ambitos.includes("catalog:read")) {
    throw erroConta("member.role_escalation", "o papel não lê o catálogo");
  }
  if (sessao.comercianteId === null) {
    throw new Error("rota com comerciante sem o comerciante da sessão");
  }
  void resposta.header("cache-control", "private, no-store");
  return sessao.comercianteId;
}
