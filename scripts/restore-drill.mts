// Rehearse a restore without touching any real database.
// Usage: npm run restore-drill -- export.json
// Builds a throwaway in-process Postgres (PGlite) from the real SQL files, runs the
// restore script generated from the export on it, and compares row counts.
import { readFileSync } from "node:fs";
import { supabaseLikeDb, runFile } from "../tests/supabase-harness.ts";
import { buildRestoreSql, parseBundle, TABLES, ExportFileError } from "../src/lib/exportBundle.ts";

const file = process.argv[2];
if (!file) { console.error("Usage: npm run restore-drill -- <export.json>"); process.exit(2); }

let bundle;
try { bundle = parseBundle(readFileSync(file, "utf8")); }
catch (e) { console.error(e instanceof ExportFileError ? `Can't use that file: ${e.message}` : e); process.exit(1); }

const db = await supabaseLikeDb();
for (const f of ["supabase-schema.sql", "supabase-family-access.sql", "supabase-pantry.sql"]) await runFile(db, f);
const results = await db.exec(buildRestoreSql(bundle));
const [missing, mismatched] = results.filter(r => r.rows.length || r.fields.length).slice(-2);

let bad = mismatched.rows.length;
for (const t of TABLES) {
  const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n;
  const gone = Number((missing.rows as { tbl: string; missing_after: number }[]).find(r => r.tbl === t)?.missing_after);
  const ok = n === bundle.counts[t] && gone === 0;
  if (!ok) bad++;
  console.log(`${t.padEnd(24)} in file ${String(bundle.counts[t]).padStart(5)}   restored ${String(n).padStart(5)}   missing ${gone}   ${ok ? "OK" : "MISMATCH"}`);
}
console.log(`pantry counts disagreeing with batches: ${mismatched.rows.length}`);
console.log(bad === 0 ? "\nDRILL PASSED — the export restores completely." : "\nDRILL FAILED");
process.exit(bad === 0 ? 0 : 1);
