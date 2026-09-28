// ── Fake PMS — synthetic directory (SYNTHETIC POC, NO PHI) ────────────────────
// Just enough of a clinic Practice Management System to host the Provider
// Intelligence + fax workflow. Every person, number and record here is fictional
// and labelled as such. The tenant names illustrate a hierarchy only — there is
// no Costco (or Sycle) integration, affiliation or data. Pure: no DOM, no network
// (api/_npi-fax.ts imports PMS_CLINIC for the fax letterhead).

export const PMS_PRODUCT = "ClinicDesk"; // fictional PMS product name

export const PMS_PARENT = { id: "DEMO-ORG-001", name: "Costco" };

export const PMS_CLINIC = {
  id: "DEMO-CLINIC-001",
  name: "Costco Hearing Aid Center - Demo Location",
  displayName: "Costco Hearing Aid Center — Demo Location",
  audiologist: "A. Demo, AuD",
  phone: "(555) 010-0200", // 555-01xx: reserved fictional numbers
  fax: "(555) 010-0201",
  // Where Provider Intelligence searches from. A clinic setting, not patient data.
  searchOrigin: "Seattle, WA 98115",
};

// Jamie Example matches the canned synthetic scenario "A" the fax server builds
// its document from (src/npi/demo/model.ts) — the browser never supplies it.
export const PMS_PATIENT = {
  ref: "DEMO-PT-0001", // the only patient identifier that crosses the embed boundary
  scenarioId: "A",
  name: "Jamie Example",
  dob: "01/01/1980",
  sex: "X (not recorded — synthetic)",
  phone: "(555) 010-0142",
  email: "jamie.example@example.invalid",
  address: "100 Example Way, Seattle, WA 98115 (fictional)",
  insurance: "Example Health PPO · DEMO-0000-0001",
  primaryProvider: PMS_CLINIC.audiologist,
  since: "2024-03-14",
  devices: "No hearing aids on file",
};

export interface PmsAppointment {
  id: string;
  at: string; // ISO local-ish, displayed as-is
  type: string;
  with: string;
  status: "Completed" | "Scheduled" | "Checked out";
  referral?: { required: true; type: string; referralTypeValue: string; recordedBy: string; recordedAt: string };
}

// The primary entry point: the audiologist has ALREADY decided. These are
// structured fields recorded by the clinician — nothing is inferred from notes.
export const REFERRAL_APPOINTMENT: PmsAppointment = {
  id: "APT-DEMO-0928",
  at: "2026-09-28T10:30",
  type: "Comprehensive hearing evaluation",
  with: PMS_CLINIC.audiologist,
  status: "Checked out",
  referral: { required: true, type: "ENT", referralTypeValue: "ENT / Otolaryngology", recordedBy: PMS_CLINIC.audiologist, recordedAt: "2026-09-28T11:12" },
};

export const PMS_APPOINTMENTS: PmsAppointment[] = [
  { id: "APT-DEMO-1012", at: "2026-10-12T09:00", type: "Hearing aid consultation", with: PMS_CLINIC.audiologist, status: "Scheduled" },
  REFERRAL_APPOINTMENT,
  { id: "APT-DEMO-0314", at: "2026-03-14T14:15", type: "Annual hearing check", with: PMS_CLINIC.audiologist, status: "Completed" },
];

// Visit note text is shown for realism only. Nothing reads it.
export const VISIT_NOTE = [
  "SYNTHETIC NOTE — fictional patient.",
  "Pure-tone audiometry and word recognition completed. Results on the attached synthetic audiogram.",
  "Discussed findings and next steps with the patient. Referral recorded below by the audiologist.",
];

export const PMS_DOCUMENTS = [
  { id: "DOC-DEMO-01", at: "2026-09-28T11:05", title: "Audiogram (synthetic)", kind: "Audiogram" },
  { id: "DOC-DEMO-02", at: "2026-09-28T11:10", title: "Audiology report (synthetic)", kind: "Report" },
  { id: "DOC-DEMO-03", at: "2026-03-14T14:40", title: "Annual hearing check summary (synthetic)", kind: "Report" },
];
