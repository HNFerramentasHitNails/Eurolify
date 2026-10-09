import { sql, type Transaction } from "kysely";
import type { BaseDados } from "../src/base/esquema.js";
import type { Classificacao } from "../src/catalogo/classificacao.js";
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
const CLASSIFICACAO: Classificacao = {
  familias: ["retalho_geral"],
  natureza_consumidor: "bem",
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
    return { c, lojaId, mercado, lista, canal };
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
      // Desde a linha do tempo (0033), toda a mudança no catálogo traz quem
      // (aqui, o da base de teste); o «catalogo:verificacao_falhou» deixou de se ver.
      arquivado_por: "teste:base",
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
    await apagarTraducao(base.api, l.c, "rui@exemplo.eu", gel, "nome", "es");
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

  /**
   * Corre `passos` numa transacção (T1) que fica aberta; com ela aberta,
   * arranca `t2` (o código de verdade) e espera até haver uma ligação à
   * espera de um bloqueio, ou até `t2` acabar. Depois deixa T1 acabar e
   * devolve se `t2` esperou e o que deu.
   */
  async function cruzar<T>(
    c: string,
    passos: (trx: Transaction<BaseDados>) => Promise<void>,
    t2: () => Promise<T>,
  ): Promise<{ esperou: boolean; resultado: T }> {
    let largar: () => void = () => undefined;
    const porta = new Promise<void>((r) => {
      largar = r;
    });
    let t1Pronta: () => void = () => undefined;
    const pronta = new Promise<void>((r) => {
      t1Pronta = r;
    });
    const t1 = comComerciante(base.api, c, async (trx) => {
      await sql`select set_config('eurolify.quem', ${QUEM}, true)`.execute(trx);
      await passos(trx);
      t1Pronta();
      await porta;
    });
    // Se T1 falhar antes de estar pronta, não se fica à espera para sempre.
    await Promise.race([pronta, t1]);
    const corrida = t2();
    const estado = { acabou: false };
    // Sem promessa recusada sem ninguém a ouvir: o erro chega no `await`.
    corrida.then(
      () => (estado.acabou = true),
      () => (estado.acabou = true),
    );
    for (let i = 0; i < 100 && !estado.acabou; i++) {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`.execute(
        base.dono,
      );
      if ((rows[0]?.n ?? 0) > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const esperou = !estado.acabou;
    largar();
    await t1;
    return { esperou, resultado: await corrida };
  }

  /** Um artigo publicado num mercado em pt e es, com o nome traduzido. */
  async function publicadoComTraducao(l: Loja, sku: string) {
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
    await definirPreco(base.api, l.c, QUEM, l.lista, v.id, { montante: 990 });
    const r = await publicar(base.api, l.c, QUEM, {
      artigo_id: artigo,
      canal_id: l.canal,
      mercado_id: l.mercado,
    });
    expect(r.publicada).toBe(true);
    return artigo;
  }

  async function versaoDoMercado(l: Loja) {
    const { rows } = await sql<{ versao: number }>`
      select versao from mercado where id = ${l.mercado}`.execute(base.dono);
    return rows[0]?.versao ?? 0;
  }

  /**
   * Parte a publicação sem a reverificar (SQL do dono, como uma regra nova
   * que ainda não reverificou): classifica o artigo em álcool e tabaco.
   */
  async function partirAsEscondidas(l: Loja, artigo: string) {
    await base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${l.c}, true)`.execute(
        trx,
      );
      await sql`select set_config('eurolify.quem', ${QUEM}, true)`.execute(trx);
      await sql`update artigo set familias = '{alcool_tabaco}' where id = ${artigo}`.execute(
        trx,
      );
    });
  }

  it("dois arquivos de variantes ao mesmo tempo: o segundo espera pela publicação tomada pelo primeiro e ela sai de venda", async () => {
    const l = await loja();
    const a = await publicado(l, ["GEL-001", "GEL-002"]);
    const [primeira, segunda] = a.variantes as [string, string];
    // T1 faz o que arquivarVariante faz, até antes do commit; T2 é o código.
    const { esperou } = await cruzar(
      l.c,
      async (trx) => {
        await trx
          .updateTable("variante")
          .set({ estado: "arquivada" })
          .where("id", "=", primeira)
          .execute();
        // Ainda vê a segunda à venda: não tira nada.
        expect(
          await reverificarPublicacoes(trx, l.c, { artigo_id: a.artigo }),
        ).toEqual([]);
      },
      () => arquivarVariante(base.api, l.c, segunda),
    );
    expect(esperou).toBe(true);
    const p = await aPublicacao(l, a.artigo);
    expect(p).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "verificacao_falhou",
    });
    expect(codigos(p.ultima_verificacao)).toEqual(["sem_variantes_a_venda"]);
  }, 30_000);

  it("apagar a tradução e uma língua nova no mercado ao mesmo tempo: a segunda vê a primeira e tira de venda", async () => {
    const l = await loja();
    const gel = await publicado(l);
    await definirTraducao(base.api, l.c, QUEM, {
      tipo: "artigo",
      recursoId: gel.artigo,
      campo: "nome",
      lingua: "es",
      texto: "Gel",
      origem: "pessoa",
      originalVisto: "Gel",
    });
    // T1 apaga a tradução e reverifica (o mercado ainda é só pt: passa).
    const versao = await versaoDoMercado(l);
    const { esperou } = await cruzar(
      l.c,
      async (trx) => {
        await trx
          .deleteFrom("traducao")
          .where("recurso_id", "=", gel.artigo)
          .where("lingua", "=", "es")
          .execute();
        expect(
          await reverificarPublicacoes(trx, l.c, { artigo_id: gel.artigo }),
        ).toEqual([]);
      },
      () =>
        alterarMercado(base.api, l.c, l.mercado, versao, {
          linguas: ["pt", "es"],
        }),
    );
    expect(esperou).toBe(true);
    const p = await aPublicacao(l, gel.artigo);
    expect(p.estado).toBe("arquivado");
    expect(codigos(p.ultima_verificacao)).toEqual(["traducao_em_falta"]);
  }, 30_000);

  it("uma língua nova no mercado e apagar a tradução ao mesmo tempo, pela outra ordem: tira de venda", async () => {
    const l = await loja();
    const gel = await publicado(l);
    await definirTraducao(base.api, l.c, QUEM, {
      tipo: "artigo",
      recursoId: gel.artigo,
      campo: "nome",
      lingua: "es",
      texto: "Gel",
      origem: "pessoa",
      originalVisto: "Gel",
    });
    // T1 acrescenta a língua e reverifica (a tradução ainda existe: passa).
    const { esperou } = await cruzar(
      l.c,
      async (trx) => {
        await trx
          .updateTable("mercado")
          .set({ linguas: ["pt", "es"] })
          .where("id", "=", l.mercado)
          .execute();
        expect(
          await reverificarPublicacoes(trx, l.c, { mercado_id: l.mercado }),
        ).toEqual([]);
      },
      () =>
        apagarTraducao(
          base.api,
          l.c,
          "rui@exemplo.eu",
          gel.artigo,
          "nome",
          "es",
        ),
    );
    expect(esperou).toBe(true);
    const p = await aPublicacao(l, gel.artigo);
    expect(p.estado).toBe("arquivado");
    expect(codigos(p.ultima_verificacao)).toEqual(["traducao_em_falta"]);
  }, 30_000);

  it("publicar enquanto se arquiva a última variante: publicar espera e não publica", async () => {
    const l = await loja();
    const a = await publicado(l);
    const [variante] = a.variantes as [string];
    await retirarPublicacao(
      base.api,
      l.c,
      QUEM,
      (await aPublicacao(l, a.artigo)).id,
    );
    // T1 arquiva a variante (como arquivarVariante; nada publicado para
    // reverificar); T2 publica outra vez.
    const { esperou, resultado } = await cruzar(
      l.c,
      async (trx) => {
        await trx
          .updateTable("variante")
          .set({ estado: "arquivada" })
          .where("id", "=", variante)
          .execute();
        expect(
          await reverificarPublicacoes(trx, l.c, { artigo_id: a.artigo }),
        ).toEqual([]);
      },
      () => publicar(base.api, l.c, QUEM, a.pedido),
    );
    expect(esperou).toBe(true);
    expect(resultado.publicada).toBe(false);
    expect(resultado.publicacao?.estado).toBe("arquivado");
    expect(codigos(resultado.verificacao)).toEqual(["sem_variantes_a_venda"]);
  }, 30_000);

  it("publicar outra vez uma publicada com impedimentos deixa-a como estava, à venda com o que tinha", async () => {
    const l = await loja();
    const artigo = await criarArtigo(
      base.api,
      l.c,
      { tipo: "fisico", nome: "Gel", categoria_fiscal: "normal" },
      [
        { sku: "GEL-001", unidade_de_venda: "unidade", peso_g: 30 },
        { sku: "GEL-002", unidade_de_venda: "unidade", peso_g: 30 },
      ],
    );
    const variantes = await comComerciante(base.api, l.c, (trx) =>
      trx
        .selectFrom("variante")
        .select("id")
        .where("artigo_id", "=", artigo)
        .orderBy("sku")
        .execute(),
    );
    const [comPreco, semPreco] = variantes.map((v) => v.id) as [string, string];
    await classificarArtigo(base.api, l.c, artigo, 1, CLASSIFICACAO, QUEM);
    await mudarEstadoArtigo(base.api, l.c, artigo, 2, "activo");
    await definirPreco(base.api, l.c, QUEM, l.lista, comPreco, {
      montante: 990,
    });
    const pedido = {
      artigo_id: artigo,
      canal_id: l.canal,
      mercado_id: l.mercado,
    };
    expect(
      (
        await publicar(base.api, l.c, QUEM, {
          ...pedido,
          variantes_fora: [semPreco],
        })
      ).publicada,
    ).toBe(true);
    // Pôr a segunda à venda sem preço: recusado; fica como estava, e a
    // verificação guardada é a do pedido recusado (docs/14 §4.2).
    const r = await publicar(base.api, l.c, QUEM, {
      ...pedido,
      variantes_fora: [],
    });
    expect(r.publicada).toBe(false);
    expect(r.publicacao).toMatchObject({
      estado: "publicado",
      variantes_fora: [semPreco],
    });
    expect(codigos(r.publicacao?.ultima_verificacao)).toEqual([
      "preco_em_falta",
    ]);
  });

  it("só reverifica quando a mudança conta: a descrição, o nome do mercado e outra tradução não tiram de venda", async () => {
    const l = await loja(["pt", "es"]);
    const gel = await publicadoComTraducao(l, "GEL-001");
    await alterarArtigo(base.api, l.c, gel, await versaoDoArtigo(l, gel), {
      descricao: "Texto",
    });
    await definirTraducao(base.api, l.c, QUEM, {
      tipo: "artigo",
      recursoId: gel,
      campo: "descricao",
      lingua: "es",
      texto: "Texto",
      origem: "pessoa",
      originalVisto: "Texto",
    });
    // Partida às escondidas: só uma reverificação a tiraria de venda.
    await partirAsEscondidas(l, gel);
    await alterarArtigo(base.api, l.c, gel, await versaoDoArtigo(l, gel), {
      descricao: "Outro texto",
    });
    await alterarMercado(base.api, l.c, l.mercado, await versaoDoMercado(l), {
      nome: "Portugal e Espanha",
    });
    // Tirar uma língua não acrescenta nenhuma.
    await alterarMercado(base.api, l.c, l.mercado, await versaoDoMercado(l), {
      linguas: ["pt"],
    });
    await apagarTraducao(
      base.api,
      l.c,
      "rui@exemplo.eu",
      gel,
      "descricao",
      "es",
    );
    expect((await aPublicacao(l, gel)).estado).toBe("publicado");
    // O nome conta: agora sai.
    await alterarArtigo(base.api, l.c, gel, await versaoDoArtigo(l, gel), {
      nome: "Gel de unhas",
    });
    const p = await aPublicacao(l, gel);
    expect(p.estado).toBe("arquivado");
    expect(codigos(p.ultima_verificacao)).toEqual(["familia_restrita"]);
  });

  it("arquivar uma variante que já estava fora não tira a publicação", async () => {
    const l = await loja();
    const a = await publicado(l, ["GEL-001", "GEL-002"]);
    const [, fora] = a.variantes as [string, string];
    expect(
      (
        await publicar(base.api, l.c, QUEM, {
          ...a.pedido,
          variantes_fora: [fora],
        })
      ).publicada,
    ).toBe(true);
    await arquivarVariante(base.api, l.c, fora);
    expect((await aPublicacao(l, a.artigo)).estado).toBe("publicado");
  });

  it("num mercado com dois canais, cada publicação que falha sai e deixa o seu evento; as de outro artigo ficam", async () => {
    const l = await loja();
    const outroCanal = await criarCanal(base.api, l.c, {
      loja_id: l.lojaId,
      nome: "Feira",
    });
    await definirMercadosDoCanal(base.api, l.c, outroCanal, [l.mercado]);
    const gel = await publicado(l, ["GEL-001"]);
    const lima = await publicado(l, ["LIMA-001"]);
    for (const a of [gel, lima]) {
      expect(
        (
          await publicar(base.api, l.c, QUEM, {
            ...a.pedido,
            canal_id: outroCanal,
          })
        ).publicada,
      ).toBe(true);
    }
    await alterarMercado(base.api, l.c, l.mercado, await versaoDoMercado(l), {
      linguas: ["pt", "es"],
    });
    // Nenhum dos dois tem o nome em es: as quatro saem, com quatro eventos.
    const todas = [
      ...(await publicacoesDoArtigo(base.api, l.c, gel.artigo)),
      ...(await publicacoesDoArtigo(base.api, l.c, lima.artigo)),
    ];
    expect(todas.map((p) => p.estado)).toEqual([
      "arquivado",
      "arquivado",
      "arquivado",
      "arquivado",
    ]);
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from evento_saida
      where comerciante_id = ${l.c} and tipo = 'product.unpublished'
        and dados->>'motivo' = 'verificacao_falhou'`.execute(base.dono);
    expect(rows[0]?.n).toBe(4);
  });
});
