// ── Purchase Intake V1 types ──────────────────────────────────────────────────
// See docs/purchase-intake-v1-spec.md for the full design.
//
// A PurchaseDraft is created from raw pasted text and never touches real
// inventory until a human explicitly approves it (see src/lib/purchaseDrafts.ts).

export type PurchaseDraftStatus = "pending" | "approved" | "saved-for-later" | "rejected";

export interface PurchaseDraft {
  id: string;
  rawText: string;

  // Extracted / suggested fields — all nullable. Extraction never blocks capture.
  suggestedName: string | null;
  suggestedQuantity: number | null;
  suggestedBrand: string | null;
  suggestedVendor: string | null;
  suggestedPrice: number | null;
  suggestedCurrency: string | null;
  suggestedPurchaseDate: string | null;   // ISO date (YYYY-MM-DD)
  productUrl: string | null;
  suggestedCollectionId: string | null;
  suggestedProject: string | null;
  suggestedModel: string | null;
  suggestedCategory: string | null;

  status: PurchaseDraftStatus;
  resolvedItemId: string | null;

  createdAt: string;
  updatedAt: string;
}

// Output of the deterministic parser — same field shape as the suggested-*
// fields on PurchaseDraft, without the id/status/timestamps wrapper.
export interface ExtractedFields {
  name: string;               // never null — parser always produces a fallback
  quantity: number;           // never null — defaults to 1
  brand: string | null;
  vendor: string | null;
  price: number | null;
  currency: string | null;
  purchaseDate: string | null;
  productUrl: string | null;
  collectionId: string | null;
  project: string | null;
  model: string | null;
  category: string | null;
}

export interface DuplicateMatch {
  itemId: string;
  itemName: string;
  score: number;              // 0–1
  zone: string;
  lifecycleState: string;
}
