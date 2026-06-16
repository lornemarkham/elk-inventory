import type { ImportBatch, ImportDraftItem } from "../types/import";

const BATCH_KEY  = "elk-import-batches";
const DRAFT_KEY  = "elk-import-drafts";

export function loadBatches(): ImportBatch[] {
  try {
    const raw = localStorage.getItem(BATCH_KEY);
    return raw ? (JSON.parse(raw) as ImportBatch[]) : [];
  } catch { return []; }
}

export function saveBatches(batches: ImportBatch[]): void {
  localStorage.setItem(BATCH_KEY, JSON.stringify(batches));
}

export function loadDrafts(): ImportDraftItem[] {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as ImportDraftItem[]) : [];
  } catch { return []; }
}

export function saveDrafts(drafts: ImportDraftItem[]): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
}
