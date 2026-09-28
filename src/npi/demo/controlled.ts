// ── Controlled test destination (SYNTHETIC POC ONLY) ─────────────────────────
// A fictional provider whose referral fax is Lorne's own controlled SRFax line,
// supplied explicitly for POC fax-integration testing. It is NOT a real
// clinician: no NPI, no licence, no address, no distance, no scores. It never
// enters the provider search, its counts or its scoring — the demo renders it
// in its own box, and only in the synthetic referral workflow.
import type { Destination } from "./model";

export const CONTROLLED_FAX = "(778) 506-2042";

export const CONTROLLED = {
  id: "SYNTHETIC-CONTROLLED-1",
  name: "Lorne Markham, MD",
  role: "Synthetic Neurologist",
  testSpecialtyKey: "neurology",
  fax: CONTROLLED_FAX,
  labels: ["SYNTHETIC TEST PROVIDER", "NOT A REAL CLINICIAN", "CONTROLLED FAX DESTINATION"],
} as const;

export function controlledDestination(): Destination {
  return {
    kind: "controlled",
    npi: null,
    provider: CONTROLLED.name,
    specialty: CONTROLLED.role,
    practice: "Controlled test destination (synthetic)",
    address: "No physical address — synthetic test provider",
    distanceMi: null,
    phone: null,
    fax: CONTROLLED.fax,
    faxKind: "referral",
    faxChecked: false, // designated by the POC owner, not verified by public evidence
    faxLabel: null,
    faxSources: [],
    providerScore: null,
    referralScore: null,
    researchedAt: null,
    reviewReasons: [],
  };
}

export const isControlled = (d: Pick<Destination, "kind">) => d.kind === "controlled";

export function controlledFit(requestedKey: string | null): { matches: boolean; text: string } {
  return requestedKey === CONTROLLED.testSpecialtyKey
    ? { matches: true, text: "Test specialty matches this synthetic scenario." }
    : { matches: false, text: "Test specialty does not match the requested referral type — available only because this is the controlled POC destination." };
}
