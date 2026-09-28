// ── /npi-list/referral-demo — fake outbound referral workflow (SYNTHETIC POC) ──
// A personal proof of concept. Patient, clinical text, attachments, fax
// transport, webhook and inbound response are all fictional. The specialist
// search is the real provider-intelligence search from /npi-list. Nothing is
// ever sent to a provider. State lives in this browser session only.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui";
import Specialists from "./Specialists";
import { Audiogram, DocPreview } from "./Documents";
import {
  DEMO_CLINIC, SAMPLE_ATTACHMENTS, SCENARIOS, ageFrom, applyStep, createTransaction, draftReferral, faxPlan, pageCount, parseRecord, searchOrigin, simulateInbound, webhookFor,
  type Attachment, type Destination, type FaxOutcome, type FaxTransaction, type FaxWebhook, type InboundFax, type ReferralDraft, type Scenario, type ScenarioId,
} from "./model";
import "./demo.css";

type Step = "patient" | "intent" | "search" | "prepare" | "review" | "send" | "timeline";

const STEPPER: { label: string; steps: Step[] }[] = [
  { label: "Patient", steps: ["patient", "intent"] },
  { label: "Specialist", steps: ["search"] },
  { label: "Referral", steps: ["prepare"] },
  { label: "Review", steps: ["review"] },
  { label: "Sent", steps: ["send", "timeline"] },
];

const SPECIALTY_CHOICES = [
  { value: "ENT / Otolaryngology", note: "Polished demo path · saved research for Seattle" },
  { value: "Otology & Neurotology", note: "Live search" },
  { value: "Neurology", note: "Live search" },
  { value: "Allergy & Immunology", note: "Live search" },
];

interface State {
  step: Step;
  scenarioId: ScenarioId;
  record: string;
  attachments: Attachment[]; // available (sample + local uploads)
  specialty: string;
  location: string;
  radius: number;
  found: number | null;
  destination: Destination | null;
  draft: ReferralDraft | null;
  reviewed: boolean;
  outcome: FaxOutcome;
  tx: FaxTransaction | null;
  webhook: FaxWebhook | null;
  failed: FaxTransaction[]; // earlier failed fake faxes
  flagged: string[];
  inbound: InboundFax | null;
  times: Partial<Record<"started" | "searched" | "selected" | "prepared" | "reviewed", string>>;
}

const KEY = "npi-referral-demo:v1";
const LOG = "npi-referral-demo:fax-log";

function fresh(id: ScenarioId = "A"): State {
  const s = SCENARIOS.find((x) => x.id === id)!;
  return {
    step: "patient", scenarioId: id, record: s.record, attachments: s.attachments.map((a) => SAMPLE_ATTACHMENTS[a]),
    specialty: s.specialty, location: searchOrigin(parseRecord(s.record).location), radius: 10, found: null,
    destination: null, draft: null, reviewed: false, outcome: "deliver", tx: null, webhook: null, failed: [], flagged: [], inbound: null,
    times: { started: new Date().toISOString() },
  };
}

function load(): State {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      // A fake fax interrupted by a reload can't resume; go back to review.
      if (s.step === "send" && s.tx && s.tx.status !== "delivered" && s.tx.status !== "failed") return { ...s, step: "review", tx: null };
      return s;
    }
  } catch { /* fall through */ }
  return fresh();
}

const now = () => new Date().toISOString();
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");

export default function ReferralDemo() {
  const [st, setSt] = useState<State>(load);
  const [about, setAbout] = useState(false);
  const set = (patch: Partial<State> | ((s: State) => Partial<State>)) => setSt((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }));
  const go = (step: Step, patch: Partial<State> = {}) => { set({ ...patch, step }); window.scrollTo({ top: 0 }); };

  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch { /* best-effort */ } }, [st]);

  const scenario = SCENARIOS.find((s) => s.id === st.scenarioId)!;
  const patient = useMemo(() => parseRecord(st.record), [st.record]);
  const age = ageFrom(patient.dob);
  const stepIdx = STEPPER.findIndex((g) => g.steps.includes(st.step));
  const sent = stepIdx === STEPPER.length - 1;

  return (
    <div className="pi rd">
      <header className="rd-top">
        <a className="pi-brand" href="/npi-list/referral-demo" onClick={(e) => { e.preventDefault(); if (sent) setSt(fresh()); else go("patient"); }}>
          <span className="pi-logo rd-logo"><Icon name="fax" /></span>
          <span>AI Referral Workflow</span>
        </a>
        <span className="rd-poc">Synthetic POC</span>
        <nav className="rd-stepper" aria-label="Progress">
          {STEPPER.map((g, i) => {
            const target = g.steps[0];
            const can = i < stepIdx && !sent;
            return (
              <button key={g.label} className={`rd-stp ${i < stepIdx ? "rd-stp-done" : i === stepIdx ? "rd-stp-now" : ""}`} disabled={!can} onClick={() => can && go(target)}>
                <span className="rd-stp-dot">{i < stepIdx ? <Icon name="check" size={11} /> : i + 1}</span>{g.label}
              </button>
            );
          })}
        </nav>
        <div className="rd-top-links">
          <button className="pi-link" onClick={() => setAbout(true)}>About this POC</button>
          <a href="/npi-list/opportunity">Why explore this? →</a>
        </div>
      </header>
      <div className="rd-banner"><Icon name="shield" size={14} /> <strong>SYNTHETIC DEMO DATA</strong> — fictional patients, no real patient information. Fax sending is simulated; nothing is sent to any provider.</div>

      <main className="rd-main">
        {st.step === "patient" && (
          <PatientStep
            st={st}
            scenario={scenario}
            onScenario={(id) => set({ ...fresh(id), times: st.times })}
            onRecord={(record) => set({ record })}
            onAttachments={(attachments) => set({ attachments })}
            onNext={() => go("intent", { location: searchOrigin(patient.location) })}
          />
        )}
        {st.step === "intent" && (
          <IntentStep st={st} scenario={scenario} patientName={patient.name} set={set} onBack={() => go("patient")} onNext={() => go("search", { destination: null })} />
        )}
        {st.step === "search" && (
          <section>
            <StepHead kicker="Step 3 · Find a specialist" title={`Where should ${patient.name || "this patient"}'s referral go?`} sub="Real specialists near the patient's area, ranked by how well the evidence supports sending a referral fax there." onBack={() => go("intent")} />
            <Specialists
              specialty={st.specialty}
              location={st.location}
              radius={st.radius}
              age={age}
              flagged={st.flagged}
              onRadius={(radius) => set({ radius })}
              onSearched={(found) => set((s) => ({ found, times: { ...s.times, searched: now() } }))}
              onChoose={(destination) => go("prepare", { destination, draft: draftReferral(patient, scenario, destination), reviewed: false, times: { ...st.times, selected: now() } })}
            />
          </section>
        )}
        {st.step === "prepare" && st.destination && st.draft && (
          <PrepareStep st={st} patient={patient} scenario={scenario} set={set} onBack={() => go("search")} onNext={() => go("review", { times: { ...st.times, prepared: now() } })} />
        )}
        {st.step === "review" && st.destination && st.draft && (
          <ReviewStep st={st} patient={patient} set={set} onBack={() => go("prepare")}
            onSend={() => {
              const atts = st.attachments.filter((a) => st.draft!.attachmentIds.includes(a.id));
              const tx = createTransaction({ patient, destination: st.destination!, pages: pageCount(atts), outcome: st.outcome });
              go("send", { tx, webhook: null, times: { ...st.times, reviewed: now() } });
            }}
          />
        )}
        {st.step === "send" && st.tx && (
          <SendStep
            st={st}
            set={set}
            onRetry={() => {
              const tx = createTransaction({ patient, destination: st.destination!, pages: st.tx!.pages, outcome: "deliver" });
              set((s) => ({ failed: [...s.failed, s.tx!], tx, webhook: null }));
            }}
            onAlternate={() => go("search", { failed: [...st.failed, st.tx!], tx: null, webhook: null, flagged: [...st.flagged, `${st.destination!.npi}|${st.destination!.fax.replace(/\D/g, "")}`] })}
            onTimeline={() => go("timeline")}
          />
        )}
        {st.step === "timeline" && st.tx && (
          <TimelineStep st={st} patient={patient} scenario={scenario}
            onRespond={() => set({ inbound: simulateInbound(st.tx!, scenario) })}
            onRestart={() => { setSt(fresh()); window.scrollTo({ top: 0 }); }}
          />
        )}
      </main>

      {about && <About onClose={() => setAbout(false)} />}
      <footer className="pi-foot rd-foot">
        Personal proof of concept — not production software, not an approved company workflow, and not HIPAA- or compliance-ready. Synthetic patients only. Provider data is real public data (CMS NPPES, Washington DOH, US Census geocoder, open-web research). <a href="/npi-list">Provider search</a> · <a href="/npi-list/opportunity">Why explore this?</a>
      </footer>
    </div>
  );
}

function StepHead({ kicker, title, sub, onBack }: { kicker: string; title: string; sub?: string; onBack?: () => void }) {
  return (
    <div className="rd-head">
      {onBack && <button className="pi-back" onClick={onBack}><Icon name="back" /> Back</button>}
      <div className="rd-kicker">{kicker}</div>
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </div>
  );
}

// ── Step 1 · Patient ─────────────────────────────────────────────────────────

function PatientStep({ st, scenario, onScenario, onRecord, onAttachments, onNext }: {
  st: State; scenario: Scenario; onScenario: (id: ScenarioId) => void; onRecord: (r: string) => void; onAttachments: (a: Attachment[]) => void; onNext: () => void;
}) {
  const [editing, setEditing] = useState(st.scenarioId === "E");
  const [preview, setPreview] = useState<Attachment | null>(null);
  const patient = parseRecord(st.record);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <section>
      <StepHead kicker="Step 1 · Patient" title="Who are we referring?" sub="The audiology assessment is done and a specialist referral is recommended. Pick a fictional patient to begin." />
      <div className="rd-scenarios">
        {SCENARIOS.map((s) => (
          <button key={s.id} className={`rd-scn ${s.id === st.scenarioId ? "rd-scn-on" : ""}`} onClick={() => { onScenario(s.id); setEditing(s.id === "E"); }}>
            <span className="rd-scn-id">{s.id}</span>
            <span className="rd-scn-title">{s.title}</span>
            <span className="rd-scn-pt">{s.patient}{s.priority === "Urgent" && <em className="rd-urgent">Urgent</em>}</span>
            <span className="rd-scn-blurb">{s.blurb}</span>
          </button>
        ))}
      </div>
      <p className="rd-fine">Demo scenarios only — not clinical recommendations.</p>

      <div className="rd-two">
        <div className="rd-card rd-patient">
          <div className="rd-card-head">
            <div className="rd-pt-id">
              <div className="rd-pt-avatar"><Icon name="user" /></div>
              <div>
                <div className="rd-pt-name">{patient.name || "Unnamed synthetic patient"} <span className="rd-synth-tag">Synthetic</span></div>
                <div className="pi-muted">DOB {patient.dob || "—"} · {patient.location || "—"} · {patient.insurance || "—"}</div>
              </div>
            </div>
            <button className="pi-btn" onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit record"}</button>
          </div>
          {editing ? (
            <>
              <textarea className="rd-record" value={st.record} onChange={(e) => onRecord(e.target.value)} rows={20} spellCheck={false} aria-label="Synthetic patient record" />
              <div className="rd-warn-line"><Icon name="alert" size={13} /> Synthetic data only — do not enter real patient information.</div>
            </>
          ) : (
            <div className="rd-pt-body">
              <div className="rd-pt-sec"><span>Audiology findings</span><p>{patient.audiology || "—"}</p></div>
              <div className="rd-pt-sec"><span>Relevant history</span><p>{patient.history || "—"}</p></div>
              <div className="rd-pt-sec rd-pt-reason"><span>Why are we referring?</span><p>{patient.reason || "—"}</p></div>
              {patient.notes && <div className="rd-pt-sec"><span>Notes</span><p>{patient.notes}</p></div>}
            </div>
          )}
        </div>

        <aside className="rd-rail">
          {scenario.attachments.includes("audiogram") && (
            <div className="rd-card rd-mini-audio" onClick={() => setPreview(SAMPLE_ATTACHMENTS.audiogram)} role="button">
              <div className="rd-card-label">Audiogram <span className="rd-synth-tag">Synthetic</span></div>
              <Audiogram scenario={scenario} small />
              <div className="rd-legend"><span className="rd-key-r">○ Right</span><span className="rd-key-l">✕ Left</span></div>
            </div>
          )}
          <div className="rd-card">
            <div className="rd-card-label">Attachments</div>
            <ul className="rd-atts">
              {st.attachments.map((a) => (
                <li key={a.id}>
                  <Icon name="registry" size={14} />
                  <button className="pi-link" onClick={() => setPreview(a)}>{a.name}</button>
                  <span className="pi-muted">{a.kind === "upload" ? "local file" : `${a.pages} p · sample`}</span>
                  {a.kind === "upload" && <button className="rd-x-sm" onClick={() => onAttachments(st.attachments.filter((x) => x.id !== a.id))} aria-label="Remove"><Icon name="x" size={12} /></button>}
                </li>
              ))}
            </ul>
            <input ref={fileRef} type="file" hidden accept=".pdf,image/*" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onAttachments([...st.attachments, { id: `upload-${Date.now()}`, name: f.name, label: f.name, pages: 1, kind: "upload", size: f.size }]);
              e.target.value = "";
            }} />
            <button className="pi-btn rd-attach" onClick={() => fileRef.current?.click()}><Icon name="link" size={14} /> Attach a local demo file</button>
            <div className="rd-warn-line"><Icon name="alert" size={13} /> Demo only — do not upload real patient information. Only the file name is kept, for this session.</div>
          </div>
        </aside>
      </div>

      <div className="rd-cta">
        <button className="pi-btn pi-btn-primary pi-btn-lg" disabled={!patient.name} onClick={onNext}>Continue <Icon name="chevron" /></button>
      </div>
      {preview && <DocPreview att={preview} scenario={scenario} patient={patient} onClose={() => setPreview(null)} />}
    </section>
  );
}

// ── Step 2 · Why are we referring? ──────────────────────────────────────────

function IntentStep({ st, scenario, patientName, set, onBack, onNext }: { st: State; scenario: Scenario; patientName: string; set: (p: Partial<State>) => void; onBack: () => void; onNext: () => void }) {
  return (
    <section className="rd-narrow">
      <StepHead kicker="Step 2 · Referral intent" title="What kind of specialist are you referring to?" sub={`${patientName} · ${scenario.title}${scenario.priority === "Urgent" ? " · Urgent" : ""}`} onBack={onBack} />
      <div className="rd-specs">
        {SPECIALTY_CHOICES.map((c) => (
          <button key={c.value} className={`rd-spec ${st.specialty === c.value ? "rd-spec-on" : ""}`} onClick={() => set({ specialty: c.value })}>
            <span className="rd-spec-radio" />
            <span><strong>{c.value}</strong><span className="pi-muted">{c.note}</span></span>
          </button>
        ))}
      </div>
      <div className="rd-card rd-where">
        <label>
          <span>Near</span>
          <input value={st.location} onChange={(e) => set({ location: e.target.value })} aria-label="Location" />
          <em>From the synthetic patient's address</em>
        </label>
        <div>
          <span>Within</span>
          <div className="rd-radius" role="group" aria-label="Radius">
            {[5, 10, 25, 50].map((r) => <button key={r} className={r === st.radius ? "rd-on" : ""} onClick={() => set({ radius: r })}>{r} miles</button>)}
          </div>
        </div>
      </div>
      <div className="rd-boundary">
        <div><span className="rd-pill-fake">Fictional</span> the patient and why they're being referred</div>
        <Icon name="chevron" />
        <div><span className="rd-pill-real">Real</span> the specialist search that comes next</div>
      </div>
      <div className="rd-cta">
        <button className="pi-btn pi-btn-primary pi-btn-lg" disabled={!st.location.trim()} onClick={onNext}><Icon name="search" /> Find {st.specialty.split(" / ")[0]} specialists</button>
      </div>
    </section>
  );
}

// ── Step 4 · Prepare referral ───────────────────────────────────────────────

function PrepareStep({ st, patient, scenario, set, onBack, onNext }: { st: State; patient: ReturnType<typeof parseRecord>; scenario: Scenario; set: (p: Partial<State>) => void; onBack: () => void; onNext: () => void }) {
  const d = st.destination!;
  const draft = st.draft!;
  const edit = (p: Partial<ReferralDraft>) => set({ draft: { ...draft, ...p } });
  const toggle = (id: string) => edit({ attachmentIds: draft.attachmentIds.includes(id) ? draft.attachmentIds.filter((x) => x !== id) : [...draft.attachmentIds, id] });
  const atts = st.attachments.filter((a) => draft.attachmentIds.includes(a.id));

  return (
    <section>
      <StepHead kicker="Step 4 · Prepare referral" title="Here's the referral, ready for your edits" sub="Drafted automatically from the synthetic record and the destination you chose. Change anything — nothing goes anywhere until you approve it." onBack={onBack} />
      <div className="rd-two">
        <div className="rd-doc">
          <div className="rd-doc-top">
            <div>
              <div className="rd-doc-kind">Outbound referral</div>
              <div className="pi-muted">{DEMO_CLINIC.name} · {DEMO_CLINIC.audiologist}</div>
            </div>
            <div className="rd-prio" role="group" aria-label="Priority">
              {(["Routine", "Urgent"] as const).map((p) => <button key={p} className={draft.priority === p ? `rd-on rd-prio-${p.toLowerCase()}` : ""} onClick={() => edit({ priority: p })}>{p}</button>)}
            </div>
          </div>
          <div className="rd-doc-grid">
            <div className="rd-doc-block">
              <span>Patient <em className="rd-synth-tag">Synthetic</em></span>
              <strong>{patient.name}</strong>
              <div>DOB {patient.dob}</div>
              <div>{patient.insurance}{patient.memberId && ` · ${patient.memberId}`}</div>
            </div>
            <div className="rd-doc-block">
              <span>Referred to <em className="rd-real-tag">Real destination</em></span>
              <strong>{d.provider}</strong>
              <div>{d.specialty}</div>
              <div>{d.practice}</div>
              <div className="pi-muted">{d.address}</div>
            </div>
          </div>
          <label className="rd-field"><span>Reason for referral</span><input value={draft.reason} onChange={(e) => edit({ reason: e.target.value })} /></label>
          <label className="rd-field"><span>Relevant information</span><textarea rows={6} value={draft.clinical} onChange={(e) => edit({ clinical: e.target.value })} /></label>
          <label className="rd-field"><span>Request</span><input value={draft.question} onChange={(e) => edit({ question: e.target.value })} /></label>
          <label className="rd-field"><span>Fax cover note</span><textarea rows={3} value={draft.coverNote} onChange={(e) => edit({ coverNote: e.target.value })} /></label>
          <div className="rd-field">
            <span>Attachments</span>
            <div className="rd-att-pick">
              {st.attachments.map((a) => (
                <label key={a.id} className={draft.attachmentIds.includes(a.id) ? "rd-on" : ""}>
                  <input type="checkbox" checked={draft.attachmentIds.includes(a.id)} onChange={() => toggle(a.id)} />
                  <Icon name={draft.attachmentIds.includes(a.id) ? "check" : "registry"} size={13} /> {a.label} <span className="pi-muted">{a.pages} p</span>
                </label>
              ))}
            </div>
          </div>
          <div className="rd-doc-foot">{pageCount(atts)} pages including cover sheet and referral letter · {scenario.title}</div>
        </div>

        <aside className="rd-rail">
          <DestinationSummary d={d} />
          <div className="rd-card rd-control">
            <Icon name="user" /> <div><strong>You stay in control.</strong> The workflow proposes the destination and the letter; you edit and approve before anything is sent.</div>
          </div>
        </aside>
      </div>
      <div className="rd-cta">
        <button className="pi-btn pi-btn-primary pi-btn-lg" disabled={!draft.reason.trim()} onClick={onNext}>Review referral <Icon name="chevron" /></button>
      </div>
    </section>
  );
}

function DestinationSummary({ d }: { d: Destination }) {
  return (
    <div className="rd-card rd-dest">
      <div className="rd-card-label">Destination</div>
      <div className="rd-dest-fax">
        <span>{d.faxKind === "referral" ? "Referral fax" : "Fax"}</span>
        <strong className="pi-mono">{d.fax}</strong>
      </div>
      <div className="rd-dest-row"><span>Referral confidence</span><strong className={`rd-tone-${d.referralScore >= 80 ? "good" : d.referralScore >= 60 ? "ok" : "low"}`}>{d.referralScore}%</strong></div>
      <div className="rd-dest-row"><span>Provider confidence</span><strong>{d.providerScore}%</strong></div>
      {d.distanceMi !== null && <div className="rd-dest-row"><span>Distance</span><strong>{d.distanceMi} mi</strong></div>}
      {d.phone && <div className="rd-dest-row"><span>Phone</span><strong className="pi-mono">{d.phone}</strong></div>}
      <div className={`rd-dest-note ${d.faxChecked ? "rd-good" : "rd-caution"}`}>
        <Icon name={d.faxChecked ? "check" : "alert"} size={13} />
        {d.faxChecked
          ? <>Labelled as a referral fax on {d.faxSources[0]?.domain ?? "the source page"}, and the wording was checked on the live page.</>
          : <>This is the location's fax, but no source says it's the referral intake fax. In real use you'd call to confirm.</>}
      </div>
    </div>
  );
}

// ── Step 5 · Review ─────────────────────────────────────────────────────────

function ReviewStep({ st, patient, set, onBack, onSend }: { st: State; patient: ReturnType<typeof parseRecord>; set: (p: Partial<State>) => void; onBack: () => void; onSend: () => void }) {
  const d = st.destination!;
  const draft = st.draft!;
  const has = (id: string) => draft.attachmentIds.includes(id) && st.attachments.some((a) => a.id === id);
  const atts = st.attachments.filter((a) => draft.attachmentIds.includes(a.id));
  const rows: { ok: boolean | "warn"; label: string; value: string }[] = [
    { ok: Boolean(patient.name && patient.dob), label: "Patient", value: `${patient.name} · DOB ${patient.dob}` },
    { ok: Boolean(draft.reason.trim()), label: "Referral reason", value: draft.reason },
    { ok: true, label: "Destination", value: `${d.provider} · ${d.practice}` },
    { ok: d.faxChecked ? true : "warn", label: d.faxKind === "referral" ? "Referral fax" : "Fax", value: `${d.fax}${d.faxChecked ? " · referral label checked on source page" : " · not confirmed as the referral intake fax"}` },
    { ok: has("audiogram") ? true : "warn", label: "Audiogram attached", value: has("audiogram") ? "audiogram.pdf" : "Not attached" },
    { ok: has("report") ? true : "warn", label: "Audiology report attached", value: has("report") ? "audiology-report.pdf" : "Not attached" },
    { ok: has("insurance") ? true : "warn", label: "Insurance attached", value: has("insurance") ? "insurance-card.pdf" : "Not attached" },
  ];
  return (
    <section className="rd-narrow">
      <StepHead kicker="Step 5 · Review" title="Ready to send" sub={`${draft.priority} referral · ${pageCount(atts)} pages · to ${d.practice}`} onBack={onBack} />
      <div className="rd-synth-big"><Icon name="shield" /> SYNTHETIC DEMO — NO REAL PATIENT INFORMATION</div>
      <div className="rd-card rd-checklist">
        {rows.map((r) => (
          <div key={r.label} className={`rd-chk ${r.ok === true ? "rd-chk-ok" : "rd-chk-warn"}`}>
            <span className="rd-chk-icon"><Icon name={r.ok === true ? "check" : "alert"} size={14} /></span>
            <span className="rd-chk-label">{r.label}</span>
            <span className="rd-chk-val">{r.value}</span>
          </div>
        ))}
      </div>
      <label className="rd-approve">
        <input type="checkbox" checked={st.reviewed} onChange={(e) => set({ reviewed: e.target.checked })} />
        <span>I've reviewed this referral and approve sending it.</span>
      </label>
      <details className="rd-democtl">
        <summary>Demo controls</summary>
        <div className="rd-democtl-body">
          <span>Simulated outcome</span>
          <div className="rd-radius">
            <button className={st.outcome === "deliver" ? "rd-on" : ""} onClick={() => set({ outcome: "deliver" })}>Delivered</button>
            <button className={st.outcome === "fail" ? "rd-on" : ""} onClick={() => set({ outcome: "fail" })}>Delivery fails</button>
          </div>
        </div>
      </details>
      <div className="rd-cta rd-cta-col">
        <button className="pi-btn pi-btn-primary pi-btn-lg rd-send" disabled={!st.reviewed} onClick={onSend}><Icon name="fax" /> Send fake fax</button>
        <div className="pi-muted">Fax transport is simulated. Nothing is sent to {d.practice}.</div>
      </div>
    </section>
  );
}

// ── Step 6/7 · Fake fax + simulated webhook ─────────────────────────────────

function SendStep({ st, set, onRetry, onAlternate, onTimeline }: { st: State; set: (p: Partial<State> | ((s: State) => Partial<State>)) => void; onRetry: () => void; onAlternate: () => void; onTimeline: () => void }) {
  const tx = st.tx!;
  const d = tx.destination;
  const [verify, setVerify] = useState(false);
  const plan = useMemo(() => faxPlan(tx.outcome, tx.pages, d.fax), [tx.id, tx.outcome, tx.pages, d.fax]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = tx.status === "delivered" || tx.status === "failed";

  // Play the plan back with small delays. The "webhook" arrives when it ends.
  useEffect(() => {
    if (done) return;
    let i = tx.events.length;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const step = plan[i++];
      if (!step) return;
      set((s) => (s.tx?.id === tx.id ? { tx: applyStep(s.tx, step) } : {}));
      if (step.stage !== "delivered" && step.stage !== "failed") timer = setTimeout(tick, step.ms);
      else timer = setTimeout(() => set((s) => (s.tx?.id === tx.id ? { webhook: webhookFor(s.tx) } : {})), 700);
    };
    timer = setTimeout(tick, 300);
    return () => clearTimeout(timer);
  }, [tx.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a small local log of finished fake faxes (this browser only).
  useEffect(() => {
    if (!done) return;
    try {
      const log = (JSON.parse(localStorage.getItem(LOG) ?? "[]") as FaxTransaction[]).filter((t) => t.id !== tx.id);
      localStorage.setItem(LOG, JSON.stringify([...log.slice(-19), tx]));
    } catch { /* best-effort */ }
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = tx.events[tx.events.length - 1];
  const sendingPage = tx.status === "sending" ? plan.find((p) => p.detail === last?.detail)?.page ?? 0 : tx.status === "delivered" ? tx.pages : 0;
  const milestones: { stage: FaxTransaction["status"]; label: string }[] = [
    { stage: "preparing", label: "Preparing packet" }, { stage: "queued", label: "Queued" }, { stage: "dialing", label: "Dialing" },
    { stage: "sending", label: "Sending" }, { stage: tx.outcome === "fail" ? "failed" : "delivered", label: tx.outcome === "fail" ? "Failed" : "Delivered" },
  ];
  const reached = (m: FaxTransaction["status"]) => tx.events.some((e) => e.stage === m);

  return (
    <section className="rd-narrow">
      <div className="rd-head">
        <div className="rd-kicker">Step 6 · Send fax <span className="rd-sim-tag">Simulated transport</span></div>
        <h1>{tx.status === "delivered" ? "Delivered" : tx.status === "failed" ? "Fax failed" : "Sending referral…"}</h1>
        <p>To {d.practice} · <span className="pi-mono">{d.fax}</span> · {tx.pages} pages · <span className="pi-mono">{tx.id}</span></p>
      </div>

      <div className={`rd-card rd-fax rd-fax-${tx.status}`}>
        <ol className="rd-fax-steps">
          {milestones.filter((m) => !(tx.outcome === "fail" && m.stage === "sending")).map((m) => {
            const isNow = tx.status === m.stage && !done;
            const ok = reached(m.stage);
            return (
              <li key={m.stage} className={`${ok ? "rd-done" : ""} ${isNow ? "rd-now" : ""} ${m.stage === "failed" && ok ? "rd-bad" : ""}`}>
                <span className="rd-fax-dot">{isNow ? <span className="pi-spinner" /> : ok ? <Icon name={m.stage === "failed" ? "x" : "check"} size={13} /> : null}</span>
                {m.label}
              </li>
            );
          })}
        </ol>
        {tx.outcome === "deliver" && <div className="rd-bar"><div style={{ width: `${(sendingPage / tx.pages) * 100}%` }} /></div>}
        <div className="rd-fax-now">{last ? <><strong>{last.label}</strong> — {last.detail}</> : "Starting…"}</div>
      </div>

      {st.webhook && <WebhookCard hook={st.webhook} />}

      {tx.status === "failed" && st.webhook && (
        <div className="rd-card rd-fail">
          <div className="rd-fail-title"><Icon name="alert" /> What next?</div>
          <div className="rd-fail-actions">
            <button className="pi-btn" onClick={() => onRetry()}><Icon name="refresh" /> Retry</button>
            <button className="pi-btn" onClick={() => setVerify(!verify)}><Icon name="phone" /> Verify fax</button>
            <button className="pi-btn pi-btn-primary" onClick={onAlternate}><Icon name="search" /> Find alternate destination</button>
          </div>
          {verify && (
            <div className="rd-verify">
              <div><strong>Why we trusted {d.fax}:</strong> {d.faxLabel ? <>the source labels it “{d.faxLabel}”</> : "found for this location"}{d.faxSources.length ? <> on {d.faxSources.map((s, i) => <span key={s.url}>{i ? ", " : ""}<a href={s.url} target="_blank" rel="noreferrer">{s.domain}</a></span>)}</> : " in the NPI record"}{d.faxChecked ? ", and the referral wording was checked on the live page." : "."}</div>
              <div>In real use: call the practice{d.phone ? <> at <span className="pi-mono">{d.phone}</span></> : null} to confirm the referral fax, then retry.</div>
              <button className="pi-btn" onClick={() => onRetry()}><Icon name="check" /> Confirmed by phone (simulated) — retry</button>
            </div>
          )}
          <div className="rd-loop">
            <span>Fax failed</span><Icon name="chevron" size={13} />
            <span>destination becomes less trustworthy</span><Icon name="chevron" size={13} />
            <span>verify</span><Icon name="chevron" size={13} />
            <span>find an alternate</span>
          </div>
          <div className="pi-muted rd-fine">This illustrates a future feedback loop. Simulated events never change the real provider confidence scores; the destination is only flagged in this browser session.</div>
        </div>
      )}

      {tx.status === "delivered" && st.webhook && (
        <div className="rd-cta">
          <button className="pi-btn pi-btn-primary pi-btn-lg" onClick={onTimeline}>View referral timeline <Icon name="chevron" /></button>
        </div>
      )}
    </section>
  );
}

function WebhookCard({ hook }: { hook: FaxWebhook }) {
  const ok = hook.status === "Delivered";
  return (
    <div className={`rd-card rd-hook ${ok ? "rd-hook-ok" : "rd-hook-bad"}`}>
      <div className="rd-hook-head">
        <span className="rd-sim-tag">Simulated fax-provider event</span>
        <span className="pi-mono pi-muted">{hook.endpoint}</span>
      </div>
      <div className="rd-hook-title">{ok ? "OUTBOUND FAX DELIVERED" : "OUTBOUND FAX FAILED"}</div>
      <dl className="rd-hook-grid">
        <dt>Provider</dt><dd>{hook.provider}</dd>
        <dt>Destination</dt><dd>{hook.destination}</dd>
        <dt>Fax</dt><dd className="pi-mono">{hook.fax}</dd>
        <dt>Pages</dt><dd>{hook.pages}</dd>
        <dt>Status</dt><dd className={ok ? "pi-good" : "pi-bad"}>{hook.status}{hook.errorCode && ` · ${hook.errorCode}`}</dd>
        <dt>Transaction</dt><dd className="pi-mono">{hook.transactionId}</dd>
      </dl>
      <details className="rd-raw"><summary>Event payload</summary><pre>{JSON.stringify(hook, null, 2)}</pre></details>
      <div className="pi-muted rd-fine">This is the seam where a real fax provider's delivery webhook would plug in. No provider is integrated.</div>
    </div>
  );
}

// ── Step 8 · Referral timeline (+ simulated inbound response) ──────────────

function TimelineStep({ st, patient, scenario, onRespond, onRestart }: { st: State; patient: ReturnType<typeof parseRecord>; scenario: Scenario; onRespond: () => void; onRestart: () => void }) {
  const tx = st.tx!;
  const d = tx.destination;
  const draft = st.draft!;
  const attLabels = st.attachments.filter((a) => draft.attachmentIds.includes(a.id)).map((a) => a.label.replace(" information", ""));
  const inbound = st.inbound;
  const items: { at?: string | null; title: string; detail: React.ReactNode; tone?: "bad" | "sim" | "real" | "ai" }[] = [
    { at: st.times.started, title: "Audiology assessment", detail: `${scenario.title} · referral recommended` },
    { at: st.times.searched, title: "Specialist search", detail: `${st.found ?? "—"} ${st.specialty.split(" / ")[0]} destinations found within ${st.radius} miles`, tone: "real" },
    { at: st.times.selected, title: "Destination selected", detail: `${d.provider} — ${d.practice} · referral confidence ${d.referralScore}%`, tone: "real" },
    { at: st.times.prepared, title: "Referral prepared", detail: attLabels.length ? `${attLabels.join(" + ")} attached` : "No attachments" },
    { at: st.times.reviewed, title: "Human reviewed", detail: "Referral approved by the audiologist" },
    ...st.failed.map((f) => ({ at: f.completedAt, title: "Fax failed", detail: `${f.id} · ${f.destination.practice} · no answer`, tone: "bad" as const })),
    { at: tx.createdAt, title: "Fax sent", detail: <span className="pi-mono">{tx.id}</span>, tone: "sim" },
    { at: tx.completedAt, title: "Fax delivered", detail: `${tx.pages} pages · simulated provider confirmation`, tone: "sim" },
  ];
  if (inbound) items.push({ at: inbound.receivedAt, title: "Response received", detail: `Appointment scheduled · ${fmtAppt(inbound.appointment)}`, tone: "ai" });

  return (
    <section className="rd-narrow">
      <div className="rd-tl-head">
        <div>
          <div className="rd-kicker">Referral timeline</div>
          <h1>{patient.name}</h1>
          <p>{st.specialty.split(" / ")[0]} referral · {d.provider} · <span className="pi-mono">{tx.id}</span></p>
        </div>
        <span className={`rd-status ${inbound ? "rd-status-good" : "rd-status-wait"}`}>{inbound ? "Appointment scheduled" : "Waiting for response"}</span>
      </div>

      <ol className="rd-tl">
        {items.map((it, i) => (
          <li key={i} className={`rd-tl-item ${it.tone ? `rd-tl-${it.tone}` : ""}`}>
            <span className="rd-tl-dot" />
            <div className="rd-tl-body">
              <div className="rd-tl-title">{it.title}{it.tone === "real" && <em className="rd-real-tag">Real data</em>}{it.tone === "sim" && <em className="rd-sim-tag">Simulated</em>}{it.tone === "ai" && <em className="rd-sim-tag">Simulated AI</em>}</div>
              <div className="rd-tl-detail">{it.detail}</div>
            </div>
            <span className="rd-tl-time">{time(it.at)}</span>
          </li>
        ))}
        {!inbound && (
          <li className="rd-tl-item rd-tl-wait">
            <span className="rd-tl-dot" />
            <div className="rd-tl-body"><div className="rd-tl-title">Waiting for response</div><div className="rd-tl-detail">The specialist's office usually replies by fax.</div></div>
          </li>
        )}
      </ol>

      {!inbound ? (
        <div className="rd-cta"><button className="pi-btn pi-btn-primary pi-btn-lg" onClick={onRespond}><Icon name="fax" /> Simulate response from specialist</button></div>
      ) : (
        <InboundCard f={inbound} />
      )}

      <div className="rd-end">
        <button className="pi-btn" onClick={onRestart}><Icon name="refresh" /> Start another referral</button>
        <a className="pi-btn" href="/npi-list/opportunity">Why explore this? →</a>
      </div>
    </section>
  );
}

const fmtAppt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function InboundCard({ f }: { f: InboundFax }) {
  return (
    <div className="rd-card rd-inbound">
      <div className="rd-hook-head"><span className="rd-sim-tag">Simulated inbound fax · simulated AI reading</span><span className="pi-mono pi-muted">{f.id}</span></div>
      <div className="rd-hook-title">NEW FAX RECEIVED</div>
      <dl className="rd-hook-grid">
        <dt>From</dt><dd>{f.from}</dd>
        <dt>Pages</dt><dd>{f.pages}</dd>
        <dt>Classification</dt><dd>{f.classification} <span className="pi-muted">· {f.classificationConfidence}%</span></dd>
        <dt>Matched patient</dt><dd>{f.matchedPatient} <span className="pi-muted">· by {f.matchBasis.join(", ")}</span></dd>
        <dt>Matched referral</dt><dd>{f.matchedReferral}</dd>
        <dt>Extracted status</dt><dd className="pi-good"><strong>{f.extractedStatus}</strong> · {fmtAppt(f.appointment)} with {f.appointmentWith}</dd>
        <dt>Confidence</dt><dd>{f.confidence}%</dd>
      </dl>
      <div className="pi-muted rd-fine">Entirely simulated — no fax was received and no model read anything. This shows what an inbound AI step could feel like.</div>
    </div>
  );
}

// ── About this POC ──────────────────────────────────────────────────────────

function About({ onClose }: { onClose: () => void }) {
  return (
    <div className="rd-modal" onClick={onClose}>
      <div className="rd-sheet rd-about" onClick={(e) => e.stopPropagation()}>
        <div className="rd-sheet-head"><span>About this POC</span><button className="rd-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <p>A personal technical experiment asking: <em>what could an AI-assisted outbound audiology referral workflow feel like?</em> It isn't production software or an approved company workflow, and it makes no HIPAA or compliance claims.</p>
        <div className="rd-about-cols">
          <div className="rd-about-fake">
            <h3><span className="rd-pill-fake">Synthetic</span></h3>
            <ul><li>Patients and clinical information</li><li>Attachments</li><li>Referral letter (template draft)</li><li>Fax transport and delivery</li><li>Fax-provider webhook</li><li>Inbound response and its AI reading</li></ul>
          </div>
          <div className="rd-about-real">
            <h3><span className="rd-pill-real">Live</span></h3>
            <ul><li>Specialist discovery by distance (CMS NPI Registry)</li><li>NPI identity and specialty</li><li>Washington licence check</li><li>Practice-location research from public web sources</li><li>Location-specific phone and fax, with evidence</li><li>Confidence scores and their explanations</li></ul>
          </div>
        </div>
        <p className="pi-muted">Seattle ENT destinations show web research saved from a real run on Sep 28, 2026, re-scored live for this search. Fresh research for other providers uses paid AI calls and needs the demo key.</p>
        <a href="/npi-list/opportunity">Why explore this? →</a>
      </div>
    </div>
  );
}
