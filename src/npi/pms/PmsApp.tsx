// ── /npi-list/pms — a small FAKE clinic PMS hosting Provider Intelligence (SYNTHETIC POC) ──
// Deliberately bounded: Patient Summary, Appointment Summary, outbound referral,
// Fax (Inbox · Outbox · Fax line). Every patient/appointment/clinical record is
// fictional (./data.ts). What is real and what is simulated is labelled on screen:
//   REAL       Provider Intelligence (embedded via /npi-sdk loader + iframe), the
//              controlled SRFax send + Get_FaxStatus polling, the endpoint-inbox
//              receipt check, deterministic document matching, the human gate.
//   SIMULATED  sends to real providers, the inbound fax, OCR, AI extraction.
// The PMS knows nothing about NPPES, Brave, SRFax credentials or OCR internals:
// it talks to Provider Intelligence through the SDK and to fax through live.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui";
import { TERMS } from "../semantics";
import { CONTROLLED } from "../demo/controlled";
import { ageFrom, type Destination } from "../demo/model";
import { applyReceipt, applySend, applyStatus, canSendLive, liveFaxConfig, liveFaxReceipt, liveFaxStatus, newLiveFax, sendLiveFax } from "../demo/live";
import { PMS_APPOINTMENTS, PMS_CLINIC, PMS_DOCUMENTS, PMS_PARENT, PMS_PATIENT, PMS_PRODUCT, REFERRAL_APPOINTMENT, VISIT_NOTE } from "./data";
import { createOutbox, fmt, freshState, notice, referralStatus, transportOf, type OutboxItem, type PmsNotice, type PmsState, type Transport } from "./model";
import { SIMULATED_BANNER, processDocument, receiveInboundFax, simulatedInboundEvent, type InboxItem } from "./inbound";
import "../demo/demo.css";
import "./pms.css";

const KEY = "npi-pms-demo:v1";
const POLL_MS = 5000;
const POLL_MAX = 120; // ~10 minutes of status checks per fax
const RECEIPT_MS = 15000;
const RECEIPT_MAX = 8; // ~2 minutes of endpoint-inbox checks after "Sent"
const STAGE_MS = 1300; // inbound processing pacing, for legibility only

type Route = { view: "patient" } | { view: "appointment" } | { view: "referral" } | { view: "fax"; tab: "inbox" | "outbox" | "line"; id: string | null };

function parseRoute(hash: string): Route {
  const [, a, b, c] = hash.replace(/^#/, "").split("/");
  if (a === "appointment") return { view: "appointment" };
  if (a === "referral") return { view: "referral" };
  if (a === "fax") return { view: "fax", tab: b === "inbox" || b === "line" ? b : "outbox", id: c ? decodeURIComponent(c) : null };
  return { view: "patient" };
}

function load(): PmsState {
  try { const raw = sessionStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw) as PmsState; if (s?.v === 1) return s; } } catch { /* fresh */ }
  return freshState();
}

// The host loads the Provider Intelligence SDK like any third-party script.
interface PiSdk { open: (o: { referralType: string; patientContext: unknown; clinicContext: unknown; onEvent: (type: string, detail: unknown) => void }) => { close: () => void } }
let sdkPromise: Promise<PiSdk> | null = null;
function loadSdk(): Promise<PiSdk> {
  const w = window as unknown as { ProviderIntelligence?: PiSdk };
  if (w.ProviderIntelligence) return Promise.resolve(w.ProviderIntelligence);
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/npi-sdk/provider-intelligence.js";
    s.onload = () => (w.ProviderIntelligence ? resolve(w.ProviderIntelligence) : reject(new Error("SDK missing")));
    s.onerror = () => { sdkPromise = null; reject(new Error("Couldn't load the Provider Intelligence SDK")); };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export default function PmsApp() {
  const [st, setSt] = useState<PmsState>(load);
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [now, setNow] = useState(Date.now());
  const [toasts, setToasts] = useState<PmsNotice[]>([]);
  const [bell, setBell] = useState(false);
  const inflight = useRef(new Set<string>());
  const polls = useRef(new Map<string, number>());
  const receiptAt = useRef(new Map<string, number>());
  const stRef = useRef(st);
  stRef.current = st;

  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch { /* best-effort */ } }, [st]);
  useEffect(() => { const on = () => { setRoute(parseRoute(location.hash)); window.scrollTo({ top: 0 }); }; window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const go = (hash: string) => { if (location.hash !== hash) location.hash = hash; else setRoute(parseRoute(hash)); };

  const notify = useCallback((n: PmsNotice) => {
    setSt((s) => ({ ...s, notices: [n, ...s.notices].slice(0, 30) }));
    setToasts((t) => [n, ...t].slice(0, 3));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 8000);
  }, []);

  const patchOutbox = useCallback((id: string, fn: (o: OutboxItem) => OutboxItem) => setSt((s) => ({ ...s, outbox: s.outbox.map((o) => (o.id === id ? fn(o) : o)) })), []);

  // ── Outbound: announce transport changes (live and simulated alike) ───────
  useEffect(() => {
    for (const o of st.outbox) {
      const t = transportOf(o, now);
      if (o.notified === t.state || t.state === "preparing") continue;
      patchOutbox(o.id, (x) => ({ ...x, notified: t.state }));
      const who = `${o.patientName} · ${o.referralType} referral → ${o.destination.provider}`;
      if (t.state === "sent" || t.state === "received") notify(notice(`${t.label} ✓ — ${who}`, "good", `#/fax/outbox/${o.id}`));
      else if (t.state === "failed" || t.state === "not_sent") notify(notice(`Fax ${t.label.toLowerCase()} — ${who}`, "bad", `#/fax/outbox/${o.id}`));
      else if (t.state === "sending") notify(notice(`Sending… — ${who}`, "info", `#/fax/outbox/${o.id}`));
    }
  }, [st.outbox, now, notify, patchOutbox]);

  // ── Outbound: follow SRFax automatically (Get_FaxStatus polling; the SRFax
  // completion callback, when this server instance received it, rides along) ──
  // One steady interval reading the latest state, so a status response never
  // triggers an immediate extra SRFax call.
  useEffect(() => {
    const tick = () => {
      for (const o of stRef.current.outbox) {
        const l = o.live;
        if (!l?.faxId || !l.statusToken || inflight.current.has(o.id)) continue;
        const t = transportOf(o);
        const n = polls.current.get(o.id) ?? 0;
        if (!t.done && n < POLL_MAX) {
          inflight.current.add(o.id);
          polls.current.set(o.id, n + 1);
          liveFaxStatus(l.faxId, l.statusToken).then((r) => patchOutbox(o.id, (x) => (x.live ? { ...x, live: applyStatus(x.live, r) } : x))).finally(() => inflight.current.delete(o.id));
        } else if (t.state === "sent" && (l.receiptChecks ?? 0) < RECEIPT_MAX && Date.now() - (receiptAt.current.get(o.id) ?? 0) >= RECEIPT_MS) {
          inflight.current.add(o.id);
          receiptAt.current.set(o.id, Date.now());
          liveFaxReceipt(l.faxId, l.statusToken).then((r) => patchOutbox(o.id, (x) => (x.live ? { ...x, live: applyReceipt(x.live, r) } : x))).finally(() => inflight.current.delete(o.id));
        }
      }
    };
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [patchOutbox]);

  // ── Inbound: step each new fax through the document pipeline ─────────────
  useEffect(() => {
    const next = st.inbox.find((i) => i.stage === "received" || i.stage === "ocr" || i.stage === "extracting" || i.stage === "matching");
    if (!next) return;
    const t = setTimeout(() => {
      setSt((s) => {
        const item = s.inbox.find((i) => i.id === next.id);
        if (!item) return s;
        const stage = ({ received: "ocr", ocr: "extracting", extracting: "matching", matching: "review" } as const)[item.stage as "received" | "ocr" | "extracting" | "matching"];
        const processing = stage === "review" ? processDocument(item, s.referral, s.outbox) : item.processing;
        return { ...s, inbox: s.inbox.map((i) => (i.id === item.id ? { ...i, stage, processing } : i)) };
      });
    }, STAGE_MS);
    return () => clearTimeout(t);
  }, [st.inbox]);

  const reviewReady = st.inbox.filter((i) => i.stage === "review").map((i) => i.id).join(",");
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const i of st.inbox) {
      if (i.stage !== "review" || announced.current.has(i.id)) continue;
      announced.current.add(i.id);
      const m = i.processing?.match;
      notify(notice(m?.found ? `Match proposed: ${m.patientName} — ${st.referral.type} referral · needs confirmation` : "Inbound fax processed — no patient match proposed", "info", `#/fax/inbox/${i.id}`));
    }
  }, [reviewReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ───────────────────────────────────────────────────────────────
  const findDestination = async () => {
    try {
      const sdk = await loadSdk();
      sdk.open({
        referralType: st.referral.type,
        patientContext: { ref: PMS_PATIENT.ref, age: ageFrom(PMS_PATIENT.dob) },
        clinicContext: { id: PMS_CLINIC.id, searchOrigin: PMS_CLINIC.searchOrigin },
        onEvent: (type, detail) => {
          if (type !== "destination:selected") return;
          const destination = (detail as { destination: Destination }).destination;
          setSt((s) => ({ ...s, referral: { ...s.referral, destination, selectedAt: new Date().toISOString() } }));
          go("#/referral");
        },
      });
    } catch (e) { notify(notice((e as Error).message, "bad", null)); }
  };

  const send = () => {
    const d = st.referral.destination;
    if (!d || st.referral.outboxId) return;
    if (canSendLive(d)) {
      const draft = createOutbox(st, d, "live", null);
      const live = newLiveFax(draft.id);
      const item = { ...draft, live };
      setSt((s) => ({ ...s, outbox: [item, ...s.outbox], referral: { ...s.referral, outboxId: item.id } }));
      sendLiveFax(d, PMS_PATIENT.scenarioId, item.id, "pms").then((r) => patchOutbox(item.id, (x) => (x.live ? { ...x, live: applySend(x.live, r) } : x)));
      go(`#/fax/outbox/${item.id}`);
    } else {
      // Real provider: SIMULATED. The fax service is never called.
      const item = createOutbox(st, d, "simulated", null);
      setSt((s) => ({ ...s, outbox: [item, ...s.outbox], referral: { ...s.referral, outboxId: item.id } }));
      go(`#/fax/outbox/${item.id}`);
    }
  };

  const simulateInbound = () => {
    const out = st.outbox.find((o) => o.id === st.referral.outboxId) ?? null;
    if (out && out.destination.kind !== "controlled") return; // never fabricate a real provider's reply
    const { inbox, item, duplicate } = receiveInboundFax(st.inbox, simulatedInboundEvent(out));
    if (duplicate) return;
    setSt((s) => ({ ...s, inbox }));
    notify(notice(`New fax received from ${item.fromFax} (${item.pages} page) — SIMULATED`, "info", `#/fax/inbox/${item.id}`));
    go(`#/fax/inbox/${item.id}`);
  };

  const decide = (item: InboxItem, confirm: boolean) => {
    const at = new Date().toISOString();
    const m = item.processing?.match;
    setSt((s) => ({
      ...s,
      inbox: s.inbox.map((i) => (i.id === item.id ? { ...i, stage: confirm ? "confirmed" : "rejected", decidedAt: at, unread: false } : i)),
      referral: confirm && m?.referralId ? { ...s.referral, response: { inboxId: item.id, receivedAt: item.receivedAt, confirmedAt: at, summary: fieldOf(item, "summary") ?? "", followUp: fieldOf(item, "followUp") } } : s.referral,
    }));
    if (confirm && m?.referralId) notify(notice(`Referral response received for ${m.patientName}`, "good", "#/patient"));
    else if (confirm && m?.found) notify(notice(`Fax filed to ${m.patientName}'s chart (not linked to the referral)`, "info", "#/patient"));
  };

  const reset = () => { sessionStorage.removeItem(KEY); setSt(freshState()); polls.current.clear(); announced.current.clear(); go("#/patient"); };

  const unreadFax = st.inbox.filter((i) => i.unread).length;
  const unreadNotices = st.notices.filter((n) => !n.read).length;

  return (
    <div className="pi pmsx">
      <div className="pmsx-demo"><Icon name="shield" size={13} /> <strong>DEMO · SYNTHETIC DATA ONLY</strong> — fictional patient and clinic records, no PHI. Not affiliated with or connected to {PMS_PARENT.name} or any PMS vendor. <span className="pmsx-legend"><Tag k="real" /> <Tag k="sim" /> <Tag k="future" /></span><button className="pi-link" onClick={reset}>Reset demo</button></div>
      <header className="pmsx-top">
        <div className="pmsx-brand"><span className="pmsx-logo">CD</span>{PMS_PRODUCT}<span className="pmsx-fake">fictional PMS</span></div>
        <div className="pmsx-tenant"><span>{PMS_PARENT.name}</span><Icon name="chevron" size={12} /><strong>{PMS_CLINIC.displayName}</strong></div>
        <div className="pmsx-top-r">
          <button className="pmsx-bell" aria-label={`Notifications (${unreadNotices} unread)`} onClick={() => { setBell(!bell); setSt((s) => ({ ...s, notices: s.notices.map((n) => ({ ...n, read: true })) })); }}>
            <BellIcon />{unreadNotices > 0 && <span className="pmsx-badge">{unreadNotices}</span>}
          </button>
          <span className="pmsx-user"><span className="pi-avatar">AD</span>{PMS_CLINIC.audiologist}</span>
        </div>
        {bell && (
          <div className="pmsx-bellpop" role="dialog" aria-label="Notifications">
            <div className="pmsx-bellpop-h">Notifications <span className="pi-muted">· in-app only (no browser push)</span></div>
            {st.notices.length === 0 ? <p className="pi-muted">Nothing yet.</p> : st.notices.map((n) => <a key={n.id} className={`pmsx-note pmsx-note-${n.tone}`} href={n.href ?? undefined} onClick={() => setBell(false)}><span>{n.text}</span><span className="pi-muted">{fmt(n.at)}</span></a>)}
          </div>
        )}
      </header>
      <div className="pmsx-body">
        <nav className="pmsx-nav" aria-label="PMS">
          <a className={route.view === "patient" ? "on" : ""} href="#/patient"><Icon name="user" size={15} /> Patient</a>
          <a className={route.view === "appointment" ? "on" : ""} href="#/appointment"><Icon name="stethoscope" size={15} /> Appointment</a>
          <a className={route.view === "fax" ? "on" : ""} href="#/fax/outbox"><Icon name="fax" size={15} /> Fax {unreadFax > 0 && <span className="pmsx-badge pmsx-badge-inline">{unreadFax}</span>}</a>
          <span className="pmsx-nav-dim"><Icon name="registry" size={15} /> Schedule</span>
          <span className="pmsx-nav-dim"><Icon name="filter" size={15} /> Reports</span>
          <div className="pmsx-nav-foot"><a href="/npi-list/referral-demo">Standalone referral demo</a><a href="/npi-list">Provider search</a><a href="/npi-list/fax-settings">Fax line settings</a></div>
        </nav>
        <main className="pmsx-main">
          {route.view === "patient" && <PatientSummary st={st} now={now} />}
          {route.view === "appointment" && <AppointmentSummary st={st} now={now} onFind={findDestination} />}
          {route.view === "referral" && <OutboundReferral st={st} onFind={findDestination} onSend={send} />}
          {route.view === "fax" && <FaxWorkspace st={st} route={route} now={now} onSimulate={simulateInbound} onDecide={decide} />}
        </main>
      </div>
      <div className="pmsx-toasts" aria-live="polite">
        {toasts.map((n) => <a key={n.id} className={`pmsx-toast pmsx-toast-${n.tone}`} href={n.href ?? undefined}><Icon name={n.tone === "bad" ? "alert" : n.tone === "good" ? "check" : "fax"} size={15} /><span>{n.text}</span></a>)}
      </div>
    </div>
  );
}

const fieldOf = (i: InboxItem, key: string) => i.processing?.extraction.fields.find((f) => f.key === key)?.value ?? null;

function BellIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 20a2 2 0 0 0 3.4 0" /></svg>;
}

export function Tag({ k, children }: { k: "real" | "sim" | "future"; children?: React.ReactNode }) {
  const text = { real: "REAL", sim: "SIMULATED", future: "FUTURE" }[k];
  return <span className={`pmsx-tag pmsx-tag-${k}`}>{text}{children ? <> · {children}</> : null}</span>;
}

function SyntheticChip() {
  return <span className="pmsx-synth">DEMO / SYNTHETIC PATIENT</span>;
}

function PatientHeader() {
  const age = ageFrom(PMS_PATIENT.dob);
  return (
    <div className="pmsx-card pmsx-pt">
      <div className="pmsx-pt-avatar">JE</div>
      <div className="pmsx-pt-main">
        <div className="pmsx-pt-name">{PMS_PATIENT.name} <SyntheticChip /></div>
        <div className="pmsx-pt-meta">
          <span>DOB {PMS_PATIENT.dob} ({age})</span><span>Chart # <span className="pi-mono">{PMS_PATIENT.ref}</span></span><span>{PMS_PATIENT.phone}</span><span>{PMS_PATIENT.insurance}</span>
        </div>
      </div>
      <div className="pmsx-pt-side"><div className="pi-muted">Clinic</div><div>{PMS_CLINIC.displayName}</div><div className="pi-muted">Primary: {PMS_PATIENT.primaryProvider}</div></div>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`pmsx-pill pmsx-pill-${tone}`}>{tone === "busy" && <span className="pi-spinner" />}{children}</span>;
}

// ── Patient Summary ──────────────────────────────────────────────────────────

function PatientSummary({ st, now }: { st: PmsState; now: number }) {
  const r = st.referral;
  const rs = referralStatus(st, now);
  const out = st.outbox.find((o) => o.id === r.outboxId);
  const inbound = st.inbox.filter((i) => i.stage === "confirmed");
  const activity = [
    ...PMS_DOCUMENTS.map((d) => ({ at: d.at, text: d.title, kind: d.kind, href: null as string | null })),
    ...st.outbox.map((o) => ({ at: o.createdAt, text: `Referral fax to ${o.destination.provider} — ${transportOf(o, now).label}`, kind: "Fax out", href: `#/fax/outbox/${o.id}` })),
    ...inbound.map((i) => ({ at: i.receivedAt, text: `Referral response fax (${i.pages} page) — associated by staff`, kind: "Fax in", href: `#/fax/inbox/${i.id}` })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section>
      <div className="pmsx-crumbs">Patients › {PMS_PATIENT.name} › Summary</div>
      <PatientHeader />
      <div className="pmsx-grid">
        <div className="pmsx-card">
          <h2>Appointments</h2>
          <table className="pmsx-table">
            <thead><tr><th>Date</th><th>Type</th><th>With</th><th>Status</th></tr></thead>
            <tbody>{PMS_APPOINTMENTS.map((a) => (
              <tr key={a.id}><td>{a.id === REFERRAL_APPOINTMENT.id ? <a href="#/appointment">{fmtDay(a.at)}</a> : fmtDay(a.at)}</td><td>{a.type}{a.referral && <span className="pmsx-mini">Referral: {a.referral.type}</span>}</td><td>{a.with}</td><td>{a.status}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="pmsx-card">
          <h2>Contact &amp; coverage</h2>
          <dl className="pmsx-dl"><dt>Address</dt><dd>{PMS_PATIENT.address}</dd><dt>Email</dt><dd>{PMS_PATIENT.email}</dd><dt>Insurance</dt><dd>{PMS_PATIENT.insurance}</dd><dt>Devices</dt><dd>{PMS_PATIENT.devices}</dd><dt>Patient since</dt><dd>{PMS_PATIENT.since}</dd></dl>
        </div>
      </div>
      <div className="pmsx-card" id="referrals">
        <h2>Referrals</h2>
        <table className="pmsx-table pmsx-ref-table">
          <thead><tr><th>Type</th><th>Destination</th><th>Sent</th><th>Status</th><th>Response</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>{r.type}</strong><span className="pmsx-mini">{r.id} · from <a href="#/appointment">{fmtDay(REFERRAL_APPOINTMENT.at)} visit</a></span></td>
              <td>{r.destination ? <>{r.destination.provider}{r.destination.kind === "controlled" && <span className="pmsx-mini pmsx-mini-synth">SYNTHETIC TEST PROVIDER</span>}<span className="pmsx-mini">Fax {r.destination.fax}</span></> : <span className="pi-muted">Not selected</span>}</td>
              <td>{out ? fmtDay(out.createdAt) : "—"}{out?.mode === "simulated" && <span className="pmsx-mini">simulated</span>}</td>
              <td><StatusPill tone={rs.tone}>{rs.label}</StatusPill></td>
              <td>{r.response ? <>Received {fmtDay(r.response.receivedAt)} <a href={`#/fax/inbox/${r.response.inboxId}`}>View fax</a><span className="pmsx-mini">“{r.response.summary}”</span></> : <span className="pi-muted">None</span>}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="pmsx-card">
        <h2>Recent documents &amp; activity</h2>
        <ul className="pmsx-activity">{activity.map((a, i) => <li key={i}><span className="pmsx-kind">{a.kind}</span>{a.href ? <a href={a.href}>{a.text}</a> : <span>{a.text}</span>}<span className="pi-muted">{fmt(a.at)}</span></li>)}</ul>
      </div>
    </section>
  );
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// ── Appointment Summary — the primary entry point ────────────────────────────

function AppointmentSummary({ st, now, onFind }: { st: PmsState; now: number; onFind: () => void }) {
  const a = REFERRAL_APPOINTMENT;
  const r = st.referral;
  const rs = referralStatus(st, now);
  const out = st.outbox.find((o) => o.id === r.outboxId);
  return (
    <section>
      <div className="pmsx-crumbs">Patients › {PMS_PATIENT.name} › Appointment {fmtDay(a.at)}</div>
      <PatientHeader />
      <div className="pmsx-grid">
        <div className="pmsx-card">
          <h2>Appointment</h2>
          <dl className="pmsx-dl"><dt>Date</dt><dd>{fmtDay(a.at)} · {fmtTime(a.at)}</dd><dt>Type</dt><dd>{a.type}</dd><dt>Provider</dt><dd>{a.with}</dd><dt>Location</dt><dd>{PMS_CLINIC.displayName}</dd><dt>Status</dt><dd>{a.status}</dd><dt>ID</dt><dd className="pi-mono">{a.id}</dd></dl>
          <h3 className="pmsx-h3">Visit note <span className="pi-muted">(synthetic, display only — nothing reads it)</span></h3>
          <div className="pmsx-note-text">{VISIT_NOTE.map((l) => <p key={l}>{l}</p>)}</div>
        </div>
        <div className="pmsx-card">
          <h2>Plan &amp; orders</h2>
          <dl className="pmsx-dl pmsx-structured">
            <dt>Referral required</dt><dd><strong>YES</strong></dd>
            <dt>Referral type</dt><dd><strong>{a.referral!.type}</strong></dd>
            <dt>Recorded by</dt><dd>{a.referral!.recordedBy} · {fmt(a.referral!.recordedAt)}</dd>
          </dl>
          <p className="pi-muted pmsx-fine">Structured fields entered by the audiologist. The software does not infer the referral or its type from the visit note.</p>
          <dl className="pmsx-dl"><dt>Follow-up</dt><dd>Hearing aid consultation · {fmtDay(PMS_APPOINTMENTS[0].at)}</dd></dl>
        </div>
      </div>

      <div className={`pmsx-callout pmsx-callout-${r.response ? "done" : r.outboxId ? "sent" : "todo"}`} data-testid="referral-callout">
        <div className="pmsx-callout-icon"><Icon name={r.response ? "check" : "send"} /></div>
        <div className="pmsx-callout-main">
          <div className="pmsx-callout-k">Referral</div>
          <div className="pmsx-callout-t">{r.type} referral {r.response ? "— response received" : r.outboxId ? "" : "required"}</div>
          {r.destination ? <div>Destination: <strong>{r.destination.provider}</strong> · {r.destination.practice}{r.destination.kind === "controlled" && <span className="pmsx-mini-synth pmsx-inline"> SYNTHETIC TEST PROVIDER</span>} · fax <span className="pi-mono">{r.destination.fax}</span></div> : <div className="pi-muted">No destination selected yet.</div>}
          <div className="pmsx-callout-status"><StatusPill tone={rs.tone}>{rs.label}</StatusPill> <span className="pi-muted">{rs.detail}</span></div>
          {r.response && <div className="pmsx-callout-resp">“{r.response.summary}”{r.response.followUp && <> · Follow-up: {r.response.followUp}</>}</div>}
        </div>
        <div className="pmsx-callout-act">
          {!r.destination && <button className="pi-btn pi-btn-primary pmsx-find" onClick={onFind}><Icon name="search" /> Find referral destination</button>}
          {r.destination && !r.outboxId && <><a className="pi-btn pi-btn-primary" href="#/referral">Review &amp; send referral <Icon name="chevron" /></a><button className="pi-link" onClick={onFind}>Change destination</button></>}
          {out && !r.response && <a className="pi-btn" href={`#/fax/outbox/${out.id}`}>View in Outbox</a>}
          {r.response && <a className="pi-btn pi-btn-primary" href={`#/fax/inbox/${r.response.inboxId}`}>View response</a>}
        </div>
      </div>
    </section>
  );
}

// ── Outbound referral — composition / confirmation ───────────────────────────

function OutboundReferral({ st, onFind, onSend }: { st: PmsState; onFind: () => void; onSend: () => void }) {
  const d = st.referral.destination;
  const [ok, setOk] = useState(false);
  const [cfg, setCfg] = useState<{ ok: boolean; configured: boolean } | null>(null);
  useEffect(() => { liveFaxConfig().then(setCfg); }, []);
  if (!d) return <section><div className="pmsx-card"><p>No destination selected. <button className="pi-link" onClick={onFind}>Find referral destination</button></p></div></section>;
  const live = canSendLive(d);
  const sent = Boolean(st.referral.outboxId);
  const blocked = live && cfg !== null && !cfg.configured;
  return (
    <section className="pmsx-narrow">
      <div className="pmsx-crumbs">Patients › {PMS_PATIENT.name} › Appointment {fmtDay(REFERRAL_APPOINTMENT.at)} › Outbound referral</div>
      <h1 className="pmsx-h1">Outbound referral</h1>
      <div className="pmsx-card pmsx-compose">
        <dl className="pmsx-dl pmsx-dl-wide">
          <dt>Patient</dt><dd>{PMS_PATIENT.name} <SyntheticChip /> · DOB {PMS_PATIENT.dob} · <span className="pi-mono">{PMS_PATIENT.ref}</span></dd>
          <dt>Referral type</dt><dd><strong>{st.referral.type}</strong> · recorded by {REFERRAL_APPOINTMENT.referral!.recordedBy} ({fmtDay(REFERRAL_APPOINTMENT.at)} visit)</dd>
          <dt>From</dt><dd>{PMS_CLINIC.displayName} · fax {PMS_CLINIC.fax}</dd>
        </dl>
      </div>
      <div className={`pmsx-card pmsx-dest ${d.kind === "controlled" ? "pmsx-dest-synth" : ""}`}>
        <div className="pmsx-dest-h"><h2>Selected destination</h2><Tag k="real">Provider Intelligence</Tag><button className="pi-link" disabled={sent} onClick={onFind}>Change</button></div>
        {d.kind === "controlled" && <div className="rd-controlled-labels">{CONTROLLED.labels.map((l) => <span key={l}>{l}</span>)}</div>}
        <div className="pmsx-dest-name">{d.provider}</div>
        <div className="pi-muted">{d.specialty} · {d.practice}</div>
        <dl className="pmsx-dl pmsx-dl-wide">
          <dt>Address</dt><dd>{d.address}{d.distanceMi != null && <span className="pi-muted"> · {d.distanceMi} mi from clinic</span>}</dd>
          <dt>Phone</dt><dd>{d.phone ?? "—"}</dd>
          <dt>Fax</dt><dd className="pi-mono">{d.fax} <span className="pi-muted">{d.kind === "controlled" ? "controlled test line" : d.faxKind === "referral" ? (d.faxChecked ? "referral fax · wording checked on source page" : "referral fax") : "general fax"}</span></dd>
          {d.kind !== "controlled" && <><dt>{TERMS.verification.label}</dt><dd>{d.providerScore ?? "—"}%</dd><dt>{TERMS.destination.label}</dt><dd>{d.referralScore ?? "—"}%</dd></>}
          {d.npi && <><dt>NPI</dt><dd className="pi-mono">{d.npi}</dd></>}
          {d.faxSources.length > 0 && <><dt>Fax evidence</dt><dd>{d.faxSources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="pmsx-src">{s.domain}</a>)}</dd></>}
        </dl>
        {d.reviewReasons.length > 0 && <div className="pmsx-review"><strong>Chosen from Needs review:</strong><ul>{d.reviewReasons.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        {d.kind === "controlled" && <p className="pi-muted pmsx-fine">Not a real clinician: no NPI, no licence, not from any registry, not scored. Its test specialty (neurology) does not match this ENT referral — it is offered only because it is the controlled fax destination.</p>}
      </div>
      <div className="pmsx-card">
        <h2>Enclosed</h2>
        <p>Synthetic referral letter for {PMS_PATIENT.name} — built by the fax service from the canned synthetic record, never from text typed in the browser. Every page is marked SYNTHETIC TEST · NO REAL PATIENT INFORMATION.</p>
      </div>
      <div className={`pmsx-card pmsx-sendbox ${live ? "pmsx-sendbox-live" : "pmsx-sendbox-sim"}`}>
        {live ? (
          <p><Tag k="real">SRFax</Tag> Sends ONE real fax through SRFax to the controlled line <strong className="pi-mono">{CONTROLLED.fax}</strong> — the only number the server will dial.</p>
        ) : (
          <p><Tag k="sim" /> This is a real provider. The POC <strong>never</strong> faxes real providers: sending is simulated and nothing is transmitted.</p>
        )}
        {blocked && <p className="pi-bad"><Icon name="alert" size={14} /> The fax line isn't configured on this server, so the controlled send can't run here.</p>}
        <label className="rd-approve"><input type="checkbox" checked={ok} disabled={sent} onChange={(e) => setOk(e.target.checked)} /> <span>{live ? `I confirm this synthetic referral may be faxed to ${CONTROLLED.fax}.` : "I understand this send is simulated."}</span></label>
        <button className="pi-btn pi-btn-primary pmsx-send" disabled={!ok || sent || blocked || (live && cfg === null)} onClick={onSend}><Icon name="send" /> {sent ? "Referral sent" : "Send referral"}</button>
      </div>
    </section>
  );
}

// ── Fax workspace: INBOX | OUTBOX | FAX LINE ─────────────────────────────────

function FaxWorkspace({ st, route, now, onSimulate, onDecide }: { st: PmsState; route: Extract<Route, { view: "fax" }>; now: number; onSimulate: () => void; onDecide: (i: InboxItem, confirm: boolean) => void }) {
  const unread = st.inbox.filter((i) => i.unread).length;
  return (
    <section className="pmsx-fax">
      <div className="pmsx-crumbs">Fax</div>
      <div className="pmsx-fax-tabs" role="tablist">
        <a role="tab" className={route.tab === "inbox" ? "on" : ""} href="#/fax/inbox">Inbox {unread > 0 && <span className="pmsx-badge pmsx-badge-inline">{unread}</span>}</a>
        <a role="tab" className={route.tab === "outbox" ? "on" : ""} href="#/fax/outbox">Outbox <span className="pi-muted">{st.outbox.length || ""}</span></a>
        <a role="tab" className={route.tab === "line" ? "on" : ""} href="#/fax/line">Fax line</a>
      </div>
      {route.tab === "outbox" && <Outbox st={st} id={route.id} now={now} />}
      {route.tab === "inbox" && <Inbox st={st} id={route.id} onSimulate={onSimulate} onDecide={onDecide} />}
      {route.tab === "line" && <FaxLine />}
    </section>
  );
}

function Outbox({ st, id, now }: { st: PmsState; id: string | null; now: number }) {
  const sel = st.outbox.find((o) => o.id === id) ?? st.outbox[0] ?? null;
  return (
    <div className="pmsx-mail">
      <ul className="pmsx-list">
        {st.outbox.length === 0 && <li className="pmsx-empty">No outbound faxes yet.</li>}
        {st.outbox.map((o) => {
          const t = transportOf(o, now);
          return (
            <li key={o.id}><a className={`pmsx-row ${sel?.id === o.id ? "on" : ""}`} href={`#/fax/outbox/${o.id}`} data-state={t.state}>
              <span className="pmsx-row-top"><strong>{o.patientName}</strong><span className="pi-muted">{fmtTime(o.createdAt)}</span></span>
              <span>{o.referralType} Referral · {o.destination.kind === "controlled" ? CONTROLLED.role : o.destination.provider}</span>
              <span className="pmsx-row-st"><TransportPill t={t} />{o.mode === "simulated" ? <Tag k="sim" /> : <Tag k="real">SRFax</Tag>}</span>
            </a></li>
          );
        })}
      </ul>
      <div className="pmsx-detail">{sel ? <OutboxDetail o={sel} now={now} /> : <p className="pi-muted">Select a fax.</p>}</div>
    </div>
  );
}

function TransportPill({ t }: { t: Transport }) {
  const text = t.state === "sending" || t.state === "preparing" || t.state === "queued" ? `${t.label}…` : t.done && t.tone === "good" ? `${t.label} ✓` : t.label;
  return <StatusPill tone={t.tone}>{text}</StatusPill>;
}

function OutboxDetail({ o, now }: { o: OutboxItem; now: number }) {
  const t = transportOf(o, now);
  const l = o.live;
  const s = l?.status;
  return (
    <div className="pmsx-od" data-testid="outbox-detail">
      <div className="pmsx-od-head">
        <div>
          <div className="pmsx-od-k">{o.patientName} · {o.referralType} Referral · {o.destination.provider}{o.destination.kind === "controlled" && ` — ${CONTROLLED.role}`}</div>
          <div className={`pmsx-od-state pmsx-od-${t.tone}`}>{t.tone === "busy" && <span className="pi-spinner" />}{t.label}{t.done && t.tone === "good" ? " ✓" : t.tone === "busy" ? "…" : ""}</div>
        </div>
        {o.mode === "simulated" ? <Tag k="sim">nothing transmitted</Tag> : <Tag k="real">SRFax transmission</Tag>}
      </div>
      <Lifecycle t={t} />
      <div className="pmsx-claim"><strong>{t.claim}</strong><div className="pi-muted">Evidence: {t.source}.{t.notProven.length > 0 && <> Does not establish {t.notProven.join("; ")}.</>}</div></div>
      <div className="pmsx-od-grid">
        <dl className="pmsx-dl">
          <dt>Patient</dt><dd>{o.patientName} <span className="pi-mono pi-muted">{o.patientRef}</span> (synthetic)</dd>
          <dt>Referral</dt><dd>{o.referralType} · {o.referralId} · appt {REFERRAL_APPOINTMENT.id}</dd>
          <dt>Destination</dt><dd>{o.destination.provider}<div className="pi-muted">{o.destination.practice}</div></dd>
          <dt>Fax number</dt><dd className="pi-mono">{o.destination.fax}</dd>
          <dt>Reference</dt><dd className="pi-mono">{o.id}</dd>
        </dl>
        <dl className="pmsx-dl">
          <dt>Created</dt><dd>{fmt(o.createdAt)}</dd>
          {l && <><dt>Submitted</dt><dd>{l.faxId ? fmt(l.submittedAt) : "—"}</dd>
            <dt>FaxDetailsID</dt><dd className="pi-mono">{l.faxId ?? "—"}</dd>
            <dt>SRFax status</dt><dd>{s?.sentStatus || "—"}</dd>
            <dt>Queued (SRFax)</dt><dd>{s?.dateQueued ?? "—"}</dd>
            <dt>Sent (SRFax)</dt><dd>{s?.dateSent ?? "—"}</dd>
            <dt>Pages</dt><dd>{s?.pages ?? "—"}</dd>
            <dt>Duration</dt><dd>{s?.duration != null ? `${s.duration}s` : "—"}</dd>
            <dt>ErrorCode</dt><dd>{s?.errorCode ?? "—"}</dd>
            <dt>Last checked</dt><dd>{l.lastCheckedAt ? fmt(l.lastCheckedAt) : "—"}</dd></>}
          {!l && <><dt>Pages</dt><dd>— (simulated)</dd><dt>FaxDetailsID</dt><dd>— (simulated: no SRFax job)</dd></>}
        </dl>
      </div>
      {l && (
        <div className="pmsx-ops">
          <div className="pmsx-ops-row"><Tag k="real">Get_FaxStatus polling</Tag> every {POLL_MS / 1000}s until a final status — this is what updates the Outbox.</div>
          <div className="pmsx-ops-row"><Tag k={l.callbackRegistered ? "real" : "future"}>SRFax completion callback</Tag> {l.callbackRegistered ? (l.callback ? <>received {fmt(l.callback.receivedAt)} · “{l.callback.claimedStatus}” · {l.callback.verified ? "verified against Get_FaxStatus" : "not verified"} · {l.callback.deliveries} deliver{l.callback.deliveries === 1 ? "y" : "ies"}</> : "registered (sNotifyURL) · not observed by the server instance that answered the last status check") : "not registered for this fax (needs a public https server)"}</div>
          <div className="pmsx-ops-row"><Tag k="real">Endpoint receipt check</Tag> {l.receipt ? (l.receipt.found ? <>matching inbound fax found on the controlled line ({l.receipt.receivedAt ?? "time n/a"})</> : <>no match yet — {l.receipt.basis}</>) : t.state === "sent" ? "checking the controlled line's SRFax inbox…" : "runs after SRFax reports Sent"}</div>
        </div>
      )}
      {l && l.events.length > 0 && (
        <ol className="pmsx-events">{l.events.map((e, i) => <li key={i}><span className="pmsx-ev-t">{fmt(e.at)}</span><strong>{e.label}</strong> <span className="pi-muted">{e.detail}</span></li>)}</ol>
      )}
      {l?.error && <div className="rd-live-err"><Icon name="alert" size={14} /> {l.error}</div>}
    </div>
  );
}

const LIFECYCLE: { key: string; label: string }[] = [{ key: "preparing", label: "Preparing" }, { key: "queued", label: "Queued" }, { key: "sending", label: "Sending" }, { key: "sent", label: "Sent" }, { key: "received", label: "Received by endpoint" }];

function Lifecycle({ t }: { t: Transport }) {
  const bad = t.state === "failed" || t.state === "not_sent";
  const idx = bad ? -1 : LIFECYCLE.findIndex((x) => x.key === t.state);
  return (
    <ol className="pmsx-life">
      {LIFECYCLE.map((x, i) => <li key={x.key} className={bad ? "" : i < idx || (i === idx && t.done) ? "done" : i === idx ? "now" : ""}>{x.label}</li>)}
      {bad && <li className="bad">{t.label}</li>}
    </ol>
  );
}

// ── Inbox + document intelligence review ─────────────────────────────────────

const STAGE_LABEL: Record<InboxItem["stage"], string> = { received: "New", ocr: "Reading text…", extracting: "Extracting…", matching: "Matching…", review: "Needs confirmation", confirmed: "Associated", rejected: "Not associated" };

function Inbox({ st, id, onSimulate, onDecide }: { st: PmsState; id: string | null; onSimulate: () => void; onDecide: (i: InboxItem, confirm: boolean) => void }) {
  const sel = st.inbox.find((i) => i.id === id) ?? st.inbox[0] ?? null;
  const out = st.outbox.find((o) => o.id === st.referral.outboxId);
  const realDest = Boolean(out && out.destination.kind !== "controlled");
  return (
    <>
      <div className="pmsx-sim-bar">
        <button className="pi-btn pmsx-sim-btn" disabled={realDest} onClick={onSimulate}><Icon name="fax" /> Simulate inbound fax</button>
        <span className="pi-muted"><Tag k="sim">operator/demo action</Tag> {realDest
          ? <>This referral went to a real provider (simulated send). The POC never fabricates a reply from a real provider, so there is no simulated response. Send the referral to the synthetic test destination to demo the inbound loop.</>
          : <>SRFax offers no inbound callback. This creates a synthetic response fax from the controlled synthetic destination and hands it to the same inbound-event boundary a future SRFax Get_Fax_Inbox poller would call.</>}</span>
      </div>
      <div className="pmsx-mail">
        <ul className="pmsx-list">
          {st.inbox.length === 0 && <li className="pmsx-empty">Inbox is empty.</li>}
          {st.inbox.map((i) => (
            <li key={i.id}><a className={`pmsx-row ${sel?.id === i.id ? "on" : ""} ${i.unread ? "unread" : ""}`} href={`#/fax/inbox/${i.id}`}>
              <span className="pmsx-row-top"><strong>{i.fromFax}</strong><span className="pi-muted">{fmtTime(i.receivedAt)}</span></span>
              <span>{i.pages} page · {i.stage === "confirmed" ? `${PMS_PATIENT.name} · referral response` : "Unfiled"}</span>
              <span className="pmsx-row-st"><StatusPill tone={i.stage === "confirmed" ? "good" : i.stage === "rejected" ? "bad" : i.stage === "review" ? "todo" : "busy"}>{STAGE_LABEL[i.stage]}</StatusPill>{i.source === "simulated" && <Tag k="sim" />}</span>
            </a></li>
          ))}
        </ul>
        <div className="pmsx-detail">{sel ? <InboxDetail i={sel} onDecide={onDecide} /> : <p className="pi-muted">No faxes.</p>}</div>
      </div>
    </>
  );
}

function InboxDetail({ i, onDecide }: { i: InboxItem; onDecide: (i: InboxItem, confirm: boolean) => void }) {
  const p = i.processing;
  const busy = !p;
  const stages = ["ocr", "extracting", "matching", "review"];
  const at = stages.indexOf(i.stage);
  return (
    <div className="pmsx-doc" data-testid="inbox-detail">
      <div className="pmsx-od-head">
        <div>
          <div className="pmsx-od-k">From {i.fromFax} · to {i.toFax} · {i.pages} page · received {fmt(i.receivedAt)}</div>
          <div className="pmsx-od-state">{STAGE_LABEL[i.stage]}</div>
        </div>
        <Tag k="sim">inbound fax</Tag>
      </div>
      <ol className="pmsx-life pmsx-pipe">
        <li className="done">Received</li>
        {["Text extraction (OCR)", "Structured extraction (AI)", "Match proposal", "Human confirmation"].map((x, k) => <li key={x} className={i.stage === "confirmed" || i.stage === "rejected" || k < at ? "done" : k === at ? "now" : ""}>{x}</li>)}
      </ol>
      <div className="pmsx-cols">
        <div className="pmsx-col">
          <div className="pmsx-col-h">1 · Source document <Tag k="sim" /></div>
          <div className="pmsx-faxpage">{i.document.lines.map((l, k) => <div key={k} className={l === SIMULATED_BANNER ? "pmsx-fp-banner" : l.startsWith("RE:") ? "pmsx-fp-re" : ""}>{l || " "}</div>)}</div>
        </div>
        <div className="pmsx-col">
          <div className="pmsx-col-h">2 · Extracted text <Tag k="sim">OCR</Tag></div>
          {p ? <><p className="pmsx-engine">{p.ocr.engine}</p><pre className="pmsx-pre">{p.ocr.text}</pre></> : <Working busy={busy && at <= 0} label="Reading text…" />}
        </div>
        <div className="pmsx-col">
          <div className="pmsx-col-h">3 · AI / structured interpretation <Tag k="sim">AI</Tag></div>
          {p ? (
            <><p className="pmsx-engine">{p.extraction.engine}</p>
              <dl className="pmsx-fields">{p.extraction.fields.map((f) => <div key={f.key}><dt>{f.label}</dt><dd>{f.value ?? <span className="pi-muted">Not stated</span>}{f.evidence && <span className="pmsx-evidence">source: “{f.evidence}”</span>}</dd></div>)}</dl></>
          ) : <Working busy={at === 1} label="Extracting fields…" />}
        </div>
        <div className="pmsx-col">
          <div className="pmsx-col-h">4 · Proposed PMS update <Tag k="real">matching rules</Tag></div>
          {p ? <MatchPanel i={i} onDecide={onDecide} /> : <Working busy={at === 2} label="Matching to patients and referrals…" />}
        </div>
      </div>
    </div>
  );
}

function Working({ busy, label }: { busy: boolean; label: string }) {
  return <p className="pi-muted">{busy ? <><span className="pi-spinner" /> {label}</> : "Waiting…"}</p>;
}

function MatchPanel({ i, onDecide }: { i: InboxItem; onDecide: (i: InboxItem, confirm: boolean) => void }) {
  const m = i.processing!.match;
  if (!m.found) return <div className="pmsx-nomatch"><strong>No match proposed.</strong> Name and date of birth must both match a chart before anything is suggested. The fax stays unfiled in the Inbox.</div>;
  return (
    <div className="pmsx-match" data-testid="match">
      <div className="pmsx-match-h">{i.stage === "confirmed" ? "ASSOCIATED" : i.stage === "rejected" ? "NOT ASSOCIATED" : "MATCH FOUND"}</div>
      <div className="pmsx-match-who">{m.patientName} <span className="pi-mono pi-muted">{m.patientRef}</span></div>
      {m.referralId ? <>
        <div>{REFERRAL_APPOINTMENT.referral!.type} referral · {m.referralId}</div>
        <div>Appointment {fmtDay(REFERRAL_APPOINTMENT.at)} <span className="pi-mono pi-muted">{m.appointmentId}</span></div>
      </> : <div className="pmsx-nomatch">Patient only — not linked to a referral (not from the referral's destination, or no reference).</div>}
      <div className="pmsx-match-score">Match evidence: {m.checks.filter((c) => c.ok).length} of {m.checks.length} checks · {m.score}%</div>
      <ul className="pmsx-checks">{m.checks.map((c) => <li key={c.label} className={c.ok ? "ok" : "no"}><Icon name={c.ok ? "check" : "x"} size={12} /> <strong>{c.label}</strong> <span className="pi-muted">{c.detail}</span></li>)}</ul>
      <div className="pmsx-col-sub">If confirmed, the PMS will:</div>
      <ul className="pmsx-update">{m.update.map((u) => <li key={u}>{u}</li>)}</ul>
      {i.stage === "review" ? (
        <div className="pmsx-decide">
          <button className="pi-btn pi-btn-primary pmsx-confirm" onClick={() => onDecide(i, true)}><Icon name="check" /> Confirm association</button>
          <button className="pi-btn" onClick={() => onDecide(i, false)}>Not this patient</button>
        </div>
      ) : <p className="pi-muted">{i.stage === "confirmed" ? "Confirmed by staff" : "Rejected by staff"} {fmt(i.decidedAt)}. {i.stage === "confirmed" && <a href="#/patient">Patient summary</a>}</p>}
      <p className="pi-muted pmsx-fine">Nothing on the chart changes until a person confirms. Transport receipt and this response say nothing about clinical acceptance beyond what the document itself states.</p>
    </div>
  );
}

// ── Fax line ─────────────────────────────────────────────────────────────────

function FaxLine() {
  const [cfg, setCfg] = useState<{ ok: boolean; configured: boolean } | null>(null);
  useEffect(() => { liveFaxConfig().then(setCfg); }, []);
  const status = cfg === null ? "Checking…" : !cfg.ok ? "Unreachable" : cfg.configured ? "Active" : "Not configured";
  const rows = useMemo(() => [
    ["Outbound to the controlled test line", "real", "SRFax Queue_Fax; server-fixed number; server-built synthetic PDF"],
    ["Outbound to real providers", "sim", "Never transmitted — the server refuses any other destination"],
    ["Outbound status", "real", "Get_FaxStatus polling (SRFax's documented source of truth)"],
    ["Outbound completion callback", "real", "SRFax sNotifyURL: one POST on completion, per fax; no documented signature — HMAC in URL + re-verify"],
    ["Receipt by endpoint", "real", "Controlled line's own SRFax inbox (Get_Fax_Inbox), own fax only"],
    ["Inbound arrival", "sim", "SRFax offers no inbound callback — simulated adapter; a Get_Fax_Inbox poller is the future path"],
    ["OCR / AI extraction", "sim", "Deterministic stand-ins behind named adapters; no OCR engine or model is called"],
  ] as const, []);
  return (
    <div className="pmsx-card pmsx-line">
      <dl className="pmsx-dl pmsx-dl-wide">
        <dt>Clinic fax (PMS record)</dt><dd className="pi-mono">{PMS_CLINIC.fax} <span className="pi-muted">fictional</span></dd>
        <dt>Live fax line</dt><dd className="pi-mono">{CONTROLLED.fax} <span className="pi-muted">SRFax · controlled test line</span></dd>
        <dt>Status</dt><dd className={status === "Active" ? "pi-good" : status === "Checking…" ? "" : "pi-bad"}><strong>{status}</strong></dd>
      </dl>
      <table className="pmsx-table">
        <thead><tr><th>Capability</th><th></th><th>How</th></tr></thead>
        <tbody>{rows.map(([a, k, c]) => <tr key={a}><td>{a}</td><td><Tag k={k} /></td><td className="pi-muted">{c}</td></tr>)}</tbody>
      </table>
      <p><a href="/npi-list/fax-settings">Open fax line settings →</a> <span className="pi-muted">(test send, number transfer prototype)</span></p>
    </div>
  );
}
