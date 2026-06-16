# Image Rename Plan

Directory: `images/tools/jpg/`

> ✅ COMPLETED — All 20 images renamed on 2026-06-07.
> See `inventory-import.json` for full tool metadata.

---

| Original Filename | Identified Item | Suggested Filename | Confidence | Notes |
|---|---|---|---|---|
| IMG_9885.jpg | **Group shot** — Ryobi AirStrike nailer, Ryobi angle grinder, Ryobi circular saw (corded), Ryobi leaf blower, orange jigsaw, and a drill laid out on a rug | `ryobi-tools-group-shot.jpg` | LOW | ⚠️ This is a multi-tool overview photo. Not useful for any single item's card. Consider keeping as a zone/bench photo, or retake individual shots. |
| IMG_9886.jpg | RIDGID shop vac (orange body, black lid, hose) | `ridgid-shop-vac.jpg` | HIGH | Matches existing inventory item. RIDGID brand label partially visible. |
| IMG_9887.jpg | Ryobi miter saw | `ryobi-miter-saw.jpg` | HIGH | RYOBI label clearly visible. Matches existing inventory item. |
| IMG_9888.jpg | Poulan chainsaw | `poulan-chainsaw.jpg` | HIGH | "Poulan" label in yellow-green clearly visible. Matches existing inventory item. |
| IMG_9889.jpg | Ryobi table saw (on homemade wooden cart) | `ryobi-table-saw.jpg` | HIGH | Ryobi yellow-green, table surface with fence and blade slot. Matches existing inventory item. |
| IMG_9892 2.jpg | Bosch Professional stud finder / wall scanner (with black carry pouch) | `bosch-stud-finder.jpg` | HIGH | "BOSCH Professional" label clearly visible. Matches existing inventory item. ⚠️ Original filename has a space — will need quoting in shell. |
| IMG_9907.jpg | Engine mount plate (flat metal bracket, part number stamped "3N279", with bolts) | `engine-mount-plate.jpg` | MEDIUM | Matches existing surplus inventory item. No brand visible, but part number 3N279 is stamped on the plate. |
| IMG_9908.jpg | OBDLink MX+ (retail box) | `obdlink-mx-plus.jpg` | HIGH | "OBDLink MX+" label clearly visible on box. Matches existing inventory item. |
| IMG_9909.jpg | **Two items**: Inline spark tester (red dome, clear window, spark plug visible) + partial view of compression tester (blue case) | `inline-spark-tester.jpg` | MEDIUM | ⚠️ Two items in one frame. Spark tester is primary subject (centered). Compression tester is only partially visible. Recommend using for spark tester; compression tester has its own solo shot (9910). |
| IMG_9910.jpg | Compression tester kit (open blue case, gauge, hose, brass adapters) | `compression-tester-kit.jpg` | HIGH | Clear solo shot, full kit visible. Matches existing inventory item. |
| IMG_9911.jpg | **Two fuel cans** — small (10L / 2.5 gal) and large (20L / 5 gal), both red | `fuel-cans-10l-20l.jpg` | HIGH | ⚠️ Both cans are in one shot. Inventory has them as two separate items (fuel-can-10l and fuel-can-20l). This is a shared photo. Either use for both, or retake individually. |
| IMG_9912.jpg | Briggs & Stratton lawn mower engine (small engine, recoil starter, carburetor attached) | `lawn-mower-engine.jpg` | HIGH | Clear solo shot on workbench. Matches existing inventory item. |
| IMG_9913.jpg | Motorcycle floor jack / low-profile hydraulic lift (red and black) | `motorcycle-floor-jack.jpg` | MEDIUM | ⚠️ Inventory has this as "Motorcycle Lift" but this looks like a low-profile floor jack, not a full platform lift. Verify the correct item name. Top of lawnmower engine visible in background. |
| IMG_9914.jpg | Alternate angle — lawnmower engine on floor + motorcycle floor jack below | `lawn-mower-engine-alt-angle.jpg` | LOW | ⚠️ Neither subject is the clear focus. Might be redundant with 9912 and 9913. Consider skipping or retaking. |
| IMG_9915.jpg | Two magnetic parts trays — circular bowl (empty) and rectangular tray (full of mixed hardware, bolts, nuts, brackets) | `magnetic-parts-trays-with-hardware.jpg` | HIGH | Matches both "Magnetic Parts Trays" and "Mystery Hardware Tray" inventory items. ⚠️ One shot covers two separate inventory records. |
| IMG_9916.jpg | Two lawn mower carburetors — new/clean one (foreground, shiny) and old/used one (background, dark, with fuel line) | `lawn-mower-carburetors.jpg` | HIGH | Matches "Lawn Mower Carburetor" inventory item. ⚠️ Two carburetors in one shot — new replacement and old removed unit. |
| IMG_9926.jpg | Ryobi circular saw (corded, 7-1/4") | `ryobi-circular-saw.jpg` | HIGH | "RYOBI" label clearly visible. Matches existing inventory item. |
| IMG_9927.jpg | Ryobi AirStrike 18-gauge brad nailer (cordless, ONE+) | `ryobi-airstrike-brad-nailer.jpg` | HIGH | "AirStrike Technology" and "18 Gauge" labels clearly visible. Ryobi ONE+ slot visible. Matches existing inventory item. |
| IMG_9928.jpg | Ryobi angle grinder (corded, 4-1/2") | `ryobi-angle-grinder.jpg` | HIGH | "RYOBI" label partially visible. Grinding disc installed. Matches existing inventory item. |
| IMG_9929.jpg | Ryobi 18V cordless hand vacuum (ONE+, translucent dust cup) | `ryobi-18v-hand-vac.jpg` | HIGH | Ryobi ONE+ 18V 1.5Ah battery visible on top. ⚠️ Not currently in inventory — new item to add. |

---

## Items NOT Photographed (missing from this folder)

These are in the inventory data but no matching photo was found here:

| Inventory Item | Expected Filename |
|---|---|
| Ryobi Drill/Driver | ryobi-drill-driver.jpg |
| Ryobi Leaf Blower | ryobi-leaf-blower.jpg *(appears in group shot 9885 but no solo)* |
| Router | router.jpg |
| Motorcycle Lift | motorcycle-lift.jpg *(9913 may be a floor jack, not a full lift)* |

---

## Decisions Needed Before Renaming

1. **IMG_9885** — Group shot. Keep as zone/overview photo or discard? Would need solo shots for the individual tools.
2. **IMG_9909** — Spark tester + compression tester in one frame. Use for spark tester record?
3. **IMG_9911** — Both fuel cans in one shot. Assign to both items or retake individually?
4. **IMG_9913** — Is this the "Motorcycle Lift" or a floor jack? Confirm which item it belongs to.
5. **IMG_9914** — Secondary/alternate angle. Redundant? Skip?
6. **IMG_9929** — Ryobi 18V hand vac not in inventory. Add as a new item?
7. **Fuel can labels** — 9911 confirms you have a 10L and a 5 gal/20L. Labels visible on both cans.

---

## Ready to Rename (High Confidence, One Item, No Conflicts)

| Original | → Suggested |
|---|---|
| IMG_9886.jpg | ridgid-shop-vac.jpg |
| IMG_9887.jpg | ryobi-miter-saw.jpg |
| IMG_9888.jpg | poulan-chainsaw.jpg |
| IMG_9889.jpg | ryobi-table-saw.jpg |
| IMG_9892 2.jpg | bosch-stud-finder.jpg |
| IMG_9908.jpg | obdlink-mx-plus.jpg |
| IMG_9910.jpg | compression-tester-kit.jpg |
| IMG_9912.jpg | lawn-mower-engine.jpg |
| IMG_9926.jpg | ryobi-circular-saw.jpg |
| IMG_9927.jpg | ryobi-airstrike-brad-nailer.jpg |
| IMG_9928.jpg | ryobi-angle-grinder.jpg |
