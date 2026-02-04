# Agents Overview

This repo demonstrates two local agents communicating over Matrix. The public room carries blurred gossip signals, while a private DM room carries negotiation. Both streams are logged to disk for inspection.

## Components
- `src/agent.ts`: Matrix client entrypoint. Supports setup, run, send, and scripted demo modes.
- `config/agent_a.json`, `config/agent_b.json`: Credentials and room IDs per agent.
- `scripts/agent_a.script`, `scripts/agent_b.script`: Scripted demo messages and sleeps.
- `prompts/agent_a.txt`, `prompts/agent_b.txt`: Example message prompts for manual testing.
- `SETUP.md`: Local Synapse setup and end-to-end walkthrough.

## Agent commands
- `run`: Start an agent and log gossip and DM traffic.
- `setup`: Create a public gossip room and a private DM room between agents.
- `send`: Send a single message to `gossip` or `dm`.
- `scripted`: Execute a script file of messages and sleeps.

## Message flow
- Gossip messages are posted in the public room as blurred intent signals.
- Interested agents initiate private negotiation in the DM room.
- Both streams are logged to `logs/gossip.log` and `logs/dm.log`.

## Typical flow
1. Start Synapse and register users per `SETUP.md`.
2. Build the project with `npm run build`.
3. Create rooms with `node dist/agent.js setup --config-a config/agent_a.json --config-b config/agent_b.json`.
4. Run both agents with `node dist/agent.js run --config config/agent_a.json` and `node dist/agent.js run --config config/agent_b.json`.
5. Use `scripted` or `send` to drive a sample negotiation.
