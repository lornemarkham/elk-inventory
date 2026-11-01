import { useEffect, useMemo, useState } from "react";
import type { InventoryItem } from "../types/inventory";
import { ZONES } from "../data/zones";
import { C } from "../styles";
import * as pantryDb from "../lib/pantryDb";
import type { ShoppingItem } from "../lib/pantryDb";
import type { StockLot } from "../lib/pantryModel";
import { formatDay } from "../lib/pantryModel";
import { buildPrintSections, type PrintScope } from "../lib/printModel";

// ── Printable inventory ────────────────────────────────────────────────────────
// A paper copy grouped by storage place: quantity, best-before, and blank
// columns to pencil in changes. Doubles as an offline backup. Print CSS hides
// the app chrome (.elk-chrome) and puts black-on-white sheets on the page.

const BLANK_ROWS = 3;

export default function PrintPage({ items }: { items: InventoryItem[] }) {
  const [scope, setScope] = useState<PrintScope>("food");
  const [lots, setLots] = useState<StockLot[] | null>(null);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const [p, sh] = await Promise.all([pantryDb.loadPantry(), pantryDb.loadShopping()]);
      if (!live) return;
      if (p.status === "ready") setLots(p.lots);
      else {
        setLots([]);
        setNote(p.status === "not-set-up"
          ? "Pantry batches aren't switched on yet, so food shows the plain count and has no best-before dates."
          : `Couldn't read the pantry batches (${p.error}). Food shows plain counts.`);
      }
      if (sh.status === "ready") setShopping(sh.items.filter(i => !i.doneAt));
    })();
    return () => { live = false; };
  }, []);

  const sections = useMemo(() => buildPrintSections(items, lots ?? [], ZONES, scope), [items, lots, scope]);
  const printed = new Date();
  const printedOn = formatDay(`${printed.getFullYear()}-${String(printed.getMonth() + 1).padStart(2, "0")}-${String(printed.getDate()).padStart(2, "0")}`);
  const lines = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div>
      <style>{PRINT_CSS}</style>

      <div className="no-print" style={{ maxWidth: "820px", margin: "0 auto 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 800 }}>Print inventory</h2>
        <p style={{ margin: 0, color: C.textMid, fontSize: "15px" }}>
          One sheet per storage place, with blank columns to write changes in pencil. Type the changes into
          the app afterwards, or keep the paper as a backup.
        </p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <div role="group" aria-label="What to print" style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: "8px", overflow: "hidden" }}>
            {([["food", "Food"], ["all", "Everything"]] as const).map(([v, label]) => (
              <button key={v} aria-pressed={scope === v} onClick={() => setScope(v)} style={{
                padding: "12px 18px", fontSize: "16px", border: "none", cursor: "pointer",
                background: scope === v ? C.amber : "transparent", color: scope === v ? "#1c1a17" : C.textMid, fontWeight: scope === v ? 800 : 400,
              }}>{label}</button>
            ))}
          </div>
          <button onClick={() => window.print()} disabled={lots === null} style={{
            background: C.amber, color: "#1c1a17", border: "none", borderRadius: "8px", padding: "12px 20px", fontSize: "16px", fontWeight: 800, cursor: "pointer",
          }}>🖨 Print</button>
        </div>
        {note && <div style={{ color: C.amber, fontSize: "14px" }}>{note}</div>}
      </div>

      {lots === null ? (
        <div className="no-print" style={{ textAlign: "center", padding: "40px 0", color: C.textDim }}>Getting the latest counts…</div>
      ) : (
        <div className="sheet" data-testid="print-sheet">
          <header className="sheet-head">
            <h1>ELK {scope === "food" ? "Pantry" : "Inventory"} — count sheet</h1>
            <div>Printed {printedOn} · {lines} lines · counted by ____________________ on ____ / ____ / ________</div>
          </header>

          {sections.length === 0 && <p>Nothing to list.</p>}

          {sections.map(sec => (
            <section key={sec.place} className="place">
              <h2>{sec.place}</h2>
              <table>
                <thead>
                  <tr>
                    <th className="c-item">Item</th>
                    <th className="c-qty">Qty</th>
                    <th className="c-date">Best before</th>
                    <th className="c-blank">Counted</th>
                    <th className="c-blank">+ / −</th>
                    <th className="c-note">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {sec.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="c-item">{r.name}{r.detail && <small> — {r.detail}</small>}</td>
                      <td className="c-qty">{r.quantity}</td>
                      <td className="c-date">{r.bestBefore ? formatDay(r.bestBefore) : ""}</td>
                      <td /><td /><td />
                    </tr>
                  ))}
                  {Array.from({ length: BLANK_ROWS }, (_, i) => (
                    <tr key={`b${i}`} className="spare"><td /><td /><td /><td /><td /><td /></tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}

          <section className="place">
            <h2>Shopping list</h2>
            <table>
              <thead><tr><th className="c-tick">Got</th><th className="c-item">Item</th><th className="c-note">Notes</th></tr></thead>
              <tbody>
                {shopping.map(s => (
                  <tr key={s.id}><td className="c-tick">☐</td><td className="c-item">{s.name}</td><td className="c-note">{s.note ?? ""}</td></tr>
                ))}
                {Array.from({ length: 5 }, (_, i) => (
                  <tr key={`s${i}`} className="spare"><td className="c-tick">☐</td><td /><td /></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}

const PRINT_CSS = `
.sheet { background: #fff; color: #111; max-width: 820px; margin: 0 auto; padding: 18px 20px; border-radius: 6px; font-family: system-ui, sans-serif; }
.sheet h1 { font-size: 20px; margin: 0 0 4px; }
.sheet-head { margin-bottom: 14px; font-size: 13px; color: #333; }
.place { margin-bottom: 18px; break-inside: auto; }
.place h2 { font-size: 16px; margin: 0 0 4px; padding-bottom: 2px; border-bottom: 2px solid #111; break-after: avoid; }
.sheet table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
.sheet thead { display: table-header-group; }
.sheet th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #111; padding: 3px 4px; }
.sheet td { border-bottom: 1px solid #999; padding: 6px 4px; height: 26px; vertical-align: bottom; overflow-wrap: anywhere; }
.sheet tr { break-inside: avoid; }
.sheet small { color: #444; }
.sheet .c-qty { width: 14%; } .sheet .c-date { width: 16%; } .sheet .c-blank { width: 11%; border-left: 1px solid #999; }
.sheet .c-note { width: 20%; border-left: 1px solid #999; } .sheet .c-tick { width: 8%; text-align: center; }
.sheet td.c-qty { font-weight: 700; }
@media (max-width: 700px) { .sheet { padding: 10px 8px; overflow-x: auto; } .sheet table { min-width: 560px; } }
@media print {
  @page { margin: 12mm; }
  .elk-chrome, .no-print { display: none !important; }
  body, html { background: #fff !important; }
  .elk-root { background: #fff !important; padding: 0 !important; min-height: 0 !important; }
  .elk-main { padding: 0 !important; max-width: none !important; }
  .sheet { max-width: none; padding: 0; border-radius: 0; overflow: visible; }
  .sheet table { min-width: 0; }
  .place { break-inside: auto; }
}
`;
