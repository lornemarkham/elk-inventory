// One-line connection from the (unchanged) Provider Intelligence experiment to the
// Shared Organizational Knowledge POC. Rendered ABOVE the experiment by main.tsx so
// the experiment page itself is not edited.
import "./org.css";

export default function ExperimentBanner() {
  return (
    <div className="og-exp-banner" role="note">
      <b>What we learned:</b> public provider data is useful for discovering candidates, but this experiment did not establish that automated research can reliably determine referral destinations.
      <a href="/npi-list/shared-knowledge">Next hypothesis: can clinics reuse referral knowledge already verified inside their organization? →</a>
    </div>
  );
}
