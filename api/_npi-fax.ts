// ── NPI demo — CONTROLLED live test fax via SRFax (TEMPORARY, SYNTHETIC ONLY) ──
// The one place in the demo that can place a real fax. Hard boundary:
//   • the only destination is the controlled synthetic one (../src/npi/demo/controlled.ts);
//     the fax number is a constant here — it is never read from the request;
//   • the document is built on the server from the canned synthetic scenario
//     (never from browser-edited text), so no free text can reach the fax;
//   • SRFax credentials live only in the server environment (SRFAX_*).
// Real providers can't reach this: the handler refuses any other destination id.
//
// SRFax API (https://www.srfax.com/api-page/): POST form fields to
// SRF_SecWebSvc.php. Queue_Fax → { Status: "Success", Result: FaxDetailsID } or
// { Status: "Failed", Result: reason }. Get_FaxStatus → Result { SentStatus:
// "In Progress" | "Sent" | "Failed" | "Sending Email", DateQueued, DateSent,
// Pages, Duration, ErrorCode, ... }.
import { CONTROLLED, CONTROLLED_FAX } from "../src/npi/demo/controlled";
import { DEMO_CLINIC, SCENARIOS, parseRecord } from "../src/npi/demo/model";

export const SRFAX_URL = "https://secure.srfax.com/SRF_SecWebSvc.php";

// SRFax wants 11 digits: country code + number.
export const LIVE_TO = "1" + CONTROLLED_FAX.replace(/\D/g, "");

export interface SrfaxConfig { accessId: string; accessPwd: string; callerId: string; senderEmail: string }

export function srfaxConfig(env: Record<string, string | undefined> = process.env): SrfaxConfig | null {
  const accessId = env.SRFAX_ACCESS_ID?.trim();
  const accessPwd = env.SRFAX_ACCESS_PWD?.trim();
  const callerId = env.SRFAX_CALLER_ID?.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const senderEmail = env.SRFAX_SENDER_EMAIL?.trim();
  if (!accessId || !accessPwd || !callerId || callerId.length !== 10 || !senderEmail) return null;
  return { accessId, accessPwd, callerId, senderEmail };
}

// The live branch exists for exactly one destination.
export function liveDestinationAllowed(destinationId: unknown): boolean {
  return destinationId === CONTROLLED.id;
}

// ── The synthetic test document ─────────────────────────────────────────────

export const DOC_BANNER = ["SYNTHETIC TEST REFERRAL", "NO REAL PATIENT INFORMATION", "NOT FOR CLINICAL USE"];

export function referralLines(scenarioId: string, reference: string, now = new Date()): string[] | null {
  const s = SCENARIOS.find((x) => x.id === scenarioId);
  if (!s) return null;
  const p = parseRecord(s.record); // the canned synthetic record, never the browser's edited copy
  return [
    ...DOC_BANNER,
    "",
    "Controlled SRFax integration test - Outbound Referral Workflow proof of concept.",
    `Date: ${now.toISOString().slice(0, 16).replace("T", " ")} UTC    Reference: ${reference}`,
    "",
    "TO:",
    `  ${CONTROLLED.name}`,
    `  ${CONTROLLED.role} - SYNTHETIC TEST PROVIDER, NOT A REAL CLINICIAN`,
    "  Controlled SRFax Test Destination",
    `  Fax: ${CONTROLLED_FAX}`,
    "",
    "FROM:",
    `  ${DEMO_CLINIC.name} (fictional) - ${DEMO_CLINIC.audiologist}`,
    `  Phone ${DEMO_CLINIC.phone} - Fax ${DEMO_CLINIC.fax} (reserved fictional numbers)`,
    "",
    `SYNTHETIC PATIENT: ${p.name} - DOB ${p.dob} (fictional)`,
    `Referral type (selected by the synthetic audiologist): ${s.referralType}`,
    `Priority: ${s.priority}`,
    "",
    "Reason for referral:",
    ...p.reason.split("\n").map((l) => `  ${l}`),
    "",
    "Audiology findings (synthetic):",
    ...p.audiology.split("\n").map((l) => `  ${l}`),
    "",
    "Relevant history (synthetic):",
    ...p.history.split("\n").map((l) => `  ${l}`),
    "",
    "This document was generated to test fax transmission only. Every person,",
    "number and finding above is fictional. Please discard.",
    "",
    ...DOC_BANNER,
  ];
}

// ── A minimal one-page text PDF (Helvetica, ASCII) — no dependencies ────────

const pdfEsc = (s: string) => s.replace(/[^\x20-\x7e]/g, "-").replace(/([\\()])/g, "\\$1");

function wrap(line: string, width = 88): string[] {
  if (line.length <= width) return [line];
  const indent = line.match(/^\s*/)![0];
  const out: string[] = [];
  let cur = "";
  for (const w of line.trim().split(/\s+/)) {
    if ((indent + cur + " " + w).length > width && cur) { out.push(indent + cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(indent + cur);
  return out;
}

export function textPdf(lines: string[]): Uint8Array {
  const body = lines.flatMap((l) => wrap(l));
  const ops: string[] = ["BT"];
  let y = 752;
  body.forEach((l, i) => {
    const banner = i < DOC_BANNER.length || i >= body.length - DOC_BANNER.length;
    const size = banner ? 15 : 10;
    ops.push(`/${banner ? "F2" : "F1"} ${size} Tf 1 0 0 1 54 ${y} Tm (${pdfEsc(l)}) Tj`);
    y -= banner ? 18 : 12;
  });
  ops.push("ET");
  const stream = ops.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf); // ASCII only, so string offsets are byte offsets
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// ── Requests ────────────────────────────────────────────────────────────────

export function queueFaxForm(cfg: SrfaxConfig, pdf: Uint8Array, reference: string): URLSearchParams {
  const form = new URLSearchParams({
    action: "Queue_Fax",
    access_id: cfg.accessId,
    access_pwd: cfg.accessPwd,
    sCallerID: cfg.callerId,
    sSenderEmail: cfg.senderEmail,
    sFaxType: "SINGLE",
    sToFaxNumber: LIVE_TO,
    sResponseFormat: "JSON",
    sAccountCode: reference.slice(0, 20),
    sRetries: "1",
    sFaxFromHeader: "SYNTHETIC TEST - NO PHI",
    sFileName_1: "synthetic-test-referral.pdf",
    sFileContent_1: base64(pdf),
  });
  // Belt and braces: whatever happens above, nothing else is ever dialled.
  if (form.get("sToFaxNumber") !== LIVE_TO || form.getAll("sToFaxNumber").length !== 1) throw new Error("live fax destination guard");
  return form;
}

export function faxStatusForm(cfg: SrfaxConfig, faxId: string): URLSearchParams {
  return new URLSearchParams({ action: "Get_FaxStatus", access_id: cfg.accessId, access_pwd: cfg.accessPwd, sFaxDetailsID: faxId, sResponseFormat: "JSON" });
}

// ── Responses (SRFax's own vocabulary is kept verbatim) ─────────────────────

export type QueueResult = { ok: true; faxId: string } | { ok: false; error: string };

export function parseQueue(json: unknown): QueueResult {
  const r = json as { Status?: string; Result?: unknown } | null;
  if (r?.Status === "Success" && r.Result != null && /^\d+$/.test(String(r.Result).trim())) return { ok: true, faxId: String(r.Result).trim() };
  return { ok: false, error: r?.Status === "Failed" ? `SRFax: ${String(r.Result ?? "unknown failure")}` : "Unexpected response from SRFax" };
}

export interface FaxStatus {
  sentStatus: string; // verbatim SRFax SentStatus
  phase: "in_progress" | "sent" | "failed" | "unknown";
  dateQueued: string | null;
  dateSent: string | null;
  epochTime: string | null;
  toFaxNumber: string | null;
  pages: number | null;
  duration: number | null;
  errorCode: string | null;
  remoteId: string | null;
}

export function phaseOf(sentStatus: string): FaxStatus["phase"] {
  const s = sentStatus.trim().toLowerCase();
  if (s === "sent") return "sent";
  if (s === "failed") return "failed";
  if (s === "in progress" || s === "sending email") return "in_progress";
  return "unknown";
}

export type StatusResult = { ok: true; status: FaxStatus } | { ok: false; error: string };

export function parseStatus(json: unknown): StatusResult {
  const r = json as { Status?: string; Result?: unknown } | null;
  if (r?.Status !== "Success") return { ok: false, error: `SRFax: ${typeof r?.Result === "string" ? r.Result : "status lookup failed"}` };
  const row = (Array.isArray(r.Result) ? r.Result[0] : r.Result) as Record<string, unknown> | undefined;
  if (!row || typeof row !== "object") return { ok: false, error: "SRFax returned no status" };
  const str = (k: string) => (row[k] == null || row[k] === "" ? null : String(row[k]));
  const num = (k: string) => (str(k) === null || Number.isNaN(Number(row[k])) ? null : Number(row[k]));
  const sentStatus = str("SentStatus") ?? "";
  return {
    ok: true,
    status: {
      sentStatus, phase: phaseOf(sentStatus),
      dateQueued: str("DateQueued"), dateSent: str("DateSent"), epochTime: str("EpochTime"), toFaxNumber: str("ToFaxNumber"),
      pages: num("Pages"), duration: num("Duration"), errorCode: str("ErrorCode"), remoteId: str("RemoteID"),
    },
  };
}
