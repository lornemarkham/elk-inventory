// ── /api/extract — family-only gate ────────────────────────────────────────────
// /api/extract spends the OpenAI key, so it must be as private as ELK's data.
// The browser sends the signed-in user's Supabase access token; we ask the
// database itself whether that user is on the family list by calling
// elk_is_family_member() through PostgREST with the token. PostgREST verifies
// the JWT signature and the function reads auth.uid() from it, so neither a
// forged token nor a client-side flag can get through.
//
// Fails closed: no token, an invalid/expired token, a non-member, a missing
// function (supabase-family-access.sql not yet applied), missing server config,
// or Supabase being unreachable all mean "no OpenAI call".

const CHECK_TIMEOUT_MS = 5_000;

export type FamilyGate =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 503; error: string };

export interface GateConfig {
  supabaseUrl?: string;
  anonKey?: string;
  fetchImpl?: typeof fetch;
}

export function bearerToken(req: Request): string | null {
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(req.headers.get("authorization")?.trim() ?? "");
  return m ? m[1] : null;
}

export async function checkFamilyMember(req: Request, cfg: GateConfig = {}): Promise<FamilyGate> {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: "Sign in to use AI extraction" };

  const url = cfg.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = cfg.anonKey ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[api/extract] Supabase URL/anon key not set — refusing AI extraction");
    return { ok: false, status: 503, error: "AI extraction is unavailable" };
  }

  try {
    const res = await (cfg.fetchImpl ?? fetch)(`${url.replace(/\/+$/, "")}/rest/v1/rpc/elk_is_family_member`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (res.status === 401) return { ok: false, status: 401, error: "Sign in to use AI extraction" };
    if (!res.ok) {
      console.error(`[api/extract] family check returned ${res.status}`);
      return { ok: false, status: 403, error: "AI extraction is for family members only" };
    }
    if ((await res.json()) !== true) return { ok: false, status: 403, error: "AI extraction is for family members only" };
    return { ok: true };
  } catch (err) {
    console.error("[api/extract] family check failed:", err);
    return { ok: false, status: 503, error: "AI extraction is unavailable" };
  }
}
