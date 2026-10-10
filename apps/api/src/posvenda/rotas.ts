import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import {
  ESTADOS_ARTIGO_DEVOLVIDO,
  ESTADOS_DEVOLUCAO,
  TIPOS_PROBLEMA,
  type BaseDados,
} from "../base/esquema.js";
import { escrever, idCom, iso, semPrefixo, umDe } from "../catalogo/rotas.js";
import { encomendaDaSessao, naSessao } from "../checkout/repositorio.js";
import { emCheckout, Token } from "../checkout/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import { ErroPosVenda, ESTADO_DO_CODIGO, traduzir } from "./erros.js";
import {
  cancelarDevolucao,
  cancelarEncomendaPaga,
  criarDevolucao,
  criarProblema,
  decidirDevolucao,
  decidirLivreResolucao,
  decidirProblema,
  inspeccionarDevolucao,
  lerDevolucao,
  lerLivreResolucao,
  lerPedidoLivreResolucao,
  lerProblema,
  lerReembolso,
  listarDevolucoes,
  listarPedidosLivreResolucao,
  listarReembolsos,
  pedirLivreResolucao,
  receberDevolucao,
  registarReembolsoManual,
} from "./repositorio.js";

// A API da pós-venda (docs/30 §7; issue #328; Diogo, 10/10/2026:
// «aprovado» e «avança»). O reembolso pelo prestador (`/execute`,
// `/reconcile`) fica para a parte 2: nesta, o reembolso é manual (Q2).

async function emPosVenda<T>(resposta: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (erro) {
    const e = traduzir(erro);
    if (e instanceof ErroPosVenda) {
      if (e.codigo === "returns.retry")
        void resposta.header("Retry-After", "1");
      throw new ErroApi(
        e.codigo,
        ESTADO_DO_CODIGO[e.codigo],
        e.codigo.endsWith(".not_found")
          ? { pt: "Não encontrado", en: "Not found" }
          : {
              pt: "Pedido recusado pela pós-venda",
              en: "Rejected by after-sales",
            },
        e.pormenor === undefined
          ? e.message
          : `${e.message} ${JSON.stringify(e.pormenor)}`,
      );
    }
    throw e;
  }
}

const Livre = Type.Record(Type.String(), Type.Unknown());
const IdEncomenda = idCom("ord", "ord_…");
const IdLinha = idCom("oli", "oli_…");
const IdPedido = idCom("wdr", "wdr_…");
const IdDevolucao = idCom("rma", "rma_…");
const IdProblema = idCom("prb", "prb_…");
const IdReembolso = idCom("rfd", "rfd_…");
const Versao = Type.Integer({ minimum: 1 });
const Motivo = Type.String({ minLength: 1, maxLength: 500 });
const Quantidade = Type.Integer({ minimum: 1, maximum: 100_000 });
const LinhasPedidas = Type.Array(
  Type.Object(
    { linha: IdLinha, quantidade: Quantidade },
    { additionalProperties: false },
  ),
  { minItems: 1, maxItems: 200 },
);
const quemDe = (chave: { chaveId: string }) => `chave:key_${chave.chaveId}`;
const linhas = (l: { linha: string; quantidade: number }[]) =>
  l.map((x) => ({ linha: semPrefixo(x.linha), quantidade: x.quantidade }));
const comPrefixo = (p: string, id: string | null) =>
  id === null ? null : `${p}_${id}`;

const paraLinhaDevolvivel = (l: {
  linha: string;
  posicao: number;
  sku: string;
  nome: string;
  quantidade: number;
  expedida: number;
  disponivel: number;
  entregue_em: string | null;
  prazo_ate: string | null;
  dentro_do_prazo: boolean;
}) => ({
  linha: `oli_${l.linha}`,
  posicao: l.posicao,
  sku: l.sku,
  nome: l.nome,
  quantidade: l.quantidade,
  expedida: l.expedida,
  disponivel: l.disponivel,
  entregue_em: l.entregue_em,
  prazo_ate: l.prazo_ate,
  dentro_do_prazo: l.dentro_do_prazo,
});

const paraReembolsoCriado = (r: {
  id: string;
  montante: number;
  nota_credito: string | null;
}) => ({
  reembolso: `rfd_${r.id}`,
  montante: r.montante,
  nota_credito: comPrefixo("inv", r.nota_credito),
});

const RespostaReembolso = Type.Object({
  reembolso: Type.String(),
  montante: Type.Integer(),
  nota_credito: Type.Union([Type.String(), Type.Null()]),
});

const Decisao = Type.Object(
  {
    versao: Versao,
    linhas: Type.Array(
      Type.Object(
        { linha: IdLinha, quantidade: Quantidade },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    incluir_portes: Type.Optional(Type.Boolean()),
    motivo: Motivo,
  },
  { additionalProperties: false },
);

export function rotasDaPosVenda(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const publico = { ambito: "publico" as const, loja: true };

  // ---------------------------------------- API da Loja: o botão (§7.1)

  rotas.get(
    "/store/orders/:token/withdrawal",
    {
      config: publico,
      schema: {
        description:
          "As linhas que ainda se podem devolver por livre resolução e o prazo de cada uma (o token é o da confirmação da encomenda). Sem dados pessoais.",
        params: Type.Object({ token: Token }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        emPosVenda(resposta, () =>
          naSessao(
            base,
            pedido.params.token,
            async (trx, s) => {
              const id = await encomendaDaSessao(trx, s.id);
              if (id === null) {
                throw new ErroPosVenda(
                  "returns.not_found",
                  "a encomenda ainda não foi feita",
                );
              }
              const r = await lerLivreResolucao(trx, s.comerciante_id, id);
              return {
                encomenda: `ord_${id}`,
                consumidor: r.consumidor,
                linhas: r.linhas.map(paraLinhaDevolvivel),
              };
            },
            { soAberta: false, alemDaConfirmacao: true },
          ),
        ),
      ),
  );

  rotas.post(
    "/store/orders/:token/withdrawal",
    {
      config: publico,
      schema: {
        description:
          "O pedido de livre resolução (linhas e quantidades). Fica sempre registado e devolve a confirmação de recepção com a data e a hora; dentro do prazo abre logo a devolução, fora dele a loja decide.",
        params: Type.Object({ token: Token }),
        body: Type.Object(
          { linhas: LinhasPedidas },
          { additionalProperties: false },
        ),
        response: { 201: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        emPosVenda(resposta, async () => {
          const r = await naSessao(
            base,
            pedido.params.token,
            async (trx, s) => {
              const id = await encomendaDaSessao(trx, s.id);
              if (id === null) {
                throw new ErroPosVenda(
                  "returns.not_found",
                  "a encomenda ainda não foi feita",
                );
              }
              return pedirLivreResolucao(
                trx,
                s.comerciante_id,
                id,
                { origem: "botao", linhas: linhas(pedido.body.linhas) },
                `checkout:chk_${s.id}`,
              );
            },
            { soAberta: false, alemDaConfirmacao: true },
          );
          void resposta.status(201);
          return {
            pedido: `wdr_${r.id}`,
            estado: r.estado,
            confirmacao: r.confirmacao,
          };
        }),
      ),
  );

  // ------------------------------------ Administração: livre resolução

  rotas.get(
    "/withdrawals",
    {
      config: { ambito: "returns:read" },
      schema: {
        description: "Os pedidos de livre resolução, dos mais recentes.",
        querystring: Type.Object(
          {
            estado: Type.Optional(
              umDe(["aceite", "fora_de_prazo", "recusado"] as const),
            ),
            encomenda: Type.Optional(IdEncomenda),
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
      emPosVenda(resposta, async () => ({
        dados: (
          await listarPedidosLivreResolucao(
            base,
            chaveDo(pedido).comercianteId,
            {
              ...(pedido.query.estado === undefined
                ? {}
                : { estado: pedido.query.estado }),
              ...(pedido.query.encomenda === undefined
                ? {}
                : { encomenda: semPrefixo(pedido.query.encomenda) }),
            },
          )
        ).map((p) => ({
          id: `wdr_${p.id}`,
          encomenda: `ord_${p.encomenda_id}`,
          origem: p.origem,
          estado: p.estado,
          dentro_do_prazo: p.dentro_do_prazo,
          recebido_em: p.recebido_em.toISOString(),
          versao: p.versao,
        })),
      })),
  );

  rotas.get(
    "/withdrawals/:id",
    {
      config: { ambito: "returns:read" },
      schema: {
        description:
          "Um pedido de livre resolução, com a confirmação enviada e a devolução que abriu.",
        params: Type.Object({ id: IdPedido }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emPosVenda(resposta, async () => {
        const p = await lerPedidoLivreResolucao(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
        );
        return {
          id: `wdr_${p.id}`,
          encomenda: `ord_${p.encomenda_id}`,
          origem: p.origem,
          contacto: p.contacto,
          recebido_em: p.recebido_em.toISOString(),
          prazo_ate: p.prazo_ate,
          dentro_do_prazo: p.dentro_do_prazo,
          estado: p.estado,
          confirmacao: p.confirmacao,
          decidido_por: p.decidido_por,
          motivo_decisao: p.motivo_decisao,
          linhas: p.linhas.map((l) => ({
            linha: `oli_${l.linha_encomenda_id}`,
            quantidade: l.quantidade,
          })),
          devolucao: comPrefixo("rma", p.devolucao_id),
          versao: p.versao,
        };
      }),
  );

  rotas.post(
    "/withdrawals",
    {
      config: { ambito: "returns:write" },
      schema: {
        description:
          "Regista um pedido de livre resolução que chegou ao apoio (por e-mail, telefone ou carta): fica com a mesma confirmação que o botão.",
        body: Type.Object(
          { encomenda: IdEncomenda, linhas: LinhasPedidas },
          { additionalProperties: false },
        ),
        response: { 201: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emPosVenda(resposta, async () => {
          const r = await pedirLivreResolucao(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.body.encomenda),
            { origem: "apoio", linhas: linhas(pedido.body.linhas) },
            quemDe(chave),
          );
          return {
            pedido: `wdr_${r.id}`,
            estado: r.estado,
            confirmacao: r.confirmacao,
            devolucao: comPrefixo("rma", r.devolucao),
          };
        }),
      ),
  );

  rotas.post(
    "/withdrawals/:id/decide",
    {
      config: { ambito: "returns:write" },
      schema: {
        description:
          "Um pedido fora do prazo: uma pessoa aceita (abre a devolução) ou recusa, sempre com o motivo.",
        params: Type.Object({ id: IdPedido }),
        body: Type.Object(
          {
            versao: Versao,
            decisao: umDe(["aceitar", "recusar"] as const),
            motivo: Motivo,
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            devolucao: Type.Union([Type.String(), Type.Null()]),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emPosVenda(resposta, async () => {
          const r = await decidirLivreResolucao(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
            quemDe(chave),
          );
          return { devolucao: comPrefixo("rma", r.devolucao) };
        }),
      ),
  );

  // -------------------------------------------- Administração: devoluções

  rotas.get(
    "/returns",
    {
      config: { ambito: "returns:read" },
      schema: {
        description: "As devoluções, das mais recentes.",
        querystring: Type.Object(
          {
            estado: Type.Optional(umDe(ESTADOS_DEVOLUCAO)),
            encomenda: Type.Optional(IdEncomenda),
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
      emPosVenda(resposta, async () => ({
        dados: (
          await listarDevolucoes(base, chaveDo(pedido).comercianteId, {
            ...(pedido.query.estado === undefined
              ? {}
              : { estado: pedido.query.estado }),
            ...(pedido.query.encomenda === undefined
              ? {}
              : { encomenda: semPrefixo(pedido.query.encomenda) }),
          })
        ).map((d) => ({
          id: `rma_${d.id}`,
          encomenda: `ord_${d.encomenda_id}`,
          origem: d.origem,
          estado: d.estado,
          criada_em: d.criada_em.toISOString(),
          versao: d.versao,
        })),
      })),
  );

  rotas.post(
    "/returns",
    {
      config: { ambito: "returns:write" },
      schema: {
        description:
          "Abre uma devolução que não é livre resolução (combinada pelo apoio ou por política comercial da loja).",
        body: Type.Object(
          {
            encomenda: IdEncomenda,
            origem: umDe(["apoio", "comercial"] as const),
            motivo: Motivo,
            linhas: LinhasPedidas,
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
        emPosVenda(resposta, async () => ({
          id: `rma_${await criarDevolucao(
            trx,
            chave.comercianteId,
            {
              encomenda: semPrefixo(pedido.body.encomenda),
              origem: pedido.body.origem,
              motivo: pedido.body.motivo,
              linhas: linhas(pedido.body.linhas),
            },
            quemDe(chave),
          )}`,
        })),
      ),
  );

  rotas.get(
    "/returns/:id",
    {
      config: { ambito: "returns:read" },
      schema: {
        description:
          "Uma devolução: o pedido, o recebido, o aceite e o estado de cada linha.",
        params: Type.Object({ id: IdDevolucao }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emPosVenda(resposta, async () => {
        const d = await lerDevolucao(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
        );
        return {
          id: `rma_${d.id}`,
          encomenda: `ord_${d.encomenda_id}`,
          armazem: `whs_${d.armazem_id}`,
          origem: d.origem,
          pedido: comPrefixo("wdr", d.pedido_livre_resolucao_id),
          motivo: d.motivo,
          transportadora: d.transportadora,
          seguimento: d.seguimento,
          estado: d.estado,
          criada_por: d.criada_por,
          criada_em: iso(d.criada_em),
          reembolsar_ate: d.reembolsar_ate,
          dias_para_reembolsar: d.dias_para_reembolsar,
          versao: d.versao,
          linhas: d.linhas.map((l) => ({
            linha: `oli_${l.linha_encomenda_id}`,
            pedida: l.pedida,
            recebida: l.recebida,
            aceite: l.aceite,
            estado_artigo: l.estado_artigo,
          })),
        };
      }),
  );

  rotas.post(
    "/returns/:id/receive",
    {
      config: { ambito: "returns:write" },
      schema: {
        description:
          "A recepção no armazém: quanto chegou de cada linha (a que não vier na lista chegou 0).",
        params: Type.Object({ id: IdDevolucao }),
        body: Type.Object(
          {
            versao: Versao,
            linhas: Type.Array(
              Type.Object(
                {
                  linha: IdLinha,
                  recebida: Type.Integer({ minimum: 0, maximum: 100_000 }),
                },
                { additionalProperties: false },
              ),
              { maxItems: 200 },
            ),
            transportadora: Type.Optional(
              Type.Union([
                Type.String({ minLength: 1, maxLength: 100 }),
                Type.Null(),
              ]),
            ),
            seguimento: Type.Optional(
              Type.Union([
                Type.String({ minLength: 1, maxLength: 100 }),
                Type.Null(),
              ]),
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
        emPosVenda(resposta, async () => ({
          versao: await receberDevolucao(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            {
              versao: pedido.body.versao,
              linhas: pedido.body.linhas.map((l) => ({
                linha: semPrefixo(l.linha),
                recebida: l.recebida,
              })),
              ...(pedido.body.transportadora === undefined
                ? {}
                : { transportadora: pedido.body.transportadora }),
              ...(pedido.body.seguimento === undefined
                ? {}
                : { seguimento: pedido.body.seguimento }),
            },
            quemDe(chave),
          ),
        })),
      ),
  );

  rotas.post(
    "/returns/:id/inspect",
    {
      config: { ambito: "returns:write" },
      schema: {
        description:
          "A inspecção: o estado de cada linha e quanto se aceita. Só o revendável aceite volta a stock (o movimento «devolucao», com o lote da saída).",
        params: Type.Object({ id: IdDevolucao }),
        body: Type.Object(
          {
            versao: Versao,
            linhas: Type.Array(
              Type.Object(
                {
                  linha: IdLinha,
                  estado_artigo: umDe(ESTADOS_ARTIGO_DEVOLVIDO),
                  aceite: Type.Integer({ minimum: 0, maximum: 100_000 }),
                },
                { additionalProperties: false },
              ),
              { minItems: 1, maxItems: 200 },
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
        emPosVenda(resposta, async () => ({
          versao: await inspeccionarDevolucao(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            {
              versao: pedido.body.versao,
              linhas: pedido.body.linhas.map((l) => ({
                linha: semPrefixo(l.linha),
                estado_artigo: l.estado_artigo,
                aceite: l.aceite,
              })),
            },
            quemDe(chave),
          ),
        })),
      ),
  );

  rotas.post(
    "/returns/:id/cancel",
    {
      config: { ambito: "returns:write" },
      schema: {
        description:
          "Cancela uma devolução que ainda não foi inspeccionada (o cliente desistiu ou nada chegou).",
        params: Type.Object({ id: IdDevolucao }),
        body: Type.Object(
          { versao: Versao, motivo: Motivo },
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
        emPosVenda(resposta, async () => ({
          versao: await cancelarDevolucao(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
            quemDe(chave),
          ),
        })),
      ),
  );

  rotas.post(
    "/returns/:id/decide",
    {
      config: { ambito: "refunds:write" },
      schema: {
        description:
          "Depois da inspecção, uma pessoa decide o reembolso (linhas e quantidades, os portes ou não): abre o reembolso e pede a nota de crédito se a fatura é do Eurolify.",
        params: Type.Object({ id: IdDevolucao }),
        body: Decisao,
        response: { 201: RespostaReembolso, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emPosVenda(resposta, async () =>
          paraReembolsoCriado(
            await decidirDevolucao(
              trx,
              chave.comercianteId,
              semPrefixo(pedido.params.id),
              {
                versao: pedido.body.versao,
                linhas: linhas(pedido.body.linhas),
                incluir_portes: pedido.body.incluir_portes ?? false,
                motivo: pedido.body.motivo,
              },
              quemDe(chave),
            ),
          ),
        ),
      ),
  );

  // --------------------------------------------- Administração: problemas

  rotas.post(
    "/problems",
    {
      config: { ambito: "returns:write" },
      schema: {
        description:
          "Regista um problema sem mercadoria de volta (chegou danificado, faltou, atrasou).",
        body: Type.Object(
          {
            encomenda: IdEncomenda,
            tipo: umDe(TIPOS_PROBLEMA),
            descricao: Type.String({ minLength: 1, maxLength: 2000 }),
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
        emPosVenda(resposta, async () => ({
          id: `prb_${await criarProblema(
            trx,
            chave.comercianteId,
            {
              encomenda: semPrefixo(pedido.body.encomenda),
              tipo: pedido.body.tipo,
              descricao: pedido.body.descricao,
            },
            quemDe(chave),
          )}`,
        })),
      ),
  );

  rotas.get(
    "/problems/:id",
    {
      config: { ambito: "returns:read" },
      schema: {
        description: "Um problema.",
        params: Type.Object({ id: IdProblema }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emPosVenda(resposta, async () => {
        const p = await lerProblema(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
        );
        return {
          id: `prb_${p.id}`,
          encomenda: `ord_${p.encomenda_id}`,
          tipo: p.tipo,
          descricao: p.descricao,
          estado: p.estado,
          criado_por: p.criado_por,
          criado_em: p.criado_em.toISOString(),
          versao: p.versao,
        };
      }),
  );

  rotas.post(
    "/problems/:id/decide",
    {
      config: { ambito: "refunds:write" },
      schema: {
        description:
          "Uma pessoa decide o reembolso de um problema (linhas, quantidades, os portes ou não): abre o reembolso e pede a nota de crédito.",
        params: Type.Object({ id: IdProblema }),
        body: Decisao,
        response: { 201: RespostaReembolso, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emPosVenda(resposta, async () =>
          paraReembolsoCriado(
            await decidirProblema(
              trx,
              chave.comercianteId,
              semPrefixo(pedido.params.id),
              {
                versao: pedido.body.versao,
                linhas: linhas(pedido.body.linhas),
                incluir_portes: pedido.body.incluir_portes ?? false,
                motivo: pedido.body.motivo,
              },
              quemDe(chave),
            ),
          ),
        ),
      ),
  );

  // -------------------------------------------- Administração: reembolsos

  rotas.get(
    "/refunds",
    {
      config: { ambito: "refunds:read" },
      schema: {
        description: "Os reembolsos, dos mais recentes.",
        querystring: Type.Object(
          { encomenda: Type.Optional(IdEncomenda) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emPosVenda(resposta, async () => ({
        dados: (
          await listarReembolsos(base, chaveDo(pedido).comercianteId, {
            ...(pedido.query.encomenda === undefined
              ? {}
              : { encomenda: semPrefixo(pedido.query.encomenda) }),
          })
        ).map((r) => ({
          id: `rfd_${r.id}`,
          encomenda: `ord_${r.encomenda_id}`,
          origem: r.origem,
          montante: Number(r.montante),
          moeda: r.moeda,
          via: r.via,
          estado: r.estado,
          criado_em: r.criado_em.toISOString(),
          versao: r.versao,
        })),
      })),
  );

  rotas.get(
    "/refunds/:id",
    {
      config: { ambito: "refunds:read" },
      schema: {
        description:
          "Um reembolso: as linhas, a prova da transferência e a nota de crédito ligada.",
        params: Type.Object({ id: IdReembolso }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emPosVenda(resposta, async () => {
        const r = await lerReembolso(
          base,
          chaveDo(pedido).comercianteId,
          semPrefixo(pedido.params.id),
        );
        return {
          id: `rfd_${r.id}`,
          encomenda: `ord_${r.encomenda_id}`,
          pagamento: `pay_${r.pagamento_id}`,
          origem: r.origem,
          devolucao: comPrefixo("rma", r.devolucao_id),
          problema: comPrefixo("prb", r.problema_id),
          montante: Number(r.montante),
          moeda: r.moeda,
          via: r.via,
          estado: r.estado,
          prova: r.prova,
          executado_em: iso(r.executado_em),
          decidido_por: r.decidido_por,
          criado_em: r.criado_em.toISOString(),
          versao: r.versao,
          linhas: r.linhas.map((l) => ({
            posicao: l.posicao,
            linha: comPrefixo("oli", l.linha_encomenda_id),
            portes: l.linha_encomenda_id === null,
            quantidade: l.quantidade,
            montante: Number(l.montante),
          })),
          nota_credito:
            r.nota_credito === null
              ? null
              : {
                  id: `inv_${r.nota_credito.id}`,
                  estado: r.nota_credito.estado,
                },
        };
      }),
  );

  rotas.post(
    "/refunds/:id/manual",
    {
      config: { ambito: "refunds:write" },
      schema: {
        description:
          "Regista o reembolso feito à mão (transferência): a data e a referência do banco. O IBAN não se guarda. O pagamento passa a reembolsado e a devolução ou o problema fecham.",
        params: Type.Object({ id: IdReembolso }),
        body: Type.Object(
          {
            versao: Versao,
            montante: Type.Integer({ minimum: 1 }),
            data: Type.String({ format: "date" }),
            referencia: Type.String({ minLength: 1, maxLength: 100 }),
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
        emPosVenda(resposta, async () => ({
          versao: await registarReembolsoManual(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            pedido.body,
            quemDe(chave),
          ),
        })),
      ),
  );

  rotas.post(
    "/orders/:id/cancel",
    {
      config: { ambito: "refunds:write" },
      schema: {
        description:
          "Cancela uma encomenda paga que ainda não foi expedida: liberta as reservas, abre o reembolso de tudo (com os portes) e pede a nota de crédito se a fatura é do Eurolify.",
        params: Type.Object({ id: IdEncomenda }),
        body: Type.Object({ motivo: Motivo }, { additionalProperties: false }),
        response: { 201: RespostaReembolso, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emPosVenda(resposta, async () =>
          paraReembolsoCriado(
            await cancelarEncomendaPaga(
              trx,
              chave.comercianteId,
              semPrefixo(pedido.params.id),
              pedido.body,
              quemDe(chave),
            ),
          ),
        ),
      ),
  );
}
