// ── Fax line settings + "keep your existing number" prototype (SYNTHETIC POC) ─
// /npi-list/fax-settings. The status and the test send are REAL: they use
// /api/npi-fax exactly like the referral workflow's controlled live test — same
// synthetic destination, same server-fixed number, same server-built document.
// The number-transfer flow is a UX PROTOTYPE ONLY: nothing is submitted, no
// portability is checked, no carrier or SRFax porting API is called (none is
// integrated). It says so on every step.
import { useEffect, useState } from "react";
import { Icon } from "../ui";
import { CONTROLLED, controlledDestination } from "./controlled";
import { applySend, applyStatus, liveDone, liveFaxConfig, liveFaxStatus, newLiveFax, sendLiveFax, type LiveFax } from "./live";
import "./demo.css";

const LAST_KEY = "npi-fax-admin:last-test";
const DEMO_KEY = "npi-referral-demo:v2"; // the referral workflow's session state (its live test, if any)

function loadLast(): LiveFax | null {
  const read = (s: Storage, k: string, pick: (v: unknown) => unknown) => { try { const raw = s.getItem(k); return raw ? (pick(JSON.parse(raw)) as LiveFax | null) : null; } catch { return null; } };
  const mine = read(localStorage, LAST_KEY, (v) => v);
  const workflow = read(sessionStorage, DEMO_KEY, (v) => (v as { live?: LiveFax | null })?.live ?? null);
  return [mine, workflow].filter((x): x is LiveFax => Boolean(x?.submittedAt)).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0] ?? null;
}

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function FaxSettings() {
  const [cfg, setCfg] = useState<{ ok: boolean; configured: boolean } | null>(null);
  const [last, setLast] = useState<LiveFax | null>(loadLast);
  const [confirm, setConfirm] = useState(false);
  const [polls, setPolls] = useState(0);
  const [transfer, setTransfer] = useState(false);

  useEffect(() => { liveFaxConfig().then(setCfg); }, []);
  useEffect(() => { if (last) try { localStorage.setItem(LAST_KEY, JSON.stringify(last)); } catch { /* best-effort */ } }, [last]);

  const refresh = () => {
    if (!last?.faxId || !last.statusToken) return;
    const id = last.faxId;
    liveFaxStatus(id, last.statusToken).then((r) => setLast((l) => (l?.faxId === id ? applyStatus(l, r) : l)));
  };
  const polling = Boolean(last?.faxId && !liveDone(last) && last.phase !== "submitting");
  useEffect(() => {
    if (!polling || polls >= 60) return;
    const t = setTimeout(() => { refresh(); setPolls((n) => n + 1); }, polls === 0 ? 1500 : 6000);
    return () => clearTimeout(t);
  }, [polling, polls, last?.lastCheckedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => {
    const reference = `ADM-${Date.now().toString(36).toUpperCase()}`;
    const start = newLiveFax(reference);
    setLast(start);
    setConfirm(false);
    setPolls(0);
    sendLiveFax(controlledDestination(), "A", reference).then((r) => setLast((l) => (l?.reference === reference ? applySend(l, r) : l)));
  };

  const status = cfg === null ? { text: "Checking…", cls: "" } : !cfg.ok ? { text: "Unreachable", cls: "pi-bad" } : cfg.configured ? { text: "Active", cls: "pi-good" } : { text: "Not configured", cls: "pi-bad" };
  const busy = last?.phase === "submitting";

  return (
    <div className="pi rd">
      <header className="rd-top">
        <a className="pi-brand" href="/npi-list/referral-demo"><span className="pi-logo rd-logo"><Icon name="fax" /></span><span>Outbound Referral Workflow</span></a>
        <span className="rd-poc">Synthetic POC</span>
        <div className="rd-top-links" style={{ marginLeft: "auto" }}><a href="/npi-list/referral-demo">← Referral workflow</a></div>
      </header>

      <main className="rd-main rd-narrow">
        <div className="rd-head">
          <div className="rd-kicker">Settings · Fax</div>
          <h1>Fax line</h1>
          <p>The clinic fax line used for outbound referrals. In this POC the only live destination is the controlled synthetic test line; real providers are always simulated.</p>
        </div>

        <div className="rd-card fx-line">
          <dl className="fx-grid">
            <dt>Fax number</dt><dd className="pi-mono fx-num">{CONTROLLED.fax}</dd>
            <dt>Status</dt><dd className={status.cls}><strong>{status.text}</strong>{cfg && !cfg.configured && cfg.ok && <span className="pi-muted"> — SRFax credentials are not set in this server's environment</span>}</dd>
            <dt>Provider</dt><dd>SRFax <span className="pi-muted">(internal POC integration)</span></dd>
            <dt>Outbound scope</dt><dd>Controlled test destination only · real providers are always simulated</dd>
          </dl>
        </div>

        <div className="rd-card fx-test">
          <div className="rd-card-label"><Icon name="send" size={14} /> Send controlled test fax</div>
          <p className="pi-muted">Sends ONE real synthetic test document, built on the server, to {CONTROLLED.fax} (the controlled line — the only number the server will dial). Every page is marked SYNTHETIC TEST · NO REAL PATIENT INFORMATION.</p>
          {cfg?.configured ? (
            <div className="fx-send">
              <label className="rd-approve"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={busy} /> <span>Send one real test fax to {CONTROLLED.fax}.</span></label>
              <button className="pi-btn pi-btn-primary" disabled={!confirm || busy || polling} onClick={send}><Icon name="fax" /> Send test fax</button>
            </div>
          ) : cfg && <div className="rd-live-off"><Icon name="alert" size={14} /> Test sending is unavailable: the fax line is {status.text.toLowerCase()}.</div>}

          <div className="fx-recent">
            <div className="rd-card-label">Recent controlled test</div>
            {!last ? <p className="pi-muted">No controlled test fax recorded in this browser.</p> : (
              <div>
                <div><strong className={last.phase === "sent" ? "pi-good" : last.phase === "failed" || last.phase === "error" ? "pi-bad" : ""}>
                  {last.phase === "submitting" ? "Submitting to SRFax…" : last.phase === "error" ? "Not sent" : last.status ? `SRFax: ${last.status.sentStatus}` : "Submitted to SRFax"}
                </strong> <span className="pi-muted">· reference <span className="pi-mono">{last.reference}</span>{last.faxId && <> · FaxDetailsID <span className="pi-mono">{last.faxId}</span></>}</span></div>
                <div className="pi-muted">Submitted {time(last.submittedAt)}{last.status?.dateSent && <> · SRFax DateSent {last.status.dateSent}</>}{last.status?.pages != null && <> · {last.status.pages} page{last.status.pages === 1 ? "" : "s"}</>}{last.lastCheckedAt && <> · last checked {time(last.lastCheckedAt)}</>}</div>
                {last.error && <div className="rd-live-err"><Icon name="alert" size={14} /> {last.error}</div>}
                {last.faxId && last.statusToken && <button className="pi-link" onClick={refresh}>{polling ? <><span className="pi-spinner" /> Checking status…</> : "Check status now"}</button>}
                <p className="pi-muted rd-fine">SRFax status is operational evidence about this transmission only. It changes no provider verification, destination evidence or referral fit.</p>
              </div>
            )}
          </div>
        </div>

        <div className="rd-card fx-port">
          <div className="fx-port-head">
            <div>
              <div className="rd-card-label"><Icon name="refresh" size={14} /> Transfer an existing fax number</div>
              <h3>Keep your existing fax number.</h3>
              <p className="pi-muted">Bring the number referring offices already use, instead of asking them to update their records.</p>
            </div>
            {!transfer && <button className="pi-btn" onClick={() => setTransfer(true)}>Start transfer</button>}
          </div>
          {transfer && <TransferFlow onClose={() => setTransfer(false)} />}
        </div>
      </main>

      <footer className="pi-foot rd-foot">Personal proof of concept — not production software. <a href="/npi-list/referral-demo">Referral workflow</a> · <a href="/npi-list">Provider search</a></footer>
    </div>
  );
}

// ── Number transfer — PROTOTYPE ONLY ─────────────────────────────────────────

const STEPS = ["Number", "Portability", "Proof", "Details", "Authorize", "Status"] as const;

function TransferFlow({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [number, setNumber] = useState("");
  const [bill, setBill] = useState<string | null>(null);
  const [details, setDetails] = useState({ clinic: "", account: "", carrier: "", address: "", contact: "" });
  const [sign, setSign] = useState({ name: "", title: "", agree: false });
  const digits = number.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const pretty = digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : number;
  const can = [digits.length === 10, true, Boolean(bill), Boolean(details.clinic && details.account && details.carrier), Boolean(sign.name && sign.agree), false][step];
  const field = (k: keyof typeof details, label: string) => (
    <label className="fx-field"><span>{label}</span><input value={details[k]} onChange={(e) => setDetails({ ...details, [k]: e.target.value })} /></label>
  );

  return (
    <div className="fx-flow">
      <div className="fx-proto"><Icon name="info" size={14} /> <span><strong>Prototype — not connected.</strong> This walks through the transfer experience only. Nothing you enter is submitted or stored on a server, no carrier is contacted, and there is no automated porting integration in this POC.</span></div>
      <ol className="fx-steps">{STEPS.map((s, i) => <li key={s} className={i < step ? "rd-done" : i === step ? "rd-now" : ""}><span>{i < step ? <Icon name="check" size={11} /> : i + 1}</span>{s}</li>)}</ol>

      {step === 0 && (
        <div>
          <label className="fx-field"><span>Existing fax number</span><input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="(206) 555-0142" inputMode="tel" /></label>
          {number && digits.length !== 10 && <p className="pi-bad rd-fine">Enter a 10-digit US or Canadian number.</p>}
        </div>
      )}
      {step === 1 && (
        <div className="fx-future">
          <p><strong>{pretty}</strong></p>
          <p><Icon name="alert" size={14} /> <strong>Portability check: not automated (future / manual integration).</strong> This POC cannot check whether this number can be transferred. In a real rollout, portability would be confirmed manually with the fax provider and the current carrier before anything is submitted.</p>
          <p className="pi-muted">No result is shown here because none was obtained.</p>
        </div>
      )}
      {step === 2 && (
        <div>
          <p className="pi-muted">A recent bill or account statement from the current carrier shows the number, account name and service address.</p>
          <label className="fx-field"><span>Recent bill / account proof</span><input type="file" accept=".pdf,image/*" onChange={(e) => setBill(e.target.files?.[0]?.name ?? null)} /></label>
          {bill && <p className="rd-fine"><Icon name="check" size={12} /> {bill} selected — kept in this browser tab only, not uploaded.</p>}
        </div>
      )}
      {step === 3 && (
        <div className="fx-fields">
          {field("clinic", "Clinic / account holder name")}
          {field("account", "Account number with current carrier")}
          {field("carrier", "Current carrier")}
          {field("address", "Service address on the account")}
          {field("contact", "Authorized contact (name, phone)")}
        </div>
      )}
      {step === 4 && (
        <div>
          <div className="fx-review">
            <div><span className="pi-muted">Number</span> {pretty}</div>
            <div><span className="pi-muted">Account holder</span> {details.clinic}</div>
            <div><span className="pi-muted">Carrier / account</span> {details.carrier} · {details.account}</div>
            <div><span className="pi-muted">Proof</span> {bill}</div>
          </div>
          <div className="fx-fields">
            <label className="fx-field"><span>Authorizing signer (typed name)</span><input value={sign.name} onChange={(e) => setSign({ ...sign, name: e.target.value })} /></label>
            <label className="fx-field"><span>Title</span><input value={sign.title} onChange={(e) => setSign({ ...sign, title: e.target.value })} /></label>
          </div>
          <label className="rd-approve"><input type="checkbox" checked={sign.agree} onChange={(e) => setSign({ ...sign, agree: e.target.checked })} /> <span>I am authorized to request transfer of this number (letter of authorization). <em>Prototype — this signature is not recorded or sent.</em></span></label>
        </div>
      )}
      {step === 5 && (
        <div className="fx-future">
          <p><strong>Transfer status: not submitted.</strong></p>
          <p>This prototype does not create transfer requests. In a real rollout this screen would track the request through submitted → carrier review → scheduled → complete, with dates reported by the provider. None of those states exist for {pretty} because no request was made.</p>
          <p className="pi-muted">Your existing number keeps working with its current carrier.</p>
        </div>
      )}

      <div className="fx-nav">
        <button className="pi-btn" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>{step === 0 ? "Cancel" : "Back"}</button>
        {step < 5 && <button className="pi-btn pi-btn-primary" disabled={!can} onClick={() => setStep(step + 1)}>{step === 4 ? "Authorize (prototype)" : "Continue"} <Icon name="chevron" /></button>}
        {step === 5 && <button className="pi-btn" onClick={onClose}>Close</button>}
      </div>
    </div>
  );
}
