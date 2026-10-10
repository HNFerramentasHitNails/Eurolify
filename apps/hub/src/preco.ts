import type { PrecoVariante } from "./api";
import type { Lingua, Textos } from "./textos";

// Definir e tirar o preço de uma variante numa lista (docs/22 §25): o que o
// ecrã confere antes de pedir e o corpo do PUT. As regras são as da API e
// da base (o limite do montante, «gratuito» só a 0, as quantidades); aqui
// só se evita um pedido que já se sabe recusado. O montante passa de texto
// a cêntimos sem vírgula flutuante (R2, §25.3).

/** O maior montante que a base aceita, em cêntimos (`docs/20` §3.4). */
export const MONTANTE_MAXIMO = 100_000_000_000;
/** O limite da quantidade mínima e do múltiplo (`docs/20` §3.4). */
export const QUANTIDADE_MAXIMA = 1_000_000;

/**
 * As casas decimais que se escrevem nesta moeda: as do `Intl.NumberFormat`,
 * no máximo duas, porque a API guarda cêntimos. No euro, duas; nas outras
 * moedas da UE não se conferiu uma a uma (§25.3).
 */
export function casasDaMoeda(moeda: string): number {
  try {
    const casas = new Intl.NumberFormat("en", {
      style: "currency",
      currency: moeda,
    }).resolvedOptions().maximumFractionDigits;
    return Math.min(casas ?? 2, 2);
  } catch {
    return 2;
  }
}

/**
 * «39,90» ou «39.90» → 3990, por texto: no máximo as casas da moeda, sem
 * separador de milhares nem sinal. `null` quando não é um preço assim.
 */
export function centimosDoTexto(texto: string, casas: number): number | null {
  const limpo = texto.trim();
  const formato =
    casas === 0
      ? /^(\d+)$/
      : new RegExp(`^(\\d+)(?:[.,](\\d{1,${String(casas)}}))?$`);
  const partes = formato.exec(limpo);
  if (partes === null) return null;
  const inteira = (partes[1] ?? "0").replace(/^0+(?=\d)/, "");
  const fraccao = (partes[2] ?? "").padEnd(2, "0");
  // Mais algarismos do que o limite: recusa-se antes de passar a número.
  if (inteira.length > 12) return Number.POSITIVE_INFINITY;
  return Number(inteira) * 100 + Number(fraccao);
}

/** 3990 → «39,90» (ou «39.90» em inglês), sem separador de milhares. */
export function textoDosCentimos(
  centimos: number,
  casas: number,
  lingua: Lingua,
): string {
  const inteira = Math.trunc(centimos / 100);
  const resto = centimos % 100;
  if (casas === 0 && resto === 0) return String(inteira);
  const separador = lingua === "en" ? "." : ",";
  return `${String(inteira)}${separador}${String(resto).padStart(2, "0")}`;
}

/** O que se escreve no formulário, como texto. */
export interface CamposPreco {
  montante: string;
  gratuito: boolean;
  minimo: string;
  multiplo: string;
}
export type CampoPreco = "montante" | "minimo" | "multiplo";
export const ORDEM_DOS_CAMPOS_PRECO: readonly CampoPreco[] = [
  "montante",
  "minimo",
  "multiplo",
];
export type ErrosPreco = Partial<Record<CampoPreco, keyof Textos>>;

/** O preço lido, como as escritas do Hub o mandam (§25.2). */
export type PrecoLido = { versao: number; definido_em: string } | null;

export interface CorpoPreco {
  montante: number;
  gratuito: boolean;
  quantidade_minima: number;
  multiplo: number;
  lido: PrecoLido;
}

export function lidoDe(preco: PrecoVariante | null): PrecoLido {
  return preco === null
    ? null
    : { versao: preco.versao, definido_em: preco.definido_em };
}

/** Os campos a partir do preço guardado (ou vazios, sem preço). */
export function camposDoPreco(
  preco: PrecoVariante | null,
  moeda: string,
  lingua: Lingua,
): CamposPreco {
  if (preco === null) {
    return { montante: "", gratuito: false, minimo: "1", multiplo: "1" };
  }
  return {
    montante: preco.gratuito
      ? ""
      : textoDosCentimos(preco.montante, casasDaMoeda(moeda), lingua),
    gratuito: preco.gratuito,
    minimo: String(preco.quantidade_minima),
    multiplo: String(preco.multiplo),
  };
}

function quantidade(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,7}$/.test(limpo)) return null;
  const n = Number(limpo);
  return n >= 1 && n <= QUANTIDADE_MAXIMA ? n : null;
}

/**
 * Os erros que o ecrã já sabe antes de pedir. Com uma redução em vigor, o
 * montante e o «gratuito» não se escrevem (vão os guardados).
 */
export function conferirPreco(
  campos: CamposPreco,
  moeda: string,
  comReducao: boolean,
): ErrosPreco {
  const erros: ErrosPreco = {};
  if (!comReducao && !campos.gratuito) {
    if (campos.montante.trim() === "") {
      erros.montante = "precoMontanteObrigatorio";
    } else {
      const c = centimosDoTexto(campos.montante, casasDaMoeda(moeda));
      if (c === null) erros.montante = "precoMontanteFormato";
      else if (c > MONTANTE_MAXIMO) erros.montante = "precoMontanteLimite";
      else if (c === 0) erros.montante = "precoZeroSoGratuito";
    }
  }
  if (quantidade(campos.minimo) === null)
    erros.minimo = "precoQuantidadeInvalida";
  if (quantidade(campos.multiplo) === null) {
    erros.multiplo = "precoQuantidadeInvalida";
  }
  return erros;
}

/**
 * O corpo do PUT, a partir de campos já conferidos. Com uma redução em
 * vigor, o montante e o «gratuito» são os guardados.
 */
export function corpoDoPreco(
  campos: CamposPreco,
  moeda: string,
  guardado: PrecoVariante | null,
  comReducao: boolean,
): CorpoPreco {
  const [montante, gratuito] =
    comReducao && guardado !== null
      ? [guardado.montante, guardado.gratuito]
      : campos.gratuito
        ? [0, true]
        : [centimosDoTexto(campos.montante, casasDaMoeda(moeda)) ?? 0, false];
  return {
    montante,
    gratuito,
    quantidade_minima: quantidade(campos.minimo) ?? 1,
    multiplo: quantidade(campos.multiplo) ?? 1,
    lido: lidoDe(guardado),
  };
}

/** O preço guardado tem tudo o que o corpo leva (a resposta perdida). */
export function precoTemOCorpo(
  guardado: PrecoVariante | null,
  corpo: Omit<CorpoPreco, "lido">,
): boolean {
  return (
    guardado !== null &&
    guardado.montante === corpo.montante &&
    guardado.gratuito === corpo.gratuito &&
    guardado.quantidade_minima === corpo.quantidade_minima &&
    guardado.multiplo === corpo.multiplo
  );
}

/**
 * Há o que guardar: os campos dizem outra coisa que o guardado (sem preço,
 * qualquer coisa escrita conta). Um montante que não se lê conta como
 * mudado, para o erro aparecer.
 */
export function precoAlterado(
  guardado: PrecoVariante | null,
  campos: CamposPreco,
  moeda: string,
  lingua: Lingua,
): boolean {
  const deAgora = camposDoPreco(guardado, moeda, lingua);
  if (guardado === null) {
    return (
      campos.montante.trim() !== "" ||
      campos.gratuito ||
      campos.minimo.trim() !== "1" ||
      campos.multiplo.trim() !== "1"
    );
  }
  if (campos.gratuito !== deAgora.gratuito) return true;
  if (!campos.gratuito) {
    const c = centimosDoTexto(campos.montante, casasDaMoeda(moeda));
    if (c !== guardado.montante) return true;
  }
  return (
    quantidade(campos.minimo) !== guardado.quantidade_minima ||
    quantidade(campos.multiplo) !== guardado.multiplo
  );
}

/**
 * Depois de um conflito (§25.3, como a §23): o que a pessoa não mexeu toma
 * o valor guardado agora; o que escreveu fica.
 */
export function camposSobreOGuardado(
  antes: PrecoVariante | null,
  agora: PrecoVariante | null,
  campos: CamposPreco,
  moeda: string,
  lingua: Lingua,
): CamposPreco {
  const deAntes = camposDoPreco(antes, moeda, lingua);
  const deAgora = camposDoPreco(agora, moeda, lingua);
  const montanteMexido =
    campos.gratuito !== deAntes.gratuito ||
    campos.montante.trim() !== deAntes.montante;
  return {
    montante: montanteMexido ? campos.montante : deAgora.montante,
    gratuito: montanteMexido ? campos.gratuito : deAgora.gratuito,
    minimo:
      campos.minimo.trim() === deAntes.minimo ? deAgora.minimo : campos.minimo,
    multiplo:
      campos.multiplo.trim() === deAntes.multiplo
        ? deAgora.multiplo
        : campos.multiplo,
  };
}
