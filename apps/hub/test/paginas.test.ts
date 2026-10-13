import { describe, expect, it } from "vitest";
import { PAGINAS, paginaDe } from "../src/paginas";
import { LINGUAS, TEXTOS } from "../src/textos";

// A tabela das páginas (revisão do #425): cada página tem a sessão e o título
// escritos, e o seu caminho dá ela própria.

/** As páginas de antes de entrar: as únicas sem «Conta» e «Sair». */
const SEM_SESSAO = ["entrar", "recuperar", "convite"];

describe("as páginas do Hub", () => {
  it("o exemplo de cada uma dá ela própria (a ordem da tabela está certa)", () => {
    for (const p of PAGINAS) {
      expect(paginaDe(p.exemplo)?.nome, p.exemplo).toBe(p.nome);
    }
  });

  it("só as páginas de antes de entrar não têm «Conta» e «Sair»", () => {
    expect(PAGINAS.filter((p) => !p.sessao).map((p) => p.nome)).toEqual(
      SEM_SESSAO,
    );
  });

  it("cada página tem o seu título, em todas as línguas", () => {
    const titulos = PAGINAS.map((p) => p.titulo);
    expect(new Set(titulos).size).toBe(titulos.length);
    for (const l of LINGUAS) {
      for (const p of PAGINAS) {
        expect(TEXTOS[l][p.titulo], `${l} ${p.titulo}`).not.toBe("");
      }
    }
  });

  it("um nome por página", () => {
    const nomes = PAGINAS.map((p) => p.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it("as partes do caminho vêm pela ordem", () => {
    expect(paginaDe("/artigos/prd_1/precos/prl_2/var_3")).toEqual({
      nome: "preco",
      sessao: true,
      titulo: "precoTitulo",
      partes: ["prd_1", "prl_2", "var_3"],
    });
    expect(paginaDe("/artigos/novo")?.nome).toBe("artigoNovo");
    expect(paginaDe("/artigos/prd_1/variantes/nova")).toMatchObject({
      nome: "varianteNova",
      partes: ["prd_1"],
    });
  });

  it("um caminho que nenhuma serve não é página (o início, sem sessão)", () => {
    for (const c of [
      "/nada",
      "/hub/products",
      "/artigos/prd_1/outra",
      "/envios/x",
    ]) {
      expect(paginaDe(c), c).toBeNull();
    }
  });
});
