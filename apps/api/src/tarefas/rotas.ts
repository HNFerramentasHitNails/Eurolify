import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql, type Kysely, type Transaction } from "kysely";
import { Type } from "typebox";
import { ErroApi, RESPOSTA_DE_ERRO, erroBase } from "../base/erros.js";
import {
  FILAS_TAREFAS,
  type BaseDados,
  type FilaTarefa,
} from "../base/esquema.js";
import { escrever, Instante, iso, umDe } from "../catalogo/rotas.js";
import { chaveDo, sessaoDo } from "../identidade/autenticacao.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { rastoActual } from "../base/rasto.js";
import { ESPERA_MAXIMA } from "../catalogo/erros.js";
import type { ContextoChave } from "../identidade/repositorio.js";
import { ErroTarefas, ESTADO_DO_CODIGO, traduzir } from "./erros.js";
import { fusoDo } from "../comerciante/repositorio.js";
import { FILAS } from "./filas.js";
import {
  atribuir,
  lerTarefa,
  listarTarefas,
  mudarPrazo,
  podemSerResponsaveis,
  responsavelDe,
  type CasoAberto,
} from "./repositorio.js";

// A API das tarefas das filas que pedem uma pessoa (docs/33 §7; decisão
// DW). Pela chave, e no Hub pelas rotas `/hub/tasks` (docs/22 §28).
// Cada rota pede «qualquer» chave e confere aqui o âmbito da fila: a lista
// mostra só as filas que a chave lê (R2).

async function emTarefas<T>(resposta: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (erro) {
    const e = traduzir(erro);
    if (e instanceof ErroTarefas) {
      if (e.codigo === "tasks.retry") void resposta.header("Retry-After", "1");
      throw new ErroApi(
        e.codigo,
        ESTADO_DO_CODIGO[e.codigo],
        e.codigo === "tasks.not_found"
          ? { pt: "Não encontrado", en: "Not found" }
          : {
              pt: "Pedido recusado pelas tarefas",
              en: "Rejected by tasks",
            },
        e.message,
      );
    }
    throw e;
  }
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const Fila = umDe(FILAS_TAREFAS);
const Caso = Type.String({
  pattern: `^[a-z]{3}_${UUID}$`,
  description: "O caso, com o prefixo da fila (ex.: inv_… num documento)",
});
const Pessoa = Type.String({ pattern: `^per_${UUID}$`, description: "per_…" });
const Motivo = Type.String({ minLength: 1, maxLength: 500 });
const Versao = Type.Integer({
  minimum: 0,
  description: "A versão lida (0 sem atribuição)",
});

const Tarefa = Type.Object({
  fila: Fila,
  caso: Type.String(),
  motivo: Type.String(),
  entrou_em: Instante,
  encomenda: Type.Union([Type.String(), Type.Null()]),
  responsavel: Type.Union([Type.String(), Type.Null()]),
  prazo: Instante,
  prazo_definido: Type.Boolean(),
  prazo_legal: Type.Union([Type.String({ format: "date" }), Type.Null()]),
  vencida: Type.Boolean(),
  aviso_vencido_em: Type.Union([Instante, Type.Null()]),
  versao: Type.Integer(),
});

const paraTarefa = (c: CasoAberto) => ({
  fila: c.fila,
  caso: `${FILAS[c.fila].prefixo}_${c.caso}`,
  motivo: c.motivo,
  entrou_em: c.entrou_em.toISOString(),
  encomenda: c.encomenda === null ? null : `ord_${c.encomenda}`,
  responsavel: c.responsavel === null ? null : `per_${c.responsavel}`,
  prazo: c.prazo.toISOString(),
  prazo_definido: c.prazo_definido,
  prazo_legal: c.prazo_legal,
  vencida: c.vencida,
  aviso_vencido_em: iso(c.aviso_vencido_em),
  versao: c.versao,
});

const proibido = (detalhe: string) =>
  new ErroApi(
    "tasks.forbidden",
    ESTADO_DO_CODIGO["tasks.forbidden"],
    { pt: "Sem acesso a esta fila", en: "No access to this queue" },
    detalhe,
  );

/** As filas que a chave ou o papel da sessão lêem (R2). */
const filasQueLe = (ambitos: readonly string[]) =>
  FILAS_TAREFAS.filter((f) => ambitos.includes(FILAS[f].ler));

/** O id do caso sem o prefixo, ou 404 se o prefixo não é o da fila. */
function casoDa(fila: FilaTarefa, caso: string): string {
  const [prefixo, id] = caso.split("_", 2);
  if (prefixo !== FILAS[fila].prefixo || id === undefined) {
    throw new ErroApi(
      "tasks.not_found",
      ESTADO_DO_CODIGO["tasks.not_found"],
      { pt: "Não encontrado", en: "Not found" },
      `o caso de ${fila} começa por ${FILAS[fila].prefixo}_`,
    );
  }
  return id;
}

/**
 * Atribuir e mudar o prazo: ler, decidir e `tasks:assign` (R3); nunca uma
 * chave de agente de IA (R11; revisão do #375, P2-1).
 */
function podeAtribuir(chave: ContextoChave, fila: FilaTarefa) {
  if (chave.agenteIa) {
    throw proibido(
      "uma chave de agente de IA não atribui nem muda prazos (R11)",
    );
  }
  const em = FILAS[fila];
  for (const a of [em.ler, em.decidir, "tasks:assign"] as const) {
    if (!chave.ambitos.includes(a)) throw proibido(`falta o âmbito ${a}`);
  }
}

const cursorDe = (c: CasoAberto) =>
  Buffer.from(JSON.stringify([c.prazo_us, c.fila, c.caso]), "utf8").toString(
    "base64url",
  );
function doCursor(cursor: string | undefined) {
  if (cursor === undefined) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    v = null;
  }
  if (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === "string" &&
    /^-?[0-9]{1,18}$/.test(v[0]) &&
    typeof v[1] === "string" &&
    (FILAS_TAREFAS as readonly string[]).includes(v[1]) &&
    typeof v[2] === "string" &&
    new RegExp(`^${UUID}$`).test(v[2])
  ) {
    return { prazoUs: v[0], fila: v[1], caso: v[2] };
  }
  throw erroBase("request.invalid", "`cursor` não é um cursor desta lista");
}

const RespostaLista = Type.Object({
  dados: Type.Array(Tarefa),
  filas: Type.Array(Fila),
  totais: Type.Record(Type.String(), Type.Integer()),
  ha_mais: Type.Boolean(),
  cursor_seguinte: Type.Union([Type.String(), Type.Null()]),
});

const RespostaCaso = Type.Object({
  tarefa: Tarefa,
  historico: Type.Array(
    Type.Object({
      acto: umDe(["atribuida", "retirada", "prazo_mudado", "vencida"] as const),
      responsavel_antes: Type.Union([Type.String(), Type.Null()]),
      responsavel_depois: Type.Union([Type.String(), Type.Null()]),
      prazo_antes: Type.Union([Instante, Type.Null()]),
      prazo_depois: Type.Union([Instante, Type.Null()]),
      motivo: Type.Union([Type.String(), Type.Null()]),
      quem: Type.String(),
      em: Instante,
      passagem: Instante,
    }),
  ),
});

/** O pedido da lista, já sem prefixos (a chave e o Hub, docs/22 §28.2). */
interface PedidoDaLista {
  fila?: FilaTarefa | undefined;
  /** `sem`, ou o id da pessoa sem o prefixo. */
  responsavel?: string | undefined;
  vencida?: "true" | "false" | undefined;
  limite?: string | undefined;
  cursor?: string | undefined;
}

/** A lista «A decidir» das filas que os âmbitos lêem (R2, R10). */
async function responderLista(
  base: Kysely<BaseDados>,
  comercianteId: string,
  ambitos: readonly string[],
  q: PedidoDaLista,
) {
  const le = filasQueLe(ambitos);
  if (le.length === 0) {
    throw proibido("não lê nenhuma fila");
  }
  if (q.fila !== undefined && !le.includes(q.fila)) {
    throw proibido(`falta o âmbito ${FILAS[q.fila].ler}`);
  }
  const filas = q.fila === undefined ? le : [q.fila];
  const limite = q.limite === undefined ? 25 : Number(q.limite);
  const depoisDe = doCursor(q.cursor);
  const r = await listarTarefas(base, comercianteId, {
    filas,
    limite,
    ...(q.responsavel === undefined ? {} : { responsavel: q.responsavel }),
    ...(q.vencida === undefined ? {} : { vencida: q.vencida === "true" }),
    ...(depoisDe === undefined ? {} : { depoisDe }),
  });
  const ultima = r.dados.at(-1);
  return {
    dados: r.dados.map(paraTarefa),
    filas,
    totais: r.totais,
    ha_mais: r.haMais,
    cursor_seguinte: r.haMais && ultima !== undefined ? cursorDe(ultima) : null,
  };
}

/** Um caso aberto e o histórico, se os âmbitos lêem a fila. */
async function responderCaso(
  base: Kysely<BaseDados>,
  comercianteId: string,
  ambitos: readonly string[],
  fila: FilaTarefa,
  casoComPrefixo: string,
) {
  if (!ambitos.includes(FILAS[fila].ler)) {
    throw proibido(`falta o âmbito ${FILAS[fila].ler}`);
  }
  const r = await lerTarefa(
    base,
    comercianteId,
    fila,
    casoDa(fila, casoComPrefixo),
  );
  if (r === null) {
    throw new ErroTarefas(
      "tasks.not_found",
      "tasks.not_found: o caso não está aberto nesta fila",
    );
  }
  const pessoa = (id: string | null) => (id === null ? null : `per_${id}`);
  return {
    tarefa: paraTarefa(r.caso),
    historico: r.historico.map((h) => ({
      acto: h.acto,
      responsavel_antes: pessoa(h.responsavel_antes),
      responsavel_depois: pessoa(h.responsavel_depois),
      prazo_antes: iso(h.prazo_antes),
      prazo_depois: iso(h.prazo_depois),
      motivo: h.motivo,
      quem: h.quem,
      em: h.em.toISOString(),
      passagem: h.entrou_em.toISOString(),
    })),
  };
}

export function rotasDasTarefas(
  app: FastifyInstance,
  base: Kysely<BaseDados>,
): void {
  const rotas = app.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    "/tasks",
    {
      config: { ambito: "qualquer" },
      schema: {
        description:
          "A lista «A decidir» (docs/33): os casos abertos das filas que a chave lê, do prazo mais próximo ao mais longe, com o responsável, o prazo em vigor e se está vencido; e o total de cada fila com os mesmos filtros. A tarefa não decide: o caso decide-se na rota da fila dele.",
        querystring: Type.Object(
          {
            fila: Type.Optional(Fila),
            responsavel: Type.Optional(
              Type.Union([Type.Literal("sem"), Pessoa]),
            ),
            vencida: Type.Optional(umDe(["true", "false"] as const)),
            limite: Type.Optional(
              Type.String({
                pattern: "^[1-9][0-9]?$|^100$",
                description: "1 a 100; por omissão, 25",
              }),
            ),
            cursor: Type.Optional(
              Type.String({ pattern: "^[A-Za-z0-9_-]{1,300}$" }),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: RespostaLista,
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emTarefas(resposta, async () => {
        const chave = chaveDo(pedido);
        const q = pedido.query;
        return responderLista(base, chave.comercianteId, chave.ambitos, {
          ...q,
          ...(q.responsavel === undefined
            ? {}
            : {
                responsavel:
                  q.responsavel === "sem" ? "sem" : q.responsavel.slice(4),
              }),
        });
      }),
  );

  rotas.get(
    "/tasks/:fila/:caso",
    {
      config: { ambito: "qualquer" },
      schema: {
        description:
          "Um caso aberto e o histórico das atribuições dele (quem, o prazo, o motivo, o aviso), de todas as passagens pela fila.",
        params: Type.Object({ fila: Fila, caso: Caso }),
        response: {
          200: RespostaCaso,
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emTarefas(resposta, async () => {
        const chave = chaveDo(pedido);
        return responderCaso(
          base,
          chave.comercianteId,
          chave.ambitos,
          pedido.params.fila,
          pedido.params.caso,
        );
      }),
  );

  rotas.post(
    "/tasks/:fila/:caso/assign",
    {
      config: { ambito: "qualquer" },
      schema: {
        description:
          "Atribui o caso a uma pessoa que o pode decidir, ou tira a atribuição (`responsavel: null`). Pede o âmbito que lê a fila, o que a decide e `tasks:assign`. Com a versão lida: outra dá 409.",
        params: Type.Object({ fila: Fila, caso: Caso }),
        body: Type.Object(
          {
            responsavel: Type.Union([Pessoa, Type.Null()]),
            versao: Versao,
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emTarefas(resposta, async () => {
          const { fila } = pedido.params;
          podeAtribuir(chave, fila);
          const caso = casoDa(fila, pedido.params.caso);
          return {
            versao: await atribuir(
              trx,
              fila,
              caso,
              pedido.body.responsavel === null
                ? null
                : pedido.body.responsavel.slice(4),
              pedido.body.versao,
            ),
          };
        }),
      ),
  );

  rotas.post(
    "/tasks/:fila/:caso/deadline",
    {
      config: { ambito: "qualquer" },
      schema: {
        description:
          "Muda o prazo do caso, com o motivo: nunca no passado e nunca depois do prazo legal (o reembolso). Um prazo novo permite um aviso novo. Pede o âmbito que lê a fila, o que a decide e `tasks:assign`.",
        params: Type.Object({ fila: Fila, caso: Caso }),
        body: Type.Object(
          { prazo: Instante, motivo: Motivo, versao: Versao },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    (pedido, resposta) =>
      escrever(base, pedido, resposta, 200, (trx, chave) =>
        emTarefas(resposta, async () => {
          const { fila } = pedido.params;
          podeAtribuir(chave, fila);
          const caso = casoDa(fila, pedido.params.caso);
          return {
            versao: await mudarPrazo(
              trx,
              fila,
              caso,
              new Date(pedido.body.prazo),
              pedido.body.motivo,
              pedido.body.versao,
            ),
          };
        }),
      ),
  );
}

/**
 * As mesmas rotas no Hub, com a sessão (docs/22 §28.2; só com o Hub
 * ligado). As filas são as que o papel lê (R2); a sessão é uma pessoa, por
 * isso há `responsavel=eu` e atribuir-se a si próprio pede só decidir a fila
 * (R3); outra pessoa, tirar e mudar o prazo pedem também `tasks:assign`.
 */
export function rotasDasTarefasNoHub(
  app: FastifyInstance,
  base: Kysely<BaseDados>,
): void {
  const rotas = app.withTypeProvider<TypeBoxTypeProvider>();

  const daSessao = (pedido: FastifyRequest, resposta: FastifyReply) => {
    const sessao = sessaoDo(pedido);
    if (sessao.comercianteId === null) {
      throw new Error("rota com comerciante sem o comerciante da sessão");
    }
    void resposta.header("cache-control", "private, no-store");
    return { ...sessao, comercianteId: sessao.comercianteId };
  };

  /** Ler e decidir a fila; `outros` pede também `tasks:assign` (R3). */
  const exigir = (
    ambitos: readonly string[],
    fila: FilaTarefa,
    outros: boolean,
  ) => {
    const em = FILAS[fila];
    for (const a of outros
      ? [em.ler, em.decidir, "tasks:assign"]
      : [em.ler, em.decidir]) {
      if (!ambitos.includes(a)) throw proibido(`falta o âmbito ${a}`);
    }
  };

  /**
   * Nenhuma IA atribui nem muda prazos (R11), também pelo Hub com a IA
   * declarada no pedido (revisão do #396, P3-6).
   */
  const semIa = () => {
    if (rastoActual()?.ia !== undefined) {
      throw proibido("uma IA não atribui nem muda prazos (R11)");
    }
  };

  /** Uma escrita na transacção do comerciante, com o «quem» da pessoa. */
  const escreverNoHub = <T>(
    comercianteId: string,
    pessoaId: string,
    fn: (trx: Transaction<BaseDados>) => Promise<T>,
  ) =>
    comComerciante(base, comercianteId, async (trx) => {
      await sql`select set_config('eurolify.quem', ${`pessoa:per_${pessoaId}`}, true)`.execute(
        trx,
      );
      await sql`select set_config('lock_timeout', ${ESPERA_MAXIMA}, true)`.execute(
        trx,
      );
      return fn(trx);
    });

  rotas.get(
    "/hub/tasks",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "A lista «A decidir» no Hub (docs/22 §28): a mesma da chave, com as filas que o papel lê; `responsavel=eu` é a pessoa da sessão.",
        querystring: Type.Object(
          {
            fila: Type.Optional(Fila),
            responsavel: Type.Optional(
              Type.Union([Type.Literal("eu"), Type.Literal("sem"), Pessoa]),
            ),
            vencida: Type.Optional(umDe(["true", "false"] as const)),
            limite: Type.Optional(
              Type.String({ pattern: "^[1-9][0-9]?$|^100$" }),
            ),
            cursor: Type.Optional(
              Type.String({ pattern: "^[A-Za-z0-9_-]{1,300}$" }),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            ...RespostaLista.properties,
            fuso: Type.String({
              description:
                "O fuso do comerciante (IANA): o ecrã mostra e escolhe os prazos nele",
            }),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emTarefas(resposta, async () => {
        const s = daSessao(pedido, resposta);
        const q = pedido.query;
        const r = q.responsavel;
        const fuso = await fusoDo(base, s.comercianteId);
        const lista = await responderLista(base, s.comercianteId, s.ambitos, {
          ...q,
          responsavel:
            r === undefined || r === "sem"
              ? r
              : r === "eu"
                ? s.pessoaId
                : r.slice(4),
        });
        return { ...lista, fuso };
      }),
  );

  rotas.get(
    "/hub/tasks/:fila/:caso",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Um caso aberto e o histórico (docs/22 §28), com quem pode ser responsável pela régua da base (R3).",
        params: Type.Object({ fila: Fila, caso: Caso }),
        response: {
          200: Type.Object({
            ...RespostaCaso.properties,
            pode_ser_responsavel: Type.Array(Pessoa),
          }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emTarefas(resposta, async () => {
        const s = daSessao(pedido, resposta);
        const { fila, caso } = pedido.params;
        const r = await responderCaso(
          base,
          s.comercianteId,
          s.ambitos,
          fila,
          caso,
        );
        const podem = await podemSerResponsaveis(base, s.comercianteId, fila);
        return { ...r, pode_ser_responsavel: podem.map((p) => `per_${p}`) };
      }),
  );

  rotas.post(
    "/hub/tasks/:fila/:caso/assign",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Atribui o caso (docs/22 §28.2): a si próprio, com o âmbito de decidir a fila; a outra pessoa ou ninguém (`null`), também com `tasks:assign`. Com a versão lida: outra dá 409.",
        params: Type.Object({ fila: Fila, caso: Caso }),
        body: Type.Object(
          { responsavel: Type.Union([Pessoa, Type.Null()]), versao: Versao },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emTarefas(resposta, async () => {
        const s = daSessao(pedido, resposta);
        const { fila } = pedido.params;
        const quem =
          pedido.body.responsavel === null
            ? null
            : pedido.body.responsavel.slice(4);
        semIa();
        exigir(s.ambitos, fila, quem !== s.pessoaId);
        const caso = casoDa(fila, pedido.params.caso);
        const atribui = s.ambitos.includes("tasks:assign");
        return {
          versao: await escreverNoHub(
            s.comercianteId,
            s.pessoaId,
            async (trx) => {
              // Ficar com um caso que tem outro responsável é tirá-lo a ele:
              // pede também tasks:assign (R3; revisão do #396, P2-1). A
              // versão lida, conferida na base com o caso trancado, garante
              // que o responsável visto aqui é o que a escrita substitui.
              if (!atribui) {
                const actual = await responsavelDe(trx, fila, caso);
                if (actual !== null && actual !== s.pessoaId) {
                  throw proibido(
                    "tirar o caso a outra pessoa pede tasks:assign",
                  );
                }
              }
              return atribuir(trx, fila, caso, quem, pedido.body.versao);
            },
          ),
        };
      }),
  );

  rotas.post(
    "/hub/tasks/:fila/:caso/deadline",
    {
      config: { ambito: "sessao_comerciante", hub: true },
      schema: {
        description:
          "Muda o prazo do caso, com o motivo (docs/22 §28.2): nunca no passado e nunca depois do prazo legal. Pede decidir a fila e `tasks:assign`.",
        params: Type.Object({ fila: Fila, caso: Caso }),
        body: Type.Object(
          { prazo: Instante, motivo: Motivo, versao: Versao },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ versao: Type.Integer() }),
          ...RESPOSTA_DE_ERRO,
        },
      },
    },
    async (pedido, resposta) =>
      emTarefas(resposta, async () => {
        const s = daSessao(pedido, resposta);
        const { fila } = pedido.params;
        semIa();
        exigir(s.ambitos, fila, true);
        const caso = casoDa(fila, pedido.params.caso);
        return {
          versao: await escreverNoHub(s.comercianteId, s.pessoaId, (trx) =>
            mudarPrazo(
              trx,
              fila,
              caso,
              new Date(pedido.body.prazo),
              pedido.body.motivo,
              pedido.body.versao,
            ),
          ),
        };
      }),
  );
}
