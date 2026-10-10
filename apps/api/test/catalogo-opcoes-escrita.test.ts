import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BaseDados } from "../src/base/esquema.js";
import {
  apagarOpcao,
  apagarValor,
  definirValoresNoRascunho,
  mudarNomeDaOpcao,
  mudarTextoDoValor,
  ordenarOpcoes,
  ordenarValores,
} from "../src/catalogo/opcoes-escrita.js";
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

// A escrita das opções (docs/14 §7.1, «A escrita das opções»; docs/22 §21;
// issue #285): as rotas pela chave e as /hub/, contra o PostgreSQL 18.

interface Opcao {
  id: string;
  artigo: string;
  nome: string;
  posicao: number;
  versao: number;
  valores: { id: string; valor: string }[];
}
interface Ficha {
  id: string;
  versao: number;
  estado: string;
  variantes: { id: string; sku: string }[];
}

describe.skipIf(URL_BASE === undefined)("a escrita das opções (#285)", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;

  /** Um comerciante com uma chave de escrita. */
  async function comerciante(nome: string) {
    const id = await registarComerciante(base.api, {
      nome,
      lingua: "pt",
      fuso: "Europe/Lisbon",
    });
    const { segredo } = await criarChave(base.dono, id, {
      tipo: "servidor",
      criadaPor: "operador:teste",
      nome: "Escrita",
      ambitos: ["catalog:read", "catalog:write", "catalog:history"],
    });
    return { id, segredo };
  }

  const chave = (
    segredo: string,
    metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    corpo?: unknown,
  ) =>
    h.app.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${segredo}`,
        ...(metodo === "GET" ? {} : { "idempotency-key": randomUUID() }),
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });

  /**
   * Um rascunho com duas variantes e as opções «Tamanho» (15 ml, 30 ml) e
   * «Cor» (Azul, Rosa); a primeira variante 15 ml azul, a segunda 15 ml rosa.
   */
  async function rascunho(c: { id: string; segredo: string }) {
    const r = await chave(c.segredo, "POST", "/products", {
      tipo: "fisico",
      nome: "Verniz Verde 31",
      categoria_fiscal: "normal",
      variantes: [
        { sku: `ENS-${randomUUID()}`, unidade_de_venda: "unidade", peso_g: 60 },
        { sku: `ENS-${randomUUID()}`, unidade_de_venda: "unidade", peso_g: 60 },
      ],
    });
    expect(r.statusCode, r.body).toBe(201);
    const ficha = r.json<Ficha>();
    const opcao = async (nome: string, valores: string[]) => {
      const o = await chave(
        c.segredo,
        "POST",
        `/products/${ficha.id}/options`,
        {
          nome,
          valores,
        },
      );
      expect(o.statusCode, o.body).toBe(201);
      return o.json<Opcao>();
    };
    const tamanho = await opcao("Tamanho", ["15 ml", "30 ml"]);
    const cor = await opcao("Cor", ["Azul", "Rosa"]);
    const [v1, v2] = ficha.variantes;
    const valor = (o: Opcao, i: number) => o.valores[i]?.id ?? "";
    for (const [v, valores] of [
      [v1, [valor(tamanho, 0), valor(cor, 0)]],
      [v2, [valor(tamanho, 0), valor(cor, 1)]],
    ] as const) {
      const d = await chave(
        c.segredo,
        "PUT",
        `/variants/${v?.id ?? ""}/values`,
        {
          valores,
        },
      );
      expect(d.statusCode, d.body).toBe(200);
      expect(d.json<{ valores: string[] }>().valores).toEqual(valores);
    }
    return {
      artigo: ficha.id,
      variantes: ficha.variantes.map((v) => v.id),
      tamanho,
      cor,
    };
  }

  /** Classifica e activa o artigo pela chave. */
  async function activar(segredo: string, artigo: string) {
    const f = (
      await chave(segredo, "GET", `/products/${artigo}`)
    ).json<Ficha>();
    const c = await chave(
      segredo,
      "PUT",
      `/products/${artigo}/classification`,
      {
        versao: f.versao,
        familias: ["retalho_geral"],
        natureza_consumidor: "bem",
      },
    );
    expect(c.statusCode, c.body).toBe(200);
    return chave(segredo, "POST", `/products/${artigo}/activate`, {
      versao: c.json<Ficha>().versao,
    });
  }

  const opcaoDe = async (segredo: string, id: string) =>
    (await chave(segredo, "GET", `/options/${id}`)).json<Opcao>();

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
    h = hubDeTeste(base);
  }, 60_000);

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  it("num rascunho: muda o nome e o texto na versão lida; a versão sobe; a versão antiga dá 409 e nada muda", async () => {
    const c = await comerciante("Loja Opcoes Nome");
    const { tamanho } = await rascunho(c);
    expect(tamanho.versao).toBe(1);
    const nome = await chave(c.segredo, "PATCH", `/options/${tamanho.id}`, {
      nome: "Capacidade",
      versao: 1,
    });
    expect(nome.statusCode, nome.body).toBe(200);
    expect(nome.json<Opcao>()).toMatchObject({ nome: "Capacidade", versao: 2 });
    const texto = await chave(
      c.segredo,
      "PATCH",
      `/options/${tamanho.id}/values/${tamanho.valores[0]?.id ?? ""}`,
      { valor: "15ml", versao: 2 },
    );
    expect(texto.statusCode, texto.body).toBe(200);
    expect(texto.json<Opcao>().valores.map((v) => v.valor)).toEqual([
      "15ml",
      "30 ml",
    ]);
    expect(texto.json<Opcao>().versao).toBe(3);
    // Com a versão de antes: 409, e o nome fica.
    const velha = await chave(c.segredo, "PATCH", `/options/${tamanho.id}`, {
      nome: "Volume",
      versao: 2,
    });
    expect(velha.statusCode).toBe(409);
    expect(h.codigo(velha)).toBe("catalog.version_conflict");
    expect((await opcaoDe(c.segredo, tamanho.id)).nome).toBe("Capacidade");
    // Acrescentar um valor também sobe a versão, e aceita-a (opcional).
    const novo = await chave(
      c.segredo,
      "POST",
      `/options/${tamanho.id}/values`,
      { valor: "50 ml", versao: 2 },
    );
    expect(h.codigo(novo)).toBe("catalog.version_conflict");
    const aceite = await chave(
      c.segredo,
      "POST",
      `/options/${tamanho.id}/values`,
      { valor: "50 ml", versao: 3 },
    );
    expect(aceite.statusCode, aceite.body).toBe(201);
    expect(aceite.json<Opcao>().versao).toBe(4);
  });

  it("nome e valor repetidos dão 409 sem distinguir maiúsculas; um valor de outra opção é «não existe»", async () => {
    const c = await comerciante("Loja Opcoes Repetidos");
    const { tamanho, cor } = await rascunho(c);
    const nome = await chave(c.segredo, "PATCH", `/options/${tamanho.id}`, {
      nome: " cor ",
      versao: 1,
    });
    expect(h.codigo(nome)).toBe("catalog.option_duplicate");
    const valor = await chave(
      c.segredo,
      "PATCH",
      `/options/${tamanho.id}/values/${tamanho.valores[0]?.id ?? ""}`,
      { valor: "30 ML", versao: 1 },
    );
    expect(h.codigo(valor)).toBe("catalog.option_value_duplicate");
    const deOutra = await chave(
      c.segredo,
      "PATCH",
      `/options/${tamanho.id}/values/${cor.valores[0]?.id ?? ""}`,
      { valor: "Verde", versao: 1 },
    );
    expect(deOutra.statusCode).toBe(404);
    expect((await opcaoDe(c.segredo, cor.id)).valores[0]?.valor).toBe("Azul");
  });

  it("a ordem: das opções e dos valores, em qualquer estado; a lista tem de ser exactamente a de agora", async () => {
    const c = await comerciante("Loja Opcoes Ordem");
    const { artigo, tamanho, cor } = await rascunho(c);
    expect((await activar(c.segredo, artigo)).statusCode).toBe(200);
    const ordem = await chave(
      c.segredo,
      "PUT",
      `/products/${artigo}/options/order`,
      { opcoes: [cor.id, tamanho.id] },
    );
    expect(ordem.statusCode, ordem.body).toBe(200);
    expect(
      ordem.json<{ dados: Opcao[] }>().dados.map((o) => [o.nome, o.posicao]),
    ).toEqual([
      ["Cor", 0],
      ["Tamanho", 1],
    ]);
    // A ordem das opções não sobe a versão de nenhuma.
    expect((await opcaoDe(c.segredo, tamanho.id)).versao).toBe(1);
    for (const opcoes of [
      [cor.id],
      [cor.id, tamanho.id, `opt_${randomUUID()}`],
    ]) {
      const r = await chave(
        c.segredo,
        "PUT",
        `/products/${artigo}/options/order`,
        {
          opcoes,
        },
      );
      expect(h.codigo(r), JSON.stringify(opcoes)).toBe(
        "catalog.order_mismatch",
      );
    }
    const repetida = await chave(
      c.segredo,
      "PUT",
      `/products/${artigo}/options/order`,
      { opcoes: [cor.id, cor.id] },
    );
    expect(repetida.statusCode).toBe(400);
    const [ml15, ml30] = tamanho.valores.map((v) => v.id);
    const valores = await chave(
      c.segredo,
      "PUT",
      `/options/${tamanho.id}/values/order`,
      { valores: [ml30, ml15], versao: 1 },
    );
    expect(valores.statusCode, valores.body).toBe(200);
    expect(valores.json<Opcao>().valores.map((v) => v.valor)).toEqual([
      "30 ml",
      "15 ml",
    ]);
    expect(valores.json<Opcao>().versao).toBeGreaterThan(1);
    const faltam = await chave(
      c.segredo,
      "PUT",
      `/options/${tamanho.id}/values/order`,
      { valores: [ml30], versao: valores.json<Opcao>().versao },
    );
    expect(h.codigo(faltam)).toBe("catalog.order_mismatch");
  });

  it("fora do rascunho: nome, texto, apagar e os valores das variantes dão catalog.not_draft; acrescentar um valor aceita", async () => {
    const c = await comerciante("Loja Opcoes Activo");
    const { artigo, variantes, tamanho, cor } = await rascunho(c);
    expect((await activar(c.segredo, artigo)).statusCode).toBe(200);
    const ml15 = tamanho.valores[0]?.id ?? "";
    for (const [metodo, url, corpo] of [
      ["PATCH", `/options/${tamanho.id}`, { nome: "Volume", versao: 1 }],
      [
        "PATCH",
        `/options/${tamanho.id}/values/${ml15}`,
        { valor: "15ml", versao: 1 },
      ],
      ["DELETE", `/options/${tamanho.id}?versao=1`, undefined],
      ["DELETE", `/options/${tamanho.id}/values/${ml15}?versao=1`, undefined],
      ["PUT", `/variants/${variantes[0] ?? ""}/values`, { valores: [ml15] }],
    ] as const) {
      const r = await chave(c.segredo, metodo, url, corpo);
      expect(r.statusCode, `${metodo} ${url}: ${r.body}`).toBe(409);
      expect(h.codigo(r)).toBe("catalog.not_draft");
    }
    const depois = await opcaoDe(c.segredo, tamanho.id);
    expect(depois).toMatchObject({ nome: "Tamanho", versao: 1 });
    expect(depois.valores.map((v) => v.valor)).toEqual(["15 ml", "30 ml"]);
    const novo = await chave(c.segredo, "POST", `/options/${cor.id}/values`, {
      valor: "Verde",
    });
    expect(novo.statusCode, novo.body).toBe(201);
  });

  it("apagar num rascunho: um valor deixa as variantes sem ele; a opção sai das variantes; duas iguais recusam e nada se apaga", async () => {
    const c = await comerciante("Loja Opcoes Apagar");
    const { artigo, variantes, tamanho, cor } = await rascunho(c);
    // Apagar «Cor» deixava as duas variantes com «15 ml»: recusado, nada sai.
    const iguais = await chave(
      c.segredo,
      "DELETE",
      `/options/${cor.id}?versao=1`,
    );
    expect(iguais.statusCode, iguais.body).toBe(409);
    expect(h.codigo(iguais)).toBe("catalog.option_combination_duplicate");
    expect((await opcaoDe(c.segredo, cor.id)).valores).toHaveLength(2);
    // Apagar «Azul»: a primeira variante fica sem cor.
    const azul = cor.valores[0]?.id ?? "";
    const semAzul = await chave(
      c.segredo,
      "DELETE",
      `/options/${cor.id}/values/${azul}?versao=1`,
    );
    expect(semAzul.statusCode, semAzul.body).toBe(200);
    expect(semAzul.json<Opcao>().valores.map((v) => v.valor)).toEqual(["Rosa"]);
    const v1 = (
      await chave(c.segredo, "GET", `/variants/${variantes[0] ?? ""}`)
    ).json<{ valores: string[] }>();
    expect(v1.valores).toEqual([tamanho.valores[0]?.id]);
    // Agora «Tamanho» sai: a segunda variante fica só com «Rosa».
    const semTamanho = await chave(
      c.segredo,
      "DELETE",
      `/options/${tamanho.id}?versao=1`,
    );
    expect(semTamanho.statusCode, semTamanho.body).toBe(204);
    const opcoes = (
      await chave(c.segredo, "GET", `/products/${artigo}/options`)
    ).json<{ dados: Opcao[] }>();
    expect(opcoes.dados.map((o) => o.nome)).toEqual(["Cor"]);
    const v2 = (
      await chave(c.segredo, "GET", `/variants/${variantes[1] ?? ""}`)
    ).json<{ valores: string[] }>();
    expect(v2.valores).toEqual([cor.valores[1]?.id]);
    // Incompleto não se activa.
    const activo = await activar(c.segredo, artigo);
    expect(h.codigo(activo)).toBe("catalog.options_incomplete");
  });

  it("os valores das variantes: dois da mesma opção, ou de outro artigo, recusam", async () => {
    const c = await comerciante("Loja Opcoes Valores");
    const a = await rascunho(c);
    const b = await rascunho(c);
    const v = a.variantes[0] ?? "";
    const doisDaMesma = await chave(c.segredo, "PUT", `/variants/${v}/values`, {
      valores: a.tamanho.valores.map((x) => x.id),
    });
    expect(h.codigo(doisDaMesma)).toBe("catalog.option_repeated");
    const deOutro = await chave(c.segredo, "PUT", `/variants/${v}/values`, {
      valores: [b.tamanho.valores[0]?.id],
    });
    expect(deOutro.statusCode).toBe(404);
    // Vazio: a variante fica sem valores (o rascunho pode ficar incompleto).
    const vazio = await chave(c.segredo, "PUT", `/variants/${v}/values`, {
      valores: [],
    });
    expect(vazio.statusCode, vazio.body).toBe(200);
    expect(vazio.json<{ valores: string[] }>().valores).toEqual([]);
  });

  it("a linha do tempo tem cada mudança com quem fez; uma tradução do nome passa a «desactualizada»", async () => {
    const c = await comerciante("Loja Opcoes Rasto");
    const { artigo, tamanho } = await rascunho(c);
    const t = await chave(
      c.segredo,
      "PUT",
      `/translations/${tamanho.id}/nome/en`,
      { texto: "Size", original_visto: "Tamanho" },
    );
    expect(t.statusCode, t.body).toBe(200);
    const r = await chave(c.segredo, "PATCH", `/options/${tamanho.id}`, {
      nome: "Capacidade",
      versao: 1,
    });
    expect(r.statusCode, r.body).toBe(200);
    const traducoes = (
      await chave(c.segredo, "GET", `/translations?resource=${tamanho.id}`)
    ).json<{ dados: { campo: string; estado: string }[] }>();
    expect(traducoes.dados.find((x) => x.campo === "nome")?.estado).toBe(
      "desactualizada",
    );
    const linha = (
      await chave(c.segredo, "GET", `/products/${artigo}/timeline`)
    ).json<{
      dados: {
        entidade: string;
        quem: string;
        campos: Record<string, unknown>;
      }[];
    }>();
    const mudanca = linha.dados.find(
      (d) => d.entidade === "opcao" && "nome" in d.campos,
    );
    expect(mudanca?.campos["nome"]).toEqual({
      antes: "Tamanho",
      depois: "Capacidade",
    });
    expect(mudanca?.quem).toMatch(/^chave:/);
  });

  it("outro comerciante não chega às opções nem às variantes de A", async () => {
    const a = await comerciante("Loja Opcoes A");
    const b = await comerciante("Loja Opcoes B");
    const deA = await rascunho(a);
    for (const [metodo, url, corpo] of [
      ["PATCH", `/options/${deA.tamanho.id}`, { nome: "X", versao: 1 }],
      [
        "PATCH",
        `/options/${deA.tamanho.id}/values/${deA.tamanho.valores[0]?.id ?? ""}`,
        { valor: "X", versao: 1 },
      ],
      ["DELETE", `/options/${deA.tamanho.id}?versao=1`, undefined],
      [
        "DELETE",
        `/options/${deA.tamanho.id}/values/${deA.tamanho.valores[0]?.id ?? ""}?versao=1`,
        undefined,
      ],
      [
        "PUT",
        `/products/${deA.artigo}/options/order`,
        { opcoes: [deA.cor.id, deA.tamanho.id] },
      ],
      [
        "PUT",
        `/options/${deA.tamanho.id}/values/order`,
        { valores: deA.tamanho.valores.map((v) => v.id).reverse(), versao: 1 },
      ],
      ["PUT", `/variants/${deA.variantes[0] ?? ""}/values`, { valores: [] }],
    ] as const) {
      const r = await chave(b.segredo, metodo, url, corpo);
      expect(r.statusCode, `${metodo} ${url}: ${r.body}`).toBe(404);
    }
    const depois = await opcaoDe(a.segredo, deA.tamanho.id);
    expect(depois).toMatchObject({ nome: "Tamanho", versao: 1, posicao: 0 });
  });

  it("os filtros escritos do comerciante, também sem a RLS: com o dono (que a passa), B não muda nada de A", async () => {
    const a = await comerciante("Loja Opcoes Filtro A");
    const b = await comerciante("Loja Opcoes Filtro B");
    const deA = await rascunho(a);
    const sem = (x: string) => x.replace(/^[a-z]+_/, "");
    const dono = base.dono as Kysely<BaseDados>;
    const opt = sem(deA.tamanho.id);
    const ovl = sem(deA.tamanho.valores[0]?.id ?? "");
    const tentativas: [string, () => Promise<void>][] = [
      ["nome", () => mudarNomeDaOpcao(dono, b.id, opt, "X", 1)],
      ["texto", () => mudarTextoDoValor(dono, b.id, opt, ovl, "X", 1)],
      ["apagar valor", () => apagarValor(dono, b.id, opt, ovl, 1)],
      ["apagar opção", () => apagarOpcao(dono, b.id, opt, 1)],
      [
        "ordem das opções",
        () =>
          ordenarOpcoes(dono, b.id, sem(deA.artigo), [sem(deA.cor.id), opt]),
      ],
      [
        "ordem dos valores",
        () =>
          ordenarValores(
            dono,
            b.id,
            opt,
            deA.tamanho.valores.map((v) => sem(v.id)).reverse(),
            1,
          ),
      ],
      [
        "valores da variante",
        () =>
          definirValoresNoRascunho(dono, b.id, sem(deA.variantes[0] ?? ""), []),
      ],
    ];
    for (const [oQue, fazer] of tentativas) {
      await expect(fazer(), oQue).rejects.toMatchObject({
        codigo: "catalog.not_found",
      });
    }
    const depois = await opcaoDe(a.segredo, deA.tamanho.id);
    expect(depois).toMatchObject({ nome: "Tamanho", versao: 1, posicao: 0 });
    expect(depois.valores.map((v) => v.valor)).toEqual(["15 ml", "30 ml"]);
    const v1 = (
      await chave(a.segredo, "GET", `/variants/${deA.variantes[0] ?? ""}`)
    ).json<{ valores: string[] }>();
    expect(v1.valores).toHaveLength(2);
  });

  it("pelo Hub: as mesmas escritas para o dono e o gestor; o armazém e o apoio recebem 403", async () => {
    const c = await comerciante("Loja Opcoes Hub");
    const { artigo, variantes, tamanho, cor } = await rascunho(c);
    for (const papel of ["armazem", "apoio"]) {
      const p = await h.pessoaCom(c.id, papel);
      const r = await h.pedir("PATCH", `/hub/options/${tamanho.id}`, {
        sessao: p.sessao,
        comerciante: c.id,
        corpo: { nome: "X", versao: 1 },
      });
      expect(r.statusCode, `${papel}: ${r.body}`).toBe(403);
    }
    const gestor = await h.pessoaCom(c.id, "gestor");
    const comSessao = { sessao: gestor.sessao, comerciante: c.id };
    const nome = await h.pedir("PATCH", `/hub/options/${tamanho.id}`, {
      ...comSessao,
      corpo: { nome: "Capacidade", versao: 1 },
    });
    expect(nome.statusCode, nome.body).toBe(200);
    expect(nome.headers["cache-control"]).toBe("private, no-store");
    const ml15 = tamanho.valores[0]?.id ?? "";
    const texto = await h.pedir(
      "PATCH",
      `/hub/options/${tamanho.id}/values/${ml15}`,
      { ...comSessao, corpo: { valor: "15ml", versao: 2 } },
    );
    expect(texto.statusCode, texto.body).toBe(200);
    const ordem = await h.pedir(
      "PUT",
      `/hub/products/${artigo}/options/order`,
      { ...comSessao, corpo: { opcoes: [cor.id, tamanho.id] } },
    );
    expect(ordem.statusCode, ordem.body).toBe(200);
    const valores = await h.pedir(
      "PUT",
      `/hub/options/${cor.id}/values/order`,
      {
        ...comSessao,
        corpo: { valores: cor.valores.map((v) => v.id).reverse(), versao: 1 },
      },
    );
    expect(valores.statusCode, valores.body).toBe(200);
    const variante = await h.pedir(
      "PUT",
      `/hub/variants/${variantes[1] ?? ""}/values`,
      { ...comSessao, corpo: { valores: [ml15] } },
    );
    expect(variante.statusCode, variante.body).toBe(200);
    const semValor = await h.pedir(
      "DELETE",
      `/hub/options/${cor.id}/values/${cor.valores[1]?.id ?? ""}`,
      { ...comSessao, corpo: { versao: valores.json<Opcao>().versao } },
    );
    expect(semValor.statusCode, semValor.body).toBe(200);
    // «Tamanho» sai (com «Cor» saíam as duas variantes iguais, em 15 ml).
    const semOpcao = await h.pedir("DELETE", `/hub/options/${tamanho.id}`, {
      ...comSessao,
      corpo: { versao: texto.json<Opcao>().versao },
    });
    expect(semOpcao.statusCode, semOpcao.body).toBe(204);
    // O «quem» é a pessoa (docs/22 §21.2).
    const linha = (
      await chave(c.segredo, "GET", `/products/${artigo}/timeline`)
    ).json<{ dados: { entidade: string; quem: string }[] }>();
    expect(
      linha.dados.filter((d) => d.entidade === "opcao").map((d) => d.quem),
    ).toContain(`pessoa:per_${gestor.pessoa}`);
    // A versão antiga pelo Hub: 409.
    const velha = await h.pedir("PATCH", `/hub/options/${cor.id}`, {
      ...comSessao,
      corpo: { nome: "Tom", versao: 1 },
    });
    expect(h.codigo(velha)).toBe("catalog.version_conflict");
  });

  it("pelo Hub, num artigo do sistema de gestão: catalog.external_field; pela chave, aceita", async () => {
    const c = await comerciante("Loja Opcoes Externo");
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
          origem_ref: "GESTAO-OPC",
        },
        [{ sku: `G-${randomUUID()}`, unidade_de_venda: "unidade" }],
      );
    });
    const o = (
      await chave(c.segredo, "POST", `/products/prd_${id}/options`, {
        nome: "Tamanho",
        valores: ["15 ml", "30 ml"],
      })
    ).json<Opcao>();
    const f = (
      await chave(c.segredo, "GET", `/products/prd_${id}`)
    ).json<Ficha>();
    const dono = await h.pessoaCom(c.id, "dono");
    const comSessao = { sessao: dono.sessao, comerciante: c.id };
    const ml15 = o.valores[0]?.id ?? "";
    for (const [metodo, url, corpo] of [
      [
        "POST",
        `/hub/products/prd_${id}/options`,
        { nome: "Cor", valores: ["Azul"] },
      ],
      ["POST", `/hub/options/${o.id}/values`, { valor: "50 ml" }],
      ["PATCH", `/hub/options/${o.id}`, { nome: "X", versao: 1 }],
      [
        "PATCH",
        `/hub/options/${o.id}/values/${ml15}`,
        { valor: "X", versao: 1 },
      ],
      ["DELETE", `/hub/options/${o.id}/values/${ml15}`, { versao: 1 }],
      ["DELETE", `/hub/options/${o.id}`, { versao: 1 }],
      ["PUT", `/hub/products/prd_${id}/options/order`, { opcoes: [o.id] }],
      [
        "PUT",
        `/hub/options/${o.id}/values/order`,
        { valores: o.valores.map((v) => v.id).reverse(), versao: 1 },
      ],
      [
        "PUT",
        `/hub/variants/${f.variantes[0]?.id ?? ""}/values`,
        { valores: [ml15] },
      ],
    ] as const) {
      const r = await h.pedir(metodo, url, { ...comSessao, corpo });
      expect(r.statusCode, `${metodo} ${url}: ${r.body}`).toBe(409);
      expect(h.codigo(r)).toBe("catalog.external_field");
    }
    const pelaChave = await chave(c.segredo, "PATCH", `/options/${o.id}`, {
      nome: "Capacidade",
      versao: 1,
    });
    expect(pelaChave.statusCode, pelaChave.body).toBe(200);
  });

  it("a migração 0042 sobre opções que já existiam: ficam na versão 1, e um valor novo sobe-a", async () => {
    const c = await comerciante("Loja Opcoes Migracao");
    const { tamanho } = await rascunho(c);
    const id = tamanho.id.replace(/^opt_/, "");
    const ficheiro = readFileSync(
      new URL(
        "../migracoes/0042_catalogo_versao_da_opcao.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const dono = base.dono as Kysely<BaseDados>;
    // Como antes da 0042 (sem a coluna nem o gatilho dos valores), com a
    // opção já lá; corre o ficheiro; desfaz-se tudo no fim.
    const desfazer = new Error("desfazer");
    const visto = await dono
      .transaction()
      .execute(async (trx) => {
        await sql`drop trigger valor_opcao_sobe_versao on valor_opcao`.execute(
          trx,
        );
        await sql`drop function valor_opcao_sobe_versao()`.execute(trx);
        await sql`alter table opcao drop column versao`.execute(trx);
        await sql.raw(ficheiro).execute(trx);
        const antes = await sql<{ versao: number }>`
          select versao from opcao where id = ${id}::uuid`.execute(trx);
        await sql`select set_config('eurolify.comerciante', ${c.id}, true)`.execute(
          trx,
        );
        await sql`insert into valor_opcao (comerciante_id, artigo_id, opcao_id, valor, posicao)
          select comerciante_id, artigo_id, id, '50 ml', 9 from opcao where id = ${id}::uuid`.execute(
          trx,
        );
        const depois = await sql<{ versao: number }>`
          select versao from opcao where id = ${id}::uuid`.execute(trx);
        throw Object.assign(desfazer, {
          antes: antes.rows[0]?.versao,
          depois: depois.rows[0]?.versao,
        });
      })
      .catch((e: unknown) => {
        if (e !== desfazer) throw e;
        return e as Error & { antes?: number; depois?: number };
      });
    expect([visto.antes, visto.depois]).toEqual([1, 2]);
    // Desfeito: a opção e o gatilho como estavam.
    expect((await opcaoDe(c.segredo, tamanho.id)).valores).toHaveLength(2);
  });

  it("duas escritas ao mesmo tempo na mesma versão: uma grava, a outra dá 409 (revisão do #290, P2-1)", async () => {
    const c = await comerciante("Loja Opcoes Corrida");
    for (let volta = 0; volta < 3; volta++) {
      const { tamanho } = await rascunho(c);
      const [ml15, ml30] = tamanho.valores.map((v) => v.id);
      const respostas = await Promise.all([
        chave(c.segredo, "PATCH", `/options/${tamanho.id}`, {
          nome: "Capacidade",
          versao: 1,
        }),
        chave(c.segredo, "PATCH", `/options/${tamanho.id}`, {
          nome: "Volume",
          versao: 1,
        }),
        chave(c.segredo, "PUT", `/options/${tamanho.id}/values/order`, {
          valores: [ml30, ml15],
          versao: 1,
        }),
      ]);
      const estados = respostas.map((r) => r.statusCode).sort();
      expect(estados, `volta ${String(volta)}`).toEqual([200, 409, 409]);
      for (const r of respostas.filter((x) => x.statusCode === 409)) {
        expect(h.codigo(r)).toBe("catalog.version_conflict");
      }
      // Subiu só pela que gravou (a ordem de 2 valores sobe 2).
      expect((await opcaoDe(c.segredo, tamanho.id)).versao).toBeGreaterThan(1);
    }
  });

  it("cada escrita da opção sobe a versão: a versão de antes dá 409 em todas (revisão do #290, P2-1 e P3-6)", async () => {
    const c = await comerciante("Loja Opcoes Versoes");
    const { tamanho } = await rascunho(c);
    const ml15 = tamanho.valores[0]?.id ?? "";
    const ml30 = tamanho.valores[1]?.id ?? "";
    const novo = await chave(
      c.segredo,
      "POST",
      `/options/${tamanho.id}/values`,
      {
        valor: "50 ml",
      },
    );
    const ml50 = novo.json<Opcao>().valores[2]?.id ?? "";
    // Cada passo grava na versão actual e depois tenta todas as escritas
    // na versão anterior, que têm de dar 409.
    const passos: [string, "PATCH" | "PUT" | "DELETE", string, unknown][] = [
      [
        "texto",
        "PATCH",
        `/options/${tamanho.id}/values/${ml15}`,
        { valor: "15ml" },
      ],
      [
        "ordem",
        "PUT",
        `/options/${tamanho.id}/values/order`,
        { valores: [ml50, ml30, ml15] },
      ],
      [
        "apagar valor",
        "DELETE",
        `/options/${tamanho.id}/values/${ml50}`,
        undefined,
      ],
    ];
    let versao = novo.json<Opcao>().versao;
    expect(versao).toBe(2);
    for (const [oQue, metodo, url, corpo] of passos) {
      const r =
        metodo === "DELETE"
          ? await chave(c.segredo, metodo, `${url}?versao=${String(versao)}`)
          : await chave(c.segredo, metodo, url, {
              ...(corpo as object),
              versao,
            });
      expect(r.statusCode, `${oQue}: ${r.body}`).toBe(200);
      const antiga = versao;
      versao = (await opcaoDe(c.segredo, tamanho.id)).versao;
      // Sobe uma vez por linha mudada (a ordem de 3 valores muda 2).
      expect(versao, oQue).toBeGreaterThan(antiga);
      for (const [metodoV, urlV, corpoV] of [
        ["PATCH", `/options/${tamanho.id}`, { nome: "X", versao: antiga }],
        [
          "PATCH",
          `/options/${tamanho.id}/values/${ml30}`,
          { valor: "X", versao: antiga },
        ],
        [
          "PUT",
          `/options/${tamanho.id}/values/order`,
          { valores: [], versao: antiga },
        ],
        [
          "DELETE",
          `/options/${tamanho.id}/values/${ml30}?versao=${String(antiga)}`,
          undefined,
        ],
        [
          "DELETE",
          `/options/${tamanho.id}?versao=${String(antiga)}`,
          undefined,
        ],
        [
          "POST",
          `/options/${tamanho.id}/values`,
          { valor: "X", versao: antiga },
        ],
      ] as const) {
        const v = await chave(c.segredo, metodoV, urlV, corpoV);
        if (metodoV === "PUT" && v.statusCode === 400) continue;
        expect(h.codigo(v), `${oQue} → ${metodoV} ${urlV}`).toBe(
          "catalog.version_conflict",
        );
      }
    }
    expect(
      (await opcaoDe(c.segredo, tamanho.id)).valores.map((v) => v.valor),
    ).toEqual(["30 ml", "15ml"]);
  });

  it("uma opção nova depois de apagar outra fica a seguir à última (revisão do #290, P2-2)", async () => {
    const c = await comerciante("Loja Opcoes Posicao");
    const { artigo, tamanho } = await rascunho(c);
    // Sem «Tamanho», a «Cor» fica sozinha na posição 1; a nova vai para a 2.
    // Antes, iam as duas para a 1. (As variantes ficam iguais só em «Cor»:
    // a primeira é azul, a segunda rosa.)
    const r = await chave(
      c.segredo,
      "DELETE",
      `/options/${tamanho.id}?versao=1`,
    );
    expect(r.statusCode, r.body).toBe(204);
    const nova = await chave(c.segredo, "POST", `/products/${artigo}/options`, {
      nome: "Brilho",
      valores: ["Mate"],
    });
    expect(nova.statusCode, nova.body).toBe(201);
    const opcoes = (
      await chave(c.segredo, "GET", `/products/${artigo}/options`)
    ).json<{ dados: Opcao[] }>();
    expect(opcoes.dados.map((o) => [o.nome, o.posicao])).toEqual([
      ["Cor", 1],
      ["Brilho", 2],
    ]);
  });

  it("pelo Hub: criar uma opção e acrescentar um valor; o armazém recebe 403; outro comerciante, 404", async () => {
    const c = await comerciante("Loja Opcoes Hub Criar");
    const outro = await comerciante("Loja Opcoes Hub Outro");
    const { artigo, tamanho } = await rascunho(c);
    const gestor = await h.pessoaCom(c.id, "gestor");
    const comSessao = { sessao: gestor.sessao, comerciante: c.id };
    const criada = await h.pedir("POST", `/hub/products/${artigo}/options`, {
      ...comSessao,
      corpo: { nome: "Brilho", valores: ["Mate", "Brilhante"] },
    });
    expect(criada.statusCode, criada.body).toBe(201);
    expect(criada.json<Opcao>()).toMatchObject({
      nome: "Brilho",
      posicao: 2,
      versao: 1,
    });
    const valor = await h.pedir("POST", `/hub/options/${tamanho.id}/values`, {
      ...comSessao,
      corpo: { valor: "50 ml", versao: 1 },
    });
    expect(valor.statusCode, valor.body).toBe(201);
    expect(valor.json<Opcao>().valores.map((v) => v.valor)).toEqual([
      "15 ml",
      "30 ml",
      "50 ml",
    ]);
    const armazem = await h.pessoaCom(c.id, "armazem");
    const recusada = await h.pedir(
      "POST",
      `/hub/options/${tamanho.id}/values`,
      {
        sessao: armazem.sessao,
        comerciante: c.id,
        corpo: { valor: "60 ml" },
      },
    );
    expect(recusada.statusCode).toBe(403);
    // O dono de outro comerciante, com o cabeçalho dele, não chega a A.
    const deB = await h.pessoaCom(outro.id, "dono");
    for (const [metodo, url, corpo] of [
      [
        "POST",
        `/hub/products/${artigo}/options`,
        { nome: "X", valores: ["Y"] },
      ],
      ["POST", `/hub/options/${tamanho.id}/values`, { valor: "X" }],
      ["PATCH", `/hub/options/${tamanho.id}`, { nome: "X", versao: 2 }],
      ["DELETE", `/hub/options/${tamanho.id}`, { versao: 2 }],
    ] as const) {
      const r = await h.pedir(metodo, url, {
        sessao: deB.sessao,
        comerciante: outro.id,
        corpo,
      });
      expect(r.statusCode, `${metodo} ${url}: ${r.body}`).toBe(404);
    }
    expect((await opcaoDe(c.segredo, tamanho.id)).valores).toHaveLength(3);
  });

  it("o contrato tem as rotas novas, pela chave e pelo Hub, e a versão na opção", async () => {
    const r = await h.app.inject({ method: "GET", url: "/openapi.json" });
    const contrato = r.json<{
      paths: Record<string, Record<string, { security?: unknown }>>;
    }>();
    for (const [caminho, metodo] of [
      ["/options/{id}", "patch"],
      ["/options/{id}", "delete"],
      ["/options/{id}/values/{valor}", "patch"],
      ["/options/{id}/values/{valor}", "delete"],
      ["/products/{id}/options/order", "put"],
      ["/options/{id}/values/order", "put"],
      ["/variants/{id}/values", "put"],
      ["/products/{id}/options", "post"],
      ["/options/{id}/values", "post"],
    ] as const) {
      expect(contrato.paths[caminho]?.[metodo]?.security, caminho).toEqual([
        { chave: [] },
      ]);
      expect(
        contrato.paths[`/hub${caminho}`]?.[metodo]?.security,
        `/hub${caminho}`,
      ).toEqual([{ sessao: [] }]);
    }
    expect(JSON.stringify(contrato.paths["/options/{id}"]?.["get"])).toContain(
      "versao",
    );
  });
});
