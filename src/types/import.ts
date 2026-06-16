// ── Import batch & draft item types ───────────────────────────────────────────
// These are completely separate from real InventoryItem records.
// Nothing becomes a real item until a user explicitly approves a draft.

export type ImportBatchStatus =
  | "drafting"           // photos uploaded, analysis not yet run
  | "ready-for-review"   // analysis complete, drafts awaiting user action
  | "completed";         // all drafts approved or rejected

export type ImportDraftStatus =
  | "pending"            // awaiting user decision
  | "approved"           // user approved → real item created
  | "rejected"           // user rejected → no item created
  | "needs-review";      // flagged for closer look (low confidence, etc.)

// ── Import batch ──────────────────────────────────────────────────────────────

export interface ImportBatch {
  id: string;
  createdAt: string;
  source: "bulk-photo";
  analyzerName: string;      // e.g. "Mock Analyzer (No AI)"
  isRealAI: boolean;
  status: ImportBatchStatus;
  photoCount: number;
  totalDrafts: number;
  approvedCount: number;
  rejectedCount: number;
}

// ── Import draft item ─────────────────────────────────────────────────────────

export interface ImportDraftItem {
  id: string;
  batchId: string;

  // Source reference
  sourcePhotoUrl: string;    // base64 data URL — persists across refresh
  sourcePhotoName: string;   // original filename

  // Suggested inventory fields (editable before approval)
  suggestedName: string;
  itemClass: string;         // maps to ItemClass
  domain?: string;           // maps to InventoryDomain
  zone: string;              // maps to ZoneId
  container: string | null;  // maps to containerId
  quantity: number;
  notes: string;

  // Analysis metadata
  confidence: number;        // 0–1 (mock: random, real: model confidence)
  status: ImportDraftStatus;
  createdAt: string;

  // Set on approval
  createdItemId?: string;
}
