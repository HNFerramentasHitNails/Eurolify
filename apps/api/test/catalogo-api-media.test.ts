import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
import {
  ArmazenamentoEmDisco,
  tipoDosBytes,
} from "../src/catalogo/armazenamento.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// As imagens dos artigos (docs/14 §3.5; docs/06, CQ), contra o PostgreSQL 18
// verdadeiro e uma pasta temporária no lugar do disco da VPS.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };

/** Imagens mínimas: só os primeiros bytes de cada formato e um resto. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("resto do png"),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("resto do jpeg"),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x10, 0, 0, 0]),
  Buffer.from("WEBPVP8 resto"),
]);
const resumo = (b: Buffer) => createHash("sha256").update(b).digest("hex");

interface Ficheiro {
  id: string;
  tipo: string;
  bytes: number;
}
interface Media {
  id: string;
  artigo: string;
  variante: string | null;
  ficheiro: Ficheiro;
  texto_alternativo: string | null;
  posicao: number;
  principal: boolean;
  versao: number;
}
interface Pagina<T> {
  dados: T[];
  total: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}

describe("o armazenamento em disco e os primeiros bytes", () => {
  it("reconhece JPEG, PNG e WebP pelos primeiros bytes, e mais nada", () => {
    expect(tipoDosBytes(PNG)).toBe("image/png");
    expect(tipoDosBytes(JPEG)).toBe("image/jpeg");
    expect(tipoDosBytes(WEBP)).toBe("image/webp");
    expect(tipoDosBytes(Buffer.from("GIF89a..."))).toBeNull();
    expect(tipoDosBytes(Buffer.from("<svg xmlns="))).toBeNull();
    expect(tipoDosBytes(Buffer.alloc(0))).toBeNull();
    expect(tipoDosBytes(Buffer.from("RIFF\0\0\0\0WAVE"))).toBeNull();
  });

  it("não sai da pasta: o comerciante e o resumo têm de ter o formato", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "eurolify-media-"));
    try {
      const a = new ArmazenamentoEmDisco(pasta);
      const c = randomUUID();
      for (const [comerciante, r] of [
        ["../fora", resumo(PNG)],
        [c, "../../etc/passwd"],
        [c, resumo(PNG).toUpperCase()],
      ]) {
        await expect(
          a.guardar(comerciante ?? "", r ?? "", PNG),
        ).rejects.toThrow(/fora do formato/);
      }
      await a.guardar(c, resumo(PNG), PNG);
      // Guardar outra vez o mesmo resumo não muda nada.
      await a.guardar(c, resumo(PNG), PNG);
      expect(await a.ler(c, resumo(PNG))).toEqual(PNG);
      expect(await readFile(join(pasta, c, resumo(PNG)))).toEqual(PNG);
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  });
});

describe.skipIf(URL_BASE === undefined)("API do Catálogo: imagens", () => {
  let base: BaseDeTeste;
  let app: ReturnType<typeof criarApp>;
  let semMedia: ReturnType<typeof criarApp>;
  let pasta: string;
  let a: string;
  let escrita: string;
  let leitura: string;
  let publicacao: string;
  let escritaDeB: string;

  const pedir = (
    metodo: "POST" | "PUT" | "PATCH" | "GET" | "DELETE",
    url: string,
    corpo?: unknown,
    {
      segredo = escrita,
      chave = randomUUID(),
      instancia = app,
    }: {
      segredo?: string;
      chave?: string | null;
      instancia?: ReturnType<typeof criarApp>;
    } = {},
  ) =>
    instancia.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${segredo}`,
        ...(chave === null || metodo === "GET"
          ? {}
          : { "idempotency-key": chave }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });

  const enviar = (
    bytes: Buffer,
    tipo: string,
    {
      segredo = escrita,
      chave = randomUUID(),
    }: { segredo?: string; chave?: string } = {},
  ) =>
    app.inject({
      method: "POST",
      url: "/media/uploads",
      headers: {
        authorization: `Bearer ${segredo}`,
        "idempotency-key": chave,
        "content-type": tipo,
      },
      payload: bytes,
    });

  async function artigo(nome: string, segredo = escrita) {
    const r = await pedir(
      "POST",
      "/products",
      {
        tipo: "fisico",
        nome,
        categoria_fiscal: "normal",
        variantes: [{ sku: `M-${randomUUID()}`, unidade_de_venda: "unidade" }],
      },
      { segredo },
    );
    expect(r.statusCode).toBe(201);
    return r.json<{
      id: string;
      versao: number;
      variantes: { id: string }[];
    }>();
  }

  async function ficheiro(bytes: Buffer, tipo: string, segredo = escrita) {
    const r = await enviar(bytes, tipo, { segredo });
    expect(r.statusCode, r.body).toBe(201);
    return r.json<Ficheiro>();
  }

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    pasta = await mkdtemp(join(tmpdir(), "eurolify-media-"));
    app = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      new ArmazenamentoEmDisco(pasta),
    );
    semMedia = criarApp({ logger: false }, undefined, base.api);
    a = await registarComerciante(base.api, NOVO);
    const b = await registarComerciante(base.api, NOVO);
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
    escrita = await chaveDe(a, "Escrita", ["catalog:read", "catalog:write"]);
    leitura = await chaveDe(a, "Leitura", ["catalog:read"]);
    publicacao = await chaveDe(a, "Publicação", ["catalog:publish"]);
    escritaDeB = await chaveDe(b, "Escrita de B", [
      "catalog:read",
      "catalog:write",
    ]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await semMedia.close();
    await base.fechar();
    await rm(pasta, { recursive: true, force: true });
  });

  it("envia JPEG, PNG e WebP; o ficheiro fica na pasta do comerciante, pelo resumo; o mesmo outra vez é o mesmo", async () => {
    for (const [bytes, tipo] of [
      [PNG, "image/png"],
      [JPEG, "image/jpeg"],
      [WEBP, "image/webp"],
    ] as const) {
      const f = await ficheiro(bytes, tipo);
      expect(f).toEqual({
        id: `fil_${resumo(bytes)}`,
        tipo,
        bytes: bytes.length,
      });
      expect(await readFile(join(pasta, a, resumo(bytes)))).toEqual(bytes);
    }
    // Outra vez, com outra chave: o mesmo ficheiro, uma linha só.
    expect(await ficheiro(PNG, "image/png")).toMatchObject({
      id: `fil_${resumo(PNG)}`,
    });
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from ficheiro
      where comerciante_id = ${a} and resumo = ${resumo(PNG)}`.execute(
      base.dono,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("recusa o que não é uma imagem aceite: outro tipo (415), o tipo trocado ou bytes que não são imagem (400), acima de 10 MB (413)", async () => {
    const gif = await enviar(Buffer.from("GIF89a....."), "image/gif");
    expect(gif.statusCode).toBe(415);
    expect(gif.json()).toMatchObject({ codigo: "media_type.unsupported" });
    const svg = await enviar(Buffer.from("<svg/>"), "image/svg+xml");
    expect(svg.statusCode).toBe(415);
    const json = await pedir("POST", "/media/uploads", { x: 1 });
    expect(json.statusCode).toBe(415);
    expect(json.json()).toMatchObject({ codigo: "media_type.unsupported" });
    const trocado = await enviar(PNG, "image/jpeg");
    expect(trocado.statusCode).toBe(400);
    expect(trocado.json()).toMatchObject({ codigo: "request.invalid" });
    const falso = await enviar(Buffer.from("isto não é um png"), "image/png");
    expect(falso.statusCode).toBe(400);
    expect(falso.json()).toMatchObject({ codigo: "request.invalid" });
    const grande = await enviar(
      Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]),
      "image/png",
    );
    expect(grande.statusCode).toBe(413);
    expect(grande.json()).toMatchObject({ codigo: "payload.too_large" });
    // Exactamente 10 MB passa.
    const noLimite = await enviar(
      Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 - PNG.length)]),
      "image/png",
    );
    expect(noLimite.statusCode).toBe(201);
  });

  it("liga ao artigo: posição seguinte, uma só principal, variante do mesmo artigo; lê a lista e os bytes", async () => {
    const f = await artigo("Gel rosa");
    const outro = await artigo("Outro");
    const png = await ficheiro(PNG, "image/png");
    const jpeg = await ficheiro(JPEG, "image/jpeg");
    const r1 = await pedir("POST", `/products/${f.id}/media`, {
      ficheiro: png.id,
      texto_alternativo: "Frasco de gel rosa",
      principal: true,
    });
    expect(r1.statusCode, r1.body).toBe(201);
    const m1 = r1.json<Media>();
    expect(r1.headers.location).toBe(`/media/${m1.id}`);
    expect(m1).toMatchObject({
      artigo: f.id,
      variante: null,
      ficheiro: png,
      texto_alternativo: "Frasco de gel rosa",
      posicao: 0,
      principal: true,
      versao: 1,
    });
    const m2 = (
      await pedir("POST", `/products/${f.id}/media`, {
        ficheiro: jpeg.id,
        variante: f.variantes[0]?.id,
        principal: true,
      })
    ).json<Media>();
    expect(m2).toMatchObject({
      posicao: 1,
      principal: true,
      variante: f.variantes[0]?.id,
    });
    const lista = (
      await pedir("GET", `/products/${f.id}/media`, undefined, {
        segredo: leitura,
      })
    ).json<Pagina<Media>>();
    expect(lista.total).toBe(2);
    expect(lista.dados.map((m) => [m.id, m.principal])).toEqual([
      [m1.id, false],
      [m2.id, true],
    ]);
    // A variante de outro artigo, um ficheiro que não existe: 404.
    const deOutro = await pedir("POST", `/products/${f.id}/media`, {
      ficheiro: png.id,
      variante: outro.variantes[0]?.id,
    });
    expect(deOutro.statusCode).toBe(404);
    expect(deOutro.json()).toMatchObject({ codigo: "catalog.not_found" });
    const semFicheiro = await pedir("POST", `/products/${f.id}/media`, {
      ficheiro: `fil_${"0".repeat(64)}`,
    });
    expect(semFicheiro.statusCode).toBe(404);
    const semArtigo = await pedir(
      "POST",
      `/products/prd_${randomUUID()}/media`,
      { ficheiro: png.id },
    );
    expect(semArtigo.statusCode).toBe(404);
    // Os bytes, com o tipo e os cabeçalhos que impedem o browser de
    // adivinhar outro tipo ou de correr alguma coisa.
    const bytes = await pedir("GET", `/media/${m1.id}/file`, undefined, {
      segredo: leitura,
    });
    expect(bytes.statusCode).toBe(200);
    expect(bytes.rawPayload).toEqual(PNG);
    expect(bytes.headers["content-type"]).toBe("image/png");
    expect(bytes.headers["x-content-type-options"]).toBe("nosniff");
    expect(bytes.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect((await pedir("GET", `/media/${m2.id}`)).json<Media>()).toMatchObject(
      { id: m2.id, ficheiro: jpeg },
    );
  });

  it("altera com a versão, marca outra como principal, e tira; apagar o rascunho leva as imagens", async () => {
    const f = await artigo("Base");
    const png = await ficheiro(PNG, "image/png");
    const m1 = (
      await pedir("POST", `/products/${f.id}/media`, {
        ficheiro: png.id,
        principal: true,
      })
    ).json<Media>();
    const m2 = (
      await pedir("POST", `/products/${f.id}/media`, { ficheiro: png.id })
    ).json<Media>();
    const alt = await pedir("PATCH", `/media/${m2.id}`, {
      versao: 1,
      texto_alternativo: "Frasco de base",
    });
    expect(alt.json()).toMatchObject({
      texto_alternativo: "Frasco de base",
      versao: 2,
    });
    const igual = await pedir("PATCH", `/media/${m2.id}`, {
      versao: 2,
      texto_alternativo: "Frasco de base",
    });
    expect(igual.json()).toMatchObject({ versao: 2 });
    const velha = await pedir("PATCH", `/media/${m2.id}`, {
      versao: 1,
      posicao: 9,
    });
    expect(velha.statusCode).toBe(409);
    expect(velha.json()).toMatchObject({ codigo: "catalog.version_conflict" });
    const principal = await pedir("PATCH", `/media/${m2.id}`, {
      versao: 2,
      principal: true,
    });
    expect(principal.json()).toMatchObject({ principal: true, versao: 3 });
    expect(
      (await pedir("GET", `/media/${m1.id}`)).json<Media>().principal,
    ).toBe(false);
    const semTexto = await pedir("PATCH", `/media/${m2.id}`, {
      versao: 3,
      texto_alternativo: null,
    });
    expect(semTexto.json()).toMatchObject({ texto_alternativo: null });
    const apagar = await pedir("DELETE", `/media/${m1.id}`);
    expect(apagar.statusCode).toBe(204);
    expect((await pedir("DELETE", `/media/${m1.id}`)).statusCode).toBe(404);
    // O ficheiro continua, na outra imagem.
    expect((await pedir("GET", `/media/${m2.id}/file`)).rawPayload).toEqual(
      PNG,
    );
    // Apagar o rascunho do artigo leva as imagens.
    expect((await pedir("DELETE", `/products/${f.id}`)).statusCode).toBe(204);
    expect((await pedir("GET", `/media/${m2.id}`)).statusCode).toBe(404);
  });

  it("duas imagens marcadas como principal ao mesmo tempo: as duas entram e fica uma só principal", async () => {
    const png = await ficheiro(PNG, "image/png");
    for (let ronda = 0; ronda < 5; ronda++) {
      const f = await artigo(`Corrida ${String(ronda)}`);
      const [r1, r2] = await Promise.all([
        pedir("POST", `/products/${f.id}/media`, {
          ficheiro: png.id,
          principal: true,
        }),
        pedir("POST", `/products/${f.id}/media`, {
          ficheiro: png.id,
          principal: true,
        }),
      ]);
      expect([r1.statusCode, r2.statusCode], `${r1.body} ${r2.body}`).toEqual([
        201, 201,
      ]);
      const lista = (await pedir("GET", `/products/${f.id}/media`)).json<
        Pagina<Media>
      >();
      expect(lista.dados.filter((m) => m.principal)).toHaveLength(1);
      expect(lista.dados.map((m) => m.posicao).sort()).toEqual([0, 1]);
    }
  });

  it("a idempotência: a mesma chave não liga duas vezes nem envia outro ficheiro; outro corpo dá key_reused", async () => {
    const f = await artigo("Idem");
    const chave = randomUUID();
    const e1 = await enviar(WEBP, "image/webp", { chave });
    const e2 = await enviar(WEBP, "image/webp", { chave });
    expect(e2.statusCode).toBe(201);
    expect(e2.json()).toEqual(e1.json());
    const outro = await enviar(JPEG, "image/jpeg", { chave });
    expect(outro.json()).toMatchObject({ codigo: "idempotency.key_reused" });
    const fid = e1.json<Ficheiro>().id;
    const k = randomUUID();
    const l1 = await pedir(
      "POST",
      `/products/${f.id}/media`,
      { ficheiro: fid },
      { chave: k },
    );
    const l2 = await pedir(
      "POST",
      `/products/${f.id}/media`,
      { ficheiro: fid },
      { chave: k },
    );
    expect(l2.json()).toEqual(l1.json());
    expect(
      (await pedir("GET", `/products/${f.id}/media`)).json<Pagina<Media>>()
        .total,
    ).toBe(1);
    const semChave = await pedir(
      "POST",
      `/products/${f.id}/media`,
      { ficheiro: fid },
      { chave: null },
    );
    expect(semChave.json()).toMatchObject({
      codigo: "idempotency.key_required",
    });
  });

  it("de outro comerciante: 404 em tudo, e o ficheiro de outro não se liga; os âmbitos; sem MEDIA_PASTA não há rotas", async () => {
    const f = await artigo("Meu");
    const png = await ficheiro(PNG, "image/png");
    const m = (
      await pedir("POST", `/products/${f.id}/media`, { ficheiro: png.id })
    ).json<Media>();
    for (const [metodo, url, corpo] of [
      ["GET", `/media/${m.id}`, undefined],
      ["GET", `/media/${m.id}/file`, undefined],
      ["GET", `/products/${f.id}/media`, undefined],
      ["PATCH", `/media/${m.id}`, { versao: 1, posicao: 3 }],
      ["DELETE", `/media/${m.id}`, undefined],
      ["POST", `/products/${f.id}/media`, { ficheiro: png.id }],
    ] as const) {
      const r = await pedir(metodo, url, corpo, { segredo: escritaDeB });
      expect(r.statusCode, `${metodo} ${url}`).toBe(404);
      expect(r.json(), `${metodo} ${url}`).toMatchObject({
        codigo: "catalog.not_found",
      });
    }
    // B não liga o ficheiro de A (que B nunca enviou) a um artigo seu.
    const deB = await artigo("De B", escritaDeB);
    const alheio = await pedir(
      "POST",
      `/products/${deB.id}/media`,
      { ficheiro: png.id },
      { segredo: escritaDeB },
    );
    expect(alheio.statusCode).toBe(404);
    // Nada mudou.
    expect((await pedir("GET", `/media/${m.id}`)).json<Media>().versao).toBe(1);
    // Os âmbitos.
    const enviarLeitura = await enviar(PNG, "image/png", { segredo: leitura });
    expect(enviarLeitura.statusCode).toBe(403);
    for (const [metodo, url, corpo] of [
      ["POST", `/products/${f.id}/media`, { ficheiro: png.id }],
      ["PATCH", `/media/${m.id}`, { versao: 1, posicao: 3 }],
      ["DELETE", `/media/${m.id}`, undefined],
    ] as const) {
      const r = await pedir(metodo, url, corpo, { segredo: leitura });
      expect(r.statusCode, `${metodo} ${url}`).toBe(403);
    }
    for (const url of [
      `/media/${m.id}`,
      `/media/${m.id}/file`,
      `/products/${f.id}/media`,
    ]) {
      const r = await pedir("GET", url, undefined, { segredo: publicacao });
      expect(r.statusCode, url).toBe(403);
    }
    // Sem armazenamento, as rotas da media não existem.
    const sem = await pedir("GET", `/media/${m.id}`, undefined, {
      instancia: semMedia,
    });
    expect(sem.statusCode).toBe(404);
    expect(sem.json()).toMatchObject({ codigo: "route.not_found" });
  });

  it("os pedidos estranhos dão 400 com o código", async () => {
    const f = await artigo("Estranho");
    const png = await ficheiro(PNG, "image/png");
    const m = (
      await pedir("POST", `/products/${f.id}/media`, { ficheiro: png.id })
    ).json<Media>();
    for (const [metodo, url, corpo] of [
      ["POST", `/products/${f.id}/media`, { ficheiro: "fil_123" }],
      ["POST", `/products/${f.id}/media`, { ficheiro: png.id, x: 1 }],
      [
        "POST",
        `/products/${f.id}/media`,
        { ficheiro: png.id, texto_alternativo: "   " },
      ],
      [
        "POST",
        `/products/${f.id}/media`,
        { ficheiro: png.id, texto_alternativo: "a".repeat(501) },
      ],
      ["POST", `/products/${f.id}/media`, { ficheiro: png.id, posicao: -1 }],
      ["PATCH", `/media/${m.id}`, { texto_alternativo: "sem versão" }],
      ["PATCH", `/media/${m.id}`, { versao: 1, ficheiro: png.id }],
      ["GET", `/media/prd_${randomUUID()}`, undefined],
    ] as const) {
      const r = await pedir(metodo, url, corpo);
      expect(r.statusCode, `${metodo} ${url}`).toBe(400);
      expect(r.json(), `${metodo} ${url}`).toMatchObject({
        codigo: "request.invalid",
      });
    }
  });
});
