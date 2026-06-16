# Concept: Capability Gaps

**Status:** Not yet implemented  
**Priority:** Long-term  
**Last updated:** 2026-06-12

---

## Inventory Is Not Capability

Owning something is not the same as being able to use it.

You can own a complete set of engine rebuilding tools but have no idea how to use them. You can have every ingredient for a recipe but no gas in the stove. You can have a first aid kit but no training.

ELK Inventory tracks ownership and location. Capability is a layer above that.

**Capability = Ownership + Location + Condition + Knowledge + Readiness**

---

## The Key Questions

A capability-aware inventory should help answer four questions:

### 1. What can I do right now?
Based on what I have, where it is, and its current condition — what am I actually capable of doing today?

*Example: "Can I change the oil on the dirt bike today?"*
- Do I have the right oil? → Yes
- Do I have the right oil filter? → No (ordered, arriving Thursday)
- Do I have the drain pan? → Unknown location
- Do I have a torque wrench? → No, not owned
- **Answer: No. Missing 2 required items, 1 unknown location.**

### 2. What am I missing?
What items or knowledge am I lacking that prevent a specific capability?

*Example: Capability gap for "Dirt Bike Maintenance"*
- Torque wrench — not owned
- Correct spec oil filter — not stocked
- Service manual — not owned
- These 3 items are blocking full maintenance capability.

### 3. What would close the gap?
A shopping list with estimated cost.

*Example: Closing the Dirt Bike Maintenance gap*
- Torque wrench (3/8" drive): ~$60
- Oil filter (Honda CRF-specific): ~$12
- Service manual: ~$25 (Clymer)
- **Total gap cost: ~$97**

### 4. What is blocking progress on a specific project?
For project assets specifically — what parts, tools, or materials are needed before work can continue?

*Example: Small Engine Learning project*
- Engine block: ✅ in garage
- Carburetor: ✅ in garage
- Carburetor rebuild kit: ❌ not ordered
- Ignition coil tester: ❌ not owned
- **Project is blocked on 2 items.**

---

## Types of Capability Gaps

### Missing Items
The simplest gap. A required item is not in the inventory at all. Fix: purchase it.

### Located but Not Available
The item exists in inventory but is in a non-usable state:
- `needs-repair` — the item itself is broken
- `consumed` — the item has been used up
- `lost` — the item is unlocatable
- `retired` — the item has been removed from service

### Wrong Quantity
The item exists but not in sufficient quantity.
- Have 10 oil-absorbing pads, need 25 for the project.
- Have 2 feet of wire, need 10 feet.

### Wrong Spec
The item exists but is the wrong variant for the task.
- Have engine oil, but wrong viscosity for the engine.
- Have wood screws, but need machine bolts.
- Have a battery charger, but the wrong voltage.

*This is the hardest gap to detect automatically — requires spec-level metadata.*

### Knowledge Gaps (Out of Scope)
ELK Inventory tracks physical assets, not skills or knowledge. But a gap report could eventually link to documentation, videos, or checklists alongside the physical requirements.

---

## Gap Severity Levels

Not all gaps are equal. The system should eventually distinguish:

| Severity | Description | Example |
|---|---|---|
| Blocking | Project/capability cannot start without this | No oil filter — can't do oil change |
| Degraded | Can start but quality or safety is reduced | No torque wrench — can complete but spec risk |
| Optional | Nice to have, not required | No parts organizer tray — messy but workable |
| Nice-to-know | Would improve efficiency | No drain hose — have to use a pan |

---

## Capability Dashboard (Future UI)

A future "Capability View" in ELK Inventory would show:

```
My Capabilities

✅ READY (4)
  → Basic Electrical Work
  → Home Network Setup
  → Garage Cleanup / Dust Removal
  → Woodworking: Cuts and Fastening

🟡 PARTIAL (3)
  → Dirt Bike Maintenance (67% — missing torque wrench, oil filter)
  → Camping Trip (83% — missing water filter, game bags)
  → Small Engine Repair (50% — learning project in progress)

❌ NOT READY (2)
  → 30-Day Pantry Readiness (40% — significant food stock gaps)
  → Hunting Trip Deployment (60% — ammo and license unknown)
```

Each partial or not-ready capability would drill into the gap report.

---

## The Gap vs. The List

A traditional inventory is a list.

A capability gap analysis is a *question* asked against that list.

| List Question | Capability Question |
|---|---|
| Do I own a drill? | Can I hang shelves today? |
| Do I have food? | Can I feed my household for 30 days without a grocery run? |
| Do I have a multimeter? | Can I diagnose this electrical problem right now? |
| Do I have gardening tools? | Can I plant the raised beds this weekend? |

The gap analysis is the gap between what you have and what you need to do something specific.

ELK Inventory's north star is making that gap instantly visible.

---

## What Inventory Enables

An accurate, current inventory with capability goals enables:

1. **Proactive shopping** — buy what's needed before the project, not mid-project
2. **Project readiness checks** — before committing to something, see if you have what you need
3. **Seasonal preparation** — check hunting readiness in September, camping readiness in May
4. **Emergency audit** — quickly assess readiness before a storm or extended outage
5. **Budget prioritization** — spend money on items that close the most important gaps first
6. **Reduced decision fatigue** — the system answers the question instead of your memory

---

## Implementation Path

1. **Now:** Inventory goals as simple markdown checklists (manual, no system integration)
2. **Near-term:** Goals stored as structured data, manually cross-referenced
3. **Mid-term:** Automated readiness calculation from inventory state
4. **Long-term:** Gap reports, gap cost estimates, shopping list generation, purchase intake loop
