import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
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

// Clientes, parte 2b: duplicados e fusões (docs/23 §3.7; migração 0045;
// Diogo, 10/10/2026: os perfis copiam-se, opção A). O servidor sinaliza e
// nunca funde; uma pessoa funde, com ensaio; nada do que já foi vendido muda.

type Json = Record<string, unknown>;

/** Um NIF português válido e novo (o dígito de controlo calculado). */
let semente = 2_000_000;
function nifNovo(): string {
  const corpo = `2${String(semente++).padStart(7, "0")}`;
  let soma = 0;
  for (let i = 0; i < corpo.length; i++) soma += Number(corpo[i]) * (9 - i);
  const resto = soma % 11;
  return `${corpo}${String(resto < 2 ? 0 : 11 - resto)}`;
}
let sequencia = 0;
const unico = () => `${Date.now().toString(36)}${String(sequencia++)}`;

describe.skipIf(URL_BASE === undefined)("duplicados e fusões", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let b: string;
  let dono: string;
  let donoId: string;
  let semFusoes: string;
  let deB: string;

  const pedir = (
    metodo: "POST" | "GET" | "PATCH" | "PUT",
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
  const recusa = async (
    r: ReturnType<typeof pedir>,
    estado: number,
    codigo?: string,
  ) => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(estado);
    if (codigo !== undefined) expect(x.json<Json>()["codigo"]).toBe(codigo);
  };

  const ficha = async (dados: Json, segredo = dono) =>
    String((await ok(pedir("POST", "/customers", dados, segredo), 201))["id"]);
  const perfil = async (cliente: string, dados: Json) =>
    ok(pedir("POST", `/customers/${cliente}/billing-profiles`, dados), 201);
  const candidatos = async (estado = "por_decidir", segredo = dono) =>
    (
      await ok(
        pedir(
          "GET",
          `/customer-duplicates?estado=${estado}&limite=100`,
          undefined,
          segredo,
        ),
      )
    )["dados"] as Json[];
  const doPar = async (x: string, y: string, estado = "por_decidir") =>
    (await candidatos(estado)).find(
      (d) =>
        (d["clientes"] as string[]).includes(x) &&
        (d["clientes"] as string[]).includes(y),
    );
  const fundir = (fica: string, absorver: string, ensaio = false) =>
    pedir("POST", `/customers/${fica}/merge`, { absorver, ensaio });
  const regua = async (cliente: string) =>
    (await ok(pedir("GET", `/customers/${cliente}/consents`)))[
      "pode_receber_marketing"
    ] as Json;
  const declarar = (cliente: string, d: "aceitou" | "retirou") =>
    ok(
      pedir("POST", `/customers/${cliente}/consents`, {
        canal: "email",
        declaracao: d,
        texto: "Quero receber novidades.",
        versao_texto: "v1",
        onde: "loja, registo",
      }),
      201,
    );

  /** O dono da base, no comerciante A, numa transacção que fica. */
  async function comoDono<T>(fn: (trx: Kysely<unknown>) => Promise<T>) {
    return base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
        trx,
      );
      await sql`select set_config('eurolify.quem', 'teste:sql', true)`.execute(
        trx,
      );
      return fn(trx);
    });
  }

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
    await criarEntidadeLegal(base.api, a, {
      denominacao: "A, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "509999990",
      morada_linha: "Rua 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
    const chave = (c: string, nome: string, ambitos: string[]) =>
      criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome,
        ambitos: ambitos as never,
      });
    const todos = [
      "customers:read",
      "customers:write",
      "customers:billing",
      "customers:exemptions",
      "customers:merge",
    ];
    const d = await chave(a, "Dono", todos);
    dono = d.segredo;
    donoId = d.id;
    semFusoes = (
      await chave(a, "Sem fusões", [
        "customers:read",
        "customers:write",
        "customers:billing",
      ])
    ).segredo;
    deB = (await chave(b, "B", todos)).segredo;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("os sinais: e-mail sem maiúsculas e telefone são «talvez», o NIF particular é forte; o NIF de empresa e o nome não são sinal", async () => {
    const u = unico();
    const ana = await ficha({ nome: "Ana Silva", emails: [`ana.${u}@ex.pt`] });
    const ana2 = await ficha({
      nome: "A. Silva",
      emails: [`ANA.${u}@EX.PT`],
    });
    const par = await doPar(ana, ana2);
    expect(par).toMatchObject({ sinais: ["email"], forte: false });
    expect(String(par?.["id"])).toMatch(/^dup_/);
    // Só o tipo do sinal; nunca o e-mail.
    expect(JSON.stringify(par)).not.toContain(u);

    const tel = `+3519${String(10_000_000 + sequencia++).padStart(8, "0")}`;
    const t1 = await ficha({ nome: "T1", telefones: [tel] });
    const t2 = await ficha({ nome: "T2", telefones: [tel] });
    expect(await doPar(t1, t2)).toMatchObject({ sinais: ["telefone"] });

    const nif = nifNovo();
    const p1 = await ficha({ nome: "P1" });
    const p2 = await ficha({ nome: "P2" });
    await perfil(p1, { tipo: "particular", nome_documento: "P1", nif });
    await perfil(p2, { tipo: "particular", nome_documento: "P2", nif });
    expect(await doPar(p1, p2)).toMatchObject({
      sinais: ["nif_particular"],
      forte: true,
    });

    // Q2: dois funcionários da mesma empresa não são a mesma pessoa.
    const nifEmpresa = nifNovo();
    const e1 = await ficha({ nome: "Funcionário 1" });
    const e2 = await ficha({ nome: "Funcionário 2" });
    await perfil(e1, {
      tipo: "empresa",
      nome_documento: "Salão, Lda",
      nif: nifEmpresa,
    });
    await perfil(e2, {
      tipo: "empresa",
      nome_documento: "Salão, Lda",
      nif: nifEmpresa,
    });
    expect(await doPar(e1, e2)).toBeUndefined();

    // O mesmo nome não é sinal.
    const n1 = await ficha({ nome: `Maria ${u}` });
    const n2 = await ficha({ nome: `Maria ${u}` });
    expect(await doPar(n1, n2)).toBeUndefined();
  });

  it("isolamento: o mesmo e-mail noutro comerciante não é candidato, e B não vê a fila de A", async () => {
    const u = unico();
    const deA = await ficha({ nome: "X", emails: [`x.${u}@ex.pt`] });
    const outroB = await ficha({ nome: "X", emails: [`x.${u}@ex.pt`] }, deB);
    const todosB = await candidatos("por_decidir", deB);
    expect(todosB.some((d) => (d["clientes"] as string[]).includes(deA))).toBe(
      false,
    );
    expect(
      (await candidatos()).some((d) =>
        (d["clientes"] as string[]).includes(outroB),
      ),
    ).toBe(false);
    const meu = await ficha({ nome: "Y", emails: [`x.${u}@ex.pt`] });
    const par = await doPar(deA, meu);
    await recusa(
      pedir(
        "POST",
        `/customer-duplicates/${String(par?.["id"])}/dismiss`,
        {},
        deB,
      ),
      404,
      "customers.not_found",
    );
    await ok(fundir(deA, meu));
    // B não funde fichas de A.
    const z1 = await ficha({ nome: "Z1" });
    const z2 = await ficha({ nome: "Z2" });
    await recusa(
      pedir(
        "POST",
        `/customers/${z1}/merge`,
        { absorver: z2, ensaio: true },
        deB,
      ),
      404,
      "customers.not_found",
    );
  });

  it("descartar: por quem tem customers:merge, com motivo e na linha do tempo; uma vez; um sinal novo volta a pô-lo por decidir", async () => {
    const u = unico();
    const x = await ficha({ nome: "Rui", emails: [`rui.${u}@ex.pt`] });
    const y = await ficha({ nome: "Rui", emails: [`rui.${u}@ex.pt`] });
    const par = await doPar(x, y);
    const id = String(par?.["id"]);
    await recusa(
      pedir(
        "POST",
        `/customer-duplicates/${id}/dismiss`,
        { motivo: "pai e filho" },
        semFusoes,
      ),
      403,
    );
    const d = await ok(
      pedir("POST", `/customer-duplicates/${id}/dismiss`, {
        motivo: "pai e filho com o mesmo e-mail",
      }),
    );
    expect(d).toMatchObject({
      estado: "descartado",
      motivo: "pai e filho com o mesmo e-mail",
      decidido_por: `chave:key_${donoId}`,
    });
    await recusa(
      pedir("POST", `/customer-duplicates/${id}/dismiss`, {}),
      409,
      "customers.duplicate_decided",
    );
    const [primeira] = par?.["clientes"] as string[];
    const t = await ok(pedir("GET", `/customers/${String(primeira)}/timeline`));
    expect(
      (t["dados"] as Json[]).find((l) => l["entidade"] === "duplicado_cliente"),
    ).toMatchObject({
      entidade_id: id,
      operacao: "alterado",
      campos: { estado: { antes: "por_decidir", depois: "descartado" } },
    });

    // O mesmo sinal outra vez não muda nada; um sinal novo reabre.
    const tel = `+3519${String(20_000_000 + sequencia++).padStart(8, "0")}`;
    const fx = await ok(pedir("GET", `/customers/${x}`));
    await ok(
      pedir("PATCH", `/customers/${x}`, {
        versao: fx["versao"],
        telefones: [tel],
      }),
    );
    expect(await doPar(x, y, "descartado")).toBeDefined();
    const fy = await ok(pedir("GET", `/customers/${y}`));
    await ok(
      pedir("PATCH", `/customers/${y}`, {
        versao: fy["versao"],
        telefones: [tel],
      }),
    );
    expect(await doPar(x, y)).toMatchObject({
      estado: "por_decidir",
      sinais: ["email", "telefone"],
      decidido_por: null,
      motivo: null,
    });
  });

  it("o ensaio diz o que mudaria e não escreve nada", async () => {
    const u = unico();
    const fica = await ficha({ nome: "Ana", emails: [`a.${u}@ex.pt`] });
    const sai = await ficha({
      nome: "Ana S.",
      emails: [`b.${u}@ex.pt`, `A.${u}@EX.PT`],
    });
    await perfil(sai, { tipo: "particular", nome_documento: "Ana S." });
    const plano = await ok(fundir(fica, sai, true));
    expect(plano).toMatchObject({
      ensaio: true,
      fica,
      absorvida: sai,
      emails_acrescentados: [`b.${u}@ex.pt`],
      perfis_iguais_nao_copiados: [],
      consentimentos_da_absorvida: 0,
      encomendas_ficam_na_absorvida: 0,
      limitado: false,
    });
    const copiados = plano["perfis_copiados"] as Json[];
    expect(copiados).toHaveLength(1);
    expect(String(copiados[0]?.["de"])).toMatch(/^bpf_/);
    expect(copiados[0]?.["para"]).toBeNull();
    expect(await ok(pedir("GET", `/customers/${sai}`))).toMatchObject({
      estado: "activo",
      fundido_em: null,
    });
    expect(await ok(pedir("GET", `/customers/${fica}`))).toMatchObject({
      emails: [`a.${u}@ex.pt`],
      versao: 1,
    });
    expect(await doPar(fica, sai)).toMatchObject({ estado: "por_decidir" });
    const eventos = await comoDono(
      async (trx) =>
        (
          await sql<{ n: string }>`
          select count(*) as n from evento_saida
          where tipo = 'customer.merged' and agregado_id = ${fica.slice(4)}::uuid`.execute(
            trx,
          )
        ).rows[0]?.n,
    );
    expect(eventos).toBe("0");
    expect(
      (await ok(pedir("GET", `/customers/${fica}/billing-profiles`)))[
        "dados"
      ] as Json[],
    ).toHaveLength(0);
  });

  it("a fusão: a absorvida fica fundida com tudo o que tinha; a que fica recebe contactos, etiquetas e cópias dos perfis; a isenção não se copia", async () => {
    const u = unico();
    const nif = nifNovo();
    const telFica = `+3519${String(30_000_000 + sequencia++).padStart(8, "0")}`;
    const telSai = `+3519${String(30_000_000 + sequencia++).padStart(8, "0")}`;
    const fica = await ficha({
      nome: "Ana Silva",
      emails: [`ana.${u}@ex.pt`],
      telefones: [telFica],
    });
    const sai = await ficha({
      nome: "A. Silva",
      emails: [`ANA.${u}@ex.pt`, `trabalho.${u}@ex.pt`],
      telefones: [telSai],
    });
    const igual = { tipo: "particular", nome_documento: "Ana Silva" };
    await perfil(fica, igual);
    const pIgual = await perfil(sai, igual);
    const pNif = await perfil(sai, {
      tipo: "particular",
      nome_documento: "Ana Silva",
      nif,
    });
    const pFr = await perfil(sai, {
      tipo: "empresa",
      nome_documento: "Ana SARL",
      nif: "FR40303265045",
    });
    await ok(
      pedir("PUT", `/billing-profiles/${String(pFr["id"])}/exemption`, {
        codigo_motivo: "M05",
        motivo: "transportadora própria",
      }),
      201,
    );
    const tActiva = await ok(
      pedir("POST", "/customer-tags", { nome: `VIP ${u}` }),
      201,
    );
    const tArquivada = await ok(
      pedir("POST", "/customer-tags", { nome: `Antiga ${u}` }),
      201,
    );
    for (const t of [tActiva, tArquivada]) {
      await ok(pedir("PUT", `/customers/${sai}/tags/${String(t["id"])}`));
    }
    await ok(
      pedir("POST", `/customer-tags/${String(tArquivada["id"])}/archive`, {
        versao: tArquivada["versao"],
      }),
    );
    await declarar(sai, "aceitou");
    // Um terceiro candidato da absorvida, que fecha com a fusão.
    const terceira = await ficha({
      nome: "Outra",
      emails: [`trabalho.${u}@ex.pt`],
    });
    expect(await doPar(sai, terceira)).toBeDefined();
    expect(await doPar(fica, sai)).toBeDefined();
    expect((await regua(fica))["email"]).toBe(false);

    const plano = await ok(fundir(fica, sai));
    expect(plano).toMatchObject({
      ensaio: false,
      emails_acrescentados: [`trabalho.${u}@ex.pt`],
      telefones_acrescentados: [telSai],
      perfis_iguais_nao_copiados: [pIgual["id"]],
      isencoes_por_repor: [pFr["id"]],
      etiquetas_copiadas: [tActiva["id"]],
      etiquetas_arquivadas_nao_copiadas: [tArquivada["id"]],
      consentimentos_da_absorvida: 1,
      limitado: false,
    });
    const copias = plano["perfis_copiados"] as { de: string; para: string }[];
    expect(copias.map((c) => c.de)).toEqual([pNif["id"], pFr["id"]]);

    // A absorvida: fundida, com os perfis dela onde estavam.
    const fundida = await ok(pedir("GET", `/customers/${sai}`));
    expect(fundida).toMatchObject({ estado: "fundido", fundido_em: fica });
    expect(
      await ok(pedir("GET", `/billing-profiles/${String(pFr["id"])}`)),
    ).toMatchObject({ cliente: sai, isencao_em_vigor: true });
    await recusa(
      pedir("PATCH", `/customers/${sai}`, {
        versao: fundida["versao"],
        nome: "X",
      }),
      409,
      "customers.invalid_transition",
    );

    // A que fica: os contactos pela ordem, a etiqueta activa, as cópias.
    expect(await ok(pedir("GET", `/customers/${fica}`))).toMatchObject({
      estado: "activo",
      emails: [`ana.${u}@ex.pt`, `trabalho.${u}@ex.pt`],
      telefones: [telFica, telSai],
      etiquetas: [tActiva["id"]],
    });
    const perfisFica = (
      await ok(pedir("GET", `/customers/${fica}/billing-profiles`))
    )["dados"] as Json[];
    expect(perfisFica).toHaveLength(3);
    const copiaFr = perfisFica.find((p) => p["copiado_de"] === pFr["id"]);
    expect(copiaFr).toMatchObject({
      cliente: fica,
      nif: "FR40303265045",
      principal: false,
      isencao_em_vigor: false,
      usado_em_documento: false,
      estado_vies: "por_validar",
    });
    expect(copiaFr?.["id"]).toBe(copias[1]?.para);

    // Os consentimentos: a régua da que fica conta os da absorvida; uma
    // retirada pedida com o id antigo vale na que ficou.
    expect((await regua(fica))["email"]).toBe(true);
    const r = await declarar(sai, "retirou");
    expect(r["cliente"]).toBe(fica);
    expect((await regua(fica))["email"]).toBe(false);
    expect(
      (await ok(pedir("GET", `/customers/${fica}/consents`)))["total"],
    ).toBe(2);

    // A fila: o par fundido, o outro da absorvida fechado.
    expect(await doPar(fica, sai, "fundido")).toMatchObject({
      decidido_por: `chave:key_${donoId}`,
    });
    expect(await doPar(sai, terceira, "fechado")).toBeDefined();
    // A que fica herdou o e-mail: o terceiro é agora candidato dela.
    expect(await doPar(fica, terceira)).toMatchObject({ sinais: ["email"] });

    // O evento, só com identificadores.
    const eventos = await comoDono(
      async (trx) =>
        (
          await sql<{ dados: Json }>`
          select dados from evento_saida
          where tipo = 'customer.merged' and agregado_id = ${fica.slice(4)}::uuid`.execute(
            trx,
          )
        ).rows,
    );
    expect(eventos).toHaveLength(1);
    expect(Object.keys(eventos[0]?.dados ?? {}).sort()).toEqual([
      "absorvido_id",
      "cliente_id",
      "em",
      "quem",
    ]);

    // Uma fundida não volta a fundir-se.
    await recusa(fundir(terceira, sai), 409, "customers.invalid_transition");
  });

  it("a limitação de uma passa à que fica", async () => {
    const fica = await ficha({ nome: "L1" });
    const sai = await ficha({ nome: "L2" });
    await comoDono((trx) =>
      sql`update cliente set limitado = true where id = ${sai.slice(4)}::uuid`.execute(
        trx,
      ),
    );
    expect(await ok(fundir(fica, sai))).toMatchObject({ limitado: true });
    expect(await ok(pedir("GET", `/customers/${fica}`))).toMatchObject({
      limitado: true,
    });
  });

  it("fusões encadeadas: a régua da última conta as declarações de todas", async () => {
    const x = await ficha({ nome: "X" });
    const y = await ficha({ nome: "Y" });
    const z = await ficha({ nome: "Z" });
    await declarar(x, "aceitou");
    await ok(fundir(y, x));
    await ok(fundir(z, y));
    expect((await regua(z))["email"]).toBe(true);
    // Uma declaração com o id mais antigo segue a cadeia até à activa.
    expect((await declarar(x, "retirou"))["cliente"]).toBe(z);
    expect((await regua(z))["email"]).toBe(false);
  });

  it("as recusas: a mesma ficha, contactos a mais, sem customers:merge, um processo de sistema", async () => {
    const x = await ficha({ nome: "X" });
    await recusa(fundir(x, x), 422, "customers.merge_same");
    const u = unico();
    const muitos = (p: string) =>
      Array.from({ length: 6 }, (_, i) => `${p}${String(i)}.${u}@ex.pt`);
    const m1 = await ficha({ nome: "M1", emails: muitos("a") });
    const m2 = await ficha({ nome: "M2", emails: muitos("b") });
    await recusa(fundir(m1, m2), 409, "customers.merge_too_many_contacts");
    await recusa(
      pedir(
        "POST",
        `/customers/${m1}/merge`,
        { absorver: m2, ensaio: true },
        semFusoes,
      ),
      403,
    );
    const erro = await comoDono(async (trx) => {
      await sql`select set_config('eurolify.quem', 'sistema:importacao', true)`.execute(
        trx,
      );
      return sql`select cliente_fundir(${m1.slice(4)}::uuid, ${m2.slice(4)}::uuid, true)`
        .execute(trx)
        .then(
          () => "fundiu",
          (e: unknown) => (e as Error).message,
        );
    });
    expect(erro).toMatch(/^customers\.merge_by_person:/);
    await recusa(
      pedir("POST", `/customers/${m1}/merge`, { absorver: m2 }),
      400,
    );
  });

  it("duas fusões ao contrário ao mesmo tempo: uma passa, a outra é recusada, sem interbloqueio", async () => {
    for (let volta = 0; volta < 3; volta++) {
      const x = await ficha({ nome: "X" });
      const y = await ficha({ nome: "Y" });
      const r = await Promise.all([fundir(x, y), fundir(y, x)]);
      expect(r.map((v) => v.statusCode).sort()).toEqual([200, 409]);
      expect(r.find((v) => v.statusCode === 409)?.json<Json>()["codigo"]).toBe(
        "customers.invalid_transition",
      );
    }
  });
});
