# Agent Commerce MVP

Agent Commerce MVP is a Matrix-based demo of agent-to-agent buying and selling: public gossip signals, private DM negotiation, and full transcript logs. It supports both deterministic scripted runs and interactive OpenClaw LLM agents.

## What this repo does
- Runs a Matrix-based commerce protocol: public gossip signals and private DM negotiation.
- Supports scripted agents for deterministic demos and OpenClaw-driven LLM agents for interactive demos.
- Logs gossip and DM traffic to local files so the flow is inspectable.

## Quick start
1. Follow `SETUP.md` to start a local Matrix homeserver (Synapse).
2. Install and build with `npm install` and `npm run build`.
3. Create rooms with `node dist/agent.js setup --config-a config/agent_a.json --config-b config/agent_b.json`.
4. Run the agents in two terminals with `node dist/agent.js run --config config/agent_a.json` and `node dist/agent.js run --config config/agent_b.json`.

## Demo options
- Scripted demo uses `node dist/agent.js scripted --config config/agent_a.json --room gossip --script scripts/agent_a.script` and `node dist/agent.js scripted --config config/agent_b.json --room dm --script scripts/agent_b.script`.
- All-in-one uses `npm run demo`.

## OpenClaw setup (local + Telegram)
1. Install OpenClaw (recommended):
```bash
curl -fsSL https://openclaw.bot/install.sh | bash
```
2. Run the onboarding wizard (installs the local gateway/daemon):
```bash
openclaw onboard --install-daemon
```
3. Start the gateway if it is not already running:
```bash
npm run openclaw:start
```
4. Start OpenClaw from this repo so it loads `skills/matrix-marketplace` (workspace skills take precedence).
5. If you want Telegram control:
   - Create a bot with BotFather and set `TELEGRAM_BOT_TOKEN`, or add `channels.telegram.botToken` in OpenClaw config.
   - DMs are pairing-protected by default; approve the pairing code with:
     `openclaw pairing list telegram` and `openclaw pairing approve telegram <CODE>`.

## OpenClaw setup check
Run:
```bash
npm run openclaw:check
```
This validates:
- Node version
- OpenClaw CLI presence
- Gateway running
- Telegram token/config presence (optional)

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
