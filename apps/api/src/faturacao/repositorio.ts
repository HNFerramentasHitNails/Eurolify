import { createHash } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type {
  BaseDados,
  EmissorFiscal,
  EstadoDocumento,
  IsencaoDoEmissor,
  TaxaDoEmissor,
} from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import type { Decisao } from "../iva/decisao.js";
import { cifrar, decifrar } from "../pagamentos/cifra.js";
import {
  ErroDeRede,
  ErroDoEmissor,
  type AdaptadorFaturacao,
  type ConfigFaturacao,
  type CredenciaisEmissor,
  type DocumentoNoEmissor,
  type PedidoRascunho,
} from "./adaptador.js";
import { ErroDocumentos, traduzir } from "./erros.js";

// Os documentos fiscais (docs/29; migração 0050; issue #310; Diogo,
// 10/10/2026: «sim, aprovo; avança com o código da fatia 10»).
//
// 🔴 Na dúvida, retém. O documento nasce da cópia da encomenda (nunca de um
// novo cálculo), a prova é o documento lido de volta do emissor, um timeout
// reconcilia-se antes de tentar outra vez, e as decisões de uma pessoa são
// uma de cada vez (AGENTS.md, «Não se erra em documentos fiscais»).
//
// As chamadas ao emissor nunca correm dentro de uma transacção da base: cada
// passo grava o que vai fazer, chama, e grava o que aconteceu.

export const QUEM_DA_TAREFA = "sistema:documentos";

/** Os motivos de retenção (docs/29 §5, R3): lista fechada. */
export const MOTIVOS_RETENCAO = [
  "emissor_por_configurar",
  "ligacao_sem_teste",
  "nif_recusado",
  // Um NIF de consumidor final dado como NIF, ou uma empresa sem NIF: sairia
  // como consumidor final, por isso nunca se liberta, corrige-se (R4, Q4;
  // revisão do #312, P2-3).
  "nif_consumidor_final",
  "perfil_de_outra_ficha",
  "isencao_sem_prova",
  "taxa_sem_mapa",
  "isencao_sem_mapa",
  "taxa_por_verificar",
  "territorio_por_decidir",
  "moeda_nao_suportada",
  "totais_nao_batem",
  "entidade_do_emissor_diferente",
  // A pós-venda (docs/30): a NC espera pela fatura e não passa o saldo dela;
  // uma fatura de uma encomenda já reembolsada por inteiro espera pelo
  // contabilista (C2).
  "original_por_emitir",
  "credito_acima_do_saldo",
  "encomenda_reembolsada",
  // A NC só sai depois de o dinheiro sair (o reembolso executado); um
  // reembolso anulado deixa a NC retida para sempre (revisão do #329, P1-4;
  // a ordem final é a pergunta C1 do contabilista).
  "reembolso_por_executar",
  "reembolso_cancelado",
] as const;
export type MotivoRetencao = (typeof MOTIVOS_RETENCAO)[number];

/**
 * Os motivos que uma pessoa pode libertar (R9): o que ela sabe e o sistema
 * não (o número está certo, a prova existe). Os outros resolvem-se na
 * configuração ou corrigindo, e depois verifica-se outra vez.
 */
export const LIBERTAVEIS: readonly MotivoRetencao[] = [
  "nif_recusado",
  "isencao_sem_prova",
  "perfil_de_outra_ficha",
  "encomenda_reembolsada",
];

/**
 * Os NIF que valem «consumidor final» num país: dados como NIF, não saem
 * assim — retêm (lição 1.10 do docs/04, **M**: 6 faturas saíram 999999990 a
 * quem tinha dado o número).
 */
const NIF_DE_CONSUMIDOR_FINAL: Record<string, readonly string[]> = {
  PT: ["999999990"],
};

/** Moedas que o documento aceita até o contabilista responder (V7). */
const MOEDAS_SUPORTADAS = ["EUR"];

/** Tentativas de reconciliação automática antes de ir para a fila. */
const RECONCILIACOES_AUTOMATICAS = 3;
const POR_VOLTA = 20;

export async function noDocumentos<T>(
  db: Kysely<BaseDados>,
  c: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
): Promise<T> {
  try {
    if (db.isTransaction) return await fn(db as Transaction<BaseDados>);
    return await comComerciante(db, c, fn);
  } catch (erro) {
    throw traduzir(erro);
  }
}

async function marcar(
  trx: Transaction<BaseDados>,
  quem: string,
  motivo: string | null = null,
) {
  await sql`select set_config('eurolify.quem', ${quem}, true),
    set_config('eurolify.motivo', ${motivo ?? ""}, true)`.execute(trx);
}

// --------------------------------------------------------- Quem emite

export async function definirEmissor(
  trx: Transaction<BaseDados>,
  c: string,
  entidadeId: string,
  emissor: Exclude<EmissorFiscal, "por_configurar">,
) {
  return noDocumentos(trx, c, async () => {
    const r = await trx
      .updateTable("entidade_legal")
      .set({ emissor_fiscal: emissor })
      .where("id", "=", entidadeId)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) {
      throw new ErroDocumentos(
        "invoices.not_found",
        "esta entidade legal não existe",
      );
    }
  });
}

// ------------------------------------------------------- As ligações

function exigirChave(cfg: ConfigFaturacao | undefined) {
  if (cfg?.chave === undefined) {
    throw new ErroDocumentos(
      "invoices.not_configured",
      "a faturação não está ligada neste servidor (FATURACAO_CHAVE)",
    );
  }
  return cfg.chave;
}

function adaptadorDe(
  cfg: ConfigFaturacao | undefined,
  nome: string,
): AdaptadorFaturacao {
  const a = cfg?.adaptadores[nome as "ensaio" | "moloni"];
  if (a === undefined) {
    throw new ErroDocumentos(
      "invoices.not_configured",
      `o adaptador ${nome} não está disponível neste servidor`,
    );
  }
  return a;
}

export async function criarLigacao(
  trx: Transaction<BaseDados>,
  c: string,
  dados: {
    entidade_legal: string;
    adaptador: "ensaio" | "moloni";
    serie: string | null;
    taxas: TaxaDoEmissor[];
    isencoes: IsencaoDoEmissor[];
  },
  quem: string,
) {
  return noDocumentos(trx, c, async () => {
    if (dados.adaptador === "moloni") {
      // O Moloni é a parte 2 (docs/29 Q5): sem a documentação lida, não há
      // adaptador.
      throw new ErroDocumentos(
        "invoices.not_configured",
        "o adaptador Moloni ainda não existe (parte 2)",
      );
    }
    const { id } = await trx
      .insertInto("ligacao_faturacao")
      .values({
        comerciante_id: c,
        entidade_legal_id: dados.entidade_legal,
        adaptador: dados.adaptador,
        serie: dados.serie,
        taxas: JSON.stringify(dados.taxas),
        isencoes: JSON.stringify(dados.isencoes),
        criada_por: quem,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
}

export async function listarLigacoes(db: Kysely<BaseDados>, c: string) {
  return noDocumentos(db, c, (trx) =>
    trx
      .selectFrom("ligacao_faturacao")
      .select([
        "id",
        "entidade_legal_id",
        "adaptador",
        "modo",
        "estado",
        "activa",
        "serie",
        "taxas",
        "isencoes",
        "credenciais_em",
        "credenciais_por",
        "testada_em",
        "erro",
        "versao",
      ])
      .orderBy("id")
      .execute(),
  );
}

async function ligacaoParaMudar(
  trx: Transaction<BaseDados>,
  id: string,
  versao: number | null,
) {
  const l = await trx
    .selectFrom("ligacao_faturacao")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (l === undefined) {
    throw new ErroDocumentos("invoices.not_found", "esta ligação não existe");
  }
  if (versao !== null && l.versao !== versao) {
    throw new ErroDocumentos("invoices.version_conflict", "a ligação mudou", {
      versao: l.versao,
    });
  }
  return l;
}

export async function mudarLigacao(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  versao: number,
  dados: {
    serie?: string | null;
    taxas?: TaxaDoEmissor[];
    isencoes?: IsencaoDoEmissor[];
    activa?: false;
  },
) {
  return noDocumentos(trx, c, async () => {
    const l = await ligacaoParaMudar(trx, id, versao);
    await trx
      .updateTable("ligacao_faturacao")
      .set({
        ...(dados.serie === undefined ? {} : { serie: dados.serie }),
        ...(dados.taxas === undefined
          ? {}
          : { taxas: JSON.stringify(dados.taxas) }),
        ...(dados.isencoes === undefined
          ? {}
          : { isencoes: JSON.stringify(dados.isencoes) }),
        ...(dados.activa === undefined ? {} : { activa: false }),
        versao: l.versao + 1,
      })
      .where("id", "=", id)
      .execute();
    return l.versao + 1;
  });
}

export async function definirCredenciais(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  credenciais: CredenciaisEmissor,
  cfg: ConfigFaturacao | undefined,
  quem: string,
) {
  const chave = exigirChave(cfg);
  return noDocumentos(trx, c, async () => {
    const l = await ligacaoParaMudar(trx, id, null);
    await trx
      .updateTable("ligacao_faturacao")
      .set({
        credenciais: cifrar(
          JSON.stringify(credenciais),
          id,
          "credenciais",
          chave,
        ),
        credenciais_versao_chave: chave.versao,
        credenciais_em: new Date(),
        credenciais_por: quem,
        estado: "por_testar",
        erro: null,
        versao: l.versao + 1,
      })
      .where("id", "=", id)
      .execute();
  });
}

function credenciaisDe(
  l: {
    id: string;
    credenciais: Buffer | null;
    credenciais_versao_chave: string | null;
  },
  cfg: ConfigFaturacao | undefined,
): CredenciaisEmissor | null {
  if (l.credenciais === null) return null;
  const chave = exigirChave(cfg);
  if (l.credenciais_versao_chave !== chave.versao) {
    throw new ErroDocumentos(
      "invoices.not_configured",
      "as credenciais foram cifradas com outra versão da chave (FATURACAO_CHAVE_VERSAO)",
    );
  }
  return JSON.parse(
    decifrar(l.credenciais, l.id, "credenciais", chave),
  ) as CredenciaisEmissor;
}

/** Testa a ligação no emissor (fora da transacção) e grava o resultado. */
export async function testarLigacao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigFaturacao | undefined,
  quem: string,
) {
  const l = await noDocumentos(db, c, (trx) => ligacaoParaMudar(trx, id, null));
  const credenciais = credenciaisDe(l, cfg);
  if (credenciais === null) {
    throw new ErroDocumentos(
      "invoices.issuer_not_ready",
      "a ligação não tem credenciais",
    );
  }
  let erro: string | null = null;
  try {
    await adaptadorDe(cfg, l.adaptador).testar(credenciais);
  } catch (e) {
    if (!(e instanceof ErroDoEmissor) && !(e instanceof ErroDeRede)) throw e;
    erro = e.message.slice(0, 200);
  }
  await noDocumentos(db, c, async (trx) => {
    await marcar(trx, quem);
    // O resultado é das credenciais e dos mapas lidos: se mudaram durante o
    // teste, não vale (revisão do #312, P2-7).
    const agora = await ligacaoParaMudar(trx, id, l.versao);
    await trx
      .updateTable("ligacao_faturacao")
      .set({
        estado: erro === null ? "pronta" : "com_erro",
        testada_em: new Date(),
        erro,
        versao: agora.versao + 1,
      })
      .where("id", "=", id)
      .execute();
  });
  return { estado: erro === null ? "pronta" : "com_erro", erro };
}

// ------------------------------------------------------- O conteúdo (§3.3)

export interface LinhaDoConteudo {
  posicao: number;
  sku: string | null;
  descricao: string;
  quantidade: number;
  base: number;
  iva: number;
  total: number;
  resultado: "tributada" | "isenta" | "bloqueada";
  pais_imposto: string | null;
  /** Centésimas de ponto; 0 numa isenta. */
  taxa: number;
  codigo_motivo: string | null;
  regra: string;
  verificado: boolean;
  vies_prova: string | null;
  isencao: string | null;
}

export interface Conteudo {
  formato: 1;
  encomenda: string;
  entidade_legal: { id: string; pais: string };
  cliente: {
    tipo: string;
    nome: string;
    /** Como sai no documento: com o prefixo fiscal, salvo no país da entidade. */
    nif: string | null;
    /** Só o número, para comparar (eu-vat-oss-ioss, «NIF»). */
    nif_numero: string | null;
    /** Como a pessoa o escreveu (para a régua). */
    nif_escrito: string | null;
    pais_contribuinte: string | null;
    morada: Record<string, string | null>;
  };
  moeda: string;
  preco_inclui_iva: boolean;
  linhas: LinhaDoConteudo[];
  totais: { base: number; iva: number; total: number };
  meio_pagamento: string;
  destino: string | null;
  carimbo: string;
  /** Só na nota de crédito (docs/30 §3.5): o tipo e a fatura (`inv_…`). */
  tipo?: "nota_credito";
  original?: string;
}

/** JSON com as chaves por ordem: a mesma entrada dá a mesma impressão. */
function canonico(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
    .join(",")}}`;
}

export const impressaoDe = (c: Conteudo) =>
  createHash("sha256").update(canonico(c)).digest("hex");

/** O prefixo fiscal do país (o grego é EL; eu-vat-oss-ioss, «NIF»). */
const prefixoFiscal = (pais: string) => (pais === "GR" ? "EL" : pais);

/** O número sem o prefixo fiscal do país, sem pontuação. */
export function nifSoNumero(
  nif: string | null,
  pais: string | null,
): string | null {
  if (nif === null) return null;
  const limpo = nif.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (pais !== null && limpo.startsWith(prefixoFiscal(pais))) {
    return limpo.slice(prefixoFiscal(pais).length);
  }
  return limpo;
}

const taxaEmTexto = (t: number) =>
  `${(t / 100).toLocaleString("pt-PT", { maximumFractionDigits: 2 })} %`;

/** A nota de carimbo (R13): «destino ES · IVA 21 %», «destino BE · isento (M16)». */
function carimbo(destino: string | null, linhas: LinhaDoConteudo[]): string {
  const partes: string[] = [];
  for (const l of linhas) {
    const p =
      l.resultado === "isenta"
        ? `isento (${l.codigo_motivo ?? "sem código"})`
        : `IVA ${taxaEmTexto(l.taxa)}`;
    if (!partes.includes(p)) partes.push(p);
  }
  return `destino ${destino ?? "?"} · ${partes.join(" + ")}`;
}

function linhaDaDecisao(
  posicao: number,
  sku: string | null,
  descricao: string,
  quantidade: number,
  montantes: { base: number; iva: number; total: number },
  decisao: Decisao,
): LinhaDoConteudo {
  const ev = decisao.evidencia;
  return {
    posicao,
    sku,
    descricao,
    quantidade,
    ...montantes,
    resultado: decisao.resultado,
    pais_imposto:
      decisao.resultado === "bloqueada" ? null : decisao.pais_imposto,
    taxa: decisao.resultado === "bloqueada" ? 0 : decisao.taxa,
    codigo_motivo:
      decisao.resultado === "bloqueada" ? null : decisao.codigo_motivo,
    regra: decisao.regra,
    verificado: ev.verificado,
    vies_prova: ev.vies?.prova ?? null,
    isencao: ev.isencao,
  };
}

/** Monta o conteúdo **só** da encomenda e do pagamento (R2). */
async function montarConteudo(
  trx: Transaction<BaseDados>,
  encomendaId: string,
): Promise<Conteudo> {
  const e = await trx
    .selectFrom("encomenda")
    .innerJoin(
      "entidade_legal",
      "entidade_legal.id",
      "encomenda.entidade_legal_id",
    )
    .select([
      "encomenda.id",
      "encomenda.perfil_copia",
      "encomenda.entrega",
      "encomenda.moeda",
      "encomenda.preco_inclui_iva",
      "encomenda.total_base",
      "encomenda.total_iva",
      "encomenda.total",
      "encomenda.portes",
      "encomenda.lingua",
      "entidade_legal.id as entidade_id",
      "entidade_legal.pais as entidade_pais",
    ])
    .where("encomenda.id", "=", encomendaId)
    .executeTakeFirstOrThrow();
  const linhas = await trx
    .selectFrom("linha_encomenda")
    .select([
      "posicao",
      "sku",
      "nome",
      "quantidade",
      "base",
      "iva",
      "total",
      "decisao_iva",
    ])
    .where("encomenda_id", "=", encomendaId)
    .orderBy("posicao")
    .execute();
  const pagamento = await trx
    .selectFrom("pagamento")
    .select(["metodo"])
    .where("encomenda_id", "=", encomendaId)
    .where("estado", "=", "capturado")
    .orderBy("id")
    .executeTakeFirst();
  const perfil = e.perfil_copia as {
    tipo: string;
    nome_documento: string;
    nif_escrito: string | null;
    nif_numero: string | null;
    pais_contribuinte: string | null;
    morada: Record<string, string | null> | null;
  };
  const entrega = e.entrega as { pais?: string } | null;
  const doConteudo: LinhaDoConteudo[] = linhas.map((l) =>
    linhaDaDecisao(
      l.posicao,
      l.sku,
      l.nome,
      l.quantidade,
      { base: Number(l.base), iva: Number(l.iva), total: Number(l.total) },
      l.decisao_iva as Decisao,
    ),
  );
  const portes = e.portes as {
    nome: Record<string, string>;
    decisao: Decisao;
    base: number;
    iva: number;
    total: number;
  } | null;
  if (portes !== null && portes.total > 0) {
    // Os portes são uma linha própria, nunca um artigo (lição 3.6).
    doConteudo.push(
      linhaDaDecisao(
        doConteudo.length + 1,
        null,
        `Portes — ${portes.nome[e.lingua] ?? Object.values(portes.nome)[0] ?? "envio"}`,
        1,
        { base: portes.base, iva: portes.iva, total: portes.total },
        portes.decisao,
      ),
    );
  }
  const pais = perfil.pais_contribuinte;
  const destino = entrega?.pais ?? null;
  return {
    formato: 1,
    encomenda: `ord_${e.id}`,
    entidade_legal: { id: `lgl_${e.entidade_id}`, pais: e.entidade_pais },
    cliente: {
      tipo: perfil.tipo,
      nome: perfil.nome_documento,
      nif:
        perfil.nif_numero === null
          ? null
          : pais === null || pais === e.entidade_pais
            ? perfil.nif_numero
            : `${prefixoFiscal(pais)}${perfil.nif_numero}`,
      nif_numero: perfil.nif_numero,
      nif_escrito: perfil.nif_escrito,
      pais_contribuinte: pais,
      morada: perfil.morada ?? {},
    },
    moeda: e.moeda,
    preco_inclui_iva: e.preco_inclui_iva,
    linhas: doConteudo,
    totais: {
      base: Number(e.total_base),
      iva: Number(e.total_iva),
      total: Number(e.total),
    },
    meio_pagamento: pagamento?.metodo ?? "desconhecido",
    destino,
    carimbo: carimbo(destino, doConteudo),
  };
}

/**
 * O conteúdo da nota de crédito (docs/30 §3.5): as linhas do reembolso com o
 * tratamento fiscal **copiado** da fatura (taxa, motivo, regra, evidência),
 * nunca recalculado; o montante é o reembolsado, com a base e o IVA na
 * proporção da linha da fatura.
 */
async function montarNotaCredito(
  trx: Transaction<BaseDados>,
  originalId: string,
  reembolsoId: string,
): Promise<Conteudo> {
  const orig = await ultimoConteudo(trx, originalId);
  if (orig === undefined) {
    throw new ErroDocumentos(
      "invoices.invalid_field",
      "a fatura ainda não tem conteúdo",
    );
  }
  const fatura = orig.conteudo as Conteudo;
  const linhas = await trx
    .selectFrom("linha_reembolso")
    .leftJoin(
      "linha_encomenda",
      "linha_encomenda.id",
      "linha_reembolso.linha_encomenda_id",
    )
    .select([
      "linha_reembolso.posicao",
      "linha_reembolso.quantidade",
      "linha_reembolso.montante",
      "linha_encomenda.posicao as posicao_encomenda",
    ])
    .where("linha_reembolso.reembolso_id", "=", reembolsoId)
    .orderBy("linha_reembolso.posicao")
    .execute();
  const doConteudo: LinhaDoConteudo[] = linhas.map((l, i) => {
    const o =
      l.posicao_encomenda === null
        ? fatura.linhas.find((x) => x.sku === null)
        : fatura.linhas.find(
            (x) => x.sku !== null && x.posicao === l.posicao_encomenda,
          );
    if (o === undefined) {
      throw new ErroDocumentos(
        "invoices.invalid_field",
        "uma linha do reembolso não está na fatura",
      );
    }
    const total = Number(l.montante);
    const base =
      o.resultado === "tributada" && o.total > 0
        ? Math.round((total * o.base) / o.total)
        : total;
    return {
      ...o,
      posicao: i + 1,
      quantidade: l.quantidade,
      base,
      iva: total - base,
      total,
    };
  });
  const totais = doConteudo.reduce(
    (s, l) => ({
      base: s.base + l.base,
      iva: s.iva + l.iva,
      total: s.total + l.total,
    }),
    { base: 0, iva: 0, total: 0 },
  );
  return {
    ...fatura,
    linhas: doConteudo,
    totais,
    carimbo: carimbo(fatura.destino, doConteudo),
    tipo: "nota_credito",
    original: `inv_${originalId}`,
  };
}

async function ultimoConteudo(
  trx: Transaction<BaseDados>,
  documentoId: string,
) {
  return trx
    .selectFrom("documento_conteudo")
    .select(["versao", "conteudo", "impressao"])
    .where("documento_id", "=", documentoId)
    .orderBy("versao", "desc")
    .executeTakeFirst();
}

// ------------------------------------------------------- As verificações (R3)

const ehConsumidorFinal = (pais: string | null, numero: string | null) =>
  pais !== null &&
  numero !== null &&
  (NIF_DE_CONSUMIDOR_FINAL[pais] ?? []).includes(numero);

async function nifRecusado(
  trx: Transaction<BaseDados>,
  cliente: Conteudo["cliente"],
  paisEntidade: string,
): Promise<"nif_recusado" | "nif_consumidor_final" | null> {
  if (cliente.nif_escrito === null) {
    // Uma empresa sem NIF não sai como consumidor final (R4).
    return cliente.tipo === "empresa" ? "nif_consumidor_final" : null;
  }
  if (ehConsumidorFinal(cliente.pais_contribuinte, cliente.nif_numero)) {
    return "nif_consumidor_final";
  }
  // A régua do docs/23 (nif_regua) hoje: a mesma função que o perfil usou.
  await sql`savepoint nif_regua`.execute(trx);
  try {
    const { rows } = await sql<{
      pais: string | null;
      numero: string | null;
    }>`select * from nif_regua(${cliente.nif_escrito}, ${cliente.pais_contribuinte}, ${paisEntidade === "PT"})`.execute(
      trx,
    );
    await sql`release savepoint nif_regua`.execute(trx);
    const r = rows[0] as
      { pais: string | null; numero: string | null } | undefined;
    return r === undefined ||
      r.numero !== cliente.nif_numero ||
      r.pais !== cliente.pais_contribuinte
      ? "nif_recusado"
      : null;
  } catch (erro) {
    await sql`rollback to savepoint nif_regua`.execute(trx);
    if (erro instanceof Error && erro.message.startsWith("customers.nif_")) {
      return "nif_recusado";
    }
    throw erro;
  }
}

/**
 * A parte das verificações que só olha para o conteúdo e para a ligação
 * (moeda, decisões de IVA das linhas, mapas, totais): sem a base, para se
 * provar ramo a ramo.
 */
export function motivosDoConteudo(
  conteudo: Conteudo,
  ligacao: { taxas: TaxaDoEmissor[]; isencoes: IsencaoDoEmissor[] } | null,
  modo: string,
): MotivoRetencao[] {
  const motivos = new Set<MotivoRetencao>();
  if (!MOEDAS_SUPORTADAS.includes(conteudo.moeda)) {
    motivos.add("moeda_nao_suportada");
  }
  for (const l of conteudo.linhas) {
    if (l.resultado === "bloqueada") {
      motivos.add("territorio_por_decidir");
      continue;
    }
    if (l.resultado === "isenta") {
      const semProva =
        l.codigo_motivo === null ||
        (l.regra === "vies_intracomunitaria" && l.vies_prova === null) ||
        (l.regra === "isencao_manual" && l.isencao === null);
      if (semProva) motivos.add("isencao_sem_prova");
      if (
        l.codigo_motivo !== null &&
        ligacao !== null &&
        !ligacao.isencoes.some((i) => i.codigo === l.codigo_motivo)
      ) {
        motivos.add("isencao_sem_mapa");
      }
    } else if (
      ligacao !== null &&
      !ligacao.taxas.some((t) => t.pais === l.pais_imposto && t.taxa === l.taxa)
    ) {
      motivos.add("taxa_sem_mapa");
    }
    // Em modo real, uma taxa por verificar retém (Q3); em teste sai marcada.
    if (modo !== "teste" && !l.verificado) {
      motivos.add("taxa_por_verificar");
    }
  }
  const soma = conteudo.linhas.reduce(
    (s, l) => ({
      base: s.base + l.base,
      iva: s.iva + l.iva,
      total: s.total + l.total,
    }),
    { base: 0, iva: 0, total: 0 },
  );
  if (
    soma.base !== conteudo.totais.base ||
    soma.iva !== conteudo.totais.iva ||
    soma.total !== conteudo.totais.total
  ) {
    motivos.add("totais_nao_batem");
  }
  return [...motivos];
}

/** Os motivos de retenção de um conteúdo (R3), sem os já validados (R9). */
async function verificar(
  trx: Transaction<BaseDados>,
  c: string,
  doc: {
    id: string;
    encomenda_id: string;
    entidade_legal_id: string;
    modo: string;
    validados: string[];
    tipo: "fatura" | "nota_credito";
    original_id: string | null;
  },
  conteudo: Conteudo,
  ligacao: {
    estado: string;
    activa: boolean;
    taxas: TaxaDoEmissor[];
    isencoes: IsencaoDoEmissor[];
  } | null,
  original: Contexto["original"] = null,
): Promise<MotivoRetencao[]> {
  const motivos = new Set<MotivoRetencao>();
  const e = await trx
    .selectFrom("encomenda")
    .select(["emissor_fiscal", "cliente_id", "perfil_id"])
    .where("id", "=", doc.encomenda_id)
    .executeTakeFirstOrThrow();
  if (e.emissor_fiscal === "por_configurar") {
    // Uma encomenda paga antes de se escolher quem emite: se a entidade já
    // emite pelo Eurolify, este pedido segue, com o rasto a dizê-lo (revisão
    // do #312, P2-1). Se escolheu o sistema próprio, fica retido.
    const entidade = await trx
      .selectFrom("entidade_legal")
      .select("emissor_fiscal")
      .where("id", "=", doc.entidade_legal_id)
      .executeTakeFirstOrThrow();
    if (entidade.emissor_fiscal === "eurolify") {
      await rasto(
        trx,
        c,
        doc.id,
        "emissor_decidido",
        "a encomenda foi paga antes de se escolher quem emite; a entidade emite pelo Eurolify",
        QUEM_DA_TAREFA,
      );
    } else {
      motivos.add("emissor_por_configurar");
    }
  } else if (e.emissor_fiscal !== "eurolify") {
    motivos.add("emissor_por_configurar");
  }
  if (ligacao === null || ligacao.estado !== "pronta" || !ligacao.activa) {
    motivos.add("ligacao_sem_teste");
  }
  const nif = await nifRecusado(
    trx,
    conteudo.cliente,
    conteudo.entidade_legal.pais,
  );
  if (nif !== null) motivos.add(nif);
  const perfil = await trx
    .selectFrom("perfil_faturacao")
    .select("cliente_id")
    .where("id", "=", e.perfil_id)
    .executeTakeFirst();
  if (perfil?.cliente_id !== e.cliente_id) motivos.add("perfil_de_outra_ficha");
  for (const m of motivosDoConteudo(conteudo, ligacao, doc.modo)) {
    motivos.add(m);
  }
  if (doc.tipo === "nota_credito") {
    // A NC espera pela fatura emitida e não passa o saldo dela (docs/30
    // §3.5; lição 2.13).
    // Contra uma fatura divergente não: a NC copia o nosso pedido, e a prova
    // é o documento que lá está; espera que uma pessoa a resolva (revisão
    // do #329, P1-3).
    if (
      original === null ||
      !["emitido", "resolvido"].includes(original.estado)
    ) {
      motivos.add("original_por_emitir");
    } else if (original.total !== null && doc.original_id !== null) {
      const { rows } = await sql<{ creditado: string | null }>`
        select sum((p.totais->>'total')::bigint) as creditado
        from documento_fiscal d join documento_prova p on p.documento_id = d.id
        where d.original_id = ${doc.original_id}::uuid and d.id <> ${doc.id}::uuid
          and d.estado in ('emitido', 'divergente', 'resolvido')`.execute(trx);
      const creditado = Number(rows[0]?.creditado ?? 0);
      if (creditado + conteudo.totais.total > original.total) {
        motivos.add("credito_acima_do_saldo");
      }
    }
    const { rows: rr } = await sql<{ estado: string }>`
      select r.estado from documento_fiscal d join reembolso r on r.id = d.reembolso_id
      where d.id = ${doc.id}::uuid`.execute(trx);
    const estadoReembolso = rr[0]?.estado;
    if (estadoReembolso === "cancelado") motivos.add("reembolso_cancelado");
    else if (estadoReembolso !== "executado") {
      motivos.add("reembolso_por_executar");
    }
  } else {
    // Reembolsada por inteiro antes de a fatura sair: espera pelo
    // contabilista (docs/30, C2).
    const { rows } = await sql<{ reembolsado: string | null; total: string }>`
      select (select sum(r.montante) from reembolso r
              where r.encomenda_id = e.id
                and r.estado in ('a_executar', 'executado', 'incerto')) as reembolsado,
             e.total
      from encomenda e where e.id = ${doc.encomenda_id}::uuid`.execute(trx);
    const r = rows[0];
    if (r !== undefined && Number(r.reembolsado ?? 0) >= Number(r.total)) {
      motivos.add("encomenda_reembolsada");
    }
  }
  return [...motivos].filter((m) => !doc.validados.includes(m));
}

// ------------------------------------------------- Comparar com o emissor

export interface Divergencia {
  campo: string;
  esperado: unknown;
  obtido: unknown;
}

/** O que o emissor tem contra o que pedimos, campo a campo (R6, R7). */
export function comparar(
  c: Conteudo,
  d: DocumentoNoEmissor,
  referencia: string,
  /** A série da ligação (R6), quando se sabe. */
  serie?: string | null,
): Divergencia[] {
  const r: Divergencia[] = [];
  const dif = (campo: string, esperado: unknown, obtido: unknown) => {
    if (esperado !== obtido) r.push({ campo, esperado, obtido });
  };
  dif("referencia", referencia, d.referencia);
  dif(
    "nif",
    c.cliente.nif_numero,
    nifSoNumero(d.nif, c.cliente.pais_contribuinte),
  );
  // O país e o nome também (revisão do #312, P2-8).
  dif("pais", c.cliente.pais_contribuinte, d.pais);
  dif("nome", c.cliente.nome, d.nome);
  if (serie !== undefined && serie !== null) dif("serie", serie, d.serie);
  dif("linhas", c.linhas.length, d.linhas.length);
  c.linhas.forEach((l, i) => {
    const o = d.linhas[i];
    if (o === undefined) return;
    dif(`linhas[${String(i)}].quantidade`, l.quantidade, o.quantidade);
    dif(`linhas[${String(i)}].base`, l.base, o.base);
    dif(`linhas[${String(i)}].taxa`, l.taxa, o.taxa);
    dif(`linhas[${String(i)}].codigo_motivo`, l.codigo_motivo, o.codigo_motivo);
    dif(`linhas[${String(i)}].iva`, l.iva, o.iva);
  });
  dif("totais.base", c.totais.base, d.totais.base);
  dif("totais.iva", c.totais.iva, d.totais.iva);
  dif("totais.total", c.totais.total, d.totais.total);
  return r;
}

function pedidoDoConteudo(
  c: Conteudo,
  referencia: string,
  ligacao: {
    serie: string | null;
    taxas: TaxaDoEmissor[];
    isencoes: IsencaoDoEmissor[];
  },
  entidadeId: string | null,
  original: Contexto["original"] = null,
): PedidoRascunho {
  return {
    tipo: c.tipo ?? "fatura",
    original:
      original === null || original.numero === null
        ? null
        : { numero: original.numero, emissor_id: original.emissor_id },
    referencia,
    serie: ligacao.serie,
    entidade_id: entidadeId,
    cliente: {
      nome: c.cliente.nome,
      nif: c.cliente.nif,
      pais: c.cliente.pais_contribuinte,
      morada: c.cliente.morada,
    },
    moeda: c.moeda,
    linhas: c.linhas.map((l) => ({
      descricao: l.descricao,
      quantidade: l.quantidade,
      base: l.base,
      iva: l.iva,
      total: l.total,
      taxa: l.taxa,
      codigo_motivo: l.codigo_motivo,
      taxa_emissor:
        l.resultado === "tributada"
          ? (ligacao.taxas.find(
              (t) => t.pais === l.pais_imposto && t.taxa === l.taxa,
            )?.emissor ?? null)
          : null,
      isencao_emissor:
        l.resultado === "isenta"
          ? (ligacao.isencoes.find((i) => i.codigo === l.codigo_motivo)
              ?.emissor ?? null)
          : null,
    })),
    totais: c.totais,
    observacoes: c.carimbo,
    meio_pagamento: c.meio_pagamento,
  };
}

// ---------------------------------------------- A máquina de estados (§4)

export const referenciaDe = (id: string) => `inv_${id}`;

/** Voltas seguidas com o passo a falhar até ir para uma pessoa (P1-2). */
const FALHAS_ATE_PESSOA = 5;
/** «Nunca mais sozinho»: só uma pessoa o volta a pôr na fila. */
const NUNCA = new Date("9999-12-31T00:00:00Z");

interface Contexto {
  doc: {
    id: string;
    encomenda_id: string;
    entidade_legal_id: string;
    estado: EstadoDocumento;
    modo: string;
    motivos: string[];
    validados: string[];
    emissor_id: string | null;
    tentativas: number;
    falhas: number;
    reservado_ate: Date | null;
    versao: number;
    tipo: "fatura" | "nota_credito";
    original_id: string | null;
    reembolso_id: string | null;
  };
  conteudo: Conteudo;
  /** A fatura de uma nota de crédito, como saiu (número e id no emissor). */
  original: {
    estado: EstadoDocumento;
    numero: string | null;
    emissor_id: string | null;
    total: number | null;
  } | null;
  ligacao: {
    id: string;
    adaptador: string;
    estado: string;
    activa: boolean;
    serie: string | null;
    taxas: TaxaDoEmissor[];
    isencoes: IsencaoDoEmissor[];
    credenciais: Buffer | null;
    credenciais_versao_chave: string | null;
  } | null;
}

async function lerContexto(
  trx: Transaction<BaseDados>,
  id: string,
  bloquear: boolean,
): Promise<Contexto> {
  let q = trx
    .selectFrom("documento_fiscal")
    .select([
      "id",
      "encomenda_id",
      "entidade_legal_id",
      "estado",
      "modo",
      "motivos",
      "validados",
      "emissor_id",
      "tentativas",
      "falhas",
      "reservado_ate",
      "versao",
      "ligacao_id",
      "tipo",
      "original_id",
      "reembolso_id",
    ])
    .where("id", "=", id);
  if (bloquear) q = q.forUpdate();
  const doc = await q.executeTakeFirst();
  if (doc === undefined) {
    throw new ErroDocumentos("invoices.not_found", "este documento não existe");
  }
  let ultimo = await ultimoConteudo(trx, id);
  if (ultimo === undefined) {
    // A primeira versão do conteúdo nasce da encomenda (R2), ou, numa nota
    // de crédito, do reembolso e da fatura (docs/30 §3.5).
    const c =
      doc.tipo === "nota_credito" &&
      doc.original_id !== null &&
      doc.reembolso_id !== null
        ? await montarNotaCredito(trx, doc.original_id, doc.reembolso_id)
        : await montarConteudo(trx, doc.encomenda_id);
    await trx
      .insertInto("documento_conteudo")
      .values({
        documento_id: id,
        comerciante_id: sql<string>`comerciante_actual()`,
        versao: 1,
        conteudo: JSON.stringify(c),
        impressao: impressaoDe(c),
        motivo:
          doc.tipo === "nota_credito"
            ? "as linhas do reembolso com o tratamento da fatura"
            : "a cópia da encomenda no botão final",
        quem: QUEM_DA_TAREFA,
      })
      .execute();
    ultimo = { versao: 1, conteudo: c, impressao: impressaoDe(c) };
  }
  const original =
    doc.original_id === null
      ? null
      : await trx
          .selectFrom("documento_fiscal")
          .leftJoin(
            "documento_prova",
            "documento_prova.documento_id",
            "documento_fiscal.id",
          )
          .select([
            "documento_fiscal.estado",
            "documento_fiscal.emissor_id",
            "documento_prova.numero",
            "documento_prova.totais",
            "documento_fiscal.ligacao_id",
          ])
          .where("documento_fiscal.id", "=", doc.original_id)
          // A fatura não muda enquanto a NC se verifica: sem isto, a fatura
          // que sai ao mesmo tempo não acordava a NC (revisão do #329, P2-4).
          .forShare("documento_fiscal")
          .executeTakeFirst();
  // A NC sai pela ligação da fatura, nunca pela que estiver activa agora
  // (outro emissor não tem aquela fatura; revisão do #329, P1-2).
  const ligacaoId =
    doc.ligacao_id ??
    (doc.tipo === "nota_credito" ? (original?.ligacao_id ?? null) : null);
  const lig =
    ligacaoId !== null
      ? trx.selectFrom("ligacao_faturacao").where("id", "=", ligacaoId)
      : doc.tipo === "nota_credito"
        ? trx.selectFrom("ligacao_faturacao").where(sql<boolean>`false`)
        : trx
            .selectFrom("ligacao_faturacao")
            .where("entidade_legal_id", "=", doc.entidade_legal_id)
            .where("activa", "=", true);
  const ligacao = await lig
    .select([
      "id",
      "adaptador",
      "estado",
      "activa",
      "serie",
      "taxas",
      "isencoes",
      "credenciais",
      "credenciais_versao_chave",
    ])
    .executeTakeFirst();
  return {
    doc,
    conteudo: ultimo.conteudo as Conteudo,
    ligacao: ligacao ?? null,
    original:
      original === undefined || original === null
        ? null
        : {
            estado: original.estado,
            numero: original.numero,
            emissor_id: original.emissor_id,
            total:
              original.totais === null
                ? null
                : (original.totais as { total: number }).total,
          },
  };
}

/**
 * As NC retidas por um motivo que deixou de valer (a fatura saiu ou foi
 * resolvida; o reembolso foi executado ou anulado) voltam a verificar-se.
 */
export async function acordarNotas(
  trx: Transaction<BaseDados>,
  de: { original: string } | { reembolso: string },
  motivo: MotivoRetencao,
) {
  const filtro =
    "original" in de
      ? sql`original_id = ${de.original}::uuid`
      : sql`reembolso_id = ${de.reembolso}::uuid`;
  await sql`update documento_fiscal
    set estado = 'a_verificar', versao = versao + 1, proxima_em = now()
    where ${filtro} and tipo = 'nota_credito' and estado = 'retido'
      and ${motivo} = any(motivos)`.execute(trx);
}

const OCUPADO = () =>
  new ErroDocumentos(
    "invoices.version_conflict",
    "o documento mudou (outra volta da tarefa ou uma pessoa)",
  );

/**
 * Relê o documento e exige a mesma versão e o mesmo estado (compare-and-set;
 * revisão do #312, P1-3): quem perdeu a corrida pára.
 */
async function continuar(
  trx: Transaction<BaseDados>,
  ctx: Contexto,
): Promise<Contexto> {
  const agora = await lerContexto(trx, ctx.doc.id, true);
  if (
    agora.doc.versao !== ctx.doc.versao ||
    agora.doc.estado !== ctx.doc.estado
  ) {
    throw OCUPADO();
  }
  return agora;
}

async function mudarEstado(
  trx: Transaction<BaseDados>,
  ctx: Contexto,
  estado: EstadoDocumento,
  extra: {
    motivos?: string[];
    emissor_id?: string | null;
    ligacao_id?: string | null;
    tentativas?: number;
    proxima_em?: Date;
    validados?: string[];
  } = {},
) {
  const r = await trx
    .updateTable("documento_fiscal")
    .set({
      estado,
      versao: ctx.doc.versao + 1,
      falhas: 0,
      reservado_ate: null,
      // Por omissão, o passo seguinte pode correr já (revisão do #312, P2-2).
      proxima_em: new Date(),
      ...extra,
    })
    .where("id", "=", ctx.doc.id)
    .where("versao", "=", ctx.doc.versao)
    .executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw OCUPADO();
  ctx.doc.versao += 1;
  ctx.doc.estado = estado;
  if (extra.tentativas !== undefined) ctx.doc.tentativas = extra.tentativas;
  if (extra.emissor_id !== undefined) ctx.doc.emissor_id = extra.emissor_id;
}

/**
 * Reserva o documento antes de chamar o emissor (P1-3): a versão sobe e a
 * próxima tentativa passa para daqui a 5 minutos, por isso nenhuma outra volta
 * nem nenhuma pessoa lhe pega a meio.
 */
async function reservar(
  db: Kysely<BaseDados>,
  c: string,
  ctx: Contexto,
  extra: { tentativas?: number } = {},
) {
  const ate = new Date(Date.now() + 5 * 60_000);
  await noDocumentos(db, c, async (trx) => {
    const r = await trx
      .updateTable("documento_fiscal")
      .set({
        proxima_em: ate,
        reservado_ate: ate,
        versao: ctx.doc.versao + 1,
        ...extra,
      })
      .where("id", "=", ctx.doc.id)
      .where("versao", "=", ctx.doc.versao)
      .where("estado", "=", ctx.doc.estado)
      .where((eb) =>
        eb.or([
          eb("reservado_ate", "is", null),
          eb("reservado_ate", "<", new Date()),
          eb("reservado_ate", "=", ctx.doc.reservado_ate),
        ]),
      )
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw OCUPADO();
  });
  ctx.doc.versao += 1;
  ctx.doc.reservado_ate = ate;
  if (extra.tentativas !== undefined) ctx.doc.tentativas = extra.tentativas;
}

/** Reservado por outra volta, ainda dentro do prazo. */
const reservadoPorOutro = (ctx: Contexto) =>
  ctx.doc.reservado_ate !== null &&
  ctx.doc.reservado_ate.getTime() > Date.now();

async function paraRetido(
  db: Kysely<BaseDados>,
  c: string,
  ctx: Contexto,
  motivos: string[],
  porque: string,
  extra: { emissor_id?: null } = {},
) {
  await noDocumentos(db, c, async (trx) => {
    await marcar(trx, QUEM_DA_TAREFA, porque);
    const agora = await continuar(trx, ctx);
    await mudarEstado(trx, agora, "retido", { motivos, ...extra });
    ctx.doc = agora.doc;
  });
  return "retido";
}

async function paraIncerto(
  db: Kysely<BaseDados>,
  c: string,
  ctx: Contexto,
  porque: string,
) {
  await noDocumentos(db, c, async (trx) => {
    await marcar(trx, QUEM_DA_TAREFA, porque);
    const agora = await continuar(trx, ctx);
    // A reconciliação espera um minuto: o emissor pode ainda estar a
    // acabar o que lhe pedimos (§4.2).
    await mudarEstado(trx, agora, "incerto", {
      tentativas: 0,
      proxima_em: new Date(Date.now() + 60_000),
    });
    ctx.doc = agora.doc;
  });
  return "incerto";
}

/** Grava a prova (lida de volta) e o estado final: emitido ou divergente. */
async function gravarProva(
  db: Kysely<BaseDados>,
  c: string,
  ctx: Contexto,
  d: DocumentoNoEmissor,
  pdf: Buffer | null,
  quem: string,
) {
  // Um documento sem número, ou ainda não fechado, não é prova (P1-1).
  if (d.estado !== "fechado" || d.numero === null || d.numero === "") {
    return paraIncerto(
      db,
      c,
      ctx,
      "o emissor devolveu um documento sem número",
    );
  }
  const divergencias = comparar(
    ctx.conteudo,
    d,
    referenciaDe(ctx.doc.id),
    ctx.ligacao?.serie,
  );
  await noDocumentos(db, c, async (trx) => {
    await marcar(trx, quem);
    const agora = await continuar(trx, ctx);
    await trx
      .insertInto("documento_prova")
      .values({
        documento_id: ctx.doc.id,
        comerciante_id: c,
        numero: d.numero as string,
        serie: d.serie,
        data: d.data,
        atcud: d.atcud,
        nif: d.nif,
        nome: d.nome,
        pais: d.pais,
        linhas: JSON.stringify(d.linhas),
        totais: JSON.stringify(d.totais),
        pdf,
        em_bruto: JSON.stringify(d.em_bruto ?? null),
        divergencias: JSON.stringify(divergencias),
      })
      .execute();
    await mudarEstado(trx, agora, "emitido", { emissor_id: d.id });
    if (divergencias.length > 0) {
      await marcar(trx, quem, "a prova não bate com o pedido (R7)");
      await mudarEstado(trx, agora, "divergente");
    }
    // O perfil fica usado num documento (R12) quando o NIF que saiu é o dele.
    const e = await trx
      .selectFrom("encomenda")
      .innerJoin(
        "perfil_faturacao",
        "perfil_faturacao.id",
        "encomenda.perfil_id",
      )
      .select(["perfil_faturacao.id", "perfil_faturacao.nif_numero"])
      .where("encomenda.id", "=", ctx.doc.encomenda_id)
      .executeTakeFirst();
    if (e !== undefined && e.nif_numero === ctx.conteudo.cliente.nif_numero) {
      await sql`select perfil_marcar_usado(${e.id}::uuid)`.execute(trx);
    }
    // A fatura saiu: as NC que esperavam por ela voltam a verificar-se.
    if (ctx.doc.tipo === "fatura") {
      await acordarNotas(trx, { original: ctx.doc.id }, "original_por_emitir");
    }
    ctx.doc = agora.doc;
  });
  return divergencias.length > 0 ? "divergente" : "emitido";
}

async function pdfOuNulo(
  a: AdaptadorFaturacao,
  cred: CredenciaisEmissor,
  id: string,
) {
  try {
    return await a.pdf(cred, id);
  } catch (e) {
    if (e instanceof ErroDeRede || e instanceof ErroDoEmissor) return null;
    throw e;
  }
}

/** Confere o rascunho, fecha-o e grava a prova (R6, R7). */
async function fecharEProvar(
  db: Kysely<BaseDados>,
  c: string,
  ctx: Contexto,
  a: AdaptadorFaturacao,
  cred: CredenciaisEmissor,
) {
  const emissorId = ctx.doc.emissor_id as string;
  const rascunho = await a.lerDocumento(cred, emissorId);
  // Fechado por uma tentativa anterior que não chegou a gravar a prova
  // (P1-1): não se fecha outra vez, prova-se.
  if (rascunho.estado === "fechado") {
    return gravarProva(
      db,
      c,
      ctx,
      rascunho,
      await pdfOuNulo(a, cred, emissorId),
      QUEM_DA_TAREFA,
    );
  }
  const diferencas = comparar(
    ctx.conteudo,
    rascunho,
    referenciaDe(ctx.doc.id),
    ctx.ligacao?.serie,
  );
  if (diferencas.length > 0) {
    await a.apagarRascunho(cred, emissorId);
    const motivo: MotivoRetencao = diferencas.some((x) => x.campo === "nif")
      ? "entidade_do_emissor_diferente"
      : "totais_nao_batem";
    await paraRetido(db, c, ctx, [motivo], "o rascunho não bate com o pedido", {
      emissor_id: null,
    });
    await noDocumentos(db, c, (trx) =>
      rasto(trx, c, ctx.doc.id, "rascunho_apagado", "R6", QUEM_DA_TAREFA, {
        emissor_id: emissorId,
        diferencas,
      }),
    );
    return "retido";
  }
  await reservar(db, c, ctx, { tentativas: ctx.doc.tentativas + 1 });
  let fechado: DocumentoNoEmissor;
  try {
    fechado = await a.fechar(cred, emissorId);
  } catch (e) {
    // Sem resposta: pode ter fechado. Reconcilia-se, nunca se repete.
    if (e instanceof ErroDeRede) {
      return paraIncerto(db, c, ctx, "o emissor não respondeu ao fechar");
    }
    // Recusado: fica em rascunho; as falhas seguidas levam-no a uma pessoa
    // (P1-2).
    throw e;
  }
  return gravarProva(
    db,
    c,
    ctx,
    fechado,
    await pdfOuNulo(a, cred, emissorId),
    QUEM_DA_TAREFA,
  );
}

function credenciaisDaLigacao(ctx: Contexto, cfg: ConfigFaturacao | undefined) {
  const l = ctx.ligacao;
  // Uma ligação desligada não emite, nem para um pronto (revisão do #312, P2-6).
  if (l === null || l.estado !== "pronta" || !l.activa) return null;
  const cred = credenciaisDe(l, cfg);
  if (cred === null) return null;
  return { a: adaptadorDe(cfg, l.adaptador), cred };
}

/**
 * Um passo de um documento (a tarefa chama-o até ele parar): verifica, cria
 * o rascunho, confere e fecha, ou reconcilia. Devolve o estado em que ficou.
 */
export async function processarDocumento(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigFaturacao | undefined,
): Promise<string> {
  const ctx = await noDocumentos(db, c, async (trx) => {
    await marcar(trx, QUEM_DA_TAREFA);
    return lerContexto(trx, id, true);
  });
  // Outra volta reservou-o e está a falar com o emissor (P1-3).
  if (reservadoPorOutro(ctx)) throw OCUPADO();
  switch (ctx.doc.estado) {
    case "a_verificar": {
      return noDocumentos(db, c, async (trx) => {
        await marcar(trx, QUEM_DA_TAREFA, "as verificações antes de emitir");
        const agora = await continuar(trx, ctx);
        const motivos = await verificar(
          trx,
          c,
          agora.doc,
          agora.conteudo,
          agora.ligacao,
          agora.original,
        );
        if (motivos.length > 0) {
          await mudarEstado(trx, agora, "retido", { motivos });
          return "retido";
        }
        await mudarEstado(trx, agora, "pronto", {
          ligacao_id: agora.ligacao?.id ?? null,
          tentativas: 0,
        });
        return "pronto";
      });
    }
    case "pronto": {
      const ligado = credenciaisDaLigacao(ctx, cfg);
      if (ligado === null) {
        return paraRetido(
          db,
          c,
          ctx,
          ["ligacao_sem_teste"],
          "a ligação deixou de estar pronta ou foi desligada",
        );
      }
      // Os mapas podem ter mudado depois de verificado (P2-6).
      const doConteudo = motivosDoConteudo(
        ctx.conteudo,
        ctx.ligacao,
        ctx.doc.modo,
      ).filter((m) => !ctx.doc.validados.includes(m));
      if (doConteudo.length > 0) {
        return paraRetido(
          db,
          c,
          ctx,
          doConteudo,
          "os mapas da ligação mudaram",
        );
      }
      const { a, cred } = ligado;
      const referencia = referenciaDe(id);
      await reservar(db, c, ctx, { tentativas: ctx.doc.tentativas + 1 });
      // Sempre pela referência antes de criar (P2-9): uma tentativa anterior
      // pode ter deixado o rascunho no emissor.
      const p = await a.procurarPorReferencia(cred, referencia);
      if (p.estado === "nao_sei") {
        return paraIncerto(db, c, ctx, "o emissor não diz se já o tem");
      }
      if (p.estado === "encontrado") {
        return adoptar(db, c, ctx, p.documento, a, cred);
      }
      // R5: a entidade procura-se pelo número e confere-se o NIF dela.
      let entidadeId: string | null = null;
      const numero = ctx.conteudo.cliente.nif_numero;
      if (numero !== null) {
        const ent = await a.procurarEntidade(cred, numero);
        if (ent !== null) {
          if (
            nifSoNumero(ent.nif, ctx.conteudo.cliente.pais_contribuinte) !==
            numero
          ) {
            return paraRetido(
              db,
              c,
              ctx,
              ["entidade_do_emissor_diferente"],
              "a entidade do emissor tem outro NIF (R5)",
            );
          }
          entidadeId = ent.id;
        }
      }
      let criado: { id: string };
      try {
        criado = await a.criarRascunho(
          cred,
          pedidoDoConteudo(
            ctx.conteudo,
            referencia,
            ctx.ligacao as NonNullable<Contexto["ligacao"]>,
            entidadeId,
            ctx.original,
          ),
        );
      } catch (e) {
        if (e instanceof ErroDeRede) {
          return paraIncerto(db, c, ctx, "o emissor não respondeu ao rascunho");
        }
        // Recusado: nada ficou feito; as falhas seguidas levam-no a uma
        // pessoa (P1-2).
        throw e;
      }
      await noDocumentos(db, c, async (trx) => {
        await marcar(trx, QUEM_DA_TAREFA, "rascunho criado no emissor");
        const agora = await continuar(trx, ctx);
        await mudarEstado(trx, agora, "rascunho", {
          emissor_id: criado.id,
          tentativas: 0,
        });
      });
      return "rascunho";
    }
    case "rascunho": {
      const ligado = credenciaisDaLigacao(ctx, cfg);
      if (ligado === null) {
        throw new ErroDocumentos(
          "invoices.issuer_not_ready",
          "a ligação não está pronta para fechar o rascunho",
        );
      }
      await reservar(db, c, ctx);
      return fecharEProvar(db, c, ctx, ligado.a, ligado.cred);
    }
    case "incerto":
      await reservar(db, c, ctx);
      return reconciliarAutomaticamente(db, c, ctx, cfg);
    default:
      return ctx.doc.estado;
  }
}

/** O documento encontrado no emissor pela referência: segue de onde está. */
async function adoptar(
  db: Kysely<BaseDados>,
  c: string,
  ctx: Contexto,
  d: DocumentoNoEmissor,
  a: AdaptadorFaturacao,
  cred: CredenciaisEmissor,
  quem = QUEM_DA_TAREFA,
) {
  if (d.estado === "fechado") {
    if (ctx.doc.estado === "pronto") {
      // Um pronto não chega a emitido sem passar por rascunho ou incerto.
      await noDocumentos(db, c, async (trx) => {
        await marcar(
          trx,
          quem,
          "encontrado fechado no emissor pela referência",
        );
        const agora = await continuar(trx, ctx);
        await mudarEstado(trx, agora, "incerto", { emissor_id: d.id });
        ctx.doc = agora.doc;
      });
    }
    return gravarProva(db, c, ctx, d, await pdfOuNulo(a, cred, d.id), quem);
  }
  await noDocumentos(db, c, async (trx) => {
    await marcar(trx, quem, "rascunho encontrado no emissor pela referência");
    const agora = await continuar(trx, ctx);
    await mudarEstado(trx, agora, "rascunho", {
      emissor_id: d.id,
      tentativas: 0,
    });
    ctx.doc = agora.doc;
  });
  return "rascunho";
}

/** §4.2: procura pela referência; nunca repete o pedido. */
async function reconciliarAutomaticamente(
  db: Kysely<BaseDados>,
  c: string,
  ctx: Contexto,
  cfg: ConfigFaturacao | undefined,
) {
  const ligado = credenciaisDaLigacao(ctx, cfg);
  let resultado: "encontrado" | "nao_existe" | "nao_sei" = "nao_sei";
  let documento: DocumentoNoEmissor | null = null;
  if (ligado !== null) {
    try {
      const p = await ligado.a.procurarPorReferencia(
        ligado.cred,
        referenciaDe(ctx.doc.id),
      );
      resultado = p.estado;
      if (p.estado === "encontrado") documento = p.documento;
    } catch (e) {
      if (!(e instanceof ErroDeRede) && !(e instanceof ErroDoEmissor)) throw e;
    }
  }
  if (resultado === "encontrado" && ligado !== null && documento !== null) {
    return adoptar(db, c, ctx, documento, ligado.a, ligado.cred);
  }
  if (resultado === "nao_existe") {
    return noDocumentos(db, c, async (trx) => {
      await marcar(trx, QUEM_DA_TAREFA, "confirmado no emissor que não existe");
      const agora = await continuar(trx, ctx);
      await mudarEstado(trx, agora, "pronto", {
        tentativas: 0,
        emissor_id: null,
      });
      return "pronto";
    });
  }
  // Não se sabe: tenta outra vez mais tarde; ao fim de 3, fica para uma
  // pessoa (§4.2, 4).
  return noDocumentos(db, c, async (trx) => {
    await marcar(trx, QUEM_DA_TAREFA, "o emissor não diz se o tem");
    const agora = await continuar(trx, ctx);
    const tentativas = agora.doc.tentativas + 1;
    const fila = tentativas >= RECONCILIACOES_AUTOMATICAS;
    await mudarEstado(trx, agora, "incerto", {
      tentativas,
      motivos: fila ? ["reconciliacao_manual"] : agora.doc.motivos,
      proxima_em: fila ? NUNCA : new Date(Date.now() + 5 * 60_000),
    });
    return "incerto";
  });
}

/**
 * Um passo que falhou (P1-2): fica no rasto, recua (2, 4, 8… até 60 minutos)
 * para não tapar a fila do comerciante e, ao fim de 5 falhas seguidas, vai
 * para uma pessoa (`incerto` com `reconciliacao_manual`).
 */
async function registarFalha(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  erro: unknown,
) {
  await noDocumentos(db, c, async (trx) => {
    await marcar(trx, QUEM_DA_TAREFA, "o passo falhou");
    const agora = await lerContexto(trx, id, true);
    const falhas = agora.doc.falhas + 1;
    await rasto(
      trx,
      c,
      id,
      "falhou",
      (erro instanceof Error ? erro.message : "erro").slice(0, 500),
      QUEM_DA_TAREFA,
      { falhas, estado: agora.doc.estado },
    );
    if (
      falhas >= FALHAS_ATE_PESSOA &&
      ["pronto", "rascunho", "incerto"].includes(agora.doc.estado)
    ) {
      await mudarEstado(trx, agora, "incerto", {
        motivos: ["reconciliacao_manual"],
        proxima_em: NUNCA,
      });
      return;
    }
    await trx
      .updateTable("documento_fiscal")
      .set({
        falhas,
        reservado_ate: null,
        proxima_em: new Date(Date.now() + Math.min(2 ** falhas, 60) * 60_000),
        versao: agora.doc.versao + 1,
      })
      .where("id", "=", id)
      .execute();
  });
}

// -------------------------------------------------------------- A tarefa

export interface ResultadoDocumentos {
  passos: number;
  erros: { documento: string; erro: string }[];
}

/**
 * Uma volta (R11): cada documento por tratar anda até parar (retido,
 * emitido, incerto…), um a um; a falha de um não pára os outros nem tapa a
 * fila (P1-2).
 */
export async function correrDocumentos(
  db: Kysely<BaseDados>,
  cfg: ConfigFaturacao | undefined,
  porVolta = POR_VOLTA,
): Promise<ResultadoDocumentos> {
  const r: ResultadoDocumentos = { passos: 0, erros: [] };
  const { rows } = await sql<{
    c: string;
  }>`select documentos_comerciantes_com_trabalho() as c`.execute(db);
  for (const { c } of rows) {
    const ids = await noDocumentos(db, c, async (trx) =>
      (
        await sql<{
          id: string;
        }>`select documentos_a_tratar(${porVolta}) as id`.execute(trx)
      ).rows.map((x) => x.id),
    );
    for (const id of ids) {
      try {
        // No máximo 4 passos por volta: verificar, rascunho, fechar, provar.
        for (let i = 0; i < 4; i++) {
          const antes = await noDocumentos(db, c, (trx) =>
            trx
              .selectFrom("documento_fiscal")
              .select(["estado", "proxima_em"])
              .where("id", "=", id)
              .executeTakeFirstOrThrow(),
          );
          if (
            !["a_verificar", "pronto", "rascunho", "incerto"].includes(
              antes.estado,
            ) ||
            antes.proxima_em.getTime() > Date.now()
          ) {
            break;
          }
          const depois = await processarDocumento(db, c, id, cfg);
          r.passos += 1;
          if (depois === antes.estado) break;
        }
      } catch (erro) {
        // Perdeu a corrida para outra volta ou para uma pessoa: não é falha.
        if (
          erro instanceof ErroDocumentos &&
          erro.codigo === "invoices.version_conflict"
        ) {
          continue;
        }
        r.erros.push({
          documento: id,
          erro: erro instanceof Error ? erro.message.slice(0, 200) : "erro",
        });
        try {
          await registarFalha(db, c, id, erro);
        } catch {
          // Fica para a volta seguinte.
        }
      }
    }
  }
  return r;
}

export function agendarDocumentos(
  base: Kysely<BaseDados>,
  cfg: ConfigFaturacao,
  registo: {
    info: (o: object, m: string) => void;
    error: (o: object, m: string) => void;
  },
): () => void {
  let aCorrer = false;
  let ultimaVolta = Date.now();
  const t = setInterval(() => {
    // Uma tarefa parada dá alarme (R11; o prazo proposto: 15 minutos).
    if (Date.now() - ultimaVolta > 15 * 60_000) {
      registo.error(
        {},
        "documentos: a tarefa não completa uma volta há 15 min",
      );
    }
    if (aCorrer) return;
    aCorrer = true;
    correrDocumentos(base, cfg)
      .then((r) => {
        ultimaVolta = Date.now();
        if (r.passos > 0 || r.erros.length > 0) {
          registo.info(
            { passos: r.passos, erros: r.erros.length },
            "documentos: volta",
          );
        }
      })
      .catch((erro: unknown) => {
        registo.error(
          { erro: erro instanceof Error ? erro.name : "erro" },
          "documentos: a volta falhou",
        );
      })
      .finally(() => {
        aCorrer = false;
      });
  }, 60_000);
  t.unref();
  return () => {
    clearInterval(t);
  };
}

// ----------------------------------------------- As decisões de uma pessoa

async function paraDecidir(
  trx: Transaction<BaseDados>,
  id: string,
  versao: number,
  estados: EstadoDocumento[],
) {
  const ctx = await lerContexto(trx, id, true);
  if (ctx.doc.versao !== versao) {
    throw new ErroDocumentos("invoices.version_conflict", "o documento mudou", {
      versao: ctx.doc.versao,
    });
  }
  if (!estados.includes(ctx.doc.estado)) {
    throw new ErroDocumentos(
      "invoices.invalid_transition",
      `o documento está ${ctx.doc.estado}`,
    );
  }
  // A tarefa está a falar com o emissor sobre este documento (P1-3).
  if (reservadoPorOutro(ctx)) {
    throw new ErroDocumentos(
      "invoices.retry",
      "a tarefa está a tratar este documento no emissor; tente daqui a uns minutos",
    );
  }
  return ctx;
}

async function rasto(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  passo: string,
  motivo: string,
  quem: string,
  dados: object = {},
) {
  await trx
    .insertInto("documento_rasto")
    .values({
      documento_id: id,
      comerciante_id: c,
      passo,
      motivo,
      quem,
      dados: JSON.stringify(dados),
    })
    .execute();
}

/** R9: um motivo de cada vez, com motivo; vale como validação dele. */
export async function libertar(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  dados: { versao: number; motivo_retencao: string; motivo: string },
  quem: string,
) {
  return noDocumentos(trx, c, async () => {
    await marcar(trx, quem, dados.motivo);
    const ctx = await paraDecidir(trx, id, dados.versao, ["retido"]);
    if (!ctx.doc.motivos.includes(dados.motivo_retencao)) {
      throw new ErroDocumentos(
        "invoices.invalid_field",
        `o documento não está retido por ${dados.motivo_retencao}`,
      );
    }
    if (!(LIBERTAVEIS as readonly string[]).includes(dados.motivo_retencao)) {
      throw new ErroDocumentos(
        "invoices.invalid_field",
        `${dados.motivo_retencao} não se liberta: resolve-se na configuração ou corrigindo, e verifica-se outra vez`,
      );
    }
    await rasto(trx, c, id, "libertado", dados.motivo, quem, {
      motivo_retencao: dados.motivo_retencao,
    });
    await mudarEstado(trx, ctx, "a_verificar", {
      validados: [...ctx.doc.validados, dados.motivo_retencao],
      proxima_em: new Date(),
    });
    return ctx.doc.versao;
  });
}

/** Verificar outra vez (depois de mudar a configuração). */
export async function reverificar(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  versao: number,
  quem: string,
) {
  return noDocumentos(trx, c, async () => {
    await marcar(trx, quem, "verificar outra vez");
    const ctx = await paraDecidir(trx, id, versao, ["retido"]);
    await mudarEstado(trx, ctx, "a_verificar", { proxima_em: new Date() });
    return ctx.doc.versao;
  });
}

/**
 * Q4: antes de emitir, só o NIF, o nome do documento e a morada fiscal, numa
 * versão nova do conteúdo, com motivo; nunca taxas, isenções nem montantes.
 */
export async function corrigir(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  dados: {
    versao: number;
    motivo: string;
    nif?: string;
    nome_documento?: string;
    morada?: Record<string, string | null>;
  },
  quem: string,
) {
  return noDocumentos(trx, c, async () => {
    await marcar(trx, quem, dados.motivo);
    const ctx = await paraDecidir(trx, id, dados.versao, ["retido"]);
    const novo: Conteudo = structuredClone(ctx.conteudo);
    if (dados.nif !== undefined) {
      let regua: { pais: string | null; numero: string | null } | undefined;
      try {
        await sql`savepoint corrigir_nif`.execute(trx);
        regua = (
          await sql<{
            pais: string | null;
            numero: string | null;
          }>`select * from nif_regua(${dados.nif}, ${ctx.conteudo.cliente.pais_contribuinte}, ${ctx.conteudo.entidade_legal.pais === "PT"})`.execute(
            trx,
          )
        ).rows[0];
        await sql`release savepoint corrigir_nif`.execute(trx);
      } catch (erro) {
        await sql`rollback to savepoint corrigir_nif`.execute(trx);
        if (
          erro instanceof Error &&
          erro.message.startsWith("customers.nif_")
        ) {
          throw new ErroDocumentos("invoices.invalid_field", erro.message);
        }
        throw erro;
      }
      const pais = regua?.pais ?? null;
      const numero = regua?.numero ?? null;
      // Nunca «consumidor final» a quem deu NIF (R4, Q4; P1-5).
      if (ehConsumidorFinal(pais, numero)) {
        throw new ErroDocumentos(
          "invoices.invalid_field",
          "esse NIF é o de consumidor final: o documento não sai assim",
        );
      }
      // O país do contribuinte não muda por correcção: a decisão de IVA foi
      // tomada com ele (R2; revisão do #312, P2-5). Sem NIF antes, só o do
      // país da entidade (uma venda nacional).
      const antes = ctx.conteudo.cliente.pais_contribuinte;
      if (
        antes === null
          ? pais !== ctx.conteudo.entidade_legal.pais
          : pais !== antes
      ) {
        throw new ErroDocumentos(
          "invoices.invalid_field",
          "a correcção não muda o país do contribuinte: a decisão de IVA foi tomada com ele",
        );
      }
      novo.cliente.nif_escrito = dados.nif;
      novo.cliente.nif_numero = numero;
      novo.cliente.pais_contribuinte = pais;
      novo.cliente.nif =
        numero === null
          ? null
          : pais === null || pais === novo.entidade_legal.pais
            ? numero
            : `${prefixoFiscal(pais)}${numero}`;
    }
    if (dados.nome_documento !== undefined) {
      novo.cliente.nome = dados.nome_documento;
    }
    if (dados.morada !== undefined) novo.cliente.morada = dados.morada;
    const ultimo = await ultimoConteudo(trx, id);
    await trx
      .insertInto("documento_conteudo")
      .values({
        documento_id: id,
        comerciante_id: c,
        versao: (ultimo?.versao ?? 0) + 1,
        conteudo: JSON.stringify(novo),
        impressao: impressaoDe(novo),
        motivo: dados.motivo,
        quem,
      })
      .execute();
    await rasto(trx, c, id, "corrigido", dados.motivo, quem, {
      campos: Object.keys(dados).filter(
        (k) => !["versao", "motivo"].includes(k),
      ),
    });
    // As validações eram do conteúdo antigo: voltam a contar todas (P1-5).
    await mudarEstado(trx, ctx, "a_verificar", { validados: [] });
    return ctx.doc.versao;
  });
}

/**
 * §4.2, 4: uma pessoa olhou para o emissor. «Encontrado» lê o documento de
 * lá (nunca o número escrito à mão); «não existe» volta a pronto.
 */
export async function reconciliar(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: {
    versao: number;
    resultado: "encontrado" | "nao_existe";
    emissor_id?: string;
    motivo: string;
  },
  cfg: ConfigFaturacao | undefined,
  quem: string,
) {
  const ctx = await noDocumentos(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo);
    return paraDecidir(trx, id, dados.versao, ["incerto"]);
  });
  if (dados.resultado === "nao_existe") {
    return noDocumentos(db, c, async (trx) => {
      await marcar(trx, quem, dados.motivo);
      const agora = await paraDecidir(trx, id, dados.versao, ["incerto"]);
      await rasto(trx, c, id, "reconciliado", dados.motivo, quem, {
        resultado: "nao_existe",
      });
      await mudarEstado(trx, agora, "pronto", {
        tentativas: 0,
        emissor_id: null,
      });
      return agora.doc.versao;
    });
  }
  if (dados.emissor_id === undefined) {
    throw new ErroDocumentos(
      "invoices.invalid_field",
      "«encontrado» leva o identificador do documento no emissor",
    );
  }
  const ligado = credenciaisDaLigacao(ctx, cfg);
  if (ligado === null) {
    throw new ErroDocumentos(
      "invoices.issuer_not_ready",
      "a ligação não está pronta para ler o documento",
    );
  }
  // A tarefa não lhe pega enquanto a pessoa decide (P1-3).
  await reservar(db, c, ctx);
  let d: DocumentoNoEmissor;
  try {
    d = await ligado.a.lerDocumento(ligado.cred, dados.emissor_id);
  } catch (e) {
    if (e instanceof ErroDeRede || e instanceof ErroDoEmissor) {
      throw new ErroDocumentos(
        "invoices.issuer_error",
        `o emissor não deu o documento: ${e.message.slice(0, 200)}`,
      );
    }
    throw e;
  }
  if (d.referencia !== referenciaDe(id)) {
    throw new ErroDocumentos(
      "invoices.invalid_field",
      "esse documento do emissor não tem a referência deste pedido",
    );
  }
  await noDocumentos(db, c, async (trx) => {
    await rasto(trx, c, id, "reconciliado", dados.motivo, quem, {
      resultado: "encontrado",
      emissor_id: dados.emissor_id,
    });
  });
  await adoptar(db, c, ctx, d, ligado.a, ligado.cred, quem);
  return ctx.doc.versao;
}

/** Uma divergência vista e decidida (na fatia 11, a nota de crédito). */
export async function resolver(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  dados: { versao: number; motivo: string },
  quem: string,
) {
  return noDocumentos(trx, c, async () => {
    await marcar(trx, quem, dados.motivo);
    const ctx = await paraDecidir(trx, id, dados.versao, ["divergente"]);
    await mudarEstado(trx, ctx, "resolvido");
    // Resolvida a fatura, as NC que esperavam por ela verificam-se outra vez
    // (revisão do #329, P1-3).
    if (ctx.doc.tipo === "fatura") {
      await acordarNotas(trx, { original: ctx.doc.id }, "original_por_emitir");
    }
    return ctx.doc.versao;
  });
}

// ------------------------------------------------------------- Leituras

export async function listarDocumentos(
  db: Kysely<BaseDados>,
  c: string,
  filtro: { estado?: EstadoDocumento; encomenda?: string },
) {
  return noDocumentos(db, c, (trx) => {
    let q = trx
      .selectFrom("documento_fiscal")
      .select([
        "id",
        "encomenda_id",
        "tipo",
        "modo",
        "estado",
        "motivos",
        "versao",
        "criado_em",
        "actualizado_em",
      ])
      .orderBy("id", "desc")
      .limit(200);
    if (filtro.estado !== undefined) q = q.where("estado", "=", filtro.estado);
    if (filtro.encomenda !== undefined) {
      q = q.where("encomenda_id", "=", filtro.encomenda);
    }
    return q.execute();
  });
}

export async function lerDocumento(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noDocumentos(db, c, async (trx) => {
    const d = await trx
      .selectFrom("documento_fiscal")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (d === undefined) {
      throw new ErroDocumentos(
        "invoices.not_found",
        "este documento não existe",
      );
    }
    const conteudos = await trx
      .selectFrom("documento_conteudo")
      .select(["versao", "conteudo", "impressao", "motivo", "quem", "em"])
      .where("documento_id", "=", id)
      .orderBy("versao")
      .execute();
    const prova = await trx
      .selectFrom("documento_prova")
      .select([
        "id",
        "numero",
        "serie",
        "data",
        "atcud",
        "nif",
        "nome",
        "pais",
        "linhas",
        "totais",
        "divergencias",
        "lida_em",
        sql<boolean>`pdf is not null`.as("tem_pdf"),
      ])
      .where("documento_id", "=", id)
      .executeTakeFirst();
    const passos = await trx
      .selectFrom("documento_rasto")
      .select(["passo", "de", "para", "motivo", "quem", "dados", "em"])
      .where("documento_id", "=", id)
      .orderBy("em")
      .orderBy("id")
      .execute();
    // A fatura mostra as NC e o saldo (docs/30 §3.5): faturado − creditado,
    // pelos totais lidos de volta dos documentos.
    const notas =
      d.tipo === "fatura"
        ? await trx
            .selectFrom("documento_fiscal")
            .leftJoin(
              "documento_prova",
              "documento_prova.documento_id",
              "documento_fiscal.id",
            )
            .select([
              "documento_fiscal.id",
              "documento_fiscal.estado",
              "documento_fiscal.reembolso_id",
              "documento_prova.numero",
              "documento_prova.totais",
            ])
            .where("documento_fiscal.original_id", "=", id)
            .orderBy("documento_fiscal.id")
            .execute()
        : [];
    const faturado =
      prova === undefined ? null : (prova.totais as { total: number }).total;
    const creditado = notas
      .filter((n) => ["emitido", "divergente", "resolvido"].includes(n.estado))
      .reduce(
        (t, n) => t + ((n.totais as { total: number } | null)?.total ?? 0),
        0,
      );
    return {
      ...d,
      conteudos,
      prova: prova ?? null,
      rasto: passos,
      notas_credito: notas,
      saldo: faturado === null ? null : faturado - creditado,
    };
  });
}

export async function pdfDoDocumento(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noDocumentos(db, c, async (trx) => {
    const p = await trx
      .selectFrom("documento_prova")
      .select(["pdf", "numero"])
      .where("documento_id", "=", id)
      .executeTakeFirst();
    if (p?.pdf === null || p === undefined) {
      throw new ErroDocumentos(
        "invoices.not_found",
        "este documento não tem PDF",
      );
    }
    return p as { pdf: Buffer; numero: string };
  });
}

/** O documento de uma encomenda (para o GET /orders/{id}). */
export async function documentoDaEncomenda(
  trx: Transaction<BaseDados>,
  encomendaId: string,
) {
  return (
    (await trx
      .selectFrom("documento_fiscal")
      .select(["id", "estado"])
      .where("encomenda_id", "=", encomendaId)
      .executeTakeFirst()) ?? null
  );
}
