import { sql, type Kysely, type Transaction } from "kysely";
import type {
  BaseDados,
  EstadoArtigo,
  OrigemGtin,
  TipoArtigo,
  UnidadeDeConteudo,
  UnidadeDeVenda,
} from "../base/esquema.js";
import { ErroCatalogo, noCatalogo } from "./erros.js";
import type { Classificacao } from "./classificacao.js";
import { reverificarPublicacoes } from "./publicacao.js";

// Acesso interno ao domínio Catálogo, parte 1: artigos e variantes
// (docs/14-dominio-catalogo.md §3.1, §3.2, §4.1 e §5; issue #77). Ainda sem
// API: abre com a fatia de identidade, como o Comerciante. As regras vivem na
// base (CHECK e triggers da migração 0002); aqui só se traduzem os erros e se
// impõe a versão nas escritas (§3.1: a escrita com versão antiga é recusada).

export {
  ErroCatalogo,
  ESPERA_MAXIMA,
  noCatalogo,
  traduzir,
  type CodigoErroCatalogo,
  type OpcoesDeTraducao,
} from "./erros.js";

export interface DadosArtigo {
  tipo: TipoArtigo;
  nome: string;
  descricao?: string | null;
  marca?: string | null;
  categoria_fiscal?: string | null;
  /** Só quando a ficha nasce num sistema externo do comerciante (P5). */
  origem_ref?: string | null;
}

export interface DadosVariante {
  sku: string;
  unidade_de_venda: UnidadeDeVenda;
  gtin?: string | null;
  gtin_origem?: OrigemGtin | null;
  conteudo_quantidade?: number | null;
  conteudo_unidade?: UnidadeDeConteudo | null;
  peso_g?: number | null;
  comprimento_mm?: number | null;
  largura_mm?: number | null;
  altura_mm?: number | null;
  onu?: string | null;
  classe_adr?: string | null;
  posicao?: number;
}

/** Cria um artigo em rascunho, com as variantes dadas. Devolve o id. */
export async function criarArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosArtigo,
  variantes: readonly DadosVariante[] = [],
): Promise<string> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const { origem_ref, ...resto } = dados;
    const { id } = await trx
      .insertInto("artigo")
      .values({
        comerciante_id: comercianteId,
        ...resto,
        origem: origem_ref == null ? "eurolify" : "externo",
        origem_ref: origem_ref ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const variante of variantes) {
      await trx
        .insertInto("variante")
        .values({ comerciante_id: comercianteId, artigo_id: id, ...variante })
        .execute();
    }
    return id;
  });
}

export async function obterArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
) {
  const artigo = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("artigo")
      .selectAll()
      .where("id", "=", artigoId)
      .executeTakeFirst(),
  );
  if (artigo === undefined) {
    throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
  }
  return artigo;
}

/**
 * Lê o artigo na transacção e confirma a versão que quem chama leu: se outro
 * escreveu entretanto, `catalog.version_conflict` (§3.1). O `FOR UPDATE`
 * guarda a linha até ao fim da transacção.
 */
export async function artigoNaVersao(
  trx: Transaction<BaseDados>,
  artigoId: string,
  versao: number,
) {
  const artigo = await trx
    .selectFrom("artigo")
    .select(["id", "estado", "versao"])
    .where("id", "=", artigoId)
    .forUpdate()
    .executeTakeFirst();
  if (artigo === undefined) {
    throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
  }
  if (artigo.versao !== versao) {
    throw new ErroCatalogo(
      "catalog.version_conflict",
      `artigo ${artigoId}: versão ${String(versao)} pedida, ${String(artigo.versao)} actual`,
    );
  }
  return artigo;
}

/**
 * Os campos que se podem alterar. Uma chave com `undefined` quer dizer «não
 * mexer» (como num PATCH em JSON que a traga vazia) e é ignorada.
 */
export type AlteracaoArtigo = {
  [K in "nome" | "descricao" | "marca" | "categoria_fiscal"]?:
    DadosArtigo[K] | undefined;
};

/** Altera campos do artigo na versão lida; devolve a versão nova. */
export async function alterarArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  versao: number,
  alteracao: AlteracaoArtigo,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    await artigoNaVersao(trx, artigoId, versao);
    // Nada para mudar: a versão fica (revisão do #78, P2-6). Uma chave com
    // `undefined` também não muda nada (3.ª revisão, P2-A).
    const campos = Object.fromEntries(
      Object.entries(alteracao).filter(([, valor]) => valor !== undefined),
    );
    if (Object.keys(campos).length === 0) return versao;
    const { versao: nova } = await trx
      .updateTable("artigo")
      .set(campos)
      .where("id", "=", artigoId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    // Um nome novo desactualiza as traduções dele: as publicações que deixam
    // de passar saem de venda (docs/14 §8; docs/06, CJ). Só o nome conta: a
    // descrição e a marca não se verificam (revisão do #146, P3-1).
    if (campos["nome"] !== undefined) {
      await reverificarPublicacoes(trx, comercianteId, { artigo_id: artigoId });
    }
    return nova;
  });
}

function mesmaClassificacao(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const igual = (x: unknown, y: unknown) =>
    x instanceof Date && y instanceof Date
      ? x.getTime() === y.getTime()
      : JSON.stringify(x) === JSON.stringify(y);
  return Object.keys(b).every((chave) => igual(a[chave], b[chave]));
}

/**
 * Classifica o artigo (§3.10, «Classificação do artigo»; migração 0006) na
 * versão lida: substitui a classificação toda, com quem classificou (a data é
 * da base). A base recusa as combinações que o desenho não admite. Devolve a
 * versão nova. Os impedimentos para publicar dão-se em classificacao.ts.
 */
export async function classificarArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  versao: number,
  classificacao: Classificacao,
  quem: string,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    await artigoNaVersao(trx, artigoId, versao);
    const nova = {
      familias: [...new Set(classificacao.familias)].sort(),
      natureza_consumidor: classificacao.natureza_consumidor,
      modo: classificacao.modo ?? null,
      prestacao_inicio: classificacao.prestacao_inicio ?? null,
      prestacao_fim: classificacao.prestacao_fim ?? null,
      local_pais: classificacao.local_pais ?? null,
      local_territorio: classificacao.local_territorio ?? null,
      lazer_com_data: classificacao.lazer_com_data ?? false,
    };
    // A mesma classificação não sobe a versão (como em alterarArtigo; revisão
    // do #96, P3-2).
    const actual = await trx
      .selectFrom("artigo")
      .select([
        "familias",
        "natureza_consumidor",
        "modo",
        "prestacao_inicio",
        "prestacao_fim",
        "local_pais",
        "local_territorio",
        "lazer_com_data",
      ])
      .where("id", "=", artigoId)
      .executeTakeFirstOrThrow();
    if (mesmaClassificacao(actual, nova)) return versao;
    // Quem classificou: posto só nesta transacção (como no Comerciante); o
    // gatilho da 0006 escreve-o e recusa a mudança sem ele.
    await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
    const { versao: depois } = await trx
      .updateTable("artigo")
      .set(nova)
      .where("id", "=", artigoId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    // Uma classificação que deixa de servir tira o artigo de venda (docs/14
    // §8; docs/06, CJ).
    await reverificarPublicacoes(trx, comercianteId, { artigo_id: artigoId });
    return depois;
  });
}

/**
 * Muda o estado do artigo (§4.1): activar, arquivar ou repor. A base valida a
 * transição e a variante activa; aqui confirma-se a versão lida e, com `de`,
 * o estado de partida (a API: `activate` só parte de rascunho e `restore` só
 * de arquivado, embora os dois levem a activo; revisão do #153, P2-1).
 */
export async function mudarEstadoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  versao: number,
  para: EstadoArtigo,
  de?: EstadoArtigo,
): Promise<number> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const artigo = await artigoNaVersao(trx, artigoId, versao);
    // Já está nesse estado: nada muda e a versão fica (3.ª revisão, P3-1).
    if (artigo.estado === para) return versao;
    if (de !== undefined && artigo.estado !== de) {
      throw new ErroCatalogo(
        "catalog.invalid_transition",
        `artigo ${artigoId}: está em ${artigo.estado}, não em ${de}`,
      );
    }
    const { versao: nova } = await trx
      .updateTable("artigo")
      .set({ estado: para })
      .where("id", "=", artigoId)
      .returning("versao")
      .executeTakeFirstOrThrow();
    return nova;
  });
}

/** Apaga um artigo rascunho que nunca esteve activo (§4.1). */
export async function apagarRascunho(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
): Promise<void> {
  await noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const resultado = await trx
        .deleteFrom("artigo")
        .where("id", "=", artigoId)
        .executeTakeFirst();
      if (resultado.numDeletedRows === 0n) {
        throw new ErroCatalogo("catalog.not_found", `artigo ${artigoId}`);
      }
    },
    { apagar: true },
  );
}

/** Acrescenta uma variante; também a um artigo arquivado (§4.1, opção a). */
export async function criarVariante(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  dados: DadosVariante,
): Promise<string> {
  const { id } = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .insertInto("variante")
      .values({ comerciante_id: comercianteId, artigo_id: artigoId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

/**
 * Arquiva uma variante; o artigo e as outras variantes ficam (C6). Uma já
 * arquivada fica como está, sem erro: pedir o estado em que já está não muda
 * nada, como no artigo (§4.1; decisão do Diogo, 07/10/2026, revisão do #159,
 * P2-3). Arquivada continua final: não volta a activa.
 */
export async function arquivarVariante(
  db: Kysely<BaseDados>,
  comercianteId: string,
  varianteId: string,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    // A linha da variante primeiro, com o mesmo bloqueio que o UPDATE do
    // estado toma (não é chave): não choca com quem escreve um preço ou um
    // valor dela (revisão do #159, 2.ª, P3-N2).
    const actual = await trx
      .selectFrom("variante")
      .select(["artigo_id", "estado"])
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", varianteId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (actual === undefined) {
      throw new ErroCatalogo("catalog.not_found", `variante ${varianteId}`);
    }
    if (actual.estado === "arquivada") return;
    const variante = await trx
      .updateTable("variante")
      .set({ estado: "arquivada" })
      .where("id", "=", varianteId)
      .returning("artigo_id")
      .executeTakeFirstOrThrow();
    // A última variante à venda arquivada tira a publicação de venda (docs/14
    // §8; docs/06, CJ; C6 continua: as outras variantes não caem). Dois
    // arquivos de variantes do mesmo artigo ao mesmo tempo ficam em série na
    // linha da publicação (FOR UPDATE na reverificação): o segundo verifica
    // depois de o primeiro acabar e vê-o.
    await reverificarPublicacoes(trx, comercianteId, {
      artigo_id: variante.artigo_id,
    });
  });
}

/**
 * Procura uma variante pelo SKU, também arquivada (o SKU não volta, P7), sem
 * distinguir maiúsculas (P9, migração 0003).
 */
export async function varianteComSku(
  db: Kysely<BaseDados>,
  comercianteId: string,
  sku: string,
) {
  return noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("variante")
      .selectAll()
      // O comerciante explícito, além do RLS: o lower() não é «leakproof» e,
      // só com a política, o índice usava apenas o comerciante (revisão do
      // #80, P2-1).
      .where("comerciante_id", "=", comercianteId)
      .where(sql<string>`lower(sku)`, "=", sql<string>`lower(${sku})`)
      .executeTakeFirst(),
  );
}

export interface Componente {
  varianteId: string;
  quantidade: number;
}

/**
 * Substitui a composição do kit pela lista dada, pela ordem dada (§3.4; na
 * API, `PUT /variants/{id}/components`). Lista vazia: deixa de ser kit. A base
 * recusa ciclos, componentes novos arquivados e mexer num kit arquivado. Um
 * componente que já estava no kit fica (muda só a quantidade e a ordem), por
 * isso pode continuar mesmo arquivado (revisão do #81, P2-1).
 */
export async function definirComponentes(
  db: Kysely<BaseDados>,
  comercianteId: string,
  kitId: string,
  componentes: readonly Componente[],
): Promise<void> {
  const ids = componentes.map((c) => c.varianteId);
  if (new Set(ids).size !== ids.length) {
    throw new ErroCatalogo(
      "catalog.component_duplicate",
      "a mesma variante duas vezes na lista",
    );
  }
  await noCatalogo(db, comercianteId, async (trx) => {
    // Primeiro, o bloqueio do comerciante que o trigger também toma: as
    // substituições do mesmo comerciante ficam em fila num só ponto, antes de
    // prenderem linhas, e duas cruzadas (X em Y e Y em X) não se bloqueiam
    // uma à outra (revisão do #81, P2-2).
    // A chave na forma canónica do uuid, a mesma do trigger, seja qual for a
    // forma como o id chegou (revisão do #81, 2.ª, P3-2).
    await sql`select pg_advisory_xact_lock(hashtextextended('eurolify.componente:' || ${comercianteId}::uuid::text, 0))`.execute(
      trx,
    );
    // A linha do kit fica presa até ao fim.
    const kit = await trx
      .selectFrom("variante")
      .select("id")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", kitId)
      .forUpdate()
      .executeTakeFirst();
    if (kit === undefined) {
      throw new ErroCatalogo("catalog.not_found", `variante ${kitId}`);
    }
    // Os componentes têm de existir neste comerciante (o RLS esconde os de
    // outro, que contam como inexistentes). Não se prendem aqui: o trigger
    // prende cada componente novo (FOR SHARE) ao inseri-lo; se um for apagado
    // entre esta leitura e o INSERT, a chave estrangeira recusa e o erro é
    // «não existe» (revisão do #81, 2.ª, P2-3).
    if (ids.length > 0) {
      const existem = await trx
        .selectFrom("variante")
        .select("id")
        .where("comerciante_id", "=", comercianteId)
        .where("id", "in", ids)
        .execute();
      if (existem.length !== ids.length) {
        throw new ErroCatalogo("catalog.not_found", "componente inexistente");
      }
    }
    const actuais = new Set(
      (
        await trx
          .selectFrom("componente")
          .select("componente_id")
          .where("comerciante_id", "=", comercianteId)
          .where("kit_id", "=", kitId)
          .execute()
      ).map((l) => l.componente_id),
    );
    const sair = [...actuais].filter((id) => !ids.includes(id));
    if (sair.length > 0) {
      await trx
        .deleteFrom("componente")
        .where("comerciante_id", "=", comercianteId)
        .where("kit_id", "=", kitId)
        .where("componente_id", "in", sair)
        .execute();
    }
    let posicao = 0;
    for (const componente of componentes) {
      if (actuais.has(componente.varianteId)) {
        await trx
          .updateTable("componente")
          .set({ quantidade: componente.quantidade, posicao })
          .where("comerciante_id", "=", comercianteId)
          .where("kit_id", "=", kitId)
          .where("componente_id", "=", componente.varianteId)
          .execute();
      } else {
        await trx
          .insertInto("componente")
          .values({
            comerciante_id: comercianteId,
            kit_id: kitId,
            componente_id: componente.varianteId,
            quantidade: componente.quantidade,
            posicao,
          })
          .execute();
      }
      posicao += 1;
    }
  });
}

/** A composição do kit, pela ordem; vazia se a variante não é kit. */
export async function componentesDoKit(
  db: Kysely<BaseDados>,
  comercianteId: string,
  kitId: string,
): Promise<Componente[]> {
  const linhas = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("componente")
      .select(["componente_id", "quantidade"])
      .where("comerciante_id", "=", comercianteId)
      .where("kit_id", "=", kitId)
      .orderBy("posicao")
      .execute(),
  );
  return linhas.map((l) => ({
    varianteId: l.componente_id,
    quantidade: l.quantidade,
  }));
}

export interface Opcao {
  id: string;
  nome: string;
  valores: { id: string; valor: string }[];
}

/**
 * Cria uma opção do artigo com os valores dados, pela ordem (§3.3). Só num
 * rascunho (0005). Devolve a opção com os ids dos valores.
 */
export async function criarOpcao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  nome: string,
  valores: readonly string[],
): Promise<Opcao> {
  // Uma opção sem valores não deixava nenhuma variante completar-se (revisão
  // do #83, P3).
  if (valores.length === 0) {
    throw new ErroCatalogo(
      "catalog.option_values_required",
      "uma opção leva pelo menos um valor",
    );
  }
  return noCatalogo(db, comercianteId, async (trx) => {
    // A linha do artigo antes da fila dele, pela mesma ordem de quem apaga o
    // rascunho: a chave estrangeira da opção pede a linha do artigo, e o
    // trigger toma a fila antes dela — sem isto, criar uma opção e apagar o
    // rascunho podiam esperar um pelo outro (revisão do #83, 3.ª, P2-1).
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
    // A seguir à maior (não à contagem): uma opção apagada num rascunho não
    // faz repetir a posição de outra (revisão do #290, P2-2).
    const { n } = await trx
      .selectFrom("opcao")
      .select(sql<string>`coalesce(max(posicao) + 1, 0)`.as("n"))
      .where("comerciante_id", "=", comercianteId)
      .where("artigo_id", "=", artigoId)
      .executeTakeFirstOrThrow();
    const opcao = await trx
      .insertInto("opcao")
      .values({
        comerciante_id: comercianteId,
        artigo_id: artigoId,
        nome,
        posicao: Number(n),
      })
      .returning(["id", "nome"])
      .executeTakeFirstOrThrow();
    const criados: { id: string; valor: string }[] = [];
    let posicao = 0;
    for (const valor of valores) {
      criados.push(
        await trx
          .insertInto("valor_opcao")
          .values({
            comerciante_id: comercianteId,
            artigo_id: artigoId,
            opcao_id: opcao.id,
            valor,
            posicao,
          })
          .returning(["id", "valor"])
          .executeTakeFirstOrThrow(),
      );
      posicao += 1;
    }
    return { ...opcao, valores: criados };
  });
}

/**
 * Acrescenta um valor a uma opção, no fim, em qualquer estado do artigo. A
 * linha do artigo (FOR KEY SHARE) e a fila dele antes de contar, pela ordem
 * de `criarOpcao` e de quem apaga o rascunho: dois valores acrescentados ao
 * mesmo tempo ficam em série, cada um com a sua posição (revisão do #161,
 * P2-1). A opção relê-se já com a fila tomada: se foi apagada entretanto, é
 * «não existe».
 */
export async function acrescentarValor(
  db: Kysely<BaseDados>,
  comercianteId: string,
  opcaoId: string,
  valor: string,
  /** A `versao` da opção que se leu (opcional, docs/14 §7.1). */
  versao?: number,
): Promise<string> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const lerOpcao = () =>
      trx
        .selectFrom("opcao")
        .select(["artigo_id", "versao"])
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", opcaoId)
        .executeTakeFirst();
    const vista = await lerOpcao();
    if (vista === undefined) {
      throw new ErroCatalogo("catalog.not_found", `opção ${opcaoId}`);
    }
    const artigo = await trx
      .selectFrom("artigo")
      .select("id")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", vista.artigo_id)
      .forKeyShare()
      .executeTakeFirst();
    if (artigo === undefined) {
      throw new ErroCatalogo("catalog.not_found", `opção ${opcaoId}`);
    }
    await sql`select catalogo_fila_do_artigo(${comercianteId}::uuid, ${vista.artigo_id}::uuid)`.execute(
      trx,
    );
    const opcao = await lerOpcao();
    if (opcao === undefined) {
      throw new ErroCatalogo("catalog.not_found", `opção ${opcaoId}`);
    }
    if (versao !== undefined && opcao.versao !== versao) {
      throw new ErroCatalogo(
        "catalog.version_conflict",
        `opção ${opcaoId}: versão ${String(versao)} pedida, ${String(opcao.versao)} actual`,
      );
    }
    // A seguir à maior (não à contagem): um valor apagado num rascunho não
    // faz repetir a posição de outro.
    const { n } = await trx
      .selectFrom("valor_opcao")
      .select(sql<string>`coalesce(max(posicao) + 1, 0)`.as("n"))
      .where("comerciante_id", "=", comercianteId)
      .where("opcao_id", "=", opcaoId)
      .executeTakeFirstOrThrow();
    const { id } = await trx
      .insertInto("valor_opcao")
      .values({
        comerciante_id: comercianteId,
        artigo_id: opcao.artigo_id,
        opcao_id: opcaoId,
        valor,
        posicao: Number(n),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
}

/** As opções do artigo com os valores, pela ordem. */
export async function opcoesDoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
): Promise<Opcao[]> {
  return noCatalogo(db, comercianteId, async (trx) => {
    const opcoes = await trx
      .selectFrom("opcao")
      .select(["id", "nome"])
      .where("comerciante_id", "=", comercianteId)
      .where("artigo_id", "=", artigoId)
      .orderBy("posicao")
      .orderBy("criado_em")
      .execute();
    const valores = await trx
      .selectFrom("valor_opcao")
      .select(["id", "opcao_id", "valor"])
      .where("comerciante_id", "=", comercianteId)
      .where("artigo_id", "=", artigoId)
      .orderBy("posicao")
      .orderBy("criado_em")
      .execute();
    return opcoes.map((o) => ({
      ...o,
      valores: valores
        .filter((v) => v.opcao_id === o.id)
        .map(({ id, valor }) => ({ id, valor })),
    }));
  });
}

/**
 * Dá à variante os valores (um por opção), substituindo os que tinha. Num
 * artigo que já não é rascunho só se dão a uma variante sem valores (a que se
 * acabou de criar); a base verifica no fim a combinação (completa e sem
 * repetidos).
 */
export async function definirValoresDaVariante(
  db: Kysely<BaseDados>,
  comercianteId: string,
  varianteId: string,
  valorIds: readonly string[],
): Promise<void> {
  await noCatalogo(db, comercianteId, (trx) =>
    gravarValores(trx, comercianteId, varianteId, valorIds),
  );
}

/** Exportada para a escrita das opções (opcoes-escrita.ts). */
export async function gravarValores(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  varianteId: string,
  valorIds: readonly string[],
): Promise<void> {
  const variante = await trx
    .selectFrom("variante")
    .select(["artigo_id"])
    .where("comerciante_id", "=", comercianteId)
    .where("id", "=", varianteId)
    .executeTakeFirst();
  if (variante === undefined) {
    throw new ErroCatalogo("catalog.not_found", `variante ${varianteId}`);
  }
  // A fila do artigo antes de prender qualquer linha: os triggers só a tomam
  // depois de prender a linha que mudam, e quem apaga o rascunho toma-a antes
  // de prender as variantes — sem isto, os dois podiam esperar um pelo outro
  // (revisão do #83, 2.ª, P2-1).
  await sql`select catalogo_fila_do_artigo(${comercianteId}::uuid, ${variante.artigo_id}::uuid)`.execute(
    trx,
  );
  const unicos = [...new Set(valorIds)];
  const valores =
    unicos.length === 0
      ? []
      : await trx
          .selectFrom("valor_opcao")
          .select(["id", "opcao_id"])
          .where("comerciante_id", "=", comercianteId)
          .where("artigo_id", "=", variante.artigo_id)
          .where("id", "in", unicos)
          .execute();
  if (valores.length !== unicos.length) {
    throw new ErroCatalogo("catalog.not_found", "valor de opção inexistente");
  }
  const actuais = await trx
    .selectFrom("variante_valor")
    .select("opcao_id")
    .where("comerciante_id", "=", comercianteId)
    .where("variante_id", "=", varianteId)
    .execute();
  if (actuais.length > 0) {
    await trx
      .deleteFrom("variante_valor")
      .where("comerciante_id", "=", comercianteId)
      .where("variante_id", "=", varianteId)
      .execute();
  }
  for (const v of valores) {
    await trx
      .insertInto("variante_valor")
      .values({
        comerciante_id: comercianteId,
        artigo_id: variante.artigo_id,
        variante_id: varianteId,
        opcao_id: v.opcao_id,
        valor_id: v.id,
      })
      .execute();
  }
}

/**
 * Cria uma variante já com os valores das opções, na mesma transacção (num
 * artigo que não é rascunho, a combinação tem de ficar completa).
 */
export async function criarVarianteComValores(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  dados: DadosVariante,
  valorIds: readonly string[],
): Promise<string> {
  return noCatalogo(db, comercianteId, async (trx) => {
    // A linha do artigo e a fila dele antes de inserir, pela ordem de quem
    // apaga o rascunho (0005): o INSERT prende o artigo pela chave
    // estrangeira, e sem isto os dois podiam esperar um pelo outro (revisão
    // do #159, P3-1). Um artigo que não existe (ou de outro comerciante) é
    // «não existe».
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
    const { id } = await trx
      .insertInto("variante")
      .values({ comerciante_id: comercianteId, artigo_id: artigoId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow();
    await gravarValores(trx, comercianteId, id, valorIds);
    return id;
  });
}

/** Os ids dos valores da variante. */
export async function valoresDaVariante(
  db: Kysely<BaseDados>,
  comercianteId: string,
  varianteId: string,
): Promise<string[]> {
  const linhas = await noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("variante_valor")
      .select("valor_id")
      .where("comerciante_id", "=", comercianteId)
      .where("variante_id", "=", varianteId)
      .execute(),
  );
  return linhas.map((l) => l.valor_id).sort();
}
