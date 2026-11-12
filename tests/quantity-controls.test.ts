// One-tap − / + : which items get it, and what a tap does end to end.
// The controller is exercised against a fake server with the same rules as the
// pantry_* functions; the real functions are covered by pantry-sql.test.ts and
// the "supplies" cases in quantity-sql.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { InventoryItem } from "../src/types/inventory.ts";
import { QuantityController, supportsQuantityControls, type QuantityApi } from "../src/lib/quantityControls.ts";

const base: InventoryItem = {
  id: "tom", name: "Diced Tomatoes", itemClass: "material", lifecycleState: "available",
  currentZone: "storage-room-pantry", recommendedZone: "storage-room-pantry", locationDetail: "White shelf",
  collectionId: null, containerId: null, project: null, tags: [], quantity: 10, photoPath: "", notes: "",
  domain: "food-storage", attributes: { unit: "cans" },
};
const tomatoes = (quantity: number): InventoryItem => ({ ...base, quantity });

class FakeServer {
  qty = 10;
  calls: string[] = [];
  batches = new Map<string, number>();
  undone = new Set<string>();
  failNext: string | null = null;
  delayMs = 0;
  private n = 0;
  private seenRequests = new Map<string, string>();
  private lock: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => T): Promise<T> {
    const run = this.lock.then(async () => { if (this.delayMs) await new Promise(r => setTimeout(r, this.delayMs)); return fn(); });
    this.lock = run.catch(() => undefined);
    return run;
  }
  api(): QuantityApi {
    return {
      use: (_id, q, _lot, req) => this.serial(() => {
        if (this.failNext) { const e = this.failNext; this.failNext = null; return { ok: false as const, error: e }; }
        if (this.seenRequests.has(req)) return { ok: true as const, value: this.seenRequests.get(req)! };
        if (this.qty < q) return { ok: false as const, error: `Only ${this.qty} left, so nothing was removed.` };
        this.qty -= q; const b = `b${++this.n}`; this.batches.set(b, -q); this.seenRequests.set(req, b); this.calls.push("use");
        return { ok: true as const, value: b };
      }),
      receive: a => this.serial(() => {
        this.qty += a.quantity; const b = `b${++this.n}`; this.batches.set(b, a.quantity); this.calls.push("receive");
        return { ok: true as const, value: b };
      }),
      undo: batch => this.serial(() => {
        if (this.undone.has(batch)) return { ok: false as const, error: "That was already undone." };
        this.undone.add(batch); this.qty -= this.batches.get(batch)!; this.calls.push("undo");
        return { ok: true as const, value: `u${++this.n}` };
      }),
      refresh: async () => { latest = tomatoes(this.qty); return [latest]; },
    };
  }
}
let latest: InventoryItem;

function setup() {
  const server = new FakeServer();
  const c = new QuantityController(server.api(), () => "2026-11-12");
  latest = tomatoes(10);
  const settle = async () => { while (c.busy()) await new Promise(r => setTimeout(r, 1)); await new Promise(r => setTimeout(r, 1)); };
  return { server, c, settle };
}

test("food and consumable supplies get − / +; tools, equipment and assets do not", () => {
  assert.equal(supportsQuantityControls(base), true);
  assert.equal(supportsQuantityControls({ ...base, domain: undefined, itemClass: "material" }), true);          // ESP32 boards, screws…
  assert.equal(supportsQuantityControls({ ...base, domain: "food-storage", itemClass: "equipment" }), true);    // food is food
  for (const itemClass of ["tool", "equipment", "project-asset", "installed-asset", "surplus"] as const)
    assert.equal(supportsQuantityControls({ ...base, domain: "workshop", itemClass }), false, itemClass);
  assert.equal(supportsQuantityControls({ ...base, domain: "kitchen-preserving", itemClass: "equipment" }), false); // Mason jars, vacuum sealer
});

test("10 cans → minus → 9 (shown at once) → plus → 10 → Undo → 9", async () => {
  const { server, c, settle } = setup();
  assert.equal(c.adjust(latest, -1), true);
  assert.equal(c.displayQuantity(latest), 9, "shows 9 before the database answers");
  await settle();
  assert.equal(server.qty, 9);
  assert.equal(c.displayQuantity(latest), 9);
  assert.equal(c.notice?.text, "Diced Tomatoes: 9 cans");
  assert.equal(c.notice?.canUndo, true);

  c.adjust(latest, 1); await settle();
  assert.equal(server.qty, 10); assert.equal(c.displayQuantity(latest), 10);

  await c.undo();
  assert.equal(server.qty, 9); assert.equal(c.displayQuantity(latest), 9);
  assert.match(c.notice!.text, /^Undone\. Diced Tomatoes: 9 cans/);
  assert.deepEqual(server.calls, ["use", "receive", "undo"]);
});

test("Undo steps back through several taps, newest first", async () => {
  const { server, c, settle } = setup();
  c.adjust(latest, -1); await settle(); c.adjust(latest, -1); await settle();
  assert.equal(server.qty, 8);
  await c.undo(); assert.equal(server.qty, 9);
  await c.undo(); assert.equal(server.qty, 10);
  await c.undo(); assert.equal(c.notice?.error, true);   // nothing left to undo
  assert.equal(server.qty, 10);
});

test("zero can't go below zero — the tap is refused and nothing is sent", async () => {
  const { server, c, settle } = setup();
  server.qty = 0; latest = tomatoes(0);
  assert.equal(c.adjust(latest, -1), false);
  assert.equal(c.displayQuantity(latest), 0);
  assert.equal(c.notice?.error, true);
  await settle();
  assert.deepEqual(server.calls, []);
});

test("rapid taps are all counted, in order, with no lost updates", async () => {
  const { server, c, settle } = setup();
  server.delayMs = 5;
  for (let i = 0; i < 6; i++) c.adjust(latest, -1);
  assert.equal(c.displayQuantity(latest), 4, "screen follows every tap immediately");
  await settle();
  assert.equal(server.qty, 4);
  assert.equal(server.calls.length, 6);
  assert.equal(c.displayQuantity(latest), 4);
});

test("rapid minus taps past the last can stop at zero", async () => {
  const { server, c, settle } = setup();
  server.qty = 2; latest = tomatoes(2);
  const accepted = [1, 2, 3, 4].map(() => c.adjust(latest, -1));
  assert.deepEqual(accepted, [true, true, false, false]);
  await settle();
  assert.equal(server.qty, 0); assert.equal(c.displayQuantity(latest), 0);
});

test("if the database refuses (someone else took the last one), the screen goes back to the truth and says so", async () => {
  const { server, c, settle } = setup();
  server.qty = 0;                    // another family member just used the last can; we still show 1
  latest = tomatoes(1);
  c.adjust(latest, -1);
  assert.equal(c.displayQuantity(latest), 0);
  await settle();
  assert.equal(c.displayQuantity(latest), 0);
  assert.equal(c.notice?.error, true);
  assert.match(c.notice!.text, /No Diced Tomatoes left/);
});

test("a dropped connection restores the number and says nothing changed", async () => {
  const { server, c, settle } = setup();
  server.failNext = "TypeError: Failed to fetch";
  c.adjust(latest, -1);
  await settle();
  assert.equal(c.displayQuantity(latest), 10);
  assert.match(c.notice!.text, /No connection/);
  assert.equal(server.qty, 10);
});

test("two family members tapping at once both land; both see the same total after refresh", async () => {
  const server = new FakeServer(); server.delayMs = 3;
  const mom = new QuantityController(server.api(), () => "2026-11-12");
  const lorne = new QuantityController(server.api(), () => "2026-11-12");
  latest = tomatoes(10);
  mom.adjust(latest, -1); lorne.adjust(latest, -1); mom.adjust(latest, -1);
  while (mom.busy() || lorne.busy()) await new Promise(r => setTimeout(r, 2));
  await new Promise(r => setTimeout(r, 5));
  assert.equal(server.qty, 7);
  assert.equal(mom.displayQuantity(latest), lorne.displayQuantity(latest));
});

test("tools and equipment: no calls are made, count untouched", async () => {
  const { server, c } = setup();
  const drill: InventoryItem = { ...base, id: "drill", name: "Drill", itemClass: "tool", domain: "workshop", quantity: 1 };
  assert.equal(c.adjust(drill, -1), false);
  assert.equal(c.adjust({ ...drill, itemClass: "equipment" }, 1), false);
  assert.deepEqual(server.calls, []);
  assert.equal(c.displayQuantity(drill), 1);
});
