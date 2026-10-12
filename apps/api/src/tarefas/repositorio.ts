import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados, FilaTarefa } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { traduzir } from "./erros.js";

// As tarefas das filas que pedem uma pessoa (docs/33; migração 0066;
// decisão DW). A lista lê os casos abertos de cada fila na base
// (`tarefas_casos()`); a tarefa só guarda quem decide e até quando. Todas
// as regras (quem pode ser responsável, o prazo legal, a versão, o aviso)
// estão nas funções da base: aqui só se chamam.

export interface CasoAberto {
  fila: FilaTarefa;
  caso: string;
  entrou_em: Date;
  motivo: string;
  prazo_legal: string | null;
  encomenda: string | null;
  responsavel: string | null;
  prazo: Date;
  prazo_definido: boolean;
  vencida: boolean;
  aviso_vencido_em: Date | null;
  versao: number;
  /** Para o cursor: o prazo em microssegundos (o `Date` perde-os). */
  prazo_us: string;
}

export interface FiltroTarefas {
  filas: FilaTarefa[];
  /** `sem` = sem responsável; senão o id da pessoa (sem prefixo). */
  responsavel?: string;
  vencida?: boolean;
  depoisDe?: { prazoUs: string; fila: string; caso: string };
  limite: number;
}

async function emTarefas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (erro) {
    throw traduzir(erro);
  }
}

const COLUNAS = sql`x.fila, x.caso, x.entrou_em, x.motivo,
  to_char(x.prazo_legal, 'YYYY-MM-DD') as prazo_legal, x.encomenda, x.responsavel,
  x.prazo, x.prazo_definido, x.vencida, x.aviso_vencido_em, x.versao,
  floor(extract(epoch from x.prazo) * 1000000)::bigint::text as prazo_us`;

function filtros(f: Omit<FiltroTarefas, "limite" | "depoisDe" | "filas">) {
  const partes = [sql`true`];
  if (f.responsavel === "sem") partes.push(sql`x.responsavel is null`);
  else if (f.responsavel !== undefined)
    partes.push(sql`x.responsavel = ${f.responsavel}::uuid`);
  if (f.vencida !== undefined) partes.push(sql`x.vencida = ${f.vencida}`);
  return sql.join(partes, sql` and `);
}

/**
 * Os casos abertos das filas pedidas, do prazo mais próximo ao mais longe,
 * com cursor; e o total de cada fila com os mesmos filtros (R10: a lista
 * nunca corta em silêncio).
 */
export async function listarTarefas(
  db: Kysely<BaseDados>,
  comercianteId: string,
  f: FiltroTarefas,
): Promise<{
  dados: CasoAberto[];
  totais: Partial<Record<FilaTarefa, number>>;
  haMais: boolean;
}> {
  return emTarefas(() =>
    comComerciante(
      db,
      comercianteId,
      async (trx) => {
        const onde = filtros(f);
        const depois =
          f.depoisDe === undefined
            ? sql`true`
            : sql`(floor(extract(epoch from x.prazo) * 1000000)::bigint, x.fila, x.caso)
                > (${f.depoisDe.prazoUs}::bigint, ${f.depoisDe.fila}, ${f.depoisDe.caso}::uuid)`;
        const linhas = (
          await sql<CasoAberto>`select ${COLUNAS}
            from tarefas_casos(${f.filas}::text[]) x
            where ${onde} and ${depois}
            order by x.prazo, x.fila, x.caso
            limit ${f.limite + 1}`.execute(trx)
        ).rows;
        const totais = (
          await sql<{
            fila: FilaTarefa;
            n: number;
          }>`select x.fila, count(*)::int as n from tarefas_casos(${f.filas}::text[]) x
             where ${onde} group by x.fila`.execute(trx)
        ).rows;
        const resultado: Partial<Record<FilaTarefa, number>> = {};
        for (const fila of f.filas) resultado[fila] = 0;
        for (const t of totais) resultado[t.fila] = t.n;
        return {
          dados: linhas.slice(0, f.limite),
          totais: resultado,
          haMais: linhas.length > f.limite,
        };
      },
      { soLeitura: true },
    ),
  );
}

export interface PassoDaAtribuicao {
  acto: "atribuida" | "retirada" | "prazo_mudado" | "vencida";
  responsavel_antes: string | null;
  responsavel_depois: string | null;
  prazo_antes: Date | null;
  prazo_depois: Date | null;
  motivo: string | null;
  quem: string;
  em: Date;
  entrou_em: Date;
}

/** Um caso aberto e o histórico das atribuições dele, de todas as passagens. */
export async function lerTarefa(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fila: FilaTarefa,
  caso: string,
): Promise<{ caso: CasoAberto; historico: PassoDaAtribuicao[] } | null> {
  return emTarefas(() =>
    comComerciante(
      db,
      comercianteId,
      async (trx) => {
        const aberto = (
          await sql<CasoAberto>`select ${COLUNAS}
            from tarefas_casos(${[fila]}::text[]) x
            where x.caso = ${caso}::uuid`.execute(trx)
        ).rows[0];
        if (aberto === undefined) return null;
        const historico = await trx
          .selectFrom("atribuicao_rasto as r")
          .innerJoin("atribuicao as a", "a.id", "r.atribuicao_id")
          .select([
            "r.acto",
            "r.responsavel_antes",
            "r.responsavel_depois",
            "r.prazo_antes",
            "r.prazo_depois",
            "r.motivo",
            "r.quem",
            "r.em",
            "a.entrou_em",
          ])
          .where("a.fila", "=", fila)
          .where("a.caso", "=", caso)
          .orderBy("r.em")
          .orderBy("r.id")
          .execute();
        return { caso: aberto, historico };
      },
      { soLeitura: true },
    ),
  );
}

/** Atribui (ou tira, com `null`) o caso aberto; devolve a versão nova (R3, R7). */
export async function atribuir(
  trx: Transaction<BaseDados>,
  fila: FilaTarefa,
  caso: string,
  responsavel: string | null,
  versao: number,
): Promise<number> {
  // Quem escreve vem de `eurolify.quem`, posto pela rota (revisão do #375, P2-2).
  return emTarefas(async () => {
    const r = await sql<{
      v: number;
    }>`select tarefas_atribuir(${fila}, ${caso}::uuid, ${responsavel}::uuid,
         ${versao}) as v`.execute(trx);
    return r.rows[0]?.v ?? versao;
  });
}

/** Muda o prazo, com motivo; devolve a versão nova (R5, R7). */
export async function mudarPrazo(
  trx: Transaction<BaseDados>,
  fila: FilaTarefa,
  caso: string,
  prazo: Date,
  motivo: string,
  versao: number,
): Promise<number> {
  return emTarefas(async () => {
    const r = await sql<{
      v: number;
    }>`select tarefas_mudar_prazo(${fila}, ${caso}::uuid, ${prazo}::timestamptz,
         ${motivo}, ${versao}) as v`.execute(trx);
    return r.rows[0]?.v ?? versao;
  });
}

/**
 * As pessoas deste comerciante que podem ser responsáveis de um caso da fila
 * (R3), pela régua da base (`tarefas_podem_ser_responsaveis`, migração 0072):
 * o «Atribuir…» do Hub mostra estas, sem cópia da régua (docs/22 §28.2).
 */
export function podemSerResponsaveis(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fila: FilaTarefa,
): Promise<string[]> {
  return emTarefas(() =>
    comComerciante(
      db,
      comercianteId,
      async (trx) =>
        (
          await sql<{
            p: string;
          }>`select x as p from tarefas_podem_ser_responsaveis(${fila}) x`.execute(
            trx,
          )
        ).rows.map((r) => r.p),
      { soLeitura: true },
    ),
  );
}

/** O fuso do comerciante (o ecrã «A decidir» mostra os prazos nele). */
export function fusoDo(
  db: Kysely<BaseDados>,
  comercianteId: string,
): Promise<string> {
  return comComerciante(
    db,
    comercianteId,
    async (trx) =>
      (
        await trx
          .selectFrom("comerciante")
          .select("fuso")
          .where("id", "=", comercianteId)
          .executeTakeFirstOrThrow()
      ).fuso,
    { soLeitura: true },
  );
}

/**
 * O responsável de agora de um caso aberto (sem o prefixo), na transacção
 * de quem vai escrever; nenhum se não tem, ou se o caso não está aberto
 * (a escrita dá então o erro da base).
 */
export async function responsavelDe(
  trx: Transaction<BaseDados>,
  fila: FilaTarefa,
  caso: string,
): Promise<string | null> {
  const { rows } = await sql<{ responsavel: string | null }>`
    select x.responsavel from tarefas_casos(${[fila]}::text[]) x
    where x.caso = ${caso}::uuid`.execute(trx);
  return rows[0]?.responsavel ?? null;
}
