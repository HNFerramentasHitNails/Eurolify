import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
import { ArmazenamentoEmDisco } from "../src/catalogo/armazenamento.js";
import {
  criarCategoria,
  criarColecao,
  definirArtigosDaColecao,
  definirCategoriasDoArtigo,
} from "../src/catalogo/categorias.js";
import { celula, lerCatalogo } from "../src/catalogo/exportacao.js";
import {
  comComerciante,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  criarArtigo,
  definirComponentes,
} from "../src/catalogo/repositorio.js";
import { definirTraducao } from "../src/catalogo/traducoes.js";
import { EscritorZip, ErroZipGrandeDemais } from "../src/exportacao/zip.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// As exportações (docs/14 §3.11, «Exportação do catálogo»; docs/06, CS),
// contra o PostgreSQL 18 verdadeiro e uma pasta temporária no lugar do disco
// da VPS. O ZIP lê-se aqui com um leitor próprio (o directório central) e,
// se houver python3, também com o zipfile dele.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("resto do png"),
]);
const QUEM = "pessoa:teste";

/** Lê um ZIP pelo directório central; confere o CRC de cada entrada. */
function lerZip(zip: Buffer): Map<string, Buffer> {
  const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fim < 0) throw new Error("sem fim de directório");
  const n = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const entradas = new Map<string, Buffer>();
  for (let i = 0; i < n; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("central");
    const metodo = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const comprimido = zip.readUInt32LE(p + 20);
    const original = zip.readUInt32LE(p + 24);
    const nomeTam = zip.readUInt16LE(p + 28);
    const extra = zip.readUInt16LE(p + 30);
    const comentario = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const nome = zip.toString("utf8", p + 46, p + 46 + nomeTam);
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("local");
    const inicio =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const corpo = zip.subarray(inicio, inicio + comprimido);
    const dados = metodo === 8 ? inflateRawSync(corpo) : Buffer.from(corpo);
    if (dados.length !== original) throw new Error(`tamanho de ${nome}`);
    if (crc32De(dados) !== crc) throw new Error(`crc de ${nome}`);
    entradas.set(nome, dados);
    p += 46 + nomeTam + extra + comentario;
  }
  return entradas;
}

/** CRC-32 à mão (sem o zlib do escritor), para o leitor não confiar nele. */
function crc32De(b: Buffer): number {
  let c = 0xffffffff;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** As linhas de um CSV simples (sem quebras dentro das células). */
const linhasCsv = (b: Buffer) =>
  b
    .toString("utf8")
    .replace(/^\ufeff/, "")
    .trimEnd()
    .split("\r\n");

describe("o escritor de ZIP", () => {
  it("escreve entradas guardadas e comprimidas que outro leitor lê", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "eurolify-zip-"));
    try {
      const caminho = join(pasta, "a.zip");
      const f = await open(caminho, "wx");
      const zip = new EscritorZip(f, new Date("2026-10-08T12:00:00Z"));
      await zip.acrescentar("texto/á.csv", Buffer.from("olá,mundo\r\n"), true);
      await zip.acrescentar("imagens/x", PNG, false);
      await zip.acrescentar("vazio.json", Buffer.alloc(0), true);
      const tamanho = await zip.fechar();
      await f.close();
      const bytes = await readFile(caminho);
      expect(bytes.length).toBe(tamanho);
      const e = lerZip(bytes);
      expect([...e.keys()]).toEqual(["texto/á.csv", "imagens/x", "vazio.json"]);
      expect(e.get("texto/á.csv")?.toString()).toBe("olá,mundo\r\n");
      expect(e.get("imagens/x")).toEqual(PNG);
      expect(e.get("vazio.json")?.length).toBe(0);
      try {
        const lista = execFileSync(
          "python3",
          [
            "-I",
            "-c",
            "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print('|'.join(z.namelist()))",
            caminho,
          ],
          { encoding: "utf8" },
        );
        expect(lista.trim()).toBe("texto/á.csv|imagens/x|vazio.json");
      } catch (erro) {
        if ((erro as { code?: string }).code !== "ENOENT") throw erro;
      }
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  });

  it("recusa nomes que saem da pasta e mais entradas do que o formato aguenta", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "eurolify-zip-"));
    try {
      const f = await open(join(pasta, "b.zip"), "wx");
      const zip = new EscritorZip(f, new Date());
      for (const nome of ["../x", "/x", "a/../../x", "a\\b"]) {
        await expect(
          zip.acrescentar(nome, Buffer.from("x"), false),
        ).rejects.toThrow("nome de entrada inválido");
      }
      for (let i = 0; i < 0xfffe; i++) {
        await zip.acrescentar(`f${String(i)}`, Buffer.alloc(0), false);
      }
      await expect(
        zip.acrescentar("a mais", Buffer.alloc(0), false),
      ).rejects.toBeInstanceOf(ErroZipGrandeDemais);
      await f.close();
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("as células dos CSV", () => {
  it("põem um apóstrofo à frente do que uma folha de cálculo lia como fórmula", () => {
    expect(celula("=SOMA(1;1)")).toBe("'=SOMA(1;1)");
    expect(celula("+351")).toBe("'+351");
    expect(celula("-2")).toBe("'-2");
    expect(celula("@x")).toBe("'@x");
    expect(celula("\tx")).toBe("'\tx");
    expect(celula("Gel rosa")).toBe("Gel rosa");
    expect(celula("Gel, rosa")).toBe('"Gel, rosa"');
    expect(celula(-2)).toBe("-2");
    expect(celula('a "b", c')).toBe('"a ""b"", c"');
    expect(celula("linha\nnova")).toBe('"linha\nnova"');
    expect(celula(null)).toBe("");
    expect(celula(["a", "b"])).toBe('"[""a"",""b""]"');
    expect(celula(false)).toBe("false");
  });
});

describe.skipIf(URL_BASE === undefined)("API das exportações", () => {
  let base: BaseDeTeste;
  let pasta: string;
  let app: ReturnType<typeof criarApp>;
  let lenta: ReturnType<typeof criarApp>;
  const porta: { soltar?: () => void } = {};
  /** Solta a leitura à espera (por uma função: o TypeScript não a estreita). */
  const largar = () => {
    porta.soltar?.();
    delete porta.soltar;
  };
  const aEspera = () => porta.soltar !== undefined;
  const modo: { valor: "lento" | "grande" | "falta" } = { valor: "lento" };
  /** Espera até a exportação da instância lenta estar nas imagens. */
  async function nasImagens() {
    for (let i = 0; i < 200 && !aEspera(); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(aEspera()).toBe(true);
  }
  let a: string;
  let b: string;
  let leituraA: string;
  let escritaA: string;
  let leituraB: string;
  let semCatalogo: string;
  let gel: string;
  let imagem: string;

  const pedir = (
    metodo: "POST" | "GET",
    url: string,
    {
      segredo = leituraA,
      chave = randomUUID(),
      corpo = { dominios: ["catalogo"] },
      instancia = app,
    }: {
      segredo?: string;
      chave?: string | null;
      corpo?: unknown;
      instancia?: ReturnType<typeof criarApp>;
    } = {},
  ) =>
    instancia.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${segredo}`,
        ...(metodo === "POST" && chave !== null
          ? { "idempotency-key": chave }
          : {}),
        ...(metodo === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(metodo === "POST" ? { payload: JSON.stringify(corpo) } : {}),
    });

  async function exportar(segredo = leituraA) {
    const r = await pedir("POST", "/exports", { segredo });
    expect(r.statusCode, r.body).toBe(201);
    return r.json<{ id: string; bytes: number; resumo: string }>();
  }

  async function descarregar(id: string, segredo = leituraA) {
    const r = await pedir("GET", `/exports/${id}/file`, { segredo });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers).toMatchObject({
      "content-type": "application/zip",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-disposition": expect.stringMatching(
        /^attachment; filename="eurolify-exportacao-\d{4}-\d{2}-\d{2}\.zip"$/,
      ) as unknown,
    });
    expect(r.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    return r.rawPayload;
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    pasta = await mkdtemp(join(tmpdir(), "eurolify-exportacao-"));
    const disco = new ArmazenamentoEmDisco(pasta);
    app = criarApp({ logger: false }, undefined, base.api, undefined, disco);
    // Uma instância cuja leitura das imagens espera até se soltar: para ver
    // uma exportação a meio.
    // O mesmo objecto faz também de disco que falha (`modo`).
    class Lento extends ArmazenamentoEmDisco {
      override async ler(c: string, r: string) {
        if (modo.valor === "grande") {
          throw new ErroZipGrandeDemais("mais de 4 GiB");
        }
        if (modo.valor === "falta") {
          throw Object.assign(new Error("ENOENT: não existe"), {
            code: "ENOENT",
          });
        }
        await new Promise<void>((solta) => {
          porta.soltar = solta;
        });
        return super.ler(c, r);
      }
    }
    lenta = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      new Lento(pasta),
    );
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
    leituraA = await chaveDe(a, "Leitura", ["catalog:read"]);
    escritaA = await chaveDe(a, "Escrita", ["catalog:read", "catalog:write"]);
    leituraB = await chaveDe(b, "Leitura de B", ["catalog:read"]);
    semCatalogo = await chaveDe(a, "Comerciante", ["merchant:read"]);

    // O catálogo de A: um gel com duas variantes, um kit, uma fórmula no
    // nome, uma tradução, uma categoria, uma colecção e uma imagem.
    gel = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "Gel rosa", categoria_fiscal: "normal" },
      [
        { sku: "GEL-001", unidade_de_venda: "unidade", peso_g: 30 },
        { sku: "GEL-002", unidade_de_venda: "unidade" },
      ],
    );
    const kit = await criarArtigo(
      base.api,
      a,
      { tipo: "fisico", nome: "=SOMA(1;1)" },
      [{ sku: "KIT-001", unidade_de_venda: "unidade" }],
    );
    const ids = await comComerciante(base.api, a, (trx) =>
      trx.selectFrom("variante").select(["id", "sku"]).orderBy("sku").execute(),
    );
    const id = (sku: string) => ids.find((v) => v.sku === sku)?.id ?? "";
    await definirComponentes(base.api, a, id("KIT-001"), [
      { varianteId: id("GEL-001"), quantidade: 2 },
    ]);
    await definirTraducao(base.api, a, QUEM, {
      tipo: "artigo",
      recursoId: gel,
      campo: "nome",
      lingua: "es",
      texto: "Gel rosa",
      origem: "pessoa",
      originalVisto: "Gel rosa",
    });
    const unhas = await criarCategoria(base.api, a, {
      nome: "Unhas",
      endereco_amigavel: "unhas",
    });
    await definirCategoriasDoArtigo(base.api, a, gel, 1, [unhas]);
    const novidades = await criarColecao(base.api, a, {
      nome: "Novidades",
      endereco_amigavel: "novidades",
    });
    await definirArtigosDaColecao(base.api, a, novidades, 1, [gel, kit]);
    const envio = await app.inject({
      method: "POST",
      url: "/media/uploads",
      headers: {
        authorization: `Bearer ${escritaA}`,
        "idempotency-key": randomUUID(),
        "content-type": "image/png",
      },
      payload: PNG,
    });
    expect(envio.statusCode, envio.body).toBe(201);
    imagem = createHash("sha256").update(PNG).digest("hex");
    const ligar = await app.inject({
      method: "POST",
      url: `/products/prd_${gel}/media`,
      headers: {
        authorization: `Bearer ${escritaA}`,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        ficheiro: `fil_${imagem}`,
        texto_alternativo: "Frasco de gel rosa, 30 ml",
      }),
    });
    expect(ligar.statusCode, ligar.body).toBe(201);
    // B tem um artigo só dele.
    await criarArtigo(base.api, b, { tipo: "fisico", nome: "Só de B" }, [
      { sku: "B-001", unidade_de_venda: "unidade" },
    ]);
  }, 60_000);

  // Cada teste começa sem exportações por expirar (o limite é por
  // comerciante; os testes não se tocam).
  beforeEach(async () => {
    await sql`update exportacao set expira_em = now() - interval '1 second'
      where expira_em > now()`.execute(base.dono);
    modo.valor = "lento";
  });

  afterAll(async () => {
    await app.close();
    await lenta.close();
    await base.fechar();
    await rm(pasta, { recursive: true, force: true });
  });

  it("exporta o catálogo num ZIP: o JSON completo, os CSV e as imagens", async () => {
    const e = await exportar();
    expect(e.id).toMatch(/^exp_/);
    expect(e).toMatchObject({
      estado: "pronta",
      dominios: ["catalogo"],
      formato: "eurolify.catalogo/1",
      expirada: false,
    });
    const zip = await descarregar(e.id);
    expect(zip.length).toBe(e.bytes);
    expect(createHash("sha256").update(zip).digest("hex")).toBe(e.resumo);
    const f = lerZip(zip);
    expect([...f.keys()]).toEqual([
      "catalogo.json",
      "artigos.csv",
      "variantes.csv",
      "opcoes.csv",
      "valores.csv",
      "componentes.csv",
      "categorias.csv",
      "artigos_categorias.csv",
      "colecoes.csv",
      "colecoes_artigos.csv",
      "traducoes.csv",
      "media.csv",
      "publicacoes.csv",
      `imagens/${imagem}`,
    ]);
    expect(f.get(`imagens/${imagem}`)).toEqual(PNG);

    const json = JSON.parse(f.get("catalogo.json")?.toString() ?? "") as {
      formato: string;
      comerciante: { id: string; lingua_origem: string };
      artigos: {
        id: string;
        nome: string;
        ja_esteve_activo: boolean;
        variantes: { sku: string; componentes: unknown[] }[];
        traducoes: unknown[];
        categorias: string[];
        media: { ficheiro: string; texto_alternativo: string }[];
      }[];
      colecoes: { artigos: { artigo: string }[] }[];
    };
    expect(json.formato).toBe("eurolify.catalogo/1");
    expect(json.comerciante).toEqual({ id: `mer_${a}`, lingua_origem: "pt" });
    expect(json.artigos.map((x) => x.nome)).toEqual(["Gel rosa", "=SOMA(1;1)"]);
    const g = json.artigos[0];
    expect(g?.variantes.map((v) => v.sku)).toEqual(["GEL-001", "GEL-002"]);
    expect(g?.ja_esteve_activo).toBe(false);
    expect(g?.traducoes).toEqual([
      expect.objectContaining({
        campo: "nome",
        lingua: "es",
        texto: "Gel rosa",
        estado: "completa",
        origem: "pessoa",
      }),
    ]);
    expect(g?.categorias).toHaveLength(1);
    expect(g?.media).toEqual([
      expect.objectContaining({
        ficheiro: `imagens/${imagem}`,
        texto_alternativo: "Frasco de gel rosa, 30 ml",
      }),
    ]);
    expect(json.artigos[1]?.variantes[0]?.componentes).toEqual([
      expect.objectContaining({ quantidade: 2 }),
    ]);
    expect(json.colecoes[0]?.artigos.map((x) => x.artigo)).toEqual([
      `prd_${gel}`,
      expect.stringMatching(/^prd_/),
    ]);

    // Os CSV: a marca de ordem dos bytes, o cabeçalho e a fórmula guardada.
    const artigos = f.get("artigos.csv") ?? Buffer.alloc(0);
    expect(artigos.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const linhas = linhasCsv(artigos);
    expect(linhas[0]?.startsWith("id,tipo,estado,nome,")).toBe(true);
    expect(linhas).toHaveLength(3);
    expect(linhas[2]).toContain(",'=SOMA(1;1),");
    // Uma tabela vazia tem o cabeçalho na mesma.
    expect(linhasCsv(f.get("publicacoes.csv") ?? Buffer.alloc(0))).toEqual([
      "id,artigo,loja,canal,mercado,estado,variantes_fora,ultima_verificacao,verificado_em,publicado_em,arquivado_em,motivo_arquivo,versao",
    ]);
    // Nem quem fez, nem o que é de B, em nenhum ficheiro.
    for (const [nome, conteudo] of f) {
      if (nome.startsWith("imagens/")) continue;
      const texto = conteudo.toString("utf8");
      expect(texto, nome).not.toMatch(/_por\b|pessoa:teste/);
      expect(texto, nome).not.toContain("Só de B");
      expect(texto, nome).not.toContain(b);
    }
  });

  it("repetir com a mesma chave devolve a mesma exportação e não deixa ficheiros a mais", async () => {
    const chave = randomUUID();
    const r1 = await pedir("POST", "/exports", { chave });
    const r2 = await pedir("POST", "/exports", { chave });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r2.json()).toEqual(r1.json());
    const id = r1.json<{ id: string }>().id.slice(4);
    const { n } = await comComerciante(base.api, a, (trx) =>
      trx
        .selectFrom("exportacao")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("id", "=", id)
        .executeTakeFirstOrThrow(),
    );
    expect(Number(n)).toBe(1);
    const ficheiros = await readdir(join(pasta, ".exportacoes", a));
    expect(ficheiros.filter((x) => x.endsWith(".tmp"))).toEqual([]);
    expect(ficheiros).toContain(`${id}.zip`);
  });

  it("sem chave de idempotência, ou sem catalog:read, não exporta", async () => {
    const sem = await pedir("POST", "/exports", { chave: null });
    expect(sem.statusCode).toBe(400);
    expect(sem.json<{ codigo: string }>().codigo).toBe(
      "idempotency.key_required",
    );
    expect(
      (await pedir("POST", "/exports", { segredo: semCatalogo })).statusCode,
    ).toBe(403);
    for (const corpo of [
      { dominios: [] },
      { dominios: ["precos"] },
      { dominios: ["catalogo", "catalogo"] },
      {},
    ]) {
      expect(
        (await pedir("POST", "/exports", { corpo })).statusCode,
        JSON.stringify(corpo),
      ).toBe(400);
    }
  });

  it("lista, mostra e, depois do prazo, recusa descarregar (410)", async () => {
    const e = await exportar();
    const lista = await pedir("GET", "/exports?limite=1");
    expect(lista.statusCode).toBe(200);
    const pagina = lista.json<{
      dados: { id: string }[];
      ha_mais: boolean;
      cursor_seguinte: string | null;
      total: number;
    }>();
    expect(pagina.dados.map((x) => x.id)).toEqual([e.id]);
    expect(pagina.ha_mais).toBe(true);
    const seguinte = await pedir(
      "GET",
      `/exports?limite=100&cursor=${pagina.cursor_seguinte ?? ""}`,
    );
    expect(
      seguinte.json<{ dados: { id: string }[] }>().dados.map((x) => x.id),
    ).not.toContain(e.id);
    expect(seguinte.json<{ dados: unknown[] }>().dados).toHaveLength(
      pagina.total - 1,
    );
    expect((await pedir("GET", `/exports/${e.id}`)).json()).toMatchObject({
      id: e.id,
      expirada: false,
    });
    await sql`update exportacao set expira_em = now() - interval '1 second'
      where id = ${e.id.slice(4)}::uuid`.execute(base.dono);
    expect((await pedir("GET", `/exports/${e.id}`)).json()).toMatchObject({
      expirada: true,
    });
    const r = await pedir("GET", `/exports/${e.id}/file`);
    expect(r.statusCode).toBe(410);
    expect(r.json<{ codigo: string }>().codigo).toBe("export.expired");
  });

  it("outro comerciante não vê nem descarrega, e a exportação dele só tem o dele", async () => {
    const e = await exportar();
    for (const url of [`/exports/${e.id}`, `/exports/${e.id}/file`]) {
      const r = await pedir("GET", url, { segredo: leituraB });
      expect(r.statusCode, url).toBe(404);
      expect(r.json<{ codigo: string }>().codigo).toBe("export.not_found");
    }
    const lista = await pedir("GET", "/exports", { segredo: leituraB });
    expect(lista.json<{ total: number }>().total).toBe(0);
    const deB = await exportar(leituraB);
    const f = lerZip(await descarregar(deB.id, leituraB));
    const json = JSON.parse(f.get("catalogo.json")?.toString() ?? "") as {
      artigos: { nome: string }[];
    };
    expect(json.artigos.map((x) => x.nome)).toEqual(["Só de B"]);
    expect([...f.keys()].some((k) => k.startsWith("imagens/"))).toBe(false);
  });

  it("uma de cada vez por comerciante: a segunda ao mesmo tempo dá 429; outro comerciante não espera", async () => {
    const primeira = pedir("POST", "/exports", { instancia: lenta });
    for (let i = 0; i < 200 && !aEspera(); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(aEspera()).toBe(true);
    const segunda = await pedir("POST", "/exports", { instancia: lenta });
    expect(segunda.statusCode).toBe(429);
    expect(segunda.headers["retry-after"]).toBe("5");
    const deB = await pedir("POST", "/exports", {
      instancia: lenta,
      segredo: leituraB,
    });
    expect(deB.statusCode).toBe(201);
    largar();
    expect((await primeira).statusCode).toBe(201);
    // Acabada a primeira, já se exporta outra vez.
    const outra = pedir("POST", "/exports", { instancia: lenta });
    for (let i = 0; i < 200 && !aEspera(); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    largar();
    expect((await outra).statusCode).toBe(201);
  });

  it("a leitura é de um momento só: uma escrita a meio da recolha não entra", async () => {
    // A recolha pára depois da primeira leitura; um artigo novo entra noutra
    // ligação; o artigo não pode aparecer no ZIP (REPEATABLE READ).
    let parou = false;
    const comPausa = base.api.withPlugin({
      transformQuery: (a) => a.node,
      transformResult: async (a) => {
        if (!parou) {
          parou = true;
          await criarArtigo(
            base.api,
            a2,
            { tipo: "fisico", nome: "Entrou a meio" },
            [{ sku: `M-${randomUUID()}`, unidade_de_venda: "unidade" }],
          );
        }
        return a.result;
      },
    });
    const a2 = a;
    const lido = await lerCatalogo(comPausa, a, new Date());
    expect(parou).toBe(true);
    const nomes = (lido.json.artigos as { nome: string }[]).map((x) => x.nome);
    expect(nomes).not.toContain("Entrou a meio");
    const depois = await lerCatalogo(base.api, a, new Date());
    expect(
      (depois.json.artigos as { nome: string }[]).map((x) => x.nome),
    ).toContain("Entrou a meio");
  });

  it("à espera das imagens, a exportação já não tem a base presa", async () => {
    const primeira = pedir("POST", "/exports", { instancia: lenta });
    await nasImagens();
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from pg_stat_activity
      where usename = 'eurolify_api' and state like 'idle in transaction%'`.execute(
      base.dono,
    );
    expect(rows[0]?.n).toBe(0);
    largar();
    expect((await primeira).statusCode).toBe(201);
  });

  it("um ZIP grande demais dá 422 e uma imagem em falta 500, sem linha nem temporário; a vez fica livre", async () => {
    const contar = async () =>
      (
        await comComerciante(base.api, a, (trx) =>
          trx
            .selectFrom("exportacao")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .executeTakeFirstOrThrow(),
        )
      ).n;
    const antes = await contar();
    modo.valor = "grande";
    const grande = await pedir("POST", "/exports", { instancia: lenta });
    expect(grande.statusCode).toBe(422);
    expect(grande.json<{ codigo: string }>().codigo).toBe("export.too_large");
    modo.valor = "falta";
    const falta = await pedir("POST", "/exports", { instancia: lenta });
    expect(falta.statusCode).toBe(500);
    expect(await contar()).toBe(antes);
    const ficheiros = await readdir(join(pasta, ".exportacoes", a));
    expect(ficheiros.filter((x) => x.endsWith(".tmp"))).toEqual([]);
    expect((await pedir("POST", "/exports")).statusCode).toBe(201);
  });

  it("no máximo 3 por expirar; pedir outra apaga os ZIP expirados, sem linha e temporários", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await exportar()).id.slice(4));
    const quarta = await pedir("POST", "/exports");
    expect(quarta.statusCode).toBe(409);
    expect(quarta.json<{ codigo: string }>().codigo).toBe(
      "export.limit_reached",
    );
    const dir = join(pasta, ".exportacoes", a);
    // Parados há mais de uma hora: o ZIP sem linha, o temporário e a
    // expirada saem. Recentes (podem ser de outra instância a meio, 2.ª
    // revisão, P2-A): ficam. Uma pasta lá dentro não faz falhar (P2-B), e a
    // pasta de outro comerciante não se toca (P3-3).
    const velho = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const semLinha = `${randomUUID()}.zip`;
    const temporario = `${randomUUID()}.zip.tmp`;
    const recente = `${randomUUID()}.zip.tmp`;
    await writeFile(join(dir, semLinha), "sem linha");
    await writeFile(join(dir, temporario), "a meio");
    await writeFile(join(dir, recente), "a meio, de outra instância");
    await mkdir(join(dir, "uma-pasta"), { recursive: true });
    await utimes(join(dir, semLinha), velho, velho);
    await utimes(join(dir, temporario), velho, velho);
    await utimes(join(dir, "uma-pasta"), velho, velho);
    await utimes(join(dir, `${ids[0] ?? ""}.zip`), velho, velho);
    const deB = join(pasta, ".exportacoes", b);
    await mkdir(deB, { recursive: true });
    await writeFile(join(deB, semLinha), "de B");
    await utimes(join(deB, semLinha), velho, velho);
    await sql`update exportacao set expira_em = now() - interval '1 second'
      where id = ${ids[0] ?? ""}::uuid`.execute(base.dono);
    const nova = await exportar();
    const ficaram = await readdir(dir);
    for (const id of [ids[1], ids[2], nova.id.slice(4)]) {
      expect(ficaram).toContain(`${id ?? ""}.zip`);
    }
    expect(ficaram).toContain(recente);
    expect(ficaram).toContain("uma-pasta");
    expect(ficaram).not.toContain(semLinha);
    expect(ficaram).not.toContain(temporario);
    expect(ficaram).not.toContain(`${ids[0] ?? ""}.zip`);
    expect(await readdir(deB)).toContain(semLinha);
    const expirada = await pedir("GET", `/exports/exp_${ids[0] ?? ""}/file`);
    expect(expirada.statusCode).toBe(410);
  });

  it("uma chave já usada não refaz o ZIP: a repetição, um corpo inválido ou uma chave mal escrita respondem logo", async () => {
    const chave = randomUUID();
    const r1 = await pedir("POST", "/exports", { chave });
    expect(r1.statusCode).toBe(201);
    // Pela instância lenta: se refizesse o ZIP, ficava à espera das imagens.
    const r2 = await pedir("POST", "/exports", { chave, instancia: lenta });
    expect(r2.json()).toEqual(r1.json());
    const outro = await pedir("POST", "/exports", {
      chave,
      corpo: { dominios: ["catalogo"], x: 1 },
      instancia: lenta,
    });
    expect(outro.statusCode).toBe(400);
    const malEscrita = await pedir("POST", "/exports", {
      chave: "x".repeat(300),
      instancia: lenta,
    });
    expect(malEscrita.statusCode).toBe(400);
    expect(aEspera()).toBe(false);
  });

  it("uma chave abandonada a meio há mais de 60 s não dá 409: a exportação faz-se (2.ª revisão, P3-1)", async () => {
    const chave = randomUUID();
    await sql`insert into idempotencia
      (comerciante_id, chave, metodo, caminho, resumo_corpo, criado_em)
      values (${a}::uuid, ${chave}, 'POST', '/exports', ${"0".repeat(64)},
        now() - interval '2 minutes')`.execute(base.dono);
    const r = await pedir("POST", "/exports", { chave });
    expect(r.statusCode, r.body).toBe(201);
  });

  it("um cursor ou um id mal escritos dão 400", async () => {
    expect((await pedir("GET", "/exports?cursor=AAAA")).statusCode).toBe(400);
    expect((await pedir("GET", "/exports/exp_x")).statusCode).toBe(400);
    expect((await pedir("GET", "/exports/exp_x/file")).statusCode).toBe(400);
  });

  it("um ZIP que falta ou está cortado no armazenamento dá 500 sem pormenor", async () => {
    const e = await exportar();
    await rm(join(pasta, ".exportacoes", a, `${e.id.slice(4)}.zip`));
    const r = await pedir("GET", `/exports/${e.id}/file`);
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain(pasta);
    // Cortado (outro tamanho do que a linha diz): também 500, sem enviar.
    const outra = await exportar();
    await writeFile(
      join(pasta, ".exportacoes", a, `${outra.id.slice(4)}.zip`),
      "x",
    );
    expect((await pedir("GET", `/exports/${outra.id}/file`)).statusCode).toBe(
      500,
    );
  });
});
