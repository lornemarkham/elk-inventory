// ── NPI demo — browser client for api/npi-* (TEMPORARY DEMO) ─────────────────
import type { DiscoverResponse, NearbyResponse, NearbyResult, ReferralResearch, ReferralView, ResearchEvent, SearchResponse } from "./types";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const searchProviders = (q: string) => getJson<SearchResponse>(`/api/npi-search?q=${encodeURIComponent(q)}`);

export const searchNearby = (specialty: string, location: string, radius: number) =>
  getJson<NearbyResponse>(`/api/npi-nearby?${new URLSearchParams({ specialty, location: normalizeLocation(location), radius: String(radius) })}`);

const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));

// "seattle, Wa" / "Seattle wa 98115" → "Seattle, WA" / "Seattle, WA 98115", so the
// same place is one search (and one cache entry) however it was typed.
export function normalizeLocation(input: string): string {
  const s = input.trim().replace(/\s+/g, " ");
  const m = s.match(/^(.*?)[,\s]+([A-Za-z]{2})\.?(?:[,\s]+(\d{5}(?:-\d{4})?))?$/);
  if (!m || !m[1] || !US_STATES.has(m[2].toUpperCase())) return s;
  const place = m[1].replace(/,\s*$/, "");
  const tidy = /^\d/.test(place) || (/[a-z]/.test(place) && /[A-Z]/.test(place)) ? place : place.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return `${tidy}, ${m[2].toUpperCase()}${m[3] ? ` ${m[3]}` : ""}`;
}

// Cheap public-web pass for one registry candidate (Brave search + fetched pages, no AI).
export function discoverCandidate(r: NearbyResult, ctx: SearchContext): Promise<DiscoverResponse> {
  const p = new URLSearchParams({ npi: r.npi, lat: String(ctx.lat), lon: String(ctx.lon), radius: String(ctx.radius), specialty: ctx.specialty, city: r.nearest.city, state: r.nearest.state });
  for (const o of r.sharedAddressOrgs) p.append("org", o);
  return getJson<DiscoverResponse>(`/api/npi-discover?${p}`);
}

export const discoveryConfigured = () => getJson<{ configured: boolean }>("/api/npi-discover?probe=1").then((r) => r.configured).catch(() => null);

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

// The access-key form is operator plumbing: shown only with ?operator in the URL
// (or unlock with a #key=… link). Normal product screens never ask for a key.
export const operatorMode = () => /[?&]operator\b/.test(location.search);

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
