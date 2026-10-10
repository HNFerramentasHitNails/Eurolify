import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { BaseDados } from "../src/base/esquema.js";
import { abrirBase } from "../src/base/ligacao.js";
import { migrar } from "../src/base/migracoes.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORMATO_SEGREDO, resumoDe } from "../src/identidade/chaves.js";
import { lerPedido } from "../src/identidade/operador.js";
import { resolverChave } from "../src/identidade/repositorio.js";
import {
  FORMATO_CONVITE,
  resumo as resumoConvite,
} from "../src/identidade/sessoes.js";
import { apagarBase, URL_BASE } from "./base-de-teste.js";

// O comando do operador (docs/19 §6): a leitura do pedido, o gerador de
// chaves do computador do operador, e o comando contra a base verdadeira.

const correr = promisify(execFile);
const API = new URL("../", import.meta.url);
const TSC = fileURLToPath(
  new URL("../../../node_modules/.bin/tsc", import.meta.url),
);
// Compila-se como na imagem (dist/operador.js), dentro de node_modules/.cache
// para o Node encontrar o pg e o kysely (como o migrar-processo).
const PASTA = new URL(
  `node_modules/.cache/operador-${randomBytes(6).toString("hex")}/`,
  API,
);
const nome = (texto: string) =>
  Buffer.from(texto, "utf8").toString("base64url");
const RESUMO = "a".repeat(64);

describe("pedido do operador", () => {
  it("lê um pedido de comerciante", () => {
    expect(
      lerPedido(
        `comerciante pt Europe/Lisbon ${nome("Loja da Ana, Lda.")} run:1234567 github:1001`,
      ),
    ).toEqual({
      accao: "comerciante",
      lingua: "pt",
      fuso: "Europe/Lisbon",
      nome: "Loja da Ana, Lda.",
      pedido: "github-run:1234567",
      quem: "github:1001",
    });
  });

  it("lê um pedido de chave", () => {
    const uuid = "0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b";
    expect(
      lerPedido(
        `chave ${uuid} catalog:read,keys:write eul_sk_abcde ${RESUMO} ${nome("Gestão")} github:1001`,
      ),
    ).toMatchObject({
      accao: "chave",
      comercianteId: uuid,
      ambitos: ["catalog:read", "keys:write"],
      prefixo: "eul_sk_abcde",
      nome: "Gestão",
    });
  });

  it("lê um pedido de convite", () => {
    const uuid = "0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b";
    expect(
      lerPedido(
        `convite ${uuid} ${nome(" dono@loja.test ")} dono ${RESUMO} github:1001`,
      ),
    ).toEqual({
      accao: "convite",
      comercianteId: uuid,
      email: "dono@loja.test",
      papel: "dono",
      resumo: RESUMO,
      quem: "github:1001",
    });
  });

  it.each([
    ["", /acção/],
    [
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b ${nome("x@loja.test")} gestor ${RESUMO} github:1`,
      /papel/,
    ],
    [
      `convite nao-uuid ${nome("x@loja.test")} dono ${RESUMO} github:1`,
      /comerciante/,
    ],
    [
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b ${nome("sem-arroba")} dono ${RESUMO} github:1`,
      /e-mail/,
    ],
    [
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b ${nome("a@b\u202Ec.test")} dono ${RESUMO} github:1`,
      /e-mail/,
    ],
    [
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b ${nome(`${"a".repeat(250)}@x.test`)} dono ${RESUMO} github:1`,
      /e-mail: não é base64url/,
    ],
    [
      // 255 caracteres: cabe no base64url, passa do limite da base (P3-4).
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b ${nome(`${"a".repeat(248)}@x.test`)} dono ${RESUMO} github:1`,
      /e-mail: inválido/,
    ],
    // Só domínios reservados para testes (ADR-0019; revisão do #165, P2-1).
    [
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b ${nome("dono@gmail.com")} dono ${RESUMO} github:1`,
      /domínio reservado/,
    ],
    [
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b ${nome("dono@notexample.com")} dono ${RESUMO} github:1`,
      /domínio reservado/,
    ],
    [
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b ${nome("dono@loja.test.evil.com")} dono ${RESUMO} github:1`,
      /domínio reservado/,
    ],
    [
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b dono@loja.test dono ${RESUMO} github:1`,
      /e-mail/,
    ],
    [
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b ${nome("x@loja.test")} dono euc_segredo github:1`,
      /resumo/,
    ],
    [
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b ${nome("x@loja.test")} dono ${RESUMO}`,
      /acção/,
    ],
    ["apagar tudo", /acção/],
    [`comerciante PT Europe/Lisbon ${nome("x")} run:1 github:1`, /língua/],
    [`comerciante pt Europe/Lisbon;rm ${nome("x")} run:1 github:1`, /fuso/],
    [`comerciante pt Europe/Lisbon ${nome("")} run:1 github:1`, /nome/],
    [
      `comerciante pt Europe/Lisbon ${nome("x".repeat(101))} run:1 github:1`,
      /nome/,
    ],
    [`comerciante pt Europe/Lisbon ${nome("a\nb")} run:1 github:1`, /nome/],
    [
      `comerciante pt Europe/Lisbon ${nome("Loja\u202Eadc")} run:1 github:1`,
      /nome/,
    ],
    [`comerciante pt Europe/Lisbon ${nome("x")} run:1 ana`, /quem/],
    // Sem o número da execução, repetir criava outro comerciante (#107).
    [`comerciante pt Europe/Lisbon ${nome("x")} github:1`, /acção/],
    [`comerciante pt Europe/Lisbon ${nome("x")} run:abc github:1`, /execução/],
    [`comerciante pt Europe/Lisbon ${nome("x")} github:1 run:1`, /execução/],
    [
      `chave nao-uuid catalog:read eul_sk_abcde ${RESUMO} ${nome("x")} github:1`,
      /comerciante/,
    ],
    [
      `chave 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b storefront eul_sk_abcde ${RESUMO} ${nome("x")} github:1`,
      /âmbitos/,
    ],
    [
      `chave 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b catalog:read,catalog:read eul_sk_abcde ${RESUMO} ${nome("x")} github:1`,
      /âmbitos/,
    ],
    [
      `chave 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b catalog:read eul_pk_abcde ${RESUMO} ${nome("x")} github:1`,
      /prefixo/,
    ],
    [
      `chave 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b catalog:read eul_sk_abcde ${"g".repeat(64)} ${nome("x")} github:1`,
      /resumo/,
    ],
  ])("recusa %j", (linha, motivo) => {
    expect(() => lerPedido(linha)).toThrow(motivo);
  });

  it("o gerador do operador dá o formato da API e o resumo certo", async () => {
    const { stdout } = await correr("node", [
      "scripts/gerar-chave.mjs",
      "--json",
    ]);
    const { segredo, prefixo, resumo } = JSON.parse(stdout) as {
      segredo: string;
      prefixo: string;
      resumo: string;
    };
    expect(segredo).toMatch(FORMATO_SEGREDO);
    expect(segredo.startsWith("eul_sk_")).toBe(true);
    expect(prefixo).toBe(segredo.slice(0, 12));
    expect(resumo).toBe(resumoDe(segredo));
  });

  it("o gerador do convite dá o formato da API, o resumo e a ligação", async () => {
    const { stdout } = await correr("node", [
      "scripts/gerar-convite.mjs",
      "--json",
      "--hub",
      "https://hub.exemplo.test",
    ]);
    const { segredo, resumo, ligacao } = JSON.parse(stdout) as {
      segredo: string;
      resumo: string;
      ligacao: string;
    };
    expect(segredo).toMatch(FORMATO_CONVITE);
    expect(resumo).toBe(resumoConvite(segredo));
    expect(ligacao).toBe(`https://hub.exemplo.test/convite#${segredo}`);
  });
});

describe.skipIf(URL_BASE === undefined)("comando do operador na base", () => {
  // Como na VPS: o comando liga-se com o dono das tabelas, que NÃO é
  // superutilizador nem salta o RLS. Com um superutilizador, o convite sem o
  // contexto do comerciante passava aqui e falhava lá (42704, 08/10/2026).
  const sufixo = randomBytes(4).toString("hex");
  const papel = `operador_vps_${sufixo}`;
  const nomeBase = `eurolify_operador_${sufixo}`;
  const SENHA = "so-para-testes";
  let admin: pg.Client;
  let urlDono: string;
  // `dono` (superutilizador) só para inspeccionar; `api` como a API.
  const base = {} as { dono: Kysely<unknown>; api: Kysely<BaseDados> };

  const urlCom = (utilizador?: string) => {
    const u = new URL(URL_BASE ?? "");
    u.pathname = `/${nomeBase}`;
    if (utilizador !== undefined) {
      u.username = utilizador;
      u.password = SENHA;
    }
    return u.toString();
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_api') THEN
        CREATE ROLE eurolify_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
      END IF;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END $$`);
    // O papel do operador (0043), como o preparar.sh o cria na VPS: antes
    // das migrações, que lhe dão o EXECUTE nas três portas.
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_operador') THEN
        CREATE ROLE eurolify_operador NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
      END IF;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END $$`);
    await admin.query(
      `CREATE ROLE ${papel} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${SENHA}'`,
    );
    await admin.query(`CREATE DATABASE ${nomeBase} OWNER ${papel}`);
    urlDono = urlCom(papel);
    const migrador = new Kysely<unknown>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: urlDono, max: 1 }),
      }),
    });
    try {
      await migrar(migrador);
    } finally {
      await migrador.destroy();
    }
    await admin.query(`ALTER ROLE eurolify_api LOGIN PASSWORD '${SENHA}'`);
    await admin.query(`ALTER ROLE eurolify_operador LOGIN PASSWORD '${SENHA}'`);
    base.dono = new Kysely<unknown>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: urlCom(), max: 2 }),
      }),
    });
    base.api = abrirBase(urlCom("eurolify_api"));
    await mkdir(PASTA, { recursive: true });
    await correr(TSC, [
      "-p",
      fileURLToPath(new URL("tsconfig.build.json", API)),
      "--outDir",
      fileURLToPath(new URL("dist", PASTA)),
    ]);
  }, 120_000);

  afterAll(async () => {
    await rm(PASTA, { recursive: true, force: true });
    try {
      await base.api.destroy();
      await base.dono.destroy();
    } finally {
      try {
        await apagarBase(admin, nomeBase);
      } finally {
        try {
          await admin.query(`DROP ROLE IF EXISTS ${papel}`);
        } finally {
          await admin.end();
        }
      }
    }
  });

  it("o dono das tabelas é como o da VPS: sem poderes", async () => {
    const r = await admin.query<{ super: boolean; bypass: boolean }>(
      "select rolsuper as super, rolbypassrls as bypass from pg_roles where rolname = $1",
      [papel],
    );
    expect(r.rows).toEqual([{ super: false, bypass: false }]);
  });

  /** Corre o comando como na VPS: `node dist/operador.js`, com a ligação do papel do operador (0043). */
  async function operador(pedido: string) {
    try {
      const { stdout, stderr } = await correr(
        "node",
        [fileURLToPath(new URL("dist/operador.js", PASTA)), pedido],
        {
          env: {
            ...process.env,
            BASE_DADOS_URL_OPERADOR: urlCom("eurolify_operador"),
          },
        },
      );
      return { codigo: 0, stdout, stderr };
    } catch (erro) {
      const e = erro as { code?: number; stdout?: string; stderr?: string };
      return {
        codigo: e.code ?? -1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
      };
    }
  }

  it("cria o comerciante e depois a primeira chave, que a API aceita", async () => {
    const c = await operador(
      `comerciante pt Europe/Lisbon ${nome("Loja de Ensaio")} run:1001001 github:1001`,
    );
    expect(c.codigo, c.stderr).toBe(0);
    const comerciante = (
      JSON.parse(c.stdout) as { comerciante: string }
    ).comerciante.replace(/^mer_/, "");

    const { stdout } = await correr("node", [
      "scripts/gerar-chave.mjs",
      "--json",
    ]);
    const gerada = JSON.parse(stdout) as {
      segredo: string;
      prefixo: string;
      resumo: string;
    };
    const k = await operador(
      `chave ${comerciante} keys:write,catalog:read ${gerada.prefixo} ${gerada.resumo} ${nome("Primeira")} github:1001`,
    );
    expect(k.codigo, k.stderr).toBe(0);
    expect(k.stdout).not.toContain(gerada.resumo);

    const contexto = await resolverChave(base.api, gerada.segredo);
    expect(contexto).toMatchObject({
      comercianteId: comerciante,
      ambitos: ["keys:write", "catalog:read"],
    });
    const { rows } = await sql<{ criada_por: string }>`
      select criada_por from chave_api where resumo = ${gerada.resumo}`.execute(
      base.dono,
    );
    expect(rows[0]?.criada_por).toBe("operador:github:1001");
  }, 60_000);

  it("cria o convite do primeiro dono, que a base guarda com o resumo e quem", async () => {
    const c = await operador(
      `comerciante pt Europe/Lisbon ${nome("Loja do Convite")} run:1001002 github:1001`,
    );
    expect(c.codigo, c.stderr).toBe(0);
    const comerciante = (
      JSON.parse(c.stdout) as { comerciante: string }
    ).comerciante.replace(/^mer_/, "");
    const { stdout } = await correr("node", [
      "scripts/gerar-convite.mjs",
      "--json",
    ]);
    const gerado = JSON.parse(stdout) as { segredo: string; resumo: string };

    const r = await operador(
      `convite ${comerciante} ${nome("dono@loja.test")} dono ${gerado.resumo} github:1001`,
    );
    expect(r.codigo, r.stderr).toBe(0);
    const { convite } = JSON.parse(r.stdout) as { convite: string };
    expect(convite).toMatch(/^inv_[0-9a-f-]{36}$/);
    expect(r.stdout).not.toContain("dono@loja.test");
    expect(r.stdout).not.toContain(gerado.resumo);

    const { rows } = await sql<{
      email: string;
      papel: string;
      convidado_por: string;
      dias: number;
    }>`
      select email, papel, convidado_por,
             round(extract(epoch from expira_em - now()) / 86400)::int as dias
      from convite where id = ${convite.replace(/^inv_/, "")}::uuid
        and resumo = ${gerado.resumo}`.execute(base.dono);
    expect(rows).toEqual([
      {
        email: "dono@loja.test",
        papel: "dono",
        convidado_por: "operador:github:1001",
        dias: 7,
      },
    ]);
    const eventos = await sql<{ quem: string }>`
      select quem from evento_conta
      where acto = 'convite_criado' and comerciante_id = ${comerciante}::uuid`.execute(
      base.dono,
    );
    expect(eventos.rows).toEqual([{ quem: "operador:github:1001" }]);

    // De ponta a ponta: o segredo da ligação gerada aceita o convite e faz
    // um dono (revisão do #165, P3-5).
    const aceite = await sql<{ comerciante_id: string }>`
      select comerciante_id from convite_aceitar_conta_nova(${gerado.segredo},
        'Ana Teste')`.execute(base.dono);
    expect(aceite.rows).toEqual([{ comerciante_id: comerciante }]);
    const donos = await sql<{ papel: string }>`
      select papel from membro where comerciante_id = ${comerciante}::uuid`.execute(
      base.dono,
    );
    expect(donos.rows).toEqual([{ papel: "dono" }]);
  }, 60_000);

  it("um convite para um comerciante que não existe falha sem escrever", async () => {
    const r = await operador(
      `convite 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b ${nome("x@loja.test")} dono ${"c".repeat(64)} github:1001`,
    );
    expect(r.codigo).toBe(1);
    expect(r.stderr).not.toContain("x@loja.test");
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from convite where resumo = ${"c".repeat(64)}`.execute(
      base.dono,
    );
    expect(rows[0]?.n).toBe(0);
  }, 60_000);

  it("um pedido inválido sai com 65 e não repete o pedido", async () => {
    // O «quem» é válido: a recusa é pelo nome, que tem de ser lido primeiro
    // (revisão do #110, P2-6).
    const r = await operador(
      "comerciante pt Europe/Lisbon segredo-qualquer run:1 github:1001",
    );
    expect(r.codigo).toBe(65);
    expect(r.stderr).not.toContain("segredo-qualquer");
  }, 60_000);

  it("uma chave para um comerciante que não existe falha sem escrever", async () => {
    const r = await operador(
      `chave 0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b catalog:read eul_sk_abcde ${"b".repeat(64)} ${nome("x")} github:1001`,
    );
    expect(r.codigo).toBe(1);
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from chave_api where resumo = ${"b".repeat(64)}`.execute(
      base.dono,
    );
    expect(rows[0]?.n).toBe(0);
  }, 60_000);

  it("o mesmo pedido outra vez (um «Re-run») devolve o mesmo comerciante, sem criar outro (#107)", async () => {
    const pedido = `comerciante pt Europe/Lisbon ${nome("Loja Repetida")} run:2002002 github:1001`;
    const primeira = await operador(pedido);
    expect(primeira.codigo, primeira.stderr).toBe(0);
    const segunda = await operador(pedido);
    expect(segunda.codigo, segunda.stderr).toBe(0);
    const a = JSON.parse(primeira.stdout) as {
      comerciante: string;
      ja_existia: boolean;
    };
    const b = JSON.parse(segunda.stdout) as typeof a;
    expect(a.ja_existia).toBe(false);
    expect(b).toEqual({ comerciante: a.comerciante, ja_existia: true });
    // Outra execução, o mesmo nome: é outro pedido, outro comerciante.
    const outra = await operador(pedido.replace("run:2002002", "run:2002003"));
    expect(outra.codigo, outra.stderr).toBe(0);
    expect((JSON.parse(outra.stdout) as typeof a).comerciante).not.toBe(
      a.comerciante,
    );
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from pedido_do_operador
      where pedido in ('github-run:2002002', 'github-run:2002003')`.execute(
      base.dono,
    );
    expect(rows[0]?.n).toBe(2);
  }, 60_000);

  it("dois pedidos iguais ao mesmo tempo criam um só comerciante", async () => {
    const pedido = `comerciante pt Europe/Lisbon ${nome("Loja em Corrida")} run:3003003 github:1001`;
    const [x, y] = await Promise.all([operador(pedido), operador(pedido)]);
    expect(x.codigo, x.stderr).toBe(0);
    expect(y.codigo, y.stderr).toBe(0);
    const ids = [x, y].map(
      (r) => (JSON.parse(r.stdout) as { comerciante: string }).comerciante,
    );
    expect(ids[0]).toBe(ids[1]);
    const existia = [x, y].map(
      (r) => (JSON.parse(r.stdout) as { ja_existia: boolean }).ja_existia,
    );
    expect(existia.sort()).toEqual([false, true]);
  }, 60_000);

  it("o papel do operador não é superutilizador, não passa o RLS e só chama as três portas (revisão do #110, P3-8)", async () => {
    const r = await admin.query<{ super: boolean; bypass: boolean }>(
      "select rolsuper as super, rolbypassrls as bypass from pg_roles where rolname = 'eurolify_operador'",
    );
    expect(r.rows).toEqual([{ super: false, bypass: false }]);
    const { rows } = await sql<{ funcao: string }>`
      select p.proname as funcao from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and has_function_privilege('eurolify_operador', p.oid, 'EXECUTE')
      order by 1`.execute(base.dono);
    expect(rows.map((l) => l.funcao)).toEqual([
      "chave_criar",
      "comerciante_criar_pelo_operador",
      "convite_criar_pelo_operador",
    ]);
    const tabelas = await sql<{ tabela: string }>`
      select c.relname as tabela from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and (has_table_privilege('eurolify_operador', c.oid, 'SELECT')
          or has_table_privilege('eurolify_operador', c.oid, 'INSERT')
          or has_table_privilege('eurolify_operador', c.oid, 'UPDATE')
          or has_table_privilege('eurolify_operador', c.oid, 'DELETE'))`.execute(
      base.dono,
    );
    expect(tabelas.rows).toEqual([]);
    // Entrar com ele e tentar o que o dono podia: ler os comerciantes ou
    // revogar uma chave é recusado.
    const operadorDireto = new pg.Client({
      connectionString: urlCom("eurolify_operador"),
    });
    await operadorDireto.connect();
    try {
      await expect(
        operadorDireto.query("select count(*) from comerciante"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        operadorDireto.query(
          "select chave_revogar('0199b1c2-3d4e-7f00-8a9b-0c1d2e3f4a5b', 'x')",
        ),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await operadorDireto.end();
    }
  }, 60_000);
});
