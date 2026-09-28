// ── Fake attachments — generated previews of synthetic documents (SYNTHETIC POC) ─
import { FREQS, type Attachment, type PatientRecord, type Scenario } from "./model";
import { Icon } from "../ui";

export function DocPreview({ att, scenario, patient, onClose }: { att: Attachment; scenario: Scenario; patient: PatientRecord; onClose: () => void }) {
  return (
    <div className="rd-modal" role="dialog" aria-modal onClick={onClose}>
      <div className="rd-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="rd-sheet-head">
          <span><Icon name="registry" size={15} /> {att.name}</span>
          <span className="rd-synth-tag">Synthetic demo document</span>
          <button className="rd-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="rd-paper">
          <div className="rd-watermark">SYNTHETIC DEMO</div>
          {att.kind === "upload" ? <UploadNote att={att} />
            : att.id === "audiogram" ? <Audiogram scenario={scenario} patient={patient} />
            : att.id === "tymp" ? <Tymp patient={patient} />
            : att.id === "insurance" ? <InsuranceCard patient={patient} />
            : <Report patient={patient} />}
        </div>
      </div>
    </div>
  );
}

function DocHeader({ title, patient }: { title: string; patient: PatientRecord }) {
  return (
    <div className="rd-doc-head">
      <div>
        <div className="rd-doc-clinic">Example Hearing Clinic</div>
        <div className="rd-doc-title">{title}</div>
      </div>
      <div className="rd-doc-pt">
        <div><strong>{patient.name || "—"}</strong></div>
        <div>DOB {patient.dob || "—"}</div>
      </div>
    </div>
  );
}

// Standard audiogram: frequency across, dB HL down. Right = red O, left = blue X.
export function Audiogram({ scenario, patient, small = false }: { scenario: Scenario; patient?: PatientRecord; small?: boolean }) {
  const W = 420, H = 300, L = 44, T = 18, R = 12, B = 30;
  const x = (i: number) => L + (i * (W - L - R)) / (FREQS.length - 1);
  const y = (db: number) => T + ((db + 10) * (H - T - B)) / 130;
  const { right, left, bone } = scenario.audiogram;
  const path = (v: number[]) => v.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d)}`).join(" ");
  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} className={small ? "rd-audio-sm" : "rd-audio"} role="img" aria-label="Synthetic audiogram">
      {Array.from({ length: 14 }, (_, k) => k * 10 - 10).map((db) => (
        <g key={db}>
          <line x1={L} x2={W - R} y1={y(db)} y2={y(db)} className="rd-grid" />
          {!small && db % 20 === 0 && <text x={L - 8} y={y(db) + 3} className="rd-axis" textAnchor="end">{db}</text>}
        </g>
      ))}
      {FREQS.map((f, i) => (
        <g key={f}>
          <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} className="rd-grid" />
          {!small && <text x={x(i)} y={H - B + 16} className="rd-axis" textAnchor="middle">{f >= 1000 ? `${f / 1000}k` : f}</text>}
        </g>
      ))}
      <rect x={L} y={y(-10)} width={W - L - R} height={y(25) - y(-10)} className="rd-normal" />
      <path d={path(right)} className="rd-line-r" />
      <path d={path(left)} className="rd-line-l" />
      {right.map((d, i) => <circle key={`r${i}`} cx={x(i)} cy={y(d)} r={small ? 4 : 5.5} className="rd-mark-r" />)}
      {left.map((d, i) => <g key={`l${i}`} className="rd-mark-l"><line x1={x(i) - 5} y1={y(d) - 5} x2={x(i) + 5} y2={y(d) + 5} /><line x1={x(i) + 5} y1={y(d) - 5} x2={x(i) - 5} y2={y(d) + 5} /></g>)}
      {bone && bone.right.map((d, i) => <text key={`br${i}`} x={x(i) - 12} y={y(d) + 4} className="rd-bone-r">&lt;</text>)}
      {!small && <text x={12} y={T + 8} className="rd-axis">dB HL</text>}
    </svg>
  );
  if (small) return svg;
  return (
    <>
      {patient && <DocHeader title="Audiogram" patient={patient} />}
      {svg}
      <div className="rd-legend"><span className="rd-key-r">○ Right (air)</span><span className="rd-key-l">✕ Left (air)</span>{bone && <span className="rd-key-r">&lt; Right (bone)</span>}<span className="rd-key-n">Shaded: normal range</span></div>
    </>
  );
}

function Tymp({ patient }: { patient: PatientRecord }) {
  const peak = (cx: number) => `M20,150 C${cx - 60},148 ${cx - 25},40 ${cx},38 C${cx + 25},40 ${cx + 60},148 200,150`;
  return (
    <>
      <DocHeader title="Tympanometry" patient={patient} />
      <div className="rd-tymp">
        {[{ ear: "Right", d: "M20,146 C80,142 140,142 200,146", note: "Type B — flat" }, { ear: "Left", d: peak(110), note: "Type A" }].map((t) => (
          <figure key={t.ear}>
            <svg viewBox="0 0 220 170"><line x1="20" y1="150" x2="200" y2="150" className="rd-grid" /><line x1="110" y1="20" x2="110" y2="150" className="rd-grid" /><path d={t.d} className={t.ear === "Right" ? "rd-line-r" : "rd-line-l"} /></svg>
            <figcaption><strong>{t.ear}</strong> · {t.note}</figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}

function Report({ patient }: { patient: PatientRecord }) {
  return (
    <>
      <DocHeader title="Audiology report" patient={patient} />
      <div className="rd-doc-body">
        <h4>Findings</h4><p>{patient.audiology || "—"}</p>
        <h4>History</h4><p>{patient.history || "—"}</p>
        <h4>Recommendation</h4><p>{patient.reason || "—"}</p>
        <div className="rd-doc-sign">A. Demo, AuD · Example Hearing Clinic · (555) 010-0000</div>
      </div>
    </>
  );
}

function InsuranceCard({ patient }: { patient: PatientRecord }) {
  return (
    <>
      <DocHeader title="Insurance information" patient={patient} />
      <div className="rd-inscard">
        <div className="rd-ins-brand">{patient.insurance || "Example Health"}</div>
        <div className="rd-ins-grid">
          <div><span>Member</span>{patient.name}</div>
          <div><span>Member ID</span>{patient.memberId || "DEMO-0000-0000"}</div>
          <div><span>Group</span>DEMO-GRP-01</div>
          <div><span>Plan</span>Specimen — not a real plan</div>
        </div>
        <div className="rd-ins-specimen">SPECIMEN · SYNTHETIC</div>
      </div>
    </>
  );
}

function UploadNote({ att }: { att: Attachment }) {
  return (
    <div className="rd-doc-body">
      <h4>{att.name}</h4>
      <p>Local file attached for this browser session only. The demo records the file name and size; it doesn't read, upload or store the contents.</p>
    </div>
  );
}
