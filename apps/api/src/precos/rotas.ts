import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type, type Static } from "typebox";
import { erroBase, ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import {
  ConsultaPagina,
  escrever,
  idCom,
  Instante,
  iso,
  Lista,
  ParametroArtigo,
  semPrefixo,
} from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import { CabecalhoIdempotencia } from "../identidade/rotas.js";
import { ErroPrecos, type CodigoErroPrecos } from "./erros.js";
import {
  alterarMercado,
  anunciarReducao,
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  definirPreco,
  emVigor,
  historicoDoPreco,
  listarCanais,
  listarListas,
  listarMercados,
  mudarEstadoCanal,
  mudarEstadoLista,
  mudarEstadoMercado,
  obterCanal,
  obterLista,
  obterMercado,
  precoPorUnidade,
  precosDaListaComReducoes,
  precosDoArtigo,
  reducoesDoPreco,
  tirarPreco,
  tirarReducao,
  traduzir,
  type PrecoDaLista,
  type Reducao,
} from "./repositorio.js";

// A API de Administração de Preços e mercados (docs/20 §7.1 e §10; issue
// #127; Diogo, 09/10/2026: «sim, aprovo; avança com o código de Preços»).
// Âmbitos `prices:read` e `prices:write` (§10.1). As escritas passam pelo
// `escrever` do Catálogo: a Idempotency-Key e o `eurolify.quem` da chave na
// mesma transacção; o repositório corre nela (noDominio).

/**
 * O estado HTTP de cada código de Preços (docs/18 §2): 404 o que não existe,
 * 409 o que choca com o estado ou com outro registo, 422 o que o servidor
 * recusa por regra, 400 um valor mal formado, 503 o repetível. O compilador
 * obriga a decidir cada código novo.
 */
const ESTADO_DO_CODIGO: Record<CodigoErroPrecos, number> = {
  "prices.not_found": 404,
  "prices.invalid_field": 400,
  "prices.retry": 503,
  "prices.version_conflict": 409,
  "prices.invalid_transition": 409,
  "prices.market_has_prices": 409,
  "prices.base_list_required": 409,
  "prices.base_list_in_use": 409,
  "prices.base_list_duplicate": 409,
  "prices.country_in_other_market": 409,
  "prices.list_archived": 409,
  "prices.priority_duplicate": 409,
  "prices.label_duplicate": 409,
  "prices.label_archived": 409,
  "prices.channel_market_duplicate": 409,
  "prices.channel_market_in_use": 409,
  "prices.published_variant": 409,
  "prices.reduction_active": 409,
  "prices.immutable_identity": 422,
  "prices.defined_by_required": 422,
  "prices.name_required": 422,
  "prices.country_invalid": 422,
  "prices.currency_invalid": 422,
  "prices.language_invalid": 422,
  "prices.main_language_not_listed": 422,
  "prices.free_only_at_zero": 422,
  "prices.amount_invalid": 422,
  "prices.quantity_invalid": 422,
  "prices.b2b_label_required": 422,
  "prices.reduction_without_history": 422,
  "prices.reduction_not_lower": 422,
};

/** Um erro de Preços no formato da API; o resto passa como está. */
function paraApi(erro: unknown, resposta: FastifyReply): unknown {
  const e = traduzir(erro);
  if (!(e instanceof ErroPrecos)) return e;
  if (e.codigo === "prices.retry") void resposta.header("Retry-After", "1");
  const mensagens =
    e.codigo === "prices.not_found"
      ? { pt: "Não encontrado", en: "Not found" }
      : e.codigo === "prices.retry"
        ? {
            pt: "Outra operação tinha o registo tomado; tente outra vez",
            en: "Another operation held the record; try again",
          }
        : {
            pt: "Pedido recusado por Preços e mercados",
            en: "Rejected by prices and markets",
          };
  // O texto do PostgreSQL não sai (docs/18 §2), salvo nas mensagens que os
  // gatilhos escrevem para fora (começam pelo código).
  const daBase =
    typeof (e.cause as { code?: unknown } | undefined)?.code === "string" &&
    !e.message.startsWith(`${e.codigo}:`);
  const detalhe = daBase ? "um valor do pedido não é aceite" : e.message;
  return new ErroApi(e.codigo, ESTADO_DO_CODIGO[e.codigo], mensagens, detalhe);
}

/** Corre e devolve os erros de Preços no formato da API. */
async function emPrecos<T>(
  resposta: FastifyReply,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (erro) {
    throw paraApi(erro, resposta);
  }
}

// ---------------------------------------------------------- Os esquemas

const IdMercado = idCom("mkt", "mkt_…");
const IdCanal = idCom("chn", "chn_…");
const IdLista = idCom("prl", "prl_…");
const IdVariante = idCom("var", "var_…");
const IdLoja = idCom("sto", "sto_…");
const IdEtiqueta = idCom("ctg", "ctg_… (só nas listas b2b)");
const Montante = Type.Integer({
  minimum: 0,
  maximum: 100_000_000_000,
  description: "Em cêntimos, na moeda do mercado",
});
const Nome = Type.String({ minLength: 1, maxLength: 100 });
const Pais = Type.String({ pattern: "^[A-Z]{2}$" });
const Lingua = Type.String({ pattern: "^[a-z]{2,3}(-[A-Z]{2})?$" });
const Moeda = Type.String({ pattern: "^[A-Z]{3}$" });
const Versao = { versao: Type.Integer({ minimum: 1 }) };
const PedidoVersao = Type.Object(Versao, { additionalProperties: false });

const Mercado = Type.Object({
  id: Type.String({ description: "mkt_…" }),
  loja: Type.String({ description: "sto_…" }),
  nome: Type.String(),
  paises: Type.Array(Type.String()),
  moeda: Type.String(),
  linguas: Type.Array(Type.String()),
  lingua_principal: Type.String(),
  preco_inclui_iva: Type.Boolean(),
  estado: Type.String(),
  versao: Type.Integer(),
  criado_em: Instante,
  actualizado_em: Instante,
});
type LinhaMercado = Awaited<ReturnType<typeof obterMercado>>;
const paraMercado = (m: LinhaMercado): Static<typeof Mercado> => ({
  id: `mkt_${m.id}`,
  loja: `sto_${m.loja_id}`,
  nome: m.nome,
  paises: m.paises,
  moeda: m.moeda,
  linguas: m.linguas,
  lingua_principal: m.lingua_principal,
  preco_inclui_iva: m.preco_inclui_iva,
  estado: m.estado,
  versao: m.versao,
  criado_em: m.criado_em.toISOString(),
  actualizado_em: m.actualizado_em.toISOString(),
});

const CamposMercado = {
  nome: Nome,
  paises: Type.Array(Pais, { minItems: 1, maxItems: 50 }),
  moeda: Moeda,
  linguas: Type.Array(Lingua, { minItems: 1, maxItems: 30 }),
  lingua_principal: Lingua,
  preco_inclui_iva: Type.Optional(Type.Boolean()),
};
const PedidoMercado = Type.Object(
  { loja: IdLoja, ...CamposMercado },
  { additionalProperties: false },
);
const PedidoAlterarMercado = Type.Object(
  {
    ...Versao,
    nome: Type.Optional(Nome),
    paises: Type.Optional(CamposMercado.paises),
    moeda: Type.Optional(Moeda),
    linguas: Type.Optional(CamposMercado.linguas),
    lingua_principal: Type.Optional(Lingua),
    preco_inclui_iva: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const Canal = Type.Object({
  id: Type.String({ description: "chn_…" }),
  loja: Type.String({ description: "sto_…" }),
  nome: Type.String(),
  tipo: Type.String(),
  estado: Type.String(),
  mercados: Type.Array(Type.String({ description: "mkt_…" })),
  versao: Type.Integer(),
  criado_em: Instante,
});
type LinhaCanal = Awaited<ReturnType<typeof obterCanal>>;
const paraCanal = (c: LinhaCanal): Static<typeof Canal> => ({
  id: `chn_${c.id}`,
  loja: `sto_${c.loja_id}`,
  nome: c.nome,
  tipo: c.tipo,
  estado: c.estado,
  mercados: c.mercados.map((m) => `mkt_${m}`),
  versao: c.versao,
  criado_em: c.criado_em.toISOString(),
});
const PedidoCanal = Type.Object(
  {
    loja: IdLoja,
    nome: Nome,
    mercados: Type.Optional(Type.Array(IdMercado, { maxItems: 100 })),
  },
  { additionalProperties: false },
);
const PedidoMercadosDoCanal = Type.Object(
  { ...Versao, mercados: Type.Array(IdMercado, { maxItems: 100 }) },
  { additionalProperties: false },
);

const ListaPrecos = Type.Object({
  id: Type.String({ description: "prl_…" }),
  mercado: Type.String({ description: "mkt_…" }),
  nome: Type.String(),
  tipo: Type.String(),
  etiqueta: Type.Union([Type.String({ description: "ctg_…" }), Type.Null()]),
  prioridade: Type.Union([Type.Integer(), Type.Null()]),
  estado: Type.String(),
  versao: Type.Integer(),
  criado_em: Instante,
});
type LinhaLista = Awaited<ReturnType<typeof obterLista>>;
const paraLista = (l: LinhaLista): Static<typeof ListaPrecos> => ({
  id: `prl_${l.id}`,
  mercado: `mkt_${l.mercado_id}`,
  nome: l.nome,
  tipo: l.tipo,
  etiqueta: l.etiqueta_id === null ? null : `ctg_${l.etiqueta_id}`,
  prioridade: l.prioridade,
  estado: l.estado,
  versao: l.versao,
  criado_em: l.criado_em.toISOString(),
});
const PedidoLista = Type.Object(
  {
    mercado: IdMercado,
    nome: Nome,
    tipo: Type.Union([Type.Literal("base"), Type.Literal("b2b")]),
    // A etiqueta de cliente (docs/23 §3.5; migração 0037), com o prefixo
    // `ctg_` como as outras referências.
    etiqueta: Type.Optional(IdEtiqueta),
    prioridade: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
  },
  { additionalProperties: false },
);

const ReducaoEsquema = Type.Object({
  id: Type.String({ description: "red_…" }),
  montante: Type.Integer(),
  preco_referencia: Type.Integer({
    description:
      "O mais baixo praticado nos 30 dias antes do início, calculado pelo servidor (docs/20 §3.6)",
  }),
  inicio: Instante,
  fim: Type.Union([Instante, Type.Null()]),
  terminada_em: Type.Union([Instante, Type.Null()]),
  em_vigor: Type.Boolean(),
});
const paraReducao = (
  r: Reducao,
  agora: Date,
): Static<typeof ReducaoEsquema> => ({
  id: `red_${r.id}`,
  montante: r.montante,
  preco_referencia: r.preco_referencia,
  inicio: r.inicio.toISOString(),
  fim: iso(r.fim),
  terminada_em: iso(r.terminada_em),
  em_vigor: emVigor(r, agora),
});

const PorUnidade = Type.Union([
  Type.Object({
    valor: Type.String({
      description:
        "Em unidades da moeda, com quatro casas (arredondado ao mais próximo na quarta); o arredondamento para mostrar ao consumidor é por verificar (docs/20 §10.3)",
    }),
    unidade: Type.String({ description: "kg, l, m, m2 ou m3" }),
    inclui_iva: Type.Boolean(),
  }),
  Type.Null(),
]);

const PrecoEsquema = Type.Object({
  variante: Type.String({ description: "var_…" }),
  montante: Type.Integer(),
  gratuito: Type.Boolean(),
  quantidade_minima: Type.Integer(),
  multiplo: Type.Integer(),
  definido_em: Instante,
  reducao: Type.Union([ReducaoEsquema, Type.Null()]),
  preco_por_unidade: PorUnidade,
});
/** Uma lista activa com os preços das variantes de um artigo (docs/22 §17.2). */
const PrecosDoArtigoNaLista = Type.Object({
  lista: ListaPrecos,
  mercado: Type.Object({
    id: Type.String({ description: "mkt_…" }),
    nome: Type.String(),
    estado: Type.String(),
    moeda: Type.String({ description: "ISO 4217" }),
    preco_inclui_iva: Type.Boolean({
      description:
        "Os montantes desta lista incluem IVA (o do mercado); o IVA de cada país sai do Motor de IVA",
    }),
  }),
  precos: Type.Array(PrecoEsquema, {
    description:
      "Só as variantes deste artigo com preço nesta lista; uma variante sem preço não vem",
  }),
});
export const RespostaPrecosDoArtigo = Lista(PrecosDoArtigoNaLista);

/**
 * Os preços de um artigo nas listas activas (docs/22 §17.2): a mesma para
 * `GET /products/{id}/prices` e `GET /hub/products/{id}/prices`. **Outro
 * chamador:** `identidade/hub-catalogo.ts`.
 */
export async function precosDoArtigoApi(
  base: Kysely<BaseDados>,
  comercianteId: string,
  id: string,
  consulta: Static<typeof ConsultaPagina>,
  resposta: FastifyReply,
): Promise<Static<typeof RespostaPrecosDoArtigo>> {
  return emPrecos(resposta, async () => {
    const agora = new Date();
    return comPagina(
      await precosDoArtigo(
        base,
        comercianteId,
        semPrefixo(id),
        limiteDe(consulta),
        idDoCursor(consulta.cursor),
      ),
      (l) => ({
        lista: paraLista(l.lista),
        mercado: {
          id: `mkt_${l.mercado.id}`,
          nome: l.mercado.nome,
          estado: l.mercado.estado,
          moeda: l.mercado.moeda,
          preco_inclui_iva: l.mercado.preco_inclui_iva,
        },
        precos: l.precos.map((p) =>
          paraPreco(p, l.mercado.preco_inclui_iva, agora),
        ),
      }),
    );
  });
}

const PedidoPreco = Type.Object(
  {
    montante: Montante,
    gratuito: Type.Optional(Type.Boolean()),
    quantidade_minima: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    ),
    multiplo: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
  },
  { additionalProperties: false },
);
const PedidoReducao = Type.Object(
  {
    montante: Type.Integer({ minimum: 1, maximum: 100_000_000_000 }),
    fim: Type.Optional(Type.Union([Instante, Type.Null()])),
  },
  { additionalProperties: false },
);
const Historico = Type.Object({
  linhas: Type.Array(
    Type.Object({
      montante: Type.Union([Type.Integer(), Type.Null()]),
      gratuito: Type.Union([Type.Boolean(), Type.Null()]),
      saiu: Type.Boolean(),
      moeda: Type.String(),
      preco_inclui_iva: Type.Boolean(),
      em_vigor_desde: Instante,
    }),
  ),
  reducoes: Type.Array(ReducaoEsquema),
});

const ParametroId = (id: ReturnType<typeof idCom>) => Type.Object({ id });
const ParametroPreco = Type.Object({ id: IdLista, variante: IdVariante });
const ConsultaListas = Type.Object(
  {
    limite: ConsultaPagina.properties.limite,
    cursor: ConsultaPagina.properties.cursor,
    mercado: Type.Optional(IdMercado),
  },
  { additionalProperties: false },
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const cursorDe = (id: string) => Buffer.from(id, "utf8").toString("base64url");
function idDoCursor(cursor: string | undefined): string | null {
  if (cursor === undefined) return null;
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID.test(id)) {
    throw erroBase("request.invalid", "`cursor` não é um cursor desta lista");
  }
  return id;
}
const limiteDe = (q: { limite?: string }) =>
  q.limite === undefined ? 25 : Number(q.limite);
const comPagina = <T, U>(
  p: { dados: T[]; total: number; ultimo: string | null },
  f: (x: T) => U,
) => ({
  dados: p.dados.map(f),
  total: p.total,
  ha_mais: p.ultimo !== null,
  cursor_seguinte: p.ultimo === null ? null : cursorDe(p.ultimo),
});

const quemDa = (c: { chaveId: string }) => `chave:key_${c.chaveId}`;

// ------------------------------------------------------------ As rotas

export function rotasDosPrecos(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const ler = { ambito: "prices:read" as const };
  const escrita = { ambito: "prices:write" as const };

  // ---- Mercados

  rotas.get(
    "/markets",
    {
      config: ler,
      schema: {
        description:
          "Os mercados do comerciante (docs/20 §3.1), por ordem de criação, no formato das listas.",
        querystring: ConsultaPagina,
        response: { 200: Lista(Mercado), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      comPagina(
        await emPrecos(resposta, async () =>
          listarMercados(
            base,
            chaveDo(pedido).comercianteId,
            limiteDe(pedido.query),
            idDoCursor(pedido.query.cursor),
          ),
        ),
        paraMercado,
      ),
  );

  rotas.get(
    "/markets/:id",
    {
      config: ler,
      schema: {
        description: "Um mercado.",
        params: ParametroId(IdMercado),
        response: { 200: Mercado, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      paraMercado(
        await emPrecos(resposta, () =>
          obterMercado(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        ),
      ),
  );

  rotas.post(
    "/markets",
    {
      config: escrita,
      schema: {
        description:
          "Cria um mercado em rascunho (docs/20 §3.1): países, moeda, línguas; os preços com IVA por omissão (Q1). Activa-se depois de ter uma lista de base.",
        headers: CabecalhoIdempotencia,
        body: PedidoMercado,
        response: { 201: Mercado, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, c) =>
        emPrecos(resposta, async () => {
          const { loja, ...dados } = pedido.body;
          const id = await criarMercado(trx, c.comercianteId, {
            loja_id: semPrefixo(loja),
            ...dados,
          });
          return paraMercado(await obterMercado(trx, c.comercianteId, id));
        }),
      ),
  );

  rotas.patch(
    "/markets/:id",
    {
      config: escrita,
      schema: {
        description:
          "Altera um mercado na versão lida. A moeda e o «preço inclui IVA» não mudam depois de haver preços; uma língua nova volta a verificar as publicações.",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdMercado),
        body: PedidoAlterarMercado,
        response: { 200: Mercado, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emPrecos(resposta, async () => {
          const { versao, ...alteracao } = pedido.body;
          const id = semPrefixo(pedido.params.id);
          await alterarMercado(trx, c.comercianteId, id, versao, alteracao);
          return paraMercado(await obterMercado(trx, c.comercianteId, id));
        }),
      ),
  );

  for (const [caminho, estado, texto] of [
    ["activate", "activo", "Activa (ou repõe) o mercado"],
    ["archive", "arquivado", "Arquiva o mercado; as publicações nele saem"],
  ] as const) {
    rotas.post(
      `/markets/:id/${caminho}`,
      {
        config: escrita,
        schema: {
          description: `${texto} (docs/20 §4.1), na versão lida.`,
          headers: CabecalhoIdempotencia,
          params: ParametroId(IdMercado),
          body: PedidoVersao,
          response: { 200: Mercado, ...RESPOSTA_DE_ERRO },
        },
      },
      (pedido, resposta) =>
        escrever(base, pedido, resposta, 200, (trx, c) =>
          emPrecos(resposta, async () => {
            const id = semPrefixo(pedido.params.id);
            await mudarEstadoMercado(
              trx,
              c.comercianteId,
              id,
              pedido.body.versao,
              estado,
            );
            return paraMercado(await obterMercado(trx, c.comercianteId, id));
          }),
        ),
    );
  }

  // ---- Canais

  rotas.get(
    "/channels",
    {
      config: ler,
      schema: {
        description:
          "Os canais do comerciante (docs/20 §3.2), com os mercados de cada um.",
        querystring: ConsultaPagina,
        response: { 200: Lista(Canal), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      comPagina(
        await emPrecos(resposta, () =>
          listarCanais(
            base,
            chaveDo(pedido).comercianteId,
            limiteDe(pedido.query),
            idDoCursor(pedido.query.cursor),
          ),
        ),
        paraCanal,
      ),
  );

  rotas.get(
    "/channels/:id",
    {
      config: ler,
      schema: {
        description: "Um canal, com os mercados dele.",
        params: ParametroId(IdCanal),
        response: { 200: Canal, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      paraCanal(
        await emPrecos(resposta, () =>
          obterCanal(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        ),
      ),
  );

  rotas.post(
    "/channels",
    {
      config: escrita,
      schema: {
        description:
          "Cria um canal online activo na loja (docs/20 §3.2), com os mercados dele (da mesma loja).",
        headers: CabecalhoIdempotencia,
        body: PedidoCanal,
        response: { 201: Canal, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, c) =>
        emPrecos(resposta, async () => {
          const id = await criarCanal(trx, c.comercianteId, {
            loja_id: semPrefixo(pedido.body.loja),
            nome: pedido.body.nome,
          });
          if (pedido.body.mercados !== undefined) {
            await definirMercadosDoCanal(
              trx,
              c.comercianteId,
              id,
              pedido.body.mercados.map(semPrefixo),
            );
          }
          return paraCanal(await obterCanal(trx, c.comercianteId, id));
        }),
      ),
  );

  rotas.put(
    "/channels/:id/markets",
    {
      config: escrita,
      schema: {
        description:
          "Substitui os mercados do canal, na versão lida (sobe-a). Tirar um mercado onde há uma publicação publicada é recusado (prices.channel_market_in_use).",
        headers: CabecalhoIdempotencia,
        params: ParametroId(IdCanal),
        body: PedidoMercadosDoCanal,
        response: { 200: Canal, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emPrecos(resposta, async () => {
          const id = semPrefixo(pedido.params.id);
          await definirMercadosDoCanal(
            trx,
            c.comercianteId,
            id,
            pedido.body.mercados.map(semPrefixo),
            pedido.body.versao,
          );
          return paraCanal(await obterCanal(trx, c.comercianteId, id));
        }),
      ),
  );

  for (const [caminho, estado, texto] of [
    ["archive", "arquivado", "Arquiva o canal; as publicações nele saem"],
    ["restore", "activo", "Repõe o canal (sem republicar)"],
  ] as const) {
    rotas.post(
      `/channels/:id/${caminho}`,
      {
        config: escrita,
        schema: {
          description: `${texto}, na versão lida.`,
          headers: CabecalhoIdempotencia,
          params: ParametroId(IdCanal),
          body: PedidoVersao,
          response: { 200: Canal, ...RESPOSTA_DE_ERRO },
        },
      },
      (pedido, resposta) =>
        escrever(base, pedido, resposta, 200, (trx, c) =>
          emPrecos(resposta, async () => {
            const id = semPrefixo(pedido.params.id);
            await mudarEstadoCanal(
              trx,
              c.comercianteId,
              id,
              pedido.body.versao,
              estado,
            );
            return paraCanal(await obterCanal(trx, c.comercianteId, id));
          }),
        ),
    );
  }

  // ---- Listas de preços

  rotas.get(
    "/price-lists",
    {
      config: ler,
      schema: {
        description:
          "As listas de preços (docs/20 §3.3), por ordem de criação; com `mercado`, só as dele.",
        querystring: ConsultaListas,
        response: { 200: Lista(ListaPrecos), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      comPagina(
        await emPrecos(resposta, () =>
          listarListas(
            base,
            chaveDo(pedido).comercianteId,
            pedido.query.mercado === undefined
              ? null
              : semPrefixo(pedido.query.mercado),
            limiteDe(pedido.query),
            idDoCursor(pedido.query.cursor),
          ),
        ),
        paraLista,
      ),
  );

  rotas.get(
    "/price-lists/:id",
    {
      config: ler,
      schema: {
        description: "Uma lista de preços.",
        params: ParametroId(IdLista),
        response: { 200: ListaPrecos, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      paraLista(
        await emPrecos(resposta, () =>
          obterLista(
            base,
            chaveDo(pedido).comercianteId,
            semPrefixo(pedido.params.id),
          ),
        ),
      ),
  );

  rotas.post(
    "/price-lists",
    {
      config: escrita,
      schema: {
        description:
          "Cria uma lista activa num mercado: a de base (uma por mercado) ou uma B2B por etiqueta, com prioridade (docs/20 §3.3).",
        headers: CabecalhoIdempotencia,
        body: PedidoLista,
        response: { 201: ListaPrecos, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 201, (trx, c) =>
        emPrecos(resposta, async () => {
          const b = pedido.body;
          const id = await criarLista(trx, c.comercianteId, {
            mercado_id: semPrefixo(b.mercado),
            nome: b.nome,
            tipo: b.tipo,
            ...(b.etiqueta === undefined
              ? {}
              : { etiqueta_id: semPrefixo(b.etiqueta) }),
            ...(b.prioridade === undefined ? {} : { prioridade: b.prioridade }),
          });
          return paraLista(await obterLista(trx, c.comercianteId, id));
        }),
      ),
  );

  for (const [caminho, estado, texto] of [
    ["archive", "arquivada", "Arquiva a lista (os preços ficam no histórico)"],
    ["restore", "activa", "Repõe a lista"],
  ] as const) {
    rotas.post(
      `/price-lists/:id/${caminho}`,
      {
        config: escrita,
        schema: {
          description: `${texto}, na versão lida (docs/20 §4.2).`,
          headers: CabecalhoIdempotencia,
          params: ParametroId(IdLista),
          body: PedidoVersao,
          response: { 200: ListaPrecos, ...RESPOSTA_DE_ERRO },
        },
      },
      (pedido, resposta) =>
        escrever(base, pedido, resposta, 200, (trx, c) =>
          emPrecos(resposta, async () => {
            const id = semPrefixo(pedido.params.id);
            await mudarEstadoLista(
              trx,
              c.comercianteId,
              id,
              pedido.body.versao,
              estado,
            );
            return paraLista(await obterLista(trx, c.comercianteId, id));
          }),
        ),
    );
  }

  // ---- Preços

  /** O preço como a API o mostra, com a redução em vigor e o preço por unidade. */
  async function precoNa(
    db: Kysely<BaseDados>,
    comercianteId: string,
    listaId: string,
    varianteId: string,
  ) {
    const lista = await obterLista(db, comercianteId, listaId);
    const mercado = await obterMercado(db, comercianteId, lista.mercado_id);
    const pagina = await precosDaListaComReducoes(
      db,
      comercianteId,
      listaId,
      1,
      null,
      varianteId,
    );
    const p = pagina.dados[0];
    if (p === undefined) {
      throw new ErroPrecos(
        "prices.not_found",
        "a variante não tem preço nesta lista",
      );
    }
    return paraPreco(p, mercado.preco_inclui_iva, new Date());
  }

  rotas.get(
    "/price-lists/:id/prices",
    {
      config: ler,
      schema: {
        description:
          "Os preços da lista, por variante, com a redução em vigor (o preço reduzido e o de referência) e o preço por unidade (docs/20 §3.7, §10.3), no formato das listas.",
        params: ParametroId(IdLista),
        querystring: ConsultaPagina,
        response: { 200: Lista(PrecoEsquema), ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const { comercianteId } = chaveDo(pedido);
      const listaId = semPrefixo(pedido.params.id);
      return emPrecos(resposta, async () => {
        const lista = await obterLista(base, comercianteId, listaId);
        const mercado = await obterMercado(
          base,
          comercianteId,
          lista.mercado_id,
        );
        const agora = new Date();
        return comPagina(
          await precosDaListaComReducoes(
            base,
            comercianteId,
            listaId,
            limiteDe(pedido.query),
            idDoCursor(pedido.query.cursor),
          ),
          (p) => paraPreco(p, mercado.preco_inclui_iva, agora),
        );
      });
    },
  );

  rotas.get(
    "/products/:id/prices",
    {
      config: ler,
      schema: {
        description:
          "Os preços de um artigo (docs/22 §17.2): as listas activas, por ordem de criação e por páginas, cada uma com o mercado (moeda e se os montantes incluem IVA) e os preços das variantes do artigo, com a redução em vigor e o preço por unidade, como em GET /price-lists/{id}/prices.",
        params: ParametroArtigo,
        querystring: ConsultaPagina,
        response: { 200: RespostaPrecosDoArtigo, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      precosDoArtigoApi(
        base,
        chaveDo(pedido).comercianteId,
        pedido.params.id,
        pedido.query,
        resposta,
      ),
  );

  rotas.put(
    "/price-lists/:id/prices/:variante",
    {
      config: escrita,
      schema: {
        description:
          "Define o preço de uma variante na lista (docs/20 §3.4): cria-o ou substitui-o; uma linha nova no histórico quando o montante ou o «gratuito» mudam. 0 só com «gratuito» (R4). Com uma redução em vigor, o preço não muda (prices.reduction_active).",
        headers: CabecalhoIdempotencia,
        params: ParametroPreco,
        body: PedidoPreco,
        response: { 200: PrecoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emPrecos(resposta, async () => {
          const listaId = semPrefixo(pedido.params.id);
          const varianteId = semPrefixo(pedido.params.variante);
          await definirPreco(
            trx,
            c.comercianteId,
            quemDa(c),
            listaId,
            varianteId,
            pedido.body,
          );
          return precoNa(trx, c.comercianteId, listaId, varianteId);
        }),
      ),
  );

  rotas.delete(
    "/price-lists/:id/prices/:variante",
    {
      config: escrita,
      schema: {
        description:
          "Tira o preço da variante da lista (fica no histórico, com a saída). O preço de uma variante publicada não sai da lista de base (prices.published_variant); com uma redução em vigor, também não.",
        headers: CabecalhoIdempotencia,
        params: ParametroPreco,
        response: {
          204: Type.Null({ description: "Tirado; sem corpo" }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 204, (trx, c) =>
        emPrecos(resposta, async () => {
          const tirou = await tirarPreco(
            trx,
            c.comercianteId,
            quemDa(c),
            semPrefixo(pedido.params.id),
            semPrefixo(pedido.params.variante),
          );
          if (!tirou) {
            throw new ErroPrecos(
              "prices.not_found",
              "a variante não tem preço nesta lista",
            );
          }
          return null;
        }),
      ),
  );

  rotas.get(
    "/price-lists/:id/prices/:variante/history",
    {
      config: ler,
      schema: {
        description:
          "O histórico do preço da variante na lista, do mais antigo ao mais recente (docs/20 §3.5), e as reduções que teve: a prova do que se mostrou.",
        params: ParametroPreco,
        response: { 200: Historico, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) => {
      const { comercianteId } = chaveDo(pedido);
      const listaId = semPrefixo(pedido.params.id);
      const varianteId = semPrefixo(pedido.params.variante);
      return emPrecos(resposta, async () => {
        await obterLista(base, comercianteId, listaId);
        const linhas = await historicoDoPreco(
          base,
          comercianteId,
          listaId,
          varianteId,
        );
        const reducoes = await reducoesDoPreco(
          base,
          comercianteId,
          listaId,
          varianteId,
        );
        if (linhas.length === 0) {
          throw new ErroPrecos(
            "prices.not_found",
            "a variante nunca teve preço nesta lista",
          );
        }
        const agora = new Date();
        return {
          linhas: linhas.map((l) => ({
            montante: l.montante,
            gratuito: l.gratuito,
            saiu: l.saiu,
            moeda: l.moeda,
            preco_inclui_iva: l.preco_inclui_iva,
            em_vigor_desde: l.em_vigor_desde.toISOString(),
          })),
          reducoes: reducoes.map((r) => paraReducao(r, agora)),
        };
      });
    },
  );

  // ---- Reduções

  rotas.put(
    "/price-lists/:id/prices/:variante/reduction",
    {
      config: escrita,
      schema: {
        description:
          "Anuncia uma redução (o preço riscado, docs/20 §3.6 e §10.2), a começar já, com fim opcional. O preço de referência calcula-o o servidor: o mais baixo praticado nos 30 dias antes. Sem 30 dias seguidos de preço nesta lista, 422 prices.reduction_without_history; um preço reduzido igual ou acima do de referência, 422 prices.reduction_not_lower; com outra em vigor, 409 prices.reduction_active.",
        headers: CabecalhoIdempotencia,
        params: ParametroPreco,
        body: PedidoReducao,
        response: { 200: PrecoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emPrecos(resposta, async () => {
          const listaId = semPrefixo(pedido.params.id);
          const varianteId = semPrefixo(pedido.params.variante);
          const fim = pedido.body.fim;
          await anunciarReducao(
            trx,
            c.comercianteId,
            quemDa(c),
            listaId,
            varianteId,
            {
              montante: pedido.body.montante,
              fim: fim === undefined || fim === null ? null : new Date(fim),
            },
          );
          return precoNa(trx, c.comercianteId, listaId, varianteId);
        }),
      ),
  );

  rotas.delete(
    "/price-lists/:id/prices/:variante/reduction",
    {
      config: escrita,
      schema: {
        description:
          "Tira a redução em vigor (fica no histórico, com quem e quando). Sem nenhuma em vigor, 404.",
        headers: CabecalhoIdempotencia,
        params: ParametroPreco,
        response: { 200: PrecoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emPrecos(resposta, async () => {
          const listaId = semPrefixo(pedido.params.id);
          const varianteId = semPrefixo(pedido.params.variante);
          await tirarReducao(
            trx,
            c.comercianteId,
            quemDa(c),
            listaId,
            varianteId,
          );
          return precoNa(trx, c.comercianteId, listaId, varianteId);
        }),
      ),
  );
}

function paraPreco(
  p: PrecoDaLista,
  incluiIva: boolean,
  agora: Date,
): Static<typeof PrecoEsquema> {
  // A base já só devolve a redução em vigor no relógio dela: não se volta a
  // filtrar com o relógio da API (revisão do #224, P3-6).
  const emVigorAgora = p.reducao;
  const aMostrar = emVigorAgora?.montante ?? p.montante;
  const unidade = precoPorUnidade(
    aMostrar,
    p.conteudo_quantidade,
    p.conteudo_unidade,
  );
  return {
    variante: `var_${p.variante_id}`,
    montante: p.montante,
    gratuito: p.gratuito,
    quantidade_minima: p.quantidade_minima,
    multiplo: p.multiplo,
    definido_em: p.definido_em.toISOString(),
    reducao:
      emVigorAgora === null
        ? null
        : { ...paraReducao(emVigorAgora, agora), em_vigor: true },
    preco_por_unidade:
      unidade === null ? null : { ...unidade, inclui_iva: incluiIva },
  };
}
