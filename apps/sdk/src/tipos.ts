// Os tipos do cliente, tirados dos tipos gerados do contrato (`paths`). Nada
// aqui sabe de negócio: só diz, para cada rota, o que o contrato pede e o que
// devolve (docs/39 §4).

// O objecto sem campos: serve para perguntar «o pedido pode ser vazio?».
// eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type
type Vazio = Record<never, never>;

export type Metodo = "get" | "post" | "put" | "patch" | "delete";

/** A operação de um método num caminho; `never` se o caminho não o tem. */
type Op<P, C extends keyof P, M extends Metodo> = P[C] extends {
  [K in M]?: infer O;
}
  ? NonNullable<O>
  : never;

/** Os caminhos do contrato que têm este método. */
export type Caminhos<P, M extends Metodo> = {
  [C in keyof P & string]: [Op<P, C, M>] extends [never] ? never : C;
}[keyof P & string];

type Parte<O, K extends "path" | "query" | "header"> = O extends {
  parameters: infer Pa;
}
  ? Pa extends { [J in K]?: infer X }
    ? NonNullable<X>
    : never
  : never;

/** Um campo `Nome` do pedido: obrigatório se o contrato o exige, ausente se não existe. */
type Campo<Nome extends string, T> = [T] extends [never]
  ? unknown
  : Vazio extends T
    ? { [K in Nome]?: T }
    : { [K in Nome]: T };

/** Os cabeçalhos do contrato, menos os que o SDK trata (idempotência e autenticação). */
type CabecalhosLivres<O> = [Parte<O, "header">] extends [never]
  ? never
  : Omit<Parte<O, "header">, "idempotency-key" | "authorization">;

type PrecisaDeChave<O> = [Parte<O, "header">] extends [never]
  ? unknown
  : "idempotency-key" extends keyof Parte<O, "header">
    ? { idempotencia: string }
    : unknown;

type Corpo<O> = O extends { requestBody?: never }
  ? unknown
  : O extends { requestBody: { content: { "application/json": infer B } } }
    ? { corpo: B }
    : O extends { requestBody?: { content: { "application/json": infer B } } }
      ? { corpo?: B }
      : unknown;

/** O que se passa a uma operação, só com o que o contrato dela pede. */
export type Pedido<O> = Campo<"caminho", Parte<O, "path">> &
  Campo<"consulta", Parte<O, "query">> &
  Campo<"cabecalhos", CabecalhosLivres<O>> &
  Corpo<O> &
  PrecisaDeChave<O> & { sinal?: AbortSignal };

type Argumentos<O> =
  Vazio extends Pedido<O> ? [pedido?: Pedido<O>] : [pedido: Pedido<O>];

/** O corpo da resposta de sucesso (`undefined` nas respostas sem corpo, 204). */
export type Sucesso<O> = O extends { responses: infer R }
  ? {
      [S in keyof R]: S extends 200 | 201 | 202
        ? R[S] extends { content: { "application/json": infer D } }
          ? D
          : undefined
        : S extends 204
          ? undefined
          : never;
    }[keyof R]
  : never;

/** O que o cliente devolve: o corpo como o servidor o mandou, sem retoques. */
export interface Resposta<T> {
  dados: T;
  estado: number;
  cabecalhos: Headers;
}

export interface Cliente<P> {
  get<C extends Caminhos<P, "get">>(
    caminho: C,
    ...a: Argumentos<Op<P, C & keyof P, "get">>
  ): Promise<Resposta<Sucesso<Op<P, C & keyof P, "get">>>>;
  post<C extends Caminhos<P, "post">>(
    caminho: C,
    ...a: Argumentos<Op<P, C & keyof P, "post">>
  ): Promise<Resposta<Sucesso<Op<P, C & keyof P, "post">>>>;
  put<C extends Caminhos<P, "put">>(
    caminho: C,
    ...a: Argumentos<Op<P, C & keyof P, "put">>
  ): Promise<Resposta<Sucesso<Op<P, C & keyof P, "put">>>>;
  patch<C extends Caminhos<P, "patch">>(
    caminho: C,
    ...a: Argumentos<Op<P, C & keyof P, "patch">>
  ): Promise<Resposta<Sucesso<Op<P, C & keyof P, "patch">>>>;
  delete<C extends Caminhos<P, "delete">>(
    caminho: C,
    ...a: Argumentos<Op<P, C & keyof P, "delete">>
  ): Promise<Resposta<Sucesso<Op<P, C & keyof P, "delete">>>>;
}
