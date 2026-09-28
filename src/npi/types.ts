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

// ── Geography ─────────────────────────────────────────────────────────────────

export interface Coords {
  lat: number;
  lon: number;
}

export interface Origin {
  input: string;
  label: string;
  coords: Coords;
  precision: "address" | "zip" | "city";
  method: string;
  state: string;
}

// ── Evidence ──────────────────────────────────────────────────────────────────
// Source families, most to least authoritative for referral data. The NPI
// connector and CMS NPPES are the SAME family (one federal dataset, two APIs).

export type SourceFamily =
  | "federal" // CMS / NPPES, other CMS provider data
  | "state" // state licensing / credential records
  | "first_party" // practice, clinic, hospital, health system
  | "payer" // insurer / plan provider directory
  | "professional" // specialty society, board, professional directory
  | "independent" // other reputable independent source
  | "aggregator"; // NPI mirrors / scraped directories — zero weight

export interface EvidenceSource {
  id: string; // S1, S2 … (web) · NPPES · WA-DOH
  url: string;
  title: string;
  domain: string;
  name: string;
  family: SourceFamily;
  familyReason: string; // why this family (model label, or the domain rule that overrode it)
  summary: string;
  currentness: "current" | "possibly_stale" | "unknown";
  researchedAt: string;
}

export interface Claim {
  value: string;
  sourceIds: string[];
}

export type FaxKind = "referral" | "scheduling" | "office" | "general" | "unknown";

export interface ContactNumber {
  number: string; // (206) 555-1212
  digits: string;
  label: string | null; // verbatim label from the source, e.g. "Referral Fax"
  faxKind?: FaxKind; // faxes only; "referral" survives ONLY if the label says referral
  labelCheck?: "page" | "unverifiable"; // referral faxes: wording found next to the number on the live source page, or page not machine-readable
  sourceIds: string[];
  families: SourceFamily[];
  inNpi: boolean; // same digits appear in the NPI record
  confidence: number;
}

export interface FieldConfidence {
  value: string | null;
  confidence: number;
  basis: string;
  sourceIds: string[];
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

// ── Referral destinations ────────────────────────────────────────────────────

export interface PracticeLocation {
  id: string;
  name: string; // clinic / site name if known, else the organization, else the street
  organization: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  coords: Coords | null;
  geoPrecision: "address" | "zip" | null;
  distanceMi: number | null; // from the search origin, when one is given
  inRadius: boolean | null;
  origin: "npi" | "research" | "both"; // where the location came from
  npiPurpose: "Primary practice" | "Additional practice" | null;
  status: "current" | "possibly_stale" | "former" | "npi_only";
  statusNote: string | null;
  phones: ContactNumber[];
  faxes: ContactNumber[];
  bestFax: ContactNumber | null;
  referralInstructions: Claim | null;
  acceptingNewPatients: (Claim & { accepting: boolean }) | null;
  sourceIds: string[];
  families: SourceFamily[];
  fields: { location: FieldConfidence; phone: FieldConfidence; fax: FieldConfidence; referralFax: FieldConfidence };
  referral: ConfidenceScore;
}

// ── Licensing (state adapters) ───────────────────────────────────────────────

export interface LicenseRecord {
  credentialNumber: string;
  credentialType: string;
  status: string;
  name: string;
  firstIssued: string | null;
  lastIssued: string | null;
  expires: string | null;
  actionTaken: "Yes" | "No" | "Pending" | null; // DOH's own column, shown verbatim
}

export interface LicenseCheck {
  state: string;
  source: string;
  sourceUrl: string;
  checkedAt: string;
  match: "exact" | "name" | "ambiguous" | "none" | "error" | "unsupported_state";
  matchNote: string;
  records: LicenseRecord[];
}

// ── Nearby search ─────────────────────────────────────────────────────────────

export interface NearbyResult {
  npi: string;
  name: string;
  credential: string | null;
  enumerationType: "Individual" | "Organization";
  status: "Active" | "Deactivated";
  specialty: string; // the matching taxonomy (not necessarily primary)
  specialtyCode: string;
  specialtyIsPrimary: boolean;
  lastUpdated: string | null;
  nearest: PracticeLocation; // closest in-radius NPI location
  otherLocationCount: number; // other NPI practice locations (any distance)
  sharedAddressOrgs: string[]; // NPPES organizations with a practice location at the same address
  license: LicenseCheck | null;
  provider: ConfidenceScore; // registry + licence baseline
}

// One server-side stage of the nearby search, timed (experiment page).
export interface NearbyTraceStage {
  id: string;
  kind: "DET" | "EXTERNAL";
  source: string;
  in: number;
  out: number;
  ms: number;
  detail: string;
}

export interface NearbyResponse {
  origin: Origin;
  specialty: { key: string; label: string; codes: string[]; nppesQuery: string };
  radiusMi: number;
  results: NearbyResult[];
  scanned: { records: number; addresses: number; geocodedExact: number; geocodedZip: number; truncated: boolean };
  source: string;
  notes: string[];
  trace?: NearbyTraceStage[];
}

// ── Referral research (per provider) ─────────────────────────────────────────

export type NpiRelationship =
  | "npi_current" // web evidence agrees with the NPI location(s)
  | "additional_locations" // NPI is right but incomplete
  | "npi_stale_moved" // provider now practices elsewhere
  | "successor_practice" // same contact numbers, renamed / acquired practice
  | "ambiguous_identity" // can't tell whether sources are the same provider
  | "no_evidence";

export interface Conflict {
  field: string;
  description: string;
  sourceIds: string[];
}

export interface ReferralResearch {
  npi: string;
  researchedAt: string;
  // "public_web" = the cheap pass (Brave search + fetched pages, no AI; api/_npi-discover.ts).
  // Absent = paid AI research.
  method?: "public_web";
  summary: string;
  relationship: { kind: NpiRelationship; explanation: string; sourceIds: string[] };
  identity: FieldConfidence & { confirmed: boolean; conflict: boolean };
  specialty: FieldConfidence & { status: "same" | "different" | "unknown" };
  affiliations: (Claim & { current: "current" | "former" | "unknown"; families: SourceFamily[] })[];
  organization: FieldConfidence;
  locations: PracticeLocation[]; // NPI + researched, merged, scored
  conflicts: Conflict[];
  webLicense: Claim[]; // license statements found on the web (the state adapter is separate)
  sources: EvidenceSource[];
  dropped: { reason: string; detail: string }[]; // unsupported claims filtered out, for transparency
  searchQueries: string[];
  usage: { researchModel: string; extractModel: string; searchCalls: number; inputTokens: number; outputTokens: number; durationMs: number };
  cached?: boolean;
}

// ── Cheap public-web pass (api/_npi-discover.ts) ─────────────────────────────
// Search discovers URLs; only fetched page text is evidence. There is
// deliberately no snippet/description field anywhere in these types.

export interface WebSearchHit {
  url: string;
  title?: string;
}

export interface DiscoveryPage {
  url: string;
  finalUrl: string;
  domain: string;
  title: string;
  fetched: "ok" | "failed" | "not_html";
  httpStatus: number | null;
  nameOnPage: boolean;
  npiOnPage: boolean;
  specialtyOnPage: boolean;
  orgOnPage: string | null;
  referralPage: boolean;
  accepted: boolean;
  reason: string;
  family: SourceFamily;
  familyReason: string;
  evidence?: string; // exactly what was found on the page (accepted pages only)
}

export interface DiscoveryLog {
  npi: string;
  query: string;
  search: { status: "ok" | "not_configured" | "timeout" | "http_error" | "error"; error: string | null; hits: WebSearchHit[] };
  candidates: { url: string; title?: string; skip: string | null; priority: number; fetched: boolean }[];
  pages: DiscoveryPage[];
  outcome: "corroborated" | "not_corroborated" | "search_failed" | "no_results";
  durationMs: number;
  timings?: { searchMs: number; fetchMs: number }; // Brave call vs page fetch + checks
}

export interface DiscoverResponse {
  log: DiscoveryLog;
  view: ReferralView | null; // re-scored with the public-web evidence; null when nothing was corroborated
}

export interface ReferralView {
  provider: ProviderDetail;
  license: LicenseCheck | null;
  research: ReferralResearch | null;
  locations: PracticeLocation[]; // scored; research-merged when research exists
  providerScore: ConfidenceScore;
  fields: { specialty: FieldConfidence; license: FieldConfidence; organization: FieldConfidence };
}

export type ResearchEvent =
  | { type: "stage"; stage: "research" | "extract" | "score"; message: string }
  | { type: "sources"; sources: { url: string; title: string; domain: string }[]; queries: string[] }
  | { type: "result"; view: ReferralView }
  | { type: "error"; message: string; code?: "locked" | "rate_limited" }
  | { type: "ping" };
