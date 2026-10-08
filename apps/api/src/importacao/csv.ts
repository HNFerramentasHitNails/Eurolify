// Um leitor de CSV (RFC 4180) para as importações (docs/14 §3.11,
// «Importação do catálogo»), sem biblioteca de fora: vírgula, aspas
// duplicadas dentro de aspas, quebras de linha dentro de aspas, CRLF ou LF,
// e a marca de ordem dos bytes no início (a exportação põe-na). Devolve as
// linhas como listas de células, com o número da linha no ficheiro onde
// cada uma começa (para o relatório).

export class ErroCsv extends Error {
  constructor(
    readonly linha: number,
    motivo: string,
  ) {
    super(`csv, linha ${String(linha)}: ${motivo}`);
    this.name = "ErroCsv";
  }
}

export interface LinhaCsv {
  /** O número da linha no ficheiro (a primeira é a 1). */
  numero: number;
  celulas: string[];
}

export function lerCsv(texto: string): LinhaCsv[] {
  const t = texto.startsWith("﻿") ? texto.slice(1) : texto;
  const linhas: LinhaCsv[] = [];
  let celulas: string[] = [];
  let celula = "";
  let entreAspas = false;
  let depoisDeAspas = false;
  let numero = 1;
  let inicio = 1;
  let vazia = true;
  const fecharCelula = () => {
    celulas.push(celula);
    celula = "";
    depoisDeAspas = false;
  };
  const fecharLinha = () => {
    fecharCelula();
    // Uma linha sem nada (a última, depois do CRLF final) não conta.
    if (!(vazia && celulas.length === 1 && celulas[0] === "")) {
      linhas.push({ numero: inicio, celulas });
    }
    celulas = [];
    vazia = true;
  };
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    if (entreAspas) {
      if (c === '"') {
        if (t.charAt(i + 1) === '"') {
          celula += '"';
          i++;
        } else {
          entreAspas = false;
          depoisDeAspas = true;
        }
      } else {
        if (c === "\n") numero++;
        celula += c;
      }
      continue;
    }
    if (c === '"') {
      if (celula !== "" || depoisDeAspas) {
        throw new ErroCsv(numero, "aspas no meio de uma célula sem aspas");
      }
      entreAspas = true;
      vazia = false;
    } else if (c === ",") {
      fecharCelula();
      vazia = false;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && t.charAt(i + 1) === "\n") i++;
      fecharLinha();
      numero++;
      inicio = numero;
    } else {
      if (depoisDeAspas) {
        throw new ErroCsv(numero, "texto depois das aspas de fecho");
      }
      celula += c;
      vazia = false;
    }
  }
  if (entreAspas) throw new ErroCsv(inicio, "aspas por fechar");
  fecharLinha();
  return linhas;
}

/** A guarda contra fórmulas que a exportação põe (`'=`, `'+`, `'-`, `'@`…). */
const COM_APOSTROFO = /^'[=+\-@\t\r]/;

/** Tira o apóstrofo que a exportação pôs à frente de uma fórmula, e só esse. */
export const semGuarda = (celula: string) =>
  COM_APOSTROFO.test(celula) ? celula.slice(1) : celula;
