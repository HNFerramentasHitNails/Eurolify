import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// O prazo de resposta a um pedido do titular, parte 1 (docs/23 §15.14, T1–T4,
// T6 e T7; migração 0092; RGPD, art. 12.º, n.os 3 e 4). Ex.: a Ana escreve a
// pedir o apagamento; o dono regista a chegada, o prazo legal é um mês depois,
// o caso fica no «A decidir» até se fechar.

type Json = Record<string, unknown>;

let sequencia = 0;
const unico = () => `${Date.now().toString(36)}${String(sequencia++)}`;

/** O instante da meia-noite de `dia` (AAAA-MM-DD) em Lisboa. */
function meiaNoiteEmLisboa(dia: string): number {
  const utc = Date.parse(`${dia}T00:00:00Z`);
  const hora = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Lisbon",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(utc),
  );
  return utc - hora * 3_600_000;
}
/** AAAA-MM-DD mais `n` dias. */
const maisDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
/** Hoje em Lisboa (AAAA-MM-DD). */
const hojeEmLisboa = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(
    new Date(),
  );

describe.skipIf(URL_BASE === undefined)(
  "o pedido do titular recebido e o prazo de resposta",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let a: string;
    let b: string;
    let dono: string;
    let donoId: string;
    let semPrivacidade: string;
    let deB: string;

    const pedir = (
      metodo: "POST" | "GET" | "PUT" | "DELETE",
      url: string,
      corpo?: unknown,
      segredo = dono,
    ) =>
      app.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
          ...(corpo === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
      });
    const ok = async (
      r: ReturnType<typeof pedir>,
      estado = 200,
    ): Promise<Json> => {
      const x = await r;
      expect(x.statusCode, x.body).toBe(estado);
      return x.json();
    };
    const recusa = async (
      r: ReturnType<typeof pedir>,
      estado: number,
      codigo?: string,
    ) => {
      const x = await r;
      expect(x.statusCode, x.body).toBe(estado);
      if (codigo !== undefined) expect(x.json<Json>()["codigo"]).toBe(codigo);
      return x.json<Json>();
    };
    const ficha = async (segredo = dono) =>
      String(
        (
          await ok(
            pedir("POST", "/customers", { nome: `Ana ${unico()}` }, segredo),
            201,
          )
        )["id"],
      );
    const registar = (cliente: string, corpo: Json, segredo = dono) =>
      pedir(
        "POST",
        `/customers/${cliente}/privacy-requests/received`,
        corpo,
        segredo,
      );
    const recebido = async (cliente: string, corpo: Json = {}) =>
      ok(
        registar(cliente, { tipo: "apagamento", canal: "email", ...corpo }),
        201,
      );
    const prorrogar = (id: string, corpo: Json, segredo = dono) =>
      pedir("POST", `/privacy-requests/received/${id}/extend`, corpo, segredo);
    const fechar = (id: string, corpo: Json, segredo = dono) =>
      pedir("POST", `/privacy-requests/received/${id}/close`, corpo, segredo);
    const lista = async (cliente: string) =>
      (
        await ok(
          pedir("GET", `/customers/${cliente}/privacy-requests/received`),
        )
      )["dados"] as Json[];
    const haDias = (n: number) =>
      new Date(Date.now() - n * 86_400_000).toISOString();
    /** O dia da chegada em Lisboa e o limite da prorrogação, lidos da base. */
    async function dias(prq: string) {
      return comoDono(async (t) => {
        const { rows } = await sql<{ dia: string; limite: string }>`
          select to_char(recebido_dia, 'YYYY-MM-DD') as dia,
            to_char((recebido_dia + interval '2 months')::date, 'YYYY-MM-DD') as limite
          from pedido_titular_recebido where id = ${prq.slice(4)}::uuid`.execute(
          t,
        );
        const r = rows[0];
        if (r === undefined) throw new Error("sem linha");
        return r;
      });
    }

    /** O dono da base, no comerciante A. */
    async function comoDono<T>(fn: (trx: Kysely<unknown>) => Promise<T>) {
      return base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${a}, true),
          set_config('eurolify.quem', 'teste:sql', true)`.execute(trx);
        return fn(trx);
      });
    }
    const erroDe = (p: Promise<unknown>) =>
      p.then(
        () => "passou",
        (e: unknown) => (e as Error).message,
      );

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
      app = criarApp({ logger: false }, undefined, base.api);
      a = await registarComerciante(base.api, {
        nome: "A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      b = await registarComerciante(base.api, {
        nome: "B",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const chave = (c: string, nome: string, ambitos: string[]) =>
        criarChave(base.dono, c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome,
          ambitos: ambitos as never,
        });
      const todos = [
        "customers:read",
        "customers:write",
        "customers:merge",
        "customers:privacy",
      ];
      const d = await chave(a, "Dono", todos);
      dono = d.segredo;
      donoId = d.id;
      semPrivacidade = (
        await chave(
          a,
          "Sem privacidade",
          todos.filter((x) => x !== "customers:privacy"),
        )
      ).segredo;
      deB = (await chave(b, "B", todos)).segredo;
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await base.fechar();
    });

    it("regista a chegada com o prazo legal de um mês, aberto, com quem registou (T1, T2)", async () => {
      const id = await ficha();
      const r = await recebido(id, { recebido_em: haDias(3) });
      expect(r["id"]).toMatch(/^prq_/);
      expect(r).toMatchObject({
        cliente: id,
        tipo: "apagamento",
        canal: "email",
        estado: "aberto",
        prorrogado_ate: null,
        prorrogado_motivo: null,
        titular_informado_em: null,
        fechado_em: null,
        pedido: null,
        quem: `chave:key_${donoId}`,
      });
      const { dia } = await dias(String(r["id"]));
      // Um mês no calendário: o mesmo dia do mês seguinte.
      const [ano, mes, d] = dia.split("-").map(Number) as [
        number,
        number,
        number,
      ];
      const seguinte = new Date(Date.UTC(ano, mes, 1));
      const ultimo = new Date(
        Date.UTC(seguinte.getUTCFullYear(), seguinte.getUTCMonth() + 1, 0),
      ).getUTCDate();
      expect(r["prazo_legal"]).toBe(
        `${String(seguinte.getUTCFullYear())}-${String(seguinte.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`,
      );
      // Sem `recebido_em`, agora.
      const agora = await recebido(id, { tipo: "acesso", canal: "telefone" });
      expect(
        Math.abs(Date.parse(String(agora["recebido_em"])) - Date.now()),
      ).toBeLessThan(60_000);
    });

    it("o prazo conta do dia em que chegou, no fuso do comerciante; 31/01 dá 28/02", async () => {
      const id = await ficha();
      // O PostgreSQL (`+ interval '1 month'`): o último dia do mês seguinte.
      expect(
        (await recebido(id, { recebido_em: "2026-01-31T12:00:00Z" }))[
          "prazo_legal"
        ],
      ).toBe("2026-02-28");
      expect(
        (await recebido(id, { recebido_em: "2024-01-31T12:00:00Z" }))[
          "prazo_legal"
        ],
      ).toBe("2024-02-29");
      // 31/03 às 23:30 UTC é já 1/04 em Lisboa (hora de verão).
      expect(
        (await recebido(id, { recebido_em: "2026-03-31T23:30:00Z" }))[
          "prazo_legal"
        ],
      ).toBe("2026-05-01");
    });

    it("recusa um pedido chegado no futuro, sem ficha, numa ficha que não está activa e de outra loja", async () => {
      const id = await ficha();
      await recusa(
        registar(id, {
          tipo: "acesso",
          canal: "email",
          recebido_em: new Date(Date.now() + 3_600_000).toISOString(),
        }),
        400,
        "customers.invalid_field",
      );
      // Sem ficha não há registo (Q-P2).
      await recusa(
        registar(`cus_${randomUUID()}`, { tipo: "acesso", canal: "email" }),
        404,
        "customers.not_found",
      );
      // A ficha de A não se vê de B.
      await recusa(
        registar(id, { tipo: "acesso", canal: "email" }, deB),
        404,
        "customers.not_found",
      );
      // Sem texto livre no canal.
      await recusa(
        registar(id, { tipo: "acesso", canal: "e-mail da Ana" }),
        400,
      );
      // Numa ficha fundida, pede-se pela que ficou.
      const fica = await ficha();
      await ok(
        pedir("POST", `/customers/${fica}/merge`, {
          absorver: id,
          ensaio: false,
        }),
      );
      await recusa(
        registar(id, { tipo: "acesso", canal: "email" }),
        409,
        "customers.invalid_transition",
      );
    });

    it("sem customers:privacy, 403 em todas", async () => {
      const id = await ficha();
      const r = await recebido(id);
      const prq = String(r["id"]);
      await recusa(
        registar(id, { tipo: "acesso", canal: "email" }, semPrivacidade),
        403,
      );
      await recusa(
        pedir(
          "GET",
          `/customers/${id}/privacy-requests/received`,
          undefined,
          semPrivacidade,
        ),
        403,
      );
      await recusa(
        prorrogar(
          prq,
          {
            prorrogado_ate: maisDias(String(r["prazo_legal"]), 1),
            motivo: "numero_de_pedidos",
            titular_informado_em: hojeEmLisboa(),
          },
          semPrivacidade,
        ),
        403,
      );
      await recusa(
        fechar(prq, { fim: "respondido", em: hojeEmLisboa() }, semPrivacidade),
        403,
      );
    });

    it("outra loja não vê nem mexe no pedido (404)", async () => {
      const id = await ficha();
      const r = await recebido(id);
      const prq = String(r["id"]);
      await recusa(
        pedir(
          "GET",
          `/customers/${id}/privacy-requests/received`,
          undefined,
          deB,
        ),
        404,
        "customers.not_found",
      );
      await recusa(
        prorrogar(
          prq,
          {
            prorrogado_ate: maisDias(String(r["prazo_legal"]), 1),
            motivo: "numero_de_pedidos",
            titular_informado_em: hojeEmLisboa(),
          },
          deB,
        ),
        404,
        "customers.not_found",
      );
      await recusa(
        fechar(prq, { fim: "respondido", em: hojeEmLisboa() }, deB),
        404,
        "customers.not_found",
      );
      expect((await lista(id)).map((x) => x["estado"])).toEqual(["aberto"]);
    });

    it("prorroga uma vez, até dois meses depois da chegada, informando o titular no primeiro mês (T2)", async () => {
      const id = await ficha();
      const r = await recebido(id, { recebido_em: haDias(5) });
      const prq = String(r["id"]);
      const prazo = String(r["prazo_legal"]);
      const { dia, limite } = await dias(prq);
      const hoje = hojeEmLisboa();
      const corpo = {
        prorrogado_ate: limite,
        motivo: "complexidade",
        titular_informado_em: hoje,
      };
      // Para lá dos dois meses (leitura conservadora, C).
      await recusa(
        prorrogar(prq, { ...corpo, prorrogado_ate: maisDias(limite, 1) }),
        400,
        "customers.invalid_field",
      );
      // Não é prorrogar se não passa do prazo legal.
      await recusa(
        prorrogar(prq, { ...corpo, prorrogado_ate: prazo }),
        400,
        "customers.invalid_field",
      );
      // O titular informado antes de o pedido chegar, ou no futuro.
      await recusa(
        prorrogar(prq, { ...corpo, titular_informado_em: maisDias(dia, -1) }),
        400,
        "customers.invalid_field",
      );
      await recusa(
        prorrogar(prq, { ...corpo, titular_informado_em: maisDias(hoje, 1) }),
        400,
        "customers.invalid_field",
      );
      // O motivo é da lista do art. 12.º, n.º 3, sem texto livre.
      await recusa(
        prorrogar(prq, { ...corpo, motivo: "três encomendas da Ana" }),
        400,
      );
      const p = await ok(prorrogar(prq, corpo));
      expect(p).toMatchObject({
        estado: "aberto",
        prazo_legal: prazo,
        prorrogado_ate: limite,
        prorrogado_motivo: corpo.motivo,
        titular_informado_em: hoje,
      });
      // Uma vez só.
      await recusa(
        prorrogar(prq, { ...corpo, prorrogado_ate: maisDias(prazo, 1) }),
        409,
        "customers.invalid_transition",
      );
    });

    it("depois do mês regista-se a prorrogação se o titular foi informado dentro dele; depois do prazo legal, não (P2-3)", async () => {
      const id = await ficha();
      const r = await recebido(id, { recebido_em: haDias(40) });
      const { dia, limite } = await dias(String(r["id"]));
      // O titular informado depois do prazo legal: a lei não se cumpriu.
      await recusa(
        prorrogar(String(r["id"]), {
          prorrogado_ate: limite,
          motivo: "numero_de_pedidos",
          titular_informado_em: maisDias(String(r["prazo_legal"]), 1),
        }),
        400,
        "customers.invalid_field",
      );
      // Informado dentro do mês e registado hoje: é só registo.
      expect(
        await ok(
          prorrogar(String(r["id"]), {
            prorrogado_ate: limite,
            motivo: "numero_de_pedidos",
            titular_informado_em: maisDias(dia, 1),
          }),
        ),
      ).toMatchObject({
        prorrogado_ate: limite,
        titular_informado_em: maisDias(dia, 1),
      });
    });

    it("prorrogar e fechar são decisões de uma pessoa ou de uma chave (P3-3)", async () => {
      const id = await ficha();
      const r = await recebido(id);
      const prq = String(r["id"]).slice(4);
      const { limite } = await dias(String(r["id"]));
      // `comoDono` escreve com quem = «teste:sql», que não é pessoa nem chave.
      expect(
        await erroDe(
          comoDono((t) =>
            sql`select pedido_recebido_prorrogar(${prq}::uuid, ${limite}::date,
              'complexidade', current_date)`.execute(t),
          ),
        ),
      ).toMatch(/^customers\.change_without_who:/);
      expect(
        await erroDe(
          comoDono((t) =>
            sql`select pedido_recebido_fechar(${prq}::uuid, 'respondido', current_date,
              null)`.execute(t),
          ),
        ),
      ).toMatch(/^customers\.change_without_who:/);
    });

    it("prorrogar depois do aviso de vencido limpa o aviso, com a linha no rasto: o caso pode ser avisado outra vez (P2-1)", async () => {
      const id = await ficha();
      // Chegou há 25 dias: o prazo da tarefa (7 dias antes do legal) já passou.
      const r = await recebido(id, { recebido_em: haDias(25) });
      const prq = String(r["id"]).slice(4);
      expect(
        await comoDono(async (t) => {
          const { rows } = await sql<{ ok: boolean }>`
            select tarefas_marcar_vencida('pedido_titular', ${prq}::uuid) as ok`.execute(
            t,
          );
          return rows[0]?.ok;
        }),
      ).toBe(true);
      const { limite } = await dias(String(r["id"]));
      await ok(
        prorrogar(String(r["id"]), {
          prorrogado_ate: limite,
          motivo: "complexidade",
          titular_informado_em: hojeEmLisboa(),
        }),
      );
      const depois = await comoDono(async (t) => {
        const { rows } = await sql<{
          aviso: Date | null;
          versao: number;
          actos: string[];
        }>`
          select a.aviso_vencido_em as aviso, a.versao,
            array(select z.acto from atribuicao_rasto z where z.atribuicao_id = a.id
                  order by z.em, z.id) as actos
          from atribuicao a
          where a.fila = 'pedido_titular' and a.caso = ${prq}::uuid`.execute(t);
        return rows[0];
      });
      expect(depois).toEqual({
        aviso: null,
        versao: 1,
        actos: ["vencida", "prazo_mudado"],
      });
      // O e-mail do aviso antigo já não espera (0071): o prazo mudou depois.
      const t = (
        (await ok(pedir("GET", "/tasks?fila=pedido_titular&limite=100")))[
          "dados"
        ] as Json[]
      ).find((x) => x["caso"] === `prq_${prq}`);
      expect(t).toMatchObject({
        aviso_vencido_em: null,
        vencida: false,
        motivo: "prorrogado",
      });
    });

    it("o pedido executado é do tipo que responde e do dia da chegada ou depois (P3-1)", async () => {
      const id = await ficha();
      const hoje = hojeEmLisboa();
      const verificacao = "resposta do e-mail da ficha a 13/10/2026";
      const exportado = await ok(
        pedir("POST", `/customers/${id}/export`, { verificacao }),
      );
      // A limitação e o fim dela registam pedidos `limitacao` e `fim_da_limitacao`.
      await ok(pedir("PUT", `/customers/${id}/restriction`, { verificacao }));
      await ok(
        pedir("DELETE", `/customers/${id}/restriction`, { verificacao }),
      );
      const pedidos = (
        await ok(pedir("GET", `/customers/${id}/privacy-requests`))
      )["dados"] as Json[];
      const doTipo = (tipo: string) =>
        pedidos.find((p) => p["tipo"] === tipo)?.["id"];
      // A rectificação, a oposição e «outro» não se executam no Eurolify.
      for (const tipo of ["rectificacao", "oposicao", "outro"]) {
        const x = await recebido(id, { tipo });
        await recusa(
          fechar(String(x["id"]), {
            fim: "executado",
            em: hoje,
            pedido: exportado["pedido"],
          }),
          409,
          "customers.invalid_transition",
        );
      }
      // O tipo do pedido executado tem de responder ao recebido.
      for (const [tipo, errado] of [
        ["apagamento", exportado["pedido"]],
        ["acesso", doTipo("limitacao")],
        ["portabilidade", doTipo("fim_da_limitacao")],
        ["limitacao", exportado["pedido"]],
      ] as const) {
        const x = await recebido(id, { tipo });
        await recusa(
          fechar(String(x["id"]), {
            fim: "executado",
            em: hoje,
            pedido: errado,
          }),
          400,
          "customers.invalid_field",
        );
      }
      // Os que respondem: a exportação à portabilidade, o fim da limitação à limitação.
      const port = await recebido(id, { tipo: "portabilidade" });
      await ok(
        fechar(String(port["id"]), {
          fim: "executado",
          em: hoje,
          pedido: exportado["pedido"],
        }),
      );
      const lim = await recebido(id, { tipo: "limitacao" });
      await ok(
        fechar(String(lim["id"]), {
          fim: "executado",
          em: hoje,
          pedido: doTipo("fim_da_limitacao"),
        }),
      );
      // Um pedido executado antes do dia da chegada não lhe responde.
      const antigo = await comoDono(async (t) => {
        const { rows } = await sql<{ id: string }>`
          insert into pedido_titular (comerciante_id, cliente_id, tipo, verificacao, quem, em)
          values (${a}::uuid, ${id.slice(4)}::uuid, 'exportacao', ${verificacao},
            'teste:sql', now() - interval '3 days')
          returning id`.execute(t);
        return `dsr_${String(rows[0]?.id)}`;
      });
      const tarde = await recebido(id, {
        tipo: "acesso",
        recebido_em: haDias(1),
      });
      await recusa(
        fechar(String(tarde["id"]), {
          fim: "executado",
          em: hoje,
          pedido: antigo,
        }),
        400,
        "customers.invalid_field",
      );
    });

    it("o pedido executado de outro comerciante é recusado, também pelo dono das tabelas (P3-2)", async () => {
      const id = await ficha();
      const r = await recebido(id, { tipo: "acesso" });
      const deOutraLoja = await ficha(deB);
      const deB_ = await ok(
        pedir(
          "POST",
          `/customers/${deOutraLoja}/export`,
          { verificacao: "resposta do e-mail da ficha a 13/10/2026" },
          deB,
        ),
      );
      await recusa(
        fechar(String(r["id"]), {
          fim: "executado",
          em: hojeEmLisboa(),
          pedido: deB_["pedido"],
        }),
        404,
        "customers.not_found",
      );
      // Sem a função: a chave estrangeira composta recusa.
      expect(
        await erroDe(
          comoDono((t) =>
            sql`update pedido_titular_recebido
              set estado = 'executado', fechado_em = recebido_dia,
                pedido_titular_id = ${String(deB_["pedido"]).slice(4)}::uuid
              where id = ${String(r["id"]).slice(4)}::uuid`.execute(t),
          ),
        ),
      ).toMatch(/pedido_recebido_pedido_do_comerciante/);
    });

    it("fecha uma vez: executado com o pedido do mesmo titular, respondido ou recusado, com o dia (T3)", async () => {
      const id = await ficha();
      const outra = await ficha();
      const hoje = hojeEmLisboa();
      const verificacao = "resposta do e-mail da ficha a 13/10/2026";
      const exportado = await ok(
        pedir("POST", `/customers/${id}/export`, { verificacao }),
      );
      const daOutra = await ok(
        pedir("POST", `/customers/${outra}/export`, { verificacao }),
      );
      const r = await recebido(id, { tipo: "acesso", recebido_em: haDias(2) });
      const prq = String(r["id"]);
      const { dia } = await dias(prq);
      // Executado pede o pedido executado; os outros fins não o levam.
      await recusa(
        fechar(prq, { fim: "executado", em: hoje }),
        400,
        "customers.invalid_field",
      );
      await recusa(
        fechar(prq, {
          fim: "respondido",
          em: hoje,
          pedido: exportado["pedido"],
        }),
        400,
        "customers.invalid_field",
      );
      // O pedido de outro titular, não.
      await recusa(
        fechar(prq, { fim: "executado", em: hoje, pedido: daOutra["pedido"] }),
        400,
        "customers.invalid_field",
      );
      // Nem no futuro, nem antes de chegar.
      await recusa(
        fechar(prq, {
          fim: "executado",
          em: maisDias(hoje, 1),
          pedido: exportado["pedido"],
        }),
        400,
        "customers.invalid_field",
      );
      await recusa(
        fechar(prq, {
          fim: "executado",
          em: maisDias(dia, -1),
          pedido: exportado["pedido"],
        }),
        400,
        "customers.invalid_field",
      );
      const f = await ok(
        fechar(prq, {
          fim: "executado",
          em: hoje,
          pedido: exportado["pedido"],
        }),
      );
      expect(f).toMatchObject({
        estado: "executado",
        fechado_em: hoje,
        pedido: exportado["pedido"],
      });
      // Fechado não muda: nem outro fim, nem prorrogar.
      await recusa(
        fechar(prq, { fim: "recusado", em: hoje }),
        409,
        "customers.invalid_transition",
      );
      await recusa(
        prorrogar(prq, {
          prorrogado_ate: maisDias(String(r["prazo_legal"]), 1),
          motivo: "numero_de_pedidos",
          titular_informado_em: hoje,
        }),
        409,
        "customers.invalid_transition",
      );
      // Respondido e recusado, com o dia.
      const r2 = await recebido(id, { tipo: "rectificacao" });
      expect(
        await ok(fechar(String(r2["id"]), { fim: "respondido", em: hoje })),
      ).toMatchObject({ estado: "respondido", fechado_em: hoje, pedido: null });
      const r3 = await recebido(id, { tipo: "oposicao" });
      expect(
        await ok(fechar(String(r3["id"]), { fim: "recusado", em: hoje })),
      ).toMatchObject({ estado: "recusado", fechado_em: hoje });
      // A lista: os mais recentes primeiro.
      expect((await lista(id)).map((x) => x["id"])).toEqual([
        r3["id"],
        r2["id"],
        prq,
      ]);
    });

    it("não se apaga nem se altera fechado, também pelo dono das tabelas (T7)", async () => {
      const id = await ficha();
      const r = await recebido(id);
      const prq = String(r["id"]).slice(4);
      await ok(
        fechar(String(r["id"]), { fim: "respondido", em: hojeEmLisboa() }),
      );
      expect(
        await erroDe(
          comoDono((t) =>
            sql`delete from pedido_titular_recebido where id = ${prq}::uuid`.execute(
              t,
            ),
          ),
        ),
      ).toMatch(/^audit\.append_only:/);
      expect(
        await erroDe(
          comoDono((t) => sql`truncate pedido_titular_recebido`.execute(t)),
        ),
      ).toMatch(/^audit\.append_only:/);
      expect(
        await erroDe(
          comoDono((t) =>
            sql`update pedido_titular_recebido set estado = 'recusado'
              where id = ${prq}::uuid`.execute(t),
          ),
        ),
      ).toMatch(/^customers\.invalid_transition:/);
      // Nem a ficha nem a data de chegada mudam, mesmo aberto.
      const r2 = await recebido(id);
      expect(
        await erroDe(
          comoDono((t) =>
            sql`update pedido_titular_recebido set recebido_em = recebido_em - interval '1 day'
              where id = ${String(r2["id"]).slice(4)}::uuid`.execute(t),
          ),
        ),
      ).toMatch(/^customers\.immutable_identity:/);
    });

    it("a pseudonimização não falha nem lhe toca; o apagamento executado fecha-se depois (T7)", async () => {
      const id = await ficha();
      const r = await recebido(id, { recebido_em: haDias(1) });
      await ok(
        pedir("POST", `/customers/${id}/pseudonymize`, {
          verificacao: "resposta do e-mail da ficha a 13/10/2026",
          confirmacao: `pseudonimizar ${id}`,
        }),
      );
      const [depois] = await lista(id);
      expect(depois).toEqual(r);
      // Numa ficha pseudonimizada já não se regista outro.
      await recusa(
        registar(id, { tipo: "acesso", canal: "email" }),
        409,
        "customers.invalid_transition",
      );
      const pedidos = (
        await ok(pedir("GET", `/customers/${id}/privacy-requests`))
      )["dados"] as Json[];
      const apagamento = pedidos.find((p) => p["tipo"] === "apagamento");
      expect(
        await ok(
          fechar(String(r["id"]), {
            fim: "executado",
            em: hojeEmLisboa(),
            pedido: apagamento?.["id"],
          }),
        ),
      ).toMatchObject({ estado: "executado", pedido: apagamento?.["id"] });
    });

    it("numa fusão, a lista da ficha que fica mostra os das fundidas e o pedido executado nela fecha-os", async () => {
      const fundida = await ficha();
      const fica = await ficha();
      const r = await recebido(fundida, { tipo: "acesso" });
      await ok(
        pedir("POST", `/customers/${fica}/merge`, {
          absorver: fundida,
          ensaio: false,
        }),
      );
      expect((await lista(fica)).map((x) => x["id"])).toEqual([r["id"]]);
      const exportado = await ok(
        pedir("POST", `/customers/${fica}/export`, {
          verificacao: "resposta do e-mail da ficha a 13/10/2026",
        }),
      );
      await ok(
        fechar(String(r["id"]), {
          fim: "executado",
          em: hojeEmLisboa(),
          pedido: exportado["pedido"],
        }),
      );
    });

    it("a fila «pedido_titular»: o caso entra, o prazo é 7 dias antes do fim do prazo legal, e sai ao fechar (T4)", async () => {
      const id = await ficha();
      const r = await recebido(id, { recebido_em: haDias(2) });
      const prq = String(r["id"]);
      const caso = async () => {
        const l = await ok(
          pedir("GET", "/tasks?fila=pedido_titular&limite=100"),
        );
        return (l["dados"] as Json[]).find((t) => t["caso"] === prq);
      };
      const t = await caso();
      expect(t).toMatchObject({
        fila: "pedido_titular",
        motivo: "por_responder",
        prazo_legal: r["prazo_legal"],
        encomenda: null,
        vencida: false,
      });
      // 7 dias antes do fim (a meia-noite do dia a seguir ao prazo legal): a
      // meia-noite de Lisboa de `prazo_legal - 6`.
      expect(Date.parse(String(t?.["prazo"]))).toBe(
        meiaNoiteEmLisboa(maisDias(String(r["prazo_legal"]), -6)),
      );
      // Sem customers:privacy, a fila nem aparece.
      const sem = await ok(pedir("GET", "/tasks", undefined, semPrivacidade));
      expect(sem["filas"]).toEqual(["duplicado_cliente"]);
      // Prorrogado: o prazo legal em vigor passa a ser o da prorrogação.
      const { limite } = await dias(prq);
      await ok(
        prorrogar(prq, {
          prorrogado_ate: limite,
          motivo: "numero_de_pedidos",
          titular_informado_em: hojeEmLisboa(),
        }),
      );
      const p = await caso();
      expect(p).toMatchObject({ motivo: "prorrogado", prazo_legal: limite });
      expect(Date.parse(String(p?.["prazo"]))).toBe(
        meiaNoiteEmLisboa(maisDias(limite, -6)),
      );
      // Na mesma passagem: entrou quando foi registado.
      expect(p?.["entrou_em"]).toBe(t?.["entrou_em"]);
      await ok(fechar(prq, { fim: "respondido", em: hojeEmLisboa() }));
      expect(await caso()).toBeUndefined();
    });

    it("um pedido registado tarde vence logo, com o prazo na hora em que entrou", async () => {
      const id = await ficha();
      const r = await recebido(id, { recebido_em: haDias(40) });
      const l = await ok(pedir("GET", "/tasks?fila=pedido_titular&limite=100"));
      const t = (l["dados"] as Json[]).find((x) => x["caso"] === r["id"]);
      expect(t).toMatchObject({ vencida: true });
      expect(t?.["prazo"]).toBe(t?.["entrou_em"]);
    });
  },
);
