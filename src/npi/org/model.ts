// ── Shared Organizational Knowledge POC — the trust engine (pure, deterministic) ──
//
// Facts are observations, not flags. Every observation of a referral destination is
// appended to a log and NEVER edited or deleted; "correcting" a value means appending
// a new observation. Organizational status is recomputed from the whole log plus the
// parent organization's policy every time it is read.
//
// No AI and no network anywhere in this file: promotion to organizational trust is
// observable evidence + explicit policy, nothing else.

export type SourceType =
  | "registry"            // CMS/NPPES listing
  | "registry_copy"       // a directory site repeating the registry (lineage: registry)
  | "clinic_confirmation" // a clinic in the organization confirmed / reported a value
  | "corporate_import"    // parent-organization spreadsheet / system import
  | "review";             // a corporate reviewer resolved a conflict

export type Method =
  | "registry_listing"
  | "copied_listing"
  | "called_practice"
  | "practice_letterhead"
  | "reused_shared"       // a clinic re-used another clinic's value WITHOUT new evidence
  | "spreadsheet_import"
  | "corporate_review";

export const METHOD_LABEL: Record<Method, string> = {
  registry_listing: "Listed in registry",
  copied_listing: "Copied listing",
  called_practice: "Called practice",
  practice_letterhead: "Practice letterhead / cover sheet",
  reused_shared: "Re-used shared value (no new evidence)",
  spreadsheet_import: "Corporate spreadsheet import",
  corporate_review: "Corporate review",
};

export interface Observation {
  id: string;
  seq: number;             // append order; ties on observedAt break by seq
  providerId: string;
  field: "referral_fax";
  value: string;           // 10 digits
  sourceType: SourceType;
  source: string;          // human label: "CMS/NPPES", "Lornsco Seattle North", …
  orgId: string | null;
  clinicId: string | null;
  actor: string | null;
  method: Method;
  observedAt: string;      // ISO
  note?: string;
  derivedFrom?: string;    // observation id this value was copied from (lineage)
  lineage?: string;        // root source for non-org evidence ("nppes")
  importBatch?: string;    // corporate import file / batch id
  simulated: boolean;      // true for everything the POC fabricates
}

export interface Clinic { id: string; name: string; short: string; }
export interface Organization { id: string; name: string; parent: string; totalClinics: number; clinics: Clinic[]; }

export interface Policy {
  corporateImportTrusted: boolean;             // corporate imports → trusted organization-wide
  singleConfirmationScope: "clinic" | "organization"; // one clinic confirmation → usable where?
  orgTrustThreshold: number;                   // independent clinic confirmations → trusted org-wide
  reconfirmAfterDays: number;                  // older confirmations stop counting
}
// Fixed in this POC (shown on the policy page, not editable):
//  • disagreement among current organization observations → review required
//  • a registry-only (NPPES) fax never authorizes PHI transmission
export const DEFAULT_POLICY: Policy = {
  corporateImportTrusted: true,
  singleConfirmationScope: "clinic",
  orgTrustThreshold: 2,
  reconfirmAfterDays: 365,
};

export type Status =
  | "no_destination"
  | "registry_only"
  | "org_unconfirmed"      // only corporate imports, and policy does not trust imports
  | "usable_locally"
  | "trusted_org"
  | "review_required"
  | "reconfirm_required";

export const STATUS_LABEL: Record<Status, string> = {
  no_destination: "No referral destination on file",
  registry_only: "Registry only — confirmation required",
  org_unconfirmed: "Imported — confirmation required",
  usable_locally: "Usable locally",
  trusted_org: "Trusted organization-wide",
  review_required: "Review required before PHI transmission",
  reconfirm_required: "Reconfirmation required",
};

export interface EvidenceGroup {
  key: string;             // independence key
  kind: "clinic" | "import" | "review" | "registry";
  label: string;           // "Lornsco Seattle North"
  observations: Observation[];
  latest: Observation;
}

export interface ValueSummary { value: string; groups: EvidenceGroup[]; observations: Observation[]; }

export interface Assessment {
  providerId: string;
  status: Status;
  value: string | null;                  // the organization's current value, if any
  directory: true;                       // provider record available (always, if seeded)
  destinationConfirmed: boolean;         // some organization evidence supports `value`
  phiAllowed: boolean;                   // for the VIEWING context
  phiReason: string;
  rule: string;                          // the policy rule that decided the status
  independentConfirmations: number;      // distinct clinics (fresh, non-derived) for `value`
  supporting: EvidenceGroup[];           // fresh organization evidence for `value`
  duplicates: number;                    // org observations for `value` not counted as independent
  registry: { value: string; source: string; copies: number; agrees: boolean | null } | null;
  conflict: ValueSummary[] | null;       // per-value breakdown when current org evidence disagrees
  expired: Observation[];                // org observations past the reconfirmation period
  confirmingClinics: string[];
}

const DAY = 86_400_000;
const ORG_TYPES: SourceType[] = ["clinic_confirmation", "corporate_import", "review"];

export const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
export const fmtFax = (d: string) => (d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d);
export const isOrgEvidence = (o: Observation) => ORG_TYPES.includes(o.sourceType);

const byTime = (a: Observation, b: Observation) => a.observedAt.localeCompare(b.observedAt) || a.seq - b.seq;

/** Root of an observation's lineage: copies/re-uses resolve to what they were copied from. */
export function rootOf(o: Observation, all: Map<string, Observation>): Observation {
  const seen = new Set<string>();
  let cur = o;
  while (cur.derivedFrom && all.has(cur.derivedFrom) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = all.get(cur.derivedFrom)!;
  }
  return cur;
}

/**
 * Independence key — two observations with the same key are NOT independent.
 *   clinic confirmations → one key per clinic (a clinic confirming twice is still one clinic)
 *   corporate imports    → one key per import batch (10 clinics importing one spreadsheet = 1 source)
 *   registry + copies    → the registry lineage (10 sites copying NPPES = NPPES)
 *   anything derivedFrom → the key of its root
 */
export function independenceKey(o: Observation, all: Map<string, Observation>): string {
  const r = rootOf(o, all);
  switch (r.sourceType) {
    case "clinic_confirmation": return `clinic:${r.orgId}:${r.clinicId}`;
    case "corporate_import": return `import:${r.orgId}:${r.importBatch ?? r.id}`;
    case "review": return `review:${r.id}`;
    default: return `registry:${r.lineage ?? r.source}`;
  }
}

function groupsFor(obs: Observation[], all: Map<string, Observation>, clinicName: (id: string | null) => string): EvidenceGroup[] {
  const m = new Map<string, EvidenceGroup>();
  for (const o of [...obs].sort(byTime)) {
    const key = independenceKey(o, all);
    const r = rootOf(o, all);
    const kind: EvidenceGroup["kind"] = r.sourceType === "clinic_confirmation" ? "clinic" : r.sourceType === "corporate_import" ? "import" : r.sourceType === "review" ? "review" : "registry";
    const label = kind === "clinic" ? clinicName(r.clinicId) : kind === "import" ? `Corporate import · ${r.importBatch ?? r.source}` : kind === "review" ? `Corporate review · ${r.actor ?? ""}`.trim() : r.source;
    const g = m.get(key) ?? { key, kind, label, observations: [], latest: o };
    g.observations.push(o);
    g.latest = o;
    m.set(key, g);
  }
  return [...m.values()];
}

export interface Viewer { orgId: string; clinicId: string | null; }

/**
 * Assess one provider's referral destination for one viewing context.
 * `observations` may contain other providers; only `providerId`'s are used.
 */
export function assess(providerId: string, observations: Observation[], policy: Policy, viewer: Viewer, now: string, org: Organization): Assessment {
  const all = new Map(observations.map((o) => [o.id, o]));
  const mine = observations.filter((o) => o.providerId === providerId && o.field === "referral_fax").sort(byTime);
  const clinicName = (id: string | null) => org.clinics.find((c) => c.id === id)?.name ?? "Unknown clinic";
  const nowMs = Date.parse(now);
  const fresh = (o: Observation) => nowMs - Date.parse(o.observedAt) <= policy.reconfirmAfterDays * DAY;

  // Registry: latest registry listing; copies share its lineage and add nothing.
  const reg = mine.filter((o) => o.sourceType === "registry");
  const regLatest = reg.at(-1) ?? null;
  const copies = mine.filter((o) => o.sourceType === "registry_copy" && regLatest && independenceKey(o, all) === independenceKey(regLatest, all)).length;

  // Organization evidence (this org only). Re-uses without new evidence are history, not evidence.
  const orgObs = mine.filter((o) => isOrgEvidence(o) && o.orgId === viewer.orgId);
  const lastReview = orgObs.filter((o) => o.sourceType === "review").at(-1);
  const active = orgObs.filter((o) => o.method !== "reused_shared" && (!lastReview || byTime(o, lastReview) >= 0));
  const current = active.filter(fresh);
  const expired = active.filter((o) => !fresh(o));

  const base = {
    providerId, directory: true as const,
    registry: regLatest ? { value: regLatest.value, source: regLatest.source, copies, agrees: null as boolean | null } : null,
    expired, duplicates: 0, independentConfirmations: 0, supporting: [] as EvidenceGroup[], conflict: null as ValueSummary[] | null, confirmingClinics: [] as string[],
  };
  const withRegistry = (a: Omit<Assessment, "registry"> & { registry: Assessment["registry"] }): Assessment => {
    if (a.registry && a.value) a.registry.agrees = a.registry.value === a.value;
    return a;
  };

  if (!current.length) {
    if (expired.length) {
      const last = expired.at(-1)!;
      return withRegistry({ ...base, status: "reconfirm_required", value: last.value, destinationConfirmed: false, phiAllowed: false,
        phiReason: `The last organization confirmation is older than ${policy.reconfirmAfterDays} days. Reconfirm before sending PHI.`,
        rule: "Old confirmation → reconfirmation required" });
    }
    if (regLatest) {
      return withRegistry({ ...base, status: "registry_only", value: null, destinationConfirmed: false, phiAllowed: false,
        phiReason: "Only the public registry lists this fax. Registry listings are not approved for PHI; a clinic must confirm it first.",
        rule: "NPPES-only fax → directory yes, confirmation required before PHI" });
    }
    return withRegistry({ ...base, status: "no_destination", value: null, destinationConfirmed: false, phiAllowed: false, phiReason: "No referral destination on file.", rule: "—" });
  }

  const values = [...new Set(current.map((o) => o.value))];
  if (values.length > 1) {
    const conflict = values.map((v) => {
      const obs = current.filter((o) => o.value === v);
      return { value: v, observations: obs, groups: groupsFor(obs, all, clinicName) };
    }).sort((a, b) => b.groups.length - a.groups.length || byTime(a.observations[0], b.observations[0]));
    return withRegistry({ ...base, status: "review_required", value: null, destinationConfirmed: false, phiAllowed: false, conflict,
      phiReason: "Clinics in your organization currently disagree about this fax. Nothing is replaced automatically; a reviewer must resolve it before PHI is sent.",
      rule: "Conflicting confirmation → review required" });
  }

  const value = values[0];
  const forValue = current.filter((o) => o.value === value);
  const supporting = groupsFor(forValue, all, clinicName);
  const clinicGroups = supporting.filter((g) => g.kind === "clinic");
  const importGroups = supporting.filter((g) => g.kind === "import");
  const reviewGroups = supporting.filter((g) => g.kind === "review");
  const confirmingClinics = [...new Set(clinicGroups.map((g) => rootOf(g.latest, all).clinicId!))];
  const shared = { ...base, value, supporting, confirmingClinics, independentConfirmations: clinicGroups.length, duplicates: forValue.length - supporting.length };

  if (reviewGroups.length) {
    return withRegistry({ ...shared, status: "trusted_org", destinationConfirmed: true, phiAllowed: true,
      phiReason: "A corporate reviewer resolved the conflict in favour of this value.", rule: "Corporate review resolved the conflict" });
  }
  if (clinicGroups.length >= policy.orgTrustThreshold) {
    return withRegistry({ ...shared, status: "trusted_org", destinationConfirmed: true, phiAllowed: true,
      phiReason: `${clinicGroups.length} independent clinic confirmations agree (policy requires ${policy.orgTrustThreshold}).`,
      rule: `${policy.orgTrustThreshold} independent clinic confirmations → trusted organization-wide` });
  }
  if (importGroups.length && policy.corporateImportTrusted) {
    return withRegistry({ ...shared, status: "trusted_org", destinationConfirmed: true, phiAllowed: true,
      phiReason: "Imported by the parent organization, which policy treats as trusted organization-wide.", rule: "Corporate import → trusted organization-wide" });
  }
  if (clinicGroups.length) {
    const here = viewer.clinicId !== null && confirmingClinics.includes(viewer.clinicId);
    const orgScope = policy.singleConfirmationScope === "organization";
    const allowed = here || (orgScope && viewer.clinicId !== null);
    const who = confirmingClinics.map((id) => clinicName(id)).join(", ");
    return withRegistry({ ...shared, status: "usable_locally", destinationConfirmed: true, phiAllowed: allowed,
      phiReason: viewer.clinicId === null
        ? `Usable at ${orgScope ? "every clinic" : who} under current policy.`
        : here ? "Your clinic confirmed this destination."
        : orgScope ? `Confirmed by ${who}; policy lets sibling clinics use a single confirmation.`
        : `Confirmed by ${who} only. Policy makes one clinic's confirmation usable at that clinic; confirm independently (or ${policy.orgTrustThreshold} clinics must agree) before sending PHI from here.`,
      rule: orgScope ? "One clinic confirmation → usable organization-wide" : "One clinic confirmation → usable locally" });
  }
  // Only imports, and policy does not trust imports on their own.
  return withRegistry({ ...shared, status: "org_unconfirmed", destinationConfirmed: false, phiAllowed: false,
    phiReason: "Imported by the parent organization, but policy requires a clinic confirmation before PHI.", rule: "Corporate import (untrusted by policy) → confirmation required" });
}

// ── append-only log helpers ─────────────────────────────────────────────────────

export interface NewObservation {
  providerId: string; value: string; sourceType: SourceType; source: string; orgId: string | null; clinicId: string | null;
  actor: string | null; method: Method; observedAt: string; note?: string; derivedFrom?: string; lineage?: string; importBatch?: string; simulated?: boolean;
}

/** Append (never mutate) — returns a new array; existing observation objects are untouched. */
export function append(log: readonly Observation[], o: NewObservation): Observation[] {
  const v = digits(o.value);
  if (v.length !== 10) throw new Error(`Fax must have 10 digits: "${o.value}"`);
  const seq = log.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
  return [...log, { id: `obs-${seq}`, seq, field: "referral_fax", simulated: true, ...o, value: v }];
}
