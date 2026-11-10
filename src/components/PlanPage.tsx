import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { InventoryItem } from "../types/inventory";
import { C } from "../styles";
import * as pantryDb from "../lib/pantryDb";
import * as prepDb from "../lib/preparedDb";
import type { PreparedLoad } from "../lib/preparedDb";
import type { PantryLoad } from "../lib/pantryDb";
import { localToday } from "../lib/pantryModel";
import { PLAN_CACHE_KEY, PLAN_FIELDS, allCover, buildPlan, powerEstimate, stockLines, type PlanInfo } from "../lib/preparedModel";
import PlanView from "./PlanView";

// ── Emergency plan (shared, printable, readable offline) ───────────────────────
// The plan text is stored for the whole household (prepared_plan); the numbers
// are worked out from the live Pantry. Each time it loads, a copy is kept on
// this device so /prepared/offline can still show it with no connection.

const field: React.CSSProperties = { fontSize: "16px", padding: "10px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.bgInput, color: C.text, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
const btn: React.CSSProperties = { background: C.amber, color: "#1c1a17", border: "none", borderRadius: "8px", padding: "11px 16px", fontSize: "16px", fontWeight: 800, cursor: "pointer" };
const quiet: React.CSSProperties = { background: "transparent", color: C.textMid, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "10px 14px", fontSize: "15px", cursor: "pointer" };

export default function PlanPage({ items }: { items: InventoryItem[] }) {
  const [prep, setPrep] = useState<PreparedLoad | null>(null);
  const [pantry, setPantry] = useState<PantryLoad | null>(null);
  const [draft, setDraft] = useState<PlanInfo | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([prepDb.loadPrepared(), pantryDb.loadPantry()]).then(([p, pa]) => { if (live) { setPrep(p); setPantry(pa); } });
    return () => { live = false; };
  }, []);

  const ready = prep?.status === "ready" ? prep : null;
  const today = localToday();
  const plan = useMemo(() => {
    if (!ready) return null;
    const lots = pantry?.status === "ready" ? pantry.lots : [];
    const covers = allCover(ready.household, stockLines(items, lots, ready.household, today));
    return buildPlan(ready.household, covers, powerEstimate(ready.equipment), ready.equipment, ready.info, today);
  }, [ready, pantry, items, today]);

  useEffect(() => {
    if (plan && pantry?.status === "ready") {
      try { localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), plan })); } catch { /* ignore */ }
    }
  }, [plan, pantry]);

  if (!prep || !pantry) return <div style={{ padding: "40px 0", textAlign: "center", color: C.textDim }}>Loading…</div>;
  if (!ready || !plan) {
    return (
      <div style={{ maxWidth: "820px", margin: "0 auto", color: C.textMid }}>
        {prep.status === "not-set-up" ? "Prepared isn't switched on yet (supabase-prepared.sql)." : prep.status === "error" ? `Couldn't load the plan: ${prep.error}.` : ""}{" "}
        <Link to="/prepared/offline" style={{ color: C.amber }}>Open the saved copy on this device</Link>
      </div>
    );
  }

  async function save() {
    const r = await prepDb.savePlanInfo(Object.fromEntries(Object.entries(draft ?? {}).filter(([, v]) => v && v.trim())) as PlanInfo);
    if (r.ok) { setMsg({ text: "Saved for the whole household." }); setEditing(false); setPrep(await prepDb.loadPrepared()); }
    else setMsg({ text: r.error, error: true });
  }

  return (
    <div style={{ display: "grid", gap: "14px", maxWidth: "820px", margin: "0 auto" }}>
      <div className="no-print" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <Link to="/prepared" style={{ ...quiet, textDecoration: "none" }}>← Prepared</Link>
        <button style={quiet} onClick={() => { setDraft({ ...ready.info }); setEditing(e => !e); }}>{editing ? "Close editor" : "Edit plan text"}</button>
        <button style={btn} onClick={() => window.print()}>🖨 Print</button>
        <span style={{ color: C.textMid, fontSize: "13px" }}>Shared with the household · a copy is kept on this device for offline use.</span>
      </div>
      {msg && <div className="no-print" role="status" style={{ color: msg.error ? C.red : C.green }}>{msg.text}</div>}
      {pantry.status !== "ready" && <div className="no-print" style={{ color: C.amber }}>Pantry batches couldn't be read, so food and water figures use plain quantities, and this copy is not saved for offline.</div>}
      {editing && draft && (
        <div className="no-print" style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "14px 16px", display: "grid", gap: "10px" }}>
          {PLAN_FIELDS.map(f => (
            <div key={f.key}>
              <label htmlFor={`plan-${f.key}`} style={{ display: "block", fontSize: "13px", color: C.textMid, marginBottom: "4px" }}>{f.label}{f.hint ? ` — ${f.hint}` : ""}</label>
              <textarea id={`plan-${f.key}`} rows={3} maxLength={2000} style={field} value={draft[f.key] ?? ""} onChange={e => setDraft({ ...draft, [f.key]: e.target.value })} />
            </div>
          ))}
          <div><button style={btn} onClick={() => void save()}>Save for everyone</button></div>
        </div>
      )}
      <PlanView plan={plan} />
    </div>
  );
}
