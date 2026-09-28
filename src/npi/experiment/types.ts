// ── Provider Intelligence experiment — shared types ──────────────────────────
// One recorded pipeline run (what every stage received, returned and took) plus
// hand-/agent-written ground-truth cases the run is graded against.
// Pure types only (imported by the node capture script, the tests and the page).
import type { DiscoverResponse, LicenseCheck, NearbyTraceStage, ReferralResearch, ReferralView } from "../types";

export type StageKind = "HUMAN" | "DET" | "EXTERNAL" | "AI";

// A registry candidate, trimmed to what the baselines and the funnel need.
export interface RunCandidate {
  npi: string;
  name: string;
  credential: string | null;
  enumerationType: "Individual" | "Organization";
  status: "Active" | "Deactivated";
  specialty: string;
  specialtyCode: string;
  lastUpdated: string | null;
  nearest: { name: string; organization: string | null; line1: string; city: string; postalCode: string; distanceMi: number | null; phone: string | null; fax: string | null; faxDigits: string | null };
  sharedAddressOrgs: string[];
  license: LicenseCheck | null;
  baselineVerification: number;
}

export interface Timed<T> { ms: number; ok: boolean; error: string | null; data: T | null }

// A live AI research call made during this run (operator only, costs money).
export interface LiveAiCall {
  events: { t: number; type: string; message?: string }[];
  view: ReferralView | null;
}

export interface ExperimentRun {
  meta: {
    runId: string;
    capturedAt: string;
    base: string; // which deployment answered
    runner: string; // "node scripts/npi-experiment.mts" | "browser"
    codeVersion: string | null; // git commit of the capturing checkout, when known
    input: { specialty: string; location: string; radius: number; patientAge: number };
    snapshotResearchedAt: string[]; // researchedAt of the saved AI research used
  };
  nearby: Timed<{
    origin: { label: string; lat: number; lon: number; precision: string; method: string; state: string };
    specialty: { key: string; label: string; codes: string[]; nppesQuery: string };
    radiusMi: number;
    scanned: { records: number; addresses: number; geocodedExact: number; geocodedZip: number; truncated: boolean };
    notes: string[];
    trace: NearbyTraceStage[] | null; // null when the server predates the trace field
    results: RunCandidate[];
  }>;
  // Saved (cached) AI research re-scored by the server for this search — what every normal viewer gets.
  savedAi: Record<string, Timed<ReferralView>>;
  // Cheap Brave pass. role "production" = one of the nearest un-researched the product checks;
  // "baseline" = run only so baseline C can be measured on the same providers.
  discovery: Record<string, Timed<DiscoverResponse> & { role: "production" | "baseline" }>;
  // Registry + licence view with no research (raw NPPES record for the evidence explorer).
  registry: Record<string, Timed<ReferralView>>;
  // Optional, operator-only fresh AI research.
  liveAi: Record<string, Timed<LiveAiCall>>;
}

// ── Ground truth ─────────────────────────────────────────────────────────────

export interface ExpectedFax { digits: string; label: string; referral: boolean; location: string; url: string; quote: string }

export interface GroundTruthCase {
  npi: string;
  name: string;
  cohort: "pipeline-evaluated" | "random-sample";
  checkedAt: string;
  checkedBy: string; // who established these facts
  humanVerified: boolean; // false until a person has checked every fact below
  expected: {
    identity: { official: boolean; note: string };
    licence: { type: string; status: string; expires: string | null; url: string } | null;
    specialty: { value: string; category: "ent" | "ent-otology" | "ent-pediatric" | "ent-facial-plastics" | "non-ent" | "unknown"; url: string | null; quote: string | null };
    practices: { name: string; line1: string; city: string; url: string; quote: string }[] | null; // null = could not establish
    faxes: ExpectedFax[] | null; // null = could not establish
    seesAdults: "yes" | "no" | "unknown";
    outcome: "recommend" | "not_recommend" | "unknown";
    outcomeBasis: string;
    outcomeIsJudgement: boolean; // true when the outcome depends on a clinical/ops judgement, not a fact
    wrongEvidence: string[]; // URLs known to be about someone else
  };
  notes: string;
  failures: string[];
}

export type { ReferralResearch };
