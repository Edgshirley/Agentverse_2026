.PHONY: dev dev-down prod prod-down api-test

# ============================================================================
# MarketMate — Stack Lifecycle Makefile
# Targets:
#   make dev       - Start development stack (UI :5173, FastAPI :8000, Keycloak :8080,
#                    Postgres, Redis, internal rules engine, seed). Uses dev.env
#   make dev-down  - Stop development stack
#   make prod      - Start production stack (127.0.0.1: UI :3900, API :8900, Keycloak :8980). Uses prod.env
#   make prod-down - Stop production stack
# ============================================================================

dev:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
		mkdir -p spread-storage/shared; \
		docker compose --env-file dev.env -f docker-compose.dev.yml up --build; \
	else \
		echo "[make dev] Docker daemon not detected — starting engine-only local stack (:4000 + :5173, NO Keycloak/auth)..."; \
		$(MAKE) dev-down >/dev/null 2>&1 || true; \
		(cd backend && [ -d node_modules ] || npm install --no-audit); \
		(cd frontend && [ -d node_modules ] || npm install --no-audit); \
		(cd backend && nohup npm run dev </dev/null > /tmp/spread-backend-dev.log 2>&1 & echo $$! > /tmp/spread-backend-dev.pid); \
		API_BASE_URL=http://localhost:4000 python3 backend/scripts/seed_dev.py; \
		(cd frontend && nohup npm run dev </dev/null > /tmp/spread-frontend-dev.log 2>&1 & echo $$! > /tmp/spread-frontend-dev.pid); \
		echo "========================================================================"; \
		echo "MARKETMATE DEV STACK RUNNING:"; \
		echo "  -> Frontend UI: http://localhost:5173"; \
		echo "  -> Backend API: http://localhost:4000/api/state"; \
		echo "  -> Stop with:   make dev-down (or Ctrl+C)"; \
		echo "========================================================================"; \
		tail -f /tmp/spread-backend-dev.log /tmp/spread-frontend-dev.log; \
	fi

dev-down:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
		docker compose --env-file dev.env -f docker-compose.dev.yml down; \
	fi
	@if [ -f /tmp/spread-frontend-dev.pid ]; then kill $$(cat /tmp/spread-frontend-dev.pid) 2>/dev/null || true; rm -f /tmp/spread-frontend-dev.pid; fi
	@if [ -f /tmp/spread-backend-dev.pid ]; then kill $$(cat /tmp/spread-backend-dev.pid) 2>/dev/null || true; rm -f /tmp/spread-backend-dev.pid; fi
	@lsof -ti:5173,4000 | xargs kill -9 2>/dev/null || true
	@echo "[make dev-down] Dev stack stopped."

# Unit tests for the FastAPI service (no stack needed)
api-test:
	cd api && python3 -m pytest -q

# Production env file (copy prod.env.example); override with `make prod PROD_ENV=/path/prod.env`
PROD_ENV ?= prod.env
# LLM keys may also live in git-ignored secrets.env; when present it is read last.
PROD_ENV_FLAGS = --env-file $(PROD_ENV) $(if $(wildcard secrets.env),--env-file secrets.env)

prod:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
		docker compose $(PROD_ENV_FLAGS) -f docker-compose.prod.yml up --build -d; \
	else \
		echo "[make prod] Docker daemon not detected — starting local prod stack (:4000 + :3000)..."; \
		$(MAKE) prod-down >/dev/null 2>&1 || true; \
		(cd backend && ([ -d node_modules ] || npm install --no-audit) && npm run build && nohup npm run start </dev/null > /tmp/spread-backend-prod.log 2>&1 & echo $$! > /tmp/spread-backend-prod.pid); \
		(cd frontend && ([ -d node_modules ] || npm install --no-audit) && npm run build && nohup npm run preview </dev/null > /tmp/spread-frontend-prod.log 2>&1 & echo $$! > /tmp/spread-frontend-prod.pid); \
		echo "========================================================================"; \
		echo "MARKETMATE PROD STACK RUNNING:"; \
		echo "  -> Frontend UI: http://localhost:3000"; \
		echo "  -> Backend API: http://localhost:4000/api/state"; \
		echo "  -> Stop with:   make prod-down"; \
		echo "========================================================================"; \
	fi

prod-down:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
		docker compose $(PROD_ENV_FLAGS) -f docker-compose.prod.yml down; \
	fi
	@if [ -f /tmp/spread-frontend-prod.pid ]; then kill $$(cat /tmp/spread-frontend-prod.pid) 2>/dev/null || true; rm -f /tmp/spread-frontend-prod.pid; fi
	@if [ -f /tmp/spread-backend-prod.pid ]; then kill $$(cat /tmp/spread-backend-prod.pid) 2>/dev/null || true; rm -f /tmp/spread-backend-prod.pid; fi
	@lsof -ti:3000,4000 | xargs kill -9 2>/dev/null || true
	@echo "[make prod-down] Prod stack stopped."
