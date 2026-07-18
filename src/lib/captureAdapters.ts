// ── Source adapters — step 2 of the capture pipeline ──────────────────────────
//
//   Raw Text → Normalization → PRODUCT DETECTION → Inventory Drafts
//
// A source adapter knows two things about one specific kind of paste:
//   1. matches(raw)      — how confident are we this text came from here?
//   2. detectBlocks(raw) — how do we split it into one block per product?
//
// That's the entire contract. Everything downstream (price/brand/model/
// category extraction, duplicate detection, draft creation, the review UI)
// is source-agnostic and works off the LineBlock[] an adapter returns —
// it never knows or cares whether the text came from Amazon, a Home Depot
// receipt, a forwarded email, or a PDF invoice text-dump.
//
// To add a new source later (Home Depot, Costco, Canadian Tire, an emailed
// order confirmation, a PDF extract, …):
//   1. Write a new object satisfying CaptureSourceAdapter below.
//   2. Push it into ADAPTERS.
// Nothing else in the pipeline changes — not the parser, not the UI, not
// the database layer.

import { splitLines, classifyLine, type ClassifiedLine } from "./captureNormalize";

export interface LineBlock {
  /** The line that names the product itself. */
  titleLine: string;
  /** Price / date / quantity / stray text lines associated with this product. */
  contextLines: ClassifiedLine[];
  /** Adapter-detected vendor override for this specific block (e.g. a marketplace "Sold by" line). */
  vendorHint?: string;
}

export interface CaptureSourceAdapter {
  id: string;
  label: string;
  /** 0–1 confidence this adapter recognizes the pasted text. */
  matches(raw: string): number;
  /** Split the raw text into one block per detected product. Should return at least one block for non-empty input. */
  detectBlocks(raw: string): LineBlock[];
  /** Implied vendor for every product from this source, when the source itself IS the vendor (e.g. "Amazon"). */
  defaultVendor?: string;
}

// ── Amazon "Your Orders" page ─────────────────────────────────────────────────
//
// Copying an entire Amazon orders page gives you order chrome (dates, order
// numbers, shipping status) interleaved with product titles and per-item
// action links. The strategy: recognize and strip the chrome using a list of
// known, long-stable Amazon UI strings, then treat whatever survives that
// looks shaped like a product title as a new product boundary. This is
// deliberately noise-subtraction rather than positional pattern-matching
// against one exact copy-paste sample — Amazon's exact line ordering varies
// by order type (single item, multi-item, subscribe-and-save, digital), but
// this boilerplate copy has stayed stable for years, so subtracting it out
// generalizes far better than assuming a fixed template would.

const AMAZON_SIGNAL_PHRASES = [
  "buy it again",
  "your orders",
  "order placed",
  "order #",
  "view order details",
  "track package",
  "get product support",
  "write a product review",
  "return or replace items",
  "get help with order",
  "view your item",
  "leave seller feedback",
  "archive order",
  "invoice",
  "search all orders",
];

const AMAZON_NOISE_PATTERNS: RegExp[] = [
  /buy it again/i,
  /view order details/i,
  /track package/i,
  /get product support/i,
  /write a product review/i,
  /return or replace items/i,
  /return window/i,
  /get help with order/i,
  /view your item/i,
  /leave seller feedback/i,
  /archive order/i,
  /^invoice$/i,
  // Note: "Ship to" and "Order placed" are handled earlier in detectBlocks()
  // as structural markers (not plain noise) — see there, not here.
  /^order #/i,
  /^total$/i,
  /^your orders$/i,
  /search all orders/i,
  /package was left/i,
  /^delivered\b/i,
  /^arriving\b/i,
  /problem with order/i,
  /get delivery updates/i,
  /share gift receipt/i,
  /^eligible through/i,
  /^condition:/i,
  /^\d+[\s,]*-\s*\d+[\s,]* of[\s\d,+]*orders?$/i, // pagination: "1-10 of 1,000+ orders"
];

const SOLD_BY_RE = /^sold by[:\s]+(.+)$/i;

const MIN_TITLE_LEN = 8;

function looksLikeProductTitle(line: string): boolean {
  if (line.length < MIN_TITLE_LEN) return false;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (/^[$€£]/.test(line)) return false; // pure price
  if (/^(qty|quantity)[:\s]/i.test(line)) return false; // pure qty
  if (/^[A-Z0-9#\-\s]+$/.test(line) && words.length < 3) return false; // short code-like line (e.g. "SKU# 1234")
  return true;
}

function isAmazonNoise(line: string): boolean {
  return AMAZON_NOISE_PATTERNS.some((re) => re.test(line));
}

export const amazonOrdersAdapter: CaptureSourceAdapter = {
  id: "amazon-orders",
  label: "Amazon order history",
  defaultVendor: "Amazon",

  matches(raw) {
    const lower = raw.toLowerCase();
    const hits = AMAZON_SIGNAL_PHRASES.filter((p) => lower.includes(p)).length;
    // Require at least two distinct signals before claiming this text — a
    // single incidental match (e.g. the word "invoice" in an unrelated note)
    // should never be enough to route plain text through order-page splitting.
    if (hits < 2) return 0;
    return Math.min(1, hits / 4);
  },

  detectBlocks(raw) {
    const lines = splitLines(raw);
    const blocks: LineBlock[] = [];
    let pending: ClassifiedLine[] = [];
    let pendingVendorHint: string | undefined;
    let suppressNextLine = false;

    // Amazon's order-page copy alternates between an order HEADER (order
    // date, total, ship-to name, order #) and the product(s) underneath it.
    // The header describes whatever product comes NEXT, not whatever came
    // before — so metadata collected right after "Order placed" must queue
    // up for the upcoming title ("leading"), while metadata seen right after
    // a title (qty, "Sold by", a trailing price) belongs to that title
    // ("trailing"). Getting this direction right is what keeps one order's
    // total from bleeding onto a different order's product.
    let mode: "leading" | "trailing" = "leading";

    for (const line of lines) {
      if (suppressNextLine) {
        // The line right after "Ship to" is always the recipient's name,
        // never a product — and a name has no fixed, listable text to add
        // to the noise blocklist, so it's suppressed positionally instead.
        suppressNextLine = false;
        continue;
      }

      if (/^order placed$/i.test(line)) {
        mode = "leading";
        pending = [];
        pendingVendorHint = undefined;
        continue;
      }

      if (/^ship to$/i.test(line)) {
        suppressNextLine = true;
        continue;
      }

      const soldByMatch = line.match(SOLD_BY_RE);
      if (soldByMatch) {
        const vendor = soldByMatch[1].trim();
        if (mode === "trailing" && blocks.length > 0) blocks[blocks.length - 1].vendorHint = vendor;
        else pendingVendorHint = vendor;
        continue;
      }

      if (isAmazonNoise(line)) continue; // chrome — dropped entirely, not even kept as context

      const classified = classifyLine(line);

      if (classified.kind !== "text") {
        if (mode === "trailing" && blocks.length > 0) blocks[blocks.length - 1].contextLines.push(classified);
        else pending.push(classified);
        continue;
      }

      if (looksLikeProductTitle(line)) {
        blocks.push({
          titleLine: line,
          contextLines: [...pending],
          vendorHint: pendingVendorHint,
        });
        pending = [];
        pendingVendorHint = undefined;
        mode = "trailing"; // metadata from here on belongs to this title, until the next "Order placed" resets it
      }
      // else: short/ambiguous line that's neither known chrome nor
      // title-shaped — dropped rather than guessed at.
    }

    return blocks;
  },
};

// ── Generic fallback ───────────────────────────────────────────────────────────
// Treats the entire paste as a single product. This is exactly today's
// existing single-item behavior — it's what runs for a plain note, a bare
// URL, or one Amazon title pasted alone, and it's the safety net whenever no
// more specific adapter is confident about the text. It never attempts to
// split multi-line input, on purpose: guessing at product boundaries in
// unstructured free text has a much higher false-positive cost (mangling a
// real note into fake "products") than simply treating it as one item.

export const genericAdapter: CaptureSourceAdapter = {
  id: "generic",
  label: "Plain text",
  matches: () => 0.05, // always available as the last resort
  detectBlocks(raw) {
    const lines = splitLines(raw);
    return [
      {
        titleLine: lines[0] ?? raw.trim(),
        contextLines: lines.slice(1).map(classifyLine),
      },
    ];
  },
};

// ── Registry ────────────────────────────────────────────────────────────────
// Order doesn't matter — detectAdapter picks the highest-confidence match.
// A future adapter is added here and nowhere else.
const ADAPTERS: CaptureSourceAdapter[] = [amazonOrdersAdapter, genericAdapter];

export function detectAdapter(raw: string): CaptureSourceAdapter {
  let best: CaptureSourceAdapter = genericAdapter;
  let bestScore = -1;
  for (const adapter of ADAPTERS) {
    const score = adapter.matches(raw);
    if (score > bestScore) {
      best = adapter;
      bestScore = score;
    }
  }
  return best;
}
