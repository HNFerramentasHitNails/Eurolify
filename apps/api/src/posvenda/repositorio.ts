import { sql, type Kysely, type Transaction } from "kysely";
import type {
  BaseDados,
  EstadoArtigoDevolvido,
  EstadoDevolucao,
  TipoProblema,
} from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { armazemDaLoja, folhas, politicas } from "../stock/repositorio.js";
import { ErroPosVenda, traduzir } from "./erros.js";

// A pós-venda (docs/30; migração 0052; issue #328; Diogo, 10/10/2026:
// «aprovado» e «avança»).
//
// 🔴 Devolução = volta mercadoria; problema = não volta; nenhum reembolso
// sem um dos dois (ou o cancelamento, Q7). Só o aceite na inspecção volta a
// stock. Reembolso e nota de crédito são dois registos, ligados.

/**
 * O prazo de livre resolução em dias a contar da entrega, por país de
 * entrega (R3). **C**: 14 por omissão até o jurista validar (`docs/30`, J1).
 */
const DIAS_POR_OMISSAO = 14;
const DIAS_POR_PAIS: Record<string, number> = {};
/** R10: o prazo do reembolso a contar do pedido. **C** (docs/30, J4). */
const DIAS_PARA_REEMBOLSAR = 14;
export const diasDeLivreResolucao = (pais: string | null) =>
  (pais === null ? undefined : DIAS_POR_PAIS[pais]) ?? DIAS_POR_OMISSAO;

export async function noPosVenda<T>(
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

async function marcar(
  trx: Transaction<BaseDados>,
  quem: string,
  motivo: string | null = null,
) {
  await sql`select set_config('eurolify.quem', ${quem}, true),
    set_config('eurolify.motivo', ${motivo ?? ""}, true)`.execute(trx);
}

const naoExiste = (o: string) =>
  new ErroPosVenda("returns.not_found", `${o} não existe`);

async function encomendaDe(trx: Transaction<BaseDados>, id: string) {
  const e = await trx
    .selectFrom("encomenda")
    .select([
      "id",
      "loja_id",
      "estado",
      "finalidade",
      "moeda",
      "total",
      "portes",
      "entrega",
      "contacto",
    ])
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (e === undefined) throw naoExiste("a encomenda");
  return e;
}

// ----------------------------------------------- O que se pode devolver

export interface LinhaDevolvivel {
  linha: string;
  posicao: number;
  sku: string;
  nome: string;
  quantidade: number;
  expedida: number;
  ja_pedida: number;
  disponivel: number;
  entregue_em: string | null;
  prazo_ate: string | null;
  dentro_do_prazo: boolean;
}

/**
 * As linhas que ainda se podem devolver: expedidas (ou entregues), menos as
 * já pedidas em devoluções vivas; o prazo conta-se da entrega (R3, **C**).
 * Uma linha ainda por entregar está dentro do prazo.
 */
export async function linhasDevolviveis(
  trx: Transaction<BaseDados>,
  encomendaId: string,
): Promise<LinhaDevolvivel[]> {
  const e = await trx
    .selectFrom("encomenda")
    .select(["entrega"])
    .where("id", "=", encomendaId)
    .executeTakeFirstOrThrow();
  const dias = diasDeLivreResolucao(
    (e.entrega as { pais?: string } | null)?.pais ?? null,
  );
  const { rows } = await sql<{
    id: string;
    posicao: number;
    sku: string;
    nome: string;
    quantidade: number;
    expedida: number;
    ja_pedida: number;
    entregue_em: string | null;
    prazo_ate: string | null;
    dentro: boolean;
  }>`
    select l.id, l.posicao, l.sku, l.nome, l.quantidade,
      coalesce((select sum(le.quantidade) from linha_expedicao le
                join expedicao x on x.id = le.expedicao_id
                where le.linha_encomenda_id = l.id
                  and x.estado in ('expedida', 'entregue')), 0)::int as expedida,
      coalesce((select sum(ld.pedida) from linha_devolucao ld
                join devolucao d on d.id = ld.devolucao_id
                where ld.linha_encomenda_id = l.id and d.estado <> 'cancelada'), 0)::int
        as ja_pedida,
      to_char(ent.em at time zone 'UTC', 'YYYY-MM-DD') as entregue_em,
      to_char((ent.em at time zone 'UTC')::date + ${dias}::int, 'YYYY-MM-DD') as prazo_ate,
      (ent.em is null or (now() at time zone 'UTC')::date
        <= (ent.em at time zone 'UTC')::date + ${dias}::int) as dentro
    from linha_encomenda l
    left join lateral (
      select max(x.entregue_em) as em from linha_expedicao le
      join expedicao x on x.id = le.expedicao_id
      where le.linha_encomenda_id = l.id and x.estado = 'entregue') ent on true
    where l.encomenda_id = ${encomendaId}::uuid
    order by l.posicao`.execute(trx);
  return rows.map((r) => ({
    linha: r.id,
    posicao: r.posicao,
    sku: r.sku,
    nome: r.nome,
    quantidade: r.quantidade,
    expedida: r.expedida,
    ja_pedida: r.ja_pedida,
    disponivel: Math.max(0, r.expedida - r.ja_pedida),
    entregue_em: r.entregue_em,
    prazo_ate: r.prazo_ate,
    dentro_do_prazo: r.dentro,
  }));
}

function validarLinhas(
  pedidas: { linha: string; quantidade: number }[],
  devolviveis: LinhaDevolvivel[],
) {
  const vistas = new Set<string>();
  for (const p of pedidas) {
    if (vistas.has(p.linha)) {
      throw new ErroPosVenda("returns.invalid_field", "uma linha repetida");
    }
    vistas.add(p.linha);
    const d = devolviveis.find((x) => x.linha === p.linha);
    if (d === undefined) {
      throw new ErroPosVenda(
        "returns.invalid_field",
        "essa linha não é desta encomenda",
      );
    }
    if (p.quantidade > d.disponivel) {
      throw new ErroPosVenda(
        "returns.quantity_exceeded",
        `a linha ${String(d.posicao)} só tem ${String(d.disponivel)} por devolver`,
      );
    }
  }
}

// --------------------------------------------- A livre resolução (§3.1)

export async function lerLivreResolucao(
  db: Kysely<BaseDados>,
  c: string,
  encomendaId: string,
) {
  return noPosVenda(db, c, async (trx) => {
    const e = await encomendaDe(trx, encomendaId);
    return {
      consumidor: e.finalidade === "consumo",
      linhas: (await linhasDevolviveis(trx, encomendaId)).filter(
        (l) => l.disponivel > 0,
      ),
    };
  });
}

/**
 * O pedido de livre resolução (R2): registado sempre (também fora do prazo,
 * que é **C**), com a confirmação de recepção; dentro do prazo abre logo a
 * devolução.
 */
export async function pedirLivreResolucao(
  db: Kysely<BaseDados>,
  c: string,
  encomendaId: string,
  dados: {
    origem: "botao" | "apoio";
    linhas: { linha: string; quantidade: number }[];
  },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, "pedido de livre resolução");
    const e = await encomendaDe(trx, encomendaId);
    // Q1: o botão é dos consumidores; um profissional devolve pelo apoio.
    if (dados.origem === "botao" && e.finalidade !== "consumo") {
      throw new ErroPosVenda(
        "returns.not_consumer",
        "a livre resolução pelo botão é dos consumidores; fale com a loja",
      );
    }
    const devolviveis = await linhasDevolviveis(trx, encomendaId);
    validarLinhas(dados.linhas, devolviveis);
    const escolhidas = devolviveis.filter((d) =>
      dados.linhas.some((l) => l.linha === d.linha),
    );
    const dentro = escolhidas.every((d) => d.dentro_do_prazo);
    const prazos = escolhidas
      .map((d) => d.prazo_ate)
      .filter((p): p is string => p !== null)
      .sort();
    const { rows } = await sql<{
      agora: string;
    }>`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as agora`.execute(
      trx,
    );
    const agora = (rows[0] as { agora: string }).agora;
    const contacto = (e.contacto as { email?: string } | null)?.email ?? "";
    const confirmacao = {
      encomenda: `ord_${e.id}`,
      recebido_em: agora,
      linhas: escolhidas.map((d) => ({
        linha: `oli_${d.linha}`,
        sku: d.sku,
        nome: d.nome,
        quantidade: dados.linhas.find((l) => l.linha === d.linha)?.quantidade,
      })),
      dentro_do_prazo: dentro,
      texto: dentro
        ? "Recebemos o seu pedido de livre resolução."
        : "Recebemos o seu pedido de livre resolução; a loja vai confirmar o prazo e responder-lhe.",
    };
    const { id } = await trx
      .insertInto("pedido_livre_resolucao")
      .values({
        comerciante_id: c,
        encomenda_id: encomendaId,
        origem: dados.origem,
        contacto: contacto === "" ? "sem e-mail" : contacto,
        prazo_ate: prazos[0] ?? null,
        dentro_do_prazo: dentro,
        estado: dentro ? "aceite" : "fora_de_prazo",
        confirmacao: JSON.stringify(confirmacao),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const l of dados.linhas) {
      await trx
        .insertInto("linha_livre_resolucao")
        .values({
          pedido_id: id,
          comerciante_id: c,
          linha_encomenda_id: l.linha,
          quantidade: l.quantidade,
        })
        .execute();
    }
    const devolucao = dentro
      ? await criarDevolucao(
          trx,
          c,
          {
            encomenda: encomendaId,
            origem: "livre_resolucao",
            pedido: id,
            motivo: "livre resolução",
            linhas: dados.linhas,
          },
          quem,
        )
      : null;
    return {
      id,
      estado: dentro ? "aceite" : "fora_de_prazo",
      confirmacao,
      devolucao,
    };
  });
}

/** Fora do prazo, uma pessoa decide: aceitar (abre a devolução) ou recusar. */
export async function decidirLivreResolucao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: { versao: number; decisao: "aceitar" | "recusar"; motivo: string },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo);
    const p = await trx
      .selectFrom("pedido_livre_resolucao")
      .select(["id", "encomenda_id", "estado", "versao"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (p === undefined) throw naoExiste("o pedido");
    if (p.versao !== dados.versao) {
      throw new ErroPosVenda("returns.version_conflict", "o pedido mudou");
    }
    if (p.estado !== "fora_de_prazo") {
      throw new ErroPosVenda(
        "returns.invalid_transition",
        `o pedido está ${p.estado}`,
      );
    }
    await trx
      .updateTable("pedido_livre_resolucao")
      .set({
        estado: dados.decisao === "aceitar" ? "aceite" : "recusado",
        decidido_por: quem,
        motivo_decisao: dados.motivo,
        versao: p.versao + 1,
      })
      .where("id", "=", id)
      .execute();
    if (dados.decisao === "recusar") return { devolucao: null };
    const linhas = await trx
      .selectFrom("linha_livre_resolucao")
      .select(["linha_encomenda_id", "quantidade"])
      .where("pedido_id", "=", id)
      .execute();
    return {
      devolucao: await criarDevolucao(
        trx,
        c,
        {
          encomenda: p.encomenda_id,
          origem: "livre_resolucao",
          pedido: id,
          motivo: "livre resolução aceite fora do prazo",
          linhas: linhas.map((l) => ({
            linha: l.linha_encomenda_id,
            quantidade: l.quantidade,
          })),
        },
        quem,
      ),
    };
  });
}

// --------------------------------------------------- A devolução (§3.2)

export async function criarDevolucao(
  db: Kysely<BaseDados>,
  c: string,
  dados: {
    encomenda: string;
    origem: "livre_resolucao" | "apoio" | "comercial";
    pedido?: string;
    motivo?: string | null;
    linhas: { linha: string; quantidade: number }[];
  },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo ?? null);
    const e = await encomendaDe(trx, dados.encomenda);
    if (dados.origem !== "livre_resolucao") {
      validarLinhas(
        dados.linhas,
        await linhasDevolviveis(trx, dados.encomenda),
      );
    }
    const armazem = await armazemDaLoja(trx, e.loja_id);
    if (armazem === null) {
      throw new ErroPosVenda("returns.no_warehouse", "a loja não tem armazém");
    }
    const { id } = await trx
      .insertInto("devolucao")
      .values({
        comerciante_id: c,
        encomenda_id: dados.encomenda,
        armazem_id: armazem,
        origem: dados.origem,
        pedido_livre_resolucao_id: dados.pedido ?? null,
        motivo: dados.motivo ?? null,
        criada_por: quem,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const l of dados.linhas) {
      await trx
        .insertInto("linha_devolucao")
        .values({
          devolucao_id: id,
          comerciante_id: c,
          linha_encomenda_id: l.linha,
          pedida: l.quantidade,
        })
        .execute();
    }
    return id;
  });
}

async function devolucaoParaMudar(
  trx: Transaction<BaseDados>,
  id: string,
  versao: number,
  estado: string,
) {
  const d = await trx
    .selectFrom("devolucao")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (d === undefined) throw naoExiste("a devolução");
  if (d.versao !== versao) {
    throw new ErroPosVenda("returns.version_conflict", "a devolução mudou", {
      versao: d.versao,
    });
  }
  if (d.estado !== estado) {
    throw new ErroPosVenda(
      "returns.invalid_transition",
      `a devolução está ${d.estado}`,
    );
  }
  return d;
}

/** A recepção: o que chegou, por linha (o que não vier na lista chegou 0). */
export async function receberDevolucao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: {
    versao: number;
    linhas: { linha: string; recebida: number }[];
    transportadora?: string | null;
    seguimento?: string | null;
  },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, "recepção da devolução");
    const d = await devolucaoParaMudar(trx, id, dados.versao, "a_aguardar");
    const linhas = await trx
      .selectFrom("linha_devolucao")
      .select(["linha_encomenda_id", "pedida"])
      .where("devolucao_id", "=", id)
      .execute();
    for (const l of dados.linhas) {
      if (!linhas.some((x) => x.linha_encomenda_id === l.linha)) {
        throw new ErroPosVenda(
          "returns.invalid_field",
          "essa linha não é desta devolução",
        );
      }
    }
    for (const l of linhas) {
      await trx
        .updateTable("linha_devolucao")
        .set({
          recebida:
            dados.linhas.find((x) => x.linha === l.linha_encomenda_id)
              ?.recebida ?? 0,
        })
        .where("devolucao_id", "=", id)
        .where("linha_encomenda_id", "=", l.linha_encomenda_id)
        .execute();
    }
    await trx
      .updateTable("devolucao")
      .set({
        estado: "recebida",
        versao: d.versao + 1,
        ...(dados.transportadora === undefined
          ? {}
          : { transportadora: dados.transportadora }),
        ...(dados.seguimento === undefined
          ? {}
          : { seguimento: dados.seguimento }),
      })
      .where("id", "=", id)
      .execute();
    return d.versao + 1;
  });
}

/**
 * A inspecção (R4, Q5): o estado de cada linha; só o revendável aceite volta
 * a stock, pelo movimento `devolucao`, por componente (a composição
 * congelada na linha) e com o lote da saída original.
 */
export async function inspeccionarDevolucao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: {
    versao: number;
    linhas: {
      linha: string;
      estado_artigo: EstadoArtigoDevolvido;
      aceite: number;
    }[];
  },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, "inspecção da devolução");
    const d = await devolucaoParaMudar(trx, id, dados.versao, "recebida");
    const linhas = await trx
      .selectFrom("linha_devolucao")
      .select(["linha_encomenda_id", "recebida"])
      .where("devolucao_id", "=", id)
      .execute();
    if (
      linhas.length !== dados.linhas.length ||
      !linhas.every((l) =>
        dados.linhas.some((x) => x.linha === l.linha_encomenda_id),
      )
    ) {
      throw new ErroPosVenda(
        "returns.invalid_field",
        "a inspecção diz o estado de todas as linhas da devolução",
      );
    }
    for (const l of dados.linhas) {
      const recebida =
        linhas.find((x) => x.linha_encomenda_id === l.linha)?.recebida ?? 0;
      if (l.aceite > recebida) {
        throw new ErroPosVenda(
          "returns.quantity_exceeded",
          "não se aceita mais do que se recebeu",
        );
      }
      if (l.aceite > 0 && l.estado_artigo !== "revendavel") {
        throw new ErroPosVenda(
          "returns.invalid_field",
          "só o revendável volta a stock (Q5)",
        );
      }
      await trx
        .updateTable("linha_devolucao")
        .set({ estado_artigo: l.estado_artigo, aceite: l.aceite })
        .where("devolucao_id", "=", id)
        .where("linha_encomenda_id", "=", l.linha)
        .execute();
      if (l.aceite > 0) {
        await devolverAoStock(trx, c, d, l.linha, l.aceite);
      }
    }
    await trx
      .updateTable("devolucao")
      .set({ estado: "inspeccionada", versao: d.versao + 1 })
      .where("id", "=", id)
      .execute();
    return d.versao + 1;
  });
}

async function devolverAoStock(
  trx: Transaction<BaseDados>,
  c: string,
  d: { id: string; encomenda_id: string; armazem_id: string },
  linhaId: string,
  aceite: number,
) {
  const linha = await trx
    .selectFrom("linha_encomenda")
    .select(["variante_id"])
    .where("id", "=", linhaId)
    .executeTakeFirstOrThrow();
  const congeladas = await trx
    .selectFrom("linha_encomenda_folha")
    .select(["variante_id", "por_unidade"])
    .where("linha_encomenda_id", "=", linhaId)
    .execute();
  const porFolha =
    congeladas.length > 0
      ? new Map(congeladas.map((k) => [k.variante_id, k.por_unidade]))
      : await folhas(trx, linha.variante_id);
  const pol = await politicas(trx, [...porFolha.keys()]);
  for (const [v, porUnidade] of [...porFolha.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const p = pol.get(v);
    if (p === undefined || p.politica === "nao_controla") continue;
    let falta = porUnidade * aceite;
    if (!p.exige_lote) {
      await movimentoDevolucao(trx, c, d, v, null, falta);
      continue;
    }
    // O lote da saída desta encomenda, pela ordem em que saiu, menos o que
    // dele já voltou.
    const { rows } = await sql<{ lote_id: string; q: number }>`
      select m.lote_id,
        (sum(case m.tipo when 'saida' then m.quantidade else -m.quantidade end))::int as q
      from movimento_stock m
      where m.encomenda_id = ${d.encomenda_id}::uuid and m.variante_id = ${v}::uuid
        and m.tipo in ('saida', 'devolucao') and m.lote_id is not null
      group by m.lote_id
      having sum(case m.tipo when 'saida' then m.quantidade else -m.quantidade end) > 0
      order by min(m.em)`.execute(trx);
    for (const r of rows) {
      if (falta === 0) break;
      const q = Math.min(falta, r.q);
      await movimentoDevolucao(trx, c, d, v, r.lote_id, q);
      falta -= q;
    }
    if (falta > 0) {
      throw new ErroPosVenda(
        "returns.invalid_field",
        "volta mais do que saiu com lote desta encomenda",
      );
    }
  }
}

async function movimentoDevolucao(
  trx: Transaction<BaseDados>,
  c: string,
  d: { id: string; encomenda_id: string; armazem_id: string },
  variante: string,
  lote: string | null,
  quantidade: number,
) {
  await trx
    .insertInto("movimento_stock")
    .values({
      comerciante_id: c,
      armazem_id: d.armazem_id,
      variante_id: variante,
      lote_id: lote,
      tipo: "devolucao",
      quantidade,
      origem: "devolucao",
      encomenda_id: d.encomenda_id,
      devolucao_id: d.id,
      motivo: "devolução aceite na inspecção",
    })
    .execute();
}

export async function cancelarDevolucao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: { versao: number; motivo: string },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo);
    const d = await trx
      .selectFrom("devolucao")
      .select(["estado", "versao"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (d === undefined) throw naoExiste("a devolução");
    if (d.versao !== dados.versao) {
      throw new ErroPosVenda("returns.version_conflict", "a devolução mudou");
    }
    await trx
      .updateTable("devolucao")
      .set({ estado: "cancelada", versao: d.versao + 1 })
      .where("id", "=", id)
      .execute();
    return d.versao + 1;
  });
}

// ----------------------------------------------------- O problema (§3.3)

export async function criarProblema(
  db: Kysely<BaseDados>,
  c: string,
  dados: { encomenda: string; tipo: TipoProblema; descricao: string },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, "problema registado");
    await encomendaDe(trx, dados.encomenda);
    const { id } = await trx
      .insertInto("problema")
      .values({
        comerciante_id: c,
        encomenda_id: dados.encomenda,
        tipo: dados.tipo,
        descricao: dados.descricao,
        criado_por: quem,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
}

// ---------------------------------------------------- O reembolso (§3.4)

interface PedidoReembolso {
  encomenda: string;
  origem: "devolucao" | "problema" | "cancelamento";
  devolucao_id?: string;
  problema_id?: string;
  linhas: { linha: string; quantidade: number }[];
  incluir_portes: boolean;
}

/**
 * Cria o reembolso (R1, R5): o montante de cada linha é o que foi pago por
 * ela na proporção da quantidade, e a última unidade leva o resto (nunca se
 * reembolsa mais nem menos do que se pagou); os portes são linha própria. A
 * base confere tudo ao sair do rascunho. Pede a nota de crédito quando a
 * fatura é do Eurolify (docs/30 §3.5).
 */
async function criarReembolso(
  trx: Transaction<BaseDados>,
  c: string,
  dados: PedidoReembolso,
  quem: string,
) {
  const e = await encomendaDe(trx, dados.encomenda);
  const pagamento = await trx
    .selectFrom("pagamento")
    .select(["id"])
    .where("encomenda_id", "=", dados.encomenda)
    .where("estado", "in", ["capturado", "reembolsado_parcial"])
    .orderBy("id")
    .executeTakeFirst();
  if (pagamento === undefined) {
    throw new ErroPosVenda(
      "refunds.not_refundable",
      "a encomenda não tem um pagamento capturado",
    );
  }
  const linhas: {
    linha: string | null;
    quantidade: number;
    montante: number;
  }[] = [];
  for (const p of dados.linhas) {
    const le = await trx
      .selectFrom("linha_encomenda")
      .select(["id", "quantidade", "total"])
      .where("id", "=", p.linha)
      .where("encomenda_id", "=", dados.encomenda)
      .executeTakeFirst();
    if (le === undefined) {
      throw new ErroPosVenda(
        "refunds.invalid_field",
        "essa linha não é desta encomenda",
      );
    }
    const { rows } = await sql<{ q: number; m: string }>`
      select coalesce(sum(l.quantidade), 0)::int as q, coalesce(sum(l.montante), 0) as m
      from linha_reembolso l join reembolso r on r.id = l.reembolso_id
      where l.linha_encomenda_id = ${p.linha}::uuid
        and r.estado in ('a_executar', 'executado', 'incerto')`.execute(trx);
    const ja = rows[0] ?? { q: 0, m: "0" };
    if (ja.q + p.quantidade > le.quantidade) {
      throw new ErroPosVenda(
        "refunds.exceeds_paid",
        "essa linha já foi reembolsada nessa quantidade",
      );
    }
    const total = Number(le.total);
    const montante =
      ja.q + p.quantidade === le.quantidade
        ? total - Number(ja.m)
        : Math.floor((total * p.quantidade) / le.quantidade);
    if (montante > 0) {
      linhas.push({ linha: p.linha, quantidade: p.quantidade, montante });
    }
  }
  if (dados.incluir_portes) {
    const portes = (e.portes as { total?: number } | null)?.total ?? 0;
    const { rows } = await sql<{ m: string }>`
      select coalesce(sum(l.montante), 0) as m
      from linha_reembolso l join reembolso r on r.id = l.reembolso_id
      where r.encomenda_id = ${dados.encomenda}::uuid and l.linha_encomenda_id is null
        and r.estado in ('a_executar', 'executado', 'incerto')`.execute(trx);
    const resto = portes - Number(rows[0]?.m ?? 0);
    if (resto > 0) linhas.push({ linha: null, quantidade: 1, montante: resto });
  }
  const montante = linhas.reduce((t, l) => t + l.montante, 0);
  if (montante <= 0) {
    throw new ErroPosVenda(
      "refunds.invalid_field",
      "não há nada a reembolsar nessas linhas",
    );
  }
  const { id } = await trx
    .insertInto("reembolso")
    .values({
      comerciante_id: c,
      encomenda_id: dados.encomenda,
      pagamento_id: pagamento.id,
      origem: dados.origem,
      devolucao_id: dados.devolucao_id ?? null,
      problema_id: dados.problema_id ?? null,
      montante,
      moeda: e.moeda,
      via: "manual",
      decidido_por: quem,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  let posicao = 0;
  for (const l of linhas) {
    posicao += 1;
    await trx
      .insertInto("linha_reembolso")
      .values({
        reembolso_id: id,
        comerciante_id: c,
        posicao,
        linha_encomenda_id: l.linha,
        quantidade: l.quantidade,
        montante: l.montante,
      })
      .execute();
  }
  await trx
    .updateTable("reembolso")
    .set({ estado: "a_executar", versao: 2 })
    .where("id", "=", id)
    .execute();
  const { rows: nc } = await sql<{
    id: string | null;
  }>`select nota_credito_pedir(${id}::uuid) as id`.execute(trx);
  return { id, montante, nota_credito: nc[0]?.id ?? null };
}

/** Q3: a devolução reembolsa-se depois de inspeccionada; decide uma pessoa. */
export async function decidirDevolucao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: {
    versao: number;
    linhas: { linha: string; quantidade: number }[];
    incluir_portes: boolean;
    motivo: string;
  },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo);
    const d = await devolucaoParaMudar(trx, id, dados.versao, "inspeccionada");
    const linhas = await trx
      .selectFrom("linha_devolucao")
      .select(["linha_encomenda_id", "recebida"])
      .where("devolucao_id", "=", id)
      .execute();
    for (const l of dados.linhas) {
      const recebida =
        linhas.find((x) => x.linha_encomenda_id === l.linha)?.recebida ?? null;
      if (recebida === null) {
        throw new ErroPosVenda(
          "refunds.invalid_field",
          "essa linha não é desta devolução",
        );
      }
      if (l.quantidade > recebida) {
        throw new ErroPosVenda(
          "refunds.exceeds_paid",
          "não se reembolsa mais do que voltou",
        );
      }
    }
    const r = await criarReembolso(
      trx,
      c,
      {
        encomenda: d.encomenda_id,
        origem: "devolucao",
        devolucao_id: id,
        linhas: dados.linhas,
        incluir_portes: dados.incluir_portes,
      },
      quem,
    );
    await trx
      .updateTable("devolucao")
      .set({ estado: "decidida", versao: d.versao + 1 })
      .where("id", "=", id)
      .execute();
    return r;
  });
}

/** Um problema (sem mercadoria de volta) reembolsa-se logo depois da decisão. */
export async function decidirProblema(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: {
    versao: number;
    linhas: { linha: string; quantidade: number }[];
    incluir_portes: boolean;
    motivo: string;
  },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo);
    const p = await trx
      .selectFrom("problema")
      .select(["id", "encomenda_id", "estado", "versao"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (p === undefined) throw naoExiste("o problema");
    if (p.versao !== dados.versao) {
      throw new ErroPosVenda("returns.version_conflict", "o problema mudou");
    }
    if (p.estado !== "aberto") {
      throw new ErroPosVenda(
        "returns.invalid_transition",
        `o problema está ${p.estado}`,
      );
    }
    const r = await criarReembolso(
      trx,
      c,
      {
        encomenda: p.encomenda_id,
        origem: "problema",
        problema_id: id,
        linhas: dados.linhas,
        incluir_portes: dados.incluir_portes,
      },
      quem,
    );
    await trx
      .updateTable("problema")
      .set({ estado: "decidido", versao: p.versao + 1 })
      .where("id", "=", id)
      .execute();
    return r;
  });
}

/**
 * Q2: o reembolso manual — o comerciante transferiu e regista a prova (data
 * e referência do banco; o IBAN não se guarda). O pagamento passa a
 * reembolsado (parcial ou total) e a origem fecha.
 */
export async function registarReembolsoManual(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: { versao: number; montante: number; data: string; referencia: string },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, "reembolso manual registado");
    const r = await trx
      .selectFrom("reembolso")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (r === undefined) {
      throw new ErroPosVenda("refunds.not_found", "o reembolso não existe");
    }
    if (r.versao !== dados.versao) {
      throw new ErroPosVenda("refunds.version_conflict", "o reembolso mudou", {
        versao: r.versao,
      });
    }
    if (r.estado !== "a_executar" && r.estado !== "falhado") {
      throw new ErroPosVenda(
        "refunds.invalid_transition",
        `o reembolso está ${r.estado}`,
      );
    }
    if (dados.montante !== Number(r.montante)) {
      throw new ErroPosVenda(
        "refunds.invalid_field",
        `o montante transferido tem de ser o do reembolso (${r.montante})`,
      );
    }
    let versao = r.versao;
    if (r.estado === "falhado") {
      await trx
        .updateTable("reembolso")
        .set({ estado: "a_executar", versao: versao + 1 })
        .where("id", "=", id)
        .execute();
      versao += 1;
    }
    await trx
      .updateTable("reembolso")
      .set({
        estado: "executado",
        via: "manual",
        executado_em: new Date(),
        prova: JSON.stringify({
          data: dados.data,
          referencia: dados.referencia,
          quem,
        }),
        versao: versao + 1,
      })
      .where("id", "=", id)
      .execute();
    // O pagamento: reembolsado parcial ou total (a máquina dos pagamentos).
    const p = await trx
      .selectFrom("pagamento")
      .select(["estado", "montante"])
      .where("id", "=", r.pagamento_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const { rows } = await sql<{ m: string }>`
      select coalesce(sum(montante), 0) as m from reembolso
      where pagamento_id = ${r.pagamento_id}::uuid and estado = 'executado'`.execute(
      trx,
    );
    const novo =
      Number(rows[0]?.m ?? 0) >= Number(p.montante)
        ? "reembolsado"
        : "reembolsado_parcial";
    if (novo !== p.estado) {
      await sql`select set_config('eurolify.origem', 'pessoa', true)`.execute(
        trx,
      );
      await trx
        .updateTable("pagamento")
        .set({ estado: novo })
        .where("id", "=", r.pagamento_id)
        .execute();
    }
    if (r.devolucao_id !== null) {
      await trx
        .updateTable("devolucao")
        .set({ estado: "fechada", versao: sql`versao + 1` })
        .where("id", "=", r.devolucao_id)
        .where("estado", "=", "decidida")
        .execute();
    }
    if (r.problema_id !== null) {
      await trx
        .updateTable("problema")
        .set({ estado: "fechado", versao: sql`versao + 1` })
        .where("id", "=", r.problema_id)
        .where("estado", "=", "decidido")
        .execute();
    }
    return versao + 1;
  });
}

/**
 * Q7: cancelar uma encomenda paga ainda não expedida — liberta as reservas
 * (o gatilho), reembolsa tudo (com os portes) e pede a nota de crédito se a
 * fatura é do Eurolify (R11).
 */
export async function cancelarEncomendaPaga(
  db: Kysely<BaseDados>,
  c: string,
  encomendaId: string,
  dados: { motivo: string },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo);
    const e = await encomendaDe(trx, encomendaId);
    if (e.estado !== "paga" && e.estado !== "em_preparacao") {
      throw new ErroPosVenda(
        "returns.invalid_transition",
        `uma encomenda ${e.estado} não se cancela (devolve-se)`,
      );
    }
    await trx
      .updateTable("encomenda")
      .set({ estado: "cancelada" })
      .where("id", "=", encomendaId)
      .execute();
    const linhas = await trx
      .selectFrom("linha_encomenda")
      .select(["id", "quantidade"])
      .where("encomenda_id", "=", encomendaId)
      .execute();
    return criarReembolso(
      trx,
      c,
      {
        encomenda: encomendaId,
        origem: "cancelamento",
        linhas: linhas.map((l) => ({ linha: l.id, quantidade: l.quantidade })),
        incluir_portes: true,
      },
      quem,
    );
  });
}

// ------------------------------------------------------------- Leituras

export async function lerDevolucao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noPosVenda(db, c, async (trx) => {
    const d = await trx
      .selectFrom("devolucao")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (d === undefined) throw naoExiste("a devolução");
    const linhas = await trx
      .selectFrom("linha_devolucao")
      .select([
        "linha_encomenda_id",
        "pedida",
        "recebida",
        "aceite",
        "estado_artigo",
      ])
      .where("devolucao_id", "=", id)
      .execute();
    // R10: o prazo do reembolso conta-se do pedido de livre resolução
    // (**C**, 14 dias até o jurista validar, docs/30 J4).
    const { rows } = await sql<{
      ate: string | null;
      dias: number | null;
    }>`select to_char((p.recebido_em at time zone 'UTC')::date + ${DIAS_PARA_REEMBOLSAR}::int,
        'YYYY-MM-DD') as ate,
      ((p.recebido_em at time zone 'UTC')::date + ${DIAS_PARA_REEMBOLSAR}::int
        - (now() at time zone 'UTC')::date)::int as dias
      from pedido_livre_resolucao p where p.id = ${d.pedido_livre_resolucao_id}::uuid`.execute(
      trx,
    );
    return {
      ...d,
      linhas,
      reembolsar_ate: rows[0]?.ate ?? null,
      dias_para_reembolsar: rows[0]?.dias ?? null,
    };
  });
}

export async function listarDevolucoes(
  db: Kysely<BaseDados>,
  c: string,
  filtro: { estado?: EstadoDevolucao; encomenda?: string },
) {
  return noPosVenda(db, c, (trx) => {
    let q = trx
      .selectFrom("devolucao")
      .select(["id", "encomenda_id", "origem", "estado", "versao", "criada_em"])
      .orderBy("criada_em", "desc")
      .orderBy("id", "desc")
      .limit(200);
    if (filtro.estado !== undefined) q = q.where("estado", "=", filtro.estado);
    if (filtro.encomenda !== undefined) {
      q = q.where("encomenda_id", "=", filtro.encomenda);
    }
    return q.execute();
  });
}

export async function lerPedidoLivreResolucao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noPosVenda(db, c, async (trx) => {
    const p = await trx
      .selectFrom("pedido_livre_resolucao")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (p === undefined) throw naoExiste("o pedido");
    const devolucao = await trx
      .selectFrom("devolucao")
      .select("id")
      .where("pedido_livre_resolucao_id", "=", id)
      .executeTakeFirst();
    const linhas = await trx
      .selectFrom("linha_livre_resolucao")
      .select(["linha_encomenda_id", "quantidade"])
      .where("pedido_id", "=", id)
      .execute();
    return { ...p, linhas, devolucao_id: devolucao?.id ?? null };
  });
}

export async function listarPedidosLivreResolucao(
  db: Kysely<BaseDados>,
  c: string,
  filtro: {
    estado?: "aceite" | "fora_de_prazo" | "recusado";
    encomenda?: string;
  },
) {
  return noPosVenda(db, c, (trx) => {
    let q = trx
      .selectFrom("pedido_livre_resolucao")
      .select([
        "id",
        "encomenda_id",
        "origem",
        "estado",
        "dentro_do_prazo",
        "recebido_em",
        "versao",
      ])
      .orderBy("recebido_em", "desc")
      .orderBy("id", "desc")
      .limit(200);
    if (filtro.estado !== undefined) q = q.where("estado", "=", filtro.estado);
    if (filtro.encomenda !== undefined) {
      q = q.where("encomenda_id", "=", filtro.encomenda);
    }
    return q.execute();
  });
}

export async function lerProblema(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noPosVenda(db, c, async (trx) => {
    const p = await trx
      .selectFrom("problema")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (p === undefined) throw naoExiste("o problema");
    return p;
  });
}

export async function lerReembolso(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noPosVenda(db, c, async (trx) => {
    const r = await trx
      .selectFrom("reembolso")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (r === undefined) {
      throw new ErroPosVenda("refunds.not_found", "o reembolso não existe");
    }
    const linhas = await trx
      .selectFrom("linha_reembolso")
      .select(["posicao", "linha_encomenda_id", "quantidade", "montante"])
      .where("reembolso_id", "=", id)
      .orderBy("posicao")
      .execute();
    const nc = await trx
      .selectFrom("documento_fiscal")
      .select(["id", "estado"])
      .where("reembolso_id", "=", id)
      .executeTakeFirst();
    return { ...r, linhas, nota_credito: nc ?? null };
  });
}

export async function listarReembolsos(
  db: Kysely<BaseDados>,
  c: string,
  filtro: { encomenda?: string },
) {
  return noPosVenda(db, c, (trx) => {
    let q = trx
      .selectFrom("reembolso")
      .select([
        "id",
        "encomenda_id",
        "origem",
        "montante",
        "moeda",
        "via",
        "estado",
        "versao",
        "criado_em",
      ])
      .orderBy("criado_em", "desc")
      .orderBy("id", "desc")
      .limit(200);
    if (filtro.encomenda !== undefined) {
      q = q.where("encomenda_id", "=", filtro.encomenda);
    }
    return q.execute();
  });
}
