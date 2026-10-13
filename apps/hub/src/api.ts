// O cliente da API do Hub (docs/21 §11 e §12; docs/22 §3). Só fala com o
// próprio anfitrião (`/hub/*`), com o cookie da sessão (que o Hub não lê) e
// sempre em JSON; os erros chegam no formato RFC 9457 com um `codigo`.

import type {
  DocumentoAClassificar,
  Faturacao,
  RelatorioOss,
} from "./faturacao";
import type { OpcaoArtigo } from "./opcoes";
import type { CorpoPreco, PrecoLido } from "./preco";
import type { CasoTarefa, FilaTarefa, PaginaTarefas } from "./tarefas";
import type { AlteracaoVariante, VarianteACriar } from "./variante";

export type Papel = "dono" | "gestor" | "armazem" | "apoio";
export const PAPEIS: readonly Papel[] = ["dono", "gestor", "armazem", "apoio"];

export interface Eu {
  pessoa: string;
  nome: string;
  email: string;
  /**
   * A palavra-passe com o TOTP (docs/22 §9.2). Sem o campo, a API não tem a
   * palavra-passe ligada e o Hub não a oferece.
   */
  palavra_passe?: "activa" | "pendente" | null;
  comerciantes: {
    comerciante: string;
    nome: string;
    papel: Papel;
    membro: string;
    /**
     * Os âmbitos do papel neste comerciante, lidos da base: o que o ecrã
     * oferece (docs/22 §13.2); o servidor confere na mesma. Texto, e não
     * `Ambito`: a API pode ter âmbitos que este ecrã não oferece nas chaves
     * (ex.: `catalog:history`, #208).
     */
    ambitos: string[];
  }[];
}

export interface Membros {
  membros: {
    membro: string;
    pessoa: string;
    nome: string;
    email: string;
    papel: Papel;
    desde: string;
  }[];
  /** Só o dono os vê; para os outros, null (decide o servidor). */
  convites:
    | {
        convite: string;
        email: string;
        papel: Papel;
        criado_em: string;
        expira_em: string;
      }[]
    | null;
}

export interface Passkey {
  passkey: string;
  nome: string;
  criada_em: string;
  ultimo_uso_em: string | null;
}

export interface Sessao {
  sessao: string;
  criada_em: string;
  ultimo_uso_em: string;
  /** A sessão deste navegador. */
  esta: boolean;
}

/** Os âmbitos de uma chave de servidor que o Hub oferece (docs/22 §9.3). */
export const AMBITOS_SERVIDOR = [
  "catalog:read",
  "catalog:write",
  "catalog:publish",
  "catalog:import",
  "merchant:read",
  "merchant:write",
  "keys:write",
] as const;
/**
 * Os âmbitos que o ecrã sabe dizer: os que oferece ao criar, a loja e os que
 * a API dá a chaves criadas por outra via (docs/22 §26.3). Um âmbito fora
 * desta lista mostra-se com o nome técnico.
 */
export type Ambito =
  | (typeof AMBITOS_SERVIDOR)[number]
  | "storefront"
  | "catalog:history"
  | "prices:read"
  | "prices:write"
  | "prices:history";

export interface ChaveApi {
  id: string;
  tipo: "servidor" | "publica";
  loja: string | null;
  nome: string;
  ambitos: Ambito[];
  prefixo: string;
  /** pessoa:per_…, chave:key_… ou operador:… */
  criada_por: string;
  criada_em: string;
  expira_em: string | null;
  revogada_em: string | null;
  revogada_por: string | null;
  ultimo_uso_em: string | null;
  /** Uma chave de um agente de IA (0057): não muda depois de criada. */
  agente_ia: boolean;
}

/** A morada de onde saem as encomendas de uma conta (docs/36 §3.1). */
export interface RemetenteConta {
  nome: string;
  linha1: string;
  linha2?: string;
  codigo_postal: string;
  localidade: string;
  pais: string;
  /** Só pela chave, por agora: o Hub guarda-os como vieram. */
  telefone?: string;
  email?: string;
}

/** Uma conta de transportadora, sem as credenciais (docs/22 §29.2). */
export interface ContaTransportadora {
  id: string;
  transportadora: "ctt" | "sendcloud";
  nome: string;
  modo: "teste";
  remetente: RemetenteConta;
  estado: "rascunho" | "pronta" | "arquivada";
  credenciais_em: string | null;
  /** pessoa:per_…, chave:key_… ou operador:… */
  credenciais_por: string | null;
  testada_em: string | null;
  servicos_em: string | null;
  /** Os campos que a transportadora pede; vazio se ainda não está ligada. */
  campos_credenciais: { campo: string; segredo: boolean }[];
  criado_em: string;
  versao: number;
}

/** Um mercado, só para escolher o de um método (docs/22 §31.2). */
export interface MercadoHub {
  id: string;
  loja: string;
  nome: string;
  paises: string[];
  moeda: string;
  linguas: string[];
  lingua_principal: string;
  preco_inclui_iva: boolean;
  estado: string;
  versao: number;
}

/** Um método de entrega (docs/25 §3.6; docs/36 §3.2). Montantes em cêntimos. */
export interface MetodoEntrega {
  id: string;
  mercado: string;
  nome: Record<string, string>;
  prazo: Record<string, string>;
  tarifa: number;
  gratis_a_partir_de: number | null;
  pede_telefone: boolean;
  /** null: «Manual», sem etiquetas pelo Eurolify. */
  conta: string | null;
  servico: string | null;
  prazo_max_dias: number;
  codigos_postais: string[];
  aceita_onu: string[];
  peso_max_g: number | null;
  estado: "activo" | "arquivado";
  versao: number;
}

/** Os campos de um método que o Hub escreve (os ONU não, §31.1). */
export interface CamposMetodoEntrega {
  nome: Record<string, string>;
  prazo: Record<string, string>;
  tarifa: number;
  gratis_a_partir_de: number | null;
  pede_telefone: boolean;
  conta: string | null;
  servico: string | null;
  prazo_max_dias: number;
  codigos_postais: string[];
  peso_max_g: number | null;
}

/** Um armazém, com o peso da embalagem (docs/36 Q6). */
export interface ArmazemHub {
  id: string;
  loja: string;
  nome: string;
  estado: string;
  embalagem_g: number;
  versao: number;
}

/** Um serviço de uma conta (docs/36 §8). */
export interface ServicoConta {
  codigo: string;
  nome: Record<string, string>;
  paises: string[];
  peso_max_g: number | null;
  pede_telefone: boolean;
  pede_email: boolean;
}

/** Um artigo na lista do catálogo (docs/22 §11; o resumo do GET /products). */
export interface ResumoArtigo {
  id: string;
  tipo: "fisico" | "servico" | "digital" | "bilhete" | "cartao_oferta";
  estado: EstadoArtigo;
  nome: string;
  marca: string | null;
  origem: "eurolify" | "externo";
  actualizado_em: string;
}

export const ESTADOS_ARTIGO = ["rascunho", "activo", "arquivado"] as const;
export type EstadoArtigo = (typeof ESTADOS_ARTIGO)[number];

export interface PaginaArtigos {
  dados: ResumoArtigo[];
  total: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}

/** Os filtros da lista; os vazios não vão no pedido. */
export interface FiltrosArtigos {
  estado?: EstadoArtigo;
  texto?: string;
  sku?: string;
}

/** Uma variante na ficha do artigo (o `Variante` do GET /products/{id}). */
export interface VarianteArtigo {
  id: string;
  sku: string;
  estado: "activa" | "arquivada";
  unidade_de_venda: "unidade" | "par" | "caixa" | "embalagem" | "conjunto";
  gtin: string | null;
  gtin_origem: string | null;
  conteudo_quantidade: number | null;
  conteudo_unidade: string | null;
  peso_g: number | null;
  comprimento_mm: number | null;
  largura_mm: number | null;
  altura_mm: number | null;
  onu: string | null;
  classe_adr: string | null;
  posicao: number;
  /** A versão lida: alterar a variante leva-a (docs/22 §23.1). */
  versao: number;
}

export const UNIDADES_DE_VENDA = [
  "unidade",
  "par",
  "caixa",
  "embalagem",
  "conjunto",
] as const;
export const UNIDADES_DE_CONTEUDO = [
  "mg",
  "g",
  "kg",
  "ml",
  "cl",
  "l",
  "mm",
  "cm",
  "m",
  "m2",
  "m3",
] as const;
export const ORIGENS_GTIN = [
  "gs1_comerciante",
  "fornecedor",
  "interno",
] as const;
/**
 * Quantas variantes um artigo criado no Hub traz (docs/22 §14.1): cópia de
 * `MAX_VARIANTES_NO_HUB` em apps/api/src/identidade/hub-catalogo.ts, para o
 * ecrã tirar o botão; a API recusa na mesma (revisão do #223, P3-8).
 */
export const MAX_VARIANTES_NO_HUB = 20;

/** Uma variante de um artigo novo (o corpo do POST /hub/products). */
export interface VarianteNova {
  sku: string;
  unidade_de_venda: (typeof UNIDADES_DE_VENDA)[number];
  gtin?: string;
  gtin_origem?: (typeof ORIGENS_GTIN)[number];
  conteudo_quantidade?: number;
  conteudo_unidade?: (typeof UNIDADES_DE_CONTEUDO)[number];
  peso_g?: number;
  comprimento_mm?: number;
  largura_mm?: number;
  altura_mm?: number;
}

/** Um artigo novo pelo Hub: só físico (docs/22 §14.2). */
export interface ArtigoNovo {
  tipo: "fisico";
  nome: string;
  descricao: string | null;
  marca: string | null;
  variantes: VarianteNova[];
}

/** A ficha do artigo (docs/22 §12; o `Artigo` do GET /products/{id}). */
export interface FichaArtigo extends ResumoArtigo {
  descricao: string | null;
  origem_ref: string | null;
  criado_em: string;
  /** A versão lida: cada alteração leva-a (docs/22 §13.2). */
  versao: number;
  variantes: VarianteArtigo[];
}

/** Uma imagem do artigo (o `MediaEsquema` do GET /products/{id}/media). */
export interface ImagemArtigo {
  id: string;
  variante: string | null;
  /** O ficheiro guardado (fil_…): reconhece uma ligação já feita (§15.2). */
  ficheiro: { id: string };
  texto_alternativo: string | null;
  posicao: number;
  principal: boolean;
  versao: number;
}

export const MOTIVOS_ARQUIVO = [
  "retirada",
  "artigo_arquivado",
  "mercado_arquivado",
  "canal_arquivado",
  "verificacao_falhou",
] as const;

/** Uma publicação por canal × mercado (GET /products/{id}/publications). */
export interface PublicacaoArtigo {
  id: string;
  canal: string;
  mercado: string;
  /** O nome do canal; vazio se não se encontrar (docs/22 §18.1). */
  canal_nome: string | null;
  /** O nome do mercado; vazio se não se encontrar. */
  mercado_nome: string | null;
  /** O nome da loja da publicação; vazio se não se encontrar (§19.1). */
  loja_nome: string | null;
  estado: "rascunho" | "publicado" | "arquivado";
  /** As variantes (var_…) que não se vendem neste par (docs/22 §27). */
  variantes_fora: string[];
  verificado_em: string | null;
  publicado_em: string | null;
  arquivado_em: string | null;
  motivo_arquivo: (typeof MOTIVOS_ARQUIVO)[number] | null;
  /** A versão lida: publicar e retirar levam-na (docs/22 §27.2). */
  versao: number;
  /** A do último pedido de publicação, também se foi recusado; null se não houve. */
  ultima_verificacao: {
    impedimentos: ImpedimentoApi[];
    nao_verificado: string[];
  } | null;
}

/** Um par canal × mercado onde o canal vende (GET /hub/sales-pairs). */
export interface ParDeVenda {
  canal: string;
  canal_nome: string;
  canal_estado: string;
  mercado: string;
  mercado_nome: string;
  mercado_estado: string;
  loja_nome: string;
}

/**
 * Um impedimento da verificação (docs/22 §27.3): o código e, conforme o caso,
 * os SKU das variantes, as línguas, a media ou o que falta.
 */
export interface ImpedimentoApi {
  codigo: string;
  variantes?: string[];
  linguas?: string[];
  media?: string[];
  falta?: string[];
  familias?: string[];
}

/** A verificação «pode publicar?» (C2). */
export interface VerificacaoApi {
  impedimentos: ImpedimentoApi[];
  nao_verificado: string[];
}

/** O corpo de verificar e de publicar: o par e as variantes que ficam fora. */
export interface EscolhaDePublicacao {
  canal: string;
  mercado: string;
  variantes_fora: string[];
}

export interface RespostaPublicar {
  publicada: boolean;
  verificacao: VerificacaoApi;
  publicacao: PublicacaoArtigo | null;
}

/** Um preço de uma variante numa lista (o `PrecoEsquema` da API). */
export interface PrecoVariante {
  variante: string;
  /** Em cêntimos, na moeda do mercado. */
  montante: number;
  gratuito: boolean;
  quantidade_minima: number;
  multiplo: number;
  definido_em: string;
  /** Sobe em cada escrita; as escritas do Hub mandam-na (docs/22 §25.2). */
  versao: number;
  /** A redução em vigor; o preço de referência vem calculado (docs/20 §3.6). */
  reducao: {
    montante: number;
    preco_referencia: number;
    inicio: string;
    fim: string | null;
  } | null;
  /** Calculado pelo servidor, com quatro casas e sem arredondar (§10.3). */
  preco_por_unidade: {
    valor: string;
    unidade: string;
    inclui_iva: boolean;
  } | null;
}

/** Uma lista activa com os preços das variantes de um artigo (§17.2). */
export interface PrecosNaLista {
  lista: { id: string; nome: string; tipo: string };
  mercado: {
    id: string;
    nome: string;
    estado: string;
    moeda: string;
    preco_inclui_iva: boolean;
  };
  precos: PrecoVariante[];
}

export interface PaginaPrecos {
  dados: PrecosNaLista[];
  total: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}

/** Quem fez uma alteração, decidido pelo servidor (docs/22 §16.2). */
export interface AutorAlteracao {
  /** O nome de quem é ou foi da equipa, ou o da chave; null nos outros. */
  nome: string | null;
}

/** Uma entrada do histórico do artigo (GET /hub/products/{id}/timeline). */
export interface AlteracaoArtigo {
  id: string;
  em: string;
  quem: string;
  /** `importacao:imp_…` numa importação; null numa escrita normal. */
  origem: string | null;
  /** As entradas com a mesma transacção são uma só alteração. */
  transacao: string;
  entidade: string;
  entidade_id: string | null;
  operacao: "criado" | "alterado" | "apagado";
  campos: Record<string, { antes: unknown; depois: unknown }>;
  autor: AutorAlteracao;
  // As respostas do rasto (docs/28 §1; docs/22 §26), decididas no servidor.
  /** De onde veio; null: desconhecido (linha de antes de 10/10/2026). */
  canal: string | null;
  /** O pedido HTTP ou a tarefa, para o apoio cruzar com os registos. */
  pedido: string | null;
  ia: {
    prova: "comprovado" | "declarado" | "desconhecido";
    fornecedor: string | null;
    modelo: string | null;
    execucao: string | null;
  };
  autorizado_por: string | null;
  motivo: string | null;
  a_pedido_de: { pedido: string | null; quem: string | null } | null;
  tipo_de_autor: TipoDeAutor;
  a_pedido_de_tipo: TipoDeAutor | null;
  /** true: sem autorização de uma pessoa; null: desconhecido (Q8). */
  sem_autorizacao_de_pessoa: boolean | null;
  autor_autorizou: { nome: string | null } | null;
  autor_do_pedido: { nome: string | null } | null;
}

export type TipoDeAutor =
  | "pessoa"
  | "agente"
  | "chave"
  | "consumidor"
  | "prestador"
  | "sistema"
  | "operador"
  | "desconhecido";

export interface PaginaHistorico {
  dados: AlteracaoArtigo[];
  total: number;
  ha_mais: boolean;
  cursor_seguinte: string | null;
}

/** O que um convite diz, antes de aceitar (docs/22 §10, issue #194). */
export interface DetalheConvite {
  comerciante_nome: string;
  papel: Papel;
  email: string;
  expira_em: string;
}

export interface ContaNova {
  pessoa: string;
  comerciante: string;
  codigos: string[];
}

/** Um erro da API, ou da rede (`estado` 0). */
export class ErroHub extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string | undefined,
    readonly mensagens: { pt?: string | undefined; en?: string | undefined },
    readonly referencia: string | undefined,
    readonly esperarSegundos: number | undefined,
    /** O pormenor da API (`detail`), em português (docs/22 §30.3). */
    readonly detalhe?: string,
  ) {
    super(codigo ?? `HTTP ${String(estado)}`);
  }
}

interface Problema {
  codigo?: unknown;
  detail?: unknown;
  mensagem?: { pt?: unknown; en?: unknown };
  instance?: unknown;
}

const texto = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function pedir<T>(
  metodo: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  caminho: string,
  opcoes: { corpo?: unknown; comerciante?: string } = {},
): Promise<T> {
  const cabecalhos: Record<string, string> = { accept: "application/json" };
  const comCorpo = metodo !== "GET";
  if (comCorpo) cabecalhos["content-type"] = "application/json";
  if (opcoes.comerciante !== undefined) {
    cabecalhos["eurolify-comerciante"] = opcoes.comerciante;
  }
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      credentials: "same-origin",
      headers: cabecalhos,
      ...(comCorpo ? { body: JSON.stringify(opcoes.corpo ?? {}) } : {}),
    });
  } catch {
    throw new ErroHub(0, undefined, {}, undefined, undefined);
  }
  // 204: sem corpo (tirar uma imagem).
  if (resposta.status === 204) return undefined as T;
  if (resposta.ok) return (await resposta.json()) as T;
  throw await erroDe(resposta);
}

/** O ficheiro guardado depois de um envio (o `Ficheiro` da API). */
export interface FicheiroEnviado {
  id: string;
  tipo: string;
  bytes: number;
}

/** Os tipos de imagem que a API aceita (docs/22 §15.1); confere-os na mesma. */
export const TIPOS_DE_IMAGEM = ["image/jpeg", "image/png", "image/webp"];
/** O tamanho máximo de uma imagem: o `TAMANHO_MAXIMO` da API (10 MB). */
export const TAMANHO_MAXIMO_IMAGEM = 10 * 1024 * 1024;

/** Um envio cancelado por quem o fez (não é um erro). */
export class EnvioCancelado extends Error {}

/**
 * Envia os bytes de uma imagem (docs/22 §15.2) com o progresso: o `fetch`
 * não diz quanto já subiu, o `XMLHttpRequest` diz. O corpo vai como está,
 * com o tipo do ficheiro; a origem é a do Hub (o mesmo site).
 */
export function enviarImagem(
  comerciante: string,
  ficheiro: Blob,
  aoProgresso: (percentagem: number) => void,
  sinal: AbortSignal,
): Promise<FicheiroEnviado> {
  return new Promise((resolver, rejeitar) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/hub/media/uploads");
    x.withCredentials = true;
    x.setRequestHeader("content-type", ficheiro.type);
    x.setRequestHeader("accept", "application/json");
    x.setRequestHeader("eurolify-comerciante", comerciante);
    x.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        aoProgresso(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    x.onerror = () => {
      rejeitar(new ErroHub(0, undefined, {}, undefined, undefined));
    };
    x.onabort = () => {
      rejeitar(new EnvioCancelado());
    };
    x.onload = () => {
      if (x.status === 201) {
        try {
          resolver(JSON.parse(x.responseText) as FicheiroEnviado);
        } catch {
          // A resposta chegou cortada: como uma resposta perdida.
          rejeitar(new ErroHub(0, undefined, {}, undefined, undefined));
        }
        return;
      }
      let problema: Problema = {};
      try {
        problema = JSON.parse(x.responseText) as Problema;
      } catch {
        // Um corpo que não é JSON (ex.: o nginx): fica o estado.
      }
      const esperar = Number(x.getResponseHeader("retry-after"));
      rejeitar(
        new ErroHub(
          x.status,
          texto(problema.codigo),
          {
            pt: texto(problema.mensagem?.pt),
            en: texto(problema.mensagem?.en),
          },
          texto(problema.instance),
          Number.isFinite(esperar) && esperar > 0 ? esperar : undefined,
        ),
      );
    };
    sinal.addEventListener("abort", () => {
      x.abort();
    });
    x.send(ficheiro);
  });
}

/**
 * O tempo máximo sem receber nada de uma miniatura (issue #253): até à
 * resposta e entre dois pedaços dos bytes. Conta-se do último pedaço, não do
 * início, para uma imagem grande (até 10 MiB, `TAMANHO_MAXIMO` da API) numa
 * rede lenta não falhar enquanto ainda chegam bytes (revisão do #280, P2).
 */
export const PRAZO_DA_IMAGEM_MS = 30_000;

/**
 * Os bytes de uma imagem (docs/22 §12.1): um `<img src>` não leva o
 * cabeçalho do comerciante, por isso pedem-se aqui e mostram-se por `blob:`.
 */
export async function pedirBytes(
  caminho: string,
  comerciante: string,
  sinal?: AbortSignal,
  prazoMs: number = PRAZO_DA_IMAGEM_MS,
): Promise<Blob> {
  // Sem prazo, um pedido sem resposta ocupava um lugar da fila para sempre
  // (issue #253).
  const controlo = new AbortController();
  let leitor: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const parar = () => {
    controlo.abort();
    // A leitura dos bytes também pára (nem todos os corpos seguem o sinal).
    void leitor?.cancel().catch(() => undefined);
  };
  if (sinal?.aborted === true) parar();
  sinal?.addEventListener("abort", parar, { once: true });
  let relogio = setTimeout(parar, prazoMs);
  const recomecar = () => {
    clearTimeout(relogio);
    relogio = setTimeout(parar, prazoMs);
  };
  const semRede = () => new ErroHub(0, undefined, {}, undefined, undefined);
  try {
    let resposta: Response;
    try {
      resposta = await fetch(caminho, {
        method: "GET",
        credentials: "same-origin",
        headers: { "eurolify-comerciante": comerciante },
        signal: controlo.signal,
      });
    } catch {
      throw semRede();
    }
    if (!resposta.ok) throw await erroDe(resposta);
    const tipo = resposta.headers.get("content-type") ?? "";
    if (resposta.body === null) return new Blob([], { type: tipo });
    const corpo = resposta.body.getReader();
    leitor = corpo;
    const pedacos: Uint8Array<ArrayBuffer>[] = [];
    try {
      for (;;) {
        recomecar();
        const { done, value } = await corpo.read();
        if (done) break;
        pedacos.push(value);
      }
    } catch {
      throw semRede();
    }
    // Cancelada a meio, a leitura acaba como se tivesse chegado ao fim.
    if (controlo.signal.aborted) throw semRede();
    return new Blob(pedacos, { type: tipo });
  } finally {
    clearTimeout(relogio);
    sinal?.removeEventListener("abort", parar);
  }
}

/**
 * Uma fila para os bytes das imagens: no máximo 4 pedidos ao mesmo tempo,
 * para um artigo com muitas imagens não gastar de uma vez o limite de
 * pedidos do Hub nem ler todos os ficheiros na API em paralelo.
 *
 * Quem acaba passa o lugar directamente ao primeiro em espera: com o lugar
 * libertado e só depois ocupado, um pedido novo no intervalo passava à
 * frente e ficavam 5 ao mesmo tempo (revisão do #280, P3). Quem é cancelado
 * enquanto espera sai logo da fila.
 */
const MAXIMO_IMAGENS_EM_CURSO = 4;
let imagensEmCurso = 0;
const imagensEmEspera: (() => void)[] = [];

/** Para os testes: quantos pedidos de imagens estão a correr agora. */
export function imagensACorrer(): number {
  return imagensEmCurso;
}

export async function naFilaDasImagens<T>(
  pedido: () => Promise<T>,
  sinal?: AbortSignal,
): Promise<T> {
  // Quem saiu (a miniatura já não está no ecrã) não chega a pedir.
  if (sinal?.aborted === true) {
    throw new ErroHub(0, undefined, {}, undefined, undefined);
  }
  if (imagensEmCurso < MAXIMO_IMAGENS_EM_CURSO) {
    imagensEmCurso++;
  } else {
    // O lugar vem de quem acabar (ver o `finally`), já contado.
    await new Promise<void>((avancar, desistir) => {
      const minhaVez = () => {
        sinal?.removeEventListener("abort", saiu);
        avancar();
      };
      const saiu = () => {
        const n = imagensEmEspera.indexOf(minhaVez);
        if (n >= 0) imagensEmEspera.splice(n, 1);
        desistir(new ErroHub(0, undefined, {}, undefined, undefined));
      };
      sinal?.addEventListener("abort", saiu, { once: true });
      imagensEmEspera.push(minhaVez);
    });
  }
  try {
    return await pedido();
  } finally {
    const seguinte = imagensEmEspera.shift();
    if (seguinte === undefined) imagensEmCurso--;
    else seguinte();
  }
}

async function erroDe(resposta: Response): Promise<ErroHub> {
  let problema: Problema = {};
  try {
    problema = (await resposta.json()) as Problema;
  } catch {
    // Um corpo que não é JSON (ex.: o proxy): fica o estado.
  }
  const esperar = Number(resposta.headers.get("retry-after"));
  return new ErroHub(
    resposta.status,
    texto(problema.codigo),
    {
      pt: texto(problema.mensagem?.pt),
      en: texto(problema.mensagem?.en),
    },
    texto(problema.instance),
    Number.isFinite(esperar) && esperar > 0 ? esperar : undefined,
    texto(problema.detail),
  );
}

export const api = {
  eu: () => pedir<Eu>("GET", "/hub/me"),
  // O ecrã «A decidir» (docs/22 §28.2): as mesmas rotas da chave pelo Hub.
  tarefas: (comerciante: string, consulta: string) =>
    pedir<PaginaTarefas>("GET", `/hub/tasks?${consulta}`, { comerciante }),
  tarefa: (comerciante: string, fila: FilaTarefa, caso: string) =>
    pedir<CasoTarefa>("GET", `/hub/tasks/${fila}/${encodeURIComponent(caso)}`, {
      comerciante,
    }),
  atribuirTarefa: (
    comerciante: string,
    fila: FilaTarefa,
    caso: string,
    responsavel: string | null,
    versao: number,
  ) =>
    pedir<{ versao: number }>(
      "POST",
      `/hub/tasks/${fila}/${encodeURIComponent(caso)}/assign`,
      { comerciante, corpo: { responsavel, versao } },
    ),
  mudarPrazoTarefa: (
    comerciante: string,
    fila: FilaTarefa,
    caso: string,
    prazo: string,
    motivo: string,
    versao: number,
  ) =>
    pedir<{ versao: number }>(
      "POST",
      `/hub/tasks/${fila}/${encodeURIComponent(caso)}/deadline`,
      { comerciante, corpo: { prazo, motivo, versao } },
    ),
  // O ecrã «Faturação» (docs/22 §30.2): as mesmas rotas da chave pelo Hub.
  faturacao: (comerciante: string) =>
    pedir<Faturacao>("GET", "/hub/invoicing", { comerciante }),
  /** Chama-se dentro de `comRecente` (autenticação recente). */
  autorizarLigacao: (comerciante: string, ligacao: string, empresa: string) =>
    pedir<{ url: string; estado: string; expira_em: string }>(
      "POST",
      `/hub/invoicing-connections/${encodeURIComponent(ligacao)}/authorize`,
      { comerciante, corpo: { empresa } },
    ),
  concluirLigacao: (
    comerciante: string,
    ligacao: string,
    codigo: string,
    estado: string,
  ) =>
    pedir<undefined>(
      "POST",
      `/hub/invoicing-connections/${encodeURIComponent(ligacao)}/authorize/complete`,
      { comerciante, corpo: { codigo, estado } },
    ),
  testarLigacao: (comerciante: string, ligacao: string) =>
    pedir<{ estado: string; erro: string | null }>(
      "POST",
      `/hub/invoicing-connections/${encodeURIComponent(ligacao)}/test`,
      { comerciante },
    ),
  relatorioOss: (comerciante: string, entidade: string, periodo: string) =>
    pedir<RelatorioOss>(
      "GET",
      `/hub/tax-reports/oss?${new URLSearchParams({ entidade, periodo }).toString()}`,
      { comerciante },
    ),
  documentoOss: (comerciante: string, documento: string) =>
    pedir<DocumentoAClassificar>(
      "GET",
      `/hub/tax-reports/oss/documents/${encodeURIComponent(documento)}`,
      { comerciante },
    ),
  classificarOss: (
    comerciante: string,
    corpo: {
      documento: string;
      linhas: { balde: string; pais: string }[];
      data?: string;
      motivo: string;
    },
  ) =>
    pedir<unknown>("POST", "/hub/tax-reports/oss/classifications", {
      comerciante,
      corpo,
    }),
  /** Chama-se dentro de `comRecente` (autenticação recente). */
  fecharOss: (
    comerciante: string,
    entidade: string,
    periodo: string,
    confirmoPorEmitir: boolean,
  ) =>
    pedir<RelatorioOss>("POST", "/hub/tax-reports/oss/close", {
      comerciante,
      corpo: confirmoPorEmitir
        ? { entidade, periodo, confirmo_por_emitir: true }
        : { entidade, periodo },
    }),
  /** O CSV dos registos (art. 63.º-C), em bytes, para descarregar. */
  registosOss: (comerciante: string, entidade: string, periodo: string) =>
    pedirBytes(
      `/hub/tax-reports/oss/records?${new URLSearchParams({ entidade, periodo }).toString()}`,
      comerciante,
    ),
  // As contas de transportadora (docs/22 §29.2): as mesmas rotas da chave.
  contasTransportadora: (comerciante: string) =>
    pedir<{ dados: ContaTransportadora[] }>("GET", "/hub/carrier-accounts", {
      comerciante,
    }),
  criarContaTransportadora: (
    comerciante: string,
    corpo: {
      transportadora: ContaTransportadora["transportadora"];
      nome: string;
      remetente: RemetenteConta;
    },
  ) =>
    pedir<{ id: string }>("POST", "/hub/carrier-accounts", {
      comerciante,
      corpo,
    }),
  mudarContaTransportadora: (
    comerciante: string,
    id: string,
    corpo: {
      versao: number;
      nome?: string;
      remetente?: RemetenteConta;
      arquivar?: true;
    },
  ) =>
    pedir<{ versao: number }>(
      "PATCH",
      `/hub/carrier-accounts/${encodeURIComponent(id)}`,
      { comerciante, corpo },
    ),
  guardarCredenciais: (
    comerciante: string,
    id: string,
    corpo: {
      credenciais: Record<string, string>;
      segredo_aviso?: string | null;
    },
  ) =>
    pedir<undefined>(
      "PUT",
      `/hub/carrier-accounts/${encodeURIComponent(id)}/credentials`,
      { comerciante, corpo },
    ),
  testarContaTransportadora: (comerciante: string, id: string) =>
    pedir<{ versao: number }>(
      "POST",
      `/hub/carrier-accounts/${encodeURIComponent(id)}/test`,
      { comerciante, corpo: {} },
    ),
  servicosDaConta: (comerciante: string, id: string) =>
    pedir<{ dados: ServicoConta[] }>(
      "GET",
      `/hub/carrier-accounts/${encodeURIComponent(id)}/services`,
      { comerciante },
    ),
  // Os métodos de entrega e a embalagem (docs/22 §31).
  mercados: (comerciante: string) =>
    pedir<{ dados: MercadoHub[] }>("GET", "/hub/markets", { comerciante }),
  armazens: (comerciante: string) =>
    pedir<{ dados: ArmazemHub[] }>("GET", "/hub/warehouses", { comerciante }),
  definirEmbalagem: (comerciante: string, armazem: string, gramas: number) =>
    pedir<null>(
      "PUT",
      `/hub/warehouses/${encodeURIComponent(armazem)}/packaging`,
      { comerciante, corpo: { embalagem_g: gramas } },
    ),
  metodosEntrega: (comerciante: string) =>
    pedir<{ dados: MetodoEntrega[] }>("GET", "/hub/shipping-methods", {
      comerciante,
    }),
  criarMetodoEntrega: (
    comerciante: string,
    corpo: CamposMetodoEntrega & { mercado: string },
  ) =>
    pedir<{ id: string }>("POST", "/hub/shipping-methods", {
      comerciante,
      corpo,
    }),
  mudarMetodoEntrega: (
    comerciante: string,
    id: string,
    corpo: Partial<CamposMetodoEntrega> & {
      versao: number;
      estado?: MetodoEntrega["estado"];
    },
  ) =>
    pedir<null>("PATCH", `/hub/shipping-methods/${encodeURIComponent(id)}`, {
      comerciante,
      corpo,
    }),
  sair: () => pedir<{ ok: true }>("POST", "/hub/session/end"),
  membros: (comerciante: string) =>
    pedir<Membros>("GET", "/hub/members", { comerciante }),
  convidar: (comerciante: string, email: string, papel: Papel) =>
    pedir<{ convite: string; segredo: string }>("POST", "/hub/invitations", {
      comerciante,
      corpo: { email, papel },
    }),
  // A gestão da equipa (docs/22 §10): só o dono muda papéis e tira outros;
  // cada um sai por si. A base decide.
  mudarPapel: (comerciante: string, membro: string, papel: Papel) =>
    pedir<{ ok: true }>(
      "POST",
      `/hub/members/${encodeURIComponent(membro)}/role`,
      { comerciante, corpo: { papel } },
    ),
  terminarMembro: (comerciante: string, membro: string) =>
    pedir<{ ok: true }>(
      "POST",
      `/hub/members/${encodeURIComponent(membro)}/end`,
      { comerciante },
    ),
  /** A lista de artigos (docs/22 §11.1): a mesma do GET /products. */
  artigos: (
    comerciante: string,
    filtros: FiltrosArtigos,
    cursor: string | null,
  ) => {
    const q = new URLSearchParams({ limite: "25" });
    if (filtros.estado !== undefined) q.set("estado", filtros.estado);
    if (filtros.texto !== undefined) q.set("texto", filtros.texto);
    if (filtros.sku !== undefined) q.set("sku", filtros.sku);
    if (cursor !== null) q.set("cursor", cursor);
    return pedir<PaginaArtigos>("GET", `/hub/products?${q.toString()}`, {
      comerciante,
    });
  },
  /** A ficha do artigo (docs/22 §12.1): a mesma do GET /products/{id}. */
  artigo: (comerciante: string, artigo: string) =>
    pedir<FichaArtigo>("GET", `/hub/products/${artigo}`, { comerciante }),
  /** Todas as imagens do artigo, pela ordem (página a página, 100 de cada vez). */
  imagensDoArtigo: async (comerciante: string, artigo: string) => {
    const imagens: ImagemArtigo[] = [];
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams({ limite: "100" });
      if (cursor !== null) q.set("cursor", cursor);
      const pagina: { dados: ImagemArtigo[]; cursor_seguinte: string | null } =
        await pedir("GET", `/hub/products/${artigo}/media?${q.toString()}`, {
          comerciante,
        });
      imagens.push(...pagina.dados);
      cursor = pagina.cursor_seguinte;
    } while (cursor !== null);
    return imagens;
  },
  /**
   * Os bytes de uma imagem, no máximo 4 ao mesmo tempo (revisão do #206,
   * P2-1). O `sinal` cancela o pedido quando a miniatura sai do ecrã, para
   * não prender a fila (issue #253).
   */
  bytesDaImagem: (comerciante: string, imagem: string, sinal?: AbortSignal) =>
    naFilaDasImagens(
      () => pedirBytes(`/hub/media/${imagem}/file`, comerciante, sinal),
      sinal,
    ),
  /** As opções do artigo (docs/22 §20.1), 100 de cada vez, até ao fim. */
  opcoesDoArtigo: async (comerciante: string, artigo: string) => {
    const opcoes: OpcaoArtigo[] = [];
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams({ limite: "100" });
      if (cursor !== null) q.set("cursor", cursor);
      const pagina: { dados: OpcaoArtigo[]; cursor_seguinte: string | null } =
        await pedir("GET", `/hub/products/${artigo}/options?${q.toString()}`, {
          comerciante,
        });
      opcoes.push(...pagina.dados);
      cursor = pagina.cursor_seguinte;
    } while (cursor !== null);
    return opcoes;
  },
  publicacoesDoArtigo: (comerciante: string, artigo: string) =>
    pedir<{ dados: PublicacaoArtigo[] }>(
      "GET",
      `/hub/products/${artigo}/publications`,
      { comerciante },
    ),
  // Publicar pelo Hub (docs/22 §27.2): os pares onde se pode publicar, a
  // verificação e as escritas, cada uma com a `versao` lida da publicação
  // (`null` quando ainda não existe nesse par).
  paresDeVenda: (comerciante: string) =>
    pedir<{ dados: ParDeVenda[] }>("GET", "/hub/sales-pairs", { comerciante }),
  verificarPublicacao: (
    comerciante: string,
    artigo: string,
    corpo: EscolhaDePublicacao,
  ) =>
    pedir<VerificacaoApi>(
      "POST",
      `/hub/products/${artigo}/publications/check`,
      {
        comerciante,
        corpo,
      },
    ),
  publicar: (
    comerciante: string,
    artigo: string,
    corpo: EscolhaDePublicacao & { versao: number | null },
  ) =>
    pedir<RespostaPublicar>("POST", `/hub/products/${artigo}/publications`, {
      comerciante,
      corpo,
    }),
  retirarPublicacao: (
    comerciante: string,
    publicacao: string,
    versao: number,
  ) =>
    pedir<PublicacaoArtigo>("POST", `/hub/publications/${publicacao}/archive`, {
      comerciante,
      corpo: { versao },
    }),
  /** Os preços do artigo nas listas activas (docs/22 §17), 25 listas de cada vez. */
  precosDoArtigo: (
    comerciante: string,
    artigo: string,
    cursor: string | null,
  ) => {
    const q = new URLSearchParams();
    if (cursor !== null) q.set("cursor", cursor);
    const sufixo = q.size === 0 ? "" : `?${q.toString()}`;
    return pedir<PaginaPrecos>(
      "GET",
      `/hub/products/${artigo}/prices${sufixo}`,
      { comerciante },
    );
  },
  /**
   * Uma lista activa com os preços do artigo (docs/22 §25.3), procurada
   * página a página; `null` quando não está entre as activas.
   */
  listaDoArtigo: async (comerciante: string, artigo: string, lista: string) => {
    let cursor: string | null = null;
    do {
      const pagina: PaginaPrecos = await api.precosDoArtigo(
        comerciante,
        artigo,
        cursor,
      );
      const achada = pagina.dados.find((l) => l.lista.id === lista);
      if (achada !== undefined) return achada;
      cursor = pagina.ha_mais ? pagina.cursor_seguinte : null;
    } while (cursor !== null);
    return null;
  },
  // Definir e tirar o preço de uma variante numa lista (docs/22 §25.2): as
  // mesmas escritas da chave, pelos caminhos /hub/, com o preço `lido`.
  definirPreco: (
    comerciante: string,
    lista: string,
    variante: string,
    corpo: CorpoPreco,
  ) =>
    pedir<PrecoVariante>(
      "PUT",
      `/hub/price-lists/${lista}/prices/${variante}`,
      { comerciante, corpo },
    ),
  tirarPreco: (
    comerciante: string,
    lista: string,
    variante: string,
    lido: NonNullable<PrecoLido>,
  ) =>
    pedir<undefined>("DELETE", `/hub/price-lists/${lista}/prices/${variante}`, {
      comerciante,
      corpo: { lido },
    }),
  /** O histórico do artigo (docs/22 §16), 25 de cada vez. */
  historicoDoArtigo: (
    comerciante: string,
    artigo: string,
    cursor: string | null,
  ) => {
    const q = new URLSearchParams();
    if (cursor !== null) q.set("cursor", cursor);
    const sufixo = q.size === 0 ? "" : `?${q.toString()}`;
    return pedir<PaginaHistorico>(
      "GET",
      `/hub/products/${artigo}/timeline${sufixo}`,
      { comerciante },
    );
  },
  /** Criar um artigo físico em rascunho (docs/22 §14): o POST /products. */
  criarArtigo: (comerciante: string, corpo: ArtigoNovo) =>
    pedir<FichaArtigo>("POST", "/hub/products", { comerciante, corpo }),
  /** Ligar um ficheiro enviado ao artigo (docs/22 §15.2). */
  ligarImagem: (
    comerciante: string,
    artigo: string,
    corpo: {
      ficheiro: string;
      texto_alternativo: string | null;
      principal: boolean;
    },
  ) =>
    pedir<ImagemArtigo>("POST", `/hub/products/${artigo}/media`, {
      comerciante,
      corpo,
    }),
  /** Tirar a imagem do artigo (o ficheiro fica); o corpo é `{}`. */
  tirarImagem: (comerciante: string, imagem: string) =>
    pedir<undefined>("DELETE", `/hub/media/${imagem}`, {
      comerciante,
      corpo: {},
    }),
  // Editar o artigo (docs/22 §13): as mesmas escritas da API, pelos
  // caminhos /hub/, cada uma com a `versao` lida.
  alterarArtigo: (
    comerciante: string,
    artigo: string,
    corpo: {
      versao: number;
      nome?: string;
      descricao?: string | null;
      marca?: string | null;
    },
  ) =>
    pedir<FichaArtigo>("PATCH", `/hub/products/${artigo}`, {
      comerciante,
      corpo,
    }),
  mudarEstadoDoArtigo: (
    comerciante: string,
    artigo: string,
    accao: "activate" | "archive" | "restore",
    versao: number,
  ) =>
    pedir<FichaArtigo>("POST", `/hub/products/${artigo}/${accao}`, {
      comerciante,
      corpo: { versao },
    }),
  /** Acrescentar uma variante ao artigo (docs/22 §24.1). */
  criarVariante: (comerciante: string, artigo: string, corpo: VarianteACriar) =>
    pedir<VarianteArtigo>("POST", `/hub/products/${artigo}/variants`, {
      comerciante,
      corpo,
    }),
  /** Alterar a variante (docs/22 §23.1): só os campos que mudam. */
  alterarVariante: (
    comerciante: string,
    variante: string,
    corpo: AlteracaoVariante,
  ) =>
    pedir<VarianteArtigo>("PATCH", `/hub/variants/${variante}`, {
      comerciante,
      corpo,
    }),
  arquivarVariante: (comerciante: string, variante: string) =>
    pedir<VarianteArtigo>("POST", `/hub/variants/${variante}/archive`, {
      comerciante,
      corpo: {},
    }),
  // Escrever as opções (docs/22 §21.2): as mesmas escritas da API, pelos
  // caminhos /hub/, com a `versao` da opção lida; apagar leva-a no corpo.
  criarOpcao: (
    comerciante: string,
    artigo: string,
    corpo: { nome: string; valores: string[] },
  ) =>
    pedir<OpcaoArtigo>("POST", `/hub/products/${artigo}/options`, {
      comerciante,
      corpo,
    }),
  acrescentarValor: (
    comerciante: string,
    opcao: string,
    corpo: { valor: string; versao: number },
  ) =>
    pedir<OpcaoArtigo>("POST", `/hub/options/${opcao}/values`, {
      comerciante,
      corpo,
    }),
  mudarNomeDaOpcao: (
    comerciante: string,
    opcao: string,
    corpo: { nome: string; versao: number },
  ) =>
    pedir<OpcaoArtigo>("PATCH", `/hub/options/${opcao}`, {
      comerciante,
      corpo,
    }),
  mudarTextoDoValor: (
    comerciante: string,
    opcao: string,
    valor: string,
    corpo: { valor: string; versao: number },
  ) =>
    pedir<OpcaoArtigo>("PATCH", `/hub/options/${opcao}/values/${valor}`, {
      comerciante,
      corpo,
    }),
  apagarOpcao: (comerciante: string, opcao: string, versao: number) =>
    pedir<undefined>("DELETE", `/hub/options/${opcao}`, {
      comerciante,
      corpo: { versao },
    }),
  apagarValor: (
    comerciante: string,
    opcao: string,
    valor: string,
    versao: number,
  ) =>
    pedir<OpcaoArtigo>("DELETE", `/hub/options/${opcao}/values/${valor}`, {
      comerciante,
      corpo: { versao },
    }),
  ordenarOpcoes: (comerciante: string, artigo: string, opcoes: string[]) =>
    pedir<{ dados: OpcaoArtigo[] }>(
      "PUT",
      `/hub/products/${artigo}/options/order`,
      { comerciante, corpo: { opcoes } },
    ),
  ordenarValores: (
    comerciante: string,
    opcao: string,
    valores: string[],
    versao: number,
  ) =>
    pedir<OpcaoArtigo>("PUT", `/hub/options/${opcao}/values/order`, {
      comerciante,
      corpo: { valores, versao },
    }),
  valoresDaVariante: (
    comerciante: string,
    variante: string,
    valores: string[],
  ) =>
    pedir<VarianteArtigo>("PUT", `/hub/variants/${variante}/values`, {
      comerciante,
      corpo: { valores },
    }),
  alterarImagem: (
    comerciante: string,
    imagem: string,
    corpo: {
      versao: number;
      texto_alternativo?: string | null;
      posicao?: number;
      principal?: boolean;
    },
  ) =>
    pedir<ImagemArtigo>("PATCH", `/hub/media/${imagem}`, {
      comerciante,
      corpo,
    }),
  /** O que o convite diz; o segredo vai no corpo, nunca no endereço. */
  verConvite: (convite: string) =>
    pedir<DetalheConvite>("POST", "/hub/invitations/preview", {
      corpo: { convite },
    }),
  /** Aceitar um convite com a conta da sessão (o e-mail tem de ser o do convite). */
  aceitarConvite: (convite: string) =>
    pedir<{ comerciante: string; membro: string }>(
      "POST",
      "/hub/invitations/accept",
      { corpo: { convite } },
    ),
  cancelarConvite: (comerciante: string, convite: string) =>
    pedir<{ ok: true }>(
      "POST",
      `/hub/invitations/${encodeURIComponent(convite)}/cancel`,
      { comerciante },
    ),
  // A minha conta (docs/22 §9.1). As que mudam algo pedem autenticação
  // recente: chamam-se dentro de `comRecente`.
  passkeys: () => pedir<{ passkeys: Passkey[] }>("GET", "/hub/passkeys"),
  retirarPasskey: (passkey: string) =>
    pedir<{ ok: true }>(
      "POST",
      `/hub/passkeys/${encodeURIComponent(passkey)}/remove`,
    ),
  sessoes: () => pedir<{ sessoes: Sessao[] }>("GET", "/hub/sessions"),
  terminarOutrasSessoes: () =>
    pedir<{ ok: true }>("POST", "/hub/sessions/end-all"),
  gerarCodigos: () =>
    pedir<{ codigos: string[] }>("POST", "/hub/recovery-codes"),
  // As chaves de API do comerciante (docs/22 §9.3; só o dono). O segredo só
  // vem na resposta de `criarChave` e nunca se guarda.
  chaves: (comerciante: string) =>
    pedir<{ dados: ChaveApi[] }>("GET", "/hub/keys", { comerciante }),
  criarChave: (
    comerciante: string,
    dados: {
      nome: string;
      ambitos: Ambito[];
      expira_em?: string;
      agente_ia: boolean;
    },
  ) =>
    pedir<ChaveApi & { segredo: string }>("POST", "/hub/keys", {
      comerciante,
      corpo: { tipo: "servidor", ...dados },
    }),
  revogarChave: (comerciante: string, chave: string) =>
    pedir<ChaveApi>("POST", `/hub/keys/${encodeURIComponent(chave)}/revoke`, {
      comerciante,
    }),
  // A palavra-passe com o TOTP (docs/22 §9.2). O segredo e o URI só vêm na
  // resposta de `prepararPalavraPasse` e nunca se guardam.
  prepararPalavraPasse: (palavraPasse: string) =>
    pedir<{ segredo: string; uri: string }>("POST", "/hub/password/setup", {
      corpo: { palavra_passe: palavraPasse },
    }),
  confirmarPalavraPasse: (codigo: string) =>
    pedir<{ ok: true }>("POST", "/hub/password/confirm", {
      corpo: { codigo },
    }),
  retirarPalavraPasse: () =>
    pedir<{ ok: true }>("POST", "/hub/password/remove"),
  entrarComPalavraPasse: (
    email: string,
    palavraPasse: string,
    codigo: string,
  ) =>
    pedir<{ pessoa: string }>("POST", "/hub/session/password", {
      corpo: { email, palavra_passe: palavraPasse, codigo },
    }),
};
