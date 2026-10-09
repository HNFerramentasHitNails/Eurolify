import { describe, expect, it } from "vitest";
import {
  linhaDasOpcoes,
  valorDaVariante,
  type OpcaoArtigo,
} from "../src/opcoes";

// Como se monta a coluna de cada opção e a linha por cima da tabela
// (docs/22 §20.2 e §20.3).

const tamanho: OpcaoArtigo = {
  id: "opt_1",
  nome: "Tamanho",
  posicao: 0,
  valores: [
    { id: "ovl_1", valor: "15 ml", variantes: ["var_a"] },
    // Uma variante arquivada tem o seu valor como as outras.
    { id: "ovl_2", valor: "30 ml", variantes: ["var_b", "var_c"] },
    // Um valor que nenhuma variante usa.
    { id: "ovl_3", valor: "50 ml", variantes: [] },
  ],
};
const cor: OpcaoArtigo = {
  id: "opt_2",
  nome: "Cor",
  posicao: 1,
  valores: [
    { id: "ovl_4", valor: "Azul", variantes: ["var_a"] },
    { id: "ovl_5", valor: "Rosa", variantes: [] },
  ],
};

describe("as opções na ficha", () => {
  it("a variante com valor mostra-o na coluna da opção", () => {
    expect(valorDaVariante(tamanho, "var_a")).toBe("15 ml");
    expect(valorDaVariante(tamanho, "var_c")).toBe("30 ml");
    expect(valorDaVariante(cor, "var_a")).toBe("Azul");
  });

  it("a variante sem valor nessa opção fica sem nada (o ecrã mostra «—»)", () => {
    expect(valorDaVariante(cor, "var_b")).toBeNull();
    expect(valorDaVariante(tamanho, "var_x")).toBeNull();
  });

  it("a linha tem as opções e os valores todos, pela ordem, também os que nenhuma variante usa", () => {
    expect(linhaDasOpcoes([tamanho, cor])).toBe(
      "Tamanho (15 ml, 30 ml, 50 ml) · Cor (Azul, Rosa)",
    );
  });

  it("um artigo sem opções não tem linha", () => {
    expect(linhaDasOpcoes([])).toBe("");
  });
});
