import { Type, type Static } from "typebox";
import { CANAIS, type Canal } from "./rasto.js";

// As seis respostas do rasto nas linhas do tempo da API (docs/28 §1 e §4,
// passo 4; decisão DK; #322). As linhas do tempo já diziam o que mudou
// (`campos`), quem executou (`quem`) e quando (`em`); acrescentam-se, iguais
// em todas, de onde veio (`canal`, `pedido`), a IA, quem autorizou e o
// motivo. Uma regra, um sítio: as rotas usam este esquema e esta função.

const TextoOuVazio = (description: string) =>
  Type.Union([Type.String(), Type.Null()], { description });

export const IaDoRastoNaResposta = Type.Object(
  {
    prova: Type.Union(
      [
        Type.Literal("comprovado"),
        Type.Literal("declarado"),
        Type.Literal("desconhecido"),
      ],
      {
        description:
          "comprovado: o próprio Eurolify chamou o modelo; declarado: quem chamou disse que era uma IA (o cabeçalho Eurolify-IA ou uma chave de um agente de IA), sem o dar por verdadeiro; desconhecido: nada indica se houve IA — nunca quer dizer «sem IA» (docs/28 §3.3)",
      },
    ),
    fornecedor: TextoOuVazio("Vazio se não foi dito"),
    modelo: TextoOuVazio("Vazio se não foi dito"),
    execucao: TextoOuVazio(
      "O identificador da execução; vazio se não foi dito",
    ),
  },
  { description: "A participação de IA (docs/28 §3.3)" },
);

export const TIPOS_DE_AUTOR = [
  "pessoa",
  "agente",
  "chave",
  "consumidor",
  "prestador",
  "sistema",
  "operador",
  "desconhecido",
] as const;
export type TipoDeAutor = (typeof TIPOS_DE_AUTOR)[number];

/**
 * O que se diz de quem fez sem o identificar (docs/28 §3.6 e §3.8): o tipo
 * de autor e o aviso. Vão também onde quem fez não se pode mostrar (o
 * histórico de preços com `prices:read`, Q7).
 */
export const CamposDoAutor = {
  tipo_de_autor: Type.Unsafe<TipoDeAutor>({
    type: "string",
    enum: [...TIPOS_DE_AUTOR],
    description:
      "pessoa: uma pessoa da equipa (também com IA declarada no pedido: quem executou foi ela); agente: uma chave de um agente de IA, ou uma chave com IA declarada no pedido; chave: uma chave sem IA declarada; consumidor: o cliente na compra (checkout:chk_…); prestador: o aviso de um prestador de pagamentos (prestador:…); sistema: uma tarefa do Eurolify ou uma consequência automática de outra alteração (sistema:…, catalogo:…); operador: o comando do operador; desconhecido: uma forma que esta lista não conhece (docs/28 §3.8)",
  }),
  sem_autorizacao_de_pessoa: Type.Boolean({
    description:
      "Verdadeiro quando nenhuma pessoa ficou registada como quem autorizou, seja qual for a origem — um agente, uma chave, uma regra, uma importação, uma tarefa ou uma linha antiga sem contexto (Diogo, 11/10/2026, docs/28 §3.6). Calculado aqui: quem mostra não o recalcula",
  }),
};

/** Os campos que cada entrada de uma linha do tempo ganha (docs/28 §1). */
export const CamposDoRasto = {
  // Um texto com a lista em `enum` (não uma união de literais): um canal
  // novo na base que faltasse aqui sairia como está, em vez de partir a
  // linha do tempo inteira com um 500 (revisão do #345, P2-3).
  canal: Type.Unsafe<Canal | null>({
    type: ["string", "null"],
    enum: [...CANAIS, null],
    description:
      "De onde veio a alteração. Vazio: desconhecido — uma linha de antes de 10/10/2026 (migração 0053), ou escrita sem o contexto do rasto; então a IA, quem autorizou e o pedido também são desconhecidos",
  }),
  pedido: TextoOuVazio(
    "O identificador do pedido HTTP (o mesmo do `instance` dos erros) ou da tarefa",
  ),
  ia: IaDoRastoNaResposta,
  autorizado_por: TextoOuVazio(
    "pessoa:per_… que confirmou a acção, separada de quem a executou; quando a pessoa age ela própria no Hub, é ela. Vazio: nenhuma pessoa do comerciante confirmou — uma chave nunca autoriza, o operador (operador:github:…) e as tarefas do sistema também não, e uma sessão do Hub com IA declarada não prova que a pessoa confirmou (docs/28 §3.2); com `canal` vazio, desconhecido",
  ),
  motivo: TextoOuVazio("O motivo, quando a operação o tem"),
  ...CamposDoAutor,
};

export type RespostasDoRasto = {
  [K in keyof typeof CamposDoRasto]: Static<(typeof CamposDoRasto)[K]>;
};

/** Uma linha de uma tabela do rasto (0053), como a base a devolve. */
export interface LinhaComRasto {
  /** Quem executou (`quem`, ou `definido_por` nos preços). */
  quem: string;
  canal: string | null;
  pedido: string | null;
  ia: Record<string, string> | null;
  autorizado_por: string | null;
  motivo: string | null;
}

const ou = (v: string | undefined) => v ?? null;

const PREFIXOS_DE_AUTOR: Partial<Record<string, TipoDeAutor>> = {
  "pessoa:": "pessoa",
  "checkout:": "consumidor",
  "prestador:": "prestador",
  "sistema:": "sistema",
  "catalogo:": "sistema",
  "operador:": "operador",
};

/** O tipo de autor e o aviso (docs/28 §3.6 e §3.8), sem identificar ninguém. */
export function autorDoRasto(
  l: Pick<LinhaComRasto, "quem" | "ia" | "autorizado_por">,
): { tipo_de_autor: TipoDeAutor; sem_autorizacao_de_pessoa: boolean } {
  const declarada = l.ia?.prova === "declarado" || l.ia?.prova === "comprovado";
  // As formas de `quem` que o código escreve (procuradas a 11/10/2026,
  // revisão do #349, P2-1); uma nova sem lugar aqui sai «desconhecido».
  const prefixo = l.quem.slice(0, l.quem.indexOf(":") + 1);
  const tipo: TipoDeAutor =
    prefixo === "chave:"
      ? declarada
        ? "agente"
        : "chave"
      : (PREFIXOS_DE_AUTOR[prefixo] ?? "desconhecido");
  return {
    tipo_de_autor: tipo,
    sem_autorizacao_de_pessoa: l.autorizado_por === null,
  };
}

export function respostasDoRasto(l: LinhaComRasto): RespostasDoRasto {
  const ia = l.ia;
  const prova =
    ia?.prova === "comprovado" || ia?.prova === "declarado"
      ? ia.prova
      : "desconhecido";
  // Com a prova desconhecida, nada mais da IA sai: não se contradiz
  // (revisão do #345, P3-4).
  const conhecida = prova !== "desconhecido";
  return {
    canal: l.canal as Canal | null,
    pedido: l.pedido,
    ia: {
      prova,
      fornecedor: conhecida ? ou(ia?.fornecedor) : null,
      modelo: conhecida ? ou(ia?.modelo) : null,
      execucao: conhecida ? ou(ia?.execucao) : null,
    },
    autorizado_por: l.autorizado_por,
    motivo: l.motivo,
    ...autorDoRasto(l),
  };
}
