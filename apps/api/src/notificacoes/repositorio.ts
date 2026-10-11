import { sql, type Kysely, type RawBuilder, type Transaction } from "kysely";
import type { BaseDados, EstadoNotificacao } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { ErroCorreio, type Correio } from "./correio.js";
import { mensagemDe, type DadosDoAviso } from "./modelos.js";

// As notificações (docs/33; migração 0066; Diogo, 11/10/2026: «aprovado, com
// a A», docs/06, DX). A base grava a fila (o gatilho do aviso); aqui só se
// envia, se repete e se lê.

const POR_VOLTA = 50;
/** As esperas depois de cada falha temporária, em minutos (N6). */
const ESPERAS = [1, 5, 30, 120, 360];
/** À 6.ª falha, fica falhada (N6). */
export const MAX_TENTATIVAS = ESPERAS.length + 1;

export interface ResultadoEnvios {
  enviadas: number;
  repetir: number;
  falhadas: number;
  canceladas: number;
  apagadas: number;
  /** As que deram erro fora do correio (`comerciante/notificação: código`). */
  erros: string[];
}

const codigoDe = (erro: unknown) =>
  erro instanceof Error
    ? (/^[a-z_]+\.[a-z_]+/.exec(erro.message)?.[0] ?? erro.name)
    : "erro";

/** Uma volta: as notificações vencidas de cada comerciante, uma a uma. */
export async function correrNotificacoes(
  db: Kysely<BaseDados>,
  correio: Correio,
  porVolta = POR_VOLTA,
): Promise<ResultadoEnvios> {
  const res: ResultadoEnvios = {
    enviadas: 0,
    repetir: 0,
    falhadas: 0,
    canceladas: 0,
    apagadas: 0,
    erros: [],
  };
  const { rows } = await sql<{
    c: string;
  }>`select notificacao_comerciantes() as c`.execute(db);
  for (const { c } of rows) {
    let ids: string[];
    try {
      ids = await comComerciante(db, c, async (trx) => {
        // A limpeza dos 90 dias (N9), de caminho.
        const { rows: a } = await sql<{
          n: number;
        }>`select notificacao_apagar_antigas() as n`.execute(trx);
        res.apagadas += a[0]?.n ?? 0;
        return (
          await trx
            .selectFrom("notificacao")
            .select("id")
            .where("estado", "=", "a_enviar")
            .where("proxima_em", "<=", sql<Date>`now()`)
            .orderBy("proxima_em")
            .orderBy("id")
            .limit(porVolta)
            .execute()
        ).map((n) => n.id);
      });
    } catch (erro) {
      res.erros.push(`${c}: ${codigoDe(erro)}`);
      continue;
    }
    // Cada uma na sua transacção: uma que falhe não desfaz as outras.
    for (const id of ids) {
      try {
        await comComerciante(db, c, (trx) => enviarUma(trx, correio, id, res));
      } catch (erro) {
        res.erros.push(`${c}/${id}: ${codigoDe(erro)}`);
      }
    }
  }
  return res;
}

/**
 * Envia uma, se ainda estiver por enviar e vencida (exportada para os testes:
 * a volta que a listou pode chegar depois de outra a ter enviado).
 */
export async function enviarUma(
  trx: Transaction<BaseDados>,
  correio: Correio,
  id: string,
  res: ResultadoEnvios,
) {
  // Bloqueada: outra volta ao mesmo tempo salta-a (SKIP LOCKED) e uma que já
  // saiu não sai outra vez.
  const n = await trx
    .selectFrom("notificacao")
    .select(["id", "tipo", "lingua", "dados", "tentativas"])
    .where("id", "=", id)
    .where("estado", "=", "a_enviar")
    .where("proxima_em", "<=", sql<Date>`now()`)
    .forUpdate()
    .skipLocked()
    .executeTakeFirst();
  if (n === undefined) return;
  const { rows } = await sql<{
    email: string;
    nome: string;
  }>`select email, nome from notificacao_destino(${id}::uuid)`.execute(trx);
  const destino = rows[0];
  if (destino === undefined) {
    // A pessoa saiu, foi desactivada ou deixou de ser dona ou gestora.
    await mudar(trx, id, {
      estado: "cancelada",
      ultimo_erro: "destinatario_inactivo",
    });
    res.canceladas += 1;
    return;
  }
  const mensagem = mensagemDe(
    n.tipo,
    n.lingua,
    n.dados as unknown as DadosDoAviso,
    destino,
  );
  try {
    // N7: se a máquina parar entre o servidor aceitar e o commit, o aviso
    // pode sair duas vezes (aceite para os avisos à equipa).
    const r = await correio.enviar(mensagem);
    await mudar(trx, id, {
      estado: "enviada",
      id_mensagem: r.id.slice(0, 300),
      ultimo_erro: null,
    });
    res.enviadas += 1;
  } catch (erro) {
    const e =
      erro instanceof ErroCorreio
        ? erro
        : new ErroCorreio("desconhecido", true);
    const tentativas = n.tentativas + 1;
    if (!e.temporario || tentativas >= MAX_TENTATIVAS) {
      await mudar(trx, id, {
        estado: "falhada",
        tentativas,
        ultimo_erro: e.codigo,
      });
      res.falhadas += 1;
      return;
    }
    const espera = ESPERAS[tentativas - 1] ?? ESPERAS[ESPERAS.length - 1] ?? 1;
    await mudar(trx, id, {
      tentativas,
      ultimo_erro: e.codigo,
      proxima_em: sql<Date>`now() + make_interval(mins => ${espera})`,
    });
    res.repetir += 1;
  }
}

const mudar = (
  trx: Transaction<BaseDados>,
  id: string,
  campos: {
    estado?: EstadoNotificacao;
    tentativas?: number;
    ultimo_erro?: string | null;
    id_mensagem?: string;
    proxima_em?: RawBuilder<Date>;
  },
) => trx.updateTable("notificacao").set(campos).where("id", "=", id).execute();

export function agendarNotificacoes(
  base: Kysely<BaseDados>,
  correio: Correio,
  registo: {
    info: (o: object, m: string) => void;
    error: (o: object, m: string) => void;
  },
): () => void {
  let aCorrer = false;
  const volta = () => {
    if (aCorrer) return;
    aCorrer = true;
    correrNotificacoes(base, correio)
      .then((r) => {
        if (r.erros.length > 0) {
          registo.error({ erros: r.erros }, "notificações: envios com erros");
        }
        if (r.falhadas > 0) {
          registo.error(
            { falhadas: r.falhadas },
            "notificações: e-mails falhados (GET /notifications?estado=falhada)",
          );
        }
        if (r.enviadas + r.repetir + r.canceladas > 0) {
          registo.info(r, "notificações: envios");
        }
      })
      .catch((erro: unknown) => {
        registo.error(
          { erro: erro instanceof Error ? erro.name : "erro" },
          "notificações: a volta falhou",
        );
      })
      .finally(() => {
        aCorrer = false;
      });
  };
  const t = setInterval(volta, 60 * 1000);
  t.unref();
  return () => {
    clearInterval(t);
  };
}

/** A lista do comerciante (N11): sem o endereço nem o corpo. */
export async function listarNotificacoes(
  db: Kysely<BaseDados>,
  c: string,
  filtro: { estado?: EstadoNotificacao; limite: number },
) {
  return comComerciante(db, c, async (trx) => {
    let q = trx
      .selectFrom("notificacao")
      .select([
        "id",
        "tipo",
        "referencia",
        "pessoa_id",
        "lingua",
        "estado",
        "tentativas",
        "proxima_em",
        "ultimo_erro",
        "criada_em",
        "terminada_em",
      ])
      .orderBy("criada_em", "desc")
      .orderBy("id", "desc")
      .limit(filtro.limite);
    if (filtro.estado !== undefined) q = q.where("estado", "=", filtro.estado);
    return q.execute();
  });
}
