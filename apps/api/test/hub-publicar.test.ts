import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  criarEntidadeLegal,
  criarLoja,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarCanal,
  criarLista,
  criarMercado,
  definirMercadosDoCanal,
  mudarEstadoMercado,
} from "../src/precos/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// Publicar um artigo pelo Hub (docs/22 §27; issue #378): os pares de venda,
// a verificação, publicar e retirar, com as mesmas funções da chave, a
// sessão de quem tem catalog:publish e a `versao` lida. Contra o
// PostgreSQL 18.

const ENTIDADE = {
  denominacao: "Exemplo, Lda.",
  forma_juridica: "sociedade por quotas",
  pais: "PT",
  numero_fiscal: "123456789",
  morada_linha: "Rua de Teste, 1",
  morada_codigo_postal: "1000-001",
  morada_localidade: "Lisboa",
};

interface Publicacao {
  id: string;
  estado: string;
  variantes_fora: string[];
  versao: number;
}
interface RespostaPublicar {
  publicada: boolean;
  verificacao: { impedimentos: { codigo: string }[]; nao_verificado: string[] };
  publicacao: Publicacao | null;
}

describe.skipIf(URL_BASE === undefined)(
  "publicar um artigo pelo Hub (#378)",
  () => {
    let base: BaseDeTeste;
    let h: ReturnType<typeof hubDeTeste>;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
      h = hubDeTeste(base);
    }, 60_000);

    afterAll(async () => {
      await h.app.close();
      await base.fechar();
    });

    const chave = (
      segredo: string,
      metodo: "GET" | "POST" | "PUT",
      url: string,
      corpo?: unknown,
    ) =>
      h.app.inject({
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

    /**
     * Um comerciante com o mercado «Portugal» activo, a lista «Base PT», um
     * canal que vende nele e um artigo activo de duas variantes com peso e
     * preço; o dono no Hub. `semPreco` deixa a segunda variante sem preço.
     */
    async function comerciante(nome: string, semPreco = false) {
      const id = await registarComerciante(base.api, {
        nome,
        lingua: "pt",
        fuso: "Europe/Lisbon",
      });
      const segredo = (
        await criarChave(base.dono, id, {
          tipo: "servidor",
          criadaPor: "operador:teste",
          nome: "escrever",
          ambitos: [
            "catalog:read",
            "catalog:write",
            "catalog:publish",
            "prices:read",
            "prices:write",
          ] as never,
        })
      ).segredo;
      const entidade = await criarEntidadeLegal(base.api, id, ENTIDADE);
      const loja = await criarLoja(base.api, id, {
        entidade_legal_id: entidade,
        nome: "Loja online",
      });
      const mercado = await criarMercado(base.api, id, {
        loja_id: loja,
        nome: "Portugal",
        paises: ["PT"],
        moeda: "EUR",
        linguas: ["pt"],
        lingua_principal: "pt",
      });
      const lista = await criarLista(base.api, id, {
        mercado_id: mercado,
        nome: "Base PT",
        tipo: "base",
      });
      await mudarEstadoMercado(base.api, id, mercado, 1, "activo");
      const canal = await criarCanal(base.api, id, {
        loja_id: loja,
        nome: "Loja online",
      });
      await definirMercadosDoCanal(base.api, id, canal, [mercado]);
      const r = await chave(segredo, "POST", "/products", {
        tipo: "fisico",
        nome: "Gel Coral 41",
        categoria_fiscal: "normal",
        variantes: [
          {
            sku: `ENS-041-${randomUUID()}`,
            unidade_de_venda: "unidade",
            peso_g: 60,
          },
          {
            sku: `ENS-041-B-${randomUUID()}`,
            unidade_de_venda: "caixa",
            peso_g: 400,
          },
        ],
      });
      expect(r.statusCode, r.body).toBe(201);
      let f = r.json<{
        id: string;
        versao: number;
        variantes: { id: string }[];
      }>();
      const cl = await chave(
        segredo,
        "PUT",
        `/products/${f.id}/classification`,
        {
          versao: f.versao,
          familias: ["retalho_geral"],
          natureza_consumidor: "bem",
        },
      );
      expect(cl.statusCode, cl.body).toBe(200);
      const a = await chave(segredo, "POST", `/products/${f.id}/activate`, {
        versao: cl.json<{ versao: number }>().versao,
      });
      expect(a.statusCode, a.body).toBe(200);
      f = a.json();
      const v1 = f.variantes[0]?.id ?? "";
      const v2 = f.variantes[1]?.id ?? "";
      for (const v of semPreco ? [v1] : [v1, v2]) {
        const p = await chave(
          segredo,
          "PUT",
          `/price-lists/prl_${lista}/prices/${v}`,
          { montante: 1290 },
        );
        expect(p.statusCode, p.body).toBe(200);
      }
      return {
        id,
        segredo,
        artigo: f.id,
        v1,
        v2,
        mercado: `mkt_${mercado}`,
        canal: `chn_${canal}`,
        dono: await h.pessoaCom(id, "dono"),
      };
    }
    type C = Awaited<ReturnType<typeof comerciante>>;

    const verificar = (c: C, sessao: string, fora: string[] = []) =>
      h.pedir("POST", `/hub/products/${c.artigo}/publications/check`, {
        sessao,
        comerciante: c.id,
        corpo: { canal: c.canal, mercado: c.mercado, variantes_fora: fora },
      });
    const publicarNoHub = (
      c: C,
      sessao: string,
      versao: number | null,
      fora: string[] = [],
    ) =>
      h.pedir("POST", `/hub/products/${c.artigo}/publications`, {
        sessao,
        comerciante: c.id,
        corpo: {
          canal: c.canal,
          mercado: c.mercado,
          variantes_fora: fora,
          versao,
        },
      });
    const retirarNoHub = (c: C, sessao: string, id: string, versao: number) =>
      h.pedir("POST", `/hub/publications/${id}/archive`, {
        sessao,
        comerciante: c.id,
        corpo: { versao },
      });

    it("os pares de venda: o canal e o mercado com os nomes, a quem lê o catálogo", async () => {
      const c = await comerciante("Pares");
      const apoio = await h.pessoaCom(c.id, "apoio");
      const r = await h.pedir("GET", "/hub/sales-pairs", {
        sessao: apoio.sessao,
        comerciante: c.id,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toEqual({
        dados: [
          {
            canal: c.canal,
            canal_nome: "Loja online",
            canal_estado: "activo",
            mercado: c.mercado,
            mercado_nome: "Portugal",
            mercado_estado: "activo",
            loja_nome: "Loja online",
          },
        ],
      });
      // Outro comerciante não vê estes pares (prova pela falha: o mesmo
      // pedido com o comerciante certo vê-os).
      const outro = await comerciante("Pares, outro");
      const deOutro = await h.pedir("GET", "/hub/sales-pairs", {
        sessao: outro.dono.sessao,
        comerciante: outro.id,
      });
      expect(
        deOutro
          .json<{ dados: { canal: string }[] }>()
          .dados.map((p) => p.canal),
      ).toEqual([outro.canal]);
    });

    it("verificar, publicar com a versão nula, refazer com a versão lida e retirar; quem fez é a pessoa", async () => {
      const c = await comerciante("Publicar");
      const v = await verificar(c, c.dono.sessao, [c.v2]);
      expect(v.statusCode, v.body).toBe(200);
      expect(v.json()).toMatchObject({
        impedimentos: [],
        nao_verificado: expect.arrayContaining(["conformidade"]) as unknown,
      });

      const p1 = await publicarNoHub(c, c.dono.sessao, null, [c.v2]);
      expect(p1.statusCode, p1.body).toBe(200);
      const r1 = p1.json<RespostaPublicar>();
      expect(r1.publicada).toBe(true);
      expect(r1.publicacao?.estado).toBe("publicado");
      expect(r1.publicacao?.variantes_fora).toEqual([c.v2]);
      const pub = r1.publicacao as Publicacao;

      // Refazer com a ENS-041-B à venda, na versão lida.
      const p2 = await publicarNoHub(c, c.dono.sessao, pub.versao, []);
      expect(p2.statusCode, p2.body).toBe(200);
      const r2 = p2.json<RespostaPublicar>();
      expect(r2.publicada).toBe(true);
      expect(r2.publicacao?.variantes_fora).toEqual([]);

      const quem = `pessoa:per_${c.dono.pessoa}`;
      const { rows: depois } = await sql<{ publicado_por: string }>`
        select publicado_por from publicacao where id = ${pub.id.slice(4)}::uuid`.execute(
        base.dono,
      );
      expect(depois[0]?.publicado_por).toBe(quem);

      const rt = await retirarNoHub(
        c,
        c.dono.sessao,
        pub.id,
        (r2.publicacao as Publicacao).versao,
      );
      expect(rt.statusCode, rt.body).toBe(200);
      expect(
        rt.json<{ estado: string; motivo_arquivo: string }>(),
      ).toMatchObject({ estado: "arquivado", motivo_arquivo: "retirada" });
      const { rows: retirada } = await sql<{ arquivado_por: string }>`
        select arquivado_por from publicacao where id = ${pub.id.slice(4)}::uuid`.execute(
        base.dono,
      );
      expect(retirada[0]?.arquivado_por).toBe(quem);
    });

    it("a versão: outra guardada, ou nula numa que já existe, ou um número numa que não existe, dá 409 sem escrever", async () => {
      const c = await comerciante("Versao");
      // Um número quando ainda não há publicação: 409, e nem o rascunho fica.
      const semLinha = await publicarNoHub(c, c.dono.sessao, 1, []);
      expect(semLinha.statusCode, semLinha.body).toBe(409);
      expect(h.codigo(semLinha)).toBe("catalog.version_conflict");
      const { rows: nenhuma } = await sql<{ n: number }>`
        select count(*)::int as n from publicacao
        where artigo_id = ${c.artigo.slice(4)}::uuid`.execute(base.dono);
      expect(nenhuma[0]?.n).toBe(0);

      const p1 = await publicarNoHub(c, c.dono.sessao, null, [c.v2]);
      const pub = p1.json<RespostaPublicar>().publicacao as Publicacao;
      // Nula numa que já existe.
      const nula = await publicarNoHub(c, c.dono.sessao, null, []);
      expect(nula.statusCode, nula.body).toBe(409);
      expect(h.codigo(nula)).toBe("catalog.version_conflict");
      // Uma versão antiga.
      const antiga = await publicarNoHub(c, c.dono.sessao, pub.versao - 1, []);
      expect(antiga.statusCode, antiga.body).toBe(409);
      const retirarAntiga = await retirarNoHub(
        c,
        c.dono.sessao,
        pub.id,
        pub.versao + 1,
      );
      expect(retirarAntiga.statusCode, retirarAntiga.body).toBe(409);
      expect(h.codigo(retirarAntiga)).toBe("catalog.version_conflict");
      // Nada mudou: continua publicada, com a ENS-041-B fora, na mesma versão.
      const lidas = await h.pedir(
        "GET",
        `/hub/products/${c.artigo}/publications`,
        { sessao: c.dono.sessao, comerciante: c.id },
      );
      expect(lidas.json<{ dados: Publicacao[] }>().dados).toMatchObject([
        { estado: "publicado", variantes_fora: [c.v2], versao: pub.versao },
      ]);
    });

    it("com impedimentos responde publicada: false sem mudar o estado nem as variantes", async () => {
      const c = await comerciante("Impedimentos", true);
      const p1 = await publicarNoHub(c, c.dono.sessao, null, [c.v2]);
      const pub = p1.json<RespostaPublicar>().publicacao as Publicacao;
      expect(pub.estado).toBe("publicado");
      // Pôr à venda a ENS-041-B, que não tem preço: não pode.
      const v = await verificar(c, c.dono.sessao, []);
      expect(
        v
          .json<{ impedimentos: { codigo: string }[] }>()
          .impedimentos.map((i) => i.codigo),
      ).toEqual(["preco_em_falta"]);
      const p2 = await publicarNoHub(c, c.dono.sessao, pub.versao, []);
      expect(p2.statusCode, p2.body).toBe(200);
      const r2 = p2.json<RespostaPublicar>();
      expect(r2.publicada).toBe(false);
      expect(r2.verificacao.impedimentos.map((i) => i.codigo)).toEqual([
        "preco_em_falta",
      ]);
      expect(r2.publicacao).toMatchObject({
        estado: "publicado",
        variantes_fora: [c.v2],
      });
    });

    it("o armazém e o apoio verificam, mas não publicam nem retiram (403)", async () => {
      const c = await comerciante("Papeis");
      const p1 = await publicarNoHub(c, c.dono.sessao, null, []);
      const pub = p1.json<RespostaPublicar>().publicacao as Publicacao;
      for (const papel of ["armazem", "apoio"] as const) {
        const p = await h.pessoaCom(c.id, papel);
        const v = await verificar(c, p.sessao);
        expect(v.statusCode, `${papel}: ${v.body}`).toBe(200);
        const pb = await publicarNoHub(c, p.sessao, pub.versao, []);
        expect(pb.statusCode, `${papel}: ${pb.body}`).toBe(403);
        const rt = await retirarNoHub(c, p.sessao, pub.id, pub.versao);
        expect(rt.statusCode, `${papel}: ${rt.body}`).toBe(403);
      }
      const gestor = await h.pessoaCom(c.id, "gestor");
      const rt = await retirarNoHub(c, gestor.sessao, pub.id, pub.versao);
      expect(rt.statusCode, rt.body).toBe(200);
    });

    it("outro comerciante não chega ao artigo nem à publicação (404)", async () => {
      const c = await comerciante("Isolamento");
      const outro = await comerciante("Isolamento, outro");
      const p1 = await publicarNoHub(c, c.dono.sessao, null, []);
      const pub = p1.json<RespostaPublicar>().publicacao as Publicacao;
      // O dono do outro, com o comerciante dele, pede o artigo e a
      // publicação deste: não existem para ele.
      const v = await h.pedir(
        "POST",
        `/hub/products/${c.artigo}/publications/check`,
        {
          sessao: outro.dono.sessao,
          comerciante: outro.id,
          corpo: { canal: outro.canal, mercado: outro.mercado },
        },
      );
      expect(v.statusCode, v.body).toBe(404);
      const rt = await retirarNoHub(
        outro,
        outro.dono.sessao,
        pub.id,
        pub.versao,
      );
      expect(rt.statusCode, rt.body).toBe(404);
      // Prova pela falha: o mesmo pedido com o comerciante certo retira.
      const certo = await retirarNoHub(c, c.dono.sessao, pub.id, pub.versao);
      expect(certo.statusCode, certo.body).toBe(200);
    });
  },
);
