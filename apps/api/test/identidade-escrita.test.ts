import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { Writable } from "node:stream";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { serializadores } from "../src/base/registo.js";
import {
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  mudarEstado,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  FORMATO_SEGREDO,
  gerarChave,
  resumoDe,
} from "../src/identidade/chaves.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import type { BaseDados } from "../src/base/esquema.js";

// Criar e revogar chaves pela API, e a idempotência das escritas (migração
// 0012; docs/19 §6.1 e §9, T5, T8, T9, T10 e T11; docs/18 §4). Contra o
// PostgreSQL 18 verdadeiro, com o eurolify_api.

const ENTIDADE = {
  denominacao: "Exemplo, Lda.",
  forma_juridica: "sociedade por quotas",
  pais: "PT",
  numero_fiscal: "123456789",
  morada_linha: "Rua de Teste, 1",
  morada_codigo_postal: "1000-001",
  morada_localidade: "Lisboa",
};

interface ChaveCriada {
  id: string;
  segredo: string;
  ambitos: string[];
  criada_por: string;
  tipo: string;
  loja: string | null;
}

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    return String((erro as { message?: unknown }).message);
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)(
  "criar e revogar chaves pela API (0012)",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let registo: string[];
    let a: string;
    let b: string;
    let lojaA: string;
    let lojaB: string;
    /** keys:write e catalog:read, do comerciante A. */
    let gestora: { id: string; segredo: string };
    /** Só catalog:read, do comerciante A. */
    let leitora: { id: string; segredo: string };
    let deB: { id: string; segredo: string };
    let comoDono: () => Kysely<BaseDados>;

    const criar = (
      segredo: string,
      corpo: unknown,
      idempotencia: string | null = randomUUID(),
    ) =>
      app.inject({
        method: "POST",
        url: "/keys",
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(idempotencia === null ? {} : { "idempotency-key": idempotencia }),
        },
        payload: corpo as Record<string, unknown>,
      });

    const revogar = (
      segredo: string,
      id: string,
      idempotencia: string | null = randomUUID(),
    ) =>
      app.inject({
        method: "POST",
        url: `/keys/${id}/revoke`,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(idempotencia === null ? {} : { "idempotency-key": idempotencia }),
        },
      });

    const eu = (segredo: string) =>
      app.inject({
        method: "GET",
        url: "/me",
        headers: { authorization: `Bearer ${segredo}` },
      });

    const contarChaves = async (comerciante: string) => {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from chave_api
        where comerciante_id = ${comerciante}::uuid`.execute(base.dono);
      return rows[0]?.n ?? 0;
    };

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      comoDono = () => base.dono;
      registo = [];
      const destino = new Writable({
        write(pedaco: Buffer, _codificacao, feito) {
          registo.push(pedaco.toString());
          feito();
        },
      });
      app = criarApp(
        {
          logger: {
            level: "info",
            stream: destino,
            serializers: serializadores,
          },
        },
        undefined,
        base.api,
      );
      const novo = { nome: "Loja", lingua: "pt", fuso: "Europe/Lisbon" };
      a = await registarComerciante(base.api, novo);
      b = await registarComerciante(base.api, novo);
      lojaA = await criarLoja(base.api, a, {
        entidade_legal_id: await criarEntidadeLegal(base.api, a, ENTIDADE),
        nome: "Loja A",
      });
      lojaB = await criarLoja(base.api, b, {
        entidade_legal_id: await criarEntidadeLegal(base.api, b, ENTIDADE),
        nome: "Loja B",
      });
      const dados = { tipo: "servidor" as const, criadaPor: "operador:teste" };
      gestora = await criarChave(comoDono(), a, {
        ...dados,
        nome: "Gestão",
        ambitos: ["keys:write", "catalog:read"],
      });
      leitora = await criarChave(comoDono(), a, {
        ...dados,
        nome: "Leitura",
        ambitos: ["catalog:read"],
      });
      deB = await criarChave(comoDono(), b, {
        ...dados,
        nome: "Gestão de B",
        ambitos: ["keys:write"],
      });
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await base.fechar();
    });

    describe("criar (POST /keys)", () => {
      it("cria uma chave com âmbitos de quem pede; o segredo funciona e só vem nesta resposta (T5)", async () => {
        const r = await criar(gestora.segredo, {
          tipo: "servidor",
          nome: "Software de gestão",
          ambitos: ["catalog:read"],
        });
        expect(r.statusCode).toBe(201);
        const nova = r.json<ChaveCriada>();
        expect(nova.segredo).toMatch(FORMATO_SEGREDO);
        expect(nova.ambitos).toEqual(["catalog:read"]);
        expect(nova.criada_por).toBe(`chave:key_${gestora.id}`);
        const me = await eu(nova.segredo);
        expect(me.statusCode).toBe(200);
        expect(me.json<{ comerciante: string }>().comerciante).toBe(`mer_${a}`);

        const lista = await app.inject({
          method: "GET",
          url: "/keys",
          headers: { authorization: `Bearer ${gestora.segredo}` },
        });
        expect(lista.body).not.toContain(nova.segredo);
        // Na base só o resumo; nem a tabela das chaves nem a da idempotência
        // têm o segredo.
        const { rows } = await sql<{ texto: string }>`
          select (select string_agg(c::text, ' ') from chave_api c)
              || coalesce((select string_agg(i::text, ' ') from idempotencia i), '')
              as texto`.execute(base.dono);
        expect(rows[0]?.texto).not.toContain(nova.segredo);
        expect(rows[0]?.texto).toContain(resumoDe(nova.segredo));
        expect(registo.join("")).not.toContain(nova.segredo);
      });

      it("uma chave com prazo não cria outra sem prazo nem que dure mais (decisão do Diogo, 06/10/2026)", async () => {
        const daquiA = (minutos: number) =>
          new Date(Date.now() + minutos * 60_000);
        const prazo = daquiA(60);
        const temporaria = await criarChave(comoDono(), a, {
          tipo: "servidor",
          nome: "Integrador até daqui a uma hora",
          ambitos: ["keys:write", "catalog:read"],
          criadaPor: "operador:teste",
          expiraEm: prazo,
        });
        const antes = await contarChaves(a);
        for (const corpo of [
          // Sem prazo.
          { tipo: "servidor", nome: "Permanente", ambitos: ["catalog:read"] },
          // Com prazo, mas depois do da temporária.
          {
            tipo: "servidor",
            nome: "Mais longa",
            ambitos: ["catalog:read"],
            expira_em: daquiA(120).toISOString(),
          },
          // A pública também.
          { tipo: "publica", nome: "Montra", loja: `sto_${lojaA}` },
        ]) {
          const r = await criar(temporaria.segredo, corpo);
          expect(r.statusCode, corpo.nome).toBe(422);
          expect(r.json<{ codigo: string }>().codigo).toBe(
            "key.expiry_beyond_creator",
          );
        }
        expect(await contarChaves(a)).toBe(antes);
        // Até ao prazo dela, cria.
        const dentro = await criar(temporaria.segredo, {
          tipo: "servidor",
          nome: "Dentro do prazo",
          ambitos: ["catalog:read"],
          expira_em: daquiA(30).toISOString(),
        });
        expect(dentro.statusCode).toBe(201);
        // No mesmo instante do prazo dela, também (a fronteira: `>` e não `>=`).
        const igual = await criar(temporaria.segredo, {
          tipo: "servidor",
          nome: "Até ao mesmo instante",
          ambitos: ["catalog:read"],
          expira_em: prazo.toISOString(),
        });
        expect(igual.statusCode).toBe(201);
        // A pública dentro do prazo também se cria.
        const montra = await criar(temporaria.segredo, {
          tipo: "publica",
          nome: "Montra até ao prazo",
          loja: `sto_${lojaA}`,
          expira_em: daquiA(30).toISOString(),
        });
        expect(montra.statusCode).toBe(201);
        // A regra está na base, não só na rota.
        expect(
          await mensagemDoErro(
            comComerciante(base.api, a, (trx) =>
              sql`select chave_criar_pela_api(${temporaria.segredo}, 'servidor',
                    null, 'x', array['catalog:read'], 'eul_sk_abcde',
                    ${"e".repeat(64)}, null)`.execute(trx),
            ),
          ),
        ).toMatch(/^key\.expiry_beyond_creator:/);
        // Uma chave sem prazo continua a criar chaves sem prazo.
        const semPrazo = await criar(gestora.segredo, {
          tipo: "servidor",
          nome: "Permanente pela gestora",
          ambitos: ["catalog:read"],
        });
        expect(semPrazo.statusCode).toBe(201);
      });

      it("T9: não cria uma chave com âmbitos que não tem", async () => {
        const antes = await contarChaves(a);
        const r = await criar(gestora.segredo, {
          tipo: "servidor",
          nome: "Mais do que posso",
          ambitos: ["catalog:read", "merchant:write"],
        });
        expect(r.statusCode).toBe(403);
        expect(r.json<{ codigo: string }>().codigo).toBe(
          "key.scope_escalation",
        );
        expect(await contarChaves(a)).toBe(antes);
      });

      it("na base: sem o segredo de uma gestora válida do comerciante, a função recusa", async () => {
        const expirada = await criarChave(comoDono(), a, {
          tipo: "servidor",
          nome: "Expira já",
          ambitos: ["keys:write", "catalog:read"],
          criadaPor: "operador:teste",
          expiraEm: new Date(Date.now() + 1500),
        });
        await new Promise((r) => setTimeout(r, 1600));
        const chamar = (segredo: string) =>
          comComerciante(base.api, a, (trx) =>
            sql`select chave_criar_pela_api(${segredo}, 'servidor', null, 'x',
                  array['catalog:read'], 'eul_sk_abcde', ${"e".repeat(64)},
                  null)`.execute(trx),
          );
        for (const segredo of [
          // Sem keys:write; de B no contexto de A; inventado; expirada.
          leitora.segredo,
          deB.segredo,
          `eul_sk_${"a".repeat(52)}`,
          expirada.segredo,
          // O resumo de uma gestora não chega: é público para as chaves do
          // operador (revisão do #118, P2-2).
          resumoDe(gestora.segredo),
        ]) {
          expect(await mensagemDoErro(chamar(segredo))).toMatch(
            /^auth\.forbidden:/,
          );
        }
      });

      it("sem keys:write, a rota dá 403 auth.forbidden", async () => {
        const r = await criar(leitora.segredo, {
          tipo: "servidor",
          nome: "x",
          ambitos: ["catalog:read"],
        });
        expect(r.statusCode).toBe(403);
        expect(r.json<{ codigo: string }>().codigo).toBe("auth.forbidden");
      });

      it("cria uma chave pública de uma loja do comerciante, com storefront", async () => {
        const r = await criar(gestora.segredo, {
          tipo: "publica",
          nome: "Montra",
          loja: `sto_${lojaA}`,
        });
        expect(r.statusCode).toBe(201);
        const nova = r.json<ChaveCriada>();
        expect(nova.segredo).toMatch(/^eul_pk_/);
        expect(nova.ambitos).toEqual(["storefront"]);
        expect(nova.loja).toBe(`sto_${lojaA}`);
      });

      it("recusa a pública com âmbitos ou sem loja, a de servidor com loja, e a loja de outro comerciante", async () => {
        const casos: [unknown, number, string][] = [
          [
            {
              tipo: "publica",
              nome: "x",
              loja: `sto_${lojaA}`,
              ambitos: ["storefront"],
            },
            400,
            "request.invalid",
          ],
          [{ tipo: "publica", nome: "x" }, 400, "request.invalid"],
          [
            {
              tipo: "servidor",
              nome: "x",
              ambitos: ["catalog:read"],
              loja: `sto_${lojaA}`,
            },
            400,
            "request.invalid",
          ],
          [{ tipo: "servidor", nome: "x" }, 400, "request.invalid"],
          [
            { tipo: "publica", nome: "x", loja: `sto_${lojaB}` },
            422,
            "key.store_not_found",
          ],
          [
            {
              tipo: "servidor",
              nome: "x",
              ambitos: ["catalog:read"],
              expira_em: "2020-01-01T00:00:00Z",
            },
            422,
            "key.invalid_expiry",
          ],
          // Campos a mais e tipos errados recusam-se, não se apagam nem
          // se convertem (revisão do #118, P2-1).
          [
            {
              tipo: "servidor",
              nome: "x",
              ambitos: ["catalog:read"],
              expires_at: "2030-01-01T00:00:00Z",
            },
            400,
            "request.invalid",
          ],
          [
            { tipo: "servidor", nome: "x", ambitos: "catalog:read" },
            400,
            "request.invalid",
          ],
          [
            { tipo: "publica", nome: "x", loja: `sto_${"-".repeat(36)}` },
            400,
            "request.invalid",
          ],
          [
            {
              tipo: "servidor",
              nome: "x",
              ambitos: ["catalog:read"],
              expira_em: "2030-12-31T23:59:60Z",
            },
            400,
            "request.invalid",
          ],
          [
            { tipo: "servidor", nome: "   ", ambitos: ["catalog:read"] },
            400,
            "request.invalid",
          ],
        ];
        const antes = await contarChaves(a);
        for (const [corpo, status, codigo] of casos) {
          const r = await criar(gestora.segredo, corpo);
          expect(r.statusCode, JSON.stringify(corpo)).toBe(status);
          expect(r.json<{ codigo: string }>().codigo).toBe(codigo);
        }
        expect(await contarChaves(a)).toBe(antes);
      });
    });

    describe("idempotência (T10)", () => {
      it("sem Idempotency-Key → 400 idempotency.key_required; mal formada → 400", async () => {
        const corpo = {
          tipo: "servidor",
          nome: "x",
          ambitos: ["catalog:read"],
        };
        const sem = await criar(gestora.segredo, corpo, null);
        expect(sem.statusCode).toBe(400);
        expect(sem.json<{ codigo: string }>().codigo).toBe(
          "idempotency.key_required",
        );
        const mal = await criar(gestora.segredo, corpo, "com espaço");
        expect(mal.statusCode).toBe(400);
        expect(mal.json<{ codigo: string }>().codigo).toBe("request.invalid");
      });

      it("repetir o POST /keys não cria outra chave e não repete o segredo", async () => {
        const chave = randomUUID();
        const corpo = {
          tipo: "servidor",
          nome: "Repetida",
          ambitos: ["catalog:read"],
        };
        const primeira = await criar(gestora.segredo, corpo, chave);
        expect(primeira.statusCode).toBe(201);
        const antes = await contarChaves(a);
        const outra = await criar(gestora.segredo, { ...corpo }, chave);
        expect(outra.statusCode).toBe(409);
        const p = outra.json<{ codigo: string; detail: string }>();
        expect(p.codigo).toBe("idempotency.secret_not_repeated");
        expect(p.detail).toContain(primeira.json<ChaveCriada>().id);
        expect(outra.body).not.toContain(primeira.json<ChaveCriada>().segredo);
        expect(await contarChaves(a)).toBe(antes);
      });

      it("a mesma chave com outro corpo → 422 idempotency.key_reused", async () => {
        const chave = randomUUID();
        const corpo = {
          tipo: "servidor",
          nome: "Um",
          ambitos: ["catalog:read"],
        };
        expect((await criar(gestora.segredo, corpo, chave)).statusCode).toBe(
          201,
        );
        const r = await criar(
          gestora.segredo,
          { ...corpo, nome: "Dois" },
          chave,
        );
        expect(r.statusCode).toBe(422);
        expect(r.json<{ codigo: string }>().codigo).toBe(
          "idempotency.key_reused",
        );
      });

      it("a ordem das chaves do corpo não muda o pedido", async () => {
        const chave = randomUUID();
        expect(
          (
            await criar(
              gestora.segredo,
              { tipo: "servidor", nome: "Ordem", ambitos: ["catalog:read"] },
              chave,
            )
          ).statusCode,
        ).toBe(201);
        const r = await criar(
          gestora.segredo,
          { ambitos: ["catalog:read"], nome: "Ordem", tipo: "servidor" },
          chave,
        );
        expect(r.json<{ codigo: string }>().codigo).toBe(
          "idempotency.secret_not_repeated",
        );
      });

      it("um pedido ainda em curso → 409 idempotency.in_progress; ao fim de 60 s, um órfão é substituído", async () => {
        const chave = randomUUID();
        const corpo = {
          tipo: "servidor",
          nome: "Em curso",
          ambitos: ["catalog:read"],
        };
        // Outro pedido com a mesma chave a meio (posto como o dono).
        await sql`
          insert into idempotencia (comerciante_id, chave, metodo, caminho, resumo_corpo)
          values (${a}::uuid, ${chave}, 'POST', '/keys', ${"0".repeat(64)})`.execute(
          base.dono,
        );
        const ocupado = await criar(gestora.segredo, corpo, chave);
        // Outro resumo: é outro pedido.
        expect(ocupado.json<{ codigo: string }>().codigo).toBe(
          "idempotency.key_reused",
        );
        const { resumoDoCorpo } = await import("../src/base/idempotencia.js");
        await sql`update idempotencia set resumo_corpo = ${resumoDoCorpo(corpo)}
          where chave = ${chave}`.execute(base.dono);
        const emCurso = await criar(gestora.segredo, corpo, chave);
        expect(emCurso.statusCode).toBe(409);
        expect(emCurso.json<{ codigo: string }>().codigo).toBe(
          "idempotency.in_progress",
        );
        await sql`update idempotencia set criado_em = now() - interval '61 seconds'
          where chave = ${chave}`.execute(base.dono);
        const depois = await criar(gestora.segredo, corpo, chave);
        expect(depois.statusCode).toBe(201);
      });

      it("uma escrita que falha liberta a chave", async () => {
        const chave = randomUUID();
        const r = await criar(
          gestora.segredo,
          { tipo: "servidor", nome: "x", ambitos: ["merchant:write"] },
          chave,
        );
        expect(r.statusCode).toBe(403);
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from idempotencia where chave = ${chave}`.execute(
          base.dono,
        );
        expect(rows[0]?.n).toBe(0);
        const outra = await criar(
          gestora.segredo,
          { tipo: "servidor", nome: "x", ambitos: ["catalog:read"] },
          chave,
        );
        expect(outra.statusCode).toBe(201);
      });

      it("uma chave de idempotência com 256 caracteres recusa-se", async () => {
        const r = await criar(
          gestora.segredo,
          { tipo: "servidor", nome: "x", ambitos: ["catalog:read"] },
          "k".repeat(256),
        );
        expect(r.statusCode).toBe(400);
        expect(r.json<{ codigo: string }>().codigo).toBe("request.invalid");
      });

      it("a mesma chave de idempotência noutra chave a revogar → 422 key_reused", async () => {
        const r1 = await criar(gestora.segredo, {
          tipo: "servidor",
          nome: "Alvo 1",
          ambitos: ["catalog:read"],
        });
        const r2 = await criar(gestora.segredo, {
          tipo: "servidor",
          nome: "Alvo 2",
          ambitos: ["catalog:read"],
        });
        const chave = randomUUID();
        expect(
          (await revogar(gestora.segredo, r1.json<ChaveCriada>().id, chave))
            .statusCode,
        ).toBe(200);
        const outra = await revogar(
          gestora.segredo,
          r2.json<ChaveCriada>().id,
          chave,
        );
        expect(outra.statusCode).toBe(422);
        expect(outra.json<{ codigo: string }>().codigo).toBe(
          "idempotency.key_reused",
        );
        expect((await eu(r2.json<ChaveCriada>().segredo)).statusCode).toBe(200);
      });

      it("a API só escreve as colunas dela e só no seu comerciante", async () => {
        const tentativas = [
          sql`insert into idempotencia (comerciante_id, chave, metodo, caminho,
                resumo_corpo, criado_em)
              values (${a}::uuid, 'c1', 'POST', '/x', ${"0".repeat(64)}, now())`,
          sql`update idempotencia set expira_em = now() + interval '10 years'`,
          sql`insert into idempotencia (comerciante_id, chave, metodo, caminho,
                resumo_corpo)
              values (${b}::uuid, 'c2', 'POST', '/x', ${"0".repeat(64)})`,
        ];
        for (const consulta of tentativas) {
          expect(
            await mensagemDoErro(
              comComerciante(base.api, a, (trx) => consulta.execute(trx)),
            ),
          ).toMatch(/permission denied|row-level security/);
        }
      });

      it("um pedido lento cuja reserva foi substituída (órfã) não escreve uma segunda vez", async () => {
        const { comIdempotencia } = await import("../src/base/idempotencia.js");
        const { criarChavePelaApi } =
          await import("../src/identidade/repositorio.js");
        const chave = randomUUID();
        const pedido = {
          chave,
          metodo: "POST" as const,
          caminho: "/keys",
          corpo: { nome: "Órfã" },
        };
        const escrever = (trx: Parameters<typeof criarChavePelaApi>[0]) =>
          criarChavePelaApi(trx, gestora.segredo, {
            tipo: "servidor",
            lojaId: null,
            nome: "Órfã",
            ambitos: ["catalog:read"],
            expiraEm: null,
            agenteIa: false,
          }).then(() => ({ status: 201, corpo: {}, guardar: {} }));
        let soltar = () => {};
        const solto = new Promise<void>((r) => (soltar = r));
        let comecou = () => {};
        const começado = new Promise<void>((r) => (comecou = r));
        // O primeiro reserva e fica parado antes de escrever.
        const primeiro = comIdempotencia(base.api, a, pedido, async (trx) => {
          comecou();
          await solto;
          return escrever(trx);
        });
        await começado;
        // A reserva dele envelhece: passa a órfã, e um segundo igual entra.
        await sql`update idempotencia set criado_em = now() - interval '61 seconds'
          where chave = ${chave}`.execute(base.dono);
        const segundo = await comIdempotencia(base.api, a, pedido, escrever);
        expect(segundo.repetida).toBe(false);
        soltar();
        const r = await primeiro.catch((e: unknown) => e);
        expect((r as { codigo?: string }).codigo).toBe(
          "idempotency.in_progress",
        );
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from chave_api
          where comerciante_id = ${a}::uuid and nome = 'Órfã'`.execute(
          base.dono,
        );
        expect(rows[0]?.n).toBe(1);
      });

      it("a idempotência de um comerciante não se vê do outro (RLS forçado)", async () => {
        const chave = randomUUID();
        expect(
          (
            await criar(
              gestora.segredo,
              { tipo: "servidor", nome: "De A", ambitos: ["catalog:read"] },
              chave,
            )
          ).statusCode,
        ).toBe(201);
        const vistas = await comComerciante(base.api, b, (trx) =>
          sql<{
            n: number;
          }>`select count(*)::int as n from idempotencia`.execute(trx),
        );
        expect(vistas.rows[0]?.n).toBe(0);
        // A mesma chave de idempotência em B é outro pedido.
        const deOutro = await criar(
          deB.segredo,
          { tipo: "servidor", nome: "De B", ambitos: ["keys:write"] },
          chave,
        );
        expect(deOutro.statusCode).toBe(201);
      });
    });

    describe("revogar (POST /keys/{id}/revoke)", () => {
      const novaDeA = async (ambitos: string[]) => {
        const r = await criar(gestora.segredo, {
          tipo: "servidor",
          nome: "Para revogar",
          ambitos,
        });
        expect(r.statusCode).toBe(201);
        return r.json<ChaveCriada>();
      };

      it("T8: revoga de imediato; repetir com a mesma chave dá a mesma resposta", async () => {
        const alvo = await novaDeA(["catalog:read"]);
        expect((await eu(alvo.segredo)).statusCode).toBe(200);
        const chave = randomUUID();
        const r = await revogar(gestora.segredo, alvo.id, chave);
        expect(r.statusCode).toBe(200);
        const revogada = r.json<{
          revogada_em: string;
          revogada_por: string;
        }>();
        expect(revogada.revogada_por).toBe(`chave:key_${gestora.id}`);
        expect((await eu(alvo.segredo)).statusCode).toBe(401);
        const outra = await revogar(gestora.segredo, alvo.id, chave);
        expect(outra.statusCode).toBe(200);
        expect(outra.json()).toEqual(r.json());
      });

      it("já revogada → 409; de outro comerciante ou inexistente → 404", async () => {
        const alvo = await novaDeA(["catalog:read"]);
        expect((await revogar(gestora.segredo, alvo.id)).statusCode).toBe(200);
        const outra = await revogar(gestora.segredo, alvo.id);
        expect(outra.statusCode).toBe(409);
        expect(outra.json<{ codigo: string }>().codigo).toBe(
          "key.already_revoked",
        );
        for (const id of [`key_${deB.id}`, `key_${randomUUID()}`]) {
          const r = await revogar(gestora.segredo, id);
          expect(r.statusCode, id).toBe(404);
          expect(r.json<{ codigo: string }>().codigo).toBe("key.not_found");
        }
        expect((await eu(deB.segredo)).statusCode).toBe(200);
      });

      /** Um comerciante novo com `n` chaves que gerem chaves. */
      const comGestoras = async (n: number) => {
        const c = await registarComerciante(base.api, {
          nome: "Loja",
          lingua: "pt",
          fuso: "Europe/Lisbon",
        });
        const chaves = [];
        for (let i = 0; i < n; i++) {
          chaves.push(
            await criarChave(comoDono(), c, {
              tipo: "servidor",
              nome: `Gestora ${String(i + 1)}`,
              ambitos: ["keys:write"],
              criadaPor: "operador:teste",
            }),
          );
        }
        return { comerciante: c, chaves };
      };

      const gestorasActivas = async (comerciante: string) => {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from chave_api
          where comerciante_id = ${comerciante}::uuid and revogada_em is null
            and 'keys:write' = any (ambitos)`.execute(base.dono);
        return rows[0]?.n ?? 0;
      };

      it("um comerciante suspenso ou fechado não cria chaves, mas revoga (decisão do Diogo, 06/10/2026)", async () => {
        for (const estado of ["suspenso", "fechado"] as const) {
          const { comerciante, chaves } = await comGestoras(2);
          const [um, dois] = chaves;
          if (um === undefined || dois === undefined)
            throw new Error("sem chaves");
          await mudarEstado(base.api, comerciante, {
            de: "rascunho",
            para: estado,
            motivo: "teste",
            quem: "operador:teste",
          });
          const antes = await contarChaves(comerciante);
          const r = await criar(um.segredo, {
            tipo: "servidor",
            nome: "Depois de parar",
            ambitos: ["keys:write"],
          });
          expect(r.statusCode, estado).toBe(403);
          expect(r.json<{ codigo: string }>().codigo).toBe(
            "key.merchant_inactive",
          );
          expect(await contarChaves(comerciante)).toBe(antes);
          // Revogar continua: fechar acessos.
          const rev = await revogar(um.segredo, `key_${dois.id}`);
          expect(rev.statusCode, estado).toBe(200);
        }
      });

      it("T11: não se revoga a si própria se for a última com keys:write", async () => {
        const { comerciante, chaves } = await comGestoras(1);
        const [so] = chaves;
        if (so === undefined) throw new Error("sem chave");
        const r = await revogar(so.segredo, `key_${so.id}`);
        expect(r.statusCode).toBe(409);
        expect(r.json<{ codigo: string }>().codigo).toBe("key.last_key_writer");
        expect((await eu(so.segredo)).statusCode).toBe(200);
        expect(await gestorasActivas(comerciante)).toBe(1);
      });

      it("T13: ao arquivar a loja, as chaves públicas dela deixam de funcionar e não se criam outras; se a loja voltar, as antigas não voltam (decisões do Diogo, 06/10/2026)", async () => {
        const { comerciante, chaves } = await comGestoras(1);
        const [gestoraDaLoja] = chaves;
        if (gestoraDaLoja === undefined) throw new Error("sem chave");
        const entidade = await criarEntidadeLegal(
          base.api,
          comerciante,
          ENTIDADE,
        );
        const loja = await criarLoja(base.api, comerciante, {
          entidade_legal_id: entidade,
          nome: "Espanha",
        });
        const outraLoja = await criarLoja(base.api, comerciante, {
          entidade_legal_id: entidade,
          nome: "Portugal",
        });
        const montra = await criar(gestoraDaLoja.segredo, {
          tipo: "publica",
          nome: "Montra",
          loja: `sto_${loja}`,
        });
        expect(montra.statusCode).toBe(201);
        const publica = montra.json<ChaveCriada>();
        const daOutra = await criarChave(comoDono(), comerciante, {
          tipo: "publica",
          lojaId: outraLoja,
          nome: "Montra PT",
          ambitos: ["storefront"],
          criadaPor: "operador:teste",
        });
        expect((await eu(publica.segredo)).statusCode).toBe(200);
        // Antes do arquivo: uma pública já revogada e outra já expirada
        // (revisão do #131, P2-2). O arquivo não pode rebentar na revogada
        // nem mudar o motivo dela.
        const jaRevogada = await criarChave(comoDono(), comerciante, {
          tipo: "publica",
          lojaId: loja,
          nome: "Já revogada",
          ambitos: ["storefront"],
          criadaPor: "operador:teste",
        });
        expect(
          (await revogar(gestoraDaLoja.segredo, `key_${jaRevogada.id}`))
            .statusCode,
        ).toBe(200);
        const expirada = await criarChave(comoDono(), comerciante, {
          tipo: "publica",
          lojaId: loja,
          nome: "Expira já",
          ambitos: ["storefront"],
          criadaPor: "operador:teste",
          expiraEm: new Date(Date.now() + 1500),
        });
        await new Promise((r) => setTimeout(r, 1600));
        const revogacao = async (id: string) => {
          const { rows } = await sql<{
            revogada_por: string | null;
            revogada_em: Date | null;
          }>`select revogada_por, revogada_em from chave_api
             where id = ${id}::uuid`.execute(base.dono);
          return rows[0];
        };
        const antesDoArquivo = await revogacao(jaRevogada.id);

        // A API arquiva a loja (sem privilégio nenhum na tabela das chaves).
        const mudarLoja = (estado: string) =>
          comComerciante(base.api, comerciante, (trx) =>
            sql`update loja set estado = ${estado}
                where id = ${loja}::uuid`.execute(trx),
          );
        await mudarLoja("arquivada");

        const depois = await eu(publica.segredo);
        expect(depois.statusCode).toBe(401);
        expect(depois.json<{ codigo: string }>().codigo).toBe("auth.invalid");
        // O registo fica, com o motivo.
        const { rows } = await sql<{
          revogada_por: string | null;
          revogada_em: Date | null;
        }>`select revogada_por, revogada_em from chave_api
           where id = ${publica.id.slice("key_".length)}::uuid`.execute(
          base.dono,
        );
        expect(rows[0]?.revogada_por).toBe(`loja_arquivada:sto_${loja}`);
        expect(rows[0]?.revogada_em).not.toBeNull();
        expect(await revogacao(jaRevogada.id)).toEqual(antesDoArquivo);
        expect((await revogacao(expirada.id))?.revogada_por).toBe(
          `loja_arquivada:sto_${loja}`,
        );
        // A da outra loja e a de servidor continuam.
        expect((await eu(daOutra.segredo)).statusCode).toBe(200);
        expect((await eu(gestoraDaLoja.segredo)).statusCode).toBe(200);

        // Não se cria nenhuma: nem pela API, nem pelo operador.
        const antes = await contarChaves(comerciante);
        const r = await criar(gestoraDaLoja.segredo, {
          tipo: "publica",
          nome: "Outra montra",
          loja: `sto_${loja}`,
        });
        expect(r.statusCode).toBe(422);
        expect(r.json<{ codigo: string }>().codigo).toBe("key.store_archived");
        expect(
          await mensagemDoErro(
            criarChave(comoDono(), comerciante, {
              tipo: "publica",
              lojaId: loja,
              nome: "Pelo operador",
              ambitos: ["storefront"],
              criadaPor: "operador:teste",
            }),
          ),
        ).toMatch(/^key\.store_archived:/);
        expect(await contarChaves(comerciante)).toBe(antes);

        // A loja volta a activa: a antiga não volta; uma nova cria-se.
        await mudarLoja("activa");
        expect((await eu(publica.segredo)).statusCode).toBe(401);
        const nova = await criar(gestoraDaLoja.segredo, {
          tipo: "publica",
          nome: "Montra nova",
          loja: `sto_${loja}`,
        });
        expect(nova.statusCode).toBe(201);
        expect((await eu(nova.json<ChaveCriada>().segredo)).statusCode).toBe(
          200,
        );
      });

      /** Espera até a promessa acabar ou ficar à espera de um bloqueio. */
      async function ateBloquear(promessa: Promise<unknown>): Promise<void> {
        const estado = { acabou: false };
        void promessa.then(
          () => (estado.acabou = true),
          () => (estado.acabou = true),
        );
        for (let i = 0; i < 100 && !estado.acabou; i++) {
          const { rows } = await sql<{ n: number }>`
            select count(*)::int as n from pg_stat_activity
            where usename = 'eurolify_api' and wait_event_type = 'Lock'`.execute(
            base.dono,
          );
          if ((rows[0]?.n ?? 0) > 0) return;
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      it("T13 em concorrência: criar uma pública e arquivar a loja ao mesmo tempo nunca deixa uma chave válida numa loja arquivada (revisão do #131, P2-1)", async () => {
        const { comerciante, chaves } = await comGestoras(1);
        const [gestoraDaLoja] = chaves;
        if (gestoraDaLoja === undefined) throw new Error("sem chave");
        const loja = await criarLoja(base.api, comerciante, {
          entidade_legal_id: await criarEntidadeLegal(
            base.api,
            comerciante,
            ENTIDADE,
          ),
          nome: "Concorrência",
        });
        const contexto = "select set_config('eurolify.comerciante', $1, true)";
        const criarSql =
          "select chave_criar_pela_api($1, 'publica', $2::uuid, 'Montra', null, $3, $4, null) as id";
        const mudar = "update loja set estado = $1 where id = $2::uuid";
        const cria = new pg.Client({ connectionString: base.urlApi });
        const arquiva = new pg.Client({ connectionString: base.urlApi });
        await cria.connect();
        await arquiva.connect();
        try {
          // Quem cria primeiro: o arquivo espera e, ao passar, revoga também
          // a chave nova.
          const primeira = gerarChave("publica");
          await cria.query("BEGIN");
          await cria.query(contexto, [comerciante]);
          const criada = await cria.query<{ id: string }>(criarSql, [
            gestoraDaLoja.segredo,
            loja,
            primeira.prefixo,
            primeira.resumo,
          ]);
          await arquiva.query("BEGIN");
          await arquiva.query(contexto, [comerciante]);
          const arquivo = arquiva.query(mudar, ["arquivada", loja]);
          await ateBloquear(arquivo);
          await cria.query("COMMIT");
          await arquivo;
          await arquiva.query("COMMIT");
          const { rows } = await sql<{ revogada_por: string | null }>`
            select revogada_por from chave_api
            where id = ${criada.rows[0]?.id ?? ""}::uuid`.execute(base.dono);
          expect(rows[0]?.revogada_por).toBe(`loja_arquivada:sto_${loja}`);
          expect((await eu(primeira.segredo)).statusCode).toBe(401);

          // Quem arquiva primeiro: a criação espera e, ao passar, é recusada.
          await arquiva.query("BEGIN");
          await arquiva.query(contexto, [comerciante]);
          await arquiva.query(mudar, ["activa", loja]);
          await arquiva.query("COMMIT");
          await arquiva.query("BEGIN");
          await arquiva.query(contexto, [comerciante]);
          await arquiva.query(mudar, ["arquivada", loja]);
          const segunda = gerarChave("publica");
          await cria.query("BEGIN");
          await cria.query(contexto, [comerciante]);
          const criacao = cria.query(criarSql, [
            gestoraDaLoja.segredo,
            loja,
            segunda.prefixo,
            segunda.resumo,
          ]);
          await ateBloquear(criacao);
          await arquiva.query("COMMIT");
          await expect(criacao).rejects.toThrow(/^key\.store_archived:/);
          await cria.query("ROLLBACK");
          expect((await eu(segunda.segredo)).statusCode).toBe(401);
        } finally {
          await cria.end();
          await arquiva.end();
        }
      });

      it("a loja arquivada de outro comerciante dá key.store_not_found, sem revelar que está arquivada (revisão do #131, P3-5)", async () => {
        const { comerciante: outro } = await comGestoras(1);
        const lojaAlheia = await criarLoja(base.api, outro, {
          entidade_legal_id: await criarEntidadeLegal(
            base.api,
            outro,
            ENTIDADE,
          ),
          nome: "Alheia",
        });
        await comComerciante(base.api, outro, (trx) =>
          sql`update loja set estado = 'arquivada'
              where id = ${lojaAlheia}::uuid`.execute(trx),
        );
        const r = await criar(gestora.segredo, {
          tipo: "publica",
          nome: "Montra alheia",
          loja: `sto_${lojaAlheia}`,
        });
        expect(r.statusCode).toBe(422);
        expect(r.json<{ codigo: string }>().codigo).toBe("key.store_not_found");
      });

      it("o gatilho que revoga as chaves ao arquivar está sempre ligado (ENABLE ALWAYS; revisão do #131, P3-5)", async () => {
        const { rows } = await sql<{ tgenabled: string }>`
          select tgenabled from pg_trigger
          where tgname = 'loja_revogar_chaves_ao_arquivar'`.execute(base.dono);
        expect(rows.map((r) => r.tgenabled)).toEqual(["A"]);
      });

      it("T14: uma chave com prazo revoga-se a si própria, havendo outra gestora (o mesmo instante passa; revisão do #131, P3-5)", async () => {
        const { comerciante } = await comGestoras(1);
        const temporaria = await criarChave(comoDono(), comerciante, {
          tipo: "servidor",
          nome: "Temporária",
          ambitos: ["keys:write"],
          criadaPor: "operador:teste",
          expiraEm: new Date(Date.now() + 60 * 60_000),
        });
        const r = await revogar(temporaria.segredo, `key_${temporaria.id}`);
        expect(r.statusCode).toBe(200);
        expect((await eu(temporaria.segredo)).statusCode).toBe(401);
      });

      it("T14: uma chave com prazo não revoga uma sem prazo nem uma que dure mais; no mesmo instante ou antes, sim (decisão do Diogo, 06/10/2026)", async () => {
        const { comerciante, chaves } = await comGestoras(1);
        const [permanente] = chaves;
        if (permanente === undefined) throw new Error("sem chave");
        const daquiA = (minutos: number) =>
          new Date(Date.now() + minutos * 60_000);
        const prazo = daquiA(60);
        const temporaria = await criarChave(comoDono(), comerciante, {
          tipo: "servidor",
          nome: "Temporária",
          ambitos: ["keys:write"],
          criadaPor: "operador:teste",
          expiraEm: prazo,
        });
        const maisLonga = await criarChave(comoDono(), comerciante, {
          tipo: "servidor",
          nome: "Mais longa",
          ambitos: ["catalog:read"],
          criadaPor: "operador:teste",
          expiraEm: daquiA(120),
        });
        for (const alvo of [permanente.id, maisLonga.id]) {
          const r = await revogar(temporaria.segredo, `key_${alvo}`);
          expect(r.statusCode, alvo).toBe(403);
          expect(r.json<{ codigo: string }>().codigo).toBe(
            "key.revoke_beyond_creator",
          );
        }
        expect((await eu(permanente.segredo)).statusCode).toBe(200);
        expect((await eu(maisLonga.segredo)).statusCode).toBe(200);
        // A regra está na base, não só na rota.
        expect(
          await mensagemDoErro(
            comComerciante(base.api, comerciante, (trx) =>
              sql`select chave_revogar_pela_api(${temporaria.segredo},
                    ${permanente.id}::uuid)`.execute(trx),
            ),
          ),
        ).toMatch(/^key\.revoke_beyond_creator:/);
        // No mesmo instante (a fronteira: `>` e não `>=`) e antes, revoga.
        for (const expiraEm of [prazo, daquiA(30)]) {
          const alvo = await criarChave(comoDono(), comerciante, {
            tipo: "servidor",
            nome: "Dentro do prazo",
            ambitos: ["catalog:read"],
            criadaPor: "operador:teste",
            expiraEm,
          });
          expect(
            (await revogar(temporaria.segredo, `key_${alvo.id}`)).statusCode,
          ).toBe(200);
        }
        // A permanente revoga a temporária (uma sem prazo revoga qualquer).
        expect(
          (await revogar(permanente.segredo, `key_${temporaria.id}`))
            .statusCode,
        ).toBe(200);
        expect(await gestorasActivas(comerciante)).toBe(1);
      });

      it("T11: com outra que gere chaves, revoga-se a si própria", async () => {
        const { comerciante, chaves } = await comGestoras(2);
        const [primeira] = chaves;
        if (primeira === undefined) throw new Error("sem chave");
        const r = await revogar(primeira.segredo, `key_${primeira.id}`);
        expect(r.statusCode).toBe(200);
        expect((await eu(primeira.segredo)).statusCode).toBe(401);
        expect(await gestorasActivas(comerciante)).toBe(1);
      });

      it("T11: duas que gerem chaves a revogarem-se ao mesmo tempo deixam uma", async () => {
        for (let volta = 0; volta < 5; volta++) {
          const { comerciante, chaves } = await comGestoras(2);
          const [um, dois] = chaves;
          if (um === undefined || dois === undefined)
            throw new Error("sem chaves");
          const [r1, r2] = await Promise.all([
            revogar(um.segredo, `key_${um.id}`),
            revogar(dois.segredo, `key_${dois.id}`),
          ]);
          expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
          expect(await gestorasActivas(comerciante)).toBe(1);
        }
      });

      it("T11: duas que se revogam uma à outra ao mesmo tempo deixam uma", async () => {
        for (let volta = 0; volta < 5; volta++) {
          const { comerciante, chaves } = await comGestoras(2);
          const [um, dois] = chaves;
          if (um === undefined || dois === undefined)
            throw new Error("sem chaves");
          const [r1, r2] = await Promise.all([
            revogar(um.segredo, `key_${dois.id}`),
            revogar(dois.segredo, `key_${um.id}`),
          ]);
          // A segunda já não pode pedir: foi revogada pela primeira. Conforme
          // o momento, a autenticação dá 401 ou a base dá 403 (revisão do
          // #118, P3-8).
          const [ganhou, perdeu] = [r1.statusCode, r2.statusCode].sort();
          expect(ganhou).toBe(200);
          expect([401, 403]).toContain(perdeu);
          expect(await gestorasActivas(comerciante)).toBe(1);
        }
      });
    });
  },
);
