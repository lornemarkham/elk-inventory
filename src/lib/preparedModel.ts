// ── Prepared model (pure) ──────────────────────────────────────────────────────
// How long would we last? Reads the Pantry (products + batches) and the
// equipment list; no database, no clock (callers pass `today`). Everything the
// screen, the shopping list and the printed plan say comes from here, so the
// numbers can be tested.
//
//   Household  = people, pets, days to cover, daily needs
//   Pantry item with attributes.prepKind = "food" | "water" | "pet-food" counts
//     food:     attributes.kcalPerUnit      kcal in ONE unit (a can, a bag)
//     water:    attributes.litresPerUnit    litres in ONE unit (a jug, a case)
//     pet-food: attributes.petDaysPerUnit   days of food for ONE pet in one unit
//   Batches past their best-before date are shown but NOT counted as cover.

import type { InventoryItem } from "../types/inventory";
import { daysUntil, summarize, type StockLot } from "./pantryModel";

export interface Household {
  people: number;
  pets: number;
  /** How many days we want to be able to cope on our own. */
  days: number;
  kcalPerPersonDay: number;
  waterLPerPersonDay: number;
  waterLPerPetDay: number;
}

export const DEFAULT_HOUSEHOLD: Household = {
  people: 2, pets: 0, days: 14, kcalPerPersonDay: 2000, waterLPerPersonDay: 3, waterLPerPetDay: 1,
};

export type PrepKind = "food" | "water" | "pet-food";
export const PREP_KINDS: PrepKind[] = ["food", "water", "pet-food"];

export const PREP_UNIT_LABEL: Record<PrepKind, { per: string; unit: string }> = {
  food: { per: "kcalPerUnit", unit: "kcal in one unit" },
  water: { per: "litresPerUnit", unit: "litres in one unit" },
  "pet-food": { per: "petDaysPerUnit", unit: "days of food for one pet in one unit" },
};

/** Which preparedness kind a product was classified as (null = not classified or values missing). */
export function prepOf(item: InventoryItem): { kind: PrepKind; perUnit: number } | null {
  const k = item.attributes?.prepKind;
  if (k !== "food" && k !== "water" && k !== "pet-food") return null;
  const v = item.attributes?.[PREP_UNIT_LABEL[k].per];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? { kind: k, perUnit: n } : null;
}

// ── Stock → cover ────────────────────────────────────────────────────────────

export interface StockLine {
  item: InventoryItem;
  kind: PrepKind;
  perUnit: number;
  /** Units still in date (undated batches count as in date). */
  usableUnits: number;
  /** Units whose best-before has passed. */
  expiredUnits: number;
  /** Usable units whose best-before falls inside the planning window (replace soon). */
  expiringUnits: number;
  /** Earliest best-before among usable batches, if any is dated. */
  nextBestBefore: string | null;
}

export function stockLines(items: InventoryItem[], lots: StockLot[], household: Household, today: string): StockLine[] {
  const out: StockLine[] = [];
  for (const item of items) {
    if (item.domain !== "food-storage") continue;
    const prep = prepOf(item);
    if (!prep) continue;
    const s = summarize(item, lots);
    let usable = 0, expired = 0, expiring = 0;
    let next: string | null = null;
    if (s.untracked) {
      // No batches: the item's own count, with the item-level date if there is one.
      const d = item.attributes?.expiryDate;
      const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
      if (date && daysUntil(date, today) < 0) expired = s.onHand; else { usable = s.onHand; next = date; }
      if (date && usable > 0 && daysUntil(date, today) <= household.days) expiring = usable;
    } else {
      for (const l of s.openLots) {
        if (l.bestBefore && daysUntil(l.bestBefore, today) < 0) { expired += l.quantityRemaining; continue; }
        usable += l.quantityRemaining;
        if (l.bestBefore) {
          if (!next || l.bestBefore < next) next = l.bestBefore;
          if (daysUntil(l.bestBefore, today) <= household.days) expiring += l.quantityRemaining;
        }
      }
    }
    if (usable + expired > 0) out.push({ item, kind: prep.kind, perUnit: prep.perUnit, usableUnits: usable, expiredUnits: expired, expiringUnits: expiring, nextBestBefore: next });
  }
  return out;
}

export interface Cover {
  kind: PrepKind;
  label: string;
  unit: string;            // "kcal" | "L" | "pet-days"
  applies: boolean;        // false when nobody needs it (e.g. no pets)
  perDay: number;          // need per day, in `unit`
  required: number;        // perDay × target days
  have: number;            // usable, in date
  expired: number;
  /** Whole-and-tenth days the in-date stock lasts. null when nothing is needed per day. */
  days: number | null;
  /** days ≥ target. */
  meetsTarget: boolean;
  shortfall: number;       // amount still needed to reach the target
  shortfallDays: number;   // the same, in days
  lines: StockLine[];
}

const round1 = (n: number) => Math.floor(n * 10 + 1e-9) / 10;

export function cover(kind: PrepKind, household: Household, lines: StockLine[]): Cover {
  const mine = lines.filter(l => l.kind === kind);
  const meta = {
    food: { label: "Food", unit: "kcal", perDay: household.people * household.kcalPerPersonDay },
    water: { label: "Water", unit: "L", perDay: household.people * household.waterLPerPersonDay + household.pets * household.waterLPerPetDay },
    "pet-food": { label: "Pet food", unit: "pet-days", perDay: household.pets },
  }[kind];
  const have = mine.reduce((n, l) => n + l.usableUnits * l.perUnit, 0);
  const expired = mine.reduce((n, l) => n + l.expiredUnits * l.perUnit, 0);
  const required = meta.perDay * household.days;
  const applies = meta.perDay > 0;
  const days = applies ? round1(have / meta.perDay) : null;
  const shortfall = applies ? Math.max(0, Math.ceil(required - have - 1e-9)) : 0;
  return {
    kind, label: meta.label, unit: meta.unit, applies, perDay: meta.perDay, required, have, expired,
    days, meetsTarget: !applies || have + 1e-9 >= required,
    shortfall, shortfallDays: applies ? round1(shortfall / meta.perDay) : 0, lines: mine,
  };
}

export function allCover(household: Household, lines: StockLine[]): Cover[] {
  return PREP_KINDS.map(k => cover(k, household, lines));
}

/** Pantry products that are food but not yet classified for preparedness — the "set me up" list. */
export function unclassifiedFood(items: InventoryItem[]): InventoryItem[] {
  return items.filter(i => i.domain === "food-storage" && !prepOf(i));
}

// ── Equipment & backup power ─────────────────────────────────────────────────

export type EquipmentCategory = "power" | "light" | "water" | "heat" | "comms" | "medical" | "tools" | "other";
export const EQUIPMENT_CATEGORIES: { id: EquipmentCategory; label: string }[] = [
  { id: "power", label: "Backup power" }, { id: "light", label: "Light" }, { id: "water", label: "Water treatment" },
  { id: "heat", label: "Heat & cooking" }, { id: "comms", label: "Communications" }, { id: "medical", label: "First aid & medical" },
  { id: "tools", label: "Tools" }, { id: "other", label: "Other" },
];

export interface Equipment {
  id: string;
  name: string;
  category: EquipmentCategory;
  quantity: number;
  /** Stored energy of ONE unit, watt-hours (backup power). */
  capacityWh: number | null;
  /** Watts while running. */
  loadWatts: number | null;
  hoursPerDay: number | null;
  /** Counts toward the runtime estimate. */
  essential: boolean;
  bestBefore: string | null;
  barcode: string;
  location: string;
  notes: string;
}

/** Real batteries and inverters lose some energy; 0.85 is a cautious usual figure. */
export const POWER_EFFICIENCY = 0.85;

export interface PowerEstimate {
  /** Usable watt-hours across every power unit (capacity × quantity × efficiency). */
  usableWh: number;
  /** Watt-hours the essential loads use per day. */
  dailyWh: number;
  /** usableWh ÷ dailyWh; null when no essential load is entered. */
  days: number | null;
  /** Hours each essential load could run if it had all the stored energy to itself. */
  perLoad: { equipment: Equipment; hoursAlone: number | null }[];
  sources: Equipment[];
  loads: Equipment[];
  /** Why there is no figure, in words. */
  note: string | null;
}

export function powerEstimate(equipment: Equipment[], efficiency = POWER_EFFICIENCY): PowerEstimate {
  const sources = equipment.filter(e => e.capacityWh && e.capacityWh > 0 && e.quantity > 0);
  const usableWh = sources.reduce((n, e) => n + e.capacityWh! * e.quantity * efficiency, 0);
  const loads = equipment.filter(e => e.essential && e.loadWatts && e.loadWatts > 0 && e.quantity > 0);
  const dailyWh = loads.reduce((n, e) => n + e.loadWatts! * (e.hoursPerDay ?? 24) * e.quantity, 0);
  const days = dailyWh > 0 ? round1(usableWh / dailyWh) : null;
  const perLoad = loads.map(e => ({ equipment: e, hoursAlone: e.loadWatts! * e.quantity > 0 ? round1(usableWh / (e.loadWatts! * e.quantity)) : null }));
  let note: string | null = null;
  if (sources.length === 0) note = "No backup power is listed. Add a battery bank, power station or generator with its capacity in Wh.";
  else if (loads.length === 0) note = "Mark the devices you would run (fridge, phone chargers, radio) as essential with their watts to get a runtime.";
  return { usableWh: Math.round(usableWh), dailyWh: Math.round(dailyWh), days, perLoad, sources, loads, note };
}

/** Watts × hours → Wh helper, and amp-hours → Wh for battery labels (Ah × volts). */
export const whFromAh = (ah: number, volts: number) => Math.round(ah * volts * 10) / 10;

export interface ExpiringEquipment { equipment: Equipment; days: number }
export function expiringEquipment(equipment: Equipment[], today: string, withinDays: number): ExpiringEquipment[] {
  return equipment
    .filter(e => e.bestBefore && daysUntil(e.bestBefore, today) <= withinDays)
    .map(e => ({ equipment: e, days: daysUntil(e.bestBefore!, today) }))
    .sort((a, b) => a.days - b.days);
}

const ESSENTIAL_KITS: { category: EquipmentCategory; add: string }[] = [
  { category: "power", add: "Backup power (battery bank / power station)" },
  { category: "light", add: "Flashlights or lanterns" },
  { category: "comms", add: "Battery or crank radio" },
  { category: "medical", add: "First-aid kit" },
  { category: "water", add: "Water filter or purification tablets" },
];

// ── Replenishment / shopping ─────────────────────────────────────────────────

export interface ShortfallLine {
  /** Stable name — the shopping list ignores a name already on it, so no amount in here. */
  name: string;
  /** The amount and reason go here. */
  note: string;
  why: "shortfall" | "replace" | "missing";
}

const nf = (n: number) => Math.round(n).toLocaleString("en-CA");

export function replenishment(
  household: Household, covers: Cover[], equipment: Equipment[], today: string,
): ShortfallLine[] {
  const out: ShortfallLine[] = [];
  const advice: Record<PrepKind, string> = { food: "Food for the emergency supply", water: "Water for the emergency supply", "pet-food": "Pet food for the emergency supply" };
  for (const c of covers) {
    if (!c.applies) continue;
    if (c.shortfall > 0) {
      out.push({
        name: advice[c.kind], why: "shortfall",
        note: `Prepared: need ${nf(c.shortfall)} ${c.unit} more (${c.shortfallDays} days) to reach ${household.days} days; have ${c.days} days.`,
      });
    }
    // Stock that expired or will expire inside the planning window should be replaced.
    for (const l of c.lines) {
      if (l.expiredUnits > 0) out.push({ name: `Replace: ${l.item.name}`, why: "replace", note: `Prepared: ${l.expiredUnits} past best-before — replace.` });
      else if (l.expiringUnits > 0) out.push({ name: `Replace: ${l.item.name}`, why: "replace", note: `Prepared: ${l.expiringUnits} expire${l.expiringUnits === 1 ? "s" : ""} within ${household.days} days${l.nextBestBefore ? ` (first ${l.nextBestBefore})` : ""} — use and replace.` });
    }
  }
  for (const e of equipment) {
    if (e.bestBefore && daysUntil(e.bestBefore, today) <= household.days) {
      const d = daysUntil(e.bestBefore, today);
      out.push({ name: `Replace: ${e.name}`, why: "replace", note: d < 0 ? "Prepared: past its date — replace." : `Prepared: due ${e.bestBefore} — replace.` });
    }
  }
  for (const k of ESSENTIAL_KITS) {
    if (!equipment.some(e => e.category === k.category && e.quantity > 0)) {
      out.push({ name: k.add, why: "missing", note: "Prepared: nothing of this kind is listed." });
    }
  }
  // De-duplicate by name (a product can have both an expired and an expiring batch).
  const seen = new Set<string>();
  return out.filter(l => (seen.has(l.name.toLowerCase()) ? false : (seen.add(l.name.toLowerCase()), true)));
}

// ── The plan ─────────────────────────────────────────────────────────────────

export interface PlanInfo {
  meetingPlace?: string;
  outOfAreaContact?: string;
  contacts?: string;
  shutoffs?: string;
  medical?: string;
  evacuation?: string;
  notes?: string;
}
export const PLAN_FIELDS: { key: keyof PlanInfo; label: string; hint: string }[] = [
  { key: "meetingPlace", label: "Where we meet", hint: "Near home, and a second place if we can't get home" },
  { key: "outOfAreaContact", label: "Out-of-area contact", hint: "Someone far away everyone can call or text" },
  { key: "contacts", label: "Important numbers", hint: "Doctor, vet, school, neighbours, insurance" },
  { key: "shutoffs", label: "Shut-offs", hint: "Where the water, gas and electrical main shut-offs are" },
  { key: "medical", label: "Medical & medications", hint: "Who needs what, allergies" },
  { key: "evacuation", label: "If we have to leave", hint: "Routes, what to grab, where to go" },
  { key: "notes", label: "Other notes", hint: "" },
];

/** Everything the printed/offline plan shows, as plain data. */
export interface PlanSnapshot {
  generatedOn: string;       // YYYY-MM-DD
  household: Household;
  covers: { kind: PrepKind; label: string; unit: string; applies: boolean; days: number | null; have: number; required: number; shortfall: number; meetsTarget: boolean }[];
  power: { usableWh: number; dailyWh: number; days: number | null; note: string | null };
  equipment: { name: string; category: EquipmentCategory; quantity: number; location: string; bestBefore: string | null; capacityWh: number | null }[];
  replace: { name: string; note: string }[];
  info: PlanInfo;
}

export function buildPlan(household: Household, covers: Cover[], power: PowerEstimate, equipment: Equipment[], info: PlanInfo, today: string): PlanSnapshot {
  return {
    generatedOn: today,
    household,
    covers: covers.map(c => ({ kind: c.kind, label: c.label, unit: c.unit, applies: c.applies, days: c.days, have: Math.round(c.have), required: Math.round(c.required), shortfall: c.shortfall, meetsTarget: c.meetsTarget })),
    power: { usableWh: power.usableWh, dailyWh: power.dailyWh, days: power.days, note: power.note },
    equipment: equipment.map(e => ({ name: e.name, category: e.category, quantity: e.quantity, location: e.location, bestBefore: e.bestBefore, capacityWh: e.capacityWh })),
    replace: replenishment(household, covers, equipment, today).map(l => ({ name: l.name, note: l.note.replace(/^Prepared: /, "") })),
    info,
  };
}

// Offline copy of the last plan the device saw (localStorage — see ADR-0001).
export const PLAN_CACHE_KEY = "elk-prepared-plan-v1";
export interface CachedPlan { savedAt: string; plan: PlanSnapshot }

export function parseCachedPlan(raw: string | null): CachedPlan | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as CachedPlan;
    if (v && typeof v.savedAt === "string" && v.plan && Array.isArray(v.plan.covers) && Array.isArray(v.plan.equipment) && v.plan.household) return v;
  } catch { /* corrupt cache: ignore */ }
  return null;
}
