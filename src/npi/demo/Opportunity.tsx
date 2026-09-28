// ── /npi-list/opportunity — "Why explore this?" (PERSONAL POC, not a pitch) ──
// Every number here is either computed from the saved research snapshot at
// runtime or quoted from the M016 Seattle acceptance run. No ROI, no pricing,
// no vendor comparison.
import { useEffect, useState } from "react";
import { Icon } from "../ui";
import { loadSnapshot } from "./snapshot";
import { snapshotMetrics, type SnapshotMetrics } from "./model";
import "./demo.css";

type Status = "shown" | "sim" | "future";
const STATUS: Record<Status, { label: string; cls: string }> = {
  shown: { label: "Demonstrated with real data (Seattle ENT AI research is a saved Sep-28 run)", cls: "rd-st-shown" },
  sim: { label: "Simulated in the demo", cls: "rd-st-sim" },
  future: { label: "Future experiment", cls: "rd-st-future" },
};

const FLOW: [string, Status, string?][] = [
  ["Inbound referral", "future"],
  ["AI document understanding", "future"],
  ["Human review", "sim"],
  ["Audiology workflow", "sim"],
  ["Audiologist selects referral type", "sim", "The clinical decision — supplied, never inferred"],
  ["Deterministic candidate matching", "shown", "NPI taxonomy for the requested type + state + distance (NPI Registry, Census geocoding)"],
  ["Deterministic checks", "shown", "Washington licence, licence-vs-taxonomy, age restrictions, hard mismatches"],
  ["AI research + reconciliation", "shown", "Current practice, per-location fax, referral wording, stale NPI data — evidence only"],
  ["Recommended vs Needs review", "shown", "Plain rules over that evidence; referral fax checked on the page"],
  ["Human chooses the destination", "sim"],
  ["Human approval", "sim"],
  ["Outbound fax", "sim", "Nothing is transmitted"],
  ["Delivery signal", "sim", "Fake webhook"],
  ["Inbound response", "sim"],
  ["AI matching / extraction", "future", "Shown only as a mock-up"],
];

const LADDER: [string, Status | "partial", string][] = [
  ["NPPES lists a fax", "shown", "Read from the federal NPI record for each practice address."],
  ["Official practice corroborates the fax", "shown", "Found on practice or health-system pages, with the source's own label kept verbatim."],
  ["Independent source corroborates the fax", "partial", "Sometimes (payer directories, other sites); not systematically."],
  ["Fax provider verifies the endpoint", "future", "Not attempted."],
  ["Successful real delivery", "future", "Not attempted. No fax has been sent."],
  ["Repeated successful delivery", "future", "Not attempted."],
];

export default function Opportunity() {
  const [m, setM] = useState<SnapshotMetrics | null>(null);
  useEffect(() => { loadSnapshot().then((s) => setM(snapshotMetrics([...s.values()]))).catch(() => setM(null)); }, []);

  return (
    <div className="pi rd rd-opp">
      <header className="rd-top">
        <a className="pi-brand" href="/npi-list/referral-demo"><span className="pi-logo rd-logo"><Icon name="fax" /></span><span>Outbound Referral Workflow</span></a>
        <span className="rd-poc">Synthetic POC</span>
        <div className="rd-top-links">
          <a href="/npi-list/referral-demo">← Back to the demo</a>
          <a href="/npi-list">Provider search</a>
        </div>
      </header>

      <main className="rd-main rd-narrow rd-opp-main">
        <div className="rd-disclaimer">
          <Icon name="info" />
          <div>This prototype was created independently as a personal technical experiment using synthetic patient information and public provider data. It is not production software and does not represent a company product decision.</div>
        </div>
        <div className="rd-disclaimer">
          <Icon name="alert" />
          <div>This page was written before the approach was tested. Whether it routes referrals accurately and economically is <strong>not established</strong>. Measured failures, baselines and raw evidence are on <a href="/npi-list/experiment">the engineering experiment page</a>.</div>
        </div>

        <section className="rd-opp-lead">
          <div className="rd-kicker">A question, not a proposal</div>
          <h1>Has the build-vs-buy equation changed?</h1>
          <p>Modern AI, multimodal models, authoritative public datasets and commodity APIs may make some historically expensive healthcare workflow capabilities cheaper to prototype, and possibly to build. This proof of concept asks whether that possibility is worth <strong>measuring</strong> before assuming that a commercial registry, ingestion or referral product is automatically the right answer.</p>
          <p className="pi-muted">It does not claim that AI can replace commercial healthcare vendors.</p>
        </section>

        <section className="rd-opp-sec">
          <h2>The complete idea</h2>
          <div className="rd-legend-row">{(Object.keys(STATUS) as Status[]).map((k) => <span key={k} className={`rd-st ${STATUS[k].cls}`}>{STATUS[k].label}</span>)}</div>
          <ol className="rd-flow">
            {FLOW.map(([label, st, note]) => (
              <li key={label} className={STATUS[st].cls}>
                <span className="rd-flow-label">{label}</span>
                <span className="rd-flow-note">{note ?? STATUS[st].label}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="rd-opp-sec">
          <h2>What the provider-intelligence experiment actually showed</h2>
          <p>Seattle acceptance test, run in production on Sep 28, 2026: <em>ENT / Otolaryngology within 10 miles of Seattle, WA 98115</em>.</p>
          <div className="rd-stats">
            <Stat n="258" label="ENT destinations within 10 mi" sub="from 551 Washington NPI Registry records" />
            <Stat n="265" label="practice addresses geocoded" sub="249 to the street, 16 to a ZIP centre" />
            <Stat n="~3 s" label="for the whole geographic search" />
            <Stat n={m ? String(m.providers) : "…"} label="providers web-researched" sub="the M016 acceptance set of nearby ENT listings" />
          </div>
          {m && (
            <div className="rd-stats">
              <Stat n={`${m.locationsCorroborated} / ${m.locations}`} label="current locations corroborated" sub="by a non-NPI source" />
              <Stat n={`${m.faxesCorroborated} / ${m.faxes}`} label="distinct faxes corroborated" sub="by a non-NPI source" />
              <Stat n={String(m.referralFaxes)} label="referral faxes explicitly identified" sub={`for ${m.providersWithReferralFax} of ${m.providers} providers; wording checked on the live page`} />
              <Stat n={String(m.conflicts)} label="conflicts recorded" sub={`${m.npiIncompleteOrStale} of ${m.providers} NPI records stale or incomplete; ${m.specialtyDifferent} with a different current specialty`} />
              <Stat n={String(m.dropped)} label="AI claims removed by deterministic checks" sub="unsupported numbers, wrong-person pages, unchecked 'referral' labels" />
              <Stat n={`${m.avgSeconds} s`} label="average research time per provider" sub={`range ${m.minSeconds}–${m.maxSeconds} s`} />
            </div>
          )}
          <ul className="rd-shown">
            <li><Icon name="check" size={14} /> Live NPI retrieval and geographic search by specialty and radius</li>
            <li><Icon name="check" size={14} /> Independent web research that separates each practice location, with its own phone and fax</li>
            <li><Icon name="check" size={14} /> Conflict detection: stale NPI addresses, a physician now in a different specialty, an audiologist listed under an ENT taxonomy</li>
            <li><Icon name="check" size={14} /> Evidence provenance on every field, and explainable (not calibrated) confidence</li>
            <li><Icon name="check" size={14} /> State credential verification against Washington DOH data (Washington only)</li>
          </ul>
          <div className="rd-card rd-lesson">
            <strong>The most useful finding:</strong> the AI made confident mistakes in live runs. It invented “fax referrals to” wording, labelled clinic pages as a different provider and over-called specialty differences. Each was caught by a deterministic rule, such as re-fetching the cited page and checking that the referral wording is actually next to the number. That's why the pattern here is <em>AI proposes, code verifies, humans decide</em>.
          </div>
        </section>

        <section className="rd-opp-sec">
          <h2>Fax: a future experiment</h2>
          <p>Evidence that a fax number is right comes in different strengths. The POC has only reached the first rungs.</p>
          <ol className="rd-ladder">
            {LADDER.map(([label, st, note]) => (
              <li key={label} className={st === "partial" ? "rd-st-partial" : STATUS[st].cls}>
                <span className="rd-ladder-label">{label}</span>
                <span className="rd-ladder-st">{st === "shown" ? "Demonstrated" : st === "partial" ? "Partly" : "Not yet"}</span>
                <span className="rd-ladder-note">{note}</span>
              </li>
            ))}
          </ol>
          <div className="rd-card rd-next-poc">
            <strong>A particularly interesting next POC:</strong> integrate a real fax provider (SRFax is one candidate) using <em>only synthetic data</em>, and test send, delivery status, failure, webhook, inbound fax and matching.
            <div className="pi-muted">No fax provider's capabilities, including SRFax's, have been checked against its current API, docs or account yet.</div>
          </div>
        </section>

        <section className="rd-opp-sec">
          <h2>A second experiment: AI document ingestion</h2>
          <p><strong>Question:</strong> could modern multimodal AI, plus deterministic validation, plus targeted human review, handle enough referral-document ingestion to justify measuring it against specialised commercial ingestion vendors?</p>
          <div className="rd-pipe">
            {["PDF / scan / fax", "Multimodal AI", "Document classification", "Candidate extraction", "Deterministic validation", "Confidence", "Human reviews uncertainty"].map((s, i) => <span key={s}>{i > 0 && <Icon name="chevron" size={12} />}{s}</span>)}
          </div>
          <p>Nothing here has been built or tested. It would be worth measuring:</p>
          <div className="rd-measure">
            {["Field accuracy", "Document classification accuracy", "Human-review rate", "Serious error rate", "Latency", "Cost per document", "Difficult-document performance"].map((x) => <span key={x}>{x}</span>)}
          </div>
        </section>

        <section className="rd-opp-sec rd-not">
          <h2>What this does not prove</h2>
          <p>This POC does <strong>not</strong> establish:</p>
          <ul>
            {["Production readiness", "Regulatory or compliance readiness", "HIPAA readiness", "Superiority to commercial provider datasets", "Superiority to commercial ingestion vendors", "Complete provider coverage (one state, capped search)", "Calibrated confidence probabilities", "Payer-network correctness", "National licensing coverage (Washington only)", "Guaranteed fax correctness", "Production operating cost", "Maintenance cost", "ROI"].map((x) => <li key={x}><Icon name="x" size={13} /> {x}</li>)}
          </ul>
          <p className="pi-muted">These remain open questions. Research results also vary from run to run for the same provider.</p>
        </section>

        <section className="rd-opp-sec">
          <h2>Why investigate at all?</h2>
          {m ? (
            <ul className="rd-facts">
              <li>{m.providers} real providers researched from public data in about {m.avgSeconds} seconds each, with every contact field traceable to a source ({m.sources} sources across {m.domains} domains).</li>
              <li>{m.locationsCorroborated} of {m.locations} current practice locations and {m.faxesCorroborated} of {m.faxes} faxes were corroborated beyond the NPI record; {m.referralFaxes} referral-specific faxes were identified and checked on the source page.</li>
              <li>Uncertainty is visible rather than hidden: {m.providers - m.providersWithReferralFax} of {m.providers} researched providers had no machine-checked referral fax, and the UI says so instead of guessing.</li>
              <li>Model usage for these {m.providers} runs: {m.searchCalls} web searches and {Math.round(m.inputTokens / 1000)}k input / {Math.round(m.outputTokens / 1000)}k output tokens ({m.models.join(", ")}). About 45 paid research calls were made across the whole test cycle. A dollar cost per provider wasn't measured.</li>
            </ul>
          ) : <p className="pi-muted">Loading measured results…</p>}
          <p className="rd-argument">We have shown enough capability, cheaply enough, that <strong>measuring</strong> this against commercial alternatives may be rational. We have not shown that we should build it.</p>
        </section>

        <section className="rd-opp-sec rd-ask">
          <div className="rd-kicker">Question worth answering</div>
          <h2>Can authoritative public provider data, modern AI research, deterministic validation and operational referral signals produce sufficiently accurate and useful outbound referral intelligence at an acceptable total cost?</h2>
          <div className="rd-kicker" style={{ marginTop: 22 }}>Possible next step</div>
          <p>Run a bounded, company-sponsored evaluation against representative outbound-referral scenarios, and compare the following against the commercial alternatives being considered:</p>
          <div className="rd-measure">
            {["Accuracy", "Coverage", "Staff effort", "Latency", "Operational risk", "Integration effort", "Total cost"].map((x) => <span key={x}>{x}</span>)}
          </div>
          <p className="rd-ask-line">That is the ask. It is not a request for permission to deploy this prototype.</p>
        </section>
      </main>
      <footer className="pi-foot rd-foot">Personal proof of concept · synthetic patients only · not production software · <a href="/npi-list/referral-demo">Back to the demo</a></footer>
    </div>
  );
}

function Stat({ n, label, sub }: { n: string; label: string; sub?: string }) {
  return (
    <div className="rd-stat">
      <div className="rd-stat-n">{n}</div>
      <div className="rd-stat-label">{label}</div>
      {sub && <div className="rd-stat-sub">{sub}</div>}
    </div>
  );
}
