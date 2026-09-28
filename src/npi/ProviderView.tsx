// ── Provider detail + validation (TEMPORARY NPI demo) ─────────────────────────
import { useEffect, useRef, useState } from "react";
import { fetchProvider, loadCachedValidation, saveCachedValidation, streamValidation } from "./api";
import type { ConfidenceScore, EvidenceSource, FieldComparison, FieldKey, ProviderDetail, ValidationResult } from "./types";
import { Empty } from "./NpiApp";
import { FIELD_ICON, FIELD_LABEL, Icon, SOURCE_TYPE_LABEL, formatDate, initials, timeAgo, yearsSince } from "./ui";

type Stage = "idle" | "research" | "sources" | "reconcile" | "score" | "done" | "error";

interface ValidationState {
  stage: Stage;
  found: { url: string; title: string; domain: string }[];
  queries: string[];
  result: ValidationResult | null;
  error: string | null;
  startedAt: number | null;
}

const IDLE: ValidationState = { stage: "idle", found: [], queries: [], result: null, error: null, startedAt: null };

export default function ProviderView({ npi, onBack }: { npi: string; onBack: (() => void) | null }) {
  const [data, setData] = useState<{ provider: ProviderDetail; baseline: ConfidenceScore } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [v, setV] = useState<ValidationState>(() => {
    const cached = loadCachedValidation(npi);
    return cached ? { ...IDLE, stage: "done", result: { ...cached, cached: true } } : IDLE;
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchProvider(npi).then(setData).catch((e: Error) => setLoadError(e.message));
    return () => abortRef.current?.abort();
  }, [npi]);

  const validate = async (fresh: boolean) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setV({ ...IDLE, stage: "research", startedAt: Date.now() });
    let gotResult = false;
    try {
      await streamValidation(npi, fresh, (e) => {
        if (e.type === "stage") setV((s) => ({ ...s, stage: e.stage === "research" ? (s.found.length ? "sources" : "research") : e.stage }));
        else if (e.type === "sources") setV((s) => ({ ...s, stage: "sources", found: e.sources, queries: e.queries }));
        else if (e.type === "result") {
          gotResult = true;
          saveCachedValidation(e.result);
          setV((s) => ({ ...s, stage: "done", result: e.result }));
        } else if (e.type === "error") setV((s) => ({ ...s, stage: "error", error: e.message }));
      }, ac.signal);
      if (!gotResult) setV((s) => (s.stage === "error" ? s : { ...s, stage: "error", error: "Validation ended without a result. Try again." }));
    } catch (err) {
      if ((err as Error).name !== "AbortError") setV((s) => ({ ...s, stage: "error", error: "Couldn't reach the validation service. NPI Registry data is unaffected." }));
    }
  };

  if (loadError) {
    return (
      <main className="pi-main">
        {onBack && <BackLink onBack={onBack} />}
        <Empty icon="alert" title="Couldn't load this provider" body={loadError} />
      </main>
    );
  }
  if (!data) return <main className="pi-main"><DetailSkeleton /></main>;

  const { provider: p, baseline } = data;
  const running = ["research", "sources", "reconcile", "score"].includes(v.stage);
  const result = v.result;
  const score = result?.score ?? baseline;

  return (
    <main className="pi-main pi-detail">
      {onBack && <BackLink onBack={onBack} />}

      <section className="pi-hero-card">
        <div className={`pi-avatar pi-avatar-lg ${p.enumerationType === "Organization" ? "pi-avatar-org" : ""}`}>
          {p.enumerationType === "Organization" ? <Icon name="building" size={24} /> : initials(p.name)}
        </div>
        <div className="pi-hero-main">
          <h1>
            {p.name}
            {p.credential && <span className="pi-cred pi-cred-lg">{p.credential}</span>}
          </h1>
          <div className="pi-hero-sub">
            <span>{p.specialty ?? "No taxonomy listed"}</span>
            <span className="pi-sep">·</span>
            <span>{[p.city, p.state].filter(Boolean).join(", ")}</span>
          </div>
          <div className="pi-row-badges">
            <span className="pi-badge pi-mono">NPI {p.npi}</span>
            <span className="pi-badge">{p.enumerationType}</span>
            <span className={`pi-badge ${p.status === "Active" ? "pi-badge-green" : "pi-badge-red"}`}>{p.status}</span>
            {p.practiceLocationCount > 1 && <span className="pi-badge pi-badge-blue">{p.practiceLocationCount} practice locations</span>}
            {p.taxonomyCount > 1 && <span className="pi-badge pi-badge-blue">{p.taxonomyCount} taxonomies</span>}
          </div>
        </div>
        <div className="pi-hero-action">
          {!result && !running && (
            <button className="pi-btn pi-btn-primary pi-btn-lg" onClick={() => validate(false)}>
              <Icon name="shield" /> Validate Provider
            </button>
          )}
          {running && <button className="pi-btn pi-btn-lg" disabled><span className="pi-spinner" /> Validating…</button>}
          {result && !running && (
            <button className="pi-btn" onClick={() => validate(true)} title="Run fresh web research (uses OpenAI credits)">
              <Icon name="refresh" /> Re-run validation
            </button>
          )}
          <div className="pi-hero-hint">
            {result ? <>Validated {timeAgo(result.validatedAt)}{result.cached ? " · cached" : ""}</> : "Checks the open web for independent evidence"}
          </div>
        </div>
      </section>

      <div className="pi-grid">
        <div className="pi-col">
          {(running || v.stage === "error") && <Progress v={v} />}
          {result && <Findings result={result} />}
          <IdentityCard p={p} />
          <LocationCard p={p} />
          <RegistryCard p={p} />
          <WhatsNext />
        </div>

        <aside className="pi-rail">
          <ConfidenceCard score={score} baseline={baseline} validated={Boolean(result)} running={running} onValidate={() => validate(false)} />
          {result ? <SourcesCard sources={result.sources} queries={result.searchQueries} usage={result.usage} /> : v.found.length > 0 && <FoundCard found={v.found} />}
        </aside>
      </div>
    </main>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return <button className="pi-back" onClick={onBack}><Icon name="back" /> Back to results</button>;
}

function DetailSkeleton() {
  return (
    <>
      <div className="pi-hero-card"><div className="pi-skel pi-avatar pi-avatar-lg" /><div style={{ flex: 1 }}><div className="pi-skel" style={{ width: "35%", height: 26 }} /><div className="pi-skel" style={{ width: "50%", height: 14, marginTop: 12 }} /></div></div>
      <div className="pi-grid"><div className="pi-col"><div className="pi-card pi-skel" style={{ height: 220 }} /><div className="pi-card pi-skel" style={{ height: 180 }} /></div><aside className="pi-rail"><div className="pi-card pi-skel" style={{ height: 320 }} /></aside></div>
    </>
  );
}

// ── Validation progress ──────────────────────────────────────────────────────

const RESEARCH_HINTS = ["Finding the official practice…", "Checking health-system and directory listings…", "Looking for licensing and specialty evidence…", "Checking current contact information…"];

function Progress({ v }: { v: ValidationState }) {
  const [hint, setHint] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setHint((h) => (h + 1) % RESEARCH_HINTS.length);
      setElapsed(v.startedAt ? Math.round((Date.now() - v.startedAt) / 1000) : 0);
    }, 2500);
    return () => clearInterval(t);
  }, [v.startedAt]);

  if (v.stage === "error") {
    return (
      <section className="pi-card pi-progress pi-progress-error">
        <div className="pi-progress-title"><Icon name="alert" /> Validation couldn't finish</div>
        <p>{v.error}</p>
        <p className="pi-muted">Everything shown from the NPI Registry is still accurate to the registry.</p>
      </section>
    );
  }

  const order: Stage[] = ["research", "sources", "reconcile", "score"];
  const idx = order.indexOf(v.stage);
  const steps = [
    { label: "Loaded NPI Registry record", detail: null },
    { label: "Researching provider on the open web", detail: idx === 0 ? RESEARCH_HINTS[hint] : null },
    { label: v.found.length ? `Found ${v.found.length} candidate sources` : "Collecting sources", detail: null },
    { label: "Comparing contact information & reconciling evidence", detail: idx === 2 ? "Checking each fact against the NPI record…" : null },
    { label: "Scoring confidence", detail: null },
  ];
  const state = (i: number) => (i < idx + 1 ? "done" : i === idx + 1 ? "active" : "todo");

  return (
    <section className="pi-card pi-progress">
      <div className="pi-progress-title"><span className="pi-spinner" /> Independent validation in progress <span className="pi-muted">· {elapsed}s</span></div>
      <ol className="pi-steps">
        {steps.map((s, i) => (
          <li key={i} className={`pi-step pi-step-${state(i)}`}>
            <span className="pi-step-dot">{state(i) === "done" ? <Icon name="check" size={12} /> : null}</span>
            <div>
              <div>{s.label}</div>
              {s.detail && <div className="pi-step-detail">{s.detail}</div>}
            </div>
          </li>
        ))}
      </ol>
      {v.found.length > 0 && (
        <div className="pi-found-strip">
          {v.found.slice(0, 12).map((f) => <span key={f.url} className="pi-domain pi-fade-in">{f.domain}</span>)}
        </div>
      )}
    </section>
  );
}

function FoundCard({ found }: { found: { url: string; title: string; domain: string }[] }) {
  return (
    <section className="pi-card">
      <h2 className="pi-card-title"><Icon name="globe" /> Sources found</h2>
      <p className="pi-muted" style={{ marginTop: 0 }}>Candidates from web search. Checking which ones actually describe this provider…</p>
      <ul className="pi-found-list">
        {found.slice(0, 10).map((f) => (
          <li key={f.url} className="pi-fade-in"><a href={f.url} target="_blank" rel="noreferrer">{f.domain}</a></li>
        ))}
      </ul>
    </section>
  );
}

// ── Confidence ────────────────────────────────────────────────────────────────

function ConfidenceCard({ score, baseline, validated, running, onValidate }: { score: ConfidenceScore; baseline: ConfidenceScore; validated: boolean; running: boolean; onValidate: () => void }) {
  const delta = score.score - baseline.score;
  const band = validated ? score.band : "Registry only";
  const tone = !validated ? "neutral" : score.score >= 80 ? "good" : score.score >= 60 ? "ok" : "low";
  return (
    <section className={`pi-card pi-conf pi-conf-${tone}`}>
      <div className="pi-conf-head">
        <Ring value={score.score} tone={tone} />
        <div>
          <div className="pi-conf-band">{band}{validated && " confidence"}</div>
          <div className="pi-muted">
            {validated ? <>{delta >= 0 ? "+" : ""}{delta} vs. NPI-only baseline of {baseline.score}</> : "NPI Registry data alone, before independent checks"}
          </div>
        </div>
      </div>
      <ul className="pi-breakdown">
        {score.items.map((i, k) => (
          <li key={k} className={`pi-bd pi-bd-${i.kind}`}>
            <span className="pi-bd-icon"><Icon name={i.kind === "pass" ? "check" : i.kind === "warn" ? "alert" : i.kind === "fail" ? "x" : "question"} size={13} /></span>
            <span className="pi-bd-label">{i.label}</span>
            <span className="pi-bd-pts">{i.points > 0 ? `+${i.points}` : i.points === 0 ? "" : i.points}</span>
          </li>
        ))}
      </ul>
      {!validated && !running && (
        <button className="pi-btn pi-btn-primary pi-btn-block" onClick={onValidate}><Icon name="shield" /> Validate Provider</button>
      )}
      <div className="pi-conf-foot">Demo scoring model: transparent points, not a calibrated probability.</div>
    </section>
  );
}

function Ring({ value, tone }: { value: number; tone: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(id);
  }, [value]);
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className={`pi-ring pi-ring-${tone}`}>
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={r} className="pi-ring-track" />
        <circle cx="42" cy="42" r={r} className="pi-ring-bar" strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} transform="rotate(-90 42 42)" />
      </svg>
      <div className="pi-ring-num">{value}<span>%</span></div>
    </div>
  );
}

// ── Findings (NPI vs independent) ─────────────────────────────────────────────

const FIELD_ORDER: FieldKey[] = ["identity", "specialty", "organization", "address", "phone", "fax", "website"];

const ASSESS: Record<string, { label: string; cls: string; icon: string }> = {
  agrees: { label: "Confirmed", cls: "good", icon: "check" },
  conflict: { label: "Conflict", cls: "warn", icon: "alert" },
  new_information: { label: "New information", cls: "info", icon: "plus" },
  not_found: { label: "Not independently confirmed", cls: "none", icon: "question" },
};

function Findings({ result }: { result: ValidationResult }) {
  const byId = new Map(result.sources.map((s) => [s.id, s]));
  const fields = FIELD_ORDER.map((k) => result.fields.find((f) => f.field === k)).filter(Boolean) as FieldComparison[];
  const counts = { agrees: 0, conflict: 0, new_information: 0, not_found: 0 };
  fields.forEach((f) => counts[f.assessment]++);
  return (
    <section className="pi-card pi-findings">
      <div className="pi-findings-head">
        <h2 className="pi-card-title"><Icon name="scale" /> NPI Registry vs. independent sources</h2>
        <div className="pi-findings-counts">
          <span className="pi-pill pi-pill-good">{counts.agrees} confirmed</span>
          {counts.conflict > 0 && <span className="pi-pill pi-pill-warn">{counts.conflict} conflict{counts.conflict > 1 ? "s" : ""}</span>}
          {counts.new_information > 0 && <span className="pi-pill pi-pill-info">{counts.new_information} new</span>}
          <span className="pi-pill pi-pill-none">{counts.not_found} unconfirmed</span>
        </div>
      </div>
      <div className="pi-ai-summary">
        <Icon name="sparkle" />
        <div><strong>AI assessment.</strong> {result.summary}</div>
      </div>
      <div className="pi-compare-list">
        {fields.map((f) => <CompareRow key={f.field} f={f} byId={byId} />)}
      </div>
    </section>
  );
}

function CompareRow({ f, byId }: { f: FieldComparison; byId: Map<string, EvidenceSource> }) {
  const a = ASSESS[f.assessment];
  const isUrl = (s: string) => /^https?:\/\//.test(s);
  const showLikely = f.likelyCurrent && f.findings.length > 0 && (f.assessment === "conflict" || f.assessment === "new_information");
  return (
    <div className={`pi-compare pi-compare-${a.cls}`}>
      <div className="pi-compare-head">
        <span className="pi-compare-field"><Icon name={FIELD_ICON[f.field]} /> {FIELD_LABEL[f.field]}</span>
        <span className={`pi-pill pi-pill-${a.cls}`}><Icon name={a.icon} size={12} /> {a.label}</span>
      </div>
      <div className="pi-compare-cols">
        <div>
          <div className="pi-compare-label">NPI Registry</div>
          <div className={`pi-compare-value ${f.npiValue ? "" : "pi-muted"}`}>{f.npiValue ?? "Not in registry"}</div>
        </div>
        <div>
          <div className="pi-compare-label">Independent sources</div>
          {f.findings.length === 0 ? (
            <div className="pi-compare-value pi-muted">No independent evidence found</div>
          ) : (
            f.findings.map((x, i) => (
              <div key={i} className="pi-finding">
                <div className="pi-compare-value">{isUrl(x.value) ? <a href={x.value} target="_blank" rel="noreferrer">{x.value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a> : x.value}</div>
                <div className="pi-cites">
                  {x.sourceIds.map((id) => {
                    const s = byId.get(id);
                    return s ? (
                      <a key={id} className="pi-cite" href={s.url} target="_blank" rel="noreferrer" title={s.name}>
                        <span className="pi-cite-type">{SOURCE_TYPE_LABEL[s.sourceType]}</span> {s.domain}
                      </a>
                    ) : null;
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {f.findings.length > 0 && (
        <div className="pi-compare-assess">
          {showLikely && <div className="pi-likely"><span>Likely current</span> <strong>{f.likelyCurrent}</strong> <span className="pi-likely-conf">{f.confidence}% confidence</span></div>}
          {!showLikely && f.assessment === "agrees" && <div className="pi-likely"><span>Assessment</span> <span className="pi-likely-conf">{f.confidence}% confidence</span></div>}
          <div className="pi-reason">{f.reason}</div>
        </div>
      )}
    </div>
  );
}

// ── Sources ───────────────────────────────────────────────────────────────────

function SourcesCard({ sources, queries, usage }: { sources: EvidenceSource[]; queries: string[]; usage: ValidationResult["usage"] }) {
  const [showQueries, setShowQueries] = useState(false);
  const rank: Record<string, number> = { official_practice: 0, health_system: 1, state_board: 2, government: 3, payer_directory: 4, specialty_association: 5, directory: 6, other: 7 };
  const sorted = [...sources].sort((a, b) => b.confirms.length - a.confirms.length || rank[a.sourceType] - rank[b.sourceType]);
  return (
    <section className="pi-card">
      <h2 className="pi-card-title"><Icon name="globe" /> Evidence sources <span className="pi-count-badge">{sources.length}</span></h2>
      {sources.length === 0 && <p className="pi-muted">Web research didn't find independent sources that describe this provider.</p>}
      <ul className="pi-sources">
        {sorted.map((s) => (
          <li key={s.id} className="pi-source">
            <div className="pi-source-top">
              <span className={`pi-stype pi-stype-${s.sourceType}`}>{SOURCE_TYPE_LABEL[s.sourceType]}</span>
              <a href={s.url} target="_blank" rel="noreferrer" className="pi-source-domain">{s.domain} <Icon name="external" size={12} /></a>
            </div>
            <a href={s.url} target="_blank" rel="noreferrer" className="pi-source-name">{s.name}</a>
            {s.summary && <p className="pi-source-summary">{s.summary}</p>}
            {s.confirms.length > 0 && (
              <div className="pi-source-confirms">
                {s.confirms.map((c) => <span key={c} className="pi-mini"><Icon name="check" size={10} /> {FIELD_LABEL[c]}</span>)}
              </div>
            )}
            <div className="pi-source-time">Researched {formatDate(s.researchedAt)} {new Date(s.researchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
          </li>
        ))}
      </ul>
      <div className="pi-research-meta">
        <button className="pi-link" onClick={() => setShowQueries((x) => !x)}>{showQueries ? "Hide" : "Show"} research details</button>
        {showQueries && (
          <div className="pi-research-detail">
            <div><span>Research model</span> {usage.researchModel} + web search ({usage.searchCalls} search actions)</div>
            <div><span>Reconciliation</span> {usage.reconcileModel}, structured output</div>
            <div><span>Tokens</span> {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out · {(usage.durationMs / 1000).toFixed(0)}s</div>
            {queries.length > 0 && <div className="pi-queries">{queries.map((q) => <code key={q}>{q}</code>)}</div>}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Registry cards ────────────────────────────────────────────────────────────

function KV({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="pi-kv">
      <dt>{k}</dt>
      <dd className={mono ? "pi-mono" : ""}>{v ?? <span className="pi-muted">—</span>}</dd>
    </div>
  );
}

function IdentityCard({ p }: { p: ProviderDetail }) {
  return (
    <section className="pi-card">
      <h2 className="pi-card-title"><Icon name="user" /> Identity</h2>
      <dl className="pi-kvs">
        <KV k="Name" v={p.name} />
        <KV k="Credentials" v={p.credential} />
        <KV k="NPI" v={p.npi} mono />
        <KV k="Provider type" v={p.enumerationType === "Individual" ? "Individual (NPI-1)" : "Organization (NPI-2)"} />
        <KV k="Primary specialty" v={p.specialty} />
        {p.enumerationType === "Individual" ? <KV k="Sole proprietor" v={p.soleProprietor === null ? null : p.soleProprietor ? "Yes" : "No"} /> : <KV k="Authorized official" v={p.authorizedOfficial} />}
        {p.otherNames.length > 0 && <KV k="Other names" v={p.otherNames.join(" · ")} />}
      </dl>
    </section>
  );
}

function LocationCard({ p }: { p: ProviderDetail }) {
  return (
    <section className="pi-card">
      <h2 className="pi-card-title"><Icon name="pin" /> Location</h2>
      <div className="pi-addresses">
        {p.addresses.map((a, i) => (
          <div key={i} className={`pi-address ${a.purpose === "Mailing" ? "pi-address-mail" : ""}`}>
            <div className="pi-address-purpose">{a.purpose}</div>
            <div className="pi-address-lines">
              <div>{a.line1}</div>
              {a.line2 && <div>{a.line2}</div>}
              <div>{a.city}, {a.state} {a.postalCode}</div>
            </div>
            <div className="pi-address-contact">
              <span><Icon name="phone" /> {a.phone ?? <span className="pi-muted">No phone</span>}</span>
              <span><Icon name="fax" /> {a.fax ?? <span className="pi-muted">No fax</span>}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RegistryCard({ p }: { p: ProviderDetail }) {
  const age = yearsSince(p.lastUpdated);
  return (
    <section className="pi-card">
      <div className="pi-card-title-row">
        <h2 className="pi-card-title"><Icon name="registry" /> What the NPI Registry says</h2>
        <span className="pi-source-label">{p.source}</span>
      </div>
      <dl className="pi-kvs pi-kvs-3">
        <KV k="Enumerated" v={formatDate(p.enumerationDate)} />
        <KV k="Last updated" v={<>{formatDate(p.lastUpdated)}{age !== null && age > 3 && <span className="pi-stale">{Math.floor(age)} yrs old</span>}</>} />
        <KV k="Certified" v={p.certificationDate ? formatDate(p.certificationDate) : null} />
        <KV k="Status" v={p.status} />
        {p.sex && <KV k="Sex" v={p.sex} />}
        <KV k="Endpoints" v={p.endpointCount ? `${p.endpointCount} listed` : "None"} />
      </dl>

      <h3 className="pi-sub-title">Taxonomies</h3>
      <table className="pi-table">
        <thead><tr><th>Specialty</th><th>Code</th><th>License</th></tr></thead>
        <tbody>
          {p.taxonomies.map((t) => (
            <tr key={t.code + (t.license ?? "") + (t.state ?? "")}>
              <td>{t.desc} {t.primary && <span className="pi-badge pi-badge-blue">Primary</span>}</td>
              <td className="pi-mono">{t.code}</td>
              <td>{t.license ? `${t.license}${t.state ? ` (${t.state})` : ""}` : <span className="pi-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {p.identifiers.length > 0 && (
        <>
          <h3 className="pi-sub-title">Other identifiers</h3>
          <table className="pi-table">
            <thead><tr><th>Type</th><th>Identifier</th><th>Issuer / state</th></tr></thead>
            <tbody>
              {p.identifiers.map((i, k) => (
                <tr key={k}><td>{i.desc}</td><td className="pi-mono">{i.identifier}</td><td>{[i.issuer, i.state].filter(Boolean).join(" · ") || "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="pi-registry-foot">Retrieved {timeAgo(p.fetchedAt)} · Provider-reported to CMS, which doesn't verify phone, fax or address currency.</div>
    </section>
  );
}

function WhatsNext() {
  const items = [
    ["Payer FHIR directories", "Pull plan-network listings via Da Vinci PDex Plan-Net APIs."],
    ["State licensing boards", "Confirm active licenses and disciplinary status at the source."],
    ["Specialty directories", "ASHA, AAO-HNS, ABMS board certification and more."],
    ["Fax-success feedback", "Learn which numbers actually receive referrals."],
    ["User corrections", "Every correction improves the record for everyone."],
  ];
  return (
    <section className="pi-card pi-next">
      <h2 className="pi-card-title"><Icon name="sparkle" /> What's next</h2>
      <div className="pi-next-grid">
        {items.map(([t, d]) => <div key={t}><strong>{t}</strong><p>{d}</p></div>)}
      </div>
    </section>
  );
}
