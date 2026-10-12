import type { ConfigDaLigacao } from "../base/esquema.js";
import {
  ErroDeRede,
  ErroDoEmissor,
  type AdaptadorFaturacao,
  type CredenciaisEmissor,
  type DocumentoNoEmissor,
  type EntidadeNoEmissor,
  type LinhaNoEmissor,
  type LinhaPedida,
  type PedidoRascunho,
  type Procura,
} from "./adaptador.js";

// O adaptador do Moloni (docs/29 §13; docs/06, DZ). Traduz o contrato da
// §7.4 para a API do Moloni, como a documentação oficial a descreve (lida a
// 12/10/2026, `docs/eurolify/fontes-api-moloni-11out2026.md` §9) e como os
// testes de 11/10/2026 a mediram (§8 do mesmo ficheiro). **Não decide nada
// fiscal**: a taxa, a isenção e os montantes vêm decididos no pedido.
//
// O que ainda não foi medido na conta trial (docs/29 §13.7) está marcado
// «por medir»: se a leitura estiver errada, o documento fica divergente ou o
// rascunho fica retido — nunca sai com outra coisa.

const BASE = "https://api.moloni.pt/v1";

/** O NIF que o Moloni usa para o consumidor final (lição 1.10 do docs/04, **M**). */
const NIF_CONSUMIDOR_FINAL = "999999990";

/** Renova se o token de acesso acaba dentro deste prazo (§13.4). */
const MARGEM_ACESSO_MS = 5 * 60_000;
/** E o de renovação (14 dias no Moloni) renova-se ao fim de 7. */
const IDADE_MAX_RENOVACAO_MS = 7 * 24 * 3_600_000;

export interface ConfigMoloni {
  /** O Developer ID da conta de Developer do Eurolify (M1). */
  clientId: string;
  clientSecret: string;
  /**
   * As empresas do Moloni onde o Eurolify pode emitir (M8): só contas de
   * teste, numa lista fechada (MOLONI_EMPRESAS_TESTE). Outra empresa é
   * recusada em todas as operações — fechar uma fatura numa empresa real
   * comunica-a à AT (revisão do #384, P1-2).
   */
  empresasPermitidas: readonly string[];
  base?: string;
  fetch?: typeof fetch;
  tempoLimiteMs?: number;
  /** O Eurolify limita-se a si próprio por empresa (§13.5; proposta 60). */
  porMinuto?: number;
  agora?: () => number;
}

type Json = Record<string, unknown>;

/** O que nunca pode aparecer num registo nem num erro (§13.4). */
const SEGREDOS =
  /(access_token|refresh_token|client_secret|code|password)=[^&\s]*/gi;

const SEGREDOS_JSON =
  /"(access_token|refresh_token|client_secret|code|password)"\s*:\s*"[^"]*"/gi;

export function taparSegredos(texto: string): string {
  return texto.replace(SEGREDOS, "$1=***").replace(SEGREDOS_JSON, '"$1":"***"');
}

/**
 * O corpo de formulário do Moloni («formato Query String», a forma que a API
 * aceita por omissão): listas e objectos como `products[0][taxes][0][tax_id]`.
 */
export function paraFormulario(dados: Json): string {
  const partes: string[] = [];
  const juntar = (chave: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        juntar(`${chave}[${String(i)}]`, x);
      });
    } else if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Json)) {
        juntar(`${chave}[${k}]`, x);
      }
    } else {
      partes.push(
        `${encodeURIComponent(chave)}=${encodeURIComponent(typeof v === "string" ? v : JSON.stringify(v))}`,
      );
    }
  };
  for (const [k, v] of Object.entries(dados)) juntar(k, v);
  return partes.join("&");
}

/** Um texto ou número do Moloni como texto; outra coisa fica vazia. */
function txt(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/** Cêntimos a partir de um valor do Moloni (float em euros). */
const cent = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** Um erro de dados do Moloni: «código campo», ou com `human_errors`. */
function errosDe(r: unknown): string[] | null {
  if (!Array.isArray(r) || r.length === 0) return null;
  const textos = r.map((e) => {
    if (typeof e === "string") return e;
    if (e !== null && typeof e === "object" && "code" in e) {
      const o = e as { code: unknown; description?: unknown };
      return `${String(o.code)}${typeof o.description === "string" ? ` (${o.description})` : ""}`;
    }
    return null;
  });
  const sem = textos.filter((t): t is string => t !== null);
  return sem.length === textos.length ? sem : null;
}

export class AdaptadorMoloni implements AdaptadorFaturacao {
  readonly nome = "moloni" as const;
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly tempoLimiteMs: number;
  private readonly porMinuto: number;
  private readonly agora: () => number;
  /** Os pedidos do último minuto, por empresa (o limite próprio). */
  private readonly pedidos = new Map<string, number[]>();

  constructor(private readonly cfg: ConfigMoloni) {
    this.base = cfg.base ?? BASE;
    this.fetch = cfg.fetch ?? fetch;
    this.tempoLimiteMs = cfg.tempoLimiteMs ?? 15_000;
    this.porMinuto = cfg.porMinuto ?? 60;
    this.agora = cfg.agora ?? Date.now;
  }

  // ------------------------------------------------------------ Tokens

  async renovar(
    credenciais: CredenciaisEmissor,
    motivo: "usar" | "manter",
  ): Promise<CredenciaisEmissor | null> {
    const agora = this.agora();
    const expira = Date.parse(credenciais["access_expira"] ?? "");
    const renovadoEm = Date.parse(credenciais["refresh_em"] ?? "");
    const parNovo =
      Number.isFinite(renovadoEm) &&
      agora - renovadoEm < IDADE_MAX_RENOVACAO_MS;
    const acessoServe =
      credenciais["access_token"] !== undefined &&
      Number.isFinite(expira) &&
      expira - agora > MARGEM_ACESSO_MS;
    // A tarefa só renova pela idade do par (§13.4): cada renovação gasta o
    // par anterior, e menos renovações são menos ocasiões de o perder
    // (revisão do #384, P2-1).
    if (parNovo && (motivo === "manter" || acessoServe)) return null;
    const refresh = credenciais["refresh_token"];
    if (refresh === undefined || refresh === "") {
      throw new ErroDoEmissor(
        "a ligação ao Moloni não tem autorização (falta o refresh_token): o dono tem de ligar outra vez",
      );
    }
    const url =
      `${this.base}/grant/?grant_type=refresh_token` +
      `&client_id=${encodeURIComponent(this.cfg.clientId)}` +
      `&client_secret=${encodeURIComponent(this.cfg.clientSecret)}` +
      `&refresh_token=${encodeURIComponent(refresh)}`;
    let r: unknown;
    try {
      r = await this.chamar(url, { method: "GET" });
    } catch (e) {
      // Só a autorização morta (`invalid_grant`) é da ligação; um segredo
      // do servidor errado (`invalid_client`) ou outro erro não pode marcar
      // as ligações de todos os comerciantes (revisão do #384, P2-2).
      if (e instanceof ErroDoEmissor && !/invalid_grant/.test(e.message)) {
        throw new ErroDeRede(e.message);
      }
      throw e;
    }
    const t = r as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    if (
      typeof t.access_token !== "string" ||
      typeof t.refresh_token !== "string"
    ) {
      // A renovação pode ter acontecido e a resposta não se lê: não se sabe
      // qual par vale (§13.4).
      throw new ErroDeRede("o Moloni respondeu à renovação sem os tokens");
    }
    const validade =
      typeof t.expires_in === "number" && t.expires_in > 0
        ? t.expires_in
        : 3600;
    return {
      ...credenciais,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      access_expira: new Date(agora + validade * 1000).toISOString(),
      refresh_em: new Date(agora).toISOString(),
    };
  }

  // ------------------------------------------------------------ HTTP

  /** Espera se esta empresa já fez `porMinuto` pedidos no último minuto. */
  private async limitar(empresa: string) {
    for (;;) {
      const agora = this.agora();
      const lista = (this.pedidos.get(empresa) ?? []).filter(
        (t) => agora - t < 60_000,
      );
      if (lista.length < this.porMinuto) {
        lista.push(agora);
        this.pedidos.set(empresa, lista);
        return;
      }
      const espera = 60_000 - (agora - (lista[0] ?? agora)) + 5;
      await new Promise((ok) => setTimeout(ok, espera));
    }
  }

  /**
   * Um pedido HTTP. Rede, tempo esgotado ou uma resposta que não é JSON →
   * `ErroDeRede` (pode ter ficado feito); um erro de autenticação ou de
   * dados → `ErroDoEmissor`. O endereço (com o token) nunca entra no erro.
   */
  private async chamar(url: string, init: RequestInit): Promise<unknown> {
    let resposta: Response;
    try {
      resposta = await this.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.tempoLimiteMs),
      });
    } catch (e) {
      const tempo = e instanceof Error && e.name === "TimeoutError";
      throw new ErroDeRede(
        tempo
          ? "o Moloni não respondeu a tempo"
          : "não foi possível falar com o Moloni",
      );
    }
    let corpo: unknown;
    try {
      corpo = await resposta.json();
    } catch {
      throw new ErroDeRede(
        `o Moloni respondeu sem JSON (HTTP ${String(resposta.status)})`,
      );
    }
    if (resposta.status === 400 || resposta.status === 401) {
      const e = corpo as { error?: unknown; error_description?: unknown };
      throw new ErroDoEmissor(
        taparSegredos(
          `o Moloni recusou a autorização: ${typeof e.error === "string" ? e.error : String(resposta.status)}${typeof e.error_description === "string" ? ` (${e.error_description})` : ""}`,
        ),
      );
    }
    if (!resposta.ok) {
      throw new ErroDeRede(
        `o Moloni respondeu HTTP ${String(resposta.status)}`,
      );
    }
    return corpo;
  }

  /** Um método da API, com o token no endereço (o único sítio que o Moloni aceita). */
  private async api(
    cred: CredenciaisEmissor,
    metodo: string,
    dados: Json = {},
  ): Promise<unknown> {
    const token = cred["access_token"];
    const expira = Date.parse(cred["access_expira"] ?? "");
    if (token === undefined || token === "") {
      throw new ErroDoEmissor("a ligação ao Moloni não tem token de acesso");
    }
    // Nunca se renova aqui: o par novo tem de se gravar antes (§13.4).
    if (Number.isFinite(expira) && expira <= this.agora()) {
      throw new ErroDoEmissor("o token de acesso do Moloni expirou");
    }
    const empresa = this.empresa(cred);
    await this.limitar(empresa);
    const corpo = metodo.startsWith("companies/")
      ? dados
      : { company_id: empresa, ...dados };
    const r = await this.chamar(
      `${this.base}/${metodo}/?human_errors=true&access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: paraFormulario(corpo),
      },
    );
    return r;
  }

  private empresa(cred: CredenciaisEmissor): string {
    const e = cred["company_id"];
    if (e === undefined || !/^\d{1,12}$/.test(e)) {
      throw new ErroDoEmissor(
        "a ligação ao Moloni não diz a empresa (company_id)",
      );
    }
    if (!this.cfg.empresasPermitidas.includes(e)) {
      throw new ErroDoEmissor(
        `a empresa ${e} do Moloni não está na lista das contas de teste (M8): o modo real está fechado`,
      );
    }
    return e;
  }

  /** Uma escrita: `{valid: 1, …}` ou a lista de erros de dados. */
  private async escrever(
    cred: CredenciaisEmissor,
    metodo: string,
    dados: Json,
  ): Promise<Json> {
    const r = await this.api(cred, metodo, dados);
    const erros = errosDe(r);
    if (erros !== null) {
      throw new ErroDoEmissor(
        `o Moloni recusou ${metodo}: ${erros.join("; ").slice(0, 300)}`,
      );
    }
    if (r === null || typeof r !== "object" || (r as Json)["valid"] !== 1) {
      throw new ErroDoEmissor(`o Moloni não aceitou ${metodo}`);
    }
    return r as Json;
  }

  /** Uma leitura de lista (um erro de dados vem também como lista). */
  private async lista(
    cred: CredenciaisEmissor,
    metodo: string,
    dados: Json,
  ): Promise<Json[]> {
    const r = await this.api(cred, metodo, dados);
    const erros = errosDe(r);
    if (erros !== null) {
      throw new ErroDoEmissor(
        `o Moloni recusou ${metodo}: ${erros.join("; ").slice(0, 300)}`,
      );
    }
    if (Array.isArray(r)) return r as Json[];
    // O getByReference descreve-se na página como um objecto: aceita os dois.
    if (r !== null && typeof r === "object" && Object.keys(r).length > 0) {
      return [r as Json];
    }
    return [];
  }

  // ------------------------------------------------------- O contrato

  async testar(credenciais: CredenciaisEmissor): Promise<void> {
    const empresas = await this.lista(credenciais, "companies/getAll", {});
    const empresa = this.empresa(credenciais);
    if (!empresas.some((e) => String(e["company_id"]) === empresa)) {
      throw new ErroDoEmissor(
        "esta autorização não dá acesso à empresa indicada no Moloni",
      );
    }
  }

  async procurarEntidade(
    credenciais: CredenciaisEmissor,
    nifSemPrefixo: string,
  ): Promise<EntidadeNoEmissor | null> {
    // A procura pode devolver parecidos: contam só os do mesmo número, com
    // ou sem o prefixo do país.
    const clientes = (
      await this.lista(credenciais, "customers/getByVat", {
        vat: nifSemPrefixo,
      })
    ).filter(
      (c) =>
        typeof c["vat"] === "string" &&
        c["vat"].replace(/\s/g, "").replace(/^[A-Z]{2}/, "") === nifSemPrefixo,
    );
    if (clientes.length === 0) return null;
    // Mais de um com o mesmo número: não se escolhe (§13.3; AGENTS.md,
    // «Não se erra…», regra 6) — sem NIF, o pedido fica retido.
    if (clientes.length > 1) return { id: "", nif: null, nome: null };
    const c = clientes[0] as Json;
    return {
      id: String(c["customer_id"]),
      nif: typeof c["vat"] === "string" ? c["vat"] : null,
      nome: typeof c["name"] === "string" ? c["name"] : null,
    };
  }

  async criarRascunho(
    credenciais: CredenciaisEmissor,
    pedido: PedidoRascunho,
  ): Promise<{ id: string }> {
    // A NC fica fora desta parte (M7): o pedido devia ter ficado retido.
    if (pedido.tipo !== "fatura") {
      throw new ErroDoEmissor(
        "as notas de crédito pelo Moloni ainda não existem (docs/29 §13.6, M7)",
      );
    }
    if (pedido.moeda !== "EUR") {
      throw new ErroDoEmissor("o Moloni só emite em euros nesta parte (M6)");
    }
    const serie = pedido.serie;
    if (serie === null || !/^\d{1,12}$/.test(serie)) {
      throw new ErroDoEmissor(
        "a ligação ao Moloni não tem a série (document_set_id)",
      );
    }
    const cliente = await this.cliente(credenciais, pedido);
    const produtos: Json[] = [];
    for (const [i, l] of pedido.linhas.entries()) {
      produtos.push({
        product_id: await this.artigo(credenciais, pedido.config, l),
        name: l.descricao,
        qty: l.quantidade,
        // Preço unitário sem IVA (A8); as casas que o Moloni guarda estão
        // por medir (M4): uma diferença de cêntimos é divergência (R8).
        price: precoUnitario(l),
        discount: 0,
        order: i,
        exemption_reason: l.isencao_emissor ?? "",
        taxes:
          l.taxa_emissor === null
            ? []
            : [{ tax_id: l.taxa_emissor, order: 0, cumulative: 0 }],
      });
    }
    const hoje = this.hoje();
    const r = await this.escrever(credenciais, "invoices/insert", {
      date: hoje,
      expiration_date: hoje,
      document_set_id: serie,
      customer_id: cliente,
      our_reference: pedido.referencia,
      notes: pedido.observacoes,
      products: produtos,
      status: 0,
    });
    const id = r["document_id"];
    if (typeof id !== "number" && typeof id !== "string") {
      // Aceite sem dizer o id: pode ter ficado criado; reconcilia-se.
      throw new ErroDeRede("o Moloni aceitou o rascunho sem dizer o id");
    }
    return { id: String(id) };
  }

  async lerDocumento(
    credenciais: CredenciaisEmissor,
    id: string,
  ): Promise<DocumentoNoEmissor> {
    const d = await this.api(credenciais, "documents/getOne", {
      document_id: id,
    });
    const erros = errosDe(d);
    if (erros !== null) {
      throw new ErroDoEmissor(
        `o Moloni recusou documents/getOne: ${erros.join("; ").slice(0, 300)}`,
      );
    }
    if (
      d === null ||
      typeof d !== "object" ||
      Array.isArray(d) ||
      (d as Json)["document_id"] === undefined
    ) {
      throw new ErroDoEmissor(`o documento ${id} não existe no Moloni`);
    }
    return this.paraDocumento(d as Json);
  }

  async fechar(
    credenciais: CredenciaisEmissor,
    id: string,
  ): Promise<DocumentoNoEmissor> {
    // Fechar é um `invoices/update` com o documento inteiro (A3): reenvia-se
    // o rascunho como o Moloni o tem, que já foi conferido (R6).
    const d = (await this.api(credenciais, "invoices/getOne", {
      document_id: id,
    })) as Json | null;
    if (d === null || typeof d !== "object" || d["status"] !== 0) {
      throw new ErroDoEmissor(`o documento ${id} não é um rascunho no Moloni`);
    }
    const produtos = ((d["products"] as Json[] | undefined) ?? []).map((p) => ({
      product_id: p["product_id"],
      name: p["name"],
      summary: p["summary"] ?? "",
      qty: p["qty"],
      price: p["price"],
      discount: p["discount"] ?? 0,
      order: p["order"] ?? 0,
      exemption_reason: p["exemption_reason"] ?? "",
      taxes: ((p["taxes"] as Json[] | undefined) ?? []).map((t) => ({
        tax_id: t["tax_id"],
        order: t["order"] ?? 0,
        cumulative: t["cumulative"] ?? 0,
      })),
    }));
    // Um fecho sem resposta pode ter fechado: o ErroDeRede sobe e o pedido
    // reconcilia-se pela referência (§4.2).
    await this.escrever(credenciais, "invoices/update", {
      document_id: id,
      // A data do fecho é a de hoje, não a do rascunho, que pode ter dias
      // (revisão do #384, P2-6; a regra da data é do contabilista, **C**).
      date: this.hoje(),
      expiration_date: this.hoje(),
      document_set_id: d["document_set_id"],
      customer_id: d["customer_id"],
      our_reference: d["our_reference"] ?? "",
      notes: d["notes"] ?? "",
      products: produtos,
      status: 1,
    });
    return this.lerDocumento(credenciais, id);
  }

  async apagarRascunho(
    credenciais: CredenciaisEmissor,
    id: string,
  ): Promise<void> {
    await this.escrever(credenciais, "invoices/delete", { document_id: id });
  }

  async procurarPorReferencia(
    credenciais: CredenciaisEmissor,
    referencia: string,
  ): Promise<Procura> {
    // «Não existe» só com a lista do Moloni vazia. Se veio alguma coisa,
    // cada candidato confere-se no documento inteiro: que as linhas do
    // getAll tragam a referência, ou que o filtro funcione, está por medir
    // (§13.7, 3), e um «não existe» errado reemitia a fatura (revisão do
    // #384, P1-1).
    const candidatos = await this.lista(credenciais, "documents/getAll", {
      our_reference: referencia,
    });
    if (candidatos.length === 0) return { estado: "nao_existe" };
    if (candidatos.length > 5) return { estado: "nao_sei" };
    const nossos: DocumentoNoEmissor[] = [];
    for (const c of candidatos) {
      const d = await this.lerDocumento(credenciais, txt(c["document_id"]));
      if (d.referencia === referencia) nossos.push(d);
    }
    const [documento] = nossos;
    if (nossos.length !== 1 || documento === undefined) {
      return { estado: "nao_sei" };
    }
    return { estado: "encontrado", documento };
  }

  async pdf(credenciais: CredenciaisEmissor, id: string): Promise<Buffer> {
    const r = (await this.api(credenciais, "documents/getPDFLink", {
      document_id: id,
      signed: 1,
    })) as Json;
    const url = r["url"];
    let anfitriao = "";
    try {
      const u = new URL(typeof url === "string" ? url : "");
      if (u.protocol === "https:") anfitriao = u.hostname;
    } catch {
      anfitriao = "";
    }
    // Só se descarrega do Moloni (revisão do #384, P3).
    if (
      typeof url !== "string" ||
      (anfitriao !== "moloni.pt" && !anfitriao.endsWith(".moloni.pt"))
    ) {
      throw new ErroDoEmissor("o Moloni não deu a ligação do PDF");
    }
    let resposta: Response;
    try {
      resposta = await this.fetch(url, {
        signal: AbortSignal.timeout(this.tempoLimiteMs),
      });
    } catch {
      throw new ErroDeRede("não foi possível descarregar o PDF do Moloni");
    }
    if (!resposta.ok) {
      throw new ErroDeRede(
        `o PDF do Moloni respondeu HTTP ${String(resposta.status)}`,
      );
    }
    const pdf = Buffer.from(await resposta.arrayBuffer());
    // Uma página de erro com HTTP 200 não é prova (revisão do #384, P3).
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new ErroDoEmissor("o Moloni devolveu um ficheiro que não é PDF");
    }
    return pdf;
  }

  // ------------------------------------------------------ Por dentro

  /** A data do documento no fuso de Portugal (a entidade da parte 2). */
  private hoje(): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(this.agora()));
  }

  /** O cliente do documento (M3). */
  private async cliente(
    cred: CredenciaisEmissor,
    pedido: PedidoRascunho,
  ): Promise<string> {
    if (pedido.entidade_id !== null && pedido.entidade_id !== "") {
      return pedido.entidade_id;
    }
    const nif = pedido.cliente.nif;
    if (nif === null) {
      // O cliente da ligação tem de ser mesmo o consumidor final: um id que
      // aponte para outra pessoa punha a fatura em nome dela (M3; revisão do
      // #384, P2-4).
      const cf = configTexto(pedido.config, "cliente_consumidor_final");
      const c = (await this.api(cred, "customers/getOne", {
        customer_id: cf,
      })) as Json | null;
      if (txt(c?.["vat"]) !== NIF_CONSUMIDOR_FINAL) {
        throw new ErroDoEmissor(
          "o cliente «Consumidor final» da ligação não tem o NIF de consumidor final no Moloni",
        );
      }
      return cf;
    }
    // Procurado pelo número sem resultado: procura-se também como sai no
    // documento (com o prefixo, fora de Portugal), para não criar dois.
    const existentes = await this.lista(cred, "customers/getByVat", {
      vat: nif,
    });
    const iguais = existentes.filter((c) => c["vat"] === nif);
    if (iguais.length > 1) {
      throw new ErroDoEmissor(
        "há mais de um cliente no Moloni com este NIF: uma pessoa escolhe",
      );
    }
    if (iguais.length === 1) return String((iguais[0] as Json)["customer_id"]);
    const morada = pedido.cliente.morada;
    // O país da morada fiscal, não o do NIF (revisão do #384, P2-5).
    const pais = morada["pais"] ?? null;
    const rua = [morada["linha1"], morada["linha2"]]
      .filter((x) => x !== null && x !== undefined && x !== "")
      .join(", ");
    const cidade = morada["localidade"] ?? "";
    // O Moloni pede morada, localidade e país para criar o cliente: nada se
    // inventa; sem eles, o passo falha e chega a uma pessoa.
    if (pais === null || rua === "" || cidade === "") {
      throw new ErroDoEmissor(
        "o perfil não tem a morada fiscal completa para criar o cliente no Moloni",
      );
    }
    const r = await this.escrever(cred, "customers/insert", {
      vat: nif,
      // O número do cliente no Moloni (máx. 20): o NIF, que já é único aqui.
      number: nif.slice(0, 20),
      name: pedido.cliente.nome,
      language_id: configTexto(pedido.config, "lingua"),
      address: rua,
      zip_code: morada["codigo_postal"] ?? "",
      city: cidade,
      country_id: await this.paisId(cred, pais),
      maturity_date_id: configTexto(pedido.config, "vencimento"),
      payment_method_id: this.metodo(pedido),
    });
    return String(r["customer_id"]);
  }

  private metodo(pedido: PedidoRascunho): string {
    const m = pedido.config.metodos_pagamento?.[pedido.meio_pagamento];
    if (m === undefined) {
      throw new ErroDoEmissor(
        `a ligação ao Moloni não diz o método de pagamento de «${pedido.meio_pagamento}»`,
      );
    }
    return m;
  }

  /** Os países do Moloni (por código ISO), lidos uma vez. */
  private paises: Map<string, string> | null = null;

  private async paisId(cred: CredenciaisEmissor, iso: string) {
    if (this.paises === null) {
      const lista = await this.lista(cred, "countries/getAll", {});
      this.paises = new Map(
        lista.map((p) => [
          String(p["iso_3166_1"]).toUpperCase(),
          String(p["country_id"]),
        ]),
      );
    }
    const id = this.paises.get(iso.toUpperCase());
    if (id === undefined) {
      throw new ErroDoEmissor(`o Moloni não tem o país ${iso}`);
    }
    return id;
  }

  /** O artigo de uma linha (M2): pela referência exacta = SKU, nunca pelo nome. */
  private async artigo(
    cred: CredenciaisEmissor,
    config: ConfigDaLigacao,
    l: LinhaPedida,
  ): Promise<string> {
    if (l.sku === null) return configTexto(config, "artigo_portes");
    const iguais = (
      await this.lista(cred, "products/getByReference", {
        reference: l.sku,
        exact: 1,
      })
    ).filter((p) => p["reference"] === l.sku);
    if (iguais.length > 1) {
      throw new ErroDoEmissor(
        `há mais de um artigo no Moloni com a referência ${l.sku}: uma pessoa escolhe`,
      );
    }
    if (iguais.length === 1) return String((iguais[0] as Json)["product_id"]);
    // Não existe: o Eurolify cria-o sem gestão de stock (o livro é do
    // Eurolify, docs/27 R9), com a taxa ou a isenção desta linha.
    const r = await this.escrever(cred, "products/insert", {
      category_id: configTexto(config, "categoria"),
      type: 1,
      name: l.descricao,
      reference: l.sku,
      price: precoUnitario(l),
      unit_id: configTexto(config, "unidade"),
      has_stock: 0,
      stock: 0,
      exemption_reason: l.isencao_emissor ?? "",
      taxes:
        l.taxa_emissor === null
          ? []
          : [{ tax_id: l.taxa_emissor, value: 0, order: 0, cumulative: 0 }],
    });
    return String(r["product_id"]);
  }

  /** O documento do Moloni no formato do contrato (o mapa de volta, §13.3). */
  private paraDocumento(d: Json): DocumentoNoEmissor {
    const saft = txt((d["document_type"] as Json | undefined)?.["saft_code"]);
    const tipo =
      saft === "FT" || saft === "FR"
        ? "fatura"
        : saft === "NC"
          ? "nota_credito"
          : null;
    if (tipo === null) {
      throw new ErroDoEmissor(
        `o Moloni devolveu um documento de outro tipo (${saft || "sem tipo"})`,
      );
    }
    // 0 rascunho, 1 fechado; o 2 está por perceber (§8 das fontes): nunca se
    // trata como fechado.
    const status = d["status"];
    if (status !== 0 && status !== 1) {
      throw new ErroDoEmissor(
        `o documento está num estado do Moloni que não se conhece (${String(status)})`,
      );
    }
    // O NIF como o Moloni o tem. Vazio ou não-texto não é consumidor final:
    // é desconhecido, e diverge de qualquer pedido (revisão do #384, P2-4).
    const vat = txt(d["entity_vat"]).replace(/\s/g, "").toUpperCase();
    const consumidorFinal = vat === NIF_CONSUMIDOR_FINAL;
    const numero = Number(d["number"] ?? 0);
    const serie = d["document_set"] as Json | undefined;
    const linhas: LinhaNoEmissor[] = (
      (d["products"] as Json[] | undefined) ?? []
    )
      .slice()
      .sort((a, b) => Number(a["order"] ?? 0) - Number(b["order"] ?? 0))
      .map((p) => {
        const taxas = (p["taxes"] as Json[] | undefined) ?? [];
        // O IVA da linha: as taxas do tipo IVA (saft_type 1, «IVA» na página
        // de Products · insert); sem o tipo, todas.
        const iva = taxas.filter(
          (t) => t["saft_type"] === undefined || Number(t["saft_type"]) === 1,
        );
        const qty = Number(p["qty"] ?? 0);
        const desconto = Number(p["discount"] ?? 0);
        const motivo =
          typeof p["exemption_reason"] === "string" &&
          p["exemption_reason"] !== ""
            ? p["exemption_reason"]
            : null;
        return {
          descricao: txt(p["name"]),
          quantidade: qty,
          base: Math.round(
            Number(p["price"] ?? 0) * qty * (1 - desconto / 100) * 100,
          ),
          taxa: Math.round(
            iva.reduce((s, t) => s + Number(t["value"] ?? 0), 0) * 100,
          ),
          codigo_motivo: motivo,
          iva: iva.reduce((s, t) => s + cent(t["total_value"]), 0),
        };
      });
    // Os totais do cabeçalho como vêm (lição 2.9). Que campo é a base e qual
    // o total está por medir (§13.7, 1): se a leitura estiver errada, o
    // documento fica divergente, nunca certo à força.
    const base =
      cent(d["gross_value"]) -
      cent(d["comercial_discount_value"]) -
      cent(d["financial_discount_value"]);
    return {
      id: String(d["document_id"]),
      tipo,
      estado: status === 1 ? "fechado" : "rascunho",
      referencia:
        typeof d["our_reference"] === "string" && d["our_reference"] !== ""
          ? d["our_reference"]
          : null,
      numero:
        status === 1 && numero > 0
          ? `${saft} ${String(serie?.["name"] ?? d["document_set_id"])}/${String(numero)}`
          : null,
      serie:
        d["document_set_id"] === undefined ? null : txt(d["document_set_id"]),
      data:
        typeof d["date"] === "string" && d["date"] !== ""
          ? d["date"].slice(0, 10)
          : null,
      // O ATCUD não está na lista de campos da página (A6): só se vier.
      atcud: typeof d["atcud"] === "string" ? d["atcud"] : null,
      nif: consumidorFinal ? null : vat === "" ? "(sem NIF no Moloni)" : vat,
      nome: typeof d["entity_name"] === "string" ? d["entity_name"] : null,
      pais: consumidorFinal ? null : paisDoNif(vat),
      linhas,
      totais: {
        base,
        iva: cent(d["taxes_value"]),
        total: cent(d["net_value"]),
      },
      em_bruto: d,
    };
  }
}

/**
 * O preço unitário sem IVA, em euros, com 6 casas (A8, M4): sem a dízima
 * infinita do JavaScript. As casas que o Moloni guarda estão por medir
 * (§13.7, 4); uma diferença de cêntimos é divergência (R8).
 */
function precoUnitario(l: LinhaPedida): number {
  return Number((l.base / 100 / l.quantidade).toFixed(6));
}

/**
 * O país do contribuinte pelo NIF como saiu (revisão do #384, P2-5): com o
 * prefixo fiscal fora de Portugal (o «EL» é a Grécia), sem prefixo o da
 * entidade, que nesta parte é Portugal (o Moloni é um software português).
 */
function paisDoNif(vat: string): string | null {
  if (vat === "") return null;
  const prefixo = /^([A-Z]{2})/.exec(vat)?.[1];
  if (prefixo === undefined) return "PT";
  return prefixo === "EL" ? "GR" : prefixo;
}

/** Um id obrigatório da configuração da ligação (§13.2). */
function configTexto(config: ConfigDaLigacao, chave: string): string {
  const v = config[chave];
  if (typeof v !== "string" || v === "") {
    throw new ErroDoEmissor(
      `a configuração da ligação ao Moloni não tem «${chave}»`,
    );
  }
  return v;
}
