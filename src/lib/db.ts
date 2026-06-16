// ── Database layer ─────────────────────────────────────────────────────────────
// Wraps Supabase calls and handles camelCase ↔ snake_case mapping.
// All callers in App.tsx use these functions; swap the implementation here
// if the backend changes without touching any component code.

import { supabase } from "./supabase";
import type { InventoryItem } from "../types/inventory";

// ── Mapping helpers ────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function itemToRow(item: InventoryItem): Row {
  return {
    id:               item.id,
    name:             item.name,
    item_class:       item.itemClass,
    lifecycle_state:  item.lifecycleState,
    domain:           item.domain ?? null,
    current_zone:     item.currentZone,
    recommended_zone: item.recommendedZone,
    location_detail:  item.locationDetail ?? "",
    collection_id:    item.collectionId ?? null,
    container_id:     item.containerId ?? null,
    project:          item.project ?? null,
    tags:             item.tags ?? [],
    quantity:         item.quantity ?? 1,
    photo_path:       item.photoPath ?? "",
    photo_type:       item.photoType ?? null,
    notes:            item.notes ?? "",
    power_type:       item.powerType ?? null,
    battery_platform: item.batteryPlatform ?? null,
    brand:            item.brand ?? null,
    category:         item.category ?? null,
    subcategory:      item.subcategory ?? null,
    attributes:       item.attributes ?? {},
    created_at:       item.createdAt ?? new Date().toISOString(),
    updated_at:       item.updatedAt ?? new Date().toISOString(),
  };
}

function rowToItem(row: Row): InventoryItem {
  return {
    id:               row.id as string,
    name:             row.name as string,
    itemClass:        row.item_class as InventoryItem["itemClass"],
    lifecycleState:   row.lifecycle_state as InventoryItem["lifecycleState"],
    domain:           (row.domain as InventoryItem["domain"]) ?? undefined,
    currentZone:      row.current_zone as InventoryItem["currentZone"],
    recommendedZone:  row.recommended_zone as InventoryItem["recommendedZone"],
    locationDetail:   (row.location_detail as string) ?? "",
    collectionId:     (row.collection_id as string | null) ?? null,
    containerId:      (row.container_id as string | null) ?? null,
    project:          (row.project as string | null) ?? null,
    tags:             (row.tags as string[]) ?? [],
    quantity:         (row.quantity as number) ?? 1,
    photoPath:        (row.photo_path as string) ?? "",
    photoType:        (row.photo_type as InventoryItem["photoType"]) ?? undefined,
    notes:            (row.notes as string) ?? "",
    powerType:        (row.power_type as InventoryItem["powerType"]) ?? undefined,
    batteryPlatform:  (row.battery_platform as InventoryItem["batteryPlatform"]) ?? undefined,
    brand:            (row.brand as string | undefined) ?? undefined,
    category:         (row.category as string | undefined) ?? undefined,
    subcategory:      (row.subcategory as string | undefined) ?? undefined,
    attributes:       (row.attributes as Record<string, string | number | boolean>) ?? {},
    createdAt:        (row.created_at as string) ?? undefined,
    updatedAt:        (row.updated_at as string) ?? undefined,
  };
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function fetchItems(): Promise<InventoryItem[]> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[ELK] fetchItems error:", error.message);
    return [];
  }
  return (data as Row[]).map(rowToItem);
}

export async function createItem(item: InventoryItem): Promise<void> {
  const { error } = await supabase
    .from("inventory_items")
    .insert(itemToRow(item));

  if (error) console.error("[ELK] createItem error:", error.message);
}

export async function updateItem(item: InventoryItem): Promise<void> {
  const { error } = await supabase
    .from("inventory_items")
    .update(itemToRow(item))
    .eq("id", item.id);

  if (error) console.error("[ELK] updateItem error:", error.message);
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase
    .from("inventory_items")
    .delete()
    .eq("id", id);

  if (error) console.error("[ELK] deleteItem error:", error.message);
}

export async function upsertItems(items: InventoryItem[]): Promise<void> {
  const rows = items.map(itemToRow);
  const { error } = await supabase
    .from("inventory_items")
    .upsert(rows, { onConflict: "id" });

  if (error) console.error("[ELK] upsertItems error:", error.message);
}

export async function deleteAllItems(): Promise<void> {
  const { error } = await supabase
    .from("inventory_items")
    .delete()
    .neq("id", "");   // delete all rows

  if (error) console.error("[ELK] deleteAllItems error:", error.message);
}
