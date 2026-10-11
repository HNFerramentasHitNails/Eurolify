// Os erros das tarefas das filas (docs/33 §7; migração 0066).

export type CodigoErroTarefas =
  | "tasks.not_found"
  | "tasks.forbidden"
  | "tasks.version_conflict"
  | "tasks.assignee_not_allowed"
  | "tasks.deadline_invalid"
  | "tasks.reason_required"
  | "tasks.retry";

export const ESTADO_DO_CODIGO: Record<CodigoErroTarefas, number> = {
  // O caso não está aberto nesta fila (decidido, ou nunca esteve).
  "tasks.not_found": 404,
  // A chave não lê a fila, ou não a decide, ou não tem `tasks:assign` (R2, R3).
  "tasks.forbidden": 403,
  "tasks.version_conflict": 409,
  // A pessoa não pode decidir esta fila neste comerciante (R3).
  "tasks.assignee_not_allowed": 422,
  // No passado, ou depois do prazo legal (R5).
  "tasks.deadline_invalid": 422,
  "tasks.reason_required": 400,
  "tasks.retry": 503,
};

export class ErroTarefas extends Error {
  constructor(
    readonly codigo: CodigoErroTarefas,
    mensagem: string,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroTarefas";
  }
}

const DA_BASE = Object.keys(ESTADO_DO_CODIGO) as CodigoErroTarefas[];

export function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error) || erro instanceof ErroTarefas) return erro;
  const codigo = DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroTarefas(codigo, erro.message, { cause: erro });
  }
  const pg = erro as Error & { code?: string };
  // Uma pessoa que não existe (a chave estrangeira do responsável).
  if (pg.code === "23503") {
    return new ErroTarefas(
      "tasks.assignee_not_allowed",
      "a pessoa não existe",
      { cause: erro },
    );
  }
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
    return new ErroTarefas("tasks.retry", "tentar outra vez", {
      cause: erro,
    });
  }
  return erro;
}
