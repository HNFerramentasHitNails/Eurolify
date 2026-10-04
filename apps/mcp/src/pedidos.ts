import { randomInt } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Os únicos pedidos que o MCP pode fazer ao serviço da máquina (ADR-0033).
 * O serviço da máquina (eurolify-trabalho, fluxo «mcp») valida-os outra vez.
 */
export const PEDIDOS_PERMITIDOS =
  /^(medir|publicacoes|copia|reposicao|reiniciar-api|actualizar|reiniciar-vps|publicar sha256:[0-9a-f]{64})$/;

export function pedidoValido(comando: string): boolean {
  return comando.length <= 200 && PEDIDOS_PERMITIDOS.test(comando);
}

export interface Resposta {
  codigo: number;
  saida: string;
}

/**
 * Deixa um pedido na pasta partilhada com a máquina e espera pela resposta,
 * como o eurolify-pedido das chaves dos fluxos: a primeira linha é o comando,
 * a segunda o identificador; a resposta vem em resultado.<id>.
 * Um pedido de cada vez (a pasta é uma fila de um lugar).
 */
export class FilaDePedidos {
  private ultimo: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly pasta: string,
    private readonly esperaMs = 120_000,
    private readonly intervaloMs = 500,
  ) {}

  pedir(comando: string): Promise<Resposta> {
    if (!pedidoValido(comando)) {
      return Promise.reject(new Error("pedido fora da lista permitida"));
    }
    const vez = this.ultimo.then(
      () => this.executar(comando),
      () => this.executar(comando),
    );
    this.ultimo = vez.catch(() => undefined);
    return vez;
  }

  private async executar(comando: string): Promise<Resposta> {
    const id = `${String(Date.now())}${String(randomInt(1_000_000, 9_999_999))}`;
    const temporario = join(this.pasta, "pedido.tmp");
    await writeFile(temporario, `${comando}\n${id}\n`, { mode: 0o600 });
    await rename(temporario, join(this.pasta, "pedido"));

    const resposta = join(this.pasta, `resultado.${id}`);
    const limite = Date.now() + this.esperaMs;
    while (Date.now() < limite) {
      try {
        const texto = await readFile(resposta, "utf8");
        await rm(resposta, { force: true });
        const [primeira = "", ...resto] = texto.split("\n");
        const codigo = /^\d+$/.test(primeira) ? Number(primeira) : 70;
        return { codigo, saida: resto.join("\n").trimEnd() };
      } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro;
      }
      await new Promise((r) => setTimeout(r, this.intervaloMs));
    }
    throw new Error(
      `sem resposta da máquina em ${String(this.esperaMs / 1000)} s (o serviço eurolify-pedido@mcp correu?)`,
    );
  }
}
