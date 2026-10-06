import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ESTADOS_CATEGORIA } from "../src/base/esquema.js";
import {
  alterarCategoria,
  alterarColecao,
  artigosDaColecao,
  categoriasDoArtigo,
  categoriasDoComerciante,
  criarCategoria,
  criarColecao,
  definirArtigosDaColecao,
  definirCategoriasDoArtigo,
  moverCategoria,
  mudarEstadoCategoria,
  mudarEstadoColecao,
  obterCategoria,
  obterColecao,
} from "../src/catalogo/categorias.js";
import {
  apagarRascunho,
  criarArtigo,
  ErroCatalogo,
  obterArtigo,
  traduzir,
} from "../src/catalogo/repositorio.js";
import {
  comComerciante,
  registarComerciante,
} from "../src/comerciante/repositorio.js";
import {
  criarBaseDeTeste,
  URL_BASE,
  type BaseDeTeste,
} from "./base-de-teste.js";

// Catálogo, parte 3a: categorias e colecções (docs/14 §3.6 e §3.7; migração
// 0007; issue #77), contra o PostgreSQL 18 verdadeiro e com o eurolify_api.

const NOVO = { nome: "Loja de Teste", lingua: "pt", fuso: "Europe/Lisbon" };

async function codigoDoErro(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroCatalogo) return erro.codigo;
    const pgErro = erro as { code?: unknown; message?: unknown };
    return `pg:${String(pgErro.code)}:${String(pgErro.message)}`;
  }
  return "sem erro";
}

// Corre sem base: as chaves primárias das ligações (a lista repetida é
// recusada antes, no repositório; a base é a rede).
it("as chaves das ligações traduzem-se para os códigos da lista repetida", () => {
  const erro = (constraint: string, table: string) =>
    Object.assign(new Error("dup"), { code: "23505", constraint, table });
  expect(
    (
      traduzir(
        erro("artigo_categoria_pkey", "artigo_categoria"),
      ) as ErroCatalogo
    ).codigo,
  ).toBe("catalog.category_duplicate");
  expect(
    (traduzir(erro("colecao_artigo_pkey", "colecao_artigo")) as ErroCatalogo)
      .codigo,
  ).toBe("catalog.collection_product_duplicate");
});

describe.skipIf(URL_BASE === undefined)(
  "categorias e colecções na base",
  () => {
    let base: BaseDeTeste;

    beforeAll(async () => {
      base = await criarBaseDeTeste(URL_BASE ?? "");
    }, 60_000);

    afterAll(async () => {
      await base.fechar();
    });

    async function sqlComo(c: string, texto: string) {
      try {
        return await comComerciante(base.api, c, (trx) =>
          sql.raw(texto).execute(trx),
        );
      } catch (erro) {
        throw traduzir(erro);
      }
    }

    /** Uma transacção do eurolify_api que fica aberta até `fechar`. */
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
        consulta: async (mais: string) => {
          await cliente.query(mais);
        },
        fechar: async () => {
          try {
            await cliente.query("commit");
          } finally {
            await cliente.end();
          }
        },
      };
    }

    async function esperaBloqueio(
      promessa: Promise<unknown>,
    ): Promise<boolean> {
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

    /** Unhas > Gel > Construção, numa árvore de um comerciante novo. */
    async function arvore() {
      const c = await registarComerciante(base.api, NOVO);
      const unhas = await criarCategoria(base.api, c, {
        nome: "Unhas",
        endereco_amigavel: "unhas",
      });
      const gel = await criarCategoria(base.api, c, {
        nome: "Unhas de gel",
        endereco_amigavel: "unhas-de-gel",
        pai_id: unhas,
      });
      const construcao = await criarCategoria(base.api, c, {
        nome: "Gel de construção",
        endereco_amigavel: "gel-de-construcao",
        pai_id: gel,
      });
      return { c, unhas, gel, construcao };
    }

    async function artigo(c: string, nome: string) {
      return criarArtigo(base.api, c, { tipo: "fisico", nome }, [
        { sku: nome.toUpperCase(), unidade_de_venda: "unidade" },
      ]);
    }

    it("os estados do código são os que a base aceita", async () => {
      for (const restricao of [
        "categoria_estado_check",
        "colecao_estado_check",
      ]) {
        const { rows } = await sql<{ definicao: string }>`
        select pg_get_constraintdef(oid) as definicao from pg_constraint
        where conname = ${restricao}`.execute(base.dono);
        const naBase = [
          ...(rows[0]?.definicao ?? "").matchAll(/'([a-z_]+)'/g),
        ].map((m) => m[1]);
        expect(naBase, restricao).toEqual([...ESTADOS_CATEGORIA]);
      }
    });

    it("cria a árvore, lê-a pela ordem e muda nome, endereço e posição com a versão", async () => {
      const { c, unhas, gel, construcao } = await arvore();
      const pes = await criarCategoria(base.api, c, {
        nome: "Pés",
        endereco_amigavel: "pes",
        posicao: 1,
      });
      const lista = await categoriasDoComerciante(base.api, c);
      expect(lista.map((l) => l.id)).toEqual([unhas, pes, gel, construcao]);
      expect(await obterCategoria(base.api, c, gel)).toMatchObject({
        pai_id: unhas,
        estado: "activa",
        versao: 1,
      });
      const v2 = await alterarCategoria(base.api, c, gel, 1, {
        nome: "Gel",
        endereco_amigavel: "gel",
        posicao: 3,
      });
      expect(v2).toBe(2);
      // Nada para mudar: a versão fica.
      expect(
        await alterarCategoria(base.api, c, gel, 2, { nome: undefined }),
      ).toBe(2);
      expect(
        await codigoDoErro(
          alterarCategoria(base.api, c, gel, 1, { nome: "X" }),
        ),
      ).toBe("catalog.version_conflict");
      expect(await obterCategoria(base.api, c, gel)).toMatchObject({
        nome: "Gel",
        endereco_amigavel: "gel",
        posicao: 3,
        versao: 2,
      });
    });

    it("recusa ciclos: dentro de si própria, de uma filha ou de uma neta", async () => {
      const { c, unhas, gel, construcao } = await arvore();
      expect(
        await codigoDoErro(moverCategoria(base.api, c, unhas, 1, unhas)),
      ).toBe("catalog.category_cycle");
      expect(
        await codigoDoErro(moverCategoria(base.api, c, unhas, 1, gel)),
      ).toBe("catalog.category_cycle");
      expect(
        await codigoDoErro(moverCategoria(base.api, c, unhas, 1, construcao)),
      ).toBe("catalog.category_cycle");
      // Para a raiz e para debaixo de uma irmã, sim.
      expect(await moverCategoria(base.api, c, construcao, 1, null)).toBe(2);
      expect(await moverCategoria(base.api, c, construcao, 2, unhas)).toBe(3);
      expect(await obterCategoria(base.api, c, construcao)).toMatchObject({
        pai_id: unhas,
      });
    });

    it("dois movimentos ao mesmo tempo não fecham um ciclo de quatro (fila das categorias)", async () => {
      // X1 > Y2 e X2 > Y1. Mover X1 para dentro de Y1 e X2 para dentro de Y2
      // fechava X1 > Y2 > X2 > Y1 > X1. As duas escritas não tocam nas mesmas
      // linhas (cada uma prende a sua e a do pai novo): só a fila do comerciante
      // as põe uma depois da outra.
      const c = await registarComerciante(base.api, NOVO);
      const nova = (nome: string, pai_id?: string) =>
        criarCategoria(base.api, c, {
          nome,
          endereco_amigavel: nome.toLowerCase(),
          pai_id: pai_id ?? null,
        });
      const x1 = await nova("X1");
      const y2 = await nova("Y2", x1);
      const x2 = await nova("X2");
      const y1 = await nova("Y1", x2);
      const t1 = await transaccaoAberta(
        c,
        `update categoria set pai_id = '${y1}' where id = '${x1}'`,
      );
      const segundo = codigoDoErro(moverCategoria(base.api, c, x2, 1, y2));
      expect(await esperaBloqueio(segundo)).toBe(true);
      await t1.fechar();
      expect(await segundo).toBe("catalog.category_cycle");
      expect((await obterCategoria(base.api, c, x2)).pai_id).toBeNull();
    });

    it("uma categoria activa não fica dentro de uma arquivada; com filhas activas não se arquiva", async () => {
      const { c, unhas, gel, construcao } = await arvore();
      expect(
        await codigoDoErro(
          mudarEstadoCategoria(base.api, c, gel, 1, "arquivada"),
        ),
      ).toBe("catalog.category_has_children");
      // Arquivar de baixo para cima.
      expect(
        await mudarEstadoCategoria(base.api, c, construcao, 1, "arquivada"),
      ).toBe(2);
      expect(await mudarEstadoCategoria(base.api, c, gel, 1, "arquivada")).toBe(
        2,
      );
      // Pedir o estado em que já está não muda a versão.
      expect(await mudarEstadoCategoria(base.api, c, gel, 2, "arquivada")).toBe(
        2,
      );
      expect(
        await codigoDoErro(
          criarCategoria(base.api, c, {
            nome: "Nova",
            endereco_amigavel: "nova",
            pai_id: gel,
          }),
        ),
      ).toBe("catalog.category_archived");
      // Repor a neta com a mãe arquivada: recusado.
      expect(
        await codigoDoErro(
          mudarEstadoCategoria(base.api, c, construcao, 2, "activa"),
        ),
      ).toBe("catalog.category_archived");
      // Mover uma activa para dentro de uma arquivada: recusado.
      const pes = await criarCategoria(base.api, c, {
        nome: "Pés",
        endereco_amigavel: "pes",
      });
      expect(await codigoDoErro(moverCategoria(base.api, c, pes, 1, gel))).toBe(
        "catalog.category_archived",
      );
      // De cima para baixo, repõe-se.
      expect(await mudarEstadoCategoria(base.api, c, gel, 2, "activa")).toBe(3);
      expect(
        await mudarEstadoCategoria(base.api, c, construcao, 2, "activa"),
      ).toBe(3);
      expect(await obterCategoria(base.api, c, unhas)).toMatchObject({
        estado: "activa",
        versao: 1,
      });
    });

    it("arquivar a mãe e criar uma filha ao mesmo tempo não deixa uma filha activa numa arquivada", async () => {
      const c = await registarComerciante(base.api, NOVO);
      const mae = await criarCategoria(base.api, c, {
        nome: "Mãe",
        endereco_amigavel: "mae",
      });
      const t1 = await transaccaoAberta(
        c,
        `update categoria set estado = 'arquivada' where id = '${mae}'`,
      );
      const filha = codigoDoErro(
        criarCategoria(base.api, c, {
          nome: "Filha",
          endereco_amigavel: "filha",
          pai_id: mae,
        }),
      );
      expect(await esperaBloqueio(filha)).toBe(true);
      await t1.fechar();
      expect(await filha).toBe("catalog.category_archived");
    });

    it.each([
      ["alterar", "sem erro"],
      ["mover", "sem erro"],
      ["arquivar", "catalog.category_has_children"],
    ])(
      "criar uma filha de B enquanto «%s» B espera pela fila: sem espera mútua (P1-1)",
      async (operacao, esperado) => {
        const c = await registarComerciante(base.api, NOVO);
        const b = await criarCategoria(base.api, c, {
          nome: "B",
          endereco_amigavel: "b",
        });
        const x = await criarCategoria(base.api, c, {
          nome: "X",
          endereco_amigavel: "x",
        });
        // Uma transacção já na fila das categorias (como o trigger a deixa).
        const t1 = await transaccaoAberta(
          c,
          `select pg_advisory_xact_lock(hashtextextended('eurolify.categoria:' || '${c}', 0))`,
        );
        // A escrita de B espera pela fila; não pode ter prendido a linha de B
        // antes.
        const escrita = codigoDoErro(
          operacao === "alterar"
            ? alterarCategoria(base.api, c, b, 1, { nome: "B novo" })
            : operacao === "mover"
              ? moverCategoria(base.api, c, b, 1, x)
              : mudarEstadoCategoria(base.api, c, b, 1, "arquivada"),
        );
        expect(await esperaBloqueio(escrita)).toBe(true);
        // A primeira cria uma filha de B: a chave estrangeira pede a linha de
        // B.
        await t1.consulta(
          `insert into categoria (comerciante_id, nome, endereco_amigavel, pai_id) values ('${c}', 'Filha', 'filha', '${b}')`,
        );
        await t1.fechar();
        expect(await escrita).toBe(esperado);
      },
    );

    it("duas alterações da mesma colecção ao mesmo tempo: a segunda vê a versão nova (P2-1)", async () => {
      const c = await registarComerciante(base.api, NOVO);
      const col = await criarColecao(base.api, c, {
        nome: "Outono",
        endereco_amigavel: "outono",
      });
      const t1 = await transaccaoAberta(
        c,
        `update colecao set nome = 'Inverno' where id = '${col}'`,
      );
      const segunda = codigoDoErro(
        alterarColecao(base.api, c, col, 1, { nome: "Primavera" }),
      );
      expect(await esperaBloqueio(segunda)).toBe(true);
      await t1.fechar();
      expect(await segunda).toBe("catalog.version_conflict");
      expect(await obterColecao(base.api, c, col)).toMatchObject({
        nome: "Inverno",
        versao: 2,
      });
    });

    it("um valor igual ao actual não sobe a versão (P3-2)", async () => {
      const { c, unhas, gel } = await arvore();
      expect(
        await alterarCategoria(base.api, c, gel, 1, {
          nome: "Unhas de gel",
          endereco_amigavel: "unhas-de-gel",
          posicao: 0,
        }),
      ).toBe(1);
      expect(await moverCategoria(base.api, c, gel, 1, unhas)).toBe(1);
      expect(await moverCategoria(base.api, c, unhas, 1, null)).toBe(1);
      const col = await criarColecao(base.api, c, {
        nome: "Outono",
        endereco_amigavel: "outono",
      });
      expect(
        await alterarColecao(base.api, c, col, 1, {
          nome: "Outono",
          descricao: null,
        }),
      ).toBe(1);
      expect(await mudarEstadoColecao(base.api, c, col, 1, "activa")).toBe(1);
      // Uma mudança a sério sobe.
      expect(
        await alterarColecao(base.api, c, col, 1, { descricao: "Nova" }),
      ).toBe(2);
    });

    it("posições negativas e o endereço em falta (P3-1)", async () => {
      const c = await registarComerciante(base.api, NOVO);
      expect(
        await codigoDoErro(
          criarCategoria(base.api, c, {
            nome: "X",
            endereco_amigavel: "x",
            posicao: -1,
          }),
        ),
      ).toBe("catalog.invalid_field");
      const col = await criarColecao(base.api, c, {
        nome: "X",
        endereco_amigavel: "x",
      });
      const a = await artigo(c, "gel-pos");
      expect(
        await codigoDoErro(
          sqlComo(
            c,
            `insert into colecao_artigo (comerciante_id, colecao_id, artigo_id, posicao) values ('${c}', '${col}', '${a}', -1)`,
          ),
        ),
      ).toBe("catalog.invalid_field");
      expect(
        await codigoDoErro(
          sqlComo(
            c,
            `insert into categoria (comerciante_id, nome) values ('${c}', 'Sem endereço')`,
          ),
        ),
      ).toBe("catalog.slug_invalid");
    });

    it("o endereço amigável: formato, único por comerciante, também entre as arquivadas", async () => {
      const { c, construcao } = await arvore();
      for (const mau of [
        "Unhas",
        "unhas de gel",
        "unhas-",
        "-unhas",
        "pés",
        "a--b",
        "",
      ]) {
        expect(
          await codigoDoErro(
            criarCategoria(base.api, c, { nome: "X", endereco_amigavel: mau }),
          ),
          mau,
        ).toBe("catalog.slug_invalid");
      }
      expect(
        await codigoDoErro(
          criarCategoria(base.api, c, {
            nome: "X",
            endereco_amigavel: "a".repeat(101),
          }),
        ),
      ).toBe("catalog.slug_invalid");
      // As mesmas regras na colecção (P2-2).
      for (const mau of [
        "Outono",
        "novidades de outono",
        "outono-",
        "ç",
        "a".repeat(101),
      ]) {
        expect(
          await codigoDoErro(
            criarColecao(base.api, c, { nome: "X", endereco_amigavel: mau }),
          ),
          mau,
        ).toBe("catalog.slug_invalid");
      }
      expect(
        await criarColecao(base.api, c, {
          nome: "X",
          endereco_amigavel: "a".repeat(100),
        }),
      ).toBeTypeOf("string");
      expect(
        await codigoDoErro(
          criarCategoria(base.api, c, {
            nome: "Outra",
            endereco_amigavel: "unhas",
          }),
        ),
      ).toBe("catalog.slug_duplicate");
      await mudarEstadoCategoria(base.api, c, construcao, 1, "arquivada");
      expect(
        await codigoDoErro(
          criarCategoria(base.api, c, {
            nome: "Outra",
            endereco_amigavel: "gel-de-construcao",
          }),
        ),
      ).toBe("catalog.slug_duplicate");
      // Noutro comerciante, e numa colecção do mesmo, o endereço está livre.
      const outro = await registarComerciante(base.api, NOVO);
      await criarCategoria(base.api, outro, {
        nome: "Unhas",
        endereco_amigavel: "unhas",
      });
      await criarColecao(base.api, c, {
        nome: "Unhas",
        endereco_amigavel: "unhas",
      });
      expect(
        await codigoDoErro(
          criarColecao(base.api, c, {
            nome: "Outra",
            endereco_amigavel: "unhas",
          }),
        ),
      ).toBe("catalog.slug_duplicate");
    });

    it("o nome: obrigatório, sem ser só espaços, até 200 caracteres", async () => {
      const c = await registarComerciante(base.api, NOVO);
      expect(
        await codigoDoErro(
          criarCategoria(base.api, c, { nome: "   ", endereco_amigavel: "x" }),
        ),
      ).toBe("catalog.name_required");
      expect(
        await codigoDoErro(
          criarColecao(base.api, c, { nome: "", endereco_amigavel: "x" }),
        ),
      ).toBe("catalog.name_required");
      expect(
        await codigoDoErro(
          criarCategoria(base.api, c, {
            nome: "x".repeat(201),
            endereco_amigavel: "x",
          }),
        ),
      ).toBe("catalog.invalid_field");
      expect(
        await codigoDoErro(
          criarColecao(base.api, c, {
            nome: "x".repeat(201),
            endereco_amigavel: "x",
          }),
        ),
      ).toBe("catalog.invalid_field");
      expect(
        await criarColecao(base.api, c, {
          nome: "x".repeat(200),
          endereco_amigavel: "y",
        }),
      ).toBeTypeOf("string");
    });

    it("o comerciante de outro não se vê nem se usa", async () => {
      const { c, unhas } = await arvore();
      const outro = await registarComerciante(base.api, NOVO);
      const doOutro = await criarCategoria(base.api, outro, {
        nome: "Do outro",
        endereco_amigavel: "do-outro",
      });
      expect(await codigoDoErro(obterCategoria(base.api, c, doOutro))).toBe(
        "catalog.not_found",
      );
      expect(await categoriasDoComerciante(base.api, outro)).toHaveLength(1);
      expect(
        await codigoDoErro(
          criarCategoria(base.api, c, {
            nome: "Filha",
            endereco_amigavel: "filha",
            pai_id: doOutro,
          }),
        ),
      ).toBe("catalog.not_found");
      expect(
        await codigoDoErro(moverCategoria(base.api, outro, doOutro, 1, unhas)),
      ).toBe("catalog.not_found");
      expect(
        await codigoDoErro(
          mudarEstadoCategoria(base.api, outro, unhas, 1, "arquivada"),
        ),
      ).toBe("catalog.not_found");
      const gel = await artigo(c, "gel-a");
      expect(
        await codigoDoErro(
          definirCategoriasDoArtigo(base.api, c, gel, 1, [doOutro]),
        ),
      ).toBe("catalog.not_found");
      const doOutroArtigo = await artigo(outro, "gel-b");
      const col = await criarColecao(base.api, c, {
        nome: "Novidades",
        endereco_amigavel: "novidades",
      });
      expect(
        await codigoDoErro(
          definirArtigosDaColecao(base.api, c, col, 1, [gel, doOutroArtigo]),
        ),
      ).toBe("catalog.not_found");
      expect(await artigosDaColecao(base.api, c, col)).toEqual([]);
      expect(await codigoDoErro(obterColecao(base.api, outro, col))).toBe(
        "catalog.not_found",
      );
    });

    it("a API não escolhe ids, estados, versões nem datas, e não apaga categorias nem colecções", async () => {
      const { c, unhas } = await arvore();
      const col = await criarColecao(base.api, c, {
        nome: "Novidades",
        endereco_amigavel: "novidades",
      });
      const recusadas = [
        `insert into categoria (id, comerciante_id, nome, endereco_amigavel) values (uuidv7(), '${c}', 'X', 'x')`,
        `insert into categoria (comerciante_id, nome, endereco_amigavel, estado) values ('${c}', 'X', 'x', 'arquivada')`,
        `update categoria set versao = 9 where id = '${unhas}'`,
        `update categoria set criado_em = now() where id = '${unhas}'`,
        `update categoria set comerciante_id = '${c}' where id = '${unhas}'`,
        `delete from categoria where id = '${unhas}'`,
        `insert into colecao (comerciante_id, nome, endereco_amigavel, versao) values ('${c}', 'X', 'x', 5)`,
        `update colecao set versao = 9 where id = '${col}'`,
        `update colecao set criado_em = now() where id = '${col}'`,
        `delete from colecao where id = '${col}'`,
        `update artigo_categoria set categoria_id = '${unhas}'`,
        `update colecao_artigo set posicao = 0`,
      ];
      for (const texto of recusadas) {
        expect(await codigoDoErro(sqlComo(c, texto)), texto).toMatch(
          /^pg:42501:/,
        );
      }
    });

    it("as categorias do artigo: substituir a lista sobe a versão do artigo; a mesma lista não", async () => {
      const { c, unhas, gel, construcao } = await arvore();
      const artigoId = await artigo(c, "gel-1");
      expect(
        await definirCategoriasDoArtigo(base.api, c, artigoId, 1, [gel, unhas]),
      ).toBe(2);
      expect(await categoriasDoArtigo(base.api, c, artigoId)).toEqual(
        [gel, unhas].sort(),
      );
      expect(
        await definirCategoriasDoArtigo(base.api, c, artigoId, 2, [unhas, gel]),
      ).toBe(2);
      expect(
        await codigoDoErro(
          definirCategoriasDoArtigo(base.api, c, artigoId, 1, [unhas]),
        ),
      ).toBe("catalog.version_conflict");
      expect(
        await codigoDoErro(
          definirCategoriasDoArtigo(base.api, c, artigoId, 2, [unhas, unhas]),
        ),
      ).toBe("catalog.category_duplicate");
      // Uma categoria arquivada que o artigo já tinha fica; uma nova, não.
      await mudarEstadoCategoria(base.api, c, construcao, 1, "arquivada");
      expect(
        await codigoDoErro(
          definirCategoriasDoArtigo(base.api, c, artigoId, 2, [
            gel,
            unhas,
            construcao,
          ]),
        ),
      ).toBe("catalog.category_archived");
      expect(await categoriasDoArtigo(base.api, c, artigoId)).toHaveLength(2);
      // Arquivar a categoria não tira o artigo (§3.6).
      const outro = await artigo(c, "gel-2");
      await mudarEstadoCategoria(base.api, c, construcao, 2, "activa");
      await definirCategoriasDoArtigo(base.api, c, outro, 1, [construcao]);
      await mudarEstadoCategoria(base.api, c, construcao, 3, "arquivada");
      expect(await categoriasDoArtigo(base.api, c, outro)).toEqual([
        construcao,
      ]);
      expect(
        await definirCategoriasDoArtigo(base.api, c, outro, 2, [
          construcao,
          gel,
        ]),
      ).toBe(3);
      expect(await categoriasDoArtigo(base.api, c, outro)).toEqual(
        [construcao, gel].sort(),
      );
      expect(await definirCategoriasDoArtigo(base.api, c, outro, 3, [])).toBe(
        4,
      );
      expect(await categoriasDoArtigo(base.api, c, outro)).toEqual([]);
    });

    it("a colecção: lista pela ordem, reordenar sobe a versão, repetidos recusados", async () => {
      const c = await registarComerciante(base.api, NOVO);
      const [a, b, d] = [
        await artigo(c, "gel-a"),
        await artigo(c, "gel-b"),
        await artigo(c, "gel-d"),
      ];
      const col = await criarColecao(base.api, c, {
        nome: "Novidades de Outono",
        endereco_amigavel: "novidades-de-outono",
        descricao: "O que chegou em Outubro",
      });
      expect(
        await definirArtigosDaColecao(base.api, c, col, 1, [b, a, d]),
      ).toBe(2);
      expect(await artigosDaColecao(base.api, c, col)).toEqual([b, a, d]);
      expect(
        await definirArtigosDaColecao(base.api, c, col, 2, [b, a, d]),
      ).toBe(2);
      expect(
        await definirArtigosDaColecao(base.api, c, col, 2, [d, a, b]),
      ).toBe(3);
      expect(await artigosDaColecao(base.api, c, col)).toEqual([d, a, b]);
      expect(
        await codigoDoErro(
          definirArtigosDaColecao(base.api, c, col, 3, [a, a]),
        ),
      ).toBe("catalog.collection_product_duplicate");
      expect(
        await codigoDoErro(definirArtigosDaColecao(base.api, c, col, 2, [a])),
      ).toBe("catalog.version_conflict");
      expect(
        await alterarColecao(base.api, c, col, 3, { nome: "Outono" }),
      ).toBe(4);
      expect(await mudarEstadoColecao(base.api, c, col, 4, "arquivada")).toBe(
        5,
      );
      expect(await obterColecao(base.api, c, col)).toMatchObject({
        nome: "Outono",
        estado: "arquivada",
        descricao: "O que chegou em Outubro",
      });
      expect(await definirArtigosDaColecao(base.api, c, col, 5, [])).toBe(6);
      expect(await artigosDaColecao(base.api, c, col)).toEqual([]);
    });

    it("apagar o rascunho de um artigo tira-o das categorias e das colecções", async () => {
      const { c, unhas } = await arvore();
      const fica = await artigo(c, "gel-fica");
      const sai = await artigo(c, "gel-sai");
      await definirCategoriasDoArtigo(base.api, c, sai, 1, [unhas]);
      const col = await criarColecao(base.api, c, {
        nome: "Novidades",
        endereco_amigavel: "novidades",
      });
      await definirArtigosDaColecao(base.api, c, col, 1, [sai, fica]);
      await apagarRascunho(base.api, c, sai);
      expect(await artigosDaColecao(base.api, c, col)).toEqual([fica]);
      const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from artigo_categoria where artigo_id = ${sai}`.execute(
        base.dono,
      );
      expect(rows[0]?.n).toBe(0);
      expect((await obterArtigo(base.api, c, fica)).versao).toBe(1);
    });

    it("apagar um rascunho que está a entrar numa colecção: um dá «não existe», sem esperar um pelo outro", async () => {
      const c = await registarComerciante(base.api, NOVO);
      const sai = await artigo(c, "gel-sai");
      const col = await criarColecao(base.api, c, {
        nome: "Novidades",
        endereco_amigavel: "novidades",
      });
      const t1 = await transaccaoAberta(
        c,
        `delete from artigo where id = '${sai}'`,
      );
      const entrar = codigoDoErro(
        definirArtigosDaColecao(base.api, c, col, 1, [sai]),
      );
      expect(await esperaBloqueio(entrar)).toBe(true);
      await t1.fechar();
      expect(await entrar).toBe("catalog.not_found");
      expect(await artigosDaColecao(base.api, c, col)).toEqual([]);
    });

    it("apagar um rascunho a meio de uma substituição da colecção: espera, sem bloqueio mútuo", async () => {
      const c = await registarComerciante(base.api, NOVO);
      const sai = await artigo(c, "gel-meio");
      const col = await criarColecao(base.api, c, {
        nome: "Meio",
        endereco_amigavel: "meio",
      });
      await definirArtigosDaColecao(base.api, c, col, 1, [sai]);
      // Uma pausa só de teste: a substituição pára depois de apagar as linhas
      // antigas da colecção (o DELETE dela, não o que vem em cascata), até a
      // chave 4242 ficar livre.
      await sql`
      create function pausa_de_teste() returns trigger language plpgsql as $$
      begin
        if pg_trigger_depth() = 1 then perform pg_advisory_xact_lock(4242); end if;
        return null;
      end $$`.execute(base.dono);
      await sql`
      create trigger pausa_de_teste after delete on colecao_artigo
      for each statement execute function pausa_de_teste()`.execute(base.dono);
      try {
        await base.dono.connection().execute(async (ligacao) => {
          await sql`select pg_advisory_lock(4242)`.execute(ligacao);
          try {
            // Uma lista diferente (a igual não escreve), com o artigo que se
            // vai apagar.
            const outro = await artigo(c, "gel-outro");
            const substituir = codigoDoErro(
              definirArtigosDaColecao(base.api, c, col, 2, [sai, outro]),
            );
            expect(await esperaBloqueio(substituir)).toBe(true);
            const apagar = codigoDoErro(apagarRascunho(base.api, c, sai));
            // O apagar tem de ficar à espera da substituição.
            await new Promise((r) => {
              setTimeout(r, 300);
            });
            await sql`select pg_advisory_unlock(4242)`.execute(ligacao);
            expect(await substituir).toBe("sem erro");
            expect(await apagar).toBe("sem erro");
          } finally {
            await sql`select pg_advisory_unlock_all()`.execute(ligacao);
          }
        });
      } finally {
        await sql`drop trigger pausa_de_teste on colecao_artigo`.execute(
          base.dono,
        );
        await sql`drop function pausa_de_teste()`.execute(base.dono);
      }
      expect(await artigosDaColecao(base.api, c, col)).toHaveLength(1);
    });

    it("entrar numa categoria que está a ser arquivada: espera e é recusado (2.ª revisão do #97, P3-A)", async () => {
      const { c, construcao } = await arvore();
      const artigoId = await artigo(c, "gel-p3a");
      const t1 = await transaccaoAberta(
        c,
        `update categoria set estado = 'arquivada' where id = '${construcao}'`,
      );
      const entrar = codigoDoErro(
        definirCategoriasDoArtigo(base.api, c, artigoId, 1, [construcao]),
      );
      const bloqueou = await esperaBloqueio(entrar);
      await t1.fechar();
      expect([bloqueou, await entrar]).toEqual([
        true,
        "catalog.category_archived",
      ]);
      expect(await categoriasDoArtigo(base.api, c, artigoId)).toEqual([]);
    });

    it("o mesmo id em maiúsculas é o mesmo id (2.ª revisão do #97, P3-B)", async () => {
      const { c, unhas, gel } = await arvore();
      expect(
        await moverCategoria(base.api, c, gel, 1, unhas.toUpperCase()),
      ).toBe(1);
      const a = await artigo(c, "gel-p3b");
      const b = await artigo(c, "gel-p3b2");
      expect(await definirCategoriasDoArtigo(base.api, c, a, 1, [unhas])).toBe(
        2,
      );
      expect(
        await definirCategoriasDoArtigo(base.api, c, a, 2, [
          unhas.toUpperCase(),
        ]),
      ).toBe(2);
      expect(
        await codigoDoErro(
          definirCategoriasDoArtigo(base.api, c, a, 2, [
            unhas,
            unhas.toUpperCase(),
          ]),
        ),
      ).toBe("catalog.category_duplicate");
      const col = await criarColecao(base.api, c, {
        nome: "P3B",
        endereco_amigavel: "p3b",
      });
      expect(await definirArtigosDaColecao(base.api, c, col, 1, [a, b])).toBe(
        2,
      );
      expect(
        await definirArtigosDaColecao(base.api, c, col, 2, [
          a.toUpperCase(),
          b,
        ]),
      ).toBe(2);
      expect(
        await codigoDoErro(
          definirArtigosDaColecao(base.api, c, col, 2, [a, a.toUpperCase()]),
        ),
      ).toBe("catalog.collection_product_duplicate");
    });

    it("um campo fora da lista é ignorado ao alterar (2.ª revisão do #97, P3-C)", async () => {
      const { c, gel } = await arvore();
      const fora = { estado: "arquivada", versao: 9 } as unknown as {
        nome?: string;
      };
      expect(await alterarCategoria(base.api, c, gel, 1, fora)).toBe(1);
      expect(await obterCategoria(base.api, c, gel)).toMatchObject({
        estado: "activa",
        versao: 1,
      });
      const col = await criarColecao(base.api, c, {
        nome: "P3C",
        endereco_amigavel: "p3c",
      });
      expect(await alterarColecao(base.api, c, col, 1, fora)).toBe(1);
    });
  },
);
