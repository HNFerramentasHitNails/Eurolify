import { createHash, randomBytes } from "node:crypto";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Contas de pessoas, parte B4: a tarefa dos prazos (migração 0026; docs/21
// §6 e §13; decisão CD; issue #140). A função chama-a o programa
// eurolify-limpeza da VPS com o papel eurolify_limpeza; a API não a pode
// chamar. Cada prazo testa-se dos dois lados: um minuto depois apaga, um dia
// antes fica.

const OPERADOR = "operador:github:1001";
const segredo = () => randomBytes(32).toString("base64url");
const resumoDe = (s: string) => createHash("sha256").update(s).digest("hex");
const hex64 = () => randomBytes(32).toString("hex");
const RESUMO_ARGON =
  "$argon2id$v=19$m=65536,t=3,p=4$" + "A".repeat(22) + "$" + "B".repeat(43);

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    return String((erro as { message?: unknown }).message);
  }
  return "sem erro";
}

type Contagem = Record<string, number>;

describe.skipIf(URL_BASE === undefined)("prazos das contas (0026)", () => {
  let base: BaseDeTeste;
  let dono: Kysely<unknown>;
  let a: string;
  let b: string;

  async function aplicar(db: Kysely<unknown> = dono): Promise<Contagem> {
    const { rows } = await sql<{ o_que: string; quantas: number }>`
      select * from contas_aplicar_prazos()`.execute(db);
    return Object.fromEntries(rows.map((r) => [r.o_que, r.quantas]));
  }

  async function emAtraso(): Promise<number> {
    const { rows } = await sql<{ n: number }>`
      select contas_prazos_em_atraso() as n`.execute(dono);
    return rows[0]?.n ?? -1;
  }

  /** Muda uma data que a base não deixa mudar (só nos testes). */
  async function envelhecer(
    tabela: string,
    gatilho: string | null,
    definir: string,
    id: string,
  ) {
    await dono.transaction().execute(async (trx) => {
      if (gatilho !== null) {
        await sql`alter table ${sql.table(tabela)} disable trigger ${sql.raw(gatilho)}`.execute(
          trx,
        );
      }
      await sql`update ${sql.table(tabela)} set ${sql.raw(definir)}
        where id = ${id}::uuid`.execute(trx);
      if (gatilho !== null) {
        await sql`alter table ${sql.table(tabela)} enable always trigger ${sql.raw(gatilho)}`.execute(
          trx,
        );
      }
    });
  }

  async function convidar(comerciante: string, email: string) {
    const s = segredo();
    await sql`select convite_criar_pelo_operador(${comerciante}::uuid,
      ${email}, 'gestor', ${resumoDe(s)}, ${OPERADOR})`.execute(dono);
    const { rows } = await sql<{ id: string }>`
      select id from convite where resumo = ${resumoDe(s)}`.execute(dono);
    return { segredo: s, id: rows[0]?.id ?? "" };
  }

  async function sessaoDe(pessoa: string): Promise<string> {
    const s = segredo();
    await sql`select sessao_criar(${pessoa}::uuid, ${resumoDe(s)})`.execute(
      dono,
    );
    return s;
  }

  async function sessaoId(s: string): Promise<string> {
    const { rows } = await sql<{ id: string }>`
      select id from sessao where resumo = ${resumoDe(s)}`.execute(dono);
    return rows[0]?.id ?? "";
  }

  /** Uma pessoa nova, membro de `comerciante`. */
  async function pessoaEm(comerciante: string) {
    const email = `p${randomBytes(4).toString("hex")}@exemplo.test`;
    const c = await convidar(comerciante, email);
    const { rows } = await sql<{ pessoa_id: string; membro_id: string }>`
      select * from convite_aceitar_conta_nova(${c.segredo}, 'Ana Teste')`.execute(
      dono,
    );
    return {
      pessoa: rows[0]?.pessoa_id ?? "",
      membro: rows[0]?.membro_id ?? "",
      email,
      convite: c.id,
    };
  }

  /** O membro sai, e a saída fica `dias` atrás. */
  async function saiuHa(membro: string, dias: number) {
    await sql`update membro set terminado_por = ${OPERADOR}
      where id = ${membro}::uuid`.execute(dono);
    await envelhecer(
      "membro",
      "membro_antes_de_gravar",
      `ate = now() - interval '${String(dias)} days'`,
      membro,
    );
  }

  async function pessoa(id: string) {
    const { rows } = await sql<{
      email: string;
      nome: string;
      estado: string;
      pseudonimizada: boolean;
    }>`select email, nome, estado, pseudonimizada_em is not null as pseudonimizada
       from pessoa where id = ${id}::uuid`.execute(dono);
    return rows[0];
  }

  async function contar(tabela: string, pessoaId: string): Promise<number> {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from ${sql.table(tabela)}
      where pessoa_id = ${pessoaId}::uuid`.execute(dono);
    return rows[0]?.n ?? -1;
  }

  /** Uma ligação à parte (o pool dos testes tem duas). */
  async function outraLigacao(): Promise<pg.Client & { pid: number }> {
    const u = new URL(base.urlApi);
    const superior = new URL(URL_BASE ?? "");
    u.username = superior.username;
    u.password = superior.password;
    const c = new pg.Client({ connectionString: u.toString() });
    await c.connect();
    const { rows } = await c.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    return Object.assign(c, { pid: rows[0]?.pid ?? -1 });
  }

  /** A ligação `pid` fica à espera de uma tranca (revisão do #152, P3-4). */
  async function aEspera(pid: number): Promise<boolean> {
    for (let i = 0; i < 100; i++) {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity
        where pid = ${pid} and wait_event_type = 'Lock'`.execute(dono);
      if ((rows[0]?.n ?? 0) > 0) return true;
      await new Promise((r) => {
        setTimeout(r, 50);
      });
    }
    return false;
  }

  /** Uma transacção aberta até `soltar()`, depois de `fn` correr. */
  async function aberta<T>(fn: (trx: Kysely<unknown>) => Promise<T>) {
    let soltar = () => {};
    const portao = new Promise<void>((r) => {
      soltar = r;
    });
    let entrou: (valor: T) => void = () => {};
    const dentro = new Promise<T>((r) => {
      entrou = r;
    });
    const fim = dono.transaction().execute(async (trx) => {
      entrou(await fn(trx));
      await portao;
    });
    return { resultado: await dentro, soltar, fim };
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    dono = base.dono;
    const novo = { nome: "Loja", lingua: "pt", fuso: "Europe/Lisbon" };
    a = await registarComerciante(base.api, novo);
    b = await registarComerciante(base.api, novo);
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  it("registo de entradas: apaga as de mais de 14 dias, fica a de 13", async () => {
    await aplicar();
    const p = await pessoaEm(a);
    await sql`insert into entrada (quando, pessoa_id, metodo, resultado, ip) values
      (now() - interval '14 days 1 minute', ${p.pessoa}::uuid, 'passkey', 'ok', '192.0.2.1'),
      (now() - interval '13 days', ${p.pessoa}::uuid, 'passkey', 'ok', '192.0.2.2')`.execute(
      dono,
    );
    await sql`insert into entrada (quando, email_resumo, metodo, resultado, ip) values
      (now() - interval '20 days', ${hex64()}, 'recuperacao', 'falhou', '192.0.2.3')`.execute(
      dono,
    );
    expect((await aplicar())["entradas"]).toBe(2);
    const { rows } = await sql<{ ip: string }>`
      select host(ip) as ip from entrada order by quando`.execute(dono);
    expect(rows.map((r) => r.ip)).toEqual(["192.0.2.2"]);
  });

  it("códigos usados, desafios velhos e palavras-passe pendentes de mais de 1 dia", async () => {
    await aplicar();
    const p = await pessoaEm(a);
    const q = await pessoaEm(a);
    await sql`insert into codigo_recuperacao (pessoa_id, resumo, usado_em) values
      (${p.pessoa}::uuid, ${hex64()}, now()),
      (${p.pessoa}::uuid, ${hex64()}, null)`.execute(dono);
    await sql`insert into desafio_webauthn (resumo, finalidade, criado_em, usado_em) values
      (${hex64()}, 'entrar', now() - interval '6 minutes', null),
      (${hex64()}, 'entrar', now(), now()),
      (${hex64()}, 'entrar', now(), null)`.execute(dono);
    await sql`insert into palavra_passe (pessoa_id, estado, resumo, totp_cifrado, chave_versao) values
      (${p.pessoa}::uuid, 'pendente', ${RESUMO_ARGON}, ${randomBytes(40)}, 1),
      (${p.pessoa}::uuid, 'activa', ${RESUMO_ARGON}, ${randomBytes(40)}, 1),
      (${q.pessoa}::uuid, 'pendente', ${RESUMO_ARGON}, ${randomBytes(40)}, 1)`.execute(
      dono,
    );
    const { rows: pp } = await sql<{ id: string }>`
      select id from palavra_passe where pessoa_id = ${p.pessoa}::uuid`.execute(
      dono,
    );
    for (const w of pp) {
      await envelhecer(
        "palavra_passe",
        "palavra_passe_antes_de_gravar",
        "criada_em = now() - interval '1 day 1 minute'",
        w.id,
      );
    }
    const feito = await aplicar();
    expect(feito["codigos_usados"]).toBe(1);
    expect(feito["desafios"]).toBe(2);
    expect(feito["palavras_passe_pendentes"]).toBe(1);
    expect(await contar("codigo_recuperacao", p.pessoa)).toBe(1);
    const { rows: ficam } = await sql<{ pessoa: string; estado: string }>`
      select pessoa_id::text as pessoa, estado from palavra_passe
      where pessoa_id in (${p.pessoa}::uuid, ${q.pessoa}::uuid)
      order by estado`.execute(dono);
    // A activa velha fica (só a pendente tem prazo); a pendente nova fica.
    expect(ficam).toEqual([
      { pessoa: p.pessoa, estado: "activa" },
      { pessoa: q.pessoa, estado: "pendente" },
    ]);
  });

  it("sessões: apaga as acabadas há mais de 30 dias (revogadas ou expiradas), não as outras", async () => {
    await aplicar();
    const p = await pessoaEm(a);
    const velhaRevogada = await sessaoId(await sessaoDe(p.pessoa));
    const recenteRevogada = await sessaoId(await sessaoDe(p.pessoa));
    const expirada = await sessaoId(await sessaoDe(p.pessoa));
    const quaseExpirada = await sessaoId(await sessaoDe(p.pessoa));
    const valida = await sessaoId(await sessaoDe(p.pessoa));
    await envelhecer(
      "sessao",
      "sessao_antes_de_gravar",
      "revogada_em = now() - interval '30 days 1 minute', revogada_motivo = 'saiu'",
      velhaRevogada,
    );
    await envelhecer(
      "sessao",
      "sessao_antes_de_gravar",
      "revogada_em = now() - interval '29 days', revogada_motivo = 'saiu'",
      recenteRevogada,
    );
    // Sem uso há 42 dias e 12 h: expirou há 42 dias.
    await envelhecer(
      "sessao",
      "sessao_antes_de_gravar",
      "criada_em = now() - interval '50 days', ultimo_uso_em = now() - interval '42 days 12 hours'",
      expirada,
    );
    // Criada há 59 dias: expirou (30 dias) há 29.
    await envelhecer(
      "sessao",
      "sessao_antes_de_gravar",
      "criada_em = now() - interval '59 days', ultimo_uso_em = now() - interval '1 hour'",
      quaseExpirada,
    );
    // A base recusa apagar à mão uma sessão ainda no prazo.
    expect(
      await mensagemDoErro(
        sql`delete from sessao where id = ${recenteRevogada}::uuid`.execute(
          dono,
        ),
      ),
    ).toContain("account.immutable");
    expect((await aplicar())["sessoes"]).toBe(2);
    const { rows } = await sql<{ id: string }>`
      select id::text from sessao where pessoa_id = ${p.pessoa}::uuid order by id`.execute(
      dono,
    );
    expect(rows.map((r) => r.id).sort()).toEqual(
      [recenteRevogada, quaseExpirada, valida].sort(),
    );
  });

  it("convites: pseudonimiza o e-mail 30 dias depois do fim; a base recusa antes", async () => {
    await aplicar();
    const aceiteVelho = (await pessoaEm(a)).convite;
    const aceiteNovo = (await pessoaEm(a)).convite;
    const expirado = (await convidar(a, "expirado@exemplo.test")).id;
    const aberto = (await convidar(a, "aberto@exemplo.test")).id;
    await envelhecer(
      "convite",
      "convite_antes_de_gravar",
      "aceite_em = now() - interval '30 days 1 minute'",
      aceiteVelho,
    );
    await envelhecer(
      "convite",
      "convite_antes_de_gravar",
      "aceite_em = now() - interval '29 days'",
      aceiteNovo,
    );
    await envelhecer(
      "convite",
      "convite_antes_de_gravar",
      "criado_em = now() - interval '40 days', expira_em = now() - interval '31 days'",
      expirado,
    );
    expect(
      await mensagemDoErro(
        sql`update convite set email = pseudonimo(id) where id = ${aceiteNovo}::uuid`.execute(
          dono,
        ),
      ),
    ).toContain("account.retention");
    // Outro e-mail que não o pseudónimo continua recusado, mesmo no fim.
    expect(
      await mensagemDoErro(
        sql`update convite set email = 'outro@exemplo.test' where id = ${aceiteVelho}::uuid`.execute(
          dono,
        ),
      ),
    ).toContain("account.immutable");
    expect((await aplicar())["convites"]).toBe(2);
    const { rows } = await sql<{ id: string; email: string }>`
      select id::text, email from convite
      where id in (${aceiteVelho}::uuid, ${aceiteNovo}::uuid, ${expirado}::uuid, ${aberto}::uuid)`.execute(
      dono,
    );
    const email = Object.fromEntries(rows.map((r) => [r.id, r.email]));
    expect(email[aceiteVelho]).toBe(
      `pseudonimo+${aceiteVelho}@eurolify.invalid`,
    );
    expect(email[expirado]).toBe(`pseudonimo+${expirado}@eurolify.invalid`);
    expect(email[aceiteNovo]).toMatch(/@exemplo\.test$/);
    expect(email[aberto]).toBe("aberto@exemplo.test");
    // O rasto continua a apontar para o convite.
    const { rows: rasto } = await sql<{ n: number }>`
      select count(*)::int as n from evento_conta where convite_id = ${aceiteVelho}::uuid`.execute(
      dono,
    );
    expect(rasto[0]?.n).toBeGreaterThan(0);
  });

  it("pessoas: pseudonimiza 90 dias depois de sair do último comerciante; apaga as credenciais; o rasto fica (CD)", async () => {
    await aplicar();
    const saiu = await pessoaEm(a);
    const quase = await pessoaEm(a);
    const aindaNoutro = await pessoaEm(a);
    const s = await sessaoDe(saiu.pessoa);
    await sql`insert into passkey (pessoa_id, credencial_id, chave_publica, contador, nome)
      values (${saiu.pessoa}::uuid, ${"A".repeat(20)}, ${randomBytes(32)}, 0, 'Telemóvel')`.execute(
      dono,
    );
    await sql`insert into palavra_passe (pessoa_id, estado, resumo, totp_cifrado, chave_versao)
      values (${saiu.pessoa}::uuid, 'activa', ${RESUMO_ARGON}, ${randomBytes(40)}, 1)`.execute(
      dono,
    );
    await sql`insert into codigo_recuperacao (pessoa_id, resumo)
      values (${saiu.pessoa}::uuid, ${hex64()})`.execute(dono);
    await saiuHa(saiu.membro, 91);
    await saiuHa(quase.membro, 89);
    await saiuHa(aindaNoutro.membro, 100);
    const c = await convidar(b, aindaNoutro.email);
    await sql`select convite_aceitar(${c.segredo}, ${await sessaoDe(aindaNoutro.pessoa)})`.execute(
      dono,
    );
    // A base recusa pseudonimizar à mão quem ainda está no prazo.
    expect(
      await mensagemDoErro(
        sql`update pessoa set email = pseudonimo(id), nome = 'Pessoa pseudonimizada',
              estado = 'desactivada', pseudonimizada_em = now()
            where id = ${quase.pessoa}::uuid`.execute(dono),
      ),
    ).toContain("account.retention");

    // Como o programa da VPS: o papel da limpeza, com o canal e o pedido
    // da tarefa (eurolify-limpeza; docs/28 §3.1, 0052). O papel não tem o
    // EXECUTE da contexto_do_rasto(): o gatilho do rasto corre como o dono.
    const feito = await dono.transaction().execute(async (trx) => {
      await sql`set local role eurolify_limpeza`.execute(trx);
      await sql`select set_config('eurolify.canal', 'sistema', true),
        set_config('eurolify.pedido', 'tarefa:prazos_contas', true)`.execute(
        trx,
      );
      return aplicar(trx);
    });
    expect(feito["pessoas"]).toBe(1);
    const { rows: doRasto } = await sql<{ canal: string; pedido: string }>`
      select canal, pedido from evento_conta
      where pessoa_id = ${saiu.pessoa}::uuid and acto = 'pessoa_pseudonimizada'`.execute(
      dono,
    );
    expect(doRasto).toEqual([
      { canal: "sistema", pedido: "tarefa:prazos_contas" },
    ]);
    expect(await pessoa(saiu.pessoa)).toEqual({
      email: `pseudonimo+${saiu.pessoa}@eurolify.invalid`,
      nome: "Pessoa pseudonimizada",
      estado: "desactivada",
      pseudonimizada: true,
    });
    expect((await pessoa(quase.pessoa))?.email).toBe(quase.email);
    expect((await pessoa(aindaNoutro.pessoa))?.email).toBe(aindaNoutro.email);
    for (const t of ["passkey", "palavra_passe", "codigo_recuperacao"]) {
      expect(await contar(t, saiu.pessoa), t).toBe(0);
    }
    // A sessão que ainda valia foi revogada; o membro e o rasto ficam.
    const { rows: sessao } = await sql<{ motivo: string }>`
      select revogada_motivo as motivo from sessao where id = ${await sessaoId(s)}::uuid`.execute(
      dono,
    );
    expect(sessao[0]?.motivo).toBe("pessoa_desactivada");
    const { rows: membros } = await sql<{ n: number }>`
      select count(*)::int as n from membro where pessoa_id = ${saiu.pessoa}::uuid`.execute(
      dono,
    );
    expect(membros[0]?.n).toBe(1);
    const { rows: rasto } = await sql<{ acto: string; quem: string }>`
      select acto, quem from evento_conta where pessoa_id = ${saiu.pessoa}::uuid
      order by quando desc, id desc limit 1`.execute(dono);
    expect(rasto[0]).toEqual({
      acto: "pessoa_pseudonimizada",
      quem: "sistema:prazos",
    });
    // Pseudonimizada não muda mais.
    expect(
      await mensagemDoErro(
        sql`update pessoa set nome = 'Outra' where id = ${saiu.pessoa}::uuid`.execute(
          dono,
        ),
      ),
    ).toContain("account.immutable");
    // O e-mail soltou-se (docs/21 §4.7, P2-2): um convite novo cria outra conta.
    const novo = await convidar(b, saiu.email);
    const { rows: outra } = await sql<{ pessoa_id: string }>`
      select pessoa_id from convite_aceitar_conta_nova(${novo.segredo}, 'Ana Teste')`.execute(
      dono,
    );
    expect(outra[0]?.pessoa_id).not.toBe(saiu.pessoa);
    // Uma segunda corrida não volta a tratar nada.
    expect((await aplicar())["pessoas"]).toBe(0);
  });

  it("concorrência: quem aceita um convite primeiro fica; a limpeza salta a pessoa trancada", async () => {
    await aplicar();
    const p = await pessoaEm(a);
    await saiuHa(p.membro, 91);
    const c = await convidar(b, p.email);
    const sessao = await sessaoDe(p.pessoa);
    let soltar = () => {};
    const portao = new Promise<void>((r) => {
      soltar = r;
    });
    let entrou = () => {};
    const dentro = new Promise<void>((r) => {
      entrou = r;
    });
    const aceitar = dono.transaction().execute(async (trx) => {
      await sql`select convite_aceitar(${c.segredo}, ${sessao})`.execute(trx);
      entrou();
      await portao;
    });
    await dentro;
    // A aceitação ainda não acabou: a pessoa está trancada e fica para amanhã.
    expect((await aplicar())["pessoas"]).toBe(0);
    soltar();
    await aceitar;
    expect((await aplicar())["pessoas"]).toBe(0);
    expect((await pessoa(p.pessoa))?.pseudonimizada).toBe(false);
  });

  it("concorrência: a limpeza primeiro; quem aceita espera e é recusado", async () => {
    await aplicar();
    const p = await pessoaEm(a);
    await saiuHa(p.membro, 91);
    const c = await convidar(b, p.email);
    const sessao = await sessaoDe(p.pessoa);
    let soltar = () => {};
    const portao = new Promise<void>((r) => {
      soltar = r;
    });
    let feito: Contagem = {};
    let entrou = () => {};
    const dentro = new Promise<void>((r) => {
      entrou = r;
    });
    const limpar = dono.transaction().execute(async (trx) => {
      feito = await aplicar(trx);
      entrou();
      await portao;
    });
    await dentro;
    expect(feito["pessoas"]).toBe(1);
    const outra = await outraLigacao();
    const aceitar = mensagemDoErro(
      outra.query("select convite_aceitar($1, $2)", [c.segredo, sessao]),
    ).finally(() => outra.end());
    // Tem de ficar à espera da limpeza (não passar ao lado da tranca).
    expect(await aEspera(outra.pid)).toBe(true);
    soltar();
    await limpar;
    expect(await aceitar).toContain("auth.unauthenticated");
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from membro
      where pessoa_id = ${p.pessoa}::uuid and ate is null`.execute(dono);
    expect(rows[0]?.n).toBe(0);
  });

  it("a verificação das 07:00 conta o que ficou para trás há mais de um dia", async () => {
    await aplicar();
    expect(await emAtraso()).toBe(0);
    const p = await pessoaEm(a);
    // 14 dias e meio: ainda dentro da folga de um dia; 16 dias: atraso.
    await sql`insert into entrada (quando, pessoa_id, metodo, resultado) values
      (now() - interval '14 days 12 hours', ${p.pessoa}::uuid, 'passkey', 'ok'),
      (now() - interval '16 days', ${p.pessoa}::uuid, 'passkey', 'ok')`.execute(
      dono,
    );
    const q = await pessoaEm(a);
    await saiuHa(q.membro, 92);
    // Os que se apagam na limpeza seguinte também contam, com um dia de
    // folga (revisão do Codex no #152).
    await sql`insert into codigo_recuperacao (pessoa_id, resumo, usado_em) values
      (${p.pessoa}::uuid, ${hex64()}, now() - interval '25 hours'),
      (${p.pessoa}::uuid, ${hex64()}, now() - interval '23 hours')`.execute(
      dono,
    );
    await sql`insert into desafio_webauthn (resumo, finalidade, criado_em) values
      (${hex64()}, 'entrar', now() - interval '25 hours'),
      (${hex64()}, 'entrar', now() - interval '23 hours')`.execute(dono);
    await sql`insert into palavra_passe (pessoa_id, estado, resumo, totp_cifrado, chave_versao)
      values (${p.pessoa}::uuid, 'pendente', ${RESUMO_ARGON}, ${randomBytes(40)}, 1)`.execute(
      dono,
    );
    const { rows: pend } = await sql<{ id: string }>`
      select id from palavra_passe where pessoa_id = ${p.pessoa}::uuid`.execute(
      dono,
    );
    await envelhecer(
      "palavra_passe",
      "palavra_passe_antes_de_gravar",
      "criada_em = now() - interval '49 hours'",
      pend[0]?.id ?? "",
    );
    expect(await emAtraso()).toBe(5);
    await aplicar();
    expect(await emAtraso()).toBe(0);
  });

  it("só o papel da limpeza as chama: nem PUBLIC nem a API; e a limpeza não ganha tabelas", async () => {
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
        and p.proname in ('contas_aplicar_prazos', 'contas_prazos_em_atraso',
                          'pseudonimo', 'sessao_fim', 'pessoa_saiu_ha', 'convite_fim')
      order by 1`.execute(dono);
    expect(rows).toEqual([
      {
        nome: "contas_aplicar_prazos",
        publico: false,
        api: false,
        limpeza: true,
      },
      {
        nome: "contas_prazos_em_atraso",
        publico: false,
        api: false,
        limpeza: true,
      },
      { nome: "convite_fim", publico: false, api: false, limpeza: false },
      { nome: "pessoa_saiu_ha", publico: false, api: false, limpeza: false },
      { nome: "pseudonimo", publico: false, api: false, limpeza: false },
      { nome: "sessao_fim", publico: false, api: false, limpeza: false },
    ]);
    expect(
      await mensagemDoErro(
        sql`select * from contas_aplicar_prazos()`.execute(base.api),
      ),
    ).toMatch(/permission denied/);
    // Como o programa da VPS: com o papel da limpeza, corre.
    const feito = await dono.transaction().execute(async (trx) => {
      await sql`set local role eurolify_limpeza`.execute(trx);
      const r = await aplicar(trx);
      await sql`select contas_prazos_em_atraso()`.execute(trx);
      return r;
    });
    expect(Object.keys(feito).sort()).toEqual([
      "codigos_usados",
      "convites",
      "desafios",
      "entradas",
      "palavras_passe_pendentes",
      "pessoas",
      "pessoas_adiadas",
      "sessoes",
    ]);
    // A limpeza não ganha nenhuma tabela das contas (revisão do #152, P3-4).
    const { rows: tabelas } = await sql<{ tabela: string }>`
      select t as tabela from unnest(array['pessoa', 'membro', 'convite', 'sessao',
        'passkey', 'palavra_passe', 'codigo_recuperacao', 'entrada', 'evento_conta',
        'desafio_webauthn']) as t
      where has_table_privilege('eurolify_limpeza', t, 'SELECT')
         or has_table_privilege('eurolify_limpeza', t, 'INSERT')
         or has_table_privilege('eurolify_limpeza', t, 'UPDATE')
         or has_table_privilege('eurolify_limpeza', t, 'DELETE')`.execute(dono);
    expect(tabelas).toEqual([]);
  });

  it("P3-1: uma sessão ou um convite que já tinham acabado contam do fim, não da revogação", async () => {
    await aplicar();
    const p = await pessoaEm(a);
    const s = await sessaoId(await sessaoDe(p.pessoa));
    // Expirou há 40 dias (sem uso) e foi revogada hoje por um «terminar todas».
    await envelhecer(
      "sessao",
      "sessao_antes_de_gravar",
      "criada_em = now() - interval '45 days', ultimo_uso_em = now() - interval '40 days 12 hours', revogada_em = now(), revogada_motivo = 'terminar_todas'",
      s,
    );
    const c = (await convidar(a, "tarde@exemplo.test")).id;
    // Expirou há 40 dias e foi cancelado hoje.
    await envelhecer(
      "convite",
      "convite_antes_de_gravar",
      "criado_em = now() - interval '47 days', expira_em = now() - interval '40 days', cancelado_em = now(), cancelado_por = 'saiu'",
      c,
    );
    const feito = await aplicar();
    expect(feito["sessoes"]).toBe(1);
    expect(feito["convites"]).toBe(1);
  });

  it("P2-1: uma credencial gravada enquanto a limpeza pseudonimiza a pessoa é recusada", async () => {
    await aplicar();
    const p = await pessoaEm(a);
    await saiuHa(p.membro, 91);
    const limpar = await aberta((trx) => aplicar(trx));
    expect(limpar.resultado["pessoas"]).toBe(1);
    const outra = await outraLigacao();
    const gravar = mensagemDoErro(
      outra.query(
        "insert into codigo_recuperacao (pessoa_id, resumo) values ($1, $2)",
        [p.pessoa, hex64()],
      ),
    ).finally(() => outra.end());
    expect(await aEspera(outra.pid)).toBe(true);
    limpar.soltar();
    await limpar.fim;
    expect(await gravar).toContain("pseudonimizada");
    expect(await contar("codigo_recuperacao", p.pessoa)).toBe(0);
    // Uma credencial que escape (aqui, posta à mão sem o gatilho) avisa às 07:00.
    await dono.transaction().execute(async (trx) => {
      await sql`alter table codigo_recuperacao disable trigger codigo_recuperacao_de_pessoa_viva`.execute(
        trx,
      );
      await sql`insert into codigo_recuperacao (pessoa_id, resumo)
        values (${p.pessoa}::uuid, ${hex64()})`.execute(trx);
      await sql`alter table codigo_recuperacao enable always trigger codigo_recuperacao_de_pessoa_viva`.execute(
        trx,
      );
    });
    expect(await emAtraso()).toBe(1);
    await sql`delete from codigo_recuperacao where pessoa_id = ${p.pessoa}::uuid`.execute(
      dono,
    );
  });

  it("P2-2: uma passkey trancada por uma entrada adia só essa pessoa; o resto da corrida fica", async () => {
    await aplicar();
    const p = await pessoaEm(a);
    await sql`insert into passkey (pessoa_id, credencial_id, chave_publica, contador, nome)
      values (${p.pessoa}::uuid, ${"B".repeat(20)}, ${randomBytes(32)}, 0, 'Telemóvel')`.execute(
      dono,
    );
    await saiuHa(p.membro, 91);
    await sql`insert into entrada (quando, email_resumo, metodo, resultado)
      values (now() - interval '15 days', ${hex64()}, 'passkey', 'falhou')`.execute(
      dono,
    );
    // Uma entrada com esta passkey em curso: tem a passkey trancada.
    const entrada = await aberta((trx) =>
      sql`select id from passkey where pessoa_id = ${p.pessoa}::uuid for update`.execute(
        trx,
      ),
    );
    const outra = await outraLigacao();
    try {
      const { rows } = await outra.query<{ o_que: string; quantas: number }>(
        "select * from contas_aplicar_prazos()",
      );
      const feito = Object.fromEntries(rows.map((r) => [r.o_que, r.quantas]));
      expect(feito["pessoas"]).toBe(0);
      expect(feito["pessoas_adiadas"]).toBe(1);
      expect(feito["entradas"]).toBe(1);
    } finally {
      await outra.end();
      entrada.soltar();
      await entrada.fim;
    }
    expect((await pessoa(p.pessoa))?.pseudonimizada).toBe(false);
    // No dia seguinte, sem a tranca, passa.
    expect((await aplicar())["pessoas"]).toBe(1);
  }, 20_000);

  it("P3-4: a base recusa pseudonimizar à mão quem ainda tem um membro activo", async () => {
    const p = await pessoaEm(a);
    await envelhecer(
      "pessoa",
      "pessoa_antes_de_gravar",
      "criada_em = now() - interval '200 days'",
      p.pessoa,
    );
    expect(
      await mensagemDoErro(
        sql`update pessoa set email = pseudonimo(id), nome = 'Pessoa pseudonimizada',
              estado = 'desactivada', pseudonimizada_em = now()
            where id = ${p.pessoa}::uuid`.execute(dono),
      ),
    ).toContain("account.retention");
  });
});
