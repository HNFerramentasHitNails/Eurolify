import { describe, expect, it } from "vitest";
import {
  agregar,
  baldeDe,
  celula,
  jaDeclarado,
  lerPeriodo,
  periodoDe,
  ultimoFechado,
  vendasADistancia,
  type DocumentoLido,
} from "../src/faturacao/oss.js";
import type { Conteudo } from "../src/faturacao/repositorio.js";

// O relatório OSS sem base de dados (docs/37; EF): a regra do Motor de IVA →
// o balde, o período, as NC a negativo, as alterações de um período fechado
// e o que impede o fecho.

const T4 = lerPeriodo("2026-T4");

function documento(
  id: string,
  data: string | null,
  linhas: {
    regra: string;
    pais_imposto: string | null;
    base: number;
    iva: number;
    taxa: number;
  }[],
  extra: Partial<DocumentoLido> = {},
  destino: string | null = "ES",
  moeda = "EUR",
): DocumentoLido {
  const conteudo = {
    formato: 1,
    encomenda: "e",
    entidade_legal: { id: "lgl", pais: "PT" },
    cliente: {} as Conteudo["cliente"],
    moeda,
    preco_inclui_iva: true,
    linhas: linhas.map((l, i) => ({
      posicao: i + 1,
      sku: "S",
      descricao: "Verniz",
      quantidade: 1,
      base: l.base,
      iva: l.iva,
      total: l.base + l.iva,
      resultado: l.iva > 0 ? "tributada" : "isenta",
      pais_imposto: l.pais_imposto,
      taxa: l.taxa,
      codigo_motivo: null,
      regra: l.regra,
      verificado: true,
      vies_prova: null,
      isencao: null,
    })),
    totais: { base: 0, iva: 0, total: 0 },
    meio_pagamento: "multibanco",
    destino,
    carimbo: "",
  } as Conteudo;
  return {
    id,
    tipo: "fatura",
    estado: "emitido",
    encomenda_id: "e",
    original_id: null,
    reembolso_id: null,
    numero: `FT 1/${id}`,
    serie: "1",
    data,
    atcud: null,
    nif: null,
    nome: null,
    linhas: linhas.map((l) => ({
      descricao: "Verniz",
      quantidade: 1,
      base: l.base,
      taxa: l.taxa,
      iva: l.iva,
      codigo_motivo: null,
    })),
    conteudo,
    ...extra,
  };
}

const baldeDoRelatorio = (r: ReturnType<typeof agregar>, balde: string) =>
  r.baldes.find((b) => b.balde === balde);

describe("o relatório OSS (puro)", () => {
  it("cada regra do Motor de IVA vai para o seu balde; a desconhecida para nenhum (Q-O3)", () => {
    expect(baldeDe("distancia_destino", "ES", "PT")).toBe("oss");
    expect(baldeDe("nacional", "PT", "PT")).toBe("nacional");
    expect(baldeDe("distancia_origem", "PT", "PT")).toBe("nacional");
    expect(baldeDe("servico_no_lugar", "PT", "PT")).toBe("nacional");
    expect(baldeDe("servico_no_lugar", "ES", "PT")).toBeNull();
    expect(baldeDe("vies_intracomunitaria", null, "PT")).toBe(
      "intracomunitarias",
    );
    expect(baldeDe("exportacao", null, "PT")).toBe("exportacao");
    expect(baldeDe("isento_natureza", "PT", "PT")).toBe("outras_isentas");
    expect(baldeDe("isencao_manual", "PT", "PT")).toBe("outras_isentas");
    expect(baldeDe("bloqueio", null, "PT")).toBeNull();
  });

  it("os períodos: trimestre civil (art. 369.º-F) e mês", () => {
    expect(lerPeriodo("2026-T4")).toMatchObject({
      granularidade: "trimestre",
      inicio: "2026-10-01",
      fim: "2027-01-01",
    });
    expect(lerPeriodo("2026-T1")).toMatchObject({
      inicio: "2026-01-01",
      fim: "2026-04-01",
    });
    expect(lerPeriodo("2026-12")).toMatchObject({
      granularidade: "mes",
      inicio: "2026-12-01",
      fim: "2027-01-01",
    });
    expect(() => lerPeriodo("2026-T5")).toThrow(/trimestre/);
    expect(() => lerPeriodo("2026-13")).toThrow();
    expect(periodoDe("2026-09-30", "trimestre")).toBe("2026-T3");
    expect(periodoDe("2026-10-01", "trimestre")).toBe("2026-T4");
    expect(periodoDe("2026-10-01", "mes")).toBe("2026-10");
  });

  it("OSS por país de entrega e por taxa; NC a negativo no país e taxa da fatura (O3, O4, Q-O2)", () => {
    const r = agregar(
      [
        documento("a", "2026-10-02", [
          {
            regra: "distancia_destino",
            pais_imposto: "ES",
            base: 1000,
            iva: 210,
            taxa: 2100,
          },
          {
            regra: "distancia_destino",
            pais_imposto: "ES",
            base: 500,
            iva: 50,
            taxa: 1000,
          },
        ]),
        documento(
          "b",
          "2026-11-05",
          [
            {
              regra: "distancia_destino",
              pais_imposto: "FR",
              base: 2000,
              iva: 400,
              taxa: 2000,
            },
          ],
          {},
          "FR",
        ),
        documento(
          "nc",
          "2026-12-01",
          [
            {
              regra: "distancia_destino",
              pais_imposto: "ES",
              base: 1000,
              iva: 210,
              taxa: 2100,
            },
          ],
          { tipo: "nota_credito", original_id: "a" },
        ),
      ],
      "PT",
      T4,
      new Set(),
    );
    expect(baldeDoRelatorio(r, "oss")).toMatchObject({
      base: 2500,
      iva: 450,
      linhas: [
        { pais: "ES", taxa: 1000, base: 500, iva: 50, documentos: 1 },
        { pais: "ES", taxa: 2100, base: 0, iva: 0, documentos: 2 },
        { pais: "FR", taxa: 2000, base: 2000, iva: 400, documentos: 1 },
      ],
    });
    expect(r.incluidos.map((x) => x.id)).toEqual(["a", "b", "nc"]);
  });

  it("os cinco baldes; o nacional no país do imposto", () => {
    const r = agregar(
      [
        documento("n", "2026-10-02", [
          {
            regra: "nacional",
            pais_imposto: "PT",
            base: 1000,
            iva: 230,
            taxa: 2300,
          },
          {
            regra: "distancia_origem",
            pais_imposto: "PT",
            base: 100,
            iva: 23,
            taxa: 2300,
          },
        ]),
        documento(
          "v",
          "2026-10-03",
          [
            {
              regra: "vies_intracomunitaria",
              pais_imposto: null,
              base: 700,
              iva: 0,
              taxa: 0,
            },
          ],
          {},
          "DE",
        ),
        documento(
          "x",
          "2026-10-04",
          [
            {
              regra: "exportacao",
              pais_imposto: null,
              base: 300,
              iva: 0,
              taxa: 0,
            },
          ],
          {},
          "CH",
        ),
        documento(
          "i",
          "2026-10-05",
          [
            {
              regra: "isencao_manual",
              pais_imposto: "PT",
              base: 50,
              iva: 0,
              taxa: 0,
            },
          ],
          {},
          "PT",
        ),
      ],
      "PT",
      T4,
      new Set(),
    );
    expect(baldeDoRelatorio(r, "nacional")?.linhas).toEqual([
      {
        balde: "nacional",
        pais: "PT",
        taxa: 2300,
        base: 1100,
        iva: 253,
        documentos: 1,
      },
    ]);
    expect(baldeDoRelatorio(r, "intracomunitarias")?.linhas[0]).toMatchObject({
      pais: "DE",
      base: 700,
    });
    expect(baldeDoRelatorio(r, "exportacao")?.linhas[0]).toMatchObject({
      pais: "CH",
      base: 300,
    });
    expect(baldeDoRelatorio(r, "outras_isentas")?.linhas[0]).toMatchObject({
      pais: "PT",
      base: 50,
    });
    expect(baldeDoRelatorio(r, "oss")?.linhas).toEqual([]);
  });

  it("um documento de um período fechado, ou anterior ao último fechado, entra como alteração; de um período aberto depois dele, impede (P4; P1-B)", () => {
    const linha = (base: number) => ({
      regra: "distancia_destino",
      pais_imposto: "ES",
      base,
      iva: base * 0.21,
      taxa: 2100,
    });
    const docs = [
      documento("tarde", "2026-09-20", [linha(1000)], { tipo: "nota_credito" }),
      // O T2 nunca se fechou no Eurolify, mas é anterior ao T3 fechado: já
      // está declarado, e o que chega com data dele é alteração (P1-B).
      documento("antes", "2026-06-20", [linha(400)]),
    ];
    const r = agregar(docs, "PT", T4, new Set(["2026-T3"]));
    expect([...r.alteracoes.values()]).toEqual([
      {
        balde: "oss",
        pais: "ES",
        taxa: 2100,
        base: -1000,
        iva: -210,
        documentos: 1,
        periodo_original: "2026-T3",
      },
      {
        balde: "oss",
        pais: "ES",
        taxa: 2100,
        base: 400,
        iva: 84,
        documentos: 1,
        periodo_original: "2026-T2",
      },
    ]);
    expect(r.incluidos.map((x) => [x.id, x.periodo_original])).toEqual([
      ["tarde", "2026-T3"],
      ["antes", "2026-T2"],
    ]);
    expect(r.impedimentos.size).toBe(0);
    // Com só o T2 fechado, um documento do T3 (aberto) impede (P2-1).
    const s = agregar(docs, "PT", T4, new Set(["2026-T2"]));
    expect([...(s.impedimentos.get("periodo_anterior_aberto") ?? [])]).toEqual([
      "inv_tarde",
    ]);
    expect(s.incluidos.map((x) => x.id)).toEqual(["antes"]);
  });

  it("o último fechado e o que já está declarado seguem a ordem do calendário", () => {
    expect(ultimoFechado(new Set())).toBeNull();
    expect(ultimoFechado(new Set(["2026-T2", "2027-T1", "2026-T4"]))).toBe(
      "2027-T1",
    );
    expect(jaDeclarado("2026-T1", new Set(["2026-T3"]))).toBe(true);
    expect(jaDeclarado("2026-T3", new Set(["2026-T3"]))).toBe(true);
    expect(jaDeclarado("2026-T4", new Set(["2026-T3"]))).toBe(false);
    expect(jaDeclarado("2026-09", new Set(["2026-10"]))).toBe(true);
    expect(jaDeclarado("2026-10", new Set())).toBe(false);
  });

  it("com a decisão do dono, o balde e o país são os dele e a taxa e os valores os da prova; sem data, conta a que ele deu (P1-A)", () => {
    const l = {
      regra: "nacional",
      pais_imposto: "PT",
      base: 100,
      iva: 23,
      taxa: 2300,
    };
    const resolvido = documento("r", "2026-10-02", [l], {
      estado: "resolvido",
    });
    resolvido.linhas = resolvido.linhas.map((x) => ({
      ...x,
      taxa: 2100,
      iva: 21,
    }));
    expect([
      ...agregar([resolvido], "PT", T4, new Set()).impedimentos.keys(),
    ]).toEqual(["linhas_desalinhadas"]);
    resolvido.classificacao = {
      linhas: [{ balde: "nacional", pais: "PT" }],
      data: null,
    };
    const semData = documento("s", null, [l]);
    semData.data = "2026-10-05";
    semData.classificacao = {
      linhas: [{ balde: "nacional", pais: "PT" }],
      data: "2026-10-05",
    };
    const r = agregar([resolvido, semData], "PT", T4, new Set());
    expect(r.impedimentos.size).toBe(0);
    expect(baldeDoRelatorio(r, "nacional")?.linhas).toEqual([
      {
        balde: "nacional",
        pais: "PT",
        taxa: 2100,
        base: 100,
        iva: 21,
        documentos: 1,
      },
      {
        balde: "nacional",
        pais: "PT",
        taxa: 2300,
        base: 100,
        iva: 23,
        documentos: 1,
      },
    ]);
    // Uma classificação com outro número de linhas não entra.
    resolvido.classificacao = { linhas: [], data: null };
    expect([
      ...agregar([resolvido], "PT", T4, new Set()).impedimentos.keys(),
    ]).toEqual(["linhas_desalinhadas"]);
  });

  it("um documento classificado que fica divergente continua a impedir e sai do limiar (3.ª revisão do #392, P3-8)", () => {
    const d = documento("k", "2026-10-02", [
      { regra: "bloqueio", pais_imposto: null, base: 100, iva: 21, taxa: 2100 },
    ]);
    d.classificacao = { linhas: [{ balde: "oss", pais: "ES" }], data: null };
    expect(agregar([d], "PT", T4, new Set()).impedimentos.size).toBe(0);
    expect(vendasADistancia([d], "PT", true)).toEqual({
      base: 100,
      excluidos: 0,
    });
    d.estado = "divergente";
    const r = agregar([d], "PT", T4, new Set());
    expect([...(r.impedimentos.get("divergente") ?? [])]).toEqual(["inv_k"]);
    expect(r.incluidos).toEqual([]);
    expect(vendasADistancia([d], "PT", true)).toEqual({
      base: 0,
      excluidos: 1,
    });
  });

  it("o limiar com a decisão do dono: conta o OSS dele; uma venda para outro país posta no nacional fica excluída (P2-C)", () => {
    const linha = {
      regra: "bloqueio",
      pais_imposto: null,
      base: 100,
      iva: 23,
      taxa: 2300,
    };
    const paraOss = documento("o", "2026-10-02", [linha]);
    paraOss.classificacao = {
      linhas: [{ balde: "oss", pais: "ES" }],
      data: null,
    };
    const paraNacional = documento("n", "2026-10-02", [linha]);
    paraNacional.classificacao = {
      linhas: [{ balde: "nacional", pais: "PT" }],
      data: null,
    };
    const nacionalEmPT = documento("p", "2026-10-02", [linha], {}, "PT");
    nacionalEmPT.classificacao = {
      linhas: [{ balde: "nacional", pais: "PT" }],
      data: null,
    };
    expect(
      vendasADistancia([paraOss, paraNacional, nacionalEmPT], "PT", true),
    ).toEqual({ base: 100, excluidos: 1 });
  });

  it("uma prova sem linhas declarada à parte: fora dos baldes, na lista à parte, alteração se o período fechou e excluída do limiar (docs/37 §11)", () => {
    const linha = {
      regra: "nacional",
      pais_imposto: "PT",
      base: 100,
      iva: 23,
      taxa: 2300,
    };
    const semLinhas = documento("a", "2026-10-02", [linha], {
      estado: "resolvido",
    });
    semLinhas.linhas = [];
    // Sem decisão, impede.
    expect([
      ...agregar([semLinhas], "PT", T4, new Set()).impedimentos.keys(),
    ]).toEqual(["linhas_desalinhadas"]);
    semLinhas.classificacao = {
      linhas: [],
      data: null,
      a_parte: true,
      decidido_por: "chave:key_1",
      decidido_em: "2026-10-03",
    };
    const r = agregar([semLinhas], "PT", T4, new Set());
    expect(r.impedimentos.size).toBe(0);
    expect(r.baldes.every((b) => b.linhas.length === 0)).toBe(true);
    expect(r.declarados).toEqual([
      {
        documento: "inv_a",
        tipo: "fatura",
        numero: "FT 1/a",
        data: "2026-10-02",
        alteracao_de: null,
        decidido_por: "chave:key_1",
        decidido_em: "2026-10-03",
      },
    ]);
    expect(r.incluidos).toEqual([
      { id: "a", periodo_original: "2026-T4", linhas: [] },
    ]);
    // De um período já fechado: alteração dele (P1-B).
    semLinhas.data = "2026-09-20";
    const depois = agregar([semLinhas], "PT", T4, new Set(["2026-T3"]));
    expect(depois.declarados[0]?.alteracao_de).toBe("2026-T3");
    expect(depois.incluidos[0]?.periodo_original).toBe("2026-T3");
    // No limiar, o valor não se conhece: excluído.
    expect(vendasADistancia([semLinhas], "PT", true)).toEqual({
      base: 0,
      excluidos: 1,
    });
  });

  it("as linhas casam uma a uma: quantidade, taxa ou motivo diferentes impedem (revisão do #392, P1-2)", () => {
    const duas = [
      { regra: "nacional", pais_imposto: "PT", base: 100, iva: 23, taxa: 2300 },
      {
        regra: "distancia_destino",
        pais_imposto: "ES",
        base: 200,
        iva: 42,
        taxa: 2100,
      },
    ];
    const trocado = documento("t", "2026-10-02", duas);
    // A prova com as linhas pela ordem trocada: o mesmo número de linhas.
    trocado.linhas = [...trocado.linhas].reverse();
    const negativo = documento("n", "2026-10-02", duas);
    negativo.linhas = negativo.linhas.map((l) => ({ ...l, base: -l.base }));
    const r = agregar([trocado, negativo], "PT", T4, new Set());
    expect(
      Object.fromEntries(
        [...r.impedimentos.entries()].map(([k, v]) => [k, [...v]]),
      ),
    ).toEqual({
      linhas_desalinhadas: ["inv_t"],
      sinal_inesperado: ["inv_n"],
    });
    expect(r.incluidos).toEqual([]);
  });

  it("impedem o fecho: divergente, outra moeda, sem data, sem balde, linhas desalinhadas (O5, O6, P5)", () => {
    const ok = [
      { regra: "nacional", pais_imposto: "PT", base: 100, iva: 23, taxa: 2300 },
    ];
    const desalinhado = documento("l", "2026-10-02", ok);
    desalinhado.linhas = [];
    const r = agregar(
      [
        documento("d", "2026-10-02", ok, { estado: "divergente" }),
        documento("m", "2026-10-02", ok, {}, "PT", "USD"),
        documento("s", null, ok),
        documento("b", "2026-10-02", [
          { regra: "bloqueio", pais_imposto: null, base: 1, iva: 0, taxa: 0 },
        ]),
        desalinhado,
      ],
      "PT",
      T4,
      new Set(),
    );
    expect(
      Object.fromEntries(
        [...r.impedimentos.entries()].map(([k, v]) => [k, [...v]]),
      ),
    ).toEqual({
      divergente: ["inv_d"],
      outra_moeda: ["inv_m"],
      sem_data: ["inv_s"],
      sem_balde: ["inv_b"],
      linhas_desalinhadas: ["inv_l"],
    });
    expect(r.incluidos).toEqual([]);
    expect(baldeDoRelatorio(r, "nacional")?.base).toBe(0);
  });

  it("o CSV não deixa entrar fórmulas nem parte as colunas", () => {
    expect(celula("=1+1")).toBe("'=1+1");
    expect(celula("@SUM(A1)")).toBe("'@SUM(A1)");
    // Texto: sempre protegido, também o que parece um número (P1-1).
    expect(celula("-1+1")).toBe("'-1+1");
    expect(celula("-1;2")).toBe(`"'-1;2"`);
    expect(celula("+351 912")).toBe("'+351 912");
    expect(celula("\tx")).toBe("'\tx");
    // Números dos nossos formatos: passam como estão.
    expect(celula("-12.30", "numero")).toBe("-12.30");
    expect(celula(-3, "numero")).toBe("-3");
    expect(celula('Verniz "vermelho", 10 ml')).toBe(
      '"Verniz ""vermelho"", 10 ml"',
    );
    expect(celula(null)).toBe("");
  });
});
