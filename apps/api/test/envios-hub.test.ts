import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";
import { opcao, PUBLICA, SECRETA, sendcloudFalsa } from "./sendcloud-falsa.js";

// As contas de transportadora pelo Hub (docs/22 §29): as rotas /hub/
// carrier-accounts fazem o mesmo que as da chave, com o âmbito do papel
// (só o dono liga e mexe; o gestor, o armazém e o apoio vêem), e os
// segredos nunca voltam em nenhuma resposta.

type Json = Record<string, unknown>;
const SEGREDO_AVISO = "segredo-dos-avisos-sendcloud-1";

describe.skipIf(URL_BASE === undefined)(
  "Hub: as contas de transportadora",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;
    let a = "";
    let b = "";
    const p: Record<string, { pessoa: string; sessao: string }> = {};
    const sc = sendcloudFalsa();
    /** Todos os corpos de resposta, para procurar os segredos no fim. */
    const corpos: string[] = [];

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
      // Um mercado em Portugal: a fotografia dos serviços pede-os para ele.
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
      await criarMercado(base.api, a, {
        loja_id: loja,
        nome: "Portugal",
        paises: ["PT"],
        moeda: "EUR",
        linguas: ["pt"],
        lingua_principal: "pt",
      });
      sc.estado.servicos.set("PT", [opcao(SERVICO_DE_TESTE)]);
      for (const papel of ["dono", "gestor", "armazem", "apoio"]) {
        const x = await h.pessoaCom(a, papel);
        p[papel] = { pessoa: x.pessoa, sessao: x.sessao };
      }
      const x = await h.pessoaCom(b, "dono");
      p["donoB"] = { pessoa: x.pessoa, sessao: x.sessao };
    }, 120_000);

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    const como = async (
      papel: string,
      metodo: "GET" | "POST" | "PATCH" | "PUT",
      url: string,
      corpo?: unknown,
    ) => {
      const r = await h.pedir(metodo, url, {
        sessao: p[papel]?.sessao ?? "",
        comerciante: papel === "donoB" ? b : a,
        ...(corpo === undefined ? {} : { corpo }),
      });
      corpos.push(r.body);
      return r;
    };
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
    const remetente = {
      nome: "Armazém",
      linha1: "Rua 1",
      codigo_postal: "1000-001",
      localidade: "Lisboa",
      pais: "PT",
    };

    it("o dono liga a Sendcloud: os campos que o adaptador declara, as credenciais (sem voltarem), o teste e os serviços", async () => {
      expect(
        (await ok(como("dono", "GET", "/hub/carrier-accounts")))["dados"],
      ).toEqual([]);
      const { id } = (await ok(
        como("dono", "POST", "/hub/carrier-accounts", {
          transportadora: "sendcloud",
          nome: "Sendcloud (teste)",
          remetente,
        }),
        201,
      )) as { id: string };
      const lista = async () =>
        (
          (await ok(como("dono", "GET", "/hub/carrier-accounts")))[
            "dados"
          ] as Json[]
        ).find((c) => c["id"] === id);
      expect(await lista()).toMatchObject({
        transportadora: "sendcloud",
        estado: "rascunho",
        modo: "teste",
        servicos_em: null,
        credenciais_em: null,
        campos_credenciais: [
          { campo: "chave_publica", segredo: false },
          { campo: "chave_secreta", segredo: true },
        ],
      });
      await ok(
        como("dono", "PUT", `/hub/carrier-accounts/${id}/credentials`, {
          credenciais: { chave_publica: PUBLICA, chave_secreta: SECRETA },
          segredo_aviso: SEGREDO_AVISO,
        }),
        204,
      );
      expect(await lista()).toMatchObject({
        credenciais_por: `pessoa:per_${p["dono"]?.pessoa ?? ""}`,
      });
      await ok(como("dono", "POST", `/hub/carrier-accounts/${id}/test`, {}));
      const pronta = await lista();
      expect(pronta).toMatchObject({ estado: "pronta" });
      expect(pronta?.["servicos_em"]).not.toBeNull();
      expect(
        (
          (
            await ok(
              como("armazem", "GET", `/hub/carrier-accounts/${id}/services`),
            )
          )["dados"] as Json[]
        ).map((s) => [s["codigo"], s["paises"]]),
      ).toEqual([[SERVICO_DE_TESTE, ["PT"]]]);
      // Mudar o nome com a versão lida; uma versão antiga dá 409.
      const versao = Number(pronta?.["versao"]);
      await ok(
        como("dono", "PATCH", `/hub/carrier-accounts/${id}`, {
          versao,
          nome: "Sendcloud",
        }),
      );
      expect(
        await codigo(
          como("dono", "PATCH", `/hub/carrier-accounts/${id}`, {
            versao,
            nome: "Outra vez",
          }),
        ),
      ).toEqual([409, "shipping.version_conflict"]);
      // As leituras não ficam em nenhuma cache.
      const r = await h.pedir("GET", "/hub/carrier-accounts", {
        sessao: p["dono"]?.sessao ?? "",
        comerciante: a,
      });
      expect(r.headers["cache-control"]).toBe("private, no-store");
    });

    it("o gestor, o armazém e o apoio vêem mas não ligam nem mexem; outro comerciante não chega à conta", async () => {
      const contas = (await ok(como("dono", "GET", "/hub/carrier-accounts")))[
        "dados"
      ] as Json[];
      const id = String(contas[0]?.["id"]);
      for (const papel of ["gestor", "armazem", "apoio"]) {
        expect(
          (
            (await ok(como(papel, "GET", "/hub/carrier-accounts")))[
              "dados"
            ] as Json[]
          ).length,
        ).toBe(1);
        expect(
          await codigo(
            como(papel, "POST", "/hub/carrier-accounts", {
              transportadora: "sendcloud",
              nome: "x",
              remetente,
            }),
          ),
        ).toEqual([403, "member.role_escalation"]);
        expect(
          await codigo(
            como(papel, "PUT", `/hub/carrier-accounts/${id}/credentials`, {
              credenciais: { chave_publica: "x", chave_secreta: "y" },
            }),
          ),
        ).toEqual([403, "member.role_escalation"]);
        expect(
          await codigo(
            como(papel, "POST", `/hub/carrier-accounts/${id}/test`, {}),
          ),
        ).toEqual([403, "member.role_escalation"]);
      }
      expect(
        (
          (await ok(como("donoB", "GET", "/hub/carrier-accounts")))[
            "dados"
          ] as Json[]
        ).length,
      ).toBe(0);
      expect(
        await codigo(
          como("donoB", "GET", `/hub/carrier-accounts/${id}/services`),
        ),
      ).toEqual([404, "shipping.not_found"]);
      expect(
        await codigo(
          como("donoB", "PATCH", `/hub/carrier-accounts/${id}`, {
            versao: 1,
            nome: "x",
          }),
        ),
      ).toEqual([404, "shipping.not_found"]);
      expect(
        await codigo(
          como("donoB", "PUT", `/hub/carrier-accounts/${id}/credentials`, {
            credenciais: { chave_publica: "x", chave_secreta: "y" },
          }),
        ),
      ).toEqual([404, "shipping.not_found"]);
    });

    it("os segredos nunca aparecem em nenhuma resposta (docs/22 §29.4)", () => {
      expect(corpos.length).toBeGreaterThan(10);
      for (const corpo of corpos) {
        expect(corpo).not.toContain(SECRETA);
        expect(corpo).not.toContain(SEGREDO_AVISO);
      }
    });
  },
);
