import { createHash } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely, Transaction } from "kysely";
import { Type, type Static } from "typebox";
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
export const ParametroMedia = Type.Object({ id: idCom("med", "med_…") });

const FicheiroEsquema = Type.Object({
  id: Type.String({ description: "fil_…" }),
  tipo: TipoImagem,
  bytes: Type.Integer({ minimum: 1 }),
});

export const MediaEsquema = Type.Object({
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

export const PedidoAlterarMedia = Type.Object(
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

/**
 * Altera a imagem na transacção dada e devolve-a. Chamam-na o
 * PATCH /media/{id} (pela chave) e o PATCH /hub/media/{id} (pela sessão;
 * docs/22 §13.2).
 */
export async function alteracaoDaMedia(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  idComPrefixo: string,
  corpo: Static<typeof PedidoAlterarMedia>,
): Promise<Static<typeof MediaEsquema>> {
  const id = semPrefixo(idComPrefixo);
  const { versao, ...alteracao } = corpo;
  await alterarMedia(trx, comercianteId, id, versao, alteracao);
  return paraMedia(await fichaDaMedia(trx, comercianteId, id));
}

/**
 * As imagens de um artigo (docs/14 §3.8): as mesmas para
 * `GET /products/{id}/media` e `GET /hub/products/{id}/media` (docs/22
 * §12.1). **Outro chamador, fora do catálogo:** `identidade/hub-catalogo.ts`.
 */
export async function imagensDeArtigo(
  base: Kysely<BaseDados>,
  comercianteId: string,
  id: string,
  consulta: Static<typeof ConsultaPagina>,
  resposta: FastifyReply,
) {
  const { limite, depois } = paginaDe(consulta);
  const pagina = await noCatalogoApi(resposta, () =>
    mediaDoArtigo(base, comercianteId, semPrefixo(id), limite, depois),
  );
  return {
    dados: pagina.dados.map(paraMedia),
    total: pagina.total,
    ha_mais: pagina.ultima !== null,
    cursor_seguinte:
      pagina.ultima === null ? null : cursorPosicaoEId(pagina.ultima),
  };
}

/**
 * Os bytes de uma imagem: os mesmos para `GET /media/{id}/file` e
 * `GET /hub/media/{id}/file` (docs/22 §12.1), com as mesmas guardas; só o
 * `cache-control` muda (o Hub não guarda: o endereço é o mesmo para
 * comerciantes diferentes). **Outro chamador:** `identidade/hub-catalogo.ts`.
 */
export async function enviarBytesDaMedia(
  base: Kysely<BaseDados>,
  armazenamento: Armazenamento,
  comercianteId: string,
  id: string,
  registo: FastifyBaseLogger,
  resposta: FastifyReply,
  cache: string,
) {
  const media = await noCatalogoApi(resposta, () =>
    fichaDaMedia(base, comercianteId, semPrefixo(id)),
  );
  let bytes: Buffer;
  try {
    bytes = await armazenamento.ler(comercianteId, media.ficheiro_resumo);
  } catch (erro) {
    // A linha existe e o ficheiro não (apagado à mão, cópia reposta só
    // da base): 500 sem pormenor para fora, e o registo diz qual.
    registo.error(
      { err: erro, media: media.id, resumo: media.ficheiro_resumo },
      "media: o ficheiro não está no armazenamento",
    );
    throw erro;
  }
  // O tipo é o que a API confirmou ao receber; o browser não adivinha
  // outro, e a imagem não corre nada (nem que leve código escondido).
  return resposta
    .header("content-type", media.tipo)
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "default-src 'none'; sandbox")
    .header("cache-control", cache)
    .header("etag", `"${media.ficheiro_resumo}"`)
    .send(bytes);
}

export function rotasDaMedia(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  armazenamento: Armazenamento,
) {
  // O envio num plugin só dele: o leitor dos bytes das imagens e o limite de
  // envios em simultâneo ficam só nesta rota (revisão do #176, P3-1 e P2-3).
  void instancia.register((envio, _o, pronto) => {
    rotaDoEnvio(envio, base, armazenamento);
    pronto();
  });
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  rotas.post(
    "/products/:id/media",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Liga um ficheiro enviado ao artigo (e, se se quiser, a uma variante dele), com o texto alternativo e a posição (por omissão, a seguir à última). `principal: true` tira a marca à que a tinha. Um ficheiro, uma variante de outro artigo ou um artigo que não existe dão catalog.not_found. **Sem `texto_alternativo`, a imagem impede a publicação** (texto_alternativo_em_falta, docs/14 §5, C2): se for do artigo, ou de uma variante à venda, reverificam-se todas as publicações publicadas dele, e as que não passam (por esta imagem ou por outra razão) saem de venda (motivo verificacao_falhou), e pôr o texto depois não as repõe — publica-se outra vez. Ligue a imagem já com o texto.",
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
    async (pedido, resposta) =>
      imagensDeArtigo(
        base,
        chaveDo(pedido).comercianteId,
        pedido.params.id,
        pedido.query,
        resposta,
      ),
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
    async (pedido, resposta) =>
      enviarBytesDaMedia(
        base,
        armazenamento,
        chaveDo(pedido).comercianteId,
        pedido.params.id,
        pedido.log,
        resposta,
        "private, no-cache",
      ),
  );

  rotas.patch(
    "/media/:id",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Altera o texto alternativo (nulo, tira-o), a posição ou a principal, na `versao` lida. Tirar o texto alternativo reverifica todas as publicações publicadas do artigo, e as que não passam (por esta imagem ou por outra razão) saem de venda (motivo verificacao_falhou; docs/14 §5, C2). `principal: true` tira a marca à que a tinha. Um valor igual ao actual não sobe a versão.",
        headers: CabecalhoIdempotencia,
        params: ParametroMedia,
        body: PedidoAlterarMedia,
        response: { 200: MediaEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        alteracaoDaMedia(
          trx,
          chave.comercianteId,
          pedido.params.id,
          pedido.body,
        ),
      ),
  );

  rotas.delete(
    "/media/:id",
    {
      config: { ambito: "catalog:write" },
      schema: {
        description:
          "Tira a imagem do artigo. O ficheiro continua guardado (pode estar noutra imagem). Não muda as publicações: uma publicação que saiu de venda por esta imagem publica-se outra vez.",
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

/** Quantos envios cada comerciante faz ao mesmo tempo (**proposta**). */
export const ENVIOS_EM_SIMULTANEO = 2;

/**
 * O envio dos bytes. Cada envio ocupa até 10 MB de memória até acabar: um
 * comerciante tem no máximo `ENVIOS_EM_SIMULTANEO` ao mesmo tempo; o
 * seguinte dá 429 antes de se ler o corpo (revisão do #176, P2-3).
 */
function rotaDoEnvio(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  armazenamento: Armazenamento,
) {
  // Os bytes das imagens chegam como estão, só nos tipos aceites e até ao
  // tamanho máximo; outro tipo dá 415 e acima do máximo 413 (os códigos
  // da base).
  instancia.addContentTypeParser(
    [...TIPOS_DE_IMAGEM],
    { parseAs: "buffer", bodyLimit: TAMANHO_MAXIMO },
    (_pedido, corpo, feito) => {
      feito(null, corpo);
    },
  );
  const emCurso = new Map<string, number>();
  // O pedido contado e de que comerciante: só esses se descontam (um pedido
  // recusado antes, sem chave ou acima do limite, não conta).
  const contados = new WeakMap<object, string>();
  const largar = (pedido: { raw: object }) => {
    const comercianteId = contados.get(pedido.raw);
    if (comercianteId === undefined) return;
    contados.delete(pedido.raw);
    const n = (emCurso.get(comercianteId) ?? 1) - 1;
    if (n <= 0) emCurso.delete(comercianteId);
    else emCurso.set(comercianteId, n);
  };
  // Depois da autenticação (o gancho da app corre antes deste) e antes de
  // ler o corpo.
  instancia.addHook("onRequest", async (pedido, resposta) => {
    const { comercianteId } = chaveDo(pedido);
    const n = emCurso.get(comercianteId) ?? 0;
    if (n >= ENVIOS_EM_SIMULTANEO) {
      void resposta.header("Retry-After", "1");
      throw erroBase(
        "rate_limit.exceeded",
        `no máximo ${String(ENVIOS_EM_SIMULTANEO)} envios de imagens ao mesmo tempo`,
      );
    }
    emCurso.set(comercianteId, n + 1);
    contados.set(pedido.raw, comercianteId);
    // O fecho da resposta dispara quando ela acaba ou quando a ligação cai
    // (também a meio do corpo, ou quando o tempo acaba); o do pedido
    // disparava logo que o corpo chegava, e libertava o lugar cedo demais
    // (3.ª revisão do #176, P2-1, medido com um servidor a escutar). O
    // WeakMap não deixa descontar duas vezes.
    resposta.raw.once("close", () => {
      largar(pedido);
    });
  });
  instancia.addHook("onResponse", (pedido, _resposta, feito) => {
    largar(pedido);
    feito();
  });
  instancia.addHook("onRequestAbort", (pedido, feito) => {
    largar(pedido);
    feito();
  });
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
      const declarado = pedido.headers["content-type"]
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
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
      // A ordem conta (2.ª revisão do #176, P1-N1): a chave de idempotência
      // primeiro (uma chave já usada devolve a resposta guardada ou recusa,
      // sem tocar no disco); depois o registo, na fila do comerciante, que
      // confere o espaço; só então os bytes no disco. Se a gravação falhar,
      // a transacção desfaz o registo. Um órfão só fica se o COMMIT falhar
      // depois de gravar (docs/14 §3.5).
      return escrever(
        base,
        pedido,
        resposta,
        201,
        async (trx, c) => {
          await registarFicheiro(
            trx,
            c.comercianteId,
            { resumo, tipo, bytes: bytes.length },
            armazenamento.quotaPorComerciante,
          );
          await armazenamento.guardar(c.comercianteId, resumo, bytes);
          return { id: `fil_${resumo}`, tipo, bytes: bytes.length };
        },
        undefined,
        { resumo, tipo, bytes: bytes.length },
      );
    },
  );
}
