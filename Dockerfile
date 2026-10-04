# Imagem do Eurolify: a API e o MCP da VPS (ADR-0033) na mesma imagem, para
# uma publicação actualizar os dois. Constrói-se no GitHub (ADR-0026), nunca na
# VPS. A imagem base está fixada pelo resumo: muda-se num pedido de alteração.
ARG NODE_IMAGEM=node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe

FROM ${NODE_IMAGEM} AS construir
RUN npm install -g pnpm@12.9.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --frozen-lockfile --filter @eurolify/api... --filter @eurolify/mcp...
COPY apps/api apps/api
COPY apps/mcp apps/mcp
RUN pnpm --filter @eurolify/api --filter @eurolify/mcp run construir

FROM ${NODE_IMAGEM} AS dependencias
RUN npm install -g pnpm@12.9.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --frozen-lockfile --prod --filter @eurolify/api... --filter @eurolify/mcp...

FROM ${NODE_IMAGEM}
ENV NODE_ENV=production \
    ANFITRIAO=0.0.0.0 \
    PORTA=8080
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY --from=dependencias /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=dependencias /app/apps/mcp/node_modules ./apps/mcp/node_modules
COPY --from=construir /app/apps/api/dist ./apps/api/dist
COPY --from=construir /app/apps/mcp/dist ./apps/mcp/dist
COPY apps/api/package.json ./apps/api/
COPY apps/mcp/package.json ./apps/mcp/
WORKDIR /app/apps/api
USER node
EXPOSE 8080
# A verificação de saúde é a da API; o contentor do MCP arranca sem ela
# (--no-healthcheck) e é vigiado pelo eurolify-verificacao.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/servidor.js"]
