import type { FastifyInstance, FastifyRequest } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { erroBase, RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { comIdempotencia } from "../base/idempotencia.js";
import { chaveDo } from "./autenticacao.js";
import { AMBITOS, TIPOS_CHAVE, type Ambito } from "./chaves.js";
import {
  criarChavePelaApi,
  listarChaves,
  revogarChavePelaApi,
  type ChaveListada,
} from "./repositorio.js";

// Rotas da identidade (docs/19 §6 e §6.1). A primeira chave de um comerciante
// cria-se pelo comando do operador; as seguintes, por estas rotas, com uma
// chave que tenha `keys:write`. As escritas pedem a Idempotency-Key
// (docs/18 §4).

/** Identificadores opacos com prefixo (headless-commerce, regra 2; docs/19). */
export const comPrefixo = (prefixo: string, id: string | null) =>
  id === null ? null : `${prefixo}_${id}`;

const Ambitos = Type.Array(Type.Union(AMBITOS.map((a) => Type.Literal(a))));
const TipoChave = Type.Union(TIPOS_CHAVE.map((t) => Type.Literal(t)));

const RespostaMe = Type.Object({
  comerciante: Type.String({ description: "mer_…" }),
  loja: Type.Union([Type.String({ description: "sto_…" }), Type.Null()]),
  chave: Type.Object({
    id: Type.String({ description: "key_…" }),
    tipo: TipoChave,
    prefixo: Type.String(),
    ambitos: Ambitos,
  }),
});

const Instante = Type.String({ format: "date-time" });
const InstanteOuNulo = Type.Union([Instante, Type.Null()]);

const CamposChave = {
  id: Type.String({ description: "key_…" }),
  tipo: TipoChave,
  loja: Type.Union([Type.String(), Type.Null()]),
  nome: Type.String(),
  ambitos: Ambitos,
  prefixo: Type.String(),
  criada_por: Type.String(),
  criada_em: Instante,
  expira_em: InstanteOuNulo,
  revogada_em: InstanteOuNulo,
  revogada_por: Type.Union([Type.String(), Type.Null()]),
  ultimo_uso_em: InstanteOuNulo,
};
const Chave = Type.Object(CamposChave);

const RespostaChaves = Type.Object({ dados: Type.Array(Chave) });

const RespostaChaveCriada = Type.Object({
  ...CamposChave,
  segredo: Type.String({
    description:
      "O segredo da chave (eul_sk_… ou eul_pk_…). Só aparece nesta resposta: guarde-o já.",
  }),
});

const CabecalhoIdempotencia = Type.Object({
  "idempotency-key": Type.Optional(
    Type.String({
      description:
        "Obrigatório (sem ele: 400 idempotency.key_required). 1 a 255 caracteres visíveis em ASCII. Repetir o pedido com a mesma chave não escreve outra vez (docs/18 §4).",
    }),
  ),
});

const PedidoCriarChave = Type.Object(
  {
    tipo: TipoChave,
    nome: Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
    ambitos: Type.Optional(
      Type.Array(Type.Union(AMBITOS.map((a) => Type.Literal(a))), {
        minItems: 1,
        maxItems: 20,
        description: "Só na chave de servidor; a pública tem `storefront`.",
      }),
    ),
    loja: Type.Optional(
      Type.String({
        pattern:
          "^sto_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        description: "sto_…; só na chave pública, e obrigatória nela",
      }),
    ),
    expira_em: Type.Optional(Type.String({ format: "date-time" })),
  },
  { additionalProperties: false },
);

const ParametroChave = Type.Object({
  id: Type.String({
    pattern:
      "^key_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    description: "key_…",
  }),
});

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

function paraResposta(c: ChaveListada) {
  return {
    id: `key_${c.id}`,
    tipo: c.tipo,
    loja: comPrefixo("sto", c.loja_id),
    nome: c.nome,
    ambitos: c.ambitos,
    prefixo: c.prefixo,
    criada_por: c.criada_por,
    criada_em: c.criada_em.toISOString(),
    expira_em: iso(c.expira_em),
    revogada_em: iso(c.revogada_em),
    revogada_por: c.revogada_por,
    ultimo_uso_em: iso(c.ultimo_uso_em),
  };
}

/** O caminho sem a consulta, para a idempotência. */
const caminhoDe = (url: string) => url.split("?")[0] ?? url;

/**
 * O cabeçalho Idempotency-Key. Repetido no pedido, o Node junta-o com «, »,
 * e o formato (sem espaços) recusa-o.
 */
function chaveDeIdempotencia(pedido: FastifyRequest): string | undefined {
  const valor = pedido.headers["idempotency-key"];
  return Array.isArray(valor) ? valor.join(", ") : valor;
}

export function rotasDaIdentidade(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  rotas.get(
    "/me",
    {
      config: { ambito: "qualquer" },
      schema: {
        description: "Quem está a chamar: o comerciante, a loja e a chave.",
        response: { 200: RespostaMe, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido) => {
      const chave = chaveDo(pedido);
      return {
        comerciante: `mer_${chave.comercianteId}`,
        loja: comPrefixo("sto", chave.lojaId),
        chave: {
          id: `key_${chave.chaveId}`,
          tipo: chave.tipo,
          prefixo: chave.prefixo,
          ambitos: chave.ambitos,
        },
      };
    },
  );

  rotas.get(
    "/keys",
    {
      config: { ambito: "keys:write" },
      schema: {
        description:
          "As chaves do comerciante, sem o segredo nem o resumo (docs/19 §6).",
        response: { 200: RespostaChaves, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido) => {
      const chave = chaveDo(pedido);
      const lista = await listarChaves(base, chave.comercianteId);
      return { dados: lista.map(paraResposta) };
    },
  );

  rotas.post(
    "/keys",
    {
      config: { ambito: "keys:write" },
      schema: {
        description:
          "Cria uma chave. O segredo só aparece nesta resposta. Uma chave não cria outra com âmbitos que não tem, e uma chave com prazo só cria chaves com prazo até ao seu (docs/19 §6.1). Repetir com a mesma Idempotency-Key não cria outra: dá idempotency.secret_not_repeated.",
        headers: CabecalhoIdempotencia,
        body: PedidoCriarChave,
        response: { 201: RespostaChaveCriada, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const corpo = pedido.body;
      const publica = corpo.tipo === "publica";
      if (publica && corpo.ambitos !== undefined) {
        throw erroBase(
          "request.invalid",
          "a chave pública não leva âmbitos: tem `storefront`",
        );
      }
      if (!publica && corpo.ambitos === undefined) {
        throw erroBase(
          "request.invalid",
          "a chave de servidor precisa de `ambitos`",
        );
      }
      if (publica !== (corpo.loja !== undefined)) {
        throw erroBase(
          "request.invalid",
          "`loja` é obrigatória na chave pública e proibida na de servidor",
        );
      }
      const expiraEm =
        corpo.expira_em === undefined ? null : new Date(corpo.expira_em);
      // O formato aceita um segundo intercalar (23:59:60), que o Date não lê
      // (revisão do #118, P3-4).
      if (expiraEm !== null && Number.isNaN(expiraEm.getTime())) {
        throw erroBase("request.invalid", "`expira_em` não é uma data válida");
      }
      const ambitos: Ambito[] = publica
        ? ["storefront"]
        : (corpo.ambitos ?? []);
      const resultado = await comIdempotencia(
        base,
        chave.comercianteId,
        {
          chave: chaveDeIdempotencia(pedido),
          metodo: "POST",
          caminho: caminhoDe(pedido.url),
          corpo,
        },
        async (trx) => {
          const { chave: nova, segredo } = await criarChavePelaApi(
            trx,
            chave.segredo,
            {
              tipo: corpo.tipo,
              lojaId: corpo.loja?.slice("sto_".length) ?? null,
              nome: corpo.nome,
              ambitos,
              expiraEm,
            },
          );
          const guardada = paraResposta(nova);
          // T5: o segredo vai ao cliente, nunca à base.
          return {
            status: 201,
            corpo: { ...guardada, segredo },
            guardar: guardada,
          };
        },
        {
          repetir: (guardada) => {
            const id = (guardada.corpo as { id?: unknown }).id;
            throw erroBase(
              "idempotency.secret_not_repeated",
              `a chave ${String(id)} foi criada por este pedido; revogue-a e crie outra se perdeu o segredo`,
            );
          },
          aoFalharLimpeza: (erro) => {
            pedido.log.error(
              { err: erro },
              "idempotência: linha em curso por apagar",
            );
          },
        },
      );
      return resposta.code(resultado.status).send(resultado.corpo);
    },
  );

  rotas.post(
    "/keys/:id/revoke",
    {
      config: { ambito: "keys:write" },
      schema: {
        description:
          "Revoga uma chave do comerciante, de imediato e sem volta. Uma chave não se revoga a si própria se for a última que gere chaves (docs/19 §6.1).",
        headers: CabecalhoIdempotencia,
        params: ParametroChave,
        response: { 200: Chave, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const chave = chaveDo(pedido);
      const id = pedido.params.id.slice("key_".length);
      const resultado = await comIdempotencia(
        base,
        chave.comercianteId,
        {
          chave: chaveDeIdempotencia(pedido),
          metodo: "POST",
          caminho: caminhoDe(pedido.url),
          corpo: null,
        },
        async (trx) => {
          const revogada = paraResposta(
            await revogarChavePelaApi(trx, chave.segredo, id),
          );
          return { status: 200, corpo: revogada, guardar: revogada };
        },
        {
          aoFalharLimpeza: (erro) => {
            pedido.log.error(
              { err: erro },
              "idempotência: linha em curso por apagar",
            );
          },
        },
      );
      return resposta.code(resultado.status).send(resultado.corpo);
    },
  );
}
