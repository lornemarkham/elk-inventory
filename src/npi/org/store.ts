// ── Shared Organizational Knowledge POC — demo persistence ──
// SIMULATED SHARED STORE: the organization's evidence log, policy and demo clock
// live in this browser's localStorage (shared by every tab of this browser, synced
// via the storage event). The viewing context (corporate / clinic) and the selected
// provider are per tab (sessionStorage), so two windows can sit side by side as
// Seattle North and Seattle South. A real product would keep the log server-side.
import { useCallback, useEffect, useState } from "react";
import { initialState, type DemoState } from "./seed";

const KEY = "npi-org-poc/v1";
const TAB = "npi-org-poc/tab";

type Shared = Pick<DemoState, "version" | "log" | "policy" | "policyLog" | "clock">;
type Tab = Pick<DemoState, "context" | "selected">;

function readShared(): Shared {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Shared;
      if (s.version === 1 && Array.isArray(s.log)) return s;
    }
  } catch { /* fall through to a fresh seed */ }
  const { context: _c, selected: _s, ...shared } = initialState();
  return shared;
}
function readTab(): Tab {
  try {
    const raw = sessionStorage.getItem(TAB);
    if (raw) return JSON.parse(raw) as Tab;
  } catch { /* ignore */ }
  const { context, selected } = initialState();
  return { context, selected };
}

export function useDemoState(): [DemoState, (next: DemoState | ((s: DemoState) => DemoState)) => void] {
  const [state, setState] = useState<DemoState>(() => ({ ...readShared(), ...readTab() }));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setState((s) => ({ ...s, ...readShared() })); };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((next: DemoState | ((s: DemoState) => DemoState)) => {
    setState((prev) => {
      const s = typeof next === "function" ? next(prev) : next;
      const { context, selected, ...shared } = s;
      localStorage.setItem(KEY, JSON.stringify(shared));
      sessionStorage.setItem(TAB, JSON.stringify({ context, selected }));
      return s;
    });
  }, []);
  return [state, update];
}
