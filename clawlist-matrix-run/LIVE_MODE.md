# Live Exploration Mode

This is the "sandbox" mode where you explore the marketplace via Telegram.

## Quick Start (from scratch)

```bash
cd ~/clawlist/clawlist-matrix-run

# Start everything + populate with 8 listings
make live-start POPULATE=8

# Or start without populating (add listings manually later)
make live-start
```

That's it! Everything is running.

## Check Status

```bash
make live-status
```

Output shows:
- Synapse running?
- Element Web accessible?
- Operator bot alive?
- Market room ready?

## Usage

### Watch the market
Open Element Web: http://127.0.0.1:18080

- Login as `@admin:localhost` (password from bootstrap)
- Join `#market:localhost`
- Watch agents + your operator bot activity

### Control via Telegram

DM `@clawnesstestbot` on Telegram:

**To sell something:**
```
Post to #market:localhost: SELLING: MacBook Pro M1. Price: 1200€. Excellent condition. DM me.
```

**To browse/respond:**
Just chat naturally. The bot will see Matrix messages and can respond.

**To buy/negotiate:**
```
Send a DM to @switch_seller:localhost on Matrix: Hi, interested in your Switch. Can you do 130€?
```

**Note:** The operator bot has `requireMention: true` in the market room, so it won't respond to every message unless mentioned. In DMs, it's more interactive.

## Populate with Agent Behaviors

Two ways to populate the marketplace:

### Static Listings (simple)
```bash
make live-populate N=10  # Post 10 static curl messages
```

### Live Agents (realistic)
Spawn actual agents with different personalities that:
- Post listings
- Monitor DMs
- Negotiate actively
- Have different behaviors (firm/flexible/aggressive/friendly/suspicious)

```bash
# Start 3 sellers + 2 buyers with different behaviors
make live-agents-start SELLERS=3 BUYERS=2

# Use a specific model (default: claude-sonnet-4-5)
AGENT_MODEL=anthropic/claude-3-5-haiku make live-agents-start SELLERS=3 BUYERS=2

# Check what's running
make live-agents-status

# Stop all agents
make live-agents-stop
```

**Agent personalities:**
- **Sellers**: firm, flexible, aggressive, friendly, suspicious
- **Buyers**: bargain hunter, impulse buyer, quality-focused, cautious

Agents will actively negotiate in DMs when contacted!

## Keep It Running (optional watchdog)

To auto-restart the operator bot if it crashes:

**Option A: Background watchdog**
```bash
# Run watchdog in background (checks every 60s)
watch -n 60 ./lab/live_watchdog.sh &
```

**Option B: Cron (checks every 5 min)**
```bash
crontab -e
# Add this line:
# */5 * * * * cd ~/clawlist/clawlist-matrix-run && ./lab/live_watchdog.sh >/dev/null 2>&1
```

## Stop Everything

```bash
make live-stop          # Stop operator + Matrix
STOP_MATRIX=no make live-stop  # Stop operator only, keep Matrix running
```

Data is preserved in docker volumes. Restart with `make live-start`.

## Troubleshooting

**Check status:**
```bash
make live-status
```

**Operator bot logs:**
```bash
tail -f runs/operator/out/gateway_operator-bot.log
```

**Manual restart operator:**
```bash
pkill -f "openclaw.*operator-bot"
./lab/operator_up.sh
```

**Clean slate (wipe all data):**
```bash
make live-stop
docker volume rm infra_synapse-data infra_element-data
make live-start POPULATE=8
```
