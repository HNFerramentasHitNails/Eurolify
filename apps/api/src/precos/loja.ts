import type { Kysely } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { variantesVendaveis } from "../checkout/repositorio.js";
import {
  decidirIva,
  type Decisao,
  type EntradaDecisao,
} from "../iva/decisao.js";
import { carregarTabelas, comercianteParaDecisao } from "../iva/repositorio.js";
import { ErroPrecos } from "./erros.js";
import {
  pagina,
  precoPorUnidade,
  precosParaVenda,
  traduzir,
} from "./repositorio.js";

// A API da Loja de Preços e mercados (docs/20 §7.2 e §10.7; issue #481): os
// mercados onde a loja vende e o preço **a mostrar**. Nada se decide aqui que
// o checkout não decida: o preço vem de `precosParaVenda` (o mesmo caminho
// do carrinho e do resumo do checkout) e o IVA do Motor (`decidirIva`, com os
// mesmos parâmetros do resumo).

const naoExiste = (o: string) =>
  new ErroPrecos("prices.not_found", `${o} não existe`);

async function naLoja<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fn: Parameters<typeof comComerciante<T>>[2],
): Promise<T> {
  try {
    return await comComerciante(db, comercianteId, fn);
  } catch (erro) {
    throw traduzir(erro);
  }
}

// -------------------------------------------------------------- Mercados

/**
 * Os mercados **activos** da loja da chave (de um canal, se se der): para o
 * visitante escolher (R8). Um canal que não é da loja, ou que não está
 * activo, é o mesmo que não existir. Não mostra rascunhos nem arquivados.
 */
export async function mercadosDaLoja(
  db: Kysely<BaseDados>,
  comercianteId: string,
  lojaId: string,
  canalId: string | undefined,
  limite: number,
  depois: string | null,
) {
  return naLoja(db, comercianteId, async (trx) => {
    if (canalId !== undefined) {
      const canal = await trx
        .selectFrom("canal")
        .select("estado")
        .where("id", "=", canalId)
        .where("loja_id", "=", lojaId)
        .executeTakeFirst();
      if (canal?.estado !== "activo") throw naoExiste("o canal");
    }
    const base = () => {
      let q = trx
        .selectFrom("mercado")
        .where("mercado.loja_id", "=", lojaId)
        .where("mercado.estado", "=", "activo");
      if (canalId !== undefined) {
        q = q.where(
          "mercado.id",
          "in",
          trx
            .selectFrom("canal_mercado")
            .select("canal_mercado.mercado_id")
            .where("canal_mercado.canal_id", "=", canalId),
        );
      }
      return q;
    };
    return pagina(
      (d, n) => {
        let q = base().select([
          "mercado.id",
          "mercado.loja_id",
          "mercado.nome",
          "mercado.paises",
          "mercado.moeda",
          "mercado.linguas",
          "mercado.lingua_principal",
          "mercado.preco_inclui_iva",
        ]);
        if (d !== null) q = q.where("mercado.id", ">", d);
        return q.orderBy("mercado.id").limit(n).execute();
      },
      async () =>
        Number(
          (
            await base()
              .select((eb) => eb.fn.countAll<string>().as("n"))
              .executeTakeFirstOrThrow()
          ).n,
        ),
      limite,
      depois,
    );
  });
}

// ---------------------------------------------------------------- Preços

export interface IvaMostrado {
  /**
   * `tributada` ou `isenta` (decidido pelo Motor para `pais`), `bloqueada`
   * (o checkout também recusaria) ou `por_decidir` (sem `pais`).
   */
  resultado: "tributada" | "isenta" | "bloqueada" | "por_decidir";
  /** Centésimas de ponto (2300 = 23 %); vazio se não há decisão. */
  taxa: number | null;
  pais_imposto: string | null;
  /** Em `bloqueada`, o motivo do Motor; em `por_decidir`, `pais_em_falta`. */
  motivo: string | null;
}

export interface PrecoDaLoja {
  variante_id: string;
  /** O que a lista cobra (o da redução em vigor, se houver), no sentido do mercado. */
  montante: number;
  gratuito: boolean;
  /**
   * O preço final a mostrar, em cêntimos: o montante com o IVA do Motor para
   * o país dado. Nulo quando o IVA não se sabe (sem país num mercado sem
   * IVA no preço) ou o Motor bloqueia: nunca se mostra um preço que o
   * checkout não respeitaria.
   */
  preco_a_mostrar: number | null;
  iva: IvaMostrado;
  reducao: {
    /** O preço riscado: o mais baixo dos 30 dias anteriores (docs/20 §3.6). */
    preco_referencia: number;
    preco_referencia_a_mostrar: number | null;
    fim: Date | null;
  } | null;
  preco_por_unidade: {
    valor: string;
    unidade: string;
    inclui_iva: boolean;
  } | null;
  quantidade_minima: number;
  multiplo: number;
}

export interface PrecosDaLoja {
  mercado_id: string;
  moeda: string;
  preco_inclui_iva: boolean;
  pais: string | null;
  dados: PrecoDaLoja[];
  /** As variantes pedidas que não se vendem neste canal × mercado. */
  indisponiveis: string[];
}

const ivaDe = (d: Decisao): IvaMostrado =>
  d.resultado === "bloqueada"
    ? {
        resultado: "bloqueada",
        taxa: null,
        pais_imposto: null,
        motivo: d.motivo,
      }
    : {
        resultado: d.resultado,
        taxa: d.taxa,
        pais_imposto: d.pais_imposto,
        motivo: null,
      };

/**
 * O preço a mostrar destas variantes no canal × mercado da loja da chave, com
 * o IVA do Motor para o país de entrega, se vier (docs/20 §7.2, R1 e R8).
 * Só entram as variantes que o checkout deixaria vender (publicadas no par
 * canal × mercado, activas, com preço na lista de base); as outras vêm em
 * `indisponiveis`, sem dizer porquê (uma variante de outra loja é igual a uma
 * que não existe).
 */
export async function precosDaLoja(
  db: Kysely<BaseDados>,
  comercianteId: string,
  lojaId: string,
  dados: {
    canal: string;
    mercado: string;
    variantes: string[];
    pais?: string;
    codigo_postal?: string;
  },
  momento: Date = new Date(),
): Promise<PrecosDaLoja> {
  return naLoja(db, comercianteId, async (trx) => {
    // O mesmo conferido ao criar um carrinho: o par é da loja e está activo.
    const mercado = await trx
      .selectFrom("mercado")
      .innerJoin("canal_mercado", "canal_mercado.mercado_id", "mercado.id")
      .innerJoin("canal", "canal.id", "canal_mercado.canal_id")
      .innerJoin("loja", "loja.id", "mercado.loja_id")
      .select([
        "mercado.paises",
        "mercado.moeda",
        "mercado.preco_inclui_iva",
        "mercado.estado",
        "canal.estado as estado_canal",
        "loja.entidade_legal_id",
      ])
      .where("mercado.id", "=", dados.mercado)
      .where("canal.id", "=", dados.canal)
      .where("mercado.loja_id", "=", lojaId)
      .where("canal.loja_id", "=", lojaId)
      .executeTakeFirst();
    if (
      mercado === undefined ||
      mercado.estado !== "activo" ||
      mercado.estado_canal !== "activo"
    ) {
      throw naoExiste("o canal × mercado");
    }
    // O país de entrega muda o mercado no checkout; aqui não se adivinha.
    if (dados.pais !== undefined && !mercado.paises.includes(dados.pais)) {
      throw new ErroPrecos(
        "prices.country_not_in_market",
        "o país não é deste mercado: peça os preços do mercado desse país (GET /store/markets)",
      );
    }
    const vendaveis = await variantesVendaveis(
      trx,
      dados.canal,
      dados.mercado,
      dados.variantes,
    );
    const precos = await precosParaVenda(
      trx,
      comercianteId,
      dados.mercado,
      dados.variantes,
    );
    const tabelas = await carregarTabelas(trx);
    const comerciante = await comercianteParaDecisao(
      trx,
      comercianteId,
      mercado.entidade_legal_id,
    );
    const entrega: EntradaDecisao["entrega"] =
      dados.pais === undefined
        ? null
        : { pais: dados.pais, codigo_postal: dados.codigo_postal ?? null };
    // Os mesmos parâmetros do resumo do checkout (`calcularResumo`): bem, sem
    // perfil, finalidade «consumo» (a lista B2B e o profissional ficam para
    // quando o checkout tiver contas, docs/25 Q6).
    const decidir = (categoria: string, montante: number) =>
      decidirIva(tabelas, {
        momento,
        comerciante,
        linha: {
          categoria,
          natureza: "bem",
          local_prestacao: null,
          montante,
          moeda: mercado.moeda,
          preco_inclui_iva: mercado.preco_inclui_iva,
        },
        entrega,
        finalidade: "consumo",
        perfil: null,
      });
    /**
     * O IVA e o preço final de um montante. Sem país, só há preço se o do
     * mercado já inclui o IVA (é o que o cliente paga, salvo uma isenção que
     * só a morada decide e que só o baixa); senão, nulo.
     */
    const mostrar = (
      categoria: string,
      montante: number,
    ): { preco: number | null; iva: IvaMostrado } => {
      if (entrega === null) {
        return {
          preco: mercado.preco_inclui_iva ? montante : null,
          iva: {
            resultado: "por_decidir",
            taxa: null,
            pais_imposto: null,
            motivo: "pais_em_falta",
          },
        };
      }
      const d = decidir(categoria, montante);
      return {
        preco: d.resultado === "bloqueada" ? null : d.total,
        iva: ivaDe(d),
      };
    };

    const linhas: PrecoDaLoja[] = [];
    const indisponiveis: string[] = [];
    for (const id of dados.variantes) {
      const v = vendaveis.get(id);
      const p = precos.get(id);
      if (v === undefined || p === undefined) {
        indisponiveis.push(id);
        continue;
      }
      const m = mostrar(v.categoria_fiscal, p.montante);
      // O preço por unidade sai do preço final (docs/20 §3.7); sem preço
      // final, não se mostra um sem IVA.
      const unidade =
        m.preco === null
          ? null
          : precoPorUnidade(m.preco, p.conteudo_quantidade, p.conteudo_unidade);
      linhas.push({
        variante_id: id,
        montante: p.montante,
        gratuito: p.gratuito,
        preco_a_mostrar: m.preco,
        iva: m.iva,
        reducao:
          p.reducao === null
            ? null
            : {
                preco_referencia: p.reducao.preco_referencia,
                preco_referencia_a_mostrar: mostrar(
                  v.categoria_fiscal,
                  p.reducao.preco_referencia,
                ).preco,
                fim: p.reducao.fim,
              },
        preco_por_unidade:
          unidade === null ? null : { ...unidade, inclui_iva: true },
        quantidade_minima: p.quantidade_minima,
        multiplo: p.multiplo,
      });
    }
    return {
      mercado_id: dados.mercado,
      moeda: mercado.moeda,
      preco_inclui_iva: mercado.preco_inclui_iva,
      pais: dados.pais ?? null,
      dados: linhas,
      indisponiveis,
    };
  });
}
