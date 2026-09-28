// ── CONTROLLED live test fax — client side (SYNTHETIC POC ONLY) ──────────────
// Talks to /api/npi-fax, which holds the SRFax credentials and the only live
// destination. Real providers never come here: canSendLive() is false for
// anything but the controlled synthetic destination, and the server refuses too.
//
// What SRFax reports is OPERATIONAL evidence about a transmission. It is kept in
// its own record (LiveFax), never merged into the Destination, and never feeds
// provider verification, destination confidence or referral fit.
import { CONTROLLED } from "./controlled";
import type { Destination } from "./model";

export const canSendLive = (d: Pick<Destination, "kind" | "npi" | "fax">) =>
  d.kind === "controlled" && d.npi === null && d.fax === CONTROLLED.fax;

export interface SrfaxStatus {
  sentStatus: string; // verbatim SRFax SentStatus: "In Progress" | "Sent" | "Failed" | "Sending Email"
  phase: "in_progress" | "sent" | "failed" | "unknown";
  dateQueued: string | null;
  dateSent: string | null;
  epochTime: string | null;
  toFaxNumber: string | null;
  pages: number | null;
  duration: number | null;
  errorCode: string | null;
  remoteId: string | null;
  accountCode?: string | null;
}

// SRFax's completion callback (sNotifyURL), as processed by the server instance
// that answered the status lookup. Best-effort: absence means "not observed here".
export interface CallbackSeen { receivedAt: string; claimedStatus: string; verifiedStatus: string | null; verified: boolean; deliveries: number }

// Evidence that the controlled endpoint received the fax: its own SRFax inbox
// shows a matching inbound fax. Not "read", not "accepted".
export interface EndpointReceipt { found: boolean; receivedAt: string | null; pages: number | null; receiveStatus: string | null; basis: string; counts?: { inbox: number; fromOurCallerId: number; unreadableDates: number } }

export interface LiveFax {
  mode: "live";
  reference: string; // our reference, sent to SRFax as sAccountCode
  to: string; // always the controlled number
  phase: "submitting" | "submitted" | "in_progress" | "sent" | "failed" | "error";
  faxId: string | null; // SRFax FaxDetailsID
  statusToken: string | null; // issued by the server with the send; required for status lookups
  submittedAt: string;
  lastCheckedAt: string | null;
  status: SrfaxStatus | null; // latest Get_FaxStatus result, verbatim
  error: string | null; // SRFax/transport failure, verbatim — never turned into success
  events: { at: string; label: string; detail: string }[];
  callbackRegistered?: boolean; // server registered SRFax's sNotifyURL for this fax
  callback?: CallbackSeen | null;
  receipt?: EndpointReceipt | null; // latest endpoint-inbox check
  receiptChecks?: number;
}

export const liveDone = (l: LiveFax) => l.phase === "sent" || l.phase === "failed" || l.phase === "error";

export function newLiveFax(reference: string, now = new Date()): LiveFax {
  return { mode: "live", reference, to: CONTROLLED.fax, phase: "submitting", faxId: null, statusToken: null, submittedAt: now.toISOString(), lastCheckedAt: null, status: null, error: null, events: [{ at: now.toISOString(), label: "Prepared", detail: "Synthetic test referral PDF built on the server from the canned scenario" }] };
}

type SendResponse = { ok: true; faxId: string; statusToken: string; to: string; submittedAt: string; callbackRegistered?: boolean } | { ok: false; error: string; code?: string };
type StatusResponse = { ok: true; checkedAt: string; status: SrfaxStatus; callback?: CallbackSeen | null } | { ok: false; error: string; code?: string };
export type ReceiptResponse = { ok: true; checkedAt: string; receipt: EndpointReceipt } | { ok: false; error: string; code?: string };

export function applySend(l: LiveFax, r: SendResponse, now = new Date()): LiveFax {
  const at = now.toISOString();
  if (!r.ok) return { ...l, phase: "error", error: r.error, events: [...l.events, { at, label: "Not submitted", detail: r.error }] };
  return { ...l, phase: "submitted", faxId: r.faxId, statusToken: r.statusToken, submittedAt: r.submittedAt, callbackRegistered: Boolean(r.callbackRegistered), events: [...l.events, { at: r.submittedAt, label: "Submitted to SRFax", detail: `FaxDetailsID ${r.faxId}` }] };
}

export function applyStatus(l: LiveFax, r: StatusResponse, now = new Date()): LiveFax {
  const at = now.toISOString();
  if (!r.ok) return { ...l, lastCheckedAt: at, error: r.error }; // a failed lookup is not a fax failure; keep polling
  const s = r.status;
  const phase: LiveFax["phase"] = s.phase === "sent" ? "sent" : s.phase === "failed" ? "failed" : "in_progress";
  const changed = l.status?.sentStatus !== s.sentStatus;
  const detail = [s.errorCode && `ErrorCode ${s.errorCode}`, s.pages != null && `${s.pages} page${s.pages === 1 ? "" : "s"}`, s.dateSent && `DateSent ${s.dateSent}`].filter(Boolean).join(" · ") || "Reported by Get_FaxStatus";
  const cb = r.callback ?? l.callback ?? null;
  const cbNew = Boolean(r.callback && !l.callback);
  const events = [...l.events];
  if (changed) events.push({ at: r.checkedAt, label: `SRFax: ${s.sentStatus || "(no status)"}`, detail });
  if (cbNew) events.push({ at: r.callback!.receivedAt, label: "SRFax completion callback", detail: `${r.callback!.claimedStatus || "(no status)"} · ${r.callback!.verified ? "verified against Get_FaxStatus" : "NOT verified"}` });
  return { ...l, phase, status: s, lastCheckedAt: r.checkedAt, error: null, callback: cb, events };
}

// Receipt only ever upgrades evidence; a miss or a failed lookup never downgrades "Sent".
export function applyReceipt(l: LiveFax, r: ReceiptResponse): LiveFax {
  const checks = (l.receiptChecks ?? 0) + 1;
  if (!r.ok) return { ...l, receiptChecks: checks };
  if (l.receipt?.found) return { ...l, receiptChecks: checks };
  const events = r.receipt.found ? [...l.events, { at: r.checkedAt, label: "Received by endpoint", detail: `Controlled line's SRFax inbox shows the fax${r.receipt.receivedAt ? ` (${r.receipt.receivedAt})` : ""} · ${r.receipt.basis}` }] : l.events;
  return { ...l, receipt: r.receipt, receiptChecks: checks, events };
}

// What an SRFax result does and does not establish. Deliberately separate
// from the three provider questions.
export function operationalEvidence(l: LiveFax): { claim: string; notProven: string[] } {
  const claim = l.phase === "sent" ? "SRFax reports successful delivery to this fax endpoint."
    : l.phase === "failed" ? `SRFax reports the transmission failed${l.status?.errorCode ? ` (${l.status.errorCode})` : ""}.`
    : l.phase === "error" ? "The fax was not accepted by SRFax, or SRFax couldn't be reached."
    : "SRFax has accepted the fax and reports it is still in progress.";
  return {
    claim,
    notProven: [
      "who owns or answers this fax endpoint",
      "that the endpoint is appropriate for referrals",
      "that a person read the fax",
      "that a clinical referral was accepted",
    ],
  };
}

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/npi-fax", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try { return (await res.json()) as T; } catch { return { ok: false, error: `Fax service error (${res.status})` } as T; }
}

// ok:false means the fax service couldn't be reached — distinct from "reachable but not configured".
export const liveFaxConfig = () => post<{ ok: boolean; configured: boolean; destination: string }>({ action: "config" }).catch(() => ({ ok: false, configured: false, destination: CONTROLLED.fax }));

export function sendLiveFax(d: Destination, scenarioId: string, reference: string, letterhead: "demo" | "pms" = "demo"): Promise<SendResponse> {
  if (!canSendLive(d)) return Promise.resolve({ ok: false, code: "forbidden", error: "Live fax is only available for the controlled synthetic test destination." });
  return post<SendResponse>({ action: "send", destinationId: CONTROLLED.id, scenarioId, reference, letterhead }).catch(() => ({ ok: false as const, error: "Couldn't reach the fax service — the fax may or may not have been queued. Check the SRFax portal before retrying." }));
}

export const liveFaxStatus = (faxId: string, statusToken: string) => post<StatusResponse>({ action: "status", faxId, statusToken }).catch(() => ({ ok: false as const, error: "Couldn't reach the fax service for status." }));

export const liveFaxReceipt = (faxId: string, statusToken: string) => post<ReceiptResponse>({ action: "receipt", faxId, statusToken }).catch(() => ({ ok: false as const, error: "Couldn't reach the fax service for the receipt check." }));
