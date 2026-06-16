# Concept: Life Inventory — Future Domains

**Status:** Vision  
**Last updated:** 2026-06-12

---

## Overview

ELK Inventory started as a garage tool tracker. The long-term vision is a Life Inventory — a unified system that tracks all important physical assets across every domain of life.

Not every object. Important objects. Expensive, hard-to-find, seasonal, project-critical, consumable-with-expiry, or otherwise meaningful items.

---

## Domain Philosophy

Each domain has different:
- Item classes (tools vs. food vs. installed assets)
- Lifecycle states (consumable expiry vs. maintenance schedules vs. order status)
- Location granularity (zone → container → shelf position vs. field → irrigation zone)
- Update frequency (garage changes monthly, pantry changes weekly, electronics change rarely)
- Display needs (photos matter for tools, quantities matter for pantry, status matters for installed assets)

The data model must be flexible enough to handle all of these without becoming a bloated monstrosity.

---

## The Domains

### 1. Garage

**What it tracks:**
- Hand tools, power tools, diagnostic equipment
- Shop equipment (lift, compressor, welding gear)
- Project assets (things being worked on)
- Materials (fasteners, wire, lumber, adhesives)
- Consumables (oil, filters, sandpaper, grinding discs)
- Surplus (wrong parts, extra items, maybe-discard)

**Key questions it should answer:**
- Where is [tool]?
- What is in the Mechanic Bay right now?
- What should move to the Pool Shed?
- What tools are missing for [project]?

**Current status:** ✅ Primary domain — actively built

**Zones:**
- ELK Labs (electronics, coding)
- Mechanic Bay (motorcycle, small engine, diagnostics)
- Center Island (fabrication, assembly)
- Strength Zone (fitness)
- ELK Lounge (AV, planning)
- Pool Shed (overflow, seasonal, woodworking)

---

### 2. Electronics

**What it tracks:**
- Microcontrollers (ESP32, Raspberry Pi, Arduino)
- Sensors (temperature, humidity, moisture, motion, CO2)
- Actuators (relays, servos, solenoids, motors)
- Displays (OLED, LCD, e-ink)
- Power components (LiPo batteries, solar charge controllers, voltage regulators)
- Connectors (JST, screw terminal, barrel jack, USB)
- Wiring (gauge, color, length, type)
- Tools (soldering iron, oscilloscope, logic analyzer, bench PSU)

**Key questions:**
- Do I have any ESP32s available?
- What sensors do I have for temperature monitoring?
- Is there a relay module available for the garden project?
- How many 22AWG red wire do I have?

**Current status:** 🟡 Partially modeled — items exist but no electronics-specific fields

**Upcoming fields:**
- `partNumber`
- `pinout` or documentation link
- `voltage`, `current`
- `protocol` (I2C, SPI, UART, 1-Wire)
- `project` (which ELK app this is destined for)

---

### 3. Garden

**What it tracks:**
- Installed systems (sensor nodes, cameras, irrigation controllers, valves)
- Equipment (hoses, sprinkler heads, drip emitters, timers)
- Consumables (fertilizers, soil amendments, seeds, pest control)
- Seeds (variety, year purchased, germination rate)
- Tools (trowels, pruners, hose nozzles, soil meters)
- Infrastructure (raised bed materials, trellises, edging, stakes)

**Key questions:**
- What sensors are installed in the garden and where?
- When does the irrigation fertilizer need to be refilled?
- What seeds do I have and when do they expire?
- What is the irrigation zone layout?

**Current status:** 🔴 Not yet modeled beyond generic inventory items

**Integration:** ELK Garden app will eventually be the primary interface for installed garden assets. ELK Inventory holds the physical asset record; ELK Garden holds the operational state (sensor readings, irrigation schedules, etc.).

---

### 4. Pantry / Food Storage

**What it tracks:**
- Canned goods (type, quantity, best-by date)
- Dry goods (rice, beans, pasta, oats — quantity by weight or count)
- Spices and seasonings (freshness window)
- Condiments and sauces (open vs. sealed, refrigerated vs. shelf-stable)
- Baking supplies (flour, sugar, leavening agents)
- Beverages (coffee, tea, water storage)
- Frozen goods (type, quantity, date frozen)
- Meal kits, MREs, or long-term storage foods

**Key questions:**
- How many days of food do we have on hand?
- What's expiring in the next 30 days?
- What proteins do we have stocked?
- Can we make [meal] from what we have?
- What do we need to restock?

**Current status:** 🔴 Not yet modeled

**Special requirements:**
- `expiryDate` field (critical for pantry)
- `calories` and `proteinGrams` per unit (for readiness calculations)
- `storageCondition` (dry/cool, refrigerated, frozen)
- `openedAt` (for items that expire after opening)
- FIFO (first-in, first-out) tracking for rotating stock
- Quantity in non-standard units (lbs, oz, cans, servings)

**Integration:** ELK Kitchen will consume pantry inventory for meal planning and recipe suggestions.

---

### 5. Pool

**What it tracks:**
- Chemicals (chlorine, pH increaser/decreaser, algaecide, shock)
- Test kits and reagents
- Equipment (pump, filter, heater, lights, robot cleaner)
- Spare parts (pump seals, filter cartridges, O-rings)
- Tools (pool brush, vacuum head, telescoping pole, leaf net)
- Seasonal supplies (cover, closing kit, winterizing chemicals)

**Key questions:**
- What chemicals do I have in stock?
- Do I have the chemicals needed to open/close the pool?
- What is the expiry status of the chlorine?
- Is the robot cleaner in good working order?

**Current status:** 🔴 Not yet modeled

**Special requirements:**
- Chemical safety: some items are incompatible and should flag conflicts
- Seasonal workflows: pool opening checklist, pool closing checklist
- `hazardous: true` flag for chemicals requiring storage separation

---

### 6. Property / Home

**What it tracks:**
- Installed appliances (make, model, serial number, purchase date, warranty)
- HVAC (filter size, last service, next service)
- Plumbing (shut-off locations, fixture specs, known issues)
- Electrical (panel layout, circuit map, breaker ratings)
- Structural (roof age, last inspection, material)
- Exterior (paint color codes, siding type, last exterior work)
- Smart home devices (hub, sensors, locks, cameras)

**Key questions:**
- What size air filter does the HVAC use?
- When was the roof last inspected?
- What model is the water heater and when is the warranty?
- What paint color is the front door?

**Current status:** 🔴 Not yet started

**Integration:** This domain eventually becomes a home asset register — useful for insurance claims, renovation planning, and resale.

---

### 7. Emergency Preparedness

**What it tracks:**
- First aid (supplies, training status, expiry of meds)
- Power backup (generator, battery banks, inverters, fuel)
- Water storage (gallons, treatment, containers, rotation date)
- Communication (radios, batteries, antenna)
- Food (emergency-specific — covered by Pantry domain)
- Documents (copies of important papers, insurance, contacts)
- Vehicle emergency kit (jumper cables, flares, first aid, blanket)
- Tools for emergency scenarios (hand tools, duct tape, rope, tarp)

**Key questions:**
- How many days of emergency water do we have?
- When does the first aid kit need to be restocked?
- Is the generator fueled and tested?
- Do we have communication capability if cell service is down?

**Current status:** 🔴 Not yet modeled

**Philosophy:** This is not about prepping for the apocalypse. It's about basic competence:
- Power goes out for 3 days after a storm → no problem
- Water main break for 48 hours → no problem
- Road closed for a week → no problem

---

### 8. Vehicles

**What it tracks:**
- Consumables (oil, filters, brake fluid, coolant, tire pressure)
- Spare parts (belts, hoses, fuses, bulbs)
- Tools specific to the vehicle (tire iron, jack, torque spec reference)
- Emergency kit contents (see Emergency domain)
- Service records (last oil change, mileage, what was done)
- Tires (brand, age, tread depth, rotation date)

**Key questions:**
- When does the truck need an oil change?
- Do I have the right oil and filter in stock?
- What's in the truck kit right now?
- Is the NOCO jump starter charged?

**Current status:** 🟡 Partially modeled via "Truck Kit" zone and vehicle-tagged items

**Integration:** ELK Wrench is the primary vehicle management app. ELK Inventory holds the asset records; ELK Wrench holds the service records, diagnostic data, and maintenance schedules.

---

### 9. Projects

**What it tracks:**
- All materials gathered for a specific project (not yet used)
- Tools reserved for a project
- Parts that have arrived and are waiting for install
- Parts that are ordered and en route
- Project milestones and current phase

**Key questions:**
- What parts have arrived for the dirt bike rebuild?
- What is still on order?
- What tools do I need for this weekend's project?
- What is blocking progress on the garden sensor build?

**Current status:** 🟡 Partially modeled via `project` field on items — but no project entity model

**Upcoming:** A `Project` entity that collects related items, has a status, has phases, and can generate a "readiness to start" report.

---

## Cross-Domain Principles

These principles apply regardless of domain:

1. **Capture fast.** The system must support quick mobile capture. A 60-second add flow is too slow.
2. **Enrich over time.** Add the photo, expiry date, and location detail later. Don't block the initial capture on completeness.
3. **Expiry matters for consumables.** Any domain with consumables (pantry, pool, emergency, vehicle) needs expiry date tracking and alerts.
4. **Location granularity scales by value.** A $3 can of beans doesn't need sub-container tracking. A $400 sensor node does.
5. **Domain fields are optional extensions.** The core `InventoryItem` type works for everything. Domain-specific fields (calories, chemical hazard, circuit number) are optional metadata.

---

## Domain Rollout Priority

Based on current needs and complexity:

| Priority | Domain | Reason |
|---|---|---|
| 1 (current) | Garage | Primary use case — well underway |
| 2 | Electronics | Active ELK Garden build needs component tracking |
| 3 | Pantry | High household value, relatively simple |
| 4 | Pool | Seasonal importance, chemical safety |
| 5 | Vehicles | ELK Wrench integration |
| 6 | Emergency | High value, low urgency |
| 7 | Garden | Managed by ELK Garden app |
| 8 | Property | Long-term home management record |
| 9 | Projects | Emerges naturally from other domains |
