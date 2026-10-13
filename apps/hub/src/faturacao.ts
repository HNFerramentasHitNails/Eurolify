import { preencher, type Textos } from "./textos";

// O ecrã «Faturação» (docs/22 §30): as funções sem ecrã — os períodos, os
// montantes e as taxas pela língua, o texto de cada impedimento e o regresso
// do Moloni. Quem pode ligar, classificar e fechar, e o que impede o fecho,
// decide-o a API (`apps/api/src/faturacao`); aqui só se mostra o que ela
// devolve e não se oferece o que ela recusa.

// ------------------------------------------------------------ As respostas

/** Uma entidade legal do comerciante (GET /hub/invoicing). */
export interface EntidadeFaturacao {
  id: string;
  nome: string;
  pais: string;
  /** `eurolify`, `sistema_proprio` ou `por_configurar` (docs/29 §15). */
  emissor: string;
}

export type EstadoLigacao = "por_testar" | "pronta" | "com_erro";

/** Uma ligação a um software de faturação, sem credenciais. */
export interface LigacaoFaturacao {
  id: string;
  entidade_legal: string;
  adaptador: string;
  modo: string;
  estado: EstadoLigacao;
  activa: boolean;
  serie: string | null;
  credenciais_em: string | null;
  credenciais_por: string | null;
  testada_em: string | null;
  erro: string | null;
  versao: number;
  /** O que falta mapear (docs/22 §31.4); null numa ligação desligada. */
  faltam?: Necessario | null;
}

export interface Faturacao {
  entidades: EntidadeFaturacao[];
  ligacoes: LigacaoFaturacao[];
}

/** Os cinco baldes, pela ordem do `docs/37` §2.1. */
export const BALDES = [
  "oss",
  "nacional",
  "intracomunitarias",
  "exportacao",
  "outras_isentas",
] as const;
export type Balde = (typeof BALDES)[number];

export interface LinhaRelatorio {
  balde: Balde;
  pais: string;
  /** Em centésimas de ponto (2300 = 23 %). */
  taxa: number;
  /** Em cêntimos; as notas de crédito já vêm a negativo. */
  base: number;
  iva: number;
  documentos: number;
}

export interface AlteracaoRelatorio extends LinhaRelatorio {
  periodo_original: string;
}

export const MOTIVOS_IMPEDIMENTO = [
  "periodo_em_curso",
  "por_emitir",
  "divergente",
  "declarado_divergente",
  "linhas_desalinhadas",
  "sem_balde",
  "sem_data",
  "outra_moeda",
  "sinal_inesperado",
  "periodo_anterior_aberto",
  "periodo_posterior_fechado",
] as const;
export type MotivoImpedimento = (typeof MOTIVOS_IMPEDIMENTO)[number];

export interface Impedimento {
  /** Texto: um motivo novo da API mostra-se com o código, nunca se esconde. */
  motivo: string;
  documentos: string[];
}

/** A régua do país por balde, do servidor (docs/22 §30.3). */
export interface Classificavel {
  baldes: { balde: Balde; paises: string[]; fora_da_ue: boolean }[];
}

/** O relatório OSS de um período (o `Relatorio` de `oss.ts`, pelo Hub). */
export interface RelatorioOss {
  entidade_legal: string;
  periodo: string;
  granularidade: "trimestre" | "mes";
  fechado: null | { em: string; por: string; versao_regra: number };
  moeda: string;
  baldes: {
    balde: Balde;
    base: number;
    iva: number;
    linhas: LinhaRelatorio[];
  }[];
  alteracoes: AlteracaoRelatorio[];
  a_parte: {
    emitidas_fora: {
      documento: string;
      encomenda: string;
      pais: string | null;
      total: number;
      numero_declarado: string | null;
      alteracao_de: string | null;
    }[];
    sistema_proprio: {
      encomenda: string;
      pais: string | null;
      total: number;
    }[];
    por_emitir: { documento: string; encomenda: string; estado: string }[];
  };
  limiar: {
    ano: string;
    vendas_a_distancia_base: number;
    ano_anterior: string;
    ano_anterior_base: number;
    limiar: number;
    passou: boolean;
    documentos_excluidos: number;
  };
  impedimentos: Impedimento[];
  classificavel: Classificavel;
}

/** O documento a classificar (GET /hub/tax-reports/oss/documents/{id}). */
export interface DocumentoAClassificar {
  documento: string;
  tipo: "fatura" | "nota_credito";
  estado: string;
  numero: string;
  data_prova: string | null;
  moeda: string;
  classificado: boolean;
  /** O total da prova, em cêntimos (positivo, como as linhas). */
  total: number;
  /** A data mais antiga que a classificação aceita (o dia do pedido). */
  data_minima: string;
  linhas: {
    descricao: string;
    quantidade: number;
    taxa: number;
    base: number;
    iva: number;
  }[];
}

// ------------------------------------------------------------- A ligação

export type EstadoMostrado = EstadoLigacao | "desligada";

/**
 * A ligação de uma entidade: a activa; sem ela, a última desligada (para
 * dizer «desligada»); sem nenhuma, null.
 */
export function ligacaoDaEntidade(
  entidade: string,
  ligacoes: readonly LigacaoFaturacao[],
): LigacaoFaturacao | null {
  const daEntidade = ligacoes.filter((l) => l.entidade_legal === entidade);
  return (
    daEntidade.find((l) => l.activa) ??
    daEntidade[daEntidade.length - 1] ??
    null
  );
}

export const estadoMostrado = (l: LigacaoFaturacao): EstadoMostrado =>
  l.activa ? l.estado : "desligada";

// ------------------------------------------------------------- Os períodos

/** O fuso do relatório: o da entidade da Fase 1 (`hojeEmLisboa`, P2). */
export const FUSO_DO_RELATORIO = "Europe/Lisbon";

/** Hoje (AAAA-MM-DD) no fuso. */
export function hojeEm(agora: Date, fuso: string = FUSO_DO_RELATORIO): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

const TRIMESTRE = /^(\d{4})-T([1-4])$/;

/** «2026-T3» se o texto for um trimestre; senão null (o mês fica na API). */
export function lerTrimestre(texto: string | null): string | null {
  return texto !== null && TRIMESTRE.test(texto) ? texto : null;
}

const partes = (p: string): [number, number] => {
  const m = TRIMESTRE.exec(p);
  return m === null ? [0, 1] : [Number(m[1]), Number(m[2])];
};
const trimestre = (ano: number, q: number) => `${String(ano)}-T${String(q)}`;

/** O trimestre em que cai um dia AAAA-MM-DD. */
export const trimestreDe = (dia: string) =>
  trimestre(Number(dia.slice(0, 4)), Math.ceil(Number(dia.slice(5, 7)) / 3));

export function trimestreAnterior(p: string): string {
  const [a, q] = partes(p);
  return q === 1 ? trimestre(a - 1, 4) : trimestre(a, q - 1);
}

export function trimestreSeguinte(p: string): string {
  const [a, q] = partes(p);
  return q === 4 ? trimestre(a + 1, 1) : trimestre(a, q + 1);
}

/** O primeiro dia depois do trimestre (AAAA-MM-DD): quando se pode fechar. */
export function primeiroDiaDepois(p: string): string {
  const [a, q] = partes(p);
  return q === 4
    ? `${String(a + 1)}-01-01`
    : `${String(a)}-${String(q * 3 + 1).padStart(2, "0")}-01`;
}

/** O trimestre ainda não acabou (no fuso do relatório). */
export const emCurso = (p: string, hoje: string) => primeiroDiaDepois(p) > hoje;

/** O último trimestre acabado: o que a página «Faturação» mostra. */
export const ultimoTrimestreAcabado = (hoje: string) =>
  trimestreAnterior(trimestreDe(hoje));

/**
 * Os trimestres para escolher: o actual («em curso») e os oito anteriores,
 * do mais recente ao mais antigo (docs/22 §30.3).
 */
export function trimestresParaEscolher(
  hoje: string,
): { periodo: string; emCurso: boolean }[] {
  const lista = [{ periodo: trimestreDe(hoje), emCurso: true }];
  for (let i = 0; i < 8; i++) {
    const anterior = lista[lista.length - 1]?.periodo ?? trimestreDe(hoje);
    lista.push({ periodo: trimestreAnterior(anterior), emCurso: false });
  }
  return lista;
}

/** «T3 de 2026»; um mês ou um texto desconhecido mostra-se como está. */
export function nomeDoPeriodo(t: Textos, p: string): string {
  const m = TRIMESTRE.exec(p);
  if (m === null) return p;
  return preencher(t.faturacaoTrimestre, { n: m[2] ?? "", ano: m[1] ?? "" });
}

// ------------------------------------------- Configurar (docs/22 §31)

/** O que o Eurolify precisa de ver mapeado (a mesma chave da retenção). */
export interface Necessario {
  /** Os pares (país, taxa em centésimas). */
  taxas: { pais: string; taxa: number }[];
  isencoes: { pais: string; codigo: string }[];
  meios: string[];
}

export interface Opcao {
  id: string;
  nome: string;
}

/** GET /hub/invoicing-connections/{id}/issuer-options. */
export interface OpcoesDoEmissor {
  listas: {
    series: Opcao[];
    taxas: (Opcao & { valor: number; zona: string | null })[];
    isencoes: Opcao[];
    metodos_pagamento: Opcao[];
    linguas: (Opcao & { codigo: string | null })[];
    vencimentos: (Opcao & { dias: number | null })[];
    unidades: (Opcao & { abreviatura: string | null })[];
    categorias: Opcao[];
  };
  necessario: Necessario;
  ligacao: {
    versao: number;
    serie: string | null;
    taxas: { pais: string; taxa: number; emissor: string }[];
    isencoes: { codigo: string; emissor: string }[];
    config: Record<string, string | Record<string, string> | undefined>;
  };
}

export type ResultadoNoEmissor =
  | {
      tipo: "artigo";
      id: string;
      nome: string;
      referencia: string | null;
      preco: number | null;
    }
  | { tipo: "cliente"; id: string; nome: string; numero: string | null };

/** Os campos da configuração escolhidos de uma lista (docs/29 §13.2). */
export const CAMPOS_DE_LISTA = [
  "lingua",
  "vencimento",
  "unidade",
  "categoria",
] as const;
export const CAMPOS_DE_PESQUISA = [
  "artigo_portes",
  "cliente_consumidor_final",
] as const;
type CampoConfig =
  (typeof CAMPOS_DE_LISTA)[number] | (typeof CAMPOS_DE_PESQUISA)[number];

/** O que a pessoa escolheu no ecrã; "" = por escolher. */
export interface Escolhas {
  serie: string;
  /** Pela chave `PT|2300`. */
  taxas: Record<string, string>;
  /** Pelo código do motivo. */
  isencoes: Record<string, string>;
  /** Pelo meio de pagamento do Eurolify. */
  metodos: Record<string, string>;
  config: Record<CampoConfig, string>;
}

export const chaveDoPar = (p: { pais: string; taxa: number }) =>
  `${p.pais}|${String(p.taxa)}`;

/** As escolhas já gravadas na ligação (nada se escolhe por adivinhar). */
export function escolhasDe(l: OpcoesDoEmissor["ligacao"]): Escolhas {
  const texto = (k: string) => {
    const v = l.config[k];
    return typeof v === "string" ? v : "";
  };
  const metodos = l.config["metodos_pagamento"];
  return {
    serie: l.serie ?? "",
    taxas: Object.fromEntries(l.taxas.map((t) => [chaveDoPar(t), t.emissor])),
    isencoes: Object.fromEntries(l.isencoes.map((i) => [i.codigo, i.emissor])),
    metodos: typeof metodos === "object" ? { ...metodos } : {},
    config: {
      lingua: texto("lingua"),
      vencimento: texto("vencimento"),
      unidade: texto("unidade"),
      categoria: texto("categoria"),
      artigo_portes: texto("artigo_portes"),
      cliente_consumidor_final: texto("cliente_consumidor_final"),
    },
  };
}

/**
 * O que ainda falta com estas escolhas: a mesma conta do servidor
 * (`faltaNaLigacao`), para o «Faltam: …» mudar à medida que se escolhe.
 */
export function faltaNasEscolhas(n: Necessario, e: Escolhas): Necessario {
  return {
    taxas: n.taxas.filter((p) => (e.taxas[chaveDoPar(p)] ?? "") === ""),
    isencoes: n.isencoes.filter((i) => (e.isencoes[i.codigo] ?? "") === ""),
    meios: n.meios.filter((m) => (e.metodos[m] ?? "") === ""),
  };
}

/** «Faltam 2 taxas e 1 método de pagamento.»; null quando nada falta. */
export function resumoDoQueFalta(t: Textos, f: Necessario): string | null {
  const partes = [
    [f.taxas.length, t.faltaUmaTaxa, t.faltaTaxas],
    [f.isencoes.length, t.faltaUmaIsencao, t.faltaIsencoes],
    [f.meios.length, t.faltaUmMeio, t.faltaMeios],
  ] as const;
  const ditas = partes
    .filter(([n]) => n > 0)
    .map(([n, um, varios]) => (n === 1 ? um : preencher(varios, { n })));
  if (ditas.length === 0) return null;
  const lista =
    ditas.length === 1
      ? (ditas[0] ?? "")
      : `${ditas.slice(0, -1).join(", ")} ${t.faltaE} ${ditas[ditas.length - 1] ?? ""}`;
  return preencher(t.faltam, { lista });
}

/**
 * As taxas do emissor para um par (Q1 em A): **nenhuma vem escolhida**; as
 * de mesmo valor e mesma zona fiscal ficam no topo, e as outras a seguir,
 * pela ordem do emissor.
 */
export function taxasParaOPar<T extends { valor: number; zona: string | null }>(
  taxas: readonly T[],
  par: { pais: string; taxa: number },
): { batem: T[]; outras: T[] } {
  const bate = (x: T) =>
    x.valor === par.taxa && (x.zona ?? "").toUpperCase() === par.pais;
  return { batem: taxas.filter(bate), outras: taxas.filter((x) => !bate(x)) };
}

/** O corpo do PATCH: só o que foi escolhido, sempre com a versão lida. */
export function paraGravar(e: Escolhas, versao: number) {
  const config: Record<string, string | Record<string, string>> = {};
  for (const k of [...CAMPOS_DE_LISTA, ...CAMPOS_DE_PESQUISA]) {
    if (e.config[k] !== "") config[k] = e.config[k];
  }
  const metodos = Object.fromEntries(
    Object.entries(e.metodos).filter(([, v]) => v !== ""),
  );
  if (Object.keys(metodos).length > 0) config["metodos_pagamento"] = metodos;
  return {
    versao,
    serie: e.serie === "" ? null : e.serie,
    taxas: Object.entries(e.taxas)
      .filter(([, v]) => v !== "")
      .map(([k, emissor]) => {
        const [pais = "", taxa = "0"] = k.split("|");
        return { pais, taxa: Number(taxa), emissor };
      }),
    isencoes: Object.entries(e.isencoes)
      .filter(([, v]) => v !== "")
      .map(([codigo, emissor]) => ({ codigo, emissor })),
    config,
  };
}

// ------------------------------------------------------------ Os endereços

export const enderecoFaturacao = (comerciante: string) =>
  `/faturacao?${new URLSearchParams({ comerciante }).toString()}`;

export const enderecoConfigurar = (comerciante: string, ligacao: string) =>
  `/faturacao/configurar?${new URLSearchParams({ comerciante, ligacao }).toString()}`;

export const enderecoOss = (
  comerciante: string,
  entidade: string,
  periodo: string,
) =>
  `/faturacao/oss?${new URLSearchParams({ comerciante, entidade, periodo }).toString()}`;

// ----------------------------------------------------- Montantes e taxas

/** Cêntimos na moeda, pela língua (ex.: «4 230,00 €»). */
export function montante(centimos: number, tag: string, moeda = "EUR") {
  return new Intl.NumberFormat(tag, {
    style: "currency",
    currency: moeda,
  }).format(centimos / 100);
}

/** Centésimas de ponto como percentagem (2300 → «23 %»; 550 → «5,5 %»). */
export function taxa(centesimas: number, tag: string) {
  return new Intl.NumberFormat(tag, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(centesimas / 10_000);
}

// ------------------------------------------------------- Os impedimentos

/** Os que o dono resolve classificando o documento (docs/37, P1-A). */
export const CLASSIFICAVEIS: readonly string[] = [
  "linhas_desalinhadas",
  "sem_balde",
  "sem_data",
];

/** O motivo em linguagem comum; um código sem texto mostra-se como está. */
export function textoDoImpedimento(t: Textos, i: Impedimento): string {
  const textos = t as Record<string, string>;
  const texto = textos[`impedimento_${i.motivo}`];
  return texto === undefined
    ? i.motivo
    : preencher(texto, { n: i.documentos.length });
}

export type Fecho =
  | { tipo: "fechado" }
  | { tipo: "so_leitura" }
  | { tipo: "posterior_fechado" }
  | { tipo: "em_curso"; depois: string }
  | { tipo: "impedido" }
  | { tipo: "pode"; porEmitir: boolean };

/**
 * O que o botão «Fechar» mostra, a partir do que a API devolveu: fechado;
 * sem `tax:write`, só leitura; com um período a seguir já fechado, só
 * leitura (P1-B); em curso, «Só depois de…»; com impedimentos que não sejam
 * «por emitir», sem botão (a lista diz porquê); com «por emitir», o diálogo
 * pede a confirmação (Q-O4). A API confere tudo outra vez ao fechar.
 */
export function fechoDe(r: RelatorioOss, ambitos: readonly string[]): Fecho {
  if (r.fechado !== null) return { tipo: "fechado" };
  const motivos = r.impedimentos.map((i) => i.motivo);
  if (motivos.includes("periodo_posterior_fechado")) {
    return { tipo: "posterior_fechado" };
  }
  if (!ambitos.includes("tax:write")) return { tipo: "so_leitura" };
  if (motivos.includes("periodo_em_curso")) {
    return { tipo: "em_curso", depois: primeiroDiaDepois(r.periodo) };
  }
  if (motivos.some((m) => m !== "por_emitir")) return { tipo: "impedido" };
  return { tipo: "pode", porEmitir: motivos.includes("por_emitir") };
}

/** O resumo do estado de um período, para a página «Faturação». */
export function resumoDoPeriodo(
  t: Textos,
  r: RelatorioOss,
  data: (iso: string) => string,
): string {
  if (r.fechado !== null) {
    return preencher(t.faturacaoOssFechadoA, { data: data(r.fechado.em) });
  }
  const n = r.impedimentos.length;
  if (n === 0) return t.faturacaoOssAberto;
  return n === 1
    ? t.faturacaoOssAbertoUmImpedimento
    : preencher(t.faturacaoOssAbertoImpedimentos, { n });
}

// ------------------------------------------------------- Classificar

/** Os países que o balde aceita, como a API os devolveu. */
export function paisesDoBalde(
  c: Classificavel,
  balde: Balde | "",
): { paises: string[]; foraDaUe: boolean } {
  const b = c.baldes.find((x) => x.balde === balde);
  return b === undefined
    ? { paises: [], foraDaUe: false }
    : { paises: b.paises, foraDaUe: b.fora_da_ue };
}

/** O valor do país «fora da UE» na lista; o código escreve-se à parte. */
export const FORA_DA_UE = "fora";

const CODIGO_PAIS = /^[A-Z]{2}$/;

/**
 * As linhas da classificação a enviar; null se faltar alguma coisa. O país
 * «fora da UE» leva o código escrito (duas letras). A coerência do país com
 * o balde confere-a a API.
 */
export function linhasAClassificar(
  escolhas: readonly { balde: Balde | ""; pais: string; codigoFora: string }[],
): { balde: Balde; pais: string }[] | null {
  const linhas: { balde: Balde; pais: string }[] = [];
  for (const e of escolhas) {
    if (e.balde === "" || e.pais === "") return null;
    const pais =
      e.pais === FORA_DA_UE ? e.codigoFora.trim().toUpperCase() : e.pais;
    if (!CODIGO_PAIS.test(pais)) return null;
    linhas.push({ balde: e.balde, pais });
  }
  return linhas.length === 0 ? null : linhas;
}

// ------------------------------------------------- O regresso do Moloni

/** A chave do pedido guardado no `sessionStorage` do separador (§30.2). */
export const CHAVE_PEDIDO_MOLONI = "eurolify-hub-moloni";

export interface PedidoMoloni {
  comerciante: string;
  ligacao: string;
  estado: string;
  expira_em: string;
}

/** Os formatos que a API aceita (`authorize/complete`). */
const CODIGO = /^[A-Za-z0-9._~-]{1,512}$/;
const ESTADO = /^[A-Za-z0-9_-]{20,100}$/;

/** O código e o `state` do fragmento (`#code=…&state=…`); null sem código. */
export function lerFragmentoMoloni(
  fragmento: string,
): { codigo: string; estado: string | null } | null {
  const q = new URLSearchParams(fragmento.replace(/^#/, ""));
  const codigo = q.get("code");
  if (codigo === null || !CODIGO.test(codigo)) return null;
  const estado = q.get("state");
  // Um `state` que vem mal formado não conta como ausente: recusa-se
  // (revisão do #408, P3-1). A cadeia vazia nunca é igual ao guardado.
  return {
    codigo,
    estado: estado === null ? null : ESTADO.test(estado) ? estado : "",
  };
}

/**
 * Uma resposta que pode ter ficado feita: sem rede, ou um 5xx sem código
 * (o proxy), como nos outros ecrãs (revisão do #408, P2-2).
 */
export function talvezFeito(e: {
  estado: number;
  codigo?: string | undefined;
}) {
  return e.estado === 0 || (e.estado >= 500 && e.codigo === undefined);
}

/** Os erros do relatório com texto próprio (revisão do #408, P2-1). */
export const TEXTO_DO_ERRO_DO_RELATORIO = {
  "tax_reports.invalid": "ossErroInvalido",
  "tax_reports.not_classifiable": "ossErroNaoClassificavel",
  "tax_reports.not_closable": "ossErroNaoFecha",
  "tax_reports.retry": "ossErroTentar",
} as const;

/** O pedido guardado, se for um; texto que não é JSON conta como nenhum. */
export function lerPedidoMoloni(texto: string | null): PedidoMoloni | null {
  if (texto === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const { comerciante, ligacao, estado, expira_em } = o;
  if (
    typeof comerciante !== "string" ||
    typeof ligacao !== "string" ||
    typeof estado !== "string" ||
    typeof expira_em !== "string"
  ) {
    return null;
  }
  return { comerciante, ligacao, estado, expira_em };
}

export type Regresso =
  | { tipo: "concluir"; pedido: PedidoMoloni; codigo: string }
  | { tipo: "sem_codigo" }
  | { tipo: "sem_pedido" }
  | { tipo: "expirado" }
  | { tipo: "estado_diferente" };

/**
 * Se o regresso se conclui: com o código do fragmento e o pedido guardado
 * neste separador, dentro do prazo e, se o Moloni devolveu um `state`, igual
 * ao guardado. Senão, porquê.
 */
export function regressoDe(
  fragmento: { codigo: string; estado: string | null } | null,
  pedido: PedidoMoloni | null,
  agora: number,
): Regresso {
  if (fragmento === null) return { tipo: "sem_codigo" };
  if (pedido === null) return { tipo: "sem_pedido" };
  const expira = new Date(pedido.expira_em).getTime();
  if (!Number.isFinite(expira) || expira <= agora) return { tipo: "expirado" };
  if (fragmento.estado !== null && fragmento.estado !== pedido.estado) {
    return { tipo: "estado_diferente" };
  }
  return { tipo: "concluir", pedido, codigo: fragmento.codigo };
}
