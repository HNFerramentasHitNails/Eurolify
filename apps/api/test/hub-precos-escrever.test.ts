import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  mudarEstadoMercado,
} from "../src/precos/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// Definir e tirar o preço de uma variante pelo Hub (docs/22 §25; issue
// #335): PUT e DELETE /hub/price-lists/{id}/prices/{variante}, as mesmas
// escritas da chave, na `versao` lida, com a sessão de quem tem
// prices:write. Contra o PostgreSQL 18.

const ENTIDADE = {
  denominacao: "Exemplo, Lda.",
  forma_juridica: "sociedade por quotas",
  pais: "PT",
  numero_fiscal: "123456789",
  morada_linha: "Rua de Teste, 1",
  morada_codigo_postal: "1000-001",
  morada_localidade: "Lisboa",
};

interface Preco {
  variante: string;
  montante: number;
  gratuito: boolean;
  quantidade_minima: number;
  multiplo: number;
  versao: number;
  definido_em: string;
  reducao: { montante: number } | null;
}

/** O preço como o Hub o manda de volta ao escrever (docs/22 §25.2). */
const lidoDe = (p: Preco | null) =>
  p === null ? null : { versao: p.versao, definido_em: p.definido_em };

describe.skipIf(URL_BASE === undefined)(
  "definir e tirar o preço pelo Hub (#335)",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      h = hubDeTeste(base);
    }, 60_000);

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    const chave = (
      segredo: string,
      metodo: "GET" | "POST" | "PUT" | "DELETE",
      url: string,
      corpo?: unknown,
    ) =>
      h.app.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
          ...(corpo === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
      });

    /**
     * Um comerciante com o mercado «Portugal» activo e a lista «Base PT», um
     * canal com esse mercado e um artigo activo de duas variantes (com peso),
     * e a pessoa dona no Hub.
     */
    async function comerciante(nome: string) {
      const id = await registarComerciante(base.api, {
        nome,
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const chaveCom = async (ambitos: string[]) =>
        (
          await criarChave(base.dono, id, {
            tipo: "servidor",
            criadaPor: "operador:teste",
            nome: ambitos.join(" "),
            ambitos: ambitos as never,
          })
        ).segredo;
      const segredo = await chaveCom([
        "catalog:read",
        "catalog:write",
        "prices:read",
        "prices:write",
      ]);
      const entidade = await criarEntidadeLegal(base.api, id, ENTIDADE);
      const loja = await criarLoja(base.api, id, {
        entidade_legal_id: entidade,
        nome: "Loja online",
      });
      const mercado = await criarMercado(base.api, id, {
        loja_id: loja,
        nome: "Portugal",
        paises: ["PT"],
        moeda: "EUR",
        linguas: ["pt"],
        lingua_principal: "pt",
      });
      const lista = await criarLista(base.api, id, {
        mercado_id: mercado,
        nome: "Base PT",
        tipo: "base",
      });
      await mudarEstadoMercado(base.api, id, mercado, 1, "activo");
      const canal = await criarCanal(base.api, id, {
        loja_id: loja,
        nome: "Loja online",
      });
      await definirMercadosDoCanal(base.api, id, canal, [mercado]);
      const r = await chave(segredo, "POST", "/products", {
        tipo: "fisico",
        nome: "Gel Coral 41",
        categoria_fiscal: "normal",
        variantes: [
          {
            sku: `ENS-041-${randomUUID()}`,
            unidade_de_venda: "unidade",
            peso_g: 60,
          },
          {
            sku: `ENS-041-B-${randomUUID()}`,
            unidade_de_venda: "caixa",
            peso_g: 400,
          },
        ],
      });
      expect(r.statusCode, r.body).toBe(201);
      let f = r.json<{
        id: string;
        versao: number;
        variantes: { id: string }[];
      }>();
      const cl = await chave(
        segredo,
        "PUT",
        `/products/${f.id}/classification`,
        {
          versao: f.versao,
          familias: ["retalho_geral"],
          natureza_consumidor: "bem",
        },
      );
      expect(cl.statusCode, cl.body).toBe(200);
      const a = await chave(segredo, "POST", `/products/${f.id}/activate`, {
        versao: cl.json<{ versao: number }>().versao,
      });
      expect(a.statusCode, a.body).toBe(200);
      f = a.json();
      const dono = await h.pessoaCom(id, "dono");
      return {
        id,
        segredo,
        publicar: await chaveCom(["catalog:publish"]),
        artigo: f.id,
        v1: f.variantes[0]?.id ?? "",
        v2: f.variantes[1]?.id ?? "",
        lista: `prl_${lista}`,
        mercado: `mkt_${mercado}`,
        canal: `chn_${canal}`,
        dono,
      };
    }

    type C = Awaited<ReturnType<typeof comerciante>>;

    /** Espera até haver um pedido à espera de um bloqueio no preço. */
    async function aEsperaDeBloqueio() {
      for (let i = 0; i < 100; i++) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and query ilike '%"preco"%'`.execute(base.dono);
        if ((rows[0]?.n ?? 0) > 0) return true;
        await new Promise((r) => {
          setTimeout(r, 50);
        });
      }
      return false;
    }

    const definir = (
      c: C,
      sessao: string,
      variante: string,
      corpo: Record<string, unknown>,
      lista = c.lista,
    ) =>
      h.pedir("PUT", `/hub/price-lists/${lista}/prices/${variante}`, {
        sessao,
        comerciante: c.id,
        corpo,
      });
    const tirar = (
      c: C,
      sessao: string,
      variante: string,
      lido: unknown,
      lista = c.lista,
    ) =>
      h.pedir("DELETE", `/hub/price-lists/${lista}/prices/${variante}`, {
        sessao,
        comerciante: c.id,
        corpo: { lido },
      });
    /** Define pelo Hub sem preço lido e devolve o preço gravado. */
    async function criar(c: C, variante: string, montante: number) {
      const r = await definir(c, c.dono.sessao, variante, {
        montante,
        lido: null,
      });
      expect(r.statusCode, r.body).toBe(200);
      return r.json<Preco>();
    }

    /** O preço da variante na «Base PT», como a ficha do Hub o lê. */
    async function precoNaFicha(c: C, variante: string) {
      const r = await h.pedir("GET", `/hub/products/${c.artigo}/prices`, {
        sessao: c.dono.sessao,
        comerciante: c.id,
      });
      expect(r.statusCode, r.body).toBe(200);
      const dados = r.json<{
        dados: { lista: { id: string }; precos: Preco[] }[];
      }>().dados;
      return (
        dados
          .find((l) => l.lista.id === c.lista)
          ?.precos.find((p) => p.variante === variante) ?? null
      );
    }

    /** Uma transacção de outra «pessoa», aberta, no comerciante. */
    async function transaccaoAberta(comercianteId: string) {
      const cliente = new pg.Client({ connectionString: base.urlApi });
      cliente.on("error", () => undefined);
      await cliente.connect();
      await cliente.query("begin");
      await cliente.query(
        "select set_config('eurolify.comerciante', $1, true)",
        [comercianteId],
      );
      await cliente.query(
        "select set_config('eurolify.quem', 'teste:outra', true)",
      );
      return cliente;
    }

    it("o dono define o preço sem preço lido, muda-o sobre o lido e o «quem» é a pessoa; a ficha dá a versão e o definido_em", async () => {
      const c = await comerciante("Loja Preço Hub");
      const r = await definir(c, c.dono.sessao, c.v2, {
        montante: 3990,
        lido: null,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.headers["cache-control"]).toBe("private, no-store");
      const criado = r.json<Preco>();
      expect(criado).toMatchObject({
        variante: c.v2,
        montante: 3990,
        gratuito: false,
        quantidade_minima: 1,
        multiplo: 1,
        versao: 1,
      });
      expect(lidoDe(await precoNaFicha(c, c.v2))).toEqual(lidoDe(criado));
      const mudado = await definir(c, c.dono.sessao, c.v2, {
        montante: 3590,
        quantidade_minima: 6,
        multiplo: 6,
        lido: lidoDe(criado),
      });
      expect(mudado.statusCode, mudado.body).toBe(200);
      expect(mudado.json<Preco>()).toMatchObject({
        montante: 3590,
        quantidade_minima: 6,
        multiplo: 6,
        versao: 2,
      });
      const { rows } = await sql<{ definido_por: string }>`
        select definido_por from preco
        where variante_id = ${c.v2.slice("var_".length)}`.execute(base.dono);
      expect(rows[0]?.definido_por).toBe(`pessoa:per_${c.dono.pessoa}`);
      // O histórico tem as duas linhas, com a pessoa.
      const hist = await sql<{ montante: string; definido_por: string }>`
        select montante, definido_por from historico_preco
        where variante_id = ${c.v2.slice("var_".length)}
        order by em_vigor_desde`.execute(base.dono);
      expect(hist.rows.map((l) => Number(l.montante))).toEqual([3990, 3590]);
      expect(
        hist.rows.every(
          (l) => l.definido_por === `pessoa:per_${c.dono.pessoa}`,
        ),
      ).toBe(true);
    });

    it("com outro preço guardado, ou «sem preço» quando já há, 409 prices.version_conflict, sem gravar; a chave continua sem o pedir", async () => {
      const c = await comerciante("Loja Preço Conflito");
      const criado = await criar(c, c.v1, 990);
      for (const lido of [
        null,
        { versao: 2, definido_em: criado.definido_em },
        { versao: 1, definido_em: "2020-01-01T00:00:00.000Z" },
      ]) {
        const r = await definir(c, c.dono.sessao, c.v1, {
          montante: 1290,
          lido,
        });
        expect(r.statusCode, r.body).toBe(409);
        expect(h.codigo(r)).toBe("prices.version_conflict");
      }
      expect((await precoNaFicha(c, c.v1))?.montante).toBe(990);
      // Tirar sobre um preço antigo também dá 409.
      const velha = await tirar(c, c.dono.sessao, c.v1, {
        versao: 7,
        definido_em: criado.definido_em,
      });
      expect(velha.statusCode, velha.body).toBe(409);
      expect(h.codigo(velha)).toBe("prices.version_conflict");
      // Pela chave, sem nada lido, como antes.
      const pelaChave = await chave(
        c.segredo,
        "PUT",
        `/price-lists/${c.lista}/prices/${c.v1}`,
        { montante: 1090 },
      );
      expect(pelaChave.statusCode, pelaChave.body).toBe(200);
      expect(pelaChave.json<Preco>().versao).toBe(2);
    });

    it("tirado e posto de novo (a versão volta a 1): quem leu o primeiro recebe 409 (revisão do #339, P2-1)", async () => {
      const c = await comerciante("Loja Preço ABA");
      const primeiro = await criar(c, c.v1, 990);
      // Outra pessoa tira-o e põe-no a 12,90 €, pela chave.
      expect(
        (
          await chave(
            c.segredo,
            "DELETE",
            `/price-lists/${c.lista}/prices/${c.v1}`,
          )
        ).statusCode,
      ).toBe(204);
      const segundo = await chave(
        c.segredo,
        "PUT",
        `/price-lists/${c.lista}/prices/${c.v1}`,
        { montante: 1290 },
      );
      expect(segundo.json<Preco>().versao).toBe(primeiro.versao);
      const r = await definir(c, c.dono.sessao, c.v1, {
        montante: 1500,
        lido: lidoDe(primeiro),
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(h.codigo(r)).toBe("prices.version_conflict");
      const t = await tirar(c, c.dono.sessao, c.v1, lidoDe(primeiro));
      expect(t.statusCode, t.body).toBe(409);
      expect((await precoNaFicha(c, c.v1))?.montante).toBe(1290);
    });

    it("outra escrita a meio, sobre o mesmo preço lido: o Hub espera por ela e dá 409, sem a apagar", async () => {
      const c = await comerciante("Loja Preço Corrida");
      const criado = await criar(c, c.v1, 990);
      const cliente = await transaccaoAberta(c.id);
      try {
        // Outra pessoa muda o preço (versão 2) e ainda não confirmou.
        await cliente.query(
          "update preco set montante = 1500 where variante_id = $1",
          [c.v1.slice("var_".length)],
        );
        const mudar = definir(c, c.dono.sessao, c.v1, {
          montante: 2000,
          lido: lidoDe(criado),
        });
        expect(await aEsperaDeBloqueio()).toBe(true);
        await cliente.query("commit");
        const r = await mudar;
        expect(r.statusCode, r.body).toBe(409);
        expect(h.codigo(r)).toBe("prices.version_conflict");
      } finally {
        await cliente.query("rollback").catch(() => undefined);
        await cliente.end();
      }
      expect(await precoNaFicha(c, c.v1)).toMatchObject({
        montante: 1500,
        versao: 2,
      });
    }, 20_000);

    it("duas pessoas a criar o mesmo preço («sem preço» lido): a segunda espera e dá 409, sem substituir (revisão do #339, P1-1)", async () => {
      const c = await comerciante("Loja Preço Criar a Dois");
      const cliente = await transaccaoAberta(c.id);
      try {
        // A outra pessoa cria o preço e ainda não confirmou.
        await cliente.query(
          `insert into preco (comerciante_id, lista_id, variante_id, montante)
           values ($1, $2, $3, 3990)`,
          [c.id, c.lista.slice("prl_".length), c.v2.slice("var_".length)],
        );
        const criarTambem = definir(c, c.dono.sessao, c.v2, {
          montante: 3590,
          lido: null,
        });
        expect(await aEsperaDeBloqueio()).toBe(true);
        await cliente.query("commit");
        const r = await criarTambem;
        expect(r.statusCode, r.body).toBe(409);
        expect(h.codigo(r)).toBe("prices.version_conflict");
      } finally {
        await cliente.query("rollback").catch(() => undefined);
        await cliente.end();
      }
      expect(await precoNaFicha(c, c.v2)).toMatchObject({
        montante: 3990,
        versao: 1,
      });
    }, 20_000);

    it("tirar sobre o preço lido tira-o (fica no histórico); outra vez dá 409", async () => {
      const c = await comerciante("Loja Preço Tirar");
      const criado = await criar(c, c.v2, 3990);
      const r = await tirar(c, c.dono.sessao, c.v2, lidoDe(criado));
      expect(r.statusCode, r.body).toBe(204);
      expect(await precoNaFicha(c, c.v2)).toBeNull();
      const { rows } = await sql<{ saiu: boolean; definido_por: string }>`
        select saiu, definido_por from historico_preco
        where variante_id = ${c.v2.slice("var_".length)}
        order by em_vigor_desde desc limit 1`.execute(base.dono);
      expect(rows[0]).toEqual({
        saiu: true,
        definido_por: `pessoa:per_${c.dono.pessoa}`,
      });
      const outraVez = await tirar(c, c.dono.sessao, c.v2, lidoDe(criado));
      expect(outraVez.statusCode).toBe(409);
      expect(h.codigo(outraVez)).toBe("prices.version_conflict");
    });

    it("o gestor escreve; o armazém e o apoio recebem 403 e nada muda", async () => {
      const c = await comerciante("Loja Preço Papéis");
      const gestor = await h.pessoaCom(c.id, "gestor");
      const r = await definir(c, gestor.sessao, c.v1, {
        montante: 990,
        lido: null,
      });
      expect(r.statusCode, r.body).toBe(200);
      const lido = lidoDe(r.json<Preco>());
      for (const papel of ["armazem", "apoio"]) {
        const pessoa = await h.pessoaCom(c.id, papel);
        const mudar = await definir(c, pessoa.sessao, c.v1, {
          montante: 1,
          lido,
        });
        expect(mudar.statusCode, `${papel}: ${mudar.body}`).toBe(403);
        const t = await tirar(c, pessoa.sessao, c.v1, lido);
        expect(t.statusCode, `${papel}: ${t.body}`).toBe(403);
      }
      expect((await precoNaFicha(c, c.v1))?.montante).toBe(990);
    });

    it("a lista ou a variante de outro comerciante, ou que não existe, dão 404 ao definir e ao tirar, e nada se grava (revisão do #339, P2-2)", async () => {
      const c = await comerciante("Loja Preço Um");
      const outro = await comerciante("Loja Preço Dois");
      const doOutro = await criar(outro, outro.v1, 500);
      const lido = lidoDe(doOutro);
      const inexistente = `var_${randomUUID()}`;
      const pedidos = [
        // A lista do outro, com a variante deste, sem preço lido e com um.
        definir(
          c,
          c.dono.sessao,
          c.v1,
          { montante: 990, lido: null },
          outro.lista,
        ),
        definir(
          c,
          c.dono.sessao,
          outro.v1,
          { montante: 990, lido },
          outro.lista,
        ),
        // A variante do outro, na lista deste.
        definir(c, c.dono.sessao, outro.v1, { montante: 990, lido: null }),
        definir(c, c.dono.sessao, outro.v1, { montante: 990, lido }),
        // Uma variante que não existe.
        definir(c, c.dono.sessao, inexistente, { montante: 990, lido }),
        // Tirar: a variante deste na lista do outro; o preço do outro, pela
        // lista dele e pela deste.
        tirar(c, c.dono.sessao, c.v1, lido, outro.lista),
        tirar(c, c.dono.sessao, outro.v1, lido, outro.lista),
        tirar(c, c.dono.sessao, outro.v1, lido),
        tirar(c, c.dono.sessao, inexistente, lido),
      ];
      for (const r of await Promise.all(pedidos)) {
        expect(r.statusCode, r.body).toBe(404);
        expect(h.codigo(r)).toBe("prices.not_found");
      }
      const { rows } = await sql<{ id: string; n: number }>`
        select comerciante_id as id, count(*)::int as n from preco
        where comerciante_id in (${c.id}, ${outro.id})
        group by comerciante_id`.execute(base.dono);
      expect(rows).toEqual([{ id: outro.id, n: 1 }]);
      expect((await precoNaFicha(outro, outro.v1))?.montante).toBe(500);
    });

    it("as regras de Preços valem pelo Hub: 0 sem «gratuito», a lista arquivada, a redução em vigor e a variante publicada", async () => {
      const c = await comerciante("Loja Preço Regras");
      const zero = await definir(c, c.dono.sessao, c.v1, {
        montante: 0,
        lido: null,
      });
      expect(zero.statusCode, zero.body).toBe(422);
      expect(h.codigo(zero)).toBe("prices.free_only_at_zero");
      const gratis = await definir(c, c.dono.sessao, c.v2, {
        montante: 0,
        gratuito: true,
        lido: null,
      });
      expect(gratis.statusCode, gratis.body).toBe(200);
      // Uma lista B2B arquivada não recebe preços.
      const etiqueta = await base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${c.id}, true)`.execute(
          trx,
        );
        await sql`select set_config('eurolify.quem', 'teste:etiqueta', true)`.execute(
          trx,
        );
        const { rows } = await sql<{ id: string }>`
          insert into etiqueta_cliente (comerciante_id, nome)
          values (${c.id}, 'Profissionais') returning id`.execute(trx);
        return `ctg_${rows[0]?.id ?? ""}`;
      });
      const b2b = await chave(c.segredo, "POST", "/price-lists", {
        mercado: c.mercado,
        nome: "Profissionais PT",
        tipo: "b2b",
        etiqueta,
        prioridade: 10,
      });
      expect(b2b.statusCode, b2b.body).toBe(201);
      const listaB2b = b2b.json<{ id: string; versao: number }>();
      const arquivar = await chave(
        c.segredo,
        "POST",
        `/price-lists/${listaB2b.id}/archive`,
        { versao: listaB2b.versao },
      );
      expect(arquivar.statusCode, arquivar.body).toBe(200);
      const naArquivada = await definir(
        c,
        c.dono.sessao,
        c.v1,
        { montante: 990, lido: null },
        listaB2b.id,
      );
      expect(naArquivada.statusCode, naArquivada.body).toBe(409);
      expect(h.codigo(naArquivada)).toBe("prices.list_archived");
      // A v1 a 9,90 € com 40 dias de história, depois reduzida para 7,90 €.
      await criar(c, c.v1, 990);
      await base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${c.id}, true)`.execute(
          trx,
        );
        await sql`insert into historico_preco (comerciante_id, lista_id, variante_id, montante,
                  gratuito, saiu, moeda, preco_inclui_iva, em_vigor_desde, definido_por)
                values (${c.id}, ${c.lista.slice(4)}, ${c.v1.slice(4)}, 990, false, false,
                  'EUR', true, now() - make_interval(hours => 960), 'teste:antes')`.execute(
          trx,
        );
      });
      const reducao = await chave(
        c.segredo,
        "PUT",
        `/price-lists/${c.lista}/prices/${c.v1}/reduction`,
        { montante: 790 },
      );
      expect(reducao.statusCode, reducao.body).toBe(200);
      const lido = lidoDe(reducao.json<Preco>());
      const mudar = await definir(c, c.dono.sessao, c.v1, {
        montante: 890,
        lido,
      });
      expect(mudar.statusCode, mudar.body).toBe(409);
      expect(h.codigo(mudar)).toBe("prices.reduction_active");
      // As quantidades mudam com a redução em vigor.
      const quantidades = await definir(c, c.dono.sessao, c.v1, {
        montante: 990,
        quantidade_minima: 2,
        lido,
      });
      expect(quantidades.statusCode, quantidades.body).toBe(200);
      // Publicado, o preço da lista base não sai.
      const pub = await chave(
        c.publicar,
        "POST",
        `/products/${c.artigo}/publications`,
        { canal: c.canal, mercado: c.mercado },
      );
      expect(pub.json<{ publicada: boolean }>().publicada, pub.body).toBe(true);
      const t = await tirar(
        c,
        c.dono.sessao,
        c.v2,
        lidoDe(await precoNaFicha(c, c.v2)),
      );
      expect(t.statusCode, t.body).toBe(409);
      expect(h.codigo(t)).toBe("prices.published_variant");
      expect((await precoNaFicha(c, c.v2))?.gratuito).toBe(true);
    });

    it("um corpo com campos a mais, sem o «lido» ou com a forma antiga é recusado (400)", async () => {
      const c = await comerciante("Loja Preço Corpo");
      for (const corpo of [
        { montante: 990 },
        { montante: 990, versao: null },
        { montante: 990, lido: null, reducao: 1 },
        { montante: 9.9, lido: null },
        { montante: 990, lido: { versao: 1 } },
        { montante: 990, lido: { versao: 1, definido_em: "ontem" } },
      ]) {
        const r = await definir(c, c.dono.sessao, c.v1, corpo);
        expect(r.statusCode, `${JSON.stringify(corpo)}: ${r.body}`).toBe(400);
      }
      expect(await precoNaFicha(c, c.v1)).toBeNull();
    });

    it("com o preço preso por outro: a espera acaba em 503 prices.retry ao fim de 5 s, e nada muda", async () => {
      const c = await comerciante("Loja Preço Preso");
      const criado = await criar(c, c.v1, 990);
      const cliente = await transaccaoAberta(c.id);
      try {
        await cliente.query(
          "select variante_id from preco where variante_id = $1 for update",
          [c.v1.slice("var_".length)],
        );
        const inicio = Date.now();
        const r = await definir(c, c.dono.sessao, c.v1, {
          montante: 1290,
          lido: lidoDe(criado),
        });
        expect(r.statusCode, r.body).toBe(503);
        expect(h.codigo(r)).toBe("prices.retry");
        expect(r.headers["retry-after"]).toBe("1");
        expect(Date.now() - inicio).toBeLessThan(8000);
      } finally {
        await cliente.query("rollback").catch(() => undefined);
        await cliente.end();
      }
      expect((await precoNaFicha(c, c.v1))?.montante).toBe(990);
    }, 20_000);
  },
);
