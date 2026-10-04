import { sql, type Kysely, type Transaction } from "kysely";
import type {
  BaseDados,
  EstadoComerciante,
  FinalidadeVerificacao,
  OrigemVerificacao,
  ResultadoVerificacao,
  TipoContrato,
} from "../base/esquema.js";

// Acesso interno ao domínio Comerciante (docs/15). Ainda sem API: abre com a
// fatia de identidade (P1). Todas as operações correm dentro do contexto de
// um comerciante (SET LOCAL), e é a base que impõe o isolamento (RLS); as
// regras de estado vivem na base (trigger), aqui só se traduzem os erros.
//
// 🔴 Os parâmetros eurolify.comerciante, eurolify.motivo e eurolify.quem
// põem-se SEMPRE com set_config(…, true) — só nesta transacção. Com `false`
// ficavam na ligação do pool e a transacção seguinte herdava-os (revisão do
// #43, P2-3).

export type CodigoErroComerciante =
  | "merchant.not_found"
  | "merchant.invalid_transition"
  | "merchant.activation_blocked"
  | "merchant.transition_without_trail"
  | "legal_entity.tax_number_duplicate"
  | "legal_entity.immutable_identity"
  | "legal_entity.in_use"
  | "legal_entity.archived_is_final"
  | "store.legal_entity_archived";

export class ErroComerciante extends Error {
  constructor(
    readonly codigo: CodigoErroComerciante,
    mensagem: string,
    options?: ErrorOptions,
  ) {
    super(mensagem, options);
    this.name = "ErroComerciante";
  }
}

const CODIGOS_DA_BASE: readonly CodigoErroComerciante[] = [
  "merchant.invalid_transition",
  "merchant.activation_blocked",
  "merchant.transition_without_trail",
  "legal_entity.immutable_identity",
  "legal_entity.in_use",
  "legal_entity.archived_is_final",
  "store.legal_entity_archived",
];

/** Traduz um erro da base num erro do domínio; o resto passa como está. */
function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error)) return erro;
  const codigo = CODIGOS_DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroComerciante(codigo, erro.message, { cause: erro });
  }
  const pg = erro as Error & { code?: string; constraint?: string };
  if (
    pg.code === "23505" &&
    pg.constraint === "entidade_legal_nif_unico_por_pais"
  ) {
    return new ErroComerciante(
      "legal_entity.tax_number_duplicate",
      "já há uma entidade deste comerciante com este número fiscal neste país",
      { cause: erro },
    );
  }
  return erro;
}

/**
 * Corre `fn` numa transacção com o contexto do comerciante (`SET LOCAL
 * eurolify.comerciante`). Fora daqui, a base recusa qualquer leitura.
 */
export async function comComerciante<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction().execute(async (trx) => {
      await sql`select set_config('eurolify.comerciante', ${comercianteId}, true)`.execute(
        trx,
      );
      return fn(trx);
    });
  } catch (erro) {
    throw traduzir(erro);
  }
}

export interface DadosComerciante {
  nome: string;
  lingua: string;
  fuso: string;
}

/** Regista um comerciante novo, em rascunho. Devolve o id. */
export async function registarComerciante(
  db: Kysely<BaseDados>,
  dados: DadosComerciante,
): Promise<string> {
  const { rows } = await sql<{ id: string }>`select uuidv7() as id`.execute(db);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("a base não devolveu um uuid");
  await comComerciante(db, id, (trx) =>
    trx
      .insertInto("comerciante")
      .values({ id, ...dados })
      .execute(),
  );
  return id;
}

export async function obterComerciante(db: Kysely<BaseDados>, id: string) {
  const comerciante = await comComerciante(db, id, (trx) =>
    trx
      .selectFrom("comerciante")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst(),
  );
  if (comerciante === undefined) {
    throw new ErroComerciante("merchant.not_found", `comerciante ${id}`);
  }
  return comerciante;
}

export interface Transicao {
  para: EstadoComerciante;
  motivo: string;
  quem: string;
}

/** Muda o estado de um comerciante; o rasto fica escrito na mesma transacção. */
export async function mudarEstado(
  db: Kysely<BaseDados>,
  comercianteId: string,
  transicao: Transicao,
): Promise<void> {
  // A base valida a transição e as condições de activação e escreve ela
  // própria a linha de rasto, com o motivo e quem postos aqui (SET LOCAL).
  await comComerciante(db, comercianteId, async (trx) => {
    await sql`select set_config('eurolify.motivo', ${transicao.motivo}, true),
                     set_config('eurolify.quem', ${transicao.quem}, true)`.execute(
      trx,
    );
    const resultado = await trx
      .updateTable("comerciante")
      .set({ estado: transicao.para })
      .where("id", "=", comercianteId)
      .executeTakeFirst();
    if (resultado.numUpdatedRows === 0n) {
      throw new ErroComerciante(
        "merchant.not_found",
        `comerciante ${comercianteId}`,
      );
    }
  });
}

export interface DadosEntidadeLegal {
  denominacao: string;
  forma_juridica: string;
  pais: string;
  numero_fiscal: string;
  morada_linha: string;
  morada_codigo_postal: string;
  morada_localidade: string;
}

export async function criarEntidadeLegal(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosEntidadeLegal,
): Promise<string> {
  const { id } = await comComerciante(db, comercianteId, (trx) =>
    trx
      .insertInto("entidade_legal")
      .values({ comerciante_id: comercianteId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

export async function criarLoja(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: { entidade_legal_id: string; nome: string; lingua_origem: string },
): Promise<string> {
  const { id } = await comComerciante(db, comercianteId, (trx) =>
    trx
      .insertInto("loja")
      .values({ comerciante_id: comercianteId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

export async function aceitarContrato(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: { tipo: TipoContrato; versao_texto: string; aceite_por: string },
): Promise<void> {
  await comComerciante(db, comercianteId, (trx) =>
    trx
      .insertInto("aceitacao_contrato")
      .values({ comerciante_id: comercianteId, ...dados })
      .execute(),
  );
}

export async function registarVerificacao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: {
    entidade_legal_id: string;
    finalidade: FinalidadeVerificacao;
    origem: OrigemVerificacao;
    origem_detalhe: string;
    resultado: ResultadoVerificacao;
    rever_ate?: Date | null;
  },
): Promise<void> {
  await comComerciante(db, comercianteId, (trx) =>
    trx
      .insertInto("prova_verificacao")
      .values({
        comerciante_id: comercianteId,
        documento: null,
        rever_ate: null,
        ...dados,
      })
      .execute(),
  );
}
