// ── Fake PMS — state + fax lifecycle wording (SYNTHETIC POC) ──────────────────
// Pure: no DOM, no network — tested in tests/npi-pms.test.ts.
//
// The PMS keeps a referral, an Outbox and an Inbox. Outbox items for the
// controlled synthetic destination carry a REAL SRFax record (LiveFax); items for
// real providers are SIMULATED and say so. Transport wording uses the strongest
// state the evidence supports and nothing more:
//   SRFax "Sent"            → Sent            (transmission completed)
//   endpoint inbox match    → Received by endpoint
//   never                   → read / reviewed / accepted
import type { Destination } from "../demo/model";
import type { LiveFax } from "../demo/live";
import { PMS_PATIENT, REFERRAL_APPOINTMENT } from "./data";
import type { InboxItem } from "./inbound";

export interface OutboxItem {
  id: string; // also the fax reference sent to SRFax as AccountCode
  referralId: string;
  patientRef: string;
  patientName: string;
  referralType: string;
  destination: Destination;
  createdAt: string;
  mode: "live" | "simulated";
  live: LiveFax | null; // live mode only
  notified?: TransportState; // last transport state the PMS announced
}

export interface PmsReferral {
  id: string;
  appointmentId: string;
  type: string; // "ENT" — recorded by the audiologist
  typeValue: string; // Provider Intelligence referral type
  destination: Destination | null;
  selectedAt: string | null;
  outboxId: string | null;
  response: { inboxId: string; receivedAt: string; confirmedAt: string; summary: string; followUp: string | null } | null;
}

export interface PmsNotice { id: string; at: string; text: string; tone: "info" | "good" | "bad"; href: string | null; read: boolean }

export interface PmsState {
  v: 1;
  referral: PmsReferral;
  outbox: OutboxItem[];
  inbox: InboxItem[];
  notices: PmsNotice[];
}

export function freshState(): PmsState {
  return {
    v: 1,
    referral: { id: "REF-DEMO-0001", appointmentId: REFERRAL_APPOINTMENT.id, type: REFERRAL_APPOINTMENT.referral!.type, typeValue: REFERRAL_APPOINTMENT.referral!.referralTypeValue, destination: null, selectedAt: null, outboxId: null, response: null },
    outbox: [],
    inbox: [],
    notices: [],
  };
}

export const newOutboxId = (now = Date.now()) => `PMS-${now.toString(36).toUpperCase()}`.slice(0, 20);

export function createOutbox(st: PmsState, destination: Destination, mode: OutboxItem["mode"], live: LiveFax | null, now = new Date()): OutboxItem {
  return {
    id: live?.reference ?? newOutboxId(now.getTime()),
    referralId: st.referral.id,
    patientRef: PMS_PATIENT.ref,
    patientName: PMS_PATIENT.name,
    referralType: st.referral.type,
    destination,
    createdAt: now.toISOString(),
    mode,
    live,
  };
}

// ── Transport state ──────────────────────────────────────────────────────────

export type TransportState = "preparing" | "queued" | "sending" | "sent" | "received" | "failed" | "not_sent";

export interface Transport {
  state: TransportState;
  label: string;
  tone: "busy" | "good" | "bad";
  done: boolean;
  claim: string; // what the evidence establishes
  source: string; // where that evidence came from
  notProven: string[];
}

const NOT_PROVEN = ["that a person has read it", "that the referral was reviewed or accepted", "that an appointment exists"];

// SIMULATED timeline for real providers — nothing is transmitted.
export const SIM_STEPS: [number, TransportState][] = [[0, "preparing"], [1500, "queued"], [3500, "sending"], [7000, "sent"]];

export function simulatedState(createdAt: string, now = Date.now()): TransportState {
  const t = now - Date.parse(createdAt);
  let s: TransportState = "preparing";
  for (const [ms, st] of SIM_STEPS) if (t >= ms) s = st;
  return s;
}

export function transportOf(item: OutboxItem, now = Date.now()): Transport {
  if (item.mode === "simulated" || !item.live) {
    const state = simulatedState(item.createdAt, now);
    const label = { preparing: "Preparing", queued: "Queued", sending: "Sending", sent: "Sent", received: "Sent", failed: "Failed", not_sent: "Not sent" }[state];
    return {
      state, label: `${label} (simulated)`, tone: state === "sent" ? "good" : "busy", done: state === "sent",
      claim: "SIMULATED — nothing was transmitted. Real providers are never faxed by this POC.",
      source: "Simulated timeline in this browser", notProven: ["that anything was sent", ...NOT_PROVEN],
    };
  }
  const l = item.live;
  const verbatim = l.status?.sentStatus ? `SRFax SentStatus “${l.status.sentStatus}”` : null;
  switch (l.phase) {
    case "submitting":
      return { state: "preparing", label: "Preparing", tone: "busy", done: false, claim: "The server is building the synthetic PDF and submitting it to SRFax.", source: "This app", notProven: ["that SRFax accepted it", ...NOT_PROVEN] };
    case "error":
      return { state: "not_sent", label: "Not sent", tone: "bad", done: true, claim: l.error ?? "SRFax did not accept the fax.", source: "SRFax Queue_Fax / fax service", notProven: [] };
    case "submitted":
      return { state: "queued", label: "Queued", tone: "busy", done: false, claim: `SRFax accepted the fax (FaxDetailsID ${l.faxId}). No transmission status yet.`, source: "SRFax Queue_Fax", notProven: ["that it has been dialled or transmitted", ...NOT_PROVEN] };
    case "in_progress":
      return { state: "sending", label: "Sending", tone: "busy", done: false, claim: `SRFax reports the fax is in progress (${verbatim ?? "no status"}).`, source: "SRFax Get_FaxStatus", notProven: ["that transmission has completed", ...NOT_PROVEN] };
    case "failed":
      return { state: "failed", label: "Failed", tone: "bad", done: true, claim: `SRFax reports the transmission failed${l.status?.errorCode ? ` (${l.status.errorCode})` : ""}.`, source: "SRFax Get_FaxStatus", notProven: [] };
    case "sent":
      if (l.receipt?.found) {
        return { state: "received", label: "Received by endpoint", tone: "good", done: true, claim: `SRFax reports the transmission completed, and the controlled line's own SRFax inbox shows a matching inbound fax${l.receipt.receivedAt ? ` (${l.receipt.receivedAt})` : ""}.`, source: "SRFax Get_FaxStatus + Get_Fax_Inbox (controlled line)", notProven: NOT_PROVEN };
      }
      return { state: "sent", label: "Sent", tone: "good", done: true, claim: `SRFax reports the transmission completed (${verbatim}).`, source: "SRFax Get_FaxStatus", notProven: ["who operates the receiving machine", ...NOT_PROVEN] };
  }
}

// ── Referral status, as the PMS shows it ─────────────────────────────────────

export interface ReferralStatus { label: string; tone: "todo" | "busy" | "good" | "bad"; detail: string }

export function referralStatus(st: PmsState, now = Date.now()): ReferralStatus {
  const r = st.referral;
  if (r.response) return { label: "Response received", tone: "good", detail: `Response fax associated by staff ${fmt(r.response.confirmedAt)}` };
  const item = st.outbox.find((o) => o.id === r.outboxId);
  if (item) {
    const t = transportOf(item, now);
    const tone = t.tone === "busy" ? "busy" : t.tone;
    const done = t.state === "sent" || t.state === "received";
    return { label: `Fax ${t.label.toLowerCase()}${done ? " — awaiting response" : ""}`, tone, detail: t.claim };
  }
  if (r.destination) return { label: "Destination selected — not sent", tone: "todo", detail: `${r.destination.provider} · fax ${r.destination.fax}` };
  return { label: "Referral required — no destination yet", tone: "todo", detail: "Recorded by the audiologist at this visit." };
}

export const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export function notice(text: string, tone: PmsNotice["tone"], href: string | null, now = new Date()): PmsNotice {
  return { id: `N-${now.getTime().toString(36)}-${Math.floor(Math.random() * 1e4)}`, at: now.toISOString(), text, tone, href, read: false };
}
