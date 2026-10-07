import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  alterarArtigo,
  arquivarVariante,
  classificarArtigo,
  criarArtigo,
  mudarEstadoArtigo,
  obterArtigo,
} from "../src/catalogo/repositorio.js";
import {
  publicacoesDoArtigo,
  publicar,
  retirarPublicacao,
  reverificarPublicacoes,
  type PedidoDePublicacao,
} from "../src/catalogo/publicacao.js";
import { apagarTraducao, definirTraducao } from "../src/catalogo/traducoes.js";
import {
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  alterarMercado,
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  definirPreco,
  mudarEstadoMercado,
} from "../src/precos/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Reverificar as publicações quando muda o que a verificação lê (docs/14 §8;
// decisão do Diogo, 07/10/2026, opção a; docs/06, CJ; migração 0023): a que
// deixa de passar sai de venda com o motivo `verificacao_falhou`. Contra o
// PostgreSQL 18 verdadeiro.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };
const ENTIDADE = {
  denominacao: "Exemplo, Lda.",
  forma_juridica: "sociedade por quotas",
  pais: "PT",
  numero_fiscal: "123456789",
  morada_linha: "Rua de Teste, 1",
  morada_codigo_postal: "1000-001",
  morada_localidade: "Lisboa",
};
const QUEM = "pessoa:teste";
const CLASSIFICACAO = {
  familias: ["retalho_geral"],
  natureza_consumidor: "bem" as const,
};

describe.skipIf(URL_BASE === undefined)("reverificar as publicações", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  /**
   * Um comerciante com um mercado activo (nas línguas dadas) e um canal que
   * vende lá. O português é a língua de origem.
   */
  async function loja(linguas: string[] = ["pt"]) {
    const c = await registarComerciante(base.api, NOVO);
    const entidade = await criarEntidadeLegal(base.api, c, ENTIDADE);
    const lojaId = await criarLoja(base.api, c, {
      entidade_legal_id: entidade,
      nome: "Loja online",
    });
    const mercado = await criarMercado(base.api, c, {
      loja_id: lojaId,
      nome: "Portugal",
      paises: ["PT"],
      moeda: "EUR",
      linguas,
      lingua_principal: "pt",
    });
    const lista = await criarLista(base.api, c, {
      mercado_id: mercado,
      nome: "Base PT",
      tipo: "base",
    });
    await mudarEstadoMercado(base.api, c, mercado, 1, "activo");
    const canal = await criarCanal(base.api, c, {
      loja_id: lojaId,
      nome: "Loja online",
    });
    await definirMercadosDoCanal(base.api, c, canal, [mercado]);
    return { c, mercado, lista, canal };
  }

  type Loja = Awaited<ReturnType<typeof loja>>;

  /** Um artigo publicado na loja, com as variantes dadas (todas à venda). */
  async function publicado(l: Loja, skus: string[] = ["GEL-001"]) {
    const artigo = await criarArtigo(
      base.api,
      l.c,
      { tipo: "fisico", nome: "Gel", categoria_fiscal: "normal" },
      skus.map((sku) => ({ sku, unidade_de_venda: "unidade", peso_g: 30 })),
    );
    const variantes = await comComerciante(base.api, l.c, (trx) =>
      trx
        .selectFrom("variante")
        .select(["id", "sku"])
        .where("artigo_id", "=", artigo)
        .orderBy("sku")
        .execute(),
    );
    await classificarArtigo(base.api, l.c, artigo, 1, CLASSIFICACAO, QUEM);
    await mudarEstadoArtigo(base.api, l.c, artigo, 2, "activo");
    for (const v of variantes) {
      await definirPreco(base.api, l.c, QUEM, l.lista, v.id, {
        montante: 990,
      });
    }
    const pedido: PedidoDePublicacao = {
      artigo_id: artigo,
      canal_id: l.canal,
      mercado_id: l.mercado,
    };
    const r = await publicar(base.api, l.c, QUEM, pedido);
    expect(r.publicada).toBe(true);
    return { artigo, variantes: variantes.map((v) => v.id), pedido };
  }

  async function aPublicacao(l: Loja, artigo: string) {
    const [p] = await publicacoesDoArtigo(base.api, l.c, artigo);
    if (p === undefined) throw new Error("falta a publicação");
    return p;
  }

  /** Os códigos dos impedimentos guardados na publicação. */
  function codigos(ultima: unknown): string[] {
    return (ultima as { impedimentos: { codigo: string }[] }).impedimentos.map(
      (i) => i.codigo,
    );
  }

  async function versaoDoArtigo(l: Loja, artigo: string) {
    return (await obterArtigo(base.api, l.c, artigo)).versao;
  }

  it("uma classificação que deixa de servir tira o artigo de venda, com o motivo, quem e os impedimentos", async () => {
    const l = await loja();
    const a = await publicado(l);
    await classificarArtigo(
      base.api,
      l.c,
      a.artigo,
      await versaoDoArtigo(l, a.artigo),
      { familias: ["alcool_tabaco"], natureza_consumidor: "bem" },
      "pessoa:outra",
    );
    const p = await aPublicacao(l, a.artigo);
    expect(p).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "verificacao_falhou",
      arquivado_por: "pessoa:outra",
    });
    expect(codigos(p.ultima_verificacao)).toEqual(["familia_restrita"]);
    // O evento leva o motivo (0021).
    const { rows } = await sql<{ tipo: string; motivo: string }>`
      select tipo, dados->>'motivo' as motivo from evento_saida
      where comerciante_id = ${l.c} and tipo = 'product.unpublished'`.execute(
      base.dono,
    );
    expect(rows).toEqual([
      { tipo: "product.unpublished", motivo: "verificacao_falhou" },
    ]);
  });

  it("uma mudança que continua a passar não toca na publicação", async () => {
    const l = await loja();
    const a = await publicado(l);
    const antes = await aPublicacao(l, a.artigo);
    await alterarArtigo(
      base.api,
      l.c,
      a.artigo,
      await versaoDoArtigo(l, a.artigo),
      { nome: "Gel de unhas", descricao: "Outro texto" },
    );
    const depois = await aPublicacao(l, a.artigo);
    expect(depois).toMatchObject({ estado: "publicado", versao: antes.versao });
  });

  it("um nome novo desactualiza a tradução e tira de venda num mercado com outra língua", async () => {
    const l = await loja(["pt", "es"]);
    const artigo = await criarArtigo(
      base.api,
      l.c,
      { tipo: "fisico", nome: "Gel", categoria_fiscal: "normal" },
      [{ sku: "GEL-001", unidade_de_venda: "unidade", peso_g: 30 }],
    );
    await definirTraducao(base.api, l.c, QUEM, {
      tipo: "artigo",
      recursoId: artigo,
      campo: "nome",
      lingua: "es",
      texto: "Gel",
      origem: "pessoa",
      originalVisto: "Gel",
    });
    const [v] = await comComerciante(base.api, l.c, (trx) =>
      trx
        .selectFrom("variante")
        .select("id")
        .where("artigo_id", "=", artigo)
        .execute(),
    );
    if (v === undefined) throw new Error("falta a variante");
    await classificarArtigo(base.api, l.c, artigo, 1, CLASSIFICACAO, QUEM);
    await mudarEstadoArtigo(base.api, l.c, artigo, 2, "activo");
    await definirPreco(base.api, l.c, QUEM, l.lista, v.id, { montante: 990 });
    const r = await publicar(base.api, l.c, QUEM, {
      artigo_id: artigo,
      canal_id: l.canal,
      mercado_id: l.mercado,
    });
    expect(r.publicada).toBe(true);
    await alterarArtigo(
      base.api,
      l.c,
      artigo,
      await versaoDoArtigo(l, artigo),
      { nome: "Gel de unhas" },
    );
    const p = await aPublicacao(l, artigo);
    expect(p).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "verificacao_falhou",
      arquivado_por: "catalogo:verificacao_falhou",
    });
    expect(codigos(p.ultima_verificacao)).toEqual(["traducao_desactualizada"]);
  });

  it("apagar a tradução do nome tira de venda; noutro artigo não mexe", async () => {
    const l = await loja(["pt", "es"]);
    const artigos: string[] = [];
    for (const sku of ["GEL-001", "LIMA-001"]) {
      const artigo = await criarArtigo(
        base.api,
        l.c,
        { tipo: "fisico", nome: sku, categoria_fiscal: "normal" },
        [{ sku, unidade_de_venda: "unidade", peso_g: 30 }],
      );
      await definirTraducao(base.api, l.c, QUEM, {
        tipo: "artigo",
        recursoId: artigo,
        campo: "nome",
        lingua: "es",
        texto: sku,
        origem: "pessoa",
        originalVisto: sku,
      });
      const [v] = await comComerciante(base.api, l.c, (trx) =>
        trx
          .selectFrom("variante")
          .select("id")
          .where("artigo_id", "=", artigo)
          .execute(),
      );
      if (v === undefined) throw new Error("falta a variante");
      await classificarArtigo(base.api, l.c, artigo, 1, CLASSIFICACAO, QUEM);
      await mudarEstadoArtigo(base.api, l.c, artigo, 2, "activo");
      await definirPreco(base.api, l.c, QUEM, l.lista, v.id, {
        montante: 990,
      });
      expect(
        (
          await publicar(base.api, l.c, QUEM, {
            artigo_id: artigo,
            canal_id: l.canal,
            mercado_id: l.mercado,
          })
        ).publicada,
      ).toBe(true);
      artigos.push(artigo);
    }
    const [gel, lima] = artigos as [string, string];
    await apagarTraducao(base.api, l.c, gel, "nome", "es");
    const p = await aPublicacao(l, gel);
    expect(p.estado).toBe("arquivado");
    expect(codigos(p.ultima_verificacao)).toEqual(["traducao_em_falta"]);
    expect((await aPublicacao(l, lima)).estado).toBe("publicado");
  });

  it("arquivar uma variante deixa a publicação; arquivar a última à venda tira-a", async () => {
    const l = await loja();
    const a = await publicado(l, ["GEL-001", "GEL-002"]);
    const [primeira, segunda] = a.variantes as [string, string];
    await arquivarVariante(base.api, l.c, primeira);
    expect((await aPublicacao(l, a.artigo)).estado).toBe("publicado");
    await arquivarVariante(base.api, l.c, segunda);
    const p = await aPublicacao(l, a.artigo);
    expect(p).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "verificacao_falhou",
    });
    expect(codigos(p.ultima_verificacao)).toEqual(["sem_variantes_a_venda"]);
  });

  it("uma língua nova no mercado tira de venda os artigos sem o nome traduzido, só esses", async () => {
    const l = await loja();
    const semTraducao = await publicado(l, ["GEL-001"]);
    const comTraducao = await publicado(l, ["LIMA-001"]);
    await definirTraducao(base.api, l.c, QUEM, {
      tipo: "artigo",
      recursoId: comTraducao.artigo,
      campo: "nome",
      lingua: "es",
      texto: "Gel",
      origem: "pessoa",
      originalVisto: "Gel",
    });
    const { rows } = await sql<{ versao: number }>`
      select versao from mercado where id = ${l.mercado}`.execute(base.dono);
    await alterarMercado(base.api, l.c, l.mercado, rows[0]?.versao ?? 0, {
      linguas: ["pt", "es"],
    });
    const p = await aPublicacao(l, semTraducao.artigo);
    expect(p).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "verificacao_falhou",
    });
    expect(codigos(p.ultima_verificacao)).toEqual(["traducao_em_falta"]);
    expect((await aPublicacao(l, comTraducao.artigo)).estado).toBe("publicado");
  });

  it("uma publicação já retirada não muda: fica com o motivo e quem a retirou", async () => {
    const l = await loja();
    const a = await publicado(l);
    const retirada = await retirarPublicacao(
      base.api,
      l.c,
      "pessoa:outra",
      (await aPublicacao(l, a.artigo)).id,
    );
    await classificarArtigo(
      base.api,
      l.c,
      a.artigo,
      await versaoDoArtigo(l, a.artigo),
      { familias: ["alcool_tabaco"], natureza_consumidor: "bem" },
      QUEM,
    );
    expect(await aPublicacao(l, a.artigo)).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "retirada",
      arquivado_por: "pessoa:outra",
      versao: retirada.versao,
    });
  });

  it("dois arquivos de variantes ao mesmo tempo: o segundo espera pela publicação tomada pelo primeiro e ela sai de venda", async () => {
    const l = await loja();
    const a = await publicado(l, ["GEL-001", "GEL-002"]);
    const [primeira, segunda] = a.variantes as [string, string];
    // T1 faz o que arquivarVariante faz, até antes do commit, e espera.
    let largar: () => void = () => undefined;
    const porta = new Promise<void>((r) => {
      largar = r;
    });
    let t1Pronta: () => void = () => undefined;
    const pronta = new Promise<void>((r) => {
      t1Pronta = r;
    });
    const t1 = comComerciante(base.api, l.c, async (trx) => {
      await trx
        .updateTable("variante")
        .set({ estado: "arquivada" })
        .where("id", "=", primeira)
        .execute();
      // Ainda vê a segunda à venda: não tira nada.
      expect(
        await reverificarPublicacoes(trx, l.c, { artigo_id: a.artigo }),
      ).toEqual([]);
      t1Pronta();
      await porta;
    });
    await pronta;
    // T2: o código de verdade, com a segunda variante.
    const t2 = arquivarVariante(base.api, l.c, segunda);
    // Espera até T2 estar à espera de um bloqueio (ou acabar, se não
    // esperasse: aí o teste falha no fim).
    const t2Estado = { acabou: false };
    // Sem promessa recusada sem ninguém a ouvir: o erro, se houver, chega no
    // `await t2` abaixo.
    t2.then(
      () => (t2Estado.acabou = true),
      () => (t2Estado.acabou = true),
    );
    for (let i = 0; i < 100 && !t2Estado.acabou; i++) {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`.execute(
        base.dono,
      );
      if ((rows[0]?.n ?? 0) > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(t2Estado.acabou).toBe(false);
    largar();
    await t1;
    await t2;
    const p = await aPublicacao(l, a.artigo);
    expect(p).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "verificacao_falhou",
    });
    expect(codigos(p.ultima_verificacao)).toEqual(["sem_variantes_a_venda"]);
  }, 30_000);
});
