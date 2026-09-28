// ── NPI demo — shared research runner (TEMPORARY DEMO) ────────────────────────
// One store for every provider's research state, so the results list and the
// detail page show the same live progress and "Research nearest 5" can run
// several at once.
import { useSyncExternalStore } from "react";
import { fetchView, loadResearch, saveResearch, streamResearch, type SearchContext } from "./api";
import type { ReferralView } from "./types";

export interface ResearchState {
  stage: "idle" | "research" | "extract" | "score" | "done" | "error";
  found: { url: string; title: string; domain: string }[];
  queries: string[];
  view: ReferralView | null; // research-scored view for the current search context
  error: string | null;
  code: "locked" | "rate_limited" | null;
  startedAt: number | null;
}

const IDLE: ResearchState = { stage: "idle", found: [], queries: [], view: null, error: null, code: null, startedAt: null };
const states = new Map<string, ResearchState>();
const listeners = new Set<() => void>();
const aborts = new Map<string, AbortController>();

const ctxKey = (npi: string, ctx: SearchContext | null) => `${npi}|${ctx ? `${ctx.lat},${ctx.lon},${ctx.radius},${ctx.specialty}` : "-"}`;

function set(key: string, patch: Partial<ResearchState> | ((s: ResearchState) => Partial<ResearchState>)) {
  const cur = states.get(key) ?? IDLE;
  states.set(key, { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) });
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useResearch(npi: string, ctx: SearchContext | null): ResearchState {
  const key = ctxKey(npi, ctx);
  return useSyncExternalStore(subscribe, () => states.get(key) ?? IDLE);
}

export const isRunning = (s: ResearchState) => s.stage === "research" || s.stage === "extract" || s.stage === "score";

// Cached research (from this browser) re-scored for this search context — no AI call.
export async function hydrateCached(npi: string, ctx: SearchContext | null): Promise<void> {
  const key = ctxKey(npi, ctx);
  const cur = states.get(key);
  if (cur && (cur.view || isRunning(cur))) return;
  const cached = loadResearch(npi);
  if (!cached) return;
  try {
    const view = await fetchView(npi, ctx, cached);
    if (view.research) view.research.cached = true;
    set(key, { stage: "done", view });
  } catch { /* leave idle */ }
}

export async function startResearch(npi: string, ctx: SearchContext | null, fresh: boolean): Promise<void> {
  const key = ctxKey(npi, ctx);
  aborts.get(key)?.abort();
  const ac = new AbortController();
  aborts.set(key, ac);
  set(key, { ...IDLE, stage: "research", startedAt: Date.now() });
  let got = false;
  try {
    await streamResearch(npi, ctx, fresh, (e) => {
      if (e.type === "stage") set(key, { stage: e.stage });
      else if (e.type === "sources") set(key, { found: e.sources, queries: e.queries });
      else if (e.type === "result") {
        got = true;
        if (e.view.research) saveResearch(e.view.research);
        set(key, { stage: "done", view: e.view });
      } else if (e.type === "error") set(key, { stage: "error", error: e.message, code: e.code ?? null });
    }, ac.signal);
    if (!got) set(key, (s) => (s.stage === "error" ? {} : { stage: "error", error: "Research ended without a result. Try again." }));
  } catch (err) {
    if ((err as Error).name !== "AbortError") set(key, { stage: "error", error: "Couldn't reach the research service. NPI and licence data are unaffected." });
  }
}
