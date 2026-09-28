// ── NPI demo — shared research runner (TEMPORARY DEMO) ────────────────────────
// One store for every provider's research state, so the results list and the
// detail page show the same live progress and "Research nearest 5" can run
// several at once.
import { useSyncExternalStore } from "react";
import { discoverCandidate, fetchView, loadResearch, saveResearch, streamResearch, type SearchContext } from "./api";
import type { DiscoveryLog, NearbyResult, ReferralResearch, ReferralView } from "./types";

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

// Non-hook access, for views that list many providers at once.
export const getResearch = (npi: string, ctx: SearchContext | null): ResearchState => states.get(ctxKey(npi, ctx)) ?? IDLE;
export { subscribe as subscribeResearch };

export const isRunning = (s: ResearchState) => s.stage === "research" || s.stage === "extract" || s.stage === "score";

// Cached research (from this browser, else a saved result passed in) re-scored
// for this search context — no AI call.
export async function hydrateCached(npi: string, ctx: SearchContext | null, saved: ReferralResearch | null = null): Promise<void> {
  const key = ctxKey(npi, ctx);
  const cur = states.get(key);
  if (cur && (cur.view || isRunning(cur))) return;
  const cached = loadResearch(npi) ?? saved;
  if (!cached) return;
  try {
    const view = await fetchView(npi, ctx, cached);
    if (view.research) view.research.cached = true;
    set(key, { stage: "done", view });
  } catch { /* leave idle */ }
}

// ── Cheap public-web pass (no AI) ────────────────────────────────────────────
// Runs automatically on a small, nearest-first set of registry candidates. A
// corroborated result becomes the provider's view (method "public_web"), so the
// same routing puts it under Recommended / Needs review; paid AI research can
// still replace it. Not persisted: it re-runs per page session.

export interface Discovery { status: "running" | "done" | "error"; log: DiscoveryLog | null; error: string | null; before: { provider: number; destination: number } }
const discoveries = new Map<string, Discovery>();
export const getDiscovery = (npi: string, ctx: SearchContext | null): Discovery | null => discoveries.get(ctxKey(npi, ctx)) ?? null;

export const DISCOVERY_LIMIT = 8;

export async function runDiscovery(list: NearbyResult[], ctx: SearchContext, concurrency = 2): Promise<void> {
  const todo = list.filter((r) => !discoveries.has(ctxKey(r.npi, ctx)) && !states.get(ctxKey(r.npi, ctx))?.view);
  for (const r of todo) discoveries.set(ctxKey(r.npi, ctx), { status: "running", log: null, error: null, before: { provider: r.provider.score, destination: r.nearest.referral.score } });
  listeners.forEach((l) => l());
  const queue = [...todo];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const key = ctxKey(r.npi, ctx);
      const cur = discoveries.get(key)!;
      try {
        const res = await discoverCandidate(r, ctx);
        discoveries.set(key, { ...cur, status: "done", log: res.log });
        // Paid research that finished meanwhile always wins over the cheap pass.
        if (res.view && !states.get(key)?.view && !isRunning(states.get(key) ?? IDLE)) set(key, { stage: "done", view: res.view });
        else listeners.forEach((l) => l());
      } catch (err) {
        discoveries.set(key, { ...cur, status: "error", error: (err as Error).message });
        listeners.forEach((l) => l());
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
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
