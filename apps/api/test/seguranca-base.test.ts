import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirBase } from "../src/base/ligacao.js";
import { migrar, PASTA_MIGRACOES } from "../src/base/migracoes.js";
import { criarArtigo } from "../src/catalogo/repositorio.js";
import {
  aceitarContrato,
  comComerciante,
  criarEntidadeLegal,
  criarLoja,
  mudarEstado,
  registarComerciante,
  registarVerificacao,
} from "../src/comerciante/repositorio.js";
import {
  criarLista,
  criarMercado,
  definirPreco,
  mudarEstadoMercado,
} from "../src/precos/repositorio.js";
import {
  apagarBase,
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Migração 0008 (auditoria docs/16, «Segurança e dados»): o rasto do
// Comerciante só se acrescenta, também para o dono das tabelas; e as funções
// da base nascem fechadas. Contra o PostgreSQL 18 verdadeiro (ADR-0025).

/** As funções que a API pode chamar; qualquer outra tem de ser recusada. */
const FUNCOES_DA_API = [
  // Os anexos da isenção (0055): a quota, que o gatilho lê com quem escreve.
  "anexos_quota_por_comerciante",
  // O nome de quem fez, no histórico do Hub (0038).
  "autores_da_linha_do_tempo",
  "catalogo_estado_do_artigo",
  "catalogo_fila_do_artigo",
  "catalogo_marcar_combinacoes",
  "catalogo_verificar_combinacoes",
  "chave_criar_pela_api",
  "chave_criar_pela_sessao",
  "chave_listar",
  "chave_resolver",
  "chave_revogar_pela_api",
  "chave_revogar_pela_sessao",
  // As sessões de checkout sem dados pessoais (0077): a tarefa corre pela API.
  "checkout_comerciantes_com_sessoes_a_limpar",
  // O checkout alojado (0041): do token para a sessão, sem RLS.
  "checkout_resolver",
  "checkout_sessoes_limpar",
  // Duplicados e fusões (0046): fundir, descartar, a procura de candidatos (do
  // gatilho), o grupo de fichas fundidas e a comparação dos e-mails.
  "cliente_fundir",
  // Os pedidos do titular (0049): limitar, pseudonimizar e as duas que dizem
  // se a pseudonimização está a correr (os gatilhos chamam-nas).
  "cliente_limitar",
  // O consentimento por contacto e a dupla confirmação (0052): o gatilho da
  // pseudonimização, a régua por contacto e o pedido e a confirmação.
  "cliente_pseudonimizado_sem_confirmacoes",
  "cliente_pseudonimizar",
  // O aviso do prazo legal do pedido do titular (0094): a tarefa e a
  // conferência no envio.
  "clientes_aviso_espera",
  "clientes_aviso_prazo_comerciantes",
  "clientes_aviso_prazo_marcar",
  "clientes_aviso_prazo_pendentes",
  // As tarefas das filas (0066; docs/33): os casos abertos de cada domínio,
  // a lista, atribuir, o prazo e o aviso; e o «na fila desde» do documento.
  "clientes_casos_a_decidir",
  "clientes_do_grupo",
  "clientes_dono_a_escrever",
  "clientes_pseudonimizacao_em_curso",
  "clientes_titular_casos_a_decidir",
  "codigos_gerar",
  "comerciante_actual",
  "consentimento_confirmar",
  "consentimento_pedir_confirmacao",
  "conta_nova_com_passkey",
  "contacto_para_comparar",
  "contactos_com_marketing",
  "contactos_das_fichas",
  // O contexto do rasto (0051): os gatilhos do rasto chamam-no com quem escreve.
  "contexto_do_rasto",
  "convite_aceitar",
  "convite_cancelar",
  "convite_criar",
  "convite_ver",
  "desafio_criar_acrescentar",
  "desafio_criar_entrada",
  "desafio_criar_registo",
  "documento_na_fila",
  "documento_na_fila_antes",
  // Os documentos fiscais (0050): a fila da tarefa e a marca do perfil usado.
  "documentos_a_tratar",
  "documentos_casos_a_decidir",
  "documentos_comerciantes_com_trabalho",
  "duplicado_descartar",
  "duplicados_sinalizar",
  "emails_para_comparar",
  // Clientes (0037): a régua do NIF e os CHECK da ficha correm com quem
  // escreve; o principal troca-se por uma função.
  "emails_validos",
  // Os pagamentos (0044): o prazo, a máquina de estados, a porta dos avisos e as tarefas.
  "encomenda_prazo_de_pagamento",
  // O stock e as encomendas (0047): a política e a tarefa da conclusão.
  "encomendas_comerciantes_com_tarefas",
  "encomendas_tarefas",
  "entrar_com_palavra_passe",
  "entrar_com_passkey",
  // Os envios (0079): a porta dos avisos e o trabalho da API.
  // O aviso da tentativa falhada (0087): a conferência no envio.
  "envios_aviso_espera",
  "envios_avisos_resumir",
  // As encomendas paradas (0085): a volta de todos e a de um comerciante.
  "envios_comerciantes_com_paradas",
  "envios_comerciantes_com_trabalho",
  "envios_conta_do_aviso",
  // Os envios depois do apagamento do titular (0083): o gatilho do evento.
  "envios_encomenda_limpa",
  "envios_paradas",
  "envios_trabalho",
  "envios_trabalho_adiar",
  "envios_trabalho_feito",
  // A ligação com erro (0084): a fila do «A decidir» e a conferência do e-mail.
  "faturacao_aviso_espera",
  "faturacao_aviso_retidas",
  "faturacao_casos_a_decidir",
  // Os ficheiros de imagem sem uso (0035).
  "ficheiro_apagar_sem_uso",
  "ficheiro_sem_uso_renovar",
  "ficheiros_comerciantes_sem_uso",
  "ficheiros_sem_uso",
  "gtin_valido",
  // O Moloni (0069): os comerciantes com ligações a renovar os tokens.
  "ligacoes_comerciantes_a_renovar",
  "marketing_do_contacto",
  "membro_mudar_papel",
  "membro_terminar",
  "membros_listar",
  "nif_com_prefixo",
  "nif_limpo",
  "nif_para_procura",
  "nif_portugues_valido",
  "nif_regua",
  // A pós-venda (0058): a NC pede-se ao decidir o reembolso, se há fatura.
  "nota_credito_pedir",
  // As notificações (0067): a fila, o destino lido no envio e a limpeza.
  "notificacao_apagar_antigas",
  "notificacao_comerciantes",
  "notificacao_destino",
  "pagamento_transicao_valida",
  "pagamentos_adiar_tarefa",
  "pagamentos_casos_a_decidir",
  "pagamentos_comerciantes_com_tarefas",
  "pagamentos_conta_do_aviso",
  "pagamentos_tarefas",
  "pais_do_comerciante",
  "pais_do_prefixo_fiscal",
  "palavra_passe_codigo_errado",
  "palavra_passe_confirmar",
  "palavra_passe_para_entrar",
  "palavra_passe_pendente",
  "palavra_passe_preparar",
  "palavra_passe_retirar",
  "passkey_acrescentar",
  "passkey_para_entrar",
  "passkey_retirar",
  "passkeys_listar",
  // O pedido do titular recebido e o prazo (0092): registar, prorrogar,
  // fechar e os casos da fila.
  "pedido_recebido_fechar",
  "pedido_recebido_prorrogar",
  "pedido_recebido_registar",
  // O registo da exportação, com o tipo fixo (revisão do #314, P2-2); o
  // registo à escolha (pedido_titular_registar) fica só para o dono.
  "pedido_titular_exportar",
  "perfil_marcar_usado",
  "perfil_tornar_principal",
  "pessoa_eu",
  // A régua única do marketing (0042): quem envia pergunta-lhe.
  "pode_receber_marketing",
  "pode_receber_marketing",
  "posvenda_casos_a_decidir",
  // A tarefa dos reembolsos no prestador (0061): os comerciantes com trabalho.
  "posvenda_comerciantes_com_reembolsos",
  // O aviso do prazo do reembolso (0063): o prazo e a tarefa.
  "posvenda_dias_de_aviso",
  "posvenda_higiene_por_decidir",
  "posvenda_prazo_comerciantes",
  "posvenda_prazo_da_devolucao",
  "posvenda_prazo_reagendar",
  "posvenda_prazo_tarefas",
  "posvenda_reembolsar_ate",
  // A redução anunciada (0036): o gatilho corre com quem escreve.
  "preco_referencia",
  "prefixo_fiscal",
  "reautenticar_com_passkey",
  "recuperacao_concluir",
  "recuperacao_iniciar",
  "reducao_em_vigor",
  // A régua do marketing sobre um grupo de fichas (0046): a pode_receber_marketing
  // e o ensaio da fusão chamam-na.
  "regua_marketing",
  "sessao_resolver",
  "sessao_terminar",
  "sessao_verificar",
  "sessoes_listar",
  "sessoes_terminar_todas",
  "stock_bloquear",
  "stock_politica",
  "tarefa_origem",
  "tarefas_atribuir",
  // O caso de um aviso de vencido ainda espera (0071), no envio do e-mail.
  "tarefas_aviso_espera",
  "tarefas_casos",
  "tarefas_comerciantes",
  "tarefas_filas",
  "tarefas_marcar_vencida",
  "tarefas_mudar_prazo",
  // Quem pode ser responsável de um caso, para o «Atribuir…» do Hub (0073).
  "tarefas_podem_ser_responsaveis",
  "tarefas_por_avisar",
  "tarefas_prazo_por_omissao",
  "telefones_validos",
  // Os pedidos do titular em todos os domínios (0072): a que os gatilhos
  // chamam (dá falso fora da função do dono) e a tarefa da fila.
  "titular_comerciantes_com_pendentes",
  "titular_limpeza_permitida",
  "titular_pendentes_aplicar",
  "titular_por_acabar",
  // A prova do VIES só numa ficha activa (0049): o gatilho corre com quem escreve.
  "validacao_vies_so_em_ficha_activa",
  // O VIES (0039): a fila e a prova, pelas funções do dono.
  "vies_adiar",
  "vies_comerciantes_com_fila",
  "vies_pedir",
  "vies_por_consultar",
  "vies_registar",
  "vies_requerente",
];

const RASTO = [
  "transicao_estado",
  "aceitacao_contrato",
  "prova_verificacao",
] as const;

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    return String((erro as { message?: unknown }).message);
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)("segurança da base (0008)", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    // Uma linha em cada tabela do rasto, pelo caminho da API.
    const id = await registarComerciante(base.api, {
      nome: "Loja de Teste",
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const entidade = await criarEntidadeLegal(base.api, id, {
      denominacao: "Exemplo, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "123456789",
      morada_linha: "Rua de Teste, 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
    await mudarEstado(base.api, id, {
      de: "rascunho",
      para: "prova_pendente",
      motivo: "teste",
      quem: "teste",
    });
    await aceitarContrato(base.api, id, {
      tipo: "contrato_servico",
      versao_texto: "v1-teste",
      aceite_por: "teste",
    });
    await registarVerificacao(base.api, id, {
      entidade_legal_id: entidade,
      finalidade: "identificacao_fiscal",
      origem: "manual",
      origem_detalhe: "teste",
      resultado: "aceite",
    });
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  describe("o rasto só se acrescenta, também para o dono", () => {
    it("há uma linha em cada tabela do rasto", async () => {
      for (const tabela of RASTO) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from ${sql.table(tabela)}`.execute(
          base.dono,
        );
        expect(rows[0]?.n, tabela).toBe(1);
      }
    });

    it.each(RASTO)(
      "o dono não altera, não apaga nem esvazia %s",
      async (tabela) => {
        for (const consulta of [
          sql`update ${sql.table(tabela)} set comerciante_id = comerciante_id`,
          sql`delete from ${sql.table(tabela)}`,
          sql`truncate ${sql.table(tabela)}`,
        ]) {
          expect(await mensagemDoErro(consulta.execute(base.dono))).toMatch(
            /^audit\.append_only:/,
          );
        }
        const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from ${sql.table(tabela)}`.execute(base.dono);
        expect(rows[0]?.n).toBe(1);
      },
    );
  });

  it("os seis gatilhos do rasto existem e estão sempre ligados", async () => {
    const { rows } = await sql<{ nome: string; ligado: string }>`
      select t.tgname as nome, t.tgenabled as ligado
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname in ('transicao_estado', 'aceitacao_contrato',
                          'prova_verificacao')
        and t.tgfoid = 'rasto_so_se_acrescenta'::regproc
      order by 1`.execute(base.dono);
    expect(rows).toEqual(
      RASTO.flatMap((tabela) => [
        { nome: `${tabela}_sem_truncate`, ligado: "A" },
        { nome: `${tabela}_so_se_acrescenta`, ligado: "A" },
      ]).sort((a, b) => a.nome.localeCompare(b.nome)),
    );
  });

  it("nenhum gatilho que cria notificações corre numa cópia reposta em modo replica (regra da 0053; 0091, #435)", async () => {
    // «A» (ALWAYS) correria também em replica; «O», só na origem.
    const { rows } = await sql<{ nome: string; ligado: string }>`
      select t.tgname as nome, t.tgenabled as ligado
      from pg_trigger t join pg_proc f on f.oid = t.tgfoid
      where not t.tgisinternal
        and f.prosrc ~* ${String.raw`insert\s+into\s+(public\.)?notificacao\M`}
      order by 1`.execute(base.dono);
    expect(rows.map((r) => r.nome)).toEqual(
      expect.arrayContaining([
        "atribuicao_vencida_notificacao",
        "devolucao_prazo_notificacao",
        "ligacao_faturacao_com_erro_notificacao",
        "pedido_titular_recebido_aviso_notificacao",
      ]),
    );
    expect(rows.filter((r) => r.ligado === "A")).toEqual([]);
    // A procura só apanha o `insert` escrito na função do gatilho (não uma
    // função auxiliar que insira): por isso também a lista fixa, com o índice
    // das tarefas, que escreve noutra tabela (revisão do #441, P2-1 e P3-1).
    const { rows: fixos } = await sql<{ nome: string; ligado: string }>`
      select t.tgname as nome, t.tgenabled as ligado from pg_trigger t
      where t.tgname in ('atribuicao_vencida_notificacao', 'devolucao_prazo_notificacao',
                         'ligacao_faturacao_com_erro_notificacao', 'notificacao_tarefa',
                         'evento_seguimento_aviso',
                         'pedido_titular_recebido_aviso_notificacao')
      order by 1`.execute(base.dono);
    expect(fixos).toEqual(
      [
        "atribuicao_vencida_notificacao",
        "devolucao_prazo_notificacao",
        "evento_seguimento_aviso",
        "ligacao_faturacao_com_erro_notificacao",
        "notificacao_tarefa",
        "pedido_titular_recebido_aviso_notificacao",
      ].map((nome) => ({ nome, ligado: "O" })),
    );
  });

  describe("funções fechadas por omissão", () => {
    it("nenhuma função do esquema public fica aberta a PUBLIC", async () => {
      const { rows } = await sql<{ nome: string }>`
        select p.proname as nome
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proacl is null or exists (
            select 1 from aclexplode(p.proacl) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
        order by 1`.execute(base.dono);
      expect(rows.map((r) => r.nome)).toEqual([]);
    });

    it("as funções SECURITY DEFINER têm o search_path fixo", async () => {
      const { rows } = await sql<{ nome: string; config: string[] | null }>`
        select p.proname as nome, p.proconfig as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
        order by 1`.execute(base.dono);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.config ?? [], r.nome).toContain(
          "search_path=pg_catalog, public, pg_temp",
        );
      }
    });

    it("a API só pode chamar as funções da lista", async () => {
      const { rows } = await sql<{ nome: string }>`
        select p.proname as nome
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and has_function_privilege('eurolify_api', p.oid, 'EXECUTE')
        order by 1`.execute(base.dono);
      expect(rows.map((r) => r.nome)).toEqual(FUNCOES_DA_API);
    });

    it("uma função nova de quem migra nasce fechada", async () => {
      // Criada como o dono da base, que é quem migra (como na VPS): o ALTER
      // DEFAULT PRIVILEGES da 0008 vale para esse papel.
      await base.dono.transaction().execute(async (trx) => {
        const { rows } = await sql<{ dono: string }>`
          select pg_get_userbyid(datdba) as dono from pg_database
          where datname = current_database()`.execute(trx);
        await sql`set local role ${sql.id(rows[0]?.dono ?? "")}`.execute(trx);
        await sql`create function funcao_nova_de_teste() returns int
          language sql as 'select 1'`.execute(trx);
      });
      try {
        const { rows } = await sql<{ pode: boolean }>`
          select has_function_privilege('eurolify_api',
            'funcao_nova_de_teste()', 'EXECUTE') as pode`.execute(base.dono);
        expect(rows[0]?.pode).toBe(false);
      } finally {
        await sql`drop function funcao_nova_de_teste()`.execute(base.dono);
      }
    });
  });

  // Como na VPS (infra/vps/preparar.sh, passo 10b): o eurolify_migrador é
  // dono da base, sem superutilizador, BYPASSRLS, CREATEDB nem CREATEROLE, e
  // corre as migrações todas. Desde o #168 a base de teste também migra com
  // um dono assim; este bloco fica porque confere os atributos do papel e o
  // resultado das migrações, um a um (revisão do #104, P3-1).
  describe("as migrações todas com um migrador sem poderes, dono da base", () => {
    const sufixo = randomBytes(4).toString("hex");
    const papel = `migrador_vps_${sufixo}`;
    const nome = `eurolify_migrador_${sufixo}`;
    const senha = "so-para-testes";
    let admin: pg.Client | undefined;
    let migrador: Kysely<unknown> | undefined;
    let resultado: Awaited<ReturnType<typeof migrar>> | undefined;
    let erroDaMigracao: unknown;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: URL_BASE });
      await admin.connect();
      // O eurolify_api é do cluster e na VPS cria-o o preparar.sh antes do
      // migrador (este não tem CREATEROLE). Aqui o beforeAll de fora já o
      // criou; o bloco fica para este describe também correr sozinho.
      await admin.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eurolify_api') THEN
          CREATE ROLE eurolify_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
        END IF;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
      await admin.query(
        `CREATE ROLE ${papel} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${senha}'`,
      );
      await admin.query(`CREATE DATABASE ${nome} OWNER ${papel}`);
      // A linha do tempo (0033) recusa mudar o catálogo sem quem (como em
      // base-de-teste.ts).
      await admin.query(
        `ALTER DATABASE ${nome} SET eurolify.quem = 'teste:base'`,
      );
      const url = new URL(URL_BASE ?? "");
      url.pathname = `/${nome}`;
      url.username = papel;
      url.password = senha;
      migrador = new Kysely<unknown>({
        dialect: new PostgresDialect({
          pool: new pg.Pool({ connectionString: url.toString(), max: 1 }),
        }),
      });
      // Migra aqui: se falhar, cada teste diz porquê (revisão, P3-2).
      try {
        resultado = await migrar(migrador);
      } catch (erro) {
        erroDaMigracao = erro;
      }
    }, 60_000);

    /** O migrador, ou falha com o erro da migração, se a houve. */
    function soMigrado(): Kysely<unknown> {
      if (erroDaMigracao !== undefined) {
        throw erroDaMigracao instanceof Error
          ? erroDaMigracao
          : new Error("a migração falhou", { cause: erroDaMigracao });
      }
      if (migrador === undefined) throw new Error("o migrador não foi criado");
      return migrador;
    }

    // Cada passo da limpeza no seu try: uma falha na preparação ou no fecho
    // não deixa a base nem o papel para trás nem esconde o erro (revisão,
    // P3-1).
    afterAll(async () => {
      try {
        await migrador?.destroy();
      } finally {
        try {
          if (admin !== undefined) await apagarBase(admin, nome);
        } finally {
          try {
            await admin?.query(`DROP ROLE IF EXISTS ${papel}`);
          } finally {
            await admin?.end();
          }
        }
      }
    });

    it("o migrador é como o da VPS: sem poderes e dono da base", async () => {
      const { rows } = await sql<{
        super: boolean;
        bypass: boolean;
        createdb: boolean;
        createrole: boolean;
        dono: boolean;
      }>`
        select r.rolsuper as super, r.rolbypassrls as bypass,
          r.rolcreatedb as createdb, r.rolcreaterole as createrole,
          d.datdba = r.oid as dono
        from pg_roles r, pg_database d
        where r.rolname = current_user and d.datname = current_database()`.execute(
        soMigrado(),
      );
      expect(rows[0]).toEqual({
        super: false,
        bypass: false,
        createdb: false,
        createrole: false,
        dono: true,
      });
    });

    it("corre todas as migrações da pasta, sem erro", async () => {
      soMigrado();
      const ficheiros = (await readdir(PASTA_MIGRACOES))
        .filter((f) => f.endsWith(".sql"))
        .map((f) => f.replace(/\.sql$/, ""))
        .sort();
      expect(ficheiros.length).toBeGreaterThanOrEqual(8);
      expect(resultado?.error).toBeUndefined();
      expect(resultado?.results?.map((r) => r.migrationName)).toEqual(
        ficheiros,
      );
      expect(resultado?.results?.every((r) => r.status === "Success")).toBe(
        true,
      );
    });

    it("nenhuma função fica aberta a PUBLIC e a API só chama as da lista", async () => {
      const { rows: abertas } = await sql<{ nome: string }>`
        select p.proname as nome
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proacl is null or exists (
            select 1 from aclexplode(p.proacl) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE'))`.execute(
        soMigrado(),
      );
      expect(abertas).toEqual([]);
      const { rows: daApi } = await sql<{ nome: string }>`
        select p.proname as nome
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and has_function_privilege('eurolify_api', p.oid, 'EXECUTE')
        order by 1`.execute(soMigrado());
      expect(daApi.map((r) => r.nome)).toEqual(FUNCOES_DA_API);
    });

    it("uma função nova do migrador nasce fechada", async () => {
      await sql`create function funcao_nova_do_migrador() returns int
        language sql as 'select 1'`.execute(soMigrado());
      const { rows } = await sql<{ pode: boolean }>`
        select has_function_privilege('eurolify_api',
          'funcao_nova_do_migrador()', 'EXECUTE') as pode`.execute(soMigrado());
      expect(rows[0]?.pode).toBe(false);
    });

    it.each(RASTO)("o migrador, dono, não esvazia %s", async (tabela) => {
      // O TRUNCATE dispara o gatilho por instrução, mesmo sem linhas.
      expect(
        await mensagemDoErro(
          sql`truncate ${sql.table(tabela)}`.execute(soMigrado()),
        ),
      ).toMatch(/^audit\.append_only:/);
    });

    // Os gatilhos dos eventos (0021) correm com os direitos do dono. Aqui o
    // dono não é superutilizador e o RLS de evento_saida é forçado, como na
    // VPS (revisão do #143, P2-2).
    it("com este dono, os gatilhos gravam os eventos e o RLS só mostra os do comerciante posto", async () => {
      const migradorPronto = soMigrado();
      const url = new URL(URL_BASE ?? "");
      url.pathname = `/${nome}`;
      url.username = "eurolify_api";
      url.password = senha;
      const api = abrirBase(url.toString());
      try {
        const novo = {
          nome: "Loja de Teste",
          lingua: "pt",
          fuso: "Europe/Lisbon",
        };
        const c = await registarComerciante(api, novo);
        const outro = await registarComerciante(api, novo);
        const entidade = await criarEntidadeLegal(api, c, {
          denominacao: "Exemplo, Lda.",
          forma_juridica: "sociedade por quotas",
          pais: "PT",
          numero_fiscal: "123456789",
          morada_linha: "Rua de Teste, 1",
          morada_codigo_postal: "1000-001",
          morada_localidade: "Lisboa",
        });
        const loja = await criarLoja(api, c, {
          entidade_legal_id: entidade,
          nome: "Loja online",
        });
        const mercado = await criarMercado(api, c, {
          loja_id: loja,
          nome: "Portugal",
          paises: ["PT"],
          moeda: "EUR",
          linguas: ["pt"],
          lingua_principal: "pt",
        });
        const lista = await criarLista(api, c, {
          mercado_id: mercado,
          nome: "Base PT",
          tipo: "base",
        });
        await mudarEstadoMercado(api, c, mercado, 1, "activo");
        const artigo = await criarArtigo(
          api,
          c,
          { tipo: "fisico", nome: "Gel", categoria_fiscal: "normal" },
          [{ sku: "GEL-001", unidade_de_venda: "unidade", peso_g: 30 }],
        );
        const [variante] = await comComerciante(api, c, (trx) =>
          trx
            .selectFrom("variante")
            .select("id")
            .where("artigo_id", "=", artigo)
            .execute(),
        );
        if (variante === undefined) throw new Error("falta a variante");
        await definirPreco(api, c, "pessoa:teste", lista, variante.id, {
          montante: 990,
        });
        await definirPreco(api, c, "pessoa:teste", lista, variante.id, {
          montante: 1090,
        });

        /** O que o dono vê em evento_saida com o comerciante `quem` posto. */
        async function vistos(quem: string) {
          return migradorPronto.transaction().execute(async (trx) => {
            await sql`select set_config('eurolify.comerciante', ${quem}, true)`.execute(
              trx,
            );
            const { rows } = await sql<{
              comerciante_id: string;
              tipo: string;
              antigo: number | null;
            }>`select comerciante_id, tipo,
                 (dados->>'montante_antigo')::int as antigo
               from evento_saida order by criado_em, id`.execute(trx);
            return rows;
          });
        }
        expect(await vistos(c)).toEqual([
          { comerciante_id: c, tipo: "market.activated", antigo: null },
          { comerciante_id: c, tipo: "price.changed", antigo: null },
          { comerciante_id: c, tipo: "price.changed", antigo: 990 },
        ]);
        expect(await vistos(outro)).toEqual([]);
        // Numa ligação nova, sem o comerciante posto: este dono não lê a
        // fila (o publicador terá o seu papel, docs/18 §5) nem muda um estado
        // à mão sem deixar evento — o RLS da tabela de origem chama
        // comerciante_actual(), que dá erro (revisão do #143, ronda 2, P3-A).
        const urlMigrador = new URL(URL_BASE ?? "");
        urlMigrador.pathname = `/${nome}`;
        urlMigrador.username = papel;
        urlMigrador.password = senha;
        const solto = new pg.Client({
          connectionString: urlMigrador.toString(),
        });
        await solto.connect();
        try {
          for (const consulta of [
            "select count(*) from evento_saida",
            `update mercado set estado = 'arquivado' where id = '${mercado}'`,
          ]) {
            expect(
              await mensagemDoErro(solto.query(consulta)),
              consulta,
            ).toMatch(/eurolify\.comerciante/);
          }
        } finally {
          await solto.end();
        }
        expect((await vistos(c)).length).toBe(3);
      } finally {
        await api.destroy();
      }
    }, 30_000);
  });
});
