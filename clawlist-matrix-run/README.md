# Clawlist Matrix Lab (persistent Synapse + Element) + Scenario Harness

This folder contains two related ways to work:

1) **Persistent Matrix lab** (recommended): keep Synapse + Element running, then spawn agents/runs.
2) Legacy `run.sh` harness (older, more brittle).

## Persistent lab (recommended)

### Start the lab infra (local-only)

```bash
cd clawlist-matrix-run
./lab/up.sh
```

- Synapse: http://127.0.0.1:18008
- Element UI: http://127.0.0.1:18080

### Bootstrap stable users + stable market room

```bash
./lab/bootstrap.sh
```

This ensures:
- users: `@switch_seller:localhost`, `@switch_buyer:localhost`
- stable room: `#market:localhost`
- writes local-only files (gitignored):
  - `.local/secrets.env` (Matrix access tokens)
  - `.local/bootstrap.env` (room IDs, MXIDs)

### Run a scenario

There are two ways to run:

#### 1) Basic end-to-end (hardcoded)

```bash
RUN_ID=$(date +%Y%m%d_%H%M%S) DURATION_SEC=120 ./lab/run_scenario_basic.sh
```

#### 2) Scenario-driven (recommended)

Scenarios live in `scenarios/*.json`.

```bash
RUN_ID=$(date +%Y%m%d_%H%M%S) DURATION_SEC=120 ./lab/run_scenario.sh switch_basic
```

Both modes:
- configure Matrix mention-gating (prevents runaway bot loops)
- spawn seller+buyer gateways
- create a **per-run DM room** and write `runs/<runId>/out/meta.json` (`dmRoomId`)
- inject missions + seed a listing in `#market:localhost`
- stop gateways after `DURATION_SEC` (circuit breaker)
- export transcripts + write `runs/<runId>/out/summary.json`

Watch live in Element: join `#market:localhost`.

### Clean up stuck ports (if needed)

```bash
./lab/cleanup_ports.sh
```

## Legacy: one-shot harness

```bash
./run.sh
```

## Sweeps (batch runs)

Run a batch and get an aggregate success rate:

```bash
# 10 runs of switch_basic
./lab/sweep.sh switch_basic 10

# results + aggregate under runs/<sweepId>/
ls -la runs/sweep_*/
cat runs/sweep_*/aggregate.json
```

## Outputs

Per-run artifacts live under:
- `runs/<runId>/out/market.jsonl`
- `runs/<runId>/out/dm.jsonl`
- `runs/<runId>/out/meta.json`
- `runs/<runId>/out/summary.json`

Sweep artifacts live under:
- `runs/<sweepId>/results.jsonl`
- `runs/<sweepId>/aggregate.json`
