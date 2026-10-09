import type { TipoDeImagem } from "../base/esquema.js";

// Tira os metadados de uma imagem ao receber (docs/14 §3.5, «Metadados,
// pessoas nas imagens e ficheiros sem uso»; issue #179). Ex.: uma fotografia
// do «Gel UV» tirada com o telemóvel traz no EXIF a latitude e a longitude de
// onde foi tirada, a data e o aparelho: sai sem nada disso.
//
// Sem voltar a codificar a imagem: percorre os blocos do ficheiro e deixa de
// fora os de metadados; os blocos da imagem passam iguais, byte a byte. Uma
// lista do que fica (e não do que sai): um bloco desconhecido não passa. Um
// ficheiro que não se consegue percorrer até ao fim recusa-se — nunca se
// guarda uma imagem que não se conseguiu limpar.

export class ErroImagem extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ErroImagem";
  }
}

export function semMetadados(bytes: Buffer, tipo: TipoDeImagem): Buffer {
  switch (tipo) {
    case "image/jpeg":
      return jpeg(bytes);
    case "image/png":
      return png(bytes);
    case "image/webp":
      return webp(bytes);
  }
}

// ------------------------------------------------------------------ JPEG

const ICC = Buffer.from("ICC_PROFILE\0", "latin1");
const ADOBE = Buffer.from("Adobe", "latin1");
const EXIF = Buffer.from("Exif\0\0", "latin1");

/** Os marcadores sem tamanho: SOI, EOI, RSTn e TEM. */
const semTamanho = (m: number) =>
  m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7) || m === 0x01;

/** Os segmentos que ficam (os outros saem): o que é preciso para mostrar. */
function segmentoFica(marcador: number, dados: Buffer): boolean {
  if (marcador === 0xe0) return true; // APP0: JFIF
  if (marcador === 0xe2) return comeca(dados, ICC); // APP2: só o perfil de cor
  if (marcador === 0xee) return comeca(dados, ADOBE); // APP14: conversão de cor
  if (marcador >= 0xe0 && marcador <= 0xef) return false; // outros APPn
  if (marcador === 0xfe) return false; // COM
  // As tabelas, os quadros, os varrimentos e o resto da norma.
  return (
    (marcador >= 0xc0 && marcador <= 0xcf) || // SOFn, DHT, DAC
    (marcador >= 0xda && marcador <= 0xdf) // SOS, DQT, DNL, DRI, DHP, EXP
  );
}

const comeca = (dados: Buffer, prefixo: Buffer) =>
  dados.length >= prefixo.length &&
  dados.subarray(0, prefixo.length).equals(prefixo);

/** A orientação do EXIF (1 a 8), se houver uma válida; senão, nada. */
function orientacao(dados: Buffer): number | undefined {
  if (!comeca(dados, EXIF)) return undefined;
  const t = dados.subarray(EXIF.length);
  if (t.length < 8) return undefined;
  const ordem = t.toString("latin1", 0, 2);
  if (ordem !== "II" && ordem !== "MM") return undefined;
  const le = ordem === "II";
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  if (u16(2) !== 42) return undefined;
  const ifd = u32(4);
  if (ifd + 2 > t.length) return undefined;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) return undefined;
    // 0x0112, SHORT, um valor.
    if (u16(e) === 0x0112 && u16(e + 2) === 3 && u32(e + 4) === 1) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : undefined;
    }
  }
  return undefined;
}

/** Um APP1 novo, só com a orientação (big-endian, um IFD de uma entrada). */
function app1SoComOrientacao(valor: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // o IFD0 logo a seguir ao cabeçalho
  tiff.writeUInt16BE(1, 8); // uma entrada
  tiff.writeUInt16BE(0x0112, 10); // Orientation
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14); // um valor
  tiff.writeUInt16BE(valor, 18); // o valor, à esquerda dos 4 bytes
  tiff.writeUInt32BE(0, 22); // sem IFD seguinte
  const dados = Buffer.concat([EXIF, tiff]);
  const cabeca = Buffer.alloc(4);
  cabeca.writeUInt16BE(0xffe1, 0);
  cabeca.writeUInt16BE(dados.length + 2, 2);
  return Buffer.concat([cabeca, dados]);
}

function jpeg(b: Buffer): Buffer {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) {
    throw new ErroImagem("JPEG sem o início (SOI)");
  }
  const partes: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  let orientacaoPosta = false;
  let depoisDoVarrimento = false;
  for (;;) {
    if (depoisDoVarrimento) {
      // Os dados do varrimento: até ao próximo marcador que não seja um
      // byte 0xFF a zeros (FF00) nem um reinício (RSTn).
      const inicio = i;
      for (;;) {
        if (i + 1 >= b.length) throw new ErroImagem("JPEG cortado");
        if (b[i] === 0xff) {
          const m = b[i + 1] ?? 0;
          if (m === 0x00 || (m >= 0xd0 && m <= 0xd7)) {
            i += 2;
            continue;
          }
          if (m === 0xff) {
            i += 1;
            continue;
          }
          break;
        }
        i += 1;
      }
      partes.push(b.subarray(inicio, i));
      depoisDoVarrimento = false;
    }
    // Um marcador: 0xFF (com enchimento) e o código.
    if (b[i] !== 0xff) throw new ErroImagem("JPEG: marcador esperado");
    while (b[i] === 0xff) i += 1;
    if (i >= b.length) throw new ErroImagem("JPEG cortado");
    const m = b[i] ?? 0;
    i += 1;
    if (m === 0xd9) {
      // O fim: o que vier depois (outra imagem, com o seu EXIF) não passa.
      partes.push(Buffer.from([0xff, 0xd9]));
      return Buffer.concat(partes);
    }
    if (m === 0xd8) throw new ErroImagem("JPEG: segundo início (SOI)");
    if (semTamanho(m)) {
      partes.push(Buffer.from([0xff, m]));
      continue;
    }
    if (i + 2 > b.length) throw new ErroImagem("JPEG cortado");
    const tamanho = b.readUInt16BE(i);
    if (tamanho < 2 || i + tamanho > b.length) {
      throw new ErroImagem("JPEG: um segmento com o tamanho errado");
    }
    const dados = b.subarray(i + 2, i + tamanho);
    if (segmentoFica(m, dados)) {
      partes.push(b.subarray(i - 2, i + tamanho));
    } else if (m === 0xe1 && !orientacaoPosta) {
      const o = orientacao(dados);
      if (o !== undefined && o !== 1) {
        partes.push(app1SoComOrientacao(o));
        orientacaoPosta = true;
      }
    }
    i += tamanho;
    if (m === 0xda) depoisDoVarrimento = true;
  }
}

// ------------------------------------------------------------------- PNG

const ASSINATURA_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Os blocos que ficam: os da imagem, da cor e da animação (APNG). */
const PNG_FICA = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "cHRM",
  "gAMA",
  "iCCP",
  "sBIT",
  "sRGB",
  "cICP",
  "mDCV",
  "cLLI",
  "bKGD",
  "hIST",
  "pHYs",
  "sPLT",
  "acTL",
  "fcTL",
  "fdAT",
]);

function png(b: Buffer): Buffer {
  if (b.length < 8 || !b.subarray(0, 8).equals(ASSINATURA_PNG)) {
    throw new ErroImagem("PNG sem a assinatura");
  }
  const partes: Buffer[] = [ASSINATURA_PNG];
  let i = 8;
  let primeiro = true;
  for (;;) {
    if (i + 12 > b.length) throw new ErroImagem("PNG cortado");
    const tamanho = b.readUInt32BE(i);
    const tipo = b.toString("latin1", i + 4, i + 8);
    const fim = i + 12 + tamanho;
    if (tamanho > 0x7fffffff || fim > b.length) {
      throw new ErroImagem("PNG: um bloco com o tamanho errado");
    }
    if (!/^[A-Za-z]{4}$/.test(tipo))
      throw new ErroImagem("PNG: bloco inválido");
    if (primeiro && tipo !== "IHDR") throw new ErroImagem("PNG sem o IHDR");
    primeiro = false;
    // Um bloco crítico (maiúscula) desconhecido: não se sabe mostrar.
    const critico = tipo.charCodeAt(0) < 0x61;
    if (PNG_FICA.has(tipo)) {
      partes.push(b.subarray(i, fim));
    } else if (critico) {
      throw new ErroImagem(`PNG: bloco crítico desconhecido ${tipo}`);
    }
    i = fim;
    // O que vier depois do IEND não passa.
    if (tipo === "IEND") return Buffer.concat(partes);
  }
}

// ------------------------------------------------------------------ WebP

/** Os blocos que ficam: a imagem, a animação, a transparência e a cor. */
const WEBP_FICA = new Set([
  "VP8 ",
  "VP8L",
  "VP8X",
  "ANIM",
  "ANMF",
  "ALPH",
  "ICCP",
]);

function webp(b: Buffer): Buffer {
  if (
    b.length < 12 ||
    b.toString("latin1", 0, 4) !== "RIFF" ||
    b.toString("latin1", 8, 12) !== "WEBP"
  ) {
    throw new ErroImagem("WebP sem o cabeçalho RIFF/WEBP");
  }
  const total = b.readUInt32LE(4) + 8;
  if (total > b.length || total < 12) {
    throw new ErroImagem("WebP: o tamanho do RIFF não bate com o ficheiro");
  }
  const blocos: Buffer[] = [];
  let i = 12;
  while (i < total) {
    if (i + 8 > total) throw new ErroImagem("WebP cortado");
    const tipo = b.toString("latin1", i, i + 4);
    const tamanho = b.readUInt32LE(i + 4);
    const fim = i + 8 + tamanho + (tamanho % 2);
    if (fim > total)
      throw new ErroImagem("WebP: um bloco com o tamanho errado");
    if (WEBP_FICA.has(tipo)) {
      const bloco = Buffer.from(b.subarray(i, fim));
      if (tipo === "VP8X" && tamanho >= 1) {
        // Tira as marcas de EXIF (0x08) e XMP (0x04).
        bloco[8] = (bloco[8] ?? 0) & ~0x0c;
      }
      blocos.push(bloco);
    }
    i = fim;
  }
  if (!blocos.some((x) => /^VP8[ LX]$/.test(x.toString("latin1", 0, 4)))) {
    throw new ErroImagem("WebP sem imagem");
  }
  const corpo = Buffer.concat(blocos);
  const cabeca = Buffer.alloc(12);
  cabeca.write("RIFF", 0, "latin1");
  cabeca.writeUInt32LE(corpo.length + 4, 4);
  cabeca.write("WEBP", 8, "latin1");
  return Buffer.concat([cabeca, corpo]);
}
