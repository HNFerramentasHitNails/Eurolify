import { describe, expect, it } from "vitest";
import {
  classificar,
  configSmtp,
  CorreioDeEnsaio,
  ErroCorreio,
} from "../src/notificacoes/correio.js";
import { mensagemDe } from "../src/notificacoes/modelos.js";

// O correio e os textos das notificações (docs/33, N1, N3, N4, N6 e N8).

describe("o correio das notificações", () => {
  const completo = {
    SMTP_ANFITRIAO: "ssl0.exemplo.test",
    SMTP_PORTA: "465",
    SMTP_UTILIZADOR: "avisos@eurolify.eu",
    SMTP_PALAVRA_PASSE: "segredo",
    SMTP_REMETENTE: "Eurolify <avisos@eurolify.eu>",
  };

  it("sem as cinco variáveis não há correio; a porta tem de ser um número (N8)", () => {
    expect(configSmtp({})).toBeUndefined();
    for (const k of Object.keys(completo)) {
      if (k === "SMTP_PORTA") continue;
      expect(configSmtp({ ...completo, [k]: "" }), k).toBeUndefined();
    }
    expect(configSmtp(completo)).toEqual({
      anfitriao: "ssl0.exemplo.test",
      porta: 465,
      utilizador: "avisos@eurolify.eu",
      palavraPasse: "segredo",
      remetente: "Eurolify <avisos@eurolify.eu>",
    });
    expect(() => configSmtp({ ...completo, SMTP_PORTA: "x" })).toThrow(
      /SMTP_PORTA/,
    );
    expect(() => configSmtp({ ...completo, SMTP_PORTA: "" })).toThrow(
      /SMTP_PORTA/,
    );
  });

  it("um 4xx e a rede repetem; um 5xx e o desconhecido para a base dizem o código sem a mensagem (N6)", () => {
    expect(classificar({ responseCode: 421, response: "421 x@y" })).toEqual(
      expect.objectContaining({ codigo: "smtp_421", temporario: true }),
    );
    expect(classificar({ responseCode: 550 })).toEqual(
      expect.objectContaining({ codigo: "smtp_550", temporario: false }),
    );
    expect(classificar({ code: "ECONNECTION" })).toEqual(
      expect.objectContaining({ codigo: "econnection", temporario: true }),
    );
    expect(classificar({ code: "EENVELOPE" })).toEqual(
      expect.objectContaining({ codigo: "eenvelope", temporario: false }),
    );
    expect(classificar(new Error("rui@exemplo.pt recusado"))).toEqual(
      expect.objectContaining({ codigo: "desconhecido", temporario: true }),
    );
    // O código vai para a base: só o formato que a coluna aceita.
    for (const e of [
      classificar({ responseCode: 421 }),
      classificar({ code: "ETIMEDOUT" }),
    ]) {
      expect(e.codigo).toMatch(/^[a-z0-9_.]{1,60}$/);
    }
  });

  it("o de ensaio guarda o que sai e falha quando lhe pedem", async () => {
    const c = new CorreioDeEnsaio();
    c.falhas.push(new ErroCorreio("smtp_421", true));
    await expect(
      c.enviar({ para: "a@b.pt", assunto: "x", texto: "y" }),
    ).rejects.toBeInstanceOf(ErroCorreio);
    const r = await c.enviar({ para: "a@b.pt", assunto: "x", texto: "y" });
    expect(c.enviados).toEqual([
      { para: "a@b.pt", assunto: "x", texto: "y", id: r.id },
    ]);
  });

  it("os textos: a data por língua, os dias que faltam, sem dados do cliente (N3, N4)", () => {
    const dados = {
      devolucao: "0199aaaa-0000-7000-8000-000000000001",
      encomenda: "0199aaaa-0000-7000-8000-000000000002",
      reembolsar_ate: "2026-10-25",
      dias: 1,
    };
    const para = { email: "ana@exemplo.pt", nome: "Ana" };
    const pt = mensagemDe("refund.deadline_approaching", "pt", dados, para);
    expect(pt).toMatchObject({
      para: "ana@exemplo.pt",
      assunto: "Livre resolução: reembolsar até 25/10/2026",
    });
    expect(pt.texto).toContain(`rma_${dados.devolucao}`);
    expect(pt.texto).toContain(`ord_${dados.encomenda}`);
    expect(pt.texto).toContain("(falta 1 dia)");
    const es = mensagemDe(
      "refund.deadline_approaching",
      "es",
      { ...dados, dias: 0 },
      para,
    );
    expect(es.assunto).toBe("Desistimiento: reembolsar antes del 25/10/2026");
    expect(es.texto).toContain("(es hoy)");
    const en = mensagemDe("refund.deadline_passed", "en", dados, para);
    expect(en.assunto).toBe(
      "Withdrawal: the refund deadline has passed (2026-10-25)",
    );
    // O endereço só vai no destinatário, nunca no texto.
    for (const m of [pt, es, en]) {
      expect(m.texto + m.assunto).not.toContain("@");
    }
  });
});
