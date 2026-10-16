import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  classificarArtigo,
  criarArtigo,
  mudarEstadoArtigo,
} from "../src/catalogo/repositorio.js";
import { publicar } from "../src/catalogo/publicacao.js";
import {
  comComerciante,
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
  definirPreco,
  mudarEstadoMercado,
} from "../src/precos/repositorio.js";
import {
  criarCarrinho,
  ErroCheckout,
  TECTO_CARRINHOS_COM_LINHAS,
} from "../src/checkout/repositorio.js";
import { correrLimpezaDasSessoes } from "../src/checkout/limpeza-sessoes.js";
import {
  LIMITE_CARRINHOS_NO_TECTO,
  LIMITE_CARRINHOS_NOVOS,
} from "../src/base/limite.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A limpeza dos carrinhos expirados e o tecto (docs/25 §14; migração 0109;
// issue #479): só se apaga o carrinho aberto, expirado há mais de 7 dias e
// que nunca teve sessão; só no comerciante do contexto; o que alguém está a
// usar salta-se; e a loja não passa o tecto de abertos nem uma chave os
// limites de pedidos.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("limpeza dos carrinhos e tecto", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    app = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      undefined,
      undefined,
      { pedidos: 100_000, janelaMs: 60_000 },
    );
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  /** Um comerciante com a loja, o mercado, o canal e uma chave pública. */
  async function cenario() {
    const c = await registarComerciante(base.api, {
      nome: "Loja",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const entidade = await criarEntidadeLegal(base.api, c, {
      denominacao: "Exemplo, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "509999990",
      morada_linha: "Rua 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
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
    const chave = async () =>
      (
        await criarChave(base.dono, c, {
          tipo: "publica",
          lojaId: loja,
          criadaPor: "operador:teste",
          nome: "Loja",
          ambitos: ["storefront"],
        })
      ).segredo;
    return { c, loja, mercado, canal, lista, chave, publica: await chave() };
  }
  type Cenario = Awaited<ReturnType<typeof cenario>>;

  const dados = (s: Cenario) => ({
    canal: s.canal,
    mercado: s.mercado,
    lingua: "pt",
  });

  /** Uma variante à venda no mercado (12,30 €), publicada no canal. */
  async function comArtigo(s: Cenario): Promise<string> {
    const artigo = await criarArtigo(
      base.api,
      s.c,
      { tipo: "fisico", nome: "Gel UV", categoria_fiscal: "normal" },
      [{ sku: "GEL-001", unidade_de_venda: "unidade", peso_g: 30 }],
    );
    const v = await comComerciante(base.api, s.c, (trx) =>
      trx
        .selectFrom("variante")
        .select("id")
        .where("artigo_id", "=", artigo)
        .executeTakeFirstOrThrow(),
    );
    await classificarArtigo(
      base.api,
      s.c,
      artigo,
      1,
      { familias: ["retalho_geral"], natureza_consumidor: "bem" },
      "pessoa:teste",
    );
    await mudarEstadoArtigo(base.api, s.c, artigo, 2, "activo");
    await definirPreco(base.api, s.c, "pessoa:teste", s.lista, v.id, {
      montante: 1230,
    });
    const r = await publicar(base.api, s.c, "pessoa:teste", {
      artigo_id: artigo,
      canal_id: s.canal,
      mercado_id: s.mercado,
    });
    expect(r.publicada).toBe(true);
    return v.id;
  }

  /** Um carrinho já no estado e com o prazo dados, pelo dono da base. */
  async function carrinhoCom(
    s: Cenario,
    estado: string,
    expiraHaDias: number,
  ): Promise<string> {
    const id = randomUUID();
    await sql`insert into carrinho (id, comerciante_id, loja_id, canal_id,
          mercado_id, lingua, estado, segredo_resumo, expira_em)
        values (${id}::uuid, ${s.c}::uuid, ${s.loja}::uuid, ${s.canal}::uuid,
          ${s.mercado}::uuid, 'pt', ${estado}, ${"a".repeat(64)},
          now() - make_interval(days => ${expiraHaDias}))`.execute(base.dono);
    return id;
  }

  /** Uma sessão de checkout (qualquer estado) sobre o carrinho. */
  const sessaoDe = (s: Cenario, carrinho: string, estado = "expirada") =>
    comComerciante(base.api, s.c, (trx) =>
      sql`insert into sessao_checkout (comerciante_id, loja_id, carrinho_id,
          mercado_id, lingua, token_resumo)
        values (${s.c}::uuid, ${s.loja}::uuid, ${carrinho}::uuid,
          ${s.mercado}::uuid, 'pt', ${randomUUID().replaceAll("-", "").repeat(2)})`
        .execute(trx)
        .then(() =>
          // O estado muda-se pelo dono (o gatilho só deixa a sessão aberta mudar).
          sql`update sessao_checkout set estado = ${estado},
                concluida_em = ${estado === "concluida" ? sql`now()` : null}
              where carrinho_id = ${carrinho}::uuid`.execute(trx),
        ),
    );

  const existe = async (id: string) =>
    (
      await sql<{ n: string }>`select count(*)::text as n from carrinho
          where id = ${id}::uuid`.execute(base.dono)
    ).rows[0]?.n === "1";

  const limpar = (c: string, limite = 100) =>
    comComerciante(base.api, c, async (trx) => {
      const { rows } = await sql<{
        n: number;
      }>`select checkout_carrinhos_limpar(${limite}) as n`.execute(trx);
      return rows[0]?.n ?? 0;
    });

  it("apaga o aberto expirado há mais de 7 dias, com as linhas; o resto fica", async () => {
    const s = await cenario();
    const velho = await carrinhoCom(s, "aberto", 8);
    const recente = await carrinhoCom(s, "aberto", 6);
    const vivo = await carrinhoCom(s, "aberto", -5);
    const emCheckout = await carrinhoCom(s, "em_checkout", 40);
    const convertido = await carrinhoCom(s, "convertido", 40);
    // O estado `expirado` nunca é escrito pelo código (o prazo conta-se pelo
    // relógio); se um dia for, a limpeza não lhe toca nem falha (docs/25 §14).
    const expirado = await carrinhoCom(s, "expirado", 40);
    expect(await limpar(s.c)).toBe(1);
    expect(await existe(velho)).toBe(false);
    for (const x of [recente, vivo, emCheckout, convertido, expirado]) {
      expect(await existe(x), x).toBe(true);
    }
  });

  it("apaga as linhas do carrinho com ele (cascata)", async () => {
    const s = await cenario();
    const velho = await carrinhoCom(s, "aberto", 9);
    const variante = await comArtigo(s);
    await sql`insert into linha_carrinho (comerciante_id, carrinho_id,
          variante_id, quantidade)
        values (${s.c}::uuid, ${velho}::uuid, ${variante}::uuid, 2)`.execute(
      base.dono,
    );
    expect(await limpar(s.c)).toBe(1);
    const { rows } = await sql<{ n: string }>`select count(*)::text as n
        from linha_carrinho where carrinho_id = ${velho}::uuid`.execute(
      base.dono,
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("nunca apaga o que uma sessão de checkout liga, em qualquer estado", async () => {
    const s = await cenario();
    const ids: string[] = [];
    for (const estado of ["aberta", "expirada", "abandonada", "concluida"]) {
      const k = await carrinhoCom(s, "aberto", 60);
      await sessaoDe(s, k, estado);
      ids.push(k);
    }
    expect(await limpar(s.c)).toBe(0);
    for (const k of ids) expect(await existe(k), k).toBe(true);
    // A própria base recusa, mesmo pelo dono: a chave estrangeira da 0041.
    await expect(
      sql`delete from carrinho where id = ${ids[0] ?? ""}::uuid`.execute(
        base.dono,
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("só apaga no comerciante do contexto; sem contexto recusa; a API não apaga directamente", async () => {
    const a = await cenario();
    const b = await cenario();
    const deA = await carrinhoCom(a, "aberto", 20);
    const deB = await carrinhoCom(b, "aberto", 20);
    expect(await limpar(a.c)).toBe(1);
    expect(await existe(deA)).toBe(false);
    expect(await existe(deB)).toBe(true);
    await expect(
      sql`select checkout_carrinhos_limpar(10)`.execute(base.api),
    ).rejects.toThrow(/uuid/);
    // O ramo `merchant.context_required` da função não se alcança: sem o
    // contexto, `comerciante_actual()` falha antes, no cast do texto vazio
    // para uuid (como na limpeza das sessões, 0077).
    const outro = await carrinhoCom(a, "aberto", 20);
    await expect(
      comComerciante(base.api, a.c, (trx) =>
        sql`delete from carrinho where id = ${outro}::uuid`.execute(trx),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await existe(outro)).toBe(true);
  });

  it("respeita o limite do lote e continua na volta seguinte", async () => {
    const s = await cenario();
    for (let i = 0; i < 5; i++) await carrinhoCom(s, "aberto", 30);
    expect(await limpar(s.c, 3)).toBe(3);
    expect(await limpar(s.c, 3)).toBe(2);
    expect(await limpar(s.c, 3)).toBe(0);
  });

  it("concorrência: o carrinho que alguém bloqueou salta-se, e a sessão a nascer segura-o", async () => {
    const s = await cenario();
    const usado = await carrinhoCom(s, "aberto", 30);
    const livre = await carrinhoCom(s, "aberto", 30);
    // 1. Um pedido da loja tem o carrinho bloqueado (como `carrinhoDe`).
    let largar!: () => void;
    const solta = new Promise<void>((r) => (largar = r));
    let preso!: () => void;
    const pronto = new Promise<void>((r) => (preso = r));
    const segurar = comComerciante(base.api, s.c, async (trx) => {
      await sql`select id from carrinho where id = ${usado}::uuid
          for update`.execute(trx);
      preso();
      await solta;
    });
    await pronto;
    expect(await limpar(s.c)).toBe(1);
    expect(await existe(livre)).toBe(false);
    expect(await existe(usado)).toBe(true);
    largar();
    await segurar;
    expect(await limpar(s.c)).toBe(1);
    expect(await existe(usado)).toBe(false);

    // 2. Uma sessão a nascer (ainda sem commit) segura o carrinho.
    const comSessao = await carrinhoCom(s, "aberto", 30);
    let acabar!: () => void;
    const fim = new Promise<void>((r) => (acabar = r));
    let criada!: () => void;
    const apareceu = new Promise<void>((r) => (criada = r));
    const nascer = base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${s.c}, true)`.execute(
        trx,
      );
      await sql`insert into sessao_checkout (comerciante_id, loja_id,
            carrinho_id, mercado_id, lingua, token_resumo)
          values (${s.c}::uuid, ${s.loja}::uuid, ${comSessao}::uuid,
            ${s.mercado}::uuid, 'pt', ${"b".repeat(64)})`.execute(trx);
      criada();
      await fim;
    });
    await apareceu;
    expect(await limpar(s.c)).toBe(0);
    acabar();
    await nascer;
    expect(await limpar(s.c)).toBe(0);
    expect(await existe(comSessao)).toBe(true);
  });

  it("a volta horária apaga em todos os comerciantes e não falha", async () => {
    const a = await cenario();
    const b = await cenario();
    const x = await carrinhoCom(a, "aberto", 12);
    const y = await carrinhoCom(b, "aberto", 12);
    const z = await carrinhoCom(b, "aberto", 3);
    const volta = await correrLimpezaDasSessoes(base.api);
    expect(volta.falhas).toEqual([]);
    expect(volta.carrinhos).toBeGreaterThanOrEqual(2);
    expect(await existe(x)).toBe(false);
    expect(await existe(y)).toBe(false);
    expect(await existe(z)).toBe(true);
  });

  describe("a vida do carrinho: 24 h sem linhas, 30 dias com linhas", () => {
    const criar = (s: Cenario, ip = "198.51.100.1") =>
      app.inject({
        method: "POST",
        url: "/store/carts",
        remoteAddress: ip,
        headers: {
          authorization: `Bearer ${s.publica}`,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          canal: `chn_${s.canal}`,
          mercado: `mkt_${s.mercado}`,
          lingua: "pt",
        }),
      });
    const horas = async (id: string) =>
      Number(
        (
          await sql<{ h: string }>`select (extract(epoch from
            expira_em - now()) / 3600)::text as h from carrinho
            where id = ${id.slice(4)}::uuid`.execute(base.dono)
        ).rows[0]?.h,
      );

    it("sem linhas expira em 24 h; com a primeira linha, em 30 dias; sem a última, volta a 24 h", async () => {
      const s = await cenario();
      const variante = await comArtigo(s);
      const r = await criar(s);
      expect(r.statusCode, r.body).toBe(201);
      const { id, segredo } = r.json<{ id: string; segredo: string }>();
      expect(await horas(id)).toBeGreaterThan(23);
      expect(await horas(id)).toBeLessThanOrEqual(24);
      const l = await app.inject({
        method: "POST",
        url: `/store/carts/${id}/lines`,
        headers: {
          authorization: `Bearer ${s.publica}`,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
          "x-cart-secret": segredo,
        },
        payload: JSON.stringify({ variante: `var_${variante}`, quantidade: 1 }),
      });
      expect(l.statusCode, l.body).toBe(200);
      expect(await horas(id)).toBeGreaterThan(29 * 24);
      const linha = l.json<{ linha: string }>().linha;
      const t = await app.inject({
        method: "DELETE",
        url: `/store/carts/${id}/lines/${linha}`,
        headers: {
          authorization: `Bearer ${s.publica}`,
          "idempotency-key": randomUUID(),
          "x-cart-secret": segredo,
        },
      });
      expect(t.statusCode, t.body).toBe(204);
      expect(await horas(id)).toBeLessThanOrEqual(24);
    });
  });

  describe("o tecto de carrinhos com linhas por loja", () => {
    /** Carrinhos com uma linha cada, pelo dono: contam para o tecto. */
    async function encher(s: Cenario, n: number) {
      const variante = await comArtigo(s);
      await sql`insert into carrinho (comerciante_id, loja_id, canal_id,
          mercado_id, lingua, segredo_resumo, expira_em)
        select ${s.c}::uuid, ${s.loja}::uuid, ${s.canal}::uuid,
          ${s.mercado}::uuid, 'pt', ${"c".repeat(64)}, now() + interval '5 days'
        from generate_series(1, ${n})`.execute(base.dono);
      await sql`insert into linha_carrinho (comerciante_id, carrinho_id,
          variante_id, quantidade)
        select ${s.c}::uuid, k.id, ${variante}::uuid, 1 from carrinho k
        where k.loja_id = ${s.loja}::uuid
          and k.segredo_resumo = ${"c".repeat(64)}`.execute(base.dono);
    }

    it("só contam os carrinhos com linhas, abertos e não expirados, da loja; passado o tecto, quem decide é o callback", async () => {
      const a = await cenario();
      const b = await cenario();
      await encher(a, 2); // 2 com linhas
      await carrinhoCom(a, "aberto", -1); // sem linhas: não conta
      await carrinhoCom(a, "convertido", -1); // não conta
      await carrinhoCom(a, "aberto", -2); // sem linhas: não conta
      const vistos: number[] = [];
      // Com tecto 3 e só 2 carrinhos com linhas, não se chega ao tecto.
      await criarCarrinho(base.api, a.c, a.loja, dados(a), {
        tecto: 3,
        aoPassarOTecto: () => {
          vistos.push(-1);
          return 30;
        },
      });
      expect(vistos).toEqual([]);
      const opcoes = (espera: number) => ({
        tecto: 2,
        aoPassarOTecto: (n: number) => {
          vistos.push(n);
          return espera;
        },
      });
      // No tecto, o callback manda esperar: só esse pedido é recusado.
      const erro = await criarCarrinho(
        base.api,
        a.c,
        a.loja,
        dados(a),
        opcoes(30),
      ).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroCheckout);
      expect((erro as ErroCheckout).codigo).toBe("cart.limit_reached");
      expect((erro as ErroCheckout).pormenor).toEqual({ espera_s: 30 });
      expect(vistos).toEqual([2]);
      // O mesmo tecto, outro pedido que o callback deixa passar: a loja não fecha.
      await criarCarrinho(base.api, a.c, a.loja, dados(a), opcoes(0));
      // Outro comerciante e outra loja: o seu tecto é o seu (o callback nem corre).
      await criarCarrinho(base.api, b.c, b.loja, dados(b), opcoes(30));
      expect(vistos).toEqual([2, 2]);
      // Libertar lugar: um carrinho que expira deixa de contar.
      await sql`update carrinho set expira_em = now() - interval '1 minute'
          where loja_id = ${a.loja}::uuid and estado = 'aberto'
            and expira_em > now()`.execute(base.dono);
      await criarCarrinho(base.api, a.c, a.loja, dados(a), opcoes(30));
      expect(vistos).toEqual([2, 2]);
    });

    it("sem callback ninguém é recusado, mesmo acima do tecto", async () => {
      const s = await cenario();
      await encher(s, 3);
      await criarCarrinho(base.api, s.c, s.loja, dados(s), { tecto: 2 });
    });

    it("pela API, no tecto de 20 000: o IP que mais criou espera (429 cart.limit_reached com Retry-After) e os outros clientes da loja compram", async () => {
      const s = await cenario();
      await encher(s, TECTO_CARRINHOS_COM_LINHAS);
      const criar = (ip: string) =>
        app.inject({
          method: "POST",
          url: "/store/carts",
          remoteAddress: ip,
          headers: {
            authorization: `Bearer ${s.publica}`,
            "idempotency-key": randomUUID(),
            "content-type": "application/json",
          },
          payload: JSON.stringify({
            canal: `chn_${s.canal}`,
            mercado: `mkt_${s.mercado}`,
            lingua: "pt",
          }),
        });
      for (let i = 0; i < LIMITE_CARRINHOS_NO_TECTO.pedidos; i++) {
        const r = await criar("203.0.113.50");
        expect(r.statusCode, `${String(i)} ${r.body}`).toBe(201);
      }
      const recusado = await criar("203.0.113.50");
      expect(recusado.statusCode, recusado.body).toBe(429);
      expect(recusado.json<Json>()["codigo"]).toBe("cart.limit_reached");
      expect(Number(recusado.headers["retry-after"])).toBeGreaterThan(0);
      // Outro cliente da mesma loja, no tecto: compra.
      expect((await criar("203.0.113.51")).statusCode).toBe(201);
    }, 120_000);
  });

  describe("os carrinhos novos por IP e por loja", () => {
    const criar = (
      s: Cenario,
      ip: string,
      segredo = s.publica,
      metodo: "POST" | "GET" = "POST",
    ) =>
      app.inject({
        method: metodo,
        url:
          metodo === "POST"
            ? "/store/carts"
            : `/store/carts/crt_${randomUUID()}`,
        remoteAddress: ip,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(metodo === "POST"
            ? {
                "idempotency-key": randomUUID(),
                "content-type": "application/json",
              }
            : {}),
        },
        ...(metodo === "POST"
          ? {
              payload: JSON.stringify({
                canal: `chn_${s.canal}`,
                mercado: `mkt_${s.mercado}`,
                lingua: "pt",
              }),
            }
          : {}),
      });

    it("20 por minuto por IP e loja; o 21.º recebe 429 com Retry-After; outro IP ou outra loja não se afectam", async () => {
      const s = await cenario();
      const outra = await s.chave();
      const t = await cenario();
      for (let i = 0; i < LIMITE_CARRINHOS_NOVOS.pedidos; i++) {
        const r = await criar(s, "203.0.113.10");
        expect(r.statusCode, `${String(i)} ${r.body}`).toBe(201);
      }
      const r = await criar(s, "203.0.113.10");
      expect(r.statusCode).toBe(429);
      expect(r.json<Json>()["codigo"]).toBe("rate_limit.exceeded");
      expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
      // Outro visitante da loja: a loja não fecha.
      expect((await criar(s, "203.0.113.11")).statusCode).toBe(201);
      // O limite é por IP e loja, não por chave: a outra chave da mesma loja
      // fica no mesmo contador do IP.
      expect((await criar(s, "203.0.113.10", outra)).statusCode).toBe(429);
      // Outra loja, mesmo IP.
      expect((await criar(t, "203.0.113.10")).statusCode).toBe(201);
    }, 60_000);

    it("o que não é criar carrinho não gasta o limite: chave inválida, leituras, checkout alojado e Administração", async () => {
      const s = await cenario();
      const servidor = (
        await criarChave(base.dono, s.c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "Dono",
          ambitos: ["legal:read"],
        })
      ).segredo;
      const ip = "203.0.113.20";
      for (let i = 0; i < 25; i++) {
        // Chave inválida: recusada antes de contar.
        expect((await criar(s, ip, "pk_invalida")).statusCode).toBe(401);
        // Leitura de um carrinho (API da Loja).
        expect((await criar(s, ip, s.publica, "GET")).statusCode).toBe(404);
        // Checkout alojado (âmbito público, sem chave).
        const c = await app.inject({
          method: "GET",
          url: `/checkout/${"a".repeat(43)}/summary`,
          remoteAddress: ip,
        });
        expect(c.statusCode).toBe(404);
        // Administração.
        const a = await app.inject({
          method: "GET",
          url: "/legal-texts",
          remoteAddress: ip,
          headers: { authorization: `Bearer ${servidor}` },
        });
        expect(a.statusCode, a.body).toBe(200);
      }
      for (let i = 0; i < LIMITE_CARRINHOS_NOVOS.pedidos; i++) {
        expect((await criar(s, ip)).statusCode, String(i)).toBe(201);
      }
    }, 60_000);
  });
});
