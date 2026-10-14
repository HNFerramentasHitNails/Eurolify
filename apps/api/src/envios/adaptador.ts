import type { Transportadora } from "../base/esquema.js";
import type { ChavePagamentos } from "../pagamentos/cifra.js";

// O contrato do adaptador de transportadora (docs/36 §8; docs/08 §4): o
// mesmo para o adaptador dos CTT, para o agregador e para uma transportadora
// que escreva o seu. O núcleo só conhece isto; os campos de cada
// transportadora ficam no adaptador.

/** As credenciais de uma conta, já decifradas (só existem em memória). */
export type CredenciaisTransportadora = Readonly<Record<string, string>>;

/** Um serviço que o adaptador declara (docs/36 §8, `servicos()`). */
export interface ServicoTransportadora {
  /** O código do serviço na transportadora (o que vai na etiqueta). */
  codigo: string;
  nome: Readonly<Record<string, string>>;
  /** Os países de destino (ISO 3166-1 alfa-2). */
  paises: readonly string[];
  /** O peso máximo de um volume, em gramas; `null` se não o declara. */
  pesoMaxG: number | null;
  pedeTelefone: boolean;
  pedeEmail: boolean;
  /** Os números ONU que o serviço aceita; vazio = nenhum perigoso. */
  aceitaOnu: readonly string[];
  /**
   * Entrega num ponto de recolha ou cacifo (docs/36 §21): só serve um
   * método `ponto`, e um método `ponto` só aceita um serviço destes.
   */
  ponto?: boolean;
  /**
   * Quantos volumes (caixas) leva um envio deste serviço (docs/36 §23); sem
   * isto, 1. O `pesoMaxG` é o de cada volume.
   */
  maxVolumes?: number;
}

/**
 * Um ponto de recolha ou cacifo, como a transportadora o devolve (docs/36
 * §21). Só a morada do ponto; nunca dados de quem procura.
 */
export interface PontoRecolha {
  /** O identificador do ponto na transportadora (vai na etiqueta). */
  id: string;
  nome: string;
  linha1: string;
  codigo_postal: string;
  localidade: string;
  pais: string;
  /** A distância ao código postal procurado, em metros, se vier. */
  distanciaM: number | null;
}

/** Uma morada como vai na etiqueta (docs/36 §6: só o que a entrega precisa). */
export interface MoradaEtiqueta {
  nome: string;
  linha1: string;
  linha2?: string;
  codigo_postal: string;
  localidade: string;
  pais: string;
  telefone?: string;
  email?: string;
}

/** O pedido de etiqueta (docs/36 §8, `pedirEtiqueta`). */
export interface PedidoEtiqueta {
  /** A nossa referência, a mesma na transportadora: «<expedição>-<tentativa>» (R2). */
  referencia: string;
  /** O serviço vendido (R1): o adaptador nunca escolhe outro. */
  servico: string;
  remetente: MoradaEtiqueta;
  destinatario: MoradaEtiqueta;
  pesoG: number;
  /** O ponto de recolha escolhido no checkout (docs/36 §21), se houver. */
  ponto?: string;
  /**
   * O peso de cada volume, em gramas, quando são 2 ou mais (docs/36 §23);
   * `pesoG` é a soma. Sem isto, um volume com `pesoG`.
   */
  volumesG?: readonly number[];
  /** Para a chamada não pagar duas etiquetas (R2). */
  chaveIdempotencia: string;
}

/** A etiqueta de um volume. */
export interface EtiquetaDoVolume {
  seguimento: string;
  /** O endereço público de seguimento (https), se a transportadora o tiver. */
  urlSeguimento: string | null;
  ficheiro: { formato: "pdf" | "zpl"; conteudo: Buffer };
}

/**
 * A etiqueta emitida: a do volume 1 e, num envio com vários volumes
 * (docs/36 §23), `volumes` com todos, pela ordem pedida (o 1.º é o de cima).
 */
export interface EtiquetaEmitida extends EtiquetaDoVolume {
  volumes?: readonly EtiquetaDoVolume[];
}

export type ResultadoEtiqueta =
  | ({ estado: "emitida" } & EtiquetaEmitida)
  | { estado: "recusada"; motivo: string };

/** Um evento de seguimento já traduzido (docs/36 §3.4). */
export interface EventoSeguimento {
  idExterno: string;
  estadoTransportadora: string;
  estadoNormalizado:
    | "recolhida"
    | "em_transito"
    | "tentativa_falhada"
    | "disponivel_para_levantar"
    | "entregue"
    | "devolvida"
    | "perdida"
    | "outro";
  em: Date;
}

export type LeituraAvisoEnvio =
  | {
      valido: true;
      /** O nosso «<expedição>-<tentativa>», ou o número de seguimento. */
      referencia: string | null;
      seguimento: string | null;
      eventos: EventoSeguimento[];
    }
  | { valido: false };

export interface AdaptadorTransportadora {
  readonly transportadora: Transportadora;
  /**
   * Os campos das credenciais que a transportadora pede (docs/22 §29.2):
   * quem os declara é o adaptador, nunca o ecrã. `segredo` só muda a forma
   * de os escrever no Hub; nenhum campo volta do servidor.
   */
  readonly camposCredenciais?: readonly { campo: string; segredo: boolean }[];
  /** Os serviços que a transportadora tem (parte A: sem credenciais). */
  servicos(): readonly ServicoTransportadora[];
  /** Uma chamada que confirma que as credenciais são aceites. Lança se não forem. */
  testar(credenciais: CredenciaisTransportadora): Promise<void>;
  /**
   * Os serviços de uma conta, quando dependem dela (docs/36 §16, D1: a
   * Sendcloud). Chama-se na chamada de teste e o núcleo guarda o resultado
   * na conta; quem o tem não declara nada em `servicos()`.
   */
  servicosDaConta?(
    credenciais: CredenciaisTransportadora,
    pedido: { origem: string; destinos: readonly string[]; modo: "teste" },
  ): Promise<ServicoTransportadora[]>;
  /**
   * Os pontos de recolha de um serviço perto de um código postal (docs/36
   * §21). Só o país e o código postal saem para a transportadora. Lança
   * `ErroDeRede` quando ela não responde.
   */
  procurarPontos?(
    credenciais: CredenciaisTransportadora,
    pedido: {
      servico: string;
      pais: string;
      codigoPostal: string;
      limite: number;
    },
  ): Promise<PontoRecolha[]>;
  /**
   * Se o ponto ainda recebe encomendas, antes do botão final (docs/36
   * §21). Lança `ErroDeRede` quando a transportadora não responde.
   */
  pontoDisponivel?(
    credenciais: CredenciaisTransportadora,
    ponto: string,
  ): Promise<boolean>;
  /**
   * Pede a etiqueta. Lança `ErroDeRede` quando não se sabe se ela existe
   * (tempo esgotado, resposta que não se lê): a etiqueta fica `incerta`.
   */
  pedirEtiqueta(
    credenciais: CredenciaisTransportadora,
    pedido: PedidoEtiqueta,
  ): Promise<ResultadoEtiqueta>;
  /**
   * A etiqueta de devolução (docs/36 §22): `remetente` é o cliente e
   * `destinatario` a morada de recolha da conta. Lança `ErroDeRede` quando
   * não se sabe se ela existe: fica `incerta` e só uma pessoa a resolve.
   */
  pedirEtiquetaDevolucao?(
    credenciais: CredenciaisTransportadora,
    pedido: PedidoEtiqueta,
  ): Promise<ResultadoEtiqueta>;
  /** A etiqueta pela nossa referência: existe (com o ficheiro) ou não. */
  consultarEtiqueta(
    credenciais: CredenciaisTransportadora,
    referencia: string,
  ): Promise<EtiquetaEmitida | null>;
  /** Anula a etiqueta, se a transportadora deixar (antes de recolhida). */
  anularEtiqueta(
    credenciais: CredenciaisTransportadora,
    seguimento: string,
  ): Promise<"anulada" | "nao_permitido">;
  /** Os eventos de seguimento, já traduzidos. */
  consultarSeguimento(
    credenciais: CredenciaisTransportadora,
    seguimento: string,
  ): Promise<EventoSeguimento[]>;
  /** Confere a assinatura de um aviso e traduz os eventos. */
  lerAviso(
    cabecalhos: Record<string, string | string[] | undefined>,
    corpo: string,
    segredo: string,
  ): LeituraAvisoEnvio;
}

/**
 * Um erro de rede, de tempo esgotado ou uma resposta que não se lê: não se
 * sabe o que a transportadora fez (na parte B, a etiqueta fica `incerta`).
 */
export class ErroDeRede extends Error {
  constructor(mensagem: string, options?: ErrorOptions) {
    super(mensagem, options);
    this.name = "ErroDeRede";
  }
}

/** Os adaptadores e a chave das credenciais (criarApp). */
export interface ConfigEnvios {
  /** A chave que cifra as credenciais (ENVIOS_CHAVE), com o formato da dos pagamentos. */
  chave?: ChavePagamentos;
  adaptadores: Partial<Record<Transportadora, AdaptadorTransportadora>>;
  /** Quanto se espera por uma chamada à transportadora (por omissão 30 s). */
  tempoLimiteMs?: number;
}
