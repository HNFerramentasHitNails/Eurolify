import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql, type Kysely, type Transaction } from "kysely";
import { Type, type Static } from "typebox";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import type { Armazenamento } from "../catalogo/armazenamento.js";
import { ErroCatalogo } from "../catalogo/erros.js";
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
  alteracaoDoArtigo,
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
  ParametroArtigo,
  ParametroVariante,
  PedidoAlterarArtigo,
  PedidoVersao,
  publicacoesDeArtigo,
  RespostaArtigos,
  RespostaPublicacoes,
  semPrefixo,
  VarianteCompleta,
} from "../catalogo/rotas.js";
import {
  Alteracao,
  ConsultaLinhaDoTempo,
  linhaDoTempoDeArtigo,
  RespostaLinhaDoTempo,
} from "../catalogo/rotas-linha-do-tempo.js";
import { comComerciante } from "../comerciante/repositorio.js";
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
 * O que o Hub altera no artigo: o nome, a descrição e a marca. A categoria
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

/** Quem fez uma entrada do histórico, para o Hub (docs/22 §16.2). */
const Autor = Type.Object({
  tipo: Type.Union([
    Type.Literal("pessoa"),
    Type.Literal("chave"),
    Type.Literal("sistema"),
    Type.Literal("outro"),
  ]),
  nome: Type.Union([Type.String(), Type.Null()], {
    description:
      "O nome de quem é ou foi da equipa deste comerciante, ou o nome da chave dele; vazio nos outros casos",
  }),
});
const RespostaLinhaDoTempoNoHub = Type.Object({
  ...RespostaLinhaDoTempo.properties,
  dados: Type.Array(Type.Object({ ...Alteracao.properties, autor: Autor })),
});

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
  const linhas = await traduzindoConta(() =>
    comComerciante(base, comercianteId, async (trx) => {
      const { rows } = await sql<{ tipo: string; id: string; nome: string }>`
        select tipo, id, nome from autores_da_linha_do_tempo(
          ${segredo}, ${[...pessoas]}::uuid[], ${[...chaves]}::uuid[])`.execute(
        trx,
      );
      return rows;
    }),
  );
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
  if (QUEM_PESSOA.test(quem)) {
    return { tipo: "pessoa", nome: nomes.get(quem) ?? null };
  }
  if (QUEM_CHAVE.test(quem)) {
    return { tipo: "chave", nome: nomes.get(quem) ?? null };
  }
  if (quem.startsWith("sistema:") || quem.startsWith("catalogo:")) {
    return { tipo: "sistema", nome: null };
  }
  return { tipo: "outro", nome: null };
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
      const nomes = await nomesDosAutores(
        base,
        sessao.segredo,
        comercianteId,
        lista.dados.map((a) => a.quem),
      );
      return {
        ...lista,
        dados: lista.dados.map((a) => ({
          ...a,
          autor: autorDe(a.quem, nomes),
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
  fn: (trx: Transaction<BaseDados>, comercianteId: string) => Promise<T>,
): Promise<T> {
  const sessao = sessaoDo(pedido);
  if (!sessao.ambitos.includes("catalog:write")) {
    throw erroConta(
      "member.role_escalation",
      "o papel não escreve no catálogo",
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
      return fn(trx, comercianteId);
    }),
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
