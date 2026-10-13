import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarArtigo } from "../src/catalogo/repositorio.js";
import {
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A cópia e a reposição da VPS (`infra/vps/ficheiros/sbin/eurolify-copia` e
// `eurolify-reposicao`; ADR-0027) são completas: `pg_dump -Fc` e
// `pg_restore` sem `--data-only`. Os dados entram antes de os gatilhos
// serem criados, por isso nenhum gatilho corre na reposição — nem os
// `ALWAYS` — e a base reposta fica igual à copiada, linha a linha (#444).
// Uma reposição só de dados, ou uma replicação lógica, pede primeiro uma
// revisão dos gatilhos `ALWAYS` (docs/28 §7).

/** O PostgreSQL do contentor `postgres`, como no fluxo `verificar`. */
const CONTENTOR = "postgres";
const docker = (args: string[], entrada?: Buffer) =>
  spawnSync("docker", ["exec", "-i", CONTENTOR, ...args], {
    input: entrada,
    maxBuffer: 512 * 1024 * 1024,
  });
const temDocker = spawnSync("docker", ["exec", CONTENTOR, "true"]).status === 0;
if (process.env["EXIGIR_BASE"] === "1" && !temDocker) {
  throw new Error(
    `EXIGIR_BASE=1 mas o contentor ${CONTENTOR} não responde: a cópia não pode saltar`,
  );
}

/** Cada tabela do esquema public: linhas e um resumo do conteúdo. */
function retrato(base: string): string {
  const r = docker([
    "psql",
    "-U",
    "postgres",
    "-d",
    base,
    "-tAc",
    `select c.relname || ' ' || (xpath('/row/n/text()', x))[1]::text || ' ' ||
       (xpath('/row/h/text()', x))[1]::text
     from pg_class c join pg_namespace s on s.oid = c.relnamespace,
     lateral query_to_xml(format(
       'select count(*) as n, md5(coalesce(string_agg(t::text, %L order by t::text), %L)) as h from %I t',
       chr(10), '', c.relname), false, true, '') as x
     where s.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
  ]);
  expect(r.status, r.stderr.toString()).toBe(0);
  return r.stdout.toString();
}

describe.skipIf(URL_BASE === undefined || !temDocker)(
  "a cópia completa e a reposição da VPS (#444)",
  () => {
    let base: BaseDeTeste;
    let nome: string;
    const reposta = `eurolify_reposta_${randomBytes(6).toString("hex")}`;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      nome = new URL(base.urlApi).pathname.slice(1);
      // Linhas que passam por gatilhos ALWAYS: os que mudam a própria linha
      // (a data da chave, o estado da pessoa) e os que escrevem noutra
      // tabela (a linha do tempo do catálogo).
      const c = await registarComerciante(base.api, {
        nome: "Loja da Cópia",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const entidade = await criarEntidadeLegal(base.api, c, {
        denominacao: "Cópia, Lda.",
        forma_juridica: "sociedade por quotas",
        pais: "PT",
        numero_fiscal: "123456789",
        morada_linha: "Rua de Teste, 1",
        morada_codigo_postal: "1000-001",
        morada_localidade: "Lisboa",
      });
      await criarLoja(base.api, c, {
        entidade_legal_id: entidade,
        nome: "Loja online",
      });
      await criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Integração",
        ambitos: ["catalog:read"],
      });
      await criarArtigo(
        base.api,
        c,
        { tipo: "fisico", nome: "Verniz", categoria_fiscal: "normal" },
        [{ sku: "VERNIZ-1", unidade_de_venda: "unidade" }],
      );
    }, 120_000);

    afterAll(async () => {
      docker([
        "psql",
        "-U",
        "postgres",
        "-qc",
        `drop database if exists ${reposta}`,
      ]);
      await base.fechar();
    });

    it("repõe tudo igual: nenhum gatilho corre, nem os ALWAYS", () => {
      const copia = docker(["pg_dump", "-U", "postgres", "-Fc", nome]);
      expect(copia.status, copia.stderr.toString()).toBe(0);
      // Como a `eurolify-reposicao`: uma base nova, `pg_restore --no-owner`.
      const criar = docker([
        "psql",
        "-U",
        "postgres",
        "-qc",
        `create database ${reposta}`,
      ]);
      expect(criar.status, criar.stderr.toString()).toBe(0);
      const repor = docker(
        [
          "pg_restore",
          "-U",
          "postgres",
          "--no-owner",
          "--exit-on-error",
          "-d",
          reposta,
        ],
        copia.stdout,
      );
      expect(repor.status, repor.stderr.toString()).toBe(0);
      const antes = retrato(nome);
      expect(antes).toMatch(/^alteracao_catalogo [1-9]/m);
      expect(antes).toMatch(/^chave_api [1-9]/m);
      expect(retrato(reposta)).toBe(antes);
      // Os gatilhos vêm no fim da cópia, depois dos dados.
      const lista = docker(["pg_restore", "-l"], copia.stdout)
        .stdout.toString()
        .split("\n");
      const ultimoDado = lista.findLastIndex((l) => / TABLE DATA /.test(l));
      const primeiroGatilho = lista.findIndex((l) => / TRIGGER /.test(l));
      expect(primeiroGatilho).toBeGreaterThan(ultimoDado);
    }, 120_000);
  },
);
