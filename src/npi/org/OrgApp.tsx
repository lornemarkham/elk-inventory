// ── /npi-list/shared-knowledge — Shared Organizational Knowledge POC ──
// Tests one hypothesis: can clinics in the same parent organization reuse referral
// knowledge another clinic already verified? Fictional organization (Lornsco Hearing),
// simulated shared store (this browser), deterministic trust rules (model.ts). No AI.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../ui";
import {
  assess, append, digits, fmtFax, isOrgEvidence, independenceKey, METHOD_LABEL, STATUS_LABEL,
  type Assessment, type EvidenceGroup, type Method, type Observation, type Policy, type Status,
} from "./model";
import { ACTORS, ORG, PROVIDERS, SCENES, SEED_META, STORY, sceneEnd, sceneStart, initialState, type DemoState, type Provider } from "./seed";
import { useDemoState } from "./store";
import "./org.css";

type View = "providers" | "policy" | "log" | "about";
const VIEWS: [View, string][] = [["providers", "Provider directory"], ["policy", "Corporate policy"], ["log", "Evidence log"], ["about", "What is (not) proven"]];

const TZ = "America/Los_Angeles";
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });

const CONTEXTS = [{ id: "corporate", name: ORG.name, short: "Corporate", sub: "Parent organization" }, ...ORG.clinics.map((c) => ({ id: c.id, name: c.name, short: c.short, sub: "Clinic" }))];
const ctxName = (id: string) => CONTEXTS.find((c) => c.id === id)!.name;
const clinicShort = (id: string | null) => ORG.clinics.find((c) => c.id === id)?.short ?? "Corporate";

const TONE: Record<Status, "good" | "warn" | "bad" | "info" | "muted"> = {
  trusted_org: "good", usable_locally: "info", registry_only: "muted", org_unconfirmed: "warn",
  review_required: "bad", reconfirm_required: "warn", no_destination: "muted",
};

function useHashView(): [View, (v: View) => void] {
  const read = (): View => { const h = location.hash.replace(/^#\/?/, "") as View; return VIEWS.some(([v]) => v === h) ? h : "providers"; };
  const [v, setV] = useState<View>(read);
  useEffect(() => { const f = () => setV(read()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return [v, (n) => { location.hash = `/${n}`; setV(n); scrollTo(0, 0); }];
}

export default function OrgApp() {
  const [state, setState] = useDemoState();
  const [view, setView] = useHashView();
  const viewer = { orgId: ORG.id, clinicId: state.context === "corporate" ? null : state.context };
  const assessments = useMemo(() => new Map(PROVIDERS.map((p) => [p.id, assess(p.id, state.log, state.policy, viewer, state.clock, ORG)])),
    [state.log, state.policy, state.clock, state.context]); // eslint-disable-line react-hooks/exhaustive-deps

  const setContext = (context: string) => setState((s) => ({ ...s, context }));
  const reset = () => { if (confirm("Reset the demo? This clears every confirmation made in this browser.")) setState(initialState()); };

  return (
    <div className={`og og-ctx-${state.context}`}>
      <header className="og-head">
        <div className="og-head-row">
          <div className="og-brand">
            <span className="og-logo">L</span>
            <div>
              <div className="og-brand-name">Lornsco <span className="og-muted">· Shared Organizational Knowledge</span></div>
              <a className="og-poc" href="#/about" onClick={(e) => { e.preventDefault(); setView("about"); }}>
                PROOF OF CONCEPT · fictional organization · simulated store · <u>not validated</u>
              </a>
            </div>
          </div>
          <ContextSwitch value={state.context} onChange={setContext} />
          <DemoClock state={state} setState={setState} onReset={reset} />
        </div>
        <ContextBar context={state.context} />
      </header>

      <div className="og-body">
        <aside className="og-side">
          <OrgTree context={state.context} onPick={setContext} />
          <nav className="og-nav">
            {VIEWS.map(([v, label]) => (
              <a key={v} href={`#/${v}`} className={`${view === v ? "on" : ""} ${v === "about" ? "og-nav-warn" : ""}`} onClick={(e) => { e.preventDefault(); setView(v); }}>{label}</a>
            ))}
          </nav>
          <div className="og-side-note">
            <b>Store:</b> this browser only (localStorage). Open a second window to play the other clinic side by side.
          </div>
        </aside>

        <main className="og-main">
          {view === "providers" && (
            <>
              <SceneStrip state={state} setState={setState} />
              <Providers state={state} setState={setState} assessments={assessments} />
            </>
          )}
          {view === "policy" && <PolicyPage state={state} setState={setState} assessments={assessments} />}
          {view === "log" && <LogPage state={state} onOpen={(id) => { setState((s) => ({ ...s, selected: id })); setView("providers"); }} />}
          {view === "about" && <AboutPage />}
        </main>
      </div>
    </div>
  );
}

// ── header pieces ───────────────────────────────────────────────────────────────

function ContextSwitch({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="og-switch" role="radiogroup" aria-label="Working as">
      <span className="og-switch-label">Working as</span>
      {CONTEXTS.map((c) => (
        <button key={c.id} role="radio" aria-checked={value === c.id} className={`og-switch-btn og-c-${c.id} ${value === c.id ? "on" : ""}`} onClick={() => onChange(c.id)} data-ctx={c.id}>
          <span className="og-dot" />
          <span><b>{c.short}</b><small>{c.sub}</small></span>
        </button>
      ))}
    </div>
  );
}

function ContextBar({ context }: { context: string }) {
  const actor = ACTORS[context]?.[0];
  return (
    <div className="og-ctxbar" data-testid="context-bar">
      <Icon name={context === "corporate" ? "building" : "pin"} size={15} />
      {context === "corporate"
        ? <span>You are viewing as <b>{ORG.name} — corporate</b>. You set policy for all {ORG.totalClinics} clinics and resolve reviews.</span>
        : <span>You are working at <b>{ctxName(context)}</b> — one of {ORG.totalClinics} {ORG.name} clinics{actor ? <> · signed in as {actor}</> : null}</span>}
    </div>
  );
}

function DemoClock({ state, setState, onReset }: { state: DemoState; setState: (f: (s: DemoState) => DemoState) => void; onReset: () => void }) {
  const bump = (days: number) => setState((s) => ({ ...s, clock: new Date(Date.parse(s.clock) + days * 86_400_000).toISOString() }));
  return (
    <div className="og-clock">
      <div><span className="og-switch-label">Demo date (simulated)</span><b data-testid="clock">{fmtDate(state.clock)}</b></div>
      <div className="og-clock-btns">
        <button onClick={() => bump(1)} title="Advance the simulated clock one day">+1d</button>
        <button onClick={() => bump(7)} title="Advance one week">+1w</button>
        <button onClick={() => bump(400)} title="Advance ~13 months (confirmations go stale)">+13mo</button>
        <button onClick={onReset} className="og-reset" title="Reset the demo">Reset</button>
      </div>
    </div>
  );
}

function OrgTree({ context, onPick }: { context: string; onPick: (id: string) => void }) {
  return (
    <div className="og-tree" data-testid="org-tree">
      <div className="og-side-h">Organization</div>
      <button className={`og-tree-root og-c-corporate ${context === "corporate" ? "on" : ""}`} onClick={() => onPick("corporate")}>
        <Icon name="building" size={15} /> <span><b>{ORG.name}</b><small>Parent · owns knowledge + policy</small></span>
      </button>
      <ul>
        {ORG.clinics.map((c) => (
          <li key={c.id}>
            <button className={`og-c-${c.id} ${context === c.id ? "on" : ""}`} onClick={() => onPick(c.id)}><span className="og-dot" /> {c.name}</button>
          </li>
        ))}
        <li className="og-tree-more">+ {ORG.totalClinics - ORG.clinics.length} more clinics <small>(not simulated)</small></li>
      </ul>
    </div>
  );
}

// ── the five-minute demo ────────────────────────────────────────────────────────

function SceneStrip({ state, setState }: { state: DemoState; setState: (s: DemoState | ((s: DemoState) => DemoState)) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const scene = SCENES.find((s) => s.n === active) ?? null;
  const go = (n: number) => { setActive(n); setState({ ...sceneStart(n), policy: state.policy, policyLog: state.policyLog }); };
  const target = scene?.perform ? sceneEnd(scene.n).log.at(-1)! : null;
  const done = !!target && state.log.some((o) => o.providerId === target.providerId && o.observedAt === target.observedAt && o.value === target.value && o.clinicId === target.clinicId);
  return (
    <section className="og-scenes" data-testid="scenes">
      <div className="og-scenes-row">
        <span className="og-scenes-label">Five-minute demo</span>
        {SCENES.map((s) => (
          <button key={s.n} className={`og-scene ${active === s.n ? "on" : ""}`} onClick={() => go(s.n)} data-scene={s.n}>
            <span className="og-scene-n">{s.n}</span>{s.title}
          </button>
        ))}
      </div>
      {scene && (
        <div className="og-scene-card">
          <p><b>Scene {scene.n} — {scene.title}.</b> {scene.headline}</p>
          {scene.action && (
            <div className="og-scene-act">
              <span>Do it live: <b>{scene.action}</b> — or</span>
              <button className="og-btn og-btn-sm" disabled={done} onClick={() => scene.perform && setState((s) => ({ ...scene.perform!(s), context: scene.context, selected: s.selected }))} data-testid="perform">
                {done ? "Step performed" : "Perform this step"}
              </button>
            </div>
          )}
          <small className="og-muted">Jumping to a scene rebuilds the demo log up to that point (policy settings are kept).</small>
        </div>
      )}
    </section>
  );
}

// ── directory + detail ──────────────────────────────────────────────────────────

function StatusChip({ a, small }: { a: Assessment; small?: boolean }) {
  return <span className={`og-chip og-t-${TONE[a.status]} ${small ? "og-chip-sm" : ""}`} data-status={a.status}>{STATUS_LABEL[a.status]}</span>;
}
function PhiChip({ a, context }: { a: Assessment; context: string }) {
  if (context === "corporate") return <span className="og-chip og-chip-sm og-t-muted">PHI: per clinic</span>;
  return <span className={`og-chip og-chip-sm ${a.phiAllowed ? "og-t-good" : "og-t-bad-soft"}`}>PHI {a.phiAllowed ? "allowed" : "not allowed"}</span>;
}

function Providers({ state, setState, assessments }: { state: DemoState; setState: (f: (s: DemoState) => DemoState) => void; assessments: Map<string, Assessment> }) {
  const [q, setQ] = useState("");
  const match = (p: Provider) => !q || `${p.name} ${p.practice ?? ""} ${p.address}`.toLowerCase().includes(q.toLowerCase());
  const known = PROVIDERS.filter((p) => match(p) && assessments.get(p.id)!.status !== "registry_only");
  const pub = PROVIDERS.filter((p) => match(p) && assessments.get(p.id)!.status === "registry_only");
  const sel = PROVIDERS.find((p) => p.id === state.selected) ?? null;
  const Row = ({ p }: { p: Provider }) => {
    const a = assessments.get(p.id)!;
    return (
      <button className={`og-row ${state.selected === p.id ? "on" : ""}`} onClick={() => setState((s) => ({ ...s, selected: p.id }))} data-provider={p.id}>
        <span className="og-row-top"><b>{p.name}{p.credential ? `, ${p.credential}` : ""}</b>{p.fictional && <span className="og-fict">fictional</span>}</span>
        <span className="og-row-sub">{p.practice ?? p.specialty} · {p.distanceMi} mi</span>
        <span className="og-row-chips"><StatusChip a={a} small /><PhiChip a={a} context={state.context} /></span>
      </button>
    );
  };
  return (
    <div className="og-dir">
      <div className="og-list">
        <div className="og-list-head">
          <b>ENT near Seattle, WA 98115</b>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter providers…" aria-label="Filter providers" />
        </div>
        <div className="og-list-sec">Known to {ORG.name} <span className="og-count">{known.length}</span></div>
        {known.map((p) => <Row key={p.id} p={p} />)}
        {!known.length && <div className="og-empty">No organization knowledge yet.</div>}
        <div className="og-list-sec">Public candidates · CMS/NPPES only <span className="og-count">{pub.length}</span></div>
        {pub.map((p) => <Row key={p.id} p={p} />)}
        <p className="og-list-foot">
          Candidates: the recorded Provider Intelligence run ({fmtDate(SEED_META.capturedAt)}, ENT, 98115, 10 mi) — the 10 nearest with an active WA licence and an NPPES fax.
          A short list on purpose; public data only seeds candidates.
        </p>
      </div>
      {sel ? <Detail key={sel.id} p={sel} a={assessments.get(sel.id)!} state={state} setState={setState} /> : <div className="og-detail og-empty">Pick a provider.</div>}
    </div>
  );
}

function Detail({ p, a, state, setState }: { p: Provider; a: Assessment; state: DemoState; setState: (f: (s: DemoState) => DemoState) => void }) {
  const [form, setForm] = useState<null | "confirm" | "change" | "resolve">(null);
  const [history, setHistory] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const context = state.context;
  const clinicId = context === "corporate" ? null : context;
  const obs = state.log.filter((o) => o.providerId === p.id);
  const otherClinic = a.value && clinicId && a.confirmingClinics.length > 0 && !a.confirmingClinics.includes(clinicId);
  const byId = new Map(state.log.map((o) => [o.id, o]));

  return (
    <article className="og-detail" data-testid="detail">
      <header className="og-prov">
        <div>
          <h1>{p.name}{p.credential ? `, ${p.credential}` : ""}</h1>
          <div className="og-prov-sub">{p.specialty} · {p.practice ?? "—"}</div>
          <div className="og-prov-sub og-muted">{p.address}{p.phone ? ` · phone ${p.phone}` : ""}</div>
        </div>
        <div className="og-prov-src">
          {p.fictional ? <span className="og-fict og-fict-lg">Fictional provider</span> : <span className="og-chip og-t-muted">Real NPPES record · NPI {p.npi}</span>}
          <dl>
            <dt>Provider identity</dt><dd>{p.identitySource}</dd>
            <dt>Specialty</dt><dd>{p.identitySource}{p.corroboration ? <> · corroborated: {p.corroboration}</> : null}</dd>
          </dl>
        </div>
      </header>

      <ol className="og-gates" data-testid="gates">
        <li className="ok"><Icon name="check" /> <span><b>Provider record available</b><small>{p.identitySource}</small></span></li>
        <li className={a.destinationConfirmed ? "ok" : "warn"}><Icon name={a.destinationConfirmed ? "check" : "alert"} /> <span><b>Referral destination confirmed</b><small>{a.destinationConfirmed ? "by organization evidence" : a.status === "review_required" ? "clinics disagree" : "not by your organization"}</small></span></li>
        <li className={context === "corporate" ? "na" : a.phiAllowed ? "ok" : "no"} data-testid="phi">
          <Icon name={context === "corporate" ? "info" : a.phiAllowed ? "check" : "x"} />
          <span><b>PHI transmission allowed{clinicId ? ` from ${clinicShort(clinicId)}` : ""}: {context === "corporate" ? "decided per clinic" : a.phiAllowed ? "YES" : "NO"}</b><small>{a.phiReason}</small></span>
        </li>
      </ol>

      {otherClinic && (
        <div className="og-shared" data-testid="shared-callout">
          <Icon name="link" size={20} />
          <div>
            <b>Verified by another clinic in your organization</b>
            {a.supporting.filter((g) => g.kind === "clinic").map((g) => (
              <div key={g.key}>{g.label} · {fmtDate(g.latest.observedAt)} · Method: {METHOD_LABEL[g.latest.method]}</div>
            ))}
            <small>You don't need to rediscover this. {a.phiAllowed ? "" : "Under current policy your clinic still needs its own confirmation before sending PHI."}</small>
          </div>
        </div>
      )}

      <section className={`og-dest og-t-border-${TONE[a.status]}`} data-testid="destination">
        <div className="og-dest-top">
          <div>
            <div className="og-label">Referral destination · fax</div>
            <div className="og-fax" data-testid="dest-value">{a.value ? fmtFax(a.value) : a.status === "review_required" ? "Disputed" : a.registry ? <span className="og-fax-reg">{fmtFax(a.registry.value)} <small>(registry only)</small></span> : "—"}</div>
          </div>
          <div className="og-dest-status">
            <div className="og-label">Organization status</div>
            <StatusChip a={a} />
            <div className="og-rule">Policy rule: {a.rule}</div>
          </div>
        </div>

        {a.status === "registry_only" && a.registry && (
          <div className="og-why">
            <div className="og-why-h">Why?</div>
            <div className="og-ev warn"><Icon name="registry" /> Source: {a.registry.source} · <b>Organization verified: NO</b></div>
            {a.registry.copies > 0 && <div className="og-ev muted"><Icon name="info" /> {a.registry.copies} directory site{a.registry.copies > 1 ? "s list" : " lists"} the same number — copies of NPPES, not independent evidence.</div>}
            <div className="og-ev muted"><Icon name="shield" /> A registry fax can put a provider in the directory. It is not approved for PHI until a clinic confirms it.</div>
          </div>
        )}

        {a.supporting.length > 0 && (
          <div className="og-why">
            <div className="og-why-h">Why?</div>
            {a.supporting.map((g) => <Group key={g.key} g={g} />)}
            {a.status === "usable_locally" && a.independentConfirmations < state.policy.orgTrustThreshold && (
              <div className="og-ev muted"><Icon name="info" /> {a.independentConfirmations} of {state.policy.orgTrustThreshold} independent clinic confirmations needed to trust this organization-wide.</div>
            )}
            {a.independentConfirmations >= 2 && (
              <div className="og-ev good-soft" data-testid="independent-count"><Icon name="check" /> <b>{a.independentConfirmations} independent {ORG.parent} clinic confirmations</b> — all report {fmtFax(a.value!)}</div>
            )}
            {a.duplicates > 0 && <div className="og-ev muted" data-testid="duplicates"><Icon name="info" /> {a.duplicates} more record{a.duplicates > 1 ? "s" : ""} share a source with the above and {a.duplicates > 1 ? "are" : "is"} not counted as independent.</div>}
            {a.registry && (
              <div className={`og-ev ${a.registry.agrees ? "muted" : "warn"}`} data-testid="registry-row">
                <Icon name="registry" /> CMS/NPPES currently lists {fmtFax(a.registry.value)} {a.registry.agrees ? "· agrees" : <b>· ⚠ Registry disagrees</b>}
              </div>
            )}
            <div className="og-caveat">Organizational trust from agreeing observations under {ORG.name} policy — not proof the number is correct.</div>
          </div>
        )}

        {a.conflict && (() => { const newest = a.conflict.flatMap((c) => c.observations).sort((x, y) => y.observedAt.localeCompare(x.observedAt) || y.seq - x.seq)[0].id; return (
          <div className="og-conflict" data-testid="conflict">
            <div className="og-conflict-h"><Icon name="alert" /> Recent conflict — review required before PHI transmission</div>
            <div className="og-conflict-cols">
              {a.conflict.map((c) => (
                <div key={c.value} className="og-conflict-val">
                  <div className="og-fax-sm">{fmtFax(c.value)}</div>
                  {c.observations.map((o) => (
                    <div key={o.id} className="og-conflict-obs">{o.id === newest ? <span className="og-new">New observation</span> : null}{clinicShort(o.clinicId)} · {fmtShort(o.observedAt)} · {METHOD_LABEL[o.method]}{o.actor ? ` · ${o.actor.split(" · ")[0]}` : ""}</div>
                  ))}
                  <small>{c.groups.length} independent source{c.groups.length > 1 ? "s" : ""}</small>
                </div>
              ))}
            </div>
            <p className="og-small">Nothing was replaced. The system does not decide which number is right — {context === "corporate" ? "you can resolve it after checking with the practice." : `${ORG.name} corporate resolves it, or you can report what you learn.`}</p>
          </div>
        ); })()}

        {a.expired.length > 0 && (
          <div className="og-ev warn" data-testid="expired"><Icon name="refresh" /> {a.expired.length} older confirmation{a.expired.length > 1 ? "s are" : " is"} past the {state.policy.reconfirmAfterDays}-day reconfirmation period and no longer count{a.expired.length > 1 ? "" : "s"} (kept in history).</div>
        )}

        <div className="og-actions">
          {clinicId && <button className="og-btn" onClick={() => setForm(form === "confirm" ? null : "confirm")} data-testid="btn-confirm"><Icon name="check" /> Confirm referral destination</button>}
          {clinicId && <button className="og-btn og-btn-ghost" onClick={() => setForm(form === "change" ? null : "change")} data-testid="btn-change"><Icon name="alert" /> Report a change</button>}
          {!clinicId && a.status === "review_required" && <button className="og-btn" onClick={() => setForm("resolve")} data-testid="btn-resolve"><Icon name="scale" /> Resolve review</button>}
          <button className="og-btn og-btn-ghost" onClick={() => setHistory(!history)} data-testid="btn-history"><Icon name="registry" /> {history ? "Hide" : "View"} evidence history ({obs.length})</button>
          {clinicId && (
            <button className="og-btn og-btn-send" disabled={!a.phiAllowed || !a.value} onClick={() => setSent(`Simulated — nothing was transmitted. Would fax ${fmtFax(a.value!)} from ${clinicShort(clinicId)}.`)} data-testid="btn-send"
              title={a.phiAllowed ? "Simulated send" : a.phiReason}>
              <Icon name="send" /> Send referral (simulated)
            </button>
          )}
        </div>
        {sent && <div className="og-ev muted" data-testid="sent">{sent}</div>}
        {!clinicId && <p className="og-small og-muted">Clinics confirm destinations. Switch to Seattle North or Seattle South to record an observation.</p>}

        {form && form !== "resolve" && clinicId && (
          <ObservationForm key={form} mode={form} p={p} a={a} clinicId={clinicId} state={state}
            onCancel={() => setForm(null)}
            onSave={(o) => { setState((s) => ({ ...s, log: append(s.log, o) })); setForm(null); }} />
        )}
        {form === "resolve" && a.conflict && (
          <ResolveForm a={a} onCancel={() => setForm(null)} onSave={(value, note) => {
            setState((s) => ({ ...s, log: append(s.log, { providerId: p.id, value, sourceType: "review", source: `${ORG.name} (corporate)`, orgId: ORG.id, clinicId: null, actor: ACTORS.corporate[0], method: "corporate_review", observedAt: s.clock, note }) }));
            setForm(null);
          }} />
        )}
      </section>

      {history && <History obs={obs} byId={byId} />}
    </article>
  );
}

function Group({ g }: { g: EvidenceGroup }) {
  const o = g.latest;
  const text = g.kind === "clinic" ? <>{g.label} confirmed · {METHOD_LABEL[o.method].toLowerCase()} — {fmtDate(o.observedAt)}</>
    : g.kind === "import" ? <>{g.label} — {fmtDate(o.observedAt)}</>
    : <>{g.label} — {fmtDate(o.observedAt)}{o.note ? ` · “${o.note}”` : ""}</>;
  return (
    <div className="og-ev good" data-group={g.key}>
      <Icon name="check" /> <span>{text}
        {g.observations.length > 1 && <small className="og-muted"> · {g.observations.length} records, counted once ({g.kind === "import" ? "same spreadsheet" : g.kind === "clinic" ? "same clinic" : "same source"})</small>}
        {g.kind === "import" && <small className="og-muted"> · imported into {g.observations.map((x) => clinicShort(x.clinicId)).join(", ")}</small>}
      </span>
    </div>
  );
}

function ObservationForm({ mode, p, a, clinicId, state, onCancel, onSave }: {
  mode: "confirm" | "change"; p: Provider; a: Assessment; clinicId: string; state: DemoState;
  onCancel: () => void; onSave: (o: Parameters<typeof append>[1]) => void;
}) {
  const suggested = mode === "confirm" ? (a.value ?? (p.id.startsWith("demo-") ? STORY.confirmed : "")) : (p.id.startsWith("demo-") ? STORY.conflicting : "");
  const [value, setValue] = useState(suggested ? fmtFax(suggested) : "");
  const [method, setMethod] = useState<Method>("called_practice");
  const [actor, setActor] = useState(ACTORS[clinicId][mode === "change" ? 1 : 0]);
  const [note, setNote] = useState("");
  const ok = digits(value).length === 10;
  const supporting = a.supporting.filter((g) => g.kind === "clinic" && !g.key.endsWith(`:${clinicId}`));
  const reuseFrom = supporting[0]?.latest;
  const willConflict = ok && ((a.value && digits(value) !== a.value) || (a.conflict && !a.conflict.some((c) => c.value === digits(value))));
  return (
    <form className="og-form" data-testid="obs-form" onSubmit={(e) => {
      e.preventDefault();
      if (!ok) return;
      const reuse = method === "reused_shared" && reuseFrom;
      onSave({ providerId: p.id, value, sourceType: "clinic_confirmation", source: ORG.clinics.find((c) => c.id === clinicId)!.name, orgId: ORG.id, clinicId,
        actor, method, observedAt: state.clock, note: note || undefined, derivedFrom: reuse ? reuseFrom!.id : undefined });
    }}>
      <div className="og-form-h">{mode === "confirm" ? "Confirm referral destination" : "Report a change"} · recorded as {clinicShort(clinicId)} · {fmtDate(state.clock)}</div>
      <label>Referral fax<input name="value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="206-555-2222" autoFocus /></label>
      <label>How do you know?
        <select name="method" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
          <option value="called_practice">Called practice</option>
          <option value="practice_letterhead">Practice letterhead / cover sheet</option>
          {reuseFrom && mode === "confirm" && <option value="reused_shared">Re-used {clinicShort(reuseFrom.clinicId)}'s value (no new call)</option>}
        </select>
      </label>
      <label>Recorded by
        <select value={actor} onChange={(e) => setActor(e.target.value)}>{ACTORS[clinicId].map((x) => <option key={x}>{x}</option>)}</select>
      </label>
      <label className="og-form-note">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who you spoke to, what they said" /></label>
      {method === "reused_shared" && <div className="og-ev muted"><Icon name="info" /> Recorded for history, lineage: copied from {clinicShort(reuseFrom?.clinicId ?? null)}. It will <b>not</b> count as an independent confirmation.</div>}
      {willConflict && <div className="og-ev warn"><Icon name="alert" /> This differs from what your organization has on file. It will be recorded alongside the existing evidence and trigger review — nothing is overwritten.</div>}
      <div className="og-form-btns"><button className="og-btn" disabled={!ok} type="submit" data-testid="obs-save">Save observation</button><button type="button" className="og-btn og-btn-ghost" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function ResolveForm({ a, onCancel, onSave }: { a: Assessment; onCancel: () => void; onSave: (value: string, note: string) => void }) {
  const [value, setValue] = useState(a.conflict![0].value);
  const [note, setNote] = useState("");
  return (
    <form className="og-form" onSubmit={(e) => { e.preventDefault(); if (note.trim()) onSave(value, note.trim()); }} data-testid="resolve-form">
      <div className="og-form-h">Resolve review · {ACTORS.corporate[0]} · every observation stays in history</div>
      <label>Organization value
        <select value={value} onChange={(e) => setValue(e.target.value)}>{a.conflict!.map((c) => <option key={c.value} value={c.value}>{fmtFax(c.value)}</option>)}</select>
      </label>
      <label className="og-form-note">What did you check? (required)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called the practice manager; confirmed new fax" /></label>
      <div className="og-form-btns"><button className="og-btn" disabled={!note.trim()} type="submit">Record resolution</button><button type="button" className="og-btn og-btn-ghost" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function History({ obs, byId }: { obs: Observation[]; byId: Map<string, Observation> }) {
  const rows = [...obs].sort((x, y) => y.observedAt.localeCompare(x.observedAt) || y.seq - x.seq);
  return (
    <section className="og-history" data-testid="history">
      <h3>Evidence history <small className="og-muted">append-only · {obs.length} observation{obs.length === 1 ? "" : "s"} · nothing is ever edited or deleted</small></h3>
      <table>
        <thead><tr><th>When</th><th>Value</th><th>Source</th><th>Method</th><th>By</th><th>Independence / lineage</th><th>Note</th></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} data-obs={o.id}>
              <td>{fmtTime(o.observedAt)}</td>
              <td className="og-mono">{fmtFax(o.value)}</td>
              <td>{o.source}{o.clinicId && o.sourceType !== "clinic_confirmation" ? ` → ${clinicShort(o.clinicId)}` : ""}{o.simulated ? <span className="og-tag-sim">sim</span> : <span className="og-tag-real">real</span>}</td>
              <td>{METHOD_LABEL[o.method]}</td>
              <td>{o.actor ?? "—"}</td>
              <td className="og-mono og-small">{independenceKey(o, byId)}{o.derivedFrom ? ` (copied from ${o.derivedFrom})` : ""}{o.method === "reused_shared" ? " · not evidence" : ""}</td>
              <td className="og-small">{o.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── corporate policy ────────────────────────────────────────────────────────────

function PolicyPage({ state, setState, assessments }: { state: DemoState; setState: (f: (s: DemoState) => DemoState) => void; assessments: Map<string, Assessment> }) {
  const editable = state.context === "corporate";
  const pol = state.policy;
  const set = (patch: Partial<Policy>, change: string) => setState((s) => ({ ...s, policy: { ...s.policy, ...patch }, policyLog: [...s.policyLog, { at: s.clock, actor: ACTORS.corporate[0], change }] }));
  const counts = new Map<Status, number>();
  for (const a of assessments.values()) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
  const Rule = ({ when, then, locked, children, tone }: { when: string; then: ReactNode; locked?: string; children?: ReactNode; tone: string }) => (
    <div className="og-rulecard">
      <div className="og-rule-when"><span className="og-label">When</span>{when}</div>
      <Icon name="chevron" size={20} />
      <div className={`og-rule-then og-t-border-${tone}`}><span className="og-label">Then</span>{then}</div>
      <div className="og-rule-ctl">{locked ? <span className="og-lock" title={locked}>Fixed in this POC</span> : children}</div>
    </div>
  );
  return (
    <div className="og-page" data-testid="policy">
      <div className="og-page-h">
        <h2>Corporate policy · {ORG.name}</h2>
        <p className="og-muted">The parent organization decides when shared knowledge becomes usable. Rules are applied deterministically to the evidence log — no AI, no scores.
          {!editable && <b> Read-only here: switch to Corporate to change policy.</b>}</p>
      </div>
      <Rule when="Corporate imports a referral destination" tone={pol.corporateImportTrusted ? "good" : "warn"} then={pol.corporateImportTrusted ? "Trusted organization-wide" : "Confirmation required before PHI"}>
        <label className="og-toggle"><input type="checkbox" disabled={!editable} checked={pol.corporateImportTrusted} onChange={(e) => set({ corporateImportTrusted: e.target.checked }, `Corporate imports → ${e.target.checked ? "trusted organization-wide" : "confirmation required"}`)} data-testid="pol-import" /> Trust corporate imports</label>
      </Rule>
      <Rule when="One clinic confirms a destination" tone="info" then={pol.singleConfirmationScope === "clinic" ? "Usable locally (at that clinic)" : "Usable at every clinic"}>
        <select disabled={!editable} value={pol.singleConfirmationScope} onChange={(e) => set({ singleConfirmationScope: e.target.value as Policy["singleConfirmationScope"] }, `One confirmation → usable ${e.target.value === "clinic" ? "locally" : "organization-wide"}`)} data-testid="pol-scope">
          <option value="clinic">at that clinic only</option><option value="organization">at every clinic</option>
        </select>
      </Rule>
      <Rule when={`${pol.orgTrustThreshold} independent clinic confirmations agree`} tone="good" then="Trusted organization-wide">
        <span className="og-stepper">
          <button disabled={!editable || pol.orgTrustThreshold <= 2} onClick={() => set({ orgTrustThreshold: pol.orgTrustThreshold - 1 }, `Org-wide trust threshold → ${pol.orgTrustThreshold - 1}`)}>−</button>
          <b data-testid="pol-threshold">{pol.orgTrustThreshold}</b>
          <button disabled={!editable || pol.orgTrustThreshold >= 5} onClick={() => set({ orgTrustThreshold: pol.orgTrustThreshold + 1 }, `Org-wide trust threshold → ${pol.orgTrustThreshold + 1}`)}>+</button>
          clinics
        </span>
      </Rule>
      <Rule when="A current confirmation conflicts with another" tone="bad" then="Review required before PHI transmission" locked="Silently picking a winner is exactly what this POC must not do." />
      <Rule when={`A confirmation is older than ${pol.reconfirmAfterDays} days`} tone="warn" then="Reconfirmation required">
        <select disabled={!editable} value={pol.reconfirmAfterDays} onChange={(e) => set({ reconfirmAfterDays: Number(e.target.value) }, `Reconfirm after ${e.target.value} days`)} data-testid="pol-reconfirm">
          {[30, 90, 180, 365, 730].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </Rule>
      <Rule when="The only fax is from CMS/NPPES" tone="muted" then={<>Provider appears in the directory<br />Confirmation required before PHI</>} locked="A registry listing is not an approved PHI destination." />

      <div className="og-indep">
        <h3>What counts as independent</h3>
        <ul>
          <li><b>Different clinics</b>, each recording its own observation → independent.</li>
          <li><b>The same clinic</b> confirming twice → one source.</li>
          <li><b>One corporate spreadsheet</b> imported into 10 clinics → one source, not 10 confirmations.</li>
          <li><b>Directory sites repeating NPPES</b> → NPPES, not extra sources.</li>
          <li><b>A clinic re-using another clinic's value</b> without a new call → history only, lineage points to the original.</li>
        </ul>
        <p className="og-small og-muted">Deterministic lineage rules. They cannot detect undeclared copying (e.g. a clinic that "called" but read the number off our screen).</p>
      </div>

      <div className="og-impact">
        <h3>Right now, from {CONTEXTS.find((c) => c.id === state.context)!.short}'s view</h3>
        <div className="og-impact-row">{(Object.keys(STATUS_LABEL) as Status[]).filter((s) => counts.get(s)).map((s) => <span key={s} className={`og-chip og-t-${TONE[s]}`}>{counts.get(s)} · {STATUS_LABEL[s]}</span>)}</div>
      </div>
      {state.policyLog.length > 0 && (
        <div className="og-impact">
          <h3>Policy changes</h3>
          <ul className="og-small">{state.policyLog.map((l, i) => <li key={i}>{fmtTime(l.at)} · {l.actor} · {l.change}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ── organization evidence log ───────────────────────────────────────────────────

function LogPage({ state, onOpen }: { state: DemoState; onOpen: (providerId: string) => void }) {
  const [all, setAll] = useState(false);
  const byId = new Map(state.log.map((o) => [o.id, o]));
  const rows = state.log.filter((o) => all || isOrgEvidence(o)).sort((x, y) => y.observedAt.localeCompare(x.observedAt) || y.seq - x.seq);
  return (
    <div className="og-page" data-testid="log">
      <div className="og-page-h">
        <h2>Evidence log · {ORG.name}</h2>
        <p className="og-muted">Every organization observation, newest first. Append-only: corrections are new rows.
          <label className="og-toggle" style={{ marginLeft: 12 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> include public registry rows</label></p>
      </div>
      <section className="og-history">
        <table>
          <thead><tr><th>When</th><th>Provider</th><th>Value</th><th>Source</th><th>Method</th><th>By</th><th>Independence key</th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>{fmtTime(o.observedAt)}</td>
                <td><a href="#/providers" onClick={(e) => { e.preventDefault(); onOpen(o.providerId); }}>{PROVIDERS.find((p) => p.id === o.providerId)?.name}</a></td>
                <td className="og-mono">{fmtFax(o.value)}</td>
                <td>{o.source}{o.sourceType === "corporate_import" ? ` → ${clinicShort(o.clinicId)}` : ""}</td>
                <td>{METHOD_LABEL[o.method]}</td>
                <td>{o.actor ?? "—"}</td>
                <td className="og-mono og-small">{independenceKey(o, byId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ── what we learned / what is (not) proven ──────────────────────────────────────

const CAN = [
  "Public data can seed provider candidates",
  "Organizations can import their trusted data",
  "Clinics can confirm or correct referral destinations",
  "Observations retain provenance and history",
  "Sibling clinics can reuse organizational knowledge",
  "Independent confirmations can be detected (declared lineage only)",
  "Conflicts can stop automatic trust",
  "Corporate policy can control promotion and use",
];
const NOT = [
  "Clinics will consistently contribute confirmations",
  "Shared knowledge materially reduces operational work",
  "Two confirmations guarantee correctness",
  "Commercial data would not provide a better seed",
  "Network knowledge stays current without active maintenance",
  "Cross-company sharing is desirable",
  "This eliminates PHI misdirection risk",
  "AI materially improves this system",
];

function AboutPage() {
  return (
    <div className="og-page" data-testid="about">
      <div className="og-learned">
        <div className="og-label">What we learned</div>
        <p>Public provider data is useful for discovering candidates, but <b>our experiment did not establish that automated research can reliably determine referral destinations</b>.</p>
        <p>This POC tests a different hypothesis: <b>can clinics reuse referral knowledge already verified inside their organization?</b></p>
        <a className="og-btn og-btn-ghost" href="/npi-list/experiment"><Icon name="external" /> Open the Provider Intelligence experiment (unchanged, NOT PROVEN)</a>
      </div>
      <div className="og-proof">
        <section className="og-can">
          <h3>What this POC can demonstrate</h3>
          <ul>{CAN.map((c) => <li key={c}><Icon name="check" /> {c}</li>)}</ul>
          <p className="og-small">Demonstrate = the mechanism exists and can be shown. Nothing here was measured with real clinics.</p>
        </section>
        <section className="og-not" data-testid="not-proven">
          <h3>What is NOT proven</h3>
          <ul>{NOT.map((c) => <li key={c}><Icon name="x" /> {c}</li>)}</ul>
        </section>
      </div>
      <div className="og-real">
        <section><h3>Real</h3><ul>
          <li>The 10 public candidates: names, addresses and NPPES fax numbers exactly as returned by CMS/NPPES in the recorded Sep 28 run; WA licences from WA DOH.</li>
          <li>The trust/merge rules: they run as written, deterministically, in your browser.</li>
        </ul></section>
        <section><h3>Simulated</h3><ul>
          <li>{ORG.name}, its clinics and staff; the "100 clinics" (2 exist).</li>
          <li>Dr. Avery Example and Dr. Morgan Sample, their NPPES records, directory copies and every 555 number.</li>
          <li>Phone calls, the corporate spreadsheet import, the demo clock and the referral send.</li>
          <li>The shared store: this browser's localStorage, not a server.</li>
        </ul></section>
        <section><h3>Future / not built</h3><ul>
          <li>Server-side multi-tenant store, authentication and audit.</li>
          <li>Real PMS / partner / commercial data imports.</li>
          <li>Reminders to reconfirm; measuring whether clinics contribute.</li>
          <li>AI-assisted investigation of conflicts (would be labelled, never the authority).</li>
        </ul></section>
      </div>
    </div>
  );
}
