import { createHash, randomBytes } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type {
  BaseDados,
  EstadoPagamento,
  MetodoPagamento,
  MotivoDiferenca,
  OrigemTransicao,
} from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import {
  ErroDeRede,
  type AdaptadorPagamento,
  type AvisoNormalizado,
  type ConfigPagamentos,
  type CredenciaisConta,
  type EstadoNoPrestador,
} from "./adaptador.js";
import { cifrar, decifrar, type ChavePagamentos } from "./cifra.js";
import { ErroPagamentos, type CodigoErroPagamentos } from "./erros.js";

// Os pagamentos (docs/26; migração 0044). Um pagamento só se dá por pago com
// prova do prestador (um aviso com assinatura válida ou uma consulta); na
// dúvida fica `incerto` e decide uma pessoa (nunca se cobra outra vez nem se
// dá por falhado às cegas). As chamadas ao prestador correm fora das
// transacções da base: a transacção não fica aberta à espera da rede.

/** Os métodos que cada prestador sabe (o adaptador declara-os também). */
export const METODOS_DO_PRESTADOR: Record<
  "eupago",
  readonly MetodoPagamento[]
> = { eupago: ["mb_way", "multibanco"] };

/** O nome de cada método no checkout: nomes de marca, iguais em todas as línguas. */
export const NOME_DO_METODO: Record<MetodoPagamento, string> = {
  mb_way: "MB WAY",
  multibanco: "Multibanco",
};

/** O prazo por omissão de cada método (proposta; docs/26 §3.2, Q5). */
export const PRAZO_POR_OMISSAO: Record<MetodoPagamento, number> = {
  // A EuPago dá 5 minutos para aprovar (docs.eupago.pt, W); 10 com a folga
  // do aviso.
  mb_way: 10,
  multibanco: 1440,
};

export const ESTADOS_VIVOS: readonly EstadoPagamento[] = [
  "criado",
  "a_aguardar_cliente",
  "autorizado",
  "incerto",
];

export const QUEM_DAS_TAREFAS = "sistema:pagamentos";

const CODIGOS_DA_BASE: CodigoErroPagamentos[] = [
  "payments.immutable",
  "payments.invalid_transition",
  "payments.order_not_payable",
  "payments.account_not_ready",
  "payments.issue_needs_person",
];

export function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error) || erro instanceof ErroPagamentos) return erro;
  const codigo = CODIGOS_DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroPagamentos(codigo, erro.message, undefined, { cause: erro });
  }
  if (
    erro.message.startsWith("payments.order_not_paid:") ||
    erro.message.startsWith("payments.order_has_payment:")
  ) {
    return new ErroPagamentos(
      "payments.invalid_transition",
      erro.message,
      undefined,
      { cause: erro },
    );
  }
  const pg = erro as Error & { code?: string; constraint?: string };
  if (pg.code === "23505" && pg.constraint === "pagamento_um_vivo") {
    return new ErroPagamentos(
      "payments.live_exists",
      "já há um pagamento a decorrer nesta encomenda",
      undefined,
      { cause: erro },
    );
  }
  if (pg.code === "23505" && pg.constraint === "metodo_pagamento_um_activo") {
    return new ErroPagamentos(
      "payments.invalid_field",
      "este mercado já tem este método activo",
      undefined,
      { cause: erro },
    );
  }
  if (
    pg.code === "23503" ||
    (pg.code === "22P02" && /uuid/.test(erro.message))
  ) {
    return new ErroPagamentos("payments.not_found", "não existe", undefined, {
      cause: erro,
    });
  }
  if (pg.code === "23514" || pg.code === "22001") {
    return new ErroPagamentos(
      "payments.invalid_field",
      "um valor do pedido não é aceite",
      undefined,
      { cause: erro },
    );
  }
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
    return new ErroPagamentos("payments.retry", "tentar outra vez", undefined, {
      cause: erro,
    });
  }
  return erro;
}

export async function noPagamentos<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
): Promise<T> {
  if (db.isTransaction) {
    try {
      return await fn(db as Transaction<BaseDados>);
    } catch (erro) {
      throw traduzir(erro);
    }
  }
  try {
    return await comComerciante(db, comercianteId, fn);
  } catch (erro) {
    throw traduzir(erro);
  }
}

/** Quem, a origem, o aviso e o motivo da próxima transição (gatilhos da 0044). */
export async function marcar(
  trx: Transaction<BaseDados>,
  m: {
    quem: string;
    origem: OrigemTransicao;
    aviso?: string | null;
    motivo?: string | null;
  },
) {
  await sql`select set_config('eurolify.quem', ${m.quem}, true),
    set_config('eurolify.origem', ${m.origem}, true),
    set_config('eurolify.aviso', ${m.aviso ?? ""}, true),
    set_config('eurolify.motivo', ${m.motivo ?? ""}, true)`.execute(trx);
}

export function adaptadorDe(cfg: ConfigPagamentos | undefined): {
  adaptador: AdaptadorPagamento;
  chave: ChavePagamentos;
} {
  const adaptador = cfg?.adaptadores.eupago;
  if (cfg?.chave === undefined || adaptador === undefined) {
    throw new ErroPagamentos(
      "payments.not_configured",
      "os pagamentos não estão ligados neste servidor (PAGAMENTOS_CHAVE)",
    );
  }
  return { adaptador, chave: cfg.chave };
}

// ---------------------------------------------------------------- Contas

export async function listarContas(db: Kysely<BaseDados>, c: string) {
  return noPagamentos(db, c, (trx) =>
    trx
      .selectFrom("conta_pagamento")
      .select([
        "id",
        "prestador",
        "nome",
        "modo",
        "estado",
        "credenciais_em",
        "credenciais_por",
        "testada_em",
        "criado_em",
        "versao",
      ])
      .orderBy("criado_em")
      .orderBy("id")
      .execute(),
  );
}

export async function criarConta(
  trx: Transaction<BaseDados>,
  c: string,
  dados: { prestador: "eupago"; nome: string },
): Promise<string> {
  return noPagamentos(trx, c, async () => {
    const { id } = await trx
      .insertInto("conta_pagamento")
      .values({
        comerciante_id: c,
        prestador: dados.prestador,
        nome: dados.nome,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
}

async function contaParaMudar(
  trx: Transaction<BaseDados>,
  id: string,
  versao: number | null,
) {
  const conta = await trx
    .selectFrom("conta_pagamento")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (conta === undefined) {
    throw new ErroPagamentos("payments.not_found", "esta conta não existe");
  }
  if (versao !== null && conta.versao !== versao) {
    throw new ErroPagamentos(
      "payments.version_conflict",
      "a conta mudou entretanto",
      { versao: conta.versao },
    );
  }
  return conta;
}

export async function mudarConta(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  versao: number,
  dados: { nome?: string; arquivar?: boolean },
) {
  return noPagamentos(trx, c, async () => {
    const conta = await contaParaMudar(trx, id, versao);
    await trx
      .updateTable("conta_pagamento")
      .set({
        ...(dados.nome === undefined ? {} : { nome: dados.nome }),
        ...(dados.arquivar === true ? { estado: "arquivada" as const } : {}),
        actualizado_em: new Date(),
        versao: conta.versao + 1,
      })
      .where("id", "=", id)
      .execute();
    return conta.versao + 1;
  });
}

/**
 * As credenciais e o segredo dos avisos, cifrados; a conta volta a rascunho
 * até à chamada de teste (gatilho da 0044). Nunca se devolvem.
 */
export async function definirCredenciais(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  dados: {
    chave: string;
    segredo_aviso: string;
    /** OAuth, para o reembolso pelo prestador (docs/30 §13, P1). */
    client_id?: string;
    client_secret?: string;
  },
  quem: string,
  cfg: ConfigPagamentos | undefined,
) {
  if ((dados.client_id === undefined) !== (dados.client_secret === undefined)) {
    throw new ErroPagamentos(
      "payments.invalid_field",
      "o client_id e o client_secret vão juntos",
    );
  }
  const { chave } = adaptadorDe(cfg);
  return noPagamentos(trx, c, async () => {
    const conta = await contaParaMudar(trx, id, null);
    await trx
      .updateTable("conta_pagamento")
      .set({
        credenciais_cifra: cifrar(
          JSON.stringify({
            chave: dados.chave,
            ...(dados.client_id === undefined
              ? {}
              : {
                  oauth: {
                    clientId: dados.client_id,
                    clientSecret: dados.client_secret,
                  },
                }),
          }),
          id,
          "credenciais",
          chave,
        ),
        segredo_aviso_cifra: cifrar(
          dados.segredo_aviso,
          id,
          "segredo_aviso",
          chave,
        ),
        chave_versao: chave.versao,
        credenciais_em: new Date(),
        credenciais_por: quem,
        testada_em: null,
        estado: conta.estado === "pronta" ? "rascunho" : conta.estado,
        actualizado_em: new Date(),
        versao: conta.versao + 1,
      })
      .where("id", "=", id)
      .execute();
  });
}

export function credenciaisDe(
  conta: {
    id: string;
    credenciais_cifra: Buffer | null;
    chave_versao: string | null;
  },
  chave: ChavePagamentos,
): CredenciaisConta {
  if (conta.credenciais_cifra === null) {
    throw new ErroPagamentos(
      "payments.account_not_ready",
      "a conta não tem credenciais",
    );
  }
  if (conta.chave_versao !== chave.versao) {
    throw new ErroPagamentos(
      "payments.account_not_ready",
      "as credenciais foram cifradas com outra versão da chave: defina-as outra vez",
    );
  }
  const lidas = JSON.parse(
    decifrar(conta.credenciais_cifra, conta.id, "credenciais", chave),
  ) as {
    chave?: unknown;
    oauth?: { clientId?: unknown; clientSecret?: unknown };
  };
  if (typeof lidas.chave !== "string") {
    throw new ErroPagamentos(
      "payments.account_not_ready",
      "credenciais ilegíveis",
    );
  }
  const o = lidas.oauth;
  return typeof o?.clientId === "string" && typeof o.clientSecret === "string"
    ? {
        chave: lidas.chave,
        oauth: { clientId: o.clientId, clientSecret: o.clientSecret },
      }
    : { chave: lidas.chave };
}

/** A chamada de teste ao prestador: só com ela a conta fica pronta. */
export async function testarConta(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigPagamentos | undefined,
) {
  const { adaptador, chave } = adaptadorDe(cfg);
  const conta = await noPagamentos(db, c, (trx) =>
    trx
      .selectFrom("conta_pagamento")
      .select([
        "id",
        "estado",
        "credenciais_cifra",
        "chave_versao",
        "credenciais_em",
      ])
      .where("id", "=", id)
      .executeTakeFirst(),
  );
  if (conta === undefined) {
    throw new ErroPagamentos("payments.not_found", "esta conta não existe");
  }
  if (conta.estado === "arquivada") {
    throw new ErroPagamentos("payments.immutable", "a conta está arquivada");
  }
  const credenciais = credenciaisDe(conta, chave);
  try {
    await adaptador.testar(credenciais);
  } catch (erro) {
    throw new ErroPagamentos(
      erro instanceof ErroDeRede
        ? "payments.provider_unavailable"
        : "payments.account_not_ready",
      erro instanceof ErroDeRede
        ? "o prestador não respondeu"
        : "o prestador recusou as credenciais",
    );
  }
  return noPagamentos(db, c, async (trx) => {
    const agora = await contaParaMudar(trx, id, null);
    // As credenciais mudaram durante o teste: não se dá esta por testada.
    if (agora.credenciais_em?.getTime() !== conta.credenciais_em?.getTime()) {
      throw new ErroPagamentos(
        "payments.version_conflict",
        "as credenciais mudaram durante o teste",
      );
    }
    await trx
      .updateTable("conta_pagamento")
      .set({
        testada_em: new Date(),
        estado: "pronta",
        actualizado_em: new Date(),
        versao: agora.versao + 1,
      })
      .where("id", "=", id)
      .execute();
    return agora.versao + 1;
  });
}

// ---------------------------------------------------- A régua: métodos

export async function listarMetodos(
  db: Kysely<BaseDados>,
  c: string,
  mercadoId?: string,
) {
  return noPagamentos(db, c, (trx) => {
    let q = trx
      .selectFrom("metodo_pagamento")
      .selectAll()
      .orderBy("mercado_id")
      .orderBy("ordem")
      .orderBy("id");
    if (mercadoId !== undefined) q = q.where("mercado_id", "=", mercadoId);
    return q.execute();
  });
}

async function contaParaMetodo(
  trx: Transaction<BaseDados>,
  contaId: string,
  metodo: MetodoPagamento,
) {
  const conta = await trx
    .selectFrom("conta_pagamento")
    .select(["id", "prestador", "estado"])
    .where("id", "=", contaId)
    .executeTakeFirst();
  if (conta === undefined) {
    throw new ErroPagamentos("payments.not_found", "esta conta não existe");
  }
  if (!METODOS_DO_PRESTADOR[conta.prestador].includes(metodo)) {
    throw new ErroPagamentos(
      "payments.method_unavailable",
      `o prestador da conta não sabe o método ${metodo}`,
    );
  }
}

export async function criarMetodo(
  trx: Transaction<BaseDados>,
  c: string,
  dados: {
    mercado: string;
    metodo: MetodoPagamento;
    conta: string;
    ordem?: number;
    prazo_minutos?: number;
  },
): Promise<string> {
  return noPagamentos(trx, c, async () => {
    const mercado = await trx
      .selectFrom("mercado")
      .select(["id", "loja_id"])
      .where("id", "=", dados.mercado)
      .executeTakeFirst();
    if (mercado === undefined) {
      throw new ErroPagamentos("payments.not_found", "este mercado não existe");
    }
    await contaParaMetodo(trx, dados.conta, dados.metodo);
    const { id } = await trx
      .insertInto("metodo_pagamento")
      .values({
        comerciante_id: c,
        loja_id: mercado.loja_id,
        mercado_id: mercado.id,
        metodo: dados.metodo,
        conta_id: dados.conta,
        ordem: dados.ordem ?? 0,
        prazo_minutos: dados.prazo_minutos ?? PRAZO_POR_OMISSAO[dados.metodo],
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
}

export async function mudarMetodo(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  versao: number,
  dados: {
    conta?: string;
    ordem?: number;
    prazo_minutos?: number;
    arquivar?: boolean;
  },
) {
  return noPagamentos(trx, c, async () => {
    const m = await trx
      .selectFrom("metodo_pagamento")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (m === undefined) {
      throw new ErroPagamentos("payments.not_found", "este método não existe");
    }
    if (m.versao !== versao) {
      throw new ErroPagamentos(
        "payments.version_conflict",
        "o método mudou entretanto",
        { versao: m.versao },
      );
    }
    if (dados.conta !== undefined) {
      await contaParaMetodo(trx, dados.conta, m.metodo);
    }
    await trx
      .updateTable("metodo_pagamento")
      .set({
        ...(dados.conta === undefined ? {} : { conta_id: dados.conta }),
        ...(dados.ordem === undefined ? {} : { ordem: dados.ordem }),
        ...(dados.prazo_minutos === undefined
          ? {}
          : { prazo_minutos: dados.prazo_minutos }),
        ...(dados.arquivar === true ? { estado: "arquivado" as const } : {}),
        actualizado_em: new Date(),
        versao: m.versao + 1,
      })
      .where("id", "=", id)
      .execute();
    return m.versao + 1;
  });
}

/**
 * Os métodos que o checkout mostra num mercado (docs/26 §3.2): activos e com
 * a conta pronta, pela ordem do comerciante.
 */
export async function metodosDoMercado(
  trx: Transaction<BaseDados>,
  mercadoId: string,
) {
  return trx
    .selectFrom("metodo_pagamento")
    .innerJoin(
      "conta_pagamento",
      "conta_pagamento.id",
      "metodo_pagamento.conta_id",
    )
    .select([
      "metodo_pagamento.id",
      "metodo_pagamento.metodo",
      "metodo_pagamento.conta_id",
      "metodo_pagamento.prazo_minutos",
      "metodo_pagamento.ordem",
      "conta_pagamento.prestador",
      "conta_pagamento.modo",
    ])
    .where("metodo_pagamento.mercado_id", "=", mercadoId)
    .where("metodo_pagamento.estado", "=", "activo")
    .where("conta_pagamento.estado", "=", "pronta")
    .orderBy("metodo_pagamento.ordem")
    .orderBy("metodo_pagamento.id")
    .execute();
}

// ---------------------------------------------------------- O pagamento

export type PagamentoLido = Awaited<ReturnType<typeof lerPagamentoNaTrx>>;

async function lerPagamentoNaTrx(trx: Transaction<BaseDados>, id: string) {
  const p = await trx
    .selectFrom("pagamento")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (p === undefined) {
    throw new ErroPagamentos("payments.not_found", "este pagamento não existe");
  }
  return p;
}

/** O pagamento vivo da encomenda, ou o último. */
export async function pagamentoDaEncomenda(
  trx: Transaction<BaseDados>,
  encomendaId: string,
) {
  return trx
    .selectFrom("pagamento")
    .selectAll()
    .where("encomenda_id", "=", encomendaId)
    .orderBy(
      sql`case when estado in ('criado', 'a_aguardar_cliente', 'autorizado', 'incerto') then 0 else 1 end`,
    )
    .orderBy("criado_em", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
}

export async function abrirDiferenca(
  trx: Transaction<BaseDados>,
  c: string,
  d: {
    pagamento?: string | null;
    aviso?: string | null;
    motivo: MotivoDiferenca;
    prova: Record<string, unknown>;
  },
) {
  await trx
    .insertInto("diferenca_pagamento")
    .values({
      comerciante_id: c,
      pagamento_id: d.pagamento ?? null,
      aviso_id: d.aviso ?? null,
      motivo: d.motivo,
      prova: JSON.stringify(d.prova),
    })
    .execute();
}

/**
 * Passo 1 do pagamento, dentro da transacção da sessão do checkout: confere
 * a encomenda e o método, e cria o pagamento `criado`. Com um vivo, devolve-o
 * (o clique repetido). Não chama o prestador.
 */
export async function prepararPagamento(
  trx: Transaction<BaseDados>,
  sessao: { id: string; comerciante_id: string; estado: string },
  metodoPedido: MetodoPagamento | undefined,
  encomendaId: string | null,
): Promise<
  | { novo: false; pagamento: PagamentoLido }
  | {
      novo: true;
      pagamento: PagamentoLido;
      conta: {
        id: string;
        credenciais_cifra: Buffer | null;
        chave_versao: string | null;
      };
      telefone: string | null;
    }
> {
  const c = sessao.comerciante_id;
  if (sessao.estado !== "concluida" || encomendaId === null) {
    throw new ErroPagamentos(
      "payments.order_not_payable",
      "a encomenda ainda não foi feita",
    );
  }
  const encomenda = await trx
    .selectFrom("encomenda")
    .select([
      "id",
      "estado",
      "mercado_id",
      "total",
      "moeda",
      "metodo_pagamento",
      "contacto",
      sql<Date>`encomenda_prazo_de_pagamento(criada_em)`.as("prazo"),
      sql<boolean>`now() >= encomenda_prazo_de_pagamento(criada_em)`.as(
        "passou_prazo",
      ),
    ])
    .where("id", "=", encomendaId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const vivo = await pagamentoDaEncomenda(trx, encomenda.id);
  if (vivo !== undefined && ESTADOS_VIVOS.includes(vivo.estado)) {
    return { novo: false, pagamento: vivo };
  }
  // Um capturado com a encomenda ainda por pagar não deixa cobrar outra vez
  // (revisão do #288, P3-6).
  const capturado = await trx
    .selectFrom("pagamento")
    .selectAll()
    .where("encomenda_id", "=", encomenda.id)
    .where("estado", "=", "capturado")
    .executeTakeFirst();
  if (capturado !== undefined) return { novo: false, pagamento: capturado };
  if (encomenda.estado !== "a_aguardar_pagamento") {
    if (vivo !== undefined) return { novo: false, pagamento: vivo };
    throw new ErroPagamentos(
      "payments.order_not_payable",
      `a encomenda está ${encomenda.estado}`,
    );
  }
  if (encomenda.passou_prazo) {
    throw new ErroPagamentos(
      "payments.order_not_payable",
      "passou o prazo para pagar esta encomenda",
    );
  }
  const metodo =
    metodoPedido ?? (encomenda.metodo_pagamento as MetodoPagamento);
  const disponiveis = await metodosDoMercado(trx, encomenda.mercado_id);
  const regua = disponiveis.find((m) => m.metodo === metodo);
  if (regua === undefined) {
    throw new ErroPagamentos(
      "payments.method_unavailable",
      "este método não está disponível neste mercado",
      { metodos: disponiveis.map((m) => m.metodo) },
    );
  }
  const contacto = encomenda.contacto as { telefone?: string | null };
  const telefone = contacto.telefone ?? null;
  if (
    metodo === "mb_way" &&
    (telefone === null || !/^\+351[0-9]{9}$/.test(telefone))
  ) {
    throw new ErroPagamentos(
      "payments.invalid_field",
      "o MB WAY precisa de um telemóvel português (+351) no contacto",
    );
  }
  // A referência Multibanco paga-se até ao fim do dia do prazo (a EuPago só
  // aceita a data, W): o pagamento só expira no fim desse dia em Lisboa, e a
  // encomenda espera por ele (revisão do #288, P1-2).
  const { rows } = await sql<{ expira: Date }>`
    with limite as (
      select least(now() + make_interval(mins => ${regua.prazo_minutos}),
                   ${encomenda.prazo}::timestamptz) as l)
    select case when ${metodo} = 'multibanco'
      then ((date_trunc('day', l at time zone 'Europe/Lisbon') + interval '1 day')
            at time zone 'Europe/Lisbon') - interval '1 millisecond'
      else l end as expira
    from limite`.execute(trx);
  const expira = (rows[0] as { expira: Date }).expira;
  const { id } = await trx
    .insertInto("pagamento")
    .values({
      comerciante_id: c,
      encomenda_id: encomenda.id,
      conta_id: regua.conta_id,
      prestador: regua.prestador,
      metodo,
      modo: regua.modo,
      montante: Number(encomenda.total),
      moeda: encomenda.moeda,
      referencia: randomBytes(16).toString("hex"),
      expira_em: expira,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const conta = await trx
    .selectFrom("conta_pagamento")
    .select(["id", "credenciais_cifra", "chave_versao"])
    .where("id", "=", regua.conta_id)
    .executeTakeFirstOrThrow();
  return {
    novo: true,
    pagamento: await lerPagamentoNaTrx(trx, id),
    conta,
    telefone,
  };
}

/**
 * Passo 2: chama o prestador (fora da transacção) e grava o que ele disse.
 * Tempo esgotado ou resposta ilegível ⇒ `incerto` e uma diferença (R4).
 */
export async function cobrar(
  db: Kysely<BaseDados>,
  preparado: {
    pagamento: PagamentoLido;
    conta: {
      id: string;
      credenciais_cifra: Buffer | null;
      chave_versao: string | null;
    };
    telefone: string | null;
  },
  quem: string,
  cfg: ConfigPagamentos | undefined,
): Promise<PagamentoLido> {
  const p = preparado.pagamento;
  const c = p.comerciante_id;
  let resultado:
    | Awaited<ReturnType<AdaptadorPagamento["cobrar"]>>
    | { estado: "incerto"; motivo: string };
  // Antes de chamar: o que falhar aqui sabe-se que não saiu (falhado).
  // Depois de chamar, só uma recusa explícita é falhado; tudo o resto é
  // incerto (revisão do #288, P2-7).
  let preparo:
    | { adaptador: AdaptadorPagamento; credenciais: CredenciaisConta }
    | { erro: string };
  try {
    const { adaptador, chave } = adaptadorDe(cfg);
    preparo = { adaptador, credenciais: credenciaisDe(preparado.conta, chave) };
  } catch (erro) {
    preparo = {
      erro:
        erro instanceof ErroPagamentos ? erro.codigo : "erro_antes_de_chamar",
    };
  }
  if ("erro" in preparo) {
    resultado = { estado: "falhado", motivo: preparo.erro };
  } else {
    try {
      resultado = await preparo.adaptador.cobrar(preparo.credenciais, {
        referencia: p.referencia,
        montante: Number(p.montante),
        moeda: p.moeda,
        metodo: p.metodo,
        telefone: preparado.telefone,
        expiraEm: p.expira_em,
      });
    } catch (erro) {
      resultado = {
        estado: "incerto",
        motivo: erro instanceof Error ? erro.message.slice(0, 200) : "erro",
      };
    }
  }
  return noPagamentos(db, c, async (trx) => {
    const actual = await trx
      .selectFrom("pagamento")
      .selectAll()
      .where("id", "=", p.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    // Um aviso pode ter chegado antes desta resposta: não se volta atrás.
    if (actual.estado !== "criado") return actual;
    if (resultado.estado === "a_aguardar_cliente") {
      await marcar(trx, { quem, origem: "consulta" });
      await trx
        .updateTable("pagamento")
        .set({
          estado: "a_aguardar_cliente",
          referencia_prestador: resultado.referenciaPrestador,
          instrucoes: JSON.stringify(resultado.instrucoes),
        })
        .where("id", "=", p.id)
        .execute();
    } else if (resultado.estado === "falhado") {
      await marcar(trx, { quem, origem: "consulta", motivo: resultado.motivo });
      await trx
        .updateTable("pagamento")
        .set({ estado: "falhado" })
        .where("id", "=", p.id)
        .execute();
    } else {
      await marcar(trx, { quem, origem: "sistema", motivo: resultado.motivo });
      await trx
        .updateTable("pagamento")
        .set({ estado: "incerto" })
        .where("id", "=", p.id)
        .execute();
      await abrirDiferenca(trx, c, {
        pagamento: p.id,
        motivo: "incerto",
        prova: { ao_cobrar: resultado.motivo },
      });
    }
    return lerPagamentoNaTrx(trx, p.id);
  });
}

/**
 * Aplica um estado vindo do prestador (aviso ou consulta) ao pagamento já
 * bloqueado. `capturado` com o montante e a moeda certos passa a encomenda a
 * paga na mesma transacção. O que não casa abre uma diferença: nunca se
 * ignora nem se força.
 */
async function aplicarEstado(
  trx: Transaction<BaseDados>,
  p: PagamentoLido,
  novo: EstadoNoPrestador,
  origem: { tipo: "aviso" | "consulta"; quem: string; aviso: string | null },
  valor: { montante: number | null; moeda: string | null } | null,
): Promise<"aplicado" | "repetido" | "diferenca" | "sem_mudanca"> {
  const c = p.comerciante_id;
  if (novo === "desconhecido" || novo === "a_aguardar_cliente") {
    if (origem.tipo === "consulta") return "sem_mudanca";
    await abrirDiferenca(trx, c, {
      pagamento: p.id,
      aviso: origem.aviso,
      motivo: "transicao_impossivel",
      prova: { de: p.estado, para: novo },
    });
    return "diferenca";
  }
  if (p.estado === novo) return "repetido";
  if (novo === "capturado" && valor !== null) {
    // Sem moeda no aviso também não se dá por pago (revisão do #288, P3-3).
    if (valor.moeda !== p.moeda) {
      await abrirDiferenca(trx, c, {
        pagamento: p.id,
        aviso: origem.aviso,
        motivo: "moeda_diferente",
        prova: { esperada: p.moeda, recebida: valor.moeda },
      });
      return "diferenca";
    }
    if (valor.montante === null || valor.montante !== Number(p.montante)) {
      await abrirDiferenca(trx, c, {
        pagamento: p.id,
        aviso: origem.aviso,
        motivo: "montante_diferente",
        prova: { esperado: Number(p.montante), recebido: valor.montante },
      });
      return "diferenca";
    }
  }
  const { rows } = await sql<{ valida: boolean }>`
    select pagamento_transicao_valida(${p.estado}, ${novo}) as valida`.execute(
    trx,
  );
  const valida =
    rows[0]?.valida === true &&
    !(p.estado === "incerto" && origem.tipo === "aviso");
  if (!valida) {
    await abrirDiferenca(trx, c, {
      pagamento: p.id,
      aviso: origem.aviso,
      motivo: "transicao_impossivel",
      prova: { de: p.estado, para: novo },
    });
    return "diferenca";
  }
  await marcar(trx, {
    quem: origem.quem,
    origem: origem.tipo,
    aviso: origem.aviso,
  });
  await trx
    .updateTable("pagamento")
    .set({ estado: novo })
    .where("id", "=", p.id)
    .execute();
  if (novo === "capturado") await encomendaPaga(trx, p, origem.aviso);
  return "aplicado";
}

async function encomendaPaga(
  trx: Transaction<BaseDados>,
  p: PagamentoLido,
  aviso: string | null,
) {
  const e = await trx
    .selectFrom("encomenda")
    .select(["id", "estado"])
    .where("id", "=", p.encomenda_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (e.estado === "a_aguardar_pagamento") {
    await trx
      .updateTable("encomenda")
      .set({ estado: "paga" })
      .where("id", "=", e.id)
      .execute();
  } else {
    // Paga por outro pagamento, ou cancelada: o dinheiro está na conta do
    // comerciante e decide uma pessoa (o reembolso é da fatia 11).
    await abrirDiferenca(trx, p.comerciante_id, {
      pagamento: p.id,
      aviso,
      motivo:
        e.estado === "paga"
          ? "pagamento_duplicado"
          : "pago_depois_de_cancelada",
      prova: { encomenda: e.id, estado: e.estado },
    });
  }
}

// ------------------------------------------------------------- Os avisos

/** O comerciante da conta do endereço do aviso, sem comerciante na sessão. */
export async function comercianteDaConta(
  db: Kysely<BaseDados>,
  contaId: string,
): Promise<string | null> {
  try {
    const { rows } = await sql<{ c: string | null }>`
      select pagamentos_conta_do_aviso(${contaId}::uuid) as c`.execute(db);
    return rows[0]?.c ?? null;
  } catch (erro) {
    const e = traduzir(erro);
    if (e instanceof ErroPagamentos && e.codigo === "payments.not_found") {
      return null;
    }
    throw e;
  }
}

const resumo = (texto: string) =>
  createHash("sha256").update(texto, "utf8").digest("hex");

export type ResultadoAviso = "aceite" | "assinatura_invalida";

/**
 * Um aviso do prestador (docs/26 §5, passo 5; skill, «Avisos»): conferir a
 * assinatura, gravar em bruto, aplicar; o mesmo evento duas vezes não conta
 * duas vezes. Um processamento que falha lança (a rota responde 5xx e o
 * prestador reenvia).
 */
export async function receberAviso(
  db: Kysely<BaseDados>,
  c: string,
  contaId: string,
  cabecalhos: Record<string, string | string[] | undefined>,
  corpo: string,
  cfg: ConfigPagamentos | undefined,
): Promise<ResultadoAviso> {
  const { adaptador, chave } = adaptadorDe(cfg);
  const conta = await noPagamentos(db, c, (trx) =>
    trx
      .selectFrom("conta_pagamento")
      .select(["id", "segredo_aviso_cifra", "chave_versao"])
      .where("id", "=", contaId)
      .executeTakeFirst(),
  );
  if (conta === undefined) {
    throw new ErroPagamentos("payments.not_found", "esta conta não existe");
  }
  // Grava o aviso em bruto como erro (o prestador reenvia; R7).
  const gravarErro = async (assinaturaValida: boolean, mensagem: string) =>
    noPagamentos(db, c, async (trx) => {
      await trx
        .insertInto("aviso_pagamento")
        .values({
          comerciante_id: c,
          conta_id: contaId,
          id_evento: `corpo:${resumo(corpo)}`,
          corpo,
          assinatura_valida: assinaturaValida,
        })
        .onConflict((oc) => oc.columns(["conta_id", "id_evento"]).doNothing())
        .execute();
      await trx
        .updateTable("aviso_pagamento")
        .set({
          resultado: "erro",
          erro: mensagem.slice(0, 500),
          processado_em: new Date(),
        })
        .where("conta_id", "=", contaId)
        .where("id_evento", "=", `corpo:${resumo(corpo)}`)
        .where((w) =>
          w.or([w("resultado", "is", null), w("resultado", "=", "erro")]),
        )
        .execute();
    });
  // Sem o segredo legível a falha é nossa, não do prestador: grava-se e
  // responde-se 503, nunca «assinatura inválida» (revisão do #288, P2-3).
  let segredo: string;
  try {
    if (conta.segredo_aviso_cifra === null) {
      throw new Error("a conta não tem o segredo dos avisos");
    }
    if (conta.chave_versao !== chave.versao) {
      throw new Error("o segredo foi cifrado com outra versão da chave");
    }
    segredo = decifrar(
      conta.segredo_aviso_cifra,
      conta.id,
      "segredo_aviso",
      chave,
    );
  } catch (erro) {
    await gravarErro(
      false,
      `segredo indisponível: ${erro instanceof Error ? erro.message : "erro"}`,
    );
    throw new ErroPagamentos(
      "payments.not_configured",
      "o segredo dos avisos desta conta não está disponível",
    );
  }
  let leitura: ReturnType<AdaptadorPagamento["lerAviso"]>;
  try {
    leitura = adaptador.lerAviso(cabecalhos, corpo, segredo);
  } catch (erro) {
    // Assinado, mas não se lê: grava-se e responde-se erro (R7).
    await gravarErro(true, erro instanceof Error ? erro.message : "erro");
    throw erro;
  }
  if (!leitura.valido) {
    // Grava-se para investigar e não se aplica (R5).
    await noPagamentos(db, c, async (trx) => {
      const { id } =
        (await trx
          .insertInto("aviso_pagamento")
          .values({
            comerciante_id: c,
            conta_id: contaId,
            id_evento: `invalido:${resumo(corpo)}`,
            // Sem assinatura válida não se guarda o corpo, só o resumo no
            // identificador (revisão do #288, P2-1).
            corpo: "",
            assinatura_valida: false,
          })
          .onConflict((oc) => oc.columns(["conta_id", "id_evento"]).doNothing())
          .returning("id")
          .executeTakeFirst()) ?? {};
      if (id !== undefined) {
        await trx
          .updateTable("aviso_pagamento")
          .set({ resultado: "assinatura_invalida", processado_em: new Date() })
          .where("id", "=", id)
          .execute();
      }
    });
    return "assinatura_invalida";
  }
  // Primeiro em bruto, numa transacção própria (skill, «Avisos», 2).
  await noPagamentos(db, c, async (trx) => {
    for (const ev of leitura.eventos) {
      await trx
        .insertInto("aviso_pagamento")
        .values({
          comerciante_id: c,
          conta_id: contaId,
          id_evento: ev.idEvento,
          corpo,
          assinatura_valida: true,
        })
        .onConflict((oc) => oc.columns(["conta_id", "id_evento"]).doNothing())
        .execute();
    }
  });
  for (const ev of leitura.eventos) {
    try {
      await noPagamentos(db, c, (trx) => aplicarAviso(trx, c, contaId, ev));
    } catch (erro) {
      await noPagamentos(db, c, (trx) =>
        trx
          .updateTable("aviso_pagamento")
          .set({
            resultado: "erro",
            erro: erro instanceof Error ? erro.message.slice(0, 500) : "erro",
            processado_em: new Date(),
          })
          .where("conta_id", "=", contaId)
          .where("id_evento", "=", ev.idEvento)
          .where((w) =>
            w.or([w("resultado", "is", null), w("resultado", "=", "erro")]),
          )
          .execute(),
      );
      throw erro;
    }
  }
  return "aceite";
}

async function aplicarAviso(
  trx: Transaction<BaseDados>,
  c: string,
  contaId: string,
  ev: AvisoNormalizado,
) {
  const aviso = await trx
    .selectFrom("aviso_pagamento")
    .select(["id", "resultado"])
    .where("conta_id", "=", contaId)
    .where("id_evento", "=", ev.idEvento)
    .forUpdate()
    .executeTakeFirstOrThrow();
  // O mesmo evento outra vez: já tratado, não conta outra vez (R6).
  if (aviso.resultado !== null && aviso.resultado !== "erro") return;
  const fechar = async (resultado: string, pagamentoId: string | null) => {
    await trx
      .updateTable("aviso_pagamento")
      .set({
        resultado,
        pagamento_id: pagamentoId,
        processado_em: new Date(),
        erro: null,
      })
      .where("id", "=", aviso.id)
      .execute();
  };
  const p =
    ev.referencia === null
      ? undefined
      : await trx
          .selectFrom("pagamento")
          .selectAll()
          .where("referencia", "=", ev.referencia)
          .where("conta_id", "=", contaId)
          .forUpdate()
          .executeTakeFirst();
  // O aviso chegou antes de gravarmos a resposta da cobrança: responde-se
  // erro e o prestador reenvia daqui a minutos (R7), já com o pagamento à
  // espera do cliente.
  if (p?.estado === "criado") {
    throw new ErroPagamentos(
      "payments.retry",
      "o pagamento ainda está a ser criado",
    );
  }
  if (p === undefined) {
    await abrirDiferenca(trx, c, {
      aviso: aviso.id,
      motivo: "aviso_sem_pagamento",
      prova: { referencia: ev.referencia, estado: ev.estado },
    });
    await fechar("sem_pagamento", null);
    return;
  }
  // Um reembolso no prestador (docs/30 §13, P6): não muda o pagamento. Se o
  // Eurolify o pediu, a consulta dos `a_confirmar` deste pagamento corre já
  // na próxima volta; se não pediu nenhum, fica na fila para uma pessoa.
  if (ev.estado === "reembolsado") {
    const vivos = await trx
      .selectFrom("reembolso")
      .select(["id", "estado"])
      .where("pagamento_id", "=", p.id)
      .where("estado", "in", ["a_pedir", "a_confirmar", "incerto"])
      .execute();
    if (vivos.length === 0) {
      await abrirDiferenca(trx, c, {
        pagamento: p.id,
        aviso: aviso.id,
        motivo: "reembolso_desconhecido",
        prova: { montante: ev.montante, moeda: ev.moeda },
      });
      await fechar("diferenca", p.id);
      return;
    }
    await marcar(trx, { quem: `prestador:${p.prestador}`, origem: "aviso" });
    await trx
      .updateTable("reembolso")
      .set({ consultado_em: sql<Date>`'-infinity'::timestamptz` })
      .where("pagamento_id", "=", p.id)
      .where("estado", "=", "a_confirmar")
      .execute();
    await fechar("aplicado", p.id);
    return;
  }
  const r = await aplicarEstado(
    trx,
    p,
    ev.estado,
    { tipo: "aviso", quem: `prestador:${p.prestador}`, aviso: aviso.id },
    { montante: ev.montante, moeda: ev.moeda },
  );
  // O `trid` do aviso que deu o pagamento como pago, para o reembolso (P2).
  if (
    ev.estado === "capturado" &&
    ev.idTransaccao !== null &&
    (r === "aplicado" || r === "repetido") &&
    p.id_transaccao_prestador === null
  ) {
    await marcar(trx, { quem: `prestador:${p.prestador}`, origem: "aviso" });
    await trx
      .updateTable("pagamento")
      .set({ id_transaccao_prestador: ev.idTransaccao })
      .where("id", "=", p.id)
      .where("id_transaccao_prestador", "is", null)
      .execute();
  }
  await fechar(r === "sem_mudanca" ? "aplicado" : r, p.id);
}

// ---------------------------------------------------------- A consulta

/** Consulta o prestador e aplica o que ele disser (docs/26 §5, passo 7). */
export async function consultarPagamento(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  quem: string,
  cfg: ConfigPagamentos | undefined,
): Promise<{ prestador: EstadoNoPrestador; pagamento: PagamentoLido }> {
  const { adaptador, chave } = adaptadorDe(cfg);
  const { p, conta } = await noPagamentos(db, c, async (trx) => {
    const p = await lerPagamentoNaTrx(trx, id);
    const conta = await trx
      .selectFrom("conta_pagamento")
      .select(["id", "credenciais_cifra", "chave_versao"])
      .where("id", "=", p.conta_id)
      .executeTakeFirstOrThrow();
    return { p, conta };
  });
  let noPrestador: EstadoNoPrestador;
  try {
    noPrestador = await adaptador.consultar(credenciaisDe(conta, chave), {
      referencia: p.referencia,
      referenciaPrestador: p.referencia_prestador,
      metodo: p.metodo,
      instrucoes: p.instrucoes,
    });
  } catch (erro) {
    if (erro instanceof ErroDeRede) {
      throw new ErroPagamentos(
        "payments.provider_unavailable",
        "o prestador não respondeu",
      );
    }
    throw erro;
  }
  const pagamento = await noPagamentos(db, c, async (trx) => {
    const actual = await trx
      .selectFrom("pagamento")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    await aplicarEstado(
      trx,
      actual,
      noPrestador,
      { tipo: "consulta", quem, aviso: null },
      null,
    );
    return lerPagamentoNaTrx(trx, id);
  });
  return { prestador: noPrestador, pagamento };
}

// ------------------------------------------------------------ As tarefas

export interface ResultadoTarefas {
  expirados: number;
  incertos: number;
  pagos: number;
  canceladas: number;
  adiadas: number;
  /** Os erros nossos (não de rede), para o registo. */
  erros: { pagamento: string; erro: string }[];
}

/** Quantas tarefas por comerciante em cada volta (proposta). */
export const TAREFAS_POR_VOLTA = 20;

/**
 * Uma volta das tarefas (docs/26 §5, passo 7, e §4.2): os pagamentos vivos que
 * passaram do prazo (consulta ao prestador; sem resposta clara, `incerto`) e
 * as encomendas por pagar que passaram das 24 h sem pagamento vivo.
 */
export async function correrTarefas(
  db: Kysely<BaseDados>,
  cfg: ConfigPagamentos | undefined,
  porVolta = TAREFAS_POR_VOLTA,
): Promise<ResultadoTarefas> {
  const r: ResultadoTarefas = {
    expirados: 0,
    incertos: 0,
    pagos: 0,
    canceladas: 0,
    adiadas: 0,
    erros: [],
  };
  const { rows: comerciantes } = await sql<{
    c: string;
  }>`select pagamentos_comerciantes_com_tarefas() as c`.execute(db);
  for (const { c } of comerciantes) {
    const tarefas = await noPagamentos(
      db,
      c,
      async (trx) =>
        (
          await sql<{
            alvo_tipo: "pagamento" | "encomenda";
            alvo_id: string;
          }>`select * from pagamentos_tarefas(${porVolta})`.execute(trx)
        ).rows,
    );
    for (const t of tarefas) {
      if (t.alvo_tipo === "pagamento") {
        await tarefaDoPagamento(db, c, t.alvo_id, cfg, r);
      } else {
        await tarefaDaEncomenda(db, c, t.alvo_id, r);
      }
    }
  }
  return r;
}

async function adiar(
  db: Kysely<BaseDados>,
  c: string,
  tipo: "pagamento" | "encomenda",
  id: string,
  minutos: number,
) {
  await noPagamentos(db, c, (trx) =>
    sql`select pagamentos_adiar_tarefa(${tipo}, ${id}::uuid, ${minutos})`.execute(
      trx,
    ),
  );
}

async function tarefaDoPagamento(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigPagamentos | undefined,
  r: ResultadoTarefas,
) {
  const p = await noPagamentos(db, c, (trx) => lerPagamentoNaTrx(trx, id));
  if (p.estado === "criado") {
    // Ficou a meio (o processo caiu entre criar e ouvir o prestador): não se
    // sabe se a cobrança saiu. Incerto; decide uma pessoa.
    await noPagamentos(db, c, async (trx) => {
      const actual = await trx
        .selectFrom("pagamento")
        .selectAll()
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (actual.estado !== "criado") return;
      await marcar(trx, {
        quem: QUEM_DAS_TAREFAS,
        origem: "sistema",
        motivo: "sem resposta ao cobrar",
      });
      await trx
        .updateTable("pagamento")
        .set({ estado: "incerto" })
        .where("id", "=", id)
        .execute();
      await abrirDiferenca(trx, c, {
        pagamento: id,
        motivo: "incerto",
        prova: { tarefa: "ficou criado sem resposta do prestador" },
      });
    });
    r.incertos += 1;
    return;
  }
  if (p.estado !== "a_aguardar_cliente") {
    await adiar(db, c, "pagamento", id, 60);
    r.adiadas += 1;
    return;
  }
  let noPrestador: EstadoNoPrestador;
  try {
    const { adaptador, chave } = adaptadorDe(cfg);
    const conta = await noPagamentos(db, c, (trx) =>
      trx
        .selectFrom("conta_pagamento")
        .select(["id", "credenciais_cifra", "chave_versao"])
        .where("id", "=", p.conta_id)
        .executeTakeFirstOrThrow(),
    );
    noPrestador = await adaptador.consultar(credenciaisDe(conta, chave), {
      referencia: p.referencia,
      referenciaPrestador: p.referencia_prestador,
      metodo: p.metodo,
      instrucoes: p.instrucoes,
    });
  } catch (erro) {
    // Sem resposta agora: volta daqui a 10 minutos (o prestador ainda pode
    // avisar entretanto). Um erro nosso (chave, cifra) volta daqui a uma
    // hora e fica registado (revisão do #288, P2-4).
    if (erro instanceof ErroDeRede) {
      await adiar(db, c, "pagamento", id, 10);
      r.adiadas += 1;
    } else {
      await adiar(db, c, "pagamento", id, 60);
      r.erros.push({
        pagamento: `pay_${id}`,
        erro: erro instanceof Error ? erro.name : "erro",
      });
    }
    return;
  }
  await noPagamentos(db, c, async (trx) => {
    const actual = await trx
      .selectFrom("pagamento")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (actual.estado !== "a_aguardar_cliente") return;
    const origem = {
      tipo: "consulta" as const,
      quem: QUEM_DAS_TAREFAS,
      aviso: null,
    };
    if (noPrestador === "capturado") {
      await aplicarEstado(trx, actual, "capturado", origem, null);
      r.pagos += 1;
      return;
    }
    if (noPrestador === "falhado" || noPrestador === "expirado") {
      await aplicarEstado(trx, actual, noPrestador, origem, null);
      r.expirados += 1;
      return;
    }
    // Pendente no prestador depois do prazo: expirado. O MB WAY tem 5
    // minutos para aprovar (W); a referência Multibanco tem o prazo que lhe
    // demos. Sem resposta clara do prestador sobre um Multibanco, incerto.
    if (noPrestador === "a_aguardar_cliente" || actual.metodo === "mb_way") {
      await marcar(trx, {
        quem: QUEM_DAS_TAREFAS,
        origem: "consulta",
        motivo: `prazo acabado (prestador: ${noPrestador})`,
      });
      await trx
        .updateTable("pagamento")
        .set({ estado: "expirado" })
        .where("id", "=", id)
        .execute();
      r.expirados += 1;
      return;
    }
    await marcar(trx, {
      quem: QUEM_DAS_TAREFAS,
      origem: "consulta",
      motivo: "o prestador não disse o estado",
    });
    await trx
      .updateTable("pagamento")
      .set({ estado: "incerto" })
      .where("id", "=", id)
      .execute();
    await abrirDiferenca(trx, c, {
      pagamento: id,
      motivo: "incerto",
      prova: { tarefa: "prazo acabado", prestador: noPrestador },
    });
    r.incertos += 1;
  });
}

async function tarefaDaEncomenda(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  r: ResultadoTarefas,
) {
  const feito = await noPagamentos(db, c, async (trx) => {
    const e = await trx
      .selectFrom("encomenda")
      .select(["id", "estado"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (e.estado !== "a_aguardar_pagamento") return true;
    const vivoOuPago = await trx
      .selectFrom("pagamento")
      .select("id")
      .where("encomenda_id", "=", id)
      .where("estado", "in", [...ESTADOS_VIVOS, "capturado"])
      .executeTakeFirst();
    if (vivoOuPago !== undefined) return false;
    await marcar(trx, { quem: QUEM_DAS_TAREFAS, origem: "sistema" });
    await trx
      .updateTable("encomenda")
      .set({ estado: "cancelada_sem_pagamento" })
      .where("id", "=", id)
      .execute();
    return true;
  });
  if (feito) {
    r.canceladas += 1;
  } else {
    // Ainda há um pagamento a decorrer (ou incerto, à espera de uma pessoa).
    await adiar(db, c, "encomenda", id, 30);
    r.adiadas += 1;
  }
}

/** De quanto em quanto tempo correm as tarefas: um minuto (docs/26 Q6). */
export const INTERVALO_DAS_TAREFAS_MS = 60 * 1000;

export function agendarTarefasPagamentos(
  base: Kysely<BaseDados>,
  cfg: ConfigPagamentos,
  registo: {
    info: (o: object, m: string) => void;
    error: (o: object, m: string) => void;
  },
): () => void {
  let aCorrer = false;
  const volta = async () => {
    if (aCorrer) return;
    aCorrer = true;
    try {
      const r = await correrTarefas(base, cfg);
      if (r.erros.length > 0) {
        registo.error(
          { erros: r.erros },
          "pagamentos: tarefas com erros nossos (chave ou cifra)",
        );
      }
      if (r.expirados + r.incertos + r.pagos + r.canceladas + r.adiadas > 0) {
        registo.info(r, "pagamentos: volta das tarefas");
      }
    } catch (erro) {
      registo.error(
        { erro: erro instanceof Error ? erro.name : "erro" },
        "pagamentos: a volta das tarefas falhou",
      );
    } finally {
      aCorrer = false;
    }
  };
  const temporizador = setInterval(
    () => void volta(),
    INTERVALO_DAS_TAREFAS_MS,
  );
  temporizador.unref();
  return () => {
    clearInterval(temporizador);
  };
}

// ------------------------------------------------- Leituras e a fila

export async function listarPagamentos(
  db: Kysely<BaseDados>,
  c: string,
  filtro: {
    encomenda?: string;
    estado?: EstadoPagamento;
    limite: number;
    depois?: string;
  },
) {
  return noPagamentos(db, c, (trx) => {
    let q = trx
      .selectFrom("pagamento")
      .selectAll()
      .orderBy("id")
      .limit(filtro.limite + 1);
    if (filtro.encomenda !== undefined)
      q = q.where("encomenda_id", "=", filtro.encomenda);
    if (filtro.estado !== undefined) q = q.where("estado", "=", filtro.estado);
    if (filtro.depois !== undefined) q = q.where("id", ">", filtro.depois);
    return q.execute();
  });
}

export async function lerPagamento(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noPagamentos(db, c, async (trx) => ({
    pagamento: await lerPagamentoNaTrx(trx, id),
    transicoes: await trx
      .selectFrom("transicao_pagamento")
      .select([
        "de",
        "para",
        "origem",
        "aviso_id",
        "quem",
        "motivo",
        "em",
        "canal",
        "pedido",
        "ia",
        "autorizado_por",
      ])
      .where("pagamento_id", "=", id)
      .orderBy("em")
      .orderBy("id")
      .execute(),
  }));
}

export async function listarDiferencas(
  db: Kysely<BaseDados>,
  c: string,
  estado: "aberta" | "resolvida" | undefined,
) {
  return noPagamentos(db, c, (trx) => {
    let q = trx
      .selectFrom("diferenca_pagamento")
      .selectAll()
      .orderBy("criada_em")
      .orderBy("id");
    if (estado !== undefined) q = q.where("estado", "=", estado);
    return q.execute();
  });
}

/**
 * Uma pessoa resolve uma diferença (docs/26 §3.6). Num pagamento incerto,
 * pode decidir o estado (`capturado` ou `falhado`), com a origem «pessoa».
 */
export async function resolverDiferenca(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  dados: { resolucao: string; pagamento?: "capturado" | "falhado" },
  quem: string,
) {
  return noPagamentos(trx, c, async () => {
    const d = await trx
      .selectFrom("diferenca_pagamento")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (d === undefined) {
      throw new ErroPagamentos(
        "payments.not_found",
        "esta diferença não existe",
      );
    }
    if (d.estado === "resolvida") {
      throw new ErroPagamentos(
        "payments.immutable",
        "esta diferença já está resolvida",
      );
    }
    // Um pagamento incerto não fica órfão: fechar a diferença obriga a
    // decidir se foi pago (revisão do #288, P2-2).
    if (dados.pagamento === undefined && d.pagamento_id !== null) {
      const p = await trx
        .selectFrom("pagamento")
        .select("estado")
        .where("id", "=", d.pagamento_id)
        .executeTakeFirstOrThrow();
      if (p.estado === "incerto") {
        throw new ErroPagamentos(
          "payments.invalid_transition",
          "o pagamento está incerto: diga se foi pago (capturado) ou não (falhado)",
        );
      }
    }
    if (dados.pagamento !== undefined) {
      if (d.pagamento_id === null) {
        throw new ErroPagamentos(
          "payments.invalid_field",
          "esta diferença não tem pagamento",
        );
      }
      const p = await trx
        .selectFrom("pagamento")
        .selectAll()
        .where("id", "=", d.pagamento_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (p.estado !== "incerto") {
        throw new ErroPagamentos(
          "payments.invalid_transition",
          `o pagamento está ${p.estado}: só um incerto se decide aqui`,
        );
      }
      await marcar(trx, { quem, origem: "pessoa", motivo: dados.resolucao });
      await trx
        .updateTable("pagamento")
        .set({ estado: dados.pagamento })
        .where("id", "=", p.id)
        .execute();
      if (dados.pagamento === "capturado") await encomendaPaga(trx, p, null);
    }
    await trx
      .updateTable("diferenca_pagamento")
      .set({
        estado: "resolvida",
        resolucao: dados.resolucao,
        resolvida_por: quem,
        resolvida_em: new Date(),
      })
      .where("id", "=", id)
      .execute();
  });
}
