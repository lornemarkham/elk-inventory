// ── One-tap quantity controls (pure) ───────────────────────────────────────────
// Decides which items get − / + buttons, and runs a tap through the existing
// pantry_* database functions (pantryDb.use / receive / undo) so every change
// is locked, bounded at zero, and kept in stock_movements history. There is no
// second adjustment path: this file only queues taps and keeps the screen in
// step with the database.
//
//   Food (domain food-storage)       → consumed and restocked → − / +
//   Consumable supplies (material)   → consumed and restocked → − / +
//   Tools, equipment, assets, surplus → NOT consumed → no buttons
//     (their workflows are borrow / return / move / maintain, not a count)
//
// New workflows (scan-to-remove, shopping suggestions) can reuse
// QuantityController.adjust(item, delta) unchanged.

import type { InventoryItem } from "../types/inventory";
import type { PantryResult } from "./pantryDb";
import { countLabel, unitOf } from "./pantryModel";

/** Does a plain − / + make sense for this item? */
export function supportsQuantityControls(item: InventoryItem): boolean {
  return item.domain === "food-storage" || item.itemClass === "material";
}

export interface QuantityApi {
  use(itemId: string, quantity: number, lotId: string | null, requestId: string): Promise<PantryResult<string>>;
  receive(args: { itemId: string; quantity: number; location: string; bestBefore: string | null; purchasedOn: string; requestId?: string }): Promise<PantryResult<string>>;
  undo(batchId: string): Promise<PantryResult<string>>;
  /** Re-read the item list from the database; returns it (null if the read failed). */
  refresh(): Promise<InventoryItem[] | null>;
}

export type QuantityNotice = {
  text: string;
  error?: boolean;
  /** Present while the last change can still be taken back. */
  canUndo?: boolean;
  /** Bumps on every notice so the screen can restart its auto-dismiss timer. */
  seq: number;
};

interface Entry {
  item: InventoryItem;
  /** Taps sent (or queued) whose result we haven't heard yet. */
  inflight: number;
  /** What the screen shows while taps are in flight; null = just show the stored count. */
  shown: number | null;
  chain: Promise<void>;
  /** Confirmed changes, newest last: batch ids that Undo can reverse. */
  undo: { batch: string; delta: number }[];
}

export class QuantityController {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private seq = 0;
  private lastUndoItem: string | null = null;
  notice: QuantityNotice | null = null;
  /** Bumps whenever a database change is confirmed (other screens reload on it). */
  version = 0;

  private api: QuantityApi;
  private today: () => string;
  private newId: () => string;
  constructor(api: QuantityApi, today: () => string, newId: () => string = () => crypto.randomUUID()) {
    this.api = api; this.today = today; this.newId = newId;
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  /** Bumps on every change the screen should redraw for. */
  rev = 0;
  private emit() { this.rev++; for (const fn of this.listeners) fn(); }

  /** What to show: the number the taps so far add up to while saving, else the stored count. */
  displayQuantity(item: InventoryItem): number {
    const e = this.entries.get(item.id);
    return Math.max(0, e && e.shown !== null ? e.shown : item.quantity);
  }

  isSaving(itemId: string): boolean {
    return (this.entries.get(itemId)?.inflight ?? 0) > 0;
  }

  /** Any tap still on its way? (Background refreshes wait.) */
  busy(): boolean {
    for (const e of this.entries.values()) if (e.inflight > 0) return true;
    return false;
  }

  dismiss = () => { this.notice = null; this.emit(); };

  private say(text: string, extra: { error?: boolean; canUndo?: boolean } = {}) {
    this.notice = { text, seq: ++this.seq, ...extra };
    this.emit();
  }

  private entry(item: InventoryItem): Entry {
    let e = this.entries.get(item.id);
    if (!e) { e = { item, inflight: 0, shown: null, chain: Promise.resolve(), undo: [] }; this.entries.set(item.id, e); }
    if (e.inflight === 0) e.item = item;
    return e;
  }

  /** One tap. delta is +1 or −1. Returns false when the tap was refused (already zero). */
  adjust(item: InventoryItem, delta: 1 | -1): boolean {
    if (!supportsQuantityControls(item)) return false;
    const e = this.entry(item);
    const base = this.displayQuantity(item);

    // Zero is the floor — judged against what's on screen, so rapid taps can't queue a minus below zero.
    if (delta < 0 && base <= 0) {
      this.say(`No ${item.name} left to take out.`, { error: true });
      return false;
    }

    e.shown = base + delta;
    e.inflight++;
    this.emit();
    e.chain = e.chain.then(() => this.send(e, delta));
    return true;
  }

  private async send(e: Entry, delta: 1 | -1) {
    const item = e.item;
    const unit = unitOf(item);
    let r: PantryResult<string>;
    try {
      r = delta < 0
        ? await this.api.use(item.id, 1, null, this.newId())
        : await this.api.receive({
            itemId: item.id, quantity: 1, location: item.locationDetail ?? "",
            bestBefore: null, purchasedOn: this.today(), requestId: this.newId(),
          });
    } catch (err) {
      r = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    e.inflight--;
    if (!r.ok) {
      if (e.shown !== null) e.shown -= delta;               // take this tap back off the screen
      if (e.inflight === 0) { e.shown = null; await this.safeRefresh(e); }
      this.say(friendly(r.error, item.name, delta), { error: true });
      return;
    }
    e.undo.push({ batch: r.value, delta });
    this.lastUndoItem = item.id;
    this.version++;
    // Re-read only once the last queued tap has landed, so a refresh never
    // snaps the number back while more taps are in flight.
    if (e.inflight === 0) {
      await this.safeRefresh(e);
      e.shown = null;
    }
    this.say(`${item.name}: ${countLabel(this.displayQuantity(e.item), unit)}`, { canUndo: true });
  }

  private async safeRefresh(e: Entry) {
    try {
      const fresh = await this.api.refresh();
      const mine = fresh?.find(i => i.id === e.item.id);
      if (mine) e.item = mine;
    } catch { /* keep the last known count; the next refresh will catch up */ }
  }

  /** Take back the most recent confirmed change. */
  async undo(): Promise<void> {
    const id = this.lastUndoItem;
    const e = id ? this.entries.get(id) : undefined;
    // Wait for taps still in flight so the undo applies to a settled count.
    if (e) await e.chain;
    const last = e?.undo.pop();
    if (!e || !last) { this.say("Nothing to undo.", { error: true }); return; }
    const r = await this.api.undo(last.batch);
    if (!r.ok) {
      e.undo.push(last);
      this.say(r.error, { error: true, canUndo: true });
      return;
    }
    this.version++;
    await this.safeRefresh(e);
    this.lastUndoItem = e.undo.length > 0 ? id : null;
    this.say(`Undone. ${e.item.name}: ${countLabel(this.displayQuantity(e.item), unitOf(e.item))}`, { canUndo: e.undo.length > 0 });
  }
}

function friendly(error: string, name: string, delta: number): string {
  if (/only \d+ left|nothing was removed/i.test(error)) return `No ${name} left to take out — someone else may have just used the last one.`;
  if (/PGRST202|could not find the function|schema cache/i.test(error)) return "Quantity tracking isn't switched on in the database yet.";
  if (/sign in|family list/i.test(error)) return error;
  if (/fetch|network|failed to/i.test(error)) return `No connection — ${name} was not ${delta < 0 ? "reduced" : "increased"}. Try again.`;
  return `Couldn't change ${name}: ${error}`;
}
