import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  consultaVies,
  type PedidoVies,
  type RespostaVies,
} from "../src/clientes/vies.js";
import { correrFilaVies } from "../src/clientes/vies-fila.js";
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

// Clientes, parte 3: o VIES com prova e a isenção manual (docs/23 §13;
// migração 0039). Nenhum teste chama a Comissão: o adaptador fala com um
// servidor HTTP falso, e a app e a fila com uma consulta falsa.

type Json = Record<string, unknown>;

describe("o adaptador do VIES (contra um servidor falso)", () => {
  let servidor: Server;
  let url: string;
  const pedidos: Json[] = [];
  let responder: (corpo: Json) => {
    estado: number;
    corpo: string;
    demora?: number;
  };

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      let dados = "";
      req.on("data", (c: Buffer) => (dados += c.toString()));
      req.on("end", () => {
        const corpo = JSON.parse(dados) as Json;
        pedidos.push(corpo);
        const r = responder(corpo);
        setTimeout(() => {
          res.writeHead(r.estado, { "content-type": "application/json" });
          res.end(r.corpo);
        }, r.demora ?? 0);
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
    url = `http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}/check-vat-number`;
  });
  afterAll(async () => {
    await new Promise((ok) => servidor.close(ok));
  });

  const pedido: PedidoVies = {
    pais: "GR",
    numero: "094014201",
    requerente: { pais: "PT", numero: "509999990" },
  };

  it("válido: a data, o número de consulta e o nome; a Grécia vai como EL", async () => {
    pedidos.length = 0;
    responder = () => ({
      estado: 200,
      corpo: JSON.stringify({
        countryCode: "EL",
        vatNumber: "094014201",
        requestDate: "2026-10-09T15:04:24.649Z",
        valid: true,
        requestIdentifier: "WAPIAAAAZ123",
        name: "ANA EPE",
        address: "---",
      }),
    });
    const r = await consultaVies(url)(pedido);
    expect(r).toEqual({
      resultado: "valido",
      dataVies: new Date("2026-10-09T15:04:24.649Z"),
      identificador: "WAPIAAAAZ123",
      nome: "ANA EPE",
      morada: null,
      codigoErro: null,
      requerente: { pais: "PT", numero: "509999990" },
    });
    expect(pedidos[0]).toEqual({
      countryCode: "EL",
      vatNumber: "094014201",
      requesterMemberStateCode: "PT",
      requesterNumber: "509999990",
    });
  });

  it("inválido; o número de consulta vazio fica nulo", async () => {
    responder = () => ({
      estado: 200,
      corpo: JSON.stringify({
        valid: false,
        requestIdentifier: "",
        name: "---",
      }),
    });
    expect(await consultaVies(url)(pedido)).toMatchObject({
      resultado: "invalido",
      identificador: null,
      nome: null,
      dataVies: null,
    });
  });

  it("um erro do VIES, um HTTP 500 sem JSON e o tempo esgotado são «indisponivel»", async () => {
    responder = () => ({
      estado: 200,
      corpo: JSON.stringify({
        actionSucceed: false,
        errorWrappers: [{ error: "MS_MAX_CONCURRENT_REQ" }],
      }),
    });
    expect(await consultaVies(url)(pedido)).toMatchObject({
      resultado: "indisponivel",
      codigoErro: "MS_MAX_CONCURRENT_REQ",
    });
    responder = () => ({ estado: 500, corpo: "<html>erro</html>" });
    expect(await consultaVies(url)(pedido)).toMatchObject({
      resultado: "indisponivel",
      codigoErro: "HTTP_500",
    });
    responder = () => ({ estado: 200, corpo: "{}", demora: 500 });
    expect(await consultaVies(url, 100)(pedido)).toMatchObject({
      resultado: "indisponivel",
      codigoErro: "TEMPO_ESGOTADO",
    });
    expect(
      await consultaVies("http://127.0.0.1:1/x", 1000)(pedido),
    ).toMatchObject({ resultado: "indisponivel", codigoErro: "SEM_LIGACAO" });
  });

  it("um «valid» com erro do país é «indisponivel», nunca «inválido»; um nome longo corta-se", async () => {
    responder = () => ({
      estado: 200,
      corpo: JSON.stringify({ valid: false, userError: "MS_UNAVAILABLE" }),
    });
    expect(await consultaVies(url)(pedido)).toMatchObject({
      resultado: "indisponivel",
      codigoErro: "MS_UNAVAILABLE",
    });
    responder = () => ({
      estado: 200,
      corpo: JSON.stringify({ valid: false, actionSucceed: false }),
    });
    expect(await consultaVies(url)(pedido)).toMatchObject({
      resultado: "indisponivel",
    });
    responder = () => ({
      estado: 200,
      corpo: JSON.stringify({
        valid: true,
        userError: "VALID",
        name: "N".repeat(800),
      }),
    });
    const r = await consultaVies(url)(pedido);
    expect(r.resultado).toBe("valido");
    expect(r.nome).toHaveLength(500);
  });

  it("um requerente recusado repete sem ele, e a prova diz que foi sem", async () => {
    pedidos.length = 0;
    responder = (corpo) =>
      corpo["requesterNumber"] === undefined
        ? {
            estado: 200,
            corpo: JSON.stringify({ valid: true, requestIdentifier: "" }),
          }
        : {
            estado: 200,
            corpo: JSON.stringify({
              actionSucceed: false,
              errorWrappers: [{ error: "INVALID_REQUESTER_INFO" }],
            }),
          };
    const r = await consultaVies(url)(pedido);
    expect(r).toMatchObject({ resultado: "valido", requerente: null });
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]?.["requesterNumber"]).toBeUndefined();
  });
});

describe.skipIf(URL_BASE === undefined)(
  "VIES e isenção manual pela API",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let semVies: ReturnType<typeof criarApp>;
    let a: string;
    let b: string;
    let dono: string;
    let semIsencoes: string;
    let deB: string;
    const consultas: PedidoVies[] = [];
    // As respostas por número: cada perfil de teste tem o seu NIF, para a fila
    // (que corre tudo o que está por fazer) não misturar os testes. Um número
    // sem resposta preparada recebe «indisponivel».
    const respostas = new Map<string, (RespostaVies | Error)[]>();
    let durante: (() => Promise<void>) | undefined;

    const resposta = (
      resultado: RespostaVies["resultado"],
      extra: Partial<RespostaVies> = {},
    ): RespostaVies => ({
      resultado,
      dataVies:
        resultado === "indisponivel" ? null : new Date("2026-10-09T10:00:00Z"),
      identificador: resultado === "indisponivel" ? null : "WAPI0001",
      nome: resultado === "valido" ? "ANA SARL" : null,
      morada: null,
      codigoErro: resultado === "indisponivel" ? "MS_UNAVAILABLE" : null,
      requerente: null,
      ...extra,
    });
    const falso = async (p: PedidoVies): Promise<RespostaVies> => {
      consultas.push(p);
      if (durante !== undefined) {
        const f = durante;
        durante = undefined;
        await f();
      }
      const r = respostas.get(p.numero)?.shift() ?? resposta("indisponivel");
      if (r instanceof Error) throw r;
      return { ...r, requerente: p.requerente };
    };
    const preparar = (numero: string, ...r: (RespostaVies | Error)[]) =>
      respostas.set(numero, r);
    const correr = () =>
      correrFilaVies(base.api, falso, () => undefined, {
        pausaMs: 0,
        porVolta: 1000,
        total: 1000,
      });

    const pedir = (
      metodo: "POST" | "PATCH" | "PUT" | "DELETE" | "GET",
      url: string,
      corpo?: unknown,
      segredo = dono,
      aplicacao = app,
    ) =>
      aplicacao.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
          ...(corpo === undefined
            ? {}
            : { "content-type": "application/json" }),
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
    };

    let sequencia = 0;
    /** Um número francês só deste perfil. */
    const novoNumero = () =>
      `4030326${String(5000 + sequencia++).padStart(4, "0")}`;

    /** Uma ficha com um perfil francês (VIES aplicável num comerciante português). */
    async function perfilFrances(segredo = dono, numero = novoNumero()) {
      const f = await ok(
        pedir("POST", "/customers", { nome: "Ana" }, segredo),
        201,
      );
      const p = await ok(
        pedir(
          "POST",
          `/customers/${String(f["id"])}/billing-profiles`,
          { tipo: "empresa", nome_documento: "Ana SARL", nif: `FR${numero}` },
          segredo,
        ),
        201,
      );
      return { ...p, numero } as Json & { numero: string };
    }

    async function noComerciante<T>(
      c: string,
      fn: (trx: Kysely<unknown>) => Promise<T>,
    ) {
      return base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${c}, true)`.execute(
          trx,
        );
        return fn(trx);
      });
    }
    const eventos = (c: string, perfil: string) =>
      noComerciante(
        c,
        async (trx) =>
          (
            await sql<{ tipo: string; dados: Json }>`
          select tipo, dados from evento_saida
          where agregado_id = ${perfil.slice(4)}::uuid order by criado_em, id`.execute(
              trx,
            )
          ).rows,
      );
    const fila = (perfil: string) =>
      sql<{ proxima_em: Date; tentativas: number; motivo: string }>`
      select proxima_em, tentativas, motivo from vies_fila
      where perfil_id = ${perfil.slice(4)}::uuid`.execute(base.dono);
    const provas = async (perfil: string, segredo = dono) =>
      (
        await ok(
          pedir(
            "GET",
            `/billing-profiles/${perfil}/vies-checks`,
            undefined,
            segredo,
          ),
        )
      )["dados"] as Json[];

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
      app = criarApp(
        { logger: false },
        undefined,
        base.api,
        undefined,
        undefined,
        falso,
      );
      semVies = criarApp({ logger: false }, undefined, base.api);
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
      ];
      dono = (await chave(a, "Dono", todos)).segredo;
      semIsencoes = (
        await chave(a, "Sem isenções", [
          "customers:read",
          "customers:write",
          "customers:billing",
        ])
      ).segredo;
      deB = (await chave(b, "B", todos)).segredo;
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await semVies.close();
      await base.fechar();
    });

    it("um perfil novo vai à fila: a prova com o requerente, o perfil válido com a data, um evento; a revalidação à noite", async () => {
      const p = await perfilFrances();
      const id = String(p["id"]);
      expect(p["estado_vies"]).toBe("por_validar");
      preparar(p.numero, resposta("valido"));
      consultas.length = 0;
      await correr();
      expect(consultas.filter((c) => c.numero === p.numero)).toEqual([
        {
          pais: "FR",
          numero: p.numero,
          requerente: { pais: "PT", numero: "509999990" },
        },
      ]);
      const [prova] = await provas(id);
      expect(prova).toMatchObject({
        perfil: id,
        pais_consultado: "FR",
        numero_consultado: p.numero,
        requerente: "PT509999990",
        resultado: "valido",
        identificador_consulta: "WAPI0001",
        nome_devolvido: "ANA SARL",
        data_vies: "2026-10-09T10:00:00.000Z",
        motivo: "perfil_novo",
        quem: "sistema:vies",
        codigo_erro: null,
      });
      const agora = await ok(pedir("GET", `/billing-profiles/${id}`));
      expect(agora).toMatchObject({
        estado_vies: "valido",
        validado_em: "2026-10-09T10:00:00.000Z",
      });
      expect((await eventos(a, id)).map((e) => e.tipo)).toEqual([
        "billing_profile.created",
        "billing_profile.validated",
      ]);
      const { rows } = await fila(id);
      expect(rows[0]?.motivo).toBe("revalidacao");
      expect(rows[0]?.proxima_em.getTime()).toBeGreaterThan(
        Date.now() + 23.9 * 3600_000,
      );
      const hora = rows[0]?.proxima_em.getUTCHours() ?? -1;
      expect(hora).toBeGreaterThanOrEqual(1);
      expect(hora).toBeLessThan(5);
      // A revalidação com a mesma resposta não muda o perfil (nem a versão, nem
      // a linha do tempo; revisão do #244, P2-6), mas a data sim.
      preparar(
        p.numero,
        resposta("valido", { dataVies: new Date("2026-10-10T03:00:00Z") }),
      );
      await ok(pedir("POST", `/billing-profiles/${id}/vies-checks`), 202);
      await correr();
      const depois = await ok(pedir("GET", `/billing-profiles/${id}`));
      expect(depois).toMatchObject({
        versao: agora["versao"],
        validado_em: "2026-10-10T03:00:00.000Z",
      });
    });

    it("pedir uma consulta: 202, o perfil à frente da fila; nada se consulta no pedido", async () => {
      const p = await perfilFrances();
      const id = String(p["id"]);
      preparar(p.numero, resposta("valido"));
      await correr();
      consultas.length = 0;
      const r = await ok(
        pedir("POST", `/billing-profiles/${id}/vies-checks`),
        202,
      );
      expect(r).toMatchObject({ perfil: id });
      expect(consultas).toEqual([]);
      const { rows } = await fila(id);
      expect(rows[0]?.motivo).toBe("pedido");
      expect(rows[0]?.proxima_em.getTime()).toBeLessThanOrEqual(Date.now());
      preparar(p.numero, resposta("valido"));
      await correr();
      expect((await provas(id))[0]).toMatchObject({ motivo: "pedido" });
    });

    it("Q6: sem resposta, o válido fica válido com a data antiga; sem nenhuma, «indisponivel»; a espera cresce 1, 5, 30 min e depois a noite", async () => {
      const p = await perfilFrances();
      const id = String(p["id"]);
      preparar(p.numero, resposta("valido"));
      await correr();
      preparar(p.numero, resposta("indisponivel"));
      await ok(pedir("POST", `/billing-profiles/${id}/vies-checks`), 202);
      await correr();
      expect((await provas(id))[0]).toMatchObject({
        resultado: "indisponivel",
        codigo_erro: "MS_UNAVAILABLE",
      });
      expect(await ok(pedir("GET", `/billing-profiles/${id}`))).toMatchObject({
        estado_vies: "valido",
        validado_em: "2026-10-09T10:00:00.000Z",
      });
      const novo = await perfilFrances();
      const idNovo = String(novo["id"]);
      const esperas: number[] = [];
      for (let i = 0; i < 4; i++) {
        // Sem resposta preparada: «indisponivel». Põe-se a linha a vencer.
        await sql`update vies_fila set proxima_em = now() where perfil_id = ${idNovo.slice(4)}::uuid`.execute(
          base.dono,
        );
        await correr();
        const { rows } = await fila(idNovo);
        esperas.push((rows[0]?.proxima_em.getTime() ?? 0) - Date.now());
      }
      expect(
        await ok(pedir("GET", `/billing-profiles/${idNovo}`)),
      ).toMatchObject({
        estado_vies: "indisponivel",
        validado_em: null,
      });
      const min = 60_000;
      expect(esperas[0]).toBeLessThan(1.1 * min);
      expect(esperas[1]).toBeGreaterThan(4 * min);
      expect(esperas[1]).toBeLessThan(5.1 * min);
      expect(esperas[2]).toBeGreaterThan(29 * min);
      expect(esperas[2]).toBeLessThan(30.1 * min);
      expect(esperas[3]).toBeGreaterThan(23.9 * 60 * min);
    });

    it("de válido a inválido: o evento invalidated; a isenção manual não se toca", async () => {
      const p = await perfilFrances();
      const id = String(p["id"]);
      preparar(p.numero, resposta("valido"));
      await correr();
      await ok(
        pedir("PUT", `/billing-profiles/${id}/exemption`, {
          motivo: "transportadora própria, declaração aduaneira entregue",
        }),
        201,
      );
      preparar(p.numero, resposta("invalido"));
      await ok(pedir("POST", `/billing-profiles/${id}/vies-checks`), 202);
      await correr();
      expect(await ok(pedir("GET", `/billing-profiles/${id}`))).toMatchObject({
        estado_vies: "invalido",
        isencao_em_vigor: true,
      });
      const tipos = (await eventos(a, id)).map((e) => e.tipo);
      expect(tipos).toContain("billing_profile.invalidated");
      expect(tipos.filter((t) => t === "billing_profile.updated")).toEqual([]);
    });

    it("uma resposta mais antiga, gravada depois, não se sobrepõe à mais recente (P2-2)", async () => {
      const p = await perfilFrances();
      const id = String(p["id"]).slice(4);
      preparar(p.numero, resposta("valido"));
      await correr();
      const registar = (resultado: string, consultadoEm: string) =>
        base.dono.transaction().execute(async (trx) => {
          await sql`select set_config('eurolify.comerciante', ${a}, true), set_config('eurolify.quem', 'sistema:vies', true)`.execute(
            trx,
          );
          await sql`select vies_registar(${id}::uuid, 'FR', ${p.numero}, null, null,
          ${consultadoEm}::timestamptz, null, ${resultado}, null, null, null, null, 'revalidacao')`.execute(
            trx,
          );
        });
      const t0 = new Date(Date.now() + 1000).toISOString();
      const t1 = new Date(Date.now() + 2000).toISOString();
      await registar("invalido", t1);
      await registar("valido", t0);
      expect(
        await ok(pedir("GET", `/billing-profiles/${String(p["id"])}`)),
      ).toMatchObject({ estado_vies: "invalido" });
    });

    it("um NIF mudado durante a consulta: a prova fica, o estado e a fila do NIF novo não mudam", async () => {
      const p = await perfilFrances();
      const id = String(p["id"]);
      preparar(p.numero, resposta("valido"));
      durante = async () => {
        await ok(
          pedir("PATCH", `/billing-profiles/${id}`, {
            versao: p["versao"],
            nif: "BE0123456749",
          }),
        );
      };
      // Só este perfil está a vencer agora? Outros podem estar; o `durante`
      // corre na primeira consulta, por isso põe-se este à frente.
      await sql`update vies_fila set proxima_em = now() - interval '1 day' where perfil_id = ${id.slice(4)}::uuid`.execute(
        base.dono,
      );
      await correr();
      expect(
        (await provas(id)).find((v) => v["numero_consultado"] === p.numero),
      ).toMatchObject({
        resultado: "valido",
      });
      const agora = await ok(pedir("GET", `/billing-profiles/${id}`));
      expect(agora).toMatchObject({
        pais_contribuinte: "BE",
        estado_vies: expect.stringMatching(
          /^(por_validar|indisponivel)$/,
        ) as unknown,
        validado_em: null,
      });
    });

    it("uma falha a gravar ou a consultar adia a linha; os outros perfis seguem (P2-1)", async () => {
      const mau = await perfilFrances();
      const bom = await perfilFrances();
      preparar(mau.numero, new Error("o VIES rebentou"));
      preparar(bom.numero, resposta("valido"));
      await sql`update vies_fila set proxima_em = now() - interval '1 day' where perfil_id = ${String(mau["id"]).slice(4)}::uuid`.execute(
        base.dono,
      );
      const falhas: unknown[] = [];
      await correrFilaVies(base.api, falso, (_c, _p, e) => falhas.push(e), {
        pausaMs: 0,
        porVolta: 1000,
        total: 1000,
      });
      expect(falhas).toHaveLength(1);
      const { rows } = await fila(String(mau["id"]));
      expect(rows[0]?.tentativas).toBe(1);
      expect(rows[0]?.proxima_em.getTime()).toBeGreaterThan(Date.now());
      expect(
        await ok(pedir("GET", `/billing-profiles/${String(bom["id"])}`)),
      ).toMatchObject({ estado_vies: "valido" });
      // Um nome devolvido longo demais não faz a gravação falhar.
      const longo = await perfilFrances();
      preparar(longo.numero, resposta("valido", { nome: "N".repeat(500) }));
      await correr();
      expect(
        await ok(pedir("GET", `/billing-profiles/${String(longo["id"])}`)),
      ).toMatchObject({ estado_vies: "valido" });
    });

    it("o estado do VIES só muda pela vies_registar: um UPDATE à mão sem ela não pega", async () => {
      const p = await perfilFrances();
      await noComerciante(a, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:per_x', true)`.execute(
          trx,
        );
        await sql`update perfil_faturacao set estado_vies = 'valido', nome_documento = 'X'
                where id = ${String(p["id"]).slice(4)}::uuid`.execute(trx);
      });
      expect(
        await ok(pedir("GET", `/billing-profiles/${String(p["id"])}`)),
      ).toMatchObject({ estado_vies: "por_validar", nome_documento: "X" });
    });

    it("só num perfil com VIES aplicável; sem consulta ligada, 503", async () => {
      const f = await ok(pedir("POST", "/customers", { nome: "Rui" }), 201);
      const pt = await ok(
        pedir("POST", `/customers/${String(f["id"])}/billing-profiles`, {
          tipo: "empresa",
          nome_documento: "Rui, Lda",
          nif: "263631656",
        }),
        201,
      );
      await recusa(
        pedir("POST", `/billing-profiles/${String(pt["id"])}/vies-checks`),
        409,
        "customers.vies_not_applicable",
      );
      const fr = await perfilFrances();
      await recusa(
        pedir(
          "POST",
          `/billing-profiles/${String(fr["id"])}/vies-checks`,
          undefined,
          dono,
          semVies,
        ),
        503,
        "customers.vies_disabled",
      );
    });

    it("a fila: cada comerciante no seu contexto; B sem entidade vai sem requerente; o arquivado sai", async () => {
      const pa = await perfilFrances();
      const pb = await perfilFrances(deB);
      const arquivado = await perfilFrances();
      await ok(
        pedir("POST", `/billing-profiles/${String(arquivado["id"])}/archive`, {
          versao: arquivado["versao"],
        }),
      );
      expect((await fila(String(arquivado["id"]))).rows).toEqual([]);
      preparar(pa.numero, resposta("valido"));
      preparar(pb.numero, resposta("valido"));
      await correr();
      expect(
        await ok(pedir("GET", `/billing-profiles/${String(pa["id"])}`)),
      ).toMatchObject({ estado_vies: "valido" });
      expect((await provas(String(pb["id"]), deB))[0]).toMatchObject({
        requerente: null,
        quem: "sistema:vies",
        motivo: "perfil_novo",
      });
      // O que se consulta no contexto de B não traz nada de A.
      const deBVe = await noComerciante(b, async (trx) =>
        (
          await sql<{
            perfil_id: string;
          }>`select perfil_id from vies_por_consultar(1000)`.execute(trx)
        ).rows.map((r) => r.perfil_id),
      );
      expect(deBVe).not.toContain(String(pa["id"]).slice(4));
      // Uma segunda volta não volta a consultar os respondidos (a próxima é à noite).
      consultas.length = 0;
      await correr();
      expect(
        consultas.filter(
          (c) => c.numero === pa.numero || c.numero === pb.numero,
        ),
      ).toEqual([]);
    });

    it("um país que diz «pedidos a mais» fica de fora até à volta seguinte (P2-8)", async () => {
      const p1 = await perfilFrances();
      const p2 = await perfilFrances();
      for (const p of [p1, p2]) {
        await sql`update vies_fila set proxima_em = now() - interval '2 days' where perfil_id = ${String(p["id"]).slice(4)}::uuid`.execute(
          base.dono,
        );
      }
      preparar(
        p1.numero,
        resposta("indisponivel", { codigoErro: "MS_MAX_CONCURRENT_REQ" }),
      );
      preparar(
        p2.numero,
        resposta("indisponivel", { codigoErro: "MS_MAX_CONCURRENT_REQ" }),
      );
      consultas.length = 0;
      await correr();
      const francesas = consultas.filter((c) => c.pais === "FR");
      expect(francesas).toHaveLength(1);
    });

    it("a isenção manual: uma em vigor, retira-se com motivo, fica o histórico e o NIF; só com customers:exemptions", async () => {
      const p = await perfilFrances();
      const id = String(p["id"]);
      expect(
        (
          await pedir(
            "PUT",
            `/billing-profiles/${id}/exemption`,
            { motivo: "x" },
            semIsencoes,
          )
        ).statusCode,
      ).toBe(403);
      const i = await ok(
        pedir("PUT", `/billing-profiles/${id}/exemption`, {
          motivo: "transportadora própria",
          nota: "declaração DAU 26PT000123",
        }),
        201,
      );
      expect(i).toMatchObject({
        em_vigor: true,
        motivo: "transportadora própria",
      });
      expect(String(i["posta_por"])).toMatch(/^chave:key_/);
      const linha = await noComerciante(
        a,
        async (trx) =>
          (
            await sql<{ pais_contribuinte: string; nif_numero: string }>`
          select pais_contribuinte, nif_numero from isencao_manual
          where id = ${String(i["id"]).slice(4)}::uuid`.execute(trx)
          ).rows[0],
      );
      expect(linha).toEqual({ pais_contribuinte: "FR", nif_numero: p.numero });
      await recusa(
        pedir("PUT", `/billing-profiles/${id}/exemption`, { motivo: "outra" }),
        409,
        "customers.exemption_active",
      );
      expect(
        await ok(
          pedir("DELETE", `/billing-profiles/${id}/exemption`, {
            motivo_retirada: "o cliente deixou de usar transportadora própria",
          }),
        ),
      ).toMatchObject({ em_vigor: false });
      await recusa(
        pedir("DELETE", `/billing-profiles/${id}/exemption`, {
          motivo_retirada: "x",
        }),
        404,
        "customers.not_found",
      );
      await ok(
        pedir("PUT", `/billing-profiles/${id}/exemption`, { motivo: "nova" }),
        201,
      );
      const lista = await ok(
        pedir("GET", `/billing-profiles/${id}/exemptions`),
      );
      expect((lista["dados"] as Json[]).map((x) => x["em_vigor"])).toEqual([
        true,
        false,
      ]);
      const tipos = (await eventos(a, id)).map((e) => e.tipo);
      expect(
        tipos.filter((t) => t.startsWith("billing_profile.exemption")),
      ).toEqual([
        "billing_profile.exemption_set",
        "billing_profile.exemption_removed",
        "billing_profile.exemption_set",
      ]);
    });

    it("só uma pessoa ou a chave dela põe ou retira uma isenção; não se altera nem se apaga", async () => {
      const p = await perfilFrances();
      const i = await ok(
        pedir("PUT", `/billing-profiles/${String(p["id"])}/exemption`, {
          motivo: "m",
        }),
        201,
      );
      const isencao = String(i["id"]).slice(4);
      const tentar = (quem: string, consulta: string) =>
        base.dono.transaction().execute(async (trx) => {
          await sql`select set_config('eurolify.comerciante', ${a}, true), set_config('eurolify.quem', ${quem}, true)`.execute(
            trx,
          );
          await sql.raw(consulta.replace("$ID", isencao)).execute(trx);
        });
      for (const quem of [
        "sistema:vies",
        "operador:x",
        "importacao:imp_1",
        "motor-iva:x",
      ]) {
        await expect(
          tentar(
            quem,
            "update isencao_manual set motivo_retirada = 'auto' where id = '$ID'",
          ),
        ).rejects.toThrow(/customers.exemption_by_person/);
        await expect(
          tentar(
            quem,
            `insert into isencao_manual (comerciante_id, perfil_id, motivo)
           select comerciante_id, id, 'auto' from perfil_faturacao where id = '${String(p["id"]).slice(4)}'`,
          ),
        ).rejects.toThrow(/customers.exemption_by_person/);
      }
      await expect(
        tentar(
          "pessoa:per_x",
          "update isencao_manual set motivo = 'outro' where id = '$ID'",
        ),
      ).rejects.toThrow(/customers.exemption_immutable/);
      await expect(
        tentar(
          "pessoa:per_x",
          "update isencao_manual set motivo = 'outro', motivo_retirada = 'r' where id = '$ID'",
        ),
      ).rejects.toThrow(/customers.exemption_immutable/);
      await expect(
        tentar("pessoa:per_x", "delete from isencao_manual where id = '$ID'"),
      ).rejects.toThrow();
      await expect(
        tentar(
          "sistema:vies",
          "update validacao_vies set resultado = 'valido'",
        ),
      ).rejects.toThrow();
    });

    it("o requerente: só com uma entidade legal activa num país da UE; com duas, vai sem", async () => {
      const c = await registarComerciante(base.api, {
        nome: "C",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      for (const [pais, numero] of [
        ["PT", "513207384"],
        ["ES", "B12345678"],
      ] as const) {
        await criarEntidadeLegal(base.api, c, {
          denominacao: `C ${pais}`,
          forma_juridica: "sociedade",
          pais,
          numero_fiscal: numero,
          morada_linha: "Rua 1",
          morada_codigo_postal: "1000-001",
          morada_localidade: "Lisboa",
        });
      }
      const deC = (
        await criarChave(base.dono, c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "C",
          ambitos: [
            "customers:read",
            "customers:write",
            "customers:billing",
          ] as never,
        })
      ).segredo;
      const p = await perfilFrances(deC);
      preparar(p.numero, resposta("valido"));
      consultas.length = 0;
      await correr();
      expect(
        consultas.find((x) => x.numero === p.numero)?.requerente,
      ).toBeNull();
    });

    it("o isolamento: as provas e as isenções de A não existem para B", async () => {
      const p = await perfilFrances();
      const id = String(p["id"]);
      for (const [metodo, url, corpo] of [
        ["GET", `/billing-profiles/${id}/vies-checks`, undefined],
        ["POST", `/billing-profiles/${id}/vies-checks`, undefined],
        ["GET", `/billing-profiles/${id}/exemptions`, undefined],
        ["PUT", `/billing-profiles/${id}/exemption`, { motivo: "B" }],
        [
          "DELETE",
          `/billing-profiles/${id}/exemption`,
          { motivo_retirada: "B" },
        ],
      ] as const) {
        await recusa(
          pedir(metodo, url, corpo, deB),
          404,
          "customers.not_found",
        );
      }
    });
  },
);
