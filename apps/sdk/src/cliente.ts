import { ErroDaApi, ErroDeRede, ErroDoSdk, lerProblema } from "./erros.js";
import type { Cliente, Metodo, Resposta } from "./tipos.js";

/** O que se diz ao criar um cliente. */
export interface OpcoesDoCliente {
  /** Onde vive a API (ex.: `https://api.eurolify.eu`), sem barra final. */
  url: string;
  /**
   * A chave: `eul_pk_…` na Loja, `eul_sk_…` na Administração. Nunca no
   * repositório nem no código de um browser (a de servidor).
   */
  chave?: string;
  /** A versão da API por data (ex.: `2026-10`), enviada em `Eurolify-Versao`. */
  versao?: string;
  /** Cabeçalhos a juntar a todos os pedidos (ex.: `Eurolify-IA`). */
  cabecalhos?: Record<string, string>;
  /** `fetch` a usar; por omissão o global (nos testes, um injectado). */
  fetch?: typeof fetch;
  /** Tempo máximo de cada pedido, em milissegundos; por omissão 30 000. */
  limiteMs?: number;
}

interface PedidoGenerico {
  caminho?: Record<string, string>;
  consulta?: Record<string, unknown>;
  cabecalhos?: Record<string, string>;
  corpo?: unknown;
  idempotencia?: string;
  sinal?: AbortSignal;
}

const LIMITE_POR_OMISSAO_MS = 30_000;

/** Os cabeçalhos que o SDK nunca deixa passar: a autenticação é só a `chave`. */
function validarCabecalhos(
  cabecalhos: Record<string, string> | undefined,
  loja: boolean,
) {
  for (const [nome, valor] of Object.entries(cabecalhos ?? {})) {
    if (nome.toLowerCase() === "authorization") {
      throw new ErroDoSdk(
        "cabeçalhos: «authorization» não se passa à mão; use a opção `chave`",
      );
    }
    if (loja && valor.includes("eul_sk_")) {
      throw new ErroDoSdk(
        `cabeçalhos: o valor de «${nome}» parece uma chave de servidor, que não vai para a Loja`,
      );
    }
  }
}

function juntarUrl(base: string, modelo: string, pedido: PedidoGenerico) {
  const caminho = modelo.replace(/\{([^}]+)\}/g, (_todo, nome: string) => {
    const valor = pedido.caminho?.[nome];
    if (valor === undefined) {
      throw new ErroDoSdk(
        `falta o parâmetro de caminho «${nome}» em ${modelo}`,
      );
    }
    if (valor === "" || valor === "." || valor === "..") {
      throw new ErroDoSdk(`parâmetro de caminho «${nome}» inválido`);
    }
    return encodeURIComponent(valor);
  });
  const procura = new URLSearchParams();
  for (const [nome, valor] of Object.entries(pedido.consulta ?? {})) {
    if (valor === undefined) continue;
    for (const v of Array.isArray(valor) ? (valor as unknown[]) : [valor]) {
      procura.append(nome, String(v));
    }
  }
  const texto = procura.toString();
  return `${base}${caminho}${texto === "" ? "" : `?${texto}`}`;
}

async function lerCorpo(resposta: Response): Promise<unknown> {
  const texto = await resposta.text();
  if (texto === "") return undefined;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return undefined;
  }
}

/** O cliente fino, comum à Loja e à Administração. */
export function criarCliente<P>(
  opcoes: OpcoesDoCliente,
  { loja }: { loja: boolean },
): Cliente<P> {
  validarCabecalhos(opcoes.cabecalhos, loja);
  const base = opcoes.url.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) {
    throw new ErroDoSdk("url: tem de começar por http:// ou https://");
  }
  const global = (globalThis as { fetch?: typeof fetch }).fetch;
  const escolhido = opcoes.fetch ?? global?.bind(globalThis);
  if (escolhido === undefined) {
    throw new ErroDoSdk("não há `fetch` neste ambiente: passe-o em `fetch`");
  }
  const executar: typeof fetch = escolhido;
  const limiteMs = opcoes.limiteMs ?? LIMITE_POR_OMISSAO_MS;

  async function pedir(
    metodo: Metodo,
    modelo: string,
    pedido: PedidoGenerico = {},
  ): Promise<Resposta<unknown>> {
    validarCabecalhos(pedido.cabecalhos, loja);
    const url = juntarUrl(base, modelo, pedido);
    const cabecalhos = new Headers({ accept: "application/json" });
    for (const [nome, valor] of Object.entries(opcoes.cabecalhos ?? {})) {
      cabecalhos.set(nome, valor);
    }
    for (const [nome, valor] of Object.entries(pedido.cabecalhos ?? {})) {
      cabecalhos.set(nome, valor);
    }
    if (opcoes.chave !== undefined) {
      cabecalhos.set("authorization", `Bearer ${opcoes.chave}`);
    }
    if (opcoes.versao !== undefined) {
      cabecalhos.set("eurolify-versao", opcoes.versao);
    }
    if (pedido.idempotencia !== undefined) {
      cabecalhos.set("idempotency-key", pedido.idempotencia);
    }
    let corpo: string | undefined;
    if (pedido.corpo !== undefined) {
      cabecalhos.set("content-type", "application/json");
      corpo = JSON.stringify(pedido.corpo);
    }
    const tempo = AbortSignal.timeout(limiteMs);
    const sinal =
      pedido.sinal === undefined
        ? tempo
        : AbortSignal.any([tempo, pedido.sinal]);

    let resposta: Response;
    try {
      resposta = await executar(url, {
        method: metodo.toUpperCase(),
        headers: cabecalhos,
        ...(corpo === undefined ? {} : { body: corpo }),
        signal: sinal,
      });
    } catch (causa) {
      throw new ErroDeRede(metodo, modelo, causa);
    }

    let dados: unknown;
    try {
      dados = await lerCorpo(resposta);
    } catch (causa) {
      throw new ErroDeRede(metodo, modelo, causa);
    }
    if (!resposta.ok) {
      throw new ErroDaApi(
        resposta.status,
        lerProblema(dados),
        resposta.headers,
      );
    }
    // Um sucesso com corpo que não é JSON não é o que o contrato promete.
    if (
      dados === undefined &&
      resposta.status !== 204 &&
      resposta.headers.get("content-length") !== "0"
    ) {
      throw new ErroDoSdk(
        `${metodo.toUpperCase()} ${modelo}: a resposta ${String(resposta.status)} não é JSON; se era uma escrita, pode ter sido feita: repita com a mesma chave de idempotência`,
      );
    }
    return { dados, estado: resposta.status, cabecalhos: resposta.headers };
  }

  const metodos = (["get", "post", "put", "patch", "delete"] as const).map(
    (m) =>
      [
        m,
        (modelo: string, pedido?: PedidoGenerico) => pedir(m, modelo, pedido),
      ] as const,
  );
  return Object.fromEntries(metodos) as unknown as Cliente<P>;
}
