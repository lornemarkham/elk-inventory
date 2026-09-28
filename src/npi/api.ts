// ── NPI demo — browser client for api/npi-* (TEMPORARY DEMO) ─────────────────
import type { NearbyResponse, ReferralResearch, ReferralView, ResearchEvent, SearchResponse } from "./types";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const searchProviders = (q: string) => getJson<SearchResponse>(`/api/npi-search?q=${encodeURIComponent(q)}`);

export const searchNearby = (specialty: string, location: string, radius: number) =>
  getJson<NearbyResponse>(`/api/npi-nearby?${new URLSearchParams({ specialty, location, radius: String(radius) })}`);

// Search context carried into the detail page so distances and specialty match are relative to it.
export interface SearchContext {
  lat: number;
  lon: number;
  radius: number;
  specialty: string;
  originLabel: string;
}

function ctxParams(npi: string, ctx: SearchContext | null, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ npi, ...extra });
  if (ctx) {
    p.set("lat", String(ctx.lat));
    p.set("lon", String(ctx.lon));
    p.set("radius", String(ctx.radius));
    p.set("specialty", ctx.specialty);
  }
  return p.toString();
}

// Registry + licence view; with cached research, the server re-scores it for this origin (no AI call).
export function fetchView(npi: string, ctx: SearchContext | null, research: ReferralResearch | null = null): Promise<ReferralView> {
  const url = `/api/npi-provider?${ctxParams(npi, ctx)}`;
  return research
    ? getJson<ReferralView>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ research }) })
    : getJson<ReferralView>(url);
}

export async function streamResearch(npi: string, ctx: SearchContext | null, fresh: boolean, onEvent: (e: ResearchEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/npi-research?${ctxParams(npi, ctx, fresh ? { fresh: "1" } : {})}`, { signal, headers: { "X-Demo-Key": getDemoKey() ?? "" } });
  if (!res.ok || !res.body) throw new Error(`Research request failed (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as ResearchEvent);
    }
  }
}

// ── Browser caches ────────────────────────────────────────────────────────────
// Research is cached per NPI (it doesn't depend on the search origin) so repeat
// demos don't spend OpenAI credits; the server re-scores it for each origin.

const RKEY = (npi: string) => `npi-research:v3:${npi}`;

export function loadResearch(npi: string): ReferralResearch | null {
  try {
    const raw = localStorage.getItem(RKEY(npi));
    return raw ? (JSON.parse(raw) as ReferralResearch) : null;
  } catch {
    return null;
  }
}

export function saveResearch(r: ReferralResearch): void {
  try {
    localStorage.setItem(RKEY(r.npi), JSON.stringify(r));
  } catch {
    /* storage full / private mode — caching is best-effort */
  }
}

const KEY_STORE = "npi-demo-key";

export function getDemoKey(): string | null {
  try { return localStorage.getItem(KEY_STORE); } catch { return null; }
}

export function setDemoKey(k: string): void {
  try { localStorage.setItem(KEY_STORE, k.trim()); } catch { /* best-effort */ }
}

// A shared link may carry the key in the fragment (#key=…), which never reaches server logs.
export function captureKeyFromHash(): void {
  const m = location.hash.match(/(?:^#|&)key=([^&]+)/);
  if (!m) return;
  setDemoKey(decodeURIComponent(m[1]));
  history.replaceState(null, "", location.pathname + location.search);
}
