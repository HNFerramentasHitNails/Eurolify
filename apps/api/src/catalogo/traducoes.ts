import { sql, type Kysely } from "kysely";
import type { BaseDados, OrigemTraducao } from "../base/esquema.js";
import { reverificarPublicacoes } from "./publicacao.js";
import { estadoDaTraducao } from "./consultas.js";
import { ErroCatalogo, noCatalogo } from "./erros.js";

// Catálogo, parte 3b: traduções (docs/14 §3.8 e §4.3; migração 0009; issue
// #77). As regras vivem na base: quem traduz (`eurolify.quem`), o original
// guardado, a língua de origem e o endereço. Aqui só a escrita repetível
// (traduzir outra vez substitui) e o estado, que se calcula ao ler com a
// regra única de `consultas.ts` (revisão do #166, P2-2). A fila de uma
// língua só existe lá (`filaDeTraducoesPaginada`).

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
  // O tipo vai para o nome da tabela: só os da lista (2.ª revisão do #105,
  // P3-5); outro dá um erro do Catálogo, não um erro cru da base.
  if (!Object.hasOwn(COLUNA, dados.tipo)) {
    throw new ErroCatalogo(
      "catalog.invalid_field",
      `tipo de recurso desconhecido: ${dados.tipo}`,
    );
  }
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

/**
 * Marca uma proposta de IA como revista por `quem` (docs/14 §3.8). Não está
 * na API de chaves: só uma pessoa revê, no Hub (docs/06, CO). `textoVisto`
 * é o texto que a pessoa reviu: se entretanto alguém traduziu outra vez, a
 * revisão é recusada com `catalog.version_conflict`, como o `originalVisto`
 * ao traduzir (revisões do #166, P2-1 e 2.ª ronda, P3-C).
 */
export async function reverTraducao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  quem: string,
  recursoId: string,
  campo: string,
  lingua: string,
  textoVisto: string,
): Promise<void> {
  const id = recursoId.toLowerCase();
  await noCatalogo(db, comercianteId, async (trx) => {
    await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
    // A linha presa até ao fim: o texto não muda entre a comparação e a
    // revisão.
    const actual = await trx
      .selectFrom("traducao")
      .select("texto")
      .where("recurso_id", "=", id)
      .where("campo", "=", campo)
      .where("lingua", "=", lingua)
      .forUpdate()
      .executeTakeFirst();
    if (actual === undefined) {
      throw new ErroCatalogo(
        "catalog.not_found",
        `tradução ${recursoId} ${campo} ${lingua}`,
      );
    }
    if (actual.texto !== textoVisto) {
      throw new ErroCatalogo(
        "catalog.version_conflict",
        `tradução ${recursoId} ${campo} ${lingua}: o texto mudou desde que foi lido`,
      );
    }
    await trx
      .updateTable("traducao")
      .set({ revista: true })
      .where("recurso_id", "=", id)
      .where("campo", "=", campo)
      .where("lingua", "=", lingua)
      .execute();
  });
}

/** Tira a tradução de um campo numa língua (passa a «em falta»). */
export async function apagarTraducao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  quem: string,
  recursoId: string,
  campo: string,
  lingua: string,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    // Quem apagou fica no arquivo da publicação, se a reverificação a tirar
    // de venda (revisão do #166, P3-1).
    await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
    // Num artigo, a tradução do nome em falta tira-o de venda nos mercados
    // dessa língua: reverifica-se depois de apagar (docs/14 §8; docs/06, CJ).
    // Só o nome se verifica (revisão do #146, P3-1).
    const artigo =
      campo === "nome"
        ? await trx
            .selectFrom("artigo")
            .select("id")
            .where("id", "=", recursoId.toLowerCase())
            .executeTakeFirst()
        : undefined;
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
    if (artigo !== undefined) {
      await reverificarPublicacoes(trx, comercianteId, {
        artigo_id: artigo.id,
      });
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

/**
 * As traduções de um recurso, com o estado de cada uma (§4.3) e com quem
 * traduziu e reviu, que a API não mostra (docs/14 §7.1). Hoje só os testes
 * da base a usam, para conferir o rasto; a API lê por `traducoesParaApi`.
 * As duas calculam o estado com `estadoDaTraducao`; a fila (`consultas.ts`)
 * escreve a mesma regra em SQL (2.ª revisão do #166, P3-A).
 */
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
    estado: estadoDaTraducao(l.actual, l.original),
    origem: l.origem,
    traduzidoPor: l.traduzido_por,
    traduzidoEm: l.traduzido_em,
    revistoPor: l.revisto_por,
    revistoEm: l.revisto_em,
  }));
}
