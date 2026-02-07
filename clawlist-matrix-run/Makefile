.PHONY: build up down bootstrap scenario sweep cleanup live-start live-stop live-status live-populate live-agents live-agents-start live-agents-stop live-agents-status

# Build TypeScript first
build:
	npm run build

# Docker/Infrastructure
up: build
	node dist/cli-up.js

down:
	node dist/cli-down.js

bootstrap: build
	node dist/cli-bootstrap.js

cleanup:
	@echo "[cleanup] TypeScript migration: cleanup handled by gateway.ts"
	@# Old bash cleanup is no longer needed

# Scenario testing
SCENARIO ?= switch_basic
RUN_ID ?= $(shell date +%Y%m%d_%H%M%S)
DURATION_SEC ?= 120
N ?= 10

scenario: build
	DURATION_SEC=$(DURATION_SEC) RUN_ID=$(RUN_ID) node dist/run-scenario.js $(SCENARIO)

sweep: build
	node dist/sweep.js $(SCENARIO) $(N)

# Live sandbox mode (kept bash for now - will migrate later)
POPULATE ?= 0
SELLERS ?= 3
BUYERS ?= 2

live-start:
	POPULATE=$(POPULATE) ./lab/live_start.sh

live-stop:
	./lab/live_stop.sh

live-status:
	./lab/live_status.sh

live-populate:
	./lab/populate_market.sh $(N)

# Live agents with behaviors
live-agents:
	./lab/live_agents.sh status

live-agents-start:
	./lab/live_agents.sh start $(SELLERS) $(BUYERS)

live-agents-stop:
	./lab/live_agents.sh stop

live-agents-status:
	./lab/live_agents.sh status

# Legacy human-seller mode (kept bash for now)
human-seller:
	RUN_ID=$(RUN_ID) DURATION_SEC=$(DURATION_SEC) ./lab/run_human_seeded_seller.sh
