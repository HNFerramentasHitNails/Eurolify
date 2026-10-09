import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados, TipoDeImagem } from "../base/esquema.js";
import { ErroCatalogo, noCatalogo } from "./erros.js";
import { reverificarPublicacoes } from "./publicacao.js";

// Catálogo: as imagens dos artigos (docs/14 §3.5; migração 0028; docs/06,
// CQ). Os bytes vivem no armazenamento (`armazenamento.ts`); aqui só as
// linhas: o ficheiro (pelo resumo) e a ligação ao artigo.

/**
 * A fila da media de um artigo: a principal e a posição seguinte olham para
 * várias linhas. Toma-se antes de prender qualquer linha da media.
 *
 * Antes dela, pela ordem do resto do Catálogo, a linha do artigo (FOR KEY
 * SHARE) e a fila do artigo (0005), onde quem publica também está: a
 * verificação «pode publicar?» lê a media (C2; docs/06, CR), e assim uma
 * publicação espera por uma imagem nova sem texto alternativo e vê-a, ou a
 * imagem espera pela publicação e reverifica-a. Um artigo que não existe é
 * `catalog.not_found`.
 */
async function filaDaMedia(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  artigoId: string,
) {
  const artigo = await trx
    .selectFrom("artigo")
    .select("id")
    .where("comerciante_id", "=", comercianteId)
    .where("id", "=", artigoId)
    .forKeyShare()
    .executeTakeFirst();
  if (artigo === undefined) {
    throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
  }
  await sql`select catalogo_fila_do_artigo(${comercianteId}::uuid, ${artigoId}::uuid)`.execute(
    trx,
  );
  await sql`select pg_advisory_xact_lock(hashtextextended('eurolify.media:' || ${artigoId}::uuid::text, 0))`.execute(
    trx,
  );
}

/**
 * O espaço que o comerciante ocupa com um ficheiro novo: o ficheiro já
 * registado (o mesmo resumo) não ocupa duas vezes.
 */
async function espacoNa(
  trx: Kysely<BaseDados>,
  comercianteId: string,
  resumo: string,
  bytes: number,
): Promise<number> {
  const { usado, ja } = await trx
    .selectFrom("ficheiro")
    .select([
      sql<string>`coalesce(sum(bytes), 0)`.as("usado"),
      sql<boolean | null>`bool_or(resumo = ${resumo})`.as("ja"),
    ])
    .where("comerciante_id", "=", comercianteId)
    .executeTakeFirstOrThrow();
  return Number(usado) + ((ja ?? false) ? 0 : bytes);
}

/**
 * Regista o ficheiro (o mesmo resumo outra vez não muda nada), dentro do
 * espaço do comerciante (`quota`): acima dele, `catalog.media_quota_exceeded`.
 * Os registos de um comerciante passam por uma fila só deles: dois envios ao
 * mesmo tempo não passam os dois por baixo do limite.
 */
export async function registarFicheiro(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: { resumo: string; tipo: TipoDeImagem; bytes: number },
  quota: number,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended('eurolify.ficheiro:' || ${comercianteId}::uuid::text, 0))`.execute(
      trx,
    );
    const depois = await espacoNa(
      trx,
      comercianteId,
      dados.resumo,
      dados.bytes,
    );
    if (depois > quota) {
      throw new ErroCatalogo(
        "catalog.media_quota_exceeded",
        `o espaço das imagens (${String(quota)} bytes) acabou`,
      );
    }
    await trx
      .insertInto("ficheiro")
      .values({ comerciante_id: comercianteId, ...dados })
      .onConflict((oc) => oc.columns(["comerciante_id", "resumo"]).doNothing())
      .execute();
    // Se já existia sem uso, os 7 dias da limpeza voltam a contar (docs/14
    // §3.5; migração 0035): com esta fila tomada, a limpeza não o apaga.
    await sql`select ficheiro_sem_uso_renovar(${dados.resumo})`.execute(trx);
  });
}

export interface DadosMedia {
  artigoId: string;
  varianteId: string | null;
  resumo: string;
  textoAlternativo: string | null;
  /** Por omissão, a seguir à última do artigo. */
  posicao?: number;
  principal: boolean;
}

/** Tira a marca de principal à que a tinha no artigo. */
async function tirarPrincipal(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  artigoId: string,
) {
  await trx
    .updateTable("media")
    .set({ principal: false })
    .where("comerciante_id", "=", comercianteId)
    .where("artigo_id", "=", artigoId)
    .where("principal", "=", true)
    .execute();
}

/**
 * Liga um ficheiro ao artigo (§3.5). Devolve o id. Um artigo, uma variante
 * de outro artigo ou um ficheiro que não existe dão `catalog.not_found`.
 */
export async function criarMedia(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosMedia,
): Promise<string> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const artigo = await trx
      .selectFrom("artigo")
      .select("id")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", dados.artigoId)
      .executeTakeFirst();
    if (artigo === undefined) {
      throw new ErroCatalogo("catalog.not_found", `artigo ${dados.artigoId}`);
    }
    // O ficheiro e a variante conferem-se aqui, com a mensagem certa; as
    // chaves estrangeiras ficam como rede (revisão do #176, P1-1).
    const ficheiro = await trx
      .selectFrom("ficheiro")
      .select("resumo")
      .where("comerciante_id", "=", comercianteId)
      .where("resumo", "=", dados.resumo)
      .executeTakeFirst();
    if (ficheiro === undefined) {
      throw new ErroCatalogo("catalog.not_found", `ficheiro ${dados.resumo}`);
    }
    if (dados.varianteId !== null) {
      const variante = await trx
        .selectFrom("variante")
        .select("id")
        .where("comerciante_id", "=", comercianteId)
        .where("artigo_id", "=", dados.artigoId)
        .where("id", "=", dados.varianteId)
        .executeTakeFirst();
      if (variante === undefined) {
        throw new ErroCatalogo(
          "catalog.not_found",
          `variante ${dados.varianteId} do artigo ${dados.artigoId}`,
        );
      }
    }
    await filaDaMedia(trx, comercianteId, dados.artigoId);
    let posicao = dados.posicao;
    if (posicao === undefined) {
      const { seguinte } = await trx
        .selectFrom("media")
        .select(sql<number>`coalesce(max(posicao) + 1, 0)::int`.as("seguinte"))
        .where("comerciante_id", "=", comercianteId)
        .where("artigo_id", "=", dados.artigoId)
        .executeTakeFirstOrThrow();
      posicao = seguinte;
    }
    if (dados.principal) {
      await tirarPrincipal(trx, comercianteId, dados.artigoId);
    }
    const { id } = await trx
      .insertInto("media")
      .values({
        comerciante_id: comercianteId,
        artigo_id: dados.artigoId,
        variante_id: dados.varianteId,
        ficheiro_resumo: dados.resumo,
        texto_alternativo: dados.textoAlternativo,
        posicao,
        principal: dados.principal,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    // Uma imagem sem texto alternativo parte as publicações do artigo onde
    // conta: saem de venda (docs/14 §8; docs/06, CJ e CR).
    if (dados.textoAlternativo === null) {
      await reverificarPublicacoes(trx, comercianteId, {
        artigo_id: dados.artigoId,
      });
    }
    return id;
  });
}

export interface AlteracaoMedia {
  texto_alternativo?: string | null;
  posicao?: number;
  principal?: boolean;
}

/**
 * Altera o texto alternativo, a posição ou a principal, na versão lida;
 * devolve a versão nova (a mesma, se nada mudou). Marcar como principal tira
 * a marca à que a tinha.
 */
export async function alterarMedia(
  db: Kysely<BaseDados>,
  comercianteId: string,
  mediaId: string,
  versao: number,
  alteracao: AlteracaoMedia,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const antes = await trx
      .selectFrom("media")
      .select("artigo_id")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", mediaId)
      .executeTakeFirst();
    if (antes === undefined) {
      throw new ErroCatalogo("catalog.not_found", `media ${mediaId}`);
    }
    // A fila antes da linha, como nas outras escritas da media.
    await filaDaMedia(trx, comercianteId, antes.artigo_id);
    const linha = await trx
      .selectFrom("media")
      .selectAll()
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", mediaId)
      .forUpdate()
      .executeTakeFirst();
    if (linha === undefined) {
      throw new ErroCatalogo("catalog.not_found", `media ${mediaId}`);
    }
    if (linha.versao !== versao) {
      throw new ErroCatalogo(
        "catalog.version_conflict",
        `media ${mediaId}: versão ${String(versao)} pedida, ${String(linha.versao)} actual`,
      );
    }
    const campos: AlteracaoMedia = {};
    if (
      alteracao.texto_alternativo !== undefined &&
      alteracao.texto_alternativo !== linha.texto_alternativo
    ) {
      campos.texto_alternativo = alteracao.texto_alternativo;
    }
    if (
      alteracao.posicao !== undefined &&
      alteracao.posicao !== linha.posicao
    ) {
      campos.posicao = alteracao.posicao;
    }
    if (
      alteracao.principal !== undefined &&
      alteracao.principal !== linha.principal
    ) {
      campos.principal = alteracao.principal;
    }
    if (Object.keys(campos).length === 0) return versao;
    if (campos.principal === true) {
      await tirarPrincipal(trx, comercianteId, linha.artigo_id);
    }
    const { versao: nova } = await trx
      .updateTable("media")
      .set(campos)
      .where("id", "=", mediaId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    // Tirar o texto alternativo parte as publicações onde a imagem conta
    // (docs/06, CJ e CR).
    if (campos.texto_alternativo === null) {
      await reverificarPublicacoes(trx, comercianteId, {
        artigo_id: linha.artigo_id,
      });
    }
    return nova;
  });
}

/** Tira a imagem do artigo; o ficheiro fica (a limpeza dos órfãos é depois). */
export async function apagarMedia(
  db: Kysely<BaseDados>,
  comercianteId: string,
  mediaId: string,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    const antes = await trx
      .selectFrom("media")
      .select("artigo_id")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", mediaId)
      .executeTakeFirst();
    if (antes === undefined) {
      throw new ErroCatalogo("catalog.not_found", `media ${mediaId}`);
    }
    await filaDaMedia(trx, comercianteId, antes.artigo_id);
    const { numDeletedRows } = await trx
      .deleteFrom("media")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", mediaId)
      .executeTakeFirst();
    if (numDeletedRows === 0n) {
      throw new ErroCatalogo("catalog.not_found", `media ${mediaId}`);
    }
  });
}

/** A media com o tipo e o tamanho do ficheiro. */
function comFicheiro(trx: Kysely<BaseDados>, comercianteId: string) {
  return trx
    .selectFrom("media as m")
    .innerJoin("ficheiro as f", (j) =>
      j
        .onRef("f.comerciante_id", "=", "m.comerciante_id")
        .onRef("f.resumo", "=", "m.ficheiro_resumo"),
    )
    .selectAll("m")
    .select(["f.tipo", "f.bytes"])
    .where("m.comerciante_id", "=", comercianteId);
}

/** Uma media, com o ficheiro; outra (ou de outro comerciante) não existe. */
export async function fichaDaMedia(
  db: Kysely<BaseDados>,
  comercianteId: string,
  mediaId: string,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const linha = await comFicheiro(trx, comercianteId)
        .where("m.id", "=", mediaId)
        .executeTakeFirst();
      if (linha === undefined) {
        throw new ErroCatalogo("catalog.not_found", `media ${mediaId}`);
      }
      return linha;
    },
    { soLeitura: true },
  );
}

/**
 * A media do artigo, pela ordem (posição e id), no formato das listas. Um
 * artigo que não existe é `catalog.not_found`.
 */
export async function mediaDoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  limite: number,
  depois: { posicao: number; id: string } | null,
) {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const artigo = await trx
        .selectFrom("artigo")
        .select("id")
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", artigoId)
        .executeTakeFirst();
      if (artigo === undefined) {
        throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
      }
      const { total } = await trx
        .selectFrom("media")
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .where("comerciante_id", "=", comercianteId)
        .where("artigo_id", "=", artigoId)
        .executeTakeFirstOrThrow();
      let pagina = comFicheiro(trx, comercianteId).where(
        "m.artigo_id",
        "=",
        artigoId,
      );
      if (depois !== null) {
        pagina = pagina.where(
          sql<boolean>`(m.posicao, m.id) > (${depois.posicao}::int, ${depois.id}::uuid)`,
        );
      }
      const linhas = await pagina
        .orderBy("m.posicao")
        .orderBy("m.id")
        .limit(limite + 1)
        .execute();
      const haMais = linhas.length > limite;
      const dados = haMais ? linhas.slice(0, limite) : linhas;
      const ultima = haMais ? dados.at(-1) : undefined;
      return {
        dados,
        total: Number(total),
        ultima:
          ultima === undefined
            ? null
            : { posicao: ultima.posicao, id: ultima.id },
      };
    },
    { soLeitura: true },
  );
}
