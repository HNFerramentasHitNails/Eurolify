import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comComerciante } from "../src/comerciante/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { cenariosDeEnvios, type Cenario } from "./envios-cenario.js";
import { eupagoFalso } from "./eupago-falso.js";
import { hubDeTeste } from "./hub-de-teste.js";
import { CHAVE_BOA, transportadoraFalsa } from "./transportadora-falsa.js";

// Entrega num ponto de recolha ou cacifo (docs/36 §21; migração 0090): o
// método `ponto`, a procura e a escolha no checkout (só o país e o código
// postal saem; a morada guardada é a da transportadora), o ponto conferido
// antes do botão final, a morada fiscal que nunca é a do ponto, a etiqueta
// com o ponto e o «entregue» que só conta depois do «para levantar».

type Json = Record<string, unknown>;

const ponto = (id: string, cp: string, extra: Partial<Json> = {}) => ({
  id,
  nome: `Papelaria ${id}`,
  linha1: "Rua Central 5",
  codigo_postal: cp,
  localidade: "Braga",
  pais: "PT",
  distanciaM: 300,
  ...extra,
});

describe.skipIf(URL_BASE === undefined)("Envios: pontos de recolha", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  const eupago = eupagoFalso();
  const ctt = transportadoraFalsa();
  let s: Cenario;
  let outro: Cenario;
  let metodoPonto = "";

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    h = hubDeTeste(base, {
      envios: {
        chave: chavePagamentos(randomBytes(32).toString("base64")),
        adaptadores: { ctt: ctt.adaptador },
        tempoLimiteMs: 1000,
      },
      pagamentos: eupago.config,
      limites: { pedidos: 100_000, janelaMs: 60_000 },
    });
    s = await apoio.cenario();
    outro = await apoio.cenario();
    metodoPonto = String(
      (
        await ok(
          s.adm("POST", "/shipping-methods", {
            mercado: `mkt_${s.mercado}`,
            nome: { pt: "Entrega num ponto" },
            tarifa: 299,
            conta: s.conta,
            servico: "PONTO_48",
            entrega: "ponto",
          }),
          201,
        )
      )["id"],
    );
    ctt.estado.pontos = [
      ponto("P1", "4700-000"),
      ponto("P2", "4700-001"),
      ponto("ES1", "28001", { pais: "ES" }),
    ];
  }, 180_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  const apoio = cenariosDeEnvios(
    () => h.app,
    () => base,
  );
  const { ok, codigo, pedir, expedicaoPaga } = apoio;

  /** Uma sessão aberta com uma linha, o contacto e a faturação. */
  async function sessao(
    c: Cenario = s,
    faturacao: Json = {
      finalidade: "consumo",
      tipo: "particular",
      nome_documento: "Rui",
    },
  ) {
    const loja = { authorization: `Bearer ${c.publica}` };
    const carrinho = await ok(
      pedir(
        "POST",
        "/store/carts",
        { canal: `chn_${c.canal}`, mercado: `mkt_${c.mercado}`, lingua: "pt" },
        loja,
      ),
      201,
    );
    const segredo = { ...loja, "x-cart-secret": String(carrinho["segredo"]) };
    await ok(
      pedir(
        "POST",
        `/store/carts/${String(carrinho["id"])}/lines`,
        { variante: `var_${c.v1}`, quantidade: 1 },
        segredo,
      ),
    );
    const token = String(
      (
        await ok(
          pedir(
            "POST",
            `/store/carts/${String(carrinho["id"])}/checkout`,
            undefined,
            segredo,
          ),
          201,
        )
      )["token"],
    );
    await ok(
      pedir("PUT", `/checkout/${token}/contact`, {
        email: "rui@exemplo.pt",
        nome: "Rui",
      }),
    );
    await ok(pedir("PUT", `/checkout/${token}/billing`, faturacao));
    await ok(
      pedir("PUT", `/checkout/${token}/payment-method`, {
        metodo: "multibanco",
      }),
    );
    return token;
  }

  const procurar = (token: string, cp = "4700-000", metodo = metodoPonto) =>
    pedir(
      "GET",
      `/checkout/${token}/pickup-points?metodo=${metodo}&pais=PT&codigo_postal=${cp}`,
    );
  const escolher = (token: string, id = "P1", metodo = metodoPonto) =>
    pedir("PUT", `/checkout/${token}/pickup-point`, {
      metodo,
      pais: "PT",
      codigo_postal: "4700-000",
      ponto: id,
    });

  it("o método `ponto` só com um serviço de pontos, e um serviço de pontos só num método `ponto`", async () => {
    const novo = (corpo: Json) =>
      codigo(
        s.adm("POST", "/shipping-methods", {
          mercado: `mkt_${s.mercado}`,
          nome: { pt: "X" },
          tarifa: 100,
          ...corpo,
        }),
      );
    expect(
      await novo({ conta: s.conta, servico: "EXPRESSO_48", entrega: "ponto" }),
    ).toEqual([400, "shipping.invalid_field"]);
    expect(await novo({ conta: s.conta, servico: "PONTO_48" })).toEqual([
      400,
      "shipping.invalid_field",
    ]);
    expect(await novo({ entrega: "ponto" })).toEqual([
      400,
      "shipping.invalid_field",
    ]);
    const m = await ok(
      s.adm("GET", `/shipping-methods?mercado=mkt_${s.mercado}`),
    );
    expect(
      (m["dados"] as Json[]).find((x) => x["id"] === metodoPonto)?.["entrega"],
    ).toBe("ponto");
    const servicos = await ok(
      s.adm("GET", `/carrier-accounts/${s.conta}/services`),
    );
    expect(
      (servicos["dados"] as Json[])
        .filter((x) => x["ponto"] === true)
        .map((x) => x["codigo"]),
    ).toEqual(["PONTO_48"]);
  });

  it("procurar e escolher: só o país e o código postal saem; o ponto escolhido é o da transportadora; um método `ponto` não se escolhe sem ponto", async () => {
    const token = await sessao();
    const lista = await ok(pedir("GET", `/checkout/${token}/delivery-methods`));
    expect(
      (lista["dados"] as Json[]).find((x) => x["id"] === metodoPonto),
    ).toMatchObject({ entrega: "ponto" });
    expect(
      await codigo(
        pedir("PUT", `/checkout/${token}/delivery-method`, {
          metodo: metodoPonto,
        }),
      ),
    ).toEqual([422, "checkout.pickup_point_required"]);

    const r = await ok(procurar(token));
    // O ponto de Espanha não é do país procurado.
    expect((r["dados"] as Json[]).map((x) => x["id"])).toEqual(["P1", "P2"]);
    expect(r["dados"]).toContainEqual({
      id: "P1",
      nome: "Papelaria P1",
      morada: {
        linha1: "Rua Central 5",
        codigo_postal: "4700-000",
        localidade: "Braga",
        pais: "PT",
      },
      distancia_m: 300,
    });
    expect(ctt.estado.procuras.at(-1)).toEqual({
      servico: "PONTO_48",
      pais: "PT",
      codigoPostal: "4700-000",
      limite: 10,
    });

    // Um ponto que a procura não devolve não se escolhe.
    expect(await codigo(escolher(token, "P9"))).toEqual([
      409,
      "checkout.pickup_point_unavailable",
    ]);
    await ok(escolher(token, "P1"));
    const sessaoLida = await ok(pedir("GET", `/checkout/${token}`));
    expect(sessaoLida["entrega"]).toEqual({
      pais: "PT",
      codigo_postal: "4700-000",
      linha1: "Rua Central 5",
      linha2: null,
      localidade: "Braga",
      ponto: { id: "P1", nome: "Papelaria P1" },
    });
    expect(sessaoLida["metodo_entrega"]).toBe(metodoPonto);
    const resumo = await ok(pedir("GET", `/checkout/${token}/summary`));
    expect(resumo["em_falta"]).toEqual([]);

    // Uma morada de casa depois tira o método `ponto`.
    await ok(
      pedir("PUT", `/checkout/${token}/delivery`, {
        pais: "PT",
        codigo_postal: "1000-001",
        linha1: "Rua 2",
        localidade: "Lisboa",
      }),
    );
    expect(
      (await ok(pedir("GET", `/checkout/${token}`)))["metodo_entrega"],
    ).toBe(null);
  });

  it("a zona do método conta pelo ponto; outro país e outro comerciante não", async () => {
    const norte = String(
      (
        await ok(
          s.adm("POST", "/shipping-methods", {
            mercado: `mkt_${s.mercado}`,
            nome: { pt: "Ponto no Norte" },
            tarifa: 199,
            conta: s.conta,
            servico: "PONTO_48",
            entrega: "ponto",
            codigos_postais: ["4700000"],
          }),
          201,
        )
      )["id"],
    );
    const token = await sessao();
    // P2 (4700-001) fica fora da zona do método: não aparece nem se escolhe.
    const r = await ok(procurar(token, "4700-000", norte));
    expect((r["dados"] as Json[]).map((x) => x["id"])).toEqual(["P1"]);
    expect(await codigo(escolher(token, "P2", norte))).toEqual([
      409,
      "checkout.pickup_point_unavailable",
    ]);
    await ok(escolher(token, "P1", norte));
    expect(
      await codigo(
        pedir(
          "GET",
          `/checkout/${token}/pickup-points?metodo=${metodoPonto}&pais=ES&codigo_postal=28001`,
        ),
      ),
    ).toEqual([422, "checkout.country_not_served"]);
    // O método de outro comerciante não existe nesta sessão.
    const doOutro = String(
      (
        await ok(
          outro.adm("POST", "/shipping-methods", {
            mercado: `mkt_${outro.mercado}`,
            nome: { pt: "Ponto" },
            tarifa: 100,
            conta: outro.conta,
            servico: "PONTO_48",
            entrega: "ponto",
          }),
          201,
        )
      )["id"],
    );
    expect(await codigo(procurar(token, "4700-000", doOutro))).toEqual([
      404,
      "checkout.not_found",
    ]);
  });

  it("no máximo 20 procuras por sessão; a transportadora sem resposta dá 503", async () => {
    const token = await sessao();
    ctt.estado.consultar = "rede";
    expect(await codigo(procurar(token))).toEqual([
      503,
      "checkout.carrier_unavailable",
    ]);
    ctt.estado.consultar = "responde";
    for (let i = 1; i < 20; i += 1) await ok(procurar(token));
    expect(await codigo(procurar(token))).toEqual([
      429,
      "checkout.too_many_searches",
    ]);
    expect(await codigo(escolher(token))).toEqual([
      429,
      "checkout.too_many_searches",
    ]);
  });

  it("o botão final confere o ponto: fechado ou sem resposta não vende; a morada do ponto nunca é a morada fiscal", async () => {
    const comprar = async (token: string) => {
      const resumo = await ok(pedir("GET", `/checkout/${token}/summary`));
      return pedir("POST", `/checkout/${token}/place`, {
        aceita_condicoes: true,
        versoes: (resumo["textos"] as Json[]).map((t) => t["versao"]),
        impressao: resumo["impressao"],
      });
    };
    const token = await sessao();
    await ok(escolher(token, "P1"));
    ctt.estado.pontosFechados.add("P1");
    expect(await codigo(comprar(token))).toEqual([
      409,
      "checkout.pickup_point_unavailable",
    ]);
    ctt.estado.pontosFechados.clear();
    ctt.estado.disponibilidade = "rede";
    expect(await codigo(comprar(token))).toEqual([
      409,
      "checkout.pickup_point_unavailable",
    ]);
    ctt.estado.disponibilidade = "responde";
    const e = await ok(comprar(token), 201);
    const id = String(e["encomenda"]).replace(/^ord_/, "");
    const { rows } = await sql<{
      entrega: Json;
      morada_linha1: string | null;
    }>`select e.entrega, p.morada_linha1 from encomenda e
       join perfil_faturacao p on p.id = e.perfil_id
       where e.id = ${id}::uuid`.execute(base.dono);
    expect(rows[0]?.entrega["ponto"]).toEqual({
      id: "P1",
      nome: "Papelaria P1",
    });
    // Sem morada de faturação, o perfil fica sem morada: nunca a do ponto.
    expect(rows[0]?.morada_linha1).toBeNull();

    // Com NIF, falta a morada de faturação.
    const comNif = await sessao(s, {
      finalidade: "consumo",
      tipo: "particular",
      nome_documento: "Rui",
      nif: "123456789",
    });
    await ok(escolher(comNif, "P1"));
    expect(
      (await ok(pedir("GET", `/checkout/${comNif}/summary`)))["em_falta"],
    ).toEqual(["morada_faturacao"]);
  });

  it("a etiqueta leva o ponto; o serviço não muda para um de morada; «entregue» só conta depois de «para levantar»", async () => {
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(s, metodoPonto, 1, true, "Rui", {
      pais: "PT",
      codigo_postal: "4700-000",
      ponto: "P1",
    });
    const servicos = await ok(
      s.adm("GET", `/shipments/${a.expedicao}/services`),
    );
    // Só os serviços de pontos servem uma encomenda para um ponto (§21).
    expect((servicos["opcoes"] as Json[]).map((x) => x["servico"])).toEqual([
      "PONTO_48",
    ]);
    const e = await ok(s.adm("POST", `/shipments/${a.expedicao}/label`));
    expect(ctt.estado.pedidos.at(-1)).toMatchObject({
      servico: "PONTO_48",
      ponto: "P1",
      destinatario: {
        nome: "Rui",
        linha1: "Rua Central 5",
        codigo_postal: "4700-000",
        localidade: "Braga",
        pais: "PT",
      },
    });
    const seguimento = String(e["seguimento"]);
    ctt.estado.eventos.set(seguimento, [
      {
        idExterno: "r-1",
        estadoTransportadora: "ACEITE",
        estadoNormalizado: "recolhida",
        em: new Date("2026-11-14T09:00:00Z"),
      },
      {
        idExterno: "d-1",
        estadoTransportadora: "ENTREGUE NO PONTO",
        estadoNormalizado: "entregue",
        em: new Date("2026-11-15T09:00:00Z"),
      },
    ]);
    await ok(s.adm("POST", `/shipments/${a.expedicao}/refresh`));
    const id = a.expedicao.replace(/^shp_/, "");
    const estado = async () =>
      (
        await sql<{
          estado: string;
        }>`select estado from expedicao where id = ${id}::uuid`.execute(
          base.dono,
        )
      ).rows[0]?.estado;
    expect(await estado()).toBe("expedida");
    // Uma pessoa confirma: abre-se um problema na encomenda (Q4).
    const problemas = await comComerciante(base.api, s.c, (trx) =>
      trx
        .selectFrom("problema")
        .select("descricao")
        .where("encomenda_id", "=", a.encomenda.replace(/^ord_/, ""))
        .execute(),
    );
    expect(problemas.map((x) => x.descricao).join(" ")).toMatch(
      /ponto de recolha.*sem antes a dar como disponível para levantar/,
    );
    ctt.estado.eventos.set(seguimento, [
      {
        idExterno: "p-1",
        estadoTransportadora: "PARA LEVANTAR",
        estadoNormalizado: "disponivel_para_levantar",
        em: new Date("2026-11-15T10:00:00Z"),
      },
      {
        idExterno: "d-2",
        estadoTransportadora: "LEVANTADO",
        estadoNormalizado: "entregue",
        em: new Date("2026-11-16T09:00:00Z"),
      },
    ]);
    await ok(s.adm("POST", `/shipments/${a.expedicao}/refresh`));
    expect(await estado()).toBe("entregue");
  });

  it("revisão do #439: o ponto não fica num método de morada; o `place` repetido não confere outra vez; outro ponto depois do resumo não vende", async () => {
    // P1-1: escolher um método de morada tira a morada do ponto.
    const token = await sessao();
    await ok(escolher(token, "P1"));
    await ok(
      pedir("PUT", `/checkout/${token}/delivery-method`, {
        metodo: s.metodoManual,
      }),
    );
    expect((await ok(pedir("GET", `/checkout/${token}`)))["entrega"]).toBe(
      null,
    );
    expect(
      (await ok(pedir("GET", `/checkout/${token}/summary`)))["em_falta"],
    ).toEqual(["entrega"]);

    // P1-1: o comerciante muda o método de `ponto` para morada (manual).
    const mudavel = String(
      (
        await ok(
          s.adm("POST", "/shipping-methods", {
            mercado: `mkt_${s.mercado}`,
            nome: { pt: "Ponto que muda" },
            tarifa: 100,
            conta: s.conta,
            servico: "PONTO_48",
            entrega: "ponto",
          }),
          201,
        )
      )["id"],
    );
    const t2 = await sessao();
    await ok(escolher(t2, "P1", mudavel));
    const lido = await ok(
      s.adm("GET", `/shipping-methods?mercado=mkt_${s.mercado}`),
    );
    const versao = (lido["dados"] as Json[]).find((x) => x["id"] === mudavel)?.[
      "versao"
    ];
    await ok(
      s.adm("PATCH", `/shipping-methods/${mudavel}`, {
        versao,
        entrega: "morada",
        conta: null,
        servico: null,
      }),
      204,
    );
    expect(
      (await ok(pedir("GET", `/checkout/${t2}/summary`)))["em_falta"],
    ).toEqual(["entrega"]);

    // P3-2: outro ponto depois do resumo muda a impressão.
    const t3 = await sessao();
    await ok(escolher(t3, "P1"));
    const resumo = await ok(pedir("GET", `/checkout/${t3}/summary`));
    expect(resumo["portes"]).toMatchObject({
      ponto: { id: "P1", nome: "Papelaria P1" },
    });
    await ok(escolher(t3, "P2"));
    const comprar = (impressao: unknown) =>
      pedir("POST", `/checkout/${t3}/place`, {
        aceita_condicoes: true,
        versoes: (resumo["textos"] as Json[]).map((t) => t["versao"]),
        impressao,
      });
    expect(await codigo(comprar(resumo["impressao"]))).toEqual([
      409,
      "checkout.total_changed",
    ]);
    // O `place` repetido numa sessão concluída devolve a mesma encomenda,
    // sem perguntar outra vez pelo ponto.
    const novo = await ok(pedir("GET", `/checkout/${t3}/summary`));
    const e = await ok(comprar(novo["impressao"]), 201);
    ctt.estado.pontosFechados.add("P2");
    const outraVez = await ok(comprar(novo["impressao"]), 201);
    ctt.estado.pontosFechados.clear();
    expect(outraVez["encomenda"]).toBe(e["encomenda"]);
  });

  it("revisão do #439, P2-1: numa expedição para um ponto, o serviço de ponto de outra conta não serve", async () => {
    const outra = String(
      (
        await ok(
          s.adm("POST", "/carrier-accounts", {
            transportadora: "ctt",
            nome: "CTT 2",
            remetente: {
              nome: "Armazém",
              linha1: "Rua 1",
              codigo_postal: "1000-001",
              localidade: "Lisboa",
              pais: "PT",
            },
          }),
          201,
        )
      )["id"],
    );
    await ok(
      s.adm("PUT", `/carrier-accounts/${outra}/credentials`, {
        credenciais: { chave: CHAVE_BOA },
      }),
      204,
    );
    await ok(s.adm("POST", `/carrier-accounts/${outra}/test`));
    const a = await expedicaoPaga(s, metodoPonto, 1, true, "Rui", {
      pais: "PT",
      codigo_postal: "4700-000",
      ponto: "P1",
    });
    const servicos = await ok(
      s.adm("GET", `/shipments/${a.expedicao}/services`),
    );
    expect(
      (servicos["opcoes"] as Json[]).map((x) => [x["conta"], x["servico"]]),
    ).toEqual([[s.conta, "PONTO_48"]]);
    expect(
      await codigo(
        s.adm("PUT", `/shipments/${a.expedicao}/service`, {
          versao: servicos["versao"],
          conta: outra,
          servico: "PONTO_48",
          motivo: "outra conta",
        }),
      ),
    ).toEqual([400, "shipping.invalid_field"]);
  });
});
