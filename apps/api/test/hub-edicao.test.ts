import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArmazenamentoEmDisco } from "../src/catalogo/armazenamento.js";
import { criarArtigo } from "../src/catalogo/repositorio.js";
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
import { hubDeTeste } from "./hub-de-teste.js";

// Editar o artigo pelo Hub (docs/22 §13; issue #210): as mesmas funções das
// rotas pela chave, com a sessão de quem tem catalog:write e a pessoa como
// «quem fez» na linha do tempo (docs/14 §3.12). A base é criada sem o «quem»
// por omissão dos testes: cada escrita tem de pôr o seu. Contra o
// PostgreSQL 18.

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("resto do png"),
]);

interface Ficha {
  id: string;
  nome: string;
  descricao: string | null;
  marca: string | null;
  estado: string;
  versao: number;
  variantes: { id: string; estado: string }[];
}

describe.skipIf(URL_BASE === undefined)("editar o artigo no Hub (#210)", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;
  let pasta: string;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
    pasta = await mkdtemp(join(tmpdir(), "eurolify-hub-edicao-"));
    h = hubDeTeste(base, { armazenamento: new ArmazenamentoEmDisco(pasta) });
  });

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
    await rm(pasta, { recursive: true, force: true });
  });

  const comChave = (
    segredo: string,
    metodo: "GET" | "POST" | "PATCH",
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

  /** Um comerciante com uma chave, um artigo com duas variantes e uma imagem sem texto. */
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
      nome: "Verniz Rosa",
      marca: "Marca de Ensaio",
      categoria_fiscal: "normal",
      variantes: [
        { sku: `E-${randomUUID()}`, unidade_de_venda: "unidade" },
        { sku: `E-${randomUUID()}`, unidade_de_venda: "caixa" },
      ],
    });
    expect(r.statusCode, r.body).toBe(201);
    const artigo = r.json<Ficha>();
    const f = await comChave(
      segredo,
      "POST",
      "/media/uploads",
      PNG,
      "image/png",
    );
    expect(f.statusCode, f.body).toBe(201);
    const m = await comChave(segredo, "POST", `/products/${artigo.id}/media`, {
      ficheiro: f.json<{ id: string }>().id,
    });
    expect(m.statusCode, m.body).toBe(201);
    return {
      id: c,
      segredo,
      artigo,
      imagem: m.json<{ id: string; versao: number }>(),
    };
  }

  /** As entradas da linha do tempo de uma linha, com o «quem». */
  async function quemMudou(comercianteId: string, entidadeId: string) {
    const { rows } = await sql<{ quem: string; operacao: string }>`
      select quem, operacao from alteracao_catalogo
      where comerciante_id = ${comercianteId}::uuid
        and entidade_id = ${entidadeId}::uuid
      order by id`.execute(base.dono);
    return rows;
  }

  it("o dono e o gestor alteram o nome, a descrição e a marca; o resultado é o da chave e a linha do tempo diz a pessoa", async () => {
    const c = await comerciante("Loja Edicao");
    for (const papel of ["dono", "gestor"] as const) {
      const p = await h.pessoaCom(c.id, papel);
      const antes = (
        await comChave(c.segredo, "GET", `/products/${c.artigo.id}`)
      ).json<Ficha>();
      const r = await h.pedir("PATCH", `/hub/products/${c.artigo.id}`, {
        sessao: p.sessao,
        comerciante: c.id,
        corpo: {
          versao: antes.versao,
          nome: `Verniz Rosa (${papel})`,
          descricao: "Secagem rápida.",
          marca: null,
        },
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.headers["cache-control"]).toBe("private, no-store");
      const depois = await comChave(
        c.segredo,
        "GET",
        `/products/${c.artigo.id}`,
      );
      expect(r.json()).toEqual(depois.json());
      expect(depois.json<Ficha>()).toMatchObject({
        nome: `Verniz Rosa (${papel})`,
        descricao: "Secagem rápida.",
        marca: null,
      });
      const entradas = await quemMudou(c.id, c.artigo.id.replace(/^prd_/, ""));
      expect(entradas.at(-1)?.quem).toBe(`pessoa:per_${p.pessoa}`);
    }
  });

  it("o armazém e o apoio não escrevem: 403 em todos os caminhos e nada muda", async () => {
    const c = await comerciante("Loja Edicao Sem Escrita");
    const varianteId = c.artigo.variantes[0]?.id ?? "";
    for (const papel of ["armazem", "apoio"] as const) {
      const p = await h.pessoaCom(c.id, papel);
      const pedidos = [
        h.pedir("PATCH", `/hub/products/${c.artigo.id}`, {
          sessao: p.sessao,
          comerciante: c.id,
          corpo: { versao: c.artigo.versao, nome: "Não entra" },
        }),
        h.pedir("POST", `/hub/products/${c.artigo.id}/activate`, {
          sessao: p.sessao,
          comerciante: c.id,
          corpo: { versao: c.artigo.versao },
        }),
        h.pedir("POST", `/hub/variants/${varianteId}/archive`, {
          sessao: p.sessao,
          comerciante: c.id,
          corpo: {},
        }),
        h.pedir("PATCH", `/hub/media/${c.imagem.id}`, {
          sessao: p.sessao,
          comerciante: c.id,
          corpo: { versao: c.imagem.versao, texto_alternativo: "Não entra" },
        }),
      ];
      for (const r of await Promise.all(pedidos)) {
        expect(r.statusCode, r.body).toBe(403);
      }
    }
    const depois = (
      await comChave(c.segredo, "GET", `/products/${c.artigo.id}`)
    ).json<Ficha>();
    expect(depois).toMatchObject({ nome: "Verniz Rosa", estado: "rascunho" });
    expect(depois.variantes.every((v) => v.estado === "activa")).toBe(true);
  });

  it("activar, arquivar e repor; arquivar uma variante com {}; o texto alternativo da imagem", async () => {
    const c = await comerciante("Loja Edicao Estados");
    const p = await h.pessoaCom(c.id, "gestor");
    const comSessao = { sessao: p.sessao, comerciante: c.id };
    let versao = c.artigo.versao;
    for (const [caminho, estado] of [
      ["activate", "activo"],
      ["archive", "arquivado"],
      ["restore", "activo"],
    ] as const) {
      const r = await h.pedir(
        "POST",
        `/hub/products/${c.artigo.id}/${caminho}`,
        {
          ...comSessao,
          corpo: { versao },
        },
      );
      expect(r.statusCode, `${caminho}: ${r.body}`).toBe(200);
      expect(r.json<Ficha>().estado).toBe(estado);
      versao = r.json<Ficha>().versao;
    }
    const variante = c.artigo.variantes[1]?.id ?? "";
    const comCorpo = await h.pedir(
      "POST",
      `/hub/variants/${variante}/archive`,
      {
        ...comSessao,
        corpo: { motivo: "não aceita campos" },
      },
    );
    expect(comCorpo.statusCode).toBe(400);
    const v = await h.pedir("POST", `/hub/variants/${variante}/archive`, {
      ...comSessao,
      corpo: {},
    });
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json<{ estado: string }>().estado).toBe("arquivada");
    const m = await h.pedir("PATCH", `/hub/media/${c.imagem.id}`, {
      ...comSessao,
      corpo: {
        versao: c.imagem.versao,
        texto_alternativo: "Frasco de verniz rosa",
      },
    });
    expect(m.statusCode, m.body).toBe(200);
    const pelaChave = await comChave(c.segredo, "GET", `/media/${c.imagem.id}`);
    expect(m.json()).toEqual(pelaChave.json());
    expect(
      (await quemMudou(c.id, c.imagem.id.replace(/^med_/, ""))).at(-1)?.quem,
    ).toBe(`pessoa:per_${p.pessoa}`);
  });

  it("uma versão antiga dá 409 e não grava; outro comerciante não existe; sem a origem do Hub ou sem JSON é recusado", async () => {
    const c = await comerciante("Loja Edicao Conflito");
    const outro = await comerciante("Loja Edicao Outra");
    const p = await h.pessoaCom(c.id, "dono");
    const comSessao = { sessao: p.sessao, comerciante: c.id };
    const primeira = await h.pedir("PATCH", `/hub/products/${c.artigo.id}`, {
      ...comSessao,
      corpo: { versao: c.artigo.versao, nome: "Primeira" },
    });
    expect(primeira.statusCode, primeira.body).toBe(200);
    // A mesma versão outra vez (a resposta perdida, ou outra pessoa).
    const segunda = await h.pedir("PATCH", `/hub/products/${c.artigo.id}`, {
      ...comSessao,
      corpo: { versao: c.artigo.versao, nome: "Segunda" },
    });
    expect(segunda.statusCode).toBe(409);
    expect(h.codigo(segunda)).toBe("catalog.version_conflict");
    expect(
      (
        await comChave(c.segredo, "GET", `/products/${c.artigo.id}`)
      ).json<Ficha>().nome,
    ).toBe("Primeira");
    // O artigo de outro comerciante, com o cabeçalho deste: não existe.
    const deOutro = await h.pedir("PATCH", `/hub/products/${outro.artigo.id}`, {
      ...comSessao,
      corpo: { versao: outro.artigo.versao, nome: "Não entra" },
    });
    expect(deOutro.statusCode).toBe(404);
    const imagemDeOutro = await h.pedir(
      "PATCH",
      `/hub/media/${outro.imagem.id}`,
      {
        ...comSessao,
        corpo: { versao: outro.imagem.versao, texto_alternativo: "Não entra" },
      },
    );
    expect(imagemDeOutro.statusCode).toBe(404);
    expect(
      (
        await comChave(outro.segredo, "GET", `/products/${outro.artigo.id}`)
      ).json<Ficha>().nome,
    ).toBe("Verniz Rosa");
    // Sem a origem do Hub (CSRF, docs/21 §3).
    const semOrigem = await h.pedir("PATCH", `/hub/products/${c.artigo.id}`, {
      ...comSessao,
      origem: null,
      corpo: { versao: 2, nome: "Não entra" },
    });
    expect(semOrigem.statusCode).toBe(403);
    // Sem JSON.
    const semJson = await h.app.inject({
      method: "PATCH",
      url: `/hub/products/${c.artigo.id}`,
      headers: {
        origin: "https://hub.exemplo.test",
        cookie: `__Host-eurolify_sessao=${p.sessao}`,
        "eurolify-comerciante": `mer_${c.id}`,
        "content-type": "text/plain",
      },
      payload: "nome=Não entra",
    });
    expect(semJson.statusCode).toBe(415);
  });

  it("num artigo do sistema de gestão (P5), o Hub não muda os campos de lá; a imagem sim; a chave continua a escrever", async () => {
    const c = await comerciante("Loja Edicao Externo");
    const id = await comComerciante(base.api, c.id, async (trx) => {
      await sql`select set_config('eurolify.quem', 'teste:preparar', true)`.execute(
        trx,
      );
      return criarArtigo(
        trx,
        c.id,
        {
          tipo: "fisico",
          nome: "Verniz da Gestão",
          categoria_fiscal: "normal",
          origem_ref: "GESTAO-001",
        },
        [{ sku: `G-${randomUUID()}`, unidade_de_venda: "unidade" }],
      );
    });
    const externo = (
      await comChave(c.segredo, "GET", `/products/prd_${id}`)
    ).json<Ficha>();
    const p = await h.pessoaCom(c.id, "dono");
    const comSessao = { sessao: p.sessao, comerciante: c.id };
    const recusas = [
      await h.pedir("PATCH", `/hub/products/${externo.id}`, {
        ...comSessao,
        corpo: { versao: externo.versao, nome: "Não entra" },
      }),
      await h.pedir("POST", `/hub/products/${externo.id}/activate`, {
        ...comSessao,
        corpo: { versao: externo.versao },
      }),
      await h.pedir(
        "POST",
        `/hub/variants/${externo.variantes[0]?.id ?? ""}/archive`,
        {
          ...comSessao,
          corpo: {},
        },
      ),
    ];
    for (const r of recusas) {
      expect(r.statusCode, r.body).toBe(409);
      expect(h.codigo(r)).toBe("catalog.external_field");
    }
    // A imagem edita-se no Eurolify também num artigo externo (§13.3).
    const f = await comChave(
      c.segredo,
      "POST",
      "/media/uploads",
      PNG,
      "image/png",
    );
    const m = await comChave(
      c.segredo,
      "POST",
      `/products/${externo.id}/media`,
      {
        ficheiro: f.json<{ id: string }>().id,
      },
    );
    expect(m.statusCode, m.body).toBe(201);
    const alt = await h.pedir(
      "PATCH",
      `/hub/media/${m.json<{ id: string }>().id}`,
      {
        ...comSessao,
        corpo: {
          versao: m.json<{ versao: number }>().versao,
          texto_alternativo: "Frasco da gestão",
        },
      },
    );
    expect(alt.statusCode, alt.body).toBe(200);
    // O sistema de gestão continua a escrever pela chave.
    const pelaChave = await comChave(
      c.segredo,
      "PATCH",
      `/products/${externo.id}`,
      {
        versao: externo.versao,
        nome: "Verniz da Gestão (novo)",
      },
    );
    expect(pelaChave.statusCode, pelaChave.body).toBe(200);
  });

  it("a categoria fiscal não se muda pelo Hub (400); pela chave sim (revisão do #217, P1-1)", async () => {
    const c = await comerciante("Loja Edicao Fiscal");
    const p = await h.pessoaCom(c.id, "dono");
    const r = await h.pedir("PATCH", `/hub/products/${c.artigo.id}`, {
      sessao: p.sessao,
      comerciante: c.id,
      corpo: { versao: c.artigo.versao, categoria_fiscal: "isento" },
    });
    expect(r.statusCode).toBe(400);
    const ficha = await comChave(c.segredo, "GET", `/products/${c.artigo.id}`);
    expect(ficha.json<{ categoria_fiscal: string }>().categoria_fiscal).toBe(
      "normal",
    );
    const pelaChave = await comChave(
      c.segredo,
      "PATCH",
      `/products/${c.artigo.id}`,
      { versao: c.artigo.versao, categoria_fiscal: "isento" },
    );
    expect(pelaChave.statusCode, pelaChave.body).toBe(200);
  });

  it("um membro que saiu e uma sessão terminada não escrevem (revisão do #217, P3-9)", async () => {
    const c = await comerciante("Loja Edicao Saida");
    const alterar = (sessao: string) =>
      h.pedir("PATCH", `/hub/products/${c.artigo.id}`, {
        sessao,
        comerciante: c.id,
        corpo: { versao: c.artigo.versao, nome: "Não entra" },
      });
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
    expect((await alterar(gestor.sessao)).statusCode).toBe(403);
    const dono = await h.pessoaCom(c.id, "dono");
    const fim = await h.pedir("POST", "/hub/session/end", {
      sessao: dono.sessao,
      corpo: {},
    });
    expect(fim.statusCode).toBe(200);
    expect((await alterar(dono.sessao)).statusCode).toBe(401);
    const ficha = await comChave(c.segredo, "GET", `/products/${c.artigo.id}`);
    expect(ficha.json<Ficha>().nome).toBe("Verniz Rosa");
  });

  it("o contrato tem os caminhos de escrita do Hub com a sessão e as mesmas respostas da chave", async () => {
    const contrato = (await h.app.inject({ url: "/openapi.json" })).json<{
      paths: Record<
        string,
        Record<string, { security?: unknown; responses?: unknown }>
      >;
    }>();
    for (const [hub, api, metodo] of [
      ["/hub/products/{id}", "/products/{id}", "patch"],
      ["/hub/products/{id}/activate", "/products/{id}/activate", "post"],
      ["/hub/products/{id}/archive", "/products/{id}/archive", "post"],
      ["/hub/products/{id}/restore", "/products/{id}/restore", "post"],
      ["/hub/variants/{id}/archive", "/variants/{id}/archive", "post"],
      ["/hub/media/{id}", "/media/{id}", "patch"],
    ] as const) {
      const doHub = contrato.paths[hub]?.[metodo];
      expect(doHub?.security, hub).toEqual([{ sessao: [] }]);
      expect(JSON.stringify(doHub?.responses), hub).toBe(
        JSON.stringify(contrato.paths[api]?.[metodo]?.responses),
      );
    }
  });
});
