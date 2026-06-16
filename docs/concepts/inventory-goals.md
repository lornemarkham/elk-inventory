# Concept: Inventory Goals

**Status:** Not yet implemented  
**Priority:** Mid-to-long term  
**Last updated:** 2026-06-12

---

## Overview

An inventory goal is a capability plan — a defined outcome paired with the items required to achieve it.

The system doesn't just ask "what do I have?" — it asks "what do I need to be capable of X, and how close am I?"

This is the difference between a passive inventory (a list of stuff) and an active capability system (a map of what you can and cannot do, and what it would take to close the gap).

---

## What a Goal Defines

A goal answers these questions in sequence:

1. **What outcome do I want?** (change dirt bike oil at home, build a solar garden node, maintain a 30-day food buffer)
2. **What items are required?** (specific tools, parts, consumables, materials)
3. **What items are optional but helpful?**
4. **What do I already own?** (cross-referenced against current inventory)
5. **Where are those items located?** (are they findable, or just theoretically owned?)
6. **What is missing?** (items not in inventory, or in the wrong state — consumed, lost, needs-repair)
7. **What is the estimated cost to close the gap?**
8. **What priority does this have right now?**
9. **Does this purchase support current life goals?** (is it urgent, or just interesting?)

---

## Example: Dirt Bike Basic Home Maintenance

**Goal:** Be able to perform all routine maintenance on the dirt bike at home without going to a shop.

**Why it matters:** Dirt bike upkeep is frequent. Shop rates are high. Doing it at home builds mechanical skill and gets the bike back on the trail faster.

### Required Items

| Item | Category | Status |
|---|---|---|
| Motorcycle lift | tool | ✅ Available — Mechanic Bay |
| Metric socket set | tool | ✅ Available — Mechanic Bay |
| Torque wrench (3/8" drive) | tool | ❌ Not owned |
| Compression tester | tool | ✅ Available |
| Inline spark tester | tool | ✅ Available |
| Oil drain pan | tool | ❓ Location unknown |
| Correct engine oil (spec: check manual) | consumable | ❌ Not stocked |
| Oil filter (Honda CRF-specific) | consumable | ❌ Not stocked |
| Air filter (Honda CRF-specific) | consumable | ❌ Not stocked |
| Spark plug (correct heat range) | consumable | ❌ Not stocked |
| Service manual (Clymer or OEM) | reference | ❌ Not owned |
| Safety wire + pliers | material | ❓ Unknown |
| Jet kit / carb rebuild kit | consumable | ❌ Not stocked |

**Readiness: 4/13 = 31%**

**Estimated gap cost: ~$200**
- Torque wrench: ~$65
- Engine oil (2 bottles): ~$30
- Oil filter: ~$15
- Air filter: ~$20
- Spark plug: ~$10
- Service manual: ~$28
- Carb rebuild kit: ~$25

**Gap items (critical path):** Torque wrench, correct oil and filter, service manual. These three items block doing a proper oil change safely and to spec. Everything else is secondary.

**App recommendation:** "You are 31% ready for dirt bike home maintenance. The critical path is: buy the correct spec oil filter, engine oil, and a 3/8" torque wrench. Estimated cost: ~$110. This unblocks 80% of routine maintenance."

---

## Example: Off-Grid Garden Solar Node

**Goal:** Build a self-powered sensor node for the garden that runs without grid power.

**Why it matters:** Garden nodes need to be installed far from power outlets. A solar-powered node eliminates cable runs and enables remote placement.

### Required Items

| Item | Category | Status |
|---|---|---|
| Solar panel (5–20W, 12V) | equipment | ❌ Not owned |
| Solar charge controller | equipment | ❌ Not owned |
| LiFePO4 or SLA battery (7–12Ah) | equipment | ❌ Not owned |
| Victron BatteryProtect | equipment | ❌ Not owned |
| Busbar (positive + negative) | material | ❌ Not owned |
| Fuse block + fuses | material | ✅ Available — ELK Labs |
| Mean Well DC-DC converter (12V→5V) | material | ✅ Available — ELK Labs |
| ESP32 development board | material | ✅ Available — ELK Labs |
| Temperature/humidity sensor | material | ✅ Available — ELK Labs |
| Weatherproof enclosure | material | ❌ Not owned |
| Wire (12AWG red+black, outdoor rated) | material | ❓ Partial — check quantity |
| Anderson connectors or ring terminals | material | ✅ Available |
| Cable glands | material | ✅ Available — ELK Labs |

**Readiness: 6/13 = 46%**

**Estimated gap cost: ~$150**
- Solar panel (10W): ~$30
- MPPT charge controller: ~$25
- LiFePO4 7Ah battery: ~$55
- Victron BatteryProtect: ~$20
- Weatherproof enclosure: ~$15
- Busbars: ~$8

**What's blocking the build:** Solar panel + battery + charge controller is the blocking combination. Without the power system, the rest of the build can't run. The ESP32, sensors, and converters are ready.

**App recommendation:** "Your build is 46% ready. The power system (panel + controller + battery) is the only blocker. Order now to start the build this weekend: ~$110 on Amazon."

---

## Example: 30-Day Food Buffer

**Goal:** Maintain enough shelf-stable food for 2 people for 30 days without refrigeration.

**Why it matters:** Not a doomsday scenario — just competence. If a storm, illness, or supply disruption makes grocery runs difficult for a week or two, this is not a problem.

### Requirements

- 1,800 kcal/day × 2 people × 30 days = **108,000 kcal total**
- Protein: minimum 50g/person/day
- Variety: at least 6 distinct meal types
- Water: at minimum 2 gallons/person/day for drinking + cooking

### Current Estimate (example, not yet tracked in system)

| Item | Current Stock | Days Covered |
|---|---|---|
| White rice | 20 lbs | ~14 days caloric base |
| Canned beans | 24 cans | ~8 days protein supplement |
| Canned fish/chicken | 12 cans | ~4 days protein primary |
| Pasta | 10 lbs | ~7 days |
| Canned tomatoes/sauce | 12 cans | meals |
| Canned vegetables | 30 cans | sides |
| Oats | 5 lbs | ~4 days breakfast |
| Water (stored) | 20 gallons | ~5 days for 2 people |

**Rough readiness: ~12 days = 40% of goal**

**Gap:** ~18 more days of caloric coverage. Add bulk rice, canned proteins, and additional water storage.

**Note:** This domain is not yet implemented in ELK Inventory. Tracking this properly requires `expiryDate`, `calories`, `servingsPerContainer`, and FIFO rotation logic. See the pantry domain section in `life-inventory.md`.

---

## Example: Hunting Readiness

*(Future domain — documented as an example of the goal concept, not a current focus)*

**Goal:** Be ready to leave for a 3-day hunting trip within 4 hours.

### Key Readiness Items

| Item | Status |
|---|---|
| License and tags | Seasonal — must check expiry |
| Ammunition (100+ rounds) | Quantity unknown |
| Orange vest | Known owned |
| Layering system (base/mid/outer) | Known owned |
| First aid kit | Needs restock check |
| 3-day food (no refrigeration) | Needs staging |
| Game bags | ❌ Not owned |
| Headlamp + spare batteries | Known owned |

**Key insight:** This goal is not about tracking every piece of gear. It's about tracking the things that would actually block a trip: expired license, not enough ammo, no game bags. The system surfaces those blockers without requiring a complete gear audit.

---

## Goal Schema (Future Implementation)

```typescript
interface InventoryGoal {
  id: string;
  name: string;
  description: string;
  domain: string;           // "mechanic", "pantry", "garden", "hunting", etc.
  priority: "active" | "planned" | "someday";
  
  requirements: GoalRequirement[];
  
  // Computed
  readinessPercent: number;
  metRequirements: GoalRequirement[];
  missingRequirements: GoalRequirement[];
  unknownRequirements: GoalRequirement[];
  estimatedGapCost: number | null;
  criticalPathItems: GoalRequirement[]; // blockers that unlock the most progress
  
  lastCheckedAt: string;
  notes: string;
}

interface GoalRequirement {
  name: string;
  itemClass: ItemClass;
  requiredQuantity: number;
  unit?: string;
  matchStrategy: "name" | "brand" | "category" | "tag" | "partNumber";
  matchValue: string;
  required: boolean;      // false = nice-to-have
  estimatedCost?: number;
  notes?: string;
}
```

---

## How Readiness Is Computed

1. Loop through each required item in the goal
2. Search current inventory for a match (by name, brand, tag, or part number)
3. Check the item's `lifecycleState`:
   - `available` or `in-use` → ✅ Met
   - `ordered` → 🕐 Coming
   - `needs-repair`, `lost`, `consumed` → ❌ Not available
4. Check quantity: is `item.quantity >= requirement.requiredQuantity`?
5. Check location: is `currentZone` known? (not "unknown")
6. Compute readiness % from met / total required items

Optional items are excluded from the percentage but shown in the full report.

---

## The App's Role

The goal system should not just report — it should recommend.

After computing readiness, the app should say:
- "You are X% ready for [goal]."
- "The critical path is [2–3 specific items]. Addressing these unblocks the most progress."
- "Estimated cost to close the gap: $X."
- "These items can be ordered now: [links or search terms]."
- "This item is blocking [N] goals — prioritize it."

This is the difference between a checklist and a decision support tool.

---

## Why This Matters

Without goals, inventory is just a list. Anyone can make a list.

With goals, inventory becomes a map of what you can and cannot do — and a clear plan for closing the gaps. The question is not "what do I have?" but "what am I capable of, and what would it take to be capable of more?"

This concept, more than any other, is what separates ELK Inventory from a spreadsheet.
