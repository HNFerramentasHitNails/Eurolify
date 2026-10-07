import { generate } from "otplib";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste, ipNovo } from "./hub-de-teste.js";

// Rotas do Hub da parte B3b (docs/21 §4.3, §8 e §12; migração 0024; testes
// P-T5 e P-T11 do §9; decisões CA, CG e CI; issue #140): a palavra-passe com
// o TOTP. Contra o PostgreSQL 18, com o Argon2id dos parâmetros da CG.

const agora = () => Math.floor(Date.now() / 1000);
const codigoEm = (segredo: string, epoch: number) =>
  generate({ secret: segredo, epoch });

describe.skipIf(URL_BASE === undefined)("palavra-passe e TOTP (0024)", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  let a: string;

  /** Uma pessoa com a palavra-passe activa; devolve o segredo TOTP. */
  async function comPalavraPasse(palavra = "uma frase bem comprida") {
    const p = await h.pessoaCom(a, "apoio");
    const setup = await h.pedir("POST", "/hub/password/setup", {
      sessao: p.sessao,
      corpo: { palavra_passe: palavra },
    });
    expect(setup.statusCode, setup.body).toBe(200);
    const { segredo, uri } = setup.json<{ segredo: string; uri: string }>();
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    const confirmar = await h.pedir("POST", "/hub/password/confirm", {
      sessao: p.sessao,
      corpo: { codigo: await codigoEm(segredo, agora()) },
    });
    expect(confirmar.statusCode, confirmar.body).toBe(200);
    return {
      ...p,
      segredoTotp: segredo,
      palavra,
      sessao: h.cookieDe(confirmar),
    };
  }

  const entrar = (
    email: string,
    palavra: string,
    codigo: string,
    ip?: string,
  ) =>
    h.pedir("POST", "/hub/session/password", {
      ...(ip === undefined ? {} : { ip }),
      corpo: { email, palavra_passe: palavra, codigo },
    });

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    h = hubDeTeste(base, { comTotp: true });
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

  it("escolher não activa nada; confirmar com um código errado é recusado", async () => {
    const p = await h.pessoaCom(a, "apoio");
    const setup = await h.pedir("POST", "/hub/password/setup", {
      sessao: p.sessao,
      corpo: { palavra_passe: "uma frase bem comprida" },
    });
    const { segredo } = setup.json<{ segredo: string }>();
    expect(setup.headers["cache-control"]).toBe("no-store");
    const antes = await entrar(
      p.email,
      "uma frase bem comprida",
      await codigoEm(segredo, agora()),
    );
    expect(antes.statusCode).toBe(401);
    const errado = await h.pedir("POST", "/hub/password/confirm", {
      sessao: p.sessao,
      corpo: { codigo: "000000" },
    });
    expect(h.codigo(errado)).toBe("password.invalid_code");
  });

  it("confirmar faz cair as outras sessões e dá uma nova a quem pediu", async () => {
    const p = await h.pessoaCom(a, "apoio");
    const outra = h.cookieDe(await h.entrar(p.autenticador));
    const setup = await h.pedir("POST", "/hub/password/setup", {
      sessao: p.sessao,
      corpo: { palavra_passe: "uma frase bem comprida" },
    });
    const { segredo } = setup.json<{ segredo: string }>();
    const r = await h.pedir("POST", "/hub/password/confirm", {
      sessao: p.sessao,
      corpo: { codigo: await codigoEm(segredo, agora()) },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(
      (await h.pedir("GET", "/hub/me", { sessao: outra })).statusCode,
    ).toBe(401);
    expect(
      (await h.pedir("GET", "/hub/me", { sessao: p.sessao })).statusCode,
    ).toBe(401);
    expect(
      (await h.pedir("GET", "/hub/me", { sessao: h.cookieDe(r) })).statusCode,
    ).toBe(200);
  });

  describe("P-T11: entrar com e-mail + palavra-passe + código", () => {
    it("entra; o mesmo código não vale duas vezes; o seguinte vale", async () => {
      const p = await comPalavraPasse();
      // O código da confirmação já foi gasto: o da janela seguinte entra.
      const seguinte = await codigoEm(p.segredoTotp, agora() + 30);
      const r = await entrar(p.email.toUpperCase(), p.palavra, seguinte);
      expect(r.statusCode, r.body).toBe(201);
      expect(
        (await h.pedir("GET", "/hub/me", { sessao: h.cookieDe(r) })).statusCode,
      ).toBe(200);
      const outraVez = await entrar(p.email, p.palavra, seguinte);
      expect(outraVez.statusCode).toBe(401);
    });

    it("a palavra-passe sozinha nunca entra; a errada nem com o código certo", async () => {
      const p = await comPalavraPasse();
      const semCodigo = await h.pedir("POST", "/hub/session/password", {
        corpo: { email: p.email, palavra_passe: p.palavra },
      });
      expect(semCodigo.statusCode).toBe(400);
      const errada = await entrar(
        p.email,
        "outra frase comprida",
        await codigoEm(p.segredoTotp, agora() + 30),
      );
      expect(errada.statusCode).toBe(401);
      const codigoErrado = await entrar(p.email, p.palavra, "123456");
      expect(codigoErrado.statusCode).toBe(401);
    });

    it("a mesma recusa para um e-mail sem conta", async () => {
      const p = await comPalavraPasse();
      const semConta = await entrar(
        "ninguem@exemplo.test",
        p.palavra,
        "123456",
      );
      const errada = await entrar(p.email, "outra frase comprida", "123456");
      expect(semConta.statusCode).toBe(401);
      expect(h.codigo(semConta)).toBe(h.codigo(errada));
    });

    it("5 falhas do mesmo IP bloqueiam, mesmo com tudo certo (CI)", async () => {
      const p = await comPalavraPasse();
      const ip = ipNovo();
      for (let i = 0; i < 5; i++) {
        expect(
          (await entrar(p.email, "outra frase comprida", "123456", ip))
            .statusCode,
        ).toBe(401);
      }
      const certo = await entrar(
        p.email,
        p.palavra,
        await codigoEm(p.segredoTotp, agora() + 30),
        ip,
      );
      expect(certo.statusCode).toBe(429);
      // De outro IP, entra.
      const outro = await entrar(
        p.email,
        p.palavra,
        await codigoEm(p.segredoTotp, agora() + 30),
      );
      expect(outro.statusCode, outro.body).toBe(201);
    });
  });

  describe("retirar e a última forma de entrar", () => {
    it("com a palavra-passe activa, a última passkey sai; depois a palavra-passe já não", async () => {
      const p = await comPalavraPasse();
      const lista = await h.pedir("GET", "/hub/passkeys", { sessao: p.sessao });
      const [unica] = lista.json<{ passkeys: { passkey: string }[] }>()
        .passkeys;
      const r = await h.pedir(
        "POST",
        `/hub/passkeys/${unica?.passkey ?? ""}/remove`,
        { sessao: p.sessao },
      );
      expect(r.statusCode, r.body).toBe(200);
      const sessao = h.cookieDe(r);
      const retirar = await h.pedir("POST", "/hub/password/remove", { sessao });
      expect(h.codigo(retirar)).toBe("password.last_credential");
    });

    it("com passkey, retirar a palavra-passe funciona e ela deixa de entrar", async () => {
      const p = await comPalavraPasse();
      const r = await h.pedir("POST", "/hub/password/remove", {
        sessao: p.sessao,
      });
      expect(r.statusCode, r.body).toBe(200);
      const depois = await entrar(
        p.email,
        p.palavra,
        await codigoEm(p.segredoTotp, agora() + 30),
      );
      expect(depois.statusCode).toBe(401);
    });
  });

  describe("na base", () => {
    it("o segredo TOTP não fica legível e o resumo é Argon2id com os parâmetros da CG", async () => {
      const p = await comPalavraPasse();
      const { rows } = await sql<{ resumo: string; cifrado: string }>`
        select resumo, encode(totp_cifrado, 'escape') as cifrado from palavra_passe
        where pessoa_id = ${p.pessoa}::uuid`.execute(base.dono);
      expect(rows[0]?.resumo).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
      expect(rows[0]?.cifrado ?? "").not.toContain(p.segredoTotp);
      expect(rows[0]?.resumo ?? "").not.toContain(p.palavra);
    });

    it("a base recusa o mesmo passo do TOTP duas vezes, mesmo sem a biblioteca", async () => {
      const p = await comPalavraPasse();
      const { rows } = await sql<{ passo: string }>`
        select ultimo_passo as passo from palavra_passe
        where pessoa_id = ${p.pessoa}::uuid and estado = 'activa'`.execute(
        base.dono,
      );
      const passo = Number(rows[0]?.passo ?? 0) + 1;
      const entrarNaBase = () =>
        sql`select entrar_com_palavra_passe(${p.pessoa}::uuid, ${passo},
          ${"a".repeat(64)}, null)`.execute(base.dono);
      await entrarNaBase();
      await expect(entrarNaBase()).rejects.toThrow(/^auth\.unauthenticated:/);
    });

    it("a base recusa um Argon2id abaixo dos parâmetros da CG", async () => {
      const p = await h.pessoaCom(a, "apoio");
      const fraco =
        "$argon2id$v=19$m=4096,t=1,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaA";
      await expect(
        sql`select palavra_passe_preparar(${p.sessao}, ${fraco}, ${Buffer.alloc(48)}, 1)`.execute(
          base.dono,
        ),
      ).rejects.toThrow(/^password\.weak_parameters:/);
    });
  });

  it("P-T5: nem a palavra-passe, nem o código, nem o e-mail no registo da aplicação", async () => {
    const p = await comPalavraPasse("frase secreta de teste");
    const codigo = await codigoEm(p.segredoTotp, agora() + 30);
    await entrar(p.email, p.palavra, codigo);
    const texto = h.registo.join("");
    expect(texto.length).toBeGreaterThan(0);
    // O código (6 dígitos) não entra na lista: números assim aparecem por
    // acaso nas horas do registo.
    for (const proibido of [p.palavra, p.segredoTotp, p.email]) {
      expect(texto).not.toContain(proibido);
    }
  });
});
