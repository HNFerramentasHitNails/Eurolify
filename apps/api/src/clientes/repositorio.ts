import { sql, type Kysely, type Transaction } from "kysely";
import {
  CANAIS_CONSENTIMENTO,
  type BaseDados,
  type CanalConsentimento,
} from "../base/esquema.js";
import { comComerciante } from "../comerciante/repositorio.js";
import { ErroClientes, type CodigoErroClientes } from "./erros.js";
import type { PedidoVies, RespostaVies } from "./vies.js";

// Clientes e perfis de faturação, parte 1 (docs/23 §3; migração 0037; issue
// #233). As regras vivem na base (a régua do NIF, o principal, o perfil
// usado, as etiquetas); aqui traduzem-se os erros, impõe-se a versão nas
// escritas e junta-se o NIF a mostrar.

export { ErroClientes, type CodigoErroClientes } from "./erros.js";

/** Os códigos que os gatilhos e as funções da 0037 põem no início da mensagem. */
const CODIGOS_DA_BASE: readonly CodigoErroClientes[] = [
  "customers.not_found",
  "customers.invalid_transition",
  "customers.immutable_identity",
  "customers.nif_invalid",
  "customers.nif_country_required",
  "customers.profile_used",
  "customers.primary_profile",
  "customers.tag_in_use",
  "customers.tag_archived",
  // Da 0039 (VIES e isenção manual).
  "customers.change_without_who",
  "customers.exemption_by_person",
  "customers.exemption_immutable",
  "customers.vies_not_applicable",
  // Da 0040: o código do motivo da isenção (docs/24, Q4).
  "customers.exemption_reason_code",
];

/** As restrições da 0037 com código próprio. */
const RESTRICOES: Readonly<Record<string, CodigoErroClientes>> = {
  cliente_nome_check: "customers.name_required",
  cliente_emails_validos: "customers.email_invalid",
  cliente_telefones_validos: "customers.phone_invalid",
  cliente_lingua_valida: "customers.language_invalid",
  cliente_pais_valido: "customers.country_invalid",
  perfil_nome_documento_check: "customers.name_required",
  perfil_empresa_com_nif: "customers.company_requires_nif",
  perfil_morada_inteira: "customers.address_incomplete",
  perfil_morada_valida: "customers.address_incomplete",
  etiqueta_cliente_nome_check: "customers.name_required",
  etiqueta_cliente_nome_unico: "customers.tag_duplicate",
  // Dois primeiros perfis da mesma ficha ao mesmo tempo: o gatilho toma a
  // ficha, mas fica a rede.
  perfil_um_principal: "customers.retry",
  isencao_uma_em_vigor: "customers.exemption_active",
};

const TABELAS = new Set([
  "cliente",
  "perfil_faturacao",
  "etiqueta_cliente",
  "cliente_etiqueta",
  "isencao_manual",
  "consentimento",
]);

/** Exportada para os testes; o resto do código usa-a por `noClientes`. */
export function traduzir(erro: unknown): unknown {
  if (!(erro instanceof Error)) return erro;
  if (erro instanceof ErroClientes) return erro;
  const codigo = CODIGOS_DA_BASE.find((c) => erro.message.startsWith(`${c}:`));
  if (codigo !== undefined) {
    return new ErroClientes(codigo, erro.message, { cause: erro });
  }
  const pg = erro as Error & {
    code?: string;
    constraint?: string;
    table?: string;
  };
  const daRestricao =
    pg.constraint === undefined ? undefined : RESTRICOES[pg.constraint];
  if (
    daRestricao !== undefined &&
    (pg.code === "23505" || pg.code === "23514")
  ) {
    return new ErroClientes(daRestricao, erro.message, { cause: erro });
  }
  if (
    (pg.code === "23514" || pg.code === "23502") &&
    pg.table !== undefined &&
    TABELAS.has(pg.table)
  ) {
    return new ErroClientes("customers.invalid_field", erro.message, {
      cause: erro,
    });
  }
  if (pg.code !== undefined && pg.code.startsWith("22")) {
    const codigoDeValor =
      pg.code === "22P02" &&
      /^invalid input syntax for type uuid:/.test(erro.message)
        ? "customers.not_found"
        : "customers.invalid_field";
    return new ErroClientes(codigoDeValor, erro.message, { cause: erro });
  }
  if (pg.code === "40P01" || pg.code === "40001" || pg.code === "55P03") {
    return new ErroClientes("customers.retry", "tentar outra vez", {
      cause: erro,
    });
  }
  // A ficha ou a etiqueta de outro comerciante: o RLS esconde-as igual.
  if (pg.code === "23503" && pg.table !== undefined && TABELAS.has(pg.table)) {
    return new ErroClientes("customers.not_found", "referência inexistente", {
      cause: erro,
    });
  }
  return erro;
}

const ESPERA_MAXIMA = "5s";

async function noClientes<T>(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fn: (trx: Transaction<BaseDados>) => Promise<T>,
): Promise<T> {
  // Numa transacção já aberta (a da idempotência de um pedido da API), corre
  // nela, depois de confirmar que é do mesmo comerciante (como o noDominio
  // de Preços).
  if (db.isTransaction) {
    const trx = db as Transaction<BaseDados>;
    try {
      const { rows } = await sql<{ comerciante: string | null }>`
        select current_setting('eurolify.comerciante', true) as comerciante`.execute(
        trx,
      );
      if (rows[0]?.comerciante !== comercianteId) {
        throw new Error(
          "noClientes: a transacção aberta é de outro comerciante (ou de nenhum)",
        );
      }
      await sql`select set_config('lock_timeout', ${ESPERA_MAXIMA}, true)`.execute(
        trx,
      );
      return await fn(trx);
    } catch (erro) {
      throw traduzir(erro);
    }
  }
  try {
    return await comComerciante(db, comercianteId, async (trx) => {
      await sql`select set_config('lock_timeout', ${ESPERA_MAXIMA}, true)`.execute(
        trx,
      );
      return fn(trx);
    });
  } catch (erro) {
    throw traduzir(erro);
  }
}

/** Uma escrita com versão: nada mudou porque não existe, ou porque a versão era outra. */
async function semLinha(
  trx: Transaction<BaseDados>,
  tabela: "cliente" | "perfil_faturacao" | "etiqueta_cliente",
  id: string,
): Promise<never> {
  const existe = await trx
    .selectFrom(tabela)
    .select("id")
    .where("id", "=", id)
    .executeTakeFirst();
  if (existe === undefined) {
    throw new ErroClientes("customers.not_found", `${tabela} inexistente`);
  }
  throw new ErroClientes(
    "customers.version_conflict",
    `${tabela}: a versão lida já não é a actual`,
  );
}

export interface Pagina<T> {
  dados: T[];
  total: number;
  ultimo: string | null;
}

async function pagina<T extends { id: string }>(
  consulta: (depois: string | null, limite: number) => Promise<T[]>,
  total: () => Promise<number>,
  limite: number,
  depois: string | null,
): Promise<Pagina<T>> {
  const linhas = await consulta(depois, limite + 1);
  const haMais = linhas.length > limite;
  const dados = haMais ? linhas.slice(0, limite) : linhas;
  return {
    dados,
    total: await total(),
    ultimo: haMais ? (dados.at(-1)?.id ?? null) : null,
  };
}

// -------------------------------------------------------------- A ficha

export interface DadosCliente {
  nome: string;
  emails?: string[];
  telefones?: string[];
  lingua?: string | null;
  pais?: string | null;
}

async function etiquetasDe(trx: Transaction<BaseDados>, ids: string[]) {
  if (ids.length === 0) return new Map<string, string[]>();
  const linhas = await trx
    .selectFrom("cliente_etiqueta")
    .select(["cliente_id", "etiqueta_id"])
    .where("cliente_id", "in", ids)
    .orderBy("etiqueta_id")
    .execute();
  const mapa = new Map<string, string[]>();
  for (const l of linhas) {
    mapa.set(l.cliente_id, [...(mapa.get(l.cliente_id) ?? []), l.etiqueta_id]);
  }
  return mapa;
}

export async function criarCliente(
  db: Kysely<BaseDados>,
  comercianteId: string,
  dados: DadosCliente,
): Promise<string> {
  const { id } = await noClientes(db, comercianteId, (trx) =>
    trx
      .insertInto("cliente")
      .values({ comerciante_id: comercianteId, ...dados })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

export async function obterCliente(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
) {
  return noClientes(db, comercianteId, async (trx) => {
    const cliente = await trx
      .selectFrom("cliente")
      .selectAll()
      .where("id", "=", clienteId)
      .executeTakeFirst();
    if (cliente === undefined) {
      throw new ErroClientes("customers.not_found", "ficha inexistente");
    }
    const etiquetas = await etiquetasDe(trx, [cliente.id]);
    return { ...cliente, etiquetas: etiquetas.get(cliente.id) ?? [] };
  });
}

/**
 * As fichas, por ordem de criação. A procura (POST /customers/search, nunca
 * no endereço) é por e-mail (tem `@`), por
 * telefone (começa por `+`) ou pelo NIF (só o número, como a régua
 * compara); nunca pelo nome (docs/23 §7.1; R10).
 */
export async function listarClientes(
  db: Kysely<BaseDados>,
  comercianteId: string,
  limite: number,
  depois: string | null,
  procura?: string,
) {
  return noClientes(db, comercianteId, async (trx) => {
    const base = () => {
      let q = trx.selectFrom("cliente");
      if (procura !== undefined) {
        if (procura.includes("@")) {
          q = q.where(
            sql<boolean>`exists (select from unnest(cliente.emails) e where lower(e) = lower(${procura}))`,
          );
        } else if (procura.startsWith("+")) {
          // Espaços, hífenes, pontos e parênteses não contam (revisão do
          // #234, P3-7): os guardados já estão em E.164.
          q = q.where(
            sql<boolean>`regexp_replace(${procura}, '[[:space:].()\-]', '', 'g') = any(cliente.telefones)`,
          );
        } else {
          q = q.where(
            "id",
            "in",
            trx
              .selectFrom("perfil_faturacao")
              .select("cliente_id")
              .where(
                "nif_numero",
                "=",
                sql<string>`nif_para_procura(${procura})`,
              ),
          );
        }
      }
      return q;
    };
    const p = await pagina(
      (d, n) => {
        let q = base().selectAll();
        if (d !== null) q = q.where("id", ">", d);
        return q.orderBy("id").limit(n).execute();
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
    const etiquetas = await etiquetasDe(
      trx,
      p.dados.map((c) => c.id),
    );
    return {
      ...p,
      dados: p.dados.map((c) => ({
        ...c,
        etiquetas: etiquetas.get(c.id) ?? [],
      })),
    };
  });
}

export type AlteracaoCliente = Partial<DadosCliente>;

export async function alterarCliente(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
  versao: number,
  alteracao: AlteracaoCliente,
): Promise<void> {
  await noClientes(db, comercianteId, async (trx) => {
    if (Object.keys(alteracao).length === 0) {
      // Sem campos: só confere a versão (não escreve nem deixa rasto).
      const linha = await trx
        .selectFrom("cliente")
        .select("versao")
        .where("id", "=", clienteId)
        .executeTakeFirst();
      if (linha?.versao !== versao) await semLinha(trx, "cliente", clienteId);
      return;
    }
    const r = await trx
      .updateTable("cliente")
      .set(alteracao)
      .where("id", "=", clienteId)
      .where("versao", "=", versao)
      .returning("id")
      .executeTakeFirst();
    if (r === undefined) await semLinha(trx, "cliente", clienteId);
  });
}

// ------------------------------------------------- Perfis de faturação

export interface Morada {
  linha1: string;
  linha2?: string | null;
  codigo_postal: string;
  localidade: string;
  pais: string;
}

export interface DadosPerfil {
  tipo: "particular" | "empresa";
  nome_documento: string;
  /** Como a pessoa o escreveu; a base tira o país e o número (§3.3). */
  nif?: string | null;
  pais_contribuinte?: string | null;
  morada?: Morada | null;
}

const camposDaMorada = (m: Morada | null) => ({
  morada_linha1: m?.linha1 ?? null,
  morada_linha2: m?.linha2 ?? null,
  morada_codigo_postal: m?.codigo_postal ?? null,
  morada_localidade: m?.localidade ?? null,
  morada_pais: m?.pais ?? null,
});

function perfisComNif(trx: Transaction<BaseDados>, comercianteId: string) {
  return (
    trx
      .selectFrom("perfil_faturacao")
      .selectAll()
      .select(
        sql<
          string | null
        >`nif_com_prefixo(pais_contribuinte, nif_numero, pais_do_comerciante(${comercianteId}::uuid))`.as(
          "nif",
        ),
      )
      // A data da última resposta do VIES ao NIF actual (válido ou inválido),
      // lida das provas: o perfil não muda a cada revalidação (revisão do #244,
      // P2-6).
      .select(
        sql<Date | null>`(select coalesce(v.data_vies, v.consultado_em)
        from validacao_vies v
        where v.perfil_id = perfil_faturacao.id
          and v.pais_consultado = perfil_faturacao.pais_contribuinte
          and v.numero_consultado = perfil_faturacao.nif_numero
          and v.resultado in ('valido', 'invalido')
        order by v.consultado_em desc limit 1)`.as("validado_em"),
      )
      .select(
        sql<boolean>`exists (select from isencao_manual i
        where i.perfil_id = perfil_faturacao.id and i.retirada_em is null)`.as(
          "isencao_em_vigor",
        ),
      )
  );
}

export async function criarPerfil(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
  dados: DadosPerfil,
): Promise<string> {
  const { id } = await noClientes(db, comercianteId, (trx) =>
    trx
      .insertInto("perfil_faturacao")
      .values({
        comerciante_id: comercianteId,
        cliente_id: clienteId,
        tipo: dados.tipo,
        nome_documento: dados.nome_documento,
        nif_escrito: dados.nif ?? null,
        pais_contribuinte: dados.pais_contribuinte ?? null,
        ...camposDaMorada(dados.morada ?? null),
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

export async function obterPerfil(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
) {
  const perfil = await noClientes(db, comercianteId, (trx) =>
    perfisComNif(trx, comercianteId)
      .where("id", "=", perfilId)
      .executeTakeFirst(),
  );
  if (perfil === undefined) {
    throw new ErroClientes("customers.not_found", "perfil inexistente");
  }
  return perfil;
}

/** Os perfis de uma ficha: o principal primeiro, depois por criação. */
export async function listarPerfis(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
) {
  return noClientes(db, comercianteId, async (trx) => {
    const existe = await trx
      .selectFrom("cliente")
      .select("id")
      .where("id", "=", clienteId)
      .executeTakeFirst();
    if (existe === undefined) {
      throw new ErroClientes("customers.not_found", "ficha inexistente");
    }
    return perfisComNif(trx, comercianteId)
      .where("cliente_id", "=", clienteId)
      .orderBy("principal", "desc")
      .orderBy("id")
      .execute();
  });
}

export type AlteracaoPerfil = Partial<DadosPerfil>;

export async function alterarPerfil(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
  versao: number,
  alteracao: AlteracaoPerfil,
): Promise<void> {
  await noClientes(db, comercianteId, async (trx) => {
    const set: Record<string, unknown> = {};
    if (alteracao.tipo !== undefined) set.tipo = alteracao.tipo;
    if (alteracao.nome_documento !== undefined) {
      set.nome_documento = alteracao.nome_documento;
    }
    // O NIF e o país vão juntos à régua: um NIF novo sem país é deduzido
    // dele (o país antigo não fica a mandar no NIF novo).
    if (alteracao.nif !== undefined) {
      set.nif_escrito = alteracao.nif;
      set.pais_contribuinte = alteracao.pais_contribuinte ?? null;
    } else if (alteracao.pais_contribuinte !== undefined) {
      set.pais_contribuinte = alteracao.pais_contribuinte;
    }
    if (alteracao.morada !== undefined) {
      Object.assign(set, camposDaMorada(alteracao.morada));
    }
    if (Object.keys(set).length === 0) {
      const linha = await trx
        .selectFrom("perfil_faturacao")
        .select("versao")
        .where("id", "=", perfilId)
        .executeTakeFirst();
      if (linha?.versao !== versao) {
        await semLinha(trx, "perfil_faturacao", perfilId);
      }
      return;
    }
    const r = await trx
      .updateTable("perfil_faturacao")
      .set(set)
      .where("id", "=", perfilId)
      .where("versao", "=", versao)
      .returning("id")
      .executeTakeFirst();
    if (r === undefined) await semLinha(trx, "perfil_faturacao", perfilId);
  });
}

/** Torna o perfil o principal da ficha (R5), numa só chamada à base. */
export async function tornarPrincipal(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
): Promise<void> {
  await noClientes(db, comercianteId, async (trx) => {
    await sql`select perfil_tornar_principal(${perfilId}::uuid)`.execute(trx);
  });
}

export async function mudarEstadoPerfil(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
  versao: number,
  estado: "activo" | "arquivado",
): Promise<void> {
  await noClientes(db, comercianteId, async (trx) => {
    // A ficha antes do perfil, pela ordem do gatilho e da troca do principal
    // (revisão do #234, P3-1): sem isto, um arquivo e um make-primary ao
    // mesmo tempo podiam bloquear-se um ao outro.
    await sql`select from cliente where id = (
      select cliente_id from perfil_faturacao where id = ${perfilId}::uuid)
      for update`.execute(trx);
    const actual = await trx
      .selectFrom("perfil_faturacao")
      .select(["estado", "versao"])
      .where("id", "=", perfilId)
      .executeTakeFirst();
    if (actual === undefined || actual.versao !== versao) {
      await semLinha(trx, "perfil_faturacao", perfilId);
    }
    if (actual?.estado === estado) {
      throw new ErroClientes(
        "customers.invalid_transition",
        `o perfil já está ${estado}`,
      );
    }
    const r = await trx
      .updateTable("perfil_faturacao")
      .set({ estado })
      .where("id", "=", perfilId)
      .where("versao", "=", versao)
      .returning("id")
      .executeTakeFirst();
    if (r === undefined) await semLinha(trx, "perfil_faturacao", perfilId);
  });
}

// ------------------------------------------------------------ Etiquetas

export async function criarEtiqueta(
  db: Kysely<BaseDados>,
  comercianteId: string,
  nome: string,
): Promise<string> {
  const { id } = await noClientes(db, comercianteId, (trx) =>
    trx
      .insertInto("etiqueta_cliente")
      .values({ comerciante_id: comercianteId, nome })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

export async function obterEtiqueta(
  db: Kysely<BaseDados>,
  comercianteId: string,
  etiquetaId: string,
) {
  const etiqueta = await noClientes(db, comercianteId, (trx) =>
    trx
      .selectFrom("etiqueta_cliente")
      .selectAll()
      .where("id", "=", etiquetaId)
      .executeTakeFirst(),
  );
  if (etiqueta === undefined) {
    throw new ErroClientes("customers.not_found", "etiqueta inexistente");
  }
  return etiqueta;
}

export async function listarEtiquetas(
  db: Kysely<BaseDados>,
  comercianteId: string,
  limite: number,
  depois: string | null,
) {
  return noClientes(db, comercianteId, (trx) =>
    pagina(
      (d, n) => {
        let q = trx.selectFrom("etiqueta_cliente").selectAll();
        if (d !== null) q = q.where("id", ">", d);
        return q.orderBy("id").limit(n).execute();
      },
      async () =>
        Number(
          (
            await trx
              .selectFrom("etiqueta_cliente")
              .select((eb) => eb.fn.countAll<string>().as("n"))
              .executeTakeFirstOrThrow()
          ).n,
        ),
      limite,
      depois,
    ),
  );
}

export async function alterarEtiqueta(
  db: Kysely<BaseDados>,
  comercianteId: string,
  etiquetaId: string,
  versao: number,
  alteracao: { nome?: string; estado?: "activa" | "arquivada" },
): Promise<void> {
  await noClientes(db, comercianteId, async (trx) => {
    if (alteracao.estado !== undefined) {
      const actual = await trx
        .selectFrom("etiqueta_cliente")
        .select("estado")
        .where("id", "=", etiquetaId)
        .executeTakeFirst();
      if (actual?.estado === alteracao.estado) {
        throw new ErroClientes(
          "customers.invalid_transition",
          `a etiqueta já está ${alteracao.estado}`,
        );
      }
    }
    if (Object.keys(alteracao).length === 0) {
      const linha = await trx
        .selectFrom("etiqueta_cliente")
        .select("versao")
        .where("id", "=", etiquetaId)
        .executeTakeFirst();
      if (linha?.versao !== versao) {
        await semLinha(trx, "etiqueta_cliente", etiquetaId);
      }
      return;
    }
    const r = await trx
      .updateTable("etiqueta_cliente")
      .set(alteracao)
      .where("id", "=", etiquetaId)
      .where("versao", "=", versao)
      .returning("id")
      .executeTakeFirst();
    if (r === undefined) await semLinha(trx, "etiqueta_cliente", etiquetaId);
  });
}

/** Põe a etiqueta na ficha; pôr outra vez não muda nada. */
export async function porEtiqueta(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
  etiquetaId: string,
): Promise<void> {
  await noClientes(db, comercianteId, async (trx) => {
    await trx
      .insertInto("cliente_etiqueta")
      .values({
        comerciante_id: comercianteId,
        cliente_id: clienteId,
        etiqueta_id: etiquetaId,
      })
      .onConflict((oc) => oc.columns(["cliente_id", "etiqueta_id"]).doNothing())
      .execute();
  });
}

/** Tira a etiqueta da ficha; tirar uma que não está não muda nada. */
export async function tirarEtiqueta(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
  etiquetaId: string,
): Promise<void> {
  await noClientes(db, comercianteId, async (trx) => {
    const ficha = await trx
      .selectFrom("cliente")
      .select("id")
      .where("id", "=", clienteId)
      .executeTakeFirst();
    const etiqueta = await trx
      .selectFrom("etiqueta_cliente")
      .select("id")
      .where("id", "=", etiquetaId)
      .executeTakeFirst();
    if (ficha === undefined || etiqueta === undefined) {
      throw new ErroClientes(
        "customers.not_found",
        "a ficha ou a etiqueta não existem",
      );
    }
    await trx
      .deleteFrom("cliente_etiqueta")
      .where("cliente_id", "=", clienteId)
      .where("etiqueta_id", "=", etiquetaId)
      .execute();
  });
}

// --------------------------------------------------------------- Rasto

/** A linha do tempo de uma ficha (§3.8), da mais recente para a mais antiga. */
export async function linhaDoTempo(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
  limite: number,
  antes: string | null,
) {
  return noClientes(db, comercianteId, async (trx) => {
    const existe = await trx
      .selectFrom("cliente")
      .select("id")
      .where("id", "=", clienteId)
      .executeTakeFirst();
    if (existe === undefined) {
      throw new ErroClientes("customers.not_found", "ficha inexistente");
    }
    const { n } = await trx
      .selectFrom("alteracao_cliente")
      .where("cliente_id", "=", clienteId)
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    let q = trx
      .selectFrom("alteracao_cliente")
      .selectAll()
      .where("cliente_id", "=", clienteId);
    if (antes !== null) q = q.where("id", "<", antes);
    const linhas = await q
      .orderBy("id", "desc")
      .limit(limite + 1)
      .execute();
    const haMais = linhas.length > limite;
    const dados = haMais ? linhas.slice(0, limite) : linhas;
    return {
      dados,
      total: Number(n),
      ultimo: haMais ? (dados.at(-1)?.id ?? null) : null,
    };
  });
}

// ----------------------------------------------- VIES (parte 3, §13)

export type MotivoVies = "perfil_novo" | "nif_mudou" | "revalidacao" | "pedido";

async function requerente(
  trx: Transaction<BaseDados>,
): Promise<PedidoVies["requerente"]> {
  const { rows } = await sql<{ pais: string | null; numero: string | null }>`
    select pais, numero from vies_requerente()`.execute(trx);
  const r = rows[0];
  return r?.pais && r.numero ? { pais: r.pais, numero: r.numero } : null;
}

/** Grava a resposta como prova (a `vies_registar`); devolve o id da prova. */
export async function registarVies(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
  pedido: PedidoVies,
  resposta: RespostaVies,
  consultadoEm: Date,
  motivo: MotivoVies,
): Promise<string> {
  return noClientes(db, comercianteId, async (trx) => {
    const { rows } = await sql<{ id: string }>`
      select vies_registar(
        ${perfilId}::uuid, ${pedido.pais}, ${pedido.numero},
        ${resposta.requerente?.pais ?? null}, ${resposta.requerente?.numero ?? null},
        ${consultadoEm}, ${resposta.dataVies}, ${resposta.resultado},
        ${resposta.codigoErro}, ${resposta.identificador}, ${resposta.nome},
        ${resposta.morada}, ${motivo}) as id`.execute(trx);
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("vies_registar sem id");
    return id;
  });
}

export async function obterValidacao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  id: string,
) {
  const v = await noClientes(db, comercianteId, (trx) =>
    trx
      .selectFrom("validacao_vies")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst(),
  );
  if (v === undefined) {
    throw new ErroClientes("customers.not_found", "prova inexistente");
  }
  return v;
}

/** As provas de um perfil, da mais recente para a mais antiga. */
export async function listarValidacoes(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
  limite: number,
  antes: string | null,
) {
  return noClientes(db, comercianteId, async (trx) => {
    const existe = await trx
      .selectFrom("perfil_faturacao")
      .select("id")
      .where("id", "=", perfilId)
      .executeTakeFirst();
    if (existe === undefined) {
      throw new ErroClientes("customers.not_found", "perfil inexistente");
    }
    const { n } = await trx
      .selectFrom("validacao_vies")
      .where("perfil_id", "=", perfilId)
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    let q = trx
      .selectFrom("validacao_vies")
      .selectAll()
      .where("perfil_id", "=", perfilId);
    if (antes !== null) q = q.where("id", "<", antes);
    const linhas = await q
      .orderBy("id", "desc")
      .limit(limite + 1)
      .execute();
    const haMais = linhas.length > limite;
    const dados = haMais ? linhas.slice(0, limite) : linhas;
    return {
      dados,
      total: Number(n),
      ultimo: haMais ? (dados.at(-1)?.id ?? null) : null,
    };
  });
}

/** Os comerciantes com consultas para fazer agora (a fila, §13.4). */
export async function comerciantesComFilaVies(
  db: Kysely<BaseDados>,
): Promise<string[]> {
  const { rows } = await sql<{ id: string }>`
    select id from vies_comerciantes_com_fila() as id`.execute(db);
  return rows.map((r) => r.id);
}

/** As consultas para fazer agora num comerciante, com o requerente dele. */
export async function filaViesDoComerciante(
  db: Kysely<BaseDados>,
  comercianteId: string,
  limite: number,
) {
  return noClientes(db, comercianteId, async (trx) => {
    const { rows } = await sql<{
      perfil_id: string;
      pais: string;
      numero: string;
      motivo: MotivoVies;
    }>`select perfil_id, pais, numero, motivo from vies_por_consultar(${limite})`.execute(
      trx,
    );
    return { consultas: rows, requerente: await requerente(trx) };
  });
}

// ------------------------------------------ A isenção manual (§13.5)

export async function porIsencao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
  motivo: string,
  nota: string | null,
  codigoMotivo: string,
): Promise<string> {
  const { id } = await noClientes(db, comercianteId, (trx) =>
    trx
      .insertInto("isencao_manual")
      .values({
        comerciante_id: comercianteId,
        perfil_id: perfilId,
        motivo,
        nota,
        codigo_motivo: codigoMotivo,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

/** Retira a isenção em vigor; devolve o id dela. */
export async function retirarIsencao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
  motivoRetirada: string,
): Promise<string> {
  return noClientes(db, comercianteId, async (trx) => {
    const r = await trx
      .updateTable("isencao_manual")
      .set({ motivo_retirada: motivoRetirada })
      .where("perfil_id", "=", perfilId)
      .where("retirada_em", "is", null)
      .returning("id")
      .executeTakeFirst();
    if (r === undefined) {
      throw new ErroClientes(
        "customers.not_found",
        "o perfil não tem uma isenção em vigor",
      );
    }
    return r.id;
  });
}

export async function obterIsencao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  id: string,
) {
  const i = await noClientes(db, comercianteId, (trx) =>
    trx
      .selectFrom("isencao_manual")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst(),
  );
  if (i === undefined) {
    throw new ErroClientes("customers.not_found", "isenção inexistente");
  }
  return i;
}

/** As isenções de um perfil (a em vigor e as retiradas), mais recentes primeiro. */
export async function listarIsencoes(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
) {
  return noClientes(db, comercianteId, async (trx) => {
    const existe = await trx
      .selectFrom("perfil_faturacao")
      .select("id")
      .where("id", "=", perfilId)
      .executeTakeFirst();
    if (existe === undefined) {
      throw new ErroClientes("customers.not_found", "perfil inexistente");
    }
    return trx
      .selectFrom("isencao_manual")
      .selectAll()
      .where("perfil_id", "=", perfilId)
      .orderBy("id", "desc")
      .execute();
  });
}

// ------------------------------------------------ Consentimentos (§3.6)

export interface DadosConsentimento {
  canal: CanalConsentimento;
  declaracao: "aceitou" | "retirou";
  texto: string;
  versao_texto: string;
  onde: string;
}

/** Regista uma declaração (migração 0042); a hora e quem põe-nos a base. */
export async function registarConsentimento(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
  dados: DadosConsentimento,
): Promise<string> {
  const { id } = await noClientes(db, comercianteId, (trx) =>
    trx
      .insertInto("consentimento")
      .values({
        comerciante_id: comercianteId,
        cliente_id: clienteId,
        finalidade: "marketing",
        ...dados,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return id;
}

export async function obterConsentimento(
  db: Kysely<BaseDados>,
  comercianteId: string,
  id: string,
) {
  const c = await noClientes(db, comercianteId, (trx) =>
    trx
      .selectFrom("consentimento")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst(),
  );
  if (c === undefined) {
    throw new ErroClientes("customers.not_found", "consentimento inexistente");
  }
  return c;
}

/**
 * As declarações da ficha, as mais recentes primeiro, e a resposta da régua
 * única por canal — nunca contada aqui (R6): pergunta-se à base.
 */
export async function listarConsentimentos(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
) {
  return noClientes(db, comercianteId, async (trx) => {
    const ficha = await trx
      .selectFrom("cliente")
      .select("id")
      .where("id", "=", clienteId)
      .executeTakeFirst();
    if (ficha === undefined) {
      throw new ErroClientes("customers.not_found", "ficha inexistente");
    }
    const declaracoes = await trx
      .selectFrom("consentimento")
      .selectAll()
      .where("cliente_id", "=", clienteId)
      .orderBy("declarado_em", "desc")
      .orderBy("id", "desc")
      .execute();
    const regua = {} as Record<CanalConsentimento, boolean>;
    for (const canal of CANAIS_CONSENTIMENTO) {
      const { rows } = await sql<{ pode: boolean }>`
        select pode_receber_marketing(${clienteId}::uuid, ${canal}) as pode`.execute(
        trx,
      );
      regua[canal] = rows[0]?.pode === true;
    }
    return { declaracoes, regua };
  });
}

/** A consulta pedida: o perfil passa à frente da fila (revisão do #244, P1-1). */
export async function pedirVies(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
): Promise<Date> {
  return noClientes(db, comercianteId, async (trx) => {
    const { rows } = await sql<{ quando: Date }>`
      select vies_pedir(${perfilId}::uuid) as quando`.execute(trx);
    const quando = rows[0]?.quando;
    if (quando === undefined) throw new Error("vies_pedir sem resposta");
    return quando;
  });
}

/** Uma consulta que falhou antes de gravar: a linha vai para trás (P2-1). */
export async function adiarVies(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
): Promise<void> {
  await noClientes(db, comercianteId, async (trx) => {
    await sql`select vies_adiar(${perfilId}::uuid)`.execute(trx);
  });
}
