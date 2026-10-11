import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import type { Ambito } from "../src/identidade/chaves.js";
import { FILAS } from "../src/tarefas/filas.js";
import { correrAvisosDeTarefas } from "../src/tarefas/avisos.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// As tarefas das filas que pedem uma pessoa (docs/33; migração 0066;
// decisão DW). Os casos de cada fila entram pela base em modo `replica` (sem
// os gatilhos dos domínios, que não deixam escolher datas): o que se testa
// aqui é a lista, a atribuição, o prazo e o aviso, não o percurso de cada
// domínio, que tem os seus testes.

type Json = Record<string, unknown>;
interface Tarefa {
  fila: string;
  caso: string;
  motivo: string;
  responsavel: string | null;
  prazo: string;
  prazo_definido: boolean;
  prazo_legal: string | null;
  vencida: boolean;
  aviso_vencido_em: string | null;
  versao: number;
  encomenda: string | null;
}
interface Lista {
  dados: Tarefa[];
  filas: string[];
  totais: Record<string, number>;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}

const LER: Ambito[] = [
  "payments:read",
  "invoices:read",
  "customers:read",
  "returns:read",
  "refunds:read",
];
const DECIDIR: Ambito[] = [
  "payments:resolve",
  "invoices:write",
  "customers:merge",
  "returns:write",
  "refunds:write",
];

describe.skipIf(URL_BASE === undefined)("API das tarefas das filas", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a = "";
  let b = "";
  const pessoas = {
    dono: randomUUID(),
    gestor: randomUUID(),
    armazem: randomUUID(),
    gestor2: randomUUID(),
    deB: randomUUID(),
  };
  const membros: Record<string, string> = {};
  const chaves: Record<string, string> = {};
  const casos = {
    diferenca: randomUUID(),
    documento: randomUUID(),
    duplicado: randomUUID(),
    pendente: randomUUID(),
    foraDePrazo: randomUUID(),
    aceite: randomUUID(),
    devolucao: randomUUID(),
    problema: randomUUID(),
    reembolso: randomUUID(),
    diferencaDeB: randomUUID(),
    // Já decididos: nunca aparecem.
    resolvida: randomUUID(),
    emitido: randomUUID(),
    decidido: randomUUID(),
  };
  const encomenda = randomUUID();

  /** Escreve como o dono das tabelas, sem os gatilhos dos domínios. */
  const comoDono = (fn: (t: Transaction<unknown>) => Promise<unknown>) =>
    base.dono.transaction().execute(async (trx) => {
      await sql`set local session_replication_role = replica`.execute(trx);
      // Os gatilhos ALWAYS correm mesmo em replica (e pedem a encomenda e o
      // armazém verdadeiros): desligam-se só nesta transacção e repõem-se
      // como estavam antes do fim dela.
      const sempre = (
        await sql<{ tabela: string; nome: string }>`
          select c.relname as tabela, t.tgname as nome from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and t.tgenabled = 'A'
            and c.relname in ('documento_fiscal', 'pedido_livre_resolucao', 'devolucao',
                              'problema', 'reembolso', 'duplicado_cliente',
                              'diferenca_pagamento', 'pessoa', 'membro')`.execute(
          trx,
        )
      ).rows;
      for (const g of sempre) {
        await sql`alter table ${sql.id(g.tabela)} disable trigger ${sql.id(g.nome)}`.execute(
          trx,
        );
      }
      await fn(trx);
      for (const g of sempre) {
        await sql`alter table ${sql.id(g.tabela)} enable always trigger ${sql.id(g.nome)}`.execute(
          trx,
        );
      }
    });

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    app = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      undefined,
      undefined,
      { pedidos: 100_000, janelaMs: 60_000 },
    );
    a = await registarComerciante(base.api, {
      nome: "Loja A",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    b = await registarComerciante(base.api, {
      nome: "Loja B",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const equipa: [string, string, string][] = [
      [pessoas.dono, a, "dono"],
      [pessoas.gestor, a, "gestor"],
      [pessoas.armazem, a, "armazem"],
      [pessoas.gestor2, a, "gestor"],
      [pessoas.deB, b, "dono"],
    ];
    await comoDono(async (t) => {
      for (const [p, c, papel] of equipa) {
        await sql`insert into pessoa (id, email, nome)
          values (${p}, ${`${p}@exemplo.pt`}, 'Pessoa')`.execute(t);
        const m = randomUUID();
        membros[p] = m;
        await sql`insert into membro (id, comerciante_id, pessoa_id, papel, convidado_por)
          values (${m}, ${c}, ${p}, ${papel}, 'operador:teste')`.execute(t);
      }
      // As sete filas do comerciante A, mais uma diferença no B.
      await sql`insert into diferenca_pagamento (id, comerciante_id, motivo, criada_em)
        values (${casos.diferenca}, ${a}, 'incerto', now() - interval '2 days'),
               (${casos.diferencaDeB}, ${b}, 'incerto', now() - interval '2 days')`.execute(
        t,
      );
      await sql`insert into diferenca_pagamento (id, comerciante_id, motivo, estado,
          resolucao, resolvida_por, resolvida_em, criada_em)
        values (${casos.resolvida}, ${a}, 'incerto', 'resolvida', 'visto no prestador',
          'pessoa:per_teste', now(), now() - interval '5 days')`.execute(t);
      await sql`insert into documento_fiscal (id, comerciante_id, encomenda_id,
          entidade_legal_id, modo, estado, criado_em)
        values (${casos.emitido}, ${a}, ${randomUUID()}, ${randomUUID()}, 'teste',
          'emitido', now() - interval '5 days')`.execute(t);
      await sql`insert into problema (id, comerciante_id, encomenda_id, tipo, descricao,
          estado, criado_por)
        values (${casos.decidido}, ${a}, ${encomenda}, 'atraso', 'chegou tarde',
          'decidido', 'teste')`.execute(t);
      await sql`insert into documento_fiscal (id, comerciante_id, encomenda_id,
          entidade_legal_id, modo, estado, motivos, criado_em, na_fila_desde)
        values (${casos.documento}, ${a}, ${encomenda}, ${randomUUID()}, 'teste',
          'retido', '{emissor_por_configurar}', now() - interval '1 hour',
          now() - interval '1 hour')`.execute(t);
      const [x, y] = [randomUUID(), randomUUID()].sort();
      await sql`insert into duplicado_cliente (id, comerciante_id, cliente_a, cliente_b,
          sinais, estado, criado_em, actualizado_em, por_decidir_desde)
        values (${casos.duplicado}, ${a}, ${x}, ${y}, '{email}', 'por_decidir',
          now() - interval '8 days', now() - interval '8 days',
          now() - interval '8 days')`.execute(t);
      await sql`insert into pedido_livre_resolucao (id, comerciante_id, encomenda_id,
          origem, contacto, recebido_em, dentro_do_prazo, estado, confirmacao)
        values
          (${casos.pendente}, ${a}, ${encomenda}, 'botao', 'x@exemplo.pt',
            now() - interval '1 day', true, 'pendente', '{}'),
          (${casos.foraDePrazo}, ${a}, ${encomenda}, 'botao', 'x@exemplo.pt',
            now() - interval '3 days', false, 'fora_de_prazo', '{}'),
          (${casos.aceite}, ${a}, ${encomenda}, 'botao', 'x@exemplo.pt',
            now() - interval '20 days', true, 'aceite', '{}')`.execute(t);
      await sql`insert into devolucao (id, comerciante_id, encomenda_id, armazem_id,
          origem, pedido_livre_resolucao_id, estado, criada_por, criada_em)
        values (${casos.devolucao}, ${a}, ${encomenda}, ${randomUUID()},
          'livre_resolucao', ${casos.aceite}, 'a_aguardar', 'teste',
          now() - interval '20 days')`.execute(t);
      await sql`insert into problema (id, comerciante_id, encomenda_id, tipo, descricao,
          estado, criado_por)
        values (${casos.problema}, ${a}, ${encomenda}, 'chegou_danificado',
          'partido', 'aberto', 'teste')`.execute(t);
      await sql`insert into reembolso (id, comerciante_id, encomenda_id, pagamento_id,
          origem, problema_id, montante, moeda, estado, decidido_por, criado_em,
          na_fila_desde)
        values (${casos.reembolso}, ${a}, ${encomenda}, ${randomUUID()}, 'problema',
          ${casos.problema}, 1230, 'EUR', 'incerto', 'teste', now() - interval '2 hours',
          now() - interval '2 hours')`.execute(t);
    });
    const chave = async (c: string, nome: string, ambitos: Ambito[]) =>
      (
        await criarChave(base.dono, c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome,
          ambitos,
        })
      ).segredo;
    chaves["tudo"] = await chave(a, "Tudo", [
      ...LER,
      ...DECIDIR,
      "tasks:assign",
    ]);
    chaves["semAtribuir"] = await chave(a, "Sem atribuir", [
      ...LER,
      ...DECIDIR,
    ]);
    chaves["leitura"] = await chave(a, "Leitura", LER);
    chaves["clientes"] = await chave(a, "Clientes", ["customers:read"]);
    chaves["nada"] = await chave(a, "Nada", ["catalog:read"]);
    chaves["deB"] = await chave(b, "Tudo B", [
      ...LER,
      ...DECIDIR,
      "tasks:assign",
    ]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  const pedir = (
    metodo: "GET" | "POST",
    url: string,
    corpo?: unknown,
    chave = chaves["tudo"] ?? "",
  ) =>
    app.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${chave}`,
        ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });
  const lista = async (q = "", chave?: string) => {
    const r = await pedir("GET", `/tasks${q}`, undefined, chave);
    expect(r.statusCode, r.body).toBe(200);
    return r.json<Lista>();
  };
  const codigo = (r: { statusCode: number; json: () => Json }) => [
    r.statusCode,
    r.json()["codigo"],
  ];
  const id = (fila: keyof typeof FILAS, caso: string) =>
    `${FILAS[fila].prefixo}_${caso}`;
  const daLista = async (fila: keyof typeof FILAS, caso: string) =>
    (await lista(`?fila=${fila}`)).dados.find((t) => t.caso === id(fila, caso));

  it("a lista tem os casos abertos das sete filas, do comerciante só, com o prazo em vigor", async () => {
    const l = await lista();
    expect(l.filas).toHaveLength(7);
    expect(l.dados.map((t) => t.caso).sort()).toEqual(
      [
        id("pagamento", casos.diferenca),
        id("documento_fiscal", casos.documento),
        id("duplicado_cliente", casos.duplicado),
        id("livre_resolucao", casos.pendente),
        id("livre_resolucao", casos.foraDePrazo),
        id("prazo_reembolso", casos.devolucao),
        id("problema", casos.problema),
        id("reembolso", casos.reembolso),
      ].sort(),
    );
    expect(l.totais).toEqual({
      pagamento: 1,
      documento_fiscal: 1,
      duplicado_cliente: 1,
      prazo_reembolso: 1,
      livre_resolucao: 2,
      problema: 1,
      reembolso: 1,
    });
    // Do prazo mais próximo ao mais longe.
    const prazos = l.dados.map((t) => t.prazo);
    expect([...prazos].sort()).toEqual(prazos);
    const por = (c: string) => l.dados.find((t) => t.caso.endsWith(c));
    // Vencidos: a diferença (1 dia), o duplicado (7), o fora de prazo (2) e o
    // prazo legal do reembolso (há 20 dias + 14).
    expect(por(casos.diferenca)?.vencida).toBe(true);
    expect(por(casos.duplicado)?.vencida).toBe(true);
    expect(por(casos.foraDePrazo)?.vencida).toBe(true);
    expect(por(casos.devolucao)?.vencida).toBe(true);
    expect(por(casos.documento)?.vencida).toBe(false);
    expect(por(casos.problema)?.vencida).toBe(false);
    // O pedido pendente corre o prazo legal (docs/33 §2): 14 dias do pedido.
    expect(por(casos.pendente)?.prazo_legal).not.toBeNull();
    expect(por(casos.pendente)?.motivo).toBe("pendente");
    expect(por(casos.documento)?.motivo).toBe("emissor_por_configurar");
    expect(por(casos.documento)?.encomenda).toBe(`ord_${encomenda}`);
    // Nada de nenhum responsável ainda.
    expect(l.dados.every((t) => t.responsavel === null && t.versao === 0)).toBe(
      true,
    );
  });

  it("o outro comerciante não vê os casos do A, e o A não vê os do B", async () => {
    const deB = await lista("", chaves["deB"]);
    expect(deB.dados.map((t) => t.caso)).toEqual([
      id("pagamento", casos.diferencaDeB),
    ]);
    const deA = await lista();
    expect(deA.dados.some((t) => t.caso.endsWith(casos.diferencaDeB))).toBe(
      false,
    );
    // Nem pelo caso directamente.
    const r = await pedir(
      "GET",
      `/tasks/pagamento/${id("pagamento", casos.diferencaDeB)}`,
    );
    expect(codigo(r)).toEqual([404, "tasks.not_found"]);
  });

  it("a lista mostra só as filas que a chave lê; sem nenhuma, 403", async () => {
    const so = await lista("", chaves["clientes"]);
    expect(so.filas).toEqual(["duplicado_cliente"]);
    expect(so.totais).toEqual({ duplicado_cliente: 1 });
    expect(so.dados.map((t) => t.fila)).toEqual(["duplicado_cliente"]);
    expect(
      codigo(
        await pedir(
          "GET",
          "/tasks?fila=pagamento",
          undefined,
          chaves["clientes"],
        ),
      ),
    ).toEqual([403, "tasks.forbidden"]);
    expect(
      codigo(await pedir("GET", "/tasks", undefined, chaves["nada"])),
    ).toEqual([403, "tasks.forbidden"]);
  });

  it("a lista pagina por cursor sem repetir nem saltar", async () => {
    const vistos: string[] = [];
    let cursor: string | null = null;
    let voltas = 0;
    do {
      const l: Lista = await lista(
        `?limite=3${cursor === null ? "" : `&cursor=${cursor}`}`,
      );
      vistos.push(...l.dados.map((t) => t.caso));
      cursor = l.cursor_seguinte;
      voltas += 1;
    } while (cursor !== null && voltas < 10);
    expect(voltas).toBe(3);
    expect(new Set(vistos).size).toBe(8);
    expect(codigo(await pedir("GET", "/tasks?cursor=naoeumcursor"))).toEqual([
      400,
      "request.invalid",
    ]);
  });

  it("atribuir: só a quem decide a fila, com a versão lida, e com tasks:assign", async () => {
    const url = `/tasks/pagamento/${id("pagamento", casos.diferenca)}/assign`;
    // O gestor não decide as diferenças dos pagamentos (só o dono, 0059).
    expect(
      codigo(
        await pedir("POST", url, {
          responsavel: `per_${pessoas.gestor}`,
          versao: 0,
        }),
      ),
    ).toEqual([422, "tasks.assignee_not_allowed"]);
    // A pessoa de outro comerciante também não.
    expect(
      codigo(
        await pedir("POST", url, {
          responsavel: `per_${pessoas.deB}`,
          versao: 0,
        }),
      ),
    ).toEqual([422, "tasks.assignee_not_allowed"]);
    // Uma pessoa que não existe também não.
    expect(
      codigo(
        await pedir("POST", url, {
          responsavel: `per_${randomUUID()}`,
          versao: 0,
        }),
      ),
    ).toEqual([422, "tasks.assignee_not_allowed"]);
    // Sem tasks:assign, ou só com leitura: 403.
    for (const c of [chaves["semAtribuir"], chaves["leitura"]]) {
      expect(
        codigo(
          await pedir(
            "POST",
            url,
            { responsavel: `per_${pessoas.dono}`, versao: 0 },
            c,
          ),
        ),
      ).toEqual([403, "tasks.forbidden"]);
    }
    const r = await pedir("POST", url, {
      responsavel: `per_${pessoas.dono}`,
      versao: 0,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ versao: 1 });
    // A versão velha dá conflito.
    expect(
      codigo(await pedir("POST", url, { responsavel: null, versao: 0 })),
    ).toEqual([409, "tasks.version_conflict"]);
    const t = await daLista("pagamento", casos.diferenca);
    expect(t?.responsavel).toBe(`per_${pessoas.dono}`);
    expect(t?.versao).toBe(1);
    // Os filtros: as do dono e as sem responsável.
    const doDono = await lista(`?responsavel=per_${pessoas.dono}`);
    expect(doDono.dados.map((x) => x.caso)).toEqual([
      id("pagamento", casos.diferenca),
    ]);
    const sem = await lista("?responsavel=sem");
    expect(
      sem.dados.some((x) => x.caso === id("pagamento", casos.diferenca)),
    ).toBe(false);
    expect(sem.totais["pagamento"]).toBe(0);
    // Tirar: volta a «sem responsável», com o rasto.
    const tirar = await pedir("POST", url, { responsavel: null, versao: 1 });
    expect(tirar.json()).toEqual({ versao: 2 });
    const ficha = await pedir(
      "GET",
      `/tasks/pagamento/${id("pagamento", casos.diferenca)}`,
    );
    expect(ficha.statusCode, ficha.body).toBe(200);
    const h = ficha.json<{ historico: Json[] }>().historico;
    expect(h.map((x) => x["acto"])).toEqual(["atribuida", "retirada"]);
    expect(h[0]?.["quem"]).toMatch(/^chave:key_/);
    expect(h[1]?.["responsavel_antes"]).toBe(`per_${pessoas.dono}`);
    // Os eventos: só identificadores.
    const ev = await sql<{ tipo: string; dados: Json }>`
      select tipo, dados from evento_saida
      where comerciante_id = ${a} and agregado_tipo = 'atribuicao'
      order by criado_em`.execute(base.dono);
    expect(ev.rows.map((e) => e.tipo)).toEqual([
      "task.assigned",
      "task.unassigned",
    ]);
    expect(Object.keys(ev.rows[0]?.dados ?? {}).sort()).toEqual([
      "caso",
      "em",
      "fila",
      "prazo",
      "responsavel",
    ]);
  });

  it("o prefixo do caso tem de ser o da fila", async () => {
    const r = await pedir(
      "GET",
      `/tasks/pagamento/${id("documento_fiscal", casos.documento)}`,
    );
    expect(codigo(r)).toEqual([404, "tasks.not_found"]);
  });

  it("mudar o prazo: com motivo, nunca no passado, nunca depois do prazo legal", async () => {
    const url = `/tasks/livre_resolucao/${id("livre_resolucao", casos.pendente)}/deadline`;
    const t = await daLista("livre_resolucao", casos.pendente);
    const legal = t?.prazo ?? "";
    expect(
      codigo(
        await pedir("POST", url, {
          prazo: new Date(Date.now() - 60_000).toISOString(),
          motivo: "atraso",
          versao: 0,
        }),
      ),
    ).toEqual([422, "tasks.deadline_invalid"]);
    expect(
      codigo(
        await pedir("POST", url, {
          prazo: new Date(new Date(legal).getTime() + 60_000).toISOString(),
          motivo: "atraso",
          versao: 0,
        }),
      ),
    ).toEqual([422, "tasks.deadline_invalid"]);
    expect(
      (
        await pedir("POST", url, {
          prazo: new Date(Date.now() + 86_400_000).toISOString(),
          versao: 0,
        })
      ).statusCode,
    ).toBe(400);
    const novo = new Date(Date.now() + 86_400_000).toISOString();
    const r = await pedir("POST", url, {
      prazo: novo,
      motivo: "o cliente ligou",
      versao: 0,
    });
    expect(r.statusCode, r.body).toBe(200);
    const depois = await daLista("livre_resolucao", casos.pendente);
    expect(depois?.prazo_definido).toBe(true);
    expect(depois?.prazo).toBe(novo);
    expect(depois?.versao).toBe(1);
  });

  it("duas pessoas ao mesmo tempo: a segunda espera pela primeira e recebe conflito", async () => {
    const cliente = new pg.Client({ connectionString: base.urlApi });
    cliente.on("error", () => undefined);
    await cliente.connect();
    const url = `/tasks/documento_fiscal/${id("documento_fiscal", casos.documento)}/assign`;
    try {
      await cliente.query("begin");
      await cliente.query(
        "select set_config('eurolify.comerciante', $1, true)",
        [a],
      );
      await cliente.query(
        "select tarefas_atribuir($1, $2, $3, 0, 'chave:teste')",
        ["documento_fiscal", casos.documento, pessoas.gestor],
      );
      const segundo = pedir("POST", url, {
        responsavel: `per_${pessoas.dono}`,
        versao: 0,
      });
      let aEspera = false;
      for (let i = 0; i < 100 && !aEspera; i++) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and query ilike '%tarefas_atribuir%'`.execute(base.dono);
        aEspera = (rows[0]?.n ?? 0) > 0;
        if (!aEspera) await new Promise((r) => setTimeout(r, 50));
      }
      expect(aEspera).toBe(true);
      await cliente.query("commit");
      expect(codigo(await segundo)).toEqual([409, "tasks.version_conflict"]);
    } finally {
      await cliente.query("rollback").catch(() => undefined);
      await cliente.end();
    }
    expect(
      (await daLista("documento_fiscal", casos.documento))?.responsavel,
    ).toBe(`per_${pessoas.gestor}`);
  }, 20_000);

  it("quem muda para um papel que não decide a fila, ou sai da equipa, deixa de ser responsável", async () => {
    // O gestor tem o documento (do teste anterior); passa a apoio, que não decide documentos.
    await sql`update membro set papel = 'apoio' where id = ${membros[pessoas.gestor] ?? ""}`.execute(
      base.dono,
    );
    const doc = await daLista("documento_fiscal", casos.documento);
    expect(doc?.responsavel).toBeNull();
    expect(doc?.versao).toBe(2);
    // O outro gestor fica com o duplicado e sai da equipa.
    const dup = id("duplicado_cliente", casos.duplicado);
    expect(
      (
        await pedir("POST", `/tasks/duplicado_cliente/${dup}/assign`, {
          responsavel: `per_${pessoas.gestor2}`,
          versao: 0,
        })
      ).statusCode,
    ).toBe(200);
    await sql`update membro set ate = now(), terminado_por = 'pessoa:per_teste'
      where id = ${membros[pessoas.gestor2] ?? ""}`.execute(base.dono);
    const depois = await daLista("duplicado_cliente", casos.duplicado);
    expect(depois?.responsavel).toBeNull();
    const h = (await pedir("GET", `/tasks/duplicado_cliente/${dup}`)).json<{
      historico: Json[];
    }>().historico;
    expect(h.at(-1)).toMatchObject({
      acto: "retirada",
      motivo: "saiu da equipa",
      quem: "pessoa:per_teste",
    });
    // E já não se lhe pode atribuir nada.
    expect(
      codigo(
        await pedir("POST", `/tasks/duplicado_cliente/${dup}/assign`, {
          responsavel: `per_${pessoas.gestor2}`,
          versao: 2,
        }),
      ),
    ).toEqual([422, "tasks.assignee_not_allowed"]);
  });

  it("o aviso de vencido sai uma vez por prazo, e não no prazo do reembolso", async () => {
    // Antes da volta: os por avisar são os vencidos sem aviso, sem o prazo do
    // reembolso (que também está vencido, mas tem os avisos da pós-venda).
    const cliente = new pg.Client({ connectionString: base.urlApi });
    await cliente.connect();
    try {
      await cliente.query("begin");
      await cliente.query(
        "select set_config('eurolify.comerciante', $1, true)",
        [a],
      );
      const r = await cliente.query<{ fila: string }>(
        "select x.fila from tarefas_por_avisar(100) x",
      );
      expect(r.rows.map((x) => x.fila).sort()).toEqual([
        "duplicado_cliente",
        "livre_resolucao",
        "pagamento",
      ]);
    } finally {
      await cliente.query("rollback").catch(() => undefined);
      await cliente.end();
    }
    const primeira = await correrAvisosDeTarefas(base.api);
    expect(primeira.erros).toEqual([]);
    // Em A: a diferença, o duplicado e o fora de prazo; em B: a diferença.
    expect(primeira.avisados).toBe(4);
    expect((await correrAvisosDeTarefas(base.api)).avisados).toBe(0);
    // A própria função recusa um segundo aviso e o prazo do reembolso, mesmo
    // chamada à mão (a lista das por avisar já os tira; isto é a segunda trava).
    const marcar = async (fila: string, caso: string) => {
      const cliente = new pg.Client({ connectionString: base.urlApi });
      await cliente.connect();
      try {
        await cliente.query("begin");
        await cliente.query(
          "select set_config('eurolify.comerciante', $1, true)",
          [a],
        );
        const r = await cliente.query<{ m: boolean }>(
          "select tarefas_marcar_vencida($1, $2, 'sistema:teste') as m",
          [fila, caso],
        );
        await cliente.query("rollback");
        return r.rows[0]?.m;
      } finally {
        await cliente.end();
      }
    };
    expect(await marcar("pagamento", casos.diferenca)).toBe(false);
    expect(await marcar("prazo_reembolso", casos.devolucao)).toBe(false);
    const l = await lista("?vencida=true");
    const avisados = l.dados
      .filter((t) => t.aviso_vencido_em !== null)
      .map((t) => t.fila);
    expect(avisados.sort()).toEqual([
      "duplicado_cliente",
      "livre_resolucao",
      "pagamento",
    ]);
    // O aviso não muda a versão: quem estava a atribuir não recebe conflito.
    expect((await daLista("pagamento", casos.diferenca))?.versao).toBe(2);
    expect((await daLista("livre_resolucao", casos.foraDePrazo))?.versao).toBe(
      0,
    );
    const ev = await sql<{ n: number }>`
      select count(*)::int as n from evento_saida where tipo = 'task.overdue'`.execute(
      base.dono,
    );
    expect(ev.rows[0]?.n).toBe(4);
    // Um prazo novo permite um aviso novo (e tira a marca).
    const fp = id("livre_resolucao", casos.foraDePrazo);
    await pedir("POST", `/tasks/livre_resolucao/${fp}/deadline`, {
      prazo: new Date(Date.now() + 3_600_000).toISOString(),
      motivo: "mais um dia",
      versao: 0,
    });
    const t = await daLista("livre_resolucao", casos.foraDePrazo);
    expect(t?.aviso_vencido_em).toBeNull();
    expect(t?.vencida).toBe(false);
  });

  it("um caso decidido sai da lista; se voltar à fila, é uma passagem nova sem responsável", async () => {
    const dup = id("duplicado_cliente", casos.duplicado);
    // Atribuído ao dono, e depois descartado (pela base, como faria a rota da fila).
    expect(
      (
        await pedir("POST", `/tasks/duplicado_cliente/${dup}/assign`, {
          responsavel: `per_${pessoas.dono}`,
          versao: 2,
        })
      ).statusCode,
    ).toBe(200);
    await comoDono(async (t) => {
      await sql`update duplicado_cliente set estado = 'descartado', motivo = 'pessoas diferentes',
        decidido_por = 'pessoa:per_teste', decidido_em = now(), por_decidir_desde = null
        where id = ${casos.duplicado}`.execute(t);
    });
    expect(await daLista("duplicado_cliente", casos.duplicado)).toBeUndefined();
    expect(
      codigo(await pedir("GET", `/tasks/duplicado_cliente/${dup}`)),
    ).toEqual([404, "tasks.not_found"]);
    // Um sinal novo reabre o par: o gatilho da 0066 põe a hora nova.
    await sql`update duplicado_cliente set estado = 'por_decidir', motivo = null,
      decidido_por = null, decidido_em = null, sinais = '{email,telefone}'
      where id = ${casos.duplicado}`.execute(base.dono);
    const nova = await daLista("duplicado_cliente", casos.duplicado);
    expect(nova?.responsavel).toBeNull();
    expect(nova?.versao).toBe(0);
    expect(nova?.vencida).toBe(false);
    const h = (await pedir("GET", `/tasks/duplicado_cliente/${dup}`)).json<{
      historico: Json[];
    }>().historico;
    // O histórico da passagem antiga fica; a nova ainda não tem nada.
    expect(new Set(h.map((x) => x["passagem"])).size).toBe(1);
    expect(h.length).toBeGreaterThan(0);
  });

  it("a régua das filas na base é a mesma das rotas", async () => {
    const r = await sql<{
      fila: string;
      ambito_ler: string;
      ambito_decidir: string;
    }>`
      select * from tarefas_filas()`.execute(base.dono);
    expect(
      Object.fromEntries(
        r.rows.map((f) => [f.fila, [f.ambito_ler, f.ambito_decidir]]),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(FILAS).map(([f, v]) => [f, [v.ler, v.decidir]]),
      ),
    );
  });

  it("o rasto da atribuição só se acrescenta", async () => {
    const r = await sql`update atribuicao_rasto set motivo = 'x'`
      .execute(base.dono)
      .catch((e: unknown) => e);
    expect(String(r)).toMatch(/audit\.append_only/);
  });
});
