import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados } from "../base/esquema.js";
import { conteudoDe } from "../checkout/entrega.js";
import {
  ErroDeRede,
  type ConfigEnvios,
  type MoradaEtiqueta,
  type ResultadoEtiqueta,
} from "./adaptador.js";
import { ErroEnvios } from "./erros.js";
import { comTempo, codigoDe } from "./etiquetas.js";
import {
  adaptadorDe,
  credenciaisDe,
  noEnvios,
  servicosDe,
  type Remetente,
} from "./repositorio.js";

// A etiqueta de devolução pela transportadora (docs/36 §22; Diogo,
// 13/10/2026: «sim, aprovo; avança com o código»). Ex.: numa devolução à
// espera, o armazém pede a etiqueta pela conta da Sendcloud; sai um PDF com
// o seguimento, e a devolução fica com a transportadora e o seguimento dela.
// - Uma por devolução, no máximo uma viva (como R2).
// - A resposta perdida fica `incerta`: a lista da Sendcloud não procura pela
//   nossa referência, por isso nunca se pede outra sozinha (§22.3).
// - O estado da volta não muda a devolução: a recepção, a inspecção e o
//   reembolso são de uma pessoa.

/** Um pedido `a_pedir` mais velho do que isto ficou a meio (a API reiniciou). */
const A_MEIO_MS = 5 * 60 * 1000;
/**
 * Uma incerta só se anula depois disto: a transportadora pode ainda estar a
 * criá-la (como a expedição, `etiquetas.ts`; revisão do #447, P2).
 */
export const INCERTA_IDADE_MINIMA_MS = 15 * 60 * 1000;
/** No máximo tantas tentativas por devolução (revisão do #447, P2; 0093). */
export const MAX_TENTATIVAS = 10;

async function marcar(trx: Transaction<BaseDados>, quem: string) {
  await sql`select set_config('eurolify.quem', ${quem}, true),
    set_config('eurolify.motivo', '', true)`.execute(trx);
}

const linha = (v: unknown) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";

/** A etiqueta de uma devolução, como a API a mostra. */
export interface EtiquetaDaDevolucao {
  devolucao: string;
  estado: "a_pedir" | "emitida" | "incerta" | "recusada" | "anulada";
  tentativa: number;
  conta: string;
  transportadora: string;
  servico: string;
  peso_g: number;
  motivo: string | null;
  seguimento: string | null;
  url_seguimento: string | null;
  em: Date;
  ficheiro: boolean;
}

async function lida(
  trx: Transaction<BaseDados>,
  id: string,
): Promise<EtiquetaDaDevolucao | null> {
  const e = await trx
    .selectFrom("etiqueta_devolucao")
    .leftJoin(
      "etiqueta_devolucao_ficheiro",
      "etiqueta_devolucao_ficheiro.devolucao_id",
      "etiqueta_devolucao.devolucao_id",
    )
    .select([
      "etiqueta_devolucao.devolucao_id",
      "etiqueta_devolucao.estado",
      "etiqueta_devolucao.tentativa",
      "etiqueta_devolucao.conta_transportadora_id",
      "etiqueta_devolucao.transportadora",
      "etiqueta_devolucao.servico",
      "etiqueta_devolucao.peso_g",
      "etiqueta_devolucao.motivo",
      "etiqueta_devolucao.seguimento",
      "etiqueta_devolucao.url_seguimento",
      "etiqueta_devolucao.em",
      "etiqueta_devolucao_ficheiro.devolucao_id as com_ficheiro",
    ])
    .where("etiqueta_devolucao.devolucao_id", "=", id)
    .executeTakeFirst();
  if (e === undefined) return null;
  return {
    devolucao: e.devolucao_id,
    estado: e.estado,
    tentativa: e.tentativa,
    conta: e.conta_transportadora_id,
    transportadora: e.transportadora,
    servico: e.servico,
    peso_g: e.peso_g,
    motivo: e.motivo,
    seguimento: e.seguimento,
    url_seguimento: e.url_seguimento,
    em: e.em,
    ficheiro: e.com_ficheiro !== null,
  };
}

/** Um pedido `a_pedir` que ficou a meio passa a `incerta` (só uma pessoa o resolve). */
async function soltarAMeio(trx: Transaction<BaseDados>, id: string) {
  await trx
    .updateTable("etiqueta_devolucao")
    .set({
      estado: "incerta",
      motivo: "o pedido à transportadora ficou a meio",
    })
    .where("devolucao_id", "=", id)
    .where("estado", "=", "a_pedir")
    .where("em", "<", new Date(Date.now() - A_MEIO_MS))
    .execute();
}

/**
 * Um pedido que ficou a meio passa a `incerta` numa transacção à parte, com
 * quem a viu (revisão do #447, P3): fica gravado mesmo que o pedido que a
 * encontrou seja recusado a seguir.
 */
async function soltarSeAMeio(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  quem: string,
) {
  await noEnvios(db, c, async (trx) => {
    await marcar(trx, quem);
    await soltarAMeio(trx, id);
  });
}

export async function lerEtiquetaDevolucao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  quem: string,
): Promise<EtiquetaDaDevolucao> {
  await soltarSeAMeio(db, c, id, quem);
  return noEnvios(db, c, async (trx) => {
    const d = await trx
      .selectFrom("devolucao")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (d === undefined) {
      throw new ErroEnvios("shipping.not_found", "esta devolução não existe");
    }
    const e = await lida(trx, id);
    if (e === null) {
      throw new ErroEnvios(
        "shipping.not_found",
        "esta devolução ainda não tem etiqueta",
      );
    }
    return e;
  });
}

export async function ficheiroEtiquetaDevolucao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  const f = await noEnvios(db, c, (trx) =>
    trx
      .selectFrom("etiqueta_devolucao_ficheiro")
      .select(["formato", "conteudo"])
      .where("devolucao_id", "=", id)
      .executeTakeFirst(),
  );
  if (f === undefined) {
    throw new ErroEnvios(
      "shipping.not_found",
      "esta devolução não tem o ficheiro da etiqueta (ainda não foi emitida, ou já foi apagado)",
    );
  }
  return f;
}

interface Preparado {
  tentativa: number;
  adaptador: ReturnType<typeof adaptadorDe>["adaptador"];
  credenciais: ReturnType<typeof credenciaisDe>;
  pedido: {
    servico: string;
    remetente: MoradaEtiqueta;
    destinatario: MoradaEtiqueta;
    pesoG: number;
  };
}

/**
 * Prepara o pedido numa transacção: a devolução à espera, a conta pronta, o
 * serviço da conta (de morada, para o país do cliente), o peso das linhas a
 * devolver mais a embalagem do armazém (Q6). A etiqueta fica `a_pedir` com
 * a tentativa nova; a chamada à transportadora fica fora da transacção.
 */
async function preparar(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  escolha: { conta: string; servico: string },
  cfg: ConfigEnvios | undefined,
  quem: string,
): Promise<Preparado> {
  return noEnvios(db, c, async (trx) => {
    await marcar(trx, quem);
    const d = await trx
      .selectFrom("devolucao")
      .innerJoin("encomenda", "encomenda.id", "devolucao.encomenda_id")
      .innerJoin("armazem", "armazem.id", "devolucao.armazem_id")
      .select([
        "devolucao.id",
        "devolucao.estado",
        "encomenda.contacto",
        "encomenda.entrega",
        "armazem.embalagem_g",
      ])
      .where("devolucao.id", "=", id)
      .forUpdate("devolucao")
      .executeTakeFirst();
    if (d === undefined) {
      throw new ErroEnvios("shipping.not_found", "esta devolução não existe");
    }
    if (d.estado !== "a_aguardar") {
      throw new ErroEnvios(
        "shipping.invalid_field",
        `a etiqueta de devolução só se pede com a devolução à espera (está «${d.estado}»)`,
      );
    }
    const antes = await lida(trx, id);
    if (antes !== null) {
      if (antes.tentativa >= MAX_TENTATIVAS) {
        throw new ErroEnvios(
          "shipping.invalid_field",
          `no máximo ${String(MAX_TENTATIVAS)} etiquetas por devolução: confira as anteriores no painel da transportadora`,
        );
      }
      if (antes.estado === "incerta") {
        throw new ErroEnvios(
          "shipping.label_uncertain",
          "a etiqueta anterior ficou incerta: confirme no painel da transportadora e anule-a aqui antes de pedir outra",
        );
      }
      if (antes.estado === "a_pedir" || antes.estado === "emitida") {
        throw new ErroEnvios(
          "shipping.label_exists",
          "esta devolução já tem uma etiqueta: anule-a primeiro",
        );
      }
    }
    const conta = await trx
      .selectFrom("conta_transportadora")
      .select([
        "id",
        "transportadora",
        "estado",
        "servicos",
        "remetente",
        "credenciais_cifra",
        "chave_versao",
      ])
      .where("id", "=", escolha.conta)
      .forShare()
      .executeTakeFirst();
    if (conta === undefined) {
      throw new ErroEnvios("shipping.not_found", "esta conta não existe");
    }
    if (conta.estado !== "pronta") {
      throw new ErroEnvios(
        "shipping.account_not_ready",
        "a conta da transportadora não está pronta",
      );
    }
    const { adaptador, chave } = adaptadorDe(cfg, conta.transportadora);
    if (adaptador.pedirEtiquetaDevolucao === undefined) {
      throw new ErroEnvios(
        "shipping.carrier_unavailable",
        "esta transportadora ainda não faz etiquetas de devolução no Eurolify",
      );
    }
    const credenciais = credenciaisDe(conta, chave);
    const entrega = d.entrega as {
      pais?: unknown;
      linha1?: unknown;
      linha2?: unknown;
      codigo_postal?: unknown;
      localidade?: unknown;
    };
    const pais = linha(entrega.pais);
    const servico = servicosDe(adaptador, conta.servicos).find(
      (s) => s.codigo === escolha.servico,
    );
    if (servico === undefined) {
      throw new ErroEnvios(
        "shipping.service_unknown",
        "a transportadora não tem este serviço",
      );
    }
    // A volta sai da morada do cliente: um serviço de pontos não serve
    // (§21), e tem de servir o país do cliente.
    if (
      servico.ponto === true ||
      !servico.paises.includes(pais) ||
      // O telefone e o e-mail do cliente não vão (§22.3): um serviço que os
      // pede não serve a volta.
      servico.pedeTelefone ||
      servico.pedeEmail
    ) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        "o serviço não serve esta devolução: tem de recolher no país do cliente, não ser de pontos de recolha nem pedir o telefone ou o e-mail do cliente",
      );
    }
    const linhas = await trx
      .selectFrom("linha_devolucao")
      .innerJoin(
        "linha_encomenda",
        "linha_encomenda.id",
        "linha_devolucao.linha_encomenda_id",
      )
      .select([
        "linha_encomenda.variante_id",
        "linha_devolucao.pedida as quantidade",
      ])
      .where("linha_devolucao.devolucao_id", "=", id)
      .execute();
    const { pesoG, onu } = await conteudoDe(trx, linhas);
    // Os perigosos, como na expedição (L9; revisão do #447, P2).
    const recusados = [...onu].filter((n) => !servico.aceitaOnu.includes(n));
    if (recusados.length > 0) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        "o serviço não aceita uma mercadoria perigosa desta devolução",
        { onu: recusados },
      );
    }
    if (pesoG === null) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        "uma variante da devolução não tem peso: corrija o peso da variante",
      );
    }
    const peso = Math.max(1, pesoG + d.embalagem_g);
    if (servico.pesoMaxG !== null && peso > servico.pesoMaxG) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        "a caixa pesa mais do que o serviço aceita",
        { peso_g: peso, peso_max_g: servico.pesoMaxG },
      );
    }
    const contacto = d.contacto as { nome?: unknown };
    // Só o que a volta precisa (§22.3): o nome e a morada de entrega; nunca
    // o telefone, o e-mail, os preços, o NIF nem o motivo do cliente.
    const remetente: MoradaEtiqueta = {
      nome: linha(contacto.nome),
      linha1: linha(entrega.linha1),
      ...(linha(entrega.linha2) === ""
        ? {}
        : { linha2: linha(entrega.linha2) }),
      codigo_postal: linha(entrega.codigo_postal),
      localidade: linha(entrega.localidade),
      pais,
    };
    if (
      remetente.nome === "" ||
      remetente.linha1 === "" ||
      remetente.codigo_postal === "" ||
      remetente.localidade === ""
    ) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        "a encomenda já não tem o nome e a morada do cliente (apagamento do titular?)",
      );
    }
    const r = conta.remetente as unknown as Remetente;
    let tentativa = 1;
    if (antes === null) {
      await trx
        .insertInto("etiqueta_devolucao")
        .values({
          devolucao_id: id,
          comerciante_id: c,
          conta_transportadora_id: conta.id,
          transportadora: conta.transportadora,
          servico: servico.codigo,
          peso_g: peso,
          criado_por: quem,
        })
        .execute();
    } else {
      tentativa = antes.tentativa + 1;
      await trx
        .deleteFrom("etiqueta_devolucao_ficheiro")
        .where("devolucao_id", "=", id)
        .execute();
      await trx
        .updateTable("etiqueta_devolucao")
        .set({
          estado: "a_pedir",
          tentativa,
          conta_transportadora_id: conta.id,
          transportadora: conta.transportadora,
          servico: servico.codigo,
          peso_g: peso,
          motivo: null,
          seguimento: null,
          url_seguimento: null,
          criado_por: quem,
        })
        .where("devolucao_id", "=", id)
        .execute();
    }
    return {
      tentativa,
      adaptador,
      credenciais,
      pedido: {
        servico: servico.codigo,
        remetente,
        // A volta vai para a morada de recolha da conta (o armazém).
        destinatario: { ...r },
        pesoG: peso,
      },
    };
  });
}

/** Grava o que a transportadora respondeu, se a tentativa ainda é a mesma. */
async function registar(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  tentativa: number,
  quem: string,
  r: ResultadoEtiqueta | { estado: "incerta"; motivo: string },
) {
  await noEnvios(db, c, async (trx) => {
    await marcar(trx, quem);
    // A devolução primeiro, depois a etiqueta: a mesma ordem de `preparar`
    // e do gatilho que fecha a devolução (revisão do #447, P2).
    await trx
      .selectFrom("devolucao")
      .select("id")
      .where("id", "=", id)
      .forUpdate()
      .execute();
    const e = await trx
      .selectFrom("etiqueta_devolucao")
      .select(["estado", "tentativa", "transportadora"])
      .where("devolucao_id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (
      e === undefined ||
      e.tentativa !== tentativa ||
      e.estado !== "a_pedir"
    ) {
      return;
    }
    if (r.estado === "emitida") {
      await trx
        .updateTable("etiqueta_devolucao")
        .set({
          estado: "emitida",
          seguimento: r.seguimento,
          url_seguimento: r.urlSeguimento,
          motivo: null,
        })
        .where("devolucao_id", "=", id)
        .execute();
      await trx
        .insertInto("etiqueta_devolucao_ficheiro")
        .values({
          devolucao_id: id,
          comerciante_id: c,
          tentativa,
          formato: r.ficheiro.formato,
          conteudo: r.ficheiro.conteudo,
        })
        .execute();
      // A devolução fica com a transportadora e o seguimento da etiqueta
      // (deixam de se escrever à mão, docs/30 §3.2).
      await trx
        .updateTable("devolucao")
        .set((eb) => ({
          transportadora: e.transportadora,
          seguimento: r.seguimento,
          versao: eb("versao", "+", 1),
        }))
        .where("id", "=", id)
        .execute();
    } else {
      await trx
        .updateTable("etiqueta_devolucao")
        .set({ estado: r.estado, motivo: r.motivo.slice(0, 500) })
        .where("devolucao_id", "=", id)
        .execute();
    }
  });
}

/**
 * Pede a etiqueta de devolução (§22.3). Uma resposta perdida fica `incerta`:
 * nunca se pede outra sem uma pessoa.
 */
export async function pedirEtiquetaDevolucao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  escolha: { conta: string; servico: string },
  cfg: ConfigEnvios | undefined,
  quem: string,
): Promise<EtiquetaDaDevolucao> {
  await soltarSeAMeio(db, c, id, quem);
  const p = await preparar(db, c, id, escolha, cfg, quem);
  let r: ResultadoEtiqueta | { estado: "incerta"; motivo: string };
  try {
    if (p.adaptador.pedirEtiquetaDevolucao === undefined) {
      throw new ErroDeRede("sem adaptador");
    }
    r = await comTempo(
      cfg,
      p.adaptador.pedirEtiquetaDevolucao(p.credenciais, {
        referencia: `rma_${id}-${String(p.tentativa)}`,
        chaveIdempotencia: `rma_${id}-${String(p.tentativa)}`,
        ...p.pedido,
      }),
    );
  } catch (erro) {
    // Depois de pedir, qualquer falha é incerta: só uma recusa explícita da
    // transportadora recusa (revisão do #447, P1). Nunca se paga duas.
    r = {
      estado: "incerta",
      motivo: `não se sabe se a transportadora criou a etiqueta: ${
        erro instanceof Error ? erro.message : codigoDe(erro)
      }`.slice(0, 500),
    };
  }
  await registar(db, c, id, p.tentativa, quem, r);
  return lerEtiquetaDevolucao(db, c, id, quem);
}

/**
 * Anula a etiqueta (§22.3): é uma pessoa a dizer que a anulou no painel da
 * transportadora (ou que a incerta não existe lá). O ficheiro sai; pode
 * pedir-se outra.
 */
export async function anularEtiquetaDevolucao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  motivo: string,
  quem: string,
): Promise<EtiquetaDaDevolucao> {
  await soltarSeAMeio(db, c, id, quem);
  await noEnvios(db, c, async (trx) => {
    await marcar(trx, quem);
    await trx
      .selectFrom("devolucao")
      .select("id")
      .where("id", "=", id)
      .forUpdate()
      .execute();
    const e = await trx
      .selectFrom("etiqueta_devolucao")
      .select(["estado", "em", "transportadora", "seguimento"])
      .select(
        sql<boolean>`em > now() - make_interval(secs => ${
          INCERTA_IDADE_MINIMA_MS / 1000
        })`.as("recente"),
      )
      .where("devolucao_id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (e === undefined) {
      throw new ErroEnvios(
        "shipping.not_found",
        "esta devolução ainda não tem etiqueta",
      );
    }
    if (e.estado !== "emitida" && e.estado !== "incerta") {
      throw new ErroEnvios(
        "shipping.void_not_allowed",
        e.estado === "a_pedir"
          ? "a etiqueta ainda está a ser pedida: espere pela resposta"
          : `não há etiqueta viva para anular (está «${e.estado}»)`,
      );
    }
    // A transportadora pode ainda estar a criá-la (revisão do #447, P2).
    if (e.estado === "incerta" && e.recente) {
      throw new ErroEnvios(
        "shipping.void_not_allowed",
        `a etiqueta ficou incerta há menos de ${String(
          INCERTA_IDADE_MINIMA_MS / 60_000,
        )} minutos: confirme no painel da transportadora mais tarde`,
      );
    }
    await trx
      .deleteFrom("etiqueta_devolucao_ficheiro")
      .where("devolucao_id", "=", id)
      .execute();
    await trx
      .updateTable("etiqueta_devolucao")
      .set({ estado: "anulada", motivo: motivo.slice(0, 500) })
      .where("devolucao_id", "=", id)
      .execute();
    // A devolução deixa de mostrar o seguimento de uma etiqueta anulada, se
    // ainda for o dela (revisão do #447, P3).
    if (e.seguimento !== null) {
      await trx
        .updateTable("devolucao")
        .set((eb) => ({
          transportadora: null,
          seguimento: null,
          versao: eb("versao", "+", 1),
        }))
        .where("id", "=", id)
        .where("seguimento", "=", e.seguimento)
        .where("transportadora", "=", e.transportadora)
        .execute();
    }
  });
  return lerEtiquetaDevolucao(db, c, id, quem);
}
