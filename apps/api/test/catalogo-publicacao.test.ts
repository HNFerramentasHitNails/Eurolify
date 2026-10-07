import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  alterarArtigo,
  apagarRascunho,
  arquivarVariante,
  classificarArtigo,
  criarArtigo,
  criarVariante,
  ErroCatalogo,
  ESPERA_MAXIMA,
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
// publicar?» (docs/14 §3.9, §4.2 e §5, C2; migração 0019; issue #77), contra
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
    // Com o artigo em rascunho, não se cria a linha (um rascunho apaga-se,
    // e uma publicação não; revisão do #139, P2-5).
    const emRascunho = await publicar(base.api, s.c, QUEM, s.pedido);
    expect(emRascunho.publicacao).toBeNull();
    expect(emRascunho.verificacao.impedimentos[0]).toEqual({
      codigo: "artigo_nao_activo",
    });
    // Activo, em Portugal: a publicação fica em rascunho com a verificação.
    await mudarEstadoArtigo(base.api, s.c, s.artigo, 2, "activo");
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
    await mudarEstadoArtigo(base.api, s.c, s.artigo, 1, "activo");
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
    ).toBe("catalog.not_found");
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

    it("transições, quem até 200, variantes do artigo e o par canal × mercado, por SQL directo", async () => {
      const s = await rascunho();
      expect(
        await mensagem(
          noCatalogo(base.api, s.c, async (trx) => {
            await sql`select set_config('eurolify.quem', ${QUEM}, true)`.execute(
              trx,
            );
            await sql`update publicacao set estado = 'arquivado' where id = ${s.id}`.execute(
              trx,
            );
          }),
        ),
      ).toMatch(/^catalog.invalid_transition: rascunho → arquivado/);
      const versao = (await obterArtigo(base.api, s.c, s.artigo)).versao;
      await mudarEstadoArtigo(base.api, s.c, s.artigo, versao, "activo");
      expect(
        await mensagem(forcar(s.c, s.id, { quem: "x".repeat(201) })),
      ).toMatch(
        /^catalog.published_by_required: quem publica ou retira tem no máximo 200/,
      );
      const outro = await pronto();
      expect(await mensagem(forcar(s.c, s.id, { fora: [outro.v1] }))).toMatch(
        /^catalog.not_found: uma variante de variantes_fora/,
      );
      // Publicada, retirada, o par tirado: republicar por SQL é recusado.
      await forcar(s.c, s.id);
      await retirarPublicacao(base.api, s.c, QUEM, s.id);
      await definirMercadosDoCanal(base.api, s.c, s.canal, []);
      expect(await mensagem(forcar(s.c, s.id))).toMatch(
        /^catalog.publish_blocked: o canal não vende neste mercado/,
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

  describe("achados da 1.ª revisão do #139", () => {
    it("um mercado sai do canal quando as publicações desse par estão retiradas (P2-2, opção a)", async () => {
      const s = await pronto();
      const r = await publicar(base.api, s.c, QUEM, s.pedido);
      expect(
        await codigoDoErro(definirMercadosDoCanal(base.api, s.c, s.canal, [])),
      ).toBe("prices.channel_market_in_use");
      await retirarPublicacao(base.api, s.c, QUEM, publicacaoDe(r).id);
      await definirMercadosDoCanal(base.api, s.c, s.canal, []);
      // A publicação retirada fica, como registo.
      expect(
        (await publicacoesDoArtigo(base.api, s.c, s.artigo)).map(
          (p) => p.estado,
        ),
      ).toEqual(["arquivado"]);
      // E não volta a publicar-se sem o par.
      const outra = await publicar(base.api, s.c, QUEM, s.pedido);
      expect(outra.publicacao).toBeNull();
      expect(outra.verificacao.impedimentos).toContainEqual({
        codigo: "canal_nao_vende_no_mercado",
      });
    });

    it("um rascunho onde se tentou publicar continua a poder apagar-se (P2-5)", async () => {
      const s = await cenario();
      const r = await publicar(base.api, s.c, QUEM, s.pedido);
      expect(r.publicacao).toBeNull();
      await apagarRascunho(base.api, s.c, s.artigo);
      expect(await codigoDoErro(obterArtigo(base.api, s.c, s.artigo))).toBe(
        "catalog.not_found",
      );
    });

    it("depois de publicado, o peso de uma variante à venda e a categoria fiscal não se apagam (P2-6)", async () => {
      const s = await pronto();
      await publicar(base.api, s.c, QUEM, {
        ...s.pedido,
        variantes_fora: [s.v2],
      });
      const semPeso = (id: string) =>
        noCatalogo(base.api, s.c, (trx) =>
          trx
            .updateTable("variante")
            .set({ peso_g: null })
            .where("id", "=", id)
            .execute(),
        );
      expect(await codigoDoErro(semPeso(s.v1))).toBe(
        "catalog.published_in_use",
      );
      // Uma variante fora da publicação pode perdê-lo.
      expect(await codigoDoErro(semPeso(s.v2))).toBe("sem erro");
      const versao = (await obterArtigo(base.api, s.c, s.artigo)).versao;
      expect(
        await codigoDoErro(
          alterarArtigo(base.api, s.c, s.artigo, versao, {
            categoria_fiscal: null,
          }),
        ),
      ).toBe("catalog.published_in_use");
    });

    it("uma variante arquivada já não prende o preço (2.ª revisão, P3-C; o peso de uma arquivada já não muda)", async () => {
      const s = await pronto();
      await publicar(base.api, s.c, QUEM, s.pedido);
      expect(
        await codigoDoErro(tirarPreco(base.api, s.c, QUEM, s.lista, s.v2)),
      ).toBe("prices.published_variant");
      await arquivarVariante(base.api, s.c, s.v2);
      expect(await tirarPreco(base.api, s.c, QUEM, s.lista, s.v2)).toBe(true);
    });

    it("republicar: uma arquivada volta a publicada, limpa o arquivo; com impedimentos fica como estava", async () => {
      const s = await pronto();
      const r = await publicar(base.api, s.c, QUEM, s.pedido);
      await retirarPublicacao(
        base.api,
        s.c,
        "pessoa:outra",
        publicacaoDe(r).id,
      );
      expect(
        await codigoDoErro(
          retirarPublicacao(base.api, s.c, QUEM, publicacaoDe(r).id),
        ),
      ).toBe("catalog.invalid_transition");
      const de_novo = await publicar(
        base.api,
        s.c,
        "pessoa:terceira",
        s.pedido,
      );
      expect(de_novo.publicacao).toMatchObject({
        estado: "publicado",
        publicado_por: "pessoa:terceira",
        arquivado_por: null,
        arquivado_em: null,
        motivo_arquivo: null,
      });
      // Uma classificação restrita tira-a de venda logo (docs/06, CJ; os
      // testes da reverificação estão em catalogo-reverificacao.test.ts).
      // Publicar outra vez com o impedimento não a muda de estado: guarda só
      // a verificação.
      const versao = (await obterArtigo(base.api, s.c, s.artigo)).versao;
      await classificarArtigo(
        base.api,
        s.c,
        s.artigo,
        versao,
        { familias: ["alcool_tabaco"], natureza_consumidor: "bem" },
        QUEM,
      );
      const comImpedimento = await publicar(base.api, s.c, QUEM, s.pedido);
      expect(comImpedimento.publicada).toBe(false);
      expect(comImpedimento.publicacao).toMatchObject({
        estado: "arquivado",
        motivo_arquivo: "verificacao_falhou",
      });
      expect(comImpedimento.publicacao?.ultima_verificacao).toEqual(
        comImpedimento.verificacao,
      );
    });

    it("uma variante nova só entra «fora» nas publicações publicadas, e só do seu artigo", async () => {
      const s = await pronto();
      // Publicada em Portugal; arquivada em França; em rascunho em Espanha.
      const outroMercado = async (nome: string, pais: string) => {
        const m = await criarMercado(base.api, s.c, {
          loja_id: s.loja,
          nome,
          paises: [pais],
          moeda: "EUR",
          linguas: ["pt"],
          lingua_principal: "pt",
        });
        const l = await criarLista(base.api, s.c, {
          mercado_id: m,
          nome: "Base",
          tipo: "base",
        });
        await mudarEstadoMercado(base.api, s.c, m, 1, "activo");
        return { m, l };
      };
      const fr = await outroMercado("França", "FR");
      const es = await outroMercado("Espanha", "ES");
      await definirMercadosDoCanal(base.api, s.c, s.canal, [
        s.mercado,
        fr.m,
        es.m,
      ]);
      for (const lista of [fr.l]) {
        await definirPreco(base.api, s.c, QUEM, lista, s.v1, { montante: 990 });
        await definirPreco(base.api, s.c, QUEM, lista, s.v2, { montante: 990 });
      }
      await publicar(base.api, s.c, QUEM, s.pedido);
      const rf = await publicar(base.api, s.c, QUEM, {
        ...s.pedido,
        mercado_id: fr.m,
      });
      expect(rf.publicada).toBe(true);
      await retirarPublicacao(base.api, s.c, QUEM, publicacaoDe(rf).id);
      const re = await publicar(base.api, s.c, QUEM, {
        ...s.pedido,
        mercado_id: es.m,
      });
      expect(re.publicacao?.estado).toBe("rascunho");
      // Outro comerciante cria uma variante: nada muda aqui.
      const b = await pronto();
      await criarVariante(base.api, b.c, b.artigo, {
        sku: "B-NOVA",
        unidade_de_venda: "unidade",
      });
      const nova = await criarVariante(base.api, s.c, s.artigo, {
        sku: "GEL-NOVA",
        unidade_de_venda: "unidade",
      });
      const porMercado = new Map(
        (await publicacoesDoArtigo(base.api, s.c, s.artigo)).map((p) => [
          p.mercado_id,
          p,
        ]),
      );
      expect(porMercado.get(s.mercado)?.variantes_fora).toEqual([nova]);
      expect(porMercado.get(fr.m)?.variantes_fora).toEqual([]);
      expect(porMercado.get(es.m)?.variantes_fora).toEqual([]);
    });

    it("variantes fora mal escritas são campo inválido; um serviço sem data nem local não se publica", async () => {
      const s = await pronto();
      expect(
        await codigoDoErro(
          publicar(base.api, s.c, QUEM, { ...s.pedido, variantes_fora: ["x"] }),
        ),
      ).toBe("catalog.invalid_field");
      const servico = await criarArtigo(
        base.api,
        s.c,
        { tipo: "servico", nome: "Formação", categoria_fiscal: "normal" },
        [{ sku: "FORM-1", unidade_de_venda: "unidade" }],
      );
      await classificarArtigo(
        base.api,
        s.c,
        servico,
        1,
        {
          familias: ["retalho_geral"],
          natureza_consumidor: "servico_presencial",
          modo: "presencial",
        },
        QUEM,
      );
      const v = await verificarPublicacao(base.api, s.c, {
        ...s.pedido,
        artigo_id: servico,
      });
      expect(v.impedimentos.map((i) => i.codigo)).toContain(
        "data_ou_local_em_falta",
      );
    });

    it("a API não escreve quem publicou nem muda o par de uma publicação (GRANT por coluna)", async () => {
      const s = await pronto();
      const r = await publicar(base.api, s.c, QUEM, s.pedido);
      const id = publicacaoDe(r).id;
      for (const coluna of ["publicado_por", "artigo_id", "motivo_arquivo"]) {
        expect(
          await codigoDoErro(
            comComerciante(base.api, s.c, (trx) =>
              sql`update publicacao set ${sql.ref(coluna)} = ${coluna === "artigo_id" ? s.artigo : "x"} where id = ${id}`.execute(
                trx,
              ),
            ),
          ),
        ).toMatch(/^pg:42501/);
      }
    });
  });

  describe("em concorrência", () => {
    // Cada caso abre uma transacção do eurolify_api (A), faz nela a primeira
    // escrita, e corre a operação do repositório (B). Confirma-se que B está
    // à espera de A (pg_blocking_pids), e A acaba sempre: commit no caso
    // normal, rollback se alguma coisa falhar antes (2.ª revisão, P3-D).
    const abertas: pg.Client[] = [];
    afterAll(async () => {
      await Promise.all(abertas.map((l) => l.end()));
    });

    async function aberta(c: string): Promise<{ l: pg.Client; pid: number }> {
      const l = new pg.Client({ connectionString: base.urlApi });
      await l.connect();
      abertas.push(l);
      const { rows } = await l.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await l.query("begin");
      await l.query(
        "select set_config('eurolify.comerciante', $1, true), set_config('eurolify.quem', $2, true)",
        [c, QUEM],
      );
      return { l, pid: rows[0]?.pid ?? -1 };
    }

    /** Espera até alguma ligação estar bloqueada pela de `pid`. */
    async function bloqueadaPor(pid: number): Promise<void> {
      // Até 10 s, o dobro do lock_timeout: uma operação que desiste antes de
      // ser vista à espera não passa por «não esperou» (3.ª revisão, P3-3).
      for (let i = 0; i < 200; i++) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity
          where ${pid}::int = any (pg_blocking_pids(pid))`.execute(base.dono);
        if ((rows[0]?.n ?? 0) > 0) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("a operação não esperou pela transacção aberta");
    }

    /** Uma promessa que nunca é recusada: dá o valor ou o erro. */
    function assente<T>(p: Promise<T>): Promise<T | Error> {
      return p.then(
        (r) => r,
        (erro: unknown) =>
          erro instanceof Error ? erro : new Error(String(erro)),
      );
    }

    /**
     * Abre A, faz `primeiro` nela, corre `depois` (B), confirma que B espera
     * por A, confirma A e devolve o que B deu.
     */
    async function corrida<T>(
      c: string,
      primeiro: (l: pg.Client) => Promise<unknown>,
      depois: () => Promise<T>,
    ): Promise<T | Error> {
      const { l, pid } = await aberta(c);
      let acabou = false;
      try {
        await primeiro(l);
        const b = assente(depois());
        await bloqueadaPor(pid);
        await l.query("commit");
        acabou = true;
        return await b;
      } finally {
        if (!acabou) await l.query("rollback");
      }
    }

    function resultadoDe(r: unknown): ResultadoDaPublicacao {
      if (r instanceof Error) throw r;
      return r as ResultadoDaPublicacao;
    }

    it("tirar o preço enquanto se publica: a publicação espera e diz que falta o preço", async () => {
      const s = await pronto();
      const r = resultadoDe(
        await corrida(
          s.c,
          (l) =>
            l.query(
              "delete from preco where lista_id = $1 and variante_id = $2",
              [s.lista, s.v1],
            ),
          () => publicar(base.api, s.c, QUEM, s.pedido),
        ),
      );
      expect(r.publicada).toBe(false);
      expect(r.verificacao.impedimentos).toEqual([
        { codigo: "preco_em_falta", variantes: ["GEL-001"] },
      ]);
    });

    it("apagar o peso enquanto se publica: a publicação espera e diz que falta o peso (2.ª revisão, P2-A)", async () => {
      const s = await pronto();
      const r = resultadoDe(
        await corrida(
          s.c,
          (l) =>
            l.query("update variante set peso_g = null where id = $1", [s.v1]),
          () => publicar(base.api, s.c, QUEM, s.pedido),
        ),
      );
      expect(r.publicada).toBe(false);
      expect(r.verificacao.impedimentos).toEqual([
        { codigo: "peso_em_falta", variantes: ["GEL-001"] },
      ]);
    });

    it("publicar e depois apagar o peso: quem apaga espera e é recusado (2.ª revisão, P2-A)", async () => {
      const s = await pronto();
      // A publica (por SQL, com a verificação feita antes) e fica aberta; B
      // tenta apagar o peso.
      const verificacao = JSON.stringify(
        await verificarPublicacao(base.api, s.c, s.pedido),
      );
      const preparada = await publicar(base.api, s.c, QUEM, {
        ...s.pedido,
        variantes_fora: [s.v1, s.v2],
      });
      expect(preparada.publicada).toBe(false);
      expect(preparada.publicacao?.estado).toBe("rascunho");
      const r = await corrida(
        s.c,
        async (l) => {
          await l.query(
            `insert into publicacao (comerciante_id, artigo_id, loja_id, canal_id, mercado_id)
             values ($1, $2, $3, $4, $5) on conflict do nothing`,
            [s.c, s.artigo, s.loja, s.canal, s.mercado],
          );
          await l.query(
            `update publicacao set estado = 'publicado', variantes_fora = '{}',
               ultima_verificacao = $1::jsonb
             where artigo_id = $2 and canal_id = $3 and mercado_id = $4`,
            [verificacao, s.artigo, s.canal, s.mercado],
          );
        },
        () =>
          noCatalogo(base.api, s.c, (trx) =>
            trx
              .updateTable("variante")
              .set({ peso_g: null })
              .where("id", "=", s.v1)
              .execute(),
          ),
      );
      expect(r).toBeInstanceOf(ErroCatalogo);
      expect((r as ErroCatalogo).codigo).toBe("catalog.published_in_use");
    });

    it("mudar o artigo enquanto se publica: a publicação espera e verifica o artigo novo", async () => {
      const s = await pronto();
      const r = resultadoDe(
        await corrida(
          s.c,
          (l) =>
            l.query("update artigo set categoria_fiscal = null where id = $1", [
              s.artigo,
            ]),
          () => publicar(base.api, s.c, QUEM, s.pedido),
        ),
      );
      expect(r.publicada).toBe(false);
      expect(r.verificacao.impedimentos).toEqual([
        { codigo: "categoria_fiscal_em_falta" },
      ]);
    });

    it("tirar o mercado do canal enquanto se publica: a publicação espera e vê o par tirado", async () => {
      const s = await pronto();
      const r = resultadoDe(
        await corrida(
          s.c,
          (l) =>
            l.query("delete from canal_mercado where canal_id = $1", [s.canal]),
          () => publicar(base.api, s.c, QUEM, s.pedido),
        ),
      );
      expect(r.publicacao).toBeNull();
      expect(r.verificacao.impedimentos).toContainEqual({
        codigo: "canal_nao_vende_no_mercado",
      });
    });

    it("criar uma variante enquanto se publica: a publicação espera e verifica-a", async () => {
      const s = await pronto();
      // A linha da publicação já existe (rascunho): a variante nova toma-a.
      await publicar(base.api, s.c, QUEM, {
        ...s.pedido,
        variantes_fora: [s.v1, s.v2],
      });
      const r = resultadoDe(
        await corrida(
          s.c,
          (l) =>
            l.query(
              `insert into variante (comerciante_id, artigo_id, sku, unidade_de_venda)
               values ($1, $2, 'GEL-003', 'unidade')`,
              [s.c, s.artigo],
            ),
          () => publicar(base.api, s.c, QUEM, s.pedido),
        ),
      );
      expect(r.publicada).toBe(false);
      expect(r.verificacao.impedimentos).toEqual([
        { codigo: "peso_em_falta", variantes: ["GEL-003"] },
        { codigo: "preco_em_falta", variantes: ["GEL-003"] },
      ]);
    });

    it("criar uma variante enquanto se publica pela primeira vez (sem linha): a publicação espera e verifica-a (3.ª revisão, P2-1)", async () => {
      const s = await pronto();
      expect(await publicacoesDoArtigo(base.api, s.c, s.artigo)).toEqual([]);
      const r = resultadoDe(
        await corrida(
          s.c,
          (l) =>
            l.query(
              `insert into variante (comerciante_id, artigo_id, sku, unidade_de_venda)
               values ($1, $2, 'GEL-003', 'unidade')`,
              [s.c, s.artigo],
            ),
          () => publicar(base.api, s.c, QUEM, s.pedido),
        ),
      );
      expect(r.publicada).toBe(false);
      expect(r.verificacao.impedimentos).toEqual([
        { codigo: "peso_em_falta", variantes: ["GEL-003"] },
        { codigo: "preco_em_falta", variantes: ["GEL-003"] },
      ]);
    });

    it("publicar pela primeira vez e criar uma variante a seguir: a variante espera e nasce fora (3.ª revisão, P2-1)", async () => {
      const s = await pronto();
      // A publica por SQL (a verificação feita antes) e fica aberta; B cria
      // uma variante, que tem de esperar e entrar fora.
      const verificacao = JSON.stringify(
        await verificarPublicacao(base.api, s.c, s.pedido),
      );
      const r = await corrida(
        s.c,
        async (l) => {
          await l.query("select catalogo_fila_do_artigo($1, $2)", [
            s.c,
            s.artigo,
          ]);
          await l.query(
            `insert into publicacao (comerciante_id, artigo_id, loja_id, canal_id, mercado_id)
             values ($1, $2, $3, $4, $5)`,
            [s.c, s.artigo, s.loja, s.canal, s.mercado],
          );
          await l.query(
            `update publicacao set estado = 'publicado', ultima_verificacao = $1::jsonb
             where artigo_id = $2 and canal_id = $3 and mercado_id = $4`,
            [verificacao, s.artigo, s.canal, s.mercado],
          );
        },
        () =>
          criarVariante(base.api, s.c, s.artigo, {
            sku: "GEL-003",
            unidade_de_venda: "unidade",
          }),
      );
      expect(typeof r).toBe("string");
      const publicada = (await publicacoesDoArtigo(base.api, s.c, s.artigo))[0];
      expect(publicada?.estado).toBe("publicado");
      expect(publicada?.variantes_fora).toEqual([r]);
    });

    it("arquivar o artigo enquanto se publica: a publicação espera e vê o artigo arquivado", async () => {
      const s = await pronto();
      const r = resultadoDe(
        await corrida(
          s.c,
          (l) =>
            l.query("update artigo set estado = 'arquivado' where id = $1", [
              s.artigo,
            ]),
          () => publicar(base.api, s.c, QUEM, s.pedido),
        ),
      );
      expect(r.publicada).toBe(false);
      expect(r.verificacao.impedimentos).toEqual([
        { codigo: "artigo_nao_activo" },
      ]);
    });

    it("duas publicações do mesmo artigo ao mesmo tempo, em mercados diferentes: as duas saem", async () => {
      const s = await pronto();
      const fr = await criarMercado(base.api, s.c, {
        loja_id: s.loja,
        nome: "França",
        paises: ["FR"],
        moeda: "EUR",
        linguas: ["pt"],
        lingua_principal: "pt",
      });
      const listaFr = await criarLista(base.api, s.c, {
        mercado_id: fr,
        nome: "Base FR",
        tipo: "base",
      });
      await mudarEstadoMercado(base.api, s.c, fr, 1, "activo");
      await definirMercadosDoCanal(base.api, s.c, s.canal, [s.mercado, fr]);
      await definirPreco(base.api, s.c, QUEM, listaFr, s.v1, { montante: 990 });
      await definirPreco(base.api, s.c, QUEM, listaFr, s.v2, { montante: 990 });
      const [a, b] = await Promise.all([
        publicar(base.api, s.c, QUEM, s.pedido),
        publicar(base.api, s.c, QUEM, { ...s.pedido, mercado_id: fr }),
      ]);
      expect([a.publicada, b.publicada]).toEqual([true, true]);
    });

    it(`quem espera mais de ${ESPERA_MAXIMA} por um lock recebe catalog.retry`, async () => {
      const s = await pronto();
      const { l } = await aberta(s.c);
      await l.query("update artigo set nome = 'Gel (a mudar)' where id = $1", [
        s.artigo,
      ]);
      try {
        expect(
          await codigoDoErro(publicar(base.api, s.c, QUEM, s.pedido)),
        ).toBe("catalog.retry");
      } finally {
        await l.query("rollback");
      }
    }, 20_000);
  });
});
