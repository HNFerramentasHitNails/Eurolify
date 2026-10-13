import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql, type Kysely, type Transaction } from "kysely";
import { Type, type Static } from "typebox";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import type { Armazenamento } from "../catalogo/armazenamento.js";
import { ErroCatalogo, ESPERA_MAXIMA } from "../catalogo/erros.js";
import {
  alteracaoDaMedia,
  DESCRICAO_DO_ENVIO,
  enviarBytesDaMedia,
  FicheiroEsquema,
  guardarImagem,
  imagensDeArtigo,
  ligacaoDaMedia,
  MediaEsquema,
  ParametroMedia,
  PedidoAlterarMedia,
  PedidoLigarMedia,
  prepararEnvio,
  receberImagem,
  remocaoDaMedia,
} from "../catalogo/rotas-media.js";
import {
  alteracaoDaVariante,
  alteracaoDoArtigo,
  criacaoDaVariante,
  arquivoDaVariante,
  Artigo,
  CamposDoArtigo,
  ConsultaArtigos,
  ConsultaPagina,
  criacaoDoArtigo,
  fichaDeArtigo,
  Lista,
  listaDeArtigos,
  mudancaDeEstado,
  MUDANCAS_DE_ESTADO,
  noCatalogoApi,
  NovaVariante,
  OpcaoEsquema,
  ESCRITAS_DAS_OPCOES,
  ParametroOpcao,
  ParametroValorDaOpcao,
  PedidoAcrescentarValor,
  PedidoCriarOpcao,
  PedidoMudarNomeDaOpcao,
  PedidoMudarTextoDoValor,
  PedidoOrdemDasOpcoes,
  PedidoOrdemDosValores,
  PedidoValoresDaVariante,
  opcoesDeArtigoComVariantes,
  ParametroArtigo,
  ParametroVariante,
  PedidoAlterarArtigo,
  PedidoAlterarVariante,
  PedidoCriarVariante,
  PedidoVersao,
  publicacoesDeArtigo,
  RespostaArtigos,
  idCom,
  PublicacaoEsquema,
  ParametroPublicacao,
  paraPublicacao,
  PedidoPublicar,
  PedidoVerificar,
  RespostaPublicar,
  semPrefixo,
  VarianteCompleta,
  Verificacao,
} from "../catalogo/rotas.js";
import {
  publicar,
  retirarPublicacao,
  verificarPublicacao,
} from "../catalogo/publicacao.js";
import {
  Alteracao,
  ConsultaLinhaDoTempo,
  linhaDoTempoDeArtigo,
  RespostaLinhaDoTempo,
} from "../catalogo/rotas-linha-do-tempo.js";
import { comComerciante } from "../comerciante/repositorio.js";
import {
  definirPreco,
  nomesDeCanaisEMercados,
  paresDeVenda,
  tirarPreco,
} from "../precos/repositorio.js";
import {
  emPrecos,
  ParametroPreco,
  PedidoPreco,
  PrecoEsquema,
  precoNa,
  precosDoArtigoApi,
  RespostaPrecosDoArtigo,
} from "../precos/rotas.js";
import { TIPOS_DE_IMAGEM } from "../base/esquema.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sessaoDo } from "./autenticacao.js";
import { erroConta, traduzindoConta } from "./sessoes.js";

// O catálogo no Hub (docs/22 §11 e §12; issues #199 e #204). No ensaio, o endereço do Hub
// só passa à API os caminhos /hub/ (nginx-hub.conf, revisão do #160, P1-1):
// a lista, a ficha, as imagens e as publicações respondem aqui com as
// mesmas funções e respostas das rotas da API (docs/14 §7.1), só com a
// sessão de uma pessoa
// cujo papel tem `catalog:read` (docs/21 §5: os quatro). O comerciante é o
// do cabeçalho, validado pela base com o membro activo (sessao_resolver).
// As escritas (docs/22 §13; issue #210) usam também as mesmas funções, com
// a pessoa da sessão como «quem fez» na linha do tempo.

/**
 * O que o Hub altera no artigo: o nome, a descrição, a marca e o «selado
 * por higiene» (docs/30 §15). A categoria
 * fiscal fica de fora (docs/22 §13.1): decide o IVA e só entra no Hub como
 * escolha de uma lista dada pelo servidor (revisão do #217, P1-1).
 */
const PedidoAlterarArtigoNoHub = Type.Omit(
  PedidoAlterarArtigo,
  ["categoria_fiscal"],
  { additionalProperties: false },
);

/** Quantas variantes um artigo criado no Hub traz (decisão do Diogo, 09/10/2026). */
export const MAX_VARIANTES_NO_HUB = 20;

/**
 * O que o Hub cria (docs/22 §14.1 e §14.2): um artigo físico, sem a
 * categoria fiscal (decide o IVA), e variantes sem `onu` e `classe_adr`
 * (mercadorias perigosas, C) nem `posicao` (a ordem é a do formulário). O
 * artigo nasce `eurolify`: não há `origem_ref`.
 */
const PedidoCriarArtigoNoHub = Type.Object(
  {
    tipo: Type.Literal("fisico"),
    nome: CamposDoArtigo.properties.nome,
    descricao: CamposDoArtigo.properties.descricao,
    marca: CamposDoArtigo.properties.marca,
    variantes: Type.Array(
      Type.Omit(NovaVariante, ["onu", "classe_adr", "posicao"], {
        additionalProperties: false,
      }),
      { minItems: 1, maxItems: MAX_VARIANTES_NO_HUB },
    ),
  },
  { additionalProperties: false },
);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const QUEM_PESSOA = new RegExp(`^pessoa:per_(${UUID})$`);
const QUEM_CHAVE = new RegExp(`^chave:key_(${UUID})$`);

/**
 * Quem fez uma entrada do histórico, para o Hub (docs/22 §16.2): só o nome.
 * O tipo de autor é o `tipo_de_autor` da entrada (docs/28 §3.6); o antigo
 * `autor.tipo` saiu quando o Hub deixou de o ler (revisão do #349, P2-3;
 * docs/22 §26.1).
 */
const Autor = Type.Object({
  nome: Type.Union([Type.String(), Type.Null()], {
    description:
      "O nome de quem é ou foi da equipa deste comerciante, ou o nome da chave dele; vazio nos outros casos",
  }),
});
/** As publicações com os nomes do canal, do mercado e da loja (docs/22 §18.1, §19.1). */
const RespostaPublicacoesNoHub = Type.Object({
  dados: Type.Array(
    Type.Object({
      ...PublicacaoEsquema.properties,
      canal_nome: Type.Union([Type.String(), Type.Null()], {
        description: "O nome do canal; vazio se não se encontrar",
      }),
      mercado_nome: Type.Union([Type.String(), Type.Null()], {
        description: "O nome do mercado; vazio se não se encontrar",
      }),
      loja_nome: Type.Union([Type.String(), Type.Null()], {
        description:
          "O nome da loja da publicação (a do canal e do mercado); vazio se não se encontrar",
      }),
    }),
  ),
});
/** Os pares onde o Hub pode publicar (docs/22 §27.2). */
const RespostaParesDeVenda = Type.Object({
  dados: Type.Array(
    Type.Object({
      canal: Type.String({ description: "chn_…" }),
      canal_nome: Type.String(),
      canal_estado: Type.String({ description: "activo ou arquivado" }),
      mercado: Type.String({ description: "mkt_…" }),
      mercado_nome: Type.String(),
      mercado_estado: Type.String(),
      loja_nome: Type.String(),
    }),
  ),
});
/** O corpo de publicar pelo Hub: o da chave mais a `versao` lida (§27.2). */
const PedidoPublicarNoHub = Type.Object(
  {
    ...PedidoPublicar.properties,
    versao: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()], {
      description:
        "A `versao` lida da publicação neste par; `null` se ainda não existe",
    }),
    variantes_vistas: Type.Array(idCom("var", "var_…"), {
      maxItems: 500,
      description:
        "As variantes activas que o ecrã mostrou. Uma activa que não esteja aqui (criada com o ecrã aberto) dá 409 catalog.version_conflict, sem escrever (§27.2)",
    }),
  },
  { additionalProperties: false },
);
const RespostaOpcoesNoHub = Lista(
  Type.Object({
    ...OpcaoEsquema.properties,
    valores: Type.Array(
      Type.Object({
        id: Type.String({ description: "ovl_…" }),
        valor: Type.String(),
        variantes: Type.Array(Type.String({ description: "var_…" }), {
          description:
            "As variantes que têm este valor, também as arquivadas; vazia se nenhuma o usa (docs/22 §20.1)",
        }),
      }),
      { description: "Pela ordem (posição)" },
    ),
  }),
);
/** O nome de quem autorizou ou de quem pediu a tarefa (docs/22 §26.2). */
const NomeDoRasto = (description: string) =>
  Type.Union(
    [
      Type.Object({
        nome: Type.Union([Type.String(), Type.Null()], {
          description:
            "O nome, com a regra do `autor` (§16.2): só de quem é ou foi da equipa deste comerciante, ou de uma chave dele; vazio nos outros casos",
        }),
      }),
      Type.Null(),
    ],
    { description },
  );
const RespostaLinhaDoTempoNoHub = Type.Object({
  ...RespostaLinhaDoTempo.properties,
  dados: Type.Array(
    Type.Object({
      ...Alteracao.properties,
      autor: Autor,
      autor_autorizou: NomeDoRasto(
        "Quem autorizou (`autorizado_por`), com o nome; vazio quando ninguém ficou registado (docs/22 §26.2)",
      ),
      autor_do_pedido: NomeDoRasto(
        "Numa tarefa, quem fez o pedido de origem (`a_pedido_de.quem`), com o nome; vazio fora de uma tarefa ou sem quem (docs/22 §26.2)",
      ),
    }),
  ),
});

/** A função da base aceita no máximo 200 de cada tipo de cada vez (0038). */
const MAXIMO_DE_NOMES = 200;

/**
 * Os nomes das pessoas e das chaves de uma página do histórico, pela função
 * fechada da base (0038): só os de quem é ou foi membro deste comerciante e
 * só as chaves dele, e só para quem tem catalog:history.
 */
async function nomesDosAutores(
  base: Kysely<BaseDados>,
  segredo: string,
  comercianteId: string,
  quens: string[],
): Promise<Map<string, string>> {
  const pessoas = new Set<string>();
  const chaves = new Set<string>();
  for (const quem of quens) {
    const p = QUEM_PESSOA.exec(quem)?.[1];
    if (p !== undefined) pessoas.add(p);
    const c = QUEM_CHAVE.exec(quem)?.[1];
    if (c !== undefined) chaves.add(c);
  }
  const nomes = new Map<string, string>();
  if (pessoas.size === 0 && chaves.size === 0) return nomes;
  // Uma página de 100 entradas pode ter, com quem autorizou e quem pediu,
  // mais de 200 pessoas diferentes: pede-se aos bocados (docs/22 §26.2).
  const listaPessoas = [...pessoas];
  const listaChaves = [...chaves];
  const linhas: { tipo: string; id: string; nome: string }[] = [];
  for (
    let i = 0;
    i < Math.max(listaPessoas.length, listaChaves.length);
    i += MAXIMO_DE_NOMES
  ) {
    const bocadoPessoas = listaPessoas.slice(i, i + MAXIMO_DE_NOMES);
    const bocadoChaves = listaChaves.slice(i, i + MAXIMO_DE_NOMES);
    linhas.push(
      ...(await traduzindoConta(() =>
        comComerciante(base, comercianteId, async (trx) => {
          const { rows } = await sql<{
            tipo: string;
            id: string;
            nome: string;
          }>`
            select tipo, id, nome from autores_da_linha_do_tempo(
              ${segredo}, ${bocadoPessoas}::uuid[], ${bocadoChaves}::uuid[])`.execute(
            trx,
          );
          return rows;
        }),
      )),
    );
  }
  for (const l of linhas) {
    nomes.set(
      l.tipo === "pessoa" ? `pessoa:per_${l.id}` : `chave:key_${l.id}`,
      l.nome,
    );
  }
  return nomes;
}

/** O autor de uma entrada, com o nome que a base deu (§16.2). */
function autorDe(
  quem: string,
  nomes: Map<string, string>,
): Static<typeof Autor> {
  // Só as pessoas e as chaves têm nome; o resto fica vazio.
  return {
    nome:
      QUEM_PESSOA.test(quem) || QUEM_CHAVE.test(quem)
        ? (nomes.get(quem) ?? null)
        : null,
  };
}

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
          "As publicações de um artigo para o Hub: as mesmas do GET /products/{id}/publications (docs/22 §12.1), com o nome do canal, do mercado e da loja de cada uma (§18.1, §19.1).",
        params: ParametroArtigo,
        response: { 200: RespostaPublicacoesNoHub, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const comercianteId = comercianteLeitor(pedido, resposta);
      const { dados } = await publicacoesDeArtigo(
        base,
        comercianteId,
        pedido.params.id,
        resposta,
      );
      if (dados.length === 0) return { dados: [] };
      const nomes = await nomesDeCanaisEMercados(
        base,
        comercianteId,
        [...new Set(dados.map((p) => semPrefixo(p.canal)))],
        [...new Set(dados.map((p) => semPrefixo(p.mercado)))],
      );
      return {
        dados: dados.map((p) => ({
          ...p,
          canal_nome: nomes.canais.get(semPrefixo(p.canal)) ?? null,
          mercado_nome: nomes.mercados.get(semPrefixo(p.mercado)) ?? null,
          loja_nome: nomes.lojasDosCanais.get(semPrefixo(p.canal)) ?? null,
        })),
      };
    },
  );

  // Publicar pelo Hub (docs/22 §27; issue #378): os pares onde se pode
  // publicar, a verificação e as escritas, com as mesmas funções das rotas
  // pela chave; as escritas levam a `versao` lida da publicação (§27.2).
  rotas.get(
    "/hub/sales-pairs",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Os pares canal × mercado do comerciante onde o canal vende, com o nome e o estado do canal, do mercado e da loja: onde o Hub pode publicar um artigo (docs/22 §27.2). Com a sessão de quem tem catalog:read.",
        response: { 200: RespostaParesDeVenda, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const comercianteId = comercianteLeitor(pedido, resposta);
      const pares = await emPrecos(resposta, () =>
        paresDeVenda(base, comercianteId),
      );
      return {
        dados: pares.map((p) => ({
          canal: `chn_${p.canal_id}`,
          canal_nome: p.canal_nome,
          canal_estado: p.canal_estado,
          mercado: `mkt_${p.mercado_id}`,
          mercado_nome: p.mercado_nome,
          mercado_estado: p.mercado_estado,
          loja_nome: p.loja_nome,
        })),
      };
    },
  );

  rotas.post(
    "/hub/products/:id/publications/check",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "«Pode publicar?» pelo Hub: a mesma verificação (C2) do POST /products/{id}/publications/check, sem escrever, com a sessão de quem tem catalog:read (docs/22 §27.2).",
        params: ParametroArtigo,
        body: PedidoVerificar,
        response: { 200: Verificacao, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const comercianteId = comercianteLeitor(pedido, resposta);
      const corpo = pedido.body;
      return noCatalogoApi(resposta, () =>
        verificarPublicacao(base, comercianteId, {
          artigo_id: semPrefixo(pedido.params.id),
          canal_id: semPrefixo(corpo.canal),
          mercado_id: semPrefixo(corpo.mercado),
          variantes_fora: (corpo.variantes_fora ?? []).map(semPrefixo),
        }),
      );
    },
  );

  rotas.post(
    "/hub/products/:id/publications",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Publica o artigo num canal × mercado pelo Hub: a mesma escrita do POST /products/{id}/publications (a verificação C2 e, sem impedimentos, à venda; com impedimentos 200 com `publicada: false`), com a sessão de quem tem catalog:publish e a `versao` lida da publicação (`null` se ainda não existe nesse par; outra dá 409 catalog.version_conflict; docs/22 §27.2). Ler sempre `publicada`.",
        params: ParametroArtigo,
        body: PedidoPublicarNoHub,
        response: { 200: RespostaPublicar, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(
        base,
        pedido,
        resposta,
        async (trx, comercianteId, quem) => {
          const corpo = pedido.body;
          const r = await publicar(
            trx,
            comercianteId,
            quem,
            {
              artigo_id: semPrefixo(pedido.params.id),
              canal_id: semPrefixo(corpo.canal),
              mercado_id: semPrefixo(corpo.mercado),
              variantes_fora: (corpo.variantes_fora ?? []).map(semPrefixo),
            },
            corpo.versao,
            corpo.variantes_vistas.map(semPrefixo),
          );
          return {
            publicada: r.publicada,
            verificacao: r.verificacao,
            publicacao:
              r.publicacao === null ? null : paraPublicacao(r.publicacao),
          };
        },
        "catalog:publish",
      ),
  );

  rotas.post(
    "/hub/publications/:id/archive",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Retira uma publicação de venda pelo Hub (publicado → arquivado, motivo `retirada`): a mesma escrita do POST /publications/{id}/archive, com a sessão de quem tem catalog:publish e a `versao` lida no corpo (outra dá 409 catalog.version_conflict; docs/22 §27.2).",
        params: ParametroPublicacao,
        body: PedidoVersao,
        response: { 200: PublicacaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(
        base,
        pedido,
        resposta,
        async (trx, comercianteId, quem) =>
          paraPublicacao(
            await retirarPublicacao(
              trx,
              comercianteId,
              quem,
              semPrefixo(pedido.params.id),
              pedido.body.versao,
            ),
          ),
        "catalog:publish",
      ),
  );

  // As opções do artigo (docs/22 §20; issue #278): a mesma função do
  // GET /products/{id}/options, com as variantes de cada valor (§20.1).
  rotas.get(
    "/hub/products/:id/options",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "As opções de um artigo para o Hub: as mesmas do GET /products/{id}/options (pela ordem, com os valores pela ordem, no formato das listas), e cada valor com as `variantes` que o têm, também as arquivadas, com a sessão de quem tem catalog:read (docs/22 §20.1).",
        params: ParametroArtigo,
        querystring: ConsultaPagina,
        response: { 200: RespostaOpcoesNoHub, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      opcoesDeArtigoComVariantes(
        base,
        comercianteLeitor(pedido, resposta),
        pedido.params.id,
        pedido.query,
        resposta,
      ),
  );

  // Os preços do artigo (docs/22 §17; issue #249): a mesma função do
  // GET /products/{id}/prices, com a sessão de quem tem prices:read (os
  // quatro papéis).
  rotas.get(
    "/hub/products/:id/prices",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Os preços de um artigo para o Hub: os mesmos do GET /products/{id}/prices (as listas activas, o mercado, os preços das variantes, a redução em vigor e o preço por unidade), com a sessão de quem tem prices:read (docs/22 §17.2).",
        params: ParametroArtigo,
        querystring: ConsultaPagina,
        response: { 200: RespostaPrecosDoArtigo, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      // Primeiro o comerciante (põe o no-store, também na recusa a seguir).
      const comercianteId = comercianteLeitor(pedido, resposta);
      if (!sessao.ambitos.includes("prices:read")) {
        throw erroConta("member.role_escalation", "o papel não lê os preços");
      }
      return precosDoArtigoApi(
        base,
        comercianteId,
        pedido.params.id,
        pedido.query,
        resposta,
      );
    },
  );

  // Definir e tirar o preço de uma variante numa lista (docs/22 §25; issue
  // #335): as mesmas funções do PUT e do DELETE pela chave, com a sessão de
  // quem tem prices:write (o dono e o gestor) e o preço `lido` (a versão e
  // o definido_em; null: a variante não tinha preço nesta lista). Também
  // num artigo externo (Q1).
  const PrecoLidoEsquema = Type.Object(
    {
      versao: Type.Integer({ minimum: 1 }),
      definido_em: Type.String({
        format: "date-time",
        description: "O `definido_em` do preço, como a leitura o deu",
      }),
    },
    { additionalProperties: false },
  );
  const CorpoPrecoNoHub = Type.Object(
    {
      ...PedidoPreco.properties,
      lido: Type.Union([PrecoLidoEsquema, Type.Null()]),
    },
    { additionalProperties: false },
  );
  const CorpoTirarPreco = Type.Object(
    { lido: PrecoLidoEsquema },
    { additionalProperties: false },
  );

  rotas.put(
    "/hub/price-lists/:id/prices/:variante",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Define o preço de uma variante numa lista pelo Hub: a mesma escrita do PUT /price-lists/{id}/prices/{variante}, sobre o preço `lido` (a versão e o definido_em; null quando não havia preço), com a sessão de quem tem prices:write (docs/22 §25.2). Outro preço guardado dá 409 prices.version_conflict.",
        params: ParametroPreco,
        body: CorpoPrecoNoHub,
        response: { 200: PrecoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverPrecoNoHub(
        base,
        pedido,
        resposta,
        async (trx, comercianteId, quem) => {
          const listaId = semPrefixo(pedido.params.id);
          const varianteId = semPrefixo(pedido.params.variante);
          const { lido, ...dados } = pedido.body;
          await definirPreco(
            trx,
            comercianteId,
            quem,
            listaId,
            varianteId,
            dados,
            lido,
          );
          return precoNa(trx, comercianteId, listaId, varianteId);
        },
      ),
  );

  rotas.delete(
    "/hub/price-lists/:id/prices/:variante",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Tira o preço de uma variante de uma lista pelo Hub: a mesma escrita do DELETE /price-lists/{id}/prices/{variante}, sobre o preço `lido` (no corpo, como as outras escritas do Hub), com a sessão de quem tem prices:write (docs/22 §25.2). Sem preço, ou com outro guardado, 409 prices.version_conflict.",
        params: ParametroPreco,
        body: CorpoTirarPreco,
        response: {
          204: Type.Null({ description: "Tirado; sem corpo" }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      await escreverPrecoNoHub(
        base,
        pedido,
        resposta,
        async (trx, comercianteId, quem) => {
          await tirarPreco(
            trx,
            comercianteId,
            quem,
            semPrefixo(pedido.params.id),
            semPrefixo(pedido.params.variante),
            pedido.body.lido,
          );
        },
      );
      return resposta.code(204).send(null);
    },
  );

  // O histórico do artigo (docs/22 §16; issue #239): a mesma função do
  // GET /products/{id}/timeline, com o nome de quem fez (§16.2), só para
  // quem tem catalog:history (o dono e o gestor).
  rotas.get(
    "/hub/products/:id/timeline",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "O histórico de um artigo para o Hub: as mesmas entradas, ordem e páginas do GET /products/{id}/timeline, com o `autor` de cada uma (o nome de quem é ou foi da equipa, ou o nome da chave), com a sessão de quem tem catalog:history (docs/22 §16.2).",
        params: ParametroArtigo,
        querystring: ConsultaLinhaDoTempo,
        response: { 200: RespostaLinhaDoTempoNoHub, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const sessao = sessaoDo(pedido);
      // Primeiro o comerciante (põe o no-store, também na recusa a seguir).
      const comercianteId = comercianteLeitor(pedido, resposta);
      if (!sessao.ambitos.includes("catalog:history")) {
        throw erroConta(
          "member.role_escalation",
          "o papel não vê a linha do tempo",
        );
      }
      const lista = await linhaDoTempoDeArtigo(
        base,
        comercianteId,
        pedido.params.id,
        pedido.query,
        resposta,
      );
      // Quem fez, quem autorizou e quem pediu a tarefa, com a mesma regra
      // dos nomes (§16.2; docs/22 §26.2).
      const nomes = await nomesDosAutores(
        base,
        sessao.segredo,
        comercianteId,
        lista.dados.flatMap((a) => [
          a.quem,
          ...(a.autorizado_por === null ? [] : [a.autorizado_por]),
          ...(a.a_pedido_de?.quem == null ? [] : [a.a_pedido_de.quem]),
        ]),
      );
      const nomeDe = (quem: string | null | undefined) =>
        quem == null ? null : { nome: nomes.get(quem) ?? null };
      return {
        ...lista,
        dados: lista.dados.map((a) => ({
          ...a,
          autor: autorDe(a.quem, nomes),
          autor_autorizou: nomeDe(a.autorizado_por),
          autor_do_pedido: nomeDe(a.a_pedido_de?.quem),
        })),
      };
    },
  );

  // Criar um artigo (docs/22 §14; issue #221): a mesma função do POST
  // /products. Sem Idempotency-Key: o SKU único por comerciante (também
  // arquivado, P7) recusa um segundo artigo com o mesmo pedido (§14.2).
  rotas.post(
    "/hub/products",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Cria um artigo físico em rascunho pelo Hub, com 1 a 20 variantes: a mesma escrita do POST /products, sem a categoria fiscal, `onu`, `classe_adr` e `posicao`, com a sessão de quem tem catalog:write (docs/22 §14.2). Um SKU que já existe dá catalog.sku_duplicate.",
        body: PedidoCriarArtigoNoHub,
        response: { 201: Artigo, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const ficha = await escreverNoHub(
        base,
        pedido,
        resposta,
        (trx, comercianteId) =>
          criacaoDoArtigo(trx, comercianteId, pedido.body),
      );
      void resposta.code(201).header("location", `/hub/products/${ficha.id}`);
      return ficha;
    },
  );

  // Editar o artigo (docs/22 §13; issue #210): as mesmas funções das rotas
  // pela chave, com a sessão de quem tem catalog:write. Num artigo que vem
  // do sistema de gestão (P5, §13.3), estas escritas são recusadas aqui; pela
  // chave continuam, porque é por ela que o sistema de gestão escreve.
  rotas.patch(
    "/hub/products/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Altera o nome, a descrição ou a marca de um artigo pelo Hub: a mesma escrita do PATCH /products/{id}, na `versao` lida, com a sessão de quem tem catalog:write (docs/22 §13.2). Num artigo externo dá catalog.external_field (§13.3).",
        params: ParametroArtigo,
        body: PedidoAlterarArtigoNoHub,
        response: { 200: Artigo, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(base, pedido, resposta, async (trx, comercianteId) => {
        await recusarArtigoExterno(trx, semPrefixo(pedido.params.id));
        return alteracaoDoArtigo(
          trx,
          comercianteId,
          pedido.params.id,
          pedido.body,
        );
      }),
  );

  for (const [caminho, de, estado, descricao] of MUDANCAS_DE_ESTADO) {
    rotas.post(
      `/hub/products/:id/${caminho}`,
      {
        config: { ambito: "sessao_comerciante", hub: true },
        schema: {
          description: `${descricao} Pelo Hub, como o POST /products/{id}/${caminho}, na \`versao\` lida (docs/22 §13.2). Num artigo externo dá catalog.external_field (§13.3).`,
          params: ParametroArtigo,
          body: PedidoVersao,
          response: { 200: Artigo, ...RESPOSTA_DE_ERRO },
        },
      },
      async (pedido, resposta) =>
        escreverNoHub(base, pedido, resposta, async (trx, comercianteId) => {
          await recusarArtigoExterno(trx, semPrefixo(pedido.params.id));
          return mudancaDeEstado(
            trx,
            comercianteId,
            pedido.params.id,
            pedido.body.versao,
            estado,
            de,
          );
        }),
    );
  }

  rotas.post(
    "/hub/variants/:id/archive",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Arquiva uma variante pelo Hub (final), como o POST /variants/{id}/archive; o corpo é `{}`, porque as escritas do Hub são JSON (docs/22 §13.2). Num artigo externo dá catalog.external_field (§13.3).",
        params: ParametroVariante,
        body: Type.Object({}, { additionalProperties: false }),
        response: { 200: VarianteCompleta, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(base, pedido, resposta, async (trx, comercianteId) => {
        await recusarVarianteExterna(trx, semPrefixo(pedido.params.id));
        return arquivoDaVariante(trx, comercianteId, pedido.params.id);
      }),
  );

  // Acrescentar uma variante pelo Hub (docs/22 §24.1; issue #321): a mesma
  // escrita do POST /products/{id}/variants; num artigo externo,
  // catalog.external_field (§13.3).
  rotas.post(
    "/hub/products/:id/variants",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Acrescenta uma variante ao artigo pelo Hub: a mesma escrita do POST /products/{id}/variants (SKU único, os valores das opções, num artigo publicado nasce fora das publicações), com a sessão de quem tem catalog:write (docs/22 §24.1). Num artigo externo dá catalog.external_field (§13.3).",
        params: ParametroArtigo,
        body: PedidoCriarVariante,
        response: { 201: VarianteCompleta, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const variante = await escreverNoHub(
        base,
        pedido,
        resposta,
        async (trx, comercianteId) => {
          await recusarArtigoExterno(trx, semPrefixo(pedido.params.id));
          return criacaoDaVariante(
            trx,
            comercianteId,
            pedido.params.id,
            pedido.body,
          );
        },
      );
      void resposta.code(201);
      return variante;
    },
  );

  // Alterar uma variante pelo Hub (docs/22 §23.1; issue #301): a mesma
  // escrita do PATCH /variants/{id}, na `versao` da variante.
  rotas.patch(
    "/hub/variants/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Altera uma variante pelo Hub: a mesma escrita do PATCH /variants/{id}, na `versao` lida, com a sessão de quem tem catalog:write (docs/22 §23.1). Num artigo externo dá catalog.external_field (§13.3).",
        params: ParametroVariante,
        body: PedidoAlterarVariante,
        response: { 200: VarianteCompleta, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(base, pedido, resposta, async (trx, comercianteId) => {
        await recusarVarianteExterna(trx, semPrefixo(pedido.params.id));
        return alteracaoDaVariante(
          trx,
          comercianteId,
          pedido.params.id,
          pedido.body,
        );
      }),
  );

  // A escrita das opções pelo Hub (docs/22 §21.2; issue #285): as mesmas
  // operações das rotas pela chave, com a sessão de quem tem catalog:write;
  // num artigo externo, catalog.external_field (§13.3). Apagar leva a
  // `versao` no corpo: as escritas do Hub são JSON.
  const CorpoVersao = Type.Object(
    { versao: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false },
  );

  rotas.post(
    "/hub/products/:id/options",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Cria uma opção com os valores pelo Hub, como o POST /products/{id}/options (docs/22 §21.2).",
        params: ParametroArtigo,
        body: PedidoCriarOpcao,
        response: { 201: OpcaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const opcao = await escreverNoHub(
        base,
        pedido,
        resposta,
        async (trx, comercianteId) => {
          await recusarArtigoExterno(trx, semPrefixo(pedido.params.id));
          return ESCRITAS_DAS_OPCOES.criar(
            trx,
            comercianteId,
            pedido.params.id,
            pedido.body,
          );
        },
      );
      void resposta.code(201);
      return opcao;
    },
  );

  rotas.post(
    "/hub/options/:id/values",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Acrescenta um valor no fim pelo Hub, como o POST /options/{id}/values (docs/22 §21.2).",
        params: ParametroOpcao,
        body: PedidoAcrescentarValor,
        response: { 201: OpcaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const opcao = await escreverNoHub(
        base,
        pedido,
        resposta,
        async (trx, comercianteId) => {
          await recusarOpcaoExterna(trx, semPrefixo(pedido.params.id));
          return ESCRITAS_DAS_OPCOES.acrescentarValor(
            trx,
            comercianteId,
            pedido.params.id,
            pedido.body,
          );
        },
      );
      void resposta.code(201);
      return opcao;
    },
  );

  rotas.patch(
    "/hub/options/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Muda o nome da opção pelo Hub, como o PATCH /options/{id} (docs/22 §21.2).",
        params: ParametroOpcao,
        body: PedidoMudarNomeDaOpcao,
        response: { 200: OpcaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(base, pedido, resposta, async (trx, comercianteId) => {
        await recusarOpcaoExterna(trx, semPrefixo(pedido.params.id));
        return ESCRITAS_DAS_OPCOES.mudarNome(
          trx,
          comercianteId,
          pedido.params.id,
          pedido.body,
        );
      }),
  );

  rotas.patch(
    "/hub/options/:id/values/:valor",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Muda o texto de um valor pelo Hub, como o PATCH /options/{id}/values/{valor} (docs/22 §21.2).",
        params: ParametroValorDaOpcao,
        body: PedidoMudarTextoDoValor,
        response: { 200: OpcaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(base, pedido, resposta, async (trx, comercianteId) => {
        await recusarOpcaoExterna(trx, semPrefixo(pedido.params.id));
        return ESCRITAS_DAS_OPCOES.mudarValor(
          trx,
          comercianteId,
          pedido.params,
          pedido.body,
        );
      }),
  );

  rotas.delete(
    "/hub/options/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Apaga a opção pelo Hub, como o DELETE /options/{id}, com a `versao` no corpo (docs/22 §21.2).",
        params: ParametroOpcao,
        body: CorpoVersao,
        response: {
          204: Type.Null({ description: "Apagada; sem corpo" }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      await escreverNoHub(
        base,
        pedido,
        resposta,
        async (trx, comercianteId) => {
          await recusarOpcaoExterna(trx, semPrefixo(pedido.params.id));
          return ESCRITAS_DAS_OPCOES.apagarOpcao(
            trx,
            comercianteId,
            pedido.params.id,
            pedido.body.versao,
          );
        },
      );
      void resposta.code(204);
      return null;
    },
  );

  rotas.delete(
    "/hub/options/:id/values/:valor",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Apaga um valor pelo Hub, como o DELETE /options/{id}/values/{valor}, com a `versao` no corpo (docs/22 §21.2).",
        params: ParametroValorDaOpcao,
        body: CorpoVersao,
        response: { 200: OpcaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(base, pedido, resposta, async (trx, comercianteId) => {
        await recusarOpcaoExterna(trx, semPrefixo(pedido.params.id));
        return ESCRITAS_DAS_OPCOES.apagarValor(
          trx,
          comercianteId,
          pedido.params,
          pedido.body.versao,
        );
      }),
  );

  rotas.put(
    "/hub/products/:id/options/order",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Põe as opções do artigo pela ordem dada pelo Hub, como o PUT /products/{id}/options/order (docs/22 §21.2).",
        params: ParametroArtigo,
        body: PedidoOrdemDasOpcoes,
        response: { 200: Lista(OpcaoEsquema), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(base, pedido, resposta, async (trx, comercianteId) => {
        await recusarArtigoExterno(trx, semPrefixo(pedido.params.id));
        return ESCRITAS_DAS_OPCOES.ordenarOpcoes(
          trx,
          comercianteId,
          pedido.params.id,
          pedido.body,
        );
      }),
  );

  rotas.put(
    "/hub/options/:id/values/order",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Põe os valores da opção pela ordem dada pelo Hub, como o PUT /options/{id}/values/order (docs/22 §21.2).",
        params: ParametroOpcao,
        body: PedidoOrdemDosValores,
        response: { 200: OpcaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(base, pedido, resposta, async (trx, comercianteId) => {
        await recusarOpcaoExterna(trx, semPrefixo(pedido.params.id));
        return ESCRITAS_DAS_OPCOES.ordenarValores(
          trx,
          comercianteId,
          pedido.params.id,
          pedido.body,
        );
      }),
  );

  rotas.put(
    "/hub/variants/:id/values",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Dá à variante os valores das opções pelo Hub, como o PUT /variants/{id}/values (docs/22 §21.2).",
        params: ParametroVariante,
        body: PedidoValoresDaVariante,
        response: { 200: VarianteCompleta, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(base, pedido, resposta, async (trx, comercianteId) => {
        await recusarVarianteExterna(trx, semPrefixo(pedido.params.id));
        return ESCRITAS_DAS_OPCOES.valoresDaVariante(
          trx,
          comercianteId,
          pedido.params.id,
          pedido.body,
        );
      }),
  );
}

/**
 * Ligar uma imagem pelo Hub (docs/22 §15.1): o ficheiro, o texto
 * alternativo e se é a principal. A imagem de uma variante e a posição ficam
 * de fora (a nova vai para o fim).
 */
const PedidoLigarMediaNoHub = Type.Pick(
  PedidoLigarMedia,
  ["ficheiro", "texto_alternativo", "principal"],
  { additionalProperties: false },
);

/**
 * As imagens no Hub (docs/22 §12.1 e §15): só existem com o armazenamento
 * das imagens, como as rotas da API delas.
 */
export function rotasDasImagensNoHub(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  armazenamento: Armazenamento,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  // Enviar uma imagem nova (docs/22 §15; issue #229): as mesmas funções do
  // POST /media/uploads, num plugin só dele (o leitor dos bytes e o limite de
  // envios em simultâneo, partilhado com a chave). A única rota do Hub que
  // recebe outra coisa além de JSON (§15.2). Quem não escreve no catálogo é
  // recusado antes de se ler o corpo.
  void instancia.register((envio, _o, pronto) => {
    prepararEnvio(envio, base, (pedido) => comercianteEscritor(pedido));
    envio.withTypeProvider<TypeBoxTypeProvider>().post(
      "/hub/media/uploads",
      {
        config: { ambito: "sessao_comerciante", hub: true, hubImagem: true },
        schema: {
          description: `Envia uma imagem pelo Hub, como o POST /media/uploads (docs/22 §15.2): ${DESCRICAO_DO_ENVIO} Só da origem do Hub, com a sessão de quem tem catalog:write. Liga-se ao artigo com POST /hub/products/{id}/media.`,
          response: { 201: FicheiroEsquema, ...RESPOSTA_DE_ERRO },
        },
      },
      async (pedido, resposta) => {
        const imagem = receberImagem(
          pedido.body,
          pedido.headers["content-type"],
        );
        const ficheiro = await escreverNoHub(
          base,
          pedido,
          resposta,
          (trx, comercianteId) =>
            guardarImagem(trx, comercianteId, armazenamento, imagem),
        );
        void resposta.code(201);
        return ficheiro;
      },
    );
    pronto();
  });

  rotas.post(
    "/hub/products/:id/media",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Liga um ficheiro enviado ao artigo pelo Hub, como o POST /products/{id}/media, com o texto alternativo e se é a principal (docs/22 §15.2). Também num artigo externo (P5: a media edita-se no Eurolify, §13.3). O mesmo ficheiro duas vezes faz duas imagens: depois de uma resposta perdida, releia as imagens.",
        params: ParametroArtigo,
        body: PedidoLigarMediaNoHub,
        response: { 201: MediaEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const media = await escreverNoHub(
        base,
        pedido,
        resposta,
        (trx, comercianteId) =>
          ligacaoDaMedia(trx, comercianteId, pedido.params.id, pedido.body),
      );
      void resposta.code(201).header("location", `/hub/media/${media.id}`);
      return media;
    },
  );

  rotas.delete(
    "/hub/media/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Tira a imagem do artigo pelo Hub, como o DELETE /media/{id}: o ficheiro continua guardado e as publicações não mudam. O corpo é `{}`, porque as escritas do Hub são JSON (docs/22 §15.2).",
        params: ParametroMedia,
        body: Type.Object({}, { additionalProperties: false }),
        response: {
          204: Type.Null({ description: "Tirada; sem corpo" }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => {
      await escreverNoHub(base, pedido, resposta, (trx, comercianteId) =>
        remocaoDaMedia(trx, comercianteId, pedido.params.id),
      );
      void resposta.code(204);
      return null;
    },
  );

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

  // O texto alternativo, a principal e a ordem (docs/22 §13.1); também num
  // artigo externo (P5: a media edita-se no Eurolify, §13.3).
  rotas.patch(
    "/hub/media/:id",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Altera o texto alternativo, a posição ou a principal de uma imagem pelo Hub, como o PATCH /media/{id}, na `versao` lida (docs/22 §13.2).",
        params: ParametroMedia,
        body: PedidoAlterarMedia,
        response: { 200: MediaEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      escreverNoHub(base, pedido, resposta, (trx, comercianteId) =>
        alteracaoDaMedia(trx, comercianteId, pedido.params.id, pedido.body),
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

/**
 * O comerciante de quem escreve no catálogo pelo Hub, antes de ler o corpo
 * (o envio de uma imagem: quem não escreve não ocupa um lugar nos envios).
 */
function comercianteEscritor(pedido: FastifyRequest): string {
  const sessao = sessaoDo(pedido);
  if (!sessao.ambitos.includes("catalog:write")) {
    throw erroConta(
      "member.role_escalation",
      "o papel não escreve no catálogo",
    );
  }
  if (sessao.comercianteId === null) {
    throw new Error("rota com comerciante sem o comerciante da sessão");
  }
  return sessao.comercianteId;
}

/**
 * Uma escrita do catálogo pelo Hub: a sessão com `catalog:write`, uma
 * transacção no contexto do comerciante do cabeçalho e a pessoa como «quem
 * fez» (`pessoa:per_…`, a linha do tempo, docs/14 §3.12). Sem
 * Idempotency-Key, como as outras rotas do Hub (docs/21 §11): a `versao` no
 * corpo recusa a repetição de uma alteração (docs/22 §13.2), e na criação
 * é o SKU único que recusa um segundo artigo (§14.2).
 */
async function escreverNoHub<T>(
  base: Kysely<BaseDados>,
  pedido: FastifyRequest,
  resposta: FastifyReply,
  fn: (
    trx: Transaction<BaseDados>,
    comercianteId: string,
    quem: string,
  ) => Promise<T>,
  /** Publicar e retirar pedem `catalog:publish` (docs/22 §27.2). */
  ambito: "catalog:write" | "catalog:publish" = "catalog:write",
): Promise<T> {
  const sessao = sessaoDo(pedido);
  if (!sessao.ambitos.includes(ambito)) {
    throw erroConta(
      "member.role_escalation",
      ambito === "catalog:publish"
        ? "o papel não publica"
        : "o papel não escreve no catálogo",
    );
  }
  const comercianteId = sessao.comercianteId;
  if (comercianteId === null) {
    throw new Error("rota com comerciante sem o comerciante da sessão");
  }
  void resposta.header("cache-control", "private, no-store");
  const quem = `pessoa:per_${sessao.pessoaId}`;
  return noCatalogoApi(resposta, () =>
    comComerciante(base, comercianteId, async (trx) => {
      await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
      // O mesmo prazo de espera pelos bloqueios das escritas pela chave
      // (catalog.retry ao fim de 5 s), já no primeiro bloqueio, que é o de
      // recusar*Externo* (revisão do #326, P2-1): cobre todas as rotas do Hub.
      await sql`select set_config('lock_timeout', ${ESPERA_MAXIMA}, true)`.execute(
        trx,
      );
      return fn(trx, comercianteId, quem);
    }),
  );
}

/**
 * Uma escrita de Preços pelo Hub (docs/22 §25.2): só com prices:write (o
 * dono e o gestor), na transacção do comerciante da sessão, com o «quem» da
 * pessoa. O prazo de espera pelos bloqueios põe-no o `noDominio` de Preços
 * (5 s, depois prices.retry).
 */
async function escreverPrecoNoHub<T>(
  base: Kysely<BaseDados>,
  pedido: FastifyRequest,
  resposta: FastifyReply,
  fn: (
    trx: Transaction<BaseDados>,
    comercianteId: string,
    quem: string,
  ) => Promise<T>,
): Promise<T> {
  const sessao = sessaoDo(pedido);
  if (!sessao.ambitos.includes("prices:write")) {
    throw erroConta("member.role_escalation", "o papel não escreve preços");
  }
  const comercianteId = sessao.comercianteId;
  if (comercianteId === null) {
    throw new Error("rota com comerciante sem o comerciante da sessão");
  }
  void resposta.header("cache-control", "private, no-store");
  const quem = `pessoa:per_${sessao.pessoaId}`;
  return emPrecos(resposta, () =>
    comComerciante(base, comercianteId, (trx) => fn(trx, comercianteId, quem)),
  );
}

const ARTIGO_EXTERNO =
  "o artigo vem do sistema de gestão (P5): este campo altera-se lá";

/**
 * Num artigo que vem do sistema de gestão do comerciante, o Hub não muda
 * os campos de lá (P5, docs/22 §13.3; decisão do Diogo, 09/10/2026). Um
 * artigo que não existe passa: a função a seguir dá o 404.
 */
async function recusarArtigoExterno(
  trx: Transaction<BaseDados>,
  artigoId: string,
): Promise<void> {
  // Partilhada até ao fim da transacção: a origem não muda entre esta
  // leitura e a escrita (revisão do #217, P3-2).
  const linha = await trx
    .selectFrom("artigo")
    .select("origem")
    .where("id", "=", artigoId)
    .forShare()
    .executeTakeFirst();
  if (linha?.origem === "externo") {
    throw new ErroCatalogo("catalog.external_field", ARTIGO_EXTERNO);
  }
}

/** O mesmo, para uma opção: conta a origem do artigo dela (§21.2). */
async function recusarOpcaoExterna(
  trx: Transaction<BaseDados>,
  opcaoId: string,
): Promise<void> {
  const linha = await trx
    .selectFrom("opcao")
    .innerJoin("artigo", (j) =>
      j
        .onRef("artigo.comerciante_id", "=", "opcao.comerciante_id")
        .onRef("artigo.id", "=", "opcao.artigo_id"),
    )
    .select("artigo.origem")
    .where("opcao.id", "=", opcaoId)
    .forShare("artigo")
    .executeTakeFirst();
  if (linha?.origem === "externo") {
    throw new ErroCatalogo("catalog.external_field", ARTIGO_EXTERNO);
  }
}

/** O mesmo, para uma variante: conta a origem do artigo dela. */
async function recusarVarianteExterna(
  trx: Transaction<BaseDados>,
  varianteId: string,
): Promise<void> {
  const linha = await trx
    .selectFrom("variante")
    .innerJoin("artigo", "artigo.id", "variante.artigo_id")
    .select("artigo.origem")
    .where("variante.id", "=", varianteId)
    .forShare("artigo")
    .executeTakeFirst();
  if (linha?.origem === "externo") {
    throw new ErroCatalogo("catalog.external_field", ARTIGO_EXTERNO);
  }
}
