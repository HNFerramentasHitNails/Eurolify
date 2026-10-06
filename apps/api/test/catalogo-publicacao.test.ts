import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  alterarArtigo,
  classificarArtigo,
  criarArtigo,
  criarVariante,
  ErroCatalogo,
  mudarEstadoArtigo,
  noCatalogo,
  obterArtigo,
} from "../src/catalogo/repositorio.js";
import {
  publicacoesDoArtigo,
  publicar,
  retirarPublicacao,
  verificarPublicacao,
  type PedidoDePublicacao,
  type Publicacao,
  type ResultadoDaPublicacao,
} from "../src/catalogo/publicacao.js";
import { definirTraducao } from "../src/catalogo/traducoes.js";
import {
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  definirPreco,
  ErroPrecos,
  mudarEstadoCanal,
  mudarEstadoMercado,
  tirarPreco,
} from "../src/precos/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Catálogo, parte 4: publicação por canal × mercado e a verificação «pode
// publicar?» (docs/14 §3.9, §4.2 e §5, C2; migração 0018; issue #77), contra
// o PostgreSQL 18 verdadeiro e com o eurolify_api.

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

function publicacaoDe(r: ResultadoDaPublicacao): Publicacao {
  if (r.publicacao === null) throw new Error("sem publicação");
  return r.publicacao;
}

async function codigoDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroCatalogo) return erro.codigo;
    if (erro instanceof ErroPrecos) return erro.codigo;
    const pgErro = erro as { code?: unknown; message?: unknown };
    return `pg:${String(pgErro.code)}:${String(pgErro.message)}`;
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)("publicação na base", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  /**
   * Um comerciante (português) com uma loja, o mercado Portugal activo com a
   * lista de base, um canal que vende nele, e um artigo físico «Gel» com
   * duas variantes ainda em rascunho, sem preços.
   */
  async function cenario() {
    const c = await registarComerciante(base.api, NOVO);
    const entidade = await criarEntidadeLegal(base.api, c, ENTIDADE);
    const loja = await criarLoja(base.api, c, {
      entidade_legal_id: entidade,
      nome: "Loja online",
    });
    const mercado = await criarMercado(base.api, c, {
      loja_id: loja,
      nome: "Portugal",
      paises: ["PT"],
      moeda: "EUR",
      linguas: ["pt"],
      lingua_principal: "pt",
    });
    const lista = await criarLista(base.api, c, {
      mercado_id: mercado,
      nome: "Base PT",
      tipo: "base",
    });
    await mudarEstadoMercado(base.api, c, mercado, 1, "activo");
    const canal = await criarCanal(base.api, c, {
      loja_id: loja,
      nome: "Loja online",
    });
    await definirMercadosDoCanal(base.api, c, canal, [mercado]);
    const artigo = await criarArtigo(
      base.api,
      c,
      { tipo: "fisico", nome: "Gel", categoria_fiscal: "normal" },
      [
        { sku: "GEL-001", unidade_de_venda: "unidade", peso_g: 30 },
        { sku: "GEL-002", unidade_de_venda: "unidade", peso_g: 30 },
      ],
    );
    const variantes = await comComerciante(base.api, c, (trx) =>
      trx
        .selectFrom("variante")
        .select("id")
        .where("artigo_id", "=", artigo)
        .orderBy("sku")
        .execute(),
    );
    const [v1, v2] = variantes.map((v) => v.id);
    if (v1 === undefined || v2 === undefined) {
      throw new Error("faltam variantes");
    }
    const pedido: PedidoDePublicacao = {
      artigo_id: artigo,
      canal_id: canal,
      mercado_id: mercado,
    };
    return { c, entidade, loja, mercado, lista, canal, artigo, v1, v2, pedido };
  }

  /** O cenário com o artigo classificado, activo e com preço nas duas. */
  async function pronto() {
    const s = await cenario();
    await classificarArtigo(
      base.api,
      s.c,
      s.artigo,
      1,
      { familias: ["retalho_geral"], natureza_consumidor: "bem" },
      QUEM,
    );
    await mudarEstadoArtigo(base.api, s.c, s.artigo, 2, "activo");
    await definirPreco(base.api, s.c, QUEM, s.lista, s.v1, { montante: 990 });
    await definirPreco(base.api, s.c, QUEM, s.lista, s.v2, { montante: 1090 });
    return s;
  }

  it("um artigo pronto publica-se; a resposta diz o que não foi verificado", async () => {
    const s = await pronto();
    expect(await verificarPublicacao(base.api, s.c, s.pedido)).toEqual({
      impedimentos: [],
      nao_verificado: ["conformidade", "media"],
    });
    const r = await publicar(base.api, s.c, QUEM, s.pedido);
    expect(r.publicada).toBe(true);
    expect(r.publicacao).toMatchObject({
      estado: "publicado",
      publicado_por: QUEM,
      variantes_fora: [],
      ultima_verificacao: {
        impedimentos: [],
        nao_verificado: ["conformidade", "media"],
      },
    });
    expect(r.publicacao?.publicado_em).toBeInstanceOf(Date);
  });

  it("um rascunho sem nada mostra todos os impedimentos e fica em rascunho, com a verificação guardada", async () => {
    const s = await cenario();
    // Um segundo mercado onde o canal não vende, ainda em rascunho.
    const espanha = await criarMercado(base.api, s.c, {
      loja_id: s.loja,
      nome: "Espanha",
      paises: ["ES"],
      moeda: "EUR",
      linguas: ["es"],
      lingua_principal: "es",
    });
    await alterarArtigo(base.api, s.c, s.artigo, 1, { categoria_fiscal: null });
    const r = await publicar(base.api, s.c, QUEM, {
      ...s.pedido,
      mercado_id: espanha,
    });
    expect(r.publicada).toBe(false);
    expect(r.verificacao.impedimentos.map((i) => i.codigo)).toEqual([
      "artigo_nao_activo",
      "mercado_inactivo",
      "canal_nao_vende_no_mercado",
      "categoria_fiscal_em_falta",
      "classificacao_em_falta",
      "traducao_em_falta",
    ]);
    // O canal não vende em Espanha: não há onde a publicação exista.
    expect(r.publicacao).toBeNull();
    // Em Portugal, a publicação fica em rascunho com a verificação guardada.
    const pt = await publicar(base.api, s.c, QUEM, s.pedido);
    expect(pt.publicada).toBe(false);
    expect(pt.publicacao?.estado).toBe("rascunho");
    expect(pt.publicacao?.ultima_verificacao).toEqual(pt.verificacao);
  });

  it("sem preço, sem peso ou com todas as variantes fora, não se publica; uma variante fora não precisa de preço", async () => {
    const s = await cenario();
    await classificarArtigo(
      base.api,
      s.c,
      s.artigo,
      1,
      { familias: ["retalho_geral"], natureza_consumidor: "bem" },
      QUEM,
    );
    await mudarEstadoArtigo(base.api, s.c, s.artigo, 2, "activo");
    await definirPreco(base.api, s.c, QUEM, s.lista, s.v1, { montante: 990 });
    const semPreco = await verificarPublicacao(base.api, s.c, s.pedido);
    expect(semPreco.impedimentos).toEqual([
      { codigo: "preco_em_falta", variantes: ["GEL-002"] },
    ]);
    const tudoFora = await verificarPublicacao(base.api, s.c, {
      ...s.pedido,
      variantes_fora: [s.v1, s.v2],
    });
    expect(tudoFora.impedimentos).toEqual([
      { codigo: "sem_variantes_a_venda" },
    ]);
    // Uma variante sem peso entra sem preço: dois impedimentos.
    const v3 = await criarVariante(base.api, s.c, s.artigo, {
      sku: "GEL-003",
      unidade_de_venda: "unidade",
    });
    const r = await publicar(base.api, s.c, QUEM, {
      ...s.pedido,
      variantes_fora: [s.v2],
    });
    expect(r.verificacao.impedimentos).toEqual([
      { codigo: "peso_em_falta", variantes: ["GEL-003"] },
      { codigo: "preco_em_falta", variantes: ["GEL-003"] },
    ]);
    const so1 = await publicar(base.api, s.c, QUEM, {
      ...s.pedido,
      variantes_fora: [s.v2, v3],
    });
    expect(so1.publicada).toBe(true);
    expect(so1.publicacao?.variantes_fora.sort()).toEqual([s.v2, v3].sort());
  });

  it("num mercado com outra língua, o nome tem de estar traduzido e em dia", async () => {
    const s = await pronto();
    const espanha = await criarMercado(base.api, s.c, {
      loja_id: s.loja,
      nome: "Espanha",
      paises: ["ES"],
      moeda: "EUR",
      linguas: ["es", "pt"],
      lingua_principal: "es",
    });
    const listaEs = await criarLista(base.api, s.c, {
      mercado_id: espanha,
      nome: "Base ES",
      tipo: "base",
    });
    await mudarEstadoMercado(base.api, s.c, espanha, 1, "activo");
    await definirMercadosDoCanal(base.api, s.c, s.canal, [s.mercado, espanha]);
    await definirPreco(base.api, s.c, QUEM, listaEs, s.v1, { montante: 990 });
    await definirPreco(base.api, s.c, QUEM, listaEs, s.v2, { montante: 990 });
    const pedido = { ...s.pedido, mercado_id: espanha };
    expect(
      (await verificarPublicacao(base.api, s.c, pedido)).impedimentos,
    ).toEqual([
      { codigo: "traducao_em_falta", campo: "nome", linguas: ["es"] },
    ]);
    await definirTraducao(base.api, s.c, QUEM, {
      tipo: "artigo",
      recursoId: s.artigo,
      campo: "nome",
      lingua: "es",
      texto: "Gel",
      origem: "pessoa",
      originalVisto: "Gel",
    });
    expect(
      (await verificarPublicacao(base.api, s.c, pedido)).impedimentos,
    ).toEqual([]);
    const versao = (await obterArtigo(base.api, s.c, s.artigo)).versao;
    await alterarArtigo(base.api, s.c, s.artigo, versao, {
      nome: "Gel de construção",
    });
    expect(
      (await verificarPublicacao(base.api, s.c, pedido)).impedimentos,
    ).toEqual([
      { codigo: "traducao_desactualizada", campo: "nome", linguas: ["es"] },
    ]);
  });

  it("uma família restrita não se publica", async () => {
    const s = await cenario();
    await classificarArtigo(
      base.api,
      s.c,
      s.artigo,
      1,
      { familias: ["alcool_tabaco"], natureza_consumidor: "bem" },
      QUEM,
    );
    const v = await verificarPublicacao(base.api, s.c, s.pedido);
    expect(v.impedimentos).toContainEqual({
      codigo: "familia_restrita",
      familias: ["alcool_tabaco"],
    });
  });

  it("a base não aceita «publicado» sem verificação limpa, nem sem preço, mesmo por SQL da API", async () => {
    const s = await cenario();
    await classificarArtigo(
      base.api,
      s.c,
      s.artigo,
      1,
      { familias: ["retalho_geral"], natureza_consumidor: "bem" },
      QUEM,
    );
    await mudarEstadoArtigo(base.api, s.c, s.artigo, 2, "activo");
    const r = await publicar(base.api, s.c, QUEM, s.pedido);
    expect(r.publicada).toBe(false);
    const directo = (verificacao: string) =>
      noCatalogo(base.api, s.c, async (trx) => {
        await sql`select set_config('eurolify.quem', ${QUEM}, true)`.execute(
          trx,
        );
        await sql`update publicacao set estado = 'publicado',
            ultima_verificacao = ${verificacao}::jsonb
            where id = ${publicacaoDe(r).id}`.execute(trx);
      });
    expect(
      await codigoDoErro(directo('{"impedimentos": [{"codigo": "x"}]}')),
    ).toBe("catalog.publish_blocked");
    expect(await codigoDoErro(directo("{}"))).toBe("catalog.publish_blocked");
    // Uma verificação forjada sem impedimentos: a base vê que falta o preço.
    const forjada = await directo('{"impedimentos": []}').catch(
      (e: unknown) => e,
    );
    expect(forjada).toBeInstanceOf(ErroCatalogo);
    expect((forjada as ErroCatalogo).codigo).toBe("catalog.publish_blocked");
    expect((forjada as ErroCatalogo).message).toMatch(
      /sem preço na lista de base do mercado: GEL-001, GEL-002/,
    );
  });

  it("o preço de uma variante publicada não sai da lista de base; depois de retirar, sai", async () => {
    const s = await pronto();
    const r = await publicar(base.api, s.c, QUEM, s.pedido);
    expect(
      await codigoDoErro(tirarPreco(base.api, s.c, QUEM, s.lista, s.v1)),
    ).toBe("prices.published_variant");
    const retirada = await retirarPublicacao(
      base.api,
      s.c,
      "pessoa:outra",
      publicacaoDe(r).id,
    );
    expect(retirada).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "retirada",
      arquivado_por: "pessoa:outra",
    });
    expect(await tirarPreco(base.api, s.c, QUEM, s.lista, s.v1)).toBe(true);
    // Volta a publicar-se com nova verificação, que agora falha.
    const outra = await publicar(base.api, s.c, QUEM, s.pedido);
    expect(outra.publicada).toBe(false);
    expect(outra.publicacao?.estado).toBe("arquivado");
  });

  it("arquivar o artigo, o mercado ou o canal arquiva as publicações, com o motivo", async () => {
    const a = await pronto();
    await publicar(base.api, a.c, QUEM, a.pedido);
    const versao = (await obterArtigo(base.api, a.c, a.artigo)).versao;
    await mudarEstadoArtigo(base.api, a.c, a.artigo, versao, "arquivado");
    expect(
      (await publicacoesDoArtigo(base.api, a.c, a.artigo))[0],
    ).toMatchObject({
      estado: "arquivado",
      motivo_arquivo: "artigo_arquivado",
      arquivado_por: "catalogo:artigo_arquivado",
    });

    const m = await pronto();
    await publicar(base.api, m.c, QUEM, m.pedido);
    await mudarEstadoMercado(base.api, m.c, m.mercado, 2, "arquivado");
    expect(
      (await publicacoesDoArtigo(base.api, m.c, m.artigo))[0]?.motivo_arquivo,
    ).toBe("mercado_arquivado");

    const k = await pronto();
    await publicar(base.api, k.c, QUEM, k.pedido);
    await mudarEstadoCanal(base.api, k.c, k.canal, 1, "arquivado");
    expect(
      (await publicacoesDoArtigo(base.api, k.c, k.artigo))[0]?.motivo_arquivo,
    ).toBe("canal_arquivado");
    expect(
      (await verificarPublicacao(base.api, k.c, k.pedido)).impedimentos,
    ).toEqual([{ codigo: "canal_inactivo" }]);
  });

  it("um mercado com publicações não sai do canal; os outros pares não mudam", async () => {
    const s = await pronto();
    await publicar(base.api, s.c, QUEM, s.pedido);
    expect(
      await codigoDoErro(definirMercadosDoCanal(base.api, s.c, s.canal, [])),
    ).toBe("prices.channel_market_in_use");
    // A mesma lista não muda nada (e não esbarra na publicação).
    await definirMercadosDoCanal(base.api, s.c, s.canal, [s.mercado]);
  });

  it("uma variante nova de um artigo publicado nasce fora da publicação", async () => {
    const s = await pronto();
    const r = await publicar(base.api, s.c, QUEM, s.pedido);
    const nova = await criarVariante(base.api, s.c, s.artigo, {
      sku: "GEL-NOVA",
      unidade_de_venda: "unidade",
    });
    const depois = (await publicacoesDoArtigo(base.api, s.c, s.artigo))[0];
    expect(depois?.estado).toBe("publicado");
    expect(depois?.variantes_fora).toEqual([nova]);
    expect(depois?.versao).toBe(publicacaoDe(r).versao + 1);
    // Pô-la à venda sem preço é recusado pela verificação.
    const dentro = await publicar(base.api, s.c, QUEM, s.pedido);
    expect(dentro.verificacao.impedimentos.map((i) => i.codigo)).toEqual([
      "peso_em_falta",
      "preco_em_falta",
    ]);
  });

  it("transições: uma publicação não se apaga, e um rascunho não se arquiva", async () => {
    const s = await cenario();
    const r = await publicar(base.api, s.c, QUEM, s.pedido);
    expect(
      await codigoDoErro(
        retirarPublicacao(base.api, s.c, QUEM, publicacaoDe(r).id),
      ),
    ).toBe("catalog.invalid_transition");
    expect(
      await codigoDoErro(
        comComerciante(base.api, s.c, (trx) =>
          sql`delete from publicacao where id = ${publicacaoDe(r).id}`.execute(
            trx,
          ),
        ),
      ),
    ).toMatch(/^pg:42501/);
    expect(
      await codigoDoErro(
        retirarPublicacao(base.api, s.c, " ", publicacaoDe(r).id),
      ),
    ).toBe("catalog.published_by_required");
  });

  it("um comerciante não vê nem publica no catálogo, canal ou mercado de outro", async () => {
    const a = await pronto();
    const b = await pronto();
    await publicar(base.api, a.c, QUEM, a.pedido);
    expect(await publicacoesDoArtigo(base.api, b.c, a.artigo)).toEqual([]);
    expect(await codigoDoErro(publicar(base.api, b.c, QUEM, a.pedido))).toBe(
      "catalog.not_found",
    );
    expect(
      await codigoDoErro(
        publicar(base.api, b.c, QUEM, { ...b.pedido, mercado_id: a.mercado }),
      ),
    ).toBe("catalog.not_found");
    expect(
      await codigoDoErro(
        verificarPublicacao(base.api, a.c, {
          ...a.pedido,
          variantes_fora: [b.v1],
        }),
      ),
    ).toBe("sem erro");
    expect(
      await codigoDoErro(
        publicar(base.api, a.c, QUEM, { ...a.pedido, variantes_fora: [b.v1] }),
      ),
    ).toBe("catalog.not_found");
  });

  describe("a base recusa sozinha, sem a verificação do servidor", () => {
    const LIMPA = '{"impedimentos": [], "nao_verificado": []}';

    /** Publica por SQL directo da API, com uma verificação forjada limpa. */
    function forcar(
      c: string,
      id: string,
      opcoes: { quem?: string; fora?: string[]; verificacao?: string } = {},
    ) {
      return noCatalogo(base.api, c, async (trx) => {
        if (opcoes.quem !== "") {
          await sql`select set_config('eurolify.quem', ${opcoes.quem ?? QUEM}, true)`.execute(
            trx,
          );
        }
        await sql`update publicacao set estado = 'publicado',
            ultima_verificacao = ${opcoes.verificacao ?? LIMPA}::jsonb,
            variantes_fora = ${opcoes.fora ?? []}::uuid[]
            where id = ${id}`.execute(trx);
      });
    }

    /** Uma publicação em rascunho de um artigo que, de resto, está pronto. */
    async function rascunho() {
      const s = await pronto();
      const versao = (await obterArtigo(base.api, s.c, s.artigo)).versao;
      await mudarEstadoArtigo(base.api, s.c, s.artigo, versao, "arquivado");
      const r = await publicar(base.api, s.c, QUEM, s.pedido);
      return { ...s, id: publicacaoDe(r).id };
    }

    async function mensagem(promessa: Promise<unknown>): Promise<string> {
      const erro = await promessa.then(
        () => undefined,
        (e: unknown) => e,
      );
      return erro instanceof Error ? erro.message : "sem erro";
    }

    it("só com o artigo activo; sem quem, não", async () => {
      const s = await rascunho();
      expect(await mensagem(forcar(s.c, s.id))).toMatch(
        /^catalog.publish_blocked: o artigo não está activo/,
      );
      const versao = (await obterArtigo(base.api, s.c, s.artigo)).versao;
      await mudarEstadoArtigo(base.api, s.c, s.artigo, versao, "activo");
      expect(await mensagem(forcar(s.c, s.id, { quem: "" }))).toMatch(
        /^catalog.published_by_required/,
      );
      expect(
        await mensagem(
          forcar(s.c, s.id, {
            verificacao: '{"impedimentos": [{"codigo": "x"}]}',
          }),
        ),
      ).toMatch(/^catalog.publish_blocked: a última verificação/);
      expect(await mensagem(forcar(s.c, s.id))).toBe("sem erro");
    });

    it("com variantes à venda, com peso, e sem variantes repetidas em «fora»", async () => {
      const s = await rascunho();
      const versao = (await obterArtigo(base.api, s.c, s.artigo)).versao;
      await mudarEstadoArtigo(base.api, s.c, s.artigo, versao, "activo");
      expect(await mensagem(forcar(s.c, s.id, { fora: [s.v1, s.v2] }))).toMatch(
        /^catalog.publish_blocked: nenhuma variante à venda/,
      );
      expect(await mensagem(forcar(s.c, s.id, { fora: [s.v1, s.v1] }))).toMatch(
        /^catalog.invalid_field/,
      );
      await comComerciante(base.api, s.c, (trx) =>
        trx
          .updateTable("variante")
          .set({ peso_g: null })
          .where("id", "=", s.v2)
          .execute(),
      );
      expect(await mensagem(forcar(s.c, s.id))).toMatch(
        /^catalog.publish_blocked: sem peso: GEL-002/,
      );
    });

    it("só num mercado e num canal activos", async () => {
      const m = await pronto();
      const rm = await publicar(base.api, m.c, QUEM, m.pedido);
      await mudarEstadoMercado(base.api, m.c, m.mercado, 2, "arquivado");
      expect(await mensagem(forcar(m.c, publicacaoDe(rm).id))).toMatch(
        /^catalog.publish_blocked: o mercado não está activo/,
      );
      const k = await pronto();
      const rk = await publicar(base.api, k.c, QUEM, k.pedido);
      await mudarEstadoCanal(base.api, k.c, k.canal, 1, "arquivado");
      expect(await mensagem(forcar(k.c, publicacaoDe(rk).id))).toMatch(
        /^catalog.publish_blocked: o canal não está activo/,
      );
    });

    it("uma publicação nasce em rascunho, não muda de par, não se apaga, e retirar pede quem", async () => {
      const s = await rascunho();
      const dono = base.dono;
      const pub = await sql<{ loja_id: string }>`
        select loja_id from publicacao where id = ${s.id}`.execute(dono);
      const loja = pub.rows[0]?.loja_id ?? "";
      expect(
        await mensagem(
          sql`insert into publicacao (comerciante_id, artigo_id, loja_id, canal_id, mercado_id, estado)
              values (${s.c}, ${s.artigo}, ${loja}, ${s.canal}, ${s.mercado}, 'publicado')`.execute(
            dono,
          ),
        ),
      ).toMatch(/catalog.invalid_transition: uma publicação nasce em rascunho/);
      const outro = await criarArtigo(
        base.api,
        s.c,
        { tipo: "fisico", nome: "Outro" },
        [{ sku: "OUTRO-1", unidade_de_venda: "unidade" }],
      );
      expect(
        await mensagem(
          sql`update publicacao set artigo_id = ${outro} where id = ${s.id}`.execute(
            dono,
          ),
        ),
      ).toMatch(/catalog.immutable_identity/);
      expect(
        await mensagem(
          sql`delete from publicacao where id = ${s.id}`.execute(dono),
        ),
      ).toMatch(/catalog.immutable_identity: uma publicação não se apaga/);
      const versao = (await obterArtigo(base.api, s.c, s.artigo)).versao;
      await mudarEstadoArtigo(base.api, s.c, s.artigo, versao, "activo");
      await forcar(s.c, s.id);
      expect(
        await mensagem(
          noCatalogo(base.api, s.c, (trx) =>
            sql`update publicacao set estado = 'arquivado' where id = ${s.id}`.execute(
              trx,
            ),
          ),
        ),
      ).toMatch(/^catalog.published_by_required/);
    });
  });

  describe("em concorrência", () => {
    const abertas: pg.Client[] = [];
    afterAll(async () => {
      await Promise.all(abertas.map((l) => l.end()));
    });

    it("tirar o preço e publicar ao mesmo tempo: a publicação espera e é recusada", async () => {
      const s = await pronto();
      const a = new pg.Client({ connectionString: base.urlApi });
      await a.connect();
      abertas.push(a);
      await a.query("begin");
      await a.query(
        "select set_config('eurolify.comerciante', $1, true), set_config('eurolify.quem', $2, true)",
        [s.c, QUEM],
      );
      await a.query(
        "delete from preco where lista_id = $1 and variante_id = $2",
        [s.lista, s.v1],
      );
      const publicacao = publicar(base.api, s.c, QUEM, s.pedido).then(
        (r) => r,
        (erro: unknown) => erro,
      );
      for (let i = 0; i < 100; i++) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity
          where usename = 'eurolify_api' and datname = current_database()
            and wait_event_type = 'Lock'`.execute(base.dono);
        if ((rows[0]?.n ?? 0) > 0) break;
        if (i === 99) throw new Error("a publicação não esperou");
        await new Promise((r) => setTimeout(r, 50));
      }
      await a.query("commit");
      const resultado = await publicacao;
      expect(resultado).toBeInstanceOf(ErroCatalogo);
      expect((resultado as ErroCatalogo).codigo).toBe(
        "catalog.publish_blocked",
      );
    });
  });
});
