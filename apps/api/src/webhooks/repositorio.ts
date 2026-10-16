import { sql, type Kysely, type Transaction } from "kysely";
import type {
  BaseDados,
  EstadoEntregaWebhook,
  EstadoSubscricaoWebhook,
} from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { cifrar, decifrar, type ChavePagamentos } from "../pagamentos/cifra.js";
import { assinar, novoSegredo } from "./assinatura.js";
import type { Emissor } from "./emissor.js";
import { corpoDoEvento, type EventoDaBase } from "./eventos.js";
import { UrlRecusada, validarUrlDeWebhook } from "./url.js";

// Os webhooks de saída (docs/38; issue #473): as subscrições, as entregas e
// o publicador. A outbox (0021) não se lê daqui: a função `webhook_distribuir`
// (0108) faz as entregas e `webhook_evento_da_entrega` dá o evento.

export interface ConfigWebhooks {
  /** A chave que cifra os segredos (WEBHOOKS_CHAVE); sem ela, 503. */
  chave?: ChavePagamentos;
  /** O envio HTTP; por omissão, o verdadeiro (servidor.ts). */
  emissor?: Emissor;
}

export type CodigoWebhooks =
  | "webhooks.not_found"
  | "webhooks.url_invalid"
  | "webhooks.version_conflict"
  | "webhooks.not_configured"
  | "webhooks.limit"
  | "webhooks.invalid_transition"
  | "webhooks.not_resendable";

export const ESTADO_DO_CODIGO: Record<CodigoWebhooks, number> = {
  "webhooks.not_found": 404,
  "webhooks.url_invalid": 422,
  "webhooks.version_conflict": 409,
  "webhooks.not_configured": 503,
  "webhooks.limit": 409,
  "webhooks.invalid_transition": 409,
  "webhooks.not_resendable": 409,
};

export class ErroWebhooks extends Error {
  constructor(
    readonly codigo: CodigoWebhooks,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroWebhooks";
  }
}

/** Quantas subscrições não desactivadas um comerciante pode ter (docs/38 §3, **C**). */
export const MAX_SUBSCRICOES = 20;
/** O prazo das novas tentativas (headless-commerce, «Webhooks»). */
export const PRAZO_HORAS = 72;
/**
 * As esperas depois de cada falha, em minutos: recuo exponencial. A última
 * tentativa cai no fim do prazo (docs/38 §7).
 */
export const ESPERAS_MINUTOS = [1, 5, 30, 120, 360, 720, 1440, 1440, 1440];
/** A vez tomada: o tempo até outra volta poder repetir (processo parado a meio). */
const VEZ_MINUTOS = 10;

// ------------------------------------------------------------ Subscrições

export interface SubscricaoLida {
  id: string;
  url: string;
  descricao: string | null;
  eventos: string[];
  estado: EstadoSubscricaoWebhook;
  criada_em: Date;
  actualizada_em: Date;
  versao: number;
}

const COLUNAS = [
  "id",
  "url",
  "descricao",
  "eventos",
  "estado",
  "criada_em",
  "actualizada_em",
  "versao",
] as const;

function urlValida(url: string): string {
  try {
    return validarUrlDeWebhook(url);
  } catch (erro) {
    if (erro instanceof UrlRecusada) {
      throw new ErroWebhooks("webhooks.url_invalid", erro.message);
    }
    throw erro;
  }
}

/** Cria a subscrição; devolve o segredo **uma vez** (nunca mais se lê). */
export async function criarSubscricao(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  dados: { url: string; eventos: string[]; descricao?: string },
  quem: string,
  cfg: ConfigWebhooks | undefined,
): Promise<{ subscricao: SubscricaoLida; segredo: string }> {
  const chave = cfg?.chave;
  if (chave === undefined) {
    throw new ErroWebhooks(
      "webhooks.not_configured",
      "os webhooks não estão configurados (WEBHOOKS_CHAVE)",
    );
  }
  const url = urlValida(dados.url);
  const { count } = await trx
    .selectFrom("webhook_subscricao")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("estado", "<>", "desactivada")
    .executeTakeFirstOrThrow();
  if (Number(count) >= MAX_SUBSCRICOES) {
    throw new ErroWebhooks(
      "webhooks.limit",
      `no máximo ${String(MAX_SUBSCRICOES)} subscrições activas ou pausadas`,
    );
  }
  const { rows } = await sql<{ id: string }>`select uuidv7() as id`.execute(
    trx,
  );
  const id = rows[0]?.id ?? "";
  const segredo = novoSegredo();
  await trx
    .insertInto("webhook_subscricao")
    .values({
      id,
      comerciante_id: comercianteId,
      url,
      descricao: dados.descricao ?? null,
      eventos: [...new Set(dados.eventos)],
      segredo_cifra: cifrar(segredo, id, "webhook_segredo", chave),
      chave_versao: chave.versao,
      criada_por: quem,
    })
    .execute();
  const subscricao = await trx
    .selectFrom("webhook_subscricao")
    .select(COLUNAS)
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  return { subscricao, segredo };
}

export async function listarSubscricoes(
  db: Kysely<BaseDados>,
  comercianteId: string,
): Promise<SubscricaoLida[]> {
  return comComerciante(
    db,
    comercianteId,
    (trx) =>
      trx
        .selectFrom("webhook_subscricao")
        .select(COLUNAS)
        .orderBy("criada_em")
        .orderBy("id")
        .execute(),
    { soLeitura: true },
  );
}

export async function lerSubscricao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  id: string,
): Promise<SubscricaoLida> {
  const s = await comComerciante(
    db,
    comercianteId,
    (trx) =>
      trx
        .selectFrom("webhook_subscricao")
        .select(COLUNAS)
        .where("id", "=", id)
        .executeTakeFirst(),
    { soLeitura: true },
  );
  if (s === undefined) return naoExiste();
  return s;
}

const naoExiste = (): never => {
  throw new ErroWebhooks("webhooks.not_found", "não existe");
};

export async function mudarSubscricao(
  trx: Transaction<BaseDados>,
  id: string,
  versao: number,
  mudanca: {
    url?: string;
    eventos?: string[];
    descricao?: string | null;
    estado?: EstadoSubscricaoWebhook;
  },
  quem: string,
): Promise<SubscricaoLida> {
  const actual = await trx
    .selectFrom("webhook_subscricao")
    .select(["estado", "versao"])
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (actual === undefined) return naoExiste();
  if (actual.versao !== versao) {
    throw new ErroWebhooks(
      "webhooks.version_conflict",
      `a versão actual é a ${String(actual.versao)}`,
    );
  }
  if (actual.estado === "desactivada") {
    throw new ErroWebhooks(
      "webhooks.invalid_transition",
      "uma subscrição desactivada não muda",
    );
  }
  await trx
    .updateTable("webhook_subscricao")
    .set({
      ...(mudanca.url === undefined ? {} : { url: urlValida(mudanca.url) }),
      ...(mudanca.eventos === undefined
        ? {}
        : { eventos: [...new Set(mudanca.eventos)] }),
      ...(mudanca.descricao === undefined
        ? {}
        : { descricao: mudanca.descricao }),
      ...(mudanca.estado === undefined ? {} : { estado: mudanca.estado }),
      actualizada_em: new Date(),
      actualizada_por: quem,
      versao: versao + 1,
    })
    .where("id", "=", id)
    .execute();
  return trx
    .selectFrom("webhook_subscricao")
    .select(COLUNAS)
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

// --------------------------------------------------------------- Entregas

export interface EntregaLida {
  id: string;
  subscricao_id: string;
  evento_id: string;
  estado: EstadoEntregaWebhook;
  tentativas: number;
  reenvios: number;
  proxima_em: Date;
  prazo_ate: Date;
  ultimo_estado_http: number | null;
  ultimo_erro: string | null;
  criada_em: Date;
  terminada_em: Date | null;
}

export async function listarEntregas(
  db: Kysely<BaseDados>,
  comercianteId: string,
  filtro: {
    subscricaoId?: string;
    estado?: EstadoEntregaWebhook;
    depoisDe?: string;
    limite: number;
  },
): Promise<EntregaLida[]> {
  return comComerciante(
    db,
    comercianteId,
    (trx) => {
      let q = trx
        .selectFrom("webhook_entrega")
        .select([
          "id",
          "subscricao_id",
          "evento_id",
          "estado",
          "tentativas",
          "reenvios",
          "proxima_em",
          "prazo_ate",
          "ultimo_estado_http",
          "ultimo_erro",
          "criada_em",
          "terminada_em",
        ])
        .orderBy("id", "desc")
        .limit(filtro.limite);
      if (filtro.subscricaoId !== undefined) {
        q = q.where("subscricao_id", "=", filtro.subscricaoId);
      }
      if (filtro.estado !== undefined)
        q = q.where("estado", "=", filtro.estado);
      if (filtro.depoisDe !== undefined)
        q = q.where("id", "<", filtro.depoisDe);
      return q.execute();
    },
    { soLeitura: true },
  );
}

/** O botão «reenviar»: a entrega volta a pendente, com o prazo e o recuo de novo. */
export async function reenviarEntrega(
  trx: Transaction<BaseDados>,
  id: string,
  agora: Date = new Date(),
): Promise<EntregaLida> {
  const e = await trx
    .selectFrom("webhook_entrega as d")
    .innerJoin("webhook_subscricao as s", "s.id", "d.subscricao_id")
    .select(["d.estado", "d.reenvios", "s.estado as estado_subscricao"])
    .where("d.id", "=", id)
    .forUpdate("d")
    .executeTakeFirst();
  if (e === undefined) return naoExiste();
  if (e.estado === "pendente") {
    throw new ErroWebhooks("webhooks.not_resendable", "já está pendente");
  }
  if (e.estado_subscricao !== "activa") {
    throw new ErroWebhooks(
      "webhooks.not_resendable",
      "a subscrição não está activa",
    );
  }
  await trx
    .updateTable("webhook_entrega")
    .set({
      estado: "pendente",
      tentativas: 0,
      reenvios: e.reenvios + 1,
      proxima_em: agora,
      prazo_ate: new Date(agora.getTime() + PRAZO_HORAS * 3_600_000),
      terminada_em: null,
    })
    .where("id", "=", id)
    .execute();
  return trx
    .selectFrom("webhook_entrega")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

// ------------------------------------------------------------ O publicador

export interface ResultadoDaVolta {
  distribuidos: number;
  entregues: number;
  repetir: number;
  desistidas: number;
  canceladas: number;
  /** `comerciante/entrega: código` das que deram erro fora do envio. */
  erros: string[];
}

const codigoDe = (erro: unknown) =>
  erro instanceof Error
    ? (/^[a-z_]+\.[a-z_]+/.exec(erro.message)?.[0] ?? erro.name)
    : "erro";

const minutos = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/**
 * O que acontece a uma entrega que falhou, à tentativa `tentativas`
 * (contando esta): repete-se depois do recuo, sem passar do prazo; a última
 * cai no prazo; depois do prazo, desiste (docs/38 §7). Função pura.
 */
export function depoisDeFalhar(
  tentativas: number,
  agora: Date,
  prazoAte: Date,
): { desistir: true } | { desistir: false; proximaEm: Date } {
  const espera = ESPERAS_MINUTOS[tentativas - 1];
  if (espera === undefined || agora.getTime() >= prazoAte.getTime()) {
    return { desistir: true };
  }
  const seguinte = minutos(agora, espera);
  return {
    desistir: false,
    proximaEm: seguinte.getTime() > prazoAte.getTime() ? prazoAte : seguinte,
  };
}

interface Tomada {
  entregaId: string;
  tentativa: number;
  prazoAte: Date;
  subscricaoId: string;
  url: string;
  segredoCifra: Buffer;
  chaveVersao: string;
  evento: EventoDaBase;
}

/**
 * Uma volta: em cada comerciante com webhooks, distribui os eventos novos e
 * envia as entregas vencidas, uma a uma. Um erro num comerciante não pára os
 * outros.
 */
export async function correrWebhooks(
  db: Kysely<BaseDados>,
  cfg: ConfigWebhooks,
  opcoes: {
    agora?: () => Date;
    porVolta?: number;
    /** Só estes comerciantes (os testes, que partilham a base). */
    comerciantes?: string[];
  } = {},
): Promise<ResultadoDaVolta> {
  const r: ResultadoDaVolta = {
    distribuidos: 0,
    entregues: 0,
    repetir: 0,
    desistidas: 0,
    canceladas: 0,
    erros: [],
  };
  const emissor = cfg.emissor;
  if (cfg.chave === undefined || emissor === undefined) return r;
  const agora = opcoes.agora ?? (() => new Date());
  const porVolta = opcoes.porVolta ?? 50;
  const { rows } = await sql<{
    c: string;
  }>`select webhook_comerciantes() as c`.execute(db);
  for (const { c } of rows) {
    if (opcoes.comerciantes?.includes(c) === false) continue;
    let ids: string[];
    try {
      ids = await comComerciante(db, c, async (trx) => {
        for (let i = 0; i < 5; i++) {
          const { rows: d } = await sql<{
            n: number;
          }>`select webhook_distribuir(200) as n`.execute(trx);
          const n = d[0]?.n ?? 0;
          r.distribuidos += n;
          if (n < 200) break;
        }
        return (
          await trx
            .selectFrom("webhook_entrega")
            .select("id")
            .where("estado", "=", "pendente")
            .where("proxima_em", "<=", agora())
            .orderBy("proxima_em")
            .orderBy("id")
            .limit(porVolta)
            .execute()
        ).map((x) => x.id);
      });
    } catch (erro) {
      r.erros.push(`${c}: ${codigoDe(erro)}`);
      continue;
    }
    for (const id of ids) {
      try {
        await enviarUma(db, cfg, emissor, c, id, agora, r);
      } catch (erro) {
        r.erros.push(`${c}/${id}: ${codigoDe(erro)}`);
      }
    }
  }
  return r;
}

/** Envia uma entrega, em três passos: a vez, o envio fora da transacção, o resultado. */
export async function enviarUma(
  db: Kysely<BaseDados>,
  cfg: ConfigWebhooks,
  emissor: Emissor,
  c: string,
  id: string,
  agora: () => Date,
  r: ResultadoDaVolta,
): Promise<void> {
  const chave = cfg.chave;
  if (chave === undefined) return;
  // 1. A vez.
  const t = await comComerciante(db, c, async (trx): Promise<Tomada | null> => {
    const d = await trx
      .selectFrom("webhook_entrega")
      .select(["subscricao_id", "tentativas", "prazo_ate"])
      .where("id", "=", id)
      .where("estado", "=", "pendente")
      .where("proxima_em", "<=", agora())
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (d === undefined) return null;
    const s = await trx
      .selectFrom("webhook_subscricao")
      .select(["id", "url", "estado", "segredo_cifra", "chave_versao"])
      .where("id", "=", d.subscricao_id)
      .executeTakeFirstOrThrow();
    if (s.estado !== "activa") {
      // Desactivada: acaba. Pausada: espera, sem gastar tentativas; se o
      // prazo passar, desiste na volta seguinte à retoma.
      if (s.estado === "desactivada") {
        await trx
          .updateTable("webhook_entrega")
          .set({ estado: "cancelada", terminada_em: agora() })
          .where("id", "=", id)
          .execute();
        r.canceladas += 1;
      } else {
        await trx
          .updateTable("webhook_entrega")
          .set({ proxima_em: minutos(agora(), VEZ_MINUTOS) })
          .where("id", "=", id)
          .execute();
      }
      return null;
    }
    await trx
      .updateTable("webhook_entrega")
      .set({ proxima_em: minutos(agora(), VEZ_MINUTOS) })
      .where("id", "=", id)
      .execute();
    const { rows } = await sql<EventoDaBase>`
      select * from webhook_evento_da_entrega(${id}::uuid)`.execute(trx);
    const evento = rows[0];
    if (evento === undefined) throw new Error("webhooks.event_missing");
    return {
      entregaId: id,
      tentativa: d.tentativas + 1,
      prazoAte: d.prazo_ate,
      subscricaoId: s.id,
      url: s.url,
      segredoCifra: s.segredo_cifra,
      chaveVersao: s.chave_versao,
      evento,
    };
  });
  if (t === null) return;
  // 2. O envio, fora da transacção.
  let resultado: { estado: number } | { erro: string };
  try {
    if (t.chaveVersao !== chave.versao) {
      resultado = { erro: "webhooks.key_unavailable" };
    } else {
      const segredo = decifrar(
        t.segredoCifra,
        t.subscricaoId,
        "webhook_segredo",
        chave,
      );
      const corpo = corpoDoEvento(t.evento);
      resultado = await emissor({
        url: t.url,
        corpo,
        cabecalhos: {
          "Content-Type": "application/json",
          "User-Agent": "Eurolify-Webhooks/1",
          "Eurolify-Event-Id": `evt_${t.evento.id}`,
          "Eurolify-Event-Type": t.evento.tipo,
          "Eurolify-Delivery-Id": `whd_${t.entregaId}`,
          "Eurolify-Delivery-Attempt": String(t.tentativa),
          "Eurolify-Signature": assinar(
            segredo,
            corpo,
            Math.floor(agora().getTime() / 1000),
          ),
        },
      });
    }
  } catch {
    resultado = { erro: "webhooks.internal" };
  }
  // 3. O resultado, noutra transacção; um erro da base aqui sobe.
  const fim = agora();
  await comComerciante(db, c, async (trx) => {
    const certo =
      "estado" in resultado &&
      resultado.estado >= 200 &&
      resultado.estado < 300;
    const base = {
      tentativas: t.tentativa,
      ultimo_estado_http: "estado" in resultado ? resultado.estado : null,
      ultimo_erro: certo
        ? null
        : "erro" in resultado
          ? resultado.erro
          : "webhooks.http_status",
    };
    if (certo) {
      await trx
        .updateTable("webhook_entrega")
        .set({ ...base, estado: "entregue", terminada_em: fim })
        .where("id", "=", t.entregaId)
        .execute();
      r.entregues += 1;
      return;
    }
    const seguinte = depoisDeFalhar(t.tentativa, fim, t.prazoAte);
    if (seguinte.desistir) {
      await trx
        .updateTable("webhook_entrega")
        .set({ ...base, estado: "desistida", terminada_em: fim })
        .where("id", "=", t.entregaId)
        .execute();
      r.desistidas += 1;
    } else {
      await trx
        .updateTable("webhook_entrega")
        .set({ ...base, proxima_em: seguinte.proximaEm })
        .where("id", "=", t.entregaId)
        .execute();
      r.repetir += 1;
    }
  });
}

/** O publicador em segundo plano: uma volta a cada 15 s, sem se sobrepor. */
export function agendarWebhooks(
  base: Kysely<BaseDados>,
  cfg: ConfigWebhooks,
  registo: {
    info: (o: object, m: string) => void;
    error: (o: object, m: string) => void;
  },
): () => void {
  let aCorrer = false;
  const volta = () => {
    if (aCorrer) return;
    aCorrer = true;
    correrWebhooks(base, cfg)
      .then((r) => {
        if (r.erros.length > 0) {
          registo.error({ erros: r.erros }, "webhooks: entregas com erros");
        }
        if (r.desistidas > 0) {
          registo.error(
            { desistidas: r.desistidas },
            "webhooks: entregas desistidas (GET /webhook-deliveries?estado=desistida)",
          );
        }
        if (r.distribuidos + r.entregues + r.repetir + r.canceladas > 0) {
          registo.info(r, "webhooks: volta");
        }
      })
      .catch((erro: unknown) => {
        registo.error(
          { erro: erro instanceof Error ? erro.name : "erro" },
          "webhooks: a volta falhou",
        );
      })
      .finally(() => {
        aCorrer = false;
      });
  };
  const t = setInterval(volta, 15 * 1000);
  t.unref();
  return () => {
    clearInterval(t);
  };
}
