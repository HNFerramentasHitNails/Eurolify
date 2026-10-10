import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import {
  criarEntidadeLegal,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Os anexos da isenção manual (docs/23 §13.5; migração 0054; Diogo,
// 10/10/2026: na base de dados). São a prova: PDF, JPEG ou PNG pelo
// conteúdo, até 10 MB e 5 por isenção, só numa em vigor, só por uma pessoa
// ou a chave dela, não se alteram nem se apagam, e saem com a
// pseudonimização dos perfis que ninguém usou.

type Json = Record<string, unknown>;

const PDF = Buffer.concat([
  Buffer.from("%PDF-1.7\n"),
  Buffer.from("declaração aduaneira de teste\n%%EOF\n"),
]);
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
  "hex",
);

describe.skipIf(URL_BASE === undefined)("anexos da isenção", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let dono: string;
  let soLer: string;
  let deB: string;

  const pedirJson = (
    metodo: "POST" | "GET" | "PUT" | "DELETE",
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
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });
  const anexar = (
    isencao: string,
    bytes: Buffer,
    tipo = "application/pdf",
    segredo = dono,
    nome = "declaracao.pdf",
  ) =>
    app.inject({
      method: "POST",
      url: `/exemptions/${isencao}/attachments?nome=${encodeURIComponent(nome)}`,
      headers: {
        authorization: `Bearer ${segredo}`,
        "idempotency-key": randomUUID(),
        "content-type": tipo,
      },
      payload: bytes,
    });
  const ok = async (
    r: ReturnType<typeof anexar>,
    estado = 200,
  ): Promise<Json> => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(estado);
    return x.json<Json>();
  };
  const recusa = async (
    r: ReturnType<typeof anexar>,
    estado: number,
    codigo?: string,
  ) => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(estado);
    if (codigo !== undefined) expect(x.json<Json>()["codigo"]).toBe(codigo);
  };

  /** Uma ficha com um perfil e uma isenção em vigor; devolve os ids. */
  async function isencaoNova() {
    const ficha = String(
      (
        await ok(
          pedirJson("POST", "/customers", {
            nome: "Ana",
            emails: [`ana.${randomUUID()}@exemplo.pt`],
          }),
          201,
        )
      )["id"],
    );
    const perfil = String(
      (
        await ok(
          pedirJson("POST", `/customers/${ficha}/billing-profiles`, {
            tipo: "empresa",
            nome_documento: "Ana SARL",
            nif: "FR40303265045",
          }),
          201,
        )
      )["id"],
    );
    const isencao = String(
      (
        await ok(
          pedirJson("PUT", `/billing-profiles/${perfil}/exemption`, {
            codigo_motivo: "M05",
            motivo: "transportadora própria, declaração aduaneira entregue",
          }),
          201,
        )
      )["id"],
    );
    return { ficha, perfil, isencao };
  }

  async function comoDono<T>(
    fn: (trx: Kysely<unknown>) => Promise<T>,
    quem = "teste:sql",
  ) {
    return base.dono.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${a}, true)`.execute(
        trx,
      );
      await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
      return fn(trx);
    });
  }
  const erroDe = (p: Promise<unknown>) =>
    p.then(
      () => "passou",
      (e: unknown) => (e as Error).message,
    );

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
    await criarEntidadeLegal(base.api, a, {
      denominacao: "A, Lda.",
      forma_juridica: "sociedade por quotas",
      pais: "PT",
      numero_fiscal: "509999990",
      morada_linha: "Rua 1",
      morada_codigo_postal: "1000-001",
      morada_localidade: "Lisboa",
    });
    const chave = (c: string, ambitos: string[]) =>
      criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Teste",
        ambitos: ambitos as never,
      });
    const todos = [
      "customers:read",
      "customers:write",
      "customers:billing",
      "customers:exemptions",
      "customers:privacy",
    ];
    dono = (await chave(a, todos)).segredo;
    soLer = (await chave(a, ["customers:read"])).segredo;
    deB = (await chave(b, todos)).segredo;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("anexa um PDF e um PNG; lista sem os bytes; devolve os bytes iguais, com o tipo", async () => {
    const { isencao } = await isencaoNova();
    const pdf = await ok(anexar(isencao, PDF), 201);
    expect(pdf).toMatchObject({
      isencao,
      nome: "declaracao.pdf",
      tipo: "application/pdf",
      tamanho: PDF.length,
    });
    expect(String(pdf["id"])).toMatch(/^exa_/);
    expect(String(pdf["posto_por"])).toMatch(/^chave:key_/);
    await ok(anexar(isencao, PNG, "image/png", dono, "foto.png"), 201);
    const lista = await ok(
      pedirJson("GET", `/exemptions/${isencao}/attachments`),
    );
    expect((lista["dados"] as Json[]).map((x) => x["tipo"])).toEqual([
      "application/pdf",
      "image/png",
    ]);
    expect(JSON.stringify(lista)).not.toContain("declaração aduaneira");
    const bytes = await app.inject({
      method: "GET",
      url: `/exemptions/${isencao}/attachments/${String(pdf["id"])}`,
      headers: { authorization: `Bearer ${dono}` },
    });
    expect(bytes.statusCode).toBe(200);
    expect(bytes.headers["content-type"]).toBe("application/pdf");
    expect(bytes.headers["cache-control"]).toBe("private, no-store");
    expect(Buffer.compare(bytes.rawPayload, PDF)).toBe(0);
  });

  it("recusa o que não é do tipo dito, outro tipo, mais de 10 MB e o sexto anexo", async () => {
    const { isencao } = await isencaoNova();
    // Um texto com o tipo PDF: a base vê os primeiros bytes.
    await recusa(
      anexar(isencao, Buffer.from("isto não é um PDF")),
      400,
      "customers.invalid_field",
    );
    await recusa(anexar(isencao, Buffer.from("texto"), "text/plain"), 415);
    const grande = Buffer.concat([
      Buffer.from("%PDF-"),
      Buffer.alloc(10 * 1024 * 1024),
    ]);
    await recusa(anexar(isencao, grande), 413);
    for (let i = 0; i < 5; i++) await ok(anexar(isencao, PDF), 201);
    await recusa(
      anexar(isencao, PDF),
      409,
      "customers.exemption_attachments_full",
    );
  });

  it("só numa isenção em vigor; só com customers:exemptions; outro comerciante não vê", async () => {
    const { perfil, isencao } = await isencaoNova();
    const anexo = await ok(anexar(isencao, PDF), 201);
    // Quem só lê vê a lista, mas não os bytes nem anexa.
    await ok(
      pedirJson("GET", `/exemptions/${isencao}/attachments`, undefined, soLer),
    );
    await recusa(anexar(isencao, PDF, "application/pdf", soLer), 403);
    const bytes = await app.inject({
      method: "GET",
      url: `/exemptions/${isencao}/attachments/${String(anexo["id"])}`,
      headers: { authorization: `Bearer ${soLer}` },
    });
    expect(bytes.statusCode).toBe(403);
    // Outro comerciante.
    await recusa(
      anexar(isencao, PDF, "application/pdf", deB),
      404,
      "customers.not_found",
    );
    await recusa(
      pedirJson("GET", `/exemptions/${isencao}/attachments`, undefined, deB),
      404,
      "customers.not_found",
    );
    // Retirada, já não leva anexos; os que tinha ficam.
    await ok(
      pedirJson("DELETE", `/billing-profiles/${perfil}/exemption`, {
        motivo_retirada: "o cliente deixou de ter transportadora",
      }),
    );
    await recusa(anexar(isencao, PDF), 409, "customers.exemption_immutable");
    const lista = await ok(
      pedirJson("GET", `/exemptions/${isencao}/attachments`),
    );
    expect(lista["dados"] as Json[]).toHaveLength(1);
  });

  it("é a prova: não se altera nem se apaga, nem pelo superutilizador; um processo de sistema não anexa", async () => {
    const { isencao } = await isencaoNova();
    const anexo = await ok(anexar(isencao, PDF), 201);
    const id = String(anexo["id"]).slice(4);
    for (const comando of [
      sql`update anexo_isencao set nome = 'outro.pdf' where id = ${id}::uuid`,
      sql`delete from anexo_isencao where id = ${id}::uuid`,
      sql`truncate anexo_isencao`,
    ]) {
      expect(await comoDono((trx) => erroDe(comando.execute(trx)))).toMatch(
        /audit\.append_only/,
      );
    }
    expect(
      await comoDono(
        (trx) =>
          erroDe(
            sql`insert into anexo_isencao (comerciante_id, isencao_id, tipo, bytes)
              values (${a}::uuid, ${isencao.slice(4)}::uuid, 'application/pdf',
                ${PDF})`.execute(trx),
          ),
        "sistema:tarefa",
      ),
    ).toMatch(/^customers\.exemption_by_person:/);
  });

  it("a pseudonimização apaga os anexos dos perfis que ninguém usou e guarda os dos usados", async () => {
    const livre = await isencaoNova();
    const usado = await isencaoNova();
    await ok(anexar(livre.isencao, PDF), 201);
    await ok(anexar(usado.isencao, PDF), 201);
    await comoDono((trx) =>
      sql`update perfil_faturacao set usado_em_documento = true
          where id = ${usado.perfil.slice(4)}::uuid`.execute(trx),
    );
    for (const f of [livre.ficha, usado.ficha]) {
      await ok(
        pedirJson("POST", `/customers/${f}/pseudonymize`, {
          verificacao: "resposta do e-mail a 10/10/2026",
          confirmacao: `pseudonimizar ${f}`,
        }),
      );
    }
    const contar = (isencao: string) =>
      comoDono(
        async (trx) =>
          (
            await sql<{
              n: number;
            }>`select count(*)::int as n from anexo_isencao
              where isencao_id = ${isencao.slice(4)}::uuid`.execute(trx)
          ).rows[0]?.n,
      );
    expect(await contar(livre.isencao)).toBe(0);
    expect(await contar(usado.isencao)).toBe(1);
  });
});
