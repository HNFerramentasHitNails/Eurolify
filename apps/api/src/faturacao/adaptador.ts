import type {
  AdaptadorFaturacao as NomeAdaptador,
  ConfigDaLigacao,
} from "../base/esquema.js";
import type { ChavePagamentos } from "../pagamentos/cifra.js";

// O contrato do adaptador de faturação (docs/29 §7.4; docs/08 §4): o mesmo
// para o adaptador de ensaio, para o Moloni (parte 2) e para o de um
// terceiro. O adaptador **não decide** nada fiscal: recebe a decisão já
// tomada (o conteúdo do pedido, já mapeado para as taxas e isenções do
// emissor) e traduz (third-party-extensions, regra 2).

/** As credenciais de uma ligação, já decifradas (só existem em memória). */
export type CredenciaisEmissor = Record<string, string>;

export interface EntidadeNoEmissor {
  id: string;
  /** O NIF como o emissor o tem (com ou sem prefixo). */
  nif: string | null;
  nome: string | null;
}

export interface LinhaPedida {
  /** O SKU do artigo; null nos portes (a única linha sem artigo, lição 3.6). */
  sku: string | null;
  descricao: string;
  quantidade: number;
  /** Cêntimos. */
  base: number;
  iva: number;
  total: number;
  /** A taxa do emissor (do mapa da ligação); null numa isenta. */
  taxa_emissor: string | null;
  /** Centésimas de ponto (para conferir). */
  taxa: number;
  /** A isenção do emissor (do mapa); null numa tributada. */
  isencao_emissor: string | null;
  codigo_motivo: string | null;
}

export interface PedidoRascunho {
  tipo: "fatura" | "nota_credito";
  /** Na nota de crédito: a fatura que corrige, como saiu. */
  original: { numero: string; emissor_id: string | null } | null;
  /** A nossa referência (`inv_…`), escrita no documento para o reencontrar. */
  referencia: string;
  serie: string | null;
  /** Os ids do emissor por omissão (docs/29 §13.2): cliente, artigos, métodos. */
  config: ConfigDaLigacao;
  /** A entidade já existente no emissor, ou null para a criar. */
  entidade_id: string | null;
  cliente: {
    nome: string;
    nif: string | null;
    pais: string | null;
    morada: Record<string, string | null>;
  };
  moeda: string;
  linhas: LinhaPedida[];
  totais: { base: number; iva: number; total: number };
  observacoes: string;
  meio_pagamento: string;
}

export interface LinhaNoEmissor {
  descricao: string;
  quantidade: number;
  base: number;
  /** Centésimas de ponto; 0 numa isenta. */
  taxa: number;
  codigo_motivo: string | null;
  iva: number;
}

/**
 * Um documento como o emissor o tem (rascunho ou fechado). Num documento de
 * consumidor final, `nif` e `pais` vêm vazios (o emissor põe lá o número de
 * consumidor final, que não é o de ninguém).
 */
export interface DocumentoNoEmissor {
  id: string;
  tipo: "fatura" | "nota_credito";
  estado: "rascunho" | "fechado";
  referencia: string | null;
  numero: string | null;
  serie: string | null;
  /** AAAA-MM-DD. */
  data: string | null;
  atcud: string | null;
  nif: string | null;
  nome: string | null;
  pais: string | null;
  linhas: LinhaNoEmissor[];
  /** Os totais do cabeçalho, como o emissor os devolve (lição 2.9). */
  totais: { base: number; iva: number; total: number };
  em_bruto: unknown;
}

export type Procura =
  | { estado: "encontrado"; documento: DocumentoNoEmissor }
  | { estado: "nao_existe" }
  | { estado: "nao_sei" };

/**
 * Um erro de rede, de tempo esgotado ou uma resposta que não se lê **depois
 * de pedir alguma coisa que pode ter ficado feita**: o pedido fica `incerto`
 * e reconcilia-se; nunca se repete às cegas (docs/29 §4.2).
 */
export class ErroDeRede extends Error {
  constructor(mensagem: string, options?: ErrorOptions) {
    super(mensagem, options);
    this.name = "ErroDeRede";
  }
}

/** O emissor recusou o pedido, com a mensagem dele (nada ficou feito). */
export class ErroDoEmissor extends Error {
  constructor(mensagem: string, options?: ErrorOptions) {
    super(mensagem, options);
    this.name = "ErroDoEmissor";
  }
}

/** Uma escolha lida do emissor (docs/22 §32): o id e o nome dele. */
export interface OpcaoDoEmissor {
  id: string;
  nome: string;
}

/** As listas de onde o dono escolhe os mapas e a configuração (docs/22 §32.1). */
export interface ListasDoEmissor {
  series: OpcaoDoEmissor[];
  /** `valor` em centésimas de ponto (2300 = 23 %); `zona` como o emissor a tem. */
  taxas: (OpcaoDoEmissor & { valor: number; zona: string | null })[];
  /** O id é o código do motivo no emissor. */
  isencoes: OpcaoDoEmissor[];
  metodos_pagamento: OpcaoDoEmissor[];
  linguas: (OpcaoDoEmissor & { codigo: string | null })[];
  vencimentos: (OpcaoDoEmissor & { dias: number | null })[];
  unidades: (OpcaoDoEmissor & { abreviatura: string | null })[];
  categorias: OpcaoDoEmissor[];
}

/**
 * Um resultado da pesquisa no emissor. De um cliente, só o id, o número e o
 * nome — nunca o contribuinte nem a morada (docs/22 §32.3).
 */
export type ResultadoNoEmissor =
  | {
      tipo: "artigo";
      id: string;
      nome: string;
      referencia: string | null;
      /** Cêntimos, sem IVA, como o emissor o tem. */
      preco: number | null;
    }
  | { tipo: "cliente"; id: string; nome: string; numero: string | null };

export interface AdaptadorFaturacao {
  readonly nome: NomeAdaptador;
  /** Lança se as credenciais não forem aceites. */
  testar(credenciais: CredenciaisEmissor): Promise<void>;
  /**
   * Um emissor cujos tokens mudam (o Moloni, docs/29 §13.4): devolve as
   * credenciais novas quando as renovou, ou null se as que tem ainda servem.
   * `usar`: antes de uma chamada (renova se o acesso está a acabar ou o par
   * tem mais de 7 dias); `manter`: a tarefa, só pela idade do par. **As
   * outras operações nunca renovam**: o par novo tem de se gravar antes de
   * se usar, e só quem chama sabe gravá-lo.
   */
  renovar?(
    credenciais: CredenciaisEmissor,
    motivo: "usar" | "manter",
  ): Promise<CredenciaisEmissor | null>;
  /**
   * Um emissor que se liga pela autorização dele (o Moloni, docs/29 §17): o
   * endereço onde o dono autoriza, com o valor `estado`; null se o endereço
   * de resposta não está configurado.
   */
  urlAutorizacao?(estado: string): string | null;
  /** Se o Eurolify pode usar esta empresa do emissor (M8, só as de teste). */
  empresaPermitida?(empresa: string): boolean;
  /**
   * A conta no emissor que as credenciais abrem (o `company_id` do Moloni),
   * para a base ver e não deixar ligar a mesma em duas ligações (docs/29
   * §19); null num emissor sem contas (o de ensaio).
   */
  contaDe?(credenciais: CredenciaisEmissor): string | null;
  /**
   * Troca o código da autorização pelas credenciais da `empresa` e confere
   * que dão acesso a ela (como `testar`). Lança o erro do emissor.
   */
  trocarCodigo?(codigo: string, empresa: string): Promise<CredenciaisEmissor>;
  /**
   * Pelo número sem prefixo (eu-vat-oss-ioss, «NIF»); null = não existe. Com
   * mais de uma entidade com esse número, devolve uma **sem NIF** — não
   * escolhe, e o pedido fica retido (docs/29 §13.3).
   */
  procurarEntidade(
    credenciais: CredenciaisEmissor,
    nifSemPrefixo: string,
  ): Promise<EntidadeNoEmissor | null>;
  /**
   * As listas do emissor para configurar a ligação (docs/22 §32): só um
   * emissor que as tem (o Moloni). Só leitura; lança o erro do emissor.
   */
  listas?(credenciais: CredenciaisEmissor): Promise<ListasDoEmissor>;
  /** Pesquisa um artigo ou um cliente (até 50). */
  pesquisar?(
    credenciais: CredenciaisEmissor,
    tipo: "artigo" | "cliente",
    texto: string,
  ): Promise<ResultadoNoEmissor[]>;
  /**
   * Se o artigo ou o cliente com este id existe no emissor; para
   * `consumidor_final`, também se tem o NIF de consumidor final.
   */
  existe?(
    credenciais: CredenciaisEmissor,
    tipo: "artigo" | "cliente" | "consumidor_final",
    id: string,
  ): Promise<boolean>;
  criarRascunho(
    credenciais: CredenciaisEmissor,
    pedido: PedidoRascunho,
  ): Promise<{ id: string }>;
  lerDocumento(
    credenciais: CredenciaisEmissor,
    id: string,
  ): Promise<DocumentoNoEmissor>;
  fechar(
    credenciais: CredenciaisEmissor,
    id: string,
  ): Promise<DocumentoNoEmissor>;
  /** Só rascunhos; um documento fechado nunca se apaga. */
  apagarRascunho(credenciais: CredenciaisEmissor, id: string): Promise<void>;
  procurarPorReferencia(
    credenciais: CredenciaisEmissor,
    referencia: string,
  ): Promise<Procura>;
  pdf(credenciais: CredenciaisEmissor, id: string): Promise<Buffer>;
}

/** Os adaptadores e a chave das credenciais (criarApp). */
export interface ConfigFaturacao {
  chave?: ChavePagamentos;
  adaptadores: Partial<Record<NomeAdaptador, AdaptadorFaturacao>>;
  /**
   * Para onde o endereço de resposta do Moloni reencaminha o navegador com o
   * código (o ecrã do Hub; docs/29 §17). Sem ele, uma página diz para voltar
   * ao Eurolify.
   */
  retornoAutorizacao?: string;
}

// ---------------------------------------------------------- O ensaio

/** O que um teste pode pedir ao emissor de ensaio que corra mal. */
export interface FalhasDoEnsaio {
  /** O pedido chega e fica feito, mas a resposta perde-se. */
  criarRascunho?: "rede" | "erro";
  fechar?: "rede" | "erro";
  procurarPorReferencia?: "nao_sei" | "rede";
  pdf?: "rede";
}

interface ContaDoEnsaio {
  entidades: Map<string, EntidadeNoEmissor>;
  /** Uma procura por este número devolve esta entidade (outra pessoa). */
  aliases: Map<string, EntidadeNoEmissor>;
  documentos: Map<string, DocumentoNoEmissor>;
  falhas: FalhasDoEnsaio;
  /** Corre antes de responder a uma procura pela referência (corridas). */
  antesDaProcura?: (() => Promise<void>) | undefined;
  /** Muda o rascunho ao criar (para provar que se confere antes de fechar). */
  aoCriar?: (d: DocumentoNoEmissor) => DocumentoNoEmissor;
  /** Muda o documento ao fechar (para provar a divergência). */
  aoFechar?: (d: DocumentoNoEmissor) => DocumentoNoEmissor;
  numero: number;
  chamadas: string[];
  /** Os pedidos de rascunho como chegaram (para conferir a tradução). */
  pedidos: PedidoRascunho[];
}

/**
 * Um emissor de ensaio, em memória (docs/29 Q5): comporta-se como um software
 * certificado (rascunho, fechar, numerar, procurar pela referência), só existe
 * em modo teste e **nunca** fala com ninguém. As credenciais são
 * `{ "conta": "…" }`; uma conta que começa por `recusa` não é aceite.
 */
export class EmissorDeEnsaio implements AdaptadorFaturacao {
  readonly nome = "ensaio" as const;
  readonly contas = new Map<string, ContaDoEnsaio>();

  conta(nome: string): ContaDoEnsaio {
    let c = this.contas.get(nome);
    if (c === undefined) {
      c = {
        entidades: new Map(),
        aliases: new Map(),
        documentos: new Map(),
        falhas: {},
        numero: 0,
        chamadas: [],
        pedidos: [],
      };
      this.contas.set(nome, c);
    }
    return c;
  }

  private daConta(credenciais: CredenciaisEmissor): ContaDoEnsaio {
    const nome = credenciais["conta"];
    if (nome === undefined || nome === "" || nome.startsWith("recusa")) {
      throw new ErroDoEmissor("credenciais recusadas pelo emissor de ensaio");
    }
    return this.conta(nome);
  }

  testar(credenciais: CredenciaisEmissor): Promise<void> {
    this.daConta(credenciais).chamadas.push("testar");
    return Promise.resolve();
  }

  procurarEntidade(
    credenciais: CredenciaisEmissor,
    nifSemPrefixo: string,
  ): Promise<EntidadeNoEmissor | null> {
    const c = this.daConta(credenciais);
    c.chamadas.push("procurarEntidade");
    return Promise.resolve(
      c.aliases.get(nifSemPrefixo) ?? c.entidades.get(nifSemPrefixo) ?? null,
    );
  }

  criarRascunho(
    credenciais: CredenciaisEmissor,
    pedido: PedidoRascunho,
  ): Promise<{ id: string }> {
    const c = this.daConta(credenciais);
    c.chamadas.push("criarRascunho");
    c.pedidos.push(structuredClone(pedido));
    if (c.falhas.criarRascunho === "erro") {
      return Promise.reject(new ErroDoEmissor("o emissor recusou o rascunho"));
    }
    let entidade =
      pedido.entidade_id === null
        ? null
        : ([...c.entidades.values(), ...c.aliases.values()].find(
            (e) => e.id === pedido.entidade_id,
          ) ?? null);
    if (entidade === null && pedido.cliente.nif !== null) {
      entidade = {
        id: `ent-${String(c.entidades.size + 1)}`,
        nif: pedido.cliente.nif,
        nome: pedido.cliente.nome,
      };
      c.entidades.set(pedido.cliente.nif.replace(/^[A-Z]{2}/, ""), entidade);
    }
    const id = `doc-${String(c.documentos.size + 1)}`;
    const linhas = pedido.linhas.map((l) => ({
      descricao: l.descricao,
      quantidade: l.quantidade,
      base: l.base,
      taxa: l.taxa,
      codigo_motivo: l.codigo_motivo,
      iva: l.iva,
    }));
    const base = linhas.reduce((s, l) => s + l.base, 0);
    const iva = linhas.reduce((s, l) => s + l.iva, 0);
    const documento: DocumentoNoEmissor = {
      id,
      tipo: pedido.tipo,
      estado: "rascunho",
      referencia: pedido.referencia,
      numero: null,
      serie: pedido.serie,
      data: null,
      atcud: null,
      // O NIF que sai é o da entidade do emissor, não o do pedido (lição 2.6).
      nif: entidade?.nif ?? null,
      nome: entidade?.nome ?? pedido.cliente.nome,
      pais: pedido.cliente.pais,
      linhas,
      totais: { base, iva, total: base + iva },
      em_bruto: { ensaio: true, observacoes: pedido.observacoes },
    };
    c.documentos.set(
      id,
      c.aoCriar === undefined ? documento : c.aoCriar(documento),
    );
    if (c.falhas.criarRascunho === "rede") {
      return Promise.reject(
        new ErroDeRede("o emissor de ensaio não respondeu"),
      );
    }
    return Promise.resolve({ id });
  }

  lerDocumento(
    credenciais: CredenciaisEmissor,
    id: string,
  ): Promise<DocumentoNoEmissor> {
    const c = this.daConta(credenciais);
    c.chamadas.push("lerDocumento");
    const d = c.documentos.get(id);
    if (d === undefined) {
      return Promise.reject(new ErroDoEmissor(`o documento ${id} não existe`));
    }
    return Promise.resolve(structuredClone(d));
  }

  fechar(
    credenciais: CredenciaisEmissor,
    id: string,
  ): Promise<DocumentoNoEmissor> {
    const c = this.daConta(credenciais);
    c.chamadas.push("fechar");
    if (c.falhas.fechar === "erro") {
      return Promise.reject(new ErroDoEmissor("o emissor recusou fechar"));
    }
    const d = c.documentos.get(id);
    if (d === undefined || d.estado !== "rascunho") {
      return Promise.reject(
        new ErroDoEmissor(`o documento ${id} não é um rascunho`),
      );
    }
    c.numero += 1;
    let fechado: DocumentoNoEmissor = {
      ...d,
      estado: "fechado",
      numero: `${d.tipo === "nota_credito" ? "NC" : "FT"} ${d.serie ?? "ENS"}/${String(c.numero)}`,
      data: new Date().toISOString().slice(0, 10),
      atcud: `ENSAIO-${String(c.numero)}`,
    };
    if (c.aoFechar !== undefined) fechado = c.aoFechar(fechado);
    c.documentos.set(id, fechado);
    if (c.falhas.fechar === "rede") {
      return Promise.reject(
        new ErroDeRede("o emissor de ensaio não respondeu"),
      );
    }
    return Promise.resolve(structuredClone(fechado));
  }

  apagarRascunho(credenciais: CredenciaisEmissor, id: string): Promise<void> {
    const c = this.daConta(credenciais);
    c.chamadas.push("apagarRascunho");
    const d = c.documentos.get(id);
    if (d === undefined) return Promise.resolve();
    if (d.estado !== "rascunho") {
      return Promise.reject(
        new ErroDoEmissor("um documento fechado não se apaga"),
      );
    }
    c.documentos.delete(id);
    return Promise.resolve();
  }

  procurarPorReferencia(
    credenciais: CredenciaisEmissor,
    referencia: string,
  ): Promise<Procura> {
    const c = this.daConta(credenciais);
    c.chamadas.push("procurarPorReferencia");
    if (c.antesDaProcura !== undefined) {
      const antes = c.antesDaProcura;
      c.antesDaProcura = undefined;
      return antes().then(() =>
        this.procurarPorReferencia(credenciais, referencia),
      );
    }
    if (c.falhas.procurarPorReferencia === "rede") {
      return Promise.reject(
        new ErroDeRede("o emissor de ensaio não respondeu"),
      );
    }
    if (c.falhas.procurarPorReferencia === "nao_sei") {
      return Promise.resolve({ estado: "nao_sei" });
    }
    const d = [...c.documentos.values()].find(
      (x) => x.referencia === referencia,
    );
    return Promise.resolve(
      d === undefined
        ? { estado: "nao_existe" }
        : { estado: "encontrado", documento: structuredClone(d) },
    );
  }

  pdf(credenciais: CredenciaisEmissor, id: string): Promise<Buffer> {
    const c = this.daConta(credenciais);
    c.chamadas.push("pdf");
    if (c.falhas.pdf === "rede") {
      return Promise.reject(
        new ErroDeRede("o emissor de ensaio não respondeu"),
      );
    }
    const d = c.documentos.get(id);
    return Promise.resolve(
      Buffer.from(`%PDF-1.4\n% ensaio ${d?.numero ?? id}\n`, "utf8"),
    );
  }
}
