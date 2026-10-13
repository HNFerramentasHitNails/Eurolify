import type { FastifyInstance, FastifyReply } from "fastify";
import { CamposDoRasto, respostasDoRasto } from "../base/rasto-resposta.js";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import { POLITICAS_STOCK, type BaseDados } from "../base/esquema.js";
import { escrever, idCom, semPrefixo, umDe } from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import {
  ajustar,
  criarArmazem,
  criarExpedicao,
  darEntrada,
  definirPolitica,
  ErroStock,
  ESTADO_DO_CODIGO,
  lerInventario,
  lerParaExpedir,
  listarArmazens,
  listarLotes,
  listarMovimentos,
  listarParaExpedir,
  mudarArmazem,
  mudarExpedicao,
  transicoesDaEncomenda,
  traduzir,
} from "./repositorio.js";

// A API do stock e das expedições (docs/27 §7; issue #295; Diogo,
// 10/10/2026: «sim, aprovo; avança com o código da fatia 9»).

async function emStock<T>(resposta: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (erro) {
    const e = traduzir(erro);
    if (e instanceof ErroStock) {
      if (e.codigo === "inventory.retry")
        void resposta.header("Retry-After", "1");
      throw new ErroApi(
        e.codigo,
        ESTADO_DO_CODIGO[e.codigo],
        e.codigo.endsWith(".not_found")
          ? { pt: "Não encontrado", en: "Not found" }
          : { pt: "Pedido recusado pelo stock", en: "Rejected by inventory" },
        e.pormenor === undefined
          ? e.message
          : `${e.message} ${JSON.stringify(e.pormenor)}`,
      );
    }
    throw e;
  }
}

const Livre = Type.Record(Type.String(), Type.Unknown());
const IdArmazem = idCom("whs", "whs_…");
const IdLoja = idCom("sto", "sto_…");
const IdVariante = idCom("var", "var_…");
const IdEncomenda = idCom("ord", "ord_…");
const IdLinha = idCom("oli", "oli_…");
const IdExpedicao = idCom("shp", "shp_…");
const Versao = Type.Integer({ minimum: 1 });
const Morada = Type.Object(
  {
    linha1: Type.Optional(Type.String({ maxLength: 200 })),
    linha2: Type.Optional(Type.String({ maxLength: 200 })),
    codigo_postal: Type.Optional(Type.String({ maxLength: 20 })),
    localidade: Type.Optional(Type.String({ maxLength: 100 })),
    pais: Type.Optional(Type.String({ pattern: "^[A-Z]{2}$" })),
  },
  { additionalProperties: false },
);
const Lote = Type.Object(
  {
    numero: Type.String({ minLength: 1, maxLength: 60 }),
    validade: Type.Optional(Type.String({ format: "date" })),
  },
  { additionalProperties: false },
);
const Texto = (max: number) =>
  Type.Union([Type.String({ minLength: 1, maxLength: max }), Type.Null()]);
const iso = (d: Date | null) => (d === null ? null : d.toISOString());
const quemDe = (chave: { chaveId: string }) => `chave:key_${chave.chaveId}`;

/** Um armazém como a API o mostra, pela chave e pelo Hub (docs/22 §31). */
export const paraArmazem = (
  a: Awaited<ReturnType<typeof listarArmazens>>[number],
) => ({
  id: `whs_${a.id}`,
  loja: `sto_${a.loja_id}`,
  nome: a.nome,
  morada: a.morada,
  estado: a.estado,
  // O peso da embalagem por omissão, em gramas (docs/36 Q6; 0079).
  embalagem_g: a.embalagem_g,
  versao: a.versao,
});

export function rotasDoStock(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();

  // ------------------------------------------------------------ Armazéns

  rotas.get(
    "/warehouses",
    {
      config: { ambito: "inventory:read" },
      schema: {
        description: "Os armazéns (um activo por loja nesta fase).",
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emStock(resposta, async () => ({
        dados: (await listarArmazens(base, chaveDo(pedido).comercianteId)).map(
          paraArmazem,
        ),
      })),
  );

  rotas.post(
    "/warehouses",
    {
      config: { ambito: "inventory:write" },
      schema: {
        description: "Cria o armazém de uma loja (um activo por loja).",
        body: Type.Object(
          {
            loja: IdLoja,
            nome: Type.String({ minLength: 1, maxLength: 100 }),
            morada: Type.Optional(Morada),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ id: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emStock(resposta, async () => ({
          id: `whs_${await criarArmazem(trx, chave.comercianteId, {
            loja: semPrefixo(pedido.body.loja),
            nome: pedido.body.nome,
            morada: pedido.body.morada ?? {},
          })}`,
        })),
      ),
  );

  rotas.patch(
    "/warehouses/:id",
    {
      config: { ambito: "inventory:write" },
      schema: {
        description: "Muda o nome ou a morada, ou arquiva (sem stock).",
        params: Type.Object({ id: IdArmazem }),
        body: Type.Object(
          {
            versao: Versao,
            nome: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
            morada: Type.Optional(Morada),
            arquivar: Type.Optional(Type.Literal(true)),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emStock(resposta, async () => ({
          versao: await mudarArmazem(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.versao,
            {
              ...(pedido.body.nome === undefined
                ? {}
                : { nome: pedido.body.nome }),
              ...(pedido.body.morada === undefined
                ? {}
                : { morada: pedido.body.morada }),
              ...(pedido.body.arquivar === true ? { arquivar: true } : {}),
            },
          ),
        })),
      ),
  );

  // -------------------------------------------------------------- Stock

  rotas.get(
    "/inventory",
    {
      config: { ambito: "inventory:read" },
      schema: {
        description:
          "O saldo por variante e armazém: físico, reservado e disponível (físico − reservado), com o físico de cada lote.",
        querystring: Type.Object(
          {
            armazem: Type.Optional(IdArmazem),
            variante: Type.Optional(IdVariante),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emStock(resposta, async () => ({
        dados: (
          await lerInventario(base, chaveDo(pedido).comercianteId, {
            ...(pedido.query.armazem === undefined
              ? {}
              : { armazem: semPrefixo(pedido.query.armazem) }),
            ...(pedido.query.variante === undefined
              ? {}
              : { variante: semPrefixo(pedido.query.variante) }),
          })
        ).map((s) => ({
          armazem: `whs_${s.armazem_id}`,
          variante: `var_${s.variante_id}`,
          fisico: s.fisico,
          reservado: s.reservado,
          disponivel: s.disponivel,
          lotes: s.lotes.map((l) => ({
            id: `lot_${l.id}`,
            numero: l.numero,
            validade: l.validade,
            fisico: l.fisico,
          })),
        })),
      })),
  );

  rotas.post(
    "/inventory/receipts",
    {
      config: { ambito: "inventory:write" },
      schema: {
        description:
          "Uma entrada de stock (com o lote nas variantes que o exigem). O saldo muda pelo movimento, no mesmo passo.",
        body: Type.Object(
          {
            armazem: IdArmazem,
            origem: Type.Optional(
              umDe(["inventario", "importacao", "sistema_externo"] as const),
            ),
            linhas: Type.Array(
              Type.Object(
                {
                  variante: IdVariante,
                  quantidade: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
                  lote: Type.Optional(Lote),
                },
                { additionalProperties: false },
              ),
              { minItems: 1, maxItems: 200 },
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ movimentos: Type.Array(Type.String()) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emStock(resposta, async () => ({
          movimentos: (
            await darEntrada(
              trx,
              chave.comercianteId,
              {
                armazem: semPrefixo(pedido.body.armazem),
                origem: pedido.body.origem ?? "inventario",
                linhas: pedido.body.linhas.map((l) => ({
                  variante: semPrefixo(l.variante),
                  quantidade: l.quantidade,
                  ...(l.lote === undefined ? {} : { lote: l.lote }),
                })),
              },
              quemDe(chave),
            )
          ).map((id) => `stm_${id}`),
        })),
      ),
  );

  rotas.post(
    "/inventory/adjustments",
    {
      config: { ambito: "inventory:write" },
      schema: {
        description:
          "Um ajuste de inventário (+ ou −), sempre com motivo. Nunca deixa o físico negativo nem abaixo do reservado.",
        body: Type.Object(
          {
            armazem: IdArmazem,
            variante: IdVariante,
            delta: Type.Integer({
              minimum: -1_000_000,
              maximum: 1_000_000,
              not: { const: 0 },
            }),
            motivo: Type.String({ minLength: 1, maxLength: 500 }),
            origem: Type.Optional(
              umDe(["inventario", "sistema_externo"] as const),
            ),
            lote: Type.Optional(Lote),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ movimento: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emStock(resposta, async () => ({
          movimento: `stm_${await ajustar(
            trx,
            chave.comercianteId,
            {
              armazem: semPrefixo(pedido.body.armazem),
              variante: semPrefixo(pedido.body.variante),
              delta: pedido.body.delta,
              motivo: pedido.body.motivo,
              origem: pedido.body.origem ?? "inventario",
              ...(pedido.body.lote === undefined
                ? {}
                : { lote: pedido.body.lote }),
            },
            quemDe(chave),
          )}`,
        })),
      ),
  );

  rotas.get(
    "/inventory/movements",
    {
      config: { ambito: "inventory:read" },
      schema: {
        description:
          "O livro de movimentos (só se acrescenta), dos mais recentes.",
        querystring: Type.Object(
          {
            variante: Type.Optional(IdVariante),
            encomenda: Type.Optional(IdEncomenda),
            limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emStock(resposta, async () => ({
        dados: (
          await listarMovimentos(base, chaveDo(pedido).comercianteId, {
            limite: pedido.query.limite ?? 50,
            ...(pedido.query.variante === undefined
              ? {}
              : { variante: semPrefixo(pedido.query.variante) }),
            ...(pedido.query.encomenda === undefined
              ? {}
              : { encomenda: semPrefixo(pedido.query.encomenda) }),
          })
        ).map((m) => ({
          id: `stm_${m.id}`,
          tipo: m.tipo,
          armazem: `whs_${m.armazem_id}`,
          variante: `var_${m.variante_id}`,
          lote: m.lote_id === null ? null : `lot_${m.lote_id}`,
          quantidade: m.quantidade,
          origem: m.origem,
          encomenda: m.encomenda_id === null ? null : `ord_${m.encomenda_id}`,
          expedicao: m.expedicao_id === null ? null : `shp_${m.expedicao_id}`,
          motivo: m.motivo,
          fisico: { antes: m.fisico_antes, depois: m.fisico_depois },
          reservado: { antes: m.reservado_antes, depois: m.reservado_depois },
          quem: m.quem,
          em: m.em.toISOString(),
        })),
      })),
  );

  rotas.get(
    "/lots",
    {
      config: { ambito: "inventory:read" },
      schema: {
        description: "Os lotes de uma variante.",
        querystring: Type.Object(
          { variante: Type.Optional(IdVariante) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emStock(resposta, async () => ({
        dados: (
          await listarLotes(
            base,
            chaveDo(pedido).comercianteId,
            pedido.query.variante === undefined
              ? undefined
              : semPrefixo(pedido.query.variante),
          )
        ).map((l) => ({
          id: `lot_${l.id}`,
          variante: `var_${l.variante_id}`,
          numero: l.numero,
          validade: l.validade,
        })),
      })),
  );

  rotas.put(
    "/variants/:id/stock-policy",
    {
      config: { ambito: "inventory:policy" },
      schema: {
        description:
          "A política de stock da variante (controla, não controla, vende sem stock) e se exige lote.",
        params: Type.Object({ id: IdVariante }),
        body: Type.Object(
          { politica: umDe(POLITICAS_STOCK), exige_lote: Type.Boolean() },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, async (trx, chave) =>
        emStock(resposta, async () => {
          await definirPolitica(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
            quemDe(chave),
          );
          return null;
        }),
      ),
  );

  // ------------------------------------------- A vista do armazém (§6)

  const paraVista = (
    v: Awaited<ReturnType<typeof listarParaExpedir>>[number],
  ) => ({
    id: `ord_${v.id}`,
    estado: v.estado,
    criada_em: v.criada_em.toISOString(),
    metodo_entrega: v.metodo_entrega,
    entrega: v.entrega,
    destinatario: v.destinatario,
    linhas: v.linhas.map((l) => ({
      id: `oli_${l.id}`,
      posicao: l.posicao,
      variante: `var_${l.variante_id}`,
      sku: l.sku,
      nome: l.nome,
      quantidade: l.quantidade,
      expedida: l.expedida,
    })),
  });

  rotas.get(
    "/fulfilment/orders",
    {
      config: { ambito: "fulfilment:read" },
      schema: {
        description:
          "As encomendas por expedir, com o que o armazém precisa (linhas, morada, nome e telefone de quem recebe, método de entrega). Sem perfil de faturação, NIF, e-mail nem preços.",
        querystring: Type.Object(
          { limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emStock(resposta, async () => ({
        dados: (
          await listarParaExpedir(
            base,
            chaveDo(pedido).comercianteId,
            pedido.query.limite ?? 50,
          )
        ).map(paraVista),
      })),
  );

  rotas.get(
    "/fulfilment/orders/:id",
    {
      config: { ambito: "fulfilment:read" },
      schema: {
        description: "Uma encomenda na vista do armazém, com as expedições.",
        params: Type.Object({ id: IdEncomenda }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emStock(resposta, async () => {
        const v = await lerParaExpedir(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
        );
        return {
          ...paraVista(v),
          expedicoes: v.expedicoes.map((x) => ({
            id: `shp_${x.id}`,
            estado: x.estado,
            transportadora: x.transportadora,
            servico: x.servico,
            seguimento: x.seguimento,
            expedida_em: iso(x.expedida_em),
            entregue_em: iso(x.entregue_em),
            versao: x.versao,
          })),
        };
      }),
  );

  // ------------------------------------------------------------ Expedições

  rotas.post(
    "/orders/:id/shipments",
    {
      config: { ambito: "fulfilment:write" },
      schema: {
        description:
          "Cria uma expedição com as linhas e quantidades a enviar (um kit em unidades do kit). Não mexe no stock até ser expedida. A primeira põe a encomenda em preparação.",
        params: Type.Object({ id: IdEncomenda }),
        body: Type.Object(
          {
            linhas: Type.Array(
              Type.Object(
                {
                  linha: IdLinha,
                  quantidade: Type.Integer({ minimum: 1, maximum: 10_000 }),
                },
                { additionalProperties: false },
              ),
              { minItems: 1, maxItems: 200 },
            ),
            transportadora: Type.Optional(Texto(100)),
            servico: Type.Optional(Texto(100)),
            seguimento: Type.Optional(Texto(200)),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ id: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emStock(resposta, async () => ({
          id: `shp_${await criarExpedicao(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            {
              linhas: pedido.body.linhas.map((l) => ({
                linha: semPrefixo(l.linha),
                quantidade: l.quantidade,
              })),
              ...(pedido.body.transportadora === undefined
                ? {}
                : { transportadora: pedido.body.transportadora }),
              ...(pedido.body.servico === undefined
                ? {}
                : { servico: pedido.body.servico }),
              ...(pedido.body.seguimento === undefined
                ? {}
                : { seguimento: pedido.body.seguimento }),
            },
            quemDe(chave),
          )}`,
        })),
      ),
  );

  rotas.patch(
    "/shipments/:id",
    {
      config: { ambito: "fulfilment:write" },
      schema: {
        description:
          "Muda a expedição: `expedida` dá saída do stock (a reserva passa a saída, com o lote de cada componente; sem lotes dados, o que expira primeiro dentro da validade), `entregue`, `devolvida_ao_remetente` ou `perdida`; `cancelada` desfaz uma expedição criada que não chegou a sair (as linhas voltam a estar por expedir); e a transportadora, o serviço e o seguimento.",
        params: Type.Object({ id: IdExpedicao }),
        body: Type.Object(
          {
            versao: Versao,
            estado: Type.Optional(
              umDe([
                "expedida",
                "entregue",
                "devolvida_ao_remetente",
                "perdida",
                "cancelada",
              ] as const),
            ),
            transportadora: Type.Optional(Texto(100)),
            servico: Type.Optional(Texto(100)),
            seguimento: Type.Optional(Texto(200)),
            prova_entrega: Type.Optional(Texto(500)),
            lotes: Type.Optional(
              Type.Array(
                Type.Object(
                  {
                    variante: IdVariante,
                    lote: Type.String({ minLength: 1, maxLength: 60 }),
                    quantidade: Type.Integer({
                      minimum: 1,
                      maximum: 1_000_000,
                    }),
                  },
                  { additionalProperties: false },
                ),
                { maxItems: 200 },
              ),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emStock(resposta, async () => ({
          versao: await mudarExpedicao(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body.versao,
            {
              ...(pedido.body.estado === undefined
                ? {}
                : { estado: pedido.body.estado }),
              ...(pedido.body.transportadora === undefined
                ? {}
                : { transportadora: pedido.body.transportadora }),
              ...(pedido.body.servico === undefined
                ? {}
                : { servico: pedido.body.servico }),
              ...(pedido.body.seguimento === undefined
                ? {}
                : { seguimento: pedido.body.seguimento }),
              ...(pedido.body.prova_entrega === undefined
                ? {}
                : { prova_entrega: pedido.body.prova_entrega }),
              ...(pedido.body.lotes === undefined
                ? {}
                : {
                    lotes: pedido.body.lotes.map((l) => ({
                      variante: semPrefixo(l.variante),
                      lote: l.lote,
                      quantidade: l.quantidade,
                    })),
                  }),
            },
            quemDe(chave),
          ),
        })),
      ),
  );

  rotas.get(
    "/orders/:id/timeline",
    {
      config: { ambito: "orders:read" },
      schema: {
        description:
          "As transições da encomenda (de, para, quem, quando, o motivo), com de onde vieram, a IA e quem autorizou (docs/28 §1).",
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
      emStock(resposta, async () => ({
        dados: (
          await transicoesDaEncomenda(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          )
        ).map((t) => ({
          de: t.de,
          para: t.para,
          quem: t.quem,
          em: t.em.toISOString(),
          ...respostasDoRasto(t),
        })),
      })),
  );
}
