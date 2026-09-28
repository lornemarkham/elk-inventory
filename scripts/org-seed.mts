// Shared Organizational Knowledge POC — extract the public candidate seed from the
// RECORDED Provider Intelligence run (src/npi/experiment/data/run.json; read-only).
//
//   node --import ./tests/resolve-ts.mjs scripts/org-seed.mts
//
// Writes src/npi/org/seed-candidates.json: the nearest ENT providers whose WA licence
// is Active and whose NPPES record lists a fax. Deliberately a SMALL list — the POC
// does not manufacture coverage. Every value is exactly what NPPES/WA DOH returned.
import { readFileSync, writeFileSync } from "node:fs";
import type { ExperimentRun } from "../src/npi/experiment/types.ts";

const root = new URL("..", import.meta.url);
const run = JSON.parse(readFileSync(new URL("src/npi/experiment/data/run.json", root), "utf8")) as ExperimentRun;
const LIMIT = 10;

const picked = run.nearby.data!.results
  .filter((c) => c.nearest.faxDigits && c.license?.records.some((r) => r.status === "Active"))
  .sort((a, b) => a.nearest.distanceMi - b.nearest.distanceMi)
  .slice(0, LIMIT)
  .map((c) => ({
    npi: c.npi,
    name: c.name,
    credential: c.credential,
    specialty: c.specialty,
    practice: c.nearest.organization ?? c.sharedAddressOrgs[0] ?? null,
    line1: c.nearest.line1,
    city: c.nearest.city,
    postalCode: c.nearest.postalCode,
    distanceMi: c.nearest.distanceMi,
    phone: c.nearest.phone,
    fax: c.nearest.faxDigits,
    nppesLastUpdated: c.lastUpdated,
    licence: c.license!.records.find((r) => r.status === "Active")!.credentialNumber,
  }));

const out = {
  note: "Public candidates from the recorded Provider Intelligence run. NPPES/WA DOH values verbatim; no organization data.",
  runId: run.meta.runId,
  capturedAt: run.meta.capturedAt,
  input: run.meta.input,
  candidates: picked,
};
writeFileSync(new URL("src/npi/org/seed-candidates.json", root), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${picked.length} candidates from ${run.meta.runId}`);
