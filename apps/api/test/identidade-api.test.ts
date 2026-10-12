import type { Kysely } from "kysely";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Type } from "typebox";
import { criarApp } from "../src/app.js";
import { RESPOSTA_DE_ERRO } from "../src/base/erros.js";
import { serializadores } from "../src/base/registo.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave, revogarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import type { BaseDados } from "../src/base/esquema.js";

/**
 * Criar e revogar chaves só o dono faz (o comando do operador; revisão do
 * #110, P2-1): a API não tem EXECUTE nessas funções.
 */
let comoDono: () => Kysely<BaseDados>;

// A API com chave (docs/19 §5, §6 e §9), contra o PostgreSQL 18 verdadeiro.

describe.skipIf(URL_BASE === undefined)("API com chave (parte A)", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let registo: string[];
  let a: string;
  let b: string;
  let chaveA: { id: string; segredo: string; prefixo: string };
  let chaveAAdmin: { id: string; segredo: string };
  let chaveB: { id: string; segredo: string };

  const pedir = (url: string, segredo?: string) =>
    app.inject({
      method: "GET",
      url,
      headers:
        segredo === undefined ? {} : { authorization: `Bearer ${segredo}` },
    });

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    comoDono = () => base.dono;
    registo = [];
    const destino = new Writable({
      write(pedaco: Buffer, _codificacao, feito) {
        registo.push(pedaco.toString());
        feito();
      },
    });
    app = criarApp(
      {
        logger: {
          level: "info",
          stream: destino,
          serializers: serializadores,
        },
      },
      undefined,
      base.api,
    );
    const novo = { nome: "Loja", lingua: "pt", fuso: "Europe/Lisbon" };
    a = await registarComerciante(base.api, novo);
    b = await registarComerciante(base.api, novo);
    const dados = { tipo: "servidor" as const, criadaPor: "operador:teste" };
    chaveA = await criarChave(comoDono(), a, {
      ...dados,
      nome: "Leitura",
      ambitos: ["catalog:read"],
    });
    chaveAAdmin = await criarChave(comoDono(), a, {
      ...dados,
      nome: "Chaves",
      ambitos: ["keys:write"],
    });
    chaveB = await criarChave(comoDono(), b, {
      ...dados,
      nome: "Chaves de B",
      ambitos: ["keys:write"],
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("T1: sem chave → 401 auth.required, com o cabeçalho WWW-Authenticate", async () => {
    const r = await pedir("/me");
    expect(r.statusCode).toBe(401);
    expect(r.headers["www-authenticate"]).toBe("Bearer");
    expect(r.json<{ codigo: string }>().codigo).toBe("auth.required");
  });

  it("T1: inventada, mal formada e revogada dão o mesmo 401 auth.invalid", async () => {
    const revogada = await criarChave(comoDono(), a, {
      tipo: "servidor",
      nome: "A revogar",
      ambitos: ["catalog:read"],
      criadaPor: "operador:teste",
    });
    await revogarChave(comoDono(), a, revogada.id, "operador:teste");
    const corpos = [];
    for (const segredo of [
      `eul_sk_${"a".repeat(52)}`,
      "nada-disto",
      revogada.segredo,
    ]) {
      const r = await pedir("/me", segredo);
      expect(r.statusCode, segredo.slice(0, 7)).toBe(401);
      const corpo = r.json<Record<string, unknown>>();
      delete corpo["instance"];
      corpos.push(corpo);
    }
    expect(corpos[1]).toEqual(corpos[0]);
    expect(corpos[2]).toEqual(corpos[0]);
    expect(corpos[0]).toMatchObject({ codigo: "auth.invalid" });
    const r = await pedir("/me", revogada.segredo);
    expect(r.headers["www-authenticate"]).toBe('Bearer error="invalid_token"');
  });

  it("/me diz o comerciante e a chave, com prefixos, sem o segredo", async () => {
    const r = await pedir("/me", chaveA.segredo);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      comerciante: `mer_${a}`,
      loja: null,
      chave: {
        id: `key_${chaveA.id}`,
        tipo: "servidor",
        prefixo: chaveA.prefixo,
        ambitos: ["catalog:read"],
        agente_ia: false,
      },
    });
    expect(r.body).not.toContain(chaveA.segredo);
  });

  it("T4: sem o âmbito da rota → 403 auth.forbidden", async () => {
    const r = await pedir("/keys", chaveA.segredo);
    expect(r.statusCode).toBe(403);
    expect(r.json<{ codigo: string }>().codigo).toBe("auth.forbidden");
  });

  it("T2: cada chave só vê as chaves do seu comerciante", async () => {
    const deA = await pedir("/keys", chaveAAdmin.segredo);
    const deB = await pedir("/keys", chaveB.segredo);
    const ids = (r: typeof deA) =>
      r.json<{ dados: { id: string }[] }>().dados.map((c) => c.id);
    expect(ids(deA)).toContain(`key_${chaveA.id}`);
    expect(ids(deA)).not.toContain(`key_${chaveB.id}`);
    expect(ids(deB)).toEqual([`key_${chaveB.id}`]);
    expect(deA.body).not.toContain(chaveA.segredo);
  });

  it("T3: o comerciante sai da chave; um id no caminho ou na consulta é ignorado", async () => {
    const r = await pedir(`/keys?comerciante=${b}`, chaveAAdmin.segredo);
    expect(r.statusCode).toBe(200);
    expect(
      r.json<{ dados: { id: string }[] }>().dados.map((c) => c.id),
    ).not.toContain(`key_${chaveB.id}`);
  });

  it("T5: o segredo nunca vai para o registo", async () => {
    await pedir("/me", chaveA.segredo);
    await pedir("/me", "eul_sk_inventada");
    const tudo = registo.join("");
    expect(tudo.length).toBeGreaterThan(0);
    expect(tudo).not.toContain(chaveA.segredo);
    expect(tudo).not.toContain("eul_sk_inventada");
  });

  it("T4: uma rota sem âmbito declarado não se regista", () => {
    const outra = criarApp();
    expect(() =>
      outra.get(
        "/sem-ambito",
        { schema: { response: { 200: Type.Object({}), ...RESPOSTA_DE_ERRO } } },
        () => ({}),
      ),
    ).toThrow(/sem âmbito/);
    void outra.close();
  });

  it("o contrato mostra a segurança nas rotas com chave e não nas públicas", async () => {
    const r = await pedir("/openapi.json");
    const c = r.json<{
      paths: Record<
        string,
        { get?: { security?: unknown }; post?: { security?: unknown } }
      >;
      components: { securitySchemes: Record<string, unknown> };
    }>();
    expect(Object.keys(c.paths).sort()).toEqual([
      "/billing-profiles/{id}",
      "/billing-profiles/{id}/archive",
      "/billing-profiles/{id}/exemption",
      "/billing-profiles/{id}/exemptions",
      "/billing-profiles/{id}/make-primary",
      "/billing-profiles/{id}/restore",
      "/billing-profiles/{id}/vies-checks",
      "/carrier-accounts",
      "/carrier-accounts/{id}",
      "/carrier-accounts/{id}/credentials",
      "/carrier-accounts/{id}/services",
      "/carrier-accounts/{id}/test",
      "/categories",
      "/categories/{id}",
      "/categories/{id}/archive",
      "/categories/{id}/move",
      "/categories/{id}/restore",
      "/channels",
      "/channels/{id}",
      "/channels/{id}/archive",
      "/channels/{id}/markets",
      "/channels/{id}/restore",
      "/checkout/{token}",
      "/checkout/{token}/billing",
      "/checkout/{token}/confirmation",
      "/checkout/{token}/contact",
      "/checkout/{token}/delivery",
      "/checkout/{token}/delivery-method",
      "/checkout/{token}/delivery-methods",
      "/checkout/{token}/legal/{versao}",
      "/checkout/{token}/payment",
      "/checkout/{token}/payment-method",
      "/checkout/{token}/payment-methods",
      "/checkout/{token}/place",
      "/checkout/{token}/summary",
      "/checkouts",
      "/collections",
      "/collections/{id}",
      "/collections/{id}/archive",
      "/collections/{id}/products",
      "/collections/{id}/restore",
      "/consent-confirmations/{id}/confirm",
      "/customer-duplicates",
      "/customer-duplicates/{id}/dismiss",
      "/customer-tags",
      "/customer-tags/{id}",
      "/customer-tags/{id}/archive",
      "/customer-tags/{id}/restore",
      "/customers",
      "/customers/search",
      "/customers/{id}",
      "/customers/{id}/billing-profiles",
      "/customers/{id}/consents",
      "/customers/{id}/export",
      "/customers/{id}/merge",
      "/customers/{id}/privacy-requests",
      "/customers/{id}/pseudonymize",
      "/customers/{id}/restriction",
      "/customers/{id}/tags/{etiqueta}",
      "/customers/{id}/timeline",
      "/exemptions/{id}/attachments",
      "/exemptions/{id}/attachments/{anexo}",
      "/fulfilment/orders",
      "/fulfilment/orders/{id}",
      "/health",
      "/hub/invoicing",
      "/hub/invoicing-connections/{id}/authorize",
      "/hub/invoicing-connections/{id}/authorize/complete",
      "/hub/invoicing-connections/{id}/test",
      "/hub/tax-reports/oss",
      "/hub/tax-reports/oss/classifications",
      "/hub/tax-reports/oss/close",
      "/hub/tax-reports/oss/documents/{id}",
      "/hub/tax-reports/oss/records",
      "/imports",
      "/imports/{id}",
      "/imports/{id}/apply",
      "/inventory",
      "/inventory/adjustments",
      "/inventory/movements",
      "/inventory/receipts",
      "/invoices",
      "/invoices/{id}",
      "/invoices/{id}/correct",
      "/invoices/{id}/issued-elsewhere",
      "/invoices/{id}/pdf",
      "/invoices/{id}/recheck",
      "/invoices/{id}/reconcile",
      "/invoices/{id}/release",
      "/invoices/{id}/resolve",
      "/invoicing-connections",
      "/invoicing-connections/moloni/callback",
      "/invoicing-connections/{id}",
      "/invoicing-connections/{id}/authorize",
      "/invoicing-connections/{id}/authorize/complete",
      "/invoicing-connections/{id}/credentials",
      "/invoicing-connections/{id}/test",
      "/keys",
      "/keys/{id}/revoke",
      "/legal-entities/{id}/invoicing",
      "/legal-texts",
      "/legal-texts/{id}/versions",
      "/legal-texts/{id}/versions/{versao}",
      "/legal-texts/{id}/versions/{versao}/publish",
      "/lots",
      "/markets",
      "/markets/{id}",
      "/markets/{id}/activate",
      "/markets/{id}/archive",
      "/me",
      "/notifications",
      "/options/{id}",
      "/options/{id}/values",
      "/options/{id}/values/order",
      "/options/{id}/values/{valor}",
      "/orders",
      "/orders/{id}",
      "/orders/{id}/cancel",
      "/orders/{id}/shipments",
      "/orders/{id}/timeline",
      "/paises",
      "/payment-accounts",
      "/payment-accounts/{id}",
      "/payment-accounts/{id}/credentials",
      "/payment-accounts/{id}/test",
      "/payment-issues",
      "/payment-issues/{id}/resolve",
      "/payment-methods",
      "/payment-methods/{id}",
      "/payments",
      "/payments/{id}",
      "/payments/{id}/check",
      "/price-lists",
      "/price-lists/{id}",
      "/price-lists/{id}/archive",
      "/price-lists/{id}/prices",
      "/price-lists/{id}/prices/{variante}",
      "/price-lists/{id}/prices/{variante}/history",
      "/price-lists/{id}/prices/{variante}/reduction",
      "/price-lists/{id}/restore",
      "/problems",
      "/problems/{id}",
      "/problems/{id}/close",
      "/problems/{id}/decide",
      "/products",
      "/products/{id}",
      "/products/{id}/activate",
      "/products/{id}/archive",
      "/products/{id}/categories",
      "/products/{id}/classification",
      "/products/{id}/options",
      "/products/{id}/options/order",
      "/products/{id}/prices",
      "/products/{id}/publications",
      "/products/{id}/publications/check",
      "/products/{id}/restore",
      "/products/{id}/timeline",
      "/products/{id}/variants",
      "/publications/{id}/archive",
      "/refunds",
      "/refunds/{id}",
      "/refunds/{id}/cancel",
      "/refunds/{id}/execute",
      "/refunds/{id}/manual",
      "/refunds/{id}/reconcile",
      "/returns",
      "/returns/{id}",
      "/returns/{id}/cancel",
      "/returns/{id}/close",
      "/returns/{id}/decide",
      "/returns/{id}/inspect",
      "/returns/{id}/receive",
      "/sales/summary",
      "/shipments/{id}",
      "/shipments/{id}/events",
      "/shipments/{id}/label",
      "/shipments/{id}/label/file",
      "/shipments/{id}/label/void",
      "/shipments/{id}/refresh",
      "/shipping-methods",
      "/shipping-methods/{id}",
      "/store/carts",
      "/store/carts/{id}",
      "/store/carts/{id}/checkout",
      "/store/carts/{id}/lines",
      "/store/carts/{id}/lines/{linha}",
      "/store/orders/{token}/withdrawal",
      "/tasks",
      "/tasks/{fila}/{caso}",
      "/tasks/{fila}/{caso}/assign",
      "/tasks/{fila}/{caso}/deadline",
      "/tax-reports/oss",
      "/tax-reports/oss/classifications",
      "/tax-reports/oss/close",
      "/tax-reports/oss/records",
      "/tax/categories",
      "/tax/decisions/simulate",
      "/tax/rates",
      "/tax/reasons",
      "/tax/registrations",
      "/tax/registrations/{id}",
      "/tax/territories",
      "/translations",
      "/translations/{recurso}/{campo}/{lingua}",
      "/variants",
      "/variants/{id}",
      "/variants/{id}/archive",
      "/variants/{id}/components",
      "/variants/{id}/stock-policy",
      "/variants/{id}/values",
      "/warehouses",
      "/warehouses/{id}",
      "/warehouses/{id}/packaging",
      "/webhooks/carriers/{transportadora}/{conta}",
      "/webhooks/payments/{conta}",
      "/withdrawals",
      "/withdrawals/{id}",
      "/withdrawals/{id}/decide",
    ]);
    expect(c.paths["/me"]?.get?.security).toEqual([{ chave: [] }]);
    expect(c.paths["/keys"]?.get?.security).toEqual([{ chave: [] }]);
    expect(c.paths["/keys"]?.post?.security).toEqual([{ chave: [] }]);
    expect(c.paths["/keys/{id}/revoke"]?.post?.security).toEqual([
      { chave: [] },
    ]);
    expect(c.paths["/health"]?.get?.security).toBeUndefined();
    // O checkout alojado é do cliente da loja, pelo token: sem chave.
    expect(c.paths["/checkout/{token}/place"]?.post?.security).toBeUndefined();
    expect(c.paths["/store/carts"]?.post?.security).toEqual([{ chave: [] }]);
    expect(c.components.securitySchemes["chave"]).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });

  it("sem base de dados, as rotas com chave não existem", async () => {
    const semBase = criarApp();
    const r = await semBase.inject({ method: "GET", url: "/me" });
    expect(r.statusCode).toBe(404);
    await semBase.close();
  });
});
