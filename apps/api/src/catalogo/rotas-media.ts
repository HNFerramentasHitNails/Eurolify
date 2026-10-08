import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { erroBase, RESPOSTA_DE_ERRO } from "../base/erros.js";
import { TIPOS_DE_IMAGEM, type BaseDados } from "../base/esquema.js";
import { chaveDo } from "../identidade/autenticacao.js";
import { CabecalhoIdempotencia } from "../identidade/rotas.js";
import {
  eTipoDeImagem,
  TAMANHO_MAXIMO,
  tipoDosBytes,
  type Armazenamento,
} from "./armazenamento.js";
import {
  alterarMedia,
  apagarMedia,
  criarMedia,
  fichaDaMedia,
  mediaDoArtigo,
  registarFicheiro,
} from "./media.js";
import {
  ConsultaPagina,
  cursorPosicaoEId,
  escrever,
  idCom,
  Instante,
  Lista,
  noCatalogoApi,
  ParametroArtigo,
  paginaDe,
  semPrefixo,
} from "./rotas.js";

// API de Administração do Catálogo: as imagens dos artigos (docs/14 §3.5 e
// §7.1; docs/06, CQ). Pedido do Diogo, 08/10/2026: «sim, fica a (a); avança
// com as imagens». Só existe com a base e com o armazenamento (MEDIA_PASTA).

const IdFicheiro = Type.String({
  pattern: "^fil_[0-9a-f]{64}$",
  description: "fil_ e o resumo SHA-256 do conteúdo",
});
const TipoImagem = Type.Unsafe<(typeof TIPOS_DE_IMAGEM)[number]>({
  type: "string",
  enum: [...TIPOS_DE_IMAGEM],
});
const TextoAlternativo = Type.String({
  minLength: 1,
  maxLength: 500,
  pattern: "\\S",
  description:
    "Na língua de origem; descreve a imagem a quem não a vê (acessibilidade)",
});
const Posicao = Type.Integer({ minimum: 0, maximum: 2147483647 });
const ParametroMedia = Type.Object({ id: idCom("med", "med_…") });

const FicheiroEsquema = Type.Object({
  id: Type.String({ description: "fil_…" }),
  tipo: TipoImagem,
  bytes: Type.Integer({ minimum: 1 }),
});

const MediaEsquema = Type.Object({
  id: Type.String({ description: "med_…" }),
  artigo: Type.String({ description: "prd_…" }),
  variante: Type.Union([Type.String({ description: "var_…" }), Type.Null()]),
  ficheiro: FicheiroEsquema,
  texto_alternativo: Type.Union([Type.String(), Type.Null()]),
  posicao: Type.Integer(),
  principal: Type.Boolean(),
  versao: Type.Integer(),
  criada_em: Instante,
  actualizada_em: Instante,
});

const PedidoLigarMedia = Type.Object(
  {
    ficheiro: IdFicheiro,
    variante: Type.Optional(
      Type.Union([idCom("var", "var_… do mesmo artigo"), Type.Null()]),
    ),
    texto_alternativo: Type.Optional(
      Type.Union([TextoAlternativo, Type.Null()]),
    ),
    posicao: Type.Optional(Posicao),
    principal: Type.Optional(
      Type.Boolean({
        description:
          "Verdadeiro, passa a ser a principal do artigo (a outra deixa de o ser)",
      }),
    ),
  },
  { additionalProperties: false },
);

const PedidoAlterarMedia = Type.Object(
  {
    versao: Type.Integer({ minimum: 1 }),
    texto_alternativo: Type.Optional(
      Type.Union([TextoAlternativo, Type.Null()]),
    ),
    posicao: Type.Optional(Posicao),
    principal: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

interface LinhaMedia {
  id: string;
  artigo_id: string;
  variante_id: string | null;
  ficheiro_resumo: string;
  tipo: (typeof TIPOS_DE_IMAGEM)[number];
  bytes: number;
  texto_alternativo: string | null;
  posicao: number;
  principal: boolean;
  versao: number;
  criado_em: Date;
  actualizado_em: Date;
}

const paraMedia = (m: LinhaMedia) => ({
  id: `med_${m.id}`,
  artigo: `prd_${m.artigo_id}`,
  variante: m.variante_id === null ? null : `var_${m.variante_id}`,
  ficheiro: { id: `fil_${m.ficheiro_resumo}`, tipo: m.tipo, bytes: m.bytes },
  texto_alternativo: m.texto_alternativo,
  posicao: m.posicao,
  principal: m.principal,
  versao: m.versao,
  criada_em: m.criado_em.toISOString(),
  actualizada_em: m.actualizado_em.toISOString(),
});

export function rotasDaMedia(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  armazenamento: Armazenamento,
) {
  // Os bytes das imagens chegam como estão, só nos tipos aceites e até ao
  // tamanho máximo; outro tipo dá 415 e acima do máximo 413 (os códigos
  // da base). Fica dentro deste plugin: o resto da API continua só JSON.
  instancia.addContentTypeParser(
    [...TIPOS_DE_IMAGEM],
    { parseAs: "buffer", bodyLimit: TAMANHO_MAXIMO },
    (_pedido, corpo, feito) => {
      feito(null, corpo);
    },
  );
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  rotas.post(
    "/media/uploads",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description: `Envia uma imagem: o corpo são os bytes, com o Content-Type do ficheiro (${TIPOS_DE_IMAGEM.join(", ")}), até ${String(TAMANHO_MAXIMO / 1024 / 1024)} MB. Os primeiros bytes têm de ser os desse tipo. Devolve o ficheiro (fil_ e o resumo SHA-256); o mesmo ficheiro enviado outra vez é o mesmo. Liga-se a um artigo com POST /products/{id}/media.`,
        headers: CabecalhoIdempotencia,
        response: { 201: FicheiroEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const bytes = pedido.body;
      const declarado = pedido.headers["content-type"]?.split(";")[0]?.trim();
      if (
        !Buffer.isBuffer(bytes) ||
        declarado === undefined ||
        !eTipoDeImagem(declarado)
      ) {
        throw erroBase(
          "media_type.unsupported",
          `envia-se a imagem em bruto, com o Content-Type ${TIPOS_DE_IMAGEM.join(", ")}`,
        );
      }
      const tipo = tipoDosBytes(bytes);
      if (tipo !== declarado) {
        throw erroBase(
          "request.invalid",
          tipo === null
            ? "o ficheiro não é uma imagem JPEG, PNG ou WebP"
            : `o ficheiro é ${tipo}, não ${declarado}`,
        );
      }
      const resumo = createHash("sha256").update(bytes).digest("hex");
      const chave = chaveDo(pedido);
      // Os bytes primeiro (o nome é o resumo: guardar outra vez não muda
      // nada); a linha a seguir, na transacção da idempotência. Se a linha
      // falhar, o ficheiro fica órfão no disco (docs/14 §3.5).
      await armazenamento.guardar(chave.comercianteId, resumo, bytes);
      return escrever(
        base,
        pedido,
        resposta,
        201,
        async (trx, c) => {
          await registarFicheiro(trx, c.comercianteId, {
            resumo,
            tipo,
            bytes: bytes.length,
          });
          return { id: `fil_${resumo}`, tipo, bytes: bytes.length };
        },
        undefined,
        { resumo, tipo, bytes: bytes.length },
      );
    },
  );

  rotas.post(
    "/products/:id/media",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Liga um ficheiro enviado ao artigo (e, se se quiser, a uma variante dele), com o texto alternativo e a posição (por omissão, a seguir à última). `principal: true` tira a marca à que a tinha. Um ficheiro, uma variante de outro artigo ou um artigo que não existe dão catalog.not_found.",
        headers: CabecalhoIdempotencia,
        params: ParametroArtigo,
        body: PedidoLigarMedia,
        response: { 201: MediaEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        201,
        async (trx, chave) => {
          const c = pedido.body;
          const id = await criarMedia(trx, chave.comercianteId, {
            artigoId: semPrefixo(pedido.params.id),
            varianteId:
              c.variante === undefined || c.variante === null
                ? null
                : semPrefixo(c.variante),
            resumo: semPrefixo(c.ficheiro),
            textoAlternativo: c.texto_alternativo ?? null,
            ...(c.posicao === undefined ? {} : { posicao: c.posicao }),
            principal: c.principal ?? false,
          });
          return paraMedia(await fichaDaMedia(trx, chave.comercianteId, id));
        },
        (corpo) => `/media/${(corpo as { id: string }).id}`,
      ),
  );

  rotas.get(
    "/products/:id/media",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "As imagens do artigo, pela ordem (posição), com o ficheiro de cada uma, no formato das listas (docs/18 §2a).",
        params: ParametroArtigo,
        querystring: ConsultaPagina,
        response: { 200: Lista(MediaEsquema), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const { limite, depois } = paginaDe(pedido.query);
      const pagina = await noCatalogoApi(resposta, () =>
        mediaDoArtigo(
          base,
          chave.comercianteId,
          semPrefixo(pedido.params.id),
          limite,
          depois,
        ),
      );
      return {
        dados: pagina.dados.map(paraMedia),
        total: pagina.total,
        ha_mais: pagina.ultima !== null,
        cursor_seguinte:
          pagina.ultima === null ? null : cursorPosicaoEId(pagina.ultima),
      };
    },
  );

  rotas.get(
    "/media/:id",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description: "Uma imagem do artigo, com o ficheiro.",
        params: ParametroMedia,
        response: { 200: MediaEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      return paraMedia(
        await noCatalogoApi(resposta, () =>
          fichaDaMedia(base, chave.comercianteId, semPrefixo(pedido.params.id)),
        ),
      );
    },
  );

  rotas.get(
    "/media/:id/file",
    {
      config: { ambito: "catalog:read" },
      schema: {
        description:
          "Os bytes da imagem, com o Content-Type dela. Só para a administração (com chave); a montra terá a sua.",
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
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const media = await noCatalogoApi(resposta, () =>
        fichaDaMedia(base, chave.comercianteId, semPrefixo(pedido.params.id)),
      );
      const bytes = await armazenamento.ler(
        chave.comercianteId,
        media.ficheiro_resumo,
      );
      // O tipo é o que a API confirmou ao receber; o browser não adivinha
      // outro, e a imagem não corre nada (nem que leve código escondido).
      return resposta
        .header("content-type", media.tipo)
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("cache-control", "private, no-cache")
        .header("etag", `"${media.ficheiro_resumo}"`)
        .send(bytes);
    },
  );

  rotas.patch(
    "/media/:id",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Altera o texto alternativo (nulo, tira-o), a posição ou a principal, na `versao` lida. `principal: true` tira a marca à que a tinha. Um valor igual ao actual não sobe a versão.",
        headers: CabecalhoIdempotencia,
        params: ParametroMedia,
        body: PedidoAlterarMedia,
        response: { 200: MediaEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, async (trx, chave) => {
        const id = semPrefixo(pedido.params.id);
        const { versao, ...alteracao } = pedido.body;
        await alterarMedia(trx, chave.comercianteId, id, versao, alteracao);
        return paraMedia(await fichaDaMedia(trx, chave.comercianteId, id));
      }),
  );

  rotas.delete(
    "/media/:id",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Tira a imagem do artigo. O ficheiro continua guardado (pode estar noutra imagem).",
        headers: CabecalhoIdempotencia,
        params: ParametroMedia,
        response: {
          204: Type.Null({ description: "Tirada; sem corpo" }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, async (trx, chave) => {
        await apagarMedia(
          trx,
          chave.comercianteId,
          semPrefixo(pedido.params.id),
        );
        return null;
      }),
  );
}
