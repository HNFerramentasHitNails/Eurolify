import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { chaveDo } from "./autenticacao.js";
import { AMBITOS, TIPOS_CHAVE } from "./chaves.js";
import { listarChaves } from "./repositorio.js";

// Rotas da identidade, parte A, só leitura (docs/19 §6). Criar e revogar
// chaves pela API entram com a Idempotency-Key (docs/18 §4), no pedido
// seguinte; até lá, a primeira chave cria-se pelo comando do operador.

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

const RespostaChaves = Type.Object({
  dados: Type.Array(
    Type.Object({
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
    }),
  ),
});

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

export function rotasDaIdentidade(
  rotas: FastifyInstance,
  base: Kysely<BaseDados>,
) {
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
      return {
        dados: lista.map((c) => ({
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
        })),
      };
    },
  );
}
