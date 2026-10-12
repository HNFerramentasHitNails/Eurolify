import type { TipoNotificacao } from "../base/esquema.js";
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
    TipoNotificacao,
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

/** O e-mail de uma notificação, para uma pessoa. */
export function mensagemDe(
  tipo: TipoNotificacao,
  lingua: Lingua,
  dados: DadosDoAviso,
  para: { email: string },
): Mensagem {
  const m = TEXTOS[lingua][tipo](dados, linha(dados.loja) || "?", {
    rma: `rma_${dados.devolucao}`,
    ord: `ord_${dados.encomenda}`,
  });
  return { ...m, para: para.email };
}
