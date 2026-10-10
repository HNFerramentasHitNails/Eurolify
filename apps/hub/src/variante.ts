import {
  ORIGENS_GTIN,
  UNIDADES_DE_CONTEUDO,
  UNIDADES_DE_VENDA,
  type VarianteArtigo,
} from "./api";
import type { Textos } from "./textos";

// Alterar uma variante (docs/22 §23; docs/14 §7.1, «Alterar uma variante»):
// os campos do formulário, o que o ecrã confere antes de pedir e o corpo do
// PATCH /hub/variants/{id}, só com o que mudou. As regras são da API (e da
// base, 0048); estas cópias só servem para dizer o erro ao lado do campo
// antes de pedir. Se mudarem lá, mudam aqui; a API recusa na mesma.

const FORMATO_GTIN = /^([0-9]{8}|[0-9]{12,14})$/;
const FORMATO_ONU = /^UN[0-9]{4}$/;
const SO_ALGARISMOS = /^[0-9]+$/;
/** O maior inteiro que a base guarda (0002). */
const MAXIMO_MEDIDA = 2147483647;
export const MAXIMO_CLASSE_ADR = 16;

type Unidade = (typeof UNIDADES_DE_VENDA)[number];
type UnidadeConteudo = (typeof UNIDADES_DE_CONTEUDO)[number];
type OrigemGtin = (typeof ORIGENS_GTIN)[number];

/** O que o formulário guarda: texto, como se escreve. */
export interface CamposVariante {
  unidade: Unidade;
  gtin: string;
  gtinOrigem: OrigemGtin | "";
  quantidade: string;
  unidadeConteudo: UnidadeConteudo | "";
  peso: string;
  comprimento: string;
  largura: string;
  altura: string;
  onu: string;
  classeAdr: string;
}

export type CampoVariante = keyof CamposVariante;

export const MEDIDAS_DA_VARIANTE = [
  "quantidade",
  "peso",
  "comprimento",
  "largura",
  "altura",
] as const;

/** A ordem dos campos no ecrã: o foco vai para o primeiro com erro. */
export const ORDEM_DOS_CAMPOS: readonly CampoVariante[] = [
  "unidade",
  "quantidade",
  "unidadeConteudo",
  "gtin",
  "gtinOrigem",
  "peso",
  "comprimento",
  "largura",
  "altura",
  "onu",
  "classeAdr",
];

/** O corpo do PATCH: a versão lida e só os campos que mudam. */
export interface AlteracaoVariante {
  versao: number;
  unidade_de_venda?: Unidade;
  conteudo_quantidade?: number | null;
  conteudo_unidade?: UnidadeConteudo | null;
  gtin?: string | null;
  gtin_origem?: OrigemGtin | null;
  peso_g?: number | null;
  comprimento_mm?: number | null;
  largura_mm?: number | null;
  altura_mm?: number | null;
  onu?: string | null;
  classe_adr?: string | null;
}

const texto = (n: number | null) => (n === null ? "" : String(n));

/** O formulário com o que está guardado. */
export function camposDaVariante(v: VarianteArtigo): CamposVariante {
  return {
    unidade: v.unidade_de_venda,
    gtin: v.gtin ?? "",
    gtinOrigem: (v.gtin_origem ?? "") as OrigemGtin | "",
    quantidade: texto(v.conteudo_quantidade),
    unidadeConteudo: (v.conteudo_unidade ?? "") as UnidadeConteudo | "",
    peso: texto(v.peso_g),
    comprimento: texto(v.comprimento_mm),
    largura: texto(v.largura_mm),
    altura: texto(v.altura_mm),
    onu: v.onu ?? "",
    classeAdr: v.classe_adr ?? "",
  };
}

const numeroOuNulo = (s: string) => (s.trim() === "" ? null : Number(s.trim()));
const textoOuNulo = (s: string) => (s.trim() === "" ? null : s.trim());

/**
 * O que o ecrã confere antes de pedir: o formato do GTIN e a origem com
 * ele, números inteiros positivos, o conteúdo com quantidade e unidade, e o
 * formato do ONU. O resto (o dígito do GTIN, o GTIN repetido, o peso de uma
 * variante à venda) decide a API.
 */
export function conferirVariante(
  c: CamposVariante,
): Partial<Record<CampoVariante, keyof Textos>> {
  const e: Partial<Record<CampoVariante, keyof Textos>> = {};
  const gtin = c.gtin.trim();
  if (gtin !== "" && !FORMATO_GTIN.test(gtin)) e.gtin = "artigoNovoGtinFormato";
  else if (gtin !== "" && c.gtinOrigem === "")
    e.gtinOrigem = "artigoNovoGtinOrigemFalta";
  for (const m of MEDIDAS_DA_VARIANTE) {
    const v = c[m].trim();
    if (
      v !== "" &&
      (!SO_ALGARISMOS.test(v) || Number(v) < 1 || Number(v) > MAXIMO_MEDIDA)
    )
      e[m] = "artigoNovoInteiro";
  }
  if (e.quantidade === undefined) {
    if (c.quantidade.trim() !== "" && c.unidadeConteudo === "")
      e.unidadeConteudo = "artigoNovoConteudoIncompleto";
    else if (c.quantidade.trim() === "" && c.unidadeConteudo !== "")
      e.quantidade = "artigoNovoConteudoIncompleto";
  }
  const onu = c.onu.trim().toUpperCase();
  if (onu !== "" && !FORMATO_ONU.test(onu)) e.onu = "varianteOnuFormato";
  if (c.classeAdr.trim().length > MAXIMO_CLASSE_ADR)
    e.classeAdr = "varianteClasseAdrLonga";
  return e;
}

/**
 * O corpo do PATCH, só com o que mudou em relação ao guardado. A unidade e
 * o conteúdo só vão num rascunho (fora dele a API recusa, e o ecrã nem os
 * deixa mudar). O GTIN e a origem vão juntos, como a API pede: tirar o GTIN
 * leva os dois a nulo. Sem nada mudado, só a versão.
 */
export function alteracaoDaVariante(
  v: VarianteArtigo,
  c: CamposVariante,
  rascunho: boolean,
): AlteracaoVariante {
  const corpo: AlteracaoVariante = { versao: v.versao };
  if (rascunho) {
    if (c.unidade !== v.unidade_de_venda) corpo.unidade_de_venda = c.unidade;
    const q = numeroOuNulo(c.quantidade);
    const u = c.unidadeConteudo === "" ? null : c.unidadeConteudo;
    if (q !== v.conteudo_quantidade || u !== v.conteudo_unidade) {
      corpo.conteudo_quantidade = q;
      corpo.conteudo_unidade = u;
    }
  }
  const gtin = textoOuNulo(c.gtin);
  const origem = gtin === null || c.gtinOrigem === "" ? null : c.gtinOrigem;
  if (gtin !== v.gtin || origem !== v.gtin_origem) {
    corpo.gtin = gtin;
    corpo.gtin_origem = gtin === null ? null : origem;
  }
  const medidas = [
    ["peso", "peso_g"],
    ["comprimento", "comprimento_mm"],
    ["largura", "largura_mm"],
    ["altura", "altura_mm"],
  ] as const;
  for (const [campo, chave] of medidas) {
    const n = numeroOuNulo(c[campo]);
    if (n !== v[chave]) corpo[chave] = n;
  }
  const onu = textoOuNulo(c.onu.toUpperCase());
  if (onu !== v.onu) corpo.onu = onu;
  // A classe guardada com espaços à volta não conta como mudança (revisão
  // do #317, P3-1).
  const classe = textoOuNulo(c.classeAdr);
  if (classe !== textoOuNulo(v.classe_adr ?? "")) corpo.classe_adr = classe;
  return corpo;
}

/** Há alguma coisa por gravar (para a guarda de saída). */
export function varianteAlterada(
  v: VarianteArtigo,
  c: CamposVariante,
  rascunho: boolean,
): boolean {
  return Object.keys(alteracaoDaVariante(v, c, rascunho)).length > 1;
}

/**
 * Depois de um conflito (ou de o artigo mudar entretanto), o formulário passa
 * a partir do que está guardado agora: um campo que a pessoa não mexeu desde
 * que leu toma o valor de agora; um que mexeu fica como o escreveu. Sem
 * isto, guardar outra vez desfazia o que a outra pessoa mudou nos campos
 * em que esta não tocou (revisão do #317, P1-1).
 */
export function camposSobreOGuardado(
  lidaAntes: VarianteArtigo,
  agora: VarianteArtigo,
  campos: CamposVariante,
): CamposVariante {
  const antes = camposDaVariante(lidaAntes);
  const actuais = camposDaVariante(agora);
  const novos = { ...campos };
  for (const c of ORDEM_DOS_CAMPOS) {
    if (campos[c] === antes[c]) Object.assign(novos, { [c]: actuais[c] });
  }
  return novos;
}

// Acrescentar uma variante (docs/22 §24): o formulário começa vazio, com a
// unidade «unidade», e o corpo do POST /hub/products/{id}/variants só leva o
// que se escreveu.

export const MAXIMO_SKU = 64;

export const CAMPOS_DE_VARIANTE_NOVA: CamposVariante = {
  unidade: "unidade",
  gtin: "",
  gtinOrigem: "",
  quantidade: "",
  unidadeConteudo: "",
  peso: "",
  comprimento: "",
  largura: "",
  altura: "",
  onu: "",
  classeAdr: "",
};

/** O corpo do POST /hub/products/{id}/variants. */
export interface VarianteACriar {
  sku: string;
  unidade_de_venda: Unidade;
  gtin?: string;
  gtin_origem?: OrigemGtin;
  conteudo_quantidade?: number;
  conteudo_unidade?: UnidadeConteudo;
  peso_g?: number;
  comprimento_mm?: number;
  largura_mm?: number;
  altura_mm?: number;
  onu?: string;
  classe_adr?: string;
  valores?: string[];
}

/**
 * O corpo, só com o que se escreveu; os valores das opções escolhidos, pela
 * ordem das opções (a API recusa dois da mesma opção).
 */
export function corpoDaVarianteNova(
  sku: string,
  c: CamposVariante,
  valores: readonly string[],
): VarianteACriar {
  const corpo: VarianteACriar = {
    sku: sku.trim(),
    unidade_de_venda: c.unidade,
  };
  const gtin = textoOuNulo(c.gtin);
  if (gtin !== null && c.gtinOrigem !== "") {
    corpo.gtin = gtin;
    corpo.gtin_origem = c.gtinOrigem;
  }
  const q = numeroOuNulo(c.quantidade);
  if (q !== null && c.unidadeConteudo !== "") {
    corpo.conteudo_quantidade = q;
    corpo.conteudo_unidade = c.unidadeConteudo;
  }
  const medidas = [
    ["peso", "peso_g"],
    ["comprimento", "comprimento_mm"],
    ["largura", "largura_mm"],
    ["altura", "altura_mm"],
  ] as const;
  for (const [campo, chave] of medidas) {
    const n = numeroOuNulo(c[campo]);
    if (n !== null) corpo[chave] = n;
  }
  const onu = textoOuNulo(c.onu.toUpperCase());
  if (onu !== null) corpo.onu = onu;
  const classe = textoOuNulo(c.classeAdr);
  if (classe !== null) corpo.classe_adr = classe;
  const escolhidos = valores.filter((v) => v !== "");
  if (escolhidos.length > 0) corpo.valores = escolhidos;
  return corpo;
}

/** Alguma coisa escrita (para a guarda de saída). */
export function varianteNovaEscrita(
  sku: string,
  c: CamposVariante,
  valores: readonly string[],
): boolean {
  return (
    sku.trim() !== "" ||
    ORDEM_DOS_CAMPOS.some((k) => c[k] !== CAMPOS_DE_VARIANTE_NOVA[k]) ||
    valores.some((v) => v !== "")
  );
}
