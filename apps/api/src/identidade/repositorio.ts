import { sql, type Kysely } from "kysely";
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
  const { rows } = await sql<{
    id: string;
    comerciante_id: string;
    loja_id: string | null;
    tipo: TipoChave;
    ambitos: Ambito[];
    prefixo: string;
  }>`select * from chave_resolver(${resumoDe(segredo)})`.execute(db);
  const linha = rows[0];
  if (linha === undefined) return null;
  return {
    chaveId: linha.id,
    comercianteId: linha.comerciante_id,
    lojaId: linha.loja_id,
    tipo: linha.tipo,
    ambitos: linha.ambitos,
    prefixo: linha.prefixo,
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
