import express, { type Express } from "express";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { criarServidorMcp } from "./ferramentas.js";
import type { AutorizacaoGitHub } from "./oauth.js";
import type { FilaDePedidos } from "./pedidos.js";

export interface ConfigApp {
  urlPublico: string;
  autorizacao: AutorizacaoGitHub;
  fila: FilaDePedidos;
}

/** A aplicação HTTP do MCP: OAuth, /mcp protegido e /health. */
export function criarApp({
  urlPublico,
  autorizacao,
  fila,
}: ConfigApp): Express {
  const app = express();
  // Só o nginx da própria máquina fala com este processo, mas o contentor
  // vê-o pela ponte do Docker, não por 127.0.0.1: confia-se no primeiro salto
  // (revisão do #30), senão os limites por IP do SDK eram um só para todos.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  const urlMcp = new URL(`${urlPublico}/mcp`);

  app.get("/health", (_req, res) => {
    res.json({ estado: "ok" });
  });

  app.use(
    mcpAuthRouter({
      provider: autorizacao,
      issuerUrl: new URL(urlPublico),
      resourceServerUrl: urlMcp,
      scopesSupported: ["eurolify"],
      resourceName: "Eurolify — ensaio",
    }),
  );

  app.get("/oauth/github/callback", (req, res, next) => {
    autorizacao.retornoGitHub(req, res).catch(next);
  });

  const exigirToken = requireBearerAuth({
    verifier: autorizacao,
    requiredScopes: ["eurolify"],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(urlMcp),
  });

  app.post(
    "/mcp",
    express.json({ limit: "64kb" }),
    exigirToken,
    async (req, res) => {
      const login =
        typeof req.auth?.extra?.["login"] === "string"
          ? req.auth.extra["login"]
          : "?";
      const servidor = criarServidorMcp(fila, () => login);
      // Sem sessões: cada pedido HTTP é independente; resposta em JSON simples.
      const transporte = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transporte.close();
        void servidor.close();
      });
      await servidor.connect(transporte);
      await transporte.handleRequest(req, res, req.body);
    },
  );

  app.all("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").json({ erro: "só POST" });
  });

  return app;
}
