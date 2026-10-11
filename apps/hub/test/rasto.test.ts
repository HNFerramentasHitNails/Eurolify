import { describe, expect, it } from "vitest";
import { linhaDoRasto, type RastoDaEntrada } from "../src/rasto";
import { TEXTOS } from "../src/textos";

// As respostas do rasto em linguagem comum (docs/22 §26.2): o ecrã diz o que
// o servidor decidiu, sem recalcular o aviso nem o tipo de autor.

const t = TEXTOS.pt;
const base: RastoDaEntrada = {
  origem: null,
  canal: "hub",
  pedido: "req-1",
  ia: { prova: "desconhecido", fornecedor: null, modelo: null, execucao: null },
  motivo: null,
  a_pedido_de: null,
  tipo_de_autor: "pessoa",
  a_pedido_de_tipo: null,
  sem_autorizacao_de_pessoa: false,
  autor_autorizou: { nome: "Ana Teste" },
  autor_do_pedido: null,
};

describe("a linha do rasto no histórico", () => {
  it("no Hub, pela própria pessoa: «No Hub · Autorizado por Ana Teste», a IA desconhecida só nos Detalhes", () => {
    const l = linhaDoRasto(base, t);
    expect(l.partes).toEqual(["No Hub"]);
    expect(l.autorizacao).toEqual({
      texto: "Autorizado por Ana Teste",
      aviso: false,
    });
    expect(l.detalhes).toEqual(["Pedido n.º req-1", "IA: desconhecida"]);
  });

  it("uma chave de um agente: «Pela API · Agente de IA (declarado: …) · ⚠ Sem autorização de uma pessoa»", () => {
    const l = linhaDoRasto(
      {
        ...base,
        canal: "api",
        tipo_de_autor: "agente",
        ia: {
          prova: "declarado",
          fornecedor: "fornecedor-x",
          modelo: "modelo-y",
          execucao: "run-7",
        },
        sem_autorizacao_de_pessoa: true,
        autor_autorizou: null,
      },
      t,
    );
    expect(l.partes).toEqual([
      "Pela API",
      "Agente de IA (declarado: fornecedor-x, modelo-y)",
    ]);
    expect(l.autorizacao).toEqual({
      texto: "Sem autorização de uma pessoa",
      aviso: true,
    });
    expect(l.detalhes).toEqual(["Pedido n.º req-1", "Execução: run-7"]);
    // Sem fornecedor nem modelo, sem os dois pontos.
    expect(
      linhaDoRasto(
        {
          ...base,
          ia: {
            prova: "declarado",
            fornecedor: null,
            modelo: null,
            execucao: null,
          },
        },
        t,
      ).partes[1],
    ).toBe("Agente de IA (declarado)");
  });

  it("uma tarefa a pedido de uma chave: «Automático · a pedido de Chave «Preços»»; sem nome, o tipo", () => {
    const tarefa: RastoDaEntrada = {
      ...base,
      canal: "sistema",
      pedido: "tarefa:conclusoes",
      tipo_de_autor: "sistema",
      a_pedido_de: { pedido: "req-9", quem: "chave:key_1" },
      a_pedido_de_tipo: "agente",
      autor_do_pedido: { nome: "Preços" },
      sem_autorizacao_de_pessoa: true,
      autor_autorizou: null,
    };
    const l = linhaDoRasto(tarefa, t);
    expect(l.partes).toEqual(["Automático", "a pedido de Chave «Preços»"]);
    expect(l.detalhes).toContain("A pedido de: pedido n.º req-9");
    expect(
      linhaDoRasto({ ...tarefa, autor_do_pedido: { nome: null } }, t).partes[1],
    ).toBe("a pedido de um agente de IA");
    // Nunca só «Automático» sem dizer que não há pedido de origem (Q6).
    expect(
      linhaDoRasto({ ...tarefa, a_pedido_de: null, a_pedido_de_tipo: null }, t)
        .partes,
    ).toEqual(["Automático", "sem pedido de origem registado"]);
  });

  it("uma linha antiga: «Origem desconhecida · Autorização desconhecida», nunca «sem autorização» (Q8)", () => {
    const l = linhaDoRasto(
      {
        ...base,
        canal: null,
        pedido: null,
        sem_autorizacao_de_pessoa: null,
        autor_autorizou: null,
      },
      t,
    );
    expect(l.partes).toEqual(["Origem desconhecida"]);
    expect(l.autorizacao).toEqual({
      texto: "Autorização desconhecida",
      aviso: false,
    });
  });

  it("a importação diz-se pelo canal ou, nas antigas, pela origem; um canal novo sai com o nome técnico", () => {
    expect(linhaDoRasto({ ...base, canal: "importacao" }, t).partes[0]).toBe(
      "Pela importação",
    );
    expect(
      linhaDoRasto({ ...base, canal: "api", origem: "importacao:imp_1" }, t)
        .partes[0],
    ).toBe("Pela importação");
    expect(linhaDoRasto({ ...base, canal: "novo" }, t).partes[0]).toBe("novo");
  });

  it("quem autorizou sem nome (de fora da equipa) não fica vazio; o motivo passa como está", () => {
    const l = linhaDoRasto(
      { ...base, autor_autorizou: { nome: null }, motivo: "<b>pedido</b>" },
      t,
    );
    expect(l.autorizacao.texto).toBe(
      "Autorizado por Pessoa de fora desta equipa",
    );
    expect(l.motivo).toBe("<b>pedido</b>");
  });
});
