import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BaseDados } from "../src/base/esquema.js";
import {
  comComerciante,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { correrApagamentosPendentes } from "../src/clientes/titular-fila.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// O texto da resolução de uma diferença de pagamento limpa-se no apagamento
// do titular (docs/23 §15.1, grupo C, e §15.2; migração 0104). Ex.: a Ana
// pede o apagamento; a resolução «falei com a Ana Silva» numa diferença do
// pagamento da encomenda dela passa a «(pseudonimizado)»; a de outro cliente e
// o resto da linha (estado, resolvida_por, resolvida_em) ficam como estavam.
// A diferença resolvida não muda (0044): a guarda só se abre, para a coluna
// `resolucao` e para o marcador, dentro da pseudonimização.

type Json = Record<string, unknown>;
const MARCADOR = "(pseudonimizado)";
const TEXTO = "falei com a Ana Silva, ligou do 912 345 678";
const TABELAS = [
  "cliente",
  "encomenda",
  "pagamento",
  "diferenca_pagamento",
  "aviso_pagamento",
  "problema",
];

describe.skipIf(URL_BASE === undefined)(
  "A resolução das diferenças de pagamento e o apagamento do titular",
  () => {
    let base: BaseDeTeste;
    let c = "";

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
      c = await registarComerciante(base.api, {
        nome: "Loja A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
    }, 60_000);

    afterAll(async () => {
      await base.fechar();
    });

    const novoCliente = async (nome: string, loja = c) => {
      const id = randomUUID();
      await comoDono(async (t) => {
        await sql`insert into cliente (id, comerciante_id, nome)
          values (${id}, ${loja}, ${nome})`.execute(t);
      });
      return id;
    };

    const novaEncomenda = async (
      cliente: string,
      estado = "concluida",
      loja = c,
    ) => {
      const id = randomUUID();
      await comoDono(async (t) => {
        await sql`insert into encomenda (id, comerciante_id, loja_id, canal_id,
            mercado_id, entidade_legal_id, sessao_id, cliente_id, perfil_id,
            perfil_copia, contacto, entrega, finalidade, moeda, preco_inclui_iva,
            lingua, total_base, total_iva, total, portes, metodo_entrega,
            metodo_pagamento, aceitacoes, criada_por, estado)
          values (${id}, ${loja}, gen_random_uuid(), gen_random_uuid(),
            gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), ${cliente},
            gen_random_uuid(), '{}', '{"email": "ana@exemplo.pt"}', '{}',
            'consumo', 'EUR', true, 'pt', 1000, 230, 1230, '{}', '{}', 'mb_way',
            '{}', 'teste:resolucao', ${estado})`.execute(t);
      });
      return id;
    };

    /** Um pagamento capturado da encomenda (não a segura aberta). */
    const novoPagamento = async (enc: string, loja = c) => {
      const id = randomUUID();
      await comoDono(async (t) => {
        await sql`insert into pagamento (id, comerciante_id, encomenda_id,
            conta_id, prestador, metodo, modo, montante, moeda, referencia,
            expira_em, estado)
          values (${id}, ${loja}, ${enc}, gen_random_uuid(), 'eupago',
            'mb_way', 'teste', 1230, 'EUR', ${randomUUID().replaceAll("-", "")},
            now(), 'capturado')`.execute(t);
      });
      return id;
    };

    /** Uma diferença resolvida por uma pessoa, com o texto escrito. */
    const diferencaResolvida = async (
      pagamento: string | null,
      resolucao = TEXTO,
      loja = c,
    ) => {
      const id = randomUUID();
      await comoDono(async (t) => {
        await sql`insert into diferenca_pagamento (id, comerciante_id,
            pagamento_id, motivo, estado, resolucao, resolvida_por, resolvida_em)
          values (${id}, ${loja}, ${pagamento},
            ${pagamento === null ? "aviso_sem_pagamento" : "montante_diferente"},
            'resolvida', ${resolucao}, 'pessoa:per_teste',
            '2026-10-01T10:00:00Z')`.execute(t);
      });
      return id;
    };

    const diferencaAberta = async (pagamento: string) => {
      const id = randomUUID();
      await comoDono(async (t) => {
        await sql`insert into diferenca_pagamento (id, comerciante_id,
            pagamento_id, motivo)
          values (${id}, ${c}, ${pagamento}, 'pago_depois_de_cancelada')`.execute(
          t,
        );
      });
      return id;
    };

    /** A linha inteira de uma diferença. */
    const linha = async (id: string) =>
      (
        await sql<{ l: Json }>`
          select to_jsonb(d) as l from diferenca_pagamento d
          where d.id = ${id}::uuid`.execute(base.dono)
      ).rows[0]?.l ?? {};

    const pseudonimizar = (cliente: string, loja = c) =>
      comComerciante(base.dono, loja, async (trx) => {
        await sql`select set_config('eurolify.quem', 'pessoa:per_teste', true)`.execute(
          trx,
        );
        return (
          await sql<{ r: Json }>`select cliente_pseudonimizar(${cliente}::uuid,
            ${`pseudonimizar cus_${cliente}`}, 'teste') as r`.execute(trx)
        ).rows[0]?.r;
      });

    /**
     * Passa a transacção ao dono das tabelas, que é quem os gatilhos deixam
     * limpar (`clientes_dono_a_escrever`, 0049): a ligação de teste é um
     * superutilizador, que não é o dono.
     */
    const comoDonoDasTabelas = async (trx: Transaction<BaseDados>) => {
      const { rows } = await sql<{ dono: string }>`
        select pg_catalog.pg_get_userbyid(c.relowner) as dono
        from pg_catalog.pg_class c
        where c.oid = 'public.cliente'::regclass`.execute(trx);
      await sql`select set_config('role', ${rows[0]?.dono ?? ""}, true)`.execute(
        trx,
      );
    };

    /** Chama a limpeza de uma encomenda, com a marca posta (como o dono). */
    const limparEncomenda = (enc: string, loja = c) =>
      comComerciante(base.dono, loja, async (trx) => {
        await sql`insert into pseudonimizacao_em_curso values (pg_current_xact_id())`.execute(
          trx,
        );
        await comoDonoDasTabelas(trx);
        return (
          await sql<{ r: Json | null }>`select titular_limpar_encomenda(
            ${enc}::uuid) as r`.execute(trx)
        ).rows[0]?.r;
      });

    it("a resolução fica «(pseudonimizado)» nas diferenças da encomenda acabada do titular; a de outro cliente e o resto da linha ficam como estavam", async () => {
      const ana = await novoCliente("Ana Silva");
      const rita = await novoCliente("Rita Costa");
      const encAna = await novaEncomenda(ana);
      const encRita = await novaEncomenda(rita);
      const pagAna = await novoPagamento(encAna);
      const pagRita = await novoPagamento(encRita);
      const d1 = await diferencaResolvida(pagAna);
      const d2 = await diferencaResolvida(pagAna, "reembolsei a diferença");
      const dRita = await diferencaResolvida(pagRita, "falei com a Rita Costa");
      // Sem pagamento: não tem encomenda nem titular, fica como está.
      const dSem = await diferencaResolvida(null, "aviso de um desconhecido");
      const antes = {
        d1: await linha(d1),
        d2: await linha(d2),
        dRita: await linha(dRita),
        dSem: await linha(dSem),
      };

      const resultado = await pseudonimizar(ana);
      expect(resultado).toMatchObject({ encomendas_limpas: 1 });
      expect(JSON.stringify(resultado)).not.toContain("Ana Silva");

      // As duas da Ana: só a `resolucao` mudou; estado, quem e quando iguais.
      for (const [id, a] of [
        [d1, antes.d1],
        [d2, antes.d2],
      ] as const) {
        const depois = await linha(id);
        expect(depois["resolucao"]).toBe(MARCADOR);
        expect(depois["estado"]).toBe("resolvida");
        expect(depois["resolvida_por"]).toBe("pessoa:per_teste");
        expect({ ...depois, resolucao: null }).toEqual({
          ...a,
          resolucao: null,
        });
      }
      // A do outro cliente e a sem pagamento: iguais, linha inteira.
      expect(await linha(dRita)).toEqual(antes.dRita);
      expect(await linha(dSem)).toEqual(antes.dSem);
      expect((await linha(dRita))["resolucao"]).toBe("falei com a Rita Costa");
    });

    it("a contagem: resolucoes_de_diferencas conta as resolvidas da encomenda, e outra volta não acha nada", async () => {
      const cliente = await novoCliente("Beatriz");
      const enc = await novaEncomenda(cliente);
      const pag = await novoPagamento(enc);
      await diferencaResolvida(pag);
      await diferencaResolvida(pag, "ligou a Beatriz");
      // Uma sem pagamento e uma de outra encomenda não contam.
      await diferencaResolvida(null);
      const outra = await novaEncomenda(await novoCliente("Carla"));
      await diferencaResolvida(await novoPagamento(outra));

      expect(await limparEncomenda(enc)).toMatchObject({
        resolucoes_de_diferencas: 2,
      });
      expect(await limparEncomenda(enc)).toMatchObject({
        resolucoes_de_diferencas: 0,
      });
    });

    it("uma encomenda por acabar fica como está e limpa-se quando acaba (correrApagamentosPendentes)", async () => {
      const diana = await novoCliente("Diana");
      const enc = await novaEncomenda(diana, "concluida");
      const pag = await novoPagamento(enc);
      const resolvida = await diferencaResolvida(pag, "a Diana ligou do 912");
      // Uma diferença aberta segura a encomenda: ainda não acabou.
      const aberta = await diferencaAberta(pag);

      expect(await pseudonimizar(diana)).toMatchObject({
        encomendas_limpas: 0,
        encomendas_por_acabar: 1,
      });
      expect((await linha(resolvida))["resolucao"]).toBe(
        "a Diana ligou do 912",
      );
      expect((await correrApagamentosPendentes(base.api)).falhas).toEqual([]);
      expect((await linha(resolvida))["resolucao"]).toBe(
        "a Diana ligou do 912",
      );

      // Uma pessoa resolve a aberta, com um texto novo: a encomenda acaba.
      await comComerciante(base.dono, c, async (trx) => {
        await sql`update diferenca_pagamento set estado = 'resolvida',
            resolucao = 'a Diana pediu o dinheiro de volta',
            resolvida_por = 'pessoa:per_teste', resolvida_em = now()
          where id = ${aberta}::uuid`.execute(trx);
      });
      expect((await linha(aberta))["resolucao"]).toBe(
        "a Diana pediu o dinheiro de volta",
      );
      const volta = await correrApagamentosPendentes(base.api);
      expect(volta.falhas).toEqual([]);
      expect(volta.limpas).toBeGreaterThanOrEqual(1);
      expect((await linha(resolvida))["resolucao"]).toBe(MARCADOR);
      expect((await linha(aberta))["resolucao"]).toBe(MARCADOR);
      const { rows } = await sql<{ r: Json }>`
        select resultado as r from titular_pendente
        where comerciante_id = ${c}::uuid and encomenda_id = ${enc}::uuid`.execute(
        base.dono,
      );
      expect(rows[0]?.r).toMatchObject({ resolucoes_de_diferencas: 2 });
    });

    it("fora da pseudonimização, uma diferença resolvida não muda nem se apaga; com a marca, só a resolução e só para o marcador", async () => {
      const cliente = await novoCliente("Elisa");
      const enc = await novaEncomenda(cliente);
      const pag = await novoPagamento(enc);
      const id = await diferencaResolvida(pag);
      const antes = await linha(id);

      const recusado = async (
        consulta: ReturnType<typeof sql>,
        marca = false,
        como: "dono" | "api" = "dono",
      ) => {
        let erro = "";
        try {
          await comComerciante(
            como === "dono" ? base.dono : base.api,
            c,
            async (trx) => {
              if (marca) {
                await sql`insert into pseudonimizacao_em_curso values (pg_current_xact_id())`.execute(
                  trx,
                );
                // O dono das tabelas, como a função do apagamento: sem isto
                // a recusa seria por não ser o dono, e não pela regra.
                if (como === "dono") await comoDonoDasTabelas(trx);
              }
              await consulta.execute(trx);
            },
          );
        } catch (e) {
          erro = e instanceof Error ? e.message : String(e);
        }
        return erro;
      };
      const marcador = sql`update diferenca_pagamento set resolucao = '(pseudonimizado)'
        where id = ${id}::uuid`;
      // Sem a marca: nem o marcador, nem outro texto, nem apagar; nem a API.
      for (const consulta of [
        marcador,
        sql`update diferenca_pagamento set resolucao = 'outro texto' where id = ${id}::uuid`,
        sql`delete from diferenca_pagamento where id = ${id}::uuid`,
      ]) {
        expect(await recusado(consulta)).toMatch(/payments\.immutable/);
      }
      expect(await recusado(marcador, false, "api")).toMatch(
        /payments\.immutable/,
      );
      expect(
        await recusado(
          sql`delete from diferenca_pagamento where id = ${id}::uuid`,
          false,
          "api",
        ),
      ).not.toBe("");
      // Com a marca: só a resolução, só para o marcador.
      for (const consulta of [
        sql`update diferenca_pagamento set resolucao = 'outro texto' where id = ${id}::uuid`,
        sql`update diferenca_pagamento set resolucao = null where id = ${id}::uuid`,
        sql`update diferenca_pagamento set resolvida_por = 'pessoa:outra' where id = ${id}::uuid`,
        sql`update diferenca_pagamento set resolucao = '(pseudonimizado)', resolvida_por = 'pessoa:outra' where id = ${id}::uuid`,
        sql`update diferenca_pagamento set resolucao = '(pseudonimizado)', resolvida_em = now() where id = ${id}::uuid`,
        sql`update diferenca_pagamento set resolucao = '(pseudonimizado)', prova = '{"x": 1}' where id = ${id}::uuid`,
        sql`update diferenca_pagamento set resolucao = '(pseudonimizado)', motivo = 'incerto' where id = ${id}::uuid`,
        sql`update diferenca_pagamento set resolucao = '(pseudonimizado)', estado = 'aberta' where id = ${id}::uuid`,
        sql`delete from diferenca_pagamento where id = ${id}::uuid`,
      ]) {
        expect(await recusado(consulta, true)).toMatch(/payments\.immutable/);
      }
      // A marca não abre a API: não é o dono.
      expect(await recusado(marcador, true, "api")).not.toBe("");
      expect(await linha(id)).toEqual(antes);

      // Com a marca, o marcador passa — e só ele.
      await comComerciante(base.dono, c, async (trx) => {
        await sql`insert into pseudonimizacao_em_curso values (pg_current_xact_id())`.execute(
          trx,
        );
        await comoDonoDasTabelas(trx);
        await marcador.execute(trx);
      });
      const depois = await linha(id);
      expect(depois["resolucao"]).toBe(MARCADOR);
      expect({ ...depois, resolucao: null }).toEqual({
        ...antes,
        resolucao: null,
      });
    });

    it("uma diferença aberta continua a resolver-se como antes (a guarda da 0044 não mudou)", async () => {
      const enc = await novaEncomenda(await novoCliente("Filipa"));
      const aberta = await diferencaAberta(await novoPagamento(enc));
      // Um processo automático não a resolve.
      await expect(
        comComerciante(base.dono, c, (trx) =>
          sql`update diferenca_pagamento set estado = 'resolvida',
              resolucao = 'auto', resolvida_por = 'sistema:pagamentos',
              resolvida_em = now() where id = ${aberta}::uuid`.execute(trx),
        ),
      ).rejects.toThrow(/issue_needs_person/);
      // Uma pessoa resolve-a.
      await comComerciante(base.dono, c, (trx) =>
        sql`update diferenca_pagamento set estado = 'resolvida',
            resolucao = 'resolvida a mão', resolvida_por = 'pessoa:per_teste'
          where id = ${aberta}::uuid`.execute(trx),
      );
      expect((await linha(aberta))["estado"]).toBe("resolvida");
    });

    it("limpar a resolução não cria eventos nem notificações", async () => {
      const cliente = await novoCliente("Graça");
      const enc = await novaEncomenda(cliente);
      await diferencaResolvida(await novoPagamento(enc));
      const contar = async () =>
        (
          await sql<{ e: number; n: number }>`
            select (select count(*)::int from evento_saida
                    where comerciante_id = ${c}::uuid
                      and tipo not like 'customer.%') as e,
                   (select count(*)::int from notificacao
                    where comerciante_id = ${c}::uuid) as n`.execute(base.dono)
        ).rows[0];
      const antes = await contar();
      await pseudonimizar(cliente);
      expect(await contar()).toEqual(antes);
    });

    it("limpar a mesma encomenda duas vezes deixa o corpo do aviso igual ao da primeira (o filtro reconhece o corpo já limpo)", async () => {
      const enc = await novaEncomenda(await novoCliente("Helena"));
      const pag = await novoPagamento(enc);
      const avisos = [
        '{"tipo":"pago","telefone":"912345678"}',
        // Não é JSON: o filtro não pode rebentar.
        "chave=valor&telefone=912345678",
      ];
      for (const corpo of avisos) {
        await comoDono(async (t) => {
          await sql`insert into aviso_pagamento (comerciante_id, conta_id,
              id_evento, corpo, assinatura_valida, pagamento_id)
            values (${c}, gen_random_uuid(), ${randomUUID()}, ${corpo}, true,
              ${pag})`.execute(t);
        });
      }
      const corpos = async () =>
        (
          await sql<{ corpo: string }>`
            select corpo from aviso_pagamento
            where pagamento_id = ${pag}::uuid order by id`.execute(base.dono)
        ).rows.map((r) => r.corpo);
      expect(await limparEncomenda(enc)).toMatchObject({
        avisos_de_pagamento: 2,
      });
      const primeira = await corpos();
      for (const [i, corpo] of primeira.entries()) {
        expect(corpo).toMatch(
          /^\{"resumo": "[0-9a-f]{8}", "pseudonimizado": true\}$/,
        );
        expect(corpo, String(i)).not.toContain("912345678");
      }
      expect(await limparEncomenda(enc)).toMatchObject({
        avisos_de_pagamento: 0,
      });
      expect(await corpos()).toEqual(primeira);
    });

    it("outro comerciante fica intacto: a limpeza numa loja não toca nas diferenças da outra, nem com os ids dela", async () => {
      const b = await registarComerciante(base.api, {
        nome: "Loja B",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const clienteB = await novoCliente("Ana Silva", b);
      const encB = await novaEncomenda(clienteB, "concluida", b);
      const dB = await diferencaResolvida(
        await novoPagamento(encB, b),
        TEXTO,
        b,
      );

      // Na loja A, limpar a encomenda da loja B não existe.
      await expect(limparEncomenda(encB, c)).rejects.toThrow(
        /orders\.not_found/,
      );
      // Um apagamento na loja A, de uma Ana igual, não toca na da loja B.
      const clienteA = await novoCliente("Ana Silva");
      const encA = await novaEncomenda(clienteA);
      const dA = await diferencaResolvida(await novoPagamento(encA));
      await pseudonimizar(clienteA);
      expect((await linha(dA))["resolucao"]).toBe(MARCADOR);
      expect((await linha(dB))["resolucao"]).toBe(TEXTO);
      // E o apagamento da loja B limpa a dela.
      await pseudonimizar(clienteB, b);
      expect((await linha(dB))["resolucao"]).toBe(MARCADOR);
    });
  },
);
