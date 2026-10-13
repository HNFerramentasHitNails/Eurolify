import { randomBytes, randomInt } from "node:crypto";
import { sql, type Kysely, type RawBuilder, type Transaction } from "kysely";
import {
  CANAIS_CONSENTIMENTO,
  type TipoDeAnexo,
  type BaseDados,
  type CanalConsentimento,
  type EstadoDuplicado,
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
  // Da 0046: duplicados e fusões.
  "customers.merge_same",
  "customers.merge_by_person",
  "customers.merge_too_many_contacts",
  "customers.duplicate_decided",
  // Da 0049: os pedidos do titular.
  "customers.confirmation_required",
  "customers.restricted",
  // Da 0052: o consentimento por contacto e a dupla confirmação.
  "customers.consent_contact_unknown",
  "customers.consent_confirmation_required",
  "customers.confirmation_channel",
  "customers.confirmation_invalid",
  "customers.confirmation_rate_limited",
  // Da 0055: os anexos da isenção.
  "customers.exemption_attachments_full",
  "customers.exemption_attachments_quota",
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
  "duplicado_cliente",
  "pedido_titular",
  "confirmacao_consentimento",
  "anexo_isencao",
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
  /**
   * Sem customers:billing (§15.12): a procura por NIF não mostra as fichas
   * pseudonimizadas, porque confirmava que o NIF é da pessoa que pediu o
   * apagamento.
   */
  semFichasApagadasNoNif = false,
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
          if (semFichasApagadasNoNif) {
            q = q.where(
              sql<boolean>`not ${fichaPseudonimizada(sql`cliente.id`)}`,
            );
          }
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

/**
 * Se a ficha, ou aquela em que foi fundida (subindo por `fundido_em`), foi
 * pseudonimizada por um pedido de apagamento (docs/23 §15.12; EL).
 * Os perfis dela que ficaram por obrigação fiscal só se lêem com
 * `customers:billing` (o dono). A regra vive só aqui: as rotas que lêem
 * perfis, provas do VIES, isenções e anexos passam por ela.
 */
export function fichaPseudonimizada(cliente: RawBuilder<unknown>) {
  return sql<boolean>`exists (
    with recursive acima (id, estado, fundido_em) as (
      select c.id, c.estado, c.fundido_em from cliente c where c.id = ${cliente}
      union
      select c.id, c.estado, c.fundido_em from cliente c
      join acima a on c.id = a.fundido_em)
    select from acima where acima.estado = 'pseudonimizado')`;
}

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
      .select(
        fichaPseudonimizada(sql`perfil_faturacao.cliente_id`).as("guardado"),
      )
  );
}

/**
 * Se o perfil é de uma ficha pseudonimizada (§15.12), para os outros
 * domínios que o lêem (a simulação do IVA).
 */
export async function perfilDeFichaPseudonimizada(
  db: Kysely<BaseDados>,
  comercianteId: string,
  perfilId: string,
): Promise<boolean> {
  return noClientes(db, comercianteId, (trx) => perfilGuardado(trx, perfilId));
}

/** Se o perfil é de uma ficha pseudonimizada (§15.12). */
export async function perfilGuardado(
  trx: Transaction<BaseDados>,
  perfilId: string,
): Promise<boolean> {
  const r = await trx
    .selectFrom("perfil_faturacao")
    .select(
      fichaPseudonimizada(sql`perfil_faturacao.cliente_id`).as("guardado"),
    )
    .where("id", "=", perfilId)
    .executeTakeFirst();
  return r?.guardado ?? false;
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
      // O perfil é de uma ficha pseudonimizada (§15.12).
      guardado: await perfilGuardado(trx, perfilId),
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

/** O que se mostra de um anexo (sem os bytes). */
const COLUNAS_DO_ANEXO = [
  "id",
  "isencao_id",
  "nome",
  "tipo",
  "tamanho",
  "resumo",
  "posto_por",
  "posto_em",
] as const;

/**
 * Anexa um ficheiro a uma isenção em vigor (0055): a base confirma o tipo
 * pelos primeiros bytes, conta os 5 e põe quem e quando.
 */
export async function anexarIsencao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  isencaoId: string,
  anexo: { tipo: TipoDeAnexo; nome: string | null; bytes: Buffer },
) {
  return noClientes(db, comercianteId, (trx) =>
    trx
      .insertInto("anexo_isencao")
      .values({
        comerciante_id: comercianteId,
        isencao_id: isencaoId,
        nome: anexo.nome,
        tipo: anexo.tipo,
        bytes: anexo.bytes,
      })
      .returning(COLUNAS_DO_ANEXO)
      .executeTakeFirstOrThrow(),
  );
}

/** Os anexos de uma isenção (sem os bytes), pela ordem em que entraram. */
export async function listarAnexosDaIsencao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  isencaoId: string,
) {
  return noClientes(db, comercianteId, async (trx) => {
    const existe = await trx
      .selectFrom("isencao_manual")
      .select("id")
      .where("id", "=", isencaoId)
      .executeTakeFirst();
    if (existe === undefined) {
      throw new ErroClientes("customers.not_found", "isenção inexistente");
    }
    const { perfil_id } = await trx
      .selectFrom("isencao_manual")
      .select("perfil_id")
      .where("id", "=", isencaoId)
      .executeTakeFirstOrThrow();
    // O nome do ficheiro pode ter o nome da pessoa (§15.12).
    const guardado = await perfilGuardado(trx, perfil_id);
    const linhas = await trx
      .selectFrom("anexo_isencao")
      .select(COLUNAS_DO_ANEXO)
      .where("isencao_id", "=", isencaoId)
      .orderBy("id")
      .execute();
    return linhas.map((l) => ({ ...l, guardado }));
  });
}

/** Um anexo com os bytes, para descarregar. */
export async function lerAnexoDaIsencao(
  db: Kysely<BaseDados>,
  comercianteId: string,
  isencaoId: string,
  anexoId: string,
) {
  const a = await noClientes(db, comercianteId, (trx) =>
    trx
      .selectFrom("anexo_isencao")
      .select(["tipo", "nome", "bytes", "resumo"])
      .where("isencao_id", "=", isencaoId)
      .where("id", "=", anexoId)
      .executeTakeFirst(),
  );
  if (a === undefined) {
    throw new ErroClientes("customers.not_found", "anexo inexistente");
  }
  return a;
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
    // O perfil é de uma ficha pseudonimizada (§15.12): a nota e os motivos
    // são texto livre que pode falar da pessoa.
    const guardado = await perfilGuardado(trx, perfilId);
    const linhas = await trx
      .selectFrom("isencao_manual")
      .selectAll()
      .where("perfil_id", "=", perfilId)
      .orderBy("id", "desc")
      .execute();
    return linhas.map((l) => ({ ...l, guardado }));
  });
}

// ------------------------------------------------ Consentimentos (§3.6)

export interface DadosConsentimento {
  canal: CanalConsentimento;
  declaracao: "aceitou" | "retirou";
  /** O e-mail ou o telefone da ficha a que a declaração se refere (0052). */
  contacto: string;
  texto: string;
  versao_texto: string;
  onde: string;
}

/** O que uma declaração deu: a declaração, ou um pedido de dupla confirmação. */
export type ResultadoConsentimento =
  | { tipo: "declaracao"; id: string }
  | {
      tipo: "confirmacao";
      id: string;
      /** Só nesta resposta; a base guarda o resumo (0052). */
      segredo: string;
      /** O contacto como a base o compara (o e-mail em minúsculas). */
      contacto: string;
      expira_em: Date;
    };

/** O segredo da dupla confirmação: uma ligação para o e-mail, um código de 6 dígitos para o SMS. */
function segredoDaConfirmacao(canal: CanalConsentimento): string {
  return canal === "email"
    ? randomBytes(32).toString("base64url")
    : String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Regista uma declaração (migrações 0042 e 0052); a hora e quem põe-nos a
 * base. Um «aceitou» sobre uma recusa activa do contacto não entra: a base
 * recusa-o, e cria-se um pedido de dupla confirmação (docs/23 §14, C3).
 */
export async function registarConsentimento(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
  dados: DadosConsentimento,
): Promise<ResultadoConsentimento> {
  return noClientes(db, comercianteId, async (trx) => {
    await sql`savepoint antes_da_declaracao`.execute(trx);
    try {
      const { id } = await trx
        .insertInto("consentimento")
        .values({
          comerciante_id: comercianteId,
          cliente_id: clienteId,
          finalidade: "marketing",
          ...dados,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { tipo: "declaracao" as const, id };
    } catch (erro) {
      const e = traduzir(erro);
      if (
        !(e instanceof ErroClientes) ||
        e.codigo !== "customers.consent_confirmation_required" ||
        dados.declaracao !== "aceitou"
      ) {
        throw erro;
      }
      await sql`rollback to savepoint antes_da_declaracao`.execute(trx);
      const segredo = segredoDaConfirmacao(dados.canal);
      const { rows } = await sql<{
        id: string;
        expira_em: Date;
        contacto: string;
      }>`
        select id, expira_em, contacto from consentimento_pedir_confirmacao(
          ${clienteId}::uuid, ${dados.canal}, ${dados.contacto}, ${dados.texto},
          ${dados.versao_texto}, ${dados.onde}, ${segredo})`.execute(trx);
      const r = rows[0];
      if (r === undefined) {
        throw new Error("consentimento_pedir_confirmacao sem linha", {
          cause: erro,
        });
      }
      return {
        tipo: "confirmacao" as const,
        id: r.id,
        segredo,
        contacto: r.contacto,
        expira_em: r.expira_em,
      };
    }
  });
}

/**
 * Confirma um pedido com o que a pessoa trouxe (0052). Corre na sua própria
 * transacção: uma tentativa errada fica contada mesmo quando a resposta é um
 * erro.
 */
export async function confirmarConsentimento(
  db: Kysely<BaseDados>,
  comercianteId: string,
  quem: string,
  confirmacaoId: string,
  segredo: string,
): Promise<string> {
  const r = await noClientes(db, comercianteId, async (trx) => {
    await sql`select set_config('eurolify.quem', ${quem}, true)`.execute(trx);
    const { rows } = await sql<{
      resultado: string;
      consentimento_id: string | null;
    }>`select resultado, consentimento_id
        from consentimento_confirmar(${confirmacaoId}::uuid, ${segredo})`.execute(
      trx,
    );
    return rows[0];
  });
  switch (r?.resultado) {
    case "confirmada":
      if (r.consentimento_id === null)
        throw new Error("confirmada sem declaração");
      return r.consentimento_id;
    case "nao_existe":
      throw new ErroClientes(
        "customers.not_found",
        "o pedido de confirmação não existe",
      );
    case "errado":
      throw new ErroClientes(
        "customers.confirmation_invalid",
        "o segredo não confere",
      );
    case "esgotada":
      throw new ErroClientes(
        "customers.confirmation_exhausted",
        "tentativas esgotadas; peça outra confirmação",
      );
    case "expirada":
      throw new ErroClientes(
        "customers.confirmation_expired",
        "o pedido expirou; peça outra confirmação",
      );
    case "ja_confirmada":
      throw new ErroClientes(
        "customers.confirmation_closed",
        "o pedido já foi confirmado; o «sim» está registado",
      );
    default:
      throw new ErroClientes(
        "customers.confirmation_closed",
        `o pedido já não está pendente (${String(r?.resultado)})`,
      );
  }
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
 * As declarações da ficha, as mais recentes primeiro, por páginas (revisão do
 * #289, P2-3), e a resposta da régua única por canal — nunca contada aqui
 * (R6): pergunta-se à base.
 */
export async function listarConsentimentos(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
  limite: number,
  antes: string | null,
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
    // As da ficha e as das fichas fundidas nela (migração 0046): a régua
    // conta-as todas, e a lista mostra o que a régua conta.
    const doGrupo = sql<boolean>`cliente_id in (select clientes_do_grupo(${clienteId}::uuid))`;
    const { n } = await trx
      .selectFrom("consentimento")
      .where(doGrupo)
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    let q = trx.selectFrom("consentimento").selectAll().where(doGrupo);
    if (antes !== null) {
      q = q.where(
        sql<boolean>`(declarado_em, id) < (select c.declarado_em, c.id
          from consentimento c where c.id = ${antes}::uuid)`,
      );
    }
    const linhas = await q
      .orderBy("declarado_em", "desc")
      .orderBy("id", "desc")
      .limit(limite + 1)
      .execute();
    const haMais = linhas.length > limite;
    const dados = haMais ? linhas.slice(0, limite) : linhas;
    const { rows } = await sql<Record<CanalConsentimento, boolean>>`
      select pode_receber_marketing(${clienteId}::uuid, 'email') as email,
             pode_receber_marketing(${clienteId}::uuid, 'sms') as sms,
             pode_receber_marketing(${clienteId}::uuid, 'whatsapp') as whatsapp`.execute(
      trx,
    );
    const r = rows[0];
    const regua = Object.fromEntries(
      CANAIS_CONSENTIMENTO.map((canal) => [canal, r?.[canal] === true]),
    ) as Record<CanalConsentimento, boolean>;
    // Por contacto (0052): os contactos da ficha com «sim» em cada canal.
    const { rows: porLinha } = await sql<Record<CanalConsentimento, string[]>>`
      select contactos_com_marketing(${clienteId}::uuid, 'email') as email,
             contactos_com_marketing(${clienteId}::uuid, 'sms') as sms,
             contactos_com_marketing(${clienteId}::uuid, 'whatsapp') as whatsapp`.execute(
      trx,
    );
    const porContacto = Object.fromEntries(
      CANAIS_CONSENTIMENTO.map((canal) => [canal, porLinha[0]?.[canal] ?? []]),
    ) as Record<CanalConsentimento, string[]>;
    return {
      dados,
      total: Number(n),
      ultimo: haMais ? (dados.at(-1)?.id ?? null) : null,
      regua,
      porContacto,
    };
  });
}

// ------------------------------------- Duplicados e fusões (§3.7, 0046)

/** Os candidatos a duplicado, os mais recentes primeiro. */
export async function listarDuplicados(
  db: Kysely<BaseDados>,
  comercianteId: string,
  estado: EstadoDuplicado,
  limite: number,
  antes: string | null,
) {
  return noClientes(db, comercianteId, async (trx) => {
    const { n } = await trx
      .selectFrom("duplicado_cliente")
      .where("estado", "=", estado)
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    let q = trx
      .selectFrom("duplicado_cliente")
      .selectAll()
      .where("estado", "=", estado);
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

export async function obterDuplicado(
  db: Kysely<BaseDados>,
  comercianteId: string,
  id: string,
) {
  const d = await noClientes(db, comercianteId, (trx) =>
    trx
      .selectFrom("duplicado_cliente")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst(),
  );
  if (d === undefined) {
    throw new ErroClientes("customers.not_found", "candidato inexistente");
  }
  return d;
}

/** Descarta um candidato; só uma pessoa ou a chave dela (a base confere). */
export async function descartarDuplicado(
  db: Kysely<BaseDados>,
  comercianteId: string,
  id: string,
  motivo: string | null,
): Promise<void> {
  await noClientes(db, comercianteId, (trx) =>
    sql`select duplicado_descartar(${id}::uuid, ${motivo})`.execute(trx),
  );
}

/** O que a fusão muda (com `ensaio`, sem escrever), como a base o devolve. */
export interface PlanoFusao {
  ensaio: boolean;
  fica: string;
  absorvida: string;
  emails_acrescentados: string[];
  telefones_acrescentados: string[];
  perfis_copiados: { de: string; para: string | null }[];
  perfis_iguais_nao_copiados: string[];
  isencoes_por_repor: string[];
  etiquetas_copiadas: string[];
  etiquetas_arquivadas_nao_copiadas: string[];
  consentimentos_da_absorvida: number;
  encomendas_ficam_na_absorvida: number;
  limitado: boolean;
  marketing_antes: Record<CanalConsentimento, boolean>;
  marketing_depois: Record<CanalConsentimento, boolean>;
}

/** Funde `absorve` em `fica` (cliente_fundir, migração 0046). */
export async function fundirClientes(
  db: Kysely<BaseDados>,
  comercianteId: string,
  fica: string,
  absorve: string,
  ensaio: boolean,
): Promise<PlanoFusao> {
  const { rows } = await noClientes(db, comercianteId, (trx) =>
    sql<{ plano: PlanoFusao }>`
      select cliente_fundir(${fica}::uuid, ${absorve}::uuid, ${ensaio}) as plano`.execute(
      trx,
    ),
  );
  const plano = rows[0]?.plano;
  if (plano === undefined) throw new Error("cliente_fundir sem resposta");
  return plano;
}

// ------------------------------------- Pedidos do titular (§7.1, 0049)

/** Liga ou desliga a limitação (cliente_limitar); devolve o id do pedido. */
export async function limitarCliente(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
  limitar: boolean,
  verificacao: string,
): Promise<string> {
  const { rows } = await noClientes(db, comercianteId, (trx) =>
    sql<{ id: string }>`
      select cliente_limitar(${clienteId}::uuid, ${limitar}, ${verificacao}) as id`.execute(
      trx,
    ),
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("cliente_limitar sem resposta");
  return id;
}

/** O que a pseudonimização fez (contagens, sem dados pessoais). */
export interface ResultadoPseudonimizacao {
  fichas: number;
  perfis_pseudonimizados: number;
  perfis_mantidos_por_obrigacao_fiscal: number;
  consentimentos_apagados: number;
  etiquetas_retiradas: number;
  provas_vies_apagadas: number;
  isencoes_limpas: number;
  entradas_da_linha_do_tempo: number;
  fichas_com_o_mesmo_contacto: FichaComOMesmoContacto[];
}

/**
 * Pseudonimiza a ficha e as fundidas nela (cliente_pseudonimizar).
 * Irreversível. As fichas com o mesmo contacto contam-se antes, na mesma
 * transacção: depois, o grupo já não tem contactos para comparar.
 */
export async function pseudonimizarCliente(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
  confirmacao: string,
  verificacao: string,
): Promise<ResultadoPseudonimizacao> {
  return noClientes(db, comercianteId, async (trx) => {
    // A ficha presa primeiro: uma fusão a meio não muda o grupo entre a
    // contagem e o apagamento.
    await sql`select id from cliente where id = ${clienteId}::uuid for update`.execute(
      trx,
    );
    const { rows: grupo } = await sql<{ id: string }>`
      select clientes_do_grupo(${clienteId}::uuid) as id`.execute(trx);
    const mesmoContacto = await fichasComOMesmoContacto(
      trx,
      grupo.map((g) => g.id),
    );
    const { rows } = await sql<{
      r: Omit<ResultadoPseudonimizacao, "fichas_com_o_mesmo_contacto">;
    }>`
      select cliente_pseudonimizar(${clienteId}::uuid, ${confirmacao}, ${verificacao}) as r`.execute(
      trx,
    );
    const r = rows[0]?.r;
    if (r === undefined) throw new Error("cliente_pseudonimizar sem resposta");
    return { ...r, fichas_com_o_mesmo_contacto: mesmoContacto };
  });
}

export async function listarPedidosTitular(
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
    const pedidos = await trx
      .selectFrom("pedido_titular")
      .selectAll()
      .where(
        sql<boolean>`cliente_id in (select clientes_do_grupo(${clienteId}::uuid))`,
      )
      .orderBy("id", "desc")
      .execute();
    // Com as encomendas de um apagamento que ainda esperam por acabar
    // (docs/23 §15.3): o pedido só fica completo quando chegarem a zero.
    const { rows } = await sql<{ pedido_id: string; n: number }>`
      select pedido_id, n from titular_por_acabar(${pedidos.map((p) => p.id)}::uuid[])`.execute(
      trx,
    );
    const porAcabar = new Map(rows.map((r) => [r.pedido_id, r.n]));
    return pedidos.map((p) => ({
      ...p,
      encomendas_por_acabar: porAcabar.get(p.id) ?? 0,
    }));
  });
}

/** Uma ficha de fora do grupo com um e-mail ou telefone igual (§15.5). */
export interface FichaComOMesmoContacto {
  id: string;
  estado: string;
  /** `email`, `telefone` ou os dois; nunca o contacto em si. */
  sinais: string[];
}

/**
 * As outras fichas do comerciante com um e-mail ou telefone igual ao de uma
 * ficha do grupo (docs/23 §15.5). Ex.: a Ana comprou duas vezes sem conta e
 * tem duas fichas; o pedido sobre uma lista a outra. Só se lista: decide o
 * dono se as funde antes — o sistema nunca (regra 6 do AGENTS.md).
 */
async function fichasComOMesmoContacto(
  trx: Kysely<BaseDados>,
  ids: string[],
): Promise<FichaComOMesmoContacto[]> {
  // Os contactos do grupo primeiro, numa lista cada: a comparação com
  // `&&` usa os índices GIN da 0046 (revisão do #411, P2-3).
  const { rows: g } = await sql<{ emails: string[]; telefones: string[] }>`
    select coalesce(array_agg(distinct e) filter (where e is not null), '{}') as emails,
           coalesce(array_agg(distinct t) filter (where t is not null), '{}') as telefones
    from cliente c
    left join lateral unnest(emails_para_comparar(c.emails)) e on true
    left join lateral unnest(c.telefones) t on true
    where c.id = any(${ids}::uuid[])`.execute(trx);
  const emails = g[0]?.emails ?? [];
  const telefones = g[0]?.telefones ?? [];
  if (emails.length === 0 && telefones.length === 0) return [];
  const { rows } = await sql<FichaComOMesmoContacto>`
    select c.id, c.estado,
           array_remove(array[
             case when emails_para_comparar(c.emails) && ${emails}::text[]
               then 'email' end,
             case when c.telefones && ${telefones}::text[] then 'telefone' end
           ], null) as sinais
    from cliente c
    where (emails_para_comparar(c.emails) && ${emails}::text[]
           or c.telefones && ${telefones}::text[])
      and c.id <> all(${ids}::uuid[])
      and c.estado not in ('fundido', 'pseudonimizado')
    order by c.id`.execute(trx);
  return rows;
}

/**
 * Tudo o que este domínio guarda sobre a pessoa, na ficha e nas fundidas
 * nela, e as encomendas (só para ler; o domínio delas junta o resto). Regista
 * o pedido na mesma transacção: sem registo, não há exportação.
 */
export async function exportarCliente(
  db: Kysely<BaseDados>,
  comercianteId: string,
  clienteId: string,
  verificacao: string,
) {
  return noClientes(db, comercianteId, async (trx) => {
    // A ficha tomada para ler: uma escrita ou um apagamento a meio não
    // mistura estados no dossier (revisão do #314, P3-4).
    const ficha = await trx
      .selectFrom("cliente")
      .select("estado")
      .where("id", "=", clienteId)
      .forShare()
      .executeTakeFirst();
    if (ficha === undefined) {
      throw new ErroClientes("customers.not_found", "ficha inexistente");
    }
    // Uma ficha fundida dava um dossier sem a ficha que ficou (P3-3).
    if (ficha.estado === "fundido") {
      throw new ErroClientes(
        "customers.invalid_transition",
        "a ficha está fundido; peça pela ficha que ficou",
      );
    }
    const { rows: grupo } = await sql<{ id: string }>`
      select clientes_do_grupo(${clienteId}::uuid) as id`.execute(trx);
    const ids = grupo.map((g) => g.id);
    const fichas = [];
    for (const id of ids) {
      const linhas = (tabela: string, coluna = "cliente_id") =>
        sql<Record<string, unknown>>`
          select * from ${sql.table(tabela)}
          where ${sql.ref(coluna)} = ${id}::uuid order by id`
          .execute(trx)
          .then((r) => r.rows);
      const perfis = await linhas("perfil_faturacao");
      // A encomenda inteira (docs/23 §15.2): também os portes, o método de
      // entrega, as aceitações e a língua.
      const encomendas = await linhas("encomenda");
      const idsEncomendas = encomendas.map((e) => String(e["id"]));
      // Das encomendas desta ficha: `colunas` é a lista fixa do que sai
      // (nunca vem do pedido); sem ela, a linha inteira.
      const daEncomenda = async (tabela: string, colunas?: string[]) =>
        idsEncomendas.length === 0
          ? []
          : (
              await sql<Record<string, unknown>>`
              select ${colunas === undefined ? sql`*` : sql.join(colunas.map((c) => sql.ref(c)))}
              from ${sql.table(tabela)}
              where encomenda_id = any(${idsEncomendas}::uuid[])
              order by id`.execute(trx)
            ).rows;
      const pagamentos = await daEncomenda("pagamento");
      const idsPagamentos = pagamentos.map((p) => String(p["id"]));
      const ids_perfis = perfis.map((p) => String(p["id"]));
      const doPerfil = async (tabela: string) =>
        ids_perfis.length === 0
          ? []
          : (
              await sql<Record<string, unknown>>`
              select * from ${sql.table(tabela)}
              where perfil_id = any(${ids_perfis}::uuid[]) order by id`.execute(
                trx,
              )
            ).rows;
      fichas.push({
        ficha: (await linhas("cliente", "id"))[0],
        perfis_de_faturacao: perfis,
        provas_vies: await doPerfil("validacao_vies"),
        isencoes_manuais: await doPerfil("isencao_manual"),
        // Os anexos das isenções (0055): o que são, sem os bytes (lêem-se
        // pela rota deles).
        anexos_das_isencoes:
          ids_perfis.length === 0
            ? []
            : (
                await sql<Record<string, unknown>>`
                select a.id, a.isencao_id, a.nome, a.tipo, a.tamanho, a.resumo,
                       a.posto_por, a.posto_em
                from anexo_isencao a
                join isencao_manual i on i.id = a.isencao_id
                where i.perfil_id = any(${ids_perfis}::uuid[]) order by a.id`.execute(
                  trx,
                )
              ).rows,
        etiquetas: (
          await sql<{ id: string; nome: string }>`
            select e.id, e.nome from cliente_etiqueta ce
            join etiqueta_cliente e on e.id = ce.etiqueta_id
            where ce.cliente_id = ${id}::uuid order by e.id`.execute(trx)
        ).rows,
        consentimentos: await linhas("consentimento"),
        // Os pedidos de dupla confirmação (0052), sem o resumo do segredo.
        confirmacoes_de_consentimento: (
          await sql<Record<string, unknown>>`
            select id, canal, contacto, texto, versao_texto, onde, estado,
                   tentativas, expira_em, pedida_por, pedida_em, fechada_em,
                   consentimento_id
            from confirmacao_consentimento where cliente_id = ${id}::uuid
            order by id`.execute(trx)
        ).rows,
        encomendas,
        linhas_das_encomendas: await daEncomenda("linha_encomenda"),
        pagamentos,
        // Da expedição, o que a pessoa vê: sem a etiqueta nem as tentativas
        // de a pedir (técnico).
        expedicoes: await daEncomenda("expedicao", [
          "id",
          "encomenda_id",
          "metodo_entrega",
          "transportadora",
          "servico",
          "seguimento",
          "url_seguimento",
          "estado",
          "peso_g",
          "criada_em",
          "expedida_em",
          "entregue_em",
          "prova_entrega",
        ]),
        // O seguimento da transportadora: o estado que ela deu (pode trazer
        // quem recebeu, como a prova de entrega) e o normalizado; sem o id
        // do evento dela nem o aviso em bruto (Diogo, 13/10/2026; revisão do
        // #411, P3-2).
        seguimento_das_expedicoes:
          idsEncomendas.length === 0
            ? []
            : (
                await sql<Record<string, unknown>>`
                select s.id, s.expedicao_id, s.estado_transportadora,
                       s.estado_normalizado, s.em
                from evento_seguimento s
                join expedicao x on x.id = s.expedicao_id
                where x.encomenda_id = any(${idsEncomendas}::uuid[])
                order by s.expedicao_id, s.em, s.id`.execute(trx)
              ).rows,
        // O histórico de estados, sem o motivo nem quem mudou (§15.2).
        estados_das_encomendas: await daEncomenda("transicao_encomenda", [
          "id",
          "encomenda_id",
          "de",
          "para",
          "em",
          "canal",
        ]),
        estados_dos_pagamentos:
          idsPagamentos.length === 0
            ? []
            : (
                await sql<Record<string, unknown>>`
                select id, pagamento_id, de, para, origem, em, canal
                from transicao_pagamento
                where pagamento_id = any(${idsPagamentos}::uuid[])
                order by id`.execute(trx)
              ).rows,
        // Os documentos fiscais: o tipo, o estado, o comprador e os totais
        // da última versão do conteúdo e, se já foi emitido, o número, a
        // série, a data, o ATCUD e os totais do documento lido de volta.
        // Sem o PDF nem a resposta em bruto (Q4); o rasto (com o motivo das
        // correcções) não sai.
        documentos_fiscais:
          idsEncomendas.length === 0
            ? []
            : (
                await sql<Record<string, unknown>>`
                select d.id, d.encomenda_id, d.tipo, d.estado, d.criado_em,
                       d.original_id, d.reembolso_id,
                       c.conteudo -> 'cliente' as comprador,
                       c.conteudo -> 'totais' as totais,
                       p.numero, p.serie, p.data, p.atcud,
                       p.totais as totais_no_documento,
                       -- Como ficou no documento lido de volta (pode
                       -- divergir do enviado; revisão do #411, P2-2).
                       case when p.documento_id is not null then
                         jsonb_build_object('nif', p.nif, 'nome', p.nome,
                                            'pais', p.pais)
                       end as comprador_no_documento,
                       -- Emitido fora do Eurolify: o número declarado
                       -- (0070; revisão do #411, P2-1).
                       d.fora_numero as numero_declarado
                from documento_fiscal d
                left join lateral (
                  select x.conteudo from documento_conteudo x
                  where x.documento_id = d.id order by x.versao desc limit 1
                ) c on true
                left join lateral (
                  select y.documento_id, y.numero, y.serie, y.data, y.atcud,
                         y.totais, y.nif, y.nome, y.pais
                  from documento_prova y
                  where y.documento_id = d.id order by y.lida_em desc, y.id desc
                  limit 1
                ) p on true
                where d.encomenda_id = any(${idsEncomendas}::uuid[])
                order by d.id`.execute(trx)
              ).rows,
        pedidos_de_livre_resolucao: await daEncomenda(
          "pedido_livre_resolucao",
          [
            "id",
            "encomenda_id",
            "origem",
            "contacto",
            "recebido_em",
            "prazo_ate",
            "dentro_do_prazo",
            "estado",
            "confirmacao",
            "motivo_decisao",
          ],
        ),
        // Os artigos e as quantidades que a pessoa quis devolver.
        linhas_da_livre_resolucao:
          idsEncomendas.length === 0
            ? []
            : (
                await sql<Record<string, unknown>>`
                select l.pedido_id, l.linha_encomenda_id, l.quantidade
                from linha_livre_resolucao l
                join pedido_livre_resolucao p on p.id = l.pedido_id
                where p.encomenda_id = any(${idsEncomendas}::uuid[])
                order by l.pedido_id, l.linha_encomenda_id`.execute(trx)
              ).rows,
        devolucoes: await daEncomenda("devolucao", [
          "id",
          "encomenda_id",
          "origem",
          "pedido_livre_resolucao_id",
          "motivo",
          "transportadora",
          "seguimento",
          "estado",
          "criada_em",
          "prazo_passado_em",
        ]),
        linhas_das_devolucoes:
          idsEncomendas.length === 0
            ? []
            : (
                await sql<Record<string, unknown>>`
                select l.devolucao_id, l.linha_encomenda_id, l.pedida,
                       l.recebida, l.aceite, l.estado_artigo,
                       -- A decisão que reembolsa ou recusa um artigo selado
                       -- aberto (0065, H6).
                       l.decisao_higiene
                from linha_devolucao l
                join devolucao d on d.id = l.devolucao_id
                where d.encomenda_id = any(${idsEncomendas}::uuid[])
                order by l.devolucao_id, l.linha_encomenda_id`.execute(trx)
              ).rows,
        problemas: await daEncomenda("problema", [
          "id",
          "encomenda_id",
          "tipo",
          "descricao",
          "estado",
          "criado_em",
        ]),
        // De que linhas (e dos portes, sem linha) é cada reembolso.
        linhas_dos_reembolsos:
          idsEncomendas.length === 0
            ? []
            : (
                await sql<Record<string, unknown>>`
                select l.reembolso_id, l.posicao, l.linha_encomenda_id,
                       l.quantidade, l.montante
                from linha_reembolso l
                join reembolso r on r.id = l.reembolso_id
                where r.encomenda_id = any(${idsEncomendas}::uuid[])
                order by l.reembolso_id, l.posicao`.execute(trx)
              ).rows,
        // Os reembolsos sem a prova (data, referência do banco, quem) nem a
        // falha técnica (§15.2).
        reembolsos: await daEncomenda("reembolso", [
          "id",
          "encomenda_id",
          "pagamento_id",
          "origem",
          "devolucao_id",
          "problema_id",
          "montante",
          "moeda",
          "via",
          "estado",
          "criado_em",
          "pedido_em",
          "executado_em",
        ]),
        // Os pares em que esta ficha entra: só os ids, o sinal e o estado.
        candidatos_a_duplicado: (
          await sql<Record<string, unknown>>`
            select id, cliente_a, cliente_b, sinais, estado, criado_em
            from duplicado_cliente
            where cliente_a = ${id}::uuid or cliente_b = ${id}::uuid
            order by id`.execute(trx)
        ).rows,
        linha_do_tempo: await linhas("alteracao_cliente"),
      });
    }
    const pedidoId = (
      await sql<{ id: string }>`
        select pedido_titular_exportar(${clienteId}::uuid, ${verificacao}) as id`.execute(
        trx,
      )
    ).rows[0]?.id;
    const pedidos = await trx
      .selectFrom("pedido_titular")
      .selectAll()
      .where("cliente_id", "in", ids)
      .orderBy("id")
      .execute();
    return {
      pedido: pedidoId ?? null,
      cliente: clienteId,
      estado: ficha.estado,
      gerada_em: new Date().toISOString(),
      fichas,
      pedidos_do_titular: pedidos,
      fichas_com_o_mesmo_contacto: await fichasComOMesmoContacto(trx, ids),
    };
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
