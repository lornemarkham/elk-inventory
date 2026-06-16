# ELK Inventory — Product Documentation

**This folder is the long-term memory of the product.**

Ideas, decisions, and vision that live only in chat threads get lost. Everything important lives here. Future AI agents, collaborators, or future-Lorne should start here before making any significant product or architecture decision.

---

## Mission

**ELK exists to reduce friction between intention and action.**

Know what you have. Know where it is. Know what you're capable of. Know what's missing. Spend less time searching and more time living.

**Reduce friction. Increase capability. Create calm.**

---

## Where to Start

If you are new to this project (or returning after a long break), read these in order:

1. [Life Operating System — the vision](vision/life-operating-system.md) — What this is, what it's not, why it exists
2. [Founder Notes — Lorne](vision/founder-notes-lorne.md) — Raw product beliefs, personal motivation, what matters
3. [Friction Reduction — the core concept](concepts/friction-reduction.md) — The loops this product breaks and why
4. [Current Roadmap](roadmap/current-roadmap.md) — What's built, what's next, guiding questions

---

## Vision

| Document | Summary |
|---|---|
| [Life Operating System](vision/life-operating-system.md) | Long-term vision, mission, core questions, what this is not |
| [Founder Notes — Lorne](vision/founder-notes-lorne.md) | Personal motivation, product beliefs, first-user principles |
| [Future Market and Tiers](vision/future-market-and-tiers.md) | Early thinking on market fit and future pricing — not current priority |

---

## Key Concepts

| Document | Summary |
|---|---|
| [Friction Reduction](concepts/friction-reduction.md) | The product's core purpose — common friction loops and the desired loop |
| [Inventory Scope by Intention](concepts/inventory-scope-by-intention.md) | What to track and what not to track, based on the user's goal |
| [Asset Lifecycle](concepts/project-assets.md) | All 12 lifecycle states — purchased through retired |
| [Inventory Goals](concepts/inventory-goals.md) | Capability plans: dirt bike maintenance, solar node, 30-day pantry |
| [Capability Gaps](concepts/capability-gaps.md) | The difference between ownership and capability |
| [Life Inventory — Domains](concepts/life-inventory.md) | All 9 future domains: garage, electronics, garden, pantry, pool, property, emergency, vehicles, projects |
| [Purchase Intake](concepts/purchase-intake.md) | How new purchases enter the system — draft queue, classification, duplicate detection |
| [AI Decision Support](concepts/ai-decision-support.md) | Future AI layer — what it decides, what it doesn't do, implementation order |

---

## Roadmap

| Document | Summary |
|---|---|
| [Current Roadmap](roadmap/current-roadmap.md) | Milestones 1 and 2 complete; M3 options evaluated; M4–M5 scoped |

---

## Architecture

| Document | Summary |
|---|---|
| [Information Architecture v2](architecture/information-architecture-v2.md) | **Definitive architecture review** — 16-section analysis of collection-first vs inventory-first, recommended hierarchy, navigation, data models, goals model, purchase model, search model, dashboard, per-domain schema analysis, 7 concrete risks, 6-phase migration plan, and final recommendation |

> **Status:** Architecture review complete. Recommendation: migrate to collection-first before building any new features. See Phase 1–3 of migration plan.

---

## Architecture Decisions (ADRs)

| Document | Decision | Status |
|---|---|---|
| [ADR-0001: localStorage Before SQLite](decisions/0001-localstorage-before-sqlite.md) | Why localStorage was the right first step | Accepted |
| ADR-0002: Electron vs. Tauri | Native app wrapper choice | Not yet written |
| ADR-0003: SQLite Schema Design | Data model for multi-domain inventory | Not yet written |

---

## Domain Notes

The `domains/` folder will hold domain-specific notes as each domain gets built.

| Domain | Status | Notes |
|---|---|---|
| Garage | Active — Milestones 1 & 2 complete | Primary domain |
| Electronics | Partially modeled | ELK Garden components tracked |
| Pantry | Not yet started | See `concepts/life-inventory.md` |
| Pool | Not yet started | See `concepts/life-inventory.md` |
| Garden | Not yet started | ELK Garden app manages installed assets |
| Emergency | Not yet started | See `concepts/life-inventory.md` |
| Vehicles | Partially modeled | Truck Kit zone exists |
| Property | Not yet started | Long-term |

---

## Guiding Product Questions

Every feature should be evaluated against these:

1. Where is it?
2. Do I already own it?
3. What am I missing?
4. What is blocking me?
5. What am I capable of?
6. What should I prioritize?
7. What did I buy that still needs a home?
8. What should become inventory and what should be ignored?

If a proposed feature doesn't help answer at least one of these, it probably shouldn't be built yet.

---

## Permanent Constraints

1. Local-first — no cloud dependency for core functionality
2. No auth — personal tool, single user, no login
3. No overbuilding — implement what is needed now
4. Fast capture — under 60 seconds to add an item
5. Readable in a garage — 16px+ body text, high contrast, phone-friendly
6. Data portability — always exportable as plain JSON
7. Build for Lorne first — every feature passes the "does this help Lorne?" test
