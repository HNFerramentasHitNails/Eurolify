import type { Transportadora } from "../base/esquema.js";
import type { ChavePagamentos } from "../pagamentos/cifra.js";

// O contrato do adaptador de transportadora (docs/36 §8; docs/08 §4): o
// mesmo para o adaptador dos CTT, para o agregador e para uma transportadora
// que escreva o seu. O núcleo só conhece isto; os campos de cada
// transportadora ficam no adaptador. Na parte A só existem `servicos` e
// `testar`: as etiquetas e o seguimento são a parte B.

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
}

export interface AdaptadorTransportadora {
  readonly transportadora: Transportadora;
  /** Os serviços que a transportadora tem (parte A: sem credenciais). */
  servicos(): readonly ServicoTransportadora[];
  /** Uma chamada que confirma que as credenciais são aceites. Lança se não forem. */
  testar(credenciais: CredenciaisTransportadora): Promise<void>;
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
}
