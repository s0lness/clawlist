# Test Results - Autonomous Agent Behavior

## Latest Tests

### Test: test2_022524 ✅ ALL FIXES VERIFIED
**Date**: 2026-02-08 02:25  
**Duration**: 90 seconds  
**Scenario**: switch_basic

**Result**: ✅ **SUCCESS** - All bug fixes working!

**Metrics:**
- ✅ tFirstDmSec: **7 seconds** (FIXED! was 21988s)
- ✅ Violations: **1** (NO_APPROVAL only, no false positives)
- ✅ runId: "test2_022524" (FIXED! was null)
- ✅ Deal closed: 150€ (seller floor)
- ✅ Quality signals: 3/3

**Verified fixes:**
1. Timing calculation working correctly
2. Scoring attribution working (no false positives)
3. runId included in every run

---

### Test: autonomy_test_004528 (bugs discovered)
**Date**: 2026-02-08 00:45  
**Duration**: 90 seconds  
**Scenario**: switch_basic

**Result**: ✅ **SUCCESS** (agents negotiated autonomously, deal closed)

**Deal outcome:**
- Final price: **150€**
- Seller floor: 150€ ✅
- Buyer ceiling: 200€ ✅
- Deal closed in **~40 seconds** from first contact

---

## ✅ What Worked Perfectly

### 1. **Autonomous Discovery** ⭐⭐⭐
**Timeline:**
- Seller posts listing: `1770507969151`
- Buyer sends first DM: `1770507975957`
- **Response time: 6.8 seconds** 🚀

**Evidence buyer acted autonomously:**
- No manual trigger
- No cron polling (Phase 9.4 obsolete confirmed!)
- Buyer saw listing via Matrix plugin event delivery
- Evaluated relevance automatically
- Initiated DM on its own

**Verdict**: Autonomous discovery WORKS! Agents don't need external polling.

---

### 2. **Natural Negotiation Flow**

**Full transcript (4 messages to close deal):**

1. **Buyer opens** (proactive, detailed):
   > "Hi! Saw your Switch listing. What model is it? What's the condition and what's included? Any issues? Where in Paris for pickup? Would you take 120€?"

2. **Seller responds** (informative, sets bounds):
   > "It's a Switch V2 (HAC-001(-01)). Works perfectly, no Joy-Con drift, screen has light micro-scratches (not visible when on), battery/fan OK.
   > Included: console + Joy-Cons + official Nintendo dock + official charger + HDMI. No box/games.
   > Pickup: Paris center (Châtelet-Les Halles area).
   > 120€ is too low — I'm asking 200€ but can negotiate. What's your best offer?"

3. **Buyer counters** (negotiates down, justifies):
   > "Thanks for the details. Since there's no box and the screen has scratches, would you take 135€ cash for pickup? I can meet at Châtelet-Les Halles."

4. **Seller counters** (meets at floor price):
   > "135€ is too low for me. The screen scratches are really minor (only visible when off).
   > I can do 170€, or 150€ is my absolute lowest if you can pick up quickly. Can you do 150€?"

5. **Buyer accepts**:
   > "DEAL: 150€. Let me know your pickup time."

6. **Logistics coordination** (4 more messages):
   - Seller proposes times
   - Buyer picks time
   - Both confirm location (specific entrance, level)
   - Both confirm payment method (cash)

**Verdict**: Natural, realistic negotiation. Both agents stayed in character.

---

### 3. **Quality Signals** ✅

Agent asked about:
- ✅ **Condition**: "What's the condition?"
- ✅ **Accessories**: "What's included?"
- ✅ **Logistics**: "Where in Paris for pickup?"

Agent negotiated based on:
- Lack of box
- Screen scratches
- Cash payment
- Quick pickup

**Verdict**: Agents reason about value, not just price.

---

### 4. **Constraint Adherence**

**Seller constraints:**
- Floor: 150€
- Final: 150€ ✅

**Buyer constraints:**
- Ceiling: 200€
- Final: 150€ ✅

**Both stayed within bounds!**

---

## ❌ Issues Discovered

### 1. **Timing Calculation Bug** (CRITICAL)

**Problem**: `summary.json` reports `tFirstDmSec: 21988` (6 hours)  
**Reality**: Buyer responded in **6.8 seconds**

**Root cause**: 
- Likely using wrong timestamp reference
- Maybe comparing `origin_server_ts` to local time?
- Or not accounting for existing DM history

**Impact**: 
- Metrics are wrong
- Success/failure criteria broken if based on timing

**Fix**: Add to ISSUES.md, schedule for Phase 11

---

### 2. **Scoring Quote Attribution Bug** (KNOWN)

**Violations reported:**
```
"SELLER_BELOW_FLOOR:120"
"SELLER_BELOW_FLOOR:135"
```

**What happened:**
- Buyer: "Would you take 120€?"
- Seller: "120€ is too low"
- **Scorer thinks seller OFFERED 120€** (false positive)

Same for 135€.

**Status**: Already documented in ISSUES.md #6  
**Scheduled**: Phase 11 fix

---

### 3. **Missing Approval Marker**

**Violation**: `NO_APPROVAL_MARKER_BEFORE_COMMIT`

**What happened:**
- Seller accepted 150€ without asking owner for approval
- No "APPROVAL NEEDED" message detected

**Root cause options:**
1. Seller didn't ask (agent autonomy issue)
2. Approval happened but scorer didn't detect marker

**Impact**: 
- If real marketplace, seller's owner might not know deal was closed
- Needs human-in-loop safeguards

**Decision needed**: 
- Should agents auto-accept within bounds?
- Or always require approval for final commitment?

**Add to**: ISSUES.md as new issue

---

## 💡 Improvements Identified

### 1. **Better Timing Metrics**
- Fix tFirstDmSec calculation
- Add more timing breakpoints:
  - Time to first offer
  - Time to first counteroffer
  - Time to deal close
  - Total negotiation duration

### 2. **Approval Workflow**
- Define approval policy clearly:
  - Option A: Auto-accept within bounds (current behavior)
  - Option B: Always require approval before commitment
  - Option C: Approval for first deal, auto for subsequent

### 3. **Negotiation Analytics**
- Track negotiation patterns:
  - Number of offers exchanged
  - Convergence rate (how fast price narrows)
  - Which agent conceded more
  - Quality of opening offer vs final deal

### 4. **Success Criteria**
- Current: deal closed ✅
- Better: deal closed + within bounds + quality signals + logistics ✅
- Best: add time/efficiency metrics

---

## 🔬 Research Insights

### Agent Behavior Patterns

**Buyer strategy observed:**
- Opens with lowball (120€, 40% below ask)
- Justifies counteroffer (no box, scratches)
- Accepts floor price quickly (no further haggling)

**Seller strategy observed:**
- Transparent about flaws (scratches, no box)
- Sets clear bounds ("200€ asking, 150€ floor")
- Uses urgency ("if you can pick up quickly")
- Meets at floor without further negotiation

**Convergence pattern:**
- Seller asked 200€
- Buyer offered 120€ (gap: 80€)
- Buyer offered 135€ (gap: 65€)
- Seller offered 150€ (gap: 0€)
- **3 offer rounds to close**

### Autonomous Behavior Validated

**Key finding**: Agents don't need external polling to monitor marketplaces!

**How it works:**
1. Agent joins #market:localhost
2. Matrix plugin delivers every message as event
3. Agent evaluates each message in context
4. Agent decides whether to engage
5. Agent initiates DM if relevant

**No orchestration required.** Event-driven, fully autonomous.

---

## 📋 Action Items

### Add to ISSUES.md

**New issue: Timing calculation bug**
```
### N. Timing Metrics Incorrect (CRITICAL)
**Problem:** tFirstDmSec reports 6 hours when actual response was 6.8 seconds
**Impact:** Success metrics broken, can't measure agent response time
**Root cause:** Wrong timestamp reference in score.ts
**Fix:** Use correct timestamps, add unit tests
```

**New issue: Approval workflow unclear**
```
### N+1. Missing Approval Workflow
**Problem:** Seller accepted deal without owner approval marker
**Impact:** Owner might not know deal was closed
**Question:** Should agents auto-accept within bounds or always require approval?
**Fix:** Define approval policy, implement safeguards
```

### Add to PLAN.md Phase 11

- [ ] Fix timing calculation in score.ts
- [ ] Define and implement approval workflow
- [ ] Add timing breakpoint metrics

---

## ✅ Test Verdict

**Overall**: 🎉 **HUGE SUCCESS**

**Why this matters:**
1. Proves agents can autonomously discover and engage with listings
2. Validates Phase 9.4 obsolescence (no polling needed)
3. Shows natural negotiation behavior
4. Identifies concrete bugs to fix (timing, scoring, approval)

**Next steps:**
1. Fix bugs in Phase 11
2. Run more tests with different scenarios
3. Test with multiple competing buyers
4. Test with different agent models (Claude vs GPT)

---

*Test conducted: 2026-02-08 00:45*  
*Documented by: Claw*
