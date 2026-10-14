import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  correrAvisosDoTitular,
  QUEM_DA_TAREFA,
} from "../src/clientes/aviso-prazo.js";
import {
  comComerciante,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import { CorreioDeEnsaio } from "../src/notificacoes/correio.js";
import { mensagemDe } from "../src/notificacoes/modelos.js";
import { correrNotificacoes } from "../src/notificacoes/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// O aviso quando o prazo legal de um pedido do titular passa com o pedido
// aberto (docs/23 §15.15, A1–A4; migração 0096; RGPD, art. 12.º, n.º 3). Ex.:
// a Ana pediu o apagamento há 40 dias; o prazo legal passou há 10; a tarefa
// marca o pedido e os donos recebem um e-mail, uma vez.

type Json = Record<string, unknown>;

/** AAAA-MM-DD mais `n` dias. */
const maisDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
const haDias = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString();

const NOME = "Ana Aviso Exemplo";
const EMAIL = "ana.aviso@exemplo.pt";
const NIF = "263631656";

describe.skipIf(URL_BASE === undefined)(
  "o aviso quando o prazo legal de um pedido do titular passa",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;
    let a = "";
    let chave = "";
    const p: Record<string, string> = {};

    const pedir = (
      metodo: "POST" | "GET",
      url: string,
      corpo?: unknown,
      segredo = chave,
    ) =>
      h.app.inject({
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
    /** Uma ficha com o nome, o e-mail e o NIF (que nunca vão no aviso). */
    const ficha = async (segredo = chave) => {
      const id = String(
        (
          await ok(
            pedir(
              "POST",
              "/customers",
              { nome: NOME, emails: [EMAIL] },
              segredo,
            ),
            201,
          )
        )["id"],
      );
      await ok(
        pedir(
          "POST",
          `/customers/${id}/billing-profiles`,
          {
            tipo: "empresa",
            nome_documento: "Ana Aviso, Lda",
            nif: `PT${NIF}`,
          },
          segredo,
        ),
        201,
      );
      return id;
    };
    /** Um pedido recebido há `dias` dias; devolve o `prq_…` e as datas. */
    const recebido = async (
      cliente: string,
      dias: number,
      tipo = "apagamento",
      segredo = chave,
    ) => {
      const r = await ok(
        pedir(
          "POST",
          `/customers/${cliente}/privacy-requests/received`,
          { tipo, canal: "email", recebido_em: haDias(dias) },
          segredo,
        ),
        201,
      );
      const prq = String(r["id"]);
      const { rows } = await sql<{ dia: string; limite: string }>`
        select to_char(recebido_dia, 'YYYY-MM-DD') as dia,
          to_char((recebido_dia + interval '2 months')::date, 'YYYY-MM-DD') as limite
        from pedido_titular_recebido where id = ${prq.slice(4)}::uuid`.execute(
        base.dono,
      );
      return {
        prq,
        id: prq.slice(4),
        prazo: String(r["prazo_legal"]),
        dia: rows[0]?.dia ?? "",
        limite: rows[0]?.limite ?? "",
      };
    };
    const prorrogar = (
      prq: string,
      ate: string,
      informado: string,
      segredo = chave,
    ) =>
      ok(
        pedir(
          "POST",
          `/privacy-requests/received/${prq}/extend`,
          {
            prorrogado_ate: ate,
            motivo: "complexidade",
            titular_informado_em: informado,
          },
          segredo,
        ),
      );
    /** O dia de hoje no fuso do comerciante, lido na base (a régua da A1). */
    const hojeDe = (c: string) =>
      sql<{
        d: string;
      }>`select to_char(clientes_hoje(${c}::uuid), 'YYYY-MM-DD') as d`
        .execute(base.dono)
        .then((r) => r.rows[0]?.d ?? "");
    const fechar = async (prq: string) =>
      ok(
        pedir("POST", `/privacy-requests/received/${prq}/close`, {
          fim: "respondido",
          em: await hojeDe(a),
        }),
      );
    /** Uma chave com os âmbitos dos clientes, no comerciante `c`. */
    const chaveDe = async (c: string) =>
      (
        await criarChave(base.dono, c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "Dono",
          ambitos: [
            "customers:read",
            "customers:write",
            "customers:billing",
            "customers:privacy",
          ] as never,
        })
      ).segredo;
    const avisos = (pedido: string) =>
      sql<{
        pessoa_id: string;
        estado: string;
        ultimo_erro: string | null;
        dados: Json;
      }>`
        select pessoa_id, estado, ultimo_erro, dados from notificacao
        where tipo = 'privacy.deadline_passed' and referencia = ${pedido}::uuid
        order by pessoa_id`
        .execute(base.dono)
        .then((r) => r.rows);
    const avisoPrazoEm = (pedido: string) =>
      sql<{ em: Date | null }>`
        select aviso_prazo_em as em from pedido_titular_recebido
        where id = ${pedido}::uuid`
        .execute(base.dono)
        .then((r) => r.rows[0]?.em ?? null);
    /**
     * O dono das tabelas no comerciante A (com o contexto, como a API: sem ele
     * o gatilho da notificação nem chegava a escrever).
     */
    const noComerciante = <T>(fn: (t: Kysely<unknown>) => Promise<T>) =>
      base.dono.transaction().execute(async (t) => {
        await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
          t,
        );
        return fn(t);
      });
    const donos = () => [p["dono"], p["dono2"]].sort();
    const erroDe = (x: Promise<unknown>) =>
      x.then(
        () => "passou",
        (e: unknown) => (e as Error).message,
      );

    /**
     * A contagem da verificação diária da VPS, como ela a chama: com o papel
     * da limpeza, sem comerciante posto; o contexto de quem chama volta.
     */
    const contarComoLimpeza = () =>
      base.dono.transaction().execute(async (trx) => {
        await sql`set local role eurolify_limpeza`.execute(trx);
        const marca = randomUUID();
        await sql`select set_config('eurolify.comerciante', ${marca}, true)`.execute(
          trx,
        );
        const { rows } = await sql<{
          n: string;
        }>`select clientes_pedidos_sem_aviso_em_atraso() as n`.execute(trx);
        const { rows: depois } = await sql<{
          c: string;
        }>`select current_setting('eurolify.comerciante', true) as c`.execute(
          trx,
        );
        expect(depois[0]?.c).toBe(marca);
        return Number(rows[0]?.n);
      });

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      h = hubDeTeste(base);
      a = await registarComerciante(base.api, {
        nome: "Loja A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      for (const papel of ["dono", "gestor", "apoio"]) {
        p[papel] = (await h.pessoaCom(a, papel)).pessoa;
      }
      p["dono2"] = (await h.pessoaCom(a, "dono")).pessoa;
      chave = await chaveDe(a);
    }, 120_000);

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    it("o prazo passado dá uma notificação por dono, uma vez; o gestor e o apoio não recebem; sem nome, e-mail nem NIF; a contagem diária conta-o até a tarefa correr (A1–A4)", async () => {
      const f = await ficha();
      const r = await recebido(f, 40);
      expect(r.prazo < (await hojeDe(a))).toBe(true);
      // O prazo passou há mais de um dia e a tarefa não correu: conta.
      expect(await contarComoLimpeza()).toBe(1);
      expect(await avisos(r.id)).toEqual([]);

      const v1 = await correrAvisosDoTitular(base.api);
      expect(v1).toEqual({ avisados: 1, erros: [] });
      const n = await avisos(r.id);
      expect(n.map((x) => x.pessoa_id)).toEqual(donos());
      expect(n.map((x) => x.estado)).toEqual(["a_enviar", "a_enviar"]);
      expect(n[0]?.dados).toEqual({
        loja: "Loja A",
        pedido: r.id,
        cliente: f.slice(4),
        tipo: "apagamento",
        recebido: r.dia,
        prazo: r.prazo,
      });
      const texto = JSON.stringify(n);
      for (const proibido of [NOME, EMAIL, NIF, "Ana Aviso, Lda"]) {
        expect(texto).not.toContain(proibido);
      }
      // A tarefa já correu: deixa de contar.
      expect(await contarComoLimpeza()).toBe(0);

      // Outra volta: nada novo, o aviso fica o mesmo (uma vez só).
      const em = await avisoPrazoEm(r.id);
      expect(em).not.toBeNull();
      expect(await correrAvisosDoTitular(base.api)).toEqual({
        avisados: 0,
        erros: [],
      });
      expect(await avisos(r.id)).toHaveLength(2);
      expect(await avisoPrazoEm(r.id)).toEqual(em);

      // Prorrogar depois do aviso não volta a avisar (A1).
      await prorrogar(r.prq, r.limite, maisDias(r.dia, 1));
      expect(await correrAvisosDoTitular(base.api)).toEqual({
        avisados: 0,
        erros: [],
      });
      expect(await avisos(r.id)).toHaveLength(2);

      // A guarda: o aviso não se tira nem se dá outra vez, nem pelo dono.
      for (const valor of [sql`null`, sql`now()`]) {
        expect(
          await erroDe(
            sql`update pedido_titular_recebido set aviso_prazo_em = ${valor}
              where id = ${r.id}::uuid`.execute(base.dono),
          ),
        ).toMatch(/^customers\.invalid_transition:/);
      }
      // A API não chama a contagem (só a verificação da VPS).
      await expect(
        comComerciante(base.api, a, (trx) =>
          sql`select clientes_pedidos_sem_aviso_em_atraso()`.execute(trx),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it("dentro do prazo, fechado ou prorrogado para um dia que ainda não passou, não avisa; o prazo prorrogado que passou, sim (A1)", async () => {
      const f = await ficha();
      // Hoje na base, no fuso do comerciante: não troca perto da meia-noite.
      const hoje = await hojeDe(a);
      const dentro = await recebido(f, 3);
      const fechado = await recebido(f, 40);
      await fechar(fechado.prq);
      // Prorrogado até hoje: o prazo ainda não passou (o primeiro dia depois
      // é amanhã).
      const ateHoje = await recebido(f, 40);
      await prorrogar(ateHoje.prq, hoje, maisDias(ateHoje.dia, 1));
      // Prorrogado até ontem: passou hoje, o primeiro dia depois.
      const ateOntem = await recebido(f, 40, "acesso");
      await prorrogar(ateOntem.prq, maisDias(hoje, -1), ateOntem.dia);
      // Prorrogado até ao limite, que passou há mais de um dia.
      const antigo = await recebido(f, 70, "portabilidade");
      await prorrogar(antigo.prq, antigo.limite, antigo.dia);
      expect(antigo.limite < maisDias(hoje, -1)).toBe(true);
      // Só o antigo conta na verificação: o de ontem ainda está no primeiro dia.
      expect(await contarComoLimpeza()).toBe(1);

      expect(await correrAvisosDoTitular(base.api)).toEqual({
        avisados: 2,
        erros: [],
      });
      for (const x of [dentro, fechado, ateHoje]) {
        expect(await avisos(x.id)).toEqual([]);
        expect(await avisoPrazoEm(x.id)).toBeNull();
      }
      const deOntem = await avisos(ateOntem.id);
      expect(deOntem.map((x) => x.pessoa_id)).toEqual(donos());
      // O prazo do aviso é o prorrogado.
      expect(deOntem[0]?.dados).toMatchObject({
        tipo: "acesso",
        prazo: maisDias(hoje, -1),
      });
      expect((await avisos(antigo.id))[0]?.dados).toMatchObject({
        tipo: "portabilidade",
        prazo: antigo.limite,
      });
      expect(await contarComoLimpeza()).toBe(0);
    });

    it("só a tarefa do sistema marca o aviso, e só num pedido por avisar", async () => {
      const f = await ficha();
      const r = await recebido(f, 3);
      const marcar = (quem: string) =>
        comComerciante(base.api, a, async (trx) => {
          await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(
            trx,
          );
          return (
            await sql<{
              m: boolean;
            }>`select clientes_aviso_prazo_marcar(${r.id}::uuid) as m`.execute(
              trx,
            )
          ).rows[0]?.m;
        });
      expect(await erroDe(marcar("pessoa:per_x"))).toMatch(
        /^customers\.change_without_who:/,
      );
      // Dentro do prazo, nem a tarefa o marca.
      expect(await marcar(QUEM_DA_TAREFA)).toBe(false);
      expect(await avisoPrazoEm(r.id)).toBeNull();
    });

    it("o envio: sai aos donos com o texto aprovado; o de um pedido fechado entretanto fica cancelado (aviso_espera)", async () => {
      const f = await ficha();
      const aberto = await recebido(f, 40);
      const fechaDepois = await recebido(f, 40, "oposicao");
      // A prorrogação registada depois de o aviso ser criado (P3-3).
      const prorrogaDepois = await recebido(f, 40, "outro");
      expect((await correrAvisosDoTitular(base.api)).avisados).toBe(3);
      await fechar(fechaDepois.prq);
      await prorrogar(
        prorrogaDepois.prq,
        prorrogaDepois.limite,
        prorrogaDepois.dia,
      );
      const correio = new CorreioDeEnsaio();
      await correrNotificacoes(base.api, correio);
      const deste = correio.enviados.filter((m) =>
        m.texto.includes(aberto.prq),
      );
      expect(deste).toHaveLength(2);
      for (const m of deste) {
        expect(m.assunto).toBe(
          `Pedido de dados pessoais: o prazo legal passou (${aberto.prazo.split("-").reverse().join("/")})`,
        );
        expect(m.texto).toContain(`(ficha ${f}) — apagamento — chegou a`);
        expect(m.texto).toContain(
          `POST /privacy-requests/received/${aberto.prq}/close`,
        );
        for (const proibido of [NOME, EMAIL, NIF]) {
          expect(m.texto).not.toContain(proibido);
        }
      }
      expect(
        correio.enviados.filter((m) => m.texto.includes(fechaDepois.prq)),
      ).toEqual([]);
      const cancelados = await avisos(fechaDepois.id);
      expect(cancelados.map((x) => [x.estado, x.ultimo_erro])).toEqual([
        ["cancelada", "pedido_ja_fechado"],
        ["cancelada", "pedido_ja_fechado"],
      ]);
      expect(
        (await avisos(prorrogaDepois.id)).map((x) => [x.estado, x.ultimo_erro]),
      ).toEqual([
        ["cancelada", "prazo_prorrogado"],
        ["cancelada", "prazo_prorrogado"],
      ]);
      expect(
        correio.enviados.filter((m) => m.texto.includes(prorrogaDepois.prq)),
      ).toEqual([]);
      // Um dono que passa a gestor antes do envio já não recebe.
      const outro = await recebido(f, 40);
      expect((await correrAvisosDoTitular(base.api)).avisados).toBe(1);
      await sql`update membro set papel = 'gestor'
        where comerciante_id = ${a}::uuid and pessoa_id = ${p["dono2"]}::uuid
          and ate is null`.execute(base.dono);
      await correrNotificacoes(base.api, new CorreioDeEnsaio());
      const depois = await avisos(outro.id);
      expect(depois.find((x) => x.pessoa_id === p["dono2"])?.ultimo_erro).toBe(
        "destinatario_inactivo",
      );
      expect(depois.find((x) => x.pessoa_id === p["dono"])?.estado).toBe(
        "enviada",
      );
    });

    it("avisar, prorrogar e fechar são actos diferentes: o aviso não entra no mesmo UPDATE (a guarda)", async () => {
      const f = await ficha();
      const r = await recebido(f, 40);
      const hoje = await hojeDe(a);
      expect(
        await erroDe(
          noComerciante((t) =>
            sql`update pedido_titular_recebido set aviso_prazo_em = now(),
            estado = 'respondido', fechado_em = ${hoje}::date
            where id = ${r.id}::uuid`.execute(t),
          ),
        ),
      ).toMatch(
        /^customers\.invalid_transition: avisar do prazo, prorrogar e fechar/,
      );
      expect(
        await erroDe(
          noComerciante((t) =>
            sql`update pedido_titular_recebido set aviso_prazo_em = now(),
            prorrogado_ate = ${r.limite}::date, prorrogado_motivo = 'complexidade',
            titular_informado_em = ${r.dia}::date
            where id = ${r.id}::uuid`.execute(t),
          ),
        ),
      ).toMatch(
        /^customers\.invalid_transition: avisar do prazo, prorrogar e fechar/,
      );
      expect(await avisoPrazoEm(r.id)).toBeNull();
      expect(await avisos(r.id)).toEqual([]);
      // Fica para a tarefa (e sai deste teste avisado).
      expect((await correrAvisosDoTitular(base.api)).avisados).toBe(1);
    });

    it("duas voltas ao mesmo tempo marcam o pedido uma vez, com uma notificação por dono", async () => {
      const f = await ficha();
      const r = await recebido(f, 40);
      const [x, y] = await Promise.all([
        correrAvisosDoTitular(base.api),
        correrAvisosDoTitular(base.api),
      ]);
      expect(x.erros).toEqual([]);
      expect(y.erros).toEqual([]);
      expect(x.avisados + y.avisados).toBe(1);
      // O segundo dono passou a gestor no teste do envio: fica um.
      expect((await avisos(r.id)).map((n) => n.pessoa_id)).toEqual([p["dono"]]);
    });

    it("sem ninguém que receba, o aviso não se gasta: fica por avisar e conta na verificação; com um dono, a tarefa marca-o (P2-1)", async () => {
      const d = await registarComerciante(base.api, {
        nome: "Loja Sem Dono",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      await h.pessoaCom(d, "gestor");
      const k = await chaveDe(d);
      const f = await ficha(k);
      const r = await recebido(f, 40, "apagamento", k);
      const antes = await contarComoLimpeza();
      expect(antes).toBeGreaterThanOrEqual(1);
      expect(await correrAvisosDoTitular(base.api)).toEqual({
        avisados: 0,
        erros: [],
      });
      expect(await avisoPrazoEm(r.id)).toBeNull();
      expect(await avisos(r.id)).toEqual([]);
      // Um atraso que a verificação diária apanha.
      expect(await contarComoLimpeza()).toBe(antes);
      // Entra um dono: a volta seguinte marca-o e avisa-o.
      const dono = (await h.pessoaCom(d, "dono")).pessoa;
      expect(await correrAvisosDoTitular(base.api)).toEqual({
        avisados: 1,
        erros: [],
      });
      expect((await avisos(r.id)).map((n) => n.pessoa_id)).toEqual([dono]);
      expect(await contarComoLimpeza()).toBe(antes - 1);
    });

    it("a regra A1 conta o dia no fuso do comerciante, não o da base", async () => {
      // Um fuso em que hoje é outro dia que na base (de um lado ou do outro
      // da linha de data, conforme a hora do teste).
      const { rows } = await sql<{ fuso: string }>`
        select fuso from (values ('Pacific/Kiritimati'), ('Pacific/Pago_Pago')) v (fuso)
        where (now() at time zone fuso)::date <> current_date limit 1`.execute(
        base.dono,
      );
      const fuso = rows[0]?.fuso ?? "";
      expect(fuso).not.toBe("");
      const c = await registarComerciante(base.api, {
        nome: "Loja Longe",
        lingua: "en",
        fuso,
      });
      const dono = (await h.pessoaCom(c, "dono")).pessoa;
      const k = await chaveDe(c);
      const f = await ficha(k);
      const hoje = await hojeDe(c);
      // Até hoje, no fuso dele: ainda não passou.
      const ateHoje = await recebido(f, 40, "apagamento", k);
      await prorrogar(ateHoje.prq, hoje, ateHoje.dia, k);
      // Até ontem, no fuso dele: passou hoje.
      const ateOntem = await recebido(f, 40, "acesso", k);
      await prorrogar(ateOntem.prq, maisDias(hoje, -1), ateOntem.dia, k);
      expect(await correrAvisosDoTitular(base.api)).toEqual({
        avisados: 1,
        erros: [],
      });
      expect(await avisoPrazoEm(ateHoje.id)).toBeNull();
      const n = await avisos(ateOntem.id);
      expect(n.map((x) => x.pessoa_id)).toEqual([dono]);
      expect(n[0]?.dados).toMatchObject({
        loja: "Loja Longe",
        prazo: maisDias(hoje, -1),
      });
      const { rows: l } = await sql<{ lingua: string }>`
        select lingua from notificacao where referencia = ${ateOntem.id}::uuid`.execute(
        base.dono,
      );
      expect(l.map((x) => x.lingua)).toEqual(["en"]);
    });

    it("o texto do e-mail em pt, es e en: o tipo em linguagem comum, as datas por língua, sem dados do cliente", () => {
      const dados = {
        loja: "Loja Exemplo",
        pedido: "0192a000-0000-7000-8000-000000000001",
        cliente: "0192a000-0000-7000-8000-000000000002",
        tipo: "apagamento",
        recebido: "2026-10-02",
        prazo: "2026-11-02",
      };
      const para = { email: "dono@exemplo.test" };
      const prq = `prq_${dados.pedido}`;
      const cus = `cus_${dados.cliente}`;
      const pt = mensagemDe("privacy.deadline_passed", "pt", dados, para);
      expect(pt.para).toBe("dono@exemplo.test");
      expect(pt.assunto).toBe(
        "Pedido de dados pessoais: o prazo legal passou (02/11/2026)",
      );
      expect(pt.texto).toBe(
        [
          "Olá,",
          "",
          `Na loja «Loja Exemplo», o pedido ${prq} (ficha ${cus}) — apagamento — chegou a 02/10/2026 e ainda não tem resposta.`,
          "O prazo legal para responder era 02/11/2026 (RGPD, art. 12.º, n.º 3).",
          "",
          `Responda ao cliente e feche o pedido: POST /privacy-requests/received/${prq}/close.`,
          "",
          "Este aviso vai para os donos da loja. Não leva dados do cliente.",
          "Eurolify",
        ].join("\n"),
      );
      const es = mensagemDe(
        "privacy.deadline_passed",
        "es",
        { ...dados, tipo: "rectificacao" },
        para,
      );
      expect(es.assunto).toBe(
        "Solicitud de datos personales: el plazo legal ha vencido (02/11/2026)",
      );
      expect(es.texto).toContain("— rectificación — llegó el 02/10/2026");
      const en = mensagemDe(
        "privacy.deadline_passed",
        "en",
        { ...dados, tipo: "oposicao" },
        para,
      );
      expect(en.assunto).toBe(
        "Personal data request: the legal deadline has passed (2026-11-02)",
      );
      expect(en.texto).toContain("— objection — arrived on 2026-10-02");
      const nomes = {
        pt: ["acesso", "limitação", "portabilidade", "outro"],
        es: ["acceso", "limitación", "portabilidad", "otro"],
        en: ["access", "restriction", "portability", "other"],
      } as const;
      for (const l of ["pt", "es", "en"] as const) {
        ["acesso", "limitacao", "portabilidade", "outro"].forEach((tipo, i) => {
          expect(
            mensagemDe("privacy.deadline_passed", l, { ...dados, tipo }, para)
              .texto,
          ).toContain(`— ${nomes[l][i] ?? "?"} —`);
        });
      }
      // Um tipo fora da lista não dá texto (o envio marca-o falhado), nem
      // uma chave herdada do objecto (P3-7).
      for (const tipo of ["x", "constructor", "toString", "__proto__"]) {
        expect(() =>
          mensagemDe("privacy.deadline_passed", "pt", { ...dados, tipo }, para),
        ).toThrow();
      }
    });
  },
);
