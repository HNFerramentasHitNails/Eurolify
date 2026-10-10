import type { AdaptadorFaturacao as NomeAdaptador } from "../base/esquema.js";
import type { ChavePagamentos } from "../pagamentos/cifra.js";

// O contrato do adaptador de faturação (docs/28 §7.4; docs/08 §4): o mesmo
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
  /** A nossa referência (`inv_…`), escrita no documento para o reencontrar. */
  referencia: string;
  serie: string | null;
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

/** Um documento como o emissor o tem (rascunho ou fechado). */
export interface DocumentoNoEmissor {
  id: string;
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
 * e reconcilia-se; nunca se repete às cegas (docs/28 §4.2).
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

export interface AdaptadorFaturacao {
  readonly nome: NomeAdaptador;
  /** Lança se as credenciais não forem aceites. */
  testar(credenciais: CredenciaisEmissor): Promise<void>;
  /** Pelo número sem prefixo (eu-vat-oss-ioss, «NIF»); null = não existe. */
  procurarEntidade(
    credenciais: CredenciaisEmissor,
    nifSemPrefixo: string,
  ): Promise<EntidadeNoEmissor | null>;
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
 * Um emissor de ensaio, em memória (docs/28 Q5): comporta-se como um software
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
      numero: `FT ${d.serie ?? "ENS"}/${String(c.numero)}`,
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
