import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  adaptadorSendcloud,
  SERVICO_DE_TESTE,
} from "../src/envios/sendcloud.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import { criarMercado } from "../src/precos/repositorio.js";
import { criarArmazem } from "../src/stock/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";
import { opcao, PUBLICA, SECRETA, sendcloudFalsa } from "./sendcloud-falsa.js";

// Os métodos de entrega e a embalagem pelo Hub (docs/22 §31): as mesmas
// funções das rotas da chave; o dono e o gestor mudam (shipping:write), o
// armazém e o apoio só vêem; o servidor confere a conta e o serviço.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)(
  "Hub: os métodos de entrega e a embalagem",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;
    let a = "";
    let b = "";
    let mercado = "";
    let armazem = "";
    const p: Record<string, string> = {};
    const sc = sendcloudFalsa();

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      h = hubDeTeste(base, {
        envios: {
          chave: chavePagamentos(randomBytes(32).toString("base64")),
          adaptadores: { sendcloud: adaptadorSendcloud(sc.buscar) },
        },
      });
      a = await registarComerciante(base.api, {
        nome: "Loja A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      b = await registarComerciante(base.api, {
        nome: "Loja B",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const entidade = await criarEntidadeLegal(base.api, a, {
        denominacao: "Exemplo, Lda.",
        forma_juridica: "sociedade por quotas",
        pais: "PT",
        numero_fiscal: "509999990",
        morada_linha: "Rua 1",
        morada_codigo_postal: "1000-001",
        morada_localidade: "Lisboa",
      });
      const loja = await criarLoja(base.api, a, {
        entidade_legal_id: entidade,
        nome: "Loja online",
      });
      mercado = `mkt_${await criarMercado(base.api, a, {
        loja_id: loja,
        nome: "Portugal",
        paises: ["PT"],
        moeda: "EUR",
        linguas: ["pt", "en"],
        lingua_principal: "pt",
      })}`;
      armazem = `whs_${await comComerciante(base.api, a, (trx) =>
        criarArmazem(trx, a, { loja, nome: "Lisboa", morada: {} }),
      )}`;
      sc.estado.servicos.set("PT", [opcao(SERVICO_DE_TESTE)]);
      for (const papel of ["dono", "gestor", "armazem", "apoio"]) {
        p[papel] = (await h.pessoaCom(a, papel)).sessao;
      }
      p["donoB"] = (await h.pessoaCom(b, "dono")).sessao;
    }, 120_000);

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    const como = (
      papel: string,
      metodo: "GET" | "POST" | "PATCH" | "PUT",
      url: string,
      corpo?: unknown,
    ) =>
      h.pedir(metodo, url, {
        sessao: p[papel] ?? "",
        comerciante: papel === "donoB" ? b : a,
        ...(corpo === undefined ? {} : { corpo }),
      });
    const ok = async (
      r: Promise<{ statusCode: number; body: string }>,
      estado = 200,
    ) => {
      const x = await r;
      expect(x.statusCode, x.body).toBe(estado);
      return x.body === "" ? {} : (JSON.parse(x.body) as Json);
    };
    const codigo = async (
      r: Promise<{ statusCode: number; body: string }>,
    ): Promise<[number, unknown]> => {
      const x = await r;
      return [x.statusCode, (JSON.parse(x.body) as Json)["codigo"]];
    };
    const metodos = async (papel = "gestor") =>
      (await ok(como(papel, "GET", "/hub/shipping-methods")))[
        "dados"
      ] as Json[];

    it("o gestor cria um método manual e um com a conta da Sendcloud; o servidor confere o serviço", async () => {
      const mercados = (await ok(como("gestor", "GET", "/hub/markets")))[
        "dados"
      ] as Json[];
      expect(mercados.map((m) => [m["id"], m["moeda"]])).toEqual([
        [mercado, "EUR"],
      ]);
      const manual = (await ok(
        como("gestor", "POST", "/hub/shipping-methods", {
          mercado,
          nome: { pt: "Recolha na loja" },
          tarifa: 0,
        }),
        201,
      )) as { id: string };
      // A conta, ligada pelo dono (§29).
      const { id: conta } = (await ok(
        como("dono", "POST", "/hub/carrier-accounts", {
          transportadora: "sendcloud",
          nome: "Sendcloud (teste)",
          remetente: {
            nome: "Armazém",
            linha1: "Rua 1",
            codigo_postal: "1000-001",
            localidade: "Lisboa",
            pais: "PT",
          },
        }),
        201,
      )) as { id: string };
      await ok(
        como("dono", "PUT", `/hub/carrier-accounts/${conta}/credentials`, {
          credenciais: { chave_publica: PUBLICA, chave_secreta: SECRETA },
        }),
        204,
      );
      await ok(como("dono", "POST", `/hub/carrier-accounts/${conta}/test`, {}));
      expect(
        await codigo(
          como("gestor", "POST", "/hub/shipping-methods", {
            mercado,
            nome: { pt: "Correio" },
            tarifa: 499,
            conta,
            servico: "NAO_EXISTE",
          }),
        ),
      ).toEqual([422, "shipping.service_unknown"]);
      const correio = (await ok(
        como("gestor", "POST", "/hub/shipping-methods", {
          mercado,
          nome: { pt: "Correio registado", en: "Registered mail" },
          prazo: { pt: "2 a 3 dias úteis" },
          tarifa: 499,
          gratis_a_partir_de: 5000,
          conta,
          servico: SERVICO_DE_TESTE,
          prazo_max_dias: 5,
          codigos_postais: ["1", "2", "3", "4", "5", "6", "7", "8"],
        }),
        201,
      )) as { id: string };
      const lidos = await metodos();
      expect(lidos.map((m) => m["id"])).toEqual([manual.id, correio.id]);
      expect(lidos[1]).toMatchObject({
        mercado,
        tarifa: 499,
        gratis_a_partir_de: 5000,
        conta,
        servico: SERVICO_DE_TESTE,
        prazo_max_dias: 5,
        aceita_onu: [],
        estado: "activo",
      });
      // O filtro pelo mercado.
      expect(
        (
          (
            await ok(
              como("apoio", "GET", `/hub/shipping-methods?mercado=${mercado}`),
            )
          )["dados"] as Json[]
        ).length,
      ).toBe(2);
    });

    it("mudar com a versão lida; uma versão antiga dá 409; arquivar e reactivar", async () => {
      const m = (await metodos())[1] ?? {};
      const id = String(m["id"]);
      const versao = Number(m["versao"]);
      await ok(
        como("gestor", "PATCH", `/hub/shipping-methods/${id}`, {
          versao,
          tarifa: 599,
        }),
        204,
      );
      expect(
        await codigo(
          como("gestor", "PATCH", `/hub/shipping-methods/${id}`, {
            versao,
            tarifa: 699,
          }),
        ),
      ).toEqual([409, "checkout.version_conflict"]);
      await ok(
        como("dono", "PATCH", `/hub/shipping-methods/${id}`, {
          versao: versao + 1,
          estado: "arquivado",
        }),
        204,
      );
      expect((await metodos()).find((x) => x["id"] === id)).toMatchObject({
        tarifa: 599,
        estado: "arquivado",
      });
      await ok(
        como("dono", "PATCH", `/hub/shipping-methods/${id}`, {
          versao: versao + 2,
          estado: "activo",
        }),
        204,
      );
    });

    it("a embalagem: lê-se na lista dos armazéns e muda pelo dono e pelo gestor", async () => {
      const lista = async () =>
        (
          (await ok(como("armazem", "GET", "/hub/warehouses")))[
            "dados"
          ] as Json[]
        ).find((x) => x["id"] === armazem);
      expect(await lista()).toMatchObject({ nome: "Lisboa", embalagem_g: 0 });
      await ok(
        como("gestor", "PUT", `/hub/warehouses/${armazem}/packaging`, {
          embalagem_g: 200,
        }),
        204,
      );
      expect((await lista())?.["embalagem_g"]).toBe(200);
      expect(
        (
          await h.pedir("PUT", `/hub/warehouses/${armazem}/packaging`, {
            sessao: p["dono"] ?? "",
            comerciante: a,
            corpo: { embalagem_g: 100_001 },
          })
        ).statusCode,
      ).toBe(400);
    });

    it("o armazém e o apoio vêem mas não mudam; outro comerciante não chega", async () => {
      const m = (await metodos())[0] ?? {};
      const id = String(m["id"]);
      for (const papel of ["armazem", "apoio"]) {
        expect((await metodos(papel)).length).toBe(2);
        const recusa = await como(papel, "POST", "/hub/shipping-methods", {
          mercado,
          nome: { pt: "x" },
          tarifa: 1,
        });
        expect(recusa.statusCode).toBe(403);
        expect(recusa.headers["cache-control"]).toBe("private, no-store");
        expect(
          await codigo(
            como(papel, "PATCH", `/hub/shipping-methods/${id}`, {
              versao: Number(m["versao"]),
              tarifa: 1,
            }),
          ),
        ).toEqual([403, "member.role_escalation"]);
        expect(
          await codigo(
            como(papel, "PUT", `/hub/warehouses/${armazem}/packaging`, {
              embalagem_g: 1,
            }),
          ),
        ).toEqual([403, "member.role_escalation"]);
      }
      expect((await metodos("donoB")).length).toBe(0);
      expect(
        ((await ok(como("donoB", "GET", "/hub/warehouses")))["dados"] as Json[])
          .length,
      ).toBe(0);
      expect(
        await codigo(
          como("donoB", "PATCH", `/hub/shipping-methods/${id}`, {
            versao: Number(m["versao"]),
            tarifa: 1,
          }),
        ),
      ).toEqual([404, "checkout.not_found"]);
      expect(
        await codigo(
          como("donoB", "PUT", `/hub/warehouses/${armazem}/packaging`, {
            embalagem_g: 1,
          }),
        ),
      ).toEqual([404, "shipping.not_found"]);
      expect(
        await codigo(
          como("donoB", "POST", "/hub/shipping-methods", {
            mercado,
            nome: { pt: "x" },
            tarifa: 1,
          }),
        ),
      ).toEqual([404, "checkout.not_found"]);
    });
    it("uma conta por testar recusa-se; um método arquivado cuja conta deixou de estar pronta reactiva-se com «Manual» (revisão do #413, P2-1)", async () => {
      const { id: rascunho } = (await ok(
        como("dono", "POST", "/hub/carrier-accounts", {
          transportadora: "sendcloud",
          nome: "Por testar",
          remetente: {
            nome: "Armazém",
            linha1: "Rua 1",
            codigo_postal: "1000-001",
            localidade: "Lisboa",
            pais: "PT",
          },
        }),
        201,
      )) as { id: string };
      expect(
        await codigo(
          como("gestor", "POST", "/hub/shipping-methods", {
            mercado,
            nome: { pt: "x" },
            tarifa: 1,
            conta: rascunho,
            servico: SERVICO_DE_TESTE,
          }),
        ),
      ).toEqual([422, "shipping.account_not_ready"]);
      // O método da conta pronta: arquiva-se, e depois arquiva-se a conta.
      const m = (await metodos()).find((x) => x["conta"] !== null) ?? {};
      const id = String(m["id"]);
      const conta = String(m["conta"]);
      let versao = Number(m["versao"]);
      await ok(
        como("gestor", "PATCH", `/hub/shipping-methods/${id}`, {
          versao,
          estado: "arquivado",
        }),
        204,
      );
      versao += 1;
      const lida = (
        (await ok(como("dono", "GET", "/hub/carrier-accounts")))[
          "dados"
        ] as Json[]
      ).find((x) => x["id"] === conta);
      await ok(
        como("dono", "PATCH", `/hub/carrier-accounts/${conta}`, {
          versao: Number(lida?.["versao"]),
          arquivar: true,
        }),
      );
      expect(
        await codigo(
          como("gestor", "PATCH", `/hub/shipping-methods/${id}`, {
            versao,
            estado: "activo",
          }),
        ),
      ).toEqual([422, "shipping.account_not_ready"]);
      // «Manual» e reactivar no mesmo pedido: passa.
      await ok(
        como("gestor", "PATCH", `/hub/shipping-methods/${id}`, {
          versao,
          conta: null,
          servico: null,
          estado: "activo",
        }),
        204,
      );
      expect((await metodos()).find((x) => x["id"] === id)).toMatchObject({
        conta: null,
        servico: null,
        estado: "activo",
      });
    });

    it("as leituras não ficam em cache e sem sessão não se chega", async () => {
      const r = await como("apoio", "GET", "/hub/shipping-methods");
      expect(r.statusCode).toBe(200);
      expect(r.headers["cache-control"]).toBe("private, no-store");
      const sem = await h.pedir("GET", "/hub/shipping-methods", {
        comerciante: a,
      });
      expect(sem.statusCode).toBe(401);
    });
  },
);
