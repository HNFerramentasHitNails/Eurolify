import type { DiferencaPagamento } from "./api";
import { preencher, type Textos } from "./textos";

// A fila de diferenças de pagamento no Hub (docs/22 §34; Diogo, 14/10/2026:
// «sim, aprovo o desenho com a Q1 em a)»). O ecrã mostra o que a API diz e
// deixa o dono resolver; a API decide sempre (o incerto obriga a dizer se
// foi pago, a resolvida não muda).

/** O endereço do ecrã, sempre com o comerciante. */
export function enderecoDiferencas(
  comerciante: string,
  separador: "aberta" | "resolvida" = "aberta",
): string {
  const q = new URLSearchParams({ comerciante });
  if (separador === "resolvida") q.set("estado", "resolvida");
  return `/pagamentos/diferencas?${q.toString()}`;
}

/** O separador do endereço: «resolvida» ou, por omissão, as por resolver. */
export function separadorDe(consulta: string): "aberta" | "resolvida" {
  return new URLSearchParams(consulta).get("estado") === "resolvida"
    ? "resolvida"
    : "aberta";
}

/** Os motivos dos reembolsos: decidem-se na devolução (docs/30 §13, P7). */
const DE_REEMBOLSO = new Set([
  "reembolso_incerto",
  "reembolso_por_confirmar",
  "reembolso_desconhecido",
]);

export type CasoDoDialogo = "incerto" | "reembolso" | "normal";

/**
 * O que o diálogo de resolver pede (§34.3): num pagamento ainda incerto, se
 * foi pago; num reembolso, só o texto, com o aviso de que o reembolso se
 * decide na devolução; nos outros, só o texto.
 */
export function casoDoDialogo(d: DiferencaPagamento): CasoDoDialogo {
  if (DE_REEMBOLSO.has(d.motivo)) return "reembolso";
  if (d.pagamento?.estado === "incerto") return "incerto";
  return "normal";
}

/**
 * Montante ou moeda diferentes (Q2 A, 14/10/2026): a encomenda não fica paga.
 * O ecrã diz-o e dá as duas saídas (devolver e pedir de novo, ou cancelar).
 */
export function naoFicaPaga(d: DiferencaPagamento): boolean {
  return d.motivo === "montante_diferente" || d.motivo === "moeda_diferente";
}

/** Os nomes dos prestadores (marcas, iguais em todas as línguas). */
const NOMES_DE_PRESTADOR: Record<string, string> = { eupago: "EuPago" };

/**
 * O que a pessoa confere na conta do prestador num pagamento incerto
 * (Q1 A, 14/10/2026): o prestador, o montante, a referência e a data do
 * pagamento. null se a API não os der (nada se inventa).
 */
export function pagamentoAConferir(
  d: DiferencaPagamento,
  tag: string,
): {
  prestador: string;
  montante: string;
  referencia: string;
  data: string;
} | null {
  const p = d.pagamento;
  if (p === null || p.montante === null || p.referencia === null) return null;
  return {
    prestador: NOMES_DE_PRESTADOR[p.prestador ?? ""] ?? p.prestador ?? "",
    montante: emDinheiro(p.montante, p.moeda, tag),
    referencia: p.referencia,
    data:
      p.criado_em === null
        ? ""
        : new Intl.DateTimeFormat(tag, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(p.criado_em)),
  };
}

/**
 * O texto sugerido para a resolução de um pagamento incerto, conforme a
 * pessoa escolhe «Sim, foi pago» ou «Não, não foi pago». É só uma sugestão,
 * que a pessoa edita; o que se grava é o que ela deixar. Vazio se faltarem os
 * dados do pagamento.
 */
export function sugestaoDaResolucao(
  t: Textos,
  d: DiferencaPagamento,
  pago: "capturado" | "falhado",
  tag: string,
): string {
  const v = pagamentoAConferir(d, tag);
  if (v === null || v.prestador === "") return "";
  return preencher(
    pago === "capturado" ? t.diferencaSugestaoPago : t.diferencaSugestaoNaoPago,
    v,
  );
}

/** Um montante em euros (a API dá-o em unidades, não em cêntimos). */
export function emDinheiro(
  valor: number,
  moeda: string | null,
  tag: string,
): string {
  try {
    return new Intl.NumberFormat(tag, {
      style: "currency",
      currency: moeda ?? "EUR",
    }).format(valor);
  } catch {
    // Uma moeda que o navegador não conhece: o número e o código.
    return `${String(valor)} ${moeda ?? ""}`.trim();
  }
}

/** O estado de um pagamento em linguagem comum (o código, se não houver). */
export function estadoDoPagamento(t: Textos, estado: string): string {
  return (t as Record<string, string>)[`estadoPagamento_${estado}`] ?? estado;
}

const texto = (x: unknown): string | null =>
  typeof x === "string" && x !== ""
    ? x
    : typeof x === "number"
      ? String(x)
      : null;
const numero = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : null;

/**
 * A prova de uma diferença em linguagem comum (§34.3), pelos campos que a
 * API grava em cada motivo (`apps/api/src/pagamentos/repositorio.ts` e
 * `posvenda/prestador.ts`). Nunca o corpo de um aviso: a API não o manda.
 * Um campo que não se conhece fica como chave e valor, para nada se perder.
 */
export function provaEmTexto(
  t: Textos,
  d: DiferencaPagamento,
  tag: string,
): string {
  const p =
    typeof d.prova === "object" && d.prova !== null
      ? (d.prova as Record<string, unknown>)
      : {};
  const moeda = d.pagamento?.moeda ?? "EUR";
  switch (d.motivo) {
    case "montante_diferente": {
      const esperado = numero(p["esperado"]);
      const recebido = numero(p["recebido"]);
      if (esperado !== null) {
        return preencher(t.provaMontante, {
          esperado: emDinheiro(esperado, moeda, tag),
          recebido:
            recebido === null
              ? t.provaSemMontante
              : emDinheiro(recebido, moeda, tag),
        });
      }
      break;
    }
    case "moeda_diferente": {
      const esperada = texto(p["esperada"]);
      if (esperada !== null) {
        return preencher(t.provaMoeda, {
          esperada,
          recebida: texto(p["recebida"]) ?? t.provaSemMoeda,
        });
      }
      break;
    }
    case "transicao_impossivel": {
      const de = texto(p["de"]);
      const para = texto(p["para"]);
      if (de !== null && para !== null) {
        return preencher(t.provaTransicao, {
          de: estadoDoPagamento(t, de),
          para: estadoDoPagamento(t, para),
        });
      }
      break;
    }
    case "incerto":
      return t.provaIncerto;
    case "aviso_sem_pagamento": {
      const referencia = texto(p["referencia"]);
      if (referencia !== null) {
        return preencher(t.provaAvisoSemPagamento, { referencia });
      }
      break;
    }
    case "pagamento_duplicado":
      return t.provaDuplicado;
    case "pago_depois_de_cancelada":
      return t.provaDepoisDeCancelada;
    case "reembolso_desconhecido": {
      const m = numero(p["montante"]);
      if (m !== null) {
        return preencher(t.provaReembolsoDesconhecido, {
          montante: emDinheiro(m, texto(p["moeda"]), tag),
        });
      }
      break;
    }
    case "reembolso_incerto":
      return t.provaReembolsoIncerto;
    case "reembolso_por_confirmar":
      return t.provaReembolsoPorConfirmar;
    default:
      break;
  }
  const resto = Object.entries(p)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");
  return resto === "" ? t.provaSemPormenor : resto;
}

/** Os erros do resolver com texto próprio (§34.3). */
export const TEXTO_DO_ERRO_DA_DIFERENCA: Record<string, keyof Textos> = {
  "payments.invalid_transition": "diferencaMudou",
  "payments.not_found": "diferencaNaoExiste",
};
