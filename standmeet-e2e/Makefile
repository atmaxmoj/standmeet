# Load secrets from standmeet-server/.env (CLAUDE_CODE_OAUTH_TOKEN etc.)
-include ../standmeet-server/.env
export

COMPOSE := docker compose -p standmeet-test -f docker-compose.test.yml

.PHONY: test test-real test-all clean

# Mock mode (default) — no AI token consumed
# Usage: make test [FILE=layout.test.ts]
test:
	MOCK_AI=true PLAYWRIGHT_PROJECT=mock \
	$(COMPOSE) down -v --remove-orphans 2>/dev/null || true
	MOCK_AI=true PLAYWRIGHT_PROJECT=mock \
	$(COMPOSE) build
	MOCK_AI=true PLAYWRIGHT_PROJECT=mock PLAYWRIGHT_FILE=$(FILE) \
	$(COMPOSE) run --build --rm test-e2e; \
	rc=$$?; \
	$(COMPOSE) logs --tail=200 > logs/test-run.log 2>&1 || true; \
	$(COMPOSE) down -v --remove-orphans 2>/dev/null || true; \
	exit $$rc

# Real AI mode — consumes API tokens
test-real:
	MOCK_AI=false PLAYWRIGHT_PROJECT=real-ai \
	$(COMPOSE) down -v --remove-orphans 2>/dev/null || true
	MOCK_AI=false PLAYWRIGHT_PROJECT=real-ai \
	$(COMPOSE) build
	MOCK_AI=false PLAYWRIGHT_PROJECT=real-ai \
	$(COMPOSE) run --build --rm test-e2e; \
	rc=$$?; \
	$(COMPOSE) logs --tail=200 > logs/test-run.log 2>&1 || true; \
	$(COMPOSE) down -v --remove-orphans 2>/dev/null || true; \
	exit $$rc

# Run both mock and real-ai projects
test-all:
	$(MAKE) test
	$(MAKE) test-real

clean:
	$(COMPOSE) down -v --remove-orphans 2>/dev/null || true
