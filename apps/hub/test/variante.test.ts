import { describe, expect, it } from "vitest";
import type { VarianteArtigo } from "../src/api";
import {
  alteracaoDaVariante,
  camposDaVariante,
  camposSobreOGuardado,
  conferirVariante,
  varianteAlterada,
} from "../src/variante";

// Alterar uma variante (docs/22 §23): o que o ecrã confere e o corpo do
// PATCH, só com o que mudou.

const GUARDADA: VarianteArtigo = {
  id: "var_01a125de-0000-7000-8000-000000000001",
  sku: "ENS-002",
  estado: "activa",
  unidade_de_venda: "unidade",
  gtin: null,
  gtin_origem: null,
  conteudo_quantidade: null,
  conteudo_unidade: null,
  peso_g: null,
  comprimento_mm: null,
  largura_mm: null,
  altura_mm: null,
  onu: null,
  classe_adr: null,
  posicao: 0,
  versao: 3,
};

describe("alterar uma variante", () => {
  it("sem nada mudado, o corpo leva só a versão, e não há nada por gravar", () => {
    const c = camposDaVariante(GUARDADA);
    expect(alteracaoDaVariante(GUARDADA, c, true)).toEqual({ versao: 3 });
    expect(varianteAlterada(GUARDADA, c, true)).toBe(false);
  });

  it("o peso que resolve o «peso em falta»: só o peso vai", () => {
    const c = { ...camposDaVariante(GUARDADA), peso: "60" };
    expect(alteracaoDaVariante(GUARDADA, c, false)).toEqual({
      versao: 3,
      peso_g: 60,
    });
    expect(varianteAlterada(GUARDADA, c, false)).toBe(true);
  });

  it("o GTIN vai sempre com a origem; tirá-lo leva os dois a nulo", () => {
    const com = {
      ...camposDaVariante(GUARDADA),
      gtin: " 4006381333931 ",
      gtinOrigem: "fornecedor" as const,
    };
    expect(alteracaoDaVariante(GUARDADA, com, false)).toEqual({
      versao: 3,
      gtin: "4006381333931",
      gtin_origem: "fornecedor",
    });
    const comGtin: VarianteArtigo = {
      ...GUARDADA,
      gtin: "4006381333931",
      gtin_origem: "fornecedor",
    };
    // Só a origem muda: os dois vão.
    const origem = {
      ...camposDaVariante(comGtin),
      gtinOrigem: "interno" as const,
    };
    expect(alteracaoDaVariante(comGtin, origem, false)).toEqual({
      versao: 3,
      gtin: "4006381333931",
      gtin_origem: "interno",
    });
    const sem = { ...camposDaVariante(comGtin), gtin: "" };
    expect(alteracaoDaVariante(comGtin, sem, false)).toEqual({
      versao: 3,
      gtin: null,
      gtin_origem: null,
    });
  });

  it("a unidade e o conteúdo só vão num rascunho", () => {
    const c = {
      ...camposDaVariante(GUARDADA),
      unidade: "par" as const,
      quantidade: "15",
      unidadeConteudo: "ml" as const,
    };
    expect(alteracaoDaVariante(GUARDADA, c, true)).toEqual({
      versao: 3,
      unidade_de_venda: "par",
      conteudo_quantidade: 15,
      conteudo_unidade: "ml",
    });
    expect(alteracaoDaVariante(GUARDADA, c, false)).toEqual({ versao: 3 });
    expect(varianteAlterada(GUARDADA, c, false)).toBe(false);
  });

  it("apagar uma medida manda nulo; o ONU vai em maiúsculas", () => {
    const comPeso: VarianteArtigo = { ...GUARDADA, peso_g: 60, onu: null };
    const c = { ...camposDaVariante(comPeso), peso: "", onu: "un1263" };
    expect(alteracaoDaVariante(comPeso, c, false)).toEqual({
      versao: 3,
      peso_g: null,
      onu: "UN1263",
    });
  });

  it("confere o formato do GTIN, a origem, os inteiros, o conteúdo aos pares, o ONU e a classe ADR", () => {
    const base = camposDaVariante(GUARDADA);
    expect(conferirVariante(base)).toEqual({});
    expect(conferirVariante({ ...base, gtin: "123" })).toEqual({
      gtin: "artigoNovoGtinFormato",
    });
    expect(conferirVariante({ ...base, gtin: "4006381333931" })).toEqual({
      gtinOrigem: "artigoNovoGtinOrigemFalta",
    });
    expect(
      conferirVariante({ ...base, peso: "1,5", altura: "0", largura: "x" }),
    ).toEqual({
      peso: "artigoNovoInteiro",
      altura: "artigoNovoInteiro",
      largura: "artigoNovoInteiro",
    });
    expect(conferirVariante({ ...base, quantidade: "15" })).toEqual({
      unidadeConteudo: "artigoNovoConteudoIncompleto",
    });
    expect(conferirVariante({ ...base, unidadeConteudo: "ml" })).toEqual({
      quantidade: "artigoNovoConteudoIncompleto",
    });
    expect(conferirVariante({ ...base, onu: "1263" })).toEqual({
      onu: "varianteOnuFormato",
    });
    expect(conferirVariante({ ...base, onu: "un1263" })).toEqual({});
    expect(conferirVariante({ ...base, classeAdr: "x".repeat(17) })).toEqual({
      classeAdr: "varianteClasseAdrLonga",
    });
  });

  it("depois de um conflito, o que a pessoa não mexeu toma o valor de agora e o que mexeu fica (revisão do #317, P1-1)", () => {
    // A Ana leu a ENS-041 sem comprimento e mudou o peso para 65; outra
    // pessoa gravou comprimento 100 e peso 60.
    const lidaAntes: VarianteArtigo = { ...GUARDADA, peso_g: null };
    const agora: VarianteArtigo = {
      ...GUARDADA,
      peso_g: 60,
      comprimento_mm: 100,
      versao: 4,
    };
    const escritos = { ...camposDaVariante(lidaAntes), peso: "65" };
    const novos = camposSobreOGuardado(lidaAntes, agora, escritos);
    expect(novos.comprimento).toBe("100");
    expect(novos.peso).toBe("65");
    // Guardar outra vez só leva o peso: o comprimento de 100 mm fica.
    expect(alteracaoDaVariante(agora, novos, false)).toEqual({
      versao: 4,
      peso_g: 65,
    });
  });

  it("uma classe ADR guardada com espaços à volta não conta como mudança (P3-1)", () => {
    const comEspacos: VarianteArtigo = { ...GUARDADA, classe_adr: " 3 " };
    const c = camposDaVariante(comEspacos);
    expect(varianteAlterada(comEspacos, c, false)).toBe(false);
  });
});
