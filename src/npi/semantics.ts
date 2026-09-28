// ── NPI demo — plain-language semantics (TEMPORARY DEMO) ─────────────────────
// Pure functions (no React, no network) that turn structured evidence into the
// words a referral coordinator reads: what kind of fax this is, and what exactly
// conflicts. Shared by /npi-list and the referral demo; tested in tests/npi-demo.test.ts.
import type { ContactNumber, LicenseCheck } from "./types";

// The three questions a destination card answers. Kept together so every page
// uses the same words. None of them rates the clinician's quality. The two
// numbers are rule-point totals (0–100), NOT probabilities — shown as "pts".
export const TERMS = {
  verification: { label: "Provider verification", question: "Is this the provider record we think it is?" },
  destination: { label: "Destination evidence", question: "Do we know where and how to send this referral?" },
  fit: { label: "Referral fit", question: "Does it match the referral type the audiologist requested?" },
} as const;

// ── Fax semantics ────────────────────────────────────────────────────────────

export type FaxSemanticKind = "referral" | "referral_unchecked" | "office" | "none";

export interface FaxSemantics {
  kind: FaxSemanticKind;
  title: string; // shown in capitals on cards
  detail: string; // one sentence; colour only reinforces this
  short: string; // compact cards
}

export function faxSemantics(fax: ContactNumber | null): FaxSemantics {
  if (!fax) return { kind: "none", title: "No fax found", detail: "This research did not establish a fax for this destination. That doesn't mean the practice has no fax.", short: "Not established by this research" };
  if (fax.faxKind === "referral" && fax.labelCheck === "page") return { kind: "referral", title: "Referral fax", detail: "Verified as a referral / intake destination by source evidence (wording checked on the live page).", short: "Referral use confirmed by source" };
  if (fax.faxKind === "referral") return { kind: "referral_unchecked", title: "Referral fax — unconfirmed", detail: "A source calls this a referral fax, but the page couldn't be machine-checked. Confirm by phone.", short: "Referral label not machine-checked" };
  return { kind: "office", title: "Office fax", detail: "This fax belongs to this location, but referral use is not confirmed.", short: "Referral use not confirmed" };
}

// ── Licence vs taxonomy (deterministic) ──────────────────────────────────────
// POC shortcut: a small map from NPI taxonomy family to the WA credential types
// that fit it. Not a taxonomy service — just enough to catch "audiologist
// registered under an ENT physician taxonomy".
const LICENCE_FOR_TAXONOMY: [RegExp, RegExp, string][] = [
  [/^20[78]/, /Physician|Osteopathic/i, "physician"],
  [/^(231H|2376)/, /Audiolog/i, "audiologist"],
  [/^235Z/, /Speech/i, "speech-language pathologist"],
  [/^2377/, /Hearing/i, "hearing instrument specialist"],
];

export function activeLicence(lic: LicenseCheck | null): { credentialType: string; status: string } | null {
  if (!lic || (lic.match !== "exact" && lic.match !== "name")) return null;
  const r = lic.records.find((x) => /^active/i.test(x.status)) ?? lic.records[0];
  return r ? { credentialType: r.credentialType, status: r.status } : null;
}

// false = the state licence clearly belongs to a different profession than the NPI taxonomy.
export function licenceFitsTaxonomy(taxonomyCode: string, lic: LicenseCheck | null): boolean | null {
  const rule = LICENCE_FOR_TAXONOMY.find(([code]) => code.test(taxonomyCode));
  if (!rule || !lic || (lic.match !== "exact" && lic.match !== "name") || !lic.records.length) return null;
  return lic.records.some((r) => rule[1].test(r.credentialType));
}

// ── Specialty conflicts, in human language ───────────────────────────────────

export interface ConflictRow {
  source: string; // "NPI Registry", "Washington licence", "Current practice evidence"
  value: string;
  kind: "registry" | "state" | "research";
}

export interface SpecialtyConflict {
  title: "Specialty mismatch";
  rows: ConflictRow[];
  explanation: string;
}

const tidyLicence = (t: string) => t.replace(/\s+License$/i, "");

export function specialtyConflict(o: { npiSpecialty: string; taxonomyCode: string; licence: LicenseCheck | null; researchDifferent: boolean; researchSpecialty: string | null }): SpecialtyConflict | null {
  const lic = activeLicence(o.licence);
  const licenceClash = licenceFitsTaxonomy(o.taxonomyCode, o.licence) === false && lic;
  const researchClash = o.researchDifferent && o.researchSpecialty;
  if (!licenceClash && !researchClash) return null;
  const rows: ConflictRow[] = [{ source: "NPI Registry", value: o.npiSpecialty, kind: "registry" }];
  if (licenceClash) rows.push({ source: "Washington licence", value: `${tidyLicence(lic.credentialType)} (${lic.status.toLowerCase()})`, kind: "state" });
  if (researchClash) rows.push({ source: "Current practice evidence", value: o.researchSpecialty!, kind: "research" });
  const explanation = licenceClash && researchClash
    ? `The state licence is for a different profession than the NPI Registry lists, and current practice evidence suggests ${o.researchSpecialty!.toLowerCase()}. The NPI taxonomy is probably wrong for this provider.`
    : licenceClash
      ? `The Washington licence is for a different profession than the NPI Registry lists. The NPI taxonomy may be wrong for this provider.`
      : `Current practice evidence suggests this provider now practises ${o.researchSpecialty!.toLowerCase()}, not what the NPI Registry lists. The registry entry may be out of date.`;
  return { title: "Specialty mismatch", rows, explanation };
}
