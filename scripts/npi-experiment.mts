// Provider Intelligence experiment — capture a run and/or grade it.
//
//   node --import ./tests/resolve-ts.mjs scripts/npi-experiment.mts capture [base] [out.json]
//       Runs the pipeline against a deployment (default https://elk-inventory.vercel.app):
//       registry search, saved-AI re-scoring, Brave pass on the product's picks + every
//       ground-truth case, raw registry views. ~20 Brave queries. NO OpenAI calls, unless
//       NPI_AI_KEY=<operator key> and NPI_AI_NPIS=npi,npi,… are set (paid, ~2 min each).
//
//   node --import ./tests/resolve-ts.mjs scripts/npi-experiment.mts report [run.json]
//       Grades a recorded run against src/npi/experiment/data/cases.json and prints
//       metrics per baseline + every case verdict. Exit code 0 even when cases FAIL:
//       failures are results, not errors.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { runExperiment } from "../src/npi/experiment/runner.ts";
import { BASELINES, cohortCounts, decideAll, gradeAll, metrics, pipelineStages } from "../src/npi/experiment/evaluate.ts";
import type { ExperimentRun, GroundTruthCase } from "../src/npi/experiment/types.ts";
import type { ReferralResearch } from "../src/npi/types.ts";

const root = new URL("..", import.meta.url);
const read = <T,>(p: string): T => JSON.parse(readFileSync(new URL(p, root), "utf8")) as T;
const DEFAULT_RUN = "src/npi/experiment/data/run.json";
const cases = read<GroundTruthCase[]>("src/npi/experiment/data/cases.json");

const [cmd = "report", a1, a2] = process.argv.slice(2);

if (cmd === "capture") {
  const base = a1 ?? "https://elk-inventory.vercel.app";
  const out = a2 ?? DEFAULT_RUN;
  let codeVersion: string | null = null;
  try { codeVersion = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(); } catch { /* not a checkout */ }
  const ai = process.env.NPI_AI_KEY && process.env.NPI_AI_NPIS ? { key: process.env.NPI_AI_KEY, npis: process.env.NPI_AI_NPIS.split(",").map((s) => s.trim()) } : undefined;
  const run = await runExperiment({
    base, specialty: "ENT / Otolaryngology", location: "Seattle, WA 98115", radius: 10, patientAge: 46,
    caseNpis: cases.map((c) => c.npi), snapshot: read<ReferralResearch[]>("src/npi/demo/seattle-ent-research.json"),
    ai, runner: "node scripts/npi-experiment.mts", codeVersion: codeVersion && `${codeVersion} (capturing checkout; the deployment may differ)`,
    onProgress: (m) => console.error(`· ${m}`),
  });
  writeFileSync(new URL(out, root), JSON.stringify(run));
  console.error(`wrote ${out}`);
  report(run);
} else {
  report(read<ExperimentRun>(a1 ?? DEFAULT_RUN));
}

function report(run: ExperimentRun) {
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const d = decideAll(run);
  console.log(`\nRUN ${run.meta.runId} · ${run.meta.base} · ${run.meta.capturedAt}`);
  console.log("\nPIPELINE");
  for (const s of pipelineStages(run, d)) console.log(`  ${String(s.n).padStart(2)} [${s.kind}] ${s.stage}: ${s.in ?? "—"} → ${s.out ?? "—"} · ${s.ms ?? "—"} ms · ${s.output}${s.failures.length ? `\n       failures: ${s.failures.join(" | ")}` : ""}`);
  console.log("\nWHOLE COHORT (no ground truth)");
  const cc = cohortCounts(run, d);
  for (const b of BASELINES) console.log(`  ${b.id} ${b.label.padEnd(38)} rec ${cc[b.id].recommended} · review ${cc[b.id].review} · unresolved ${cc[b.id].unresolved}`);
  const g = gradeAll(run, cases, d);
  console.log(`\nGROUND-TRUTH CASES: ${cases.length} (${cases.filter((c) => c.humanVerified).length} human-verified)`);
  console.log("  base  rec  ok  WRONG  unverif  review  unres | PASS FAIL UNRES | false-rec rate | ref-fax ok | AI calls  tokens in/out | brave");
  for (const m of metrics(run, g)) console.log(`  ${m.baseline}     ${String(m.recommended).padStart(3)} ${String(m.correct).padStart(3)} ${String(m.incorrect).padStart(6)} ${String(m.unverifiable).padStart(8)} ${String(m.review).padStart(7)} ${String(m.unresolved).padStart(6)} | ${String(m.pass).padStart(4)} ${String(m.fail).padStart(4)} ${String(m.unresolvedVerdicts).padStart(5)} | ${pct(m.falseRecRate.lower)}–${pct(m.falseRecRate.upper)} | ${m.verifiedReferralFax} | ${m.aiCalls} ${m.aiTokens.input}/${m.aiTokens.output} | ${m.braveQueries}`);
  for (const c of cases) {
    console.log(`\n  ${c.name} (${c.npi}) — expected: ${c.expected.outcome}${c.expected.outcomeIsJudgement ? " [judgement]" : ""}`);
    for (const b of BASELINES) {
      const x = g[b.id].find((y) => y.npi === c.npi)!;
      const dd = x.decision;
      console.log(`    ${b.id} ${x.overall.padEnd(10)} ${dd ? `${dd.group}${dd.fax ? ` fax ${dd.fax.number} (${dd.fax.cls})` : ""}` : "not in run"} :: ${[x.outcome, x.fax, x.location, x.identity].filter((k) => k.v === "FAIL" || k.v === "UNRESOLVED").map((k) => `${k.v}: ${k.why}`).join(" | ") || "all checks pass"}`);
    }
  }
}
