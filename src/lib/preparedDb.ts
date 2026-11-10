// ── Prepared database calls ────────────────────────────────────────────────────
// Household, equipment and plan text live in supabase-prepared.sql's tables
// (family members only, enforced by the database). Food/water cover is
// computed from the Pantry, so nothing about stock is written here except the
// classification keys on a product's existing attributes JSON.

import { supabase } from "./supabase";
import { DEFAULT_HOUSEHOLD, type Equipment, type EquipmentCategory, type Household, type PlanInfo, type PrepKind, PREP_UNIT_LABEL } from "./preparedModel";

type Row = Record<string, unknown>;
export type PrepResult<T = void> = { ok: true; value: T } | { ok: false; error: string };

export type PreparedLoad =
  | { status: "ready"; household: Household; equipment: Equipment[]; info: PlanInfo; planUpdatedAt: string | null }
  | { status: "not-set-up" }
  | { status: "error"; error: string };

const num = (v: unknown, fallback: number) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function rowToHousehold(r: Row | null | undefined): Household {
  if (!r) return { ...DEFAULT_HOUSEHOLD };
  return {
    people: num(r.people, DEFAULT_HOUSEHOLD.people),
    pets: num(r.pets, DEFAULT_HOUSEHOLD.pets),
    days: num(r.days, DEFAULT_HOUSEHOLD.days),
    kcalPerPersonDay: num(r.kcal_per_person_day, DEFAULT_HOUSEHOLD.kcalPerPersonDay),
    waterLPerPersonDay: num(r.water_l_per_person_day, DEFAULT_HOUSEHOLD.waterLPerPersonDay),
    waterLPerPetDay: num(r.water_l_per_pet_day, DEFAULT_HOUSEHOLD.waterLPerPetDay),
  };
}

export function rowToEquipment(r: Row): Equipment {
  return {
    id: r.id as string,
    name: r.name as string,
    category: (r.category as EquipmentCategory) ?? "other",
    quantity: num(r.quantity, 1),
    capacityWh: numOrNull(r.capacity_wh),
    loadWatts: numOrNull(r.load_watts),
    hoursPerDay: numOrNull(r.hours_per_day),
    essential: r.essential === true,
    bestBefore: (r.best_before as string | null) ?? null,
    barcode: (r.barcode as string | null) ?? "",
    location: (r.location as string | null) ?? "",
    notes: (r.notes as string | null) ?? "",
  };
}

function equipmentToRow(e: Omit<Equipment, "id">): Row {
  return {
    name: e.name.trim(), category: e.category, quantity: e.quantity, capacity_wh: e.capacityWh, load_watts: e.loadWatts,
    hours_per_day: e.hoursPerDay, essential: e.essential, best_before: e.bestBefore || null,
    barcode: e.barcode || null, location: e.location, notes: e.notes,
  };
}

function isMissingTable(err: { code?: string; message?: string }): boolean {
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? "");
}

export async function loadPrepared(): Promise<PreparedLoad> {
  const [h, e, p] = await Promise.all([
    supabase.from("prepared_household").select("*").maybeSingle(),
    supabase.from("prepared_equipment").select("*").order("created_at", { ascending: true }),
    supabase.from("prepared_plan").select("*").maybeSingle(),
  ]);
  for (const r of [h, e, p]) {
    if (r.error) {
      if (isMissingTable(r.error)) return { status: "not-set-up" };
      console.error("[ELK] loadPrepared error:", r.error.message);
      return { status: "error", error: r.error.message };
    }
  }
  const info = (p.data?.info as PlanInfo | undefined) ?? {};
  return {
    status: "ready",
    household: rowToHousehold(h.data as Row | null),
    equipment: ((e.data ?? []) as Row[]).map(rowToEquipment),
    info,
    planUpdatedAt: (p.data?.updated_at as string | undefined) ?? null,
  };
}

async function done(q: PromiseLike<{ error: { message: string } | null }>, what: string): Promise<PrepResult> {
  const { error } = await q;
  if (error) { console.error(`[ELK] ${what} error:`, error.message); return { ok: false, error: error.message }; }
  return { ok: true, value: undefined };
}

export function saveHousehold(h: Household): Promise<PrepResult> {
  return done(supabase.from("prepared_household").upsert({
    id: "household", people: h.people, pets: h.pets, days: h.days,
    kcal_per_person_day: h.kcalPerPersonDay, water_l_per_person_day: h.waterLPerPersonDay, water_l_per_pet_day: h.waterLPerPetDay,
  }), "saveHousehold");
}

export function savePlanInfo(info: PlanInfo): Promise<PrepResult> {
  return done(supabase.from("prepared_plan").upsert({ id: "plan", info }), "savePlanInfo");
}

export function addEquipment(e: Omit<Equipment, "id">): Promise<PrepResult> {
  return done(supabase.from("prepared_equipment").insert(equipmentToRow(e)), "addEquipment");
}

export function updateEquipment(id: string, e: Omit<Equipment, "id">): Promise<PrepResult> {
  return done(supabase.from("prepared_equipment").update(equipmentToRow(e)).eq("id", id), "updateEquipment");
}

export function removeEquipment(id: string): Promise<PrepResult> {
  return done(supabase.from("prepared_equipment").delete().eq("id", id), "removeEquipment");
}

/**
 * Mark a Pantry product as food / water / pet food for preparedness, with how
 * much one unit is worth. Reads the product's attributes first and writes back
 * only these keys, so nothing a family member changed meanwhile is overwritten
 * (same approach as db.setBarcode).
 */
export async function classifyItem(itemId: string, kind: PrepKind | null, perUnit: number | null): Promise<PrepResult> {
  const { data, error: readError } = await supabase.from("inventory_items").select("attributes").eq("id", itemId).single();
  if (readError) { console.error("[ELK] classifyItem read error:", readError.message); return { ok: false, error: readError.message }; }
  const attributes = { ...((data?.attributes as Record<string, unknown> | null) ?? {}) };
  for (const k of ["prepKind", ...Object.values(PREP_UNIT_LABEL).map(v => v.per)]) delete attributes[k];
  if (kind && perUnit && perUnit > 0) { attributes.prepKind = kind; attributes[PREP_UNIT_LABEL[kind].per] = perUnit; }
  return done(supabase.from("inventory_items").update({ attributes, updated_at: new Date().toISOString() }).eq("id", itemId), "classifyItem");
}
