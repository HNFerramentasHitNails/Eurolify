import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apagarRascunho,
  classificarArtigo,
  criarArtigo,
  mudarEstadoArtigo,
  obterArtigo,
} from "../src/catalogo/repositorio.js";
import {
  publicar,
  retirarPublicacao,
  type PedidoDePublicacao,
} from "../src/catalogo/publicacao.js";
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
  mudarEstadoCanal,
  mudarEstadoMercado,
  tirarPreco,
} from "../src/precos/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Eventos de domínio na outbox (docs/18 §5; migração 0021): escritos pelos
// gatilhos na mesma transacção que a mudança, imutáveis, fora do alcance da
// API. Contra o PostgreSQL 18 verdadeiro.

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

interface Evento {
  tipo: string;
  agregado_tipo: string;
  agregado_id: string;
  dados: Record<string, unknown>;
  versao_esquema: number;
  publicado_em: Date | null;
}

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    const pgErro = erro as { code?: unknown; message?: unknown };
    return `${String(pgErro.code)}:${String(pgErro.message)}`;
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)("eventos de domínio na base", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  /** Os eventos de um comerciante, por ordem (lidos pelo dono). */
  async function eventos(c: string): Promise<Evento[]> {
    const { rows } = await sql<Evento>`
      select tipo, agregado_tipo, agregado_id, dados, versao_esquema, publicado_em
      from evento_saida where comerciante_id = ${c}
      order by criado_em, id`.execute(base.dono);
    return rows;
  }

  /** Um artigo pronto a publicar em Portugal, num canal que vende lá. */
  async function pronto() {
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
      [{ sku: "GEL-001", unidade_de_venda: "unidade", peso_g: 30 }],
    );
    const [variante] = await comComerciante(base.api, c, (trx) =>
      trx
        .selectFrom("variante")
        .select("id")
        .where("artigo_id", "=", artigo)
        .execute(),
    );
    if (variante === undefined) throw new Error("falta a variante");
    await classificarArtigo(
      base.api,
      c,
      artigo,
      1,
      { familias: ["retalho_geral"], natureza_consumidor: "bem" },
      QUEM,
    );
    await mudarEstadoArtigo(base.api, c, artigo, 2, "activo");
    await definirPreco(base.api, c, QUEM, lista, variante.id, {
      montante: 990,
    });
    const pedido: PedidoDePublicacao = {
      artigo_id: artigo,
      canal_id: canal,
      mercado_id: mercado,
    };
    return { c, mercado, lista, canal, artigo, variante: variante.id, pedido };
  }

  it("activar o mercado e o primeiro preço deixam market.activated e price.changed", async () => {
    const s = await pronto();
    const lista = await eventos(s.c);
    expect(lista.map((e) => e.tipo)).toEqual([
      "market.activated",
      "price.changed",
    ]);
    expect(lista[0]).toMatchObject({
      agregado_tipo: "mercado",
      agregado_id: s.mercado,
      versao_esquema: 1,
      publicado_em: null,
      dados: { mercado_id: s.mercado },
    });
    expect(lista[1]).toMatchObject({
      agregado_tipo: "variante",
      agregado_id: s.variante,
      dados: {
        lista_id: s.lista,
        variante_id: s.variante,
        montante_antigo: null,
        montante_novo: 990,
        moeda: "EUR",
        saiu: false,
        quem: QUEM,
      },
    });
  });

  it("mudar e tirar o preço: o montante antigo e o novo, e a saída", async () => {
    const s = await pronto();
    await definirPreco(base.api, s.c, QUEM, s.lista, s.variante, {
      montante: 1090,
    });
    // Mudar só as quantidades não é mudança de preço: sem evento.
    await definirPreco(base.api, s.c, QUEM, s.lista, s.variante, {
      montante: 1090,
      multiplo: 2,
    });
    await tirarPreco(base.api, s.c, "pessoa:outra", s.lista, s.variante);
    const precos = (await eventos(s.c)).filter(
      (e) => e.tipo === "price.changed",
    );
    expect(
      precos.map((e) => [
        e.dados["montante_antigo"],
        e.dados["montante_novo"],
        e.dados["saiu"],
      ]),
    ).toEqual([
      [null, 990, false],
      [990, 1090, false],
      [1090, null, true],
    ]);
    expect(precos[2]?.dados["quem"]).toBe("pessoa:outra");
  });

  it("publicar, retirar e voltar a publicar ficam como rasto: quem, quando e o motivo", async () => {
    const s = await pronto();
    const r = await publicar(base.api, s.c, QUEM, s.pedido);
    const id = r.publicacao?.id ?? "";
    await retirarPublicacao(base.api, s.c, "pessoa:outra", id);
    await publicar(base.api, s.c, "pessoa:terceira", s.pedido);
    const rasto = (await eventos(s.c)).filter((e) =>
      e.tipo.startsWith("product."),
    );
    expect(
      rasto.map((e) => [e.tipo, e.dados["quem"], e.dados["motivo"]]),
    ).toEqual([
      ["product.published", QUEM, undefined],
      ["product.unpublished", "pessoa:outra", "retirada"],
      ["product.published", "pessoa:terceira", undefined],
    ]);
    expect(rasto[0]).toMatchObject({
      agregado_tipo: "artigo",
      agregado_id: s.artigo,
      dados: {
        artigo_id: s.artigo,
        publicacao_id: id,
        canal_id: s.canal,
        mercado_id: s.mercado,
      },
    });
    // O instante vai em UTC, com formato fixo, qualquer que seja o fuso da
    // sessão que escreveu (revisão do #143, P3-4).
    expect(rasto[0]?.dados["em"]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
    );
  });

  it("arquivar o artigo deixa product.archived e o product.unpublished em cadeia", async () => {
    const s = await pronto();
    await publicar(base.api, s.c, QUEM, s.pedido);
    const versao = (await obterArtigo(base.api, s.c, s.artigo)).versao;
    await mudarEstadoArtigo(base.api, s.c, s.artigo, versao, "arquivado");
    // A lista inteira: nenhum evento a mais nem repetido (revisão do #143,
    // P3-6).
    expect(
      (await eventos(s.c)).map((e) => [
        e.tipo,
        e.dados["motivo"],
        e.dados["quem"],
      ]),
    ).toEqual([
      ["market.activated", undefined, undefined],
      ["price.changed", undefined, QUEM],
      ["product.published", undefined, QUEM],
      ["product.unpublished", "artigo_arquivado", "catalogo:artigo_arquivado"],
      ["product.archived", undefined, undefined],
    ]);
  });

  it("arquivar o mercado deixa market.archived e o product.unpublished em cadeia", async () => {
    const s = await pronto();
    await publicar(base.api, s.c, QUEM, s.pedido);
    await mudarEstadoMercado(base.api, s.c, s.mercado, 2, "arquivado");
    expect(
      (await eventos(s.c)).map((e) => [e.tipo, e.dados["motivo"]]),
    ).toEqual([
      ["market.activated", undefined],
      ["price.changed", undefined],
      ["product.published", undefined],
      ["product.unpublished", "mercado_arquivado"],
      ["market.archived", undefined],
    ]);
  });

  it("arquivar o canal deixa o product.unpublished em cadeia, e só esse", async () => {
    const s = await pronto();
    await publicar(base.api, s.c, QUEM, s.pedido);
    const { rows } = await sql<{ versao: number }>`
      select versao from canal where id = ${s.canal}`.execute(base.dono);
    await mudarEstadoCanal(
      base.api,
      s.c,
      s.canal,
      rows[0]?.versao ?? 0,
      "arquivado",
    );
    const finais = (await eventos(s.c)).slice(2);
    expect(finais.map((e) => [e.tipo, e.dados["motivo"]])).toEqual([
      ["product.published", undefined],
      ["product.unpublished", "canal_arquivado"],
    ]);
  });

  it("um mercado arquivado e activado outra vez deixa um segundo market.activated", async () => {
    const s = await pronto();
    await mudarEstadoMercado(base.api, s.c, s.mercado, 2, "arquivado");
    await mudarEstadoMercado(base.api, s.c, s.mercado, 3, "activo");
    expect(
      (await eventos(s.c))
        .filter((e) => e.tipo.startsWith("market."))
        .map((e) => e.tipo),
    ).toEqual(["market.activated", "market.archived", "market.activated"]);
  });

  it("um preço depois de uma saída tem o montante antigo nulo; duas mudanças na mesma transacção encadeiam-se", async () => {
    const s = await pronto();
    await tirarPreco(base.api, s.c, QUEM, s.lista, s.variante);
    await definirPreco(base.api, s.c, QUEM, s.lista, s.variante, {
      montante: 1200,
    });
    // Duas mudanças na mesma transacção, por SQL à mão no contexto do
    // comerciante: a segunda vê a primeira como anterior.
    await comComerciante(base.api, s.c, async (trx) => {
      await sql`select set_config('eurolify.quem', ${QUEM}, true)`.execute(trx);
      await sql`update preco set montante = 1300 where variante_id = ${s.variante}`.execute(
        trx,
      );
      await sql`update preco set montante = 1400 where variante_id = ${s.variante}`.execute(
        trx,
      );
    });
    const precos = (await eventos(s.c)).filter(
      (e) => e.tipo === "price.changed",
    );
    expect(
      precos.map((e) => [
        e.dados["montante_antigo"],
        e.dados["montante_novo"],
        e.dados["saiu"],
      ]),
    ).toEqual([
      [null, 990, false],
      [990, null, true],
      [null, 1200, false],
      [1200, 1300, false],
      [1300, 1400, false],
    ]);
  });

  it("apagar o rascunho de um artigo com preço deixa a saída do preço, sem quem declarado", async () => {
    const s = await pronto();
    const rascunho = await criarArtigo(
      base.api,
      s.c,
      { tipo: "fisico", nome: "Lima", categoria_fiscal: "normal" },
      [{ sku: "LIMA-001", unidade_de_venda: "unidade", peso_g: 10 }],
    );
    const [variante] = await comComerciante(base.api, s.c, (trx) =>
      trx
        .selectFrom("variante")
        .select("id")
        .where("artigo_id", "=", rascunho)
        .execute(),
    );
    if (variante === undefined) throw new Error("falta a variante");
    await definirPreco(base.api, s.c, QUEM, s.lista, variante.id, {
      montante: 500,
    });
    await apagarRascunho(base.api, s.c, rascunho);
    const daLima = (await eventos(s.c)).filter(
      (e) => e.agregado_id === variante.id,
    );
    expect(
      daLima.map((e) => [
        e.tipo,
        e.dados["montante_antigo"],
        e.dados["saiu"],
        e.dados["quem"],
      ]),
    ).toEqual([
      ["price.changed", null, false, QUEM],
      ["price.changed", 500, true, "catalogo:variante apagada"],
    ]);
  });

  it("o evento grava-se na transacção da mudança e desfaz-se com ela", async () => {
    const s = await pronto();
    const antes = (await eventos(s.c)).length;
    // Lida pelo dono, que vê a tabela: dentro da transacção o evento já lá
    // está; depois do ROLLBACK, não (revisão do #143, P2-1).
    const dentro = await base.dono
      .transaction()
      .execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${s.c}, true)`.execute(
          trx,
        );
        await sql`select set_config('eurolify.quem', ${QUEM}, true)`.execute(
          trx,
        );
        await sql`update preco set montante = 5000 where variante_id = ${s.variante}`.execute(
          trx,
        );
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from evento_saida
          where comerciante_id = ${s.c}`.execute(trx);
        throw Object.assign(new Error("desfazer"), { n: rows[0]?.n });
      })
      .catch((erro: unknown) => (erro as { n?: number }).n);
    expect(dentro).toBe(antes + 1);
    expect((await eventos(s.c)).length).toBe(antes);
  });

  it("SQL à mão no contexto do comerciante, pela API, também deixa o evento", async () => {
    const s = await pronto();
    await comComerciante(base.api, s.c, async (trx) => {
      await sql`select set_config('eurolify.quem', ${QUEM}, true)`.execute(trx);
      await sql`update preco set montante = 5000 where variante_id = ${s.variante}`.execute(
        trx,
      );
    });
    expect((await eventos(s.c)).at(-1)).toMatchObject({
      tipo: "price.changed",
      dados: { montante_antigo: 990, montante_novo: 5000, quem: QUEM },
    });
  });

  it("um evento não se altera nem se apaga; o publicador só marca o envio, e uma vez", async () => {
    const s = await pronto();
    const dono = base.dono;
    expect(
      await mensagemDoErro(
        sql`update evento_saida set dados = '{}' where comerciante_id = ${s.c}`.execute(
          dono,
        ),
      ),
    ).toMatch(/audit\.append_only: um evento não se altera/);
    expect(
      await mensagemDoErro(
        sql`delete from evento_saida where comerciante_id = ${s.c}`.execute(
          dono,
        ),
      ),
    ).toMatch(/audit\.append_only: um evento não se apaga/);
    expect(
      await mensagemDoErro(sql`truncate evento_saida`.execute(dono)),
    ).toMatch(/audit\.append_only/);
    // O publicador marca uma tentativa falhada e depois o envio.
    await sql`update evento_saida set tentativas = 1, ultimo_erro = 'tempo esgotado'
      where comerciante_id = ${s.c} and tipo = 'market.activated'`.execute(
      dono,
    );
    await sql`update evento_saida set tentativas = 2, publicado_em = now()
      where comerciante_id = ${s.c} and tipo = 'market.activated'`.execute(
      dono,
    );
    expect(
      await mensagemDoErro(
        sql`update evento_saida set tentativas = 3
          where comerciante_id = ${s.c} and tipo = 'market.activated'`.execute(
          dono,
        ),
      ),
    ).toMatch(/audit\.append_only: um evento já publicado não se altera/);
  });

  it("os gatilhos que guardam os eventos valem também em modo réplica (ENABLE ALWAYS)", async () => {
    const { rows } = await sql<{ nome: string; estado: string }>`
      select tgname as nome, tgenabled as estado from pg_trigger
      where tgrelid = 'evento_saida'::regclass and not tgisinternal
      order by 1`.execute(base.dono);
    expect(rows).toEqual([
      { nome: "evento_saida_sem_truncate", estado: "A" },
      { nome: "evento_saida_so_o_publicador", estado: "A" },
    ]);
  });

  it("os gatilhos que escrevem os eventos ficam no estado normal, como os da 0017", async () => {
    // Fixa o estado: uma mudança para ALWAYS (ou desligar um) tem de ser
    // deliberada e passar por aqui (revisão do #143, P3-2).
    const { rows } = await sql<{ nome: string; estado: string }>`
      select tgname as nome, tgenabled as estado from pg_trigger
      where tgname in ('publicacao_evento', 'artigo_evento', 'mercado_evento',
        'historico_preco_evento') and not tgisinternal
      order by 1`.execute(base.dono);
    expect(rows).toEqual([
      { nome: "artigo_evento", estado: "O" },
      { nome: "historico_preco_evento", estado: "O" },
      { nome: "mercado_evento", estado: "O" },
      { nome: "publicacao_evento", estado: "O" },
    ]);
  });

  it("a API não lê, não escreve e não chama as funções dos eventos", async () => {
    const s = await pronto();
    for (const consulta of [
      sql`select count(*) from evento_saida`,
      sql`insert into evento_saida (comerciante_id, tipo, agregado_tipo, agregado_id)
          values (${s.c}, 'product.published', 'artigo', ${s.artigo})`,
      sql`update evento_saida set publicado_em = now()`,
      sql`delete from evento_saida`,
    ]) {
      expect(
        await mensagemDoErro(
          comComerciante(base.api, s.c, (trx) => consulta.execute(trx)),
        ),
      ).toMatch(/^42501:/);
    }
    expect(
      await mensagemDoErro(
        comComerciante(base.api, s.c, (trx) =>
          sql`select publicacao_evento()`.execute(trx),
        ),
      ),
    ).toMatch(/^42501:/);
  });
});
