import { describe, expect, it } from "vitest";
import {
  ESTADOS_PAGAMENTO,
  MOTIVOS_DIFERENCA,
} from "../../api/src/base/esquema";
import type { DiferencaPagamento } from "../src/api";
import {
  casoDoDialogo,
  enderecoDiferencas,
  naoFicaPaga,
  pagamentoAConferir,
  provaEmTexto,
  separadorDe,
  sugestaoDaResolucao,
  textoDepoisDaSugestao,
} from "../src/pagamentos";
import { LINGUAS, TEXTOS } from "../src/textos";

// A fila de diferenças de pagamento no Hub (docs/22 §34): o que o ecrã diz de
// cada diferença, a partir do que a API grava.

const t = TEXTOS.pt;

function diferenca(
  motivo: string,
  prova: unknown,
  pagamento: DiferencaPagamento["pagamento"] = {
    id: "pay_1",
    encomenda: "ord_0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f7c1d",
    metodo: "mb_way",
    montante: 29.9,
    moeda: "EUR",
    estado: "capturado",
    prestador: "eupago",
    referencia_prestador: null,
    identificador: "0123456789abcdef0123456789abcdef",
    criado_em: "2026-10-13T15:30:00Z",
  },
): DiferencaPagamento {
  return {
    id: "pdi_1",
    pagamento,
    aviso: null,
    motivo,
    prova,
    estado: "aberta",
    resolucao: null,
    resolvida_por: null,
    resolvida_em: null,
    criada_em: "2026-10-14T10:00:00Z",
  };
}

describe("a prova em linguagem comum", () => {
  it("o montante diferente diz o esperado e o recebido, em euros", () => {
    expect(
      provaEmTexto(
        t,
        diferenca("montante_diferente", { esperado: 29.9, recebido: 24.9 }),
        "pt-PT",
      ),
    ).toMatch(/^Esperado 29,90\s€, recebido 24,90\s€\.$/);
  });

  it("a transição impossível diz os estados em palavras", () => {
    expect(
      provaEmTexto(
        t,
        diferenca("transicao_impossivel", { de: "falhado", para: "capturado" }),
        "pt-PT",
      ),
    ).toBe(
      "O prestador quis passar de «falhado» a «pago», o que não pode ser.",
    );
  });

  it("o aviso sem pagamento diz a referência", () => {
    expect(
      provaEmTexto(
        t,
        diferenca(
          "aviso_sem_pagamento",
          { referencia: "123456789", estado: "Paid" },
          null,
        ),
        "pt-PT",
      ),
    ).toContain("123456789");
  });

  it("uma prova que não se conhece fica como chave e valor, sem se perder", () => {
    expect(
      provaEmTexto(t, diferenca("montante_diferente", { outro: "x" }), "pt-PT"),
    ).toBe("outro: x");
  });

  it("uma prova vazia diz que não há pormenores", () => {
    expect(provaEmTexto(t, diferenca("montante_diferente", {}), "pt-PT")).toBe(
      "Sem pormenores.",
    );
  });

  it("cada motivo e cada estado da API têm texto nas três línguas, na fila e no ecrã", () => {
    for (const lingua of LINGUAS) {
      const textos = TEXTOS[lingua] as Record<string, string | undefined>;
      for (const m of MOTIVOS_DIFERENCA) {
        expect(textos[`motivoTarefa_${m}`], `${lingua} ${m}`).toBeDefined();
      }
      for (const e of ESTADOS_PAGAMENTO) {
        expect(textos[`estadoPagamento_${e}`], `${lingua} ${e}`).toBeDefined();
      }
    }
  });
});

describe("o diálogo de resolver", () => {
  it("num pagamento incerto pergunta se foi pago; num reembolso, avisa; nos outros, só o texto", () => {
    expect(
      casoDoDialogo(
        diferenca(
          "incerto",
          {},
          {
            id: "pay_1",
            encomenda: null,
            metodo: "multibanco",
            montante: 10,
            moeda: "EUR",
            estado: "incerto",
            prestador: "eupago",
            referencia_prestador: null,
            identificador: "0123456789abcdef0123456789abcdef",
            criado_em: "2026-10-13T15:30:00Z",
          },
        ),
      ),
    ).toBe("incerto");
    // Já decidido por outro lado: não volta a perguntar.
    expect(casoDoDialogo(diferenca("incerto", {}))).toBe("normal");
    // Os três motivos de reembolso: o reembolso decide-se na devolução (Q3 A).
    for (const m of [
      "reembolso_incerto",
      "reembolso_por_confirmar",
      "reembolso_desconhecido",
    ]) {
      expect(casoDoDialogo(diferenca(m, {})), m).toBe("reembolso");
    }
    expect(casoDoDialogo(diferenca("montante_diferente", {}))).toBe("normal");
    expect(casoDoDialogo(diferenca("aviso_sem_pagamento", {}, null))).toBe(
      "normal",
    );
  });
});

const incerto = (
  referenciaPrestador: string | null = null,
): DiferencaPagamento =>
  diferenca(
    "incerto",
    {},
    {
      id: "pay_1",
      encomenda: null,
      metodo: "multibanco",
      montante: 42.5,
      moeda: "EUR",
      estado: "incerto",
      prestador: "eupago",
      referencia_prestador: referenciaPrestador,
      identificador: "0123456789abcdef0123456789abcdef",
      criado_em: "2026-10-13T23:30:00Z",
    },
  );

describe("o pagamento incerto: o que se confere e o texto sugerido (Q1 A)", () => {
  it("põe à vista o montante e a data no fuso do comerciante", () => {
    const v = pagamentoAConferir(incerto(), "pt-PT", "Europe/Lisbon");
    expect(v?.prestador).toBe("EuPago");
    expect(v?.montante).toMatch(/^42,50\s€$/);
    // 23:30 UTC é já dia 14 em Lisboa (+1) e dia 13 em UTC.
    expect(v?.data).toContain("14");
    expect(pagamentoAConferir(incerto(), "pt-PT", "UTC")?.data).toContain("13");
  });

  it("a referência é só a do prestador; o identificador nosso é outro campo", () => {
    expect(pagamentoAConferir(incerto(), "pt-PT")?.referencia).toBeNull();
    expect(pagamentoAConferir(incerto(), "pt-PT")?.identificador).toBe(
      "0123456789abcdef0123456789abcdef",
    );
    expect(
      pagamentoAConferir(incerto("123 456 789"), "pt-PT")?.referencia,
    ).toBe("123 456 789");
  });

  it("com a referência do prestador, a sugestão leva-a", () => {
    expect(
      sugestaoDaResolucao(t, incerto("123 456 789"), "capturado", "pt-PT"),
    ).toMatch(
      /^Vi na conta da EuPago o pagamento de 42,50\s€ com a referência 123 456 789\.$/,
    );
    expect(
      sugestaoDaResolucao(t, incerto("123 456 789"), "falhado", "pt-PT"),
    ).toMatch(
      /^Vi na conta da EuPago que o pagamento de 42,50\s€ com a referência 123 456 789 não entrou\.$/,
    );
  });

  it("sem ela, só o montante e a data; nunca o identificador nosso", () => {
    const sim = sugestaoDaResolucao(t, incerto(), "capturado", "pt-PT", "UTC");
    expect(sim).toMatch(
      /^Vi na conta da EuPago o pagamento de 42,50\s€ de .*13.*\.$/,
    );
    expect(sim).not.toContain("0123456789abcdef");
    const nao = sugestaoDaResolucao(t, incerto(), "falhado", "pt-PT", "UTC");
    expect(nao).toMatch(/não entrou\.$/);
    expect(nao).not.toContain("referência");
  });

  it("nas três línguas, com e sem referência, nada fica por preencher", () => {
    for (const lingua of LINGUAS) {
      for (const pago of ["capturado", "falhado"] as const) {
        const com = sugestaoDaResolucao(
          TEXTOS[lingua],
          incerto("123 456 789"),
          pago,
          "pt-PT",
        );
        expect(com, `${lingua} ${pago}`).toContain("123 456 789");
        expect(com).not.toMatch(/\{\w+\}/);
        const sem = sugestaoDaResolucao(
          TEXTOS[lingua],
          incerto(),
          pago,
          "pt-PT",
        );
        expect(sem, `${lingua} ${pago}`).not.toBe("");
        expect(sem).not.toContain("0123456789abcdef");
        expect(sem).not.toMatch(/\{\w+\}/);
      }
      expect(TEXTOS[lingua].diferencaSugestaoNota.length).toBeGreaterThan(10);
    }
  });

  it("sem montante, sem prestador ou sem pagamento não sugere nada; campos em falta (API mais antiga) não rebentam", () => {
    const d = incerto();
    if (d.pagamento !== null) d.pagamento.montante = null;
    expect(sugestaoDaResolucao(t, d, "capturado", "pt-PT")).toBe("");
    expect(pagamentoAConferir(d, "pt-PT")).toBeNull();
    expect(
      sugestaoDaResolucao(
        t,
        diferenca("incerto", {}, null),
        "falhado",
        "pt-PT",
      ),
    ).toBe("");
    const velha = incerto();
    if (velha.pagamento !== null) {
      delete velha.pagamento.prestador;
      delete velha.pagamento.identificador;
      delete velha.pagamento.referencia_prestador;
      delete velha.pagamento.criado_em;
    }
    expect(pagamentoAConferir(velha, "pt-PT")?.data).toBe("");
    expect(sugestaoDaResolucao(t, velha, "capturado", "pt-PT")).toBe("");
  });
});

describe("a sugestão não pisa o que a pessoa escreveu (Q1 A)", () => {
  it("entra num campo vazio ou ainda com a sugestão anterior", () => {
    expect(textoDepoisDaSugestao("", "", "nova")).toBe("nova");
    expect(textoDepoisDaSugestao("  ", "", "nova")).toBe("nova");
    expect(textoDepoisDaSugestao("antiga", "antiga", "nova")).toBe("nova");
  });

  it("não entra por cima de um texto escrito ou alterado", () => {
    expect(textoDepoisDaSugestao("escrevi isto", "", "nova")).toBeNull();
    expect(
      textoDepoisDaSugestao("antiga alterada", "antiga", "nova"),
    ).toBeNull();
  });

  it("sem sugestão, não mexe", () => {
    expect(textoDepoisDaSugestao("", "", "")).toBeNull();
  });
});

describe("montante ou moeda diferentes: a encomenda não fica paga (Q2 A)", () => {
  it("só nestes dois motivos", () => {
    expect(naoFicaPaga(diferenca("montante_diferente", {}))).toBe(true);
    expect(naoFicaPaga(diferenca("moeda_diferente", {}))).toBe(true);
    for (const m of MOTIVOS_DIFERENCA) {
      if (m === "montante_diferente" || m === "moeda_diferente") continue;
      expect(naoFicaPaga(diferenca(m, {})), m).toBe(false);
    }
  });

  it("na lista, sem «Escreva aqui» (não há campo); no diálogo, com ele", () => {
    expect(t.diferencaNaoFicaPaga).toBe(
      "A encomenda não fica paga. Pode devolver ao cliente o que pagou, na conta do prestador, e pedir-lhe um pagamento novo, ou cancelar a encomenda.",
    );
    expect(t.diferencaNaoFicaPagaDialogo).toBe(
      `${t.diferencaNaoFicaPaga} Escreva aqui o que fez.`,
    );
    for (const lingua of LINGUAS) {
      const x = TEXTOS[lingua];
      expect(x.diferencaNaoFicaPaga.length, lingua).toBeGreaterThan(40);
      expect(
        x.diferencaNaoFicaPagaDialogo.startsWith(x.diferencaNaoFicaPaga),
        lingua,
      ).toBe(true);
      expect(x.diferencaNaoFicaPagaDialogo.length).toBeGreaterThan(
        x.diferencaNaoFicaPaga.length,
      );
    }
  });
});

describe("o endereço do ecrã", () => {
  it("leva o comerciante e o separador; por omissão, as por resolver", () => {
    expect(enderecoDiferencas("mer_1")).toBe(
      "/pagamentos/diferencas?comerciante=mer_1",
    );
    expect(enderecoDiferencas("mer_1", "resolvida")).toBe(
      "/pagamentos/diferencas?comerciante=mer_1&estado=resolvida",
    );
    expect(separadorDe("comerciante=mer_1&estado=resolvida")).toBe("resolvida");
    expect(separadorDe("comerciante=mer_1&estado=outra")).toBe("aberta");
  });
});
