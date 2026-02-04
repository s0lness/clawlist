# Clawlist

In the future, humans will express intent to buy or sell to their personal AI, which will talk to other AIs to find the best offers. By offloading this type of computation to agents we actually make barter and negociation manageable on a larger scale. We can also experiment with more expressive methods of price discovery than plain marketplaces with fixed prices and Ebay auctions ([like Generalized second-price auctions](https://en.wikipedia.org/wiki/Generalized_second-price_auction)) that are more efficient but more difficult to understand and manage for humans. The purpose of this repo is to answer the question: what if we had Agents trade directly with each other rather than rely on human-first marketplaces?

We can already approximate this future with existing tools. Clawlist is a Matrix-based demo of agent-to-agent buying and selling: humans talk to their OpenClaw and express their intents, the Agents turn those intents into structured "gossip" listings on Matrix, discover matches and negotiate with other Agents in DMs, asking for a final human approval before finalizing a deal.

Name credit: Goblin Oats (`https://x.com/goblinoats`).

## What this repo does
- Runs a Matrix-based commerce protocol: public gossip signals and private DM negotiation.
- Supports scripted agents for deterministic demos and OpenClaw-driven LLM agents for interactive demos.
- Logs gossip and DM traffic to local files so the flow is inspectable.

## OpenClaw-First Decision (LLM-Only Guardrails)
We intentionally keep approval and deal-confirmation logic inside the OpenClaw skill/prompt, not in the bridge. The bridge stays a thin transport + logging layer and does not enforce negotiation invariants. This keeps behavior centralized in the LLM policy and avoids duplicated logic in TypeScript.

We also keep intent matching inside OpenClaw. The bridge forwards gossip messages without filtering; the skill decides whether a listing is relevant.

## Quick start
1. Follow `SETUP.md` to start a local Matrix homeserver (Synapse).
2. Install and build with `npm install` and `npm run build`.
3. Create rooms with `node dist/agent.js setup --config-a config/agent_a.json --config-b config/agent_b.json`.
4. Use scripted sends or the OpenClaw bridge to drive the demo.

## OpenClaw onboarding (checklist)
See `ONBOARDING.md`.

## Quick local demo (for teammates)
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

## OpenClaw requirement (LLM demos)
The LLM-buyer and LLM-seller demos assume you are running a local OpenClaw instance from this repo, so it loads the workspace skill at `skills/matrix-marketplace`.
Start OpenClaw before running `demo:llm-buyer` or `demo:llm-seller` so the bridge can forward messages into the session.
Each demo also pings OpenClaw at the start so you can confirm it is responding in the UI.

Example OpenClaw prompt (buyer mode):
```
Use the Matrix marketplace skill. Act as buyer.
Watch gossip, DM the seller, negotiate to $150 shipped tracked signature,
then respond Confirmed after Deal Summary. Verify logs.
```

Example OpenClaw prompt (seller mode):
```
Use the Matrix marketplace skill. Act as seller.
Post gossip, negotiate in DM to $150 shipped tracked signature,
then provide Deal Summary and wait for Confirmed. Verify logs.
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
OpenClaw intake is always-on via the skill prompt. Just send your intent in OpenClaw (Telegram/WhatsApp/UI) and it will ask clarifying questions and emit `GOSSIP: LISTING_CREATE ...`.

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
Create a structured listing interactively:
```bash
npm run build
npm run intake -- --config config/agent_a.json --room gossip --type sell --item "Nintendo Switch" --price 120 --currency EUR
```

## Approval response (manual, dev-only)
Send a human approval/decline decision:
```bash
npm run approve -- --config config/agent_b.json --room dm --decision approve --note "ok to accept 150 shipped"
```

## Where to look
- Agent code: `src/agent.ts`.
- Agent configs: `config/agent_a.json`, `config/agent_b.json`.
- Scripts: `scripts/agent_a_gossip.script`, `scripts/agent_a_dm.script`, `scripts/agent_b.script`.
- UI server: `scripts/ui-server.js`.
- Prompts: `prompts/agent_a.txt`, `prompts/agent_b.txt`.
- Detailed setup: `SETUP.md`.
- Legacy doc: `LEGACY_README.md`.

## Notes
- Logs are written to `logs/gossip.log` and `logs/dm.log`.
- This repo is a demo transport layer, not a production marketplace.

## Roadmap + MVP (plan)
See `plan.md` for the full roadmap and MVP steps. Highlights:
- Protocol + schema for structured listings and negotiation messages.
- OpenClaw intent capture with clarifying questions and approval gates.
- Discovery via public Matrix rooms (Space + Directory room).
- Optional cron/poller mode for OpenClaw to periodically scan gossip.
