import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { TIPOS_DE_IMAGEM, type TipoDeImagem } from "../base/esquema.js";

// Onde vivem os bytes das imagens (docs/14 §3.5; docs/06, CQ). A API só
// fala com esta interface: hoje, uma pasta do disco da VPS; mais tarde, um
// serviço europeu de ficheiros é outra implementação, sem mudar as rotas.

export interface Armazenamento {
  /**
   * Quantos bytes de imagens cada comerciante pode ter (**proposta**,
   * docs/14 §3.5): sem isto, uma chave enchia o disco da VPS.
   */
  readonly quotaPorComerciante: number;
  /** Guarda os bytes; guardar outra vez o mesmo resumo não muda nada. */
  guardar(comercianteId: string, resumo: string, bytes: Buffer): Promise<void>;
  /** Os bytes guardados; um que não existe é um erro. */
  ler(comercianteId: string, resumo: string): Promise<Buffer>;
}

/** O tamanho máximo de uma imagem (**proposta**, docs/14 §3.5): 10 MB. */
export const TAMANHO_MAXIMO = 10 * 1024 * 1024;

/** O espaço de imagens por comerciante (**proposta**, docs/14 §3.5): 1 GiB. */
export const QUOTA_POR_COMERCIANTE = 1024 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RESUMO = /^[0-9a-f]{64}$/;

/**
 * Uma pasta por comerciante, um ficheiro por resumo. O comerciante e o
 * resumo conferem-se antes de formar o caminho: nada que venha de fora sai
 * da pasta (nem `..`, nem barras).
 */
export class ArmazenamentoEmDisco implements Armazenamento {
  constructor(
    private readonly pasta: string,
    readonly quotaPorComerciante: number = QUOTA_POR_COMERCIANTE,
  ) {}

  private caminho(comercianteId: string, resumo: string) {
    if (!UUID.test(comercianteId) || !RESUMO.test(resumo)) {
      throw new Error("armazenamento: comerciante ou resumo fora do formato");
    }
    return {
      dir: join(this.pasta, comercianteId),
      ficheiro: join(this.pasta, comercianteId, resumo),
    };
  }

  async guardar(comercianteId: string, resumo: string, bytes: Buffer) {
    const { dir, ficheiro } = this.caminho(comercianteId, resumo);
    try {
      // Já existe com o tamanho certo: o nome é o resumo do conteúdo. Um
      // ficheiro com outro tamanho (uma escrita cortada) escreve-se outra vez
      // (revisão do #176, P2-2).
      if ((await stat(ficheiro)).size === bytes.length) return;
    } catch {
      // Não existe: escreve-se.
    }
    await mkdir(dir, { recursive: true, mode: 0o750 });
    // Escreve-se ao lado, assegura-se no disco e muda-se o nome: quem lê
    // nunca vê meio ficheiro, e uma queda da máquina não deixa um ficheiro
    // vazio com o nome certo.
    const temporario = `${ficheiro}.${randomUUID()}.tmp`;
    try {
      const f = await open(temporario, "wx", 0o640);
      try {
        await f.writeFile(bytes);
        await f.sync();
      } finally {
        await f.close();
      }
      await rename(temporario, ficheiro);
    } catch (erro) {
      await unlink(temporario).catch(() => undefined);
      throw erro;
    }
    const pastaAberta = await open(dir, "r");
    try {
      await pastaAberta.sync();
    } finally {
      await pastaAberta.close();
    }
  }

  async ler(comercianteId: string, resumo: string) {
    return readFile(this.caminho(comercianteId, resumo).ficheiro);
  }
}

/**
 * O tipo da imagem pelos primeiros bytes (as assinaturas do JPEG, do PNG e
 * do WebP), ou `null`. Não descodifica a imagem.
 */
export function tipoDosBytes(bytes: Buffer): TipoDeImagem | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export const eTipoDeImagem = (tipo: string): tipo is TipoDeImagem =>
  (TIPOS_DE_IMAGEM as readonly string[]).includes(tipo);
