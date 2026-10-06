import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { serializadores } from "../src/base/registo.js";
import {
  mudarEstado,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { configHub, resumo } from "../src/identidade/sessoes.js";
import { AutenticadorDeTeste } from "./autenticador-de-teste.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Rotas do Hub da parte B2 (docs/21 §3, §4 e §11; migração 0019; testes
// P-T1, P-T3, P-T5, P-T12, P-T13, P-T14 e P-T16 do §9; issue #140). Contra o
// PostgreSQL 18 verdadeiro, com o eurolify_api e um autenticador WebAuthn em
// software.

const ORIGEM = "https://hub.exemplo.test";
const HUB = configHub(ORIGEM);
const OPERADOR = "operador:github:1001";
const COOKIE = "__Host-eurolify_sessao";

type Resposta = Awaited<ReturnType<ReturnType<typeof criarApp>["inject"]>>;

describe.skipIf(URL_BASE === undefined)("rotas do Hub (0019)", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let registo: string[];
  let a: string;
  let b: string;

  interface Pedido {
    corpo?: unknown;
    sessao?: string;
    comerciante?: string;
    origem?: string | null;
    tipo?: string;
  }

  const pedir = (metodo: "GET" | "POST", url: string, p: Pedido = {}) => {
    const cabecalhos: Record<string, string> = {};
    if (p.origem !== null) cabecalhos["origin"] = p.origem ?? ORIGEM;
    if (p.sessao !== undefined) cabecalhos["cookie"] = `${COOKIE}=${p.sessao}`;
    if (p.comerciante !== undefined) {
      cabecalhos["eurolify-comerciante"] = `mer_${p.comerciante}`;
    }
    if (metodo === "POST") {
      cabecalhos["content-type"] = p.tipo ?? "application/json";
    }
    return app.inject({
      method: metodo,
      url,
      headers: cabecalhos,
      ...(metodo === "POST" ? { payload: JSON.stringify(p.corpo ?? {}) } : {}),
    });
  };

  const codigo = (r: Resposta) => r.json<{ codigo?: string }>().codigo;

  /** O segredo do cookie da sessão numa resposta, e os atributos. */
  function cookieDe(r: Resposta) {
    const valor = r.headers["set-cookie"];
    const linha = (Array.isArray(valor) ? valor : [valor ?? ""]).find((l) =>
      l.startsWith(`${COOKIE}=`),
    );
    if (linha === undefined) throw new Error("sem cookie da sessão");
    const [par = "", ...atributos] = linha.split(";").map((x) => x.trim());
    return { segredo: par.slice(COOKIE.length + 1), atributos };
  }

  async function conviteDoOperador(
    comerciante: string,
    email: string,
    papel: string,
  ) {
    const segredo = `euc_${randomBytes(32).toString("base64url")}`;
    await sql`select convite_criar_pelo_operador(${comerciante}::uuid, ${email},
      ${papel}, ${resumo(segredo)}, ${OPERADOR})`.execute(base.dono);
    return segredo;
  }

  /** Cria a conta pelo convite, com uma passkey nova; devolve a sessão. */
  async function contaPeloConvite(
    convite: string,
    autenticador = new AutenticadorDeTeste(),
  ) {
    const opcoes = await pedir("POST", "/hub/invitations/accept/options", {
      corpo: { convite },
    });
    expect(opcoes.statusCode, opcoes.body).toBe(200);
    const { challenge } = opcoes.json<{ challenge: string }>();
    const r = await pedir("POST", "/hub/invitations/accept-new", {
      corpo: {
        convite,
        nome: "Pessoa Teste",
        credencial: autenticador.registar(challenge, {
          origem: ORIGEM,
          rpId: HUB.rpId,
        }),
      },
    });
    return { resposta: r, autenticador };
  }

  async function pessoaCom(comerciante: string, papel: string) {
    const email = `p${randomBytes(4).toString("hex")}@exemplo.test`;
    const { resposta, autenticador } = await contaPeloConvite(
      await conviteDoOperador(comerciante, email, papel),
    );
    expect(resposta.statusCode, resposta.body).toBe(201);
    const corpo = resposta.json<{ pessoa: string }>();
    return {
      email,
      pessoa: corpo.pessoa.slice("per_".length),
      sessao: cookieDe(resposta).segredo,
      autenticador,
    };
  }

  async function desafioDeEntrada() {
    const r = await pedir("POST", "/hub/session/options");
    expect(r.statusCode, r.body).toBe(200);
    return r.json<{ challenge: string }>().challenge;
  }

  const entrar = (credencial: unknown) =>
    pedir("POST", "/hub/session", { corpo: { credencial } });

  async function membroDe(pessoa: string, comerciante: string) {
    const { rows } = await sql<{ id: string }>`
      select id from membro where pessoa_id = ${pessoa}::uuid
        and comerciante_id = ${comerciante}::uuid and ate is null`.execute(
      base.dono,
    );
    return rows[0]?.id ?? "";
  }

  async function envelhecerSessao(
    segredo: string,
    coluna: string,
    intervalo: string,
  ) {
    await base.dono.transaction().execute(async (trx) => {
      await sql`alter table sessao disable trigger sessao_antes_de_gravar`.execute(
        trx,
      );
      await sql`update sessao set ${sql.ref(coluna)} = now() - ${intervalo}::interval
        where resumo = ${resumo(segredo)}`.execute(trx);
      await sql`alter table sessao enable always trigger sessao_antes_de_gravar`.execute(
        trx,
      );
    });
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    registo = [];
    const destino = new Writable({
      write(pedaco: Buffer, _codificacao, feito) {
        registo.push(pedaco.toString());
        feito();
      },
    });
    app = criarApp(
      {
        logger: { level: "info", stream: destino, serializers: serializadores },
      },
      undefined,
      base.api,
      HUB,
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
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  describe("conta nova pelo convite e entrar (§4.2, §4.3)", () => {
    it("o convite cria a conta, a passkey e a sessão; o cookie é __Host-, Secure, HttpOnly e SameSite=Strict", async () => {
      const convite = await conviteDoOperador(a, "dona@exemplo.test", "dono");
      const { resposta } = await contaPeloConvite(convite);
      expect(resposta.statusCode, resposta.body).toBe(201);
      const { atributos } = cookieDe(resposta);
      const minusculas = atributos.map((x) => x.toLowerCase());
      expect(minusculas).toEqual(
        expect.arrayContaining([
          "path=/",
          "secure",
          "httponly",
          "samesite=strict",
        ]),
      );
      expect(minusculas.some((x) => x.startsWith("domain="))).toBe(false);

      const eu = await pedir("GET", "/hub/me", {
        sessao: cookieDe(resposta).segredo,
      });
      expect(eu.statusCode, eu.body).toBe(200);
      expect(eu.json()).toMatchObject({
        email: "dona@exemplo.test",
        comerciantes: [
          { comerciante: `mer_${a}`, nome: "Loja A", papel: "dono" },
        ],
      });
    });

    it("entrar com a passkey dá uma sessão nova, com segredo novo a cada entrada (P-T13)", async () => {
      const p = await pessoaCom(a, "apoio");
      const r1 = await entrar(
        p.autenticador.assinar(await desafioDeEntrada(), {
          origem: ORIGEM,
          rpId: HUB.rpId,
        }),
      );
      expect(r1.statusCode, r1.body).toBe(201);
      const r2 = await entrar(
        p.autenticador.assinar(await desafioDeEntrada(), {
          origem: ORIGEM,
          rpId: HUB.rpId,
        }),
      );
      expect(r2.statusCode, r2.body).toBe(201);
      const s1 = cookieDe(r1).segredo;
      const s2 = cookieDe(r2).segredo;
      expect(new Set([p.sessao, s1, s2]).size).toBe(3);
      expect((await pedir("GET", "/hub/me", { sessao: s2 })).statusCode).toBe(
        200,
      );
    });

    it("um e-mail com conta não cria outra: 409, e aceita-se autenticado", async () => {
      const p = await pessoaCom(b, "apoio");
      const convite = await conviteDoOperador(a, p.email, "gestor");
      const { resposta } = await contaPeloConvite(convite);
      expect(resposta.statusCode).toBe(409);
      expect(codigo(resposta)).toBe("invite.account_exists");
      const aceite = await pedir("POST", "/hub/invitations/accept", {
        sessao: p.sessao,
        corpo: { convite },
      });
      expect(aceite.statusCode, aceite.body).toBe(200);
      expect(aceite.json()).toMatchObject({ comerciante: `mer_${a}` });
    });

    it("um convite que não vale dá 404 já nas opções", async () => {
      const r = await pedir("POST", "/hub/invitations/accept/options", {
        corpo: { convite: `euc_${randomBytes(32).toString("base64url")}` },
      });
      expect(r.statusCode).toBe(404);
      expect(codigo(r)).toBe("invite.invalid");
    });
  });

  describe("P-T14: WebAuthn recusa o que não é desta origem, deste rpID, verificado e com o contador a avançar", () => {
    const casos: [string, (x: AutenticadorDeTeste, d: string) => unknown][] = [
      [
        "outra origem",
        (x, d) =>
          x.assinar(d, {
            origem: "https://outro.exemplo.test",
            rpId: HUB.rpId,
          }),
      ],
      [
        "outro rpID",
        (x, d) => x.assinar(d, { origem: ORIGEM, rpId: "outro.exemplo.test" }),
      ],
      [
        "sem verificação do utilizador",
        (x, d) =>
          x.assinar(d, {
            origem: ORIGEM,
            rpId: HUB.rpId,
            semVerificacao: true,
          }),
      ],
    ];
    it.each(casos)("%s → 401", async (_nome, assinar) => {
      const p = await pessoaCom(a, "apoio");
      const r = await entrar(assinar(p.autenticador, await desafioDeEntrada()));
      expect(r.statusCode).toBe(401);
      expect(codigo(r)).toBe("auth.unauthenticated");
    });

    it("o contador a recuar → 401", async () => {
      const p = await pessoaCom(a, "apoio");
      const ok = await entrar(
        p.autenticador.assinar(await desafioDeEntrada(), {
          origem: ORIGEM,
          rpId: HUB.rpId,
          contador: 5,
        }),
      );
      expect(ok.statusCode, ok.body).toBe(201);
      const r = await entrar(
        p.autenticador.assinar(await desafioDeEntrada(), {
          origem: ORIGEM,
          rpId: HUB.rpId,
          contador: 3,
        }),
      );
      expect(r.statusCode).toBe(401);
    });

    it("o mesmo desafio não vale duas vezes, e um desafio inventado não vale", async () => {
      const p = await pessoaCom(a, "apoio");
      const desafio = await desafioDeEntrada();
      const primeira = p.autenticador.assinar(desafio, {
        origem: ORIGEM,
        rpId: HUB.rpId,
      });
      expect((await entrar(primeira)).statusCode).toBe(201);
      const segunda = p.autenticador.assinar(desafio, {
        origem: ORIGEM,
        rpId: HUB.rpId,
      });
      expect((await entrar(segunda)).statusCode).toBe(401);
      const inventado = p.autenticador.assinar(
        randomBytes(32).toString("base64url"),
        { origem: ORIGEM, rpId: HUB.rpId },
      );
      expect((await entrar(inventado)).statusCode).toBe(401);
    });

    it("um registo sem verificação do utilizador não cria a conta", async () => {
      const convite = await conviteDoOperador(
        a,
        "sem-uv@exemplo.test",
        "apoio",
      );
      const opcoes = await pedir("POST", "/hub/invitations/accept/options", {
        corpo: { convite },
      });
      const { challenge } = opcoes.json<{ challenge: string }>();
      const r = await pedir("POST", "/hub/invitations/accept-new", {
        corpo: {
          convite,
          nome: "Sem UV",
          credencial: new AutenticadorDeTeste().registar(challenge, {
            origem: ORIGEM,
            rpId: HUB.rpId,
            semVerificacao: true,
          }),
        },
      });
      expect(r.statusCode).toBe(401);
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pessoa where email = 'sem-uv@exemplo.test'`.execute(
        base.dono,
      );
      expect(rows[0]?.n).toBe(0);
    });

    it("uma passkey sem contador (sincronizada) entra sempre com 0", async () => {
      const convite = await conviteDoOperador(
        a,
        "sincronizada@exemplo.test",
        "apoio",
      );
      const { resposta, autenticador } = await contaPeloConvite(
        convite,
        new AutenticadorDeTeste(false),
      );
      expect(resposta.statusCode, resposta.body).toBe(201);
      for (let i = 0; i < 2; i++) {
        const r = await entrar(
          autenticador.assinar(await desafioDeEntrada(), {
            origem: ORIGEM,
            rpId: HUB.rpId,
          }),
        );
        expect(r.statusCode, r.body).toBe(201);
      }
    });
  });

  describe("P-T1: sem sessão válida, 401", () => {
    it("sem cookie, inventada, terminada, parada 12 h ou de pessoa desactivada", async () => {
      expect(codigo(await pedir("GET", "/hub/me"))).toBe(
        "auth.session_required",
      );
      const inventada = `eus_${randomBytes(32).toString("base64url")}`;
      expect(
        (await pedir("GET", "/hub/me", { sessao: inventada })).statusCode,
      ).toBe(401);
      expect(
        (await pedir("GET", "/hub/me", { sessao: "lixo" })).statusCode,
      ).toBe(401);

      const p = await pessoaCom(a, "apoio");
      const fim = await pedir("POST", "/hub/session/end", { sessao: p.sessao });
      expect(fim.statusCode, fim.body).toBe(200);
      expect(String(fim.headers["set-cookie"])).toContain(`${COOKIE}=;`);
      expect(
        (await pedir("GET", "/hub/me", { sessao: p.sessao })).statusCode,
      ).toBe(401);

      const q = await pessoaCom(a, "apoio");
      await envelhecerSessao(q.sessao, "ultimo_uso_em", "12 hours 1 minute");
      expect(
        (await pedir("GET", "/hub/me", { sessao: q.sessao })).statusCode,
      ).toBe(401);

      const d = await pessoaCom(a, "apoio");
      await sql`select pessoa_desactivar(${d.pessoa}::uuid, ${OPERADOR})`.execute(
        base.dono,
      );
      expect(
        (await pedir("GET", "/hub/me", { sessao: d.sessao })).statusCode,
      ).toBe(401);
      const r = await entrar(
        d.autenticador.assinar(await desafioDeEntrada(), {
          origem: ORIGEM,
          rpId: HUB.rpId,
        }),
      );
      expect(r.statusCode).toBe(401);
    });
  });

  describe("P-T12: escritas só da origem do Hub e em JSON", () => {
    it("sem Origin, com outra Origin ou sem JSON → recusado", async () => {
      const p = await pessoaCom(a, "dono");
      const semOrigem = await pedir("POST", "/hub/session/end", {
        sessao: p.sessao,
        origem: null,
      });
      expect(semOrigem.statusCode).toBe(403);
      expect(codigo(semOrigem)).toBe("auth.origin_rejected");
      const outra = await pedir("POST", "/hub/session/options", {
        origem: "https://mau.exemplo.test",
      });
      expect(outra.statusCode).toBe(403);
      const texto = await pedir("POST", "/hub/session/end", {
        sessao: p.sessao,
        tipo: "text/plain",
      });
      expect(texto.statusCode).toBe(415);
      // Nada disto terminou a sessão.
      expect(
        (await pedir("GET", "/hub/me", { sessao: p.sessao })).statusCode,
      ).toBe(200);
    });
  });

  describe("autenticação recente e reautenticar (§4.3; P-T13)", () => {
    it("convidar exige autenticação recente; reautenticar troca a sessão e a antiga deixa de valer", async () => {
      const d = await pessoaCom(a, "dono");
      await envelhecerSessao(d.sessao, "autenticada_em", "11 minutes");
      const corpo = { email: "novo@exemplo.test", papel: "apoio" };
      const velho = await pedir("POST", "/hub/invitations", {
        sessao: d.sessao,
        comerciante: a,
        corpo,
      });
      expect(velho.statusCode).toBe(403);
      expect(codigo(velho)).toBe("auth.reauthentication_required");

      const r = await pedir("POST", "/hub/session/reauthenticate", {
        sessao: d.sessao,
        corpo: {
          credencial: d.autenticador.assinar(await desafioDeEntrada(), {
            origem: ORIGEM,
            rpId: HUB.rpId,
          }),
        },
      });
      expect(r.statusCode, r.body).toBe(200);
      const nova = cookieDe(r).segredo;
      expect(nova).not.toBe(d.sessao);
      expect(
        (await pedir("GET", "/hub/me", { sessao: d.sessao })).statusCode,
      ).toBe(401);
      const convite = await pedir("POST", "/hub/invitations", {
        sessao: nova,
        comerciante: a,
        corpo,
      });
      expect(convite.statusCode, convite.body).toBe(201);
      expect(convite.json<{ segredo: string }>().segredo).toMatch(/^euc_/);
    });

    it("reautenticar com a passkey de outra pessoa → 401", async () => {
      const d = await pessoaCom(a, "dono");
      const outra = await pessoaCom(a, "apoio");
      const r = await pedir("POST", "/hub/session/reauthenticate", {
        sessao: d.sessao,
        corpo: {
          credencial: outra.autenticador.assinar(await desafioDeEntrada(), {
            origem: ORIGEM,
            rpId: HUB.rpId,
          }),
        },
      });
      expect(r.statusCode).toBe(401);
    });
  });

  describe("equipa (§4.4 a §4.6; P-T3, P-T16)", () => {
    it("o comerciante vem do cabeçalho e só com um membro activo", async () => {
      const p = await pessoaCom(a, "apoio");
      const sem = await pedir("GET", "/hub/members", { sessao: p.sessao });
      expect(sem.statusCode).toBe(400);
      const outro = await pedir("GET", "/hub/members", {
        sessao: p.sessao,
        comerciante: b,
      });
      expect(outro.statusCode).toBe(403);
      expect(codigo(outro)).toBe("auth.forbidden");
      const meu = await pedir("GET", "/hub/members", {
        sessao: p.sessao,
        comerciante: a,
      });
      expect(meu.statusCode, meu.body).toBe(200);
      expect(meu.json<{ convites: unknown }>().convites).toBeNull();
    });

    it("cada papel tenta o que não pode e falha (P-T3)", async () => {
      const c = await registarComerciante(base.api, {
        nome: "Loja Papéis",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const dono = await pessoaCom(c, "dono");
      const gestor = await pessoaCom(c, "gestor");
      const armazem = await pessoaCom(c, "armazem");
      const apoio = await pessoaCom(c, "apoio");
      const convidar = (sessao: string, papel: string) =>
        pedir("POST", "/hub/invitations", {
          sessao,
          comerciante: c,
          corpo: {
            email: `x${randomBytes(3).toString("hex")}@exemplo.test`,
            papel,
          },
        });
      expect(codigo(await convidar(gestor.sessao, "dono"))).toBe(
        "member.role_escalation",
      );
      expect(codigo(await convidar(gestor.sessao, "gestor"))).toBe(
        "member.role_escalation",
      );
      expect((await convidar(gestor.sessao, "apoio")).statusCode).toBe(201);
      expect(codigo(await convidar(armazem.sessao, "apoio"))).toBe(
        "member.role_escalation",
      );
      expect(codigo(await convidar(apoio.sessao, "apoio"))).toBe(
        "member.role_escalation",
      );

      const mApoio = await membroDe(apoio.pessoa, c);
      const papel = (sessao: string, membro: string, novo: string) =>
        pedir("POST", `/hub/members/mbr_${membro}/role`, {
          sessao,
          comerciante: c,
          corpo: { papel: novo },
        });
      expect(codigo(await papel(gestor.sessao, mApoio, "gestor"))).toBe(
        "member.role_escalation",
      );
      expect(
        codigo(
          await papel(dono.sessao, await membroDe(dono.pessoa, c), "gestor"),
        ),
      ).toBe("member.self_role_change");
      expect((await papel(dono.sessao, mApoio, "armazem")).statusCode).toBe(
        200,
      );

      const tirar = (sessao: string, membro: string) =>
        pedir("POST", `/hub/members/mbr_${membro}/end`, {
          sessao,
          comerciante: c,
        });
      expect(codigo(await tirar(gestor.sessao, mApoio))).toBe(
        "member.role_escalation",
      );
      expect(
        codigo(await tirar(dono.sessao, await membroDe(dono.pessoa, c))),
      ).toBe("member.last_owner");
      expect((await tirar(dono.sessao, mApoio)).statusCode).toBe(200);
      expect(
        (
          await pedir("GET", "/hub/members", {
            sessao: apoio.sessao,
            comerciante: c,
          })
        ).statusCode,
      ).toBe(403);

      const lista = await pedir("GET", "/hub/members", {
        sessao: dono.sessao,
        comerciante: c,
      });
      expect(lista.statusCode, lista.body).toBe(200);
      const corpo = lista.json<{ membros: unknown[]; convites: unknown[] }>();
      expect(corpo.membros).toHaveLength(3);
      expect(corpo.convites).toHaveLength(1);
    });

    it("comerciante suspenso: lê, mas não convida (P-T16, AZ)", async () => {
      const c = await registarComerciante(base.api, {
        nome: "Loja Suspensa",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const dono = await pessoaCom(c, "dono");
      await mudarEstado(base.api, c, {
        de: "rascunho",
        para: "suspenso",
        motivo: "teste",
        quem: "teste",
      });
      expect(
        (
          await pedir("GET", "/hub/members", {
            sessao: dono.sessao,
            comerciante: c,
          })
        ).statusCode,
      ).toBe(200);
      const r = await pedir("POST", "/hub/invitations", {
        sessao: dono.sessao,
        comerciante: c,
        corpo: { email: "y@exemplo.test", papel: "apoio" },
      });
      expect(r.statusCode).toBe(403);
      expect(codigo(r)).toBe("member.merchant_inactive");
    });
  });

  describe("P-T5 e o contrato", () => {
    it("nem segredos nem e-mails no registo da aplicação", async () => {
      const p = await pessoaCom(a, "dono");
      const convite = await pedir("POST", "/hub/invitations", {
        sessao: p.sessao,
        comerciante: a,
        corpo: { email: "registo@exemplo.test", papel: "apoio" },
      });
      const { segredo } = convite.json<{ segredo: string }>();
      const texto = registo.join("");
      expect(texto.length).toBeGreaterThan(0);
      for (const proibido of [
        p.sessao,
        segredo,
        p.email,
        "registo@exemplo.test",
        "dona@exemplo.test",
      ]) {
        expect(texto).not.toContain(proibido);
      }
    });

    it("as rotas do Hub estão no contrato com a segurança da sessão", async () => {
      const r = await app.inject({ method: "GET", url: "/openapi.json" });
      const contrato = r.json<{
        paths: Record<string, Record<string, { security?: unknown }>>;
      }>();
      expect(contrato.paths["/hub/me"]?.["get"]?.security).toEqual([
        { sessao: [] },
      ]);
      expect(
        contrato.paths["/hub/session"]?.["post"]?.security,
      ).toBeUndefined();
    });
  });
});
