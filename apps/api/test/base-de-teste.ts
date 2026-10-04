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

/**
 * Espera que nenhuma ligação use a base `nome` antes de a apagar. Um pool
 * fecha as ligações sem esperar que o servidor as largue; um `DROP … WITH
 * (FORCE)` nesse intervalo termina-as (57P01) e o cliente, já a fechar, lança
 * um erro que ninguém apanha e que o vitest conta como falha (CI do main,
 * 04/10/2026, depois do #43). Ao fim de 5 s, erro explícito.
 */
export async function esperarQueSaiam(
  admin: pg.Client,
  nome: string,
): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const { rows } = await admin.query<{ n: number }>(
      "select count(*)::int as n from pg_stat_activity where datname = $1",
      [nome],
    );
    if ((rows[0]?.n ?? 0) === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`a base de teste ${nome} ainda tem ligações ao fim de 5 s`);
}

/**
 * Apaga a base de teste depois de esperar pelas ligações; apaga-a mesmo que a
 * espera falhe, e só depois devolve esse erro.
 */
export async function apagarBase(
  admin: pg.Client,
  nome: string,
): Promise<void> {
  try {
    await esperarQueSaiam(admin, nome);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
  }
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
        await apagarBase(fim, nome);
      } finally {
        // O papel é da instância, não da base: volta a ficar sem acesso e sem
        // palavra-passe (revisão do #43, P2-5). Só um ficheiro de testes usa a
        // base de cada vez; se passarem a ser vários em paralelo, mudar isto.
        // Se a corrida for morta antes daqui, o papel fica com LOGIN e a
        // palavra-passe de teste nesta instância (só em máquinas de teste).
        try {
          await fim.query("ALTER ROLE eurolify_api NOLOGIN PASSWORD NULL");
        } finally {
          await fim.end();
        }
      }
    },
  };
}
