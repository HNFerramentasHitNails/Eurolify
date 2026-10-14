import { sql, type Kysely, type Transaction } from "kysely";
import type { BaseDados, Transportadora } from "../base/esquema.js";
import { conteudoDe } from "../checkout/entrega.js";
import type { ConfigEnvios, ServicoTransportadora } from "./adaptador.js";
import { ErroEnvios } from "./erros.js";
import { adaptadorDe, noEnvios, servicosDe } from "./repositorio.js";

// Corrigir o peso e mudar o serviço de uma expedição, com motivo (docs/36
// §19; migração 0086). O vendido não muda: a encomenda e a cópia do método
// na expedição ficam como estão. A base guarda o rasto e recusa com uma
// etiqueta viva ou com a expedição já fora de `criada`; aqui confere-se que
// o serviço serve esta expedição, como a etiqueta o pediria.

/** Há telefone de quem recebe (o mesmo critério na etiqueta; P3-1). */
export const temTelefone = (t: unknown): t is string =>
  typeof t === "string" && t.trim() !== "";

/** O que a expedição leva, para conferir um serviço. */
interface Caixa {
  pais: string;
  /** A encomenda entrega num ponto de recolha (docs/36 §21). */
  ponto: boolean;
  temTelefone: boolean;
  /** O peso da caixa, ou o do volume mais pesado (docs/36 §23). */
  pesoG: number | null;
  onu: ReadonlySet<string>;
  /** Quantos volumes (docs/36 §23); 1 sem volumes. */
  volumes: number;
}

/** É o serviço vendido (a conta e o serviço da cópia do método)? */
const eoVendido = (
  vendido: { conta: string; servico: string } | null,
  conta: string,
  servico: string,
) => vendido !== null && vendido.conta === conta && vendido.servico === servico;

/** Porque é que o serviço não serve a caixa, ou `null` se serve. */
export function porQueNaoServeACaixa(
  s: ServicoTransportadora,
  caixa: Caixa,
): string | null {
  if (!s.paises.includes(caixa.pais)) return "não entrega no país da morada";
  // A entrega vendida (morada ou ponto) não muda com o serviço (§21).
  if ((s.ponto === true) !== caixa.ponto) {
    return caixa.ponto
      ? "não entrega em pontos de recolha, e a encomenda é para um ponto"
      : "entrega em pontos de recolha, e a encomenda é para uma morada";
  }
  // O máximo do serviço é por volume (docs/36 §23).
  if (caixa.volumes > (s.maxVolumes ?? 1)) {
    return `não leva ${String(caixa.volumes)} volumes num envio (no máximo ${String(s.maxVolumes ?? 1)})`;
  }
  if (s.pesoMaxG !== null && caixa.pesoG !== null && caixa.pesoG > s.pesoMaxG) {
    return caixa.volumes > 1
      ? "um volume pesa mais do que o serviço aceita"
      : "a caixa pesa mais do que o serviço aceita";
  }
  if ([...caixa.onu].some((n) => !s.aceitaOnu.includes(n))) {
    return "não aceita uma mercadoria perigosa desta expedição";
  }
  if (s.pedeTelefone && !caixa.temTelefone) {
    return "pede o telefone de quem recebe, e a encomenda não o tem";
  }
  return null;
}

async function marcar(
  trx: Transaction<BaseDados>,
  quem: string,
  motivo: string,
) {
  await sql`select set_config('eurolify.quem', ${quem}, true),
    set_config('eurolify.motivo', ${motivo}, true)`.execute(trx);
}

/**
 * A expedição (presa, para mudar), com o que a caixa leva e o peso que a
 * etiqueta usaria. Uma leitura não prende (revisão do #429, P2-3).
 */
async function caixaDa(
  trx: Transaction<BaseDados>,
  id: string,
  prender = false,
) {
  const consulta = trx
    .selectFrom("expedicao")
    .innerJoin("armazem", "armazem.id", "expedicao.armazem_id")
    .innerJoin("encomenda", "encomenda.id", "expedicao.encomenda_id")
    .select([
      "expedicao.id",
      "expedicao.versao",
      "expedicao.estado",
      "expedicao.etiqueta",
      "expedicao.metodo_entrega",
      "expedicao.peso_corrigido_g",
      "expedicao.conta_escolhida_id",
      "expedicao.servico_escolhido",
      "expedicao.volumes_g",
      "armazem.embalagem_g",
      "encomenda.entrega",
      "encomenda.contacto",
    ])
    .where("expedicao.id", "=", id);
  const x = await (
    prender ? consulta.forUpdate(["expedicao"]) : consulta
  ).executeTakeFirst();
  if (x === undefined) {
    throw new ErroEnvios("shipping.not_found", "esta expedição não existe");
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
  const calculadoG = pesoG === null ? null : pesoG + x.embalagem_g;
  const entrega = x.entrega as { pais: string };
  const contacto = x.contacto as { telefone?: string | null };
  const metodo = x.metodo_entrega as { conta?: string; servico?: string };
  return {
    x,
    calculadoG,
    vendido:
      metodo.conta === undefined || metodo.servico === undefined
        ? null
        : { conta: metodo.conta, servico: metodo.servico },
    caixa: {
      pais: entrega.pais,
      ponto: (entrega as { ponto?: unknown }).ponto !== undefined,
      temTelefone: temTelefone(contacto.telefone),
      // Com volumes, conta o mais pesado (o máximo do serviço é por volume).
      pesoG:
        x.volumes_g === null
          ? (x.peso_corrigido_g ?? calculadoG)
          : Math.max(...x.volumes_g),
      onu,
      volumes: x.volumes_g?.length ?? 1,
    } satisfies Caixa,
  };
}

/**
 * Só uma expedição criada e sem etiqueta viva se corrige (o gatilho da 0086
 * confere outra vez); uma acabada respondia 500 pelo gatilho da 0079
 * (revisão do #429, P1-1).
 */
const conferirCorrigivel = (x: { estado: string; etiqueta: string }) => {
  if (x.estado !== "criada") {
    throw new ErroEnvios(
      "shipping.invalid_transition",
      `a expedição já não está criada (${x.estado})`,
    );
  }
  if (!["por_pedir", "recusada", "anulada"].includes(x.etiqueta)) {
    throw new ErroEnvios(
      "shipping.label_exists",
      `com a etiqueta ${x.etiqueta} não se corrige (anula-se primeiro)`,
    );
  }
};

const conferirVersao = (actual: number, pedida: number) => {
  if (actual !== pedida) {
    throw new ErroEnvios("shipping.version_conflict", "a expedição mudou", {
      versao: actual,
    });
  }
};

/** As contas prontas do comerciante e os serviços de cada uma. */
export async function contasProntas(
  trx: Transaction<BaseDados>,
  cfg: ConfigEnvios | undefined,
) {
  const contas = await trx
    .selectFrom("conta_transportadora")
    .select(["id", "nome", "transportadora", "servicos"])
    .where("estado", "=", "pronta")
    .orderBy("criado_em")
    .execute();
  const r: {
    id: string;
    nome: string;
    transportadora: Transportadora;
    servicos: readonly ServicoTransportadora[];
  }[] = [];
  for (const c of contas) {
    // Uma transportadora sem adaptador neste servidor não oferece nada.
    let servicos: readonly ServicoTransportadora[];
    try {
      servicos = servicosDe(
        adaptadorDe(cfg, c.transportadora).adaptador,
        c.servicos,
      );
    } catch (erro) {
      if (
        erro instanceof ErroEnvios &&
        erro.codigo === "shipping.not_configured"
      ) {
        throw erro;
      }
      continue;
    }
    r.push({ ...c, servicos });
  }
  return r;
}

/**
 * O serviço de uma conta, conferido: a conta pronta e o serviço dela. Lança
 * o erro de cada falha (a etiqueta e as correcções dão o mesmo).
 */
async function servicoDaConta(
  trx: Transaction<BaseDados>,
  cfg: ConfigEnvios | undefined,
  contaId: string,
  codigo: string,
) {
  const conta = await trx
    .selectFrom("conta_transportadora")
    .select(["id", "estado", "transportadora", "servicos"])
    .where("id", "=", contaId)
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
  const servico = servicosDe(
    adaptadorDe(cfg, conta.transportadora).adaptador,
    conta.servicos,
  ).find((s) => s.codigo === codigo);
  if (servico === undefined) {
    throw new ErroEnvios(
      "shipping.service_unknown",
      "a conta não tem este serviço",
    );
  }
  return servico;
}

/**
 * Os serviços que servem esta expedição (o país, o peso, os perigosos, o
 * telefone), de contas prontas, com o vendido e o escolhido marcados; e
 * porque é que o escolhido já não serve, se for o caso (P2-4).
 */
export async function servicosDaExpedicao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigEnvios | undefined,
) {
  return noEnvios(db, c, async (trx) => {
    const { x, calculadoG, vendido, caixa } = await caixaDa(trx, id);
    let escolhidoNaoServe: string | null = null;
    if (x.conta_escolhida_id !== null && x.servico_escolhido !== null) {
      try {
        const s = await servicoDaConta(
          trx,
          cfg,
          x.conta_escolhida_id,
          x.servico_escolhido,
        );
        escolhidoNaoServe = porQueNaoServeACaixa(s, caixa);
      } catch (erro) {
        if (!(erro instanceof ErroEnvios)) throw erro;
        escolhidoNaoServe = erro.message;
      }
    }
    const opcoes = [];
    for (const conta of await contasProntas(trx, cfg)) {
      for (const s of conta.servicos) {
        if (porQueNaoServeACaixa(s, caixa) !== null) continue;
        if (caixa.ponto && !eoVendido(vendido, conta.id, s.codigo)) continue;
        opcoes.push({
          conta: conta.id,
          conta_nome: conta.nome,
          transportadora: conta.transportadora,
          servico: s.codigo,
          nome: s.nome,
          max_volumes: s.maxVolumes ?? 1,
          vendido: vendido?.conta === conta.id && vendido.servico === s.codigo,
          escolhido:
            x.conta_escolhida_id === conta.id &&
            x.servico_escolhido === s.codigo,
        });
      }
    }
    return {
      versao: x.versao,
      peso_calculado_g: calculadoG,
      peso_corrigido_g: x.peso_corrigido_g,
      volumes_g: x.volumes_g,
      vendido,
      escolhido:
        x.conta_escolhida_id === null || x.servico_escolhido === null
          ? null
          : { conta: x.conta_escolhida_id, servico: x.servico_escolhido },
      escolhido_nao_serve: escolhidoNaoServe,
      opcoes,
    };
  });
}

/** Corrige o peso da caixa (`null` volta ao calculado). Devolve a versão. */
export async function corrigirPeso(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: { versao: number; peso_g: number | null; motivo: string },
  cfg: ConfigEnvios | undefined,
  quem: string,
) {
  return noEnvios(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo);
    const { x, caixa, calculadoG } = await caixaDa(trx, id, true);
    conferirCorrigivel(x);
    conferirVersao(x.versao, dados.versao);
    // Com volumes, o peso é o de cada volume (docs/36 §23).
    if (x.volumes_g !== null) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        "a expedição tem vários volumes: o peso corrige-se nos volumes",
      );
    }
    if (x.peso_corrigido_g === dados.peso_g) return x.versao;
    // Com um serviço escolhido, o peso novo tem de caber nele: diz-se já, e
    // não só ao pedir a etiqueta (P3-3).
    if (x.conta_escolhida_id !== null && x.servico_escolhido !== null) {
      const s = await servicoDaConta(
        trx,
        cfg,
        x.conta_escolhida_id,
        x.servico_escolhido,
      );
      const porque = porQueNaoServeACaixa(s, {
        ...caixa,
        pesoG: dados.peso_g ?? calculadoG,
      });
      if (porque !== null) {
        throw new ErroEnvios(
          "shipping.invalid_field",
          `o serviço escolhido deixa de servir: ${porque} (mude o serviço primeiro)`,
        );
      }
    }
    await trx
      .updateTable("expedicao")
      .set({ peso_corrigido_g: dados.peso_g, versao: x.versao + 1 })
      .where("id", "=", id)
      .execute();
    return x.versao + 1;
  });
}

/**
 * Escolhe outro serviço de uma conta pronta (`conta: null` volta ao
 * vendido). Só um serviço que sirva esta expedição. Devolve a versão.
 */
export async function mudarServico(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: {
    versao: number;
    conta: string | null;
    servico: string | null;
    motivo: string;
  },
  cfg: ConfigEnvios | undefined,
  quem: string,
) {
  return noEnvios(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo);
    const { x, caixa, vendido } = await caixaDa(trx, id, true);
    conferirCorrigivel(x);
    conferirVersao(x.versao, dados.versao);
    if ((dados.conta === null) !== (dados.servico === null)) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        "a conta e o serviço vão juntos (os dois, ou nenhum para voltar ao vendido)",
      );
    }
    if (dados.conta !== null && dados.servico !== null) {
      const servico = await servicoDaConta(
        trx,
        cfg,
        dados.conta,
        dados.servico,
      );
      const porque = porQueNaoServeACaixa(servico, caixa);
      if (porque !== null) {
        throw new ErroEnvios(
          "shipping.invalid_field",
          `o serviço não serve esta expedição: ${porque}`,
        );
      }
      // O ponto é da transportadora e da conta com que o cliente o
      // escolheu: numa expedição para um ponto, só o serviço vendido
      // (revisão do #439, P2-1).
      if (caixa.ponto && !eoVendido(vendido, dados.conta, dados.servico)) {
        throw new ErroEnvios(
          "shipping.invalid_field",
          "o serviço não serve esta expedição: o ponto de recolha foi escolhido com o serviço vendido",
        );
      }
    }
    if (
      x.conta_escolhida_id === dados.conta &&
      x.servico_escolhido === dados.servico
    ) {
      return x.versao;
    }
    await trx
      .updateTable("expedicao")
      .set({
        conta_escolhida_id: dados.conta,
        servico_escolhido: dados.servico,
        versao: x.versao + 1,
      })
      .where("id", "=", id)
      .execute();
    return x.versao + 1;
  });
}

/**
 * Os volumes da expedição (docs/36 §23): o peso de cada caixa, 2 a 15, ou
 * `null` para voltar a uma caixa. O serviço que a etiqueta vai usar (o
 * escolhido, ou o vendido) tem de os levar; um método manual não tem
 * etiqueta do Eurolify. Com volumes, o peso corrigido sai (o peso é o de
 * cada volume). Devolve a versão.
 */
export async function mudarVolumes(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  dados: { versao: number; volumes_g: number[] | null; motivo: string },
  cfg: ConfigEnvios | undefined,
  quem: string,
) {
  return noEnvios(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo);
    const { x, caixa, vendido } = await caixaDa(trx, id, true);
    conferirCorrigivel(x);
    conferirVersao(x.versao, dados.versao);
    const iguais =
      JSON.stringify(x.volumes_g) === JSON.stringify(dados.volumes_g);
    if (iguais) return x.versao;
    if (dados.volumes_g !== null) {
      const conta = x.conta_escolhida_id ?? vendido?.conta ?? null;
      const codigo = x.servico_escolhido ?? vendido?.servico ?? null;
      if (conta === null || codigo === null) {
        throw new ErroEnvios(
          "shipping.invalid_field",
          "o método vendido é manual: a etiqueta faz-se fora do Eurolify (escolha primeiro um serviço)",
        );
      }
      const servico = await servicoDaConta(trx, cfg, conta, codigo);
      const porque = porQueNaoServeACaixa(servico, {
        ...caixa,
        pesoG: Math.max(...dados.volumes_g),
        volumes: dados.volumes_g.length,
      });
      if (porque !== null) {
        throw new ErroEnvios(
          "shipping.invalid_field",
          `o serviço da etiqueta não serve estes volumes: ${porque} (mude o serviço primeiro)`,
        );
      }
    }
    await trx
      .updateTable("expedicao")
      .set({
        volumes_g: dados.volumes_g,
        ...(dados.volumes_g !== null && x.peso_corrigido_g !== null
          ? { peso_corrigido_g: null }
          : {}),
        versao: x.versao + 1,
      })
      .where("id", "=", id)
      .execute();
    return x.versao + 1;
  });
}

/** As correcções da expedição, da mais antiga à mais recente. */
export async function correcoesDaExpedicao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
) {
  return noEnvios(db, c, (trx) =>
    trx
      .selectFrom("correcao_expedicao")
      .select(["campo", "antes", "depois", "motivo", "quem", "em"])
      .where("expedicao_id", "=", id)
      .orderBy("em")
      .execute(),
  );
}
