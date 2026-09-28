// ── Step: find a specialist — REAL provider search, reused from /npi-list ────
// The patient is fake; this step is not. The audiologist's referral type drives
// a deterministic NPI Registry search (taxonomy + state + radius); saved or fresh
// web research then adds evidence, and ./routing.ts sorts destinations into
// Recommended vs Needs review with plain rules. The human chooses.
import { useEffect, useMemo, useReducer, useState } from "react";
import { getDemoKey, loadResearch, searchNearby, setDemoKey, type SearchContext } from "../api";
import { getResearch, hydrateCached, isRunning, startResearch, subscribeResearch } from "../research";
import type { NearbyResponse, NearbyResult, PracticeLocation, ReferralView } from "../types";
import { Breakdown, Checks, ConflictCard, FaxBlock, Icon, ScorePill, SourceChips, destinationChecks, formatDate, initials, type Check } from "../ui";
import { TERMS } from "../semantics";
import { loadSnapshot } from "./snapshot";
import { toDestination, type Destination } from "./model";
import { assessDestination, groupDestinations, resultsMatchIntent, savedResearchFor, snapshotAppliesTo, type Assessment } from "./routing";
const RADII = [5, 10, 25, 50];
const STAGES = ["Querying the federal NPI Registry for the requested taxonomy", "Geocoding every practice address", "Measuring distance from the patient's area", "Checking Washington licences", "Loading web-research evidence"];

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
      .then((data) => {
        if (cancelled) return;
        // Never show results for a different referral type than the one requested.
        if (!resultsMatchIntent(specialty, data)) { setState({ status: "error", error: `the search returned ${data.specialty.label} providers, but the audiologist requested ${specialty}. Those results are not shown` }); return; }
        setState({ status: "done", data }); onSearched(data.results.length);
      })
      .catch((err: Error) => !cancelled && setState({ status: "error", error: err.message }))
      .finally(() => clearInterval(t));
    return () => { cancelled = true; clearInterval(t); };
    // onSearched is a parent callback; re-running the search on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialty, location, radius]);

  const data = state.data;
  const ctx: SearchContext | null = useMemo(() => (data ? { lat: data.origin.coords.lat, lon: data.origin.coords.lon, radius: data.radiusMi, specialty, originLabel: data.origin.label } : null), [data, specialty]);
  const useSnapshot = data ? snapshotAppliesTo(data.specialty.key) : false;

  useEffect(() => {
    if (!data || !ctx || !snapshot) return;
    // The saved research is an ENT cohort: it is only consulted for ENT-family searches.
    const saved = (npi: string) => savedResearchFor(data.specialty.key, snapshot, npi);
    const withResearch = data.results.filter((r) => saved(r.npi) || loadResearch(r.npi));
    Promise.all(withResearch.map((r) => hydrateCached(r.npi, ctx, saved(r.npi)))).finally(() => setHydrated(true));
  }, [data, ctx, snapshot]);

  if (state.status === "loading" || (data && !hydrated)) {
    return (
      <div className="rd-card rd-searching">
        <div className="rd-searching-title"><span className="pi-spinner" /> Finding {specialty.split(" / ")[0]} providers within {radius} miles of {location}…</div>
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
    const c = rs.view?.research ? candidate(r, rs.view, specialty, age, flaggedSet) : null;
    if (c) researched.push(c);
    else registryOnly.push(r);
  }
  const { recommended, review } = groupDestinations(researched);
  const label = data.specialty.label;

  return (
    <div className="rd-specialists">
      <div className="rd-found">
        <div>
          <div className="rd-found-count">{data.results.length} {label} providers in the NPI Registry within {data.radiusMi} miles</div>
          <div className="rd-found-sub">From {data.origin.label} · taxonomy {data.specialty.codes.join(" · ")} · {data.scanned.records} registry records scanned · {researched.length} with web-research evidence</div>
        </div>
        <div className="rd-radius" role="group" aria-label="Radius">
          {RADII.map((r) => <button key={r} className={r === radius ? "rd-on" : ""} onClick={() => onRadius(r)}>{r} mi</button>)}
        </div>
      </div>

      {researched.length > 0 ? (
        <>
          <h3 className="rd-h3 rd-h3-good"><Icon name="check" size={15} /> Recommended destinations <span className="rd-h3-n">{recommended.length}</span> <span className="rd-live-tag"><span className="rd-live-dot" /> Real providers · real public evidence</span></h3>
          <p className="rd-group-note">Match the requested referral type, no serious conflict in the evidence, a usable fax, and no known fit blocker for this synthetic patient.</p>
          {recommended.length ? (
            <div className="rd-cands">{recommended.map((c, i) => <CandidateCard key={c.r.npi} c={c} top={i === 0} onChoose={onChoose} />)}</div>
          ) : <div className="rd-card rd-note"><Icon name="info" /> No researched destination clears every check. See Needs review below.</div>}
          {review.length > 0 && (
            <>
              <h3 className="rd-h3 rd-h3-review"><Icon name="alert" size={15} /> Needs review <span className="rd-h3-n">{review.length}</span></h3>
              <p className="rd-group-note">Kept visible on purpose: each one has a specific reason a coordinator should look before sending. High destination confidence alone does not make a destination right for this referral.</p>
              <div className="rd-cands">{review.map((c) => <CandidateCard key={c.r.npi} c={c} top={false} onChoose={onChoose} />)}</div>
            </>
          )}
        </>
      ) : (
        <div className="rd-card rd-note">
          <Icon name="info" />
          <div>
            <strong>No web research exists yet for these {label} providers.</strong> Below are registry matches only — the NPI taxonomy matches {label} and a practice address is within {data.radiusMi} miles — but no current location or fax has been verified.
            {!useSnapshot && <> The saved Seattle research covers ENT only and is never substituted for other referral types.</>} Research a provider to establish a destination (paid AI call, needs the demo key).
          </div>
        </div>
      )}

      <RegistryOnly list={registryOnly} ctx={ctx} label={label} open={researched.length === 0} />
    </div>
  );
}

// ── One researched destination ──────────────────────────────────────────────

interface Candidate {
  r: NearbyResult;
  view: ReferralView;
  best: PracticeLocation;
  alternates: PracticeLocation[];
  checks: Check[];
  assessment: Assessment;
  distanceMi: number | null;
}

function candidate(r: NearbyResult, view: ReferralView, requested: string, age: number | null, flagged: Set<string>): Candidate | null {
  const research = view.research!;
  const usable = view.locations.filter((l) => l.status !== "former");
  const inRadius = usable.filter((l) => l.inRadius).sort((a, b) => b.referral.score - a.referral.score);
  const assess = (loc: PracticeLocation) => assessDestination({
    requested: requested.split(" / ")[0], npiSpecialty: r.specialty, taxonomyCode: r.specialtyCode, npiActive: r.status === "Active", licence: view.license,
    researchSpecialty: { status: research.specialty.status, value: research.specialty.value }, identityConflict: research.identity.conflict,
    location: loc, providerScore: view.providerScore.score, destinationScore: loc.referral.score, patientAge: age,
    faxFailedThisSession: Boolean(loc.bestFax && flagged.has(`${r.npi}|${loc.bestFax.digits}`)),
  });
  // Lead with the strongest in-range location that clears every check (e.g. an
  // adult clinic rather than the same provider's children's-hospital site).
  const ranked = (inRadius.length ? inRadius : usable).map((loc) => ({ loc, a: assess(loc) }));
  const pick = ranked.find((x) => x.a.group === "recommended") ?? ranked[0];
  if (!pick) return null;
  const best = pick.loc;
  const assessment = pick.a;
  // The specialty conflict gets its own box, so it is left out of the tick list.
  const checks: Check[] = destinationChecks({
    active: r.status === "Active", loc: best, license: view.license, researched: true,
    specialtyCorroborated: Boolean(research.specialty.value), specialtyDifferent: false, isOrg: r.enumerationType === "Organization",
  }).filter((c) => c.label !== "Active NPI" && !(assessment.verification.conflict && /^Specialty/.test(c.label)));
  checks.push(best.acceptingNewPatients ? { state: best.acceptingNewPatients.accepting ? "ok" : "bad", label: best.acceptingNewPatients.accepting ? "Accepting new patients" : "Not accepting new patients" } : { state: "unknown", label: "Accepting new patients unknown" });
  return { r, view, best, alternates: inRadius.filter((l) => l !== best && l.bestFax), checks, assessment, distanceMi: best.distanceMi };
}

function CandidateCard({ c, top, onChoose }: { c: Candidate; top: boolean; onChoose: (d: Destination) => void }) {
  const [why, setWhy] = useState(false);
  const { r, view, best, assessment: a } = c;
  const research = view.research!;
  const review = a.group === "review";
  const spec = view.fields.specialty.value ?? r.specialty;
  const choose = (loc: PracticeLocation) => loc.bestFax && onChoose(toDestination({ npi: r.npi, name: view.provider.name, credential: view.provider.credential, specialty: spec, loc, fax: loc.bestFax, providerScore: view.providerScore.score, researchedAt: research.researchedAt, sources: research.sources, reviewReasons: a.reviewReasons }));
  const org = best.organization && best.organization !== best.name && !best.name.startsWith(best.organization) ? best.organization : null;

  return (
    <article className={`rd-cand ${top ? "rd-cand-top" : ""} ${review ? "rd-cand-review" : ""}`}>
      {top && <div className="rd-cand-flag">Strongest recommended destination</div>}
      {review && (
        <div className="rd-review-why">
          <div className="rd-review-title"><Icon name="alert" size={13} /> Needs review</div>
          <ul>{a.reviewReasons.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
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

      <div className="rd-qs">
        <div className="rd-q">
          <div className="rd-q-head"><span>{TERMS.verification.label}</span><ScorePill label="" score={a.verification.score} onClick={() => setWhy(!why)} active={why} /></div>
          <div className="rd-q-ask">{TERMS.verification.question}</div>
        </div>
        <div className="rd-q">
          <div className="rd-q-head"><span>{TERMS.destination.label}</span><ScorePill label="" score={a.destination.score} onClick={() => setWhy(!why)} active={why} /></div>
          <div className="rd-q-ask">{TERMS.destination.question}</div>
        </div>
        <div className={`rd-q rd-q-fit ${a.fit.ok ? "rd-q-fit-ok" : "rd-q-fit-bad"}`}>
          <div className="rd-q-head"><span>{TERMS.fit.label}</span><strong><Icon name={a.fit.ok ? "check" : "alert"} size={13} /> {a.fit.ok ? "Matches" : "Review"}</strong></div>
          <div className="rd-q-ask">{a.fit.summary}</div>
        </div>
      </div>

      {a.verification.conflict && <ConflictCard c={a.verification.conflict} />}

      <div className="rd-cand-contact">
        <div className="rd-phone"><Icon name="phone" size={13} /> {best.phones[0]?.number ?? "—"}</div>
        <FaxBlock fax={best.bestFax} compact />
      </div>

      <Checks checks={c.checks} />

      {why && (
        <div className="rd-why">
          <div className="rd-why-cols">
            <Breakdown score={best.referral} title={`${TERMS.destination.label} for this location — ${best.referral.score}%`} />
            <Breakdown score={view.providerScore} title={`${TERMS.verification.label} — ${view.providerScore.score}%`} />
          </div>
          <div className="rd-why-src">
            <div><strong>Fax:</strong> {a.destination.fax.detail}</div>
            <div><strong>Location evidence:</strong> <SourceChips ids={best.sourceIds} sources={research.sources} /></div>
            {best.bestFax && <div><strong>Fax evidence:</strong> {best.bestFax.label ? <>source label “{best.bestFax.label}” </> : null}<SourceChips ids={best.bestFax.sourceIds} sources={research.sources} /></div>}
            <div className="pi-muted">Neither score rates the clinician, and neither says the destination suits this patient — that is {TERMS.fit.label.toLowerCase()}, checked separately with plain rules.</div>
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
          <button className={`pi-btn ${review ? "" : "pi-btn-primary"} rd-choose`} onClick={() => choose(best)}>{review ? "Choose anyway" : "Choose this destination"} <Icon name="chevron" /></button>
        ) : (
          <span className="pi-muted rd-nofax">No fax found — can't fax this destination</span>
        )}
      </div>
    </article>
  );
}

// ── Everyone else in range: registry data only ──────────────────────────────

function RegistryOnly({ list, ctx, label, open }: { list: NearbyResult[]; ctx: SearchContext; label: string; open: boolean }) {
  const [shown, setShown] = useState(20);
  const [key, setKey] = useState(getDemoKey() ?? "");
  if (!list.length) return null;
  const locked = list.some((r) => getResearch(r.npi, ctx).code === "locked");
  return (
    <details className="rd-registry" open={open}>
      <summary>{list.length} {open ? "" : "more "}{label} registry matches in range — not yet researched</summary>
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
              <span className="rd-reg-name">{r.name}{r.credential && <span className="pi-cred">{r.credential}</span>}<span className="rd-reg-tag">Registry match — not yet researched</span></span>
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
