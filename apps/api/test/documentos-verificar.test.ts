import { describe, expect, it } from "vitest";
import type { DocumentoNoEmissor } from "../src/faturacao/adaptador.js";
import {
  comparar,
  impressaoDe,
  motivosDoConteudo,
  nifSoNumero,
  type Conteudo,
  type LinhaDoConteudo,
} from "../src/faturacao/repositorio.js";

// As verificações do conteúdo e a comparação com o emissor, ramo a ramo
// (docs/28 §5, R3, R6 e R7), sem base: os casos que um checkout normal não
// produz (isenção sem prova, moeda, totais que não batem).

const linha = (o: Partial<LinhaDoConteudo> = {}): LinhaDoConteudo => ({
  posicao: 1,
  sku: "GEL-001",
  descricao: "Gel UV",
  quantidade: 1,
  base: 1000,
  iva: 230,
  total: 1230,
  resultado: "tributada",
  pais_imposto: "PT",
  taxa: 2300,
  codigo_motivo: null,
  regra: "nacional",
  verificado: true,
  vies_prova: null,
  isencao: null,
  ...o,
});

const conteudo = (linhas: LinhaDoConteudo[], o: Partial<Conteudo> = {}) => {
  const totais = linhas.reduce(
    (s, l) => ({
      base: s.base + l.base,
      iva: s.iva + l.iva,
      total: s.total + l.total,
    }),
    { base: 0, iva: 0, total: 0 },
  );
  const c: Conteudo = {
    formato: 1,
    encomenda: "ord_x",
    entidade_legal: { id: "lgl_x", pais: "PT" },
    cliente: {
      tipo: "particular",
      nome: "Rui",
      nif: "501964843",
      nif_numero: "501964843",
      nif_escrito: "501964843",
      pais_contribuinte: "PT",
      morada: {},
    },
    moeda: "EUR",
    preco_inclui_iva: true,
    linhas,
    totais,
    meio_pagamento: "multibanco",
    destino: "PT",
    carimbo: "destino PT · IVA 23 %",
    ...o,
  };
  return c;
};

const ligacao = {
  taxas: [{ pais: "PT", taxa: 2300, emissor: "T23" }],
  isencoes: [{ codigo: "M16", emissor: "I16" }],
};

describe("verificações do conteúdo (R3)", () => {
  it("um conteúdo certo não retém", () => {
    expect(motivosDoConteudo(conteudo([linha()]), ligacao, "teste")).toEqual(
      [],
    );
  });

  it("taxa sem o par (país, taxa) no emissor retém; outra taxa do mesmo país não serve", () => {
    expect(
      motivosDoConteudo(conteudo([linha({ taxa: 600 })]), ligacao, "teste"),
    ).toEqual(["taxa_sem_mapa"]);
    expect(
      motivosDoConteudo(
        conteudo([linha({ pais_imposto: "ES", taxa: 2300 })]),
        ligacao,
        "teste",
      ),
    ).toEqual(["taxa_sem_mapa"]);
  });

  it("isenta por VIES sem a prova, ou manual sem a isenção, ou sem código, retém", () => {
    const isenta = (o: Partial<LinhaDoConteudo>) =>
      linha({
        resultado: "isenta",
        taxa: 0,
        iva: 0,
        total: 1000,
        codigo_motivo: "M16",
        ...o,
      });
    expect(
      motivosDoConteudo(
        conteudo([
          isenta({ regra: "vies_intracomunitaria", vies_prova: null }),
        ]),
        ligacao,
        "teste",
      ),
    ).toEqual(["isencao_sem_prova"]);
    expect(
      motivosDoConteudo(
        conteudo([
          isenta({ regra: "vies_intracomunitaria", vies_prova: "vvc_1" }),
        ]),
        ligacao,
        "teste",
      ),
    ).toEqual([]);
    expect(
      motivosDoConteudo(
        conteudo([isenta({ regra: "isencao_manual", isencao: null })]),
        ligacao,
        "teste",
      ),
    ).toEqual(["isencao_sem_prova"]);
    expect(
      motivosDoConteudo(
        conteudo([isenta({ regra: "exportacao", codigo_motivo: null })]),
        ligacao,
        "teste",
      ),
    ).toEqual(["isencao_sem_prova"]);
    // Um código sem a isenção do emissor no mapa.
    expect(
      motivosDoConteudo(
        conteudo([isenta({ regra: "exportacao", codigo_motivo: "M05" })]),
        ligacao,
        "teste",
      ),
    ).toEqual(["isencao_sem_mapa"]);
  });

  it("uma decisão bloqueada, outra moeda e totais que não batem retêm", () => {
    expect(
      motivosDoConteudo(
        conteudo([linha({ resultado: "bloqueada" })]),
        ligacao,
        "teste",
      ),
    ).toEqual(["territorio_por_decidir"]);
    expect(
      motivosDoConteudo(
        conteudo([linha()], { moeda: "PLN" }),
        ligacao,
        "teste",
      ),
    ).toEqual(["moeda_nao_suportada"]);
    const c = conteudo([linha()]);
    c.totais = { ...c.totais, iva: c.totais.iva + 1 };
    expect(motivosDoConteudo(c, ligacao, "teste")).toEqual([
      "totais_nao_batem",
    ]);
  });

  it("em modo real, uma taxa por verificar retém (Q3); em teste, não", () => {
    const c = conteudo([linha({ verificado: false })]);
    expect(motivosDoConteudo(c, ligacao, "teste")).toEqual([]);
    expect(motivosDoConteudo(c, ligacao, "real")).toEqual([
      "taxa_por_verificar",
    ]);
  });
});

describe("comparar com o emissor (R6, R7)", () => {
  const doc = (c: Conteudo, o: Partial<DocumentoNoEmissor> = {}) =>
    ({
      id: "d1",
      estado: "fechado",
      referencia: "inv_1",
      numero: "FT 1",
      serie: null,
      data: null,
      atcud: null,
      nif: c.cliente.nif,
      nome: c.cliente.nome,
      pais: "PT",
      linhas: c.linhas.map((l) => ({
        descricao: l.descricao,
        quantidade: l.quantidade,
        base: l.base,
        taxa: l.taxa,
        codigo_motivo: l.codigo_motivo,
        iva: l.iva,
      })),
      totais: c.totais,
      em_bruto: null,
      ...o,
    }) satisfies DocumentoNoEmissor;

  it("igual não diverge; o NIF compara-se só pelo número (com ou sem prefixo)", () => {
    const c = conteudo([linha()]);
    expect(comparar(c, doc(c), "inv_1")).toEqual([]);
    expect(comparar(c, doc(c, { nif: "PT 501.964.843" }), "inv_1")).toEqual([]);
  });

  it("consumidor final a quem deu NIF, outra referência, outra taxa: diverge", () => {
    const c = conteudo([linha()]);
    expect(comparar(c, doc(c, { nif: null }), "inv_1")).toEqual([
      { campo: "nif", esperado: "501964843", obtido: null },
    ]);
    expect(comparar(c, doc(c), "inv_2")).toEqual([
      { campo: "referencia", esperado: "inv_2", obtido: "inv_1" },
    ]);
    // O país e o nome do documento também se conferem.
    expect(comparar(c, doc(c, { pais: "ES", nome: "Outro" }), "inv_1")).toEqual(
      [
        { campo: "pais", esperado: "PT", obtido: "ES" },
        { campo: "nome", esperado: "Rui", obtido: "Outro" },
      ],
    );
    expect(comparar(c, doc(c, { serie: "B" }), "inv_1", "A")).toEqual([
      { campo: "serie", esperado: "A", obtido: "B" },
    ]);
    const outra = doc(c);
    outra.linhas = outra.linhas.map((l) => ({ ...l, taxa: 600 }));
    expect(comparar(c, outra, "inv_1")).toEqual([
      { campo: "linhas[0].taxa", esperado: 2300, obtido: 600 },
    ]);
  });
});

describe("NIF e impressão", () => {
  it("o prefixo fiscal grego é EL; o número de outro país fica como está", () => {
    expect(nifSoNumero("EL123456789", "GR")).toBe("123456789");
    expect(nifSoNumero("ESB12345678", "ES")).toBe("B12345678");
    expect(nifSoNumero("B12345678", "ES")).toBe("B12345678");
    expect(nifSoNumero(null, "PT")).toBeNull();
  });

  it("a impressão não depende da ordem das chaves e muda com o conteúdo", () => {
    const c = conteudo([linha()]);
    const reordenado = Object.fromEntries(
      Object.entries(c).reverse(),
    ) as unknown as Conteudo;
    expect(Object.keys(reordenado)[0]).toBe("carimbo");
    expect(impressaoDe(reordenado)).toBe(impressaoDe(c));
    expect(impressaoDe({ ...c, moeda: "PLN" })).not.toBe(impressaoDe(c));
  });
});
