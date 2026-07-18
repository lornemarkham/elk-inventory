# Vision: The Product Brain

**Status:** Active vision — not yet implemented
**Last updated:** 2026-06-21

---

## Why This Document Exists

This concept was already treated as settled architecture in conversation before it had ever been written down anywhere in this repo. That is exactly the failure mode `docs/README.md` was created to prevent — "ideas, decisions, and vision that live only in chat threads get lost." This document closes that gap so the Product Brain stops being a thing only Lorne remembers and starts being a thing the system is designed around.

---

## The Core Distinction

**Inventory stores facts. The Product Brain stores understanding.**

Inventory knows:
- I own a Blue Sea 5141 MAXI fuse.
- I own a Victron SmartShunt.
- I own a Renogy Rover.

The Product Brain knows:
- Why those components were chosen.
- Which project they belong to.
- What engineering decisions led to them.
- What alternatives were considered.
- What compatibility constraints exist between them.
- What still needs to be purchased.
- What risks or blockers remain.
- What the next recommended action is.

This is the same relationship `concepts/ai-decision-support.md` already draws between inventory and AI — "the AI is not the product. The inventory is the product. The AI is the layer that turns raw inventory data into actionable guidance" — except the Product Brain is the *persistent memory* that guidance gets written to, not just a real-time computation over current stock. AI Decision Support reasons. The Product Brain remembers what was already reasoned, so the AI doesn't have to re-derive it every time.

---

## What the Product Brain Should Eventually Answer

- What should I work on next?
- What am I missing to finish ELK Power?
- Why did we choose this part six months ago?
- Can I build another garden node with what I own?
- What decisions have already been made, so I don't repeat research I've already done?

These are not inventory questions. An inventory, no matter how complete, cannot answer "why" or "have I already decided this." It can only answer "do I have it."

---

## Relationship to Other ELK Apps

The long-term vision (consistent with `vision/life-operating-system.md`'s description of ELK Inventory as "the asset backbone" for other ELK apps) is that the Product Brain is a **shared memory layer above the asset backbone** — every ELK application (Inventory, Garden, Wrench, Pool, Kitchen, Lark) contributes engineering decisions and consumes them to make better future recommendations. A fuse holder decision made for ELK Power's battery protection should be available context the next time ELK Garden needs to protect a solar node, without re-researching from scratch.

This makes the Product Brain cross-cutting in the same way Projects are cross-cutting in `architecture/information-architecture-v2.md` §8 — it deliberately does not live inside any single `InventoryCollection`.

---

## What This Is Not

**Not a replacement for the inventory data layer.** The Product Brain sits above inventory and references it. It does not duplicate ownership facts, location, or condition — those stay in Inventory, where they already belong.

**Not a journaling requirement.** This is not asking Lorne to write essays about every purchase. Most items will never have a Product Brain record — only the ones where the *reasoning* itself has lasting value (see `architecture/engineering-decisions.md` for where that line gets drawn).

**Not a chatbot.** Same caution as `concepts/ai-decision-support.md` — the value is in the memory and the recall, not in a conversational interface.

---

## Status

Preserve this philosophy when evaluating future architecture. If a new concept appears to be about decision history, organizational memory, engineering rationale, or future recommendations rather than asset facts, it likely belongs to the Product Brain, not to Inventory or any single Collection.

**Do not implement.** This document exists so that future architecture decisions — particularly how Projects, Goals, and AI Decision Support evolve — leave room for this layer rather than precluding it.

See `architecture/engineering-decisions.md` for the first concrete exploration of an object that lives in this layer.
