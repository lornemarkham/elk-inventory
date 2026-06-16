# ELK Information Architecture Review — v2

**Type:** Product architecture exercise — no implementation  
**Status:** Final recommendation  
**Date:** 2026-06-13  
**Audience:** Lorne Markham, future AI agents, future collaborators

---

## 1. Executive Summary

ELK Inventory was built as an inventory management app. It is not, at its core, an inventory management app.

It is a friction reduction system — a tool that helps the user move faster from intention to action across every domain of their life. Inventory is the data layer that makes that possible. It is not the product itself.

The current application reflects the first mental model — inventory-first — because that was the natural starting point when building a tool tracker. Items, zones, and containers are all first-class objects in the UI. The user's first experience is a flat list of things they own.

**This is the wrong first experience.**

The user does not open this app to browse their inventory. They open it with a context: "I'm working on the dirt bike." "I need to prep for the weekend." "I want to smoke a brisket, what do I have?" The app should receive that context and respond to it — not present a wall of items and leave the user to navigate.

The correct architecture is **collection-first**: the user's domains of life (Garage, Pantry, Garden, Pool, Dirt Bike, Property) are the primary navigational objects. Inventory exists within collections. Zones exist within collections. Goals exist within collections. Everything is scoped to where the user is operating.

**The recommendation is clear: ELK should evolve from inventory-first to collection-first.**

The transition cost is low. The data model changes are minimal. The UI shift is significant but not a rewrite. The payoff is a system that reflects how a person actually thinks — context first, inventory second — and that can scale to every domain of life without collapsing under the weight of a flat global item list.

This document provides the full analysis: what the problem really is, what the current architecture gets wrong, what the correct architecture looks like, and exactly how to get there without breaking what works.

---

## 2. What Problem ELK Actually Solves

To build the right architecture, we have to be precise about the problem.

### The stated problem (inventory-first thinking):
"I need to track what I own."

### The actual problem:
"I want to spend less time searching, less time making unnecessary purchases, less time context-switching between projects, and more time doing things that matter — family, dirt biking, building, learning, gardening."

These are profoundly different problems. The first produces an inventory app. The second produces a life friction reduction system.

### The friction loops that matter

Every feature worth building in ELK closes one of these loops:

**The Lost Evening:**
> Want to do a project → discover a missing part mid-way → lose momentum → project stalls for weeks

**The Duplicate Purchase:**
> See something on Amazon → not sure if you own it → buy it anyway → find the original later

**The Phantom Location:**
> Know you own it → can't find it → 20-minute garage search → may still not find it

**The Context Switch Tax:**
> Return to a paused project after 6 weeks → have to reconstruct what was next → where are the parts → what was blocking it

**The Pantry Shrug:**
> Storm coming → wonder how much food you have → no real answer → anxiety, last-minute buying

**The Shopping List Blind Spot:**
> ChatGPT gives you a supply list for a project → no fast way to know what you already have → buy everything → waste money

**The Missing Piece Blocker:**
> Ready to start a build → one connector is missing → whole session lost

These are the real problems. None of them are solved by better inventory categorization. They are solved by:
1. Knowing what you have and where it is
2. Knowing what you're missing before you need it
3. Knowing whether a purchase is necessary before you make it
4. Being able to resume context without reconstruction overhead

Inventory is the *data layer* that enables these answers. It is not the experience.

---

## 3. Inventory-First Architecture — Current State

### What the app looks like today

```
App opens to:
├── Header (ELK Inventory, search bar, Add Item button)
├── ZoneSummary (counts: Total, Tool, Material, Equipment, Available, Ordered)
├── Filter Row (All, Garage, Pool Shed, ELK Labs, etc.)
└── Item Grid (all items matching current filter, sorted by name)
    ├── InventoryCard × N
    └── [clicking opens ItemDetailPanel]

Secondary navigation (tabs):
├── Items (default)
├── Zones
└── Collections
```

### What the user's first experience is

A flat grid of ~50 inventory items — mostly garage tools — with a row of filter buttons and some aggregate counts at the top.

The user sees items. Not domains. Not context. Not goals. Items.

### What works

- The data model is solid and has been thoughtfully evolved
- Item cards are clickable and show useful detail
- Zones give a spatial sense of the garage
- Filters work for the current item count
- localStorage persistence means the data survives sessions
- CRUD is fully functional
- Photos are working and add real value
- The "garage notebook" aesthetic is correct for the use case

### What is wrong

**The entry point is wrong.** The app starts at the data level, not the context level. The user has to apply filters to narrow down to what they care about rather than entering a context that auto-narrows the view.

**The navigation model doesn't scale.** At 50 items across one domain, a flat list with filters works. At 300 items across 5 domains — garage, pantry, garden, pool, electronics — a flat list becomes unusable. Filters would need to handle domain, zone, status, class, project, and expiry simultaneously. The cognitive load exceeds the benefit.

**"Collections" means the wrong thing.** In the current app, "Collections" are brand families — Ryobi Tool Collection, Mechanic Tools, etc. These are logical groupings of tools, not domains of life. The word "Collection" is overloaded. When the architecture evolves to use "Collection" for domains (Garage, Pantry, Garden), the current usage creates confusion.

**Zones are global and undifferentiated.** The Pool Shed zone, the ELK Labs zone, and the Garden zone all live at the same level. When the pantry is added, "Storage Shelf" becomes ambiguous — is it a garage shelf or a pantry shelf? Zones must be scoped to a domain.

**Goals don't exist in the UI.** The most important differentiator — answering "what am I capable of and what am I missing?" — is entirely absent. The current app is purely reactive. It shows you what you have. It cannot tell you what you need.

**Search is a filter, not a query.** The search box filters the visible list. It does not cross collections. It does not answer "do I have this anywhere?" It does not rank results by relevance. It does not understand partial matches or alternate names.

**The dashboard is the wrong abstraction.** Item counts by class (Total: 52, Tools: 34) are not useful at a glance. They are answers to questions nobody is asking. Nobody opens ELK to check how many tools they have.

---

## 4. Collection-First Architecture — Proposed State

### The core shift

In a collection-first architecture, the user's life domains are the primary navigational objects. Everything else — items, zones, goals, purchases — lives inside a collection.

```
App opens to:
└── Collection Grid
    ├── 🔧 Garage
    ├── 🥫 Pantry
    ├── 🌱 Garden
    ├── 🏊 Pool
    ├── 🏍️ Dirt Bike
    ├── 🚛 Truck
    ├── 🔌 Electronics Lab
    └── 🏠 Property

Global search always available at top: "What are you looking for?"
```

The user picks a context. The system responds with what's relevant to that context.

### The user's first experience (collection-first)

User opens ELK. They see collection cards — their domains of life. Each card shows:
- The domain name and icon
- A one-line status ("2 active goals" / "40% ready" / "4 items expiring soon")
- A color/urgency indicator

The user taps "Garage." They see:
- Active goals in this collection with readiness %
- Items needing attention (ordered, unlocated, needs-repair)
- Recent additions
- Quick browse: by zone, by status, by project
- Add item button

The user has entered a context. Everything shown is relevant to that context. Nothing bleeds in from the pantry or the pool.

### How this changes item browsing

Items are no longer the first thing the user sees. They are the answer to a question asked within a collection context. The user navigates to a collection, then to a zone or goal, and items appear as the result.

This does not mean items are harder to find. Global search remains always available. "Where is my compression tester?" typed into the global search returns the item without the user having to navigate to the Garage collection first.

### What collection-first enables that inventory-first cannot

- **Multi-domain scaling:** Adding Pantry doesn't mix pantry items into the garage list. Each domain is clean and self-contained.
- **Domain-specific schemas:** Pantry items can have calories and expiry. Garage items can have power type and battery platform. No shared schema is forced on domains that don't need it.
- **Contextual zones:** "Storage Shelf" in Pantry and "Storage Shelf" in Pool Shed are different things that don't collide.
- **Goal-per-collection:** "30-Day Pantry Readiness" is a Pantry goal. "Dirt Bike Maintenance Readiness" is a Garage/Dirt Bike goal. They stay organized.
- **Cross-collection search:** The global search bar answers "do I have X?" without the user having to know which collection it lives in.
- **Intention-driven navigation:** The user's first action reveals their context. The system optimizes around that context.

---

## 5. Recommended Hierarchy

```
ELK (Life Operating System)
│
└── InventoryCollection  [PRIMARY OBJECT — what user sees on open]
    │  Examples: Garage, Pantry, Garden, Pool, Dirt Bike, Truck, Electronics, Property
    │
    ├── Goals            [SECOND OBJECT — what the user is trying to achieve here]
    │   ├── Active goals with readiness %
    │   ├── Required items (cross-referenced against inventory)
    │   └── Gap report (missing, blocked, estimated cost)
    │
    ├── Zones            [scoped to this collection — physical areas within this domain]
    │   ├── Mechanic Bay (Garage) ≠ Chemical Storage (Pool)
    │   ├── Kitchen Pantry ≠ Deep Storage Shelf
    │   └── Raised Beds (Garden) ≠ Irrigation Zone (Garden)
    │
    ├── Items            [INVENTORY DATA — answers to questions, not the starting point]
    │   ├── Base fields (name, status, zone, quantity, photo, notes)
    │   └── Collection-specific fields (see Section 7)
    │
    └── Purchases        [INTAKE LAYER — ordered, arriving, needs a home]
        ├── Draft queue (received but not yet located)
        ├── Ordered (en route)
        └── Recently added
```

### Key hierarchy rules

1. **A Zone always belongs to a Collection.** You cannot have a zone without a parent collection. `Zone.collectionId` is required.
2. **An Item always belongs to a Collection.** `Item.collectionId` is required. Items are not global.
3. **A Goal always belongs to a Collection.** Goals are scoped to the context where they make sense.
4. **Search is always global.** It crosses all collections. This is the escape hatch from collection-scoping when the user doesn't know or care which collection an item is in.
5. **Physical location is not the same as collection membership.** The Pool Shed is a physical building. It contains items from the Garage collection (overflow tools), the Pool collection (chemicals), and maybe the Garden collection (seeds). Physical location ≠ domain.

---

## 6. Recommended Navigation

### Top-level (home screen)

```
┌─────────────────────────────────────────────────┐
│  ELK                              [+ Add Item]   │
│  ─────────────────────────────────────────────  │
│  🔍 Search everything...                         │
│  ─────────────────────────────────────────────  │
│                                                  │
│  YOUR COLLECTIONS                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │ 🔧       │ │ 🥫       │ │ 🌱       │         │
│  │ Garage   │ │ Pantry   │ │ Garden   │         │
│  │ 2 goals  │ │ 40% rdy  │ │ 1 sensor │         │
│  └──────────┘ └──────────┘ └──────────┘         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │ 🏊       │ │ 🏍️       │ │ 🚛       │  ...   │
│  │ Pool     │ │Dirt Bike │ │  Truck   │         │
│  │ seasonal │ │ 67% rdy  │ │ kit ok   │         │
│  └──────────┘ └──────────┘ └──────────┘         │
│                                                  │
│  ACTIVE GOALS                                    │
│  Dirt Bike Home Maintenance  ████░░░░ 67%        │
│  30-Day Pantry Buffer        ████░░░░ 40%        │
│  Garden Solar Node           ███░░░░░ 46%        │
│                                                  │
│  NEEDS ATTENTION                                 │
│  • 3 items ordered, not received                 │
│  • 2 items with unknown location                 │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Inside a collection (e.g., Garage)

```
┌─────────────────────────────────────────────────┐
│  ← ELK   🔧 Garage           [+ Add Item]       │
│  ─────────────────────────────────────────────  │
│  🔍 Search in Garage...                          │
│  ─────────────────────────────────────────────  │
│                                                  │
│  [Overview] [Browse] [Goals] [Zones]             │
│                                                  │
│  ── ACTIVE GOALS ──────────────────────────────  │
│  Dirt Bike Maintenance  ████░░░░ 67%  [View →]   │
│  Truck Kit Complete     ███████░ 83%  [View →]   │
│                                                  │
│  ── NEEDS ATTENTION ───────────────────────────  │
│  • Ryobi angle grinder → needs-repair            │
│  • Compression tester → location unknown         │
│  • 2 items ordered, awaiting arrival             │
│                                                  │
│  ── RECENTLY ADDED ─────────────────────────────  │
│  • Low-Profile Floor Jack (Mechanic Bay)         │
│  • OBDLink MX+ (Mechanic Bay)                    │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Inside a collection goal

```
┌─────────────────────────────────────────────────┐
│  ← Garage   Dirt Bike Home Maintenance   67%     │
│  ─────────────────────────────────────────────  │
│  Be able to do all routine maintenance at home   │
│  without going to a shop.                        │
│                                                  │
│  ✅ HAVE IT                                      │
│  Motorcycle Lift         Mechanic Bay            │
│  Metric Socket Set       Mechanic Bay            │
│  Compression Tester      Mechanic Bay            │
│  Inline Spark Tester     Mechanic Bay            │
│                                                  │
│  ❌ MISSING                                      │
│  Torque Wrench (3/8")    ~$65 · Order now        │
│  Engine Oil (correct spec)  ~$30 · Order now     │
│  Oil Filter (CRF-spec)   ~$15 · Order now        │
│  Service Manual          ~$28 · Order now        │
│                                                  │
│  ❓ LOCATION UNKNOWN                             │
│  Oil Drain Pan           Last seen: Garage       │
│                                                  │
│  Gap cost estimate: ~$138                        │
│  [Generate shopping list]                        │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Global search results

```
┌─────────────────────────────────────────────────┐
│  🔍 thermometer, wood chips, brisket      [×]   │
│  ─────────────────────────────────────────────  │
│                                                  │
│  ✅ FOUND (2)                                    │
│  BBQ Thermometer     Garage / Center Island      │
│  Meat Probes ×2      Garage / Center Island      │
│                                                  │
│  ❌ NOT IN INVENTORY (1)                         │
│  Brisket (fresh — would live in Pantry/freezer)  │
│  [Add to shopping list]                          │
│                                                  │
│  📦 CLOSE MATCHES                                │
│  Apple Wood Pellets  Pool Shed / Shelf B         │
│  (similar to "wood chips" — is this it?)         │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## 7. Collection Model

A Collection is not a tag or a filter. It is a first-class domain object with its own context, schema, zones, goals, and inventory.

### Collection entity

```typescript
interface InventoryCollection {
  id: string;
  name: string;               // "Garage", "Pantry", "Garden"
  icon: string;               // emoji or icon key
  color: string;              // accent color for UI
  schema: CollectionSchema;   // which field set applies to items
  description: string;
  priority: "active" | "maintenance" | "inactive";
  zones: Zone[];              // zones scoped to this collection
  goals: CollectionGoal[];
  createdAt: string;
  notes: string;
}

type CollectionSchema =
  | "garage"
  | "pantry"
  | "pool"
  | "garden"
  | "electronics"
  | "vehicle"
  | "property"
  | "project"
  | "custom";
```

### How collection schema shapes items

Each schema defines which extended fields are relevant, which are required, and how the item is displayed. The base `Item` type handles common fields. Extended fields are stored in a typed extension object or a flexible metadata bag.

**Design choice: typed extension vs. flexible bag**

| Approach | Pros | Cons |
|---|---|---|
| Typed discriminated union (`GarageItem`, `PantryItem`) | Full TypeScript safety, clear schemas | More code, harder to add ad-hoc fields |
| Base + `metadata: Record<string, unknown>` | Flexible, easy to extend | Less type safety, needs runtime validation |
| Base + optional typed extension (`garageFields?: GarageFields`) | Balance of both | Some boilerplate |

**Recommendation:** Base + optional typed extension. Common fields stay strongly typed. Collection-specific fields are typed but optional. Migration to this shape from the current flat schema is a single refactor.

---

## 8. Relationship Model

```
InventoryCollection  1 ──── N  Zone
InventoryCollection  1 ──── N  Item
InventoryCollection  1 ──── N  CollectionGoal
Zone                 1 ──── N  Item
CollectionGoal       1 ──── N  GoalRequirement
GoalRequirement      N ──── 1  Item  (computed match, not FK)
Purchase             1 ──── 1  Item  (after approval)
GlobalGoal           1 ──── N  CollectionGoal

Item has:
- collectionId (required)
- zoneId (within that collection, optional if unlocated)
- lifecycleState
- quantity
- base fields
- collection-specific extended fields

Zone has:
- collectionId (required — zones are always collection-scoped)
- name
- purpose
- priority
- notes
- photoPath

Cross-cutting concerns:
- Search is cross-collection (Item index spans all collections)
- A physical location (e.g., Pool Shed) can appear as a Zone in
  multiple collections, but the Zone records are distinct
- A Project can reference items across multiple collections
  (a garden build uses Electronics Lab items + Garage tools)
```

### The Project cross-cutting problem

Projects are the one object that naturally crosses collection boundaries. Building a garden solar node requires:
- Electronics Lab: ESP32, sensors, converters (Electronics collection)
- Garage: wiring tools, crimpers, soldering iron (Garage collection)
- Garden: enclosure location, mounting, cable routing (Garden collection)

**Two valid approaches:**

**Approach A: Project as a top-level object (peer of Collection)**
A Project has its own identity, references items from multiple collections, has a status and phase, and has its own goals.

**Approach B: Project as a cross-collection tag/reference**
Items are tagged with a project ID. The project view is a filtered cross-collection search.

Recommendation: **Approach B** now (lower complexity, current system already has a `project` string field), **Approach A** later when projects become more structured. The migration path is natural.

---

## 9. Goals Model

Goals exist at three levels. Each level serves a different purpose.

### Level 1: Life Goals (implicit)

These are not in the system. They are the user's actual priorities: spend more time with family, ride more, build ELK Garden, become more self-reliant. The inventory system supports these goals but does not model them directly.

They are documented in `docs/vision/founder-notes-lorne.md`. They serve as the north star for feature prioritization.

### Level 2: Collection Goals (the primary goal object)

A Collection Goal defines a capability the user wants to achieve within a collection, and the inventory requirements to get there.

```typescript
interface CollectionGoal {
  id: string;
  collectionId: string;
  name: string;               // "Dirt Bike Home Maintenance"
  description: string;        // "Be able to do all routine maintenance..."
  priority: "active" | "planned" | "someday";
  requirements: GoalRequirement[];

  // Computed — not stored
  readinessPercent: number;
  metCount: number;
  missingCount: number;
  unknownCount: number;
  estimatedGapCost: number | null;
  criticalPathItems: GoalRequirement[];  // items that unblock the most progress
}

interface GoalRequirement {
  id: string;
  goalId: string;
  name: string;               // "Torque Wrench (3/8" drive)"
  matchStrategy: "name" | "tag" | "brand" | "partNumber" | "category";
  matchValue: string;
  requiredQuantity: number;
  unit?: string;              // for pantry: "lbs", "cans", "gallons"
  required: boolean;          // false = optional/nice-to-have
  estimatedCost?: number;

  // Computed — not stored
  status: "met" | "missing" | "unknown" | "partial" | "ordered";
  matchedItemId?: string;
  matchedItemLocation?: string;
}
```

### Level 3: Item-level contribution (implicit)

An item "meets" a goal requirement if:
- Its name, tag, brand, or category matches the requirement's `matchValue`
- Its `lifecycleState` is `available` or `in-use`
- Its `quantity >= requirement.requiredQuantity`
- Its `zoneId` is not "unknown" (optionally — the item is locatable)

This computation is pure function: `computeReadiness(goal, items) → GoalReadiness`. No stored state needed.

### Goal computation example

```
Goal: Dirt Bike Home Maintenance
Requirements: 13 items

Requirement: "Torque Wrench"
  matchStrategy: "tag"
  matchValue: "torque-wrench"
  required: true
  estimatedCost: 65

Search inventory for items tagged "torque-wrench"...
  → No match found
  → Status: MISSING

Requirement: "Motorcycle Lift"
  matchStrategy: "name"
  matchValue: "Motorcycle Lift"
  required: true

Search inventory for "Motorcycle Lift"...
  → Found: "Motorcycle Lift" / lifecycleState: "available" / zone: "Mechanic Bay"
  → Status: MET

...

Final:
  met: 4
  missing: 7
  unknown: 2
  readiness: 4/13 = 31%
  estimatedGapCost: $138
  criticalPath: ["Torque Wrench", "Engine Oil", "Oil Filter"]
    (these 3 items unblock 80% of maintenance tasks)
```

### What goals enable that inventory alone cannot

- **Proactive awareness:** "You are 31% ready — here's the gap" vs. "here are your items"
- **Prioritized purchasing:** "Spend $138 to close this goal" vs. "browse Amazon and guess"
- **Resuming projects:** Open the goal → see exactly where you left off, what's arrived, what's still missing
- **Cross-session memory:** The goal remembers the requirements even if the user doesn't return for months

---

## 10. Purchase Model

Purchases are the in-between state — between wanting something and having it located in your inventory.

### The purchase lifecycle

```
Intent / Awareness
       ↓
  [Buy Decision]
       ↓
  ORDERED (item exists in inventory as "ordered")
       ↓
  DELIVERED (box arrives — item needs a home)
       ↓
  [Review / Intake]
  - Confirm name
  - Take photo
  - Set collection
  - Set zone
  - Approve
       ↓
  AVAILABLE (item is in active inventory)
```

### Why this matters architecturally

The current app treats items as either existing or not. There is no in-between state for "I bought it and it arrived but I haven't figured out where it goes yet." This is one of the most common real-world states.

Without a purchase model, the user has two bad options:
1. Add the item before it arrives (lifecycle: "ordered") — correct but requires discipline to update when it arrives
2. Wait until it's placed — risk: forgets to add it, item disappears into the garage

A purchase model creates a **friction-free intake moment**: the item is auto-created at "ordered" status (from Amazon import, email parsing, or manual entry), and the user is prompted to complete intake when it arrives. The arrival is the natural trigger for photo + location.

### Purchase entity

```typescript
interface Purchase {
  id: string;
  source: "amazon" | "email" | "screenshot" | "manual" | "learned";
  rawName: string;            // from receipt/email/screenshot
  resolvedItemId?: string;    // set after intake is complete
  
  purchasedAt: string;        // when ordered
  expectedDelivery?: string;
  deliveredAt?: string;       // when box arrived
  approvedAt?: string;        // when intake is complete
  
  cost?: number;
  quantity: number;
  
  status: "ordered" | "delivered" | "approved" | "dismissed";
  
  // Classification
  inventoryTier: "likely" | "maybe" | "ignore";
  collectionSuggestion?: string;   // suggested collection
  
  notes: string;
}
```

### Smart intake classification

Not every purchase becomes inventory. The system classifies incoming purchases:

| Purchase | Classification | Reason |
|---|---|---|
| Solar MPPT charge controller | Likely inventory | Project-critical, expensive, specific |
| Pool chlorine 10 lbs | Likely consumable inventory | Tracked for readiness |
| Movie rental | Ignore | Not a physical asset |
| USB cable 3-pack $8 | Maybe | Depends on project context |
| Bulk rice 25 lbs | Pantry inventory | If Pantry collection is active |
| Generic paper towels | Ignore | Not worth tracking |
| Victron BatteryProtect | Likely inventory | Specific component, expensive |
| Nitrile gloves 100-pack | Maybe | Shop readiness item, or ignore |

The system learns from user decisions. "User dismissed every USB cable purchase" → future USB cables default to "ignore." This makes intake progressively lower friction.

### The draft queue

A Draft Queue tab (or collection-scoped view) shows:
- Items ordered, not yet arrived
- Items arrived, not yet placed and photographed
- Items from purchase intake awaiting review

This is where the user closes the loop between "I bought it" and "it's in my inventory."

---

## 11. Search Model

Search is not a filter. It is the primary answer to "do I have this?"

### Search as first-class navigation

Search should be permanently visible at the top of every screen, inside and outside collections. It is always available, always cross-collection by default, and always fast.

The user does not need to navigate anywhere to search. They can search from the home screen, from inside a collection, from inside a goal. The context they're in can be offered as a scope option, but the default is always everything.

### Search modes

**1. Item lookup ("where is my torque wrench?")**
- Fuzzy name match across all items in all collections
- Returns: item name, collection, zone, locationDetail, lifecycleState, photo thumbnail
- If not found: "Not in inventory — add it?" or "Did you mean: [similar item]?"

**2. Multi-item check ("do I have: brisket, thermometer, wood chips?")**
- Parse comma/newline-separated list
- For each: found/not found/close match
- Returns grouped result: owned, missing, close matches
- Option: "Add missing items to shopping list"

**3. Goal-intent search ("what do I need for the dirt bike project?")**
- Matches against goal names and active goal requirements
- Returns: goal readiness summary + gap items
- This is the bridge between search and goals

**4. Purchase check ("did I already order a torque wrench?")**
- Searches purchase history and "ordered" lifecycle state items
- Returns: ordered on [date], expected [date], not yet received
- Prevents re-ordering things already in transit

### Fuzzy matching requirements

- Partial words: "grind" → "Angle Grinder"
- Brand prefix: "ryobi" → all Ryobi items
- Abbreviations: "obd" → "OBDLink MX+"
- Category: "spark" → "Inline Spark Tester"
- Alternate names: "impact driver" → "Impact Wrench"
- Typo tolerance: "kompressor" → "Compressor"

Current search is exact-prefix string matching. This breaks the "do I have this?" workflow for any name the user doesn't recall precisely. Fuzzy search (fuse.js or equivalent) is table stakes before the system can genuinely answer these questions.

### Search result structure

```typescript
interface SearchResult {
  query: string;
  terms: string[];            // parsed query terms
  
  found: SearchHit[];
  notFound: string[];
  closeMatches: CloseMatch[];
  purchaseMatches: PurchaseHit[];  // ordered/in-transit items
  
  searchedAt: string;
  durationMs: number;
}

interface SearchHit {
  item: Item;
  collection: InventoryCollection;
  zone?: Zone;
  score: number;              // fuzzy match score 0–1
  matchedOn: string[];        // which fields matched
}

interface CloseMatch {
  term: string;               // what was searched
  item: Item;                 // what was found
  confidence: "high" | "medium" | "low";
  suggestion: string;         // "Did you mean: [item name]?"
}
```

---

## 12. Dashboard Model

The dashboard is not a summary of inventory data. It is a **status surface** that surfaces what matters right now without requiring the user to navigate anywhere.

### What the current dashboard shows (wrong)

- Total items: 52
- Tools: 34
- Materials: 8
- Equipment: 6
- Available: 45
- Ordered: 3

These are answers to questions nobody asks. Nobody opens ELK to check how many tools they have.

### What the correct dashboard shows

**Collection status** — your domains of life, each with a single status signal:
- Garage: 2 active goals
- Pantry: 40% ready (on 30-day buffer goal)
- Garden: 1 sensor offline (if integrated with ELK Garden)
- Pool: seasonal — no current goals active

**Active goals** — cross-collection, ranked by priority:
- Dirt Bike Home Maintenance → 67% → critical path: 3 items
- 30-Day Pantry Buffer → 40% → 18 days short
- Garden Solar Node → 46% → blocked on power system

**Needs attention** — things that require action:
- 3 items ordered, not yet received (longest: 8 days)
- 2 items with unknown location
- 4 pantry items expiring within 30 days (if Pantry active)
- 1 item in needs-repair state (Ryobi angle grinder)

**Recently added** — the last 5 items added to any collection

**Recent purchases** — items in draft/ordered state

### What the dashboard does NOT show

- Aggregate counts by class or state — not useful at a glance
- Every zone with item counts — too much, wrong abstraction
- Advertisements for features — not a SaaS app
- Onboarding prompts (after day 1) — they become noise

### The correct mental model for the dashboard

The dashboard is the answer to: **"What should I know right now?"**

Not "what is in my inventory?" The inventory is there when you need it. The dashboard surfaces what requires attention without the user having to hunt for it.

---

## 13. Pantry vs. Garage vs. Garden vs. Pool — Why They Cannot Share a Schema

This section justifies the collection-specific schema approach by showing concretely how different the domains are.

### The dimensions of difference

| Dimension | Garage | Pantry | Garden | Pool |
|---|---|---|---|---|
| Item lifecycle | Available → in-use → retired | Available → consumed → repurchase | Planted → harvested / installed → maintained | Stocked → depleted → reorder |
| Time sensitivity | Low (tools don't expire) | High (expiry dates matter) | Medium (seeds expire, seasons matter) | Medium (chemicals degrade) |
| Quantity meaning | Count (1 drill, 2 trays) | Weight/volume/servings | Count + harvest amount | Volume (lbs, gallons) |
| Location precision | Zone → container → drawer | Shelf → row → FIFO position | Physical GPS / node ID | Shed → shelf → separated by safety |
| Safety concerns | None generally | Allergens, dietary | Pesticides, herbicides | Chemical incompatibility (serious) |
| Readiness metric | Capability % (can I do X?) | Days of food supply | Node uptime, plant health | Chemical balance |
| Primary question | "Where is it? Can I do X?" | "How long can we eat?" | "Is the system working?" | "Is the pool safe?" |
| Dominant lifecycle stage | Available, ordered | Available, consumed | Installed, consumed | Available, depleted |
| Key derived calculation | Goal readiness % | Kcal/day remaining | Harvest yield | Days until reorder |

### Pantry requires fields that make no sense in a garage

- `caloriesPerServing` — a drill has no calories
- `servingsPerContainer` — a socket set has no servings
- `expiryDate` — power tools don't expire (in the same way)
- `fifoDate` — tracking when a specific unit entered stock for rotation
- `storageCondition` — dry/refrigerated/frozen
- `openedAt` — once opened, many foods degrade

If these fields live on the shared `InventoryItem` schema, they are present on every tool, sensor, and pool pump — as `undefined`. The schema becomes a sprawling union of every field any domain might ever need. TypeScript will be unhappy. The forms will be unusable. The item cards will either show nothing or show irrelevant fields.

### Pool requires fields that create confusion elsewhere

- `chemicalType` — chlorine, shock, pH-up, pH-down, algaecide
- `safeStorageSeparation` — a critical safety concern (some pool chemicals cannot be stored adjacent to others)
- `volumeOrWeight` — tracking current chemical level (partial container)
- `testReagentFor` — what chemical this test strip tests

These fields are not just irrelevant in the garage — the `safeStorageSeparation` flag is positively dangerous if accidentally applied to a screwdriver.

### Garden requires a fundamentally different location model

Garden item location is not "zone → container." It is:
- Physical GPS coordinates or named position (Raised Bed 3, Row 2)
- Node ID (sensor node #4 at the west wall)
- Irrigation zone (Zone 2, drip emitter position 7)

These are spatial references, not storage locations. The garage location model (zone → container → drawer) maps poorly onto them.

### The conclusion

**A single flat schema works for one domain.** It is already showing signs of strain with the current garage data model — many fields (`powerType`, `batteryPlatform`, `photoType`) are optional and undefined for most items.

**When a second domain is added with its own required fields, the shared schema breaks.** Either all fields become optional (losing meaning) or the schema becomes two schemas awkwardly combined.

The correct approach: **base schema + collection-specific extension**. Implement this when the second active domain (likely Pantry) is being built, not before — but design for it now.

---

## 14. Risks of Staying Inventory-First

These are not hypothetical concerns. They are concrete failure modes that occur at predictable points.

### Risk 1: Flat item list becomes unusable at scale

**Trigger:** Adding Pantry collection (100+ items with expiry, categories, quantities)

When pantry items are added to the existing flat item list, the user sees garage tools mixed with canned beans mixed with pool chemicals mixed with ESP32 boards — all in one undifferentiated grid. The filter bar already has 10+ options. Adding pantry filters collapses it.

**Severity:** High. This is a navigation failure, not a cosmetic problem. The user cannot efficiently find anything.

**When it hits:** First time a second domain has real items.

---

### Risk 2: Global zones become ambiguous and unusable

**Trigger:** Adding any second collection with its own storage locations

"Storage Shelf" in the current garage context is specific. Add Pantry and "Storage Shelf" could mean the garage shelf or the pantry shelf. The zone filter becomes ambiguous. Zone pages show mixed results.

More subtly: the Pool Shed zone currently appears in the Garage zone list. When Pool is its own collection, "Pool Shed" is simultaneously a Garage overflow zone and a Pool home zone — but the current model has no way to distinguish these.

**Severity:** High. Zones become meaningless when they're not scoped.

**When it hits:** Second collection with overlapping physical spaces.

---

### Risk 3: The "Collection" term collision creates user confusion

**Current state:** "Collections" in the app means brand families (Ryobi Tool Collection, Mechanic Tools).

**Future state:** "Collections" in the architecture means life domains (Garage, Pantry, Garden).

These are the same word for completely different concepts. The Collections tab in the current app will directly conflict with the Collection-first navigation model.

**Severity:** Medium. Immediate if Collection-first navigation is built alongside the current Collections tab.

**When it hits:** The moment the home screen is redesigned.

---

### Risk 4: Goals cannot be meaningfully scoped

**Scenario:** The system has a "Dirt Bike Maintenance" goal and a "30-Day Pantry" goal. Without collection scoping, both live at the same level in an undifferentiated goal list. Goal requirements reference items across domains. Computing readiness requires searching all items — which is correct for cross-collection search but wrong for single-domain goal management.

**Severity:** Medium. Goals are not yet in the app, so this is a pre-emptive concern. But if goals are built without collection scoping, they will need to be migrated later.

**When it hits:** When goals are implemented.

---

### Risk 5: Schema sprawl makes forms unusable

**Trigger:** Adding Pantry fields to the shared `InventoryItem` schema

The Add/Edit Item form currently has ~15 fields. Adding pantry fields (`expiryDate`, `caloriesPerServing`, `servingsPerContainer`, `fifoDate`, `storageCondition`) without schema separation means every form shows all fields for all domains simultaneously. The garage tool form shows a calories field. The pantry form shows a battery platform field.

**Severity:** Medium-High. Forms become overwhelming and confusing. Users make errors filling in irrelevant fields.

**When it hits:** First time pantry items are entered.

---

### Risk 6: Search remains a filter, not an answer

**Current state:** Search filters the visible item list in the current tab context.

**Failure mode:** User is in the Zones tab. Search is inactive. User searches for "thermometer." Search finds the item from the item list — but the user is looking at zones, not items. The experience is confusing.

Or: User is in the Garage collection (future). Searches for "thermometer." The thermometer is in the Pantry collection. Search doesn't cross collections. User thinks they don't own a thermometer.

**Severity:** High. This is the "do I already own this?" workflow — one of the top-priority use cases — and it breaks with collection-scoped search.

**When it hits:** When the second collection has items and the user doesn't know which collection something is in.

---

### Risk 7: The dashboard becomes a census report

If the dashboard continues to show aggregate inventory counts as collections grow, it becomes a report that answers no useful question. "Total items: 247" tells the user nothing actionable.

**Severity:** Medium. Low immediate harm, but the dashboard becomes increasingly irrelevant and users stop consulting it.

**When it hits:** Gradually, as inventory grows.

---

## 15. Migration Path from Current App

The migration is structured to preserve everything that works while enabling the new architecture. No data is lost. No existing features break. Each step can be done in a single focused session.

### Phase 0 — Confirm this design (now)

Review this document. Adjust any collection names, zone examples, or hierarchy decisions that don't match how Lorne actually thinks. Confirm the answer to the architecture question before writing a line of code.

**Deliverable:** Annotated/approved version of this document.

---

### Phase 1 — Terminology cleanup (1 session, low risk)

**Action:** Rename current "Collections" (brand groups: Ryobi Tool Collection, Mechanic Tools) to **Sets** or **Groups** throughout the codebase.

- Rename `src/data/collections.ts` → `src/data/groups.ts`
- Rename `Collection` type → `ItemGroup`
- Rename `CollectionsPage.tsx` → `GroupsPage.tsx` or remove temporarily
- Update all references

**Why:** Frees "Collection" to mean what it should mean going forward. Prevents the terminology collision in Phase 3.

**Risk:** Low. Rename only — no logic changes.

---

### Phase 2 — Scope zones to a parent collection (1 session, low risk)

**Action:** Add `collectionId` field to the `Zone` type and zone seed data.

For now, all existing zones get `collectionId: "garage"` — because all current zones are garage zones. This is a no-op functionally but structurally prepares for collection-first navigation.

- Add `collectionId: string` to the `Zone` interface in `src/types/inventory.ts`
- Update `src/data/zones.ts` to include `collectionId: "garage"` on all zones
- Update zone filtering logic to filter by `collectionId` when inside a collection view

**Why:** This is the structural change that enables zones to be different per collection. Without it, the same pool shed zone appears in both Garage and Pool contexts without distinction.

**Risk:** Low. Additive change. Existing zone views continue to work.

---

### Phase 3 — Add the Collection entity (1 session, medium)

**Action:** Create a new `InventoryCollection` type that is the top-level domain object.

- Add `InventoryCollection` interface to `src/types/inventory.ts`
- Create `src/data/domain-collections.ts` with seed data for initial collections:
  - Garage (active — all current items belong here)
  - Pantry (shell — no items yet)
  - Garden (shell)
  - Pool (shell)
  - Electronics Lab (shell — some current items may move here)
- Add `domainCollectionId` field to `InventoryItem` (all existing items get `"garage"`)
- Do not change any existing UI yet

**Why:** Establishes the top-level entity. All existing items remain intact — they just gain a `domainCollectionId` of "garage." Shell collections exist structurally but have no items, proving the model without requiring a content migration.

**Risk:** Medium. Data model change, but backward-compatible. The existing flat item list continues to work.

---

### Phase 4 — Redesign the home screen as a collection grid (1 session, medium)

**Action:** Replace the current home screen (flat item grid + filter bar) with a collection grid.

- New home screen: `CollectionGrid` component showing collection cards
- Each card: name, icon, item count, active goal (if any), attention signal
- "Garage" card is the only one with real content initially
- Clicking a collection card opens the collection view
- Collection view: tabs for Overview, Browse, Goals, Zones
- The existing item grid becomes the "Browse" tab inside the Garage collection
- Existing filters (zone, class, status) become the Garage collection's browse filters

**Why:** This is the most visible change. The user's first experience shifts from "wall of items" to "my domains of life." The existing item browsing experience is preserved — just scoped inside the Garage collection.

**Risk:** Medium. Significant UI change but no data changes. The existing functionality is preserved, not removed.

---

### Phase 5 — Global search upgrade (1 session, medium)

**Action:** Move search to top-level, cross-collection, with fuzzy matching.

- Persistent search bar always visible at the top of the app
- Add fuse.js or similar for fuzzy matching (no backend needed)
- Search returns results grouped by collection ("Found in Garage", "Found in Electronics Lab")
- "Not in inventory" state shown explicitly
- Close match suggestions

**Why:** This enables the "do I have this?" workflow that is one of the primary reasons the system exists. Without cross-collection fuzzy search, the collection-first navigation could make things harder to find.

**Risk:** Medium. Requires a small dependency (fuse.js). Result display needs design work.

---

### Phase 6 — Add first real goal (1 session, low)

**Action:** Implement `CollectionGoal` as a data structure and display it in the Garage collection overview.

- Add `CollectionGoal` and `GoalRequirement` types
- Create seed data for "Dirt Bike Home Maintenance" goal with its requirements
- Add `computeGoalReadiness(goal, items)` pure function
- Add goal readiness display to Garage collection overview
- No UI for creating/editing goals yet — seed data only

**Why:** This is the first time the system proactively tells the user something ("here's what you're missing") rather than only responding to navigation. The value is immediately visible.

**Risk:** Low. Read-only display only. No edit UI yet.

---

### What to NOT change until Phase 6 is stable

- Do not refactor `InventoryItem` to collection-specific schemas yet. The current flat schema with optional fields handles one active domain. Extend it only when Pantry has real items.
- Do not implement purchase intake yet. Validate the collection-first model first.
- Do not add SQLite yet. The collection model can be proven with localStorage.
- Do not add more than 2 domains with real data until the schema extension pattern is proven.

---

## 16. Recommendation

**Should ELK remain an inventory-first application? Or should ELK evolve into a collection-first Life Operating System?**

### The answer is: collection-first. Unambiguously.

Here is the case.

---

### The inventory-first architecture was correct for what was built

When ELK started as "a tool tracker for the garage," inventory-first was the right structure. Items, zones, filters — this is exactly what a tool tracker needs. The current implementation is solid for that purpose.

The problem is that the product outgrew that purpose before the architecture caught up. The vision is now a Life Operating System. The architecture is still a tool tracker.

These are not compatible for long.

---

### The collection-first architecture matches how Lorne actually thinks

Lorne does not open ELK and ask "what items do I have?" He opens ELK with a context: the garage, the garden, the bike, the pantry.

Every useful question he asks is domain-scoped:
- "What do I need for the dirt bike?" → Garage/Dirt Bike context
- "How many days of food do we have?" → Pantry context
- "Is the solar node ready to build?" → Garden/Electronics context
- "What chemicals do I need for the pool?" → Pool context

The one exception is "do I already own X?" — which is cross-collection search and is addressed by the permanent global search bar.

A collection-first architecture puts the context entry point where the user's mental model puts it: first.

---

### The migration cost is low

None of the proposed structural changes are rewrites. They are:

1. A terminology rename (Collections → Groups)
2. Adding a `collectionId` foreign key to Zone and Item
3. Adding a new top-level entity (`InventoryCollection`)
4. Redesigning the home screen component
5. Upgrading search from filter to query

None of these discard existing data. None break existing functionality. The entire existing item browsing experience is preserved inside the Garage collection. The user who uses ELK only as a garage tool tracker sees no degradation — just a different entry point.

---

### The cost of NOT doing this is compounding technical debt

Every feature added to the inventory-first architecture before the collection-first migration makes the migration harder:
- Each domain added without collection scoping creates more zone collision
- Each new field added to the shared schema makes the form more bloated
- Each goal implemented without collection scoping needs to be re-scoped later
- Each purchase intake feature built without a draft queue tied to a collection needs to be refactored

The longer this waits, the more expensive it becomes. The right moment to make this architectural shift is **before any new domain has real data**.

That moment is now.

---

### The collection-first architecture enables everything on the roadmap

Every feature in the roadmap becomes easier — or only becomes possible — with collection-first:

| Feature | Inventory-first | Collection-first |
|---|---|---|
| Pantry with expiry tracking | Requires sharing schema with garage tools — messy | Own schema, own fields, clean |
| Pool chemicals with safety flags | Mixed with garage items — dangerous confusion | Isolated in Pool collection |
| Goal readiness tracking | Goals are global, hard to scope | Goals belong to a collection, naturally scoped |
| Cross-collection search | Search is a filter — can't cross tabs | Search is a query — always cross-collection |
| Domain-specific dashboards | One dashboard shows everything — noise | Each collection has its own status surface |
| Multi-device sync (future) | Sync all items — no clear boundary | Sync by collection — cleaner data boundary |
| Purchase intake | Items go into one flat pool | Items go into a specific collection during intake |

---

### The final answer

**ELK should evolve into a collection-first Life Operating System.**

The current inventory-first implementation was the right starting point. It is not the right destination. The collection-first architecture is the correct model for a system designed to help a person manage tools, food, garden, pool, vehicles, electronics, and property — all without losing their mind.

The migration path is clear, low-risk, and sequenced to preserve everything that works while unlocking everything the vision requires.

Do not build another inventory feature — not pantry, not fuzzy search, not goals, not purchase intake — until Phase 1 through 3 of the migration (terminology, zone scoping, Collection entity) are complete.

The architecture must match the vision before the features can deliver on it.
