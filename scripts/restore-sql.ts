// Usage: node --import ./tests/resolve-ts.mjs scripts/restore-sql.ts export.json > restore.sql
// Reads an ELK full export and writes the restore script to stdout. Touches no database.
import { readFileSync } from "node:fs";
import { buildRestoreSql, parseBundle, ExportFileError } from "../src/lib/exportBundle.ts";

const file = process.argv[2];
if (!file) { console.error("Usage: restore-sql.ts <export.json>"); process.exit(2); }
try {
  process.stdout.write(buildRestoreSql(parseBundle(readFileSync(file, "utf8"))));
} catch (e) {
  console.error(e instanceof ExportFileError ? `Can't use that file: ${e.message}` : e);
  process.exit(1);
}
