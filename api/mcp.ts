// ── /api/mcp — ELK Inventory MCP endpoint (ChatGPT "Charlie") ──────────────────
// MCP over Streamable HTTP, stateless: each POST is one JSON-RPC message.
// Authentication is OAuth 2.1 + PKCE with Supabase Auth as the authorization
// server (docs/chatgpt-mcp.md). ChatGPT arrives with the family member's own
// Supabase access token; _mcp-core.ts uses it for every query, so the database
// enforces household permissions. No service-role key exists in this app.

import { checkMember, handleRpc, type Ctx } from "./_mcp-core";

export const config = { runtime: "edge" };

const MAX_BODY = 64 * 1024;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export default async function handler(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  const challenge = (error?: string) => ({
    "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"${error ? `, error="${error}"` : ""}`,
  });

  if (req.method !== "POST") return json(405, { error: "POST only" }, { Allow: "POST" });

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return json(503, { error: "ELK Inventory is not configured" });

  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(req.headers.get("authorization")?.trim() ?? "");
  if (!m) return json(401, { error: "unauthorized" }, challenge());

  const ctx: Ctx = { supabaseUrl, anonKey, token: m[1], confirmSecret: process.env.MCP_CONFIRM_SECRET };
  const gate = await checkMember(ctx);
  if (!gate.ok) return json(gate.status, { error: gate.error }, gate.status === 401 ? challenge("invalid_token") : {});

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "request too large" });
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  if (Array.isArray(msg)) return json(400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches are not supported" } });

  const out = await handleRpc(ctx, gate.userId, msg);
  return out === null ? new Response(null, { status: 202 }) : json(200, out);
}
