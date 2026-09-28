// ── NPI demo — shared types (client + api/) ───────────────────────────────────
// TEMPORARY DEMO. Everything for /npi-list lives in src/npi/, npi-list/,
// api/npi-*.ts and api/_npi-lib.ts — delete those to remove it.
// Pure types only: api/ imports this file type-only, so nothing here may
// have a runtime value.

export type NpiSource = "Anthropic NPI Registry connector" | "CMS NPPES API";

export interface ProviderAddress {
  purpose: "Primary practice" | "Additional practice" | "Mailing";
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  phone: string | null;
  fax: string | null;
}

export interface ProviderTaxonomy {
  code: string;
  desc: string;
  primary: boolean;
  state: string | null;
  license: string | null;
}

export interface ProviderIdentifier {
  desc: string;
  identifier: string;
  issuer: string | null;
  state: string | null;
}

export interface ProviderSummary {
  npi: string;
  name: string;
  credential: string | null;
  enumerationType: "Individual" | "Organization";
  specialty: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  organization: string | null;
  status: "Active" | "Deactivated";
  lastUpdated: string | null;
  practiceLocationCount: number;
  taxonomyCount: number;
}

export interface ProviderDetail extends ProviderSummary {
  firstName: string | null;
  lastName: string | null;
  sex: string | null;
  soleProprietor: boolean | null;
  enumerationDate: string | null;
  certificationDate: string | null;
  addresses: ProviderAddress[];
  taxonomies: ProviderTaxonomy[];
  identifiers: ProviderIdentifier[];
  otherNames: string[];
  authorizedOfficial: string | null;
  endpointCount: number;
  source: NpiSource;
  fetchedAt: string;
}

export interface SearchResponse {
  query: string;
  interpretation: { label: string; value: string }[];
  results: ProviderSummary[];
  source: NpiSource;
  note: string | null;
}

// ── Validation ────────────────────────────────────────────────────────────────

export type SourceType =
  | "official_practice"
  | "health_system"
  | "state_board"
  | "payer_directory"
  | "specialty_association"
  | "government"
  | "directory"
  | "other";

export type FieldKey = "identity" | "organization" | "address" | "phone" | "fax" | "specialty" | "website";

export interface EvidenceSource {
  id: string; // S1, S2 …
  url: string;
  title: string;
  domain: string;
  name: string;
  sourceType: SourceType;
  confirms: FieldKey[];
  summary: string;
  researchedAt: string;
}

export interface FieldFinding {
  value: string;
  sourceIds: string[];
}

export type Assessment = "agrees" | "conflict" | "not_found" | "new_information";

export interface FieldComparison {
  field: FieldKey;
  npiValue: string | null;
  findings: FieldFinding[];
  assessment: Assessment;
  likelyCurrent: string | null;
  confidence: number;
  reason: string;
}

export interface ScoreItem {
  kind: "pass" | "warn" | "fail" | "unknown";
  label: string;
  points: number;
}

export interface ConfidenceScore {
  score: number;
  band: "High" | "Moderate" | "Low" | "Very low";
  items: ScoreItem[];
}

export interface ValidationResult {
  npi: string;
  validatedAt: string;
  summary: string;
  identityConfirmed: boolean;
  fields: FieldComparison[];
  sources: EvidenceSource[];
  searchQueries: string[];
  score: ConfidenceScore;
  usage: {
    researchModel: string;
    reconcileModel: string;
    searchCalls: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };
  cached?: boolean;
}

export type ValidationEvent =
  | { type: "stage"; stage: "research" | "reconcile" | "score"; message: string }
  | { type: "sources"; sources: { url: string; title: string; domain: string }[]; queries: string[] }
  | { type: "result"; result: ValidationResult }
  | { type: "error"; message: string }
  | { type: "ping" };
