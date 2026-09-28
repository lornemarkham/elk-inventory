// ── NPI demo — Washington DOH credential adapter (TEMPORARY DEMO) ────────────
// Source: WA Department of Health "Health Care Provider Credential Data"
// (data.wa.gov dataset qxh8-f4bd, Socrata SODA API, public, no key). DOH calls it
// "a primary source for verification of credentials", refreshed daily.
//
// Matching is deterministic:
//   exact   — the NPPES taxonomy license for WA has the same profession code +
//             8-digit number as a DOH credential (e.g. NPPES "MD60441019" ⇔
//             DOH "MD.MD.60441019"), and the last name agrees.
//   name    — no usable license number; exactly one DOH credential of the
//             expected profession matches first + last name. Weaker.
//   none    — searched, nothing matched. This is NOT evidence of anything bad:
//             absence of a record is reported as "not found", never as a status.
// Disciplinary information: the dataset's own `actiontaken` column is shown
// verbatim ("Yes" / "Pending" / "No"); nothing is inferred beyond it.

import type { LicenseCheck, LicenseRecord } from "../src/npi/types";

const DATASET = "https://data.wa.gov/resource/qxh8-f4bd.json";
export const WA_LOOKUP_URL = "https://fortress.wa.gov/doh/providercredentialsearch/";
const SOURCE = "Washington State Department of Health — Provider Credential Data (data.wa.gov)";

export interface LicenseSubject {
  npi: string;
  firstName: string | null;
  lastName: string | null;
  isOrg: boolean;
  licenses: { state: string | null; license: string | null }[];
}

// "MD60441019" | "ML.61165617" | "ML 60571866" | "MD00028450" → { prof: "MD", num: "60441019" }
export function parseWaLicense(raw: string | null): { prof: string | null; num: string } | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/\s+/g, "");
  const m = s.match(/^([A-Z]{2,4})?[.\-]?([A-Z]{2})?[.\-]?(\d{5,8})$/);
  if (!m) return null;
  const prof = m[2] ?? m[1] ?? null;
  return { prof: prof ? prof.slice(-2) : null, num: m[3].padStart(8, "0") };
}

// NPPES profession code → DOH credential-number prefixes (verified against the dataset).
const PREFIXES: Record<string, string[]> = {
  MD: ["MD.MD", "IMLC.MD"],
  ML: ["MDRE.ML", "MDCE.ML", "MDHD.ML", "MDIN.ML"],
  FE: ["MDFE.FE"],
  TR: ["MDTR.TR"],
  OP: ["DO.OP"],
  DO: ["DO.OP"],
  OL: ["DOL.OL"],
  LD: ["AUD.LD"],
  AU: ["AUD.LD"],
  CD: ["CD.CD"],
  PA: ["PA.PA"],
};

export function credentialCandidates(lic: { prof: string | null; num: string }): string[] {
  const prefixes = lic.prof ? PREFIXES[lic.prof] ?? [`${lic.prof}.${lic.prof}`] : ["MD.MD", "DO.OP", "AUD.LD", "PA.PA"];
  return prefixes.flatMap((p) => (p.startsWith("DO.") || p.startsWith("IMLC") ? [`${p}.${lic.num}`, `${p}.${lic.num}-IMLC`] : [`${p}.${lic.num}`]));
}

// "DO.OP.60817760-IMLC" → "60817760"
export const credentialDigits = (c: string | undefined) => (c?.split(".").pop() ?? "").replace(/-.*$/, "");

const ACTIVE = /^active/i;

// "Thomas Jr" ⇔ "THOMAS", "Mc Pherson" ⇔ "MCPHERSON".
export function sameLastName(a: string, b: string): boolean {
  const n = (s: string) => s.toUpperCase().replace(/\b(JR|SR|II|III|IV)\b/g, "").replace(/[^A-Z]/g, "");
  return n(a) !== "" && n(a) === n(b);
}

function toRecord(r: Record<string, string>): LicenseRecord {
  return {
    credentialNumber: r.credentialnumber,
    credentialType: r.credentialtype,
    status: r.status || "Unknown",
    name: [r.firstname, r.middlename, r.lastname].filter(Boolean).join(" "),
    firstIssued: r.firstissuedate ?? null,
    lastIssued: r.lastissuedate ?? null,
    expires: r.expirationdate ?? null,
    actionTaken: (r.actiontaken as LicenseRecord["actionTaken"]) || null,
  };
}

function soql(where: string, limit = 1000): string {
  return `${DATASET}?${new URLSearchParams({ $where: where, $limit: String(limit) })}`;
}

const esc = (s: string) => s.replace(/'/g, "''");

async function query(where: string, limit = 1000): Promise<Record<string, string>[]> {
  const res = await fetch(soql(where, limit), { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`WA DOH HTTP ${res.status}`);
  return res.json();
}

// Batch: one indexed query per 150 candidate credential numbers, then a name
// query (a few in parallel) for each subject the number didn't resolve. Returns a check per NPI.
export async function checkWaLicenses(subjects: LicenseSubject[]): Promise<Map<string, LicenseCheck>> {
  const out = new Map<string, LicenseCheck>();
  const checkedAt = new Date().toISOString();
  const people = subjects.filter((s) => !s.isOrg && s.lastName);
  const withNum = people.map((s) => ({ s, lic: s.licenses.filter((l) => l.state === "WA").map((l) => parseWaLicense(l.license)).find(Boolean) ?? null }));

  // Exact IN (...) on full credential numbers is indexed and fast; LIKE '%…' scans ~3M rows.
  const candidates = [...new Set(withNum.flatMap((x) => (x.lic ? credentialCandidates(x.lic) : [])))];
  const byNum = new Map<string, Record<string, string>[]>();
  for (let i = 0; i < candidates.length; i += 150) {
    const list = candidates.slice(i, i + 150).map((c) => `'${esc(c)}'`).join(",");
    for (const r of await query(`credentialnumber in (${list})`)) {
      const num = credentialDigits(r.credentialnumber);
      byNum.set(num, [...(byNum.get(num) ?? []), r]);
    }
  }

  const base = { state: "WA", source: SOURCE, sourceUrl: WA_LOOKUP_URL, checkedAt };
  const fallback: typeof withNum = [];
  for (const x of withNum) {
    const { s, lic } = x;
    const rows = lic ? (byNum.get(lic.num) ?? []).filter((r) => {
      const prof = r.credentialnumber.split(".")[1];
      return (!lic.prof || prof === lic.prof) && sameLastName(r.lastname ?? "", s.lastName!);
    }) : [];
    if (rows.length) out.set(s.npi, { ...base, match: "exact", matchNote: `NPPES WA license ${lic!.prof ?? ""}${lic!.num} matches the DOH credential number and last name`, records: rows.map(toRecord) });
    else fallback.push(x);
  }

  // Fallback: first + last name, 25 subjects per query (cross product filtered here).
  for (let i = 0; i < fallback.length; i += 25) {
    const chunk = fallback.slice(i, i + 25);
    const lasts = [...new Set(chunk.flatMap(({ s }) => { const l = s.lastName!.toUpperCase(); return [l, `${l} JR`, `${l} SR`, `${l} II`, `${l} III`]; }))];
    const firsts = [...new Set(chunk.map(({ s }) => (s.firstName ?? "").toUpperCase()))];
    let rows: Record<string, string>[] | null = null;
    let error: string | null = null;
    try {
      rows = await query(`upper(lastname) in (${lasts.map((x) => `'${esc(x)}'`).join(",")}) AND upper(firstname) in (${firsts.map((x) => `'${esc(x)}'`).join(",")})`, 5000);
    } catch (err) {
      error = (err as Error).message;
    }
    for (const { s, lic } of chunk) {
      if (!rows) { out.set(s.npi, { ...base, match: "error", matchNote: `WA DOH lookup failed: ${error}`, records: [] }); continue; }
      const recs = rows
        .filter((r) => sameLastName(r.lastname ?? "", s.lastName!) && (r.firstname ?? "").toUpperCase() === (s.firstName ?? "").toUpperCase())
        .map(toRecord)
        .filter((r) => !/(Nurse|Assistant|Technician|Emergency|Counselor|Massage|Pharmacy)/i.test(r.credentialType));
      const people = new Set(recs.map((r) => r.name.toUpperCase()));
      const note = (lic ? `NPPES WA licence ${lic.num} not found at DOH; matched on name only` : "No WA licence number in NPPES; matched on first + last name only") +
        (people.size > 1 ? ` — ${people.size} different people share this name, so the match is ambiguous` : "");
      out.set(s.npi, recs.length
        ? { ...base, match: people.size > 1 ? "ambiguous" : "name", matchNote: note, records: recs }
        : { ...base, match: "none", matchNote: "No DOH credential found for this licence number or name. Absence of a record is not evidence of anything.", records: [] });
    }
  }
  return out;
}

// The credential that best represents current licensure: an active one if any.
export function bestLicense(c: LicenseCheck | undefined): LicenseRecord | null {
  if (!c || !c.records.length) return null;
  const main = (r: LicenseRecord) => !/(Temporary|Residency|Limited|Permit)/i.test(r.credentialType);
  return c.records.find((r) => ACTIVE.test(r.status) && main(r)) ?? c.records.find((r) => ACTIVE.test(r.status)) ?? c.records[0];
}

export const isActiveStatus = (s: string) => ACTIVE.test(s);
export const isRestrictedStatus = (s: string) => /(probation|conditions|restriction|suspen|revoked|surrender)/i.test(s);
