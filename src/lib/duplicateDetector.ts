// ── Duplicate detection for Purchase Intake ───────────────────────────────────
// Pure function, deterministic, no AI. Runs at review-render time against the
// currently-loaded items array — results are never persisted (matches the
// "computed, not stored" precedent already used for goal readiness in
// docs/architecture/information-architecture-v2.md §9).
// See docs/purchase-intake-v1-spec.md §8.

import type { InventoryItem } from "../types/inventory";
import type { DuplicateMatch, ExtractedFields } from "../types/purchase";

const DUPLICATE_THRESHOLD = 0.5;
const BRAND_MATCH_BOOST = 0.2;
const MAX_MATCHES = 3;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function findPossibleDuplicates(
  extracted: Pick<ExtractedFields, "name" | "brand">,
  items: InventoryItem[],
): DuplicateMatch[] {
  if (!extracted.name || !extracted.name.trim()) return [];

  const queryTokens = tokenize(extracted.name);
  const scored: DuplicateMatch[] = [];

  for (const item of items) {
    const itemTokens = tokenize(item.name);
    let score = jaccard(queryTokens, itemTokens);

    if (
      extracted.brand &&
      item.brand &&
      extracted.brand.toLowerCase() === item.brand.toLowerCase()
    ) {
      score = Math.min(1, score + BRAND_MATCH_BOOST);
    }

    if (score >= DUPLICATE_THRESHOLD) {
      scored.push({
        itemId: item.id,
        itemName: item.name,
        score,
        zone: item.currentZone,
        lifecycleState: item.lifecycleState,
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_MATCHES);
}
