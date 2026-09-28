// ── Step: find a specialist — REAL provider search, reused from /npi-list ────
// The patient is fake; this step is not. It calls the same /api/npi-nearby
// search and the same research store as the provider-intelligence page, and
// re-scores saved web research on the server for this origin (no AI call).
import { useEffect, useMemo, useReducer, useState } from "react";
import { getDemoKey, loadResearch, searchNearby, setDemoKey, type SearchContext } from "../api";
import { getResearch, hydrateCached, isRunning, startResearch, subscribeResearch } from "../research";
import type { NearbyResponse, NearbyResult, PracticeLocation, ReferralView } from "../types";
import { Breakdown, Checks, FaxBlock, Icon, ScorePill, SourceChips, destinationChecks, formatDate, initials, type Check } from "../ui";
import { loadSnapshot } from "./snapshot";
import { pediatricMismatch, toDestination, type Destination } from "./model";

const RADII = [5, 10, 25, 50];
const STAGES = ["Querying the federal NPI Registry", "Geocoding every practice address", "Measuring distance from the patient's area", "Checking Washington licences", "Loading web-research evidence"];

interface Props {
  specialty: string;
  location: string;
  radius: number;
  age: number | null;
  flagged: string[]; // "npi|faxDigits" whose fake fax failed this session
  onRadius: (r: number) => void;
  onSearched: (count: number) => void;
  onChoose: (d: Destination) => void;
}

export default function Specialists({ specialty, location, radius, age, flagged, onRadius, onSearched, onChoose }: Props) {
  const [state, setState] = useState<{ status: "loading" | "done" | "error"; data?: NearbyResponse; error?: string }>({ status: "loading" });
  const [snapshot, setSnapshot] = useState<Map<string, ReferralView["research"]> | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [stage, setStage] = useState(0);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => { const off = subscribeResearch(rerender); return () => { off(); }; }, []);
  useEffect(() => { loadSnapshot().then(setSnapshot).catch(() => setSnapshot(new Map())); }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setHydrated(false);
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 800);
    searchNearby(specialty, location, radius)
      .then((data) => { if (!cancelled) { setState({ status: "done", data }); onSearched(data.results.length); } })
      .catch((err: Error) => !cancelled && setState({ status: "error", error: err.message }))
      .finally(() => clearInterval(t));
    return () => { cancelled = true; clearInterval(t); };
    // onSearched is a parent callback; re-running the search on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialty, location, radius]);

  const data = state.data;
  const ctx: SearchContext | null = useMemo(() => (data ? { lat: data.origin.coords.lat, lon: data.origin.coords.lon, radius: data.radiusMi, specialty, originLabel: data.origin.label } : null), [data, specialty]);

  useEffect(() => {
    if (!data || !ctx || !snapshot) return;
    const withResearch = data.results.filter((r) => snapshot.has(r.npi) || loadResearch(r.npi));
    Promise.all(withResearch.map((r) => hydrateCached(r.npi, ctx, snapshot.get(r.npi) ?? null))).finally(() => setHydrated(true));
  }, [data, ctx, snapshot]);

  if (state.status === "loading" || (data && !hydrated)) {
    return (
      <div className="rd-card rd-searching">
        <div className="rd-searching-title"><span className="pi-spinner" /> Finding {specialty.split(" / ")[0]} specialists within {radius} miles of {location}…</div>
        <ol className="rd-stages">
          {STAGES.map((s, i) => {
            const at = data ? STAGES.length - 1 : stage;
            return <li key={s} className={i < at ? "rd-done" : i === at ? "rd-now" : ""}>{i < at ? <Icon name="check" size={13} /> : <span className="rd-stage-dot" />} {s}</li>;
          })}
        </ol>
        <div className="rd-live-tag"><span className="rd-live-dot" /> Live public data — not simulated</div>
      </div>
    );
  }
  if (state.status === "error" || !data || !ctx) {
    return <div className="rd-card rd-error"><Icon name="alert" /> The live provider search couldn't run: {state.error ?? "unknown error"}. Try again in a moment.</div>;
  }

  const flaggedSet = new Set(flagged);
  const researched: Candidate[] = [];
  const registryOnly: NearbyResult[] = [];
  for (const r of data.results) {
    const rs = getResearch(r.npi, ctx);
    if (rs.view?.research) researched.push(candidate(r, rs.view, age, flaggedSet));
    else registryOnly.push(r);
  }
  researched.sort((a, b) => Number(a.demoted) - Number(b.demoted) || (b.best?.referral.score ?? 0) - (a.best?.referral.score ?? 0) || (a.best?.distanceMi ?? 99) - (b.best?.distanceMi ?? 99));
  const label = data.specialty.label;

  return (
    <div className="rd-specialists">
      <div className="rd-found">
        <div>
          <div className="rd-found-count">{data.results.length} {label} destinations within {data.radiusMi} miles</div>
          <div className="rd-found-sub">From {data.origin.label} · {data.scanned.records} NPI Registry records scanned · {researched.length} with web-research evidence</div>
        </div>
        <div className="rd-radius" role="group" aria-label="Radius">
          {RADII.map((r) => <button key={r} className={r === radius ? "rd-on" : ""} onClick={() => onRadius(r)}>{r} mi</button>)}
        </div>
      </div>

      {researched.length > 0 ? (
        <>
          <h3 className="rd-h3">Researched destinations <span className="rd-live-tag"><span className="rd-live-dot" /> Real providers · real public evidence</span></h3>
          <div className="rd-cands">
            {researched.map((c, i) => <CandidateCard key={c.r.npi} c={c} top={i === 0 && !c.demoted} onChoose={onChoose} />)}
          </div>
        </>
      ) : (
        <div className="rd-card rd-note"><Icon name="info" /> None of these providers has web research yet. Research one below (needs the demo key), or try ENT near Seattle, WA 98115.</div>
      )}

      <RegistryOnly list={registryOnly} ctx={ctx} label={label} />
    </div>
  );
}

// ── One researched destination ──────────────────────────────────────────────

interface Candidate {
  r: NearbyResult;
  view: ReferralView;
  best: PracticeLocation | null;
  alternates: PracticeLocation[];
  checks: Check[];
  demoted: boolean;
}

function candidate(r: NearbyResult, view: ReferralView, age: number | null, flagged: Set<string>): Candidate {
  const research = view.research!;
  const usable = view.locations.filter((l) => l.status !== "former");
  const inRadius = usable.filter((l) => l.inRadius).sort((a, b) => b.referral.score - a.referral.score);
  const best = inRadius[0] ?? usable[0] ?? null;
  const checks: Check[] = best ? destinationChecks({
    active: r.status === "Active", loc: best, license: view.license, researched: true,
    specialtyCorroborated: Boolean(research.specialty.value), specialtyDifferent: research.specialty.status === "different", isOrg: r.enumerationType === "Organization",
  }).filter((c) => c.label !== "Active NPI") : [];
  if (best) {
    checks.push(best.acceptingNewPatients ? { state: best.acceptingNewPatients.accepting ? "ok" : "bad", label: best.acceptingNewPatients.accepting ? "Accepting new patients" : "Not accepting new patients" } : { state: "unknown", label: "Accepting new patients unknown" });
    const fitText = [research.specialty.value, r.specialty, best.organization, best.name].join(" ");
    if (pediatricMismatch(fitText, age)) checks.unshift({ state: "bad", label: `Pediatric practice — this patient is ${age}` });
    if (best.bestFax && flagged.has(`${r.npi}|${best.bestFax.digits}`)) checks.unshift({ state: "bad", label: "Fake fax failed in this demo session" });
  }
  const demoted = !best?.bestFax || checks.some((c) => c.state === "bad");
  return { r, view, best, alternates: inRadius.slice(1).filter((l) => l.bestFax), checks, demoted };
}

function CandidateCard({ c, top, onChoose }: { c: Candidate; top: boolean; onChoose: (d: Destination) => void }) {
  const [why, setWhy] = useState(false);
  const { r, view, best } = c;
  const research = view.research!;
  const spec = view.fields.specialty.value ?? r.specialty;
  const choose = (loc: PracticeLocation) => loc.bestFax && onChoose(toDestination({ npi: r.npi, name: view.provider.name, credential: view.provider.credential, specialty: spec, loc, fax: loc.bestFax, providerScore: view.providerScore.score, researchedAt: research.researchedAt, sources: research.sources }));
  if (!best) return null;
  const org = best.organization && best.organization !== best.name && !best.name.startsWith(best.organization) ? best.organization : null;

  return (
    <article className={`rd-cand ${top ? "rd-cand-top" : ""} ${c.demoted ? "rd-cand-dim" : ""}`}>
      {top && <div className="rd-cand-flag">Best match for this referral</div>}
      <div className="rd-cand-main">
        <div className="rd-cand-who">
          <div className="pi-avatar">{initials(view.provider.name)}</div>
          <div>
            <div className="rd-cand-name">{view.provider.name}{view.provider.credential && <span className="pi-cred">{view.provider.credential}</span>}</div>
            <div className="rd-cand-spec">{spec}</div>
          </div>
        </div>
        <div className="rd-cand-where">
          <div className="rd-cand-org">{org ?? best.name}</div>
          {org && <div className="rd-cand-site">{best.name}</div>}
          <div className="pi-muted">{[best.line1, best.city].filter(Boolean).join(", ")}</div>
        </div>
        <div className="rd-cand-dist">{best.distanceMi ?? "—"}<span> mi</span></div>
      </div>

      <div className="rd-cand-mid">
        <div className="rd-cand-scores">
          <ScorePill label="Provider confidence" score={view.providerScore.score} />
          <ScorePill label="Referral confidence" score={best.referral.score} onClick={() => setWhy(!why)} active={why} />
        </div>
        <div className="rd-cand-contact">
          <div className="rd-phone"><Icon name="phone" size={13} /> {best.phones[0]?.number ?? "—"}</div>
          <FaxBlock fax={best.bestFax} compact />
        </div>
      </div>

      <Checks checks={c.checks} />

      {why && (
        <div className="rd-why">
          <div className="rd-why-cols">
            <Breakdown score={best.referral} title={`Referral confidence for this location — ${best.referral.score}%`} />
            <Breakdown score={view.providerScore} title={`Provider confidence — ${view.providerScore.score}%`} />
          </div>
          <div className="rd-why-src">
            <div><strong>Location evidence:</strong> <SourceChips ids={best.sourceIds} sources={research.sources} /></div>
            {best.bestFax && <div><strong>Fax evidence:</strong> {best.bestFax.label ? <>source label “{best.bestFax.label}” </> : null}<SourceChips ids={best.bestFax.sourceIds} sources={research.sources} /></div>}
            <div className="pi-muted">Web research run {formatDate(research.researchedAt)} · re-scored now for this search · <a href={`/npi-list?npi=${r.npi}`} target="_blank" rel="noreferrer">Full evidence ↗</a></div>
          </div>
        </div>
      )}

      <div className="rd-cand-actions">
        <button className="pi-link" onClick={() => setWhy(!why)}>{why ? "Hide evidence" : "Why trust this destination?"}</button>
        {c.alternates.length > 0 && (
          <details className="rd-alts">
            <summary>{c.alternates.length} other location{c.alternates.length > 1 ? "s" : ""} in range</summary>
            {c.alternates.map((l) => (
              <div key={l.id} className="rd-alt">
                <span>{l.name} · {l.distanceMi} mi · {l.referral.score}%</span>
                <button className="pi-btn" onClick={() => choose(l)}>Use this location</button>
              </div>
            ))}
          </details>
        )}
        {best.bestFax ? (
          <button className={`pi-btn ${c.demoted ? "" : "pi-btn-primary"} rd-choose`} onClick={() => choose(best)}>{c.demoted ? "Choose anyway" : "Choose this destination"} <Icon name="chevron" /></button>
        ) : (
          <span className="pi-muted rd-nofax">No fax found — can't fax this destination</span>
        )}
      </div>
    </article>
  );
}

// ── Everyone else in range: registry data only ──────────────────────────────

function RegistryOnly({ list, ctx, label }: { list: NearbyResult[]; ctx: SearchContext; label: string }) {
  const [shown, setShown] = useState(20);
  const [key, setKey] = useState(getDemoKey() ?? "");
  if (!list.length) return null;
  const locked = list.some((r) => getResearch(r.npi, ctx).code === "locked");
  return (
    <details className="rd-registry">
      <summary>{list.length} more {label} providers in range — NPI Registry data only, not yet researched</summary>
      <p className="pi-muted">Registry addresses and faxes are often stale, so these aren't offered as destinations until web research confirms a current location and fax. Research uses paid AI calls (about 1–2 minutes each) and needs the demo key.</p>
      {locked && (
        <form className="pi-keyform rd-key" onSubmit={(e) => { e.preventDefault(); setDemoKey(key); list.filter((r) => getResearch(r.npi, ctx).code === "locked").forEach((r) => startResearch(r.npi, ctx, false)); }}>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Demo access key" aria-label="Demo access key" />
          <button className="pi-btn pi-btn-primary" type="submit">Unlock &amp; research</button>
        </form>
      )}
      <div className="rd-reg-list">
        {list.slice(0, shown).map((r) => {
          const rs = getResearch(r.npi, ctx);
          return (
            <div key={r.npi} className="rd-reg">
              <span className="rd-reg-name">{r.name}{r.credential && <span className="pi-cred">{r.credential}</span>}</span>
              <span className="pi-muted">{r.nearest.distanceMi} mi · {r.nearest.organization ?? r.nearest.city}</span>
              <span className="pi-muted pi-mono">{r.nearest.bestFax ? `NPI fax ${r.nearest.bestFax.number}` : "no NPI fax"}</span>
              {isRunning(rs) ? <span className="rd-reg-status"><span className="pi-spinner" /> Researching…</span>
                : rs.stage === "error" ? <span className="rd-reg-status pi-bad">{rs.code === "locked" ? "Needs demo key" : "Research failed"}</span>
                : <button className="pi-btn" onClick={() => startResearch(r.npi, ctx, false)}><Icon name="sparkle" /> Research</button>}
            </div>
          );
        })}
      </div>
      {list.length > shown && <button className="pi-btn pi-more" onClick={() => setShown(shown + 40)}>Show more</button>}
    </details>
  );
}
