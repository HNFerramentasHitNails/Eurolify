import { Type, type Static } from "typebox";
import type { Canal } from "./rasto.js";

// As seis respostas do rasto nas linhas do tempo da API (docs/28 §1 e §4,
// passo 4; decisão DK; #322). As linhas do tempo já diziam o que mudou
// (`campos`), quem executou (`quem`) e quando (`em`); acrescentam-se, iguais
// em todas, de onde veio (`canal`, `pedido`), a IA, quem autorizou e o
// motivo. Uma regra, um sítio: as rotas usam este esquema e esta função.

const CanalNaResposta = Type.Union([
  Type.Literal("hub"),
  Type.Literal("api"),
  Type.Literal("importacao"),
  Type.Literal("integracao"),
  Type.Literal("mcp"),
  Type.Literal("sistema"),
  Type.Literal("operador"),
]);

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

/** Os campos que cada entrada de uma linha do tempo ganha (docs/28 §1). */
export const CamposDoRasto = {
  canal: Type.Union([CanalNaResposta, Type.Null()], {
    description:
      "De onde veio a alteração. Vazio: desconhecido — a linha é de antes de 10/10/2026 (migração 0053), e então a IA, quem autorizou e o pedido também são desconhecidos",
  }),
  pedido: TextoOuVazio(
    "O identificador do pedido HTTP (o mesmo do `instance` dos erros) ou da tarefa",
  ),
  ia: IaDoRastoNaResposta,
  autorizado_por: TextoOuVazio(
    "pessoa:per_… que confirmou a acção, separada de quem a executou. Vazio com `canal` preenchido: nenhuma pessoa autorizou (uma chave nunca autoriza, docs/28 §3.2); vazio com `canal` vazio: desconhecido",
  ),
  motivo: TextoOuVazio("O motivo, quando a operação o tem"),
};

export type RespostasDoRasto = {
  [K in keyof typeof CamposDoRasto]: Static<(typeof CamposDoRasto)[K]>;
};

/** Uma linha de uma tabela do rasto (0053), como a base a devolve. */
export interface LinhaComRasto {
  canal: string | null;
  pedido: string | null;
  ia: Record<string, string> | null;
  autorizado_por: string | null;
  motivo: string | null;
}

const ou = (v: string | undefined) => v ?? null;

export function respostasDoRasto(l: LinhaComRasto): RespostasDoRasto {
  const ia = l.ia;
  const prova =
    ia?.prova === "comprovado" || ia?.prova === "declarado"
      ? ia.prova
      : "desconhecido";
  return {
    canal: l.canal as Canal | null,
    pedido: l.pedido,
    ia: {
      prova,
      fornecedor: ou(ia?.fornecedor),
      modelo: ou(ia?.modelo),
      execucao: ou(ia?.execucao),
    },
    autorizado_por: l.autorizado_por,
    motivo: l.motivo,
  };
}
