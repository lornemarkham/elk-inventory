import { Link } from "react-router-dom";
import { C } from "../styles";
import { PLAN_CACHE_KEY, parseCachedPlan } from "../lib/preparedModel";
import PlanView from "./PlanView";

// The last emergency plan this device saw, shown without any network or sign-in
// check (it is only ever as private as the phone it is saved on). Route:
// /prepared/offline — reachable from the sign-in gate when the connection is down.
export default function OfflinePlan() {
  let raw: string | null = null;
  try { raw = localStorage.getItem(PLAN_CACHE_KEY); } catch { /* storage blocked */ }
  const cached = parseCachedPlan(raw);
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, padding: "16px", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="no-print" style={{ maxWidth: "820px", margin: "0 auto 12px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <Link to="/prepared" style={{ color: C.amber }}>← Back to ELK</Link>
        {cached && <button onClick={() => window.print()} style={{ background: C.amber, border: "none", borderRadius: "8px", padding: "10px 14px", fontSize: "16px", fontWeight: 800 }}>🖨 Print</button>}
        <span style={{ color: C.textMid, fontSize: "13px" }}>Saved copy — may be out of date.</span>
      </div>
      {cached ? <PlanView plan={cached.plan} savedAt={cached.savedAt} offline /> : (
        <div style={{ maxWidth: "820px", margin: "0 auto", color: C.textMid }}>No emergency plan is saved on this device yet. Open Prepared → Emergency plan once while online and one will be kept here.</div>
      )}
    </div>
  );
}
