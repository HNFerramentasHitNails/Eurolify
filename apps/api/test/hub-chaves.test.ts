import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mudarEstado,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { gerarChave, resumoDe } from "../src/identidade/chaves.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// Rotas do Hub da parte B3c (docs/21 §4.3, §4.7 e §12; migração 0025; P-T8;
// decisão BA; issue #140): as chaves de API pelo Hub, só o dono, com
// autenticação recente. Contra o PostgreSQL 18.

describe.skipIf(URL_BASE === undefined)("chaves pelo Hub (0025)", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;

  const novoComerciante = (nome: string) =>
    registarComerciante(base.api, {
      nome,
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });

  const criar = (sessao: string, comerciante: string, corpo: unknown) =>
    h.pedir("POST", "/hub/keys", { sessao, comerciante, corpo });

  const servidor = {
    tipo: "servidor",
    nome: "Software de gestão",
    ambitos: ["catalog:read", "merchant:read"],
  };

  async function membroDe(pessoa: string, comerciante: string) {
    const { rows } = await sql<{ id: string }>`
      select id from membro where pessoa_id = ${pessoa}::uuid
        and comerciante_id = ${comerciante}::uuid and ate is null`.execute(
      base.dono,
    );
    return rows[0]?.id ?? "";
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    h = hubDeTeste(base);
  }, 60_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  it("o dono cria uma chave em seu nome; o segredo só aparece aqui e a chave funciona", async () => {
    const c = await novoComerciante("Loja Chaves");
    const d = await h.pessoaCom(c, "dono");
    const r = await criar(d.sessao, c, servidor);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.headers["cache-control"]).toBe("no-store");
    const nova = r.json<{ id: string; segredo: string; criada_por: string }>();
    expect(nova.criada_por).toBe(`pessoa:per_${d.pessoa}`);
    const eu = await h.app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${nova.segredo}` },
    });
    expect(eu.statusCode, eu.body).toBe(200);
    const lista = await h.pedir("GET", "/hub/keys", {
      sessao: d.sessao,
      comerciante: c,
    });
    expect(lista.statusCode).toBe(200);
    expect(lista.body).not.toContain(nova.segredo);
    const revogar = await h.pedir("POST", `/hub/keys/${nova.id}/revoke`, {
      sessao: d.sessao,
      comerciante: c,
    });
    expect(revogar.statusCode, revogar.body).toBe(200);
    expect(revogar.json<{ revogada_por: string }>().revogada_por).toBe(
      `pessoa:per_${d.pessoa}`,
    );
  });

  it("P-T8: sem autenticação recente, nem criar nem revogar", async () => {
    const c = await novoComerciante("Loja Recente");
    const d = await h.pessoaCom(c, "dono");
    const ok = await criar(d.sessao, c, servidor);
    const id = ok.json<{ id: string }>().id;
    await h.envelhecerSessao(d.sessao, "autenticada_em", "11 minutes");
    const r = await criar(d.sessao, c, servidor);
    expect(h.codigo(r)).toBe("auth.reauthentication_required");
    const rev = await h.pedir("POST", `/hub/keys/${id}/revoke`, {
      sessao: d.sessao,
      comerciante: c,
    });
    expect(h.codigo(rev)).toBe("auth.reauthentication_required");
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from chave_api where comerciante_id = ${c}::uuid`.execute(
      base.dono,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("só o papel com keys:write (o dono) gere chaves; e só com os âmbitos do papel", async () => {
    const c = await novoComerciante("Loja Papéis");
    const d = await h.pessoaCom(c, "dono");
    const g = await h.pessoaCom(c, "gestor");
    expect(
      h.codigo(
        await h.pedir("GET", "/hub/keys", { sessao: g.sessao, comerciante: c }),
      ),
    ).toBe("member.role_escalation");
    expect(h.codigo(await criar(g.sessao, c, servidor))).toBe(
      "member.role_escalation",
    );
    const montra = await criar(d.sessao, c, {
      ...servidor,
      ambitos: ["storefront"],
    });
    expect(h.codigo(montra)).toBe("key.scope_escalation");
  });

  it("a chave de um dono que sai da equipa fica revogada", async () => {
    const c = await novoComerciante("Loja Saída");
    const d1 = await h.pessoaCom(c, "dono");
    const d2 = await h.pessoaCom(c, "dono");
    const r = await criar(d2.sessao, c, servidor);
    const { segredo } = r.json<{ segredo: string }>();
    const tirar = await h.pedir(
      "POST",
      `/hub/members/mbr_${await membroDe(d2.pessoa, c)}/end`,
      {
        sessao: d1.sessao,
        comerciante: c,
      },
    );
    expect(tirar.statusCode, tirar.body).toBe(200);
    const eu = await h.app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${segredo}` },
    });
    expect(eu.statusCode).toBe(401);
  });

  it("comerciante suspenso: não cria, mas revoga; a chave de outro comerciante não existe aqui", async () => {
    const c = await novoComerciante("Loja Suspensa");
    const outro = await novoComerciante("Loja Outra");
    const d = await h.pessoaCom(c, "dono");
    const o = await h.pessoaCom(outro, "dono");
    const deOutro = (await criar(o.sessao, outro, servidor)).json<{
      id: string;
    }>().id;
    const minha = (await criar(d.sessao, c, servidor)).json<{ id: string }>()
      .id;
    expect(
      h.codigo(
        await h.pedir("POST", `/hub/keys/${deOutro}/revoke`, {
          sessao: d.sessao,
          comerciante: c,
        }),
      ),
    ).toBe("key.not_found");
    await mudarEstado(base.api, c, {
      de: "rascunho",
      para: "suspenso",
      motivo: "teste",
      quem: "teste",
    });
    expect(h.codigo(await criar(d.sessao, c, servidor))).toBe(
      "key.merchant_inactive",
    );
    const rev = await h.pedir("POST", `/hub/keys/${minha}/revoke`, {
      sessao: d.sessao,
      comerciante: c,
    });
    expect(rev.statusCode, rev.body).toBe(200);
  });

  it("§4.7: criar uma chave ao mesmo tempo que se sai da equipa espera e não deixa chave viva", async () => {
    const c = await novoComerciante("Loja Corrida");
    const d1 = await h.pessoaCom(c, "dono");
    const d2 = await h.pessoaCom(c, "dono");
    const m2 = await membroDe(d2.pessoa, c);
    let libertar = () => {};
    const aberta = new Promise<void>((r) => (libertar = r));
    let feito = () => {};
    const saiu = new Promise<void>((r) => (feito = r));
    const primeiro = base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${c}, true)`.execute(
        trx,
      );
      await sql`select membro_terminar(${d1.sessao}, ${m2}::uuid)`.execute(trx);
      feito();
      await aberta;
    });
    await saiu;
    const k = gerarChave("servidor");
    const segundo = base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${c}, true)`.execute(
        trx,
      );
      await sql`select chave_criar_pela_sessao(${d2.sessao}, 'servidor', null,
        'Corrida', ${["catalog:read"]}::text[], ${k.prefixo}, ${resumoDe(k.segredo)}, null)`.execute(
        trx,
      );
    });
    const corrida = await Promise.race([
      segundo.then(
        () => "passou",
        () => "falhou",
      ),
      new Promise((r) =>
        setTimeout(() => {
          r("à espera");
        }, 300),
      ),
    ]);
    expect(corrida).toBe("à espera");
    libertar();
    await primeiro;
    await expect(segundo).rejects.toThrow(/^auth\.forbidden:/);
  });
});
