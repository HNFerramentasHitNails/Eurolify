import type { AlteracaoArtigo } from "./api";
import { preencher, type Textos } from "./textos";

// O rasto de cada alteração do histórico em linguagem comum (docs/22 §26.2;
// docs/28 §1): de onde veio, a pedido de quem, a IA, quem autorizou e o
// motivo. O servidor decidiu tudo (o tipo de autor, o aviso, os nomes); isto
// só escolhe as palavras.

export type RastoDaEntrada = Pick<
  AlteracaoArtigo,
  | "origem"
  | "canal"
  | "pedido"
  | "ia"
  | "motivo"
  | "a_pedido_de"
  | "tipo_de_autor"
  | "a_pedido_de_tipo"
  | "sem_autorizacao_de_pessoa"
  | "autor_autorizou"
  | "autor_do_pedido"
>;

export interface LinhaDoRasto {
  /** As partes da linha, por ordem, a juntar com « · ». */
  partes: string[];
  /** A autorização, à parte para levar a cor e o ícone do aviso. */
  autorizacao: { texto: string; aviso: boolean };
  motivo: string | null;
  /** O que vai em «Detalhes» (fechado por omissão). */
  detalhes: string[];
}

function deOnde(e: RastoDaEntrada, t: Textos): string {
  // Uma importação de antes do canal `importacao` (0062) diz-se pela origem.
  // Antes da 0062 a importação escrevia com o canal `api` (revisão do
  // #359, P3-1): só nesse caso a origem decide.
  if (
    e.canal === "importacao" ||
    (e.canal === "api" && e.origem?.startsWith("importacao:") === true)
  )
    return t.rastoCanal_importacao;
  if (e.canal === null) return t.rastoOrigemDesconhecida;
  const chave = `rastoCanal_${e.canal}`;
  // Um canal novo que o ecrã não conhece sai com o nome técnico.
  return chave in t ? t[chave as keyof Textos] : e.canal;
}

/** «a pedido de Chave «Preços»», «a pedido do cliente» (revisão do #359, P2-1). */
function aPedidoDe(e: RastoDaEntrada, t: Textos): string {
  const nome = e.autor_do_pedido?.nome ?? null;
  // Com nome, a frase com ele; sem nome, uma frase inteira por tipo (a
  // contracção muda: «do cliente», «de um prestador»).
  switch (e.a_pedido_de_tipo) {
    case "agente":
    case "chave":
      return nome === null
        ? e.a_pedido_de_tipo === "agente"
          ? t.rastoAPedidoDe_agente
          : t.rastoAPedidoDe_chave
        : preencher(t.rastoAPedidoDe, {
            nome: preencher(t.historicoChave, { nome }),
          });
    case "pessoa":
      return nome === null
        ? t.rastoAPedidoDe_pessoa
        : preencher(t.rastoAPedidoDe, { nome });
    case "prestador":
      return t.rastoAPedidoDe_prestador;
    case "consumidor":
      return t.rastoAPedidoDe_consumidor;
    case "operador":
      return t.rastoAPedidoDe_operador;
    case "sistema":
      return t.rastoAPedidoDe_sistema;
    default:
      return t.rastoAPedidoDe_desconhecido;
  }
}

function daIa(e: RastoDaEntrada, t: Textos): string | null {
  if (e.ia.prova === "desconhecido") return null;
  const qual = [e.ia.fornecedor, e.ia.modelo]
    .filter((x): x is string => x !== null)
    .join(", ");
  if (e.ia.prova === "declarado")
    return qual === ""
      ? t.rastoIaDeclarada
      : preencher(t.rastoIaDeclaradaQual, { qual });
  return qual === ""
    ? t.rastoIaComprovada
    : preencher(t.rastoIaComprovadaQual, { qual });
}

export function linhaDoRasto(e: RastoDaEntrada, t: Textos): LinhaDoRasto {
  const partes = [deOnde(e, t)];
  // Só numa tarefa (canal `sistema`): as consequências automáticas de uma
  // alteração no Hub ou pela API vêm com o canal dessa alteração.
  if (e.canal === "sistema") {
    partes.push(
      e.a_pedido_de === null ? t.rastoSemPedidoDeOrigem : aPedidoDe(e, t),
    );
  }
  const ia = daIa(e, t);
  if (ia !== null) partes.push(ia);

  const autorizacao =
    e.sem_autorizacao_de_pessoa === false
      ? {
          texto: preencher(t.rastoAutorizadoPor, {
            nome: e.autor_autorizou?.nome ?? t.rastoPessoaDeForaNaFrase,
          }),
          aviso: false,
        }
      : e.sem_autorizacao_de_pessoa === true
        ? { texto: t.rastoSemAutorizacao, aviso: true }
        : { texto: t.rastoAutorizacaoDesconhecida, aviso: false };

  const detalhes: string[] = [];
  if (e.pedido !== null)
    detalhes.push(preencher(t.rastoPedido, { pedido: e.pedido }));
  if (e.a_pedido_de?.pedido != null)
    detalhes.push(
      preencher(t.rastoPedidoDeOrigem, { pedido: e.a_pedido_de.pedido }),
    );
  if (e.ia.execucao !== null)
    detalhes.push(preencher(t.rastoExecucao, { execucao: e.ia.execucao }));
  if (e.ia.prova === "desconhecido") detalhes.push(t.rastoIaDesconhecida);

  return { partes, autorizacao, motivo: e.motivo, detalhes };
}
