import { randomBytes } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mudarEstado,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { gerarChave, resumoDe, type Ambito } from "../src/identidade/chaves.js";
import { AMBITOS_DO_PAPEL, PAPEIS } from "../src/identidade/papeis.js";
import { registarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Contas de pessoas, parte B1 (migração 0018; docs/21 §4 e §5; testes P-T2,
// P-T4, P-T6, P-T7, P-T9, P-T10 e P-T15 do §9; issue #140). Contra o
// PostgreSQL 18 verdadeiro. As funções ainda não são da API (chegam com as
// rotas, B2): chamam-se como o dono das tabelas, que é como as chamará o
// código com o EXECUTE que receber.

const OPERADOR = "operador:github:1001";
const TABELAS = [
  "convite",
  "evento_conta",
  "membro",
  "pessoa",
  "sessao",
] as const;

const segredo = () => randomBytes(32).toString("base64url");

async function mensagemDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    return String((erro as { message?: unknown }).message);
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)("contas de pessoas (0018)", () => {
  let base: BaseDeTeste;
  let dono: Kysely<unknown>;
  let a: string;
  let b: string;

  /** Uma transacção com o comerciante do contexto, como o comComerciante. */
  function em<T>(
    comerciante: string,
    fn: (trx: Kysely<unknown>) => Promise<T>,
  ): Promise<T> {
    return dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${comerciante}, true)`.execute(
        trx,
      );
      return fn(trx);
    });
  }

  async function convidarPeloOperador(
    comerciante: string,
    email: string,
    papel: string,
  ): Promise<string> {
    const s = segredo();
    await sql`select convite_criar_pelo_operador(${comerciante}::uuid,
      ${email}, ${papel}, ${resumoDe(s)}, ${OPERADOR})`.execute(dono);
    return s;
  }

  async function convidar(
    comerciante: string,
    sessao: string,
    email: string,
    papel: string,
  ): Promise<string> {
    const s = segredo();
    await em(comerciante, (trx) =>
      sql`select convite_criar(${sessao}, ${email}, ${papel}, ${resumoDe(s)})`.execute(
        trx,
      ),
    );
    return s;
  }

  async function contaNova(
    convite: string,
    nome: string,
  ): Promise<{ pessoa_id: string; membro_id: string }> {
    const { rows } = await sql<{ pessoa_id: string; membro_id: string }>`
      select * from convite_aceitar_conta_nova(${convite}, ${nome})`.execute(
      dono,
    );
    const linha = rows[0];
    if (linha === undefined) throw new Error("sem conta");
    return linha;
  }

  async function aceitar(convite: string, sessao: string): Promise<string> {
    const { rows } = await sql<{ membro_id: string }>`
      select * from convite_aceitar(${convite}, ${sessao})`.execute(dono);
    const id = rows[0]?.membro_id;
    if (id === undefined) throw new Error("sem membro");
    return id;
  }

  async function sessaoDe(pessoa: string): Promise<string> {
    const s = segredo();
    await sql`select sessao_criar(${pessoa}::uuid, ${resumoDe(s)})`.execute(
      dono,
    );
    return s;
  }

  async function resolver(sessao: string, comerciante: string) {
    const { rows } = await sql<{
      pessoa_id: string;
      membro_id: string;
      papel: string;
      ambitos: string[];
      recente: boolean;
    }>`select * from sessao_resolver(${sessao}, ${comerciante}::uuid)`.execute(
      dono,
    );
    return rows;
  }

  /** Uma pessoa nova, membro de `comerciante` com `papel`, e uma sessão. */
  async function pessoaCom(
    comerciante: string,
    papel: string,
    email = `p${randomBytes(4).toString("hex")}@exemplo.test`,
  ) {
    const convite = await convidarPeloOperador(comerciante, email, papel);
    const { pessoa_id, membro_id } = await contaNova(convite, "Pessoa Teste");
    return {
      pessoa: pessoa_id,
      membro: membro_id,
      email,
      sessao: await sessaoDe(pessoa_id),
    };
  }

  /** Muda uma data que a base não deixa mudar (só nos testes). */
  async function envelhecer(
    tabela: "convite" | "sessao",
    coluna: string,
    id: string,
    intervalo: string,
  ) {
    await dono.transaction().execute(async (trx) => {
      await sql`alter table ${sql.table(tabela)} disable trigger ${sql.raw(`${tabela}_antes_de_gravar`)}`.execute(
        trx,
      );
      await sql`update ${sql.table(tabela)} set ${sql.ref(coluna)} = now() - ${intervalo}::interval
        where id = ${id}::uuid`.execute(trx);
      await sql`alter table ${sql.table(tabela)} enable always trigger ${sql.raw(`${tabela}_antes_de_gravar`)}`.execute(
        trx,
      );
    });
  }

  async function sessaoId(s: string): Promise<string> {
    const { rows } = await sql<{ id: string }>`
      select id from sessao where resumo = ${resumoDe(s)}`.execute(dono);
    return rows[0]?.id ?? "";
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    dono = base.dono;
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
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  describe("P-T15: a API não toca nas tabelas nem nas funções", () => {
    it.each(TABELAS)(
      "o eurolify_api não tem nenhum privilégio em %s",
      async (t) => {
        const { rows } = await sql<{ algum: boolean }>`
        select has_table_privilege('eurolify_api', ${t},
          'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as algum`.execute(
          dono,
        );
        expect(rows[0]?.algum).toBe(false);
        expect(
          await mensagemDoErro(
            base.api.transaction().execute(async (trx) => {
              await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
                trx,
              );
              await sql`select * from ${sql.table(t)}`.execute(trx);
            }),
          ),
        ).toMatch(/^permission denied/);
      },
    );

    it("os âmbitos de cada papel são os do código", async () => {
      for (const papel of PAPEIS) {
        const { rows } = await sql<{ ambitos: string[] }>`
          select papel_ambitos(${papel}) as ambitos`.execute(dono);
        expect(rows[0]?.ambitos, papel).toEqual([...AMBITOS_DO_PAPEL[papel]]);
      }
    });
  });

  describe("convites (§4.2; P-T6, P-T9)", () => {
    it("o operador convida o primeiro dono; ao aceitar nasce a conta e o membro", async () => {
      const dona = await pessoaCom(a, "dono", "Dona.A@Exemplo.test");
      const r = await resolver(dona.sessao, a);
      expect(r).toEqual([
        expect.objectContaining({
          pessoa_id: dona.pessoa,
          papel: "dono",
          ambitos: [...AMBITOS_DO_PAPEL.dono],
          recente: true,
        }),
      ]);
      const { rows } = await sql<{ acto: string; quem: string }>`
        select acto, quem from evento_conta where pessoa_id = ${dona.pessoa}::uuid
           or convite_id in (select id from convite where aceite_por = ${dona.pessoa}::uuid)
        order by quando, id`.execute(dono);
      expect(rows.map((x) => x.acto)).toEqual([
        "convite_criado",
        "conta_criada",
        "convite_aceite",
      ]);
      expect(rows[0]?.quem).toBe(OPERADOR);
    });

    it("um dono convida com qualquer papel; um gestor só armazém ou apoio; os outros não convidam", async () => {
      const d = await pessoaCom(a, "dono");
      const g = await pessoaCom(a, "gestor");
      const arm = await pessoaCom(a, "armazem");
      for (const papel of PAPEIS) {
        await convidar(a, d.sessao, `d-${papel}@exemplo.test`, papel);
      }
      await convidar(a, g.sessao, "g-armazem@exemplo.test", "armazem");
      await convidar(a, g.sessao, "g-apoio@exemplo.test", "apoio");
      for (const papel of ["dono", "gestor"]) {
        expect(
          await mensagemDoErro(
            convidar(a, g.sessao, `g-${papel}@exemplo.test`, papel),
          ),
        ).toMatch(/^member\.role_escalation:/);
      }
      expect(
        await mensagemDoErro(
          convidar(a, arm.sessao, "x@exemplo.test", "apoio"),
        ),
      ).toMatch(/^member\.role_escalation:/);
      expect(
        await mensagemDoErro(convidar(a, d.sessao, "x@exemplo.test", "admin")),
      ).toMatch(/^invite\.invalid_role:/);
    });

    it("convidar exige autenticação recente (10 minutos)", async () => {
      const d = await pessoaCom(a, "dono");
      await envelhecer(
        "sessao",
        "autenticada_em",
        await sessaoId(d.sessao),
        "11 minutes",
      );
      expect(
        await mensagemDoErro(convidar(a, d.sessao, "y@exemplo.test", "apoio")),
      ).toMatch(/^auth\.reauthentication_required:/);
      expect((await resolver(d.sessao, a))[0]?.recente).toBe(false);
    });

    it("quem não é membro do comerciante não convida nele", async () => {
      const deB = await pessoaCom(b, "dono");
      expect(
        await mensagemDoErro(
          convidar(a, deB.sessao, "z@exemplo.test", "apoio"),
        ),
      ).toMatch(/^auth\.forbidden:/);
    });

    it("um convite vale uma vez; cancelado ou expirado não vale", async () => {
      const usado = await convidarPeloOperador(
        a,
        "uma-vez@exemplo.test",
        "apoio",
      );
      await contaNova(usado, "Uma Vez");
      expect(await mensagemDoErro(contaNova(usado, "Outra"))).toMatch(
        /^invite\.invalid:/,
      );

      const d = await pessoaCom(a, "dono");
      const cancelado = await convidar(
        a,
        d.sessao,
        "cancelado@exemplo.test",
        "apoio",
      );
      const { rows } = await sql<{ id: string }>`
        select id from convite where resumo = ${resumoDe(cancelado)}`.execute(
        dono,
      );
      await em(a, (trx) =>
        sql`select convite_cancelar(${d.sessao}, ${rows[0]?.id}::uuid)`.execute(
          trx,
        ),
      );
      expect(await mensagemDoErro(contaNova(cancelado, "Cancelado"))).toMatch(
        /^invite\.invalid:/,
      );

      const expirado = await convidarPeloOperador(
        a,
        "expirado@exemplo.test",
        "apoio",
      );
      const e = await sql<{ id: string }>`
        select id from convite where resumo = ${resumoDe(expirado)}`.execute(
        dono,
      );
      await envelhecer("convite", "expira_em", e.rows[0]?.id ?? "", "1 second");
      expect(await mensagemDoErro(contaNova(expirado, "Expirado"))).toMatch(
        /^invite\.invalid:/,
      );
      expect(await mensagemDoErro(contaNova(segredo(), "Nenhum"))).toMatch(
        /^invite\.invalid:/,
      );
      // Nem se vê antes de aceitar: a mesma recusa (issue #194).
      for (const x of [usado, cancelado, expirado, segredo()]) {
        expect(
          await mensagemDoErro(
            sql`select * from convite_ver(${x})`.execute(base.api),
          ),
        ).toMatch(/^invite\.invalid:/);
      }
    });

    it("ver um convite de B dentro do contexto de A deixa o contexto de A (revisão do #196, P3-3)", async () => {
      const convite = await convidarPeloOperador(
        b,
        "contexto@exemplo.test",
        "apoio",
      );
      const depois = await em(a, async (trx) => {
        const { rows } = await sql<{ comerciante_nome: string }>`
          select * from convite_ver(${convite})`.execute(trx);
        expect(rows[0]?.comerciante_nome).toBe("Loja B");
        const r = await sql<{ valor: string }>`
          select current_setting('eurolify.comerciante') as valor`.execute(trx);
        return r.rows[0]?.valor;
      });
      expect(depois).toBe(a);
    });

    it("dois aceites do mesmo convite ao mesmo tempo: só um passa", async () => {
      const convite = await convidarPeloOperador(
        a,
        "corrida@exemplo.test",
        "apoio",
      );
      const resultados = await Promise.allSettled([
        contaNova(convite, "Primeiro"),
        contaNova(convite, "Segundo"),
      ]);
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(
        1,
      );
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pessoa where lower(email) = 'corrida@exemplo.test'`.execute(
        dono,
      );
      expect(rows[0]?.n).toBe(1);
    });

    it("P-T9: para um e-mail com conta, só se aceita autenticado como essa pessoa, e não nasce outra conta", async () => {
      const ana = await pessoaCom(b, "apoio", "ana@exemplo.test");
      const outra = await pessoaCom(b, "apoio");
      const convite = await convidarPeloOperador(
        a,
        "ANA@exemplo.test",
        "gestor",
      );
      expect(await mensagemDoErro(contaNova(convite, "Impostor"))).toMatch(
        /^invite\.account_exists:/,
      );
      expect(await mensagemDoErro(aceitar(convite, outra.sessao))).toMatch(
        /^invite\.other_person:/,
      );
      expect(await mensagemDoErro(aceitar(convite, segredo()))).toMatch(
        /^auth\.unauthenticated:/,
      );
      await aceitar(convite, ana.sessao);
      expect((await resolver(ana.sessao, a))[0]?.papel).toBe("gestor");
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pessoa where lower(email) = 'ana@exemplo.test'`.execute(
        dono,
      );
      expect(rows[0]?.n).toBe(1);
      expect(await mensagemDoErro(aceitar(convite, ana.sessao))).toMatch(
        /^invite\.invalid:/,
      );
    });

    it("comerciante suspenso não convida nem aceita convites (AZ)", async () => {
      const c = await registarComerciante(base.api, {
        nome: "Loja Suspensa",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const d = await pessoaCom(c, "dono");
      const pendente = await convidar(
        c,
        d.sessao,
        "pendente@exemplo.test",
        "apoio",
      );
      await mudarEstado(base.api, c, {
        de: "rascunho",
        para: "suspenso",
        motivo: "teste",
        quem: "teste",
      });
      expect(
        await mensagemDoErro(convidar(c, d.sessao, "w@exemplo.test", "apoio")),
      ).toMatch(/^member\.merchant_inactive:/);
      expect(await mensagemDoErro(contaNova(pendente, "Pendente"))).toMatch(
        /^member\.merchant_inactive:/,
      );
    });
  });

  describe("papéis (§4.5; P-T4)", () => {
    it("só um dono muda papéis, nunca o seu, e com autenticação recente", async () => {
      const c = await registarComerciante(base.api, {
        nome: "Loja Papéis",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const d = await pessoaCom(c, "dono");
      const g = await pessoaCom(c, "gestor");
      const ap = await pessoaCom(c, "apoio");
      const mudar = (sessao: string, membro: string, papel: string) =>
        em(c, (trx) =>
          sql`select membro_mudar_papel(${sessao}, ${membro}::uuid, ${papel})`.execute(
            trx,
          ),
        );
      expect(
        await mensagemDoErro(mudar(g.sessao, ap.membro, "gestor")),
      ).toMatch(/^member\.role_escalation:/);
      expect(await mensagemDoErro(mudar(g.sessao, g.membro, "dono"))).toMatch(
        /^member\.role_escalation:/,
      );
      expect(await mensagemDoErro(mudar(d.sessao, d.membro, "gestor"))).toMatch(
        /^member\.self_role_change:/,
      );
      await mudar(d.sessao, ap.membro, "gestor");
      expect((await resolver(ap.sessao, c))[0]?.papel).toBe("gestor");
      await envelhecer(
        "sessao",
        "autenticada_em",
        await sessaoId(d.sessao),
        "11 minutes",
      );
      expect(await mensagemDoErro(mudar(d.sessao, ap.membro, "apoio"))).toMatch(
        /^auth\.reauthentication_required:/,
      );
    });

    it("o último dono não sai, também com dois donos a sair ao mesmo tempo", async () => {
      const c = await registarComerciante(base.api, {
        nome: "Loja Donos",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const d1 = await pessoaCom(c, "dono");
      const d2 = await pessoaCom(c, "dono");
      // O primeiro sai e fica com a transacção aberta; só depois o segundo
      // tenta. Com a tranca, o segundo espera e vê-se o último dono; sem ela,
      // os dois passavam (prova feita a tirar a tranca).
      let libertar = () => {};
      const aberta = new Promise<void>((r) => (libertar = r));
      let primeiroSaiu = () => {};
      const saiu = new Promise<void>((r) => (primeiroSaiu = r));
      const primeiro = em(c, async (trx) => {
        await sql`select membro_terminar(${d1.sessao}, ${d1.membro}::uuid)`.execute(
          trx,
        );
        primeiroSaiu();
        await aberta;
      });
      await saiu;
      const segundo = em(c, (trx) =>
        sql`select membro_terminar(${d2.sessao}, ${d2.membro}::uuid)`.execute(
          trx,
        ),
      );
      const corrida = await Promise.race([
        segundo.then(
          () => "passou",
          () => "falhou",
        ),
        new Promise((r) =>
          setTimeout(() => {
            r("à espera");
          }, 300),
        ),
      ]);
      expect(corrida).toBe("à espera");
      libertar();
      await primeiro;
      expect(await mensagemDoErro(segundo)).toMatch(/^member\.last_owner:/);
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from membro
        where comerciante_id = ${c}::uuid and papel = 'dono' and ate is null`.execute(
        dono,
      );
      expect(rows[0]?.n).toBe(1);
    });

    it("o operador não desactiva o último dono; desactivar faz cair todas as sessões", async () => {
      const c = await registarComerciante(base.api, {
        nome: "Loja Desactivar",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const d = await pessoaCom(c, "dono");
      const g = await pessoaCom(c, "gestor");
      const desactivar = (pessoa: string) =>
        sql`select pessoa_desactivar(${pessoa}::uuid, ${OPERADOR})`.execute(
          dono,
        );
      expect(await mensagemDoErro(desactivar(d.pessoa))).toMatch(
        /^member\.last_owner:/,
      );
      await desactivar(g.pessoa);
      expect(await mensagemDoErro(resolver(g.sessao, c))).toMatch(
        /^auth\.unauthenticated:/,
      );
      const { rows } = await sql<{ motivo: string }>`
        select revogada_motivo as motivo from sessao
        where pessoa_id = ${g.pessoa}::uuid`.execute(dono);
      expect(rows.map((r) => r.motivo)).toEqual(["pessoa_desactivada"]);
      expect(
        await mensagemDoErro(
          sql`select sessao_criar(${g.pessoa}::uuid, ${resumoDe(segredo())})`.execute(
            dono,
          ),
        ),
      ).toMatch(/^auth\.unauthenticated:/);
    });
  });

  describe("sair da equipa (§4.4; P-T2, P-T7, P-T10)", () => {
    it("depois de sair de A, nada de A; B continua; as chaves que criou em A ficam revogadas", async () => {
      const dA = await pessoaCom(a, "dono");
      const rui = await pessoaCom(a, "gestor");
      const convB = await convidarPeloOperador(b, rui.email, "apoio");
      await aceitar(convB, rui.sessao);
      expect((await resolver(rui.sessao, a))[0]?.papel).toBe("gestor");
      expect((await resolver(rui.sessao, b))[0]?.papel).toBe("apoio");

      const registar = (comerciante: string, criadaPor: string) => {
        const k = gerarChave("servidor");
        return registarChave(base.dono, comerciante, {
          tipo: "servidor",
          nome: "Chave de teste",
          ambitos: ["catalog:read"],
          prefixo: k.prefixo,
          resumo: k.resumo,
          criadaPor,
        });
      };
      const deRuiEmA = await registar(a, `pessoa:per_${rui.pessoa}`);
      const deRuiEmB = await registar(b, `pessoa:per_${rui.pessoa}`);
      const daDonaEmA = await registar(a, `pessoa:per_${dA.pessoa}`);

      await em(a, (trx) =>
        sql`select membro_terminar(${dA.sessao}, ${rui.membro}::uuid)`.execute(
          trx,
        ),
      );
      expect(await mensagemDoErro(resolver(rui.sessao, a))).toMatch(
        /^auth\.forbidden:/,
      );
      expect((await resolver(rui.sessao, b))[0]?.papel).toBe("apoio");

      const { rows } = await sql<{ id: string; revogada_por: string | null }>`
        select id, revogada_por from chave_api
        where id in (${deRuiEmA}::uuid, ${deRuiEmB}::uuid, ${daDonaEmA}::uuid)`.execute(
        dono,
      );
      const por = Object.fromEntries(rows.map((r) => [r.id, r.revogada_por]));
      expect(por[deRuiEmA]).toBe(`membro_terminado:per_${rui.pessoa}`);
      expect(por[deRuiEmB]).toBeNull();
      expect(por[daDonaEmA]).toBeNull();
    });

    it("um gestor não tira outros; cada um sai por si", async () => {
      const c = await registarComerciante(base.api, {
        nome: "Loja Saída",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      await pessoaCom(c, "dono");
      const g = await pessoaCom(c, "gestor");
      const ap = await pessoaCom(c, "apoio");
      const terminar = (sessao: string, membro: string) =>
        em(c, (trx) =>
          sql`select membro_terminar(${sessao}, ${membro}::uuid)`.execute(trx),
        );
      expect(await mensagemDoErro(terminar(g.sessao, ap.membro))).toMatch(
        /^member\.role_escalation:/,
      );
      await terminar(ap.sessao, ap.membro);
      expect(await mensagemDoErro(resolver(ap.sessao, c))).toMatch(
        /^auth\.forbidden:/,
      );
    });

    it("P-T10: o dono de A não chega aos membros de B nem às outras lojas da pessoa", async () => {
      const dA = await pessoaCom(a, "dono");
      const deB = await pessoaCom(b, "gestor");
      expect(
        await mensagemDoErro(
          em(a, (trx) =>
            sql`select membro_terminar(${dA.sessao}, ${deB.membro}::uuid)`.execute(
              trx,
            ),
          ),
        ),
      ).toMatch(/^member\.not_found:/);
      expect(
        await mensagemDoErro(
          em(a, (trx) =>
            sql`select membro_mudar_papel(${dA.sessao}, ${deB.membro}::uuid, 'apoio')`.execute(
              trx,
            ),
          ),
        ),
      ).toMatch(/^member\.not_found:/);
      // Convidar a pessoa de B para A não lhe dá acesso: só ela aceita,
      // autenticada (P-T9), e A nunca vê B.
      const convite = await convidar(a, dA.sessao, deB.email, "apoio");
      expect(await mensagemDoErro(aceitar(convite, dA.sessao))).toMatch(
        /^invite\.other_person:/,
      );
      expect(await mensagemDoErro(resolver(dA.sessao, b))).toMatch(
        /^auth\.forbidden:/,
      );
    });
  });

  describe("quem perde poderes perde o que abriu (revisão do #141)", () => {
    const novoComerciante = (nome: string) =>
      registarComerciante(base.api, {
        nome,
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
    const chaveDe = async (
      comerciante: string,
      pessoa: string,
      ambitos: Ambito[],
    ) => {
      const k = gerarChave("servidor");
      return registarChave(base.dono, comerciante, {
        tipo: "servidor",
        nome: "Chave de teste",
        ambitos,
        prefixo: k.prefixo,
        resumo: k.resumo,
        criadaPor: `pessoa:per_${pessoa}`,
      });
    };
    const revogadaPor = async (id: string) => {
      const { rows } = await sql<{ por: string | null }>`
        select revogada_por as por from chave_api where id = ${id}::uuid`.execute(
        dono,
      );
      return rows[0]?.por;
    };

    it("P1-1: o convite de quem saiu ou foi despromovido deixa de valer", async () => {
      const c = await novoComerciante("Loja Convites");
      const d = await pessoaCom(c, "dono");
      const g = await pessoaCom(c, "gestor");
      const d2 = await pessoaCom(c, "dono");
      const deG = await convidar(c, g.sessao, "de-g@exemplo.test", "apoio");
      const deD2 = await convidar(c, d2.sessao, "de-d2@exemplo.test", "dono");
      const deD2Apoio = await convidar(
        c,
        d2.sessao,
        "de-d2-apoio@exemplo.test",
        "apoio",
      );
      await em(c, (trx) =>
        sql`select membro_terminar(${d.sessao}, ${g.membro}::uuid)`.execute(
          trx,
        ),
      );
      expect(await mensagemDoErro(contaNova(deG, "Depois"))).toMatch(
        /^invite\.invalid:/,
      );
      // Um dono despromovido a gestor: o convite «dono» cai; o «apoio», que
      // um gestor ainda dá, fica.
      await em(c, (trx) =>
        sql`select membro_mudar_papel(${d.sessao}, ${d2.membro}::uuid, 'gestor')`.execute(
          trx,
        ),
      );
      expect(await mensagemDoErro(contaNova(deD2, "Dono"))).toMatch(
        /^invite\.invalid:/,
      );
      await contaNova(deD2Apoio, "Apoio");
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from evento_conta
        where comerciante_id = ${c}::uuid and acto = 'convite_cancelado'`.execute(
        dono,
      );
      expect(rows[0]?.n).toBe(2);
    });

    it("P2-3: despromover revoga as chaves com âmbitos que o papel novo não tem", async () => {
      const c = await novoComerciante("Loja Despromover");
      const d = await pessoaCom(c, "dono");
      const d2 = await pessoaCom(c, "dono");
      const gestora = await chaveDe(c, d2.pessoa, [
        "keys:write",
        "catalog:read",
      ]);
      const leitora = await chaveDe(c, d2.pessoa, ["catalog:read"]);
      await em(c, (trx) =>
        sql`select membro_mudar_papel(${d.sessao}, ${d2.membro}::uuid, 'apoio')`.execute(
          trx,
        ),
      );
      expect(await revogadaPor(gestora)).toBe(`papel_mudado:per_${d2.pessoa}`);
      expect(await revogadaPor(leitora)).toBeNull();
      const { rows } = await sql<{ papel: string; papel_antes: string }>`
        select papel, papel_antes from evento_conta
        where membro_id = ${d2.membro}::uuid and acto = 'papel_mudado'`.execute(
        dono,
      );
      expect(rows).toEqual([{ papel: "apoio", papel_antes: "dono" }]);
    });

    it("P2-3: desactivar sai de todas as equipas e revoga as chaves e os convites em todas", async () => {
      const c1 = await novoComerciante("Loja D1");
      const c2 = await novoComerciante("Loja D2");
      await pessoaCom(c1, "dono");
      await pessoaCom(c2, "dono");
      const g = await pessoaCom(c1, "gestor");
      await aceitar(
        await convidarPeloOperador(c2, g.email, "gestor"),
        g.sessao,
      );
      const k1 = await chaveDe(c1, g.pessoa, ["catalog:read"]);
      const k2 = await chaveDe(c2, g.pessoa, ["catalog:read"]);
      const convite = await convidar(
        c2,
        g.sessao,
        "de-g2@exemplo.test",
        "apoio",
      );
      await sql`select pessoa_desactivar(${g.pessoa}::uuid, ${OPERADOR})`.execute(
        dono,
      );
      expect(await revogadaPor(k1)).toBe(`pessoa_desactivada:per_${g.pessoa}`);
      expect(await revogadaPor(k2)).toBe(`pessoa_desactivada:per_${g.pessoa}`);
      expect(await mensagemDoErro(contaNova(convite, "Depois"))).toMatch(
        /^invite\.invalid:/,
      );
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from membro
        where pessoa_id = ${g.pessoa}::uuid and ate is null`.execute(dono);
      expect(rows[0]?.n).toBe(0);
    });

    it("T-2: uma pessoa desactivada não resolve, mesmo com a sessão por revogar", async () => {
      const p = await pessoaCom(a, "apoio");
      await sql`update pessoa set estado = 'desactivada' where id = ${p.pessoa}::uuid`.execute(
        dono,
      );
      expect(await mensagemDoErro(resolver(p.sessao, a))).toMatch(
        /^auth\.unauthenticated:/,
      );
    });

    it("P3-5: aceitar um convite exige autenticação recente", async () => {
      const p = await pessoaCom(b, "apoio");
      const convite = await convidarPeloOperador(a, p.email, "apoio");
      await envelhecer(
        "sessao",
        "autenticada_em",
        await sessaoId(p.sessao),
        "11 minutes",
      );
      expect(await mensagemDoErro(aceitar(convite, p.sessao))).toMatch(
        /^auth\.reauthentication_required:/,
      );
    });

    it("T-1: dois aceites autenticados ao mesmo tempo: o segundo espera e vê o convite usado", async () => {
      const p = await pessoaCom(b, "apoio");
      const convite = await convidarPeloOperador(a, p.email, "apoio");
      let libertar = () => {};
      const aberta = new Promise<void>((r) => (libertar = r));
      let aceitou = () => {};
      const feito = new Promise<void>((r) => (aceitou = r));
      const primeiro = dono.transaction().execute(async (trx) => {
        await sql`select * from convite_aceitar(${convite}, ${p.sessao})`.execute(
          trx,
        );
        aceitou();
        await aberta;
      });
      await feito;
      const segundo = aceitar(convite, p.sessao);
      const corrida = await Promise.race([
        segundo.then(
          () => "passou",
          () => "falhou",
        ),
        new Promise((r) =>
          setTimeout(() => {
            r("à espera");
          }, 300),
        ),
      ]);
      expect(corrida).toBe("à espera");
      libertar();
      await primeiro;
      expect(await mensagemDoErro(segundo)).toMatch(/^invite\.invalid:/);
    });
  });

  describe("sessões (§4.6; CD)", () => {
    it("sem uso há 12 h, com mais de 30 dias ou terminada: não resolve", async () => {
      const p = await pessoaCom(a, "apoio");
      const parada = await sessaoDe(p.pessoa);
      await envelhecer(
        "sessao",
        "ultimo_uso_em",
        await sessaoId(parada),
        "12 hours 1 minute",
      );
      expect(await mensagemDoErro(resolver(parada, a))).toMatch(
        /^auth\.unauthenticated:/,
      );

      const velha = await sessaoDe(p.pessoa);
      await envelhecer(
        "sessao",
        "criada_em",
        await sessaoId(velha),
        "30 days 1 minute",
      );
      expect(await mensagemDoErro(resolver(velha, a))).toMatch(
        /^auth\.unauthenticated:/,
      );

      const terminada = await sessaoDe(p.pessoa);
      const { rows } = await sql<{ ok: boolean }>`
        select sessao_terminar(${terminada}) as ok`.execute(dono);
      expect(rows[0]?.ok).toBe(true);
      expect(await mensagemDoErro(resolver(terminada, a))).toMatch(
        /^auth\.unauthenticated:/,
      );

      expect((await resolver(p.sessao, a))[0]?.papel).toBe("apoio");
      expect(await mensagemDoErro(resolver(segredo(), a))).toMatch(
        /^auth\.unauthenticated:/,
      );
    });
  });

  describe("o rasto e os dados", () => {
    it("o evento_conta só se acrescenta, também para o dono", async () => {
      for (const consulta of [
        sql`update evento_conta set quem = quem`,
        sql`delete from evento_conta`,
        sql`truncate evento_conta`,
      ]) {
        expect(await mensagemDoErro(consulta.execute(dono))).toMatch(
          /^audit\.append_only:/,
        );
      }
    });

    it("nada se apaga; o e-mail de uma pessoa não muda; um convite não se reescreve", async () => {
      for (const t of ["pessoa", "membro", "convite", "sessao"]) {
        expect(
          await mensagemDoErro(sql`delete from ${sql.table(t)}`.execute(dono)),
          t,
        ).toMatch(/^account\.immutable:/);
      }
      expect(
        await mensagemDoErro(
          sql`update pessoa set email = 'outro@exemplo.test'`.execute(dono),
        ),
      ).toMatch(/^account\.immutable:/);
      expect(
        await mensagemDoErro(
          sql`update convite set resumo = repeat('0', 64)`.execute(dono),
        ),
      ).toMatch(/^account\.immutable:/);
    });
  });
});
