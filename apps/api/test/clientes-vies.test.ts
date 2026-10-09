import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
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
// migração 0038). Nenhum teste chama a Comissão: o adaptador fala com um
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
    let proximas: RespostaVies[] = [];
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
      requerente: { pais: "PT", numero: "509999990" },
      ...extra,
    });
    const falso = async (p: PedidoVies): Promise<RespostaVies> => {
      consultas.push(p);
      if (durante !== undefined) {
        const f = durante;
        durante = undefined;
        await f();
      }
      const r = proximas.shift();
      if (r === undefined)
        throw new Error("consulta falsa sem resposta preparada");
      return { ...r, requerente: p.requerente };
    };

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

    /** Uma ficha com um perfil francês (VIES aplicável num comerciante português). */
    async function perfilFrances(segredo = dono, nif = "FR40303265045") {
      const f = await ok(
        pedir("POST", "/customers", { nome: "Ana" }, segredo),
        201,
      );
      return ok(
        pedir(
          "POST",
          `/customers/${String(f["id"])}/billing-profiles`,
          { tipo: "empresa", nome_documento: "Ana SARL", nif },
          segredo,
        ),
        201,
      );
    }

    async function noComerciante<T>(
      c: string,
      fn: (trx: Kysely<BaseDados>) => Promise<T>,
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

    it("consultar agora: a prova com o requerente, o perfil válido com a data, um evento", async () => {
      const p = await perfilFrances();
      expect(p["estado_vies"]).toBe("por_validar");
      consultas.length = 0;
      proximas = [resposta("valido")];
      const prova = await ok(
        pedir("POST", `/billing-profiles/${String(p["id"])}/vies-checks`),
        201,
      );
      expect(consultas).toEqual([
        {
          pais: "FR",
          numero: "40303265045",
          requerente: { pais: "PT", numero: "509999990" },
        },
      ]);
      expect(prova).toMatchObject({
        perfil: p["id"],
        pais_consultado: "FR",
        numero_consultado: "40303265045",
        requerente: "PT509999990",
        resultado: "valido",
        identificador_consulta: "WAPI0001",
        nome_devolvido: "ANA SARL",
        data_vies: "2026-10-09T10:00:00.000Z",
        motivo: "pedido",
        codigo_erro: null,
      });
      expect(String(prova["quem"])).toMatch(/^chave:key_/);
      const agora = await ok(
        pedir("GET", `/billing-profiles/${String(p["id"])}`),
      );
      expect(agora).toMatchObject({
        estado_vies: "valido",
        validado_em: "2026-10-09T10:00:00.000Z",
      });
      const tipos = (await eventos(a, String(p["id"]))).map((e) => e.tipo);
      expect(tipos).toEqual([
        "billing_profile.created",
        "billing_profile.validated",
      ]);
      // A revalidação fica para a noite, a pelo menos 24 h.
      const { rows } = await fila(String(p["id"]));
      expect(rows[0]?.motivo).toBe("revalidacao");
      expect(rows[0]?.proxima_em.getTime()).toBeGreaterThan(
        Date.now() + 23.9 * 3600_000,
      );
      const hora = rows[0]?.proxima_em.getUTCHours() ?? -1;
      expect(hora).toBeGreaterThanOrEqual(1);
      expect(hora).toBeLessThan(5);
    });

    it("Q6: sem resposta, o válido fica válido com a data antiga; um perfil sem nenhuma resposta fica «indisponivel»", async () => {
      const p = await perfilFrances();
      const id = String(p["id"]);
      proximas = [resposta("valido"), resposta("indisponivel")];
      await ok(pedir("POST", `/billing-profiles/${id}/vies-checks`), 201);
      const sem = await ok(
        pedir("POST", `/billing-profiles/${id}/vies-checks`),
        201,
      );
      expect(sem).toMatchObject({
        resultado: "indisponivel",
        codigo_erro: "MS_UNAVAILABLE",
      });
      expect(await ok(pedir("GET", `/billing-profiles/${id}`))).toMatchObject({
        estado_vies: "valido",
        validado_em: "2026-10-09T10:00:00.000Z",
      });
      const novo = await perfilFrances();
      proximas = [resposta("indisponivel")];
      await ok(
        pedir("POST", `/billing-profiles/${String(novo["id"])}/vies-checks`),
        201,
      );
      expect(
        await ok(pedir("GET", `/billing-profiles/${String(novo["id"])}`)),
      ).toMatchObject({
        estado_vies: "indisponivel",
        validado_em: null,
      });
      // A fila tenta outra vez dentro de 1 minuto.
      const { rows } = await fila(String(novo["id"]));
      expect(rows[0]?.tentativas).toBe(1);
      expect(rows[0]?.proxima_em.getTime()).toBeLessThan(
        Date.now() + 2 * 60_000,
      );
      // As provas, da mais recente para a mais antiga.
      const provas = await ok(
        pedir("GET", `/billing-profiles/${id}/vies-checks`),
      );
      expect((provas["dados"] as Json[]).map((v) => v["resultado"])).toEqual([
        "indisponivel",
        "valido",
      ]);
    });

    it("de válido a inválido: o evento invalidated; a isenção manual não se toca", async () => {
      const p = await perfilFrances();
      const id = String(p["id"]);
      proximas = [resposta("valido")];
      await ok(pedir("POST", `/billing-profiles/${id}/vies-checks`), 201);
      await ok(
        pedir("PUT", `/billing-profiles/${id}/exemption`, {
          motivo: "transportadora própria, declaração aduaneira entregue",
        }),
        201,
      );
      proximas = [resposta("invalido")];
      await ok(pedir("POST", `/billing-profiles/${id}/vies-checks`), 201);
      expect(await ok(pedir("GET", `/billing-profiles/${id}`))).toMatchObject({
        estado_vies: "invalido",
        isencao_em_vigor: true,
      });
      const tipos = (await eventos(a, id)).map((e) => e.tipo);
      expect(tipos).toContain("billing_profile.invalidated");
      expect(tipos.filter((t) => t === "billing_profile.updated")).toEqual([]);
    });

    it("um NIF mudado durante a consulta: a prova fica, o estado do NIF novo não muda", async () => {
      const p = await perfilFrances();
      const id = String(p["id"]);
      proximas = [resposta("valido")];
      durante = async () => {
        await ok(
          pedir("PATCH", `/billing-profiles/${id}`, {
            versao: p["versao"],
            nif: "BE0123456749",
          }),
        );
      };
      const prova = await ok(
        pedir("POST", `/billing-profiles/${id}/vies-checks`),
        201,
      );
      expect(prova).toMatchObject({
        numero_consultado: "40303265045",
        resultado: "valido",
      });
      expect(await ok(pedir("GET", `/billing-profiles/${id}`))).toMatchObject({
        pais_contribuinte: "BE",
        estado_vies: "por_validar",
        validado_em: null,
      });
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

    it("a fila: consulta os por validar de cada comerciante, com quem «sistema:vies»; o arquivado sai da fila", async () => {
      const pa = await perfilFrances();
      const pb = await perfilFrances(deB, "FR40303265045");
      const arquivado = await perfilFrances();
      await ok(
        pedir("POST", `/billing-profiles/${String(arquivado["id"])}/archive`, {
          versao: arquivado["versao"],
        }),
      );
      expect((await fila(String(arquivado["id"]))).rows).toEqual([]);
      consultas.length = 0;
      // Tudo o que estiver na fila de testes anteriores também passa: respostas
      // de sobra.
      proximas = Array.from({ length: 30 }, () => resposta("valido"));
      const falhas: unknown[] = [];
      const r = await correrFilaVies(
        base.api,
        falso,
        (_c, _p, e) => falhas.push(e),
        {
          pausaMs: 0,
        },
      );
      expect(falhas).toEqual([]);
      expect(r.consultas).toBeGreaterThanOrEqual(2);
      expect(
        await ok(pedir("GET", `/billing-profiles/${String(pa["id"])}`)),
      ).toMatchObject({
        estado_vies: "valido",
      });
      expect(
        await ok(
          pedir("GET", `/billing-profiles/${String(pb["id"])}`, undefined, deB),
        ),
      ).toMatchObject({ estado_vies: "valido" });
      // B não tem entidade legal: vai sem requerente.
      const provaB = await ok(
        pedir(
          "GET",
          `/billing-profiles/${String(pb["id"])}/vies-checks`,
          undefined,
          deB,
        ),
      );
      expect((provaB["dados"] as Json[])[0]).toMatchObject({
        requerente: null,
        quem: "sistema:vies",
        motivo: "perfil_novo",
      });
      // Uma segunda volta não volta a consultar (a próxima é à noite).
      consultas.length = 0;
      await correrFilaVies(base.api, falso, () => undefined, { pausaMs: 0 });
      expect(consultas).toEqual([]);
    });

    it("a isenção manual: uma em vigor, retira-se com motivo, fica o histórico; só com customers:exemptions", async () => {
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
      await recusa(
        pedir("PUT", `/billing-profiles/${id}/exemption`, { motivo: "outra" }),
        409,
        "customers.exemption_active",
      );
      const retirada = await ok(
        pedir("DELETE", `/billing-profiles/${id}/exemption`, {
          motivo_retirada: "o cliente deixou de usar transportadora própria",
        }),
      );
      expect(retirada).toMatchObject({ em_vigor: false });
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

    it("nenhum processo de sistema retira uma isenção; não se altera nem se apaga", async () => {
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
      await expect(
        tentar(
          "sistema:vies",
          "update isencao_manual set motivo_retirada = 'auto' where id = '$ID'",
        ),
      ).rejects.toThrow(/customers.exemption_by_person/);
      await expect(
        tentar(
          "pessoa:per_x",
          "update isencao_manual set motivo = 'outro' where id = '$ID'",
        ),
      ).rejects.toThrow(/customers.exemption_immutable/);
      // Mudar o motivo ao retirar também não: só se retira.
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
      consultas.length = 0;
      proximas = [resposta("valido")];
      await ok(
        pedir(
          "POST",
          `/billing-profiles/${String(p["id"])}/vies-checks`,
          undefined,
          deC,
        ),
        201,
      );
      expect(consultas[0]?.requerente).toBeNull();
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
