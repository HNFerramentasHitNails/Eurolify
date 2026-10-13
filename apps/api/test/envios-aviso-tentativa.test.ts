import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comComerciante } from "../src/comerciante/repositorio.js";
import { CorreioDeEnsaio } from "../src/notificacoes/correio.js";
import { mensagemDe } from "../src/notificacoes/modelos.js";
import { correrNotificacoes } from "../src/notificacoes/repositorio.js";
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

// O aviso a quem expede quando a transportadora diz «tentativa falhada» ou
// «disponível para levantar» (docs/36 §20; migração 0087): o dono, o gestor
// e o armazém, uma vez por expedição e por estado; nunca o nome, a morada
// nem o texto da transportadora; cancelado se a expedição já acabou.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("Envios: o aviso da tentativa", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  const eupago = eupagoFalso();
  const ctt = transportadoraFalsa();
  let s: Cenario;
  let outro: Cenario;
  const email: Record<string, string> = {};

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
    for (const papel of ["dono", "gestor", "armazem", "apoio"]) {
      const x = await h.pessoaCom(s.c, papel);
      email[papel] =
        (
          await sql<{
            email: string;
          }>`select email from pessoa where id = ${x.pessoa.replace(/^per_/, "")}::uuid`.execute(
            base.dono,
          )
        ).rows[0]?.email ?? "";
    }
    await h.pessoaCom(outro.c, "dono");
  }, 180_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  const apoio = cenariosDeEnvios(
    () => h.app,
    () => base,
  );
  const { ok, expedicaoPaga } = apoio;

  /** Uma expedição com a etiqueta emitida e os eventos dados, consultados. */
  async function comEventos(
    eventos: {
      id: string;
      estado:
        | "recolhida"
        | "em_transito"
        | "tentativa_falhada"
        | "disponivel_para_levantar"
        | "entregue";
    }[],
    c: Cenario = s,
  ) {
    ctt.estado.pedir = "emitir";
    const a = await expedicaoPaga(c, c.metodoCtt, 1);
    const e = await ok(c.adm("POST", `/shipments/${a.expedicao}/label`));
    ctt.estado.eventos.set(
      String(e["seguimento"]),
      eventos.map((x, i) => ({
        idExterno: x.id,
        estadoTransportadora: "Rui Exemplo, Rua do Exemplo 2: AUSENTE",
        estadoNormalizado: x.estado,
        em: new Date(Date.UTC(2026, 10, 14, 11, 20 + i)),
      })),
    );
    await ok(c.adm("POST", `/shipments/${a.expedicao}/refresh`));
    return { ...a, seguimento: String(e["seguimento"]) };
  }

  const avisosDe = async (expedicao: string) =>
    (
      await sql<{
        pessoa_id: string;
        estado: string;
        ultimo_erro: string | null;
        dados: Json;
      }>`select pessoa_id::text, estado, ultimo_erro, dados from notificacao
         where tipo = 'shipment.needs_attention'
           and dados->>'expedicao' = ${expedicao.replace(/^shp_/, "")}`.execute(
        base.dono,
      )
    ).rows;

  it("uma tentativa falhada avisa o dono, o gestor e o armazém, e não o apoio; o e-mail não tem dados do cliente", async () => {
    const a = await comEventos([{ id: "t-1", estado: "tentativa_falhada" }]);
    const avisos = await avisosDe(a.expedicao);
    expect(avisos).toHaveLength(3);
    const correio = new CorreioDeEnsaio();
    await correrNotificacoes(base.api, correio);
    const deste = correio.enviados.filter((m) => m.texto.includes(a.expedicao));
    expect(deste.map((m) => m.para).sort()).toEqual(
      [email["dono"], email["gestor"], email["armazem"]].sort(),
    );
    expect(deste.map((m) => m.para)).not.toContain(email["apoio"]);
    for (const m of deste) {
      expect(m.assunto).toContain("não conseguiu entregar");
      expect(m.texto).toContain(a.seguimento);
      expect(m.texto).toMatch(/14\/11\/2026 11:20/);
      expect(m.texto).toContain("transportadora (CTT)");
      for (const proibido of ["Rui", "Exemplo", "AUSENTE"]) {
        expect(m.texto).not.toContain(proibido);
        expect(m.assunto).not.toContain(proibido);
      }
    }
    // Na fila só ficam estas chaves: nunca o texto da transportadora (traz
    // aqui o nome e a morada de quem recebe), que ficaria 90 dias.
    for (const x of avisos) {
      expect(Object.keys(x.dados).sort()).toEqual(
        [
          "em",
          "estado",
          "expedicao",
          "fuso",
          "loja",
          "seguimento",
          "transportadora",
        ].sort(),
      );
      expect(JSON.stringify(x.dados)).not.toMatch(/Rui|Exemplo|AUSENTE/);
    }
  });

  it("uma segunda tentativa falhada não avisa outra vez; um «para levantar» sim", async () => {
    const a = await comEventos([
      { id: "t-1", estado: "tentativa_falhada" },
      { id: "t-2", estado: "tentativa_falhada" },
    ]);
    expect(await avisosDe(a.expedicao)).toHaveLength(3);
    ctt.estado.eventos.set(a.seguimento, [
      {
        idExterno: "t-3",
        estadoTransportadora: "PONTO DE RECOLHA",
        estadoNormalizado: "disponivel_para_levantar",
        em: new Date("2026-11-15T09:00:00Z"),
      },
    ]);
    await ok(s.adm("POST", `/shipments/${a.expedicao}/refresh`));
    const avisos = await avisosDe(a.expedicao);
    expect(avisos).toHaveLength(6);
    expect(
      avisos.filter((x) => x.dados["estado"] === "disponivel_para_levantar"),
    ).toHaveLength(3);
  });

  it("numa expedição já entregue não avisa; entregue antes do envio, o aviso cancela-se", async () => {
    const a = await comEventos([
      { id: "r-1", estado: "recolhida" },
      { id: "e-1", estado: "entregue" },
      { id: "t-1", estado: "tentativa_falhada" },
    ]);
    // A tentativa vem no mesmo lote que a entrega: o evento grava-se antes
    // de a expedição mudar, por isso o aviso entra na fila; no envio, a
    // expedição já está entregue e o aviso cancela-se sem e-mail.
    const correio = new CorreioDeEnsaio();
    await correrNotificacoes(base.api, correio);
    expect((await avisosDe(a.expedicao)).map((x) => x.estado)).toEqual([
      "cancelada",
      "cancelada",
      "cancelada",
    ]);
    expect(
      correio.enviados.filter((m) => m.texto.includes(a.expedicao)),
    ).toEqual([]);

    // Um evento que chega depois, com a expedição já entregue, não avisa.
    ctt.estado.eventos.set(a.seguimento, [
      {
        idExterno: "l-9",
        estadoTransportadora: "PONTO DE RECOLHA",
        estadoNormalizado: "disponivel_para_levantar",
        em: new Date("2026-11-20T09:00:00Z"),
      },
    ]);
    await ok(s.adm("POST", `/shipments/${a.expedicao}/refresh`));
    expect(await avisosDe(a.expedicao)).toHaveLength(3);

    const b = await comEventos([
      { id: "r-1", estado: "recolhida" },
      { id: "t-1", estado: "tentativa_falhada" },
    ]);
    expect(await avisosDe(b.expedicao)).toHaveLength(3);
    ctt.estado.eventos.set(b.seguimento, [
      {
        idExterno: "e-2",
        estadoTransportadora: "ENTREGUE",
        estadoNormalizado: "entregue",
        em: new Date("2026-11-16T09:00:00Z"),
      },
    ]);
    await ok(s.adm("POST", `/shipments/${b.expedicao}/refresh`));
    await correrNotificacoes(base.api, new CorreioDeEnsaio());
    const depois = await avisosDe(b.expedicao);
    expect(depois.map((x) => x.estado)).toEqual([
      "cancelada",
      "cancelada",
      "cancelada",
    ]);
  });

  it("a encomenda que volta a andar depois da tentativa: o aviso cancela-se no envio e um evento atrasado não avisa", async () => {
    // No mesmo lote: a tentativa grava-se antes de «em trânsito», o aviso
    // entra na fila e cancela-se no envio (revisão do #434, P2-1).
    const a = await comEventos([
      { id: "r-1", estado: "recolhida" },
      { id: "t-1", estado: "tentativa_falhada" },
      { id: "m-1", estado: "em_transito" },
    ]);
    const correio = new CorreioDeEnsaio();
    await correrNotificacoes(base.api, correio);
    expect(
      (await avisosDe(a.expedicao)).map((x) => [x.estado, x.ultimo_erro]),
    ).toEqual([
      ["cancelada", "encomenda_voltou_a_andar"],
      ["cancelada", "encomenda_voltou_a_andar"],
      ["cancelada", "encomenda_voltou_a_andar"],
    ]);
    expect(
      correio.enviados.filter((m) => m.texto.includes(a.expedicao)),
    ).toEqual([]);
    // Um «para levantar» mais antigo do que o «em trânsito», que chega
    // depois, não entra na fila.
    ctt.estado.eventos.set(a.seguimento, [
      {
        idExterno: "l-0",
        estadoTransportadora: "PONTO DE RECOLHA",
        estadoNormalizado: "disponivel_para_levantar",
        em: new Date(Date.UTC(2026, 10, 14, 11, 21)),
      },
    ]);
    await ok(s.adm("POST", `/shipments/${a.expedicao}/refresh`));
    expect(await avisosDe(a.expedicao)).toHaveLength(3);
  });

  it("perdida, devolvida ou cancelada antes do envio: o aviso cancela-se; depois, um evento novo não avisa", async () => {
    for (const estado of ["perdida", "devolvida_ao_remetente", "cancelada"]) {
      const a = await comEventos([{ id: "t-1", estado: "tentativa_falhada" }]);
      expect(await avisosDe(a.expedicao)).toHaveLength(3);
      const id = a.expedicao.replace(/^shp_/, "");
      // Pelas transições da expedição (0079): perdida e devolvida só depois
      // de expedida; cancelada antes, e com a etiqueta anulada.
      if (estado === "cancelada") {
        await ok(s.adm("POST", `/shipments/${a.expedicao}/label/void`));
      }
      await comComerciante(base.api, s.c, async (trx) => {
        if (estado !== "cancelada") {
          await sql`update expedicao set estado = 'expedida'
            where id = ${id}::uuid and estado = 'criada'`.execute(trx);
        }
        await sql`update expedicao set estado = ${estado}
          where id = ${id}::uuid`.execute(trx);
      });
      await correrNotificacoes(base.api, new CorreioDeEnsaio());
      expect(
        (await avisosDe(a.expedicao)).map((x) => [x.estado, x.ultimo_erro]),
        estado,
      ).toEqual([
        ["cancelada", "expedicao_ja_acabou"],
        ["cancelada", "expedicao_ja_acabou"],
        ["cancelada", "expedicao_ja_acabou"],
      ]);
      await comComerciante(base.api, s.c, (trx) =>
        sql`insert into evento_seguimento (comerciante_id, expedicao_id, origem,
            id_externo, estado_transportadora, estado_normalizado, em)
          select comerciante_id, id, 'consulta', 'l-1', 'PONTO DE RECOLHA',
            'disponivel_para_levantar', now()
          from expedicao where id = ${id}::uuid`.execute(trx),
      );
      expect(await avisosDe(a.expedicao), estado).toHaveLength(3);
    }
  });

  it("quem saiu, a pessoa desactivada e quem passa a apoio: sem e-mail no envio e sem aviso novo", async () => {
    const t = await apoio.cenario();
    const p: Record<string, string> = {};
    for (const [nome, papel] of [
      ["fica", "dono"],
      ["sai", "armazem"],
      ["desactivada", "gestor"],
      ["muda", "armazem"],
    ] as const) {
      p[nome] = (await h.pessoaCom(t.c, papel)).pessoa;
    }
    const a = await comEventos([{ id: "t-1", estado: "tentativa_falhada" }], t);
    expect(await avisosDe(a.expedicao)).toHaveLength(4);
    await sql`update membro set ate = now(), terminado_por = 'teste'
      where comerciante_id = ${t.c}::uuid and pessoa_id = ${p["sai"] ?? ""}::uuid`.execute(
      base.dono,
    );
    await sql`update pessoa set estado = 'desactivada'
      where id = ${p["desactivada"] ?? ""}::uuid`.execute(base.dono);
    await sql`update membro set papel = 'apoio'
      where comerciante_id = ${t.c}::uuid and pessoa_id = ${p["muda"] ?? ""}::uuid`.execute(
      base.dono,
    );
    const correio = new CorreioDeEnsaio();
    await correrNotificacoes(base.api, correio);
    const nome = (id: string) =>
      Object.entries(p).find(([, v]) => v === id)?.[0] ?? id;
    expect(
      (await avisosDe(a.expedicao))
        .map((x) => `${nome(x.pessoa_id)}:${x.estado}:${x.ultimo_erro ?? ""}`)
        .sort(),
    ).toEqual([
      "desactivada:cancelada:destinatario_inactivo",
      "fica:enviada:",
      "muda:cancelada:destinatario_inactivo",
      "sai:cancelada:destinatario_inactivo",
    ]);
    expect(
      correio.enviados.filter((m) => m.texto.includes(a.expedicao)),
    ).toHaveLength(1);
    // Um «para levantar» depois: só quem ainda expede entra na fila.
    ctt.estado.eventos.set(a.seguimento, [
      {
        idExterno: "l-1",
        estadoTransportadora: "PONTO DE RECOLHA",
        estadoNormalizado: "disponivel_para_levantar",
        em: new Date("2026-11-15T09:00:00Z"),
      },
    ]);
    await ok(t.adm("POST", `/shipments/${a.expedicao}/refresh`));
    expect(
      (await avisosDe(a.expedicao))
        .filter((x) => x.dados["estado"] === "disponivel_para_levantar")
        .map((x) => nome(x.pessoa_id)),
    ).toEqual(["fica"]);
  });

  it("isolamento: outro comerciante não vê estas notificações; o texto em espanhol e em inglês", async () => {
    await comEventos([{ id: "t-1", estado: "tentativa_falhada" }]);
    const doOutro = await comComerciante(base.api, outro.c, (trx) =>
      trx
        .selectFrom("notificacao")
        .select("id")
        .where("tipo", "=", "shipment.needs_attention")
        .execute(),
    );
    expect(doOutro).toEqual([]);
    const dados = {
      loja: "Tienda",
      expedicao: "0199e000-0000-7000-8000-000000000002",
      estado: "disponivel_para_levantar",
      transportadora: "ctt",
      seguimento: "RR123PT",
      em: "2026-11-14 11:20",
      fuso: "Europe/Madrid",
    };
    const es = mensagemDe("shipment.needs_attention", "es", dados, {
      email: "x@exemplo.pt",
    });
    expect(es.assunto).toContain("esperando a ser recogido");
    expect(es.texto).toContain("14/11/2026 11:20");
    const en = mensagemDe("shipment.needs_attention", "en", dados, {
      email: "x@exemplo.pt",
    });
    expect(en.texto).toContain("2026-11-14 11:20");
    expect(() =>
      mensagemDe(
        "shipment.needs_attention",
        "pt",
        { ...dados, estado: "outro" },
        { email: "x@exemplo.pt" },
      ),
    ).toThrow();
  });
});
