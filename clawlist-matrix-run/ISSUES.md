# Known Issues (from Live Testing)

## High Priority

### 1. Operator Bot: Proactive DM Monitoring
**Problem:** User has to manually ask bot to check DMs  
**Current:** Passive - waits for explicit "check DMs" command  
**Expected:** Proactive - automatically notifies when DMs arrive

**Fix:**
- Add DM monitoring to operator bot
- Send notification to Telegram when Matrix DM received
- Example: "📬 New DM from @switch_buyer: [preview]"

**Phase:** Can fix now (pre-TypeScript)

---

### 2. Internal Messages Leaking to Public Market
**Problem:** Approval requests and deal confirmations appearing in #market:localhost  
**Examples:**
- "APPROVAL NEEDED: accept 135€, meet Châtelet tomorrow 15:00"
- "DEAL: 135€. Châtelet tomorrow at 15:00 works for me. See you there!"

**Current:** Messages meant for internal workflow posted publicly  
**Expected:** Only public listings in market room; approvals/deals stay in DMs or internal

**Fix:**
- Review message routing logic
- Ensure approval workflow uses Telegram DMs only
- Deal confirmations should stay in Matrix DM thread
- Add message classification (public vs internal)

**Phase:** Can fix now

---

### 3. Buyer Agent Inconsistent Decision-Making
**Problem:** Agent flip-flopping between yes/no during negotiation  
**Observed:** Conversation became messy, agent changed position multiple times  
**Expected:** Stable negotiation strategy with clear decision logic

**Likely Causes:**
- No state tracking between messages
- Missing negotiation history context
- Unclear decision criteria in prompt

**Fix:**
- Add negotiation state tracking (current offer, history, constraints)
- Improve mission prompt with clear decision tree
- Add "don't contradict yourself" guardrail
- Consider adding structured negotiation protocol

**Phase:** Needs TypeScript migration for proper state management

---

## Medium Priority

### 4. Autonomous Matrix Agent Message Processing
**Problem:** Agents don't auto-respond to market room messages  
**Current:** Connected to Matrix but passive (no polling/event processing)  
**Expected:** Agents monitor room, respond to relevant messages autonomously

**Fix:**
- Implement Matrix sync loop
- Add event-based triggers for agent runs
- Create polling mechanism for room updates
- Handle message threading properly

**Phase:** Requires TypeScript migration (Phase 9)

---

### 5. Agent Spawn Script Reliability
**Problem:** Multiple issues during agent spawning:
- Matrix plugin not enabled by default
- Auth profiles not copied
- Port conflicts not handled gracefully

**Already Fixed (partial):** Commit 8197c35
- ✅ Auto-enable Matrix plugin
- ✅ Copy auth profiles
- ❌ Port conflict handling still manual

**Remaining Work:**
- Better port conflict detection/resolution
- Health checks after spawn
- Automatic retry on failure

**Phase:** Part of TypeScript migration

---

## Design Questions

### Message Routing Architecture
**Question:** How should we route messages between contexts?

Current issues:
- Internal workflow messages leak to public rooms
- Unclear boundaries between Telegram, Matrix DM, Matrix public

**Need to define:**
- Public vs private message classification
- Cross-context message routing rules
- Approval/notification channels per context

---

### Agent Autonomy Level
**Question:** How autonomous should agents be?

Trade-offs:
- **Fully autonomous**: Agents negotiate without human approval → risk of bad deals
- **Human-in-loop**: Approval required for deals → safer but slower
- **Hybrid**: Auto-negotiate within bounds, ask for approval at decision points

**Current impl:** Unclear mix (approval messages but inconsistent)

**Proposal:**
- Seller: always require approval before accepting final price
- Buyer: autonomous within budget constraints, confirm before committing
- Clear approval UX via Telegram

---

## Test Coverage Gaps

1. **Multi-agent scenarios:** Multiple buyers competing for same item
2. **Edge cases:** Rude messages, unreasonable offers, scams
3. **Failure modes:** Network issues, timeouts, stuck negotiations
4. **Long conversations:** >10 message exchanges
5. **Concurrent negotiations:** Agent handling multiple DMs simultaneously

---

## Future Enhancements

- [ ] Negotiation analytics (success rate, avg discount, time to close)
- [ ] Agent personality tuning based on outcomes
- [ ] Structured negotiation protocol (offers, counteroffers, acceptance)
- [ ] Safety checks (price sanity, PII detection, scam patterns)
- [ ] Better logging/debugging for live runs
- [ ] Transcript replay for debugging

---

*Created: 2026-02-06*  
*Based on: Live test with @clawnesstestbot + switch_buyer*
