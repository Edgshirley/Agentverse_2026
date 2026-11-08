# ============================================================================
# MarketMate — Frontend Container Dockerfile (dev & prod)
# ============================================================================

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit

# ----------------------------------------------------------------------------
# Stage: dev (mounted with ./frontend:/app in docker-compose.dev.yml)
# ----------------------------------------------------------------------------
FROM base AS dev
COPY . .
EXPOSE 5173
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
FROM base AS prod
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/vite.config.ts ./vite.config.ts
EXPOSE 3000
CMD ["npm", "run", "preview"]
