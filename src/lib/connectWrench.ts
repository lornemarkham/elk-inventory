// "Connect Wrench" handoff: Wrench's origin isn't on Supabase's redirect
// allow-list, so Inventory passes the signed-in session across in the URL
// fragment (never the query string, so it isn't sent to a server or logged).

const PROD_RETURN_ORIGINS = ["https://elk-wrench.vercel.app"];
const DEV_RETURN_ORIGINS = ["http://localhost:5173"];

export function allowedReturnOrigins(dev: boolean): string[] {
  return dev ? [...PROD_RETURN_ORIGINS, ...DEV_RETURN_ORIGINS] : PROD_RETURN_ORIGINS;
}

// Returns a normalised return URL (fragment and credentials dropped) if its
// origin is exactly on the allow-list, otherwise null. No open redirect.
export function parseReturnUrl(raw: string | null | undefined, dev = false): URL | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password) return null;
  if (!allowedReturnOrigins(dev).includes(url.origin)) return null;
  url.hash = "";
  return url;
}

export interface HandoffSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export function encodeSessionFragment(s: HandoffSession): string {
  const json = JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildHandoffUrl(returnUrl: URL, s: HandoffSession): string {
  const out = new URL(returnUrl.href);
  out.hash = `elk-inventory-session=${encodeSessionFragment(s)}`;
  return out.href;
}
