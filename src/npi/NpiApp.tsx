// ── Referral destination finder — search + results (TEMPORARY NPI demo) ───────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { captureKeyFromHash, searchNearby, searchProviders, type SearchContext } from "./api";
import type { NearbyResponse, NearbyResult, ProviderSummary, SearchResponse } from "./types";
import ReferralDetail from "./ReferralDetail";
import { hydrateCached, isRunning, startResearch, useResearch } from "./research";
import { Checks, FaxBlock, Icon, ScorePill, destinationChecks, initials } from "./ui";
import { TERMS } from "./semantics";

const SPECIALTIES = ["ENT / Otolaryngology", "Otology & Neurotology", "Pediatric Otolaryngology", "Audiologist", "Hearing Instrument Specialist", "Speech-Language Pathologist", "Neurology", "Allergy & Immunology"];
const RADII = [5, 10, 25, 50];
const PAGE = 25;

interface Route {
  specialty: string;
  location: string;
  radius: number;
  q: string;
  npi: string | null;
  lat: number | null;
  lon: number | null;
  originLabel: string;
}

const EMPTY: Route = { specialty: "", location: "", radius: 10, q: "", npi: null, lat: null, lon: null, originLabel: "" };

function readRoute(): Route {
  const p = new URLSearchParams(location.search);
  const num = (k: string) => (p.has(k) && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : null);
  return {
    specialty: p.get("specialty") ?? "",
    location: p.get("location") ?? "",
    radius: num("radius") ?? 10,
    q: p.get("q") ?? "",
    npi: p.get("npi"),
    lat: num("lat"),
    lon: num("lon"),
    originLabel: p.get("origin") ?? "",
  };
}

function pushRoute(r: Route) {
  const p = new URLSearchParams();
  if (r.specialty) { p.set("specialty", r.specialty); p.set("location", r.location); p.set("radius", String(r.radius)); }
  if (r.q) p.set("q", r.q);
  if (r.npi) p.set("npi", r.npi);
  if (r.npi && r.lat !== null && r.lon !== null) { p.set("lat", String(r.lat)); p.set("lon", String(r.lon)); p.set("origin", r.originLabel); }
  const qs = p.toString();
  history.pushState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}`);
}

export default function NpiApp() {
  const [route, setRoute] = useState<Route>(readRoute);

  const navigate = useCallback((r: Route) => {
    pushRoute(r);
    setRoute(r);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    captureKeyFromHash();
    const onPop = () => setRoute(readRoute());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const home = !route.specialty && !route.q && !route.npi;
  const ctx: SearchContext | null = useMemo(() => (route.specialty && route.lat !== null && route.lon !== null
    ? { lat: route.lat, lon: route.lon, radius: route.radius, specialty: route.specialty, originLabel: route.originLabel }
    : null), [route.specialty, route.lat, route.lon, route.radius, route.originLabel]);

  const find = (specialty: string, loc: string, radius: number) => navigate({ ...EMPTY, specialty, location: loc, radius });

  return (
    <div className="pi">
      <header className="pi-top">
        <button className="pi-brand" onClick={() => navigate(EMPTY)}>
          <span className="pi-logo"><Icon name="send" /></span>
          <span>Referral Finder</span>
        </button>
        {!home && <FindForm compact initial={route} onFind={find} />}
        <a className="pi-top-demo" href="/npi-list/referral-demo" title="Separate demo with synthetic patients">Demo: referral workflow →</a>
        <span className="pi-top-meta">Demo</span>
      </header>

      {home && <Home onFind={find} onLookup={(q) => navigate({ ...EMPTY, q })} />}

      {route.npi && (
        <ReferralDetail
          key={route.npi + (ctx ? ctx.lat : "")}
          npi={route.npi}
          ctx={ctx}
          onBack={route.specialty || route.q ? () => navigate({ ...route, npi: null, lat: null, lon: null, originLabel: "" }) : null}
        />
      )}

      {!route.npi && route.specialty && (
        <NearbyResults
          specialty={route.specialty}
          loc={route.location}
          radius={route.radius}
          onOpen={(r, origin) => navigate({ ...route, npi: r.npi, lat: origin.coords.lat, lon: origin.coords.lon, originLabel: origin.label })}
        />
      )}

      {!route.npi && !route.specialty && route.q && <NameResults q={route.q} onOpen={(p) => navigate({ ...route, npi: p.npi })} />}

      <footer className="pi-foot">
        Demonstration only — no patient data is used or stored. Provider data: CMS NPPES (federal NPI Registry, via Anthropic's NPI Registry connector and the CMS API); licences: Washington State DOH open data; distances: US Census Geocoder and ZIP centroids; contact evidence: open-web research. Provider verification and destination confidence are transparent heuristics, not calibrated probabilities, and neither rates a clinician's quality.
      </footer>
    </div>
  );
}

// ── Search form ────────────────────────────────────────────────────────────────

function FindForm({ initial, compact = false, onFind }: { initial?: Partial<Route>; compact?: boolean; onFind: (s: string, l: string, r: number) => void }) {
  const [specialty, setSpecialty] = useState(initial?.specialty || "ENT / Otolaryngology");
  const [loc, setLoc] = useState(initial?.location || "");
  const [radius, setRadius] = useState(initial?.radius || 10);
  useEffect(() => {
    if (initial?.specialty) setSpecialty(initial.specialty);
    if (initial?.location) setLoc(initial.location);
    if (initial?.radius) setRadius(initial.radius);
  }, [initial?.specialty, initial?.location, initial?.radius]);

  return (
    <form
      className={`pi-find ${compact ? "pi-find-compact" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (specialty.trim() && loc.trim()) onFind(specialty.trim(), loc.trim(), radius);
      }}
    >
      <label className="pi-field pi-field-spec">
        {!compact && <span>Specialty</span>}
        <input list="pi-specialties" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="e.g. ENT" aria-label="Specialty" />
        <datalist id="pi-specialties">{SPECIALTIES.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="pi-field pi-field-loc">
        {!compact && <span>Location</span>}
        <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="ZIP, City ST, or street address" aria-label="Location" autoFocus={!compact} />
      </label>
      <label className="pi-field pi-field-radius">
        {!compact && <span>Radius</span>}
        <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Radius">
          {RADII.map((r) => <option key={r} value={r}>{r} mi</option>)}
        </select>
      </label>
      <button type="submit" className="pi-btn pi-btn-primary">{compact ? <Icon name="search" /> : "Find referral destinations"}</button>
    </form>
  );
}

function Home({ onFind, onLookup }: { onFind: (s: string, l: string, r: number) => void; onLookup: (q: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <main className="pi-home">
      <div className="pi-eyebrow"><span className="pi-dot" /> Outbound referrals · audiology</div>
      <h1>Find a specialist</h1>
      <p className="pi-sub">Real nearby specialists, the location to send to, and the best-supported phone and fax — with the evidence behind every number.</p>
      <FindForm onFind={onFind} />
      <div className="pi-examples">
        <span>Try</span>
        <button className="pi-chip" onClick={() => onFind("ENT / Otolaryngology", "Seattle, WA 98115", 10)}>ENT near Seattle 98115 · 10 mi</button>
        <button className="pi-chip" onClick={() => onFind("Audiologist", "Boston, MA 02215", 5)}>Audiologist near Boston 02215 · 5 mi</button>
        <button className="pi-chip" onClick={() => onFind("Otology & Neurotology", "98195", 25)}>Otology near 98195 · 25 mi</button>
      </div>
      <div className="pi-flow">
        <div><span>1</span> Find a specialist</div>
        <Icon name="chevron" />
        <div><span>2</span> Choose a location</div>
        <Icon name="chevron" />
        <div><span>3</span> Send the referral</div>
      </div>
      <a className="pi-demo-link" href="/npi-list/referral-demo">
        <span className="pi-demo-tag">Demo · synthetic patients</span>
        Try the fake outbound referral workflow →
      </a>
      <form className="pi-lookup" onSubmit={(e) => { e.preventDefault(); if (q.trim()) onLookup(q.trim()); }}>
        <span>Already know the provider?</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or 10-digit NPI" aria-label="Provider name or NPI" />
        <button className="pi-btn" type="submit">Look up</button>
      </form>
    </main>
  );
}

// ── Nearby results ─────────────────────────────────────────────────────────────

function NearbyResults({ specialty, loc, radius, onOpen }: { specialty: string; loc: string; radius: number; onOpen: (r: NearbyResult, origin: NearbyResponse["origin"]) => void }) {
  const [state, setState] = useState<{ status: "loading" | "done" | "error"; data?: NearbyResponse; error?: string }>({ status: "loading" });
  const [kind, setKind] = useState<"all" | "Individual" | "Organization">("all");
  const [shown, setShown] = useState(PAGE);
  const key = `${specialty}|${loc}|${radius}`;
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    let cancelled = false;
    setState({ status: "loading" });
    setShown(PAGE);
    searchNearby(specialty, loc, radius)
      .then((data) => !cancelled && setState({ status: "done", data }))
      .catch((err: Error) => !cancelled && setState({ status: "error", error: err.message }));
    return () => { cancelled = true; last.current = null; };
  }, [key, specialty, loc, radius]);

  const data = state.data;
  const ctx: SearchContext | null = useMemo(() => (data ? { lat: data.origin.coords.lat, lon: data.origin.coords.lon, radius: data.radiusMi, specialty, originLabel: data.origin.label } : null), [data, specialty]);
  const list = useMemo(() => (data?.results ?? []).filter((r) => kind === "all" || r.enumerationType === kind), [data, kind]);

  useEffect(() => {
    if (!ctx) return;
    list.slice(0, shown).forEach((r) => hydrateCached(r.npi, ctx));
  }, [ctx, list, shown]);

  if (state.status === "loading") {
    return (
      <main className="pi-main">
        <div className="pi-loading"><span className="pi-spinner" /> Finding {specialty} providers near {loc}: NPI Registry → geocoding every practice address → distances → Washington licence check…</div>
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="pi-dest pi-skel" style={{ height: 150 }} />)}
      </main>
    );
  }
  if (state.status === "error" || !data || !ctx) return <main className="pi-main"><Empty icon="alert" title="Search couldn't run" body={state.error ?? "Something went wrong."} /></main>;

  const individuals = data.results.filter((r) => r.enumerationType === "Individual").length;
  return (
    <main className="pi-main">
      <div className="pi-results-head">
        <div>
          <div className="pi-count">{data.results.length} {data.specialty.label} referral destination{data.results.length === 1 ? "" : "s"} within {data.radiusMi} mi</div>
          <div className="pi-interp">
            <span className="pi-tag"><em>From</em> {data.origin.label}</span>
            <span className="pi-tag" title={`${data.origin.coords.lat.toFixed(4)}, ${data.origin.coords.lon.toFixed(4)}`}><em>Origin</em> {data.origin.method}</span>
            <span className="pi-tag" title={data.specialty.codes.join(", ")}><em>Taxonomy</em> {data.specialty.codes.join(" · ")}</span>
            <span className="pi-tag"><em>Scanned</em> {data.scanned.records} NPPES records · {data.scanned.addresses} addresses ({data.scanned.geocodedExact} rooftop, {data.scanned.geocodedZip} ZIP centroid)</span>
          </div>
        </div>
        <ResearchTop list={list.slice(0, 5)} ctx={ctx} />
      </div>
      {data.notes.map((n) => <div key={n} className="pi-note"><Icon name="info" /> {n}</div>)}
      <div className="pi-filter">
        <Icon name="filter" />
        {(["all", "Individual", "Organization"] as const).map((k) => (
          <button key={k} className={`pi-chip ${kind === k ? "pi-chip-on" : ""}`} onClick={() => { setKind(k); setShown(PAGE); }}>
            {k === "all" ? `All (${data.results.length})` : k === "Individual" ? `Clinicians (${individuals})` : `Organizations (${data.results.length - individuals})`}
          </button>
        ))}
        <span className="pi-muted">Sorted by distance · baseline scores use registry + licence data until a provider is researched</span>
      </div>
      {list.length === 0 ? (
        <Empty icon="search" title="No providers in range" body="Try a larger radius, or check the specialty." />
      ) : (
        <div className="pi-dest-list">
          {list.slice(0, shown).map((r) => <DestinationRow key={r.npi} r={r} ctx={ctx} onOpen={() => onOpen(r, data.origin)} />)}
        </div>
      )}
      {list.length > shown && <button className="pi-btn pi-more" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more of {list.length - shown}</button>}
    </main>
  );
}

function ResearchTop({ list, ctx }: { list: NearbyResult[]; ctx: SearchContext }) {
  return (
    <button className="pi-btn pi-btn-primary" onClick={() => list.forEach((r) => startResearch(r.npi, ctx, false))} title="Runs web research (paid AI calls) for the 5 nearest shown">
      <Icon name="sparkle" /> Research nearest {list.length}
    </button>
  );
}

function DestinationRow({ r, ctx, onOpen }: { r: NearbyResult; ctx: SearchContext; onOpen: () => void }) {
  const rs = useResearch(r.npi, ctx);
  const running = isRunning(rs);
  const view = rs.view;
  // After research, show the best supported in-radius destination (it may differ from the NPI address).
  const usable = view?.locations.filter((l) => l.status !== "former") ?? [];
  const best = view ? usable.find((l) => l.inRadius) ?? usable[0] ?? r.nearest : r.nearest;
  const provider = view?.providerScore ?? r.provider;
  const checks = destinationChecks({
    active: r.status === "Active", loc: best, license: view?.license ?? r.license, researched: Boolean(view?.research),
    specialtyCorroborated: Boolean(view?.research?.specialty.value), specialtyDifferent: view?.research?.specialty.status === "different",
    npiSpecialty: r.specialty, currentSpecialty: view?.research?.specialty.value, isOrg: r.enumerationType === "Organization",
  });
  const supported = view?.research ? view.locations.filter((l) => l.status !== "former" && l.origin !== "npi").length : 0;

  return (
    <article className="pi-dest">
      <div className="pi-dest-who">
        <div className={`pi-avatar ${r.enumerationType === "Organization" ? "pi-avatar-org" : ""}`}>{r.enumerationType === "Organization" ? <Icon name="building" /> : initials(r.name)}</div>
        <div>
          <div className="pi-row-title">{r.name}{r.credential && <span className="pi-cred">{r.credential}</span>}</div>
          <div className="pi-row-sub">{r.specialty}{!r.specialtyIsPrimary && <span className="pi-muted"> · secondary taxonomy</span>}</div>
        </div>
      </div>

      <div className="pi-dest-where">
        <div className="pi-dest-dist">{best.distanceMi !== null ? `${best.distanceMi} mi` : "—"}{best.geoPrecision === "zip" && <span title="Geocoded to ZIP centroid"> ≈</span>}</div>
        <div>
          <div className="pi-dest-loc">{best.organization ?? best.name}</div>
          <div className="pi-muted">{[best.line1, best.line2, best.city].filter(Boolean).join(", ")}</div>
          {!view && r.sharedAddressOrgs.length > 0 && <div className="pi-dest-org">NPPES org at this address: {r.sharedAddressOrgs.join(", ")}</div>}
          {view?.research && <div className="pi-dest-org">{supported ? `${supported} researched location${supported > 1 ? "s" : ""}` : "No location confirmed by research"}{best.inRadius === false && " · best location is outside the radius"}</div>}
          {!view && r.otherLocationCount > 0 && <div className="pi-dest-org">+{r.otherLocationCount} other NPI location{r.otherLocationCount > 1 ? "s" : ""}</div>}
        </div>
      </div>

      <div className="pi-dest-scores">
        <ScorePill label={TERMS.verification.label} score={provider.score} />
        <ScorePill label={TERMS.destination.label} score={best.referral.score} />
      </div>

      <Checks checks={checks} />

      <div className="pi-dest-contact">
        <div className="pi-dest-phone"><Icon name="phone" size={13} /> {best.phones[0]?.number ?? "—"}</div>
        <FaxBlock fax={best.bestFax} compact />
      </div>

      <div className="pi-dest-actions">
        <button className="pi-btn pi-btn-primary" onClick={onOpen}>View referral details <Icon name="chevron" /></button>
        {running ? (
          <span className="pi-dest-status"><span className="pi-spinner" /> {rs.stage === "research" ? (rs.found.length ? `Reading ${rs.found.length} sources…` : "Searching the web…") : rs.stage === "extract" ? "Separating locations…" : "Scoring…"}</span>
        ) : view?.research ? (
          <span className="pi-dest-status pi-good"><Icon name="check" size={13} /> Researched{view.research.cached ? " (cached)" : ""}</span>
        ) : rs.stage === "error" ? (
          <span className="pi-dest-status pi-bad" title={rs.error ?? ""}><Icon name="alert" size={13} /> {rs.code === "locked" ? "Needs demo key — open details" : "Research failed"}</span>
        ) : (
          <button className="pi-btn" onClick={() => startResearch(r.npi, ctx, false)}><Icon name="sparkle" /> Research</button>
        )}
      </div>
    </article>
  );
}

// ── Name / NPI lookup (secondary) ─────────────────────────────────────────────

function NameResults({ q, onOpen }: { q: string; onOpen: (p: ProviderSummary) => void }) {
  const [state, setState] = useState<{ status: "loading" | "done" | "error"; data?: SearchResponse; error?: string }>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    searchProviders(q).then((data) => !cancelled && setState({ status: "done", data })).catch((e: Error) => !cancelled && setState({ status: "error", error: e.message }));
    return () => { cancelled = true; };
  }, [q]);
  if (state.status === "loading") return <main className="pi-main"><div className="pi-loading"><span className="pi-spinner" /> Searching the NPI Registry…</div></main>;
  if (state.status === "error" || !state.data) return <main className="pi-main"><Empty icon="alert" title="Search unavailable" body={state.error ?? ""} /></main>;
  const data = state.data;
  return (
    <main className="pi-main">
      <div className="pi-results-head">
        <div>
          <div className="pi-count">{data.results.length ? `${data.results.length} provider${data.results.length === 1 ? "" : "s"} matching “${q}”` : "No providers found"}</div>
          {data.interpretation.length > 0 && <div className="pi-interp"><span>Interpreted as</span>{data.interpretation.map((i) => <span key={i.label + i.value} className="pi-tag"><em>{i.label}</em> {i.value}</span>)}</div>}
        </div>
        <span className="pi-source-label"><Icon name="registry" /> {data.source}</span>
      </div>
      {data.note && <div className="pi-note"><Icon name="info" /> {data.note}</div>}
      {data.results.length === 0 ? <Empty icon="search" title="No matching providers" body="The NPI Registry matches names exactly. Try a last name only, or add a state." /> : (
        <div className="pi-results">
          {data.results.map((p) => (
            <button key={p.npi} className="pi-row" onClick={() => onOpen(p)}>
              <div className={`pi-avatar ${p.enumerationType === "Organization" ? "pi-avatar-org" : ""}`}>{p.enumerationType === "Organization" ? <Icon name="building" /> : initials(p.name)}</div>
              <div className="pi-row-main">
                <div className="pi-row-title">{p.name}{p.credential && <span className="pi-cred">{p.credential}</span>}</div>
                <div className="pi-row-sub">{p.specialty ?? "No taxonomy listed"}</div>
              </div>
              <div className="pi-row-meta"><div><Icon name="pin" /> {[p.city, p.state].filter(Boolean).join(", ") || "—"}</div><div><Icon name="phone" /> {p.phone ?? "—"}</div></div>
              <div className="pi-row-npi"><div className="pi-mono">{p.npi}</div></div>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

export function Empty({ icon, title, body, action }: { icon: string; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="pi-empty">
      <div className="pi-empty-icon"><Icon name={icon} /></div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
