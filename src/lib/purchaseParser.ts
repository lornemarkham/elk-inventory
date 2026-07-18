// ── Deterministic Capture parser ──────────────────────────────────────────────
// Pure functions, no React, no network, no AI. See docs/purchase-intake-v1-spec.md
// for the single-item design this builds on, and the "Capture Actually Useful"
// pipeline description below for the multi-product extension.
//
//   Raw Text → Normalization → Product Detection → INVENTORY DRAFTS
//                (captureNormalize.ts)  (captureAdapters.ts)  (this file)
//
// A source adapter (captureAdapters.ts) only ever produces LineBlock[] — the
// boundaries of each detected product, plus whatever price/date/qty/vendor
// context lines fell near it. Everything below turns ONE block into one
// ExtractedFields record. Nothing here knows or cares which adapter produced
// the block, which is what makes this step reusable across sources: the
// Amazon adapter, a future Home Depot adapter, and the generic single-item
// fallback all hand their blocks to the exact same extraction logic.
//
// Every extraction pass is independent and failure-tolerant — a miss on one
// field never affects another, and nothing here throws. `name` is the one
// field guaranteed to be non-empty, because InventoryItem.name is required
// at approval time.

import type { InventoryItem } from "../types/inventory";
import type { Collection } from "../types/inventory";
import type { ExtractedFields } from "../types/purchase";
import { detectAdapter, genericAdapter, type CaptureSourceAdapter, type LineBlock } from "./captureAdapters";
import type { ClassifiedLine } from "./captureNormalize";
import { extractWithAI, type RawAiProduct } from "./aiExtractor";

const KNOWN_VENDORS = [
  "Amazon", "Home Depot", "Lowe's", "Lowes", "McMaster-Carr", "McMaster",
  "Canadian Tire", "Princess Auto", "Walmart", "Costco", "Best Buy",
  "AliExpress", "eBay", "DigiKey", "Mouser", "Adafruit", "SparkFun",
  "Rona", "Home Hardware", "Napa", "O'Reilly",
];

const URL_RE = /https?:\/\/\S+/i;
const PRICE_RE = /[$€£]\s?\d+(?:,\d{3})*(?:\.\d{2})?|\b\d+(?:\.\d{2})?\s?(?:USD|CAD|EUR|GBP)\b/i;
const QTY_PATTERNS: RegExp[] = [
  /\bqty[:\s]*(\d+)\b/i,
  /\bquantity[:\s]*(\d+)\b/i,
  /\bx\s?(\d+)\b/i,
  /\bpack of (\d+)\b/i,
  /\((\d+)\s*(?:pack|pcs|count)\)/i,
];

// MM/DD/YYYY or M/D/YY, "Month D, YYYY", ISO YYYY-MM-DD
const DATE_PATTERNS: { re: RegExp; toISO: (m: RegExpMatchArray) => string | null }[] = [
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    toISO: (m) => `${m[1]}-${m[2]}-${m[3]}`,
  },
  {
    re: /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/,
    toISO: (m) => {
      const month = m[1].padStart(2, "0");
      const day = m[2].padStart(2, "0");
      const year = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${year}-${month}-${day}`;
    },
  },
  {
    re: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i,
    toISO: (m) => {
      const monthIdx = [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december",
      ].indexOf(m[1].toLowerCase());
      if (monthIdx === -1) return null;
      const month = String(monthIdx + 1).padStart(2, "0");
      const day = m[2].padStart(2, "0");
      return `${m[3]}-${month}-${day}`;
    },
  },
];

// A "model number"-shaped token: mixes letters and digits, 2–4 leading
// alphanumerics, optionally hyphenated. Best-effort by design — model
// numbers have no universal format, so this catches common cases (GB40,
// DCD771C2, WX550L) and simply returns null otherwise rather than guessing.
const MODEL_TOKEN_RE = /^(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9]{2,4}-?[A-Za-z0-9]{1,6}$/;
const UNIT_LIKE_RE = /^\d+(?:\.\d+)?(?:V|W|A|Ah|mm|cm|in|ft|lb|oz|L|mL|pc|pcs)$/i;

const MAX_PRODUCTS_PER_CAPTURE = 25;

function extractUrl(raw: string): string | null {
  const match = raw.match(URL_RE);
  if (!match) return null;
  // Strip tracking query params for the stored value; rawText keeps the original.
  return match[0].split("?")[0];
}

function extractPrice(raw: string): { price: number | null; currency: string | null } {
  const match = raw.match(PRICE_RE);
  if (!match) return { price: null, currency: null };
  const text = match[0];
  const numeric = text.replace(/[^0-9.]/g, "");
  const price = numeric ? parseFloat(numeric) : null;
  let currency = "USD";
  if (text.includes("€") || /EUR/i.test(text)) currency = "EUR";
  else if (text.includes("£") || /GBP/i.test(text)) currency = "GBP";
  else if (/CAD/i.test(text)) currency = "CAD";
  return { price: price !== null && Number.isFinite(price) ? price : null, currency };
}

function extractQuantity(raw: string): number {
  for (const pattern of QTY_PATTERNS) {
    const match = raw.match(pattern);
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return 1; // never null — matches the rest of the app's quantity convention
}

function extractPurchaseDate(raw: string): string | null {
  for (const { re, toISO } of DATE_PATTERNS) {
    const match = raw.match(re);
    if (match) {
      const iso = toISO(match);
      if (iso) return iso;
    }
  }
  return null; // left null on purpose — review UI defaults the picker to today
}

function extractVendor(raw: string): string | null {
  const lower = raw.toLowerCase();
  for (const vendor of KNOWN_VENDORS) {
    if (lower.includes(vendor.toLowerCase())) return vendor;
  }
  return null;
}

function extractBrand(raw: string, items: InventoryItem[]): string | null {
  const lower = raw.toLowerCase();
  const knownBrands = new Set(
    items.map((i) => i.brand).filter((b): b is string => !!b && b.trim().length > 0),
  );
  for (const brand of knownBrands) {
    if (lower.includes(brand.toLowerCase())) return brand;
  }
  return null;
}

// Best-effort — "when possible," per the product requirement. Skips the
// first word (frequently the brand) to reduce false positives, and rejects
// tokens that are really just a unit-of-measure ("18V", "3.5mm").
function extractModel(title: string): string | null {
  const words = title.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length; i++) {
    const word = words[i].replace(/[.,;:()]+$/, "");
    if (UNIT_LIKE_RE.test(word)) continue;
    if (MODEL_TOKEN_RE.test(word)) return word;
  }
  return null;
}

function extractCategory(title: string, collections: Collection[]): string | null {
  const lower = title.toLowerCase();
  for (const col of collections) {
    for (const tag of col.tags) {
      if (lower.includes(tag.toLowerCase())) return tag;
    }
  }
  return null;
}

function slugToTitle(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\.\w+$/, "") // strip a trailing file extension if present
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractName(raw: string, url: string | null): string {
  const trimmed = raw.trim();
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  if (lines.length > 1) return lines[0];

  // Single line: if it's *only* a URL, derive a name from the last path segment.
  if (url && trimmed === url) {
    const segments = url.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const derived = slugToTitle(last);
    return derived || "Untitled purchase";
  }

  return trimmed || "Untitled purchase";
}

function extractCollectionId(raw: string, brand: string | null, collections: Collection[]): string | null {
  const lower = raw.toLowerCase();
  if (brand) {
    const byBrand = collections.find((c) => c.name.toLowerCase().includes(brand.toLowerCase()));
    if (byBrand) return byBrand.id;
  }
  for (const col of collections) {
    if (col.tags.some((tag) => lower.includes(tag.toLowerCase()))) return col.id;
  }
  return null;
}

function extractProject(raw: string, items: InventoryItem[]): string | null {
  const lower = raw.toLowerCase();
  const knownProjects = new Set(
    items.map((i) => i.project).filter((p): p is string => !!p && p.trim().length > 0),
  );
  for (const project of knownProjects) {
    if (lower.includes(project.toLowerCase())) return project;
  }
  return null;
}

export interface ParseContext {
  items: InventoryItem[];
  collections: Collection[];
}

function blockText(block: LineBlock): string {
  return [block.titleLine, ...block.contextLines.map((c: ClassifiedLine) => c.raw)].join("\n");
}

function extractFieldsFromBlock(block: LineBlock, adapter: CaptureSourceAdapter, context: ParseContext): ExtractedFields {
  const text = blockText(block);

  // Prefer values the adapter already classified structurally (a line that
  // was *only* a price/qty) over the tolerant whole-text regex fallback —
  // the classified value is the more precise signal when it exists.
  const classifiedPrice = block.contextLines.find((c) => c.kind === "price");
  const classifiedQty = block.contextLines.find((c) => c.kind === "qty");
  const { price: regexPrice, currency } = extractPrice(text);

  const url = extractUrl(text);
  const brand = extractBrand(block.titleLine, context.items);
  const vendor = block.vendorHint ?? adapter.defaultVendor ?? extractVendor(text);

  return {
    name: extractName(block.titleLine, url) || block.titleLine.trim() || "Untitled purchase",
    quantity: classifiedQty?.value ?? extractQuantity(text),
    brand,
    vendor: vendor ?? null,
    price: classifiedPrice?.value ?? regexPrice,
    currency,
    purchaseDate: extractPurchaseDate(text),
    productUrl: url,
    collectionId: extractCollectionId(text, brand, context.collections),
    project: extractProject(text, context.items),
    model: extractModel(block.titleLine),
    category: extractCategory(block.titleLine, context.collections),
  };
}

/**
 * The full pipeline, source-agnostic: pick the best-matching adapter, let it
 * split the raw text into per-product blocks, and extract inventory fields
 * from each. Always returns at least one result for non-empty input — if an
 * adapter somehow returns zero blocks, the generic single-block fallback
 * guarantees capture is never blocked.
 */
export function parseCaptureText(raw: string, context: ParseContext): ExtractedFields[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];

  const adapter = detectAdapter(trimmed);
  let blocks = adapter.detectBlocks(trimmed);
  if (blocks.length === 0) blocks = genericAdapter.detectBlocks(trimmed);
  if (blocks.length > MAX_PRODUCTS_PER_CAPTURE) blocks = blocks.slice(0, MAX_PRODUCTS_PER_CAPTURE);

  return blocks.map((block) => extractFieldsFromBlock(block, adapter, context));
}

/** Single-item convenience wrapper — takes the first detected product. */
export function parsePurchaseText(raw: string, context: ParseContext): ExtractedFields {
  const [first] = parseCaptureText(raw, context);
  if (first) return first;
  return {
    name: (raw ?? "").trim() || "Untitled purchase",
    quantity: 1,
    brand: null, vendor: null, price: null, currency: null,
    purchaseDate: null, productUrl: null, collectionId: null, project: null,
    model: null, category: null,
  };
}

// ── Experimental: AI-first extraction, parser as silent fallback ─────────────
// This is the ONE thing that changed with the AI proof-of-concept — the
// per-block regex extraction above is completely untouched, and still runs
// verbatim whenever the AI path doesn't. See docs on /api/extract and
// src/lib/aiExtractor.ts for the rest of the pipeline.
//
// Deliberately narrow: the AI's job is only the hard part — reading messy,
// varied-format text and naming what's actually a product. collectionId and
// project matching stay fully deterministic either way, because they depend
// on *this user's* private, ever-changing data (their own collections, their
// own existing items) that has no business being re-derived by a model on
// every capture when a local match already does it for free.

// The model sometimes emits the literal string "null" (or "undefined") for a
// nullable field instead of a real JSON null — valid per the response schema
// (which allows ["string", "null"]) but not a value any caller wants. Left
// uncaught, "null" as a string flows straight into a Postgres DATE column
// (suggested_purchase_date) and fails the insert outright; for the other
// nullable text fields it just displays the literal word "null" in the UI.
function nullableAiString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^(null|undefined)$/i.test(trimmed) ? null : trimmed;
}

function aiProductToExtractedFields(raw: RawAiProduct, context: ParseContext): ExtractedFields {
  const name = raw.name?.trim() || "Untitled purchase";
  const brand = nullableAiString(raw.brand);
  return {
    name,
    quantity: Number.isFinite(raw.quantity) && raw.quantity > 0 ? Math.floor(raw.quantity) : 1,
    brand,
    vendor: nullableAiString(raw.vendor),
    price: typeof raw.price === "number" && Number.isFinite(raw.price) ? raw.price : null,
    currency: nullableAiString(raw.currency),
    purchaseDate: nullableAiString(raw.purchaseDate),
    productUrl: nullableAiString(raw.productUrl),
    collectionId: extractCollectionId(`${name} ${brand ?? ""}`, brand, context.collections),
    project: extractProject(name, context.items),
    model: nullableAiString(raw.model),
    category: nullableAiString(raw.category),
  };
}

/**
 * The experimental entry point: try OpenAI structured extraction first: on
 * ANY failure — network error, timeout, schema mismatch, OpenAI error, or a
 * genuine zero-products result — silently fall back to the deterministic
 * parser above. Callers never need to know which path ran; both return the
 * exact same ExtractedFields[] shape.
 */
export async function extractInventoryDrafts(raw: string, context: ParseContext): Promise<ExtractedFields[]> {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];

  const aiResult = await extractWithAI({ text: trimmed });

  if (aiResult.ok) {
    console.info(
      `[ELK Capture] extraction engine: AI (${aiResult.products.length} product${aiResult.products.length === 1 ? "" : "s"})`,
    );
    return aiResult.products.map((p) => aiProductToExtractedFields(p, context));
  }

  console.info(`[ELK Capture] extraction engine: parser (AI unavailable — ${aiResult.reason})`);
  return parseCaptureText(trimmed, context);
}

/**
 * Photo capture — AI only. There is no deterministic fallback for an image
 * (the parser reads text, not pixels), so a failure here is a real failure,
 * not a silent handoff. Returns [] on any failure; the caller (CapturePage)
 * is responsible for surfacing that as "couldn't read that photo" rather
 * than treating it like the text path's always-succeeds contract.
 */
export async function extractInventoryDraftsFromImage(
  imageBase64: string,
  imageMediaType: string,
  context: ParseContext,
): Promise<ExtractedFields[]> {
  if (!imageBase64) return [];

  const aiResult = await extractWithAI({ imageBase64, imageMediaType });

  if (aiResult.ok) {
    console.info(
      `[ELK Capture] extraction engine: AI, photo (${aiResult.products.length} product${aiResult.products.length === 1 ? "" : "s"})`,
    );
    return aiResult.products.map((p) => aiProductToExtractedFields(p, context));
  }

  // No deterministic fallback for a photo — this is a real failure, not a
  // silent handoff. Log everything we have (the AI's reason, its raw response
  // body if any, and what we sent it) so a bad extraction is debuggable from
  // the browser console instead of just showing the user a generic message.
  console.error("[ELK Capture] AI photo extraction failed", {
    reason: aiResult.reason,
    detail: aiResult.detail,
    imageMediaType,
    imageBase64Chars: imageBase64.length,
  });
  return [];
}
