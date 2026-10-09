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
  type Armazenamento,
} from "../src/catalogo/armazenamento.js";
import { limparFicheirosSemUso } from "../src/catalogo/limpeza-ficheiros.js";
import { ErroImagem, semMetadados } from "../src/catalogo/sem-metadados.js";
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
import { imagem, png } from "./imagens-de-teste.js";

// Os metadados das imagens e os ficheiros sem uso (docs/14 §3.5; issue #179;
// migração 0035). As imagens com metadados são de `imagens/gerar.py`:
// inventadas, com o GPS de um ponto no mar.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };
const resumo = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** Os textos que as imagens de teste levam nos metadados. */
const SEGREDOS = [
  "Fabricante de Teste",
  "Telemovel de Teste",
  "Autor de Teste",
  "comentario de teste",
  "descricao de teste",
  "2026:10:09",
];

/** O que vem a partir do primeiro varrimento (FFDA): os dados da imagem. */
const varrimento = (b: Buffer) =>
  b.subarray(b.indexOf(Buffer.from([0xff, 0xda])));

/** Os blocos de um PNG, por ordem, com os dados. */
function blocosPng(b: Buffer) {
  const r: { tipo: string; dados: Buffer }[] = [];
  for (let i = 8; i < b.length;) {
    const n = b.readUInt32BE(i);
    r.push({
      tipo: b.toString("latin1", i + 4, i + 8),
      dados: b.subarray(i + 8, i + 8 + n),
    });
    i += 12 + n;
  }
  return r;
}

describe("tirar os metadados", () => {
  it("JPEG: sai o EXIF (GPS, aparelho, data), o XMP e o comentário; fica a orientação; a imagem é a mesma", () => {
    const original = imagem("com-gps.jpg");
    const limpo = semMetadados(original, "image/jpeg");
    expect(original.includes("Fabricante de Teste")).toBe(true);
    for (const s of SEGREDOS) expect(limpo.includes(s), s).toBe(false);
    expect(limpo.includes("adobe:ns:meta")).toBe(false);
    // A orientação 6, num EXIF novo só com ela.
    const exif = limpo.indexOf("Exif\0\0MM");
    expect(exif).toBeGreaterThan(0);
    expect(limpo.readUInt16BE(exif + 6 + 10)).toBe(0x0112);
    expect(limpo.readUInt16BE(exif + 6 + 18)).toBe(6);
    expect(varrimento(limpo)).toEqual(varrimento(original));
    expect(limpo.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    // Limpar outra vez não muda nada.
    expect(semMetadados(limpo, "image/jpeg")).toEqual(limpo);
  });

  it("JPEG progressivo, sem orientação: sai o EXIF todo; o que vem depois do fim (outra imagem, com o seu EXIF) também", () => {
    const original = imagem("progressivo-com-gps.jpg");
    const comCauda = Buffer.concat([original, imagem("com-gps.jpg")]);
    const limpo = semMetadados(comCauda, "image/jpeg");
    for (const s of SEGREDOS) expect(limpo.includes(s), s).toBe(false);
    expect(limpo.includes("Exif")).toBe(false);
    expect(varrimento(limpo)).toEqual(varrimento(original));
    expect(limpo.length).toBeLessThan(original.length);
  });

  it("PNG: saem os textos, o eXIf e o tIME; os blocos da imagem passam iguais", () => {
    const original = imagem("com-texto.png");
    const limpo = semMetadados(original, "image/png");
    for (const s of SEGREDOS) expect(limpo.includes(s), s).toBe(false);
    const tipos = blocosPng(limpo).map((x) => x.tipo);
    for (const t of ["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]) {
      expect(tipos).not.toContain(t);
    }
    expect(blocosPng(limpo).filter((x) => x.tipo === "IDAT")).toEqual(
      blocosPng(original).filter((x) => x.tipo === "IDAT"),
    );
    expect(tipos.at(0)).toBe("IHDR");
    expect(tipos.at(-1)).toBe("IEND");
  });

  it("WebP: saem o EXIF e o XMP, com as marcas no VP8X; o tamanho do RIFF bate", () => {
    const original = imagem("com-exif.webp");
    const limpo = semMetadados(original, "image/webp");
    for (const s of SEGREDOS) expect(limpo.includes(s), s).toBe(false);
    expect(limpo.includes("EXIF")).toBe(false);
    expect(limpo.includes("XMP ")).toBe(false);
    expect(limpo.readUInt32LE(4) + 8).toBe(limpo.length);
    const vp8x = limpo.indexOf("VP8X");
    if (vp8x >= 0) expect((limpo[vp8x + 8] ?? 0) & 0x0c).toBe(0);
  });

  it("um ficheiro que não se percorre até ao fim recusa-se", () => {
    const jpg = imagem("com-gps.jpg");
    const pngT = imagem("com-texto.png");
    const webp = imagem("com-exif.webp");
    const casos: [Buffer, "image/jpeg" | "image/png" | "image/webp"][] = [
      [jpg.subarray(0, 100), "image/jpeg"],
      [jpg.subarray(0, jpg.length - 2), "image/jpeg"],
      [pngT.subarray(0, 40), "image/png"],
      [Buffer.from("isto não é uma imagem"), "image/png"],
      [webp.subarray(0, 30), "image/webp"],
      // Um bloco crítico desconhecido num PNG.
      [
        Buffer.concat([
          pngT.subarray(0, 33),
          Buffer.from([0, 0, 0, 0]),
          Buffer.from("ABCD"),
          Buffer.from([0, 0, 0, 0]),
          pngT.subarray(33),
        ]),
        "image/png",
      ],
    ];
    for (const [b, tipo] of casos) {
      expect(() => semMetadados(b, tipo), tipo).toThrow(ErroImagem);
    }
  });
});

describe.skipIf(URL_BASE === undefined)(
  "imagens: metadados pela API e ficheiros sem uso",
  () => {
    let base: BaseDeTeste;
    let app: ReturnType<typeof criarApp>;
    let pasta: string;
    let disco: ArmazenamentoEmDisco;
    let a: string;
    let escrita: string;

    const enviar = (bytes: Buffer, tipo: string, instancia = app) =>
      instancia.inject({
        method: "POST",
        url: "/media/uploads",
        headers: {
          authorization: `Bearer ${escrita}`,
          "idempotency-key": randomUUID(),
          "content-type": tipo,
        },
        payload: bytes,
      });
    const pedir = (
      metodo: "POST" | "GET" | "DELETE",
      url: string,
      corpo?: unknown,
    ) =>
      app.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${escrita}`,
          ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
          ...(corpo === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
      });

    async function artigo() {
      const r = await pedir("POST", "/products", {
        tipo: "fisico",
        nome: "Gel UV",
        categoria_fiscal: "normal",
        variantes: [{ sku: `L-${randomUUID()}`, unidade_de_venda: "unidade" }],
      });
      expect(r.statusCode, r.body).toBe(201);
      return r.json<{ id: string }>().id;
    }
    async function enviado(bytes: Buffer, tipo = "image/png") {
      const r = await enviar(bytes, tipo);
      expect(r.statusCode, r.body).toBe(201);
      return r.json<{ id: string; bytes: number }>();
    }
    /** Envelhece a marca «sem uso» de um ficheiro (como se tivessem passado dias). */
    const envelhecer = (r: string, dias: number) =>
      sql`update ficheiro_sem_uso set desde = now() - make_interval(days => ${dias})
        where comerciante_id = ${a} and resumo = ${r}`.execute(base.dono);
    const linhas = async (r: string) => {
      const { rows } = await sql<{ f: number; s: number }>`
      select (select count(*)::int from ficheiro where comerciante_id = ${a} and resumo = ${r}) as f,
             (select count(*)::int from ficheiro_sem_uso where comerciante_id = ${a} and resumo = ${r}) as s`.execute(
        base.dono,
      );
      return rows[0];
    };
    const noDisco = (r: string) =>
      readFile(join(pasta, a, r)).then(
        () => true,
        () => false,
      );
    const limpar = (armazenamento: Armazenamento = disco) =>
      limparFicheirosSemUso(base.api, armazenamento, () => undefined);

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      pasta = await mkdtemp(join(tmpdir(), "eurolify-limpeza-"));
      disco = new ArmazenamentoEmDisco(pasta);
      app = criarApp({ logger: false }, undefined, base.api, undefined, disco);
      a = await registarComerciante(base.api, NOVO);
      const dono: Kysely<BaseDados> = base.dono;
      escrita = (
        await criarChave(dono, a, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "Escrita",
          ambitos: ["catalog:read", "catalog:write"],
        })
      ).segredo;
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await base.fechar();
      await rm(pasta, { recursive: true, force: true });
    });

    it("uma fotografia com GPS enviada pela API fica guardada sem ele e com a orientação; o resumo é o dos bytes limpos", async () => {
      const original = imagem("com-gps.jpg");
      const f = await enviado(original, "image/jpeg");
      const guardado = await readFile(join(pasta, a, f.id.slice(4)));
      expect(guardado).toEqual(semMetadados(original, "image/jpeg"));
      expect(f.id).toBe(`fil_${resumo(guardado)}`);
      expect(f.bytes).toBe(guardado.length);
      for (const s of SEGREDOS) expect(guardado.includes(s), s).toBe(false);
      // Ligada a um artigo, os bytes servidos são os limpos.
      const prd = await artigo();
      const m = await pedir("POST", `/products/${prd}/media`, {
        ficheiro: f.id,
      });
      expect(m.statusCode, m.body).toBe(201);
      const servido = await pedir(
        "GET",
        `/media/${m.json<{ id: string }>().id}/file`,
      );
      expect(servido.rawPayload).toEqual(guardado);
      // O mesmo PNG com e sem os textos é um ficheiro só.
      const comTexto = await enviado(imagem("com-texto.png"));
      const semTexto = await enviado(
        semMetadados(imagem("com-texto.png"), "image/png"),
      );
      expect(semTexto.id).toBe(comTexto.id);
    });

    it("uma imagem que não se lê até ao fim dá 400 e não deixa nada", async () => {
      const cortada = imagem("com-gps.jpg").subarray(0, 300);
      const r = await enviar(cortada, "image/jpeg");
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ codigo: "request.invalid" });
      const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from ficheiro where comerciante_id = ${a} and bytes = 300`.execute(
        base.dono,
      );
      expect(rows[0]?.n).toBe(0);
    });

    it("ligar tira o ficheiro da lista «sem uso»; desligar a última media põe-no", async () => {
      const f = await enviado(png(randomUUID()));
      const r = f.id.slice(4);
      expect(await linhas(r)).toEqual({ f: 1, s: 1 });
      const prd = await artigo();
      const m1 = (
        await pedir("POST", `/products/${prd}/media`, { ficheiro: f.id })
      ).json<{ id: string }>();
      const m2 = (
        await pedir("POST", `/products/${prd}/media`, { ficheiro: f.id })
      ).json<{ id: string }>();
      expect(await linhas(r)).toEqual({ f: 1, s: 0 });
      expect((await pedir("DELETE", `/media/${m1.id}`)).statusCode).toBe(204);
      expect(await linhas(r)).toEqual({ f: 1, s: 0 });
      expect((await pedir("DELETE", `/media/${m2.id}`)).statusCode).toBe(204);
      expect(await linhas(r)).toEqual({ f: 1, s: 1 });
    });

    it("a limpeza apaga o que está sem uso há mais de 7 dias, da tabela e do disco, e o espaço volta; o resto fica", async () => {
      const velho = (await enviado(png(randomUUID()))).id.slice(4);
      const novo = (await enviado(png(randomUUID()))).id.slice(4);
      const ligado = await enviado(png(randomUUID()));
      const prd = await artigo();
      await pedir("POST", `/products/${prd}/media`, { ficheiro: ligado.id });
      await envelhecer(velho, 8);
      await envelhecer(novo, 6);
      // Mesmo que alguém envelheça a marca de um ficheiro ligado, a base não o
      // apaga (a media usa-o).
      await sql`insert into ficheiro_sem_uso (comerciante_id, resumo, desde)
              values (${a}, ${ligado.id.slice(4)}, now() - interval '30 days')`.execute(
        base.dono,
      );
      const espaco = async () => {
        const { rows } = await sql<{ n: number }>`
        select coalesce(sum(bytes), 0)::int as n from ficheiro where comerciante_id = ${a}`.execute(
          base.dono,
        );
        return rows[0]?.n ?? 0;
      };
      const antes = await espaco();
      const r = await limpar();
      expect(r.apagados).toBe(1);
      expect(r.falhas).toBe(0);
      expect(await linhas(velho)).toEqual({ f: 0, s: 0 });
      expect(await noDisco(velho)).toBe(false);
      expect(await noDisco(novo)).toBe(true);
      expect(await noDisco(ligado.id.slice(4))).toBe(true);
      expect((await linhas(ligado.id.slice(4)))?.f).toBe(1);
      expect(await espaco()).toBeLessThan(antes);
      // Outra volta já não tem nada a apagar.
      expect((await limpar()).apagados).toBe(0);
    });

    it("se o disco falhar, a linha volta e o ficheiro fica para a volta seguinte", async () => {
      const r = (await enviado(png(randomUUID()))).id.slice(4);
      await envelhecer(r, 8);
      const falha: Armazenamento = {
        quotaPorComerciante: disco.quotaPorComerciante,
        guardar: (c, x, b) => disco.guardar(c, x, b),
        ler: (c, x) => disco.ler(c, x),
        apagar: () =>
          Promise.reject(new Error("disco sem resposta (de mentira)")),
      };
      const vistos: string[] = [];
      const res = await limparFicheirosSemUso(base.api, falha, (_c, x) =>
        vistos.push(x),
      );
      expect(res.falhas).toBe(1);
      expect(vistos).toEqual([r]);
      expect(await linhas(r)).toEqual({ f: 1, s: 1 });
      expect(await noDisco(r)).toBe(true);
      expect((await limpar()).apagados).toBe(1);
      expect(await linhas(r)).toEqual({ f: 0, s: 0 });
    });

    it("um envio dos mesmos bytes ao mesmo tempo que a limpeza acaba com a linha e o ficheiro (os dois)", async () => {
      const bytes = png(randomUUID());
      const r = (await enviado(bytes)).id.slice(4);
      await envelhecer(r, 8);
      let soltar: () => void = () => undefined;
      const portao = new Promise<void>((s) => {
        soltar = s;
      });
      let dentro: () => void = () => undefined;
      const entrou = new Promise<void>((s) => {
        dentro = s;
      });
      const lento: Armazenamento = {
        quotaPorComerciante: disco.quotaPorComerciante,
        guardar: (c, x, b) => disco.guardar(c, x, b),
        ler: (c, x) => disco.ler(c, x),
        apagar: async (c, x) => {
          dentro();
          await portao;
          await disco.apagar(c, x);
        },
      };
      const limpeza = limpar(lento);
      await entrou;
      // A limpeza tem a fila do comerciante e já apagou a linha (por
      // confirmar): o envio espera por ela.
      const envio = enviar(bytes, "image/png");
      await new Promise((s) => setTimeout(s, 200));
      soltar();
      const [res, e] = await Promise.all([limpeza, envio]);
      expect(res.apagados).toBe(1);
      expect(e.statusCode, e.body).toBe(201);
      expect((await linhas(r))?.f).toBe(1);
      expect(await noDisco(r)).toBe(true);
    });

    it("enviar outra vez um ficheiro sem uso volta a contar os 7 dias; a limpeza ao mesmo tempo espera e não o apaga", async () => {
      const bytes = png(randomUUID());
      const r = (await enviado(bytes)).id.slice(4);
      await envelhecer(r, 8);
      // Um envio que fica a meio, já com a fila do comerciante tomada.
      let soltar: () => void = () => undefined;
      const portao = new Promise<void>((s) => {
        soltar = s;
      });
      let dentro: () => void = () => undefined;
      const entrou = new Promise<void>((s) => {
        dentro = s;
      });
      const lento: Armazenamento = {
        quotaPorComerciante: disco.quotaPorComerciante,
        guardar: async (c, x, b) => {
          dentro();
          await portao;
          await disco.guardar(c, x, b);
        },
        ler: (c, x) => disco.ler(c, x),
        apagar: (c, x) => disco.apagar(c, x),
      };
      const appLento = criarApp(
        { logger: false },
        undefined,
        base.api,
        undefined,
        lento,
      );
      try {
        const envio = enviar(bytes, "image/png", appLento);
        await entrou;
        const limpeza = limpar();
        await new Promise((s) => setTimeout(s, 200));
        soltar();
        const [e, res] = await Promise.all([envio, limpeza]);
        expect(e.statusCode, e.body).toBe(201);
        expect(res.apagados).toBe(0);
        expect(await linhas(r)).toEqual({ f: 1, s: 1 });
        expect(await noDisco(r)).toBe(true);
        const { rows } = await sql<{ novo: boolean }>`
          select desde > now() - interval '1 minute' as novo from ficheiro_sem_uso
          where comerciante_id = ${a} and resumo = ${r}`.execute(base.dono);
        expect(rows[0]?.novo).toBe(true);
      } finally {
        await appLento.close();
      }
    });

    it("a API não toca na lista «sem uso»; a contagem para a verificação diária só conta os atrasados", async () => {
      // No contexto de um comerciante (sem ele, o RLS falhava antes da
      // permissão, com outro erro).
      await expect(
        comComerciante(base.api, a, (trx) =>
          sql`select count(*) from ficheiro_sem_uso`.execute(trx),
        ),
      ).rejects.toThrow(/permission denied/);
      const r = (await enviado(png(randomUUID()))).id.slice(4);
      const { rows: antes } = await sql<{
        n: string;
      }>`select ficheiros_sem_uso_em_atraso() as n`.execute(base.dono);
      await envelhecer(r, 10);
      const { rows: depois } = await sql<{
        n: string;
      }>`select ficheiros_sem_uso_em_atraso() as n`.execute(base.dono);
      expect(Number(depois[0]?.n) - Number(antes[0]?.n)).toBe(1);
    });
  },
);
