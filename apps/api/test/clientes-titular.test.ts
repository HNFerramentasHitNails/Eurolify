import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados } from "../src/base/esquema.js";
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
  // Como o apoio: lê e escreve fichas, sem customers:billing (§15.12).
  let apoio: string;
  let entidadeA: string;

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
  /** O primeiro e-mail da ficha (0052: cada declaração diz o contacto); sem nenhum, acrescenta um. */
  const contactoDe = async (cliente: string): Promise<string> => {
    const f = await ok(pedir("GET", `/customers/${cliente}`));
    const emails = f["emails"] as string[];
    if (emails[0] !== undefined) return emails[0];
    const novo = `${cliente.slice(4)}@exemplo.pt`;
    await ok(
      pedir("PATCH", `/customers/${cliente}`, {
        versao: f["versao"],
        emails: [novo],
      }),
    );
    return novo;
  };
  const declarar = async (cliente: string) =>
    ok(
      pedir("POST", `/customers/${cliente}/consents`, {
        canal: "email",
        declaracao: "aceitou",
        contacto: await contactoDe(cliente),
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
    entidadeA = await criarEntidadeLegal(base.api, a, {
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
    apoio = (
      await chave(a, "Apoio", ["customers:read", "customers:write", "tax:read"])
    ).segredo;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("depois do apagamento, só o dono lê o nome, o NIF e a morada do perfil guardado (docs/23 §15.12, EL)", async () => {
    const u = unico();
    const nif = nifNovo();
    const id = await ficha({ nome: `Rita ${u}` });
    const usado = await perfil(id, {
      tipo: "particular",
      nome_documento: `Rita Faturada ${u}`,
      nif,
      morada: {
        linha1: `Rua da Rita ${u}`,
        codigo_postal: "1000-001",
        localidade: "Lisboa",
        pais: "PT",
      },
    });
    const pid = String(usado["id"]);
    const isencao = await ok(
      pedir("PUT", `/billing-profiles/${pid}/exemption`, {
        codigo_motivo: "M05",
        motivo: `a Rita ${u} exporta`,
        nota: `falado com a Rita ${u}`,
      }),
      201,
    );
    await comoDono(async (trx) => {
      await sql`update perfil_faturacao set usado_em_documento = true
          where id = ${pid.slice(4)}::uuid`.execute(trx);
      await sql`insert into validacao_vies (comerciante_id, perfil_id, pais_consultado,
            numero_consultado, consultado_em, resultado, nome_devolvido, morada_devolvida,
            motivo, quem)
          values (${a}::uuid, ${pid.slice(4)}::uuid, 'PT', ${nif}, now(), 'valido',
            ${`RITA ${u}`}, ${`RUA DA RITA ${u}`}, 'pedido', 'sistema:vies')`.execute(
        trx,
      );
    });
    // O anexo só o põe uma pessoa (0055).
    const pessoa = `pessoa:per_${randomUUID()}`;
    await comoDono(async (trx) => {
      await sql`insert into anexo_isencao (comerciante_id, isencao_id, nome, tipo,
            tamanho, resumo, bytes, posto_por)
          values (${a}::uuid, ${String(isencao["id"]).slice(4)}::uuid,
            ${`declaracao-rita-${u}.pdf`}, 'application/pdf', 8,
            encode(sha256('\\x255044462d312e34'::bytea), 'hex'),
            '\\x255044462d312e34'::bytea,
            ${pessoa})`.execute(trx);
    }, pessoa);
    // Antes do pedido, o apoio lê tudo, como hoje.
    expect(
      await ok(pedir("GET", `/billing-profiles/${pid}`, undefined, apoio)),
    ).toMatchObject({ nif, guardado_por_obrigacao_fiscal: false });
    await ok(pseudonimizar(id));

    const dados = [nif, `Rita Faturada ${u}`, `Rua da Rita ${u}`, `RITA ${u}`];
    const semDados = (corpo: string) => {
      for (const d of [
        ...dados,
        `a Rita ${u}`,
        `falado com a Rita ${u}`,
        `declaracao-rita-${u}`,
      ]) {
        expect(corpo, d).not.toContain(d);
      }
    };
    // G1: o perfil, sozinho e na lista.
    const um = await pedir("GET", `/billing-profiles/${pid}`, undefined, apoio);
    expect(um.statusCode, um.body).toBe(200);
    semDados(um.body);
    expect(um.json<Json>()).toMatchObject({
      guardado_por_obrigacao_fiscal: true,
      usado_em_documento: true,
      nome_documento: null,
      nif: null,
      morada: null,
    });
    const lista = await pedir(
      "GET",
      `/customers/${id}/billing-profiles`,
      undefined,
      apoio,
    );
    expect(lista.statusCode, lista.body).toBe(200);
    semDados(lista.body);
    // G2: as provas do VIES.
    const provas = await pedir(
      "GET",
      `/billing-profiles/${pid}/vies-checks`,
      undefined,
      apoio,
    );
    expect(provas.statusCode, provas.body).toBe(200);
    semDados(provas.body);
    expect(provas.json<{ dados: Json[] }>().dados).toMatchObject([
      { resultado: "valido", numero_consultado: null, nome_devolvido: null },
    ]);
    // G3 e G4: as isenções e os anexos.
    const isencoes = await pedir(
      "GET",
      `/billing-profiles/${pid}/exemptions`,
      undefined,
      apoio,
    );
    expect(isencoes.statusCode, isencoes.body).toBe(200);
    semDados(isencoes.body);
    expect(isencoes.json<{ dados: Json[] }>().dados).toMatchObject([
      { codigo_motivo: "M05", motivo: "(reservado)", nota: null },
    ]);
    const anexos = await pedir(
      "GET",
      `/exemptions/${String(isencao["id"])}/attachments`,
      undefined,
      apoio,
    );
    expect(anexos.statusCode, anexos.body).toBe(200);
    semDados(anexos.body);
    // G5: a procura pelo NIF não mostra a ficha apagada.
    const procura = await ok(
      pedir("POST", "/customers/search", { procura: nif }, apoio),
    );
    expect(procura["dados"]).toEqual([]);
    // G6: a simulação do IVA com o perfil.
    await recusa(
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
          perfil: pid,
        },
        apoio,
      ),
      403,
      "auth.forbidden",
    );

    // O dono lê tudo, como antes.
    expect(await ok(pedir("GET", `/billing-profiles/${pid}`))).toMatchObject({
      guardado_por_obrigacao_fiscal: true,
      nome_documento: `Rita Faturada ${u}`,
      nif,
    });
    expect(
      (await ok(pedir("GET", `/billing-profiles/${pid}/vies-checks`)))["dados"],
    ).toMatchObject([{ numero_consultado: nif, nome_devolvido: `RITA ${u}` }]);
    expect(
      (await ok(pedir("GET", `/billing-profiles/${pid}/exemptions`)))["dados"],
    ).toMatchObject([{ nota: `falado com a Rita ${u}` }]);
    expect(
      (await ok(pedir("POST", "/customers/search", { procura: nif })))["dados"],
    ).toMatchObject([{ id }]);
  });

  it("numa ficha que não foi apagada, o apoio lê o perfil como hoje (§15.12)", async () => {
    const u = unico();
    const nif = nifNovo();
    const id = await ficha({ nome: `Rui ${u}` });
    const p = await perfil(id, {
      tipo: "particular",
      nome_documento: `Rui Vivo ${u}`,
      nif,
    });
    expect(
      await ok(
        pedir("GET", `/billing-profiles/${String(p["id"])}`, undefined, apoio),
      ),
    ).toMatchObject({
      nome_documento: `Rui Vivo ${u}`,
      nif,
      guardado_por_obrigacao_fiscal: false,
    });
    expect(
      (await ok(pedir("POST", "/customers/search", { procura: nif }, apoio)))[
        "dados"
      ],
    ).toMatchObject([{ id }]);
  });

  it("a pseudonimização troca também o motivo do histórico (texto livre; #322)", async () => {
    const id = await ficha({ nome: `Rui ${unico()}` });
    // Uma alteração com um motivo escrito que fala da pessoa.
    await comoDono(async (trx) => {
      await sql`select set_config('eurolify.motivo', 'o Rui pediu ao telefone', true)`.execute(
        trx,
      );
      await sql`update cliente set nome = 'Rui Costa' where id = ${id.slice(4)}::uuid`.execute(
        trx,
      );
    });
    const antes = await comoDono((trx) =>
      sql<{ motivo: string | null }>`select motivo from alteracao_cliente
        where cliente_id = ${id.slice(4)}::uuid and motivo is not null`.execute(
        trx,
      ),
    );
    expect(antes.rows.map((r) => r.motivo)).toEqual([
      "o Rui pediu ao telefone",
    ]);
    // E num perfil que depois foi usado num documento: os valores ficam (R9),
    // o motivo limpa-se na mesma (revisão do #354, P2-2).
    const usado = await perfil(id, {
      tipo: "empresa",
      nome_documento: "Rui, Lda",
      nif: "FR40303265045",
    });
    const pid = String(usado["id"]).slice(4);
    await comoDono(async (trx) => {
      await sql`select set_config('eurolify.motivo', 'o Rui mudou de sede', true)`.execute(
        trx,
      );
      await sql`update perfil_faturacao set nome_documento = 'Rui Costa, Lda'
        where id = ${pid}::uuid`.execute(trx);
    });
    await comoDono((trx) =>
      sql`update perfil_faturacao set usado_em_documento = true
        where id = ${pid}::uuid`.execute(trx),
    );
    const camposDoPerfil = () =>
      comoDono((trx) =>
        sql<{ campos: unknown }>`select campos from alteracao_cliente
          where entidade = 'perfil_faturacao' and entidade_id = ${pid}::uuid
          order by id`.execute(trx),
      );
    const camposAntes = await camposDoPerfil();
    await ok(pseudonimizar(id));
    const depois = await comoDono((trx) =>
      sql<{ motivo: string | null }>`select motivo from alteracao_cliente
        where cliente_id = ${id.slice(4)}::uuid and motivo is not null
        order by id`.execute(trx),
    );
    expect(depois.rows.map((r) => r.motivo)).toEqual([
      "(pseudonimizado)",
      "(pseudonimizado)",
    ]);
    expect((await camposDoPerfil()).rows).toEqual(camposAntes.rows);
  });

  it("a pseudonimização apaga os dados pessoais do grupo inteiro, também da linha do tempo, e regista o pedido", async () => {
    const u = unico();
    const nif = nifNovo();
    // Outra pessoa, criada antes, com o mesmo e-mail: o par fica na linha do
    // tempo dela (a primeira do par), e o motivo escrito fala da Ana.
    const outra = await ficha({ nome: "Outra", emails: [`ana.${u}@ex.pt`] });
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
    const pares = (
      await ok(
        pedir("GET", "/customer-duplicates?estado=por_decidir&limite=100"),
      )
    )["dados"] as Json[];
    const par = pares.find((x) => (x["clientes"] as string[]).includes(outra));
    expect(par).toBeDefined();
    await ok(
      pedir("POST", `/customer-duplicates/${String(par?.["id"])}/dismiss`, {
        motivo: `não é a mesma Ana ${u}, a outra mora no Porto`,
      }),
    );
    // A mensagem não repete a frase da confirmação (P3-5).
    const semFrase = await pseudonimizar(id, dono, "pseudonimizar");
    expect(semFrase.body).not.toContain(`pseudonimizar ${id}`);

    const r = await ok(pseudonimizar(id));
    expect(r).toMatchObject({
      fichas: 2,
      perfis_pseudonimizados: 2,
      perfis_mantidos_por_obrigacao_fiscal: 0,
      consentimentos_apagados: 2,
      etiquetas_retiradas: 1,
      provas_vies_apagadas: 1,
      isencoes_limpas: 1,
      encomendas_com_dados_por_tratar: 0,
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
            where cliente_id = any(${[id.slice(4), antiga.slice(4)]}::uuid[])
               or entidade = 'duplicado_cliente'`.execute(trx)
        ).rows,
        pares: (
          await sql`select * from duplicado_cliente
            where cliente_a = any(${[id.slice(4), antiga.slice(4)]}::uuid[])
               or cliente_b = any(${[id.slice(4), antiga.slice(4)]}::uuid[])`.execute(
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
    // O texto livre: dos consentimentos, da isenção e do par descartado.
    expect(tudo).not.toContain("Quero receber novidades.");
    expect(tudo).not.toContain("loja, registo");
    expect(tudo).not.toContain("transportadora própria");
    expect(tudo).not.toContain("Porto");
    expect(tudo).toContain("(pseudonimizado)");
    // Os candidatos fecham.
    const estados = await comoDono(
      async (trx) =>
        (
          await sql<{ estado: string }>`select estado from duplicado_cliente
            where cliente_a = ${outra.slice(4)}::uuid or cliente_b = ${outra.slice(4)}::uuid`.execute(
            trx,
          )
        ).rows,
    );
    expect(estados.map((x) => x.estado)).toEqual(["fechado"]);
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
    await ok(
      pedir("PUT", `/billing-profiles/${String(usado["id"])}/exemption`, {
        codigo_motivo: "M05",
        motivo: `isenção do Rui ${u}`,
      }),
      201,
    );
    // Marca-o como o domínio dos documentos o marcará (fatia 10), e uma
    // prova do VIES dele.
    await comoDono(async (trx) => {
      await sql`update perfil_faturacao set usado_em_documento = true
          where id = ${String(usado["id"]).slice(4)}::uuid`.execute(trx);
      await sql`insert into validacao_vies (comerciante_id, perfil_id, pais_consultado,
            numero_consultado, consultado_em, resultado, nome_devolvido, motivo, quem)
          values (${a}::uuid, ${String(usado["id"]).slice(4)}::uuid, 'PT', ${nif},
            now(), 'valido', ${`RUI ${u}`}, 'pedido', 'sistema:vies')`.execute(
        trx,
      );
    });
    expect(await ok(pseudonimizar(id))).toMatchObject({
      perfis_pseudonimizados: 1,
      perfis_mantidos_por_obrigacao_fiscal: 1,
      provas_vies_apagadas: 0,
      isencoes_limpas: 0,
    });
    // A prova e a isenção do perfil usado ficam, inteiras.
    const guardado = await comoDono(async (trx) => ({
      provas: (
        await sql<{
          nome_devolvido: string;
        }>`select nome_devolvido from validacao_vies
          where perfil_id = ${String(usado["id"]).slice(4)}::uuid`.execute(trx)
      ).rows,
      isencoes: (
        await sql<{
          nif_numero: string;
          motivo: string;
        }>`select nif_numero, motivo
          from isencao_manual
          where perfil_id = ${String(usado["id"]).slice(4)}::uuid`.execute(trx)
      ).rows,
    }));
    expect(guardado.provas).toEqual([{ nome_devolvido: `RUI ${u}` }]);
    expect(guardado.isencoes).toEqual([
      { nif_numero: nif, motivo: `isenção do Rui ${u}` },
    ]);
    // Uma resposta do VIES que chegue depois não grava nada (P1-3).
    expect(
      await comoDono(
        (trx) =>
          erroDe(
            sql`select vies_registar(${String(usado["id"]).slice(4)}::uuid, 'PT', ${nif},
                null, null, now(), now(), 'valido', null, null, 'RUI', 'Rua', 'revalidacao')`.execute(
              trx,
            ),
          ),
        "sistema:vies",
      ),
    ).toMatch(/^customers\.invalid_transition:/);
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
    // O perfil guarda o NIF (acima); a linha do tempo guarda o marcador
    // (docs/28 §3.4; 0054), não o NIF em claro. A prova fiscal é a cópia no
    // documento (docs/29 §4, `documento_conteudo`).
    expect(rasto).not.toContain(nif);
    expect(rasto).toContain('"protegido":true');
  });

  it("as recusas só se abrem dentro da pseudonimização: nem a API nem o superutilizador, nem com a bandeira nem com a marca", async () => {
    const id = await ficha({ nome: "Bia" });
    await declarar(id);
    await perfil(id, { tipo: "particular", nome_documento: "Bia" });
    const segundo = await perfil(id, {
      tipo: "particular",
      nome_documento: "Bia 2",
    });
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
    // A API com o parâmetro antigo e uma função do dono que escreve num
    // perfil: o parâmetro já não abre nada (revisão do #314, P2-1).
    const comFuncaoDoDono = await base.api
      .transaction()
      .execute(async (trx) => {
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
          sql`select perfil_tornar_principal(${String(segundo["id"]).slice(4)}::uuid)`.execute(
            trx,
          ),
        );
      });
    expect(comFuncaoDoDono).toMatch(/^customers\.invalid_transition:/);
    // A API não escreve a marca, nem regista um pedido à escolha (P2-2).
    for (const consulta of [
      sql`insert into pseudonimizacao_em_curso values (pg_current_xact_id())`,
      sql`select pedido_titular_registar(${id.slice(4)}::uuid, 'apagamento', 'x', '{}')`,
    ]) {
      const recusada = await base.api.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
          trx,
        );
        return erroDe(consulta.execute(trx));
      });
      expect(recusada).toMatch(/permission denied/);
    }
    // O superutilizador, com a marca da transacção, não apaga a prova: não
    // é o dono das tabelas.
    const superu = await comoDono(async (trx) => {
      await sql`insert into pseudonimizacao_em_curso values (pg_current_xact_id())`.execute(
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
    expect(fichas[0]).toHaveProperty("linhas_das_encomendas");
    expect(fichas[0]).toHaveProperty("pagamentos");
    expect(fichas[0]).toHaveProperty("candidatos_a_duplicado");
    // A ficha fundida não se exporta sozinha: pede-se pela que ficou (P3-3).
    await recusa(
      pedir("POST", `/customers/${antiga}/export`, { verificacao }),
      409,
      "customers.invalid_transition",
    );
  });

  it("a exportação e o apagamento listam as outras fichas com o mesmo e-mail ou telefone, sem as juntar; nem as do grupo, nem as de outro comerciante (docs/23 §15.5)", async () => {
    const u = unico();
    const tel = `+3519${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    const id = await ficha({
      nome: `Ana ${u}`,
      emails: [`ana.${u}@ex.pt`],
      telefones: [tel],
    });
    // Outra compra sem conta, com o e-mail em maiúsculas: o mesmo e-mail.
    const porEmail = await ficha({
      nome: `A. ${u}`,
      emails: [`ANA.${u}@EX.PT`],
    });
    const porTelefone = await ficha({ nome: `Ana S. ${u}`, telefones: [tel] });
    const pelosDois = await ficha({
      nome: `Ana Silva ${u}`,
      emails: [`ana.${u}@ex.pt`],
      telefones: [tel],
    });
    // Uma já apagada com o mesmo e-mail: não entra (já não tem contactos).
    const apagada = await ficha({
      nome: `Ana ${u}`,
      emails: [`ana.${u}@ex.pt`],
    });
    await ok(pseudonimizar(apagada));
    const outra = await ficha({ nome: `Rui ${u}`, emails: [`rui.${u}@ex.pt`] });
    // Uma do grupo (fundida nesta) e uma de outro comerciante: não entram.
    const fundida = await ficha({
      nome: `Ana ${u}`,
      emails: [`ana.${u}@ex.pt`],
    });
    await ok(
      pedir("POST", `/customers/${id}/merge`, {
        absorver: fundida,
        ensaio: false,
      }),
    );
    await ficha({ nome: `Ana ${u}`, emails: [`ana.${u}@ex.pt`] }, deB);
    const esperadas = [
      { id: porEmail, estado: "activo", sinais: ["email"] },
      { id: porTelefone, estado: "activo", sinais: ["telefone"] },
      { id: pelosDois, estado: "activo", sinais: ["email", "telefone"] },
    ].sort((x, y) => x.id.localeCompare(y.id));
    const e = await ok(
      pedir("POST", `/customers/${id}/export`, { verificacao }),
    );
    expect(e["fichas_com_o_mesmo_contacto"]).toEqual(esperadas);
    const r = await ok(pseudonimizar(id));
    expect(r["fichas_com_o_mesmo_contacto"]).toEqual(esperadas);
    // Só se listam: as outras ficam como estavam, com os contactos.
    for (const [x, campo, valor] of [
      [porEmail, "emails", [`ANA.${u}@EX.PT`]],
      [porTelefone, "telefones", [tel]],
      [outra, "emails", [`rui.${u}@ex.pt`]],
    ] as const) {
      const f = await ok(pedir("GET", `/customers/${x}`));
      expect(f["estado"]).toBe("activo");
      expect(f[campo]).toEqual(valor);
    }
  });

  it("a exportação não fica guardada na idempotência: repetir a chave dá o id do pedido, sem os dados (revisão do #314, P2-5)", async () => {
    const u = unico();
    const id = await ficha({ nome: `Eva ${u}`, emails: [`e.${u}@ex.pt`] });
    const chave = randomUUID();
    const exportar = () =>
      app.inject({
        method: "POST",
        url: `/customers/${id}/export`,
        headers: {
          authorization: `Bearer ${dono}`,
          "idempotency-key": chave,
          "content-type": "application/json",
        },
        payload: JSON.stringify({ verificacao }),
      });
    const primeira = await ok(exportar());
    expect(JSON.stringify(primeira)).toContain(`e.${u}@ex.pt`);
    const repetida = await exportar();
    expect(repetida.statusCode, repetida.body).toBe(409);
    expect(repetida.json<Json>()["codigo"]).toBe(
      "idempotency.response_not_kept",
    );
    expect(repetida.body).toContain(String(primeira["pedido"]));
    const guardada = await base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
        trx,
      );
      return (
        await sql<{
          resposta_corpo: unknown;
        }>`select resposta_corpo from idempotencia
          where comerciante_id = ${a}::uuid and chave = ${chave}`.execute(trx)
      ).rows;
    });
    expect(guardada).toHaveLength(1);
    expect(JSON.stringify(guardada)).not.toContain(u);
    // Uma só exportação registada.
    const pedidos = (
      await ok(pedir("GET", `/customers/${id}/privacy-requests`))
    )["dados"] as Json[];
    expect(pedidos).toHaveLength(1);
  });

  it("uma fusão ao mesmo tempo que o apagamento: a ficha absorvida também fica sem dados (revisão do #314, P1-2)", async () => {
    const u = unico();
    const fica = await ficha({ nome: `Gil ${u}`, emails: [`g.${u}@ex.pt`] });
    const absorve = await ficha({ nome: `G. ${u}`, emails: [`g2.${u}@ex.pt`] });
    const emA = async (trx: Transaction<BaseDados>) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
        trx,
      );
      await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true)`.execute(
        trx,
      );
    };
    let soltar = () => {};
    const fusaoAberta = new Promise<void>((r) => {
      soltar = r;
    });
    let fusaoTomou = () => {};
    const tomou = new Promise<void>((r) => {
      fusaoTomou = r;
    });
    // A fusão toma as duas fichas e fica à espera, sem confirmar. As duas
    // pela API (duas ligações); a do dono fica para ver quem espera.
    const fusao = base.api.transaction().execute(async (trx) => {
      await emA(trx);
      await sql`select cliente_fundir(${fica.slice(4)}::uuid, ${absorve.slice(4)}::uuid, false)`.execute(
        trx,
      );
      fusaoTomou();
      await fusaoAberta;
    });
    await tomou;
    // O apagamento começa e espera pela ficha.
    const apagamento = base.api.transaction().execute(async (trx) => {
      await emA(trx);
      return (
        await sql<{
          r: Json;
        }>`select cliente_pseudonimizar(${fica.slice(4)}::uuid,
            ${`pseudonimizar ${fica}`}, 'teste') as r`.execute(trx)
      ).rows[0]?.r;
    });
    // Espera até o apagamento estar mesmo à espera do bloqueio.
    for (let i = 0; i < 100; i++) {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity
        where wait_event_type = 'Lock' and query like '%cliente_pseudonimizar%'`.execute(
        base.dono,
      );
      if ((rows[0]?.n ?? 0) > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    soltar();
    await fusao;
    const r = await apagamento;
    expect(r).toMatchObject({ fichas: 2 });
    expect(await ok(pedir("GET", `/customers/${absorve}`))).toMatchObject({
      nome: "Pseudonimizado",
      emails: [],
      estado: "fundido",
    });
  });
});
