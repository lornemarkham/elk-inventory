# Concept: Purchase Intake

**Status:** Not yet implemented  
**Priority:** Near-term  
**Last updated:** 2026-06-12

---

## Overview

One of the most important but currently missing flows in ELK Inventory is **purchase intake** — the process of getting items that were just bought into the inventory before they're lost, forgotten, or mis-filed.

The problem: you order 20 things from Amazon across 3 weeks. They arrive in waves. You open the boxes, use some things immediately, set others aside. Six months later, you can't find the cable tester. You don't even remember if you bought it.

Purchase intake solves this by creating a capture point at the moment of purchase, before the item disappears into the garage.

---

## The Smarter Intake Philosophy

**Not every Amazon purchase should automatically become inventory.**

The system's job is not to log every transaction. It is to surface the items that matter and let everything else pass through.

A movie rental: ignore.  
A solar charge controller: definitely inventory.  
A USB cable pack: maybe, if it's project-related.  
A pool chemical: probably — it's a consumable with a quantity that matters.  
A bag of rice (bulk purchase): pantry inventory, if the pantry domain is active.

### The Three-Tier Classification

Every purchase falls into one of three buckets:

| Tier | Examples | Behavior |
|---|---|---|
| **Likely inventory** | Solar controller, torque wrench, ESP32, compression tester | Draft entry created automatically |
| **Maybe inventory** | USB cable pack, generic hardware, small parts | Draft created with a prompt: "Is this project-related?" |
| **Ignore** | Movie rental, streaming subscription, food delivery, daily consumables | Not captured. Dismissed silently or with one tap. |

### Learning from User Behavior

The system should learn from the user's decisions over time:

- User dismisses every USB cable → future USB cable purchases default to "ignore"
- User consistently adds pool chemicals to inventory → pool chemical category defaults to "likely inventory"
- User added 3 ESP32s and confirmed all as inventory → ESP32 purchases are auto-drafted

This reduces intake friction progressively. The first few months, the user trains the system. After that, the system mostly gets it right.

---

## Purchase Channels

### Amazon Orders
The most common source of new inventory. Amazon orders include:
- Item name and description
- Quantity
- Estimated delivery date
- Price paid
- Order ID (useful as a receipt reference)

**Future integration:** Amazon order history can be exported as CSV or scraped from the order page. A lightweight parser could create draft inventory entries from order history — no API key required.

**Practical approach now:** The user manually reviews their Amazon orders weekly or monthly and adds items to the draft queue. This is low-tech but workable.

### Email Receipts
Many purchases come with email confirmations from:
- Amazon, Home Depot, Lowe's
- McMaster-Carr, Grainger
- Mouser, DigiKey, Adafruit
- Local hardware stores (sometimes)

Email receipts typically contain enough data to create a draft entry: item name, quantity, cost.

**Future integration:** Forward receipts to a dedicated intake address. A parser creates draft entries. User reviews and approves.

### Screenshots
The lowest-friction intake method. Take a screenshot of:
- An Amazon cart or order confirmation
- A product page on a supplier's site
- A text message about a purchase
- A handwritten note about something bought in person

**Future integration:** OCR + LLM parsing to extract item name, quantity, and category. Lands in draft queue for review.

### In-Person Cash Purchases
Bought at a garage sale, hardware store, swap meet, or market. No receipt.

**Capture method:** Quick-add form on mobile. Name, rough category, zone, and optionally a photo. Minimum viable capture — enrich later.

---

## Classification Examples

| Item | Classification | Reason |
|---|---|---|
| Solar MPPT charge controller | Likely inventory | Project-critical, expensive, specific |
| Pool chlorine (10 lbs) | Likely consumable inventory | Tracked for readiness, depletes |
| ESP32 development board | Likely inventory | Project material, worth tracking quantity |
| Compression tester kit | Likely inventory | Specialty tool, expensive, project-critical |
| Movie rental | Ignore | Not a physical asset |
| Streaming subscription | Ignore | Not a physical asset |
| USB cable 3-pack under $10 | Maybe inventory | If project-related: yes. Otherwise: no. |
| Bulk rice 25 lbs | Pantry inventory | Only if pantry domain is active |
| Water filter replacement cartridge | Maybe consumable | Track if expiry/replacement schedule matters |
| Paper towels 12-pack | Ignore | Generic household consumable, not worth tracking |
| Motorcycle chain lube | Likely inventory | Vehicle consumable, worth tracking for maintenance readiness |
| Nitrile gloves 100-pack | Maybe inventory | Worth tracking for shop readiness, or ignore |
| Ethernet cable 25 ft | Maybe inventory | If for ELK Garden install: yes. Generic cable: no. |

---

## The Draft Queue

All intake should land in a **draft queue** — a holding area reviewed before items enter active inventory.

### Why a Draft Queue (Not Direct Import)
- Prevents garbage data from entering active inventory
- Allows the user to correct auto-populated fields before they become permanent
- Creates a review moment: does this actually need to be tracked?
- Separates "bought it" from "located it" — two distinct events

### Draft Queue Properties
Each draft item:
- `status: "draft"` — not yet in active inventory
- `source` — how it arrived: `"amazon"`, `"email"`, `"screenshot"`, `"manual"`, `"learned"`
- `draftNotes` — raw import data, OCR text, or receipt snippet
- `purchasedAt` — date of purchase (if known)
- `expectedDelivery` — if ordered and not yet arrived
- `cost` — price paid

### Draft Queue UI Actions
- **Approve** — confirm the item, assign zone and location, moves to active inventory
- **Edit then approve** — fix the name, category, or zone before approving
- **Dismiss (not inventory)** — this item doesn't need tracking, remove draft
- **Dismiss + remember** — "don't suggest this category again" — trains the classifier
- **Merge** — this is the same as an existing item, merge quantities

---

## The Photo Capture Moment

The ideal photo capture flow:
1. Box arrives
2. Open box, pull out item
3. Open ELK Inventory (fast — 1–2 taps to draft queue)
4. Find the matching draft entry
5. Take photo right there
6. Set zone and location detail
7. Approve → item enters active inventory with photo

This requires the app to be fast, mobile-friendly, and camera-accessible. The current web app works on mobile but is not optimized for it. A PWA or native wrapper would make this significantly better.

---

## Duplicate Detection at Intake

Purchase intake must answer the question: **do I already own this?**

Before a draft is approved, the system should:
1. Search existing inventory for a name/category match
2. If found, alert: "You already own [item] in [zone]. Is this a replacement or a second unit?"
3. User chooses:
   - "This is a replacement" → mark old item as `retired`, add new item
   - "This is an additional unit" → merge or add with updated quantity
   - "False alarm, different item" → proceed as new item

Without this check, the inventory fills with duplicates.

---

## Intake Without the System

Until purchase intake is built, the manual workflow:

1. When an Amazon order ships, add a draft item manually with `lifecycleState: "ordered"`
2. When it arrives, update `lifecycleState: "available"`, add photo, set zone
3. Use the export JSON button as an occasional backup

This is workable. It requires discipline but not new features.

---

## Implementation Plan

### Phase 1 (Now — Manual)
- Use "Add Item" form to capture new purchases
- Set lifecycle state to `ordered` when bought, `available` when received
- Add photo at time of receipt
- Export JSON as occasional backup

### Phase 2 (Near-term — Draft Queue)
- Add `draft` as a lifecycle state
- Add a Draft Queue tab in the app
- Add a quick-capture mode: name + photo, assign zone later
- Manual "import from Amazon order" via CSV or copy-paste

### Phase 3 (Mid-term — Automated Intake)
- Screenshot upload with OCR parsing
- Email forwarding/parsing
- Duplicate detection at review stage
- Classification learning from user behavior

### Phase 4 (Long-term — Intelligent Intake)
- LLM-assisted review: suggest category, zone, tags from item name
- Goal alignment check: "This item closes a gap in your [goal]"
- Automatic FIFO tracking for consumables
- Smart "should this be inventory?" recommendation with confidence score

---

## Open Questions

1. Should cost live on the item record or in a separate purchase log?
2. Should the system track depreciated value or only purchase price?
3. How are cash/gift card purchases handled — unknown cost or zero?
4. Should draft items appear in zone counts and capability calculations?
5. At what point does "ordered" become "overdue" and trigger a follow-up prompt?
