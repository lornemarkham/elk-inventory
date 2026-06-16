# Concept: AI Decision Support

**Status:** Future capability — not yet implemented  
**Priority:** Long-term  
**Last updated:** 2026-06-12

---

## Overview

ELK Inventory will eventually include an AI layer that helps the user make better decisions — faster, with less cognitive load, and with more context than they could assemble manually.

The AI is not the product. The inventory is the product. The AI is the layer that turns raw inventory data into actionable guidance.

**The goal is not to create a chatbot. The goal is to create calm, clarity, and speed.**

---

## What AI Should Help Decide

### 1. Is this purchase aligned with my current goals?
> "You're considering a Milwaukee M18 impact driver. Your current battery platform is Ryobi ONE+. This tool would require a new battery ecosystem. You already own a functional impact driver in the Mechanic Bay. Is this a performance upgrade or a duplicate?"

The system has the data to answer this: existing tools, current battery platform, goal alignment, lifecycle state. The AI connects the dots instead of the user having to.

### 2. Is this project blocked?
> "Your Off-Grid Garden Solar Node build is blocked. You have all the electronics, but the solar panel, charge controller, and battery are not yet in inventory. These 3 items are the critical path. Want me to find them?"

The system knows what's owned, what's ordered, and what's missing for a goal. The AI translates that into a blocker statement and a recommended action.

### 3. What is the best next step?
> "You have an open evening. Based on what's in your garage and what projects are active, the most ready-to-start project right now is [project]. You have all required materials. The tools are in the Mechanic Bay. Here's the first step."

This is a high-value output — the system has all the data, the AI makes it actionable.

### 4. Should I buy locally or online?
> "The torque wrench you need is at Home Depot ($65) and on Amazon ($48, arrives in 2 days). Given that you're planning to start the maintenance this weekend, the Home Depot option gets you started sooner."

The system knows the goal, the timeline, and has context about urgency. The AI factors it in.

### 5. Can I already solve this with what I own?
> "You need a 3/8" drive for this job. You have a 3/8" ratchet in the Red Toolbox. You don't need to buy one."

Simple substitution logic, but the AI needs to understand tool types, drive sizes, and what "equivalent" means in context. This is the "do I already own this in a different form?" question.

### 6. Is this urgent or optional?
> "The pool chlorine is at 30% of your minimum stock level. Pool season is starting in 3 weeks. This is worth ordering now."

vs.

> "Your miter saw blades are at 2 of 5 originally owned. You haven't used the miter saw in 4 months. This can wait."

Context-aware urgency assessment, not just a low-stock alert.

### 7. Does this support family, resilience, learning, or current priorities?
> "Buying the Victron BatteryProtect supports your ELK Garden solar build. That project also builds skills in off-grid power systems. This aligns with both your current ELK Garden goal and your learning priorities. I'd buy it."

vs.

> "This looks interesting but doesn't connect to any current goal. It might be worth saving for later, unless you have a specific use in mind."

The AI helps filter impulse purchases against stated goals and priorities — not judgmentally, but with data.

---

## What Good AI Assistance Feels Like

The AI experience should be:

**Fast:** The answer should come back in under 3 seconds. No one waits for AI in a garage.

**Confident when it has data:** If the inventory clearly shows the item is owned and located, the AI should say so directly. Not "it seems like you might have..." — "You have this in the Mechanic Bay."

**Honest about uncertainty:** If the inventory data is incomplete, the AI should say: "Your inventory doesn't have a record for this. Did you want to add one, or check if it was already captured?"

**Concise:** One clear recommendation, not a five-paragraph essay. The user is standing in a garage, not reading a report.

**Non-annoying:** The AI should not comment on every action. It should surface when it has something useful to say. Silence is often the right output.

---

## What Bad AI Assistance Looks Like

**Chatbot-first design:** An AI that requires the user to type prompts and interpret responses is not the right model for a garage inventory tool. The AI should work in the background, surfacing insights proactively or in response to specific actions — not in a conversational interface that requires the user to form the right question.

**Hallucinated inventory:** The AI must only make assertions based on actual inventory data. Saying "you probably have that somewhere" when the item is not in inventory is worse than saying nothing.

**Creating anxiety:** Surfacing every gap, every low-stock item, every potential duplicate simultaneously is overwhelming. The AI should surface what's actionable now, not everything that could theoretically be improved.

**Blocking the user:** The AI should never require the user to interact with it before they can do what they came to do. It is an assistant, not a gatekeeper.

---

## Implementation Approach (When the Time Comes)

### Data Requirements
The AI layer requires accurate, current inventory data. Without it, the AI's outputs are unreliable or worse than useless. This is why the data layer (localStorage now, SQLite later) and the inventory capture flows (CRUD, purchase intake) must come first.

**AI is only as good as the data it has access to.**

### Local-First AI
Where possible, AI features should run locally or use minimal external API calls:
- Fuzzy matching and duplicate detection: can be done with client-side algorithms (fuse.js, etc.) — no AI needed
- Goal readiness calculation: pure logic from structured data — no AI needed
- Purchase classification: simple rule-based classifier first, then ML if the rule set becomes unwieldy
- Natural language queries: this is where an LLM is genuinely useful — "show me everything I need for the dirt bike project"
- Receipt/screenshot parsing: this is where OCR + LLM is useful

### LLM Integration (Future)
When an LLM is used:
- It should receive structured inventory data as context (not raw markdown)
- It should be given a clear, narrow task — not asked to "think about the inventory"
- Responses should be validated before surfacing to the user
- Latency budget: under 3 seconds for synchronous queries, longer for background analysis

### AI Features in Priority Order
1. **Fuzzy search** — already helpful, no LLM needed, pure client-side matching
2. **Duplicate detection** — name similarity at intake, client-side algorithm
3. **Purchase classification** — rule-based first (ignore movie rental, likely-inventory solar controller)
4. **Goal readiness calculation** — structured logic, no AI needed
5. **Natural language query** — "what do I need for the dirt bike project?" → LLM with inventory context
6. **Receipt/screenshot parsing** — OCR + LLM extraction
7. **Purchase recommendation** — "is this worth buying?" with goal context → LLM

---

## The AI Persona

If and when the system develops a conversational layer, the tone should match the product:

- **Competent, not clever.** Give direct answers, not demonstrations of intelligence.
- **Practical, not philosophical.** "You need a torque wrench" — not a discourse on torque specifications.
- **Calm.** Don't create urgency that doesn't exist. Don't dramatize gaps.
- **Brief.** The user is probably standing in a garage with dirty hands.
- **Honest.** If the data isn't there, say so. Don't invent confidence.

---

## Summary

AI in ELK Inventory is a future capability that makes inventory data actionable. It is not a chatbot. It is not the product. It is the layer that turns "I know what I have" into "I know what I can do and what I should do next."

Build the data layer first. Build the structure. Build the goals. Then the AI has something real to work with.

The sequence matters: **inventory → goals → AI**.
