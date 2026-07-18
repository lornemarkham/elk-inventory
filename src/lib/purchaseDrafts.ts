// ── Purchase draft database layer ─────────────────────────────────────────────
// Structural twin of src/lib/db.ts, kept as a separate file per
// docs/purchase-intake-v1-spec.md §6 (drafts are a distinct concern from
// inventory items, even though both live in Supabase).

import { supabase } from "./supabase";
import * as db from "./db";
import type { InventoryItem, ZoneId, InventoryDomain, ItemClass } from "../types/inventory";
import type { ExtractedFields, PurchaseDraft, PurchaseDraftStatus } from "../types/purchase";

type Row = Record<string, unknown>;

function rowToDraft(row: Row): PurchaseDraft {
  return {
    id: row.id as string,
    rawText: row.raw_text as string,
    suggestedName: (row.suggested_name as string | null) ?? null,
    suggestedQuantity: (row.suggested_quantity as number | null) ?? null,
    suggestedBrand: (row.suggested_brand as string | null) ?? null,
    suggestedVendor: (row.suggested_vendor as string | null) ?? null,
    suggestedPrice: (row.suggested_price as number | null) ?? null,
    suggestedCurrency: (row.suggested_currency as string | null) ?? null,
    suggestedPurchaseDate: (row.suggested_purchase_date as string | null) ?? null,
    productUrl: (row.product_url as string | null) ?? null,
    suggestedCollectionId: (row.suggested_collection_id as string | null) ?? null,
    suggestedProject: (row.suggested_project as string | null) ?? null,
    suggestedModel: (row.suggested_model as string | null) ?? null,
    suggestedCategory: (row.suggested_category as string | null) ?? null,
    status: row.status as PurchaseDraftStatus,
    resolvedItemId: (row.resolved_item_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function draftPatchToRow(patch: Partial<PurchaseDraft>): Row {
  const row: Row = {};
  if (patch.rawText !== undefined) row.raw_text = patch.rawText;
  if (patch.suggestedName !== undefined) row.suggested_name = patch.suggestedName;
  if (patch.suggestedQuantity !== undefined) row.suggested_quantity = patch.suggestedQuantity;
  if (patch.suggestedBrand !== undefined) row.suggested_brand = patch.suggestedBrand;
  if (patch.suggestedVendor !== undefined) row.suggested_vendor = patch.suggestedVendor;
  if (patch.suggestedPrice !== undefined) row.suggested_price = patch.suggestedPrice;
  if (patch.suggestedCurrency !== undefined) row.suggested_currency = patch.suggestedCurrency;
  if (patch.suggestedPurchaseDate !== undefined) row.suggested_purchase_date = patch.suggestedPurchaseDate;
  if (patch.productUrl !== undefined) row.product_url = patch.productUrl;
  if (patch.suggestedCollectionId !== undefined) row.suggested_collection_id = patch.suggestedCollectionId;
  if (patch.suggestedProject !== undefined) row.suggested_project = patch.suggestedProject;
  if (patch.suggestedModel !== undefined) row.suggested_model = patch.suggestedModel;
  if (patch.suggestedCategory !== undefined) row.suggested_category = patch.suggestedCategory;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.resolvedItemId !== undefined) row.resolved_item_id = patch.resolvedItemId;
  row.updated_at = new Date().toISOString();
  return row;
}

// ── Create ───────────────────────────────────────────────────────────────────

function extractedToInsertRow(rawText: string, extracted: ExtractedFields): Row {
  return {
    raw_text: rawText,
    suggested_name: extracted.name || null,
    suggested_quantity: extracted.quantity,
    suggested_brand: extracted.brand,
    suggested_vendor: extracted.vendor,
    suggested_price: extracted.price,
    suggested_currency: extracted.currency,
    suggested_purchase_date: extracted.purchaseDate,
    product_url: extracted.productUrl,
    suggested_collection_id: extracted.collectionId,
    suggested_project: extracted.project,
    suggested_model: extracted.model,
    suggested_category: extracted.category,
    status: "pending",
  };
}

export async function createDraft(rawText: string, extracted: ExtractedFields): Promise<PurchaseDraft | null> {
  const { data, error } = await supabase
    .from("purchase_drafts")
    .insert(extractedToInsertRow(rawText, extracted))
    .select()
    .single();

  if (error) {
    console.error("[ELK] createDraft error:", error.message);
    return null;
  }
  return rowToDraft(data as Row);
}

/**
 * Batch insert — used by multi-product capture (one paste, many detected
 * products) so N drafts cost one round-trip instead of N. Every entry shares
 * the pipeline's per-product raw_text excerpt (not the whole original paste)
 * so each draft's "evidence" stays specific to that one product.
 */
export async function createDrafts(
  entries: { rawText: string; extracted: ExtractedFields }[],
): Promise<PurchaseDraft[]> {
  if (entries.length === 0) return [];

  const rows = entries.map((e) => extractedToInsertRow(e.rawText, e.extracted));
  const { data, error } = await supabase
    .from("purchase_drafts")
    .insert(rows)
    .select();

  if (error) {
    console.error("[ELK] createDrafts error:", error.message);
    return [];
  }
  return (data as Row[]).map(rowToDraft);
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function fetchPendingDrafts(): Promise<PurchaseDraft[]> {
  const { data, error } = await supabase
    .from("purchase_drafts")
    .select("*")
    .in("status", ["pending", "saved-for-later"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[ELK] fetchPendingDrafts error:", error.message);
    return [];
  }
  return (data as Row[]).map(rowToDraft);
}

// ── Update (non-terminal edits — fire-and-forget is acceptable here) ─────────

export async function updateDraft(id: string, patch: Partial<PurchaseDraft>): Promise<void> {
  const { error } = await supabase
    .from("purchase_drafts")
    .update(draftPatchToRow(patch))
    .eq("id", id);

  if (error) console.error("[ELK] updateDraft error:", error.message);
}

// ── Reject / Save for later ───────────────────────────────────────────────────

export async function rejectDraft(id: string): Promise<void> {
  await updateDraft(id, { status: "rejected" });
}

export async function saveDraftForLater(id: string): Promise<void> {
  await updateDraft(id, { status: "saved-for-later" });
}

// ── Approve ──────────────────────────────────────────────────────────────────
// Awaited, not fire-and-forget — a silently-failed approval would break the
// provenance guarantee (docs/purchase-intake-v1-spec.md, Edge Cases §4).
// Guards against double-submit by only updating the draft row if its status
// still matches what the caller last saw (`.eq("status", draft.status)`);
// zero rows affected means someone else already resolved it.

export interface ApprovedFields {
  name: string;
  itemClass: ItemClass;
  domain?: InventoryDomain;
  quantity: number;
  currentZone: ZoneId;
  collectionId: string | null;
  project: string | null;
  notes: string;
  category?: string;
  // Everything below reflects the Confirm screen's current (possibly
  // user-edited) values, not the original AI suggestion on the draft row —
  // see docs/knowledge/lessons-learned.md, "Review edits were discarded".
  brand?: string | null;
  model?: string | null;
  vendor?: string | null;
  price?: number | null;
  currency?: string | null;
  purchaseDate?: string | null;
  productUrl?: string | null;
}

export type ApproveAction =
  | { kind: "new"; fields: ApprovedFields }
  | { kind: "merge"; existingItem: InventoryItem; addQuantity: number };

export async function approveDraft(
  draft: PurchaseDraft,
  action: ApproveAction,
): Promise<{ item: InventoryItem } | { error: string }> {
  if (draft.status !== "pending" && draft.status !== "saved-for-later") {
    return { error: `Draft is already ${draft.status} — nothing to approve.` };
  }

  let resultItem: InventoryItem;

  if (action.kind === "merge") {
    // No edit form for a merge (it's a one-click "same thing, update count"
    // action from the duplicate-match banner) — the draft's original AI
    // suggestions are the only values that exist, so they're correct here.
    const purchaseAttributes: Record<string, string | number | boolean> = {};
    if (draft.suggestedPrice != null) purchaseAttributes.purchasePrice = draft.suggestedPrice;
    if (draft.suggestedCurrency) purchaseAttributes.purchaseCurrency = draft.suggestedCurrency;
    if (draft.suggestedVendor) purchaseAttributes.purchaseVendor = draft.suggestedVendor;
    if (draft.suggestedPurchaseDate) purchaseAttributes.purchaseDate = draft.suggestedPurchaseDate;
    if (draft.productUrl) purchaseAttributes.productUrl = draft.productUrl;
    if (draft.suggestedModel) purchaseAttributes.model = draft.suggestedModel;

    const existing = action.existingItem;
    resultItem = {
      ...existing,
      quantity: existing.quantity + action.addQuantity,
      sourceDraftId: existing.sourceDraftId ?? draft.id,
      attributes: { ...(existing.attributes ?? {}), ...purchaseAttributes },
      updatedAt: new Date().toISOString(),
    };
    const written = await db.updateItem(resultItem);
    if (!written.ok) {
      return { error: `Could not update the existing item: ${written.error}` };
    }
  } else {
    // Sourced from action.fields (the Confirm screen's current state), not
    // the draft's original suggestions — otherwise any correction the user
    // made in "Add more detail" (brand, model, vendor, price, date, URL)
    // would silently be thrown away in favor of the AI's first guess.
    const f = action.fields;
    const purchaseAttributes: Record<string, string | number | boolean> = {};
    if (f.price != null) purchaseAttributes.purchasePrice = f.price;
    if (f.currency) purchaseAttributes.purchaseCurrency = f.currency;
    if (f.vendor) purchaseAttributes.purchaseVendor = f.vendor;
    if (f.purchaseDate) purchaseAttributes.purchaseDate = f.purchaseDate;
    if (f.productUrl) purchaseAttributes.productUrl = f.productUrl;
    if (f.model) purchaseAttributes.model = f.model;

    const now = new Date().toISOString();
    resultItem = {
      id: crypto.randomUUID(),
      name: f.name,
      itemClass: f.itemClass,
      domain: f.domain,
      lifecycleState: "ordered",
      currentZone: f.currentZone,
      recommendedZone: f.currentZone,
      locationDetail: "",
      collectionId: f.collectionId,
      containerId: null,
      project: f.project,
      tags: [],
      quantity: f.quantity,
      photoPath: "",
      notes: f.notes,
      category: f.category,
      brand: f.brand ?? undefined,
      attributes: Object.keys(purchaseAttributes).length > 0 ? purchaseAttributes : undefined,
      sourceDraftId: draft.id,
      createdAt: now,
      updatedAt: now,
    };
    const written = await db.createItem(resultItem);
    if (!written.ok) {
      return { error: `Could not save the new item: ${written.error}` };
    }
  }

  // Guarded update — no-ops if the draft's status already moved on.
  const { data, error } = await supabase
    .from("purchase_drafts")
    .update({
      status: "approved",
      resolved_item_id: resultItem.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draft.id)
    .eq("status", draft.status)
    .select();

  if (error) {
    console.error("[ELK] approveDraft error:", error.message);
    return { error: "Could not save the approval. The item may not be linked to its draft." };
  }
  if (!data || data.length === 0) {
    return { error: "This draft was already resolved elsewhere." };
  }

  return { item: resultItem };
}
