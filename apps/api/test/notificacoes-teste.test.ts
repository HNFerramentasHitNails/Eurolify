import { describe, expect, it } from "vitest";
import {
  type ConfigSmtp,
  CorreioDeEnsaio,
  ErroCorreio,
} from "../src/notificacoes/correio.js";
import { enviarTeste } from "../src/notificacoes/teste.js";

// O e-mail de teste da acção «configurar» (docs/34 §13.1; issue #372).

const SEGREDO = "p4ss-que-nunca-sai";
const ENV = {
  SMTP_ANFITRIAO: "smtp.exemplo.test",
  SMTP_PORTA: "587",
  SMTP_UTILIZADOR: "avisos@loja.test",
  SMTP_PALAVRA_PASSE: SEGREDO,
  SMTP_REMETENTE: "avisos@loja.test",
};

describe("o e-mail de teste", () => {
  it("vai do remetente para o próprio remetente, com a execução no texto", async () => {
    const correio = new CorreioDeEnsaio();
    let usada: ConfigSmtp | undefined;
    const r = await enviarTeste(ENV, "run:77", (c) => {
      usada = c;
      return correio;
    });
    expect(r).toEqual({ enviado: true, id: "<ensaio-1@eurolify.test>" });
    expect(usada?.palavraPasse).toBe(SEGREDO);
    expect(correio.enviados).toHaveLength(1);
    expect(correio.enviados[0]?.para).toBe("avisos@loja.test");
    expect(correio.enviados[0]?.assunto).toBe("Eurolify: e-mail de teste");
    expect(correio.enviados[0]?.texto).toContain("execução 77");
    // O resultado e o texto nunca levam a configuração.
    expect(JSON.stringify(r)).not.toContain(SEGREDO);
    expect(correio.enviados[0]?.texto).not.toContain(SEGREDO);
    expect(correio.enviados[0]?.texto).not.toContain("smtp.exemplo.test");
  });

  it("um envio recusado dá o código e a culpa, nunca a mensagem do servidor", async () => {
    const correio = new CorreioDeEnsaio();
    correio.falhas.push(new ErroCorreio("smtp_535", "servidor"));
    const r = await enviarTeste(ENV, "run:77", () => correio);
    expect(r).toEqual({
      enviado: false,
      codigo: "smtp_535",
      culpa: "servidor",
    });
  });

  it("um erro que não é do correio dá «desconhecido», sem o texto do erro", async () => {
    const r = await enviarTeste(ENV, "run:77", () => ({
      enviar: () => Promise.reject(new Error(`falhou com ${SEGREDO}`)),
    }));
    expect(r).toEqual({ enviado: false, codigo: "desconhecido" });
  });

  it("sem configuração, ou incompleta, não tenta enviar", async () => {
    const nunca = () => {
      throw new Error("não devia criar o correio");
    };
    expect(await enviarTeste({}, "run:77", nunca)).toEqual({
      enviado: false,
      codigo: "sem_configuracao",
    });
    const semPalavraPasse = { ...ENV, SMTP_PALAVRA_PASSE: "" };
    expect(await enviarTeste(semPalavraPasse, "run:77", nunca)).toEqual({
      enviado: false,
      codigo: "configuracao_incompleta",
    });
  });

  it("recusa uma execução fora do formato antes de ler a configuração", async () => {
    const nunca = () => {
      throw new Error("não devia criar o correio");
    };
    for (const e of [
      "",
      "77",
      "run:",
      "run:77 x",
      "run:12345678901234567890123",
    ]) {
      expect(await enviarTeste(ENV, e, nunca)).toEqual({
        enviado: false,
        codigo: "execucao_invalida",
      });
    }
  });
});
