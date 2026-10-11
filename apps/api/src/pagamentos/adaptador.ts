import type { MetodoPagamento } from "../base/esquema.js";

// O contrato do adaptador de pagamento (docs/26 §9; docs/08 §4): o mesmo para
// o adaptador EuPago, para o Stripe e para um prestador de terceiros. O
// núcleo só conhece isto; os campos de cada prestador ficam no adaptador.

/** As credenciais de uma conta, já decifradas (só existem em memória). */
export interface CredenciaisConta {
  /** A chave da API do canal no prestador. */
  chave: string;
  /**
   * As credenciais OAuth, que o reembolso da EuPago pede em vez da chave
   * (docs/30 §13, E4 e P1). Sem elas, reembolsa-se à mão.
   */
  oauth?: { clientId: string; clientSecret: string };
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
  /**
   * O identificador da transacção no prestador (o `trid` da EuPago), que o
   * reembolso pede (docs/30 §13, P2).
   */
  idTransaccao: string | null;
  /**
   * `reembolsado`: o prestador diz que houve um reembolso deste pagamento.
   * Não muda o pagamento sozinho (docs/30 §13, P6).
   */
  estado: EstadoNoPrestador | "reembolsado";
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

/**
 * Uma falha **antes** de pedir o reembolso (o token, as credenciais, a
 * moeda): sabe-se que nada saiu, e o reembolso fica `falhado`.
 */
export class ErroSemEnvio extends Error {
  constructor(mensagem: string, options?: ErrorOptions) {
    super(mensagem, options);
    this.name = "ErroSemEnvio";
  }
}

export interface PedidoReembolso {
  /** O identificador da transacção no prestador (o `trid`). */
  idTransaccao: string;
  /** Em cêntimos. */
  montante: number;
  moeda: string;
  /** A nossa referência (`rfd_…`): não há chave de idempotência (R7). */
  referencia: string;
}

export type ResultadoReembolso =
  | { estado: "pedido"; idReembolso: string }
  | { estado: "recusado"; motivo: string };

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
  /** Os métodos que o prestador reembolsa sem o IBAN do cliente (Q8). */
  readonly reembolsaPorApi: readonly MetodoPagamento[];
  /**
   * Pede o reembolso. Lança `ErroSemEnvio` se nada saiu e `ErroDeRede` se
   * não se sabe (docs/30 §13, P5).
   */
  reembolsar(
    credenciais: CredenciaisConta,
    pedido: PedidoReembolso,
  ): Promise<ResultadoReembolso>;
  /** O estado de um reembolso aceite: só `reembolsado` conta (E3, P6). */
  consultarReembolso(
    credenciais: CredenciaisConta,
    idReembolso: string,
  ): Promise<"reembolsado" | "desconhecido">;
}

/** Os adaptadores e a chave das credenciais (criarApp). */
export interface ConfigPagamentos {
  chave?: import("./cifra.js").ChavePagamentos;
  adaptadores: Partial<Record<"eupago", AdaptadorPagamento>>;
}
