// ── Normalization — step 1 of the capture pipeline ────────────────────────────
//
//   Raw Text → NORMALIZATION → Product Detection → Inventory Drafts
//
// Turns whatever was pasted into a clean array of non-empty lines, and
// classifies each line by shape (a line that is *only* a price, *only* a
// quantity, *only* a date, or plain text). This step knows nothing about
// Amazon, Home Depot, or any other source — every source adapter in
// captureAdapters.ts is built on top of this same shared normalization, so
// a future adapter never has to re-solve "is this line a price" from scratch.

export function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// Whole-line matches only — an embedded "$39.99" inside a longer descriptive
// line is deliberately NOT caught here. That's handled separately by the
// tolerant regex extractors in purchaseParser.ts, which scan a whole block's
// text rather than requiring a line to be *nothing but* a price.
const PRICE_LINE_RE = /^[$€£]\s?\d+(?:,\d{3})*(?:\.\d{2})?$|^\d+(?:\.\d{2})?\s?(?:USD|CAD|EUR|GBP)$/i;
const QTY_LINE_RE = /^(?:qty|quantity)[:\s]*(\d+)$/i;
const DATE_LINE_RE =
  /^(?:\d{1,2}\/\d{1,2}\/\d{2,4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})$/i;

export type LineKind = "price" | "date" | "qty" | "text";

export interface ClassifiedLine {
  raw: string;
  kind: LineKind;
  value?: number; // populated for price and qty
}

export function classifyLine(line: string): ClassifiedLine {
  if (PRICE_LINE_RE.test(line)) {
    const numeric = parseFloat(line.replace(/[^0-9.]/g, ""));
    return { raw: line, kind: "price", value: Number.isFinite(numeric) ? numeric : undefined };
  }
  const qtyMatch = line.match(QTY_LINE_RE);
  if (qtyMatch) return { raw: line, kind: "qty", value: parseInt(qtyMatch[1], 10) };
  if (DATE_LINE_RE.test(line)) return { raw: line, kind: "date" };
  return { raw: line, kind: "text" };
}

export function classifyLines(lines: string[]): ClassifiedLine[] {
  return lines.map(classifyLine);
}
