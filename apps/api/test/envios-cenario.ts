import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { criarApp } from "../src/app.js";
import { publicar } from "../src/catalogo/publicacao.js";
import {
  classificarArtigo,
  criarArtigo,
  mudarEstadoArtigo,
} from "../src/catalogo/repositorio.js";
import {
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { TIPOS_TEXTO_LEGAL } from "../src/base/esquema.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  definirPreco,
  mudarEstadoMercado,
} from "../src/precos/repositorio.js";
import type { BaseDeTeste } from "./base-de-teste.js";
import { assinar, avisoEuPago } from "./eupago-falso.js";
import { CHAVE_BOA } from "./transportadora-falsa.js";

// Um comerciante com uma encomenda paga e uma expedição criada, para os
// testes dos envios (parte B e o ecrã «Expedir» do Hub). A transportadora é
// a de ensaio (test/transportadora-falsa.ts) e o pagamento, a EuPago falsa.

type Json = Record<string, unknown>;
const QUEM = "pessoa:teste";
export const SEGREDO_PAGAMENTOS = "segredo-dos-avisos-123";
export const SEGREDO_ENVIOS = "segredo-da-transportadora-1";

export function cenariosDeEnvios(
  app: () => ReturnType<typeof criarApp>,
  base: () => BaseDeTeste,
) {
  const pedir = (
    metodo: "POST" | "PUT" | "GET" | "PATCH",
    url: string,
    corpo?: unknown,
    cabecalhos: Record<string, string> = {},
  ) =>
    app().inject({
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
   * Um comerciante português com o mercado Portugal, um artigo de 30 g
   * publicado com 100 unidades, os textos legais, a régua dos pagamentos, uma
   * conta dos CTT pronta (com segredo dos avisos) e dois métodos: um com a
   * conta e o serviço EXPRESSO_48, outro manual.
   */
  async function cenario() {
    const c = await registarComerciante(base().api, {
      nome: "Loja",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const entidade = await criarEntidadeLegal(base().api, c, {
      denominacao: "Exemplo, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "509999990",
      morada_linha: "Rua 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
    const loja = await criarLoja(base().api, c, {
      entidade_legal_id: entidade,
      nome: "Loja online",
    });
    const mercado = await criarMercado(base().api, c, {
      loja_id: loja,
      nome: "Portugal",
      paises: ["PT"],
      moeda: "EUR",
      linguas: ["pt"],
      lingua_principal: "pt",
    });
    const lista = await criarLista(base().api, c, {
      mercado_id: mercado,
      nome: "Base PT",
      tipo: "base",
    });
    await mudarEstadoMercado(base().api, c, mercado, 1, "activo");
    const canal = await criarCanal(base().api, c, {
      loja_id: loja,
      nome: "Loja online",
    });
    await definirMercadosDoCanal(base().api, c, canal, [mercado]);
    const artigo = await criarArtigo(
      base().api,
      c,
      { tipo: "fisico", nome: "Gel UV", categoria_fiscal: "normal" },
      [{ sku: "GEL-001", unidade_de_venda: "unidade", peso_g: 30 }],
    );
    const v1 = (
      await comComerciante(base().api, c, (trx) =>
        trx
          .selectFrom("variante")
          .select("id")
          .where("artigo_id", "=", artigo)
          .executeTakeFirstOrThrow(),
      )
    ).id;
    await classificarArtigo(
      base().api,
      c,
      artigo,
      1,
      { familias: ["retalho_geral"], natureza_consumidor: "bem" },
      QUEM,
    );
    await mudarEstadoArtigo(base().api, c, artigo, 2, "activo");
    await definirPreco(base().api, c, QUEM, lista, v1, { montante: 1230 });
    await publicar(base().api, c, QUEM, {
      artigo_id: artigo,
      canal_id: canal,
      mercado_id: mercado,
    });
    const publica = (
      await criarChave(base().dono, c, {
        tipo: "publica",
        lojaId: loja,
        criadaPor: "operador:teste",
        nome: "Loja",
        ambitos: ["storefront"],
      })
    ).segredo;
    const servidor = (
      await criarChave(base().dono, c, {
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
          "fulfilment:read",
          "fulfilment:write",
          "returns:read",
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
    const armazem = String(
      (
        await ok(
          adm("POST", "/warehouses", { loja: `sto_${loja}`, nome: "Armazém" }),
          201,
        )
      )["id"],
    );
    await ok(
      adm("POST", "/inventory/receipts", {
        armazem,
        linhas: [{ variante: `var_${v1}`, quantidade: 100 }],
      }),
      201,
    );
    const contaPag = String(
      (
        await ok(
          adm("POST", "/payment-accounts", { prestador: "eupago", nome: "P" }),
          201,
        )
      )["id"],
    );
    await ok(
      adm("PUT", `/payment-accounts/${contaPag}/credentials`, {
        chave: "xxxx-xxxx-xxxx-xxxx",
        segredo_aviso: SEGREDO_PAGAMENTOS,
      }),
      204,
    );
    await ok(adm("POST", `/payment-accounts/${contaPag}/test`));
    await ok(
      adm("POST", "/payment-methods", {
        mercado: `mkt_${mercado}`,
        metodo: "multibanco",
        conta: contaPag,
      }),
      201,
    );
    const conta = String(
      (
        await ok(
          adm("POST", "/carrier-accounts", {
            transportadora: "ctt",
            nome: "CTT",
            remetente: {
              nome: "Armazém",
              linha1: "Rua 1",
              codigo_postal: "1000-001",
              localidade: "Lisboa",
              pais: "PT",
            },
          }),
          201,
        )
      )["id"],
    );
    await ok(
      adm("PUT", `/carrier-accounts/${conta}/credentials`, {
        credenciais: { chave: CHAVE_BOA },
        segredo_aviso: SEGREDO_ENVIOS,
      }),
      204,
    );
    await ok(adm("POST", `/carrier-accounts/${conta}/test`));
    const metodoCtt = String(
      (
        await ok(
          adm("POST", "/shipping-methods", {
            mercado: `mkt_${mercado}`,
            nome: { pt: "CTT Expresso" },
            tarifa: 499,
            conta,
            servico: "EXPRESSO_48",
          }),
          201,
        )
      )["id"],
    );
    const metodoManual = String(
      (
        await ok(
          adm("POST", "/shipping-methods", {
            mercado: `mkt_${mercado}`,
            nome: { pt: "Entrega pela loja" },
            tarifa: 299,
          }),
          201,
        )
      )["id"],
    );
    return {
      c,
      loja,
      mercado,
      canal,
      v1,
      publica,
      adm,
      versoes,
      armazem,
      contaPag,
      conta,
      metodoCtt,
      metodoManual,
    };
  }
  type Cenario = Awaited<ReturnType<typeof cenario>>;

  /** Uma encomenda paga (o aviso do Multibanco assinado) e uma expedição criada. */
  async function expedicaoPaga(
    s: Cenario,
    metodo: string,
    quantidade = 2,
    /** false: a encomenda paga fica por expedir (o ecrã «Expedir» cria-a). */
    comExpedicao = true,
    /** O nome do contacto (texto livre do cliente). */
    nome = "Rui",
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
    await ok(
      pedir(
        "POST",
        `/store/carts/${String(carrinho["id"])}/lines`,
        { variante: `var_${s.v1}`, quantidade },
        segredo,
      ),
    );
    const token = String(
      (
        await ok(
          pedir(
            "POST",
            `/store/carts/${String(carrinho["id"])}/checkout`,
            undefined,
            segredo,
          ),
          201,
        )
      )["token"],
    );
    await ok(
      pedir("PUT", `/checkout/${token}/contact`, {
        email: "rui@exemplo.pt",
        nome,
        telefone: "+351912345678",
      }),
    );
    await ok(
      pedir("PUT", `/checkout/${token}/delivery`, {
        pais: "PT",
        codigo_postal: "1000-001",
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
    await ok(pedir("PUT", `/checkout/${token}/delivery-method`, { metodo }));
    await ok(
      pedir("PUT", `/checkout/${token}/payment-method`, {
        metodo: "multibanco",
      }),
    );
    const resumo = await ok(pedir("GET", `/checkout/${token}/summary`));
    const e = await ok(
      pedir("POST", `/checkout/${token}/place`, {
        aceita_condicoes: true,
        versoes: (resumo["textos"] as Json[]).map((t) => t["versao"]),
        impressao: resumo["impressao"],
      }),
      201,
    );
    const encomenda = String(e["encomenda"]);
    const p = await ok(pedir("POST", `/checkout/${token}/payment`), 201);
    const pag = await ok(s.adm("GET", `/payments/${String(p["id"])}`));
    const corpo = avisoEuPago({
      identifier: String(pag["referencia"]),
      status: "Paid",
      valor: Number(pag["montante"]) / 100,
      trid: Math.floor(Math.random() * 1e9),
    });
    const r = await app().inject({
      method: "POST",
      url: `/webhooks/payments/${s.contaPag}`,
      headers: {
        "content-type": "application/json",
        "x-signature": assinar(corpo, SEGREDO_PAGAMENTOS),
      },
      payload: corpo,
    });
    expect(r.statusCode, r.body).toBe(200);
    if (!comExpedicao) return { encomenda, expedicao: "" };
    const v = await ok(s.adm("GET", `/fulfilment/orders/${encomenda}`));
    const linha = (v["linhas"] as Json[])[0] as Json;
    const x = await ok(
      s.adm("POST", `/orders/${encomenda}/shipments`, {
        linhas: [{ linha: linha["id"], quantidade }],
      }),
      201,
    );
    return { encomenda, expedicao: String(x["id"]) };
  }

  return { pedir, ok, codigo, cenario, expedicaoPaga };
}

export type Cenario = Awaited<
  ReturnType<ReturnType<typeof cenariosDeEnvios>["cenario"]>
>;
