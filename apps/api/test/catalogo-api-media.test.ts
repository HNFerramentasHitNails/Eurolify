import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { join } from "node:path";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import type { BaseDados } from "../src/base/esquema.js";
import {
  ArmazenamentoEmDisco,
  tipoDosBytes,
  type Armazenamento,
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
      // Um ficheiro cortado com o nome certo (uma escrita que a máquina não
      // acabou) escreve-se outra vez (revisão do #176, P2-2).
      await mkdir(join(pasta, c), { recursive: true });
      await writeFile(join(pasta, c, resumo(PNG)), PNG.subarray(0, 3));
      await a.guardar(c, resumo(PNG), PNG);
      expect(await readFile(join(pasta, c, resumo(PNG)))).toEqual(PNG);
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
  /** Espera até haver uma transacção à espera de um bloqueio na base. */
  async function haEspera(): Promise<boolean> {
    for (let i = 0; i < 100; i++) {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and wait_event = 'advisory' and query like '%eurolify.ficheiro%'`.execute(
        base.dono,
      );
      if ((rows[0]?.n ?? 0) > 0) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  }

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

  it("o Content-Type em maiúsculas ou com parâmetros serve; o corpo vazio não; dois comerciantes com os mesmos bytes ficam cada um com o seu", async () => {
    const maiusculas = await enviar(PNG, "IMAGE/PNG; q=1");
    expect(maiusculas.statusCode, maiusculas.body).toBe(201);
    const vazio = await enviar(Buffer.alloc(0), "image/png");
    expect(vazio.statusCode).toBe(400);
    expect(vazio.json()).toMatchObject({ codigo: "request.invalid" });
    const deB = await enviar(PNG, "image/png", { segredo: escritaDeB });
    expect(deB.statusCode).toBe(201);
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from ficheiro where resumo = ${resumo(PNG)}`.execute(
      base.dono,
    );
    expect(rows[0]?.n).toBe(2);
    const { rows: b } = await sql<{ c: string }>`
      select comerciante_id as c from ficheiro
      where resumo = ${resumo(PNG)} and comerciante_id <> ${a}`.execute(
      base.dono,
    );
    expect(await readFile(join(pasta, b[0]?.c ?? "", resumo(PNG)))).toEqual(
      PNG,
    );
  });

  it("a lista por páginas, uma a uma", async () => {
    const f = await artigo("Páginas");
    const png = await ficheiro(PNG, "image/png");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        (
          await pedir("POST", `/products/${f.id}/media`, { ficheiro: png.id })
        ).json<Media>().id,
      );
    }
    const vistos: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const q: string =
        cursor === null ? "limite=1" : `limite=1&cursor=${cursor}`;
      const p = (await pedir("GET", `/products/${f.id}/media?${q}`)).json<
        Pagina<Media>
      >();
      expect(p.total).toBe(3);
      vistos.push(...p.dados.map((m) => m.id));
      cursor = p.cursor_seguinte;
      if (!p.ha_mais) break;
    }
    expect(vistos).toEqual(ids);
  });

  it("o espaço de cada comerciante: no limite passa, acima dá 409 e nada se escreve no disco; o mesmo ficheiro outra vez não ocupa", async () => {
    const pastaQuota = await mkdtemp(join(tmpdir(), "eurolify-quota-"));
    const comQuota = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      new ArmazenamentoEmDisco(pastaQuota, PNG.length + JPEG.length),
    );
    try {
      const c = await registarComerciante(base.api, NOVO);
      const { segredo } = await criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Quota",
        ambitos: ["catalog:read", "catalog:write"],
      });
      const env = (bytes: Buffer, tipo: string) =>
        comQuota.inject({
          method: "POST",
          url: "/media/uploads",
          headers: {
            authorization: `Bearer ${segredo}`,
            "idempotency-key": randomUUID(),
            "content-type": tipo,
          },
          payload: bytes,
        });
      expect((await env(PNG, "image/png")).statusCode).toBe(201);
      expect((await env(JPEG, "image/jpeg")).statusCode).toBe(201);
      const acima = await env(WEBP, "image/webp");
      expect(acima.statusCode).toBe(409);
      expect(acima.json()).toMatchObject({
        codigo: "catalog.media_quota_exceeded",
      });
      await expect(
        readFile(join(pastaQuota, c, resumo(WEBP))),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect((await env(PNG, "image/png")).statusCode).toBe(201);
    } finally {
      await comQuota.close();
      await rm(pastaQuota, { recursive: true, force: true });
    }
  });

  it("o espaço com dois envios ao mesmo tempo: cada um cabe, os dois não; o segundo a registar dá 409", async () => {
    const pastaQ = await mkdtemp(join(tmpdir(), "eurolify-quota2-"));
    const disco = new ArmazenamentoEmDisco(pastaQ, PNG.length + 1);
    let soltar: () => void = () => undefined;
    const portao = new Promise<void>((r) => {
      soltar = r;
    });
    let dentro = 0;
    const lento: Armazenamento = {
      quotaPorComerciante: disco.quotaPorComerciante,
      guardar: async (c, r, b) => {
        dentro++;
        await portao;
        await disco.guardar(c, r, b);
      },
      ler: (c, r) => disco.ler(c, r),
    };
    const app2 = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      lento,
    );
    try {
      const c = await registarComerciante(base.api, NOVO);
      const { segredo } = await criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Quota 2",
        ambitos: ["catalog:read", "catalog:write"],
      });
      const env = (bytes: Buffer) =>
        app2.inject({
          method: "POST",
          url: "/media/uploads",
          headers: {
            authorization: `Bearer ${segredo}`,
            "idempotency-key": randomUUID(),
            "content-type": "image/png",
          },
          payload: bytes,
        });
      // Dois PNG diferentes, do mesmo tamanho: cada um cabe sozinho.
      const p1 = env(PNG);
      const p2 = env(Buffer.concat([PNG.subarray(0, -1), Buffer.from("!")]));
      // O primeiro grava (preso no portão) com a fila do comerciante; o
      // segundo espera pela fila na base, sem tocar no disco.
      for (let i = 0; i < 100 && dentro < 1; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(dentro).toBe(1);
      expect(await haEspera()).toBe(true);
      soltar();
      const codigos = [(await p1).statusCode, (await p2).statusCode].sort();
      expect(codigos).toEqual([201, 409]);
      // O recusado nunca chegou ao disco.
      expect(dentro).toBe(1);
    } finally {
      soltar();
      await app2.close();
      await rm(pastaQ, { recursive: true, force: true });
    }
  });

  it("no máximo 2 envios do mesmo comerciante ao mesmo tempo: o terceiro dá 429; acabados, volta a haver lugar", async () => {
    const pastaLenta = await mkdtemp(join(tmpdir(), "eurolify-lenta-"));
    const disco = new ArmazenamentoEmDisco(pastaLenta);
    let soltar: () => void = () => undefined;
    const portao = new Promise<void>((r) => {
      soltar = r;
    });
    let dentro = 0;
    const lento: Armazenamento = {
      quotaPorComerciante: disco.quotaPorComerciante,
      guardar: async (c, r, b) => {
        dentro++;
        await portao;
        await disco.guardar(c, r, b);
      },
      ler: (c, r) => disco.ler(c, r),
    };
    const comLento = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      lento,
    );
    try {
      // Um servidor a escutar, com ligações a sério: o `inject` não mostra
      // quando o Node dá o pedido por fechado (3.ª revisão do #176, P2-1).
      const endereco = await comLento.listen({ port: 0, host: "127.0.0.1" });
      const env = async (bytes: Buffer, tipo: string) => {
        const r = await fetch(`${endereco}/media/uploads`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${escrita}`,
            "idempotency-key": randomUUID(),
            "content-type": tipo,
          },
          body: bytes,
        });
        return {
          statusCode: r.status,
          headers: { "retry-after": r.headers.get("retry-after") },
          json: async () => await r.json(),
        };
      };
      const um = env(PNG, "image/png");
      const dois = env(JPEG, "image/jpeg");
      // Um grava (preso no portão); o outro espera pela fila na base: os
      // dois estão em curso.
      for (let i = 0; i < 100 && dentro < 1; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(dentro).toBe(1);
      expect(await haEspera()).toBe(true);
      const tres = await env(WEBP, "image/webp");
      expect(tres.statusCode).toBe(429);
      expect(await tres.json()).toMatchObject({
        codigo: "rate_limit.exceeded",
      });
      expect(tres.headers["retry-after"]).toBe("1");
      soltar();
      expect((await um).statusCode).toBe(201);
      expect((await dois).statusCode).toBe(201);
      expect((await env(WEBP, "image/webp")).statusCode).toBe(201);
    } finally {
      soltar();
      await comLento.close();
      await rm(pastaLenta, { recursive: true, force: true });
    }
  });

  it("um envio cortado a meio liberta o lugar; uma gravação que falha não deixa registo e a chave volta a servir", async () => {
    const pastaC = await mkdtemp(join(tmpdir(), "eurolify-corte-"));
    const disco = new ArmazenamentoEmDisco(pastaC);
    let falhar = true;
    const falivel: Armazenamento = {
      quotaPorComerciante: disco.quotaPorComerciante,
      guardar: async (c, r, b) => {
        if (falhar) throw new Error("disco cheio (de mentira)");
        await disco.guardar(c, r, b);
      },
      ler: (c, r) => disco.ler(c, r),
    };
    let p1: ReturnType<typeof connect> | undefined;
    let p2: ReturnType<typeof connect> | undefined;
    const appC = criarApp(
      { logger: false },
      undefined,
      base.api,
      undefined,
      falivel,
    );
    try {
      const endereco = new URL(
        await appC.listen({ port: 0, host: "127.0.0.1" }),
      );
      const env = async (bytes: Buffer, chave = randomUUID()) =>
        fetch(`${endereco.origin}/media/uploads`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${escrita}`,
            "idempotency-key": chave,
            "content-type": "image/png",
          },
          body: bytes,
        });
      // Dois envios que mandam só parte do corpo e ficam pendurados. Um
      // pendurado que recebe resposta não ficou com lugar: o envio do ciclo
      // de baixo chegou ao servidor antes dele e ele levou o 429 (medido a
      // 09/10/2026: 2 em 25 corridas seguidas). Substitui-se, até os dois
      // lugares serem dos pendurados.
      const responderam = new WeakSet<ReturnType<typeof connect>>();
      const pendurado = () =>
        new Promise<ReturnType<typeof connect>>((resolve) => {
          const s = connect(Number(endereco.port), "127.0.0.1", () => {
            s.write(
              [
                "POST /media/uploads HTTP/1.1",
                `Host: ${endereco.host}`,
                `Authorization: Bearer ${escrita}`,
                `Idempotency-Key: ${randomUUID()}`,
                "Content-Type: image/png",
                "Content-Length: 1000",
                "",
                "",
              ].join("\r\n"),
            );
            s.write(PNG);
            resolve(s);
          });
          s.on("data", () => responderam.add(s));
          s.on("error", () => undefined);
        });
      p1 = await pendurado();
      p2 = await pendurado();
      // Os dois lugares estão ocupados: dois 429 seguidos sem nenhum
      // pendurado ter recebido resposta (um só podia vir de um lugar ainda
      // preso pelo envio da volta anterior).
      let cheio = 0;
      let seguidos = 0;
      for (let i = 0; i < 100 && seguidos < 2; i++) {
        if (responderam.has(p1)) {
          p1.destroy();
          p1 = await pendurado();
        }
        if (responderam.has(p2)) {
          p2.destroy();
          p2 = await pendurado();
        }
        await new Promise((r) => setTimeout(r, 20));
        cheio = (await env(PNG)).status;
        seguidos =
          cheio === 429 && !responderam.has(p1) && !responderam.has(p2)
            ? seguidos + 1
            : 0;
      }
      expect(cheio).toBe(429);
      expect(seguidos).toBe(2);
      // Cortadas as ligações, os lugares voltam.
      p1.destroy();
      p2.destroy();
      let estado = 429;
      for (let i = 0; i < 100 && estado === 429; i++) {
        await new Promise((r) => setTimeout(r, 20));
        estado = (await env(PNG)).status;
      }
      // A gravação falha (500): nem registo nem ficheiro.
      expect(estado).toBe(500);
      const bytes = Buffer.concat([PNG, Buffer.from(randomUUID())]);
      const chave = randomUUID();
      const falhou = await env(bytes, chave);
      expect(falhou.status).toBe(500);
      const corpo = await falhou.text();
      expect(corpo).not.toContain("disco cheio");
      expect(corpo).not.toContain(pastaC);
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from ficheiro
        where comerciante_id = ${a} and resumo = ${resumo(bytes)}`.execute(
        base.dono,
      );
      expect(rows[0]?.n).toBe(0);
      // Com o disco de volta, a mesma chave serve (a falha não ficou
      // guardada como resposta).
      falhar = false;
      expect((await env(bytes, chave)).status).toBe(201);
    } finally {
      p1?.destroy();
      p2?.destroy();
      await appC.close();
      await rm(pastaC, { recursive: true, force: true });
    }
    // Os dois ciclos podem ir a 100 voltas cada num CI lento.
  }, 30_000);

  it("um ficheiro que falta no disco dá 500 sem dizer onde", async () => {
    const f = await artigo("Sem ficheiro");
    const bytes = Buffer.concat([PNG, Buffer.from(randomUUID())]);
    const fid = (await ficheiro(bytes, "image/png")).id;
    const m = (
      await pedir("POST", `/products/${f.id}/media`, { ficheiro: fid })
    ).json<Media>();
    await rm(join(pasta, a, resumo(bytes)));
    const r = await pedir("GET", `/media/${m.id}/file`);
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain(pasta);
    expect(r.body).not.toContain(resumo(bytes));
  });

  it("a idempotência: a mesma chave não liga duas vezes nem envia outro ficheiro; outro corpo dá key_reused", async () => {
    const f = await artigo("Idem");
    const chave = randomUUID();
    const e1 = await enviar(WEBP, "image/webp", { chave });
    const e2 = await enviar(WEBP, "image/webp", { chave });
    expect(e2.statusCode).toBe(201);
    expect(e2.json()).toEqual(e1.json());
    const novos = Buffer.concat([JPEG, Buffer.from(randomUUID())]);
    const outro = await enviar(novos, "image/jpeg", { chave });
    expect(outro.json()).toMatchObject({ codigo: "idempotency.key_reused" });
    // Uma chave já usada não escreve no disco (2.ª revisão do #176, P1-N1).
    await expect(readFile(join(pasta, a, resumo(novos)))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
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
    // Uma imagem que só A enviou (B tem o PNG simples, de outro teste).
    const png = await ficheiro(
      Buffer.concat([PNG, Buffer.from("só de A")]),
      "image/png",
    );
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
