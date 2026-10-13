// Publicar um artigo pelo Hub (docs/22 §27): a lógica que não é do ecrã —
// que variantes vêm marcadas, quando «Publicar» aparece, a que corresponde
// cada impedimento, o que se faz com uma resposta perdida. As regras de
// publicar são do servidor (C2); aqui só se decide o que o ecrã mostra.

import type {
  ImpedimentoApi,
  ParDeVenda,
  PublicacaoArtigo,
  VarianteArtigo,
} from "./api";
import {
  celulaDoCanal,
  celulaDoMercado,
  type Celula,
  type LinhaDePublicacao,
} from "./publicacoes";
import type { Textos } from "./textos";

/** Os identificadores das variantes activas, pela ordem da ficha. */
export function variantesActivas(variantes: readonly VarianteArtigo[]) {
  return variantes.filter((v) => v.estado === "activa").map((v) => v.id);
}

/**
 * As variantes que vêm marcadas ao abrir (Q1, §27.5): num par sem publicação,
 * todas as activas; numa publicada, só as que não estão em `variantes_fora`
 * — a que nasceu fora ou que alguém tirou não entra numa loja sem alguém a
 * escolher. Numa que não está à venda (arquivada ou em rascunho), nenhuma: a
 * base não marca como fora a variante acrescentada entretanto, e escolhe-se
 * uma a uma o que volta à venda (Diogo, 13/10/2026: «A»; docs/22 §27.5).
 */
export function escolhaInicial(
  activas: readonly string[],
  publicacao: Pick<PublicacaoArtigo, "variantes_fora" | "estado"> | null,
): string[] {
  if (publicacao === null) return [...activas];
  if (publicacao.estado !== "publicado") return [];
  return activas.filter((v) => !publicacao.variantes_fora.includes(v));
}

/** As activas que ficam por marcar: vão em `variantes_fora`. */
export function variantesFora(
  activas: readonly string[],
  marcadas: readonly string[],
): string[] {
  return activas.filter((v) => !marcadas.includes(v));
}

/**
 * As escolhas da pessoa depois de recarregar (conflito, resposta perdida):
 * ficam as que ainda são de variantes activas; uma variante que apareceu
 * entretanto não vem marcada.
 */
export function escolhaDepoisDeRecarregar(
  marcadas: readonly string[],
  activasAgora: readonly string[],
): string[] {
  return activasAgora.filter((v) => marcadas.includes(v));
}

/** O que identifica uma escolha: o par e as variantes fora, sem ordem. */
export function chaveDaEscolha(
  canal: string,
  mercado: string,
  fora: readonly string[],
): string {
  return JSON.stringify([canal, mercado, [...fora].sort()]);
}

/** A última verificação feita, com a escolha a que respondeu. */
export interface Verificada {
  chave: string;
  impedimentos: readonly ImpedimentoApi[];
}

/**
 * «Publicar» só aparece depois de uma verificação SEM impedimentos com as
 * mesmas escolhas (§27.3): mudar uma escolha, ou receber outra verificação,
 * esconde-o.
 */
export function podePublicar(
  verificada: Verificada | null,
  chaveActual: string,
): boolean {
  return (
    verificada !== null &&
    verificada.chave === chaveActual &&
    verificada.impedimentos.length === 0
  );
}

/** Há uma verificação, mas de outras escolhas: o ecrã pede outra. */
export function verificacaoDesactualizada(
  verificada: Verificada | null,
  chaveActual: string,
): boolean {
  return verificada !== null && verificada.chave !== chaveActual;
}

/** Quantas variantes activas a publicação deixa fora (a ficha, §27.3). */
export function quantasFora(
  publicacao: Pick<PublicacaoArtigo, "variantes_fora">,
  activas: readonly string[],
): number {
  return activas.filter((v) => publicacao.variantes_fora.includes(v)).length;
}

/** Os pares onde ainda não há publicação (de nenhum estado). */
export function paresSemPublicacao(
  pares: readonly ParDeVenda[],
  publicacoes: readonly Pick<PublicacaoArtigo, "canal" | "mercado">[],
): ParDeVenda[] {
  return pares.filter(
    (p) =>
      p.canal_estado === "activo" &&
      p.mercado_estado === "activo" &&
      !publicacoes.some((x) => x.canal === p.canal && x.mercado === p.mercado),
  );
}

/** A publicação do par, ou null. */
export function publicacaoDoPar(
  publicacoes: readonly PublicacaoArtigo[],
  canal: string,
  mercado: string,
): PublicacaoArtigo | null {
  return (
    publicacoes.find((p) => p.canal === canal && p.mercado === mercado) ?? null
  );
}

const mesmasVariantes = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v) => b.includes(v));

/**
 * A resposta de publicar perdeu-se (§27.2): a publicação do par relida está
 * «publicada», com as variantes fora que se pediram e outra versão que a
 * lida. `versaoLida` é null quando ainda não havia publicação.
 */
export function publicacaoConfere(
  agora: Pick<
    PublicacaoArtigo,
    "estado" | "variantes_fora" | "versao" | "ultima_verificacao"
  > | null,
  pedidas: readonly string[],
  versaoLida: number | null,
): boolean {
  return (
    agora !== null &&
    agora.estado === "publicado" &&
    // A versão também sobe ao guardar uma verificação recusada
    // (`publicada: false`): só conta se a última verificação passou.
    (agora.ultima_verificacao?.impedimentos.length ?? 1) === 0 &&
    mesmasVariantes(agora.variantes_fora, pedidas) &&
    agora.versao !== versaoLida
  );
}

/** A resposta de retirar perdeu-se: está arquivada, com outra versão. */
export function retiradaConfere(
  agora: Pick<PublicacaoArtigo, "estado" | "versao"> | null,
  versaoLida: number,
): boolean {
  return (
    agora !== null &&
    agora.estado === "arquivado" &&
    agora.versao !== versaoLida
  );
}

/** Uma falha sem resposta da API: a rede, ou um 5xx sem o corpo da API. */
export function respostaPerdida(
  estado: number,
  codigo: string | undefined,
): boolean {
  return estado === 0 || (estado >= 500 && codigo === undefined);
}

/** O texto de uma célula (canal ou mercado) sem marcas, para frases. */
export function textoDaCelula(c: Celula): string {
  switch (c.tipo) {
    case "identificador":
      return c.identificador;
    case "nome":
      return c.nome;
    case "nome_e_loja":
      return `${c.nome} (${c.loja})`;
    case "nome_e_identificador":
      return `${c.nome} (${c.identificador})`;
  }
}

/** «Loja online · Espanha», com a loja quando o nome se repete (§19.2). */
export function rotuloDoPar(
  contexto: readonly LinhaDePublicacao[],
  par: LinhaDePublicacao,
): string {
  return `${textoDaCelula(celulaDoCanal([...contexto], par))} · ${textoDaCelula(celulaDoMercado([...contexto], par))}`;
}

// ---------------------------------------------------------------- Impedimentos

/** Onde se resolve um impedimento, quando o Hub já o resolve. */
export interface Ligacao {
  texto: keyof Textos;
  valores: Record<string, string>;
  destino: string;
}

/** Uma linha da lista de impedimentos: a frase e, se houver, a ligação. */
export interface LinhaDeImpedimento {
  codigo: string;
  texto: keyof Textos;
  valores: Record<string, string>;
  ligacao: Ligacao | null;
}

/** O que a lista precisa para dizer onde se resolve cada impedimento. */
export interface ContextoDosImpedimentos {
  artigo: string;
  /** A consulta da página (o comerciante e os filtros), sem o «?». */
  consulta: string;
  mercadoNome: string;
  variantes: readonly Pick<VarianteArtigo, "id" | "sku">[];
  /** A lista base do mercado (prl_…), se o artigo a mostra. */
  listaBase: string | null;
  podeEscrever: boolean;
  podeEscreverPrecos: boolean;
  /** Um artigo do sistema de gestão não se edita aqui (§13.3). */
  externo: boolean;
}

const TEXTO_POR_CODIGO: Record<string, keyof Textos> = {
  artigo_nao_activo: "impedimento_artigo_nao_activo",
  mercado_inactivo: "impedimento_canal_ou_mercado",
  canal_inactivo: "impedimento_canal_ou_mercado",
  canal_nao_vende_no_mercado: "impedimento_canal_ou_mercado",
  sem_variantes_a_venda: "impedimento_sem_variantes_a_venda",
  categoria_fiscal_em_falta: "impedimento_categoria_fiscal_em_falta",
  peso_em_falta: "impedimento_peso_em_falta",
  preco_em_falta: "impedimento_preco_em_falta",
  traducao_em_falta: "impedimento_traducao_em_falta",
  traducao_desactualizada: "impedimento_traducao_desactualizada",
  classificacao_em_falta: "impedimento_classificacao_em_falta",
  natureza_incompativel: "impedimento_natureza_incompativel",
  familia_restrita: "impedimento_familia_restrita",
  data_ou_local_em_falta: "impedimento_data_ou_local_em_falta",
  texto_alternativo_em_falta: "impedimento_texto_alternativo_em_falta",
};

/** As palavras do que falta num serviço com data ou local. */
const TEXTO_DO_QUE_FALTA: Record<string, keyof Textos> = {
  data: "impedimento_falta_data",
  local: "impedimento_falta_local",
  modo: "impedimento_falta_modo",
};

/**
 * Os impedimentos da API, uma linha por frase. Um peso ou preço em falta dá
 * uma linha por SKU, cada uma com a ligação para essa variante. Um código que
 * o Hub ainda não conhece mostra-se com o próprio código, nunca se esconde.
 * `textoDoQueFalta` traduz «data», «local» e «modo» na língua do ecrã.
 */
export function linhasDosImpedimentos(
  impedimentos: readonly ImpedimentoApi[],
  ctx: ContextoDosImpedimentos,
  textoDoQueFalta: (chave: keyof Textos) => string,
): LinhaDeImpedimento[] {
  const base = ctx.consulta;
  const ficha: Ligacao = {
    texto: "publicarIrFicha",
    valores: {},
    destino: `/artigos/${ctx.artigo}?${base}`,
  };
  const idDoSku = (sku: string) => ctx.variantes.find((v) => v.sku === sku)?.id;
  const linhas: LinhaDeImpedimento[] = [];
  for (const i of impedimentos) {
    const texto = TEXTO_POR_CODIGO[i.codigo];
    if (texto === undefined) {
      linhas.push({
        codigo: i.codigo,
        texto: "impedimento_desconhecido",
        valores: { codigo: i.codigo },
        ligacao: null,
      });
      continue;
    }
    switch (i.codigo) {
      case "artigo_nao_activo":
      case "texto_alternativo_em_falta":
        linhas.push({
          codigo: i.codigo,
          texto,
          valores: {},
          ligacao:
            i.codigo === "artigo_nao_activo"
              ? ficha
              : { ...ficha, texto: "publicarIrImagens" },
        });
        break;
      case "categoria_fiscal_em_falta":
        linhas.push({
          codigo: i.codigo,
          texto,
          valores: {},
          ligacao:
            ctx.podeEscrever && !ctx.externo
              ? {
                  texto: "publicarIrEditarArtigo",
                  valores: {},
                  destino: `/artigos/${ctx.artigo}/editar?${base}`,
                }
              : null,
        });
        break;
      case "peso_em_falta":
      case "preco_em_falta":
        if ((i.variantes ?? []).length === 0) {
          // Sem SKU na resposta: uma frase sem variante, nunca nenhuma.
          linhas.push({
            codigo: i.codigo,
            texto:
              i.codigo === "peso_em_falta"
                ? "impedimento_peso_em_falta_generico"
                : "impedimento_preco_em_falta_generico",
            valores: { mercado: ctx.mercadoNome },
            ligacao: null,
          });
          break;
        }
        for (const sku of i.variantes ?? []) {
          const id = idDoSku(sku);
          let ligacao: Ligacao | null = null;
          if (i.codigo === "peso_em_falta") {
            if (ctx.podeEscrever && !ctx.externo && id !== undefined) {
              ligacao = {
                texto: "publicarIrEditarVariante",
                valores: { sku },
                destino: `/artigos/${ctx.artigo}/variantes/${id}?${base}`,
              };
            }
          } else if (
            ctx.podeEscreverPrecos &&
            ctx.listaBase !== null &&
            id !== undefined
          ) {
            ligacao = {
              texto: "publicarIrPreco",
              valores: { sku },
              destino: `/artigos/${ctx.artigo}/precos/${ctx.listaBase}/${id}?${base}`,
            };
          }
          linhas.push({
            codigo: i.codigo,
            texto,
            valores: { sku, mercado: ctx.mercadoNome },
            ligacao,
          });
        }
        break;
      case "traducao_em_falta":
      case "traducao_desactualizada":
        linhas.push({
          codigo: i.codigo,
          texto,
          valores: { linguas: (i.linguas ?? []).join(", ") },
          ligacao: null,
        });
        break;
      case "familia_restrita":
        linhas.push({
          codigo: i.codigo,
          texto,
          valores: { familias: (i.familias ?? []).join(", ") },
          ligacao: null,
        });
        break;
      case "data_ou_local_em_falta":
        linhas.push({
          codigo: i.codigo,
          texto,
          valores: {
            falta: (i.falta ?? [])
              .map((f) => {
                const chave = TEXTO_DO_QUE_FALTA[f];
                return chave === undefined ? f : textoDoQueFalta(chave);
              })
              .join(", "),
          },
          ligacao: null,
        });
        break;
      default:
        // Sem ligação: Preços e mercados, ou ecrãs que ainda não existem.
        linhas.push({ codigo: i.codigo, texto, valores: {}, ligacao: null });
    }
  }
  return linhas;
}
