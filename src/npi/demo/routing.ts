// ── Deterministic-first referral routing (SYNTHETIC POC) ─────────────────────
// The audiologist has already decided what kind of specialist the patient needs.
// Nothing here infers that from clinical text. This module only answers:
// GIVEN the requested referral type, which destinations are usable, and which
// need a human look first?
//
//   referral intent (audiologist) → NPI taxonomy + state + radius (server, deterministic)
//   → licence / hard-mismatch checks (deterministic) → AI research where needed
//   → these transparent rules → Recommended vs Needs review → human chooses.
//
// AI output only arrives as evidence fields (specialty status, fax labels…) that
// the server has already filtered; the grouping rules below are plain code.
// Pure — tested in tests/npi-demo.test.ts.
import type { ContactNumber, LicenseCheck } from "../types";
import { faxSemantics, specialtyConflict, type FaxSemantics, type SpecialtyConflict } from "../semantics";
import { pediatricMismatch } from "./model";

// ── Referral intent ──────────────────────────────────────────────────────────
// POC list, not a Sycle taxonomy. `key` is the server's specialty key
// (api/_npi-geo.ts SPECIALTY_DEFS), so the response can be checked against it.

export interface ReferralType { value: string; key: string; note: string }

export const REFERRAL_TYPES: ReferralType[] = [
  { value: "ENT / Otolaryngology", key: "ent", note: "Live registry search · saved web research for Seattle" },
  { value: "Otology & Neurotology", key: "otology", note: "Live registry search · research on demand" },
  { value: "Neurology", key: "neurology", note: "Live registry search · research on demand" },
  { value: "Allergy & Immunology", key: "allergy", note: "Live registry search · research on demand" },
];

export function intentKey(value: string): string | null {
  return REFERRAL_TYPES.find((t) => t.value === value)?.key ?? null;
}

// The results must be for the referral type that was requested — never a substitute.
export function resultsMatchIntent(requested: string, response: { specialty: { key: string } }): boolean {
  return intentKey(requested) === response.specialty.key;
}

// The bundled research snapshot is an ENT cohort (Seattle, Sep 28 2026). It may
// only enrich searches whose registry results can legitimately contain those
// providers; for anything else it isn't consulted at all.
export const SNAPSHOT_SPECIALTIES = ["ent", "otology", "peds-ent"];
export const snapshotAppliesTo = (specialtyKey: string) => SNAPSHOT_SPECIALTIES.includes(specialtyKey);

// Saved research for one registry result of THIS search — null unless the
// search's specialty is covered by the snapshot.
export function savedResearchFor<T>(specialtyKey: string, snapshot: Map<string, T>, npi: string): T | null {
  return snapshotAppliesTo(specialtyKey) ? snapshot.get(npi) ?? null : null;
}

// ── The three questions ──────────────────────────────────────────────────────

export interface AssessInput {
  requested: string; // referral type label the audiologist chose
  npiSpecialty: string; // matching NPI taxonomy description
  taxonomyCode: string;
  npiActive: boolean;
  licence: LicenseCheck | null;
  researchSpecialty: { status: "same" | "different" | "unknown"; value: string | null } | null;
  identityConflict: boolean;
  location: {
    name: string;
    organization: string | null;
    status: "current" | "possibly_stale" | "former" | "npi_only";
    bestFax: ContactNumber | null;
    acceptingNewPatients: { accepting: boolean } | null;
  };
  providerScore: number;
  destinationScore: number;
  patientAge: number | null;
  faxFailedThisSession: boolean;
}

export interface Assessment {
  verification: { score: number; issues: string[]; conflict: SpecialtyConflict | null };
  destination: { score: number; fax: FaxSemantics; issues: string[] };
  fit: { ok: boolean; summary: string; issues: string[] };
  group: "recommended" | "review";
  reviewReasons: string[];
}

export const WEAK_DESTINATION = 50;

export function assessDestination(i: AssessInput): Assessment {
  const conflict = specialtyConflict({
    npiSpecialty: i.npiSpecialty, taxonomyCode: i.taxonomyCode, licence: i.licence,
    researchDifferent: i.researchSpecialty?.status === "different", researchSpecialty: i.researchSpecialty?.value ?? null,
  });

  // Q1 — is this the provider record we think it is?
  const vIssues: string[] = [];
  if (!i.npiActive) vIssues.push("NPI is deactivated");
  if (i.identityConflict) vIssues.push("Web evidence conflicts with this provider's identity");
  const lic = i.licence?.records.find((r) => /^active/i.test(r.status)) ?? i.licence?.records[0];
  if (lic && (i.licence?.match === "exact" || i.licence?.match === "name") && !/^active/i.test(lic.status)) vIssues.push(`Washington licence is ${lic.status.toLowerCase()}`);

  // Q2 — do we know where and how to send it?
  const fax = faxSemantics(i.location.bestFax);
  const dIssues: string[] = [];
  if (!i.location.bestFax) dIssues.push("No fax found for this destination");
  if (i.location.status === "former") dIssues.push("Provider appears to have left this location");
  else if (i.location.status === "possibly_stale") dIssues.push("This location may be out of date");
  if (i.faxFailedThisSession) dIssues.push("A fake fax to this number failed in this demo session");
  if (i.location.bestFax && i.destinationScore < WEAK_DESTINATION) dIssues.push(`Destination evidence is weak (${i.destinationScore}%)`);
  if (i.location.acceptingNewPatients && !i.location.acceptingNewPatients.accepting) dIssues.push("Source says this location is not accepting new patients");

  // Q3 — does it match the referral the audiologist requested? Deterministic
  // facts and explicit evidence only; no clinical judgement.
  const fIssues: string[] = [];
  const fitText = [i.researchSpecialty?.value, i.npiSpecialty, i.location.organization, i.location.name].filter(Boolean).join(" ");
  if (pediatricMismatch(fitText, i.patientAge)) fIssues.push(`Pediatric practice — this synthetic patient is ${i.patientAge}`);
  if (conflict) fIssues.push(conflict.rows.some((r) => r.kind === "research")
    ? `Current practice evidence suggests ${conflict.rows.find((r) => r.kind === "research")!.value}, not ${i.requested}`
    : `Licence is for a different profession than ${i.requested}`);

  const reviewReasons = [...fIssues, ...vIssues, ...dIssues];
  return {
    verification: { score: i.providerScore, issues: vIssues, conflict },
    destination: { score: i.destinationScore, fax, issues: dIssues },
    fit: { ok: fIssues.length === 0, summary: fIssues[0] ?? `Matches requested ${i.requested}`, issues: fIssues },
    group: reviewReasons.length ? "review" : "recommended",
    reviewReasons,
  };
}

// Recommended first by destination confidence then distance; review cases kept, separately.
export function groupDestinations<T extends { assessment: Assessment; distanceMi: number | null }>(list: T[]): { recommended: T[]; review: T[] } {
  const order = (a: T, b: T) => b.assessment.destination.score - a.assessment.destination.score || (a.distanceMi ?? 99) - (b.distanceMi ?? 99);
  return {
    recommended: list.filter((c) => c.assessment.group === "recommended").sort(order),
    review: list.filter((c) => c.assessment.group === "review").sort(order),
  };
}

// ── Researched, but no destination could be established ─────────────────────
// Research can promote a registry match to a destination only when evidence
// supports one. When it can't, say why — never manufacture one.
export function noDestinationReason(locations: { status: "current" | "possibly_stale" | "former" | "npi_only" }[]): string {
  if (!locations.length) return "Research found no practice location for this provider.";
  if (locations.every((l) => l.status === "former")) return "Evidence says the provider has left every known location — no current practice location was established.";
  return "Research did not establish a usable destination.";
}
