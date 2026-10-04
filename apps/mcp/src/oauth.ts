import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Servidor de autorização do MCP (ADR-0033): o próprio MCP é o servidor
 * OAuth (registo dinâmico, PKCE S256 — o SDK valida o PKCE), e o login faz-se
 * no GitHub. Só entram as contas da lista, pelo número da conta no GitHub (o
 * nome pode mudar e ficar livre para outro); tudo o resto é recusado.
 *
 * Tudo em memória: reiniciar o contentor obriga a voltar a ligar o connector.
 */

const MINUTO = 60_000;
const VALIDADE_PEDIDO_GITHUB = 10 * MINUTO;
const VALIDADE_CODIGO = 5 * MINUTO;
const VALIDADE_ACESSO = 60 * MINUTO;
const VALIDADE_RENOVACAO = 30 * 24 * 60 * MINUTO;
const MAXIMO_CLIENTES = 100;
const MAXIMO_PEDIDOS_GITHUB = 1000;

/**
 * Só se registam clientes que devolvem ao Claude (revisão do #30): sem isto,
 * qualquer um registava um endereço seu e mandava o link de login a quem tem
 * acesso — o código ia parar-lhe às mãos.
 */
export const RETORNOS_PERMITIDOS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);

export interface ConfigOAuth {
  urlPublico: string;
  githubClientId: string;
  githubClientSecret: string;
  /** Números das contas no GitHub (o `id` de `GET /user`). */
  contasPermitidas: number[];
  agora?: () => number;
}

interface PedidoGitHub {
  clientId: string;
  params: AuthorizationParams;
  criado: number;
}

interface Conta {
  id: number;
  login: string;
}

interface Codigo {
  clientId: string;
  desafio: string;
  redirectUri: string;
  conta: Conta;
  expira: number;
}

interface Token {
  clientId: string;
  conta: Conta;
  expira: number;
}

function segredo(): string {
  return randomBytes(32).toString("hex");
}

class ClientesEmMemoria implements OAuthRegisteredClientsStore {
  readonly clientes = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clientes.get(clientId);
  }

  registerClient(
    cliente: Omit<
      OAuthClientInformationFull,
      "client_id" | "client_id_issued_at"
    >,
  ): OAuthClientInformationFull {
    const retornos = cliente.redirect_uris.map(String);
    if (
      retornos.length === 0 ||
      !retornos.every((r) => RETORNOS_PERMITIDOS.has(r))
    ) {
      throw new InvalidClientMetadataError(
        "só se aceitam os endereços de retorno do Claude",
      );
    }
    // O registo é aberto (a especificação pede-o); limitar o número evita que
    // alguém encha a memória. Os mais antigos saem primeiro.
    if (this.clientes.size >= MAXIMO_CLIENTES) {
      const maisAntigo = this.clientes.keys().next().value;
      if (maisAntigo !== undefined) this.clientes.delete(maisAntigo);
    }
    const completo: OAuthClientInformationFull = {
      ...cliente,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clientes.set(completo.client_id, completo);
    return completo;
  }
}

export class AutorizacaoGitHub implements OAuthServerProvider {
  readonly clientsStore = new ClientesEmMemoria();
  private readonly pedidosGitHub = new Map<string, PedidoGitHub>();
  private readonly codigos = new Map<string, Codigo>();
  private readonly acessos = new Map<string, Token>();
  private readonly renovacoes = new Map<string, Token>();
  private readonly contas: Set<number>;
  private readonly agora: () => number;

  constructor(private readonly config: ConfigOAuth) {
    this.contas = new Set(config.contasPermitidas);
    this.agora = config.agora ?? Date.now;
  }

  get urlRetornoGitHub(): string {
    return `${this.config.urlPublico}/oauth/github/callback`;
  }

  authorize(
    cliente: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    this.limpar();
    if (this.pedidosGitHub.size >= MAXIMO_PEDIDOS_GITHUB) {
      res.status(503).type("text/plain").send("Demasiados logins em curso.");
      return Promise.resolve();
    }
    const estado = segredo();
    this.pedidosGitHub.set(estado, {
      clientId: cliente.client_id,
      params,
      criado: this.agora(),
    });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.config.githubClientId);
    url.searchParams.set("redirect_uri", this.urlRetornoGitHub);
    url.searchParams.set("state", estado);
    url.searchParams.set("allow_signup", "false");
    // Pede sempre a escolha da conta: um login nunca passa sem a pessoa ver.
    url.searchParams.set("prompt", "select_account");
    res.redirect(302, url.toString());
    return Promise.resolve();
  }

  /** Volta do GitHub: troca o código pela conta e só deixa passar a lista. */
  async retornoGitHub(req: Request, res: Response): Promise<void> {
    const estado =
      typeof req.query["state"] === "string" ? req.query["state"] : "";
    const codigoGitHub =
      typeof req.query["code"] === "string" ? req.query["code"] : "";
    const pedido = this.pedidosGitHub.get(estado);
    this.pedidosGitHub.delete(estado);
    if (
      !pedido ||
      this.agora() - pedido.criado > VALIDADE_PEDIDO_GITHUB ||
      !codigoGitHub
    ) {
      res
        .status(400)
        .type("text/plain")
        .send("Pedido de login inválido ou expirado.");
      return;
    }

    const destino = new URL(pedido.params.redirectUri);
    if (pedido.params.state !== undefined)
      destino.searchParams.set("state", pedido.params.state);

    let conta: Conta | undefined;
    try {
      conta = await this.contaNoGitHub(codigoGitHub);
    } catch {
      conta = undefined;
    }

    if (!conta || !this.contas.has(conta.id)) {
      console.warn(
        `oauth: login recusado (${conta ? "conta fora da lista" : "GitHub não confirmou"})`,
      );
      destino.searchParams.set("error", "access_denied");
      destino.searchParams.set(
        "error_description",
        "Conta sem acesso ao MCP do Eurolify.",
      );
      res.redirect(302, destino.toString());
      return;
    }

    const codigo = segredo();
    this.codigos.set(codigo, {
      clientId: pedido.clientId,
      desafio: pedido.params.codeChallenge,
      redirectUri: pedido.params.redirectUri,
      conta,
      expira: this.agora() + VALIDADE_CODIGO,
    });
    console.info(`oauth: login aceite (${conta.login}, ${String(conta.id)})`);
    destino.searchParams.set("code", codigo);
    res.redirect(302, destino.toString());
  }

  private async contaNoGitHub(codigo: string): Promise<Conta | undefined> {
    const troca = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: this.config.githubClientId,
        client_secret: this.config.githubClientSecret,
        code: codigo,
        redirect_uri: this.urlRetornoGitHub,
      }),
    });
    const corpo = (await troca.json()) as { access_token?: string };
    if (!troca.ok || !corpo.access_token) return undefined;

    const utilizador = await fetch("https://api.github.com/user", {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${corpo.access_token}`,
        "User-Agent": "eurolify-mcp",
      },
    });
    if (!utilizador.ok) return undefined;
    const dados = (await utilizador.json()) as {
      id?: unknown;
      login?: unknown;
    };
    if (typeof dados.id !== "number" || typeof dados.login !== "string")
      return undefined;
    return { id: dados.id, login: dados.login };
  }

  /** Tira o que já expirou (tudo vive em memória). */
  private limpar(): void {
    const agora = this.agora();
    for (const [chave, p] of this.pedidosGitHub)
      if (agora - p.criado > VALIDADE_PEDIDO_GITHUB)
        this.pedidosGitHub.delete(chave);
    for (const mapa of [this.codigos, this.acessos, this.renovacoes])
      for (const [chave, r] of mapa) if (r.expira < agora) mapa.delete(chave);
  }

  private codigoValido(
    cliente: OAuthClientInformationFull,
    codigo: string,
  ): Codigo {
    const registo = this.codigos.get(codigo);
    if (
      !registo ||
      registo.clientId !== cliente.client_id ||
      registo.expira < this.agora()
    ) {
      throw new InvalidGrantError("código de autorização inválido ou expirado");
    }
    return registo;
  }

  challengeForAuthorizationCode(
    cliente: OAuthClientInformationFull,
    codigo: string,
  ): Promise<string> {
    return Promise.resolve(this.codigoValido(cliente, codigo).desafio);
  }

  exchangeAuthorizationCode(
    cliente: OAuthClientInformationFull,
    codigo: string,
    _verificador?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const registo = this.codigoValido(cliente, codigo);
    this.codigos.delete(codigo); // um código só serve uma vez
    if (redirectUri !== undefined && redirectUri !== registo.redirectUri) {
      throw new InvalidGrantError("redirect_uri diferente do pedido");
    }
    return Promise.resolve(this.emitir(cliente.client_id, registo.conta));
  }

  exchangeRefreshToken(
    cliente: OAuthClientInformationFull,
    renovacao: string,
  ): Promise<OAuthTokens> {
    const registo = this.renovacoes.get(renovacao);
    this.renovacoes.delete(renovacao); // roda sempre (OAuth 2.1, clientes públicos)
    if (
      !registo ||
      registo.clientId !== cliente.client_id ||
      registo.expira < this.agora()
    ) {
      throw new InvalidGrantError("token de renovação inválido ou expirado");
    }
    if (!this.contas.has(registo.conta.id)) {
      throw new InvalidGrantError("conta sem acesso");
    }
    return Promise.resolve(this.emitir(cliente.client_id, registo.conta));
  }

  private emitir(clientId: string, conta: Conta): OAuthTokens {
    this.limpar();
    const acesso = segredo();
    const renovacao = segredo();
    this.acessos.set(acesso, {
      clientId,
      conta,
      expira: this.agora() + VALIDADE_ACESSO,
    });
    this.renovacoes.set(renovacao, {
      clientId,
      conta,
      expira: this.agora() + VALIDADE_RENOVACAO,
    });
    return {
      access_token: acesso,
      token_type: "bearer",
      expires_in: VALIDADE_ACESSO / 1000,
      refresh_token: renovacao,
      scope: "eurolify",
    };
  }

  verifyAccessToken(token: string): Promise<AuthInfo> {
    const registo = this.acessos.get(token);
    if (
      !registo ||
      registo.expira < this.agora() ||
      !this.contas.has(registo.conta.id)
    ) {
      return Promise.reject(
        new InvalidTokenError("token inválido ou expirado"),
      );
    }
    return Promise.resolve({
      token,
      clientId: registo.clientId,
      scopes: ["eurolify"],
      expiresAt: Math.floor(registo.expira / 1000),
      extra: { login: registo.conta.login },
    });
  }

  revokeToken(
    _cliente: OAuthClientInformationFull,
    pedido: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.acessos.delete(pedido.token);
    this.renovacoes.delete(pedido.token);
    return Promise.resolve();
  }
}
