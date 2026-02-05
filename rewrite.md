# Rewrite Plan: Emergent, Raw-Message Agents (Gateway First)

## Why We’re Going This Way
The previous approach leaned toward a structured protocol (explicit message types, schemas, and transport-specific flows). That made interoperability clearer but risked stifling emergent behavior.

This rewrite flips the priority:
- Maximize emergence by keeping messages free-form.
- Let agents infer intent and negotiate via LLM reasoning.
- Keep transport concerns minimal and interchangeable.

In short: we’re moving from “protocol-first” to “emergent-first” because discovery and negotiation should evolve naturally rather than be constrained by a fixed dictionary.

## Goal
Start fresh with a transport-agnostic, minimal “non-protocol” that maximizes emergent behavior. Messages are free-form text; structure is optional and inferred by agents. Use Matrix/Synapse as the first transport.

## Core Principles
- No fixed message types.
- Messages are raw text + metadata (who/when/where).
- Agents infer intent, match, and negotiate using LLM reasoning.
- Transport is interchangeable; Matrix first, other transports later.

## Phase 1: Skeleton + Matrix (Fast Feedback)
- [x] New repo layout focused on raw message flow.
- [x] Implement a Matrix bridge:
  - [x] Join a public gossip room.
  - [x] Join a private DM room.
- [x] Define a single normalized event shape (metadata only):
  - [x] `{ ts, channel, from, to?, body, transport }`
- [x] Logging: append raw events to `logs/events.jsonl`.

## Phase 2: Agent Runtime (LLM-Driven)
- [ ] Agent connects to Matrix rooms.
- [ ] On receiving a message, agent uses LLM inference to decide:
  - [ ] Is this a potential match?
  - [ ] Should I reply publicly or via DM?
- [ ] Minimal policy loop:
  - [ ] `observe → decide → send`.
- [ ] No strict schemas; any structure is optional hints inside the text.
Note: In the OpenClaw-first deployment, OpenClaw runs externally and logs into Matrix. The built-in agent can be passive (`policy: none`) or use the basic heuristic for local testing.

## Phase 3: Matching/Negotiation Behavior (Emergent)
- [ ] Add a simple LLM prompt that:
  - [ ] Extracts implicit intent (buy/sell/barter/etc.).
  - [ ] Decides whether to initiate contact.
  - [ ] Produces a reply in plain language.
- [ ] Keep it permissive; do not enforce fields or strict templates.

## Phase 4: Transport Abstraction
- [x] Introduce a transport interface.
- [x] Matrix is the first adapter.

## Phase 5: Docs + Examples
- [ ] README centered on emergent behavior and raw-message design.
- [ ] Provide a few example transcripts (buy/sell, barter, coalition).

## Success Criteria
- [ ] Agents can discover matches and initiate conversations without any hard schema.
- [x] Logs are human-readable and replayable.
- [ ] Adding a new transport does not change agent behavior.

## Quality Improvements (Rating Uplift)
These are the concrete steps to move the repo from a vibecoded MVP to a durable prototype.

### Tier 1: Immediate, High ROI
- [x] Add a minimal test suite:
  - [x] config validation
  - [x] log redaction behavior
  - [x] matrix event normalization
- [x] Safer security defaults:
  - [x] avoid persisting access tokens by default
  - [x] document config handling and non-commit guidance
- [x] Observability:
  - [x] structured logs with levels
  - [x] include room IDs and event IDs
- [x] Formal config schema (Zod or JSON Schema) to fail fast on errors

### Tier 2: Operational Hardening
- [x] Webhook reliability:
  - [x] timeouts, bounded retries, and queueing
- [x] Graceful shutdown:
  - [x] clean stop on SIGINT/SIGTERM
  - [x] flush logs and in-flight requests
- [x] Rate limiting and de-duplication:
  - [x] avoid event storms and duplicate processing
- [ ] Error hygiene:
  - [ ] clearer CLI errors with actionable messages

### Tier 3: Product Shape
- [x] Multi-recipient DM routing (per-sender or per-intent, not a single DM room)
- [x] Transport contract tests with a mock transport
- [x] Architecture doc and example flows
- [x] Packaging convenience: `npm run dev`, single `start` entry, and example config templates

## Changes Started (Immediate Fixes)
- [x] DM logs now record a real recipient (via `--to` or `dm_recipient`).
- [x] Config validation added (required fields + type checks).
- [x] JSON Schema added for config (`config/agent.schema.json`).
- [x] Test suite added (config validation, log redaction, matrix normalization).
- [x] Optional `persist_access_token` flag to avoid writing tokens to disk.
- [x] OpenClaw webhook timeout support (`openclaw_timeout_ms`).
- [x] `setup` now guards against mismatched alias domains.
- [x] Webhook queueing + bounded retries (`openclaw_queue_max`, `openclaw_retry_*`).
- [x] Graceful shutdown on SIGINT/SIGTERM with queue drain.
- [x] Rate limiting + dedupe for OpenClaw notifications.
- [x] Multi-recipient DM routing via `dm_rooms` and `dm_room_ids`.
- [x] Transport contract test with a mock transport.
- [x] Architecture and flow docs (`docs/architecture.md`, `docs/flows.md`).
- [x] Convenience scripts: `npm run start`, `npm run dev`.
