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
  const classe = textoOuNulo(c.classeAdr);
  if (classe !== v.classe_adr) corpo.classe_adr = classe;
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
