import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  AMBITOS,
  FORMATO_SEGREDO,
  resumoDe,
} from "../src/identidade/chaves.js";
import {
  criarChave,
  listarChaves,
  resolverChave,
  revogarChave,
} from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Chaves de API na base (migração 0010; docs/19 §3 e §9). Contra o
// PostgreSQL 18 verdadeiro, com o eurolify_api (ADR-0025).

const ENTIDADE = {
  denominacao: "Exemplo, Lda.",
  forma_juridica: "sociedade por quotas",
  pais: "PT",
  numero_fiscal: "123456789",
  morada_linha: "Rua de Teste, 1",
  morada_codigo_postal: "1000-001",
  morada_localidade: "Lisboa",
};

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    return String((erro as { message?: unknown }).message);
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)("chaves de API na base (0010)", () => {
  let base: BaseDeTeste;
  let a: string;
  let b: string;
  let lojaA: string;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    const novo = { nome: "Loja", lingua: "pt", fuso: "Europe/Lisbon" };
    a = await registarComerciante(base.api, novo);
    b = await registarComerciante(base.api, novo);
    const entidade = await criarEntidadeLegal(base.api, a, ENTIDADE);
    lojaA = await criarLoja(base.api, a, {
      entidade_legal_id: entidade,
      nome: "Loja A",
      lingua_origem: "pt",
    });
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  it("cria uma chave de servidor e resolve-a para o comerciante dela", async () => {
    const nova = await criarChave(base.api, a, {
      tipo: "servidor",
      nome: "Software de gestão",
      ambitos: ["catalog:read"],
      criadaPor: "operador:teste",
    });
    expect(nova.segredo).toMatch(FORMATO_SEGREDO);
    expect(nova.prefixo).toBe(nova.segredo.slice(0, 12));
    const contexto = await resolverChave(base.api, nova.segredo);
    expect(contexto).toEqual({
      chaveId: nova.id,
      comercianteId: a,
      lojaId: null,
      tipo: "servidor",
      ambitos: ["catalog:read"],
      prefixo: nova.prefixo,
    });
  });

  it("um segredo inventado, mal formado ou de outro tipo não resolve", async () => {
    expect(await resolverChave(base.api, `eul_sk_${"a".repeat(52)}`)).toBe(
      null,
    );
    expect(await resolverChave(base.api, "qualquer-coisa")).toBe(null);
    expect(await resolverChave(base.api, "")).toBe(null);
  });

  it("T5: o segredo não fica na base, só o resumo", async () => {
    const nova = await criarChave(base.api, a, {
      tipo: "servidor",
      nome: "Procurar o segredo",
      ambitos: ["merchant:read"],
      criadaPor: "operador:teste",
    });
    const { rows } = await sql<{ n: number; resumo: number }>`
      select count(*) filter (where row_to_json(c)::text like ${"%" + nova.segredo + "%"})::int as n,
             count(*) filter (where resumo = ${resumoDe(nova.segredo)})::int as resumo
      from chave_api c`.execute(base.dono);
    expect(rows[0]).toEqual({ n: 0, resumo: 1 });
    const lista = await listarChaves(base.api, a);
    expect(JSON.stringify(lista)).not.toContain(resumoDe(nova.segredo));
    expect(JSON.stringify(lista)).not.toContain(nova.segredo);
  });

  it("T7: o eurolify_api não tem nenhum privilégio na tabela", async () => {
    const { rows } = await sql<{ privilegio: string; tem: boolean }>`
      select p as privilegio, has_table_privilege('eurolify_api', 'chave_api', p) as tem
      from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p`.execute(
      base.dono,
    );
    expect(rows.filter((r) => r.tem)).toEqual([]);
    const { rows: colunas } = await sql<{ n: number }>`
      select count(*)::int as n from information_schema.column_privileges
      where table_name = 'chave_api' and grantee = 'eurolify_api'`.execute(
      base.dono,
    );
    expect(colunas[0]?.n).toBe(0);
    // Segunda barreira: RLS ligado (sem FORCE, para as funções do dono).
    const { rows: rls } = await sql<{ rls: boolean; forcado: boolean }>`
      select relrowsecurity as rls, relforcerowsecurity as forcado
      from pg_class where oid = 'public.chave_api'::regclass`.execute(
      base.dono,
    );
    expect(rls[0]).toEqual({ rls: true, forcado: false });
  });

  it("listar e revogar só vêem as chaves do próprio comerciante", async () => {
    const deA = await criarChave(base.api, a, {
      tipo: "servidor",
      nome: "Só de A",
      ambitos: ["catalog:read"],
      criadaPor: "operador:teste",
    });
    const listaB = await listarChaves(base.api, b);
    expect(listaB.map((c) => c.id)).not.toContain(deA.id);
    expect(await revogarChave(base.api, b, deA.id, "operador:teste")).toBe(
      false,
    );
    expect(await resolverChave(base.api, deA.segredo)).not.toBe(null);
  });

  it("T8: revogar é imediato e só uma vez", async () => {
    const nova = await criarChave(base.api, a, {
      tipo: "servidor",
      nome: "A revogar",
      ambitos: ["catalog:read"],
      criadaPor: "operador:teste",
    });
    expect(await revogarChave(base.api, a, nova.id, "operador:teste")).toBe(
      true,
    );
    expect(await resolverChave(base.api, nova.segredo)).toBe(null);
    expect(await revogarChave(base.api, a, nova.id, "operador:teste")).toBe(
      false,
    );
    const listada = (await listarChaves(base.api, a)).find(
      (c) => c.id === nova.id,
    );
    expect(listada?.revogada_por).toBe("operador:teste");
    expect(listada?.revogada_em).toBeInstanceOf(Date);
  });

  it("uma chave expirada não resolve", async () => {
    const nova = await criarChave(base.api, a, {
      tipo: "servidor",
      nome: "Expira já",
      ambitos: ["catalog:read"],
      criadaPor: "operador:teste",
      expiraEm: new Date(Date.now() + 1500),
    });
    expect(await resolverChave(base.api, nova.segredo)).not.toBe(null);
    await new Promise((r) => setTimeout(r, 2000));
    expect(await resolverChave(base.api, nova.segredo)).toBe(null);
  });

  it("T6: a chave pública é de uma loja e só tem o âmbito da Loja", async () => {
    const publica = await criarChave(base.api, a, {
      tipo: "publica",
      lojaId: lojaA,
      nome: "Montra",
      ambitos: ["storefront"],
      criadaPor: "operador:teste",
    });
    expect(publica.segredo).toMatch(/^eul_pk_/);
    expect((await resolverChave(base.api, publica.segredo))?.lojaId).toBe(
      lojaA,
    );
    for (const dados of [
      {
        tipo: "publica" as const,
        lojaId: lojaA,
        ambitos: ["catalog:write" as const],
      },
      {
        tipo: "publica" as const,
        lojaId: null,
        ambitos: ["storefront" as const],
      },
      {
        tipo: "servidor" as const,
        lojaId: null,
        ambitos: ["storefront" as const],
      },
      {
        tipo: "servidor" as const,
        lojaId: lojaA,
        ambitos: ["catalog:read" as const],
      },
    ]) {
      expect(
        await mensagemDoErro(
          criarChave(base.api, a, {
            ...dados,
            nome: "Errada",
            criadaPor: "operador:teste",
          }),
        ),
      ).toMatch(/violates check constraint/);
    }
  });

  it("a chave pública não aponta para a loja de outro comerciante", async () => {
    expect(
      await mensagemDoErro(
        criarChave(base.api, b, {
          tipo: "publica",
          lojaId: lojaA,
          nome: "Loja alheia",
          ambitos: ["storefront"],
          criadaPor: "operador:teste",
        }),
      ),
    ).toMatch(/foreign key/);
  });

  it("uma chave não se altera nem se apaga, nem pelo dono", async () => {
    const nova = await criarChave(base.api, a, {
      tipo: "servidor",
      nome: "Imutável",
      ambitos: ["catalog:read"],
      criadaPor: "operador:teste",
    });
    for (const consulta of [
      sql`update chave_api set nome = 'outro' where id = ${nova.id}`,
      sql`update chave_api set ambitos = array['keys:write'] where id = ${nova.id}`,
      sql`delete from chave_api where id = ${nova.id}`,
      sql`truncate chave_api`,
    ]) {
      expect(await mensagemDoErro(consulta.execute(base.dono))).toMatch(
        /^(key\.immutable|audit\.append_only):/,
      );
    }
  });

  it("os âmbitos do código são os da base", async () => {
    const { rows } = await sql<{ definicao: string }>`
      select pg_get_constraintdef(oid) as definicao from pg_constraint
      where conname = 'chave_api_ambitos_validos'`.execute(base.dono);
    const naBase = [
      ...(rows[0]?.definicao ?? "").matchAll(/'([a-z_:]+)'/g),
    ].map((m) => m[1]);
    expect(naBase).toEqual([...AMBITOS]);
  });
});
