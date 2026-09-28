// ── /npi-list/experiment — Provider Intelligence as an engineering experiment ─
// Not a demo. Shows one recorded pipeline run end to end (every stage, every
// model call, every fetched page), grades it against ground-truth cases with
// four baselines, and lists what is wrong with it — including the experiment.
// Everything numeric on this page is computed from ./data/run.json +
// ./data/cases.json by ./evaluate.ts at render time; "Run live" re-records.
import { useEffect, useMemo, useState } from "react";
import type { ReferralResearch, ReferralView, ScoreItem } from "../types";
import { getDemoKey, operatorMode } from "../api";
import { Icon } from "../ui";
import { BASELINES, aiJudgements, cohortCounts, decideAll, gradeAll, metrics, pipelineStages, type BaselineId, type CaseGrade, type Decisions, type Metrics, type Verdict } from "./evaluate";
import { runExperiment } from "./runner";
import type { ExperimentRun, GroundTruthCase } from "./types";
import "../demo/demo.css";
import "./experiment.css";

interface Loaded { run: ExperimentRun; cases: GroundTruthCase[]; snapshot: ReferralResearch[] }

async function load(): Promise<Loaded> {
  const [run, cases, snap] = await Promise.all([import("./data/run.json"), import("./data/cases.json"), import("../demo/seattle-ent-research.json")]);
  return { run: run.default as unknown as ExperimentRun, cases: cases.default as unknown as GroundTruthCase[], snapshot: snap.default as unknown as ReferralResearch[] };
}

const fmtMs = (ms: number | null | undefined) => (ms === null || ms === undefined ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const date = (iso: string) => iso.replace("T", " ").slice(0, 16) + " UTC";

export default function Experiment() {
  const [base, setBase] = useState<Loaded | null>(null);
  const [live, setLive] = useState<ExperimentRun | null>(null);
  const [useLive, setUseLive] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { load().then(setBase).catch((e: Error) => setErr(e.message)); }, []);

  if (err) return <div className="ex"><p className="ex-bad">Could not load the recorded run: {err}</p></div>;
  if (!base) return <div className="ex"><p className="ex-muted">Loading recorded run…</p></div>;
  const run = useLive && live ? live : base.run;
  return <Report run={run} cases={base.cases} snapshot={base.snapshot} recorded={base.run} live={live} useLive={useLive} setUseLive={setUseLive} setLive={setLive} />;
}

function Report({ run, cases, snapshot, recorded, live, useLive, setUseLive, setLive }: { run: ExperimentRun; cases: GroundTruthCase[]; snapshot: ReferralResearch[]; recorded: ExperimentRun; live: ExperimentRun | null; useLive: boolean; setUseLive: (b: boolean) => void; setLive: (r: ExperimentRun) => void }) {
  const decisions = useMemo(() => decideAll(run), [run]);
  const grades = useMemo(() => gradeAll(run, cases, decisions), [run, cases, decisions]);
  const m = useMemo(() => metrics(run, grades), [run, grades]);
  const cohort = useMemo(() => cohortCounts(run, decisions), [run, decisions]);
  const stages = useMemo(() => pipelineStages(run, decisions), [run, decisions]);
  const nb = run.nearby.data;

  return (
    <div className="ex">
      <header className="ex-top">
        <div>
          <div className="ex-kicker">Provider Intelligence · engineering experiment</div>
          <h1>Does evidence gathering + AI research route referrals accurately and economically?</h1>
        </div>
        <nav className="ex-nav">
          <a href="#status">Status</a><a href="#funnel">Denominator</a><a href="#failures">Failures</a><a href="#pipeline">Pipeline</a><a href="#ai">AI calls</a>
          <a href="#scores">Scores</a><a href="#harness">Test harness</a><a href="#baselines">Baselines</a><a href="#evidence">Raw evidence</a><a href="#wrong">Why this may be wrong</a><a href="#reproduce">Reproduce</a>
        </nav>
      </header>

      <section id="status" className="ex-status">
        <h2><Icon name="alert" /> Status: open question — not established</h2>
        <p><strong>This POC has not shown that Provider Intelligence works.</strong> What it shows is that the pipeline can gather, corroborate and classify provider information. Whether that improves referral routing <em>accurately</em> and <em>economically</em> is still an open question. This page is set up to answer it, not to argue for it.</p>
        <ul>
          <li>Ground truth: <strong>{cases.length} cases, {cases.filter((c) => c.humanVerified).length} human-verified</strong>. Every expected fact was drafted by Claude subagents from primary sources. So wherever this page grades the pipeline, it is <strong>AI checking AI-assisted output</strong> until a person signs the cases off.</li>
          <li>AI in this run: <strong>{Object.keys(run.liveAi).length} live model calls</strong>. All AI evidence shown comes from research saved on <strong>{[...new Set(run.meta.snapshotResearchedAt.map((s) => s.slice(0, 10)))].join(", ") || "—"}</strong> ({run.meta.snapshotResearchedAt.length} providers) and re-scored now. A normal viewer never triggers AI; only an operator with the key can.</li>
          <li>Scores are hand-weighted <strong>rule points</strong> out of 100, <strong>not probabilities</strong>, and have never been calibrated against outcomes.</li>
        </ul>
        <RunBar run={run} recorded={recorded} live={live} useLive={useLive} setUseLive={setUseLive} setLive={setLive} cases={cases} snapshot={snapshot} />
      </section>

      {nb && <Funnel run={run} decisions={decisions} />}
      <Failures run={run} grades={grades} cases={cases} />
      <Pipeline stages={stages} />
      <AiCalls run={run} />
      <Scores run={run} decisions={decisions} />
      <Harness cases={cases} grades={grades} />
      <Baselines m={m} cohort={cohort} total={nb?.results.length ?? 0} cases={cases} aiCases={cases.filter((c) => run.savedAi[c.npi]?.ok || run.liveAi[c.npi]?.ok).length} />
      <Evidence run={run} cases={cases} grades={grades} decisions={decisions} />
      <Wrong run={run} cases={cases} m={m} />
      <Reproduce run={run} grades={grades} cases={cases} />
    </div>
  );
}

// ── Run controls ─────────────────────────────────────────────────────────────

function RunBar({ run, recorded, live, useLive, setUseLive, setLive, cases, snapshot }: { run: ExperimentRun; recorded: ExperimentRun; live: ExperimentRun | null; useLive: boolean; setUseLive: (b: boolean) => void; setLive: (r: ExperimentRun) => void; cases: GroundTruthCase[]; snapshot: ReferralResearch[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [withAi, setWithAi] = useState(false);
  const op = operatorMode() && Boolean(getDemoKey());
  const start = async () => {
    setBusy("Starting…");
    const i = recorded.meta.input;
    const r = await runExperiment({
      base: "", specialty: i.specialty, location: i.location, radius: i.radius, patientAge: i.patientAge,
      caseNpis: cases.map((c) => c.npi), snapshot, runner: "browser (Run live)", onProgress: setBusy,
      ai: op && withAi ? { key: getDemoKey()!, npis: snapshot.map((s) => s.npi) } : undefined,
    });
    setLive(r); setUseLive(true); setBusy(null);
  };
  return (
    <div className="ex-runbar">
      <div>
        Showing <strong>{useLive ? "a live run from this browser" : "the recorded run"}</strong> <code>{run.meta.runId}</code>, captured {date(run.meta.capturedAt)} by <code>{run.meta.runner}</code> against <code>{run.meta.base}</code>{run.meta.codeVersion && <> · code {run.meta.codeVersion}</>}.
      </div>
      <div className="ex-runbar-actions">
        {live && <button className="ex-btn" onClick={() => setUseLive(!useLive)}>{useLive ? "Show recorded run" : "Show live run"}</button>}
        <button className="ex-btn ex-btn-primary" disabled={Boolean(busy)} onClick={start}>{busy ? <><span className="pi-spinner" /> {busy}</> : "Run live (≈20 Brave queries, 0 AI calls)"}</button>
        {op && <label className="ex-muted"><input type="checkbox" checked={withAi} onChange={(e) => setWithAi(e.target.checked)} /> operator: also run fresh AI research on the {snapshot.length} snapshot providers (paid; ~2 min each)</label>}
      </div>
    </div>
  );
}

// ── 5. The denominator ───────────────────────────────────────────────────────

function Funnel({ run, decisions }: { run: ExperimentRun; decisions: Decisions }) {
  const nb = run.nearby.data!;
  const nppes = nb.trace?.find((t) => t.id === "nppes")?.out ?? nb.scanned.records;
  const s = Object.values(decisions).map((d) => d.S);
  const prod = Object.values(run.discovery).filter((d) => d.role === "production").length;
  const steps: [number, string][] = [
    [nppes, "NPPES records (ENT taxonomy, WA)"],
    [nb.results.length, `in-radius candidates (${nb.radiusMi} mi)`],
    [Object.values(run.savedAi).filter((t) => t.ok).length, "saved AI-researched (Sep 28 snapshot)"],
    [prod, "cheap-web checked (Brave, no AI)"],
    [s.filter((d) => d.group === "recommended").length, "Recommended"],
    [s.filter((d) => d.group === "review").length, "Needs review"],
    [s.filter((d) => d.group === "unresolved").length, "unresolved (never checked, or not corroborated)"],
  ];
  return (
    <section id="funnel">
      <h2>The full result set (as shipped)</h2>
      <ol className="ex-funnel">{steps.map(([n, l]) => <li key={l}><span className="ex-funnel-n">{n}</span><span>{l}</span></li>)}</ol>
      <p className="ex-muted">The Recommended count only means something against the {nb.results.length} candidates it came from. {s.filter((d) => d.group === "unresolved").length} of them ({pct(s.filter((d) => d.group === "unresolved").length / nb.results.length)}) had no web evidence of any kind, so the product never evaluated them. The M026 trace of this same search (earlier on Sep 28) got 4 / 8 / 246. The difference is flaky third-party page fetches: the same input gives a different output on a different run.</p>
    </section>
  );
}

// ── 4. Known failures / counterexamples ──────────────────────────────────────

function Failures({ run, grades, cases }: { run: ExperimentRun; grades: Record<BaselineId, CaseGrade[]>; cases: GroundTruthCase[] }) {
  const thomas = run.discovery["1457413643"]?.data?.log.pages ?? [];
  const sidebar = thomas.find((p) => /henry-ou/.test(p.url));
  const conflicts = Object.values(run.savedAi).reduce((n, t) => n + (t.data?.research?.conflicts.length ?? 0), 0);
  const stale = (run.nearby.data?.results ?? []).filter((c) => c.lastUpdated && (Date.parse(run.meta.capturedAt) - Date.parse(c.lastUpdated)) / 3.15e10 > 5).length;
  const total = run.nearby.data?.results.length ?? 0;
  const fails = BASELINES.flatMap((b) => grades[b.id].filter((g) => g.overall === "FAIL").map((g) => ({ b: b.id, g })));
  const name = (npi: string) => cases.find((c) => c.npi === npi)?.name ?? npi;
  const items: [string, React.ReactNode][] = [
    ["Doximity “Similar Physicians” sidebar = false identity corroboration", <>Brave pass for Herbert Thomas fetched <code>doximity.com/pub/henry-ou-md</code>, and {sidebar ? <>this run {sidebar.accepted ? <strong>ACCEPTED it again</strong> : "rejected it"}: “{sidebar.reason}”</> : "this run did not fetch it (fetch order varies)"}. <strong>Why:</strong> <code>nameOnPage</code> and <code>addressOnPage</code> each search the <em>whole page</em>. Nothing requires the name and the address to sit next to each other, so a sidebar name plus the page owner’s address passes. It was harmless here only because Ou and Thomas share a hospital address. The harness catches it with a URL-slug heuristic and the curated <code>wrongEvidence</code> list.</>],
    ["Specialty / subspecialty routing is weak", <>Jyoti Sharma, a cosmetic facial plastic surgeon, is <strong>Recommended</strong> for asymmetric hearing loss. <strong>Why:</strong> the AI said “different specialty”, but <code>specialtyReallyDiffers</code> overrode it because “Facial Plastic Surgery” shares a word with her NPPES taxonomy. Routing then accepts any <code>207Y*</code> code. Fit has three rules (pediatric wording, licence profession, research says different), and none of them is about subspecialty versus clinical reason. The NPPES-only baseline recommends Strohl, a head-and-neck cancer surgeon, for the same reason.</>],
    ["AI conflict information is ignored", <>The saved research contains <strong>{conflicts} model-reported conflicts</strong>. <strong>No rule reads them.</strong> Examples: Sharma, “current main site omits fax”; Langman, official UW clinic pages don’t list him (only an insurer directory does). Both are still Recommended. <strong>Why:</strong> <code>research.conflicts</code> is displayed but is never an input to <code>scoreProvider</code>, <code>scoreReferral</code> or <code>assessDestination</code>.</>],
    ["Stale NPPES data is the baseline", <>{stale} of {total} in-radius candidates ({pct(total ? stale / total : null)}) have an NPPES record last updated more than 5 years ago. Ground truth found examples: Jason Park now practises in Tennessee (WA residency licence expired 2021); Brandstetter is at Kaiser in California (WA licence expired 2021); Inglis is professor emeritus; Langman’s record dates from 2007. <strong>Why it matters:</strong> baselines A and B take the NPPES fax at face value.</>],
    ["Office fax ≠ verified referral fax", <>Most Recommended destinations use an <strong>office</strong> fax (referral use not confirmed). Hume’s fax is labelled “referral-verified” by the pipeline, but the ground-truth agent could not read UW’s referral page (HTTP 403) and saw the number only as a site-footer “Fax:”, so the harness grades that claim UNRESOLVED. Seattle Children’s real intake fax is <code>206-985-3121</code>. The AI found it for Langman, but <code>finalizeResearch</code> dropped it because its source id wasn’t in the search results. Meanwhile the Brave pass picked up the NPPES fax <code>206-987-3878</code> for Horn and Thomas, and that number appears on no official page ground truth could find.</>],
    ["Cached research freshness", <>Every viewer’s AI evidence was generated between {[...run.meta.snapshotResearchedAt].sort()[0]?.slice(0, 16).replace("T", " ")} and {[...run.meta.snapshotResearchedAt].sort().pop()?.slice(11, 16)} UTC and is <strong>frozen</strong>. It is re-scored with today’s rules against today’s NPPES. Nothing re-checks whether the pages still say what the AI read. Browser-cached research (<code>localStorage npi-research:v3:*</code>) <strong>never expires</strong> and overrides the snapshot. The server cache lasts 24 h per edge instance.</>],
    ["Licence-number mapping gives a false “licence closed”", <>Madeleine Strohl’s NPPES licence <code>MD61493073</code> maps to her <em>closed</em> Interstate Compact credential (<code>IMLC.MD.61493073</code>). WA DOH also shows an <strong>Active</strong> <code>MD.MD.61399067</code>. The pipeline says “licence closed”. Baseline B withholds her for the wrong reason and scores PASS on outcome by luck. The harness cannot see “right answer, wrong reason”.</>],
    ["Good destinations are missed", <>Jacob Bloom, an adult general ENT with a middle-ear interest at UW Northwest, accepting new patients, ~4 mi away, is <strong>unresolved in every baseline</strong>. His NPPES addresses aren’t his current clinic, and he isn’t among the 8 nearest that the product auto-checks. Missed-good-destination is not visible in the product UI at all.</>],
    ["Same input, different output", <>Third-party fetches fail intermittently (Doximity HTTP 410, zocdoc 403, timeouts), and Brave result order changes. The M026 trace and this recording differ on the same search. A failed fetch is reported, but it still changes which providers reach Needs review.</>],
  ];
  return (
    <section id="failures" className="ex-failures">
      <h2><Icon name="x" /> Known failures and counterexamples</h2>
      <ol className="ex-fail-list">{items.map(([t, body]) => <li key={t}><strong>{t}.</strong> {body}</li>)}</ol>
      <h3>Harness-detected FAILs in this run ({fails.length})</h3>
      <table className="ex-table ex-compact">
        <thead><tr><th>Baseline</th><th>Provider</th><th>What failed</th></tr></thead>
        <tbody>{fails.map(({ b, g }) => <tr key={b + g.npi}><td>{b}</td><td>{name(g.npi)}</td><td>{[g.outcome, g.fax, g.location, g.identity].filter((c) => c.v === "FAIL").map((c) => c.why).join(" · ")}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

// ── 1. Pipeline run ──────────────────────────────────────────────────────────

const Kind = ({ k }: { k: string }) => <span className={`ex-kind ex-kind-${k.split(" ")[0].toLowerCase()}`}>{k}</span>;

function Pipeline({ stages }: { stages: ReturnType<typeof pipelineStages> }) {
  return (
    <section id="pipeline">
      <h2>The pipeline run, stage by stage</h2>
      <p className="ex-muted"><Kind k="HUMAN" /> a person decided · <Kind k="DET" /> fixed code rules · <Kind k="EXTERNAL" /> an outside data source · <Kind k="AI" /> a model’s output. “DET over cached AI” means code re-scoring saved model output: no model runs, but the inputs are AI judgements. Times for server sub-stages come from the <code>trace</code> field of <code>/api/npi-nearby</code>, and Brave/fetch times from <code>log.timings</code>. Stage 1 duration includes its parallel work.</p>
      <table className="ex-table">
        <thead><tr><th>#</th><th>Stage</th><th>Type</th><th>Source</th><th>In → out</th><th>Output</th><th>Time</th><th>Cost</th><th>Failures / refusals</th></tr></thead>
        <tbody>
          {stages.map((s) => (
            <tr key={s.n}>
              <td>{s.n}</td><td><strong>{s.stage}</strong><div className="ex-muted">{s.input}</div></td><td><Kind k={s.kind} /></td><td className="ex-src">{s.source}</td>
              <td className="ex-num">{s.in ?? "—"} → {s.out ?? "—"}</td><td>{s.output}</td><td className="ex-num">{fmtMs(s.ms)}</td><td>{s.cost}</td>
              <td>{s.failures.length ? <ul className="ex-fails">{s.failures.slice(0, 8).map((f, i) => <li key={i}>{f}</li>)}{s.failures.length > 8 && <li>…{s.failures.length - 8} more (see raw evidence)</li>}</ul> : <span className="ex-muted">none</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 2. Exactly where AI is used ──────────────────────────────────────────────

function AiCalls({ run }: { run: ExperimentRun }) {
  const rows = [
    ...Object.entries(run.savedAi).map(([npi, t]) => ({ npi, v: t.data, live: false, servedMs: t.ms })),
    ...Object.entries(run.liveAi).map(([npi, t]) => ({ npi, v: t.data?.view ?? null, live: true, servedMs: t.ms })),
  ].filter((r) => r.v?.research);
  const tot = rows.reduce((a, r) => ({ i: a.i + r.v!.research!.usage.inputTokens, o: a.o + r.v!.research!.usage.outputTokens, s: a.s + r.v!.research!.usage.searchCalls }), { i: 0, o: 0, s: 0 });
  return (
    <section id="ai">
      <h2>Exactly where AI is used</h2>
      <p>AI is used in <strong>one place</strong>: <code>researchProvider()</code> in <code>api/_npi-referral.ts</code>, behind the operator key. Every provider researched costs two model calls:</p>
      <table className="ex-table ex-compact">
        <thead><tr><th>Call</th><th>Model (configured)</th><th>Purpose</th><th>Evidence provided</th><th>Output</th></tr></thead>
        <tbody>
          <tr><td>1 · research</td><td><code>gpt-5.4</code> (fallback <code>gpt-4.1</code> on HTTP 400/404), Responses API + <code>web_search</code> tool, reasoning effort low, ≤8k output tokens, 170 s timeout</td><td>Search the open web and write a report on where and how to refer to this provider</td><td>NPPES facts only (<code>npiFacts</code>: name, credential, taxonomies + licence numbers, practice addresses/phones/faxes, authorised official, last-updated). <strong>No patient data.</strong> The model chooses its own queries and pages.</td><td>Free-text report + the URLs its searches returned</td></tr>
          <tr><td>2 · extraction</td><td><code>gpt-4.1-mini</code> (fallback <code>gpt-4o-mini</code>), strict JSON schema</td><td>Turn the report into structured claims</td><td>NPPES facts + first 24k chars of the report + numbered source URLs</td><td>identity, specialty, affiliations, sources (+family, currentness, about-different-provider), locations with phones/faxes + verbatim labels, conflicts, licences</td></tr>
        </tbody>
      </table>
      <p className="ex-muted">Not AI, despite looking like it: the Brave public-web check (usage says <code>researchModel: "none"</code>), every score, every grouping, and the inbound-fax “AI reading” in the referral demo (simulated regex).</p>
      <h3>Every model call behind this run ({rows.length * 2} calls, {rows.filter((r) => r.live).length * 2} live)</h3>
      <table className="ex-table">
        <thead><tr><th>Provider</th><th>Models</th><th>Cached / live</th><th>Web searches</th><th>Tokens in / out (both calls)</th><th>Latency at generation</th><th>Served in this run</th><th>Cost</th><th>Output</th></tr></thead>
        <tbody>
          {rows.map(({ npi, v, live, servedMs }) => {
            const r = v!.research!;
            return (
              <tr key={npi + live}>
                <td>{v!.provider.name}<div className="ex-muted ex-mono">{npi}</div></td>
                <td className="ex-mono">{r.usage.researchModel} → {r.usage.extractModel}</td>
                <td>{live ? <span className="ex-kind ex-kind-ai">LIVE</span> : <>cached · {date(r.researchedAt)}</>}</td>
                <td className="ex-num">{r.usage.searchCalls}</td>
                <td className="ex-num">{r.usage.inputTokens.toLocaleString()} / {r.usage.outputTokens.toLocaleString()}</td>
                <td className="ex-num">{fmtMs(r.usage.durationMs)}</td>
                <td className="ex-num">{fmtMs(servedMs)}{!live && " (re-score only)"}</td>
                <td>not recorded</td>
                <td>{r.sources.length} sources · {r.locations.length} locations · {r.conflicts.length} conflicts · {r.dropped.length} claims dropped by code</td>
              </tr>
            );
          })}
          <tr className="ex-total"><td>Total</td><td /><td /><td className="ex-num">{tot.s}</td><td className="ex-num">{tot.i.toLocaleString()} / {tot.o.toLocaleString()}</td><td /><td /><td>$ not recorded (no billing data in repo)</td><td /></tr>
        </tbody>
      </table>
      <p className="ex-muted">Token counts are recorded per provider for the two calls combined. The split between the calls was not recorded. Dollar cost can’t be computed from the repo: model and search-tool pricing are not stored, and neither is OpenAI billing.</p>
      <h3>Which resulting fields are AI judgements</h3>
      <p className="ex-muted">The code never takes a number from the model, but these model yes/no and category outputs directly add or remove points or change the grouping. Values below are for each AI-researched provider in this run.</p>
      {rows.map(({ npi, v }) => (
        <details key={npi} className="ex-details">
          <summary>{v!.provider.name}</summary>
          <table className="ex-table ex-compact"><thead><tr><th>AI-judged field</th><th>Value</th><th>Effect on result</th></tr></thead>
            <tbody>{aiJudgements(v!).map((j) => <tr key={j.field}><td className="ex-mono">{j.field}</td><td>{j.value}</td><td>{j.effect}</td></tr>)}</tbody></table>
        </details>
      ))}
    </section>
  );
}

// ── 3. Scores are rule points ────────────────────────────────────────────────

function ScoreTable({ items, title }: { items: ScoreItem[]; title: string }) {
  const sum = items.reduce((s, i) => s + i.points, 0);
  return (
    <table className="ex-table ex-compact ex-score">
      <thead><tr><th colSpan={2}>{title}</th></tr></thead>
      <tbody>
        {items.map((i, n) => <tr key={n}><td>{i.label}</td><td className="ex-num">{i.points > 0 ? `+${i.points}` : i.points}</td></tr>)}
        <tr className="ex-total"><td>Sum (clamped 0–100)</td><td className="ex-num">{Math.max(0, Math.min(100, sum))} pts</td></tr>
      </tbody>
    </table>
  );
}

function Scores({ run, decisions }: { run: ExperimentRun; decisions: Decisions }) {
  const d = decisions["1790313880"]?.S;
  return (
    <section id="scores">
      <h2>The 0–100 numbers are rule points, not probabilities</h2>
      <p>“Provider verification” and “Destination evidence” are sums of hand-set points (<code>api/_npi-score.ts</code>), clamped to 0–100. The weights were chosen by the developers and <strong>have never been fitted or calibrated against outcomes</strong>. 95 pts does <strong>not</strong> mean a 95% chance of being right. With only {Object.keys(run.savedAi).length + Object.values(run.discovery).filter((x) => x.data?.view).length} researched providers and no human-verified labels, calibration isn’t possible yet. Neither score gates Recommended by itself. Grouping comes from a list of “review reasons” (<code>assessDestination</code>), and destination points matter only below 50.</p>
      {d?.scoreItems && (
        <>
          <p>Worked example: Jyoti Sharma, a cosmetic facial plastic surgeon whom ground truth says not to recommend for this referral. Shipped-product group in this run: <strong>{d.group}</strong>. Each line is one rule firing:</p>
          <div className="ex-cols">
            <ScoreTable items={d.scoreItems.verification} title={`Provider verification — ${d.verification} pts`} />
            <ScoreTable items={d.scoreItems.destination} title={`Destination evidence (chosen location) — ${d.destination} pts`} />
          </div>
          <p className="ex-muted">Review reasons fired: {d.reasons.length ? d.reasons.join("; ") : <strong>none → Recommended</strong>}. The “Specialty corroborated” points come from the model’s specialty value after the code’s word-stem override.</p>
        </>
      )}
    </section>
  );
}

// ── 6. Test harness ──────────────────────────────────────────────────────────

const V = ({ v }: { v: Verdict }) => <span className={`ex-v ex-v-${v.toLowerCase().replace("/", "")}`}>{v}</span>;

function Harness({ cases, grades }: { cases: GroundTruthCase[]; grades: Record<BaselineId, CaseGrade[]> }) {
  return (
    <section id="harness">
      <h2>Test harness: known cases, expected facts, PASS / FAIL / UNRESOLVED</h2>
      <p>Each case gives the expected identity, licence, current specialty, current practice location(s), fax(es) with verbatim labels and whether each is a referral fax, and the expected referral-fit outcome for scenario A (adult, 46, asymmetric SNHL, ENT referral). Cases live in <code>src/npi/experiment/data/cases.json</code>. Add a case there and it is graded on the next run.</p>
      <ul className="ex-rules">
        <li><strong>Cohorts:</strong> {cases.filter((c) => c.cohort === "pipeline-evaluated").length} providers the product itself evaluated (7 AI + 8 Brave), plus {cases.filter((c) => c.cohort === "random-sample").length} drawn at random from the unresolved individuals (sha256("m027:"+NPI), lowest 5) to measure what the product misses.</li>
        <li><strong>Outcome:</strong> expected <em>not recommend</em> + Recommended = <V v="FAIL" /> (false recommendation). + Needs review = <V v="PASS" />. + unresolved = <V v="UNRESOLVED" />, <strong>never</strong> counted as a correct rejection. Expected <em>recommend</em> + review/unresolved = <V v="UNRESOLVED" /> (missed). Expected <em>unknown</em> = <V v="UNRESOLVED" /> whatever the output.</li>
        <li><strong>Fax / location</strong> are graded only when Recommended: the fax must be an established official fax, and the location must match an established practice (house number + street). If there is no established fact, the check is <V v="UNRESOLVED" />. A “referral-verified” claim that ground truth can’t confirm is <V v="UNRESOLVED" />.</li>
        <li><strong>Identity:</strong> <V v="FAIL" /> if any evidence URL is on the case’s <code>wrongEvidence</code> list or is a person-profile URL whose slug lacks the provider’s last name (heuristic).</li>
        <li><strong>Overall:</strong> any FAIL → FAIL; else any UNRESOLVED → UNRESOLVED; else PASS.</li>
        <li><strong>Provenance:</strong> <strong>0 cases are human-verified.</strong> Expectations marked ◆ rest on a judgement (clinical or operational), not a fact.</li>
      </ul>
      <table className="ex-table">
        <thead><tr><th>Case</th><th>Expected outcome</th><th>Basis</th>{BASELINES.map((b) => <th key={b.id} title={b.rule}>{b.id}</th>)}</tr></thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.npi}>
              <td><a href={`#ev-${c.npi}`}>{c.name}</a><div className="ex-muted">{c.cohort === "random-sample" ? "random sample" : "pipeline-evaluated"}</div></td>
              <td>{c.expected.outcome.replace("_", " ")}{c.expected.outcomeIsJudgement && " ◆"}</td>
              <td className="ex-small">{c.expected.outcomeBasis}</td>
              {BASELINES.map((b) => { const g = grades[b.id].find((x) => x.npi === c.npi)!; return <td key={b.id} title={[g.outcome, g.fax, g.location, g.identity].map((k) => `${k.v}: ${k.why}`).join("\n")}><V v={g.overall} /><div className="ex-muted ex-small">{g.decision?.group ?? "—"}</div></td>; })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ex-muted">Hover a cell for the four checks. Full reasoning is in the raw-evidence section.</p>
    </section>
  );
}

// ── 7 + 8. Baselines and false recommendations ───────────────────────────────

function Baselines({ m, cohort, total, cases, aiCases }: { m: Metrics[]; cohort: ReturnType<typeof cohortCounts>; total: number; cases: GroundTruthCase[]; aiCases: number }) {
  const byId = Object.fromEntries(m.map((x) => [x.baseline, x])) as Record<BaselineId, Metrics>;
  const known = cases.filter((c) => c.expected.outcome !== "unknown").length;
  const delta = (a: BaselineId, b: BaselineId) => {
    const x = byId[a], y = byId[b];
    return `${y.correct - x.correct >= 0 ? "+" : ""}${y.correct - x.correct} correct rec · ${y.incorrect - x.incorrect >= 0 ? "+" : ""}${y.incorrect - x.incorrect} incorrect rec · ${y.pass - x.pass >= 0 ? "+" : ""}${y.pass - x.pass} PASS · ${y.fail - x.fail >= 0 ? "+" : ""}${y.fail - x.fail} FAIL · ${y.unresolvedVerdicts - x.unresolvedVerdicts >= 0 ? "+" : ""}${y.unresolvedVerdicts - x.unresolvedVerdicts} UNRESOLVED`;
  };
  return (
    <section id="baselines">
      <h2>Baselines: does each layer earn its cost?</h2>
      <table className="ex-table ex-compact">
        <thead><tr><th>Id</th><th>Baseline</th><th>Rule</th></tr></thead>
        <tbody>{BASELINES.map((b) => <tr key={b.id}><td>{b.id}</td><td>{b.label}{b.ai && " (uses AI)"}</td><td className="ex-small">{b.rule}</td></tr>)}</tbody>
      </table>
      <h3>On the {cases.length} ground-truth cases ({known} with a known expected outcome)</h3>
      <table className="ex-table ex-metrics">
        <thead><tr><th>Metric</th>{m.map((x) => <th key={x.baseline}>{x.baseline}</th>)}</tr></thead>
        <tbody>
          {([
            ["Recommended", (x) => x.recommended],
            ["— correct (outcome + fax + location PASS)", (x) => x.correct],
            ["— INCORRECT (any FAIL)", (x) => <strong className={x.incorrect ? "ex-bad" : ""}>{x.incorrect}</strong>],
            ["— correctness unverifiable", (x) => x.unverifiable],
            ["False-Recommended rate (proven … worst case)", (x) => <strong>{pct(x.falseRecRate.lower)} … {pct(x.falseRecRate.upper)}</strong>],
            ["Needs review", (x) => x.review],
            ["Unresolved", (x) => x.unresolved],
            ["Missed (expected usable, not recommended)", (x) => x.missed],
            ["Verified referral fax on a correct recommendation", (x) => x.verifiedReferralFax],
            ["Case verdicts PASS / FAIL / UNRESOLVED", (x) => `${x.pass} / ${x.fail} / ${x.unresolvedVerdicts}`],
            ["Registry search latency (all 258 at once)", (x) => fmtMs(x.latencyMs.search)],
            ["Extra latency per provider as served in this run (median; cached AI = re-score time)", (x) => fmtMs(x.latencyMs.perProviderMedian)],
            ["AI model calls behind the evidence", (x) => x.aiCalls],
            ["— of which live in this run", (x) => x.aiLiveCalls],
            ["AI tokens in / out", (x) => `${x.aiTokens.input.toLocaleString()} / ${x.aiTokens.output.toLocaleString()}`],
            ["AI wall time at generation (sum)", (x) => fmtMs(x.aiGenerationMs || null)],
            ["Brave queries (paid) / pages fetched", (x) => `${x.braveQueries} / ${x.pagesFetched}`],
            ["$ cost", () => "not recorded"],
          ] as [string, (x: Metrics) => React.ReactNode][]).map(([label, f]) => <tr key={label}><td>{label}</td>{m.map((x) => <td key={x.baseline} className="ex-num">{f(x)}</td>)}</tr>)}
        </tbody>
      </table>
      <h3>Incremental effect of each layer (same cases)</h3>
      <ul className="ex-rules">
        <li><strong>B − A (add WA licence):</strong> {delta("A", "B")}</li>
        <li><strong>C − B (add deterministic web corroboration):</strong> {delta("B", "C")}</li>
        <li><strong>D − C (add AI research):</strong> {delta("C", "D")}. AI evidence exists for only {aiCases} of these cases, so D−C is measured on {aiCases} providers at most.</li>
      </ul>
      <h3>Whole cohort ({total} candidates, no ground truth)</h3>
      <table className="ex-table ex-compact">
        <thead><tr><th /><th>Recommended</th><th>Needs review</th><th>Unresolved</th></tr></thead>
        <tbody>{BASELINES.map((b) => <tr key={b.id}><td>{b.id} · {b.label}</td><td className="ex-num">{cohort[b.id].recommended}</td><td className="ex-num">{cohort[b.id].review}</td><td className="ex-num">{cohort[b.id].unresolved}</td></tr>)}</tbody>
      </table>
      <p className="ex-muted">C and D ran web evidence only on the {cases.length} cases plus the product’s own picks, not on all {total}. The whole-cohort C/D/S numbers are therefore mostly “unresolved” by construction. A and B cover everyone, which is why they “recommend” so many providers. Most of those are unverified NPPES faxes.</p>
      <p><strong>What this does and doesn’t show.</strong> On this tiny, non-random, agent-labelled set, going from C to D (adding AI research) changes: correct recommendations {byId.C.correct} → {byId.D.correct}, incorrect recommendations {byId.C.incorrect} → {byId.D.incorrect}, unverifiable recommendations {byId.C.unverifiable} → {byId.D.unverifiable}, unresolved cases {byId.C.unresolved} → {byId.D.unresolved}. The cost is ~{Math.round((byId.D.aiTokens.input + byId.D.aiTokens.output) / Math.max(1, byId.D.aiCalls / 2) / 1000)}k tokens and ~{Math.round(byId.D.aiGenerationMs / Math.max(1, byId.D.aiCalls / 2) / 1000)} s of model time per researched provider. Whether AI’s benefit beats its cost and failure modes <strong>is not answered by {cases.length} cases</strong>. See “Reasons this experiment may be wrong”.</p>
    </section>
  );
}

// ── 9. Raw evidence ──────────────────────────────────────────────────────────

function Json({ v, label }: { v: unknown; label: string }) {
  return <details className="ex-json"><summary>{label}</summary><pre>{JSON.stringify(v, null, 2)}</pre></details>;
}

function Evidence({ run, cases, grades, decisions }: { run: ExperimentRun; cases: GroundTruthCase[]; grades: Record<BaselineId, CaseGrade[]>; decisions: Decisions }) {
  const byNpi = new Map((run.nearby.data?.results ?? []).map((c) => [c.npi, c]));
  return (
    <section id="evidence">
      <h2>Raw evidence, per provider</h2>
      <p className="ex-muted">Everything the pipeline saw and did for each case. Expand a provider, then any block, for the unedited JSON.</p>
      {cases.map((gt) => {
        const c = byNpi.get(gt.npi);
        const reg = run.registry[gt.npi]?.data;
        const disc = run.discovery[gt.npi];
        const ai: ReferralView | null = run.liveAi[gt.npi]?.data?.view ?? run.savedAi[gt.npi]?.data ?? null;
        const d = decisions[gt.npi];
        return (
          <details key={gt.npi} id={`ev-${gt.npi}`} className="ex-prov">
            <summary><strong>{gt.name}</strong> <span className="ex-mono ex-muted">{gt.npi}</span> · expected {gt.expected.outcome.replace("_", " ")} · {BASELINES.map((b) => <span key={b.id} className="ex-sum-v">{b.id}:<V v={grades[b.id].find((x) => x.npi === gt.npi)!.overall} /></span>)}</summary>
            <div className="ex-prov-body">
              <h4>Ground truth (drafted by {gt.checkedBy}; human-verified: {gt.humanVerified ? "yes" : "NO"})</h4>
              <ul className="ex-small">
                <li>Licence: {gt.expected.licence ? <>{gt.expected.licence.type}, {gt.expected.licence.status}, expires {gt.expected.licence.expires ?? "—"}</> : "none / not applicable"}</li>
                <li>Specialty: {gt.expected.specialty.value} {gt.expected.specialty.url && <a href={gt.expected.specialty.url} target="_blank" rel="noreferrer">source ↗</a>}</li>
                <li>Practices: {gt.expected.practices ? gt.expected.practices.map((p) => <span key={p.line1 + p.name}>{p.name}, {p.line1}, {p.city} <a href={p.url} target="_blank" rel="noreferrer">↗</a>; </span>) : "NOT ESTABLISHED"}</li>
                <li>Faxes: {gt.expected.faxes ? gt.expected.faxes.map((f) => <span key={f.digits + f.referral}><code>{f.digits}</code> {f.referral ? "REFERRAL" : "office"} “{f.label.slice(0, 80)}” <a href={f.url} target="_blank" rel="noreferrer">↗</a>; </span>) : "NOT ESTABLISHED"}</li>
                <li>Sees adults: {gt.expected.seesAdults} · expected outcome: <strong>{gt.expected.outcome}</strong>{gt.expected.outcomeIsJudgement ? " (judgement)" : " (fact)"}: {gt.expected.outcomeBasis}</li>
                {gt.expected.wrongEvidence.length > 0 && <li>Known-wrong evidence URLs: {gt.expected.wrongEvidence.join(", ")}</li>}
                {gt.failures.length > 0 && <li>Ground-truth gaps: {gt.failures.join(" · ")}</li>}
              </ul>

              <h4>Decisions and grades</h4>
              <table className="ex-table ex-compact">
                <thead><tr><th>Baseline</th><th>Group</th><th>Evidence</th><th>Location</th><th>Fax</th><th>Pts (ver / dest)</th><th>Review reasons</th><th>Outcome</th><th>Fax</th><th>Location</th><th>Identity</th></tr></thead>
                <tbody>{BASELINES.map((b) => {
                  const g = grades[b.id].find((x) => x.npi === gt.npi)!;
                  const x = d?.[b.id];
                  return <tr key={b.id}><td>{b.id}</td><td>{x?.group ?? "not in run"}</td><td>{x?.evidence ?? "—"}</td><td>{x?.location ? `${x.location.line1}, ${x.location.city} (${x.location.distanceMi ?? "?"} mi)` : "—"}</td><td>{x?.fax ? <>{x.fax.number}<div className="ex-muted">{x.fax.cls}{x.fax.label ? ` · “${x.fax.label}”` : ""}</div></> : "—"}</td><td className="ex-num">{x?.verification ?? "—"} / {x?.destination ?? "—"}</td><td className="ex-small">{x?.reasons.join("; ") || "—"}</td>
                    {[g.outcome, g.fax, g.location, g.identity].map((k, i) => <td key={i} title={k.why}><V v={k.v} /><div className="ex-small ex-muted">{k.why}</div></td>)}</tr>;
                })}</tbody>
              </table>

              <h4>NPPES record</h4>
              {c ? <p className="ex-small">Registry candidate: {c.specialty} (<code>{c.specialtyCode}</code>) · nearest {c.nearest.line1}, {c.nearest.city} · {c.nearest.distanceMi} mi · phone {c.nearest.phone ?? "—"} · fax {c.nearest.fax ?? "—"} · last updated {c.lastUpdated ?? "—"}</p> : <p className="ex-bad">Not among this run’s in-radius candidates.</p>}
              {reg && <><Json v={reg.provider} label={`Full NPPES record (${reg.provider.source}, fetched ${reg.provider.fetchedAt})`} /><Json v={reg.license} label={`Licence record (${reg.license?.source ?? "none"}; match: ${reg.license?.match ?? "—"})`} /><ScoreTable items={reg.providerScore.items} title={`Baseline provider verification (no web evidence) — ${reg.providerScore.score} pts`} /></>}

              <h4>Deterministic web check (Brave){disc ? ` — ${disc.role === "production" ? "one of the product’s own 8 picks" : "run only for baseline C"} · ${fmtMs(disc.ms)}` : ""}</h4>
              {!disc ? <p className="ex-muted">Not run.</p> : !disc.data ? <p className="ex-bad">Failed: {disc.error}</p> : (
                <>
                  <p className="ex-small">Query: <code>{disc.data.log.query}</code> · search {disc.data.log.search.status}{disc.data.log.search.error ? ` (${disc.data.log.search.error})` : ""} · outcome <strong>{disc.data.log.outcome}</strong></p>
                  <table className="ex-table ex-compact">
                    <thead><tr><th>URL discovered</th><th>Skip rule</th><th>Priority</th><th>Fetched</th></tr></thead>
                    <tbody>{disc.data.log.candidates.map((h) => <tr key={h.url}><td className="ex-url"><a href={h.url} target="_blank" rel="noreferrer">{h.url}</a><div className="ex-muted">{h.title}</div></td><td>{h.skip ?? "—"}</td><td className="ex-num">{h.priority}</td><td>{h.fetched ? "yes" : "no"}</td></tr>)}</tbody>
                  </table>
                  <table className="ex-table ex-compact">
                    <thead><tr><th>Page fetched</th><th>HTTP</th><th>Name</th><th>NPI #</th><th>Specialty near name</th><th>Org</th><th>Referral page</th><th>Family</th><th>Decision</th></tr></thead>
                    <tbody>{disc.data.log.pages.map((p) => <tr key={p.url}><td className="ex-url">{p.url}</td><td>{p.fetched}{p.httpStatus ? ` ${p.httpStatus}` : ""}</td><td>{p.nameOnPage ? "✓" : "✗"}</td><td>{p.npiOnPage ? "✓" : "✗"}</td><td>{p.specialtyOnPage ? "✓" : "✗"}</td><td>{p.orgOnPage ?? "—"}</td><td>{p.referralPage ? "✓" : "✗"}</td><td title={p.familyReason}>{p.family}</td><td className={p.accepted ? "ex-good" : ""}>{p.reason}{p.evidence ? <div className="ex-muted">{p.evidence}</div> : null}</td></tr>)}</tbody>
                  </table>
                  <Json v={disc.data} label="Raw discovery response" />
                </>
              )}

              <h4>AI research {ai ? (run.liveAi[gt.npi]?.data ? "(LIVE in this run)" : `(cached, researched ${date(ai.research!.researchedAt)})`) : ""}</h4>
              {!ai?.research ? <p className="ex-muted">None for this provider.</p> : (
                <>
                  <p className="ex-small">{ai.research.usage.researchModel} → {ai.research.usage.extractModel} · {ai.research.usage.searchCalls} web searches · {ai.research.usage.inputTokens.toLocaleString()} in / {ai.research.usage.outputTokens.toLocaleString()} out tokens · {fmtMs(ai.research.usage.durationMs)}</p>
                  <p className="ex-small"><strong>Model-written queries:</strong> {ai.research.searchQueries.map((q) => <code key={q} className="ex-q">{q}</code>)}</p>
                  <table className="ex-table ex-compact">
                    <thead><tr><th>Id</th><th>Source (as returned by the model’s search)</th><th>Family</th><th>Why that family</th><th>Currentness (AI)</th><th>Model summary (AI claim)</th></tr></thead>
                    <tbody>{ai.research.sources.map((s) => <tr key={s.id}><td>{s.id}</td><td className="ex-url"><a href={s.url} target="_blank" rel="noreferrer">{s.url}</a></td><td>{s.family}</td><td className="ex-small">{s.familyReason}</td><td>{s.currentness}</td><td className="ex-small">{s.summary}</td></tr>)}</tbody>
                  </table>
                  <p className="ex-small"><strong>AI claims:</strong> identity confirmed={String(ai.research.identity.confirmed)} conflict={String(ai.research.identity.conflict)} · specialty “{ai.research.specialty.value}” ({ai.research.specialty.status}) · relationship {ai.research.relationship.kind}</p>
                  <table className="ex-table ex-compact">
                    <thead><tr><th>Location claimed</th><th>Status</th><th>Faxes (label verbatim · kind · checked)</th><th>Dest pts</th></tr></thead>
                    <tbody>{ai.locations.map((l) => <tr key={l.id}><td>{l.name}<div className="ex-muted">{l.line1}, {l.city} · {l.distanceMi ?? "?"} mi · src {l.sourceIds.join(",")}</div></td><td>{l.status}</td><td className="ex-small">{l.faxes.map((f) => `${f.number} “${f.label ?? "—"}” ${f.faxKind}${f.labelCheck ? ` (${f.labelCheck})` : ""}`).join(" · ") || "—"}</td><td className="ex-num">{l.referral.score}</td></tr>)}</tbody>
                  </table>
                  <p className="ex-small"><strong>Model-reported conflicts (used by NO rule):</strong> {ai.research.conflicts.length ? ai.research.conflicts.map((x, i) => <span key={i}>[{x.field}] {x.description} </span>) : "none"}</p>
                  <p className="ex-small"><strong>Deterministic overrides / dropped claims ({ai.research.dropped.length}):</strong></p>
                  <ul className="ex-small">{ai.research.dropped.map((x, i) => <li key={i}>{x.reason}: {x.detail}</li>)}</ul>
                  <div className="ex-cols"><ScoreTable items={ai.providerScore.items} title={`Provider verification — ${ai.providerScore.score} pts`} /></div>
                  <Json v={ai.research} label="Raw AI research record (as re-scored)" />
                </>
              )}
            </div>
          </details>
        );
      })}
    </section>
  );
}

// ── 10. Reasons this experiment may be wrong ────────────────────────────────

function Wrong({ run, cases, m }: { run: ExperimentRun; cases: GroundTruthCase[]; m: Metrics[] }) {
  const d = m.find((x) => x.baseline === "D")!;
  const total = run.nearby.data?.results.length ?? 0;
  const items: [string, string][] = [
    ["Selection bias", `The ${cases.filter((c) => c.cohort === "pipeline-evaluated").length} pipeline-evaluated cases are the ones the product chose: the 7 providers someone happened to research on Sep 28, plus the 8 nearest to one ZIP. That set is dominated by one children’s hospital (4800 Sand Point Way). The 5-provider random sample helps a little, but it isn’t stratified.`],
    ["Tiny evaluated sample", `${cases.length} cases, ${cases.filter((c) => c.expected.outcome !== "unknown").length} with a known expected outcome, ${d.recommended} Recommended by D. One case moves the false-recommendation rate by ${d.recommended ? Math.round(100 / d.recommended) : "—"} points. No interval estimate would be meaningful. Every rate here is an anecdote with a denominator.`],
    ["Cached research", "All AI evidence was generated once, on Sep 28, by whoever ran the M016 acceptance test. Viewers see a replay. Model non-determinism, drift and page changes since then are unmeasured. The \"AI\" column measures one historical sample per provider."],
    ["AI evaluating AI-produced evidence", "The pipeline’s evidence came from GPT models. The ground truth was drafted by Claude subagents. The harness and this page were written by Claude. A person has signed off none of it. Correlated model blind spots (e.g. trusting insurer directories, reading footers as clinic faxes) would pass unnoticed."],
    ["Correlated sources", "Payer directories, Doximity, AMA, BBB and practice microsites copy each other and NPPES. Counting them as separate \"source families\" overstates corroboration."],
    ["NPPES-derived sources look independent", "Doximity and many directories are seeded from NPPES. A Brave page that shows the NPPES address and phone may be NPPES in disguise. The NPI-number rule catches only pages that print the NPI itself."],
    ["Scraping and terms", "The Brave pass fetches third-party pages (Doximity, zocdoc, health systems) with a custom User-Agent. robots.txt and terms of service were not reviewed. Brave result storage terms and the reuse rights for OpenAI web-search content are unreviewed. Some fetches are blocked (HTTP 403/410), which also biases what gets corroborated."],
    ["Stale data everywhere", "NPPES is self-reported and often years old. Ground truth is also a point-in-time web check (Sep 28) that can go stale. Several official pages returned 403 to the checker, so \"not established\" often means \"couldn’t read\"."],
    ["Weak ground truth", `Expected outcomes for ${cases.filter((c) => c.expected.outcomeIsJudgement).length} of ${cases.length} cases are judgements (e.g. whether a laryngologist or a cosmetic surgeon is \"appropriate\" for asymmetric SNHL), not facts. A referral coordinator or ENT might disagree. "Appropriate" was never defined with clinicians.`],
    ["Uncalibrated scoring", "Point weights were hand-set during development. They were tuned while looking at these same Seattle providers (M016–M018), so the rules are over-fitted to the evaluation set. There is no held-out set."],
    ["Incomplete specialty-fit logic", "Fit is three rules. Subspecialty vs clinical reason, insurance, whether this provider actually sees patients at the chosen clinic, appointment availability, and adult vs pediatric beyond keyword matching are all unchecked."],
    ["Washington-only licensing", "Licence checks exist for WA only, and the search is one state (no cross-border providers). Licence-number mapping can pick a closed compact credential over an active one (Strohl)."],
    ["Cost and latency are not measured in dollars", `Token counts are recorded (~${Math.round((d.aiTokens.input + d.aiTokens.output) / Math.max(1, d.aiCalls / 2) / 1000)}k per AI-researched provider); prices, Brave plan and OpenAI billing are not. AI research takes ~${Math.round(d.aiGenerationMs / Math.max(1, d.aiCalls / 2) / 1000)} s per provider, sequentially behind an operator key. That is operationally impossible to run on all ${total} candidates per referral, so AI is only ever applied to a hand-picked few.`],
    ["The outcome that matters is not measured", "Nothing here measures whether a fax actually reached the right intake desk, or whether the patient was seen sooner. No real provider has been faxed. \"Correct fax\" means \"matches a number on an official web page\", not \"delivered and accepted\"."],
    ["Grader leniency and strictness are design choices", "Treating Needs review as PASS for a not-recommend case rewards a pipeline that sends everything to review. Treating unresolved as UNRESOLVED penalises nothing. A pipeline that recommends nobody scores a 0% false-recommendation rate. Read the rates together with Missed and Unresolved."],
    ["Nondeterminism", "The same search gave 4/8/246 in M026 and a different split in this recording. Brave ordering and fetch failures vary, so any single run is one sample."],
    ["Scenario lock-in", "One scenario (adult, ENT, asymmetric SNHL, Seattle 98115, 10 mi). Nothing here says anything about other specialties, rural areas or other states."],
  ];
  return (
    <section id="wrong" className="ex-wrong">
      <h2>Reasons this experiment may be wrong</h2>
      <ol>{items.map(([t, b]) => <li key={t}><strong>{t}.</strong> {b}</li>)}</ol>
    </section>
  );
}

// ── Reproduce ────────────────────────────────────────────────────────────────

function Reproduce({ run, grades, cases }: { run: ExperimentRun; grades: Record<BaselineId, CaseGrade[]>; cases: GroundTruthCase[] }) {
  const download = () => {
    const blob = new Blob([JSON.stringify({ run, cases, grades }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${run.meta.runId}.json`;
    a.click();
  };
  return (
    <section id="reproduce">
      <h2>Reproduce it</h2>
      <ol className="ex-rules">
        <li><strong>In the browser:</strong> “Run live” at the top re-executes every public endpoint in the product’s order and re-grades. That is ≈20 Brave queries and no AI. With <code>?operator</code> and the key, it can also re-run AI research (paid).</li>
        <li><strong>From a checkout:</strong> <code>node --import ./tests/resolve-ts.mjs scripts/npi-experiment.mts capture https://elk-inventory.vercel.app</code> records a run to <code>src/npi/experiment/data/run.json</code> and prints this report as text. Use <code>… report [run.json]</code> to re-grade a recorded run. Set <code>NPI_AI_KEY</code> + <code>NPI_AI_NPIS</code> to include live AI research.</li>
        <li><strong>Add or correct a case:</strong> edit <code>src/npi/experiment/data/cases.json</code> and set <code>humanVerified: true</code> only after a person has checked every expected fact against the cited URLs. The raw agent notes are in <code>data/ground-truth-raw.json</code>.</li>
        <li><strong>Grading and baselines</strong> are pure functions in <code>src/npi/experiment/evaluate.ts</code>, tested in <code>tests/npi-experiment.test.ts</code>. C, D and S call the product’s own <code>pickDestination</code> / <code>assessDestination</code>.</li>
      </ol>
      <button className="ex-btn" onClick={download}>Download this run + cases + grades (JSON)</button>
      <p className="ex-muted">Related: <a href="/npi-list/referral-demo">the demo</a> (which links back here) · <a href="/npi-list/opportunity">“Why explore this?”</a> (written before this experiment; read it with this page open).</p>
    </section>
  );
}
