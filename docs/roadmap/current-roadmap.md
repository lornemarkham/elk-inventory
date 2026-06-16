# ELK Inventory — Current Roadmap

**Last updated:** 2026-06-12  
**Current version:** Milestone 2 (localStorage + CRUD)

---

## Guiding Product Questions

Every feature and milestone should be evaluated against these questions. If a proposed feature doesn't help answer at least one of them, reconsider building it.

1. **Where is it?** — Can I find a specific item in under 30 seconds?
2. **Do I already own it?** — Can I know at the moment of purchase, not after?
3. **What am I missing?** — What's between me and completing a project or achieving a capability?
4. **What is blocking me?** — Why is this project stalled, and what's the next unblock?
5. **What am I capable of?** — What can I actually do right now with what I have?
6. **What should I prioritize?** — Of everything demanding attention, what moves the needle most?
7. **What did I buy that still needs a home?** — What's arrived but not yet been located and tracked?
8. **What should become inventory and what should be ignored?** — How do I keep the system clean and trusted without over-tracking?

---

## Completed: Milestone 1 — Tool Photo Inventory

*Completed: 2026-06-07*

- React + Vite + TypeScript scaffolded
- `InventoryItem` data model with itemClass, lifecycleState, zones, collections, containers
- Seed data: ~30 garage tools with photos
- Real tool photos rendering on inventory cards
- Vite serving images from `public/inventory-images/`
- Photo rename workflow proven (HEIC → JPG → kebab-case)
- Zone system: ELK Labs, Mechanic Bay, Center Island, Strength Zone, ELK Lounge, Pool Shed, Truck Kit, Garden, Unknown
- Collection and Container models
- Summary stats: ZoneSummary component
- Filters by itemClass, lifecycleState, zone, collection, tags
- Full-text search across name, class, state, zone, project, tags, notes, brand
- Clickable cards with ItemDetailPanel modal
- Zone page with zone grid and zone detail view
- Collections page
- "Garage notebook" dark theme, warm colors, rugged aesthetic

---

## Completed: Milestone 2 — Persistence + CRUD

*Completed: 2026-06-12*

- `localStorage` persistence (key: `elk-inventory-items`)
- Safe JSON parse with fallback to seed data
- `createdAt` / `updatedAt` ISO timestamps on items
- `crypto.randomUUID()` for new item IDs
- Edit mode in `InventoryForm` — reuses form component, renders as modal overlay
- Delete with 2-step confirmation in `ItemDetailPanel`
- Export JSON button (downloads current localStorage state)
- Reset to seed data button (with confirmation)
- `brand`, `category`, `subcategory`, `powerType`, `batteryPlatform`, `photoType` extended fields
- Documentation structure under `/docs` — vision, concepts, decisions, roadmap

---

## Milestone 3 Options — Under Consideration

The next milestone has several strong candidates. The right choice depends on where daily use reveals the most friction. Do not commit to one path until there is 2–4 weeks of real usage to draw from.

### Option A: Fuzzy Search + Duplicate Detection
**Answers:** "Do I already own it?" + "Where is it?" (when names don't match exactly)

- Replace exact-match search with fuzzy matching (fuse.js or similar — no build overhead)
- Match partial words: "grind" → "angle grinder"
- Handle imprecise input: "noco" → "NOCO GB50 Jump Starter"
- At item entry, check for likely duplicates by name similarity
- Show warning: "This looks like [item]. Duplicate?"
- User confirms or proceeds

**When to choose this:** The moment searching feels like a friction point. If you search for something you know is in the inventory and don't find it, this is the priority.

---

### Option B: Structured Locations — "Find It Fast"
**Answers:** "Where is it?" at the physical level, not just zone level

- Extend `locationDetail` with structured sub-location: zone → container → compartment/drawer/shelf
- Container quick-filter: "Show me everything in the Red Toolbox"
- Zone → container hierarchy in UI
- "Last verified location" timestamp

**When to choose this:** When items are in the system but finding the physical item still requires searching. The inventory answers "Mechanic Bay" but not "which case in the Mechanic Bay."

---

### Option C: Purchase Tracking + Draft Queue
**Answers:** "What did I buy that still needs a home?" + "Do I already own it?"

- `lifecycleState: "draft"` for items not yet received or located
- Basic draft queue tab in the app
- Quick-capture mode: name + photo, zone assigned later
- `orderedAt` date field
- Mark as received: updates to `available` + triggers photo + location prompt

**When to choose this:** When a real pattern of "I ordered it and lost track of it" appears. When Amazon purchases are landing and not making it into inventory.

---

### Option D: Documentation-to-Product Alignment
**Not a user-facing feature — a developer milestone**

- Review the completed docs and identify any product decisions that aren't yet reflected in the data model or UI
- Audit seed data quality
- Clean up technical debt (two copies of images, missing photos, normalize seed items)
- Add a Project entity (not just a `project` string field)
- Consider adding a `lastVerifiedAt` field (when was location last confirmed?)

**When to choose this:** Before adding any new domain or major feature. A clean foundation is worth a sprint.

---

## Mid Term — Milestone 4: SQLite + Native App

*Target: Q4 2026 / Q1 2027*

### SQLite Persistence
- Replace localStorage with SQLite via better-sqlite3
- Electron wrapper (desktop-first, local-first, no server required)
- Migration path: export localStorage JSON → import to SQLite on first run
- Preserve all existing data model fields
- Database-backed means: queryable, relational, efficient at scale

**Why Electron:** No server to manage. File-based SQLite is trivially backed up. Works offline. Can access local filesystem for photo management. Wraps existing Vite + React frontend with minimal changes.

**Why SQLite:** Local-first. Zero config. The database is a file. Trivial to export. Adequate for personal inventory at any realistic scale.

### Local REST/IPC API
- Electron main process communicates with renderer via IPC
- Opens path to: mobile app on same WiFi, future cloud sync if ever needed

### Multiple Photos Per Item
- `photoPath: string` → `photoPaths: string[]`
- Photo carousel in detail panel
- Primary photo selection

### Draft Queue UI
- Dedicated tab for `ordered` and `draft` items
- Approve workflow: review → photo → zone → approve → active inventory
- Duplicate detection at approval step

---

## Long Term — Milestone 5+: Capability + Life Inventory

*Target: 2027+*

### Inventory Goals
- Goal entity with required items and optional items
- Readiness percentage calculation from current inventory
- Gap report: missing, unknown quantity, wrong state
- Estimated gap cost for shopping list generation
- Critical path identification: "Fix these 2 items to unblock 80% of the goal"
- Pre-built goal templates: Dirt Bike Maintenance, 30-Day Pantry, etc.

### Pantry Domain
- `expiryDate` field and expiry alert logic
- `calories`, `proteinGrams` per serving
- `servingsPerContainer` and quantity in real-world units
- FIFO rotation tracking
- Days-of-food calculation per household
- Restock suggestions
- Garden-to-pantry contribution tracking

### Additional Domains (in priority order)
1. Electronics — ESP32, sensors, components, power systems
2. Pantry — food, water, expiry, readiness calculation
3. Pool — chemicals, equipment, seasonal workflows
4. Vehicles — consumables, service records, ELK Wrench integration
5. Emergency — generator, first aid, water buffer, power backup

### AI Decision Support
- Fuzzy search (client-side — fuse.js, no LLM needed)
- Purchase classification: "is this inventory or not?"
- Goal alignment check at purchase: "does this fill a gap?"
- Natural language query: "what do I need for the dirt bike project?"
- Receipt/screenshot parsing with OCR + LLM extraction

See `concepts/ai-decision-support.md` for full design.

### ELK Inventory Service API
- REST API exposing inventory data across ELK apps
- ELK Wrench, ELK Garden, ELK Kitchen all query inventory
- Shared asset backbone for the ELK ecosystem

---

## Technical Debt & Known Issues

| Issue | Severity | Planned Fix |
|---|---|---|
| Two copies of images (`images/tools/jpg/` and `public/inventory-images/`) | Low | Cleanup script; delete originals |
| Missing photos: Ryobi Drill, Leaf Blower, Router, NOCO GB50, Klein multimeter | Low | Next photo capture session |
| `project` field is a free-text string, not a linked entity | Medium | Add Project entity in Milestone 3D or 4 |
| No quantity decrement UI for consumables | Medium | Add +/- quantity controls in detail panel |
| Single `photoPath` string instead of array | Medium | Migrate to `photoPaths: string[]` in M4 |
| Seed data has inconsistent field completeness | Low | Normalize all seed items in M3D |
| No sort on inventory grid | Low | Add sort by name, date added, zone, class |
| No JSON import flow (only export) | Medium | Add JSON import in M3 |
| Husqvarna dirt bike in photos but no inventory record | Low | Add record |
| `lifecycleState` not enforced as select on form — free text possible | Low | Form validation with select dropdowns |
| No mobile-optimized quick-capture flow | High | Addressed in M4 with native app wrapper |

---

## Guiding Constraints (Permanent)

These do not change without a specific, documented reason:

1. **Local-first** — no cloud dependency for core functionality
2. **No auth** — personal tool, single user, no login
3. **No overbuilding** — implement what is needed now, not what might be needed
4. **Fast capture** — adding an item should take under 60 seconds on a good day
5. **Readable in a garage** — minimum 16px body text, high contrast, works on a phone screen in bright light
6. **Data portability** — inventory data must always be exportable as plain JSON
7. **Build for Lorne first** — every feature passes the "does this help Lorne?" test before any other consideration
