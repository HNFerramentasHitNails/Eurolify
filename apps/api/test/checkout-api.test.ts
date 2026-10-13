import { createHash, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  classificarArtigo,
  criarArtigo,
  mudarEstadoArtigo,
} from "../src/catalogo/repositorio.js";
import { publicar, retirarPublicacao } from "../src/catalogo/publicacao.js";
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
import { TIPOS_TEXTO_LEGAL, type BaseDados } from "../src/base/esquema.js";
import { urlSemSegredos } from "../src/base/registo.js";
import { correrApagamentosPendentes } from "../src/clientes/titular-fila.js";
import { correrLimpezaDasSessoes } from "../src/checkout/limpeza-sessoes.js";
import { eupagoFalso } from "./eupago-falso.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// O checkout alojado pela API (docs/25; migração 0041): o carrinho pela
// chave pública, a sessão pelo token, o resumo com o preço do mercado, o IVA
// do Motor e os portes, os textos legais com versão e o botão final que cria
// a encomenda com a cópia de tudo.

type Json = Record<string, unknown>;
const QUEM = "pessoa:teste";

describe.skipIf(URL_BASE === undefined)("API do checkout", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  // Os métodos de pagamento vêm da régua (docs/26): uma conta EuPago de teste.
  const eupago = eupagoFalso();

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    // Um limite alto: os testes fazem muitos pedidos do mesmo IP.
    app = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      undefined,
      undefined,
      { pedidos: 100_000, janelaMs: 60_000 },
      eupago.config,
    );
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  const pedir = (
    metodo: "POST" | "PUT" | "GET" | "PATCH" | "DELETE",
    url: string,
    corpo?: unknown,
    cabecalhos: Record<string, string> = {},
  ) =>
    app.inject({
      method: metodo,
      url,
      headers: {
        ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
        ...cabecalhos,
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });
  type Resposta = Awaited<ReturnType<typeof pedir>>;
  /**
   * O botão final. Sem `impressao`, leva a do resumo pedido agora (o que o
   * cliente vê); com ela, a que se der (uma impressão velha, para o R3).
   */
  const botao = async (token: string, corpo: Json): Promise<Resposta> => {
    if (!("impressao" in corpo)) {
      const r = await pedir("GET", `/checkout/${token}/summary`);
      const impressao =
        r.statusCode === 200 ? r.json<Json>()["impressao"] : "0".repeat(64);
      return pedir("POST", `/checkout/${token}/place`, { ...corpo, impressao });
    }
    return pedir("POST", `/checkout/${token}/place`, corpo);
  };
  const ok = async (r: PromiseLike<Resposta>, estado = 200): Promise<Json> => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(estado);
    return x.statusCode === 204 ? {} : x.json();
  };
  const codigo = async (r: PromiseLike<Resposta>) => {
    const x = await r;
    return [
      x.statusCode,
      (x.json<Json>()["codigo"] as string | undefined) ?? null,
    ];
  };

  /**
   * Um comerciante português com a loja, o mercado Portugal (preço com IVA),
   * o canal, um artigo físico com duas variantes publicadas (12,30 € e
   * 6,15 €), os textos legais publicados para PT/pt/consumidor e um método
   * de entrega de 4,99 €, grátis a partir de 50,00 €.
   */
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
    const artigo = await criarArtigo(
      base.api,
      c,
      { tipo: "fisico", nome: "Gel UV", categoria_fiscal: "normal" },
      [
        { sku: "GEL-001", unidade_de_venda: "unidade", peso_g: 30 },
        { sku: "GEL-002", unidade_de_venda: "unidade", peso_g: 30 },
      ],
    );
    const [v1, v2] = (
      await comComerciante(base.api, c, (trx) =>
        trx
          .selectFrom("variante")
          .select("id")
          .where("artigo_id", "=", artigo)
          .orderBy("sku")
          .execute(),
      )
    ).map((v) => v.id);
    if (v1 === undefined || v2 === undefined)
      throw new Error("faltam variantes");
    await classificarArtigo(
      base.api,
      c,
      artigo,
      1,
      { familias: ["retalho_geral"], natureza_consumidor: "bem" },
      QUEM,
    );
    await mudarEstadoArtigo(base.api, c, artigo, 2, "activo");
    await definirPreco(base.api, c, QUEM, lista, v1, { montante: 1230 });
    await definirPreco(base.api, c, QUEM, lista, v2, {
      montante: 615,
      quantidade_minima: 2,
    });
    const r = await publicar(base.api, c, QUEM, {
      artigo_id: artigo,
      canal_id: canal,
      mercado_id: mercado,
    });
    expect(r.publicada).toBe(true);
    const publica = (
      await criarChave(base.dono, c, {
        tipo: "publica",
        lojaId: loja,
        criadaPor: "operador:teste",
        nome: "Loja",
        ambitos: ["storefront"],
      })
    ).segredo;
    const servidor = (
      await criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Dono",
        ambitos: [
          // A lista dos pedidos do titular (docs/23 §15).
          "customers:privacy",
          "legal:read",
          "legal:write",
          "shipping:read",
          "shipping:write",
          "orders:read",
          "payments:read",
          "payments:write",
          "payments:accounts",
          "inventory:read",
          "inventory:write",
          "fulfilment:read",
          "fulfilment:write",
        ],
      })
    ).segredo;
    const adm = (
      m: "POST" | "GET" | "PATCH" | "PUT",
      url: string,
      corpo?: unknown,
    ) => pedir(m, url, corpo, { authorization: `Bearer ${servidor}` });
    const versoes: string[] = [];
    for (const tipo of TIPOS_TEXTO_LEGAL) {
      const t = await ok(
        adm("POST", "/legal-texts", {
          loja: `sto_${loja}`,
          tipo,
          pais: "PT",
          lingua: "pt",
          tipo_cliente: "consumidor",
        }),
        201,
      );
      const v = await ok(
        adm("POST", `/legal-texts/${String(t["id"])}/versions`, {
          texto: `Texto de ${tipo}.`,
        }),
        201,
      );
      await ok(
        adm(
          "POST",
          `/legal-texts/${String(t["id"])}/versions/${String(v["id"])}/publish`,
        ),
      );
      versoes.push(String(v["id"]));
    }
    const metodo = await ok(
      adm("POST", "/shipping-methods", {
        mercado: `mkt_${mercado}`,
        nome: { pt: "Correio" },
        tarifa: 499,
        gratis_a_partir_de: 5000,
      }),
      201,
    );
    // O armazém da loja e 100 unidades de cada variante (docs/27).
    const armazem = await ok(
      adm("POST", "/warehouses", { loja: `sto_${loja}`, nome: "Armazém" }),
      201,
    );
    await ok(
      adm("POST", "/inventory/receipts", {
        armazem: armazem["id"],
        linhas: [
          { variante: `var_${v1}`, quantidade: 100 },
          { variante: `var_${v2}`, quantidade: 100 },
        ],
      }),
      201,
    );
    // A régua dos pagamentos (docs/26 §3.2): MB WAY e Multibanco numa conta
    // EuPago pronta.
    const conta = await ok(
      adm("POST", "/payment-accounts", {
        prestador: "eupago",
        nome: "Produtos",
      }),
      201,
    );
    await ok(
      adm("PUT", `/payment-accounts/${String(conta["id"])}/credentials`, {
        chave: "xxxx-xxxx-xxxx-xxxx",
        segredo_aviso: "segredo-dos-avisos-123",
      }),
      204,
    );
    await ok(adm("POST", `/payment-accounts/${String(conta["id"])}/test`));
    for (const metodo of ["mb_way", "multibanco"]) {
      await ok(
        adm("POST", "/payment-methods", {
          mercado: `mkt_${mercado}`,
          metodo,
          conta: conta["id"],
        }),
        201,
      );
    }
    return {
      armazem: String(armazem["id"]),
      c,
      loja,
      mercado,
      lista,
      canal,
      artigo,
      v1,
      v2,
      publica,
      servidor,
      adm,
      versoes,
      metodo: String(metodo["id"]),
    };
  }

  type Cenario = Awaited<ReturnType<typeof cenario>>;

  /**
   * Uma contagem da verificação diária da VPS, como ela a chama: com o papel
   * da limpeza, sem comerciante posto (docs/23 §15.11). A função corre com o
   * dono das tabelas, que não salta o RLS forçado.
   */
  async function contarComoLimpeza(
    funcao: "titular_pendentes_em_atraso" | "checkout_sessoes_em_atraso",
  ): Promise<number> {
    return base.dono.transaction().execute(async (trx) => {
      await sql`set local role eurolify_limpeza`.execute(trx);
      // O contexto de quem chama volta ao que era (revisão do #433, P3-8).
      const marca = randomUUID();
      await sql`select set_config('eurolify.comerciante', ${marca}, true)`.execute(
        trx,
      );
      const { rows } = await sql<{
        n: string;
      }>`select ${sql.raw(funcao)}() as n`.execute(trx);
      const { rows: depois } = await sql<{
        c: string;
      }>`select current_setting('eurolify.comerciante', true) as c`.execute(
        trx,
      );
      expect(depois[0]?.c).toBe(marca);
      return Number(rows[0]?.n);
    });
  }

  /** Um carrinho com as linhas, o checkout aberto e o token. */
  async function checkoutCom(s: Cenario, linhas: [string, number][]) {
    const loja = { authorization: `Bearer ${s.publica}` };
    const carrinho = await ok(
      pedir(
        "POST",
        "/store/carts",
        { canal: `chn_${s.canal}`, mercado: `mkt_${s.mercado}`, lingua: "pt" },
        loja,
      ),
      201,
    );
    const segredo = { ...loja, "x-cart-secret": String(carrinho["segredo"]) };
    for (const [v, q] of linhas) {
      await ok(
        pedir(
          "POST",
          `/store/carts/${String(carrinho["id"])}/lines`,
          { variante: `var_${v}`, quantidade: q },
          segredo,
        ),
      );
    }
    const sessao = await ok(
      pedir(
        "POST",
        `/store/carts/${String(carrinho["id"])}/checkout`,
        undefined,
        segredo,
      ),
      201,
    );
    return {
      carrinho: String(carrinho["id"]),
      segredo,
      token: String(sessao["token"]),
      sessao: String(sessao["sessao"]),
    };
  }

  /** Preenche o contacto, a entrega, a faturação e os métodos. */
  async function preencher(
    s: Cenario,
    token: string,
    entrega = { pais: "PT", codigo_postal: "1000-001" },
  ) {
    await ok(
      pedir("PUT", `/checkout/${token}/contact`, {
        email: "rui@exemplo.pt",
        nome: "Rui",
      }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/delivery`, {
        ...entrega,
        linha1: "Rua 2",
        localidade: "Lisboa",
      }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/billing`, {
        finalidade: "consumo",
        tipo: "particular",
        nome_documento: "Rui",
      }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/delivery-method`, { metodo: s.metodo }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/payment-method`, {
        metodo: "multibanco",
      }),
    );
  }

  it("o percurso inteiro: o resumo com o IVA e os portes, o botão final cria a encomenda com a cópia; repetir dá a mesma", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 2]]);
    await preencher(s, k.token);
    const resumo = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    // 2 × 12,30 € = 24,60 € (base 20,00 € + IVA 4,60 €); portes 4,99 € com
    // IVA (base 4,06 € + 0,93 €); total 29,59 €.
    expect(resumo).toMatchObject({
      moeda: "EUR",
      linhas: [
        {
          quantidade: 2,
          preco_unitario: 1230,
          base: 2000,
          valor_iva: 460,
          total: 2460,
          iva: { resultado: "tributada", taxa: 2300 },
        },
      ],
      portes: { tarifa: 499, base: 406, valor_iva: 93, total: 499 },
      totais: { base: 2406, iva: 553, total: 2959 },
      em_falta: [],
      bloqueios: [],
      botao: "Encomendar com obrigação de pagar",
    });
    const textos = (resumo["textos"] as Json[]).map((t) => t["versao"]);
    expect([...textos].sort()).toEqual([...s.versoes].sort());
    const feita = await ok(
      botao(k.token, {
        aceita_condicoes: true,
        versoes: textos,
      }),
      201,
    );
    const id = String(feita["encomenda"]);
    expect(id).toMatch(/^ord_/);
    // O botão repetido: a mesma encomenda, sem outra.
    expect(
      await ok(
        botao(k.token, {
          aceita_condicoes: true,
          versoes: textos,
        }),
        201,
      ),
    ).toEqual({ encomenda: id });
    const enc = await ok(s.adm("GET", `/orders/${id}`));
    expect(enc).toMatchObject({
      estado: "a_aguardar_pagamento",
      finalidade: "consumo",
      totais: { base: 2406, iva: 553, total: 2959 },
      metodo_pagamento: "multibanco",
      contacto: { email: "rui@exemplo.pt", nome: "Rui" },
      perfil_copia: { tipo: "particular", nome_documento: "Rui" },
      linhas: [
        {
          posicao: 1,
          sku: "GEL-001",
          nome: "Gel UV",
          quantidade: 2,
          preco_unitario: 1230,
          total: 2460,
        },
      ],
    });
    // A decisão de IVA inteira, com a regra e a versão, e as versões aceites.
    const linha = (enc["linhas"] as Json[])[0] as Json;
    expect(linha["decisao_iva"]).toMatchObject({
      resultado: "tributada",
      regra: "nacional",
      versao_regras: expect.any(String) as unknown,
    });
    expect(enc["aceitacoes"]).toMatchObject({
      botao: "Encomendar com obrigação de pagar",
    });
    // A confirmação, pelo token.
    expect(
      await ok(pedir("GET", `/checkout/${k.token}/confirmation`)),
    ).toMatchObject({ id, totais: { total: 2959 } });
    // Na base: o carrinho convertido, a sessão concluída, os eventos.
    const estado = await comComerciante(base.api, s.c, async (trx) => ({
      carrinho: (
        await trx
          .selectFrom("carrinho")
          .select("estado")
          .executeTakeFirstOrThrow()
      ).estado,
    }));
    // A outbox lê-a o dono (a API não lhe toca), filtrada pelo comerciante.
    const eventos = (
      await sql<{ tipo: string }>`select tipo from evento_saida
        where comerciante_id = ${s.c}::uuid
          and tipo in ('order.created', 'checkout.started', 'legal_text.published')`.execute(
        base.dono,
      )
    ).rows.map((r) => r.tipo);
    expect(estado.carrinho).toBe("convertido");
    expect(eventos.filter((t) => t === "order.created")).toHaveLength(1);
    expect(eventos).toContain("checkout.started");
    expect(eventos.filter((t) => t === "legal_text.published")).toHaveLength(5);
    // Uma encomenda não muda nem se apaga.
    await expect(
      comComerciante(base.dono, s.c, (trx) =>
        sql`update encomenda set total = 1, total_base = 1, total_iva = 0`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/orders.immutable/);
    await expect(
      comComerciante(base.dono, s.c, (trx) =>
        sql`update linha_encomenda set total = 1`.execute(trx),
      ),
    ).rejects.toThrow(/só se acrescenta|so_se_acrescenta|append/i);
  });

  it("se o total mudou entre o resumo que o cliente viu e o botão final, não há encomenda (R3); sem impressão também não", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    // Sem a impressão do resumo, o pedido não é aceite.
    expect(
      await codigo(
        pedir("POST", `/checkout/${k.token}/place`, {
          aceita_condicoes: true,
          versoes: s.versoes,
        }),
      ),
    ).toEqual([400, "request.invalid"]);
    const visto = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    await definirPreco(base.api, s.c, QUEM, s.lista, s.v1, { montante: 1300 });
    // Outro resumo pedido entretanto (outro separador) não faz do velho o
    // que o cliente viu: o botão com a impressão velha recusa.
    const novo = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    expect(novo["impressao"]).not.toBe(visto["impressao"]);
    expect(novo["totais"]).toMatchObject({ total: 1300 + 499 });
    expect(
      await codigo(
        botao(k.token, {
          aceita_condicoes: true,
          versoes: s.versoes,
          impressao: visto["impressao"],
        }),
      ),
    ).toEqual([409, "checkout.total_changed"]);
    // Com a impressão do resumo novo, já pode.
    await ok(
      botao(k.token, {
        aceita_condicoes: true,
        versoes: s.versoes,
        impressao: novo["impressao"],
      }),
      201,
    );
  });

  it("as condições: sem aceitar, ou com versões que não são as do resumo, não há encomenda", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    await ok(pedir("GET", `/checkout/${k.token}/summary`));
    expect(
      await codigo(
        botao(k.token, {
          aceita_condicoes: false,
          versoes: s.versoes,
        }),
      ),
    ).toEqual([422, "checkout.legal_not_accepted"]);
    expect(
      await codigo(
        botao(k.token, {
          aceita_condicoes: true,
          versoes: s.versoes.slice(1),
        }),
      ),
    ).toEqual([422, "checkout.legal_not_accepted"]);
  });

  it("sem um texto legal publicado, o resumo diz o bloqueio e o botão final recusa (R6)", async () => {
    const s = await cenario();
    // Uma versão nova, por publicar, não conta; tira-se a publicada criando
    // outro comerciante sem textos — aqui, compra como profissional (sem
    // textos para profissionais).
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    await ok(
      pedir("PUT", `/checkout/${k.token}/billing`, {
        finalidade: "profissional",
        tipo: "empresa",
        nome_documento: "Rui, Lda",
        nif: "513207384",
      }),
    );
    const r = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    expect(r["bloqueios"]).toEqual([
      { onde: "texto:condicoes_gerais", motivo: "texto_legal_em_falta" },
      { onde: "texto:privacidade", motivo: "texto_legal_em_falta" },
    ]);
    expect(
      await codigo(
        botao(k.token, {
          aceita_condicoes: true,
          versoes: [],
        }),
      ),
    ).toEqual([422, "checkout.legal_text_missing"]);
  });

  it("o Motor de IVA bloqueia a Madeira (território por validar): o resumo mostra-o e o botão final recusa", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token, { pais: "PT", codigo_postal: "9000-018" });
    const r = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    expect(r["bloqueios"]).toContainEqual({
      onde: `var_${s.v1}`,
      motivo: "territorio_por_validar",
    });
    expect(
      await codigo(
        botao(k.token, {
          aceita_condicoes: true,
          versoes: s.versoes,
        }),
      ),
    ).toEqual([422, "checkout.vat_blocked"]);
  });

  it("portes grátis a partir de 50,00 €; quantidade mínima; um país que a loja não serve; profissional sem NIF", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 5]]);
    await preencher(s, k.token);
    const r = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    expect(r["portes"]).toMatchObject({ tarifa: 0, total: 0 });
    expect(r["totais"]).toMatchObject({ total: 6150 });
    // A v2 pede pelo menos 2.
    const loja = { authorization: `Bearer ${s.publica}` };
    const c2 = await ok(
      pedir(
        "POST",
        "/store/carts",
        { canal: `chn_${s.canal}`, mercado: `mkt_${s.mercado}`, lingua: "pt" },
        loja,
      ),
      201,
    );
    expect(
      await codigo(
        pedir(
          "POST",
          `/store/carts/${String(c2["id"])}/lines`,
          { variante: `var_${s.v2}`, quantidade: 1 },
          { ...loja, "x-cart-secret": String(c2["segredo"]) },
        ),
      ),
    ).toEqual([422, "cart.min_quantity"]);
    expect(
      await codigo(
        pedir("PUT", `/checkout/${k.token}/delivery`, {
          pais: "ES",
          codigo_postal: "28001",
          linha1: "C/ 1",
          localidade: "Madrid",
        }),
      ),
    ).toEqual([422, "checkout.country_not_served"]);
    expect(
      await codigo(
        pedir("PUT", `/checkout/${k.token}/billing`, {
          finalidade: "profissional",
          tipo: "particular",
          nome_documento: "Rui",
        }),
      ),
    ).toEqual([400, "checkout.invalid_field"]);
  });

  it("o carrinho é de quem tem o segredo e da loja da chave; as chaves não se trocam; uma variante desconhecida não entra", async () => {
    const s = await cenario();
    const outro = await cenario();
    const loja = { authorization: `Bearer ${s.publica}` };
    const c = await ok(
      pedir(
        "POST",
        "/store/carts",
        { canal: `chn_${s.canal}`, mercado: `mkt_${s.mercado}`, lingua: "pt" },
        loja,
      ),
      201,
    );
    const id = String(c["id"]);
    expect(
      await codigo(
        pedir("GET", `/store/carts/${id}`, undefined, {
          ...loja,
          "x-cart-secret": "errado",
        }),
      ),
    ).toEqual([404, "cart.secret_invalid"]);
    expect(
      await codigo(
        pedir("GET", `/store/carts/${id}`, undefined, {
          authorization: `Bearer ${outro.publica}`,
          "x-cart-secret": String(c["segredo"]),
        }),
      ),
    ).toEqual([404, "cart.secret_invalid"]);
    // O canal de outro comerciante não existe para esta loja.
    expect(
      await codigo(
        pedir(
          "POST",
          "/store/carts",
          {
            canal: `chn_${outro.canal}`,
            mercado: `mkt_${outro.mercado}`,
            lingua: "pt",
          },
          loja,
        ),
      ),
    ).toEqual([404, "checkout.not_found"]);
    // A chave de servidor não serve a loja; a pública não serve a Administração.
    expect(
      (
        await pedir(
          "POST",
          "/store/carts",
          {
            canal: `chn_${s.canal}`,
            mercado: `mkt_${s.mercado}`,
            lingua: "pt",
          },
          { authorization: `Bearer ${s.servidor}` },
        )
      ).statusCode,
    ).toBe(403);
    expect((await pedir("GET", "/orders", undefined, loja)).statusCode).toBe(
      403,
    );
    expect(
      await codigo(
        pedir(
          "POST",
          `/store/carts/${id}/lines`,
          { variante: `var_${randomUUID()}`, quantidade: 1 },
          { ...loja, "x-cart-secret": String(c["segredo"]) },
        ),
      ),
    ).toEqual([422, "checkout.variant_unavailable"]);
    // Um token que não existe.
    expect(await codigo(pedir("GET", `/checkout/${"a".repeat(43)}`))).toEqual([
      404,
      "checkout.not_found",
    ]);
    // A encomenda do vizinho não existe.
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    await ok(pedir("GET", `/checkout/${k.token}/summary`));
    const e = await ok(
      botao(k.token, {
        aceita_condicoes: true,
        versoes: s.versoes,
      }),
      201,
    );
    expect(
      await codigo(outro.adm("GET", `/orders/${String(e["encomenda"])}`)),
    ).toEqual([404, "checkout.not_found"]);
  });

  it("uma sessão expirada recusa e reabre o carrinho; mexer no carrinho abandona a sessão aberta", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await comComerciante(base.dono, s.c, (trx) =>
      sql`update sessao_checkout set expira_em = now() - interval '1 minute'
          where id = ${k.sessao.slice(4)}::uuid`.execute(trx),
    );
    expect(await codigo(pedir("GET", `/checkout/${k.token}`))).toEqual([
      410,
      "checkout.expired",
    ]);
    const estado = await comComerciante(base.api, s.c, async (trx) => ({
      sessao: (
        await trx
          .selectFrom("sessao_checkout")
          .select("estado")
          .executeTakeFirstOrThrow()
      ).estado,
      carrinho: (
        await trx
          .selectFrom("carrinho")
          .select("estado")
          .executeTakeFirstOrThrow()
      ).estado,
    }));
    expect(estado).toEqual({ sessao: "expirada", carrinho: "aberto" });
    // Abre outra, e mexer no carrinho abandona-a.
    const nova = await ok(
      pedir(
        "POST",
        `/store/carts/${k.carrinho}/checkout`,
        undefined,
        k.segredo,
      ),
      201,
    );
    await ok(
      pedir(
        "POST",
        `/store/carts/${k.carrinho}/lines`,
        { variante: `var_${s.v1}`, quantidade: 3 },
        k.segredo,
      ),
    );
    expect(
      await codigo(pedir("GET", `/checkout/${String(nova["token"])}/summary`)),
    ).toEqual([409, "checkout.closed"]);
  });

  it("textos legais: uma versão publicada não muda; métodos de entrega com a versão; listas", async () => {
    const s = await cenario();
    await expect(
      comComerciante(base.api, s.c, (trx) =>
        sql`update versao_texto_legal set texto = 'outro'`.execute(trx),
      ),
    ).rejects.toThrow(/legal.version_immutable/);
    const lista = await ok(s.adm("GET", "/legal-texts"));
    expect((lista["dados"] as Json[]).length).toBe(5);
    expect(
      await codigo(
        s.adm("POST", "/legal-texts", {
          loja: `sto_${s.loja}`,
          tipo: "privacidade",
          pais: "PT",
          lingua: "pt",
          tipo_cliente: "consumidor",
        }),
      ),
    ).toEqual([409, "legal.duplicate"]);
    await ok(
      s.adm("PATCH", `/shipping-methods/${s.metodo}`, {
        versao: 1,
        tarifa: 599,
      }),
      204,
    );
    expect(
      await codigo(
        s.adm("PATCH", `/shipping-methods/${s.metodo}`, {
          versao: 1,
          tarifa: 699,
        }),
      ),
    ).toEqual([409, "checkout.version_conflict"]);
    expect(
      ((await ok(s.adm("GET", "/shipping-methods")))["dados"] as Json[])[0],
    ).toMatchObject({ tarifa: 599, versao: 2 });
    expect((await ok(s.adm("GET", "/orders")))["dados"]).toEqual([]);
  });

  it("o que não se vende: um artigo por publicar, uma variante fora da publicação, um serviço (só físicos nesta fatia)", async () => {
    const s = await cenario();
    const loja = { authorization: `Bearer ${s.publica}` };
    const c = await ok(
      pedir(
        "POST",
        "/store/carts",
        { canal: `chn_${s.canal}`, mercado: `mkt_${s.mercado}`, lingua: "pt" },
        loja,
      ),
      201,
    );
    const comSegredo = { ...loja, "x-cart-secret": String(c["segredo"]) };
    const pedirLinha = (v: string, q = 2) =>
      codigo(
        pedir(
          "POST",
          `/store/carts/${String(c["id"])}/lines`,
          { variante: `var_${v}`, quantidade: q },
          comSegredo,
        ),
      );
    // Um artigo físico com preço, mas sem publicação.
    const outro = await criarArtigo(
      base.api,
      s.c,
      { tipo: "fisico", nome: "Lima", categoria_fiscal: "normal" },
      [{ sku: "LIMA-1", unidade_de_venda: "unidade", peso_g: 10 }],
    );
    const [vo] = (
      await comComerciante(base.api, s.c, (trx) =>
        trx
          .selectFrom("variante")
          .select("id")
          .where("artigo_id", "=", outro)
          .execute(),
      )
    ).map((v) => v.id);
    if (vo === undefined) throw new Error("falta a variante");
    await definirPreco(base.api, s.c, QUEM, s.lista, vo, { montante: 300 });
    expect(await pedirLinha(vo)).toEqual([422, "checkout.variant_unavailable"]);
    // A v2 posta fora da publicação.
    expect(await pedirLinha(s.v2)).toEqual([200, null]);
    const r = await publicar(base.api, s.c, QUEM, {
      artigo_id: s.artigo,
      canal_id: s.canal,
      mercado_id: s.mercado,
      variantes_fora: [s.v2],
    });
    expect(r.publicada).toBe(true);
    expect(await pedirLinha(s.v2)).toEqual([
      422,
      "checkout.variant_unavailable",
    ]);
    // A publicação retirada (arquivada): nenhuma variante se vende.
    if (r.publicacao === null) throw new Error("sem publicação");
    await retirarPublicacao(base.api, s.c, QUEM, r.publicacao.id);
    expect(await pedirLinha(s.v1, 1)).toEqual([
      422,
      "checkout.variant_unavailable",
    ]);
    // Um serviço presencial publicado: não se vende até a natureza para o
    // IVA estar no artigo (docs/24 §13).
    const servico = await criarArtigo(
      base.api,
      s.c,
      { tipo: "servico", nome: "Formação", categoria_fiscal: "normal" },
      [{ sku: "FORM-1", unidade_de_venda: "unidade" }],
    );
    const daqui = (dias: number) => new Date(Date.now() + dias * 86_400_000);
    await classificarArtigo(
      base.api,
      s.c,
      servico,
      1,
      {
        familias: ["retalho_geral"],
        natureza_consumidor: "servico_presencial",
        modo: "presencial",
        prestacao_inicio: daqui(30),
        prestacao_fim: daqui(31),
        local_pais: "PT",
      },
      QUEM,
    );
    await mudarEstadoArtigo(base.api, s.c, servico, 2, "activo");
    const [vs] = (
      await comComerciante(base.api, s.c, (trx) =>
        trx
          .selectFrom("variante")
          .select("id")
          .where("artigo_id", "=", servico)
          .execute(),
      )
    ).map((v) => v.id);
    if (vs === undefined) throw new Error("falta a variante");
    await definirPreco(base.api, s.c, QUEM, s.lista, vs, { montante: 5000 });
    const ps = await publicar(base.api, s.c, QUEM, {
      artigo_id: servico,
      canal_id: s.canal,
      mercado_id: s.mercado,
    });
    expect(ps.verificacao.impedimentos).toEqual([]);
    expect(ps.publicada).toBe(true);
    expect(await pedirLinha(vs, 1)).toEqual([
      422,
      "checkout.variant_unavailable",
    ]);
  });

  it("duas lojas do mesmo comerciante: a chave de uma não vê o carrinho da outra nem cria carrinhos nos canais dela; uma sessão concluída não muda", async () => {
    const s = await cenario();
    const entidade = await comComerciante(
      base.api,
      s.c,
      async (trx) =>
        (
          await trx
            .selectFrom("loja")
            .select("entidade_legal_id")
            .executeTakeFirstOrThrow()
        ).entidade_legal_id,
    );
    const loja2 = await criarLoja(base.api, s.c, {
      entidade_legal_id: entidade,
      nome: "Outra loja",
    });
    const mercado2 = await criarMercado(base.api, s.c, {
      loja_id: loja2,
      nome: "Portugal 2",
      paises: ["PT"],
      moeda: "EUR",
      linguas: ["pt"],
      lingua_principal: "pt",
    });
    await criarLista(base.api, s.c, {
      mercado_id: mercado2,
      nome: "Base",
      tipo: "base",
    });
    await mudarEstadoMercado(base.api, s.c, mercado2, 1, "activo");
    const canal2 = await criarCanal(base.api, s.c, {
      loja_id: loja2,
      nome: "Outra",
    });
    await definirMercadosDoCanal(base.api, s.c, canal2, [mercado2]);
    const publica2 = (
      await criarChave(base.dono, s.c, {
        tipo: "publica",
        lojaId: loja2,
        criadaPor: "operador:teste",
        nome: "Loja 2",
        ambitos: ["storefront"],
      })
    ).segredo;
    const k = await checkoutCom(s, [[s.v1, 1]]);
    expect(
      await codigo(
        pedir("GET", `/store/carts/${k.carrinho}`, undefined, {
          authorization: `Bearer ${publica2}`,
          "x-cart-secret": k.segredo["x-cart-secret"],
        }),
      ),
    ).toEqual([404, "cart.secret_invalid"]);
    expect(
      await codigo(
        pedir(
          "POST",
          "/store/carts",
          { canal: `chn_${canal2}`, mercado: `mkt_${mercado2}`, lingua: "pt" },
          { authorization: `Bearer ${s.publica}` },
        ),
      ),
    ).toEqual([404, "checkout.not_found"]);
    await preencher(s, k.token);
    await ok(pedir("GET", `/checkout/${k.token}/summary`));
    await ok(
      botao(k.token, {
        aceita_condicoes: true,
        versoes: s.versoes,
      }),
      201,
    );
    expect(
      await codigo(
        pedir("PUT", `/checkout/${k.token}/contact`, {
          email: "x@exemplo.pt",
          nome: "X",
        }),
      ),
    ).toEqual([409, "checkout.closed"]);
  });
  /** Um artigo físico publicado com outra categoria fiscal (uma variante). */
  async function outroArtigo(s: Cenario, categoria: string) {
    const artigo = await criarArtigo(
      base.api,
      s.c,
      { tipo: "fisico", nome: "Livro", categoria_fiscal: categoria },
      [{ sku: `LIV-${categoria}`, unidade_de_venda: "unidade", peso_g: 300 }],
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
      QUEM,
    );
    await mudarEstadoArtigo(base.api, s.c, artigo, 2, "activo");
    await definirPreco(base.api, s.c, QUEM, s.lista, v.id, { montante: 1000 });
    const r = await publicar(base.api, s.c, QUEM, {
      artigo_id: artigo,
      canal_id: s.canal,
      mercado_id: s.mercado,
    });
    expect(r.publicada).toBe(true);
    await ok(
      s.adm("POST", "/inventory/receipts", {
        armazem: s.armazem,
        linhas: [{ variante: `var_${v.id}`, quantidade: 10 }],
      }),
      201,
    );
    return v.id;
  }

  it("o segredo não se repete: o mesmo pedido com a mesma Idempotency-Key recusa e a base não guarda o segredo nem o token", async () => {
    const s = await cenario();
    const loja = { authorization: `Bearer ${s.publica}` };
    const chave = randomUUID();
    const corpo = {
      canal: `chn_${s.canal}`,
      mercado: `mkt_${s.mercado}`,
      lingua: "pt",
    };
    const carrinho = await ok(
      pedir("POST", "/store/carts", corpo, {
        ...loja,
        "idempotency-key": chave,
      }),
      201,
    );
    expect(
      await codigo(
        pedir("POST", "/store/carts", corpo, {
          ...loja,
          "idempotency-key": chave,
        }),
      ),
    ).toEqual([409, "idempotency.secret_not_repeated"]);
    const segredo = {
      ...loja,
      "x-cart-secret": String(carrinho["segredo"]),
    };
    await ok(
      pedir(
        "POST",
        `/store/carts/${String(carrinho["id"])}/lines`,
        { variante: `var_${s.v1}`, quantidade: 1 },
        segredo,
      ),
    );
    const chaveSessao = randomUUID();
    const sessao = await ok(
      pedir(
        "POST",
        `/store/carts/${String(carrinho["id"])}/checkout`,
        undefined,
        {
          ...segredo,
          "idempotency-key": chaveSessao,
        },
      ),
      201,
    );
    expect(
      await codigo(
        pedir(
          "POST",
          `/store/carts/${String(carrinho["id"])}/checkout`,
          undefined,
          { ...segredo, "idempotency-key": chaveSessao },
        ),
      ),
    ).toEqual([409, "idempotency.secret_not_repeated"]);
    const guardado = (
      await sql<{
        corpo: string;
      }>`select coalesce(resposta_corpo::text, '') as corpo
        from idempotencia where comerciante_id = ${s.c}::uuid`.execute(
        base.dono,
      )
    ).rows
      .map((r) => r.corpo)
      .join(" ");
    expect(guardado).not.toContain(String(carrinho["segredo"]));
    expect(guardado).not.toContain(String(sessao["token"]));
  });

  it("dois cliques no botão final ao mesmo tempo: uma encomenda só", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    const r = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    const corpo = {
      aceita_condicoes: true,
      versoes: s.versoes,
      impressao: r["impressao"],
    };
    const [a, b] = await Promise.all([
      botao(k.token, corpo),
      botao(k.token, corpo),
    ]);
    const estados = [a.statusCode, b.statusCode].sort();
    expect([
      [201, 201],
      [201, 503],
    ]).toContainEqual(estados);
    const n = await comComerciante(
      base.api,
      s.c,
      async (trx) =>
        (
          await trx
            .selectFrom("encomenda")
            .select((e) => e.fn.countAll<string>().as("n"))
            .executeTakeFirstOrThrow()
        ).n,
    );
    expect(Number(n)).toBe(1);
  });

  it("categorias fiscais misturadas: os portes não têm taxa validada e o botão final recusa (V12)", async () => {
    const s = await cenario();
    // Só há a categoria «normal» na lista (0040); uma segunda, por validar,
    // só para este ensaio (cada ficheiro de testes tem a sua base).
    await sql`insert into categoria_fiscal values
      ('livros', 'Livros', 'Books', 'por_validar') on conflict do nothing`.execute(
      base.dono,
    );
    const livro = await outroArtigo(s, "livros");
    const k = await checkoutCom(s, [
      [s.v1, 1],
      [livro, 1],
    ]);
    await preencher(s, k.token);
    const r = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    expect(r["bloqueios"]).toContainEqual({
      onde: "portes",
      motivo: "portes_categorias_misturadas",
    });
    expect(
      await codigo(
        botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      ),
    ).toEqual([422, "checkout.vat_blocked"]);
  });

  it("um método de entrega que pede telefone: sem ele falta; com ele, a encomenda", async () => {
    const s = await cenario();
    const m = await ok(
      s.adm("POST", "/shipping-methods", {
        mercado: `mkt_${s.mercado}`,
        nome: { pt: "Estafeta" },
        tarifa: 699,
        pede_telefone: true,
      }),
      201,
    );
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    await ok(
      pedir("PUT", `/checkout/${k.token}/delivery-method`, {
        metodo: String(m["id"]),
      }),
    );
    const r = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    expect(r["em_falta"]).toEqual(["telefone"]);
    expect(
      await codigo(
        botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      ),
    ).toEqual([422, "checkout.incomplete"]);
    await ok(
      pedir("PUT", `/checkout/${k.token}/contact`, {
        email: "rui@exemplo.pt",
        nome: "Rui",
        telefone: "+351912345678",
      }),
    );
    await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
  });

  it("os textos a aceitar lêem-se pelo token (só os do resumo) e pela Administração; a encomenda guarda o resumo SHA-256 do texto", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    const r = await ok(pedir("GET", `/checkout/${k.token}/summary`));
    const textos = r["textos"] as Json[];
    const primeiro = textos[0] as Json;
    const lido = await ok(
      pedir("GET", `/checkout/${k.token}/legal/${String(primeiro["versao"])}`),
    );
    const esperado = createHash("sha256")
      .update(String(lido["texto"]), "utf8")
      .digest("hex");
    expect(lido).toMatchObject({
      id: primeiro["versao"],
      estado: "publicada",
      resumo_texto: esperado,
    });
    expect(String(lido["texto"])).toMatch(/^Texto de /);
    expect(primeiro["resumo_texto"]).toBe(esperado);
    // Uma versão que não está no resumo (um rascunho do mesmo texto) não
    // existe para o cliente; para a Administração, sim.
    const rascunho = await ok(
      s.adm("POST", `/legal-texts/${String(lido["texto_legal"])}/versions`, {
        texto: "Rascunho.",
      }),
      201,
    );
    expect(
      await codigo(
        pedir("GET", `/checkout/${k.token}/legal/${String(rascunho["id"])}`),
      ),
    ).toEqual([404, "checkout.not_found"]);
    expect(
      await ok(
        s.adm(
          "GET",
          `/legal-texts/${String(lido["texto_legal"])}/versions/${String(rascunho["id"])}`,
        ),
      ),
    ).toMatchObject({ texto: "Rascunho.", estado: "rascunho" });
    // A versão de outro texto pelo endereço deste não existe.
    const segundo = textos[1] as Json;
    expect(
      await codigo(
        s.adm(
          "GET",
          `/legal-texts/${String(lido["texto_legal"])}/versions/${String(segundo["versao"])}`,
        ),
      ),
    ).toEqual([404, "checkout.not_found"]);
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    const enc = await ok(s.adm("GET", `/orders/${String(e["encomenda"])}`));
    const aceites = (enc["aceitacoes"] as Json)["versoes"] as Json[];
    expect(aceites.map((a) => a["resumo_texto"])).toContain(esperado);
    // A hora da aceitação vem da base (ISO em UTC).
    expect(String((enc["aceitacoes"] as Json)["em"])).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("as sessões sem dados pessoais: a concluída logo; a expirada, a abandonada e a aberta esquecida 7 dias depois; as de 6 dias ficam (docs/23 §15.4)", async () => {
    const s = await cenario();
    const pessoais = async (sessao: string) =>
      (
        await sql<Json>`select email, nome, telefone, entrega, faturacao
          from sessao_checkout where id = ${sessao.slice(4)}::uuid`.execute(
          base.dono,
        )
      ).rows[0];
    const vazia = {
      email: null,
      nome: null,
      telefone: null,
      entrega: null,
      faturacao: null,
    };
    // Concluída: sai ao criar a encomenda; a encomenda tem a cópia.
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    expect((await pessoais(k.sessao))?.["email"]).toBe("rui@exemplo.pt");
    await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    expect(await pessoais(k.sessao)).toEqual(vazia);
    expect(await ok(pedir("GET", `/checkout/${k.token}`))).toMatchObject({
      estado: "concluida",
      contacto: null,
    });
    expect(
      await ok(pedir("GET", `/checkout/${k.token}/confirmation`)),
    ).toMatchObject({ contacto: { email: "rui@exemplo.pt" } });
    // Sessões com dados, envelhecidas pelo superutilizador do teste (o
    // gatilho desligado nesta transacção). A última mudança e a expiração
    // contam à parte (revisão do #402, P2-1 e P3-1).
    const nova = async (cen: Cenario = s) => {
      const x = await checkoutCom(cen, [[cen.v1, 1]]);
      await ok(
        pedir("PUT", `/checkout/${x.token}/contact`, {
          email: "ana@exemplo.pt",
          nome: "Ana",
        }),
      );
      return x.sessao;
    };
    const semGatilho = (f: (trx: Transaction<BaseDados>) => Promise<unknown>) =>
      base.dono.transaction().execute(async (trx) => {
        await sql`alter table sessao_checkout disable trigger sessao_checkout_antes_de_gravar`.execute(
          trx,
        );
        await f(trx);
        await sql`alter table sessao_checkout enable always trigger sessao_checkout_antes_de_gravar`.execute(
          trx,
        );
      });
    /** `mudou` e `expirou`: há quantos dias (negativo: no futuro). */
    const envelhecer = (
      sessao: string,
      estado: string,
      mudou: number,
      expirou: number,
    ) =>
      semGatilho((trx) =>
        sql`update sessao_checkout set estado = ${estado},
            actualizado_em = now() - make_interval(days => ${mudou}),
            expira_em = now() - make_interval(days => ${expirou})
          where id = ${sessao.slice(4)}::uuid`.execute(trx),
      );
    const abandonada8 = await nova();
    await envelhecer(abandonada8, "abandonada", 8, 7);
    const expirada8 = await nova();
    await envelhecer(expirada8, "expirada", 8, 8);
    // Aberta esquecida: expirou há 8 dias, mexida ontem não conta.
    const aberta8 = await nova();
    await envelhecer(aberta8, "aberta", 1, 8);
    // Expirada há 8 dias, mas só passou a «expirada» ontem (o cliente voltou
    // ao token): conta desde que expirou.
    const expiradaTarde = await nova();
    await envelhecer(expiradaTarde, "expirada", 1, 8);
    const expirada6 = await nova();
    await envelhecer(expirada6, "expirada", 6, 6);
    // Abandonada há 6 dias, antes de expirar: fica.
    const abandonada6 = await nova();
    await envelhecer(abandonada6, "abandonada", 6, -1);
    // Ainda aberta e por expirar: fica.
    const aberta = await nova();
    // Concluída antes desta migração, ainda com dados: limpa-se na volta.
    const k2 = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k2.token);
    await ok(
      botao(k2.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    await semGatilho((trx) =>
      sql`update sessao_checkout set email = 'rui@exemplo.pt', nome = 'Rui'
        where id = ${k2.sessao.slice(4)}::uuid`.execute(trx),
    );
    // Outro comerciante: a volta no contexto do primeiro não lhe toca.
    const s2 = await cenario();
    const doOutro = await nova(s2);
    await envelhecer(doOutro, "expirada", 8, 8);
    await comComerciante(base.api, s.c, async (trx) => {
      await sql`select set_config('eurolify.quem', 'sistema:checkout', true)`.execute(
        trx,
      );
      await sql`select checkout_sessoes_limpar(100)`.execute(trx);
    });
    expect((await pessoais(doOutro))?.["email"]).toBe("ana@exemplo.pt");
    expect(await pessoais(abandonada8)).toEqual(vazia);
    const volta = await correrLimpezaDasSessoes(base.api);
    expect(volta.falhas).toEqual([]);
    for (const x of [
      abandonada8,
      expirada8,
      aberta8,
      expiradaTarde,
      k2.sessao,
      doOutro,
    ]) {
      expect(await pessoais(x)).toEqual(vazia);
    }
    for (const x of [expirada6, abandonada6, aberta]) {
      expect((await pessoais(x))?.["email"]).toBe("ana@exemplo.pt");
    }
    // O estado e o resto da sessão não mudam.
    expect(
      (
        await sql<{ estado: string }>`select estado from sessao_checkout
          where id = ${aberta8.slice(4)}::uuid`.execute(base.dono)
      ).rows[0]?.estado,
    ).toBe("aberta");
    // Fora da função do dono, a API não abre uma sessão fechada.
    await expect(
      comComerciante(base.api, s.c, (trx) =>
        sql`update sessao_checkout set email = null
          where id = ${expirada6.slice(4)}::uuid`.execute(trx),
      ),
    ).rejects.toThrow(/checkout\.closed/);
    // Dois comerciantes, dez sessões e duas encomendas.
  }, 60_000);

  it("a verificação diária conta as sessões por limpar há mais de um dia (docs/23 §15.11, T3)", async () => {
    const atraso = () => contarComoLimpeza("checkout_sessoes_em_atraso");
    const s = await cenario();
    const s2 = await cenario();
    const nova = async (cen: Cenario) => {
      const x = await checkoutCom(cen, [[cen.v1, 1]]);
      await ok(
        pedir("PUT", `/checkout/${x.token}/contact`, {
          email: "ana@exemplo.pt",
          nome: "Ana",
        }),
      );
      return x;
    };
    /** Muda a sessão com o gatilho desligado (só o superutilizador do teste). */
    const mudar = (sessao: string, alteracao: string) =>
      base.dono.transaction().execute(async (trx) => {
        await sql`alter table sessao_checkout disable trigger sessao_checkout_antes_de_gravar`.execute(
          trx,
        );
        await sql`update sessao_checkout set ${sql.raw(alteracao)}
          where id = ${sessao.slice(4)}::uuid`.execute(trx);
        await sql`alter table sessao_checkout enable always trigger sessao_checkout_antes_de_gravar`.execute(
          trx,
        );
      });
    const antes = await atraso();
    // Expirada há 9 dias: a tarefa devia tê-la limpo há 2.
    await mudar(
      (await nova(s)).sessao,
      `estado = 'expirada', actualizado_em = now() - interval '9 days', expira_em = now() - interval '9 days'`,
    );
    // Aberta esquecida de outro comerciante, expirada há 9 dias.
    await mudar(
      (await nova(s2)).sessao,
      `estado = 'aberta', actualizado_em = now() - interval '1 day', expira_em = now() - interval '9 days'`,
    );
    // Expirada há 7 dias e meio: a tarefa já a limpa, mas está na folga.
    await mudar(
      (await nova(s)).sessao,
      `estado = 'expirada', actualizado_em = now() - interval '7 days 12 hours', expira_em = now() - interval '7 days 12 hours'`,
    );
    // Concluída há dois dias e ainda com dados (devia sair ao concluir).
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    await mudar(
      k.sessao,
      `email = 'rui@exemplo.pt', actualizado_em = now() - interval '2 days'`,
    );
    // Concluída há pouco, ainda com dados: a próxima volta limpa-a.
    const k2 = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k2.token);
    await ok(
      botao(k2.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    await mudar(k2.sessao, `email = 'rui@exemplo.pt'`);
    expect(await atraso()).toBe(antes + 3);
    // A tarefa corre (todos os comerciantes): nada fica atrasado.
    await correrLimpezaDasSessoes(base.api);
    expect(await atraso()).toBe(0);
    await expect(
      comComerciante(base.api, s.c, (trx) =>
        sql`select checkout_sessoes_em_atraso()`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  }, 60_000);

  it("a confirmação pelo token só nos 30 dias depois da encomenda", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    await ok(pedir("GET", `/checkout/${k.token}/confirmation`));
    // Envelhece a sessão concluída (o gatilho não deixa mudá-la: só o
    // superutilizador do teste, com o gatilho desligado nesta transacção).
    await base.dono.transaction().execute(async (trx) => {
      await sql`alter table sessao_checkout disable trigger sessao_checkout_antes_de_gravar`.execute(
        trx,
      );
      await sql`update sessao_checkout set concluida_em = now() - interval '31 days'
        where id = ${k.sessao.slice(4)}::uuid`.execute(trx);
      await sql`alter table sessao_checkout enable always trigger sessao_checkout_antes_de_gravar`.execute(
        trx,
      );
    });
    expect(
      await codigo(pedir("GET", `/checkout/${k.token}/confirmation`)),
    ).toEqual([410, "checkout.expired"]);
  });

  it("o apagamento a pedido do titular não toca no perfil que uma encomenda aponta, nem nas provas dele (revisão do #314, P1-1)", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    const encomenda = String(e["encomenda"]).slice(4);
    const resultado = await comComerciante(base.dono, s.c, async (trx) => {
      await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true)`.execute(
        trx,
      );
      const { rows } = await sql<{ cliente_id: string; perfil_id: string }>`
        select cliente_id, perfil_id from encomenda where id = ${encomenda}::uuid`.execute(
        trx,
      );
      const enc = rows[0];
      if (enc === undefined) throw new Error("sem encomenda");
      // Uma prova do VIES do perfil da encomenda, como a fila a escreve.
      await sql`insert into validacao_vies (comerciante_id, perfil_id, pais_consultado,
            numero_consultado, consultado_em, resultado, motivo, quem)
          values (${s.c}::uuid, ${enc.perfil_id}::uuid, 'FR', '40303265045',
            now(), 'valido', 'pedido', 'sistema:vies')`.execute(trx);
      const antes = (
        await sql<Json>`select nome_documento, nif_numero, morada_linha1, estado
          from perfil_faturacao where id = ${enc.perfil_id}::uuid`.execute(trx)
      ).rows[0];
      const r = (
        await sql<{
          r: Json;
        }>`select cliente_pseudonimizar(${enc.cliente_id}::uuid,
            ${`pseudonimizar cus_${enc.cliente_id}`}, 'teste') as r`.execute(
          trx,
        )
      ).rows[0]?.r;
      const depois = (
        await sql<Json>`select nome_documento, nif_numero, morada_linha1, estado
          from perfil_faturacao where id = ${enc.perfil_id}::uuid`.execute(trx)
      ).rows[0];
      const provas = (
        await sql<{ n: number }>`select count(*)::int as n from validacao_vies
          where perfil_id = ${enc.perfil_id}::uuid`.execute(trx)
      ).rows[0]?.n;
      return { antes, depois, r, provas };
    });
    expect(resultado.antes?.["nome_documento"]).not.toBe("Pseudonimizado");
    expect(resultado.depois).toEqual(resultado.antes);
    expect(resultado.provas).toBe(1);
    expect(resultado.r).toMatchObject({
      perfis_pseudonimizados: 0,
      perfis_mantidos_por_obrigacao_fiscal: 1,
      provas_vies_apagadas: 0,
      encomendas_com_dados_por_tratar: 1,
    });
  });

  /** Uma encomenda por pagar, criada pelo botão; devolve os ids. */
  async function porPagar(s: Awaited<ReturnType<typeof cenario>>) {
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    const id = String(e["encomenda"]).slice(4);
    const { rows } = await sql<{ cliente_id: string; perfil_id: string }>`
      select cliente_id, perfil_id from encomenda where id = ${id}::uuid`.execute(
      base.dono,
    );
    const enc = rows[0];
    if (enc === undefined) throw new Error("sem encomenda");
    return { id, ...enc };
  }
  /** Cancela sem pagamento, com um motivo escrito por uma pessoa. */
  const cancelar = (c: string, id: string) =>
    comComerciante(base.dono, c, async (trx) => {
      await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true),
        set_config('eurolify.motivo', 'a Ana Silva pediu por telefone', true)`.execute(
        trx,
      );
      await sql`update encomenda set estado = 'cancelada_sem_pagamento'
        where id = ${id}::uuid`.execute(trx);
    });
  const pseudonimizar = (c: string, cliente: string) =>
    comComerciante(base.dono, c, async (trx) => {
      await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true)`.execute(
        trx,
      );
      return (
        await sql<{ r: Json }>`select cliente_pseudonimizar(${cliente}::uuid,
          ${`pseudonimizar cus_${cliente}`}, 'teste') as r`.execute(trx)
      ).rows[0]?.r;
    });
  const encomendaNaBase = async (id: string) =>
    (
      await sql<{
        contacto: Json;
        entrega: Json;
        perfil_copia: Json;
      }>`select contacto, entrega, perfil_copia from encomenda
        where id = ${id}::uuid`.execute(base.dono)
    ).rows[0];
  const P = "(pseudonimizado)";

  it("o apagamento limpa uma encomenda acabada e o perfil dela, se não houve nada fiscal (docs/23 §15, Q2)", async () => {
    const s = await cenario();
    const enc = await porPagar(s);
    const antes = await encomendaNaBase(enc.id);
    await cancelar(s.c, enc.id);
    const r = await pseudonimizar(s.c, enc.cliente_id);
    expect(r).toMatchObject({
      perfis_pseudonimizados: 1,
      perfis_mantidos_por_obrigacao_fiscal: 0,
      encomendas_limpas: 1,
      encomendas_com_dados_fiscais_mantidos: 0,
      encomendas_por_acabar: 0,
      encomendas_com_dados_por_tratar: 0,
    });
    const depois = await encomendaNaBase(enc.id);
    // O contacto todo; a morada sem a casa, com o país (o IVA depende dele).
    for (const v of Object.values(depois?.contacto ?? {})) {
      expect([P, null]).toContain(v);
    }
    expect(depois?.entrega).toMatchObject({
      linha1: P,
      codigo_postal: P,
      localidade: P,
      pais: antes?.entrega["pais"],
    });
    // Sem nada fiscal (cancelada sem pagamento), a cópia do perfil também.
    expect(depois?.perfil_copia).toMatchObject({
      nome_documento: P,
      tipo: antes?.perfil_copia["tipo"],
    });
    // O motivo escrito na transição.
    const motivos = (
      await sql<{
        motivo: string | null;
      }>`select motivo from transicao_encomenda
        where encomenda_id = ${enc.id}::uuid and motivo is not null`.execute(
        base.dono,
      )
    ).rows.map((x) => x.motivo);
    expect(motivos.length).toBeGreaterThan(0);
    expect(new Set(motivos)).toEqual(new Set([P]));
    // A sessão de checkout da encomenda fica vazia (revisão do #374, P2-1).
    expect(
      (
        await sql<Json>`select s.email, s.nome, s.telefone from sessao_checkout s
          join encomenda e on e.sessao_id = s.id
          where e.id = ${enc.id}::uuid`.execute(base.dono)
      ).rows[0],
    ).toEqual({ email: null, nome: null, telefone: null });
  });

  it("uma encomenda em curso fica na fila e limpa-se quando acabar (Q1)", async () => {
    const s = await cenario();
    const enc = await porPagar(s);
    const antes = await encomendaNaBase(enc.id);
    const r = await pseudonimizar(s.c, enc.cliente_id);
    expect(r).toMatchObject({
      encomendas_limpas: 0,
      encomendas_por_acabar: 1,
      encomendas_com_dados_por_tratar: 1,
      // A encomenda por pagar ainda pode ser paga: o perfil fica.
      perfis_mantidos_por_obrigacao_fiscal: 1,
    });
    expect(await encomendaNaBase(enc.id)).toEqual(antes);
    // A lista dos pedidos diz quantas faltam.
    const lista = await ok(
      s.adm("GET", `/customers/cus_${enc.cliente_id}/privacy-requests`),
    );
    expect(lista["dados"]).toEqual([
      expect.objectContaining({ tipo: "apagamento", encomendas_por_acabar: 1 }),
    ]);
    // A tarefa não lhe toca enquanto não acabar.
    await correrApagamentosPendentes(base.api);
    expect(await encomendaNaBase(enc.id)).toEqual(antes);
    await cancelar(s.c, enc.id);
    const volta = await correrApagamentosPendentes(base.api);
    expect(volta.limpas).toBeGreaterThanOrEqual(1);
    expect(volta.falhas).toEqual([]);
    expect((await encomendaNaBase(enc.id))?.entrega["linha1"]).toBe(P);
    // Cancelada sem pagamento, larga o perfil: limpa-se também (Q2; revisão
    // do #374, P2-2).
    expect(
      (
        await sql<{ nome_documento: string; estado: string }>`
          select nome_documento, estado from perfil_faturacao
          where id = ${enc.perfil_id}::uuid`.execute(base.dono)
      ).rows[0],
    ).toEqual({ nome_documento: "Pseudonimizado", estado: "arquivado" });
    const depois = await ok(
      s.adm("GET", `/customers/cus_${enc.cliente_id}/privacy-requests`),
    );
    expect(depois["dados"]).toEqual([
      expect.objectContaining({ encomendas_por_acabar: 0 }),
    ]);
    // Aplicada uma vez: não se repete nem se apaga.
    await expect(
      sql`delete from titular_pendente where encomenda_id = ${enc.id}::uuid`.execute(
        base.dono,
      ),
    ).rejects.toThrow(/append_only/);
  });

  it("a verificação diária conta as encomendas da fila acabadas há mais de um dia por limpar (docs/23 §15.11, T2)", async () => {
    const atraso = () => contarComoLimpeza("titular_pendentes_em_atraso");
    const s = await cenario();
    const enc = await porPagar(s);
    await pseudonimizar(s.c, enc.cliente_id);
    const antes = await atraso();
    // Na fila há dois dias (o gatilho só deixa marcá-la como aplicada).
    await base.dono.transaction().execute(async (trx) => {
      await sql`alter table titular_pendente disable trigger titular_pendente_antes_de_gravar`.execute(
        trx,
      );
      await sql`update titular_pendente set criado_em = now() - interval '2 days'
        where encomenda_id = ${enc.id}::uuid`.execute(trx);
      await sql`alter table titular_pendente enable always trigger titular_pendente_antes_de_gravar`.execute(
        trx,
      );
    });
    // Ainda em curso: espera, não está atrasada.
    expect(await atraso()).toBe(antes);
    // Acabou e a tarefa não correu: conta.
    await cancelar(s.c, enc.id);
    expect(await atraso()).toBe(antes + 1);
    // A tarefa corre: deixa de contar.
    await correrApagamentosPendentes(base.api);
    expect(await atraso()).toBe(0);
    // A API não a chama (só a verificação da VPS).
    await expect(
      comComerciante(base.api, s.c, (trx) =>
        sql`select titular_pendentes_em_atraso()`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("depois do apagamento, a cópia fiscal da encomenda só sai ao dono (docs/23 §15.13, EN)", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    const ord = String(e["encomenda"]);
    // Antes do pedido, quem lê encomendas vê a cópia, como hoje.
    const antes = await ok(s.adm("GET", `/orders/${ord}`));
    expect(antes["perfil_copia"]).not.toBeNull();
    expect(antes["guardado_por_obrigacao_fiscal"]).toBe(false);
    const nome = String((antes["perfil_copia"] as Json)["nome_documento"]);
    const { rows } = await sql<{ cliente_id: string }>`
      select cliente_id from encomenda where id = ${ord.slice(4)}::uuid`.execute(
      base.dono,
    );
    // Em curso (por pagar): a encomenda fica na fila e a cópia fica inteira.
    await pseudonimizar(s.c, String(rows[0]?.cliente_id));
    // O gestor e o apoio (orders:read, sem customers:billing): sem a cópia.
    const gestor = await s.adm("GET", `/orders/${ord}`);
    expect(gestor.statusCode, gestor.body).toBe(200);
    // O contacto e a entrega de uma encomenda em curso ficam (a entrega
    // precisa deles); só a cópia fiscal sai.
    expect(gestor.json<Json>()).toMatchObject({
      perfil_copia: null,
      guardado_por_obrigacao_fiscal: true,
    });
    // A confirmação pública (o token) também não a mostra.
    const publica = await pedir("GET", `/checkout/${k.token}/confirmation`);
    expect(publica.statusCode, publica.body).toBe(200);
    expect(publica.json<Json>()["perfil_copia"]).toBeNull();
    // O dono (customers:billing) lê-a.
    const dono = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Dono com faturação",
        ambitos: ["orders:read", "customers:billing"],
      })
    ).segredo;
    const doDono = await ok(
      pedir("GET", `/orders/${ord}`, undefined, {
        authorization: `Bearer ${dono}`,
      }),
    );
    expect((doDono["perfil_copia"] as Json)["nome_documento"]).toBe(nome);
  });

  it("com a marca, só as colunas pessoais abrem; sem ela, nada (revisão do #374, P2-5)", async () => {
    const s = await cenario();
    const enc = await porPagar(s);
    await cancelar(s.c, enc.id);
    const comMarca = (alteracao: string) =>
      comComerciante(base.dono, s.c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true)`.execute(
          trx,
        );
        // Como a função do dono: com o papel dono das tabelas (o
        // superutilizador não serve, 0049).
        const { rows } = await sql<{
          dono: string;
        }>`select pg_get_userbyid(relowner) as dono
          from pg_class where oid = 'public.encomenda'::regclass`.execute(trx);
        await sql.raw(`set local role ${String(rows[0]?.dono)}`).execute(trx);
        await sql`insert into pseudonimizacao_em_curso values (pg_current_xact_id())`.execute(
          trx,
        );
        await sql.raw(alteracao).execute(trx);
      });
    // O contacto abre (só a 0072 o deixa).
    await comMarca(
      `update encomenda set contacto = '{"email": "(pseudonimizado)"}'::jsonb where id = '${enc.id}'`,
    );
    // O total e a lista de outras colunas não.
    await expect(
      comMarca(`update encomenda set total = total + 1 where id = '${enc.id}'`),
    ).rejects.toThrow(/orders.immutable/);
    await expect(
      comMarca(
        `update encomenda set contacto = '{}'::jsonb, lingua = 'en' where id = '${enc.id}'`,
      ),
    ).rejects.toThrow(/orders.immutable/);
  });

  it("fora da função do dono, as colunas continuam fechadas, também ao dono e com a marca na API", async () => {
    const s = await cenario();
    const enc = await porPagar(s);
    await cancelar(s.c, enc.id);
    // O dono, sem a marca.
    await expect(
      comComerciante(base.dono, s.c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true)`.execute(
          trx,
        );
        await sql`update encomenda set contacto = '{}'::jsonb
          where id = ${enc.id}::uuid`.execute(trx);
      }),
    ).rejects.toThrow(/orders.immutable/);
    // A API não põe a marca nem chama a limpeza.
    await expect(
      comComerciante(base.api, s.c, (trx) =>
        sql`insert into pseudonimizacao_em_curso values (pg_current_xact_id())`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      comComerciante(base.api, s.c, (trx) =>
        sql`select titular_limpar_encomenda(${enc.id}::uuid)`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    // Uma transição com o motivo trocado por outro texto: recusada mesmo
    // com a marca (só o marcador passa).
    await expect(
      comComerciante(base.dono, s.c, async (trx) => {
        await sql`insert into pseudonimizacao_em_curso values (pg_current_xact_id())`.execute(
          trx,
        );
        await sql`update transicao_encomenda set motivo = 'outro texto'
          where encomenda_id = ${enc.id}::uuid`.execute(trx);
      }),
    ).rejects.toThrow(/append_only/);
  });

  it("a base garante a encomenda: linhas só ao criá-la, e os totais batem com as linhas e os portes", async () => {
    const s = await cenario();
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    const e = await ok(
      botao(k.token, { aceita_condicoes: true, versoes: s.versoes }),
      201,
    );
    const id = String(e["encomenda"]).slice(4);
    // Uma linha acrescentada depois: recusada.
    await expect(
      comComerciante(base.dono, s.c, (trx) =>
        sql`insert into linha_encomenda (comerciante_id, encomenda_id, posicao,
              variante_id, sku, nome, quantidade, preco_unitario, preco,
              decisao_iva, base, iva, total)
            select comerciante_id, encomenda_id, 2, variante_id, sku, nome,
              quantidade, preco_unitario, preco, decisao_iva, base, iva, total
            from linha_encomenda where encomenda_id = ${id}::uuid`.execute(trx),
      ),
    ).rejects.toThrow(/orders.immutable/);
    // Uma encomenda com totais que não batem (sem linhas): recusada no fim
    // da transacção.
    const outra = await checkoutCom(s, [[s.v1, 1]]);
    await expect(
      comComerciante(base.dono, s.c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await sql`insert into encomenda (comerciante_id, loja_id, canal_id,
              mercado_id, entidade_legal_id, sessao_id, cliente_id, perfil_id,
              perfil_copia, contacto, entrega, finalidade, moeda,
              preco_inclui_iva, lingua, total_base, total_iva, total, portes,
              metodo_entrega, metodo_pagamento, aceitacoes, criada_por)
            select comerciante_id, loja_id, canal_id, mercado_id,
              entidade_legal_id, ${outra.sessao.slice(4)}::uuid, cliente_id,
              perfil_id, perfil_copia, contacto, entrega, finalidade, moeda,
              preco_inclui_iva, lingua, total_base, total_iva, total, portes,
              metodo_entrega, metodo_pagamento, aceitacoes, criada_por
            from encomenda where id = ${id}::uuid`.execute(trx);
      }),
    ).rejects.toThrow(/orders.totals_mismatch/);
    // Mesmo com os totais iguais só aos portes, sem linhas não há encomenda.
    await expect(
      comComerciante(base.dono, s.c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:teste', true)`.execute(
          trx,
        );
        await sql`insert into encomenda (comerciante_id, loja_id, canal_id,
              mercado_id, entidade_legal_id, sessao_id, cliente_id, perfil_id,
              perfil_copia, contacto, entrega, finalidade, moeda,
              preco_inclui_iva, lingua, total_base, total_iva, total, portes,
              metodo_entrega, metodo_pagamento, aceitacoes, criada_por)
            select comerciante_id, loja_id, canal_id, mercado_id,
              entidade_legal_id, ${outra.sessao.slice(4)}::uuid, cliente_id,
              perfil_id, perfil_copia, contacto, entrega, finalidade, moeda,
              preco_inclui_iva, lingua, (portes->>'base')::bigint,
              (portes->>'iva')::bigint,
              (portes->>'base')::bigint + (portes->>'iva')::bigint, portes,
              metodo_entrega, metodo_pagamento, aceitacoes, criada_por
            from encomenda where id = ${id}::uuid`.execute(trx);
      }),
    ).rejects.toThrow(/orders.totals_mismatch/);
  });

  it("o endereço do checkout sai dos registos sem o token", () => {
    const token = "a".repeat(43);
    expect(urlSemSegredos(`/checkout/${token}/summary?x=1`)).toBe(
      "/checkout/[token]/summary?x=1",
    );
    expect(urlSemSegredos("/store/carts/crt_1")).toBe("/store/carts/crt_1");
  });

  it("as rotas da loja têm limite por IP", async () => {
    const s = await cenario();
    const pequena = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      undefined,
      undefined,
      { pedidos: 2, janelaMs: 60_000 },
    );
    try {
      const estados: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const r = await pequena.inject({
          method: "GET",
          url: `/store/carts/crt_${randomUUID()}`,
          headers: {
            authorization: `Bearer ${s.publica}`,
            "x-cart-secret": "x".repeat(43),
          },
        });
        estados.push(r.statusCode);
      }
      expect(estados.slice(0, 2)).not.toContain(429);
      expect(estados[2]).toBe(429);
      // As rotas de Administração não contam para o limite da loja.
      const adm = await pequena.inject({
        method: "GET",
        url: "/legal-texts",
        headers: { authorization: `Bearer ${s.servidor}` },
      });
      expect(adm.statusCode).toBe(200);
    } finally {
      await pequena.close();
    }
  });
  it("a morada noutro país muda a sessão para o mercado do canal que o serve (e larga o método de entrega); a base não deixa dois mercados com o país", async () => {
    const s = await cenario();
    const espanha = async (nome: string) => {
      const m = await criarMercado(base.api, s.c, {
        loja_id: s.loja,
        nome,
        paises: ["ES"],
        moeda: "EUR",
        linguas: ["pt", "es"],
        lingua_principal: "es",
      });
      await criarLista(base.api, s.c, {
        mercado_id: m,
        nome: `Base ${nome}`,
        tipo: "base",
      });
      await mudarEstadoMercado(base.api, s.c, m, 1, "activo");
      return m;
    };
    const es = await espanha("Espanha");
    await definirMercadosDoCanal(base.api, s.c, s.canal, [s.mercado, es]);
    const k = await checkoutCom(s, [[s.v1, 1]]);
    await preencher(s, k.token);
    await ok(
      pedir("PUT", `/checkout/${k.token}/delivery`, {
        pais: "ES",
        codigo_postal: "28001",
        linha1: "Calle 1",
        localidade: "Madrid",
      }),
    );
    expect(await ok(pedir("GET", `/checkout/${k.token}`))).toMatchObject({
      mercado: `mkt_${es}`,
      metodo_entrega: null,
    });
    // Um segundo mercado activo com Espanha na mesma loja: a base recusa-o
    // (a escolha do mercado pelo país nunca é ambígua).
    await expect(espanha("Espanha 2")).rejects.toThrow(
      /country_in_other_market/,
    );
  });
});
