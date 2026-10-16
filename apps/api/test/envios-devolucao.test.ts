import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarChave } from "../src/identidade/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { cenariosDeEnvios, type Cenario } from "./envios-cenario.js";
import { eupagoFalso } from "./eupago-falso.js";
import { hubDeTeste } from "./hub-de-teste.js";
import { transportadoraFalsa } from "./transportadora-falsa.js";

// A etiqueta de devolução pela transportadora (docs/36 §22; migração 0093):
// numa devolução à espera, com a conta e um serviço de morada; vai o nome e
// a morada de entrega do cliente, nunca o telefone, o e-mail, os preços nem
// o motivo dele; uma viva por devolução; a resposta perdida fica incerta e
// só uma pessoa a anula; o ficheiro apaga-se 30 dias depois de acabar.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)(
  "Envios: a etiqueta de devolução",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;
    const eupago = eupagoFalso();
    const ctt = transportadoraFalsa();
    let s: Cenario;
    let outro: Cenario;

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
    }, 180_000);

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    const apoio = cenariosDeEnvios(
      () => h.app,
      () => base,
    );
    const { ok, codigo, expedicaoPaga } = apoio;

    /** Uma devolução à espera de uma encomenda já expedida. */
    async function devolucao(c: Cenario = s) {
      ctt.estado.pedir = "emitir";
      const a = await expedicaoPaga(c, c.metodoCtt, 1);
      const e = await ok(c.adm("POST", `/shipments/${a.expedicao}/label`));
      ctt.estado.eventos.set(String(e["seguimento"]), [
        {
          idExterno: "r-1",
          estadoTransportadora: "ACEITE",
          estadoNormalizado: "recolhida",
          em: new Date("2026-11-14T09:00:00Z"),
        },
      ]);
      await ok(c.adm("POST", `/shipments/${a.expedicao}/refresh`));
      const v = await ok(c.adm("GET", `/fulfilment/orders/${a.encomenda}`));
      const linha = (v["linhas"] as Json[])[0] as Json;
      const r = await ok(
        c.adm("POST", "/returns", {
          encomenda: a.encomenda,
          origem: "apoio",
          motivo: "O Rui diz que a cor não é a da fotografia",
          linhas: [{ linha: linha["id"], quantidade: 1 }],
        }),
        201,
      );
      return String(r["id"]);
    }

    /** Muda a hora da etiqueta para `minutos` atrás (o dono, com o comerciante posto). */
    const envelhecer = async (rma: string, minutos: number, c: Cenario = s) => {
      await base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${c.c}, true)`.execute(
          trx,
        );
        await sql`update etiqueta_devolucao
          set em = now() - make_interval(mins => ${minutos})
          where devolucao_id = ${rma.replace(/^rma_/, "")}::uuid`.execute(trx);
      });
    };
    const historico = async (rma: string, c: Cenario = s) =>
      base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${c.c}, true)`.execute(
          trx,
        );
        return (
          await sql<{
            tentativa: number;
            estado: string;
            seguimento: string | null;
            quem: string | null;
          }>`select tentativa, estado, seguimento, quem from etiqueta_devolucao_historico
            where devolucao_id = ${rma.replace(/^rma_/, "")}::uuid
            order by em, id`.execute(trx)
        ).rows;
      });

    const pedir = (rma: string, servico = "EXPRESSO_48", c: Cenario = s) =>
      c.adm("POST", `/returns/${rma}/label`, {
        conta: c.conta,
        servico,
      });

    it("emite a etiqueta: só o nome e a morada de entrega do cliente, para a morada de recolha da conta; a devolução fica com o seguimento; uma viva", async () => {
      const rma = await devolucao();
      const e = await ok(pedir(rma));
      expect(e).toMatchObject({
        devolucao: rma,
        estado: "emitida",
        tentativa: 1,
        conta: s.conta,
        servico: "EXPRESSO_48",
        ficheiro: "pdf",
      });
      const pedido = ctt.estado.pedidosDevolucao.at(-1);
      expect(pedido?.remetente).toEqual({
        nome: "Rui",
        linha1: "Rua 2",
        codigo_postal: "1000-001",
        localidade: "Lisboa",
        pais: "PT",
      });
      expect(pedido?.destinatario).toMatchObject({
        nome: "Armazém",
        linha1: "Rua 1",
        codigo_postal: "1000-001",
      });
      expect(pedido?.referencia).toBe(`${rma}-1`);
      // O motivo do cliente, o telefone, o e-mail e os preços não vão.
      expect(JSON.stringify(pedido)).not.toMatch(
        /fotografia|912345678|exemplo\.pt|1230/,
      );
      const d = await ok(s.adm("GET", `/returns/${rma}`));
      expect(d).toMatchObject({
        transportadora: "ctt",
        seguimento: e["seguimento"],
      });
      const f = await s.adm("GET", `/returns/${rma}/label/file`);
      expect(f.statusCode).toBe(200);
      expect(f.headers["content-type"]).toBe("application/pdf");
      expect(await codigo(pedir(rma))).toEqual([409, "shipping.label_exists"]);
      // A etiqueta também fica no rasto da devolução (docs/30 §16).
      const rasto = (await ok(s.adm("GET", `/returns/${rma}/timeline`)))[
        "dados"
      ] as Record<string, unknown>[];
      expect(
        rasto
          .filter((t) => t["entidade"] === "return_label")
          .map((t) => [t["de"], t["para"]]),
      ).toEqual([
        [null, "a_pedir"],
        ["a_pedir", "emitida"],
      ]);
    });

    it("sem quem, a etiqueta de devolução não muda de estado (rasto da pós-venda, 0110)", async () => {
      const rma = await devolucao();
      await ok(pedir(rma));
      await expect(
        base.dono.transaction().execute(async (trx) => {
          await sql`select set_config('eurolify.comerciante', ${s.c}, true),
            set_config('eurolify.quem', '', true)`.execute(trx);
          await sql`update etiqueta_devolucao set estado = 'anulada'
            where devolucao_id = ${rma.replace(/^rma_/, "")}::uuid`.execute(
            trx,
          );
        }),
      ).rejects.toThrow(/returns\.change_without_who/);
    });

    it("serviços que não servem a volta: de pontos, de outro país, ou que pedem o telefone", async () => {
      const rma = await devolucao();
      for (const servico of ["PONTO_48", "SO_ESPANHA", "COM_TELEFONE"]) {
        expect(await codigo(pedir(rma, servico)), servico).toEqual([
          400,
          "shipping.invalid_field",
        ]);
      }
      expect(await codigo(pedir(rma, "NAO_EXISTE"))).toEqual([
        422,
        "shipping.service_unknown",
      ]);
    });

    it("sem resposta fica incerta e não se pede outra; a pessoa anula-a e pede outra; uma recusa deixa pedir outra", async () => {
      const rma = await devolucao();
      ctt.estado.pedirDevolucao = "rede";
      expect(await ok(pedir(rma))).toMatchObject({ estado: "incerta" });
      ctt.estado.pedirDevolucao = "emitir";
      const antes = ctt.estado.pedidosDevolucao.length;
      expect(await codigo(pedir(rma))).toEqual([
        409,
        "shipping.label_uncertain",
      ]);
      expect(ctt.estado.pedidosDevolucao.length).toBe(antes);
      const anular = () =>
        s.adm("POST", `/returns/${rma}/label/void`, {
          motivo: "não existe no painel da transportadora",
          anulada_no_painel: true,
        });
      // Sem a confirmação do painel, ou com um motivo curto, recusa-se.
      expect(
        await codigo(
          s.adm("POST", `/returns/${rma}/label/void`, {
            motivo: "não existe no painel",
          }),
        ),
      ).toEqual([400, "request.invalid"]);
      // Uma incerta acabada de ficar incerta ainda não se anula (#447, P2).
      expect(await codigo(anular())).toEqual([
        409,
        "shipping.void_not_allowed",
      ]);
      await envelhecer(rma, 16);
      expect(await ok(anular())).toMatchObject({ estado: "anulada" });
      ctt.estado.pedirDevolucao = "recusar";
      expect(await ok(pedir(rma))).toMatchObject({
        estado: "recusada",
        tentativa: 2,
        motivo: "serviço sem devoluções",
      });
      ctt.estado.pedirDevolucao = "emitir";
      expect(await ok(pedir(rma))).toMatchObject({
        estado: "emitida",
        tentativa: 3,
      });
      expect(ctt.estado.pedidosDevolucao.at(-1)?.referencia).toBe(`${rma}-3`);
    });

    it("só numa devolução à espera; o ficheiro apaga-se 30 dias depois de a devolução acabar; outro comerciante não a vê", async () => {
      const rma = await devolucao();
      await ok(pedir(rma));
      const d = await ok(s.adm("GET", `/returns/${rma}`));
      await ok(
        s.adm("POST", `/returns/${rma}/cancel`, {
          versao: d["versao"],
          motivo: "o cliente desistiu",
        }),
      );
      expect(await codigo(pedir(rma))).toEqual([400, "shipping.invalid_field"]);
      const id = rma.replace(/^rma_/, "");
      const apagar = async () =>
        (
          await sql<{
            n: number;
          }>`select envios_devolucao_ficheiros_apagar() as n`.execute(base.api)
        ).rows[0]?.n;
      expect(await apagar()).toBe(0);
      await sql`update etiqueta_devolucao_prazo set apagar_em = now() - interval '1 day'
        where devolucao_id = ${id}::uuid`.execute(base.dono);
      expect(await apagar()).toBe(1);
      expect(await codigo(s.adm("GET", `/returns/${rma}/label/file`))).toEqual([
        404,
        "shipping.not_found",
      ]);
      // Isolamento: a devolução de um comerciante não existe para o outro.
      expect(await codigo(outro.adm("GET", `/returns/${rma}/label`))).toEqual([
        404,
        "shipping.not_found",
      ]);
      expect(await codigo(pedir(rma, "EXPRESSO_48", outro))).toEqual([
        404,
        "shipping.not_found",
      ]);
      // Numa devolução que já não está à espera, não se pede.
      const outra = await devolucao();
      await ok(
        s.adm("POST", `/returns/${outra}/cancel`, {
          versao: (await ok(s.adm("GET", `/returns/${outra}`)))["versao"],
          motivo: "o cliente desistiu",
        }),
      );
      expect(await codigo(pedir(outra))).toEqual([
        400,
        "shipping.invalid_field",
      ]);
    });

    it("revisão do #447: um erro qualquer depois de pedir fica incerto (nunca duas pagas); o pedido a meio passa a incerto; o histórico guarda cada etiqueta; returns:read só lê", async () => {
      const rma = await devolucao();
      await ok(pedir(rma));
      const primeira = await ok(s.adm("GET", `/returns/${rma}/label`));
      await envelhecer(rma, 1);
      await ok(
        s.adm("POST", `/returns/${rma}/label/void`, {
          motivo: "anulada no painel da transportadora",
          anulada_no_painel: true,
        }),
      );
      // A devolução deixa de mostrar o seguimento anulado.
      expect(await ok(s.adm("GET", `/returns/${rma}`))).toMatchObject({
        seguimento: null,
      });
      ctt.estado.pedirDevolucao = "erro";
      expect(await ok(pedir(rma))).toMatchObject({
        estado: "incerta",
        tentativa: 2,
      });
      ctt.estado.pedirDevolucao = "emitir";
      expect(await codigo(pedir(rma))).toEqual([
        409,
        "shipping.label_uncertain",
      ]);
      // O histórico: a primeira, paga, com o seguimento, e quem a anulou.
      const h = await historico(rma);
      expect(h.map((x) => [x.tentativa, x.estado])).toEqual([
        [1, "a_pedir"],
        [1, "emitida"],
        [1, "anulada"],
        [2, "a_pedir"],
        [2, "incerta"],
      ]);
      expect(h[1]?.seguimento).toBe(primeira["seguimento"]);
      expect(h.every((x) => x.quem !== null)).toBe(true);

      // Um pedido que ficou a meio (a API reiniciou) passa a incerto e fica.
      const outra = await devolucao();
      ctt.estado.pedirDevolucao = "emitir";
      await ok(pedir(outra));
      await envelhecer(outra, 1);
      await ok(
        s.adm("POST", `/returns/${outra}/label/void`, {
          motivo: "anulada no painel da transportadora",
          anulada_no_painel: true,
        }),
      );
      await base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${s.c}, true),
          set_config('eurolify.quem', 'pessoa:teste', true)`.execute(trx);
        await sql`update etiqueta_devolucao set estado = 'a_pedir', tentativa = 2,
            seguimento = null, url_seguimento = null
          where devolucao_id = ${outra.replace(/^rma_/, "")}::uuid`.execute(
          trx,
        );
      });
      await envelhecer(outra, 10);
      expect(await codigo(pedir(outra))).toEqual([
        409,
        "shipping.label_uncertain",
      ]);
      expect(await ok(s.adm("GET", `/returns/${outra}/label`))).toMatchObject({
        estado: "incerta",
      });

      // Uma chave só com returns:read lê, mas não pede nem anula.
      const leitor = (
        await criarChave(base.dono, s.c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "Só ler devoluções",
          ambitos: ["returns:read"],
        })
      ).segredo;
      const comLeitor = (m: "GET" | "POST", url: string, corpo?: unknown) =>
        apoio.pedir(m, url, corpo, { authorization: `Bearer ${leitor}` });
      expect(
        (await comLeitor("GET", `/returns/${outra}/label`)).statusCode,
      ).toBe(200);
      expect(
        (
          await comLeitor("POST", `/returns/${outra}/label`, {
            conta: s.conta,
            servico: "EXPRESSO_48",
          })
        ).statusCode,
      ).toBe(403);
    });
  },
);
