# ELK Inventory ↔ ChatGPT ("Charlie") — live MCP connector

Charlie queries the **live** Inventory database through an MCP server at

    https://elk-inventory.vercel.app/api/mcp

No exports, no uploads, no second copy of the data. The connection is an OAuth grant, so it stays
connected across conversations until you disconnect it.

## How it works

```
ChatGPT ──OAuth 2.1 + PKCE──▶ Supabase Auth (the authorization server) ──▶ /oauth/consent (this app: "Allow")
   │  Bearer <your own Supabase access token>
   ▼
/api/mcp (Vercel edge) ──same token──▶ Supabase PostgREST ──▶ RLS + elk_is_family_member()
```

- **ChatGPT gets *your* session.** Supabase's OAuth server issues the token for the family member who
  clicked Allow. Every query is sent to the database with that token, so the same row-level-security
  rules that protect the web app protect Charlie: not on `elk_family_members` ⇒ no data, no writes.
- **No privileged key exists.** The endpoint only has the public (publishable) key, which is already in
  the web app. There is no service-role key or DB password in this code, in Vercel, or visible to ChatGPT.
- **Fails closed.** No token, a bad token, a non-member, or a database without `supabase-family-access.sql`
  ⇒ 401/403/503 and no tools. (The web app tolerates a missing family list; this endpoint does not.)
- **Confirmation.** `inventory_adjust_quantity` that empties an item, changes the count by more than
  max(10, 50 %), or sets an exact count more than 5 away; `inventory_add_item` for more than 50; and
  *removing* a shopping entry all reply `confirmation_required` and change **nothing**. The reply carries
  a 5-minute token (HMAC-signed with `MCP_CONFIRM_SECRET`, bound to your user, the tool and the exact
  arguments). Charlie must show you the change and repeat the call with the token after you say yes.
  ChatGPT also asks you to approve write tool calls itself. Honest limit: the token is visible to the model,
  so the guarantee is "a signed, exact, short-lived, per-change token plus ChatGPT's own prompt", not
  "cryptographic proof the human clicked". There is deliberately **no delete-item tool**.
- **No duplicates.** `inventory_add_item` refuses a similar existing name and points at the existing item.
  Pantry-tracked food is changed only through `pantry_receive` / `pantry_use` (so history stays right);
  untracked items get a count-guarded update (a concurrent change is never overwritten).

## Tools

| Tool | Kind | Notes |
|---|---|---|
| `inventory_search` | read | words, `location`, `category`, `item_class` (supplies = `material`), `domain`, `lifecycle_state`. Says what a place word matched ("garage" = Mechanic Bay, ELK Labs, Center Island, Garage Gym). |
| `inventory_get_item` | read | detail, pantry batches + best-before, last 10 movements |
| `inventory_list_locations` | read | zones, containers, shelf/bin text, with counts |
| `inventory_get_expiring` | read | pantry batches by best-before, with days left |
| `inventory_get_shopping_list` | read | open (or recent) entries |
| `inventory_get_history` | read | movements with who did them |
| `inventory_add_item` | write | new item; food with `best_before` becomes a pantry batch |
| `inventory_adjust_quantity` | write, confirm | `delta` or `set_to`; tracked food recorded as used / wasted / received |
| `inventory_add_to_shopping_list` | write | skips names already listed |
| `inventory_update_shopping_item` | write, confirm on remove | `mark_done`, `mark_not_done`, `remove` |

Shopping, history and expiry need the pantry SQL: **`supabase-pantry.sql` from release M652**
(`inventory-release-m652`, still unmerged/unapplied as of 2026-11-10 — see `docs/release/m652-release.md`).
Until then those tools answer `not_enabled` (or a clear error) instead of failing; search, item, locations
and add/adjust work on today's database. Recording a decrease as `wasted` also needs M652.

## One-time setup (owner)

1. **Supabase Dashboard → project `xjmhojlmkodrsvocoqlv` → Authentication → OAuth Server**
   - Enable the OAuth server.
   - **Authorization path:** `/oauth/consent`
   - Turn on **Allow dynamic OAuth app registration** (ChatGPT registers itself).
   - Check **Authentication → URL Configuration → Site URL** is `https://elk-inventory.vercel.app`.
   - Check: `curl -s https://xjmhojlmkodrsvocoqlv.supabase.co/.well-known/oauth-authorization-server/auth/v1`
     returns JSON (today it says `"OAuth server is disabled"`).
2. **Vercel → elk-inventory → Settings → Environment Variables:** `MCP_CONFIRM_SECRET` = any 32+ random
   characters (Production). It is not a database credential. Without it, confirmable changes are refused.
3. You are already on `elk_family_members` (docs/family-access.md). Anyone else who should be able to
   use Charlie must be too.

## Connect ChatGPT (one time)

Needs a ChatGPT plan with custom connectors / Developer mode. Menu names move around; check ChatGPT help if
they differ.

1. ChatGPT → **Settings → Apps & Connectors → Advanced settings → Developer mode: on**.
2. **Settings → Apps & Connectors → Create** (add custom connector):
   - Name: `ELK Inventory`
   - Description: `Live household inventory: tools, supplies, pantry, shopping list`
   - MCP server URL: `https://elk-inventory.vercel.app/api/mcp`
   - Authentication: **OAuth** (leave client ID / secret empty)
   - tick *I trust this application* → **Create**
3. A browser tab opens on `elk-inventory.vercel.app/oauth/consent` (you'll get the usual email sign-in link
   first if you're signed out). Check it says it'll return to **chatgpt.com**, then **Allow**.
4. In a chat: **+ → ELK Inventory** (or add it under Developer mode), then ask:
   *"Charlie, what do I have in my garage?"* — it should call `inventory_search` with `location: "garage"`.

To disconnect: delete the connector in ChatGPT; revoke the grant from Supabase (Authentication → OAuth
Apps) if you want it dead immediately.

## Known limits

- The token ChatGPT holds is an ordinary Supabase session for you, valid for the whole Supabase project
  (which also hosts another app's tables) — Supabase OAuth has no per-table scopes. Our endpoint only
  exposes the tools above, but a leaked ChatGPT token would carry your database rights until it expires
  (about an hour; refreshes can be revoked).
- Untracked items (tools, equipment) have no movement history; only pantry-tracked food does.
- Zones and containers come from the app's built-in lists (`src/data`); "garage" is a household alias
  for the workshop zones (see `ALIASES` in `api/_mcp-core.ts`). Tell Charlie if it's wrong.

## Tests

`npm test` → `tests/mcp.test.ts` (protocol, permissions, search, writes, confirmation tokens). It uses an
in-memory PostgREST stand-in; it does **not** prove ChatGPT's OAuth handshake, which can only be checked
live (below).
