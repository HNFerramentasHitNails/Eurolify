import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely, Transaction } from "kysely";
import { Type } from "typebox";
import { createHash } from "node:crypto";
import { sql } from "kysely";
import { erroBase, ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import { comIdempotencia } from "../base/idempotencia.js";
import { TIPOS_TEXTO_LEGAL, type BaseDados } from "../base/esquema.js";
import { escrever, idCom, semPrefixo, umDe } from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import type { ConfigEnvios } from "../envios/adaptador.js";
import { emEnvios } from "../envios/rotas.js";
import {
  CabecalhoIdempotencia,
  caminhoDe,
  chaveDeIdempotencia,
} from "../identidade/rotas.js";
import { ErroCheckout, ESTADO_DO_CODIGO } from "./erros.js";
import {
  concluir,
  criarCarrinho,
  criarMetodoEntrega,
  criarTextoLegal,
  criarVersaoTextoLegal,
  encomendaDaSessao,
  iniciarCheckout,
  lerEncomenda,
  lerVersaoTextoLegal,
  listarCheckouts,
  listarEncomendas,
  listarMetodosEntrega,
  listarTextosLegais,
  calcularResumo,
  impressao,
  mudarMetodoEntrega,
  naSessao,
  porContacto,
  porEntrega,
  porFaturacao,
  porLinha,
  porMetodoEntrega,
  porMetodoPagamento,
  publicarVersaoTextoLegal,
  tirarLinha,
  traduzir,
  verCarrinho,
  versaoDoResumo,
  type Resumo,
  type SessaoLida,
  metodosDaSessao,
} from "./repositorio.js";

// A API do checkout (docs/25 §8; issue #273; Diogo, 09/10/2026: «sim,
// aprovo; avança com o código da fatia 7»): o carrinho pela API da Loja (a
// chave pública da loja e o segredo do carrinho), o checkout alojado pelo
// token da sessão (sem chave: é o cliente da loja), e a Administração dos
// textos legais, dos métodos de entrega e das encomendas.

function paraApi(erro: unknown, resposta: FastifyReply): unknown {
  const e = traduzir(erro);
  if (!(e instanceof ErroCheckout)) return e;
  if (e.codigo === "checkout.retry") void resposta.header("Retry-After", "1");
  const mensagens =
    e.codigo.endsWith(".not_found") || e.codigo === "cart.secret_invalid"
      ? { pt: "Não encontrado", en: "Not found" }
      : { pt: "Pedido recusado pelo checkout", en: "Rejected by checkout" };
  const daBase =
    typeof (e.cause as { code?: unknown } | undefined)?.code === "string" &&
    !e.message.startsWith(`${e.codigo}:`);
  const detalhe = daBase ? "um valor do pedido não é aceite" : e.message;
  return new ErroApi(
    e.codigo,
    ESTADO_DO_CODIGO[e.codigo],
    mensagens,
    e.pormenor === undefined
      ? detalhe
      : `${detalhe} ${JSON.stringify(e.pormenor)}`,
  );
}

export async function emCheckout<T>(
  resposta: FastifyReply,
  fn: () => Promise<T>,
) {
  try {
    return await fn();
  } catch (erro) {
    throw paraApi(erro, resposta);
  }
}

/** O resumo do segredo do carrinho, para entrar no corpo idempotente (P1-1). */
const resumoDoSegredo = (segredo: string | undefined) =>
  segredo === undefined
    ? null
    : createHash("sha256").update(segredo).digest("hex");

/**
 * Uma escrita da API da Loja que devolve um segredo (o do carrinho, o token
 * da sessão): o segredo vai ao cliente e nunca fica na resposta guardada da
 * idempotência; repetir o pedido não o devolve outra vez (como a criação de
 * chaves, docs/19 T5; revisão do #276, P1-1).
 */
async function escreverComSegredo(
  base: Kysely<BaseDados>,
  pedido: Parameters<typeof chaveDo>[0],
  resposta: FastifyReply,
  corpoIdempotente: unknown,
  fn: (
    trx: Transaction<BaseDados>,
    chave: ReturnType<typeof chaveDo>,
  ) => Promise<{ corpo: unknown; guardar: unknown }>,
) {
  const chave = chaveDo(pedido);
  const resultado = await emCheckout(resposta, () =>
    comIdempotencia(
      base,
      chave.comercianteId,
      {
        chave: chaveDeIdempotencia(pedido),
        metodo: "POST",
        caminho: caminhoDe(pedido.url),
        corpo: corpoIdempotente,
      },
      async (trx) => {
        await sql`select set_config('eurolify.quem', ${`chave:key_${chave.chaveId}`}, true)`.execute(
          trx,
        );
        const r = await fn(trx, chave);
        return { status: 201, corpo: r.corpo, guardar: r.guardar };
      },
      {
        repetir: () => {
          throw erroBase(
            "idempotency.secret_not_repeated",
            "o segredo só se mostra uma vez: repita com outra Idempotency-Key",
          );
        },
      },
    ),
  );
  return resposta.code(resultado.status).send(resultado.corpo);
}

const Pais = Type.String({ pattern: "^[A-Z]{2}$" });
const Lingua = Type.String({ pattern: "^[a-z]{2}$" });
const Livre = Type.Record(Type.String(), Type.Unknown());
const IdCarrinho = idCom("crt", "crt_…");
const IdLinha = idCom("crl", "crl_…");
const IdVariante = idCom("var", "var_…");
const IdCanal = idCom("chn", "chn_…");
const IdMercado = idCom("mkt", "mkt_…");
const IdLoja = idCom("sto", "sto_…");
const IdTexto = idCom("lgt", "lgt_…");
const IdVersao = idCom("lgv", "lgv_…");
const IdMetodo = idCom("shm", "shm_…");
const IdEncomenda = idCom("ord", "ord_…");
const IdConta = idCom("cac", "cac_…");
export const Token = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" });
const CabecalhoCarrinho = Type.Object({
  "x-cart-secret": Type.Optional(Type.String({ maxLength: 100 })),
});
const CabecalhosEscritaCarrinho = Type.Object({
  "idempotency-key": Type.Optional(
    Type.String({ description: "obrigatória nas escritas" }),
  ),
  "x-cart-secret": Type.Optional(Type.String({ maxLength: 100 })),
});
const NomesPorLingua = Type.Record(
  Lingua,
  Type.String({ minLength: 1, maxLength: 200 }),
  {
    minProperties: 1,
    maxProperties: 30,
  },
);

const lojaDa = (pedido: Parameters<typeof chaveDo>[0]) => {
  const loja = chaveDo(pedido).lojaId;
  // A chave pública é sempre de uma loja (docs/19); sem loja, não há carrinho.
  if (loja === null)
    throw new ErroCheckout("checkout.not_found", "a chave não é de uma loja");
  return loja;
};

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

const paraResumo = (r: Resumo) => ({
  // O ecrã devolve-a no botão final: é o que o cliente viu (R3).
  impressao: impressao(r),
  moeda: r.moeda,
  preco_inclui_iva: r.preco_inclui_iva,
  linhas: r.linhas.map((l) => ({
    variante: `var_${l.variante_id}`,
    sku: l.sku,
    nome: l.nome,
    quantidade: l.quantidade,
    preco_unitario: l.preco_unitario,
    preco_lista: l.preco.montante_lista,
    reducao:
      l.preco.reducao === null
        ? null
        : {
            preco_referencia: l.preco.reducao.preco_referencia,
            fim: iso(l.preco.reducao.fim),
          },
    preco_por_unidade: l.preco.preco_por_unidade,
    iva:
      l.decisao.resultado === "bloqueada"
        ? { resultado: "bloqueada", motivo: l.decisao.motivo }
        : {
            resultado: l.decisao.resultado,
            taxa: l.decisao.taxa,
            codigo_motivo: l.decisao.codigo_motivo,
          },
    base: l.base,
    valor_iva: l.iva,
    total: l.total,
    // H3 (docs/30 §15): a página diz que, aberto o selo, se perde a livre
    // resolução; o texto é legal por país (**C**, J5).
    selado_por_higiene: l.selado_por_higiene,
  })),
  portes:
    r.portes === null
      ? null
      : {
          metodo: `shm_${r.portes.metodo_id}`,
          nome: r.portes.nome,
          // A data-limite de entrega se encomendar agora (docs/36 L1).
          data_limite: r.portes.data_limite,
          tarifa: r.portes.tarifa,
          base: r.portes.base,
          valor_iva: r.portes.iva,
          total: r.portes.total,
        },
  totais: r.totais,
  textos: r.textos.map((t) => ({
    tipo: t.tipo,
    versao: `lgv_${t.versao_id}`,
    numero: t.numero,
    resumo_texto: t.resumo_texto,
    validado_por_jurista: t.validado_por_jurista,
  })),
  em_falta: r.em_falta,
  bloqueios: r.bloqueios,
  botao: r.botao,
});

const paraVersao = (v: Awaited<ReturnType<typeof lerVersaoTextoLegal>>) => ({
  id: `lgv_${v.id}`,
  texto_legal: `lgt_${v.texto_legal_id}`,
  tipo: v.tipo,
  pais: v.pais,
  lingua: v.lingua,
  tipo_cliente: v.tipo_cliente,
  numero: v.numero,
  estado: v.estado,
  texto: v.texto,
  resumo_texto: v.resumo_texto,
  validado_por_jurista: v.validado_por_jurista,
  jurista: v.jurista,
  publicada_em: iso(v.publicada_em),
});

const paraSessao = (s: SessaoLida) => ({
  id: `chk_${s.id}`,
  estado: s.estado,
  expira_em: s.expira_em.toISOString(),
  mercado: `mkt_${s.mercado_id}`,
  lingua: s.lingua,
  contacto:
    s.email === null
      ? null
      : { email: s.email, nome: s.nome, telefone: s.telefone },
  entrega: s.entrega,
  finalidade: s.finalidade,
  faturacao: s.faturacao,
  metodo_entrega:
    s.metodo_entrega_id === null ? null : `shm_${s.metodo_entrega_id}`,
  metodo_pagamento: s.metodo_pagamento,
});

const Morada = Type.Object(
  {
    pais: Pais,
    codigo_postal: Type.String({ minLength: 1, maxLength: 20 }),
    linha1: Type.String({ minLength: 1, maxLength: 200 }),
    linha2: Type.Optional(
      Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    ),
    localidade: Type.String({ minLength: 1, maxLength: 100 }),
  },
  { additionalProperties: false },
);
type MoradaPedida = {
  pais: string;
  codigo_postal: string;
  linha1: string;
  linha2?: string | null;
  localidade: string;
};
const moradaDe = (m: MoradaPedida) => ({
  pais: m.pais,
  codigo_postal: m.codigo_postal,
  linha1: m.linha1,
  linha2: m.linha2 ?? null,
  localidade: m.localidade,
});

export function rotasDoCheckout(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
  envios?: ConfigEnvios,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const loja = { ambito: "storefront" as const, loja: true };
  const publico = { ambito: "publico" as const, loja: true };

  // ------------------------------------------------- API da Loja: carrinho

  rotas.post(
    "/store/carts",
    {
      config: loja,
      schema: {
        description:
          "Cria um carrinho (sem conta) no canal × mercado da loja da chave pública. O `segredo` só aparece aqui: as outras operações pedem-no no cabeçalho `X-Cart-Secret`.",
        headers: CabecalhoIdempotencia,
        body: Type.Object(
          { canal: IdCanal, mercado: IdMercado, lingua: Lingua },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ id: Type.String(), segredo: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escreverComSegredo(base, pedido, resposta, pedido.body, (trx, chave) =>
        emCheckout(resposta, async () => {
          const r = await criarCarrinho(
            trx,
            chave.comercianteId,
            lojaDa(pedido),
            {
              canal: semPrefixo(pedido.body.canal),
              mercado: semPrefixo(pedido.body.mercado),
              lingua: pedido.body.lingua,
            },
          );
          return {
            corpo: { id: `crt_${r.id}`, segredo: r.segredo },
            guardar: { id: `crt_${r.id}` },
          };
        }),
      ),
  );

  const paraCarrinho = (v: Awaited<ReturnType<typeof verCarrinho>>) => ({
    id: `crt_${v.carrinho.id}`,
    estado: v.carrinho.estado,
    mercado: `mkt_${v.carrinho.mercado_id}`,
    lingua: v.carrinho.lingua,
    moeda: v.moeda,
    preco_inclui_iva: v.preco_inclui_iva,
    linhas: v.linhas.map((l) => ({
      id: `crl_${l.id}`,
      variante: `var_${l.variante_id}`,
      quantidade: l.quantidade,
      preco_unitario: l.preco?.montante ?? null,
      total: l.preco === null ? null : l.preco.montante * l.quantidade,
    })),
    // Provisório: o IVA e os portes decidem-se no checkout, com a morada.
    total_provisorio: v.linhas.every((l) => l.preco !== null)
      ? v.linhas.reduce(
          (t, l) => t + (l.preco?.montante ?? 0) * l.quantidade,
          0,
        )
      : null,
  });

  rotas.get(
    "/store/carts/:id",
    {
      config: loja,
      schema: {
        description:
          "O carrinho com o preço de cada linha no mercado; o total é provisório até ao checkout (o IVA e os portes decidem-se com a morada).",
        headers: CabecalhoCarrinho,
        params: Type.Object({ id: IdCarrinho }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, async () =>
        paraCarrinho(
          await verCarrinho(
            base,
            chaveDo(pedido).comercianteId,
            lojaDa(pedido),
            semPrefixo(pedido.params.id),
            pedido.headers["x-cart-secret"],
          ),
        ),
      ),
  );

  rotas.post(
    "/store/carts/:id/lines",
    {
      config: loja,
      schema: {
        description:
          "Põe uma variante no carrinho com a quantidade (se já lá está, muda a quantidade). Só variantes à venda no canal × mercado; respeita a quantidade mínima e o múltiplo da lista.",
        headers: CabecalhosEscritaCarrinho,
        params: Type.Object({ id: IdCarrinho }),
        body: Type.Object(
          {
            variante: IdVariante,
            quantidade: Type.Integer({ minimum: 1, maximum: 10000 }),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ linha: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        200,
        (trx, chave) =>
          emCheckout(resposta, async () => ({
            linha: `crl_${await porLinha(
              trx,
              chave.comercianteId,
              lojaDa(pedido),
              semPrefixo(pedido.params.id),
              pedido.headers["x-cart-secret"],
              {
                variante: semPrefixo(pedido.body.variante),
                quantidade: pedido.body.quantidade,
              },
            )}`,
          })),
        undefined,
        // O segredo entra no corpo idempotente: repetir com outro segredo é
        // outro pedido (revisão do #276, P1-1).
        {
          ...pedido.body,
          segredo: resumoDoSegredo(pedido.headers["x-cart-secret"]),
        },
      ),
  );

  rotas.delete(
    "/store/carts/:id/lines/:linha",
    {
      config: loja,
      schema: {
        description: "Tira uma linha do carrinho.",
        headers: CabecalhosEscritaCarrinho,
        params: Type.Object({ id: IdCarrinho, linha: IdLinha }),
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(
        base,
        pedido,
        resposta,
        204,
        (trx, chave) =>
          emCheckout(resposta, async () => {
            await tirarLinha(
              trx,
              chave.comercianteId,
              lojaDa(pedido),
              semPrefixo(pedido.params.id),
              pedido.headers["x-cart-secret"],
              semPrefixo(pedido.params.linha),
            );
            return null;
          }),
        undefined,
        { segredo: resumoDoSegredo(pedido.headers["x-cart-secret"]) },
      ),
  );

  rotas.post(
    "/store/carts/:id/checkout",
    {
      config: loja,
      schema: {
        description:
          "Abre o checkout alojado pelo Eurolify (ADR-0039): congela o carrinho e devolve o token da sessão, que só aparece aqui. O frontend leva o cliente para o checkout com ele.",
        headers: CabecalhosEscritaCarrinho,
        params: Type.Object({ id: IdCarrinho }),
        response: {
          201: Type.Object({
            sessao: Type.String(),
            token: Type.String(),
            caminho: Type.String(),
            expira_em: Type.String(),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escreverComSegredo(
        base,
        pedido,
        resposta,
        { segredo: resumoDoSegredo(pedido.headers["x-cart-secret"]) },
        (trx, chave) =>
          emCheckout(resposta, async () => {
            const r = await iniciarCheckout(
              trx,
              chave.comercianteId,
              lojaDa(pedido),
              semPrefixo(pedido.params.id),
              pedido.headers["x-cart-secret"],
            );
            return {
              corpo: {
                sessao: `chk_${r.sessao}`,
                token: r.token,
                caminho: `/checkout/${r.token}`,
                expira_em: r.expira_em.toISOString(),
              },
              guardar: { sessao: `chk_${r.sessao}` },
            };
          }),
      ),
  );

  // ------------------------------------------- Checkout alojado (pelo token)

  const ParamToken = Type.Object({ token: Token });

  rotas.get(
    "/checkout/:token",
    {
      config: publico,
      schema: {
        description: "O estado da sessão de checkout (o que o cliente já deu).",
        params: ParamToken,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        naSessao(
          base,
          pedido.params.token,
          (_trx, s) => Promise.resolve(paraSessao(s)),
          {
            soAberta: false,
          },
        ),
      ),
  );

  rotas.put(
    "/checkout/:token/contact",
    {
      config: publico,
      schema: {
        description:
          "O contacto para a confirmação (e-mail e nome; o telefone só se a entrega o pedir).",
        params: ParamToken,
        body: Type.Object(
          {
            email: Type.String({
              maxLength: 254,
              pattern: "^[^@\\s]+@[^@\\s]+$",
            }),
            nome: Type.String({ minLength: 1, maxLength: 200 }),
            telefone: Type.Optional(
              Type.Union([
                Type.String({ pattern: "^\\+[1-9][0-9]{6,14}$" }),
                Type.Null(),
              ]),
            ),
          },
          { additionalProperties: false },
        ),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        naSessao(base, pedido.params.token, async (trx, s) => {
          await porContacto(trx, s, {
            email: pedido.body.email,
            nome: pedido.body.nome,
            telefone: pedido.body.telefone ?? null,
          });
          return { ok: true };
        }),
      ),
  );

  rotas.put(
    "/checkout/:token/delivery",
    {
      config: publico,
      schema: {
        description:
          "A morada de entrega. O país pode mudar o mercado (docs/20 R8); um país que a loja não serve é recusado.",
        params: ParamToken,
        body: Morada,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        naSessao(base, pedido.params.token, async (trx, s) => {
          await porEntrega(trx, s, moradaDe(pedido.body));
          return { ok: true };
        }),
      ),
  );

  rotas.put(
    "/checkout/:token/billing",
    {
      config: publico,
      schema: {
        description:
          "A faturação e a finalidade: compra como particular (consumo, por omissão) ou empresa (profissional, revenda, com NIF); «a fatura é para outra pessoa».",
        params: ParamToken,
        body: Type.Object(
          {
            finalidade: umDe(["consumo", "profissional", "revenda"] as const),
            tipo: umDe(["particular", "empresa"] as const),
            nome_documento: Type.String({ minLength: 1, maxLength: 200 }),
            nif: Type.Optional(
              Type.Union([
                Type.String({ minLength: 1, maxLength: 30 }),
                Type.Null(),
              ]),
            ),
            morada: Type.Optional(Type.Union([Morada, Type.Null()])),
            outra_pessoa: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        naSessao(base, pedido.params.token, async (trx, s) => {
          const b = pedido.body;
          await porFaturacao(trx, s, b.finalidade, {
            tipo: b.tipo,
            nome_documento: b.nome_documento,
            nif: b.nif ?? null,
            morada:
              b.morada === undefined || b.morada === null
                ? null
                : moradaDe(b.morada),
            outra_pessoa: b.outra_pessoa ?? false,
          });
          return { ok: true };
        }),
      ),
  );

  rotas.get(
    "/checkout/:token/delivery-methods",
    {
      config: publico,
      schema: {
        description:
          "Os métodos de entrega do mercado da sessão, com a data-limite se encomendar agora e os códigos postais que servem; os que não servem esta morada ou este conteúdo vêm com o porquê (docs/36 L1, L3, R4).",
        params: ParamToken,
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        naSessao(
          base,
          pedido.params.token,
          async (trx, s) => ({
            dados: (await metodosDaSessao(trx, s)).map((m) => ({
              ...m,
              id: `shm_${m.id}`,
            })),
          }),
          { soAberta: false },
        ),
      ),
  );

  rotas.put(
    "/checkout/:token/delivery-method",
    {
      config: publico,
      schema: {
        description: "O método de entrega, dos do mercado da sessão.",
        params: ParamToken,
        body: Type.Object(
          { metodo: IdMetodo },
          { additionalProperties: false },
        ),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        naSessao(base, pedido.params.token, async (trx, s) => {
          await porMetodoEntrega(trx, s, semPrefixo(pedido.body.metodo));
          return { ok: true };
        }),
      ),
  );

  rotas.put(
    "/checkout/:token/payment-method",
    {
      config: publico,
      schema: {
        description:
          "O método de pagamento escolhido antes de sair para o prestador (payments-psd2-sca). Os métodos de cada mercado chegam com a fatia 8.",
        params: ParamToken,
        body: Type.Object(
          { metodo: Type.String({ pattern: "^[a-z_]{2,40}$" }) },
          { additionalProperties: false },
        ),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        naSessao(base, pedido.params.token, async (trx, s) => {
          await porMetodoPagamento(trx, s, pedido.body.metodo);
          return { ok: true };
        }),
      ),
  );

  rotas.get(
    "/checkout/:token/summary",
    {
      config: publico,
      schema: {
        description:
          "O resumo imediatamente antes do botão final: cada linha com o preço e o IVA, os portes, o total, os textos legais a aceitar (com a versão), o que falta e o que impede o botão. Devolve a `impressao` do que o cliente vê: o botão final leva-a e, se o recálculo der outra, a encomenda não se cria. Não grava nada.",
        params: ParamToken,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        naSessao(base, pedido.params.token, async (trx, s) =>
          paraResumo(await calcularResumo(trx, s)),
        ),
      ),
  );

  rotas.post(
    "/checkout/:token/place",
    {
      config: publico,
      schema: {
        description:
          "O botão final («Encomendar com obrigação de pagar»): recalcula e, se nada mudou desde o resumo e as versões aceites são as do resumo, cria a encomenda a aguardar pagamento com a cópia de tudo. Repetir numa sessão concluída devolve a mesma encomenda.",
        params: ParamToken,
        body: Type.Object(
          {
            aceita_condicoes: Type.Boolean(),
            versoes: Type.Array(IdVersao, { maxItems: 10 }),
            // A impressão do resumo que o cliente viu (GET …/summary).
            impressao: Type.String({ pattern: "^[0-9a-f]{64}$" }),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ encomenda: Type.String() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, async () => {
        const id = await naSessao(
          base,
          pedido.params.token,
          async (trx, s) => {
            // O botão repetido numa sessão concluída: a mesma encomenda (R12).
            if (s.estado === "concluida") {
              const e = await encomendaDaSessao(trx, s.id);
              if (e !== null) return e;
            }
            if (s.estado !== "aberta") {
              throw new ErroCheckout(
                "checkout.closed",
                `checkout.closed: a sessão está ${s.estado}`,
              );
            }
            return concluir(trx, s, {
              aceita_condicoes: pedido.body.aceita_condicoes,
              versoes: pedido.body.versoes.map(semPrefixo),
              impressao: pedido.body.impressao,
            });
          },
          { soAberta: false },
        );
        void resposta.status(201);
        return { encomenda: `ord_${id}` };
      }),
  );

  rotas.get(
    "/checkout/:token/legal/:versao",
    {
      config: publico,
      schema: {
        description:
          "O texto inteiro de uma versão a aceitar (só as do resumo desta sessão), com o resumo SHA-256 que fica na encomenda como prova do que foi aceite.",
        params: Type.Object({ token: Token, versao: IdVersao }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        naSessao(base, pedido.params.token, async (trx, s) =>
          paraVersao(
            await versaoDoResumo(trx, s, semPrefixo(pedido.params.versao)),
          ),
        ),
      ),
  );

  rotas.get(
    "/checkout/:token/confirmation",
    {
      config: publico,
      schema: {
        description:
          "A confirmação da encomenda (o que foi comprado, os preços e o IVA, as condições aceites com a versão), depois do botão final.",
        params: ParamToken,
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, () =>
        naSessao(
          base,
          pedido.params.token,
          async (trx, s) => {
            const id =
              s.estado === "concluida"
                ? await encomendaDaSessao(trx, s.id)
                : null;
            if (id === null) {
              throw new ErroCheckout(
                "checkout.incomplete",
                "a encomenda ainda não foi feita",
              );
            }
            // O estado fiscal interno não sai na confirmação pública
            // (revisão do #312, P2-10).
            const publica: Partial<ReturnType<typeof paraEncomenda>> =
              paraEncomenda(await lerEncomenda(trx, s.comerciante_id, id));
            delete publica.emissor_fiscal;
            delete publica.documento;
            // A conta e o serviço da transportadora são da operação; o
            // cliente vê o método e a data-limite (docs/36 L1).
            const me = publica.metodo_entrega as
              Record<string, unknown> | undefined;
            if (me !== undefined) {
              publica.metodo_entrega = {
                id: me["id"],
                nome: me["nome"],
                data_limite: me["data_limite"] ?? null,
              };
            }
            // O botão de livre resolução vai na confirmação (docs/30 R2 e
            // §8; revisão do #329, P2-9): só os consumidores o usam.
            return {
              ...publica,
              livre_resolucao:
                publica.finalidade === "consumo"
                  ? `/store/orders/${pedido.params.token}/withdrawal`
                  : null,
            };
          },
          { soAberta: false },
        ),
      ),
  );

  // ------------------------------------------- Administração: textos legais

  rotas.get(
    "/legal-texts",
    {
      config: { ambito: "legal:read" },
      schema: {
        description:
          "Os textos legais da loja por país, língua e tipo de cliente, com as versões (sem o texto).",
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, async () => ({
        dados: (
          await listarTextosLegais(base, chaveDo(pedido).comercianteId)
        ).map((t) => ({
          id: `lgt_${t.id}`,
          loja: `sto_${t.loja_id}`,
          tipo: t.tipo,
          pais: t.pais,
          lingua: t.lingua,
          tipo_cliente: t.tipo_cliente,
          versoes: t.versoes.map((v) => ({
            id: `lgv_${v.id}`,
            numero: v.numero,
            estado: v.estado,
            validado_por_jurista: v.validado_por_jurista,
            jurista: v.jurista,
            publicada_em: iso(v.publicada_em),
            publicada_por: v.publicada_por,
          })),
        })),
      })),
  );

  rotas.post(
    "/legal-texts",
    {
      config: { ambito: "legal:write" },
      schema: {
        description:
          "Cria um texto legal (sem versões) para uma loja, um país, uma língua e um tipo de cliente.",
        headers: CabecalhoIdempotencia,
        body: Type.Object(
          {
            loja: IdLoja,
            tipo: umDe(TIPOS_TEXTO_LEGAL),
            pais: Pais,
            lingua: Lingua,
            tipo_cliente: umDe(["consumidor", "profissional"] as const),
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
        emCheckout(resposta, async () => ({
          id: `lgt_${await criarTextoLegal(trx, chave.comercianteId, {
            ...pedido.body,
            loja: semPrefixo(pedido.body.loja),
          })}`,
        })),
      ),
  );

  rotas.post(
    "/legal-texts/:id/versions",
    {
      config: { ambito: "legal:write" },
      schema: {
        description:
          "Acrescenta uma versão (rascunho) do texto. Publicada, uma versão nunca muda: um texto novo é uma versão nova. Sem a validação do jurista, a versão fica marcada C.",
        headers: CabecalhoIdempotencia,
        params: Type.Object({ id: IdTexto }),
        body: Type.Object(
          {
            texto: Type.String({ minLength: 1, maxLength: 200000 }),
            validado_por_jurista: Type.Optional(Type.Boolean()),
            jurista: Type.Optional(
              Type.Union([
                Type.String({ minLength: 1, maxLength: 200 }),
                Type.Null(),
              ]),
            ),
            validado_em: Type.Optional(
              Type.Union([Type.String({ format: "date" }), Type.Null()]),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ id: Type.String(), numero: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, chave) =>
        emCheckout(resposta, async () => {
          const b = pedido.body;
          const v = await criarVersaoTextoLegal(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            {
              texto: b.texto,
              validado_por_jurista: b.validado_por_jurista ?? false,
              jurista: b.jurista ?? null,
              validado_em: b.validado_em ?? null,
            },
          );
          return { id: `lgv_${v.id}`, numero: v.numero };
        }),
      ),
  );

  rotas.get(
    "/legal-texts/:id/versions/:versao",
    {
      config: { ambito: "legal:read" },
      schema: {
        description:
          "Uma versão do texto legal com o texto inteiro e o resumo SHA-256 dele (o mesmo que fica na encomenda de quem a aceitou).",
        params: Type.Object({ id: IdTexto, versao: IdVersao }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, async () =>
        paraVersao(
          await lerVersaoTextoLegal(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
            semPrefixo(pedido.params.versao),
          ),
        ),
      ),
  );

  rotas.post(
    "/legal-texts/:id/versions/:versao/publish",
    {
      config: { ambito: "legal:write" },
      schema: {
        description:
          "Publica uma versão: passa a ser a que o checkout mostra e o cliente aceita.",
        headers: CabecalhoIdempotencia,
        params: Type.Object({ id: IdTexto, versao: IdVersao }),
        response: {
          200: Type.Object({
            id: Type.String(),
            numero: Type.Integer(),
            publicada_em: Type.String(),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emCheckout(resposta, async () => {
          const v = await publicarVersaoTextoLegal(
            trx,
            chave.comercianteId,
            semPrefixo(pedido.params.id),
            semPrefixo(pedido.params.versao),
          );
          return {
            id: `lgv_${v.id}`,
            numero: v.numero,
            publicada_em: (v.publicada_em as Date).toISOString(),
          };
        }),
      ),
  );

  // ------------------------------------- Administração: métodos de entrega

  const paraMetodo = (
    m: Awaited<ReturnType<typeof listarMetodosEntrega>>[number],
  ) => ({
    id: `shm_${m.id}`,
    mercado: `mkt_${m.mercado_id}`,
    nome: m.nome,
    prazo: m.prazo,
    tarifa: Number(m.tarifa),
    gratis_a_partir_de:
      m.gratis_a_partir_de === null ? null : Number(m.gratis_a_partir_de),
    pede_telefone: m.pede_telefone,
    // Os envios (docs/36 §3.2; 0072).
    conta:
      m.conta_transportadora_id === null
        ? null
        : `cac_${m.conta_transportadora_id}`,
    servico: m.servico,
    prazo_max_dias: m.prazo_max_dias,
    codigos_postais: m.codigos_postais,
    aceita_onu: m.aceita_onu,
    peso_max_g: m.peso_max_g,
    estado: m.estado,
    versao: m.versao,
  });

  rotas.get(
    "/shipping-methods",
    {
      config: { ambito: "shipping:read" },
      schema: {
        description:
          "Os métodos de entrega (tarifa fixa por encomenda, por mercado; docs/25 Q2).",
        querystring: Type.Object({ mercado: Type.Optional(IdMercado) }),
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, async () => ({
        dados: (
          await listarMetodosEntrega(
            base,
            chaveDo(pedido).comercianteId,
            pedido.query.mercado === undefined
              ? undefined
              : semPrefixo(pedido.query.mercado),
          )
        ).map(paraMetodo),
      })),
  );

  const CamposMetodo = {
    nome: NomesPorLingua,
    prazo: Type.Optional(
      Type.Record(Lingua, Type.String({ maxLength: 200 }), {
        maxProperties: 30,
      }),
    ),
    tarifa: Type.Integer({ minimum: 0, maximum: 100_000_000 }),
    gratis_a_partir_de: Type.Optional(
      Type.Union([
        Type.Integer({ minimum: 1, maximum: 100_000_000_000 }),
        Type.Null(),
      ]),
    ),
    pede_telefone: Type.Optional(Type.Boolean()),
  };

  // Os campos dos envios (docs/36 §3.2): a conta e o serviço vão juntos, ou
  // nenhum (método «manual»).
  const CamposEnvios = {
    conta: Type.Optional(Type.Union([IdConta, Type.Null()])),
    servico: Type.Optional(
      Type.Union([
        Type.String({ pattern: "^[0-9A-Za-z_.-]{1,50}$" }),
        Type.Null(),
      ]),
    ),
    prazo_max_dias: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
    codigos_postais: Type.Optional(
      Type.Array(Type.String({ pattern: "^[0-9A-Za-z][0-9A-Za-z -]{0,11}$" }), {
        maxItems: 200,
      }),
    ),
    aceita_onu: Type.Optional(
      Type.Array(Type.String({ pattern: "^UN[0-9]{4}$" }), { maxItems: 200 }),
    ),
    peso_max_g: Type.Optional(
      Type.Union([
        Type.Integer({ minimum: 1, maximum: 1_000_000 }),
        Type.Null(),
      ]),
    ),
  };
  const enviosDo = (b: {
    conta?: string | null;
    servico?: string | null;
    prazo_max_dias?: number;
    codigos_postais?: string[];
    aceita_onu?: string[];
    peso_max_g?: number | null;
  }) => ({
    ...(b.conta === undefined
      ? {}
      : { conta: b.conta === null ? null : semPrefixo(b.conta) }),
    ...(b.servico === undefined ? {} : { servico: b.servico }),
    ...(b.prazo_max_dias === undefined
      ? {}
      : { prazo_max_dias: b.prazo_max_dias }),
    ...(b.codigos_postais === undefined
      ? {}
      : { codigos_postais: b.codigos_postais }),
    ...(b.aceita_onu === undefined ? {} : { aceita_onu: b.aceita_onu }),
    ...(b.peso_max_g === undefined ? {} : { peso_max_g: b.peso_max_g }),
  });

  rotas.post(
    "/shipping-methods",
    {
      config: { ambito: "shipping:write" },
      schema: {
        description: "Cria um método de entrega num mercado.",
        headers: CabecalhoIdempotencia,
        body: Type.Object(
          { mercado: IdMercado, ...CamposMetodo, ...CamposEnvios },
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
        emEnvios(resposta, () =>
          emCheckout(resposta, async () => {
            const b = pedido.body;
            return {
              id: `shm_${await criarMetodoEntrega(
                trx,
                chave.comercianteId,
                semPrefixo(b.mercado),
                {
                  nome: b.nome,
                  prazo: b.prazo ?? {},
                  tarifa: b.tarifa,
                  gratis_a_partir_de: b.gratis_a_partir_de ?? null,
                  pede_telefone: b.pede_telefone ?? false,
                  ...enviosDo(b),
                },
                envios,
              )}`,
            };
          }),
        ),
      ),
  );

  rotas.patch(
    "/shipping-methods/:id",
    {
      config: { ambito: "shipping:write" },
      schema: {
        description:
          "Muda um método de entrega, na versão lida (escrita optimista). Arquivar tira-o do checkout.",
        headers: CabecalhoIdempotencia,
        params: Type.Object({ id: IdMetodo }),
        body: Type.Object(
          {
            versao: Type.Integer({ minimum: 1 }),
            nome: Type.Optional(NomesPorLingua),
            prazo: CamposMetodo.prazo,
            tarifa: Type.Optional(CamposMetodo.tarifa),
            gratis_a_partir_de: CamposMetodo.gratis_a_partir_de,
            pede_telefone: Type.Optional(Type.Boolean()),
            estado: Type.Optional(umDe(["activo", "arquivado"] as const)),
            ...CamposEnvios,
          },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, (trx, chave) =>
        emEnvios(resposta, () =>
          emCheckout(resposta, async () => {
            const b = pedido.body;
            await mudarMetodoEntrega(
              trx,
              chave.comercianteId,
              semPrefixo(pedido.params.id),
              b.versao,
              {
                ...(b.nome === undefined ? {} : { nome: b.nome }),
                ...(b.prazo === undefined ? {} : { prazo: b.prazo }),
                ...(b.tarifa === undefined ? {} : { tarifa: b.tarifa }),
                ...(b.gratis_a_partir_de === undefined
                  ? {}
                  : { gratis_a_partir_de: b.gratis_a_partir_de }),
                ...(b.pede_telefone === undefined
                  ? {}
                  : { pede_telefone: b.pede_telefone }),
                ...(b.estado === undefined ? {} : { estado: b.estado }),
                ...enviosDo(b),
              },
              envios,
            );
            return null;
          }),
        ),
      ),
  );

  // ----------------------------------------- Administração: checkouts e encomendas

  rotas.get(
    "/checkouts",
    {
      config: { ambito: "orders:read" },
      schema: {
        description:
          "As sessões de checkout (abertas, concluídas, expiradas, abandonadas), sem dados pessoais.",
        querystring: Type.Object({
          estado: Type.Optional(
            umDe(["aberta", "concluida", "expirada", "abandonada"] as const),
          ),
          limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, async () => ({
        dados: (
          await listarCheckouts(
            base,
            chaveDo(pedido).comercianteId,
            pedido.query.estado,
            pedido.query.limite ?? 50,
          )
        ).map((s) => ({
          id: `chk_${s.id}`,
          estado: s.estado,
          carrinho: `crt_${s.carrinho_id}`,
          mercado: `mkt_${s.mercado_id}`,
          criado_em: s.criado_em.toISOString(),
          expira_em: s.expira_em.toISOString(),
          concluida_em: iso(s.concluida_em),
        })),
      })),
  );

  rotas.get(
    "/orders",
    {
      config: { ambito: "orders:read" },
      schema: {
        description:
          "As encomendas, das mais recentes (nesta fatia, só as criadas pelo checkout, a aguardar pagamento).",
        querystring: Type.Object({
          limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
        response: {
          200: Type.Object({ dados: Type.Array(Livre) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, async () => ({
        dados: (
          await listarEncomendas(
            base,
            chaveDo(pedido).comercianteId,
            pedido.query.limite ?? 50,
          )
        ).map((e) => ({
          id: `ord_${e.id}`,
          estado: e.estado,
          total: Number(e.total),
          moeda: e.moeda,
          cliente: `cus_${e.cliente_id}`,
          criada_em: e.criada_em.toISOString(),
        })),
      })),
  );

  rotas.get(
    "/orders/:id",
    {
      config: { ambito: "orders:read" },
      schema: {
        description:
          "Uma encomenda com as linhas e as cópias (preço, decisão de IVA, versões aceites).",
        params: Type.Object({ id: IdEncomenda }),
        response: { 200: Livre, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emCheckout(resposta, async () =>
        paraEncomenda(
          await lerEncomenda(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        ),
      ),
  );
}

const paraEncomenda = (r: Awaited<ReturnType<typeof lerEncomenda>>) => ({
  id: `ord_${r.encomenda.id}`,
  estado: r.encomenda.estado,
  cliente: `cus_${r.encomenda.cliente_id}`,
  perfil: `bpf_${r.encomenda.perfil_id}`,
  perfil_copia: r.encomenda.perfil_copia,
  contacto: r.encomenda.contacto,
  entrega: r.encomenda.entrega,
  finalidade: r.encomenda.finalidade,
  moeda: r.encomenda.moeda,
  preco_inclui_iva: r.encomenda.preco_inclui_iva,
  totais: {
    base: Number(r.encomenda.total_base),
    iva: Number(r.encomenda.total_iva),
    total: Number(r.encomenda.total),
  },
  portes: r.encomenda.portes,
  metodo_entrega: r.encomenda.metodo_entrega,
  metodo_pagamento: r.encomenda.metodo_pagamento,
  aceitacoes: r.encomenda.aceitacoes,
  emissor_fiscal: r.encomenda.emissor_fiscal,
  documento:
    r.documento === null
      ? null
      : { id: `inv_${r.documento.id}`, estado: r.documento.estado },
  criada_em: r.encomenda.criada_em.toISOString(),
  linhas: r.linhas.map((l) => ({
    id: `oli_${l.id}`,
    posicao: l.posicao,
    variante: `var_${l.variante_id}`,
    sku: l.sku,
    nome: l.nome,
    quantidade: l.quantidade,
    preco_unitario: Number(l.preco_unitario),
    preco: l.preco,
    decisao_iva: l.decisao_iva,
    base: Number(l.base),
    iva: Number(l.iva),
    total: Number(l.total),
    selado_por_higiene: l.selado_por_higiene,
  })),
});
