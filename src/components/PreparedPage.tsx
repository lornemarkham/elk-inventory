import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { InventoryItem } from "../types/inventory";
import { C } from "../styles";
import * as pantryDb from "../lib/pantryDb";
import * as prepDb from "../lib/preparedDb";
import type { PreparedLoad } from "../lib/preparedDb";
import type { PantryLoad } from "../lib/pantryDb";
import { ScanDetector, findByBarcode, looksLikeBarcode, normalizeBarcode, sameBarcode } from "../lib/barcode";
import { daysUntil, formatDay, localToday } from "../lib/pantryModel";
import {
  EQUIPMENT_CATEGORIES, PLAN_CACHE_KEY, PREP_UNIT_LABEL, allCover, buildPlan, expiringEquipment, powerEstimate, prepOf,
  replenishment, stockLines, type Cover, type Equipment, type EquipmentCategory, type Household, type PrepKind,
} from "../lib/preparedModel";

// ── Prepared ───────────────────────────────────────────────────────────────────
// "How long would we last?" from the real Pantry stock: household → food, water
// and pet-food days → backup power runtime → what's about to expire → what to
// buy. Household, equipment and plan text are shared by every family member.

const big: React.CSSProperties = { fontSize: "16px", padding: "10px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.bgInput, color: C.text, width: "100%", boxSizing: "border-box" };
const primaryBtn: React.CSSProperties = { background: C.amber, color: "#1c1a17", border: "none", borderRadius: "8px", padding: "11px 16px", fontSize: "16px", fontWeight: 800, cursor: "pointer" };
const quietBtn: React.CSSProperties = { background: "transparent", color: C.textMid, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "9px 13px", fontSize: "15px", cursor: "pointer" };
const label: React.CSSProperties = { display: "block", fontSize: "13px", color: C.textMid, marginBottom: "4px" };

type Toast = { text: string; error?: boolean } | null;
const nf = (n: number) => Math.round(n).toLocaleString("en-CA");
const numOrNull = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

export default function PreparedPage({ items, onItemsChanged }: { items: InventoryItem[]; onItemsChanged: () => Promise<void> }) {
  const [prep, setPrep] = useState<PreparedLoad | null>(null);
  const [pantry, setPantry] = useState<PantryLoad | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [editing, setEditing] = useState<null | { id?: string; seed?: Partial<Equipment> }>(null);
  const [focusItem, setFocusItem] = useState<string | null>(null);
  const [scanText, setScanText] = useState("");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [itemsOverride, setItemsOverride] = useState<Record<string, InventoryItem["attributes"]>>({});
  const today = localToday();

  const reload = useCallback(async () => {
    const [p, pa] = await Promise.all([prepDb.loadPrepared(), pantryDb.loadPantry()]);
    setPrep(p); setPantry(pa);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  // Items with any just-saved classification applied (the parent list is only re-read on reload).
  const liveItems = useMemo(() => items.map(i => (itemsOverride[i.id] ? { ...i, attributes: itemsOverride[i.id] } : i)), [items, itemsOverride]);

  const lots = pantry?.status === "ready" ? pantry.lots : [];
  const ready = prep?.status === "ready" ? prep : null;
  const household: Household | null = ready?.household ?? null;
  const equipment = useMemo(() => ready?.equipment ?? [], [ready]);

  const model = useMemo(() => {
    if (!household) return null;
    const lines = stockLines(liveItems, lots, household, today);
    const covers = allCover(household, lines);
    const power = powerEstimate(equipment);
    const shortfalls = replenishment(household, covers, equipment, today);
    const plan = buildPlan(household, covers, power, equipment, ready?.info ?? {}, today);
    return { lines, covers, power, shortfalls, plan };
  }, [household, liveItems, lots, equipment, ready, today]);

  // Keep the last good plan on this device for reading offline.
  useEffect(() => {
    if (model && pantry?.status === "ready") {
      try { localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), plan: model.plan })); } catch { /* storage full/blocked: skip */ }
    }
  }, [model, pantry]);

  // Keyboard-scanner bursts when no box is focused (same detector Pantry uses).
  const handleScanRef = useRef<(code: string) => void>(() => {});
  useEffect(() => {
    const d = new ScanDetector();
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const code = d.feed(e.key, e.timeStamp);
      if (code) { e.preventDefault(); handleScanRef.current(code); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleScan(raw: string) {
    const code = normalizeBarcode(raw);
    if (editing) { setScanMsg("Finish or cancel the form first, then scan again."); return; }
    const eq = equipment.find(e => e.barcode && sameBarcode(e.barcode, code));
    if (eq) { setScanMsg(`Equipment: ${eq.name}. Opened for editing.`); setEditing({ id: eq.id, seed: eq }); return; }
    const hits = findByBarcode(liveItems, code);
    if (hits.length > 0) {
      const it = hits[0];
      setFocusItem(it.id);
      setScanMsg(prepOf(it) ? `${it.name} already counts toward cover. Edit it below.` : `${it.name} is in the Pantry but doesn't count toward cover yet. Set it up below.`);
      setTimeout(() => document.getElementById(`prep-item-${it.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
      return;
    }
    setScanMsg(`${code} isn't known yet. Add it as equipment, or scan it on the Pantry screen to add a food product.`);
    setEditing({ seed: { barcode: code } });
  }
  handleScanRef.current = handleScan;

  if (!prep || !pantry) return <div style={{ padding: "40px 0", textAlign: "center", color: C.textDim }}>Loading…</div>;
  if (prep.status === "not-set-up") {
    return (
      <Card accent={C.amber}>
        <h2 style={{ margin: "0 0 8px", fontSize: "20px" }}>Prepared isn't switched on yet</h2>
        <p style={{ margin: 0, color: C.textMid, lineHeight: 1.6 }}>
          It needs one database update, <code>supabase-prepared.sql</code> (additive; nothing existing changes). Your
          last saved emergency plan can still be read: <Link to="/prepared/offline" style={{ color: C.amber }}>open the saved plan</Link>.
        </p>
      </Card>
    );
  }
  if (prep.status === "error") {
    return <Card accent={C.red}>Couldn't load Prepared: {prep.error}. <button style={quietBtn} onClick={() => void reload()}>Try again</button> <Link to="/prepared/offline" style={{ color: C.amber }}>Open the saved plan</Link></Card>;
  }
  if (!household || !model) return null;

  const say = (r: { ok: boolean; error?: string }, ok: string) => setToast(r.ok ? { text: ok } : { text: (r as { error: string }).error, error: true });

  return (
    <div style={{ display: "grid", gap: "16px", maxWidth: "820px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "24px" }}>Prepared</h1>
        <Link to="/prepared/plan" style={{ ...primaryBtn, textDecoration: "none", display: "inline-block" }}>Emergency plan · print</Link>
      </div>
      {pantry.status !== "ready" && (
        <Card accent={C.amber}><span style={{ color: C.textMid }}>
          {pantry.status === "not-set-up" ? "Pantry batches aren't switched on, so food is counted from each product's plain quantity and has no best-before dates." : `Couldn't read Pantry batches (${pantry.error}); using plain quantities.`}
        </span></Card>
      )}

      {/* Scan */}
      <Card>
        <form onSubmit={e => { e.preventDefault(); if (!looksLikeBarcode(scanText)) { setScanMsg("That doesn't look like a barcode (8–14 digits)."); return; } handleScan(scanText); setScanText(""); }} style={{ display: "flex", gap: "8px" }}>
          <input style={big} aria-label="Scan or type a barcode" placeholder="Scan or type a barcode" inputMode="numeric" value={scanText} onChange={e => setScanText(e.target.value)} />
          <button type="submit" style={quietBtn}>Look up</button>
        </form>
        {scanMsg && <div role="status" style={{ marginTop: "8px", color: C.textMid, fontSize: "14px" }}>{scanMsg}</div>}
      </Card>

      <HouseholdCard key={JSON.stringify(household)} h={household} onSave={async v => { const r = await prepDb.saveHousehold(v); say(r, "Household saved."); if (r.ok) await reload(); }} />

      {/* Duration */}
      <div style={{ display: "grid", gap: "10px" }} aria-label="How long we would last">
        {model.covers.filter(c => c.applies).map(c => <CoverCard key={c.kind} c={c} target={household.days} />)}
        <PowerCard p={model.power} target={household.days} />
      </div>

      {/* Replenish */}
      <Card accent={model.shortfalls.length ? C.red : C.green}>
        <div style={{ fontWeight: 800, marginBottom: "6px" }}>To buy or replace{model.shortfalls.length ? ` (${model.shortfalls.length})` : ""}</div>
        {model.shortfalls.length === 0 ? <span style={{ color: C.textMid }}>Nothing short, nothing about to expire.</span> : (
          <>
            <ul style={{ margin: "0 0 10px", paddingLeft: "18px", lineHeight: 1.5 }}>
              {model.shortfalls.map(l => <li key={l.name}><b>{l.name}</b> <span style={{ color: C.textMid }}>— {l.note.replace(/^Prepared: /, "")}</span></li>)}
            </ul>
            <button style={primaryBtn} onClick={async () => {
              let added = 0, failed: string | null = null;
              for (const l of model.shortfalls) {
                const r = await pantryDb.addShopping([l.name], l.note, "manual");
                if (r.ok) added += r.value; else { failed = r.error; break; }
              }
              setToast(failed ? { text: failed, error: true } : { text: added === 0 ? "They're all on the shopping list already." : `Added ${added} to the Pantry shopping list.` });
            }}>Add to shopping list</button>
          </>
        )}
      </Card>

      <BestBeforeCard covers={model.covers} equipment={equipment} today={today} />

      <CountedItems items={liveItems} lines={model.lines} focusItem={focusItem} onSave={async (id, kind, per) => {
        const r = await prepDb.classifyItem(id, kind, per);
        if (r.ok) {
          setItemsOverride(o => {
            const base = { ...(o[id] ?? liveItems.find(i => i.id === id)?.attributes ?? {}) } as Record<string, string | number | boolean>;
            for (const k of ["prepKind", "kcalPerUnit", "litresPerUnit", "petDaysPerUnit"]) delete base[k];
            if (kind && per) { base.prepKind = kind; base[PREP_UNIT_LABEL[kind].per] = per; }
            return { ...o, [id]: base };
          });
          setFocusItem(null);
          await onItemsChanged();   // the plan page reads the same list
        }
        say(r, "Saved.");
      }} />

      {/* Equipment */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div style={{ fontWeight: 800 }}>Equipment ({equipment.length})</div>
          {!editing && <button style={quietBtn} onClick={() => setEditing({})}>+ Add equipment</button>}
        </div>
        {editing && (
          <EquipmentForm key={editing.id ?? "new" + (editing.seed?.barcode ?? "")} seed={editing.seed} isEdit={!!editing.id}
            onCancel={() => setEditing(null)}
            onDelete={editing.id ? async () => { const r = await prepDb.removeEquipment(editing.id!); say(r, "Removed."); if (r.ok) { setEditing(null); await reload(); } } : undefined}
            onSave={async e => { const r = editing.id ? await prepDb.updateEquipment(editing.id, e) : await prepDb.addEquipment(e); say(r, "Saved."); if (r.ok) { setEditing(null); await reload(); } }} />
        )}
        {equipment.length === 0 && !editing && <span style={{ color: C.textMid }}>Nothing yet. Add a flashlight, a radio, a power station…</span>}
        {EQUIPMENT_CATEGORIES.map(cat => {
          const rows = equipment.filter(e => e.category === cat.id);
          if (rows.length === 0) return null;
          return (
            <div key={cat.id} style={{ marginTop: "8px" }}>
              <div style={{ fontSize: "13px", color: C.textMid, textTransform: "uppercase", letterSpacing: ".05em" }}>{cat.label}</div>
              {rows.map(e => (
                <button key={e.id} onClick={() => setEditing({ id: e.id, seed: e })} style={{ display: "flex", justifyContent: "space-between", gap: "8px", width: "100%", textAlign: "left", background: "transparent", color: C.text, border: "none", borderBottom: `1px solid ${C.borderLo}`, padding: "10px 0", fontSize: "15px", cursor: "pointer" }}>
                  <span>{e.name}{e.quantity > 1 ? ` ×${e.quantity}` : ""}{e.capacityWh ? ` · ${nf(e.capacityWh)} Wh` : ""}{e.loadWatts ? ` · ${nf(e.loadWatts)} W` : ""}{e.essential ? " · essential" : ""}</span>
                  <span style={{ color: C.textMid, whiteSpace: "nowrap" }}>{e.bestBefore ? formatDay(e.bestBefore) : ""}</span>
                </button>
              ))}
            </div>
          );
        })}
      </Card>

      {toast && <div role="status" style={{ position: "fixed", left: "12px", right: "12px", bottom: "12px", background: toast.error ? C.red : C.bgCard, border: `1px solid ${C.border}`, color: C.text, padding: "12px 14px", borderRadius: "10px", zIndex: 50 }}>{toast.text}</div>}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

function HouseholdCard({ h, onSave }: { h: Household; onSave: (h: Household) => Promise<void> }) {
  const [v, setV] = useState({ people: String(h.people), pets: String(h.pets), days: String(h.days), kcal: String(h.kcalPerPersonDay), wp: String(h.waterLPerPersonDay), wpet: String(h.waterLPerPetDay) });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  async function save() {
    const people = numOrNull(v.people), pets = numOrNull(v.pets), days = numOrNull(v.days), kcal = numOrNull(v.kcal), wp = numOrNull(v.wp), wpet = numOrNull(v.wpet);
    if (people === null || !Number.isInteger(people) || people < 0 || people > 50) return setErr("People: a whole number from 0 to 50.");
    if (pets === null || !Number.isInteger(pets) || pets < 0 || pets > 50) return setErr("Pets: a whole number from 0 to 50.");
    if (days === null || !Number.isInteger(days) || days < 1 || days > 365) return setErr("Days: a whole number from 1 to 365.");
    if (kcal === null || kcal < 500 || kcal > 6000) return setErr("Food per person per day: 500–6000 kcal.");
    if (wp === null || wp < 0.5 || wp > 20) return setErr("Water per person per day: 0.5–20 litres.");
    if (wpet === null || wpet < 0 || wpet > 20) return setErr("Water per pet per day: 0–20 litres.");
    setErr(null); setBusy(true);
    await onSave({ people, pets, days, kcalPerPersonDay: kcal, waterLPerPersonDay: wp, waterLPerPetDay: wpet });
    setBusy(false);
  }
  const f = (id: string, text: string, k: keyof typeof v, step = "1") => (
    <div><label htmlFor={id} style={label}>{text}</label><input id={id} style={big} type="number" inputMode="decimal" step={step} min="0" value={v[k]} onChange={set(k)} /></div>
  );
  return (
    <Card>
      <div style={{ fontWeight: 800, marginBottom: "8px" }}>Our household</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
        {f("hh-people", "People", "people")}{f("hh-pets", "Pets", "pets")}{f("hh-days", "Days to cover", "days")}
      </div>
      <details style={{ marginTop: "10px" }}>
        <summary style={{ cursor: "pointer", color: C.textMid }}>Daily needs (defaults are a safe starting point)</summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px", marginTop: "8px" }}>
          {f("hh-kcal", "Food kcal / person / day", "kcal", "50")}{f("hh-wp", "Water L / person / day", "wp", "0.5")}{f("hh-wpet", "Water L / pet / day", "wpet", "0.5")}
        </div>
      </details>
      {err && <div role="alert" style={{ color: C.red, marginTop: "8px" }}>{err}</div>}
      <button style={{ ...primaryBtn, marginTop: "12px" }} disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save household"}</button>
    </Card>
  );
}

function CoverCard({ c, target }: { c: Cover; target: number }) {
  const pct = Math.min(100, Math.round(((c.days ?? 0) / target) * 100));
  const color = c.meetsTarget ? C.green : (c.days ?? 0) >= target / 2 ? C.amber : C.red;
  return (
    <Card accent={color}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
        <div style={{ fontWeight: 800 }}>{c.label}</div>
        <div style={{ fontSize: "26px", fontWeight: 900, color }}>{c.days} <span style={{ fontSize: "14px", fontWeight: 600 }}>of {target} days</span></div>
      </div>
      <div style={{ height: "8px", background: C.bgInset, borderRadius: "4px", margin: "6px 0" }}><div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "4px" }} /></div>
      <div style={{ color: C.textMid, fontSize: "14px", lineHeight: 1.5 }}>
        {nf(c.have)} {c.unit} in date; need {nf(c.perDay)} {c.unit}/day.
        {c.meetsTarget ? " Target met." : ` Short ${nf(c.shortfall)} ${c.unit} (${c.shortfallDays} days).`}
        {c.expired > 0 && <span style={{ color: C.amber }}> {nf(c.expired)} {c.unit} is past best-before and not counted.</span>}
        {c.lines.length === 0 && <span> Nothing counted yet. Set up your {c.kind === "water" ? "water" : c.kind === "pet-food" ? "pet food" : "food"} products below.</span>}
      </div>
    </Card>
  );
}

function PowerCard({ p, target }: { p: ReturnType<typeof powerEstimate>; target: number }) {
  const color = p.days === null ? C.textDim : p.days >= target ? C.green : p.days >= 1 ? C.amber : C.red;
  return (
    <Card accent={color}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
        <div style={{ fontWeight: 800 }}>Backup power</div>
        <div style={{ fontSize: "26px", fontWeight: 900, color }}>{p.days === null ? "—" : p.days} <span style={{ fontSize: "14px", fontWeight: 600 }}>days</span></div>
      </div>
      <div style={{ color: C.textMid, fontSize: "14px", lineHeight: 1.5 }}>
        {p.note ?? `${nf(p.usableWh)} Wh usable (after 15% loss) ÷ ${nf(p.dailyWh)} Wh/day for essentials. No recharging counted.`}
        {p.perLoad.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
            {p.perLoad.map(l => <li key={l.equipment.id}>{l.equipment.name}{l.equipment.quantity > 1 ? ` ×${l.equipment.quantity}` : ""} on its own: {l.hoursAlone} hours</li>)}
          </ul>
        )}
      </div>
    </Card>
  );
}

function BestBeforeCard({ covers, equipment, today }: { covers: Cover[]; equipment: Equipment[]; today: string }) {
  const rows = [
    ...covers.flatMap(c => c.lines.filter(l => l.expiredUnits > 0 || l.nextBestBefore).map(l => ({
      key: `i-${l.item.id}`, name: l.item.name, date: l.expiredUnits > 0 ? "expired" : l.nextBestBefore!, days: l.expiredUnits > 0 ? -1 : daysUntil(l.nextBestBefore!, today),
      note: l.expiredUnits > 0 ? `${l.expiredUnits} past best-before` : `${l.usableUnits} in date`,
    }))),
    ...expiringEquipment(equipment, today, 3650).map(x => ({ key: `e-${x.equipment.id}`, name: x.equipment.name, date: x.equipment.bestBefore!, days: x.days, note: "equipment" })),
  ].sort((a, b) => a.days - b.days).slice(0, 12);
  return (
    <Card>
      <div style={{ fontWeight: 800, marginBottom: "6px" }}>Best-before, soonest first</div>
      {rows.length === 0 ? <span style={{ color: C.textMid }}>No dated stock yet. Add best-before dates when you put food away on the Pantry screen.</span> : rows.map(r => (
        <div key={r.key} style={{ display: "flex", justifyContent: "space-between", gap: "8px", padding: "7px 0", borderBottom: `1px solid ${C.borderLo}`, color: r.days < 0 ? C.red : r.days <= 30 ? C.amber : C.text }}>
          <span>{r.name} <span style={{ color: C.textMid, fontSize: "13px" }}>{r.note}</span></span>
          <span style={{ whiteSpace: "nowrap" }}>{r.date === "expired" ? "past date" : formatDay(r.date)}{r.days >= 0 ? ` · ${r.days} d` : ""}</span>
        </div>
      ))}
    </Card>
  );
}

function CountedItems({ items, lines, focusItem, onSave }: {
  items: InventoryItem[]; lines: ReturnType<typeof stockLines>; focusItem: string | null;
  onSave: (id: string, kind: PrepKind | null, perUnit: number | null) => Promise<void>;
}) {
  const food = items.filter(i => i.domain === "food-storage");
  const [showAll, setShowAll] = useState(false);
  const sorted = [...food].sort((a, b) => Number(!!prepOf(b)) - Number(!!prepOf(a)) || a.name.localeCompare(b.name));
  const visible = showAll || focusItem ? sorted : sorted.slice(0, 8);
  return (
    <Card>
      <div style={{ fontWeight: 800 }}>What counts toward cover</div>
      <div style={{ color: C.textMid, fontSize: "14px", margin: "2px 0 8px" }}>
        Tell Prepared which Pantry products are food, water or pet food, and how much one unit is worth (read the label: kcal per can or bag,
        litres per jug, days of food per bag). Quantities and dates come from the Pantry.
      </div>
      {food.length === 0 && <span style={{ color: C.textMid }}>No Pantry products yet. Add some on the Pantry screen first.</span>}
      {visible.map(i => <ItemRow key={i.id + JSON.stringify(i.attributes)} item={i} units={lines.find(l => l.item.id === i.id)} highlight={i.id === focusItem} onSave={onSave} />)}
      {food.length > 8 && !focusItem && <button style={{ ...quietBtn, marginTop: "8px" }} onClick={() => setShowAll(s => !s)}>{showAll ? "Show fewer" : `Show all ${food.length}`}</button>}
    </Card>
  );
}

function ItemRow({ item, units, highlight, onSave }: { item: InventoryItem; units?: ReturnType<typeof stockLines>[number]; highlight: boolean; onSave: (id: string, kind: PrepKind | null, perUnit: number | null) => Promise<void> }) {
  const cur = prepOf(item);
  const [kind, setKind] = useState<PrepKind | "">(cur?.kind ?? "");
  const [per, setPer] = useState(cur ? String(cur.perUnit) : "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = (cur?.kind ?? "") !== kind || String(cur?.perUnit ?? "") !== per;
  async function save() {
    if (!kind) { setBusy(true); await onSave(item.id, null, null); setBusy(false); return; }
    const n = numOrNull(per);
    if (n === null || n <= 0) return setErr(`Enter ${PREP_UNIT_LABEL[kind].unit} (a number above 0).`);
    setErr(null); setBusy(true); await onSave(item.id, kind, n); setBusy(false);
  }
  return (
    <div id={`prep-item-${item.id}`} style={{ padding: "10px 0", borderBottom: `1px solid ${C.borderLo}`, background: highlight ? C.bgInset : "transparent" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
        <b>{item.name}</b>
        <span style={{ color: C.textMid, fontSize: "14px" }}>{units ? `${units.usableUnits} in date${units.expiredUnits ? `, ${units.expiredUnits} expired` : ""}` : cur ? "none on hand" : ""}</span>
      </div>
      <div style={{ display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
        <select aria-label={`${item.name}: counts as`} style={{ ...big, width: "auto", flex: "1 1 130px" }} value={kind} onChange={e => { setKind(e.target.value as PrepKind | ""); setErr(null); }}>
          <option value="">Not counted</option><option value="food">Food</option><option value="water">Water</option><option value="pet-food">Pet food</option>
        </select>
        {kind && <input aria-label={`${item.name}: ${PREP_UNIT_LABEL[kind].unit}`} placeholder={PREP_UNIT_LABEL[kind].unit} style={{ ...big, flex: "2 1 160px", width: "auto" }} type="number" inputMode="decimal" min="0" value={per} onChange={e => { setPer(e.target.value); setErr(null); }} />}
        {dirty && <button style={primaryBtn} disabled={busy} onClick={() => void save()}>{busy ? "…" : "Save"}</button>}
      </div>
      {err && <div role="alert" style={{ color: C.red, fontSize: "14px", marginTop: "4px" }}>{err}</div>}
    </div>
  );
}

function EquipmentForm({ seed, isEdit, onSave, onCancel, onDelete }: {
  seed?: Partial<Equipment>; isEdit: boolean; onSave: (e: Omit<Equipment, "id">) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(seed?.name ?? "");
  const [category, setCategory] = useState<EquipmentCategory>(seed?.category ?? "other");
  const [quantity, setQuantity] = useState(String(seed?.quantity ?? 1));
  const [cap, setCap] = useState(seed?.capacityWh ? String(seed.capacityWh) : "");
  const [watts, setWatts] = useState(seed?.loadWatts ? String(seed.loadWatts) : "");
  const [hours, setHours] = useState(seed?.hoursPerDay != null ? String(seed.hoursPerDay) : "");
  const [essential, setEssential] = useState(seed?.essential ?? false);
  const [bb, setBb] = useState(seed?.bestBefore ?? "");
  const [barcode, setBarcode] = useState(seed?.barcode ?? "");
  const [where, setWhere] = useState(seed?.location ?? "");
  const [notes, setNotes] = useState(seed?.notes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const q = numOrNull(quantity), c = numOrNull(cap), w = numOrNull(watts), hr = numOrNull(hours);
    if (!name.trim()) return setErr("Give it a name.");
    if (q === null || !Number.isInteger(q) || q < 0) return setErr("Quantity: a whole number, 0 or more.");
    if (cap.trim() && (c === null || c <= 0)) return setErr("Capacity (Wh) must be a number above 0, or empty.");
    if (watts.trim() && (w === null || w < 0)) return setErr("Watts must be a number, or empty.");
    if (hours.trim() && (hr === null || hr < 0 || hr > 24)) return setErr("Hours per day: 0–24, or empty.");
    if (essential && !(w && w > 0)) return setErr("An essential device needs its watts so the runtime can be worked out.");
    if (barcode.trim() && !looksLikeBarcode(barcode)) return setErr("The barcode should be 8–14 digits, or leave it empty.");
    if (bb && !/^\d{4}-\d{2}-\d{2}$/.test(bb)) return setErr("Best-before should be a date.");
    setErr(null); setBusy(true);
    await onSave({ name, category, quantity: q, capacityWh: c, loadWatts: w, hoursPerDay: hr, essential, bestBefore: bb || null, barcode: normalizeBarcode(barcode), location: where.trim(), notes: notes.trim() });
    setBusy(false);
  }
  const fld = (id: string, text: string, el: React.ReactNode) => <div><label htmlFor={id} style={label}>{text}</label>{el}</div>;
  return (
    <form onSubmit={e => void submit(e)} style={{ display: "grid", gap: "10px", padding: "12px", marginBottom: "10px", border: `1px solid ${C.border}`, borderRadius: "10px", background: C.bgInset }}>
      <div style={{ fontWeight: 800 }}>{isEdit ? "Edit equipment" : "Add equipment"}</div>
      {fld("eq-name", "Name", <input id="eq-name" style={big} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jackery 1000 power station" />)}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: "10px" }}>
        {fld("eq-cat", "Type", <select id="eq-cat" style={big} value={category} onChange={e => setCategory(e.target.value as EquipmentCategory)}>{EQUIPMENT_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>)}
        {fld("eq-qty", "Qty", <input id="eq-qty" style={big} type="number" inputMode="numeric" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
        {fld("eq-cap", "Stores (Wh, one unit)", <input id="eq-cap" style={big} type="number" inputMode="decimal" min="0" value={cap} onChange={e => setCap(e.target.value)} placeholder="battery / power station" />)}
        {fld("eq-w", "Draws (watts)", <input id="eq-w" style={big} type="number" inputMode="decimal" min="0" value={watts} onChange={e => setWatts(e.target.value)} placeholder="fridge, radio…" />)}
        {fld("eq-h", "Hours per day", <input id="eq-h" style={big} type="number" inputMode="decimal" min="0" max="24" value={hours} onChange={e => setHours(e.target.value)} placeholder="24" />)}
      </div>
      <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "15px" }}><input type="checkbox" checked={essential} onChange={e => setEssential(e.target.checked)} style={{ width: "20px", height: "20px" }} /> We would run this on backup power (essential)</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
        {fld("eq-bb", "Best before / replace by", <input id="eq-bb" style={big} type="date" value={bb} onChange={e => setBb(e.target.value)} />)}
        {fld("eq-code", "Barcode", <input id="eq-code" style={big} inputMode="numeric" value={barcode} onChange={e => setBarcode(e.target.value)} />)}
        {fld("eq-where", "Where it is", <input id="eq-where" style={big} value={where} onChange={e => setWhere(e.target.value)} placeholder="hall closet" />)}
      </div>
      {fld("eq-notes", "Notes", <input id="eq-notes" style={big} value={notes} onChange={e => setNotes(e.target.value)} />)}
      {err && <div role="alert" style={{ color: C.red }}>{err}</div>}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button type="submit" style={primaryBtn} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" style={quietBtn} onClick={onCancel}>Cancel</button>
        {onDelete && <button type="button" style={{ ...quietBtn, color: C.red, marginLeft: "auto" }} onClick={() => { if (window.confirm(`Remove ${name || "this item"}?`)) void onDelete(); }}>Remove</button>}
      </div>
    </form>
  );
}

function Card({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderLeft: accent ? `3px solid ${accent}` : `1px solid ${C.border}`, borderRadius: "10px", padding: "14px 16px" }}>{children}</div>;
}
