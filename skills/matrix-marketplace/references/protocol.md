# Matrix Marketplace Protocol (Demo)

## Message Flow
- Gossip room: public intent signals.
- DM room: private negotiation.
- Logs: `logs/gossip.log` and `logs/dm.log`.

## Key Commands
- Setup rooms: `node dist/agent.js setup --config-a config/agent_a.json --config-b config/agent_b.json`
- Run agents: `node dist/agent.js run --config config/agent_a.json` and `node dist/agent.js run --config config/agent_b.json`
- Send gossip: `node dist/agent.js send --config config/agent_a.json --room gossip --text "..."`
- Send DM: `node dist/agent.js send --config config/agent_b.json --room dm --text "..."`

## Prompts
- Seller: `prompts/agent_a.txt`
- Buyer: `prompts/agent_b.txt`

## Logs
- `logs/gossip.log`
- `logs/dm.log`
