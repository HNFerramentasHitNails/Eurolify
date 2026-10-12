import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import { CorreioDeEnsaio } from "../src/notificacoes/correio.js";
import { mensagemDe } from "../src/notificacoes/modelos.js";
import { correrNotificacoes } from "../src/notificacoes/repositorio.js";
import { correrAvisosDeTarefas } from "../src/tarefas/avisos.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// O aviso de um caso vencido por e-mail (docs/34 §12; migração 0071; decisão
// EB, Q12 A): à pessoa responsável; sem responsável, a quem decide a fila e
// atribui. Os casos entram pela base em modo `replica`, como em
// `tarefas-api.test.ts`: o que se testa aqui é quem recebe e o que diz.

describe.skipIf(URL_BASE === undefined)(
  "Notificações: os avisos das tarefas vencidas",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let a = "";
    let b = "";
    let chave = "";
    const pessoas = {
      dono: randomUUID(),
      gestor: randomUUID(),
      armazem: randomUUID(),
      apoio: randomUUID(),
      saiu: randomUUID(),
      desactivada: randomUUID(),
      donoB: randomUUID(),
    };
    const nomeDe = new Map<string, string>(
      Object.entries(pessoas).map(([k, v]) => [v, k]),
    );
    const casos = {
      diferenca: randomUUID(),
      duplicado: randomUUID(),
      foraDePrazo: randomUUID(),
      // Pendente há 20 dias: o prazo legal passou e ninguém o tem.
      pendente: randomUUID(),
      problema: randomUUID(),
      aceite: randomUUID(),
      devolucao: randomUUID(),
      diferencaB: randomUUID(),
    };
    const encomenda = randomUUID();
    const CLIENTE = "cliente-nunca-no-email@exemplo.pt";

    /** Escreve como o dono das tabelas, sem os gatilhos dos domínios. */
    const comoDono = (fn: (t: Transaction<unknown>) => Promise<unknown>) =>
      base.dono.transaction().execute(async (trx) => {
        await sql`set local session_replication_role = replica`.execute(trx);
        const sempre = (
          await sql<{ tabela: string; nome: string }>`
          select c.relname as tabela, t.tgname as nome from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and t.tgenabled = 'A'
            and c.relname in ('pedido_livre_resolucao', 'devolucao', 'problema',
                              'duplicado_cliente', 'diferenca_pagamento', 'pessoa',
                              'membro', 'atribuicao')`.execute(trx)
        ).rows;
        for (const g of sempre) {
          await sql`alter table ${sql.id(g.tabela)} disable trigger ${sql.id(g.nome)}`.execute(
            trx,
          );
        }
        await fn(trx);
        for (const g of sempre) {
          await sql`alter table ${sql.id(g.tabela)} enable always trigger ${sql.id(g.nome)}`.execute(
            trx,
          );
        }
      });

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      app = criarApp(
        { logger: false },
        undefined,
        base.api,
        undefined,
        undefined,
        undefined,
        { pedidos: 100_000, janelaMs: 60_000 },
      );
      a = await registarComerciante(base.api, {
        nome: "Loja A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      b = await registarComerciante(base.api, {
        nome: "Tienda B",
        lingua: "es",
        fuso: "Europe/Madrid",
      });
      const equipa: [string, string, string][] = [
        [pessoas.dono, a, "dono"],
        [pessoas.gestor, a, "gestor"],
        [pessoas.armazem, a, "armazem"],
        [pessoas.apoio, a, "apoio"],
        [pessoas.saiu, a, "gestor"],
        [pessoas.desactivada, a, "gestor"],
        [pessoas.donoB, b, "dono"],
      ];
      await comoDono(async (t) => {
        for (const [p, c, papel] of equipa) {
          await sql`insert into pessoa (id, email, nome)
            values (${p}, ${`${p}@exemplo.pt`}, 'Pessoa')`.execute(t);
          await sql`insert into membro (id, comerciante_id, pessoa_id, papel, convidado_por)
            values (${randomUUID()}, ${c}, ${p}, ${papel}, 'operador:teste')`.execute(
            t,
          );
        }
        await sql`update membro set ate = now(), terminado_por = 'operador:teste' where pessoa_id = ${pessoas.saiu}`.execute(
          t,
        );
        await sql`update pessoa set estado = 'desactivada', desactivada_em = now()
          where id = ${pessoas.desactivada}`.execute(t);
        // Vencidos pelo prazo por omissão (docs/33 §1): a diferença (1 dia),
        // o duplicado (7), o fora de prazo (2) e o problema (2).
        await sql`insert into diferenca_pagamento (id, comerciante_id, motivo, criada_em)
          values (${casos.diferenca}, ${a}, 'incerto', now() - interval '2 days'),
                 (${casos.diferencaB}, ${b}, 'incerto', now() - interval '2 days')`.execute(
          t,
        );
        const [x, y] = [randomUUID(), randomUUID()].sort();
        await sql`insert into duplicado_cliente (id, comerciante_id, cliente_a, cliente_b,
            sinais, estado, criado_em, actualizado_em, por_decidir_desde)
          values (${casos.duplicado}, ${a}, ${x}, ${y}, '{email}', 'por_decidir',
            now() - interval '8 days', now() - interval '8 days',
            now() - interval '8 days')`.execute(t);
        await sql`insert into pedido_livre_resolucao (id, comerciante_id, encomenda_id,
            origem, contacto, recebido_em, dentro_do_prazo, estado, confirmacao)
          values
            (${casos.foraDePrazo}, ${a}, ${encomenda}, 'botao', ${CLIENTE},
              now() - interval '3 days', false, 'fora_de_prazo', '{}'),
            (${casos.pendente}, ${a}, ${encomenda}, 'botao', ${CLIENTE},
              now() - interval '20 days', true, 'pendente', '{}'),
            (${casos.aceite}, ${a}, ${encomenda}, 'botao', ${CLIENTE},
              now() - interval '20 days', true, 'aceite', '{}')`.execute(t);
        // O prazo do reembolso vencido: tem os avisos da pós-venda (T3).
        await sql`insert into devolucao (id, comerciante_id, encomenda_id, armazem_id,
            origem, pedido_livre_resolucao_id, estado, criada_por, criada_em)
          values (${casos.devolucao}, ${a}, ${encomenda}, ${randomUUID()},
            'livre_resolucao', ${casos.aceite}, 'a_aguardar', 'teste',
            now() - interval '20 days')`.execute(t);
        await sql`insert into problema (id, comerciante_id, encomenda_id, tipo, descricao,
            estado, criado_por, criado_em, na_fila_desde)
          values (${casos.problema}, ${a}, ${encomenda}, 'chegou_danificado',
            ${`partido, diz ${CLIENTE}`}, 'aberto', 'teste', now() - interval '3 days',
            now() - interval '3 days')`.execute(t);
      });
      chave = (
        await criarChave(base.dono, a, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "Tudo",
          ambitos: [
            "payments:read",
            "customers:read",
            "customers:merge",
            "returns:read",
            "returns:write",
            "refunds:read",
            "refunds:write",
            "tasks:assign",
          ],
        })
      ).segredo;
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await base.fechar();
    });

    const pedir = (url: string, corpo: unknown) =>
      app.inject({
        method: "POST",
        url,
        headers: {
          authorization: `Bearer ${chave}`,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
        },
        payload: JSON.stringify(corpo),
      });

    const atribuir = async (
      fila: string,
      caso: string,
      pessoa: string,
      versao: number,
    ) => {
      const r = await pedir(`/tasks/${fila}/${caso}/assign`, {
        responsavel: `per_${pessoa}`,
        versao,
      });
      expect(r.statusCode, r.body).toBe(200);
    };

    /** As notificações dos avisos das tarefas: fila, pessoa, estado, erro. */
    const notificacoes = async () =>
      (
        await sql<{
          fila: string;
          pessoa_id: string;
          estado: string;
          ultimo_erro: string | null;
          referencia: string;
          comerciante_id: string;
          caso: string;
        }>`select dados ->> 'fila' as fila, dados ->> 'caso' as caso, pessoa_id,
              estado, ultimo_erro, referencia, comerciante_id
            from notificacao where tipo = 'task.overdue'
            order by criada_em, id`.execute(base.dono)
      ).rows.map((n) => ({
        ...n,
        pessoa: nomeDe.get(n.pessoa_id) ?? n.pessoa_id,
      }));

    const por = (
      l: Awaited<ReturnType<typeof notificacoes>>,
      campos: (n: (typeof l)[number]) => string,
    ) => l.map(campos).sort();

    it("cada caso vencido avisa o responsável, ou, sem ele, quem decide a fila e atribui; nunca o prazo do reembolso", async () => {
      // Antes do aviso: o duplicado é do gestor e o fora de prazo é do
      // armazém (quem decide a livre resolução, docs/33 §1).
      await atribuir(
        "duplicado_cliente",
        `dup_${casos.duplicado}`,
        pessoas.gestor,
        0,
      );
      await atribuir(
        "livre_resolucao",
        `wdr_${casos.foraDePrazo}`,
        pessoas.armazem,
        0,
      );
      const r = await correrAvisosDeTarefas(base.api);
      expect(r.erros).toEqual([]);
      expect(r.avisados).toBe(6);
      const l = await notificacoes();
      expect(por(l, (n) => `${n.fila}:${n.pessoa}`)).toEqual([
        // Sem responsável, a diferença vai só aos donos (payments:resolve).
        "duplicado_cliente:gestor",
        "livre_resolucao:armazem",
        // O pedido pendente sem responsável: o armazém e o apoio decidem a
        // livre resolução, mas não atribuem (tasks:assign) — Q12 A.
        "livre_resolucao:dono",
        "livre_resolucao:gestor",
        "pagamento:dono",
        "pagamento:donoB",
        // Sem responsável, o problema vai ao dono e ao gestor activos: nem
        // ao apoio nem ao armazém (não decidem), nem a quem saiu ou foi
        // desactivado.
        "problema:dono",
        "problema:gestor",
      ]);
      expect(l.every((n) => n.estado === "a_enviar")).toBe(true);
      // Uma segunda volta não dá outra (o aviso é um por prazo).
      await correrAvisosDeTarefas(base.api);
      expect(await notificacoes()).toHaveLength(8);
    });

    it("no envio: cancela-se se o caso já não espera ou a pessoa já não recebe; o resto sai, sem dados do cliente", async () => {
      // O prazo do duplicado muda para amanhã: o aviso já não é verdade.
      const prazo = await pedir(
        `/tasks/duplicado_cliente/dup_${casos.duplicado}/deadline`,
        {
          prazo: new Date(Date.now() + 86_400_000).toISOString(),
          motivo: "à espera de um documento",
          versao: 1,
        },
      );
      expect(prazo.statusCode, prazo.body).toBe(200);
      // O problema passa a ter o gestor como responsável: o dono deixa de
      // receber; o gestor continua.
      await atribuir("problema", `prb_${casos.problema}`, pessoas.gestor, 0);
      const correio = new CorreioDeEnsaio();
      const r = await correrNotificacoes(base.api, correio);
      expect(r.erros).toEqual([]);
      const l = await notificacoes();
      expect(
        por(
          l,
          (n) => `${n.fila}:${n.pessoa}:${n.estado}:${String(n.ultimo_erro)}`,
        ),
      ).toEqual([
        "duplicado_cliente:gestor:cancelada:tarefa_ja_nao_espera",
        "livre_resolucao:armazem:enviada:null",
        "livre_resolucao:dono:enviada:null",
        "livre_resolucao:gestor:enviada:null",
        "pagamento:dono:enviada:null",
        "pagamento:donoB:enviada:null",
        "problema:dono:cancelada:destinatario_inactivo",
        "problema:gestor:enviada:null",
      ]);
      expect(correio.enviados).toHaveLength(6);
      const para = (p: string) =>
        correio.enviados.find((m) => m.para === `${p}@exemplo.pt`);
      expect(para(pessoas.armazem)).toMatchObject({
        assunto: `Tarefa vencida: pedido de livre resolução wdr_${casos.foraDePrazo}`,
      });
      const texto =
        correio.enviados.find(
          (m) =>
            m.para === `${pessoas.dono}@exemplo.pt` &&
            m.assunto.includes("pdi_"),
        )?.texto ?? "";
      expect(texto).toContain(
        `Na loja «Loja A», o caso pdi_${casos.diferenca} (diferença de pagamento; motivo: incerto) passou o prazo de `,
      );
      expect(texto).toMatch(
        /de \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(Europe\/Lisbon\)/,
      );
      expect(texto).toContain("GET /tasks?vencida=true");
      // A loja B escreve em espanhol, no fuso dela.
      expect(para(pessoas.donoB)).toMatchObject({
        assunto: `Tarea vencida: diferencia de pago pdi_${casos.diferencaB}`,
      });
      expect(para(pessoas.donoB)?.texto).toContain("(Europe/Madrid)");
      // Nenhum dado do cliente: o contacto e a descrição do problema.
      for (const m of correio.enviados) {
        expect(`${m.assunto}\n${m.texto}`).not.toContain(CLIENTE);
        expect(`${m.assunto}\n${m.texto}`).not.toContain("partido");
      }
      // Os dados guardados também não os têm, nem o motivo livre do prazo.
      const dados = await sql<{ d: string }>`
        select dados::text as d from notificacao where tipo = 'task.overdue'`.execute(
        base.dono,
      );
      for (const { d } of dados.rows) {
        expect(d).not.toContain(CLIENTE);
        expect(d).not.toContain("à espera de um documento");
      }
    });

    it("um prazo novo que volta a vencer dá um aviso novo ao responsável", async () => {
      // O prazo do duplicado passa a ontem (como o tempo a passar).
      await comoDono((t) =>
        sql`update atribuicao set prazo = now() - interval '1 minute'
          where fila = 'duplicado_cliente' and caso = ${casos.duplicado}`.execute(
          t,
        ),
      );
      const r = await correrAvisosDeTarefas(base.api);
      expect(r.avisados).toBe(1);
      const duplicado = (await notificacoes()).filter(
        (n) => n.fila === "duplicado_cliente",
      );
      expect(duplicado.map((n) => `${n.pessoa}:${n.estado}`)).toEqual([
        "gestor:cancelada",
        "gestor:a_enviar",
      ]);
      expect(duplicado[0]?.referencia).not.toBe(duplicado[1]?.referencia);
      const correio = new CorreioDeEnsaio();
      await correrNotificacoes(base.api, correio);
      expect(correio.enviados.map((m) => m.para)).toEqual([
        `${pessoas.gestor}@exemplo.pt`,
      ]);
    });

    it("quem sai da equipa antes do envio não recebe: a notificação cancela-se", async () => {
      // Um caso novo vencido, sem responsável: o dono e o gestor.
      const outro = randomUUID();
      await comoDono((t) =>
        sql`insert into problema (id, comerciante_id, encomenda_id, tipo, descricao,
            estado, criado_por, criado_em, na_fila_desde)
          values (${outro}, ${a}, ${encomenda}, 'atraso', 'tarde', 'aberto', 'teste',
            now() - interval '3 days', now() - interval '3 days')`.execute(t),
      );
      await correrAvisosDeTarefas(base.api);
      await comoDono((t) =>
        sql`update membro set ate = now(), terminado_por = 'operador:teste' where pessoa_id = ${pessoas.gestor}`.execute(
          t,
        ),
      );
      const correio = new CorreioDeEnsaio();
      await correrNotificacoes(base.api, correio);
      expect(correio.enviados.map((m) => m.para)).toEqual([
        `${pessoas.dono}@exemplo.pt`,
      ]);
      const l = (await notificacoes()).filter(
        (n) => n.fila === "problema" && n.estado !== "enviada",
      );
      expect(por(l, (n) => `${n.pessoa}:${String(n.ultimo_erro)}`)).toEqual([
        "dono:destinatario_inactivo",
        "gestor:destinatario_inactivo",
      ]);
    });

    it("um caso decidido antes do envio não sai: a notificação cancela-se", async () => {
      const outra = randomUUID();
      await comoDono((t) =>
        sql`insert into diferenca_pagamento (id, comerciante_id, motivo, criada_em)
          values (${outra}, ${a}, 'incerto', now() - interval '2 days')`.execute(
          t,
        ),
      );
      await correrAvisosDeTarefas(base.api);
      await comoDono((t) =>
        sql`update diferenca_pagamento set estado = 'resolvida',
            resolucao = 'visto no prestador', resolvida_por = 'pessoa:per_teste',
            resolvida_em = now()
          where id = ${outra}`.execute(t),
      );
      const correio = new CorreioDeEnsaio();
      await correrNotificacoes(base.api, correio);
      expect(correio.enviados).toEqual([]);
      const n = await sql<{ estado: string; ultimo_erro: string | null }>`
        select estado, ultimo_erro from notificacao
        where tipo = 'task.overdue' and dados ->> 'caso' = ${outra}`.execute(
        base.dono,
      );
      expect(n.rows).toEqual([
        { estado: "cancelada", ultimo_erro: "tarefa_ja_nao_espera" },
      ]);
    });

    /** Uma pessoa nova na equipa do A (os testes de cima já tiraram o gestor). */
    const novaPessoa = async (papel: string) => {
      const p = randomUUID();
      nomeDe.set(p, `${papel}-${p.slice(0, 4)}`);
      await comoDono(async (t) => {
        await sql`insert into pessoa (id, email, nome)
          values (${p}, ${`${p}@exemplo.pt`}, 'Pessoa')`.execute(t);
        await sql`insert into membro (id, comerciante_id, pessoa_id, papel, convidado_por)
          values (${randomUUID()}, ${a}, ${p}, ${papel}, 'operador:teste')`.execute(
          t,
        );
      });
      return p;
    };
    const problemaVencido = async () => {
      const id = randomUUID();
      await comoDono((t) =>
        sql`insert into problema (id, comerciante_id, encomenda_id, tipo, descricao,
            estado, criado_por, criado_em, na_fila_desde)
          values (${id}, ${a}, ${encomenda}, 'atraso', 'tarde', 'aberto', 'teste',
            now() - interval '3 days', now() - interval '3 days')`.execute(t),
      );
      return id;
    };
    const doCaso = async (caso: string) =>
      (await notificacoes())
        .filter((n) => n.fila === "problema" && n.caso === caso)
        .map((n) => `${n.pessoa}:${n.estado}`)
        .sort();

    it("o responsável muda depois do aviso e antes do envio: o aviso vai ao novo; sem ninguém, a quem decide e atribui (revisão do #389, P2-1)", async () => {
      const [r, s2] = [await novaPessoa("gestor"), await novaPessoa("gestor")];
      const caso = await problemaVencido();
      await atribuir("problema", `prb_${caso}`, r, 0);
      await correrAvisosDeTarefas(base.api);
      expect(await doCaso(caso)).toEqual([`${nomeDe.get(r) ?? ""}:a_enviar`]);
      // Passa de R para S: S recebe o mesmo aviso; R cancela-se no envio.
      await atribuir("problema", `prb_${caso}`, s2, 1);
      // S sai da equipa pela porta normal (o R8 tira-lhe o caso): o caso
      // fica sem ninguém e o aviso vai a quem decide e atribui.
      const outro = await problemaVencido();
      await atribuir("problema", `prb_${outro}`, s2, 0);
      await correrAvisosDeTarefas(base.api);
      await base.dono.transaction().execute((t) =>
        sql`update membro set ate = now(), terminado_por = 'operador:teste'
            where pessoa_id = ${s2} and comerciante_id = ${a}`.execute(t),
      );
      const correio = new CorreioDeEnsaio();
      expect((await correrNotificacoes(base.api, correio)).erros).toEqual([]);
      const [nr, ns] = [nomeDe.get(r) ?? "", nomeDe.get(s2) ?? ""];
      // O primeiro caso: S saiu antes do envio, e com ele o caso ficou sem
      // responsável; o aviso chega ao dono e a R (gestor activo).
      expect(await doCaso(caso)).toEqual(
        [`${nr}:enviada`, `${ns}:cancelada`, "dono:enviada"].sort(),
      );
      expect(await doCaso(outro)).toEqual(
        [`${nr}:enviada`, `${ns}:cancelada`, "dono:enviada"].sort(),
      );
      expect(correio.enviados.some((m) => m.para === `${s2}@exemplo.pt`)).toBe(
        false,
      );
    });

    it("um responsável que já não decide não conta no aviso: vai a quem decide e atribui (revisão do #389, P2-3)", async () => {
      const r = await novaPessoa("gestor");
      const caso = await problemaVencido();
      await atribuir("problema", `prb_${caso}`, r, 0);
      // Sai sem o R8 (modo replica): a atribuição fica com ele.
      await comoDono((t) =>
        sql`update membro set ate = now(), terminado_por = 'operador:teste'
          where pessoa_id = ${r}`.execute(t),
      );
      await correrAvisosDeTarefas(base.api);
      const gestores = (
        await sql<{ pessoa_id: string }>`
          select m.pessoa_id from membro m join pessoa p on p.id = m.pessoa_id
          where m.comerciante_id = ${a} and m.ate is null and p.estado = 'activa'
            and m.papel in ('dono', 'gestor')`.execute(base.dono)
      ).rows.map((x) => `${nomeDe.get(x.pessoa_id) ?? x.pessoa_id}:a_enviar`);
      expect(gestores).toContain("dono:a_enviar");
      expect(await doCaso(caso)).toEqual(gestores.sort());
    });

    it("outro comerciante não vê as notificações deste nem sabe se o aviso dele ainda espera (P2-2)", async () => {
      const deB = (
        await sql<{ referencia: string }>`
          select referencia from notificacao
          where tipo = 'task.overdue' and comerciante_id = ${b}`.execute(
          base.dono,
        )
      ).rows[0]?.referencia;
      expect(deB).toBeDefined();
      const comContexto = async <T>(
        c: string,
        fn: (cl: pg.Client) => Promise<T>,
      ) => {
        const cl = new pg.Client({ connectionString: base.urlApi });
        await cl.connect();
        try {
          await cl.query("begin");
          await cl.query(
            "select set_config('eurolify.comerciante', $1, true)",
            [c],
          );
          return await fn(cl);
        } finally {
          await cl.query("rollback").catch(() => undefined);
          await cl.end();
        }
      };
      const ver = (c: string) =>
        comContexto(c, async (cl) => ({
          deB: (
            await cl.query<{ n: number }>(
              "select count(*)::int as n from notificacao where comerciante_id = $1",
              [b],
            )
          ).rows[0]?.n,
          espera: (
            await cl.query<{ e: boolean }>(
              "select tarefas_aviso_espera($1) as e",
              [deB],
            )
          ).rows[0]?.e,
        }));
      expect(await ver(b)).toEqual({ deB: 1, espera: true });
      expect(await ver(a)).toEqual({ deB: 0, espera: false });
    });

    it("o texto: em inglês, com os vários códigos do motivo; uns dados sem fila conhecida não dão texto", () => {
      const m = mensagemDe(
        "task.overdue",
        "en",
        {
          loja: "Shop\nA",
          fila: "documento_fiscal",
          caso: "0190",
          motivo: "emissor_por_configurar,taxa_sem_mapa",
          prazo: "2026-10-12 09:30",
          fuso: "Europe/Lisbon",
        },
        { email: "x@exemplo.pt" },
      );
      expect(m.assunto).toBe("Overdue task: tax document inv_0190");
      expect(m.texto).toContain(
        'In the shop "Shop A", the case inv_0190 (tax document; reason: emissor_por_configurar, taxa_sem_mapa) passed its deadline of 2026-10-12 09:30 (Europe/Lisbon) without a decision.',
      );
      expect(
        mensagemDe(
          "task.overdue",
          "pt",
          {
            fila: "reembolso",
            caso: "1",
            motivo: "Nome do cliente",
            prazo: null,
            fuso: null,
          },
          { email: "x@exemplo.pt" },
        ).texto,
      ).toContain("o caso rfd_1 (reembolso; motivo: ?)");
      expect(() =>
        mensagemDe(
          "task.overdue",
          "pt",
          {
            fila: "inventada" as "pagamento",
            caso: "1",
            motivo: null,
            prazo: null,
            fuso: null,
          },
          { email: "x@exemplo.pt" },
        ),
      ).toThrow();
    });
  },
);
