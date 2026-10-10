import { sql, type Transaction } from "kysely";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { BaseDados } from "../base/esquema.js";
import { ErroCsv, lerCsv, semGuarda } from "../importacao/csv.js";
import { ErroCatalogo, ESPERA_MAXIMA, traduzir } from "./erros.js";
import {
  alterarArtigo,
  criarArtigo,
  criarVarianteComValores,
  type DadosVariante,
} from "./repositorio.js";
import {
  CamposDoArtigo,
  MAX_VARIANTES_POR_ARTIGO_NOVO,
  NovaVariante,
} from "./rotas.js";

// Os valores lêem-se pelos mesmos esquemas da API (o tamanho do nome, os
// formatos): uma regra, um sítio (revisão do #197, P2-1).
const ArtigoParcial = Type.Partial(CamposDoArtigo);
const VarianteParcial = Type.Partial(NovaVariante);

// A importação do catálogo, com ensaio antes de gravar (docs/14 §3.11,
// «Importação do catálogo»; docs/06, CT; issue #77). Diogo, 08/10/2026:
// «sim, aprovo; avança com o código da importação».
//
// O ensaio faz as escritas a sério dentro de um ponto de retorno (savepoint)
// que depois se desfaz: as regras da base (formatos, unicidade, gatilhos, e
// as combinações de opções, que se forçam no fim de cada artigo) correm como
// correriam, e nada fica. Cada artigo e cada variante têm o seu ponto de
// retorno: uma recusada não leva as outras. O resultado é o relatório e o
// plano (o que passou, com o que se viu antes). Aplicar corre o plano numa
// transacção só, depois de conferir que nada mudou desde o ensaio: ou tudo,
// ou nada.

/** Quantas variantes uma importação leva no máximo (**proposta**). */
export const MAX_VARIANTES = 5000;

/** Os campos do artigo que a importação lê. */
const CAMPOS_ARTIGO = [
  "tipo",
  "nome",
  "descricao",
  "marca",
  "categoria_fiscal",
] as const;
type CampoArtigo = (typeof CAMPOS_ARTIGO)[number];
/** Os que se podem alterar num artigo que já existe (o tipo não muda). */
const ALTERAVEIS_ARTIGO = [
  "nome",
  "descricao",
  "marca",
  "categoria_fiscal",
] as const;

const CAMPOS_TEXTO_VARIANTE = [
  "gtin",
  "gtin_origem",
  "unidade_de_venda",
  "conteudo_unidade",
  "onu",
  "classe_adr",
] as const;
const CAMPOS_NUMERO_VARIANTE = [
  "conteudo_quantidade",
  "peso_g",
  "comprimento_mm",
  "largura_mm",
  "altura_mm",
] as const;
const CAMPOS_VARIANTE = [
  ...CAMPOS_TEXTO_VARIANTE,
  ...CAMPOS_NUMERO_VARIANTE,
] as const;
type CampoVariante = (typeof CAMPOS_VARIANTE)[number];

/** As colunas do CSV (docs/14 §3.11): uma desconhecida recusa o ficheiro. */
export const COLUNAS_CSV = [
  "artigo",
  ...CAMPOS_ARTIGO,
  "sku",
  ...CAMPOS_VARIANTE,
] as const;

type Valor = string | number;

/** Uma variante lida do ficheiro: só os campos que trazem valor. */
interface Linha {
  onde: string;
  artigo: string;
  sku: string;
  campos: Partial<Record<CampoVariante, Valor>>;
}

/** Um artigo lido do ficheiro (as variantes que a referência junta). */
interface Grupo {
  artigo: string;
  campos: Partial<Record<CampoArtigo, string>>;
  linhas: Linha[];
}

export interface Recusa {
  onde: string;
  artigo?: string;
  sku?: string;
  codigo: string;
  campo?: string;
  detalhe?: string;
}

export interface Alteracao {
  recurso: string;
  campo: string;
  antes: Valor | null;
  depois: Valor;
}

/** O que se lê do ficheiro, antes de olhar para o catálogo. */
export interface FicheiroLido {
  grupos: Grupo[];
  recusas: Recusa[];
  ignorado: Record<string, number>;
  variantes: number;
}

export class ErroImportacao extends Error {
  constructor(
    readonly codigo:
      | "import.invalid_file"
      | "import.external_product"
      | "import.too_large"
      | "import.stale"
      | "import.expired",
    detalhe: string,
    readonly pormenor?: unknown,
  ) {
    super(detalhe);
    this.name = "ErroImportacao";
  }
}

// Até 10 algarismos: o máximo (2147483647) confere-o o esquema da API
// (2.ª revisão do #197, P3-d).
const NUMERO = /^[0-9]{1,10}$/;

/**
 * O que o PostgreSQL não guarda num texto nem num jsonb: o carácter nulo e
 * as metades de um par de substituição sozinhas (2.ª revisão do #197,
 * P2-A). Uma célula com um deles recusa a linha, em vez de dar 500.
 */
const PAR_PARTIDO =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const NULO = String.fromCharCode(0);
const temMau = (t: string) =>
  t.includes(NULO) || new RegExp(PAR_PARTIDO.source).test(t);
/** O texto, com o que não se guarda trocado por «�» (para o relatório). */
const limpo = (t: string) =>
  t.replaceAll(NULO, "\uFFFD").replace(PAR_PARTIDO, "\uFFFD");

function numeroOuRecusa(
  valor: string,
  campo: string,
  onde: string,
  recusas: Recusa[],
  sku: string,
): number | undefined {
  if (!NUMERO.test(valor)) {
    recusas.push({
      onde,
      sku,
      codigo: "catalog.invalid_field",
      campo,
      detalhe: "um número inteiro positivo",
    });
    return undefined;
  }
  return Number(valor);
}

/**
 * Lê o CSV (uma linha por variante) ou o `catalogo.json` da exportação. Um
 * ficheiro que não se lê (cabeçalho com colunas desconhecidas, JSON doutro
 * formato) é `import.invalid_file`; uma linha má é uma recusa, e o resto
 * segue.
 */
export function lerFicheiro(
  bytes: Buffer,
  tipo: "csv" | "eurolify.catalogo/1",
): FicheiroLido {
  const recusas: Recusa[] = [];
  const ignorado: Record<string, number> = {};
  const linhas: {
    linha: Linha;
    campos: Partial<Record<CampoArtigo, string>>;
  }[] = [];
  // UTF-8 a sério: um ficheiro noutra codificação (o Windows-1252 de uma
  // folha de cálculo antiga) recusa-se em vez de gravar «�» (revisão do
  // #197, P2-2).
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ErroImportacao(
      "import.invalid_file",
      "o ficheiro não está em UTF-8",
    );
  }
  if (tipo === "csv") {
    let csv;
    try {
      csv = lerCsv(texto);
    } catch (erro) {
      if (erro instanceof ErroCsv) {
        throw new ErroImportacao("import.invalid_file", erro.message);
      }
      throw erro;
    }
    const [cabecalho, ...resto] = csv;
    if (cabecalho === undefined) {
      throw new ErroImportacao("import.invalid_file", "o ficheiro está vazio");
    }
    const colunas = cabecalho.celulas;
    const desconhecidas = colunas.filter(
      (c) => !(COLUNAS_CSV as readonly string[]).includes(c),
    );
    if (desconhecidas.length > 0) {
      throw new ErroImportacao(
        "import.invalid_file",
        `colunas desconhecidas: ${desconhecidas.join(", ")}`,
      );
    }
    if (new Set(colunas).size !== colunas.length) {
      throw new ErroImportacao("import.invalid_file", "colunas repetidas");
    }
    for (const obrigatoria of ["artigo", "sku"]) {
      if (!colunas.includes(obrigatoria)) {
        throw new ErroImportacao(
          "import.invalid_file",
          `falta a coluna ${obrigatoria}`,
        );
      }
    }
    // O limite conta as linhas todas, boas ou más: uma chave não enche o
    // relatório com milhões de recusas (revisão do #197, P1-1).
    if (resto.length > MAX_VARIANTES) {
      throw new ErroImportacao(
        "import.too_large",
        `${String(resto.length)} linhas; no máximo ${String(MAX_VARIANTES)}`,
      );
    }
    for (const l of resto) {
      const onde = `linha ${String(l.numero)}`;
      if (l.celulas.length !== colunas.length) {
        recusas.push({
          onde,
          codigo: "import.bad_row",
          detalhe: `${String(l.celulas.length)} células para ${String(colunas.length)} colunas`,
        });
        continue;
      }
      const celula = (c: string) =>
        semGuarda(l.celulas[colunas.indexOf(c)] ?? "");
      linhas.push(lerLinha(onde, celula, colunas, recusas));
    }
  } else {
    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch {
      throw new ErroImportacao("import.invalid_file", "JSON inválido");
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new ErroImportacao(
        "import.invalid_file",
        "não é um catalogo.json no formato eurolify.catalogo/1",
      );
    }
    const raiz = json as {
      formato?: unknown;
      artigos?: unknown;
      categorias?: unknown;
      colecoes?: unknown;
    };
    if (
      raiz.formato !== "eurolify.catalogo/1" ||
      !Array.isArray(raiz.artigos)
    ) {
      throw new ErroImportacao(
        "import.invalid_file",
        "não é um catalogo.json no formato eurolify.catalogo/1",
      );
    }
    const contar = (chave: string, n: number) => {
      if (n > 0) ignorado[chave] = (ignorado[chave] ?? 0) + n;
    };
    if (Array.isArray(raiz.categorias))
      contar("categorias", raiz.categorias.length);
    if (Array.isArray(raiz.colecoes)) contar("colecoes", raiz.colecoes.length);
    const total = raiz.artigos.reduce((n: number, a: unknown) => {
      const v = (a as { variantes?: unknown } | null)?.variantes;
      return n + Math.max(1, Array.isArray(v) ? v.length : 0);
    }, 0);
    if (total > MAX_VARIANTES) {
      throw new ErroImportacao(
        "import.too_large",
        `${String(total)} variantes; no máximo ${String(MAX_VARIANTES)}`,
      );
    }
    raiz.artigos.forEach((a: unknown, i) => {
      const artigo = (a ?? {}) as Record<string, unknown>;
      for (const chave of [
        "opcoes",
        "traducoes",
        "categorias",
        "media",
        "publicacoes",
      ]) {
        const v = artigo[chave];
        if (Array.isArray(v) && v.length > 0) contar(chave, 1);
      }
      const ref =
        typeof artigo.id === "string" ? artigo.id : `artigo ${String(i + 1)}`;
      const variantes = Array.isArray(artigo.variantes) ? artigo.variantes : [];
      if (variantes.length === 0) {
        recusas.push({
          onde: `artigo ${String(i + 1)}`,
          artigo: limpo(ref),
          codigo: "import.no_variants",
        });
      }
      variantes.forEach((v: unknown, j) => {
        const variante = (v ?? {}) as Record<string, unknown>;
        if (
          Array.isArray(variante.componentes) &&
          variante.componentes.length > 0
        ) {
          contar("componentes", 1);
        }
        const onde = `artigo ${String(i + 1)}, variante ${String(j + 1)}`;
        const celula = (c: string): string => {
          const fonte = (CAMPOS_ARTIGO as readonly string[]).includes(c)
            ? artigo[c]
            : c === "artigo"
              ? ref
              : variante[c];
          if (fonte === null || fonte === undefined) return "";
          if (typeof fonte === "string") return fonte;
          if (typeof fonte === "number" || typeof fonte === "boolean") {
            return String(fonte);
          }
          // Uma lista ou um objecto num campo de texto: a linha recusa-se.
          invalido = c;
          return "";
        };
        let invalido: string | undefined;
        const lida = lerLinha(onde, celula, [...COLUNAS_CSV], recusas);
        if (invalido !== undefined) {
          recusas.push({
            onde,
            sku: lida.linha.sku,
            codigo: "catalog.invalid_field",
            campo: invalido,
            detalhe: "um valor simples (texto ou número)",
          });
          lida.linha.sku = "";
        }
        linhas.push(lida);
      });
    });
  }
  return agruparLinhas(linhas, recusas, ignorado);
}

/** Uma linha (do CSV ou do JSON) com as células já lidas. */
function lerLinha(
  onde: string,
  celula: (c: string) => string,
  colunas: readonly string[],
  recusas: Recusa[],
): { linha: Linha; campos: Partial<Record<CampoArtigo, string>> } {
  const sku = celula("sku");
  const artigo = celula("artigo");
  const mau = [...colunas].find((c) => temMau(celula(c)));
  if (mau !== undefined) {
    recusas.push({
      onde,
      sku: limpo(sku),
      codigo: "catalog.invalid_field",
      campo: mau,
      detalhe: "um carácter que não se guarda (o nulo ou um par partido)",
    });
    return {
      linha: { onde, artigo: limpo(artigo), sku: "", campos: {} },
      campos: {},
    };
  }
  const campos: Partial<Record<CampoArtigo, string>> = {};
  for (const c of CAMPOS_ARTIGO) {
    if (!colunas.includes(c)) continue;
    const v = celula(c);
    if (v !== "") campos[c] = v;
  }
  const variante: Partial<Record<CampoVariante, Valor>> = {};
  for (const c of CAMPOS_TEXTO_VARIANTE) {
    if (!colunas.includes(c)) continue;
    const v = celula(c);
    if (v !== "") variante[c] = v;
  }
  let numerosBons = true;
  for (const c of CAMPOS_NUMERO_VARIANTE) {
    if (!colunas.includes(c)) continue;
    const v = celula(c);
    if (v === "") continue;
    const n = numeroOuRecusa(v, c, onde, recusas, sku);
    if (n === undefined) numerosBons = false;
    else variante[c] = n;
  }
  const linha = { onde, artigo, sku, campos: variante };
  if (!numerosBons) {
    linha.sku = "";
    return { linha, campos };
  }
  // Os mesmos esquemas da API (o tamanho, o formato, o texto não vazio).
  for (const [esquema, valor] of [
    [ArtigoParcial, campos],
    [VarianteParcial, { ...variante, sku }],
  ] as const) {
    const erro = Value.Errors(esquema, valor)[0];
    if (erro !== undefined) {
      recusas.push({
        onde,
        sku,
        codigo: "catalog.invalid_field",
        campo: erro.instancePath.replace(/^\//, "") || undefined,
        detalhe: erro.message,
      } as Recusa);
      linha.sku = "";
      return { linha, campos };
    }
  }
  return { linha, campos };
}

/** Junta as linhas por artigo e recusa as que não se podem juntar. */
function agruparLinhas(
  linhas: { linha: Linha; campos: Partial<Record<CampoArtigo, string>> }[],
  recusas: Recusa[],
  ignorado: Record<string, number>,
): FicheiroLido {
  // Uma linha com um número mal escrito já foi recusada (sku vazio).
  const validas = linhas.filter(({ linha }) => {
    if (linha.sku === "" && recusas.some((r) => r.onde === linha.onde)) {
      return false;
    }
    if (linha.artigo === "" || linha.sku === "") {
      recusas.push({
        onde: linha.onde,
        sku: linha.sku,
        codigo: "catalog.invalid_field",
        campo: linha.artigo === "" ? "artigo" : "sku",
        detalhe: "obrigatório",
      });
      return false;
    }
    return true;
  });
  // Um SKU repetido no ficheiro: as linhas todas dele ficam de fora.
  const porSku = new Map<string, number>();
  for (const { linha } of validas) {
    const k = linha.sku.toLowerCase();
    porSku.set(k, (porSku.get(k) ?? 0) + 1);
  }
  const grupos = new Map<string, Grupo>();
  const conflito = new Set<string>();
  for (const { linha, campos } of validas) {
    if ((porSku.get(linha.sku.toLowerCase()) ?? 0) > 1) {
      recusas.push({
        onde: linha.onde,
        sku: linha.sku,
        codigo: "import.sku_repeated",
        detalhe: "o mesmo SKU aparece mais de uma vez no ficheiro",
      });
      continue;
    }
    let g = grupos.get(linha.artigo);
    if (g === undefined) {
      g = { artigo: linha.artigo, campos: {}, linhas: [] };
      grupos.set(linha.artigo, g);
    }
    for (const c of CAMPOS_ARTIGO) {
      const v = campos[c];
      if (v === undefined) continue;
      const antes = g.campos[c];
      if (antes !== undefined && antes !== v) conflito.add(linha.artigo);
      else g.campos[c] = v;
    }
    g.linhas.push(linha);
  }
  for (const ref of conflito) {
    const g = grupos.get(ref);
    if (g === undefined) continue;
    for (const l of g.linhas) {
      recusas.push({
        onde: l.onde,
        artigo: ref,
        sku: l.sku,
        codigo: "import.product_fields_differ",
        detalhe:
          "as linhas do mesmo artigo têm valores diferentes nos campos do artigo",
      });
    }
    grupos.delete(ref);
  }
  const lista = [...grupos.values()];
  const variantes = lista.reduce((n, g) => n + g.linhas.length, 0);
  return { grupos: lista, recusas, ignorado, variantes };
}

// ------------------------------------------------------------ O plano

/** Uma variante do plano: criar (`id` nulo) ou alterar (com o antes). */
interface VarianteDoPlano {
  onde: string;
  sku: string;
  id: string | null;
  campos: Partial<Record<CampoVariante, Valor>>;
  antes: Partial<Record<CampoVariante, Valor | null>>;
}

/** Um artigo do plano: criar (`id` nulo) ou alterar (com a versão vista). */
interface ArtigoDoPlano {
  referencia: string;
  id: string | null;
  versao: number | null;
  campos: Partial<Record<CampoArtigo, string>>;
  variantes: VarianteDoPlano[];
}

export interface Plano {
  artigos: ArtigoDoPlano[];
}

export interface Relatorio {
  criar: { artigos: number; variantes: number };
  alterar: { artigos: number; variantes: number };
  iguais: { artigos: number; variantes: number };
  recusadas: Recusa[];
  recusadas_a_mais: number;
  alteracoes: Alteracao[];
  alteracoes_a_mais: number;
  avisos: string[];
  ignorado: Record<string, number>;
}

/** Quantas alterações e recusas o relatório mostra uma a uma (as outras contam-se). */
const MAX_NA_LISTA = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const prdDe = (ref: string) => {
  // O id em maiúsculas é o mesmo id (2.ª revisão do #197, P3-f4).
  const m = /^prd_(.+)$/.exec(ref);
  const id = (m?.[1] ?? "").toLowerCase();
  return UUID.test(id) ? id : null;
};

const igual = (a: Valor | null | undefined, b: Valor | null | undefined) =>
  a === b ||
  (a !== null &&
    a !== undefined &&
    b !== null &&
    b !== undefined &&
    String(a) === String(b));

/** Um erro que não é de uma linha: a espera por outra escrita. */
const eDeEspera = (erro: unknown) =>
  erro instanceof ErroCatalogo && erro.codigo === "catalog.retry";

/**
 * Corre `fn` num ponto de retorno; com erro, desfaz só esse bocado. Uma
 * espera por outra escrita (`catalog.retry`) não é recusa de uma linha:
 * sobe, e o ensaio inteiro falha para se repetir (revisão do #197, P2-4).
 */
async function aParte<T>(
  trx: Transaction<BaseDados>,
  nome: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; valor: T } | { ok: false; erro: unknown }> {
  await sql.raw(`savepoint ${nome}`).execute(trx);
  try {
    const valor = await fn();
    await sql.raw(`release savepoint ${nome}`).execute(trx);
    return { ok: true, valor };
  } catch (erroOriginal) {
    await sql.raw(`rollback to savepoint ${nome}`).execute(trx);
    await sql.raw(`release savepoint ${nome}`).execute(trx);
    const erro = traduzir(erroOriginal);
    if (eDeEspera(erro)) throw erro;
    return { ok: false, erro };
  }
}

/** As regras que a base deixa para o fim (as combinações): já, aqui. */
async function conferirJa(trx: Transaction<BaseDados>) {
  await sql`set constraints all immediate`.execute(trx);
  await sql`set constraints all deferred`.execute(trx);
}

/** O prazo de espera por outra escrita, como no resto do Catálogo. */
async function comPrazo(trx: Transaction<BaseDados>) {
  await sql`select set_config('lock_timeout', ${ESPERA_MAXIMA}, true)`.execute(
    trx,
  );
}

function codigoDo(erro: unknown): { codigo: string; detalhe?: string } {
  if (erro instanceof ErroCatalogo) {
    return { codigo: erro.codigo, detalhe: erro.message };
  }
  if (erro instanceof ErroImportacao) {
    return { codigo: erro.codigo, detalhe: erro.message };
  }
  throw erro;
}

const COLUNAS_VARIANTE = [
  "id",
  "artigo_id",
  "sku",
  "estado",
  ...CAMPOS_VARIANTE,
] as const;

class SemVariantes extends Error {}

/**
 * O ensaio, dentro da transacção dada (de quem chama): escreve o que o
 * ficheiro pede, cada artigo e cada variante no seu ponto de retorno, e
 * desfaz tudo no fim. Devolve o relatório e o plano. As alterações e as
 * recusas de um artigo só entram no relatório quando o artigo passa (ou,
 * se não passar, só a recusa dele, uma por linha; revisão do #197, P2-3).
 */
export async function ensaiar(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  lido: FicheiroLido,
): Promise<{ relatorio: Relatorio; plano: Plano }> {
  const recusadas: Recusa[] = [...lido.recusas];
  const alteracoes: Alteracao[] = [];
  const avisos: string[] = [];
  const contas = {
    criar: { artigos: 0, variantes: 0 },
    alterar: { artigos: 0, variantes: 0 },
    iguais: { artigos: 0, variantes: 0 },
  };
  const plano: Plano = { artigos: [] };
  // Cada artigo que já existe trata-se uma vez: dois grupos do ficheiro que
  // dão o mesmo artigo recusam-se no segundo (revisão do #197, P1-2).
  const tratados = new Set<string>();
  await comPrazo(trx);
  await sql.raw("savepoint ensaio").execute(trx);
  try {
    for (const g of lido.grupos) {
      const recusarGrupo = (
        codigo: string,
        detalhe?: string,
        campo?: string,
      ) => {
        for (const l of g.linhas) {
          recusadas.push({
            onde: l.onde,
            artigo: g.artigo,
            sku: l.sku,
            codigo,
            ...(campo === undefined ? {} : { campo }),
            ...(detalhe === undefined ? {} : { detalhe }),
          });
        }
      };
      const existentes = await trx
        .selectFrom("variante")
        .select(COLUNAS_VARIANTE)
        .where(
          sql<string>`lower(sku)`,
          "in",
          g.linhas.map((l) => l.sku.toLowerCase()),
        )
        .execute();
      const porSku = new Map(existentes.map((v) => [v.sku.toLowerCase(), v]));
      const daLinha = (l: Linha) => porSku.get(l.sku.toLowerCase());
      // O artigo: o prd_ deste comerciante; senão, o dos SKU que já existem;
      // senão, um novo. Nunca pelo nome.
      let alvo: string | null = null;
      const prd = prdDe(g.artigo);
      if (prd !== null) {
        const existe = await trx
          .selectFrom("artigo")
          .select("id")
          .where("id", "=", prd)
          .executeTakeFirst();
        if (existe !== undefined) alvo = existe.id;
        else {
          avisos.push(
            `${g.artigo} não existe nesta conta: conta como referência (revisão do #197, P3-5)`,
          );
        }
      }
      if (alvo === null) {
        const artigosDosSku = new Set(existentes.map((v) => v.artigo_id));
        if (artigosDosSku.size > 1) {
          recusarGrupo(
            "catalog.sku_taken_by_other_product",
            "os SKU deste artigo já são de artigos diferentes",
          );
          continue;
        }
        alvo = [...artigosDosSku][0] ?? null;
      }
      if (alvo !== null && tratados.has(alvo)) {
        recusarGrupo(
          "import.product_repeated",
          `o artigo prd_${alvo} já vem noutro grupo do ficheiro`,
        );
        continue;
      }
      if (alvo === null && g.linhas.length > MAX_VARIANTES_POR_ARTIGO_NOVO) {
        recusarGrupo(
          "catalog.invalid_field",
          `no máximo ${String(MAX_VARIANTES_POR_ARTIGO_NOVO)} variantes num artigo novo`,
          "variantes",
        );
        continue;
      }
      const alteracoesDoArtigo: Alteracao[] = [];
      const recusasDoArtigo: Recusa[] = [];
      const resultado = await aParte(trx, "artigo", async () => {
        let artigoId: string;
        let versao: number | null = null;
        const campos: Partial<Record<CampoArtigo, string>> = {};
        const criar = alvo === null;
        if (alvo === null) {
          for (const obrigatorio of ["nome", "tipo"] as const) {
            if (g.campos[obrigatorio] === undefined) {
              throw new ErroCatalogo(
                "catalog.invalid_field",
                `${obrigatorio}: obrigatório para criar o artigo`,
              );
            }
          }
          Object.assign(campos, g.campos);
          artigoId = await criarArtigo(trx, comercianteId, {
            tipo: g.campos.tipo as never,
            nome: g.campos.nome ?? "",
            descricao: g.campos.descricao ?? null,
            marca: g.campos.marca ?? null,
            categoria_fiscal: g.campos.categoria_fiscal ?? null,
          });
        } else {
          artigoId = alvo;
          const a = await trx
            .selectFrom("artigo")
            .select(["id", "tipo", "origem", "versao", ...ALTERAVEIS_ARTIGO])
            .where("id", "=", alvo)
            .executeTakeFirstOrThrow();
          if (a.origem === "externo") {
            throw new ErroImportacao(
              "import.external_product",
              "o artigo vem de um sistema externo (P5): altera-se lá",
            );
          }
          if (g.campos.tipo !== undefined && g.campos.tipo !== a.tipo) {
            throw new ErroCatalogo(
              "catalog.invalid_field",
              "tipo: o tipo de um artigo não muda",
            );
          }
          versao = a.versao;
          for (const c of ALTERAVEIS_ARTIGO) {
            const v = g.campos[c];
            if (v !== undefined && !igual(v, a[c])) {
              campos[c] = v;
              alteracoesDoArtigo.push({
                recurso: `prd_${a.id}`,
                campo: c,
                antes: a[c],
                depois: v,
              });
            }
          }
          if (Object.keys(campos).length > 0) {
            await alterarArtigo(trx, comercianteId, a.id, a.versao, campos);
          }
        }
        // As variantes, cada uma à parte.
        const variantes: VarianteDoPlano[] = [];
        let iguais = 0;
        for (const l of g.linhas) {
          const v = daLinha(l);
          if (v !== undefined && v.artigo_id !== artigoId) {
            recusasDoArtigo.push({
              onde: l.onde,
              artigo: g.artigo,
              sku: l.sku,
              codigo: "catalog.sku_taken_by_other_product",
              detalhe: `o SKU já é do artigo prd_${v.artigo_id}`,
            });
            continue;
          }
          const r = await aParte(trx, "variante", async () => {
            if (v === undefined) {
              if (l.campos.unidade_de_venda === undefined) {
                throw new ErroCatalogo(
                  "catalog.invalid_field",
                  "unidade_de_venda: obrigatória para criar a variante",
                );
              }
              // Pela função da API (a linha do artigo e a fila dele antes
              // do INSERT), sem valores de opções: num artigo com opções,
              // fora do rascunho, a combinação fica incompleta e recusa-se.
              await criarVarianteComValores(
                trx,
                comercianteId,
                artigoId,
                { sku: l.sku, ...l.campos } as unknown as DadosVariante,
                [],
              );
              await conferirJa(trx);
              return { id: null, campos: l.campos, antes: {}, mudancas: [] };
            }
            const mudar: Partial<Record<CampoVariante, Valor>> = {};
            const antes: Partial<Record<CampoVariante, Valor | null>> = {};
            for (const c of CAMPOS_VARIANTE) {
              const novo = l.campos[c];
              if (novo !== undefined && !igual(novo, v[c])) {
                mudar[c] = novo;
                antes[c] = v[c];
              }
            }
            if (Object.keys(mudar).length === 0) return null;
            if (v.estado === "arquivada") {
              throw new ErroCatalogo(
                "catalog.variant_archived_is_final",
                "uma variante arquivada não muda",
              );
            }
            await gravarCamposDaVariante(trx, v.id, mudar);
            await conferirJa(trx);
            const mudancas: Alteracao[] = (
              Object.keys(mudar) as CampoVariante[]
            ).map((c) => ({
              recurso: `var_${v.id}`,
              campo: c,
              antes: antes[c] ?? null,
              depois: mudar[c] as Valor,
            }));
            return { id: v.id, campos: mudar, antes, mudancas };
          });
          if (!r.ok) {
            recusasDoArtigo.push({
              onde: l.onde,
              artigo: g.artigo,
              sku: l.sku,
              ...codigoDo(r.erro),
            });
          } else if (r.valor === null) {
            iguais++;
          } else {
            const { mudancas, ...variante } = r.valor;
            alteracoesDoArtigo.push(...mudancas);
            variantes.push({ onde: l.onde, sku: l.sku, ...variante });
          }
        }
        if (criar && variantes.length === 0) {
          // Um artigo novo sem nenhuma variante que passe não se cria.
          throw new SemVariantes();
        }
        await conferirJa(trx);
        return { artigoId, versao, campos, variantes, iguais, criar };
      });
      if (!resultado.ok) {
        if (resultado.erro instanceof SemVariantes) {
          recusadas.push(...recusasDoArtigo);
        } else {
          const { codigo, detalhe } = codigoDo(resultado.erro);
          recusarGrupo(codigo, detalhe);
        }
        continue;
      }
      const r = resultado.valor;
      recusadas.push(...recusasDoArtigo);
      alteracoes.push(...alteracoesDoArtigo);
      if (!r.criar) tratados.add(r.artigoId);
      const novas = r.variantes.filter((v) => v.id === null).length;
      contas.criar.variantes += novas;
      contas.alterar.variantes += r.variantes.length - novas;
      contas.iguais.variantes += r.iguais;
      if (r.criar) contas.criar.artigos++;
      else if (Object.keys(r.campos).length > 0) contas.alterar.artigos++;
      else if (r.iguais > 0 || r.variantes.length > 0) contas.iguais.artigos++;
      if (
        r.criar ||
        Object.keys(r.campos).length > 0 ||
        r.variantes.length > 0
      ) {
        plano.artigos.push({
          referencia: g.artigo,
          id: r.criar ? null : r.artigoId,
          versao: r.versao,
          campos: r.campos,
          variantes: r.variantes,
        });
      }
    }
  } finally {
    await sql.raw("rollback to savepoint ensaio").execute(trx);
    await sql.raw("release savepoint ensaio").execute(trx);
  }
  const relatorio: Relatorio = {
    ...contas,
    recusadas: recusadas.slice(0, MAX_NA_LISTA),
    recusadas_a_mais: Math.max(0, recusadas.length - MAX_NA_LISTA),
    alteracoes: alteracoes.slice(0, MAX_NA_LISTA),
    alteracoes_a_mais: Math.max(0, alteracoes.length - MAX_NA_LISTA),
    avisos: avisos.slice(0, MAX_NA_LISTA),
    ignorado: lido.ignorado,
  };
  return { relatorio, plano };
}

/** Muda os campos dados de uma variante (as regras são da base). */
async function gravarCamposDaVariante(
  trx: Transaction<BaseDados>,
  id: string,
  campos: Partial<Record<CampoVariante, Valor>>,
) {
  await trx
    .updateTable("variante")
    .set(campos as never)
    .where("id", "=", id)
    .execute();
}

/**
 * Aplica o plano do ensaio, na transacção dada: primeiro confere que nada
 * mudou desde o ensaio (a versão de cada artigo, o estado e o antes de cada
 * campo de variante, e que nenhum SKU a criar passou a existir); com uma
 * diferença, `import.stale` com a lista, e nada se grava. As linhas
 * prendem-se por ordem do id (os artigos FOR UPDATE, como a `alterarArtigo`;
 * depois as variantes, FOR NO KEY UPDATE como ao arquivar), com o prazo de espera do Catálogo (revisão do
 * #197, P2-5). Qualquer erro a meio desfaz tudo (quem chama não faz COMMIT).
 */
/** A ordem dos locks: pelo id, byte a byte (2.ª revisão do #197, P3-b). */
const porId = (a: string | null, b: string | null) =>
  (a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0;

export async function aplicarPlano(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  plano: Plano,
): Promise<{ artigos: string[]; variantes: number }> {
  await comPrazo(trx);
  const mudou: string[] = [];
  const skusNovos = plano.artigos.flatMap((a) =>
    a.variantes.filter((v) => v.id === null).map((v) => v.sku.toLowerCase()),
  );
  if (skusNovos.length > 0) {
    const ja = await trx
      .selectFrom("variante")
      .select("sku")
      .where(sql<string>`lower(sku)`, "in", skusNovos)
      .execute();
    for (const v of ja) mudou.push(`o SKU ${v.sku} já existe`);
  }
  const artigosExistentes = plano.artigos
    .filter((a) => a.id !== null)
    .sort((x, y) => porId(x.id, y.id));
  for (const a of artigosExistentes) {
    const atual = await trx
      .selectFrom("artigo")
      .select("versao")
      .where("id", "=", a.id ?? "")
      // FOR UPDATE, como a `alterarArtigo` a seguir: sem subir o lock.
      .forUpdate()
      .executeTakeFirst();
    if (atual?.versao !== a.versao)
      mudou.push(`o artigo prd_${a.id ?? ""} mudou`);
  }
  const variantesExistentes = plano.artigos
    .flatMap((a) => a.variantes)
    .filter((v) => v.id !== null)
    .sort((x, y) => porId(x.id, y.id));
  for (const v of variantesExistentes) {
    const atual = await trx
      .selectFrom("variante")
      .select(COLUNAS_VARIANTE)
      .where("id", "=", v.id ?? "")
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (atual === undefined) {
      mudou.push(`a variante ${v.sku} já não existe`);
      continue;
    }
    if (atual.estado !== "activa") {
      mudou.push(`a variante ${v.sku} foi arquivada`);
      continue;
    }
    for (const [c, antes] of Object.entries(v.antes)) {
      if (!igual(atual[c as CampoVariante], antes)) {
        mudou.push(`a variante ${v.sku} mudou (${c})`);
        break;
      }
    }
  }
  if (mudou.length > 0) {
    throw new ErroImportacao(
      "import.stale",
      "o catálogo mudou desde o ensaio; faça outro",
      mudou,
    );
  }
  const artigos: string[] = [];
  let variantes = 0;
  for (const a of plano.artigos) {
    let artigoId: string;
    if (a.id === null) {
      artigoId = await criarArtigo(trx, comercianteId, {
        tipo: a.campos.tipo as never,
        nome: a.campos.nome ?? "",
        descricao: a.campos.descricao ?? null,
        marca: a.campos.marca ?? null,
        categoria_fiscal: a.campos.categoria_fiscal ?? null,
      });
    } else {
      artigoId = a.id;
      if (Object.keys(a.campos).length > 0 && a.versao !== null) {
        await alterarArtigo(trx, comercianteId, a.id, a.versao, a.campos);
      }
    }
    for (const v of a.variantes) {
      if (v.id === null) {
        try {
          await criarVarianteComValores(
            trx,
            comercianteId,
            artigoId,
            { sku: v.sku, ...v.campos } as unknown as DadosVariante,
            [],
          );
        } catch (erro) {
          // Um SKU criado por outro pedido depois da verificação: é «mudou
          // desde o ensaio» (2.ª revisão do #197, P3-c).
          const e = traduzir(erro);
          if (
            e instanceof ErroCatalogo &&
            e.codigo === "catalog.sku_duplicate"
          ) {
            throw new ErroImportacao(
              "import.stale",
              "o catálogo mudou desde o ensaio; faça outro",
              [`o SKU ${v.sku} já existe`],
            );
          }
          throw e;
        }
      } else {
        await gravarCamposDaVariante(trx, v.id, v.campos);
      }
      variantes++;
    }
    artigos.push(`prd_${artigoId}`);
  }
  await conferirJa(trx);
  return { artigos, variantes };
}
