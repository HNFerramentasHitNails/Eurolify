import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  criarEntidadeLegal,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// O Motor de IVA pela API (docs/24 §8; migração 0040): as tabelas, o regime
// de cada entidade legal, a simulação com o perfil, o VIES e a isenção da
// base, e o fim da rede CM do Catálogo.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("API do Motor de IVA", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let b: string;
  let entidadeA: string;
  let entidadeB: string;
  let dono: string;
  let soLer: string;
  let deB: string;

  const pedir = (
    metodo: "POST" | "PUT" | "GET" | "PATCH",
    url: string,
    corpo?: unknown,
    segredo = dono,
  ) =>
    app.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${segredo}`,
        ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });
  const ok = async (
    r: ReturnType<typeof pedir>,
    estado = 200,
  ): Promise<Json> => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(estado);
    return x.json();
  };
  const simular = (corpo: Json, segredo = dono) =>
    ok(
      pedir(
        "POST",
        "/tax/decisions/simulate",
        {
          entidade_legal: `lgl_${entidadeA}`,
          categoria: "normal",
          natureza: "bem",
          montante: 1230,
          preco_inclui_iva: true,
          entrega: { pais: "PT", codigo_postal: "1000-001" },
          finalidade: "consumo",
          ...corpo,
        },
        segredo,
      ),
    );

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
    app = criarApp({ logger: false }, undefined, base.api);
    a = await registarComerciante(base.api, {
      nome: "A",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    b = await registarComerciante(base.api, {
      nome: "B",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    entidadeA = await criarEntidadeLegal(base.api, a, {
      denominacao: "A, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "509999990",
      morada_linha: "Rua 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
    entidadeB = await criarEntidadeLegal(base.api, b, {
      denominacao: "B, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "509999991",
      morada_linha: "Rua 2",
      morada_codigo_postal: "4000-001",
      morada_localidade: "Porto",
    });
    const chave = (c: string, nome: string, ambitos: string[]) =>
      criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome,
        ambitos: ambitos as never,
      });
    dono = (
      await chave(a, "Dono", [
        "tax:read",
        "tax:write",
        "customers:read",
        "customers:write",
        "customers:billing",
        "customers:exemptions",
        "catalog:read",
        "catalog:write",
      ])
    ).segredo;
    soLer = (await chave(a, "Ler", ["tax:read"])).segredo;
    deB = (await chave(b, "B", ["tax:read", "tax:write", "customers:read"]))
      .segredo;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("as tabelas: a categoria normal, as taxas de Portugal com a fonte (C), os territórios, os motivos", async () => {
    expect((await ok(pedir("GET", "/tax/categories")))["dados"]).toEqual([
      {
        codigo: "normal",
        descricao: { pt: "Taxa normal", en: "Standard rate" },
        estado: "activa",
      },
    ]);
    const taxas = (await ok(pedir("GET", "/tax/rates?pais=PT")))[
      "dados"
    ] as Json[];
    expect(
      taxas.map((t) => [t["regiao"], t["percentagem"], t["verificado"]]),
    ).toEqual([
      [null, 2300, false],
      ["PT-20", 1600, false],
      ["PT-30", 2200, false],
    ]);
    expect(String(taxas[0]?.["fonte"])).toMatch(/^M: /);
    const territorios = (await ok(pedir("GET", "/tax/territories")))[
      "dados"
    ] as Json[];
    expect(territorios.find((t) => t["prefixo_cp"] === "35")).toMatchObject({
      pais: "ES",
      efeito: "fora_do_iva_ue",
    });
    expect(
      ((await ok(pedir("GET", "/tax/reasons?pais=PT")))["dados"] as Json[]).map(
        (m) => m["codigo"],
      ),
    ).toEqual(["M05", "M07", "M16"]);
    // O ultramar francês com código próprio: por validar, nunca exportação.
    expect(
      territorios.find((t) => t["pais"] === "GP" && t["prefixo_cp"] === ""),
    ).toMatchObject({ efeito: "por_validar" });
  });

  it("o regime: por declarar até o dono declarar; cada declaração fica; só com tax:write; o vizinho não toca", async () => {
    const antes = (await ok(pedir("GET", "/tax/registrations")))[
      "dados"
    ] as Json[];
    expect(antes).toEqual([
      expect.objectContaining({
        entidade_legal: `lgl_${entidadeA}`,
        pais: "PT",
        regime: "por_declarar",
        declarado_por: null,
      }) as unknown,
    ]);
    expect(
      (
        await pedir(
          "PUT",
          `/tax/registrations/lgl_${entidadeA}`,
          { regime: "destino" },
          soLer,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await pedir(
          "PUT",
          `/tax/registrations/lgl_${entidadeA}`,
          { regime: "destino" },
          deB,
        )
      ).statusCode,
    ).toBe(404);
    const r = await pedir("PUT", `/tax/registrations/lgl_${entidadeA}`, {
      regime: "origem",
      registos: [{ pais: "XX", numero: "B12345678" }],
    });
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json<Json>()["codigo"]).toBe("tax.invalid_registration");
    await ok(
      pedir("PUT", `/tax/registrations/lgl_${entidadeA}`, {
        regime: "destino",
        oss_desde: "2026-07-01",
        registos: [{ pais: "ES", numero: "B12345678", desde: "2026-01-01" }],
      }),
    );
    const depois = (
      (await ok(pedir("GET", "/tax/registrations")))["dados"] as Json[]
    )[0];
    expect(depois).toMatchObject({
      regime: "destino",
      oss_desde: "2026-07-01",
      registos: [{ pais: "ES", numero: "B12345678", desde: "2026-01-01" }],
    });
    expect(String(depois?.["declarado_por"])).toMatch(/^chave:key_/);
    const eventos = await base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
        trx,
      );
      return (
        await sql<{
          tipo: string;
        }>`select tipo from evento_saida where tipo = 'tax.regime_changed'`.execute(
          trx,
        )
      ).rows;
    });
    expect(eventos).toHaveLength(1);
    // Um processo de sistema não declara o regime.
    await expect(
      base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${a}, true), set_config('eurolify.quem', 'sistema:x', true)`.execute(
          trx,
        );
        await sql`insert into declaracao_regime (comerciante_id, entidade_legal_id, regime)
                  values (${a}, ${entidadeA}, 'origem')`.execute(trx);
      }),
    ).rejects.toThrow(/tax.declaration_by_person/);
  });

  it("a simulação: nacional, a isenção manual com o código (Q4), a regra e a evidência", async () => {
    expect(await simular({})).toMatchObject({
      resultado: "tributada",
      taxa: 2300,
      base: 1000,
      iva: 230,
      total: 1230,
      regra: "nacional",
      motivo_bloqueio: null,
    });
    const f = await ok(pedir("POST", "/customers", { nome: "Rui" }), 201);
    const p = await ok(
      pedir("POST", `/customers/${String(f["id"])}/billing-profiles`, {
        tipo: "empresa",
        nome_documento: "Rui, Lda",
        nif: "263631656",
      }),
      201,
    );
    // Sem código, ou com um que não é do país do comerciante, não há isenção.
    const sem = await pedir(
      "PUT",
      `/billing-profiles/${String(p["id"])}/exemption`,
      {
        motivo: "transportadora própria",
      },
    );
    expect(sem.statusCode).toBe(400);
    const mau = await pedir(
      "PUT",
      `/billing-profiles/${String(p["id"])}/exemption`,
      {
        motivo: "transportadora própria",
        codigo_motivo: "X99",
      },
    );
    expect(mau.statusCode, mau.body).toBe(422);
    expect(mau.json<Json>()["codigo"]).toBe("customers.exemption_reason_code");
    await ok(
      pedir("PUT", `/billing-profiles/${String(p["id"])}/exemption`, {
        motivo: "transportadora própria",
        codigo_motivo: "M05",
      }),
      201,
    );
    const d = await simular({ perfil: p["id"] });
    expect(d).toMatchObject({
      resultado: "isenta",
      codigo_motivo: "M05",
      regra: "isencao_manual",
      total: 1000,
    });
    expect((d["evidencia"] as Json)["isencao"]).toEqual(expect.any(String));
  });

  it("a simulação com o VIES da base: uma prova «válido» recente isenta (M16); a do vizinho não existe", async () => {
    const f = await ok(pedir("POST", "/customers", { nome: "Ana" }), 201);
    const p = await ok(
      pedir("POST", `/customers/${String(f["id"])}/billing-profiles`, {
        tipo: "empresa",
        nome_documento: "Ana SARL",
        nif: "FR40303265045",
      }),
      201,
    );
    const id = String(p["id"]).slice(4);
    await base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true), set_config('eurolify.quem', 'sistema:vies', true)`.execute(
        trx,
      );
      await sql`select vies_registar(${id}::uuid, 'FR', '40303265045', null, null, now(), now(),
                'valido', null, 'WAPI', null, null, 'perfil_novo')`.execute(
        trx,
      );
    });
    const corpo = {
      perfil: p["id"],
      finalidade: "profissional",
      entrega: { pais: "FR", codigo_postal: "75001" },
    };
    expect(await simular(corpo)).toMatchObject({
      resultado: "isenta",
      codigo_motivo: "M16",
      regra: "vies_intracomunitaria",
    });
    expect(
      (
        await pedir(
          "POST",
          "/tax/decisions/simulate",
          {
            ...corpo,
            entidade_legal: `lgl_${entidadeA}`,
            categoria: "normal",
            natureza: "bem",
            montante: 1230,
            preco_inclui_iva: true,
          },
          deB,
        )
      ).statusCode,
    ).toBe(404);
    // Uma prova «inválido» mais recente: o estado e a data vêm da mesma
    // prova, e já não isenta (P2-7).
    await base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true), set_config('eurolify.quem', 'sistema:vies', true)`.execute(
        trx,
      );
      await sql`select vies_registar(${id}::uuid, 'FR', '40303265045', null, null, now(), now(),
                'invalido', null, 'WAPI2', null, null, 'revalidacao')`.execute(
        trx,
      );
    });
    expect(await simular(corpo)).toMatchObject({
      resultado: "bloqueada",
      motivo_bloqueio: "b2b_sem_vies",
      evidencia: { vies: { estado: "invalido" } },
    });
    // B com a sua entidade e o perfil de A: o perfil não existe para B (P2-6).
    const r = await pedir(
      "POST",
      "/tax/decisions/simulate",
      {
        ...corpo,
        entidade_legal: `lgl_${entidadeB}`,
        categoria: "normal",
        natureza: "bem",
        montante: 1230,
        preco_inclui_iva: true,
      },
      deB,
    );
    expect(r.statusCode, r.body).toBe(404);
    expect(r.json<Json>()["codigo"]).toBe("tax.not_found");
  });

  it("a simulação com perfil pede customers:read; um perfil arquivado não decide", async () => {
    const f = await ok(pedir("POST", "/customers", { nome: "Eva" }), 201);
    const p = await ok(
      pedir("POST", `/customers/${String(f["id"])}/billing-profiles`, {
        tipo: "particular",
        nome_documento: "Eva",
      }),
      201,
    );
    const semAmbito = await pedir(
      "POST",
      "/tax/decisions/simulate",
      {
        entidade_legal: `lgl_${entidadeA}`,
        categoria: "normal",
        natureza: "bem",
        montante: 1230,
        preco_inclui_iva: true,
        entrega: { pais: "PT", codigo_postal: "1000-001" },
        finalidade: "consumo",
        perfil: p["id"],
      },
      soLer,
    );
    expect(semAmbito.statusCode, semAmbito.body).toBe(403);
    expect(semAmbito.json<Json>()["codigo"]).toBe("auth.forbidden");
    // Sem perfil, tax:read chega; a moeda fica na evidência.
    expect(await simular({ moeda: "EUR" }, soLer)).toMatchObject({
      resultado: "tributada",
      evidencia: { moeda: "EUR", dia: expect.any(String) as unknown },
    });
    await ok(
      pedir("POST", `/billing-profiles/${String(p["id"])}/archive`, {
        versao: p["versao"],
      }),
    );
    const arq = await pedir("POST", "/tax/decisions/simulate", {
      entidade_legal: `lgl_${entidadeA}`,
      categoria: "normal",
      natureza: "bem",
      montante: 1230,
      preco_inclui_iva: true,
      entrega: { pais: "PT", codigo_postal: "1000-001" },
      finalidade: "consumo",
      perfil: p["id"],
    });
    expect(arq.statusCode, arq.body).toBe(422);
    expect(arq.json<Json>()["codigo"]).toBe("tax.profile_archived");
  });

  it("o fim da rede CM: uma categoria fiscal que não está na lista é recusada no artigo", async () => {
    const r = await pedir("POST", "/products", {
      tipo: "fisico",
      nome: "Gel UV 15 ml",
      categoria_fiscal: "isento",
      variantes: [{ sku: "IVA-1", unidade_de_venda: "unidade" }],
    });
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json<Json>()["codigo"]).toBe("catalog.tax_category_unknown");
    await ok(
      pedir("POST", "/products", {
        tipo: "fisico",
        nome: "Gel UV 15 ml",
        categoria_fiscal: "normal",
        variantes: [{ sku: "IVA-2", unidade_de_venda: "unidade" }],
      }),
      201,
    );
  });
});
