import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { C } from "../styles";
import { download, fileFor, loadExportBundle, type ExportKind } from "../lib/exportData";
import type { ExportBundle } from "../lib/exportBundle";

// ── Backup & print ─────────────────────────────────────────────────────────────
// Read-only. Exports everything the signed-in family member can see; restoring
// is a reviewed SQL script (docs/home-pilot/backup-and-restore.md) so the
// history can't be rewritten from the app.

const btn: React.CSSProperties = {
  background: "transparent", color: C.text, border: `1px solid ${C.border}`, borderRadius: "8px",
  padding: "14px 16px", fontSize: "16px", cursor: "pointer", textAlign: "left",
};

export default function BackupPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState("");
  const [last, setLast] = useState<ExportBundle | null>(null);

  async function run(kind: ExportKind) {
    setBusy(kind);
    setError("");
    try {
      const bundle = await loadExportBundle();
      download(fileFor(kind, bundle));
      setLast(bundle);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export failed. Nothing was exported.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 800 }}>Backup & print</h2>
        <p style={{ margin: "4px 0 0", color: C.textMid, fontSize: "15px" }}>
          Keep a copy outside the app. Take one every week during the pilot.
        </p>
      </div>

      <button style={{ ...btn, background: C.amber, color: "#1c1a17", fontWeight: 800 }} disabled={busy !== null} onClick={() => run("everything")}>
        {busy === "everything" ? "Exporting…" : "⬇ Export everything (one file)"}
        <div style={{ fontWeight: 400, fontSize: "14px" }}>
          Items, pantry batches, full movement history, shopping list and storage places. This is the file a restore uses.
        </div>
      </button>

      <button style={btn} data-testid="print-link" onClick={() => navigate("/print")}>
        🖨 Print a count sheet
        <div style={{ color: C.textMid, fontSize: "14px" }}>By storage place, with blank columns to write changes on.</div>
      </button>

      <div style={{ color: C.textDim, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
        For a spreadsheet
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {([["stock", "Stock by batch"], ["history", "History"], ["shopping", "Shopping list"]] as const).map(([k, label]) => (
          <button key={k} style={{ ...btn, flex: "1 1 140px", textAlign: "center" }} disabled={busy !== null} onClick={() => run(k)}>
            {busy === k ? "…" : `${label} (.csv)`}
          </button>
        ))}
      </div>

      {error && <div role="alert" style={{ color: "#e07a5a", fontSize: "15px" }}>{error}</div>}

      {last && (
        <div role="status" style={{ background: "#1f2a16", border: `1px solid ${C.green}`, borderRadius: "8px", padding: "12px 14px", fontSize: "15px" }}>
          Exported {last.counts.inventory_items} items, {last.counts.stock_lots} batches, {last.counts.stock_movements} history
          entries and {last.counts.pantry_shopping_items} shopping entries.
          {last.missingTables.length > 0 && (
            <div style={{ color: C.amber, marginTop: "4px" }}>
              Pantry isn't switched on in the database yet, so batches, history and shopping are empty.
            </div>
          )}
        </div>
      )}

      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "14px 16px", color: C.textMid, fontSize: "14px", lineHeight: 1.6 }}>
        <strong style={{ color: C.text }}>If something goes wrong:</strong> give the export file to Lorne. A restore turns it into a
        SQL script that only adds what's missing and never changes or deletes anything. See{" "}
        <code>docs/home-pilot/backup-and-restore.md</code>.
      </div>
    </div>
  );
}
