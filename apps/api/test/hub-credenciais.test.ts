import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { AutenticadorDeTeste } from "./autenticador-de-teste.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste, NO_HUB } from "./hub-de-teste.js";

// Rotas do Hub da parte B3a (docs/21 §7, §8 e §12; migração 0021; testes
// P-T5, P-T6 e P-T18 do §9; issue #140): acrescentar e retirar passkeys, as
// sessões abertas, os códigos de recuperação e recuperar a conta, com o
// limite de tentativas e o registo de entradas. Contra o PostgreSQL 18.

describe.skipIf(URL_BASE === undefined)("credenciais no Hub (0021)", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  let a: string;

  /** Uma passkey nova na conta da sessão (recente). */
  async function acrescentar(sessao: string, x = new AutenticadorDeTeste()) {
    const opcoes = await h.pedir("POST", "/hub/passkeys/options", { sessao });
    expect(opcoes.statusCode, opcoes.body).toBe(200);
    const { challenge } = opcoes.json<{ challenge: string }>();
    const r = await h.pedir("POST", "/hub/passkeys", {
      sessao,
      corpo: { nome: "Portátil", credencial: x.registar(challenge, NO_HUB) },
    });
    return { resposta: r, autenticador: x };
  }

  /** Recuperar: passo 1 e, se correr bem, o passo 2 com uma passkey nova. */
  async function recuperar(email: string, codigo: string) {
    const opcoes = await h.pedir("POST", "/hub/recovery/options", {
      corpo: { email, codigo },
    });
    if (opcoes.statusCode !== 200) return { opcoes, fim: null };
    const x = new AutenticadorDeTeste();
    const fim = await h.pedir("POST", "/hub/recovery", {
      corpo: {
        email,
        codigo,
        credencial: x.registar(
          opcoes.json<{ challenge: string }>().challenge,
          NO_HUB,
        ),
      },
    });
    return { opcoes, fim, autenticador: x };
  }

  const vale = async (sessao: string) =>
    (await h.pedir("GET", "/hub/me", { sessao })).statusCode;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    h = hubDeTeste(base);
    a = await registarComerciante(base.api, {
      nome: "Loja A",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
  }, 60_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  it("a conta nova recebe 10 códigos diferentes, de 80 bits, só nessa resposta", async () => {
    const p = await h.pessoaCom(a, "apoio");
    expect(p.codigos).toHaveLength(10);
    expect(new Set(p.codigos).size).toBe(10);
    for (const c of p.codigos) {
      expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from codigo_recuperacao
      where pessoa_id = ${p.pessoa}::uuid`.execute(base.dono);
    expect(rows[0]?.n).toBe(10);
  });

  describe("passkeys", () => {
    it("acrescentar exige autenticação recente, não repete credenciais e a nova entra", async () => {
      const p = await h.pessoaCom(a, "apoio");
      await h.envelhecerSessao(p.sessao, "autenticada_em", "11 minutes");
      const velho = await h.pedir("POST", "/hub/passkeys/options", {
        sessao: p.sessao,
      });
      expect(h.codigo(velho)).toBe("auth.reauthentication_required");

      const q = await h.pessoaCom(a, "apoio");
      const opcoes = await h.pedir("POST", "/hub/passkeys/options", {
        sessao: q.sessao,
      });
      const excluidas = opcoes.json<{ excludeCredentials: { id: string }[] }>()
        .excludeCredentials;
      expect(excluidas.map((c) => c.id)).toEqual([q.autenticador.id]);

      const { resposta, autenticador } = await acrescentar(q.sessao);
      expect(resposta.statusCode, resposta.body).toBe(201);
      expect((await h.entrar(autenticador)).statusCode).toBe(201);
      const lista = await h.pedir("GET", "/hub/passkeys", { sessao: q.sessao });
      expect(lista.json<{ passkeys: unknown[] }>().passkeys).toHaveLength(2);

      // A mesma credencial noutra conta: recusada.
      const outra = await h.pessoaCom(a, "apoio");
      const repetida = await acrescentar(outra.sessao, q.autenticador);
      expect(h.codigo(repetida.resposta)).toBe("passkey.already_registered");
    });

    it("retirar: nunca a última; com outra, todas as sessões caem e quem pediu recebe uma nova", async () => {
      const p = await h.pessoaCom(a, "apoio");
      const lista = async (sessao: string) =>
        (await h.pedir("GET", "/hub/passkeys", { sessao })).json<{
          passkeys: { passkey: string }[];
        }>().passkeys;
      const [unica] = await lista(p.sessao);
      const ultima = await h.pedir(
        "POST",
        `/hub/passkeys/${unica?.passkey ?? ""}/remove`,
        { sessao: p.sessao },
      );
      expect(h.codigo(ultima)).toBe("passkey.last_credential");

      const { autenticador: segunda } = await acrescentar(p.sessao);
      const outraSessao = h.cookieDe(await h.entrar(segunda));
      const r = await h.pedir(
        "POST",
        `/hub/passkeys/${unica?.passkey ?? ""}/remove`,
        { sessao: p.sessao },
      );
      expect(r.statusCode, r.body).toBe(200);
      const nova = h.cookieDe(r);
      expect(await vale(p.sessao)).toBe(401);
      expect(await vale(outraSessao)).toBe(401);
      expect(await vale(nova)).toBe(200);
      expect((await h.entrar(p.autenticador)).statusCode).toBe(401);
      expect((await h.entrar(segunda)).statusCode).toBe(201);
    });
  });

  describe("sessões abertas", () => {
    it("lista as sessões e termina todas, dando uma nova a quem pediu", async () => {
      const p = await h.pessoaCom(a, "apoio");
      const outra = h.cookieDe(await h.entrar(p.autenticador));
      const lista = await h.pedir("GET", "/hub/sessions", { sessao: p.sessao });
      const sessoes = lista.json<{ sessoes: { esta: boolean }[] }>().sessoes;
      expect(sessoes).toHaveLength(2);
      expect(sessoes.filter((x) => x.esta)).toHaveLength(1);

      const r = await h.pedir("POST", "/hub/sessions/end-all", {
        sessao: p.sessao,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(await vale(p.sessao)).toBe(401);
      expect(await vale(outra)).toBe(401);
      expect(await vale(h.cookieDe(r))).toBe(200);
    });
  });

  describe("recuperar a conta (§7; P-T6, P-T18)", () => {
    it("com um código: passkey nova, todas as sessões caem, o código não volta a valer", async () => {
      const p = await h.pessoaCom(a, "apoio");
      const codigo = p.codigos[0] ?? "";
      const { opcoes, fim, autenticador } = await recuperar(
        p.email.toUpperCase(),
        codigo.toLowerCase(),
      );
      expect(opcoes.statusCode, opcoes.body).toBe(200);
      expect(fim?.statusCode, fim?.body).toBe(201);
      expect(await vale(p.sessao)).toBe(401);
      expect(await vale(h.cookieDe(fim ?? opcoes))).toBe(200);
      expect((await h.entrar(autenticador ?? p.autenticador)).statusCode).toBe(
        201,
      );
      const outra = await recuperar(p.email, codigo);
      expect(outra.opcoes.statusCode).toBe(401);
      // Os outros 9 ainda valem.
      const segundo = await h.pedir("POST", "/hub/recovery/options", {
        corpo: { email: p.email, codigo: p.codigos[1] },
      });
      expect(segundo.statusCode).toBe(200);
    });

    it("a mesma recusa para e-mail sem conta e código errado", async () => {
      const p = await h.pessoaCom(a, "apoio");
      const semConta = await h.pedir("POST", "/hub/recovery/options", {
        corpo: { email: "ninguem@exemplo.test", codigo: p.codigos[0] },
      });
      const errado = await h.pedir("POST", "/hub/recovery/options", {
        corpo: { email: p.email, codigo: "AAAA-AAAA-AAAA-AAAA" },
      });
      expect(semConta.statusCode).toBe(401);
      expect(errado.statusCode).toBe(401);
      expect(h.codigo(semConta)).toBe(h.codigo(errado));
    });

    it("o desafio de recuperação é da pessoa do código: com o código de outra, não serve", async () => {
      const p = await h.pessoaCom(a, "apoio");
      const q = await h.pessoaCom(a, "apoio");
      const opcoes = await h.pedir("POST", "/hub/recovery/options", {
        corpo: { email: p.email, codigo: p.codigos[0] },
      });
      const x = new AutenticadorDeTeste();
      const r = await h.pedir("POST", "/hub/recovery", {
        corpo: {
          email: q.email,
          codigo: q.codigos[0],
          credencial: x.registar(
            opcoes.json<{ challenge: string }>().challenge,
            NO_HUB,
          ),
        },
      });
      expect(r.statusCode).toBe(401);
      expect(await vale(q.sessao)).toBe(200);
    });

    it("5 falhas em 15 minutos bloqueiam, mesmo com o código certo; fica no registo de entradas sem o e-mail", async () => {
      const p = await h.pessoaCom(a, "apoio");
      for (let i = 0; i < 5; i++) {
        const r = await h.pedir("POST", "/hub/recovery/options", {
          corpo: { email: p.email, codigo: "BBBB-BBBB-BBBB-BBBB" },
        });
        expect(r.statusCode).toBe(401);
      }
      const certo = await h.pedir("POST", "/hub/recovery/options", {
        corpo: { email: p.email, codigo: p.codigos[0] },
      });
      expect(certo.statusCode).toBe(429);
      expect(h.codigo(certo)).toBe("auth.locked");
      const { rows } = await sql<{ resultado: string; n: number }>`
        select resultado, count(*)::int as n from entrada
        where metodo = 'recuperacao' and email_resumo = encode(sha256(convert_to(lower(${p.email}), 'UTF8')), 'hex')
        group by resultado order by resultado`.execute(base.dono);
      expect(rows).toEqual([
        { resultado: "bloqueado", n: 1 },
        { resultado: "falhou", n: 5 },
      ]);
      const texto = await sql<{ t: string }>`
        select string_agg(e::text, ' ') as t from entrada e`.execute(base.dono);
      expect(texto.rows[0]?.t ?? "").not.toContain(p.email);
    });

    it("gerar códigos novos (recente) faz os antigos deixarem de valer", async () => {
      const p = await h.pessoaCom(a, "apoio");
      const r = await h.pedir("POST", "/hub/recovery-codes", {
        sessao: p.sessao,
      });
      expect(r.statusCode, r.body).toBe(201);
      const novos = r.json<{ codigos: string[] }>().codigos;
      const antigo = await h.pedir("POST", "/hub/recovery/options", {
        corpo: { email: p.email, codigo: p.codigos[0] },
      });
      expect(antigo.statusCode).toBe(401);
      const novo = await h.pedir("POST", "/hub/recovery/options", {
        corpo: { email: p.email, codigo: novos[0] },
      });
      expect(novo.statusCode).toBe(200);
    });
  });

  it("cada entrada com passkey fica registada, com o IP", async () => {
    const p = await h.pessoaCom(a, "apoio");
    expect((await h.entrar(p.autenticador)).statusCode).toBe(201);
    const { rows } = await sql<{ metodo: string; ip: string | null }>`
      select metodo, host(ip) as ip from entrada
      where pessoa_id = ${p.pessoa}::uuid order by quando`.execute(base.dono);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.metodo === "passkey" && r.ip !== null)).toBe(
      true,
    );
  });

  it("P-T5: nem códigos, nem segredos, nem e-mails no registo da aplicação", async () => {
    const p = await h.pessoaCom(a, "apoio");
    await recuperar(p.email, p.codigos[0] ?? "");
    const texto = h.registo.join("");
    expect(texto.length).toBeGreaterThan(0);
    for (const proibido of [p.email, p.sessao, ...p.codigos]) {
      expect(texto).not.toContain(proibido);
    }
  });
});
