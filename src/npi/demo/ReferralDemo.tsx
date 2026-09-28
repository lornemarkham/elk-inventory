// ── /npi-list/referral-demo — fake outbound referral workflow (SYNTHETIC POC) ──
// A personal proof of concept. Patient, clinical text, attachments, fax
// transport, webhook and inbound response are all fictional. The audiologist
// supplies the referral type; the specialist search is the real deterministic
// provider search from /npi-list, plus saved/fresh web research. A separate,
// clearly synthetic controlled destination (./controlled.ts) is offered for
// fax-integration testing. Nothing is ever sent. State lives in this browser session only.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui";
import { TERMS, faxSemantics } from "../semantics";
import Specialists from "./Specialists";
import { Audiogram, DocPreview } from "./Documents";
import {
  DEMO_CLINIC, SAMPLE_ATTACHMENTS, SCENARIOS, ageFrom, applyStep, createTransaction, draftReferral, faxPlan, pageCount, parseRecord, searchOrigin, simulateInbound, webhookFor,
  type Attachment, type Destination, type FaxOutcome, type FaxTransaction, type FaxWebhook, type InboundFax, type ReferralDraft, type Scenario, type ScenarioId,
} from "./model";
import { REFERRAL_TYPES } from "./routing";
import { CONTROLLED, controlledDestination, isControlled } from "./controlled";
import ControlledCard from "./ControlledCard";
import { applySend, applyStatus, canSendLive, liveDone, liveFaxConfig, liveFaxStatus, newLiveFax, operationalEvidence, sendLiveFax, type LiveFax } from "./live";
import "./demo.css";

type Step = "patient" | "intent" | "search" | "prepare" | "review" | "send" | "timeline" | "live";

const STEPPER: { label: string; steps: Step[] }[] = [
  { label: "Patient", steps: ["patient", "intent"] },
  { label: "Destination", steps: ["search"] },
  { label: "Referral", steps: ["prepare"] },
  { label: "Review", steps: ["review"] },
  { label: "Sent", steps: ["send", "timeline", "live"] },
];

interface State {
  step: Step;
  scenarioId: ScenarioId;
  record: string;
  attachments: Attachment[]; // available (sample + local uploads)
  specialty: string; // referral type chosen by the audiologist — drives the search
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
  live: LiveFax | null; // CONTROLLED live SRFax test (synthetic destination only)
  times: Partial<Record<"started" | "searched" | "selected" | "prepared" | "reviewed", string>>;
}

const KEY = "npi-referral-demo:v2";
const LOG = "npi-referral-demo:fax-log";

function fresh(id: ScenarioId = "A"): State {
  const s = SCENARIOS.find((x) => x.id === id)!;
  return {
    step: "patient", scenarioId: id, record: s.record, attachments: s.attachments.map((a) => SAMPLE_ATTACHMENTS[a]),
    specialty: s.referralType, location: searchOrigin(parseRecord(s.record).location), radius: 10, found: null,
    destination: null, draft: null, reviewed: false, outcome: "deliver", tx: null, webhook: null, failed: [], flagged: [], inbound: null, live: null,
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
      // A live submit interrupted before SRFax answered is NEVER resubmitted automatically.
      if (s.live?.phase === "submitting") return { ...s, live: { ...s.live, phase: "error", error: "Interrupted before SRFax answered. It may or may not have been queued — check the SRFax portal before sending again." } };
      return { ...s, live: s.live ?? null };
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
          <span>Outbound Referral Workflow</span>
        </a>
        <span className="rd-poc">Synthetic POC</span>
        <nav className="rd-stepper" aria-label="Progress">
          {STEPPER.map((g, i) => {
            const target = g.steps[0];
            const can = i < stepIdx && !sent;
            return (
              <button key={g.label} className={`rd-stp ${i < stepIdx ? "rd-stp-done" : i === stepIdx ? "rd-stp-now" : ""}`} disabled={!can} onClick={() => can && go(target)}>
                <span className="rd-stp-dot">{i < stepIdx ? <Icon name="check" size={11} /> : i + 1}</span>{i === STEPPER.length - 1 ? (st.destination && isControlled(st.destination) && st.step === "live" ? "Live fax test" : "Sent (simulated)") : g.label}
              </button>
            );
          })}
        </nav>
        <div className="rd-top-links">
          <a href="/npi-list/fax-settings">Fax line</a>
          <button className="pi-link" onClick={() => setAbout(true)}>About this POC</button>
          <a href="/npi-list/opportunity">Why explore this? →</a>
        </div>
      </header>
      <div className="rd-banner"><Icon name="shield" size={14} /> <strong>SYNTHETIC DEMO DATA</strong> — fictional patients, no real patient information. Fax sending to real providers is always simulated — nothing is ever sent to them. Only the synthetic controlled test destination can receive a real test fax.</div>

      <main className="rd-main">
        {st.step === "patient" && (
          <PatientStep
            st={st}
            scenario={scenario}
            onScenario={(id) => id !== st.scenarioId && set({ ...fresh(id), times: st.times })}
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
            <StepHead kicker="Step 3 · Find a destination" title={`Where can ${patient.name || "this patient"}'s ${st.specialty.split(" / ")[0]} referral go?`} sub="The audiologist chose the referral type. This step only finds real destinations for it: registry matches by taxonomy and distance, then evidence about where and how to send." onBack={() => go("intent")} />
            <div className="rd-requested"><Icon name="stethoscope" size={14} /> Requested referral type: {st.specialty} · selected by the audiologist</div>
            <ControlledCard requested={st.specialty} onChoose={() => go("prepare", { destination: controlledDestination(), draft: draftReferral(patient, scenario, controlledDestination()), reviewed: false, times: { ...st.times, selected: now() } })} />
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
          <ReviewStep st={st} patient={patient} scenario={scenario} set={set} onBack={() => go("prepare")}
            onSendLive={() => {
              // Only the controlled synthetic destination; the server enforces the same.
              if (!st.destination || !canSendLive(st.destination) || st.live) return;
              const reference = `SYN-${Date.now().toString(36).toUpperCase()}`;
              go("live", { live: newLiveFax(reference), times: { ...st.times, reviewed: now() } });
              sendLiveFax(st.destination, st.scenarioId, reference).then((r) => set((s) => (s.live?.reference === reference ? { live: applySend(s.live, r) } : {})));
            }}
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
            onAlternate={() => go("search", { failed: [...st.failed, st.tx!], tx: null, webhook: null, flagged: [...st.flagged, `${st.destination!.npi ?? CONTROLLED.id}|${st.destination!.fax.replace(/\D/g, "")}`] })}
            onTimeline={() => go("timeline")}
          />
        )}
        {st.step === "live" && st.live && st.destination && (
          <LiveFaxStep st={st} live={st.live} patient={patient} set={set} onRestart={() => { setSt(fresh()); window.scrollTo({ top: 0 }); }} />
        )}
        {st.step === "timeline" && st.tx && (
          <TimelineStep st={st} patient={patient} scenario={scenario}
            onRespond={() => set({ inbound: simulateInbound(st.tx!, scenario, new Date(), st.specialty) })}
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
      <StepHead kicker="Step 1 · Patient" title="Who are we referring?" sub="The audiologist has finished the assessment and already decided to refer, and to what kind of specialist. Pick a fictional patient to begin." />
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
                <div className="rd-reftype">Referral type selected by the audiologist: <strong>{st.specialty}</strong></div>
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
      <StepHead kicker="Step 2 · Referral intent" title="Referral type" sub={`${patientName} · ${scenario.title}${scenario.priority === "Urgent" ? " · Urgent" : ""}`} onBack={onBack} />
      <p className="rd-intent-note"><strong>The audiologist supplies this.</strong> It is the clinical decision, already made. The software does not infer it from the notes; it only finds where a referral of this type can legitimately and practically be sent.</p>
      <div className="rd-specs">
        {REFERRAL_TYPES.map((c) => (
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
        <div><span className="rd-pill-fake">Fictional</span> the patient and the audiologist's referral decision</div>
        <Icon name="chevron" />
        <div><span className="rd-pill-real">Real</span> the specialist search that comes next</div>
      </div>
      <div className="rd-cta">
        <button className="pi-btn pi-btn-primary pi-btn-lg" disabled={!st.location.trim()} onClick={onNext}><Icon name="search" /> Find {st.specialty.split(" / ")[0]} destinations</button>
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
            <div className={`rd-doc-block ${isControlled(d) ? "rd-synthetic-dest" : ""}`}>
              <span>Referred to {isControlled(d) ? <em className="rd-synth-provider-tag">SYNTHETIC TEST PROVIDER</em> : <em className="rd-real-tag">Real destination</em>}</span>
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
  const sem = d.kind === "controlled" ? null : faxSemantics({ number: d.fax, digits: "", label: d.faxLabel, faxKind: d.faxKind, labelCheck: d.faxChecked ? "page" : undefined, sourceIds: [], families: [], inNpi: false, confidence: 0 });
  return (
    <div className={`rd-card rd-dest ${isControlled(d) ? "rd-synthetic-dest" : ""}`}>
      <div className="rd-card-label">Destination</div>
      {isControlled(d) && <div className="rd-controlled-labels">{CONTROLLED.labels.map((l) => <span key={l}>{l}</span>)}</div>}
      <div className="rd-dest-fax">
        <span>{isControlled(d) ? "Referral fax — controlled test" : sem!.title}</span>
        <strong className="pi-mono">{d.fax}</strong>
      </div>
      {d.referralScore !== null && <div className="rd-dest-row"><span>{TERMS.destination.label}</span><strong className={`rd-tone-${d.referralScore >= 80 ? "good" : d.referralScore >= 60 ? "ok" : "low"}`}>{d.referralScore}%</strong></div>}
      {d.providerScore !== null && <div className="rd-dest-row"><span>{TERMS.verification.label}</span><strong>{d.providerScore}%</strong></div>}
      {d.distanceMi !== null && <div className="rd-dest-row"><span>Distance</span><strong>{d.distanceMi} mi</strong></div>}
      {d.phone && <div className="rd-dest-row"><span>Phone</span><strong className="pi-mono">{d.phone}</strong></div>}
      <div className={`rd-dest-note ${d.faxChecked ? "rd-good" : "rd-caution"}`}>
        <Icon name={d.faxChecked ? "check" : "alert"} size={13} />
        {isControlled(d)
          ? <>Controlled fax supplied by the POC owner for integration testing. Not a real clinician, not from any registry, and not scored.</>
          : d.faxChecked
            ? <>Referral fax: labelled as referral intake on {d.faxSources[0]?.domain ?? "the source page"}, and the wording was checked on the live page.</>
            : <>{sem!.detail} In real use you'd call to confirm.</>}
      </div>
      {d.reviewReasons.length > 0 && (
        <div className="rd-dest-note rd-caution"><Icon name="alert" size={13} /> Chosen from Needs review: {d.reviewReasons.join("; ")}.</div>
      )}
    </div>
  );
}

// ── Step 5 · Review ─────────────────────────────────────────────────────────

function ReviewStep({ st, patient, scenario, set, onBack, onSend, onSendLive }: { st: State; patient: ReturnType<typeof parseRecord>; scenario: Scenario; set: (p: Partial<State>) => void; onBack: () => void; onSend: () => void; onSendLive: () => void }) {
  const d = st.destination!;
  const live = canSendLive(d);
  const draft = st.draft!;
  const has = (id: string) => draft.attachmentIds.includes(id) && st.attachments.some((a) => a.id === id);
  const atts = st.attachments.filter((a) => draft.attachmentIds.includes(a.id));
  const rows: { ok: boolean | "warn"; label: string; value: string }[] = [
    { ok: Boolean(patient.name && patient.dob), label: "Patient", value: `${patient.name} · DOB ${patient.dob}` },
    { ok: Boolean(draft.reason.trim()), label: "Referral reason", value: draft.reason },
    isControlled(d)
      ? { ok: "warn", label: "Destination", value: `${d.provider} · SYNTHETIC TEST PROVIDER — not a real clinician` }
      : { ok: d.reviewReasons.length ? "warn" : true, label: "Destination", value: `${d.provider} · ${d.practice}${d.reviewReasons.length ? ` · needs review: ${d.reviewReasons.join("; ")}` : ""}` },
    isControlled(d)
      ? { ok: "warn", label: "Controlled test fax", value: `${d.fax} · controlled POC destination` }
      : { ok: d.faxChecked ? true : "warn", label: d.faxChecked ? "Referral fax" : "Office fax", value: `${d.fax}${d.faxChecked ? " · referral use confirmed by source" : " · referral use not confirmed"}` },
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
      {live && <LiveSendPanel scenario={scenario} approved={st.reviewed} onSendLive={onSendLive} />}
      <details className="rd-democtl">
        <summary>Demo controls{live ? " (simulated send only)" : ""}</summary>
        <div className="rd-democtl-body">
          <span>Simulated outcome</span>
          <div className="rd-radius">
            <button className={st.outcome === "deliver" ? "rd-on" : ""} onClick={() => set({ outcome: "deliver" })}>Delivered</button>
            <button className={st.outcome === "fail" ? "rd-on" : ""} onClick={() => set({ outcome: "fail" })}>Delivery fails</button>
          </div>
        </div>
      </details>
      <div className="rd-cta rd-cta-col">
        <button className={`pi-btn ${live ? "" : "pi-btn-primary pi-btn-lg"} rd-send`} disabled={!st.reviewed} onClick={onSend}><Icon name="fax" /> {live ? "Run a SIMULATED send instead" : "Send SIMULATED fax"}</button>
        <div className="pi-muted">{live ? "Simulated: nothing is transmitted and SRFax is not called." : <>SIMULATED send. Real providers are never faxed — nothing is sent to {d.practice} and SRFax is not invoked.</>}</div>
      </div>
    </section>
  );
}

// ── CONTROLLED LIVE FAX TEST (synthetic destination only) ──────────────────

function LiveSendPanel({ scenario, approved, onSendLive }: { scenario: Scenario; approved: boolean; onSendLive: () => void }) {
  const [cfg, setCfg] = useState<{ ok: boolean; configured: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { liveFaxConfig().then(setCfg); }, []);
  return (
    <div className="rd-card rd-livebox">
      <div className="rd-live-title"><Icon name="fax" /> CONTROLLED LIVE FAX TEST</div>
      <div className="rd-controlled-labels">{CONTROLLED.labels.map((l) => <span key={l}>{l}</span>)}</div>
      <ul className="rd-live-facts">
        <li>Sends ONE real fax through SRFax to the controlled number <strong className="pi-mono">{CONTROLLED.fax}</strong> — the only number the server will dial.</li>
        <li>The fax is a synthetic test document built on the server from the canned scenario “{scenario.title}”. Edits made in Prepare are not transmitted, so no free text (and no real patient information) can reach the fax.</li>
        <li>Every page is marked SYNTHETIC TEST REFERRAL · NO REAL PATIENT INFORMATION · NOT FOR CLINICAL USE.</li>
        <li>SRFax credentials stay on the server. A failure is shown as a failure.</li>
      </ul>
      {cfg === null ? <div className="pi-muted"><span className="pi-spinner" /> Checking the fax service…</div>
        : !cfg.ok ? <div className="rd-live-off"><Icon name="alert" size={14} /> Configuration error: couldn't reach the fax service (/api/npi-fax), so the live test is unavailable. The simulated send below still works.</div>
        : !cfg.configured ? <div className="rd-live-off"><Icon name="alert" size={14} /> Configuration error: SRFax credentials are not set in this server's environment, so the live test is unavailable. The simulated send below still works.</div>
        : (
          <>
            <label className="rd-approve">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              <span>Send one real synthetic test fax to {CONTROLLED.fax}.</span>
            </label>
            <button className="pi-btn pi-btn-primary pi-btn-lg rd-send-live" disabled={!approved || !confirm} onClick={onSendLive}><Icon name="fax" /> Send CONTROLLED LIVE FAX TEST</button>
          </>
        )}
    </div>
  );
}

const LIVE_POLL_MS = 6000;
const LIVE_POLL_MAX = 100; // ~10 minutes, then manual refresh

function LiveFaxStep({ st, live, patient, set, onRestart }: { st: State; live: LiveFax; patient: ReturnType<typeof parseRecord>; set: (p: Partial<State> | ((s: State) => Partial<State>)) => void; onRestart: () => void }) {
  const [polls, setPolls] = useState(0);
  const d = st.destination!;
  const done = liveDone(live);
  const refresh = () => {
    if (!live.faxId || !live.statusToken) return;
    const id = live.faxId;
    liveFaxStatus(id, live.statusToken).then((r) => set((s) => (s.live?.faxId === id ? { live: applyStatus(s.live, r) } : {})));
  };
  useEffect(() => {
    if (!live.faxId || done || polls >= LIVE_POLL_MAX) return;
    const t = setTimeout(() => { refresh(); setPolls((n) => n + 1); }, polls === 0 ? 1500 : LIVE_POLL_MS);
    return () => clearTimeout(t);
  }, [live.faxId, done, polls, live.lastCheckedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const ev = operationalEvidence(live);
  const s = live.status;
  const title = live.phase === "submitting" ? "Submitting to SRFax…" : live.phase === "error" ? "Not sent" : live.phase === "failed" ? "SRFax: Failed" : live.phase === "sent" ? "SRFax: Sent" : `SRFax: ${s?.sentStatus ?? "Submitted"}`;
  const workflow = [
    { at: st.times.started, title: "Patient", detail: `${patient.name} · synthetic` },
    { at: st.times.selected, title: "Destination", detail: `${d.provider} — SYNTHETIC TEST PROVIDER · ${d.fax}` },
    { at: st.times.prepared, title: "Referral", detail: "Synthetic test referral prepared" },
    { at: st.times.reviewed, title: "Review", detail: "Approved; one live test fax confirmed" },
  ];

  return (
    <section className="rd-narrow">
      <div className="rd-head">
        <div className="rd-kicker">Step 6 · CONTROLLED LIVE FAX TEST <span className="rd-live-tag"><span className="rd-live-dot" /> Real SRFax transmission</span></div>
        <h1>{title}</h1>
        <p>To {CONTROLLED.name} (synthetic) · <span className="pi-mono">{live.to}</span> · reference <span className="pi-mono">{live.reference}</span>{live.faxId && <> · SRFax FaxDetailsID <span className="pi-mono">{live.faxId}</span></>}</p>
      </div>

      <div className={`rd-card rd-fax rd-fax-${live.phase === "sent" ? "delivered" : live.phase === "failed" || live.phase === "error" ? "failed" : "sending"}`}>
        <ol className="rd-fax-steps rd-live-events">
          {live.events.map((e, i) => (
            <li key={i} className={`rd-done ${/Failed|Not submitted/.test(e.label) ? "rd-bad" : ""}`}>
              <span className="rd-fax-dot"><Icon name={/Failed|Not submitted/.test(e.label) ? "x" : "check"} size={13} /></span>
              <span><strong>{e.label}</strong> <span className="pi-muted">· {time(e.at)} · {e.detail}</span></span>
            </li>
          ))}
          {!done && <li className="rd-now"><span className="rd-fax-dot"><span className="pi-spinner" /></span>{live.phase === "submitting" ? "Waiting for SRFax to accept the fax" : "Waiting for SRFax to report a final status"}</li>}
        </ol>
        {live.error && <div className="rd-live-err"><Icon name="alert" size={14} /> {live.error}</div>}
        {live.faxId && (
          <div className="rd-live-poll pi-muted">
            {live.lastCheckedAt ? <>Last checked with SRFax Get_FaxStatus at {time(live.lastCheckedAt)}.</> : "Status not checked yet."}
            {!done && polls >= LIVE_POLL_MAX && " Automatic checks stopped."} <button className="pi-link" onClick={refresh}>Check now</button>
          </div>
        )}
      </div>

      {s && (
        <div className="rd-card rd-hook">
          <div className="rd-hook-head"><span className="rd-live-tag"><span className="rd-live-dot" /> SRFax Get_FaxStatus — real</span><span className="pi-mono pi-muted">FaxDetailsID {live.faxId}</span></div>
          <dl className="rd-hook-grid">
            <dt>SentStatus</dt><dd className={s.phase === "sent" ? "pi-good" : s.phase === "failed" ? "pi-bad" : ""}>{s.sentStatus || "—"}</dd>
            <dt>To</dt><dd className="pi-mono">{s.toFaxNumber ?? live.to}</dd>
            <dt>Queued</dt><dd>{s.dateQueued ?? "—"}</dd>
            <dt>Sent</dt><dd>{s.dateSent ?? "—"}</dd>
            <dt>Pages</dt><dd>{s.pages ?? "—"}</dd>
            <dt>Duration</dt><dd>{s.duration != null ? `${s.duration}s` : "—"}</dd>
            <dt>ErrorCode</dt><dd>{s.errorCode ?? "—"}</dd>
          </dl>
          <details className="rd-raw"><summary>Status record</summary><pre>{JSON.stringify(s, null, 2)}</pre></details>
          <div className="pi-muted rd-fine">SRFax dates are in the SRFax account's timezone.</div>
        </div>
      )}

      <div className="rd-card rd-opev">
        <div className="rd-card-label">Operational fax evidence — separate from provider evidence</div>
        <p><strong>{ev.claim}</strong></p>
        <p className="pi-muted">This does not establish: {ev.notProven.join("; ")}. It changes no provider verification, destination confidence or referral-fit result.</p>
      </div>

      <div className="rd-card">
        <div className="rd-card-label">Workflow</div>
        <ol className="rd-tl">
          {workflow.map((it) => (
            <li key={it.title} className="rd-tl-item">
              <span className="rd-tl-dot" />
              <div className="rd-tl-body"><div className="rd-tl-title">{it.title}</div><div className="rd-tl-detail">{it.detail}</div></div>
              <span className="rd-tl-time">{time(it.at)}</span>
            </li>
          ))}
          <li className="rd-tl-item rd-tl-real">
            <span className="rd-tl-dot" />
            <div className="rd-tl-body"><div className="rd-tl-title">CONTROLLED LIVE FAX TEST <em className="rd-real-tag">Real SRFax</em></div><div className="rd-tl-detail">{title}</div></div>
            <span className="rd-tl-time">{time(live.submittedAt)}</span>
          </li>
        </ol>
      </div>

      <div className="rd-end">
        <button className="pi-btn" onClick={onRestart}><Icon name="refresh" /> Start another referral</button>
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
        <div className="rd-kicker">Step 6 · SIMULATED send <span className="rd-sim-tag">Simulated transport — nothing transmitted</span></div>
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
    { at: st.times.started, title: "Audiology assessment", detail: `${scenario.title} · audiologist decided to refer` },
    { at: st.times.searched, title: "Destination search", detail: `${st.specialty} requested by the audiologist · ${st.found ?? "—"} registry matches within ${st.radius} miles`, tone: "real" },
    isControlled(d)
      ? { at: st.times.selected, title: "Controlled test destination selected", detail: `${d.provider} — synthetic test provider · ${d.fax}`, tone: "sim" as const }
      : { at: st.times.selected, title: "Destination selected", detail: `${d.provider} — ${d.practice} · destination confidence ${d.referralScore}%`, tone: "real" as const },
    { at: st.times.prepared, title: "Referral prepared", detail: attLabels.length ? `${attLabels.join(" + ")} attached` : "No attachments" },
    { at: st.times.reviewed, title: "Human reviewed", detail: "Referral approved by the audiologist" },
    ...st.failed.map((f) => ({ at: f.completedAt, title: "Fax failed", detail: `${f.id} · ${f.destination.practice} · no answer`, tone: "bad" as const })),
    { at: tx.createdAt, title: "SIMULATED send", detail: <span className="pi-mono">{tx.id}</span>, tone: "sim" },
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
            <ul><li>Patients and clinical information</li><li>The audiologist's referral decision</li><li>The controlled test destination (Lorne Markham, MD — not a real clinician)</li><li>Attachments</li><li>Referral letter (template draft)</li><li>Fax transport and delivery</li><li>Fax-provider webhook</li><li>Inbound response and its AI reading</li></ul>
          </div>
          <div className="rd-about-real">
            <h3><span className="rd-pill-real">Live</span></h3>
            <ul><li>Deterministic discovery for the requested referral type: NPI taxonomy, state, distance (CMS NPI Registry)</li><li>NPI identity and specialty</li><li>Washington licence check</li><li>Practice-location research from public web sources</li><li>Location-specific phone and fax, with evidence</li><li>{TERMS.verification.label}, {TERMS.destination.label.toLowerCase()} and {TERMS.fit.label.toLowerCase()}, with explanations</li></ul>
          </div>
        </div>
        <p>The audiologist supplies the referral type. Deterministic code finds candidates and applies hard checks; AI web research only adds evidence (current location, fax labels, specialty reconciliation); plain rules sort destinations into Recommended and Needs review; the human chooses.</p>
        <p className="pi-muted">Seattle ENT destinations show web research saved from a real run on Sep 28, 2026, re-scored live for this search. That saved research is only used for ENT-family searches. A fresh search first checks the nearest providers against public web pages automatically (search + fetched pages, no AI); deeper AI research is a paid step for unresolved providers, available to authorized operators.</p>
        <a href="/npi-list/opportunity">Why explore this? →</a>
      </div>
    </div>
  );
}
