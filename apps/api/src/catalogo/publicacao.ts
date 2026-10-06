import { sql, type Kysely, type Transaction } from "kysely";
import type {
  BaseDados,
  EstadoPublicacao,
  MotivoArquivoPublicacao,
} from "../base/esquema.js";
import { verificarPrecosNa } from "../precos/repositorio.js";
import { impedimentosDaClassificacao } from "./classificacao.js";
import { ErroCatalogo, noCatalogo } from "./repositorio.js";

// Catálogo, parte 4: publicação por canal × mercado e a verificação «pode
// publicar?» (docs/14 §3.9, §4.2 e §5, regra C2; migração 0018; issue #77).
// A verificação é do servidor: devolve sim, ou a lista de impedimentos com
// código. A base repete o que não pode falhar nunca (artigo, mercado e canal
// activos, preço e peso das variantes vendidas) e só aceita «publicado» com
// a última verificação sem impedimentos.
//
// Decisão do Diogo, 06/10/2026 (opção a): os atributos regulamentares
// (Conformidade, sem desenho) e o texto alternativo da media (parte 5) ainda
// não se verificam. A resposta diz sempre, em `nao_verificado`, o que ficou
// de fora, para ninguém ler «sem impedimentos» como «conforme». A rede tem
// fim escrito no docs/14 §5 (C2).

/** O que a verificação ainda não sabe ver (decisão do Diogo, opção a). */
export const NAO_VERIFICADO = ["conformidade", "media"] as const;

export type ImpedimentoPublicacao =
  | { codigo: "artigo_nao_activo" }
  | { codigo: "mercado_inactivo" }
  | { codigo: "canal_inactivo" }
  | { codigo: "canal_nao_vende_no_mercado" }
  | { codigo: "sem_variantes_a_venda" }
  | { codigo: "categoria_fiscal_em_falta" }
  | { codigo: "peso_em_falta"; variantes: string[] }
  | { codigo: "preco_em_falta"; variantes: string[] }
  | { codigo: "traducao_em_falta"; campo: "nome"; linguas: string[] }
  | { codigo: "traducao_desactualizada"; campo: "nome"; linguas: string[] }
  | { codigo: "classificacao_em_falta" }
  | { codigo: "natureza_incompativel" }
  | { codigo: "data_ou_local_em_falta"; falta: ("data" | "local" | "modo")[] }
  | { codigo: "familia_restrita"; familias: string[] };

export interface Verificacao {
  /** Vazia: pode publicar-se, no que a verificação sabe ver. */
  impedimentos: ImpedimentoPublicacao[];
  nao_verificado: (typeof NAO_VERIFICADO)[number][];
}

export interface PedidoDePublicacao {
  artigo_id: string;
  canal_id: string;
  mercado_id: string;
  /** Variantes do artigo que não se vendem neste par (C6). */
  variantes_fora?: readonly string[];
}

/**
 * A verificação «pode publicar?» (C2) dentro de uma transacção já aberta no
 * contexto do comerciante. Não escreve. Um artigo, canal ou mercado que não
 * existe (ou é de outro comerciante) é `catalog.not_found`.
 */
export async function verificarNa(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  pedido: PedidoDePublicacao,
): Promise<Verificacao> {
  const impedimentos: ImpedimentoPublicacao[] = [];
  const fora = (pedido.variantes_fora ?? []).map((v) => v.toLowerCase());

  const artigo = await trx
    .selectFrom("artigo")
    .select([
      "id",
      "tipo",
      "estado",
      "nome",
      "categoria_fiscal",
      "familias",
      "natureza_consumidor",
      "modo",
      "prestacao_inicio",
      "prestacao_fim",
      "local_pais",
    ])
    .where("id", "=", pedido.artigo_id)
    .executeTakeFirst();
  if (artigo === undefined) {
    throw new ErroCatalogo("catalog.not_found", `artigo ${pedido.artigo_id}`);
  }
  const canal = await trx
    .selectFrom("canal")
    .select(["estado", "loja_id"])
    .where("id", "=", pedido.canal_id)
    .executeTakeFirst();
  if (canal === undefined) {
    throw new ErroCatalogo("catalog.not_found", `canal ${pedido.canal_id}`);
  }
  const mercado = await trx
    .selectFrom("mercado")
    .select(["estado", "loja_id", "linguas"])
    .where("id", "=", pedido.mercado_id)
    .executeTakeFirst();
  if (mercado === undefined) {
    throw new ErroCatalogo("catalog.not_found", `mercado ${pedido.mercado_id}`);
  }

  if (artigo.estado !== "activo") {
    impedimentos.push({ codigo: "artigo_nao_activo" });
  }
  if (mercado.estado !== "activo") {
    impedimentos.push({ codigo: "mercado_inactivo" });
  }
  if (canal.estado !== "activo") {
    impedimentos.push({ codigo: "canal_inactivo" });
  }
  const par = await trx
    .selectFrom("canal_mercado")
    .select("mercado_id")
    .where("canal_id", "=", pedido.canal_id)
    .where("mercado_id", "=", pedido.mercado_id)
    .executeTakeFirst();
  if (par === undefined || canal.loja_id !== mercado.loja_id) {
    impedimentos.push({ codigo: "canal_nao_vende_no_mercado" });
  }
  if (artigo.categoria_fiscal === null) {
    impedimentos.push({ codigo: "categoria_fiscal_em_falta" });
  }
  impedimentos.push(...impedimentosDaClassificacao(artigo));

  // As variantes vendidas: activas e fora de `variantes_fora`.
  const variantes = await trx
    .selectFrom("variante")
    .select(["id", "sku", "peso_g"])
    .where("artigo_id", "=", artigo.id)
    .where("estado", "=", "activa")
    .orderBy("sku")
    .execute();
  const vendidas = variantes.filter((v) => !fora.includes(v.id));
  if (vendidas.length === 0) {
    impedimentos.push({ codigo: "sem_variantes_a_venda" });
  }
  if (artigo.tipo === "fisico") {
    const semPeso = vendidas.filter((v) => v.peso_g === null);
    if (semPeso.length > 0) {
      impedimentos.push({
        codigo: "peso_em_falta",
        variantes: semPeso.map((v) => v.sku),
      });
    }
  }

  // Preços (pergunta a Preços, docs/20 R4). Num mercado inactivo já há o
  // impedimento do mercado; o preço só se pergunta num activo.
  if (mercado.estado === "activo" && vendidas.length > 0) {
    const precos = await verificarPrecosNa(
      trx,
      pedido.mercado_id,
      vendidas.map((v) => v.id),
    );
    const semPreco = vendidas
      .filter(
        (v) => precos.find((p) => p.variante_id === v.id)?.com_preco !== true,
      )
      .map((v) => v.sku);
    if (semPreco.length > 0) {
      impedimentos.push({ codigo: "preco_em_falta", variantes: semPreco });
    }
  }

  // O nome traduzido em cada língua do mercado que não seja a de origem
  // (docs/14 §3.8 e C2). Uma tradução de um original que mudou conta como
  // desactualizada (§4.3).
  const comerciante = await trx
    .selectFrom("comerciante")
    .select("lingua_origem")
    .where("id", "=", comercianteId)
    .executeTakeFirst();
  const linguas = mercado.linguas.filter(
    (l) => l !== comerciante?.lingua_origem,
  );
  if (linguas.length > 0) {
    const traducoes = await trx
      .selectFrom("traducao")
      .select(["lingua", "original"])
      .where("recurso_id", "=", artigo.id)
      .where("campo", "=", "nome")
      .where("lingua", "in", linguas)
      .execute();
    const emFalta = linguas.filter(
      (l) => !traducoes.some((t) => t.lingua === l),
    );
    const desactualizadas = traducoes
      .filter((t) => t.original !== artigo.nome)
      .map((t) => t.lingua)
      .sort();
    if (emFalta.length > 0) {
      impedimentos.push({
        codigo: "traducao_em_falta",
        campo: "nome",
        linguas: emFalta,
      });
    }
    if (desactualizadas.length > 0) {
      impedimentos.push({
        codigo: "traducao_desactualizada",
        campo: "nome",
        linguas: desactualizadas,
      });
    }
  }

  return { impedimentos, nao_verificado: [...NAO_VERIFICADO] };
}

/** A verificação «pode publicar?» (§7.1, `POST …/publications/check`). */
export async function verificarPublicacao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  pedido: PedidoDePublicacao,
): Promise<Verificacao> {
  return noCatalogo(db, comercianteId, (trx) =>
    verificarNa(trx, comercianteId, pedido),
  );
}

export interface Publicacao {
  id: string;
  artigo_id: string;
  canal_id: string;
  mercado_id: string;
  estado: EstadoPublicacao;
  variantes_fora: string[];
  ultima_verificacao: unknown;
  verificado_em: Date | null;
  publicado_por: string | null;
  publicado_em: Date | null;
  arquivado_por: string | null;
  arquivado_em: Date | null;
  motivo_arquivo: MotivoArquivoPublicacao | null;
  versao: number;
}

export interface ResultadoDaPublicacao {
  publicada: boolean;
  verificacao: Verificacao;
  /**
   * Nula quando o canal não vende no mercado: não há par onde a publicação
   * possa existir (a chave da 0018), e a verificação diz porquê.
   */
  publicacao: Publicacao | null;
}

const COLUNAS = [
  "id",
  "artigo_id",
  "canal_id",
  "mercado_id",
  "estado",
  "variantes_fora",
  "ultima_verificacao",
  "verificado_em",
  "publicado_por",
  "publicado_em",
  "arquivado_por",
  "arquivado_em",
  "motivo_arquivo",
  "versao",
] as const;

async function comQuem(trx: Transaction<BaseDados>, quem: string) {
  if (quem.trim() === "") {
    throw new ErroCatalogo(
      "catalog.published_by_required",
      "quem publica é obrigatório",
    );
  }
  await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
}

/**
 * Publica um artigo num canal × mercado (§4.2): cria a publicação, se não
 * houver, corre a verificação e, sem impedimentos, passa-a a publicada. Com
 * impedimentos, a publicação fica como estava (rascunho ou arquivada) e a
 * verificação fica guardada nela; a resposta diz `publicada: false`.
 */
export async function publicar(
  db: Kysely<BaseDados>,
  comercianteId: string,
  quem: string,
  pedido: PedidoDePublicacao,
): Promise<ResultadoDaPublicacao> {
  return noCatalogo(db, comercianteId, async (trx) => {
    await comQuem(trx, quem);
    const verificacao = await verificarNa(trx, comercianteId, pedido);
    if (
      verificacao.impedimentos.some(
        (i) => i.codigo === "canal_nao_vende_no_mercado",
      )
    ) {
      return { publicada: false, verificacao, publicacao: null };
    }
    const canal = await trx
      .selectFrom("canal")
      .select("loja_id")
      .where("id", "=", pedido.canal_id)
      .executeTakeFirstOrThrow();
    const fora = [...new Set(pedido.variantes_fora ?? [])].map((v) =>
      v.toLowerCase(),
    );
    // A linha da publicação: a que existe, ou uma nova em rascunho.
    await trx
      .insertInto("publicacao")
      .values({
        comerciante_id: comercianteId,
        artigo_id: pedido.artigo_id,
        loja_id: canal.loja_id,
        canal_id: pedido.canal_id,
        mercado_id: pedido.mercado_id,
        variantes_fora: fora,
      })
      .onConflict((oc) =>
        oc.columns(["artigo_id", "canal_id", "mercado_id"]).doNothing(),
      )
      .execute();
    const actual = await trx
      .selectFrom("publicacao")
      .select(["id", "estado"])
      .where("artigo_id", "=", pedido.artigo_id)
      .where("canal_id", "=", pedido.canal_id)
      .where("mercado_id", "=", pedido.mercado_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const publicada = verificacao.impedimentos.length === 0;
    // Com impedimentos, só se guarda a verificação: o estado e as variantes
    // fora ficam como estavam (uma publicação publicada continua com o que
    // tinha à venda).
    const linha = await trx
      .updateTable("publicacao")
      .set({
        ultima_verificacao: JSON.stringify(verificacao),
        verificado_em: sql<Date>`clock_timestamp()`,
        ...(publicada
          ? { estado: "publicado" as const, variantes_fora: fora }
          : {}),
      })
      .where("id", "=", actual.id)
      .returning(COLUNAS)
      .executeTakeFirstOrThrow();
    return { publicada, verificacao, publicacao: linha };
  });
}

/** Retira uma publicação (publicado → arquivado; §4.2). */
export async function retirarPublicacao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  quem: string,
  publicacaoId: string,
): Promise<Publicacao> {
  return noCatalogo(db, comercianteId, async (trx) => {
    await comQuem(trx, quem);
    const linha = await trx
      .updateTable("publicacao")
      .set({ estado: "arquivado" })
      .where("id", "=", publicacaoId)
      .returning(COLUNAS)
      .executeTakeFirst();
    if (linha === undefined) {
      throw new ErroCatalogo("catalog.not_found", `publicação ${publicacaoId}`);
    }
    return linha;
  });
}

/** As publicações de um artigo (§7.1, `GET /products/{id}/publications`). */
export async function publicacoesDoArtigo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
): Promise<Publicacao[]> {
  return noCatalogo(db, comercianteId, (trx) =>
    trx
      .selectFrom("publicacao")
      .select(COLUNAS)
      .where("artigo_id", "=", artigoId)
      .orderBy("criado_em")
      .orderBy("id")
      .execute(),
  );
}
