# Lessons Learned

Debugging discoveries, gotchas, and "next time do X" notes from real incidents — not general
advice, only things actually learned the hard way in this codebase.

### 2026-07-17 — `vercel dev` ignores `.env.local` for linked projects
For a linked Vercel project, `vercel dev` fetches env vars for serverless/edge functions live from
the Vercel API (Development-target vars) and explicitly ignores `.env.local` for that purpose —
confirmed via `vercel dev --debug` (`Ignoring /path/.env.local`). `.env.local` still works for the
Vite frontend (`VITE_`-prefixed vars, loaded by Vite itself), just not for `api/*` functions. Any
secret an `api/*` function needs must be added to the Development environment in the Vercel
dashboard/CLI, not just written to `.env.local`. Also: Sensitive-flagged env vars can never be read
back via CLI/dashboard after creation (`vercel env pull` shows `[SENSITIVE]`), so there's no way to
copy a sensitive var's value between environments except re-entering it at the source.

### 2026-07-17 — Blanket SPA rewrite breaks `vercel dev` asset serving
`vercel.json`'s `{"source": "/(.*)", "destination": "/index.html"}` catch-all rewrite matches every
request, including Vite's own internal asset/module requests. Under `vercel dev` this intercepts
`/src/main.tsx`, `/@vite/client`, and anything in `public/` before Vite's dev server can serve them,
so the browser gets `index.html`'s HTML content back for what should be a JS module — Vite then
throws "Failed to parse source for import analysis" for every asset. Fix: scope the rewrite to
extension-less, non-`/api/` paths only — `"/((?!api/|.*\\..*).*)"` — so real files and API routes
are left alone and only genuine SPA routes fall back to `index.html`. This had likely been silently
broken for any `vercel dev` browser session all along; it just hadn't been noticed because local
dev normally runs on plain `vite` and `vercel dev` was only reached for direct `curl` calls to
`/api/extract`. Follow-up: the same exclusion missed Vite's `@`-prefixed internal endpoints
(`/@vite/client`, `/@react-refresh`) since they have no file extension either — the working pattern
is `"/((?!api/|@|.*\\..*).*)"`, excluding `/api/`, anything starting with `@`, and anything with a
dot, in addition to the SPA fallback.

### 2026-07-17 — AI extraction produces the string `"null"`, not JSON `null`
Despite the strict JSON-schema response format on `/api/extract` allowing `["string", "null"]` for
nullable fields, gpt-4o-mini sometimes emits the literal 4-character string `"null"` instead of a
real null. `raw.purchaseDate?.trim() || null` doesn't catch that (a truthy non-empty string), so it
flowed straight into `purchase_drafts.suggested_purchase_date`, a Postgres `DATE` column, and failed
the insert outright (`invalid input syntax for type date: "null"`) — draft creation silently
returned zero drafts, which `CapturePage` then reported as "couldn't find a product in that photo,"
masking a perfectly successful extraction. Fixed with a `nullableAiString()` guard in
`purchaseParser.ts` that treats `"null"`/`"undefined"` (case-insensitive) as null across every
nullable AI field, not just the one that happened to hit a typed column.

### 2026-07-17 — Review-screen edits were being silently discarded on Approve
`ApproveAction.fields` (built by `CapturePage.actionFor()`) never included brand, model, vendor,
price, purchase date, or product URL — so `approveDraft()` fell back to re-reading those straight
off the *original* draft row (`draft.suggestedX`) instead of whatever the user had just edited in
"Add more detail." Brand wasn't even read from anywhere — `ApprovedFields` never had a `brand` field
at all, despite `InventoryItem.brand` and the `brand` column both already existing. Fixed by
threading all of these through `ApprovedFields` from the live Confirm-screen state. No schema
change needed — `attributes` is already JSONB and `brand` was already a real column, just never
populated on the approval path.

### 2026-07-17 — AI-derived info that's still deliberately not preserved (V1.1 backlog)
Two things `/api/extract` already gives us that don't make it into the saved item, investigated
while chasing the bug above and deliberately deferred rather than built into V1:
- **The captured photo itself** — `InventoryItem.photoPath` is always written as `""`. No code
  anywhere uploads the image to storage; it's read into base64, sent to OpenAI, and discarded.
  Fixing this needs a new Supabase Storage bucket + storage RLS policies, which requires either the
  Supabase SQL editor or a service-role/management credential — neither available in this session
  (no Supabase CLI is linked in this repo, no access token in the environment). When picked up:
  upload the `File` from `CapturePage.handlePhotoCapture` to a bucket (e.g. `capture-photos`) keyed
  by the new item's id, then set `photoPath` to the resulting path/URL in `approveDraft()`.
- **AI's per-product confidence score** — `RawAiProduct.confidence` is computed by the model but
  dropped in `aiProductToExtractedFields` and never reaches `purchase_drafts` (no column for it) or
  `inventory_items`. Preserving it needs a small client-side side-channel (map extraction-time
  `draftId → confidence`, since it can't round-trip through the draft row without a schema change)
  threaded into `ApprovedFields` and folded into `attributes.aiConfidence` at approval time — same
  pattern as the brand/model fix above, just not done tonight to keep the fix set small.

<!-- ### YYYY-MM-DD — Short title
Brief capture of the idea and why it came up. -->
