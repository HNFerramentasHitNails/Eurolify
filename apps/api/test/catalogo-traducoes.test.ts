import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  criarCategoria,
  criarColecao,
  alterarColecao,
} from "../src/catalogo/categorias.js";
import {
  acrescentarValor,
  alterarArtigo,
  apagarRascunho,
  criarArtigo,
  criarOpcao,
  ErroCatalogo,
  mudarEstadoArtigo,
  traduzir,
} from "../src/catalogo/repositorio.js";
import {
  apagarTraducao,
  definirTraducao,
  filaDeTraducoes,
  reverTraducao,
  traducoesDoRecurso,
  type DadosTraducao,
} from "../src/catalogo/traducoes.js";
import {
  comComerciante,
  ErroComerciante,
  obterComerciante,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Catálogo, parte 3b: traduções (docs/14 §3.8 e §4.3; migração 0008; issue
// #77), contra o PostgreSQL 18 verdadeiro e com o eurolify_api.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };
const QUEM = "ana@exemplo.eu";

async function codigoDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroCatalogo || erro instanceof ErroComerciante) {
      return erro.codigo;
    }
    const pgErro = erro as { code?: unknown; message?: unknown };
    return `pg:${String(pgErro.code)}:${String(pgErro.message)}`;
  }
  return "sem erro";
}

describe.skipIf(URL_BASE === undefined)("traduções na base", () => {
  let base: BaseDeTeste;

  beforeAll(async () => {
    base = await criarBaseDeTeste(URL_BASE ?? "");
  }, 60_000);

  afterAll(async () => {
    await base.fechar();
  });

  async function sqlComo(c: string, texto: string, quem?: string) {
    try {
      return await comComerciante(base.api, c, async (trx) => {
        if (quem !== undefined) {
          await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(
            trx,
          );
        }
        return sql.raw(texto).execute(trx);
      });
    } catch (erro) {
      throw traduzir(erro);
    }
  }

  async function transaccaoAberta(c: string, texto: string) {
    const cliente = new pg.Client({ connectionString: base.urlApi });
    cliente.on("error", () => undefined);
    try {
      await cliente.connect();
      await cliente.query("begin");
      await cliente.query(
        "select set_config('eurolify.comerciante', $1, true)",
        [c],
      );
      await cliente.query(texto);
    } catch (erro) {
      await cliente.end().catch(() => undefined);
      throw erro;
    }
    return {
      fechar: async () => {
        try {
          await cliente.query("commit");
        } finally {
          await cliente.end();
        }
      },
    };
  }

  async function esperaBloqueio(promessa: Promise<unknown>): Promise<boolean> {
    const estado = { acabou: false };
    const fim = () => {
      estado.acabou = true;
    };
    promessa.then(fim, fim);
    for (let i = 0; i < 100 && !estado.acabou; i++) {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`.execute(
        base.dono,
      );
      if ((rows[0]?.n ?? 0) > 0) return true;
      await new Promise((r) => {
        setTimeout(r, 50);
      });
    }
    return false;
  }

  /** Um comerciante (origem pt) com o artigo «Gel de construção». */
  async function gel() {
    const c = await registarComerciante(base.api, NOVO);
    const artigo = await criarArtigo(
      base.api,
      c,
      { tipo: "fisico", nome: "Gel de construção", descricao: "Gel UV" },
      [{ sku: "GEL-1", unidade_de_venda: "unidade" }],
    );
    return { c, artigo };
  }

  const nomeEs = (artigo: string): DadosTraducao => ({
    tipo: "artigo",
    recursoId: artigo,
    campo: "nome",
    lingua: "es",
    texto: "Gel de construcción",
    origem: "pessoa",
  });

  it("a língua de origem é do comerciante: a dada ou, sem ela, a do Hub", async () => {
    const pt = await registarComerciante(base.api, NOVO);
    expect((await obterComerciante(base.api, pt)).lingua_origem).toBe("pt");
    const es = await registarComerciante(base.api, {
      ...NOVO,
      lingua_origem: "es",
    });
    expect(await obterComerciante(base.api, es)).toMatchObject({
      lingua: "pt",
      lingua_origem: "es",
    });
  });

  it("a língua de origem muda sem catálogo e fica fixa com um artigo, uma categoria ou uma colecção", async () => {
    const mudar = (c: string, l: string) =>
      sqlComo(
        c,
        `update comerciante set lingua_origem = '${l}' where id = '${c}'`,
      );
    const vazio = await registarComerciante(base.api, NOVO);
    expect(await codigoDoErro(mudar(vazio, "fr"))).toBe("sem erro");
    expect((await obterComerciante(base.api, vazio)).lingua_origem).toBe("fr");
    const comArtigo = (await gel()).c;
    const comCategoria = await registarComerciante(base.api, NOVO);
    await criarCategoria(base.api, comCategoria, {
      nome: "Unhas",
      endereco_amigavel: "unhas",
    });
    const comColecao = await registarComerciante(base.api, NOVO);
    await criarColecao(base.api, comColecao, {
      nome: "Outono",
      endereco_amigavel: "outono",
    });
    for (const c of [comArtigo, comCategoria, comColecao]) {
      expect(await codigoDoErro(mudar(c, "es"))).toBe(
        "merchant.origin_language_locked",
      );
    }
    // Outra mudança do comerciante continua livre.
    expect(
      await codigoDoErro(
        sqlComo(
          comArtigo,
          `update comerciante set fuso = 'Europe/Madrid' where id = '${comArtigo}'`,
        ),
      ),
    ).toBe("sem erro");
  });

  it("traduz, fica desactualizada quando o original muda e completa outra vez ao confirmar", async () => {
    const { c, artigo } = await gel();
    await definirTraducao(base.api, c, QUEM, nomeEs(artigo));
    expect(await traducoesDoRecurso(base.api, c, artigo)).toMatchObject([
      {
        campo: "nome",
        lingua: "es",
        texto: "Gel de construcción",
        estado: "completa",
        origem: "pessoa",
        traduzidoPor: QUEM,
        revistoPor: null,
      },
    ]);
    // Activar sobe a versão do artigo, mas o nome não mudou: continua completa.
    await mudarEstadoArtigo(base.api, c, artigo, 1, "activo");
    expect((await traducoesDoRecurso(base.api, c, artigo))[0]?.estado).toBe(
      "completa",
    );
    await alterarArtigo(base.api, c, artigo, 2, { nome: "Gel construtor" });
    expect((await traducoesDoRecurso(base.api, c, artigo))[0]?.estado).toBe(
      "desactualizada",
    );
    // A descrição não mudou: uma tradução dela fica completa.
    await definirTraducao(base.api, c, QUEM, {
      ...nomeEs(artigo),
      campo: "descricao",
      texto: "Gel UV",
    });
    // Confirmar o mesmo texto contra o original de agora.
    await definirTraducao(base.api, c, "rui@exemplo.eu", nomeEs(artigo));
    expect(await traducoesDoRecurso(base.api, c, artigo)).toMatchObject([
      { campo: "descricao", estado: "completa" },
      { campo: "nome", estado: "completa", traduzidoPor: "rui@exemplo.eu" },
    ]);
  });

  it("recusa a língua de origem, um campo sem original, campos e línguas fora da lista e texto vazio", async () => {
    const { c, artigo } = await gel();
    expect(
      await codigoDoErro(
        definirTraducao(base.api, c, QUEM, { ...nomeEs(artigo), lingua: "pt" }),
      ),
    ).toBe("catalog.translation_same_language");
    const semDescricao = await criarArtigo(base.api, c, {
      tipo: "fisico",
      nome: "Lima",
    });
    expect(
      await codigoDoErro(
        definirTraducao(base.api, c, QUEM, {
          ...nomeEs(semDescricao),
          campo: "descricao",
        }),
      ),
    ).toBe("catalog.translation_no_original");
    for (const mau of [
      { campo: "sku" },
      { campo: "valor" },
      { lingua: "ES" },
      { lingua: "esp" },
      { texto: "   " },
    ]) {
      expect(
        await codigoDoErro(
          definirTraducao(base.api, c, QUEM, { ...nomeEs(artigo), ...mau }),
        ),
        JSON.stringify(mau),
      ).toBe("catalog.invalid_field");
    }
    expect(await traducoesDoRecurso(base.api, c, artigo)).toEqual([]);
  });

  it("quem traduz é obrigatório e vem da sessão; a API não escolhe o original, quem, datas nem a revisão", async () => {
    const { c, artigo } = await gel();
    expect(
      await codigoDoErro(definirTraducao(base.api, c, "  ", nomeEs(artigo))),
    ).toBe("catalog.translated_by_required");
    const inserir = `insert into traducao (comerciante_id, artigo_id, campo, lingua, texto, origem) values ('${c}', '${artigo}', 'nome', 'es', 'Gel', 'pessoa')`;
    expect(await codigoDoErro(sqlComo(c, inserir))).toBe(
      "catalog.translated_by_required",
    );
    await sqlComo(c, inserir, QUEM);
    const recusadas = [
      `insert into traducao (comerciante_id, artigo_id, campo, lingua, texto, origem, original) values ('${c}', '${artigo}', 'nome', 'fr', 'Gel', 'pessoa', 'x')`,
      `insert into traducao (comerciante_id, artigo_id, campo, lingua, texto, origem, traduzido_por) values ('${c}', '${artigo}', 'nome', 'fr', 'Gel', 'pessoa', 'x')`,
      `update traducao set original = 'x'`,
      `update traducao set traduzido_por = 'x'`,
      `update traducao set traduzido_em = now()`,
      `update traducao set revisto_por = 'x'`,
      `update traducao set lingua = 'fr'`,
      `update traducao set artigo_id = '${artigo}'`,
    ];
    for (const texto of recusadas) {
      expect(await codigoDoErro(sqlComo(c, texto, QUEM)), texto).toMatch(
        /^pg:42501:/,
      );
    }
  });

  it("revisão: só numa proposta de IA, com quem reviu; traduzir outra vez apaga-a e não se desfaz à mão", async () => {
    const { c, artigo } = await gel();
    await definirTraducao(base.api, c, QUEM, nomeEs(artigo));
    expect(
      await codigoDoErro(
        reverTraducao(base.api, c, "rui@exemplo.eu", artigo, "nome", "es"),
      ),
    ).toBe("catalog.translation_not_ai");
    await definirTraducao(base.api, c, "assistente-ia", {
      ...nomeEs(artigo),
      origem: "ia",
    });
    expect(
      await codigoDoErro(reverTraducao(base.api, c, "", artigo, "nome", "es")),
    ).toBe("catalog.translated_by_required");
    await reverTraducao(base.api, c, "rui@exemplo.eu", artigo, "nome", "es");
    expect((await traducoesDoRecurso(base.api, c, artigo))[0]).toMatchObject({
      origem: "ia",
      traduzidoPor: "assistente-ia",
      revistoPor: "rui@exemplo.eu",
    });
    expect(
      await codigoDoErro(
        sqlComo(c, `update traducao set revista = false`, QUEM),
      ),
    ).toBe("catalog.invalid_transition");
    await definirTraducao(base.api, c, "assistente-ia", {
      ...nomeEs(artigo),
      texto: "Gel constructor",
      origem: "ia",
    });
    expect((await traducoesDoRecurso(base.api, c, artigo))[0]).toMatchObject({
      texto: "Gel constructor",
      revistoPor: null,
      revistoEm: null,
    });
    expect(
      await codigoDoErro(
        reverTraducao(base.api, c, QUEM, artigo, "nome", "fr"),
      ),
    ).toBe("catalog.not_found");
  });

  it("todos os recursos traduzíveis, e o endereço traduzido com o formato e único por língua", async () => {
    const { c, artigo } = await gel();
    const cor = await criarOpcao(base.api, c, artigo, "Cor", ["Vermelho 12"]);
    const valor = cor.valores[0]?.id ?? "";
    await acrescentarValor(base.api, c, cor.id, "Nude 3");
    const unhas = await criarCategoria(base.api, c, {
      nome: "Unhas",
      endereco_amigavel: "unhas",
    });
    const pes = await criarCategoria(base.api, c, {
      nome: "Pés",
      endereco_amigavel: "pes",
    });
    const col = await criarColecao(base.api, c, {
      nome: "Outono",
      endereco_amigavel: "outono",
      descricao: "O que chegou em Outubro",
    });
    const t = (
      tipo: DadosTraducao["tipo"],
      recursoId: string,
      campo: string,
      texto: string,
      lingua = "es",
    ) =>
      definirTraducao(base.api, c, QUEM, {
        tipo,
        recursoId,
        campo,
        lingua,
        texto,
        origem: "pessoa",
      });
    await t("opcao", cor.id, "nome", "Color");
    await t("valor_opcao", valor, "valor", "Rojo 12");
    await t("categoria", unhas, "nome", "Uñas");
    await t("categoria", unhas, "endereco_amigavel", "unas");
    await t("colecao", col, "descricao", "Lo que llegó en octubre");
    await t("colecao", col, "endereco_amigavel", "unas");
    expect(
      await codigoDoErro(t("categoria", pes, "endereco_amigavel", "Uñas")),
    ).toBe("catalog.slug_invalid");
    expect(
      await codigoDoErro(
        t("categoria", pes, "endereco_amigavel", "a".repeat(101)),
      ),
    ).toBe("catalog.slug_invalid");
    expect(
      await codigoDoErro(t("categoria", pes, "endereco_amigavel", "unas")),
    ).toBe("catalog.slug_duplicate");
    // Noutra língua, o mesmo endereço está livre.
    await t("categoria", pes, "endereco_amigavel", "unas", "fr");
    // O campo tem de ser do recurso (o valor da opção não tem nome).
    expect(await codigoDoErro(t("valor_opcao", valor, "nome", "Rojo"))).toBe(
      "catalog.invalid_field",
    );
    expect(await traducoesDoRecurso(base.api, c, col)).toMatchObject([
      { campo: "descricao", estado: "completa" },
      { campo: "endereco_amigavel", texto: "unas" },
    ]);
    // Mudar o original da colecção marca a tradução da descrição.
    await alterarColecao(base.api, c, col, 1, { descricao: "Outubro" });
    expect((await traducoesDoRecurso(base.api, c, col))[0]?.estado).toBe(
      "desactualizada",
    );
  });

  it("a fila de uma língua: em falta e desactualizadas; para a língua de origem não há fila", async () => {
    const { c, artigo } = await gel();
    const semDescricao = await criarArtigo(base.api, c, {
      tipo: "fisico",
      nome: "Lima",
    });
    const fila = await filaDeTraducoes(base.api, c, "es");
    expect(fila).toHaveLength(3);
    expect(fila).toEqual(
      expect.arrayContaining([
        {
          tipo: "artigo",
          recursoId: artigo,
          campo: "nome",
          estado: "em_falta",
        },
        {
          tipo: "artigo",
          recursoId: artigo,
          campo: "descricao",
          estado: "em_falta",
        },
        {
          tipo: "artigo",
          recursoId: semDescricao,
          campo: "nome",
          estado: "em_falta",
        },
      ]),
    );
    await definirTraducao(base.api, c, QUEM, nomeEs(artigo));
    await definirTraducao(base.api, c, QUEM, {
      ...nomeEs(artigo),
      campo: "descricao",
      texto: "Gel UV",
    });
    await alterarArtigo(base.api, c, artigo, 1, { descricao: "Gel UV 15 ml" });
    expect(await filaDeTraducoes(base.api, c, "es")).toEqual(
      [
        {
          tipo: "artigo",
          recursoId: artigo,
          campo: "descricao",
          estado: "desactualizada",
        },
        {
          tipo: "artigo",
          recursoId: semDescricao,
          campo: "nome",
          estado: "em_falta",
        },
      ].sort((a, b) =>
        (a.recursoId + a.campo).localeCompare(b.recursoId + b.campo),
      ),
    );
    // Em francês falta tudo.
    expect(await filaDeTraducoes(base.api, c, "fr")).toHaveLength(3);
    expect(await codigoDoErro(filaDeTraducoes(base.api, c, "pt"))).toBe(
      "catalog.translation_same_language",
    );
  });

  it("o comerciante de outro não se vê nem se usa; apagar o rascunho apaga as traduções", async () => {
    const { c, artigo } = await gel();
    const outro = await registarComerciante(base.api, NOVO);
    expect(
      await codigoDoErro(
        definirTraducao(base.api, outro, QUEM, nomeEs(artigo)),
      ),
    ).toBe("catalog.not_found");
    await definirTraducao(base.api, c, QUEM, nomeEs(artigo));
    expect(await traducoesDoRecurso(base.api, outro, artigo)).toEqual([]);
    // A vista dos originais só mostra os do próprio (security_invoker).
    const { rows: vistos } = (await sqlComo(
      outro,
      `select count(*)::int as n from texto_original`,
    )) as { rows: { n: number }[] };
    expect(vistos[0]?.n).toBe(0);
    const { rows: traducoesVistas } = (await sqlComo(
      outro,
      `select count(*)::int as n from traducao`,
    )) as { rows: { n: number }[] };
    expect(traducoesVistas[0]?.n).toBe(0);
    expect(
      await codigoDoErro(apagarTraducao(base.api, outro, artigo, "nome", "es")),
    ).toBe("catalog.not_found");
    expect(await filaDeTraducoes(base.api, outro, "es")).toEqual([]);
    // O mesmo id em maiúsculas é o mesmo recurso.
    await definirTraducao(base.api, c, QUEM, {
      ...nomeEs(artigo.toUpperCase()),
      texto: "Gel",
    });
    expect(await traducoesDoRecurso(base.api, c, artigo)).toMatchObject([
      { texto: "Gel" },
    ]);
    await apagarRascunho(base.api, c, artigo);
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from traducao where artigo_id = ${artigo}`.execute(
      base.dono,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("apagar uma tradução passa-a a «em falta»", async () => {
    const { c, artigo } = await gel();
    await definirTraducao(base.api, c, QUEM, nomeEs(artigo));
    await apagarTraducao(base.api, c, artigo, "nome", "es");
    expect(await traducoesDoRecurso(base.api, c, artigo)).toEqual([]);
    expect(
      (await filaDeTraducoes(base.api, c, "es")).map((l) => l.campo).sort(),
    ).toEqual(["descricao", "nome"]);
  });

  it("mudar a língua de origem ao mesmo tempo que se traduz para ela: a tradução espera e é recusada", async () => {
    const c = await registarComerciante(base.api, NOVO);
    // Sem catálogo: a mudança para es é permitida, mas fica por confirmar.
    const t1 = await transaccaoAberta(
      c,
      `update comerciante set lingua_origem = 'es' where id = '${c}'`,
    );
    const artigo = await criarArtigo(base.api, c, {
      tipo: "fisico",
      nome: "Gel",
    });
    const traduzir = codigoDoErro(
      definirTraducao(base.api, c, QUEM, { ...nomeEs(artigo), texto: "Gel" }),
    );
    expect(await esperaBloqueio(traduzir)).toBe(true);
    await t1.fechar();
    expect(await traduzir).toBe("catalog.translation_same_language");
  });
});
