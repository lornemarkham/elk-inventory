import { useState } from "react";
import type { ImportBatch, ImportDraftItem, ImportDraftStatus } from "../types/import";
import { ZONES } from "../data/zones";
import { CONTAINERS } from "../data/containers";
import { C, CLASS_COLORS, CLASS_LABELS, ZONE_COLORS } from "../styles";
import type { ItemClass, ZoneId, InventoryDomain } from "../types/inventory";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  batch: ImportBatch;
  drafts: ImportDraftItem[];
  onApprove: (draftId: string) => void;
  onReject:  (draftId: string) => void;
  onUpdate:  (draft: ImportDraftItem) => void;
  onBack:    () => void;
  onGoToInventory: () => void;
}

// ── Tab filter ────────────────────────────────────────────────────────────────

type Tab = "all" | ImportDraftStatus;

const TABS: { id: Tab; label: string }[] = [
  { id: "all",          label: "All" },
  { id: "pending",      label: "Pending" },
  { id: "approved",     label: "Approved" },
  { id: "rejected",     label: "Rejected" },
  { id: "needs-review", label: "Needs Review" },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function ImportReviewQueue({
  batch, drafts, onApprove, onReject, onUpdate, onBack, onGoToInventory,
}: Props) {
  const [tab, setTab] = useState<Tab>("pending");
  const [editingId, setEditingId] = useState<string | null>(null);

  const batchDrafts = drafts.filter(d => d.batchId === batch.id);
  const pending  = batchDrafts.filter(d => d.status === "pending").length;
  const approved = batchDrafts.filter(d => d.status === "approved").length;
  const rejected = batchDrafts.filter(d => d.status === "rejected").length;
  const allDone  = pending === 0;

  const visible = tab === "all"
    ? batchDrafts
    : batchDrafts.filter(d => d.status === tab);

  const tabCount = (t: Tab): number => {
    if (t === "all") return batchDrafts.length;
    return batchDrafts.filter(d => d.status === t).length;
  };

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", paddingBottom: "60px" }}>

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "20px" }}>
        <button
          onClick={onBack}
          style={{
            background: "none", border: "none", color: C.textMid,
            fontSize: "13px", cursor: "pointer", padding: "0 0 10px",
          }}
        >
          ← Back
        </button>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: 800, color: C.text }}>
              Import Review Queue
            </h2>
            <div style={{ fontSize: "13px", color: C.textDim }}>
              {new Date(batch.createdAt).toLocaleString()} · {batch.photoCount} photo{batch.photoCount !== 1 ? "s" : ""} · {batch.totalDrafts} draft{batch.totalDrafts !== 1 ? "s" : ""}
            </div>
          </div>

          {allDone && (
            <button
              onClick={onGoToInventory}
              style={{
                background: C.green, border: "none", color: "#111",
                borderRadius: "7px", padding: "9px 16px",
                fontSize: "13px", fontWeight: 700, cursor: "pointer",
              }}
            >
              ✓ View Approved Items →
            </button>
          )}
        </div>
      </div>

      {/* ── Mock notice ─────────────────────────────────────────────────────── */}
      {!batch.isRealAI && (
        <div style={{
          background: "#1c1a10", border: "1px solid #c48c2835",
          borderLeft: `3px solid ${C.amber}`,
          borderRadius: "8px", padding: "10px 14px",
          fontSize: "13px", color: C.amber, marginBottom: "16px",
          display: "flex", gap: "8px",
        }}>
          <span>🤖</span>
          <div>
            <strong>Mock Analysis</strong> — Suggestions are randomly generated from a test
            catalog, not from real photo recognition. Treat all names as placeholders.
            <span style={{ color: C.textDim, display: "block", marginTop: "2px", fontSize: "12px" }}>
              Provider: {batch.analyzerName}
            </span>
          </div>
        </div>
      )}

      {/* ── Summary stats ────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: "16px", flexWrap: "wrap",
        background: C.bgCard, border: `1px solid ${C.border}`,
        borderRadius: "8px", padding: "12px 16px", marginBottom: "16px",
      }}>
        <Stat value={batch.totalDrafts} label="Total" color={C.textMid} />
        <Stat value={pending}  label="Pending"  color={C.amber} />
        <Stat value={approved} label="Approved" color={C.green} />
        <Stat value={rejected} label="Rejected" color={C.textDim} />
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: "3px",
        background: C.bgInset, border: `1px solid ${C.border}`,
        borderRadius: "7px", padding: "4px",
        marginBottom: "16px", flexWrap: "wrap",
      }}>
        {TABS.filter(t => t.id === "all" || tabCount(t.id) > 0).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? C.bgCard : "transparent",
              border: `1px solid ${tab === t.id ? C.border : "transparent"}`,
              color: tab === t.id ? C.text : C.textMid,
              borderRadius: "5px", padding: "6px 12px",
              fontSize: "13px", cursor: "pointer", fontWeight: tab === t.id ? 700 : 400,
              display: "flex", alignItems: "center", gap: "5px",
            }}
          >
            {t.label}
            <span style={{
              fontSize: "11px", color: C.textDim,
              background: C.bgInset, borderRadius: "3px", padding: "1px 5px",
            }}>
              {tabCount(t.id)}
            </span>
          </button>
        ))}
      </div>

      {/* ── Draft cards ─────────────────────────────────────────────────────── */}
      {visible.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textDim }}>
          No {tab === "all" ? "" : tab} items in this batch.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {visible.map(draft => (
            <DraftCard
              key={draft.id}
              draft={draft}
              isEditing={editingId === draft.id}
              onStartEdit={() => setEditingId(draft.id)}
              onCancelEdit={() => setEditingId(null)}
              onSaveEdit={updated => { onUpdate(updated); setEditingId(null); }}
              onApprove={() => onApprove(draft.id)}
              onReject={() => onReject(draft.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stat badge ────────────────────────────────────────────────────────────────

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: "48px" }}>
      <span style={{ fontSize: "20px", fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: "11px", color: C.textDim }}>{label}</span>
    </div>
  );
}

// ── Individual draft card ─────────────────────────────────────────────────────

interface CardProps {
  draft: ImportDraftItem;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (updated: ImportDraftItem) => void;
  onApprove: () => void;
  onReject: () => void;
}

function DraftCard({ draft, isEditing, onStartEdit, onCancelEdit, onSaveEdit, onApprove, onReject }: CardProps) {
  const statusStyle = STATUS_STYLES[draft.status];
  const zone = ZONES.find(z => z.id === draft.zone);
  const zoneColor = ZONE_COLORS[draft.zone] ?? C.textDim;
  const classColor = CLASS_COLORS[draft.itemClass as ItemClass] ?? C.textDim;
  const classLabel = CLASS_LABELS[draft.itemClass as ItemClass] ?? draft.itemClass;
  const isPending = draft.status === "pending" || draft.status === "needs-review";

  const confidencePct = Math.round(draft.confidence * 100);
  const confColor = draft.confidence >= 0.75 ? C.green : draft.confidence >= 0.5 ? C.amber : C.red;

  if (isEditing) {
    return <DraftEditor draft={draft} onSave={onSaveEdit} onCancel={onCancelEdit} />;
  }

  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${
        draft.status === "approved" ? C.green :
        draft.status === "rejected" ? C.textDim :
        classColor
      }`,
      borderRadius: "8px",
      padding: "14px 16px",
      opacity: draft.status === "rejected" ? 0.5 : 1,
      display: "flex", gap: "14px",
    }}>
      {/* Photo thumbnail */}
      <div style={{
        width: "80px", height: "70px", flexShrink: 0,
        borderRadius: "6px", overflow: "hidden",
        background: C.bgInset, border: `1px solid ${C.borderLo}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {draft.sourcePhotoUrl ? (
          <img
            src={draft.sourcePhotoUrl}
            alt={draft.sourcePhotoName}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ fontSize: "22px", opacity: 0.3 }}>📷</span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
          {/* Name + status */}
          <div>
            <span style={{ fontSize: "16px", fontWeight: 700, color: C.text }}>{draft.suggestedName}</span>
            <span style={{
              marginLeft: "8px",
              fontSize: "10px", fontWeight: 700, letterSpacing: "0.05em",
              color: statusStyle.color, background: statusStyle.bg,
              border: `1px solid ${statusStyle.color}40`,
              borderRadius: "4px", padding: "2px 7px",
            }}>
              {draft.status.toUpperCase()}
            </span>
          </div>
          {/* Confidence */}
          <div style={{ fontSize: "11px", color: confColor, fontWeight: 700, whiteSpace: "nowrap" }}>
            {confidencePct}% conf
          </div>
        </div>

        {/* Chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "6px" }}>
          <Chip label={classLabel} color={classColor} />
          {draft.domain && (
            <Chip label={draft.domain} color={C.textDim} />
          )}
          {zone && (
            <Chip label={zone.name} color={zoneColor} />
          )}
          <span style={{ fontSize: "12px", color: C.textDim }}>Qty: {draft.quantity}</span>
        </div>

        {/* Confidence bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "7px" }}>
          <div style={{
            flex: 1, height: "4px", background: C.bgInset,
            borderRadius: "2px", overflow: "hidden",
          }}>
            <div style={{
              width: `${confidencePct}%`, height: "100%",
              background: confColor, borderRadius: "2px",
            }} />
          </div>
          <span style={{ fontSize: "10px", color: C.textDim, whiteSpace: "nowrap" }}>
            {draft.sourcePhotoName}
          </span>
        </div>

        {/* Notes */}
        {draft.notes && (
          <p style={{
            margin: "0 0 8px", fontSize: "12px", color: C.textDim, lineHeight: 1.45,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {draft.notes}
          </p>
        )}

        {/* Actions */}
        {isPending && (
          <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
            <ActionBtn label="✓ Approve" color={C.green}  onClick={onApprove} />
            <ActionBtn label="✎ Edit"    color={C.amber}  onClick={onStartEdit} outline />
            <ActionBtn label="✗ Reject"  color={C.red}    onClick={onReject}  outline dim />
          </div>
        )}

        {draft.status === "approved" && draft.createdItemId && (
          <div style={{ fontSize: "12px", color: C.green, marginTop: "4px" }}>
            ✓ Item created
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline editor ─────────────────────────────────────────────────────────────

function DraftEditor({ draft, onSave, onCancel }: {
  draft: ImportDraftItem;
  onSave: (d: ImportDraftItem) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ ...draft });

  function set(field: keyof ImportDraftItem, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  const ITEM_CLASSES: ItemClass[] = ["tool", "material", "equipment", "project-asset", "installed-asset", "surplus"];
  const DOMAINS: InventoryDomain[] = ["workshop", "electronics", "food-storage", "kitchen-preserving", "garden", "pool", "vehicle", "household", "project"];

  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${C.amber}50`,
      borderLeft: `4px solid ${C.amber}`,
      borderRadius: "8px", padding: "16px",
    }}>
      <div style={{ fontSize: "14px", fontWeight: 700, color: C.amber, marginBottom: "14px" }}>
        ✎ Editing Draft
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
        <Field label="Name">
          <input
            value={form.suggestedName}
            onChange={e => set("suggestedName", e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Quantity">
          <input
            type="number" min={1}
            value={form.quantity}
            onChange={e => set("quantity", parseInt(e.target.value) || 1)}
            style={inputStyle}
          />
        </Field>
        <Field label="Class">
          <select value={form.itemClass} onChange={e => set("itemClass", e.target.value)} style={inputStyle}>
            {ITEM_CLASSES.map(c => <option key={c} value={c}>{CLASS_LABELS[c] ?? c}</option>)}
          </select>
        </Field>
        <Field label="Domain">
          <select value={form.domain ?? ""} onChange={e => set("domain", e.target.value || undefined)} style={inputStyle}>
            <option value="">— None —</option>
            {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Zone">
          <select value={form.zone} onChange={e => set("zone", e.target.value)} style={inputStyle}>
            {ZONES.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </Field>
        <Field label="Container">
          <select value={form.container ?? ""} onChange={e => set("container", e.target.value || null)} style={inputStyle}>
            <option value="">— None —</option>
            {CONTAINERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Notes" style={{ marginBottom: "14px" }}>
        <textarea
          value={form.notes}
          onChange={e => set("notes", e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </Field>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={() => onSave(form)}
          style={{
            background: C.amber, border: "none", color: "#1c1a17",
            borderRadius: "6px", padding: "8px 16px", fontSize: "13px",
            fontWeight: 700, cursor: "pointer",
          }}
        >
          Save
        </button>
        <button
          onClick={onCancel}
          style={{
            background: "transparent", border: `1px solid ${C.border}`, color: C.textMid,
            borderRadius: "6px", padding: "8px 14px", fontSize: "13px", cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: "11px", fontWeight: 600,
      color, background: color + "18", border: `1px solid ${color}30`,
      borderRadius: "4px", padding: "2px 7px",
    }}>
      {label}
    </span>
  );
}

function ActionBtn({
  label, color, onClick, outline = false, dim = false,
}: {
  label: string; color: string; onClick: () => void; outline?: boolean; dim?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: outline ? "transparent" : color,
        border: `1px solid ${color}${outline ? "60" : ""}`,
        color: outline ? (dim ? C.textDim : color) : "#111",
        borderRadius: "5px", padding: "5px 12px",
        fontSize: "12px", fontWeight: 700, cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, children, style = {} }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={{ fontSize: "11px", fontWeight: 700, color: C.textDim, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: C.bgInset, border: `1px solid ${C.border}`,
  borderRadius: "5px", padding: "7px 10px",
  color: C.text, fontSize: "13px",
  outline: "none",
};

const STATUS_STYLES: Record<ImportDraftStatus, { color: string; bg: string }> = {
  pending:       { color: C.amber,   bg: "#c48c2818" },
  approved:      { color: C.green,   bg: "#5a8c4218" },
  rejected:      { color: "#888",    bg: "#88888818" },
  "needs-review":{ color: "#a078d0", bg: "#a078d018" },
};
