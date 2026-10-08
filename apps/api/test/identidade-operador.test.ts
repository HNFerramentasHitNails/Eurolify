import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORMATO_SEGREDO, resumoDe } from "../src/identidade/chaves.js";
import { lerPedido } from "../src/identidade/operador.js";
import { resolverChave } from "../src/identidade/repositorio.js";
import {
  FORMATO_CONVITE,
  resumo as resumoConvite,
} from "../src/identidade/sessoes.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

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
        `comerciante pt Europe/Lisbon ${nome("Loja da Ana, Lda.")} github:1001`,
      ),
    ).toEqual({
      accao: "comerciante",
      lingua: "pt",
      fuso: "Europe/Lisbon",
      nome: "Loja da Ana, Lda.",
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
      /e-mail/,
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
    [`comerciante PT Europe/Lisbon ${nome("x")} github:1`, /língua/],
    [`comerciante pt Europe/Lisbon;rm ${nome("x")} github:1`, /fuso/],
    [`comerciante pt Europe/Lisbon ${nome("")} github:1`, /nome/],
    [`comerciante pt Europe/Lisbon ${nome("x".repeat(101))} github:1`, /nome/],
    [`comerciante pt Europe/Lisbon ${nome("a\nb")} github:1`, /nome/],
    [`comerciante pt Europe/Lisbon ${nome("Loja\u202Eadc")} github:1`, /nome/],
    [`comerciante pt Europe/Lisbon ${nome("x")} ana`, /quem/],
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
  let base: BaseDeTeste;
  let urlDono: string;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    const { rows } = await sql<{ nome: string }>`
      select current_database() as nome`.execute(base.dono);
    const u = new URL(URL_BASE ?? "");
    u.pathname = `/${rows[0]?.nome ?? ""}`;
    urlDono = u.toString();
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
    await base.fechar();
  });

  /** Corre o comando como na VPS: `node dist/operador.js`, com a ligação do dono. */
  async function operador(pedido: string) {
    try {
      const { stdout, stderr } = await correr(
        "node",
        [fileURLToPath(new URL("dist/operador.js", PASTA)), pedido],
        { env: { ...process.env, BASE_DADOS_URL_MIGRACAO: urlDono } },
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
      `comerciante pt Europe/Lisbon ${nome("Loja de Ensaio")} github:1001`,
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
      `comerciante pt Europe/Lisbon ${nome("Loja do Convite")} github:1001`,
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
      "comerciante pt Europe/Lisbon segredo-qualquer github:1001",
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
});
