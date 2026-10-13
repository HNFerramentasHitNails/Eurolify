import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  criarEntidadeLegal,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { AdaptadorMoloni } from "../src/faturacao/moloni.js";
import { criarLigacao, noDocumentos } from "../src/faturacao/repositorio.js";
import { chavePagamentos } from "../src/pagamentos/cifra.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";
import { moloniFalso } from "./moloni-falso.js";

// O ecrã «Faturação» pela API do Hub (docs/22 §30; docs/06, EG): as rotas
// /hub fazem o mesmo que as da chave, pelo papel (o dono liga, classifica e
// fecha; o gestor e o apoio só lêem; o armazém nada), com autenticação
// recente para ligar e para fechar, e a pessoa no `eurolify.quem`.

type Json = Record<string, unknown>;

describe.skipIf(URL_BASE === undefined)("Hub: o ecrã Faturação", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  let a = "";
  let b = "";
  let entidade = "";
  let ligacao = "";
  const p: Record<string, { pessoa: string; sessao: string }> = {};
  const moloni = moloniFalso();
  const faturacao = {
    chave: chavePagamentos(randomBytes(32).toString("base64")),
    adaptadores: {
      moloni: new AdaptadorMoloni({
        clientId: "dev-eurolify",
        clientSecret: "segredo-do-developer",
        empresasPermitidas: [String(moloni.empresa)],
        redirectUri:
          "https://api.exemplo.test/invoicing-connections/moloni/callback",
        fetch: moloni.fetch,
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
    ligacao = await noDocumentos(base.api, a, (trx) =>
      criarLigacao(
        trx,
        a,
        {
          entidade_legal: entidade,
          adaptador: "moloni",
          serie: "500",
          taxas: [],
          isencoes: [],
        },
        "teste",
      ),
    );
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

  const como = (
    papel: string,
    metodo: "GET" | "POST",
    url: string,
    corpo?: unknown,
  ) =>
    h.pedir(metodo, url, {
      sessao: p[papel]?.sessao ?? "",
      comerciante: papel === "donoB" ? b : a,
      ...(corpo === undefined ? {} : { corpo }),
    });
  const ok = async (r: Promise<{ statusCode: number; body: string }>) => {
    const x = await r;
    expect(x.statusCode, x.body).toBe(200);
    return JSON.parse(x.body) as Json;
  };
  const codigo = async (
    r: Promise<{ statusCode: number; body: string }>,
  ): Promise<[number, unknown]> => {
    const x = await r;
    return [x.statusCode, (JSON.parse(x.body) as Json)["codigo"]];
  };
  /** A autenticação da sessão passa a ter uma hora. */
  const envelhecer = (papel: string) =>
    sql`update sessao set autenticada_em = now() - interval '1 hour'
      where pessoa_id = ${p[papel]?.pessoa ?? ""}::uuid`.execute(base.dono);

  it("a faturação: as entidades e as ligações sem credenciais; o armazém não lê; outro comerciante não vê", async () => {
    for (const papel of ["dono", "gestor", "apoio"]) {
      const r = await ok(como(papel, "GET", "/hub/invoicing"));
      expect(r["entidades"]).toEqual([
        {
          id: `lgl_${entidade}`,
          nome: "Loja Exemplo, Lda",
          pais: "PT",
          emissor: expect.any(String) as unknown,
          retidas_sem_ligacao: 0,
        },
      ]);
      expect(r["ligacoes"]).toEqual([
        expect.objectContaining({
          id: `isx_${ligacao}`,
          adaptador: "moloni",
          estado: "por_testar",
        }),
      ]);
      expect(JSON.stringify(r)).not.toContain("refresh_token");
    }
    expect(await codigo(como("armazem", "GET", "/hub/invoicing"))).toEqual([
      403,
      "member.role_escalation",
    ]);
    const outro = await ok(como("donoB", "GET", "/hub/invoicing"));
    expect(outro).toEqual({ entidades: [], ligacoes: [] });
  });

  it("ligar o Moloni pelo Hub: só o dono, com autenticação recente; concluir e testar; o outro comerciante não chega", async () => {
    const url = `/hub/invoicing-connections/isx_${ligacao}/authorize`;
    const corpo = { empresa: String(moloni.empresa) };
    expect(await codigo(como("gestor", "POST", url, corpo))).toEqual([
      403,
      "member.role_escalation",
    ]);
    expect(await codigo(como("donoB", "POST", url, corpo))).toEqual([
      404,
      "invoices.not_found",
    ]);
    // Concluir e testar também só o dono, e só no comerciante dele.
    for (const papel of ["gestor", "donoB"]) {
      const esperado =
        papel === "gestor"
          ? [403, "member.role_escalation"]
          : [404, "invoices.not_found"];
      expect(
        await codigo(
          como(papel, "POST", `${url}/complete`, {
            codigo: "x",
            estado: "y".repeat(43),
          }),
        ),
      ).toEqual(esperado);
      expect(
        await codigo(
          como(papel, "POST", `/hub/invoicing-connections/isx_${ligacao}/test`),
        ),
      ).toEqual(esperado);
    }
    const pedido = await ok(como("dono", "POST", url, corpo));
    const concluir = await como(
      "dono",
      "POST",
      `/hub/invoicing-connections/isx_${ligacao}/authorize/complete`,
      { codigo: moloni.codigoAutorizacao(), estado: pedido["estado"] },
    );
    expect(concluir.statusCode, concluir.body).toBe(204);
    expect(
      await ok(
        como("dono", "POST", `/hub/invoicing-connections/isx_${ligacao}/test`),
      ),
    ).toEqual({ estado: "pronta", erro: null });
    // A pessoa fica no registo das credenciais.
    const r = await ok(como("dono", "GET", "/hub/invoicing"));
    expect((r["ligacoes"] as Json[])[0]).toMatchObject({
      estado: "pronta",
      credenciais_por: `pessoa:per_${p["dono"]?.pessoa ?? ""}`,
    });
    // Sem autenticação recente, não se pede outra autorização.
    await envelhecer("dono");
    expect(await codigo(como("dono", "POST", url, corpo))).toEqual([
      403,
      "auth.reauthentication_required",
    ]);
    await sql`update sessao set autenticada_em = now()
      where pessoa_id = ${p["dono"]?.pessoa ?? ""}::uuid`.execute(base.dono);
  });

  it("o relatório OSS pelo Hub: lêem o dono, o gestor e o apoio, com a régua do país por balde; só o dono fecha, com autenticação recente, e fica a pessoa", async () => {
    const q = `entidade=lgl_${entidade}&periodo=2026-T2`;
    for (const papel of ["dono", "gestor", "apoio"]) {
      const r = await ok(como(papel, "GET", `/hub/tax-reports/oss?${q}`));
      expect(r["periodo"]).toBe("2026-T2");
      const baldes = (r["classificavel"] as Json)["baldes"] as Json[];
      expect(baldes.find((x) => x["balde"] === "nacional")).toEqual({
        balde: "nacional",
        paises: ["PT"],
        fora_da_ue: false,
      });
      const oss = baldes.find((x) => x["balde"] === "oss");
      expect(oss?.["paises"]).toHaveLength(26);
      expect(oss?.["paises"]).not.toContain("PT");
    }
    expect(
      await codigo(como("armazem", "GET", `/hub/tax-reports/oss?${q}`)),
    ).toEqual([403, "member.role_escalation"]);
    expect(
      await codigo(como("donoB", "GET", `/hub/tax-reports/oss?${q}`)),
    ).toEqual([404, "tax_reports.not_found"]);
    const csv = await como("apoio", "GET", `/hub/tax-reports/oss/records?${q}`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/^text\/csv/);
    expect(csv.headers["cache-control"]).toBe("private, no-store");
    expect(csv.body.replace(/^\uFEFF/, "")).toMatch(
      /^periodo,periodo_original,tipo,numero/,
    );
    expect(
      await codigo(como("armazem", "GET", `/hub/tax-reports/oss/records?${q}`)),
    ).toEqual([403, "member.role_escalation"]);
    expect(
      await codigo(como("donoB", "GET", `/hub/tax-reports/oss/records?${q}`)),
    ).toEqual([404, "tax_reports.not_found"]);
    const corpo = { entidade: `lgl_${entidade}`, periodo: "2026-T2" };
    expect(
      await codigo(como("gestor", "POST", "/hub/tax-reports/oss/close", corpo)),
    ).toEqual([403, "member.role_escalation"]);
    expect(
      await codigo(
        como("gestor", "POST", "/hub/tax-reports/oss/classifications", {
          documento: `inv_${ligacao}`,
          linhas: [{ balde: "nacional", pais: "PT" }],
          motivo: "x",
        }),
      ),
    ).toEqual([403, "member.role_escalation"]);
    await envelhecer("dono");
    expect(
      await codigo(como("dono", "POST", "/hub/tax-reports/oss/close", corpo)),
    ).toEqual([403, "auth.reauthentication_required"]);
    await sql`update sessao set autenticada_em = now()
      where pessoa_id = ${p["dono"]?.pessoa ?? ""}::uuid`.execute(base.dono);
    const fechado = await ok(
      como("dono", "POST", "/hub/tax-reports/oss/close", corpo),
    );
    expect(fechado["fechado"]).toMatchObject({
      por: `pessoa:per_${p["dono"]?.pessoa ?? ""}`,
    });
    // O documento a classificar: o armazém não lê; um que não existe, 404.
    expect(
      await codigo(
        como("armazem", "GET", `/hub/tax-reports/oss/documents/inv_${ligacao}`),
      ),
    ).toEqual([403, "member.role_escalation"]);
    expect(
      await codigo(
        como("apoio", "GET", `/hub/tax-reports/oss/documents/inv_${ligacao}`),
      ),
    ).toEqual([404, "tax_reports.not_found"]);
    // Classificar um documento que não existe: 404 do relatório.
    expect(
      await codigo(
        como("dono", "POST", "/hub/tax-reports/oss/classifications", {
          documento: `inv_${ligacao}`,
          linhas: [{ balde: "nacional", pais: "PT" }],
          motivo: "não existe",
        }),
      ),
    ).toEqual([404, "tax_reports.not_found"]);
  });
});
