// ── NPI demo — protection for the paid research endpoint (TEMPORARY DEMO) ─────
// Proportionate for a public boss demo, no accounts:
//   1. Demo access key. The browser sends it in the X-Demo-Key header; only its
//      SHA-256 lives in this (public) repo. NPI_DEMO_KEY in the Vercel env, if
//      set, replaces the built-in key.
//   2. Best-effort per-IP rate limit on FRESH research (cache hits are free).
//      In-memory, so it is per Edge isolate — a brake, not a guarantee.
// Search, NPI, geocoding and licence lookups call only free public APIs and stay open.

const DEMO_KEY_SHA256 = "155fe92ca354f9757c0f4fffb6d72791028aafd2fde5ad9cc0db49612be6d3fe";
const WINDOW_MS = 3600_000;
const MAX_FRESH_PER_WINDOW = 25;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function demoKeyOk(req: Request): Promise<boolean> {
  const given = req.headers.get("x-demo-key")?.trim();
  if (!given) return false;
  const expected = process.env.NPI_DEMO_KEY ? await sha256(process.env.NPI_DEMO_KEY) : DEMO_KEY_SHA256;
  return (await sha256(given)) === expected;
}

const hits = new Map<string, number[]>();

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

// Records one fresh research run; false when this IP is over the limit.
export function takeResearchSlot(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_FRESH_PER_WINDOW) { hits.set(ip, recent); return false; }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}
