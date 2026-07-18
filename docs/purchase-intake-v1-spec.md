# Purchase Intake V1 — Product & Engineering Spec

**Status:** Proposed — ready for implementation
**Last updated:** 2026-07-15
**Scope:** One focused engineering session
**Depends on:** `concepts/purchase-intake.md` (vision), `architecture/information-architecture-v2.md` §10 (Purchase Model sketch)
**Extends:** Existing Bulk Photo Import pipeline (`ImportBatch` / `ImportDraftItem`) — this document defines a parallel, text-based intake path. It does not modify that pipeline.

---

## Mission

Let the user capture a newly purchased item in under 30 seconds by pasting raw text — an Amazon title, an order summary, a product URL, or a plain note — then review and approve a structured draft into Inventory.

**Core principle: Capture first. Organize later. Enrich automatically where possible, never at the cost of blocking capture.**

---

## 1. Why This Mirrors the Existing Bulk Photo Import Pattern

The codebase already has one working end-to-end draft pipeline: `BulkImportPage.tsx` → `activeAnalyzer.analyzeInventoryPhotos()` → `ImportReviewQueue.tsx` → approve/reject → `InventoryItem`. That pattern already proves the exact shape this feature needs: **capture → suggest → human review → approve**, with nothing touching real inventory until a human confirms it.

Purchase Intake V1 reuses that shape with two substitutions:

| | Bulk Photo Import (existing) | Purchase Intake V1 (this spec) |
|---|---|---|
| Input | Photos | Pasted text |
| Suggestion engine | `mockInventoryPhotoAnalyzer` (random catalog picker) | Deterministic local parser (regex/heuristics — no AI, no network call) |
| Draft entity | `ImportDraftItem` (batch-scoped) | `PurchaseDraft` (standalone, one per paste) |
| Persistence | `localStorage` only | Supabase table (see §5) — durable, shared, survives device changes |
| Review UI | `ImportReviewQueue.tsx` | New: `PurchaseDraftReviewQueue.tsx` (same visual language, different fields) |

This is a deliberate architectural choice, not an accident: the prior codebase audit flagged that `ImportBatch`/`ImportDraftItem` living only in `localStorage` (while `InventoryItem` lives in Supabase) is a source of silent cross-device divergence. Purchase Intake V1 does not repeat that mistake — drafts are durable and shared from day one, because provenance (requirement 6) only means something if the draft survives.

---

## 2. Exact User Journey

**Step 1 — Entry point.**
Add "Quick Capture" as a third option in the existing header split-button menu (`App.tsx`'s `showAddMenu` dropdown, alongside "Add Single Item" and "Bulk Photo Import"). Icon: 📋 or ⚡. This requires no new nav tab — it's an action, not a page you browse to.

**Step 2 — Paste.**
User lands on `QuickCapturePage`. One large `<textarea>`, autofocused, placeholder text showing example formats ("Paste an Amazon title, order summary, a product URL, or just a note…"). No other required fields visible. A single **Capture** button, enabled the instant the textarea is non-empty.

**Step 3 — Immediate draft creation.**
On Capture click:
1. Client runs the deterministic parser (§7) synchronously over the raw text (no network round-trip needed for parsing — it's pure string logic).
2. Client runs duplicate detection (§8) against the already-loaded in-memory `items` array.
3. A `PurchaseDraft` row is written to Supabase (`status: "pending"`) containing the raw text plus every extracted/suggested field.
4. User is taken straight to that draft's review card. Total elapsed time from paste to draft-created: under 2 seconds, no spinner needed for extraction (it's synchronous and cheap).

**Step 4 — Review.**
The review card (§6) shows the extracted fields pre-filled into editable inputs, a collapsed "Raw text" expander, and a duplicate-match banner if any were found. Four actions are always visible: **Approve · Edit · Save for Later · Reject**.

**Step 5a — Approve (fast path).**
If the pre-filled fields look right, one click approves as-is. This creates (or, if merging into a duplicate, updates) an `InventoryItem` with `lifecycleState: "ordered"` by default, sets `sourceDraftId` for provenance, and marks the draft `status: "approved"` with `resolvedItemId` set. Total time from paste to approved item: the 30-second target.

**Step 5b — Edit.**
Same card expands into an inline editable form (same field set, same component reused for the edit state — no navigation). Save writes the edits back to the draft row (still `status: "pending"`) and/or approves directly, matching the existing `DraftCard`/`DraftEditor` pattern in `ImportReviewQueue.tsx`.

**Step 5c — Save for Later.**
Sets `status: "saved-for-later"`. The draft persists, visible from a "Drafts" entry point (mirrors the existing "Review Queue" pending-count pattern already in the header Add menu). Nothing is created in Inventory. This exists for the case where the user captured something mid-errand and doesn't have zone/collection context yet.

**Step 5d — Reject.**
Sets `status: "rejected"`. Nothing created. Draft remains in the table (not deleted) as a low-cost audit trail — this is intentionally cheap to build (no destructive delete path required for v1) and mirrors how rejected `ImportDraftItem`s already behave (kept, not deleted, in the existing pipeline).

**Step 6 — Return to work.**
After Approve or Reject, the user is dropped back at the entry surface (Dashboard or wherever they triggered capture from) — not forced into a multi-step wizard. If more drafts are pending (from a batch of pastes or earlier "Save for Later" items), a lightweight "N drafts pending" affordance is visible, echoing the existing header pattern.

---

## 3. Acceptance Criteria

1. Pasting any non-empty text and clicking Capture always creates a `PurchaseDraft` row — no combination of input causes an error state that blocks draft creation. (Requirement 2.)
2. A `PurchaseDraft` can exist with every extracted field null/blank except `rawText`. The system never requires structured input to create a draft. (Requirement 2, 3.)
3. No `InventoryItem` is ever created without an explicit Approve action on a draft. (Requirement 3.)
4. The extraction step runs entirely client-side, synchronously, with no network call and no external AI API. (Requirement 7.)
5. The review screen renders in a single scroll-free card at typical viewport height for one draft at a time; batch/list view is a simple stacked list of the same card component when multiple drafts are pending. (Requirement 5.)
6. All four actions (Approve, Edit, Save for Later, Reject) are reachable from the review card without navigating away. (Requirement 5.)
7. An approved `InventoryItem` has a non-null `sourceDraftId` pointing at the originating `PurchaseDraft.id`. (Requirement 6.)
8. If Approve is chosen while a duplicate was flagged, the user is shown the duplicate(s) and must explicitly choose "merge into existing" or "create as new" — approval never silently merges or silently duplicates. (Requirement 4, 8/duplicate rules §8.)
9. Time-to-first-draft (paste → draft created, ignoring human review time) is dominated by the Supabase insert round-trip only — no artificial delay, no synchronous blocking parse of more than a few milliseconds for realistic input lengths (<5,000 characters).
10. None of the excluded mechanisms (OCR, Amazon account integration, web scraping, barcode scanning, voice transcription, photo recognition) appear anywhere in the implementation. (Requirement 8.)

---

## 4. Edge Cases

| Case | Behavior |
|---|---|
| Empty paste / whitespace-only | Capture button stays disabled. No draft created. |
| Extremely long paste (full order confirmation email, several KB) | Still creates a draft. Parser runs against the full text but only needs the first ~2,000 characters for pattern matching (see §7); raw text is stored in full regardless, capped at a generous limit (e.g. 20,000 chars) purely to protect the DB column, not to block capture. |
| Paste containing only a URL | `productUrl` extracted, `name` falls back to the URL's last path segment (deslugified) or the raw text itself if no better name signal exists — never left null on approval (see §7.1). |
| Paste with zero recognizable structure ("need more zip ties") | Every structured field stays null; `name` defaults to the raw text (or first line, if multi-line) verbatim. This is a fully valid, expected outcome, not a failure state. |
| Multiple distinct products pasted in one blob (e.g. a full multi-item order summary) | **V1 does not auto-split.** One paste = one draft = one suggested item. The user can paste again per item, or approve the one item and manually add the rest via the existing "Add Single Item" form. Auto-splitting is an explicit non-goal (§11) — attempting it deterministically without AI is unreliable and out of scope for one session. |
| Same text pasted twice | Two independent drafts are created. Duplicate detection (§8) runs against *inventory items*, not against other pending drafts, so this is not flagged automatically in v1 — acceptable, since Save-for-Later/Reject make cleanup a two-click action. |
| Extraction misfires (e.g. a phone number matches the price regex, an order number matches a quantity pattern) | These are *suggestions* pre-filled into editable inputs, never committed silently. The user corrects or ignores them during review. No validation blocks approval based on implausible-but-syntactically-valid extracted values. |
| Approve clicked twice quickly (double-submit) | The approve handler must be idempotent per draft: once a draft's `status` is `"approved"`, a second Approve click on a stale render is a no-op guarded by checking current `status` before writing (see §9). |
| Network/Supabase failure during Approve | Follows the existing codebase convention (`db.ts` today does fire-and-forget with `console.error` on failure and optimistic local state). For Purchase Intake, Approve should NOT be purely optimistic the way item edits are today — because a failed insert with a "success" UI would break the provenance guarantee. Approve must await the Supabase write and show an inline error + retry affordance on failure, rather than assuming success. This is one deliberate deviation from the existing `db.ts` fire-and-forget pattern, scoped narrowly to this one write. |
| User is offline | Capture (the draft insert) requires network in v1 — no offline queue. If the insert fails, the raw text the user just typed must not be lost: keep it in the textarea/component state until a successful save, don't clear on failed submit. |
| Pasted text contains HTML/script-like content (copied from a web page with formatting) | Always rendered as plain text (`textContent`, never `dangerouslySetInnerHTML`) everywhere the raw text or any extracted string is displayed. No execution risk. |
| Draft approved, then later the same purchase's item is edited or deleted normally through the existing Inventory UI | `sourceDraftId` is a soft reference only (`ON DELETE SET NULL`, see §5) — deleting the item does not delete the draft, and the draft's `resolvedItemId` is simply left pointing at a since-deleted id. This is acceptable for v1; provenance is a historical record, not a live sync constraint. |

---

## 5. Proposed Data Model

### 5.1 New table: `purchase_drafts`

```sql
CREATE TABLE IF NOT EXISTS public.purchase_drafts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source
  raw_text          TEXT NOT NULL,

  -- Extracted / suggested fields (all nullable — extraction never blocks capture)
  suggested_name        TEXT,
  suggested_quantity    INTEGER,
  suggested_brand       TEXT,
  suggested_vendor      TEXT,
  suggested_price       NUMERIC(10,2),
  suggested_currency    TEXT DEFAULT 'USD',
  suggested_purchase_date DATE,
  product_url           TEXT,
  suggested_collection_id TEXT,     -- matches Collection.id, no hard FK (mirrors existing collectionId convention on inventory_items)
  suggested_project      TEXT,

  -- Review state
  status            TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'saved-for-later' | 'rejected'
  resolved_item_id  TEXT REFERENCES public.inventory_items(id) ON DELETE SET NULL,

  -- Audit
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.purchase_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view drafts"
  ON public.purchase_drafts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert drafts"
  ON public.purchase_drafts FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update drafts"
  ON public.purchase_drafts FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete drafts"
  ON public.purchase_drafts FOR DELETE TO authenticated USING (true);
```

This mirrors `inventory_items`'s existing RLS shape exactly (shared inventory, any authenticated user can CRUD any row) — no new permission model introduced.

**Deliberately not stored:** duplicate-match results. Per the existing architecture's own precedent (`CollectionGoal` readiness in `information-architecture-v2.md` §9 is "a pure function... no stored state needed"), duplicate matches are *computed live* against the current `items` array every time a draft is rendered for review, not persisted. This avoids stale duplicate flags if inventory changes between draft creation and review.

### 5.2 `InventoryItem` — one new optional field

```ts
// src/types/inventory.ts — InventoryItem interface addition
sourceDraftId?: string;   // provenance — id of the PurchaseDraft this item was approved from
```

Corresponding Supabase column:

```sql
ALTER TABLE public.inventory_items
  ADD COLUMN source_draft_id UUID REFERENCES public.purchase_drafts(id) ON DELETE SET NULL;
```

**Everything else purchase-specific (price, vendor, purchase date, product URL) is stored in the existing `attributes` JSONB bag on `InventoryItem`**, not as new top-level columns — consistent with how food/fitness/preserving domains already extend the schema today (`attributes.estimatedTotalCalories`, `attributes.weightLbs`, etc.). On approval, the draft's suggested fields are copied into `attributes.purchasePrice`, `attributes.purchaseVendor`, `attributes.purchaseDate`, `attributes.productUrl`. This keeps the `inventory_items` migration to a single new column.

### 5.3 New TypeScript types (`src/types/purchase.ts`)

```ts
export type PurchaseDraftStatus = "pending" | "approved" | "saved-for-later" | "rejected";

export interface PurchaseDraft {
  id: string;
  rawText: string;

  suggestedName: string | null;
  suggestedQuantity: number | null;
  suggestedBrand: string | null;
  suggestedVendor: string | null;
  suggestedPrice: number | null;
  suggestedCurrency: string | null;
  suggestedPurchaseDate: string | null;   // ISO date
  productUrl: string | null;
  suggestedCollectionId: string | null;
  suggestedProject: string | null;

  status: PurchaseDraftStatus;
  resolvedItemId: string | null;

  createdAt: string;
  updatedAt: string;
}
```

---

## 6. Component / Page Plan

New files, all following the existing codebase's inline-style + `C` color-token convention (`src/styles.ts`) — no new UI library introduced.

| File | Purpose | Closest existing reference |
|---|---|---|
| `src/lib/purchaseParser.ts` | Pure function: `parsePurchaseText(raw: string): ExtractedFields`. No React, no Supabase — fully unit-testable in isolation. | New — no direct analog, but same "pure function, no side effects" spirit as `computeReadiness` described in IA v2 §9. |
| `src/lib/duplicateDetector.ts` | Pure function: `findPossibleDuplicates(extracted: ExtractedFields, items: InventoryItem[]): DuplicateMatch[]`. | `matchesItem()` in `Dashboard.tsx` (existing substring-match helper) — reused/extended, not duplicated. |
| `src/lib/purchaseDrafts.ts` | Supabase CRUD: `fetchDrafts()`, `createDraft()`, `updateDraft()`, `approveDraft()`, `rejectDraft()`, `saveDraftForLater()`. Same camelCase↔snake_case mapping pattern as `src/lib/db.ts`. | `src/lib/db.ts` (structural twin, new file to keep concerns separated) |
| `src/components/QuickCapturePage.tsx` | The paste screen (Step 2). | `BulkImportPage.tsx` (drop-zone → analyze → hand off to review, same shape with paste instead of files) |
| `src/components/PurchaseDraftReviewQueue.tsx` | The review card(s) (Step 4–5). Renders one `PurchaseDraftCard` per pending/saved draft. | `ImportReviewQueue.tsx` / `DraftCard` / `DraftEditor` (near-identical visual and interaction pattern, different field set) |

**`App.tsx` changes required** (documented here for planning; not implemented under this task's constraints):
- New `View` union member: `"quick-capture"` and `"purchase-drafts"`.
- New menu item in the existing `showAddMenu` dropdown: "⚡ Quick Capture."
- New pending-count affordance next to "Review Queue," sourced from `purchase_drafts` where `status IN ('pending','saved-for-later')`.
- `items` state (already loaded) is passed into `PurchaseDraftReviewQueue` for duplicate detection — no new data fetch needed there.

No changes to `BulkImportPage.tsx`, `ImportReviewQueue.tsx`, `ImportBatch`, or `ImportDraftItem` — the two pipelines run side by side, sharing only visual language, not code paths. Consolidating them is explicitly out of scope (§11).

---

## 7. Extraction Rules (Deterministic, Local, No AI)

`parsePurchaseText(raw: string): ExtractedFields` runs a fixed sequence of independent regex/heuristic passes over the raw text. Every pass is optional and failure-tolerant — a miss on one field never affects another.

1. **Product URL** — first match of `/https?:\/\/\S+/`. If found, strip tracking query params (everything after `?`) for the stored `productUrl` but keep the full original in `rawText` regardless.
2. **Price** — first match of `/[$€£]\s?\d+(?:,\d{3})*(?:\.\d{2})?/` or `/\d+(?:\.\d{2})?\s?(?:USD|CAD|EUR|GBP)/i`. Captures the numeric value and a currency guess from the symbol/code.
3. **Quantity** — patterns in priority order: `/\bqty[:\s]*(\d+)\b/i`, `/\bx\s?(\d+)\b/i`, `/pack of (\d+)/i`, `/\((\d+)\s*(?:pack|pcs|count)\)/i`. Defaults to `1` if nothing matches (never null — quantity always has a sane default, matching `InventoryForm`'s existing `Math.max(1, ...)` convention).
4. **Purchase date** — patterns for common date formats (`MM/DD/YYYY`, `Month D, YYYY`, ISO `YYYY-MM-DD`). If none found, leave null — the review UI defaults the date picker to *today* visually, without writing a fabricated value into the draft itself.
5. **Vendor** — case-insensitive match against a small static known-vendor list (`Amazon`, `Home Depot`, `Lowe's`, `McMaster-Carr`, `Canadian Tire`, `Princess Auto`, etc. — extendable array, not a service call) anywhere in the text.
6. **Brand** — case-insensitive match against the *distinct set of `brand` values already present in current inventory* (e.g. `"Ryobi"`), computed at call time from the `items` array passed in — this means brand suggestions get better automatically as real data accumulates, with zero maintenance. Falls back to null if no existing brand appears in the text.
7. **Name** — the hardest field, resolved by priority:
   a. If the text is a single line and not just a URL, use it verbatim (trimmed).
   b. If multi-line, use the first non-empty line.
   c. If the only content is a URL, use the URL's last path segment with hyphens/underscores replaced by spaces and title-cased.
   d. Name is **never left null** — this is the one field the parser guarantees a value for, because `InventoryItem.name` is a required field at approval time (see §9), and the user must always have *something* pre-filled to edit rather than an empty required field blocking Approve.
8. **Collection suggestion** — match extracted `brand` or any known collection `tags` (from `COLLECTIONS` data, e.g. `ryobi-tools` has tags `["power","woodworking","mechanic"]`) against words present in the raw text. First match wins; null if none.
9. **Project suggestion** — case-insensitive substring match of raw text against the *distinct set of `project` values already used in current inventory* (e.g. `"ELK Garden"`, `"ELK Wrench"`, `"Small Engine Learning"`), same self-improving-from-real-data approach as brand.

**Explicitly not attempted in v1:** splitting multi-item text into multiple drafts, inferring `itemClass`/`domain`/`zone` (left for the human at review — these are exactly the fields the review form already has good pickers for, and guessing them wrong is worse than leaving them blank), any ML/NLP library dependency.

---

## 8. Duplicate Detection Rules

Runs client-side, at review-render time, against the currently-loaded `items` array. Deterministic, no AI.

**Algorithm:**
1. Normalize both the extracted `suggestedName` and each candidate `item.name`: lowercase, strip punctuation, collapse whitespace.
2. Tokenize into words; compute a Jaccard-style overlap score: `|intersection| / |union|` of the token sets.
3. Boost the score by +0.2 (capped at 1.0) if `suggestedBrand` matches `item.brand` (case-insensitive exact match).
4. A candidate is a **possible duplicate** if the boosted score is `>= 0.5`.
5. Return up to the top 3 matches, sorted descending by score, each annotated with the item's current `lifecycleState` and `currentZone` (so the reviewer immediately sees "you already have this, it's in the Mechanic Bay, available").

**Review UI behavior when duplicates exist:**
- A banner above the extracted fields: *"Possibly already own this →"* listing the match(es) with their zone/state.
- Two extra buttons appear alongside the normal four actions when a duplicate is selected: **"This is the same item — update quantity"** (merges: increments the existing item's `quantity` by the draft's `suggestedQuantity`, sets `sourceDraftId` on the existing item if not already set, marks the draft `approved` with `resolvedItemId` = the existing item's id, *no new `InventoryItem` row created*) and **"Different item — create new"** (proceeds exactly like the no-duplicate Approve path).
- If no duplicate is selected/confirmed, Approve still works normally — the banner is informational, never a blocker (matches requirement 2's spirit: nothing about extraction or matching should ever prevent capture or approval).

---

## 9. API / DB-Function Plan

There is no custom backend in this codebase (per the existing architecture — Supabase is called directly from the browser). "API" here means the client-side function surface in `src/lib/purchaseDrafts.ts`, mirroring `src/lib/db.ts`'s existing shape:

```ts
// src/lib/purchaseDrafts.ts

export async function createDraft(rawText: string, extracted: ExtractedFields): Promise<PurchaseDraft>
// INSERT into purchase_drafts, status: 'pending'. Awaited (not fire-and-forget) —
// the UI needs the real row id before navigating to the review card.

export async function fetchPendingDrafts(): Promise<PurchaseDraft[]>
// SELECT * WHERE status IN ('pending', 'saved-for-later') ORDER BY created_at DESC

export async function updateDraft(id: string, patch: Partial<PurchaseDraft>): Promise<void>
// UPDATE ... used by the Edit/Save flow. Fire-and-forget is acceptable here
// (matches existing db.ts convention) since it's non-destructive.

export async function approveDraft(
  draft: PurchaseDraft,
  action: { kind: "new" } | { kind: "merge"; existingItemId: string }
): Promise<InventoryItem>
// Awaited, not fire-and-forget (see Edge Cases §4 — approval must not be
// silently-optimistic given the provenance guarantee). Internally:
//   - "new": builds an InventoryItem from the draft's suggested fields
//     (lifecycleState: "ordered", currentZone/recommendedZone: "unknown"
//     unless the user picked one during Edit, sourceDraftId: draft.id),
//     calls db.createItem(), then UPDATEs the draft to
//     { status: 'approved', resolvedItemId: newItem.id }.
//   - "merge": calls db.updateItem() on the existing item (bumping quantity,
//     setting sourceDraftId if unset), then UPDATEs the draft the same way,
//     pointing resolvedItemId at the existing item's id.
//   - Both paths check draft.status === 'pending' | 'saved-for-later' before
//     writing, to make double-submit a no-op (Acceptance Criterion 9 in §3
//     / Edge Cases §4).

export async function rejectDraft(id: string): Promise<void>
// UPDATE status = 'rejected'. Row is kept, not deleted.

export async function saveDraftForLater(id: string): Promise<void>
// UPDATE status = 'saved-for-later'.
```

No new Supabase Edge Functions, no server-side code, no new REST endpoints beyond what PostgREST already auto-generates for the new table — consistent with "initial extraction may be deterministic and local" and the project's existing no-backend architecture.

---

## 10. Implementation Sequence (One Session)

Ordered so each step is independently verifiable before moving to the next:

1. **Supabase migration** — create `purchase_drafts` table + RLS policies (§5.1), add `source_draft_id` column to `inventory_items` (§5.2). Verify via Supabase SQL editor that both exist and RLS behaves (anon blocked, authenticated allowed) — same manual check pattern already used for `inventory_items`.
2. **Types** — `src/types/purchase.ts` (§5.3), plus the one-line `InventoryItem.sourceDraftId?` addition.
3. **Parser** — `src/lib/purchaseParser.ts`, written and manually verified against a handful of real pasted examples (an Amazon title, a URL-only paste, a plain note, an order-summary block) before touching any UI. This is the highest-risk, most standalone piece — get it right in isolation first.
4. **Duplicate detector** — `src/lib/duplicateDetector.ts`, verified against the existing 95-item seed data with a few deliberately-similar test strings.
5. **DB access layer** — `src/lib/purchaseDrafts.ts` (§9), verified with a manual create → fetch → approve round-trip against the real Supabase project.
6. **`QuickCapturePage.tsx`** — paste UI wired to steps 3–5.
7. **`PurchaseDraftReviewQueue.tsx`** — review card(s), all four actions wired.
8. **`App.tsx` wiring** — new view states, Add-menu entry, pending-count affordance (per §6's documented-but-not-implemented change list).
9. **Manual end-to-end pass** — full journey (§2) run start to finish with at least 3 different input styles, plus the double-submit and duplicate-merge edge cases from §4/§8.

---

## 11. Explicit Non-Goals

Excluded by requirement, restated for clarity plus a few this spec adds:

- **OCR** — no image or scanned-text input.
- **Amazon account integration** — no order-history API, no login-to-Amazon flow.
- **Web scraping** — pasted URLs are stored as-is; the app never fetches them server-side to enrich data.
- **Barcode scanning** — no camera/scanner input path.
- **Voice transcription** — text only.
- **Photo recognition** — no connection to the existing (mock) Bulk Photo Import analyzer; the two pipelines remain separate.
- **Multi-item auto-splitting from one paste** — one paste produces one draft in v1 (see Edge Cases §4).
- **External AI / LLM calls** — extraction and duplicate detection are 100% local and deterministic.
- **Merging or consolidating with the existing `ImportBatch`/`ImportDraftItem` pipeline** — that stays untouched; this is a second, parallel intake path, not a replacement.
- **Offline queueing** — capture requires a live connection to Supabase in v1.
- **Learning/classification from user behavior** (the "system learns which purchases to ignore" idea from `concepts/purchase-intake.md`) — out of scope; every paste creates a draft, no auto-dismissal logic.
- **Email/receipt-forwarding intake** — paste only, no inbound email address.

---

## 12. Testing Checklist

The codebase currently has no automated test runner. Given the one-session scope, this spec recommends **manual verification** as the primary gate, with the two pure functions (`purchaseParser.ts`, `duplicateDetector.ts`) being the only pieces worth a lightweight smoke script (they're pure, cheap to test, and the riskiest logic in the feature) — this doesn't require introducing a new test framework; a throwaway `tsx scripts/smokeTestParser.ts` run manually is sufficient for v1, consistent with how this repo already runs one-off scripts.

**Parser smoke tests** (sample inputs → expected extracted fields):
- [ ] Plain Amazon-style title with brand: `"Ryobi 18V ONE+ Cordless Hand Vacuum"` → brand `Ryobi`, name preserved
- [ ] Title with price and quantity: `"NOCO GB40 Jump Starter - Qty: 2 - $89.99"` → price `89.99`, quantity `2`
- [ ] URL only: `"https://www.amazon.com/dp/B08XYZ123-torque-wrench"` → productUrl set, name derived from slug
- [ ] Plain note, no structure: `"need more zip ties for the garden wiring"` → name = raw text, all else null except quantity defaulting to 1
- [ ] Multi-line order block (title line + price line + date line) → each field pulled from its respective line
- [ ] Empty/whitespace-only input → parser returns all-null gracefully (never throws)

**Duplicate detector smoke tests:**
- [ ] Exact name match against existing seed item (`"Ryobi Drill/Driver"`) → flagged, score high
- [ ] Same brand, different tool (`"Ryobi Angle Grinder"` text vs. existing `"Ryobi Table Saw"`) → not flagged (token overlap too low even with brand boost)
- [ ] Near-identical name with minor wording difference (`"Ryobi 18V Cordless Drill"` vs. seed `"Ryobi Drill/Driver"`) → flagged
- [ ] No match in inventory → empty result, no false positive

**End-to-end manual pass:**
- [ ] Paste → draft created → visible in review queue within the same interaction (no page reload)
- [ ] Approve (no duplicate) creates a real `InventoryItem` with `lifecycleState: "ordered"` and correct `sourceDraftId`, visible immediately in the main Inventory view
- [ ] Approve with duplicate → "update quantity" path increments the existing item, creates no new row, draft resolves to the existing item's id
- [ ] Edit → change a field → Approve → resulting item reflects the edit, not the original suggestion
- [ ] Save for Later → draft persists, reappears in the pending-drafts entry point on next app load (proves Supabase persistence, not localStorage)
- [ ] Reject → draft status updates, no item created, draft still queryable (not deleted)
- [ ] Double-click Approve rapidly → only one `InventoryItem` created (idempotency check)
- [ ] Simulate a failed Supabase write during Approve (e.g. temporarily revoke network) → user sees an inline error, raw input/edits are not lost, no false-success state
- [ ] RLS check: an unauthenticated `curl` against `purchase_drafts` (anon key, no session) returns an empty result, matching the existing `inventory_items` RLS behavior

---

## Summary

Purchase Intake V1 is a second, parallel draft-review pipeline that deliberately reuses the interaction pattern already proven by Bulk Photo Import, swaps a mock AI for a small deterministic parser, and — unlike the existing import pipeline — stores drafts durably in Supabase from day one so the provenance link required by requirement 6 actually means something. It touches exactly one existing table (`inventory_items`, one new nullable column) and adds exactly one new table (`purchase_drafts`), five new client files, and one new Add-menu entry. Every extraction and matching decision is a *suggestion* the human confirms — nothing about this feature can create or alter real inventory without an explicit Approve.
