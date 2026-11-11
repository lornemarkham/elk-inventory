// ── ELK Inventory MCP server — core (protocol, tools, database access) ─────────
// ChatGPT ("Charlie") talks to this through /api/mcp. Everything here runs AS
// THE SIGNED-IN FAMILY MEMBER: the request carries that person's own Supabase
// access token (issued to ChatGPT by Supabase's OAuth server), and every query
// is sent to PostgREST with it. The database therefore decides what is
// allowed (row-level security + elk_is_family_member()), exactly as it does
// for the web app. There is NO service-role key, DB password or any other
// privileged credential in this code or its environment.
//
// Fails closed: no/invalid token, a non-member, or a database that hasn't had
// supabase-family-access.sql applied all mean "no tools".
//
// Pure functions + an injectable fetch, so tests run with no network.

import { ZONES } from "../src/data/zones";
import { CONTAINERS } from "../src/data/containers";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const TIMEOUT_MS = 8_000;
const MAX_ROWS = 5_000;
const CONFIRM_TTL_S = 300;
const ITEM_CLASSES = ["tool", "material", "equipment", "project-asset", "installed-asset", "surplus"];
const DOMAINS = ["workshop", "electronics", "fitness", "food-storage", "kitchen-preserving", "garden", "pool", "vehicle", "household", "project", "unknown"];

export interface Ctx {
  supabaseUrl: string;
  anonKey: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** HMAC key for confirmation tokens. Not a database credential. Unset ⇒ operations that need confirmation are refused. */
  confirmSecret?: string;
  now?: () => number;
}

type Json = Record<string, unknown>;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A tool failure the model should see, with a message safe to repeat to the user. */
class ToolError extends Error {}

// ── Database access (as the user) ───────────────────────────────────────────────

interface PgResult { status: number; body: any; } // eslint-disable-line @typescript-eslint/no-explicit-any

async function pg(ctx: Ctx, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<PgResult> {
  const res = await (ctx.fetchImpl ?? fetch)(`${ctx.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ctx.anonKey,
      Authorization: `Bearer ${ctx.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const missing = (r: PgResult) =>
  r.status === 404 || ["PGRST205", "PGRST202", "42P01", "42883"].includes(r.body?.code);

function fail(r: PgResult, what: string): never {
  if (r.status === 401) throw new ToolError("Your ELK sign-in expired. Reconnect the ELK Inventory connector in ChatGPT.");
  if (r.status === 403 || r.body?.code === "42501") throw new ToolError("This account isn't allowed to do that in ELK Inventory.");
  // PostgREST messages from our own SQL functions are written for people; others are shortened.
  const msg = typeof r.body?.message === "string" ? r.body.message.slice(0, 200) : `HTTP ${r.status}`;
  throw new ToolError(`${what} failed: ${msg}`);
}

/** Auth gate for the whole endpoint. Mirrors api/_extract-auth.ts but is strict: a database without the family list is refused. */
export type Gate = { ok: true; userId: string } | { ok: false; status: 401 | 403 | 503; error: string };

export async function checkMember(ctx: Ctx): Promise<Gate> {
  try {
    const r = await pg(ctx, "POST", "rpc/elk_is_family_member", {});
    if (r.status === 401) return { ok: false, status: 401, error: "invalid_token" };
    if (missing(r)) return { ok: false, status: 503, error: "ELK Inventory's family access rules aren't installed, so remote access stays off." };
    if (r.status !== 200) return { ok: false, status: 403, error: "forbidden" };
    if (r.body !== true) return { ok: false, status: 403, error: "This account isn't on the ELK family list." };
    const sub = jwtSub(ctx.token);
    if (!sub) return { ok: false, status: 401, error: "invalid_token" };
    return { ok: true, userId: sub };
  } catch {
    return { ok: false, status: 503, error: "ELK Inventory is unreachable right now." };
  }
}

// The token was just verified by PostgREST; this only reads who it names.
function jwtSub(token: string): string | null {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof p.sub === "string" ? p.sub : null;
  } catch { return null; }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clip = (s: unknown, n: number) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n) + "…" : t; };
const zoneName = (id: string) => ZONES.find((z) => z.id === id)?.name ?? id;
const containerName = (id: string | null) => (id ? CONTAINERS.find((c) => c.id === id)?.name ?? id : null);
const today = (ctx: Ctx) => new Date((ctx.now ?? Date.now)()).toISOString().slice(0, 10);

// "Garage" is how the household talks about the workshop: docs/vision/life-operating-system.md
// lists the garage as the mechanic bay, electronics bench (ELK Labs) and fabrication (Center Island);
// the strength zone is literally the "Garage Gym". We report what a place name matched so Charlie can say so.
const ALIASES: Record<string, string[]> = {
  garage: ["mechanic-bay", "elk-labs", "center-island", "strength-zone"],
  workshop: ["mechanic-bay", "elk-labs", "center-island"],
  gym: ["strength-zone"],
  pantry: ["storage-room-pantry"],
  shed: ["pool-shed"],
  truck: ["truck-kit"],
};

interface Place { zoneIds: Set<string>; text: string; matched: string[] }
function resolvePlace(term: string): Place {
  const t = norm(term);
  const zoneIds = new Set<string>();
  for (const z of ZONES) if (norm(z.id) === t || norm(z.name).includes(t) || t.split(" ").some((w) => w.length > 2 && norm(z.name).split(" ").includes(w))) zoneIds.add(z.id);
  for (const w of t.split(" ")) for (const id of ALIASES[w] ?? []) zoneIds.add(id);
  return { zoneIds, text: t, matched: [...zoneIds].map(zoneName) };
}

function shape(row: Row) {
  const a = row.attributes ?? {};
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: a.unit ?? undefined,
    item_class: row.item_class,
    category: row.category ?? undefined,
    subcategory: row.subcategory ?? undefined,
    brand: row.brand ?? undefined,
    domain: row.domain ?? undefined,
    lifecycle_state: row.lifecycle_state,
    location: { zone_id: row.current_zone, zone: zoneName(row.current_zone), detail: row.location_detail || undefined, container: containerName(row.container_id) ?? undefined },
    tags: row.tags?.length ? row.tags : undefined,
    notes: row.notes ? clip(row.notes, 300) : undefined,
    pantry_tracked: a.pantryTracked === true ? true : undefined,
    low_stock_at: a.lowStockAt ?? undefined,
  };
}

const ITEM_COLS = "id,name,item_class,lifecycle_state,domain,current_zone,location_detail,container_id,collection_id,project,tags,quantity,notes,brand,category,subcategory,attributes,updated_at";

async function allItems(ctx: Ctx): Promise<Row[]> {
  const r = await pg(ctx, "GET", `inventory_items?select=${ITEM_COLS}&order=name.asc&limit=${MAX_ROWS}`);
  if (r.status !== 200) fail(r, "Reading inventory");
  return r.body as Row[];
}

async function lots(ctx: Ctx, filter = ""): Promise<Row[] | null> {
  const r = await pg(ctx, "GET", `stock_lots?select=id,item_id,quantity_remaining,location,best_before,purchased_on,source${filter}&quantity_remaining=gt.0&limit=${MAX_ROWS}`);
  if (missing(r)) return null; // Pantry tracking not installed in this database
  if (r.status !== 200) fail(r, "Reading pantry batches");
  return r.body as Row[];
}

function matchesPlace(row: Row, p: Place): boolean {
  if (p.zoneIds.has(row.current_zone)) return true;
  const hay = norm(`${row.location_detail ?? ""} ${containerName(row.container_id) ?? ""}`);
  return p.text.length > 2 && hay.includes(p.text);
}

// ── Confirmation tokens ─────────────────────────────────────────────────────────
// A destructive or significant change is a two-step: the first call returns a
// preview and a short-lived token bound to this user, this operation and these
// exact arguments; the change happens only when the same call is repeated with
// the token. The token is HMAC-signed with a server-side secret, so it can't be
// invented, reused for another change, or used by another person.

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function hmacKey(secret: string) { return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
async function fingerprint(op: string, args: Json) {
  const { confirmation_token: _t, ...rest } = args; void _t;
  const canon = JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]));
  return b64u(await crypto.subtle.digest("SHA-256", enc.encode(`${op}|${canon}`)));
}

async function issueToken(ctx: Ctx, userId: string, op: string, args: Json): Promise<string> {
  if (!ctx.confirmSecret) throw new ToolError("This change needs confirmation, but confirmation isn't configured on the server (MCP_CONFIRM_SECRET), so it was not made.");
  const payload = b64u(enc.encode(JSON.stringify({ u: userId, f: await fingerprint(op, args), e: Math.floor((ctx.now ?? Date.now)() / 1000) + CONFIRM_TTL_S })));
  const sig = b64u(await crypto.subtle.sign("HMAC", await hmacKey(ctx.confirmSecret), enc.encode(payload)));
  return `${payload}.${sig}`;
}

async function tokenValid(ctx: Ctx, userId: string, op: string, args: Json): Promise<boolean> {
  const tok = args.confirmation_token;
  if (typeof tok !== "string" || !ctx.confirmSecret) return false;
  const [payload, sig] = tok.split(".");
  if (!payload || !sig) return false;
  try {
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(ctx.confirmSecret), unb64u(sig), enc.encode(payload)))) return false;
    const p = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    return p.u === userId && p.f === (await fingerprint(op, args)) && p.e >= Math.floor((ctx.now ?? Date.now)() / 1000);
  } catch { return false; }
}

async function needConfirmation(ctx: Ctx, userId: string, op: string, args: Json, preview: Json) {
  return {
    status: "confirmation_required",
    preview,
    confirmation_token: await issueToken(ctx, userId, op, args),
    expires_in_seconds: CONFIRM_TTL_S,
    instruction: "NOT DONE YET. Tell the user exactly what will change and ask them to confirm. Only after they say yes, call this tool again with the same arguments plus this confirmation_token. Never confirm on the user's behalf.",
  };
}

// ── Tools ───────────────────────────────────────────────────────────────────────

const str = (d: string, extra: Json = {}) => ({ type: "string", description: d, ...extra });
const int = (d: string, extra: Json = {}) => ({ type: "integer", description: d, ...extra });
const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

interface Tool { name: string; description: string; inputSchema: Json; annotations: Json; run(ctx: Ctx, userId: string, a: Json): Promise<Json> }

function limitOf(a: Json, def: number, max: number) {
  const n = Number(a.limit ?? def);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : def;
}

const TOOLS: Tool[] = [
  {
    name: "inventory_search",
    description: "Search the live ELK Inventory (tools, equipment, supplies/materials, pantry food). Use for \"what do I have in my garage?\", \"do I have X?\", \"how many Y?\". Combine any filters. Every filter is optional; with none it lists everything (up to limit). The reply says which places a location word matched.",
    inputSchema: { type: "object", properties: {
      query: str("Words to look for in name, brand, category, notes, tags and location. All words must match."),
      location: str("A place: a zone (Mechanic Bay, ELK Labs, Center Island, Garage Gym / Strength Zone, Pool Shed, Truck Kit, Garden, Storage Room Pantry) or a word like \"garage\", \"pantry\", \"shed\"; also matches container and shelf text."),
      category: str("Category or subcategory, e.g. \"batteries\", \"canned\"."),
      item_class: str("tool | material (supplies/consumables) | equipment | project-asset | installed-asset | surplus", { enum: ITEM_CLASSES }),
      domain: str("workshop | electronics | fitness | food-storage | kitchen-preserving | garden | pool | vehicle | household | project", { enum: DOMAINS }),
      lifecycle_state: str("available | in-use | reserved | ordered | needs-repair | retired | consumed | lost …"),
      limit: int("Max items returned (default 25, max 100).", { minimum: 1, maximum: 100 }),
    }, additionalProperties: false },
    annotations: READ,
    async run(ctx, _u, a) {
      const rows = await allItems(ctx);
      const place = a.location ? resolvePlace(String(a.location)) : null;
      const words = norm(a.query).split(" ").filter(Boolean);
      const cat = a.category ? norm(a.category) : null;
      const hits: Array<{ row: Row; score: number }> = [];
      for (const row of rows) {
        if (a.item_class && row.item_class !== a.item_class) continue;
        if (a.domain && row.domain !== a.domain) continue;
        if (a.lifecycle_state && row.lifecycle_state !== a.lifecycle_state) continue;
        if (place && !matchesPlace(row, place)) continue;
        if (cat && !norm(`${row.category ?? ""} ${row.subcategory ?? ""}`).includes(cat)) continue;
        let score = 0;
        if (words.length) {
          const name = norm(row.name);
          const hay = norm(`${row.name} ${row.brand ?? ""} ${row.category ?? ""} ${row.subcategory ?? ""} ${row.notes ?? ""} ${(row.tags ?? []).join(" ")} ${row.location_detail ?? ""} ${containerName(row.container_id) ?? ""} ${zoneName(row.current_zone)}`);
          if (!words.every((w) => hay.includes(w))) continue;
          score = words.filter((w) => name.includes(w)).length;
        }
        hits.push({ row, score });
      }
      hits.sort((x, y) => y.score - x.score || String(x.row.name).localeCompare(String(y.row.name)));
      const limit = limitOf(a, 25, 100);
      return {
        total_matches: hits.length,
        returned: Math.min(hits.length, limit),
        matched_locations: place ? { asked: a.location, zones: place.matched.length ? place.matched : "no zone matched; searched shelf/container text only" } : undefined,
        total_quantity: hits.reduce((n, h) => n + (Number(h.row.quantity) || 0), 0),
        items: hits.slice(0, limit).map((h) => shape(h.row)),
      };
    },
  },
  {
    name: "inventory_get_item",
    description: "Full detail for one item: where it is, quantity, pantry batches with best-before dates, and its recent movement history. Give item_id (from a search) or an exact-ish name.",
    inputSchema: { type: "object", properties: { item_id: str("The item's id."), name: str("Item name, if you don't have the id.") }, additionalProperties: false },
    annotations: READ,
    async run(ctx, _u, a) {
      const item = await findItem(ctx, a);
      if ("candidates" in item) return item;
      const [lotRows, mov] = await Promise.all([
        lots(ctx, `&item_id=eq.${encodeURIComponent(item.row.id)}`),
        pg(ctx, "GET", `stock_movements?select=kind,quantity_delta,note,created_at,created_by&item_id=eq.${encodeURIComponent(item.row.id)}&order=created_at.desc&limit=10`),
      ]);
      return {
        item: { ...shape(item.row), project: item.row.project ?? undefined, attributes: item.row.attributes ?? {}, updated_at: item.row.updated_at },
        batches: lotRows === null ? "pantry tracking not enabled in this database" : lotRows.map((l) => ({ quantity: l.quantity_remaining, best_before: l.best_before, purchased_on: l.purchased_on, location: l.location || undefined })),
        recent_movements: mov.status === 200 ? (mov.body as Row[]).map((m) => ({ kind: m.kind, change: m.quantity_delta, note: m.note ?? undefined, at: m.created_at })) : "not available",
      };
    },
  },
  {
    name: "inventory_list_locations",
    description: "List every place things are kept: zones (with item counts), containers, and the free-text shelf/bin details people typed. Use this to learn what location names exist before searching.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ,
    async run(ctx) {
      const rows = await allItems(ctx);
      const byZone = new Map<string, number>(), byBox = new Map<string, number>(), detail = new Map<string, number>();
      for (const r of rows) {
        byZone.set(r.current_zone, (byZone.get(r.current_zone) ?? 0) + 1);
        if (r.container_id) byBox.set(r.container_id, (byBox.get(r.container_id) ?? 0) + 1);
        const d = String(r.location_detail ?? "").trim();
        if (d) detail.set(`${zoneName(r.current_zone)}: ${d}`, (detail.get(`${zoneName(r.current_zone)}: ${d}`) ?? 0) + 1);
      }
      return {
        total_items: rows.length,
        zones: ZONES.map((z) => ({ id: z.id, name: z.name, purpose: z.purpose, items: byZone.get(z.id) ?? 0 })),
        containers: CONTAINERS.map((c) => ({ id: c.id, name: c.name, zone: zoneName(c.zoneId), items: byBox.get(c.id) ?? 0 })),
        shelf_and_bin_details: [...detail].map(([where, items]) => ({ where, items })).slice(0, 100),
        place_words: Object.fromEntries(Object.entries(ALIASES).map(([k, v]) => [k, v.map(zoneName)])),
      };
    },
  },
  {
    name: "inventory_get_expiring",
    description: "Pantry food that is expired or goes off soon, oldest first, with how many days are left. Only pantry-tracked batches have dates.",
    inputSchema: { type: "object", properties: {
      within_days: int("Look this many days ahead (default 30, max 365).", { minimum: 0, maximum: 365 }),
      include_expired: { type: "boolean", description: "Also list already-expired batches (default true)." },
      location: str("Limit to a place."),
    }, additionalProperties: false },
    annotations: READ,
    async run(ctx, _u, a) {
      const days = Math.min(Math.max(Math.trunc(Number(a.within_days ?? 30)) || 0, 0), 365);
      const t0 = today(ctx);
      const until = new Date(new Date(t0).getTime() + days * 86_400_000).toISOString().slice(0, 10);
      const rows = await lots(ctx, `&best_before=lte.${until}&order=best_before.asc`);
      if (rows === null) return { status: "not_enabled", message: "Pantry batch tracking (expiry dates) isn't installed in the database yet." };
      const items = new Map((await allItems(ctx)).map((r) => [r.id, r]));
      const place = a.location ? resolvePlace(String(a.location)) : null;
      const out = rows
        .filter((l) => items.has(l.item_id) && (a.include_expired !== false || l.best_before >= t0))
        .filter((l) => !place || matchesPlace(items.get(l.item_id)!, place) || norm(l.location).includes(place.text))
        .map((l) => ({
          item_id: l.item_id, name: items.get(l.item_id)!.name, quantity: l.quantity_remaining, best_before: l.best_before,
          days_left: Math.round((new Date(l.best_before).getTime() - new Date(t0).getTime()) / 86_400_000),
          expired: l.best_before < t0, location: l.location || zoneName(items.get(l.item_id)!.current_zone),
        }));
      return { as_of: t0, window_days: days, count: out.length, batches: out.slice(0, 100) };
    },
  },
  {
    name: "inventory_get_shopping_list",
    description: "The family shopping list (open items by default).",
    inputSchema: { type: "object", properties: { include_done: { type: "boolean", description: "Also show recently ticked-off items (default false)." }, limit: int("Max rows (default 50, max 200).", { minimum: 1, maximum: 200 }) }, additionalProperties: false },
    annotations: READ,
    async run(ctx, _u, a) {
      const r = await pg(ctx, "GET", `pantry_shopping_items?select=id,name,note,source,item_id,created_at,done_at${a.include_done ? "" : "&done_at=is.null"}&order=created_at.desc&limit=${limitOf(a, 50, 200)}`);
      if (missing(r)) return { status: "not_enabled", message: "The shopping list isn't installed in the database yet (supabase-pantry.sql, release M652)." };
      if (r.status !== 200) fail(r, "Reading the shopping list");
      return { open: (r.body as Row[]).filter((x) => !x.done_at).length, items: (r.body as Row[]).map((x) => ({ id: x.id, name: x.name, note: x.note ?? undefined, source: x.source, added: x.created_at, done: x.done_at ?? undefined })) };
    },
  },
  {
    name: "inventory_get_history",
    description: "Recent inventory movements (bought, used, wasted, moved, corrections), newest first, with who did it. Optionally for one item.",
    inputSchema: { type: "object", properties: { item_id: str("Only this item."), days: int("How far back (default 30, max 365).", { minimum: 1, maximum: 365 }), limit: int("Max rows (default 30, max 100).", { minimum: 1, maximum: 100 }) }, additionalProperties: false },
    annotations: READ,
    async run(ctx, _u, a) {
      const since = new Date((ctx.now ?? Date.now)() - Math.min(Math.max(Math.trunc(Number(a.days ?? 30)) || 30, 1), 365) * 86_400_000).toISOString();
      const f = a.item_id ? `&item_id=eq.${encodeURIComponent(String(a.item_id))}` : "";
      const r = await pg(ctx, "GET", `stock_movements?select=item_id,kind,quantity_delta,note,created_at,created_by&created_at=gte.${since}${f}&order=created_at.desc&limit=${limitOf(a, 30, 100)}`);
      if (missing(r)) return { status: "not_enabled", message: "Movement history (pantry tracking) isn't installed in the database yet." };
      if (r.status !== 200) fail(r, "Reading history");
      const [names, people] = await Promise.all([allItems(ctx), pg(ctx, "GET", "elk_family_members?select=user_id,display_name")]);
      const nm = new Map(names.map((x) => [x.id, x.name]));
      const who = new Map<string, string>(people.status === 200 ? (people.body as Row[]).map((p) => [p.user_id, p.display_name] as [string, string]) : []);
      return { since, movements: (r.body as Row[]).map((m) => ({ at: m.created_at, item_id: m.item_id, item: nm.get(m.item_id) ?? m.item_id, kind: m.kind, change: m.quantity_delta, by: who.get(m.created_by) ?? undefined, note: m.note ?? undefined })) };
    },
  },
  {
    name: "inventory_add_item",
    description: "Add a NEW item to the inventory (never duplicates: if something similar exists it tells you instead — use inventory_adjust_quantity for that). For food give best_before and it is recorded as a pantry batch. Large quantities need user confirmation.",
    inputSchema: { type: "object", properties: {
      name: str("Item name.", { maxLength: 120 }),
      quantity: int("How many (default 1).", { minimum: 1, maximum: 10000 }),
      zone: str("Zone id or name (e.g. mechanic-bay, \"Pool Shed\"). Default unknown."),
      location_detail: str("Shelf, bin or drawer, free text.", { maxLength: 200 }),
      item_class: str("tool | material | equipment | project-asset | installed-asset | surplus. Default equipment; use material for supplies.", { enum: ITEM_CLASSES }),
      domain: str("Optional domain.", { enum: DOMAINS }),
      category: str("Optional category."), brand: str("Optional brand."), notes: str("Optional notes.", { maxLength: 500 }),
      best_before: str("YYYY-MM-DD, for food. Makes it a pantry batch."),
      allow_duplicate: { type: "boolean", description: "Add even though a similar item exists. Only after the user says so." },
      confirmation_token: str("From a previous confirmation_required reply."),
    }, required: ["name"], additionalProperties: false },
    annotations: WRITE,
    async run(ctx, userId, a) {
      const name = String(a.name ?? "").replace(/\s+/g, " ").trim();
      if (!name || name.length > 120) throw new ToolError("Give the item a name (up to 120 characters).");
      const qty = a.quantity === undefined ? 1 : Number(a.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 10000) throw new ToolError("quantity must be a whole number from 1 to 10000.");
      const zone = a.zone ? ZONES.find((z) => norm(z.id) === norm(a.zone) || norm(z.name) === norm(a.zone)) : undefined;
      if (a.zone && !zone) throw new ToolError(`Unknown zone "${a.zone}". Valid: ${ZONES.map((z) => z.name).join(", ")}.`);
      if (a.item_class && !ITEM_CLASSES.includes(String(a.item_class))) throw new ToolError(`item_class must be one of ${ITEM_CLASSES.join(", ")}.`);
      if (a.domain && !DOMAINS.includes(String(a.domain))) throw new ToolError(`domain must be one of ${DOMAINS.join(", ")}.`);
      if (a.best_before && !/^\d{4}-\d{2}-\d{2}$/.test(String(a.best_before))) throw new ToolError("best_before must be YYYY-MM-DD.");

      if (a.allow_duplicate !== true) {
        const key = norm(name);
        const dupes = (await allItems(ctx)).filter((r) => norm(r.name) === key || (key.length > 4 && (norm(r.name).includes(key) || key.includes(norm(r.name)) && norm(r.name).length > 4)));
        if (dupes.length) return { status: "possible_duplicate", message: "Something similar is already in the inventory, so nothing was added. To change its count use inventory_adjust_quantity; to add it anyway, ask the user and repeat with allow_duplicate: true.", existing: dupes.slice(0, 5).map(shape) };
      }
      if (qty > 50 && !(await tokenValid(ctx, userId, "add_item", a))) {
        return needConfirmation(ctx, userId, "add_item", a, { add: name, quantity: qty, zone: zone?.name ?? "Unknown" });
      }

      const id = `mcp-${crypto.randomUUID().slice(0, 8)}`;
      const isFood = Boolean(a.best_before) || a.domain === "food-storage";
      if (isFood) {
        const r = await pg(ctx, "POST", "rpc/pantry_receive", {
          p_item_id: id, p_quantity: qty, p_location: a.location_detail ?? zone?.name ?? "", p_best_before: a.best_before ?? null,
          p_new_name: name, p_request_id: crypto.randomUUID(),
        });
        if (missing(r)) throw new ToolError("Pantry tracking isn't installed in the database, so food with a best-before date can't be added yet.");
        if (r.status >= 300) fail(r, "Adding the item");
      } else {
        const now = new Date((ctx.now ?? Date.now)()).toISOString();
        const r = await pg(ctx, "POST", "inventory_items", {
          id, name, quantity: qty, item_class: a.item_class ?? "equipment", lifecycle_state: "available", domain: a.domain ?? null,
          current_zone: zone?.id ?? "unknown", recommended_zone: zone?.id ?? "unknown", location_detail: a.location_detail ?? "",
          category: a.category ?? null, brand: a.brand ?? null, notes: a.notes ?? "", tags: [], attributes: {}, created_at: now, updated_at: now,
        }, { Prefer: "return=representation" });
        if (r.status >= 300) fail(r, "Adding the item");
      }
      const check = await pg(ctx, "GET", `inventory_items?select=${ITEM_COLS}&id=eq.${id}`);
      return { status: "added", item: check.status === 200 && check.body[0] ? shape(check.body[0]) : { id, name, quantity: qty } };
    },
  },
  {
    name: "inventory_adjust_quantity",
    description: "Change how many of an existing item there are: delta (+/−) or set_to (an exact count). Pantry-tracked food is recorded as used/wasted/received so history stays right. Emptying an item, big changes, or any set_to that differs a lot need user confirmation (the reply tells you).",
    inputSchema: { type: "object", properties: {
      item_id: str("The item's id (from inventory_search)."),
      delta: int("Change, e.g. -2 (used two) or +6 (bought six)."),
      set_to: int("Exact new count (use instead of delta after a recount).", { minimum: 0 }),
      kind: str("For decreases of tracked food: used (default) or wasted.", { enum: ["used", "wasted"] }),
      reason: str("Optional note for the record.", { maxLength: 200 }),
      confirmation_token: str("From a previous confirmation_required reply."),
    }, required: ["item_id"], additionalProperties: false },
    annotations: DESTRUCTIVE,
    async run(ctx, userId, a) {
      if ((a.delta === undefined) === (a.set_to === undefined)) throw new ToolError("Give exactly one of delta or set_to.");
      const found = await findItem(ctx, { item_id: a.item_id });
      if ("candidates" in found) throw new ToolError("No item with that id. Use inventory_search to find the right item_id.");
      const row = found.row, before = Number(row.quantity) || 0;
      const after = a.set_to !== undefined ? Number(a.set_to) : before + Number(a.delta);
      if (!Number.isInteger(after) || !Number.isInteger(before)) throw new ToolError("Quantities must be whole numbers.");
      if (after < 0) throw new ToolError(`There are only ${before} of "${row.name}", so that can't go below zero.`);
      if (after === before) return { status: "no_change", item: shape(row) };
      const change = after - before;
      const significant = after === 0 || Math.abs(change) > Math.max(10, before * 0.5) || a.set_to !== undefined && Math.abs(change) > 5;
      if (significant && !(await tokenValid(ctx, userId, "adjust_quantity", a))) {
        return needConfirmation(ctx, userId, "adjust_quantity", a, { item: row.name, from: before, to: after, change, why_confirmation: after === 0 ? "this empties the item" : "this is a large change" });
      }

      const tracked = row.attributes?.pantryTracked === true;
      if (tracked) {
        const r = change > 0
          ? await pg(ctx, "POST", "rpc/pantry_receive", { p_item_id: row.id, p_quantity: change, p_location: row.location_detail ?? "", p_request_id: crypto.randomUUID() })
          : await pg(ctx, "POST", "rpc/pantry_use", { p_item_id: row.id, p_quantity: -change, p_request_id: crypto.randomUUID(), ...(a.kind === "wasted" ? { p_reason: "wasted" } : {}) });
        // p_reason exists only after supabase-pantry.sql release M652; plain "used" works on the older function.
        if (a.kind === "wasted" && missing(r)) throw new ToolError("Recording something as wasted needs the newer pantry database update. Record it as used instead, or ask the owner to apply it.");
        if (r.status >= 300) fail(r, "Changing the quantity");
      } else {
        // Guarded on the old count so a change made elsewhere in the meantime isn't overwritten.
        const r = await pg(ctx, "PATCH", `inventory_items?id=eq.${encodeURIComponent(row.id)}&quantity=eq.${before}`,
          { quantity: after, updated_at: new Date((ctx.now ?? Date.now)()).toISOString() }, { Prefer: "return=representation" });
        if (r.status >= 300) fail(r, "Changing the quantity");
        if (!Array.isArray(r.body) || r.body.length === 0) throw new ToolError(`"${row.name}" was changed by someone else just now. Look it up again and retry.`);
      }
      const now = await pg(ctx, "GET", `inventory_items?select=${ITEM_COLS}&id=eq.${encodeURIComponent(row.id)}`);
      return { status: "adjusted", item: now.status === 200 && now.body[0] ? shape(now.body[0]) : shape({ ...row, quantity: after }), before, after, recorded_as: tracked ? (change > 0 ? "received" : a.kind === "wasted" ? "wasted" : "used") : "direct count change (no history for untracked items)" };
    },
  },
  {
    name: "inventory_add_to_shopping_list",
    description: "Add things to the family shopping list. Already-listed names are skipped, not duplicated.",
    inputSchema: { type: "object", properties: { names: { type: "array", items: { type: "string", maxLength: 200 }, minItems: 1, maxItems: 20, description: "What to buy." }, note: str("Why, e.g. \"for lasagne\".", { maxLength: 500 }) }, required: ["names"], additionalProperties: false },
    annotations: WRITE,
    async run(ctx, _u, a) {
      const names = Array.isArray(a.names) ? a.names.map((n) => String(n).trim()).filter(Boolean) : [];
      if (!names.length || names.length > 20) throw new ToolError("Give 1 to 20 names.");
      const r = await pg(ctx, "POST", "rpc/pantry_shopping_add", { p_names: names, p_note: a.note ?? null, p_source: "manual" });
      if (missing(r)) throw new ToolError("The shopping list isn't installed in the database yet (supabase-pantry.sql, release M652), so nothing was added.");
      if (r.status >= 300) fail(r, "Adding to the shopping list");
      const added = Number(r.body) || 0;
      return { status: "ok", requested: names.length, added, already_on_list: names.length - added };
    },
  },
  {
    name: "inventory_update_shopping_item",
    description: "Tick a shopping-list entry off (mark_done), un-tick it (mark_not_done) or delete it (remove — needs user confirmation). Get ids from inventory_get_shopping_list.",
    inputSchema: { type: "object", properties: { id: str("Shopping entry id."), action: str("mark_done | mark_not_done | remove", { enum: ["mark_done", "mark_not_done", "remove"] }), confirmation_token: str("From a previous confirmation_required reply.") }, required: ["id", "action"], additionalProperties: false },
    annotations: DESTRUCTIVE,
    async run(ctx, userId, a) {
      const id = encodeURIComponent(String(a.id));
      const cur = await pg(ctx, "GET", `pantry_shopping_items?select=id,name,done_at&id=eq.${id}`);
      if (missing(cur)) throw new ToolError("The shopping list isn't installed in the database yet.");
      if (cur.status !== 200) fail(cur, "Reading the shopping list");
      if (!cur.body[0]) throw new ToolError("No shopping-list entry with that id.");
      const name = cur.body[0].name;
      if (a.action === "remove") {
        if (!(await tokenValid(ctx, userId, "shopping_remove", a))) return needConfirmation(ctx, userId, "shopping_remove", a, { delete_from_shopping_list: name });
        const r = await pg(ctx, "DELETE", `pantry_shopping_items?id=eq.${id}`);
        if (r.status >= 300) fail(r, "Removing the entry");
        return { status: "removed", name };
      }
      if (a.action !== "mark_done" && a.action !== "mark_not_done") throw new ToolError("action must be mark_done, mark_not_done or remove.");
      const done = a.action === "mark_done";
      const r = await pg(ctx, "PATCH", `pantry_shopping_items?id=eq.${id}`, { done_at: done ? new Date((ctx.now ?? Date.now)()).toISOString() : null, done_by: done ? userId : null });
      if (r.status >= 300) fail(r, "Updating the entry");
      return { status: done ? "marked_done" : "marked_not_done", name };
    },
  },
];

async function findItem(ctx: Ctx, a: Json): Promise<{ row: Row } | { candidates: Row[] }> {
  if (a.item_id) {
    const r = await pg(ctx, "GET", `inventory_items?select=${ITEM_COLS}&id=eq.${encodeURIComponent(String(a.item_id))}`);
    if (r.status !== 200) fail(r, "Reading the item");
    if (!r.body[0]) throw new ToolError(`No item with id "${a.item_id}".`);
    return { row: r.body[0] };
  }
  if (!a.name) throw new ToolError("Give item_id or name.");
  const key = norm(a.name);
  const rows = (await allItems(ctx)).filter((r) => norm(r.name).includes(key));
  const exact = rows.filter((r) => norm(r.name) === key);
  if (exact.length === 1 || rows.length === 1) return { row: (exact[0] ?? rows[0]) };
  if (!rows.length) throw new ToolError(`Nothing named "${a.name}". Try inventory_search.`);
  return { candidates: rows.slice(0, 10).map(shape) } as never;
}

// ── JSON-RPC (MCP Streamable HTTP, stateless) ───────────────────────────────────

export const SERVER_INSTRUCTIONS =
  "ELK Inventory is the household's live inventory (workshop tools and equipment, supplies, pantry food) with a family shopping list. " +
  "Always search the inventory rather than answering from memory. Report what a location word matched (e.g. \"garage\" = Mechanic Bay, ELK Labs, Center Island, Garage Gym). " +
  "Quantities are the database's truth; say so if a tool reports a feature as not enabled. " +
  "Any change that returns confirmation_required has NOT happened: describe it to the user and ask before repeating the call with the token. Never confirm for the user.";

export function toolList() {
  return TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations }));
}

export async function handleRpc(ctx: Ctx, userId: string, msg: any): Promise<Json | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const id = msg?.id;
  const reply = (result: Json) => ({ jsonrpc: "2.0", id, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return error(-32600, "Invalid request");
  if (id === undefined) return null; // notification

  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "elk-inventory", version: "1.0.0" },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping": return reply({});
    case "tools/list": return reply({ tools: toolList() });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return error(-32602, `Unknown tool: ${msg.params?.name}`);
      const args = msg.params?.arguments ?? {};
      if (typeof args !== "object" || Array.isArray(args)) return error(-32602, "arguments must be an object");
      try {
        const out = await tool.run(ctx, userId, args);
        return reply({ content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out });
      } catch (e) {
        const text = e instanceof ToolError ? e.message : "Something went wrong reading or changing the inventory. Nothing was changed.";
        if (!(e instanceof ToolError)) console.error("[api/mcp] tool failed:", tool.name, e instanceof Error ? e.message : e);
        return reply({ content: [{ type: "text", text }], isError: true });
      }
    }
    default: return error(-32601, `Method not found: ${msg.method}`);
  }
}
