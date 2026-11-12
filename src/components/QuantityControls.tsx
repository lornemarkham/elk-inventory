import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { InventoryItem } from "../types/inventory";
import { C } from "../styles";
import * as pantryDb from "../lib/pantryDb";
import { QuantityController, supportsQuantityControls } from "../lib/quantityControls";
import { localToday, unitOf } from "../lib/pantryModel";

// ── One-tap − / + for items that are used up and restocked ─────────────────────
// QuantityProvider owns one QuantityController for the whole app (so Undo and
// the notice survive moving between screens). QuantityStepper is the control;
// QuantityToast is the "9 cans · Undo" / error message.

const Ctx = createContext<QuantityController | null>(null);

const SYNC_MS = 20_000;

export function QuantityProvider({ refresh, children }: {
  refresh: () => Promise<InventoryItem[] | null>;
  children: React.ReactNode;
}) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; });

  const controller = useMemo(
    () => new QuantityController({ ...pantryDb, refresh: () => refreshRef.current() }, localToday),
    [],
  );

  // Other family members' changes: re-read when the app comes back to the
  // front, and every 20 s while it's open — but never mid-tap.
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === "visible" && !controller.busy()) void refreshRef.current();
    };
    const id = window.setInterval(sync, SYNC_MS);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("online", sync);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("online", sync);
    };
  }, [controller]);

  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}

export function useQuantity(): QuantityController {
  const c = useContext(Ctx);
  if (!c) throw new Error("useQuantity needs <QuantityProvider>");
  useSyncExternalStore(c.subscribe, () => c.rev);
  return c;
}

const btn = (disabled: boolean, size: number): React.CSSProperties => ({
  width: `${size}px`, height: `${size}px`, minWidth: `${size}px`,
  borderRadius: "12px", border: `1px solid ${C.border}`,
  background: disabled ? "transparent" : C.bgCard, color: disabled ? C.textDim : C.text,
  fontSize: `${Math.round(size * 0.55)}px`, fontWeight: 800, lineHeight: 1, padding: 0,
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
  touchAction: "manipulation",                 // no double-tap-zoom delay on iPhone/iPad
  WebkitTapHighlightColor: "transparent", userSelect: "none",
});

/** [ − ]  10  [ + ] — renders nothing for tools, equipment and other things that aren't used up. */
export function QuantityStepper({ item, size = 48, showUnit = true }: {
  item: InventoryItem;
  size?: number;
  showUnit?: boolean;
}) {
  const q = useQuantity();
  if (!supportsQuantityControls(item)) return null;
  const n = q.displayQuantity(item);
  const unit = unitOf(item);
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); fn(); };

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}
      role="group" aria-label={`${item.name} quantity`}
    >
      <button type="button" style={btn(n <= 0, size)} aria-label={`One less ${item.name}`}
        aria-disabled={n <= 0} onClick={stop(() => { q.adjust(item, -1); })}>−</button>
      <div aria-live="polite" style={{ minWidth: `${size}px`, textAlign: "center", lineHeight: 1.1 }}>
        <div data-testid="qty" style={{ fontSize: `${Math.round(size * 0.6)}px`, fontWeight: 800, color: n === 0 ? C.textDim : C.text }}>{n}</div>
        {showUnit && <div style={{ fontSize: "12px", color: C.textMid }}>{unit}</div>}
      </div>
      <button type="button" style={btn(false, size)} aria-label={`One more ${item.name}`}
        onClick={stop(() => { q.adjust(item, 1); })}>+</button>
    </div>
  );
}

/** The confirmation line with Undo; fixed to the bottom of the screen, clear of the iPhone home bar. */
export function QuantityToast() {
  const q = useQuantity();
  const n = q.notice;
  useEffect(() => {
    if (!n) return;
    const t = window.setTimeout(q.dismiss, n.error ? 9000 : 7000);
    return () => window.clearTimeout(t);
  }, [n, q]);
  if (!n) return null;
  return (
    <div role={n.error ? "alert" : "status"} style={{
      position: "fixed", left: "12px", right: "12px", bottom: "max(16px, env(safe-area-inset-bottom))",
      maxWidth: "520px", margin: "0 auto", zIndex: 300,
      background: n.error ? "#3a1a12" : "#1f2a16", border: `1px solid ${n.error ? C.red : C.green}`,
      borderRadius: "12px", padding: "10px 12px 10px 16px", display: "flex", gap: "10px", alignItems: "center",
      fontSize: "16px", color: C.text, boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
    }}>
      <span style={{ flex: 1 }}>{n.text}</span>
      {n.canUndo && (
        <button type="button" onClick={() => { void q.undo(); }} style={{
          minHeight: "44px", padding: "0 16px", borderRadius: "10px", border: `1px solid ${C.amber}`,
          background: "transparent", color: C.amber, fontSize: "16px", fontWeight: 800, cursor: "pointer", touchAction: "manipulation",
        }}>Undo</button>
      )}
      <button type="button" aria-label="Dismiss" onClick={q.dismiss} style={{
        minWidth: "44px", minHeight: "44px", border: "none", background: "transparent", color: C.textMid, fontSize: "18px", cursor: "pointer",
      }}>✕</button>
    </div>
  );
}
