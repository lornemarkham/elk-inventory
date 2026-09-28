// ── Provider Intelligence embed protocol — pure helpers (SYNTHETIC POC) ───────
// Shared by the iframe page (./EmbedPI.tsx); the host side is the plain-JS loader
// public/npi-sdk/provider-intelligence.js, which speaks the same protocol string.
import { REFERRAL_TYPES } from "../demo/routing";

export const EMBED_PROTOCOL = "pi-embed/1";

// "ENT", "ent" or "ENT / Otolaryngology" → the finder's referral type. Unknown → null
// (never a substitute).
export function resolveReferralType(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  const t = REFERRAL_TYPES.find((x) => x.key === s || x.value.toLowerCase() === s || x.value.split(" / ")[0].toLowerCase() === s);
  return t?.value ?? null;
}
