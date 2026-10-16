import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import { ESTADOS_ENTREGA_WEBHOOK, type BaseDados } from "../base/esquema.js";
import { escrever, idCom, iso, semPrefixo, umDe } from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import { CabecalhoIdempotencia } from "../identidade/rotas.js";
import { LISTA_DE_TIPOS, TIPOS_DE_EVENTO } from "./eventos.js";
import {
  criarSubscricao,
  ErroWebhooks,
  ESTADO_DO_CODIGO,
  lerSubscricao,
  listarEntregas,
  listarSubscricoes,
  mudarSubscricao,
  reenviarEntrega,
  type ConfigWebhooks,
  type EntregaLida,
  type SubscricaoLida,
} from "./repositorio.js";

// A API dos webhooks de saída (docs/38 §4): a Administração das subscrições
// e do registo de entregas. Âmbitos: `merchant:read` para ler e `keys:write`
// (o dono) para criar, mudar e reenviar — um webhook é uma credencial de
// saída (docs/38 §9, decisão a ver). Nada aqui decide o que sai: o catálogo
// de eventos e o corpo vivem em `eventos.ts`.

function paraApi(erro: unknown): unknown {
  if (erro instanceof ErroWebhooks) {
    return new ErroApi(
      erro.codigo,
      ESTADO_DO_CODIGO[erro.codigo],
      erro.codigo.endsWith(".not_found")
        ? { pt: "Não encontrado", en: "Not found" }
        : { pt: "Pedido recusado pelos webhooks", en: "Rejected by webhooks" },
      erro.message,
    );
  }
  return erro;
}

async function emWebhooks<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (erro) {
    throw paraApi(erro);
  }
}

const IdSubscricao = idCom("whk", "whk_…");
const IdEntrega = idCom("whd", "whd_…");
const Tipo = umDe(LISTA_DE_TIPOS);
const Eventos = Type.Array(Tipo, { minItems: 1, maxItems: 30 });
const Url = Type.String({
  minLength: 12,
  maxLength: 2000,
  description:
    "https, porta 443, sem credenciais, nome público (nunca um endereço privado ou local; docs/38 §8)",
});
const Estado = umDe(["activa", "pausada", "desactivada"] as const);

const Subscricao = Type.Object({
  id: Type.String({ description: "whk_…" }),
  url: Type.String(),
  descricao: Type.Union([Type.String(), Type.Null()]),
  eventos: Type.Array(Type.String()),
  estado: Estado,
  criada_em: Type.String(),
  actualizada_em: Type.String(),
  versao: Type.Integer(),
});
const paraSubscricao = (s: SubscricaoLida) => ({
  id: `whk_${s.id}`,
  url: s.url,
  descricao: s.descricao,
  eventos: s.eventos,
  estado: s.estado,
  criada_em: s.criada_em.toISOString(),
  actualizada_em: s.actualizada_em.toISOString(),
  versao: s.versao,
});

const Entrega = Type.Object({
  id: Type.String({ description: "whd_…" }),
  subscricao: Type.String({ description: "whk_…" }),
  evento: Type.String({ description: "evt_…" }),
  estado: umDe(ESTADOS_ENTREGA_WEBHOOK),
  tentativas: Type.Integer(),
  reenvios: Type.Integer(),
  proxima_em: Type.Union([Type.String(), Type.Null()]),
  prazo_ate: Type.String(),
  ultimo_estado_http: Type.Union([Type.Integer(), Type.Null()]),
  ultimo_erro: Type.Union([Type.String(), Type.Null()]),
  criada_em: Type.String(),
  terminada_em: Type.Union([Type.String(), Type.Null()]),
});
const paraEntrega = (e: EntregaLida) => ({
  id: `whd_${e.id}`,
  subscricao: `whk_${e.subscricao_id}`,
  evento: `evt_${e.evento_id}`,
  estado: e.estado,
  tentativas: e.tentativas,
  reenvios: e.reenvios,
  proxima_em: e.estado === "pendente" ? iso(e.proxima_em) : null,
  prazo_ate: e.prazo_ate.toISOString(),
  ultimo_estado_http: e.ultimo_estado_http,
  ultimo_erro: e.ultimo_erro,
  criada_em: e.criada_em.toISOString(),
  terminada_em: iso(e.terminada_em),
});

export function rotasDosWebhooks(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  cfg: ConfigWebhooks | undefined,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const quem = (chaveId: string) => `chave:key_${chaveId}`;

  rotas.get(
    "/webhook-event-types",
    {
      config: { ambito: "merchant:read" },
      schema: {
        description:
          "Os tipos de evento que se podem subscrever e os campos de `dados` de cada um. Os identificadores levam o prefixo público. Nunca sai quem fez a mudança (docs/06, CH): pede-se à API.",
        response: {
          200: Type.Object({
            dados: Type.Array(
              Type.Object({
                tipo: Type.String(),
                agregado: Type.String(),
                campos: Type.Array(Type.String()),
              }),
            ),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    () => ({
      dados: LISTA_DE_TIPOS.map((tipo) => ({
        tipo,
        agregado: TIPOS_DE_EVENTO[tipo].agregado,
        campos: Object.keys(TIPOS_DE_EVENTO[tipo].campos),
      })),
    }),
  );

  rotas.get(
    "/webhook-subscriptions",
    {
      config: { ambito: "merchant:read" },
      schema: {
        description:
          "As subscrições do comerciante. O segredo nunca se devolve.",
        response: {
          200: Type.Object({ dados: Type.Array(Subscricao) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido) => ({
      dados: (await listarSubscricoes(base, chaveDo(pedido).comercianteId)).map(
        paraSubscricao,
      ),
    }),
  );

  rotas.post(
    "/webhook-subscriptions",
    {
      config: { ambito: "keys:write" },
      schema: {
        description:
          "Cria uma subscrição. O segredo de assinatura (`whsec_…`) só aparece nesta resposta; repetir com a mesma Idempotency-Key dá idempotency.secret_not_repeated. Só recebe eventos escritos depois de criada.",
        headers: CabecalhoIdempotencia,
        body: Type.Object(
          {
            url: Url,
            eventos: Eventos,
            descricao: Type.Optional(
              Type.String({ minLength: 1, maxLength: 200 }),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Intersect([
            Subscricao,
            Type.Object({ segredo: Type.String() }),
          ]),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        201,
        (trx, chave) =>
          emWebhooks(async () => {
            const { subscricao, segredo } = await criarSubscricao(
              trx,
              chave.comercianteId,
              pedido.body,
              quem(chave.chaveId),
              cfg,
            );
            return { ...paraSubscricao(subscricao), segredo };
          }),
        undefined,
        undefined,
        {
          // T5: o segredo vai ao cliente, nunca à base.
          guardar: (corpo) => {
            return Object.fromEntries(
              Object.entries(corpo as Record<string, unknown>).filter(
                ([campo]) => campo !== "segredo",
              ),
            );
          },
          repetir: (guardada) => {
            const id = (guardada.corpo as { id?: unknown }).id;
            throw new ErroApi(
              "idempotency.secret_not_repeated",
              409,
              {
                pt: "O segredo só aparece uma vez",
                en: "The secret is shown only once",
              },
              `a subscrição ${String(id)} foi criada por este pedido; desactive-a e crie outra se perdeu o segredo`,
            );
          },
        },
      ),
  );

  rotas.get(
    "/webhook-subscriptions/:id",
    {
      config: { ambito: "merchant:read" },
      schema: {
        params: Type.Object({ id: IdSubscricao }),
        response: { 200: Subscricao, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) =>
      emWebhooks(async () =>
        paraSubscricao(
          await lerSubscricao(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        ),
      ),
  );

  rotas.patch(
    "/webhook-subscriptions/:id",
    {
      config: { ambito: "keys:write" },
      schema: {
        description:
          "Muda o endereço, os eventos, a descrição ou o estado (activa, pausada, desactivada). Desactivar é definitivo e cancela as entregas por fazer; uma subscrição pausada não recebe os eventos que se escrevem enquanto está pausada.",
        headers: CabecalhoIdempotencia,
        params: Type.Object({ id: IdSubscricao }),
        body: Type.Object(
          {
            versao: Type.Integer({ minimum: 1 }),
            url: Type.Optional(Url),
            eventos: Type.Optional(Eventos),
            descricao: Type.Optional(
              Type.Union([
                Type.String({ minLength: 1, maxLength: 200 }),
                Type.Null(),
              ]),
            ),
            estado: Type.Optional(Estado),
          },
          { additionalProperties: false },
        ),
        response: { 200: Subscricao, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emWebhooks(async () => {
          const { versao, ...mudanca } = pedido.body;
          return paraSubscricao(
            await mudarSubscricao(
              trx,
              semPrefixo(pedido.params.id),
              versao,
              {
                ...(mudanca.url === undefined ? {} : { url: mudanca.url }),
                ...(mudanca.eventos === undefined
                  ? {}
                  : { eventos: mudanca.eventos }),
                ...(mudanca.descricao === undefined
                  ? {}
                  : { descricao: mudanca.descricao }),
                ...(mudanca.estado === undefined
                  ? {}
                  : { estado: mudanca.estado }),
              },
              quem(chave.chaveId),
            ),
          );
        }),
      ),
  );

  rotas.get(
    "/webhook-deliveries",
    {
      config: { ambito: "merchant:read" },
      schema: {
        description:
          "O registo das entregas, das mais recentes: o estado, as tentativas e o último código HTTP ou de erro. Nunca o corpo da resposta do receptor. Paginação por `depois` (o `id` da última).",
        querystring: Type.Object(
          {
            subscricao: Type.Optional(IdSubscricao),
            estado: Type.Optional(umDe(ESTADOS_ENTREGA_WEBHOOK)),
            depois: Type.Optional(IdEntrega),
            limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ dados: Type.Array(Entrega) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido) => ({
      dados: (
        await listarEntregas(base, chaveDo(pedido).comercianteId, {
          ...(pedido.query.subscricao === undefined
            ? {}
            : { subscricaoId: semPrefixo(pedido.query.subscricao) }),
          ...(pedido.query.estado === undefined
            ? {}
            : { estado: pedido.query.estado }),
          ...(pedido.query.depois === undefined
            ? {}
            : { depoisDe: semPrefixo(pedido.query.depois) }),
          limite: pedido.query.limite ?? 50,
        })
      ).map(paraEntrega),
    }),
  );

  rotas.post(
    "/webhook-deliveries/:id/resend",
    {
      config: { ambito: "keys:write" },
      schema: {
        description:
          "Reenvia uma entrega entregue, desistida ou cancelada: volta a pendente, com o recuo e o prazo de 72 h de novo. A subscrição tem de estar activa.",
        headers: CabecalhoIdempotencia,
        params: Type.Object({ id: IdEntrega }),
        response: { 200: Entrega, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx) =>
        emWebhooks(async () =>
          paraEntrega(await reenviarEntrega(trx, semPrefixo(pedido.params.id))),
        ),
      ),
  );
}
