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

// O consentimento por contacto e a dupla confirmação (docs/23 §14; docs/06,
// DL; migração 0051). As regras C1–C7, uma a uma: o estado por contacto e
// canal; a prova diz o contacto; sobre uma recusa, um «sim» só conta
// confirmado no próprio contacto; sem confirmação, a recusa fica; um «sim»
// noutro contacto não mexe nos outros; a prova fica na ficha de origem e cai
// com ela.

type Json = Record<string, unknown>;

let sequencia = 0;
const unico = () => `${Date.now().toString(36)}${String(sequencia++)}`;

describe.skipIf(URL_BASE === undefined)(
  "consentimento por contacto e dupla confirmação",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let a: string;
    let dono: string;
    let deB: string;

    const pedir = (
      metodo: "POST" | "GET" | "PATCH",
      url: string,
      corpo?: unknown,
      segredo = dono,
      chave: string = randomUUID(),
    ) =>
      app.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(metodo === "GET" ? {} : { "idempotency-key": chave }),
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
      codigo: string,
    ) => {
      const x = await r;
      expect(x.statusCode, x.body).toBe(estado);
      expect(x.json<Json>()["codigo"]).toBe(codigo);
    };
    const declaracao = (
      canal: string,
      d: "aceitou" | "retirou",
      contacto: string,
    ) => ({
      canal,
      declaracao: d,
      contacto,
      texto: "Quero receber novidades.",
      versao_texto: "v1",
      onde: "loja, registo",
    });
    const declarar = (
      id: string,
      canal: string,
      d: "aceitou" | "retirou",
      contacto: string,
      estado = 201,
    ) =>
      ok(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao(canal, d, contacto),
        ),
        estado,
      );
    const confirmar = (confirmacao: unknown, segredo: unknown, quem = dono) =>
      pedir(
        "POST",
        `/consent-confirmations/${String(confirmacao)}/confirm`,
        { segredo },
        quem,
      );
    const comMarketing = async (id: string) =>
      (await ok(pedir("GET", `/customers/${id}/consents`)))[
        "contactos_com_marketing"
      ] as Record<string, string[]>;
    const ficha = async (dados: Json) =>
      String((await ok(pedir("POST", "/customers", dados), 201))["id"]);

    /** O dono da base no comerciante A, numa transacção que fica. */
    async function comoDono<T>(fn: (trx: Kysely<unknown>) => Promise<T>) {
      return base.dono.transaction().execute(async (trx) => {
        await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
          trx,
        );
        await sql`select set_config('eurolify.quem', 'teste:sql', true)`.execute(
          trx,
        );
        return fn(trx);
      });
    }

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
      app = criarApp({ logger: false }, undefined, base.api);
      a = await registarComerciante(base.api, {
        nome: "A",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const b = await registarComerciante(base.api, {
        nome: "B",
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const todos = [
        "customers:read",
        "customers:write",
        "customers:merge",
        "customers:privacy",
      ];
      const chave = (c: string) =>
        criarChave(base.dono, c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "Teste",
          ambitos: todos as never,
        });
      dono = (await chave(a)).segredo;
      deB = (await chave(b)).segredo;
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await base.fechar();
    });

    it("C1, C2 e C5: o estado é por contacto; um «sim» noutro contacto não mexe na recusa; o contacto tem de ser da ficha", async () => {
      const u = unico();
      const ana = `ana.${u}@exemplo.pt`;
      const silva = `ana.silva.${u}@exemplo.pt`;
      const id = await ficha({ nome: "Ana", emails: [ana, silva] });
      await declarar(id, "email", "retirou", ana);
      await declarar(id, "email", "aceitou", silva);
      expect((await comMarketing(id))["email"]).toEqual([silva]);
      // O mesmo e-mail com maiúsculas é o mesmo contacto.
      const c = await declarar(id, "email", "retirou", silva.toUpperCase());
      expect(c["contacto"]).toBe(silva);
      expect((await comMarketing(id))["email"]).toEqual([]);
      // Um contacto que não é da ficha, ou nenhum.
      await recusa(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "aceitou", `outro.${u}@exemplo.pt`),
        ),
        422,
        "customers.consent_contact_unknown",
      );
      await recusa(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("sms", "aceitou", ana),
        ),
        422,
        "customers.consent_contact_unknown",
      );
      const semContacto = await pedir("POST", `/customers/${id}/consents`, {
        ...declaracao("email", "aceitou", ana),
        contacto: undefined,
      });
      expect(semContacto.statusCode).toBe(400);
    });

    it("C3 e C4: sobre uma recusa, o «sim» pede confirmação; sem ela, a recusa fica; a confirmação é a prova", async () => {
      const u = unico();
      const ana = `ana.${u}@exemplo.pt`;
      const id = await ficha({ nome: "Ana", emails: [ana] });
      await declarar(id, "email", "aceitou", ana);
      await declarar(id, "email", "retirou", ana);
      const pedido = await declarar(id, "email", "aceitou", ana, 202);
      expect(pedido).toMatchObject({ canal: "email", contacto: ana });
      expect(String(pedido["confirmacao"])).toMatch(/^ccf_/);
      expect(String(pedido["segredo"]).length).toBeGreaterThanOrEqual(40);
      // Sem confirmação, a recusa fica, e só há as duas declarações.
      expect((await comMarketing(id))["email"]).toEqual([]);
      const lista = await ok(pedir("GET", `/customers/${id}/consents`));
      expect(lista["total"]).toBe(2);
      // Um segredo errado não confirma; fica contado.
      await recusa(
        confirmar(pedido["confirmacao"], "errado"),
        422,
        "customers.confirmation_invalid",
      );
      // Outro comerciante não vê o pedido.
      await recusa(
        confirmar(pedido["confirmacao"], pedido["segredo"], deB),
        404,
        "customers.not_found",
      );
      const feita = await ok(
        confirmar(pedido["confirmacao"], pedido["segredo"]),
        201,
      );
      expect(feita).toMatchObject({
        declaracao: "aceitou",
        contacto: ana,
        via: "dupla_confirmacao",
        confirmacao: pedido["confirmacao"],
        texto: "Quero receber novidades.",
      });
      expect((await comMarketing(id))["email"]).toEqual([ana]);
      // Já usada: não serve outra vez.
      await recusa(
        confirmar(pedido["confirmacao"], pedido["segredo"]),
        409,
        "customers.confirmation_closed",
      );
      const pedidos = await comoDono(
        async (trx) =>
          (
            await sql<{ estado: string; tentativas: number }>`
              select estado, tentativas from confirmacao_consentimento
              where id = ${String(pedido["confirmacao"]).slice(4)}::uuid`.execute(
              trx,
            )
          ).rows,
      );
      expect(pedidos).toEqual([{ estado: "confirmada", tentativas: 1 }]);
    });

    it("o SMS: código de 6 dígitos, 5 tentativas e esgota; um pedido novo cancela o anterior; o WhatsApp não confirma", async () => {
      const tel = "+351912000111";
      const id = await ficha({ nome: "Rui", telefones: [tel] });
      await declarar(id, "sms", "retirou", tel);
      const primeiro = await declarar(id, "sms", "aceitou", tel, 202);
      expect(String(primeiro["segredo"])).toMatch(/^[0-9]{6}$/);
      const segundo = await declarar(id, "sms", "aceitou", tel, 202);
      await recusa(
        confirmar(primeiro["confirmacao"], primeiro["segredo"]),
        409,
        "customers.confirmation_closed",
      );
      for (let i = 0; i < 4; i++) {
        await recusa(
          confirmar(segundo["confirmacao"], "000000x"),
          422,
          "customers.confirmation_invalid",
        );
      }
      await recusa(
        confirmar(segundo["confirmacao"], "000000x"),
        409,
        "customers.confirmation_exhausted",
      );
      // Esgotado, nem o código certo serve.
      await recusa(
        confirmar(segundo["confirmacao"], segundo["segredo"]),
        409,
        "customers.confirmation_exhausted",
      );
      expect((await comMarketing(id))["sms"]).toEqual([]);
      // WhatsApp: sem dupla confirmação.
      await declarar(id, "whatsapp", "retirou", tel);
      await recusa(
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("whatsapp", "aceitou", tel),
        ),
        422,
        "customers.confirmation_channel",
      );
    });

    it("o pedido expira; o segredo não fica na base, nos eventos nem na idempotência, e não se repete", async () => {
      const u = unico();
      const ana = `ana.${u}@exemplo.pt`;
      const id = await ficha({ nome: "Ana", emails: [ana] });
      await declarar(id, "email", "retirou", ana);
      const chave = randomUUID();
      const pedirSim = () =>
        pedir(
          "POST",
          `/customers/${id}/consents`,
          declaracao("email", "aceitou", ana),
          dono,
          chave,
        );
      const pedido = await ok(pedirSim(), 202);
      const segredo = String(pedido["segredo"]);
      // Repetir a chave não devolve o segredo.
      await recusa(pedirSim(), 409, "idempotency.secret_not_repeated");
      const tudo = await comoDono(async (trx) =>
        JSON.stringify({
          eventos: (
            await sql`select dados from evento_saida
              where agregado_id = ${id.slice(4)}::uuid`.execute(trx)
          ).rows,
          idempotencia: (
            await sql`select resposta_corpo from idempotencia
              where chave = ${chave}`.execute(trx)
          ).rows,
          pedidos: (
            await sql`select * from confirmacao_consentimento
              where cliente_id = ${id.slice(4)}::uuid`.execute(trx)
          ).rows,
        }),
      );
      expect(tudo).not.toContain(segredo);
      // O evento leva só identificadores: nem o contacto.
      const eventos = await comoDono(
        async (trx) =>
          (
            await sql<{ dados: Json }>`select dados from evento_saida
              where tipo = 'consent.confirmation_requested'
                and agregado_id = ${id.slice(4)}::uuid`.execute(trx)
          ).rows,
      );
      expect(eventos).toHaveLength(1);
      expect(JSON.stringify(eventos)).not.toContain(ana);
      // A API não lê o resumo.
      const { rows } = await sql<{ le: boolean }>`
        select has_column_privilege('eurolify_api', 'confirmacao_consentimento',
          'resumo', 'SELECT') as le`.execute(base.dono);
      expect(rows).toEqual([{ le: false }]);
      // Expirado (a hora puxada para trás, só neste teste).
      await comoDono(async (trx) => {
        await sql`alter table confirmacao_consentimento disable trigger confirmacao_antes_de_gravar`.execute(
          trx,
        );
        await sql`update confirmacao_consentimento set expira_em = now() - interval '1 second'
          where id = ${String(pedido["confirmacao"]).slice(4)}::uuid`.execute(
          trx,
        );
        await sql`alter table confirmacao_consentimento enable always trigger confirmacao_antes_de_gravar`.execute(
          trx,
        );
      });
      await recusa(
        confirmar(pedido["confirmacao"], segredo),
        410,
        "customers.confirmation_expired",
      );
      expect((await comMarketing(id))["email"]).toEqual([]);
      // Ninguém além das funções muda um pedido.
      const mudar = await comoDono((trx) =>
        sql`update confirmacao_consentimento set tentativas = 0
          where id = ${String(pedido["confirmacao"]).slice(4)}::uuid`
          .execute(trx)
          .then(
            () => "passou",
            (e: unknown) => (e as Error).message,
          ),
      );
      expect(mudar).toMatch(/^customers\.confirmation_invalid:/);
    });

    it("C7: numa fusão, cada contacto leva o seu estado e a prova fica na ficha de origem; a pseudonimização apaga os pedidos e o consentimento cai", async () => {
      const u = unico();
      const antigo = `ana.${u}@exemplo.pt`;
      const novo = `ana.nova.${u}@exemplo.pt`;
      const velha = await ficha({ nome: "Ana", emails: [antigo] });
      const nova = await ficha({ nome: "Ana", emails: [novo] });
      await declarar(velha, "email", "retirou", antigo);
      const sim = await declarar(nova, "email", "aceitou", novo);
      await ok(
        pedir("POST", `/customers/${nova}/merge`, {
          absorver: velha,
          ensaio: false,
        }),
      );
      // A fundida recebe no novo, não no antigo, que tinha recusado.
      expect((await comMarketing(nova))["email"]).toEqual([novo]);
      // A prova do «não» está na ficha de origem e lê-se pela fundida.
      const lista = (await ok(pedir("GET", `/customers/${nova}/consents`)))[
        "dados"
      ] as Json[];
      expect(lista.find((d) => d["contacto"] === antigo)?.["cliente"]).toBe(
        velha,
      );
      expect(lista.find((d) => d["id"] === sim["id"])?.["cliente"]).toBe(nova);
      // Um «sim» pelo id antigo, para o contacto antigo: pede confirmação.
      const pedido = await declarar(velha, "email", "aceitou", antigo, 202);
      // Pseudonimizada, os pedidos saem e o consentimento cai.
      await ok(
        pedir("POST", `/customers/${nova}/pseudonymize`, {
          verificacao: "resposta do e-mail a 10/10/2026",
          confirmacao: `pseudonimizar ${nova}`,
        }),
      );
      const resto = await comoDono(
        async (trx) =>
          (
            await sql<{ n: number }>`select count(*)::int as n
              from confirmacao_consentimento
              where id = ${String(pedido["confirmacao"]).slice(4)}::uuid`.execute(
              trx,
            )
          ).rows[0]?.n,
      );
      expect(resto).toBe(0);
      await recusa(
        confirmar(pedido["confirmacao"], pedido["segredo"]),
        404,
        "customers.not_found",
      );
    });

    it("as declarações antigas (sem contacto) valem para os contactos da ficha onde foram dadas", async () => {
      const u = unico();
      const e1 = `a.${u}@exemplo.pt`;
      const e2 = `b.${u}@exemplo.pt`;
      const id = await ficha({ nome: "Ana", emails: [e1, e2] });
      await comoDono(async (trx) => {
        await sql`alter table consentimento disable trigger consentimento_antes_de_gravar`.execute(
          trx,
        );
        await sql`insert into consentimento (comerciante_id, cliente_id, canal,
            declaracao, texto, versao_texto, onde, declarado_em, quem)
          values (${a}::uuid, ${id.slice(4)}::uuid, 'email', 'aceitou', 't', 'v1',
            'x', now() - interval '1 day', 'teste:sql')`.execute(trx);
        await sql`alter table consentimento enable always trigger consentimento_antes_de_gravar`.execute(
          trx,
        );
      });
      expect((await comMarketing(id))["email"]).toEqual([e1, e2].sort());
      // Uma retirada nova de um deles só tira esse.
      await declarar(id, "email", "retirou", e1);
      expect((await comMarketing(id))["email"]).toEqual([e2]);
      // E o «sim» de volta nele pede confirmação.
      await declarar(id, "email", "aceitou", e1, 202);
    });
  },
);
