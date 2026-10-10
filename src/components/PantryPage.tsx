import { useEffect, useMemo, useState } from "react";
import type { InventoryItem } from "../types/inventory";
import { C } from "../styles";
import * as pantryDb from "../lib/pantryDb";
import type { PantryLoad } from "../lib/pantryDb";
import {
  countLabel, daysUntil, findProductByName, formatDay, isPantryItem, localToday, summarize, unitOf,
  type PantrySummary, type StockLot, type StockMovement,
} from "../lib/pantryModel";

// ── Pantry ─────────────────────────────────────────────────────────────────────
// Phone-first screen for food stock: I bought something → where it went →
// what's left → use the oldest first → running low. Every change goes through
// the pantry_* SQL functions (see supabase-pantry.sql) and is kept as history.

interface Props {
  items: InventoryItem[];
  /** Re-read inventory_items after the database changed a count. */
  onItemsChanged: () => Promise<void>;
}

type Toast = { text: string; undoBatch?: string; error?: boolean } | null;

const big: React.CSSProperties = {
  fontSize: "16px",            // ≥16px stops iOS zooming into inputs
  padding: "12px 14px",
  borderRadius: "8px",
  border: `1px solid ${C.border}`,
  background: C.bgInput,
  color: C.text,
  width: "100%",
};

const primaryBtn: React.CSSProperties = {
  background: C.amber, color: "#1c1a17", border: "none", borderRadius: "8px",
  padding: "12px 18px", fontSize: "16px", fontWeight: 800, cursor: "pointer",
};

const quietBtn: React.CSSProperties = {
  background: "transparent", color: C.textMid, border: `1px solid ${C.border}`, borderRadius: "8px",
  padding: "10px 14px", fontSize: "15px", cursor: "pointer",
};

export default function PantryPage({ items, onItemsChanged }: Props) {
  const [load, setLoad] = useState<PantryLoad | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [search, setSearch] = useState("");
  const [undoing, setUndoing] = useState(false);

  async function reload() {
    setLoad(await pantryDb.loadPantry());
  }
  useEffect(() => { reload(); }, []);

  // After any write: refresh lots/history here and item counts app-wide.
  async function afterWrite() {
    await Promise.all([reload(), onItemsChanged()]);
  }

  const pantryItems = useMemo(() => items.filter(isPantryItem), [items]);
  const lots = load?.status === "ready" ? load.lots : [];
  const summaries = useMemo(
    () => pantryItems.map(i => summarize(i, lots)).sort((a, b) => a.item.name.localeCompare(b.item.name)),
    [pantryItems, lots],
  );

  if (!load) return <Centered>Loading pantry…</Centered>;

  if (load.status === "not-set-up") {
    return (
      <Card>
        <h2 style={{ margin: "0 0 8px", fontSize: "20px" }}>Pantry isn't switched on yet</h2>
        <p style={{ margin: 0, color: C.textMid, lineHeight: 1.6 }}>
          The pantry needs a one-time database setup before it can save anything.
          Nothing has been changed. (For Lorne: run <code>supabase-family-access.sql</code>, add the family, then run <code>supabase-pantry.sql</code> — see docs/family-access.md.)
        </p>
      </Card>
    );
  }
  if (load.status === "error") {
    return (
      <Card>
        <h2 style={{ margin: "0 0 8px", fontSize: "20px" }}>Couldn't load the pantry</h2>
        <p style={{ margin: "0 0 14px", color: C.textMid }}>{load.error}</p>
        <button style={quietBtn} onClick={reload}>Try again</button>
      </Card>
    );
  }

  const q = search.trim().toLowerCase();
  const visible = q ? summaries.filter(s => s.item.name.toLowerCase().includes(q)) : summaries;
  const inStock = visible.filter(s => s.onHand > 0);
  const usedUp = visible.filter(s => s.onHand === 0);
  const low = summaries.filter(s => s.isLow);

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 800 }}>Pantry</h2>
        <p style={{ margin: "4px 0 0", color: C.textMid, fontSize: "15px" }}>
          What food we have, where it is, and which to use first.
        </p>
      </div>

      {toast && (
        <div role="status" style={{
          background: toast.error ? "#3a1a12" : "#1f2a16",
          border: `1px solid ${toast.error ? C.red : C.green}`,
          borderRadius: "8px", padding: "12px 14px", display: "flex", gap: "10px", alignItems: "center",
          fontSize: "15px",
        }}>
          <span style={{ flex: 1 }}>{toast.text}</span>
          {toast.undoBatch && (
            <button style={{ ...quietBtn, padding: "6px 12px" }} disabled={undoing} onClick={async () => {
              setUndoing(true);
              const r = await pantryDb.undo(toast.undoBatch!);
              setToast(r.ok ? { text: "Undone." } : { text: r.error, error: true });
              await afterWrite();
              setUndoing(false);
            }}>{undoing ? "Undoing…" : "Undo"}</button>
          )}
          <button aria-label="Dismiss" style={{ ...quietBtn, border: "none", padding: "4px 8px" }} onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {adding ? (
        <AddForm
          pantryItems={pantryItems}
          lots={lots}
          onCancel={() => setAdding(false)}
          onDone={async (text, batch) => { setAdding(false); setToast({ text, undoBatch: batch }); await afterWrite(); }}
        />
      ) : (
        <button style={{ ...primaryBtn, padding: "16px", fontSize: "18px" }} onClick={() => { setAdding(true); setToast(null); }}>
          ＋ I bought something
        </button>
      )}

      {low.length > 0 && (
        <Card accent={C.amber}>
          <div style={{ fontWeight: 800, color: C.amber, marginBottom: "6px" }}>Running low</div>
          {low.map(s => (
            <div key={s.item.id} style={{ fontSize: "15px", padding: "2px 0" }}>
              {s.item.name} — {countLabel(s.onHand, s.unit)} left
            </div>
          ))}
        </Card>
      )}

      {summaries.length > 6 && (
        <input style={big} placeholder="Find something…" value={search} onChange={e => setSearch(e.target.value)} />
      )}

      {inStock.map(s => (
        <ProductCard key={s.item.id} s={s} load={load}
          onToast={setToast} afterWrite={afterWrite} />
      ))}

      {inStock.length === 0 && !q && (
        <Card><span style={{ color: C.textMid }}>Nothing recorded yet. Tap “I bought something” to start.</span></Card>
      )}

      {usedUp.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", color: C.textMid, padding: "6px 0", fontSize: "15px" }}>
            Used up ({usedUp.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
            {usedUp.map(s => (
              <ProductCard key={s.item.id} s={s} load={load} onToast={setToast} afterWrite={afterWrite} />
            ))}
          </div>
        </details>
      )}

      <FeedbackBox />
    </div>
  );
}

// ── One product ────────────────────────────────────────────────────────────────

function ProductCard({ s, load, onToast, afterWrite }: {
  s: PantrySummary;
  load: Extract<PantryLoad, { status: "ready" }>;
  onToast: (t: Toast) => void;
  afterWrite: () => Promise<void>;
}) {
  const [using, setUsing] = useState<{ lot: StockLot | null } | null>(null);
  const [open, setOpen] = useState(false);
  const today = localToday();
  const first = s.useFirst;
  const bb = first?.bestBefore ? daysUntil(first.bestBefore, today) : null;

  return (
    <Card accent={s.isLow ? C.amber : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "baseline" }}>
        <div style={{ fontSize: "18px", fontWeight: 800 }}>{s.item.name}</div>
        <div style={{ fontSize: "20px", fontWeight: 800, whiteSpace: "nowrap", color: s.onHand === 0 ? C.textDim : C.text }}>
          {countLabel(s.onHand, s.unit)}
        </div>
      </div>

      <div style={{ color: C.textMid, fontSize: "15px", marginTop: "6px", lineHeight: 1.5 }}>
        {s.untracked ? (
          <>{s.item.locationDetail ? `${s.item.locationDetail} · ` : ""}No dates recorded yet</>
        ) : first ? (
          <>
            <strong style={{ color: C.text }}>Use first:</strong>{" "}
            {s.openLots.length > 1 ? `${countLabel(first.quantityRemaining, s.unit)} ` : ""}
            {first.location ? `on ${first.location}` : "location not recorded"}
            {s.openLots.length > 1 && !first.purchasedOn && " (here the longest)"}
            {first.bestBefore && (
              <span style={{ color: bb! < 0 ? C.red : bb! <= 30 ? C.amber : C.textMid }}>
                {" "}· {bb! < 0 ? "best before passed" : "best before"} {formatDay(first.bestBefore)}
              </span>
            )}
          </>
        ) : null}
      </div>

      {s.isLow && (
        <div style={{ color: C.amber, fontSize: "14px", marginTop: "4px", fontWeight: 700 }}>
          Running low (you asked to be warned at {s.lowStockAt})
        </div>
      )}
      {s.newerExpiresSooner && (
        <div style={{ color: C.amber, fontSize: "14px", marginTop: "4px" }}>
          Heads up: a newer batch ({s.newerExpiresSooner.location || "no location"}) has an earlier best-before
          date — {formatDay(s.newerExpiresSooner.bestBefore!)}. Open “Details” to use from it instead.
        </div>
      )}

      {using ? (
        <UseControl
          s={s}
          lot={using.lot}
          onCancel={() => setUsing(null)}
          onDone={async (text, batch) => { setUsing(null); onToast({ text, undoBatch: batch }); await afterWrite(); }}
          onError={text => onToast({ text, error: true })}
        />
      ) : (
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          {s.onHand > 0 && (
            <button style={{ ...primaryBtn, flex: 1 }} onClick={() => setUsing({ lot: null })}>Use some</button>
          )}
          <button style={{ ...quietBtn, flex: s.onHand > 0 ? undefined : 1 }} onClick={() => setOpen(o => !o)}>
            {open ? "Hide details" : "Details"}
          </button>
        </div>
      )}

      {open && <Details s={s} load={load} onUseFromLot={lot => { setUsing({ lot }); setOpen(false); }}
        onToast={onToast} afterWrite={afterWrite} />}
    </Card>
  );
}

function UseControl({ s, lot, onCancel, onDone, onError }: {
  s: PantrySummary;
  lot: StockLot | null;
  onCancel: () => void;
  onDone: (text: string, batch: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  const max = lot ? lot.quantityRemaining : s.onHand;
  const [n, setN] = useState(1);
  const [busy, setBusy] = useState(false);
  // Same id for retries of this one action, so a double-tap or a retry after
  // a dropped connection can't take things out twice.
  const [requestId] = useState(() => crypto.randomUUID());

  async function submit() {
    setBusy(true);
    const r = await pantryDb.use(s.item.id, n, lot?.id ?? null, requestId);
    setBusy(false);
    if (!r.ok) { onError(r.error); return; }
    await onDone(`Took out ${countLabel(n, s.unit)} of ${s.item.name}.`, r.value);
  }

  const step: React.CSSProperties = { ...quietBtn, width: "52px", height: "52px", fontSize: "24px", padding: 0 };
  return (
    <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ color: C.textMid, fontSize: "14px" }}>
        {lot
          ? `From the batch on ${lot.location || "(no location)"}${lot.bestBefore ? `, best before ${formatDay(lot.bestBefore)}` : ""}`
          : "Takes from the oldest first"}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button style={step} aria-label="One less" disabled={n <= 1} onClick={() => setN(v => Math.max(1, v - 1))}>−</button>
        <input aria-label="How many" type="number" inputMode="numeric" min={1} max={max}
          style={{ ...big, width: "76px", fontSize: "22px", fontWeight: 800, textAlign: "center", padding: "10px 4px" }}
          value={n} onChange={e => setN(Math.min(max, Math.max(1, parseInt(e.target.value, 10) || 1)))} />
        <button style={step} aria-label="One more" disabled={n >= max} onClick={() => setN(v => Math.min(max, v + 1))}>+</button>
        <span style={{ color: C.textMid }}>of {max}</span>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button style={{ ...primaryBtn, flex: 1, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
          {busy ? "Saving…" : `Take out ${countLabel(n, s.unit)}`}
        </button>
        <button style={quietBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Details: batches, warning level, history ─────────────────────────────────

function Details({ s, load, onUseFromLot, onToast, afterWrite }: {
  s: PantrySummary;
  load: Extract<PantryLoad, { status: "ready" }>;
  onUseFromLot: (lot: StockLot) => void;
  onToast: (t: Toast) => void;
  afterWrite: () => Promise<void>;
}) {
  const [level, setLevel] = useState(s.lowStockAt === null ? "" : String(s.lowStockAt));
  const history = groupHistory(load.movements.filter(m => m.itemId === s.item.id)).slice(0, 10);
  const sub: React.CSSProperties = { fontSize: "13px", color: C.textDim, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, margin: "14px 0 6px" };

  async function saveLevel() {
    const v = level.trim() === "" ? null : Math.max(0, parseInt(level, 10));
    if (v !== null && Number.isNaN(v)) return;
    const r = await pantryDb.setLowStock(s.item.id, v);
    onToast(r.ok
      ? { text: v === null ? `No low-stock warning for ${s.item.name}.` : `Will warn when ${s.item.name} is down to ${v}.` }
      : { text: r.error, error: true });
    if (r.ok) await afterWrite();
  }

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: "12px" }}>
      <div style={sub}>Batches (oldest first)</div>
      {s.untracked && (
        <div style={{ color: C.textMid, fontSize: "14px" }}>
          The {countLabel(s.onHand, s.unit)} already here will be kept as one batch with no date the first time you add or use some.
        </div>
      )}
      {s.openLots.map((l, i) => (
        <div key={l.id} style={{ padding: "8px 0", borderBottom: `1px solid ${C.borderLo}`, fontSize: "15px" }}>
          <div>
            <strong>{countLabel(l.quantityRemaining, s.unit)}</strong>
            <span style={{ color: C.textDim }}> of {l.quantityReceived}</span>
            {" · "}{l.location || "no location"}
            {i === 0 && <span style={{ color: C.green, fontWeight: 700 }}> · use first</span>}
          </div>
          <div style={{ color: C.textMid, fontSize: "14px" }}>
            {l.bestBefore ? `Best before ${formatDay(l.bestBefore)}` : "No best-before date"}
            {" · "}
            {l.purchasedOn ? `bought ${formatDay(l.purchasedOn)}` : "already here before tracking"}
          </div>
          {s.openLots.length > 1 && (
            <button style={{ ...quietBtn, marginTop: "6px", padding: "6px 10px", fontSize: "14px" }} onClick={() => onUseFromLot(l)}>
              Use from this batch
            </button>
          )}
        </div>
      ))}

      <div style={sub}>Warn me when down to</div>
      <div style={{ display: "flex", gap: "8px" }}>
        <input style={{ ...big, width: "100px" }} inputMode="numeric" type="number" min={0}
          placeholder="—" value={level} onChange={e => setLevel(e.target.value)} />
        <button style={quietBtn} onClick={saveLevel}>Save</button>
      </div>

      <div style={sub}>History</div>
      {history.length === 0 && <div style={{ color: C.textMid, fontSize: "14px" }}>Nothing yet.</div>}
      {history.map(h => (
        <div key={h.batchId} style={{ fontSize: "14px", color: C.textMid, padding: "3px 0" }}>
          <span style={{ color: C.textDim }}>{shortWhen(h.createdAt)}</span>{" · "}
          {(h.createdBy && load.people[h.createdBy]) || "someone"}{" "}
          {describe(h, s.unit)}
        </div>
      ))}
    </div>
  );
}

interface HistoryEntry { batchId: string; kind: StockMovement["kind"]; total: number; createdAt: string; createdBy: string | null; note: string | null }

// One action can touch several batches; show it as one line.
function groupHistory(moves: StockMovement[]): HistoryEntry[] {
  const byBatch = new Map<string, HistoryEntry>();
  for (const m of moves) {
    const e = byBatch.get(m.batchId);
    if (e) e.total += m.quantityDelta;
    else byBatch.set(m.batchId, { batchId: m.batchId, kind: m.kind, total: m.quantityDelta, createdAt: m.createdAt, createdBy: m.createdBy, note: m.note });
  }
  return [...byBatch.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function describe(h: HistoryEntry, unit: string): string {
  const n = countLabel(Math.abs(h.total), unit);
  switch (h.kind) {
    case "received": return `added ${n}`;
    case "used":     return `took out ${n}`;
    case "undo":     return h.total > 0 ? `put back ${n} (undo)` : `undid adding ${n}`;
    default:         return `${h.total > 0 ? "+" : "−"}${n} — ${h.note ?? "count changed"}`;
  }
}

function shortWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// ── Add: "I bought something" ────────────────────────────────────────────────

function AddForm({ pantryItems, lots, onCancel, onDone }: {
  pantryItems: InventoryItem[];
  lots: StockLot[];
  onCancel: () => void;
  onDone: (text: string, batch: string) => Promise<void>;
}) {
  // Kept for the life of this form so retrying Save can't add twice or make
  // a second copy of a new product.
  const [requestId] = useState(() => crypto.randomUUID());
  const [newItemId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("cans");
  const [location, setLocation] = useState("");
  const [locationTouched, setLocationTouched] = useState(false);
  const [bestBefore, setBestBefore] = useState("");
  const [boughtOn, setBoughtOn] = useState(localToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const existing = findProductByName(pantryItems, name);

  // Suggest where this product usually goes: its newest batch, else the item's own location.
  const usualPlace = useMemo(() => {
    if (!existing) return "";
    const newest = lots.filter(l => l.itemId === existing.id && l.location)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return newest?.location ?? existing.locationDetail ?? "";
  }, [existing, lots]);
  const shownLocation = locationTouched ? location : usualPlace;

  const knownPlaces = useMemo(() => {
    const set = new Set<string>();
    for (const l of lots) if (l.location) set.add(l.location);
    for (const i of pantryItems) if (i.locationDetail) set.add(i.locationDetail);
    return [...set].sort();
  }, [lots, pantryItems]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(qty, 10);
    if (!name.trim()) { setError("What did you buy?"); return; }
    if (!Number.isFinite(n) || n < 1) { setError("How many? Enter a whole number, 1 or more."); return; }
    if (!shownLocation.trim()) { setError("Where did you put it? (e.g. “Pantry, top shelf”)"); return; }
    setError("");
    setBusy(true);
    const r = await pantryDb.receive({
      itemId: existing?.id ?? newItemId,
      quantity: n,
      location: shownLocation.trim(),
      bestBefore: bestBefore || null,
      purchasedOn: boughtOn || localToday(),
      newProduct: existing ? undefined : { name: name.trim(), unit: unit.trim() || "items" },
      requestId,
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    const u = existing ? unitOf(existing) : (unit.trim() || "items");
    await onDone(`Added ${countLabel(n, u)} of ${existing?.name ?? name.trim()} — on ${shownLocation.trim()}.`, r.value);
  }

  const label: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "6px", fontSize: "15px", fontWeight: 700 };
  const hint: React.CSSProperties = { fontWeight: 400, color: C.textMid, fontSize: "14px" };

  return (
    <Card accent={C.amber}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ fontSize: "20px", fontWeight: 800 }}>I bought something</div>

        <label style={label}>
          What is it?
          <input style={big} list="pantry-products" autoComplete="off" placeholder="e.g. Diced Tomatoes"
            value={name} onChange={e => setName(e.target.value)} />
          <datalist id="pantry-products">
            {pantryItems.map(i => <option key={i.id} value={i.name} />)}
          </datalist>
          {name.trim() && (
            <span style={hint}>
              {existing
                ? `Adding to “${existing.name}” (${countLabel(existing.quantity, unitOf(existing))} now).`
                : "New item — it'll be added to the pantry list."}
            </span>
          )}
        </label>

        <div style={{ display: "flex", gap: "10px" }}>
          <label style={{ ...label, flex: 1 }}>
            How many?
            <input style={big} type="number" inputMode="numeric" min={1} step={1} placeholder="12"
              value={qty} onChange={e => setQty(e.target.value)} />
          </label>
          {!existing && (
            <label style={{ ...label, flex: 1 }}>
              Counted in
              <input style={big} list="pantry-units" value={unit} onChange={e => setUnit(e.target.value)} />
              <datalist id="pantry-units">
                {["cans", "jars", "bags", "boxes", "bottles", "packs", "cartons", "loaves"].map(u => <option key={u} value={u} />)}
              </datalist>
            </label>
          )}
        </div>

        <label style={label}>
          Where did you put it?
          <input style={big} list="pantry-places" autoComplete="off" placeholder="e.g. Basement pantry, top shelf"
            value={shownLocation} onChange={e => { setLocation(e.target.value); setLocationTouched(true); }} />
          <datalist id="pantry-places">
            {knownPlaces.map(p => <option key={p} value={p} />)}
          </datalist>
        </label>

        <label style={label}>
          <span>Best before <span style={hint}>(optional — printed on the can)</span></span>
          <input style={big} type="date" value={bestBefore} onChange={e => setBestBefore(e.target.value)} />
        </label>

        <label style={label}>
          Bought on
          <input style={big} type="date" value={boughtOn} max={localToday()} onChange={e => setBoughtOn(e.target.value)} />
        </label>

        {error && <div style={{ color: "#e07a5a", fontSize: "15px" }}>{error}</div>}

        <div style={{ display: "flex", gap: "8px" }}>
          <button type="submit" style={{ ...primaryBtn, flex: 1, opacity: busy ? 0.6 : 1 }} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" style={quietBtn} onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Card>
  );
}

// ── Feedback ─────────────────────────────────────────────────────────────────

function FeedbackBox() {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | { error: string }>("idle");

  async function send() {
    if (!text.trim()) return;
    setState("sending");
    const r = await pantryDb.sendFeedback(text.trim(), window.location.pathname);
    if (r.ok) { setText(""); setState("sent"); } else setState({ error: r.error });
  }

  return (
    <Card>
      <div style={{ fontWeight: 800, marginBottom: "4px" }}>Confusing, missing, or wrong?</div>
      <div style={{ color: C.textMid, fontSize: "14px", marginBottom: "8px" }}>
        Tell us in your own words — anything at all. It goes straight to Lorne.
      </div>
      <textarea style={{ ...big, minHeight: "80px", fontFamily: "inherit" }} value={text}
        placeholder="e.g. I couldn't find where to…" onChange={e => { setText(e.target.value); if (state === "sent") setState("idle"); }} />
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
        <button style={quietBtn} disabled={state === "sending" || !text.trim()} onClick={send}>
          {state === "sending" ? "Sending…" : "Send"}
        </button>
        {state === "sent" && <span style={{ color: C.green }}>Thanks — sent.</span>}
        {typeof state === "object" && <span style={{ color: "#e07a5a" }}>{state.error}</span>}
      </div>
    </Card>
  );
}

// ── Bits ───────────────────────────────────────────────────────────────────────

function Card({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderLeft: accent ? `3px solid ${accent}` : `1px solid ${C.border}`,
      borderRadius: "10px", padding: "14px 16px",
    }}>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ textAlign: "center", padding: "60px 0", color: C.textDim }}>{children}</div>;
}
