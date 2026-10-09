import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import type { EntradaDecisao, Tabelas, Taxa } from "./decisao.js";
import { ErroIva, type CodigoErroIva } from "./erros.js";

// O Motor de IVA na base (docs/24; migração 0040): as tabelas globais (só
// leitura), as declarações do regime de cada entidade legal, e o que a
// decisão precisa de Clientes (o perfil, a prova do VIES, a isenção).

export { ErroIva, type CodigoErroIva } from "./erros.js";

const CODIGOS_DA_BASE: readonly CodigoErroIva[] = [
  "tax.declaration_by_person",
  "tax.invalid_registration",
];

export function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error) || erro instanceof ErroIva) return erro;
  const codigo = CODIGOS_DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroIva(codigo, erro.message, { cause: erro });
  }
  const pg = erro as Error & { code?: string; table?: string };
  if (pg.code === "22P02" && /uuid/.test(erro.message)) {
    return new ErroIva("tax.not_found", "não existe", { cause: erro });
  }
  if (pg.code === "23503" && pg.table === "declaracao_regime") {
    return new ErroIva("tax.not_found", "a entidade legal não existe", {
      cause: erro,
    });
  }
  if (pg.code === "23514" && pg.table === "declaracao_regime") {
    return new ErroIva("tax.invalid_field", erro.message, { cause: erro });
  }
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
    return new ErroIva("tax.retry", "tentar outra vez", { cause: erro });
  }
  return erro;
}

async function noIva<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
): Promise<T> {
  if (db.isTransaction) {
    const trx = db as Transaction<BaseDados>;
    try {
      const { rows } = await sql<{ c: string | null }>`
        select current_setting('eurolify.comerciante', true) as c`.execute(trx);
      if (rows[0]?.c !== comercianteId) {
        throw new Error("noIva: a transacção aberta é de outro comerciante");
      }
      return await fn(trx);
    } catch (erro) {
      throw traduzir(erro);
    }
  }
  try {
    return await comComerciante(db, comercianteId, fn);
  } catch (erro) {
    throw traduzir(erro);
  }
}

/** As tabelas globais do Motor (iguais para todos os comerciantes). */
export async function carregarTabelas(db: Kysely<BaseDados>): Promise<Tabelas> {
  const [categorias, taxas, territorios, motivos] = await Promise.all([
    db.selectFrom("categoria_fiscal").select(["codigo", "estado"]).execute(),
    // O início como texto: uma `date` lida como Date muda de dia com o fuso
    // do processo (revisão do #256, P2-2).
    db
      .selectFrom("taxa_iva")
      .selectAll()
      .select(sql<string>`to_char(inicio, 'YYYY-MM-DD')`.as("inicio_texto"))
      .execute(),
    db.selectFrom("territorio_fiscal").selectAll().execute(),
    db.selectFrom("motivo_iva").select(["pais", "codigo", "tipo"]).execute(),
  ]);
  return {
    categorias,
    taxas: taxas.map((t): Taxa => ({
      id: t.id,
      pais: t.pais,
      regiao: t.regiao,
      categoria: t.categoria,
      tipo: t.tipo,
      percentagem: t.percentagem,
      codigo_motivo: t.codigo_motivo,
      inicio: t.inicio_texto,
      fonte: t.fonte,
      verificado: t.verificado,
    })),
    territorios,
    motivos,
  };
}

export async function listarCategorias(db: Kysely<BaseDados>) {
  return db
    .selectFrom("categoria_fiscal")
    .selectAll()
    .orderBy("codigo")
    .execute();
}

export async function listarTaxas(
  db: Kysely<BaseDados>,
  filtro: { pais?: string; categoria?: string },
) {
  let q = db.selectFrom("taxa_iva").selectAll();
  if (filtro.pais !== undefined) q = q.where("pais", "=", filtro.pais);
  if (filtro.categoria !== undefined) {
    q = q.where("categoria", "=", filtro.categoria);
  }
  return q
    .orderBy("pais")
    .orderBy(sql`regiao nulls first`)
    .orderBy("inicio")
    .execute();
}

export async function listarTerritorios(db: Kysely<BaseDados>) {
  return db
    .selectFrom("territorio_fiscal")
    .selectAll()
    .orderBy("pais")
    .orderBy("prefixo_cp")
    .execute();
}

export async function listarMotivos(db: Kysely<BaseDados>, pais?: string) {
  let q = db.selectFrom("motivo_iva").selectAll();
  if (pais !== undefined) q = q.where("pais", "=", pais);
  return q.orderBy("pais").orderBy("codigo").execute();
}

// ------------------------------------------------- O regime (§3.5)

/** As entidades legais do comerciante, com a última declaração de cada uma. */
export async function listarRegistos(
  db: Kysely<BaseDados>,
  comercianteId: string,
) {
  return noIva(db, comercianteId, async (trx) => {
    const entidades = await trx
      .selectFrom("entidade_legal")
      .select(["id", "denominacao", "pais", "estado"])
      .orderBy("id")
      .execute();
    const declaracoes = await trx
      .selectFrom("declaracao_regime")
      .selectAll()
      .orderBy("declarado_em", "desc")
      .orderBy("id", "desc")
      .execute();
    return entidades.map((e) => ({
      ...e,
      declaracao: declaracoes.find((d) => d.entidade_legal_id === e.id) ?? null,
    }));
  });
}

export async function declararRegime(
  db: Kysely<BaseDados>,
  comercianteId: string,
  entidadeId: string,
  dados: {
    regime: "origem" | "destino";
    oss_desde: string | null;
    registos: { pais: string; numero: string; desde?: string }[];
  },
): Promise<void> {
  await noIva(db, comercianteId, async (trx) => {
    await trx
      .insertInto("declaracao_regime")
      .values({
        comerciante_id: comercianteId,
        entidade_legal_id: entidadeId,
        regime: dados.regime,
        oss_desde: dados.oss_desde,
        registos: JSON.stringify(dados.registos),
      })
      .execute();
  });
}

// ---------------------------------------- O que a decisão precisa (§5.1)

/** O país e o regime da entidade legal que vende. */
export async function comercianteParaDecisao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  entidadeId: string,
): Promise<EntradaDecisao["comerciante"]> {
  return noIva(db, comercianteId, async (trx) => {
    const e = await trx
      .selectFrom("entidade_legal")
      .select(["pais"])
      .where("id", "=", entidadeId)
      .executeTakeFirst();
    if (e === undefined) {
      throw new ErroIva("tax.not_found", "a entidade legal não existe");
    }
    const d = await trx
      .selectFrom("declaracao_regime")
      .select("regime")
      .where("entidade_legal_id", "=", entidadeId)
      .orderBy("declarado_em", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();
    const c = await trx
      .selectFrom("comerciante")
      .select("fuso")
      .where("id", "=", comercianteId)
      .executeTakeFirstOrThrow();
    return {
      pais: e.pais,
      regime: d?.regime ?? "por_declarar",
      fuso: c.fuso,
    };
  });
}

/** O perfil de faturação, a prova do VIES e a isenção em vigor. */
export async function perfilParaDecisao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
): Promise<NonNullable<EntradaDecisao["perfil"]>> {
  return noIva(db, comercianteId, async (trx) => {
    const p = await trx
      .selectFrom("perfil_faturacao")
      .select(["pais_contribuinte", "nif_numero", "estado"])
      .where("id", "=", perfilId)
      .executeTakeFirst();
    if (p === undefined) {
      throw new ErroIva("tax.not_found", "o perfil não existe");
    }
    if (p.estado === "arquivado") {
      throw new ErroIva(
        "tax.profile_archived",
        "tax.profile_archived: o perfil está arquivado",
      );
    }
    const prova =
      p.nif_numero === null || p.pais_contribuinte === null
        ? undefined
        : await trx
            .selectFrom("validacao_vies")
            .select(["id", "resultado", "data_vies", "consultado_em"])
            .where("perfil_id", "=", perfilId)
            .where("pais_consultado", "=", p.pais_contribuinte)
            .where("numero_consultado", "=", p.nif_numero)
            .where("resultado", "in", ["valido", "invalido"])
            .orderBy("consultado_em", "desc")
            .limit(1)
            .executeTakeFirst();
    const isencao = await trx
      .selectFrom("isencao_manual")
      .select(["id", "codigo_motivo", "pais_contribuinte", "nif_numero"])
      .where("perfil_id", "=", perfilId)
      .where("retirada_em", "is", null)
      .executeTakeFirst();
    return {
      pais: p.pais_contribuinte,
      numero: p.nif_numero,
      // O estado e a data vêm da mesma prova (revisão do #256, P2-7); sem
      // prova definitiva, não há estado que isente.
      estado_vies: prova?.resultado ?? "sem_prova",
      validado_em:
        prova === undefined ? null : (prova.data_vies ?? prova.consultado_em),
      prova_vies: prova?.id ?? null,
      isencao:
        isencao === undefined
          ? null
          : {
              id: isencao.id,
              codigo_motivo: isencao.codigo_motivo,
              pais: isencao.pais_contribuinte,
              numero: isencao.nif_numero,
            },
    };
  });
}
