import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";

// As vendas do dia e do mês (docs/35; decisão DY; issue #367): quatro números
// — encomendado, pago, faturado e devolvido —, com e sem IVA, por moeda,
// canal e mercado, no fuso do comerciante. Só lê: o IVA vem do que cada
// domínio guardou e nunca se recalcula; o que não se sabe conta-se à parte,
// nunca se estima (§3). Corre numa transacção só de leitura (REPEATABLE
// READ): os quatro números vêem o mesmo momento da base.

/** O período pedido, em datas locais do comerciante: [inicio, fim). */
export interface PedidoDeVendas {
  /** AAAA-MM-DD, o primeiro dia (local). */
  inicio: string;
  /** AAAA-MM-DD, o dia a seguir ao último (local). */
  fim: string;
  canalId?: string;
  mercadoId?: string;
}

export interface Numero {
  comIva: number;
  semIva: number;
  quantidade: number;
  /** Os que não entram no sem IVA (§3): quantos e o com IVA deles. */
  semIvaPorConhecer?: { quantidade: number; comIva: number };
}

export interface Linha {
  moeda: string;
  canalId: string;
  mercadoId: string;
  encomendado: Numero & { dasQuaisCanceladas: Numero };
  pago: Numero;
  faturado: Numero & { creditado: Numero };
  devolvido: Numero;
}

export interface Vendas {
  de: Date;
  ate: Date;
  fuso: string;
  completo: boolean;
  /** O comerciante tem uma entidade que fatura no sistema dele (ADR-0041). */
  sistemaProprio: boolean;
  linhas: Linha[];
}

/** O período começa no futuro (§2): é um pedido inválido, não um zero. */
export class PeriodoNoFuturo extends Error {}

const zero = (): Numero => ({ comIva: 0, semIva: 0, quantidade: 0 });

interface Grupo {
  moeda: string;
  canal_id: string;
  mercado_id: string;
}

type Soma = Grupo & {
  n: string;
  com: string | null;
  sem: string | null;
  n_desc: string;
  com_desc: string | null;
};

const num = (v: string | null | undefined) => Number(v ?? 0);

function numero(r: Soma): Numero {
  const n: Numero = {
    comIva: num(r.com),
    semIva: num(r.sem),
    quantidade: num(r.n),
  };
  if (num(r.n_desc) > 0) {
    n.semIvaPorConhecer = {
      quantidade: num(r.n_desc),
      comIva: num(r.com_desc),
    };
  }
  return n;
}

export function vendas(
  db: Kysely<BaseDados>,
  comercianteId: string,
  pedido: PedidoDeVendas,
): Promise<Vendas> {
  return comComerciante(
    db,
    comercianteId,
    (trx) => vendasNaTransaccao(trx, pedido),
    { soLeitura: true },
  );
}

async function vendasNaTransaccao(
  trx: Transaction<BaseDados>,
  pedido: PedidoDeVendas,
): Promise<Vendas> {
  // O período em instantes, pelo relógio do fuso do comerciante: um dia da
  // mudança de hora tem 23 ou 25 horas (§2).
  const { rows: periodo } = await sql<{
    de: Date;
    ate: Date;
    fuso: string;
    agora: Date;
    sistema_proprio: boolean;
  }>`
    select (${pedido.inicio}::date)::timestamp at time zone c.fuso as de,
           (${pedido.fim}::date)::timestamp at time zone c.fuso as ate,
           c.fuso, now() as agora,
           exists (select 1 from entidade_legal l
                   where l.comerciante_id = c.id
                     and l.emissor_fiscal = 'sistema_proprio') as sistema_proprio
    from comerciante c where c.id = comerciante_actual()`.execute(trx);
  const p = periodo[0];
  if (p === undefined) throw new Error("comerciante sem contexto");
  if (p.de > p.agora) throw new PeriodoNoFuturo();
  const completo = p.ate <= p.agora;
  const de = p.de;
  const ate = completo ? p.ate : p.agora;
  const canal = pedido.canalId ?? null;
  const mercado = pedido.mercadoId ?? null;

  // Encomendado: criadas no período, em qualquer estado (Q2).
  const encomendado = await sql<
    Soma & { nc: string; cc: string | null; cs: string | null }
  >`
    select e.moeda, e.canal_id, e.mercado_id, count(*) as n,
           sum(e.total) as com, sum(e.total_base) as sem,
           0 as n_desc, null as com_desc,
           count(*) filter (where e.estado in ('cancelada', 'cancelada_sem_pagamento')) as nc,
           sum(e.total) filter (where e.estado in ('cancelada', 'cancelada_sem_pagamento')) as cc,
           sum(e.total_base) filter (where e.estado in ('cancelada', 'cancelada_sem_pagamento')) as cs
    from encomenda e
    where e.criada_em >= ${de} and e.criada_em < ${ate}
      and (${canal}::uuid is null or e.canal_id = ${canal}::uuid)
      and (${mercado}::uuid is null or e.mercado_id = ${mercado}::uuid)
    group by 1, 2, 3`.execute(trx);

  // Pago: a primeira captura de cada pagamento caiu no período. O sem IVA é
  // o da encomenda só quando o capturado é igual ao total dela (§3).
  const pago = await sql<Soma>`
    select p.moeda, e.canal_id, e.mercado_id, count(*) as n,
           sum(p.montante) as com,
           sum(e.total_base) filter (where p.montante = e.total and p.moeda = e.moeda) as sem,
           count(*) filter (where p.montante <> e.total or p.moeda <> e.moeda) as n_desc,
           sum(p.montante) filter (where p.montante <> e.total or p.moeda <> e.moeda) as com_desc
    from transicao_pagamento t
    join pagamento p on p.comerciante_id = t.comerciante_id and p.id = t.pagamento_id
    join encomenda e on e.comerciante_id = p.comerciante_id and e.id = p.encomenda_id
    where t.para = 'capturado' and t.em >= ${de} and t.em < ${ate}
      and not exists (select 1 from transicao_pagamento a
                      where a.pagamento_id = t.pagamento_id and a.para = 'capturado'
                        and (a.em, a.id) < (t.em, t.id))
      and (${canal}::uuid is null or e.canal_id = ${canal}::uuid)
      and (${mercado}::uuid is null or e.mercado_id = ${mercado}::uuid)
    group by 1, 2, 3`.execute(trx);

  // Faturado e creditado: a primeira passagem a «emitido» caiu no período;
  // os totais são os da última versão do conteúdo.
  const faturado = await sql<Soma & { tipo: string }>`
    select d.tipo, c.conteudo ->> 'moeda' as moeda, e.canal_id, e.mercado_id,
           count(*) as n,
           sum((c.conteudo -> 'totais' ->> 'total')::bigint) as com,
           sum((c.conteudo -> 'totais' ->> 'base')::bigint) as sem,
           0 as n_desc, null as com_desc
    from documento_rasto r
    join documento_fiscal d on d.comerciante_id = r.comerciante_id and d.id = r.documento_id
    join encomenda e on e.comerciante_id = d.comerciante_id and e.id = d.encomenda_id
    join lateral (select x.conteudo from documento_conteudo x
                  where x.documento_id = d.id order by x.versao desc limit 1) c on true
    where r.passo = 'estado' and r.para = 'emitido' and r.em >= ${de} and r.em < ${ate}
      and not exists (select 1 from documento_rasto a
                      where a.documento_id = r.documento_id and a.passo = 'estado'
                        and a.para = 'emitido' and (a.em, a.id) < (r.em, r.id))
      and (${canal}::uuid is null or e.canal_id = ${canal}::uuid)
      and (${mercado}::uuid is null or e.mercado_id = ${mercado}::uuid)
    group by 1, 2, 3, 4`.execute(trx);

  // Devolvido: reembolsos executados no período; o sem IVA é o da nota de
  // crédito emitida do reembolso, quando a há (§3).
  const devolvido = await sql<Soma>`
    select r.moeda, e.canal_id, e.mercado_id, count(*) as n,
           sum(r.montante) as com,
           sum(nc.base) as sem,
           count(*) filter (where nc.base is null) as n_desc,
           sum(r.montante) filter (where nc.base is null) as com_desc
    from reembolso r
    join encomenda e on e.comerciante_id = r.comerciante_id and e.id = r.encomenda_id
    left join lateral (
      select (x.conteudo -> 'totais' ->> 'base')::bigint as base
      from documento_fiscal n
      join lateral (select y.conteudo from documento_conteudo y
                    where y.documento_id = n.id order by y.versao desc limit 1) x on true
      where n.comerciante_id = r.comerciante_id and n.reembolso_id = r.id
        and n.tipo = 'nota_credito' and n.estado = 'emitido'
    ) nc on true
    where r.estado = 'executado' and r.executado_em >= ${de} and r.executado_em < ${ate}
      and (${canal}::uuid is null or e.canal_id = ${canal}::uuid)
      and (${mercado}::uuid is null or e.mercado_id = ${mercado}::uuid)
    group by 1, 2, 3`.execute(trx);

  const linhas = new Map<string, Linha>();
  const linhaDe = (g: Grupo): Linha => {
    const chave = `${g.moeda}|${g.canal_id}|${g.mercado_id}`;
    let l = linhas.get(chave);
    if (l === undefined) {
      l = {
        moeda: g.moeda,
        canalId: g.canal_id,
        mercadoId: g.mercado_id,
        encomendado: { ...zero(), dasQuaisCanceladas: zero() },
        pago: zero(),
        faturado: { ...zero(), creditado: zero() },
        devolvido: zero(),
      };
      linhas.set(chave, l);
    }
    return l;
  };
  for (const r of encomendado.rows) {
    linhaDe(r).encomendado = {
      ...numero(r),
      dasQuaisCanceladas: {
        comIva: num(r.cc),
        semIva: num(r.cs),
        quantidade: num(r.nc),
      },
    };
  }
  for (const r of pago.rows) linhaDe(r).pago = numero(r);
  for (const r of faturado.rows) {
    const l = linhaDe(r);
    if (r.tipo === "nota_credito") l.faturado.creditado = numero(r);
    else l.faturado = { ...numero(r), creditado: l.faturado.creditado };
  }
  for (const r of devolvido.rows) linhaDe(r).devolvido = numero(r);

  return {
    de,
    ate,
    fuso: p.fuso,
    completo,
    sistemaProprio: p.sistema_proprio,
    linhas: [...linhas.values()].sort((a, b) =>
      `${a.moeda}${a.canalId}${a.mercadoId}`.localeCompare(
        `${b.moeda}${b.canalId}${b.mercadoId}`,
      ),
    ),
  };
}
