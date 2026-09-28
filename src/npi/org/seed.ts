// ── Shared Organizational Knowledge POC — demo organization, providers, scenes ──
// Lornsco Hearing is FICTIONAL. Its two Seattle clinics, staff, the two "Example"
// providers and every 555 fax number are fabricated for the demo. The public
// candidates are real NPPES/WA DOH values from the recorded Provider Intelligence
// run (seed-candidates.json); the POC never attaches organization data to them.
import seedFile from "./seed-candidates.json" with { type: "json" };
import { append, DEFAULT_POLICY, type Observation, type Organization, type Policy } from "./model";

export const ORG: Organization = {
  id: "lornsco",
  name: "Lornsco Hearing",
  parent: "Lornsco",
  totalClinics: 100,
  clinics: [
    { id: "sea-north", name: "Lornsco Seattle North", short: "Seattle North" },
    { id: "sea-south", name: "Lornsco Seattle South", short: "Seattle South" },
  ],
};

export const ACTORS: Record<string, string[]> = {
  "sea-north": ["Priya Shah · front desk", "Jordan Lee · audiologist"],
  "sea-south": ["Marcus Webb · audiologist", "Ana Ortiz · front desk"],
  corporate: ["Dana Kim · referral operations"],
};

export interface Provider {
  id: string;
  name: string;
  credential: string;
  specialty: string;
  practice: string | null;
  address: string;
  phone: string | null;
  npi: string | null;
  fictional: boolean;
  identitySource: string;          // where the provider record came from
  corroboration: string | null;    // e.g. WA licence
  distanceMi: number | null;
}

type Seed = typeof seedFile.candidates[number];
const SEED_AT = "2026-09-28T18:43:16.733Z"; // seedFile.capturedAt

export const STORY_ID = "demo-avery-example";
export const IMPORT_ID = "demo-morgan-sample";

export const PROVIDERS: Provider[] = [
  { id: STORY_ID, name: "Dr. Avery Example", credential: "MD", specialty: "Otolaryngology (ENT)", practice: "Example Ear, Nose & Throat (fictional)",
    address: "1100 Example Ave, Suite 200, Seattle, WA 98115", phone: "206-555-0100", npi: null, fictional: true,
    identitySource: "CMS/NPPES (simulated)", corroboration: "WA DOH licence (simulated)", distanceMi: 1.1 },
  { id: IMPORT_ID, name: "Dr. Morgan Sample", credential: "MD", specialty: "Otolaryngology (ENT)", practice: "Sample Hearing & Balance ENT (fictional)",
    address: "2200 Sample St, Seattle, WA 98104", phone: "206-555-0400", npi: null, fictional: true,
    identitySource: "CMS/NPPES (simulated)", corroboration: "WA DOH licence (simulated)", distanceMi: 5.8 },
  ...seedFile.candidates.map((c: Seed): Provider => ({
    id: c.npi, name: c.name, credential: c.credential ?? "", specialty: c.specialty, practice: c.practice,
    address: `${c.line1}, ${c.city}, WA ${c.postalCode.slice(0, 5)}`, phone: c.phone, npi: c.npi, fictional: false,
    identitySource: "CMS/NPPES", corroboration: `WA DOH licence ${c.licence} (Active)`, distanceMi: c.distanceMi,
  })),
];

export const SEED_META = { runId: seedFile.runId, capturedAt: seedFile.capturedAt, input: seedFile.input };

export const STORY = { nppes: "2065551000", confirmed: "2065552222", conflicting: "2065553333", importFax: "2065554100", importNppes: "2065554000" };

/** Registry evidence for every provider + the corporate import for Dr. Sample. */
export function seedLog(): Observation[] {
  let log: Observation[] = [];
  const reg = (providerId: string, value: string, at: string, simulated: boolean, note?: string) => {
    log = append(log, { providerId, value, sourceType: "registry", source: "CMS/NPPES", orgId: null, clinicId: null, actor: null,
      method: "registry_listing", observedAt: at, lineage: "nppes", simulated, note });
    return log.at(-1)!;
  };
  // Story provider: NPPES lists 206-555-1000; two directory sites copy it (lineage: NPPES).
  const nppes = reg(STORY_ID, STORY.nppes, "2026-03-02T12:00:00.000Z", true, "Simulated NPPES record for a fictional provider.");
  for (const site of ["HealthDirectory (simulated aggregator)", "FindAnENT (simulated aggregator)"]) {
    log = append(log, { providerId: STORY_ID, value: STORY.nppes, sourceType: "registry_copy", source: site, orgId: null, clinicId: null, actor: null,
      method: "copied_listing", observedAt: "2026-06-10T12:00:00.000Z", derivedFrom: nppes.id, lineage: "nppes",
      note: "Same number as NPPES; lineage records it as a copy, so it adds no independent evidence." });
  }
  // Import provider: one corporate spreadsheet, imported into BOTH clinics (same batch = one source).
  reg(IMPORT_ID, STORY.importNppes, "2025-11-20T12:00:00.000Z", true, "Simulated NPPES record for a fictional provider.");
  for (const c of ORG.clinics) {
    log = append(log, { providerId: IMPORT_ID, value: STORY.importFax, sourceType: "corporate_import", source: "Lornsco Hearing (corporate)", orgId: ORG.id, clinicId: c.id,
      actor: ACTORS.corporate[0], method: "spreadsheet_import", observedAt: "2026-09-01T16:00:00.000Z", importBatch: "lornsco-referral-directory-2026Q3.xlsx",
      note: `Imported into ${c.name} from the corporate referral directory.` });
  }
  // Real public candidates: exactly what NPPES returned in the recorded run.
  for (const c of seedFile.candidates) reg(c.npi, c.fax, SEED_AT, false);
  return log;
}

export interface DemoState {
  version: 1;
  log: Observation[];
  policy: Policy;
  policyLog: { at: string; actor: string; change: string }[];
  clock: string;                 // demo clock (simulated) — every new observation uses it
  context: string;               // "corporate" | clinic id
  selected: string | null;       // provider id
}

export const START_CLOCK = "2026-09-24T16:00:00.000Z";

export function initialState(): DemoState {
  return { version: 1, log: seedLog(), policy: { ...DEFAULT_POLICY }, policyLog: [], clock: START_CLOCK, context: "sea-north", selected: STORY_ID };
}

// ── the five-minute demo, as deterministic steps ────────────────────────────────

export interface Scene {
  n: number;
  title: string;
  context: string;
  clock: string;
  headline: string;
  action: string | null;              // what the presenter does live
  perform: ((s: DemoState) => DemoState) | null;
}

const confirm = (clinicId: string, actor: string, value: string, at: string, note?: string) => (s: DemoState): DemoState => ({
  ...s,
  clock: at,
  log: append(s.log, { providerId: STORY_ID, value, sourceType: "clinic_confirmation", source: ORG.clinics.find((c) => c.id === clinicId)!.name,
    orgId: ORG.id, clinicId, actor, method: "called_practice", observedAt: at, note }),
});

export const SCENES: Scene[] = [
  { n: 1, title: "Seed", context: "sea-north", clock: "2026-09-24T16:00:00.000Z",
    headline: "Both Seattle clinics can find Dr. Avery Example. The referral fax only comes from CMS/NPPES, so it is not approved for PHI.",
    action: null, perform: null },
  { n: 2, title: "Clinic A learns something", context: "sea-north", clock: "2026-09-24T17:12:00.000Z",
    headline: "Seattle North calls the practice and learns the referral fax is 206-555-2222.",
    action: "Confirm referral destination → 206-555-2222, method: called practice",
    perform: confirm("sea-north", ACTORS["sea-north"][0], STORY.confirmed, "2026-09-24T17:12:00.000Z", "Spoke to the practice's referral coordinator.") },
  { n: 3, title: "Clinic B benefits", context: "sea-south", clock: "2026-09-26T15:30:00.000Z",
    headline: "Seattle South opens the same provider and immediately sees what Seattle North learned.",
    action: null, perform: null },
  { n: 4, title: "Independent corroboration", context: "sea-south", clock: "2026-09-29T18:05:00.000Z",
    headline: "Seattle South calls the practice itself and gets the same number. A second, independent observation — nothing overwritten.",
    action: "Confirm referral destination → 206-555-2222, method: called practice",
    perform: confirm("sea-south", ACTORS["sea-south"][0], STORY.confirmed, "2026-09-29T18:05:00.000Z", "Called the practice's main line; front desk confirmed.") },
  { n: 5, title: "Conflict", context: "sea-north", clock: "2026-10-06T16:40:00.000Z",
    headline: "A clinic reports a different number. The system does not pick a winner; policy moves the destination to review.",
    action: "Report a change → 206-555-3333",
    perform: confirm("sea-north", ACTORS["sea-north"][1], STORY.conflicting, "2026-10-06T16:40:00.000Z", "Practice said referrals now go to a new fax after a phone-system change.") },
];

/** State at the START of scene n (every earlier scene's action performed). */
export function sceneStart(n: number): DemoState {
  let s = initialState();
  for (const sc of SCENES.filter((x) => x.n < n)) if (sc.perform) s = sc.perform(s);
  const sc = SCENES.find((x) => x.n === n)!;
  return { ...s, context: sc.context, clock: sc.clock, selected: STORY_ID };
}

/** State at the END of scene n. */
export function sceneEnd(n: number): DemoState {
  const s = sceneStart(n);
  const sc = SCENES.find((x) => x.n === n)!;
  return sc.perform ? sc.perform(s) : s;
}
