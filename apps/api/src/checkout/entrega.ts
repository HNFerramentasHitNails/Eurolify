import type { Transaction } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { codigoPostalLimpo, diaNoFuso } from "../iva/decisao.js";
import { folhas } from "../stock/repositorio.js";

// O que decide se um método de entrega serve uma encomenda (docs/36 R4;
// migração 0072): a zona da morada (L3), o peso, os perigosos (L9) e a conta
// da transportadora; e a data-limite que o cliente vê antes de comprar (L1,
// L4). Uma regra, um sítio: o resumo, a escolha do método e a lista do
// checkout perguntam aqui.

/** Porque é que um método não serve: o checkout mostra-o e não vende. */
export type MotivoNaoServe =
  | "zona_nao_servida"
  | "perigoso_recusado"
  | "peso_desconhecido"
  | "peso_excedido"
  | "conta_indisponivel";

/** O que o método de entrega diz sobre o que aceita (0072). */
export interface RegrasDoMetodo {
  conta_transportadora_id: string | null;
  codigos_postais: string[];
  aceita_onu: string[];
  peso_max_g: number | null;
  prazo_max_dias: number;
}

/** O que vai na caixa: o peso das folhas (um kit pelos componentes) e os ONU. */
export interface Conteudo {
  /** Em gramas; `null` se alguma folha não tem peso. */
  pesoG: number | null;
  onu: Set<string>;
}

/**
 * O conteúdo de um carrinho: cada linha pelas variantes-folha (um kit
 * expede-se pelos componentes, docs/27 §3.7), com o peso e o número ONU de
 * cada uma.
 */
export async function conteudoDe(
  trx: Transaction<BaseDados>,
  linhas: readonly { variante_id: string; quantidade: number }[],
): Promise<Conteudo> {
  const porFolha = new Map<string, number>();
  for (const l of linhas) {
    for (const [v, q] of await folhas(trx, l.variante_id, l.quantidade)) {
      porFolha.set(v, (porFolha.get(v) ?? 0) + q);
    }
  }
  if (porFolha.size === 0) return { pesoG: 0, onu: new Set() };
  const variantes = await trx
    .selectFrom("variante")
    .select(["id", "peso_g", "onu"])
    .where("id", "in", [...porFolha.keys()])
    .execute();
  let pesoG: number | null = 0;
  const onu = new Set<string>();
  for (const v of variantes) {
    const q = porFolha.get(v.id) ?? 0;
    pesoG = v.peso_g === null || pesoG === null ? null : pesoG + v.peso_g * q;
    if (v.onu !== null) onu.add(v.onu);
  }
  // Uma folha que não se leu (outro comerciante, apagada) não se pesa.
  if (variantes.length !== porFolha.size) pesoG = null;
  return { pesoG, onu };
}

/**
 * Porque é que o método não serve esta entrega e este conteúdo, ou `null`
 * se serve. Sem morada, a zona ainda não se sabe e não conta; com prefixos e
 * sem código postal, não serve (na dúvida, não vende).
 */
export function porQueNaoServe(
  m: RegrasDoMetodo,
  contaPronta: boolean,
  entrega: { codigo_postal: string | null } | null,
  conteudo: Conteudo,
): MotivoNaoServe | null {
  if (m.conta_transportadora_id !== null && !contaPronta) {
    return "conta_indisponivel";
  }
  if (entrega !== null && m.codigos_postais.length > 0) {
    const cp =
      entrega.codigo_postal === null
        ? ""
        : codigoPostalLimpo(entrega.codigo_postal);
    if (cp === "" || !m.codigos_postais.some((p) => cp.startsWith(p))) {
      return "zona_nao_servida";
    }
  }
  for (const u of conteudo.onu) {
    if (!m.aceita_onu.includes(u)) return "perigoso_recusado";
  }
  if (m.peso_max_g !== null) {
    if (conteudo.pesoG === null) return "peso_desconhecido";
    if (conteudo.pesoG > m.peso_max_g) return "peso_excedido";
  }
  return null;
}

/**
 * A data-limite de entrega (L1, L4): o dia, no fuso do comerciante, `dias`
 * depois do dia do botão final (em Portugal, o prazo conta do dia seguinte
 * à celebração: DL 24/2014, art. 19.º, n.º 1). AAAA-MM-DD.
 */
export function dataLimite(momento: Date, fuso: string, dias: number): string {
  const dia = diaNoFuso(momento, fuso);
  if (dia === null) throw new Error(`fuso desconhecido: ${fuso}`);
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** As regras dos métodos e se a conta de cada um está pronta. */
export async function regrasDosMetodos(
  trx: Transaction<BaseDados>,
  ids: readonly string[],
) {
  if (ids.length === 0)
    return new Map<string, RegrasDoMetodo & { contaPronta: boolean }>();
  const linhas = await trx
    .selectFrom("metodo_entrega")
    .leftJoin(
      "conta_transportadora",
      "conta_transportadora.id",
      "metodo_entrega.conta_transportadora_id",
    )
    .select([
      "metodo_entrega.id",
      "metodo_entrega.conta_transportadora_id",
      "metodo_entrega.codigos_postais",
      "metodo_entrega.aceita_onu",
      "metodo_entrega.peso_max_g",
      "metodo_entrega.prazo_max_dias",
      "conta_transportadora.estado as estado_conta",
    ])
    .where("metodo_entrega.id", "in", [...ids])
    .execute();
  return new Map(
    linhas.map((l) => [
      l.id,
      {
        conta_transportadora_id: l.conta_transportadora_id,
        codigos_postais: l.codigos_postais,
        aceita_onu: l.aceita_onu,
        peso_max_g: l.peso_max_g,
        prazo_max_dias: l.prazo_max_dias,
        contaPronta: l.estado_conta === "pronta",
      },
    ]),
  );
}
