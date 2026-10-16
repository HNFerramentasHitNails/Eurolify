import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { criarArtigo } from "../src/catalogo/repositorio.js";
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
  mudarEstadoMercado,
} from "../src/precos/repositorio.js";
import {
  criarCarrinho,
  ErroCheckout,
  TECTO_CARRINHOS_ABERTOS,
} from "../src/checkout/repositorio.js";
import { correrLimpezaDasSessoes } from "../src/checkout/limpeza-sessoes.js";
import {
  LIMITE_CARRINHOS_NOVOS,
  LIMITE_CHAVE_LOJA,
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
    await criarLista(base.api, c, {
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
    return { c, loja, mercado, canal, chave, publica: await chave() };
  }
  type Cenario = Awaited<ReturnType<typeof cenario>>;

  const dados = (s: Cenario) => ({
    canal: s.canal,
    mercado: s.mercado,
    lingua: "pt",
  });

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
    expect(await limpar(s.c)).toBe(1);
    expect(await existe(velho)).toBe(false);
    for (const x of [recente, vivo, emCheckout, convertido]) {
      expect(await existe(x), x).toBe(true);
    }
  });

  it("apaga as linhas do carrinho com ele (cascata)", async () => {
    const s = await cenario();
    const velho = await carrinhoCom(s, "aberto", 9);
    // Uma variante de verdade: cria-se um artigo mínimo pelo dono.
    const variante = await comComerciante(base.api, s.c, async (trx) => {
      const id = await criarArtigo(
        trx,
        s.c,
        { tipo: "fisico", nome: "Gel", categoria_fiscal: "normal" },
        [{ sku: "G-1", unidade_de_venda: "unidade", peso_g: 10 }],
      );
      const v = await trx
        .selectFrom("variante")
        .select("id")
        .where("artigo_id", "=", id)
        .executeTakeFirstOrThrow();
      return v.id;
    });
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

  describe("o tecto de carrinhos abertos por loja", () => {
    it("recusa ao passar o tecto; expirados e convertidos não contam; outra loja ou comerciante não se afecta", async () => {
      const a = await cenario();
      const b = await cenario();
      await carrinhoCom(a, "aberto", 2); // expirado: não conta
      await carrinhoCom(a, "convertido", -1); // não conta
      await criarCarrinho(base.api, a.c, a.loja, dados(a), 2);
      await criarCarrinho(base.api, a.c, a.loja, dados(a), 2);
      const erro = await criarCarrinho(
        base.api,
        a.c,
        a.loja,
        dados(a),
        2,
      ).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroCheckout);
      expect((erro as ErroCheckout).codigo).toBe("cart.limit_reached");
      // Outro comerciante: o seu tecto é o seu.
      await criarCarrinho(base.api, b.c, b.loja, dados(b), 2);
      // Libertar lugar: um carrinho que expira deixa de contar.
      await sql`update carrinho set expira_em = now() - interval '1 minute'
          where comerciante_id = ${a.c}::uuid and estado = 'aberto'
            and expira_em > now()`.execute(base.dono);
      await criarCarrinho(base.api, a.c, a.loja, dados(a), 2);
    });

    it("pedidos em paralelo não passam o tecto", async () => {
      const s = await cenario();
      const r = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          criarCarrinho(base.api, s.c, s.loja, dados(s), 3),
        ),
      );
      expect(r.filter((x) => x.status === "fulfilled").length).toBe(3);
      const recusados = r.filter((x) => x.status === "rejected");
      expect(recusados.length).toBe(5);
      for (const x of recusados) {
        expect((x.reason as ErroCheckout).codigo).toBe("cart.limit_reached");
      }
    });

    it("pela API: o último lugar dá 201 e o seguinte 429 cart.limit_reached", async () => {
      const s = await cenario();
      // Enche-se até ao tecto menos um, pelo dono (uma só instrução).
      await sql`insert into carrinho (comerciante_id, loja_id, canal_id,
            mercado_id, lingua, segredo_resumo)
          select ${s.c}::uuid, ${s.loja}::uuid, ${s.canal}::uuid,
            ${s.mercado}::uuid, 'pt', ${"c".repeat(64)}
          from generate_series(1, ${TECTO_CARRINHOS_ABERTOS - 1})`.execute(
        base.dono,
      );
      const criar = () =>
        app.inject({
          method: "POST",
          url: "/store/carts",
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
      expect((await criar()).statusCode).toBe(201);
      const r = await criar();
      expect(r.statusCode, r.body).toBe(429);
      expect(r.json<Json>()["codigo"]).toBe("cart.limit_reached");
    }, 60_000);
  });

  describe("o limite de pedidos por chave", () => {
    const pedir = (segredo: string, metodo: "POST" | "GET", s?: Cenario) =>
      app.inject({
        method: metodo,
        url:
          metodo === "POST"
            ? "/store/carts"
            : `/store/carts/crt_${randomUUID()}`,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(metodo === "POST"
            ? {
                "idempotency-key": randomUUID(),
                "content-type": "application/json",
              }
            : {}),
        },
        ...(metodo === "POST" && s !== undefined
          ? {
              payload: JSON.stringify({
                canal: `chn_${s.canal}`,
                mercado: `mkt_${s.mercado}`,
                lingua: "pt",
              }),
            }
          : {}),
      });

    it("60 carrinhos novos por minuto por chave; a 61.ª recebe 429 com Retry-After; outra chave não é afectada", async () => {
      const s = await cenario();
      const outra = await s.chave();
      for (let i = 0; i < LIMITE_CARRINHOS_NOVOS.pedidos; i++) {
        const r = await pedir(s.publica, "POST", s);
        expect(r.statusCode, `${String(i)} ${r.body}`).toBe(201);
      }
      const r = await pedir(s.publica, "POST", s);
      expect(r.statusCode).toBe(429);
      expect(r.json<Json>()["codigo"]).toBe("rate_limit.exceeded");
      expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
      // Ler continua a poder (o limite dos novos é só dos novos).
      expect((await pedir(s.publica, "GET")).statusCode).toBe(404);
      // Outra chave, mesma loja.
      expect((await pedir(outra, "POST", s)).statusCode).toBe(201);
    }, 60_000);

    it("1 200 pedidos por minuto por chave; o 1 201.º recebe 429", async () => {
      const s = await cenario();
      const outra = await s.chave();
      for (let i = 0; i < LIMITE_CHAVE_LOJA.pedidos; i++) {
        const r = await pedir(s.publica, "GET");
        expect(r.statusCode, String(i)).toBe(404);
      }
      const r = await pedir(s.publica, "GET");
      expect(r.statusCode).toBe(429);
      expect(r.json<Json>()["codigo"]).toBe("rate_limit.exceeded");
      expect((await pedir(outra, "GET")).statusCode).toBe(404);
    }, 120_000);
  });
});
