// O cliente da API do Hub (docs/21 §11 e §12; docs/22 §3). Só fala com o
// próprio anfitrião (`/hub/*`), com o cookie da sessão (que o Hub não lê) e
// sempre em JSON; os erros chegam no formato RFC 9457 com um `codigo`.

export type Papel = "dono" | "gestor" | "armazem" | "apoio";
export const PAPEIS: readonly Papel[] = ["dono", "gestor", "armazem", "apoio"];

export interface Eu {
  pessoa: string;
  nome: string;
  email: string;
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
};
