import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { escrever, idCom, Instante, semPrefixo } from "../catalogo/rotas.js";
import { chaveDo } from "../identidade/autenticacao.js";
import { CabecalhoIdempotencia } from "../identidade/rotas.js";
import {
  decidirIva,
  MOTIVOS_DE_BLOQUEIO,
  NATUREZAS_IVA,
  type Decisao,
} from "./decisao.js";
import { ErroIva, type CodigoErroIva } from "./erros.js";
import {
  carregarTabelas,
  comercianteParaDecisao,
  declararRegime,
  listarCategorias,
  listarMotivos,
  listarRegistos,
  listarTaxas,
  listarTerritorios,
  perfilParaDecisao,
  traduzir,
} from "./repositorio.js";

// A API do Motor de IVA (docs/24 §8; issue #255; Diogo, 09/10/2026: «sim,
// aprovo; avança com o código da fatia 6»). As tabelas globais só se lêem;
// o regime de cada entidade legal declara-o o dono; a simulação corre a
// decisão sem gravar (o checkout chama a função por dentro, fatia 7).

const ESTADO_DO_CODIGO: Record<CodigoErroIva, number> = {
  "tax.not_found": 404,
  "tax.invalid_field": 400,
  "tax.retry": 503,
  "tax.declaration_by_person": 422,
  "tax.invalid_registration": 422,
};

function paraApi(erro: unknown, resposta: FastifyReply): unknown {
  const e = traduzir(erro);
  if (!(e instanceof ErroIva)) return e;
  if (e.codigo === "tax.retry") void resposta.header("Retry-After", "1");
  const mensagens =
    e.codigo === "tax.not_found"
      ? { pt: "Não encontrado", en: "Not found" }
      : { pt: "Pedido recusado pelo Motor de IVA", en: "Rejected by tax" };
  const daBase =
    typeof (e.cause as { code?: unknown } | undefined)?.code === "string" &&
    !e.message.startsWith(`${e.codigo}:`);
  return new ErroApi(
    e.codigo,
    ESTADO_DO_CODIGO[e.codigo],
    mensagens,
    daBase ? "um valor do pedido não é aceite" : e.message,
  );
}

async function emIva<T>(resposta: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (erro) {
    throw paraApi(erro, resposta);
  }
}

const Pais = Type.String({ pattern: "^[A-Z]{2}$" });
const IdEntidade = idCom("lgl", "lgl_…");
const IdPerfil = idCom("bpf", "bpf_…");
const Dia = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const dia = (d: Date | string | null) =>
  d === null
    ? null
    : typeof d === "string"
      ? d.slice(0, 10)
      : d.toISOString().slice(0, 10);

const Categoria = Type.Object({
  codigo: Type.String(),
  descricao: Type.Object({ pt: Type.String(), en: Type.String() }),
  estado: Type.String(),
});
const TaxaEsquema = Type.Object({
  id: Type.String({ description: "vat_…" }),
  pais: Type.String(),
  regiao: Type.Union([Type.String(), Type.Null()]),
  categoria: Type.String(),
  tipo: Type.String(),
  percentagem: Type.Union([Type.Integer(), Type.Null()], {
    description: "Em centésimas de ponto: 2300 = 23 %",
  }),
  codigo_motivo: Type.Union([Type.String(), Type.Null()]),
  inicio: Dia,
  fonte: Type.String(),
  verificado: Type.Boolean({
    description:
      "Validada pelo contabilista do país; falso é C (docs/24 §3.3) e não chega a produção",
  }),
});
const TerritorioEsquema = Type.Object({
  pais: Type.String(),
  prefixo_cp: Type.String(),
  efeito: Type.String(),
  regiao: Type.Union([Type.String(), Type.Null()]),
  nome: Type.String(),
  fonte: Type.String(),
});
const MotivoEsquema = Type.Object({
  pais: Type.String(),
  codigo: Type.String(),
  tipo: Type.String(),
  descricao: Type.String(),
  fonte: Type.String(),
});
const Registo = Type.Object(
  {
    pais: Pais,
    numero: Type.String({ pattern: "^[A-Z0-9]{2,20}$" }),
    desde: Type.Optional(Dia),
  },
  { additionalProperties: false },
);
const RegistoFiscal = Type.Object({
  entidade_legal: Type.String({ description: "lgl_…" }),
  denominacao: Type.String(),
  pais: Type.String(),
  regime: Type.Union([
    Type.Literal("origem"),
    Type.Literal("destino"),
    Type.Literal("por_declarar"),
  ]),
  oss_desde: Type.Union([Dia, Type.Null()]),
  registos: Type.Array(Type.Unknown()),
  declarado_por: Type.Union([Type.String(), Type.Null()]),
  declarado_em: Type.Union([Instante, Type.Null()]),
});
const PedidoRegime = Type.Object(
  {
    regime: Type.Union([Type.Literal("origem"), Type.Literal("destino")], {
      description:
        "origem: abaixo do limiar de 10.000 € e sem optar (a taxa do país do comerciante); destino: OSS ou registo em cada país (a taxa do país de entrega)",
    }),
    oss_desde: Type.Optional(Type.Union([Dia, Type.Null()])),
    registos: Type.Optional(Type.Array(Registo, { maxItems: 30 })),
  },
  { additionalProperties: false },
);

const PedidoSimulacao = Type.Object(
  {
    entidade_legal: IdEntidade,
    categoria: Type.String({ pattern: "^[a-z][a-z0-9_]*$" }),
    natureza: Type.Unsafe<(typeof NATUREZAS_IVA)[number]>({
      type: "string",
      enum: [...NATUREZAS_IVA],
    }),
    local_prestacao: Type.Optional(Type.Union([Pais, Type.Null()])),
    montante: Type.Integer({ minimum: 0, maximum: 100_000_000_000 }),
    preco_inclui_iva: Type.Boolean(),
    entrega: Type.Optional(
      Type.Union([
        Type.Object(
          {
            pais: Pais,
            codigo_postal: Type.Optional(
              Type.Union([Type.String({ maxLength: 20 }), Type.Null()]),
            ),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
    ),
    finalidade: Type.Union([
      Type.Literal("consumo"),
      Type.Literal("profissional"),
      Type.Literal("revenda"),
    ]),
    perfil: Type.Optional(Type.Union([IdPerfil, Type.Null()])),
    momento: Type.Optional(Instante),
  },
  { additionalProperties: false },
);
const DecisaoEsquema = Type.Object({
  resultado: Type.Union([
    Type.Literal("tributada"),
    Type.Literal("isenta"),
    Type.Literal("bloqueada"),
  ]),
  motivo_bloqueio: Type.Union([
    Type.Unsafe<string>({ type: "string", enum: [...MOTIVOS_DE_BLOQUEIO] }),
    Type.Null(),
  ]),
  pais_imposto: Type.Union([Type.String(), Type.Null()]),
  regiao: Type.Union([Type.String(), Type.Null()]),
  taxa: Type.Union([Type.Integer(), Type.Null()]),
  codigo_motivo: Type.Union([Type.String(), Type.Null()]),
  base: Type.Union([Type.Integer(), Type.Null()]),
  iva: Type.Union([Type.Integer(), Type.Null()]),
  total: Type.Union([Type.Integer(), Type.Null()]),
  regra: Type.String(),
  versao_regras: Type.String(),
  evidencia: Type.Record(Type.String(), Type.Unknown()),
});
const paraDecisao = (d: Decisao) =>
  d.resultado === "bloqueada"
    ? {
        resultado: d.resultado,
        motivo_bloqueio: d.motivo,
        pais_imposto: null,
        regiao: null,
        taxa: null,
        codigo_motivo: null,
        base: null,
        iva: null,
        total: null,
        regra: d.regra,
        versao_regras: d.versao_regras,
        evidencia: { ...d.evidencia },
      }
    : {
        resultado: d.resultado,
        motivo_bloqueio: null,
        pais_imposto: d.pais_imposto,
        regiao: d.regiao,
        taxa: d.taxa,
        codigo_motivo: d.codigo_motivo,
        base: d.base,
        iva: d.iva,
        total: d.total,
        regra: d.regra,
        versao_regras: d.versao_regras,
        evidencia: { ...d.evidencia },
      };

export function rotasDoIva(
  instancia: FastifyInstance,
  base: Kysely<BaseDados>,
) {
  const rotas = instancia.withTypeProvider<TypeBoxTypeProvider>();
  const ler = { ambito: "tax:read" as const };
  const escrita = { ambito: "tax:write" as const };

  rotas.get(
    "/tax/categories",
    {
      config: ler,
      schema: {
        description:
          "As categorias fiscais do Motor de IVA (docs/24 §3.1): a lista que o artigo usa. Na Fase 1, só «normal».",
        response: {
          200: Type.Object({ dados: Type.Array(Categoria) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async () => ({
      dados: (await listarCategorias(base)).map((c) => ({
        codigo: c.codigo,
        descricao: { pt: c.descricao_pt, en: c.descricao_en },
        estado: c.estado,
      })),
    }),
  );

  rotas.get(
    "/tax/rates",
    {
      config: ler,
      schema: {
        description:
          "As taxas com vigência e a fonte de cada uma (docs/24 §3.3). As «verificado: false» são C: não chegam a produção sem o contabilista.",
        querystring: Type.Object(
          {
            pais: Type.Optional(Pais),
            categoria: Type.Optional(Type.String({ maxLength: 50 })),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ dados: Type.Array(TaxaEsquema) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido) => ({
      dados: (await listarTaxas(base, pedido.query)).map((t) => ({
        id: `vat_${t.id}`,
        pais: t.pais,
        regiao: t.regiao,
        categoria: t.categoria,
        tipo: t.tipo,
        percentagem: t.percentagem,
        codigo_motivo: t.codigo_motivo,
        inicio: dia(t.inicio) ?? "",
        fonte: t.fonte,
        verificado: t.verificado,
      })),
    }),
  );

  rotas.get(
    "/tax/territories",
    {
      config: ler,
      schema: {
        description:
          "Os territórios especiais pelo prefixo do código postal da entrega (docs/24 §3.4).",
        response: {
          200: Type.Object({ dados: Type.Array(TerritorioEsquema) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async () => ({
      dados: (await listarTerritorios(base)).map((t) => ({
        pais: t.pais,
        prefixo_cp: t.prefixo_cp,
        efeito: t.efeito,
        regiao: t.regiao,
        nome: t.nome,
        fonte: t.fonte,
      })),
    }),
  );

  rotas.get(
    "/tax/reasons",
    {
      config: ler,
      schema: {
        description:
          "Os códigos de motivo de isenção por país do emissor (docs/24 §3.6); a isenção manual escolhe um destes (Q4).",
        querystring: Type.Object(
          { pais: Type.Optional(Pais) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ dados: Type.Array(MotivoEsquema) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido) => ({
      dados: await listarMotivos(base, pedido.query.pais),
    }),
  );

  rotas.get(
    "/tax/registrations",
    {
      config: ler,
      schema: {
        description:
          "O regime das vendas à distância de cada entidade legal do comerciante (docs/24 §3.5); sem declaração, «por_declarar» (Q2: as vendas a consumidores de outros países da UE ficam bloqueadas).",
        response: {
          200: Type.Object({ dados: Type.Array(RegistoFiscal) }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) => ({
      dados: (
        await emIva(resposta, () =>
          listarRegistos(base, chaveDo(pedido).comercianteId),
        )
      ).map((e) => ({
        entidade_legal: `lgl_${e.id}`,
        denominacao: e.denominacao,
        pais: e.pais,
        regime: e.declaracao?.regime ?? "por_declarar",
        oss_desde: dia(e.declaracao?.oss_desde ?? null),
        registos: (e.declaracao?.registos as unknown[] | undefined) ?? [],
        declarado_por: e.declaracao?.declarado_por ?? null,
        declarado_em: e.declaracao?.declarado_em.toISOString() ?? null,
      })),
    }),
  );

  rotas.put(
    "/tax/registrations/:id",
    {
      config: escrita,
      schema: {
        description:
          "Declara o regime da entidade legal (só o dono, tax:write). Cada declaração fica; a última vale para as decisões a partir daí.",
        headers: CabecalhoIdempotencia,
        params: Type.Object({ id: IdEntidade }),
        body: PedidoRegime,
        response: {
          200: Type.Object({
            entidade_legal: Type.String(),
            regime: Type.String(),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, c) =>
        emIva(resposta, async () => {
          await declararRegime(
            trx,
            c.comercianteId,
            semPrefixo(pedido.params.id),
            {
              regime: pedido.body.regime,
              oss_desde: pedido.body.oss_desde ?? null,
              registos: pedido.body.registos ?? [],
            },
          );
          return {
            entidade_legal: pedido.params.id,
            regime: pedido.body.regime,
          };
        }),
      ),
  );

  rotas.post(
    "/tax/decisions/simulate",
    {
      config: ler,
      schema: {
        description:
          "Corre a decisão de IVA de uma linha (docs/24 §5), sem gravar: o resultado (tributada, isenta, bloqueada com o motivo), a taxa, o motivo, a base, o IVA e o total em cêntimos, a regra e a evidência. Não é a decisão de uma encomenda.",
        body: PedidoSimulacao,
        response: { 200: DecisaoEsquema, ...RESPOSTA_DE_ERRO },
      },
    },
    async (pedido, resposta) =>
      emIva(resposta, async () => {
        const c = chaveDo(pedido).comercianteId;
        const b = pedido.body;
        const [tabelas, comerciante, perfil] = await Promise.all([
          carregarTabelas(base),
          comercianteParaDecisao(base, c, semPrefixo(b.entidade_legal)),
          b.perfil === undefined || b.perfil === null
            ? Promise.resolve(null)
            : perfilParaDecisao(base, c, semPrefixo(b.perfil)),
        ]);
        return paraDecisao(
          decidirIva(tabelas, {
            momento: b.momento === undefined ? new Date() : new Date(b.momento),
            comerciante,
            linha: {
              categoria: b.categoria,
              natureza: b.natureza,
              local_prestacao: b.local_prestacao ?? null,
              montante: b.montante,
              preco_inclui_iva: b.preco_inclui_iva,
            },
            entrega:
              b.entrega === undefined || b.entrega === null
                ? null
                : {
                    pais: b.entrega.pais,
                    codigo_postal: b.entrega.codigo_postal ?? null,
                  },
            finalidade: b.finalidade,
            perfil,
          }),
        );
      }),
  );
}
