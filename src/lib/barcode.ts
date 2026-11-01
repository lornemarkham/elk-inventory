// ── Barcode input (pure) ───────────────────────────────────────────────────────
// USB and Bluetooth scanners in keyboard mode ("HID wedge") do nothing special:
// they type the digits very fast and press Enter. So barcode support is
//   1. a normal text box that treats Enter as "look this code up", and
//   2. ScanDetector, which spots that fast burst of keys when no box is focused.
// A code is stored on the product as attributes.barcode (existing JSON column).

import type { InventoryItem } from "../types/inventory";

/** Keep digits only: scanners and people add spaces/dashes; some add a prefix or suffix char. */
export function normalizeBarcode(raw: string): string {
  return raw.replace(/\D+/g, "");
}

/** 8–14 digits (EAN-8 … GTIN-14), typed with at most spaces or dashes. Anything else is not treated as a scan. */
export function looksLikeBarcode(raw: string): boolean {
  const d = normalizeBarcode(raw);
  return /^[\d\s-]+$/.test(raw.trim()) && d.length >= 8 && d.length <= 14;
}

/** UPC-A (12), EAN-13 (13) and GTIN-14 are the same number padded with zeros, so compare without them. */
function canonical(code: string): string {
  const d = normalizeBarcode(code);
  return d.length >= 12 ? d.replace(/^0+/, "") : d;
}

export function sameBarcode(a: string, b: string): boolean {
  const x = canonical(a), y = canonical(b);
  return x !== "" && x === y;
}

export function barcodeOf(item: InventoryItem): string {
  const b = item.attributes?.barcode;
  return typeof b === "string" || typeof b === "number" ? normalizeBarcode(String(b)) : "";
}

/** The products carrying this code (normally one; more than one is a data problem the screen can report). */
export function findByBarcode(items: InventoryItem[], code: string): InventoryItem[] {
  return items.filter(i => { const b = barcodeOf(i); return b !== "" && sameBarcode(b, code); });
}

export interface ScanOptions {
  /** Longest gap between two keys of one scan. Scanners type < 30 ms apart; people take 100+. */
  maxGapMs?: number;
  minLength?: number;
}

/**
 * Feed it every keydown on the page. It returns the code when Enter ends a
 * burst of fast digit keys, otherwise null. A slow, human burst is ignored.
 */
export class ScanDetector {
  private buf = "";
  private poisoned = false;   // a non-digit key arrived: ignore the rest of this burst
  private last = 0;
  private readonly maxGap: number;
  private readonly minLength: number;

  constructor(opts: ScanOptions = {}) {
    this.maxGap = opts.maxGapMs ?? 50;
    this.minLength = opts.minLength ?? 8;
  }

  feed(key: string, timeMs: number): string | null {
    if (timeMs - this.last > this.maxGap) { this.buf = ""; this.poisoned = false; }
    this.last = timeMs;
    if (key === "Enter") {
      const code = this.poisoned ? "" : this.buf;
      this.buf = "";
      this.poisoned = false;
      return code.length >= this.minLength ? code : null;
    }
    if (/^\d$/.test(key)) { if (!this.poisoned) this.buf += key; return null; }
    // Shift/Control etc. arrive between scanner keys on some devices; anything else resets.
    if (key === "Shift" || key === "Control" || key === "Alt") return null;
    this.buf = "";
    this.poisoned = true;
    return null;
  }
}
