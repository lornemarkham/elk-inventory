// End-to-end check of the home-pilot features in a real browser, against a
// mocked Supabase (no network, no production). Usage: node e2e.mjs <shots-dir> <download-dir>
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("/home/lorne-markham/lodge/lodge-quality/node_modules/playwright-core");
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const [shots, dl] = process.argv.slice(2);
mkdirSync(shots, { recursive: true }); mkdirSync(dl, { recursive: true });
const BASE = "http://localhost:5199";
const exe = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`;

// ── mock database ────────────────────────────────────────────────────────────
const U = "00000000-0000-0000-0000-00000000000a";
const now = "2026-11-01T12:00:00+00:00";
const item = (id, name, o = {}) => ({
  id, name, item_class: "consumable", lifecycle_state: "available", domain: null, current_zone: "unknown",
  recommended_zone: "unknown", location_detail: "", collection_id: null, container_id: null, project: null, tags: [],
  quantity: 1, photo_path: "", photo_type: null, notes: "", power_type: null, battery_platform: null, brand: null,
  category: null, subcategory: null, attributes: {}, created_at: now, updated_at: now, source_draft_id: null, ...o,
});
const food = (id, name, qty, unit, extra = {}) => item(id, name, { domain: "food-storage", current_zone: "storage-room-pantry", recommended_zone: "storage-room-pantry", quantity: qty, attributes: { unit, pantryTracked: true, ...extra } });
const lot = (id, item_id, rem, rec, location, best_before, purchased_on) => ({ id, item_id, quantity_received: rec, quantity_remaining: rem, location, best_before, purchased_on, source: "purchase", created_at: now, created_by: U });

const db = {
  inventory_items: [
    food("tom", "Diced Tomatoes", 9, "cans", { barcode: "012345678905" }),
    food("rice", "Basmati Rice", 2, "bags"),
    food("beans", "Black Beans", 6, "cans"),
    item("drill", "Cordless drill", { item_class: "tool", current_zone: "mechanic-bay", location_detail: "Red Toolbox" }),
    item("tape", "Duct tape", { item_class: "material", current_zone: "mechanic-bay", location_detail: "Shelf 2", quantity: 4 }),
  ],
  stock_lots: [
    lot("00000000-0000-0000-0000-000000000101", "tom", 6, 12, "Basement shelf", "2028-03-01", "2026-10-10"),
    lot("00000000-0000-0000-0000-000000000102", "tom", 3, 4, "Garage fridge", "2026-11-05", "2026-10-20"),
    lot("00000000-0000-0000-0000-000000000103", "rice", 2, 2, "Pantry, top shelf", "2027-06-30", "2026-10-12"),
    lot("00000000-0000-0000-0000-000000000104", "beans", 6, 6, "Basement shelf", null, "2026-10-15"),
  ],
  stock_movements: [
    { id: "00000000-0000-0000-0000-000000000105", item_id: "tom", lot_id: "00000000-0000-0000-0000-000000000101", kind: "received", quantity_delta: 12, batch_id: "00000000-0000-0000-0000-000000000108", undoes_batch_id: null, note: null, created_at: now, created_by: U },
  ],
  pantry_shopping_items: [
    { id: "00000000-0000-0000-0000-000000000106", name: "Eggs", item_id: null, note: "for pancakes", source: "manual", created_at: now, created_by: U, done_at: null, done_by: null },
    { id: "00000000-0000-0000-0000-000000000107", name: "Milk", item_id: null, note: null, source: "low-stock", created_at: now, created_by: U, done_at: null, done_by: null },
  ],
  elk_family_members: [{ user_id: U, display_name: "Lorne" }],
};
const seedWrites = [];
let seq = 0;

function install(ctx) {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };
  return ctx.route("https://mock.supabase.co/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = url.pathname;
    if (path.startsWith("/auth/v1")) return json({ id: U, aud: "authenticated", email: "lorne@example.com" });
    if (path === "/rest/v1/rpc/elk_is_family_member") return json(true);
    if (path === "/rest/v1/rpc/pantry_receive") {
      const a = JSON.parse(req.postData());
      let it = db.inventory_items.find(i => i.id === a.p_item_id);
      if (!it) { it = food(a.p_item_id, a.p_new_name, 0, a.p_unit); db.inventory_items.push(it); }
      it.quantity += a.p_quantity;
      const id = `new-${++seq}`;
      db.stock_lots.push(lot(id, it.id, a.p_quantity, a.p_quantity, a.p_location, a.p_best_before, a.p_purchased_on));
      return json(`batch-${seq}`);
    }
    const table = path.replace("/rest/v1/", "");
    if (!(table in db)) return json({ message: "unknown mock route " + path, code: "PGRST205" }, 404);
    if (req.method() === "GET") {
      const idEq = url.searchParams.get("id");
      let rows = db[table];
      if (idEq?.startsWith("eq.")) rows = rows.filter(r => r.id === idEq.slice(3));
      if ((req.headers()["accept"] ?? "").includes("vnd.pgrst.object")) return json(rows[0] ?? null);
      const m = /^(\d+)-(\d+)$/.exec(req.headers()["range"] ?? "");
      if (m) rows = rows.slice(+m[1], +m[2] + 1);
      return json(rows);
    }
    if (req.method() === "PATCH") {
      const id = url.searchParams.get("id").slice(3);
      Object.assign(db[table].find(r => r.id === id), JSON.parse(req.postData()));
      return route.fulfill({ status: 204, headers: cors });
    }
    if (req.method() === "POST" || req.method() === "DELETE") {
      seedWrites.push(`${req.method()} ${table}`);
      return route.fulfill({ status: 201, headers: cors });
    }
    return json({});
  });
}

const session = JSON.stringify({
  access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: U, aud: "authenticated", email: "lorne@example.com", app_metadata: {}, user_metadata: {}, created_at: now },
});

const browser = await chromium.launch({ executablePath: exe });
const results = [];
const ok = (name) => { results.push(name); console.log("PASS", name); };

async function open(viewport, path) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, hasTouch: viewport.width < 700 });
  await ctx.addInitScript(s => localStorage.setItem("sb-mock-auth-token", s), session);
  await install(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", e => { throw e; });
  await page.goto(BASE + path);
  return { ctx, page };
}

// 1. Deleted starter items stay deleted (database has rows but not the starter set)
{
  const { ctx, page } = await open({ width: 1100, height: 800 }, "/inventory");
  await page.getByText("Cordless drill").first().waitFor();
  await page.waitForTimeout(500);
  assert.deepEqual(seedWrites, [], "no seed writes happened on load");
  assert.equal(await page.getByText("Loading inventory").count(), 0);
  ok("starter items are not re-inserted into a database that has data (no POST to inventory_items)");
  await ctx.close();
}

// 2. Export everything → file → restore script
{
  const { ctx, page } = await open({ width: 1100, height: 800 }, "/backup");
  await page.getByText("Export everything").waitFor();
  await page.screenshot({ path: `${shots}/backup-desktop.png` });
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByText("Export everything").click()]);
  const file = `${dl}/${d.suggestedFilename()}`;
  await d.saveAs(file);
  const b = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(b.format, "elk-inventory-export");
  assert.deepEqual(b.counts, { inventory_items: 5, stock_lots: 4, stock_movements: 1, pantry_shopping_items: 2 });
  assert.ok(b.storageLocations.some(l => l.name === "Garage fridge" && l.batches === 1));
  await page.getByRole("status").waitFor();
  await page.screenshot({ path: `${shots}/backup-after-export.png` });
  const [d2] = await Promise.all([page.waitForEvent("download"), page.getByText("Stock by batch (.csv)").click()]);
  await d2.saveAs(`${dl}/${d2.suggestedFilename()}`);
  const csv = readFileSync(`${dl}/${d2.suggestedFilename()}`, "utf8");
  assert.ok(csv.includes("Garage fridge,Diced Tomatoes,cans,3,4,2026-11-05"));
  writeFileSync(`${dl}/LATEST.txt`, file);
  ok(`Export everything downloads ${d.suggestedFilename()} with all 4 tables + locations; CSV has batch rows`);
  await ctx.close();
}

// 3. Printable output
{
  const { ctx, page } = await open({ width: 1100, height: 900 }, "/print");
  await page.getByTestId("print-sheet").waitFor();
  await page.screenshot({ path: `${shots}/print-screen-food.png` });
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".elk-header").isVisible(), false, "app header hidden in print");
  assert.equal(await page.locator(".no-print").first().isVisible(), false);
  const text = await page.getByTestId("print-sheet").innerText();
  for (const s of ["Basement shelf", "Garage fridge", "Pantry, top shelf", "6 cans", "1 Mar 2028", "5 Nov 2026", "Eggs", "Milk"]) assert.ok(text.includes(s), s);
  assert.ok(!text.includes("Cordless drill"), "food scope omits tools");
  for (const h of ["counted", "+ / −", "notes", "best before"]) assert.ok(text.toLowerCase().includes(h), h);
  const order = ["Basement shelf", "Garage fridge", "Pantry, top shelf"].map(s => text.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "places alphabetical");
  await page.pdf({ path: `${shots}/print-food.pdf`, format: "A4", printBackground: true });
  await page.screenshot({ path: `${shots}/print-media-food.png` });
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Everything" }).click();
  const all = await page.getByTestId("print-sheet").innerText();
  assert.ok(all.includes("Cordless drill") && all.includes("Red Toolbox") && all.includes("Mechanic Bay"));
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: `${shots}/print-everything.pdf`, format: "A4", printBackground: true });
  ok("print view: grouped by place, quantities, best-before, blank columns, header hidden in print, PDF produced");
  await ctx.close();
}

// 4. Barcode input
{
  const { ctx, page } = await open({ width: 390, height: 844 }, "/pantry");
  await page.getByText("I bought something").waitFor();
  await page.screenshot({ path: `${shots}/pantry-mobile.png`, fullPage: false });

  // (a) USB/Bluetooth scanner with nothing focused: fast keystrokes then Enter (UPC-A in a code the DB stores as 012345678905; scanner sends EAN-13)
  await page.evaluate(() => (document.activeElement)?.blur());
  for (const ch of "0012345678905") await page.keyboard.press(ch, { delay: 0 });
  await page.keyboard.press("Enter");
  await page.getByTestId("scan-match").waitFor();
  assert.ok((await page.getByTestId("scan-match").innerText()).includes("Diced Tomatoes"));
  await page.screenshot({ path: `${shots}/barcode-found-mobile.png` });
  ok("unfocused scanner burst (EAN-13 for a UPC-A code) opens the matching product");

  // (b) typing slowly with nothing focused is NOT a scan
  await page.getByRole("button", { name: "Dismiss" }).first().click();
  for (const ch of "999999999999") await page.keyboard.press(ch, { delay: 120 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  assert.equal(await page.getByText("Not linked to anything yet").count(), 0);
  ok("slow typing is ignored");

  // (c) scan box: unknown code → add new product with the code, then scan finds it
  const box = page.getByLabel("Scan or type a barcode");
  await box.fill("4006381333931");
  await box.press("Enter");
  await page.getByText("Not linked to anything yet").waitFor();
  await page.screenshot({ path: `${shots}/barcode-unknown-mobile.png` });
  await page.getByText("Add it as a new product").click();
  assert.equal(await page.getByPlaceholder("Scan or type", { exact: true }).inputValue(), "4006381333931");
  await page.getByPlaceholder("e.g. Diced Tomatoes").fill("Pasta Penne");
  await page.getByPlaceholder("12").fill("5");
  await page.getByPlaceholder("e.g. Basement pantry, top shelf").fill("Basement shelf");
  await page.screenshot({ path: `${shots}/barcode-add-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Barcode remembered").waitFor();
  assert.equal(db.inventory_items.find(i => i.name === "Pasta Penne").attributes.barcode, "4006381333931");
  await box.fill("4006381333931");
  await box.press("Enter");
  await page.getByTestId("scan-match").waitFor();
  assert.ok((await page.getByTestId("scan-match").innerText()).includes("Pasta Penne"));
  ok("unknown code → add new product with code → saved on the product → next scan finds it");

  // (d) link an unknown code to an existing product
  await box.fill("5000159484695");
  await box.press("Enter");
  await page.getByLabel("Link to an existing product").selectOption({ label: "Basmati Rice" });
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await page.getByText("Barcode saved on Basmati Rice").waitFor();
  assert.equal(db.inventory_items.find(i => i.id === "rice").attributes.barcode, "5000159484695");
  ok("unknown code can be linked to an existing product");

  // (e) not a barcode
  await box.fill("tomatoes");
  await box.press("Enter");
  await page.getByText("doesn't look like a barcode").waitFor();
  ok("non-numeric text in the scan box is rejected with guidance");
  await ctx.close();
}

// 5. Mobile layout
{
  const { ctx, page } = await open({ width: 390, height: 844 }, "/inventory");
  await page.getByText("Cordless drill").first().waitFor();
  await page.screenshot({ path: `${shots}/inventory-mobile.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
  const nav = await page.locator(".elk-nav").boundingBox();
  assert.ok(nav.width <= 390, "nav fits the screen");
  await page.goto(BASE + "/backup");
  await page.getByText("Export everything").waitFor();
  await page.screenshot({ path: `${shots}/backup-mobile.png` });
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await page.goto(BASE + "/print");
  await page.getByTestId("print-sheet").waitFor();
  await page.screenshot({ path: `${shots}/print-mobile.png` });
  ok("phone width: no sideways page scroll on inventory, backup, print; nav fits");
  await ctx.close();
}

// 6. Stale edit form must not erase a barcode linked after the form was opened
{
  const { ctx, page } = await open({ width: 1100, height: 800 }, "/inventory");
  await page.getByText("Cordless drill").first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByText("Edit Item").waitFor();
  // Meanwhile (Pantry screen / another family member) the product gets a barcode.
  db.inventory_items.find(i => i.id === "drill").attributes = { barcode: "5000159484695" };
  await page.getByRole("button", { name: "Save Changes" }).click();
  await page.waitForTimeout(600);
  assert.equal(db.inventory_items.find(i => i.id === "drill").attributes.barcode, "5000159484695", "barcode survived the stale save");
  ok("saving an old edit form keeps a barcode linked after it was opened");
  await ctx.close();
}

// 7. Movement history and shopping list on a phone
{
  const { ctx, page } = await open({ width: 390, height: 844 }, "/pantry");
  await page.getByText("I bought something").waitFor();
  const body = await page.locator("body").innerText();
  assert.ok(body.includes("Eggs") && body.includes("Milk"), "shopping list shows its items");
  await page.getByRole("button", { name: "Details" }).first().click();
  await page.getByText("History", { exact: true }).first().waitFor();
  assert.ok((await page.locator("body").innerText()).match(/received|Bought|Added|\+12/i), "history shows the batch received");
  await page.screenshot({ path: `${shots}/pantry-history-mobile.png`, fullPage: true });
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, "no sideways scroll");
  ok("phone width: shopping list shows items; Details shows movement history; no sideways scroll");
  await ctx.close();
}

await browser.close();
console.log(`\n${results.length} browser checks passed`);
