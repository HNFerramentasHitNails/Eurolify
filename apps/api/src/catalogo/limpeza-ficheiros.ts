import { sql, type Kysely } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import type { Armazenamento } from "./armazenamento.js";
import { noCatalogo } from "./erros.js";

// A limpeza dos ficheiros de imagem sem uso (docs/14 §3.5, «Metadados,
// pessoas nas imagens e ficheiros sem uso»; issue #179; migração 0035). Ex.:
// uma fotografia enviada e nunca ligada a um artigo, ou desligada, sai do
// disco e da tabela ao fim de 7 dias sem uso, e o espaço do comerciante volta.
//
// Corre na API, e não no script da VPS, porque só a API toma a fila dos
// envios de cada comerciante (o bloqueio de `registarFicheiro`): um envio dos
// mesmos bytes ao mesmo tempo espera, e não fica uma linha sem ficheiro.
// Cada ficheiro numa transacção: a linha sai (só se a base confirmar que
// continua sem uso), o disco apaga-se, e só então se confirma. Se o disco
// falhar, a linha volta e o ficheiro fica para a volta seguinte.

/** Quantos ficheiros de um comerciante por volta (**proposta**). */
export const FICHEIROS_POR_VOLTA = 500;

/** De quanto em quanto tempo corre: um dia. */
export const INTERVALO_DA_LIMPEZA = 24 * 60 * 60 * 1000;

export interface ResultadoDaLimpeza {
  comerciantes: number;
  apagados: number;
  falhas: number;
}

export async function limparFicheirosSemUso(
  base: Kysely<BaseDados>,
  armazenamento: Armazenamento,
  aoFalhar: (comercianteId: string, resumo: string, erro: unknown) => void,
  porVolta = FICHEIROS_POR_VOLTA,
): Promise<ResultadoDaLimpeza> {
  const { rows: comerciantes } = await sql<{ id: string }>`
    select id from ficheiros_comerciantes_sem_uso() as id`.execute(base);
  const resultado: ResultadoDaLimpeza = {
    comerciantes: comerciantes.length,
    apagados: 0,
    falhas: 0,
  };
  for (const { id: comercianteId } of comerciantes) {
    const resumos = await noCatalogo(
      base,
      comercianteId,
      async (trx) =>
        (
          await sql<{ resumo: string }>`
            select resumo from ficheiros_sem_uso(${porVolta}) as resumo`.execute(
            trx,
          )
        ).rows.map((r) => r.resumo),
      { soLeitura: true },
    );
    for (const resumo of resumos) {
      try {
        const apagado = await noCatalogo(base, comercianteId, async (trx) => {
          // A fila dos envios do comerciante (a mesma de registarFicheiro).
          await sql`select pg_advisory_xact_lock(hashtextextended('eurolify.ficheiro:' || ${comercianteId}::uuid::text, 0))`.execute(
            trx,
          );
          const { rows } = await sql<{ apagou: boolean }>`
            select ficheiro_apagar_sem_uso(${resumo}) as apagou`.execute(trx);
          if (rows[0]?.apagou !== true) return false;
          await armazenamento.apagar(comercianteId, resumo);
          return true;
        });
        if (apagado) resultado.apagados += 1;
      } catch (erro) {
        resultado.falhas += 1;
        aoFalhar(comercianteId, resumo, erro);
      }
    }
  }
  return resultado;
}

/**
 * Corre a limpeza ao arrancar e depois uma vez por dia (servidor.ts). Cada
 * volta deixa no registo o que fez; uma volta que falhe inteira também
 * (`observability-security`: uma tarefa automática não pára em silêncio; a
 * verificação diária da VPS avisa se houver ficheiros sem uso há mais de 9
 * dias). Devolve a função que a pára.
 */
export function agendarLimpezaDosFicheiros(
  base: Kysely<BaseDados>,
  armazenamento: Armazenamento,
  registo: {
    info: (dados: object, mensagem: string) => void;
    error: (dados: object, mensagem: string) => void;
  },
): () => void {
  let aCorrer = false;
  const volta = () => {
    if (aCorrer) return;
    aCorrer = true;
    limparFicheirosSemUso(base, armazenamento, (comerciante, resumo, err) => {
      registo.error(
        { err, comerciante, resumo },
        "limpeza das imagens: um ficheiro não se apagou",
      );
    })
      .then((r) => {
        registo.info({ ...r }, "limpeza das imagens sem uso");
      })
      .catch((err: unknown) => {
        registo.error({ err }, "limpeza das imagens sem uso falhou");
      })
      .finally(() => {
        aCorrer = false;
      });
  };
  volta();
  const temporizador = setInterval(volta, INTERVALO_DA_LIMPEZA);
  temporizador.unref();
  return () => {
    clearInterval(temporizador);
  };
}
