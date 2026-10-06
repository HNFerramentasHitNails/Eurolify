import { sql, type Kysely, type Transaction } from "kysely";
import type {
  BaseDados,
  EstadoMercado,
  TipoListaPrecos,
} from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";

// Preços e mercados, parte 1 (docs/20 §3.1 a §3.5; migração 0017; issue
// #127). Como o Catálogo, ainda sem API: as regras vivem na base (CHECK,
// índices únicos e gatilhos da 0017); aqui só se traduzem os erros, se impõe
// a versão nas escritas e se converte o montante (bigint) em número.

export type CodigoErroPrecos =
  | "prices.not_found"
  | "prices.invalid_transition"
  | "prices.immutable_identity"
  | "prices.market_has_prices"
  | "prices.base_list_required"
  | "prices.base_list_in_use"
  | "prices.base_list_duplicate"
  | "prices.country_in_other_market"
  | "prices.defined_by_required"
  | "prices.list_archived"
  | "prices.version_conflict"
  | "prices.name_required"
  | "prices.country_invalid"
  | "prices.currency_invalid"
  | "prices.language_invalid"
  | "prices.main_language_not_listed"
  | "prices.free_only_at_zero"
  | "prices.amount_invalid"
  | "prices.quantity_invalid"
  | "prices.b2b_label_required"
  | "prices.priority_duplicate"
  | "prices.label_duplicate"
  | "prices.channel_market_duplicate"
  | "prices.channel_market_in_use"
  | "prices.published_variant"
  | "prices.invalid_field"
  | "prices.retry";

export class ErroPrecos extends Error {
  constructor(
    readonly codigo: CodigoErroPrecos,
    mensagem: string,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroPrecos";
  }
}

/** Os códigos que os gatilhos da 0017 põem no início da mensagem. */
const CODIGOS_DA_BASE: readonly CodigoErroPrecos[] = [
  "prices.invalid_transition",
  "prices.immutable_identity",
  "prices.market_has_prices",
  "prices.base_list_required",
  "prices.base_list_in_use",
  "prices.country_in_other_market",
  "prices.defined_by_required",
  "prices.list_archived",
  "prices.country_invalid",
  "prices.language_invalid",
  // Da 0019 (Catálogo, publicação): o preço de uma variante publicada e o
  // par canal × mercado com publicações publicadas.
  "prices.published_variant",
  "prices.channel_market_in_use",
];

/** As restrições da 0017 com código próprio. */
const RESTRICOES: Readonly<Record<string, CodigoErroPrecos>> = {
  mercado_nome_check: "prices.name_required",
  canal_nome_check: "prices.name_required",
  lista_precos_nome_check: "prices.name_required",
  mercado_paises_validos: "prices.country_invalid",
  mercado_moeda_valida: "prices.currency_invalid",
  mercado_linguas_validas: "prices.language_invalid",
  mercado_lingua_principal_da_lista: "prices.main_language_not_listed",
  preco_gratuito_so_a_zero: "prices.free_only_at_zero",
  preco_montante_valido: "prices.amount_invalid",
  preco_quantidades_validas: "prices.quantity_invalid",
  lista_precos_b2b_com_etiqueta: "prices.b2b_label_required",
  lista_precos_uma_base_activa: "prices.base_list_duplicate",
  lista_precos_prioridade_unica: "prices.priority_duplicate",
  lista_precos_etiqueta_unica: "prices.label_duplicate",
  canal_mercado_pkey: "prices.channel_market_duplicate",
};

const TABELAS = new Set([
  "mercado",
  "canal",
  "canal_mercado",
  "lista_precos",
  "preco",
  "historico_preco",
]);

/** Exportada para os testes; o resto do código usa-a por `noDominio`. */
export function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error)) return erro;
  if (erro instanceof ErroPrecos) return erro;
  const codigo = CODIGOS_DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroPrecos(codigo, erro.message, { cause: erro });
  }
  const pg = erro as Error & {
    code?: string;
    constraint?: string;
    table?: string;
  };
  const daRestricao =
    pg.constraint === undefined ? undefined : RESTRICOES[pg.constraint];
  if (
    daRestricao !== undefined &&
    (pg.code === "23505" || pg.code === "23514")
  ) {
    return new ErroPrecos(daRestricao, erro.message, { cause: erro });
  }
  if (
    (pg.code === "23514" || pg.code === "23502") &&
    pg.table !== undefined &&
    TABELAS.has(pg.table)
  ) {
    return new ErroPrecos("prices.invalid_field", erro.message, {
      cause: erro,
    });
  }
  // Um valor que a base nem consegue ler: um id mal escrito é «não existe»,
  // como um id de outro comerciante; o resto é campo inválido.
  if (pg.code !== undefined && pg.code.startsWith("22")) {
    const codigoDeValor =
      pg.code === "22P02" &&
      /^invalid input syntax for type uuid:/.test(erro.message)
        ? "prices.not_found"
        : "prices.invalid_field";
    return new ErroPrecos(codigoDeValor, erro.message, { cause: erro });
  }
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
    return new ErroPrecos("prices.retry", "tentar outra vez", { cause: erro });
  }
  // Uma referência que falha (a loja, o mercado, a lista ou a variante não
  // existem ou são de outro comerciante, ou o mercado é de outra loja): o
  // RLS esconde-as igual, sem oráculo.
  if (pg.code === "23503" && pg.table !== undefined && TABELAS.has(pg.table)) {
    return new ErroPrecos("prices.not_found", "referência inexistente", {
      cause: erro,
    });
  }
  return erro;
}

/** O tempo máximo que uma operação espera por um lock (`lock_timeout`). */
export const ESPERA_MAXIMA = "5s";

async function noDominio<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
): Promise<T> {
  try {
    return await comComerciante(db, comercianteId, async (trx) => {
      // Uma escrita não espera sem fim por outra que tenha a lista ou o
      // mercado tomados: ao fim do prazo, `prices.retry` (2.ª ronda, P3-C).
      await sql`select set_config('lock_timeout', ${ESPERA_MAXIMA}, true)`.execute(
        trx,
      );
      return fn(trx);
    });
  } catch (erro) {
    throw traduzir(erro);
  }
}

async function comQuem(
  trx: Transaction<BaseDados>,
  quem: string,
): Promise<void> {
  await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
}

/** Uma escrita com versão: nada mudou porque não existe, ou porque a versão era outra. */
async function semLinha(
  trx: Transaction<BaseDados>,
  tabela: "mercado" | "canal" | "lista_precos",
  id: string,
): Promise<never> {
  const existe = await trx
    .selectFrom(tabela)
    .select("id")
    .where("id", "=", id)
    .executeTakeFirst();
  if (existe === undefined) {
    throw new ErroPrecos("prices.not_found", `${tabela} inexistente`);
  }
  throw new ErroPrecos(
    "prices.version_conflict",
    `${tabela}: a versão lida já não é a actual`,
  );
}

// ---------------------------------------------------------------- Mercados

export interface DadosMercado {
  loja_id: string;
  nome: string;
  paises: string[];
  moeda: string;
  linguas: string[];
  lingua_principal: string;
  /** Por omissão, com IVA (docs/20 §9, Q1; docs/06, BS). */
  preco_inclui_iva?: boolean;
}

/** Cria um mercado em rascunho (§3.1). Devolve o id. */
export async function criarMercado(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosMercado,
): Promise<string> {
  const { id } = await noDominio(db, comercianteId, (trx) =>
    trx
      .insertInto("mercado")
      .values({ comerciante_id: comercianteId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

export async function obterMercado(
  db: Kysely<BaseDados>,
  comercianteId: string,
  mercadoId: string,
) {
  const mercado = await noDominio(db, comercianteId, (trx) =>
    trx
      .selectFrom("mercado")
      .selectAll()
      .where("id", "=", mercadoId)
      .executeTakeFirst(),
  );
  if (mercado === undefined) {
    throw new ErroPrecos("prices.not_found", "mercado inexistente");
  }
  return mercado;
}

export type AlteracaoMercado = Partial<
  Pick<
    DadosMercado,
    | "nome"
    | "paises"
    | "moeda"
    | "linguas"
    | "lingua_principal"
    | "preco_inclui_iva"
  >
>;

const CAMPOS_MERCADO = [
  "nome",
  "paises",
  "moeda",
  "linguas",
  "lingua_principal",
  "preco_inclui_iva",
] as const;

/** Altera um mercado na versão lida; recusa uma versão antiga. Devolve a nova versão. */
export async function alterarMercado(
  db: Kysely<BaseDados>,
  comercianteId: string,
  mercadoId: string,
  versao: number,
  alteracao: AlteracaoMercado,
): Promise<number> {
  // Só os campos da lista (um campo a mais, vindo de um pedido, não passa).
  const valores: AlteracaoMercado = {};
  for (const campo of CAMPOS_MERCADO) {
    if (alteracao[campo] !== undefined) {
      (valores as Record<string, unknown>)[campo] = alteracao[campo];
    }
  }
  if (Object.keys(valores).length === 0) {
    throw new ErroPrecos("prices.invalid_field", "nada a alterar");
  }
  return noDominio(db, comercianteId, async (trx) => {
    const linha = await trx
      .updateTable("mercado")
      .set(valores)
      .where("id", "=", mercadoId)
      .where("versao", "=", versao)
      .returning("versao")
      .executeTakeFirst();
    return linha?.versao ?? semLinha(trx, "mercado", mercadoId);
  });
}

/** Activa ou arquiva um mercado (§4.1) na versão lida. Devolve a nova versão. */
export async function mudarEstadoMercado(
  db: Kysely<BaseDados>,
  comercianteId: string,
  mercadoId: string,
  versao: number,
  estado: Exclude<EstadoMercado, "rascunho">,
): Promise<number> {
  return noDominio(db, comercianteId, async (trx) => {
    const linha = await trx
      .updateTable("mercado")
      .set({ estado })
      .where("id", "=", mercadoId)
      .where("versao", "=", versao)
      .returning("versao")
      .executeTakeFirst();
    return linha?.versao ?? semLinha(trx, "mercado", mercadoId);
  });
}

// ------------------------------------------------------------------ Canais

/** Cria um canal online activo (§3.2). Devolve o id. */
export async function criarCanal(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: { loja_id: string; nome: string },
): Promise<string> {
  const { id } = await noDominio(db, comercianteId, (trx) =>
    trx
      .insertInto("canal")
      .values({ comerciante_id: comercianteId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

/** Arquiva ou repõe um canal na versão lida. Devolve a nova versão. */
export async function mudarEstadoCanal(
  db: Kysely<BaseDados>,
  comercianteId: string,
  canalId: string,
  versao: number,
  estado: "activo" | "arquivado",
): Promise<number> {
  return noDominio(db, comercianteId, async (trx) => {
    const linha = await trx
      .updateTable("canal")
      .set({ estado })
      .where("id", "=", canalId)
      .where("versao", "=", versao)
      .returning("versao")
      .executeTakeFirst();
    return linha?.versao ?? semLinha(trx, "canal", canalId);
  });
}

/**
 * Substitui a lista dos mercados de um canal (§3.2). Os mercados têm de ser
 * da loja do canal: a chave composta da base recusa os de outra loja.
 */
export async function definirMercadosDoCanal(
  db: Kysely<BaseDados>,
  comercianteId: string,
  canalId: string,
  mercadoIds: readonly string[],
): Promise<void> {
  // O pg devolve os uuid em minúsculas: compara-se assim.
  const pedidos = mercadoIds.map((m) => m.toLowerCase());
  await noDominio(db, comercianteId, async (trx) => {
    const canal = await trx
      .selectFrom("canal")
      .select(["loja_id"])
      .where("id", "=", canalId)
      .forUpdate()
      .executeTakeFirst();
    if (canal === undefined) {
      throw new ErroPrecos("prices.not_found", "canal inexistente");
    }
    if (new Set(pedidos).size !== pedidos.length) {
      throw new ErroPrecos(
        "prices.channel_market_duplicate",
        "um mercado repetido na lista",
      );
    }
    // Só sai o que deixou de estar na lista, e só entra o que é novo: um
    // par com publicações publicadas (0019) fica onde está, e tirá-lo é
    // recusado com prices.channel_market_in_use.
    const actuais = await trx
      .selectFrom("canal_mercado")
      .select("mercado_id")
      .where("canal_id", "=", canalId)
      .execute();
    const queSaem = actuais
      .map((a) => a.mercado_id)
      .filter((m) => !pedidos.includes(m));
    if (queSaem.length > 0) {
      await trx
        .deleteFrom("canal_mercado")
        .where("canal_id", "=", canalId)
        .where("mercado_id", "in", queSaem)
        .execute();
    }
    const jaLa = new Set(actuais.map((a) => a.mercado_id));
    const queEntram = pedidos.filter((m) => !jaLa.has(m));
    if (queEntram.length > 0) {
      await trx
        .insertInto("canal_mercado")
        .values(
          queEntram.map((mercado_id) => ({
            comerciante_id: comercianteId,
            loja_id: canal.loja_id,
            canal_id: canalId,
            mercado_id,
          })),
        )
        .execute();
    }
  });
}

export async function mercadosDoCanal(
  db: Kysely<BaseDados>,
  comercianteId: string,
  canalId: string,
): Promise<string[]> {
  const linhas = await noDominio(db, comercianteId, (trx) =>
    trx
      .selectFrom("canal_mercado")
      .select("mercado_id")
      .where("canal_id", "=", canalId)
      .orderBy("mercado_id")
      .execute(),
  );
  return linhas.map((l) => l.mercado_id);
}

// ------------------------------------------------------- Listas de preços

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DadosLista {
  mercado_id: string;
  nome: string;
  tipo: TipoListaPrecos;
  /** Só nas listas B2B (§3.3). */
  etiqueta_id?: string;
  prioridade?: number;
}

/** Cria uma lista activa (§3.3). Devolve o id. */
export async function criarLista(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosLista,
): Promise<string> {
  // Uma etiqueta mal escrita é um campo inválido, não «não existe» (a etiqueta
  // é de Clientes e aqui não se procura; revisão do #134, P3-4).
  if (dados.etiqueta_id !== undefined && !UUID.test(dados.etiqueta_id)) {
    throw new ErroPrecos("prices.invalid_field", "etiqueta mal escrita");
  }
  const { id } = await noDominio(db, comercianteId, (trx) =>
    trx
      .insertInto("lista_precos")
      .values({ comerciante_id: comercianteId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

/** Arquiva ou repõe uma lista na versão lida. Devolve a nova versão. */
export async function mudarEstadoLista(
  db: Kysely<BaseDados>,
  comercianteId: string,
  listaId: string,
  versao: number,
  estado: "activa" | "arquivada",
): Promise<number> {
  return noDominio(db, comercianteId, async (trx) => {
    const linha = await trx
      .updateTable("lista_precos")
      .set({ estado })
      .where("id", "=", listaId)
      .where("versao", "=", versao)
      .returning("versao")
      .executeTakeFirst();
    return linha?.versao ?? semLinha(trx, "lista_precos", listaId);
  });
}

// ------------------------------------------------------------------ Preços

/** O limite da restrição `preco_montante_valido` da 0017. */
const MONTANTE_MAXIMO = 100_000_000_000;

export interface DadosPreco {
  /** Cêntimos, na moeda do mercado da lista. */
  montante: number;
  /** Obrigatório quando o montante é 0 (R4). */
  gratuito?: boolean;
  quantidade_minima?: number;
  multiplo?: number;
}

export interface Preco {
  lista_id: string;
  variante_id: string;
  montante: number;
  gratuito: boolean;
  quantidade_minima: number;
  multiplo: number;
  definido_por: string;
  definido_em: Date;
  versao: number;
}

function paraPreco(linha: {
  lista_id: string;
  variante_id: string;
  montante: string;
  gratuito: boolean;
  quantidade_minima: number;
  multiplo: number;
  definido_por: string;
  definido_em: Date;
  versao: number;
}): Preco {
  return { ...linha, montante: Number(linha.montante) };
}

/**
 * Define o preço corrente de uma variante numa lista (§3.4): cria-o ou
 * substitui-o. A base escreve a linha do histórico quando o montante ou o
 * «gratuito» mudam. `quem` é obrigatório (como na classificação, 0006).
 */
export async function definirPreco(
  db: Kysely<BaseDados>,
  comercianteId: string,
  quem: string,
  listaId: string,
  varianteId: string,
  dados: DadosPreco,
): Promise<Preco> {
  // Um montante que não é um número inteiro é campo inválido; um inteiro fora
  // do limite é montante inválido, também acima do que o bigint guarda
  // (revisão do #134, P3-4).
  if (!Number.isInteger(dados.montante)) {
    throw new ErroPrecos(
      "prices.invalid_field",
      "montante em cêntimos inteiros",
    );
  }
  if (dados.montante < 0 || dados.montante > MONTANTE_MAXIMO) {
    throw new ErroPrecos("prices.amount_invalid", "montante fora do limite");
  }
  const valores = {
    montante: dados.montante,
    gratuito: dados.gratuito ?? false,
    quantidade_minima: dados.quantidade_minima ?? 1,
    multiplo: dados.multiplo ?? 1,
  };
  const linha = await noDominio(db, comercianteId, async (trx) => {
    await comQuem(trx, quem);
    return trx
      .insertInto("preco")
      .values({
        comerciante_id: comercianteId,
        lista_id: listaId,
        variante_id: varianteId,
        ...valores,
      })
      .onConflict((oc) =>
        oc.columns(["lista_id", "variante_id"]).doUpdateSet(valores),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  return paraPreco(linha);
}

/** Tira o preço de uma variante de uma lista (fica no histórico). */
export async function tirarPreco(
  db: Kysely<BaseDados>,
  comercianteId: string,
  quem: string,
  listaId: string,
  varianteId: string,
): Promise<boolean> {
  const linhas = await noDominio(db, comercianteId, async (trx) => {
    await comQuem(trx, quem);
    return trx
      .deleteFrom("preco")
      .where("lista_id", "=", listaId)
      .where("variante_id", "=", varianteId)
      .returning("variante_id")
      .execute();
  });
  return linhas.length > 0;
}

export async function precosDaLista(
  db: Kysely<BaseDados>,
  comercianteId: string,
  listaId: string,
): Promise<Preco[]> {
  const linhas = await noDominio(db, comercianteId, (trx) =>
    trx
      .selectFrom("preco")
      .select([
        "lista_id",
        "variante_id",
        "montante",
        "gratuito",
        "quantidade_minima",
        "multiplo",
        "definido_por",
        "definido_em",
        "versao",
      ])
      .where("lista_id", "=", listaId)
      .orderBy("variante_id")
      .execute(),
  );
  return linhas.map(paraPreco);
}

export interface LinhaHistorico {
  montante: number | null;
  gratuito: boolean | null;
  saiu: boolean;
  /** A moeda e o «preço inclui IVA» do mercado quando a linha se escreveu. */
  moeda: string;
  preco_inclui_iva: boolean;
  em_vigor_desde: Date;
  definido_por: string;
}

/** O histórico de um preço, do mais antigo ao mais recente (§3.5). */
export async function historicoDoPreco(
  db: Kysely<BaseDados>,
  comercianteId: string,
  listaId: string,
  varianteId: string,
): Promise<LinhaHistorico[]> {
  const linhas = await noDominio(db, comercianteId, (trx) =>
    trx
      .selectFrom("historico_preco")
      .select([
        "montante",
        "gratuito",
        "saiu",
        "moeda",
        "preco_inclui_iva",
        "em_vigor_desde",
        "definido_por",
      ])
      .where("lista_id", "=", listaId)
      .where("variante_id", "=", varianteId)
      .orderBy("em_vigor_desde")
      .orderBy("id")
      .execute(),
  );
  return linhas.map((l) => ({
    ...l,
    montante: l.montante === null ? null : Number(l.montante),
  }));
}

// ------------------------------------- A pergunta da C2 do Catálogo (R4)

export type ImpedimentoDePreco = "prices.market_inactive" | "prices.no_price";

export interface VerificacaoDePreco {
  variante_id: string;
  com_preco: boolean;
  gratuito: boolean;
  impedimento: ImpedimentoDePreco | null;
}

/**
 * «Há preço neste mercado, e não é 0,00 € sem ser gratuito?» (docs/14 §5,
 * C2; docs/20 R4). Não escreve. Responde por variante, pela lista de base
 * activa do mercado; um 0 sem «gratuito» não existe (a base recusa-o).
 */
export async function verificarPrecos(
  db: Kysely<BaseDados>,
  comercianteId: string,
  mercadoId: string,
  varianteIds: readonly string[],
): Promise<VerificacaoDePreco[]> {
  return noDominio(db, comercianteId, (trx) =>
    verificarPrecosNa(trx, mercadoId, varianteIds),
  );
}

/**
 * A mesma pergunta dentro de uma transacção já aberta no contexto do
 * comerciante: a publicação do Catálogo pergunta-a na sua (docs/14 §5, C2).
 * Os erros saem por traduzir: quem chama traduz-os no seu domínio.
 */
export async function verificarPrecosNa(
  trx: Transaction<BaseDados>,
  mercadoId: string,
  varianteIds: readonly string[],
): Promise<VerificacaoDePreco[]> {
  const mercado = await trx
    .selectFrom("mercado")
    .select("estado")
    .where("id", "=", mercadoId)
    .executeTakeFirst();
  if (mercado === undefined) {
    throw new ErroPrecos("prices.not_found", "mercado inexistente");
  }
  const precos =
    varianteIds.length === 0
      ? []
      : await trx
          .selectFrom("preco")
          .innerJoin("lista_precos", (j) =>
            j
              .onRef("lista_precos.comerciante_id", "=", "preco.comerciante_id")
              .onRef("lista_precos.id", "=", "preco.lista_id"),
          )
          .select(["preco.variante_id", "preco.gratuito"])
          .where("lista_precos.mercado_id", "=", mercadoId)
          .where("lista_precos.tipo", "=", "base")
          .where("lista_precos.estado", "=", "activa")
          .where("preco.variante_id", "in", [...varianteIds])
          .execute();
  const porVariante = new Map(precos.map((p) => [p.variante_id, p.gratuito]));
  return varianteIds.map((variante_id) => {
    const gratuito = porVariante.get(variante_id);
    const com_preco = gratuito !== undefined;
    const impedimento: ImpedimentoDePreco | null =
      mercado.estado !== "activo"
        ? "prices.market_inactive"
        : com_preco
          ? null
          : "prices.no_price";
    return {
      variante_id,
      com_preco,
      gratuito: gratuito ?? false,
      impedimento,
    };
  });
}
