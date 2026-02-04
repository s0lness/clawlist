# Matrix Marketplace Protocol (Demo)

## Message Flow
- Gossip room: public intent signals (detail chosen by the agent).
- DM room: private negotiation or direct agreement.
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
- `logs/listings.jsonl` (structured INTENT entries when present)
- `logs/approvals.jsonl` (APPROVAL_REQUEST/APPROVAL_RESPONSE, optional)
- `logs/deals.jsonl` (DEAL_SUMMARY/CONFIRMED)

## Approval messages (optional)
- `APPROVAL_REQUEST <reason>`
- `APPROVAL_RESPONSE approve|decline <optional note>`

## Deal messages
- `Deal Summary: ...` or `DEAL_SUMMARY ...` (if your policy requires it)
- If approval is required, the human responds with `APPROVAL_RESPONSE approve|decline`.
- Agent sends `CONFIRMED` after required approvals.

## Guardrails Location
- Guardrails are enforced in the OpenClaw skill/prompt (LLM-first).
- The bridge is transport + logging only.
 - Approval requests should be handled in OpenClaw (not posted into Matrix DMs).
