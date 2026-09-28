// ── NPI demo — small shared UI bits (TEMPORARY DEMO) ─────────────────────────
import { useState } from "react";
import type { ConfidenceScore, ContactNumber, EvidenceSource, FaxKind, LicenseCheck, PracticeLocation, SourceFamily } from "./types";

const PATHS: Record<string, string> = {
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35",
  check: "M5 12.5l4.5 4.5L19 7",
  chevron: "M9 6l6 6-6 6",
  down: "M6 9l6 6 6-6",
  back: "M15 6l-6 6 6 6",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z",
  fax: "M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7Z",
  registry: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2ZM8 8h8M8 12h8M8 16h5",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z",
  scale: "M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7Zm14 0-3 7a3 3 0 0 0 6 0l-3-7Z",
  building: "M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4M3 21h18",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v-5m0-3h.01",
  alert: "M12 3 2 20h20L12 3Zm0 6v5m0 3h.01",
  x: "M6 6l12 12M18 6 6 18",
  question: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.5-11.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6m0 3h.01",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  stethoscope: "M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-2m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3Z",
  send: "M4 12 20 4l-6 16-3-7-7-1Z",
  key: "M15 7a4 4 0 1 1-3.9 4.9L4 19v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7Zm1 1.5h.01",
  filter: "M3 5h18l-7 8v6l-4 2v-8L3 5Z",
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg className="pi-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

export function initials(name: string): string {
  const parts = name.split(" ").filter((p) => /^[A-Za-z]/.test(p) && !/^(Dr|Mr|Mrs|Ms)\.?$/i.test(p));
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export const FAMILY_LABEL: Record<SourceFamily, string> = {
  federal: "Federal (CMS/NPPES)",
  state: "State authority",
  first_party: "Official practice / health system",
  payer: "Payer directory",
  professional: "Professional / specialty body",
  independent: "Independent source",
  aggregator: "Aggregator / NPI mirror",
};

export const FAMILY_SHORT: Record<SourceFamily, string> = {
  federal: "NPPES",
  state: "State",
  first_party: "Official",
  payer: "Payer",
  professional: "Professional",
  independent: "Independent",
  aggregator: "Aggregator",
};

export const FAX_KIND_LABEL: Record<FaxKind, string> = {
  referral: "Referral fax",
  scheduling: "Scheduling fax",
  office: "Office fax",
  general: "Fax",
  unknown: "Fax",
};

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return formatDate(iso);
}

export const tone = (n: number) => (n >= 80 ? "good" : n >= 60 ? "ok" : "low");

export function ScorePill({ label, score, onClick, active }: { label: string; score: number; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" className={`pi-score pi-score-${tone(score)} ${active ? "pi-score-active" : ""}`} onClick={onClick} disabled={!onClick} title={onClick ? `Why ${score}%?` : undefined}>
      <span className="pi-score-num">{score}%</span>
      <span className="pi-score-label">{label}</span>
    </button>
  );
}

export function Breakdown({ score, title }: { score: ConfidenceScore; title?: string }) {
  return (
    <div className="pi-why">
      {title && <div className="pi-why-title">{title}</div>}
      <ul className="pi-breakdown">
        {score.items.map((i, n) => (
          <li key={n} className={`pi-bd pi-bd-${i.kind}`}>
            <span className="pi-bd-icon"><Icon name={i.kind === "pass" ? "check" : i.kind === "warn" ? "alert" : i.kind === "fail" ? "x" : "question"} size={13} /></span>
            <span className="pi-bd-label">{i.label}</span>
            <span className="pi-bd-pts">{i.points > 0 ? `+${i.points}` : i.points === 0 ? "0" : i.points}</span>
          </li>
        ))}
      </ul>
      <div className="pi-why-total">= {score.score}% <span>({score.band}) · sum of the points above, clamped to 0–100. A transparent heuristic, not a calibrated probability.</span></div>
    </div>
  );
}

// ✓ / ? / ✗ facts for a destination, derived only from structured data.
export interface Check { state: "ok" | "unknown" | "bad"; label: string }

const nonFederal = (fams: SourceFamily[]) => fams.filter((f) => f !== "federal" && f !== "aggregator");

export function destinationChecks(o: { active: boolean; loc: PracticeLocation; license: LicenseCheck | null; researched: boolean; specialtyCorroborated: boolean; specialtyDifferent?: boolean; isOrg: boolean }): Check[] {
  const { loc } = o;
  const out: Check[] = [];
  out.push(o.active ? { state: "ok", label: "Active NPI" } : { state: "bad", label: "NPI deactivated" });
  if (!o.isOrg) {
    const lic = o.license;
    const best = lic?.records.find((r) => /^active/i.test(r.status)) ?? lic?.records[0];
    if (!lic || lic.match === "unsupported_state") out.push({ state: "unknown", label: "Licence not checked (WA only)" });
    else if (lic.match === "none" || lic.match === "error" || !best) out.push({ state: "unknown", label: lic.match === "error" ? "Licence lookup failed" : "No WA licence record found" });
    else if (/^active/i.test(best.status)) out.push({ state: lic.match === "exact" ? "ok" : "unknown", label: `WA licence ${best.status.toLowerCase()}${lic.match === "exact" ? "" : " (name match)"}` });
    else out.push({ state: "bad", label: `WA licence ${best.status.toLowerCase()}` });
  }
  out.push(o.specialtyDifferent ? { state: "bad", label: "Current specialty differs from NPI" } : o.specialtyCorroborated ? { state: "ok", label: "Specialty corroborated" } : { state: "ok", label: "Specialty in NPI taxonomy" });
  const locOk = nonFederal(loc.families).length > 0;
  if (loc.status === "former") out.push({ state: "bad", label: "Provider has left this location" });
  else if (loc.status === "possibly_stale") out.push({ state: "bad", label: "Location may be stale" });
  else out.push(locOk ? { state: "ok", label: "Current location corroborated" } : { state: "unknown", label: o.researched ? "Location only in NPI record" : "Location from NPI (not yet researched)" });
  const phone = loc.phones[0];
  out.push(!phone ? { state: "unknown", label: "No phone found" } : nonFederal(phone.families).length ? { state: "ok", label: "Phone corroborated" } : { state: "unknown", label: "Phone from NPI only" });
  const fax = loc.bestFax;
  out.push(!fax ? { state: "unknown", label: "No fax found" } : nonFederal(fax.families).length ? { state: "ok", label: "Fax corroborated" } : { state: "unknown", label: "Fax from NPI only" });
  out.push(fax?.faxKind === "referral" ? { state: "ok", label: "Referral fax labelled by source" } : { state: "unknown", label: "Referral-specific fax not established" });
  return out;
}

export function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="pi-checks">
      {checks.map((c) => (
        <li key={c.label} className={`pi-check pi-check-${c.state}`}>
          <Icon name={c.state === "ok" ? "check" : c.state === "bad" ? "x" : "question"} size={12} /> {c.label}
        </li>
      ))}
    </ul>
  );
}

export function FaxBlock({ fax, compact = false }: { fax: ContactNumber | null; compact?: boolean }) {
  if (!fax) {
    return (
      <div className="pi-fax pi-fax-none">
        <div className="pi-fax-kind">Fax</div>
        <div className="pi-fax-num pi-muted">Not found</div>
      </div>
    );
  }
  const referral = fax.faxKind === "referral";
  return (
    <div className={`pi-fax ${referral ? "pi-fax-referral" : ""} ${compact ? "pi-fax-compact" : ""}`}>
      <div className="pi-fax-kind"><Icon name="fax" size={13} /> {FAX_KIND_LABEL[fax.faxKind ?? "unknown"]}</div>
      <div className="pi-fax-num pi-mono">{fax.number}</div>
      {!compact && fax.label && <div className="pi-fax-label">Source label: “{fax.label}”</div>}
    </div>
  );
}

export function SourceChips({ ids, sources }: { ids: string[]; sources: EvidenceSource[] }) {
  const list = ids.map((id) => sources.find((s) => s.id === id)).filter((s): s is EvidenceSource => Boolean(s));
  const npi = ids.includes("NPPES");
  const wa = ids.includes("WA-DOH");
  if (!list.length && !npi && !wa) return null;
  return (
    <span className="pi-cites">
      {npi && <span className="pi-cite pi-cite-federal"><span className="pi-cite-type">NPPES</span> NPI record</span>}
      {wa && <span className="pi-cite pi-cite-state"><span className="pi-cite-type">State</span> WA DOH</span>}
      {list.map((s) => (
        <a key={s.id} className={`pi-cite pi-cite-${s.family}`} href={s.url} target="_blank" rel="noreferrer" title={`${s.name} — ${FAMILY_LABEL[s.family]}`}>
          <span className="pi-cite-type">{FAMILY_SHORT[s.family]}</span> {s.domain}
        </a>
      ))}
    </span>
  );
}

export function Collapse({ title, children, defaultOpen = false, count }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; count?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`pi-card pi-collapse ${open ? "pi-open" : ""}`}>
      <button className="pi-collapse-head" onClick={() => setOpen(!open)}>
        <span className="pi-card-title">{title}{count !== undefined && <span className="pi-count-badge">{count}</span>}</span>
        <Icon name="down" />
      </button>
      {open && <div className="pi-collapse-body">{children}</div>}
    </section>
  );
}
