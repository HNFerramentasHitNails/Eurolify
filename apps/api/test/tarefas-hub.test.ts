import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// O ecrã «A decidir» pela API do Hub (docs/22 §28; migração 0073; issue
// #366, parte 2): as rotas /hub/tasks fazem o mesmo que as da chave, com as
// filas que o papel lê (R2) e as escritas pelo papel (R3). Os casos entram
// pela base em modo `replica`, como em `tarefas-api.test.ts`.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("Hub: as tarefas das filas", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  let a = "";
  let b = "";
  const p: Record<string, { pessoa: string; sessao: string }> = {};
  const casos = {
    diferenca: randomUUID(),
    problema: randomUUID(),
    foraDePrazo: randomUUID(),
    // Pendente há 1 dia: o prazo legal do reembolso ainda corre.
    pendente: randomUUID(),
    diferencaB: randomUUID(),
  };
  const encomenda = randomUUID();

  const comoDono = (fn: (t: Transaction<unknown>) => Promise<unknown>) =>
    base.dono.transaction().execute(async (trx) => {
      await sql`set local session_replication_role = replica`.execute(trx);
      const sempre = (
        await sql<{ tabela: string; nome: string }>`
          select c.relname as tabela, t.tgname as nome from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and t.tgenabled = 'A'
            and c.relname in ('pedido_livre_resolucao', 'problema',
                              'diferenca_pagamento')`.execute(trx)
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
    h = hubDeTeste(base);
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
    for (const papel of ["dono", "gestor", "armazem", "apoio"]) {
      const x = await h.pessoaCom(a, papel);
      p[papel] = { pessoa: x.pessoa, sessao: x.sessao };
    }
    const x = await h.pessoaCom(b, "dono");
    p["donoB"] = { pessoa: x.pessoa, sessao: x.sessao };
    await comoDono(async (t) => {
      await sql`insert into diferenca_pagamento (id, comerciante_id, motivo, criada_em)
        values (${casos.diferenca}, ${a}, 'incerto', now() - interval '2 days'),
               (${casos.diferencaB}, ${b}, 'incerto', now() - interval '2 days')`.execute(
        t,
      );
      await sql`insert into problema (id, comerciante_id, encomenda_id, tipo, descricao,
          estado, criado_por, criado_em, na_fila_desde)
        values (${casos.problema}, ${a}, ${encomenda}, 'chegou_danificado', 'partido',
          'aberto', 'teste', now() - interval '1 hour', now() - interval '1 hour')`.execute(
        t,
      );
      await sql`insert into pedido_livre_resolucao (id, comerciante_id, encomenda_id,
          origem, contacto, recebido_em, dentro_do_prazo, estado, confirmacao)
        values (${casos.foraDePrazo}, ${a}, ${encomenda}, 'botao', 'x@exemplo.pt',
          now() - interval '3 days', false, 'fora_de_prazo', '{}'),
               (${casos.pendente}, ${a}, ${encomenda}, 'botao', 'x@exemplo.pt',
          now() - interval '1 day', true, 'pendente', '{}')`.execute(t);
    });
  }, 120_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  const como = (
    papel: string,
    metodo: "GET" | "POST",
    url: string,
    corpo?: unknown,
    comerciante = papel === "donoB" ? b : a,
  ) =>
    h.pedir(metodo, url, {
      sessao: p[papel]?.sessao ?? "",
      comerciante,
      ...(corpo === undefined ? {} : { corpo }),
    });
  const ok = async (r: Promise<{ statusCode: number; body: string }>) => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(200);
    return JSON.parse(x.body) as Json;
  };
  const codigo = async (
    r: Promise<{ statusCode: number; body: string }>,
  ): Promise<[number, unknown]> => {
    const x = await r;
    return [x.statusCode, (JSON.parse(x.body) as Json)["codigo"]];
  };
  const pessoa = (papel: string) => `per_${p[papel]?.pessoa ?? ""}`;
  const casosDe = (l: Json) =>
    (l["dados"] as Json[]).map((t) => String(t["caso"])).sort();

  it("a lista mostra só as filas que o papel lê (R2); o armazém não vê a diferença de pagamento", async () => {
    const dono = await ok(como("dono", "GET", "/hub/tasks"));
    expect((dono["filas"] as string[]).length).toBe(7);
    expect(casosDe(dono)).toEqual(
      [
        `pdi_${casos.diferenca}`,
        `prb_${casos.problema}`,
        `wdr_${casos.foraDePrazo}`,
        `wdr_${casos.pendente}`,
      ].sort(),
    );
    // O fuso do comerciante vem com a lista (o ecrã escolhe os prazos nele).
    expect(dono["fuso"]).toBe("Europe/Lisbon");
    const armazem = await ok(como("armazem", "GET", "/hub/tasks"));
    expect((armazem["filas"] as string[]).sort()).toEqual(
      ["livre_resolucao", "prazo_reembolso", "problema"].sort(),
    );
    expect(casosDe(armazem)).toEqual(
      [
        `prb_${casos.problema}`,
        `wdr_${casos.foraDePrazo}`,
        `wdr_${casos.pendente}`,
      ].sort(),
    );
    expect(
      await codigo(
        como("armazem", "GET", `/hub/tasks/pagamento/pdi_${casos.diferenca}`),
      ),
    ).toEqual([403, "tasks.forbidden"]);
    expect(
      await codigo(como("armazem", "GET", "/hub/tasks?fila=pagamento")),
    ).toEqual([403, "tasks.forbidden"]);
  });

  it("quem pode ser responsável vem da base: na diferença só o dono; na livre resolução os quatro papéis", async () => {
    const dif = await ok(
      como("gestor", "GET", `/hub/tasks/pagamento/pdi_${casos.diferenca}`),
    );
    expect(dif["pode_ser_responsavel"]).toEqual([pessoa("dono")]);
    const lr = await ok(
      como(
        "gestor",
        "GET",
        `/hub/tasks/livre_resolucao/wdr_${casos.foraDePrazo}`,
      ),
    );
    expect((lr["pode_ser_responsavel"] as string[]).sort()).toEqual(
      ["dono", "gestor", "armazem", "apoio"].map(pessoa).sort(),
    );
  });

  it("atribuir-se pede decidir a fila; outra pessoa, tirar e mudar o prazo pedem também tasks:assign (R3)", async () => {
    // O armazém decide a livre resolução: fica com o caso.
    await ok(
      como(
        "armazem",
        "POST",
        `/hub/tasks/livre_resolucao/wdr_${casos.foraDePrazo}/assign`,
        { responsavel: pessoa("armazem"), versao: 0 },
      ),
    );
    // Não decide o problema (refunds:write), nem atribui a outros.
    expect(
      await codigo(
        como(
          "armazem",
          "POST",
          `/hub/tasks/problema/prb_${casos.problema}/assign`,
          { responsavel: pessoa("armazem"), versao: 0 },
        ),
      ),
    ).toEqual([403, "tasks.forbidden"]);
    expect(
      await codigo(
        como(
          "armazem",
          "POST",
          `/hub/tasks/livre_resolucao/wdr_${casos.foraDePrazo}/assign`,
          { responsavel: null, versao: 1 },
        ),
      ),
    ).toEqual([403, "tasks.forbidden"]);
    expect(
      await codigo(
        como(
          "armazem",
          "POST",
          `/hub/tasks/livre_resolucao/wdr_${casos.foraDePrazo}/deadline`,
          {
            prazo: new Date(Date.now() + 86_400_000).toISOString(),
            motivo: "amanhã",
            versao: 1,
          },
        ),
      ),
    ).toEqual([403, "tasks.forbidden"]);
    // O gestor atribui o problema a si próprio e depois ao dono.
    await ok(
      como(
        "gestor",
        "POST",
        `/hub/tasks/problema/prb_${casos.problema}/assign`,
        {
          responsavel: pessoa("gestor"),
          versao: 0,
        },
      ),
    );
    // A base recusa quem não decide a fila (o armazém no problema).
    expect(
      await codigo(
        como(
          "gestor",
          "POST",
          `/hub/tasks/problema/prb_${casos.problema}/assign`,
          { responsavel: pessoa("armazem"), versao: 1 },
        ),
      ),
    ).toEqual([422, "tasks.assignee_not_allowed"]);
    // Uma versão antiga dá conflito.
    expect(
      await codigo(
        como(
          "gestor",
          "POST",
          `/hub/tasks/problema/prb_${casos.problema}/assign`,
          { responsavel: pessoa("dono"), versao: 0 },
        ),
      ),
    ).toEqual([409, "tasks.version_conflict"]);
  });

  it("responsavel=eu é a pessoa da sessão; o histórico diz quem foi", async () => {
    const gestor = await ok(como("gestor", "GET", "/hub/tasks?responsavel=eu"));
    expect(casosDe(gestor)).toEqual([`prb_${casos.problema}`]);
    const armazem = await ok(
      como("armazem", "GET", "/hub/tasks?responsavel=eu"),
    );
    expect(casosDe(armazem)).toEqual([`wdr_${casos.foraDePrazo}`]);
    expect(
      casosDe(await ok(como("dono", "GET", "/hub/tasks?responsavel=eu"))),
    ).toEqual([]);
    const sem = await ok(como("dono", "GET", "/hub/tasks?responsavel=sem"));
    expect(casosDe(sem)).toEqual(
      [`pdi_${casos.diferenca}`, `wdr_${casos.pendente}`].sort(),
    );
    const caso = await ok(
      como("dono", "GET", `/hub/tasks/problema/prb_${casos.problema}`),
    );
    expect((caso["historico"] as Json[]).map((x) => x["quem"])).toEqual([
      `pessoa:${pessoa("gestor")}`,
    ]);
  });

  it("mudar o prazo: com motivo, nunca no passado", async () => {
    const t = await ok(
      como("gestor", "GET", `/hub/tasks/pagamento/pdi_${casos.diferenca}`),
    );
    const versao = (t["tarefa"] as Json)["versao"];
    // O gestor não decide a diferença (payments:resolve é só do dono).
    expect(
      await codigo(
        como(
          "gestor",
          "POST",
          `/hub/tasks/pagamento/pdi_${casos.diferenca}/deadline`,
          {
            prazo: new Date(Date.now() + 86_400_000).toISOString(),
            motivo: "à espera do prestador",
            versao,
          },
        ),
      ),
    ).toEqual([403, "tasks.forbidden"]);
    expect(
      await codigo(
        como(
          "dono",
          "POST",
          `/hub/tasks/pagamento/pdi_${casos.diferenca}/deadline`,
          {
            prazo: new Date(Date.now() - 60_000).toISOString(),
            motivo: "ontem",
            versao,
          },
        ),
      ),
    ).toEqual([422, "tasks.deadline_invalid"]);
    const r = await ok(
      como(
        "dono",
        "POST",
        `/hub/tasks/pagamento/pdi_${casos.diferenca}/deadline`,
        {
          prazo: new Date(Date.now() + 86_400_000).toISOString(),
          motivo: "à espera do prestador",
          versao,
        },
      ),
    );
    expect(r["versao"]).toBe(Number(versao) + 1);
    const depois = await ok(
      como("dono", "GET", `/hub/tasks/pagamento/pdi_${casos.diferenca}`),
    );
    expect((depois["tarefa"] as Json)["vencida"]).toBe(false);
  });

  it("ficar com um caso de outra pessoa pede tasks:assign (R3; revisão do #396, P2-1)", async () => {
    // O caso fora de prazo é do armazém (teste acima). O apoio decide a
    // livre resolução mas não atribui: não lho tira.
    const t = await ok(
      como(
        "apoio",
        "GET",
        `/hub/tasks/livre_resolucao/wdr_${casos.foraDePrazo}`,
      ),
    );
    const versao = (t["tarefa"] as Json)["versao"];
    expect((t["tarefa"] as Json)["responsavel"]).toBe(pessoa("armazem"));
    expect(
      await codigo(
        como(
          "apoio",
          "POST",
          `/hub/tasks/livre_resolucao/wdr_${casos.foraDePrazo}/assign`,
          { responsavel: pessoa("apoio"), versao },
        ),
      ),
    ).toEqual([403, "tasks.forbidden"]);
    // Num caso sem responsável, fica.
    await ok(
      como(
        "apoio",
        "POST",
        `/hub/tasks/livre_resolucao/wdr_${casos.pendente}/assign`,
        { responsavel: pessoa("apoio"), versao: 0 },
      ),
    );
    // Nem atribui a outros nem muda o prazo.
    expect(
      await codigo(
        como(
          "apoio",
          "POST",
          `/hub/tasks/livre_resolucao/wdr_${casos.pendente}/assign`,
          { responsavel: pessoa("gestor"), versao: 1 },
        ),
      ),
    ).toEqual([403, "tasks.forbidden"]);
    expect(
      await codigo(
        como(
          "apoio",
          "POST",
          `/hub/tasks/livre_resolucao/wdr_${casos.pendente}/deadline`,
          {
            prazo: new Date(Date.now() + 3_600_000).toISOString(),
            motivo: "amanhã",
            versao: 1,
          },
        ),
      ),
    ).toEqual([403, "tasks.forbidden"]);
    // O gestor, com tasks:assign, tira-o ao armazém.
    await ok(
      como(
        "gestor",
        "POST",
        `/hub/tasks/livre_resolucao/wdr_${casos.foraDePrazo}/assign`,
        { responsavel: pessoa("gestor"), versao },
      ),
    );
  });

  it("o prazo nunca passa do prazo legal, e uma IA declarada não atribui nem muda prazos (R5, R11)", async () => {
    const t = await ok(
      como("dono", "GET", `/hub/tasks/livre_resolucao/wdr_${casos.pendente}`),
    );
    const tarefa = t["tarefa"] as Json;
    const legal = String(tarefa["prazo_legal"]);
    expect(legal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      await codigo(
        como(
          "dono",
          "POST",
          `/hub/tasks/livre_resolucao/wdr_${casos.pendente}/deadline`,
          {
            prazo: new Date(
              Date.parse(`${legal}T12:00:00Z`) + 3 * 86_400_000,
            ).toISOString(),
            motivo: "depois do prazo legal",
            versao: tarefa["versao"],
          },
        ),
      ),
    ).toEqual([422, "tasks.deadline_invalid"]);
    const ia = { "eurolify-ia": "fornecedor=teste; modelo=m1; execucao=e1" };
    for (const [url, corpo] of [
      [
        `/hub/tasks/livre_resolucao/wdr_${casos.pendente}/assign`,
        { responsavel: pessoa("dono"), versao: tarefa["versao"] },
      ],
      [
        `/hub/tasks/livre_resolucao/wdr_${casos.pendente}/deadline`,
        {
          prazo: new Date(Date.now() + 3_600_000).toISOString(),
          motivo: "pela IA",
          versao: tarefa["versao"],
        },
      ],
    ] as const) {
      const r = await h.pedir("POST", url, {
        sessao: p["dono"]?.sessao ?? "",
        comerciante: a,
        corpo,
        cabecalhos: ia,
      });
      expect([r.statusCode, (JSON.parse(r.body) as Json)["codigo"]]).toEqual([
        403,
        "tasks.forbidden",
      ]);
    }
  });

  it("outro comerciante não chega aos casos do A, nem pelo identificador", async () => {
    const l = await ok(como("donoB", "GET", "/hub/tasks"));
    expect(casosDe(l)).toEqual([`pdi_${casos.diferencaB}`]);
    expect(
      await codigo(
        como("donoB", "GET", `/hub/tasks/pagamento/pdi_${casos.diferenca}`),
      ),
    ).toEqual([404, "tasks.not_found"]);
    expect(
      await codigo(
        como(
          "donoB",
          "POST",
          `/hub/tasks/pagamento/pdi_${casos.diferenca}/assign`,
          { responsavel: pessoa("donoB"), versao: 0 },
        ),
      ),
    ).toEqual([404, "tasks.not_found"]);
    // A pessoa do A não entra no B com a sessão dela.
    expect(
      (await como("dono", "GET", "/hub/tasks", undefined, b)).statusCode,
    ).toBe(403);
  });
});
