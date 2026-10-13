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

/** O que a expedição leva, para conferir um serviço. */
interface Caixa {
  pais: string;
  temTelefone: boolean;
  pesoG: number | null;
  onu: ReadonlySet<string>;
}

/** Porque é que o serviço não serve a caixa, ou `null` se serve. */
export function porQueNaoServeACaixa(
  s: ServicoTransportadora,
  caixa: Caixa,
): string | null {
  if (!s.paises.includes(caixa.pais)) return "não entrega no país da morada";
  if (s.pesoMaxG !== null && caixa.pesoG !== null && caixa.pesoG > s.pesoMaxG) {
    return "a caixa pesa mais do que o serviço aceita";
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

/** A expedição presa, com o que a caixa leva e o peso que a etiqueta usaria. */
async function caixaDa(trx: Transaction<BaseDados>, id: string) {
  const x = await trx
    .selectFrom("expedicao")
    .innerJoin("armazem", "armazem.id", "expedicao.armazem_id")
    .innerJoin("encomenda", "encomenda.id", "expedicao.encomenda_id")
    .select([
      "expedicao.id",
      "expedicao.versao",
      "expedicao.metodo_entrega",
      "expedicao.peso_corrigido_g",
      "expedicao.conta_escolhida_id",
      "expedicao.servico_escolhido",
      "armazem.embalagem_g",
      "encomenda.entrega",
      "encomenda.contacto",
    ])
    .where("expedicao.id", "=", id)
    .forUpdate(["expedicao"])
    .executeTakeFirst();
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
      temTelefone:
        typeof contacto.telefone === "string" && contacto.telefone !== "",
      pesoG: x.peso_corrigido_g ?? calculadoG,
      onu,
    } satisfies Caixa,
  };
}

const conferirVersao = (actual: number, pedida: number) => {
  if (actual !== pedida) {
    throw new ErroEnvios("shipping.version_conflict", "a expedição mudou", {
      versao: actual,
    });
  }
};

/** As contas prontas do comerciante e os serviços de cada uma. */
async function contasProntas(
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
 * Os serviços que servem esta expedição (o país, o peso, os perigosos, o
 * telefone), de contas prontas, com o vendido e o escolhido marcados.
 */
export async function servicosDaExpedicao(
  db: Kysely<BaseDados>,
  c: string,
  id: string,
  cfg: ConfigEnvios | undefined,
) {
  return noEnvios(db, c, async (trx) => {
    const { x, calculadoG, vendido, caixa } = await caixaDa(trx, id);
    const opcoes = [];
    for (const conta of await contasProntas(trx, cfg)) {
      for (const s of conta.servicos) {
        if (porQueNaoServeACaixa(s, caixa) !== null) continue;
        opcoes.push({
          conta: conta.id,
          conta_nome: conta.nome,
          transportadora: conta.transportadora,
          servico: s.codigo,
          nome: s.nome,
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
      vendido,
      escolhido:
        x.conta_escolhida_id === null || x.servico_escolhido === null
          ? null
          : { conta: x.conta_escolhida_id, servico: x.servico_escolhido },
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
  quem: string,
) {
  return noEnvios(db, c, async (trx) => {
    await marcar(trx, quem, dados.motivo);
    const { x } = await caixaDa(trx, id);
    conferirVersao(x.versao, dados.versao);
    if (x.peso_corrigido_g === dados.peso_g) return x.versao;
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
    const { x, caixa } = await caixaDa(trx, id);
    conferirVersao(x.versao, dados.versao);
    if ((dados.conta === null) !== (dados.servico === null)) {
      throw new ErroEnvios(
        "shipping.invalid_field",
        "a conta e o serviço vão juntos (os dois, ou nenhum para voltar ao vendido)",
      );
    }
    if (dados.conta !== null && dados.servico !== null) {
      const conta = await trx
        .selectFrom("conta_transportadora")
        .select(["id", "estado", "transportadora", "servicos"])
        .where("id", "=", dados.conta)
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
      ).find((s) => s.codigo === dados.servico);
      if (servico === undefined) {
        throw new ErroEnvios(
          "shipping.service_unknown",
          "a conta não tem este serviço",
        );
      }
      const porque = porQueNaoServeACaixa(servico, caixa);
      if (porque !== null) {
        throw new ErroEnvios(
          "shipping.invalid_field",
          `o serviço não serve esta expedição: ${porque}`,
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
