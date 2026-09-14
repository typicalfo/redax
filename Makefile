# redax — local photo privacy (Vite + React)
# Run `make` or `make help` to list targets.

NPM ?= npm
DIST ?= dist

.DEFAULT_GOAL := help

.PHONY: help install dev build preview clean clean-all reinstall check ci

help: ## List all targets
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} \
		/^[a-zA-Z0-9_.-]+:.*?##/ { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@printf "\n"

install: ## Install npm dependencies
	$(NPM) install

dev: ## Start Vite dev server
	$(NPM) run dev

build: ## Production build into dist/
	$(NPM) run build

preview: ## Preview the production build locally
	$(NPM) run preview

check: build ## Verify the app builds (alias for build)
	@echo "check ok"

ci: install check ## Install deps and verify build (CI-friendly)

clean: ## Remove dist/ build output
	rm -rf $(DIST)

clean-all: clean ## Remove dist/ and node_modules/
	rm -rf node_modules

reinstall: clean-all install ## Wipe node_modules/ and reinstall

