import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados, Transportadora } from "../base/esquema.js";
import { aplicarRasto, contextoDaTarefa } from "../base/rasto.js";
import { conteudoDe } from "../checkout/entrega.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { criarProblema } from "../posvenda/repositorio.js";
import { decifrar } from "../pagamentos/cifra.js";
import { mudarExpedicao } from "../stock/repositorio.js";
import {
  ErroDeRede,
  type ConfigEnvios,
  type EtiquetaEmitida,
  type EventoSeguimento,
  type MoradaEtiqueta,
} from "./adaptador.js";
import { porQueNaoServeACaixa, temTelefone } from "./correcoes.js";
import { ErroEnvios } from "./erros.js";
import {
  adaptadorDe,
  credenciaisDe,
  noEnvios,
  servicosDe,
  type Remetente,
} from "./repositorio.js";

// A etiqueta e o seguimento (docs/36 §3.3 a §3.5, §4, §8; migração 0079;
// Diogo, 12/10/2026: «depois avança com a parte B dos envios»). O serviço
// da etiqueta é o vendido (R1); uma etiqueta viva por expedição, e uma
// incerta nunca se repete às cegas (R2); os estados da expedição só andam
// para a frente, pelas mesmas portas do armazém (`mudarExpedicao`).

export const QUEM_DAS_TAREFAS = "sistema:envios";

/** Uma etiqueta `a_pedir` há mais do que isto ficou a meio (a API reiniciou). */
const A_PEDIR_PRESA_MS = 5 * 60 * 1000;
/**
 * Antes disto, «não existe» na consulta de uma incerta ainda pode ser a
 * transportadora a processar: não se conclui (revisão do #400, P2-2). A
 * confirmar com a especificação dos CTT (docs/36 V4).
 */
const INCERTA_IDADE_MINIMA_MS = 15 * 60 * 1000;

/**
 * Nenhuma chamada à transportadora fica à espera para sempre (revisão do
 * #400, P2-6): esgotado o tempo, é como a rede ter falhado.
 */
export function comTempo<T>(
  cfg: ConfigEnvios | undefined,
  p: Promise<T>,
): Promise<T> {
  const ms = cfg?.tempoLimiteMs ?? 30_000;
  let t: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    t = setTimeout(() => {
      rejeitar(new ErroDeRede("a transportadora não respondeu a tempo"));
    }, ms);
  });
  return Promise.race([p, limite]).finally(() => {
    clearTimeout(t);
  });
}

/** O código de um erro, sem dados (para o registo e para os problemas). */
export const codigoDe = (erro: unknown) =>
  typeof (erro as { codigo?: unknown }).codigo === "string"
    ? (erro as { codigo: string }).codigo
    : erro instanceof Error
      ? erro.name
      : "erro";

async function marcar(
  trx: Transaction<BaseDados>,
  quem: string,
  motivo: string | null = null,
) {
  await sql`select set_config('eurolify.quem', ${quem}, true),
    set_config('eurolify.motivo', ${motivo ?? ""}, true)`.execute(trx);
}

/** O que o método vendido diz da etiqueta (a cópia da encomenda, 0074). */
interface MetodoVendido {
  conta?: string;
  servico?: string;
}

/** A referência na transportadora: «<expedição>-<tentativa>» (R2). */
export const referenciaDe = (expedicao: string, tentativa: number) =>
  `${expedicao}-${String(tentativa)}`;

/** O estado da etiqueta, como a API o mostra. */
export async function lerEtiqueta(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noEnvios(db, c, async (trx) => {
    const x = await trx
      .selectFrom("expedicao")
      .select([
        "id",
        "estado",
        "etiqueta",
        "etiqueta_tentativa",
        "etiqueta_motivo",
        "etiqueta_em",
        "transportadora",
        "servico",
        "seguimento",
        "url_seguimento",
        "peso_g",
        "conta_transportadora_id",
        "peso_corrigido_g",
        "conta_escolhida_id",
        "servico_escolhido",
        "versao",
      ])
      .where("id", "=", id)
      .executeTakeFirst();
    if (x === undefined) {
      throw new ErroEnvios("shipping.not_found", "esta expedição não existe");
    }
    const f = await trx
      .selectFrom("etiqueta_ficheiro")
      .select(["formato"])
      .where("expedicao_id", "=", id)
      .executeTakeFirst();
    return { ...x, ficheiro: f?.formato ?? null };
  });
}

interface Preparado {
  expedicao: string;
  tentativa: number;
  conta: { id: string; transportadora: Transportadora };
  credenciais: ReturnType<typeof credenciaisDe>;
  pedidoBase: {
    servico: string;
    remetente: MoradaEtiqueta;
    destinatario: MoradaEtiqueta;
    pesoG: number;
    ponto?: string;
  };
}

/**
 * Prepara o pedido numa transacção: a expedição fica `a_pedir` com a
 * tentativa nova, a conta e o serviço vendidos e o peso da caixa (as
 * variantes-folha mais a embalagem do armazém, Q6). A chamada à
 * transportadora fica fora da transacção.
 */
async function preparar(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigEnvios | undefined,
  quem: string,
): Promise<Preparado> {
  return noEnvios(db, c, async (trx) => {
    await marcar(trx, quem, "pedir a etiqueta");
    // A expedição bloqueada primeiro: dois pedidos ao mesmo tempo esperam um
    // pelo outro, e o segundo vê a etiqueta `a_pedir` (R2).
    await trx
      .selectFrom("expedicao")
      .select("id")
      .where("id", "=", id)
      .forUpdate()
      .execute();
    const x = await trx
      .selectFrom("expedicao")
      .innerJoin("armazem", "armazem.id", "expedicao.armazem_id")
      .innerJoin("encomenda", "encomenda.id", "expedicao.encomenda_id")
      .select([
        "expedicao.id",
        "expedicao.estado",
        "expedicao.etiqueta",
        "expedicao.etiqueta_tentativa",
        "expedicao.metodo_entrega",
        "expedicao.peso_corrigido_g",
        "expedicao.conta_escolhida_id",
        "expedicao.servico_escolhido",
        "armazem.embalagem_g",
        "encomenda.entrega",
        "encomenda.contacto",
      ])
      .where("expedicao.id", "=", id)
      .executeTakeFirst();
    if (x === undefined) {
      throw new ErroEnvios("shipping.not_found", "esta expedição não existe");
    }
    if (x.estado !== "criada") {
      throw new ErroEnvios("shipping.label_exists", "a expedição já saiu");
    }
    if (x.etiqueta === "incerta") {
      throw new ErroEnvios(
        "shipping.label_uncertain",
        "não se sabe se a etiqueta anterior existe: consulta-se primeiro (POST …/refresh)",
      );
    }
    if (x.etiqueta === "a_pedir" || x.etiqueta === "emitida") {
      throw new ErroEnvios(
        "shipping.label_exists",
        "a expedição já tem uma etiqueta (anula-se primeiro)",
      );
    }
    // O serviço escolhido por uma pessoa, com motivo, ganha ao vendido
    // (docs/36 §19); sem ele, o vendido (R1).
    const metodo = x.metodo_entrega as MetodoVendido;
    const escolhido = x.conta_escolhida_id !== null;
    const contaId = x.conta_escolhida_id ?? metodo.conta;
    const codigoServico = x.servico_escolhido ?? metodo.servico;
    if (contaId === undefined || codigoServico === undefined) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        "o método vendido é manual (sem transportadora): a etiqueta faz-se fora do Eurolify, ou escolhe-se um serviço (PUT …/service)",
      );
    }
    const conta = await trx
      .selectFrom("conta_transportadora")
      .select([
        "id",
        "transportadora",
        "estado",
        "remetente",
        "credenciais_cifra",
        "chave_versao",
        "servicos",
      ])
      .where("id", "=", contaId)
      .forShare()
      .executeTakeFirst();
    if (conta?.estado !== "pronta") {
      throw new ErroEnvios(
        "shipping.account_not_ready",
        escolhido
          ? "a conta da transportadora escolhida não está pronta"
          : "a conta da transportadora do método vendido não está pronta",
      );
    }
    const { adaptador, chave } = adaptadorDe(cfg, conta.transportadora);
    // As credenciais leem-se antes de a etiqueta passar a `a_pedir`: uma
    // conta que já não se decifra não deixa a expedição presa (revisão do
    // #400, P1-1).
    const credenciais = credenciaisDe(conta, chave);
    const servico = servicosDe(adaptador, conta.servicos).find(
      (s) => s.codigo === codigoServico,
    );
    if (servico === undefined) {
      throw new ErroEnvios(
        "shipping.service_unknown",
        "a transportadora já não tem este serviço: muda-o uma pessoa, com motivo (PUT …/service)",
      );
    }
    const linhas = await trx
      .selectFrom("linha_expedicao")
      .innerJoin(
        "linha_encomenda",
        "linha_encomenda.id",
        "linha_expedicao.linha_encomenda_id",
      )
      .select(["linha_encomenda.variante_id", "linha_expedicao.quantidade"])
      .where("linha_expedicao.expedicao_id", "=", id)
      .execute();
    const { pesoG, onu } = await conteudoDe(trx, linhas);
    // O peso corrigido por uma pessoa ganha ao calculado (docs/36 §19).
    if (x.peso_corrigido_g === null && pesoG === null) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        "uma variante da expedição não tem peso: corrija o peso da expedição (PUT …/weight) ou o da variante",
      );
    }
    const peso = x.peso_corrigido_g ?? (pesoG ?? 0) + x.embalagem_g;
    if (servico.pesoMaxG !== null && peso > servico.pesoMaxG) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        "a caixa pesa mais do que o serviço aceita",
        { peso_g: peso, peso_max_g: servico.pesoMaxG },
      );
    }
    // O serviço confere-se outra vez ao pedir (o escolhido não passou pelo
    // checkout, e a fotografia dos serviços de uma conta pode mudar): o
    // país, o peso, os perigosos e o telefone (R4, L9; revisão do #429, P2-2).
    const entregaPais = (x.entrega as { pais: string }).pais;
    const telefone = (x.contacto as { telefone?: unknown }).telefone;
    const pontoId = (x.entrega as { ponto?: { id?: unknown } }).ponto?.id;
    const porque = porQueNaoServeACaixa(servico, {
      pais: entregaPais,
      ponto: pontoId !== undefined,
      temTelefone: temTelefone(telefone),
      pesoG: peso,
      onu,
    });
    if (porque !== null) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        `${escolhido ? "o serviço escolhido" : "o serviço vendido"} não serve esta expedição: ${porque}`,
      );
    }
    const entrega = x.entrega as {
      linha1: string;
      linha2?: string | null;
      codigo_postal: string;
      localidade: string;
      pais: string;
    };
    const contacto = x.contacto as {
      nome: string;
      email: string;
      telefone: string | null;
    };
    // Só o que a entrega precisa (docs/36 §6): o telefone e o e-mail só
    // quando o serviço os pede.
    const destinatario: MoradaEtiqueta = {
      nome: contacto.nome,
      linha1: entrega.linha1,
      ...(entrega.linha2 ? { linha2: entrega.linha2 } : {}),
      codigo_postal: entrega.codigo_postal,
      localidade: entrega.localidade,
      pais: entrega.pais,
      ...(servico.pedeTelefone && temTelefone(contacto.telefone)
        ? { telefone: contacto.telefone }
        : {}),
      ...(servico.pedeEmail ? { email: contacto.email } : {}),
    };
    const tentativa = x.etiqueta_tentativa + 1;
    await trx
      .updateTable("expedicao")
      .set({
        etiqueta: "a_pedir",
        etiqueta_tentativa: tentativa,
        etiqueta_motivo: null,
        conta_transportadora_id: conta.id,
        transportadora: conta.transportadora,
        servico: servico.codigo,
        peso_g: peso,
      })
      .where("id", "=", id)
      .execute();
    const r = conta.remetente as unknown as Remetente;
    return {
      expedicao: id,
      tentativa,
      conta: { id: conta.id, transportadora: conta.transportadora },
      credenciais,
      pedidoBase: {
        servico: servico.codigo,
        remetente: { ...r },
        destinatario,
        pesoG: peso,
        // O ponto escolhido no checkout (§21); a morada acima é a dele.
        ...(typeof pontoId === "string" ? { ponto: pontoId } : {}),
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
  r:
    | ({ estado: "emitida" } & EtiquetaEmitida)
    | { estado: "recusada"; motivo: string }
    | { estado: "incerta"; motivo: string },
) {
  await noEnvios(db, c, async (trx) => {
    await marcar(trx, quem, `etiqueta ${r.estado}`);
    const x = await trx
      .selectFrom("expedicao")
      .select(["etiqueta", "etiqueta_tentativa"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (
      x.etiqueta_tentativa !== tentativa ||
      !(x.etiqueta === "a_pedir" || x.etiqueta === "incerta")
    ) {
      return;
    }
    if (r.estado === "emitida") {
      await trx
        .deleteFrom("etiqueta_ficheiro")
        .where("expedicao_id", "=", id)
        .execute();
      await trx
        .insertInto("etiqueta_ficheiro")
        .values({
          expedicao_id: id,
          comerciante_id: c,
          tentativa,
          formato: r.ficheiro.formato,
          conteudo: r.ficheiro.conteudo,
        })
        .execute();
      await trx
        .updateTable("expedicao")
        .set({
          etiqueta: "emitida",
          etiqueta_motivo: null,
          seguimento: r.seguimento,
          url_seguimento: r.urlSeguimento,
        })
        .where("id", "=", id)
        .execute();
      return;
    }
    if (r.estado === "incerta" && x.etiqueta === "incerta") return;
    await trx
      .updateTable("expedicao")
      .set({
        etiqueta: r.estado,
        etiqueta_motivo: r.motivo.slice(0, 500),
      })
      .where("id", "=", id)
      .execute();
  });
}

/**
 * Pede a etiqueta à transportadora (docs/36 §7.1, `POST …/label`). Sem
 * resposta, a etiqueta fica `incerta` e não se pede outra até se saber.
 */
export async function pedirEtiqueta(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigEnvios | undefined,
  quem: string,
) {
  const p = await preparar(db, c, id, cfg, quem);
  const { adaptador } = adaptadorDe(cfg, p.conta.transportadora);
  const referencia = referenciaDe(p.expedicao, p.tentativa);
  try {
    const r = await comTempo(
      cfg,
      adaptador.pedirEtiqueta(p.credenciais, {
        referencia,
        chaveIdempotencia: referencia,
        ...p.pedidoBase,
      }),
    );
    await registar(db, c, id, p.tentativa, quem, r);
  } catch (erro) {
    // Qualquer falha depois de pedir: não se sabe se a etiqueta existe.
    await registar(db, c, id, p.tentativa, quem, {
      estado: "incerta",
      motivo:
        erro instanceof ErroDeRede
          ? "a transportadora não respondeu"
          : "a resposta da transportadora não se leu",
    });
  }
  return lerEtiqueta(db, c, id);
}

/** A conta da expedição e as credenciais, para falar com a transportadora. */
async function contaDaExpedicao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigEnvios | undefined,
) {
  const x = await noEnvios(db, c, (trx) =>
    trx
      .selectFrom("expedicao")
      .leftJoin(
        "conta_transportadora",
        "conta_transportadora.id",
        "expedicao.conta_transportadora_id",
      )
      .select([
        "expedicao.id",
        "expedicao.estado",
        "expedicao.etiqueta",
        "expedicao.etiqueta_tentativa",
        "expedicao.etiqueta_em",
        "expedicao.etiqueta_motivo",
        "expedicao.encomenda_id",
        "expedicao.seguimento",
        "conta_transportadora.id as conta_id",
        "conta_transportadora.transportadora",
        "conta_transportadora.credenciais_cifra",
        "conta_transportadora.chave_versao",
      ])
      .where("expedicao.id", "=", id)
      .executeTakeFirst(),
  );
  if (x === undefined) {
    throw new ErroEnvios("shipping.not_found", "esta expedição não existe");
  }
  if (x.conta_id === null || x.transportadora === null) {
    throw new ErroEnvios(
      "shipping.invalid_field",
      "a expedição não tem etiqueta do Eurolify",
    );
  }
  const { adaptador, chave } = adaptadorDe(cfg, x.transportadora);
  const credenciais = credenciaisDe(
    {
      id: x.conta_id,
      credenciais_cifra: x.credenciais_cifra,
      chave_versao: x.chave_versao,
    },
    chave,
  );
  return { x, adaptador, credenciais };
}

/** Anula a etiqueta, se a transportadora deixar (docs/36 §4.1). */
export async function anularEtiqueta(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigEnvios | undefined,
  quem: string,
) {
  const { x, adaptador, credenciais } = await contaDaExpedicao(db, c, id, cfg);
  if (x.etiqueta !== "emitida" || x.seguimento === null) {
    throw new ErroEnvios(
      "shipping.void_not_allowed",
      "só se anula uma etiqueta emitida",
    );
  }
  if (x.estado !== "criada") {
    throw new ErroEnvios("shipping.void_not_allowed", "a expedição já saiu");
  }
  let r: "anulada" | "nao_permitido";
  try {
    r = await comTempo(
      cfg,
      adaptador.anularEtiqueta(credenciais, x.seguimento),
    );
  } catch {
    throw new ErroEnvios(
      "shipping.carrier_unavailable",
      "a transportadora não respondeu: a etiqueta continua emitida",
    );
  }
  if (r === "nao_permitido") {
    throw new ErroEnvios(
      "shipping.void_not_allowed",
      "a transportadora não deixa anular esta etiqueta",
    );
  }
  await noEnvios(db, c, async (trx) => {
    await marcar(trx, quem, "etiqueta anulada");
    await trx
      .deleteFrom("etiqueta_ficheiro")
      .where("expedicao_id", "=", id)
      .execute();
    await trx
      .updateTable("expedicao")
      .set({ etiqueta: "anulada", seguimento: null, url_seguimento: null })
      .where("id", "=", id)
      .where("etiqueta", "=", "emitida")
      .execute();
  });
  return lerEtiqueta(db, c, id);
}

/**
 * Uma etiqueta incerta (§4.1): pergunta-se à transportadora pela nossa
 * referência. Existe ⇒ emitida; não existe (passado o mínimo) ⇒ recusada
 * (pode pedir-se outra). Sem resposta durante um dia ⇒ um problema para uma
 * pessoa (Q4), uma vez só: a marca e o problema na mesma transacção.
 */
export async function resolverIncerta(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigEnvios | undefined,
  quem: string,
): Promise<"resolvida" | "sem_resposta"> {
  const { x, adaptador, credenciais } = await contaDaExpedicao(db, c, id, cfg);
  if (x.etiqueta !== "incerta") return "resolvida";
  const idade =
    x.etiqueta_em === null ? 0 : Date.now() - x.etiqueta_em.getTime();
  try {
    const e = await comTempo(
      cfg,
      adaptador.consultarEtiqueta(
        credenciais,
        referenciaDe(id, x.etiqueta_tentativa),
      ),
    );
    if (e === null && idade < INCERTA_IDADE_MINIMA_MS) return "sem_resposta";
    await registar(
      db,
      c,
      id,
      x.etiqueta_tentativa,
      quem,
      e === null
        ? {
            estado: "recusada",
            motivo:
              "a etiqueta não chegou à transportadora; pode pedir-se outra",
          }
        : { estado: "emitida", ...e },
    );
    return "resolvida";
  } catch (erro) {
    // Um erro nosso (a base recusou) não é a transportadora calada.
    if (erro instanceof ErroEnvios) throw erro;
    if (idade > 24 * 60 * 60 * 1000) {
      await noEnvios(db, c, async (trx) => {
        await marcar(trx, quem);
        const r = await trx
          .updateTable("expedicao")
          .set({ etiqueta_motivo: "problema aberto" })
          .where("id", "=", id)
          .where("etiqueta", "=", "incerta")
          .where((w) =>
            w.or([
              w("etiqueta_motivo", "is", null),
              w("etiqueta_motivo", "!=", "problema aberto"),
            ]),
          )
          .executeTakeFirst();
        if (Number(r.numUpdatedRows) === 0) return;
        await criarProblema(
          trx,
          c,
          {
            encomenda: x.encomenda_id,
            tipo: "outro",
            descricao: `Não se sabe se a etiqueta da expedição shp_${id} existe na transportadora (sem resposta há mais de um dia). Confirme na transportadora antes de pedir outra.`,
          },
          quem,
        );
      });
    }
    return "sem_resposta";
  }
}

/** O pedido ficou a meio (a API reiniciou): passa a incerta e consulta-se. */
async function soltarAPedir(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  tentativa: number,
  em: Date | null,
) {
  if (em !== null && Date.now() - em.getTime() < A_PEDIR_PRESA_MS) return;
  await registar(db, c, id, tentativa, QUEM_DAS_TAREFAS, {
    estado: "incerta",
    motivo: "o pedido à transportadora ficou a meio",
  });
}

/** Um evento que se pode gravar (revisão do #400, P3-2). */
const eventoValido = (e: EventoSeguimento) =>
  e.idExterno.trim().length >= 1 &&
  e.idExterno.length <= 200 &&
  e.estadoTransportadora.length >= 1 &&
  !Number.isNaN(e.em.getTime());

/**
 * Aplica os eventos de seguimento (§4.2): cada um entra uma vez (o mesmo
 * `id_externo` não conta duas vezes); só os novos mudam a expedição, pela
 * ordem da data deles, e só para a frente. Perdida, devolvida, uma
 * contradição ou uma mudança que o armazém recuse ⇒ um problema para uma
 * pessoa (Q4), na mesma transacção que os eventos: os eventos ficam sempre
 * gravados e o problema não se perde (revisão do #400, P2-3).
 */
export async function aplicarEventos(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  eventos: readonly EventoSeguimento[],
  origem: "aviso" | "consulta",
  quem: string,
): Promise<number> {
  return noEnvios(db, c, async (trx) => {
    await marcar(trx, quem, `seguimento (${origem})`);
    const novos: EventoSeguimento[] = [];
    const problemas: string[] = [];
    // Num envio para um ponto de recolha, chegar ao ponto não é entregar
    // (docs/36 §21, L5): um «entregue» que não venha depois de um «para
    // levantar» pode ser só o depósito no ponto. Fica em «outro», no
    // histórico, e uma pessoa confirma a entrega (V8, C).
    const destino = await trx
      .selectFrom("expedicao")
      .innerJoin("encomenda", "encomenda.id", "expedicao.encomenda_id")
      .select("encomenda.entrega")
      .where("expedicao.id", "=", id)
      .executeTakeFirst();
    const paraPonto =
      (destino?.entrega as { ponto?: unknown } | undefined)?.ponto !==
      undefined;
    let levantar =
      paraPonto &&
      (await trx
        .selectFrom("evento_seguimento")
        .select("id")
        .where("expedicao_id", "=", id)
        .where("estado_normalizado", "=", "disponivel_para_levantar")
        .executeTakeFirst()) !== undefined;
    const ordenados = [...eventos.filter(eventoValido)].sort(
      (a, b) => a.em.getTime() - b.em.getTime(),
    );
    const prudentes = ordenados.map((e) => {
      if (!paraPonto) return e;
      if (e.estadoNormalizado === "disponivel_para_levantar") levantar = true;
      if (e.estadoNormalizado !== "entregue" || levantar) return e;
      return { ...e, estadoNormalizado: "outro" as const };
    });
    for (const [n, e] of prudentes.entries()) {
      const r = await trx
        .insertInto("evento_seguimento")
        .values({
          comerciante_id: c,
          expedicao_id: id,
          origem,
          id_externo: e.idExterno,
          estado_transportadora: e.estadoTransportadora.slice(0, 100),
          estado_normalizado: e.estadoNormalizado,
          em: e.em,
        })
        .onConflict((oc) =>
          oc.columns(["expedicao_id", "id_externo"]).doNothing(),
        )
        .returning("id")
        .executeTakeFirst();
      if (r !== undefined) {
        novos.push(e);
        if (e.estadoNormalizado !== ordenados[n]?.estadoNormalizado) {
          problemas.push(
            `A transportadora deu a expedição shp_${id}, para um ponto de recolha, como entregue (${e.em.toISOString()}) sem antes a dar como disponível para levantar. Pode ser só a chegada ao ponto: confirmar com a transportadora e marcar a entrega à mão (docs/36 §21).`,
          );
        }
      }
    }
    novos.sort((a, b) => a.em.getTime() - b.em.getTime());
    const passar = async (
      estado: "expedida" | "entregue" | "devolvida_ao_remetente" | "perdida",
      prova?: string,
    ) => {
      const actual = await trx
        .selectFrom("expedicao")
        .select("versao")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      await mudarExpedicao(
        trx,
        c,
        id,
        actual.versao,
        { estado, ...(prova === undefined ? {} : { prova_entrega: prova }) },
        quem,
      );
    };
    for (const e of novos) {
      const x = await trx
        .selectFrom("expedicao")
        .select("estado")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      const quando = e.em.toISOString();
      // Cada mudança num ponto de retorno: se o armazém a recusa (ex.: um
      // lote sem saldo), os eventos ficam e uma pessoa trata (P2-3).
      await sql`savepoint seguimento`.execute(trx);
      try {
        switch (e.estadoNormalizado) {
          case "recolhida":
          case "em_transito":
            if (x.estado === "criada") await passar("expedida");
            break;
          case "entregue":
            if (x.estado === "criada") await passar("expedida");
            if (x.estado === "criada" || x.estado === "expedida") {
              await passar(
                "entregue",
                `transportadora: evento ${e.idExterno} de ${quando}`.slice(
                  0,
                  500,
                ),
              );
            } else if (x.estado !== "entregue") {
              problemas.push(
                `A transportadora deu a expedição shp_${id} como entregue (${quando}), mas no Eurolify está «${x.estado}». Confirmar com a transportadora.`,
              );
            }
            break;
          case "devolvida":
          case "perdida":
            if (x.estado === "criada") await passar("expedida");
            if (x.estado === "criada" || x.estado === "expedida") {
              await passar(
                e.estadoNormalizado === "perdida"
                  ? "perdida"
                  : "devolvida_ao_remetente",
              );
              problemas.push(
                e.estadoNormalizado === "perdida"
                  ? `A transportadora deu a expedição shp_${id} como perdida (${quando}). A perda até à entrega é do comerciante (docs/36 L5): reenviar ou reembolsar.`
                  : `A expedição shp_${id} foi devolvida ao remetente (${quando}). Contactar o cliente: reenviar ou reembolsar.`,
              );
            } else if (x.estado === "entregue") {
              // Só para a frente (§4.2), mas a contradição vê-a uma pessoa.
              problemas.push(
                `A transportadora deu a expedição shp_${id}, já entregue, como ${e.estadoNormalizado === "perdida" ? "perdida" : "devolvida"} (${quando}). Confirmar com a transportadora.`,
              );
            }
            break;
          default:
            // Tentativa falhada, para levantar, outro: só no histórico.
            break;
        }
        await sql`release savepoint seguimento`.execute(trx);
      } catch (erro) {
        await sql`rollback to savepoint seguimento`.execute(trx);
        problemas.push(
          `O evento «${e.estadoNormalizado}» da transportadora (${quando}) não mudou a expedição shp_${id}: ${codigoDe(erro)}. Tratar à mão.`,
        );
        break;
      }
    }
    if (problemas.length > 0) {
      const { encomenda_id } = await trx
        .selectFrom("expedicao")
        .select("encomenda_id")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      for (const descricao of problemas) {
        await criarProblema(
          trx,
          c,
          { encomenda: encomenda_id, tipo: "outro", descricao },
          quem,
        );
      }
    }
    return novos.length;
  });
}

/** Consulta o seguimento agora (`POST …/refresh`, e a tarefa). */
export async function consultarSeguimento(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigEnvios | undefined,
  quem: string,
): Promise<number> {
  const { x, adaptador, credenciais } = await contaDaExpedicao(db, c, id, cfg);
  if (x.etiqueta === "incerta") {
    await resolverIncerta(db, c, id, cfg, quem);
    return 0;
  }
  if (x.etiqueta !== "emitida" || x.seguimento === null) {
    throw new ErroEnvios(
      "shipping.invalid_field",
      "a expedição não tem etiqueta emitida",
    );
  }
  let eventos: EventoSeguimento[];
  try {
    eventos = await comTempo(
      cfg,
      adaptador.consultarSeguimento(credenciais, x.seguimento),
    );
  } catch {
    throw new ErroEnvios(
      "shipping.carrier_unavailable",
      "a transportadora não respondeu",
    );
  }
  return aplicarEventos(db, c, id, eventos, "consulta", quem);
}

/** Os eventos de seguimento de uma expedição, por ordem. */
export async function listarEventos(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noEnvios(db, c, async (trx) => {
    const x = await trx
      .selectFrom("expedicao")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (x === undefined) {
      throw new ErroEnvios("shipping.not_found", "esta expedição não existe");
    }
    return trx
      .selectFrom("evento_seguimento")
      .select([
        "origem",
        "id_externo",
        "estado_transportadora",
        "estado_normalizado",
        "em",
        "recebido_em",
      ])
      .where("expedicao_id", "=", id)
      .orderBy("em")
      .orderBy("id")
      .execute();
  });
}

/** O ficheiro da etiqueta, enquanto existir (Q7). */
export async function ficheiroDaEtiqueta(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  const f = await noEnvios(db, c, (trx) =>
    trx
      .selectFrom("etiqueta_ficheiro")
      .select(["formato", "conteudo"])
      .where("expedicao_id", "=", id)
      .executeTakeFirst(),
  );
  if (f === undefined) {
    throw new ErroEnvios(
      "shipping.not_found",
      "esta expedição não tem ficheiro de etiqueta (ou já foi apagado)",
    );
  }
  return f;
}

/** O peso da embalagem por omissão de um armazém (Q6). */
export async function definirEmbalagem(
  trx: Transaction<BaseDados>,
  c: string,
  armazem: string,
  embalagemG: number,
) {
  return noEnvios(trx, c, async () => {
    const r = await trx
      .updateTable("armazem")
      .set({ embalagem_g: embalagemG })
      .where("id", "=", armazem)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) {
      throw new ErroEnvios("shipping.not_found", "este armazém não existe");
    }
  });
}

/** O comerciante de uma conta, pelo endereço do aviso (0079). */
export async function comercianteDaConta(
  db: Kysely<BaseDados>,
  conta: string,
): Promise<string | null> {
  const { rows } = await sql<{
    c: string | null;
  }>`select envios_conta_do_aviso(${conta}::uuid) as c`.execute(db);
  return rows[0]?.c ?? null;
}

/**
 * Recebe um aviso de seguimento (R3): grava-o em bruto antes de o tratar;
 * só com a assinatura certa muda alguma coisa. Responde `false` quando a
 * assinatura não confere.
 */
export async function receberAviso(
  db: Kysely<BaseDados>,
  c: string,
  conta: string,
  cabecalhos: Record<string, string | string[] | undefined>,
  corpo: string,
  cfg: ConfigEnvios | undefined,
): Promise<boolean> {
  const dados = await noEnvios(db, c, (trx) =>
    trx
      .selectFrom("conta_transportadora")
      .select(["id", "transportadora", "segredo_aviso_cifra", "chave_versao"])
      .where("id", "=", conta)
      .executeTakeFirst(),
  );
  if (dados === undefined) return false;
  const { adaptador, chave } = adaptadorDe(cfg, dados.transportadora);
  let leitura: ReturnType<typeof adaptador.lerAviso> = { valido: false };
  if (
    dados.segredo_aviso_cifra !== null &&
    dados.chave_versao === chave.versao
  ) {
    // A decifra também dentro do `try`: um segredo estragado é um aviso que
    // não se lê, e fica gravado como os outros (revisão do #400, P3-5).
    try {
      const segredo = decifrar(
        dados.segredo_aviso_cifra,
        conta,
        "segredo_aviso",
        chave,
      );
      leitura = adaptador.lerAviso(cabecalhos, corpo, segredo);
    } catch {
      leitura = { valido: false };
    }
  }
  const aviso = await noEnvios(db, c, async (trx) => {
    const { id } = await trx
      .insertInto("aviso_transportadora")
      .values({
        comerciante_id: c,
        conta_id: conta,
        corpo: corpo.slice(0, 65536),
        assinatura_valida: leitura.valido,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
  if (!leitura.valido) return false;
  // A expedição pela nossa referência («<expedição>-<tentativa>», só a
  // tentativa viva), ou pelo número de seguimento, sempre da conta que
  // avisou e com a etiqueta emitida ou incerta (revisão do #400, P3-1).
  const expedicao = await noEnvios(db, c, async (trx) => {
    let q = trx
      .selectFrom("expedicao")
      .select("id")
      .where("conta_transportadora_id", "=", conta)
      .where("etiqueta", "in", ["emitida", "incerta"]);
    const ref = leitura.referencia?.match(/^([0-9a-f-]{36})-(\d+)$/);
    if (ref?.[1] !== undefined && ref[2] !== undefined) {
      q = q
        .where("id", "=", ref[1])
        .where("etiqueta_tentativa", "=", Number(ref[2]));
    } else if (leitura.seguimento !== null) {
      q = q.where("seguimento", "=", leitura.seguimento);
    } else {
      return undefined;
    }
    return (await q.executeTakeFirst())?.id;
  });
  const fechar = (
    resultado: "tratado" | "ignorado" | "erro",
    erro: string | null = null,
  ) =>
    noEnvios(db, c, (trx) =>
      trx
        .updateTable("aviso_transportadora")
        .set({
          resultado,
          erro,
          processado_em: new Date(),
          ...(expedicao === undefined ? {} : { expedicao_id: expedicao }),
        })
        .where("id", "=", aviso)
        .execute(),
    );
  if (expedicao === undefined) {
    await fechar("ignorado", "a expedição do aviso não se encontrou");
    return true;
  }
  try {
    await aplicarEventos(
      db,
      c,
      expedicao,
      leitura.eventos,
      "aviso",
      QUEM_DAS_TAREFAS,
    );
    // Um aviso sem eventos é um sinal para consultar (docs/36 §16, D4: a
    // Sendcloud): a volta consulta esta expedição daqui a um minuto.
    // Só numa expedição que ainda anda: numa acabada, o trabalho é apagar o
    // ficheiro aos 30 dias (Q7), e não se antecipa (revisão do #406, P2-3).
    if (leitura.eventos.length === 0) {
      await noEnvios(db, c, async (trx) => {
        const x = await trx
          .selectFrom("expedicao")
          .select("estado")
          .where("id", "=", expedicao)
          .executeTakeFirstOrThrow();
        if (x.estado === "criada" || x.estado === "expedida") {
          await sql`select envios_trabalho_adiar(${expedicao}::uuid, 1)`.execute(
            trx,
          );
        }
      });
    }
    await fechar("tratado");
  } catch (erro) {
    await fechar("erro", erro instanceof Error ? erro.name : "erro");
    throw erro;
  }
  return true;
}

/** O que uma volta fez: as falhas contam-se, com o código (P2-4). */
export interface ResultadoVolta {
  feitos: number;
  falhas: number;
  erros: Record<string, number>;
  avisosResumidos: number;
}

/**
 * A volta da API (docs/36 §4): segue as etiquetas emitidas até a expedição
 * acabar, resolve as incertas e as que ficaram a meio, apaga os ficheiros 30
 * dias depois (Q7) e resume os avisos que não se ligaram a nada. Um
 * comerciante ou uma expedição que falhe não pára os outros, e conta-se.
 */
export async function correrTrabalho(
  db: Kysely<BaseDados>,
  cfg: ConfigEnvios | undefined,
  porVolta = 50,
): Promise<ResultadoVolta> {
  const r: ResultadoVolta = {
    feitos: 0,
    falhas: 0,
    erros: {},
    avisosResumidos: 0,
  };
  const falhou = (erro: unknown) => {
    r.falhas += 1;
    const k = codigoDe(erro);
    r.erros[k] = (r.erros[k] ?? 0) + 1;
  };
  try {
    const { rows } = await sql<{
      n: number;
    }>`select envios_avisos_resumir() as n`.execute(db);
    r.avisosResumidos = rows[0]?.n ?? 0;
  } catch (erro) {
    falhou(erro);
  }
  const { rows } = await sql<{
    c: string;
  }>`select envios_comerciantes_com_trabalho() as c`.execute(db);
  for (const { c } of rows) {
    let ids: string[];
    try {
      ids = await comComerciante(db, c, async (trx) => {
        const { rows: l } = await sql<{
          id: string;
        }>`select e as id from envios_trabalho(${porVolta}) as e`.execute(trx);
        return l.map((x) => x.id);
      });
    } catch (erro) {
      falhou(erro);
      continue;
    }
    for (const id of ids) {
      try {
        const x = await noEnvios(db, c, (trx) =>
          trx
            .selectFrom("expedicao")
            .select(["estado", "etiqueta", "etiqueta_tentativa", "etiqueta_em"])
            .where("id", "=", id)
            .executeTakeFirstOrThrow(),
        );
        const acabada = [
          "entregue",
          "devolvida_ao_remetente",
          "perdida",
          "cancelada",
        ].includes(x.estado);
        if (acabada) {
          await comComerciante(db, c, async (trx) => {
            await aplicarRasto(trx, contextoDaTarefa("envios", null));
            await trx
              .deleteFrom("etiqueta_ficheiro")
              .where("expedicao_id", "=", id)
              .execute();
            await sql`select envios_trabalho_feito(${id}::uuid)`.execute(trx);
          });
        } else if (x.etiqueta === "a_pedir") {
          await soltarAPedir(db, c, id, x.etiqueta_tentativa, x.etiqueta_em);
        } else if (x.etiqueta === "incerta") {
          await resolverIncerta(db, c, id, cfg, QUEM_DAS_TAREFAS);
        } else if (x.etiqueta === "emitida") {
          await consultarSeguimento(db, c, id, cfg, QUEM_DAS_TAREFAS);
        }
        r.feitos += 1;
      } catch (erro) {
        // A transportadora não respondeu, ou a conta já não se decifra:
        // tenta-se mais tarde, e a falha conta.
        falhou(erro);
      }
      // A próxima volta, só se a expedição ainda está a andar: a que acabou
      // já tem o trabalho dos 30 dias posto pelo gatilho (Q7).
      try {
        await comComerciante(db, c, async (trx) => {
          const y = await trx
            .selectFrom("expedicao")
            .select(["estado", "etiqueta"])
            .where("id", "=", id)
            .executeTakeFirstOrThrow();
          if (
            (y.estado === "criada" || y.estado === "expedida") &&
            y.etiqueta !== "a_pedir"
          ) {
            await sql`select envios_trabalho_adiar(${id}::uuid, 60)`.execute(
              trx,
            );
          }
        });
      } catch (erro) {
        falhou(erro);
      }
    }
  }
  return r;
}

export function agendarTrabalhoEnvios(
  base: Kysely<BaseDados>,
  cfg: ConfigEnvios | undefined,
  registo: {
    info: (o: object, m: string) => void;
    error: (o: object, m: string) => void;
  },
): () => void {
  let aCorrer = false;
  const t = setInterval(
    () => {
      if (aCorrer) return;
      aCorrer = true;
      correrTrabalho(base, cfg)
        .then((r) => {
          if (r.falhas > 0) {
            registo.error(r, "envios: a volta correu com falhas");
          } else if (r.feitos > 0 || r.avisosResumidos > 0) {
            registo.info(r, "envios: a volta correu");
          }
        })
        .catch((erro: unknown) => {
          registo.error({ erro: codigoDe(erro) }, "envios: a volta falhou");
        })
        .finally(() => {
          aCorrer = false;
        });
    },
    5 * 60 * 1000,
  );
  t.unref();
  return () => {
    clearInterval(t);
  };
}
