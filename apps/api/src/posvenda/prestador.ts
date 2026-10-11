import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import {
  ErroDeRede,
  ErroSemEnvio,
  type AdaptadorPagamento,
  type ConfigPagamentos,
  type CredenciaisConta,
  type ResultadoReembolso,
} from "../pagamentos/adaptador.js";
import { ErroPagamentos } from "../pagamentos/erros.js";
import {
  abrirDiferenca,
  adaptadorDe,
  credenciaisDe,
} from "../pagamentos/repositorio.js";
import { ErroPosVenda } from "./erros.js";
import { depoisDeExecutado, marcar, noPosVenda } from "./repositorio.js";

// Pós-venda, parte 2: o reembolso pelo prestador (docs/30 §13; migração 0060;
// Diogo, 11/10/2026: «aprovado, com a A», docs/06, DP).
//
// 🔴 Um reembolso nunca se repete sozinho (R7): a EuPago não tem chave de
// idempotência. Antes de chamar, o reembolso passa a `a_pedir` (dois pedidos
// ao mesmo tempo não saem os dois); depois, só uma resposta que se lê diz o
// que aconteceu, e o resto fica `incerto` para uma pessoa.

/** Uma chamada que ficou a meio (o processo caiu) passa a incerto ao fim disto. */
export const MINUTOS_DE_UM_PEDIDO = 5;
/** Sem «reembolsado» ao fim disto, vai para a fila de uma pessoa (P6). */
export const DIAS_PARA_CONFIRMAR = 7;
const REEMBOLSOS_POR_VOLTA = 50;
const INTERVALO_MS = 60_000;

const naoDa = (motivo: string) =>
  new ErroPosVenda(
    "refunds.manual_only",
    `${motivo}: registe-o à mão (POST /refunds/{id}/manual)`,
  );

interface Preparado {
  adaptador: AdaptadorPagamento;
  credenciais: CredenciaisConta;
  idTransaccao: string;
  montante: number;
  moeda: string;
  versao: number;
}

/**
 * Executa um reembolso pelo prestador (P4 e P5): só de um pagamento MB WAY
 * (Q8) da EuPago, com o `trid` do aviso e as credenciais OAuth na conta.
 */
export async function executarReembolso(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: { versao: number },
  quem: string,
  cfg: ConfigPagamentos | undefined,
) {
  const p = await noPosVenda(db, c, async (trx): Promise<Preparado> => {
    await marcar(trx, quem);
    const r = await trx
      .selectFrom("reembolso")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (r === undefined) {
      throw new ErroPosVenda("refunds.not_found", "o reembolso não existe");
    }
    if (r.versao !== dados.versao) {
      throw new ErroPosVenda("refunds.version_conflict", "o reembolso mudou", {
        versao: r.versao,
      });
    }
    if (r.estado !== "a_executar" && r.estado !== "falhado") {
      throw new ErroPosVenda(
        "refunds.invalid_transition",
        `o reembolso está ${r.estado}`,
      );
    }
    const pg = await trx
      .selectFrom("pagamento")
      .select(["metodo", "conta_id", "id_transaccao_prestador"])
      .where("id", "=", r.pagamento_id)
      .executeTakeFirstOrThrow();
    let adaptador: AdaptadorPagamento;
    let credenciais: CredenciaisConta;
    try {
      const a = adaptadorDe(cfg);
      adaptador = a.adaptador;
      const conta = await trx
        .selectFrom("conta_pagamento")
        .select(["id", "credenciais_cifra", "chave_versao"])
        .where("id", "=", pg.conta_id)
        .executeTakeFirstOrThrow();
      credenciais = credenciaisDe(conta, a.chave);
    } catch (erro) {
      if (erro instanceof ErroPagamentos) throw naoDa(erro.message);
      throw erro;
    }
    if (!adaptador.reembolsaPorApi.includes(pg.metodo)) {
      throw naoDa(`o prestador não reembolsa ${pg.metodo} sem o IBAN (Q8)`);
    }
    if (pg.id_transaccao_prestador === null) {
      throw naoDa(
        "o pagamento não tem o identificador da transacção no prestador (só chega no aviso)",
      );
    }
    if (credenciais.oauth === undefined) {
      throw naoDa("a conta não tem as credenciais OAuth do prestador");
    }
    let versao = r.versao;
    // Depois de uma recusa, pede-se outra vez por uma pessoa: os tectos
    // voltam a conferir-se na base (P8).
    if (r.estado === "falhado") {
      await trx
        .updateTable("reembolso")
        .set({ estado: "a_executar", versao: versao + 1 })
        .where("id", "=", id)
        .execute();
      versao += 1;
    }
    await trx
      .updateTable("reembolso")
      .set({
        estado: "a_pedir",
        via: "prestador",
        pedido_em: new Date(),
        pedido_por: quem,
        versao: versao + 1,
      })
      .where("id", "=", id)
      .execute();
    return {
      adaptador,
      credenciais,
      idTransaccao: pg.id_transaccao_prestador,
      montante: Number(r.montante),
      moeda: r.moeda,
      versao: versao + 1,
    };
  });
  let resultado: ResultadoReembolso | { estado: "incerto"; motivo: string };
  try {
    resultado = await p.adaptador.reembolsar(p.credenciais, {
      idTransaccao: p.idTransaccao,
      montante: p.montante,
      moeda: p.moeda,
      referencia: `rfd_${id}`,
    });
  } catch (erro) {
    resultado =
      erro instanceof ErroSemEnvio
        ? { estado: "recusado", motivo: erro.message.slice(0, 200) }
        : {
            estado: "incerto",
            motivo:
              erro instanceof ErroDeRede
                ? erro.message.slice(0, 200)
                : "erro inesperado depois de pedir",
          };
  }
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem);
    const r = await trx
      .selectFrom("reembolso")
      .select(["estado", "versao"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    // A tarefa já o deu como incerto (a chamada demorou demasiado): fica.
    if (r.estado !== "a_pedir") return { estado: r.estado, versao: r.versao };
    if (resultado.estado === "pedido") {
      await trx
        .updateTable("reembolso")
        .set({
          estado: "a_confirmar",
          referencia_prestador: resultado.idReembolso,
          versao: r.versao + 1,
        })
        .where("id", "=", id)
        .execute();
      return { estado: "a_confirmar" as const, versao: r.versao + 1 };
    }
    if (resultado.estado === "recusado") {
      await trx
        .updateTable("reembolso")
        .set({
          estado: "falhado",
          falha: resultado.motivo,
          versao: r.versao + 1,
        })
        .where("id", "=", id)
        .execute();
      return { estado: "falhado" as const, versao: r.versao + 1 };
    }
    await ficarIncerto(trx, c, id, r.versao, resultado.motivo);
    return { estado: "incerto" as const, versao: r.versao + 1 };
  });
}

async function ficarIncerto(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  versao: number,
  motivo: string,
) {
  const r = await trx
    .updateTable("reembolso")
    .set({ estado: "incerto", versao: versao + 1 })
    .where("id", "=", id)
    .returning(["pagamento_id"])
    .executeTakeFirstOrThrow();
  await abrirDiferenca(trx, c, {
    pagamento: r.pagamento_id,
    motivo: "reembolso_incerto",
    prova: { reembolso: `rfd_${id}`, motivo },
  });
}

/** Fecha as diferenças abertas de um reembolso, com o que a pessoa decidiu. */
async function fecharDiferencas(
  trx: Transaction<BaseDados>,
  id: string,
  resolucao: string,
  quem: string,
) {
  await trx
    .updateTable("diferenca_pagamento")
    .set({
      estado: "resolvida",
      resolucao,
      resolvida_por: quem,
      resolvida_em: new Date(),
    })
    .where("estado", "=", "aberta")
    .where("motivo", "in", [
      "reembolso_incerto",
      "reembolso_por_confirmar",
    ] as const)
    .where(sql<boolean>`prova->>'reembolso' = ${`rfd_${id}`}`)
    .execute();
}

/**
 * Reconcilia um reembolso `incerto` ou `a_confirmar` (P7): uma pessoa viu no
 * prestador se o dinheiro saiu. Uma de cada vez, com motivo (R9).
 */
export async function reconciliarReembolso(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: {
    versao: number;
    resultado: "executado" | "nao_saiu";
    motivo: string;
    identificador?: string;
  },
  quem: string,
) {
  return noPosVenda(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo);
    const r = await trx
      .selectFrom("reembolso")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (r === undefined) {
      throw new ErroPosVenda("refunds.not_found", "o reembolso não existe");
    }
    if (r.versao !== dados.versao) {
      throw new ErroPosVenda("refunds.version_conflict", "o reembolso mudou", {
        versao: r.versao,
      });
    }
    if (r.estado !== "incerto" && r.estado !== "a_confirmar") {
      throw new ErroPosVenda(
        "refunds.invalid_transition",
        `só se reconcilia um reembolso incerto ou a confirmar (está ${r.estado})`,
      );
    }
    // O prestador aceitou este pedido (tem a referência dele): pedir outra vez
    // podia reembolsar duas vezes. Fica a confirmar, ou uma pessoa dá-o como
    // executado (revisão do #350, P1-1).
    if (r.estado === "a_confirmar" && dados.resultado === "nao_saiu") {
      throw new ErroPosVenda(
        "refunds.invalid_transition",
        `o prestador aceitou este pedido (${r.referencia_prestador ?? "?"}): não se pede outra vez; confirme-o no prestador ou dê-o como executado`,
      );
    }
    if (dados.resultado === "executado") {
      // Num incerto não há referência do prestador: a prova é a da pessoa.
      if (r.estado === "incerto" && dados.identificador === undefined) {
        throw new ErroPosVenda(
          "refunds.invalid_field",
          "diga o identificador do reembolso no prestador",
        );
      }
      await trx
        .updateTable("reembolso")
        .set({
          estado: "executado",
          executado_em: new Date(),
          prova: JSON.stringify({
            reconciliado_por: quem,
            motivo: dados.motivo,
            identificador:
              dados.identificador ?? r.referencia_prestador ?? undefined,
          }),
          versao: r.versao + 1,
        })
        .where("id", "=", id)
        .execute();
      await fecharDiferencas(trx, id, dados.motivo, quem);
      await depoisDeExecutado(trx, r, "pessoa");
      return { estado: "executado" as const, versao: r.versao + 1 };
    }
    await trx
      .updateTable("reembolso")
      .set({ estado: "a_executar", versao: r.versao + 1 })
      .where("id", "=", id)
      .execute();
    await fecharDiferencas(trx, id, dados.motivo, quem);
    return { estado: "a_executar" as const, versao: r.versao + 1 };
  });
}

// ------------------------------------------------- A tarefa (P6)

export interface ResultadoConfirmacoes {
  executados: number;
  incertos: number;
  porConfirmar: number;
  erros: string[];
}

/**
 * Uma volta: os `a_pedir` antigos passam a incerto; os `a_confirmar`
 * consultam-se no prestador, e o que ele der como reembolsado fica executado.
 */
export async function correrConfirmacoes(
  db: Kysely<BaseDados>,
  cfg: ConfigPagamentos | undefined,
  porVolta = REEMBOLSOS_POR_VOLTA,
): Promise<ResultadoConfirmacoes> {
  const res: ResultadoConfirmacoes = {
    executados: 0,
    incertos: 0,
    porConfirmar: 0,
    erros: [],
  };
  const { rows: comerciantes } = await sql<{
    c: string;
  }>`select posvenda_comerciantes_com_reembolsos() as c`.execute(db);
  for (const { c } of comerciantes) {
    const lista = await noPosVenda(db, c, (trx) =>
      trx
        .selectFrom("reembolso")
        .select(["id"])
        .where("estado", "in", ["a_pedir", "a_confirmar"])
        .where((w) =>
          w.or([
            w("consultado_em", "is", null),
            w("consultado_em", "<=", sql<Date>`now() - interval '1 minute'`),
          ]),
        )
        .orderBy(sql`consultado_em nulls first`)
        .orderBy("id")
        .limit(porVolta)
        .execute(),
    );
    for (const { id } of lista) {
      try {
        await confirmarUm(db, c, id, cfg, res);
      } catch (erro) {
        res.erros.push(erro instanceof Error ? erro.name : "erro");
      }
    }
  }
  return res;
}

const QUEM_DA_TAREFA = "sistema:reembolsos";

async function confirmarUm(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigPagamentos | undefined,
  res: ResultadoConfirmacoes,
) {
  const r = await noPosVenda(db, c, async (trx) => {
    await marcar(trx, QUEM_DA_TAREFA);
    const x = await trx
      .selectFrom("reembolso")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (x.estado === "a_pedir") {
      // A chamada ficou a meio (o processo caiu, ou demorou mais do que
      // devia): não se sabe se saiu.
      if (
        x.pedido_em !== null &&
        x.pedido_em.getTime() <= Date.now() - MINUTOS_DE_UM_PEDIDO * 60_000
      ) {
        await ficarIncerto(
          trx,
          c,
          id,
          x.versao,
          "o pedido ao prestador ficou sem resposta",
        );
        res.incertos += 1;
      }
      return null;
    }
    if (x.estado !== "a_confirmar") return null;
    await trx
      .updateTable("reembolso")
      .set({ consultado_em: new Date() })
      .where("id", "=", id)
      .execute();
    const pg = await trx
      .selectFrom("pagamento")
      .select(["conta_id"])
      .where("id", "=", x.pagamento_id)
      .executeTakeFirstOrThrow();
    const conta = await trx
      .selectFrom("conta_pagamento")
      .select(["id", "credenciais_cifra", "chave_versao"])
      .where("id", "=", pg.conta_id)
      .executeTakeFirstOrThrow();
    return { x, conta };
  });
  if (r === null) return;
  const { x, conta } = r;
  let estado: "reembolsado" | "desconhecido";
  try {
    const { adaptador, chave } = adaptadorDe(cfg);
    estado = await adaptador.consultarReembolso(
      credenciaisDe(conta, chave),
      x.referencia_prestador as string,
    );
  } catch {
    estado = "desconhecido";
  }
  await noPosVenda(db, c, async (trx) => {
    await marcar(trx, QUEM_DA_TAREFA);
    const agora = await trx
      .selectFrom("reembolso")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (agora.estado !== "a_confirmar") return;
    if (estado === "reembolsado") {
      await trx
        .updateTable("reembolso")
        .set({
          estado: "executado",
          executado_em: new Date(),
          versao: agora.versao + 1,
        })
        .where("id", "=", id)
        .execute();
      await depoisDeExecutado(trx, agora, "consulta");
      res.executados += 1;
      return;
    }
    // Sem «reembolsado» ao fim de 7 dias: para a fila, uma vez.
    if (
      agora.pedido_em !== null &&
      agora.pedido_em.getTime() <= Date.now() - DIAS_PARA_CONFIRMAR * 86_400_000
    ) {
      const ja = await trx
        .selectFrom("diferenca_pagamento")
        .select("id")
        .where("motivo", "=", "reembolso_por_confirmar")
        .where(sql<boolean>`prova->>'reembolso' = ${`rfd_${id}`}`)
        .executeTakeFirst();
      if (ja === undefined) {
        await abrirDiferenca(trx, c, {
          pagamento: agora.pagamento_id,
          motivo: "reembolso_por_confirmar",
          prova: {
            reembolso: `rfd_${id}`,
            referencia_prestador: agora.referencia_prestador,
          },
        });
        res.porConfirmar += 1;
      }
    }
  });
}

export function agendarConfirmacoes(
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
      const r = await correrConfirmacoes(base, cfg);
      if (r.erros.length > 0) {
        registo.error({ erros: r.erros }, "reembolsos: erros na volta");
      }
      if (r.executados + r.incertos + r.porConfirmar > 0) {
        registo.info(r, "reembolsos: volta das confirmações");
      }
    } catch (erro) {
      registo.error(
        { erro: erro instanceof Error ? erro.name : "erro" },
        "reembolsos: a volta das confirmações falhou",
      );
    } finally {
      aCorrer = false;
    }
  };
  const temporizador = setInterval(() => void volta(), INTERVALO_MS);
  temporizador.unref();
  return () => {
    clearInterval(temporizador);
  };
}
