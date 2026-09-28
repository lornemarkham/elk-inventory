// ── Inbound fax + document intelligence boundary (SYNTHETIC POC) ──────────────
// Pure: no DOM, no network — tested in tests/npi-pms.test.ts.
//
// SRFax has NO inbound callback (its API offers Get_Fax_Inbox polling and
// Retrieve_Fax only). So inbound arrival here comes from an explicitly SIMULATED
// adapter that produces the same InboundFaxEvent a future Get_Fax_Inbox poller
// would produce, and hands it to the same boundary: receiveInboundFax().
//
// The document pipeline mirrors the future shape
//   source document → OCR/text → AI structured extraction → match proposal → human
// with each stage behind a named adapter. In this POC:
//   • OCR is SIMULATED: the text comes from the synthetic document's own source
//     lines; no image recognition runs.
//   • "AI" extraction is SIMULATED by deterministic rules over that text. No model
//     is called.
//   • Matching is real deterministic code, run against synthetic PMS records.
//   • Nothing changes the chart until a human confirms (see PmsApp).
import { CONTROLLED } from "../demo/controlled";
import { PMS_CLINIC, PMS_PATIENT } from "./data";
import type { OutboxItem, PmsReferral } from "./model";

export interface SourceDocument { kind: "text-fax"; pages: number; lines: string[] }

export interface InboundFaxEvent {
  source: "simulated" | "srfax"; // "srfax" is the future Get_Fax_Inbox adapter — not built
  externalId: string;
  receivedAt: string;
  fromFax: string;
  toFax: string;
  pages: number;
  document: SourceDocument;
}

export interface ExtractedField { key: string; label: string; value: string | null; evidence: string | null }

export interface Processing {
  ocr: { engine: string; simulated: true; text: string };
  extraction: { engine: string; simulated: true; fields: ExtractedField[] };
  match: MatchProposal;
}

export interface MatchCheck { label: string; ok: boolean; detail: string; weight: number }

export interface MatchProposal {
  found: boolean;
  patientRef: string | null;
  patientName: string | null;
  referralId: string | null;
  appointmentId: string | null;
  outboxId: string | null;
  checks: MatchCheck[];
  score: number; // 0–100, share of weighted checks that passed
  update: string[]; // the proposed PMS changes, in words
}

export interface InboxItem {
  id: string;
  source: InboundFaxEvent["source"];
  externalId: string;
  receivedAt: string;
  fromFax: string;
  toFax: string;
  pages: number;
  document: SourceDocument;
  unread: boolean;
  stage: "received" | "ocr" | "extracting" | "matching" | "review" | "confirmed" | "rejected";
  processing: Processing | null;
  decidedAt: string | null;
}

// ── SIMULATED inbound adapter ────────────────────────────────────────────────
// Only ever "from" the controlled synthetic destination: a response from a real,
// named provider would be a fabricated interaction, so the POC never makes one.

export const SIMULATED_BANNER = "SIMULATED INBOUND FAX - SYNTHETIC - NO REAL PATIENT INFORMATION";

export function simulatedInboundEvent(outbound: OutboxItem | null, now = new Date()): InboundFaxEvent {
  const date = now.toISOString().slice(0, 10);
  const lines = [
    SIMULATED_BANNER,
    "",
    "FAX",
    `From: ${CONTROLLED.name} - ${CONTROLLED.role} (SYNTHETIC TEST PROVIDER)`,
    `From fax: ${CONTROLLED.fax}`,
    `To: ${PMS_CLINIC.name}`,
    `To fax: ${PMS_CLINIC.fax}`,
    `Date: ${date}`,
    "Pages: 1",
    "",
    "RE: REFERRAL RESPONSE",
    "",
    `Patient: ${PMS_PATIENT.name}`,
    `DOB: ${PMS_PATIENT.dob}`,
    `Your reference: ${outbound?.id ?? "(none given)"}`,
    `Referral type: ${outbound ? "ENT / Otolaryngology" : "(not stated)"}`,
    "",
    "Response: Referral received. Our office will contact the patient to schedule a consultation.",
    "Follow-up: Consultation to be scheduled by our office. A consult note will follow the visit.",
    "",
    `Office of ${CONTROLLED.name} (synthetic)`,
    "",
    "This document was generated for a product demo. Every person and number is fictional.",
    SIMULATED_BANNER,
  ];
  return { source: "simulated", externalId: `SIM-IN-${now.getTime().toString(36).toUpperCase()}`, receivedAt: now.toISOString(), fromFax: CONTROLLED.fax, toFax: PMS_CLINIC.fax, pages: 1, document: { kind: "text-fax", pages: 1, lines } };
}

// ── The internal boundary every inbound source calls ─────────────────────────
// Idempotent on (source, externalId): a duplicate delivery is ignored.

export function receiveInboundFax(inbox: InboxItem[], ev: InboundFaxEvent): { inbox: InboxItem[]; item: InboxItem; duplicate: boolean } {
  const existing = inbox.find((i) => i.source === ev.source && i.externalId === ev.externalId);
  if (existing) return { inbox, item: existing, duplicate: true };
  const item: InboxItem = { id: `IN-${ev.externalId}`, source: ev.source, externalId: ev.externalId, receivedAt: ev.receivedAt, fromFax: ev.fromFax, toFax: ev.toFax, pages: ev.pages, document: ev.document, unread: true, stage: "received", processing: null, decidedAt: null };
  return { inbox: [item, ...inbox], item, duplicate: false };
}

// ── Stage 1: OCR (SIMULATED) ─────────────────────────────────────────────────

export const OCR_ENGINE = "SIMULATED OCR — text taken from the synthetic document source; no image recognition";

export function simulatedOcr(doc: SourceDocument): Processing["ocr"] {
  return { engine: OCR_ENGINE, simulated: true, text: doc.lines.join("\n") };
}

// ── Stage 2: structured extraction (SIMULATED "AI" — deterministic rules) ────

export const EXTRACT_ENGINE = "SIMULATED AI extraction — deterministic rules stand in for a model; no AI is called";

const FIELD_RULES: { key: string; label: string; re: RegExp }[] = [
  { key: "patient", label: "Patient", re: /^Patient:\s*(.+)$/im },
  { key: "dob", label: "Date of birth", re: /^DOB:\s*(.+)$/im },
  { key: "reference", label: "Our reference", re: /^Your reference:\s*([A-Z0-9-]+)\s*$/im },
  { key: "referralType", label: "Referral type", re: /^Referral type:\s*(?!\(not stated\))(.+)$/im },
  { key: "from", label: "Responding provider", re: /^From:\s*(.+)$/im },
  { key: "fromFax", label: "Responding fax", re: /^From fax:\s*(.+)$/im },
  { key: "date", label: "Document date", re: /^Date:\s*(\d{4}-\d{2}-\d{2})\s*$/im },
  { key: "docType", label: "Document type", re: /^RE:\s*(REFERRAL RESPONSE|CONSULT NOTE|APPOINTMENT CONFIRMATION)\s*$/im },
  { key: "summary", label: "Response summary", re: /^Response:\s*(.+)$/im },
  { key: "followUp", label: "Follow-up (only if explicitly stated)", re: /^Follow-up:\s*(.+)$/im },
];

export function extractFields(text: string): Processing["extraction"] {
  const fields = FIELD_RULES.map(({ key, label, re }) => {
    const m = text.match(re);
    const value = m ? m[1].trim() : null;
    return { key, label, value: key === "docType" && value ? value.charAt(0) + value.slice(1).toLowerCase() : value, evidence: m ? m[0].trim() : null };
  });
  return { engine: EXTRACT_ENGINE, simulated: true, fields };
}

export const field = (x: Processing["extraction"], key: string) => x.fields.find((f) => f.key === key)?.value ?? null;

// ── Stage 3: match proposal (real deterministic rules, synthetic records) ────

const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const digits = (s: string | null) => (s ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

export function proposeMatch(x: Processing["extraction"], referral: PmsReferral, outbox: OutboxItem[]): MatchProposal {
  const sent = outbox.find((o) => o.id === referral.outboxId) ?? null;
  const ref = field(x, "reference");
  const type = field(x, "referralType");
  const checks: MatchCheck[] = [
    { label: "Patient name", weight: 20, ok: norm(field(x, "patient")) === norm(PMS_PATIENT.name), detail: `Document “${field(x, "patient") ?? "—"}” · chart “${PMS_PATIENT.name}”` },
    { label: "Date of birth", weight: 20, ok: field(x, "dob") === PMS_PATIENT.dob, detail: `Document ${field(x, "dob") ?? "—"} · chart ${PMS_PATIENT.dob}` },
    { label: "Our outbound reference", weight: 35, ok: Boolean(ref && sent && ref === sent.id), detail: sent ? `Document “${ref ?? "none"}” · Outbox ${sent.id}` : "No referral fax has been sent for this patient" },
    { label: "Referral type", weight: 10, ok: Boolean(type && norm(type).startsWith(norm(referral.type))), detail: `Document “${type ?? "not stated"}” · referral ${referral.type}` },
    { label: "Responding fax = referral destination", weight: 15, ok: Boolean(referral.destination && digits(field(x, "fromFax")) === digits(referral.destination.fax)), detail: `Document ${field(x, "fromFax") ?? "—"} · destination ${referral.destination?.fax ?? "none selected"}` },
  ];
  const total = checks.reduce((n, c) => n + c.weight, 0);
  const score = Math.round((checks.filter((c) => c.ok).reduce((n, c) => n + c.weight, 0) / total) * 100);
  // Identity must match on both name AND DOB before anything is proposed.
  const found = checks[0].ok && checks[1].ok;
  // It only counts as the referral's RESPONSE if it came from the fax we sent the
  // referral to and carries our reference; otherwise it is just a chart document.
  const isResponse = found && checks[2].ok && checks[4].ok;
  const summary = field(x, "summary");
  const follow = field(x, "followUp");
  return {
    found,
    patientRef: found ? PMS_PATIENT.ref : null,
    patientName: found ? PMS_PATIENT.name : null,
    referralId: isResponse ? referral.id : null,
    appointmentId: isResponse ? referral.appointmentId : null,
    outboxId: isResponse && sent ? sent.id : null,
    checks,
    score,
    update: !found ? [] : isResponse ? [
      `Attach this fax to ${PMS_PATIENT.name}'s chart (${PMS_PATIENT.ref})`,
      `Set ${referral.type} referral ${referral.id} status → “Response received”`,
      `Show the response on appointment ${referral.appointmentId}`,
      summary ? `Record response summary: “${summary}”` : "No response summary to record",
      follow ? `Record follow-up as stated: “${follow}”` : "No follow-up stated — none recorded",
    ] : [
      `Attach this fax to ${PMS_PATIENT.name}'s chart (${PMS_PATIENT.ref}) as an unlinked document`,
      `Leave ${referral.type} referral ${referral.id} unchanged — the fax isn't from its destination or lacks our reference`,
    ],
  };
}

export function processDocument(item: InboxItem, referral: PmsReferral, outbox: OutboxItem[]): Processing {
  const ocr = simulatedOcr(item.document);
  const extraction = extractFields(ocr.text);
  return { ocr, extraction, match: proposeMatch(extraction, referral, outbox) };
}
