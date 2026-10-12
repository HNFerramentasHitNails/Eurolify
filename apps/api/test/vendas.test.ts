import { randomBytes, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  criarEntidadeLegal,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import { periodoDe } from "../src/vendas/rotas.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// As vendas do dia e do mês (docs/35; migração 0068; decisão DY; #367).
//
// Os dados entram directamente na base, como superutilizador e com os
// gatilhos de negócio desligados (`session_replication_role = replica`):
// só assim se marcam as horas exactas (a fronteira do dia, a mudança de
// hora), que pelo checkout seriam sempre a hora real. A consulta e a rota
// correm depois como a API, com o RLS. Os gatilhos «ALWAYS» das tabelas
// preparadas também se desligam, só nessa transacção, e voltam ao estado
// que tinham. Por isso estes testes não provam os nomes que os domínios
// escrevem: estão conferidos nas migrações 0044, 0050 e 0058 (revisão do
// #383, P2-3).

type Json = Record<string, unknown>;
interface NumeroR {
  com_iva: number;
  sem_iva: number;
  quantidade: number;
  sem_iva_por_conhecer?: { quantidade: number; com_iva: number };
}

const C1 = randomUUID();
const C2 = randomUUID();
const M_PT = randomUUID();
const M_ES = randomUUID();

describe.skipIf(URL_BASE === undefined)("vendas do dia e do mês", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let b: string;
  let segredo: string;
  let semAmbito: string;
  let segredoB: string;

  /**
   * Insere como superutilizador, em modo réplica (os gatilhos normais não
   * correm) e com os gatilhos «ALWAYS» das tabelas dadas desligados só nesta
   * transacção: cada um volta ao estado que tinha (o rasto que só se
   * acrescenta continua a proteger as linhas depois).
   */
  async function preparar<T>(
    tabelas: string[],
    fn: (trx: Transaction<unknown>) => Promise<T>,
  ) {
    return base.dono.transaction().execute(async (trx) => {
      await sql`set local session_replication_role = replica`.execute(trx);
      const { rows } = await sql<{ tabela: string; nome: string }>`
        select c.relname as tabela, t.tgname as nome from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and t.tgenabled = 'A'
          and c.relname = any(${tabelas}::text[])`.execute(trx);
      for (const g of rows) {
        await sql`alter table ${sql.id(g.tabela)} disable trigger ${sql.id(g.nome)}`.execute(
          trx,
        );
      }
      const r = await fn(trx);
      for (const g of rows) {
        await sql`alter table ${sql.id(g.tabela)} enable always trigger ${sql.id(g.nome)}`.execute(
          trx,
        );
      }
      return r;
    });
  }

  async function encomenda(
    c: string,
    o: {
      em: string;
      total: number;
      base: number;
      moeda?: string;
      canal?: string;
      mercado?: string;
      estado?: string;
      emissor?: string;
    },
  ): Promise<string> {
    const id = randomUUID();
    // A consulta não lê as linhas: a encomenda entra sem elas.
    await preparar(["encomenda"], async (trx) => {
      await sql`insert into encomenda (id, comerciante_id, loja_id, canal_id, mercado_id,
          entidade_legal_id, sessao_id, cliente_id, perfil_id, perfil_copia, contacto,
          entrega, finalidade, moeda, preco_inclui_iva, lingua, total_base, total_iva,
          total, portes, metodo_entrega, metodo_pagamento, aceitacoes, criada_por,
          estado, criada_em, emissor_fiscal)
        values (${id}::uuid, ${c}::uuid, gen_random_uuid(), ${o.canal ?? C1}::uuid,
          ${o.mercado ?? M_PT}::uuid, gen_random_uuid(), gen_random_uuid(),
          gen_random_uuid(), gen_random_uuid(), '{}', '{}', '{}', 'consumo',
          ${o.moeda ?? "EUR"}, true, 'pt', ${o.base}, ${o.total - o.base}, ${o.total},
          '{}', '{}', 'mb_way', '{}', 'teste:vendas', ${o.estado ?? "a_aguardar_pagamento"},
          ${o.em}::timestamptz, ${o.emissor ?? "eurolify"})`.execute(trx);
    });
    return id;
  }

  async function capturado(
    c: string,
    enc: string,
    montante: number,
    em: string,
    moeda = "EUR",
  ): Promise<string> {
    const id = randomUUID();
    await preparar(["pagamento", "transicao_pagamento"], async (trx) => {
      await sql`insert into pagamento (id, comerciante_id, encomenda_id, conta_id,
          prestador, metodo, modo, montante, moeda, referencia, expira_em, estado)
        values (${id}::uuid, ${c}::uuid, ${enc}::uuid, gen_random_uuid(), 'eupago',
          'mb_way', 'teste', ${montante}, ${moeda},
          ${randomBytes(16).toString("hex")}, now(), 'capturado')`.execute(trx);
      await sql`insert into transicao_pagamento (comerciante_id, pagamento_id, de,
          para, origem, quem, em)
        values (${c}::uuid, ${id}::uuid, 'autorizado', 'capturado', 'aviso',
          'prestador:eupago', ${em}::timestamptz)`.execute(trx);
    });
    return id;
  }

  async function documento(
    c: string,
    enc: string,
    o: {
      em: string;
      total: number;
      base: number;
      tipo?: "fatura" | "nota_credito";
      reembolso?: string;
      original?: string;
      moeda?: string;
      estado?: string;
      /** O que o emissor devolveu; por omissão, o mesmo que se pediu. */
      prova?: { total: number; base: number };
    },
  ): Promise<string> {
    const id = randomUUID();
    await preparar(
      [
        "documento_fiscal",
        "documento_conteudo",
        "documento_rasto",
        "documento_prova",
      ],
      async (trx) => {
        await sql`insert into documento_fiscal (id, comerciante_id, encomenda_id,
          entidade_legal_id, modo, tipo, estado, reembolso_id, original_id)
        values (${id}::uuid, ${c}::uuid, ${enc}::uuid, gen_random_uuid(), 'teste',
          ${o.tipo ?? "fatura"}, ${o.estado ?? "emitido"}, ${o.reembolso ?? null}::uuid,
          ${o.original ?? null}::uuid)`.execute(trx);
        const conteudo = {
          moeda: o.moeda ?? "EUR",
          linhas: [],
          totais: { base: o.base, iva: o.total - o.base, total: o.total },
        };
        await sql`insert into documento_conteudo (documento_id, comerciante_id, versao,
          conteudo, impressao, motivo, quem)
        values (${id}::uuid, ${c}::uuid, 1, ${JSON.stringify(conteudo)}::jsonb,
          ${"0".repeat(64)}, 'teste', 'teste:vendas')`.execute(trx);
        const prova = o.prova ?? { total: o.total, base: o.base };
        await sql`insert into documento_prova (documento_id, comerciante_id, numero,
          linhas, totais, em_bruto)
        values (${id}::uuid, ${c}::uuid, ${`FT ${id.slice(0, 8)}`}, '[]',
          ${JSON.stringify({ base: prova.base, iva: prova.total - prova.base, total: prova.total })}::jsonb,
          '{}')`.execute(trx);
        await sql`insert into documento_rasto (documento_id, comerciante_id, passo,
          de, para, quem, em)
        values (${id}::uuid, ${c}::uuid, 'estado', 'pronto', 'emitido',
          'sistema:documentos', ${o.em}::timestamptz)`.execute(trx);
      },
    );
    return id;
  }

  async function reembolso(
    c: string,
    enc: string,
    pag: string,
    montante: number,
    em: string,
  ): Promise<string> {
    const id = randomUUID();
    await preparar(["reembolso"], (trx) =>
      sql`insert into reembolso (id, comerciante_id, encomenda_id, pagamento_id,
          origem, problema_id, montante, moeda, estado, executado_em, via, decidido_por,
          referencia_prestador)
        values (${id}::uuid, ${c}::uuid, ${enc}::uuid, ${pag}::uuid, 'problema',
          gen_random_uuid(), ${montante}, 'EUR', 'executado', ${em}::timestamptz,
          'prestador', 'pessoa:teste', 'ref-teste')`.execute(trx),
    );
    return id;
  }

  const pedir = (url: string, chave = segredo) =>
    app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${chave}` },
    });

  async function resumo(consulta: string, chave = segredo) {
    const r = await pedir(`/sales/summary?${consulta}`, chave);
    expect(r.statusCode, r.body).toBe(200);
    return r.json<{
      periodo: { de: string; ate: string; fuso: string; completo: boolean };
      moedas: {
        moeda: string;
        total: Record<string, NumeroR & Json>;
        por_canal_e_mercado: (Record<string, NumeroR & Json> & {
          canal: string;
          mercado: string;
        })[];
      }[];
    }>();
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    app = criarApp({ logger: false }, undefined, base.api);
    const novo = { nome: "Loja", lingua: "pt", fuso: "Europe/Lisbon" };
    a = await registarComerciante(base.api, novo);
    b = await registarComerciante(base.api, novo);
    const dono = base.dono;
    const servidor = { tipo: "servidor" as const, criadaPor: "operador:teste" };
    segredo = (
      await criarChave(dono, a, {
        ...servidor,
        nome: "Vendas",
        ambitos: ["sales:read"],
      })
    ).segredo;
    semAmbito = (
      await criarChave(dono, a, {
        ...servidor,
        nome: "Encomendas",
        ambitos: [
          "orders:read",
          "payments:read",
          "invoices:read",
          "refunds:read",
        ],
      })
    ).segredo;
    segredoB = (
      await criarChave(dono, b, {
        ...servidor,
        nome: "Vendas B",
        ambitos: ["sales:read"],
      })
    ).segredo;

    // O dia 05/10/2026 em Lisboa (UTC+1): de 04/10 23:00Z a 05/10 23:00Z.
    const paga = await encomenda(a, {
      em: "2026-10-05T10:00:00+01:00",
      total: 12300,
      base: 10000,
    });
    await encomenda(a, {
      em: "2026-10-05T23:30:00+01:00",
      total: 615,
      base: 500,
      estado: "cancelada_sem_pagamento",
    });
    // 00:30 de 06/10 em Lisboa: fica fora do dia 5.
    await encomenda(a, {
      em: "2026-10-05T23:30:00Z",
      total: 1000,
      base: 813,
    });
    // Espanha, outro canal.
    await encomenda(a, {
      em: "2026-10-05T12:00:00+01:00",
      total: 2420,
      base: 2000,
      canal: C2,
      mercado: M_ES,
    });
    // Outra moeda: nunca se soma.
    await encomenda(a, {
      em: "2026-10-05T12:00:00+01:00",
      total: 5000,
      base: 4065,
      moeda: "PLN",
      mercado: M_ES,
    });
    // Paga no dia 6: encomendada no 5, paga no 6.
    const pag = await capturado(a, paga, 12300, "2026-10-06T09:00:00+01:00");
    // O emissor devolveu 12301 (arredondou de outra forma): a fatura fica
    // divergente, e conta o que saiu, a prova (revisão do #383, P1-1).
    const fatura = await documento(a, paga, {
      em: "2026-10-06T09:05:00+01:00",
      total: 12300,
      base: 10000,
      estado: "divergente",
      prova: { total: 12301, base: 10001 },
    });
    // Um reembolso com nota de crédito e outro sem.
    const r1 = await reembolso(a, paga, pag, 2460, "2026-10-06T15:00:00+01:00");
    await documento(a, paga, {
      em: "2026-10-06T15:10:00+01:00",
      total: 2460,
      base: 2000,
      tipo: "nota_credito",
      reembolso: r1,
      original: fatura,
      // Divergente também saiu: o reembolso tem sem IVA (P2-2).
      estado: "divergente",
    });
    await reembolso(a, paga, pag, 1230, "2026-10-06T16:00:00+01:00");
    // Dois pagamentos capturados da mesma encomenda (um expirou e chegou
    // depois): a base da venda conta uma vez (revisão do #383, P2-1).
    const outra = await encomenda(a, {
      em: "2026-10-06T08:00:00+01:00",
      total: 3000,
      base: 2439,
    });
    await capturado(a, outra, 3000, "2026-10-06T08:10:00+01:00");
    await capturado(a, outra, 3000, "2026-10-06T08:20:00+01:00");
    // Encomendas nos dias da mudança de hora, em Lisboa: 23:30 locais de
    // 26/10/2025 (já UTC+0) e de 29/03/2026 (já UTC+1) ficam no dia; a 00:30
    // seguinte não.
    await encomenda(a, { em: "2025-10-26T23:30:00Z", total: 100, base: 81 });
    await encomenda(a, { em: "2025-10-27T00:30:00Z", total: 100, base: 81 });
    await encomenda(a, { em: "2026-03-29T22:30:00Z", total: 100, base: 81 });
    await encomenda(a, { em: "2026-03-29T23:30:00Z", total: 100, base: 81 });
    // O comerciante B: nunca aparece nos números de A.
    await encomenda(b, {
      em: "2026-10-05T10:00:00+01:00",
      total: 99900,
      base: 81220,
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("o período: um dia, um mês, e as recusas", () => {
    expect(periodoDe({ dia: "2026-10-05" })).toEqual({
      inicio: "2026-10-05",
      fim: "2026-10-06",
    });
    expect(periodoDe({ mes: "2026-12" })).toEqual({
      inicio: "2026-12-01",
      fim: "2027-01-01",
    });
    expect(() => periodoDe({})).toThrow(/dia.*mes/);
    expect(() => periodoDe({ dia: "2026-10-05", mes: "2026-10" })).toThrow();
    expect(() => periodoDe({ dia: "2026-02-30" })).toThrow(/inválida/);
  });

  it("o dia de ontem: encomendado no fuso do comerciante, por canal e mercado, sem somar moedas", async () => {
    const r = await resumo("dia=2026-10-05");
    expect(r.periodo).toEqual({
      de: "2026-10-04T23:00:00.000Z",
      ate: "2026-10-05T23:00:00.000Z",
      fuso: "Europe/Lisbon",
      completo: true,
    });
    expect(r.moedas.map((m) => m.moeda)).toEqual(["EUR", "PLN"]);
    const eur = r.moedas[0];
    // 12300 + 615 (cancelada) + 2420 (Espanha); as 00:30 de 06/10 ficam fora.
    expect(eur?.total["encomendado"]).toMatchObject({
      com_iva: 15335,
      sem_iva: 12500,
      quantidade: 3,
      das_quais_canceladas: { com_iva: 615, sem_iva: 500, quantidade: 1 },
    });
    expect(eur?.total["pago"]).toMatchObject({ com_iva: 0, quantidade: 0 });
    expect(eur?.por_canal_e_mercado).toHaveLength(2);
    const espanha = eur?.por_canal_e_mercado.find(
      (l) => l.mercado === `mkt_${M_ES}`,
    );
    expect(espanha).toMatchObject({
      canal: `chn_${C2}`,
      encomendado: { com_iva: 2420, sem_iva: 2000, quantidade: 1 },
    });
    expect(r.moedas[1]?.total["encomendado"]).toMatchObject({
      com_iva: 5000,
      quantidade: 1,
    });
    const frase = (eur?.total["encomendado"] as Json)["o_que_conta"] as Json;
    expect(frase["pt"]).toContain("entre 05/10/2026 00:00 e 06/10/2026 00:00");
    expect(frase["pt"]).toContain("Europe/Lisbon");
  });

  it("o dia seguinte: pago, faturado, creditado e devolvido; o que não se sabe fica à parte", async () => {
    const r = await resumo("dia=2026-10-06");
    expect(r.periodo.completo).toBe(true);
    const t = r.moedas.find((m) => m.moeda === "EUR")?.total;
    // 12300 (sem IVA 10000) + 3000 (2439) + o duplicado de 3000, por conhecer.
    expect(t?.["pago"]).toMatchObject({
      com_iva: 18300,
      sem_iva: 12439,
      quantidade: 3,
      sem_iva_por_conhecer: { quantidade: 1, com_iva: 3000 },
    });
    // A prova, não o pedido.
    expect(t?.["faturado"]).toMatchObject({
      com_iva: 12301,
      sem_iva: 10001,
      quantidade: 1,
      creditado: { com_iva: 2460, sem_iva: 2000, quantidade: 1 },
    });
    expect(t?.["devolvido"]).toMatchObject({
      com_iva: 3690,
      sem_iva: 2000,
      quantidade: 2,
      sem_iva_por_conhecer: { quantidade: 1, com_iva: 1230 },
    });
  });

  it("o dia de hoje ainda não acabou: vai até agora e diz que não está completo", async () => {
    const hoje = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon",
    }).format(new Date());
    const antes = Date.now();
    const r = await resumo(`dia=${hoje}`);
    expect(r.periodo.completo).toBe(false);
    const ate = new Date(r.periodo.ate).getTime();
    expect(ate).toBeGreaterThanOrEqual(antes - 5_000);
    expect(ate).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("o mês junta os dias; o filtro do mercado só deixa o mercado", async () => {
    const r = await resumo("mes=2026-10");
    const t = r.moedas.find((m) => m.moeda === "EUR")?.total;
    expect(t?.["encomendado"]).toMatchObject({ quantidade: 5 });
    const es = await resumo(`mes=2026-10&mercado=mkt_${M_ES}`);
    expect(es.moedas.map((m) => m.moeda)).toEqual(["EUR", "PLN"]);
    expect(
      es.moedas.find((m) => m.moeda === "EUR")?.total["encomendado"],
    ).toMatchObject({ com_iva: 2420, quantidade: 1 });
  });

  it("o dia da mudança de hora tem 25 horas, e o da mudança de Março 23", async () => {
    const outubro = await resumo("dia=2025-10-26");
    expect(outubro.periodo.de).toBe("2025-10-25T23:00:00.000Z");
    expect(outubro.periodo.ate).toBe("2025-10-27T00:00:00.000Z");
    const marco = await resumo("dia=2026-03-29");
    expect(marco.periodo.de).toBe("2026-03-29T00:00:00.000Z");
    expect(marco.periodo.ate).toBe("2026-03-29T23:00:00.000Z");
    for (const r of [outubro, marco]) {
      expect(r.moedas[0]?.total["encomendado"]).toMatchObject({
        com_iva: 100,
        quantidade: 1,
      });
    }
  });

  it("o filtro do canal só deixa o canal", async () => {
    const r = await resumo(`dia=2026-10-05&canal=chn_${C2}`);
    expect(r.moedas).toHaveLength(1);
    expect(r.moedas[0]?.por_canal_e_mercado.map((l) => l.canal)).toEqual([
      `chn_${C2}`,
    ]);
    expect(r.moedas[0]?.total["encomendado"]).toMatchObject({
      com_iva: 2420,
      quantidade: 1,
    });
  });

  it("um ano fora de 1970–9998 dá 400, não 500", async () => {
    for (const q of ["dia=0000-01-01", "mes=9999-12", "dia=1969-12-31"]) {
      const r = await pedir(`/sales/summary?${q}`);
      expect(r.statusCode, q).toBe(400);
    }
  });

  it("um comerciante nunca vê as vendas de outro", async () => {
    const rb = await resumo("dia=2026-10-05", segredoB);
    expect(rb.moedas).toHaveLength(1);
    expect(rb.moedas[0]?.total["encomendado"]).toMatchObject({
      com_iva: 99900,
      quantidade: 1,
    });
    const ra = await resumo("dia=2026-10-05");
    expect(JSON.stringify(ra)).not.toContain("99900");
  });

  it("sem o âmbito sales:read, 403 — mesmo com os de encomendas, pagamentos, faturas e reembolsos", async () => {
    const r = await pedir("/sales/summary?dia=2026-10-05", semAmbito);
    expect(r.statusCode).toBe(403);
  });

  it("recusa o período no futuro, os dois juntos e nenhum", async () => {
    for (const q of ["dia=2099-01-01", "dia=2026-10-05&mes=2026-10", ""]) {
      const r = await pedir(`/sales/summary?${q}`);
      expect(r.statusCode, q).toBe(400);
      expect(r.json<{ codigo: string }>().codigo).toBe("request.invalid");
    }
  });

  it("um comerciante com sistema próprio fica avisado no faturado", async () => {
    const c = await registarComerciante(base.api, {
      nome: "Com sistema",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const entidade = await criarEntidadeLegal(base.api, c, {
      denominacao: "Com Sistema, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "509999990",
      morada_linha: "Rua 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
    await preparar(["entidade_legal"], (trx) =>
      sql`update entidade_legal set emissor_fiscal = 'sistema_proprio'
        where id = ${entidade}::uuid`.execute(trx),
    );
    const chave = (
      await criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "V",
        ambitos: ["sales:read"],
      })
    ).segredo;
    await encomenda(c, {
      em: "2026-10-05T10:00:00+01:00",
      total: 100,
      base: 81,
      emissor: "sistema_proprio",
    });
    const r = await resumo("dia=2026-10-05", chave);
    const frase = (r.moedas[0]?.total["faturado"] as Json)[
      "o_que_conta"
    ] as Json;
    expect(frase["pt"]).toContain("sistema próprio");
  });

  it("no Hub: o dono e o gestor vêem; o apoio e o armazém não", async () => {
    const h = hubDeTeste(base);
    try {
      for (const [papel, estado] of [
        ["dono", 200],
        ["gestor", 200],
        ["apoio", 403],
        ["armazem", 403],
      ] as const) {
        const p = await h.pessoaCom(a, papel);
        const r = await h.pedir("GET", "/hub/sales/summary?dia=2026-10-05", {
          sessao: p.sessao,
          comerciante: a,
        });
        expect(r.statusCode, `${papel}: ${r.body}`).toBe(estado);
      }
    } finally {
      await h.app.close();
    }
  });
});
