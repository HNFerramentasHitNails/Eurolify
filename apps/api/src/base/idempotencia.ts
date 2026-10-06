import { createHash } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { comComerciante } from "../comerciante/repositorio.js";
import { erroBase } from "./erros.js";
import type { BaseDados } from "./esquema.js";

// Idempotência das escritas (docs/18 §4; docs/19 §6.1; migração 0012). Ex.:
// o software de gestão repete um `POST /keys` porque a rede caiu: com a mesma
// `Idempotency-Key`, não se cria uma segunda chave.
//
// 1. Numa transacção própria, a linha entra em `em_curso` (ou encontra-se a
//    que já existe: repete-se a resposta, ou recusa-se).
// 2. A escrita e a passagem a `concluido` vão na mesma transacção.
// 3. Se a escrita falhar, apaga-se a linha `em_curso` e o cliente pode
//    repetir.
// Uma linha expirada (24 h) ou um `em_curso` órfão (60 s) substitui-se.

/** Caracteres visíveis em ASCII, 1 a 255 (o mesmo CHECK da 0012). */
const FORMATO_CHAVE = /^[!-~]{1,255}$/;

/** O JSON com as chaves ordenadas: o mesmo corpo dá sempre o mesmo resumo. */
function ordenado(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenado);
  if (valor !== null && typeof valor === "object") {
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map((k) => [k, ordenado((valor as Record<string, unknown>)[k])]),
    );
  }
  return valor;
}

export function resumoDoCorpo(corpo: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(ordenado(corpo ?? null)), "utf8")
    .digest("hex");
}

export interface PedidoIdempotente {
  /** O valor do cabeçalho `Idempotency-Key`. */
  chave: string | undefined;
  metodo: "POST" | "PUT" | "PATCH" | "DELETE";
  /** O caminho pedido, sem a consulta. */
  caminho: string;
  corpo: unknown;
}

export interface Resposta {
  status: number;
  corpo: unknown;
}

export interface Escrita<T> {
  status: number;
  /** O que vai para o cliente agora. */
  corpo: T;
  /** O que se guarda para repetir (sem segredos: T5). */
  guardar: unknown;
}

export interface OpcoesIdempotencia {
  /** Do guardado à resposta repetida; pode lançar (ex.: o segredo não se repete). */
  repetir?: (guardada: Resposta) => Resposta;
  /** Quando não se consegue apagar a linha de uma escrita que falhou. */
  aoFalharLimpeza?: (erro: unknown) => void;
}

interface Linha {
  metodo: string;
  caminho: string;
  resumo_corpo: string;
  estado: "em_curso" | "concluido";
  resposta_status: number | null;
  resposta_corpo: unknown;
}

/**
 * Corre uma escrita com idempotência. Devolve a resposta nova, ou a guardada
 * se o mesmo pedido já foi feito (`repetida: true`).
 */
export async function comIdempotencia<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  pedido: PedidoIdempotente,
  escrever: (trx: Transaction<BaseDados>) => Promise<Escrita<T>>,
  opcoes: OpcoesIdempotencia = {},
): Promise<
  (Resposta & { repetida: true }) | (Escrita<T> & { repetida: false })
> {
  const chave = pedido.chave;
  if (chave === undefined || chave === "") {
    throw erroBase("idempotency.key_required");
  }
  if (!FORMATO_CHAVE.test(chave)) {
    throw erroBase(
      "request.invalid",
      "Idempotency-Key: de 1 a 255 caracteres visíveis em ASCII",
    );
  }
  const resumo = resumoDoCorpo(pedido.corpo);

  // 1. Reservar a chave, ou encontrar quem já a tem.
  const existente = await comComerciante(db, comercianteId, async (trx) => {
    await sql`
      delete from idempotencia
      where comerciante_id = ${comercianteId}::uuid and chave = ${chave}
        and (expira_em <= now()
             or (estado = 'em_curso' and criado_em < now() - interval '60 seconds'))`.execute(
      trx,
    );
    const { rows: novas } = await sql<{ chave: string }>`
      insert into idempotencia (comerciante_id, chave, metodo, caminho, resumo_corpo)
      values (${comercianteId}::uuid, ${chave}, ${pedido.metodo},
              ${pedido.caminho}, ${resumo})
      on conflict do nothing
      returning chave`.execute(trx);
    if (novas.length > 0) return undefined;
    const { rows } = await sql<Linha>`
      select metodo, caminho, resumo_corpo, estado, resposta_status, resposta_corpo
      from idempotencia
      where comerciante_id = ${comercianteId}::uuid and chave = ${chave}`.execute(
      trx,
    );
    return rows[0] ?? null;
  });

  if (existente === null) {
    // Apagada entre o insert e o select (expirou nesse instante): outro
    // pedido tem-na; o cliente repete.
    throw erroBase("idempotency.in_progress");
  }
  if (existente !== undefined) {
    if (
      existente.metodo !== pedido.metodo ||
      existente.caminho !== pedido.caminho ||
      existente.resumo_corpo !== resumo
    ) {
      throw erroBase("idempotency.key_reused");
    }
    if (existente.estado === "em_curso" || existente.resposta_status === null) {
      throw erroBase("idempotency.in_progress");
    }
    const guardada = {
      status: existente.resposta_status,
      corpo: existente.resposta_corpo,
    };
    return { ...(opcoes.repetir?.(guardada) ?? guardada), repetida: true };
  }

  // 2. A escrita e a conclusão na mesma transacção.
  try {
    const feita = await comComerciante(db, comercianteId, async (trx) => {
      const escrita = await escrever(trx);
      const { rows } = await sql<{ chave: string }>`
        update idempotencia
        set estado = 'concluido', resposta_status = ${escrita.status},
            resposta_corpo = ${JSON.stringify(escrita.guardar)}::jsonb
        where comerciante_id = ${comercianteId}::uuid and chave = ${chave}
          and estado = 'em_curso' and resumo_corpo = ${resumo}
        returning chave`.execute(trx);
      // A linha foi substituída por outro pedido (órfã ao fim de 60 s): esta
      // escrita desfaz-se, para não haver duas.
      if (rows.length === 0) throw erroBase("idempotency.in_progress");
      return escrita;
    });
    return { ...feita, repetida: false };
  } catch (erro) {
    // 3. A escrita falhou: a chave fica livre para repetir.
    try {
      await comComerciante(db, comercianteId, (trx) =>
        sql`
          delete from idempotencia
          where comerciante_id = ${comercianteId}::uuid and chave = ${chave}
            and estado = 'em_curso' and resumo_corpo = ${resumo}`.execute(trx),
      );
    } catch (erroDaLimpeza) {
      // A linha órfã expira ao fim de 60 s; o erro do cliente é o da escrita.
      opcoes.aoFalharLimpeza?.(erroDaLimpeza);
    }
    throw erro;
  }
}
