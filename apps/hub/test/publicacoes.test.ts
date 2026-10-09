import { describe, expect, it } from "vitest";
import {
  celulaDoCanal,
  celulaDoMercado,
  type LinhaDePublicacao,
} from "../src/publicacoes";

// Os quatro casos da tabela do docs/22 §19.2, por coluna.

const linha = (
  canal: string,
  mercado: string,
  canal_nome: string | null,
  mercado_nome: string | null,
  loja_nome: string | null,
): LinhaDePublicacao => ({
  canal,
  mercado,
  canal_nome,
  mercado_nome,
  loja_nome,
});

describe("o canal e o mercado nas publicações da ficha", () => {
  it("um nome que não se repete fica só com o nome", () => {
    const a = linha("chn_1", "mkt_1", "Loja online", "Portugal", "Norte");
    const b = linha("chn_2", "mkt_2", "Revenda", "Espanha", "Norte");
    expect(celulaDoCanal([a, b], a)).toEqual({
      tipo: "nome",
      nome: "Loja online",
    });
    expect(celulaDoMercado([a, b], b)).toEqual({
      tipo: "nome",
      nome: "Espanha",
    });
  });

  it("o mesmo canal em várias linhas não conta como repetição", () => {
    const a = linha("chn_1", "mkt_1", "Loja online", "Portugal", "Norte");
    const b = linha("chn_1", "mkt_2", "Loja online", "Espanha", "Norte");
    expect(celulaDoCanal([a, b], a)).toEqual({
      tipo: "nome",
      nome: "Loja online",
    });
  });

  it("o mesmo nome em lojas com outro nome: a loja por baixo, coluna a coluna", () => {
    const a = linha("chn_1", "mkt_1", "Loja online", "Portugal", "Norte");
    const b = linha("chn_2", "mkt_2", "Loja online", "Espanha", "Sul");
    expect(celulaDoCanal([a, b], a)).toEqual({
      tipo: "nome_e_loja",
      nome: "Loja online",
      loja: "Norte",
    });
    expect(celulaDoCanal([a, b], b)).toEqual({
      tipo: "nome_e_loja",
      nome: "Loja online",
      loja: "Sul",
    });
    // Os mercados têm nomes diferentes: ficam só com o nome.
    expect(celulaDoMercado([a, b], a)).toEqual({
      tipo: "nome",
      nome: "Portugal",
    });
  });

  it("o mesmo nome na mesma loja, ou em lojas com o mesmo nome: o identificador", () => {
    const a = linha("chn_1", "mkt_1", "Loja online", "Portugal", "Norte");
    const b = linha("chn_2", "mkt_1", "Loja online", "Portugal", "Norte");
    expect(celulaDoCanal([a, b], b)).toEqual({
      tipo: "nome_e_identificador",
      nome: "Loja online",
      identificador: "chn_2",
    });
    // Três linhas: a loja de A repete-se em C, por isso A não se
    // distingue pela loja.
    const c = linha("chn_3", "mkt_3", "Loja online", "França", "Sul");
    const d = linha("chn_4", "mkt_4", "Loja online", "Itália", "Norte");
    expect(celulaDoCanal([a, c, d], a)).toEqual({
      tipo: "nome_e_identificador",
      nome: "Loja online",
      identificador: "chn_1",
    });
    // Sem o nome da loja, também o identificador.
    const e = linha("chn_5", "mkt_5", "Loja online", "Grécia", null);
    expect(celulaDoCanal([a, e], e)).toEqual({
      tipo: "nome_e_identificador",
      nome: "Loja online",
      identificador: "chn_5",
    });
  });

  it("os mercados seguem a mesma regra: a loja ou o identificador por baixo", () => {
    const a = linha("chn_1", "mkt_1", "Loja online", "Portugal", "Norte");
    const b = linha("chn_2", "mkt_2", "Revenda", "Portugal", "Sul");
    expect(celulaDoMercado([a, b], a)).toEqual({
      tipo: "nome_e_loja",
      nome: "Portugal",
      loja: "Norte",
    });
    const c = linha("chn_3", "mkt_3", "Revenda", "Portugal", "Norte");
    expect(celulaDoMercado([a, c], c)).toEqual({
      tipo: "nome_e_identificador",
      nome: "Portugal",
      identificador: "mkt_3",
    });
  });

  it("os espaços nas pontas não fazem nomes diferentes (revisão do #275, P3-2)", () => {
    const a = linha("chn_1", "mkt_1", "Loja online", "Portugal", "Norte");
    const b = linha("chn_2", "mkt_2", "Loja online ", "Espanha", "Norte ");
    expect(celulaDoCanal([a, b], a)).toEqual({
      tipo: "nome_e_identificador",
      nome: "Loja online",
      identificador: "chn_1",
    });
  });

  it("sem o nome, o identificador, como antes (§18.2)", () => {
    const a = linha("chn_1", "mkt_1", null, null, "Norte");
    expect(celulaDoCanal([a], a)).toEqual({
      tipo: "identificador",
      identificador: "chn_1",
    });
    expect(celulaDoMercado([a], a)).toEqual({
      tipo: "identificador",
      identificador: "mkt_1",
    });
  });
});
