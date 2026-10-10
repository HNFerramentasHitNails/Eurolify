import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { ErroCatalogo, noCatalogo } from "./erros.js";
import { gravarValores } from "./repositorio.js";

// A escrita das opções (docs/14 §7.1, «A escrita das opções»; docs/22 §21;
// issue #285). As regras (só num rascunho, nomes e valores únicos, as
// combinações) estão na base (0005); estas funções só as usam, pela ordem dos
// bloqueios da §3.3: a linha do artigo (KEY SHARE), depois a fila do artigo,
// e só então as linhas da opção. Com a fila tomada, a `versao` lida já não
// muda até ao fim da transacção.

/**
 * A opção, com a fila do artigo tomada e a `versao` conferida (nula: não
 * confere). Outro comerciante, ou uma opção apagada entretanto, é «não
 * existe».
 */
async function opcaoNaFila(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  opcaoId: string,
  versao: number | null,
): Promise<{ artigo_id: string; versao: number }> {
  const ler = () =>
    trx
      .selectFrom("opcao")
      .select(["artigo_id", "versao"])
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", opcaoId)
      .executeTakeFirst();
  const vista = await ler();
  if (vista === undefined) {
    throw new ErroCatalogo("catalog.not_found", `opção ${opcaoId}`);
  }
  await artigoNaFila(trx, comercianteId, vista.artigo_id, `opção ${opcaoId}`);
  const opcao = await ler();
  if (opcao === undefined) {
    throw new ErroCatalogo("catalog.not_found", `opção ${opcaoId}`);
  }
  if (versao !== null && opcao.versao !== versao) {
    throw new ErroCatalogo(
      "catalog.version_conflict",
      `opção ${opcaoId}: versão ${String(versao)} pedida, ${String(opcao.versao)} actual`,
    );
  }
  return opcao;
}

/** A linha do artigo (KEY SHARE) e a fila dele, pela ordem da §3.3. */
async function artigoNaFila(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  artigoId: string,
  oQue: string,
): Promise<string> {
  const artigo = await trx
    .selectFrom("artigo")
    .select("estado")
    .where("comerciante_id", "=", comercianteId)
    .where("id", "=", artigoId)
    .forKeyShare()
    .executeTakeFirst();
  if (artigo === undefined) {
    throw new ErroCatalogo("catalog.not_found", oQue);
  }
  await sql`select catalogo_fila_do_artigo(${comercianteId}::uuid, ${artigoId}::uuid)`.execute(
    trx,
  );
  return artigo.estado;
}

/** O valor da opção, ou «não existe» (também se for de outra opção). */
async function valorDaOpcao(
  trx: Transaction<BaseDados>,
  comercianteId: string,
  opcaoId: string,
  valorId: string,
): Promise<void> {
  const valor = await trx
    .selectFrom("valor_opcao")
    .select("id")
    .where("comerciante_id", "=", comercianteId)
    .where("opcao_id", "=", opcaoId)
    .where("id", "=", valorId)
    .executeTakeFirst();
  if (valor === undefined) {
    throw new ErroCatalogo("catalog.not_found", `valor ${valorId}`);
  }
}

/** Muda o nome da opção (só num rascunho: a base recusa fora dele). */
export async function mudarNomeDaOpcao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  opcaoId: string,
  nome: string,
  versao: number,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    await opcaoNaFila(trx, comercianteId, opcaoId, versao);
    await trx
      .updateTable("opcao")
      .set({ nome })
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", opcaoId)
      .execute();
  });
}

/** Muda o texto de um valor (só num rascunho); a versão da opção sobe. */
export async function mudarTextoDoValor(
  db: Kysely<BaseDados>,
  comercianteId: string,
  opcaoId: string,
  valorId: string,
  valor: string,
  versao: number,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    await opcaoNaFila(trx, comercianteId, opcaoId, versao);
    await valorDaOpcao(trx, comercianteId, opcaoId, valorId);
    await trx
      .updateTable("valor_opcao")
      .set({ valor })
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", valorId)
      .execute();
  });
}

/**
 * Apaga a opção (só num rascunho), com os valores e o valor dela em cada
 * variante; a base verifica no fim as combinações (duas variantes activas
 * iguais: `catalog.option_combination_duplicate`).
 */
export async function apagarOpcao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  opcaoId: string,
  versao: number,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    await opcaoNaFila(trx, comercianteId, opcaoId, versao);
    await trx
      .deleteFrom("opcao")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", opcaoId)
      .execute();
  });
}

/**
 * Apaga um valor (só num rascunho): as variantes que o tinham ficam sem valor
 * nessa opção (o rascunho pode ficar incompleto, §3.3).
 */
export async function apagarValor(
  db: Kysely<BaseDados>,
  comercianteId: string,
  opcaoId: string,
  valorId: string,
  versao: number,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    await opcaoNaFila(trx, comercianteId, opcaoId, versao);
    await valorDaOpcao(trx, comercianteId, opcaoId, valorId);
    await trx
      .deleteFrom("valor_opcao")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", valorId)
      .execute();
  });
}

/** A lista tem de ser exactamente a de agora, sem repetidos. */
function conferirOrdem(
  actuais: readonly string[],
  pedidos: readonly string[],
  oQue: string,
): void {
  const iguais =
    pedidos.length === actuais.length &&
    new Set(pedidos).size === pedidos.length &&
    pedidos.every((id) => actuais.includes(id));
  if (!iguais) {
    throw new ErroCatalogo(
      "catalog.order_mismatch",
      `${oQue}: a lista não é exactamente a de agora`,
    );
  }
}

/**
 * Põe as opções do artigo pela ordem dada (em qualquer estado, §3.3). A
 * lista tem de ter todas as opções de agora, uma vez cada.
 */
export async function ordenarOpcoes(
  db: Kysely<BaseDados>,
  comercianteId: string,
  artigoId: string,
  opcaoIds: readonly string[],
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    await artigoNaFila(trx, comercianteId, artigoId, `artigo ${artigoId}`);
    const actuais = await trx
      .selectFrom("opcao")
      .select("id")
      .where("comerciante_id", "=", comercianteId)
      .where("artigo_id", "=", artigoId)
      .execute();
    conferirOrdem(
      actuais.map((o) => o.id),
      opcaoIds,
      `opções do artigo ${artigoId}`,
    );
    for (const [posicao, id] of opcaoIds.entries()) {
      await trx
        .updateTable("opcao")
        .set({ posicao })
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", id)
        .where("posicao", "<>", posicao)
        .execute();
    }
  });
}

/**
 * Põe os valores da opção pela ordem dada (em qualquer estado), na `versao`
 * lida; a lista tem de ter todos os valores de agora, uma vez cada.
 */
export async function ordenarValores(
  db: Kysely<BaseDados>,
  comercianteId: string,
  opcaoId: string,
  valorIds: readonly string[],
  versao: number,
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    await opcaoNaFila(trx, comercianteId, opcaoId, versao);
    const actuais = await trx
      .selectFrom("valor_opcao")
      .select("id")
      .where("comerciante_id", "=", comercianteId)
      .where("opcao_id", "=", opcaoId)
      .execute();
    conferirOrdem(
      actuais.map((v) => v.id),
      valorIds,
      `valores da opção ${opcaoId}`,
    );
    for (const [posicao, id] of valorIds.entries()) {
      await trx
        .updateTable("valor_opcao")
        .set({ posicao })
        .where("comerciante_id", "=", comercianteId)
        .where("id", "=", id)
        .where("posicao", "<>", posicao)
        .execute();
    }
  });
}

/**
 * Dá à variante os valores (um por opção, ou menos), substituindo os que
 * tinha. Só num rascunho: depois de vendida, a variante não muda de
 * identidade (§3.3).
 */
export async function definirValoresNoRascunho(
  db: Kysely<BaseDados>,
  comercianteId: string,
  varianteId: string,
  valorIds: readonly string[],
): Promise<void> {
  await noCatalogo(db, comercianteId, async (trx) => {
    const variante = await trx
      .selectFrom("variante")
      .select("artigo_id")
      .where("comerciante_id", "=", comercianteId)
      .where("id", "=", varianteId)
      .executeTakeFirst();
    if (variante === undefined) {
      throw new ErroCatalogo("catalog.not_found", `variante ${varianteId}`);
    }
    const estado = await artigoNaFila(
      trx,
      comercianteId,
      variante.artigo_id,
      `variante ${varianteId}`,
    );
    if (estado !== "rascunho") {
      throw new ErroCatalogo(
        "catalog.not_draft",
        "os valores de uma variante só mudam num rascunho",
      );
    }
    await gravarValores(trx, comercianteId, varianteId, valorIds);
  });
}
