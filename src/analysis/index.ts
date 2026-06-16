// ── Active analyzer selection ─────────────────────────────────────────────────
// To switch providers, change the import below and update `activeAnalyzer`.
//
// Current:  mockInventoryPhotoAnalyzer   (always-on, no API key required)
// TODO:     openAiInventoryPhotoAnalyzer  (create when adding real AI)
//           → implement InventoryPhotoAnalyzer from ./analyzerTypes
//           → read VITE_OPENAI_API_KEY from import.meta.env
//           → use GPT-4o Vision: pass images as base64 data URLs
//           → parse structured JSON response into DraftSuggestion[]
//
// Other planned providers:
//   - receiptPhotoAnalyzer   (receipt/label OCR for food items)
//   - emailImportAnalyzer    (parse forwarded purchase receipts)

import { mockInventoryPhotoAnalyzer } from "./mockInventoryPhotoAnalyzer";

export { type InventoryPhotoAnalyzer, type DraftSuggestion } from "./analyzerTypes";
export const activeAnalyzer = mockInventoryPhotoAnalyzer;
