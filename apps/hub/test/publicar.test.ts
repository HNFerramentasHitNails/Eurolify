import { describe, expect, it } from "vitest";
import type { ParDeVenda, PublicacaoArtigo } from "../src/api";
import {
  chaveDaEscolha,
  escolhaDepoisDeRecarregar,
  escolhaInicial,
  linhasDosImpedimentos,
  paresSemPublicacao,
  podePublicar,
  publicacaoConfere,
  quantasFora,
  respostaPerdida,
  retiradaConfere,
  rotuloDoPar,
  variantesFora,
  verificacaoDesactualizada,
  type ContextoDosImpedimentos,
} from "../src/publicar";
import { TEXTOS } from "../src/textos";

// Publicar um artigo pelo Hub (docs/22 §27): que variantes vêm marcadas
// (Q1), quando «Publicar» aparece, a resposta perdida e o que cada
// impedimento diz e para onde leva.

const A = "var_a";
const B = "var_b";
const C = "var_c";

describe("as variantes que vêm marcadas", () => {
  it("num par sem publicação, todas as activas", () => {
    expect(escolhaInicial([A, B], null)).toEqual([A, B]);
  });

  it("numa publicação que existe, as que estão fora não vêm marcadas (Q1)", () => {
    expect(escolhaInicial([A, B], { variantes_fora: [B] })).toEqual([A]);
  });

  it("uma variante fora que já não é activa não conta", () => {
    expect(escolhaInicial([A], { variantes_fora: [B] })).toEqual([A]);
  });

  it("as que ficam por marcar vão em variantes_fora, pela ordem da ficha", () => {
    expect(variantesFora([A, B, C], [C, A])).toEqual([B]);
    expect(variantesFora([A, B], [A, B])).toEqual([]);
  });

  it("depois de recarregar ficam as escolhas; a variante nova não vem marcada", () => {
    expect(escolhaDepoisDeRecarregar([A], [A, B])).toEqual([A]);
    // Uma que deixou de ser activa sai das escolhas.
    expect(escolhaDepoisDeRecarregar([A, B], [B])).toEqual([B]);
  });
});

describe("quando «Publicar» aparece", () => {
  const chave = chaveDaEscolha("chn_1", "mkt_1", [B]);

  it("só depois de uma verificação sem impedimentos com as mesmas escolhas", () => {
    expect(podePublicar({ chave, impedimentos: [] }, chave)).toBe(true);
  });

  it("nunca sem verificação", () => {
    expect(podePublicar(null, chave)).toBe(false);
  });

  it("nunca com impedimentos", () => {
    expect(
      podePublicar(
        { chave, impedimentos: [{ codigo: "peso_em_falta" }] },
        chave,
      ),
    ).toBe(false);
  });

  it("mudar uma escolha esconde-o e pede outra verificação", () => {
    const verificada = { chave, impedimentos: [] };
    const outra = chaveDaEscolha("chn_1", "mkt_1", []);
    expect(podePublicar(verificada, outra)).toBe(false);
    expect(verificacaoDesactualizada(verificada, outra)).toBe(true);
    expect(verificacaoDesactualizada(verificada, chave)).toBe(false);
    expect(verificacaoDesactualizada(null, outra)).toBe(false);
  });

  it("a chave não depende da ordem das variantes fora, mas depende do par", () => {
    expect(chaveDaEscolha("chn_1", "mkt_1", [A, B])).toBe(
      chaveDaEscolha("chn_1", "mkt_1", [B, A]),
    );
    expect(chaveDaEscolha("chn_1", "mkt_1", [A])).not.toBe(
      chaveDaEscolha("chn_1", "mkt_2", [A]),
    );
  });
});

const publicacao = (p: Partial<PublicacaoArtigo> = {}): PublicacaoArtigo => ({
  id: "pub_1",
  canal: "chn_1",
  mercado: "mkt_1",
  canal_nome: "Loja online",
  mercado_nome: "Portugal",
  loja_nome: "Norte",
  estado: "publicado",
  variantes_fora: [],
  verificado_em: null,
  publicado_em: null,
  arquivado_em: null,
  motivo_arquivo: null,
  versao: 4,
  ultima_verificacao: { impedimentos: [], nao_verificado: ["conformidade"] },
  ...p,
});

describe("a resposta de publicar perdeu-se", () => {
  it("dá-se por feita: publicada, com as variantes pedidas e outra versão", () => {
    const agora = publicacao({ variantes_fora: [B], versao: 5 });
    expect(publicacaoConfere(agora, [B], 4)).toBe(true);
  });

  it("a ordem das variantes não conta", () => {
    const agora = publicacao({ variantes_fora: [B, C], versao: 5 });
    expect(publicacaoConfere(agora, [C, B], 4)).toBe(true);
  });

  it("recusada com impedimentos (publicada: false) não se dá por feita, mesmo com a versão a subir", () => {
    const agora = publicacao({
      versao: 5,
      ultima_verificacao: {
        impedimentos: [{ codigo: "peso_em_falta" }],
        nao_verificado: [],
      },
    });
    expect(publicacaoConfere(agora, [], 4)).toBe(false);
    expect(
      publicacaoConfere(
        publicacao({ versao: 5, ultima_verificacao: null }),
        [],
        4,
      ),
    ).toBe(false);
  });

  it("a mesma versão: nada mudou", () => {
    expect(publicacaoConfere(publicacao({ versao: 4 }), [], 4)).toBe(false);
  });

  it("outras variantes fora: não é a nossa mudança", () => {
    const agora = publicacao({ variantes_fora: [B], versao: 5 });
    expect(publicacaoConfere(agora, [], 4)).toBe(false);
    expect(publicacaoConfere(agora, [B, C], 4)).toBe(false);
  });

  it("não está publicada, ou não existe: não encontrou a mudança", () => {
    expect(
      publicacaoConfere(publicacao({ estado: "arquivado", versao: 5 }), [], 4),
    ).toBe(false);
    expect(publicacaoConfere(null, [], null)).toBe(false);
  });

  it("sem publicação antes (versão null), qualquer versão é outra", () => {
    expect(publicacaoConfere(publicacao({ versao: 1 }), [], null)).toBe(true);
  });

  it("retirar: arquivada com outra versão", () => {
    expect(
      retiradaConfere(publicacao({ estado: "arquivado", versao: 5 }), 4),
    ).toBe(true);
    expect(
      retiradaConfere(publicacao({ estado: "arquivado", versao: 4 }), 4),
    ).toBe(false);
    expect(retiradaConfere(publicacao({ versao: 5 }), 4)).toBe(false);
    expect(retiradaConfere(null, 4)).toBe(false);
  });

  it("é perdida a rede e o 5xx sem corpo da API, e só esses", () => {
    expect(respostaPerdida(0, undefined)).toBe(true);
    expect(respostaPerdida(502, undefined)).toBe(true);
    expect(respostaPerdida(503, "catalog.retry")).toBe(false);
    expect(respostaPerdida(409, "catalog.version_conflict")).toBe(false);
  });
});

describe("as publicações da ficha", () => {
  it("diz quantas variantes activas a publicação deixa fora", () => {
    expect(quantasFora({ variantes_fora: [B] }, [A, B])).toBe(1);
    // Uma variante arquivada em variantes_fora não conta.
    expect(quantasFora({ variantes_fora: [B, C] }, [A, B])).toBe(1);
    expect(quantasFora({ variantes_fora: [] }, [A, B])).toBe(0);
  });

  const par = (canal: string, mercado: string): ParDeVenda => ({
    canal,
    canal_nome: "Loja online",
    canal_estado: "activo",
    mercado,
    mercado_nome: mercado === "mkt_1" ? "Portugal" : "Espanha",
    mercado_estado: "activo",
    loja_nome: "Norte",
  });

  it("«Publicar noutra loja» lista os pares sem publicação, de qualquer estado", () => {
    const pares = [par("chn_1", "mkt_1"), par("chn_1", "mkt_2")];
    expect(paresSemPublicacao(pares, [])).toEqual(pares);
    expect(
      paresSemPublicacao(pares, [{ canal: "chn_1", mercado: "mkt_1" }]).map(
        (p) => p.mercado,
      ),
    ).toEqual(["mkt_2"]);
    expect(
      paresSemPublicacao(pares, [
        { canal: "chn_1", mercado: "mkt_1" },
        { canal: "chn_1", mercado: "mkt_2" },
      ]),
    ).toEqual([]);
  });

  it("«Publicar noutra loja» só oferece pares com o canal e o mercado activos", () => {
    const pares = [
      par("chn_1", "mkt_1"),
      { ...par("chn_2", "mkt_1"), canal_estado: "arquivado" },
      { ...par("chn_1", "mkt_2"), mercado_estado: "arquivado" },
    ];
    expect(paresSemPublicacao(pares, []).map((p) => p.canal)).toEqual([
      "chn_1",
    ]);
  });

  it("o rótulo do par junta a loja quando o nome se repete (§19.2)", () => {
    const a = par("chn_1", "mkt_1");
    const b = { ...par("chn_2", "mkt_1"), loja_nome: "Sul" };
    expect(rotuloDoPar([a], a)).toBe("Loja online · Portugal");
    expect(rotuloDoPar([a, b], a)).toBe("Loja online (Norte) · Portugal");
  });
});

describe("os impedimentos em linguagem comum", () => {
  const ctx: ContextoDosImpedimentos = {
    artigo: "prd_1",
    consulta: "comerciante=mer_1",
    mercadoNome: "Portugal",
    variantes: [
      { id: "var_a", sku: "ENS-041" },
      { id: "var_b", sku: "ENS-041-B" },
    ],
    listaBase: "prl_1",
    podeEscrever: true,
    podeEscreverPrecos: true,
    externo: false,
  };
  const palavra = (chave: keyof typeof TEXTOS.pt) => TEXTOS.pt[chave];

  it("o peso e o preço em falta dão uma linha por SKU, com a ligação de cada", () => {
    const linhas = linhasDosImpedimentos(
      [
        { codigo: "peso_em_falta", variantes: ["ENS-041", "ENS-041-B"] },
        { codigo: "preco_em_falta", variantes: ["ENS-041-B"] },
      ],
      ctx,
      palavra,
    );
    expect(linhas.map((l) => [l.texto, l.valores.sku])).toEqual([
      ["impedimento_peso_em_falta", "ENS-041"],
      ["impedimento_peso_em_falta", "ENS-041-B"],
      ["impedimento_preco_em_falta", "ENS-041-B"],
    ]);
    expect(linhas[0]?.ligacao?.destino).toBe(
      "/artigos/prd_1/variantes/var_a?comerciante=mer_1",
    );
    expect(linhas[2]?.ligacao?.destino).toBe(
      "/artigos/prd_1/precos/prl_1/var_b?comerciante=mer_1",
    );
    expect(linhas[2]?.valores.mercado).toBe("Portugal");
  });

  it("sem permissão, sem lista base ou num artigo do sistema de gestão, a frase fica sem ligação", () => {
    const peso = [{ codigo: "peso_em_falta", variantes: ["ENS-041"] }];
    const preco = [{ codigo: "preco_em_falta", variantes: ["ENS-041"] }];
    expect(
      linhasDosImpedimentos(peso, { ...ctx, podeEscrever: false }, palavra)[0]
        ?.ligacao,
    ).toBeNull();
    expect(
      linhasDosImpedimentos(peso, { ...ctx, externo: true }, palavra)[0]
        ?.ligacao,
    ).toBeNull();
    expect(
      linhasDosImpedimentos(preco, { ...ctx, listaBase: null }, palavra)[0]
        ?.ligacao,
    ).toBeNull();
    expect(
      linhasDosImpedimentos(
        preco,
        { ...ctx, podeEscreverPrecos: false },
        palavra,
      )[0]?.ligacao,
    ).toBeNull();
  });

  it("peso ou preço em falta sem SKU dá uma linha genérica", () => {
    const linhas = linhasDosImpedimentos(
      [
        { codigo: "peso_em_falta" },
        { codigo: "preco_em_falta", variantes: [] },
      ],
      ctx,
      palavra,
    );
    expect(linhas.map((l) => l.texto)).toEqual([
      "impedimento_peso_em_falta_generico",
      "impedimento_preco_em_falta_generico",
    ]);
    expect(linhas.every((l) => l.ligacao === null)).toBe(true);
    expect(linhas[1]?.valores.mercado).toBe("Portugal");
  });

  it("um SKU que a ficha não tem fica sem ligação", () => {
    const [linha] = linhasDosImpedimentos(
      [{ codigo: "peso_em_falta", variantes: ["OUTRO"] }],
      ctx,
      palavra,
    );
    expect(linha?.ligacao).toBeNull();
  });

  it("o artigo inactivo leva à ficha, a categoria fiscal à edição, as imagens à ficha", () => {
    const linhas = linhasDosImpedimentos(
      [
        { codigo: "artigo_nao_activo" },
        { codigo: "categoria_fiscal_em_falta" },
        { codigo: "texto_alternativo_em_falta", media: ["med_1"] },
      ],
      ctx,
      palavra,
    );
    expect(linhas.map((l) => l.ligacao?.destino)).toEqual([
      "/artigos/prd_1?comerciante=mer_1",
      "/artigos/prd_1/editar?comerciante=mer_1",
      "/artigos/prd_1?comerciante=mer_1",
    ]);
    expect(linhas[2]?.ligacao?.texto).toBe("publicarIrImagens");
  });

  it("os que se resolvem noutro sítio não têm ligação", () => {
    const codigos = [
      "mercado_inactivo",
      "canal_inactivo",
      "canal_nao_vende_no_mercado",
      "sem_variantes_a_venda",
      "classificacao_em_falta",
      "natureza_incompativel",
    ];
    const linhas = linhasDosImpedimentos(
      codigos.map((codigo) => ({ codigo })),
      ctx,
      palavra,
    );
    expect(linhas).toHaveLength(codigos.length);
    expect(linhas.every((l) => l.ligacao === null)).toBe(true);
    // Os três do canal e do mercado dizem o mesmo (§27.3).
    expect(new Set(linhas.slice(0, 3).map((l) => l.texto)).size).toBe(1);
  });

  it("as línguas, as famílias e o que falta entram na frase", () => {
    const [a, b, c] = linhasDosImpedimentos(
      [
        { codigo: "traducao_em_falta", linguas: ["es", "en"] },
        { codigo: "familia_restrita", familias: ["x"] },
        { codigo: "data_ou_local_em_falta", falta: ["data", "local"] },
      ],
      ctx,
      palavra,
    );
    expect(a?.valores.linguas).toBe("es, en");
    expect(b?.valores.familias).toBe("x");
    expect(c?.valores.falta).toBe("a data, o local");
  });

  it("um código que o Hub não conhece mostra-se com o código", () => {
    const [linha] = linhasDosImpedimentos(
      [{ codigo: "novo_codigo" }],
      ctx,
      palavra,
    );
    expect(linha).toMatchObject({
      texto: "impedimento_desconhecido",
      valores: { codigo: "novo_codigo" },
      ligacao: null,
    });
  });

  it("todo o código do servidor tem texto nas três línguas", () => {
    const codigos = [
      "artigo_nao_activo",
      "mercado_inactivo",
      "canal_inactivo",
      "canal_nao_vende_no_mercado",
      "sem_variantes_a_venda",
      "categoria_fiscal_em_falta",
      "peso_em_falta",
      "preco_em_falta",
      "traducao_em_falta",
      "traducao_desactualizada",
      "classificacao_em_falta",
      "natureza_incompativel",
      "data_ou_local_em_falta",
      "familia_restrita",
      "texto_alternativo_em_falta",
    ];
    for (const codigo of codigos) {
      const [linha] = linhasDosImpedimentos(
        [{ codigo, variantes: ["ENS-041"] }],
        ctx,
        palavra,
      );
      expect(linha?.texto, codigo).not.toBe("impedimento_desconhecido");
      for (const l of ["pt", "es", "en"] as const) {
        expect(
          TEXTOS[l][linha?.texto ?? "marca"].trim(),
          `${l} ${codigo}`,
        ).not.toBe("");
      }
    }
  });
});
