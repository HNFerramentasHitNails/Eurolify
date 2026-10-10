import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Clientes, parte 2a: os consentimentos e a régua única do marketing (docs/23
// §3.6; migração 0042). A régua vive na base (pode_receber_marketing); estes
// testes perguntam-lhe pela API e directamente, e conferem que a prova não
// se altera.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)(
  "consentimentos e a régua do marketing",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let a: string;
    let b: string;
    let dono: string;
    let donoId: string;
    let soLer: string;
    let deB: string;

    const pedir = (
      metodo: "POST" | "GET",
      url: string,
      corpo?: unknown,
      segredo = dono,
    ) =>
      app.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
          ...(corpo === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
      });
    const ok = async (
      r: ReturnType<typeof pedir>,
      estado = 200,
    ): Promise<Json> => {
      const x = await r;
      expect(x.statusCode, x.body).toBe(estado);
      return x.json();
    };
    const recusa = async (
      r: ReturnType<typeof pedir>,
      estado: number,
      codigo?: string,
    ) => {
      const x = await r;
      expect(x.statusCode, x.body).toBe(estado);
      if (codigo !== undefined) expect(x.json<Json>()["codigo"]).toBe(codigo);
    };

    // Cada ficha com o seu contacto: o estado é do contacto no comerciante
    // (0051), e um e-mail repetido juntava as declarações de testes diferentes.
    const contactos = new Map<string, { email: string; telefone: string }>();
    let proximo = 0;
    const contactoDe = (ficha: string, canal: string) => {
      const c = contactos.get(ficha);
      if (c === undefined) throw new Error(`ficha sem contactos: ${ficha}`);
      return canal === "email" ? c.email : c.telefone;
    };
    const declaracao = (
      canal: string,
      d: "aceitou" | "retirou",
      extra: Json = {},
      ficha = "",
    ) => ({
      canal,
      declaracao: d,
      // O contacto da ficha (0051): o e-mail ou o telefone de `ficha()`.
      contacto: ficha === "" ? "sem@exemplo.pt" : contactoDe(ficha, canal),
      texto: "Quero receber novidades e promoções por e-mail.",
      versao_texto: "v3",
      onde: "loja principal, formulário de registo",
      ...extra,
    });
    const ficha = async (segredo = dono) => {
      const n = proximo++;
      const email = `ana.${String(n)}.${Date.now().toString(36)}@exemplo.pt`;
      const telefone = `+3519${String(Date.now() % 10_000_000).padStart(7, "0")}${String(n % 10)}`;
      const id = String(
        (
          await ok(
            pedir(
              "POST",
              "/customers",
              { nome: "Ana", emails: [email], telefones: [telefone] },
              segredo,
            ),
            201,
          )
        )["id"],
      );
      contactos.set(id, { email, telefone });
      return id;
    };
    const consentimentos = (id: string, segredo = dono) =>
      ok(pedir("GET", `/customers/${id}/consents`, undefined, segredo));

    /** Uma transacção do dono da base no contexto do comerciante, desfeita no fim. */
    async function desfeito<T>(
      c: string,
      fn: (trx: Kysely<unknown>) => Promise<T>,
    ): Promise<T> {
      let resultado: T | undefined;
      const fim = new Error("desfazer");
      await base.dono
        .transaction()
        .execute(async (trx) => {
          await sql`select set_config('eurolify.comerciante', ${c}, true)`.execute(
            trx,
          );
          await sql`select set_config('eurolify.quem', 'teste:sql', true)`.execute(
            trx,
          );
          resultado = await fn(trx);
          throw fim;
        })
        .catch((e: unknown) => {
          if (e !== fim) throw e;
        });
      return resultado as T;
    }
    const regua = async (trx: Kysely<unknown>, id: string, canal: string) =>
      (
        await sql<{ pode: boolean }>`
        select pode_receber_marketing(${id.slice(4)}::uuid, ${canal}) as pode`.execute(
          trx,
        )
      ).rows[0]?.pode;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
      app = criarApp({ logger: false }, undefined, base.api);
      a = await registarComerciante(base.api, {
        nome: "A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      b = await registarComerciante(base.api, {
        nome: "B",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const chave = (c: string, nome: string, ambitos: string[]) =>
        criarChave(base.dono, c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome,
          ambitos: ambitos as never,
        });
      const d = await chave(a, "Dono", ["customers:read", "customers:write"]);
      dono = d.segredo;
      donoId = d.id;
      soLer = (await chave(a, "Só ler", ["customers:read"])).segredo;
      deB = (await chave(b, "B", ["customers:read", "customers:write"]))
        .segredo;
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await base.fechar();
    });

    it("sem declaração, não; aceitou, sim só nesse canal; retirou, não; a mais recente vale", async () => {
      const id = await ficha();
      expect(await consentimentos(id)).toEqual({
        dados: [],
        total: 0,
        ha_mais: false,
        cursor_seguinte: null,
        pode_receber_marketing: { email: false, sms: false, whatsapp: false },
        contactos_com_marketing: { email: [], sms: [], whatsapp: [] },
      });
      const c1 = await ok(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "aceitou", {}, id),
        ),
        201,
      );
      expect(c1).toMatchObject({
        cliente: id,
        canal: "email",
        finalidade: "marketing",
        declaracao: "aceitou",
        versao_texto: "v3",
        onde: "loja principal, formulário de registo",
        quem: `chave:key_${donoId}`,
      });
      expect(String(c1["id"])).toMatch(/^cns_/);
      expect((await consentimentos(id))["pode_receber_marketing"]).toEqual({
        email: true,
        sms: false,
        whatsapp: false,
      });

      await ok(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "retirou", {}, id),
        ),
        201,
      );
      expect((await consentimentos(id))["pode_receber_marketing"]).toEqual({
        email: false,
        sms: false,
        whatsapp: false,
      });

      // Sobre a recusa, o «sim» pede a dupla confirmação (0051): a régua não
      // muda até o contacto confirmar.
      const pedidoSim = await ok(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "aceitou", {}, id),
        ),
        202,
      );
      expect(
        (await consentimentos(id))["pode_receber_marketing"],
      ).toMatchObject({ email: false });
      await ok(
        pedir(
          "POST",
          `/consent-confirmations/${String(pedidoSim["confirmacao"])}/confirm`,
          { segredo: pedidoSim["segredo"] },
        ),
        201,
      );
      const r = await consentimentos(id);
      expect(r["pode_receber_marketing"]).toEqual({
        email: true,
        sms: false,
        whatsapp: false,
      });
      // As mais recentes primeiro; nada se perdeu.
      const dados = r["dados"] as Json[];
      expect(dados.map((d) => d["declaracao"])).toEqual([
        "aceitou",
        "retirou",
        "aceitou",
      ]);
      expect(dados.at(-1)?.["id"]).toBe(c1["id"]);
    });

    it("o WhatsApp só com declaração explícita; um SMS aceite não o abre", async () => {
      const id = await ficha();
      await ok(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("sms", "aceitou", {}, id),
        ),
        201,
      );
      expect((await consentimentos(id))["pode_receber_marketing"]).toEqual({
        email: false,
        sms: true,
        whatsapp: false,
      });
      await ok(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("whatsapp", "aceitou", {}, id),
        ),
        201,
      );
      expect(
        ((await consentimentos(id))["pode_receber_marketing"] as Json)[
          "whatsapp"
        ],
      ).toBe(true);
    });

    it("empate na mesma hora ⇒ não; duas iguais na mesma hora ⇒ a declaração", async () => {
      const id = await ficha();
      const resultado = await desfeito(a, async (trx) => {
        // Só aqui se escolhe a hora: o gatilho põe sempre a do relógio.
        await sql`alter table consentimento disable trigger consentimento_antes_de_gravar`.execute(
          trx,
        );
        const inserir = (d: string, canal: string) =>
          sql`insert into consentimento (comerciante_id, cliente_id, canal,
                declaracao, texto, versao_texto, onde, declarado_em, quem, contacto)
              values (${a}::uuid, ${id.slice(4)}::uuid, ${canal}, ${d}, 't',
                'v1', 'x', '2026-10-09T10:00:00Z', 'teste:sql',
                ${contactoDe(id, canal)})`.execute(trx);
        await inserir("aceitou", "email");
        await inserir("retirou", "email");
        await inserir("aceitou", "sms");
        await inserir("aceitou", "sms");
        return [await regua(trx, id, "email"), await regua(trx, id, "sms")];
      });
      expect(resultado).toEqual([false, true]);
    });

    it("ficha limitada ⇒ não, mesmo com aceitou; numa fundida, a declaração vai para a que ficou; numa pseudonimizada, recusa", async () => {
      const id = await ficha();
      const outra = await ficha();
      await ok(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "aceitou", {}, id),
        ),
        201,
      );
      const limitada = await desfeito(a, async (trx) => {
        await sql`update cliente set limitado = true where id = ${id.slice(4)}::uuid`.execute(
          trx,
        );
        return regua(trx, id, "email");
      });
      expect(limitada).toBe(false);
      // Fundida (migração 0046, revisão do #289, P2-4): a declaração pedida com
      // o id antigo regista-se na ficha que ficou, e a régua dela conta as
      // duas.
      const fundida = await desfeito(a, async (trx) => {
        await sql`update cliente set estado = 'fundido', fundido_em = ${outra.slice(4)}::uuid
                  where id = ${id.slice(4)}::uuid`.execute(trx);
        // A fusão passa os contactos para a que fica (0046); o estado é do
        // contacto (0051).
        await sql`update cliente set emails = emails || array[${contactoDe(id, "email")}]
                  where id = ${outra.slice(4)}::uuid`.execute(trx);
        const antes = await regua(trx, outra, "email");
        const linha = await sql<{ cliente_id: string }>`
          insert into consentimento (comerciante_id, cliente_id,
            canal, declaracao, texto, versao_texto, onde, contacto)
          values (${a}::uuid, ${id.slice(4)}::uuid, 'email', 'retirou', 't', 'v1', 'x', ${contactoDe(id, "email")})
          returning cliente_id`.execute(trx);
        return {
          pode: await regua(trx, id, "email"),
          antes,
          ficou: linha.rows[0]?.cliente_id,
          depois: await regua(trx, outra, "email"),
        };
      });
      expect(fundida).toEqual({
        pode: false,
        antes: true,
        ficou: outra.slice(4),
        depois: false,
      });
      const pseudonimizada = await desfeito(a, async (trx) => {
        await sql`update cliente set estado = 'pseudonimizado' where id = ${id.slice(4)}::uuid`.execute(
          trx,
        );
        return sql`insert into consentimento (comerciante_id, cliente_id,
              canal, declaracao, texto, versao_texto, onde, contacto)
            values (${a}::uuid, ${id.slice(4)}::uuid, 'email', 'retirou', 't', 'v1', 'x', ${contactoDe(id, "email")})`
          .execute(trx)
          .then(
            () => "entrou",
            (e: unknown) => (e as Error).message,
          );
      });
      expect(pseudonimizada).toMatch(/^customers\.invalid_transition:/);
      // Fora das transacções desfeitas, a ficha continua activa e a dizer sim.
      expect(
        ((await consentimentos(id))["pode_receber_marketing"] as Json)["email"],
      ).toBe(true);
    });

    it("a prova não se altera nem se apaga, nem pelo dono da base", async () => {
      const id = await ficha();
      const c = await ok(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "aceitou", {}, id),
        ),
        201,
      );
      const cns = String(c["id"]).slice(4);
      for (const comando of [
        sql`update consentimento set declaracao = 'retirou' where id = ${cns}::uuid`,
        sql`delete from consentimento where id = ${cns}::uuid`,
        sql`truncate consentimento cascade`,
      ]) {
        await expect(
          desfeito(a, (trx) => comando.execute(trx)),
        ).rejects.toThrow(/audit\.append_only/);
      }
      // E a API não tem o privilégio de alterar.
      const { rows } = await sql<{ altera: boolean; apaga: boolean }>`
        select has_table_privilege('eurolify_api', 'consentimento', 'UPDATE') as altera,
               has_table_privilege('eurolify_api', 'consentimento', 'DELETE') as apaga`.execute(
        base.dono,
      );
      expect(rows[0]).toEqual({ altera: false, apaga: false });
    });

    it("a hora e quem põe-nos a base; sem quem, recusa", async () => {
      const id = await ficha();
      const r = await desfeito(a, async (trx) => {
        const linha = await sql<{ declarado_em: Date; quem: string }>`
          insert into consentimento (comerciante_id, cliente_id, canal, declaracao,
            texto, versao_texto, onde, declarado_em, quem, contacto)
          values (${a}::uuid, ${id.slice(4)}::uuid, 'email', 'aceitou', 't', 'v1',
            'x', '2020-01-01T00:00:00Z', 'pessoa:per_falso', ${contactoDe(id, "email")})
          returning declarado_em, quem`.execute(trx);
        await sql`select set_config('eurolify.quem', '', true)`.execute(trx);
        const sem =
          await sql`insert into consentimento (comerciante_id, cliente_id,
              canal, declaracao, texto, versao_texto, onde, contacto)
            values (${a}::uuid, ${id.slice(4)}::uuid, 'email', 'retirou', 't', 'v1', 'x', ${contactoDe(id, "email")})`
            .execute(trx)
            .then(
              () => "entrou",
              (e: unknown) => (e as Error).message,
            );
        return { linha: linha.rows[0], sem };
      });
      expect(r.linha?.quem).toBe("teste:sql");
      expect(r.linha?.declarado_em.getUTCFullYear()).toBeGreaterThanOrEqual(
        2026,
      );
      expect(r.sem).toMatch(/^customers\.change_without_who:/);
    });

    it("o evento consent.changed leva a régua e nunca o texto; a linha do tempo leva a declaração", async () => {
      const id = await ficha();
      const c = await ok(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "aceitou", {}, id),
        ),
        201,
      );
      await ok(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "retirou", {}, id),
        ),
        201,
      );
      const eventos = await desfeito(
        a,
        async (trx) =>
          (
            await sql<{ dados: Json }>`
            select dados from evento_saida
            where tipo = 'consent.changed' and agregado_id = ${id.slice(4)}::uuid
            order by id`.execute(trx)
          ).rows,
      );
      expect(eventos.map((e) => e.dados["pode_receber_marketing"])).toEqual([
        true,
        false,
      ]);
      expect(Object.keys(eventos[0]?.dados ?? {}).sort()).toEqual([
        "canal",
        "cliente_id",
        "consentimento_id",
        "contacto_pode_receber",
        "em",
        "finalidade",
        "pode_receber_marketing",
        "quem",
        "via",
      ]);
      expect(eventos[0]?.dados).toMatchObject({
        cliente_id: id.slice(4),
        consentimento_id: String(c["id"]).slice(4),
        canal: "email",
        finalidade: "marketing",
      });
      const t = await ok(pedir("GET", `/customers/${id}/timeline`));
      const linhas = (t["dados"] as Json[]).filter(
        (d) => d["entidade"] === "consentimento",
      );
      expect(linhas).toHaveLength(2);
      expect(linhas[1]).toMatchObject({
        entidade_id: c["id"],
        operacao: "criado",
        quem: `chave:key_${donoId}`,
        campos: { declaracao: { antes: null, depois: "aceitou" } },
      });
    });

    it("isolamento: o comerciante B não lê nem regista na ficha de A, e a régua dá não", async () => {
      const id = await ficha();
      await ok(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "aceitou", {}, id),
        ),
        201,
      );
      await recusa(
        pedir("GET", `/customers/${id}/consents`, undefined, deB),
        404,
        "customers.not_found",
      );
      await recusa(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "retirou", {}, id),
          deB,
        ),
        404,
        "customers.not_found",
      );
      const deFora = await base.api.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${b}, true)`.execute(
          trx,
        );
        return regua(trx as unknown as Kysely<unknown>, id, "email");
      });
      expect(deFora).toBe(false);
      expect(
        ((await consentimentos(id))["pode_receber_marketing"] as Json)["email"],
      ).toBe(true);
    });

    it("só com customers:write; o corpo é conferido", async () => {
      const id = await ficha();
      await recusa(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "aceitou", {}, id),
          soLer,
        ),
        403,
      );
      expect(
        ((await consentimentos(id, soLer))["dados"] as Json[]).length,
      ).toBe(0);
      for (const corpo of [
        declaracao("email", "aceitou", { declaracao: "nunca_aceitou" }),
        declaracao("email", "aceitou", { canal: "carta" }),
        declaracao("email", "aceitou", { texto: "" }),
        declaracao("email", "aceitou", { finalidade: "avaliacoes" }),
        declaracao("email", "aceitou", { declarado_em: "2020-01-01" }),
      ]) {
        await recusa(pedir("POST", `/customers/${id}/consents`, corpo), 400);
      }
      await recusa(
        pedir(
          "POST",
          `/customers/cus_${randomUUID()}/consents`,
          declaracao("email", "aceitou"),
        ),
        404,
        "customers.not_found",
      );
    });

    it("dois pedidos ao mesmo tempo: a régua segue a declaração que ficou por último", async () => {
      for (let volta = 0; volta < 5; volta++) {
        const id = await ficha();
        const [sim] = await Promise.all([
          pedir(
            "POST",
            `/customers/${id}/consents`,
            declaracao("email", "aceitou", {}, id),
          ),
          ok(
            pedir(
              "POST",
              `/customers/${id}/consents`,
              declaracao("email", "retirou", {}, id),
            ),
            201,
          ),
        ]);
        const r = await consentimentos(id);
        // Se a retirada entrou primeiro, o «sim» pede confirmação (0051): fica
        // só a retirada, e a régua dá não.
        if (sim.statusCode === 202) {
          expect(r["dados"] as Json[]).toHaveLength(1);
          expect((r["pode_receber_marketing"] as Json)["email"]).toBe(false);
          continue;
        }
        expect(sim.statusCode, sim.body).toBe(201);
        const [ultima, primeira] = r["dados"] as Json[];
        // A ordem é a da base (ao microssegundo); o JSON mostra milissegundos.
        expect(
          String(ultima?.["declarado_em"]) >=
            String(primeira?.["declarado_em"]),
        ).toBe(true);
        expect((r["pode_receber_marketing"] as Json)["email"]).toBe(
          ultima?.["declaracao"] === "aceitou",
        );
      }
    });

    /** Uma transacção da API no comerciante A que fica aberta enquanto `durante` corre. */
    async function aberta(
      antes: (trx: Kysely<unknown>) => Promise<void>,
      durante: () => Promise<void>,
      depois: (trx: Kysely<unknown>) => Promise<void>,
    ) {
      await base.api.transaction().execute(async (t) => {
        const trx = t as unknown as Kysely<unknown>;
        await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
          trx,
        );
        await sql`select set_config('eurolify.quem', 'teste:sql', true)`.execute(
          trx,
        );
        await antes(trx);
        await durante();
        await depois(trx);
      });
    }
    const inserirPelaApi = (trx: Kysely<unknown>, id: string, d: string) =>
      sql`insert into consentimento (comerciante_id, cliente_id, canal,
            declaracao, texto, versao_texto, onde, contacto)
          values (${a}::uuid, ${id.slice(4)}::uuid, 'email', ${d}, 't', 'v1', 'x', ${contactoDe(id, "email")})`.execute(
        trx,
      );

    it("a hora é a de quando a declaração entra, não a do início da transacção", async () => {
      // Uma transacção começa, outra regista «aceitou» e acaba, e a primeira
      // regista «retirou» depois: o cliente retirou por último.
      const id = await ficha();
      await aberta(
        async (trx) => {
          await sql`select now()`.execute(trx);
        },
        async () => {
          await ok(
            pedir(
              "POST",
              `/customers/${id}/consents`,
              declaracao("email", "aceitou", {}, id),
            ),
            201,
          );
        },
        (trx) => inserirPelaApi(trx, id, "retirou").then(() => undefined),
      );
      const r = await consentimentos(id);
      expect((r["dados"] as Json[])[0]?.["declaracao"]).toBe("retirou");
      expect((r["pode_receber_marketing"] as Json)["email"]).toBe(false);
    });

    it("as declarações da mesma ficha entram uma de cada vez: a segunda espera e o evento dela já vê a primeira", async () => {
      const id = await ficha();
      let segunda: Promise<Json> | undefined;
      let acabou = false;
      await aberta(
        (trx) => inserirPelaApi(trx, id, "aceitou").then(() => undefined),
        async () => {
          segunda = ok(
            pedir(
              "POST",
              `/customers/${id}/consents`,
              declaracao("email", "retirou", {}, id),
            ),
            201,
          ).then((x) => {
            acabou = true;
            return x;
          });
          await new Promise((ok) => setTimeout(ok, 300));
          expect(acabou).toBe(false);
        },
        () => Promise.resolve(),
      );
      await segunda;
      const eventos = await desfeito(
        a,
        async (trx) =>
          (
            await sql<{ dados: Json }>`
            select dados from evento_saida
            where tipo = 'consent.changed' and agregado_id = ${id.slice(4)}::uuid
            order by dados ->> 'em'`.execute(trx)
          ).rows,
      );
      expect(eventos.map((e) => e.dados["pode_receber_marketing"])).toEqual([
        true,
        false,
      ]);
    });

    it("a régua dá falso, nunca nulo, sem declarações e para um canal que não existe", async () => {
      const id = await ficha();
      const r = await desfeito(
        a,
        async (trx) =>
          (
            await sql<{ sem: boolean | null; carta: boolean | null }>`
          select pode_receber_marketing(${id.slice(4)}::uuid, 'email') as sem,
                 pode_receber_marketing(${id.slice(4)}::uuid, 'carta') as carta`.execute(
              trx,
            )
          ).rows[0],
      );
      expect(r).toEqual({ sem: false, carta: false });
    });
    it("o relógio a recuar não põe uma retirada antes da declaração anterior", async () => {
      const id = await ficha();
      const r = await desfeito(a, async (trx) => {
        // Uma declaração com hora no futuro, como se o relógio tivesse recuado
        // depois dela.
        await sql`alter table consentimento disable trigger consentimento_antes_de_gravar`.execute(
          trx,
        );
        await sql`insert into consentimento (comerciante_id, cliente_id, canal,
              declaracao, texto, versao_texto, onde, declarado_em, quem)
            values (${a}::uuid, ${id.slice(4)}::uuid, 'email', 'aceitou', 't',
              'v1', 'x', '2030-01-01T00:00:00Z', 'teste:sql')`.execute(trx);
        // As chaves diferidas da 0051 verificam-se já, para o ALTER poder correr.
        await sql`set constraints all immediate`.execute(trx);
        await sql`alter table consentimento enable always trigger consentimento_antes_de_gravar`.execute(
          trx,
        );
        const nova = await sql<{ declarado_em: Date }>`
          insert into consentimento (comerciante_id, cliente_id, canal,
            declaracao, texto, versao_texto, onde, contacto)
          values (${a}::uuid, ${id.slice(4)}::uuid, 'email', 'retirou', 't', 'v1', 'x', ${contactoDe(id, "email")})
          returning declarado_em`.execute(trx);
        return {
          hora: nova.rows[0]?.declarado_em.toISOString(),
          pode: await regua(trx, id, "email"),
        };
      });
      expect(r).toEqual({ hora: "2030-01-01T00:00:00.000Z", pode: false });
    });

    it("a lista vem por páginas, sem repetir, e a régua em todas", async () => {
      const id = await ficha();
      for (const d of ["aceitou", "aceitou", "aceitou"] as const) {
        await ok(
          pedir(
            "POST",
            `/customers/${id}/consents`,
            declaracao("sms", d, {}, id),
          ),
          201,
        );
      }
      const p1 = await ok(pedir("GET", `/customers/${id}/consents?limite=2`));
      expect(p1).toMatchObject({ total: 3, ha_mais: true });
      const p2 = await ok(
        pedir(
          "GET",
          `/customers/${id}/consents?limite=2&cursor=${String(p1["cursor_seguinte"])}`,
        ),
      );
      expect(p2).toMatchObject({
        total: 3,
        ha_mais: false,
        cursor_seguinte: null,
      });
      const todas = (await consentimentos(id))["dados"] as Json[];
      expect([...(p1["dados"] as Json[]), ...(p2["dados"] as Json[])]).toEqual(
        todas,
      );
      for (const p of [p1, p2]) {
        expect((p["pode_receber_marketing"] as Json)["sms"]).toBe(true);
      }
    });

    it("a API não escolhe o id, a hora nem quem; a ficha de outro comerciante não serve", async () => {
      const { rows } = await sql<{ coluna: string; pode: boolean }>`
        select c as coluna, has_column_privilege('eurolify_api', 'consentimento', c, 'INSERT') as pode
        from unnest(array['id', 'declarado_em', 'quem', 'canal', 'contacto', 'via',
          'confirmacao_id']) c`.execute(base.dono);
      // A API diz o contacto, mas não regista um «sim» por dupla confirmação
      // (0051).
      expect(rows).toEqual([
        { coluna: "id", pode: false },
        { coluna: "declarado_em", pode: false },
        { coluna: "quem", pode: false },
        { coluna: "canal", pode: true },
        { coluna: "contacto", pode: true },
        { coluna: "via", pode: false },
        { coluna: "confirmacao_id", pode: false },
      ]);
      const deA = await ficha();
      const erro = await base.api
        .transaction()
        .execute(async (trx) => {
          await sql`select set_config('eurolify.comerciante', ${b}, true)`.execute(
            trx,
          );
          await sql`select set_config('eurolify.quem', 'teste:sql', true)`.execute(
            trx,
          );
          await sql`insert into consentimento (comerciante_id, cliente_id, canal,
                declaracao, texto, versao_texto, onde, contacto)
              values (${b}::uuid, ${deA.slice(4)}::uuid, 'email', 'aceitou', 't', 'v1', 'x', ${contactoDe(deA, "email")})`.execute(
            trx,
          );
        })
        .then(
          () => "entrou",
          (e: unknown) => (e as Error).message,
        );
      expect(erro).toMatch(/^customers\.not_found:/);
    });

    it("uma ficha limitada continua a aceitar declarações (retirar não pode ficar mais difícil)", async () => {
      const id = await ficha();
      const r = await desfeito(a, async (trx) => {
        await sql`update cliente set limitado = true where id = ${id.slice(4)}::uuid`.execute(
          trx,
        );
        await sql`insert into consentimento (comerciante_id, cliente_id, canal,
              declaracao, texto, versao_texto, onde, contacto)
            values (${a}::uuid, ${id.slice(4)}::uuid, 'email', 'retirou', 't', 'v1', 'x', ${contactoDe(id, "email")})`.execute(
          trx,
        );
        return regua(trx, id, "email");
      });
      expect(r).toBe(false);
    });

    it("o mesmo pedido repetido (Idempotency-Key) regista uma vez só", async () => {
      const id = await ficha();
      const chave = randomUUID();
      const enviar = () =>
        app.inject({
          method: "POST",
          url: `/customers/${id}/consents`,
          headers: {
            authorization: `Bearer ${dono}`,
            "idempotency-key": chave,
            "content-type": "application/json",
          },
          payload: JSON.stringify(declaracao("email", "aceitou", {}, id)),
        });
      const r1 = await enviar();
      const r2 = await enviar();
      expect(r1.statusCode, r1.body).toBe(201);
      expect(r2.json<Json>()["id"]).toBe(r1.json<Json>()["id"]);
      expect((await consentimentos(id))["total"]).toBe(1);
    });
  },
);
