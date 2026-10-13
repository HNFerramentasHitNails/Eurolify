import {
  ErroHub,
  type EncomendaParaExpedir,
  type EstadoEtiqueta,
  type EstadoExpedicao,
  type LinhaParaExpedir,
  type MetodoDaEncomenda,
} from "./api";
import { ErroDoEcra } from "./erros";
import type { Textos } from "./textos";

// Apoio do ecrã «Expedir» (docs/22 §33). A API decide tudo: o que falta
// expedir, se a etiqueta se pode pedir, o lote que sai. Aqui só se conta o
// que se mostra, se confere o mínimo e se escolhe o texto.

/** O que falta pôr numa expedição desta linha. */
export const porExpedir = (l: LinhaParaExpedir) =>
  Math.max(0, l.quantidade - l.expedida);

/** As unidades por expedir na encomenda toda. */
export const totalPorExpedir = (e: EncomendaParaExpedir) =>
  e.linhas.reduce((t, l) => t + porExpedir(l), 0);

/** O formulário de uma expedição nova: por omissão, tudo o que falta. */
export function quantidadesPorOmissao(
  e: EncomendaParaExpedir,
): Record<string, string> {
  return Object.fromEntries(
    e.linhas
      .filter((l) => porExpedir(l) > 0)
      .map((l) => [l.id, String(porExpedir(l))]),
  );
}

/**
 * Do formulário ao corpo da API: as linhas com quantidade, sem passar do
 * que falta (o servidor confere de novo). `null` com o texto quando não há
 * nada a enviar ou um número não serve.
 */
export function conferirQuantidades(
  e: EncomendaParaExpedir,
  quantidades: Record<string, string>,
):
  | { linhas: { linha: string; quantidade: number }[]; falta: null }
  | { linhas: null; falta: { linha: string | null; texto: keyof Textos } } {
  const linhas: { linha: string; quantidade: number }[] = [];
  for (const l of e.linhas) {
    const texto = (quantidades[l.id] ?? "").trim();
    if (texto === "" || texto === "0") continue;
    if (!/^\d{1,5}$/.test(texto)) {
      return {
        linhas: null,
        falta: { linha: l.id, texto: "expedirQuantidadeErrada" },
      };
    }
    const q = Number(texto);
    if (q > porExpedir(l)) {
      return {
        linhas: null,
        falta: { linha: l.id, texto: "expedirMaisDoQueFalta" },
      };
    }
    linhas.push({ linha: l.id, quantidade: q });
  }
  if (linhas.length === 0) {
    return {
      linhas: null,
      falta: { linha: null, texto: "expedirNadaEscolhido" },
    };
  }
  return { linhas, falta: null };
}

/** «1450» → 1450; `null` quando não é um peso de 1 g a 1 000 000 g (docs/36 §19). */
export function pesoDoTexto(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,7}$/.test(limpo)) return null;
  const g = Number(limpo);
  return g >= 1 && g <= 1_000_000 ? g : null;
}

/** O motivo de uma correcção: pelo menos 3 caracteres, no máximo 500. */
export const motivoServe = (texto: string) => {
  const n = texto.trim().length;
  return n >= 3 && n <= 500;
};

/** Com conta e serviço, a etiqueta pede-se pelo Eurolify; sem, é «Manual». */
export const comEtiqueta = (m: MetodoDaEncomenda) =>
  typeof m.conta === "string" && m.conta !== "";

/** O nome do método copiado, na língua pedida. */
export function nomeDoMetodo(m: MetodoDaEncomenda, lingua: string): string {
  const n = m.nome;
  if (typeof n === "string") return n;
  if (n === undefined) return "";
  return n[lingua] ?? n["pt"] ?? Object.values(n)[0] ?? "";
}

export const TEXTO_DO_ESTADO_DA_ENCOMENDA: Record<string, keyof Textos> = {
  paga: "expedirEstadoPaga",
  em_preparacao: "expedirEstadoEmPreparacao",
  expedida_parcial: "expedirEstadoExpedidaParcial",
  expedida: "expedirEstadoExpedida",
};

export const TEXTO_DO_ESTADO_DA_EXPEDICAO: Record<
  EstadoExpedicao,
  keyof Textos
> = {
  criada: "expedicaoCriada",
  expedida: "expedicaoExpedida",
  entregue: "expedicaoEntregue",
  devolvida_ao_remetente: "expedicaoDevolvida",
  perdida: "expedicaoPerdida",
  cancelada: "expedicaoCancelada",
};

export const TEXTO_DO_ESTADO_DA_ETIQUETA: Record<EstadoEtiqueta, keyof Textos> =
  {
    por_pedir: "etiquetaPorPedir",
    a_pedir: "etiquetaAPedir",
    emitida: "etiquetaEmitida",
    incerta: "etiquetaIncerta",
    recusada: "etiquetaRecusada",
    anulada: "etiquetaAnulada",
  };

/**
 * O que a expedição deixa fazer agora (o servidor confere de novo). Com
 * conta, só se marca como expedida com a etiqueta emitida: depois de sair,
 * a etiqueta já não se pede nem se anula (0079), e uma incerta que a
 * transportadora afinal criou ficaria sem anulação. Com uma etiqueta viva
 * (emitida, incerta ou a pedir) não se cancela: anula-se primeiro (revisão
 * do #418, P1-2).
 */
export function accoesDaExpedicao(
  etiqueta: EstadoEtiqueta | null,
  expedicao: EstadoExpedicao,
): {
  pedir: boolean;
  anular: boolean;
  consultar: boolean;
  marcar: boolean;
  cancelar: boolean;
} {
  const criada = expedicao === "criada";
  // Sem conta (método «Manual») não há etiqueta.
  if (etiqueta === null) {
    return {
      pedir: false,
      anular: false,
      consultar: false,
      marcar: criada,
      cancelar: criada,
    };
  }
  const viva =
    etiqueta === "emitida" || etiqueta === "incerta" || etiqueta === "a_pedir";
  return {
    pedir:
      criada &&
      (etiqueta === "por_pedir" ||
        etiqueta === "recusada" ||
        etiqueta === "anulada"),
    anular: criada && etiqueta === "emitida",
    // Uma incerta resolve-se só pela consulta; uma emitida lê o seguimento.
    consultar: etiqueta === "incerta" || etiqueta === "emitida",
    marcar: criada && etiqueta === "emitida",
    cancelar: criada && !viva,
  };
}

/**
 * Os códigos que o servidor dá nestas rotas (`CodigoErroStock` e
 * `CodigoErroEnvios`; o teste confere que existem), com o texto deste ecrã.
 */
export const TEXTO_DO_CODIGO: Record<string, keyof Textos> = {
  "inventory.version_conflict": "expedirConflito",
  "inventory.no_warehouse": "expedirSemArmazem",
  "inventory.lot_required": "expedirSemLote",
  "inventory.insufficient": "expedirSemStock",
  "inventory.negative": "expedirSemStock",
  "inventory.not_found": "expedirNaoExiste",
  "inventory.invalid_field": "expedirRecusada",
  "inventory.retry": "enviosTentarDeNovo",
  "shipments.quantity_exceeded": "expedirMaisDoQueFalta",
  "shipments.line_not_in_order": "expedirLinhaNaoEDaEncomenda",
  "shipments.invalid_transition": "expedirTransicaoImpossivel",
  "shipments.immutable": "expedirImutavel",
  "orders.invalid_transition": "expedirEncomendaNaoEstaParaExpedir",
  "shipping.not_found": "expedirNaoExiste",
  "shipping.version_conflict": "expedirConflito",
  "shipping.ai_not_allowed": "iaNaoMudaServico",
  "shipping.retry": "enviosTentarDeNovo",
  "shipping.not_configured": "enviosSemChave",
  "shipping.label_exists": "etiquetaJaExiste",
  "shipping.label_uncertain": "etiquetaIncertaConsultar",
  "shipping.void_not_allowed": "etiquetaNaoAnula",
  "shipping.invalid_transition": "etiquetaTransicaoImpossivel",
  "shipping.account_not_ready": "etiquetaContaNaoPronta",
  "shipping.service_unknown": "etiquetaServicoDesconhecido",
  "shipping.invalid_field": "etiquetaPedidoRecusado",
  "shipping.carrier_unavailable": "etiquetaSemResposta",
};

/** Um erro do servidor neste ecrã, no texto dele. */
export function erroDeExpedir(e: unknown): unknown {
  if (!(e instanceof ErroHub) || e.codigo === undefined) return e;
  const chave = TEXTO_DO_CODIGO[e.codigo];
  return chave === undefined ? e : new ErroDoEcra(chave);
}
