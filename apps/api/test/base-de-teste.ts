import { randomBytes } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { BaseDados } from "../src/base/esquema.js";
import { abrirBase } from "../src/base/ligacao.js";
import { migrar } from "../src/base/migracoes.js";

// Uma base nova por ficheiro de testes, migrada com o superutilizador (como o
// dono das tabelas) e usada com o `eurolify_api` — o superutilizador ignora o
// RLS e não provaria nada (docs/15 §5).
export const URL_BASE = process.env["BASE_DADOS_URL"];

const SENHA_DE_TESTE = "so-para-testes";

export interface BaseDeTeste {
  /** Ligada como `eurolify_api`: é com esta que se testa o isolamento. */
  api: Kysely<BaseDados>;
  /** Ligada como superutilizador, só para preparar e inspeccionar. */
  dono: Kysely<unknown>;
  /** URL do `eurolify_api` nesta base. */
  urlApi: string;
  fechar: () => Promise<void>;
}

function comBase(url: string, nome: string, utilizador?: string): string {
  const u = new URL(url);
  u.pathname = `/${nome}`;
  if (utilizador !== undefined) {
    u.username = utilizador;
    u.password = SENHA_DE_TESTE;
  }
  return u.toString();
}

export async function criarBaseDeTeste(urlBase: string): Promise<BaseDeTeste> {
  const nome = `eurolify_teste_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: urlBase });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${nome}`);
  } finally {
    await admin.end();
  }

  const dono = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: comBase(urlBase, nome), max: 2 }),
    }),
  });
  await migrar(dono);
  // A palavra-passe do eurolify_api é da configuração de cada ambiente, nunca
  // da migração; aqui é a dos testes.
  const cliente = new pg.Client({ connectionString: comBase(urlBase, nome) });
  await cliente.connect();
  try {
    await cliente.query(
      `ALTER ROLE eurolify_api LOGIN PASSWORD '${SENHA_DE_TESTE}'`,
    );
  } finally {
    await cliente.end();
  }

  const urlApi = comBase(urlBase, nome, "eurolify_api");
  const api = abrirBase(urlApi);

  return {
    api,
    dono,
    urlApi,
    fechar: async () => {
      await api.destroy();
      await dono.destroy();
      const fim = new pg.Client({ connectionString: urlBase });
      await fim.connect();
      try {
        await fim.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
      } finally {
        await fim.end();
      }
    },
  };
}
