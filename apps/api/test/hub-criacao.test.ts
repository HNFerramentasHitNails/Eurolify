import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registarComerciante } from "../src/comerciante/repositorio.js";
import { criarChave } from "../src/identidade/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";
import { hubDeTeste } from "./hub-de-teste.js";

// Criar artigos pelo Hub (docs/22 §14; issue #221): a mesma função do POST
// /products, com um corpo mais estreito, a sessão de quem tem catalog:write
// e a pessoa como «quem fez» na linha do tempo (docs/14 §3.12). A base é
// criada sem o «quem» por omissão dos testes: cada escrita tem de pôr o seu.
// Contra o PostgreSQL 18.

interface Ficha {
  id: string;
  tipo: string;
  nome: string;
  descricao: string | null;
  marca: string | null;
  categoria_fiscal: string | null;
  estado: string;
  origem: string;
  versao: number;
  variantes: { id: string; sku: string; peso_g: number | null }[];
}

describe.skipIf(URL_BASE === undefined)("criar artigos no Hub (#221)", () => {
  let base: BaseDeTeste;
  let h: ReturnType<typeof hubDeTeste>;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "", { quemPorOmissao: false });
    h = hubDeTeste(base);
  });

  afterAll(async () => {
    await h.app.close();
    await base.fechar();
  });

  const comChave = (
    segredo: string,
    metodo: "GET" | "POST",
    url: string,
    corpo?: object,
  ) =>
    h.app.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${segredo}`,
        ...(metodo !== "GET"
          ? {
              "idempotency-key": randomUUID(),
              "content-type": "application/json",
            }
          : {}),
      },
      ...(corpo === undefined ? {} : { payload: JSON.stringify(corpo) }),
    });

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
    return { id: c, segredo };
  }

  const artigoNovo = (sku = `N-${randomUUID()}`) => ({
    tipo: "fisico",
    nome: "Verniz Verde 31",
    descricao: "Secagem rápida.",
    marca: "Marca de Ensaio",
    variantes: [
      {
        sku,
        unidade_de_venda: "unidade",
        conteudo_quantidade: 15,
        conteudo_unidade: "ml",
        peso_g: 60,
      },
      { sku: `${sku}-B`, unidade_de_venda: "caixa" },
    ],
  });

  async function contarArtigos(comercianteId: string) {
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from artigo
      where comerciante_id = ${comercianteId}::uuid`.execute(base.dono);
    return Number(rows[0]?.n);
  }

  it("o dono e o gestor criam um artigo em rascunho; a ficha é a da chave e a linha do tempo diz a pessoa", async () => {
    const c = await comerciante("Loja Criacao");
    for (const papel of ["dono", "gestor"] as const) {
      const p = await h.pessoaCom(c.id, papel);
      const r = await h.pedir("POST", "/hub/products", {
        sessao: p.sessao,
        comerciante: c.id,
        corpo: artigoNovo(),
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.headers["cache-control"]).toBe("private, no-store");
      const ficha = r.json<Ficha>();
      expect(r.headers.location).toBe(`/hub/products/${ficha.id}`);
      expect(ficha).toMatchObject({
        tipo: "fisico",
        nome: "Verniz Verde 31",
        estado: "rascunho",
        origem: "eurolify",
        categoria_fiscal: null,
      });
      expect(ficha.variantes.map((v) => v.peso_g)).toEqual([60, null]);
      const pelaChave = await comChave(
        c.segredo,
        "GET",
        `/products/${ficha.id}`,
      );
      expect(ficha).toEqual(pelaChave.json());
      const { rows } = await sql<{ quem: string }>`
        select distinct quem from alteracao_catalogo
        where comerciante_id = ${c.id}::uuid
          and entidade_id = ${ficha.id.replace(/^prd_/, "")}::uuid`.execute(
        base.dono,
      );
      expect(rows.map((l) => l.quem)).toEqual([`pessoa:per_${p.pessoa}`]);
    }
  });

  it("o artigo criado pelo Hub é igual ao criado pela chave com o mesmo corpo; o cabeçalho de outro comerciante é recusado (revisão do #223, P3-1)", async () => {
    const c = await comerciante("Loja Criacao Igual");
    const outro = await comerciante("Loja Criacao Outra");
    const p = await h.pessoaCom(c.id, "dono");
    const doHub = await h.pedir("POST", "/hub/products", {
      sessao: p.sessao,
      comerciante: c.id,
      corpo: artigoNovo("H"),
    });
    expect(doHub.statusCode, doHub.body).toBe(201);
    const daChave = await comChave(c.segredo, "POST", "/products", {
      ...artigoNovo("K"),
    });
    expect(daChave.statusCode, daChave.body).toBe(201);
    // Iguais, tirando o que é de cada linha: ids, datas e o SKU pedido.
    const semIdentidade = (f: Ficha) =>
      JSON.parse(
        JSON.stringify(f, (k, v: unknown) =>
          ["id", "criado_em", "actualizado_em", "sku", "artigo"].includes(k)
            ? undefined
            : v,
        ),
      ) as unknown;
    expect(semIdentidade(doHub.json<Ficha>())).toEqual(
      semIdentidade(daChave.json<Ficha>()),
    );
    // A pessoa não é membro do outro comerciante: o cabeçalho dele é recusado.
    const deOutro = await h.pedir("POST", "/hub/products", {
      sessao: p.sessao,
      comerciante: outro.id,
      corpo: artigoNovo(),
    });
    expect(deOutro.statusCode).toBe(403);
    expect(await contarArtigos(outro.id)).toBe(0);
  });

  it("o mesmo pedido duas vezes não cria um segundo artigo: o SKU dá catalog.sku_duplicate", async () => {
    const c = await comerciante("Loja Criacao Repetida");
    const p = await h.pessoaCom(c.id, "dono");
    const corpo = artigoNovo();
    const primeira = await h.pedir("POST", "/hub/products", {
      sessao: p.sessao,
      comerciante: c.id,
      corpo,
    });
    expect(primeira.statusCode, primeira.body).toBe(201);
    const segunda = await h.pedir("POST", "/hub/products", {
      sessao: p.sessao,
      comerciante: c.id,
      corpo,
    });
    expect(segunda.statusCode).toBe(409);
    expect(h.codigo(segunda)).toBe("catalog.sku_duplicate");
    expect(await contarArtigos(c.id)).toBe(1);
    // A procura que o ecrã faz depois do 409 (§14.2) encontra o artigo.
    const procura = await h.pedir(
      "GET",
      `/hub/products?sku=${encodeURIComponent(corpo.variantes[0]?.sku.toUpperCase() ?? "")}`,
      { sessao: p.sessao, comerciante: c.id },
    );
    expect(procura.statusCode, procura.body).toBe(200);
    expect(
      procura.json<{ dados: { id: string }[] }>().dados.map((a) => a.id),
    ).toEqual([primeira.json<Ficha>().id]);
  });

  it("o corpo do Hub recusa o que fica de fora (400) e pela chave continua a aceitar-se", async () => {
    const c = await comerciante("Loja Criacao Fora");
    const p = await h.pessoaCom(c.id, "dono");
    const base_ = artigoNovo();
    const variante = base_.variantes[0] ?? {};
    const recusados: [string, object][] = [
      ["categoria_fiscal", { ...base_, categoria_fiscal: "normal" }],
      ["tipo servico", { ...base_, tipo: "servico" }],
      ["tipo digital", { ...base_, tipo: "digital" }],
      ["origem_ref", { ...base_, origem_ref: "ERP-1" }],
      ["onu", { ...base_, variantes: [{ ...variante, onu: "UN1263" }] }],
      [
        "classe_adr",
        { ...base_, variantes: [{ ...variante, classe_adr: "3" }] },
      ],
      ["posicao", { ...base_, variantes: [{ ...variante, posicao: 0 }] }],
      ["sem variantes", { ...base_, variantes: [] }],
      [
        "21 variantes",
        {
          ...base_,
          variantes: Array.from({ length: 21 }, (_, i) => ({
            sku: `V21-${String(i)}-${randomUUID()}`,
            unidade_de_venda: "unidade",
          })),
        },
      ],
    ];
    for (const [nome, corpo] of recusados) {
      const r = await h.pedir("POST", "/hub/products", {
        sessao: p.sessao,
        comerciante: c.id,
        corpo,
      });
      expect(r.statusCode, nome).toBe(400);
    }
    expect(await contarArtigos(c.id)).toBe(0);
    // Pela chave, a categoria fiscal, as mercadorias perigosas, a posição e
    // outro tipo entram (revisão do #223, P3-1).
    const pelaChave = await comChave(c.segredo, "POST", "/products", {
      ...base_,
      categoria_fiscal: "normal",
      variantes: [{ ...variante, onu: "UN1263", classe_adr: "3", posicao: 0 }],
    });
    expect(pelaChave.statusCode, pelaChave.body).toBe(201);
    const servico = await comChave(c.segredo, "POST", "/products", {
      tipo: "servico",
      nome: "Aplicação de verniz",
      variantes: [{ sku: `S-${randomUUID()}`, unidade_de_venda: "unidade" }],
    });
    expect(servico.statusCode, servico.body).toBe(201);
    // Vinte variantes entram pelo Hub.
    const vinte = await h.pedir("POST", "/hub/products", {
      sessao: p.sessao,
      comerciante: c.id,
      corpo: {
        ...base_,
        variantes: Array.from({ length: 20 }, (_, i) => ({
          sku: `V20-${String(i)}-${randomUUID()}`,
          unidade_de_venda: "unidade",
        })),
      },
    });
    expect(vinte.statusCode, vinte.body).toBe(201);
  });

  it("a API valida as variantes como pela chave: GTIN sem origem, GTIN inválido, conteúdo incompleto", async () => {
    const c = await comerciante("Loja Criacao Validacao");
    const p = await h.pessoaCom(c.id, "dono");
    const casos: [object, number, string][] = [
      [{ gtin: "5601234567892" }, 400, "request.invalid"],
      [
        { gtin: "5601234567897", gtin_origem: "fornecedor" },
        422,
        "catalog.gtin_invalid",
      ],
      [{ conteudo_quantidade: 15 }, 422, "catalog.content_incomplete"],
    ];
    for (const [extra, estado, codigo] of casos) {
      const r = await h.pedir("POST", "/hub/products", {
        sessao: p.sessao,
        comerciante: c.id,
        corpo: {
          tipo: "fisico",
          nome: "Verniz",
          variantes: [
            {
              sku: `X-${randomUUID()}`,
              unidade_de_venda: "unidade",
              ...extra,
            },
          ],
        },
      });
      expect(r.statusCode, r.body).toBe(estado);
      expect(h.codigo(r)).toBe(codigo);
    }
    expect(await contarArtigos(c.id)).toBe(0);
  });

  it("o armazém e o apoio não criam (403); membro que saiu, sessão terminada, sem a origem do Hub e sem JSON são recusados", async () => {
    const c = await comerciante("Loja Criacao Recusas");
    for (const papel of ["armazem", "apoio"] as const) {
      const p = await h.pessoaCom(c.id, papel);
      const r = await h.pedir("POST", "/hub/products", {
        sessao: p.sessao,
        comerciante: c.id,
        corpo: artigoNovo(),
      });
      expect(r.statusCode, papel).toBe(403);
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
    const saiu = await h.pedir("POST", "/hub/products", {
      sessao: gestor.sessao,
      comerciante: c.id,
      corpo: artigoNovo(),
    });
    expect(saiu.statusCode).toBe(403);
    const dono = await h.pessoaCom(c.id, "dono");
    const semOrigem = await h.pedir("POST", "/hub/products", {
      sessao: dono.sessao,
      comerciante: c.id,
      origem: null,
      corpo: artigoNovo(),
    });
    expect(semOrigem.statusCode).toBe(403);
    const semJson = await h.app.inject({
      method: "POST",
      url: "/hub/products",
      headers: {
        origin: "https://hub.exemplo.test",
        cookie: `__Host-eurolify_sessao=${dono.sessao}`,
        "eurolify-comerciante": `mer_${c.id}`,
        "content-type": "text/plain",
      },
      payload: "nome=Não entra",
    });
    expect(semJson.statusCode).toBe(415);
    const fim = await h.pedir("POST", "/hub/session/end", {
      sessao: dono.sessao,
      corpo: {},
    });
    expect(fim.statusCode).toBe(200);
    const terminada = await h.pedir("POST", "/hub/products", {
      sessao: dono.sessao,
      comerciante: c.id,
      corpo: artigoNovo(),
    });
    expect(terminada.statusCode).toBe(401);
    expect(await contarArtigos(c.id)).toBe(0);
  });

  it("o contrato tem o POST /hub/products com a sessão e as mesmas respostas da chave", async () => {
    const contrato = (await h.app.inject({ url: "/openapi.json" })).json<{
      paths: Record<
        string,
        Record<string, { security?: unknown; responses?: unknown }>
      >;
    }>();
    const doHub = contrato.paths["/hub/products"]?.post;
    expect(doHub?.security).toEqual([{ sessao: [] }]);
    expect(JSON.stringify(doHub?.responses)).toBe(
      JSON.stringify(contrato.paths["/products"]?.post?.responses),
    );
  });
});
