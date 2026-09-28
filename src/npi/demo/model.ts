// ── Fake outbound referral workflow — pure model (SYNTHETIC POC) ──────────────
// Everything here is fictional: patients, clinical text, attachments, the fax
// transport, the fax-provider webhook and the inbound response. Only the
// referral destination (chosen from the real provider search) is real, and
// nothing is ever sent to it. No DOM, no network — tested in tests/npi-demo.test.ts.
import type { ContactNumber, EvidenceSource, PracticeLocation, ReferralResearch } from "../types";

// ── Synthetic patients ────────────────────────────────────────────────────────

export type ScenarioId = "A" | "B" | "C" | "D" | "E" | "F";

export interface Scenario {
  id: ScenarioId;
  title: string;
  patient: string;
  blurb: string;
  priority: "Routine" | "Urgent";
  // The referral type the (synthetic) audiologist already selected. The demo
  // never infers it from the clinical text; the user can change it in step 2.
  referralType: string;
  attachments: AttachmentId[];
  // Air-conduction thresholds (dB HL) at 250, 500, 1k, 2k, 4k, 8k Hz — synthetic.
  audiogram: { right: number[]; left: number[]; bone?: { right: number[]; left: number[] } };
  record: string;
}

export const FREQS = [250, 500, 1000, 2000, 4000, 8000];

const record = (lines: string[]) => lines.join("\n");

export const SCENARIOS: Scenario[] = [
  {
    id: "A",
    title: "Asymmetric hearing loss",
    patient: "Jamie Example",
    blurb: "Left ear worse than right, with poorer word recognition on the left.",
    priority: "Routine",
    referralType: "ENT / Otolaryngology",
    attachments: ["audiogram", "report", "insurance"],
    audiogram: { right: [15, 15, 20, 25, 30, 35], left: [25, 30, 40, 55, 65, 70] },
    record: record([
      "Patient: Jamie Example",
      "DOB: 01/01/1980",
      "Location: Seattle, WA 98115",
      "Phone: (555) 010-0142",
      "Insurance: Example Health PPO",
      "Member ID: DEMO-0000-0001",
      "",
      "Audiology:",
      "Asymmetric sensorineural hearing loss, left worse than right.",
      "Word recognition 96% right, 68% left.",
      "Tympanometry Type A bilaterally.",
      "",
      "Relevant history:",
      "Gradual left-sided hearing change noticed over ~12 months. Intermittent left tinnitus. No vertigo reported.",
      "",
      "Reason for referral:",
      "ENT evaluation of asymmetric sensorineural hearing loss.",
      "",
      "Notes:",
      "Patient prefers morning appointments.",
    ]),
  },
  {
    id: "B",
    title: "Sudden sensorineural hearing loss",
    patient: "Taylor Sample",
    blurb: "Sudden right-sided loss noticed three days ago.",
    priority: "Urgent",
    referralType: "ENT / Otolaryngology",
    attachments: ["audiogram", "report", "insurance"],
    audiogram: { right: [45, 50, 60, 65, 70, 75], left: [10, 10, 15, 15, 20, 25] },
    record: record([
      "Patient: Taylor Sample",
      "DOB: 03/15/1972",
      "Location: Seattle, WA 98115",
      "Phone: (555) 010-0187",
      "Insurance: Example Health HMO",
      "Member ID: DEMO-0000-0002",
      "",
      "Audiology:",
      "Moderate-to-severe sensorineural hearing loss, right ear, new since prior audiogram.",
      "Left ear within normal limits. Tympanometry Type A bilaterally.",
      "",
      "Relevant history:",
      "Woke with right-sided hearing loss and fullness 3 days ago. No recent illness or noise exposure reported.",
      "",
      "Reason for referral:",
      "Urgent ENT evaluation of sudden sensorineural hearing loss, right ear.",
      "",
      "Notes:",
      "Same-week appointment requested.",
    ]),
  },
  {
    id: "C",
    title: "Persistent unilateral tinnitus",
    patient: "Riley Placeholder",
    blurb: "Left-sided tinnitus for six months, near-symmetric hearing.",
    priority: "Routine",
    referralType: "ENT / Otolaryngology",
    attachments: ["audiogram", "report", "insurance"],
    audiogram: { right: [10, 10, 15, 20, 25, 30], left: [10, 15, 15, 25, 30, 35] },
    record: record([
      "Patient: Riley Placeholder",
      "DOB: 07/04/1988",
      "Location: Seattle, WA 98115",
      "Phone: (555) 010-0163",
      "Insurance: Example Health PPO",
      "Member ID: DEMO-0000-0003",
      "",
      "Audiology:",
      "Persistent left-sided tinnitus. Hearing within normal limits to mild high-frequency loss, near-symmetric.",
      "Tinnitus handicap questionnaire: moderate.",
      "",
      "Relevant history:",
      "Constant left tinnitus for ~6 months. No hearing change reported. Occasional headaches.",
      "",
      "Reason for referral:",
      "ENT evaluation of persistent unilateral tinnitus.",
      "",
      "Notes:",
      "Discussed sound therapy options at audiology follow-up.",
    ]),
  },
  {
    id: "D",
    title: "Conductive loss / possible middle-ear pathology",
    patient: "Morgan Demo",
    blurb: "Right conductive loss with a flat tympanogram.",
    priority: "Routine",
    referralType: "ENT / Otolaryngology",
    attachments: ["audiogram", "tymp", "report", "insurance"],
    audiogram: { right: [40, 40, 35, 35, 40, 45], left: [15, 10, 10, 15, 20, 25], bone: { right: [10, 10, 10, 15, 15, 20], left: [10, 10, 10, 15, 20, 25] } },
    record: record([
      "Patient: Morgan Demo",
      "DOB: 11/30/1995",
      "Location: Seattle, WA 98115",
      "Phone: (555) 010-0129",
      "Insurance: Example Health PPO",
      "Member ID: DEMO-0000-0004",
      "",
      "Audiology:",
      "Mild-to-moderate conductive hearing loss, right ear, with ~25 dB air-bone gap.",
      "Tympanometry Type B right, Type A left.",
      "",
      "Relevant history:",
      "Right ear fullness for ~2 months. History of childhood ear infections.",
      "",
      "Reason for referral:",
      "ENT evaluation of right conductive hearing loss and possible middle-ear pathology.",
      "",
      "Notes:",
      "Otoscopy: dull right tympanic membrane.",
    ]),
  },
  {
    id: "F",
    title: "Neurology referral",
    patient: "Jordan Testcase",
    blurb: "The audiologist has chosen a neurology referral per clinic protocol.",
    priority: "Routine",
    referralType: "Neurology",
    attachments: ["audiogram", "report", "insurance"],
    audiogram: { right: [15, 15, 20, 20, 25, 30], left: [15, 20, 20, 25, 25, 30] },
    record: record([
      "Patient: Jordan Testcase",
      "DOB: 02/14/1983",
      "Location: Seattle, WA 98115",
      "Phone: (555) 010-0151",
      "Insurance: Example Health PPO",
      "Member ID: DEMO-0000-0006",
      "",
      "Audiology:",
      "Hearing within normal limits to mild high-frequency loss, symmetric.",
      "Vestibular screening completed; results attached.",
      "",
      "Relevant history:",
      "Episodic dizziness with headaches reported over several months (synthetic).",
      "",
      "Reason for referral:",
      "Neurology evaluation, as selected by the referring audiologist.",
      "",
      "Notes:",
      "Referral type chosen by the audiologist per clinic protocol — not inferred by software.",
    ]),
  },
  {
    id: "E",
    title: "Custom fake referral",
    patient: "Casey Fictional",
    blurb: "Start from a blank synthetic template and write your own.",
    priority: "Routine",
    referralType: "ENT / Otolaryngology",
    attachments: ["report", "insurance"],
    audiogram: { right: [15, 15, 15, 20, 20, 25], left: [15, 15, 15, 20, 20, 25] },
    record: record([
      "Patient: Casey Fictional",
      "DOB: 06/01/1990",
      "Location: Seattle, WA 98115",
      "Phone: (555) 010-0100",
      "Insurance: Example Health PPO",
      "Member ID: DEMO-0000-0005",
      "",
      "Audiology:",
      "(synthetic findings)",
      "",
      "Relevant history:",
      "(synthetic history)",
      "",
      "Reason for referral:",
      "ENT evaluation.",
      "",
      "Notes:",
      "",
    ]),
  },
];

// ── Fake attachments ──────────────────────────────────────────────────────────

export type AttachmentId = "audiogram" | "tymp" | "report" | "insurance";

export interface Attachment {
  id: string; // AttachmentId, or "upload-N" for local files
  name: string;
  label: string;
  pages: number;
  kind: "sample" | "upload";
  size?: number;
}

export const SAMPLE_ATTACHMENTS: Record<AttachmentId, Attachment> = {
  audiogram: { id: "audiogram", name: "audiogram.pdf", label: "Audiogram", pages: 1, kind: "sample" },
  tymp: { id: "tymp", name: "tympanometry.pdf", label: "Tympanometry", pages: 1, kind: "sample" },
  report: { id: "report", name: "audiology-report.pdf", label: "Audiology report", pages: 2, kind: "sample" },
  insurance: { id: "insurance", name: "insurance-card.pdf", label: "Insurance information", pages: 1, kind: "sample" },
};

// ── Parsing the synthetic record ─────────────────────────────────────────────

export interface PatientRecord {
  name: string;
  dob: string;
  location: string;
  phone: string;
  insurance: string;
  memberId: string;
  audiology: string;
  history: string;
  reason: string;
  notes: string;
}

const FIELDS: [keyof PatientRecord, RegExp][] = [
  ["name", /^patient\s*:\s*(.*)$/i],
  ["dob", /^(?:dob|date of birth)\s*:\s*(.*)$/i],
  ["location", /^(?:location|address)\s*:\s*(.*)$/i],
  ["phone", /^phone\s*:\s*(.*)$/i],
  ["insurance", /^insurance\s*:\s*(.*)$/i],
  ["memberId", /^member id\s*:\s*(.*)$/i],
];
const SECTIONS: [keyof PatientRecord, RegExp][] = [
  ["audiology", /^audiology\s*:\s*(.*)$/i],
  ["history", /^(?:relevant )?history\s*:\s*(.*)$/i],
  ["reason", /^reason for referral\s*:\s*(.*)$/i],
  ["notes", /^notes\s*:\s*(.*)$/i],
];

export function parseRecord(text: string): PatientRecord {
  const out: PatientRecord = { name: "", dob: "", location: "", phone: "", insurance: "", memberId: "", audiology: "", history: "", reason: "", notes: "" };
  let section: keyof PatientRecord | null = null;
  const buf: Partial<Record<keyof PatientRecord, string[]>> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const field = FIELDS.find(([, re]) => re.test(line));
    if (field) { out[field[0]] = line.match(field[1])![1].trim(); section = null; continue; }
    const sec = SECTIONS.find(([, re]) => re.test(line));
    if (sec) { section = sec[0]; buf[section] = []; const rest = line.match(sec[1])![1].trim(); if (rest) buf[section]!.push(rest); continue; }
    if (section && line) buf[section]!.push(line);
  }
  for (const [k] of SECTIONS) out[k] = (buf[k] ?? []).join("\n");
  return out;
}

// Age in whole years from MM/DD/YYYY (or ISO); null when unparseable.
export function ageFrom(dob: string, now = new Date()): number | null {
  const m = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) ?? dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = dob.includes("/") ? [+m[3], +m[1], +m[2]] : [+m[1], +m[2], +m[3]];
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

// ZIP (or City, ST ZIP) from the record's location line — the search origin.
export function searchOrigin(location: string): string {
  return location.trim() || "Seattle, WA 98115";
}

// ── Destination fit for THIS (synthetic) patient ─────────────────────────────
// Deterministic context the provider search can't know on its own.

export function pediatricMismatch(text: string, age: number | null): boolean {
  return age !== null && age >= 18 && /pediatric|paediatric|children['’]?s|childrens|\bkids\b/i.test(text);
}

// ── The referral draft ───────────────────────────────────────────────────────

export interface Destination {
  kind: "researched" | "controlled"; // controlled = the synthetic test destination (./controlled.ts)
  npi: string | null;
  provider: string; // display name, e.g. "Clifford Robert Hume, MD"
  specialty: string;
  practice: string;
  address: string;
  distanceMi: number | null;
  phone: string | null;
  fax: string;
  faxKind: "referral" | "general";
  faxChecked: boolean; // referral wording checked on the live source page
  faxLabel: string | null; // verbatim label from the source
  faxSources: { name: string; url: string; domain: string }[];
  providerScore: number | null; // provider verification (null for the synthetic destination)
  referralScore: number | null; // destination confidence
  researchedAt: string | null;
  reviewReasons: string[]; // why it was in "Needs review" when the human chose it
}

export function toDestination(o: { npi: string; name: string; credential: string | null; specialty: string; loc: PracticeLocation; fax: ContactNumber; providerScore: number; researchedAt: string | null; sources: EvidenceSource[]; reviewReasons?: string[] }): Destination {
  const { loc, fax } = o;
  return {
    kind: "researched",
    npi: o.npi,
    provider: o.credential ? `${o.name}, ${o.credential}` : o.name,
    specialty: o.specialty,
    practice: loc.organization && loc.name !== loc.organization && !loc.name.startsWith(loc.organization) ? `${loc.organization} — ${loc.name}` : loc.name,
    address: [loc.line1, loc.line2, `${loc.city}, ${loc.state} ${loc.postalCode}`.trim()].filter(Boolean).join(", "),
    distanceMi: loc.distanceMi,
    phone: loc.phones[0]?.number ?? null,
    fax: fax.number,
    faxKind: fax.faxKind === "referral" ? "referral" : "general",
    faxChecked: fax.faxKind === "referral" && fax.labelCheck === "page",
    faxLabel: fax.label,
    faxSources: fax.sourceIds.map((id) => o.sources.find((s) => s.id === id)).filter((s): s is EvidenceSource => Boolean(s)).map((s) => ({ name: s.name, url: s.url, domain: s.domain })),
    providerScore: o.providerScore,
    referralScore: loc.referral.score,
    researchedAt: o.researchedAt,
    reviewReasons: o.reviewReasons ?? [],
  };
}

export interface ReferralDraft {
  priority: "Routine" | "Urgent";
  reason: string;
  clinical: string;
  question: string;
  coverNote: string;
  attachmentIds: string[];
}

export function draftReferral(p: PatientRecord, s: Scenario, dest: Destination, from = DEMO_CLINIC): ReferralDraft {
  const reason = p.reason.split("\n")[0]?.replace(/\.$/, "") || `${s.referralType.split(" / ")[0]} evaluation`;
  const clinical = [p.audiology, p.history && `History: ${p.history}`].filter(Boolean).join("\n\n");
  return {
    priority: s.priority,
    reason: `${reason}.`,
    clinical,
    question: s.priority === "Urgent" ? "Please evaluate at the earliest available appointment." : "Please evaluate and advise on further management.",
    coverNote: `To ${dest.practice}: please find enclosed a ${s.priority.toLowerCase()} referral from ${from.name} for ${p.name || "the patient named below"}. Contact ${from.phone} with any questions.`,
    attachmentIds: s.attachments.slice(),
  };
}

export const DEMO_CLINIC = { name: "Example Hearing Clinic", audiologist: "A. Demo, AuD", phone: "(555) 010-0000", fax: "(555) 010-0001" };

// Cover sheet + referral letter + each attachment's pages.
export function pageCount(attachments: Attachment[]): number {
  return 2 + attachments.reduce((n, a) => n + a.pages, 0);
}

// ── Fake fax transport ───────────────────────────────────────────────────────
// A deterministic plan the UI plays back with small delays. This is the seam a
// real fax provider (e.g. SRFax) would replace: send → status events → webhook.

export type FaxStage = "preparing" | "queued" | "dialing" | "sending" | "delivered" | "failed";
export type FaxOutcome = "deliver" | "fail";

export interface FaxStep {
  stage: FaxStage;
  label: string;
  detail: string;
  ms: number;
  page?: number; // sending progress
}

export function faxPlan(outcome: FaxOutcome, pages: number, fax: string): FaxStep[] {
  const steps: FaxStep[] = [
    { stage: "preparing", label: "Preparing packet", detail: `Cover sheet + referral letter + attachments · ${pages} pages`, ms: 900 },
    { stage: "queued", label: "Queued", detail: "Waiting for an outbound line (simulated)", ms: 800 },
    { stage: "dialing", label: "Dialing", detail: `Calling ${fax} (simulated — no call is placed)`, ms: 1100 },
  ];
  if (outcome === "fail") {
    steps.push(
      { stage: "dialing", label: "No answer", detail: "No fax tone detected · retrying (attempt 2 of 3)", ms: 1100 },
      { stage: "dialing", label: "No answer", detail: "No fax tone detected · retrying (attempt 3 of 3)", ms: 1100 },
      { stage: "failed", label: "Fax failed", detail: "No fax tone after 3 attempts", ms: 0 },
    );
    return steps;
  }
  for (let p = 1; p <= pages; p++) steps.push({ stage: "sending", label: "Sending", detail: `Page ${p} of ${pages}`, ms: 380, page: p });
  steps.push({ stage: "delivered", label: "Delivered", detail: "Receiving machine confirmed all pages (simulated)", ms: 0 });
  return steps;
}

export interface FaxTransaction {
  id: string; // DEMO-FAX-NNNNN
  createdAt: string;
  completedAt: string | null;
  status: FaxStage;
  outcome: FaxOutcome;
  attempts: number;
  pages: number;
  patient: { name: string; dob: string };
  destination: Destination;
  events: { at: string; stage: FaxStage; label: string; detail: string }[];
}

export function newTransactionId(rand = Math.random): string {
  return `DEMO-FAX-${10000 + Math.floor(rand() * 90000)}`;
}

export function createTransaction(o: { patient: PatientRecord; destination: Destination; pages: number; outcome: FaxOutcome; now?: Date; id?: string }): FaxTransaction {
  return {
    id: o.id ?? newTransactionId(),
    createdAt: (o.now ?? new Date()).toISOString(),
    completedAt: null,
    status: "preparing",
    outcome: o.outcome,
    attempts: 0,
    pages: o.pages,
    patient: { name: o.patient.name, dob: o.patient.dob },
    destination: o.destination,
    events: [],
  };
}

export function applyStep(tx: FaxTransaction, step: FaxStep, now = new Date()): FaxTransaction {
  const at = now.toISOString();
  const attempts = step.stage === "dialing" ? tx.attempts + 1 : tx.attempts;
  const done = step.stage === "delivered" || step.stage === "failed";
  return { ...tx, status: step.stage, attempts, completedAt: done ? at : tx.completedAt, events: [...tx.events, { at, stage: step.stage, label: step.label, detail: step.detail }] };
}

// ── Simulated fax-provider webhook ──────────────────────────────────────────
// What a provider would POST to us when an outbound fax finishes.

export interface FaxWebhook {
  simulated: true;
  endpoint: "POST /fake-fax-webhook";
  event: "fax.outbound.delivered" | "fax.outbound.failed";
  transactionId: string;
  status: "Delivered" | "Failed";
  provider: string;
  destination: string;
  fax: string;
  pages: number;
  attempts: number;
  errorCode: string | null;
  timestamp: string;
}

export function webhookFor(tx: FaxTransaction): FaxWebhook {
  const ok = tx.status === "delivered";
  return {
    simulated: true,
    endpoint: "POST /fake-fax-webhook",
    event: ok ? "fax.outbound.delivered" : "fax.outbound.failed",
    transactionId: tx.id,
    status: ok ? "Delivered" : "Failed",
    provider: tx.destination.provider,
    destination: tx.destination.practice,
    fax: tx.destination.fax,
    pages: ok ? tx.pages : 0,
    attempts: tx.attempts,
    errorCode: ok ? null : "NO_ANSWER",
    timestamp: tx.completedAt ?? new Date().toISOString(),
  };
}

// ── Simulated inbound response ──────────────────────────────────────────────

export interface InboundFax {
  id: string;
  simulated: true;
  receivedAt: string;
  from: string;
  fromFax: string;
  pages: number;
  classification: string;
  classificationConfidence: number;
  matchedPatient: string;
  matchBasis: string[];
  matchedReferral: string;
  extractedStatus: "Appointment scheduled";
  appointment: string; // ISO
  appointmentWith: string;
  confidence: number;
}

export function simulateInbound(tx: FaxTransaction, s: Scenario, now = new Date(), referralType = s.referralType): InboundFax {
  const appt = new Date(now);
  appt.setDate(appt.getDate() + (s.priority === "Urgent" ? 2 : 12));
  while (appt.getDay() === 0 || appt.getDay() === 6) appt.setDate(appt.getDate() + 1);
  appt.setHours(9, 40, 0, 0);
  return {
    id: tx.id.replace("DEMO-FAX", "DEMO-INFAX"),
    simulated: true,
    receivedAt: now.toISOString(),
    from: tx.destination.practice,
    fromFax: tx.destination.fax,
    pages: 2,
    classification: "Referral response",
    classificationConfidence: 96,
    matchedPatient: tx.patient.name,
    matchBasis: ["Patient name", "Date of birth", `Our transaction ${tx.id} on the returned cover sheet`],
    matchedReferral: `${referralType.split(" / ")[0]} referral · ${tx.id}`,
    extractedStatus: "Appointment scheduled",
    appointment: appt.toISOString(),
    appointmentWith: tx.destination.provider,
    confidence: 96,
  };
}

// ── Facts from the real research snapshot (opportunity page) ────────────────

export interface SnapshotMetrics {
  providers: number;
  sources: number;
  domains: number;
  locations: number;
  locationsCorroborated: number;
  phonesCorroborated: number;
  faxes: number;
  faxesCorroborated: number;
  referralFaxes: number;
  providersWithReferralFax: number;
  conflicts: number;
  dropped: number;
  npiIncompleteOrStale: number;
  specialtyDifferent: number;
  avgSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  searchCalls: number;
  inputTokens: number;
  outputTokens: number;
  models: string[];
  researchedOn: string;
}

const independent = (fams: string[]) => fams.some((f) => f !== "federal" && f !== "aggregator");

export function snapshotMetrics(list: ReferralResearch[]): SnapshotMetrics {
  const current = list.flatMap((r) => r.locations.filter((l) => l.status !== "former"));
  const faxes = new Map<string, ContactNumber>();
  for (const l of current) for (const f of l.faxes) if (!faxes.has(f.digits) || independent(f.families)) faxes.set(f.digits, f);
  const referral = [...faxes.values()].filter((f) => f.faxKind === "referral" && f.labelCheck === "page");
  const secs = list.map((r) => r.usage.durationMs / 1000);
  return {
    providers: list.length,
    sources: list.reduce((n, r) => n + r.sources.length, 0),
    domains: new Set(list.flatMap((r) => r.sources.map((s) => s.domain))).size,
    locations: current.length,
    locationsCorroborated: current.filter((l) => independent(l.families)).length,
    phonesCorroborated: current.reduce((n, l) => n + l.phones.filter((p) => independent(p.families)).length, 0),
    faxes: faxes.size,
    faxesCorroborated: [...faxes.values()].filter((f) => independent(f.families)).length,
    referralFaxes: referral.length,
    providersWithReferralFax: list.filter((r) => r.locations.some((l) => l.status !== "former" && l.faxes.some((f) => f.faxKind === "referral" && f.labelCheck === "page"))).length,
    conflicts: list.reduce((n, r) => n + r.conflicts.length, 0),
    dropped: list.reduce((n, r) => n + r.dropped.length, 0),
    npiIncompleteOrStale: list.filter((r) => r.relationship.kind !== "npi_current").length,
    specialtyDifferent: list.filter((r) => r.specialty.status === "different").length,
    avgSeconds: Math.round(secs.reduce((a, b) => a + b, 0) / Math.max(1, secs.length)),
    minSeconds: Math.round(Math.min(...secs)),
    maxSeconds: Math.round(Math.max(...secs)),
    searchCalls: list.reduce((n, r) => n + r.usage.searchCalls, 0),
    inputTokens: list.reduce((n, r) => n + r.usage.inputTokens, 0),
    outputTokens: list.reduce((n, r) => n + r.usage.outputTokens, 0),
    models: [...new Set(list.flatMap((r) => [r.usage.researchModel, r.usage.extractModel]))],
    researchedOn: list.map((r) => r.researchedAt).sort()[0]?.slice(0, 10) ?? "",
  };
}
