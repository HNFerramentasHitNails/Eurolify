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
  metodo: "GET" | "POST",
  caminho: string,
  opcoes: { corpo?: unknown; comerciante?: string } = {},
): Promise<T> {
  const cabecalhos: Record<string, string> = { accept: "application/json" };
  if (metodo === "POST") cabecalhos["content-type"] = "application/json";
  if (opcoes.comerciante !== undefined) {
    cabecalhos["eurolify-comerciante"] = opcoes.comerciante;
  }
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      credentials: "same-origin",
      headers: cabecalhos,
      ...(metodo === "POST"
        ? { body: JSON.stringify(opcoes.corpo ?? {}) }
        : {}),
    });
  } catch {
    throw new ErroHub(0, undefined, {}, undefined, undefined);
  }
  if (resposta.ok) return (await resposta.json()) as T;
  let problema: Problema = {};
  try {
    problema = (await resposta.json()) as Problema;
  } catch {
    // Um corpo que não é JSON (ex.: o proxy): fica o estado.
  }
  const esperar = Number(resposta.headers.get("retry-after"));
  throw new ErroHub(
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
