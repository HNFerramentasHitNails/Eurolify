import { createHash, randomBytes } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type {
  BaseDados,
  FinalidadeCompra,
  TipoTextoLegal,
} from "../base/esquema.js";
import { TIPOS_TEXTO_LEGAL } from "../base/esquema.js";
import {
  criarCliente,
  criarPerfil,
  fichaPseudonimizada,
} from "../clientes/repositorio.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { decidirIva, type Decisao } from "../iva/decisao.js";
import { carregarTabelas, comercianteParaDecisao } from "../iva/repositorio.js";
import { precosParaVenda, type PrecoParaVenda } from "../precos/repositorio.js";
import { metodosDoMercado } from "../pagamentos/repositorio.js";
import { documentoDaEncomenda } from "../faturacao/repositorio.js";
import {
  armazemDaLoja,
  disponiveis,
  ErroStock,
  reservarEncomenda,
} from "../stock/repositorio.js";
import { ErroCheckout, type CodigoErroCheckout } from "./erros.js";
import {
  conteudoDe,
  dataLimite,
  porQueNaoServe,
  regrasDosMetodos,
  type MotivoNaoServe,
} from "./entrega.js";
import {
  type AdaptadorTransportadora,
  type ConfigEnvios,
  type CredenciaisTransportadora,
  type PontoRecolha,
} from "../envios/adaptador.js";
import { ErroEnvios } from "../envios/erros.js";
import {
  adaptadorDe,
  conferirServico,
  credenciaisDe,
} from "../envios/repositorio.js";
import { comTempo } from "../envios/etiquetas.js";

// O checkout (docs/25; migração 0041): o carrinho da API da Loja, a sessão
// do checkout alojado, o total (preço do mercado + IVA do Motor + portes),
// os textos legais e o botão final que cria a encomenda com a cópia de tudo.
// O checkout **não decide** preço nem IVA: pede-os aos domínios donos e
// guarda a cópia (docs/25, R1). Na dúvida, não vende.

export { ErroCheckout } from "./erros.js";

const CODIGOS_DA_BASE: readonly CodigoErroCheckout[] = [
  "cart.not_open",
  "cart.too_many_lines",
  "checkout.closed",
  "checkout.invalid_field",
  "legal.version_immutable",
  "orders.immutable",
  // A marca «selado por higiene» mudou entre o resumo e o botão (0065).
  "checkout.total_changed",
];

export function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error) || erro instanceof ErroCheckout) return erro;
  const nome = erro.name;
  // Os erros dos domínios que o checkout chama (Clientes, IVA): o pedido é
  // que está mal, com a mensagem deles.
  if (nome === "ErroClientes" || nome === "ErroIva") {
    const codigo = (erro as Error & { codigo?: string }).codigo ?? "";
    if (codigo.endsWith(".retry")) {
      return new ErroCheckout("checkout.retry", "tentar outra vez", undefined, {
        cause: erro,
      });
    }
    return new ErroCheckout(
      "checkout.invalid_field",
      `${codigo}: ${erro.message}`,
      undefined,
      { cause: erro },
    );
  }
  const codigo = CODIGOS_DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroCheckout(codigo, erro.message, undefined, { cause: erro });
  }
  const pg = erro as Error & { code?: string; constraint?: string };
  // Duas versões ao mesmo tempo: o número repetido é tentar outra vez
  // (revisão do #276, P3-1).
  if (pg.code === "23505" && /versao_texto_legal/.test(pg.constraint ?? "")) {
    return new ErroCheckout("checkout.retry", "tentar outra vez", undefined, {
      cause: erro,
    });
  }
  if (pg.code === "23505" && /texto_legal/.test(pg.constraint ?? "")) {
    return new ErroCheckout("legal.duplicate", "já existe", undefined, {
      cause: erro,
    });
  }
  if (
    pg.code === "23503" ||
    (pg.code === "22P02" && /uuid/.test(erro.message))
  ) {
    return new ErroCheckout("checkout.not_found", "não existe", undefined, {
      cause: erro,
    });
  }
  if (pg.code === "23514" || pg.code === "22001") {
    return new ErroCheckout(
      "checkout.invalid_field",
      "um valor do pedido não é aceite",
      undefined,
      { cause: erro },
    );
  }
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
    return new ErroCheckout("checkout.retry", "tentar outra vez", undefined, {
      cause: erro,
    });
  }
  return erro;
}

async function noCheckout<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
): Promise<T> {
  if (db.isTransaction) {
    const trx = db as Transaction<BaseDados>;
    try {
      const { rows } = await sql<{ c: string | null }>`
        select current_setting('eurolify.comerciante', true) as c`.execute(trx);
      if (rows[0]?.c !== comercianteId) {
        throw new Error(
          "noCheckout: a transacção aberta é de outro comerciante",
        );
      }
      return await fn(trx);
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

const resumoDe = (segredo: string) =>
  createHash("sha256").update(segredo).digest("hex");

/** 256 bits de acaso em base64url (como as chaves, docs/19 §3). */
const novoSegredo = () => randomBytes(32).toString("base64url");

const naoExiste = (o: string) =>
  new ErroCheckout("checkout.not_found", `${o} não existe`);

// ------------------------------------------------------------- Carrinho

export async function criarCarrinho(
  db: Kysely<BaseDados>,
  comercianteId: string,
  lojaId: string,
  dados: { canal: string; mercado: string; lingua: string },
): Promise<{ id: string; segredo: string }> {
  return noCheckout(db, comercianteId, async (trx) => {
    const mercado = await trx
      .selectFrom("mercado")
      .innerJoin("canal_mercado", "canal_mercado.mercado_id", "mercado.id")
      .innerJoin("canal", "canal.id", "canal_mercado.canal_id")
      .select([
        "mercado.linguas",
        "mercado.estado",
        "canal.estado as estado_canal",
      ])
      .where("mercado.id", "=", dados.mercado)
      .where("canal.id", "=", dados.canal)
      .where("mercado.loja_id", "=", lojaId)
      .where("canal.loja_id", "=", lojaId)
      .executeTakeFirst();
    // Um canal ou mercado de outra loja (ou que o canal não serve) é o mesmo
    // que não existir.
    if (mercado === undefined) throw naoExiste("o canal × mercado");
    if (mercado.estado !== "activo" || mercado.estado_canal !== "activo") {
      throw naoExiste("o canal × mercado");
    }
    if (!mercado.linguas.includes(dados.lingua)) {
      throw new ErroCheckout(
        "checkout.invalid_field",
        "checkout.invalid_field: a língua não é do mercado",
      );
    }
    const segredo = novoSegredo();
    const { id } = await trx
      .insertInto("carrinho")
      .values({
        comerciante_id: comercianteId,
        loja_id: lojaId,
        canal_id: dados.canal,
        mercado_id: dados.mercado,
        lingua: dados.lingua,
        segredo_resumo: resumoDe(segredo),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { id, segredo };
  });
}

/** O carrinho da loja da chave, com o segredo certo; senão, «não existe». */
async function carrinhoDe(
  trx: Transaction<BaseDados>,
  lojaId: string,
  id: string,
  segredo: string | undefined,
  bloquear = false,
) {
  let q = trx
    .selectFrom("carrinho")
    .selectAll()
    .select(sql<boolean>`expira_em < now()`.as("passou_prazo"))
    .where("id", "=", id)
    .where("loja_id", "=", lojaId);
  if (bloquear) q = q.forUpdate();
  const c = await q.executeTakeFirst();
  if (
    c === undefined ||
    segredo === undefined ||
    resumoDe(segredo) !== c.segredo_resumo
  ) {
    throw new ErroCheckout("cart.secret_invalid", "o carrinho não existe");
  }
  // Expirado conta-se pelo relógio; não se grava aqui (o erro desfaria a
  // escrita): a limpeza dos carrinhos é uma tarefa à parte (parte 2).
  if (c.estado !== "convertido" && c.passou_prazo) {
    throw new ErroCheckout(
      "cart.not_open",
      "cart.not_open: o carrinho expirou",
    );
  }
  return c;
}

/**
 * Mexer nas linhas reabre o carrinho: a sessão de checkout aberta passa a
 * abandonada (o cliente voltou à loja; docs/25 §4.2).
 */
async function abrirParaMexer(trx: Transaction<BaseDados>, carrinhoId: string) {
  await trx
    .updateTable("sessao_checkout")
    .set({ estado: "abandonada" })
    .where("carrinho_id", "=", carrinhoId)
    .where("estado", "=", "aberta")
    .execute();
  await trx
    .updateTable("carrinho")
    .set({ estado: "aberto", actualizado_em: new Date() })
    .where("id", "=", carrinhoId)
    .where("estado", "=", "em_checkout")
    .execute();
}

export interface LinhaDoCarrinho {
  id: string;
  variante_id: string;
  quantidade: number;
  preco: PrecoParaVenda | null;
}

export async function verCarrinho(
  db: Kysely<BaseDados>,
  comercianteId: string,
  lojaId: string,
  id: string,
  segredo: string | undefined,
) {
  return noCheckout(db, comercianteId, async (trx) => {
    const c = await carrinhoDe(trx, lojaId, id, segredo);
    const linhas = await trx
      .selectFrom("linha_carrinho")
      .select(["id", "variante_id", "quantidade"])
      .where("carrinho_id", "=", c.id)
      .orderBy("criada_em")
      .orderBy("id")
      .execute();
    const precos = await precosParaVenda(
      trx,
      comercianteId,
      c.mercado_id,
      linhas.map((l) => l.variante_id),
    );
    const mercado = await trx
      .selectFrom("mercado")
      .select(["moeda", "preco_inclui_iva"])
      .where("id", "=", c.mercado_id)
      .executeTakeFirstOrThrow();
    return {
      carrinho: c,
      moeda: mercado.moeda,
      preco_inclui_iva: mercado.preco_inclui_iva,
      linhas: linhas.map((l): LinhaDoCarrinho => ({
        ...l,
        preco: precos.get(l.variante_id) ?? null,
      })),
    };
  });
}

/** Confere que a variante se vende neste canal × mercado (§5, passo 1). */
async function conferirVendaveis(
  trx: Transaction<BaseDados>,
  canalId: string,
  mercadoId: string,
  varianteIds: string[],
): Promise<Map<string, VarianteVendavel>> {
  const vendaveis = await variantesVendaveis(
    trx,
    canalId,
    mercadoId,
    varianteIds,
  );
  const falta = varianteIds.filter((v) => !vendaveis.has(v));
  if (falta.length > 0) {
    throw new ErroCheckout(
      "checkout.variant_unavailable",
      "uma variante não está à venda neste mercado",
      { variantes: falta.map((v) => `var_${v}`) },
    );
  }
  return vendaveis;
}

function conferirQuantidade(quantidade: number, preco: PrecoParaVenda) {
  if (
    quantidade < preco.quantidade_minima ||
    quantidade % preco.multiplo !== 0
  ) {
    throw new ErroCheckout(
      "cart.min_quantity",
      `a quantidade tem de ser pelo menos ${String(preco.quantidade_minima)} e múltipla de ${String(preco.multiplo)}`,
      {
        variante: `var_${preco.variante_id}`,
        quantidade_minima: preco.quantidade_minima,
        multiplo: preco.multiplo,
      },
    );
  }
}

export async function porLinha(
  db: Kysely<BaseDados>,
  comercianteId: string,
  lojaId: string,
  id: string,
  segredo: string | undefined,
  dados: { variante: string; quantidade: number },
) {
  return noCheckout(db, comercianteId, async (trx) => {
    const c = await carrinhoDe(trx, lojaId, id, segredo, true);
    if (c.estado !== "aberto" && c.estado !== "em_checkout") {
      throw new ErroCheckout(
        "cart.not_open",
        `cart.not_open: o carrinho está ${c.estado}`,
      );
    }
    await conferirVendaveis(trx, c.canal_id, c.mercado_id, [dados.variante]);
    const preco = (
      await precosParaVenda(trx, comercianteId, c.mercado_id, [dados.variante])
    ).get(dados.variante);
    if (preco === undefined) {
      throw new ErroCheckout(
        "checkout.variant_unavailable",
        "a variante não tem preço neste mercado",
        { variantes: [`var_${dados.variante}`] },
      );
    }
    conferirQuantidade(dados.quantidade, preco);
    await abrirParaMexer(trx, c.id);
    const existente = await trx
      .selectFrom("linha_carrinho")
      .select("id")
      .where("carrinho_id", "=", c.id)
      .where("variante_id", "=", dados.variante)
      .executeTakeFirst();
    if (existente !== undefined) {
      await trx
        .updateTable("linha_carrinho")
        .set({ quantidade: dados.quantidade })
        .where("id", "=", existente.id)
        .execute();
      return existente.id;
    }
    const { id: linha } = await trx
      .insertInto("linha_carrinho")
      .values({
        comerciante_id: comercianteId,
        carrinho_id: c.id,
        variante_id: dados.variante,
        quantidade: dados.quantidade,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return linha;
  });
}

export async function tirarLinha(
  db: Kysely<BaseDados>,
  comercianteId: string,
  lojaId: string,
  id: string,
  segredo: string | undefined,
  linhaId: string,
) {
  return noCheckout(db, comercianteId, async (trx) => {
    const c = await carrinhoDe(trx, lojaId, id, segredo, true);
    if (c.estado !== "aberto" && c.estado !== "em_checkout") {
      throw new ErroCheckout(
        "cart.not_open",
        `cart.not_open: o carrinho está ${c.estado}`,
      );
    }
    await abrirParaMexer(trx, c.id);
    const r = await trx
      .deleteFrom("linha_carrinho")
      .where("id", "=", linhaId)
      .where("carrinho_id", "=", c.id)
      .executeTakeFirst();
    if (r.numDeletedRows === 0n) throw naoExiste("a linha");
  });
}

/** Abre o checkout alojado: congela o carrinho e devolve o token (uma vez). */
export async function iniciarCheckout(
  db: Kysely<BaseDados>,
  comercianteId: string,
  lojaId: string,
  id: string,
  segredo: string | undefined,
): Promise<{ sessao: string; token: string; expira_em: Date }> {
  return noCheckout(db, comercianteId, async (trx) => {
    const c = await carrinhoDe(trx, lojaId, id, segredo, true);
    if (c.estado !== "aberto" && c.estado !== "em_checkout") {
      throw new ErroCheckout(
        "cart.not_open",
        `cart.not_open: o carrinho está ${c.estado}`,
      );
    }
    const linhas = await trx
      .selectFrom("linha_carrinho")
      .select(["variante_id", "quantidade"])
      .where("carrinho_id", "=", c.id)
      .execute();
    if (linhas.length === 0) {
      throw new ErroCheckout("checkout.empty_cart", "o carrinho está vazio");
    }
    await conferirVendaveis(
      trx,
      c.canal_id,
      c.mercado_id,
      linhas.map((l) => l.variante_id),
    );
    // Uma sessão aberta por carrinho: a anterior fica abandonada.
    await trx
      .updateTable("sessao_checkout")
      .set({ estado: "abandonada" })
      .where("carrinho_id", "=", c.id)
      .where("estado", "=", "aberta")
      .execute();
    await trx
      .updateTable("carrinho")
      .set({ estado: "em_checkout", actualizado_em: new Date() })
      .where("id", "=", c.id)
      .execute();
    const token = novoSegredo();
    const s = await trx
      .insertInto("sessao_checkout")
      .values({
        comerciante_id: comercianteId,
        loja_id: lojaId,
        carrinho_id: c.id,
        mercado_id: c.mercado_id,
        lingua: c.lingua,
        token_resumo: resumoDe(token),
      })
      .returning(["id", "expira_em"])
      .executeTakeFirstOrThrow();
    return { sessao: s.id, token, expira_em: s.expira_em };
  });
}

// ------------------------------------------------- O que se pode vender

export interface VarianteVendavel {
  variante_id: string;
  sku: string;
  artigo_id: string;
  nome: string;
  categoria_fiscal: string;
  selado_por_higiene: boolean;
}

/**
 * As variantes à venda no canal × mercado: activas, de um artigo **físico**
 * com categoria fiscal, publicado nesse par e fora das `variantes_fora`.
 * Só artigos físicos nesta fatia: a natureza para o IVA ainda não está no
 * artigo (docs/24 §13), e um físico é um bem (docs/24 §3.2) — o resto não
 * se vende até ela existir (na dúvida, não vende; docs/25 §13).
 */
export async function variantesVendaveis(
  trx: Transaction<BaseDados>,
  canalId: string,
  mercadoId: string,
  varianteIds: string[],
): Promise<Map<string, VarianteVendavel>> {
  const mapa = new Map<string, VarianteVendavel>();
  if (varianteIds.length === 0) return mapa;
  const linhas = await trx
    .selectFrom("variante")
    .innerJoin("artigo", "artigo.id", "variante.artigo_id")
    .innerJoin("publicacao", (j) =>
      j
        .onRef("publicacao.artigo_id", "=", "artigo.id")
        .on("publicacao.canal_id", "=", canalId)
        .on("publicacao.mercado_id", "=", mercadoId)
        .on("publicacao.estado", "=", "publicado"),
    )
    .select([
      "variante.id",
      "variante.sku",
      "variante.estado",
      "artigo.id as artigo_id",
      "artigo.nome",
      "artigo.tipo",
      "artigo.estado as estado_artigo",
      "artigo.categoria_fiscal",
      "artigo.selado_por_higiene",
      "publicacao.variantes_fora",
    ])
    .where("variante.id", "in", varianteIds)
    .execute();
  for (const l of linhas) {
    if (
      l.estado !== "activa" ||
      l.estado_artigo !== "activo" ||
      l.tipo !== "fisico" ||
      l.categoria_fiscal === null ||
      l.variantes_fora.includes(l.id)
    ) {
      continue;
    }
    mapa.set(l.id, {
      variante_id: l.id,
      sku: l.sku,
      artigo_id: l.artigo_id,
      nome: l.nome,
      categoria_fiscal: l.categoria_fiscal,
      selado_por_higiene: l.selado_por_higiene,
    });
  }
  return mapa;
}

/** O nome do artigo na língua (a tradução, se houver e estiver em dia). */
async function nomesNaLingua(
  trx: Transaction<BaseDados>,
  lingua: string,
  vendaveis: Map<string, VarianteVendavel>,
): Promise<Map<string, string>> {
  const artigos = [...new Set([...vendaveis.values()].map((v) => v.artigo_id))];
  const traducoes =
    artigos.length === 0
      ? []
      : await trx
          .selectFrom("traducao")
          .select(["recurso_id", "texto", "original"])
          .where("recurso_id", "in", artigos)
          .where("campo", "=", "nome")
          .where("lingua", "=", lingua)
          .execute();
  const nomes = new Map<string, string>();
  for (const v of vendaveis.values()) {
    const t = traducoes.find(
      (x) => x.recurso_id === v.artigo_id && x.original === v.nome,
    );
    nomes.set(v.variante_id, t?.texto ?? v.nome);
  }
  return nomes;
}

// ---------------------------------------------------- A sessão (alojada)

export interface SessaoResolvida {
  id: string;
  comerciante_id: string;
}

/** Do token para a sessão, pela porta da base (sem RLS; 0041). */
export async function resolverSessao(
  db: Kysely<BaseDados>,
  token: string,
): Promise<SessaoResolvida> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw naoExiste("a sessão");
  const { rows } = await sql<SessaoResolvida>`
    select id, comerciante_id from checkout_resolver(${resumoDe(token)})`.execute(
    db,
  );
  const s = rows[0];
  if (s === undefined) throw naoExiste("a sessão");
  return s;
}

/**
 * Corre `fn` na sessão do token, no comerciante dela, com quem escreve
 * (`checkout:chk_…`). Uma sessão aberta expirada passa a expirada e o
 * carrinho reabre.
 */
/** Quanto tempo a confirmação se lê pelo token (proposta, **C**; revisão do #276, P2-2). */
export const DIAS_DA_CONFIRMACAO = 30;

export async function naSessao<T>(
  db: Kysely<BaseDados>,
  token: string,
  fn: (trx: Transaction<BaseDados>, sessao: SessaoLida) => Promise<T>,
  opcoes: { soAberta: boolean; alemDaConfirmacao?: boolean } = {
    soAberta: true,
  },
): Promise<T> {
  const r = await resolverSessao(db, token);
  const resultado = await noCheckout(db, r.comerciante_id, async (trx) => {
    await sql`select set_config('eurolify.quem', ${`checkout:chk_${r.id}`}, true)`.execute(
      trx,
    );
    // Primeiro o carrinho, depois a sessão: a mesma ordem das rotas do
    // carrinho, para dois pedidos ao mesmo tempo não se bloquearem um ao
    // outro (revisão do #276, P2-8).
    const ref = await trx
      .selectFrom("sessao_checkout")
      .select("carrinho_id")
      .where("id", "=", r.id)
      .executeTakeFirst();
    if (ref === undefined) throw naoExiste("a sessão");
    await trx
      .selectFrom("carrinho")
      .select("id")
      .where("id", "=", ref.carrinho_id)
      .forUpdate()
      .execute();
    // Os prazos contam-se no relógio da base (revisão do #276, P3-6).
    const s = await trx
      .selectFrom("sessao_checkout")
      .selectAll()
      .select([
        sql<boolean>`expira_em < now()`.as("passou_prazo"),
        sql<boolean>`concluida_em < now() - make_interval(days => ${DIAS_DA_CONFIRMACAO})`.as(
          "confirmacao_velha",
        ),
      ])
      .where("id", "=", r.id)
      .forUpdate()
      .executeTakeFirst();
    if (s === undefined) throw naoExiste("a sessão");
    if (s.estado === "aberta" && s.passou_prazo) {
      await trx
        .updateTable("sessao_checkout")
        .set({ estado: "expirada" })
        .where("id", "=", s.id)
        .execute();
      await trx
        .updateTable("carrinho")
        .set({ estado: "aberto", actualizado_em: new Date() })
        .where("id", "=", s.carrinho_id)
        .where("estado", "=", "em_checkout")
        .execute();
      return { expirou: true as const };
    }
    // Uma sessão concluída lê-se pelo token só durante o prazo da
    // confirmação: depois, os dados pessoais deixam de sair por ele (P2-2).
    // A livre resolução (docs/30 §7.1) passa o prazo: o direito conta da
    // entrega e não pode morrer com a ligação; essa rota não devolve dados
    // pessoais.
    if (
      s.estado === "concluida" &&
      s.confirmacao_velha &&
      opcoes.alemDaConfirmacao !== true
    ) {
      throw new ErroCheckout(
        "checkout.expired",
        "a confirmação já não se lê por esta ligação",
      );
    }
    if (opcoes.soAberta && s.estado !== "aberta") {
      throw new ErroCheckout(
        "checkout.closed",
        `checkout.closed: a sessão está ${s.estado}`,
      );
    }
    return {
      expirou: false as const,
      valor: await fn(trx, s as unknown as SessaoLida),
    };
  });
  // A expiração grava-se (a transacção acima fecha) e só depois se recusa.
  if (resultado.expirou) {
    throw new ErroCheckout("checkout.expired", "a sessão expirou");
  }
  return resultado.valor;
}

export interface Entrega {
  pais: string;
  codigo_postal: string;
  linha1: string;
  linha2: string | null;
  localidade: string;
  /**
   * Entrega num ponto de recolha (docs/36 §21): a morada acima é a do
   * ponto, nunca a de casa do cliente.
   */
  ponto?: { id: string; nome: string };
}

export interface Faturacao {
  tipo: "particular" | "empresa";
  nome_documento: string;
  nif: string | null;
  morada: Entrega | null;
  outra_pessoa: boolean;
}

export interface SessaoLida {
  id: string;
  comerciante_id: string;
  loja_id: string;
  carrinho_id: string;
  mercado_id: string;
  lingua: string;
  estado: string;
  expira_em: Date;
  email: string | null;
  nome: string | null;
  telefone: string | null;
  entrega: Entrega | null;
  finalidade: FinalidadeCompra;
  faturacao: Faturacao | null;
  metodo_entrega_id: string | null;
  metodo_pagamento: string | null;
  concluida_em: Date | null;
}

export async function porContacto(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  dados: { email: string; nome: string; telefone: string | null },
) {
  await trx
    .updateTable("sessao_checkout")
    .set({
      email: dados.email,
      nome: dados.nome,
      telefone: dados.telefone,
    })
    .where("id", "=", s.id)
    .execute();
}

/**
 * A morada de entrega. O país pode mudar o mercado (docs/20 R8): se não é
 * do mercado da sessão, vai para o mercado activo da loja que o tem e que o
 * canal serve; o método de entrega (do mercado antigo) sai.
 */
export async function porEntrega(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  entrega: Entrega,
) {
  const actual = await trx
    .selectFrom("mercado")
    .select(["paises"])
    .where("id", "=", s.mercado_id)
    .executeTakeFirstOrThrow();
  let mercado = s.mercado_id;
  if (!actual.paises.includes(entrega.pais)) {
    const carrinho = await trx
      .selectFrom("carrinho")
      .select("canal_id")
      .where("id", "=", s.carrinho_id)
      .executeTakeFirstOrThrow();
    // Um país está num só mercado activo da loja: a base garante-o
    // (prices.country_in_other_market, migração 0017).
    const outro = await trx
      .selectFrom("mercado")
      .innerJoin("canal_mercado", "canal_mercado.mercado_id", "mercado.id")
      .select(["mercado.id", "mercado.linguas"])
      .where("canal_mercado.canal_id", "=", carrinho.canal_id)
      .where("mercado.loja_id", "=", s.loja_id)
      .where("mercado.estado", "=", "activo")
      .where(sql<boolean>`${entrega.pais} = any(mercado.paises)`)
      .executeTakeFirst();
    if (outro === undefined || !outro.linguas.includes(s.lingua)) {
      throw new ErroCheckout(
        "checkout.country_not_served",
        "a loja não vende para este país",
      );
    }
    mercado = outro.id;
  }
  // Uma morada de casa tira o ponto de recolha: um método `ponto` já não
  // tem para onde entregar e sai (docs/36 §21).
  const metodoPonto =
    s.metodo_entrega_id !== null &&
    (await entregaDoMetodo(trx, s.metodo_entrega_id)) === "ponto";
  await trx
    .updateTable("sessao_checkout")
    .set({
      entrega: JSON.stringify(entrega),
      mercado_id: mercado,
      ...(mercado === s.mercado_id && !metodoPonto
        ? {}
        : { metodo_entrega_id: null }),
    })
    .where("id", "=", s.id)
    .execute();
}

/** Onde entrega um método: na morada ou num ponto (docs/36 §21). */
async function entregaDoMetodo(
  trx: Transaction<BaseDados>,
  metodoId: string,
): Promise<"morada" | "ponto" | null> {
  const m = await trx
    .selectFrom("metodo_entrega")
    .select("entrega")
    .where("id", "=", metodoId)
    .executeTakeFirst();
  return m?.entrega ?? null;
}

/**
 * A entrega que conta para a zona de um método (docs/36 R4, §21): num
 * método `ponto`, só a morada do ponto; a morada de casa não conta.
 */
const entregaParaZona = (
  entrega: Entrega | null,
  onde: "morada" | "ponto",
): Entrega | null =>
  onde === "ponto"
    ? entrega?.ponto === undefined
      ? null
      : entrega
    : entrega?.ponto === undefined
      ? entrega
      : null;

export async function porFaturacao(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  finalidade: FinalidadeCompra,
  faturacao: Faturacao,
) {
  // Comprar como profissional pede o NIF (ter NIF não faz profissional, mas
  // ser profissional pede NIF; consumer-rights-eu, docs/23 R1).
  if (
    finalidade !== "consumo" &&
    (faturacao.nif === null || faturacao.tipo !== "empresa")
  ) {
    throw new ErroCheckout(
      "checkout.invalid_field",
      "checkout.invalid_field: comprar como profissional pede uma empresa com NIF",
    );
  }
  await trx
    .updateTable("sessao_checkout")
    .set({
      finalidade,
      faturacao: JSON.stringify(faturacao),
    })
    .where("id", "=", s.id)
    .execute();
}

export async function porMetodoEntrega(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  metodoId: string,
) {
  const m = await trx
    .selectFrom("metodo_entrega")
    .select(["id", "entrega"])
    .where("id", "=", metodoId)
    .where("mercado_id", "=", s.mercado_id)
    .where("estado", "=", "activo")
    .executeTakeFirst();
  if (m === undefined) throw naoExiste("o método de entrega neste mercado");
  // Um método `ponto` escolhe-se com o ponto (PUT …/pickup-point).
  if (m.entrega === "ponto") {
    throw new ErroCheckout(
      "checkout.pickup_point_required",
      "este método entrega num ponto de recolha: escolha o ponto (PUT /checkout/{token}/pickup-point)",
    );
  }
  // Um método que não serve esta morada ou este conteúdo não se escolhe
  // (docs/36 R4); sem morada, a zona confere-se no resumo.
  const motivo = await porQueNaoServeASessao(trx, s, m.id);
  if (motivo !== null) {
    throw new ErroCheckout(
      "checkout.no_delivery_method",
      "este método de entrega não serve esta encomenda",
      { motivo },
    );
  }
  // A morada de um ponto não serve um método de morada: sai, e o resumo
  // pede a morada de casa (revisão do #439, P1-1).
  await trx
    .updateTable("sessao_checkout")
    .set({
      metodo_entrega_id: m.id,
      ...(s.entrega?.ponto === undefined ? {} : { entrega: null }),
    })
    .where("id", "=", s.id)
    .execute();
}

/** As linhas do carrinho da sessão (variante e quantidade). */
const linhasDaSessao = (trx: Transaction<BaseDados>, s: SessaoLida) =>
  trx
    .selectFrom("linha_carrinho")
    .select(["variante_id", "quantidade"])
    .where("carrinho_id", "=", s.carrinho_id)
    .execute();

async function porQueNaoServeASessao(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  metodoId: string,
): Promise<MotivoNaoServe | null> {
  const regras = (await regrasDosMetodos(trx, [metodoId])).get(metodoId);
  if (regras === undefined) return null;
  return porQueNaoServe(
    regras,
    regras.contaPronta,
    entregaParaZona(s.entrega, regras.entrega),
    await conteudoDe(trx, await linhasDaSessao(trx, s)),
  );
}

/**
 * Os métodos de entrega do mercado da sessão, para o cliente escolher
 * (docs/36 §7.3): os que servem e os que não servem, com o porquê (as
 * restrições dizem-se antes da encomenda, L3) e a data-limite se encomendar
 * agora (L1).
 */
export async function metodosDaSessao(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  momento: Date = new Date(),
) {
  const metodos = await trx
    .selectFrom("metodo_entrega")
    .select([
      "id",
      "nome",
      "prazo",
      "tarifa",
      "gratis_a_partir_de",
      "pede_telefone",
      "codigos_postais",
    ])
    .where("mercado_id", "=", s.mercado_id)
    .where("estado", "=", "activo")
    .orderBy("criado_em")
    .orderBy("id")
    .execute();
  const regras = await regrasDosMetodos(
    trx,
    metodos.map((m) => m.id),
  );
  const conteudo = await conteudoDe(trx, await linhasDaSessao(trx, s));
  const { fuso } = await trx
    .selectFrom("comerciante")
    .select("fuso")
    .where("id", "=", s.comerciante_id)
    .executeTakeFirstOrThrow();
  return metodos.map((m) => {
    const r = regras.get(m.id);
    const motivo =
      r === undefined
        ? null
        : porQueNaoServe(
            r,
            r.contaPronta,
            entregaParaZona(s.entrega, r.entrega),
            conteudo,
          );
    return {
      id: m.id,
      // Onde entrega (docs/36 §21): num `ponto`, o cliente procura e
      // escolhe o ponto (GET …/pickup-points, PUT …/pickup-point).
      entrega: r?.entrega ?? "morada",
      nome: m.nome,
      prazo: m.prazo,
      tarifa: Number(m.tarifa),
      gratis_a_partir_de:
        m.gratis_a_partir_de === null ? null : Number(m.gratis_a_partir_de),
      pede_telefone: m.pede_telefone,
      codigos_postais: m.codigos_postais,
      data_limite: dataLimite(momento, fuso, r?.prazo_max_dias ?? 30),
      escolhido: s.metodo_entrega_id === m.id,
      serve: motivo === null,
      motivo,
    };
  });
}

// ------------------------------------------ Pontos de recolha (docs/36 §21)

/** No máximo, procuras de pontos numa sessão (§21.3). */
export const MAX_PROCURAS_PONTOS = 20;
/** Pontos por procura (§21.3). */
export const PONTOS_POR_PROCURA = 10;

/** O que uma procura de pontos precisa, lido na transacção da sessão. */
export interface ProcuraDePontos {
  metodo: string;
  servico: string;
  adaptador: AdaptadorTransportadora;
  credenciais: CredenciaisTransportadora;
  codigos_postais: string[];
}

const pontoIndisponivel = (pormenor?: unknown) =>
  new ErroCheckout(
    "checkout.no_delivery_method",
    "este método de entrega não está disponível",
    pormenor ?? { motivo: "indisponivel" },
  );

/**
 * Prepara uma procura (ou a releitura) de pontos de um método `ponto` do
 * mercado da sessão, para um país do mercado, e conta-a (no máximo
 * {@link MAX_PROCURAS_PONTOS}). Corre na transacção da sessão; a chamada à
 * transportadora fica fora dela.
 */
export async function prepararProcuraDePontos(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  metodoId: string,
  pais: string,
  cfg: ConfigEnvios | undefined,
): Promise<ProcuraDePontos> {
  const m = await trx
    .selectFrom("metodo_entrega")
    .leftJoin(
      "conta_transportadora",
      "conta_transportadora.id",
      "metodo_entrega.conta_transportadora_id",
    )
    .select([
      "metodo_entrega.id",
      "metodo_entrega.entrega",
      "metodo_entrega.servico",
      "metodo_entrega.codigos_postais",
      "conta_transportadora.id as conta_id",
      "conta_transportadora.transportadora",
      "conta_transportadora.credenciais_cifra",
      "conta_transportadora.chave_versao",
    ])
    .where("metodo_entrega.id", "=", metodoId)
    .where("metodo_entrega.mercado_id", "=", s.mercado_id)
    .where("metodo_entrega.estado", "=", "activo")
    .executeTakeFirst();
  if (m === undefined) throw naoExiste("o método de entrega neste mercado");
  if (m.entrega !== "ponto") {
    throw new ErroCheckout(
      "checkout.invalid_field",
      "checkout.invalid_field: este método entrega na morada, não num ponto",
    );
  }
  const { paises } = await trx
    .selectFrom("mercado")
    .select("paises")
    .where("id", "=", s.mercado_id)
    .executeTakeFirstOrThrow();
  if (!paises.includes(pais)) {
    throw new ErroCheckout(
      "checkout.country_not_served",
      "o ponto tem de ser num país do mercado da sessão",
    );
  }
  // O conteúdo tem de caber no método (peso, perigosos, conta); a zona
  // confere-se pelo ponto (R4).
  const motivo = await porQueNaoServeASessao(trx, s, m.id);
  if (motivo !== null && motivo !== "zona_nao_servida") {
    throw pontoIndisponivel({
      motivo:
        motivo === "conta_indisponivel" || motivo === "peso_desconhecido"
          ? "indisponivel"
          : motivo,
    });
  }
  const contada = await trx
    .updateTable("sessao_checkout")
    .set((eb) => ({ procuras_pontos: eb("procuras_pontos", "+", 1) }))
    .where("id", "=", s.id)
    .where("procuras_pontos", "<", MAX_PROCURAS_PONTOS)
    .returning("procuras_pontos")
    .executeTakeFirst();
  if (contada === undefined) {
    throw new ErroCheckout(
      "checkout.too_many_searches",
      `no máximo ${String(MAX_PROCURAS_PONTOS)} procuras de pontos por sessão`,
    );
  }
  if (m.conta_id === null || m.transportadora === null || m.servico === null) {
    throw pontoIndisponivel();
  }
  try {
    const { adaptador, chave } = adaptadorDe(cfg, m.transportadora);
    if (
      adaptador.procurarPontos === undefined ||
      adaptador.pontoDisponivel === undefined
    ) {
      throw pontoIndisponivel();
    }
    return {
      metodo: m.id,
      servico: m.servico,
      adaptador,
      credenciais: credenciaisDe(
        {
          id: m.conta_id,
          credenciais_cifra: m.credenciais_cifra,
          chave_versao: m.chave_versao,
        },
        chave,
      ),
      codigos_postais: m.codigos_postais,
    };
  } catch (erro) {
    // A conta ou o servidor sem envios: o cliente vê «indisponível».
    if (erro instanceof ErroEnvios) throw pontoIndisponivel();
    throw erro;
  }
}

/**
 * Os pontos de recolha perto de um código postal (§21.3): só os do país e
 * da zona do método. Fora de qualquer transacção.
 */
export async function procurarPontos(
  p: ProcuraDePontos,
  pais: string,
  codigoPostal: string,
  cfg: ConfigEnvios | undefined,
): Promise<PontoRecolha[]> {
  if (p.adaptador.procurarPontos === undefined) throw pontoIndisponivel();
  let pontos: PontoRecolha[];
  try {
    pontos = await comTempo(
      cfg,
      p.adaptador.procurarPontos(p.credenciais, {
        servico: p.servico,
        pais,
        codigoPostal,
        limite: PONTOS_POR_PROCURA,
      }),
    );
  } catch (erro) {
    throw new ErroCheckout(
      "checkout.carrier_unavailable",
      "a transportadora não respondeu: tente outra vez",
      undefined,
      { cause: erro },
    );
  }
  return pontos
    .filter(
      (x) =>
        x.pais === pais &&
        porQueNaoServe(
          {
            conta_transportadora_id: null,
            codigos_postais: p.codigos_postais,
            aceita_onu: [],
            peso_max_g: null,
            prazo_max_dias: 30,
            entrega: "ponto",
          },
          true,
          { codigo_postal: x.codigo_postal },
          { pesoG: 0, onu: new Set() },
        ) === null,
    )
    .slice(0, PONTOS_POR_PROCURA);
}

/**
 * O ponto escolhido (§21.3): o método `ponto` e a morada do ponto como a
 * transportadora a devolveu, nunca a que o navegador mandou. A morada de
 * casa, se a havia, sai.
 */
export async function porPonto(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  metodoId: string,
  ponto: PontoRecolha,
) {
  const m = await trx
    .selectFrom("metodo_entrega")
    .select(["id", "entrega"])
    .where("id", "=", metodoId)
    .where("mercado_id", "=", s.mercado_id)
    .where("estado", "=", "activo")
    .executeTakeFirst();
  if (m === undefined || m.entrega !== "ponto") {
    throw naoExiste("o método de entrega neste mercado");
  }
  const { paises } = await trx
    .selectFrom("mercado")
    .select("paises")
    .where("id", "=", s.mercado_id)
    .executeTakeFirstOrThrow();
  if (!paises.includes(ponto.pais)) {
    throw new ErroCheckout(
      "checkout.country_not_served",
      "o ponto tem de ser num país do mercado da sessão",
    );
  }
  const entrega: Entrega = {
    pais: ponto.pais,
    codigo_postal: ponto.codigo_postal,
    linha1: ponto.linha1,
    linha2: null,
    localidade: ponto.localidade,
    ponto: { id: ponto.id, nome: ponto.nome },
  };
  const motivo = await porQueNaoServeASessao(trx, { ...s, entrega }, m.id);
  if (motivo === "zona_nao_servida") {
    throw new ErroCheckout(
      "checkout.pickup_point_outside_zone",
      "o ponto fica fora das regiões que este método serve",
    );
  }
  if (motivo !== null) {
    throw pontoIndisponivel({
      motivo:
        motivo === "conta_indisponivel" || motivo === "peso_desconhecido"
          ? "indisponivel"
          : motivo,
    });
  }
  await trx
    .updateTable("sessao_checkout")
    .set({ entrega: JSON.stringify(entrega), metodo_entrega_id: m.id })
    .where("id", "=", s.id)
    .execute();
}

/**
 * O ponto da sessão a conferir antes do botão final (§21.3), ou `null` se
 * a entrega não é num ponto. Na transacção da sessão; a chamada fica fora.
 */
export async function pontoAConferir(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  cfg: ConfigEnvios | undefined,
): Promise<{
  ponto: string;
  adaptador: AdaptadorTransportadora;
  credenciais: CredenciaisTransportadora;
} | null> {
  if (s.estado !== "aberta" || s.metodo_entrega_id === null) return null;
  const m = await trx
    .selectFrom("metodo_entrega")
    .innerJoin(
      "conta_transportadora",
      "conta_transportadora.id",
      "metodo_entrega.conta_transportadora_id",
    )
    .select([
      "metodo_entrega.entrega",
      "conta_transportadora.id as conta_id",
      "conta_transportadora.transportadora",
      "conta_transportadora.credenciais_cifra",
      "conta_transportadora.chave_versao",
    ])
    .where("metodo_entrega.id", "=", s.metodo_entrega_id)
    .executeTakeFirst();
  if (m === undefined || m.entrega !== "ponto") return null;
  // Sem ponto, o resumo diz o que falta (`ponto_recolha`).
  if (s.entrega?.ponto === undefined) return null;
  try {
    const { adaptador, chave } = adaptadorDe(cfg, m.transportadora);
    return {
      ponto: s.entrega.ponto.id,
      adaptador,
      credenciais: credenciaisDe(
        {
          id: m.conta_id,
          credenciais_cifra: m.credenciais_cifra,
          chave_versao: m.chave_versao,
        },
        chave,
      ),
    };
  } catch (erro) {
    if (erro instanceof ErroEnvios) throw pontoIndisponivel();
    throw erro;
  }
}

/**
 * O ponto ainda recebe encomendas? Fora de qualquer transacção. Um «não»,
 * ou a transportadora sem resposta, bloqueia o botão final: na dúvida,
 * não vende (R4).
 */
export async function conferirPonto(
  p: NonNullable<Awaited<ReturnType<typeof pontoAConferir>>>,
  cfg: ConfigEnvios | undefined,
) {
  let disponivel = false;
  if (p.adaptador.pontoDisponivel !== undefined) {
    try {
      disponivel = await comTempo(
        cfg,
        p.adaptador.pontoDisponivel(p.credenciais, p.ponto),
      );
    } catch (erro) {
      // Sem resposta (ErroDeRede) ou recusada: não se sabe se o ponto recebe.
      throw new ErroCheckout(
        "checkout.pickup_point_unavailable",
        "não foi possível confirmar o ponto de recolha: escolha-o outra vez ou tente mais tarde",
        undefined,
        { cause: erro },
      );
    }
  }
  if (!disponivel) {
    throw new ErroCheckout(
      "checkout.pickup_point_unavailable",
      "o ponto de recolha já não recebe encomendas: escolha outro",
    );
  }
}

export async function porMetodoPagamento(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  metodo: string,
) {
  // Só um método da régua do mercado, com a conta pronta (docs/26 §3.2).
  const disponiveis = await metodosDoMercado(trx, s.mercado_id);
  if (!disponiveis.some((m) => m.metodo === metodo)) {
    throw new ErroCheckout(
      "checkout.payment_unavailable",
      "este método de pagamento não está disponível neste mercado",
      { metodos: disponiveis.map((m) => m.metodo) },
    );
  }
  await trx
    .updateTable("sessao_checkout")
    .set({ metodo_pagamento: metodo })
    .where("id", "=", s.id)
    .execute();
}

// ------------------------------------------------------------ O resumo

/** Os textos que se aceitam antes do botão final, por tipo de cliente (proposta). */
export const TEXTOS_OBRIGATORIOS: Record<
  "consumidor" | "profissional",
  readonly TipoTextoLegal[]
> = {
  consumidor: TIPOS_TEXTO_LEGAL,
  profissional: ["condicoes_gerais", "privacidade"],
};

/**
 * O texto do botão final por língua. **C**: confirmar com o jurista
 * (consumer-rights-eu, «Na compra»; docs/25, J2). Sem texto para a língua,
 * não há botão.
 */
export const TEXTO_DO_BOTAO: Readonly<Record<string, string>> = {
  pt: "Encomendar com obrigação de pagar",
  en: "Order with obligation to pay",
};

export interface LinhaDoResumo {
  variante_id: string;
  sku: string;
  nome: string;
  quantidade: number;
  preco_unitario: number;
  preco: {
    lista_id: string;
    montante_lista: number;
    reducao: PrecoParaVenda["reducao"];
    preco_por_unidade: PrecoParaVenda["preco_por_unidade"];
  };
  decisao: Decisao;
  base: number;
  iva: number;
  total: number;
  /**
   * Aberto depois da entrega, perde-se a livre resolução (docs/30 §15, H3):
   * o que o cliente vê é o que fica na encomenda (H2).
   */
  selado_por_higiene: boolean;
}

export interface Resumo {
  moeda: string;
  preco_inclui_iva: boolean;
  linhas: LinhaDoResumo[];
  portes: {
    metodo_id: string;
    nome: Record<string, string>;
    /** A data-limite de entrega se encomendar agora (docs/36 L1), AAAA-MM-DD. */
    data_limite: string;
    /** O ponto de recolha escolhido, num método `ponto` (docs/36 §21). */
    ponto: { id: string; nome: string } | null;
    tarifa: number;
    decisao: Decisao;
    base: number;
    iva: number;
    total: number;
  } | null;
  totais: { base: number; iva: number; total: number };
  textos: {
    tipo: TipoTextoLegal;
    versao_id: string;
    numero: number;
    validado_por_jurista: boolean;
    resumo_texto: string;
  }[];
  /** O que falta para o botão final (contacto, entrega, …). */
  em_falta: string[];
  /** O que impede o botão final (IVA bloqueado, textos em falta). */
  bloqueios: { onde: string; motivo: string }[];
  botao: string | null;
  entidade_legal_id: string;
  canal_id: string;
}

const montanteDe = (d: Decisao) =>
  d.resultado === "bloqueada"
    ? { base: 0, iva: 0, total: 0 }
    : { base: d.base, iva: d.iva, total: d.total };

/**
 * O resumo da sessão: o preço de cada linha (Preços), o IVA de cada linha e
 * dos portes (Motor de IVA), os portes (método de entrega), os textos legais
 * a aceitar. Não grava nada.
 */
export async function calcularResumo(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  momento: Date = new Date(),
): Promise<Resumo> {
  const c = s.comerciante_id;
  const carrinho = await trx
    .selectFrom("carrinho")
    .innerJoin("loja", "loja.id", "carrinho.loja_id")
    .select(["carrinho.canal_id", "loja.entidade_legal_id"])
    .where("carrinho.id", "=", s.carrinho_id)
    .executeTakeFirstOrThrow();
  const mercado = await trx
    .selectFrom("mercado")
    .select(["moeda", "preco_inclui_iva"])
    .where("id", "=", s.mercado_id)
    .executeTakeFirstOrThrow();
  const pedidas = await trx
    .selectFrom("linha_carrinho")
    .select(["variante_id", "quantidade"])
    .where("carrinho_id", "=", s.carrinho_id)
    .orderBy("criada_em")
    .orderBy("id")
    .execute();
  if (pedidas.length === 0) {
    throw new ErroCheckout("checkout.empty_cart", "o carrinho está vazio");
  }
  const ids = pedidas.map((l) => l.variante_id);
  const vendaveis = await conferirVendaveis(
    trx,
    carrinho.canal_id,
    s.mercado_id,
    ids,
  );
  const precos = await precosParaVenda(trx, c, s.mercado_id, ids);
  const nomes = await nomesNaLingua(trx, s.lingua, vendaveis);
  const tabelas = await carregarTabelas(trx);
  const comerciante = await comercianteParaDecisao(
    trx,
    c,
    carrinho.entidade_legal_id,
  );

  const em_falta: string[] = [];
  const onde =
    s.metodo_entrega_id === null
      ? null
      : await entregaDoMetodo(trx, s.metodo_entrega_id);
  if (s.email === null || s.nome === null) em_falta.push("contacto");
  // Num método `ponto`, a entrega é o ponto escolhido (docs/36 §21).
  if (onde === "ponto") {
    if (s.entrega?.ponto === undefined) em_falta.push("ponto_recolha");
  } else if (s.entrega === null || s.entrega.ponto !== undefined) {
    // Um método de morada com a morada de um ponto (o comerciante mudou o
    // método, ou outro separador): falta a morada (revisão do #439, P1-1).
    em_falta.push("entrega");
  }
  if (s.faturacao === null) em_falta.push("faturacao");
  // A morada do ponto nunca é a morada fiscal: com NIF, o documento pede a
  // morada do cliente (o Moloni recusa um cliente com NIF sem ela), e numa
  // entrega num ponto ela não vem da entrega (docs/36 §21).
  if (
    s.entrega?.ponto !== undefined &&
    s.faturacao !== null &&
    s.faturacao.nif !== null &&
    s.faturacao.morada === null
  ) {
    em_falta.push("morada_faturacao");
  }
  if (s.metodo_entrega_id === null) em_falta.push("metodo_entrega");
  if (s.metodo_pagamento === null) em_falta.push("metodo_pagamento");
  // Um método de entrega que pede telefone (revisão do #276, P3-5).
  if (s.metodo_entrega_id !== null && s.telefone === null) {
    const m = await trx
      .selectFrom("metodo_entrega")
      .select("pede_telefone")
      .where("id", "=", s.metodo_entrega_id)
      .executeTakeFirst();
    if (m?.pede_telefone === true) em_falta.push("telefone");
  }
  // O MB WAY pede a aprovação no telemóvel (docs/26 §7).
  if (
    s.metodo_pagamento === "mb_way" &&
    s.telefone === null &&
    !em_falta.includes("telefone")
  ) {
    em_falta.push("telefone");
  }
  const bloqueios: Resumo["bloqueios"] = [];
  // Vende-se o disponível, nunca o físico (docs/27 R2): uma linha sem stock
  // bloqueia o botão final; um kit pelo disponível dos componentes (R4).
  {
    const armazem = await armazemDaLoja(trx, s.loja_id);
    const porVariante = new Map<string, number>();
    for (const p of pedidas) {
      porVariante.set(
        p.variante_id,
        (porVariante.get(p.variante_id) ?? 0) + p.quantidade,
      );
    }
    const disp = await disponiveis(trx, armazem, [...porVariante.keys()]);
    for (const [v, q] of porVariante) {
      const d = disp.get(v);
      if (d !== null && d !== undefined && d < q) {
        bloqueios.push({ onde: `stock:var_${v}`, motivo: "sem_stock" });
      }
    }
  }
  // O método escolhido tem de continuar na régua do mercado (a régua pode ter
  // mudado, ou a morada mudou o mercado; docs/26 §3.2).
  if (s.metodo_pagamento !== null) {
    const disponiveis = await metodosDoMercado(trx, s.mercado_id);
    if (!disponiveis.some((m) => m.metodo === s.metodo_pagamento)) {
      bloqueios.push({ onde: "pagamento", motivo: "metodo_indisponivel" });
    } else if (
      s.metodo_pagamento === "mb_way" &&
      s.telefone !== null &&
      !/^\+351[0-9]{9}$/.test(s.telefone)
    ) {
      bloqueios.push({
        onde: "pagamento",
        motivo: "mb_way_telefone_portugues",
      });
    }
  }

  // O cliente do checkout sem conta não tem perfil guardado: o Motor decide
  // sem perfil (sem VIES nem isenção manual; docs/25 Q6). Um profissional de
  // outro país da UE fica bloqueado (b2b_sem_vies) e pode comprar como
  // consumidor.
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
      entrega:
        s.entrega === null
          ? null
          : { pais: s.entrega.pais, codigo_postal: s.entrega.codigo_postal },
      finalidade: s.finalidade,
      perfil: null,
    });

  const linhas: LinhaDoResumo[] = [];
  for (const p of pedidas) {
    const v = vendaveis.get(p.variante_id);
    const preco = precos.get(p.variante_id);
    if (v === undefined || preco === undefined) {
      throw new ErroCheckout(
        "checkout.variant_unavailable",
        "uma variante não tem preço neste mercado",
        { variantes: [`var_${p.variante_id}`] },
      );
    }
    conferirQuantidade(p.quantidade, preco);
    const decisao = decidir(v.categoria_fiscal, preco.montante * p.quantidade);
    if (decisao.resultado === "bloqueada" && s.entrega !== null) {
      bloqueios.push({ onde: `var_${p.variante_id}`, motivo: decisao.motivo });
    }
    linhas.push({
      variante_id: p.variante_id,
      sku: v.sku,
      nome: nomes.get(p.variante_id) ?? v.nome,
      quantidade: p.quantidade,
      preco_unitario: preco.montante,
      preco: {
        lista_id: preco.lista_id,
        montante_lista: preco.montante_lista,
        reducao: preco.reducao,
        preco_por_unidade: preco.preco_por_unidade,
      },
      decisao,
      ...montanteDe(decisao),
      selado_por_higiene: v.selado_por_higiene,
    });
  }

  let portes: Resumo["portes"] = null;
  if (s.metodo_entrega_id !== null) {
    const m = await trx
      .selectFrom("metodo_entrega")
      .select(["id", "nome", "tarifa", "gratis_a_partir_de", "estado"])
      .where("id", "=", s.metodo_entrega_id)
      .where("mercado_id", "=", s.mercado_id)
      .executeTakeFirst();
    if (m === undefined || m.estado !== "activo") {
      throw new ErroCheckout(
        "checkout.no_delivery_method",
        "o método de entrega já não existe neste mercado",
      );
    }
    // Grátis a partir de um valor: conta o total das linhas, como o cliente
    // o vê (com IVA num mercado com IVA). Proposta.
    const subtotal = linhas.reduce(
      (t, l) => t + l.preco_unitario * l.quantidade,
      0,
    );
    const gratis =
      m.gratis_a_partir_de !== null && subtotal >= Number(m.gratis_a_partir_de);
    const tarifa = gratis ? 0 : Number(m.tarifa);
    // O IVA dos portes: a categoria das linhas, quando é uma só. Com
    // categorias diferentes, a taxa dos portes é a V12 do contabilista: na
    // dúvida, não vende (revisão do #276, P2-5).
    const categorias = [
      ...new Set(
        pedidas.map((p) => vendaveis.get(p.variante_id)?.categoria_fiscal),
      ),
    ];
    const categoriaDosPortes =
      categorias.length === 1 ? categorias[0] : undefined;
    if (categoriaDosPortes === undefined) {
      bloqueios.push({
        onde: "portes",
        motivo: "portes_categorias_misturadas",
      });
    }
    const decisao = decidir(categoriaDosPortes ?? "normal", tarifa);
    if (decisao.resultado === "bloqueada" && s.entrega !== null) {
      bloqueios.push({ onde: "portes", motivo: decisao.motivo });
    }
    // O método tem de servir esta morada e este conteúdo (docs/36 R4).
    const regras = (await regrasDosMetodos(trx, [m.id])).get(m.id);
    if (regras !== undefined) {
      const motivo = porQueNaoServe(
        regras,
        regras.contaPronta,
        entregaParaZona(s.entrega, regras.entrega),
        await conteudoDe(trx, pedidas),
      );
      if (motivo !== null) {
        bloqueios.push({ onde: "metodo_entrega", motivo });
      }
    }
    portes = {
      metodo_id: m.id,
      nome: m.nome,
      // O ponto que o cliente viu entra na impressão (revisão do #439, P3-2).
      ponto:
        onde === "ponto" && s.entrega?.ponto !== undefined
          ? s.entrega.ponto
          : null,
      data_limite: dataLimite(
        momento,
        comerciante.fuso,
        regras?.prazo_max_dias ?? 30,
      ),
      tarifa,
      decisao,
      ...montanteDe(decisao),
    };
  }

  // Os textos legais: a última versão publicada de cada tipo para o país de
  // entrega, a língua e o tipo de cliente.
  const textos: Resumo["textos"] = [];
  if (s.entrega !== null) {
    const tipoCliente =
      s.finalidade === "consumo" ? "consumidor" : "profissional";
    const versoes = await trx
      .selectFrom("versao_texto_legal")
      .innerJoin(
        "texto_legal",
        "texto_legal.id",
        "versao_texto_legal.texto_legal_id",
      )
      .select([
        "texto_legal.tipo",
        "versao_texto_legal.id",
        "versao_texto_legal.numero",
        "versao_texto_legal.validado_por_jurista",
        // O resumo do texto, que fica na aceitação como prova (P2-7).
        sql<string>`encode(sha256(convert_to(versao_texto_legal.texto, 'UTF8')), 'hex')`.as(
          "resumo_texto",
        ),
      ])
      .where("texto_legal.loja_id", "=", s.loja_id)
      .where("texto_legal.pais", "=", s.entrega.pais)
      .where("texto_legal.lingua", "=", s.lingua)
      .where("texto_legal.tipo_cliente", "=", tipoCliente)
      .where("versao_texto_legal.estado", "=", "publicada")
      .orderBy("versao_texto_legal.numero", "desc")
      .execute();
    for (const tipo of TEXTOS_OBRIGATORIOS[tipoCliente]) {
      const v = versoes.find((x) => x.tipo === tipo);
      if (v === undefined) {
        bloqueios.push({
          onde: `texto:${tipo}`,
          motivo: "texto_legal_em_falta",
        });
        continue;
      }
      textos.push({
        tipo,
        versao_id: v.id,
        numero: v.numero,
        validado_por_jurista: v.validado_por_jurista,
        resumo_texto: v.resumo_texto,
      });
    }
  }

  const todas = [...linhas, ...(portes === null ? [] : [portes])];
  return {
    moeda: mercado.moeda,
    preco_inclui_iva: mercado.preco_inclui_iva,
    linhas,
    portes,
    totais: {
      base: todas.reduce((t, l) => t + l.base, 0),
      iva: todas.reduce((t, l) => t + l.iva, 0),
      total: todas.reduce((t, l) => t + l.total, 0),
    },
    textos,
    em_falta,
    bloqueios,
    botao: TEXTO_DO_BOTAO[s.lingua] ?? null,
    entidade_legal_id: carrinho.entidade_legal_id,
    canal_id: carrinho.canal_id,
  };
}

/** JSON com as chaves por ordem (o jsonb da base reordena-as). */
export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (valor !== null && typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(valor);
}

/** O que o cliente viu: os montantes e as versões, para comparar (R3). */
export const impressaoDo = (r: Resumo) => ({
  moeda: r.moeda,
  // A marca só entra quando existe: as impressões das linhas sem ela ficam
  // as de antes (docs/30 §15, H3).
  linhas: r.linhas.map((l) => [
    l.variante_id,
    l.quantidade,
    l.base,
    l.iva,
    l.total,
    ...(l.selado_por_higiene ? ["selado_por_higiene"] : []),
  ]),
  portes:
    r.portes === null
      ? null
      : [
          r.portes.metodo_id,
          r.portes.base,
          r.portes.iva,
          r.portes.total,
          // A data-limite que o cliente viu (docs/36 L1; revisão do #397,
          // P1-1): se mudar até ao botão final, a encomenda não se faz.
          r.portes.data_limite,
          // O ponto de recolha, só quando há (docs/36 §21; revisão do #439,
          // P3-2): as impressões sem ponto ficam as de antes.
          ...(r.portes.ponto === null ? [] : [`ponto:${r.portes.ponto.id}`]),
        ],
  total: r.totais.total,
  textos: r.textos.map((t) => t.versao_id),
});

/**
 * A impressão do que o cliente vê no resumo: o resumo SHA-256 dos montantes e
 * das versões. O ecrã devolve-a no botão final, e é com ela que se compara
 * (o R3 é o que o cliente viu, não o último resumo pedido; revisão do #276,
 * P1-2).
 */
export const impressao = (r: Resumo) =>
  createHash("sha256")
    .update(canonico(impressaoDo(r)))
    .digest("hex");

// ---------------------------------------------------------- Botão final

/**
 * O botão final (§5, passos 7 e 8): recalcula; se mudou desde o resumo, não
 * cria a encomenda (R3); confere as versões aceites; cria a ficha, o perfil
 * e a encomenda com a cópia de tudo; fecha a sessão e o carrinho.
 */
export async function concluir(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  aceitacao: {
    aceita_condicoes: boolean;
    versoes: string[];
    impressao: string;
  },
): Promise<string> {
  const c = s.comerciante_id;
  // O relógio da base, como a hora da aceitação: a data-limite conta do
  // mesmo dia (revisão do #397, P3-4).
  const { rows: agoraBase } = await sql<{
    agora: Date;
  }>`select now() as agora`.execute(trx);
  const r = await calcularResumo(
    trx,
    s,
    (agoraBase[0] as { agora: Date }).agora,
  );
  if (r.em_falta.length > 0) {
    throw new ErroCheckout("checkout.incomplete", "faltam dados", {
      em_falta: r.em_falta,
    });
  }
  const semStock = r.bloqueios.filter((b) => b.onde.startsWith("stock:"));
  if (semStock.length > 0) {
    throw new ErroCheckout(
      "checkout.out_of_stock",
      "uma linha já não tem stock",
      { bloqueios: semStock },
    );
  }
  const semMetodo = r.bloqueios.filter((b) => b.onde === "metodo_entrega");
  if (semMetodo.length > 0) {
    throw new ErroCheckout(
      "checkout.no_delivery_method",
      "o método de entrega escolhido não serve esta encomenda",
      { bloqueios: semMetodo },
    );
  }
  const pagamento = r.bloqueios.filter((b) => b.onde === "pagamento");
  if (pagamento.length > 0) {
    throw new ErroCheckout(
      "checkout.payment_unavailable",
      "o método de pagamento escolhido não se pode usar",
      { bloqueios: pagamento },
    );
  }
  const iva = r.bloqueios.filter(
    (b) =>
      !b.onde.startsWith("texto:") &&
      !b.onde.startsWith("stock:") &&
      b.onde !== "pagamento" &&
      b.onde !== "metodo_entrega",
  );
  if (iva.length > 0) {
    throw new ErroCheckout(
      "checkout.vat_blocked",
      "uma linha não se pode vender",
      {
        bloqueios: iva,
      },
    );
  }
  if (r.bloqueios.length > 0) {
    throw new ErroCheckout(
      "checkout.legal_text_missing",
      "faltam textos legais",
      {
        bloqueios: r.bloqueios,
      },
    );
  }
  if (r.botao === null) {
    throw new ErroCheckout(
      "checkout.legal_text_missing",
      "não há o texto do botão final para esta língua",
    );
  }
  if (impressao(r) !== aceitacao.impressao) {
    throw new ErroCheckout(
      "checkout.total_changed",
      "o total ou as condições mudaram desde o resumo: veja-o outra vez",
    );
  }
  // As versões vêm sem prefixo (a rota tira-o).
  const exigidas = r.textos.map((t) => t.versao_id).sort();
  const aceites = [...new Set(aceitacao.versoes)].sort();
  if (
    !aceitacao.aceita_condicoes ||
    JSON.stringify(exigidas) !== JSON.stringify(aceites)
  ) {
    throw new ErroCheckout(
      "checkout.legal_not_accepted",
      "as condições não foram aceites (versões do resumo)",
      { versoes: exigidas.map((v) => `lgv_${v}`) },
    );
  }
  const entrega = s.entrega as Entrega;
  const faturacao = s.faturacao as Faturacao;
  // A ficha e o perfil (sem conta: sempre novos; docs/25 R8 e Q6).
  const clienteId = await criarCliente(trx, c, {
    nome: s.nome as string,
    emails: [s.email as string],
    telefones: s.telefone === null ? [] : [s.telefone],
    lingua: s.lingua,
    pais: entrega.pais,
  });
  // A morada do ponto de recolha nunca passa a morada fiscal (docs/36 §21):
  // sem morada de faturação, o perfil fica sem morada.
  const morada =
    faturacao.morada ?? (entrega.ponto === undefined ? entrega : null);
  const perfilId = await criarPerfil(trx, c, clienteId, {
    tipo: faturacao.tipo,
    nome_documento: faturacao.nome_documento,
    nif: faturacao.nif,
    morada:
      morada === null
        ? null
        : {
            linha1: morada.linha1,
            linha2: morada.linha2,
            codigo_postal: morada.codigo_postal,
            localidade: morada.localidade,
            pais: morada.pais,
          },
  });
  const perfil = await trx
    .selectFrom("perfil_faturacao")
    .select([
      "tipo",
      "nome_documento",
      "nif_escrito",
      "nif_numero",
      "pais_contribuinte",
    ])
    .where("id", "=", perfilId)
    .executeTakeFirstOrThrow();
  const carrinho = await trx
    .selectFrom("carrinho")
    .select(["canal_id"])
    .where("id", "=", s.carrinho_id)
    .executeTakeFirstOrThrow();
  const metodo = r.portes as NonNullable<Resumo["portes"]>;
  // O serviço da etiqueta é o vendido (docs/36 R1): a conta e o serviço do
  // método ficam na cópia, com a data-limite que o cliente viu (L1).
  const servico = await trx
    .selectFrom("metodo_entrega")
    .select(["conta_transportadora_id", "servico"])
    .where("id", "=", metodo.metodo_id)
    .executeTakeFirstOrThrow();
  // A hora da aceitação vem do relógio da base, como as outras datas da
  // encomenda (revisão do #276, P3-6).
  const { rows: relogio } = await sql<{
    agora: string;
  }>`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as agora`.execute(
    trx,
  );
  const agora = (relogio[0] as { agora: string }).agora;
  const { id: encomendaId } = await trx
    .insertInto("encomenda")
    .values({
      comerciante_id: c,
      loja_id: s.loja_id,
      canal_id: carrinho.canal_id,
      mercado_id: s.mercado_id,
      entidade_legal_id: r.entidade_legal_id,
      sessao_id: s.id,
      cliente_id: clienteId,
      perfil_id: perfilId,
      perfil_copia: JSON.stringify({
        ...perfil,
        morada,
        outra_pessoa: faturacao.outra_pessoa,
      }),
      contacto: JSON.stringify({
        email: s.email,
        nome: s.nome,
        telefone: s.telefone,
      }),
      entrega: JSON.stringify(entrega),
      finalidade: s.finalidade,
      moeda: r.moeda,
      preco_inclui_iva: r.preco_inclui_iva,
      lingua: s.lingua,
      total_base: r.totais.base,
      total_iva: r.totais.iva,
      total: r.totais.total,
      portes: JSON.stringify(metodo),
      metodo_entrega: JSON.stringify({
        id: metodo.metodo_id,
        nome: metodo.nome,
        data_limite: metodo.data_limite,
        ...(servico.conta_transportadora_id === null
          ? {}
          : {
              conta: servico.conta_transportadora_id,
              servico: servico.servico,
            }),
      }),
      metodo_pagamento: s.metodo_pagamento as string,
      aceitacoes: JSON.stringify({
        versoes: r.textos,
        botao: r.botao,
        em: agora,
      }),
      criada_por: `checkout:chk_${s.id}`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  let posicao = 0;
  const paraReservar: {
    id: string;
    variante_id: string;
    quantidade: number;
  }[] = [];
  for (const l of r.linhas) {
    posicao += 1;
    const linha = await trx
      .insertInto("linha_encomenda")
      .values({
        comerciante_id: c,
        encomenda_id: encomendaId,
        posicao,
        variante_id: l.variante_id,
        sku: l.sku,
        nome: l.nome,
        quantidade: l.quantidade,
        preco_unitario: l.preco_unitario,
        preco: JSON.stringify(l.preco),
        decisao_iva: JSON.stringify(l.decisao),
        base: l.base,
        iva: l.iva,
        total: l.total,
        selado_por_higiene: l.selado_por_higiene,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    paraReservar.push({
      id: linha.id,
      variante_id: l.variante_id,
      quantidade: l.quantidade,
    });
  }
  // A reserva do stock no botão final (docs/27 Q2): sem disponível (outro
  // cliente levou a última unidade entretanto), não há encomenda.
  try {
    await reservarEncomenda(trx, c, encomendaId, s.loja_id, paraReservar);
  } catch (erro) {
    const e = erro as Error;
    // Sem armazém, a loja não está pronta para vender: não é falta de stock
    // (revisão do #296, P3).
    if (erro instanceof ErroStock && erro.codigo === "inventory.no_warehouse") {
      throw new ErroCheckout(
        "checkout.out_of_stock",
        "a loja ainda não tem armazém: não pode reservar o stock",
        undefined,
        { cause: erro },
      );
    }
    if (
      erro instanceof ErroStock ||
      e.message.startsWith("inventory.insufficient:")
    ) {
      throw new ErroCheckout(
        "checkout.out_of_stock",
        "uma linha já não tem stock",
        undefined,
        { cause: erro },
      );
    }
    throw erro;
  }
  // Os dados pessoais saem da sessão: a encomenda tem a cópia (docs/23
  // §15.4; migração 0077).
  await trx
    .updateTable("sessao_checkout")
    .set({
      estado: "concluida",
      concluida_em: new Date(),
      email: null,
      nome: null,
      telefone: null,
      entrega: null,
      faturacao: null,
    })
    .where("id", "=", s.id)
    .execute();
  await trx
    .updateTable("carrinho")
    .set({ estado: "convertido", actualizado_em: new Date() })
    .where("id", "=", s.carrinho_id)
    .execute();
  return encomendaId;
}

/** A encomenda da sessão concluída (a confirmação; o botão repetido). */
export async function encomendaDaSessao(
  trx: Transaction<BaseDados>,
  sessaoId: string,
) {
  const e = await trx
    .selectFrom("encomenda")
    .select("id")
    .where("sessao_id", "=", sessaoId)
    .executeTakeFirst();
  return e?.id ?? null;
}

// --------------------------------------------- Encomendas (só leitura)

export async function lerEncomenda(
  db: Kysely<BaseDados>,
  comercianteId: string,
  id: string,
) {
  return noCheckout(db, comercianteId, async (trx) => {
    const e = await trx
      .selectFrom("encomenda")
      .selectAll()
      // A ficha foi pseudonimizada por um pedido de apagamento: a cópia do
      // perfil de faturação só sai ao dono (docs/23 §15.13, EN). O
      // `selectAll` traz a cópia: uma rota que a devolva passa por
      // `paraEncomenda` (checkout/rotas.ts), que aplica a regra.
      .select(fichaPseudonimizada(sql`encomenda.cliente_id`).as("guardado"))
      .where("id", "=", id)
      .executeTakeFirst();
    if (e === undefined) throw naoExiste("a encomenda");
    const linhas = await trx
      .selectFrom("linha_encomenda")
      .selectAll()
      .where("encomenda_id", "=", id)
      .orderBy("posicao")
      .execute();
    // O estado do documento fiscal (docs/29 §7.1); só o estado e o id.
    const documento = await documentoDaEncomenda(trx, id);
    return { encomenda: e, linhas, documento };
  });
}

export async function listarEncomendas(
  db: Kysely<BaseDados>,
  comercianteId: string,
  limite: number,
) {
  return noCheckout(db, comercianteId, (trx) =>
    trx
      .selectFrom("encomenda")
      .select(["id", "estado", "total", "moeda", "cliente_id", "criada_em"])
      .orderBy("criada_em", "desc")
      .orderBy("id", "desc")
      .limit(limite)
      .execute(),
  );
}

export async function listarCheckouts(
  db: Kysely<BaseDados>,
  comercianteId: string,
  estado: string | undefined,
  limite: number,
) {
  return noCheckout(db, comercianteId, async (trx) => {
    let q = trx
      .selectFrom("sessao_checkout")
      .select([
        "id",
        "estado",
        "carrinho_id",
        "mercado_id",
        "criado_em",
        "expira_em",
        "concluida_em",
      ]);
    if (estado !== undefined) q = q.where("estado", "=", estado as never);
    return q
      .orderBy("criado_em", "desc")
      .orderBy("id", "desc")
      .limit(limite)
      .execute();
  });
}

// --------------------------------------------- Textos legais (Administração)

export async function criarTextoLegal(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: {
    loja: string;
    tipo: TipoTextoLegal;
    pais: string;
    lingua: string;
    tipo_cliente: "consumidor" | "profissional";
  },
): Promise<string> {
  return noCheckout(db, comercianteId, async (trx) => {
    const { id } = await trx
      .insertInto("texto_legal")
      .values({
        comerciante_id: comercianteId,
        loja_id: dados.loja,
        tipo: dados.tipo,
        pais: dados.pais,
        lingua: dados.lingua,
        tipo_cliente: dados.tipo_cliente,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
}

export async function listarTextosLegais(
  db: Kysely<BaseDados>,
  comercianteId: string,
) {
  return noCheckout(db, comercianteId, async (trx) => {
    const textos = await trx
      .selectFrom("texto_legal")
      .selectAll()
      .orderBy("criado_em")
      .orderBy("id")
      .execute();
    const versoes = await trx
      .selectFrom("versao_texto_legal")
      .select([
        "id",
        "texto_legal_id",
        "numero",
        "estado",
        "validado_por_jurista",
        "jurista",
        "validado_em",
        "criada_por",
        "criada_em",
        "publicada_por",
        "publicada_em",
      ])
      .orderBy("numero")
      .execute();
    return textos.map((t) => ({
      ...t,
      versoes: versoes.filter((v) => v.texto_legal_id === t.id),
    }));
  });
}

/**
 * Uma versão com o texto inteiro e o resumo SHA-256 dele (revisão do #276,
 * P2-7): o cliente lê o que aceita e o comerciante relê o que publicou.
 */
async function versaoComTexto(
  trx: Transaction<BaseDados>,
  versaoId: string,
  textoId?: string,
) {
  let q = trx
    .selectFrom("versao_texto_legal")
    .innerJoin(
      "texto_legal",
      "texto_legal.id",
      "versao_texto_legal.texto_legal_id",
    )
    .select([
      "versao_texto_legal.id",
      "versao_texto_legal.texto_legal_id",
      "texto_legal.tipo",
      "texto_legal.pais",
      "texto_legal.lingua",
      "texto_legal.tipo_cliente",
      "versao_texto_legal.numero",
      "versao_texto_legal.estado",
      "versao_texto_legal.texto",
      "versao_texto_legal.validado_por_jurista",
      "versao_texto_legal.jurista",
      "versao_texto_legal.publicada_em",
      sql<string>`encode(sha256(convert_to(versao_texto_legal.texto, 'UTF8')), 'hex')`.as(
        "resumo_texto",
      ),
    ])
    .where("versao_texto_legal.id", "=", versaoId);
  if (textoId !== undefined) {
    q = q.where("versao_texto_legal.texto_legal_id", "=", textoId);
  }
  const v = await q.executeTakeFirst();
  if (v === undefined) {
    throw new ErroCheckout("checkout.not_found", "esta versão não existe");
  }
  return v;
}

/** A versão para a Administração (legal:read), rascunho ou publicada. */
export async function lerVersaoTextoLegal(
  db: Kysely<BaseDados>,
  comercianteId: string,
  textoId: string,
  versaoId: string,
) {
  return noCheckout(db, comercianteId, (trx) =>
    versaoComTexto(trx, versaoId, textoId),
  );
}

/**
 * A versão para o cliente do checkout: só as que estão no resumo da sessão
 * (as que ele tem de aceitar); outra, mesmo publicada, não existe para ele.
 */
export async function versaoDoResumo(
  trx: Transaction<BaseDados>,
  s: SessaoLida,
  versaoId: string,
) {
  const r = await calcularResumo(trx, s);
  if (!r.textos.some((t) => t.versao_id === versaoId)) {
    throw new ErroCheckout("checkout.not_found", "esta versão não existe");
  }
  return versaoComTexto(trx, versaoId);
}

export async function criarVersaoTextoLegal(
  db: Kysely<BaseDados>,
  comercianteId: string,
  textoId: string,
  dados: {
    texto: string;
    validado_por_jurista: boolean;
    jurista: string | null;
    validado_em: string | null;
  },
) {
  return noCheckout(db, comercianteId, async (trx) => {
    const t = await trx
      .selectFrom("texto_legal")
      .select("id")
      .where("id", "=", textoId)
      .executeTakeFirst();
    if (t === undefined) throw naoExiste("o texto legal");
    return trx
      .insertInto("versao_texto_legal")
      .values({
        comerciante_id: comercianteId,
        texto_legal_id: textoId,
        texto: dados.texto,
        validado_por_jurista: dados.validado_por_jurista,
        jurista: dados.jurista,
        validado_em: dados.validado_em,
        // A base põe quem (eurolify.quem); este valor é substituído.
        criada_por: "-",
      })
      .returning(["id", "numero"])
      .executeTakeFirstOrThrow();
  });
}

export async function publicarVersaoTextoLegal(
  db: Kysely<BaseDados>,
  comercianteId: string,
  textoId: string,
  versaoId: string,
) {
  return noCheckout(db, comercianteId, async (trx) => {
    const r = await trx
      .updateTable("versao_texto_legal")
      .set({ estado: "publicada" })
      .where("id", "=", versaoId)
      .where("texto_legal_id", "=", textoId)
      .returning(["id", "numero", "publicada_em"])
      .executeTakeFirst();
    if (r === undefined) throw naoExiste("a versão");
    return r;
  });
}

// ---------------------------------------- Métodos de entrega (Administração)

export interface DadosMetodoEntrega {
  nome: Record<string, string>;
  prazo: Record<string, string>;
  tarifa: number;
  gratis_a_partir_de: number | null;
  pede_telefone: boolean;
}

/** O que o método diz para os envios (docs/36 §3.2; 0074). */
export interface EnviosDoMetodo {
  conta: string | null;
  servico: string | null;
  prazo_max_dias: number;
  codigos_postais: string[];
  aceita_onu: string[];
  peso_max_g: number | null;
  /** Onde entrega: na morada ou num ponto de recolha (docs/36 §21). */
  entrega: "morada" | "ponto";
}

const ENVIOS_POR_OMISSAO: EnviosDoMetodo = {
  conta: null,
  servico: null,
  prazo_max_dias: 30,
  codigos_postais: [],
  aceita_onu: [],
  peso_max_g: null,
  entrega: "morada",
};

/**
 * Um método com conta aponta para um serviço que a transportadora tem, que
 * entrega nos países do mercado, que aceita os perigosos que o método
 * aceita e cujo peso máximo não passa o do serviço (docs/36 §3.2). Sem
 * conta (método «manual»), só os formatos, que a base confere.
 */
async function conferirEnviosDoMetodo(
  trx: Transaction<BaseDados>,
  mercadoId: string,
  e: EnviosDoMetodo,
  pedeTelefone: boolean,
  cfg: ConfigEnvios | undefined,
): Promise<EnviosDoMetodo> {
  // Os prefixos guardam-se como o código postal limpo (sem espaços nem
  // hífenes, em maiúsculas), como se compara (entrega.ts).
  const codigos_postais = [
    ...new Set(
      e.codigos_postais.map((p) => p.replace(/[\s-]/g, "").toUpperCase()),
    ),
  ];
  const aceita_onu = [...new Set(e.aceita_onu)];
  if ((e.conta === null) !== (e.servico === null)) {
    throw new ErroEnvios(
      "shipping.invalid_field",
      "a conta e o serviço vão juntos (ou nenhum, num método manual)",
    );
  }
  // Um método num ponto de recolha precisa de uma transportadora que
  // procure os pontos (docs/36 §21).
  if (e.entrega === "ponto" && e.conta === null) {
    throw new ErroEnvios(
      "shipping.invalid_field",
      "um método que entrega num ponto de recolha precisa de conta e serviço",
    );
  }
  if (e.conta === null || e.servico === null) {
    return { ...e, codigos_postais, aceita_onu };
  }
  const s = await conferirServico(trx, e.conta, e.servico, cfg);
  // O serviço e o método dizem o mesmo sobre onde entrega (§21).
  if ((s.ponto === true) !== (e.entrega === "ponto")) {
    throw new ErroEnvios(
      "shipping.invalid_field",
      s.ponto === true
        ? "o serviço entrega num ponto de recolha: o método tem de ter entrega «ponto»"
        : "o serviço não entrega em pontos de recolha",
    );
  }
  const { paises } = await trx
    .selectFrom("mercado")
    .select("paises")
    .where("id", "=", mercadoId)
    .executeTakeFirstOrThrow();
  const fora = paises.filter((p) => !s.paises.includes(p));
  if (fora.length > 0) {
    throw new ErroEnvios(
      "shipping.invalid_field",
      "o serviço não entrega em todos os países do mercado",
      { paises: fora },
    );
  }
  const recusados = aceita_onu.filter((u) => !s.aceitaOnu.includes(u));
  if (recusados.length > 0) {
    throw new ErroEnvios(
      "shipping.invalid_field",
      "o serviço não aceita estes números ONU",
      { onu: recusados },
    );
  }
  if (
    s.pesoMaxG !== null &&
    e.peso_max_g !== null &&
    e.peso_max_g > s.pesoMaxG
  ) {
    throw new ErroEnvios(
      "shipping.invalid_field",
      "o peso máximo passa o do serviço",
      { peso_max_g: s.pesoMaxG },
    );
  }
  if (s.pedeTelefone && !pedeTelefone) {
    throw new ErroEnvios(
      "shipping.invalid_field",
      "o serviço pede o telefone de quem recebe: pede_telefone tem de ser true",
    );
  }
  // Sem peso máximo dado, fica o do serviço.
  return {
    ...e,
    codigos_postais,
    aceita_onu,
    peso_max_g: e.peso_max_g ?? s.pesoMaxG,
  };
}

export async function criarMetodoEntrega(
  db: Kysely<BaseDados>,
  comercianteId: string,
  mercadoId: string,
  dados: DadosMetodoEntrega & Partial<EnviosDoMetodo>,
  cfg?: ConfigEnvios,
) {
  return noCheckout(db, comercianteId, async (trx) => {
    const m = await trx
      .selectFrom("mercado")
      .select(["loja_id"])
      .where("id", "=", mercadoId)
      .executeTakeFirst();
    if (m === undefined) throw naoExiste("o mercado");
    const envios = await conferirEnviosDoMetodo(
      trx,
      mercadoId,
      {
        conta: dados.conta ?? ENVIOS_POR_OMISSAO.conta,
        servico: dados.servico ?? ENVIOS_POR_OMISSAO.servico,
        prazo_max_dias:
          dados.prazo_max_dias ?? ENVIOS_POR_OMISSAO.prazo_max_dias,
        codigos_postais:
          dados.codigos_postais ?? ENVIOS_POR_OMISSAO.codigos_postais,
        aceita_onu: dados.aceita_onu ?? ENVIOS_POR_OMISSAO.aceita_onu,
        peso_max_g: dados.peso_max_g ?? ENVIOS_POR_OMISSAO.peso_max_g,
        entrega: dados.entrega ?? ENVIOS_POR_OMISSAO.entrega,
      },
      dados.pede_telefone,
      cfg,
    );
    const { id } = await trx
      .insertInto("metodo_entrega")
      .values({
        comerciante_id: comercianteId,
        loja_id: m.loja_id,
        mercado_id: mercadoId,
        nome: JSON.stringify(dados.nome),
        prazo: JSON.stringify(dados.prazo),
        tarifa: dados.tarifa,
        gratis_a_partir_de: dados.gratis_a_partir_de,
        pede_telefone: dados.pede_telefone,
        conta_transportadora_id: envios.conta,
        servico: envios.servico,
        prazo_max_dias: envios.prazo_max_dias,
        codigos_postais: envios.codigos_postais,
        aceita_onu: envios.aceita_onu,
        peso_max_g: envios.peso_max_g,
        entrega: envios.entrega,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
}

export async function mudarMetodoEntrega(
  db: Kysely<BaseDados>,
  comercianteId: string,
  id: string,
  versao: number,
  dados: Partial<DadosMetodoEntrega> &
    Partial<EnviosDoMetodo> & { estado?: "activo" | "arquivado" },
  cfg?: ConfigEnvios,
) {
  return noCheckout(db, comercianteId, async (trx) => {
    // O estado final do método confere-se inteiro (uma mudança do telefone
    // ou dos ONU pode deixar de caber no serviço da conta).
    const actual = await trx
      .selectFrom("metodo_entrega")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (actual === undefined) throw naoExiste("o método de entrega");
    const tocaNosEnvios =
      dados.conta !== undefined ||
      dados.servico !== undefined ||
      dados.prazo_max_dias !== undefined ||
      dados.codigos_postais !== undefined ||
      dados.aceita_onu !== undefined ||
      dados.peso_max_g !== undefined ||
      dados.entrega !== undefined ||
      dados.pede_telefone !== undefined ||
      dados.estado === "activo";
    const envios = tocaNosEnvios
      ? await conferirEnviosDoMetodo(
          trx,
          actual.mercado_id,
          {
            conta:
              dados.conta === undefined
                ? actual.conta_transportadora_id
                : dados.conta,
            servico:
              dados.servico === undefined ? actual.servico : dados.servico,
            prazo_max_dias: dados.prazo_max_dias ?? actual.prazo_max_dias,
            codigos_postais: dados.codigos_postais ?? actual.codigos_postais,
            aceita_onu: dados.aceita_onu ?? actual.aceita_onu,
            peso_max_g:
              dados.peso_max_g === undefined
                ? actual.peso_max_g
                : dados.peso_max_g,
            entrega: dados.entrega ?? actual.entrega,
          },
          dados.pede_telefone ?? actual.pede_telefone,
          cfg,
        )
      : null;
    const r = await trx
      .updateTable("metodo_entrega")
      .set({
        ...(envios === null
          ? {}
          : {
              conta_transportadora_id: envios.conta,
              servico: envios.servico,
              prazo_max_dias: envios.prazo_max_dias,
              codigos_postais: envios.codigos_postais,
              aceita_onu: envios.aceita_onu,
              peso_max_g: envios.peso_max_g,
              entrega: envios.entrega,
            }),
        ...(dados.nome === undefined
          ? {}
          : { nome: JSON.stringify(dados.nome) }),
        ...(dados.prazo === undefined
          ? {}
          : { prazo: JSON.stringify(dados.prazo) }),
        ...(dados.tarifa === undefined ? {} : { tarifa: dados.tarifa }),
        ...(dados.gratis_a_partir_de === undefined
          ? {}
          : { gratis_a_partir_de: dados.gratis_a_partir_de }),
        ...(dados.pede_telefone === undefined
          ? {}
          : { pede_telefone: dados.pede_telefone }),
        ...(dados.estado === undefined ? {} : { estado: dados.estado }),
        actualizado_em: new Date(),
        versao: versao + 1,
      })
      .where("id", "=", id)
      .where("versao", "=", versao)
      .returning("id")
      .executeTakeFirst();
    if (r === undefined) {
      const existe = await trx
        .selectFrom("metodo_entrega")
        .select("versao")
        .where("id", "=", id)
        .executeTakeFirst();
      if (existe === undefined) throw naoExiste("o método de entrega");
      throw new ErroCheckout(
        "checkout.version_conflict",
        "a versão mudou entretanto",
        {
          versao: existe.versao,
        },
      );
    }
  });
}

export async function listarMetodosEntrega(
  db: Kysely<BaseDados>,
  comercianteId: string,
  mercadoId: string | undefined,
) {
  return noCheckout(db, comercianteId, async (trx) => {
    let q = trx.selectFrom("metodo_entrega").selectAll();
    if (mercadoId !== undefined) q = q.where("mercado_id", "=", mercadoId);
    return q.orderBy("criado_em").orderBy("id").execute();
  });
}
