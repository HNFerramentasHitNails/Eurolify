import { sql, type Kysely, type Transaction } from "kysely";
import type {
  BaseDados,
  EstadoExpedicao,
  OrigemMovimento,
  PoliticaStock,
} from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";

// O stock e as encomendas depois de pagas (docs/27; migração 0045). O saldo
// só muda por movimento: este módulo escreve movimentos, e os gatilhos da
// base escrevem o saldo no mesmo passo (R1). O disponível de um kit vem dos
// componentes (R4).

export type CodigoErroStock =
  | "inventory.not_found"
  | "inventory.invalid_field"
  | "inventory.retry"
  | "inventory.version_conflict"
  | "inventory.insufficient"
  | "inventory.lot_required"
  | "inventory.negative"
  | "inventory.not_controlled"
  | "inventory.no_warehouse"
  | "shipments.immutable"
  | "shipments.invalid_transition"
  | "shipments.line_not_in_order"
  | "shipments.quantity_exceeded"
  | "orders.invalid_transition";

export const ESTADO_DO_CODIGO: Record<CodigoErroStock, number> = {
  "inventory.not_found": 404,
  "inventory.invalid_field": 400,
  "inventory.retry": 503,
  "inventory.version_conflict": 409,
  "inventory.insufficient": 422,
  "inventory.lot_required": 422,
  "inventory.negative": 422,
  "inventory.not_controlled": 422,
  "inventory.no_warehouse": 422,
  "shipments.immutable": 409,
  "shipments.invalid_transition": 409,
  "shipments.line_not_in_order": 422,
  "shipments.quantity_exceeded": 422,
  "orders.invalid_transition": 409,
};

export class ErroStock extends Error {
  constructor(
    readonly codigo: CodigoErroStock,
    mensagem: string,
    readonly pormenor?: unknown,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroStock";
  }
}

const CODIGOS_DA_BASE: CodigoErroStock[] = [
  "inventory.insufficient",
  "inventory.lot_required",
  "inventory.negative",
  "inventory.not_controlled",
  "inventory.not_found",
  "shipments.immutable",
  "shipments.invalid_transition",
  "orders.invalid_transition",
];

export function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error) || erro instanceof ErroStock) return erro;
  const codigo = CODIGOS_DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroStock(codigo, erro.message, undefined, { cause: erro });
  }
  const pg = erro as Error & { code?: string; constraint?: string };
  if (pg.code === "23505" && pg.constraint === "armazem_um_por_loja") {
    return new ErroStock(
      "inventory.invalid_field",
      "esta loja já tem um armazém activo",
      undefined,
      { cause: erro },
    );
  }
  if (
    pg.code === "23503" ||
    (pg.code === "22P02" && /uuid/.test(erro.message))
  ) {
    return new ErroStock("inventory.not_found", "não existe", undefined, {
      cause: erro,
    });
  }
  if (pg.code === "23514" || pg.code === "22001") {
    return new ErroStock(
      "inventory.invalid_field",
      "um valor do pedido não é aceite",
      undefined,
      { cause: erro },
    );
  }
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
    return new ErroStock("inventory.retry", "tentar outra vez", undefined, {
      cause: erro,
    });
  }
  return erro;
}

export async function noStock<T>(
  db: Kysely<BaseDados>,
  c: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
): Promise<T> {
  try {
    if (db.isTransaction) return await fn(db as Transaction<BaseDados>);
    return await comComerciante(db, c, fn);
  } catch (erro) {
    throw traduzir(erro);
  }
}

// ---------------------------------------------------------- Kits e política

/** A profundidade máxima de kits dentro de kits (proposta; o Catálogo não tem ciclos). */
const PROFUNDIDADE_MAXIMA = 10;

/**
 * As variantes-folha (sem componentes) de uma variante, com a quantidade de
 * cada uma por unidade (R4). Uma variante que não é kit é a sua própria folha.
 */
export async function folhas(
  trx: Transaction<BaseDados>,
  varianteId: string,
  quantidade = 1,
  profundidade = 0,
): Promise<Map<string, number>> {
  if (profundidade > PROFUNDIDADE_MAXIMA) {
    throw new ErroStock(
      "inventory.invalid_field",
      "kits dentro de kits fundo de mais",
    );
  }
  const componentes = await trx
    .selectFrom("componente")
    .select(["componente_id", "quantidade"])
    .where("kit_id", "=", varianteId)
    .orderBy("componente_id")
    .execute();
  const r = new Map<string, number>();
  if (componentes.length === 0) {
    r.set(varianteId, quantidade);
    return r;
  }
  for (const c of componentes) {
    const sub = await folhas(
      trx,
      c.componente_id,
      quantidade * c.quantidade,
      profundidade + 1,
    );
    for (const [v, q] of sub) r.set(v, (r.get(v) ?? 0) + q);
  }
  return r;
}

export interface Politica {
  politica: PoliticaStock;
  exige_lote: boolean;
}

export async function politicas(
  trx: Transaction<BaseDados>,
  varianteIds: string[],
): Promise<Map<string, Politica>> {
  const r = new Map<string, Politica>();
  if (varianteIds.length === 0) return r;
  const linhas = await trx
    .selectFrom("variante")
    .innerJoin("artigo", "artigo.id", "variante.artigo_id")
    .leftJoin("politica_stock", "politica_stock.variante_id", "variante.id")
    .select([
      "variante.id",
      "artigo.tipo",
      "politica_stock.politica",
      "politica_stock.exige_lote",
    ])
    .where("variante.id", "in", varianteIds)
    .execute();
  for (const l of linhas) {
    r.set(l.id, {
      politica:
        l.politica ?? (l.tipo === "fisico" ? "controla" : "nao_controla"),
      exige_lote: l.exige_lote ?? false,
    });
  }
  return r;
}

/** O armazém activo da loja (Q1: um por loja), ou null. */
export async function armazemDaLoja(
  trx: Transaction<BaseDados>,
  lojaId: string,
): Promise<string | null> {
  const a = await trx
    .selectFrom("armazem")
    .select("id")
    .where("loja_id", "=", lojaId)
    .where("estado", "=", "activo")
    .executeTakeFirst();
  return a?.id ?? null;
}

/**
 * O disponível de cada variante pedida (físico − reservado, R2); um kit pelo
 * mínimo dos componentes (R4). `null` = não controla stock (não se esgota).
 * «Vende sem stock» também dá null (reserva sempre).
 */
export async function disponiveis(
  trx: Transaction<BaseDados>,
  armazemId: string | null,
  varianteIds: string[],
): Promise<Map<string, number | null>> {
  const r = new Map<string, number | null>();
  const arvores = new Map<string, Map<string, number>>();
  const todas = new Set<string>();
  for (const v of new Set(varianteIds)) {
    const f = await folhas(trx, v);
    arvores.set(v, f);
    for (const k of f.keys()) todas.add(k);
  }
  const pol = await politicas(trx, [...todas]);
  const saldos = new Map<string, number>();
  if (armazemId !== null && todas.size > 0) {
    const linhas = await trx
      .selectFrom("saldo_stock")
      .select(["variante_id", "fisico", "reservado"])
      .where("armazem_id", "=", armazemId)
      .where("variante_id", "in", [...todas])
      .execute();
    for (const l of linhas) saldos.set(l.variante_id, l.fisico - l.reservado);
  }
  for (const [v, f] of arvores) {
    let minimo: number | null = null;
    for (const [folha, porUnidade] of f) {
      const p = pol.get(folha)?.politica ?? "controla";
      if (p !== "controla") continue;
      const d = Math.max(0, saldos.get(folha) ?? 0);
      const unidades = Math.floor(d / porUnidade);
      minimo = minimo === null ? unidades : Math.min(minimo, unidades);
    }
    r.set(v, minimo);
  }
  return r;
}

/** Quem e o motivo dos próximos movimentos e transições. */
async function marcar(
  trx: Transaction<BaseDados>,
  quem: string,
  motivo: string | null = null,
) {
  await sql`select set_config('eurolify.quem', ${quem}, true),
    set_config('eurolify.motivo', ${motivo ?? ""}, true)`.execute(trx);
}

/**
 * A reserva do botão final (§4.2): uma por variante-folha que controla
 * stock, pela ordem das variantes (a mesma ordem de bloqueio em todos os
 * pedidos, para dois botões ao mesmo tempo não se bloquearem). Sem
 * disponível, a base recusa (R2, R7).
 */
export async function reservarEncomenda(
  trx: Transaction<BaseDados>,
  c: string,
  encomendaId: string,
  lojaId: string,
  linhas: { variante_id: string; quantidade: number }[],
) {
  const total = new Map<string, number>();
  for (const l of linhas) {
    for (const [v, q] of await folhas(trx, l.variante_id, l.quantidade)) {
      total.set(v, (total.get(v) ?? 0) + q);
    }
  }
  const pol = await politicas(trx, [...total.keys()]);
  const aReservar = [...total.entries()]
    .filter(([v]) => (pol.get(v)?.politica ?? "controla") !== "nao_controla")
    .sort(([a], [b]) => a.localeCompare(b));
  if (aReservar.length === 0) return;
  const armazem = await armazemDaLoja(trx, lojaId);
  if (armazem === null) {
    throw new ErroStock(
      "inventory.no_warehouse",
      "a loja não tem armazém: não se pode reservar o stock",
    );
  }
  for (const [v, q] of aReservar) {
    await trx
      .insertInto("movimento_stock")
      .values({
        comerciante_id: c,
        armazem_id: armazem,
        variante_id: v,
        tipo: "reserva",
        quantidade: q,
        origem: "encomenda",
        encomenda_id: encomendaId,
      })
      .execute();
  }
}

// ------------------------------------------------------------- Armazéns

export async function listarArmazens(db: Kysely<BaseDados>, c: string) {
  return noStock(db, c, (trx) =>
    trx.selectFrom("armazem").selectAll().orderBy("criado_em").execute(),
  );
}

export async function criarArmazem(
  trx: Transaction<BaseDados>,
  c: string,
  dados: { loja: string; nome: string; morada: Record<string, unknown> },
) {
  return noStock(trx, c, async () => {
    const { id } = await trx
      .insertInto("armazem")
      .values({
        comerciante_id: c,
        loja_id: dados.loja,
        nome: dados.nome,
        morada: JSON.stringify(dados.morada),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
}

export async function mudarArmazem(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  versao: number,
  dados: {
    nome?: string;
    morada?: Record<string, unknown>;
    arquivar?: boolean;
  },
) {
  return noStock(trx, c, async () => {
    const a = await trx
      .selectFrom("armazem")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (a === undefined) {
      throw new ErroStock("inventory.not_found", "este armazém não existe");
    }
    if (a.versao !== versao) {
      throw new ErroStock("inventory.version_conflict", "o armazém mudou", {
        versao: a.versao,
      });
    }
    if (dados.arquivar === true) {
      const comStock = await trx
        .selectFrom("saldo_stock")
        .select("variante_id")
        .where("armazem_id", "=", id)
        .where((w) => w.or([w("fisico", ">", 0), w("reservado", ">", 0)]))
        .executeTakeFirst();
      if (comStock !== undefined) {
        throw new ErroStock(
          "inventory.invalid_field",
          "um armazém com stock não se arquiva",
        );
      }
    }
    await trx
      .updateTable("armazem")
      .set({
        ...(dados.nome === undefined ? {} : { nome: dados.nome }),
        ...(dados.morada === undefined
          ? {}
          : { morada: JSON.stringify(dados.morada) }),
        ...(dados.arquivar === true ? { estado: "arquivado" as const } : {}),
        actualizado_em: new Date(),
        versao: a.versao + 1,
      })
      .where("id", "=", id)
      .execute();
    return a.versao + 1;
  });
}

// ------------------------------------------------- Entradas, ajustes, lotes

async function loteDe(
  trx: Transaction<BaseDados>,
  c: string,
  varianteId: string,
  lote: { numero: string; validade?: string | null } | undefined,
): Promise<string | null> {
  if (lote === undefined) return null;
  const existente = await trx
    .selectFrom("lote")
    .select(["id", "validade"])
    .where("variante_id", "=", varianteId)
    .where("numero", "=", lote.numero)
    .executeTakeFirst();
  if (existente !== undefined) return existente.id;
  const { id } = await trx
    .insertInto("lote")
    .values({
      comerciante_id: c,
      variante_id: varianteId,
      numero: lote.numero,
      validade: lote.validade ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return id;
}

export async function darEntrada(
  trx: Transaction<BaseDados>,
  c: string,
  dados: {
    armazem: string;
    origem: Extract<
      OrigemMovimento,
      "inventario" | "importacao" | "sistema_externo"
    >;
    linhas: {
      variante: string;
      quantidade: number;
      lote?: { numero: string; validade?: string | null };
    }[];
  },
  quem: string,
) {
  return noStock(trx, c, async () => {
    await marcar(trx, quem);
    const ids: string[] = [];
    for (const l of dados.linhas) {
      const { id } = await trx
        .insertInto("movimento_stock")
        .values({
          comerciante_id: c,
          armazem_id: dados.armazem,
          variante_id: l.variante,
          lote_id: await loteDe(trx, c, l.variante, l.lote),
          tipo: "entrada",
          quantidade: l.quantidade,
          origem: dados.origem,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      ids.push(id);
    }
    return ids;
  });
}

export async function ajustar(
  trx: Transaction<BaseDados>,
  c: string,
  dados: {
    armazem: string;
    variante: string;
    delta: number;
    motivo: string;
    origem: Extract<OrigemMovimento, "inventario" | "sistema_externo">;
    lote?: { numero: string; validade?: string | null };
  },
  quem: string,
) {
  return noStock(trx, c, async () => {
    await marcar(trx, quem);
    const { id } = await trx
      .insertInto("movimento_stock")
      .values({
        comerciante_id: c,
        armazem_id: dados.armazem,
        variante_id: dados.variante,
        lote_id: await loteDe(trx, c, dados.variante, dados.lote),
        tipo: "ajuste",
        quantidade: dados.delta,
        origem: dados.origem,
        motivo: dados.motivo,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
}

export async function definirPolitica(
  trx: Transaction<BaseDados>,
  c: string,
  variante: string,
  dados: { politica: PoliticaStock; exige_lote: boolean },
) {
  return noStock(trx, c, async () => {
    await trx
      .insertInto("politica_stock")
      .values({
        comerciante_id: c,
        variante_id: variante,
        politica: dados.politica,
        exige_lote: dados.exige_lote,
      })
      .onConflict((oc) =>
        oc.column("variante_id").doUpdateSet({
          politica: dados.politica,
          exige_lote: dados.exige_lote,
          actualizado_em: new Date(),
        }),
      )
      .execute();
  });
}

export async function lerInventario(
  db: Kysely<BaseDados>,
  c: string,
  filtro: { armazem?: string; variante?: string },
) {
  return noStock(db, c, async (trx) => {
    let q = trx
      .selectFrom("saldo_stock")
      .selectAll()
      .orderBy("armazem_id")
      .orderBy("variante_id");
    if (filtro.armazem !== undefined)
      q = q.where("armazem_id", "=", filtro.armazem);
    if (filtro.variante !== undefined)
      q = q.where("variante_id", "=", filtro.variante);
    const saldos = await q.limit(500).execute();
    const lotes =
      saldos.length === 0
        ? []
        : await trx
            .selectFrom("saldo_lote")
            .innerJoin("lote", "lote.id", "saldo_lote.lote_id")
            .select([
              "saldo_lote.armazem_id",
              "lote.variante_id",
              "lote.id",
              "lote.numero",
              "lote.validade",
              "saldo_lote.fisico",
            ])
            .where(
              "lote.variante_id",
              "in",
              saldos.map((s) => s.variante_id),
            )
            .execute();
    return saldos.map((s) => ({
      ...s,
      disponivel: s.fisico - s.reservado,
      lotes: lotes.filter(
        (l) => l.variante_id === s.variante_id && l.armazem_id === s.armazem_id,
      ),
    }));
  });
}

export async function listarMovimentos(
  db: Kysely<BaseDados>,
  c: string,
  filtro: { variante?: string; encomenda?: string; limite: number },
) {
  return noStock(db, c, (trx) => {
    let q = trx
      .selectFrom("movimento_stock")
      .selectAll()
      .orderBy("em", "desc")
      .orderBy("id", "desc")
      .limit(filtro.limite);
    if (filtro.variante !== undefined)
      q = q.where("variante_id", "=", filtro.variante);
    if (filtro.encomenda !== undefined)
      q = q.where("encomenda_id", "=", filtro.encomenda);
    return q.execute();
  });
}

export async function listarLotes(
  db: Kysely<BaseDados>,
  c: string,
  variante: string | undefined,
) {
  return noStock(db, c, (trx) => {
    let q = trx.selectFrom("lote").selectAll().orderBy("criado_em");
    if (variante !== undefined) q = q.where("variante_id", "=", variante);
    return q.execute();
  });
}

// ---------------------------------------------- A vista do armazém (§6)

const ESTADOS_A_EXPEDIR = [
  "paga",
  "em_preparacao",
  "expedida_parcial",
] as const;

/** O que expedir: sem perfil de faturação, NIF, e-mail nem preços. */
async function vistaDeExpedicao(trx: Transaction<BaseDados>, ids: string[]) {
  if (ids.length === 0) return [];
  const encomendas = await trx
    .selectFrom("encomenda")
    .select([
      "id",
      "estado",
      "entrega",
      "contacto",
      "metodo_entrega",
      "criada_em",
    ])
    .where("id", "in", ids)
    .orderBy("criada_em")
    .execute();
  const linhas = await trx
    .selectFrom("linha_encomenda")
    .select([
      "id",
      "encomenda_id",
      "posicao",
      "variante_id",
      "sku",
      "nome",
      "quantidade",
    ])
    .where("encomenda_id", "in", ids)
    .orderBy("posicao")
    .execute();
  const enviadas = await enviadoPorLinha(trx, ids);
  return encomendas.map((e) => {
    const contacto = e.contacto as { nome?: string; telefone?: string | null };
    return {
      id: e.id,
      estado: e.estado,
      criada_em: e.criada_em,
      metodo_entrega: e.metodo_entrega,
      entrega: e.entrega,
      destinatario: {
        nome: contacto.nome ?? null,
        telefone: contacto.telefone ?? null,
      },
      linhas: linhas
        .filter((l) => l.encomenda_id === e.id)
        .map((l) => ({
          id: l.id,
          posicao: l.posicao,
          variante_id: l.variante_id,
          sku: l.sku,
          nome: l.nome,
          quantidade: l.quantidade,
          expedida: enviadas.get(l.id) ?? 0,
        })),
    };
  });
}

async function enviadoPorLinha(
  trx: Transaction<BaseDados>,
  encomendaIds: string[],
) {
  const r = new Map<string, number>();
  if (encomendaIds.length === 0) return r;
  const linhas = await trx
    .selectFrom("linha_expedicao")
    .innerJoin("expedicao", "expedicao.id", "linha_expedicao.expedicao_id")
    .select([
      "linha_expedicao.linha_encomenda_id",
      "linha_expedicao.quantidade",
    ])
    .where("expedicao.encomenda_id", "in", encomendaIds)
    .execute();
  for (const l of linhas) {
    r.set(
      l.linha_encomenda_id,
      (r.get(l.linha_encomenda_id) ?? 0) + l.quantidade,
    );
  }
  return r;
}

export async function listarParaExpedir(
  db: Kysely<BaseDados>,
  c: string,
  limite: number,
) {
  return noStock(db, c, async (trx) => {
    const ids = await trx
      .selectFrom("encomenda")
      .select("id")
      .where("estado", "in", [...ESTADOS_A_EXPEDIR])
      .orderBy("criada_em")
      .limit(limite)
      .execute();
    return vistaDeExpedicao(
      trx,
      ids.map((i) => i.id),
    );
  });
}

export async function lerParaExpedir(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noStock(db, c, async (trx) => {
    const [v] = await vistaDeExpedicao(trx, [id]);
    if (v === undefined) {
      throw new ErroStock("inventory.not_found", "esta encomenda não existe");
    }
    const expedicoes = await trx
      .selectFrom("expedicao")
      .selectAll()
      .where("encomenda_id", "=", id)
      .orderBy("criada_em")
      .execute();
    return { ...v, expedicoes };
  });
}

// ------------------------------------------------------------- Expedições

export async function criarExpedicao(
  trx: Transaction<BaseDados>,
  c: string,
  encomendaId: string,
  dados: {
    linhas: { linha: string; quantidade: number }[];
    transportadora?: string | null;
    servico?: string | null;
    seguimento?: string | null;
  },
  quem: string,
): Promise<string> {
  return noStock(trx, c, async () => {
    await marcar(trx, quem);
    const e = await trx
      .selectFrom("encomenda")
      .select(["id", "estado", "loja_id", "metodo_entrega"])
      .where("id", "=", encomendaId)
      .forUpdate()
      .executeTakeFirst();
    if (e === undefined) {
      throw new ErroStock("inventory.not_found", "esta encomenda não existe");
    }
    if (!(ESTADOS_A_EXPEDIR as readonly string[]).includes(e.estado)) {
      throw new ErroStock(
        "orders.invalid_transition",
        `uma encomenda ${e.estado} não se expede`,
      );
    }
    const armazem = await armazemDaLoja(trx, e.loja_id);
    if (armazem === null) {
      throw new ErroStock("inventory.no_warehouse", "a loja não tem armazém");
    }
    const linhas = await trx
      .selectFrom("linha_encomenda")
      .select(["id", "quantidade"])
      .where("encomenda_id", "=", encomendaId)
      .execute();
    const enviadas = await enviadoPorLinha(trx, [encomendaId]);
    const pedidas = new Map<string, number>();
    for (const l of dados.linhas) {
      pedidas.set(l.linha, (pedidas.get(l.linha) ?? 0) + l.quantidade);
    }
    for (const [linha, q] of pedidas) {
      const le = linhas.find((l) => l.id === linha);
      if (le === undefined) {
        throw new ErroStock(
          "shipments.line_not_in_order",
          "uma linha não é desta encomenda",
        );
      }
      if ((enviadas.get(linha) ?? 0) + q > le.quantidade) {
        throw new ErroStock(
          "shipments.quantity_exceeded",
          "mais do que falta expedir desta linha",
          {
            linha: `oli_${linha}`,
            falta: le.quantidade - (enviadas.get(linha) ?? 0),
          },
        );
      }
    }
    const { id } = await trx
      .insertInto("expedicao")
      .values({
        comerciante_id: c,
        encomenda_id: encomendaId,
        armazem_id: armazem,
        metodo_entrega: JSON.stringify(e.metodo_entrega),
        transportadora: dados.transportadora ?? null,
        servico: dados.servico ?? null,
        seguimento: dados.seguimento ?? null,
        criada_por: quem,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const [linha, q] of pedidas) {
      await trx
        .insertInto("linha_expedicao")
        .values({
          comerciante_id: c,
          expedicao_id: id,
          linha_encomenda_id: linha,
          quantidade: q,
        })
        .execute();
    }
    // A primeira expedição põe a encomenda em preparação.
    if (e.estado === "paga") {
      await trx
        .updateTable("encomenda")
        .set({ estado: "em_preparacao" })
        .where("id", "=", encomendaId)
        .execute();
    }
    return id;
  });
}

/** Os lotes a usar para uma folha (os dados pela pessoa, ou FEFO). */
async function lotesParaSaida(
  trx: Transaction<BaseDados>,
  armazem: string,
  variante: string,
  quantidade: number,
  dados: { variante: string; lote: string; quantidade: number }[],
): Promise<{ lote: string; quantidade: number }[]> {
  const escolhidos = dados.filter((d) => d.variante === variante);
  if (escolhidos.length > 0) {
    const soma = escolhidos.reduce((t, d) => t + d.quantidade, 0);
    if (soma !== quantidade) {
      throw new ErroStock(
        "inventory.lot_required",
        `os lotes de ${variante} somam ${String(soma)}, e saem ${String(quantidade)}`,
      );
    }
    const r: { lote: string; quantidade: number }[] = [];
    for (const d of escolhidos) {
      const l = await trx
        .selectFrom("lote")
        .select("id")
        .where("variante_id", "=", variante)
        .where("numero", "=", d.lote)
        .executeTakeFirst();
      if (l === undefined) {
        throw new ErroStock(
          "inventory.lot_required",
          `o lote ${d.lote} não existe`,
        );
      }
      r.push({ lote: l.id, quantidade: d.quantidade });
    }
    return r;
  }
  // FEFO: o que expira primeiro (proposta, docs/27 §3.4).
  const disponiveisPorLote = await trx
    .selectFrom("saldo_lote")
    .innerJoin("lote", "lote.id", "saldo_lote.lote_id")
    .select(["lote.id", "saldo_lote.fisico"])
    .where("saldo_lote.armazem_id", "=", armazem)
    .where("lote.variante_id", "=", variante)
    .where("saldo_lote.fisico", ">", 0)
    .orderBy(sql`lote.validade nulls last`)
    .orderBy("lote.numero")
    .execute();
  const r: { lote: string; quantidade: number }[] = [];
  let falta = quantidade;
  for (const l of disponiveisPorLote) {
    if (falta === 0) break;
    const q = Math.min(falta, l.fisico);
    r.push({ lote: l.id, quantidade: q });
    falta -= q;
  }
  if (falta > 0) {
    throw new ErroStock(
      "inventory.lot_required",
      `não há lotes com stock para ${variante}`,
    );
  }
  return r;
}

export async function mudarExpedicao(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  versao: number,
  dados: {
    estado?: Exclude<EstadoExpedicao, "criada">;
    transportadora?: string | null;
    servico?: string | null;
    seguimento?: string | null;
    prova_entrega?: string | null;
    lotes?: { variante: string; lote: string; quantidade: number }[];
  },
  quem: string,
) {
  return noStock(trx, c, async () => {
    await marcar(trx, quem);
    const x = await trx
      .selectFrom("expedicao")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (x === undefined) {
      throw new ErroStock("inventory.not_found", "esta expedição não existe");
    }
    // A encomenda primeiro, depois a expedição (a ordem de criarExpedicao).
    await trx
      .selectFrom("encomenda")
      .select("id")
      .where("id", "=", x.encomenda_id)
      .forUpdate()
      .execute();
    const actual = await trx
      .selectFrom("expedicao")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (actual.versao !== versao) {
      throw new ErroStock("inventory.version_conflict", "a expedição mudou", {
        versao: actual.versao,
      });
    }
    const saiAgora = dados.estado === "expedida" && actual.estado === "criada";
    await trx
      .updateTable("expedicao")
      .set({
        ...(dados.estado === undefined ? {} : { estado: dados.estado }),
        ...(dados.transportadora === undefined
          ? {}
          : { transportadora: dados.transportadora }),
        ...(dados.servico === undefined ? {} : { servico: dados.servico }),
        ...(dados.seguimento === undefined
          ? {}
          : { seguimento: dados.seguimento }),
        ...(dados.prova_entrega === undefined
          ? {}
          : { prova_entrega: dados.prova_entrega }),
        versao: actual.versao + 1,
      })
      .where("id", "=", id)
      .execute();
    if (saiAgora) await darSaida(trx, c, actual, dados.lotes ?? []);
    if (dados.estado === "expedida" || dados.estado === "entregue") {
      await acertarEstadoDaEncomenda(trx, actual.encomenda_id);
    }
    return actual.versao + 1;
  });
}

/**
 * A saída da expedição (§4.2): por cada folha que controla stock, a reserva
 * passa a saída (físico e reservado baixam juntos), com o lote de cada
 * componente na linha expedida (R5).
 */
async function darSaida(
  trx: Transaction<BaseDados>,
  c: string,
  x: { id: string; encomenda_id: string; armazem_id: string },
  lotesDados: { variante: string; lote: string; quantidade: number }[],
) {
  const linhas = await trx
    .selectFrom("linha_expedicao")
    .innerJoin(
      "linha_encomenda",
      "linha_encomenda.id",
      "linha_expedicao.linha_encomenda_id",
    )
    .select(["linha_encomenda.variante_id", "linha_expedicao.quantidade"])
    .where("linha_expedicao.expedicao_id", "=", x.id)
    .execute();
  const total = new Map<string, number>();
  for (const l of linhas) {
    for (const [v, q] of await folhas(trx, l.variante_id, l.quantidade)) {
      total.set(v, (total.get(v) ?? 0) + q);
    }
  }
  const pol = await politicas(trx, [...total.keys()]);
  for (const [v, q] of [...total.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const p = pol.get(v) ?? {
      politica: "controla" as const,
      exige_lote: false,
    };
    if (p.politica === "nao_controla") continue;
    const partes = p.exige_lote
      ? await lotesParaSaida(trx, x.armazem_id, v, q, lotesDados)
      : [{ lote: null as string | null, quantidade: q }];
    for (const parte of partes) {
      await trx
        .insertInto("movimento_stock")
        .values({
          comerciante_id: c,
          armazem_id: x.armazem_id,
          variante_id: v,
          lote_id: parte.lote,
          tipo: "saida",
          quantidade: parte.quantidade,
          origem: "expedicao",
          encomenda_id: x.encomenda_id,
          expedicao_id: x.id,
        })
        .execute();
    }
  }
}

/** Expedida (parcial ou total) e entregue, pelo estado das expedições. */
async function acertarEstadoDaEncomenda(
  trx: Transaction<BaseDados>,
  encomendaId: string,
) {
  const e = await trx
    .selectFrom("encomenda")
    .select(["estado"])
    .where("id", "=", encomendaId)
    .executeTakeFirstOrThrow();
  const linhas = await trx
    .selectFrom("linha_encomenda")
    .select(["id", "quantidade"])
    .where("encomenda_id", "=", encomendaId)
    .execute();
  const expedicoes = await trx
    .selectFrom("expedicao")
    .select(["id", "estado"])
    .where("encomenda_id", "=", encomendaId)
    .execute();
  const saidas = expedicoes
    .filter((x) => x.estado !== "criada")
    .map((x) => x.id);
  const enviado = new Map<string, number>();
  if (saidas.length > 0) {
    const ls = await trx
      .selectFrom("linha_expedicao")
      .select(["linha_encomenda_id", "quantidade"])
      .where("expedicao_id", "in", saidas)
      .execute();
    for (const l of ls) {
      enviado.set(
        l.linha_encomenda_id,
        (enviado.get(l.linha_encomenda_id) ?? 0) + l.quantidade,
      );
    }
  }
  const tudo = linhas.every((l) => (enviado.get(l.id) ?? 0) >= l.quantidade);
  const algo = linhas.some((l) => (enviado.get(l.id) ?? 0) > 0);
  let novo = e.estado;
  if (
    tudo &&
    (e.estado === "em_preparacao" || e.estado === "expedida_parcial")
  ) {
    novo = "expedida";
  } else if (algo && !tudo && e.estado === "em_preparacao") {
    novo = "expedida_parcial";
  }
  if (novo !== e.estado) {
    await trx
      .updateTable("encomenda")
      .set({ estado: novo })
      .where("id", "=", encomendaId)
      .execute();
  }
  const todasEntregues =
    expedicoes.length > 0 && expedicoes.every((x) => x.estado === "entregue");
  if (novo === "expedida" && todasEntregues) {
    await trx
      .updateTable("encomenda")
      .set({ estado: "entregue" })
      .where("id", "=", encomendaId)
      .execute();
  }
}

export async function transicoesDaEncomenda(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noStock(db, c, (trx) =>
    trx
      .selectFrom("transicao_encomenda")
      .select(["de", "para", "quem", "motivo", "em"])
      .where("encomenda_id", "=", id)
      .orderBy("em")
      .orderBy("id")
      .execute(),
  );
}

// ------------------------------------------------------ Tarefa da conclusão

export const QUEM_DAS_TAREFAS = "sistema:encomendas";

/** Concluídas 14 dias depois de entregues (Q6). */
export async function correrConclusoes(db: Kysely<BaseDados>, porVolta = 50) {
  let concluidas = 0;
  const { rows } = await sql<{
    c: string;
  }>`select encomendas_comerciantes_com_tarefas() as c`.execute(db);
  for (const { c } of rows) {
    await noStock(db, c, async (trx) => {
      const { rows: ids } = await sql<{
        id: string;
      }>`select encomendas_tarefas(${porVolta}) as id`.execute(trx);
      await marcar(trx, QUEM_DAS_TAREFAS, "14 dias depois de entregue");
      for (const { id } of ids) {
        const r = await trx
          .updateTable("encomenda")
          .set({ estado: "concluida" })
          .where("id", "=", id)
          .where("estado", "=", "entregue")
          .executeTakeFirst();
        concluidas += Number(r.numUpdatedRows);
      }
    });
  }
  return concluidas;
}

export function agendarConclusoes(
  base: Kysely<BaseDados>,
  registo: {
    info: (o: object, m: string) => void;
    error: (o: object, m: string) => void;
  },
): () => void {
  let aCorrer = false;
  const t = setInterval(
    () => {
      if (aCorrer) return;
      aCorrer = true;
      correrConclusoes(base)
        .then((n) => {
          if (n > 0) registo.info({ concluidas: n }, "encomendas: concluídas");
        })
        .catch((erro: unknown) => {
          registo.error(
            { erro: erro instanceof Error ? erro.name : "erro" },
            "encomendas: a volta das conclusões falhou",
          );
        })
        .finally(() => {
          aCorrer = false;
        });
    },
    60 * 60 * 1000,
  );
  t.unref();
  return () => {
    clearInterval(t);
  };
}
