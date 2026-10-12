import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import type { Conteudo, LinhaDoConteudo } from "./repositorio.js";
import { noDocumentos } from "./repositorio.js";

// O relatório OSS (docs/36; docs/06, ED; issue #310). Os montantes vêm só das
// provas dos documentos emitidos (O1); o balde de cada linha vem da decisão
// de IVA copiada no conteúdo (O2); o Estado-Membro de consumo é o país de
// entrega (O3); as NC entram a negativo (O4). Não se declara nada: o
// comerciante apresenta a declaração (Diretiva IVA, art. 369.º-F); o
// Eurolify dá-lhe os números e os registos (art. 63.º-C do Reg. 282/2011).

/** A versão da regra dos baldes (docs/36 §2.1), guardada em cada fecho. */
export const VERSAO_REGRA = 1;

/** O limiar das vendas à distância (Diretiva IVA, art. 59.º-C), em cêntimos. */
export const LIMIAR_CENTIMOS = 1_000_000;

export type Balde =
  "oss" | "nacional" | "intracomunitarias" | "exportacao" | "outras_isentas";

const BALDES: readonly Balde[] = [
  "oss",
  "nacional",
  "intracomunitarias",
  "exportacao",
  "outras_isentas",
];

/** A regra do Motor de IVA (docs/24 §5.2) → o balde (docs/36 §2.1; Q-O3). */
export function baldeDe(
  regra: string,
  paisImposto: string | null,
  paisEntidade: string,
): Balde | null {
  switch (regra) {
    case "distancia_destino":
      return "oss";
    case "nacional":
    case "distancia_origem":
      return "nacional";
    case "servico_no_lugar":
      // Só no país do comerciante na Fase 1 (docs/24 §5.3); noutro país não
      // se adivinha: fica fora (impede o fecho).
      return paisImposto === paisEntidade ? "nacional" : null;
    case "vies_intracomunitaria":
      return "intracomunitarias";
    case "exportacao":
      return "exportacao";
    case "isento_natureza":
    case "isencao_manual":
      return "outras_isentas";
    default:
      return null;
  }
}

export type CodigoErroRelatorio =
  | "tax_reports.invalid_period"
  | "tax_reports.not_found"
  | "tax_reports.not_closable"
  | "tax_reports.already_closed"
  | "tax_reports.immutable"
  | "tax_reports.retry";

export const ESTADO_DO_CODIGO_RELATORIO: Record<CodigoErroRelatorio, number> = {
  "tax_reports.invalid_period": 400,
  "tax_reports.not_found": 404,
  "tax_reports.not_closable": 409,
  "tax_reports.already_closed": 409,
  "tax_reports.immutable": 409,
  "tax_reports.retry": 503,
};

export class ErroRelatorio extends Error {
  constructor(
    readonly codigo: CodigoErroRelatorio,
    mensagem: string,
    readonly pormenor?: unknown,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroRelatorio";
  }
}

export function traduzirRelatorio(erro: unknown): unknown {
  if (!(erro instanceof Error) || erro instanceof ErroRelatorio) return erro;
  if (erro.message.startsWith("tax_reports.immutable:")) {
    return new ErroRelatorio("tax_reports.immutable", erro.message);
  }
  const pg = erro as Error & { code?: string; constraint?: string };
  if (pg.code === "23505") {
    // Outro fecho ao mesmo tempo: o mesmo período, ou o mesmo documento
    // reclamado por dois períodos (P4).
    return pg.constraint?.startsWith("relatorio_oss_fecho_") === true
      ? new ErroRelatorio(
          "tax_reports.already_closed",
          "este período já está fechado",
        )
      : new ErroRelatorio("tax_reports.retry", "tentar outra vez");
  }
  if (pg.code === "22P02" && /uuid/.test(erro.message)) {
    return new ErroRelatorio("tax_reports.not_found", "não existe");
  }
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
    return new ErroRelatorio("tax_reports.retry", "tentar outra vez");
  }
  return erro;
}

// -------------------------------------------------------------- O período

export interface Periodo {
  texto: string;
  granularidade: "trimestre" | "mes";
  /** AAAA-MM-DD, incluído. */
  inicio: string;
  /** AAAA-MM-DD, excluído. */
  fim: string;
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** 2026-T4 (trimestre civil, art. 369.º-F) ou 2026-10 (mês). */
export function lerPeriodo(texto: string): Periodo {
  const t = /^(\d{4})-T([1-4])$/.exec(texto);
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(texto);
  if (t !== null) {
    const ano = Number(t[1]);
    const q = Number(t[2]);
    const mesInicio = (q - 1) * 3 + 1;
    const fimAno = q === 4 ? ano + 1 : ano;
    const fimMes = q === 4 ? 1 : mesInicio + 3;
    return {
      texto,
      granularidade: "trimestre",
      inicio: `${String(ano)}-${doisDigitos(mesInicio)}-01`,
      fim: `${String(fimAno)}-${doisDigitos(fimMes)}-01`,
    };
  }
  if (m !== null) {
    const ano = Number(m[1]);
    const mes = Number(m[2]);
    return {
      texto,
      granularidade: "mes",
      inicio: `${String(ano)}-${doisDigitos(mes)}-01`,
      fim:
        mes === 12
          ? `${String(ano + 1)}-01-01`
          : `${String(ano)}-${doisDigitos(mes + 1)}-01`,
    };
  }
  throw new ErroRelatorio(
    "tax_reports.invalid_period",
    "o período é um trimestre (2026-T4) ou um mês (2026-10)",
  );
}

/** O período (da mesma granularidade) em que cai uma data AAAA-MM-DD. */
export function periodoDe(
  data: string,
  granularidade: "trimestre" | "mes",
): string {
  const ano = data.slice(0, 4);
  const mes = Number(data.slice(5, 7));
  return granularidade === "mes"
    ? `${ano}-${doisDigitos(mes)}`
    : `${ano}-T${String(Math.ceil(mes / 3))}`;
}

/** Hoje, no fuso de Portugal (a entidade da Fase 1; P2). */
function hoje(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ------------------------------------------------------------ A leitura

interface LinhaDaProva {
  descricao: string;
  quantidade: number;
  base: number;
  taxa: number;
  iva: number;
  codigo_motivo: string | null;
}

export interface DocumentoLido {
  id: string;
  tipo: "fatura" | "nota_credito";
  estado: string;
  encomenda_id: string;
  original_id: string | null;
  reembolso_id: string | null;
  numero: string;
  serie: string | null;
  data: string | null;
  atcud: string | null;
  nif: string | null;
  nome: string | null;
  linhas: LinhaDaProva[];
  conteudo: Conteudo;
}

/** Uma linha do relatório: um balde, um país e uma taxa. */
export interface LinhaRelatorio {
  balde: Balde;
  pais: string;
  /** Centésimas de ponto (2100 = 21 %); 0 numa isenta. */
  taxa: number;
  base: number;
  iva: number;
  documentos: number;
}

export interface Alteracao extends LinhaRelatorio {
  periodo_original: string;
}

export interface Impedimento {
  motivo:
    | "divergente"
    | "outra_moeda"
    | "sem_data"
    | "sem_balde"
    | "linhas_desalinhadas"
    | "por_emitir"
    | "periodo_em_curso";
  documentos: string[];
}

export interface Relatorio {
  entidade_legal: string;
  periodo: string;
  granularidade: "trimestre" | "mes";
  fechado: null | { em: string; por: string; versao_regra: number };
  moeda: "EUR";
  baldes: {
    balde: Balde;
    base: number;
    iva: number;
    linhas: LinhaRelatorio[];
  }[];
  alteracoes: Alteracao[];
  a_parte: {
    emitidas_fora: {
      documento: string;
      encomenda: string;
      pais: string | null;
      total: number;
      numero_declarado: string | null;
    }[];
    sistema_proprio: {
      encomenda: string;
      pais: string | null;
      total: number;
    }[];
    por_emitir: { documento: string; encomenda: string; estado: string }[];
  };
  limiar: {
    ano: string;
    vendas_a_distancia_base: number;
    limiar: number;
    passou: boolean;
  };
  impedimentos: Impedimento[];
}

async function lerDocumentos(
  trx: Transaction<BaseDados>,
  entidade: string,
  ate: string,
  granularidade: "trimestre" | "mes",
  soNaoDeclarados: boolean,
  desde: string | null,
): Promise<DocumentoLido[]> {
  const { rows } = await sql<{
    id: string;
    tipo: "fatura" | "nota_credito";
    estado: string;
    encomenda_id: string;
    original_id: string | null;
    reembolso_id: string | null;
    numero: string;
    serie: string | null;
    data: string | null;
    atcud: string | null;
    nif: string | null;
    nome: string | null;
    linhas: LinhaDaProva[];
    conteudo: Conteudo;
  }>`
    select d.id, d.tipo, d.estado, d.encomenda_id, d.original_id, d.reembolso_id,
      p.numero, p.serie, to_char(p.data, 'YYYY-MM-DD') as data, p.atcud, p.nif, p.nome, p.linhas,
      (select c.conteudo from documento_conteudo c where c.documento_id = d.id
        order by c.versao desc limit 1) as conteudo
    from documento_fiscal d
    join documento_prova p on p.documento_id = d.id
    where d.entidade_legal_id = ${entidade}::uuid
      and d.estado in ('emitido', 'divergente', 'resolvido')
      and (p.data is null or p.data < ${ate}::date)
      and (${desde}::text is null or p.data is null or p.data >= ${desde}::date)
      and (not ${soNaoDeclarados} or not exists (
        select 1 from relatorio_oss_documento r
        where r.documento_id = d.id and r.granularidade = ${granularidade}))
    order by p.data, d.id`.execute(trx);
  return rows;
}

/** As linhas de um documento nos baldes, ou o impedimento. */
function linhasDe(
  d: DocumentoLido,
  paisEntidade: string,
): {
  linhas: Omit<LinhaRelatorio, "documentos">[];
  impedimento: Impedimento["motivo"] | null;
} {
  if (d.conteudo.moeda !== "EUR")
    return { linhas: [], impedimento: "outra_moeda" };
  if (d.linhas.length !== d.conteudo.linhas.length) {
    return { linhas: [], impedimento: "linhas_desalinhadas" };
  }
  const sinal = d.tipo === "nota_credito" ? -1 : 1;
  const linhas: Omit<LinhaRelatorio, "documentos">[] = [];
  for (const [i, lc] of d.conteudo.linhas.entries()) {
    const lp = d.linhas[i] as LinhaDaProva;
    const balde = baldeDe(lc.regra, lc.pais_imposto, paisEntidade);
    if (balde === null) return { linhas: [], impedimento: "sem_balde" };
    linhas.push({
      balde,
      // O3: o país de entrega; no nacional, o país do imposto (o do
      // comerciante).
      pais:
        balde === "nacional"
          ? (lc.pais_imposto ?? paisEntidade)
          : (d.conteudo.destino ?? lc.pais_imposto ?? paisEntidade),
      taxa: lp.taxa,
      base: sinal * lp.base,
      iva: sinal * lp.iva,
    });
  }
  return { linhas, impedimento: null };
}

function somar<T extends LinhaRelatorio>(
  alvo: Map<string, T>,
  chave: string,
  l: Omit<LinhaRelatorio, "documentos">,
  extra: Omit<T, keyof LinhaRelatorio>,
  documento: string,
  vistos: Map<string, Set<string>>,
) {
  const a = alvo.get(chave);
  const docs = vistos.get(chave) ?? new Set<string>();
  docs.add(documento);
  vistos.set(chave, docs);
  if (a === undefined) {
    alvo.set(chave, { ...l, ...extra, documentos: 1 } as T);
  } else {
    a.base += l.base;
    a.iva += l.iva;
    a.documentos = docs.size;
  }
}

async function paisDaEntidade(trx: Transaction<BaseDados>, entidade: string) {
  const e = await trx
    .selectFrom("entidade_legal")
    .select("pais")
    .where("id", "=", entidade)
    .executeTakeFirst();
  if (e === undefined) {
    throw new ErroRelatorio(
      "tax_reports.not_found",
      "esta entidade não existe",
    );
  }
  return e.pais;
}

async function fechoDe(
  trx: Transaction<BaseDados>,
  entidade: string,
  p: Periodo,
) {
  return trx
    .selectFrom("relatorio_oss_fecho")
    .selectAll()
    .where("entidade_legal_id", "=", entidade)
    .where("granularidade", "=", p.granularidade)
    .where("periodo", "=", p.texto)
    .executeTakeFirst();
}

/**
 * A classificação, sem base de dados (docs/36 §2–§3): os documentos do
 * período nos baldes, os de um período fechado como alterações (P4), e o
 * que impede o fecho. Os documentos de um período anterior ainda aberto
 * ficam de fora (pertencem a esse período).
 */
export function agregar(
  docs: DocumentoLido[],
  paisEntidade: string,
  p: Periodo,
  fechados: ReadonlySet<string>,
) {
  const impedimentos = new Map<Impedimento["motivo"], Set<string>>();
  const impedir = (m: Impedimento["motivo"], id: string) => {
    const s = impedimentos.get(m) ?? new Set<string>();
    s.add(`inv_${id}`);
    impedimentos.set(m, s);
  };
  const doPeriodo = new Map<string, LinhaRelatorio>();
  const alteracoes = new Map<string, Alteracao>();
  const vistos = new Map<string, Set<string>>();
  const incluidos: { id: string; periodo_original: string }[] = [];
  for (const d of docs) {
    if (d.data === null) {
      impedir("sem_data", d.id);
      continue;
    }
    const original = periodoDe(d.data, p.granularidade);
    const noPeriodo = d.data >= p.inicio;
    // Um documento de um período anterior ainda aberto pertence a esse
    // período; só os de um período fechado vêm como alteração (P4).
    if (!noPeriodo && !fechados.has(original)) continue;
    if (d.estado === "divergente") {
      impedir("divergente", d.id);
      continue;
    }
    const { linhas, impedimento } = linhasDe(d, paisEntidade);
    if (impedimento !== null) {
      impedir(impedimento, d.id);
      continue;
    }
    for (const l of linhas) {
      if (noPeriodo) {
        somar(
          doPeriodo,
          `${l.balde}|${l.pais}|${String(l.taxa)}`,
          l,
          {},
          d.id,
          vistos,
        );
      } else {
        somar(
          alteracoes,
          `${original}|${l.balde}|${l.pais}|${String(l.taxa)}`,
          l,
          { periodo_original: original },
          d.id,
          vistos,
        );
      }
    }
    incluidos.push({ id: d.id, periodo_original: original });
  }
  const baldes = BALDES.map((balde) => {
    const linhas = [...doPeriodo.values()]
      .filter((l) => l.balde === balde)
      .sort((a, b) => a.pais.localeCompare(b.pais) || a.taxa - b.taxa);
    return {
      balde,
      base: linhas.reduce((s, l) => s + l.base, 0),
      iva: linhas.reduce((s, l) => s + l.iva, 0),
      linhas,
    };
  });

  return { baldes, alteracoes, impedimentos, impedir, incluidos };
}

/** Calcula o relatório de um período aberto (nunca o de um fechado). */
async function calcular(
  trx: Transaction<BaseDados>,
  entidade: string,
  p: Periodo,
): Promise<{
  relatorio: Relatorio;
  documentos: { id: string; periodo_original: string }[];
}> {
  const paisEntidade = await paisDaEntidade(trx, entidade);
  const fechados = new Set(
    (
      await trx
        .selectFrom("relatorio_oss_fecho")
        .select("periodo")
        .where("entidade_legal_id", "=", entidade)
        .where("granularidade", "=", p.granularidade)
        .execute()
    ).map((f) => f.periodo),
  );
  const docs = await lerDocumentos(
    trx,
    entidade,
    p.fim,
    p.granularidade,
    true,
    null,
  );
  const { baldes, alteracoes, impedimentos, impedir, incluidos } = agregar(
    docs,
    paisEntidade,
    p,
    fechados,
  );

  // À parte (§2.2), pela data de pagamento no fuso de Portugal.
  const { rows: fora } = await sql<{
    id: string;
    encomenda_id: string;
    pais: string | null;
    total: string;
    fora_numero: string | null;
  }>`select d.id, d.encomenda_id, e.entrega->>'pais' as pais, e.total, d.fora_numero
     from documento_fiscal d join encomenda e on e.id = d.encomenda_id
     where d.entidade_legal_id = ${entidade}::uuid and d.estado = 'fora' and d.tipo = 'fatura'
       and (d.criado_em at time zone 'Europe/Lisbon')::date >= ${p.inicio}::date
       and (d.criado_em at time zone 'Europe/Lisbon')::date < ${p.fim}::date
     order by d.id`.execute(trx);
  const { rows: proprio } = await sql<{
    id: string;
    pais: string | null;
    total: string;
  }>`select e.id, e.entrega->>'pais' as pais, e.total
     from encomenda e
     where e.entidade_legal_id = ${entidade}::uuid and e.emissor_fiscal = 'sistema_proprio'
       and exists (select 1 from pagamento g join transicao_pagamento t on t.pagamento_id = g.id
         where g.encomenda_id = e.id and t.para = 'capturado'
           and (t.em at time zone 'Europe/Lisbon')::date >= ${p.inicio}::date
           and (t.em at time zone 'Europe/Lisbon')::date < ${p.fim}::date)
     order by e.id`.execute(trx);
  const { rows: porEmitir } = await sql<{
    id: string;
    encomenda_id: string;
    estado: string;
  }>`select d.id, d.encomenda_id, d.estado from documento_fiscal d
     where d.entidade_legal_id = ${entidade}::uuid
       and d.estado in ('a_verificar', 'retido', 'pronto', 'rascunho', 'incerto')
       and (d.criado_em at time zone 'Europe/Lisbon')::date < ${p.fim}::date
     order by d.id`.execute(trx);
  for (const x of porEmitir) impedir("por_emitir", x.id);
  if (p.fim > hoje()) {
    impedimentos.set("periodo_em_curso", new Set());
  }

  // O limiar (§2.3): as vendas à distância que o Eurolify vê no ano civil.
  const ano = p.inicio.slice(0, 4);
  let distancia = 0;
  for (const d of await lerDocumentos(
    trx,
    entidade,
    `${String(Number(ano) + 1)}-01-01`,
    p.granularidade,
    false,
    `${ano}-01-01`,
  )) {
    if (d.data === null || d.estado === "divergente") continue;
    const { linhas, impedimento } = linhasDe(d, paisEntidade);
    if (impedimento !== null) continue;
    d.conteudo.linhas.forEach((lc: LinhaDoConteudo, i) => {
      if (lc.regra === "distancia_destino" || lc.regra === "distancia_origem") {
        distancia += linhas[i]?.base ?? 0;
      }
    });
  }

  return {
    relatorio: {
      entidade_legal: `lgl_${entidade}`,
      periodo: p.texto,
      granularidade: p.granularidade,
      fechado: null,
      moeda: "EUR",
      baldes,
      alteracoes: [...alteracoes.values()].sort(
        (a, b) =>
          a.periodo_original.localeCompare(b.periodo_original) ||
          a.balde.localeCompare(b.balde) ||
          a.pais.localeCompare(b.pais) ||
          a.taxa - b.taxa,
      ),
      a_parte: {
        emitidas_fora: fora.map((x) => ({
          documento: `inv_${x.id}`,
          encomenda: `ord_${x.encomenda_id}`,
          pais: x.pais,
          total: Number(x.total),
          numero_declarado: x.fora_numero,
        })),
        sistema_proprio: proprio.map((x) => ({
          encomenda: `ord_${x.id}`,
          pais: x.pais,
          total: Number(x.total),
        })),
        por_emitir: porEmitir.map((x) => ({
          documento: `inv_${x.id}`,
          encomenda: `ord_${x.encomenda_id}`,
          estado: x.estado,
        })),
      },
      limiar: {
        ano,
        vendas_a_distancia_base: distancia,
        limiar: LIMIAR_CENTIMOS,
        passou: distancia > LIMIAR_CENTIMOS,
      },
      impedimentos: [...impedimentos.entries()].map(([motivo, docs]) => ({
        motivo,
        documentos: [...docs].sort(),
      })),
    },
    documentos: incluidos,
  };
}

/** O relatório: a fotografia de um período fechado, ou o cálculo de um aberto. */
export async function relatorioOss(
  db: Kysely<BaseDados>,
  c: string,
  entidade: string,
  periodo: string,
): Promise<Relatorio> {
  const p = lerPeriodo(periodo);
  return noDocumentos(db, c, async (trx) => {
    const fecho = await fechoDe(trx, entidade, p);
    if (fecho !== undefined) {
      return {
        ...(fecho.fotografia as Relatorio),
        fechado: {
          em: fecho.fechado_em.toISOString(),
          por: fecho.fechado_por,
          versao_regra: fecho.versao_regra,
        },
      };
    }
    return (await calcular(trx, entidade, p)).relatorio;
  });
}

/**
 * Fecha um período (P3–P6): só o dono (`tax:write`); recusa com divergentes,
 * outra moeda, documentos sem data ou sem balde, ou um período em curso; os
 * «por emitir» só com a confirmação de quem fecha. Grava a fotografia e os
 * documentos que entraram, uma vez só.
 */
export async function fecharOss(
  db: Kysely<BaseDados>,
  c: string,
  entidade: string,
  periodo: string,
  dados: { confirmo_por_emitir: boolean },
  quem: string,
): Promise<Relatorio> {
  const p = lerPeriodo(periodo);
  return noDocumentos(db, c, async (trx) => {
    // Um fecho de cada vez por entidade: dois fechos ao mesmo tempo
    // disputariam as mesmas alterações (P4).
    await sql`select pg_advisory_xact_lock(hashtext(${`oss:${entidade}`}))`.execute(
      trx,
    );
    if ((await fechoDe(trx, entidade, p)) !== undefined) {
      throw new ErroRelatorio(
        "tax_reports.already_closed",
        "este período já está fechado",
      );
    }
    const { relatorio, documentos } = await calcular(trx, entidade, p);
    const bloqueios = relatorio.impedimentos.filter(
      (i) => i.motivo !== "por_emitir" || !dados.confirmo_por_emitir,
    );
    if (bloqueios.length > 0) {
      throw new ErroRelatorio(
        "tax_reports.not_closable",
        "o período ainda não se pode fechar",
        { impedimentos: bloqueios },
      );
    }
    const { id, fechado_em } = await trx
      .insertInto("relatorio_oss_fecho")
      .values({
        comerciante_id: c,
        entidade_legal_id: entidade,
        granularidade: p.granularidade,
        periodo: p.texto,
        fotografia: JSON.stringify(relatorio),
        versao_regra: VERSAO_REGRA,
        confirmacoes: JSON.stringify({
          por_emitir: dados.confirmo_por_emitir
            ? relatorio.a_parte.por_emitir.map((x) => x.documento)
            : [],
        }),
        fechado_por: quem,
      })
      .returning(["id", "fechado_em"])
      .executeTakeFirstOrThrow();
    if (documentos.length > 0) {
      await trx
        .insertInto("relatorio_oss_documento")
        .values(
          documentos.map((d) => ({
            comerciante_id: c,
            fecho_id: id,
            granularidade: p.granularidade,
            documento_id: d.id,
            periodo_original: d.periodo_original,
          })),
        )
        .execute();
    }
    return {
      ...relatorio,
      fechado: {
        em: fechado_em.toISOString(),
        por: quem,
        versao_regra: VERSAO_REGRA,
      },
    };
  });
}

// ------------------------------------------------------------ Os registos

const COLUNAS = [
  "periodo",
  "periodo_original",
  "tipo",
  "numero",
  "serie",
  "data",
  "atcud",
  "fatura_corrigida",
  "nif",
  "nome",
  "pais_consumo",
  "balde",
  "descricao",
  "quantidade",
  "valor_tributavel",
  "taxa",
  "iva",
  "moeda",
  "data_pagamento",
  "montante_pagamento",
  "data_expedicao",
  "pais_inicio_transporte",
  "pais_entrega",
  "codigo_postal_entrega",
  "devolucao",
] as const;

const euros = (c: number) => (c / 100).toFixed(2);
const taxaEmTexto = (t: number) => (t / 100).toFixed(2);

export function celula(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  // Fórmulas não entram numa folha de cálculo (injecção CSV).
  const seguro = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/**
 * Os registos do art. 63.º-C do Reg. 282/2011 (docs/36 §4): uma linha por
 * linha de documento do período (os do período e as alterações). De um
 * período fechado, os documentos que entraram nele; de um aberto, os que
 * entrariam se fechasse agora.
 */
export async function registosOss(
  db: Kysely<BaseDados>,
  c: string,
  entidade: string,
  periodo: string,
): Promise<string> {
  const p = lerPeriodo(periodo);
  return noDocumentos(db, c, async (trx) => {
    const paisEntidade = await paisDaEntidade(trx, entidade);
    const fecho = await fechoDe(trx, entidade, p);
    const ids =
      fecho === undefined
        ? (await calcular(trx, entidade, p)).documentos
        : await trx
            .selectFrom("relatorio_oss_documento")
            .select(["documento_id as id", "periodo_original"])
            .where("fecho_id", "=", fecho.id)
            .execute();
    const original = new Map(ids.map((x) => [x.id, x.periodo_original]));
    const todos = await lerDocumentos(
      trx,
      entidade,
      "9999-12-31",
      p.granularidade,
      false,
      null,
    );
    const docs = todos.filter((d) => original.has(d.id));
    const linhas: string[] = [COLUNAS.join(",")];
    for (const d of docs) {
      const { rows } = await sql<{
        data_pagamento: Date | null;
        montante: string | null;
        expedida_em: Date | null;
        pais_armazem: string | null;
        entrega_pais: string | null;
        entrega_cp: string | null;
        devolucao: string | null;
        fatura: string | null;
      }>`select
          (select t.em from pagamento g join transicao_pagamento t on t.pagamento_id = g.id
           where g.encomenda_id = e.id and t.para = 'capturado' order by t.em limit 1) as data_pagamento,
          (select g.montante from pagamento g where g.encomenda_id = e.id and g.estado = 'capturado'
           order by g.id limit 1) as montante,
          (select min(x.expedida_em) from expedicao x where x.encomenda_id = e.id) as expedida_em,
          (select a.morada->>'pais' from expedicao x join armazem a on a.id = x.armazem_id
           where x.encomenda_id = e.id order by x.expedida_em nulls last limit 1) as pais_armazem,
          e.entrega->>'pais' as entrega_pais, e.entrega->>'codigo_postal' as entrega_cp,
          (select r.devolucao_id from reembolso r where r.id = ${d.reembolso_id}::uuid) as devolucao,
          (select p.numero from documento_prova p where p.documento_id = ${d.original_id}::uuid) as fatura
        from encomenda e where e.id = ${d.encomenda_id}::uuid`.execute(trx);
      const x = rows[0];
      const { linhas: noBalde } = linhasDe(d, paisEntidade);
      d.linhas.forEach((lp, i) => {
        const lb = noBalde[i];
        const sinal = d.tipo === "nota_credito" ? -1 : 1;
        linhas.push(
          [
            p.texto,
            original.get(d.id) ?? null,
            d.tipo,
            d.numero,
            d.serie,
            d.data,
            d.atcud,
            x?.fatura ?? null,
            d.nif,
            d.nome,
            lb?.pais ?? d.conteudo.destino,
            lb?.balde ?? null,
            lp.descricao,
            lp.quantidade,
            euros(sinal * lp.base),
            taxaEmTexto(lp.taxa),
            euros(sinal * lp.iva),
            d.conteudo.moeda,
            x?.data_pagamento?.toISOString().slice(0, 10) ?? null,
            x?.montante == null ? null : euros(Number(x.montante)),
            x?.expedida_em?.toISOString().slice(0, 10) ?? null,
            x?.pais_armazem ?? paisEntidade,
            x?.entrega_pais ?? null,
            x?.entrega_cp ?? null,
            x?.devolucao == null ? null : `rma_${x.devolucao}`,
          ]
            .map(celula)
            .join(","),
        );
      });
    }
    return `${linhas.join("\r\n")}\r\n`;
  });
}
