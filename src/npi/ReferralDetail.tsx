// ── Referral detail — where/how to send (TEMPORARY NPI demo) ──────────────────
// Hierarchy: destinations first (location → phone → fax → confidence → why),
// then provider identity / licence / specialty / affiliations, then evidence,
// and the raw NPI record last.
import { useEffect, useState } from "react";
import { fetchView, getDemoKey, operatorMode, setDemoKey, type SearchContext } from "./api";
import type { EvidenceSource, FieldConfidence, LicenseCheck, NpiRelationship, PracticeLocation, ProviderDetail, ReferralResearch, ReferralView } from "./types";
import { Empty } from "./NpiApp";
import { hydrateCached, isRunning, startResearch, useResearch, type ResearchState } from "./research";
import { TERMS, specialtyConflict } from "./semantics";
import { Breakdown, Checks, Collapse, ConflictCard, FAMILY_LABEL, FAX_KIND_LABEL, FaxBlock, Icon, ScorePill, SourceChips, destinationChecks, formatDate, initials, timeAgo, tone } from "./ui";

export default function ReferralDetail({ npi, ctx, onBack }: { npi: string; ctx: SearchContext | null; onBack: (() => void) | null }) {
  const [base, setBase] = useState<ReferralView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rs = useResearch(npi, ctx);

  useEffect(() => {
    fetchView(npi, ctx).then(setBase).catch((e: Error) => setLoadError(e.message));
    hydrateCached(npi, ctx);
  }, [npi, ctx]);

  if (loadError) return <main className="pi-main">{onBack && <BackLink onBack={onBack} />}<Empty icon="alert" title="Couldn't load this provider" body={loadError} /></main>;
  if (!base) return <main className="pi-main"><div className="pi-loading"><span className="pi-spinner" /> Loading NPI record, licence and locations…</div></main>;

  const view = rs.view ?? base;
  const p = view.provider;
  const research = view.research;
  const running = isRunning(rs);
  const sources = research?.sources ?? [];

  return (
    <main className="pi-main pi-detail">
      {onBack && <BackLink onBack={onBack} />}

      <section className="pi-hero-card">
        <div className={`pi-avatar pi-avatar-lg ${p.enumerationType === "Organization" ? "pi-avatar-org" : ""}`}>
          {p.enumerationType === "Organization" ? <Icon name="building" size={24} /> : initials(p.name)}
        </div>
        <div className="pi-hero-main">
          <h1>{p.name}{p.credential && <span className="pi-cred pi-cred-lg">{p.credential}</span>}</h1>
          <div className="pi-hero-sub">{view.fields.specialty.value ?? p.specialty ?? "No taxonomy listed"}{research?.organization.value && <> · {research.organization.value}</>}</div>
          <div className="pi-row-badges">
            <span className="pi-badge pi-mono">NPI {p.npi}</span>
            <span className={`pi-badge ${p.status === "Active" ? "pi-badge-green" : "pi-badge-red"}`}>{p.status} NPI</span>
            {ctx && <span className="pi-badge pi-badge-blue">Distances from {ctx.originLabel}</span>}
          </div>
        </div>
        <ResearchAction npi={npi} ctx={ctx} rs={rs} research={research} />
      </section>

      {(running || rs.stage === "error") && <Progress rs={rs} npi={npi} ctx={ctx} />}

      <Destinations view={view} ctx={ctx} researched={Boolean(research)} />

      <div className="pi-grid">
        <div className="pi-col">
          <ProviderCard view={view} />
          {research && <Affiliations research={research} />}
          {research && (research.conflicts.length > 0 || research.dropped.length > 0) && <ConflictsCard research={research} />}
          {research && <EvidenceCard research={research} />}
          <RawRecord p={p} />
        </div>
        <aside className="pi-rail">
          <LicenseCard license={view.license} isOrg={p.enumerationType === "Organization"} />
          <FieldsCard view={view} sources={sources} />
          <HowScored />
        </aside>
      </div>
    </main>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return <button className="pi-back" onClick={onBack}><Icon name="back" /> Back to results</button>;
}

function ResearchAction({ npi, ctx, rs, research }: { npi: string; ctx: SearchContext | null; rs: ResearchState; research: ReferralResearch | null }) {
  const running = isRunning(rs);
  return (
    <div className="pi-hero-action">
      {!research && !running && <button className="pi-btn pi-btn-primary pi-btn-lg" onClick={() => startResearch(npi, ctx, false)}><Icon name="sparkle" /> Research referral routes</button>}
      {running && <button className="pi-btn pi-btn-lg" disabled><span className="pi-spinner" /> Researching…</button>}
      {research && !running && <button className="pi-btn" onClick={() => startResearch(npi, ctx, true)} title="Fresh web research (paid AI call)"><Icon name="refresh" /> Re-research</button>}
      <div className="pi-hero-hint">{research ? <>Last researched {timeAgo(research.researchedAt)}{research.cached ? " · cached" : ""}</> : "Web research: locations, phone, fax, referral instructions"}</div>
    </div>
  );
}

function Progress({ rs, npi, ctx }: { rs: ResearchState; npi: string; ctx: SearchContext | null }) {
  const [now, setNow] = useState(Date.now());
  const [key, setKey] = useState(getDemoKey() ?? "");
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (rs.stage === "error") {
    return (
      <section className="pi-card pi-progress pi-progress-error">
        <div className="pi-progress-title"><Icon name={rs.code === "locked" ? "key" : "alert"} /> {rs.code === "locked" ? "Operator access needed" : "Research couldn't finish"}</div>
        <p>{rs.error}</p>
        {rs.code === "locked" && operatorMode() && (
          <form className="pi-keyform" onSubmit={(e) => { e.preventDefault(); setDemoKey(key); startResearch(npi, ctx, false); }}>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Operator access key" aria-label="Operator access key" />
            <button className="pi-btn pi-btn-primary" type="submit">Unlock &amp; research</button>
          </form>
        )}
        <p className="pi-muted">NPI, licence and distance data shown below are unaffected.</p>
      </section>
    );
  }
  const elapsed = rs.startedAt ? Math.round((now - rs.startedAt) / 1000) : 0;
  const steps: { key: ResearchState["stage"]; label: string; detail?: string }[] = [
    { key: "research", label: "Searching the web for practice locations, phone and fax", detail: rs.found.length ? `${rs.found.length} sources found` : "Official practice and health-system pages first, then payer directories" },
    { key: "extract", label: "Separating each location's phone and fax, keeping source labels verbatim" },
    { key: "score", label: "Filtering unsupported claims, geocoding, scoring each destination" },
  ];
  const order = ["research", "extract", "score"];
  const at = order.indexOf(rs.stage);
  return (
    <section className="pi-card pi-progress">
      <div className="pi-progress-title"><span className="pi-spinner" /> Researching referral routes <span className="pi-muted">· {elapsed}s (typically 1–2 min)</span></div>
      <ol className="pi-steps">
        {steps.map((s, i) => (
          <li key={s.key} className={`pi-step pi-step-${i < at ? "done" : i === at ? "active" : "todo"}`}>
            <span className="pi-step-dot">{i < at ? <Icon name="check" size={12} /> : null}</span>
            <div>{s.label}{i === at && s.detail && <div className="pi-step-detail">{s.detail}</div>}</div>
          </li>
        ))}
      </ol>
      {rs.found.length > 0 && <div className="pi-found-strip">{rs.found.slice(0, 14).map((f) => <span key={f.url} className="pi-domain pi-fade-in">{f.domain}</span>)}</div>}
    </section>
  );
}

// ── Where should I send this referral? ───────────────────────────────────────

const RELATIONSHIP: Record<NpiRelationship, { title: string; tone: "good" | "info" | "warn" }> = {
  npi_current: { title: "Web evidence agrees with the NPI record", tone: "good" },
  additional_locations: { title: "NPI record is incomplete — more current locations found", tone: "info" },
  npi_stale_moved: { title: "NPI record looks stale — provider appears to practise elsewhere now", tone: "warn" },
  successor_practice: { title: "Practice appears renamed or succeeded — same contact numbers, different name/address", tone: "warn" },
  ambiguous_identity: { title: "Identity is ambiguous — sources may describe a different provider", tone: "warn" },
  no_evidence: { title: "No independent web evidence found", tone: "warn" },
};

function Destinations({ view, ctx, researched }: { view: ReferralView; ctx: SearchContext | null; researched: boolean }) {
  const research = view.research;
  const usable = view.locations.filter((l) => l.status !== "former");
  const supported = usable.filter((l) => l.origin !== "npi");
  const other = view.locations.filter((l) => !usable.includes(l));
  const who = view.provider.enumerationType === "Organization" ? "This organization" : view.provider.lastName ? `${view.provider.credential === "MD" || view.provider.credential === "DO" ? "Dr. " : ""}${view.provider.lastName}` : view.provider.name;
  const rel = research ? RELATIONSHIP[research.relationship.kind] : null;

  return (
    <section className="pi-send">
      <div className="pi-send-head">
        <h2><Icon name="send" size={18} /> Where should I send this referral?</h2>
        <p>
          {researched
            ? supported.length
              ? `${who} practises at ${supported.length} location${supported.length > 1 ? "s" : ""} supported by web evidence${usable.length > supported.length ? `, plus ${usable.length - supported.length} listed only in the NPI record` : ""}.`
              : `Research found no independently supported location. ${usable.length} location${usable.length === 1 ? "" : "s"} come from the NPI record only.`
            : `The NPI record lists ${usable.length} practice location${usable.length === 1 ? "" : "s"}. Run research to confirm current locations, phone and fax.`}
          {ctx && <> Distances are from {ctx.originLabel}{ctx.radius ? `; search radius ${ctx.radius} mi` : ""}.</>}
        </p>
      </div>
      {rel && research && (
        <div className={`pi-rel pi-rel-${rel.tone}`}>
          <Icon name={rel.tone === "good" ? "check" : rel.tone === "info" ? "info" : "alert"} />
          <div>
            <strong>{rel.title}</strong>
            <div>{research.relationship.explanation} <SourceChips ids={research.relationship.sourceIds} sources={research.sources} /></div>
            {research.summary && <div className="pi-muted" style={{ marginTop: 4 }}>{research.summary}</div>}
          </div>
        </div>
      )}
      <div className="pi-loc-grid">
        {usable.map((l, i) => <LocationCard key={l.id} loc={l} view={view} rank={i} />)}
      </div>
      {other.length > 0 && (
        <details className="pi-former">
          <summary>{other.length} former location{other.length > 1 ? "s" : ""} (not for referrals)</summary>
          <div className="pi-loc-grid">{other.map((l) => <LocationCard key={l.id} loc={l} view={view} rank={99} />)}</div>
        </details>
      )}
    </section>
  );
}

function LocationCard({ loc, view, rank }: { loc: PracticeLocation; view: ReferralView; rank: number }) {
  const [why, setWhy] = useState(false);
  const research = view.research;
  const sources = research?.sources ?? [];
  const checks = destinationChecks({
    active: view.provider.status === "Active", loc, license: view.license, researched: Boolean(research),
    specialtyCorroborated: Boolean(research?.specialty.value), specialtyDifferent: research?.specialty.status === "different",
    npiSpecialty: view.fields.specialty.value, currentSpecialty: research?.specialty.value, isOrg: view.provider.enumerationType === "Organization",
  });
  const confirmedBy = loc.sourceIds.map((id) => sources.find((s) => s.id === id)).filter((s): s is EvidenceSource => Boolean(s) && s!.family !== "aggregator");
  const fax = loc.bestFax;
  const otherFaxes = loc.faxes.filter((f) => f.digits !== fax?.digits);

  return (
    <article className={`pi-loc pi-loc-${tone(loc.referral.score)} ${rank === 0 ? "pi-loc-best" : ""} ${loc.status === "former" ? "pi-loc-former" : ""}`}>
      {rank === 0 && <div className="pi-loc-flag">Best-supported destination</div>}
      <div className="pi-loc-top">
        <div>
          <div className="pi-loc-name">{loc.organization && loc.organization !== loc.name ? <>{loc.organization} — {loc.name}</> : loc.name}</div>
          <div className="pi-loc-addr"><Icon name="pin" size={13} /> {[loc.line1, loc.line2, `${loc.city}, ${loc.state} ${loc.postalCode}`].filter(Boolean).join(", ")}</div>
        </div>
        <div className="pi-loc-dist">
          {loc.distanceMi !== null ? <>{loc.distanceMi}<span> mi</span></> : <span>—</span>}
          {loc.inRadius === false && <div className="pi-loc-out">outside radius</div>}
          {loc.geoPrecision === "zip" && <div className="pi-loc-out">≈ ZIP centroid</div>}
        </div>
      </div>

      {loc.statusNote && <div className={`pi-loc-note ${loc.status === "possibly_stale" || loc.status === "former" ? "pi-loc-note-warn" : ""}`}><Icon name="info" size={13} /> {loc.statusNote}</div>}

      <div className="pi-loc-contact">
        <div className="pi-phone">
          <div className="pi-fax-kind"><Icon name="phone" size={13} /> Phone</div>
          <div className="pi-fax-num pi-mono">{loc.phones[0]?.number ?? <span className="pi-muted">Not found</span>}</div>
          {loc.phones[0] && <div className="pi-fax-label">{loc.fields.phone.confidence}% · {loc.fields.phone.basis}</div>}
        </div>
        <div>
          <FaxBlock fax={fax} />
          {fax && <div className="pi-fax-label">{loc.fields.fax.confidence}% · {loc.fields.fax.basis}</div>}
        </div>
      </div>
      {fax && fax.faxKind !== "referral" && (
        <div className="pi-fax-caveat">We found this fax for this location, but could not establish that it is specifically the referral intake fax.</div>
      )}
      {(loc.phones.length > 1 || otherFaxes.length > 0) && (
        <div className="pi-alt">
          {loc.phones.slice(1).map((n) => <div key={n.digits}><Icon name="phone" size={12} /> {n.number}{n.label && <span className="pi-muted"> — “{n.label}”</span>} <SourceChips ids={n.sourceIds} sources={sources} /></div>)}
          {otherFaxes.map((n) => <div key={n.digits}><Icon name="fax" size={12} /> {FAX_KIND_LABEL[n.faxKind ?? "unknown"]}: {n.number}{n.label && <span className="pi-muted"> — “{n.label}”</span>} <SourceChips ids={n.sourceIds} sources={sources} /></div>)}
        </div>
      )}

      {loc.referralInstructions && <div className="pi-loc-extra"><strong>Referral instructions:</strong> {loc.referralInstructions.value} <SourceChips ids={loc.referralInstructions.sourceIds} sources={sources} /></div>}
      {loc.acceptingNewPatients && <div className="pi-loc-extra"><strong>{loc.acceptingNewPatients.accepting ? "Accepting new patients" : "Not accepting new patients"}:</strong> {loc.acceptingNewPatients.value} <SourceChips ids={loc.acceptingNewPatients.sourceIds} sources={sources} /></div>}

      <div className="pi-loc-foot">
        <ScorePill label={TERMS.destination.label} score={loc.referral.score} onClick={() => setWhy(!why)} active={why} />
        <button className="pi-link" onClick={() => setWhy(!why)}>Why {loc.referral.score}%?</button>
        <div className="pi-loc-evidence">
          {confirmedBy.length ? <>Confirmed by: {confirmedBy.map((s) => <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className={`pi-cite pi-cite-${s.family}`}><span className="pi-cite-type">{FAMILY_LABEL[s.family]}</span> {s.name}</a>)}</> : <span className="pi-muted">Evidence: NPI record only</span>}
          {research && <span className="pi-muted"> · Last researched {formatDate(research.researchedAt)}</span>}
        </div>
      </div>
      {why && <Breakdown score={loc.referral} />}
      <Checks checks={checks} />
    </article>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

function ProviderCard({ view }: { view: ReferralView }) {
  const [why, setWhy] = useState(true);
  const p = view.provider;
  const r = view.research;
  const tax = p.taxonomies.find((t) => t.primary) ?? p.taxonomies[0];
  const conflict = tax ? specialtyConflict({ npiSpecialty: tax.desc, taxonomyCode: tax.code, licence: view.license, researchDifferent: r?.specialty.status === "different", researchSpecialty: r?.specialty.value ?? null }) : null;
  return (
    <section className="pi-card">
      <div className="pi-card-title-row">
        <h2 className="pi-card-title"><Icon name="user" /> Identity &amp; specialty</h2>
        <ScorePill label={TERMS.verification.label} score={view.providerScore.score} onClick={() => setWhy(!why)} active={why} />
      </div>
      <p className="pi-muted" style={{ marginTop: 0 }}>{TERMS.verification.question} Checks the NPI identity, taxonomy, state licence and current practice evidence. It does not rate the clinician's quality.</p>
      {conflict && <ConflictCard c={conflict} />}
      {why && <Breakdown score={view.providerScore} title={`Why ${view.providerScore.score}%?`} />}
      <dl className="pi-kvs" style={{ marginTop: 16 }}>
        <div className="pi-kv"><dt>Name</dt><dd>{p.name}{p.credential ? `, ${p.credential}` : ""}</dd></div>
        <div className="pi-kv"><dt>Type</dt><dd>{p.enumerationType}</dd></div>
        <div className="pi-kv"><dt>Identity (web)</dt><dd>{r ? (r.identity.conflict ? "Conflicting evidence" : r.identity.confirmed ? `Confirmed · ${r.identity.confidence}%` : "Not confirmed") : "Not researched"}{r && <> <SourceChips ids={r.identity.sourceIds} sources={r.sources} /></>}</dd></div>
        <div className="pi-kv"><dt>NPI last updated</dt><dd>{formatDate(p.lastUpdated)}</dd></div>
      </dl>
    </section>
  );
}

function Affiliations({ research }: { research: ReferralResearch }) {
  if (!research.affiliations.length) return null;
  return (
    <section className="pi-card">
      <h2 className="pi-card-title"><Icon name="building" /> Practice affiliations</h2>
      <ul className="pi-plain">
        {research.affiliations.map((a) => (
          <li key={a.value}>
            <strong>{a.value}</strong> <span className={`pi-badge ${a.current === "current" ? "pi-badge-green" : a.current === "former" ? "pi-badge-red" : ""}`}>{a.current}</span> <SourceChips ids={a.sourceIds} sources={research.sources} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConflictsCard({ research }: { research: ReferralResearch }) {
  return (
    <section className="pi-card">
      <h2 className="pi-card-title"><Icon name="alert" /> Uncertain &amp; conflicting information</h2>
      {research.conflicts.length > 0 && (
        <ul className="pi-plain">
          {research.conflicts.map((c, i) => <li key={i}><strong>{c.field}:</strong> {c.description} <SourceChips ids={c.sourceIds} sources={research.sources} /></li>)}
        </ul>
      )}
      {research.dropped.length > 0 && (
        <>
          <div className="pi-sub-title">Filtered out by deterministic checks ({research.dropped.length})</div>
          <ul className="pi-plain pi-dropped">
            {research.dropped.map((d, i) => <li key={i}><span>{d.reason}</span> <code>{d.detail}</code></li>)}
          </ul>
        </>
      )}
    </section>
  );
}

function EvidenceCard({ research }: { research: ReferralResearch }) {
  const order = ["first_party", "payer", "state", "professional", "independent", "federal", "aggregator"] as const;
  const counting = new Set(research.sources.filter((s) => s.family !== "aggregator").map((s) => s.family));
  return (
    <Collapse title={<><Icon name="globe" /> Evidence</>} count={research.sources.length} defaultOpen>
      <p className="pi-muted" style={{ marginTop: 0 }}>
        {counting.size} independent source famil{counting.size === 1 ? "y" : "ies"} + the NPI record. The NPI connector and CMS NPPES are one federal source, and aggregators / NPI mirrors carry no weight.
      </p>
      {order.map((fam) => {
        const list = research.sources.filter((s) => s.family === fam);
        if (!list.length) return null;
        return (
          <div key={fam}>
            <div className="pi-sub-title">{FAMILY_LABEL[fam]}{fam === "aggregator" && " — shown, not counted"}</div>
            <ul className="pi-sources">
              {list.map((s) => (
                <li key={s.id} className="pi-source">
                  <a className="pi-source-name" href={s.url} target="_blank" rel="noreferrer">{s.name} <Icon name="external" size={12} /></a>
                  <div className="pi-source-domain">{s.domain} · {s.currentness === "possibly_stale" ? "possibly stale" : s.currentness} · <span title={s.familyReason}>{s.familyReason}</span></div>
                  {s.summary && <p className="pi-source-summary">{s.summary}</p>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className="pi-research-detail">
        <div><span>Searches</span> <span className="pi-queries">{research.searchQueries.map((q) => <code key={q}>{q}</code>)}</span></div>
        <div><span>Models</span> {research.usage.researchModel} (web search) → {research.usage.extractModel} (extraction) · {research.usage.searchCalls} searches · {Math.round(research.usage.durationMs / 1000)}s</div>
      </div>
    </Collapse>
  );
}

function RawRecord({ p }: { p: ProviderDetail }) {
  return (
    <Collapse title={<><Icon name="registry" /> NPI Registry record (raw)</>}>
      <dl className="pi-kvs pi-kvs-3">
        <div className="pi-kv"><dt>NPI</dt><dd className="pi-mono">{p.npi}</dd></div>
        <div className="pi-kv"><dt>Status</dt><dd>{p.status}</dd></div>
        <div className="pi-kv"><dt>Enumerated</dt><dd>{formatDate(p.enumerationDate)}</dd></div>
        <div className="pi-kv"><dt>Last updated</dt><dd>{formatDate(p.lastUpdated)}</dd></div>
        <div className="pi-kv"><dt>Source</dt><dd>{p.source}</dd></div>
        {p.authorizedOfficial && <div className="pi-kv"><dt>Authorized official</dt><dd>{p.authorizedOfficial}</dd></div>}
      </dl>
      {p.otherNames.length > 0 && <p><strong>Other names:</strong> {p.otherNames.join("; ")}</p>}
      <div className="pi-sub-title">Taxonomies</div>
      <table className="pi-table"><thead><tr><th>Code</th><th>Description</th><th>Primary</th><th>Licence</th></tr></thead>
        <tbody>{p.taxonomies.map((t) => <tr key={t.code + t.license}><td className="pi-mono">{t.code}</td><td>{t.desc}</td><td>{t.primary ? "Yes" : ""}</td><td>{t.license ? `${t.license} (${t.state ?? "—"})` : "—"}</td></tr>)}</tbody>
      </table>
      <div className="pi-sub-title">Addresses</div>
      <table className="pi-table"><thead><tr><th>Purpose</th><th>Address</th><th>Phone</th><th>Fax</th></tr></thead>
        <tbody>{p.addresses.map((a, i) => <tr key={i}><td>{a.purpose}</td><td>{[a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(", ")}</td><td>{a.phone ?? "—"}</td><td>{a.fax ?? "—"}</td></tr>)}</tbody>
      </table>
      {p.identifiers.length > 0 && (
        <>
          <div className="pi-sub-title">Other identifiers</div>
          <table className="pi-table"><tbody>{p.identifiers.map((x, i) => <tr key={i}><td>{x.desc}</td><td className="pi-mono">{x.identifier}</td><td>{[x.issuer, x.state].filter(Boolean).join(" · ")}</td></tr>)}</tbody></table>
        </>
      )}
      <div className="pi-registry-foot">Mailing addresses are never used as referral destinations.</div>
    </Collapse>
  );
}

// ── Rail ─────────────────────────────────────────────────────────────────────

function LicenseCard({ license, isOrg }: { license: LicenseCheck | null; isOrg: boolean }) {
  return (
    <section className="pi-card">
      <h2 className="pi-card-title"><Icon name="shield" /> State licence</h2>
      {isOrg ? <p className="pi-muted">Organizations aren't individually licensed in this check.</p>
        : !license ? <p className="pi-muted">Not checked.</p>
        : license.match === "unsupported_state" ? <p className="pi-muted">{license.matchNote} ({license.state})</p>
        : (
          <>
            <p className="pi-muted" style={{ marginTop: 0 }}>{license.matchNote}</p>
            {license.records.map((r) => (
              <div key={r.credentialNumber} className="pi-lic">
                <div className="pi-lic-top"><span className="pi-mono">{r.credentialNumber}</span> <span className={`pi-badge ${/^active/i.test(r.status) ? "pi-badge-green" : "pi-badge-red"}`}>{r.status}</span></div>
                <div>{r.credentialType}</div>
                <div className="pi-muted">{r.name} · issued {r.firstIssued ?? "—"} · expires {r.expires ?? "—"}</div>
                <div className="pi-muted">DOH “action taken”: <strong>{r.actionTaken ?? "—"}</strong>{r.actionTaken === "Yes" && " — see the certified record at DOH"}</div>
              </div>
            ))}
            <div className="pi-registry-foot">
              Source: <a href={license.sourceUrl} target="_blank" rel="noreferrer">{license.source}</a>, checked {timeAgo(license.checkedAt)}. The “action taken” flag is DOH's own column; nothing is inferred from a missing record.
            </div>
          </>
        )}
    </section>
  );
}

function FieldsCard({ view, sources }: { view: ReferralView; sources: EvidenceSource[] }) {
  const best = view.locations.find((l) => l.status !== "former");
  const rows: [string, FieldConfidence | undefined][] = [
    ["Specialty", view.fields.specialty],
    ["Practice organization", view.fields.organization],
    ["Licence status", view.fields.license],
    ["Location (best)", best?.fields.location],
    ["Phone (best)", best?.fields.phone],
    ["Fax (best)", best?.fields.fax],
    ["Referral-fax classification", best?.fields.referralFax],
  ];
  return (
    <section className="pi-card">
      <h2 className="pi-card-title"><Icon name="scale" /> Field confidence</h2>
      <ul className="pi-fields">
        {rows.map(([label, f]) => (
          <li key={label}>
            <div className="pi-fields-top"><span>{label}</span><span className={`pi-fields-pct pi-${f && f.confidence ? tone(f.confidence) : "none"}`}>{f && f.confidence ? `${f.confidence}%` : "—"}</span></div>
            <div className="pi-fields-val">{f?.value ?? <span className="pi-muted">Unknown</span>}</div>
            <div className="pi-fields-basis">{f?.basis} {f && <SourceChips ids={f.sourceIds} sources={sources} />}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HowScored() {
  return (
    <Collapse title={<><Icon name="info" /> How confidence works</>}>
      <p><strong>OpenAI proposes, code decides.</strong> AI searches the web, identifies which location each phone/fax belongs to and copies source labels verbatim. It never supplies a score.</p>
      <p>Deterministic code then drops sources web search didn't return, pages about other people, numbers that don't appear in the cited research text, and any “referral fax” whose source label doesn't say referral. It assigns source families by domain rule where it can.</p>
      <p><strong>{TERMS.verification.label}</strong> ({TERMS.verification.question.toLowerCase()}) = active NPI (35) + taxonomy match (10) + active WA licence by number (20) + identity on an official page (20) + specialty corroborated (10) + current affiliation official (5), minus conflicts/staleness.</p>
      <p><strong>{TERMS.destination.label}</strong> ({TERMS.destination.question.toLowerCase()}) = location on an official page (30; other source 18; NPI only 10) + extra source families (≤10) + phone (15–20) + fax (15; NPI only 5) + fax labelled referral (15 official / 8 other) + referral instructions (5) + current official source (5), minus stale/former location, fax disagreement, or a fax that belongs to another location.</p>
      <p>Aggregators and NPI mirrors carry no weight; the NPI connector and CMS NPPES count once. Scores are an explainable product heuristic, not calibrated probabilities.</p>
    </Collapse>
  );
}
