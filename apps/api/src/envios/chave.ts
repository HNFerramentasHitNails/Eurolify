import { sql, type Kysely } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { aplicarRasto, contextoDaTarefa } from "../base/rasto.js";
import { comComerciante } from "../comerciante/repositorio.js";
import {
  chavePagamentos,
  cifrar,
  decifrar,
  type ChavePagamentos,
} from "../pagamentos/cifra.js";
import type { ConfigEnvios } from "./adaptador.js";

// A troca da chave das credenciais (docs/36 §25; §14, P3-7). Com a
// ENVIOS_CHAVE nova e a antiga em ENVIOS_CHAVE_ANTERIOR, cada conta ainda
// cifrada com a anterior é decifrada com ela e cifrada outra vez com a nova,
// na mesma transacção e com a conta bloqueada: as credenciais não mudam, só
// a cifra e a versão (a conta pronta continua pronta; 0103). Quando não
// falta nenhuma, tira-se a anterior.

/**
 * Lê as chaves dos envios das variáveis de ambiente (revisão do #466,
 * P2-4): a actual (`ENVIOS_CHAVE`, versão por omissão «1») e, durante a
 * troca, a anterior (`ENVIOS_CHAVE_ANTERIOR`, com a versão obrigatória e
 * diferente). Com as variáveis mal postas, lança: a API não arranca com uma
 * troca a meio que não se sabe fazer.
 */
export function lerChavesEnvios(env: Record<string, string | undefined>): {
  chave?: ChavePagamentos;
  chaveAnterior?: ChavePagamentos;
} {
  const valor = (nome: string) => {
    const v = env[nome]?.trim();
    return v === undefined || v === "" ? undefined : v;
  };
  // A mensagem de `chavePagamentos` nomeia as variáveis dos pagamentos
  // (P3-3): aqui diz-se qual das dos envios está mal.
  const ler = (nome: string, texto: string, versao: string) => {
    try {
      return chavePagamentos(texto, versao);
    } catch {
      throw new Error(
        `${nome}: tem de ter 32 bytes em base64, e a versão 1 a 20 letras, algarismos, _ ou -`,
      );
    }
  };
  const texto = valor("ENVIOS_CHAVE");
  const textoAnterior = valor("ENVIOS_CHAVE_ANTERIOR");
  const versaoAnterior = valor("ENVIOS_CHAVE_ANTERIOR_VERSAO");
  const chave =
    texto === undefined
      ? undefined
      : ler("ENVIOS_CHAVE", texto, valor("ENVIOS_CHAVE_VERSAO") ?? "1");
  if (textoAnterior === undefined) {
    // Uma versão anterior sem a chave é uma troca mal posta (P3-2).
    if (versaoAnterior !== undefined) {
      throw new Error("ENVIOS_CHAVE_ANTERIOR_VERSAO sem ENVIOS_CHAVE_ANTERIOR");
    }
    return chave === undefined ? {} : { chave };
  }
  if (chave === undefined) {
    throw new Error("ENVIOS_CHAVE_ANTERIOR sem ENVIOS_CHAVE");
  }
  if (versaoAnterior === undefined) {
    throw new Error("ENVIOS_CHAVE_ANTERIOR sem ENVIOS_CHAVE_ANTERIOR_VERSAO");
  }
  const chaveAnterior = ler(
    "ENVIOS_CHAVE_ANTERIOR",
    textoAnterior,
    versaoAnterior,
  );
  // Com a mesma versão das duas, não se sabe qual abre cada conta.
  if (chaveAnterior.versao === chave.versao) {
    throw new Error(
      "ENVIOS_CHAVE_ANTERIOR_VERSAO tem de ser diferente da ENVIOS_CHAVE_VERSAO",
    );
  }
  return { chave, chaveAnterior };
}

export interface ResultadoRecifrar {
  /** As contas passadas para a chave actual nesta volta. */
  recifradas: number;
  /**
   * Quantas contas ainda estão noutra versão da chave **depois** da volta
   * (até 1000): as que ficam para a próxima, as que nenhuma chave abre e as
   * que falharam (revisão do #466, P1-1). Só com zero se tira a
   * ENVIOS_CHAVE_ANTERIOR.
   */
  faltam: number;
  /** As cifras que a anterior não abriu (estragadas, ou de outra chave). */
  ilegiveis: number;
  /** Os erros da base, por conta (bloqueio, ligação…): tenta-se outra vez. */
  falhas: number;
}

/** A cifra não abriu com a chave anterior. */
class CifraIlegivel extends Error {}

const abrir = (
  cifrado: Buffer,
  id: string,
  campo: "credenciais" | "segredo_aviso",
  chave: ChavePagamentos,
) => {
  try {
    return decifrar(cifrado, id, campo, chave);
  } catch {
    throw new CifraIlegivel(campo);
  }
};

/** Até 1000: o número que se regista, não um limite das contas. */
const MAX_CONTAGEM = 1000;

/**
 * Passa para a chave actual as contas cifradas com a anterior, no máximo
 * `limite` por volta, e diz quantas ainda faltam. Sem chave actual, não faz
 * nada; sem a anterior, só conta. Uma conta que falhe não pára as outras, e
 * conta-se.
 */
export async function recifrarContas(
  db: Kysely<BaseDados>,
  cfg: ConfigEnvios | undefined,
  limite = 100,
): Promise<ResultadoRecifrar> {
  const r: ResultadoRecifrar = {
    recifradas: 0,
    faltam: 0,
    ilegiveis: 0,
    falhas: 0,
  };
  const actual = cfg?.chave;
  if (actual === undefined) return r;
  const anterior = cfg?.chaveAnterior;
  if (anterior !== undefined) {
    // Só as da versão anterior: as que nenhuma chave abre não lhes tiram a
    // vez (revisão do #466, P2-1).
    const { rows } = await sql<{
      comerciante_id: string;
      conta_id: string;
    }>`select comerciante_id, conta_id
       from envios_contas_por_recifrar(${actual.versao}, ${anterior.versao}, ${limite})`.execute(
      db,
    );
    for (const { comerciante_id: c, conta_id: id } of rows) {
      try {
        const passou = await comComerciante(db, c, async (trx) => {
          await aplicarRasto(trx, contextoDaTarefa("envios_chave", null));
          const conta = await trx
            .selectFrom("conta_transportadora")
            .select([
              "credenciais_cifra",
              "segredo_aviso_cifra",
              "chave_versao",
            ])
            .where("id", "=", id)
            .forUpdate()
            .executeTakeFirst();
          // Mudou entretanto (credenciais novas, já na actual) ou não tem
          // nada para passar.
          if (
            conta === undefined ||
            conta.chave_versao !== anterior.versao ||
            conta.credenciais_cifra === null
          ) {
            return false;
          }
          const credenciais = abrir(
            conta.credenciais_cifra,
            id,
            "credenciais",
            anterior,
          );
          const segredo =
            conta.segredo_aviso_cifra === null
              ? null
              : abrir(conta.segredo_aviso_cifra, id, "segredo_aviso", anterior);
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
          return true;
        });
        if (passou) r.recifradas += 1;
      } catch (erro) {
        // Uma cifra que a anterior não abre fica como está, para uma
        // pessoa; um erro da base tenta-se na próxima volta (P3-1).
        if (erro instanceof CifraIlegivel) r.ilegiveis += 1;
        else r.falhas += 1;
      }
    }
  }
  // Quantas ainda faltam, depois da volta: todas as versões que não a
  // actual, também as que ficaram para a próxima volta (P1-1).
  const { rows: faltam } = await sql<{
    conta_id: string;
  }>`select conta_id
     from envios_contas_por_recifrar(${actual.versao}, null, ${MAX_CONTAGEM})`.execute(
    db,
  );
  r.faltam = faltam.length;
  return r;
}
