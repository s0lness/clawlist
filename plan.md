# Clawlist Roadmap + MVP Plan

This doc captures the concrete implementation roadmap plus a tight MVP plan for a two-human demo (buyer + seller OpenClaw).

## Current Status (Feb 4, 2026)

Achieved
- Protocol + schema: `LISTING_CREATE` structured messages logged to `logs/listings.jsonl`.
- Intent capture: CLI intake (dev-only) and OpenClaw intake prompts + Telegram flow verified.
- Discovery + matching: OpenClaw matches on intent (bridge forwards gossip without filtering).
- Approval capture: `APPROVAL_REQUEST` / `APPROVAL_RESPONSE` logged to `logs/approvals.jsonl`.
- Deal confirmation workflow: OpenClaw skill prompts for confirmation after `DEAL_SUMMARY` and waits for `APPROVAL_RESPONSE approve` before `CONFIRMED`.
- UI: listings + roles + approvals panels.
- Deal logging + UI: `DEAL_SUMMARY` / `CONFIRMED` logged to `logs/deals.jsonl` and shown in UI.
- Telegram → Matrix relay: `telegram-relay.js` + OpenClaw cron setup for always-on relay.
- Basic protocol tests for listings, approvals, and deals (`scripts/test-protocol.js`).
- UI smoke test for log endpoints (`scripts/test-ui.js`).
- Manual end-to-end checklist (`scripts/test-e2e-checklist.md`).
- Automated e2e test (optional, requires OpenClaw + Docker): `RUN_E2E=1 npm run test:e2e`.

Still missing for MVP
- Robust integration tests (end-to-end Matrix/OpenClaw flow, retries, and failure handling).

## Implementation Roadmap

1. **Protocol + Schema (foundation)**
   - Goal: machine-readable messages for gossip, negotiation, and approvals.
   - Work:
     - Define JSON line schema for gossip listings + DM actions.
     - Formalize message types: `LISTING_CREATE`, `LISTING_UPDATE`, `OFFER`, `COUNTER`, `ACCEPT`, `DEAL_SUMMARY`, `APPROVAL_REQUEST`, `APPROVAL_RESPONSE`.
   - Targets:
     - `src/agent.ts` (parse/dispatch)
     - `scripts/` (demo scripts updated to JSON lines)
    - `README.md` (protocol doc)

2. **Intent Capture via OpenClaw (Buy/Sell intake)**
   - Goal: human says “buy/sell X” via OpenClaw, agent asks questions, then creates listing.
   - Work:
     - Prompt template for intake + follow‑ups.
     - Store listing draft state until complete.
     - Emit structured `LISTING_CREATE` gossip.
   - Targets:
     - `skills/matrix-marketplace` (skill behavior)
     - `prompts/intent_capture.txt` (for clarity)
     - `src/agent.ts` (gossip send uses JSON)

3. **Discovery + Matching**
   - Goal: agents crawl gossip, match against intent, initiate DM.
   - Work:
     - Parse gossip JSON, score matches.
     - Prevent duplicate DMs for same listing ID.
     - Match rules: item keyword, condition, price range, location/shipping.
   - Targets:
     - `src/agent.ts` (bridge logic)
     - `intent/` (preferences file)

4. **Negotiation + Human Approval**
   - Goal: LLM negotiates but always checks with its human at critical moments.
   - Work:
     - Negotiation policy (max price for buyer, min price for seller, acceptable condition).
     - Trigger `APPROVAL_REQUEST` when:
       - Offer is above budget / below minimum,
       - Special terms deviate.
   - Targets:
     - `skills/matrix-marketplace` (rules)
     - `src/agent.ts` (approval messages)
     - OpenClaw prompt updates

5. **Persistence + UI Enhancements**
   - Goal: UI shows listing lifecycle + LLM/human attribution.
   - Work:
     - Store listing state + negotiation state in `logs/` (JSON lines).
     - UI: “Listings” panel + “Negotiation timeline.”
   - Targets:
     - `scripts/ui/index.html`, `scripts/ui/styles.css`
     - `scripts/ui-server.js` (serve listings endpoint)

6. **Tests + Demo Stability**
   - Goal: repeatable demos + fewer manual resets.
   - Work:
     - Scripted tests for listing create/update, matching, negotiation, approval.
     - Timeouts, retries, and “no response” fallback paths.
   - Targets:
     - `scripts/demo-llm-buyer.sh`, `scripts/demo-llm-seller.sh`
     - `scripts/test-*`

## MVP Plan: Two Humans (Buyer + Seller OpenClaw)

### Scope
- One buyer OpenClaw, one seller OpenClaw.
- Humans create intent via OpenClaw (Telegram/WhatsApp).
- Negotiation occurs in Matrix DM.
- Final approval is explicitly requested from the human.

### MVP Steps

1. **Intake Prompt**
   - Buyer: “buy Nintendo Switch, good condition, 120 EUR shipped.”
   - Seller: “sell Nintendo Switch, good condition, 120 EUR.”
   - Agent asks 3–5 clarifying questions (condition, accessories, location, shipping, urgency).
   - After answers, agent posts `LISTING_CREATE` to gossip.

2. **Discovery**
   - Buyer agent watches gossip for `LISTING_CREATE` and matches on item + price tolerance.
   - Seller agent watches gossip for `LISTING_CREATE` (buyer intent) and matches.
   - First match initiates DM: `OFFER` or `INTEREST`.

3. **Negotiation**
   - LLM negotiates within constraints.
   - If offer is outside thresholds: send `APPROVAL_REQUEST` to human.
   - Human replies “approve/decline/counter”.

4. **Deal Summary**
   - When agreement is reached, agent posts `DEAL_SUMMARY` to DM.
   - Human receives prompt: “Confirm deal?” (Yes/No).
   - Agent replies `CONFIRMED` in DM.

5. **UI**
   - Show roles, listing status, and which agent is the LLM.
   - Show “awaiting human approval” status.

### Minimal Code Changes for MVP
- Implement JSON listing format in gossip (UI can still render raw text).
- Add listing state store (`logs/listings.jsonl`).
- OpenClaw prompt asks clarifying questions and emits `LISTING_CREATE`.
- Add approval request in DM flow (single type to start).
- UI: add small “Listing status” panel (roles already done).
- Keep CLI intake/approve as dev-only scaffolding, not the end-user flow.

### OpenClaw-first flow (current)
- Use OpenClaw intake prompts to prime listing creation (see `skills/matrix-marketplace`).
- OpenClaw asks up to 3 questions, then emits `LISTING_CREATE` to gossip.
- Bridge matches on structured intent and initiates DM.
- Approval requests logged to UI; human responses sent via OpenClaw or dev CLI.

## Recommended Architecture (Short Version)

1. **Matrix for transport + federation**
   - Gossip lives in public Matrix rooms.
   - Negotiation lives in Matrix DMs.

2. **OpenClaw for policy and human interface**
   - OpenClaw handles intent capture, negotiation, and approval gates.
   - Matrix client stays thin: join rooms, forward messages, send actions.

3. **Discovery with a Space + Directory Room**
   - A Space lists canonical category rooms.
   - A Directory room lets anyone register new rooms.

4. **Replicated room catalogs later**
   - Peers publish `CATALOG_UPDATE` in the Directory room.
   - Agents merge catalogs and auto-join trusted rooms.

## Cron/Polling Plan (OpenClaw as “market scout”)

### Goal
Let OpenClaw periodically scan gossip for matches and only initiate when a real match appears.

### Option A: Poller Mode (cron-friendly)
- Add `agent.js poll` to fetch new gossip since last sync token.
- Store the sync token on disk so each run is incremental.
- Forward new gossip to OpenClaw and let the skill decide whether to respond.

Example CLI:
```
node dist/agent.js poll --config config/agent_b.json --room gossip --interval 300
```

Cron example (every 5 minutes):
```
*/5 * * * * cd /path/to/clawlist && node dist/agent.js poll --config config/agent_b.json --room gossip
```

### Option B: Always-on Bridge
- Keep `node dist/agent.js bridge` running as a service.
- It streams gossip in real time and invokes OpenClaw per message.

### Recommendation
Start with **Option A** for early MVP stability and predictable costs.
Move to **Option B** when you want real-time responsiveness.
