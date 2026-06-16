# Concept: Asset Lifecycle

**Status:** Implemented (partially)  
**Last updated:** 2026-06-12

---

## Overview

Every physical item an inventory system tracks has a lifecycle. Understanding the lifecycle is what allows the system to answer questions like:

- Is this item available right now?
- Where is it?
- Is it being used for something?
- Should I order a replacement?
- Can I get rid of this?

ELK Inventory models this with the `lifecycleState` field on every item.

---

## The Asset Lifecycle States

### Purchased
The item has been ordered but not yet received.

*Examples:* An Amazon order in transit. A part that was just ordered from a supplier. A battery on backorder.

*Tracked as:* `ordered`

*System behavior:*
- Shows as "Ordered" with amber color in the UI
- Still counts toward capability planning ("this will be available soon")
- Should track expected delivery date (not yet implemented)

---

### Delivered / Available
The item is owned, in good condition, and ready to use.

*Examples:* A drill sitting in the tool bag. A box of wire ferrules on the shelf. A compression tester kit in its case.

*Tracked as:* `available`

*System behavior:*
- Default state for most items
- Contributes to capability calculations
- Should appear in "what do I have?" queries

---

### Located
A refinement of "available" — the system knows *where* the item is.

This is encoded via `currentZone` + `locationDetail` + `containerId`, not as a separate state. But location precision is a distinct concept worth tracking explicitly.

An item can be `available` but have `currentZone: "unknown"` — meaning you own it but can't find it quickly. This is a meaningful distinction.

*Future:* A "last seen" timestamp and a "verified location" flag would improve this.

---

### Reserved
The item is available but earmarked for a specific use or project.

*Examples:* A set of bolts set aside for a specific repair. Lumber staged for a project. A battery charged and waiting for a camera build.

*Tracked as:* `reserved`

*System behavior:*
- Should not appear in general "available" queries
- Should link to a project or reason (not yet enforced)

---

### In Use
The item is actively being used right now. It is not available for other purposes.

*Examples:* The OBDLink MX+ plugged into a vehicle being diagnosed. A drill currently charging. A sensor node deployed in the garden.

*Tracked as:* `in-use`

*System behavior:*
- Counts as "deployed" for capability tracking
- Should show which project or zone it's in use for (partially implemented via `project` field)

---

### Installed
The item has been permanently deployed. It is an installed asset in active service.

This differs from "in use" in permanence. A sensor node in the garden is *installed*. A drill charging in the garage is *in use*.

*Tracked as:* Combination of `lifecycleState: "in-use"` and `itemClass: "installed-asset"`. Better separation is a future improvement.

*Examples:* ELK Garden temperature nodes. Solar panels on the roof. Irrigation controllers. Pool pump.

---

### Needs Repair
The item is owned but not currently usable. It requires maintenance or repair before it can be used.

*Examples:* A lawn mower engine being serviced. A tool with a broken part. A sensor with a failed component.

*Tracked as:* `needs-repair`

*System behavior:*
- Should NOT count toward capability
- Should appear in a "maintenance queue" view (not yet built)
- Could eventually trigger a parts search or shopping list

---

### Consumed
The item was a consumable and has been used up. The record is kept for history.

*Examples:* A box of wire ferrules that's been fully used. An oil filter after a service. A bag of potting soil.

*Tracked as:* `consumed`

*System behavior:*
- Should be hidden from active inventory by default
- Useful for reorder automation: "this item was consumed, add to shopping list"
- Quantities need to decrement over time (not yet implemented)

---

### Lost
The item is owned on paper but cannot be located.

*Examples:* A specific socket that hasn't been seen in months. A battery that got misplaced. A tool that may have been lent out.

*Tracked as:* `lost`

*System behavior:*
- Should NOT count toward capability
- Should surface in a "find me" list with last known location
- A "last seen" date and location would help here (not yet implemented)

---

### Retired
The item was owned but is no longer in service. It may have been sold, donated, discarded, or replaced.

*Examples:* An old drill replaced by a new model. A broken sensor that was thrown away. A tool donated to a neighbor.

*Tracked as:* `retired`

*System behavior:*
- Archive rather than delete — preserves history
- Should be excluded from all active filters by default
- "Why retired" note would be useful for expensive items

---

### Incorrect Part / Surplus
The item was acquired but is the wrong part, is extra, or is of uncertain usefulness.

*Examples:* An engine mount plate ordered for the wrong engine. Extra hardware from a build that might be useful later. An item purchased by mistake.

*Tracked as:* `incorrect-part` or `surplus`

*System behavior:*
- Should trigger a "decide fate" workflow: keep, return, sell, discard
- Should show in a "surplus review" queue
- Should not count toward capability

---

## Lifecycle Flow Diagram

```
[Ordered] → [Available] → [In Use / Reserved / Installed]
                ↓                        ↓
          [Lost]              [Consumed / Retired]
                ↓
         [Needs Repair] → [Available] (after repair)
                        → [Retired] (if uneconomical to fix)
```

---

## What's Not Yet Modeled

1. **Quantity depletion** — items with `quantity > 1` should allow partial consumption. "I have 50 ferrules, I used 12" should update quantity, not lifecycle state.
2. **Expiry dates** — consumables and food items need a `expiryDate` field.
3. **Service/maintenance intervals** — for equipment, a "next service due" concept.
4. **Lent out** — a distinct state for items borrowed by others (currently falls under `lost` or `reserved`).
5. **Pending return** — an item ordered to be returned (wrong part, defective).

---

## Implementation Status

| State | In types | In UI | In filters | Color |
|---|---|---|---|---|
| available | ✅ | ✅ | ✅ | Green |
| in-use | ✅ | ✅ | ✅ | Blue |
| ordered | ✅ | ✅ | ✅ | Amber |
| reserved | ✅ | ✅ | ❌ | Amber |
| needs-repair | ✅ | ✅ | ✅ | Red |
| retired | ✅ | ✅ | ✅ | Dim |
| deprecated | ✅ | ✅ | ❌ | Dim |
| consumed | ✅ | ✅ | ❌ | Dim |
| lost | ✅ | ✅ | ❌ | Dark red |
| sort-required | ✅ | ✅ | ✅ | Amber |
| incorrect-part | ✅ | ✅ | ✅ | Dark red |
| surplus | ✅ | ✅ | ❌ | Brown |
