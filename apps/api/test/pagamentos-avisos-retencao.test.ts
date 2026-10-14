import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarConta, noPagamentos } from "../src/pagamentos/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A retenção dos avisos sem pagamento (migração 0105; docs/26 §16; Q1 «a»:
// 90 dias). A função chama-a o programa eurolify-limpeza da VPS com o papel
// eurolify_limpeza; a API não a pode chamar nem mudar o corpo. O prazo
// testa-se dos dois lados: 91 dias passa a resumo, 89 fica.

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    return String((erro as { message?: unknown }).message);
  }
  return "sem erro";
}

const TELEFONE = '{"referencia":"999","telefone":"351#912345678","valor":12}';

describe.skipIf(URL_BASE === undefined)(
  "pagamentos: a retenção dos avisos sem pagamento (0105)",
  () => {
    let base: BaseDeTeste;
    let dono: Kysely<unknown>;
    let a: string;
    let b: string;
    let contaA: string;
    let contaB: string;
    const ids: Record<string, string> = {};
    const comercianteDe: Record<string, string> = {};

    /** No contexto de um comerciante, como o dono da base (o RLS forçado). */
    const comoDono = <T>(c: string, fn: (trx: Kysely<unknown>) => Promise<T>) =>
      dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${c}, true)`.execute(
          trx,
        );
        return fn(trx);
      });

    /**
     * Um aviso chegado há `dias` dias, sem pagamento. Escrito pelo dono da
     * base, como só os testes podem (a API grava sempre agora).
     */
    async function aviso(
      nome: string,
      c: string,
      conta: string,
      dias: number,
      resultado: string | null,
      corpo = TELEFONE,
    ) {
      const { rows } = await comoDono(c, (trx) =>
        sql<{ id: string }>`
          insert into aviso_pagamento
            (comerciante_id, conta_id, id_evento, corpo, assinatura_valida, resultado,
             recebido_em, processado_em)
          values (${c}::uuid, ${conta}::uuid, ${`ev:${nome}`}, ${corpo},
            ${resultado !== "assinatura_invalida"}, ${resultado},
            now() - make_interval(secs => ${dias * 86400}),
            ${resultado === null ? null : sql`now()`})
          returning id`.execute(trx),
      );
      ids[nome] = rows[0]?.id ?? "";
      comercianteDe[nome] = c;
    }

    async function diferenca(nome: string) {
      const c = comercianteDe[nome] ?? "";
      const { rows } = await comoDono(c, (trx) =>
        sql<{ id: string }>`
          insert into diferenca_pagamento (comerciante_id, aviso_id, motivo, prova)
          values (${c}::uuid, ${ids[nome]}::uuid, 'aviso_sem_pagamento',
            '{"referencia":"999"}')
          returning id`.execute(trx),
      );
      return rows[0]?.id ?? "";
    }

    const corpo = async (nome: string) =>
      (
        await comoDono(comercianteDe[nome] ?? "", (trx) =>
          sql<{ corpo: string }>`select corpo from aviso_pagamento
            where id = ${ids[nome]}::uuid`.execute(trx),
        )
      ).rows[0]?.corpo;

    const emAtraso = async () =>
      Number(
        (
          await sql<{ n: string }>`
            select pagamentos_avisos_em_atraso() as n`.execute(dono)
        ).rows[0]?.n,
      );

    const resumir = async () =>
      (
        await dono.transaction().execute(async (trx) => {
          await sql`set local role eurolify_limpeza`.execute(trx);
          return sql<{
            n: number;
          }>`select pagamentos_avisos_resumir() as n`.execute(trx);
        })
      ).rows[0]?.n;

    let diferencaAberta = "";
    let diferencaResolvida = "";

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      dono = base.dono;
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
      contaA = await noPagamentos(base.api as never, a, (trx) =>
        criarConta(trx, a, { prestador: "eupago", nome: "EuPago" }),
      );
      contaB = await noPagamentos(base.api as never, b, (trx) =>
        criarConta(trx, b, { prestador: "eupago", nome: "EuPago" }),
      );
      // Passou os 90 dias e o dia da limpeza: passam a resumo.
      await aviso("sem_pagamento_92", a, contaA, 92, "sem_pagamento");
      await aviso("erro_95", a, contaA, 95, "erro");
      await aviso("por_tratar_100", a, contaA, 100, null);
      // Passou os 90, ainda dentro do dia da limpeza: passa, sem atraso.
      await aviso("sem_pagamento_90_5", a, contaA, 90.5, "sem_pagamento");
      // Dentro dos 90: fica.
      await aviso("sem_pagamento_89", a, contaA, 89, "sem_pagamento");
      // Assinatura inválida: o corpo já está vazio.
      await aviso("invalido_120", a, contaA, 120, "assinatura_invalida", "");
      // Com uma diferença aberta: fica; com uma resolvida: passa.
      await aviso("com_aberta_120", a, contaA, 120, "sem_pagamento");
      await aviso("com_resolvida_120", a, contaA, 120, "sem_pagamento");
      // Um corpo que não é JSON (o prestador manda outra coisa).
      await aviso(
        "texto_100",
        a,
        contaA,
        100,
        "erro",
        "referencia=999&telefone=912345678",
      );
      // Já em resumo pelo apagamento do titular (a forma da 0102): não muda.
      await aviso(
        "ja_0102_100",
        a,
        contaA,
        100,
        "sem_pagamento",
        '{"resumo": "ab12cd34", "pseudonimizado": true}',
      );
      // Noutro comerciante, 200 dias: também passa.
      await aviso("outro_200", b, contaB, 200, "sem_pagamento");
      // Para o teste das recusas.
      await aviso("recusas_120", a, contaA, 120, "sem_pagamento");
      await aviso("recusas_89", a, contaA, 89, "sem_pagamento");
      // Com pagamento, 120 dias: fica (segue a encomenda). O pagamento não
      // existe: a linha entra sem as chaves estrangeiras (modo replica), só
      // para o gatilho ver um `pagamento_id` (revisão do #467, P2-4).
      const { rows } = await dono.transaction().execute(async (trx) => {
        await sql`set local session_replication_role = replica`.execute(trx);
        await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
          trx,
        );
        return sql<{ id: string }>`
          insert into aviso_pagamento
            (comerciante_id, conta_id, id_evento, corpo, assinatura_valida, resultado,
             pagamento_id, recebido_em, processado_em)
          values (${a}::uuid, ${contaA}::uuid, 'ev:com_pagamento_120', ${TELEFONE}, true,
            'aplicado', gen_random_uuid(), now() - interval '120 days', now())
          returning id`.execute(trx);
      });
      ids["com_pagamento_120"] = rows[0]?.id ?? "";
      comercianteDe["com_pagamento_120"] = a;
      // No outro comerciante, uma diferença aberta segura o aviso dele.
      await aviso("outro_segurado_200", b, contaB, 200, "sem_pagamento");
      await diferenca("outro_segurado_200");
      diferencaAberta = await diferenca("com_aberta_120");
      diferencaResolvida = await diferenca("com_resolvida_120");
      await comoDono(a, (trx) =>
        sql`update diferenca_pagamento set estado = 'resolvida',
            resolucao = 'não é nosso', resolvida_por = 'pessoa:per_teste'
          where id = ${diferencaResolvida}::uuid`.execute(trx),
      );
    }, 120_000);

    afterAll(async () => {
      await base.fechar();
    });

    it("só a limpeza chama as funções; a API só a da marca; a limpeza não lê a tabela", async () => {
      const { rows } = await sql<{
        nome: string;
        publico: boolean;
        api: boolean;
        limpeza: boolean;
      }>`
        select p.proname as nome,
               exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as publico,
               has_function_privilege('eurolify_api', p.oid, 'EXECUTE') as api,
               has_function_privilege('eurolify_limpeza', p.oid, 'EXECUTE') as limpeza
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('aviso_pagamento_em_resumo', 'aviso_pagamento_resumo',
                            'aviso_pagamento_resumivel', 'pagamentos_avisos_comerciantes',
                            'pagamentos_avisos_resumir', 'pagamentos_avisos_em_atraso',
                            'pagamentos_avisos_resumo_em_curso')
        order by 1`.execute(dono);
      const so = (api: boolean, limpeza: boolean) => ({
        publico: false,
        api,
        limpeza,
      });
      expect(rows).toEqual([
        { nome: "aviso_pagamento_em_resumo", ...so(false, false) },
        { nome: "aviso_pagamento_resumivel", ...so(false, false) },
        { nome: "aviso_pagamento_resumo", ...so(false, false) },
        { nome: "pagamentos_avisos_comerciantes", ...so(false, false) },
        { nome: "pagamentos_avisos_em_atraso", ...so(false, true) },
        { nome: "pagamentos_avisos_resumir", ...so(false, true) },
        { nome: "pagamentos_avisos_resumo_em_curso", ...so(true, false) },
      ]);
      expect(
        await mensagemDoErro(
          sql`select pagamentos_avisos_resumir()`.execute(base.api),
        ),
      ).toMatch(/permission denied/);
      expect(
        await mensagemDoErro(
          dono.transaction().execute(async (trx) => {
            await sql`set local role eurolify_limpeza`.execute(trx);
            await sql`select count(*) from aviso_pagamento`.execute(trx);
          }),
        ),
      ).toMatch(/permission denied/);
    });

    it("sem a marca, ninguém muda o corpo: nem a API, nem o dono da base", async () => {
      const resumoCerto = async () =>
        (
          await comoDono(a, (trx) =>
            sql<{
              r: string;
            }>`select aviso_pagamento_resumo(${a}::uuid, ${TELEFONE}) as r`.execute(
              trx,
            ),
          )
        ).rows[0]?.r ?? "";
      const r = await resumoCerto();
      expect(
        await mensagemDoErro(
          comoDono(a, (trx) =>
            sql`update aviso_pagamento set corpo = ${r}
              where id = ${ids["recusas_120"]}::uuid`.execute(trx),
          ),
        ),
      ).toMatch(/payments\.immutable/);
      // A API nem tem o UPDATE do corpo (só das colunas do tratamento).
      expect(
        await mensagemDoErro(
          noPagamentos(base.api as never, a, (trx) =>
            sql`update aviso_pagamento set corpo = ${r}
              where id = ${ids["recusas_120"]}::uuid`.execute(trx),
          ),
        ),
      ).toMatch(/permission denied/);
      expect(await corpo("recusas_120")).toBe(TELEFONE);
    });

    it("com a marca, só o resumo certo, só no corpo e só no que a regra deixa", async () => {
      // A marca só vale para o dono das tabelas (clientes_dono_a_escrever),
      // que nos testes não é quem liga: escreve-se com o papel dele, como a
      // função da limpeza escreve.
      const comMarca = (fn: (trx: Kysely<unknown>) => Promise<unknown>) =>
        comoDono(a, async (trx) => {
          const { rows } = await sql<{ dono: string }>`
            select pg_get_userbyid(relowner) as dono from pg_class
            where oid = 'public.cliente'::regclass`.execute(trx);
          await sql`set local role ${sql.id(rows[0]?.dono ?? "")}`.execute(trx);
          await sql`insert into aviso_resumo_em_curso values (pg_current_xact_id())`.execute(
            trx,
          );
          const r = await fn(trx);
          // Como a função: a marca sai no fim.
          await sql`delete from aviso_resumo_em_curso
            where transaccao = pg_current_xact_id()`.execute(trx);
          return r;
        });
      // Outro texto que não o resumo.
      expect(
        await mensagemDoErro(
          comMarca((trx) =>
            sql`update aviso_pagamento set corpo = '{"pseudonimizado": true}'
              where id = ${ids["recusas_120"]}::uuid`.execute(trx),
          ),
        ),
      ).toMatch(/payments\.immutable: o corpo só passa ao resumo dele/);
      // O resumo certo, mas também outra coluna.
      expect(
        await mensagemDoErro(
          comMarca((trx) =>
            sql`update aviso_pagamento
              set corpo = aviso_pagamento_resumo(comerciante_id, corpo), erro = 'x'
              where id = ${ids["recusas_120"]}::uuid`.execute(trx),
          ),
        ),
      ).toMatch(/payments\.immutable: o prazo dos avisos só muda o corpo/);
      // O resumo certo, dentro dos 90 dias.
      expect(
        await mensagemDoErro(
          comMarca((trx) =>
            sql`update aviso_pagamento set corpo = aviso_pagamento_resumo(comerciante_id, corpo)
              where id = ${ids["recusas_89"]}::uuid`.execute(trx),
          ),
        ),
      ).toMatch(/payments\.immutable: este aviso não passa a resumo/);
      // O resumo certo, com uma diferença aberta.
      expect(
        await mensagemDoErro(
          comMarca((trx) =>
            sql`update aviso_pagamento set corpo = aviso_pagamento_resumo(comerciante_id, corpo)
              where id = ${ids["com_aberta_120"]}::uuid`.execute(trx),
          ),
        ),
      ).toMatch(/payments\.immutable: este aviso não passa a resumo/);
      // E o que a regra deixa passa (prova de que as recusas não são todas).
      await aviso("manual_120", a, contaA, 120, "sem_pagamento");
      await comMarca((trx) =>
        sql`update aviso_pagamento set corpo = aviso_pagamento_resumo(comerciante_id, corpo)
          where id = ${ids["manual_120"]}::uuid`.execute(trx),
      );
      expect(await corpo("manual_120")).not.toContain("912345678");
      // A API com a marca posta não a vê: a tabela é só do dono.
      expect(
        await mensagemDoErro(
          noPagamentos(base.api as never, a, (trx) =>
            sql`insert into aviso_resumo_em_curso values (pg_current_xact_id())`.execute(
              trx,
            ),
          ),
        ),
      ).toMatch(/permission denied/);
      // Com pagamento, o gatilho recusa (segue a encomenda).
      expect(
        await mensagemDoErro(
          comMarca((trx) =>
            sql`update aviso_pagamento set corpo = aviso_pagamento_resumo(comerciante_id, corpo)
              where id = ${ids["com_pagamento_120"]}::uuid`.execute(trx),
          ),
        ),
      ).toMatch(/payments\.immutable: este aviso não passa a resumo/);
      expect(await corpo("com_pagamento_120")).toBe(TELEFONE);
      expect(await corpo("recusas_120")).toBe(TELEFONE);
      expect(await corpo("recusas_89")).toBe(TELEFONE);
    });

    it("o resumo de um corpo já em resumo é reconhecido pelo conteúdo, não pelo início", async () => {
      const { rows } = await comoDono(a, (trx) =>
        sql<{
          r0102: boolean;
          prazo: boolean;
          texto: boolean;
          vazio: boolean;
          outro: boolean;
        }>`
          select aviso_pagamento_em_resumo('{"resumo": "ab12cd34", "pseudonimizado": true}') as r0102,
                 aviso_pagamento_em_resumo(aviso_pagamento_resumo(${a}::uuid, 'x')) as prazo,
                 aviso_pagamento_em_resumo('referencia=1') as texto,
                 aviso_pagamento_em_resumo('{') as vazio,
                 aviso_pagamento_em_resumo('{"pseudonimizado": true, "resumo": "a", "telefone": "9"}') as outro`.execute(
          trx,
        ),
      );
      expect(rows[0]).toEqual({
        r0102: true,
        prazo: true,
        texto: false,
        vazio: false,
        outro: false,
      });
    });

    it("a limpeza passa a resumo o que passou os 90 dias, de todos os comerciantes, e a verificação deixa de avisar", async () => {
      // Antes: os que passaram os 90 dias e o dia da limpeza, sem diferença
      // aberta nem resumo: 92, 95, 100, 100 (texto), 120 (resolvida), 120
      // (recusas), 200 (outro).
      expect(await emAtraso()).toBe(7);
      const contexto = await dono.transaction().execute(async (trx) => {
        // O contexto de quem chama volta como estava.
        await sql`select set_config('eurolify.comerciante', 'antes', true)`.execute(
          trx,
        );
        await sql`set local role eurolify_limpeza`.execute(trx);
        const { rows } = await sql<{ n: number }>`
          select pagamentos_avisos_resumir() as n`.execute(trx);
        expect(rows[0]?.n).toBe(8);
        const c = await sql<{ c: string }>`
          select current_setting('eurolify.comerciante') as c`.execute(trx);
        // A marca saiu no fim da função.
        await sql`reset role`.execute(trx);
        const m = await sql<{ n: string }>`
          select count(*) as n from aviso_resumo_em_curso`.execute(trx);
        expect(Number(m.rows[0]?.n)).toBe(0);
        return c.rows[0]?.c;
      });
      expect(contexto).toBe("antes");
      for (const nome of [
        "sem_pagamento_92",
        "erro_95",
        "por_tratar_100",
        "sem_pagamento_90_5",
        "com_resolvida_120",
        "texto_100",
        "recusas_120",
        "outro_200",
      ]) {
        const c = await corpo(nome);
        expect(c, nome).not.toContain("912345678");
        const j = JSON.parse(c ?? "{}") as Record<string, unknown>;
        expect(Object.keys(j).sort(), nome).toEqual([
          "motivo",
          "pseudonimizado",
          "resumo",
        ]);
        expect(j["motivo"], nome).toBe("prazo");
        expect(j["resumo"], nome).toMatch(/^[0-9a-f]{8}$/);
      }
      expect(await corpo("sem_pagamento_89")).toBe(TELEFONE);
      expect(await corpo("recusas_89")).toBe(TELEFONE);
      expect(await corpo("com_aberta_120")).toBe(TELEFONE);
      expect(await corpo("com_pagamento_120")).toBe(TELEFONE);
      expect(await corpo("outro_segurado_200")).toBe(TELEFONE);
      expect(await corpo("invalido_120")).toBe("");
      expect(await corpo("ja_0102_100")).toBe(
        '{"resumo": "ab12cd34", "pseudonimizado": true}',
      );
      expect(await emAtraso()).toBe(0);
      // Outra vez: nada a fazer.
      expect(await resumir()).toBe(0);
    });

    it("o resumo é o da 0102 para o mesmo corpo (a mesma chave do rasto)", async () => {
      const { rows } = await comoDono(a, (trx) =>
        sql<{
          r: string;
        }>`select rasto_resumo(${a}::uuid, 'aviso_pagamento.corpo',
            to_jsonb(${TELEFONE}::text)) as r`.execute(trx),
      );
      const j = JSON.parse((await corpo("sem_pagamento_92")) ?? "{}") as {
        resumo?: string;
      };
      expect(j.resumo).toBe(rows[0]?.r);
    });

    it("um reenvio do mesmo evento depois do resumo continua repetido, e um aviso com erro ainda se marca", async () => {
      const { rows } = await comoDono(a, (trx) =>
        sql<{ id: string }>`
          insert into aviso_pagamento (comerciante_id, conta_id, id_evento, corpo, assinatura_valida)
          values (${a}::uuid, ${contaA}::uuid, 'ev:sem_pagamento_92', ${TELEFONE}, true)
          on conflict (conta_id, id_evento) do nothing
          returning id`.execute(trx),
      );
      expect(rows).toEqual([]);
      // O erro de um aviso em resumo pode voltar a ser tratado (o reenvio
      // traz o corpo de novo; aplicarAviso usa o recebido).
      await noPagamentos(base.api as never, a, (trx) =>
        sql`update aviso_pagamento set erro = 'outra vez', processado_em = now()
          where id = ${ids["erro_95"]}::uuid`.execute(trx),
      );
      expect(await corpo("erro_95")).not.toContain("912345678");
    });

    it("um aviso preso por outra transacção fica para a corrida seguinte, sem fazer falhar a limpeza", async () => {
      await aviso("preso_120", a, contaA, 120, "erro");
      // Outra transacção (um reenvio a ser aplicado) segura a linha.
      let soltar = () => {};
      const solto = new Promise<void>((r) => {
        soltar = r;
      });
      let preso = () => {};
      const estaPreso = new Promise<void>((r) => {
        preso = r;
      });
      const outra = comoDono(a, async (trx) => {
        await sql`select id from aviso_pagamento where id = ${ids["preso_120"]}::uuid
          for update`.execute(trx);
        preso();
        await solto;
      });
      await estaPreso;
      try {
        expect(await resumir()).toBe(0);
      } finally {
        soltar();
        await outra;
      }
      expect(await corpo("preso_120")).toBe(TELEFONE);
      expect(await resumir()).toBe(1);
      expect(await corpo("preso_120")).not.toContain("912345678");
    });

    it("a diferença resolvida depois do prazo deixa o aviso passar na limpeza seguinte", async () => {
      await comoDono(a, (trx) =>
        sql`update diferenca_pagamento set estado = 'resolvida',
            resolucao = 'não é nosso', resolvida_por = 'pessoa:per_teste'
          where id = ${diferencaAberta}::uuid`.execute(trx),
      );
      expect(await emAtraso()).toBe(1);
      expect(await resumir()).toBe(1);
      expect(await corpo("com_aberta_120")).not.toContain("912345678");
    });
  },
);
