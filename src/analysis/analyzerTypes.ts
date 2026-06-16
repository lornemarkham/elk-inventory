import type { ImportDraftItem } from "../types/import";

// Fields the analyzer returns per photo — id/batchId/status/createdAt added by the caller
export type DraftSuggestion = Omit<
  ImportDraftItem,
  "id" | "batchId" | "status" | "createdAt" | "createdItemId"
>;

// ── Provider interface ────────────────────────────────────────────────────────
// Swap implementations in src/analysis/index.ts to change providers.
// Mock → OpenAI → future providers (receipt scan, email import, etc.)

export interface InventoryPhotoAnalyzer {
  readonly name: string;
  readonly isReal: boolean;  // false = mock/test, true = real AI
  analyzeInventoryPhotos(files: File[]): Promise<DraftSuggestion[]>;
}
