import { sql, type Kysely, type Transaction } from "kysely";
import { ErroApi } from "../base/erros.js";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import {
  FORMATO_SEGREDO,
  gerarChave,
  resumoDe,
  type Ambito,
  type TipoChave,
} from "./chaves.js";

// Acesso às chaves (migração 0010; docs/19 §3 e §5). A API não tem nada na
// tabela: só as quatro funções da base. Listar, criar e revogar correm no
// contexto do comerciante (comComerciante); resolver não, porque ainda não se
// sabe de quem é a chave.

/** O que a chave autenticada dá ao pedido (docs/19 §5, passo 3). */
export interface ContextoChave {
  chaveId: string;
  comercianteId: string;
  lojaId: string | null;
  tipo: TipoChave;
  ambitos: Ambito[];
  prefixo: string;
  /**
   * O segredo apresentado: a base calcula o resumo e encontra por ele quem
   * pede ao criar ou revogar (0012; revisão do #118, P2-2). Nunca vai para a
   * resposta nem para o registo (o serializador do pedido não o vê).
   */
  segredo: string;
}

/**
 * Do segredo ao contexto. Devolve `null` se o segredo não tem o formato ou se
 * a chave não existe, foi revogada ou expirou — sem distinguir os casos.
 */
export async function resolverChave(
  db: Kysely<BaseDados>,
  segredo: string,
): Promise<ContextoChave | null> {
  if (!FORMATO_SEGREDO.test(segredo)) return null;
  const resumo = resumoDe(segredo);
  const { rows } = await sql<{
    id: string;
    comerciante_id: string;
    loja_id: string | null;
    tipo: TipoChave;
    ambitos: Ambito[];
    prefixo: string;
  }>`select * from chave_resolver(${resumo})`.execute(db);
  const linha = rows[0];
  if (linha === undefined) return null;
  return {
    chaveId: linha.id,
    comercianteId: linha.comerciante_id,
    lojaId: linha.loja_id,
    tipo: linha.tipo,
    ambitos: linha.ambitos,
    prefixo: linha.prefixo,
    segredo,
  };
}

export interface ChaveListada {
  id: string;
  tipo: TipoChave;
  loja_id: string | null;
  nome: string;
  ambitos: Ambito[];
  prefixo: string;
  criada_por: string;
  criada_em: Date;
  expira_em: Date | null;
  revogada_em: Date | null;
  revogada_por: string | null;
  ultimo_uso_em: Date | null;
}

export function listarChaves(
  db: Kysely<BaseDados>,
  comercianteId: string,
): Promise<ChaveListada[]> {
  return comComerciante(db, comercianteId, async (trx) => {
    const { rows } = await sql<ChaveListada>`
      select * from chave_listar()`.execute(trx);
    return rows;
  });
}

export interface DadosChave {
  tipo: TipoChave;
  lojaId?: string | null;
  nome: string;
  ambitos: Ambito[];
  criadaPor: string;
  expiraEm?: Date | null;
}

/**
 * Regista uma chave de que só se conhece o resumo e o prefixo: o segredo foi
 * gerado noutro sítio (o comando do operador, docs/19 §6) e nunca passa aqui.
 */
export function registarChave(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosChave & { prefixo: string; resumo: string },
): Promise<string> {
  return comComerciante(db, comercianteId, async (trx) => {
    const { rows } = await sql<{ id: string }>`
      select chave_criar(${dados.tipo}, ${dados.lojaId ?? null}::uuid,
        ${dados.nome}, ${dados.ambitos}::text[], ${dados.prefixo},
        ${dados.resumo}, ${dados.criadaPor},
        ${dados.expiraEm ?? null}::timestamptz) as id`.execute(trx);
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("a base não devolveu a chave criada");
    return id;
  });
}

/** Cria uma chave; o segredo vem na resposta e não se guarda. */
export async function criarChave(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosChave,
): Promise<{ id: string; segredo: string; prefixo: string }> {
  const nova = gerarChave(dados.tipo);
  const id = await registarChave(db, comercianteId, {
    ...dados,
    prefixo: nova.prefixo,
    resumo: nova.resumo,
  });
  return { id, segredo: nova.segredo, prefixo: nova.prefixo };
}

/** Revoga uma chave do comerciante; falso se não existe nele ou já estava revogada. */
export function revogarChave(
  db: Kysely<BaseDados>,
  comercianteId: string,
  chaveId: string,
  revogadaPor: string,
): Promise<boolean> {
  return comComerciante(db, comercianteId, async (trx) => {
    const { rows } = await sql<{ revogada: boolean }>`
      select chave_revogar(${chaveId}::uuid, ${revogadaPor}) as revogada`.execute(
      trx,
    );
    return rows[0]?.revogada === true;
  });
}

// Criar e revogar pela API (migração 0012; docs/19 §6.1). A base recebe o
// segredo de quem pede, calcula o resumo e impõe as regras (keys:write, T9,
// a última chave que gere chaves); aqui só se traduzem os erros.

const ERROS_DAS_CHAVES = {
  "auth.forbidden": {
    status: 403,
    pt: "A chave não tem o âmbito desta operação",
    en: "The key lacks the scope for this operation",
  },
  "key.scope_escalation": {
    status: 403,
    pt: "Uma chave não cria outra com âmbitos que não tem",
    en: "A key cannot create another with scopes it does not have",
  },
  "key.merchant_inactive": {
    status: 403,
    pt: "Um comerciante suspenso ou fechado não cria chaves; pode revogá-las",
    en: "A suspended or closed merchant cannot create keys; it can revoke them",
  },
  "key.not_found": {
    status: 404,
    pt: "A chave não existe",
    en: "Key not found",
  },
  "key.already_revoked": {
    status: 409,
    pt: "A chave já foi revogada",
    en: "The key was already revoked",
  },
  "key.last_key_writer": {
    status: 409,
    pt: "É a última chave que gere chaves; crie outra antes de a revogar",
    en: "This is the last key that can manage keys; create another before revoking it",
  },
  "key.invalid_expiry": {
    status: 422,
    pt: "A data de expiração tem de ser no futuro",
    en: "The expiry date must be in the future",
  },
  "key.expiry_beyond_creator": {
    status: 422,
    pt: "Uma chave com prazo não cria outra sem prazo nem que dure mais do que ela",
    en: "A key with an expiry cannot create one without expiry or expiring later",
  },
  "key.store_not_found": {
    status: 422,
    pt: "A loja não existe neste comerciante",
    en: "The store does not exist for this merchant",
  },
} as const;
export type CodigoErroChave = keyof typeof ERROS_DAS_CHAVES;

export function erroChave(codigo: CodigoErroChave, detalhe?: string): ErroApi {
  const { status, pt, en } = ERROS_DAS_CHAVES[codigo];
  return new ErroApi(codigo, status, { pt, en }, detalhe);
}

/** Traduz um erro da base das chaves; o resto passa como está (dá 500). */
function traduzirChave(erro: unknown): unknown {
  if (!(erro instanceof Error)) return erro;
  const codigo = (Object.keys(ERROS_DAS_CHAVES) as CodigoErroChave[]).find(
    (c) => erro.message.startsWith(`${c}:`),
  );
  if (codigo !== undefined) return erroChave(codigo);
  const pg = erro as Error & { code?: string; constraint?: string };
  if (
    pg.code === "23503" &&
    pg.constraint === "chave_api_loja_do_comerciante"
  ) {
    return erroChave("key.store_not_found");
  }
  return erro;
}

async function traduzindo<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (erro) {
    throw traduzirChave(erro);
  }
}

/** Uma chave do comerciante do contexto, como a lista a devolve. */
export async function chaveDoContexto(
  trx: Transaction<BaseDados>,
  id: string,
): Promise<ChaveListada> {
  const { rows } = await sql<ChaveListada>`
    select * from chave_listar() where id = ${id}::uuid`.execute(trx);
  const chave = rows[0];
  if (chave === undefined) throw erroChave("key.not_found");
  return chave;
}

export interface PedidoDeChave {
  tipo: TipoChave;
  lojaId: string | null;
  nome: string;
  /** Na pública, a base põe a lista fixa (`storefront`). */
  ambitos: Ambito[];
  expiraEm: Date | null;
}

/**
 * Cria uma chave em nome da chave que pede (`segredoQuem`), dentro da
 * transacção dada (com o contexto do comerciante). O segredo vem na resposta
 * e não se guarda.
 */
export function criarChavePelaApi(
  trx: Transaction<BaseDados>,
  segredoQuem: string,
  dados: PedidoDeChave,
): Promise<{ chave: ChaveListada; segredo: string }> {
  return traduzindo(async () => {
    const nova = gerarChave(dados.tipo);
    const { rows } = await sql<{ id: string }>`
      select chave_criar_pela_api(${segredoQuem}, ${dados.tipo},
        ${dados.lojaId}::uuid, ${dados.nome}, ${dados.ambitos}::text[],
        ${nova.prefixo}, ${nova.resumo},
        ${dados.expiraEm}::timestamptz) as id`.execute(trx);
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("a base não devolveu a chave criada");
    return { chave: await chaveDoContexto(trx, id), segredo: nova.segredo };
  });
}

/** Revoga uma chave em nome da chave que pede, dentro da transacção dada. */
export function revogarChavePelaApi(
  trx: Transaction<BaseDados>,
  segredoQuem: string,
  id: string,
): Promise<ChaveListada> {
  return traduzindo(async () => {
    await sql`select chave_revogar_pela_api(${segredoQuem}, ${id}::uuid)`.execute(
      trx,
    );
    return chaveDoContexto(trx, id);
  });
}
