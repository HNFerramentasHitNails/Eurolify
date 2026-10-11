import { createServer, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  classificar,
  configSmtp,
  CorreioDeEnsaio,
  correioSmtp,
  ErroCorreio,
} from "../src/notificacoes/correio.js";
import { mensagemDe } from "../src/notificacoes/modelos.js";

// O correio e os textos das notificações (docs/33, N1, N3, N4, N6 e N8;
// revisão do #373).

/**
 * Um servidor SMTP falso, sem TLS, que responde como um servidor real a cada
 * caso: a autenticação recusada (535), o destinatário recusado (550) ou
 * adiado (451), ou tudo aceite.
 */
type Modo = "ok" | "auth535" | "rcpt550" | "rcpt451";
let modo: Modo = "ok";
const recebidos: string[] = [];
let servidor: Server;
let porta = 0;
const ligacoes = new Set<Socket>();

beforeAll(async () => {
  servidor = createServer((s) => {
    ligacoes.add(s);
    s.on("close", () => ligacoes.delete(s));
    let emDados = false;
    let pedeLogin = 0;
    let resto = "";
    const diz = (t: string) => s.write(`${t}\r\n`);
    diz("220 falso ESMTP");
    s.on("data", (bloco) => {
      resto += bloco.toString("utf8");
      let i: number;
      while ((i = resto.indexOf("\r\n")) >= 0) {
        const linha = resto.slice(0, i);
        resto = resto.slice(i + 2);
        if (emDados) {
          if (linha === ".") {
            emDados = false;
            diz("250 2.0.0 Ok: queued");
          } else {
            recebidos.push(linha);
          }
          continue;
        }
        if (pedeLogin > 0) {
          pedeLogin -= 1;
          if (pedeLogin === 1) diz("334 UGFzc3dvcmQ6");
          else
            diz(
              modo === "auth535" ? "535 5.7.8 Authentication failed" : "235 ok",
            );
          continue;
        }
        const cmd = linha.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
          diz("250-falso");
          diz("250 AUTH PLAIN LOGIN");
        } else if (cmd.startsWith("AUTH PLAIN")) {
          diz(
            modo === "auth535" ? "535 5.7.8 Authentication failed" : "235 ok",
          );
        } else if (cmd.startsWith("AUTH LOGIN")) {
          pedeLogin = 2;
          diz("334 VXNlcm5hbWU6");
        } else if (cmd.startsWith("MAIL FROM")) {
          diz("250 2.1.0 Ok");
        } else if (cmd.startsWith("RCPT TO")) {
          diz(
            modo === "rcpt550"
              ? "550 5.1.1 No such user"
              : modo === "rcpt451"
                ? "451 4.2.0 Try later"
                : "250 2.1.5 Ok",
          );
        } else if (cmd === "DATA") {
          emDados = true;
          diz("354 End data with <CR><LF>.<CR><LF>");
        } else if (cmd === "QUIT") {
          diz("221 Bye");
          s.end();
        } else {
          diz("250 Ok");
        }
      }
    });
  });
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  const endereco = servidor.address();
  porta = typeof endereco === "object" && endereco !== null ? endereco.port : 0;
});

afterAll(async () => {
  for (const s of ligacoes) s.destroy();
  await new Promise<void>((fim) => {
    servidor.close(() => {
      fim();
    });
  });
});

const correioFalso = () =>
  correioSmtp({
    anfitriao: "127.0.0.1",
    porta,
    utilizador: "avisos@eurolify.test",
    palavraPasse: "segredo",
    remetente: "Eurolify <avisos@eurolify.test>",
    exigirTls: false,
  });
const mensagem = {
  para: "ana@exemplo.pt",
  assunto: "Livre resolução: reembolsar até 25/10/2026",
  texto: "Olá,\n\nUm aviso.",
};
const falha = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (erro) {
    return erro;
  }
  return null;
};

describe("o correio das notificações", () => {
  const completo = {
    SMTP_ANFITRIAO: "ssl0.exemplo.test",
    SMTP_PORTA: "465",
    SMTP_UTILIZADOR: "avisos@eurolify.eu",
    SMTP_PALAVRA_PASSE: "segredo",
    SMTP_REMETENTE: "Eurolify <avisos@eurolify.eu>",
  };

  it("sem nenhuma variável não há correio nem problema; a meio, ou com a porta errada, diz o que falta sem os valores (N8, P2-5)", () => {
    expect(configSmtp({})).toEqual({});
    expect(configSmtp({ ...completo, SMTP_PALAVRA_PASSE: "" })).toEqual({
      problema: "faltam SMTP_PALAVRA_PASSE",
    });
    expect(
      configSmtp({ SMTP_ANFITRIAO: "x", SMTP_PORTA: "587" }).problema,
    ).toBe("faltam SMTP_UTILIZADOR, SMTP_PALAVRA_PASSE, SMTP_REMETENTE");
    for (const p of ["x", "0", "70000", "58 7"]) {
      const r = configSmtp({ ...completo, SMTP_PORTA: p });
      expect(r.config, p).toBeUndefined();
      expect(r.problema, p).toMatch(/^SMTP_PORTA/);
      expect(JSON.stringify(r)).not.toContain("segredo");
    }
    expect(configSmtp(completo).config).toEqual({
      anfitriao: "ssl0.exemplo.test",
      porta: 465,
      utilizador: "avisos@eurolify.eu",
      palavraPasse: "segredo",
      remetente: "Eurolify <avisos@eurolify.eu>",
    });
  });

  it("só o destinatário recusado falha logo; o 4xx dele repete; o resto é do servidor (P1-1)", () => {
    expect(
      classificar({ command: "RCPT TO", responseCode: 550, code: "EENVELOPE" }),
    ).toMatchObject({ codigo: "smtp_550", culpa: "destinatario_recusado" });
    expect(
      classificar({ command: "RCPT TO", responseCode: 451, code: "EENVELOPE" }),
    ).toMatchObject({ codigo: "smtp_451", culpa: "destinatario_temporario" });
    // A autenticação recusada traz 535: é da configuração, não do e-mail.
    expect(
      classificar({ command: "AUTH PLAIN", responseCode: 535, code: "EAUTH" }),
    ).toMatchObject({ codigo: "smtp_535", culpa: "servidor" });
    expect(
      classificar({
        command: "MAIL FROM",
        responseCode: 550,
        code: "EENVELOPE",
      }),
    ).toMatchObject({ culpa: "servidor" });
    expect(classificar({ code: "ECONNECTION" })).toMatchObject({
      codigo: "econnection",
      culpa: "servidor",
    });
    expect(classificar({ command: "API", code: "EENVELOPE" })).toMatchObject({
      codigo: "endereco_invalido",
      culpa: "destinatario_recusado",
    });
    expect(classificar(new Error("rui@exemplo.pt recusado"))).toMatchObject({
      codigo: "desconhecido",
      culpa: "servidor",
    });
  });

  it("contra um servidor SMTP: aceite dá o Message-ID; 535, 550 e 451 dão a culpa certa; um endereço com vírgula nem sai (P1-1, P2-3, P3-10)", async () => {
    modo = "ok";
    recebidos.length = 0;
    const r = await correioFalso().enviar(mensagem);
    expect(r.id).toMatch(/^<.+>$/);
    expect(recebidos.join("\n")).toContain("Um aviso.");
    for (const [m, codigo, culpa] of [
      ["auth535", "smtp_535", "servidor"],
      ["rcpt550", "smtp_550", "destinatario_recusado"],
      ["rcpt451", "smtp_451", "destinatario_temporario"],
    ] as const) {
      modo = m;
      const e = await falha(correioFalso().enviar(mensagem));
      expect(e, m).toBeInstanceOf(ErroCorreio);
      expect(e, m).toMatchObject({ codigo, culpa });
    }
    modo = "ok";
    for (const para of [
      "ana@exemplo.pt, rui@exemplo.pt",
      '"Ana" <ana@exemplo.pt>',
      "ana@exemplo",
    ]) {
      expect(
        await falha(correioFalso().enviar({ ...mensagem, para })),
        para,
      ).toMatchObject({ codigo: "endereco_invalido" });
    }
  });

  it("o de ensaio guarda o que sai e falha quando lhe pedem", async () => {
    const c = new CorreioDeEnsaio();
    c.falhas.push(new ErroCorreio("smtp_421", "destinatario_temporario"));
    expect(await falha(c.enviar(mensagem))).toBeInstanceOf(ErroCorreio);
    const r = await c.enviar(mensagem);
    expect(c.enviados).toEqual([{ ...mensagem, id: r.id }]);
  });

  it("os textos: a loja, a data por língua, os dias que faltam, sem o nome nem o endereço (N3, N4, P2-3, P2-4, P3-5)", () => {
    const dados = {
      loja: "Unhas\nde\u0000Gel",
      devolucao: "0199aaaa-0000-7000-8000-000000000001",
      encomenda: "0199aaaa-0000-7000-8000-000000000002",
      reembolsar_ate: "2026-10-25",
      dias: 1,
    };
    const para = { email: "ana@exemplo.pt" };
    const pt = mensagemDe("refund.deadline_approaching", "pt", dados, para);
    expect(pt).toMatchObject({
      para: "ana@exemplo.pt",
      assunto: "Livre resolução: reembolsar até 25/10/2026",
    });
    expect(pt.texto).toContain("Na loja «Unhas de Gel», a devolução rma_");
    expect(pt.texto).toContain(`ord_${dados.encomenda}`);
    expect(pt.texto).toContain("é 25/10/2026 (falta 1 dia).");
    const es = mensagemDe(
      "refund.deadline_approaching",
      "es",
      { ...dados, dias: 0 },
      para,
    );
    expect(es.assunto).toBe("Desistimiento: reembolsar hasta el 25/10/2026");
    expect(es.texto).toContain("es el 25/10/2026 (es hoy).");
    const en = mensagemDe("refund.deadline_passed", "en", dados, para);
    expect(en.assunto).toBe(
      "Withdrawal: the refund deadline has passed (2026-10-25)",
    );
    // Sem os dias, sem parênteses vazios.
    expect(
      mensagemDe(
        "refund.deadline_approaching",
        "pt",
        { ...dados, dias: null },
        para,
      ).texto,
    ).toContain("é 25/10/2026.");
    for (const m of [pt, es, en]) {
      expect(m.texto + m.assunto).not.toContain("@");
      expect(m.texto).not.toContain("\u0000");
    }
  });
});
