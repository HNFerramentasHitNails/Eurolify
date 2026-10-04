import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
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
 * no GitHub. Só entram as contas da lista; tudo o resto é recusado.
 *
 * Tudo em memória: reiniciar o contentor obriga a voltar a ligar o connector.
 */

const MINUTO = 60_000;
const VALIDADE_PEDIDO_GITHUB = 10 * MINUTO;
const VALIDADE_CODIGO = 5 * MINUTO;
const VALIDADE_ACESSO = 60 * MINUTO;
const VALIDADE_RENOVACAO = 30 * 24 * 60 * MINUTO;
const MAXIMO_CLIENTES = 100;

export interface ConfigOAuth {
  urlPublico: string;
  githubClientId: string;
  githubClientSecret: string;
  contasPermitidas: string[];
  agora?: () => number;
}

interface PedidoGitHub {
  clientId: string;
  params: AuthorizationParams;
  criado: number;
}

interface Codigo {
  clientId: string;
  desafio: string;
  redirectUri: string;
  login: string;
  expira: number;
}

interface Token {
  clientId: string;
  login: string;
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
  private readonly contas: Set<string>;
  private readonly agora: () => number;

  constructor(private readonly config: ConfigOAuth) {
    this.contas = new Set(config.contasPermitidas.map((c) => c.toLowerCase()));
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
    res.redirect(302, url.toString());
    return Promise.resolve();
  }

  /** Volta do GitHub: troca o código pelo login e só deixa passar a lista. */
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

    let login: string | undefined;
    try {
      login = await this.loginNoGitHub(codigoGitHub);
    } catch {
      login = undefined;
    }

    if (!login || !this.contas.has(login.toLowerCase())) {
      console.warn(
        `oauth: login recusado (${login ? "conta fora da lista" : "GitHub não confirmou"})`,
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
      login,
      expira: this.agora() + VALIDADE_CODIGO,
    });
    console.info(`oauth: login aceite (${login})`);
    destino.searchParams.set("code", codigo);
    res.redirect(302, destino.toString());
  }

  private async loginNoGitHub(codigo: string): Promise<string | undefined> {
    const troca = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
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
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${corpo.access_token}`,
        "User-Agent": "eurolify-mcp",
      },
    });
    if (!utilizador.ok) return undefined;
    const dados = (await utilizador.json()) as { login?: string };
    return dados.login;
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
    return Promise.resolve(this.emitir(cliente.client_id, registo.login));
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
    if (!this.contas.has(registo.login.toLowerCase())) {
      throw new InvalidGrantError("conta sem acesso");
    }
    return Promise.resolve(this.emitir(cliente.client_id, registo.login));
  }

  private emitir(clientId: string, login: string): OAuthTokens {
    const acesso = segredo();
    const renovacao = segredo();
    this.acessos.set(acesso, {
      clientId,
      login,
      expira: this.agora() + VALIDADE_ACESSO,
    });
    this.renovacoes.set(renovacao, {
      clientId,
      login,
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
      !this.contas.has(registo.login.toLowerCase())
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
      extra: { login: registo.login },
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
