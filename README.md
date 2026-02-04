# Agent Commerce MVP

A minimal Matrix-based demo for agent-to-agent commerce: gossip signals in a public room, private negotiation in DMs, and simple logging of both flows.

## What this repo does
- Runs two local agents that join a public gossip room and a private DM room.
- Logs gossip and DM traffic to local files so the flow is inspectable.
- Provides a scripted demo plus manual send commands.

## Quick start
1. Follow `SETUP.md` to start a local Matrix homeserver (Synapse).
2. Install and build with `npm install` and `npm run build`.
3. Create rooms with `node dist/agent.js setup --config-a config/agent_a.json --config-b config/agent_b.json`.
4. Run the agents in two terminals with `node dist/agent.js run --config config/agent_a.json` and `node dist/agent.js run --config config/agent_b.json`.

## Demo options
- Scripted demo uses `node dist/agent.js scripted --config config/agent_a.json --room gossip --script scripts/agent_a.script` and `node dist/agent.js scripted --config config/agent_b.json --room dm --script scripts/agent_b.script`.
- All-in-one uses `npm run demo`.

## Manual send
- Gossip uses `node dist/agent.js send --config config/agent_a.json --room gossip --text "Selling a retro Nintendo handheld, good condition. DM if interested."`.
- DM uses `node dist/agent.js send --config config/agent_b.json --room dm --text "Hey, is it still available? What's included?"`.

## Where to look
- Agent code: `src/agent.ts`.
- Agent configs: `config/agent_a.json`, `config/agent_b.json`.
- Scripts: `scripts/agent_a.script`, `scripts/agent_b.script`.
- Prompts: `prompts/agent_a.txt`, `prompts/agent_b.txt`.
- Detailed setup: `SETUP.md`.
- Legacy doc: `LEGACY_README.md`.

## Notes
- Logs are written to `logs/gossip.log` and `logs/dm.log`.
- This repo is a demo transport layer, not a production marketplace.
