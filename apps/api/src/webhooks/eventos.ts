// O que sai nos webhooks (docs/38 §6; docs/18 §5; docs/06, CH). O corpo de
// cada tipo leva só os campos desta lista: um campo que a outbox ganhe
// amanhã (ou o `quem`, que fica na base) não sai sem se decidir aqui. Os
// identificadores vão com o prefixo público, como nas respostas da API.

/** O prefixo público de cada campo; `null`: o valor vai como está. */
type Campos = Record<string, string | null>;

interface TipoDeEvento {
  /** O prefixo do identificador do agregado. */
  agregado: string;
  campos: Campos;
}

const PUBLICACAO: Campos = {
  artigo_id: "prd",
  publicacao_id: "pub",
  canal_id: "chn",
  mercado_id: "mkt",
  em: null,
};

export const TIPOS_DE_EVENTO = {
  "product.published": { agregado: "prd", campos: PUBLICACAO },
  "product.unpublished": {
    agregado: "prd",
    campos: { ...PUBLICACAO, motivo: null },
  },
  "product.archived": { agregado: "prd", campos: { artigo_id: "prd" } },
  "price.changed": {
    agregado: "var",
    campos: {
      lista_id: "prl",
      variante_id: "var",
      montante_antigo: null,
      montante_novo: null,
      gratuito: null,
      saiu: null,
      moeda: null,
      preco_inclui_iva: null,
      em: null,
    },
  },
  "market.activated": {
    agregado: "mkt",
    campos: { mercado_id: "mkt", loja_id: "sto" },
  },
  "market.archived": {
    agregado: "mkt",
    campos: { mercado_id: "mkt", loja_id: "sto" },
  },
} as const satisfies Record<string, TipoDeEvento>;

export type TipoDeEventoPublico = keyof typeof TIPOS_DE_EVENTO;
export const LISTA_DE_TIPOS = Object.keys(
  TIPOS_DE_EVENTO,
) as TipoDeEventoPublico[];

export interface EventoDaBase {
  id: string;
  tipo: string;
  versao_esquema: number;
  agregado_tipo: string;
  agregado_id: string;
  dados: Record<string, unknown>;
  criado_em: Date;
}

const comPrefixo = (prefixo: string, valor: unknown) =>
  typeof valor === "string" ? `${prefixo}_${valor}` : valor;

/**
 * O corpo do webhook. A ordem das chaves é fixa (o receptor assina e
 * confere os bytes). Lança com um tipo que o catálogo não conhece: não se
 * envia o que ninguém decidiu mostrar.
 */
export function corpoDoEvento(evento: EventoDaBase): string {
  const tipo = TIPOS_DE_EVENTO[evento.tipo as TipoDeEventoPublico] as
    TipoDeEvento | undefined;
  if (tipo === undefined) {
    throw new Error("webhooks.event_unknown: tipo fora do catálogo");
  }
  const dados: Record<string, unknown> = {};
  for (const [campo, prefixo] of Object.entries(tipo.campos)) {
    if (campo in evento.dados) {
      const v = evento.dados[campo];
      dados[campo] = prefixo === null ? v : comPrefixo(prefixo, v);
    }
  }
  return JSON.stringify({
    id: `evt_${evento.id}`,
    tipo: evento.tipo,
    versao_esquema: evento.versao_esquema,
    criado_em: evento.criado_em.toISOString(),
    agregado: {
      tipo: evento.agregado_tipo,
      id: `${tipo.agregado}_${evento.agregado_id}`,
    },
    dados,
  });
}
