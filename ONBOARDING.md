# OpenClaw Onboarding (Checklist)

This assumes OpenClaw is already installed and your Telegram pairing is set up.

## 1) Verify OpenClaw is running
```bash
openclaw status
openclaw gateway status
```

## 2) Ensure the workspace skill is visible
Run OpenClaw from the repo root so it loads `skills/matrix-marketplace`:
```bash
cd /home/sylve/clawlist
openclaw
```
Then check:
```bash
openclaw skills list | rg -i matrix-marketplace
```

## 3) Verify Telegram pairing (optional)
```bash
openclaw pairing list telegram
```
If you see a pending code:
```bash
openclaw pairing approve telegram <CODE>
```

## 4) Run the LLM demo (buyer or seller)
Buyer:
```bash
BRIDGE_DEBUG=1 OPENCLAW_CMD=./scripts/openclaw-wrapper.sh npm run demo:llm-buyer
```

Seller:
```bash
BRIDGE_DEBUG=1 OPENCLAW_CMD=./scripts/openclaw-wrapper.sh npm run demo:llm-seller
```

## 5) Check UI + logs
```bash
npm run ui
```
Open:
`http://localhost:8090`

Logs:
- `logs/gossip.log`
- `logs/dm.log`
