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
  reducao: { montante: number } | null;
}

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
    const tirar = (c: C, sessao: string, variante: string, versao: number) =>
      h.pedir("DELETE", `/hub/price-lists/${c.lista}/prices/${variante}`, {
        sessao,
        comerciante: c.id,
        corpo: { versao },
      });

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

    it("o dono define o preço sem preço lido (versao null), muda-o com a versão lida e o «quem» é a pessoa; a ficha dá a versão", async () => {
      const c = await comerciante("Loja Preço Hub");
      const r = await definir(c, c.dono.sessao, c.v2, {
        montante: 3990,
        versao: null,
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
      expect(await precoNaFicha(c, c.v2)).toMatchObject({ versao: 1 });
      const mudado = await definir(c, c.dono.sessao, c.v2, {
        montante: 3590,
        quantidade_minima: 6,
        multiplo: 6,
        versao: 1,
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

    it("com outra versão, ou com versao null quando já há preço, 409 prices.version_conflict, sem gravar; a chave continua sem a pedir", async () => {
      const c = await comerciante("Loja Preço Conflito");
      expect(
        (
          await definir(c, c.dono.sessao, c.v1, {
            montante: 990,
            versao: null,
          })
        ).statusCode,
      ).toBe(200);
      for (const versao of [null, 2]) {
        const r = await definir(c, c.dono.sessao, c.v1, {
          montante: 1290,
          versao,
        });
        expect(r.statusCode, r.body).toBe(409);
        expect(h.codigo(r)).toBe("prices.version_conflict");
      }
      expect((await precoNaFicha(c, c.v1))?.montante).toBe(990);
      // Tirar com uma versão antiga também dá 409.
      const velha = await tirar(c, c.dono.sessao, c.v1, 7);
      expect(velha.statusCode, velha.body).toBe(409);
      expect(h.codigo(velha)).toBe("prices.version_conflict");
      // Pela chave, sem versão, como antes.
      const pelaChave = await chave(
        c.segredo,
        "PUT",
        `/price-lists/${c.lista}/prices/${c.v1}`,
        { montante: 1090 },
      );
      expect(pelaChave.statusCode, pelaChave.body).toBe(200);
      expect(pelaChave.json<Preco>().versao).toBe(2);
    });

    it("outra escrita a meio, com a mesma versão lida: o Hub espera por ela e dá 409, sem a apagar", async () => {
      const c = await comerciante("Loja Preço Corrida");
      await definir(c, c.dono.sessao, c.v1, { montante: 990, versao: null });
      const cliente = new pg.Client({ connectionString: base.urlApi });
      cliente.on("error", () => undefined);
      await cliente.connect();
      try {
        await cliente.query("begin");
        await cliente.query(
          "select set_config('eurolify.comerciante', $1, true)",
          [c.id],
        );
        await cliente.query(
          "select set_config('eurolify.quem', 'teste:outra', true)",
        );
        // Outra pessoa muda o preço (versão 2) e ainda não confirmou.
        await cliente.query(
          "update preco set montante = 1500 where variante_id = $1",
          [c.v1.slice("var_".length)],
        );
        const mudar = definir(c, c.dono.sessao, c.v1, {
          montante: 2000,
          versao: 1,
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

    it("tirar com a versão lida tira o preço (fica no histórico); outra vez dá 409", async () => {
      const c = await comerciante("Loja Preço Tirar");
      await definir(c, c.dono.sessao, c.v2, { montante: 3990, versao: null });
      const r = await tirar(c, c.dono.sessao, c.v2, 1);
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
      const outraVez = await tirar(c, c.dono.sessao, c.v2, 1);
      expect(outraVez.statusCode).toBe(409);
      expect(h.codigo(outraVez)).toBe("prices.version_conflict");
    });

    it("o gestor escreve; o armazém e o apoio recebem 403 e nada muda", async () => {
      const c = await comerciante("Loja Preço Papéis");
      const gestor = await h.pessoaCom(c.id, "gestor");
      const r = await definir(c, gestor.sessao, c.v1, {
        montante: 990,
        versao: null,
      });
      expect(r.statusCode, r.body).toBe(200);
      for (const papel of ["armazem", "apoio"]) {
        const pessoa = await h.pessoaCom(c.id, papel);
        const mudar = await definir(c, pessoa.sessao, c.v1, {
          montante: 1,
          versao: 1,
        });
        expect(mudar.statusCode, `${papel}: ${mudar.body}`).toBe(403);
        const t = await tirar(c, pessoa.sessao, c.v1, 1);
        expect(t.statusCode, `${papel}: ${t.body}`).toBe(403);
      }
      expect((await precoNaFicha(c, c.v1))?.montante).toBe(990);
    });

    it("a lista ou a variante de outro comerciante não se alcançam (404), e nada se grava lá", async () => {
      const c = await comerciante("Loja Preço Um");
      const outro = await comerciante("Loja Preço Dois");
      // A lista do outro, com a variante deste.
      const lista = await definir(
        c,
        c.dono.sessao,
        c.v1,
        { montante: 990, versao: null },
        outro.lista,
      );
      expect(lista.statusCode, lista.body).toBe(404);
      // A variante do outro, na lista deste.
      const variante = await definir(c, c.dono.sessao, outro.v1, {
        montante: 990,
        versao: null,
      });
      expect(variante.statusCode, variante.body).toBe(404);
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from preco
        where comerciante_id in (${c.id}, ${outro.id})`.execute(base.dono);
      expect(rows[0]?.n).toBe(0);
    });

    it("as regras de Preços valem pelo Hub: 0 sem «gratuito», a redução em vigor e a variante publicada", async () => {
      const c = await comerciante("Loja Preço Regras");
      const zero = await definir(c, c.dono.sessao, c.v1, {
        montante: 0,
        versao: null,
      });
      expect(zero.statusCode, zero.body).toBe(422);
      expect(h.codigo(zero)).toBe("prices.free_only_at_zero");
      const gratis = await definir(c, c.dono.sessao, c.v2, {
        montante: 0,
        gratuito: true,
        versao: null,
      });
      expect(gratis.statusCode, gratis.body).toBe(200);
      // A v1 a 9,90 € com 40 dias de história, depois reduzida para 7,90 €.
      await definir(c, c.dono.sessao, c.v1, { montante: 990, versao: null });
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
      const v = reducao.json<Preco>().versao;
      const mudar = await definir(c, c.dono.sessao, c.v1, {
        montante: 890,
        versao: v,
      });
      expect(mudar.statusCode, mudar.body).toBe(409);
      expect(h.codigo(mudar)).toBe("prices.reduction_active");
      // As quantidades mudam com a redução em vigor.
      const quantidades = await definir(c, c.dono.sessao, c.v1, {
        montante: 990,
        quantidade_minima: 2,
        versao: v,
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
      const naFicha = await precoNaFicha(c, c.v2);
      const t = await tirar(c, c.dono.sessao, c.v2, naFicha?.versao ?? 0);
      expect(t.statusCode, t.body).toBe(409);
      expect(h.codigo(t)).toBe("prices.published_variant");
      expect((await precoNaFicha(c, c.v2))?.gratuito).toBe(true);
    });

    it("um corpo com campos a mais ou sem a versão é recusado (400)", async () => {
      const c = await comerciante("Loja Preço Corpo");
      for (const corpo of [
        { montante: 990 },
        { montante: 990, versao: null, reducao: 1 },
        { montante: 9.9, versao: null },
      ]) {
        const r = await definir(c, c.dono.sessao, c.v1, corpo);
        expect(r.statusCode, `${JSON.stringify(corpo)}: ${r.body}`).toBe(400);
      }
      expect(await precoNaFicha(c, c.v1)).toBeNull();
    });

    it("com o preço preso por outro: a espera acaba em 503 prices.retry ao fim de 5 s, e nada muda", async () => {
      const c = await comerciante("Loja Preço Preso");
      await definir(c, c.dono.sessao, c.v1, { montante: 990, versao: null });
      const cliente = new pg.Client({ connectionString: base.urlApi });
      cliente.on("error", () => undefined);
      await cliente.connect();
      try {
        await cliente.query("begin");
        await cliente.query(
          "select set_config('eurolify.comerciante', $1, true)",
          [c.id],
        );
        await cliente.query(
          "select variante_id from preco where variante_id = $1 for update",
          [c.v1.slice("var_".length)],
        );
        const inicio = Date.now();
        const r = await definir(c, c.dono.sessao, c.v1, {
          montante: 1290,
          versao: 1,
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
