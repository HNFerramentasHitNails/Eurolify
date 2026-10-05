import { randomBytes } from "node:crypto";

/**
 * Confirmação das acções do MCP em dois passos, no servidor (#92, ADR-0033).
 *
 * O primeiro pedido de uma acção não a executa: guarda o comando e devolve um
 * código de uso único, ligado à conta e ao comando exacto, que caduca. Só o
 * segundo pedido, com esse código, executa. O servidor não prova que foi uma
 * pessoa a dizer «sim»; garante que nenhuma acção corre numa só chamada e que
 * a confirmação é da mesma conta e da mesma acção, com os mesmos argumentos.
 */

/** Sem letras nem algarismos que se confundam (0/O, 1/I/L). */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TAMANHO = 8;

export const VALIDADE_MS = 5 * 60_000;
/** Códigos por confirmar, por conta: o resto é recusado até caducarem. */
export const MAXIMO_POR_CONTA = 5;

interface Pendente {
  conta: string;
  comando: string;
  expira: number;
}

export type ResultadoConfirmacao =
  | { ok: true }
  | {
      ok: false;
      motivo: "desconhecido" | "caducado" | "outra_conta" | "outro_comando";
    };

export class Confirmacoes {
  private readonly pendentes = new Map<string, Pendente>();

  constructor(private readonly agora: () => number = Date.now) {}

  /** Guarda o comando por confirmar e devolve o código, ou `null` se a conta já tem códigos a mais. */
  pedir(conta: string, comando: string): string | null {
    this.limpar();
    let daConta = 0;
    for (const p of this.pendentes.values()) {
      if (p.conta === conta) daConta++;
    }
    if (daConta >= MAXIMO_POR_CONTA) return null;

    let codigo: string;
    do {
      codigo = gerarCodigo();
    } while (this.pendentes.has(codigo));
    this.pendentes.set(codigo, {
      conta,
      comando,
      expira: this.agora() + VALIDADE_MS,
    });
    return codigo;
  }

  /**
   * Gasta o código se for desta conta e deste comando e ainda valer. Um código
   * de outra conta não se gasta (não deixa uma conta anular o de outra); um
   * código com outro comando gasta-se (quem o tentou usar mal tem de pedir de novo).
   */
  confirmar(
    conta: string,
    comando: string,
    codigo: string,
  ): ResultadoConfirmacao {
    const chave = codigo.trim().toUpperCase();
    const p = this.pendentes.get(chave);
    if (p === undefined) return { ok: false, motivo: "desconhecido" };
    if (p.conta !== conta) return { ok: false, motivo: "outra_conta" };
    this.pendentes.delete(chave);
    if (this.agora() >= p.expira) return { ok: false, motivo: "caducado" };
    if (p.comando !== comando) return { ok: false, motivo: "outro_comando" };
    return { ok: true };
  }

  private limpar(): void {
    const agora = this.agora();
    for (const [codigo, p] of this.pendentes) {
      if (agora >= p.expira) this.pendentes.delete(codigo);
    }
  }
}

function gerarCodigo(): string {
  // Rejeita-se o que passa do maior múltiplo do alfabeto abaixo de 256, para
  // todas as letras saírem com a mesma probabilidade.
  const limite = 256 - (256 % ALFABETO.length);
  let codigo = "";
  while (codigo.length < TAMANHO) {
    for (const byte of randomBytes(TAMANHO * 2)) {
      if (byte < limite && codigo.length < TAMANHO) {
        codigo += ALFABETO.charAt(byte % ALFABETO.length);
      }
    }
  }
  return codigo;
}
