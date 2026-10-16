import { describe, expect, it } from "vitest";
import {
  assinar,
  novoSegredo,
  TOLERANCIA_SEGUNDOS,
  verificarAssinatura,
} from "../src/webhooks/assinatura.js";
import { corpoDoEvento } from "../src/webhooks/eventos.js";
import { emissorHttps } from "../src/webhooks/emissor.js";
import {
  depoisDeFalhar,
  ESPERAS_MINUTOS,
  PRAZO_HORAS,
} from "../src/webhooks/repositorio.js";
import { enderecoPublico, validarUrlDeWebhook } from "../src/webhooks/url.js";

// Os webhooks de saída sem base (docs/38): a assinatura, a repetição, o que
// sai no corpo, o endereço (SSRF) e o recuo.

describe("a assinatura (docs/38 §4)", () => {
  const segredo = novoSegredo();
  const corpo = '{"id":"evt_x"}';
  const agora = new Date("2026-10-16T12:00:00Z");
  const t = Math.floor(agora.getTime() / 1000);

  it("o segredo tem o prefixo e 32 bytes de acaso, e não se repete", () => {
    expect(segredo).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(novoSegredo()).not.toBe(segredo);
  });

  it("o receptor confere o que o Eurolify assinou", () => {
    expect(
      verificarAssinatura(segredo, corpo, assinar(segredo, corpo, t), agora),
    ).toEqual({ ok: true });
  });

  it("um corpo mudado, outro segredo ou um formato estranho não passam", () => {
    const cab = assinar(segredo, corpo, t);
    expect(verificarAssinatura(segredo, corpo + " ", cab, agora)).toEqual({
      ok: false,
      motivo: "assinatura",
    });
    expect(verificarAssinatura(novoSegredo(), corpo, cab, agora)).toEqual({
      ok: false,
      motivo: "assinatura",
    });
    expect(verificarAssinatura(segredo, corpo, "v1=abc", agora)).toEqual({
      ok: false,
      motivo: "formato",
    });
  });

  it("mudar o carimbo para repetir um corpo antigo não passa: o carimbo está assinado", () => {
    const antigo = assinar(segredo, corpo, t - 3600);
    const v1 = /v1=(.*)$/.exec(antigo)?.[1] ?? "";
    expect(
      verificarAssinatura(segredo, corpo, `t=${String(t)},v1=${v1}`, agora),
    ).toEqual({ ok: false, motivo: "assinatura" });
  });

  it("repetição: um pedido capturado fora da janela é recusado, para os dois lados", () => {
    const cab = assinar(segredo, corpo, t);
    const depois = new Date(agora.getTime() + (TOLERANCIA_SEGUNDOS + 1) * 1000);
    const antes = new Date(agora.getTime() - (TOLERANCIA_SEGUNDOS + 1) * 1000);
    expect(verificarAssinatura(segredo, corpo, cab, depois)).toEqual({
      ok: false,
      motivo: "carimbo_fora_da_janela",
    });
    expect(verificarAssinatura(segredo, corpo, cab, antes)).toEqual({
      ok: false,
      motivo: "carimbo_fora_da_janela",
    });
    const noLimite = new Date(agora.getTime() + TOLERANCIA_SEGUNDOS * 1000);
    expect(verificarAssinatura(segredo, corpo, cab, noLimite)).toEqual({
      ok: true,
    });
  });
});

describe("o corpo (docs/38 §6; docs/06, CH)", () => {
  const evento = (tipo: string, dados: Record<string, unknown>) => ({
    id: "0199aaaa-0000-7000-8000-000000000001",
    tipo,
    versao_esquema: 1,
    agregado_tipo: "artigo",
    agregado_id: "0199aaaa-0000-7000-8000-000000000002",
    dados,
    criado_em: new Date("2026-10-16T12:00:00.123Z"),
  });

  it("nunca leva `quem` nem um campo que ninguém decidiu mostrar", () => {
    const corpo = JSON.parse(
      corpoDoEvento(
        evento("product.published", {
          artigo_id: "a1",
          publicacao_id: "p1",
          canal_id: "c1",
          mercado_id: "m1",
          quem: "pessoa:ana",
          em: "2026-10-16T12:00:00.000000Z",
          email_do_cliente: "ana@example.com",
        }),
      ),
    ) as { dados: Record<string, unknown>; agregado: { id: string } };
    expect(corpo.dados).toEqual({
      artigo_id: "prd_a1",
      publicacao_id: "pub_p1",
      canal_id: "chn_c1",
      mercado_id: "mkt_m1",
      em: "2026-10-16T12:00:00.000000Z",
    });
    expect(JSON.stringify(corpo)).not.toContain('"quem"');
    expect(JSON.stringify(corpo)).not.toContain("ana@");
    expect(corpo.agregado.id).toBe("prd_0199aaaa-0000-7000-8000-000000000002");
  });

  it("`price.changed` também deixa o `quem` na base", () => {
    const corpo = corpoDoEvento({
      ...evento("price.changed", {
        lista_id: "l1",
        variante_id: "v1",
        montante_antigo: null,
        montante_novo: 1230,
        gratuito: false,
        saiu: false,
        moeda: "EUR",
        preco_inclui_iva: true,
        quem: "pessoa:ana",
      }),
      agregado_tipo: "variante",
    });
    expect(corpo).not.toContain('"quem"');
    expect(corpo).toContain('"montante_novo":1230');
    expect(corpo).toContain('"lista_id":"prl_l1"');
  });

  it("um tipo fora do catálogo não se envia", () => {
    expect(() => corpoDoEvento(evento("merchant.activated", {}))).toThrow(
      /event_unknown/,
    );
  });
});

describe("o endereço (docs/38 §8: SSRF)", () => {
  it("aceita um nome público em https", () => {
    expect(validarUrlDeWebhook("https://alfa.example/hooks?x=1")).toBe(
      "https://alfa.example/hooks?x=1",
    );
    expect(validarUrlDeWebhook("https://alfa.example:443/h")).toBe(
      "https://alfa.example/h",
    );
  });

  it.each([
    "http://alfa.example/h",
    "ftp://alfa.example/h",
    "https://localhost/h",
    "https://servico.internal/h",
    "https://intranet/h",
    "https://127.0.0.1/h",
    "https://2130706433/h",
    "https://0x7f.1/h",
    "https://10.1.2.3/h",
    "https://192.168.0.10/h",
    "https://172.16.0.1/h",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/h",
    "https://[::1]/h",
    "https://[fd00::1]/h",
    "https://[::ffff:127.0.0.1]/h",
    "https://utilizador:senha@alfa.example/h",
    "https://alfa.example:8443/h",
    "https://alfa.example/h#x",
    "não é um endereço",
  ])("recusa %s", (url) => {
    expect(() => validarUrlDeWebhook(url)).toThrow(/webhooks\.url_invalid/);
  });

  it("os endereços privados e reservados não são públicos", () => {
    for (const ip of [
      "0.0.0.0",
      "127.0.0.2",
      "10.0.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.1.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "2001:db8::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(enderecoPublico(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) {
      expect(enderecoPublico(ip), ip).toBe(true);
    }
  });

  it("o emissor verdadeiro recusa o nome que resolve para um endereço privado (DNS) sem ligar", async () => {
    const emissor = emissorHttps({
      resolver: () => Promise.resolve([{ address: "10.0.0.5", family: 4 }]),
    });
    expect(
      await emissor({
        url: "https://alfa.example/h",
        corpo: "{}",
        cabecalhos: {},
      }),
    ).toEqual({ erro: "webhooks.address_refused" });
    // Um nome com um endereço público e outro privado também se recusa.
    const misto = emissorHttps({
      resolver: () =>
        Promise.resolve([
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]),
    });
    expect(
      await misto({
        url: "https://alfa.example/h",
        corpo: "{}",
        cabecalhos: {},
      }),
    ).toEqual({ erro: "webhooks.address_refused" });
    // E um endereço que já não passa na validação nem chega ao DNS.
    expect(
      await emissor({
        url: "https://127.0.0.1/h",
        corpo: "{}",
        cabecalhos: {},
      }),
    ).toEqual({ erro: "webhooks.url_refused" });
  });
});

describe("o recuo e a desistência (docs/38 §7)", () => {
  const inicio = new Date("2026-10-16T12:00:00Z");
  const prazo = new Date(inicio.getTime() + PRAZO_HORAS * 3_600_000);

  it("a espera cresce e a última tentativa cai no prazo; depois desiste", () => {
    let agora = inicio;
    const horas: number[] = [];
    for (let tentativa = 1; tentativa <= 20; tentativa++) {
      const r = depoisDeFalhar(tentativa, agora, prazo);
      if (r.desistir) {
        expect(tentativa).toBe(ESPERAS_MINUTOS.length + 1);
        expect(agora.getTime()).toBe(prazo.getTime());
        return;
      }
      expect(r.proximaEm.getTime()).toBeLessThanOrEqual(prazo.getTime());
      horas.push((r.proximaEm.getTime() - agora.getTime()) / 60_000);
      agora = r.proximaEm;
    }
    throw new Error("não desistiu");
  });

  it("depois do prazo não repete, qualquer que seja a tentativa", () => {
    expect(depoisDeFalhar(1, new Date(prazo.getTime() + 1), prazo)).toEqual({
      desistir: true,
    });
  });
});
