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
 * migração 0084).
 */
export interface DadosDaLigacao {
  loja?: string;
  /** O nome da entidade legal do comerciante (a empresa, não um cliente). */
  entidade?: string;
  ligacao: string;
  adaptador: string;
  /** Um código: `renovacao_recusada`. */
  motivo: string | null;
  /**
   * As faturas retidas por `ligacao_sem_teste` nessa entidade, contadas no
   * envio (não se guardam na notificação).
   */
  retidas?: number;
  /** AAAA-MM-DD HH:MI, no fuso do comerciante. */
  desde: string | null;
  fuso: string | null;
}

/**
 * O aviso a quem expede: «tentativa falhada» ou «para levantar» (docs/36 §20;
 * migração 0087). Nunca o nome, a morada nem o texto da transportadora.
 */
export interface DadosDoEnvio {
  loja?: string;
  expedicao: string;
  /** `tentativa_falhada` ou `disponivel_para_levantar`. */
  estado: string;
  transportadora: string | null;
  seguimento: string | null;
  /** AAAA-MM-DD HH:MI, no fuso do comerciante. */
  em: string | null;
  fuso: string | null;
}

type TipoDoReembolso = Exclude<
  TipoNotificacao,
  "task.overdue" | "invoicing.connection_error" | "shipment.needs_attention"
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
    pedido_titular: "pedido de um cliente sobre os seus dados",
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
    pedido_titular: "solicitud de un cliente sobre sus datos",
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
    pedido_titular: "customer request about their data",
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
  const retidas =
    d.retidas !== undefined && Number.isInteger(d.retidas) && d.retidas >= 0
      ? d.retidas
      : 0;
  const t = {
    pt: {
      assunto: `Faturação: a ligação ao ${software} de «${entidade}» está com erro`,
      texto: [
        "Olá,",
        "",
        `Na loja «${loja}», a ligação ${caso} da entidade «${entidade}» ao ${software} está com erro desde ${desde} (motivo: ${motivo}).`,
        "Enquanto estiver assim, as faturas desta entidade não saem: ficam retidas.",
        retidas === 0
          ? "Ainda não há faturas retidas por isto; as próximas ficam retidas até a ligação voltar."
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
          ? "Aún no hay facturas retenidas por esto; las próximas quedarán retenidas hasta que vuelva la conexión."
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
          ? "No invoices are held because of this yet; the next ones will be held until the connection is back."
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

/** Um número de seguimento: uma linha, curta. */
const curto = (t: string | null) => {
  const x = linha(t ?? undefined).slice(0, 60);
  return x === "" ? "?" : x;
};

const NOMES_DAS_TRANSPORTADORAS: Record<string, string> = {
  ctt: "CTT",
  sendcloud: "Sendcloud",
};

function textoDoEnvio(
  d: DadosDoEnvio,
  l: Lingua,
  loja: string,
): Omit<Mensagem, "para"> {
  const shp = `shp_${d.expedicao}`;
  const seguimento = curto(d.seguimento);
  const transportadora =
    NOMES_DAS_TRANSPORTADORAS[d.transportadora ?? ""] ?? "?";
  const quando = `${dataHora(d.em, l)} (${linha(d.fuso ?? undefined) || "?"})`;
  const levantar = d.estado === "disponivel_para_levantar";
  if (!levantar && d.estado !== "tentativa_falhada") {
    throw new Error("estado desconhecido no aviso do envio");
  }
  const t = {
    pt: {
      assunto: levantar
        ? `Envios: a expedição ${shp} está à espera de ser levantada`
        : `Envios: a transportadora não conseguiu entregar a expedição ${shp}`,
      texto: [
        "Olá,",
        "",
        levantar
          ? `Na loja «${loja}», a transportadora (${transportadora}) diz que a expedição ${shp} (seguimento ${seguimento}) está disponível para levantar desde ${quando}.`
          : `Na loja «${loja}», a transportadora (${transportadora}) diz que não conseguiu entregar a expedição ${shp} (seguimento ${seguimento}) em ${quando}.`,
        "Pode ser preciso falar com o cliente ou com a transportadora.",
        "",
        "Veja o seguimento no Hub, em «Expedir». Pela API: GET /shipments/{id}/events.",
        "",
        "Este aviso vai para quem expede (o dono, o gestor e o armazém), uma vez por expedição e por situação. Não leva o nome nem a morada de quem recebe.",
        "Eurolify",
      ],
    },
    es: {
      assunto: levantar
        ? `Envíos: el envío ${shp} está esperando a ser recogido`
        : `Envíos: la transportista no pudo entregar el envío ${shp}`,
      texto: [
        "Hola:",
        "",
        levantar
          ? `En la tienda «${loja}», la transportista (${transportadora}) dice que el envío ${shp} (seguimiento ${seguimento}) está disponible para recoger desde el ${quando}.`
          : `En la tienda «${loja}», la transportista (${transportadora}) dice que no pudo entregar el envío ${shp} (seguimiento ${seguimento}) el ${quando}.`,
        "Puede ser necesario hablar con el cliente o con la transportista.",
        "",
        "Vea el seguimiento en el Hub, en «Expedir». Por la API: GET /shipments/{id}/events.",
        "",
        "Este aviso se envía a quien expide (el propietario, el gestor y el almacén), una vez por envío y por situación. No incluye el nombre ni la dirección del destinatario.",
        "Eurolify",
      ],
    },
    en: {
      assunto: levantar
        ? `Shipping: shipment ${shp} is waiting to be collected`
        : `Shipping: the carrier could not deliver shipment ${shp}`,
      texto: [
        "Hello,",
        "",
        levantar
          ? `In the shop "${loja}", the carrier (${transportadora}) says shipment ${shp} (tracking ${seguimento}) has been available for collection since ${quando}.`
          : `In the shop "${loja}", the carrier (${transportadora}) says it could not deliver shipment ${shp} (tracking ${seguimento}) on ${quando}.`,
        "You may need to contact the customer or the carrier.",
        "",
        "See the tracking in the Hub, under «Expedir». Through the API: GET /shipments/{id}/events.",
        "",
        "This notice goes to those who ship (the owner, the manager and the warehouse), once per shipment and per situation. It does not carry the recipient's name or address.",
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
  dados: DadosDoAviso | DadosDaTarefa | DadosDaLigacao | DadosDoEnvio,
  para: { email: string },
): Mensagem {
  const loja = linha(dados.loja) || "?";
  if (tipo === "shipment.needs_attention") {
    return {
      ...textoDoEnvio(dados as DadosDoEnvio, lingua, loja),
      para: para.email,
    };
  }
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
