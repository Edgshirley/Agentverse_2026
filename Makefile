.PHONY: dev dev-down prod prod-down

# ============================================================================
# Friend Spreader (Spread) — Stack Lifecycle Makefile
# Targets:
#   make dev       - Start development stack (backend :4000, frontend :5173, seed)
#   make dev-down  - Stop development stack
#   make prod      - Start production stack (backend :4000, frontend :3000)
#   make prod-down - Stop production stack
# ============================================================================

dev:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
		docker compose -f docker-compose.dev.yml up --build; \
	else \
		echo "[make dev] Docker daemon not detected — starting local dev stack (:4000 + :5173)..."; \
		$(MAKE) dev-down >/dev/null 2>&1 || true; \
		(cd backend && [ -d node_modules ] || npm install --no-audit); \
		(cd frontend && [ -d node_modules ] || npm install --no-audit); \
		(cd backend && nohup npm run dev </dev/null > /tmp/spread-backend-dev.log 2>&1 & echo $$! > /tmp/spread-backend-dev.pid); \
		API_BASE_URL=http://localhost:4000 python3 backend/scripts/seed_dev.py; \
		(cd frontend && nohup npm run dev </dev/null > /tmp/spread-frontend-dev.log 2>&1 & echo $$! > /tmp/spread-frontend-dev.pid); \
		echo "========================================================================"; \
		echo "SPREAD DEV STACK RUNNING:"; \
		echo "  -> Frontend UI: http://localhost:5173"; \
		echo "  -> Backend API: http://localhost:4000/api/state"; \
		echo "  -> Stop with:   make dev-down (or Ctrl+C)"; \
		echo "========================================================================"; \
		tail -f /tmp/spread-backend-dev.log /tmp/spread-frontend-dev.log; \
	fi

dev-down:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
		docker compose -f docker-compose.dev.yml down; \
	fi
	@if [ -f /tmp/spread-frontend-dev.pid ]; then kill $$(cat /tmp/spread-frontend-dev.pid) 2>/dev/null || true; rm -f /tmp/spread-frontend-dev.pid; fi
	@if [ -f /tmp/spread-backend-dev.pid ]; then kill $$(cat /tmp/spread-backend-dev.pid) 2>/dev/null || true; rm -f /tmp/spread-backend-dev.pid; fi
	@lsof -ti:5173,4000 | xargs kill -9 2>/dev/null || true
	@echo "[make dev-down] Dev stack stopped."

prod:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
		docker compose -f docker-compose.prod.yml up --build -d; \
	else \
		echo "[make prod] Docker daemon not detected — starting local prod stack (:4000 + :3000)..."; \
		$(MAKE) prod-down >/dev/null 2>&1 || true; \
		(cd backend && ([ -d node_modules ] || npm install --no-audit) && npm run build && nohup npm run start </dev/null > /tmp/spread-backend-prod.log 2>&1 & echo $$! > /tmp/spread-backend-prod.pid); \
		(cd frontend && ([ -d node_modules ] || npm install --no-audit) && npm run build && nohup npm run preview </dev/null > /tmp/spread-frontend-prod.log 2>&1 & echo $$! > /tmp/spread-frontend-prod.pid); \
		echo "========================================================================"; \
		echo "SPREAD PROD STACK RUNNING:"; \
		echo "  -> Frontend UI: http://localhost:3000"; \
		echo "  -> Backend API: http://localhost:4000/api/state"; \
		echo "  -> Stop with:   make prod-down"; \
		echo "========================================================================"; \
	fi

prod-down:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
		docker compose -f docker-compose.prod.yml down; \
	fi
	@if [ -f /tmp/spread-frontend-prod.pid ]; then kill $$(cat /tmp/spread-frontend-prod.pid) 2>/dev/null || true; rm -f /tmp/spread-frontend-prod.pid; fi
	@if [ -f /tmp/spread-backend-prod.pid ]; then kill $$(cat /tmp/spread-backend-prod.pid) 2>/dev/null || true; rm -f /tmp/spread-backend-prod.pid; fi
	@lsof -ti:3000,4000 | xargs kill -9 2>/dev/null || true
	@echo "[make prod-down] Prod stack stopped."
