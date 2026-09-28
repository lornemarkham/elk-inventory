// ── NPI demo — deterministic confidence v2 (TEMPORARY DEMO) ───────────────────
// Everything here is plain code over explicit signals. OpenAI never supplies a
// number that ends up in a score: it only labels sources and extracts facts,
// which api/_npi-referral.ts filters before they reach these functions.
//
// Two scores, both 0–100 transparent point sums (NOT calibrated probabilities):
//   Provider confidence  — is this a legitimate, correctly-specialised, licensed,
//                          currently-practising provider?
//   Referral confidence  — is THIS location + contact route current and usable
//                          for sending an outbound referral?

import type {
  ConfidenceScore,
  ContactNumber,
  FieldConfidence,
  LicenseCheck,
  PracticeLocation,
  ReferralResearch,
  ScoreItem,
  SourceFamily,
} from "../src/npi/types";
import { bestLicense, isActiveStatus, isRestrictedStatus } from "./_npi-wa";

export const FAMILY_LABEL: Record<SourceFamily, string> = {
  federal: "Federal (CMS/NPPES)",
  state: "State authority",
  first_party: "Official practice / health system",
  payer: "Payer directory",
  professional: "Professional / specialty body",
  independent: "Independent source",
  aggregator: "Aggregator / NPI mirror",
};

// How much a single family is worth as support for a fact.
const FAMILY_BASE: Record<SourceFamily, number> = {
  first_party: 80,
  state: 80,
  federal: 70,
  payer: 65,
  professional: 60,
  independent: 55,
  aggregator: 0,
};

// Distinct families that count as corroboration. Aggregators never count, and
// the NPI connector + CMS NPPES are one "federal" family however many APIs agree.
export function countingFamilies(families: SourceFamily[]): SourceFamily[] {
  return [...new Set(families)].filter((f) => f !== "aggregator");
}

export function band(score: number): ConfidenceScore["band"] {
  return score >= 80 ? "High" : score >= 60 ? "Moderate" : score >= 40 ? "Low" : "Very low";
}

function finish(items: ScoreItem[], cap = 100): ConfidenceScore {
  const raw = items.reduce((s, i) => s + i.points, 0);
  const score = Math.max(0, Math.min(cap, raw));
  return { score, band: band(score), items };
}

// Per-field confidence: best family's base, +8 per extra independent family
// (max +16), +6 if the NPI record independently agrees, −25 on conflict, −20 if stale.
export function fieldConfidence(
  families: SourceFamily[],
  opts: { npiAgrees?: boolean; conflict?: boolean; stale?: boolean; npiOnlyBase?: number } = {},
): { confidence: number; basis: string } {
  const fams = countingFamilies(families);
  if (!fams.length) {
    if (opts.npiAgrees && opts.npiOnlyBase) return { confidence: opts.npiOnlyBase, basis: "NPI record only" };
    return { confidence: 0, basis: "No supporting source" };
  }
  let c = Math.max(...fams.map((f) => FAMILY_BASE[f]));
  const parts = [FAMILY_LABEL[fams.sort((a, b) => FAMILY_BASE[b] - FAMILY_BASE[a])[0]]];
  if (fams.length > 1) { c += Math.min(16, 8 * (fams.length - 1)); parts.push(`+${fams.length - 1} more source famil${fams.length > 2 ? "ies" : "y"}`); }
  if (opts.npiAgrees && !fams.includes("federal")) { c += 6; parts.push("NPI record agrees"); }
  if (opts.conflict) { c -= 25; parts.push("conflicting sources"); }
  if (opts.stale) { c -= 20; parts.push("possibly stale"); }
  return { confidence: Math.max(5, Math.min(97, c)), basis: parts.join(" · ") };
}

// Pick the fax an audiologist should use: an explicitly-labelled referral fax
// first, then scheduling, then by confidence.
const FAX_RANK = { referral: 4, scheduling: 3, office: 2, general: 2, unknown: 1 } as const;
export function pickBestFax(faxes: ContactNumber[]): ContactNumber | null {
  return [...faxes].sort((a, b) => FAX_RANK[b.faxKind ?? "unknown"] - FAX_RANK[a.faxKind ?? "unknown"] || b.confidence - a.confidence)[0] ?? null;
}

const nonFederal = (fams: SourceFamily[]) => countingFamilies(fams).filter((f) => f !== "federal");

export interface LocationContext {
  researched: boolean;
  firstPartyCurrent: boolean; // a first-party source judged current supports this location
  faxConflict: boolean;
  npiFaxElsewhere: string | null; // this address's NPI fax is published for another location
  npiUpdatedYearsAgo: number | null;
}

// ── Referral confidence (per location) ───────────────────────────────────────
export function scoreReferral(loc: PracticeLocation, ctx: LocationContext): ConfidenceScore {
  const items: ScoreItem[] = [];
  const add = (kind: ScoreItem["kind"], label: string, points: number) => items.push({ kind, label, points });
  const fams = countingFamilies(loc.families);
  const nonFed = nonFederal(loc.families);

  // 1. Is the location itself supported?
  if (nonFed.includes("first_party")) add("pass", "Location listed on an official practice / health-system page", 30);
  else if (nonFed.length) add("pass", `Location listed by ${nonFed.map((f) => FAMILY_LABEL[f].toLowerCase()).join(", ")}`, 18);
  else add(ctx.researched ? "warn" : "unknown", ctx.researched ? "Only the NPI record lists this location — web research did not confirm it" : "Location comes from the NPI record only (not yet researched)", 10);

  if (fams.length > 1) add("pass", `${fams.length} independent source families agree on this address (${fams.map((f) => FAMILY_LABEL[f]).join(", ")})`, Math.min(10, 5 * (fams.length - 1)));

  if (loc.status === "former") add("fail", "Sources say the provider no longer practises here", -30);
  else if (loc.status === "possibly_stale") add("warn", loc.statusNote ?? "This location may be out of date", -15);

  // 2. Phone.
  const phone = loc.phones[0];
  if (!phone) add("unknown", "No phone number found for this location", 0);
  else if (nonFederal(phone.families).length) {
    const n = countingFamilies(phone.families).length + (phone.inNpi && !phone.families.includes("federal") ? 1 : 0);
    add("pass", `Phone ${phone.number} published by ${FAMILY_LABEL[nonFederal(phone.families)[0]].toLowerCase()}${n > 1 ? " and corroborated" : ""}`, n > 1 ? 20 : 15);
  } else add("warn", `Phone ${phone.number} comes only from the NPI record`, 5);

  // 3. Fax.
  const fax = loc.bestFax;
  if (!fax) add("unknown", "No fax number found for this location", 0);
  else if (nonFederal(fax.families).length) add("pass", `Fax ${fax.number} published by ${FAMILY_LABEL[nonFederal(fax.families)[0]].toLowerCase()}${fax.inNpi ? " (NPI record agrees)" : ""}`, 15);
  else add("warn", `Fax ${fax.number} comes only from the NPI record`, 5);
  if (ctx.faxConflict) add("warn", "Sources list different general fax numbers for this location", -10);
  if (ctx.npiFaxElsewhere) add("warn", `The NPI fax for this address is published for a different location (${ctx.npiFaxElsewhere})`, -10);

  // 4. Is it specifically a referral fax?
  if (fax?.faxKind === "referral") {
    const official = nonFederal(fax.families).includes("first_party");
    add("pass", official ? `Official source labels it a referral fax ("${fax.label}")` : `A ${FAMILY_LABEL[nonFederal(fax.families)[0] ?? "independent"].toLowerCase()} labels it a referral fax ("${fax.label}")`, official ? 15 : 8);
  } else if (fax) add("unknown", "Referral-specific fax not established — this is a fax for the location, not a confirmed referral intake line", 0);

  // 5. Instructions + freshness.
  if (loc.referralInstructions) add("pass", "Referral instructions / form found", 5);
  if (ctx.firstPartyCurrent) add("pass", "Supporting official source appears current", 5);
  if (!ctx.researched && ctx.npiUpdatedYearsAgo !== null && ctx.npiUpdatedYearsAgo > 5) add("warn", `NPI record last updated ${Math.floor(ctx.npiUpdatedYearsAgo)} years ago`, -5);

  return finish(items);
}

// ── Provider confidence ──────────────────────────────────────────────────────
export interface ProviderSignals {
  active: boolean;
  specialtyMatch: { matched: boolean; label: string; requested: boolean };
  license: LicenseCheck | null;
  licenseStateSupported: boolean;
  practiceState: string | null;
  isOrg: boolean;
  npiUpdatedYearsAgo: number | null;
  research: Pick<ReferralResearch, "identity" | "specialty" | "affiliations" | "webLicense" | "sources"> | null;
}

export function scoreProvider(s: ProviderSignals): ConfidenceScore {
  const items: ScoreItem[] = [];
  const add = (kind: ScoreItem["kind"], label: string, points: number) => items.push({ kind, label, points });

  if (s.active) add("pass", "Active NPI in the federal NPI Registry", 35);
  else add("fail", "NPI is deactivated", 0);

  if (s.specialtyMatch.matched) add("pass", s.specialtyMatch.requested ? `NPI taxonomy is ${s.specialtyMatch.label}` : `NPI taxonomy: ${s.specialtyMatch.label}`, 10);
  else add("fail", `NPI taxonomy does not include ${s.specialtyMatch.label}`, 0);

  // State licence.
  const lic = bestLicense(s.license ?? undefined);
  if (s.isOrg) add("unknown", "Organizations are not individually licensed in this check", 0);
  else if (!s.license || s.license.match === "unsupported_state") add("unknown", `State licence check not implemented for ${s.practiceState ?? "this state"} (Washington only in this demo)`, 0);
  else if (s.license.match === "error") add("unknown", "State licence lookup failed — try again", 0);
  else if (s.license.match === "none" || !lic) add("unknown", "No WA DOH credential found (absence is not a finding)", 0);
  else {
    const exact = s.license.match === "exact";
    const who = exact ? "matched by licence number" : s.license.match === "ambiguous" ? "name-only match, ambiguous" : "matched by name only";
    if (isActiveStatus(lic.status) && !isRestrictedStatus(lic.status)) add("pass", `WA ${lic.credentialType}: ${lic.status}${lic.expires ? `, expires ${lic.expires}` : ""} (${who})`, exact ? 20 : s.license.match === "ambiguous" ? 5 : 10);
    else if (isActiveStatus(lic.status)) add("warn", `WA credential status: "${lic.status}" (${who})`, 5);
    else add("fail", `WA credential status: "${lic.status}" (${who})`, -20);
    if (lic.actionTaken === "Yes") add("warn", "WA DOH reports “action taken” on this credential — see the certified record", 0);
    else if (lic.actionTaken === "Pending") add("warn", "WA DOH reports a pending action on this credential", 0);
  }

  if (!s.research) {
    add("unknown", "Not yet checked against independent web sources", 0);
  } else {
    const r = s.research;
    const idFams = nonFederal(sourceFamiliesOf(r.identity.sourceIds, r.sources));
    if (r.identity.conflict) add("fail", "Web evidence conflicts with this identity", -25);
    else if (r.identity.confirmed && idFams.includes("first_party")) add("pass", "Identity confirmed by an official practice / health-system source", 20);
    else if (r.identity.confirmed && idFams.length) add("pass", `Identity confirmed by ${FAMILY_LABEL[idFams[0]].toLowerCase()}`, 10);
    else add("unknown", "Identity not independently confirmed on the web", 0);

    const spFams = nonFederal(sourceFamiliesOf(r.specialty.sourceIds, r.sources));
    if (r.specialty.value && spFams.length) add("pass", `Specialty corroborated (${r.specialty.value})`, 10);
    else add("unknown", "Specialty not corroborated beyond the NPI record", 0);

    const aff = r.affiliations.find((a) => a.current === "current" && a.families.includes("first_party"));
    if (aff) add("pass", `Current affiliation confirmed: ${aff.value}`, 5);
    else add("unknown", "Current practice affiliation not confirmed by an official source", 0);

    if (!s.license && r.webLicense.some((w) => sourceFamiliesOf(w.sourceIds, r.sources).includes("state"))) add("pass", "State licence evidence found on a state website", 10);
  }

  if (s.npiUpdatedYearsAgo !== null && s.npiUpdatedYearsAgo > 5) add("warn", `NPI record last updated ${Math.floor(s.npiUpdatedYearsAgo)} years ago`, -5);

  return finish(items, s.active ? 100 : 10);
}

export function sourceFamiliesOf(ids: string[], sources: { id: string; family: SourceFamily }[]): SourceFamily[] {
  return [...new Set(ids.map((id) => sources.find((s) => s.id === id)?.family).filter((f): f is SourceFamily => Boolean(f)))];
}

export function fieldFrom(value: string | null, ids: string[], sources: { id: string; family: SourceFamily }[], opts: Parameters<typeof fieldConfidence>[1] = {}): FieldConfidence {
  const { confidence, basis } = fieldConfidence(sourceFamiliesOf(ids, sources), opts);
  return { value, confidence: value ? confidence : 0, basis: value ? basis : "Not established", sourceIds: ids };
}
