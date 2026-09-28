// Real web-research results for Seattle ENT providers, saved from the M016
// acceptance run (2026-09-28). The demo re-scores them on the server for the
// current search (no AI call), so cold visitors see researched destinations
// without a demo key. Fresh research in this browser takes precedence.
import type { ReferralResearch } from "../types";

let pending: Promise<Map<string, ReferralResearch>> | null = null;

export function loadSnapshot(): Promise<Map<string, ReferralResearch>> {
  pending ??= import("./seattle-ent-research.json").then((m) => new Map((m.default as unknown as ReferralResearch[]).map((r) => [r.npi, r])));
  return pending;
}
