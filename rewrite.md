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
- New repo layout focused on raw message flow.
- Implement a Matrix bridge:
  - Join a public gossip room.
  - Join a private DM room.
- Define a single normalized event shape (metadata only):
  - `{ ts, channel, from, to?, body, transport }`
- Logging: append raw events to `logs/events.jsonl`.

## Phase 2: Agent Runtime (LLM-Driven)
- Agent connects to Matrix rooms.
- On receiving a message, agent uses LLM inference to decide:
  - Is this a potential match?
  - Should I reply publicly or via DM?
- Minimal policy loop:
  - `observe → decide → send`.
- No strict schemas; any structure is optional hints inside the text.
Note: In the OpenClaw-first deployment, OpenClaw runs externally and logs into Matrix. The built-in agent can be passive (`policy: none`) or use the basic heuristic for local testing.

## Phase 3: Matching/Negotiation Behavior (Emergent)
- Add a simple LLM prompt that:
  - Extracts implicit intent (buy/sell/barter/etc.).
  - Decides whether to initiate contact.
  - Produces a reply in plain language.
- Keep it permissive; do not enforce fields or strict templates.

## Phase 4: Transport Abstraction
- Introduce a transport interface.
- Matrix is the first adapter.

## Phase 5: Docs + Examples
- README centered on emergent behavior and raw-message design.
- Provide a few example transcripts (buy/sell, barter, coalition).

## Success Criteria
- Agents can discover matches and initiate conversations without any hard schema.
- Logs are human-readable and replayable.
- Adding a new transport does not change agent behavior.

## Quality Improvements (Rating Uplift)
These are the concrete steps to move the repo from a vibecoded MVP to a durable prototype.

### Tier 1: Immediate, High ROI
- Add a minimal test suite:
  - config validation
  - log redaction behavior
  - matrix event normalization
- Safer security defaults:
  - avoid persisting access tokens by default
  - document config handling and non-commit guidance
- Observability:
  - structured logs with levels
  - include room IDs and event IDs
- Formal config schema (Zod or JSON Schema) to fail fast on errors

### Tier 2: Operational Hardening
- Webhook reliability:
  - timeouts, bounded retries, and queueing
- Graceful shutdown:
  - clean stop on SIGINT/SIGTERM
  - flush logs and in-flight requests
- Rate limiting and de-duplication:
  - avoid event storms and duplicate processing
- Error hygiene:
  - clearer CLI errors with actionable messages

### Tier 3: Product Shape
- Multi-recipient DM routing (per-sender or per-intent, not a single DM room)
- Transport contract tests with a mock transport
- Architecture doc and example flows
- Packaging convenience: `npm run dev`, single `start` entry, and example config templates

## Changes Started (Immediate Fixes)
- DM logs now record a real recipient (via `--to` or `dm_recipient`).
- Config validation added (required fields + type checks).
- JSON Schema added for config (`config/agent.schema.json`).
- Test suite added (config validation, log redaction, matrix normalization).
- Optional `persist_access_token` flag to avoid writing tokens to disk.
- OpenClaw webhook timeout support (`openclaw_timeout_ms`).
- `setup` now guards against mismatched alias domains.
- Webhook queueing + bounded retries (`openclaw_queue_max`, `openclaw_retry_*`).
- Graceful shutdown on SIGINT/SIGTERM with queue drain.
- Rate limiting + dedupe for OpenClaw notifications.
- Multi-recipient DM routing via `dm_rooms` and `dm_room_ids`.
- Transport contract test with a mock transport.
- Architecture and flow docs (`docs/architecture.md`, `docs/flows.md`).
- Convenience scripts: `npm run start`, `npm run dev`.
