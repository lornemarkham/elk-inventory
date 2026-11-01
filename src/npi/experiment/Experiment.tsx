// ── /npi-list/experiment — Provider Intelligence as an engineering experiment ─
// Not a demo. Shows one recorded pipeline run end to end (every stage, every
// model call, every fetched page), grades it against ground-truth cases with
// four baselines, and lists what is wrong with it — including the experiment.
// Everything numeric on this page is computed from ./data/run.json +
// ./data/cases.json by ./evaluate.ts at render time; "Run live" re-records.
//
// Layout is progressive disclosure: Overview (conclusion + headline numbers) →
// Pipeline / Results / Known failures / Test cases (evidence summary) → a case
// drawer and "Methodology & raw evidence" (every forensic detail, unedited).
// Presentation only: nothing here decides, scores or grades.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReferralResearch, ReferralView, ScoreItem } from "../types";
import { getDemoKey, operatorMode } from "../api";
import { Icon } from "../ui";
import { BASELINES, aiJudgements, cohortCounts, decideAll, gradeAll, metrics, pipelineStages, type BaselineId, type CaseGrade, type Decisions, type Metrics, type StageRow, type Verdict } from "./evaluate";
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
// "proven … worst case" false-recommendation bound as counts (4 recommendations don't support a percentage).
const recBound = (x: Metrics) => (x.recommended ? `${x.incorrect}–${x.incorrect + x.unverifiable} of ${x.recommended}` : "— (none recommended)");

// ── Navigation (hash: #tab or #tab/detail) ───────────────────────────────────

type TabId = "overview" | "pipeline" | "results" | "failures" | "cases" | "method";
const TABS: [TabId, string][] = [["overview", "Overview"], ["pipeline", "Pipeline"], ["results", "Results"], ["failures", "Known failures"], ["cases", "Test cases"], ["method", "Methodology & raw evidence"]];
// Anchors of the previous single-page report still land somewhere sensible.
const LEGACY: Record<string, string> = { status: "overview", funnel: "overview", baselines: "results", harness: "cases", evidence: "method/raw", ai: "method/ai", scores: "method/scores", wrong: "method/wrong", reproduce: "method/reproduce" };

function parseHash(): { tab: TabId; sub: string | null } {
  let h = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (LEGACY[h]) h = LEGACY[h];
  const ev = h.match(/^ev-(\d{10})$/);
  if (ev) h = `cases/${ev[1]}`;
  const [t, ...rest] = h.split("/");
  const tab = (TABS.some(([id]) => id === t) ? t : "overview") as TabId;
  return { tab, sub: rest.join("/") || null };
}

function useHashNav() {
  const [nav, setNav] = useState(parseHash);
  useEffect(() => {
    const on = () => setNav(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((h: string) => { if (location.hash !== `#${h}`) location.hash = h; else setNav(parseHash()); }, []);
  return [nav, go] as const;
}

// ── Page ─────────────────────────────────────────────────────────────────────

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

interface Ctx {
  run: ExperimentRun;
  cases: GroundTruthCase[];
  decisions: Decisions;
  grades: Record<BaselineId, CaseGrade[]>;
  m: Metrics[];
  byId: Record<BaselineId, Metrics>;
  cohort: ReturnType<typeof cohortCounts>;
  stages: StageRow[];
  failures: KnownFailure[];
  go: (h: string) => void;
}

function Report({ run, cases, snapshot, recorded, live, useLive, setUseLive, setLive }: { run: ExperimentRun; cases: GroundTruthCase[]; snapshot: ReferralResearch[]; recorded: ExperimentRun; live: ExperimentRun | null; useLive: boolean; setUseLive: (b: boolean) => void; setLive: (r: ExperimentRun) => void }) {
  const decisions = useMemo(() => decideAll(run), [run]);
  const grades = useMemo(() => gradeAll(run, cases, decisions), [run, cases, decisions]);
  const m = useMemo(() => metrics(run, grades), [run, grades]);
  const cohort = useMemo(() => cohortCounts(run, decisions), [run, decisions]);
  const stages = useMemo(() => pipelineStages(run, decisions), [run, decisions]);
  const failures = useMemo(() => knownFailures(run, decisions), [run, decisions]);
  const [nav, go] = useHashNav();
  const byId = Object.fromEntries(m.map((x) => [x.baseline, x])) as Record<BaselineId, Metrics>;
  const ctx: Ctx = { run, cases, decisions, grades, m, byId, cohort, stages, failures, go };
  const openCase = nav.tab === "cases" && nav.sub && cases.some((c) => c.npi === nav.sub) ? nav.sub : null;

  useEffect(() => {
    if (!nav.sub || nav.tab === "cases") { if (!nav.sub) window.scrollTo({ top: 0 }); return; }
    const el = document.getElementById(`${nav.tab}-${nav.sub}`);
    if (el) { if (el instanceof HTMLDetailsElement) el.open = true; el.scrollIntoView({ block: "start" }); }
  }, [nav]);

  return (
    <div className="ex">
      <header className="ex-head">
        <div className="ex-kicker">Provider Intelligence · engineering experiment · M027</div>
        <nav className="ex-tabs" aria-label="Experiment sections">
          {TABS.map(([id, label]) => <a key={id} href={`#${id}`} className={nav.tab === id ? "on" : ""} aria-current={nav.tab === id ? "page" : undefined}>{label}{id === "failures" && <span className="ex-tab-n">{failures.length}</span>}{id === "cases" && <span className="ex-tab-n">{cases.length}</span>}</a>)}
        </nav>
      </header>

      <main className="ex-main">
        {nav.tab === "overview" && <Overview {...ctx} runbar={<RunBar recorded={recorded} live={live} useLive={useLive} setUseLive={setUseLive} setLive={setLive} cases={cases} snapshot={snapshot} />} runMeta={<>Showing <strong>{useLive ? "a live run from this browser" : "the recorded run"}</strong> <code>{run.meta.runId}</code>, captured {date(run.meta.capturedAt)} by <code>{run.meta.runner}</code> against <code>{run.meta.base}</code>{run.meta.codeVersion && <> · code {run.meta.codeVersion}</>}</>} />}
        {nav.tab === "pipeline" && <PipelineTab {...ctx} />}
        {nav.tab === "results" && <ResultsTab {...ctx} />}
        {nav.tab === "failures" && <FailuresTab {...ctx} />}
        {nav.tab === "cases" && <CasesTab {...ctx} />}
        {nav.tab === "method" && <MethodTab {...ctx} raw={nav.sub === "raw"} />}
      </main>

      {openCase && <CaseDrawer {...ctx} npi={openCase} onClose={() => go("cases")} />}
    </div>
  );
}

// ── Level 1: Overview ────────────────────────────────────────────────────────

function Overview({ run, cases, decisions, grades, byId, failures, go, runbar, runMeta }: Ctx & { runbar: React.ReactNode; runMeta: React.ReactNode }) {
  const nb = run.nearby.data;
  const s = Object.values(decisions).map((d) => d.S);
  const total = nb?.results.length ?? 0;
  const rec = s.filter((d) => d.group === "recommended").length;
  const review = s.filter((d) => d.group === "review").length;
  const unres = s.filter((d) => d.group === "unresolved").length;
  const investigated = Object.values(run.savedAi).filter((t) => t.ok).length + Object.values(run.discovery).filter((d) => d.role === "production").length;
  const corroborated = s.filter((d) => d.evidence !== "none").length;
  const hv = cases.filter((c) => c.humanVerified).length;
  const S = byId.S;
  const liveCalls = Object.keys(run.liveAi).length * 2;
  const snapDays = [...new Set(run.meta.snapshotResearchedAt.map((x) => x.slice(0, 10)))].join(", ") || "—";
  const wrongS = grades.S.filter((g) => g.rec === "incorrect").map((g) => cases.find((c) => c.npi === g.npi)!.name.replace(/,.*$/, ""));
  return (
    <div className="ex-ov">
      <section className="ex-hero">
        <div className="ex-hero-q">
          <div className="ex-label">What are we testing?</div>
          <h1>Can public provider data + deterministic corroboration + AI identify reliable referral destinations better than registry data alone?</h1>
          <div className="ex-scenario">Scenario: {run.meta.input.specialty} · {run.meta.input.location} · {run.meta.input.radius} mi · adult patient, {run.meta.input.patientAge} · asymmetric sensorineural hearing loss</div>
        </div>
        <div className="ex-verdict" role="status">
          <div className="ex-label">Status</div>
          <div className="ex-verdict-big"><Icon name="alert" size={22} /> NOT PROVEN</div>
          <p>The pipeline can gather and corroborate provider information. <strong>This experiment has not established that it can reliably recommend referral destinations.</strong></p>
          <div className="ex-verdict-actions">{runbar}<button className="ex-btn ex-btn-lg" onClick={() => go("cases")}>Inspect evidence →</button></div>
        </div>
      </section>

      <ul className="ex-flags" aria-label="Caveats that apply to every number on this page">
        <li className="bad"><strong>{cases.length} provisional test cases</strong><span>Ground truth drafted by AI subagents — <b>{hv} of {cases.length} human-verified</b></span></li>
        <li className="bad"><strong>{S.incorrect} known false recommendation{S.incorrect === 1 ? "" : "s"} in the shipped result</strong><span>{wrongS.length ? `${wrongS.join(", ")} — recommended, provisionally wrong` : "see Known failures"}</span></li>
        <li className="warn"><strong>{unres} of {total} candidates unresolved ({pct(total ? unres / total : null)})</strong><span>No web evidence of any kind — the product never evaluated them</span></li>
        <li className="warn"><strong>{liveCalls === 0 ? "AI research was cached" : `${liveCalls} live AI calls`}</strong><span>{liveCalls === 0 ? <><b>0 live AI calls</b> in the displayed run — AI evidence replayed from {snapDays}</> : "operator-triggered live research in this run"}</span></li>
        <li className="bad"><strong>{failures.length} known defects — unfixed</strong><span>Listed with cause and impact under Known failures</span></li>
      </ul>

      <section className="ex-block">
        <div className="ex-block-head">
          <h2>What happened with the shipped pipeline</h2>
          <span className="ex-muted ex-small">{runMeta}</span>
        </div>
        <div className="ex-kpis">
          <Kpi n={total} label="Candidates" sub={`NPPES, in ${nb?.radiusMi ?? "?"} mi radius`} />
          <Kpi n={investigated} label="Investigated" sub="cached AI + Brave web check" />
          <Kpi n={corroborated} label="Corroborated" sub="with any web evidence" />
          <Kpi n={rec} label="Recommended" tone="rec" />
          <Kpi n={review} label="Needs review" tone="review" />
          <Kpi n={unres} label="Unresolved" tone="unres" sub={`${pct(total ? unres / total : null)} of candidates`} />
        </div>
        <div className="ex-kpi-caption">
          <span className="ex-prov-tag">PROVISIONAL</span> Of the shipped pipeline's {S.recommended} Recommended providers that are also test cases, graded against unverified ground truth:
        </div>
        <div className="ex-kpis ex-kpis-sm">
          <Kpi n={S.correct} label="Provisionally correct" tone="good" />
          <Kpi n={S.incorrect} label="Provisionally incorrect" tone="bad" />
          <Kpi n={S.unverifiable} label="Unverifiable" tone="unver" sub="ground truth can't confirm" />
          <Kpi n={`${S.pass} / ${S.fail} / ${S.unresolvedVerdicts}`} label="All 20 cases: PASS / FAIL / UNRESOLVED" />
        </div>
      </section>

      <div className="ex-actions">
        <button className="ex-btn ex-btn-ghost" onClick={() => go("results")}>Baseline comparison →</button>
        <button className="ex-btn ex-btn-ghost" onClick={() => go("failures")}>Known failures →</button>
        <button className="ex-btn ex-btn-ghost" onClick={() => go("method/wrong")}>Why this experiment may be wrong →</button>
      </div>
    </div>
  );
}

function Kpi({ n, label, sub, tone }: { n: number | string; label: string; sub?: string; tone?: string }) {
  return <div className={`ex-kpi${tone ? ` ex-kpi-${tone}` : ""}`}><div className="ex-kpi-n">{n}</div><div className="ex-kpi-l">{label}</div>{sub && <div className="ex-kpi-s">{sub}</div>}</div>;
}

// ── Run controls ─────────────────────────────────────────────────────────────

function RunBar({ recorded, live, useLive, setUseLive, setLive, cases, snapshot }: { recorded: ExperimentRun; live: ExperimentRun | null; useLive: boolean; setUseLive: (b: boolean) => void; setLive: (r: ExperimentRun) => void; cases: GroundTruthCase[]; snapshot: ReferralResearch[] }) {
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
      <div className="ex-runbar-actions">
        <button className="ex-btn ex-btn-primary ex-btn-lg" disabled={Boolean(busy)} onClick={start}>{busy ? <><span className="pi-spinner" /> {busy}</> : "Run live experiment"}</button>
        <span className="ex-muted ex-small">≈20 Brave queries · 0 AI calls · re-grades all {cases.length} cases</span>
        {live && <button className="ex-btn" onClick={() => setUseLive(!useLive)}>{useLive ? "Show recorded run" : "Show live run"}</button>}
        {op && <label className="ex-muted"><input type="checkbox" checked={withAi} onChange={(e) => setWithAi(e.target.checked)} /> operator: also run fresh AI research on the {snapshot.length} snapshot providers (paid; ~2 min each)</label>}
      </div>
    </div>
  );
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

const Kind = ({ k }: { k: string }) => <span className={`ex-kind ex-kind-${k.split(" ")[0].toLowerCase()}`}>{k}</span>;

const FLOW: { id: string; label: string; test: (s: string) => boolean }[] = [
  { id: "input", label: "Referral input", test: (s) => s === "Referral input" || s.startsWith("Referral type") },
  { id: "nppes", label: "NPPES", test: (s) => s.startsWith("NPPES") || s.startsWith("Active + taxonomy") || s.startsWith("Whole registry") || s.startsWith("Registry search") },
  { id: "geo", label: "Geography", test: (s) => s.startsWith("Location →") || s.startsWith("Geocode") || s.startsWith("Geographic") || s.startsWith("Radius filter") },
  { id: "licence", label: "Licence", test: (s) => s.startsWith("Licence") },
  { id: "web", label: "Web corroboration", test: (s) => s.startsWith("Brave") || s.startsWith("Pages fetched") || s === "Deterministic corroboration" },
  { id: "ai", label: "AI research (when needed)", test: (s) => s.startsWith("Load saved AI") || s === "AI research" || s.startsWith("Extracted claims") },
  { id: "validate", label: "Deterministic validation", test: (s) => s.startsWith("Deterministic filters") },
  { id: "classify", label: "Classification", test: (s) => s.startsWith("Deterministic rules") },
  { id: "human", label: "Human selection", test: (s) => s.startsWith("Choose destination") },
];

function flowGroups(stages: StageRow[]) {
  const groups = FLOW.map((f) => ({ ...f, rows: stages.filter((s) => f.test(s.stage)) }));
  const other = stages.filter((s) => !FLOW.some((f) => f.test(s.stage)));
  if (other.length) groups.push({ id: "other", label: "Other stages", test: () => false, rows: other });
  return groups.filter((g) => g.rows.length);
}

function StageTable({ rows }: { rows: StageRow[] }) {
  return (
    <div className="ex-scroll">
      <table className="ex-table">
        <thead><tr><th>#</th><th>Stage</th><th>Type</th><th>Source</th><th>Input</th><th>In → out</th><th>Output</th><th>Time</th><th>Cost</th><th>Failures / refusals</th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.n}>
              <td>{s.n}</td><td><strong>{s.stage}</strong></td><td><Kind k={s.kind} /></td><td className="ex-src">{s.source}</td><td className="ex-small">{s.input}</td>
              <td className="ex-num">{s.in ?? "—"} → {s.out ?? "—"}</td><td>{s.output}</td><td className="ex-num">{fmtMs(s.ms)}</td><td>{s.cost}</td>
              <td>{s.failures.length ? <ul className="ex-fails">{s.failures.map((f, i) => <li key={i}>{f}</li>)}</ul> : <span className="ex-muted">none</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PipelineTab({ stages, go }: Ctx) {
  const groups = flowGroups(stages);
  return (
    <div>
      <div className="ex-page-head">
        <h2>Pipeline</h2>
        <p className="ex-lede">What happens to one referral, in order. Each step is badged by who or what decides. Open a step for its recorded input, output, record counts, latency, cost and failures.</p>
        <div className="ex-legend"><Kind k="HUMAN" /> a person decides <Kind k="EXTERNAL" /> outside data source <Kind k="DET" /> fixed code rules <Kind k="AI" /> model output <Kind k="DET over cached AI" /> code re-scoring saved model output (no model runs)</div>
      </div>
      <ol className="ex-flow">
        {groups.map((g, i) => {
          const kinds = [...new Set(g.rows.map((r) => r.kind))];
          const last = g.rows[g.rows.length - 1];
          const ms = g.rows.reduce((a, r) => a + (r.ms ?? 0), 0);
          const fails = g.rows.reduce((a, r) => a + r.failures.length, 0);
          return (
            <li key={g.id}>
              <button className="ex-flow-node" onClick={() => go(`pipeline/${g.id}`)}>
                <span className="ex-flow-i">{i + 1}</span>
                <span className="ex-flow-l">{g.label}</span>
                <span className="ex-flow-k">{kinds.map((k) => <Kind key={k} k={k} />)}</span>
                <span className="ex-flow-o">{last.out ?? "—"}<small> out</small></span>
                <span className="ex-flow-m">{ms ? fmtMs(ms) : "—"}{fails ? <b className="ex-bad"> · {fails} failure{fails === 1 ? "" : "s"}</b> : null}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="ex-stack">
        {groups.map((g, i) => (
          <details key={g.id} id={`pipeline-${g.id}`} className="ex-exp">
            <summary><span className="ex-exp-i">{i + 1}</span><strong>{g.label}</strong>{[...new Set(g.rows.map((r) => r.kind))].map((k) => <Kind key={k} k={k} />)}<span className="ex-exp-sum">{g.rows[g.rows.length - 1].output}</span></summary>
            <StageTable rows={g.rows} />
          </details>
        ))}
      </div>
      <p className="ex-note">Times for server sub-stages come from the <code>trace</code> field of <code>/api/npi-nearby</code>, and Brave/fetch times from <code>log.timings</code>. For per-provider stages (saved-AI re-scoring, Brave, fetches) the time is the <strong>sum across providers</strong>; the product runs them 2–4 at a time, so wall time is lower. Server sub-stage times depend on per-edge-instance caches: in the recorded run the geocoder took ~2 ms because a request moments earlier had warmed it. The cold figure measured just before was ~2.1 s geocoding and ~4 s licence lookup.</p>
    </div>
  );
}

// ── Results ──────────────────────────────────────────────────────────────────

const SEGS: { key: string; label: string; cls: string; get: (x: Metrics) => number }[] = [
  { key: "correct", label: "Recommended · provisionally correct", cls: "seg-good", get: (x) => x.correct },
  { key: "incorrect", label: "Recommended · provisionally INCORRECT", cls: "seg-bad", get: (x) => x.incorrect },
  { key: "unverifiable", label: "Recommended · unverifiable", cls: "seg-unver", get: (x) => x.unverifiable },
  { key: "review", label: "Needs review", cls: "seg-review", get: (x) => x.review },
  { key: "unresolved", label: "Unresolved", cls: "seg-unres", get: (x) => x.unresolved },
];
const VSEGS: { label: Verdict; cls: string; get: (x: Metrics) => number }[] = [
  { label: "PASS", cls: "seg-pass", get: (x) => x.pass },
  { label: "FAIL", cls: "seg-bad", get: (x) => x.fail },
  { label: "UNRESOLVED", cls: "seg-unres", get: (x) => x.unresolvedVerdicts },
];

function Bar({ x, segs, total }: { x: Metrics; segs: { label: string; cls: string; get: (x: Metrics) => number }[]; total: number }) {
  return (
    <div className="ex-bar" role="img" aria-label={segs.map((s) => `${s.label}: ${s.get(x)}`).join(", ")}>
      {segs.map((s) => { const n = s.get(x); return n ? <span key={s.label} className={s.cls} style={{ flexGrow: n, flexBasis: 0 }} title={`${x.baseline} — ${s.label}: ${n} of ${total}`}>{n}</span> : null; })}
    </div>
  );
}

function ResultsTab({ m, byId, cases, cohort, run }: Ctx) {
  const known = cases.filter((c) => c.expected.outcome !== "unknown").length;
  const aiCases = cases.filter((c) => run.savedAi[c.npi]?.ok || run.liveAi[c.npi]?.ok).length;
  const total = run.nearby.data?.results.length ?? 0;
  const perProv = (x: Metrics) => Math.max(1, x.aiCalls / 2);
  const delta = (a: BaselineId, b: BaselineId) => {
    const x = byId[a], y = byId[b];
    const d = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
    return [["correct rec", d(y.correct - x.correct)], ["incorrect rec", d(y.incorrect - x.incorrect)], ["PASS", d(y.pass - x.pass)], ["FAIL", d(y.fail - x.fail)], ["UNRESOLVED", d(y.unresolvedVerdicts - x.unresolvedVerdicts)]];
  };
  const C = byId.C, D = byId.D;
  return (
    <div>
      <div className="ex-page-head">
        <h2>Results: does each layer earn its cost?</h2>
        <p className="ex-lede">Five baselines on the same {cases.length} provisional cases ({known} with a known expected outcome). Grades are against <strong>unverified</strong> ground truth.</p>
      </div>

      <div className="ex-callout ex-callout-warn">
        <strong>Adding AI (C → D) adds cost and latency. This sample does not show whether that is worth it.</strong>
        <span>Correct recommendations {C.correct} → {D.correct} · incorrect {C.incorrect} → {D.incorrect} · unverifiable {C.unverifiable} → {D.unverifiable} · unresolved cases {C.unresolved} → {D.unresolved}. Cost: {D.aiCalls} model calls behind the evidence, ~{Math.round((D.aiTokens.input + D.aiTokens.output) / perProv(D) / 1000)}k tokens and ~{Math.round(D.aiGenerationMs / perProv(D) / 1000)} s of model time per researched provider. AI evidence exists for only {aiCases} of these cases, so D−C is measured on {aiCases} providers at most.</span>
      </div>

      <section className="ex-block">
        <div className="ex-cmp">
          <div className="ex-cmp-row ex-cmp-headrow">
            <div>Baseline</div><div>What happened to the {cases.length} cases</div><div>Case verdicts</div><div className="ex-r">AI calls<br /><small>(live)</small></div><div className="ex-r">Brave<br /><small>queries / pages</small></div><div className="ex-r">Latency<br /><small>median / provider</small></div>
          </div>
          {BASELINES.map((b) => {
            const x = byId[b.id];
            return (
              <div key={b.id} className={`ex-cmp-row${b.id === "S" ? " ex-cmp-s" : ""}`}>
                <div className="ex-cmp-b"><span className="ex-bid">{b.id}</span><span>{b.label}{b.ai && <Kind k="AI" />}</span></div>
                <div><Bar x={x} segs={SEGS} total={cases.length} /><div className="ex-cmp-sub">{x.recommended} recommended · false-rec bound {recBound(x)}</div></div>
                <div><Bar x={x} segs={VSEGS} total={cases.length} /></div>
                <div className="ex-num">{x.aiCalls} <small>({x.aiLiveCalls})</small></div>
                <div className="ex-num">{x.braveQueries} <small>/ {x.pagesFetched}</small></div>
                <div className="ex-num">{fmtMs(x.latencyMs.perProviderMedian)}</div>
              </div>
            );
          })}
        </div>
        <div className="ex-legend ex-legend-bars">
          {SEGS.map((s) => <span key={s.key}><i className={s.cls} />{s.label}</span>)}
          <span className="ex-legend-sep" />
          {VSEGS.map((s) => <span key={s.label}><i className={s.cls} />{s.label}</span>)}
        </div>
        <p className="ex-note">“False-rec bound” is proven-incorrect … incorrect + unverifiable, as counts: with this few recommendations a percentage would overstate precision. AI calls are the model calls behind the evidence (2 per researched provider); the number in brackets were made live in this run. $ cost is not recorded anywhere in the repo.</p>
      </section>

      <div className="ex-grid2">
        <section className="ex-block">
          <h3>Incremental effect of each layer</h3>
          <div className="ex-scroll"><table className="ex-table ex-delta">
            <thead><tr><th>Step</th>{delta("A", "B").map(([k]) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>
              {([["A", "B", "B − A · add WA licence"], ["B", "C", "C − B · add deterministic web"], ["C", "D", "D − C · add AI research"]] as [BaselineId, BaselineId, string][]).map(([a, b, l]) => <tr key={l}><td>{l}</td>{delta(a, b).map(([k, v]) => <td key={k} className="ex-num">{v}</td>)}</tr>)}
            </tbody>
          </table></div>
        </section>
        <section className="ex-block">
          <h3>Whole cohort — {total} candidates, no ground truth</h3>
          <div className="ex-scroll"><table className="ex-table">
            <thead><tr><th /><th className="ex-num">Recommended</th><th className="ex-num">Needs review</th><th className="ex-num">Unresolved</th></tr></thead>
            <tbody>{BASELINES.map((b) => <tr key={b.id}><td>{b.id} · {b.label}</td><td className="ex-num">{cohort[b.id].recommended}</td><td className="ex-num">{cohort[b.id].review}</td><td className="ex-num">{cohort[b.id].unresolved}</td></tr>)}</tbody>
          </table></div>
          <p className="ex-note">C and D ran web evidence only on the {cases.length} cases plus the product’s own picks, not on all {total}, so whole-cohort C/D/S numbers are mostly “unresolved” by construction. A and B cover everyone, which is why they “recommend” so many providers — mostly unverified NPPES faxes.</p>
        </section>
      </div>

      <details className="ex-exp">
        <summary><strong>All metrics, per baseline</strong><span className="ex-exp-sum">every number the grader computes</span></summary>
        <MetricsTable m={m} />
      </details>
    </div>
  );
}

function MetricsTable({ m }: { m: Metrics[] }) {
  return (
    <div className="ex-scroll">
      <table className="ex-table ex-metrics">
        <thead><tr><th>Metric</th>{m.map((x) => <th key={x.baseline} className="ex-num">{x.baseline}</th>)}</tr></thead>
        <tbody>
          {([
            ["Recommended", (x) => x.recommended],
            ["— correct (outcome + fax + location PASS)", (x) => x.correct],
            ["— INCORRECT (any FAIL)", (x) => <strong className={x.incorrect ? "ex-bad" : ""}>{x.incorrect}</strong>],
            ["— correctness unverifiable", (x) => x.unverifiable],
            ["False-Recommended (proven … worst case)", (x) => <strong>{recBound(x)}</strong>],
            ["Needs review", (x) => x.review],
            ["Unresolved", (x) => x.unresolved],
            ["Missed (expected usable, not recommended)", (x) => x.missed],
            ["Verified referral fax on a correct recommendation", (x) => x.verifiedReferralFax],
            ["Case verdicts PASS / FAIL / UNRESOLVED", (x) => `${x.pass} / ${x.fail} / ${x.unresolvedVerdicts}`],
            ["Registry search latency (all candidates at once)", (x) => fmtMs(x.latencyMs.search)],
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
    </div>
  );
}

// ── Known failures ───────────────────────────────────────────────────────────

interface KnownFailure { id: string; title: string; npis: string[]; observed: React.ReactNode; cause: React.ReactNode; impact: React.ReactNode; status: string }

function knownFailures(run: ExperimentRun, decisions: Decisions): KnownFailure[] {
  const thomas = run.discovery["1457413643"]?.data?.log.pages ?? [];
  const sidebar = thomas.find((p) => /henry-ou/.test(p.url));
  const conflicts = Object.values(run.savedAi).reduce((n, t) => n + (t.data?.research?.conflicts.length ?? 0), 0);
  const stale = (run.nearby.data?.results ?? []).filter((c) => c.lastUpdated && (Date.parse(run.meta.capturedAt) - Date.parse(c.lastUpdated)) / 3.15e10 > 5).length;
  const total = run.nearby.data?.results.length ?? 0;
  const s = Object.values(decisions).map((d) => d.S);
  const split = `${s.filter((d) => d.group === "recommended").length} / ${s.filter((d) => d.group === "review").length} / ${s.filter((d) => d.group === "unresolved").length}`;
  const snap = [...run.meta.snapshotResearchedAt].sort();
  return [
    {
      id: "doximity", title: "Doximity sidebar false match", npis: ["1457413643"],
      observed: <>The Brave pass for Herbert Thomas fetched <code>doximity.com/pub/henry-ou-md</code> — another physician’s profile. {sidebar ? <>This run {sidebar.accepted ? <strong>ACCEPTED it again</strong> : "rejected it"}: “{sidebar.reason}”</> : "This run did not fetch it (fetch order varies)."}</>,
      cause: <><code>nameOnPage</code> and <code>addressOnPage</code> each search the <em>whole page</em>. Nothing requires the name and the address to sit next to each other, so a “Similar Physicians” sidebar name plus the page owner’s address passes.</>,
      impact: <>False identity corroboration. Harmless here only because Ou and Thomas share a hospital address. The harness catches it with a URL-slug heuristic and the curated <code>wrongEvidence</code> list; the product does not.</>,
      status: "Unfixed",
    },
    {
      id: "specialty", title: "Specialty / subspecialty failure", npis: ["1790313880", "1437512704"],
      observed: <>Jyoti Sharma, a cosmetic facial plastic surgeon, is <strong>Recommended</strong> for asymmetric hearing loss. The NPPES-only baseline recommends Strohl, a head-and-neck cancer surgeon, for the same reason.</>,
      cause: <>The AI said “different specialty”, but <code>specialtyReallyDiffers</code> overrode it because “Facial Plastic Surgery” shares a word with her NPPES taxonomy. Routing then accepts any <code>207Y*</code> code. Fit has three rules (pediatric wording, licence profession, research says different); none is about subspecialty versus clinical reason.</>,
      impact: <>A provisional <strong>false recommendation in the shipped result</strong>.</>,
      status: "Unfixed",
    },
    {
      id: "conflicts", title: "Ignored conflict evidence", npis: ["1790313880", "1447340823"],
      observed: <>The saved research contains <strong>{conflicts} model-reported conflicts</strong>. Examples: Sharma, “current main site omits fax”; Langman, official UW clinic pages don’t list him (only an insurer directory does). Both are still Recommended.</>,
      cause: <><code>research.conflicts</code> is displayed but is never an input to <code>scoreProvider</code>, <code>scoreReferral</code> or <code>assessDestination</code>. <strong>No rule reads them.</strong></>,
      impact: <>Contradictions the model itself found neither lower points nor send the provider to review.</>,
      status: "Unfixed",
    },
    {
      id: "stale", title: "Stale NPPES data", npis: ["1033504196", "1215375621", "1255421145", "1447340823"],
      observed: <>{stale} of {total} in-radius candidates ({pct(total ? stale / total : null)}) have an NPPES record last updated more than 5 years ago. Ground truth found examples: Jason Park now practises in Tennessee (WA residency licence expired 2021); Brandstetter is at Kaiser in California (WA licence expired 2021); Inglis is professor emeritus; Langman’s record dates from 2007.</>,
      cause: <>NPPES is self-reported and often years old.</>,
      impact: <>Baselines A and B take the NPPES fax at face value.</>,
      status: "Unfixed",
    },
    {
      id: "fax", title: "Office fax ≠ verified referral fax", npis: ["1629168570", "1447340823", "1033377064", "1457413643"],
      observed: <>Most Recommended destinations use an <strong>office</strong> fax (referral use not confirmed). Hume’s fax is labelled “referral-verified” by the pipeline, but the ground-truth agent could not read UW’s referral page (HTTP 403) and saw the number only as a site-footer “Fax:”, so the harness grades that claim UNRESOLVED. The Brave pass picked up the NPPES fax <code>206-987-3878</code> for Horn and Thomas; that number appears on no official page ground truth could find.</>,
      cause: <>Seattle Children’s real intake fax is <code>206-985-3121</code>. The AI found it for Langman, but <code>finalizeResearch</code> dropped it because its source id wasn’t in the search results.</>,
      impact: <>A fax shown on a recommendation is not established to reach a referral intake desk.</>,
      status: "Unfixed",
    },
    {
      id: "licence", title: "Licence matching failure", npis: ["1437512704"],
      observed: <>The pipeline says Madeleine Strohl’s licence is “closed”. WA DOH also shows an <strong>Active</strong> <code>MD.MD.61399067</code>.</>,
      cause: <>Her NPPES licence <code>MD61493073</code> maps to her <em>closed</em> Interstate Compact credential (<code>IMLC.MD.61493073</code>).</>,
      impact: <>Baseline B withholds her for the wrong reason and scores PASS on outcome by luck. The harness cannot see “right answer, wrong reason”.</>,
      status: "Unfixed",
    },
    {
      id: "nondeterminism", title: "Non-deterministic run results", npis: [],
      observed: <>The M026 trace of this same search got 4 / 8 / 246 (Recommended / Needs review / Unresolved). The displayed run got {split}.</>,
      cause: <>Third-party fetches fail intermittently (Doximity HTTP 410, zocdoc 403, timeouts), and Brave result order changes.</>,
      impact: <>A failed fetch is reported, but it still changes which providers reach Needs review. Any single run is one sample.</>,
      status: "Unfixed",
    },
    {
      id: "missed", title: "Good destinations are missed", npis: ["1760942494"],
      observed: <>Jacob Bloom, an adult general ENT with a middle-ear interest at UW Northwest, accepting new patients, ~4 mi away, is <strong>unresolved in every baseline</strong>.</>,
      cause: <>His NPPES addresses aren’t his current clinic, and he isn’t among the 8 nearest that the product auto-checks.</>,
      impact: <>Missed-good-destination is not visible in the product UI at all.</>,
      status: "Unfixed",
    },
    {
      id: "cache", title: "Cached research freshness", npis: [],
      observed: <>Every viewer’s AI evidence was generated between {snap[0]?.slice(0, 16).replace("T", " ")} and {snap[snap.length - 1]?.slice(11, 16)} UTC and is <strong>frozen</strong>.</>,
      cause: <>It is re-scored with today’s rules against today’s NPPES, but nothing re-checks whether the pages still say what the AI read. Browser-cached research (<code>localStorage npi-research:v3:*</code>) <strong>never expires</strong> and overrides the snapshot. The server cache lasts 24 h per edge instance.</>,
      impact: <>The “AI” results measure one historical sample per provider.</>,
      status: "Unfixed",
    },
  ];
}

function FailuresTab({ failures, grades, cases, go }: Ctx) {
  const fails = BASELINES.flatMap((b) => grades[b.id].filter((g) => g.overall === "FAIL").map((g) => ({ b: b.id, g })));
  const name = (npi: string) => cases.find((c) => c.npi === npi)?.name ?? npi;
  return (
    <div>
      <div className="ex-page-head">
        <h2><Icon name="x" /> Known failures</h2>
        <p className="ex-lede">{failures.length} known defects and counterexamples. <strong>None has been fixed</strong> — this experiment measures the pipeline as it is.</p>
      </div>
      <div className="ex-issues">
        {failures.map((f, i) => (
          <article key={f.id} id={`failures-${f.id}`} className="ex-issue">
            <header><span className="ex-issue-n">F{i + 1}</span><h3>{f.title}</h3><span className="ex-status-pill">{f.status}</span></header>
            <dl>
              <dt>Observed</dt><dd>{f.observed}</dd>
              <dt>Cause</dt><dd>{f.cause}</dd>
              <dt>Impact</dt><dd>{f.impact}</dd>
            </dl>
            {f.npis.length > 0 && <footer>Cases: {f.npis.map((n) => <button key={n} className="ex-chip" onClick={() => go(`cases/${n}`)}>{name(n)}</button>)}</footer>}
          </article>
        ))}
      </div>
      <section className="ex-block">
        <h3>Harness-detected FAILs in this run ({fails.length})</h3>
        <div className="ex-scroll">
          <table className="ex-table">
            <thead><tr><th>Baseline</th><th>Provider</th><th>What failed</th></tr></thead>
            <tbody>{fails.map(({ b, g }) => <tr key={b + g.npi}><td><span className="ex-bid">{b}</span></td><td><button className="ex-link" onClick={() => go(`cases/${g.npi}`)}>{name(g.npi)}</button></td><td>{[g.outcome, g.fax, g.location, g.identity].filter((c) => c.v === "FAIL").map((c) => c.why).join(" · ")}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ── Test cases ───────────────────────────────────────────────────────────────

const V = ({ v }: { v: Verdict }) => <span className={`ex-v ex-v-${v.toLowerCase().replace("/", "")}`}>{v}</span>;
const GROUP_LABEL: Record<string, string> = { recommended: "Recommended", review: "Needs review", unresolved: "Unresolved" };

function CasesTab({ cases, grades, failures, go }: Ctx) {
  return (
    <div>
      <div className="ex-page-head">
        <h2>Test cases</h2>
        <p className="ex-lede">{cases.length} cases: {cases.filter((c) => c.cohort === "pipeline-evaluated").length} providers the product itself evaluated, plus {cases.filter((c) => c.cohort === "random-sample").length} drawn at random from the unresolved. Expected facts are <strong>provisional — {cases.filter((c) => c.humanVerified).length} human-verified</strong>; ◆ marks an expectation that rests on a judgement, not a fact. Click a provider for all evidence.</p>
      </div>
      <div className="ex-scroll ex-cases-wrap">
        <table className="ex-table ex-cases">
          <thead><tr><th>Provider</th><th>Provisional expected outcome</th>{BASELINES.map((b) => <th key={b.id} className="ex-c" title={`${b.label}: ${b.rule}`}>{b.id}</th>)}<th className="ex-c">Final grade<br /><small>(S, shipped)</small></th><th>Known issue</th></tr></thead>
          <tbody>
            {cases.map((c) => {
              const S = grades.S.find((x) => x.npi === c.npi)!;
              const issues = failures.map((f, i) => ({ f, i })).filter(({ f }) => f.npis.includes(c.npi));
              return (
                <tr key={c.npi} className={`ex-case-row ex-row-${S.overall.toLowerCase()}`}>
                  <td><button className="ex-case-name" onClick={() => go(`cases/${c.npi}`)}>{c.name}</button><div className="ex-mob-only">Final (S): <V v={S.overall} /></div><div className="ex-muted ex-small">{c.cohort === "random-sample" ? "random sample" : "pipeline-evaluated"} · <span className="ex-mono">{c.npi}</span></div></td>
                  <td><span className={`ex-exp-out ex-exp-${c.expected.outcome}`}>{c.expected.outcome.replace("_", " ")}{c.expected.outcomeIsJudgement && " ◆"}</span><div className="ex-basis">{c.expected.outcomeBasis}</div></td>
                  {BASELINES.map((b) => { const g = grades[b.id].find((x) => x.npi === c.npi)!; return <td key={b.id} className="ex-c" title={[g.outcome, g.fax, g.location, g.identity].map((k) => `${k.v}: ${k.why}`).join("\n")}><V v={g.overall} /><div className="ex-grp">{g.decision ? GROUP_LABEL[g.decision.group] : "—"}</div></td>; })}
                  <td className="ex-c ex-final"><V v={S.overall} /></td>
                  <td>{issues.length ? issues.map(({ f, i }) => <button key={f.id} className="ex-chip ex-chip-bad" onClick={() => go(`failures/${f.id}`)} title={f.title}>F{i + 1} {f.title}</button>) : <span className="ex-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="ex-note">Cells show the case verdict and the group each baseline put the provider in. Hover a cell for the four checks (outcome, fax, location, identity); open the provider for full reasoning.</p>
    </div>
  );
}

// ── Case drawer (level 3 for one provider) ───────────────────────────────────

function CaseDrawer(props: Ctx & { npi: string; onClose: () => void }) {
  const { cases, grades, npi, onClose } = props;
  const gt = cases.find((c) => c.npi === npi)!;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="ex-drawer-bg" onClick={onClose}>
      <aside className="ex-drawer" role="dialog" aria-modal="true" aria-label={`Evidence for ${gt.name}`} onClick={(e) => e.stopPropagation()}>
        <header className="ex-drawer-head">
          <div>
            <div className="ex-kicker">Case evidence · <span className="ex-mono">{gt.npi}</span> · {gt.cohort === "random-sample" ? "random sample" : "pipeline-evaluated"}</div>
            <h2>{gt.name}</h2>
            <div className="ex-drawer-grades">{BASELINES.map((b) => <span key={b.id}><span className="ex-bid">{b.id}</span><V v={grades[b.id].find((x) => x.npi === npi)!.overall} /></span>)}</div>
          </div>
          <button className="ex-btn" onClick={onClose} aria-label="Close">Close ✕</button>
        </header>
        <div className="ex-drawer-body"><CaseEvidence {...props} /></div>
      </aside>
    </div>
  );
}

function Json({ v, label }: { v: unknown; label: string }) {
  return <details className="ex-json"><summary>{label}</summary><pre>{JSON.stringify(v, null, 2)}</pre></details>;
}

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

function CaseEvidence({ run, grades, decisions, cases, npi }: Ctx & { npi: string }) {
  const gt = cases.find((c) => c.npi === npi)!;
  const c = (run.nearby.data?.results ?? []).find((x) => x.npi === npi);
  const reg = run.registry[npi]?.data;
  const disc = run.discovery[npi];
  const ai: ReferralView | null = run.liveAi[npi]?.data?.view ?? run.savedAi[npi]?.data ?? null;
  const d = decisions[npi];
  const S = d?.S;
  const lic = reg?.license;
  return (
    <div className="ex-ev">
      <section>
        <h4>Provisional ground truth <span className="ex-prov-tag">human-verified: {gt.humanVerified ? "yes" : "NO"}</span></h4>
        <p className="ex-small ex-muted">Drafted by {gt.checkedBy}.</p>
        <dl className="ex-kv">
          <dt>Expected outcome</dt><dd><strong>{gt.expected.outcome.replace("_", " ")}</strong>{gt.expected.outcomeIsJudgement ? " (judgement)" : " (fact)"}: {gt.expected.outcomeBasis}</dd>
          <dt>Licence</dt><dd>{gt.expected.licence ? <>{gt.expected.licence.type}, {gt.expected.licence.status}, expires {gt.expected.licence.expires ?? "—"}</> : "none / not applicable"}</dd>
          <dt>Specialty</dt><dd>{gt.expected.specialty.value} {gt.expected.specialty.url && <a href={gt.expected.specialty.url} target="_blank" rel="noreferrer">source ↗</a>}</dd>
          <dt>Practices</dt><dd>{gt.expected.practices ? gt.expected.practices.map((p) => <div key={p.line1 + p.name}>{p.name}, {p.line1}, {p.city} <a href={p.url} target="_blank" rel="noreferrer">↗</a></div>) : "NOT ESTABLISHED"}</dd>
          <dt>Faxes</dt><dd>{gt.expected.faxes ? gt.expected.faxes.map((f) => <div key={f.digits + f.referral}><code>{f.digits}</code> {f.referral ? "REFERRAL" : "office"} “{f.label.slice(0, 80)}” <a href={f.url} target="_blank" rel="noreferrer">↗</a></div>) : "NOT ESTABLISHED"}</dd>
          <dt>Sees adults</dt><dd>{gt.expected.seesAdults}</dd>
          {gt.expected.wrongEvidence.length > 0 && <><dt>Known-wrong evidence</dt><dd>{gt.expected.wrongEvidence.join(", ")}</dd></>}
          {gt.failures.length > 0 && <><dt>Ground-truth gaps</dt><dd>{gt.failures.join(" · ")}</dd></>}
        </dl>
      </section>

      <section>
        <h4>Classification reasoning and grades, per baseline</h4>
        <div className="ex-scroll">
          <table className="ex-table ex-compact">
            <thead><tr><th>Baseline</th><th>Group</th><th>Evidence</th><th>Location</th><th>Fax</th><th>Pts (ver / dest)</th><th>Review reasons</th><th>Outcome</th><th>Fax</th><th>Location</th><th>Identity</th></tr></thead>
            <tbody>{BASELINES.map((b) => {
              const g = grades[b.id].find((x) => x.npi === npi)!;
              const x = d?.[b.id];
              return <tr key={b.id}><td><span className="ex-bid">{b.id}</span></td><td>{x ? GROUP_LABEL[x.group] : "not in run"}</td><td>{x?.evidence ?? "—"}</td><td>{x?.location ? `${x.location.line1}, ${x.location.city} (${x.location.distanceMi ?? "?"} mi)` : "—"}</td><td>{x?.fax ? <>{x.fax.number}<div className="ex-muted">{x.fax.cls}{x.fax.label ? ` · “${x.fax.label}”` : ""}</div></> : "—"}</td><td className="ex-num">{x?.verification ?? "—"} / {x?.destination ?? "—"}</td><td className="ex-small">{x?.reasons.join("; ") || "—"}</td>
                {[g.outcome, g.fax, g.location, g.identity].map((k, i) => <td key={i} title={k.why}><V v={k.v} /><div className="ex-small ex-muted">{k.why}</div></td>)}</tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      {S?.scoreItems && (
        <section>
          <h4>Score calculation — shipped (S), rule points, not probabilities</h4>
          <div className="ex-cols">
            <ScoreTable items={S.scoreItems.verification} title={`Provider verification — ${S.verification} pts`} />
            <ScoreTable items={S.scoreItems.destination} title={`Destination evidence (chosen location) — ${S.destination} pts`} />
          </div>
          <p className="ex-small">Review reasons fired: {S.reasons.length ? S.reasons.join("; ") : <strong>none → Recommended</strong>}</p>
        </section>
      )}

      <section>
        <h4>NPPES record</h4>
        {c ? <p className="ex-small">Registry candidate: {c.specialty} (<code>{c.specialtyCode}</code>) · nearest {c.nearest.line1}, {c.nearest.city} · {c.nearest.distanceMi} mi · phone {c.nearest.phone ?? "—"} · fax {c.nearest.fax ?? "—"} · last updated {c.lastUpdated ?? "—"}</p> : <p className="ex-bad">Not among this run’s in-radius candidates.</p>}
        {reg && <Json v={reg.provider} label={`Full NPPES record (${reg.provider.source}, fetched ${reg.provider.fetchedAt})`} />}
      </section>

      <section>
        <h4>Licence</h4>
        {!lic ? <p className="ex-muted">No licence record.</p> : (
          <>
            <p className="ex-small">{lic.source} · match <strong>{lic.match}</strong> · {lic.matchNote}</p>
            {lic.records.length > 0 && <div className="ex-scroll"><table className="ex-table ex-compact"><thead><tr><th>Credential</th><th>Type</th><th>Status</th><th>Name</th><th>Expires</th><th>Action taken</th></tr></thead>
              <tbody>{lic.records.map((r) => <tr key={r.credentialNumber}><td className="ex-mono">{r.credentialNumber}</td><td>{r.credentialType}</td><td>{r.status}</td><td>{r.name}</td><td>{r.expires ?? "—"}</td><td>{r.actionTaken ?? "—"}</td></tr>)}</tbody></table></div>}
            <Json v={lic} label="Raw licence record" />
          </>
        )}
        {reg && <ScoreTable items={reg.providerScore.items} title={`Baseline provider verification (no web evidence) — ${reg.providerScore.score} pts`} />}
      </section>

      <section>
        <h4>Deterministic web check (Brave){disc ? ` — ${disc.role === "production" ? "one of the product’s own 8 picks" : "run only for baseline C"} · ${fmtMs(disc.ms)}` : ""}</h4>
        {!disc ? <p className="ex-muted">Not run.</p> : !disc.data ? <p className="ex-bad">Failed: {disc.error}</p> : (
          <>
            <p className="ex-small">Query: <code>{disc.data.log.query}</code> · search {disc.data.log.search.status}{disc.data.log.search.error ? ` (${disc.data.log.search.error})` : ""} · outcome <strong>{disc.data.log.outcome}</strong></p>
            <h5>URLs discovered</h5>
            <div className="ex-scroll"><table className="ex-table ex-compact">
              <thead><tr><th>URL</th><th>Skip rule</th><th>Priority</th><th>Fetched</th></tr></thead>
              <tbody>{disc.data.log.candidates.map((h) => <tr key={h.url}><td className="ex-url"><a href={h.url} target="_blank" rel="noreferrer">{h.url}</a><div className="ex-muted">{h.title}</div></td><td>{h.skip ?? "—"}</td><td className="ex-num">{h.priority}</td><td>{h.fetched ? "yes" : "no"}</td></tr>)}</tbody>
            </table></div>
            <h5>Fetch results and matching signals</h5>
            <div className="ex-scroll"><table className="ex-table ex-compact">
              <thead><tr><th>Page fetched</th><th>HTTP</th><th>Name</th><th>NPI #</th><th>Specialty near name</th><th>Org</th><th>Referral page</th><th>Family</th><th>Decision</th></tr></thead>
              <tbody>{disc.data.log.pages.map((p) => <tr key={p.url}><td className="ex-url">{p.url}</td><td>{p.fetched}{p.httpStatus ? ` ${p.httpStatus}` : ""}</td><td>{p.nameOnPage ? "✓" : "✗"}</td><td>{p.npiOnPage ? "✓" : "✗"}</td><td>{p.specialtyOnPage ? "✓" : "✗"}</td><td>{p.orgOnPage ?? "—"}</td><td>{p.referralPage ? "✓" : "✗"}</td><td title={p.familyReason}>{p.family}</td><td className={p.accepted ? "ex-good" : ""}>{p.reason}{p.evidence ? <div className="ex-muted">{p.evidence}</div> : null}</td></tr>)}</tbody>
            </table></div>
            <Json v={disc.data} label="Raw discovery response" />
          </>
        )}
      </section>

      <section>
        <h4>AI research {ai?.research ? (run.liveAi[npi]?.data ? <Kind k="LIVE" /> : <span className="ex-prov-tag">CACHED · researched {date(ai.research.researchedAt)}</span>) : ""}</h4>
        {!ai?.research ? <p className="ex-muted">None for this provider.</p> : (
          <>
            <p className="ex-small">{ai.research.usage.researchModel} → {ai.research.usage.extractModel} · {ai.research.usage.searchCalls} web searches · {ai.research.usage.inputTokens.toLocaleString()} in / {ai.research.usage.outputTokens.toLocaleString()} out tokens · {fmtMs(ai.research.usage.durationMs)}</p>
            <p className="ex-small"><strong>Model-written queries:</strong> {ai.research.searchQueries.map((q) => <code key={q} className="ex-q">{q}</code>)}</p>
            <h5>AI claims</h5>
            <p className="ex-small">identity confirmed={String(ai.research.identity.confirmed)} conflict={String(ai.research.identity.conflict)} · specialty “{ai.research.specialty.value}” ({ai.research.specialty.status}) · relationship {ai.research.relationship.kind}</p>
            <div className="ex-scroll"><table className="ex-table ex-compact">
              <thead><tr><th>Id</th><th>Source (as returned by the model’s search)</th><th>Family</th><th>Why that family</th><th>Currentness (AI)</th><th>Model summary (AI claim)</th></tr></thead>
              <tbody>{ai.research.sources.map((s) => <tr key={s.id}><td>{s.id}</td><td className="ex-url"><a href={s.url} target="_blank" rel="noreferrer">{s.url}</a></td><td>{s.family}</td><td className="ex-small">{s.familyReason}</td><td>{s.currentness}</td><td className="ex-small">{s.summary}</td></tr>)}</tbody>
            </table></div>
            <div className="ex-scroll"><table className="ex-table ex-compact">
              <thead><tr><th>Location claimed</th><th>Status</th><th>Faxes (label verbatim · kind · checked)</th><th>Dest pts</th></tr></thead>
              <tbody>{ai.locations.map((l) => <tr key={l.id}><td>{l.name}<div className="ex-muted">{l.line1}, {l.city} · {l.distanceMi ?? "?"} mi · src {l.sourceIds.join(",")}</div></td><td>{l.status}</td><td className="ex-small">{l.faxes.map((f) => `${f.number} “${f.label ?? "—"}” ${f.faxKind}${f.labelCheck ? ` (${f.labelCheck})` : ""}`).join(" · ") || "—"}</td><td className="ex-num">{l.referral.score}</td></tr>)}</tbody>
            </table></div>
            <h5>AI conflicts <span className="ex-bad">(used by NO rule)</span></h5>
            {ai.research.conflicts.length ? <ul className="ex-small">{ai.research.conflicts.map((x, i) => <li key={i}>[{x.field}] {x.description}</li>)}</ul> : <p className="ex-small ex-muted">none</p>}
            <h5>Dropped claims / deterministic overrides ({ai.research.dropped.length})</h5>
            <ul className="ex-small">{ai.research.dropped.map((x, i) => <li key={i}>{x.reason}: {x.detail}</li>)}</ul>
            <h5>AI-judged fields and their effect</h5>
            <div className="ex-scroll"><table className="ex-table ex-compact"><thead><tr><th>AI-judged field</th><th>Value</th><th>Effect on result</th></tr></thead>
              <tbody>{aiJudgements(ai).map((j) => <tr key={j.field}><td className="ex-mono">{j.field}</td><td>{j.value}</td><td>{j.effect}</td></tr>)}</tbody></table></div>
            <div className="ex-cols"><ScoreTable items={ai.providerScore.items} title={`Provider verification — ${ai.providerScore.score} pts`} /></div>
            <Json v={ai.research} label="Raw AI research record (as re-scored)" />
          </>
        )}
      </section>
    </div>
  );
}

// ── Level 2 + 3: Methodology & raw evidence ──────────────────────────────────

const METHOD_SECTIONS: [string, string][] = [["grading", "Grading rules"], ["baselines", "Baseline definitions"], ["scores", "Scores are rule points"], ["ai", "Where AI is used"], ["wrong", "Why this may be wrong"], ["reproduce", "Reproduce"]];

function MethodTab(ctx: Ctx & { raw: boolean }) {
  const { raw, go } = ctx;
  return (
    <div>
      <div className="ex-page-head">
        <h2>Methodology & raw evidence</h2>
        <div className="ex-seg" role="tablist">
          <button role="tab" aria-selected={!raw} className={!raw ? "on" : ""} onClick={() => go("method")}>Methodology</button>
          <button role="tab" aria-selected={raw} className={raw ? "on" : ""} onClick={() => go("method/raw")}>Raw experiment report</button>
        </div>
      </div>
      {raw ? <RawReport {...ctx} /> : (
        <div className="ex-method">
          <nav className="ex-toc">{METHOD_SECTIONS.map(([id, l]) => <a key={id} href={`#method/${id}`}>{l}</a>)}<a href="#method/raw">Raw experiment report →</a></nav>
          <div className="ex-method-body">
            <Grading {...ctx} />
            <BaselineDefs />
            <Scores {...ctx} />
            <AiCalls {...ctx} />
            <Wrong {...ctx} />
            <Reproduce {...ctx} />
          </div>
        </div>
      )}
    </div>
  );
}

function Grading({ cases }: Ctx) {
  return (
    <section id="method-grading" className="ex-msec">
      <h3>Grading rules</h3>
      <p>Each case gives the expected identity, licence, current specialty, current practice location(s), fax(es) with verbatim labels and whether each is a referral fax, and the expected referral-fit outcome for scenario A (adult, 46, asymmetric SNHL, ENT referral). Cases live in <code>src/npi/experiment/data/cases.json</code>. Add a case there and it is graded on the next run.</p>
      <ul className="ex-rules">
        <li><strong>Cohorts:</strong> {cases.filter((c) => c.cohort === "pipeline-evaluated").length} providers the product itself evaluated (7 AI + 8 Brave), plus {cases.filter((c) => c.cohort === "random-sample").length} drawn at random from the unresolved individuals (sha256("m027:"+NPI), lowest 5) to measure what the product misses.</li>
        <li><strong>Outcome:</strong> expected <em>not recommend</em> + Recommended = <V v="FAIL" /> (false recommendation). + Needs review = <V v="PASS" />. + unresolved = <V v="UNRESOLVED" />, <strong>never</strong> counted as a correct rejection. Expected <em>recommend</em> + review/unresolved = <V v="UNRESOLVED" /> (missed). Expected <em>unknown</em> = <V v="UNRESOLVED" /> whatever the output.</li>
        <li><strong>Fax / location</strong> are graded only when Recommended: the fax must be an established official fax, and the location must match an established practice (house number + street). If there is no established fact, the check is <V v="UNRESOLVED" />. A “referral-verified” claim that ground truth can’t confirm is <V v="UNRESOLVED" />.</li>
        <li><strong>Identity:</strong> <V v="FAIL" /> if any evidence URL is on the case’s <code>wrongEvidence</code> list or is a person-profile URL whose slug lacks the provider’s last name (heuristic).</li>
        <li><strong>Overall:</strong> any FAIL → FAIL; else any UNRESOLVED → UNRESOLVED; else PASS.</li>
        <li><strong>Provenance:</strong> <strong>{cases.filter((c) => c.humanVerified).length} cases are human-verified.</strong> Every expected fact was drafted by Claude subagents from primary sources, so wherever this page grades the pipeline it is <strong>AI checking AI-assisted output</strong> until a person signs the cases off. Expectations marked ◆ rest on a judgement (clinical or operational), not a fact.</li>
      </ul>
    </section>
  );
}

function BaselineDefs() {
  return (
    <section id="method-baselines" className="ex-msec">
      <h3>Baseline definitions</h3>
      <div className="ex-scroll"><table className="ex-table">
        <thead><tr><th>Id</th><th>Baseline</th><th>Rule</th></tr></thead>
        <tbody>{BASELINES.map((b) => <tr key={b.id}><td><span className="ex-bid">{b.id}</span></td><td>{b.label}{b.ai && <> <Kind k="AI" /></>}</td><td>{b.rule}</td></tr>)}</tbody>
      </table></div>
    </section>
  );
}

function Scores({ run, decisions }: Ctx) {
  const d = decisions["1790313880"]?.S;
  return (
    <section id="method-scores" className="ex-msec">
      <h3>The 0–100 numbers are rule points, not probabilities</h3>
      <p>“Provider verification” and “Destination evidence” are sums of hand-set points (<code>api/_npi-score.ts</code>), clamped to 0–100. The weights were chosen by the developers and <strong>have never been fitted or calibrated against outcomes</strong>. 95 pts does <strong>not</strong> mean a 95% chance of being right. With only {Object.keys(run.savedAi).length + Object.values(run.discovery).filter((x) => x.data?.view).length} researched providers and no human-verified labels, calibration isn’t possible yet. Neither score gates Recommended by itself. Grouping comes from a list of “review reasons” (<code>assessDestination</code>), and destination points matter only below 50.</p>
      {d?.scoreItems && (
        <>
          <p>Worked example: Jyoti Sharma, a cosmetic facial plastic surgeon whom ground truth says not to recommend for this referral. Shipped-product group in this run: <strong>{d.group}</strong>. Each line is one rule firing:</p>
          <div className="ex-cols">
            <ScoreTable items={d.scoreItems.verification} title={`Provider verification — ${d.verification} pts`} />
            <ScoreTable items={d.scoreItems.destination} title={`Destination evidence (chosen location) — ${d.destination} pts`} />
          </div>
          <p className="ex-note">Review reasons fired: {d.reasons.length ? d.reasons.join("; ") : <strong>none → Recommended</strong>}. The “Specialty corroborated” points come from the model’s specialty value after the code’s word-stem override.</p>
        </>
      )}
    </section>
  );
}

function AiCalls({ run }: Ctx) {
  const rows = [
    ...Object.entries(run.savedAi).map(([npi, t]) => ({ npi, v: t.data, live: false, servedMs: t.ms })),
    ...Object.entries(run.liveAi).map(([npi, t]) => ({ npi, v: t.data?.view ?? null, live: true, servedMs: t.ms })),
  ].filter((r) => r.v?.research);
  const tot = rows.reduce((a, r) => ({ i: a.i + r.v!.research!.usage.inputTokens, o: a.o + r.v!.research!.usage.outputTokens, s: a.s + r.v!.research!.usage.searchCalls }), { i: 0, o: 0, s: 0 });
  return (
    <section id="method-ai" className="ex-msec">
      <h3>Exactly where AI is used</h3>
      <p>AI is used in <strong>one place</strong>: <code>researchProvider()</code> in <code>api/_npi-referral.ts</code>, behind the operator key. A normal viewer never triggers AI; only an operator with the key can. Every provider researched costs two model calls:</p>
      <div className="ex-scroll"><table className="ex-table">
        <thead><tr><th>Call</th><th>Model (configured)</th><th>Purpose</th><th>Evidence provided</th><th>Output</th></tr></thead>
        <tbody>
          <tr><td>1 · research</td><td><code>gpt-5.4</code> (fallback <code>gpt-4.1</code> on HTTP 400/404), Responses API + <code>web_search</code> tool, reasoning effort low, ≤8k output tokens, 170 s timeout</td><td>Search the open web and write a report on where and how to refer to this provider</td><td>NPPES facts only (<code>npiFacts</code>: name, credential, taxonomies + licence numbers, practice addresses/phones/faxes, authorised official, last-updated). <strong>No patient data.</strong> The model chooses its own queries and pages.</td><td>Free-text report + the URLs its searches returned</td></tr>
          <tr><td>2 · extraction</td><td><code>gpt-4.1-mini</code> (fallback <code>gpt-4o-mini</code>), strict JSON schema</td><td>Turn the report into structured claims</td><td>NPPES facts + first 24k chars of the report + numbered source URLs</td><td>identity, specialty, affiliations, sources (+family, currentness, about-different-provider), locations with phones/faxes + verbatim labels, conflicts, licences</td></tr>
        </tbody>
      </table></div>
      <p className="ex-note">Not AI, despite looking like it: the Brave public-web check (usage says <code>researchModel: "none"</code>), every score, every grouping, and the inbound-fax “AI reading” in the referral demo (simulated regex).</p>
      <h4>Every model call behind this run ({rows.length * 2} calls, {rows.filter((r) => r.live).length * 2} live)</h4>
      <div className="ex-scroll"><table className="ex-table">
        <thead><tr><th>Provider</th><th>Models</th><th>Cached / live</th><th>Web searches</th><th>Tokens in / out (both calls)</th><th>Latency at generation</th><th>Served in this run</th><th>Cost</th><th>Output</th></tr></thead>
        <tbody>
          {rows.map(({ npi, v, live, servedMs }) => {
            const r = v!.research!;
            return (
              <tr key={npi + live}>
                <td>{v!.provider.name}<div className="ex-muted ex-mono">{npi}</div></td>
                <td className="ex-mono">{r.usage.researchModel} → {r.usage.extractModel}</td>
                <td>{live ? <Kind k="LIVE" /> : <>cached · {date(r.researchedAt)}</>}</td>
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
      </table></div>
      <p className="ex-note">Token counts are recorded per provider for the two calls combined. The split between the calls was not recorded. Dollar cost can’t be computed from the repo: model and search-tool pricing are not stored, and neither is OpenAI billing. The AI-judged fields for each provider, and their effect on the result, are in that provider’s case evidence.</p>
    </section>
  );
}

function Wrong({ run, cases, byId }: Ctx) {
  const d = byId.D;
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
    <section id="method-wrong" className="ex-msec ex-wrong">
      <h3>{items.length} reasons this experiment may be wrong</h3>
      <ol className="ex-wrong-grid">{items.map(([t, b]) => <li key={t}><strong>{t}</strong><span>{b}</span></li>)}</ol>
    </section>
  );
}

function Reproduce({ run, grades, cases }: Ctx) {
  const download = () => {
    const blob = new Blob([JSON.stringify({ run, cases, grades }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${run.meta.runId}.json`;
    a.click();
  };
  return (
    <section id="method-reproduce" className="ex-msec">
      <h3>Reproduce it</h3>
      <ol className="ex-rules">
        <li><strong>In the browser:</strong> “Run live experiment” on the Overview re-executes every public endpoint in the product’s order and re-grades. That is ≈20 Brave queries and no AI. With <code>?operator</code> and the key, it can also re-run AI research (paid).</li>
        <li><strong>From a checkout:</strong> <code>node --import ./tests/resolve-ts.mjs scripts/npi-experiment.mts capture https://elk-inventory.vercel.app</code> records a run to <code>src/npi/experiment/data/run.json</code> and prints this report as text. Use <code>… report [run.json]</code> to re-grade a recorded run. Set <code>NPI_AI_KEY</code> + <code>NPI_AI_NPIS</code> to include live AI research.</li>
        <li><strong>Add or correct a case:</strong> edit <code>src/npi/experiment/data/cases.json</code> and set <code>humanVerified: true</code> only after a person has checked every expected fact against the cited URLs. The raw agent notes are in <code>data/ground-truth-raw.json</code>.</li>
        <li><strong>Grading and baselines</strong> are pure functions in <code>src/npi/experiment/evaluate.ts</code>, tested in <code>tests/npi-experiment.test.ts</code>. C, D and S call the product’s own <code>pickDestination</code> / <code>assessDestination</code>.</li>
      </ol>
      <button className="ex-btn" onClick={download}>Download this run + cases + grades (JSON)</button>
      <p className="ex-note">Related: <a href="/npi-list/referral-demo">the demo</a> (which links back here) · <a href="/npi-list/opportunity">“Why explore this?”</a> (written before this experiment; read it with this page open).</p>
    </section>
  );
}

function RawReport(ctx: Ctx) {
  const { run, cases, stages, m, grades } = ctx;
  return (
    <div className="ex-raw">
      <p className="ex-lede">Every stage, metric and per-provider record for run <code>{run.meta.runId}</code>, unedited. Nothing here is summarised.</p>
      <details className="ex-exp" open>
        <summary><strong>Pipeline run, stage by stage</strong><span className="ex-exp-sum">{stages.length} stages</span></summary>
        <StageTable rows={stages} />
      </details>
      <details className="ex-exp" open>
        <summary><strong>All metrics, per baseline</strong></summary>
        <MetricsTable m={m} />
      </details>
      <details className="ex-exp">
        <summary><strong>Case verdicts with every check</strong><span className="ex-exp-sum">{cases.length} cases × {BASELINES.length} baselines</span></summary>
        <div className="ex-scroll"><table className="ex-table ex-compact">
          <thead><tr><th>Case</th>{BASELINES.map((b) => <th key={b.id}>{b.id}</th>)}</tr></thead>
          <tbody>{cases.map((c) => <tr key={c.npi}><td>{c.name}</td>{BASELINES.map((b) => { const g = grades[b.id].find((x) => x.npi === c.npi)!; return <td key={b.id} className="ex-small"><V v={g.overall} /> {g.decision?.group ?? "—"}{[g.outcome, g.fax, g.location, g.identity].filter((k) => k.v !== "N/A" && k.v !== "PASS").map((k, i) => <div key={i} className="ex-muted">{k.v}: {k.why}</div>)}</td>; })}</tr>)}</tbody>
        </table></div>
      </details>
      <h3>Raw evidence, per provider</h3>
      {cases.map((gt) => (
        <details key={gt.npi} id={`ev-${gt.npi}`} className="ex-exp">
          <summary><strong>{gt.name}</strong> <span className="ex-mono ex-muted">{gt.npi}</span><span className="ex-exp-sum">expected {gt.expected.outcome.replace("_", " ")} · {BASELINES.map((b) => <span key={b.id} className="ex-sum-v">{b.id} <V v={grades[b.id].find((x) => x.npi === gt.npi)!.overall} /></span>)}</span></summary>
          <CaseEvidence {...ctx} npi={gt.npi} />
        </details>
      ))}
    </div>
  );
}
