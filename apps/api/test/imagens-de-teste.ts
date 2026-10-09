import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

// As imagens dos testes da media. Desde que os metadados saem ao receber
// (docs/14 §3.5; issue #179), uma imagem tem de se conseguir percorrer até ao
// fim: os «primeiros bytes e um resto» de antes recusam-se. Estas não têm
// metadados, por isso o que se guarda é igual ao que se envia.

const pasta = new URL("./imagens/", import.meta.url);

function bloco(tipo: string, dados: Buffer): Buffer {
  const cabeca = Buffer.alloc(8);
  cabeca.writeUInt32BE(dados.length, 0);
  cabeca.write(tipo, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cabeca.subarray(4), dados])), 0);
  return Buffer.concat([cabeca, dados, crc]);
}

/**
 * Um PNG verdadeiro, em tons de cinzento, com uma linha de pixéis feita da
 * marca: marcas diferentes dão ficheiros diferentes (o que um resto no fim
 * já não dá, porque o que vem depois do IEND sai).
 */
export function png(marca: string): Buffer {
  const pixeis = Buffer.from(marca, "utf8");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(pixeis.length, 0); // largura
  ihdr.writeUInt32BE(1, 4); // altura
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 0; // cinzento
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr),
    bloco("IDAT", deflateSync(Buffer.concat([Buffer.from([0]), pixeis]))),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}

export const PNG = png("eurolify");
export const JPEG = readFileSync(new URL("limpa.jpg", pasta));
export const WEBP = readFileSync(new URL("limpa.webp", pasta));

/** Uma imagem de teste do disco, como foi gerada (`imagens/gerar.py`). */
export const imagem = (nome: string) => readFileSync(new URL(nome, pasta));
