import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
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
  /**
   * Apaga os bytes (a limpeza dos ficheiros sem uso, docs/14 §3.5); um que
   * já não existe não é erro.
   */
  apagar(comercianteId: string, resumo: string): Promise<void>;
}

/**
 * Onde vivem os ZIP das exportações (docs/14 §3.11; docs/06, CS). À parte
 * das imagens: um armazenamento só de imagens (os testes) não exporta.
 */
export interface ArmazenamentoDeExportacoes extends Armazenamento {
  /**
   * Um caminho novo onde se escreve o ZIP, ao lado do sítio final, ainda
   * sem nome definitivo.
   */
  temporarioDeExportacao(comercianteId: string): Promise<string>;
  /** Assegura o ZIP no disco e dá-lhe o nome final, pelo id. */
  guardarExportacao(
    comercianteId: string,
    id: string,
    temporario: string,
  ): Promise<void>;
  /** O ZIP para enviar; um que não existe é um erro. */
  abrirExportacao(
    comercianteId: string,
    id: string,
  ): Promise<{ conteudo: Readable; bytes: number }>;
  /**
   * Apaga da pasta do comerciante tudo o que não seja o ZIP de uma das
   * exportações a `manter`: as expiradas, os ZIP sem linha e os temporários
   * que ficaram. Só se chama com a vez do comerciante (nenhuma exportação
   * dele a meio). Devolve quantos apagou.
   */
  limparExportacoes(
    comercianteId: string,
    manter: ReadonlySet<string>,
  ): Promise<number>;
  /** Apaga um temporário que não chegou a ser guardado (sem erro se não há). */
  largarTemporario(temporario: string): Promise<void>;
}

/** Há quanto tempo um ficheiro sem linha tem de estar parado para se apagar. */
export const LIMPAR_DEPOIS_DE_MS = 60 * 60 * 1000;

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
export class ArmazenamentoEmDisco implements ArmazenamentoDeExportacoes {
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

  async apagar(comercianteId: string, resumo: string) {
    const { dir, ficheiro } = this.caminho(comercianteId, resumo);
    try {
      await unlink(ficheiro);
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") return;
      throw erro;
    }
    // Como ao guardar: a mudança na pasta fica no disco.
    const pastaAberta = await open(dir, "r");
    try {
      await pastaAberta.sync();
    } finally {
      await pastaAberta.close();
    }
  }

  /**
   * As exportações vivem em `.exportacoes/<comerciante>/`, ao lado das
   * imagens mas fora das pastas delas: a cópia diária da VPS deixa-as de
   * fora (eurolify-copia), porque se refazem e duram 7 dias.
   */
  private pastaDeExportacoes(comercianteId: string) {
    if (!UUID.test(comercianteId)) {
      throw new Error("armazenamento: comerciante fora do formato");
    }
    return join(this.pasta, ".exportacoes", comercianteId);
  }

  private caminhoDaExportacao(comercianteId: string, id: string) {
    if (!UUID.test(id)) {
      throw new Error("armazenamento: exportação fora do formato");
    }
    return join(this.pastaDeExportacoes(comercianteId), `${id}.zip`);
  }

  async temporarioDeExportacao(comercianteId: string) {
    const dir = this.pastaDeExportacoes(comercianteId);
    await mkdir(dir, { recursive: true, mode: 0o750 });
    return join(dir, `${randomUUID()}.zip.tmp`);
  }

  async guardarExportacao(
    comercianteId: string,
    id: string,
    temporario: string,
  ) {
    const dir = this.pastaDeExportacoes(comercianteId);
    if (!temporario.startsWith(`${dir}/`) || !temporario.endsWith(".tmp")) {
      throw new Error("armazenamento: temporário fora da pasta");
    }
    const f = await open(temporario, "r+");
    try {
      await f.sync();
    } finally {
      await f.close();
    }
    await rename(temporario, this.caminhoDaExportacao(comercianteId, id));
    const pastaAberta = await open(dir, "r");
    try {
      await pastaAberta.sync();
    } finally {
      await pastaAberta.close();
    }
  }

  async abrirExportacao(comercianteId: string, id: string) {
    const caminho = this.caminhoDaExportacao(comercianteId, id);
    // Abre já: um ficheiro que não existe é erro aqui, não a meio do envio.
    const f = await open(caminho, "r");
    try {
      const { size } = await f.stat();
      return { conteudo: f.createReadStream(), bytes: size };
    } catch (erro) {
      await f.close();
      throw erro;
    }
  }

  async limparExportacoes(comercianteId: string, manter: ReadonlySet<string>) {
    const dir = this.pastaDeExportacoes(comercianteId);
    let nomes: string[];
    try {
      nomes = await readdir(dir);
    } catch {
      return 0;
    }
    const ficam = new Set([...manter].map((id) => `${id}.zip`));
    // Só o que tem mais de uma hora: um ZIP ou um temporário recente pode
    // ser de outra instância da API a meio (ao publicar, a antiga e a nova
    // atendem ao mesmo tempo; 2.ª revisão do #189, P2-A).
    const antes = Date.now() - LIMPAR_DEPOIS_DE_MS;
    let apagados = 0;
    for (const nome of nomes) {
      if (ficam.has(nome)) continue;
      const caminho = join(dir, nome);
      try {
        const info = await stat(caminho);
        if (!info.isFile() || info.mtimeMs > antes) continue;
        await unlink(caminho);
        apagados++;
      } catch {
        // Um ficheiro que outro já apagou, ou que não se deixa apagar, não
        // impede a exportação (2.ª revisão do #189, P2-B); a limpeza geral
        // (#179) apanha-o.
      }
    }
    return apagados;
  }

  async largarTemporario(temporario: string) {
    if (!temporario.endsWith(".tmp")) return;
    await unlink(temporario).catch(() => undefined);
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

/** O armazenamento dado também guarda exportações? */
export const guardaExportacoes = (
  a: Armazenamento,
): a is ArmazenamentoDeExportacoes =>
  typeof (a as Partial<ArmazenamentoDeExportacoes>).guardarExportacao ===
  "function";

export const eTipoDeImagem = (tipo: string): tipo is TipoDeImagem =>
  (TIPOS_DE_IMAGEM as readonly string[]).includes(tipo);
