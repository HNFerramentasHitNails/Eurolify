import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  classificarArtigo,
  criarArtigo,
  definirComponentes,
  mudarEstadoArtigo,
} from "../src/catalogo/repositorio.js";
import { publicar } from "../src/catalogo/publicacao.js";
import {
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { dataLimite, porQueNaoServe } from "../src/checkout/entrega.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  definirPreco,
  mudarEstadoMercado,
} from "../src/precos/repositorio.js";
import { TIPOS_TEXTO_LEGAL } from "../src/base/esquema.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import { eupagoFalso } from "./eupago-falso.js";
import { transportadoraFalsa } from "./transportadora-falsa.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Os envios, parte A (docs/36; migração 0074): as contas de transportadora
// (credenciais cifradas que nunca saem, pronta só depois do teste, só o
// dono), o método de entrega com conta e serviço, e o que decide se um
// método serve (zona, perigosos, peso, conta pronta) com a data-limite. A
// transportadora é falsa: um adaptador de ensaio com o contrato do docs/36 §8.

type Json = Record<string, unknown>;
const QUEM = "pessoa:teste";

describe.skipIf(URL_BASE === undefined)("API dos envios (parte A)", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let semChave: ReturnType<typeof criarApp>;
  const eupago = eupagoFalso();
  const ctt = transportadoraFalsa().adaptador;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    const comum = [
      { logger: false },
      undefined,
      base.api,
      undefined,
      undefined,
      undefined,
      { pedidos: 100_000, janelaMs: 60_000 },
      eupago.config,
      undefined,
    ] as const;
    app = criarApp(...comum, {
      chave: chavePagamentos(randomBytes(32).toString("base64")),
      adaptadores: { ctt },
    });
    // Sem ENVIOS_CHAVE: as credenciais não se definem.
    semChave = criarApp(...comum, { adaptadores: { ctt } });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await semChave.close();
    await base.fechar();
  });

  const pedirEm =
    (a: ReturnType<typeof criarApp>) =>
    (
      metodo: "POST" | "PUT" | "GET" | "PATCH",
      url: string,
      corpo?: unknown,
      cabecalhos: Record<string, string> = {},
    ) =>
      a.inject({
        method: metodo,
        url,
        headers: {
          ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
          ...(corpo === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...cabecalhos,
        },
        ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
      });
  const pedir = (...a: Parameters<ReturnType<typeof pedirEm>>) =>
    pedirEm(app)(...a);
  type Resposta = Awaited<ReturnType<typeof pedir>>;
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

  const REMETENTE = {
    nome: "Armazém",
    linha1: "Rua 1",
    codigo_postal: "1000-001",
    localidade: "Lisboa",
    pais: "PT",
  };

  /**
   * Um comerciante português com o mercado Portugal, um artigo com duas
   * variantes de 30 g publicadas, os textos legais, 100 unidades de cada, a
   * régua dos pagamentos e uma chave do dono com todos os âmbitos.
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
    await definirPreco(base.api, c, QUEM, lista, v2, { montante: 615 });
    expect(
      (
        await publicar(base.api, c, QUEM, {
          artigo_id: artigo,
          canal_id: canal,
          mercado_id: mercado,
        })
      ).publicada,
    ).toBe(true);
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
          "legal:read",
          "legal:write",
          "shipping:read",
          "shipping:write",
          "shipping:accounts",
          "orders:read",
          "payments:read",
          "payments:write",
          "payments:accounts",
          "inventory:read",
          "inventory:write",
        ],
      })
    ).segredo;
    const adm = (
      m: "POST" | "GET" | "PATCH" | "PUT",
      url: string,
      corpo?: unknown,
      a = app,
    ) => pedirEm(a)(m, url, corpo, { authorization: `Bearer ${servidor}` });
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
    }
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
    const contaPag = await ok(
      adm("POST", "/payment-accounts", { prestador: "eupago", nome: "P" }),
      201,
    );
    await ok(
      adm("PUT", `/payment-accounts/${String(contaPag["id"])}/credentials`, {
        chave: "xxxx-xxxx-xxxx-xxxx",
        segredo_aviso: "segredo-dos-avisos-123",
      }),
      204,
    );
    await ok(adm("POST", `/payment-accounts/${String(contaPag["id"])}/test`));
    await ok(
      adm("POST", "/payment-methods", {
        mercado: `mkt_${mercado}`,
        metodo: "multibanco",
        conta: contaPag["id"],
      }),
      201,
    );
    return { c, loja, mercado, lista, canal, v1, v2, publica, servidor, adm };
  }
  type Cenario = Awaited<ReturnType<typeof cenario>>;

  /** Uma conta dos CTT pronta (credenciais e teste). */
  async function contaPronta(s: Cenario) {
    const conta = await ok(
      s.adm("POST", "/carrier-accounts", {
        transportadora: "ctt",
        nome: "CTT da loja",
        remetente: REMETENTE,
      }),
      201,
    );
    const id = String(conta["id"]);
    await ok(
      s.adm("PUT", `/carrier-accounts/${id}/credentials`, {
        credenciais: { chave: "chave-boa-123" },
      }),
      204,
    );
    await ok(s.adm("POST", `/carrier-accounts/${id}/test`));
    return id;
  }

  /** Um carrinho com as linhas, o checkout aberto e o contacto e a morada dados. */
  async function checkoutCom(
    s: Cenario,
    linhas: [string, number][],
    codigoPostal = "1000-001",
  ) {
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
    const token = String(sessao["token"]);
    await ok(
      pedir("PUT", `/checkout/${token}/contact`, {
        email: "rui@exemplo.pt",
        nome: "Rui",
      }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/delivery`, {
        pais: "PT",
        codigo_postal: codigoPostal,
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
      pedir("PUT", `/checkout/${token}/payment-method`, {
        metodo: "multibanco",
      }),
    );
    return token;
  }

  const metodo = async (s: Cenario, campos: Json) =>
    String(
      (
        await ok(
          s.adm("POST", "/shipping-methods", {
            mercado: `mkt_${s.mercado}`,
            nome: { pt: "Correio" },
            tarifa: 499,
            ...campos,
          }),
          201,
        )
      )["id"],
    );

  it("a conta: as credenciais cifradas nunca saem, só fica pronta com o teste, e só o dono a liga", async () => {
    const s = await cenario();
    const conta = await ok(
      s.adm("POST", "/carrier-accounts", {
        transportadora: "ctt",
        nome: "CTT da loja",
        remetente: REMETENTE,
      }),
      201,
    );
    const id = String(conta["id"]);
    expect(id).toMatch(/^cac_/);
    // Sem a chave do servidor (ENVIOS_CHAVE), as credenciais não se guardam.
    expect(
      await codigo(
        s.adm(
          "PUT",
          `/carrier-accounts/${id}/credentials`,
          { credenciais: { chave: "chave-boa-123" } },
          semChave,
        ),
      ),
    ).toEqual([503, "shipping.not_configured"]);
    // Sem credenciais, o teste não corre.
    expect(await codigo(s.adm("POST", `/carrier-accounts/${id}/test`))).toEqual(
      [422, "shipping.account_not_ready"],
    );
    // Recusadas pela transportadora: continua em rascunho.
    await ok(
      s.adm("PUT", `/carrier-accounts/${id}/credentials`, {
        credenciais: { chave: "ma" },
      }),
      204,
    );
    expect(await codigo(s.adm("POST", `/carrier-accounts/${id}/test`))).toEqual(
      [422, "shipping.account_not_ready"],
    );
    await ok(
      s.adm("PUT", `/carrier-accounts/${id}/credentials`, {
        credenciais: { chave: "chave-boa-123" },
        segredo_aviso: "segredo-dos-avisos-123",
      }),
      204,
    );
    await ok(s.adm("POST", `/carrier-accounts/${id}/test`));
    const lidas = await ok(s.adm("GET", "/carrier-accounts"));
    const lida = (lidas["dados"] as Json[])[0] as Json;
    expect(lida).toMatchObject({
      id,
      transportadora: "ctt",
      modo: "teste",
      estado: "pronta",
      remetente: REMETENTE,
    });
    expect(JSON.stringify(lidas)).not.toContain("chave-boa-123");
    expect(JSON.stringify(lidas)).not.toContain("segredo-dos-avisos");
    // Na base, cifradas: a chave não aparece em claro.
    const { rows } = await sql<{
      c: Buffer;
    }>`select credenciais_cifra as c from conta_transportadora
        where comerciante_id = ${s.c}::uuid`.execute(base.dono);
    expect(rows[0]?.c.toString("utf8")).not.toContain("chave-boa-123");
    // Mudar as credenciais devolve a conta a rascunho.
    await ok(
      s.adm("PUT", `/carrier-accounts/${id}/credentials`, {
        credenciais: { chave: "chave-boa-123" },
      }),
      204,
    );
    const depois = await ok(s.adm("GET", "/carrier-accounts"));
    expect((depois["dados"] as Json[])[0]).toMatchObject({
      estado: "rascunho",
    });
    // Os serviços que o adaptador declara.
    const servicos = await ok(s.adm("GET", `/carrier-accounts/${id}/services`));
    expect((servicos["dados"] as Json[]).map((x) => x["codigo"])).toEqual([
      "EXPRESSO_48",
      "COM_TELEFONE",
      "SO_ESPANHA",
    ]);
    // O gestor não liga contas (shipping:accounts é só do dono).
    const gestor = (
      await criarChave(base.dono, s.c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Gestor",
        ambitos: ["shipping:read", "shipping:write"],
      })
    ).segredo;
    expect(
      await codigo(
        pedir(
          "POST",
          "/carrier-accounts",
          { transportadora: "ctt", nome: "Outra", remetente: REMETENTE },
          { authorization: `Bearer ${gestor}` },
        ),
      ),
    ).toEqual([403, "auth.forbidden"]);
    // O dono tem o âmbito pelo papel; o gestor não (papel_ambitos, 0074).
    const papeis = (
      await sql<{
        papel: string;
        tem: boolean;
      }>`select p as papel, 'shipping:accounts' = any (papel_ambitos(p)) as tem
          from unnest(array['dono', 'gestor', 'armazem', 'apoio']) as p`.execute(
        base.dono,
      )
    ).rows;
    expect(papeis.filter((p) => p.tem).map((p) => p.papel)).toEqual(["dono"]);
  });

  it("o método com conta: só uma conta pronta, um serviço que a transportadora tem, nos países do mercado, com os ONU e o telefone que o serviço aceita", async () => {
    const s = await cenario();
    const rascunho = String(
      (
        await ok(
          s.adm("POST", "/carrier-accounts", {
            transportadora: "ctt",
            nome: "Rascunho",
            remetente: REMETENTE,
          }),
          201,
        )
      )["id"],
    );
    const pronta = await contaPronta(s);
    const criar = (campos: Json) =>
      codigo(
        s.adm("POST", "/shipping-methods", {
          mercado: `mkt_${s.mercado}`,
          nome: { pt: "CTT" },
          tarifa: 499,
          ...campos,
        }),
      );
    expect(await criar({ conta: rascunho, servico: "EXPRESSO_48" })).toEqual([
      422,
      "shipping.account_not_ready",
    ]);
    expect(await criar({ conta: pronta, servico: "NAO_EXISTE" })).toEqual([
      422,
      "shipping.service_unknown",
    ]);
    expect(await criar({ conta: pronta })).toEqual([
      400,
      "shipping.invalid_field",
    ]);
    // O serviço não entrega em Portugal (o mercado).
    expect(await criar({ conta: pronta, servico: "SO_ESPANHA" })).toEqual([
      400,
      "shipping.invalid_field",
    ]);
    // Um ONU que o serviço não aceita.
    expect(
      await criar({
        conta: pronta,
        servico: "EXPRESSO_48",
        aceita_onu: ["UN1993"],
      }),
    ).toEqual([400, "shipping.invalid_field"]);
    // Mais pesado do que o serviço.
    expect(
      await criar({
        conta: pronta,
        servico: "EXPRESSO_48",
        peso_max_g: 31_000,
      }),
    ).toEqual([400, "shipping.invalid_field"]);
    // O serviço pede telefone: o método também.
    expect(await criar({ conta: pronta, servico: "COM_TELEFONE" })).toEqual([
      400,
      "shipping.invalid_field",
    ]);
    const id = await metodo(s, {
      conta: pronta,
      servico: "EXPRESSO_48",
      aceita_onu: ["UN1266"],
      codigos_postais: ["1000", "2"],
      prazo_max_dias: 5,
    });
    const lido = (
      (await ok(s.adm("GET", "/shipping-methods")))["dados"] as Json[]
    ).find((m) => m["id"] === id);
    // Sem peso máximo dado, fica o do serviço.
    expect(lido).toMatchObject({
      conta: pronta,
      servico: "EXPRESSO_48",
      prazo_max_dias: 5,
      codigos_postais: ["1000", "2"],
      aceita_onu: ["UN1266"],
      peso_max_g: 30_000,
    });
    // Um prazo acima de 30 dias recusa-se (L4).
    expect(
      await codigo(
        s.adm("PATCH", `/shipping-methods/${id}`, {
          versao: lido?.["versao"],
          prazo_max_dias: 31,
        }),
      ),
    ).toEqual([400, "request.invalid"]);
    // Arquivar a conta com um método activo a usá-la não se faz.
    const contas = (await ok(s.adm("GET", "/carrier-accounts")))[
      "dados"
    ] as Json[];
    const versao = contas.find((x) => x["id"] === pronta)?.["versao"];
    expect(
      await codigo(
        s.adm("PATCH", `/carrier-accounts/${pronta}`, {
          versao,
          arquivar: true,
        }),
      ),
    ).toEqual([409, "shipping.immutable"]);
    // A conta de outro comerciante não existe para este.
    const outro = await cenario();
    expect(
      await codigo(
        outro.adm("POST", "/shipping-methods", {
          mercado: `mkt_${outro.mercado}`,
          nome: { pt: "CTT" },
          tarifa: 499,
          conta: pronta,
          servico: "EXPRESSO_48",
        }),
      ),
    ).toEqual([404, "shipping.not_found"]);
    expect(
      ((await ok(outro.adm("GET", "/carrier-accounts")))["dados"] as Json[])
        .length,
    ).toBe(0);
  });

  it("a zona: um método que não serve o código postal aparece com o porquê, não se escolhe e trava o botão final se a morada mudar depois", async () => {
    const s = await cenario();
    const continente = await metodo(s, {
      nome: { pt: "Continente" },
      codigos_postais: ["1", "2", "3", "4", "5", "6", "7", "8"],
    });
    const ilhas = await metodo(s, {
      nome: { pt: "Ilhas" },
      tarifa: 999,
      codigos_postais: ["9"],
    });
    const token = await checkoutCom(s, [[s.v1, 1]], "9500-123");
    const lista = (
      await ok(pedir("GET", `/checkout/${token}/delivery-methods`))
    )["dados"] as Json[];
    expect(lista.find((m) => m["id"] === continente)).toMatchObject({
      serve: false,
      motivo: "zona_nao_servida",
      codigos_postais: ["1", "2", "3", "4", "5", "6", "7", "8"],
    });
    expect(lista.find((m) => m["id"] === ilhas)).toMatchObject({
      serve: true,
      motivo: null,
    });
    expect(
      await codigo(
        pedir("PUT", `/checkout/${token}/delivery-method`, {
          metodo: continente,
        }),
      ),
    ).toEqual([422, "checkout.no_delivery_method"]);
    // Escolhe as ilhas; depois muda a morada para Lisboa: o resumo trava.
    await ok(
      pedir("PUT", `/checkout/${token}/delivery-method`, { metodo: ilhas }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/delivery`, {
        pais: "PT",
        codigo_postal: "1000-001",
        linha1: "Rua 2",
        localidade: "Lisboa",
      }),
    );
    const resumo = await ok(pedir("GET", `/checkout/${token}/summary`));
    expect(resumo["bloqueios"]).toContainEqual({
      onde: "metodo_entrega",
      motivo: "zona_nao_servida",
    });
    expect(
      await codigo(
        pedir("POST", `/checkout/${token}/place`, {
          aceita_condicoes: true,
          versoes: (resumo["textos"] as Json[]).map((t) => t["versao"]),
          impressao: resumo["impressao"],
        }),
      ),
    ).toEqual([422, "checkout.no_delivery_method"]);
  });

  it("perigosos e peso: um ONU que o método não aceita e um peso acima do máximo não servem; sem peso, na dúvida não vende", async () => {
    const s = await cenario();
    const leve = await metodo(s, { nome: { pt: "Leve" }, peso_max_g: 50 });
    const comOnu = await metodo(s, {
      nome: { pt: "Aceita UN1266" },
      aceita_onu: ["UN1266"],
    });
    // A variante 2 passa a perigosa (UN1266, produtos de perfumaria).
    await sql`update variante set onu = 'UN1266' where id = ${s.v2}::uuid`.execute(
      base.dono,
    );
    const lista = async (token: string) =>
      (await ok(pedir("GET", `/checkout/${token}/delivery-methods`)))[
        "dados"
      ] as Json[];
    // 2 × 30 g = 60 g > 50 g.
    const pesado = await checkoutCom(s, [[s.v1, 2]]);
    expect((await lista(pesado)).find((m) => m["id"] === leve)).toMatchObject({
      serve: false,
      motivo: "peso_excedido",
    });
    // Uma unidade cabe.
    const umaSo = await checkoutCom(s, [[s.v1, 1]]);
    expect((await lista(umaSo)).find((m) => m["id"] === leve)).toMatchObject({
      serve: true,
    });
    // O perigoso só pelo método que o aceita.
    const perigoso = await checkoutCom(s, [[s.v2, 1]]);
    const l = await lista(perigoso);
    expect(l.find((m) => m["id"] === leve)).toMatchObject({
      serve: false,
      motivo: "perigoso_recusado",
    });
    expect(l.find((m) => m["id"] === comOnu)).toMatchObject({ serve: true });
    // Sem peso conhecido e um método com peso máximo: não serve (na dúvida,
    // não vende). A base já não deixa publicar uma variante física sem peso
    // (docs/14, C2), por isso confere-se a regra directamente.
    const regras = {
      conta_transportadora_id: null,
      codigos_postais: [],
      aceita_onu: [],
      peso_max_g: 50,
      prazo_max_dias: 30,
    };
    expect(
      porQueNaoServe(regras, false, null, { pesoG: null, onu: new Set() }),
    ).toBe("peso_desconhecido");
    expect(
      porQueNaoServe({ ...regras, peso_max_g: null }, false, null, {
        pesoG: null,
        onu: new Set(),
      }),
    ).toBeNull();
  });

  it("a data-limite: no resumo, na encomenda com a conta e o serviço vendidos, e na confirmação sem a conta", async () => {
    const s = await cenario();
    const conta = await contaPronta(s);
    const id = await metodo(s, {
      conta,
      servico: "EXPRESSO_48",
      prazo_max_dias: 3,
    });
    const token = await checkoutCom(s, [[s.v1, 1]]);
    await ok(
      pedir("PUT", `/checkout/${token}/delivery-method`, { metodo: id }),
    );
    const resumo = await ok(pedir("GET", `/checkout/${token}/summary`));
    const esperada = dataLimite(new Date(), "Europe/Lisbon", 3);
    expect(resumo["portes"]).toMatchObject({ data_limite: esperada });
    const feita = await ok(
      pedir("POST", `/checkout/${token}/place`, {
        aceita_condicoes: true,
        versoes: (resumo["textos"] as Json[]).map((t) => t["versao"]),
        impressao: resumo["impressao"],
      }),
      201,
    );
    const enc = await ok(s.adm("GET", `/orders/${String(feita["encomenda"])}`));
    expect(enc["metodo_entrega"]).toMatchObject({
      data_limite: esperada,
      conta: conta.slice(4),
      servico: "EXPRESSO_48",
    });
    const confirmacao = await ok(
      pedir("GET", `/checkout/${token}/confirmation`),
    );
    expect(confirmacao["metodo_entrega"]).toEqual({
      id: id.slice(4),
      nome: { pt: "Correio" },
      data_limite: esperada,
    });
    // A data: o dia em Lisboa mais 3 (o prazo conta do dia seguinte).
    expect(
      dataLimite(new Date("2026-10-12T23:30:00Z"), "Europe/Lisbon", 3),
    ).toBe("2026-10-16");
    expect(
      dataLimite(new Date("2026-10-12T22:30:00Z"), "Europe/Lisbon", 30),
    ).toBe("2026-11-11");
  });

  it("uma conta que deixa de estar pronta tira o método do checkout (conta_indisponivel)", async () => {
    const s = await cenario();
    const conta = await contaPronta(s);
    const id = await metodo(s, { conta, servico: "EXPRESSO_48" });
    const token = await checkoutCom(s, [[s.v1, 1]]);
    await ok(
      pedir("PUT", `/checkout/${token}/delivery-method`, { metodo: id }),
    );
    // Credenciais novas: a conta volta a rascunho até ao teste.
    await ok(
      s.adm("PUT", `/carrier-accounts/${conta}/credentials`, {
        credenciais: { chave: "chave-boa-123" },
      }),
      204,
    );
    const resumo = await ok(pedir("GET", `/checkout/${token}/summary`));
    expect(resumo["bloqueios"]).toContainEqual({
      onde: "metodo_entrega",
      motivo: "conta_indisponivel",
    });
  });

  it("a data-limite entra no que o cliente viu: mudar o prazo entre o resumo e o botão final não faz a encomenda (revisão do #397, P1-1)", async () => {
    const s = await cenario();
    const id = await metodo(s, { prazo_max_dias: 3 });
    const token = await checkoutCom(s, [[s.v1, 1]]);
    await ok(
      pedir("PUT", `/checkout/${token}/delivery-method`, { metodo: id }),
    );
    const resumo = await ok(pedir("GET", `/checkout/${token}/summary`));
    const lido = (
      (await ok(s.adm("GET", "/shipping-methods")))["dados"] as Json[]
    ).find((m) => m["id"] === id);
    await ok(
      s.adm("PATCH", `/shipping-methods/${id}`, {
        versao: lido?.["versao"],
        prazo_max_dias: 30,
      }),
      204,
    );
    expect(
      await codigo(
        pedir("POST", `/checkout/${token}/place`, {
          aceita_condicoes: true,
          versoes: (resumo["textos"] as Json[]).map((t) => t["versao"]),
          impressao: resumo["impressao"],
        }),
      ),
    ).toEqual([409, "checkout.total_changed"]);
  });

  it("um kit pesa e leva os perigosos pelos componentes (revisão do #397, P2-3)", async () => {
    const s = await cenario();
    const artigo = await criarArtigo(
      base.api,
      s.c,
      { tipo: "fisico", nome: "Kit", categoria_fiscal: "normal" },
      // O peso do próprio kit (200 g) não conta: contam os componentes.
      [{ sku: "KIT-001", unidade_de_venda: "unidade", peso_g: 200 }],
    );
    const kit = (
      await comComerciante(base.api, s.c, (trx) =>
        trx
          .selectFrom("variante")
          .select("id")
          .where("artigo_id", "=", artigo)
          .executeTakeFirstOrThrow(),
      )
    ).id;
    // 2 × v1 (30 g) + 1 × v2 (30 g) = 90 g por kit.
    await definirComponentes(base.api, s.c, kit, [
      { varianteId: s.v1, quantidade: 2 },
      { varianteId: s.v2, quantidade: 1 },
    ]);
    await classificarArtigo(
      base.api,
      s.c,
      artigo,
      1,
      { familias: ["retalho_geral"], natureza_consumidor: "bem" },
      QUEM,
    );
    await mudarEstadoArtigo(base.api, s.c, artigo, 2, "activo");
    await definirPreco(base.api, s.c, QUEM, s.lista, kit, { montante: 2000 });
    await publicar(base.api, s.c, QUEM, {
      artigo_id: artigo,
      canal_id: s.canal,
      mercado_id: s.mercado,
    });
    const ate190 = await metodo(s, { nome: { pt: "190 g" }, peso_max_g: 190 });
    const ate170 = await metodo(s, { nome: { pt: "170 g" }, peso_max_g: 170 });
    const lista = async (token: string) =>
      (await ok(pedir("GET", `/checkout/${token}/delivery-methods`)))[
        "dados"
      ] as Json[];
    // Dois kits: 180 g pelos componentes (400 g pelo peso do kit).
    const dois = await lista(await checkoutCom(s, [[kit, 2]]));
    expect(dois.find((m) => m["id"] === ate190)).toMatchObject({ serve: true });
    expect(dois.find((m) => m["id"] === ate170)).toMatchObject({
      serve: false,
      motivo: "peso_excedido",
    });
    // Um componente perigoso faz o kit perigoso.
    await sql`update variante set onu = 'UN1266' where id = ${s.v2}::uuid`.execute(
      base.dono,
    );
    const perigoso = await lista(await checkoutCom(s, [[kit, 1]]));
    expect(perigoso.find((m) => m["id"] === ate190)).toMatchObject({
      serve: false,
      motivo: "perigoso_recusado",
    });
  });

  it("a conta: isolada por identificador, escrita optimista, arquivada não muda, o segredo dos avisos fica, e os erros não levam as credenciais (revisão do #397, P2-2 e P2-4)", async () => {
    const s = await cenario();
    const conta = await contaPronta(s);
    // O segredo dos avisos: definido, fica quando só se troca a chave.
    await ok(
      s.adm("PUT", `/carrier-accounts/${conta}/credentials`, {
        credenciais: { chave: "chave-boa-123" },
        segredo_aviso: "segredo-dos-avisos-123",
      }),
      204,
    );
    await ok(
      s.adm("PUT", `/carrier-accounts/${conta}/credentials`, {
        credenciais: { chave: "chave-boa-123" },
      }),
      204,
    );
    const segredo = async () =>
      (
        await sql<{
          tem: boolean;
        }>`select segredo_aviso_cifra is not null as tem from conta_transportadora
            where id = ${conta.slice(4)}::uuid`.execute(base.dono)
      ).rows[0]?.tem;
    expect(await segredo()).toBe(true);
    await ok(
      s.adm("PUT", `/carrier-accounts/${conta}/credentials`, {
        credenciais: { chave: "chave-boa-123" },
        segredo_aviso: null,
      }),
      204,
    );
    expect(await segredo()).toBe(false);
    // Credenciais recusadas: o erro não as repete.
    await ok(
      s.adm("PUT", `/carrier-accounts/${conta}/credentials`, {
        credenciais: { chave: "chave-ma-456" },
      }),
      204,
    );
    const recusa = await s.adm("POST", `/carrier-accounts/${conta}/test`);
    expect(recusa.statusCode).toBe(422);
    expect(recusa.body).not.toContain("chave-ma-456");
    // Outro comerciante não a vê nem lhe mexe.
    const outro = await cenario();
    for (const [m, url, corpo] of [
      ["PATCH", `/carrier-accounts/${conta}`, { versao: 1, nome: "X" }],
      [
        "PUT",
        `/carrier-accounts/${conta}/credentials`,
        { credenciais: { chave: "x" } },
      ],
      ["POST", `/carrier-accounts/${conta}/test`, undefined],
      ["GET", `/carrier-accounts/${conta}/services`, undefined],
    ] as const) {
      expect(await codigo(outro.adm(m, url, corpo)), url).toEqual([
        404,
        "shipping.not_found",
      ]);
    }
    // Escrita optimista: uma versão velha dá 409.
    const lida = (
      (await ok(s.adm("GET", "/carrier-accounts")))["dados"] as Json[]
    )[0] as Json;
    expect(
      await codigo(
        s.adm("PATCH", `/carrier-accounts/${conta}`, {
          versao: Number(lida["versao"]) - 1,
          nome: "Velha",
        }),
      ),
    ).toEqual([409, "shipping.version_conflict"]);
    // Arquivar (sem métodos a usá-la); depois não muda, nem pela base.
    await ok(
      s.adm("PATCH", `/carrier-accounts/${conta}`, {
        versao: lida["versao"],
        arquivar: true,
      }),
    );
    expect(
      await codigo(
        s.adm("PUT", `/carrier-accounts/${conta}/credentials`, {
          credenciais: { chave: "chave-boa-123" },
        }),
      ),
    ).toEqual([409, "shipping.immutable"]);
    await expect(
      comComerciante(base.dono, s.c, (trx) =>
        sql`update conta_transportadora set estado = 'pronta'`.execute(trx),
      ),
    ).rejects.toThrow(/shipping.immutable/);
    await expect(
      comComerciante(base.dono, s.c, (trx) =>
        sql`delete from conta_transportadora`.execute(trx),
      ),
    ).rejects.toThrow(/shipping.immutable/);
  });
});
