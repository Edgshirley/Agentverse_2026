# ============================================================================
# Friend Spreader (Spread) — Backend Container Dockerfile (dev & prod)
# ============================================================================

FROM node:22-alpine AS base
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit

# ----------------------------------------------------------------------------
# Stage: dev (mounted with ./backend:/app in docker-compose.dev.yml)
# ----------------------------------------------------------------------------
FROM base AS dev
COPY . .
ENV PORT=4000
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ----------------------------------------------------------------------------
# Stage: builder
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
ENV PORT=4000
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts/run_server.mjs ./scripts/run_server.mjs
EXPOSE 4000
CMD ["node", "scripts/run_server.mjs"]
