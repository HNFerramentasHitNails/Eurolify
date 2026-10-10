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

// Clientes, parte 2c: os pedidos do titular (docs/23 §4.1, R9, §7.1;
// migração 0049). A pseudonimização é irreversível: estes testes provam o que
// sai, o que fica (o que a lei fiscal obriga a guardar) e que as recusas só
// se abrem dentro dela.

type Json = Record<string, unknown>;

let sequencia = 0;
const unico = () => `${Date.now().toString(36)}${String(sequencia++)}`;
let semente = 3_000_000;
function nifNovo(): string {
  const corpo = `2${String(semente++).padStart(7, "0")}`;
  let soma = 0;
  for (let i = 0; i < corpo.length; i++) soma += Number(corpo[i]) * (9 - i);
  const resto = soma % 11;
  return `${corpo}${String(resto < 2 ? 0 : 11 - resto)}`;
}

describe.skipIf(URL_BASE === undefined)("pedidos do titular", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let b: string;
  let dono: string;
  let donoId: string;
  let semPrivacidade: string;
  let deB: string;

  const pedir = (
    metodo: "POST" | "GET" | "PATCH" | "PUT" | "DELETE",
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
  const declarar = (cliente: string) =>
    ok(
      pedir("POST", `/customers/${cliente}/consents`, {
        canal: "email",
        declaracao: "aceitou",
        texto: "Quero receber novidades.",
        versao_texto: "v1",
        onde: "loja, registo",
      }),
      201,
    );
  const verificacao = "resposta do e-mail da ficha a 10/10/2026";
  const pseudonimizar = (id: string, segredo = dono, confirmacao?: string) =>
    pedir(
      "POST",
      `/customers/${id}/pseudonymize`,
      { verificacao, confirmacao: confirmacao ?? `pseudonimizar ${id}` },
      segredo,
    );

  /** O dono da base, no comerciante A; `quem` à escolha. */
  async function comoDono<T>(
    fn: (trx: Kysely<unknown>) => Promise<T>,
    quem = "teste:sql",
  ) {
    return base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
        trx,
      );
      await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
      return fn(trx);
    });
  }
  const erroDe = (p: Promise<unknown>) =>
    p.then(
      () => "passou",
      (e: unknown) => (e as Error).message,
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
      "customers:privacy",
    ];
    const d = await chave(a, "Dono", todos);
    dono = d.segredo;
    donoId = d.id;
    semPrivacidade = (
      await chave(
        a,
        "Sem privacidade",
        todos.filter((x) => x !== "customers:privacy"),
      )
    ).segredo;
    deB = (await chave(b, "B", todos)).segredo;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("a pseudonimização apaga os dados pessoais do grupo inteiro, também da linha do tempo, e regista o pedido", async () => {
    const u = unico();
    const nif = nifNovo();
    const id = await ficha({
      nome: `Ana ${u}`,
      emails: [`ana.${u}@ex.pt`],
      telefones: ["+351912345678"],
      lingua: "pt",
      pais: "PT",
    });
    const f = await ok(pedir("GET", `/customers/${id}`));
    await ok(
      pedir("PATCH", `/customers/${id}`, {
        versao: f["versao"],
        nome: `Ana Silva ${u}`,
      }),
    );
    const pPart = await perfil(id, {
      tipo: "particular",
      nome_documento: `Ana Silva ${u}`,
      nif,
      morada: {
        linha1: `Rua da Ana ${u}`,
        codigo_postal: "1000-001",
        localidade: "Lisboa",
        pais: "PT",
      },
    });
    const pFr = await perfil(id, {
      tipo: "empresa",
      nome_documento: `Ana SARL ${u}`,
      nif: "FR40303265045",
    });
    await ok(
      pedir("PUT", `/billing-profiles/${String(pFr["id"])}/exemption`, {
        codigo_motivo: "M05",
        motivo: "transportadora própria",
        nota: `falado com a Ana ${u}`,
      }),
      201,
    );
    // Uma prova do VIES com o nome devolvido (escrita como a fila a escreve).
    await comoDono((trx) =>
      sql`insert into validacao_vies (comerciante_id, perfil_id, pais_consultado,
            numero_consultado, consultado_em, resultado, nome_devolvido, motivo, quem)
          values (${a}::uuid, ${String(pFr["id"]).slice(4)}::uuid, 'FR', '40303265045',
            now(), 'valido', ${`ANA SARL ${u}`}, 'pedido', 'sistema:vies')`.execute(
        trx,
      ),
    );
    await declarar(id);
    const t = await ok(
      pedir("POST", "/customer-tags", { nome: `VIP ${u}` }),
      201,
    );
    await ok(pedir("PUT", `/customers/${id}/tags/${String(t["id"])}`));
    // Uma ficha antiga da mesma pessoa, fundida nesta: entra no grupo.
    const antiga = await ficha({
      nome: `A. Silva ${u}`,
      emails: [`antiga.${u}@ex.pt`],
    });
    await declarar(antiga);
    await ok(
      pedir("POST", `/customers/${id}/merge`, {
        absorver: antiga,
        ensaio: false,
      }),
    );

    // As recusas: sem a confirmação certa, sem o âmbito, por um processo.
    await recusa(
      pseudonimizar(id, dono, "pseudonimizar"),
      422,
      "customers.confirmation_required",
    );
    await recusa(pseudonimizar(id, semPrivacidade), 403);
    await recusa(pseudonimizar(id, deB), 404, "customers.not_found");
    expect(
      await comoDono(
        (trx) =>
          erroDe(
            sql`select cliente_pseudonimizar(${id.slice(4)}::uuid,
                ${`pseudonimizar ${id}`}, 'x')`.execute(trx),
          ),
        "sistema:limpeza",
      ),
    ).toMatch(/^customers\.merge_by_person:/);
    await recusa(pseudonimizar(antiga), 409, "customers.invalid_transition");

    const r = await ok(pseudonimizar(id));
    expect(r).toMatchObject({
      fichas: 2,
      perfis_pseudonimizados: 2,
      perfis_mantidos_por_obrigacao_fiscal: 0,
      consentimentos_apagados: 2,
      etiquetas_retiradas: 1,
      provas_vies_apagadas: 1,
      isencoes_limpas: 1,
    });
    expect(r["entradas_da_linha_do_tempo"]).toBeGreaterThan(5);

    // As fichas: sem dados, a pedida pseudonimizada, a fundida fundida.
    expect(await ok(pedir("GET", `/customers/${id}`))).toMatchObject({
      nome: "Pseudonimizado",
      emails: [],
      telefones: [],
      lingua: null,
      pais: null,
      estado: "pseudonimizado",
      etiquetas: [],
    });
    expect(await ok(pedir("GET", `/customers/${antiga}`))).toMatchObject({
      nome: "Pseudonimizado",
      emails: [],
      estado: "fundido",
    });
    // Os perfis: sem nome, NIF nem morada, arquivados.
    const perfis = (
      await ok(pedir("GET", `/customers/${id}/billing-profiles`))
    )["dados"] as Json[];
    for (const p of perfis) {
      expect(p).toMatchObject({
        nome_documento: "Pseudonimizado",
        nif: null,
        nif_escrito: null,
        morada: null,
        estado: "arquivado",
        principal: false,
      });
    }
    // Os consentimentos saem e a régua dá não.
    expect(await ok(pedir("GET", `/customers/${id}/consents`))).toMatchObject({
      total: 0,
      pode_receber_marketing: { email: false },
    });
    // Nenhum valor pessoal fica em lado nenhum que este domínio guarde.
    const tudo = await comoDono(async (trx) =>
      JSON.stringify({
        rasto: (
          await sql`select campos from alteracao_cliente
            where cliente_id = any(${[id.slice(4), antiga.slice(4)]}::uuid[])`.execute(
            trx,
          )
        ).rows,
        isencoes: (
          await sql`select * from isencao_manual
            where perfil_id = ${String(pFr["id"]).slice(4)}::uuid`.execute(trx)
        ).rows,
        provas: (
          await sql`select * from validacao_vies
            where perfil_id = ${String(pFr["id"]).slice(4)}::uuid`.execute(trx)
        ).rows,
        eventos: (
          await sql`select dados from evento_saida
            where agregado_id = any(${[id.slice(4), antiga.slice(4)]}::uuid[])`.execute(
            trx,
          )
        ).rows,
      }),
    );
    expect(tudo).not.toContain(u);
    expect(tudo).not.toContain(nif);
    expect(tudo).not.toContain("40303265045");
    expect(tudo).not.toContain("+351912345678");
    expect(tudo).toContain("(pseudonimizado)");
    // O perfil particular, o original da cópia: também limpo.
    expect(
      await ok(pedir("GET", `/billing-profiles/${String(pPart["id"])}`)),
    ).toMatchObject({ nif: null, estado: "arquivado" });

    // O evento e o registo do pedido.
    const ev = await comoDono(
      async (trx) =>
        (
          await sql<{ dados: Json }>`select dados from evento_saida
            where tipo = 'customer.pseudonymized'
              and agregado_id = ${id.slice(4)}::uuid`.execute(trx)
        ).rows,
    );
    expect(ev).toHaveLength(1);
    expect(Object.keys(ev[0]?.dados ?? {}).sort()).toEqual([
      "cliente_id",
      "em",
      "fichas",
      "quem",
    ]);
    const pedidos = (
      await ok(pedir("GET", `/customers/${id}/privacy-requests`))
    )["dados"] as Json[];
    expect(pedidos[0]).toMatchObject({
      tipo: "apagamento",
      verificacao,
      quem: `chave:key_${donoId}`,
      resultado: { fichas: 2 },
    });

    // Final: não se pseudonimiza outra vez nem se altera.
    await recusa(pseudonimizar(id), 409, "customers.invalid_transition");
    await recusa(
      pedir("PATCH", `/customers/${id}`, { versao: 99, nome: "X" }),
      409,
    );
  });

  it("um perfil usado num documento fica como está, com a linha do tempo dele (R9)", async () => {
    const u = unico();
    const nif = nifNovo();
    const id = await ficha({ nome: `Rui ${u}` });
    const usado = await perfil(id, {
      tipo: "particular",
      nome_documento: `Rui Faturado ${u}`,
      nif,
    });
    const outro = await perfil(id, {
      tipo: "particular",
      nome_documento: `Rui Outro ${u}`,
    });
    // Marca-o como o domínio dos documentos o marcará (fatia 10).
    await comoDono((trx) =>
      sql`update perfil_faturacao set usado_em_documento = true
          where id = ${String(usado["id"]).slice(4)}::uuid`.execute(trx),
    );
    expect(await ok(pseudonimizar(id))).toMatchObject({
      perfis_pseudonimizados: 1,
      perfis_mantidos_por_obrigacao_fiscal: 1,
    });
    expect(
      await ok(pedir("GET", `/billing-profiles/${String(usado["id"])}`)),
    ).toMatchObject({
      nome_documento: `Rui Faturado ${u}`,
      nif,
      usado_em_documento: true,
    });
    expect(
      await ok(pedir("GET", `/billing-profiles/${String(outro["id"])}`)),
    ).toMatchObject({ nome_documento: "Pseudonimizado" });
    const rasto = await comoDono(async (trx) =>
      JSON.stringify(
        (
          await sql`select campos from alteracao_cliente
            where entidade_id = ${String(usado["id"]).slice(4)}::uuid`.execute(
            trx,
          )
        ).rows,
      ),
    );
    expect(rasto).toContain(nif);
  });

  it("as recusas só se abrem dentro da pseudonimização: nem a API nem o superutilizador com a bandeira", async () => {
    const id = await ficha({ nome: "Bia" });
    await declarar(id);
    const x = await ficha({ nome: "X" });
    await ok(
      pedir("POST", `/customers/${x}/merge`, { absorver: id, ensaio: false }),
    );
    // A API, com a bandeira posta, não muda uma ficha fundida.
    const pelaApi = await base.api.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
        trx,
      );
      await sql`select set_config('eurolify.quem', 'chave:key_x', true)`.execute(
        trx,
      );
      await sql`select set_config('eurolify.pseudonimizar', 'sim', true)`.execute(
        trx,
      );
      return erroDe(
        sql`update cliente set nome = 'Y' where id = ${id.slice(4)}::uuid`.execute(
          trx,
        ),
      );
    });
    expect(pelaApi).toMatch(/^customers\.invalid_transition:/);
    // O superutilizador, com a bandeira, não apaga a prova.
    const superu = await comoDono(async (trx) => {
      await sql`select set_config('eurolify.pseudonimizar', 'sim', true)`.execute(
        trx,
      );
      return erroDe(
        sql`delete from consentimento where cliente_id = ${id.slice(4)}::uuid`.execute(
          trx,
        ),
      );
    });
    expect(superu).toMatch(/audit\.append_only/);
  });

  it("a limitação: a régua dá não, a API não muda o nome nem os contactos; levanta-se; tudo registado", async () => {
    const id = await ficha({ nome: "Carla", emails: [`c.${unico()}@ex.pt`] });
    await declarar(id);
    await recusa(
      pedir(
        "PUT",
        `/customers/${id}/restriction`,
        { verificacao },
        semPrivacidade,
      ),
      403,
    );
    await recusa(pedir("PUT", `/customers/${id}/restriction`, {}), 400);
    const limitada = await ok(
      pedir("PUT", `/customers/${id}/restriction`, { verificacao }),
    );
    expect(limitada).toMatchObject({ limitado: true });
    expect(
      (
        (await ok(pedir("GET", `/customers/${id}/consents`)))[
          "pode_receber_marketing"
        ] as Json
      )["email"],
    ).toBe(false);
    await recusa(
      pedir("PATCH", `/customers/${id}`, {
        versao: limitada["versao"],
        nome: "Carla M.",
      }),
      409,
      "customers.restricted",
    );
    const livre = await ok(
      pedir("DELETE", `/customers/${id}/restriction`, { verificacao }),
    );
    expect(livre).toMatchObject({ limitado: false });
    await ok(
      pedir("PATCH", `/customers/${id}`, {
        versao: livre["versao"],
        nome: "Carla M.",
      }),
    );
    const pedidos = (
      await ok(pedir("GET", `/customers/${id}/privacy-requests`))
    )["dados"] as Json[];
    expect(pedidos.map((p) => p["tipo"])).toEqual([
      "fim_da_limitacao",
      "limitacao",
    ]);
  });

  it("a exportação traz o grupo inteiro e fica registada; o comerciante B não exporta fichas de A", async () => {
    const u = unico();
    const id = await ficha({ nome: `Dina ${u}`, emails: [`d.${u}@ex.pt`] });
    await perfil(id, { tipo: "particular", nome_documento: `Dina ${u}` });
    await declarar(id);
    const antiga = await ficha({ nome: `D. ${u}` });
    await ok(
      pedir("POST", `/customers/${id}/merge`, {
        absorver: antiga,
        ensaio: false,
      }),
    );
    await recusa(pedir("POST", `/customers/${id}/export`, {}), 400);
    await recusa(
      pedir("POST", `/customers/${id}/export`, { verificacao }, deB),
      404,
      "customers.not_found",
    );
    const e = await ok(
      pedir("POST", `/customers/${id}/export`, { verificacao }),
    );
    expect(e).toMatchObject({ cliente: id, estado: "activo" });
    expect(String(e["pedido"])).toMatch(/^dsr_/);
    const fichas = e["fichas"] as Json[];
    expect(fichas).toHaveLength(2);
    const texto = JSON.stringify(e);
    expect(texto).toContain(`d.${u}@ex.pt`);
    expect(texto).toContain(`D. ${u}`);
    expect((fichas[0]?.["consentimentos"] as Json[]).length).toBe(1);
    expect((fichas[0]?.["perfis_de_faturacao"] as Json[]).length).toBe(1);
    expect(e["pedidos_do_titular"] as Json[]).toHaveLength(1);
  });
});
