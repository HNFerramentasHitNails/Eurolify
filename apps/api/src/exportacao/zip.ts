import type { FileHandle } from "node:fs/promises";
import { crc32, deflateRawSync } from "node:zlib";

// Um escritor de ZIP mínimo para as exportações (docs/14 §3.11; docs/06, CS),
// sem biblioteca de fora: o formato é o do APPNOTE da PKWARE (cabeçalho local,
// dados, directório central e o fim do directório), sem ZIP64. Cada entrada
// escreve-se inteira de uma vez, com o CRC-32 e os tamanhos já sabidos, por
// isso não há descritores de dados. Os nomes vão em UTF-8 (bit 11).
//
// Sem ZIP64, o ZIP tem no máximo 65 535 entradas e 4 GiB menos um byte (e
// cada deslocamento cabe em 32 bits): acima disso, `ErroZipGrandeDemais`. A
// quota de imagens (1 GiB) fica bem abaixo; o limite é a rede para o resto.

export const MAX_ENTRADAS = 0xffff;
export const MAX_BYTES = 0xffffffff;

export class ErroZipGrandeDemais extends Error {
  constructor(motivo: string) {
    super(`zip: ${motivo}`);
    this.name = "ErroZipGrandeDemais";
  }
}

interface Central {
  nome: Buffer;
  metodo: number;
  crc: number;
  comprimido: number;
  original: number;
  deslocamento: number;
}

/** A data e a hora no formato do MS-DOS (em UTC; o ZIP não guarda o fuso). */
function dataDos(d: Date): { hora: number; data: number } {
  const ano = Math.max(1980, Math.min(2107, d.getUTCFullYear()));
  return {
    hora:
      (d.getUTCHours() << 11) |
      (d.getUTCMinutes() << 5) |
      Math.floor(d.getUTCSeconds() / 2),
    data: ((ano - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

const NOME_SEGURO = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\0]+$/;

export class EscritorZip {
  private readonly centrais: Central[] = [];
  private posicao = 0;
  private readonly quando: { hora: number; data: number };

  constructor(
    private readonly ficheiro: FileHandle,
    quando: Date,
  ) {
    this.quando = dataDos(quando);
  }

  private async escrever(bytes: Buffer) {
    if (this.posicao + bytes.length > MAX_BYTES) {
      throw new ErroZipGrandeDemais("mais de 4 GiB");
    }
    await this.ficheiro.write(bytes, 0, bytes.length, this.posicao);
    this.posicao += bytes.length;
  }

  /**
   * Acrescenta uma entrada. `comprimir`: deflate (texto); sem ele, guardada
   * como está (as imagens já vêm comprimidas).
   */
  async acrescentar(nome: string, dados: Buffer, comprimir: boolean) {
    if (!NOME_SEGURO.test(nome)) {
      throw new Error(`zip: nome de entrada inválido: ${nome}`);
    }
    if (this.centrais.length >= MAX_ENTRADAS) {
      throw new ErroZipGrandeDemais("mais de 65 535 ficheiros");
    }
    const nomeBytes = Buffer.from(nome, "utf8");
    const crc = crc32(dados);
    const corpo = comprimir ? deflateRawSync(dados) : dados;
    const metodo = comprimir ? 8 : 0;
    if (dados.length > MAX_BYTES || corpo.length > MAX_BYTES) {
      throw new ErroZipGrandeDemais("uma entrada com mais de 4 GiB");
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão para extrair: 2.0
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(this.quando.hora, 10);
    local.writeUInt16LE(this.quando.data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const deslocamento = this.posicao;
    await this.escrever(Buffer.concat([local, nomeBytes]));
    await this.escrever(corpo);
    this.centrais.push({
      nome: nomeBytes,
      metodo,
      crc,
      comprimido: corpo.length,
      original: dados.length,
      deslocamento,
    });
  }

  /** Escreve o directório central e o fim; devolve o tamanho do ZIP. */
  async fechar(): Promise<number> {
    const inicio = this.posicao;
    for (const c of this.centrais) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4); // feito por: 2.0
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(c.metodo, 10);
      h.writeUInt16LE(this.quando.hora, 12);
      h.writeUInt16LE(this.quando.data, 14);
      h.writeUInt32LE(c.crc, 16);
      h.writeUInt32LE(c.comprimido, 20);
      h.writeUInt32LE(c.original, 24);
      h.writeUInt16LE(c.nome.length, 28);
      // extra, comentário, disco, atributos internos e externos: zero
      h.writeUInt32LE(c.deslocamento, 42);
      await this.escrever(Buffer.concat([h, c.nome]));
    }
    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(this.centrais.length, 8);
    fim.writeUInt16LE(this.centrais.length, 10);
    fim.writeUInt32LE(this.posicao - inicio, 12);
    fim.writeUInt32LE(inicio, 16);
    await this.escrever(fim);
    return this.posicao;
  }
}
