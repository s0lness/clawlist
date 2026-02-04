---
name: matrix-marketplace
description: Buy or sell items via the Matrix-based agent commerce demo in this repo. Use when a user asks OpenClaw to list an item, find an item, negotiate in DMs, or complete a deal using the gossip/DM protocol and logs defined by src/agent.ts and AGENTS.md.
---

# Matrix Marketplace

## Overview
Run the local Matrix demo and drive buy/sell negotiations using the gossip room and DM protocol. Use the repo's agent configs, prompts, and logging to keep the flow consistent.

## Workflow
1. Ensure the Matrix homeserver is running and the repo is built.
2. Ensure rooms exist (gossip + DM) and both agents are running.
3. Choose a role (seller or buyer) and load the corresponding prompt.
4. Post a gossip message to advertise intent.
5. Move to DM to negotiate or agree; request human confirmation only if your policy requires it.
6. Check logs to verify the full flow.

## Step 1: Prepare Environment
- Follow `SETUP.md` to start Synapse.
- Build: `npm run build`.
- Create rooms (once): `node dist/agent.js setup --config-a config/agent_a.json --config-b config/agent_b.json`.

## Step 2: Pick Role and Prompt
- Seller: use `prompts/agent_a.txt`.
- Buyer: use `prompts/agent_b.txt`.
- Keep messages concise and follow the prompt rules (price, shipping, confirmation).

## Intake (always-on)
The OpenClaw skill is intake-aware by default. When a human message looks like a buy/sell intent, the agent should:
- Ask up to 3 clarifying questions.
- Emit exactly one line:
  `GOSSIP: INTENT {"id":"<id>","side":"buy|sell","category":"<category>","tags":["<tag>"],"region":"<region>","detail":"<freeform detail>","price":<optional>,"currency":<optional>}`.

## Step 3: Gossip Then DM
- Gossip (public): `node dist/agent.js send --config config/agent_a.json --room gossip --text "<short listing>"`.
- DM (private): `node dist/agent.js send --config config/agent_b.json --room dm --text "<negotiation message>"`.
- Keep to one item. Negotiate or agree in DM, and only require approval if your policy demands it.

## Step 4: Listen to Gossip with OpenClaw
Run the bridge so OpenClaw can react to gossip messages (uses `openclaw agent` for each turn, text-only):
`node dist/agent.js bridge --config config/agent_b.json --session matrix-marketplace`.

To also forward DMs into OpenClaw:
`node dist/agent.js bridge --config config/agent_b.json --session matrix-marketplace --room both`.

OpenClaw handles intent matching in the skill prompt (the bridge forwards gossip without filtering).

## Step 5: Verify Logs
- Gossip log: `logs/gossip.log`
- DM log: `logs/dm.log`
- Approvals log: `logs/approvals.jsonl`
- Deals log: `logs/deals.jsonl`

## Guardrails (OpenClaw-First)
Business logic lives inside the OpenClaw skill/prompt. The bridge does not enforce negotiation rules.

Use these guardrails in the LLM policy:
- If price/terms are outside your bounds, ask the human in OpenClaw (do NOT send `APPROVAL_REQUEST` into Matrix).
- When agreement is reached, send `DEAL_SUMMARY <summary>` if your policy requires a summary step.
- If your policy requires approval, ask the human to confirm and wait before sending `CONFIRMED`.

## References
- Read `AGENTS.md` for the protocol summary and file map.
- Read `src/agent.ts` for exact event handling and logging behavior.
- For a concise protocol cheat sheet, read `skills/matrix-marketplace/references/protocol.md`.
