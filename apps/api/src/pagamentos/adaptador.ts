import type { MetodoPagamento } from "../base/esquema.js";

// O contrato do adaptador de pagamento (docs/26 §9; docs/08 §4): o mesmo para
// o adaptador EuPago, para o Stripe e para um prestador de terceiros. O
// núcleo só conhece isto; os campos de cada prestador ficam no adaptador.

/** As credenciais de uma conta, já decifradas (só existem em memória). */
export interface CredenciaisConta {
  /** A chave da API do canal no prestador. */
  chave: string;
}

export interface PedidoCobranca {
  /** A nossa referência (32 hexadecimais), a mesma no prestador. */
  referencia: string;
  /** Em cêntimos. */
  montante: number;
  moeda: string;
  metodo: MetodoPagamento;
  /** E.164; o MB WAY precisa dele para pedir a aprovação. */
  telefone: string | null;
  expiraEm: Date;
}

export type ResultadoCobranca =
  | {
      estado: "a_aguardar_cliente";
      referenciaPrestador: string | null;
      instrucoes: Record<string, unknown>;
    }
  | { estado: "falhado"; motivo: string };

/** O estado de um pagamento no prestador, como o adaptador o percebe. */
export type EstadoNoPrestador =
  "a_aguardar_cliente" | "capturado" | "falhado" | "expirado" | "desconhecido";

export interface AvisoNormalizado {
  /** O identificador do evento no prestador (a idempotência). */
  idEvento: string;
  /** A nossa referência, como veio no aviso. */
  referencia: string | null;
  estado: EstadoNoPrestador;
  /** Em cêntimos, quando o aviso o diz. */
  montante: number | null;
  moeda: string | null;
}

export type LeituraAviso =
  | { valido: true; eventos: AvisoNormalizado[] }
  | { valido: false; idEvento: string | null };

/**
 * Um erro de rede, de tempo esgotado ou uma resposta que não se lê **depois
 * de pedir a cobrança**: o pagamento fica `incerto` (docs/26 R4).
 */
export class ErroDeRede extends Error {
  constructor(mensagem: string, options?: ErrorOptions) {
    super(mensagem, options);
    this.name = "ErroDeRede";
  }
}

export interface AdaptadorPagamento {
  readonly prestador: "eupago";
  readonly metodos: readonly MetodoPagamento[];
  /** Uma chamada que confirma que a chave é aceite. Lança se não for. */
  testar(credenciais: CredenciaisConta): Promise<void>;
  cobrar(
    credenciais: CredenciaisConta,
    pedido: PedidoCobranca,
  ): Promise<ResultadoCobranca>;
  consultar(
    credenciais: CredenciaisConta,
    pagamento: {
      referencia: string;
      referenciaPrestador: string | null;
      metodo: MetodoPagamento;
      instrucoes: unknown;
    },
  ): Promise<EstadoNoPrestador>;
  lerAviso(
    cabecalhos: Record<string, string | string[] | undefined>,
    corpo: string,
    segredo: string,
  ): LeituraAviso;
}

/** Os adaptadores e a chave das credenciais (criarApp). */
export interface ConfigPagamentos {
  chave?: import("./cifra.js").ChavePagamentos;
  adaptadores: Partial<Record<"eupago", AdaptadorPagamento>>;
}
