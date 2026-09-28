// ── Provider Intelligence — search + results (TEMPORARY NPI demo) ─────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { searchProviders } from "./api";
import type { ProviderSummary, SearchResponse } from "./types";
import ProviderView from "./ProviderView";
import { Icon, initials } from "./ui";

const EXAMPLES = ["audiologist Boston MA", "ENT Seattle WA", "1831725753", "Sarah Johnson California"];

interface Route {
  q: string;
  npi: string | null;
}

function readRoute(): Route {
  const p = new URLSearchParams(location.search);
  return { q: p.get("q") ?? "", npi: p.get("npi") };
}

function pushRoute(r: Route) {
  const p = new URLSearchParams();
  if (r.q) p.set("q", r.q);
  if (r.npi) p.set("npi", r.npi);
  const qs = p.toString();
  history.pushState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}`);
}

export default function NpiApp() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [search, setSearch] = useState<{ status: "idle" | "loading" | "done" | "error"; data?: SearchResponse; error?: string }>({ status: "idle" });
  const lastQuery = useRef<string | null>(null);

  const navigate = useCallback((r: Route) => {
    pushRoute(r);
    setRoute(r);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!route.q || route.q === lastQuery.current) return;
    lastQuery.current = route.q;
    let cancelled = false;
    setSearch({ status: "loading" });
    searchProviders(route.q)
      .then((data) => !cancelled && setSearch({ status: "done", data }))
      .catch((err: Error) => !cancelled && setSearch({ status: "error", error: err.message }));
    return () => {
      cancelled = true;
      lastQuery.current = null;
    };
  }, [route.q]);

  const runSearch = (q: string) => {
    const t = q.trim();
    if (!t) return;
    lastQuery.current = null;
    navigate({ q: t, npi: null });
  };

  const home = !route.q && !route.npi;

  return (
    <div className="pi">
      <header className="pi-top">
        <button className="pi-brand" onClick={() => navigate({ q: "", npi: null })}>
          <span className="pi-logo"><Icon name="check" /></span>
          <span>Provider Intelligence</span>
        </button>
        {!home && <SearchBox compact initial={route.q} onSearch={runSearch} />}
        <span className="pi-top-meta">Demo</span>
      </header>

      {home && <Home onSearch={runSearch} />}

      {!home && route.npi && (
        <ProviderView
          key={route.npi}
          npi={route.npi}
          onBack={route.q ? () => navigate({ q: route.q, npi: null }) : null}
        />
      )}

      {!home && !route.npi && (
        <main className="pi-main">
          <Results state={search} onOpen={(p) => navigate({ q: route.q, npi: p.npi })} onExample={runSearch} />
        </main>
      )}

      <footer className="pi-foot">
        Demonstration only. Provider data from the CMS NPPES NPI Registry via Anthropic's NPI Registry connector; independent evidence from open-web research. Confidence scores are illustrative, not calibrated.
      </footer>
    </div>
  );
}

function SearchBox({ initial = "", compact = false, onSearch }: { initial?: string; compact?: boolean; onSearch: (q: string) => void }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  return (
    <form
      className={`pi-search ${compact ? "pi-search-compact" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(value);
      }}
    >
      <Icon name="search" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search by provider name, NPI, specialty, city, state, or ZIP"
        aria-label="Search providers"
        autoFocus={!compact}
      />
      <button type="submit" className="pi-btn pi-btn-primary">Search</button>
    </form>
  );
}

function Home({ onSearch }: { onSearch: (q: string) => void }) {
  return (
    <main className="pi-home">
      <div className="pi-eyebrow"><span className="pi-dot" /> NPI Registry · Open-web evidence · AI reconciliation</div>
      <h1>Provider Intelligence</h1>
      <p className="pi-sub">Search the NPI Registry and validate provider information across independent sources.</p>
      <SearchBox onSearch={onSearch} />
      <div className="pi-examples">
        <span>Try</span>
        {EXAMPLES.map((e) => (
          <button key={e} className="pi-chip" onClick={() => onSearch(e)}>{e}</button>
        ))}
      </div>
      <div className="pi-pillars">
        <div>
          <Icon name="registry" />
          <h3>Registry baseline</h3>
          <p>Official CMS NPPES enumeration data: identity, taxonomy, practice addresses, identifiers.</p>
        </div>
        <div>
          <Icon name="globe" />
          <h3>Independent evidence</h3>
          <p>Practice websites, health-system profiles and directories, searched live for every provider.</p>
        </div>
        <div>
          <Icon name="scale" />
          <h3>Transparent confidence</h3>
          <p>Every claim keeps its source. Agreements and conflicts are shown, not hidden in a score.</p>
        </div>
      </div>
    </main>
  );
}

function Results({ state, onOpen, onExample }: {
  state: { status: string; data?: SearchResponse; error?: string };
  onOpen: (p: ProviderSummary) => void;
  onExample: (q: string) => void;
}) {
  if (state.status === "loading" || state.status === "idle") {
    return (
      <>
        <div className="pi-results-head"><div className="pi-skel" style={{ width: 280, height: 18 }} /></div>
        <div className="pi-results">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="pi-row pi-row-skel"><div className="pi-skel pi-avatar" /><div style={{ flex: 1 }}><div className="pi-skel" style={{ width: "40%", height: 16 }} /><div className="pi-skel" style={{ width: "65%", height: 12, marginTop: 10 }} /></div></div>)}
        </div>
      </>
    );
  }
  if (state.status === "error") {
    return <Empty icon="alert" title="Search unavailable" body={state.error ?? "Something went wrong."} />;
  }
  const data = state.data!;
  return (
    <>
      <div className="pi-results-head">
        <div>
          <div className="pi-count">
            {data.results.length === 0 ? "No providers found" : `${data.results.length} provider${data.results.length === 1 ? "" : "s"}`}
          </div>
          {data.interpretation.length > 0 && (
            <div className="pi-interp">
              <span>Interpreted as</span>
              {data.interpretation.map((i) => (
                <span key={i.label + i.value} className="pi-tag"><em>{i.label}</em> {i.value}</span>
              ))}
            </div>
          )}
        </div>
        <span className="pi-source-label"><Icon name="registry" /> {data.source}</span>
      </div>
      {data.note && <div className="pi-note"><Icon name="info" /> {data.note}</div>}
      {data.results.length === 0 ? (
        <Empty
          icon="search"
          title="No matching providers"
          body="The NPI Registry matches names exactly. Try a last name only, add a state, or search by specialty and city."
          action={<div className="pi-examples">{EXAMPLES.map((e) => <button key={e} className="pi-chip" onClick={() => onExample(e)}>{e}</button>)}</div>}
        />
      ) : (
        <div className="pi-results">
          {data.results.map((p) => <ResultRow key={p.npi} p={p} onOpen={() => onOpen(p)} />)}
        </div>
      )}
    </>
  );
}

function ResultRow({ p, onOpen }: { p: ProviderSummary; onOpen: () => void }) {
  return (
    <button className="pi-row" onClick={onOpen}>
      <div className={`pi-avatar ${p.enumerationType === "Organization" ? "pi-avatar-org" : ""}`}>
        {p.enumerationType === "Organization" ? <Icon name="building" /> : initials(p.name)}
      </div>
      <div className="pi-row-main">
        <div className="pi-row-title">
          {p.name}
          {p.credential && <span className="pi-cred">{p.credential}</span>}
        </div>
        <div className="pi-row-sub">
          <span>{p.specialty ?? "No taxonomy listed"}</span>
          {p.organization && <><span className="pi-sep">·</span><span>{p.organization}</span></>}
        </div>
        <div className="pi-row-badges">
          <span className="pi-badge">{p.enumerationType}</span>
          {p.practiceLocationCount > 1 && <span className="pi-badge pi-badge-blue">{p.practiceLocationCount} practice locations</span>}
          {p.taxonomyCount > 1 && <span className="pi-badge pi-badge-blue">{p.taxonomyCount} taxonomies</span>}
        </div>
      </div>
      <div className="pi-row-meta">
        <div><Icon name="pin" /> {[p.city, p.state].filter(Boolean).join(", ") || "—"}</div>
        <div><Icon name="phone" /> {p.phone ?? "—"}</div>
      </div>
      <div className="pi-row-npi">
        <div className="pi-mono">{p.npi}</div>
        <div className={`pi-status ${p.status === "Active" ? "" : "pi-status-bad"}`}>
          <span className="pi-dot" /> {p.status === "Active" ? "Registry only · unverified" : "Deactivated"}
        </div>
      </div>
      <Icon name="chevron" />
    </button>
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
