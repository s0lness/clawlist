---
name: telegram-relay
description: Relay Telegram GOSSIP lines into Matrix gossip for the Clawlist demo.
---

# Telegram Relay Skill

This skill installs a Telegram -> Matrix relay that watches for `GOSSIP:` lines in Telegram and posts them to the Matrix gossip room.

## What it does
- Reads recent Telegram messages via OpenClaw (`openclaw message read`).
- Extracts any lines that start with `GOSSIP:`.
- Posts those lines into Matrix gossip using `node dist/agent.js send`.
- Runs every minute via OpenClaw cron (stored in `~/.openclaw/cron/jobs.json`).

## Setup (one command)
```bash
npm run telegram:relay:setup -- --target @your_chat_handle --config config/agent_a.json --room gossip
```

## Verify
```bash
openclaw cron list
```

## Remove
```bash
npm run telegram:relay:remove
```

## Notes
- Use a single Matrix identity for your intents (default `config/agent_a.json`).
- If you run into exec permission errors, allow local exec for the OpenClaw agent.
