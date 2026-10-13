import { sql, type Kysely } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { criarProblema } from "../posvenda/repositorio.js";
import { codigoDe, QUEM_DAS_TAREFAS } from "./etiquetas.js";
import { noEnvios } from "./repositorio.js";

// A encomenda parada perto da data-limite (docs/36 §18; Q4 da decisão ED).
// Quem decide se está parada é a base (`envios_paradas`, 0084): o estado, a
// data-limite copiada na encomenda, os dias de aviso e as unidades que ainda
// não saíram. Aqui só se abre o problema, uma vez por encomenda, e nunca se
// cancela nem reembolsa (decide uma pessoa).

export interface ResultadoParadas {
  abertos: number;
  falhas: number;
  /** Código do erro → quantas vezes (sem dados). */
  erros: Record<string, number>;
}

/** Já avisada por outra volta ao mesmo tempo: desfaz o problema desta. */
class JaAvisada extends Error {}

/** 2026-11-12 → 12/11/2026 (a data é a do checkout, sem fuso). */
const dataPt = (d: string) =>
  `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/**
 * Abre um problema por encomenda parada ainda não avisada, em todos os
 * comerciantes. `agora` diz que dia é (os testes passam-no); um erro numa
 * encomenda conta e não pára as outras.
 */
export async function avisarEncomendasParadas(
  db: Kysely<BaseDados>,
  agora = new Date(),
  porVolta = 50,
): Promise<ResultadoParadas> {
  const r: ResultadoParadas = { abertos: 0, falhas: 0, erros: {} };
  const falhou = (erro: unknown) => {
    r.falhas += 1;
    const k = codigoDe(erro);
    r.erros[k] = (r.erros[k] ?? 0) + 1;
  };
  const { rows } = await sql<{
    c: string;
  }>`select envios_comerciantes_com_paradas(${agora}) as c`.execute(db);
  for (const { c } of rows) {
    let paradas: {
      encomenda_id: string;
      data_limite: string;
      por_expedir: number;
    }[];
    try {
      paradas = await comComerciante(db, c, async (trx) => {
        const { rows: l } = await sql<{
          encomenda_id: string;
          data_limite: string;
          por_expedir: number;
        }>`select p.encomenda_id, p.data_limite::text as data_limite,
                  p.por_expedir::int as por_expedir
           from envios_paradas(${agora}, ${porVolta}) p`.execute(trx);
        return l;
      });
    } catch (erro) {
      falhou(erro);
      continue;
    }
    for (const p of paradas) {
      try {
        await noEnvios(db, c, async (trx) => {
          const unidades = p.por_expedir === 1 ? "unidade" : "unidades";
          const problema = await criarProblema(
            trx,
            c,
            {
              encomenda: p.encomenda_id,
              tipo: "atraso",
              descricao: `A encomenda tem ${String(p.por_expedir)} ${unidades} por expedir e a data-limite de entrega é ${dataPt(p.data_limite)}. Expeça, combine com o cliente ou decida o reembolso.`,
            },
            QUEM_DAS_TAREFAS,
          );
          const feito = await trx
            .insertInto("encomenda_parada")
            .values({
              encomenda_id: p.encomenda_id,
              comerciante_id: c,
              data_limite: p.data_limite,
              por_expedir: p.por_expedir,
              problema_id: problema,
            })
            .onConflict((oc) => oc.column("encomenda_id").doNothing())
            .returning("encomenda_id")
            .executeTakeFirst();
          if (feito === undefined) throw new JaAvisada();
        });
        r.abertos += 1;
      } catch (erro) {
        if (erro instanceof JaAvisada) continue;
        falhou(erro);
      }
    }
  }
  return r;
}
