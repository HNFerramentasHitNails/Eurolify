// O cliente da API do Hub (docs/21 §11 e §12; docs/22 §3). Só fala com o
// próprio anfitrião (`/hub/*`), com o cookie da sessão (que o Hub não lê) e
// sempre em JSON; os erros chegam no formato RFC 9457 com um `codigo`.

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
export type Ambito = (typeof AMBITOS_SERVIDOR)[number] | "storefront";

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
  conteudo_quantidade: number | null;
  conteudo_unidade: string | null;
  peso_g: number | null;
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
  estado: "rascunho" | "publicado" | "arquivado";
  verificado_em: string | null;
  publicado_em: string | null;
  arquivado_em: string | null;
  motivo_arquivo: (typeof MOTIVOS_ARQUIVO)[number] | null;
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
  ) {
    super(codigo ?? `HTTP ${String(estado)}`);
  }
}

interface Problema {
  codigo?: unknown;
  mensagem?: { pt?: unknown; en?: unknown };
  instance?: unknown;
}

const texto = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function pedir<T>(
  metodo: "GET" | "POST" | "PATCH",
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
  if (resposta.ok) return (await resposta.json()) as T;
  throw await erroDe(resposta);
}

/**
 * Os bytes de uma imagem (docs/22 §12.1): um `<img src>` não leva o
 * cabeçalho do comerciante, por isso pedem-se aqui e mostram-se por `blob:`.
 */
export async function pedirBytes(
  caminho: string,
  comerciante: string,
): Promise<Blob> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      method: "GET",
      credentials: "same-origin",
      headers: { "eurolify-comerciante": comerciante },
    });
  } catch {
    throw new ErroHub(0, undefined, {}, undefined, undefined);
  }
  if (resposta.ok) return resposta.blob();
  throw await erroDe(resposta);
}

/**
 * Uma fila para os bytes das imagens: no máximo 4 pedidos ao mesmo tempo,
 * para um artigo com muitas imagens não gastar de uma vez o limite de
 * pedidos do Hub nem ler todos os ficheiros na API em paralelo.
 */
const MAXIMO_IMAGENS_EM_CURSO = 4;
let imagensEmCurso = 0;
const imagensEmEspera: (() => void)[] = [];

async function naFilaDasImagens<T>(pedido: () => Promise<T>): Promise<T> {
  if (imagensEmCurso >= MAXIMO_IMAGENS_EM_CURSO) {
    await new Promise<void>((avancar) => {
      imagensEmEspera.push(avancar);
    });
  }
  imagensEmCurso++;
  try {
    return await pedido();
  } finally {
    imagensEmCurso--;
    imagensEmEspera.shift()?.();
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
  );
}

export const api = {
  eu: () => pedir<Eu>("GET", "/hub/me"),
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
  /** Os bytes de uma imagem, no máximo 4 ao mesmo tempo (revisão do #206, P2-1). */
  bytesDaImagem: (comerciante: string, imagem: string) =>
    naFilaDasImagens(() =>
      pedirBytes(`/hub/media/${imagem}/file`, comerciante),
    ),
  publicacoesDoArtigo: (comerciante: string, artigo: string) =>
    pedir<{ dados: PublicacaoArtigo[] }>(
      "GET",
      `/hub/products/${artigo}/publications`,
      { comerciante },
    ),
  /** Criar um artigo físico em rascunho (docs/22 §14): o POST /products. */
  criarArtigo: (comerciante: string, corpo: ArtigoNovo) =>
    pedir<FichaArtigo>("POST", "/hub/products", { comerciante, corpo }),
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
  arquivarVariante: (comerciante: string, variante: string) =>
    pedir<VarianteArtigo>("POST", `/hub/variants/${variante}/archive`, {
      comerciante,
      corpo: {},
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
    dados: { nome: string; ambitos: Ambito[]; expira_em?: string },
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
