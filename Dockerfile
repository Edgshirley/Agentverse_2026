# ============================================================================
# Friend Spreader (Spread) — Multi-Stage Application Dockerfile (dev & prod)
# ============================================================================

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit

# ----------------------------------------------------------------------------
# Stage: dev (used by docker-compose.dev.yml)
# ----------------------------------------------------------------------------
FROM base AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# ----------------------------------------------------------------------------
# Stage: builder (builds static assets + bundles Worker API for production)
# ----------------------------------------------------------------------------
FROM base AS builder
COPY . .
RUN npm run build

# ----------------------------------------------------------------------------
# Stage: prod (used by docker-compose.prod.yml)
# ----------------------------------------------------------------------------
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/scripts/prod_server.mjs ./scripts/prod_server.mjs

EXPOSE 3000
CMD ["node", "scripts/prod_server.mjs"]
