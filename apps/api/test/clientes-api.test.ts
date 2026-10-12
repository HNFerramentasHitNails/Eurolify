import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
import {
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Clientes e perfis de faturação, parte 1 (docs/23; issue #233; migração
// 0037), pela app inteira. A base é criada sem o «quem» por omissão dos
// testes: cada escrita pela API tem de trazer o seu.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };
const ENTIDADE = {
  denominacao: "Exemplo, Lda.",
  forma_juridica: "sociedade por quotas",
  pais: "PT",
  numero_fiscal: "509999990",
  morada_linha: "Rua de Teste, 1",
  morada_codigo_postal: "1000-001",
  morada_localidade: "Lisboa",
};

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("API de Clientes", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let b: string;
  let loja: string;
  let clientes: string;
  let clientesId: string;
  let soLer: string;
  let precos: string;
  let semClientes: string;
  let semFaturacao: string;
  let deB: string;

  const pedir = (
    metodo: "POST" | "PATCH" | "PUT" | "DELETE" | "GET",
    url: string,
    corpo?: unknown,
    segredo = clientes,
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
  const recusa = async (
    r: ReturnType<typeof pedir>,
    estado: number,
    codigo: string,
  ) => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(estado);
    expect(x.json<Json>()["codigo"]).toBe(codigo);
    return x.json<Json>();
  };

  const ficha = async (nome = "Ana Silva", extra: Json = {}) =>
    ok(pedir("POST", "/customers", { nome, ...extra }), 201);
  const perfil = async (cliente: unknown, corpo: Json, segredo = clientes) =>
    pedir(
      "POST",
      `/customers/${String(cliente)}/billing-profiles`,
      corpo,
      segredo,
    );

  /** Como se o perfil tivesse saído num documento (a fatia 10 é que o marca). */
  async function usadoEmDocumento(perfilId: string) {
    await base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
        trx,
      );
      await sql`select set_config('eurolify.quem', 'teste:documento', true)`.execute(
        trx,
      );
      await sql`update perfil_faturacao set usado_em_documento = true
                where id = ${perfilId.slice(4)}`.execute(trx);
    });
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
    app = criarApp({ logger: false }, undefined, base.api);
    a = await registarComerciante(base.api, NOVO);
    b = await registarComerciante(base.api, NOVO);
    const entidade = await criarEntidadeLegal(base.api, a, ENTIDADE);
    loja = `sto_${await criarLoja(base.api, a, { entidade_legal_id: entidade, nome: "Loja online" })}`;
    const dono: Kysely<BaseDados> = base.dono;
    const chave = (c: string, nome: string, ambitos: string[]) =>
      criarChave(dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome,
        ambitos: ambitos as never,
      });
    const c = await chave(a, "Clientes", [
      "customers:read",
      "customers:write",
      "customers:billing",
    ]);
    clientes = c.segredo;
    clientesId = c.id;
    soLer = (await chave(a, "Ler clientes", ["customers:read"])).segredo;
    precos = (await chave(a, "Preços", ["prices:read", "prices:write"]))
      .segredo;
    semClientes = (await chave(a, "Catálogo", ["catalog:read"])).segredo;
    semFaturacao = (
      await chave(a, "Clientes sem faturação", [
        "customers:read",
        "customers:write",
      ])
    ).segredo;
    deB = (
      await chave(b, "Clientes de B", [
        "customers:read",
        "customers:write",
        "customers:billing",
      ])
    ).segredo;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("os perfis de faturação só com customers:billing (o dono): o gestor e o apoio mudam a ficha, não o NIF", async () => {
    const f = await ok(
      pedir("POST", "/customers", { nome: "Só ficha" }, semFaturacao),
      201,
    );
    expect(
      (
        await perfil(
          f["id"],
          { tipo: "empresa", nome_documento: "X, Lda", nif: "263631656" },
          semFaturacao,
        )
      ).statusCode,
    ).toBe(403);
    const p = await ok(
      perfil(f["id"], {
        tipo: "empresa",
        nome_documento: "X, Lda",
        nif: "263631656",
      }),
      201,
    );
    const id = String(p["id"]);
    for (const [metodo, url, corpo] of [
      ["PATCH", `/billing-profiles/${id}`, { versao: 1, nif: "513207384" }],
      ["POST", `/billing-profiles/${id}/make-primary`, undefined],
      ["POST", `/billing-profiles/${id}/archive`, { versao: 1 }],
      ["POST", `/billing-profiles/${id}/restore`, { versao: 1 }],
    ] as const) {
      expect(
        (await pedir(metodo, url, corpo, semFaturacao)).statusCode,
        url,
      ).toBe(403);
    }
    // Ler, sim.
    expect(
      (await pedir("GET", `/billing-profiles/${id}`, undefined, semFaturacao))
        .statusCode,
    ).toBe(200);
  });

  it("os âmbitos: ler não escreve; sem customers:* não se vê nada", async () => {
    expect(
      (await pedir("POST", "/customers", { nome: "X" }, soLer)).statusCode,
    ).toBe(403);
    expect(
      (await pedir("GET", "/customers", undefined, soLer)).statusCode,
    ).toBe(200);
    expect(
      (await pedir("GET", "/customers", undefined, semClientes)).statusCode,
    ).toBe(403);
    expect(
      (await pedir("GET", "/customer-tags", undefined, semClientes)).statusCode,
    ).toBe(403);
  });

  it("a ficha: cria, lê, altera na versão; o e-mail não é único e é validado", async () => {
    const f = await ficha("Ana Silva", {
      emails: ["Ana@Exemplo.pt", "ana.silva@exemplo.pt"],
      telefones: ["+351912345678"],
      lingua: "pt",
      pais: "LU",
    });
    expect(f).toMatchObject({
      nome: "Ana Silva",
      emails: ["Ana@Exemplo.pt", "ana.silva@exemplo.pt"],
      estado: "activo",
      limitado: false,
      etiquetas: [],
      versao: 1,
    });
    expect(String(f["id"])).toMatch(/^cus_/);
    // Duas pessoas com o mesmo e-mail são duas fichas (§3.1).
    await ficha("Rui Silva", { emails: ["ana@exemplo.pt"] });

    const alterada = await ok(
      pedir("PATCH", `/customers/${String(f["id"])}`, {
        versao: 1,
        nome: "Ana M. Silva",
      }),
    );
    expect(alterada).toMatchObject({ nome: "Ana M. Silva", versao: 2 });
    await recusa(
      pedir("PATCH", `/customers/${String(f["id"])}`, { versao: 1, nome: "X" }),
      409,
      "customers.version_conflict",
    );
    await recusa(
      pedir("POST", "/customers", { nome: "X", emails: ["sem-arroba"] }),
      422,
      "customers.email_invalid",
    );
    await recusa(
      pedir("POST", "/customers", { nome: "X", emails: ["a@b.pt", "A@B.PT"] }),
      422,
      "customers.email_invalid",
    );
    await recusa(
      pedir("POST", "/customers", { nome: "   " }),
      422,
      "customers.name_required",
    );
    expect(
      (
        await pedir("POST", "/customers", {
          nome: "X",
          telefones: ["912345678"],
        })
      ).statusCode,
    ).toBe(400);
    await recusa(
      pedir("GET", `/customers/cus_${randomUUID()}`),
      404,
      "customers.not_found",
    );
  });

  it("a régua do NIF: o país do comerciante sem prefixo, os outros com; o VIES só fora do país", async () => {
    const f = await ficha("Salão Ana");
    const pt = await ok(
      perfil(f["id"], {
        tipo: "empresa",
        nome_documento: "Salão Ana, Lda",
        nif: "263 631.656",
      }),
      201,
    );
    expect(pt).toMatchObject({
      nif: "263631656",
      nif_escrito: "263 631.656",
      pais_contribuinte: "PT",
      estado_vies: "nao_aplicavel",
      principal: true,
    });
    const comPrefixo = await ok(
      perfil(f["id"], {
        tipo: "empresa",
        nome_documento: "Salão Ana, Lda",
        nif: "PT263631656",
      }),
      201,
    );
    // O que a pessoa escreveu mantém-se; o que sai é a régua.
    expect(comPrefixo).toMatchObject({
      nif: "263631656",
      nif_escrito: "PT263631656",
      principal: false,
    });
    const fr = await ok(
      perfil(f["id"], {
        tipo: "empresa",
        nome_documento: "Ana SARL",
        nif: "FR40303265045",
        morada: {
          linha1: "1 rue de Test",
          codigo_postal: "75001",
          localidade: "Paris",
          pais: "FR",
        },
      }),
      201,
    );
    expect(fr).toMatchObject({
      nif: "FR40303265045",
      pais_contribuinte: "FR",
      estado_vies: "por_validar",
      morada: { linha1: "1 rue de Test", linha2: null, pais: "FR" },
    });
    // A Grécia: o prefixo fiscal é EL, não GR.
    const gr = await ok(
      perfil(f["id"], {
        tipo: "empresa",
        nome_documento: "Ana EPE",
        nif: "094014201",
        pais_contribuinte: "GR",
      }),
      201,
    );
    expect(gr).toMatchObject({ nif: "EL094014201", pais_contribuinte: "GR" });
    // O país dito e o prefixo iguais: é o mesmo número.
    expect(
      await ok(
        perfil(f["id"], {
          tipo: "empresa",
          nome_documento: "Salão Ana, Lda",
          nif: "PT263631656",
          pais_contribuinte: "PT",
        }),
        201,
      ),
    ).toMatchObject({ nif: "263631656", pais_contribuinte: "PT" });
    // Um consumidor final sem NIF.
    expect(
      await ok(
        perfil(f["id"], { tipo: "particular", nome_documento: "Ana" }),
        201,
      ),
    ).toMatchObject({ nif: null, estado_vies: "nao_aplicavel" });

    for (const [corpo, codigo] of [
      [{ nif: "123456789" }, "customers.nif_country_required"],
      [{ nif: "123456789", pais_contribuinte: "PT" }, "customers.nif_invalid"],
      [{ nif: "000000000", pais_contribuinte: "PT" }, "customers.nif_invalid"],
      [{ nif: "263631657" }, "customers.nif_country_required"],
      [{ nif: "PT263631657" }, "customers.nif_invalid"],
      [
        { nif: "FR40303265045", pais_contribuinte: "ES" },
        "customers.nif_invalid",
      ],
      [{ nif: "12-34" }, "customers.nif_country_required"],
      // GR com o código do país no número: o prefixo fiscal grego é EL.
      [
        { nif: "GR094014201", pais_contribuinte: "GR" },
        "customers.nif_invalid",
      ],
      [{ pais_contribuinte: "PT" }, "customers.nif_invalid"],
    ] as const) {
      const r = await recusa(
        perfil(f["id"], {
          tipo: "particular",
          nome_documento: "Ana",
          ...corpo,
        }),
        422,
        codigo,
      );
      // A mensagem nunca repete o NIF (R12).
      expect(JSON.stringify(r)).not.toContain("263631657");
    }
    await recusa(
      perfil(f["id"], { tipo: "empresa", nome_documento: "Sem NIF, Lda" }),
      422,
      "customers.company_requires_nif",
    );
  });

  it("o NIF no comerciante sem país: sem prefixo não se deduz PT; com ele, sempre com prefixo e o VIES aplica-se", async () => {
    const f = await ok(pedir("POST", "/customers", { nome: "Rui" }, deB), 201);
    // 9 dígitos sem prefixo só são PT num comerciante português (um SIREN
    // francês também tem 9; revisão do #234, P2-1).
    await recusa(
      perfil(
        f["id"],
        { tipo: "empresa", nome_documento: "Rui, Lda", nif: "263631656" },
        deB,
      ),
      422,
      "customers.nif_country_required",
    );
    expect(
      await ok(
        perfil(
          f["id"],
          { tipo: "empresa", nome_documento: "Rui, Lda", nif: "PT263631656" },
          deB,
        ),
        201,
      ),
    ).toMatchObject({ nif: "PT263631656", estado_vies: "por_validar" });
  });

  it("o principal: um por ficha; trocar; o principal não se arquiva com outro activo", async () => {
    const f = await ficha("Marta");
    const p1 = await ok(
      perfil(f["id"], { tipo: "particular", nome_documento: "Marta" }),
      201,
    );
    const p2 = await ok(
      perfil(f["id"], {
        tipo: "empresa",
        nome_documento: "Marta, Unipessoal",
        nif: "263631656",
      }),
      201,
    );
    expect([p1["principal"], p2["principal"]]).toEqual([true, false]);
    await recusa(
      pedir("POST", `/billing-profiles/${String(p1["id"])}/archive`, {
        versao: p1["versao"],
      }),
      409,
      "customers.primary_profile",
    );
    const trocado = await ok(
      pedir("POST", `/billing-profiles/${String(p2["id"])}/make-primary`),
    );
    expect(trocado["principal"]).toBe(true);
    const lista = await ok(
      pedir("GET", `/customers/${String(f["id"])}/billing-profiles`),
    );
    const dados = lista["dados"] as Json[];
    expect(dados.map((p) => [p["id"], p["principal"]])).toEqual([
      [p2["id"], true],
      [p1["id"], false],
    ]);
    const p1Agora = dados[1] as Json;
    const arq = await ok(
      pedir("POST", `/billing-profiles/${String(p1["id"])}/archive`, {
        versao: p1Agora["versao"],
      }),
    );
    expect(arq).toMatchObject({ estado: "arquivado", principal: false });
    await recusa(
      pedir("POST", `/billing-profiles/${String(p1["id"])}/make-primary`),
      409,
      "customers.invalid_transition",
    );
    // O único activo arquiva-se e a ficha fica sem principal; repor devolve-o.
    const p2Agora = await ok(
      pedir("GET", `/billing-profiles/${String(p2["id"])}`),
    );
    const sem = await ok(
      pedir("POST", `/billing-profiles/${String(p2["id"])}/archive`, {
        versao: p2Agora["versao"],
      }),
    );
    expect(sem["principal"]).toBe(false);
    const reposto = await ok(
      pedir("POST", `/billing-profiles/${String(p1["id"])}/restore`, {
        versao: arq["versao"],
      }),
    );
    expect(reposto).toMatchObject({ estado: "activo", principal: true });
    await recusa(
      pedir("POST", `/billing-profiles/${String(p1["id"])}/restore`, {
        versao: reposto["versao"],
      }),
      409,
      "customers.invalid_transition",
    );
  });

  it("um perfil usado num documento não muda de NIF, tipo nem país (R4, Q3)", async () => {
    const f = await ficha("Joana");
    const p = await ok(
      perfil(f["id"], {
        tipo: "empresa",
        nome_documento: "Joana, Lda",
        nif: "263631656",
      }),
      201,
    );
    await usadoEmDocumento(String(p["id"]));
    const id = String(p["id"]);
    const versao = Number(
      (await ok(pedir("GET", `/billing-profiles/${id}`)))["versao"],
    );
    await recusa(
      pedir("PATCH", `/billing-profiles/${id}`, {
        versao,
        nif: "FR40303265045",
      }),
      409,
      "customers.profile_used",
    );
    await recusa(
      pedir("PATCH", `/billing-profiles/${id}`, { versao, tipo: "particular" }),
      409,
      "customers.profile_used",
    );
    // A mesma pessoa a escrever o mesmo número de outra maneira, e o nome
    // no documento, mudam.
    const mesmo = await ok(
      pedir("PATCH", `/billing-profiles/${id}`, {
        versao,
        nif: "PT 263 631 656",
        nome_documento: "Joana Costa, Lda",
      }),
    );
    expect(mesmo).toMatchObject({
      nif: "263631656",
      nif_escrito: "PT 263 631 656",
      nome_documento: "Joana Costa, Lda",
      usado_em_documento: true,
    });
    // Um perfil por usar muda o NIF; o país antigo não manda no NIF novo.
    const outro = await ok(
      perfil(f["id"], {
        tipo: "empresa",
        nome_documento: "J",
        nif: "263631656",
      }),
      201,
    );
    const mudado = await ok(
      pedir("PATCH", `/billing-profiles/${String(outro["id"])}`, {
        versao: outro["versao"],
        nif: "FR40303265045",
      }),
    );
    expect(mudado).toMatchObject({
      nif: "FR40303265045",
      pais_contribuinte: "FR",
      estado_vies: "por_validar",
    });
  });

  it("a procura: por e-mail, telefone ou NIF (só o número); nunca pelo nome", async () => {
    const f = await ficha("Beatriz Procura", {
      emails: ["Beatriz.Procura@Exemplo.pt"],
      telefones: ["+351934567890"],
    });
    await ok(
      perfil(f["id"], {
        tipo: "empresa",
        nome_documento: "Beatriz, Lda",
        nif: "513 207 384",
      }),
      201,
    );
    const ids = async (procura: string, segredo = clientes) => {
      const r = await ok(
        pedir("POST", "/customers/search", { procura }, segredo),
      );
      return {
        ids: (r["dados"] as Json[]).map((c) => c["id"]),
        total: r["total"],
      };
    };
    expect(await ids("beatriz.procura@exemplo.pt")).toEqual({
      ids: [f["id"]],
      total: 1,
    });
    expect((await ids("+351934567890")).ids).toEqual([f["id"]]);
    expect((await ids("+351 934-567-890")).ids).toEqual([f["id"]]);
    expect((await ids("PT513207384")).ids).toEqual([f["id"]]);
    expect((await ids("513.207.384")).ids).toEqual([f["id"]]);
    expect((await ids("Beatriz Procura")).ids).toEqual([]);
    // O vizinho não encontra a ficha de A, nem pelo NIF, e-mail ou telefone.
    expect(await ids("513207384", deB)).toEqual({ ids: [], total: 0 });
    expect(await ids("beatriz.procura@exemplo.pt", deB)).toEqual({
      ids: [],
      total: 0,
    });
    expect(await ids("+351934567890", deB)).toEqual({ ids: [], total: 0 });
    // A procura não vai no endereço (R12): o GET recusa o parâmetro.
    expect(
      (await pedir("GET", "/customers?procura=beatriz.procura%40exemplo.pt"))
        .statusCode,
    ).toBe(400);
    // Página a página, com a procura (duas fichas com o mesmo e-mail).
    const g = await ficha("Beatriz Outra", {
      emails: ["beatriz.procura@exemplo.pt"],
    });
    const p1 = await ok(
      pedir("POST", "/customers/search", {
        procura: "beatriz.procura@exemplo.pt",
        limite: 1,
      }),
    );
    expect(p1).toMatchObject({ total: 2, ha_mais: true });
    const p2 = await ok(
      pedir("POST", "/customers/search", {
        procura: "beatriz.procura@exemplo.pt",
        limite: 1,
        cursor: p1["cursor_seguinte"],
      }),
    );
    expect([
      ...(p1["dados"] as Json[]).map((c) => c["id"]),
      ...(p2["dados"] as Json[]).map((c) => c["id"]),
    ]).toEqual([f["id"], g["id"]]);
    expect(p2["ha_mais"]).toBe(false);
  });

  it("o isolamento: a ficha, os perfis e as etiquetas de A não existem para B", async () => {
    const f = await ficha("Isolada");
    const p = await ok(
      perfil(f["id"], { tipo: "particular", nome_documento: "Isolada" }),
      201,
    );
    const t = await ok(
      pedir("POST", "/customer-tags", { nome: "Isolamento" }),
      201,
    );
    for (const [metodo, url, corpo] of [
      ["GET", `/customers/${String(f["id"])}`, undefined],
      ["GET", `/customers/${String(f["id"])}/billing-profiles`, undefined],
      ["GET", `/customers/${String(f["id"])}/timeline`, undefined],
      ["PATCH", `/customers/${String(f["id"])}`, { versao: 1, nome: "B" }],
      ["GET", `/billing-profiles/${String(p["id"])}`, undefined],
      [
        "PATCH",
        `/billing-profiles/${String(p["id"])}`,
        { versao: 1, nome_documento: "B" },
      ],
      ["POST", `/billing-profiles/${String(p["id"])}/make-primary`, undefined],
      ["POST", `/billing-profiles/${String(p["id"])}/archive`, { versao: 1 }],
      ["POST", `/billing-profiles/${String(p["id"])}/restore`, { versao: 1 }],
      ["GET", `/customer-tags/${String(t["id"])}`, undefined],
      ["PATCH", `/customer-tags/${String(t["id"])}`, { versao: 1, nome: "B" }],
      ["POST", `/customer-tags/${String(t["id"])}/archive`, { versao: 1 }],
      [
        "DELETE",
        `/customers/${String(f["id"])}/tags/${String(t["id"])}`,
        undefined,
      ],
      [
        "POST",
        `/customers/${String(f["id"])}/billing-profiles`,
        { tipo: "particular", nome_documento: "B" },
      ],
    ] as const) {
      await recusa(pedir(metodo, url, corpo, deB), 404, "customers.not_found");
    }
    // Uma etiqueta de A numa ficha de B.
    const deB1 = await ok(
      pedir("POST", "/customers", { nome: "De B" }, deB),
      201,
    );
    await recusa(
      pedir(
        "PUT",
        `/customers/${String(deB1["id"])}/tags/${String(t["id"])}`,
        undefined,
        deB,
      ),
      404,
      "customers.not_found",
    );
    // As listas de B não trazem nada de A; o nome da etiqueta só é único
    // dentro de cada comerciante.
    const fichasDeB = await ok(
      pedir("GET", "/customers?limite=100", undefined, deB),
    );
    expect((fichasDeB["dados"] as Json[]).map((c) => c["id"])).not.toContain(
      f["id"],
    );
    const tDeB = await ok(
      pedir("POST", "/customer-tags", { nome: "Isolamento" }, deB),
      201,
    );
    const etiquetasDeB = await ok(
      pedir("GET", "/customer-tags?limite=100", undefined, deB),
    );
    expect((etiquetasDeB["dados"] as Json[]).map((e) => e["id"])).toEqual([
      tDeB["id"],
    ]);
    // Uma lista B2B de A não aponta para a etiqueta (real) de B: a chave
    // estrangeira é composta com o comerciante.
    const m = await ok(
      pedir(
        "POST",
        "/markets",
        {
          loja,
          nome: "Áustria",
          paises: ["AT"],
          moeda: "EUR",
          linguas: ["de"],
          lingua_principal: "de",
        },
        precos,
      ),
      201,
    );
    await recusa(
      pedir(
        "POST",
        "/price-lists",
        {
          mercado: m["id"],
          nome: "Pro",
          tipo: "b2b",
          etiqueta: tDeB["id"],
          prioridade: 1,
        },
        precos,
      ),
      404,
      "prices.not_found",
    );
  });

  it("as etiquetas: nome único, na ficha, na lista B2B; em uso não se arquivam", async () => {
    const t = await ok(
      pedir("POST", "/customer-tags", { nome: "Profissionais" }),
      201,
    );
    expect(String(t["id"])).toMatch(/^ctg_/);
    await recusa(
      pedir("POST", "/customer-tags", { nome: " profissionais" }),
      409,
      "customers.tag_duplicate",
    );
    const f = await ficha("Carla");
    const com = await ok(
      pedir("PUT", `/customers/${String(f["id"])}/tags/${String(t["id"])}`),
    );
    expect(com["etiquetas"]).toEqual([t["id"]]);
    // Pôr outra vez não muda nada.
    expect(
      (
        await ok(
          pedir("PUT", `/customers/${String(f["id"])}/tags/${String(t["id"])}`),
        )
      )["etiquetas"],
    ).toEqual([t["id"]]);

    // A lista B2B aponta para a etiqueta, com o prefixo.
    const m = await ok(
      pedir(
        "POST",
        "/markets",
        {
          loja,
          nome: "Portugal",
          paises: ["PT"],
          moeda: "EUR",
          linguas: ["pt"],
          lingua_principal: "pt",
        },
        precos,
      ),
      201,
    );
    const lista = await ok(
      pedir(
        "POST",
        "/price-lists",
        {
          mercado: m["id"],
          nome: "Profissionais",
          tipo: "b2b",
          etiqueta: t["id"],
          prioridade: 1,
        },
        precos,
      ),
      201,
    );
    expect(lista["etiqueta"]).toBe(t["id"]);
    // Uma etiqueta que não existe (ou de outro comerciante) não entra.
    await recusa(
      pedir(
        "POST",
        "/price-lists",
        {
          mercado: m["id"],
          nome: "Outra",
          tipo: "b2b",
          etiqueta: `ctg_${randomUUID()}`,
          prioridade: 2,
        },
        precos,
      ),
      404,
      "prices.not_found",
    );
    await recusa(
      pedir("POST", `/customer-tags/${String(t["id"])}/archive`, {
        versao: t["versao"],
      }),
      409,
      "customers.tag_in_use",
    );
    await ok(
      pedir(
        "POST",
        `/price-lists/${String(lista["id"])}/archive`,
        { versao: lista["versao"] },
        precos,
      ),
    );
    const arq = await ok(
      pedir("POST", `/customer-tags/${String(t["id"])}/archive`, {
        versao: t["versao"],
      }),
    );
    expect(arq["estado"]).toBe("arquivada");
    const g = await ficha("Gil");
    await recusa(
      pedir("PUT", `/customers/${String(g["id"])}/tags/${String(t["id"])}`),
      409,
      "customers.tag_archived",
    );
    // Repor a lista com a etiqueta arquivada é recusado.
    const listaAgora = await ok(
      pedir("GET", `/price-lists/${String(lista["id"])}`, undefined, precos),
    );
    await recusa(
      pedir(
        "POST",
        `/price-lists/${String(lista["id"])}/restore`,
        { versao: listaAgora["versao"] },
        precos,
      ),
      409,
      "prices.label_archived",
    );
    // Tirar da ficha (a etiqueta arquivada continua na ficha até se tirar).
    const sem = await ok(
      pedir("DELETE", `/customers/${String(f["id"])}/tags/${String(t["id"])}`),
    );
    expect(sem["etiquetas"]).toEqual([]);
    const etiquetas = await ok(pedir("GET", "/customer-tags"));
    expect((etiquetas["dados"] as Json[]).map((e) => e["id"])).toContain(
      t["id"],
    );
  });

  it("a linha do tempo: quem, o quê, o antes e o depois, da ficha, dos perfis e das etiquetas", async () => {
    const f = await ficha("Diana", { emails: ["diana@exemplo.pt"] });
    const id = String(f["id"]);
    await ok(
      pedir("PATCH", `/customers/${id}`, { versao: 1, nome: "Diana R." }),
    );
    const p = await ok(
      perfil(f["id"], { tipo: "particular", nome_documento: "Diana" }),
      201,
    );
    const t = await ok(
      pedir("POST", "/customer-tags", { nome: "Diana VIP" }),
      201,
    );
    await ok(pedir("PUT", `/customers/${id}/tags/${String(t["id"])}`));
    await ok(pedir("DELETE", `/customers/${id}/tags/${String(t["id"])}`));
    const r = await ok(pedir("GET", `/customers/${id}/timeline`));
    const dados = r["dados"] as Json[];
    expect(r["total"]).toBe(5);
    expect(dados.map((d) => [d["entidade"], d["operacao"]])).toEqual([
      ["cliente_etiqueta", "apagado"],
      ["cliente_etiqueta", "criado"],
      ["perfil_faturacao", "criado"],
      ["cliente", "alterado"],
      ["cliente", "criado"],
    ]);
    expect(dados[2]?.["entidade_id"]).toBe(p["id"]);
    expect(dados[3]).toMatchObject({
      quem: `chave:key_${clientesId}`,
      entidade_id: id,
      // O nome é sensível (docs/28 §3.4; 0054): diz que mudou, nunca o valor.
      campos: {
        nome: {
          antes: {
            protegido: true,
            resumo: expect.stringMatching(/^[0-9a-f]{8}$/) as string,
          },
          depois: {
            protegido: true,
            resumo: expect.stringMatching(/^[0-9a-f]{8}$/) as string,
          },
        },
      },
    });
    const nome = (
      dados[3]?.["campos"] as Record<string, { antes: Json; depois: Json }>
    )["nome"];
    expect(nome?.antes["resumo"]).not.toBe(nome?.depois["resumo"]);
    expect(JSON.stringify(dados)).not.toContain("Diana R.");
    // Paginação: dois de cada vez, sem repetir.
    const p1 = await ok(pedir("GET", `/customers/${id}/timeline?limite=2`));
    const p2 = await ok(
      pedir(
        "GET",
        `/customers/${id}/timeline?limite=2&cursor=${String(p1["cursor_seguinte"])}`,
      ),
    );
    expect([...(p1["dados"] as Json[]), ...(p2["dados"] as Json[])]).toEqual(
      dados.slice(0, 4),
    );
  });

  it("sem quem, nenhuma escrita passa (o rasto é obrigatório)", async () => {
    await expect(
      base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
          trx,
        );
        await sql`insert into cliente (comerciante_id, nome) values (${a}, 'Sem quem')`.execute(
          trx,
        );
      }),
    ).rejects.toThrow(/customers.change_without_who/);
  });

  it("R4 também no país; repor um perfil com outro principal não o faz principal", async () => {
    const f = await ficha("Inês");
    const p = await ok(
      perfil(f["id"], {
        tipo: "empresa",
        nome_documento: "Inês, Lda",
        nif: "263631656",
      }),
      201,
    );
    await usadoEmDocumento(String(p["id"]));
    const id = String(p["id"]);
    const agora = await ok(pedir("GET", `/billing-profiles/${id}`));
    await recusa(
      pedir("PATCH", `/billing-profiles/${id}`, {
        versao: agora["versao"],
        // O mesmo número, outro país.
        pais_contribuinte: "FR",
      }),
      409,
      "customers.profile_used",
    );
    // Dois perfis; arquiva-se o segundo, troca-se o principal para ele não
    // ser possível (arquivado), repõe-se: fica não principal.
    const q = await ok(
      perfil(f["id"], { tipo: "particular", nome_documento: "Inês" }),
      201,
    );
    const arq = await ok(
      pedir("POST", `/billing-profiles/${String(q["id"])}/archive`, {
        versao: q["versao"],
      }),
    );
    const reposto = await ok(
      pedir("POST", `/billing-profiles/${String(q["id"])}/restore`, {
        versao: arq["versao"],
      }),
    );
    expect(reposto).toMatchObject({ estado: "activo", principal: false });
  });

  it("em concorrência: dois primeiros perfis da mesma ficha dão um só principal", async () => {
    const f = await ficha("Concorrência");
    const [r1, r2] = await Promise.all([
      perfil(f["id"], { tipo: "particular", nome_documento: "Um" }),
      perfil(f["id"], { tipo: "particular", nome_documento: "Dois" }),
    ]);
    expect([r1.statusCode, r2.statusCode]).toEqual([201, 201]);
    const principais = [r1.json<Json>(), r2.json<Json>()].filter(
      (p) => p["principal"] === true,
    );
    expect(principais).toHaveLength(1);
  });

  it("em concorrência: arquivar a etiqueta e repor a lista B2B dela — a lista espera e é recusada", async () => {
    const t = await ok(
      pedir("POST", "/customer-tags", { nome: "Corrida" }),
      201,
    );
    const m = await ok(
      pedir(
        "POST",
        "/markets",
        {
          loja,
          nome: "Bélgica",
          paises: ["BE"],
          moeda: "EUR",
          linguas: ["fr"],
          lingua_principal: "fr",
        },
        precos,
      ),
      201,
    );
    const lista = await ok(
      pedir(
        "POST",
        "/price-lists",
        {
          mercado: m["id"],
          nome: "Corrida",
          tipo: "b2b",
          etiqueta: t["id"],
          prioridade: 1,
        },
        precos,
      ),
      201,
    );
    const arquivada = await ok(
      pedir(
        "POST",
        `/price-lists/${String(lista["id"])}/archive`,
        { versao: lista["versao"] },
        precos,
      ),
    );
    expect(arquivada["estado"]).toBe("arquivada");
    const ligar = async () => {
      const l = new pg.Client({ connectionString: base.urlApi });
      await l.connect();
      await l.query("begin");
      await l.query(
        "select set_config('eurolify.comerciante', $1, true), set_config('eurolify.quem', 'teste:corrida', true)",
        [a],
      );
      return l;
    };
    const l1 = await ligar();
    const l2 = await ligar();
    try {
      await l1.query(
        "update etiqueta_cliente set estado = 'arquivada' where id = $1",
        [String(t["id"]).slice(4)],
      );
      const pid2 = (
        await l2.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0]?.pid;
      const repor = l2
        .query("update lista_precos set estado = 'activa' where id = $1", [
          String(lista["id"]).slice(4),
        ])
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      // A segunda espera pela primeira (o FOR SHARE na etiqueta).
      let esperou = false;
      for (let i = 0; i < 100 && !esperou; i++) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity
          where pid = ${pid2} and wait_event_type = 'Lock'`.execute(base.dono);
        esperou = (rows[0]?.n ?? 0) > 0;
        if (!esperou) await new Promise((r) => setTimeout(r, 50));
      }
      expect(esperou).toBe(true);
      await l1.query("commit");
      const erro = await repor;
      expect(String(erro)).toMatch(/prices.label_archived/);
      await l2.query("rollback");
    } finally {
      await l1.end();
      await l2.end();
    }
  });

  it("os eventos: só identificadores e os nomes dos campos, nunca o e-mail nem o NIF", async () => {
    const f = await ficha("Eva Evento", { emails: ["eva@exemplo.pt"] });
    const id = String(f["id"]).slice(4);
    await ok(
      pedir("PATCH", `/customers/${String(f["id"])}`, {
        versao: 1,
        emails: ["eva.nova@exemplo.pt"],
      }),
    );
    const p = await ok(
      perfil(f["id"], {
        tipo: "empresa",
        nome_documento: "Eva, Lda",
        nif: "263631656",
      }),
      201,
    );
    const { rows } = await base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
        trx,
      );
      return sql<{ tipo: string; dados: Json }>`
        select tipo, dados from evento_saida
        where agregado_id in (${id}::uuid, ${String(p["id"]).slice(4)}::uuid)
        order by criado_em, id`.execute(trx);
    });
    expect(rows.map((r) => r.tipo)).toEqual([
      "customer.created",
      "customer.updated",
      "billing_profile.created",
    ]);
    expect(rows[1]?.dados).toMatchObject({
      cliente_id: id,
      campos: ["emails"],
      quem: `chave:key_${clientesId}`,
    });
    const texto = JSON.stringify(rows);
    expect(texto).not.toContain("exemplo.pt");
    expect(texto).not.toContain("263631656");
    expect(texto).not.toContain("Eva");
  });
});
