import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  comComerciante,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { correrApagamentosPendentes } from "../src/clientes/titular-fila.js";
import { criarChave } from "../src/identidade/repositorio.js";
import type { Ambito } from "../src/identidade/chaves.js";
import { FILAS } from "../src/tarefas/filas.js";
import type { FilaTarefa } from "../src/base/esquema.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// O motivo livre de uma mudança de prazo limpa-se no apagamento do titular
// (docs/33 §6; docs/23 §15.1, grupo C; migração 0102). Ex.: a Ana pede o
// apagamento; o motivo «falei com a Ana Silva», escrito num caso da encomenda
// dela, passa a «(pseudonimizado)»; o de outro cliente e o resto da linha do
// rasto ficam como estavam. Os casos entram pela base em modo `replica`, como
// em `tarefas-api.test.ts`; a mudança de prazo e o apagamento correm pelos
// caminhos verdadeiros (a rota e `cliente_pseudonimizar`).

type Json = Record<string, unknown>;
const MARCADOR = "(pseudonimizado)";
const MOTIVO = "falei com a Ana Silva";
const AMBITOS: Ambito[] = [
  "payments:read",
  "invoices:read",
  "customers:read",
  "returns:read",
  "refunds:read",
  "customers:privacy",
  "payments:resolve",
  "invoices:write",
  "customers:merge",
  "returns:write",
  "refunds:write",
  "tasks:assign",
];
const TABELAS = [
  "cliente",
  "encomenda",
  "pagamento",
  "diferenca_pagamento",
  "documento_fiscal",
  "pedido_livre_resolucao",
  "devolucao",
  "problema",
  "reembolso",
  "duplicado_cliente",
  "pedido_titular_recebido",
];

describe.skipIf(URL_BASE === undefined)(
  "O motivo do prazo e o apagamento do titular",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let c = "";
    let chave = "";

    /** Escreve como o dono das tabelas, sem os gatilhos dos domínios. */
    const comoDono = (fn: (t: Transaction<unknown>) => Promise<unknown>) =>
      base.dono.transaction().execute(async (trx) => {
        await sql`set local session_replication_role = replica`.execute(trx);
        const sempre = (
          await sql<{ tabela: string; nome: string }>`
            select cl.relname as tabela, t.tgname as nome from pg_trigger t
            join pg_class cl on cl.oid = t.tgrelid
            where not t.tgisinternal and t.tgenabled = 'A'
              and cl.relname = any(${TABELAS}::text[])`.execute(trx)
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
      c = await registarComerciante(base.api, {
        nome: "Loja A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      chave = (
        await criarChave(base.dono, c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "Tudo",
          ambitos: AMBITOS,
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

    /** Muda o prazo de um caso pela rota, com o motivo escrito. */
    const mudarPrazo = async (
      fila: FilaTarefa,
      caso: string,
      motivo = MOTIVO,
    ) => {
      const r = await pedir(
        `/tasks/${fila}/${FILAS[fila].prefixo}_${caso}/deadline`,
        {
          prazo: new Date(Date.now() + 3_600_000).toISOString(),
          motivo,
          versao: 0,
        },
      );
      expect(r.statusCode, `${fila}: ${r.body}`).toBe(200);
    };

    const novoCliente = async (nome: string) => {
      const id = randomUUID();
      await comoDono(async (t) => {
        await sql`insert into cliente (id, comerciante_id, nome)
          values (${id}, ${c}, ${nome})`.execute(t);
      });
      return id;
    };

    const novaEncomenda = async (cliente: string) => {
      const id = randomUUID();
      await comoDono(async (t) => {
        await sql`insert into encomenda (id, comerciante_id, loja_id, canal_id,
            mercado_id, entidade_legal_id, sessao_id, cliente_id, perfil_id,
            perfil_copia, contacto, entrega, finalidade, moeda, preco_inclui_iva,
            lingua, total_base, total_iva, total, portes, metodo_entrega,
            metodo_pagamento, aceitacoes, criada_por, estado)
          values (${id}, ${c}, gen_random_uuid(), gen_random_uuid(),
            gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), ${cliente},
            gen_random_uuid(), '{}', '{"email": "ana@exemplo.pt"}', '{}',
            'consumo', 'EUR', true, 'pt', 1000, 230, 1230, '{}', '{}', 'mb_way',
            '{}', 'teste:motivo', 'concluida')`.execute(t);
      });
      return id;
    };

    /** O que a linha do rasto tem, menos o motivo: não pode mudar. */
    const rasto = async () =>
      (
        await sql<{
          fila: string;
          caso: string;
          motivo: string | null;
          resto: Json;
        }>`
          select a.fila, a.caso::text as caso, r.motivo,
            to_jsonb(r) - 'motivo' as resto
          from atribuicao_rasto r join atribuicao a on a.id = r.atribuicao_id
          where r.comerciante_id = ${c}::uuid
          order by r.id`.execute(base.dono)
      ).rows;
    const motivoDe = async (caso: string) =>
      (await rasto()).filter((r) => r.caso === caso).map((r) => r.motivo);

    const pseudonimizar = (cliente: string) =>
      comComerciante(base.dono, c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true)`.execute(
          trx,
        );
        return (
          await sql<{ r: Json }>`select cliente_pseudonimizar(${cliente}::uuid,
            ${`pseudonimizar cus_${cliente}`}, 'teste') as r`.execute(trx)
        ).rows[0]?.r;
      });

    /** Um caso aberto em cada fila que chega a uma encomenda. */
    const casosDeUmaEncomenda = async (enc: string) => {
      const k = {
        problema: randomUUID(),
        livre: randomUUID(),
        aceite: randomUUID(),
        devolucao: randomUUID(),
        documento: randomUUID(),
        reembolso: randomUUID(),
        pagamento: randomUUID(),
        diferenca: randomUUID(),
      };
      await comoDono(async (t) => {
        await sql`insert into problema (id, comerciante_id, encomenda_id, tipo,
            descricao, estado, criado_por)
          values (${k.problema}, ${c}, ${enc}, 'chegou_danificado', 'partido',
            'aberto', 'teste')`.execute(t);
        await sql`insert into pedido_livre_resolucao (id, comerciante_id,
            encomenda_id, origem, contacto, recebido_em, dentro_do_prazo, estado,
            confirmacao)
          values (${k.livre}, ${c}, ${enc}, 'botao', 'x@exemplo.pt', now(), true,
              'pendente', '{}'),
            (${k.aceite}, ${c}, ${enc}, 'botao', 'x@exemplo.pt', now(), true,
              'aceite', '{}')`.execute(t);
        await sql`insert into devolucao (id, comerciante_id, encomenda_id,
            armazem_id, origem, pedido_livre_resolucao_id, estado, criada_por)
          values (${k.devolucao}, ${c}, ${enc}, gen_random_uuid(),
            'livre_resolucao', ${k.aceite}, 'a_aguardar', 'teste')`.execute(t);
        await sql`insert into documento_fiscal (id, comerciante_id, encomenda_id,
            entidade_legal_id, modo, estado, motivos, criado_em, na_fila_desde)
          values (${k.documento}, ${c}, ${enc}, gen_random_uuid(), 'teste',
            'retido', '{emissor_por_configurar}', now(), now())`.execute(t);
        await sql`insert into reembolso (id, comerciante_id, encomenda_id,
            pagamento_id, origem, problema_id, montante, moeda, estado,
            decidido_por, na_fila_desde)
          values (${k.reembolso}, ${c}, ${enc}, gen_random_uuid(), 'problema',
            ${k.problema}, 1230, 'EUR', 'incerto', 'teste', now())`.execute(t);
        await sql`insert into pagamento (id, comerciante_id, encomenda_id,
            conta_id, prestador, metodo, modo, montante, moeda, referencia,
            expira_em, estado)
          values (${k.pagamento}, ${c}, ${enc}, gen_random_uuid(), 'eupago',
            'mb_way', 'teste', 1230, 'EUR', ${randomUUID().replaceAll("-", "")},
            now(), 'capturado')`.execute(t);
        await sql`insert into diferenca_pagamento (id, comerciante_id,
            pagamento_id, motivo)
          values (${k.diferenca}, ${c}, ${k.pagamento}, 'incerto')`.execute(t);
      });
      return k;
    };

    const FILAS_DA_ENCOMENDA = (
      k: Awaited<ReturnType<typeof casosDeUmaEncomenda>>,
    ): [FilaTarefa, string][] => [
      ["problema", k.problema],
      ["livre_resolucao", k.livre],
      ["prazo_reembolso", k.devolucao],
      ["documento_fiscal", k.documento],
      ["reembolso", k.reembolso],
      ["pagamento", k.diferenca],
    ];

    it("o titular fica «(pseudonimizado)» nos casos das nove filas que lhe chegam; o de outro cliente e o resto da linha ficam como estavam", async () => {
      const ana = await novoCliente("Ana Silva");
      const outra = await novoCliente("Rita Costa");
      const par = await novoCliente("Par da Ana");
      const parDaOutra = await novoCliente("Par da Rita");
      const encAna = await novaEncomenda(ana);
      const encOutra = await novaEncomenda(outra);
      const daAna = await casosDeUmaEncomenda(encAna);
      const daOutra = await casosDeUmaEncomenda(encOutra);
      // Um duplicado em que a Ana é o segundo do par, um pedido do titular
      // recebido dela, e os mesmos da outra.
      const dupAna = randomUUID();
      const dupOutra = randomUUID();
      const prqAna = randomUUID();
      const prqOutra = randomUUID();
      await comoDono(async (t) => {
        const [x, y] = [par, ana].sort();
        const [u, v] = [outra, parDaOutra].sort();
        await sql`insert into duplicado_cliente (id, comerciante_id, cliente_a,
            cliente_b, sinais, estado, por_decidir_desde)
          values (${dupAna}, ${c}, ${x}, ${y}, '{email}', 'por_decidir', now()),
            (${dupOutra}, ${c}, ${u}, ${v}, '{email}', 'por_decidir', now())`.execute(
          t,
        );
        await sql`insert into pedido_titular_recebido (id, comerciante_id,
            cliente_id, tipo, canal, recebido_em, recebido_dia, quem)
          values (${prqAna}, ${c}, ${ana}, 'apagamento', 'email', now(),
              current_date, 'teste'),
            (${prqOutra}, ${c}, ${outra}, 'acesso', 'email', now(),
              current_date, 'teste')`.execute(t);
      });
      const todos: [FilaTarefa, string][] = [
        ...FILAS_DA_ENCOMENDA(daAna),
        ["duplicado_cliente", dupAna],
        ["pedido_titular", prqAna],
      ];
      const dosOutros: [FilaTarefa, string][] = [
        ...FILAS_DA_ENCOMENDA(daOutra),
        ["duplicado_cliente", dupOutra],
        ["pedido_titular", prqOutra],
      ];
      for (const [fila, caso] of [...todos, ...dosOutros]) {
        await mudarPrazo(fila, caso);
      }
      const antes = await rasto();
      expect(antes.filter((r) => r.motivo === MOTIVO)).toHaveLength(16);

      const resultado = await pseudonimizar(ana);
      expect(resultado).toMatchObject({ motivos_de_prazo_limpos: 8 });
      // O resultado não leva dados: só contagens.
      expect(JSON.stringify(resultado)).not.toContain("Ana");

      const depois = await rasto();
      expect(depois).toHaveLength(antes.length);
      // Só a coluna `motivo` mudou, e só nos casos da Ana.
      expect(depois.map((r) => r.resto)).toEqual(antes.map((r) => r.resto));
      const casosDaAna = new Set(todos.map(([, caso]) => caso));
      for (const [i, r] of depois.entries()) {
        const antesDe = antes[i];
        if (casosDaAna.has(r.caso) && antesDe?.motivo !== null) {
          expect(r.motivo, `${r.fila} ${r.caso}`).toBe(MARCADOR);
        } else {
          expect(r.motivo, `${r.fila} ${r.caso}`).toBe(antesDe?.motivo);
        }
      }
      for (const [fila, caso] of todos) {
        expect(await motivoDe(caso), fila).toContain(MARCADOR);
        expect(await motivoDe(caso), fila).not.toContain(MOTIVO);
      }
      for (const [fila, caso] of dosOutros) {
        expect(await motivoDe(caso), fila).toContain(MOTIVO);
      }
      // Outra volta não acha nada para limpar.
      const outraVez = await comComerciante(base.dono, c, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true),
          set_config('eurolify.origem', 'teste', true)`.execute(trx);
        await sql`insert into pseudonimizacao_em_curso values (pg_current_xact_id())`.execute(
          trx,
        );
        return (
          await sql<{ n: number }>`select tarefas_limpar_motivos(
            array[${ana}::uuid], '{}'::uuid[]) as n`.execute(trx)
        ).rows[0]?.n;
      });
      expect(outraVez).toBe(0);
    });

    it("sem a pseudonimização, o motivo não se muda nem a linha se apaga (audit.append_only); a marca não deixa mudar mais nada", async () => {
      const cliente = await novoCliente("Beatriz");
      const enc = await novaEncomenda(cliente);
      const k = await casosDeUmaEncomenda(enc);
      await mudarPrazo("problema", k.problema);
      const recusado = async (
        consulta: ReturnType<typeof sql>,
        marca = false,
      ) => {
        let erro = "";
        try {
          await comComerciante(base.dono, c, async (trx) => {
            if (marca) {
              await sql`insert into pseudonimizacao_em_curso values (pg_current_xact_id())`.execute(
                trx,
              );
            }
            await consulta.execute(trx);
          });
        } catch (e) {
          erro = e instanceof Error ? e.message : String(e);
        }
        return erro;
      };
      for (const consulta of [
        sql`update atribuicao_rasto set motivo = '(pseudonimizado)'`,
        sql`update atribuicao_rasto set motivo = 'outro texto'`,
        sql`update atribuicao_rasto set motivo = null`,
        sql`delete from atribuicao_rasto`,
        sql`truncate atribuicao_rasto`,
      ]) {
        expect(await recusado(consulta)).toMatch(/audit\.append_only/);
      }
      // Com a marca: só o motivo, e só para o marcador.
      for (const consulta of [
        sql`update atribuicao_rasto set motivo = 'outro texto'`,
        sql`update atribuicao_rasto set motivo = null`,
        sql`update atribuicao_rasto set quem = 'outra pessoa'`,
        sql`update atribuicao_rasto set motivo = '(pseudonimizado)', quem = 'outra pessoa'`,
        sql`update atribuicao_rasto set motivo = '(pseudonimizado)', prazo_depois = now()`,
        sql`delete from atribuicao_rasto`,
        sql`truncate atribuicao_rasto`,
      ]) {
        expect(await recusado(consulta, true)).toMatch(/audit\.append_only/);
      }
      expect(await motivoDe(k.problema)).toContain(MOTIVO);
      // A API (a chave da loja) nem escreve na tabela.
      await expect(
        comComerciante(base.api, c, (trx) =>
          sql`update atribuicao_rasto set motivo = '(pseudonimizado)'`.execute(
            trx,
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it("limpar o motivo não cria eventos nem notificações (só se acrescenta uma linha com o INSERT)", async () => {
      const cliente = await novoCliente("Carla");
      const enc = await novaEncomenda(cliente);
      const k = await casosDeUmaEncomenda(enc);
      await mudarPrazo("documento_fiscal", k.documento);
      const contar = async () =>
        (
          await sql<{ e: number; n: number }>`
            select (select count(*)::int from evento_saida
                    where comerciante_id = ${c}::uuid and tipo like 'task.%') as e,
                   (select count(*)::int from notificacao
                    where comerciante_id = ${c}::uuid) as n`.execute(base.dono)
        ).rows[0];
      const antes = await contar();
      await pseudonimizar(cliente);
      const depois = await contar();
      expect(depois?.e).toBe(antes?.e);
      expect(depois?.n).toBe(antes?.n);
    });

    it("uma encomenda em curso: a mudança de prazo feita depois do pedido fica limpa quando a encomenda acaba", async () => {
      const cliente = await novoCliente("Diana");
      const enc = await novaEncomenda(cliente);
      const k = { problema: randomUUID() };
      await comoDono(async (t) => {
        await sql`insert into problema (id, comerciante_id, encomenda_id, tipo,
            descricao, estado, criado_por)
          values (${k.problema}, ${c}, ${enc}, 'chegou_danificado', 'partido',
            'aberto', 'teste')`.execute(t);
      });
      // Antes do pedido, um caso sem mudança nenhuma: nada a limpar.
      const resultado = await pseudonimizar(cliente);
      expect(resultado).toMatchObject({
        encomendas_limpas: 0,
        encomendas_por_acabar: 1,
        motivos_de_prazo_limpos: 0,
      });
      // Depois do pedido: uma mudança de prazo nova, com o motivo escrito.
      await mudarPrazo("problema", k.problema, "a Diana ligou do 912 345 678");
      expect(await motivoDe(k.problema)).toContain(
        "a Diana ligou do 912 345 678",
      );
      // Ainda em curso (problema aberto): a volta não limpa.
      expect((await correrApagamentosPendentes(base.api)).falhas).toEqual([]);
      expect(await motivoDe(k.problema)).toContain(
        "a Diana ligou do 912 345 678",
      );
      // Acaba: fecha-se o problema que a segurava.
      await comoDono(async (t) => {
        await sql`update problema set estado = 'fechado' where id = ${k.problema}`.execute(
          t,
        );
      });
      const volta = await correrApagamentosPendentes(base.api);
      expect(volta.falhas).toEqual([]);
      expect(volta.limpas).toBeGreaterThanOrEqual(1);
      expect(await motivoDe(k.problema)).toEqual([MARCADOR]);
      const { rows } = await sql<{ r: Json }>`
        select resultado as r from titular_pendente
        where comerciante_id = ${c}::uuid and encomenda_id = ${enc}::uuid`.execute(
        base.dono,
      );
      expect(rows[0]?.r).toMatchObject({ motivos_de_prazo_limpos: 1 });
    });

    it("os casos do titular: as nove filas, e a das ligações à faturação não tem titular", async () => {
      const cliente = await novoCliente("Elisa");
      const enc = await novaEncomenda(cliente);
      const k = await casosDeUmaEncomenda(enc);
      const { rows } = await comComerciante(base.dono, c, (trx) =>
        sql<{ fila: string; caso: string }>`
          select fila, caso::text as caso
          from tarefas_casos_do_titular(array[${cliente}::uuid])`.execute(trx),
      );
      // `livre_resolucao` tem dois pedidos (o pendente e o aceite).
      expect([...new Set(rows.map((r) => r.fila))].sort()).toEqual(
        FILAS_DA_ENCOMENDA(k)
          .map(([f]) => f)
          .sort(),
      );
      const filas = await sql<{ fila: string }>`
        select fila from tarefas_filas()`.execute(base.dono);
      const tratadas = new Set([
        ...rows.map((r) => r.fila),
        "duplicado_cliente",
        "pedido_titular",
        "ligacao_faturacao",
      ]);
      expect(filas.rows.every((f) => tratadas.has(f.fila))).toBe(true);
    });
  },
);
