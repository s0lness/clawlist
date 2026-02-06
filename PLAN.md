# @clawlist — Persistent Matrix Lab + Eval Harness (Plan)

This plan turns the current `clawlist-matrix-run/` “single run” harness into a **persistent Matrix playground** with:
- a **UI** (Element Web) to watch rooms/DMs live
- **spawnable OpenClaw agent profiles** that can be attached/detached quickly
- one **Telegram-controlled agent** (fresh bot) for human-in-the-loop steering
- **repeatable scenario runs** with transcript export + scoring

## Decisions (locked in)
- UI: **Element Web** (Matrix client) ✅
- Telegram: **create a fresh bot**; treat token as a secret; **never commit or document credentials** ✅
- Network: **LOCAL ONLY** initially (bind services to `127.0.0.1`) ✅

---

## Guiding principles
- Split **persistent infra** (Synapse + Element + baseline rooms/users) from **episodic runs** (spawn agents, inject missions, export/score).
- All secrets are provided via **env vars** or a **local-only secrets file** (chmod 600) and are **gitignored**.
- Every episodic run produces a self-contained artifact bundle under `runs/<runId>/out/`.
- Prefer **determinism** over heuristics (explicit room IDs, explicit run IDs).

## Standard paths (to reduce ambiguity)
- Matrix bootstrap secrets (gitignored): `clawlist-matrix-run/.local/secrets.env`
- Per-run artifacts: `clawlist-matrix-run/runs/<runId>/out/`
- Per-run summary: `clawlist-matrix-run/runs/<runId>/out/summary.json`

## Artifact safety / redaction rules
- Never write credentials to tracked files, docs, or logs.
- `meta.json` must **not** contain raw access tokens (mask if present).
- `summary.json` must never include secrets.
- Treat transcripts (`*.jsonl`) as sensitive (they may include IDs/content you don’t want public).

---

## Checklist

### Phase 0 — Repo hygiene + secrets safety
Status: ✅ done (commit `ef9707c`)
- [x] Add/update `.gitignore` to ensure these are never committed:
  - `**/secrets.env`
  - `**/*.token`
  - `**/.env`
  - `clawlist-matrix-run/.local/`
  - `clawlist-matrix-run/runs/`
  - any Matrix synapse data dirs (`synapse-data*/`)
- [x] Add a short `SECURITY.md` (no secrets, just rules): tokens never committed; use local env files.
- [x] Ensure all scripts that write secrets do `umask 077` and `chmod 600`.

### Phase 1 — Persistent infra: Synapse + Element Web (local-only)
Goal: start infra rarely; keep it running.

Status: ✅ done (commit `f40067e`)
- [x] Create `infra/docker-compose.yml` that runs:
  - Synapse (persisted volume = existing `synapse-data2/`)
  - Element Web
- [x] Bind ports to **127.0.0.1** only (explicitly, e.g. `127.0.0.1:18008:8008`, not `0.0.0.0`).
- [x] Add `infra/element-config.json` pointing Element to `http://127.0.0.1:18008`.
- [x] Add `lab/up.sh`:
  - starts compose
  - waits for `/_matrix/client/versions`
  - prints UI URL (expected: Element at `http://127.0.0.1:18080`, Synapse at `http://127.0.0.1:18008`)
- [x] Add `lab/down.sh` (optional; should not delete volumes).

Notes:
- Synapse runs as `${UID}:${GID}` in compose to avoid WSL volume permission errors.
- We enabled Synapse room directory publication locally by adding `room_list_publication_rules: [{action: allow}]` to `synapse-data2/homeserver.yaml` (local-only, gitignored).

Definition of Done:
- `./lab/up.sh` exits 0.
- `curl -fsS http://127.0.0.1:18008/_matrix/client/versions` succeeds.
- Element loads at `http://127.0.0.1:18080` and shows the login screen, configured against `http://127.0.0.1:18008`.

### Phase 2 — Persistent bootstrap (baseline users + stable rooms)
Goal: stop creating per-run market rooms by default.

Status: ✅ done (commit `650776e`)
- [x] Add `lab/bootstrap.sh` (idempotent):
  - ensures synapse is up
  - ensures baseline users exist (e.g. `switch_seller`, `switch_buyer`, plus future)
  - ensures stable room alias exists: `#market:localhost`
  - ensures buyer is joined
  - writes tokens to `clawlist-matrix-run/.local/secrets.env` (gitignored, chmod 600)
  - writes room metadata to `clawlist-matrix-run/.local/bootstrap.env` (chmod 600)
  - grants `@admin:localhost` PL=100 in `#market:localhost`
  - publishes `#market:localhost` to the directory

Notes:
- Matrix token caching to `.local/secrets.env` was added to avoid Synapse `/login` 429s (commit `2bb1e31`).
- `bootstrap_matrix.sh` now supports `SYNAPSE_CONTAINER` for the persistent Synapse container name (commit `a4b9b1b`).

Notes:
- For now, keep easy registration because we’re **local-only**.

Definition of Done:
- Element shows `#market:localhost` and both baseline users can post.
- `clawlist-matrix-run/.local/secrets.env` exists with mode 600.

### Phase 3 — Spawnable agents attached to the lab
Goal: treat agents as ephemeral processes.

Status: ✅ done (commit `ba0f4b2`; spawn readiness fix `d3429c3`)
- [x] Add `lab/spawn_gateway.sh` (spawns `openclaw --profile <name> gateway run`, writes logs under `runs/<runId>/out/`).
- [x] Add `lab/connect_matrix.sh` (configures Matrix channel for the profile using `.local/{bootstrap,secrets}.env`).
- [x] Add `lab/mission.sh` (injects a system event into the profile gateway).
- [x] Add `lab/seed_market.sh` (posts a deterministic listing into `#market:localhost`).
- [x] Add `lab/run_scenario_basic.sh` (MVP orchestrator: connect, spawn, mission, seed).

Known issues / next hardening:
- Need a stronger stop/cleanup story to avoid leaving stray gateways running.
- Add mention-gating / message-rate circuit breaker to prevent runaway bot loops in `#market`.

Definition of Done:
- Within 30s of running the scripts, both seller and buyer profiles visibly post into `#market:localhost` (seen in Element).

### Phase 4 — Telegram-controlled agent (fresh bot)
Goal: one agent can be steered by you via Telegram while it participates in Matrix.

Status: ✅ done (commit `fa12247` + local-only setup)
- [x] Create a new Telegram bot via BotFather (token kept local-only).
- [x] Telegram-controlled profile name: `operator-bot`.
- [x] Configure Telegram channel for that profile in a **local-only config step**:
  - token stored locally (not in repo)
  - DM allowlist restricted to Sylve
- [x] Ensure the same profile also has Matrix enabled and is allowed in `#market:localhost`.

Notes:
- Token is stored locally (gitignored) under `.local/` with mode 600.
- Telegram is also working for progress pings via the main gateway.

Definition of Done:
- You DM the Telegram bot and see the agent respond and/or change behavior in Matrix.

### Phase 5 — Transcript export (robust in persistent world)
Goal: exports keep working even with many rooms/history.

Decision:
- We create a **dedicated per-run DM room** explicitly and store its `room_id` in `meta.json`.

Status: ✅ done (commit `f4a67c2`)
- [x] `lab/create_dm_room.sh` creates a private DM room and writes `runs/<runId>/out/meta.json` with `dmRoomId`.
- [x] Export uses `meta.dmRoomId` deterministically (no heuristics).
- [x] `lab/export_run.sh` writes:
  - `runs/<runId>/out/market.jsonl`
  - `runs/<runId>/out/dm.jsonl`

Definition of Done:
- Export always includes the correct DM room for the run.

### Phase 6 — Evaluation scoring
Goal: measurable outcomes and regressions.

Status: ✅ done (commit `5322316`; hardening `fd6196c`)
- [x] `eval/score_run.mjs` reads exported JSONLs + meta and writes `summary.json`.
- [x] `lab/score.sh` wrapper.
- [x] Hardening: ignore DM messages not from buyer/seller and flag `metrics.humanIntervention` (commit `fd6196c`).

Definition of Done:
- `summary.json` exists and can fail a run for hard violations.

### Phase 7 — Scenarios + sweeps
Goal: repeatable benchmarks.

Status: ✅ done (commit `d0d276e`; docs `3a6f824`)
- [x] `scenarios/*.json` (starting with `switch_basic.json`).
- [x] `lab/run_scenario.sh <scenarioName>` orchestrator (runs full pipeline: spawn → mission → seed → stop → export → score).
- [x] `lab/sweep.sh <scenarioName> <N>` runs a batch and writes an aggregate JSON.

Acceptance:
- You can run 10 scenarios and get an aggregate success rate.

### Phase 8 — Dev ergonomics
- [ ] Add a single entrypoint (pick one):
  - Option A: `Makefile` targets
  - Option B: `lab/lab.sh up|bootstrap|scenario|sweep|export|score`
- [ ] If using Makefile, include:
  - `make up`, `make bootstrap`, `make scenario SCENARIO=switch_basic`, `make sweep`
- [ ] Add `runs/latest` symlink for convenience.
- [ ] Optional: lightweight CI (only if desired) to run one short scenario.

Definition of Done:
- A new run can be executed with one command and produces `runs/<runId>/out/summary.json`.

---

## Operating mode (day-to-day)
1) `make up` (rare)
2) `make bootstrap` (rare)
3) Open Element UI and keep it open
4) For experiments:
   - `make scenario SCENARIO=...`
   - watch in Element
   - optionally steer the operator via Telegram
   - inspect `runs/<runId>/out/summary.json`

---

## Non-goals (for now)
- LAN exposure / TLS / hardening (we can revisit once local lab is stable)
- Public deployments

