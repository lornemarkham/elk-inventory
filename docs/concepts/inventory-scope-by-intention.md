# Concept: Inventory Scope by Intention

**Status:** Design principle — active  
**Last updated:** 2026-06-12

---

## The Core Principle

**Inventory scope is not universal. It depends on the user's intention.**

The same person may want to track their pantry with exhaustive detail (every can, every expiry date, calorie counts) while tracking their garage at a high level (power tools, diagnostic gear — but not every screwdriver). Both choices are correct — for their respective goals.

**The system should ask: what are you trying to become capable of? Then it defines what inventory matters.**

This is a foundational design decision. ELK Inventory is not a "track everything" tool. It is a "track what matters for what you're trying to do" tool.

---

## What Makes Something Worth Tracking

Not every object deserves an inventory record. The mental model: **track what you would actually notice if it were missing, misplaced, or gone.**

Track an item when it is one or more of these:

| Reason | Examples |
|---|---|
| **Expensive** | Torque wrench, Raspberry Pi, NOCO jump starter, solar panel |
| **Project-critical** | The one part that, if missing, stops the whole build |
| **Seasonal** | Leaf blower, pool chemicals, camping gear, hunting gear |
| **Hard to find** | Specialty sensors, specific part numbers, discontinued parts |
| **Consumable with expiry** | Oil, filters, first aid supplies, canned food, pool chemicals |
| **Safety-critical** | Fire extinguisher, jump starter, first aid kit, water supply |
| **Easy to lose** | Small electronics, specialty sockets, adapters, specific connectors |
| **Lent to someone** | Anything borrowed by a neighbor or family member |
| **Location unknown** | Things you own but can't reliably find |
| **Ordered / in transit** | Purchases not yet received or placed in inventory |
| **Expiry-managed** | Medications, batteries in emergency kits, reagents, seeds |

Do not track:
- Every obvious daily-use item that's always where it should be
- Every pen, screw, or low-value interchangeable consumable
- Items under ~$10 that are easily replaced and not project-critical
- Items that would never cause you to search, wonder, or go to a store

---

## How Intention Shapes Scope

### Intention: 30-Day Food Resilience

What matters:
- Canned goods (type, quantity, expiry date)
- Bulk dry goods (rice, beans, pasta, oats — in lbs or kg)
- Protein sources (canned fish, meat, dried legumes)
- Water storage (gallons, containers, treatment method, rotation date)
- Cooking fuel (propane, butane canisters — quantity and expiry)
- Calories per day calculation
- FIFO rotation tracking

What probably doesn't matter (at this goal level):
- Utensils, plates, cups — unless specific to emergency use
- Fresh produce (by definition not shelf-stable)
- Restaurant-quality ingredients
- Garden output (future contribution, tracked separately)

What the system needs for this goal:
- `expiryDate` field
- `calories` and `proteinGrams` per serving
- `servingsPerContainer`
- `quantity` in real-world units (lbs, cans, gallons)
- FIFO date tracking ("added on" date)
- Domain: pantry

---

### Intention: Garage / Workshop Projects

What matters:
- High-value power tools (drill, grinder, circular saw, miter saw)
- Diagnostic equipment (OBDLink, compression tester, multimeter)
- Shop equipment (lift, compressor, shop vac)
- Project-specific materials (lumber, fasteners, wire for a specific build)
- Specialty tools (torque wrench, specific socket sizes, tap/die set)
- Consumables that get used on projects (grinding discs, sandpaper, oils)
- Items with unknown location

What probably doesn't matter:
- Every common hand tool (most screwdrivers, wrenches in a set)
- Generic hardware unless project-critical
- Items that are always in one place and never move

What the system needs for this goal:
- `itemClass`, `lifecycleState`, `currentZone`
- `locationDetail` (which container, which drawer)
- `project` linkage (which project is this for?)
- `photoPath` (so you can recognize the right one at a glance)

---

### Intention: Pool Maintenance Readiness

What matters:
- Chemicals (chlorine type and quantity, pH up/down, algaecide, shock)
- Test kit reagents (are they fresh? When to replace?)
- Equipment (pump, filter, heater, cleaner — model and service status)
- Spare parts (O-rings, pump seals, filter cartridges, specific bulbs)
- Seasonal supplies (cover, closing kit, winterizing chemicals)
- Test strips (are they expired?)

What probably doesn't matter:
- Pool toys, floats, decorative items
- Furniture (tracked elsewhere if at all)

What the system needs:
- `expiryDate` or `freshUntil` for chemicals and test reagents
- `compatible` or `hazardous` flag (some chemicals cannot be stored together)
- Seasonal grouping (opening kit vs. closing kit vs. year-round)
- Service schedule (next filter clean, pump inspection)

---

### Intention: ELK Garden Electronics

What matters:
- Installed sensor nodes (type, location in garden, status, last reading)
- Available boards (ESP32, Pi Zero, Pi 5 — quantity and location)
- Available sensors (temperature, humidity, moisture, light — quantity and type)
- Power components (solar panels, charge controllers, batteries, BatteryProtect)
- Communication (LoRa, WiFi, Zigbee — which protocol, which hardware)
- Wiring and cable (gauge, length available, type)
- Connectors (JST, screw terminal, Anderson — quantity)
- Enclosures (weatherproof, available sizes)

What probably doesn't matter:
- Generic components under $2 (resistors, generic capacitors, generic LEDs)
- Single-use wires used in completed installations

What the system needs:
- `partNumber` or `sku` (for exact part matching and reordering)
- `protocol` (I2C, SPI, UART, 1-Wire) for sensors
- `voltage` / `current` specs for power components
- `installedAt` location (which node, which zone in the garden)
- Integration with ELK Garden for installed asset status

---

### Intention: Electronics Components

What matters:
- Microcontrollers (ESP32, Raspberry Pi variants — quantity, location)
- Displays (OLED, LCD, e-ink — size, protocol)
- Power components (LiPo, LiFePO4, DC converters, solar controllers)
- Specialty sensors (CO2, PM2.5, pressure, UV)
- Relay and switch modules
- Development boards (custom PCBs, breakout boards)
- High-value cables and connectors
- Test equipment (oscilloscope, logic analyzer, bench PSU)

What probably doesn't matter:
- Large quantities of generic passives (100Ω resistors, 0.1µF caps)
- Standard through-hole components in bulk
- Single LEDs and basic diodes in large bags

What the system needs:
- `partNumber` or `sku`
- `quantity` with decrement tracking (I used 2 ESP32s today)
- `project` linkage (which ELK project is this destined for?)
- `vendor` (where to reorder from)

---

## Intention-Driven Filtering

The UI should eventually support "intention mode" or "goal context":

> You are in: **Dirt Bike Maintenance Mode**  
> Showing inventory relevant to: tools, mechanic consumables, vehicle parts  
> Filtering out: garden sensors, pantry items, pool chemicals

This keeps the view focused. When Lorne is in the garage working on the bike, he doesn't want to see his ESP32 inventory.

---

## The "Don't Track This" Filter

A useful concept that the system should eventually support: items that have been explicitly decided to not track.

If a user adds an item and then removes it with a "not worth tracking" action, the system should remember that decision. If the same item (by name or category) is suggested again from purchase intake, it should auto-dismiss with a note: "Previously decided not to track this category."

This prevents re-litigating the same decisions repeatedly and keeps the intake friction low.

---

## Summary

| User Intention | What to Track | What to Ignore |
|---|---|---|
| Food resilience | Calories, protein, expiry, water | Utensils, fresh produce |
| Garage projects | High-value tools, specialty parts, project materials | Every screwdriver, common hardware |
| Pool readiness | Chemicals, test reagents, equipment, parts | Pool toys, furniture |
| Garden electronics | Boards, sensors, power components, wire | Generic passives, bulk resistors |
| Dirt bike maintenance | Specific tools, correct consumables, service schedule | Generic tools already tracked elsewhere |
| Emergency readiness | First aid, power backup, water, communication | Everything else |

The system should guide users toward tracking what matters for their goals — and give them clear permission to not track everything else.
