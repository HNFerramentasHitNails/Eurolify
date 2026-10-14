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
    referencia: "123 456 789",
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
            referencia: "123 456 789",
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

const incerto = (): DiferencaPagamento =>
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
      referencia: "123 456 789",
      criado_em: "2026-10-13T15:30:00Z",
    },
  );

describe("o pagamento incerto: o que se confere e o texto sugerido (Q1 A)", () => {
  it("põe à vista o montante, a referência e a data", () => {
    const v = pagamentoAConferir(incerto(), "pt-PT");
    expect(v?.prestador).toBe("EuPago");
    expect(v?.montante).toMatch(/^42,50\s€$/);
    expect(v?.referencia).toBe("123 456 789");
    expect(v?.data).toContain("2026");
  });

  it("sugere o texto de «foi pago» com o prestador, o montante e a referência", () => {
    expect(sugestaoDaResolucao(t, incerto(), "capturado", "pt-PT")).toMatch(
      /^Vi na conta da EuPago o pagamento de 42,50\s€ com a referência 123 456 789\.$/,
    );
  });

  it("sugere o texto de «não foi pago»", () => {
    expect(sugestaoDaResolucao(t, incerto(), "falhado", "pt-PT")).toMatch(
      /^Vi na conta da EuPago que o pagamento de 42,50\s€ com a referência 123 456 789 não entrou\.$/,
    );
  });

  it("sem montante ou referência não sugere nada (nada se inventa)", () => {
    const d = incerto();
    if (d.pagamento !== null) d.pagamento.referencia = null;
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
  });

  it("as sugestões existem nas três línguas, sem chaves por preencher", () => {
    for (const lingua of LINGUAS) {
      const x = sugestaoDaResolucao(
        TEXTOS[lingua],
        incerto(),
        "capturado",
        "pt-PT",
      );
      expect(x, lingua).toContain("123 456 789");
      expect(x, lingua).not.toMatch(/\{\w+\}/);
    }
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

  it("o texto diz as saídas, nas três línguas", () => {
    expect(t.diferencaNaoFicaPaga).toBe(
      "A encomenda não fica paga. Pode devolver ao cliente o que pagou, na conta do prestador, e pedir-lhe um pagamento novo, ou cancelar a encomenda. Escreva aqui o que fez.",
    );
    for (const lingua of LINGUAS) {
      expect(
        TEXTOS[lingua].diferencaNaoFicaPaga.length,
        lingua,
      ).toBeGreaterThan(40);
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
