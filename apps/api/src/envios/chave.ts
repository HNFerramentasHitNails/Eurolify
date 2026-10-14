import { sql, type Kysely } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { aplicarRasto, contextoDaTarefa } from "../base/rasto.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { cifrar, decifrar } from "../pagamentos/cifra.js";
import type { ConfigEnvios } from "./adaptador.js";

// A troca da chave das credenciais (docs/36 §25; §14, P3-7). Com a
// ENVIOS_CHAVE nova e a antiga em ENVIOS_CHAVE_ANTERIOR, cada conta ainda
// cifrada com a anterior é decifrada com ela e cifrada outra vez com a nova,
// na mesma transacção e com a conta bloqueada: as credenciais não mudam, só
// a cifra e a versão (a conta pronta continua pronta; 0103). Quando não
// falta nenhuma, tira-se a anterior.

export interface ResultadoRecifrar {
  /** As contas passadas para a chave actual nesta volta. */
  recifradas: number;
  /**
   * As contas que ficaram noutra versão da chave (sem a anterior ligada,
   * com uma versão que nenhuma das duas abre, ou que falharam). Com zero,
   * tira-se a ENVIOS_CHAVE_ANTERIOR.
   */
  faltam: number;
  falhas: number;
}

/**
 * Passa para a chave actual as contas cifradas com a anterior, no máximo
 * `limite` por volta. Sem chave actual, não faz nada; sem a anterior, só
 * conta as que faltam. Uma conta que falhe não pára as outras, e conta-se.
 */
export async function recifrarContas(
  db: Kysely<BaseDados>,
  cfg: ConfigEnvios | undefined,
  limite = 100,
): Promise<ResultadoRecifrar> {
  const r: ResultadoRecifrar = { recifradas: 0, faltam: 0, falhas: 0 };
  const actual = cfg?.chave;
  if (actual === undefined) return r;
  const anterior = cfg?.chaveAnterior;
  const { rows } = await sql<{
    comerciante_id: string;
    conta_id: string;
  }>`select * from envios_contas_por_recifrar(${actual.versao}, ${limite})`.execute(
    db,
  );
  for (const { comerciante_id: c, conta_id: id } of rows) {
    if (anterior === undefined) {
      r.faltam += 1;
      continue;
    }
    try {
      const passou = await comComerciante(db, c, async (trx) => {
        await aplicarRasto(trx, contextoDaTarefa("envios_chave", null));
        const conta = await trx
          .selectFrom("conta_transportadora")
          .select([
            "estado",
            "credenciais_cifra",
            "segredo_aviso_cifra",
            "chave_versao",
          ])
          .where("id", "=", id)
          .forUpdate()
          .executeTakeFirst();
        // Mudou entretanto: credenciais novas (já na actual) ou arquivada.
        if (
          conta === undefined ||
          conta.estado === "arquivada" ||
          conta.chave_versao === actual.versao
        ) {
          return "ja" as const;
        }
        // Numa versão que a anterior não abre: fica para uma pessoa.
        if (
          conta.chave_versao !== anterior.versao ||
          conta.credenciais_cifra === null
        ) {
          return "fica" as const;
        }
        const credenciais = decifrar(
          conta.credenciais_cifra,
          id,
          "credenciais",
          anterior,
        );
        const segredo =
          conta.segredo_aviso_cifra === null
            ? null
            : decifrar(
                conta.segredo_aviso_cifra,
                id,
                "segredo_aviso",
                anterior,
              );
        await trx
          .updateTable("conta_transportadora")
          .set({
            credenciais_cifra: cifrar(credenciais, id, "credenciais", actual),
            segredo_aviso_cifra:
              segredo === null
                ? null
                : cifrar(segredo, id, "segredo_aviso", actual),
            chave_versao: actual.versao,
          })
          .where("id", "=", id)
          .execute();
        return "passou" as const;
      });
      if (passou === "passou") r.recifradas += 1;
      else if (passou === "fica") r.faltam += 1;
    } catch {
      // Uma cifra que a anterior não abre (estragada, ou de outra chave com a
      // mesma versão): fica como está, e conta-se.
      r.falhas += 1;
      r.faltam += 1;
    }
  }
  return r;
}
