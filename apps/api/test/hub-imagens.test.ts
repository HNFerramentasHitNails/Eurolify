import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ArmazenamentoEmDisco,
  type Armazenamento,
} from "../src/catalogo/armazenamento.js";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { COOKIE, hubDeTeste } from "./hub-de-teste.js";
import { imagem, JPEG, PNG, WEBP } from "./imagens-de-teste.js";

// Enviar imagens novas pelo Hub (docs/22 §15; issue #229): os bytes em
// POST /hub/media/uploads (a única excepção à regra do JSON), a ligação em
// POST /hub/products/{id}/media e tirar em DELETE /hub/media/{id}, com as
// mesmas funções das rotas pela chave, a sessão de quem tem catalog:write e
// a pessoa como «quem fez». A base é criada sem o «quem» por omissão dos
// testes: cada escrita tem de pôr o seu. Contra o PostgreSQL 18.

const ORIGEM = "https://hub.exemplo.test";

interface Ficheiro {
  id: string;
  tipo: string;
  bytes: number;
}
interface Media {
  id: string;
  artigo: string;
  ficheiro: Ficheiro;
  texto_alternativo: string | null;
  principal: boolean;
  posicao: number;
}

describe.skipIf(URL_BASE === undefined)(
  "enviar imagens pelo Hub (#229)",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;
    let pasta: string;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
      pasta = await mkdtemp(join(tmpdir(), "eurolify-hub-imagens-"));
      h = hubDeTeste(base, { armazenamento: new ArmazenamentoEmDisco(pasta) });
    });

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
      await rm(pasta, { recursive: true, force: true });
    });

    const comChave = (
      segredo: string,
      metodo: "GET" | "POST",
      url: string,
      corpo?: Buffer | object,
      tipo = "application/json",
    ) =>
      h.app.inject({
        method: metodo,
        url,
        headers: {
          authorization: `Bearer ${segredo}`,
          ...(metodo !== "GET"
            ? { "idempotency-key": randomUUID(), "content-type": tipo }
            : {}),
        },
        ...(corpo === undefined
          ? {}
          : {
              payload: Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo),
            }),
      });

    /** Os bytes de uma imagem pelo Hub, como o navegador os manda. */
    const enviar = (
      sessao: string,
      comerciante: string,
      bytes: Buffer,
      tipo = "image/png",
      origem: string | null = ORIGEM,
      url = "/hub/media/uploads",
    ) =>
      h.app.inject({
        method: "POST",
        url,
        headers: {
          ...(origem === null ? {} : { origin: origem }),
          cookie: `${COOKIE}=${sessao}`,
          "eurolify-comerciante": `mer_${comerciante}`,
          "content-type": tipo,
        },
        payload: bytes,
      });

    /** Um comerciante com uma chave e um artigo sem imagens. */
    async function comerciante(nome: string) {
      const c = await registarComerciante(base.api, {
        nome,
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const { segredo } = await criarChave(base.dono, c, {
        tipo: "servidor",
        criadaPor: "operador:teste",
        nome: "Escrita",
        ambitos: ["catalog:read", "catalog:write"],
      });
      const r = await comChave(segredo, "POST", "/products", {
        tipo: "fisico",
        nome: "Verniz Verde",
        variantes: [{ sku: `I-${randomUUID()}`, unidade_de_venda: "unidade" }],
      });
      expect(r.statusCode, r.body).toBe(201);
      return { id: c, segredo, artigo: r.json<{ id: string }>().id };
    }

    async function quantasImagens(comercianteId: string) {
      const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from media
      where comerciante_id = ${comercianteId}::uuid`.execute(base.dono);
      return Number(rows[0]?.n);
    }

    it("o dono e o gestor enviam, ligam e tiram uma imagem; o ficheiro é o da chave (sem metadados) e a linha do tempo diz a pessoa", async () => {
      const c = await comerciante("Loja Imagens");
      const comGps = imagem("com-gps.jpg");
      // O mesmo ficheiro pela chave: o mesmo fil_ (os mesmos bytes limpos).
      const pelaChave = await comChave(
        c.segredo,
        "POST",
        "/media/uploads",
        comGps,
        "image/jpeg",
      );
      expect(pelaChave.statusCode, pelaChave.body).toBe(201);
      for (const papel of ["dono", "gestor"] as const) {
        const p = await h.pessoaCom(c.id, papel);
        const env = await enviar(p.sessao, c.id, comGps, "image/jpeg");
        expect(env.statusCode, env.body).toBe(201);
        expect(env.headers["cache-control"]).toBe("private, no-store");
        expect(env.json()).toEqual(pelaChave.json());
        expect(env.json<Ficheiro>().bytes).toBeLessThan(comGps.length);

        const ligar = await h.pedir("POST", `/hub/products/${c.artigo}/media`, {
          sessao: p.sessao,
          comerciante: c.id,
          corpo: {
            ficheiro: env.json<Ficheiro>().id,
            texto_alternativo: `Frasco (${papel})`,
            principal: true,
          },
        });
        expect(ligar.statusCode, ligar.body).toBe(201);
        const media = ligar.json<Media>();
        expect(ligar.headers.location).toBe(`/hub/media/${media.id}`);
        expect(media).toMatchObject({
          texto_alternativo: `Frasco (${papel})`,
          principal: true,
        });
        const pelaChaveMedia = await comChave(
          c.segredo,
          "GET",
          `/media/${media.id}`,
        );
        expect(media).toEqual(pelaChaveMedia.json());
        const { rows } = await sql<{ quem: string }>`
        select quem from alteracao_catalogo
        where comerciante_id = ${c.id}::uuid
          and entidade_id = ${media.id.replace(/^med_/, "")}::uuid`.execute(
          base.dono,
        );
        expect(rows.map((l) => l.quem)).toEqual([`pessoa:per_${p.pessoa}`]);

        const tirar = await h.pedir("DELETE", `/hub/media/${media.id}`, {
          sessao: p.sessao,
          comerciante: c.id,
          corpo: {},
        });
        expect(tirar.statusCode, tirar.body).toBe(204);
        expect(
          (await comChave(c.segredo, "GET", `/media/${media.id}`)).statusCode,
        ).toBe(404);
      }
    });

    it("a excepção à regra do JSON é só do envio e só com a origem do Hub", async () => {
      const c = await comerciante("Loja Imagens Origem");
      const p = await h.pessoaCom(c.id, "dono");
      // Sem a origem do Hub, ou de outro site: 403, sem ler os bytes.
      expect(
        (await enviar(p.sessao, c.id, PNG, "image/png", null)).statusCode,
      ).toBe(403);
      expect(
        (
          await enviar(
            p.sessao,
            c.id,
            PNG,
            "image/png",
            "https://outro.exemplo.test",
          )
        ).statusCode,
      ).toBe(403);
      // Bytes noutro caminho de escrita do Hub: 415, como antes.
      const noutro = await enviar(
        p.sessao,
        c.id,
        PNG,
        "image/png",
        ORIGEM,
        `/hub/products/${c.artigo}/media`,
      );
      expect(noutro.statusCode).toBe(415);
      // Texto ou formulário no envio: 415.
      for (const tipo of ["text/plain", "application/x-www-form-urlencoded"]) {
        expect((await enviar(p.sessao, c.id, PNG, tipo)).statusCode).toBe(415);
      }
      // O tipo declarado tem de bater com os bytes.
      const errado = await enviar(p.sessao, c.id, PNG, "image/jpeg");
      expect(errado.statusCode).toBe(400);
      expect(await quantasImagens(c.id)).toBe(0);
    });

    it("o armazém e o apoio não enviam, não ligam e não tiram (403); um membro que saiu e uma sessão terminada também não", async () => {
      const c = await comerciante("Loja Imagens Recusas");
      const dono = await h.pessoaCom(c.id, "dono");
      const env = await enviar(dono.sessao, c.id, PNG);
      expect(env.statusCode, env.body).toBe(201);
      const ficheiro = env.json<Ficheiro>().id;
      const ligada = await h.pedir("POST", `/hub/products/${c.artigo}/media`, {
        sessao: dono.sessao,
        comerciante: c.id,
        corpo: { ficheiro, texto_alternativo: "Frasco" },
      });
      expect(ligada.statusCode, ligada.body).toBe(201);
      const media = ligada.json<Media>().id;
      for (const papel of ["armazem", "apoio"] as const) {
        const p = await h.pessoaCom(c.id, papel);
        expect((await enviar(p.sessao, c.id, PNG)).statusCode, papel).toBe(403);
        const ligar = await h.pedir("POST", `/hub/products/${c.artigo}/media`, {
          sessao: p.sessao,
          comerciante: c.id,
          corpo: { ficheiro, texto_alternativo: "Não entra" },
        });
        expect(ligar.statusCode, papel).toBe(403);
        const tirar = await h.pedir("DELETE", `/hub/media/${media}`, {
          sessao: p.sessao,
          comerciante: c.id,
          corpo: {},
        });
        expect(tirar.statusCode, papel).toBe(403);
      }
      const gestor = await h.pessoaCom(c.id, "gestor");
      const eu = await h.pedir("GET", "/hub/me", { sessao: gestor.sessao });
      const membro =
        eu.json<{ comerciantes: { membro: string }[] }>().comerciantes[0]
          ?.membro ?? "";
      const sair = await h.pedir("POST", `/hub/members/${membro}/end`, {
        sessao: gestor.sessao,
        comerciante: c.id,
        corpo: {},
      });
      expect(sair.statusCode, sair.body).toBe(200);
      expect((await enviar(gestor.sessao, c.id, PNG)).statusCode).toBe(403);
      const fim = await h.pedir("POST", "/hub/session/end", {
        sessao: dono.sessao,
        corpo: {},
      });
      expect(fim.statusCode).toBe(200);
      expect((await enviar(dono.sessao, c.id, PNG)).statusCode).toBe(401);
      expect(await quantasImagens(c.id)).toBe(1);
    });

    it("outro comerciante não existe; o corpo da ligação recusa a variante e a posição", async () => {
      const c = await comerciante("Loja Imagens Isolamento");
      const outro = await comerciante("Loja Imagens Outra");
      const p = await h.pessoaCom(c.id, "dono");
      const env = await enviar(p.sessao, c.id, PNG);
      const ficheiro = env.json<Ficheiro>().id;
      const noOutro = await h.pedir(
        "POST",
        `/hub/products/${outro.artigo}/media`,
        {
          sessao: p.sessao,
          comerciante: c.id,
          corpo: { ficheiro, texto_alternativo: "Não entra" },
        },
      );
      expect(noOutro.statusCode).toBe(404);
      // O cabeçalho de um comerciante de que não é membro: 403.
      expect((await enviar(p.sessao, outro.id, PNG)).statusCode).toBe(403);
      for (const extra of [{ posicao: 0 }, { variante: null }]) {
        const r = await h.pedir("POST", `/hub/products/${c.artigo}/media`, {
          sessao: p.sessao,
          comerciante: c.id,
          corpo: { ficheiro, texto_alternativo: "Frasco", ...extra },
        });
        expect(r.statusCode, JSON.stringify(extra)).toBe(400);
      }
      expect(await quantasImagens(c.id)).toBe(0);
      expect(await quantasImagens(outro.id)).toBe(0);
    });

    it("acima de 10 MB dá 413; os envios ao mesmo tempo contam com os da chave: o terceiro dá 429", async () => {
      const c = await comerciante("Loja Imagens Limites");
      const p = await h.pessoaCom(c.id, "dono");
      const grande = await enviar(
        p.sessao,
        c.id,
        Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]),
      );
      expect(grande.statusCode).toBe(413);
      expect(h.codigo(grande)).toBe("payload.too_large");

      // Um armazenamento que segura a gravação: os envios ficam em curso.
      const pastaLenta = await mkdtemp(join(tmpdir(), "eurolify-hub-lenta-"));
      const disco = new ArmazenamentoEmDisco(pastaLenta);
      let soltar: () => void = () => undefined;
      const portao = new Promise<void>((r) => {
        soltar = r;
      });
      let dentro = 0;
      const lento: Armazenamento = {
        quotaPorComerciante: disco.quotaPorComerciante,
        guardar: async (cm, r, b) => {
          dentro++;
          await portao;
          await disco.guardar(cm, r, b);
        },
        ler: (cm, r) => disco.ler(cm, r),
        apagar: (cm, r) => disco.apagar(cm, r),
      };
      const hl = hubDeTeste(base, { armazenamento: lento });
      try {
        const d = await hl.pessoaCom(c.id, "dono");
        const pelaChave = hl.app.inject({
          method: "POST",
          url: "/media/uploads",
          headers: {
            authorization: `Bearer ${c.segredo}`,
            "idempotency-key": randomUUID(),
            "content-type": "image/png",
          },
          payload: PNG,
        });
        const peloHub = hl.app.inject({
          method: "POST",
          url: "/hub/media/uploads",
          headers: {
            origin: ORIGEM,
            cookie: `${COOKIE}=${d.sessao}`,
            "eurolify-comerciante": `mer_${c.id}`,
            "content-type": "image/jpeg",
          },
          payload: JPEG,
        });
        for (let i = 0; i < 100 && dentro < 1; i++) {
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(dentro).toBe(1);
        await new Promise((r) => setTimeout(r, 100));
        const terceiro = await hl.app.inject({
          method: "POST",
          url: "/hub/media/uploads",
          headers: {
            origin: ORIGEM,
            cookie: `${COOKIE}=${d.sessao}`,
            "eurolify-comerciante": `mer_${c.id}`,
            "content-type": "image/webp",
          },
          payload: WEBP,
        });
        expect(terceiro.statusCode, terceiro.body).toBe(429);
        expect(terceiro.headers["retry-after"]).toBe("1");
        soltar();
        expect((await pelaChave).statusCode).toBe(201);
        expect((await peloHub).statusCode).toBe(201);
      } finally {
        soltar();
        await hl.app.close();
        await rm(pastaLenta, { recursive: true, force: true });
      }
    });

    it("o contrato tem os três caminhos com a sessão e as mesmas respostas da chave", async () => {
      const contrato = (await h.app.inject({ url: "/openapi.json" })).json<{
        paths: Record<
          string,
          Record<string, { security?: unknown; responses?: unknown }>
        >;
      }>();
      for (const [hub, api, metodo] of [
        ["/hub/media/uploads", "/media/uploads", "post"],
        ["/hub/products/{id}/media", "/products/{id}/media", "post"],
        ["/hub/media/{id}", "/media/{id}", "delete"],
      ] as const) {
        const doHub = contrato.paths[hub]?.[metodo];
        expect(doHub?.security, hub).toEqual([{ sessao: [] }]);
        expect(JSON.stringify(doHub?.responses), hub).toBe(
          JSON.stringify(contrato.paths[api]?.[metodo]?.responses),
        );
      }
    });
  },
);
