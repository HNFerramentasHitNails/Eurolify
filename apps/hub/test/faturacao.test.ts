import { describe, expect, it } from "vitest";
import {
  BALDES,
  resumoDaLigacaoComErro,
  enderecoConfigurar,
  escolhasDe,
  faltaNasEscolhas,
  paraGravar,
  resumoDoQueFalta,
  taxasParaOPar,
  emCurso,
  estadoMostrado,
  fechoDe,
  FORA_DA_UE,
  hojeEm,
  ligacaoDaEntidade,
  lerFragmentoMoloni,
  lerPedidoMoloni,
  lerTrimestre,
  linhasAClassificar,
  montante,
  MOTIVOS_IMPEDIMENTO,
  nomeDoPeriodo,
  paisesDoBalde,
  primeiroDiaDepois,
  regressoDe,
  resumoDoPeriodo,
  talvezFeito,
  taxa,
  textoDoImpedimento,
  trimestreAnterior,
  trimestreDe,
  trimestreSeguinte,
  trimestresParaEscolher,
  ultimoTrimestreAcabado,
  enderecoOss,
  type LigacaoFaturacao,
  type RelatorioOss,
} from "../src/faturacao";
import { TEXTOS } from "../src/textos";
import { paisesPorBalde } from "../../api/src/faturacao/oss";

// O ecrã «Faturação» (docs/22 §30): as funções sem ecrã.

const t = TEXTOS.pt;

const ligacao = (x: Partial<LigacaoFaturacao>): LigacaoFaturacao => ({
  id: "isx_1",
  entidade_legal: "lgl_a",
  adaptador: "moloni",
  modo: "teste",
  estado: "pronta",
  activa: true,
  serie: "500",
  credenciais_em: null,
  credenciais_por: null,
  testada_em: null,
  erro: null,
  versao: 1,
  ...x,
});

const relatorio = (x: Partial<RelatorioOss>): RelatorioOss => ({
  entidade_legal: "lgl_a",
  periodo: "2026-T3",
  granularidade: "trimestre",
  fechado: null,
  moeda: "EUR",
  baldes: [],
  alteracoes: [],
  a_parte: { emitidas_fora: [], sistema_proprio: [], por_emitir: [] },
  limiar: {
    ano: "2026",
    vendas_a_distancia_base: 0,
    ano_anterior: "2025",
    ano_anterior_base: 0,
    limiar: 1_000_000,
    passou: false,
    documentos_excluidos: 0,
  },
  impedimentos: [],
  classificavel: { baldes: paisesPorBalde("PT") },
  ...x,
});

describe("os períodos", () => {
  it("hoje conta-se no fuso de Lisboa, não em UTC", () => {
    // 30/09/2026 às 23:30 UTC já é 01/10 em Lisboa (UTC+1 no verão).
    expect(hojeEm(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10-01");
    expect(hojeEm(new Date("2026-09-30T22:30:00Z"))).toBe("2026-09-30");
  });

  it("o último trimestre acabado, o anterior e o seguinte, também na viragem do ano", () => {
    expect(trimestreDe("2026-10-12")).toBe("2026-T4");
    expect(ultimoTrimestreAcabado("2026-10-12")).toBe("2026-T3");
    expect(ultimoTrimestreAcabado("2027-01-01")).toBe("2026-T4");
    expect(trimestreAnterior("2026-T1")).toBe("2025-T4");
    expect(trimestreSeguinte("2026-T4")).toBe("2027-T1");
  });

  it("um trimestre só se fecha a partir do primeiro dia depois dele", () => {
    expect(primeiroDiaDepois("2026-T3")).toBe("2026-10-01");
    expect(primeiroDiaDepois("2026-T4")).toBe("2027-01-01");
    expect(emCurso("2026-T3", "2026-09-30")).toBe(true);
    expect(emCurso("2026-T3", "2026-10-01")).toBe(false);
  });

  it("a lista: o actual «em curso» e os oito anteriores, do mais recente", () => {
    const l = trimestresParaEscolher("2026-10-12");
    expect(l).toHaveLength(9);
    expect(l[0]).toEqual({ periodo: "2026-T4", emCurso: true });
    expect(l[1]).toEqual({ periodo: "2026-T3", emCurso: false });
    expect(l[8]).toEqual({ periodo: "2024-T4", emCurso: false });
  });

  it("só um trimestre no endereço é período; o resto não vale", () => {
    expect(lerTrimestre("2026-T3")).toBe("2026-T3");
    expect(lerTrimestre("2026-T5")).toBeNull();
    expect(lerTrimestre("2026-10")).toBeNull();
    expect(lerTrimestre(null)).toBeNull();
  });

  it("o nome do período pela língua", () => {
    expect(nomeDoPeriodo(TEXTOS.pt, "2026-T3")).toBe("T3 de 2026");
    expect(nomeDoPeriodo(TEXTOS.en, "2026-T3")).toBe("Q3 2026");
    expect(nomeDoPeriodo(TEXTOS.pt, "2026-10")).toBe("2026-10");
  });

  it("o endereço do relatório leva o comerciante, a entidade e o período", () => {
    expect(enderecoOss("mer_a", "lgl_b", "2026-T3")).toBe(
      "/faturacao/oss?comerciante=mer_a&entidade=lgl_b&periodo=2026-T3",
    );
  });
});

describe("montantes e taxas", () => {
  it("cêntimos na moeda, pela língua, com o sinal nos negativos", () => {
    const pt = montante(423_000, "pt-PT");
    expect(pt).toMatch(/4\s?230,00\s€/);
    expect(montante(-1230, "pt-PT")).toMatch(/^-12,30\s€$/);
    expect(montante(423_000, "en")).toBe("€4,230.00");
  });

  it("a taxa em centésimas de ponto", () => {
    expect(taxa(2300, "pt-PT")).toMatch(/^23\s?%$/);
    expect(taxa(550, "en")).toBe("5.5%");
    expect(taxa(0, "en")).toBe("0%");
  });
});

describe("os impedimentos", () => {
  it("cada motivo tem texto nas três línguas", () => {
    for (const l of ["pt", "es", "en"] as const) {
      const textos = TEXTOS[l] as Record<string, string>;
      for (const m of MOTIVOS_IMPEDIMENTO) {
        expect(textos[`impedimento_${m}`], `${l} ${m}`).toBeTruthy();
      }
    }
  });

  it("por emitir diz quantos; um motivo novo mostra-se com o código", () => {
    expect(
      textoDoImpedimento(t, {
        motivo: "por_emitir",
        documentos: ["inv_1", "inv_2"],
      }),
    ).toBe("Há pedidos pagos por faturar (2).");
    expect(textoDoImpedimento(t, { motivo: "novo", documentos: [] })).toBe(
      "novo",
    );
  });

  it("o resumo do período para a página «Faturação»", () => {
    const data = () => "12/10/2026";
    expect(resumoDoPeriodo(t, relatorio({}), data)).toBe("Aberto");
    expect(
      resumoDoPeriodo(
        t,
        relatorio({
          impedimentos: [
            { motivo: "sem_balde", documentos: ["inv_1"] },
            { motivo: "por_emitir", documentos: ["inv_2"] },
          ],
        }),
        data,
      ),
    ).toBe("Aberto · 2 impedimentos");
    expect(
      resumoDoPeriodo(
        t,
        relatorio({
          fechado: { em: "2026-10-12T10:00:00Z", por: "x", versao_regra: 1 },
        }),
        data,
      ),
    ).toBe("Fechado a 12/10/2026");
  });
});

describe("o botão de fechar", () => {
  const dono = ["tax:read", "tax:write"];

  it("sem tax:write, só leitura; fechado, nada", () => {
    expect(fechoDe(relatorio({}), ["tax:read"])).toEqual({
      tipo: "so_leitura",
    });
    expect(
      fechoDe(
        relatorio({
          fechado: { em: "2026-10-12T10:00:00Z", por: "x", versao_regra: 1 },
        }),
        dono,
      ),
    ).toEqual({ tipo: "fechado" });
  });

  it("em curso, «só depois de» o primeiro dia a seguir", () => {
    expect(
      fechoDe(
        relatorio({
          periodo: "2026-T4",
          impedimentos: [{ motivo: "periodo_em_curso", documentos: [] }],
        }),
        dono,
      ),
    ).toEqual({ tipo: "em_curso", depois: "2027-01-01" });
  });

  it("com impedimentos, sem botão; só «por emitir», com a confirmação", () => {
    expect(
      fechoDe(
        relatorio({
          impedimentos: [
            { motivo: "sem_data", documentos: ["inv_1"] },
            { motivo: "por_emitir", documentos: ["inv_2"] },
          ],
        }),
        dono,
      ),
    ).toEqual({ tipo: "impedido" });
    expect(
      fechoDe(
        relatorio({
          impedimentos: [{ motivo: "por_emitir", documentos: ["inv_2"] }],
        }),
        dono,
      ),
    ).toEqual({ tipo: "pode", porEmitir: true });
    expect(fechoDe(relatorio({}), dono)).toEqual({
      tipo: "pode",
      porEmitir: false,
    });
  });

  it("com um período a seguir já fechado, só leitura (P1-B), também para o dono", () => {
    expect(
      fechoDe(
        relatorio({
          impedimentos: [
            { motivo: "periodo_posterior_fechado", documentos: [] },
          ],
        }),
        dono,
      ),
    ).toEqual({ tipo: "posterior_fechado" });
  });
});

describe("a ligação", () => {
  it("a activa da entidade; sem ela, a desligada; sem nenhuma, null", () => {
    const desligada = ligacao({ id: "isx_0", activa: false });
    const activa = ligacao({ id: "isx_2" });
    const outra = ligacao({ id: "isx_3", entidade_legal: "lgl_b" });
    expect(ligacaoDaEntidade("lgl_a", [desligada, activa, outra])?.id).toBe(
      "isx_2",
    );
    const so = ligacaoDaEntidade("lgl_a", [desligada]);
    expect(so?.id).toBe("isx_0");
    expect(so === null ? null : estadoMostrado(so)).toBe("desligada");
    expect(ligacaoDaEntidade("lgl_c", [activa, outra])).toBeNull();
  });
});

describe("classificar", () => {
  const c = { baldes: paisesPorBalde("PT") };

  it("a régua vem do servidor: nacional só o país da entidade, exportação fora da UE", () => {
    expect(paisesDoBalde(c, "nacional")).toEqual({
      paises: ["PT"],
      foraDaUe: false,
    });
    const oss = paisesDoBalde(c, "oss");
    expect(oss.paises).toHaveLength(26);
    expect(oss.paises).not.toContain("PT");
    expect(paisesDoBalde(c, "exportacao")).toEqual({
      paises: [],
      foraDaUe: true,
    });
    expect(paisesDoBalde(c, "")).toEqual({ paises: [], foraDaUe: false });
  });

  it("os cinco baldes do Hub são os da régua, pela mesma ordem", () => {
    expect(c.baldes.map((b) => b.balde)).toEqual([...BALDES]);
  });

  it("as linhas: cada uma com balde e país; fora da UE, o código escrito", () => {
    expect(
      linhasAClassificar([
        { balde: "nacional", pais: "PT", codigoFora: "" },
        { balde: "exportacao", pais: FORA_DA_UE, codigoFora: " ch " },
      ]),
    ).toEqual([
      { balde: "nacional", pais: "PT" },
      { balde: "exportacao", pais: "CH" },
    ]);
    expect(
      linhasAClassificar([{ balde: "", pais: "PT", codigoFora: "" }]),
    ).toBeNull();
    expect(
      linhasAClassificar([
        { balde: "exportacao", pais: FORA_DA_UE, codigoFora: "C" },
      ]),
    ).toBeNull();
    expect(linhasAClassificar([])).toBeNull();
  });
});

describe("o regresso do Moloni", () => {
  const estado = "a".repeat(32);
  const pedido = {
    comerciante: "mer_a",
    ligacao: "isx_1",
    estado,
    expira_em: "2026-10-12T10:10:00Z",
  };
  const agora = new Date("2026-10-12T10:05:00Z").getTime();

  it("lê o código e o state do fragmento; sem código, nada", () => {
    expect(lerFragmentoMoloni(`#code=abc123&state=${estado}`)).toEqual({
      codigo: "abc123",
      estado,
    });
    expect(lerFragmentoMoloni("#code=abc123")).toEqual({
      codigo: "abc123",
      estado: null,
    });
    expect(lerFragmentoMoloni("#state=x")).toBeNull();
    expect(lerFragmentoMoloni("")).toBeNull();
    expect(lerFragmentoMoloni("#code=a%20b")).toBeNull();
    // Um `state` mal formado não conta como ausente (revisão do #408, P3-1).
    const mau = lerFragmentoMoloni("#code=abc123&state=<x>");
    expect(mau).toEqual({ codigo: "abc123", estado: "" });
    expect(regressoDe(mau, pedido, 0).tipo).toBe("estado_diferente");
  });

  it("uma resposta talvez feita: sem rede ou um 5xx sem código (revisão do #408, P2-2)", () => {
    expect(talvezFeito({ estado: 0 })).toBe(true);
    expect(talvezFeito({ estado: 504 })).toBe(true);
    expect(talvezFeito({ estado: 503, codigo: "tax_reports.retry" })).toBe(
      false,
    );
    expect(talvezFeito({ estado: 409, codigo: "x" })).toBe(false);
  });

  it("o pedido guardado só vale com os quatro campos", () => {
    expect(lerPedidoMoloni(JSON.stringify(pedido))).toEqual(pedido);
    expect(lerPedidoMoloni(null)).toBeNull();
    expect(lerPedidoMoloni("{")).toBeNull();
    expect(lerPedidoMoloni(JSON.stringify({ ...pedido, estado: 1 }))).toBe(
      null,
    );
  });

  it("conclui com o pedido deste separador, no prazo e com o mesmo state", () => {
    expect(regressoDe({ codigo: "c", estado }, pedido, agora)).toEqual({
      tipo: "concluir",
      pedido,
      codigo: "c",
    });
    // Sem state no fragmento, vale o guardado (a API confere-o).
    expect(regressoDe({ codigo: "c", estado: null }, pedido, agora).tipo).toBe(
      "concluir",
    );
  });

  it("não conclui sem pedido, fora de prazo ou com outro state", () => {
    expect(regressoDe({ codigo: "c", estado }, null, agora).tipo).toBe(
      "sem_pedido",
    );
    expect(
      regressoDe(
        { codigo: "c", estado },
        pedido,
        new Date("2026-10-12T10:10:00Z").getTime(),
      ).tipo,
    ).toBe("expirado");
    expect(
      regressoDe({ codigo: "c", estado: "b".repeat(32) }, pedido, agora).tipo,
    ).toBe("estado_diferente");
    expect(regressoDe(null, pedido, agora).tipo).toBe("sem_codigo");
  });
});

// Configurar a ligação ao Moloni (docs/22 §32; Q1 em A).
describe("configurar a ligação", () => {
  const ligacao = {
    versao: 3,
    serie: "77",
    taxas: [{ pais: "PT", taxa: 2300, emissor: "11" }],
    isencoes: [],
    config: { lingua: "1", metodos_pagamento: { mb_way: "31" } },
  };
  const necessario = {
    taxas: [
      { pais: "PT", taxa: 2300 },
      { pais: "PT", taxa: 600 },
    ],
    isencoes: [{ pais: "PT", codigo: "M16" }],
    meios: ["mb_way", "multibanco"],
  };

  it("as escolhas partem do que está gravado; nada vem escolhido por adivinhar", () => {
    const e = escolhasDe(ligacao);
    expect(e.serie).toBe("77");
    expect(e.taxas).toEqual({ "PT|2300": "11" });
    expect(e.metodos).toEqual({ mb_way: "31" });
    expect(e.config.vencimento).toBe("");
    expect(escolhasDe({ ...ligacao, serie: null, taxas: [] }).taxas).toEqual(
      {},
    );
  });

  it("o que falta muda com as escolhas, pela mesma chave do servidor", () => {
    const e = escolhasDe(ligacao);
    expect(faltaNasEscolhas(necessario, e)).toEqual({
      taxas: [{ pais: "PT", taxa: 600 }],
      isencoes: [{ pais: "PT", codigo: "M16" }],
      meios: ["multibanco"],
    });
    const tudo = {
      ...e,
      taxas: { ...e.taxas, "PT|600": "12" },
      isencoes: { M16: "M16" },
      metodos: { ...e.metodos, multibanco: "32" },
    };
    expect(faltaNasEscolhas(necessario, tudo)).toEqual({
      taxas: [],
      isencoes: [],
      meios: [],
    });
  });

  it("o resumo do que falta, no singular e no plural; nada quando nada falta", () => {
    expect(
      resumoDoQueFalta(TEXTOS.pt, {
        taxas: [
          { pais: "PT", taxa: 600 },
          { pais: "ES", taxa: 2100 },
        ],
        isencoes: [],
        meios: ["mb_way"],
      }),
    ).toBe("Falta mapear: 2 taxas e 1 método de pagamento.");
    expect(
      resumoDoQueFalta(TEXTOS.pt, { taxas: [], isencoes: [], meios: [] }),
    ).toBeNull();
  });

  it("Q1 em A: as taxas de mesmo valor e zona ficam no topo, sem nenhuma escolhida", () => {
    const taxas = [
      { id: "12", nome: "Reduzida", valor: 600, zona: "PT" },
      { id: "13", nome: "Normal ES", valor: 2100, zona: "ES" },
      { id: "11", nome: "Normal", valor: 2300, zona: "PT" },
      { id: "14", nome: "Normal antiga", valor: 2300, zona: "pt" },
      { id: "15", nome: "Açores", valor: 2300, zona: "PT-AC" },
    ];
    const r = taxasParaOPar(taxas, { pais: "PT", taxa: 2300 });
    expect(r.batem.map((x) => x.id)).toEqual(["11", "14"]);
    expect(r.outras.map((x) => x.id)).toEqual(["12", "13", "15"]);
  });

  it("o corpo a gravar leva a versão lida e só o que foi escolhido", () => {
    const e = escolhasDe(ligacao);
    const corpo = paraGravar(
      {
        ...e,
        taxas: { ...e.taxas, "PT|600": "" },
        config: { ...e.config, artigo_portes: "1001" },
      },
      ligacao.versao,
    );
    expect(corpo).toEqual({
      versao: 3,
      serie: "77",
      taxas: [{ pais: "PT", taxa: 2300, emissor: "11" }],
      isencoes: [],
      config: {
        lingua: "1",
        artigo_portes: "1001",
        metodos_pagamento: { mb_way: "31" },
      },
    });
    expect(
      paraGravar({ ...e, serie: "", metodos: { mb_way: "" } }, 1),
    ).toMatchObject({ serie: null, config: { lingua: "1" } });
    expect(
      paraGravar({ ...e, metodos: { mb_way: "" } }, 1).config,
    ).not.toHaveProperty("metodos_pagamento");
  });

  it("o endereço do ecrã Configurar", () => {
    expect(enderecoConfigurar("mer_x", "isx_y")).toBe(
      "/faturacao/configurar?comerciante=mer_x&ligacao=isx_y",
    );
  });
});

// A linha de um caso da fila `ligacao_faturacao` no «A decidir» (docs/29
// §18, L6; revisão do #422, P2-1).
describe("a ligação com erro no «A decidir»", () => {
  const f = {
    entidades: [
      {
        id: "lgl_1",
        nome: "Loja Exemplo, Lda",
        pais: "PT",
        emissor: "eurolify",
        retidas_sem_ligacao: 12,
      },
      { id: "lgl_2", nome: "Outra, Lda", pais: "PT", emissor: "eurolify" },
    ],
    ligacoes: [
      { id: "isx_1", entidade_legal: "lgl_1", adaptador: "moloni" },
      { id: "isx_2", entidade_legal: "lgl_2", adaptador: "moloni" },
    ] as LigacaoFaturacao[],
  };

  it("diz a entidade, o software e as faturas retidas; null se a ligação já não estiver", () => {
    expect(resumoDaLigacaoComErro(t, f, "isx_1")).toBe(
      "Loja Exemplo, Lda · Moloni · 12 faturas retidas à espera da ligação.",
    );
    expect(resumoDaLigacaoComErro(t, f, "isx_2")).toBe(
      "Outra, Lda · Moloni · Nenhuma fatura retida por agora.",
    );
    expect(resumoDaLigacaoComErro(t, f, "isx_3")).toBeNull();
  });
});
