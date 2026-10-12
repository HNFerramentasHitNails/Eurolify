import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
import { lerCatalogo } from "../src/catalogo/exportacao.js";
import {
  alterarArtigo,
  arquivarVariante,
  criarArtigo,
  criarOpcao,
  definirValoresDaVariante,
  mudarEstadoArtigo,
  obterArtigo,
} from "../src/catalogo/repositorio.js";
import { lerCsv, semGuarda } from "../src/importacao/csv.js";
import {
  comComerciante,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// A importação do catálogo, com ensaio (docs/14 §3.11, «Importação do
// catálogo»; docs/06, CT), contra o PostgreSQL 18 verdadeiro.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };

interface Relatorio {
  criar: { artigos: number; variantes: number };
  alterar: { artigos: number; variantes: number };
  iguais: { artigos: number; variantes: number };
  recusadas: {
    onde: string;
    codigo: string;
    sku?: string;
    campo?: string;
  }[];
  alteracoes: {
    recurso: string;
    campo: string;
    antes: unknown;
    depois: unknown;
  }[];
  recusadas_a_mais: number;
  avisos: string[];
  ignorado: Record<string, number>;
}
interface Importacao {
  id: string;
  estado: string;
  relatorio: Relatorio;
  resultado: { artigos: string[]; variantes: number } | null;
  expirada: boolean;
}

describe("o leitor de CSV", () => {
  it("lê aspas, aspas dobradas, quebras dentro de aspas, CRLF, LF e a marca de ordem dos bytes", () => {
    expect(lerCsv('﻿a,b\r\n"x, y","diz ""olá"""\n"linha\nnova",\r\n')).toEqual([
      { numero: 1, celulas: ["a", "b"] },
      { numero: 2, celulas: ["x, y", 'diz "olá"'] },
      { numero: 3, celulas: ["linha\nnova", ""] },
    ]);
  });
  it("recusa aspas por fechar ou no meio de uma célula", () => {
    expect(() => lerCsv('a\n"sem fim')).toThrow("aspas por fechar");
    expect(() => lerCsv('a\nab"c')).toThrow("aspas no meio");
    expect(() => lerCsv('a\n"ab"c')).toThrow("depois das aspas");
  });
  it("tira só o apóstrofo que a exportação pôs à frente de uma fórmula", () => {
    expect(semGuarda("'=SOMA(1;1)")).toBe("=SOMA(1;1)");
    expect(semGuarda("'-2")).toBe("-2");
    expect(semGuarda("'normal")).toBe("'normal");
    expect(semGuarda("D'Ouro")).toBe("D'Ouro");
  });
});

describe.skipIf(URL_BASE === undefined)("API das importações", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let a: string;
  let b: string;
  let importA: string;
  let importB: string;
  let soLeitura: string;

  const ensaio = async (
    corpo: string,
    {
      tipo = "text/csv",
      segredo = importA,
      chave = randomUUID(),
    }: { tipo?: string; segredo?: string; chave?: string } = {},
  ) =>
    app.inject({
      method: "POST",
      url: "/imports",
      headers: {
        authorization: `Bearer ${segredo}`,
        "idempotency-key": chave,
        "content-type": tipo,
      },
      payload: corpo,
    });

  async function ensaiar(corpo: string, opcoes = {}) {
    const r = await ensaio(corpo, opcoes);
    expect(r.statusCode, r.body).toBe(201);
    return r.json<Importacao>();
  }

  const aplicar = (id: string, segredo = importA, chave = randomUUID()) =>
    app.inject({
      method: "POST",
      url: `/imports/${id}/apply`,
      headers: {
        authorization: `Bearer ${segredo}`,
        "idempotency-key": chave,
      },
    });

  const csv = (...linhas: string[]) => linhas.join("\r\n") + "\r\n";
  const CAB =
    "artigo,tipo,nome,descricao,sku,unidade_de_venda,peso_g,gtin,gtin_origem";

  const artigosDe = (c: string) =>
    comComerciante(base.api, c, (trx) =>
      trx
        .selectFrom("artigo")
        .select(["id", "nome", "estado", "descricao", "versao"])
        .orderBy("criado_em")
        .execute(),
    );
  const varianteDe = (c: string, sku: string) =>
    comComerciante(base.api, c, (trx) =>
      trx
        .selectFrom("variante")
        .select(["id", "artigo_id", "sku", "peso_g", "gtin"])
        .where(sql<string>`lower(sku)`, "=", sku.toLowerCase())
        .executeTakeFirst(),
    );

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    app = criarApp({ logger: false }, undefined, base.api);
    a = await registarComerciante(base.api, NOVO);
    b = await registarComerciante(base.api, NOVO);
    const dono: Kysely<BaseDados> = base.dono;
    const chaveDe = async (c: string, nome: string, ambitos: string[]) =>
      (
        await criarChave(dono, c, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome,
          ambitos: ambitos as never,
        })
      ).segredo;
    importA = await chaveDe(a, "Importar", ["catalog:import"]);
    importB = await chaveDe(b, "Importar B", ["catalog:import"]);
    soLeitura = await chaveDe(a, "Leitura", ["catalog:read"]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await base.fechar();
  });

  it("o ensaio não grava nada; aplicar cria os artigos em rascunho; o mesmo ficheiro outra vez fica igual", async () => {
    const ficheiro = csv(
      CAB,
      "GEL-ROSA,fisico,Gel rosa,,IMP-001,unidade,30,,",
      "GEL-ROSA,,,,IMP-002,unidade,,,",
      "LIMA,fisico,'=Lima,Uma lima,IMP-003,unidade,,4006381333931,fornecedor",
    );
    const antes = (await artigosDe(a)).length;
    const imp = await ensaiar(ficheiro);
    expect(imp.estado).toBe("analisada");
    expect(imp.relatorio).toMatchObject({
      criar: { artigos: 2, variantes: 3 },
      alterar: { artigos: 0, variantes: 0 },
      recusadas: [],
    });
    expect(await artigosDe(a)).toHaveLength(antes);
    expect(await varianteDe(a, "IMP-001")).toBeUndefined();

    const r = await aplicar(imp.id);
    expect(r.statusCode, r.body).toBe(200);
    const aplicada = r.json<Importacao>();
    expect(aplicada.estado).toBe("aplicada");
    expect(aplicada.resultado?.variantes).toBe(3);
    const depois = await artigosDe(a);
    expect(depois).toHaveLength(antes + 2);
    expect(depois.slice(-2).map((x) => [x.nome, x.estado])).toEqual([
      ["Gel rosa", "rascunho"],
      ["=Lima", "rascunho"],
    ]);
    const v1 = await varianteDe(a, "imp-001");
    const v2 = await varianteDe(a, "IMP-002");
    expect(v1?.artigo_id).toBe(v2?.artigo_id);
    expect(v1?.peso_g).toBe(30);
    // O que a importação muda fica com o canal «importacao» e a origem
    // (docs/28 §3.1; #322).
    const { rows: rasto } = await sql<{ canal: string; origem: string }>`
      select distinct canal, origem from alteracao_catalogo
      where origem = ${`importacao:imp_${imp.id.replace(/^imp_/, "")}`}`.execute(
      base.dono,
    );
    expect(rasto).toEqual([
      {
        canal: "importacao",
        origem: `importacao:imp_${imp.id.replace(/^imp_/, "")}`,
      },
    ]);

    // Outra vez: nada a criar nem a mudar.
    const outra = await ensaiar(ficheiro);
    expect(outra.relatorio).toMatchObject({
      criar: { artigos: 0, variantes: 0 },
      alterar: { artigos: 0, variantes: 0 },
      iguais: { artigos: 2, variantes: 3 },
      recusadas: [],
    });
    const versoes = (await artigosDe(a)).map((x) => x.versao);
    expect((await aplicar(outra.id)).statusCode).toBe(200);
    expect((await artigosDe(a)).map((x) => x.versao)).toEqual(versoes);
  });

  it("alterar: mostra antes e depois; uma célula vazia não muda o campo", async () => {
    const id = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "Verniz", descricao: "Fica" },
      [{ sku: "ALT-001", unidade_de_venda: "unidade", peso_g: 10 }],
    );
    const imp = await ensaiar(
      csv(CAB, `prd_${id},,Verniz vermelho,,ALT-001,,12,,`),
    );
    expect(imp.relatorio).toMatchObject({
      alterar: { artigos: 1, variantes: 1 },
      recusadas: [],
    });
    const v = await varianteDe(a, "ALT-001");
    expect(imp.relatorio.alteracoes).toEqual(
      expect.arrayContaining([
        {
          recurso: `prd_${id}`,
          campo: "nome",
          antes: "Verniz",
          depois: "Verniz vermelho",
        },
        {
          recurso: `var_${v?.id ?? ""}`,
          campo: "peso_g",
          antes: 10,
          depois: 12,
        },
      ]),
    );
    expect((await aplicar(imp.id)).statusCode).toBe(200);
    const artigo = await obterArtigo(base.api, a, id);
    expect([artigo.nome, artigo.descricao]).toEqual([
      "Verniz vermelho",
      "Fica",
    ]);
    expect((await varianteDe(a, "ALT-001"))?.peso_g).toBe(12);
  });

  it("recusa por linha e deixa passar o resto", async () => {
    const outro = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "Outro" },
      [{ sku: "REC-OUTRO", unidade_de_venda: "unidade" }],
    );
    const arquivo = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "Arq" },
      [
        { sku: "REC-ARQ", unidade_de_venda: "unidade" },
        { sku: "REC-ARQ2", unidade_de_venda: "unidade" },
      ],
    );
    const arq = await varianteDe(a, "REC-ARQ");
    await arquivarVariante(base.api, a, arq?.id ?? "");
    const externo = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "De fora", origem_ref: "ERP-9" },
      [{ sku: "REC-EXT", unidade_de_venda: "unidade" }],
    );
    const imp = await ensaiar(
      csv(
        CAB,
        "BOM,fisico,Bom,,REC-BOM,unidade,,,",
        "MAU-GTIN,fisico,Mau,,REC-GTIN,unidade,,1234567890123,fornecedor",
        "REP,fisico,Rep,,REC-REP,unidade,,,",
        "REP2,fisico,Rep2,,rec-rep,unidade,,,",
        `prd_${arquivo},,,,REC-OUTRO,unidade,,,`,
        `prd_${arquivo},,,,REC-ARQ,,99,,`,
        "SEM-NOME,fisico,,,REC-SEMNOME,unidade,,,",
        "PESO,fisico,Peso,,REC-PESO,unidade,muito,,",
        `prd_${externo},,Mudou,,REC-EXT,,,,`,
        `prd_${outro},servico,,,REC-NOVO,unidade,,,`,
        "DIF,fisico,Um,,REC-DIF1,unidade,,,",
        "DIF,fisico,Dois,,REC-DIF2,unidade,,,",
        "CURTA,fisico",
      ),
    );
    const motivos = Object.fromEntries(
      imp.relatorio.recusadas.map((r) => [r.sku ?? r.onde, r.codigo]),
    );
    expect(motivos).toMatchObject({
      "REC-GTIN": "catalog.gtin_invalid",
      "REC-REP": "import.sku_repeated",
      "rec-rep": "import.sku_repeated",
      "REC-OUTRO": "catalog.sku_taken_by_other_product",
      "REC-ARQ": "catalog.variant_archived_is_final",
      "REC-SEMNOME": "catalog.invalid_field",
      "REC-PESO": "catalog.invalid_field",
      "REC-EXT": "import.external_product",
      "REC-NOVO": "catalog.invalid_field",
      "REC-DIF1": "import.product_fields_differ",
      "REC-DIF2": "import.product_fields_differ",
      "linha 14": "import.bad_row",
    });
    expect(imp.relatorio.criar).toEqual({ artigos: 1, variantes: 1 });
    expect((await aplicar(imp.id)).statusCode).toBe(200);
    expect(await varianteDe(a, "REC-BOM")).toBeDefined();
    expect(await varianteDe(a, "REC-GTIN")).toBeUndefined();
    expect((await obterArtigo(base.api, a, externo)).nome).toBe("De fora");
  });

  it("um ficheiro que não se lê dá 422; sem import, 403; tipo desconhecido, 415", async () => {
    for (const corpo of [
      csv("artigo,sku,cor", "A,B,azul"),
      csv("artigo,nome", "A,B"),
      csv("artigo,sku,sku", "A,B,C"),
      'artigo,sku\n"aberto',
    ]) {
      const r = await ensaio(corpo);
      expect(r.statusCode, corpo).toBe(422);
      expect(r.json<{ codigo: string }>().codigo).toBe("import.invalid_file");
    }
    const json = await ensaio('{"formato":"outro"}', {
      tipo: "application/json",
    });
    expect(json.statusCode).toBe(422);
    expect((await ensaio(csv(CAB), { segredo: soLeitura })).statusCode).toBe(
      403,
    );
    expect((await ensaio("x", { tipo: "text/plain" })).statusCode).toBe(415);
  });

  it("mais de 5000 variantes dá 422 import.too_large", async () => {
    const linhas = Array.from(
      { length: 5001 },
      (_, i) => `G,fisico,G,,BIG-${String(i)},unidade,,,`,
    );
    const r = await ensaio(csv(CAB, ...linhas));
    expect(r.statusCode).toBe(422);
    expect(r.json<{ codigo: string }>().codigo).toBe("import.too_large");
  });

  it("se o catálogo mudou desde o ensaio, aplicar dá 409 e não grava nada", async () => {
    const id = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "Antes" },
      [{ sku: "STALE-1", unidade_de_venda: "unidade" }],
    );
    const imp = await ensaiar(
      csv(
        CAB,
        `prd_${id},,Depois,,STALE-1,,,,`,
        "NOVO-STALE,fisico,Novo,,STALE-NOVO,unidade,,,",
      ),
    );
    const v = (await obterArtigo(base.api, a, id)).versao;
    await alterarArtigo(base.api, a, id, v, { marca: "Outra" });
    const r = await aplicar(imp.id);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ codigo: string }>().codigo).toBe("import.stale");
    expect(await varianteDe(a, "STALE-NOVO")).toBeUndefined();
    expect((await obterArtigo(base.api, a, id)).nome).toBe("Antes");
    // Um SKU a criar que entretanto passou a existir também.
    const imp2 = await ensaiar(csv(CAB, "S2,fisico,S2,,STALE-2,unidade,,,"));
    await criarArtigo(base.api, a, { tipo: "fisico", nome: "Chegou antes" }, [
      { sku: "stale-2", unidade_de_venda: "unidade" },
    ]);
    expect((await aplicar(imp2.id)).statusCode).toBe(409);
  });

  it("aplicar duas vezes devolve o mesmo; depois de 24 h, 410; de outro comerciante, 404", async () => {
    const imp = await ensaiar(csv(CAB, "DUAS,fisico,Duas,,DUAS-1,unidade,,,"));
    const r1 = await aplicar(imp.id);
    const r2 = await aplicar(imp.id);
    expect(r2.statusCode).toBe(200);
    expect(r2.json<Importacao>().resultado).toEqual(
      r1.json<Importacao>().resultado,
    );
    const velha = await ensaiar(
      csv(CAB, "VELHA,fisico,Velha,,VELHA-1,unidade,,,"),
    );
    // O gatilho só deixa mudar o estado: muda-se a data como dono, sem ele.
    await sql`alter table importacao disable trigger importacao_antes_de_gravar`.execute(
      base.dono,
    );
    await sql`update importacao set expira_em = now() - interval '1 second'
      where id = ${velha.id.slice(4)}::uuid`.execute(base.dono);
    await sql`alter table importacao enable trigger importacao_antes_de_gravar`.execute(
      base.dono,
    );
    const lista = await app.inject({
      method: "GET",
      url: `/imports/${velha.id}`,
      headers: { authorization: `Bearer ${importA}` },
    });
    expect(lista.json<Importacao>().expirada).toBe(true);
    const r = await aplicar(velha.id);
    expect(r.statusCode).toBe(410);
    expect(r.json<{ codigo: string }>().codigo).toBe("import.expired");
    expect(await varianteDe(a, "VELHA-1")).toBeUndefined();
    for (const url of [`/imports/${imp.id}`]) {
      const deB = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${importB}` },
      });
      expect(deB.statusCode).toBe(404);
    }
    expect((await aplicar(imp.id, importB)).statusCode).toBe(404);
  });

  it("o catalogo.json da exportação importa-se noutra conta: cria tudo de novo e diz o que ignorou", async () => {
    const lido = await lerCatalogo(base.api, a, new Date());
    const nArtigos = (lido.json.artigos as unknown[]).length;
    const imp = await ensaiar(JSON.stringify(lido.json), {
      tipo: "application/json",
      segredo: importB,
    });
    expect(imp.relatorio.criar.artigos).toBe(nArtigos);
    expect(imp.relatorio.recusadas).toEqual([]);
    expect((await aplicar(imp.id, importB)).statusCode).toBe(200);
    expect((await artigosDe(b)).length).toBe(nArtigos);
    // Os ids de A não passam para B: são artigos novos.
    const idsA = new Set((await artigosDe(a)).map((x) => x.id));
    expect((await artigosDe(b)).some((x) => idsA.has(x.id))).toBe(false);
  });

  it("num artigo activo com opções, uma variante nova sem valores recusa-se já no ensaio (a regra do fim da transacção)", async () => {
    const id = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "Com cor" },
      [{ sku: "COR-ROSA", unidade_de_venda: "unidade" }],
    );
    const cor = await criarOpcao(base.api, a, id, "Cor", ["Rosa"]);
    const v = await varianteDe(a, "COR-ROSA");
    await definirValoresDaVariante(base.api, a, v?.id ?? "", [
      cor.valores[0]?.id ?? "",
    ]);
    await mudarEstadoArtigo(
      base.api,
      a,
      id,
      (await obterArtigo(base.api, a, id)).versao,
      "activo",
    );
    const imp = await ensaiar(csv(CAB, `prd_${id},,,,COR-AZUL,unidade,,,`));
    expect(imp.relatorio.criar.variantes).toBe(0);
    expect(imp.relatorio.recusadas).toEqual([
      expect.objectContaining({ sku: "COR-AZUL" }),
    ]);
    expect((await aplicar(imp.id)).statusCode).toBe(200);
    expect(await varianteDe(a, "COR-AZUL")).toBeUndefined();
  });

  it("a unidade de venda de um artigo activo não muda: a linha recusa-se com catalog.not_draft e o resto passa; num rascunho muda (#301)", async () => {
    const activo = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "Activo" },
      [{ sku: "UNI-ACT", unidade_de_venda: "unidade", peso_g: 10 }],
    );
    await mudarEstadoArtigo(
      base.api,
      a,
      activo,
      (await obterArtigo(base.api, a, activo)).versao,
      "activo",
    );
    const rascunho = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "Rascunho" },
      [{ sku: "UNI-RAS", unidade_de_venda: "unidade" }],
    );
    const imp = await ensaiar(
      csv(
        CAB,
        `prd_${activo},,,,UNI-ACT,par,12,,`,
        `prd_${rascunho},,,,UNI-RAS,par,,,`,
      ),
    );
    expect(imp.relatorio.recusadas).toEqual([
      expect.objectContaining({ sku: "UNI-ACT", codigo: "catalog.not_draft" }),
    ]);
    expect(imp.relatorio.alterar.variantes).toBe(1);
    expect((await aplicar(imp.id)).statusCode).toBe(200);
    // A linha recusada não muda nada, nem o peso que vinha nela.
    expect((await varianteDe(a, "UNI-ACT"))?.peso_g).toBe(10);
    const ras = await comComerciante(base.api, a, (trx) =>
      trx
        .selectFrom("variante")
        .select("unidade_de_venda")
        .where("sku", "=", "UNI-RAS")
        .executeTakeFirst(),
    );
    expect(ras?.unidade_de_venda).toBe("par");
  });

  it("o conteúdo de um artigo activo também não muda pela importação; a importação sobe a versão da variante (revisão do #306, P3-3d, e)", async () => {
    const CAB_CONTEUDO =
      "artigo,tipo,nome,descricao,sku,unidade_de_venda,peso_g,conteudo_quantidade,conteudo_unidade";
    const id = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "Activo conteúdo" },
      [
        { sku: "CONT-ACT", unidade_de_venda: "unidade", peso_g: 10 },
        { sku: "VERS-ACT", unidade_de_venda: "unidade", peso_g: 10 },
      ],
    );
    await mudarEstadoArtigo(
      base.api,
      a,
      id,
      (await obterArtigo(base.api, a, id)).versao,
      "activo",
    );
    const versaoDe = async (sku: string) =>
      (
        await comComerciante(base.api, a, (trx) =>
          trx
            .selectFrom("variante")
            .select("versao")
            .where("sku", "=", sku)
            .executeTakeFirst(),
        )
      )?.versao;
    expect(await versaoDe("VERS-ACT")).toBe(1);
    const imp = await ensaiar(
      csv(
        CAB_CONTEUDO,
        `prd_${id},,,,CONT-ACT,,,15,ml`,
        `prd_${id},,,,VERS-ACT,,12,,`,
      ),
    );
    expect(imp.relatorio.recusadas).toEqual([
      expect.objectContaining({ sku: "CONT-ACT", codigo: "catalog.not_draft" }),
    ]);
    expect((await aplicar(imp.id)).statusCode).toBe(200);
    expect(await versaoDe("CONT-ACT")).toBe(1);
    expect(await versaoDe("VERS-ACT")).toBe(2);
  });

  it("dois grupos do ficheiro que dão o mesmo artigo: o segundo recusa-se e o primeiro aplica-se (revisão do #197, P1-2)", async () => {
    const id = await criarArtigo(base.api, a, { tipo: "fisico", nome: "Par" }, [
      { sku: "PAR-1", unidade_de_venda: "unidade" },
      { sku: "PAR-2", unidade_de_venda: "unidade" },
    ]);
    const imp = await ensaiar(
      csv(
        CAB,
        "A,,Par novo,,PAR-1,,,,",
        "B,,Outro nome,,PAR-2,,,,",
        `prd_${randomUUID()},fisico,Fantasma,,PAR-FANT,unidade,,,`,
      ),
    );
    expect(imp.relatorio.recusadas).toEqual([
      expect.objectContaining({
        sku: "PAR-2",
        codigo: "import.product_repeated",
      }),
    ]);
    expect(imp.relatorio.alterar.artigos).toBe(1);
    expect(imp.relatorio.avisos).toHaveLength(1);
    expect((await aplicar(imp.id)).statusCode).toBe(200);
    expect((await obterArtigo(base.api, a, id)).nome).toBe("Par novo");
  });

  it("o relatório mostra no máximo 1000 recusas e conta as outras; as linhas contam todas para o limite (P1-1)", async () => {
    const mas = Array.from({ length: 1500 }, () => ",fisico,X,,,unidade,,,");
    const imp = await ensaiar(csv(CAB, ...mas));
    expect(imp.relatorio.recusadas).toHaveLength(1000);
    expect(
      (imp.relatorio as unknown as { recusadas_a_mais: number })
        .recusadas_a_mais,
    ).toBe(500);
    const demais = Array.from({ length: 5001 }, () => "x");
    const r = await ensaio(csv(CAB, ...demais));
    expect(r.json<{ codigo: string }>().codigo).toBe("import.too_large");
  });

  it("valores fora dos limites da API, UTF-8 inválido, JSON nulo e um corpo acima de 10 MB recusam-se (P2-1, P2-2, P3-1)", async () => {
    const imp = await ensaiar(
      csv(
        CAB,
        `LONGO,fisico,${"n".repeat(201)},,LIM-1,unidade,,,`,
        "ESP,fisico,   ,,LIM-2,unidade,,,",
        "UNI,fisico,U,,LIM-3,caixote,,,",
      ),
    );
    expect(
      imp.relatorio.recusadas.map((x) => [x.sku, x.codigo, x.campo]),
    ).toEqual([
      ["LIM-1", "catalog.invalid_field", "nome"],
      ["LIM-2", "catalog.invalid_field", "nome"],
      ["LIM-3", "catalog.invalid_field", "unidade_de_venda"],
    ]);
    const latin1 = await app.inject({
      method: "POST",
      url: "/imports",
      headers: {
        authorization: `Bearer ${importA}`,
        "idempotency-key": randomUUID(),
        "content-type": "text/csv",
      },
      payload: Buffer.concat([
        Buffer.from(CAB + "\r\nV,fisico,Verniz "),
        Buffer.from([0xe1]),
        Buffer.from(",,VER-1,unidade,,,\r\n"),
      ]),
    });
    expect(latin1.statusCode).toBe(422);
    expect(latin1.json<{ codigo: string }>().codigo).toBe(
      "import.invalid_file",
    );
    // Um artigo novo com mais de 100 variantes, como na criação pela API.
    const cem = await ensaiar(
      csv(
        CAB,
        ...Array.from(
          { length: 101 },
          (_, i) => `CEM,fisico,Cem,,CEM-${String(i)},unidade,,,`,
        ),
      ),
    );
    expect(cem.relatorio.criar.artigos).toBe(0);
    expect(cem.relatorio.recusadas[0]?.codigo).toBe("catalog.invalid_field");
    const nulo = await ensaio("null", { tipo: "application/json" });
    expect(nulo.statusCode).toBe(422);
    const grande = await ensaio("a".repeat(10 * 1024 * 1024 + 1));
    expect(grande.statusCode).toBe(413);
  });

  it("uma variante mudada ou arquivada depois do ensaio dá 409 (P3-3)", async () => {
    await criarArtigo(base.api, a, { tipo: "fisico", nome: "Var" }, [
      { sku: "VAR-MUDA", unidade_de_venda: "unidade", peso_g: 5 },
      { sku: "VAR-ARQ", unidade_de_venda: "unidade", peso_g: 5 },
      { sku: "VAR-FICA", unidade_de_venda: "unidade" },
    ]);
    const imp = await ensaiar(csv(CAB, "V,,,,VAR-MUDA,,7,,"));
    await sql`update variante set peso_g = 6 where sku = 'VAR-MUDA'`.execute(
      base.dono,
    );
    const r = await aplicar(imp.id);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ detail: string }>().detail).toContain(
      "VAR-MUDA mudou (peso_g)",
    );
    const imp2 = await ensaiar(csv(CAB, "V,,,,VAR-ARQ,,7,,"));
    const arq = await varianteDe(a, "VAR-ARQ");
    await arquivarVariante(base.api, a, arq?.id ?? "");
    const r2 = await aplicar(imp2.id);
    expect(r2.statusCode).toBe(409);
    expect(r2.json<{ codigo: string; detail: string }>()).toMatchObject({
      codigo: "import.stale",
      detail: expect.stringContaining("foi arquivada") as unknown,
    });
  });

  it("um ensaio à espera de outra escrita mais de 5 s falha inteiro (503), não inventa uma recusa (P2-4)", async () => {
    const id = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "Preso" },
      [{ sku: "PRESO-1", unidade_de_venda: "unidade" }],
    );
    const l = new pg.Client({ connectionString: base.urlApi });
    await l.connect();
    try {
      await l.query("begin");
      await l.query("select set_config('eurolify.comerciante', $1, true)", [a]);
      await l.query("select id from artigo where id = $1 for update", [id]);
      const r = await ensaio(csv(CAB, `prd_${id},,Mudado,,PRESO-1,,,,`));
      expect(r.statusCode).toBe(503);
      expect(r.json<{ codigo: string }>().codigo).toBe("catalog.retry");
    } finally {
      await l.query("rollback");
      await l.end();
    }
  }, 20_000);

  it("2.ª revisão: um nulo ou um par partido recusa a linha; o que a API aceita passa; o prd_ em maiúsculas é o mesmo artigo", async () => {
    const nul = await ensaiar(
      csv(
        CAB,
        "NUL\u0000,fisico,Nulo,,NUL-1,unidade,,,",
        "OK,fisico,Ok,,NUL-OK,unidade,2147483647,,",
      ),
    );
    expect(nul.relatorio.recusadas).toEqual([
      expect.objectContaining({
        codigo: "catalog.invalid_field",
        campo: "artigo",
      }),
    ]);
    expect(nul.relatorio.criar.variantes).toBe(1);
    const json = await ensaio(
      '{"formato":"eurolify.catalogo/1","artigos":[{"id":"x","tipo":"fisico","nome":"Par \\ud800","variantes":[{"sku":"SUR-1","unidade_de_venda":"unidade"}]}]}',
      { tipo: "application/json" },
    );
    expect(json.statusCode, json.body).toBe(201);
    expect(json.json<Importacao>().relatorio.recusadas).toEqual([
      expect.objectContaining({
        codigo: "catalog.invalid_field",
        campo: "nome",
      }),
    ]);
    const id = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "Maiusc" },
      [{ sku: "MAI-1", unidade_de_venda: "unidade" }],
    );
    // Um SKU novo: só o prd_ diz qual é o artigo.
    const mai = await ensaiar(
      csv(CAB, `prd_${id.toUpperCase()},,,,MAI-2,unidade,,,`),
    );
    expect(mai.relatorio.criar).toEqual({ artigos: 0, variantes: 1 });
  });

  it("a mesma chave e o mesmo ficheiro devolvem o mesmo ensaio; com outro ficheiro, recusa", async () => {
    const chave = randomUUID();
    const f = csv(CAB, "IDEM,fisico,Idem,,IDEM-IMP,unidade,,,");
    const r1 = await ensaio(f, { chave });
    const r2 = await ensaio(f, { chave });
    expect(r2.json()).toEqual(r1.json());
    const r3 = await ensaio(
      csv(CAB, "IDEM,fisico,Outro,,IDEM-IMP,unidade,,,"),
      {
        chave,
      },
    );
    expect(r3.statusCode).toBe(422);
    expect(r3.json<{ codigo: string }>().codigo).toBe("idempotency.key_reused");
  });
});
