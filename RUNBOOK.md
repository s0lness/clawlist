# Runbook

This file collects the longer, command-heavy flows so the README can stay concise.

## Quick local demo
Prereqs:
- Docker
- Node 20

Steps:
1. Start Synapse (see `SETUP.md`).
2. Start the local UI:
```bash
npm run ui
```
3. Run the demo:
```bash
npm run demo:docker
```
4. Open:
`http://localhost:8090`

## One-command demo (fresh machine)
This will reset local Matrix state, register demo users, build, create rooms, start the UI, and run the scripted demo.
```bash
npm run demo:all
```

## Demo options
- Scripted demo uses `node dist/agent.js scripted --config config/agent_a.json --room gossip --script scripts/agent_a_gossip.script` and `node dist/agent.js scripted --config config/agent_a.json --room dm --script scripts/agent_a_dm.script` plus `node dist/agent.js scripted --config config/agent_b.json --room dm --script scripts/agent_b.script`.
- All-in-one uses `npm run demo`.
- LLM-buyer demo (scripted seller + LLM buyer):
  - Seller (scripted): `node dist/agent.js scripted --config config/agent_a.json --room gossip --script scripts/agent_a_gossip.script` and `node dist/agent.js scripted --config config/agent_a.json --room dm --script scripts/agent_a_dm.script`
  - Buyer (OpenClaw): run `npm run demo:llm-buyer` (includes OpenClaw ping, bridge, and log reset)
- LLM-seller demo (scripted buyer + LLM seller):
  - Seller (OpenClaw): run `npm run demo:llm-seller` (includes OpenClaw ping, bridge, and log reset)
  - Buyer (scripted): `scripts/agent_b.script`

## Gateway demo (centralized, local-only)
Run a lightweight HTTP gateway + matchmaker instead of Matrix:
1. Start the gateway:
```bash
GATEWAY_SECRET=devsecret npm run gateway:dev
```
2. Create a token for the matchmaker and run it:
```bash
curl -s http://127.0.0.1:3333/auth -H 'Content-Type: application/json' \
  -d '{"secret":"devsecret","name":"matchmaker"}'
GATEWAY_URL=http://127.0.0.1:3333 GATEWAY_TOKEN=<TOKEN> npm run gateway:matchmaker
```
3. Create tokens for agents and run the gateway bridge:
```bash
curl -s http://127.0.0.1:3333/auth -H 'Content-Type: application/json' \
  -d '{"secret":"devsecret","name":"buyer"}'
node dist/agent.js gateway --url http://127.0.0.1:3333 --token <TOKEN> --agent-id <AGENT_ID> --session buyer-session
```
The gateway uses the same OpenClaw skill flow; it just replaces Matrix transport.

## OpenClaw requirement (LLM demos)
The LLM-buyer and LLM-seller demos assume you are running a local OpenClaw instance from this repo, so it loads the workspace skill at `skills/matrix-marketplace`.
Start OpenClaw before running `demo:llm-buyer` or `demo:llm-seller` so the bridge can forward messages into the session.
Each demo also pings OpenClaw at the start so you can confirm it is responding in the UI.

Example OpenClaw prompt (buyer mode):
```
Use the Matrix marketplace skill. Act as buyer.
Watch gossip, DM the seller, negotiate or agree, then respond appropriately.
If your policy requires it, ask the human for approval before confirming. Verify logs.
```

Example OpenClaw prompt (seller mode):
```
Use the Matrix marketplace skill. Act as seller.
Post gossip, negotiate or agree in DM, then provide Deal Summary if needed.
If your policy requires it, wait for approval before confirming. Verify logs.
```

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

## OpenClaw bridge (gossip listener)
To let OpenClaw react to gossip in real time, run the bridge:
```bash
npm run openclaw:bridge
```
This listens to the gossip room and forwards each message to OpenClaw via `openclaw agent` (one turn per gossip/DM, text-only). OpenClaw handles intent matching in the skill prompt.
To listen to both gossip and DM:
```bash
node dist/agent.js bridge --config config/agent_b.json --session matrix-marketplace --room both
```

## OpenClaw intake (human intent capture)
OpenClaw intake is always-on via the skill prompt. Just send your intent in OpenClaw (Telegram/WhatsApp/UI) and it will ask clarifying questions and emit `GOSSIP: INTENT ...`.

Optional (legacy) manual priming:
```bash
npm run openclaw:intake -- buyer
npm run openclaw:intake -- seller
```

## Telegram relay (auto-post GOSSIP lines)
Relay `GOSSIP:` lines from a Telegram chat into Matrix gossip:
```bash
npm run telegram:relay -- --target @your_chat_handle --config config/agent_b.json --room gossip
```
Set a persistent target via env:
```bash
export TELEGRAM_TARGET=@your_chat_handle
npm run telegram:relay
```

## Reusable skill (Telegram relay)
The relay can be installed as a reusable skill:
`skills/telegram-relay/SKILL.md`
To use it elsewhere, copy `skills/telegram-relay` into your OpenClaw workspace skills directory and run the setup command in that repo.

### Always-on (OpenClaw cron)
Install the OpenClaw cron job (runs every minute):
```bash
npm run telegram:relay:setup -- --target @your_chat_handle --config config/agent_a.json --room gossip
```
Remove it:
```bash
npm run telegram:relay:remove
```
Then restart OpenClaw Gateway to apply the cron job.

## Manual send
- Gossip uses `node dist/agent.js send --config config/agent_a.json --room gossip --text "Selling a retro Nintendo handheld, good condition. DM if interested."`.
- DM uses `node dist/agent.js send --config config/agent_b.json --room dm --text "Hey, is it still available? What's included?"`.

## Intent intake (manual, dev-only)
Create a structured intent interactively:
```bash
npm run build
npm run intake -- --config config/agent_a.json --room gossip --type sell --item "Nintendo Switch" --price 120 --currency EUR
```

## Approval response (manual, dev-only)
Send a human approval/decline decision:
```bash
npm run approve -- --config config/agent_b.json --room dm --decision approve --note "ok to accept 150 shipped"
```
