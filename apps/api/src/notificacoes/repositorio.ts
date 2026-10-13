import { sql, type Kysely, type RawBuilder, type Transaction } from "kysely";
import type { BaseDados, EstadoNotificacao } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { ErroCorreio, type Correio, type Mensagem } from "./correio.js";
import {
  mensagemDe,
  type DadosDaLigacao,
  type DadosDoEnvio,
  type DadosDaTarefa,
  type DadosDoAviso,
} from "./modelos.js";

// As notificações (docs/34; migração 0067; Diogo, 11/10/2026: «aprovado, com
// a A», docs/06, DX). A base grava a fila (o gatilho do aviso); aqui só se
// envia, se repete e se lê.
//
// Cada envio em três passos (revisão do #373, P2-1): toma-se a vez numa
// transacção curta (a hora seguinte passa para daqui a 10 minutos), envia-se
// fora da transacção e grava-se o resultado noutra. A base não fica presa ao
// SMTP; se o processo parar a meio, a notificação volta daqui a 10 minutos
// (pode sair duas vezes, N7), nunca em ciclo de minuto a minuto.

const POR_VOLTA = 50;
/** As esperas depois de cada falha do destinatário, em minutos (N6). */
const ESPERAS = [1, 5, 30, 120, 360];
/** À 6.ª falha, fica falhada (N6). */
export const MAX_TENTATIVAS = ESPERAS.length + 1;
/** A vez tomada: o tempo até outra volta a poder tentar. */
const VEZ_MINUTOS = 10;
/** Depois de um erro do servidor, a próxima tentativa (sem contar). */
const ESPERA_SERVIDOR_MINUTOS = 5;

export interface ResultadoEnvios {
  enviadas: number;
  repetir: number;
  falhadas: number;
  canceladas: number;
  apagadas: number;
  /** O código do erro do servidor que parou a volta (P1-1). */
  servidor: string | null;
  /** As que deram erro fora do correio (`comerciante/notificação: código`). */
  erros: string[];
}

const codigoDe = (erro: unknown) =>
  erro instanceof Error
    ? (/^[a-z_]+\.[a-z_]+/.exec(erro.message)?.[0] ?? erro.name)
    : "erro";

/**
 * Uma volta: em cada comerciante com trabalho, a limpeza dos 90 dias e, com
 * correio, as notificações vencidas, uma a uma. Sem correio, só a limpeza
 * (revisão do #373, P3-4). Um erro do servidor pára a volta (P1-1).
 */
export async function correrNotificacoes(
  db: Kysely<BaseDados>,
  correio: Correio | undefined,
  porVolta = POR_VOLTA,
): Promise<ResultadoEnvios> {
  const res: ResultadoEnvios = {
    enviadas: 0,
    repetir: 0,
    falhadas: 0,
    canceladas: 0,
    apagadas: 0,
    servidor: null,
    erros: [],
  };
  const { rows } = await sql<{
    c: string;
  }>`select notificacao_comerciantes() as c`.execute(db);
  for (const { c } of rows) {
    let ids: string[];
    try {
      ids = await comComerciante(db, c, async (trx) => {
        const { rows: a } = await sql<{
          n: number;
        }>`select notificacao_apagar_antigas() as n`.execute(trx);
        res.apagadas += a[0]?.n ?? 0;
        if (correio === undefined) return [];
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
    for (const id of ids) {
      if (correio === undefined || res.servidor !== null) break;
      try {
        await enviarUma(db, c, correio, id, res);
      } catch (erro) {
        res.erros.push(`${c}/${id}: ${codigoDe(erro)}`);
      }
    }
    if (res.servidor !== null) break;
  }
  return res;
}

/**
 * Envia uma, se ainda estiver por enviar e vencida (exportada para os testes:
 * a volta que a listou pode chegar depois de outra a ter enviado).
 */
export async function enviarUma(
  db: Kysely<BaseDados>,
  c: string,
  correio: Correio,
  id: string,
  res: ResultadoEnvios,
) {
  // 1. A vez, numa transacção curta.
  const vez = await comComerciante(db, c, (trx) => tomarVez(trx, id, res));
  if (vez === null) return;
  // 2. O envio, fora da transacção.
  let resultado: { id: string } | ErroCorreio;
  try {
    resultado = await correio.enviar(vez.mensagem);
  } catch (erro) {
    resultado =
      erro instanceof ErroCorreio
        ? erro
        : new ErroCorreio("desconhecido", "servidor");
  }
  // 3. O resultado, noutra; um erro aqui sobe (não é um erro do envio).
  await comComerciante(db, c, async (trx) => {
    if (!(resultado instanceof ErroCorreio)) {
      await mudar(trx, id, {
        estado: "enviada",
        id_mensagem: resultado.id.slice(0, 300),
        ultimo_erro: null,
      });
      res.enviadas += 1;
      return;
    }
    if (resultado.culpa === "servidor") {
      // Não conta como tentativa: é da configuração ou do servidor.
      await mudar(trx, id, {
        ultimo_erro: resultado.codigo,
        proxima_em: sql<Date>`now() + make_interval(mins => ${ESPERA_SERVIDOR_MINUTOS})`,
      });
      res.servidor = resultado.codigo;
      return;
    }
    const tentativas = vez.tentativas + 1;
    if (
      resultado.culpa === "destinatario_recusado" ||
      tentativas >= MAX_TENTATIVAS
    ) {
      await mudar(trx, id, {
        estado: "falhada",
        tentativas,
        ultimo_erro: resultado.codigo,
      });
      res.falhadas += 1;
      return;
    }
    const espera = ESPERAS[tentativas - 1] ?? 360;
    await mudar(trx, id, {
      tentativas,
      ultimo_erro: resultado.codigo,
      proxima_em: sql<Date>`now() + make_interval(mins => ${espera})`,
    });
    res.repetir += 1;
  });
}

/**
 * Bloqueia a notificação (outra volta ao mesmo tempo salta-a), confere que
 * ainda faz sentido e toma a vez. Devolve o e-mail, ou nada (já não está por
 * enviar, ou ficou cancelada).
 */
async function tomarVez(
  trx: Transaction<BaseDados>,
  id: string,
  res: ResultadoEnvios,
): Promise<{ mensagem: Mensagem; tentativas: number } | null> {
  const n = await trx
    .selectFrom("notificacao")
    .select(["id", "tipo", "referencia", "lingua", "dados", "tentativas"])
    .where("id", "=", id)
    .where("estado", "=", "a_enviar")
    .where("proxima_em", "<=", sql<Date>`now()`)
    .forUpdate()
    .skipLocked()
    .executeTakeFirst();
  if (n === undefined) return null;
  // O aviso ainda faz sentido: a devolução continua à espera do reembolso
  // (revisão do #373, P2-2), ou o caso da tarefa continua vencido na mesma
  // passagem e com o mesmo prazo (docs/34 §12, T5). Senão, o e-mail diria o
  // contrário da realidade.
  const espera = await (n.tipo === "task.overdue"
    ? tarefaEspera(trx, n.referencia)
    : n.tipo === "invoicing.connection_error"
      ? ligacaoEspera(trx, n.referencia)
      : n.tipo === "shipment.needs_attention"
        ? envioEspera(trx, (n.dados as { expedicao?: unknown }).expedicao)
        : devolucaoEspera(trx, n.referencia));
  if (espera !== null) {
    await mudar(trx, id, { estado: "cancelada", ultimo_erro: espera });
    res.canceladas += 1;
    return null;
  }
  const { rows } = await sql<{
    email: string;
  }>`select email from notificacao_destino(${id}::uuid)`.execute(trx);
  const destino = rows[0];
  if (destino === undefined) {
    // A pessoa saiu, foi desactivada ou já não recebe este aviso (deixou de
    // ser dona ou gestora; o caso da tarefa tem agora outro responsável).
    await mudar(trx, id, {
      estado: "cancelada",
      ultimo_erro: "destinatario_inactivo",
    });
    res.canceladas += 1;
    return null;
  }
  // Uns dados que não dão texto falham já, com o código, em vez de repetir
  // o erro a cada volta (revisão do #389, P3-3).
  // As faturas retidas contam-se agora, não à hora do erro: a fatura que o
  // deu só fica retida depois (docs/29 §18; revisão do #422, P1-2).
  let dados = n.dados as unknown as
    DadosDoAviso | DadosDaTarefa | DadosDaLigacao | DadosDoEnvio;
  if (n.tipo === "invoicing.connection_error") {
    const { rows: r } = await sql<{
      n: number;
    }>`select faturacao_aviso_retidas(${n.referencia}::uuid) as n`.execute(trx);
    dados = { ...(dados as DadosDaLigacao), retidas: r[0]?.n ?? 0 };
  }
  let mensagem: Mensagem;
  try {
    mensagem = mensagemDe(n.tipo, n.lingua, dados, destino);
  } catch {
    await mudar(trx, id, { estado: "falhada", ultimo_erro: "dados_invalidos" });
    res.falhadas += 1;
    return null;
  }
  await mudar(trx, id, {
    proxima_em: sql<Date>`now() + make_interval(mins => ${VEZ_MINUTOS})`,
  });
  return { mensagem, tentativas: n.tentativas };
}

/** Nada, se a devolução ainda espera o reembolso; senão, o código. */
async function devolucaoEspera(
  trx: Transaction<BaseDados>,
  devolucao: string,
): Promise<string | null> {
  const { rows } = await sql<{
    dias: number | null;
  }>`select x.dias from posvenda_prazo_da_devolucao(${devolucao}::uuid) x`.execute(
    trx,
  );
  return rows[0]?.dias === null || rows[0]?.dias === undefined
    ? "devolucao_ja_nao_espera"
    : null;
}

/**
 * Nada, se a ligação continua com erro na mesma passagem (docs/29 §18);
 * senão, o código.
 */
async function ligacaoEspera(
  trx: Transaction<BaseDados>,
  passagem: string,
): Promise<string | null> {
  const { rows } = await sql<{
    espera: boolean;
  }>`select faturacao_aviso_espera(${passagem}::uuid) as espera`.execute(trx);
  return rows[0]?.espera === true ? null : "ligacao_ja_nao_espera";
}

/**
 * Nada, se a expedição do aviso ainda não acabou (docs/36 §20); senão, o
 * código.
 */
async function envioEspera(
  trx: Transaction<BaseDados>,
  expedicao: unknown,
): Promise<string | null> {
  if (typeof expedicao !== "string") return "dados_invalidos";
  const { rows } = await sql<{
    espera: boolean;
  }>`select envios_aviso_espera(${expedicao}::uuid) as espera`.execute(trx);
  return rows[0]?.espera === true ? null : "expedicao_ja_acabou";
}

/** Nada, se o caso do aviso ainda espera; senão, o código. */
async function tarefaEspera(
  trx: Transaction<BaseDados>,
  rasto: string,
): Promise<string | null> {
  const { rows } = await sql<{
    espera: boolean;
  }>`select tarefas_aviso_espera(${rasto}::uuid) as espera`.execute(trx);
  return rows[0]?.espera === true ? null : "tarefa_ja_nao_espera";
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
) =>
  trx
    .updateTable("notificacao")
    .set(campos)
    .where("id", "=", id)
    .where("estado", "=", "a_enviar")
    .execute();

export function agendarNotificacoes(
  base: Kysely<BaseDados>,
  correio: Correio | undefined,
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
        if (r.servidor !== null) {
          registo.error(
            { codigo: r.servidor },
            "notificações: o servidor de e-mail recusou; a volta parou (ver SMTP_* e o DNS)",
          );
        }
        if (r.falhadas > 0) {
          registo.error(
            { falhadas: r.falhadas },
            "notificações: e-mails falhados (GET /notifications?estado=falhada)",
          );
        }
        if (r.enviadas + r.repetir + r.canceladas + r.apagadas > 0) {
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
