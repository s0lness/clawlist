# Model Selection Strategy

## Problem

When spawning multiple agent profiles, we need to ensure they:
1. Don't use rate-limited providers (e.g., ChatGPT when you're over quota)
2. Use cost-effective models (agents don't need the most powerful model)
3. Have explicit, predictable model configuration

## Solution

### 1. **Explicit Model Configuration**

All agent spawning scripts now explicitly set `agents.defaults.model.primary` for each profile.

**Default:** `anthropic/claude-sonnet-4-5`
- Good balance of capability and cost
- Avoids ChatGPT rate limits
- Reliable for negotiation tasks

### 2. **Override via Environment Variable**

```bash
# Use Haiku (cheapest Claude model) for cost savings
AGENT_MODEL=anthropic/claude-3-5-haiku make live-agents-start SELLERS=5 BUYERS=3

# Or use a specific model
AGENT_MODEL=anthropic/claude-opus-4-5 ./lab/spawn_seller_agents.sh 3
```

### 3. **Per-Profile Configuration**

Each spawned profile gets its own model config, so:
- ✅ Different agent types can use different models
- ✅ Changes don't affect your main agent
- ✅ Easy to experiment with model performance

## Recommended Models (by use case)

| Use Case | Model | Why |
|----------|-------|-----|
| **Cost-optimized** | `anthropic/claude-3-5-haiku` | Cheapest Claude, good for simple negotiations |
| **Balanced (default)** | `anthropic/claude-sonnet-4-5` | Good performance, reasonable cost |
| **High-stakes testing** | `anthropic/claude-opus-4-5` | Most capable, use sparingly |

## Future-Proofing Checklist

When creating new agent spawning scripts:

- [ ] Set `agents.defaults.model.primary` explicitly
- [ ] Support `AGENT_MODEL` env var override
- [ ] Document the default model in script header
- [ ] Consider cost implications (10 agents × 100 turns = lots of tokens)

## Cost Estimation (rough)

Assuming 1,000 tokens per agent turn (conservative):

| Scenario | Agents | Turns | Total Tokens | Cost @ Sonnet 4.5 |
|----------|--------|-------|--------------|-------------------|
| Small test | 5 | 10 | 50k | ~$0.15 |
| Medium run | 10 | 20 | 200k | ~$0.60 |
| Large sweep | 20 | 50 | 1M | ~$3.00 |

Using Haiku cuts costs by ~80%.

## Migration Note

When moving to TypeScript (Phase 9), model configuration should be:
- Type-safe (enum of valid models)
- Profile-scoped (not global)
- Documented in scenario schema
