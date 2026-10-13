import type { FilaTarefa, TipoNotificacao } from "../base/esquema.js";
import { FILAS } from "../tarefas/filas.js";
import type { Mensagem } from "./correio.js";

// Os textos das notificações (docs/34, N3 e N4): PT, ES e EN, texto simples.
// Só identificadores, datas e números: nenhum dado do cliente. A data em
// dd/mm/aaaa em PT e ES; em EN, aaaa-mm-dd (sem a dúvida dia/mês).

type Lingua = "pt" | "es" | "en";

export interface DadosDoAviso {
  /** O nome do comerciante (uma pessoa pode ser da equipa de várias). */
  loja?: string;
  devolucao: string;
  encomenda: string;
  reembolsar_ate: string | null;
  dias: number | null;
}

/** O aviso de um caso vencido das tarefas (docs/34 §12, T4; migração 0071). */
export interface DadosDaTarefa {
  loja?: string;
  fila: FilaTarefa;
  caso: string;
  /** O motivo da fila (código da lista dela), nunca texto livre. */
  motivo: string | null;
  /** AAAA-MM-DD HH:MI, no fuso do comerciante. */
  prazo: string | null;
  /** Quando saiu o aviso, AAAA-MM-DD HH:MI, no fuso do comerciante. */
  avisado_em?: string | null;
  fuso: string | null;
}

/**
 * O aviso da ligação ao software de faturação com erro (docs/29 §18, Q1 A;
 * migração 0083).
 */
export interface DadosDaLigacao {
  loja?: string;
  /** O nome da entidade legal do comerciante (a empresa, não um cliente). */
  entidade?: string;
  ligacao: string;
  adaptador: string;
  /** Um código: `renovacao_recusada`. */
  motivo: string | null;
  /** As faturas retidas por `ligacao_sem_teste` nessa entidade. */
  retidas: number;
  /** AAAA-MM-DD HH:MI, no fuso do comerciante. */
  desde: string | null;
  fuso: string | null;
}

type TipoDoReembolso = Exclude<
  TipoNotificacao,
  "task.overdue" | "invoicing.connection_error"
>;

const data = (iso: string | null, l: Lingua) => {
  if (iso === null) return "?";
  const [a, m, d] = iso.split("-");
  return l === "en" ? iso : `${d ?? ""}/${m ?? ""}/${a ?? ""}`;
};

/**
 * Uma linha só, sem caracteres de controlo, cortada: o nome vem do
 * comerciante e o e-mail vai para endereços não confirmados (revisão do #373,
 * P2-3).
 */
const linha = (t: string | undefined) =>
  (t ?? "")
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

/** « (faltam 2 dias)», ou nada quando não se sabe. */
const faltam = (dias: number | null, l: Lingua): string => {
  if (dias === null || dias < 0) return "";
  const t = {
    pt: ["é hoje", "falta 1 dia", (n: number) => `faltam ${String(n)} dias`],
    es: ["es hoy", "queda 1 día", (n: number) => `quedan ${String(n)} días`],
    en: ["it is today", "1 day left", (n: number) => `${String(n)} days left`],
  } as const;
  const [hoje, um, varios] = t[l];
  return ` (${dias === 0 ? hoje : dias === 1 ? um : varios(dias)})`;
};

const TEXTOS: Record<
  Lingua,
  Record<
    TipoDoReembolso,
    (
      d: DadosDoAviso,
      loja: string,
      ids: { rma: string; ord: string },
    ) => Mensagem
  >
> = {
  pt: {
    "refund.deadline_approaching": (d, loja, ids) => ({
      para: "",
      assunto: `Livre resolução: reembolsar até ${data(d.reembolsar_ate, "pt")}`,
      texto: [
        "Olá,",
        "",
        `Na loja «${loja}», a devolução ${ids.rma} (encomenda ${ids.ord}) vem de um pedido de livre resolução e ainda não está reembolsada.`,
        `O último dia para reembolsar é ${data(d.reembolsar_ate, "pt")}${faltam(d.dias, "pt")}.`,
        "",
        "A lista das devoluções com o prazo a acabar: GET /returns?prazo_reembolso=a_acabar.",
        "",
        "Este aviso vai para os donos e os gestores da loja. Não leva dados do cliente.",
        "Eurolify",
      ].join("\n"),
    }),
    "refund.deadline_passed": (d, loja, ids) => ({
      para: "",
      assunto: `Livre resolução: o prazo do reembolso passou (${data(d.reembolsar_ate, "pt")})`,
      texto: [
        "Olá,",
        "",
        `Na loja «${loja}», a devolução ${ids.rma} (encomenda ${ids.ord}) vem de um pedido de livre resolução e ainda não está reembolsada.`,
        `O último dia para reembolsar era ${data(d.reembolsar_ate, "pt")}.`,
        "",
        "A lista das devoluções com o prazo passado: GET /returns?prazo_reembolso=passado.",
        "",
        "Este aviso vai para os donos e os gestores da loja. Não leva dados do cliente.",
        "Eurolify",
      ].join("\n"),
    }),
  },
  es: {
    "refund.deadline_approaching": (d, loja, ids) => ({
      para: "",
      assunto: `Desistimiento: reembolsar hasta el ${data(d.reembolsar_ate, "es")}`,
      texto: [
        "Hola:",
        "",
        `En la tienda «${loja}», la devolución ${ids.rma} (pedido ${ids.ord}) viene de una solicitud de desistimiento y aún no se ha reembolsado.`,
        `El último día para reembolsar es el ${data(d.reembolsar_ate, "es")}${faltam(d.dias, "es")}.`,
        "",
        "La lista de devoluciones con el plazo por vencer: GET /returns?prazo_reembolso=a_acabar.",
        "",
        "Este aviso se envía a los propietarios y gestores de la tienda. No incluye datos del cliente.",
        "Eurolify",
      ].join("\n"),
    }),
    "refund.deadline_passed": (d, loja, ids) => ({
      para: "",
      assunto: `Desistimiento: el plazo del reembolso ha vencido (${data(d.reembolsar_ate, "es")})`,
      texto: [
        "Hola:",
        "",
        `En la tienda «${loja}», la devolución ${ids.rma} (pedido ${ids.ord}) viene de una solicitud de desistimiento y aún no se ha reembolsado.`,
        `El último día para reembolsar era el ${data(d.reembolsar_ate, "es")}.`,
        "",
        "La lista de devoluciones con el plazo vencido: GET /returns?prazo_reembolso=passado.",
        "",
        "Este aviso se envía a los propietarios y gestores de la tienda. No incluye datos del cliente.",
        "Eurolify",
      ].join("\n"),
    }),
  },
  en: {
    "refund.deadline_approaching": (d, loja, ids) => ({
      para: "",
      assunto: `Withdrawal: refund by ${data(d.reembolsar_ate, "en")}`,
      texto: [
        "Hello,",
        "",
        `In the shop “${loja}”, return ${ids.rma} (order ${ids.ord}) comes from a withdrawal request and has not been refunded yet.`,
        `The last day to refund is ${data(d.reembolsar_ate, "en")}${faltam(d.dias, "en")}.`,
        "",
        "Returns with the deadline coming up: GET /returns?prazo_reembolso=a_acabar.",
        "",
        "This notice goes to the shop's owners and managers. It carries no customer data.",
        "Eurolify",
      ].join("\n"),
    }),
    "refund.deadline_passed": (d, loja, ids) => ({
      para: "",
      assunto: `Withdrawal: the refund deadline has passed (${data(d.reembolsar_ate, "en")})`,
      texto: [
        "Hello,",
        "",
        `In the shop “${loja}”, return ${ids.rma} (order ${ids.ord}) comes from a withdrawal request and has not been refunded yet.`,
        `The last day to refund was ${data(d.reembolsar_ate, "en")}.`,
        "",
        "Returns past the deadline: GET /returns?prazo_reembolso=passado.",
        "",
        "This notice goes to the shop's owners and managers. It carries no customer data.",
        "Eurolify",
      ].join("\n"),
    }),
  },
};

/** O nome de cada fila, na língua do Hub (docs/33 §1). */
const NOMES_DAS_FILAS: Record<Lingua, Record<FilaTarefa, string>> = {
  pt: {
    pagamento: "diferença de pagamento",
    documento_fiscal: "documento fiscal",
    duplicado_cliente: "possível cliente duplicado",
    prazo_reembolso: "prazo do reembolso",
    livre_resolucao: "pedido de livre resolução",
    problema: "problema numa encomenda",
    reembolso: "reembolso",
    ligacao_faturacao: "ligação ao software de faturação com erro",
  },
  es: {
    pagamento: "diferencia de pago",
    documento_fiscal: "documento fiscal",
    duplicado_cliente: "posible cliente duplicado",
    prazo_reembolso: "plazo del reembolso",
    livre_resolucao: "solicitud de desistimiento",
    problema: "incidencia en un pedido",
    reembolso: "reembolso",
    ligacao_faturacao: "conexión al software de facturación con error",
  },
  en: {
    pagamento: "payment discrepancy",
    documento_fiscal: "tax document",
    duplicado_cliente: "possible duplicate customer",
    prazo_reembolso: "refund deadline",
    livre_resolucao: "withdrawal request",
    problema: "order issue",
    reembolso: "refund",
    ligacao_faturacao: "invoicing software connection with an error",
  },
};

/** «2026-10-12 09:30» → «12/10/2026 09:30» (PT, ES) ou como está (EN). */
const dataHora = (t: string | null, l: Lingua) => {
  if (t === null) return "?";
  const [d, h] = t.split(" ");
  return `${data(d ?? null, l)} ${h ?? ""}`.trim();
};

/**
 * Os códigos da fila, separados por vírgula (um documento com dois motivos,
 * os sinais de um duplicado; revisão do #389, P3-1): só letras, algarismos,
 * `_` e `,`, ou «?».
 */
const codigo = (t: string | null) =>
  t !== null && /^[a-z0-9_]+(,[a-z0-9_]+)*$/.test(t) && t.length <= 200
    ? t.replaceAll(",", ", ")
    : "?";

function textoDaTarefa(
  d: DadosDaTarefa,
  l: Lingua,
  loja: string,
): Omit<Mensagem, "para"> {
  const fila = FILAS[d.fila];
  const caso = `${fila.prefixo}_${d.caso}`;
  const nome = NOMES_DAS_FILAS[l][d.fila];
  const prazo = `${dataHora(d.prazo, l)} (${linha(d.fuso ?? undefined) || "?"})`;
  const motivo = codigo(d.motivo);
  const t = {
    pt: {
      assunto: `Tarefa vencida: ${nome} ${caso}`,
      texto: [
        "Olá,",
        "",
        `Na loja «${loja}», o caso ${caso} (${nome}; motivo: ${motivo}) passou o prazo de ${prazo} sem decisão.`,
        "",
        "A lista dos casos vencidos: GET /tasks?vencida=true.",
        "",
        "Este aviso vai para a pessoa responsável pelo caso ou, sem responsável, para quem o pode decidir e atribuir. Não leva dados do cliente.",
        "Eurolify",
      ],
    },
    es: {
      assunto: `Tarea vencida: ${nome} ${caso}`,
      texto: [
        "Hola:",
        "",
        `En la tienda «${loja}», el caso ${caso} (${nome}; motivo: ${motivo}) ha superado el plazo del ${prazo} sin decisión.`,
        "",
        "La lista de casos vencidos: GET /tasks?vencida=true.",
        "",
        "Este aviso se envía a la persona responsable del caso o, si no la hay, a quien puede decidirlo y asignarlo. No incluye datos del cliente.",
        "Eurolify",
      ],
    },
    en: {
      assunto: `Overdue task: ${nome} ${caso}`,
      texto: [
        "Hello,",
        "",
        `In the shop "${loja}", the case ${caso} (${nome}; reason: ${motivo}) passed its deadline of ${prazo} without a decision.`,
        "",
        "The list of overdue cases: GET /tasks?vencida=true.",
        "",
        "This notice goes to the person responsible for the case or, if there is none, to those who can decide and assign it. It carries no customer data.",
        "Eurolify",
      ],
    },
  }[l];
  return { assunto: t.assunto, texto: t.texto.join("\n") };
}

const NOMES_DOS_ADAPTADORES: Record<string, string> = {
  moloni: "Moloni",
  ensaio: "Ensaio",
};

function textoDaLigacao(
  d: DadosDaLigacao,
  l: Lingua,
  loja: string,
): Omit<Mensagem, "para"> {
  const entidade = linha(d.entidade) || "?";
  const software = NOMES_DOS_ADAPTADORES[d.adaptador] ?? "?";
  const caso = `isx_${d.ligacao}`;
  const motivo = codigo(d.motivo);
  const desde = `${dataHora(d.desde, l)} (${linha(d.fuso ?? undefined) || "?"})`;
  const retidas = Number.isInteger(d.retidas) && d.retidas >= 0 ? d.retidas : 0;
  const t = {
    pt: {
      assunto: `Faturação: a ligação ao ${software} de «${entidade}» está com erro`,
      texto: [
        "Olá,",
        "",
        `Na loja «${loja}», a ligação ${caso} da entidade «${entidade}» ao ${software} está com erro desde ${desde} (motivo: ${motivo}).`,
        "Enquanto estiver assim, as faturas desta entidade não saem: ficam retidas.",
        retidas === 0
          ? "Neste momento não há faturas retidas por isto."
          : retidas === 1
            ? "Neste momento há 1 fatura retida por isto."
            : `Neste momento há ${String(retidas)} faturas retidas por isto.`,
        "",
        "Para resolver: no Hub, «Faturação», «Ligar outra vez» e depois «Testar». Pela API: GET /invoicing-connections.",
        "",
        "Este aviso vai para quem pode ligar a conta (o dono). Não leva dados de clientes.",
        "Eurolify",
      ],
    },
    es: {
      assunto: `Facturación: la conexión a ${software} de «${entidade}» tiene un error`,
      texto: [
        "Hola:",
        "",
        `En la tienda «${loja}», la conexión ${caso} de la entidad «${entidade}» a ${software} tiene un error desde el ${desde} (motivo: ${motivo}).`,
        "Mientras siga así, las facturas de esta entidad no se emiten: quedan retenidas.",
        retidas === 0
          ? "En este momento no hay facturas retenidas por esto."
          : retidas === 1
            ? "En este momento hay 1 factura retenida por esto."
            : `En este momento hay ${String(retidas)} facturas retenidas por esto.`,
        "",
        "Para resolverlo: en el Hub, «Facturación», «Conectar de nuevo» y después «Probar». Por la API: GET /invoicing-connections.",
        "",
        "Este aviso se envía a quien puede conectar la cuenta (el propietario). No incluye datos de clientes.",
        "Eurolify",
      ],
    },
    en: {
      assunto: `Invoicing: the ${software} connection of "${entidade}" has an error`,
      texto: [
        "Hello,",
        "",
        `In the shop "${loja}", the connection ${caso} of the entity "${entidade}" to ${software} has had an error since ${desde} (reason: ${motivo}).`,
        "While it stays like this, this entity's invoices are not issued: they are held.",
        retidas === 0
          ? "Right now no invoices are held because of this."
          : retidas === 1
            ? "Right now 1 invoice is held because of this."
            : `Right now ${String(retidas)} invoices are held because of this.`,
        "",
        "To fix it: in the Hub, «Invoicing», «Connect again» and then «Test». Through the API: GET /invoicing-connections.",
        "",
        "This notice goes to whoever can connect the account (the owner). It carries no customer data.",
        "Eurolify",
      ],
    },
  }[l];
  return { assunto: t.assunto, texto: t.texto.join("\n") };
}

/** O e-mail de uma notificação, para uma pessoa. */
export function mensagemDe(
  tipo: TipoNotificacao,
  lingua: Lingua,
  dados: DadosDoAviso | DadosDaTarefa | DadosDaLigacao,
  para: { email: string },
): Mensagem {
  const loja = linha(dados.loja) || "?";
  if (tipo === "invoicing.connection_error") {
    return {
      ...textoDaLigacao(dados as DadosDaLigacao, lingua, loja),
      para: para.email,
    };
  }
  if (tipo === "task.overdue") {
    return {
      ...textoDaTarefa(dados as DadosDaTarefa, lingua, loja),
      para: para.email,
    };
  }
  const d = dados as DadosDoAviso;
  const m = TEXTOS[lingua][tipo](d, loja, {
    rma: `rma_${d.devolucao}`,
    ord: `ord_${d.encomenda}`,
  });
  return { ...m, para: para.email };
}
