import type { Kysely } from "kysely";
import {
  FORMATO_DO_CATALOGO,
  type BaseDados,
  type TipoDeImagem,
} from "../base/esquema.js";
import type { EscritorZip } from "../exportacao/zip.js";
import { estadoDaTraducao } from "./consultas.js";
import { noCatalogo } from "./erros.js";

// A parte do Catálogo na exportação (docs/14 §3.11, «Exportação do
// catálogo»; docs/06, CS; issue #77). Lê tudo o que o comerciante pôs no
// catálogo, em todos os estados, numa transacção só de leitura (um momento
// só), e escreve-o no ZIP: `catalogo.json` (o ficheiro completo), um CSV por
// entidade e as imagens. Não leva quem fez (`*_por`; docs/06, CL), nem
// preços, nem stock.

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

/** Os ids como na API: com o prefixo do recurso. */
const com = (prefixo: string) => (id: string) => `${prefixo}_${id}`;
const prd = com("prd");
const vrt = com("var");
const opt = com("opt");
const ovl = com("ovl");
const cat = com("cat");
const col = com("col");
const med = com("med");
const pub = com("pub");

/** As colunas de cada CSV, pela ordem (as chaves das linhas). */
const COLUNAS = {
  artigos: [
    "id",
    "tipo",
    "estado",
    "nome",
    "descricao",
    "marca",
    "categoria_fiscal",
    "origem",
    "origem_ref",
    "ja_esteve_activo",
    "familias",
    "natureza_consumidor",
    "modo",
    "prestacao_inicio",
    "prestacao_fim",
    "local_pais",
    "local_territorio",
    "lazer_com_data",
    "classificado_em",
    "versao",
    "criado_em",
    "actualizado_em",
  ],
  variantes: [
    "id",
    "artigo",
    "sku",
    "estado",
    "unidade_de_venda",
    "gtin",
    "gtin_origem",
    "conteudo_quantidade",
    "conteudo_unidade",
    "peso_g",
    "comprimento_mm",
    "largura_mm",
    "altura_mm",
    "onu",
    "classe_adr",
    "posicao",
    "valores",
    "criado_em",
  ],
  opcoes: ["id", "artigo", "nome", "posicao"],
  valores: ["id", "opcao", "valor", "posicao"],
  componentes: ["kit", "componente", "quantidade", "posicao"],
  categorias: [
    "id",
    "pai",
    "nome",
    "endereco_amigavel",
    "posicao",
    "estado",
    "versao",
    "criado_em",
    "actualizado_em",
  ],
  artigos_categorias: ["artigo", "categoria"],
  colecoes: [
    "id",
    "nome",
    "descricao",
    "endereco_amigavel",
    "estado",
    "versao",
    "criado_em",
    "actualizado_em",
  ],
  colecoes_artigos: ["colecao", "artigo", "posicao"],
  traducoes: [
    "recurso",
    "campo",
    "lingua",
    "texto",
    "original",
    "estado",
    "origem",
    "revista",
    "traduzido_em",
    "revisto_em",
  ],
  media: [
    "id",
    "artigo",
    "variante",
    "ficheiro",
    "tipo",
    "bytes",
    "texto_alternativo",
    "posicao",
    "principal",
    "versao",
    "criado_em",
    "actualizado_em",
  ],
  publicacoes: [
    "id",
    "artigo",
    "loja",
    "canal",
    "mercado",
    "estado",
    "variantes_fora",
    "ultima_verificacao",
    "verificado_em",
    "publicado_em",
    "arquivado_em",
    "motivo_arquivo",
    "versao",
  ],
} as const;

/** O que a recolha devolve: o JSON completo, as tabelas e as imagens. */
export interface CatalogoLido {
  json: Record<string, unknown>;
  tabelas: { nome: string; colunas: string[]; linhas: unknown[][] }[];
  imagens: { resumo: string; tipo: TipoDeImagem }[];
}

/**
 * Lê o catálogo do comerciante num momento só (REPEATABLE READ, só
 * leitura). A base fecha antes de se escrever o ZIP.
 */
export async function lerCatalogo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  geradoEm: Date,
): Promise<CatalogoLido> {
  return noCatalogo(
    db,
    comercianteId,
    async (trx) => {
      const comerciante = await trx
        .selectFrom("comerciante")
        .select(["id", "lingua_origem"])
        .where("id", "=", comercianteId)
        .executeTakeFirstOrThrow();
      const artigos = await trx
        .selectFrom("artigo")
        .select([
          "id",
          "tipo",
          "estado",
          "nome",
          "descricao",
          "marca",
          "categoria_fiscal",
          "origem",
          "origem_ref",
          "ja_esteve_activo",
          "familias",
          "natureza_consumidor",
          "modo",
          "prestacao_inicio",
          "prestacao_fim",
          "local_pais",
          "local_territorio",
          "lazer_com_data",
          "classificado_em",
          "versao",
          "criado_em",
          "actualizado_em",
        ])
        .orderBy("criado_em")
        .orderBy("id")
        .execute();
      const variantes = await trx
        .selectFrom("variante")
        .select([
          "id",
          "artigo_id",
          "sku",
          "estado",
          "unidade_de_venda",
          "gtin",
          "gtin_origem",
          "conteudo_quantidade",
          "conteudo_unidade",
          "peso_g",
          "comprimento_mm",
          "largura_mm",
          "altura_mm",
          "onu",
          "classe_adr",
          "posicao",
          "criado_em",
        ])
        .orderBy("artigo_id")
        .orderBy("posicao")
        .orderBy("sku")
        .execute();
      const valoresDaVariante = await trx
        .selectFrom("variante_valor as vv")
        .innerJoin("opcao as o", (j) =>
          j
            .onRef("o.comerciante_id", "=", "vv.comerciante_id")
            .onRef("o.id", "=", "vv.opcao_id"),
        )
        .select(["vv.variante_id", "vv.valor_id"])
        .orderBy("vv.variante_id")
        .orderBy("o.posicao")
        .orderBy("o.id")
        .execute();
      const opcoes = await trx
        .selectFrom("opcao")
        .select(["id", "artigo_id", "nome", "posicao"])
        .orderBy("artigo_id")
        .orderBy("posicao")
        .orderBy("id")
        .execute();
      const valores = await trx
        .selectFrom("valor_opcao")
        .select(["id", "opcao_id", "valor", "posicao"])
        .orderBy("opcao_id")
        .orderBy("posicao")
        .orderBy("id")
        .execute();
      const componentes = await trx
        .selectFrom("componente")
        .select(["kit_id", "componente_id", "quantidade", "posicao"])
        .orderBy("kit_id")
        .orderBy("posicao")
        .orderBy("componente_id")
        .execute();
      const categorias = await trx
        .selectFrom("categoria")
        .select([
          "id",
          "pai_id",
          "nome",
          "endereco_amigavel",
          "posicao",
          "estado",
          "versao",
          "criado_em",
          "actualizado_em",
        ])
        .orderBy("criado_em")
        .orderBy("id")
        .execute();
      const artigosCategorias = await trx
        .selectFrom("artigo_categoria")
        .select(["artigo_id", "categoria_id"])
        .orderBy("artigo_id")
        .orderBy("categoria_id")
        .execute();
      const colecoes = await trx
        .selectFrom("colecao")
        .select([
          "id",
          "nome",
          "descricao",
          "endereco_amigavel",
          "estado",
          "versao",
          "criado_em",
          "actualizado_em",
        ])
        .orderBy("criado_em")
        .orderBy("id")
        .execute();
      const colecoesArtigos = await trx
        .selectFrom("colecao_artigo")
        .select(["colecao_id", "artigo_id", "posicao"])
        .orderBy("colecao_id")
        .orderBy("posicao")
        .orderBy("artigo_id")
        .execute();
      const traducoes = await trx
        .selectFrom("traducao as t")
        .leftJoin("texto_original as o", (j) =>
          j
            .onRef("o.comerciante_id", "=", "t.comerciante_id")
            .onRef("o.recurso_id", "=", "t.recurso_id")
            .onRef("o.campo", "=", "t.campo"),
        )
        .select([
          "t.artigo_id",
          "t.opcao_id",
          "t.valor_opcao_id",
          "t.categoria_id",
          "t.colecao_id",
          "t.recurso_id",
          "t.campo",
          "t.lingua",
          "t.texto",
          "t.original",
          "o.texto as actual",
          "t.origem",
          "t.revista",
          "t.traduzido_em",
          "t.revisto_em",
        ])
        .orderBy("t.recurso_id")
        .orderBy("t.campo")
        .orderBy("t.lingua")
        .execute();
      const media = await trx
        .selectFrom("media as m")
        .innerJoin("ficheiro as f", (j) =>
          j
            .onRef("f.comerciante_id", "=", "m.comerciante_id")
            .onRef("f.resumo", "=", "m.ficheiro_resumo"),
        )
        .select([
          "m.id",
          "m.artigo_id",
          "m.variante_id",
          "m.ficheiro_resumo",
          "f.tipo",
          "f.bytes",
          "m.texto_alternativo",
          "m.posicao",
          "m.principal",
          "m.versao",
          "m.criado_em",
          "m.actualizado_em",
        ])
        .orderBy("m.artigo_id")
        .orderBy("m.posicao")
        .orderBy("m.id")
        .execute();
      const publicacoes = await trx
        .selectFrom("publicacao")
        .select([
          "id",
          "artigo_id",
          "loja_id",
          "canal_id",
          "mercado_id",
          "estado",
          "variantes_fora",
          "ultima_verificacao",
          "verificado_em",
          "publicado_em",
          "arquivado_em",
          "motivo_arquivo",
          "versao",
          "criado_em",
        ])
        .orderBy("artigo_id")
        .orderBy("criado_em")
        .orderBy("id")
        .execute();

      // ---- As linhas, já como a API as dá.
      const linhaArtigo = (a: (typeof artigos)[number]) => ({
        id: prd(a.id),
        tipo: a.tipo,
        estado: a.estado,
        nome: a.nome,
        descricao: a.descricao,
        marca: a.marca,
        categoria_fiscal: a.categoria_fiscal,
        origem: a.origem,
        origem_ref: a.origem_ref,
        ja_esteve_activo: a.ja_esteve_activo,
        familias: a.familias,
        natureza_consumidor: a.natureza_consumidor,
        modo: a.modo,
        prestacao_inicio: iso(a.prestacao_inicio),
        prestacao_fim: iso(a.prestacao_fim),
        local_pais: a.local_pais,
        local_territorio: a.local_territorio,
        lazer_com_data: a.lazer_com_data,
        classificado_em: iso(a.classificado_em),
        versao: a.versao,
        criado_em: a.criado_em.toISOString(),
        actualizado_em: a.actualizado_em.toISOString(),
      });
      const valoresPorVariante = agrupar(
        valoresDaVariante,
        (v) => v.variante_id,
      );
      const linhaVariante = (v: (typeof variantes)[number]) => ({
        id: vrt(v.id),
        artigo: prd(v.artigo_id),
        sku: v.sku,
        estado: v.estado,
        unidade_de_venda: v.unidade_de_venda,
        gtin: v.gtin,
        gtin_origem: v.gtin_origem,
        conteudo_quantidade: v.conteudo_quantidade,
        conteudo_unidade: v.conteudo_unidade,
        peso_g: v.peso_g,
        comprimento_mm: v.comprimento_mm,
        largura_mm: v.largura_mm,
        altura_mm: v.altura_mm,
        onu: v.onu,
        classe_adr: v.classe_adr,
        posicao: v.posicao,
        valores: (valoresPorVariante.get(v.id) ?? []).map((x) =>
          ovl(x.valor_id),
        ),
        criado_em: v.criado_em.toISOString(),
      });
      const linhaOpcao = (o: (typeof opcoes)[number]) => ({
        id: opt(o.id),
        artigo: prd(o.artigo_id),
        nome: o.nome,
        posicao: o.posicao,
      });
      const linhaValor = (v: (typeof valores)[number]) => ({
        id: ovl(v.id),
        opcao: opt(v.opcao_id),
        valor: v.valor,
        posicao: v.posicao,
      });
      const linhaComponente = (c: (typeof componentes)[number]) => ({
        kit: vrt(c.kit_id),
        componente: vrt(c.componente_id),
        quantidade: c.quantidade,
        posicao: c.posicao,
      });
      const linhaCategoria = (c: (typeof categorias)[number]) => ({
        id: cat(c.id),
        pai: c.pai_id === null ? null : cat(c.pai_id),
        nome: c.nome,
        endereco_amigavel: c.endereco_amigavel,
        posicao: c.posicao,
        estado: c.estado,
        versao: c.versao,
        criado_em: c.criado_em.toISOString(),
        actualizado_em: c.actualizado_em.toISOString(),
      });
      const linhaColecao = (c: (typeof colecoes)[number]) => ({
        id: col(c.id),
        nome: c.nome,
        descricao: c.descricao,
        endereco_amigavel: c.endereco_amigavel,
        estado: c.estado,
        versao: c.versao,
        criado_em: c.criado_em.toISOString(),
        actualizado_em: c.actualizado_em.toISOString(),
      });
      const recursoDa = (t: (typeof traducoes)[number]) =>
        t.artigo_id !== null
          ? prd(t.artigo_id)
          : t.opcao_id !== null
            ? opt(t.opcao_id)
            : t.valor_opcao_id !== null
              ? ovl(t.valor_opcao_id)
              : t.categoria_id !== null
                ? cat(t.categoria_id)
                : col(t.colecao_id ?? t.recurso_id);
      const linhaTraducao = (t: (typeof traducoes)[number]) => ({
        recurso: recursoDa(t),
        campo: t.campo,
        lingua: t.lingua,
        texto: t.texto,
        original: t.original,
        estado: estadoDaTraducao(t.actual, t.original),
        origem: t.origem,
        revista: t.revista,
        traduzido_em: t.traduzido_em.toISOString(),
        revisto_em: iso(t.revisto_em),
      });
      const caminhoDaImagem = (resumo: string) => `imagens/${resumo}`;
      const linhaMedia = (m: (typeof media)[number]) => ({
        id: med(m.id),
        artigo: prd(m.artigo_id),
        variante: m.variante_id === null ? null : vrt(m.variante_id),
        ficheiro: caminhoDaImagem(m.ficheiro_resumo),
        tipo: m.tipo,
        bytes: m.bytes,
        texto_alternativo: m.texto_alternativo,
        posicao: m.posicao,
        principal: m.principal,
        versao: m.versao,
        criado_em: m.criado_em.toISOString(),
        actualizado_em: m.actualizado_em.toISOString(),
      });
      const linhaPublicacao = (p: (typeof publicacoes)[number]) => ({
        id: pub(p.id),
        artigo: prd(p.artigo_id),
        loja: `sto_${p.loja_id}`,
        canal: `chn_${p.canal_id}`,
        mercado: `mkt_${p.mercado_id}`,
        estado: p.estado,
        variantes_fora: p.variantes_fora.map(vrt),
        ultima_verificacao: p.ultima_verificacao ?? null,
        verificado_em: iso(p.verificado_em),
        publicado_em: iso(p.publicado_em),
        arquivado_em: iso(p.arquivado_em),
        motivo_arquivo: p.motivo_arquivo,
        versao: p.versao,
      });

      // ---- O JSON completo, aninhado por artigo.
      const porArtigo = <T extends { artigo_id: string }>(l: T[]) =>
        agrupar(l, (x) => x.artigo_id);
      const variantesDe = porArtigo(variantes);
      const opcoesDe = porArtigo(opcoes);
      const valoresDe = agrupar(valores, (v) => v.opcao_id);
      const componentesDe = agrupar(componentes, (c) => c.kit_id);
      const categoriasDe = porArtigo(artigosCategorias);
      const mediaDe = porArtigo(media);
      const publicacoesDe = porArtigo(publicacoes);
      const traducoesDe = agrupar(traducoes, (t) => t.recurso_id);
      const artigosDaColecao = agrupar(colecoesArtigos, (x) => x.colecao_id);
      // Dentro do recurso, a tradução não repete o id dele.
      const traducoesSem = (id: string) =>
        (traducoesDe.get(id) ?? []).map((t) => {
          const linha: Partial<ReturnType<typeof linhaTraducao>> =
            linhaTraducao(t);
          delete linha.recurso;
          return linha;
        });

      const json = {
        formato: FORMATO_DO_CATALOGO,
        gerado_em: geradoEm.toISOString(),
        comerciante: {
          id: `mer_${comerciante.id}`,
          lingua_origem: comerciante.lingua_origem,
        },
        artigos: artigos.map((a) => ({
          ...linhaArtigo(a),
          traducoes: traducoesSem(a.id),
          opcoes: (opcoesDe.get(a.id) ?? []).map((o) => ({
            ...linhaOpcao(o),
            traducoes: traducoesSem(o.id),
            valores: (valoresDe.get(o.id) ?? []).map((v) => ({
              ...linhaValor(v),
              traducoes: traducoesSem(v.id),
            })),
          })),
          variantes: (variantesDe.get(a.id) ?? []).map((v) => ({
            ...linhaVariante(v),
            componentes: (componentesDe.get(v.id) ?? []).map(linhaComponente),
          })),
          categorias: (categoriasDe.get(a.id) ?? []).map((x) =>
            cat(x.categoria_id),
          ),
          media: (mediaDe.get(a.id) ?? []).map(linhaMedia),
          publicacoes: (publicacoesDe.get(a.id) ?? []).map(linhaPublicacao),
        })),
        categorias: categorias.map((c) => ({
          ...linhaCategoria(c),
          traducoes: traducoesSem(c.id),
        })),
        colecoes: colecoes.map((c) => ({
          ...linhaColecao(c),
          traducoes: traducoesSem(c.id),
          artigos: (artigosDaColecao.get(c.id) ?? []).map((x) => ({
            artigo: prd(x.artigo_id),
            posicao: x.posicao,
          })),
        })),
      };

      // ---- As tabelas (uma por CSV), com as mesmas linhas.
      const tabelas = [
        tabela("artigos", COLUNAS.artigos, artigos.map(linhaArtigo)),
        tabela("variantes", COLUNAS.variantes, variantes.map(linhaVariante)),
        tabela("opcoes", COLUNAS.opcoes, opcoes.map(linhaOpcao)),
        tabela("valores", COLUNAS.valores, valores.map(linhaValor)),
        tabela(
          "componentes",
          COLUNAS.componentes,
          componentes.map(linhaComponente),
        ),
        tabela(
          "categorias",
          COLUNAS.categorias,
          categorias.map(linhaCategoria),
        ),
        tabela(
          "artigos_categorias",
          COLUNAS.artigos_categorias,
          artigosCategorias.map((x) => ({
            artigo: prd(x.artigo_id),
            categoria: cat(x.categoria_id),
          })),
        ),
        tabela("colecoes", COLUNAS.colecoes, colecoes.map(linhaColecao)),
        tabela(
          "colecoes_artigos",
          COLUNAS.colecoes_artigos,
          colecoesArtigos.map((x) => ({
            colecao: col(x.colecao_id),
            artigo: prd(x.artigo_id),
            posicao: x.posicao,
          })),
        ),
        tabela("traducoes", COLUNAS.traducoes, traducoes.map(linhaTraducao)),
        tabela("media", COLUNAS.media, media.map(linhaMedia)),
        tabela(
          "publicacoes",
          COLUNAS.publicacoes,
          publicacoes.map(linhaPublicacao),
        ),
      ];
      const imagens = [
        ...new Map(
          media.map((m) => [
            m.ficheiro_resumo,
            { resumo: m.ficheiro_resumo, tipo: m.tipo },
          ]),
        ).values(),
      ].sort((a, b) => a.resumo.localeCompare(b.resumo));
      return { json, tabelas, imagens };
    },
    { soLeitura: true },
  );
}

function agrupar<T>(linhas: T[], chave: (l: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const l of linhas) {
    const k = chave(l);
    const lista = m.get(k);
    if (lista === undefined) m.set(k, [l]);
    else lista.push(l);
  }
  return m;
}

/**
 * Uma tabela com as colunas dadas: o cabeçalho existe mesmo sem linhas, e
 * uma linha com outras chaves é um erro (o CSV e o JSON não se separam).
 */
function tabela(
  nome: string,
  colunas: readonly string[],
  linhas: Record<string, unknown>[],
) {
  for (const l of linhas) {
    const chaves = Object.keys(l);
    if (
      chaves.length !== colunas.length ||
      chaves.some((c, i) => c !== colunas[i])
    ) {
      throw new Error(`exportação: as colunas de ${nome} não batem`);
    }
  }
  return {
    nome,
    colunas: [...colunas],
    linhas: linhas.map((l) => colunas.map((c) => l[c])),
  };
}

/** O início de texto que uma folha de cálculo lê como fórmula (OWASP). */
const FORMULA = /^[=+\-@\t\r]/;

/**
 * Uma célula de CSV (RFC 4180): nulo vazio, listas e objectos em JSON, e o
 * texto que começa como uma fórmula com um apóstrofo à frente. O
 * `catalogo.json` leva o valor sem mudanças.
 */
export function celula(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  let texto: string;
  if (typeof valor === "string") {
    texto = FORMULA.test(valor) ? `'${valor}` : valor;
  } else if (typeof valor === "number" || typeof valor === "boolean") {
    texto = String(valor);
  } else {
    texto = JSON.stringify(valor);
    if (FORMULA.test(texto)) texto = `'${texto}`;
  }
  return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/** O CSV inteiro: UTF-8 com a marca de ordem dos bytes, linhas com CRLF. */
export function csv(colunas: string[], linhas: unknown[][]): Buffer {
  const texto = [colunas, ...linhas]
    .map((l) => l.map(celula).join(","))
    .join("\r\n");
  return Buffer.from(`\ufeff${texto}\r\n`, "utf8");
}

/**
 * Escreve a parte do catálogo no ZIP: `catalogo.json`, os CSV e as imagens
 * (`imagens/<resumo>`, cada ficheiro uma vez).
 */
export async function escreverCatalogo(
  zip: EscritorZip,
  lido: CatalogoLido,
  lerImagem: (resumo: string) => Promise<Buffer>,
) {
  await zip.acrescentar(
    "catalogo.json",
    Buffer.from(JSON.stringify(lido.json, null, 2), "utf8"),
    true,
  );
  for (const t of lido.tabelas) {
    await zip.acrescentar(`${t.nome}.csv`, csv(t.colunas, t.linhas), true);
  }
  for (const i of lido.imagens) {
    await zip.acrescentar(
      `imagens/${i.resumo}`,
      await lerImagem(i.resumo),
      false,
    );
  }
}
