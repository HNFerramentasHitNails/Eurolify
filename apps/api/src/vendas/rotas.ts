import type { FastifyInstance, FastifyRequest } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Kysely } from "kysely";
import { Type } from "typebox";
import { erroBase, RESPOSTA_DE_ERRO } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { idCom, Instante, semPrefixo } from "../catalogo/rotas.js";
import { chaveDo, sessaoDo } from "../identidade/autenticacao.js";
import { erroConta } from "../identidade/sessoes.js";
import {
  PeriodoNoFuturo,
  vendas,
  type Linha,
  type Numero,
  type Vendas,
} from "./repositorio.js";

// As vendas do dia e do mês (docs/35 §5; decisão DY; issue #367): uma
// consulta, dois clientes — a API (para o MCP de leitura, peça 12) e o Hub
// (o painel, Fase 2) — com a mesma função e a mesma resposta.

const Texto = Type.Object({ pt: Type.String(), en: Type.String() });

const CamposDoNumero = {
  com_iva: Type.Integer({ description: "Em cêntimos, com IVA" }),
  sem_iva: Type.Integer({
    description:
      "Em cêntimos, sem IVA, lido do que o domínio guardou (nunca recalculado); sem os de `sem_iva_por_conhecer`",
  }),
  quantidade: Type.Integer(),
  sem_iva_por_conhecer: Type.Optional(
    Type.Object(
      { quantidade: Type.Integer(), com_iva: Type.Integer() },
      {
        description:
          "Os que contam no com IVA mas cujo sem IVA não se sabe (docs/35 §3): nunca se estima",
      },
    ),
  ),
};
const NumeroSimples = Type.Object(CamposDoNumero);
const NumeroComFrase = Type.Object({
  ...CamposDoNumero,
  o_que_conta: Texto,
});

const Bloco = Type.Object({
  encomendado: Type.Object({
    ...NumeroComFrase.properties,
    das_quais_canceladas: NumeroSimples,
  }),
  pago: NumeroComFrase,
  faturado: Type.Object({
    ...NumeroComFrase.properties,
    creditado: NumeroSimples,
  }),
  devolvido: NumeroComFrase,
});

export const RespostaVendas = Type.Object({
  periodo: Type.Object({
    de: Instante,
    ate: Instante,
    fuso: Type.String({ description: "O fuso do comerciante (IANA)" }),
    completo: Type.Boolean({
      description: "Falso num período que ainda não acabou: `ate` é agora",
    }),
  }),
  modo: Type.Literal("teste", {
    description:
      "Só há pagamentos e documentos em modo de teste; o real nunca se somará ao de teste",
  }),
  moedas: Type.Array(
    Type.Object({
      moeda: Type.String({ description: "ISO 4217; nunca se somam moedas" }),
      total: Bloco,
      por_canal_e_mercado: Type.Array(
        Type.Object({
          canal: Type.String({ description: "chn_…" }),
          mercado: Type.String({ description: "mkt_…" }),
          ...Bloco.properties,
        }),
      ),
    }),
  ),
});

export const ConsultaVendas = Type.Object(
  {
    dia: Type.Optional(
      Type.String({
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description:
          "AAAA-MM-DD: o dia, das 00:00 às 24:00 no fuso do comerciante",
      }),
    ),
    mes: Type.Optional(
      Type.String({
        pattern: "^\\d{4}-\\d{2}$",
        description: "AAAA-MM: o mês, no fuso do comerciante",
      }),
    ),
    canal: Type.Optional(idCom("chn", "chn_…")),
    mercado: Type.Optional(idCom("mkt", "mkt_…")),
  },
  { additionalProperties: false },
);

interface Consulta {
  dia?: string;
  mes?: string;
  canal?: string;
  mercado?: string;
}

/** Do pedido ao período [inicio, fim) em datas locais; recusa o inválido. */
export function periodoDe(q: Consulta): { inicio: string; fim: string } {
  if ((q.dia === undefined) === (q.mes === undefined)) {
    throw erroBase("request.invalid", "peça `dia` ou `mes`, um dos dois");
  }
  const texto = q.dia ?? `${q.mes ?? ""}-01`;
  const d = new Date(`${texto}T00:00:00Z`);
  // De 1970 a 9998: fora disto, a base não lê a data ou o fim passa a ter
  // cinco algarismos (revisão do #383, P3-2).
  const ano = Number(texto.slice(0, 4));
  if (
    ano < 1970 ||
    ano > 9998 ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== texto
  ) {
    throw erroBase("request.invalid", "data inválida");
  }
  const fim = new Date(d);
  if (q.dia !== undefined) fim.setUTCDate(fim.getUTCDate() + 1);
  else fim.setUTCMonth(fim.getUTCMonth() + 1);
  return { inicio: texto, fim: fim.toISOString().slice(0, 10) };
}

function quando(d: Date, fuso: string, lingua: "pt" | "en"): string {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return lingua === "pt"
    ? `${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}`
    : `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}`;
}

/** As frases do que conta cada número (docs/35 §1), no período pedido. */
function frases(v: Vendas) {
  const pt = `entre ${quando(v.de, v.fuso, "pt")} e ${quando(v.ate, v.fuso, "pt")}${v.completo ? "" : " (agora)"} (${v.fuso})`;
  const en = `between ${quando(v.de, v.fuso, "en")} and ${quando(v.ate, v.fuso, "en")}${v.completo ? "" : " (now)"} (${v.fuso})`;
  const proprio = v.sistemaProprio
    ? {
        pt: " Há encomendas deste período faturadas pelo sistema próprio do comerciante; o Eurolify não conta essas faturas.",
        en: " Some orders in this period are invoiced by the merchant's own system; Eurolify does not count those invoices.",
      }
    : { pt: "", en: "" };
  return {
    encomendado: {
      pt: `Encomendas criadas ${pt}, em qualquer estado; as que depois se cancelaram também em «das quais canceladas».`,
      en: `Orders placed ${en}, in any state; those later cancelled also in "das quais canceladas".`,
    },
    pago: {
      pt: `Pagamentos capturados ${pt}.`,
      en: `Payments captured ${en}.`,
    },
    faturado: {
      pt: `Faturas emitidas pelo Eurolify ${pt}; as notas de crédito em «creditado».${proprio.pt}`,
      en: `Invoices issued by Eurolify ${en}; credit notes in "creditado".${proprio.en}`,
    },
    devolvido: {
      pt: `Reembolsos executados ${pt}. O sem IVA de um reembolso entra quando a nota de crédito dele sai.`,
      en: `Refunds completed ${en}. A refund's amount without VAT counts once its credit note is issued.`,
    },
  };
}

const paraNumero = (n: Numero) => ({
  com_iva: n.comIva,
  sem_iva: n.semIva,
  quantidade: n.quantidade,
  ...(n.semIvaPorConhecer === undefined
    ? {}
    : {
        sem_iva_por_conhecer: {
          quantidade: n.semIvaPorConhecer.quantidade,
          com_iva: n.semIvaPorConhecer.comIva,
        },
      }),
});

function somar(a: Numero, b: Numero): Numero {
  const s: Numero = {
    comIva: a.comIva + b.comIva,
    semIva: a.semIva + b.semIva,
    quantidade: a.quantidade + b.quantidade,
  };
  const qa = a.semIvaPorConhecer;
  const qb = b.semIvaPorConhecer;
  if (qa !== undefined || qb !== undefined) {
    s.semIvaPorConhecer = {
      quantidade: (qa?.quantidade ?? 0) + (qb?.quantidade ?? 0),
      comIva: (qa?.comIva ?? 0) + (qb?.comIva ?? 0),
    };
  }
  return s;
}

const vazio = (): Numero => ({ comIva: 0, semIva: 0, quantidade: 0 });

function bloco(
  l: Omit<Linha, "moeda" | "canalId" | "mercadoId">,
  f: ReturnType<typeof frases>,
) {
  return {
    encomendado: {
      ...paraNumero(l.encomendado),
      o_que_conta: f.encomendado,
      das_quais_canceladas: paraNumero(l.encomendado.dasQuaisCanceladas),
    },
    pago: { ...paraNumero(l.pago), o_que_conta: f.pago },
    faturado: {
      ...paraNumero(l.faturado),
      o_que_conta: f.faturado,
      creditado: paraNumero(l.faturado.creditado),
    },
    devolvido: { ...paraNumero(l.devolvido), o_que_conta: f.devolvido },
  };
}

export function paraResposta(v: Vendas) {
  const f = frases(v);
  const moedas = [...new Set(v.linhas.map((l) => l.moeda))].sort();
  return {
    periodo: {
      de: v.de.toISOString(),
      ate: v.ate.toISOString(),
      fuso: v.fuso,
      completo: v.completo,
    },
    modo: "teste" as const,
    moedas: moedas.map((moeda) => {
      const daMoeda = v.linhas.filter((l) => l.moeda === moeda);
      const total = daMoeda.reduce(
        (t, l) => ({
          encomendado: {
            ...somar(t.encomendado, l.encomendado),
            dasQuaisCanceladas: somar(
              t.encomendado.dasQuaisCanceladas,
              l.encomendado.dasQuaisCanceladas,
            ),
          },
          pago: somar(t.pago, l.pago),
          faturado: {
            ...somar(t.faturado, l.faturado),
            creditado: somar(t.faturado.creditado, l.faturado.creditado),
          },
          devolvido: somar(t.devolvido, l.devolvido),
        }),
        {
          encomendado: { ...vazio(), dasQuaisCanceladas: vazio() },
          pago: vazio(),
          faturado: { ...vazio(), creditado: vazio() },
          devolvido: vazio(),
        },
      );
      return {
        moeda,
        total: bloco(total, f),
        por_canal_e_mercado: daMoeda.map((l) => ({
          canal: `chn_${l.canalId}`,
          mercado: `mkt_${l.mercadoId}`,
          ...bloco(l, f),
        })),
      };
    }),
  };
}

async function responder(
  base: Kysely<BaseDados>,
  comercianteId: string,
  q: Consulta,
) {
  const { inicio, fim } = periodoDe(q);
  try {
    return paraResposta(
      await vendas(base, comercianteId, {
        inicio,
        fim,
        ...(q.canal === undefined ? {} : { canalId: semPrefixo(q.canal) }),
        ...(q.mercado === undefined
          ? {}
          : { mercadoId: semPrefixo(q.mercado) }),
      }),
    );
  } catch (erro) {
    if (erro instanceof PeriodoNoFuturo) {
      throw erroBase("request.invalid", "o período ainda não começou");
    }
    throw erro;
  }
}

const DESCRICAO =
  "As vendas do dia ou do mês (docs/35): encomendado, pago, faturado e devolvido, cada um com e sem IVA, por moeda, canal e mercado, no fuso do comerciante, com a frase do que conta cada número. O IVA lê-se do que ficou guardado; o que não se sabe vem em `sem_iva_por_conhecer`, nunca estimado. Moedas diferentes nunca se somam.";

export function rotasDasVendas(
  app: FastifyInstance,
  base: Kysely<BaseDados>,
): void {
  const rotas = app.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    "/sales/summary",
    {
      config: { ambito: "sales:read" },
      schema: {
        description: DESCRICAO,
        querystring: ConsultaVendas,
        response: { 200: RespostaVendas, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido) => responder(base, chaveDo(pedido).comercianteId, pedido.query),
  );
}

/** A mesma consulta no Hub, com a sessão (só existe com o Hub ligado). */
export function rotasDasVendasNoHub(
  app: FastifyInstance,
  base: Kysely<BaseDados>,
): void {
  const rotas = app.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    "/hub/sales/summary",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description: `${DESCRICAO} No Hub: o dono e o gestor (sales:read).`,
        querystring: ConsultaVendas,
        response: { 200: RespostaVendas, ...RESPOSTA_DE_ERRO },
      },
    },
    (pedido: FastifyRequest<{ Querystring: Consulta }>) => {
      const sessao = sessaoDo(pedido);
      if (!sessao.ambitos.includes("sales:read")) {
        throw erroConta("member.role_escalation", "o papel não vê as vendas");
      }
      return responder(base, sessao.comercianteId ?? "", pedido.query);
    },
  );
}
