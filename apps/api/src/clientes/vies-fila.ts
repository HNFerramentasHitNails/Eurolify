import { sql, type Kysely } from "kysely";
import { comComerciante } from "../comerciante/repositorio.js";
import type { BaseDados } from "../base/esquema.js";
import {
  comerciantesComFilaVies,
  filaViesDoComerciante,
  registarVies,
} from "./repositorio.js";
import type { ConsultaVies } from "./vies.js";

// A fila do VIES (docs/23 §13.4): de minuto a minuto, as consultas que a
// base diz estarem por fazer (perfis novos, NIF mudado, a revalidação da
// noite, as que ficaram sem resposta), uma de cada vez, com pausa entre
// pedidos (o serviço de cada país recusa pedidos em simultâneo,
// MS_MAX_CONCURRENT_REQ, medido a 09/10/2026). A consulta HTTP corre fora de
// qualquer transacção; só a gravação da prova abre uma.

/** Quantas consultas de um comerciante por volta (**proposta**). */
export const CONSULTAS_POR_VOLTA = 20;

/** A pausa entre dois pedidos ao VIES (**proposta**): 1 s. */
export const PAUSA_ENTRE_PEDIDOS_MS = 1000;

/** De quanto em quanto tempo corre: um minuto. */
export const INTERVALO_DA_FILA_MS = 60 * 1000;

/** Quem fica na prova e na linha do tempo das consultas automáticas. */
export const QUEM_DA_FILA = "sistema:vies";

export interface ResultadoDaFila {
  consultas: number;
  falhas: number;
}

export async function correrFilaVies(
  base: Kysely<BaseDados>,
  consultar: ConsultaVies,
  aoFalhar: (comercianteId: string, perfilId: string, erro: unknown) => void,
  opcoes: { porVolta?: number; pausaMs?: number } = {},
): Promise<ResultadoDaFila> {
  const porVolta = opcoes.porVolta ?? CONSULTAS_POR_VOLTA;
  const pausaMs = opcoes.pausaMs ?? PAUSA_ENTRE_PEDIDOS_MS;
  const resultado: ResultadoDaFila = { consultas: 0, falhas: 0 };
  let primeira = true;
  for (const comercianteId of await comerciantesComFilaVies(base)) {
    const { consultas, requerente } = await filaViesDoComerciante(
      base,
      comercianteId,
      porVolta,
    );
    for (const c of consultas) {
      if (!primeira && pausaMs > 0) {
        await new Promise((r) => setTimeout(r, pausaMs));
      }
      primeira = false;
      try {
        const pedido = { pais: c.pais, numero: c.numero, requerente };
        const consultadoEm = new Date();
        const resposta = await consultar(pedido);
        await comComerciante(base, comercianteId, async (trx) => {
          await sql`select set_config('eurolify.quem', ${QUEM_DA_FILA}, true)`.execute(
            trx,
          );
          await registarVies(
            trx,
            comercianteId,
            c.perfil_id,
            pedido,
            resposta,
            consultadoEm,
            c.motivo,
          );
        });
        resultado.consultas += 1;
      } catch (erro) {
        resultado.falhas += 1;
        aoFalhar(comercianteId, c.perfil_id, erro);
      }
    }
  }
  return resultado;
}

/**
 * Corre a fila de minuto a minuto (servidor.ts). Uma volta não começa sem a
 * anterior acabar. Os erros vão para o registo só com os identificadores,
 * nunca o NIF (R12). Devolve a função que pára.
 */
export function agendarFilaVies(
  base: Kysely<BaseDados>,
  consultar: ConsultaVies,
  registo: {
    info: (o: object, m: string) => void;
    error: (o: object, m: string) => void;
  },
): () => void {
  let aCorrer = false;
  const volta = async () => {
    if (aCorrer) return;
    aCorrer = true;
    try {
      const r = await correrFilaVies(
        base,
        consultar,
        (comercianteId, perfilId, erro) => {
          registo.error(
            {
              comercianteId,
              perfil: `bpf_${perfilId}`,
              erro: erro instanceof Error ? erro.name : "erro",
            },
            "VIES: a consulta não ficou registada",
          );
        },
      );
      if (r.consultas > 0 || r.falhas > 0) {
        registo.info(r, "VIES: volta da fila");
      }
    } catch (erro) {
      registo.error(
        { erro: erro instanceof Error ? erro.name : "erro" },
        "VIES: a volta da fila falhou",
      );
    } finally {
      aCorrer = false;
    }
  };
  const temporizador = setInterval(() => void volta(), INTERVALO_DA_FILA_MS);
  temporizador.unref();
  return () => {
    clearInterval(temporizador);
  };
}
