// RFC 9728 protected-resource metadata for /api/mcp (served at
// /.well-known/oauth-protected-resource, see vercel.json). Tells ChatGPT that
// Supabase Auth is the authorization server for this endpoint.

export const config = { runtime: "edge" };

export default function handler(req: Request): Response {
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!supabaseUrl) return new Response("not configured", { status: 503 });
  const origin = new URL(req.url).origin;
  return new Response(JSON.stringify({
    resource: `${origin}/api/mcp`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "email", "profile"],
    resource_name: "ELK Inventory",
  }), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
}
