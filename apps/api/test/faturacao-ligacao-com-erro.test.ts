import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comComerciante,
  criarEntidadeLegal,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { AdaptadorMoloni } from "../src/faturacao/moloni.js";
import {
  correrRenovacoes,
  criarLigacao,
  definirCredenciais,
  noDocumentos,
  testarLigacao,
} from "../src/faturacao/repositorio.js";
import { CorreioDeEnsaio } from "../src/notificacoes/correio.js";
import { mensagemDe } from "../src/notificacoes/modelos.js";
import { correrNotificacoes } from "../src/notificacoes/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";
import { moloniFalso } from "./moloni-falso.js";

// O aviso ao dono quando a ligação ao software de faturação fica com erro
// (docs/29 §18; docs/06, EK): a fila `ligacao_faturacao` do «A decidir» e,
// na renovação recusada, um e-mail logo aos donos (Q1 A). Os testes da L8.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)(
  "Faturação: a ligação com erro na fila e o e-mail ao dono",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;
    let a = "";
    let b = "";
    let entidade = "";
    let entidadeB = "";
    let outraEntidade = "";
    const p: Record<string, { pessoa: string; sessao: string }> = {};
    const moloni = moloniFalso();
    const faturacao = {
      chave: chavePagamentos(randomBytes(32).toString("base64")),
      adaptadores: {
        moloni: new AdaptadorMoloni({
          clientId: "dev-eurolify",
          clientSecret: "segredo-do-developer",
          empresasPermitidas: [String(moloni.empresa)],
          fetch: moloni.fetch,
          porMinuto: 10_000,
        }),
      },
    };
    const entidadeDe = (c: string, nome: string, nif: string) =>
      criarEntidadeLegal(base.api, c, {
        denominacao: nome,
        forma_juridica: "sociedade_por_quotas",
        pais: "PT",
        numero_fiscal: nif,
        morada_linha: "Rua de Teste, 1",
        morada_codigo_postal: "1000-001",
        morada_localidade: "Lisboa",
      });

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      h = hubDeTeste(base, { faturacao });
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
      entidade = await entidadeDe(a, "Loja Exemplo, Lda", "501964843");
      outraEntidade = await entidadeDe(a, "Outra Loja, Lda", "503504564");
      entidadeB = await entidadeDe(b, "Loja B, Lda", "505959255");
      for (const papel of ["dono", "gestor", "armazem", "apoio"]) {
        const x = await h.pessoaCom(a, papel);
        p[papel] = { pessoa: x.pessoa, sessao: x.sessao };
      }
      const d2 = await h.pessoaCom(a, "dono");
      p["dono2"] = { pessoa: d2.pessoa, sessao: d2.sessao };
      const x = await h.pessoaCom(b, "dono");
      p["donoB"] = { pessoa: x.pessoa, sessao: x.sessao };
    }, 120_000);

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    /** As credenciais como o dono as deixaria; `velha`: o par tem 8 dias. */
    const credenciais = (velha: boolean) => ({
      ...moloni.credenciais(),
      ...(velha
        ? { refresh_em: new Date(Date.now() - 8 * 86_400_000).toISOString() }
        : {}),
    });
    /**
     * Uma ligação Moloni nova na entidade (a anterior dela desliga-se), por
     * testar. `velha`: a tarefa que mantém os tokens renova-os.
     */
    const novaLigacao = async (c: string, ent: string, velha: boolean) => {
      await sql`update ligacao_faturacao set activa = false, versao = versao + 1
        where activa and entidade_legal_id = ${ent}::uuid`.execute(base.dono);
      const id = await noDocumentos(base.api, c, (trx) =>
        criarLigacao(
          trx,
          c,
          {
            entidade_legal: ent,
            adaptador: "moloni",
            serie: "77",
            taxas: [],
            isencoes: [],
          },
          "teste",
        ),
      );
      await noDocumentos(base.api, c, (trx) =>
        definirCredenciais(trx, c, id, credenciais(velha), faturacao, "teste"),
      );
      return id;
    };
    /** A tarefa que mantém os tokens, com o Moloni a recusar renovar. */
    const renovacaoRecusada = async () => {
      moloni.estado.falhas.renovacaoMorta = true;
      try {
        return await correrRenovacoes(base.api, faturacao);
      } finally {
        moloni.estado.falhas.renovacaoMorta = false;
      }
    };
    const casos = (c: string) =>
      comComerciante(base.api, c, (trx) =>
        sql<{
          caso: string;
          motivo: string;
          encomenda: string | null;
          vencida: boolean;
          prazo: Date;
          entrou_em: Date;
        }>`select caso, motivo, encomenda, vencida, prazo, entrou_em
          from tarefas_casos(array['ligacao_faturacao']) order by caso`
          .execute(trx)
          .then((r) => r.rows),
      );
    const avisosDe = (ligacao: string) =>
      sql<{
        pessoa_id: string;
        referencia: string;
        estado: string;
        ultimo_erro: string | null;
        dados: Json;
      }>`
        select pessoa_id, referencia, estado, ultimo_erro, dados from notificacao
        where tipo = 'invoicing.connection_error' and dados ->> 'ligacao' = ${ligacao}
        order by criada_em, pessoa_id`
        .execute(base.dono)
        .then((r) => r.rows);
    const desligar = (id: string) =>
      sql`update ligacao_faturacao set activa = false, versao = versao + 1
        where id = ${id}::uuid`.execute(base.dono);
    /**
     * Um documento retido, posto à mão (sem encomenda: os gatilhos desligados
     * só nesta transacção do teste).
     */
    const retido = (c: string, ent: string, motivo: string) =>
      base.dono.transaction().execute(async (trx) => {
        await sql`alter table documento_fiscal disable trigger all`.execute(
          trx,
        );
        await sql`insert into documento_fiscal
          (id, comerciante_id, encomenda_id, entidade_legal_id, modo, estado, motivos)
          values (${randomUUID()}::uuid, ${c}::uuid, ${randomUUID()}::uuid, ${ent}::uuid,
            'teste', 'retido', array[${motivo}])`.execute(trx);
        await sql`alter table documento_fiscal enable trigger all`.execute(trx);
      });
    const donosA = () => [p["dono"]?.pessoa, p["dono2"]?.pessoa].sort();

    it("a renovação recusada põe a ligação na fila de cada comerciante (1 dia, sem encomenda) e manda um e-mail aos donos dele, um por passagem", async () => {
      const id = await novaLigacao(a, entidade, true);
      const idB = await novaLigacao(b, entidadeB, true);
      expect(await casos(a)).toEqual([]);
      expect((await renovacaoRecusada()).erros).toBe(2);
      // Outra volta com as ligações já com erro: nada novo.
      await renovacaoRecusada();
      const [c] = await casos(a);
      expect(await casos(a)).toHaveLength(1);
      expect(c).toMatchObject({
        caso: id,
        motivo: "renovacao_recusada",
        encomenda: null,
        vencida: false,
      });
      expect((c?.prazo.getTime() ?? 0) - (c?.entrou_em.getTime() ?? 0)).toBe(
        86_400_000,
      );
      // Cada comerciante vê só a sua (RLS e o filtro da função).
      expect((await casos(b)).map((x) => x.caso)).toEqual([idB]);
      const doDonoB = await h.pedir(
        "GET",
        "/hub/tasks?fila=ligacao_faturacao",
        {
          sessao: p["donoB"]?.sessao ?? "",
          comerciante: b,
        },
      );
      expect(doDonoB.body).toContain(`isx_${idB}`);
      expect(doDonoB.body).not.toContain(id);
      // Os avisos: os dois donos de A; o dono de B só o da ligação dele.
      const n = await avisosDe(id);
      expect(n.map((x) => x.pessoa_id).sort()).toEqual(donosA());
      expect((await avisosDe(idB)).map((x) => x.pessoa_id)).toEqual([
        p["donoB"]?.pessoa,
      ]);
      expect(n[0]?.dados).toMatchObject({
        entidade: "Loja Exemplo, Lda",
        adaptador: "moloni",
        motivo: "renovacao_recusada",
      });
      // O número de retidas não se guarda: conta-se no envio (P1-2).
      expect(n[0]?.dados).not.toHaveProperty("retidas");
      // Nunca a frase do emissor (o `erro` da ligação) no aviso.
      const erro = await sql<{ erro: string }>`
        select erro from ligacao_faturacao where id = ${id}::uuid`.execute(
        base.dono,
      );
      expect(erro.rows[0]?.erro).toMatch(/Moloni/);
      expect(JSON.stringify(n)).not.toContain(erro.rows[0]?.erro ?? "?");
      // Depois do erro, uma fatura fica retida à espera da ligação (e outras
      // que não contam: outro motivo, outra entidade).
      await retido(a, entidade, "ligacao_sem_teste");
      await retido(a, entidade, "nif_recusado");
      await retido(a, outraEntidade, "ligacao_sem_teste");
      const correio = new CorreioDeEnsaio();
      await correrNotificacoes(base.api, correio);
      const deA = correio.enviados.filter((m) =>
        m.assunto.includes("Loja Exemplo, Lda"),
      );
      expect(deA).toHaveLength(2);
      for (const m of deA) {
        expect(m.texto).toContain("há 1 fatura retida por isto");
        expect(m.texto).not.toContain(erro.rows[0]?.erro ?? "?");
      }
      expect(
        correio.enviados.filter((m) => m.assunto.includes("Loja B, Lda")),
      ).toHaveLength(1);
      await desligar(idB);
    });

    it("o gestor e o apoio vêem o caso no «A decidir»; só os donos podem ser responsáveis; o armazém não o vê", async () => {
      const [c] = await casos(a);
      const id = c?.caso ?? "";
      for (const papel of ["dono", "gestor", "apoio"]) {
        const r = await h.pedir("GET", "/hub/tasks?fila=ligacao_faturacao", {
          sessao: p[papel]?.sessao ?? "",
          comerciante: a,
        });
        expect(r.statusCode, `${papel}: ${r.body}`).toBe(200);
        expect(
          (JSON.parse(r.body) as { dados: Json[] }).dados.map((x) => x["caso"]),
        ).toEqual([`isx_${id}`]);
      }
      const armazem = await h.pedir("GET", "/hub/tasks", {
        sessao: p["armazem"]?.sessao ?? "",
        comerciante: a,
      });
      expect(armazem.body).not.toContain(id);
      const quem = await comComerciante(base.api, a, (trx) =>
        sql<{
          p: string;
        }>`select tarefas_podem_ser_responsaveis('ligacao_faturacao') as p`
          .execute(trx)
          .then((r) => r.rows.map((x) => x.p).sort()),
      );
      expect(quem).toEqual(donosA());
    });

    it("o ecrã Faturação diz quantas faturas estão retidas à espera da ligação, por entidade (L6)", async () => {
      const r = await h.pedir("GET", "/hub/invoicing", {
        sessao: p["gestor"]?.sessao ?? "",
        comerciante: a,
      });
      expect(r.statusCode, r.body).toBe(200);
      const entidades = (JSON.parse(r.body) as { entidades: Json[] }).entidades;
      expect(entidades).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `lgl_${entidade}`,
            retidas_sem_ligacao: 1,
          }),
          expect.objectContaining({
            id: `lgl_${outraEntidade}`,
            retidas_sem_ligacao: 1,
          }),
        ]),
      );
    });

    it("o responsável que passa a gestor deixa o caso, e o aviso por enviar a quem já não liga a conta fica cancelado (R8)", async () => {
      // Uma passagem nova: liga outra vez com um par velho e a renovação volta
      // a ser recusada; um e-mail novo e uma hora de entrada nova (P2-3, i).
      const [antes] = await casos(a);
      const id = antes?.caso ?? "";
      await noDocumentos(base.api, a, (trx) =>
        definirCredenciais(trx, a, id, credenciais(true), faturacao, "teste"),
      );
      expect(await casos(a)).toEqual([]);
      await renovacaoRecusada();
      const [depois] = await casos(a);
      expect(depois?.caso).toBe(id);
      expect(depois?.entrou_em.getTime()).toBeGreaterThan(
        antes?.entrou_em.getTime() ?? 0,
      );
      const porEnviar = (await avisosDe(id)).filter(
        (x) => x.estado === "a_enviar",
      );
      expect(porEnviar.map((x) => x.pessoa_id).sort()).toEqual(donosA());
      // O segundo dono fica responsável e depois passa a gestor.
      await comComerciante(base.api, a, async (trx) => {
        await sql`select set_config('eurolify.quem', ${`pessoa:per_${p["dono"]?.pessoa ?? ""}`}, true)`.execute(
          trx,
        );
        await sql`select tarefas_atribuir('ligacao_faturacao', ${id}::uuid,
          ${p["dono2"]?.pessoa ?? ""}::uuid, 0)`.execute(trx);
      });
      await sql`update membro set papel = 'gestor'
        where comerciante_id = ${a}::uuid and pessoa_id = ${p["dono2"]?.pessoa ?? ""}::uuid`.execute(
        base.dono,
      );
      const resp = await comComerciante(base.api, a, (trx) =>
        sql<{ responsavel: string | null }>`select responsavel
          from tarefas_casos(array['ligacao_faturacao'])`
          .execute(trx)
          .then((r) => r.rows[0]?.responsavel),
      );
      expect(resp).toBeNull();
      const correio = new CorreioDeEnsaio();
      await correrNotificacoes(base.api, correio);
      const n = await avisosDe(id);
      expect(
        n
          .filter((x) => x.referencia === porEnviar[0]?.referencia)
          .map((x) => [
            x.pessoa_id === p["dono2"]?.pessoa,
            x.estado,
            x.ultimo_erro,
          ])
          .sort(),
      ).toEqual([
        [false, "enviada", null],
        [true, "cancelada", "destinatario_inactivo"],
      ]);
      await sql`update membro set papel = 'dono'
        where comerciante_id = ${a}::uuid and pessoa_id = ${p["dono2"]?.pessoa ?? ""}::uuid`.execute(
        base.dono,
      );
      await desligar(id);
    });

    it("um teste falhado põe o caso na fila sem e-mail; a renovação recusada depois, na mesma passagem, passa o motivo e avisa os donos (P2-3)", async () => {
      const id = await novaLigacao(a, entidade, false);
      moloni.estado.tokens.clear();
      const r = await testarLigacao(base.api, a, id, faturacao, "teste");
      expect(r.estado).toBe("com_erro");
      expect((await casos(a)).map((x) => [x.caso, x.motivo])).toEqual([
        [id, "teste_falhou"],
      ]);
      expect(await avisosDe(id)).toEqual([]);
      // A escrita que `ligacaoComErro` faz quando a renovação é recusada.
      const [primeiro] = await casos(a);
      await comComerciante(base.api, a, (trx) =>
        sql`update ligacao_faturacao set estado = 'com_erro',
          com_erro_motivo = 'renovacao_recusada', versao = versao + 1
          where id = ${id}::uuid`.execute(trx),
      );
      const [segundo] = await casos(a);
      expect(segundo?.entrou_em).toEqual(primeiro?.entrou_em);
      expect(segundo?.motivo).toBe("renovacao_recusada");
      expect((await avisosDe(id)).map((x) => x.pessoa_id).sort()).toEqual(
        donosA(),
      );
      // E nunca volta atrás para o motivo mais leve.
      await comComerciante(base.api, a, (trx) =>
        sql`update ligacao_faturacao set com_erro_motivo = 'teste_falhou',
          versao = versao + 1 where id = ${id}::uuid`.execute(trx),
      );
      expect((await casos(a))[0]?.motivo).toBe("renovacao_recusada");
      await desligar(id);
    });

    it("uma cópia reposta em modo replica não manda o e-mail outra vez (regra da 0053; 0091, #435)", async () => {
      const id = await novaLigacao(a, entidade, false);
      // A linha como uma reposição a escreve: já com erro, a passagem e o
      // motivo, sem os gatilhos da origem.
      await base.dono.transaction().execute(async (trx) => {
        await sql`set local session_replication_role = replica`.execute(trx);
        await sql`update ligacao_faturacao set estado = 'com_erro',
          com_erro_motivo = 'renovacao_recusada', com_erro_desde = now(),
          com_erro_passagem = gen_random_uuid(), versao = versao + 1
          where id = ${id}::uuid`.execute(trx);
      });
      expect(await avisosDe(id)).toEqual([]);
      await desligar(id);
    });

    it("ligar outra vez e testar tira o caso da fila; o e-mail ainda por enviar fica cancelado", async () => {
      const id = await novaLigacao(a, entidade, true);
      await renovacaoRecusada();
      expect(await casos(a)).toHaveLength(1);
      await noDocumentos(base.api, a, (trx) =>
        definirCredenciais(trx, a, id, credenciais(false), faturacao, "teste"),
      );
      expect(await casos(a)).toEqual([]);
      expect(await testarLigacao(base.api, a, id, faturacao, "teste")).toEqual({
        estado: "pronta",
        erro: null,
      });
      await correrNotificacoes(base.api, new CorreioDeEnsaio());
      expect(
        (await avisosDe(id)).map((x) => [x.estado, x.ultimo_erro]),
      ).toEqual([
        ["cancelada", "ligacao_ja_nao_espera"],
        ["cancelada", "ligacao_ja_nao_espera"],
      ]);
      await desligar(id);
    });

    it("a base recusa pôr uma ligação com erro sem o motivo, e a API não escreve a hora nem a passagem", async () => {
      const id = await novaLigacao(a, entidade, false);
      await expect(
        comComerciante(base.api, a, (trx) =>
          sql`update ligacao_faturacao set estado = 'com_erro', versao = versao + 1
            where id = ${id}::uuid`.execute(trx),
        ),
      ).rejects.toThrow(/invoices.invalid_field/);
      await expect(
        comComerciante(base.api, a, (trx) =>
          sql`update ligacao_faturacao set com_erro_desde = now()
            where id = ${id}::uuid`.execute(trx),
        ),
      ).rejects.toThrow(/permission denied/);
      await desligar(id);
    });
  },
);

describe("o texto do e-mail da ligação com erro", () => {
  const dados = {
    loja: "Loja Exemplo",
    entidade: "Loja Exemplo, Lda",
    ligacao: "0193a1b2-0000-7000-8000-000000000001",
    adaptador: "moloni",
    motivo: "renovacao_recusada",
    retidas: 12,
    desde: "2026-10-10 09:30",
    fuso: "Europe/Lisbon",
  };

  it("diz a entidade, o software, o motivo e as faturas retidas, nas três línguas", () => {
    const pt = mensagemDe("invoicing.connection_error", "pt", dados, {
      email: "dono@exemplo.test",
    });
    expect(pt.para).toBe("dono@exemplo.test");
    expect(pt.assunto).toBe(
      "Faturação: a ligação ao Moloni de «Loja Exemplo, Lda» está com erro",
    );
    expect(pt.texto).toContain("desde 10/10/2026 09:30 (Europe/Lisbon)");
    expect(pt.texto).toContain("motivo: renovacao_recusada");
    expect(pt.texto).toContain("há 12 faturas retidas");
    expect(pt.texto).toContain(`isx_${dados.ligacao}`);
    const es = mensagemDe("invoicing.connection_error", "es", dados, {
      email: "x@exemplo.test",
    });
    expect(es.texto).toContain("hay 12 facturas retenidas");
    const en = mensagemDe(
      "invoicing.connection_error",
      "en",
      { ...dados, retidas: 1 },
      { email: "x@exemplo.test" },
    );
    expect(en.texto).toContain("2026-10-10 09:30");
    expect(en.texto).toContain("1 invoice is held");
  });

  it("um motivo que não é código, ou uma entidade com quebras de linha, não passa tal como vem", () => {
    const m = mensagemDe(
      "invoicing.connection_error",
      "pt",
      {
        ...dados,
        motivo: "invalid_grant: o token xyz expirou",
        entidade: "Loja\nBcc: alguem@exemplo.test",
      },
      { email: "x@exemplo.test" },
    );
    expect(m.texto).toContain("motivo: ?");
    expect(m.texto).not.toContain("xyz");
    expect(m.assunto).not.toContain("\n");
  });
});
