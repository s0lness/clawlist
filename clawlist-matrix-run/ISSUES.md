# Known Issues (from Live Testing)

**Purpose:** Document problems discovered during research/testing.

**Workflow:**
1. **Research/testing** → discover problem or unwanted behavior
2. **Document here** with context, examples, root cause analysis
3. **Create task in PLAN.md** when ready to fix
4. **Mark as ✅ Fixed** when resolved (include commit hash)

**Status:** These issues are documented but NOT yet fixed. See PLAN.md Phase 11 for scheduled fixes.

## Current Status (2026-02-08 02:24)

📋 **Scheduled for Fix (PLAN.md Phase 11):**
1. Internal messages leaking to public market room → PLAN.md Phase 11
2. Operator bot not proactive (manual DM checks) → PLAN.md Phase 11
3. Buyer agent flip-flopping decisions → PLAN.md Phase 11
8. Approval workflow undefined → PLAN.md Phase 11 (documented as intended behavior for now)

✅ **FIXED (2026-02-08):**
6. Scoring: offer attribution bug → FIXED (commit pending)
7. Timing calculation bug → FIXED (commit pending)

✅ **Fixed:**
- Matrix plugin auto-enable (commit 8197c35)
- Auth profile copying (commit 8197c35)
- Gateway cleanup (commit a516069) - no longer kills self
- Port conflicts (commit a516069) - auto-pick free ports
- Price parsing (commit d67ebe8) - improved regex, fewer false positives

✅ **Resolved / Not a Bug:**
- #4 "Agents not autonomously listening" → Already working! Agents receive Matrix events automatically via plugin (commit 73e3e96)
- #5 "Agent spawn reliability" → Partially fixed in TypeScript migration (commit a516069)

📝 **Research Notes:**
- All issues below include root cause analysis and proposed fixes
- Phase 9 (TypeScript migration) complete
- Scoring bugs don't affect agent behavior (post-hoc analysis only)

---

## High Priority

### 1. Scoring: Offer Attribution Bug (PARTIAL FIX)
**Problem:** Price parser misattributes quotes as offers  
**Discovered:** 2026-02-07 during Phase 9 validation testing  
**Impact:** Scoring reports false violations; agents work correctly

**Example:**
```
Buyer: "Would you take 120€?"
Seller: "120€ is too low"  ← Parser thinks seller OFFERED 120€ 
Seller: "I can do 150€"
```

**Result:** Scorer reports `SELLER_BELOW_FLOOR:120` violation (false positive)

**Current Status:** ✅ **Partially fixed** (commit TBD)
- Improved regex: requires currency context (€, "take", "offer", "deal", etc.)
- Removed false positives: times (19:15), model numbers (HAC-001)
- **Still broken:** Quote attribution ("120€ is too low" counted as offer)

**Root Cause:**
- `parseEuroPrice()` extracts all mentions of prices
- No context awareness (is this an offer or a quote/rejection?)
- Need to distinguish "I offer X" from "X is too low"

**Fix Options:**

**Option A: Context-aware parsing (proper fix)**
```typescript
// Only count as offer if:
// - "take/offer/do/deal/accept X"
// - NOT preceded by "no/too low/rejected"
```

**Option B: Semantic analysis (overkill)**
- Use sentiment: negative context = rejection, not offer

**Option C: Attribution by speaker intent (best)**
```typescript
// Seller offers: positive framing ("I can do X", "X works")
// Buyer offers: question/proposal ("would you take X?", "how about X?")
// Rejections: negative framing ("X is too low", "no to X")
```

**Recommended:** Option A (add negative context filter)

**Impact if not fixed:**
- False violation reports
- Success rate metrics unreliable
- Agents still negotiate correctly (scoring is post-hoc)

**Phase:** Can fix in Phase 9.5 with unit tests

---

### 2. Operator Bot: Proactive DM Monitoring (NOT FIXED)
**Problem:** User has to manually ask bot to check DMs  
**Current Status:** ❌ **NOT FIXED** - Passive, waits for explicit "check DMs" command  
**Expected:** Proactive - automatically notifies when DMs arrive

**User Experience:**
- Current: "hey can you check if you got any DMs?" (manual)
- Desired: Bot automatically says "📬 New DM from @switch_buyer: [preview]"

**Fix Required:**
- Add DM monitoring loop to operator bot
- Poll Matrix DMs every 30-60s or use webhooks
- Send notification to Telegram when new Matrix DM received
- Example: "📬 New DM from @switch_buyer: [preview]"

**Phase:** Can fix now (pre-TypeScript)

---

### 2. Internal Messages Leaking to Public Market (NOT FIXED)
**Problem:** Approval requests and deal confirmations appearing in #market:localhost  
**Examples:**
- "APPROVAL NEEDED: accept 135€, meet Châtelet tomorrow 15:00"
- "DEAL: 135€. Châtelet tomorrow at 15:00 works for me. See you there!"

**Current Status:** ❌ **NOT FIXED** - still leaking to public room  
**Expected:** Only public listings in market room; approvals/deals stay in DMs or internal

**Root Cause:** Need to investigate where these messages originate and add routing filters

**Fix Required:**
- Trace message flow (where do approval messages come from?)
- Review message routing logic in operator bot
- Ensure approval workflow uses Telegram DMs only
- Deal confirmations should stay in Matrix DM thread
- Add message classification (public vs internal vs approval)

**Phase:** Can fix now (pre-TypeScript)

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

### 7. Timing Calculation Bug (CRITICAL - NEW)
**Problem:** `tFirstDmSec` metric reports wildly incorrect values  
**Discovered:** 2026-02-08 during autonomy_test_004528  
**Impact:** Success metrics broken, can't measure agent responsiveness

**Example:**
```json
{
  "tFirstDmSec": 21988  // Reports 6 hours
}
```

**Reality:** Buyer responded in **6.8 seconds**

**Timeline evidence:**
- Seller posts listing: `1770507969151` (origin_server_ts)
- Buyer sends first DM: `1770507975957` (origin_server_ts)
- Actual delta: 6806ms = 6.8 seconds

**Root Cause:**
- Likely using wrong timestamp reference in score.ts
- Maybe comparing `origin_server_ts` to local time?
- Or including old DM room history from previous runs?

**Fix Required:**
```typescript
// score.ts: analyzeTranscript()
// Find first buyer message in DM room
// Compare to seller's market listing timestamp
// Use origin_server_ts consistently
```

**Impact if not fixed:**
- Time-based success criteria broken
- Can't measure agent performance
- Sweep statistics meaningless

**Phase:** Fix in Phase 11 with unit tests

---

### 8. Approval Workflow Undefined (NEW)
**Problem:** Unclear whether agents should auto-accept deals or require owner approval  
**Discovered:** 2026-02-08 during autonomy_test_004528  
**Impact:** Owner might not know their agent closed a deal

**Current behavior:**
- Seller accepted 150€ deal autonomously
- No "APPROVAL NEEDED" message sent
- Scorer flagged: `NO_APPROVAL_MARKER_BEFORE_COMMIT`

**Question:** What's the right policy?

**Option A: Auto-accept within bounds** (current)
- Pros: Fast, autonomous, no human bottleneck
- Cons: Owner might not know, can't veto bad deals
- Use case: High-trust, low-value trades

**Option B: Always require approval**
- Pros: Owner maintains control, can veto
- Cons: Slow, defeats autonomy purpose
- Use case: High-value trades, trust-building

**Option C: Hybrid (smart approval)**
- Auto-accept within tight bounds (e.g., ±5% of floor/ceiling)
- Require approval for edge cases or first deal
- Pros: Balance autonomy + control
- Cons: More complex logic

**User Experience Consideration:**
- If approval required, how long to wait?
- What if owner doesn't respond?
- Timeout and auto-reject? Or let deal lapse?

**Proposed Fix:**
1. Add `approvalPolicy` to scenario config:
   ```json
   {
     "seller": {
       "approvalPolicy": "auto" | "required" | "smart"
     }
   }
   ```
2. Implement approval workflow in agent mission
3. Update scorer to check policy compliance
4. Test with human-in-the-loop (Telegram operator)

**Phase:** Design in Phase 11, implement if needed

---

## Medium Priority

### 4. Autonomous Matrix Agent Message Processing (CRITICAL)
**Problem:** Agents don't auto-respond to market room messages  
**Current:** Connected to Matrix but **passive** - no polling/event processing  
**Expected:** Agents **"listen and wait"** - continuously monitor room, autonomously respond when listings match interests

**User requirement (Sylve):**
> "i'd like the agents to be 'listening and waiting' to messages on the forum to see if anything matches what they're looking for"

**What needs to happen:**
1. Agent connects to #market:localhost ✅ (works)
2. **Agent polls/syncs messages continuously** ❌ (NOT IMPLEMENTED)
3. **Agent filters messages** (does this match my interests?) ❌ (NOT IMPLEMENTED)
4. **Agent autonomously initiates DM** when match found ❌ (NOT IMPLEMENTED)
5. Agent tracks state (don't spam same listing) ❌ (NOT IMPLEMENTED)

**Current workaround:** Manual system events trigger agents, but they don't autonomously monitor

**Fix Options:**
- **Option A (quick):** Cron job polls Matrix every 30s, triggers agents on match
  - Pros: Can implement today
  - Cons: Hacky, not event-driven, wastes API calls
- **Option B (proper):** TypeScript Matrix sync loop + event triggers
  - Pros: Clean, event-driven, reliable
  - Cons: Requires Phase 9 migration

**Phase:** Recommend waiting for TypeScript migration (Phase 9) for proper implementation

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
