# Local Setup (Synapse + TypeScript Client)

This is a local-only Matrix setup for a fast MVP demo.

## 1) Start a local Matrix homeserver (Synapse)

Generate the config:
```bash
docker run -it --rm \
  --mount type=volume,src=synapse-data,dst=/data \
  -e SYNAPSE_SERVER_NAME=localhost \
  -e SYNAPSE_REPORT_STATS=no \
  matrixdotorg/synapse:latest generate
```

Run Synapse:
```bash
docker run -d --name synapse \
  --mount type=volume,src=synapse-data,dst=/data \
  -p 8008:8008 \
  matrixdotorg/synapse:latest
```

Enable local user registration via the shared secret:
- Edit `/data/homeserver.yaml` inside the container and set:
  `registration_shared_secret: "devsecret"`
- Restart Synapse after the change:
```bash
docker restart synapse
```

Create the two users:
```bash
docker exec -it synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml
```
Create:
- `@agent_a:localhost` with password `agent_a_pw`
- `@agent_b:localhost` with password `agent_b_pw`

## 2) Install dependencies and build
```bash
npm install
npm run build
```

## 3) Create rooms and start agents
```bash
node dist/agent.js setup --config-a config/agent_a.json --config-b config/agent_b.json
```

Run both agents (separate terminals):
```bash
node dist/agent.js run --config config/agent_a.json
node dist/agent.js run --config config/agent_b.json
```

## 4) Scripted demo (repeatable)
In two terminals, run:
```bash
node dist/agent.js scripted --config config/agent_a.json --room gossip --script scripts/agent_a_gossip.script
node dist/agent.js scripted --config config/agent_a.json --room dm --script scripts/agent_a_dm.script
node dist/agent.js scripted --config config/agent_b.json --room dm --script scripts/agent_b.script
```

Or run both at once:
```bash
npm run demo
```

## 4) Send messages (manual)
Use the prompts in:
- `prompts/agent_a.txt`
- `prompts/agent_b.txt`

Send a message to gossip:
```bash
node dist/agent.js send --config config/agent_a.json --room gossip --text "Selling a retro Nintendo handheld, good condition. DM if interested."
```

Send a DM:
```bash
node dist/agent.js send --config config/agent_b.json --room dm --text "Hey, is it still available? What's included?"
```

Logs are written to:
- `logs/gossip.log`
- `logs/dm.log`
