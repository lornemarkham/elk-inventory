# Architecture Exploration: Engineering Decisions as a First-Class Object

**Type:** Architecture exploration — no implementation
**Status:** Open for future design. Not scheduled.
**Date:** 2026-06-21
**Extends:** `architecture/information-architecture-v2.md`, `vision/product-brain.md`
**Related:** `concepts/inventory-goals.md`, `concepts/ai-decision-support.md`, `concepts/project-assets.md`

---

## 1. The Problem This Explores

Building ELK Power surfaced a gap that ownership-tracking can't close: the hard part was never remembering *what* was bought. It was remembering *why* — why this fuse holder and not another, what problem it solved, what it had to be compatible with, and whether that decision had already been made six months ago. Today the workflow is: ask AI → search Amazon → compare near-identical parts → buy → forget the reasoning → repeat the research next project.

This is close to two friction loops already named in `concepts/friction-reduction.md` — the Context Switch Loop ("re-investigate, re-figure-out, re-plan") and the Shopping List Blind Spot — but neither is actually solved by the mechanism those loops currently prescribe (capability goal checks, duplicate detection). Both of those mechanisms answer "do I have it." Neither answers "did I already decide this."

This document asks: should "the reasoning behind a chosen part" become a first-class object, where does it live, and what would it unlock. It does not propose a schema or a UI.

---

## 2. Is "Engineering Decision" a Genuinely New Object?

**Yes.** Three reasons, each load-bearing on its own:

**No existing object carries "why."** `InventoryItem` has no rationale field. The not-yet-built `GoalRequirement` (see `concepts/inventory-goals.md`) has no rationale field — it carries `matchStrategy`, `matchValue`, `estimatedCost`, but nothing about *why* a particular instance was chosen over alternatives. The not-yet-built `Purchase` model (IA v2 §10) starts at "Buy Decision" — already past the point where the interesting decision was made. Nothing in the current or planned model captures the moment of choice.

**The lifecycle starts before any commitment exists.** Need Identified → Research → AI Recommendation → Approved all happen with no item, no purchase, and no inventory record yet. Every existing lifecycle in this system — `LifecycleState` in `src/types/inventory.ts`, the Purchase lifecycle in IA v2 §10 — begins at or after the point of acquisition. An Engineering Decision is the only object in this domain model that needs to exist meaningfully *before* anything physical or financial happens.

**It can validly never resolve to an item.** Not every engineering decision is "which part." Some are "12V vs. 24V system architecture" or "3-wire vs. 2-wire sensor topology" — decisions worth remembering forever that never produce a single purchasable thing. No existing object can represent a decision with no corresponding asset; every current object is either an asset or a computed match against assets.

### How it compares to its closest existing cousin

`GoalRequirement` is the nearest thing already designed. They are siblings, not the same object:

| | GoalRequirement | Engineering Decision |
|---|---|---|
| Answers | "Do I have *a* torque wrench?" (category-level) | "We chose *this* fuse holder, for *this* reason" (instance-level) |
| Reusable across goals/projects? | Yes — generic, templated | No — tied to one specific choice in one context |
| Carries rationale, alternatives, confidence? | No | Yes, by definition |
| Can exist with zero matching items forever? | Treated as a gap to close | Can be a permanent record (pure design decision) |
| Status source | Computed live against current inventory | Tracked through its own funnel, only deferring to the item once one exists (see §7) |

Both are useful. Neither replaces the other. A goal like "Dirt Bike Home Maintenance" still wants generic requirements ("a torque wrench, any brand"). A project like "ELK Power v1" wants the specific, reasoned commitment ("this MAXI fuse holder, because...").

---

## 3. Where Does It Belong — Inventory, Projects, or Product Brain?

**Product Brain, scoped through a Project, referencing Inventory.** Not a tie — each of the other two options fails for a specific reason:

**Not Inventory.** `InventoryItem`'s job, per `concepts/inventory-scope-by-intention.md`, is ownership, location, and condition. Bolting rationale/confidence/alternatives fields onto `InventoryItem` repeats exactly the schema-sprawl mistake IA v2 §13 warns about for pantry fields — most items would carry these fields as permanently empty, and worse, it conflates "what I have" with "why I have it." It also can't represent the pre-acquisition states (§2) — there's no item to attach a field to yet.

**Not Projects alone.** Projects are the right *scope*, but not the right *layer*. A Project is, per IA v2 §8, a cross-collection reference object — currently a string field on `InventoryItem` (`project: string | null`, confirmed in `src/types/inventory.ts`), with a future as a top-level entity (Approach A, deferred). Decisions need to live in something that itself spans collections and apps — which Projects do — but the *kind of content* a decision holds (rationale, confidence, "have we already decided this") is squarely the definition just written for the Product Brain in `vision/product-brain.md`, not a property of project management itself.

**Therefore: Product Brain is the layer, Project is the scope.** An Engineering Decision lives in the Product Brain, is scoped to a Project, and optionally resolves to an Inventory Item once one exists:

```
Product Brain
  └── Engineering Decision  (scoped to a Project; the "why")
         resolves to (0 or 1) → Inventory Item  (the "what" and "where")

Project                      (cross-collection scope; the "what for")
  └── has many → Engineering Decisions

InventoryCollection           (Garage, Pantry, Garden, ...; the "what I own")
  └── has many → Items, Zones, Goals
```

### A sequencing dependency this creates

Decisions need a real home to be scoped to. Right now Projects are a string field, not an entity. IA v2 §8 explicitly deferred promoting Project to a first-class object ("Approach B now... Approach A later"). This exploration doesn't change that recommendation, but it does add a reason to revisit it sooner: **Engineering Decisions have nowhere clean to live until Project is a real entity.** That's worth knowing the next time Milestone scope is chosen — not a reason to build Project now, just a reason it's no longer a "someday, low-priority" promotion.

---

## 4. Is "Project BOM" the Right Abstraction?

**No — and the fix is the same pattern IA v2 already uses elsewhere.** "BOM" carries an inherited assumption from manufacturing: a list of parts. That framing is exactly what's being rejected here — a BOM-as-parts-list can't hold "why," can't exist before a part is chosen, and can't represent a decision that never resolves to a part.

IA v2 §9 already establishes the pattern for this: `CollectionGoal` readiness is explicitly "a pure function: `computeReadiness(goal, items) → GoalReadiness`. No stored state needed." A BOM should follow the identical pattern — **a computed projection over Engineering Decisions, not a stored entity of its own.** "Show me the BOM for ELK Power v1" becomes: take every Decision scoped to that project, filter to ones that resolved to an item (or are at least Approved), and project out the part list, quantities, and cost. The Decision Log is the source of truth; the BOM is a report rendered from it — the same relationship "dashboard" already has to raw inventory data in IA v2 §12.

This also sidesteps a specific failure mode IA v2 already flagged once: §3 Risk 3 describes how reusing the word "Collection" for two different things created direct confusion. "BOM" risks the same collision — useful informally (it's a familiar engineering term, and ELK Power genuinely is an engineering project), but dangerous as a data-model noun if a literal, simpler "flattened shopping list" feature is ever wanted later. Keeping BOM as a *view label* and **Decision Log** (or Decision Ledger) as the *stored entity name* avoids that collision before it can happen.

---

## 5. Relationship to the Goals Model

Today, `GoalRequirement` status is binary-ish: met / missing / unknown / partial / ordered, computed by searching current inventory (`concepts/inventory-goals.md`). There's no status for "we've already decided exactly what to buy, we just haven't bought it yet" — that's currently indistinguishable from plain "missing," which throws away real information (and is precisely the information that prevents re-research).

If a Decision Log existed, goal readiness computation could check it before falling back to "missing" — turning a flat gap report into one that distinguishes *truly unaddressed* gaps from *already-decided, not-yet-purchased* ones. This is an idea worth preserving, not a change to make now — `inventory-goals.md` and its readiness computation are still "not yet implemented," and this would be a refinement on top of a refinement.

---

## 6. Relationship to AI Decision Support

`concepts/ai-decision-support.md` lists seven things AI should help decide — duplicate-purchase checks, blocker detection, best-next-step, local-vs-online, substitution, urgency, goal alignment. Every one of those is currently specified as a *live computation from inventory data, every time*. A Decision Log changes that from "reason from scratch" to "check memory first, then reason only about what's new" — which is the literal definition of the Product Brain (`vision/product-brain.md`): understanding that persists, instead of facts that get re-interpreted on every query.

Concretely, the AI's first move for "what fuse holder should I buy?" should become "have we already decided this?" before it becomes "let me compare products" — exactly the behavior the user described wanting in the original framing of this idea. That reordering only works if there's somewhere to check.

This is also where the friction risk in §9 gets its cheapest mitigation: a future chat-driven AI recommendation is the natural place to *draft* a Decision record (rationale, alternatives, confidence) from the conversation itself, with Lorne approving or editing rather than typing it from scratch.

---

## 7. Decisions Should Not Duplicate Item Lifecycle

The decision lifecycle (Need Identified → Research → AI Recommendation → Approved → Ordered → Received → Installed → Used) and the existing asset lifecycle (`concepts/project-assets.md`'s `ordered → available → in-use/installed/retired/...`) look similar enough to tempt merging them into one enum. They shouldn't be.

The first four decision states have no item to attach a lifecycle to — they're pre-acquisition by definition. Once a Decision resolves to an item (Ordered onward), tracking lifecycle a second time on the Decision risks the two falling out of sync — the classic dual-source-of-truth problem. The cleaner shape: the Decision owns the pre-resolution states outright; once `resolvedItemId` is set, "what state is the physical thing in" should defer to that item's own `lifecycleState`, not duplicate it.

---

## 8. Compatibility Is a Graph, Not a Field

The example that motivated this whole idea — "Compatible With: Blue Sea 5141-BSS MAXI Fuse" — describes a relationship, not an attribute. Compatibility is bidirectional and many-to-many (a fuse holder is compatible with several fuse ratings; a fuse rating fits several holders), and it can hold between two Decisions, two Items, or a Decision and an Item not yet owned. Modeling it as a string list on one record (as the original example sketch did) would only capture one direction and would drift the moment either side changes. Worth flagging now so it isn't accidentally designed as a flat field later: compatibility is its own relationship concern, sitting in the Product Brain layer alongside Decisions, not inside any single Decision record.

---

## 9. The Friction Risk This Idea Carries

This is worth stating plainly because the rest of this document is making the case *for* the idea: a rich decision record is structurally more to fill in, not less — directly in tension with `founder-notes-lorne.md`'s "enrichment is optional" and `concepts/friction-reduction.md`'s anti-pattern, "the system becomes its own admin task." Rationale, confidence, and alternatives-considered are exactly the kind of fields that feel valuable in the abstract and become a chore in practice if they're ever required at capture time.

The mitigation isn't a feature to design now, but a constraint to hold onto when this is eventually built: most items will never warrant a Decision record (this is the same "not everything needs tracking" judgment `concepts/inventory-scope-by-intention.md` already applies to Inventory, one level up — applied here, most purchases don't need engineering memory, only the ones where the reasoning has lasting value). And per §6, the lowest-friction path to populating these records is having the AI draft them from the conversation that already produced the decision, not asking Lorne to write them by hand.

---

## 10. What Future Capabilities This Unlocks

Tied to questions and friction loops that are already documented but currently have no real mechanism behind them:

- **"Have I already made this decision?"** — today, nothing in the system can answer this. It's the single biggest gap this idea closes.
- **"What's blocking ELK Power v1?"** at decision granularity, not just item granularity — distinguishing "still researching" from "decided, not yet ordered" from "ordered, not yet received."
- **Cross-project decision reuse** — a power-protection decision made for ELK Power becomes available context for an ELK Garden node build, consistent with the shared, cross-app Product Brain described in `vision/product-brain.md`.
- **A real engineering journal** — answers "why did we choose this six months ago?" without Lorne having to remember or reconstruct it, directly addressing the Context Switch Loop in `concepts/friction-reduction.md`.
- **Better-grounded AI Decision Support** — recommendations that check memory before reasoning from scratch (§6), and that can say "you already decided this, with this confidence, on this date" instead of re-litigating it.

---

## 11. Open Questions — Deliberately Left Open

- Is an Engineering Decision always scoped to exactly one Project, or can one decision serve multiple projects (a standardized component choice reused across builds)?
- Should "confidence" stay a personal heuristic (a number Lorne assigns), or could the AI eventually calibrate or contest it?
- Where does a pure architecture/design decision with no resolved item ever surface in the UI, if not as a BOM line item?
- Does the Decision Log want its own browsing surface, or does it only ever appear inside a Project view and inside AI responses?

These are intentionally not answered here — they're the right starting questions for whoever (Lorne or a future AI agent) eventually scopes the real design.

---

## 12. Summary Position

Engineering Decision is a genuinely new object — no existing or planned object in this system carries rationale, pre-acquisition lifecycle states, or the ability to exist without ever resolving to an asset. It belongs in the Product Brain layer (`vision/product-brain.md`), scoped through Projects, loosely referencing Inventory Items. "Project BOM" should survive only as a computed report rendered from a Decision Log — never as the stored entity itself, for the same reason `CollectionGoal` readiness is computed rather than stored (IA v2 §9).

This creates one concrete sequencing implication: Project should be promoted from a string field to a first-class entity sooner than "later," since Decisions have nowhere coherent to live until it is. Everything else here is intentionally unresolved.

**Do not implement.** This document exists so that when Project-as-entity work begins, or when AI Decision Support moves from concept to code, this shape has already been thought through instead of being designed under deadline pressure.
