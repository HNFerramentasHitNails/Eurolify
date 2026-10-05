import { sql, type Kysely } from "kysely";
import type { BaseDados, OrigemTraducao } from "../base/esquema.js";
import { ErroCatalogo, noCatalogo } from "./repositorio.js";

// Catálogo, parte 3b: traduções (docs/14 §3.8 e §4.3; migração 0009; issue
// #77). As regras vivem na base: quem traduz (`eurolify.quem`), o original
// guardado, a língua de origem e o endereço. Aqui só a escrita repetível
// (traduzir outra vez substitui) e o estado, que se calcula ao ler.

export type TipoRecurso =
  "artigo" | "opcao" | "valor_opcao" | "categoria" | "colecao";

const COLUNA = {
  artigo: "artigo_id",
  opcao: "opcao_id",
  valor_opcao: "valor_opcao_id",
  categoria: "categoria_id",
  colecao: "colecao_id",
} as const satisfies Record<TipoRecurso, string>;

export type EstadoTraducao = "completa" | "desactualizada" | "em_falta";

export interface DadosTraducao {
  tipo: TipoRecurso;
  recursoId: string;
  campo: string;
  lingua: string;
  texto: string;
  origem: OrigemTraducao;
  /**
   * O texto do original que quem traduziu viu. Se entretanto mudou, a
   * tradução é recusada com `catalog.version_conflict` (revisão do #105,
   * P2-3), como uma escrita do artigo com a versão antiga.
   */
  originalVisto: string;
}

/**
 * Traduz um campo para uma língua, ou traduz outra vez (substitui o texto, a
 * origem e quem, e apaga a revisão). Traduzir outra vez com o mesmo texto
 * confirma a tradução contra o original de agora. `quem` é a pessoa ou o
 * sistema que traduziu (docs/14 §3.8).
 */
export async function definirTraducao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  quem: string,
  dados: DadosTraducao,
): Promise<void> {
  const recursoId = dados.recursoId.toLowerCase();
  await noCatalogo(db, comercianteId, async (trx) => {
    await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
    // A linha do recurso presa (FOR SHARE) até ao fim: o original não muda
    // entre esta comparação e o que a base guarda com a tradução.
    await sql`select from ${sql.table(dados.tipo)} where id = ${recursoId} for share`.execute(
      trx,
    );
    const original = await trx
      .selectFrom("texto_original")
      .select("texto")
      .where("comerciante_id", "=", comercianteId)
      .where("recurso_id", "=", recursoId)
      .where("campo", "=", dados.campo)
      .executeTakeFirst();
    if (
      original?.texto !== undefined &&
      original.texto !== null &&
      original.texto !== dados.originalVisto
    ) {
      throw new ErroCatalogo(
        "catalog.version_conflict",
        `${dados.tipo} ${recursoId}: o ${dados.campo} original mudou desde que foi lido`,
      );
    }
    await trx
      .insertInto("traducao")
      .values({
        comerciante_id: comercianteId,
        [COLUNA[dados.tipo]]: recursoId,
        campo: dados.campo,
        lingua: dados.lingua,
        texto: dados.texto,
        origem: dados.origem,
      })
      .onConflict((oc) =>
        oc.constraint("traducao_unica").doUpdateSet((eb) => ({
          texto: eb.ref("excluded.texto"),
          origem: eb.ref("excluded.origem"),
          // Traduzir outra vez apaga a revisão (a base trata-o assim).
          revista: false,
        })),
      )
      .execute();
  });
}

/** Marca uma proposta de IA como revista por `quem` (docs/14 §3.8). */
export async function reverTraducao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  quem: string,
  recursoId: string,
  campo: string,
  lingua: string,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
    const resultado = await trx
      .updateTable("traducao")
      .set({ revista: true })
      .where("recurso_id", "=", recursoId.toLowerCase())
      .where("campo", "=", campo)
      .where("lingua", "=", lingua)
      .executeTakeFirst();
    if (resultado.numUpdatedRows === 0n) {
      throw new ErroCatalogo(
        "catalog.not_found",
        `tradução ${recursoId} ${campo} ${lingua}`,
      );
    }
  });
}

/** Tira a tradução de um campo numa língua (passa a «em falta»). */
export async function apagarTraducao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  recursoId: string,
  campo: string,
  lingua: string,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    const resultado = await trx
      .deleteFrom("traducao")
      .where("recurso_id", "=", recursoId.toLowerCase())
      .where("campo", "=", campo)
      .where("lingua", "=", lingua)
      .executeTakeFirst();
    if (resultado.numDeletedRows === 0n) {
      throw new ErroCatalogo(
        "catalog.not_found",
        `tradução ${recursoId} ${campo} ${lingua}`,
      );
    }
  });
}

export interface Traducao {
  campo: string;
  lingua: string;
  texto: string;
  estado: Exclude<EstadoTraducao, "em_falta">;
  origem: OrigemTraducao;
  traduzidoPor: string;
  traduzidoEm: Date;
  revistoPor: string | null;
  revistoEm: Date | null;
}

/** As traduções de um recurso, com o estado de cada uma (§4.3). */
export async function traducoesDoRecurso(
  db: Kysely<BaseDados>,
  comercianteId: string,
  recursoId: string,
): Promise<Traducao[]> {
  const linhas = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("traducao as t")
      .leftJoin("texto_original as o", (j) =>
        j
          .onRef("o.comerciante_id", "=", "t.comerciante_id")
          .onRef("o.recurso_id", "=", "t.recurso_id")
          .onRef("o.campo", "=", "t.campo"),
      )
      .select([
        "t.campo",
        "t.lingua",
        "t.texto",
        "t.original",
        "o.texto as actual",
        "t.origem",
        "t.traduzido_por",
        "t.traduzido_em",
        "t.revisto_por",
        "t.revisto_em",
      ])
      .where("t.recurso_id", "=", recursoId.toLowerCase())
      .orderBy("t.campo")
      .orderBy("t.lingua")
      .execute(),
  );
  return linhas.map((l) => ({
    campo: l.campo,
    lingua: l.lingua,
    texto: l.texto,
    estado: l.actual === l.original ? "completa" : "desactualizada",
    origem: l.origem,
    traduzidoPor: l.traduzido_por,
    traduzidoEm: l.traduzido_em,
    revistoPor: l.revisto_por,
    revistoEm: l.revisto_em,
  }));
}

export interface PorTraduzir {
  tipo: TipoRecurso;
  recursoId: string;
  campo: string;
  estado: Exclude<EstadoTraducao, "completa">;
}

/**
 * A fila de traduções de uma língua (§7.1, `GET /translations?state=…`): os
 * campos com original e sem tradução nessa língua (em falta) e os que têm
 * tradução de um original que entretanto mudou ou ficou vazio
 * (desactualizada; revisão do #105, P3-C). Para a língua de origem não há
 * fila.
 */
export async function filaDeTraducoes(
  db: Kysely<BaseDados>,
  comercianteId: string,
  lingua: string,
): Promise<PorTraduzir[]> {
  const linhas = await noCatalogo(db, comercianteId, async (trx) => {
    const comerciante = await trx
      .selectFrom("comerciante")
      .select("lingua_origem")
      .where("id", "=", comercianteId)
      .executeTakeFirst();
    if (comerciante?.lingua_origem === lingua) {
      throw new ErroCatalogo(
        "catalog.translation_same_language",
        `${lingua} é a língua de origem`,
      );
    }
    return trx
      .selectFrom("texto_original as o")
      .leftJoin("traducao as t", (j) =>
        j
          .onRef("t.comerciante_id", "=", "o.comerciante_id")
          .onRef("t.recurso_id", "=", "o.recurso_id")
          .onRef("t.campo", "=", "o.campo")
          .on("t.lingua", "=", lingua),
      )
      .select(["o.tipo", "o.recurso_id", "o.campo", "t.original"])
      .where("o.comerciante_id", "=", comercianteId)
      .where((eb) =>
        eb.or([
          // Com original e sem tradução, ou com tradução de outro original.
          eb.and([
            sql<boolean>`coalesce(btrim(o.texto), '') <> ''`,
            eb.or([
              eb("t.id", "is", null),
              eb("t.original", "is distinct from", eb.ref("o.texto")),
            ]),
          ]),
          // Com tradução de um original que ficou vazio.
          eb.and([
            eb("t.id", "is not", null),
            sql<boolean>`coalesce(btrim(o.texto), '') = ''`,
          ]),
        ]),
      )
      .orderBy("o.tipo")
      .orderBy("o.recurso_id")
      .orderBy("o.campo")
      .execute();
  });
  return linhas.map((l) => ({
    tipo: l.tipo as TipoRecurso,
    recursoId: l.recurso_id,
    campo: l.campo,
    estado: l.original === null ? "em_falta" : "desactualizada",
  }));
}
