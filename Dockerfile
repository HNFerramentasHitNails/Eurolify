# Imagem da API do Eurolify. Constrói-se no GitHub (ADR-0026), nunca na VPS.
# A imagem base está fixada pelo resumo: muda-se num pedido de alteração.
ARG NODE_IMAGEM=node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe

FROM ${NODE_IMAGEM} AS construir
RUN npm install -g pnpm@12.9.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @eurolify/api...
COPY apps/api apps/api
RUN pnpm --filter @eurolify/api run construir

FROM ${NODE_IMAGEM} AS dependencias
RUN npm install -g pnpm@12.9.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @eurolify/api...

FROM ${NODE_IMAGEM}
ENV NODE_ENV=production \
    ANFITRIAO=0.0.0.0 \
    PORTA=8080
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY --from=dependencias /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=construir /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/
WORKDIR /app/apps/api
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/servidor.js"]
