// ── /npi-list/embed/provider-intelligence — the embeddable Provider Intelligence UI ──
// Loaded by public/npi-sdk/provider-intelligence.js inside a sandboxed iframe.
// It is the EXISTING destination finder (Specialists: NPPES + public-web evidence
// + optional AI research + the three questions + Recommended / Needs review / raw),
// plus the controlled synthetic test destination. No second finder.
//
// Protocol "pi-embed/1": → ready · ← init { referralType, patientContext, clinicContext }
// → destination:selected { destination } · → close. Context arrives by postMessage
// only; nothing identifying goes in the URL. The destination sent back is public
// provider data plus scores — no patient data.
import { useEffect, useState } from "react";
import { Icon } from "../ui";
import Specialists from "../demo/Specialists";
import ControlledCard from "../demo/ControlledCard";
import { controlledDestination } from "../demo/controlled";
import { EMBED_PROTOCOL as PROTOCOL, resolveReferralType } from "./embed";
import type { Destination } from "../demo/model";
import "../demo/demo.css";
import "./pms.css";

// Hosts allowed to drive this UI. POC: the same deployment only.
const ALLOWED_HOSTS = [location.origin];

interface Init {
  referralType: string;
  patientContext: { ref?: string; age?: number } | null;
  clinicContext: { id?: string; searchOrigin?: string } | null;
}

export default function EmbedPI() {
  const [init, setInit] = useState<{ data: Init; origin: string } | null>(null);
  const [radius, setRadius] = useState(10);
  const embedded = window.parent !== window;

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== window.parent || !ALLOWED_HOSTS.includes(ev.origin)) return;
      const m = ev.data as { protocol?: string; type?: string } & Partial<Init>;
      if (m?.protocol !== PROTOCOL || m.type !== "init") return;
      setInit({ data: { referralType: String(m.referralType ?? ""), patientContext: m.patientContext ?? null, clinicContext: m.clinicContext ?? null }, origin: ev.origin });
    };
    window.addEventListener("message", onMessage);
    // "ready" carries no data, so it may go to any parent; everything after goes to the verified origin.
    if (embedded) window.parent.postMessage({ protocol: PROTOCOL, type: "ready" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [embedded]);

  if (!embedded) {
    return <div className="pi rd pmsx-embed"><main className="rd-main"><div className="rd-card rd-note"><Icon name="info" /> This page is the embeddable Provider Intelligence UI. It is opened by a host application through <span className="pi-mono">/npi-sdk/provider-intelligence.js</span>. Try the <a href="/npi-list/pms">demo PMS</a>.</div></main></div>;
  }
  if (!init) return <div className="pi rd pmsx-embed"><main className="rd-main"><div className="rd-card"><span className="pi-spinner" /> Waiting for the host application…</div></main></div>;

  const specialty = resolveReferralType(init.data.referralType);
  const origin = init.data.clinicContext?.searchOrigin?.trim() || "Seattle, WA 98115";
  const age = typeof init.data.patientContext?.age === "number" ? init.data.patientContext.age : null;
  const choose = (destination: Destination) => window.parent.postMessage({ protocol: PROTOCOL, type: "destination:selected", destination }, init.origin);

  return (
    <div className="pi rd pmsx-embed">
      <main className="rd-main">
        <div className="pmsx-embed-head">
          <div>
            <div className="rd-kicker">Provider Intelligence · referral destination</div>
            <h1>Where should this {specialty?.split(" / ")[0] ?? init.data.referralType} referral go?</h1>
            <p className="pi-muted">Searching from the clinic's area ({origin}). Patient context received: synthetic reference <span className="pi-mono">{init.data.patientContext?.ref ?? "—"}</span>{age !== null && <> · age {age} (used only for the pediatric-practice fit rule)</>}.</p>
          </div>
        </div>
        {!specialty ? (
          <div className="rd-card rd-error"><Icon name="alert" /> Unsupported referral type “{init.data.referralType}”. Provider Intelligence never guesses a different one.</div>
        ) : (
          <>
            <div className="rd-requested"><Icon name="stethoscope" size={14} /> Requested referral type: {specialty} · selected by the clinician in the PMS</div>
            <ControlledCard requested={specialty} onChoose={() => choose(controlledDestination())} />
            <Specialists specialty={specialty} location={origin} radius={radius} age={age} flagged={[]} onRadius={setRadius} onSearched={() => {}} onChoose={choose} />
          </>
        )}
      </main>
    </div>
  );
}
