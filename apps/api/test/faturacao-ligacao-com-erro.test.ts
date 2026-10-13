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
// (docs/29 §18; docs/06, EJ): a fila `ligacao_faturacao` do «A decidir» e,
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
      entidade = await criarEntidadeLegal(base.api, a, {
        denominacao: "Loja Exemplo, Lda",
        forma_juridica: "sociedade_por_quotas",
        pais: "PT",
        numero_fiscal: "501964843",
        morada_linha: "Rua de Teste, 1",
        morada_codigo_postal: "1000-001",
        morada_localidade: "Lisboa",
      });
      for (const papel of ["dono", "gestor", "armazem", "apoio"]) {
        const x = await h.pessoaCom(a, papel);
        p[papel] = { pessoa: x.pessoa, sessao: x.sessao };
      }
      const x = await h.pessoaCom(b, "dono");
      p["donoB"] = { pessoa: x.pessoa, sessao: x.sessao };
    }, 120_000);

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    /**
     * Uma ligação Moloni nova (a anterior desliga-se), por testar. `velha`:
     * o par de tokens tem 8 dias, e a tarefa que os mantém renova-o.
     */
    const novaLigacao = async (velha: boolean) => {
      await sql`update ligacao_faturacao set activa = false, versao = versao + 1
        where activa`.execute(base.dono);
      const id = await noDocumentos(base.api, a, (trx) =>
        criarLigacao(
          trx,
          a,
          {
            entidade_legal: entidade,
            adaptador: "moloni",
            serie: "77",
            taxas: [],
            isencoes: [],
          },
          "teste",
        ),
      );
      const cred = {
        ...moloni.credenciais(),
        ...(velha
          ? { refresh_em: new Date(Date.now() - 8 * 86_400_000).toISOString() }
          : {}),
      };
      await noDocumentos(base.api, a, (trx) =>
        definirCredenciais(trx, a, id, cred, faturacao, "teste"),
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
          from tarefas_casos(array['ligacao_faturacao'])`
          .execute(trx)
          .then((r) => r.rows),
      );
    const avisos = () =>
      sql<{ pessoa_id: string; referencia: string; dados: Json }>`
        select pessoa_id, referencia, dados from notificacao
        where tipo = 'invoicing.connection_error' order by criada_em`
        .execute(base.dono)
        .then((r) => r.rows);
    const desligar = (id: string) =>
      sql`update ligacao_faturacao set activa = false, versao = versao + 1
        where id = ${id}::uuid`.execute(base.dono);

    it("a renovação recusada põe a ligação na fila (1 dia, sem encomenda) e manda um e-mail só aos donos, uma vez por passagem", async () => {
      const id = await novaLigacao(true);
      expect(await casos(a)).toEqual([]);
      expect((await renovacaoRecusada()).erros).toBe(1);
      // Outra volta com a ligação já com erro: nada novo.
      await renovacaoRecusada();
      const [c] = await casos(a);
      expect(c).toMatchObject({
        caso: id,
        motivo: "renovacao_recusada",
        encomenda: null,
        vencida: false,
      });
      expect((c?.prazo.getTime() ?? 0) - (c?.entrou_em.getTime() ?? 0)).toBe(
        86_400_000,
      );
      const n = await avisos();
      expect(n.map((x) => x.pessoa_id)).toEqual([p["dono"]?.pessoa]);
      expect(n[0]?.dados).toMatchObject({
        entidade: "Loja Exemplo, Lda",
        adaptador: "moloni",
        motivo: "renovacao_recusada",
        retidas: 0,
      });
      // Nunca a frase do emissor (o `erro` da ligação) no aviso.
      const erro = await sql<{ erro: string }>`
        select erro from ligacao_faturacao where id = ${id}::uuid`.execute(
        base.dono,
      );
      expect(erro.rows[0]?.erro).toMatch(/Moloni/);
      expect(JSON.stringify(n)).not.toContain(erro.rows[0]?.erro ?? "?");
      // Outro comerciante não vê o caso.
      expect(await casos(b)).toEqual([]);
      // O e-mail sai, ao dono, com a entidade e sem a frase do emissor.
      const correio = new CorreioDeEnsaio();
      await correrNotificacoes(base.api, correio);
      expect(correio.enviados).toHaveLength(1);
      expect(correio.enviados[0]?.assunto).toContain("Loja Exemplo, Lda");
      expect(correio.enviados[0]?.texto).not.toContain(
        erro.rows[0]?.erro ?? "?",
      );
      await desligar(id);
      expect(await casos(a)).toEqual([]);
    });

    it("o gestor e o apoio vêem o caso no «A decidir»; só o dono pode ser responsável; o armazém não o vê", async () => {
      const id = await novaLigacao(true);
      await renovacaoRecusada();
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
          .then((r) => r.rows.map((x) => x.p)),
      );
      expect(quem).toEqual([p["dono"]?.pessoa]);
      await desligar(id);
    });

    it("um teste falhado põe o caso na fila sem e-mail; testar com sucesso tira-o, e o e-mail por enviar cancela-se", async () => {
      const id = await novaLigacao(false);
      const antes = (await avisos()).length;
      moloni.estado.tokens.clear();
      const r = await testarLigacao(base.api, a, id, faturacao, "teste");
      expect(r.estado).toBe("com_erro");
      expect((await casos(a)).map((x) => [x.caso, x.motivo])).toEqual([
        [id, "teste_falhou"],
      ]);
      expect(await avisos()).toHaveLength(antes);
      // A renovação recusada com a ligação já com erro (a mesma escrita que
      // `ligacaoComErro` faria): a mesma passagem, o primeiro motivo, nenhum
      // e-mail.
      const [primeiro] = await casos(a);
      await comComerciante(base.api, a, (trx) =>
        sql`update ligacao_faturacao set estado = 'com_erro',
          com_erro_motivo = 'renovacao_recusada', versao = versao + 1
          where id = ${id}::uuid`.execute(trx),
      );
      expect((await casos(a))[0]?.entrou_em).toEqual(primeiro?.entrou_em);
      expect((await casos(a)).map((x) => x.motivo)).toEqual(["teste_falhou"]);
      expect(await avisos()).toHaveLength(antes);
      await desligar(id);
    });

    it("ligar outra vez e testar tira o caso da fila; o e-mail ainda por enviar fica cancelado", async () => {
      const id = await novaLigacao(true);
      await renovacaoRecusada();
      expect(await casos(a)).toHaveLength(1);
      // O dono liga outra vez (credenciais novas) e testa.
      await noDocumentos(base.api, a, (trx) =>
        definirCredenciais(
          trx,
          a,
          id,
          moloni.credenciais(),
          faturacao,
          "teste",
        ),
      );
      expect(await casos(a)).toEqual([]);
      expect(await testarLigacao(base.api, a, id, faturacao, "teste")).toEqual({
        estado: "pronta",
        erro: null,
      });
      const correio = new CorreioDeEnsaio();
      await correrNotificacoes(base.api, correio);
      expect(correio.enviados).toHaveLength(0);
      // O desta ligação (e o de uma ligação já desligada noutro teste):
      // cancelados, porque a ligação já não espera.
      const n = await sql<{ estado: string; ultimo_erro: string }>`
        select estado, ultimo_erro from notificacao
        where tipo = 'invoicing.connection_error'
          and dados ->> 'ligacao' = ${id}`.execute(base.dono);
      expect(n.rows).toEqual([
        { estado: "cancelada", ultimo_erro: "ligacao_ja_nao_espera" },
      ]);
      await desligar(id);
    });

    it("o ecrã Faturação diz quantas faturas estão retidas à espera da ligação (L6)", async () => {
      // Um documento retido por `ligacao_sem_teste`, posto à mão (sem
      // encomenda: os gatilhos desligados só nesta transacção do teste).
      const doc = randomUUID();
      await base.dono.transaction().execute(async (trx) => {
        await sql`alter table documento_fiscal disable trigger all`.execute(
          trx,
        );
        await sql`insert into documento_fiscal
          (id, comerciante_id, encomenda_id, entidade_legal_id, modo, estado, motivos)
          values (${doc}::uuid, ${a}::uuid, ${randomUUID()}::uuid, ${entidade}::uuid,
            'teste', 'retido', array['ligacao_sem_teste'])`.execute(trx);
        await sql`alter table documento_fiscal enable trigger all`.execute(trx);
      });
      const r = await h.pedir("GET", "/hub/invoicing", {
        sessao: p["gestor"]?.sessao ?? "",
        comerciante: a,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect((JSON.parse(r.body) as { entidades: Json[] }).entidades).toEqual([
        expect.objectContaining({
          id: `lgl_${entidade}`,
          retidas_sem_ligacao: 1,
        }),
      ]);
    });

    it("a base recusa pôr uma ligação com erro sem o motivo", async () => {
      const id = await novaLigacao(false);
      await expect(
        comComerciante(base.api, a, (trx) =>
          sql`update ligacao_faturacao set estado = 'com_erro', versao = versao + 1
            where id = ${id}::uuid`.execute(trx),
        ),
      ).rejects.toThrow(/invoices.invalid_field/);
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
