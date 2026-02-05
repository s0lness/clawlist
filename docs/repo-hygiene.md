# Repo Hygiene

This project keeps a clear boundary between public source and local runtime artifacts.

## Public Surface (Tracked)
- `src/`
- `tests/`
- `docs/`
- `config/*.example.json`
- stable scripts under `scripts/`

## Internal Kitchen (Untracked)
- runtime logs and artifacts: `logs/`, `runs/`, `clawlist-matrix-run/runs/`
- local Synapse state: `clawlist-matrix-run/synapse-data/`, `clawlist-matrix-run/synapse-data2/`
- local secrets and machine-specific config: `config/agent_*.json`, `config/scenario.local.json`, `*.env`, `*secrets.env`

## Local Scenario Workflow
1. Copy local template:
```bash
cp config/scenario.local.example.json config/scenario.local.json
```
2. Edit `config/scenario.local.json` for your machine.
3. Run scenario:
```bash
npm run scenario
```

## Commit Guard
Install once per clone:
```bash
npm run hooks:install
```

What the guard does (`scripts/precommit-check.sh`):
- blocks staged files from internal paths
- scans staged added lines for likely secrets/tokens
- allows known placeholders like `changeme`

You can run it manually:
```bash
npm run check:repo
```
