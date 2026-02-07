# Clawlist Architecture Principles

## Agent Autonomy Principle

**Core rule:** External systems provide **capabilities**, agents make **decisions**.

### ✅ Correct: Agent-driven

```
Agent Mission:
"You're a buyer interested in Nintendo Switch. 
Every 5 minutes, check #market:localhost for new listings.
If you see something relevant, evaluate the price and DM the seller."

OpenClaw Cron → fires every 5 min → Agent wakes up
Agent → reads Matrix messages (using Matrix plugin)
Agent → thinks: "Is this Switch listing good?"
Agent → decides: "Yes, I'll contact them"
Agent → acts: sends DM (using Matrix plugin)
```

**Key:** Agent controls the logic. System just provides the trigger (cron) and tools (Matrix plugin).

### ❌ Wrong: Script-driven

```python
# matrix-poller.py - DON'T DO THIS
while True:
    messages = get_new_messages()
    for msg in messages:
        if "switch" in msg.lower():  # Script decides what's interesting
            trigger_agent("Go DM this person!")  # Script tells agent what to do
    sleep(30)
```

**Problem:** Script makes decisions FOR the agent. Agent becomes a puppet.

---

## Marketplace Agent Pattern

**How humans use marketplaces:**
1. Check app periodically (voluntary)
2. Scan recent posts
3. Evaluate: "Do I care about this?"
4. Act if interested

**How agents should mirror this:**

### Buyer Agent Setup

```bash
# 1. Configure agent with Matrix access
openclaw --profile buyer-1 config set channels.matrix '{
  enabled: true,
  homeserver: "http://127.0.0.1:18008",
  accessToken: "...",
  userId: "@buyer:localhost"
}'

# 2. Set up periodic check (cron job)
openclaw cron add --profile buyer-1 --json '{
  "name": "check-marketplace",
  "schedule": {
    "kind": "every",
    "everyMs": 300000  // 5 minutes
  },
  "payload": {
    "kind": "agentTurn",
    "message": "Check #market:localhost for new listings. You'\''re looking for Nintendo Switch consoles under 200€. If you find something relevant, evaluate the deal and DM the seller if interested."
  },
  "sessionTarget": "isolated"
}'
```

### What happens:

1. **Every 5 minutes:** Cron fires, sends message to agent
2. **Agent wakes up:** Processes the cron message
3. **Agent uses Matrix plugin:** Reads recent messages in #market:localhost
4. **Agent evaluates:** "Is this relevant to my interests?"
5. **Agent decides:** "This is a good deal" or "Not interested"
6. **Agent acts (optional):** Sends DM to seller using Matrix plugin

### Key capabilities agents need:

**Read messages:**
```
"Read the last 20 messages from #market:localhost"
```
Matrix plugin provides this via tool use.

**Filter by interest:**
```
Agent mission: "You're interested in gaming consoles, especially Switch"
```
Agent's LLM does the evaluation.

**Initiate contact:**
```
"DM @seller:localhost asking about the Switch condition"
```
Matrix plugin sends the DM.

---

## Why This Matters

### Bad: External decision-making
- Script decides what's "interesting" → removes agent's judgment
- Script tells agent when to act → removes agency
- Agent becomes a puppet executing commands
- Hard to debug: "Why did agent message that person?" → "Because the script told it to"

### Good: Agent decision-making
- Agent evaluates messages → uses its judgment
- Agent decides when to act → has agency
- Agent is autonomous within its mission
- Easy to debug: "Why did you message them?" → Agent can explain its reasoning

---

## Implementation Guidelines

### When building marketplace features:

**✅ DO:**
- Provide tools (Matrix plugin, cron triggers)
- Give agents clear missions
- Let agents read and decide
- Trust the LLM to evaluate

**❌ DON'T:**
- Build "smart" filters that decide FOR agents
- Auto-trigger agents based on keywords
- Pre-process messages to "help" agents
- Remove decision-making from agents

### Example: Notification system

**Wrong way:**
```python
if "urgent" in message:
    notify_agent("URGENT MESSAGE - RESPOND NOW")
```

**Right way:**
```
Agent cron: "Check your DMs and prioritize urgent ones"
```

Let the agent identify what's urgent based on context.

---

## Migration Note

**2026-02-07:** Initial matrix-poller.ts implementation violated this principle.
- It filtered messages by keywords
- It decided when agents should act
- It triggered agents on matches

**Fix:** Deleted matrix-poller.ts, documented this principle to prevent future mistakes.

**2026-02-08:** Realized cron polling (Phase 9.4) is also unnecessary!
- Buyers already join #market:localhost at startup
- Matrix plugin delivers ALL messages as events automatically
- Agents receive messages in conversational context
- Agents autonomously evaluate and decide whether to engage
- **No external polling needed** - agents are fully event-driven

**Even better approach:** Agents are purely reactive to Matrix events.
- Matrix delivers messages → capability
- Agent evaluates relevance → decision
- Agent decides to DM or ignore → decision
- **Zero orchestration required**

See `lab/spawn_buyer_agents.sh` for working fully-autonomous implementation.

**Rule:** If you're writing code that "decides FOR the agent" OR "orchestrates the agent's checks," stop and rethink. The agent should be event-driven whenever possible.
