import { Icon } from "../ui";
import { intentKey } from "./routing";
import { CONTROLLED, controlledFit } from "./controlled";

// ── Controlled test destination (synthetic, outside the search) ─────────────

export default function ControlledCard({ requested, onChoose }: { requested: string; onChoose: () => void }) {
  const fit = controlledFit(intentKey(requested));
  return (
    <aside className="rd-controlled" aria-label="Controlled test destination">
      <div className="rd-controlled-kicker">Controlled test destination · not part of the search</div>
      <div className="rd-controlled-labels">{CONTROLLED.labels.map((l) => <span key={l}>{l}</span>)}</div>
      <div className="rd-controlled-body">
        <div>
          <div className="rd-controlled-name">{CONTROLLED.name}</div>
          <div className="pi-muted">{CONTROLLED.role}</div>
          <ul>
            <li>Not part of search ranking or counts</li>
            <li>Not geographically matched · no address</li>
            <li>Not a real provider record · no NPI · no licence</li>
          </ul>
        </div>
        <div>
          <div className="rd-controlled-fax">
            <div className="pi-fax-kind"><Icon name="fax" size={13} /> Referral fax — controlled test</div>
            <div className="pi-fax-num pi-mono">{CONTROLLED.fax}</div>
            <div className="pi-fax-sem">Purpose: controlled fax-integration testing.</div>
          </div>
          <div className={`rd-controlled-fit ${fit.matches ? "rd-match" : "rd-nomatch"}`}>{fit.text}</div>
        </div>
        <button className="pi-btn pi-btn-primary" onClick={onChoose}>Choose test destination <Icon name="chevron" /></button>
      </div>
    </aside>
  );
}

