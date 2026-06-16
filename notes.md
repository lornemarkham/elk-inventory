# ELK Inventory

## Milestone: Tool Photo Inventory Working ✓

Completed: 2026-06-07

- Real tool photos now render on inventory cards (Vite serves from `public/inventory-images/`)
- Tool metadata extended with `powerType`, `batteryPlatform`, `photoType`, `brand`, `category`, `subcategory`
- Image rename workflow proven: HEIC → JPG → kebab-case → `public/inventory-images/`
- `inventory-import.json` generated with full metadata for all photographed tools
- Life Inventory expansion documented (food, pantry, pool, garden, electronics, emergency prep)

Known TODOs:
- Missing photos: Ryobi Drill/Driver, Ryobi Leaf Blower, Router, NOCO GB50, Klein multimeter
- Two copies of images exist (`images/tools/` originals + `public/inventory-images/`) — add `sips` automation script
- Husqvarna dirt bike visible in photos but not yet an inventory record
- Battery platform filter (Ryobi ONE+ collection view) not yet built
- ELK Wrench API integration not yet started

---

ELK Inventory is a local-first personal asset memory system. The long-term goal is to evolve it into a shared inventory service that multiple ELK apps can use through an API.

---

## How to Add a New Photo

**Step 1 — Take the photo.**
Shoot in good light. Solo shot preferred. Group shots are OK but tag them `photoType: "group"`.

**Step 2 — Convert if needed.**
iPhone saves as HEIC. Convert to JPG before placing in the app.
Quick convert on Mac: open in Preview → Export As → JPEG.
Or use the `sips` command:
```
sips -s format jpeg IMG_1234.HEIC --out my-tool.jpg
```

**Step 3 — Name the file.**
Use kebab-case. Include brand and item type.
Examples: `ryobi-angle-grinder.jpg`, `klein-multimeter.jpg`, `noco-gb50.jpg`

**Step 4 — Place the file.**
Copy the file to the correct folder under `public/inventory-images/`:

| Item type | Folder |
|---|---|
| Hand tools, power tools | `public/inventory-images/tools/` |
| Diagnostic / measuring | `public/inventory-images/tools/diagnostic/` |
| Shop equipment (vac, jack) | `public/inventory-images/tools/shop-equipment/` |
| Electrical tools | `public/inventory-images/tools/electrical/` |
| Small engines / project parts | `public/inventory-images/projects/small-engines/` |
| Electronic materials (ESP32, etc.) | `public/inventory-images/materials/electronics/` |
| Hardware / fasteners | `public/inventory-images/materials/hardware/` |
| Surplus / wrong parts | `public/inventory-images/surplus/` |
| Vehicle / truck kit | `public/inventory-images/equipment/vehicle/` |

**Step 5 — Set the photoPath in inventory data.**
In `src/data/inventory.ts`, set `photoPath` to the URL path (not the filesystem path):
```
photoPath: "/inventory-images/tools/my-tool.jpg"
```
Vite serves everything under `public/` at `/`. So `public/inventory-images/tools/my-tool.jpg` is served at `/inventory-images/tools/my-tool.jpg`.

**Step 6 — Done.**
The dev server picks it up instantly. No restart needed.

---

## Image Path Pattern

```
Filesystem:  public/inventory-images/{category}/{filename}.jpg
URL in app:  /inventory-images/{category}/{filename}.jpg
Field:       InventoryItem.photoPath = "/inventory-images/{category}/{filename}.jpg"
```

---

## Future ELK Inventory Service

ELK Inventory will eventually become a shared inventory service used by multiple ELK apps through a REST API.

Planned consumers:
- **ELK Wrench** — tools, parts, vehicles, consumables
- **ELK Garden** — sensors, cameras, irrigation parts
- **Pool App** — chemicals, equipment, spare parts
- **ELK Kitchen** — pantry, freezer, recipes
- **ELK Lark** — guest supplies, event items, outdoor gear

---

## TODO — Life Inventory System

This app is intended to grow beyond tools into a broader **Life Inventory** system.

Future categories to support:
- [ ] Tools (current — in progress)
- [ ] Food & Pantry — canned goods, dry goods, expiry tracking
- [ ] Pool Supplies — chemicals, test kits, equipment parts
- [ ] Garden Supplies — seeds, fertilizers, irrigation parts
- [ ] Electronics & Components — ESP32, Raspberry Pi, sensors, relays
- [ ] Emergency / Preparedness — food days calculator, first aid, power backup
- [ ] Vehicle Consumables — oil, filters, fluids, spare parts

Long-term ideas:
- Food/nutrition-days calculator (how many days of food do I have at home?)
- Expiry date tracking for chemicals and food
- QR code labels on physical bins and containers
- REST API so multiple ELK apps can query inventory

---

## Known TODOs (App)

- [ ] Photos missing: Ryobi Drill/Driver, Ryobi Leaf Blower, Router, NOCO GB50
- [ ] Husqvarna dirt bike visible in photos but not yet in inventory
- [ ] Klein Digital Multimeter, MC4 crimper, wire strippers — photos needed
- [ ] Consider collapsing `images/tools/` (HEIC originals) and `public/inventory-images/` — currently two copies
- [ ] Add `sips` conversion script to automate HEIC → JPG → public/
- [ ] ELK Wrench integration: OBDLink MX+ is ready, needs API consumer
- [ ] Battery platform filter (Ryobi ONE+ collection view)
