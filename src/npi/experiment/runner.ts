// ── Provider Intelligence experiment — the run recorder ──────────────────────
// Executes the SAME public endpoints the product uses, in the same order, and
// records what each returned and how long it took. Runs in the browser ("Run
// live") and in node (scripts/npi-experiment.mts). It never calls OpenAI unless
// an operator key AND an explicit list of NPIs to research are passed in.
import type { DiscoverResponse, NearbyResponse, ReferralResearch, ReferralView, ResearchEvent } from "../types";
import type { ExperimentRun, LiveAiCall, RunCandidate, Timed } from "./types";
import { snapshotAppliesTo } from "../demo/routing";

// Mirrors src/npi/research.ts DISCOVERY_LIMIT (kept literal: that module imports React).
export const PRODUCTION_DISCOVERY_LIMIT = 8;

export interface RunOptions {
  base: string; // "" in the browser (same origin), a full origin in node
  specialty: string;
  location: string;
  radius: number;
  patientAge: number;
  caseNpis: string[]; // ground-truth cases: always get registry + Brave (baseline C) data
  snapshot: ReferralResearch[]; // the saved AI research the product ships with
  ai?: { key: string; npis: string[] }; // operator-only live AI research (paid)
  fetcher?: typeof fetch;
  onProgress?: (msg: string) => void;
  runner: string;
  codeVersion?: string | null;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

async function timed<T>(f: () => Promise<T>): Promise<Timed<T>> {
  const t = now();
  try {
    const data = await f();
    return { ms: Math.round(now() - t), ok: true, error: null, data };
  } catch (err) {
    return { ms: Math.round(now() - t), ok: false, error: (err as Error).message, data: null };
  }
}

async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>): Promise<void> {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { for (let x = q.shift(); x !== undefined; x = q.shift()) await f(x); }));
}

export function trimCandidate(r: NearbyResponse["results"][number]): RunCandidate {
  const fax = r.nearest.bestFax;
  return {
    npi: r.npi, name: r.name, credential: r.credential, enumerationType: r.enumerationType, status: r.status,
    specialty: r.specialty, specialtyCode: r.specialtyCode, lastUpdated: r.lastUpdated,
    nearest: { name: r.nearest.name, organization: r.nearest.organization, line1: r.nearest.line1, city: r.nearest.city, postalCode: r.nearest.postalCode, distanceMi: r.nearest.distanceMi, phone: r.nearest.phones[0]?.number ?? null, fax: fax?.number ?? null, faxDigits: fax?.digits ?? null },
    sharedAddressOrgs: r.sharedAddressOrgs, license: r.license, baselineVerification: r.provider.score,
  };
}

export async function runExperiment(o: RunOptions): Promise<ExperimentRun> {
  const f = o.fetcher ?? fetch;
  const say = o.onProgress ?? (() => {});
  const getJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const res = await f(`${o.base}${url}`, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    return body as T;
  };

  const run: ExperimentRun = {
    meta: {
      runId: `run-${new Date().toISOString().replace(/[:.]/g, "-")}`, capturedAt: new Date().toISOString(), base: o.base || "(same origin)", runner: o.runner, codeVersion: o.codeVersion ?? null,
      input: { specialty: o.specialty, location: o.location, radius: o.radius, patientAge: o.patientAge },
      snapshotResearchedAt: [],
    },
    nearby: { ms: 0, ok: false, error: null, data: null }, savedAi: {}, discovery: {}, registry: {}, liveAi: {},
  };

  // 1. Registry search (server does specialty → origin → NPPES → geocode → licence → radius).
  say("NPPES candidate search…");
  const nb = await timed(() => getJson<NearbyResponse>(`/api/npi-nearby?${new URLSearchParams({ specialty: o.specialty, location: o.location, radius: String(o.radius) })}`));
  run.nearby = { ...nb, data: nb.data && {
    origin: { label: nb.data.origin.label, lat: nb.data.origin.coords.lat, lon: nb.data.origin.coords.lon, precision: nb.data.origin.precision, method: nb.data.origin.method, state: nb.data.origin.state },
    specialty: nb.data.specialty, radiusMi: nb.data.radiusMi, scanned: nb.data.scanned, notes: nb.data.notes, trace: nb.data.trace ?? null,
    results: nb.data.results.map(trimCandidate),
  } };
  const data = nb.data;
  if (!data) return run;
  const ctx = new URLSearchParams({ lat: String(data.origin.coords.lat), lon: String(data.origin.coords.lon), radius: String(data.radiusMi), specialty: o.specialty });
  const inRange = new Set(data.results.map((r) => r.npi));

  // 2. Saved AI research, re-scored by the server for this search (no AI call). ENT family only.
  const saved = snapshotAppliesTo(data.specialty.key) ? o.snapshot.filter((s) => inRange.has(s.npi)) : [];
  run.meta.snapshotResearchedAt = saved.map((s) => s.researchedAt);
  say(`Re-scoring ${saved.length} saved AI research results…`);
  await pool(saved, 4, async (s) => {
    run.savedAi[s.npi] = await timed(() => getJson<ReferralView>(`/api/npi-provider?npi=${s.npi}&${ctx}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ research: s }) }));
  });

  // 3. Cheap Brave pass: the product's own picks (nearest active without research), plus
  //    every ground-truth case so baseline C covers the same providers as the others.
  const production = data.results.filter((r) => r.status === "Active" && !run.savedAi[r.npi]?.data).slice(0, PRODUCTION_DISCOVERY_LIMIT);
  const prodSet = new Set(production.map((r) => r.npi));
  const byNpi = new Map(data.results.map((r) => [r.npi, r]));
  const discoverFor = [...production, ...o.caseNpis.filter((n) => !prodSet.has(n) && byNpi.has(n)).map((n) => byNpi.get(n)!)];
  say(`Public-web check (Brave + page fetch, no AI) on ${discoverFor.length} providers…`);
  await pool(discoverFor, 2, async (r) => {
    const p = new URLSearchParams({ npi: r.npi, lat: String(data.origin.coords.lat), lon: String(data.origin.coords.lon), radius: String(data.radiusMi), specialty: o.specialty, city: r.nearest.city, state: r.nearest.state });
    for (const org of r.sharedAddressOrgs) p.append("org", org);
    run.discovery[r.npi] = { ...(await timed(() => getJson<DiscoverResponse>(`/api/npi-discover?${p}`))), role: prodSet.has(r.npi) ? "production" : "baseline" };
  });

  // 4. Raw registry + licence view per case (evidence explorer).
  say("Fetching raw NPPES + licence records for the cases…");
  await pool(o.caseNpis, 4, async (npi) => { run.registry[npi] = await timed(() => getJson<ReferralView>(`/api/npi-provider?npi=${npi}&${ctx}`)); });

  // 5. Optional live AI research (operator key; paid; ~1.5–2.5 min each).
  if (o.ai?.key && o.ai.npis.length) {
    say(`Live AI research on ${o.ai.npis.length} providers (paid)…`);
    await pool(o.ai.npis, 3, async (npi) => { run.liveAi[npi] = await timed(() => liveResearch(f, o.base, npi, ctx, o.ai!.key)); });
  }
  say("Done.");
  return run;
}

async function liveResearch(f: typeof fetch, base: string, npi: string, ctx: URLSearchParams, key: string): Promise<LiveAiCall> {
  const t0 = now();
  const res = await f(`${base}/api/npi-research?npi=${npi}&fresh=1&${ctx}`, { headers: { "X-Demo-Key": key } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const out: LiveAiCall = { events: [], view: null };
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const e = JSON.parse(line) as ResearchEvent;
      if (e.type === "ping") continue;
      const t = Math.round(now() - t0);
      if (e.type === "result") { out.view = e.view; out.events.push({ t, type: "result" }); }
      else if (e.type === "error") { out.events.push({ t, type: "error", message: e.message }); throw new Error(e.message); }
      else if (e.type === "stage") out.events.push({ t, type: `stage:${e.stage}`, message: e.message });
      else if (e.type === "sources") out.events.push({ t, type: "sources", message: `${e.sources.length} sources, ${e.queries.length} queries` });
    }
  }
  return out;
}
