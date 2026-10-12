import type { Kysely, Transaction } from "kysely";
import type { BaseDados, Transportadora } from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { cifrar, decifrar, type ChavePagamentos } from "../pagamentos/cifra.js";
import {
  ErroDeRede,
  type AdaptadorTransportadora,
  type ConfigEnvios,
  type CredenciaisTransportadora,
  type ServicoTransportadora,
} from "./adaptador.js";
import { ErroEnvios, type CodigoErroEnvios } from "./erros.js";

// As contas do comerciante numa transportadora (docs/36 §3.1; migração
// 0074; Diogo, 12/10/2026: «sim, aprovo; avança com a parte A»): o padrão
// das contas de pagamento (docs/26 §3.1) — credenciais cifradas que nunca
// saem, pronta só depois da chamada de teste, só o dono as liga.

const CODIGOS_DA_BASE: CodigoErroEnvios[] = [
  "shipping.immutable",
  "shipping.invalid_transition",
  "shipping.label_exists",
  "shipping.void_not_allowed",
];

export function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error) || erro instanceof ErroEnvios) return erro;
  // Os gatilhos (0074, 0079) recusam com o código à frente da mensagem.
  const codigo = CODIGOS_DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroEnvios(codigo, erro.message, undefined, { cause: erro });
  }
  const pg = erro as Error & { code?: string };
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
    return new ErroEnvios("shipping.retry", "tentar outra vez", undefined, {
      cause: erro,
    });
  }
  if (
    pg.code === "23503" ||
    (pg.code === "22P02" && /uuid/.test(erro.message))
  ) {
    return new ErroEnvios("shipping.not_found", "não existe", undefined, {
      cause: erro,
    });
  }
  if (pg.code === "23514" || pg.code === "22001") {
    return new ErroEnvios(
      "shipping.invalid_field",
      "um valor do pedido não é aceite",
      undefined,
      { cause: erro },
    );
  }
  return erro;
}

export async function noEnvios<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
): Promise<T> {
  try {
    return db.isTransaction
      ? await fn(db as Transaction<BaseDados>)
      : await comComerciante(db, comercianteId, fn);
  } catch (erro) {
    throw traduzir(erro);
  }
}

export function adaptadorDe(
  cfg: ConfigEnvios | undefined,
  transportadora: Transportadora,
): { adaptador: AdaptadorTransportadora; chave: ChavePagamentos } {
  const adaptador = cfg?.adaptadores[transportadora];
  if (cfg?.chave === undefined) {
    throw new ErroEnvios(
      "shipping.not_configured",
      "os envios não estão ligados neste servidor (ENVIOS_CHAVE)",
    );
  }
  if (adaptador === undefined) {
    throw new ErroEnvios(
      "shipping.carrier_unavailable",
      `ainda não há adaptador para ${transportadora} neste servidor`,
    );
  }
  return { adaptador, chave: cfg.chave };
}

/** A morada de recolha e o contacto da etiqueta (validados na parte B). */
export interface Remetente {
  nome: string;
  linha1: string;
  linha2?: string;
  codigo_postal: string;
  localidade: string;
  pais: string;
  telefone?: string;
  email?: string;
}

const COLUNAS = [
  "id",
  "transportadora",
  "nome",
  "modo",
  "remetente",
  "estado",
  "credenciais_em",
  "credenciais_por",
  "testada_em",
  "servicos_em",
  "criado_em",
  "versao",
] as const;

/**
 * Os serviços de uma conta (docs/36 §16, D1): a fotografia guardada na
 * chamada de teste, quando o adaptador os tem por conta (a Sendcloud); a
 * lista fixa do adaptador, quando não (os CTT).
 */
export function servicosDe(
  adaptador: AdaptadorTransportadora,
  fotografia: unknown,
): readonly ServicoTransportadora[] {
  if (adaptador.servicosDaConta === undefined) return adaptador.servicos();
  return Array.isArray(fotografia)
    ? (fotografia as ServicoTransportadora[])
    : [];
}

export async function listarContas(db: Kysely<BaseDados>, c: string) {
  return noEnvios(db, c, (trx) =>
    trx
      .selectFrom("conta_transportadora")
      .select(COLUNAS)
      .orderBy("criado_em")
      .orderBy("id")
      .execute(),
  );
}

export async function criarConta(
  trx: Transaction<BaseDados>,
  c: string,
  dados: { transportadora: Transportadora; nome: string; remetente: Remetente },
): Promise<string> {
  return noEnvios(trx, c, async () => {
    const { id } = await trx
      .insertInto("conta_transportadora")
      .values({
        comerciante_id: c,
        transportadora: dados.transportadora,
        nome: dados.nome,
        remetente: JSON.stringify(dados.remetente),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return id;
  });
}

async function contaParaMudar(
  trx: Transaction<BaseDados>,
  id: string,
  versao: number | null,
) {
  const conta = await trx
    .selectFrom("conta_transportadora")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (conta === undefined) {
    throw new ErroEnvios("shipping.not_found", "esta conta não existe");
  }
  if (versao !== null && conta.versao !== versao) {
    throw new ErroEnvios(
      "shipping.version_conflict",
      "a conta mudou entretanto",
      { versao: conta.versao },
    );
  }
  return conta;
}

export async function mudarConta(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  versao: number,
  dados: { nome?: string; remetente?: Remetente; arquivar?: boolean },
) {
  return noEnvios(trx, c, async () => {
    const conta = await contaParaMudar(trx, id, versao);
    if (conta.estado === "arquivada") {
      throw new ErroEnvios("shipping.immutable", "a conta está arquivada");
    }
    if (dados.arquivar === true) {
      // Um método activo que a usa deixaria de poder pedir etiquetas: tira-se
      // a conta do método primeiro (fica «manual» ou passa a outra).
      const usada = await trx
        .selectFrom("metodo_entrega")
        .select("id")
        .where("conta_transportadora_id", "=", id)
        .where("estado", "=", "activo")
        .executeTakeFirst();
      if (usada !== undefined) {
        throw new ErroEnvios(
          "shipping.immutable",
          "há métodos de entrega activos com esta conta",
          { metodo: `shm_${usada.id}` },
        );
      }
    }
    await trx
      .updateTable("conta_transportadora")
      .set({
        ...(dados.nome === undefined ? {} : { nome: dados.nome }),
        ...(dados.remetente === undefined
          ? {}
          : { remetente: JSON.stringify(dados.remetente) }),
        ...(dados.arquivar === true ? { estado: "arquivada" as const } : {}),
        actualizado_em: new Date(),
        versao: conta.versao + 1,
      })
      .where("id", "=", id)
      .execute();
    return conta.versao + 1;
  });
}

/**
 * As credenciais (e o segredo dos avisos, se a transportadora os tiver),
 * cifradas; a conta volta a rascunho até à chamada de teste. Nunca se
 * devolvem.
 */
export async function definirCredenciais(
  trx: Transaction<BaseDados>,
  c: string,
  id: string,
  /**
   * Sem `segredo_aviso`, o segredo guardado fica; `null` tira-o (revisão do
   * #397, P2-2: trocar só a chave não apaga o segredo dos avisos).
   */
  dados: {
    credenciais: Record<string, string>;
    segredo_aviso?: string | null;
  },
  quem: string,
  cfg: ConfigEnvios | undefined,
) {
  if (cfg?.chave === undefined) {
    throw new ErroEnvios(
      "shipping.not_configured",
      "os envios não estão ligados neste servidor (ENVIOS_CHAVE)",
    );
  }
  const chave = cfg.chave;
  return noEnvios(trx, c, async () => {
    const conta = await contaParaMudar(trx, id, null);
    if (conta.estado === "arquivada") {
      throw new ErroEnvios("shipping.immutable", "a conta está arquivada");
    }
    await trx
      .updateTable("conta_transportadora")
      .set({
        credenciais_cifra: cifrar(
          JSON.stringify(dados.credenciais),
          id,
          "credenciais",
          chave,
        ),
        ...(dados.segredo_aviso === undefined
          ? {}
          : {
              segredo_aviso_cifra:
                dados.segredo_aviso === null
                  ? null
                  : cifrar(dados.segredo_aviso, id, "segredo_aviso", chave),
            }),
        chave_versao: chave.versao,
        credenciais_em: new Date(),
        credenciais_por: quem,
        testada_em: null,
        estado: "rascunho",
        actualizado_em: new Date(),
        versao: conta.versao + 1,
      })
      .where("id", "=", id)
      .execute();
  });
}

export function credenciaisDe(
  conta: {
    id: string;
    credenciais_cifra: Buffer | null;
    chave_versao: string | null;
  },
  chave: ChavePagamentos,
): CredenciaisTransportadora {
  if (conta.credenciais_cifra === null) {
    throw new ErroEnvios(
      "shipping.account_not_ready",
      "a conta não tem credenciais",
    );
  }
  if (conta.chave_versao !== chave.versao) {
    throw new ErroEnvios(
      "shipping.account_not_ready",
      "as credenciais foram cifradas com outra versão da chave: defina-as outra vez",
    );
  }
  const lidas: unknown = JSON.parse(
    decifrar(conta.credenciais_cifra, conta.id, "credenciais", chave),
  );
  if (
    lidas === null ||
    typeof lidas !== "object" ||
    Array.isArray(lidas) ||
    Object.values(lidas).some((v) => typeof v !== "string")
  ) {
    throw new ErroEnvios("shipping.account_not_ready", "credenciais ilegíveis");
  }
  return lidas as Record<string, string>;
}

/** A chamada de teste à transportadora: só com ela a conta fica pronta. */
export async function testarConta(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigEnvios | undefined,
) {
  const conta = await noEnvios(db, c, (trx) =>
    trx
      .selectFrom("conta_transportadora")
      .select([
        "id",
        "transportadora",
        "estado",
        "credenciais_cifra",
        "chave_versao",
        "credenciais_em",
        "remetente",
      ])
      .where("id", "=", id)
      .executeTakeFirst(),
  );
  if (conta === undefined) {
    throw new ErroEnvios("shipping.not_found", "esta conta não existe");
  }
  if (conta.estado === "arquivada") {
    throw new ErroEnvios("shipping.immutable", "a conta está arquivada");
  }
  const { adaptador, chave } = adaptadorDe(cfg, conta.transportadora);
  const credenciais = credenciaisDe(conta, chave);
  // Os países dos mercados do comerciante, lidos antes de falar com a
  // transportadora: um erro da base não passa por credenciais recusadas
  // (revisão do #406, P2-1).
  const destinos =
    adaptador.servicosDaConta === undefined
      ? []
      : await noEnvios(db, c, async (trx) => {
          const linhas = await trx
            .selectFrom("mercado")
            .select("paises")
            .execute();
          return [...new Set(linhas.flatMap((l) => l.paises))].sort();
        });
  try {
    await adaptador.testar(credenciais);
  } catch (erro) {
    // Recusadas agora: uma conta pronta deixa de o estar e sai do checkout
    // (revisão do #397, P3-6). Se não respondeu, nada muda.
    if (!(erro instanceof ErroDeRede) && conta.estado === "pronta") {
      await noEnvios(db, c, async (trx) => {
        const agora = await contaParaMudar(trx, id, null);
        if (
          agora.estado === "pronta" &&
          agora.credenciais_em?.getTime() === conta.credenciais_em?.getTime()
        ) {
          await trx
            .updateTable("conta_transportadora")
            .set({
              estado: "rascunho",
              testada_em: null,
              actualizado_em: new Date(),
              versao: agora.versao + 1,
            })
            .where("id", "=", id)
            .execute();
        }
      });
    }
    throw new ErroEnvios(
      erro instanceof ErroDeRede
        ? "shipping.carrier_unavailable"
        : "shipping.account_not_ready",
      erro instanceof ErroDeRede
        ? "a transportadora não respondeu"
        : "a transportadora recusou as credenciais",
    );
  }
  // Os serviços da conta (D1): para a origem do remetente e para cada país
  // dos mercados, em modo teste (0074). Uma falha aqui não é uma recusa das
  // credenciais: a conta fica como estava (revisão do #406, P2-1).
  let fotografia: ServicoTransportadora[] | null = null;
  if (adaptador.servicosDaConta !== undefined) {
    try {
      fotografia = await adaptador.servicosDaConta(credenciais, {
        origem: (conta.remetente as unknown as Remetente).pais,
        destinos,
        modo: "teste",
      });
    } catch {
      throw new ErroEnvios(
        "shipping.carrier_unavailable",
        "a lista de serviços da transportadora não se obteve: a conta fica como estava",
      );
    }
  }
  return noEnvios(db, c, async (trx) => {
    const agora = await contaParaMudar(trx, id, null);
    // As credenciais mudaram durante o teste: não se dá esta por testada.
    if (
      agora.estado === "arquivada" ||
      agora.credenciais_em?.getTime() !== conta.credenciais_em?.getTime()
    ) {
      throw new ErroEnvios(
        "shipping.version_conflict",
        "a conta mudou durante o teste",
      );
    }
    // Uma fotografia nova não pode deixar sem serviço um método activo da
    // conta: o checkout continuaria a vendê-lo e a etiqueta falharia numa
    // encomenda paga (revisão do #406, P2-2).
    if (fotografia !== null) {
      const metodos = await trx
        .selectFrom("metodo_entrega")
        .innerJoin("mercado", "mercado.id", "metodo_entrega.mercado_id")
        .select([
          "metodo_entrega.id",
          "metodo_entrega.servico",
          "mercado.paises",
        ])
        .where("metodo_entrega.conta_transportadora_id", "=", id)
        .where("metodo_entrega.estado", "=", "activo")
        .execute();
      const novos = fotografia;
      const sem = metodos.filter((m) => {
        const sv = novos.find((x) => x.codigo === m.servico);
        return sv === undefined || m.paises.some((p) => !sv.paises.includes(p));
      });
      if (sem.length > 0) {
        throw new ErroEnvios(
          "shipping.invalid_field",
          "a transportadora deixou de ter o serviço de métodos activos: arquivam-se ou mudam-se primeiro",
          { metodos: sem.map((m) => `shm_${m.id}`) },
        );
      }
    }
    await trx
      .updateTable("conta_transportadora")
      .set({
        testada_em: new Date(),
        estado: "pronta",
        ...(fotografia === null
          ? {}
          : {
              servicos: JSON.stringify(fotografia),
              servicos_em: new Date(),
            }),
        actualizado_em: new Date(),
        versao: agora.versao + 1,
      })
      .where("id", "=", id)
      .execute();
    return agora.versao + 1;
  });
}

/** Os serviços que o adaptador da conta declara. */
export async function servicosDaConta(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigEnvios | undefined,
): Promise<readonly ServicoTransportadora[]> {
  const conta = await noEnvios(db, c, (trx) =>
    trx
      .selectFrom("conta_transportadora")
      .select(["transportadora", "servicos"])
      .where("id", "=", id)
      .executeTakeFirst(),
  );
  if (conta === undefined) {
    throw new ErroEnvios("shipping.not_found", "esta conta não existe");
  }
  return servicosDe(
    adaptadorDe(cfg, conta.transportadora).adaptador,
    conta.servicos,
  );
}

/**
 * Um método de entrega só aponta para uma conta `pronta` e para um serviço
 * que o adaptador dela declara (docs/36 §3.2). Corre dentro da transacção
 * que muda o método, com a linha da conta bloqueada: arquivar a conta ao
 * mesmo tempo espera por esta.
 */
export async function conferirServico(
  trx: Transaction<BaseDados>,
  contaId: string,
  servico: string,
  cfg: ConfigEnvios | undefined,
): Promise<ServicoTransportadora> {
  const conta = await trx
    .selectFrom("conta_transportadora")
    .select(["id", "transportadora", "estado", "servicos"])
    .where("id", "=", contaId)
    .forShare()
    .executeTakeFirst();
  if (conta === undefined) {
    throw new ErroEnvios("shipping.not_found", "esta conta não existe");
  }
  if (conta.estado !== "pronta") {
    throw new ErroEnvios(
      "shipping.account_not_ready",
      "a conta ainda não passou a chamada de teste (ou está arquivada)",
    );
  }
  const s = servicosDe(
    adaptadorDe(cfg, conta.transportadora).adaptador,
    conta.servicos,
  ).find((x) => x.codigo === servico);
  if (s === undefined) {
    throw new ErroEnvios(
      "shipping.service_unknown",
      "a transportadora não tem este serviço",
    );
  }
  return s;
}
