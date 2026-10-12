import { describe, expect, it } from "vitest";
import type { PrecoVariante } from "../src/api";
import {
  camposDoPreco,
  camposSobreOGuardado,
  casasDaMoeda,
  centimosDoTexto,
  conferirPreco,
  corpoDoPreco,
  precoAlterado,
  precoTemOCorpo,
  textoDosCentimos,
} from "../src/preco";

// Definir o preço de uma variante (docs/22 §25): o texto passa a cêntimos
// sem vírgula flutuante (R2), e o ecrã recusa antes de pedir o que a API
// recusaria (§25.4).

const GUARDADO: PrecoVariante = {
  variante: "var_01a125de-0000-7000-8000-000000000041",
  montante: 3990,
  gratuito: false,
  quantidade_minima: 1,
  multiplo: 1,
  definido_em: "2026-10-10T20:00:00.000Z",
  versao: 3,
  reducao: null,
  preco_por_unidade: null,
};

describe("centimosDoTexto", () => {
  it("lê a vírgula e o ponto, com as casas do euro", () => {
    expect(centimosDoTexto("39,90", 2)).toBe(3990);
    expect(centimosDoTexto("39.90", 2)).toBe(3990);
    expect(centimosDoTexto(" 39,9 ", 2)).toBe(3990);
    expect(centimosDoTexto("39", 2)).toBe(3900);
    expect(centimosDoTexto("0,05", 2)).toBe(5);
    expect(centimosDoTexto("007,00", 2)).toBe(700);
  });

  it("não usa vírgula flutuante: 0,29 e 1,15 dão os cêntimos exactos", () => {
    // 0.29 * 100 = 28.999999999999996 e 1.15 * 100 = 114.99999999999999.
    expect(centimosDoTexto("0,29", 2)).toBe(29);
    expect(centimosDoTexto("1,15", 2)).toBe(115);
    expect(centimosDoTexto("1000000000,00", 2)).toBe(100_000_000_000);
  });

  it("recusa casas a mais, milhares, sinal e texto (§25.4)", () => {
    for (const texto of [
      "39,905",
      "1.234,50",
      "1 234,50",
      "1,234.50",
      "-1",
      "+1",
      "39,",
      ",90",
      "39,90 €",
      "1e3",
      "",
    ]) {
      expect(centimosDoTexto(texto, 2), texto).toBeNull();
    }
  });

  it("numa moeda sem casas, só inteiros", () => {
    expect(centimosDoTexto("40", 0)).toBe(4000);
    expect(centimosDoTexto("40,5", 0)).toBeNull();
  });

  it("um número enorme passa o limite em vez de perder algarismos", () => {
    expect(centimosDoTexto("99999999999999999999", 2)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("casasDaMoeda e textoDosCentimos", () => {
  it("o euro tem duas casas; um código desconhecido fica com duas", () => {
    expect(casasDaMoeda("EUR")).toBe(2);
    expect(casasDaMoeda("PLN")).toBe(2);
    expect(casasDaMoeda("??")).toBe(2);
  });

  it("escreve o montante como se lê no campo, sem milhares", () => {
    expect(textoDosCentimos(3990, 2, "pt")).toBe("39,90");
    expect(textoDosCentimos(123456789, 2, "es")).toBe("1234567,89");
    expect(textoDosCentimos(3990, 2, "en")).toBe("39.90");
    expect(textoDosCentimos(5, 2, "pt")).toBe("0,05");
    expect(textoDosCentimos(4000, 0, "pt")).toBe("40");
  });
});

describe("conferirPreco", () => {
  const vazio = { montante: "", gratuito: false, minimo: "1", multiplo: "1" };

  it("sem montante e sem «gratuito», pede o preço", () => {
    expect(conferirPreco(vazio, "EUR", false)).toEqual({
      montante: "precoMontanteObrigatorio",
    });
  });

  it("0 só com «gratuito» (R4)", () => {
    expect(conferirPreco({ ...vazio, montante: "0,00" }, "EUR", false)).toEqual(
      { montante: "precoZeroSoGratuito" },
    );
    expect(conferirPreco({ ...vazio, gratuito: true }, "EUR", false)).toEqual(
      {},
    );
  });

  it("o formato e o limite do montante", () => {
    expect(
      conferirPreco({ ...vazio, montante: "1.234,50" }, "EUR", false),
    ).toEqual({ montante: "precoMontanteFormato" });
    expect(
      conferirPreco({ ...vazio, montante: "1000000000,01" }, "EUR", false),
    ).toEqual({ montante: "precoMontanteLimite" });
  });

  it("as quantidades de 1 a 1 000 000, inteiras", () => {
    expect(
      conferirPreco(
        { ...vazio, montante: "9", minimo: "0", multiplo: "1000001" },
        "EUR",
        false,
      ),
    ).toEqual({
      minimo: "precoQuantidadeInvalida",
      multiplo: "precoQuantidadeInvalida",
    });
    expect(
      conferirPreco({ ...vazio, montante: "9", minimo: "2,5" }, "EUR", false),
    ).toEqual({ minimo: "precoQuantidadeInvalida" });
  });

  it("com uma redução em vigor, o montante não se confere (não se escreve)", () => {
    expect(conferirPreco({ ...vazio, minimo: "6" }, "EUR", true)).toEqual({});
  });
});

describe("corpoDoPreco", () => {
  it("leva os cêntimos, as quantidades e o preço lido", () => {
    expect(
      corpoDoPreco(
        { montante: "41,50", gratuito: false, minimo: "6", multiplo: "6" },
        "EUR",
        GUARDADO,
        false,
      ),
    ).toEqual({
      montante: 4150,
      gratuito: false,
      quantidade_minima: 6,
      multiplo: 6,
      lido: { versao: 3, definido_em: "2026-10-10T20:00:00.000Z" },
    });
  });

  it("sem preço, o lido é null; «gratuito» manda 0", () => {
    expect(
      corpoDoPreco(
        { montante: "12", gratuito: true, minimo: "1", multiplo: "1" },
        "EUR",
        null,
        false,
      ),
    ).toEqual({
      montante: 0,
      gratuito: true,
      quantidade_minima: 1,
      multiplo: 1,
      lido: null,
    });
  });

  it("com uma redução em vigor, o montante e o «gratuito» são os guardados", () => {
    const comReducao = {
      ...GUARDADO,
      reducao: {
        montante: 2990,
        preco_referencia: 3990,
        inicio: "2026-10-01T00:00:00.000Z",
        fim: null,
      },
    };
    expect(
      corpoDoPreco(
        { montante: "1", gratuito: true, minimo: "2", multiplo: "1" },
        "EUR",
        comReducao,
        true,
      ),
    ).toMatchObject({ montante: 3990, gratuito: false, quantidade_minima: 2 });
  });
});

describe("precoAlterado, precoTemOCorpo e camposSobreOGuardado", () => {
  it("o mesmo preço escrito de outra forma não é uma mudança", () => {
    const campos = camposDoPreco(GUARDADO, "EUR", "pt");
    expect(campos).toEqual({
      montante: "39,90",
      gratuito: false,
      minimo: "1",
      multiplo: "1",
    });
    expect(precoAlterado(GUARDADO, campos, "EUR")).toBe(false);
    expect(
      precoAlterado(GUARDADO, { ...campos, montante: "39.9" }, "EUR"),
    ).toBe(false);
    expect(
      precoAlterado(GUARDADO, { ...campos, montante: "39,91" }, "EUR"),
    ).toBe(true);
    expect(precoAlterado(GUARDADO, { ...campos, minimo: "2" }, "EUR")).toBe(
      true,
    );
  });

  it("sem preço, qualquer coisa escrita é uma mudança", () => {
    const campos = camposDoPreco(null, "EUR", "pt");
    expect(precoAlterado(null, campos, "EUR")).toBe(false);
    expect(precoAlterado(null, { ...campos, montante: "39,90" }, "EUR")).toBe(
      true,
    );
  });

  it("a resposta perdida: só conta como gravado com tudo o que se enviou", () => {
    const corpo = {
      montante: 3990,
      gratuito: false,
      quantidade_minima: 1,
      multiplo: 1,
    };
    expect(precoTemOCorpo(GUARDADO, corpo)).toBe(true);
    expect(precoTemOCorpo(GUARDADO, { ...corpo, multiplo: 6 })).toBe(false);
    expect(precoTemOCorpo(null, corpo)).toBe(false);
  });

  it("depois de um conflito, o que não se mexeu toma o valor de agora", () => {
    const agora = { ...GUARDADO, montante: 4500, multiplo: 6, versao: 4 };
    const escritos = {
      ...camposDoPreco(GUARDADO, "EUR", "pt"),
      minimo: "3",
    };
    expect(
      camposSobreOGuardado(GUARDADO, agora, escritos, "EUR", "pt"),
    ).toEqual({
      montante: "45,00",
      gratuito: false,
      minimo: "3",
      multiplo: "6",
    });
    const comMontante = { ...escritos, montante: "41" };
    expect(
      camposSobreOGuardado(GUARDADO, agora, comMontante, "EUR", "pt").montante,
    ).toBe("41");
  });

  it("o conflito decide pelos valores: os campos em português, a língua já em inglês (revisão do #341, P2-1)", () => {
    const agora = { ...GUARDADO, montante: 4400, versao: 4 };
    // Abertos em português («39,90»); a releitura formata em inglês.
    const escritos = { ...camposDoPreco(GUARDADO, "EUR", "pt"), minimo: "2" };
    expect(
      camposSobreOGuardado(GUARDADO, agora, escritos, "EUR", "en"),
    ).toEqual({
      montante: "44.00",
      gratuito: false,
      minimo: "2",
      multiplo: "1",
    });
  });

  it("com uma redução em vigor, o montante escrito não conta como mudança (P3-3)", () => {
    const campos = { ...camposDoPreco(GUARDADO, "EUR", "pt"), montante: "12" };
    expect(precoAlterado(GUARDADO, campos, "EUR", true)).toBe(false);
    expect(
      precoAlterado(GUARDADO, { ...campos, minimo: "2" }, "EUR", true),
    ).toBe(true);
  });
});
