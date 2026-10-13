import { describe, expect, it } from "vitest";
import { ErroHub, type EncomendaParaExpedir } from "../src/api";
import { ErroDoEcra } from "../src/erros";
import {
  accoesDaEtiqueta,
  comEtiqueta,
  conferirQuantidades,
  erroDeExpedir,
  nomeDoMetodo,
  quantidadesPorOmissao,
  totalPorExpedir,
} from "../src/expedir";

// O apoio do ecrã «Expedir» (docs/22 §32): o que falta, o que se envia e
// o que a etiqueta deixa fazer. O servidor confere tudo outra vez.

const encomenda: EncomendaParaExpedir = {
  id: "ord_1",
  estado: "em_preparacao",
  criada_em: "2026-10-12T15:42:00.000Z",
  metodo_entrega: { nome: { pt: "Correio", en: "Mail" }, conta: "cac_x" },
  entrega: { localidade: "Lisboa" },
  destinatario: { nome: "Rui", telefone: null },
  linhas: [
    {
      id: "oli_a",
      posicao: 1,
      variante: "var_a",
      sku: "A",
      nome: "A",
      quantidade: 2,
      expedida: 2,
    },
    {
      id: "oli_b",
      posicao: 2,
      variante: "var_b",
      sku: "B",
      nome: "B",
      quantidade: 3,
      expedida: 1,
    },
  ],
};

describe("expedir no Hub", () => {
  it("o que falta e o formulário por omissão: só as linhas com alguma coisa por expedir", () => {
    expect(totalPorExpedir(encomenda)).toBe(2);
    expect(quantidadesPorOmissao(encomenda)).toEqual({ oli_b: "2" });
  });

  it("as quantidades: nunca mais do que falta, um número inteiro, pelo menos uma", () => {
    expect(conferirQuantidades(encomenda, { oli_b: "2" })).toEqual({
      linhas: [{ linha: "oli_b", quantidade: 2 }],
      falta: null,
    });
    expect(conferirQuantidades(encomenda, { oli_b: "3" }).falta).toEqual({
      linha: "oli_b",
      texto: "expedirMaisDoQueFalta",
    });
    expect(conferirQuantidades(encomenda, { oli_b: "1,5" }).falta?.texto).toBe(
      "expedirQuantidadeErrada",
    );
    expect(conferirQuantidades(encomenda, { oli_b: "0" }).falta).toEqual({
      linha: null,
      texto: "expedirNadaEscolhido",
    });
  });

  it("com conta há etiqueta; o nome do método na língua pedida", () => {
    expect(comEtiqueta(encomenda.metodo_entrega)).toBe(true);
    expect(comEtiqueta({ nome: "Loja" })).toBe(false);
    expect(nomeDoMetodo(encomenda.metodo_entrega, "en")).toBe("Mail");
    expect(nomeDoMetodo(encomenda.metodo_entrega, "es")).toBe("Correio");
    expect(nomeDoMetodo({ nome: "Texto" }, "es")).toBe("Texto");
  });

  it("a etiqueta: pede-se só numa expedição por sair e sem etiqueta viva; uma incerta só se consulta", () => {
    expect(accoesDaEtiqueta("por_pedir", "criada")).toEqual({
      pedir: true,
      anular: false,
      consultar: false,
    });
    expect(accoesDaEtiqueta("incerta", "criada")).toEqual({
      pedir: false,
      anular: false,
      consultar: true,
    });
    expect(accoesDaEtiqueta("emitida", "criada")).toEqual({
      pedir: false,
      anular: true,
      consultar: true,
    });
    expect(accoesDaEtiqueta("emitida", "expedida").anular).toBe(false);
    expect(accoesDaEtiqueta("recusada", "cancelada").pedir).toBe(false);
  });

  it("os erros do servidor dizem-se com o texto deste ecrã", () => {
    const erro = (codigo: string) =>
      erroDeExpedir(new ErroHub(409, codigo, {}, undefined, undefined));
    expect((erro("shipping.label_uncertain") as ErroDoEcra).chave).toBe(
      "etiquetaIncertaConsultar",
    );
    expect((erro("inventory.lot_required") as ErroDoEcra).chave).toBe(
      "expedirSemLote",
    );
    expect(erro("outro.codigo")).toBeInstanceOf(ErroHub);
  });
});
