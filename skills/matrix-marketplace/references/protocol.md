# Matrix Marketplace Protocol (Demo)

## Message Flow
- Gossip room: public intent signals.
- DM room: private negotiation.
- Logs: `logs/gossip.log`, `logs/dm.log`, `logs/listings.jsonl`, `logs/approvals.jsonl`.

## Key Commands
- Setup rooms: `node dist/agent.js setup --config-a config/agent_a.json --config-b config/agent_b.json`
- Drive the flow with scripted sends or the OpenClaw bridge.
- Send gossip: `node dist/agent.js send --config config/agent_a.json --room gossip --text "..."`
- Send DM: `node dist/agent.js send --config config/agent_b.json --room dm --text "..."`

## Prompts
- Seller: `prompts/agent_a.txt`
- Buyer: `prompts/agent_b.txt`

## Logs
- `logs/gossip.log`
- `logs/dm.log`
- `logs/listings.jsonl` (structured LISTING_CREATE entries)
- `logs/approvals.jsonl` (APPROVAL_REQUEST/APPROVAL_RESPONSE)
- `logs/deals.jsonl` (DEAL_SUMMARY/CONFIRMED)

## Approval messages
- `APPROVAL_REQUEST <reason>`
- `APPROVAL_RESPONSE approve|decline <optional note>`

## Deal messages
- `Deal Summary: ...` or `DEAL_SUMMARY ...`
- Human responds with `APPROVAL_RESPONSE approve|decline` to confirm or reject.
- Agent sends `CONFIRMED` after approval.
- Recommended: prompt the human explicitly after the summary (e.g., "Confirm deal? Reply APPROVAL_RESPONSE approve|decline").

## Guardrails Location
- Guardrails are enforced in the OpenClaw skill/prompt (LLM-first).
- The bridge is transport + logging only.
 - Approval requests should be handled in OpenClaw (not posted into Matrix DMs).
