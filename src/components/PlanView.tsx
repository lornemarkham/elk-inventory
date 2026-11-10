import { C } from "../styles";
import { formatDay } from "../lib/pantryModel";
import { EQUIPMENT_CATEGORIES, PLAN_FIELDS, type PlanSnapshot } from "../lib/preparedModel";

// ── The printable emergency plan ───────────────────────────────────────────────
// Pure display of a PlanSnapshot (so the live screen and the offline copy look
// identical). Black-on-white sheet; print CSS hides the app chrome.

const nf = (n: number) => n.toLocaleString("en-CA");

export default function PlanView({ plan, savedAt, offline }: { plan: PlanSnapshot; savedAt?: string; offline?: boolean }) {
  const h = plan.household;
  const catLabel = (id: string) => EQUIPMENT_CATEGORIES.find(c => c.id === id)?.label ?? id;
  const filled = PLAN_FIELDS.filter(f => plan.info[f.key]?.trim());
  return (
    <div className="plan-sheet" data-testid="plan-sheet">
      <style>{PLAN_CSS}</style>
      <header>
        <h1>Household emergency plan</h1>
        <div className="muted">
          {h.people} {h.people === 1 ? "person" : "people"}{h.pets > 0 ? `, ${h.pets} ${h.pets === 1 ? "pet" : "pets"}` : ""} · plan for {h.days} days ·
          figures as of {formatDay(plan.generatedOn)}
          {offline && savedAt ? ` · saved copy from ${new Date(savedAt).toLocaleString("en-CA")}` : ""}
        </div>
      </header>

      <section>
        <h2>How long we would last</h2>
        <table>
          <thead><tr><th>What</th><th>Have</th><th>Need for {h.days} days</th><th>Lasts</th></tr></thead>
          <tbody>
            {plan.covers.filter(c => c.applies).map(c => (
              <tr key={c.kind} className={c.meetsTarget ? "" : "short"}>
                <td>{c.label}</td>
                <td>{nf(c.have)} {c.unit}</td>
                <td>{nf(c.required)} {c.unit}</td>
                <td><b>{c.days} days</b>{c.meetsTarget ? "" : ` — short ${nf(c.shortfall)} ${c.unit}`}</td>
              </tr>
            ))}
            <tr className={plan.power.days !== null && plan.power.days >= 1 ? "" : "short"}>
              <td>Backup power</td>
              <td>{nf(plan.power.usableWh)} Wh usable</td>
              <td>{nf(plan.power.dailyWh)} Wh/day (essentials)</td>
              <td>{plan.power.days === null ? <i>{plan.power.note ?? "no estimate"}</i> : <b>{plan.power.days} days</b>}</td>
            </tr>
          </tbody>
        </table>
        <div className="muted">Counts only food and water still within best-before. Power is an estimate with no recharging.</div>
      </section>

      {filled.length > 0 && (
        <section>
          <h2>Our plan</h2>
          <dl>
            {filled.map(f => (<div key={f.key} className="field"><dt>{f.label}</dt><dd>{plan.info[f.key]}</dd></div>))}
          </dl>
        </section>
      )}

      <section>
        <h2>Equipment</h2>
        {plan.equipment.length === 0 ? <p className="muted">None listed.</p> : (
          <table>
            <thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Where</th><th>Best before</th></tr></thead>
            <tbody>
              {plan.equipment.map((e, i) => (
                <tr key={i}>
                  <td>{e.name}{e.capacityWh ? ` (${nf(e.capacityWh)} Wh)` : ""}</td><td>{catLabel(e.category)}</td><td>{e.quantity}</td>
                  <td>{e.location || "—"}</td><td>{e.bestBefore ? formatDay(e.bestBefore) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {plan.replace.length > 0 && (
        <section>
          <h2>To buy or replace</h2>
          <ul>{plan.replace.map((r, i) => <li key={i}><b>{r.name}</b> — {r.note}</li>)}</ul>
        </section>
      )}

      <footer className="muted" style={{ color: C.textDim }}>Update this on the Prepared page in ELK; print a new copy after changes.</footer>
    </div>
  );
}

export const PLAN_CSS = `
.plan-sheet { background: #fff; color: #111; max-width: 820px; margin: 0 auto; padding: 18px 20px; border-radius: 6px; font-family: system-ui, sans-serif; }
.plan-sheet h1 { font-size: 22px; margin: 0 0 4px; }
.plan-sheet h2 { font-size: 16px; margin: 18px 0 6px; padding-bottom: 2px; border-bottom: 2px solid #111; break-after: avoid; }
.plan-sheet .muted { font-size: 12px; color: #444; margin-top: 4px; }
.plan-sheet table { width: 100%; border-collapse: collapse; font-size: 13px; }
.plan-sheet th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #111; padding: 3px 4px; }
.plan-sheet td { border-bottom: 1px solid #999; padding: 6px 4px; overflow-wrap: anywhere; }
.plan-sheet tr { break-inside: avoid; }
.plan-sheet tr.short td { background: #fdecea; }
.plan-sheet dl { margin: 0; } .plan-sheet .field { margin-bottom: 8px; break-inside: avoid; }
.plan-sheet dt { font-weight: 700; font-size: 13px; } .plan-sheet dd { margin: 2px 0 0; white-space: pre-wrap; font-size: 14px; }
.plan-sheet ul { margin: 0; padding-left: 18px; font-size: 13px; }
@media (max-width: 700px) { .plan-sheet { padding: 10px 8px; overflow-x: auto; } .plan-sheet table { min-width: 460px; } }
@media print {
  @page { margin: 12mm; }
  .elk-chrome, .no-print { display: none !important; }
  body, html { background: #fff !important; }
  .elk-root { background: #fff !important; padding: 0 !important; min-height: 0 !important; }
  .elk-main { padding: 0 !important; max-width: none !important; }
  .plan-sheet { max-width: none; padding: 0; border-radius: 0; overflow: visible; }
  .plan-sheet table { min-width: 0; }
  .plan-sheet tr.short td { background: none; font-weight: 600; }
}
`;
