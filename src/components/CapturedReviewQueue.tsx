import { useMemo, useState } from "react";
import type { InventoryItem, ItemClass, InventoryDomain, ZoneId } from "../types/inventory";
import type { PurchaseDraft } from "../types/purchase";
import type { ApproveAction, ApprovedFields } from "../lib/purchaseDrafts";
import { findPossibleDuplicates } from "../lib/duplicateDetector";
import { ZONES } from "../data/zones";
import { COLLECTIONS } from "../data/collections";
import { C, ZONE_COLORS } from "../styles";

interface Props {
  drafts: PurchaseDraft[];
  items: InventoryItem[];
  onApprove: (draft: PurchaseDraft, action: ApproveAction) => void;
  onReject: (draftId: string) => void;
  onSaveForLater: (draftId: string) => void;
  onUpdateDraft: (draftId: string, patch: Partial<PurchaseDraft>) => void;
  onBack: () => void;
  onGoToCapture: () => void;
}

const ITEM_CLASSES: { value: ItemClass; label: string }[] = [
  { value: "tool", label: "Tool" },
  { value: "material", label: "Material" },
  { value: "equipment", label: "Equipment" },
  { value: "project-asset", label: "Project Asset" },
  { value: "installed-asset", label: "Installed Asset" },
  { value: "surplus", label: "Surplus" },
];

const DOMAINS: { value: InventoryDomain; label: string }[] = [
  { value: "workshop", label: "Workshop" },
  { value: "electronics", label: "Electronics" },
  { value: "food-storage", label: "Food Storage" },
  { value: "kitchen-preserving", label: "Kitchen / Preserving" },
  { value: "garden", label: "Garden" },
  { value: "pool", label: "Pool" },
  { value: "vehicle", label: "Vehicle" },
  { value: "household", label: "Household" },
  { value: "project", label: "Project" },
  { value: "unknown", label: "Other / Unknown" },
];

export default function CapturedReviewQueue({
  drafts, items, onApprove, onReject, onSaveForLater, onUpdateDraft, onBack, onGoToCapture,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const pending = drafts.filter((d) => d.status === "pending" || d.status === "saved-for-later");

  return (
    <div style={{ maxWidth: "760px", margin: "0 auto", paddingBottom: "60px" }}>
      <div style={{ marginBottom: "20px" }}>
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", color: C.textMid, fontSize: "13px", cursor: "pointer", padding: "0 0 10px" }}
        >
          ← Back
        </button>
        <h2 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: 800, color: C.text }}>
          Saved for later
        </h2>
        <div style={{ fontSize: "13px", color: C.textDim }}>
          {pending.length === 0
            ? "Nothing sitting here."
            : `${pending.length} you weren't ready to decide on yet`}
        </div>
      </div>

      {pending.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <div style={{ fontSize: "32px", marginBottom: "10px", opacity: 0.3 }}>✓</div>
          <p style={{ color: C.textMid, fontSize: "15px", margin: "0 0 16px" }}>
            Nothing waiting. Anything you capture and set aside for later shows up here.
          </p>
          <button
            onClick={onGoToCapture}
            style={{
              background: C.amber, border: "none", color: "#1c1a17",
              borderRadius: "8px", padding: "10px 20px", fontSize: "14px", fontWeight: 700, cursor: "pointer",
            }}
          >
            ⚡ Capture something →
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {pending.map((draft) =>
            editingId === draft.id ? (
              <PurchaseDraftEditor
                key={draft.id}
                draft={draft}
                onCancel={() => setEditingId(null)}
                onSave={(patch) => { onUpdateDraft(draft.id, patch); setEditingId(null); }}
                onSaveAndApprove={(fields) => { onApprove(draft, { kind: "new", fields }); setEditingId(null); }}
              />
            ) : (
              <PurchaseDraftCard
                key={draft.id}
                draft={draft}
                items={items}
                onEdit={() => setEditingId(draft.id)}
                onReject={() => onReject(draft.id)}
                onSaveForLater={() => onSaveForLater(draft.id)}
                onApproveNew={(fields) => onApprove(draft, { kind: "new", fields })}
                onApproveMerge={(existingItem, addQuantity) =>
                  onApprove(draft, { kind: "merge", existingItem, addQuantity })
                }
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ── Compact card — evidence first, guesses second ─────────────────────────────

function draftDefaultFields(draft: PurchaseDraft): ApprovedFields {
  return {
    name: draft.suggestedName?.trim() || "Untitled purchase",
    itemClass: "material",
    domain: undefined,
    quantity: draft.suggestedQuantity ?? 1,
    currentZone: "unknown",
    collectionId: draft.suggestedCollectionId,
    project: draft.suggestedProject,
    notes: draft.suggestedVendor ? `Purchased from ${draft.suggestedVendor}.` : "",
  };
}

function PurchaseDraftCard({
  draft, items, onEdit, onReject, onSaveForLater, onApproveNew, onApproveMerge,
}: {
  draft: PurchaseDraft;
  items: InventoryItem[];
  onEdit: () => void;
  onReject: () => void;
  onSaveForLater: () => void;
  onApproveNew: (fields: ApprovedFields) => void;
  onApproveMerge: (existingItem: InventoryItem, addQuantity: number) => void;
}) {
  const duplicates = useMemo(
    () => findPossibleDuplicates({ name: draft.suggestedName ?? "", brand: draft.suggestedBrand }, items),
    [draft.suggestedName, draft.suggestedBrand, items],
  );

  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${draft.status === "saved-for-later" ? C.purple : C.amber}`,
      borderRadius: "8px",
      padding: "14px 16px",
    }}>
      {/* The evidence — what you actually pasted, front and center */}
      <div style={{
        display: "flex", gap: "8px", alignItems: "flex-start",
        marginBottom: "10px", paddingBottom: "10px", borderBottom: `1px solid ${C.borderLo}`,
      }}>
        <span style={{ fontSize: "16px", color: C.textDim, lineHeight: 1, flexShrink: 0 }}>"</span>
        <p style={{
          margin: 0, fontSize: "14px", color: C.textMid, lineHeight: 1.5, fontStyle: "italic",
          whiteSpace: "pre-wrap",
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {draft.rawText}
        </p>
      </div>

      {/* Our best guess, clearly labeled as a guess */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
        <div>
          <div style={{ fontSize: "10px", fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "3px" }}>
            We think this is
          </div>
          <span style={{ fontSize: "16px", fontWeight: 700, color: C.text }}>
            {draft.suggestedName || "Something — you tell us"}
          </span>
          {draft.status === "saved-for-later" && (
            <span style={{
              marginLeft: "8px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.05em",
              color: C.purple, background: C.purple + "18", border: `1px solid ${C.purple}40`,
              borderRadius: "4px", padding: "2px 7px",
            }}>
              NOT YET
            </span>
          )}
        </div>
        <span style={{ fontSize: "11px", color: C.textDim, whiteSpace: "nowrap" }}>
          {new Date(draft.createdAt).toLocaleDateString()}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "10px" }}>
        <Chip label={`Qty: ${draft.suggestedQuantity ?? 1}`} />
        {draft.suggestedBrand && <Chip label={draft.suggestedBrand} />}
        {draft.suggestedVendor && <Chip label={draft.suggestedVendor} />}
        {draft.suggestedPrice != null && (
          <Chip label={`${draft.suggestedCurrency ?? "USD"} ${draft.suggestedPrice.toFixed(2)}`} color={C.green} />
        )}
        {draft.suggestedPurchaseDate && <Chip label={draft.suggestedPurchaseDate} />}
        {draft.suggestedProject && <Chip label={draft.suggestedProject} color={C.purple} />}
        {draft.productUrl && (
          <a href={draft.productUrl} target="_blank" rel="noreferrer" style={{ fontSize: "11px", color: C.blue }}>
            🔗 link
          </a>
        )}
      </div>

      {/* Duplicate banner */}
      {duplicates.length > 0 && (
        <div style={{
          background: C.amber + "10", border: `1px solid ${C.amber}30`,
          borderRadius: "6px", padding: "10px 12px", marginBottom: "10px",
        }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: C.amber, marginBottom: "6px" }}>
            Might already have this →
          </div>
          {duplicates.map((match) => (
            <div key={match.itemId} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: "8px", padding: "4px 0", flexWrap: "wrap",
            }}>
              <span style={{ fontSize: "13px", color: C.text }}>
                {match.itemName}
                <span style={{ color: ZONE_COLORS[match.zone] ?? C.textDim, marginLeft: "6px", fontSize: "12px" }}>
                  · {match.zone.replace(/-/g, " ")} · {match.lifecycleState}
                </span>
              </span>
              <button
                onClick={() => {
                  const existing = items.find((i) => i.id === match.itemId);
                  if (existing) onApproveMerge(existing, draft.suggestedQuantity ?? 1);
                }}
                style={smallBtnStyle(C.green)}
              >
                Same thing — update count
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
        {duplicates.length > 0 ? (
          <ActionBtn label="＋ It's different — add anyway" color={C.green} onClick={() => onApproveNew(draftDefaultFields(draft))} />
        ) : (
          <ActionBtn label="✓ Add to Inventory" color={C.green} onClick={() => onApproveNew(draftDefaultFields(draft))} />
        )}
        <ActionBtn label="✎ Edit details" color={C.amber} onClick={onEdit} outline />
        <ActionBtn label="⏳ Not yet" color={C.purple} onClick={onSaveForLater} outline />
        <ActionBtn label="✗ Discard" color={C.red} onClick={onReject} outline dim />
      </div>
    </div>
  );
}

// ── Full editor ────────────────────────────────────────────────────────────────

function PurchaseDraftEditor({
  draft, onCancel, onSave, onSaveAndApprove,
}: {
  draft: PurchaseDraft;
  onCancel: () => void;
  onSave: (patch: Partial<PurchaseDraft>) => void;
  onSaveAndApprove: (fields: ApprovedFields) => void;
}) {
  const [name, setName] = useState(draft.suggestedName ?? "");
  const [quantity, setQuantity] = useState(draft.suggestedQuantity ?? 1);
  const [brand, setBrand] = useState(draft.suggestedBrand ?? "");
  const [vendor, setVendor] = useState(draft.suggestedVendor ?? "");
  const [price, setPrice] = useState(draft.suggestedPrice != null ? String(draft.suggestedPrice) : "");
  const [purchaseDate, setPurchaseDate] = useState(draft.suggestedPurchaseDate ?? "");
  const [productUrl, setProductUrl] = useState(draft.productUrl ?? "");
  const [itemClass, setItemClass] = useState<ItemClass>("material");
  const [domain, setDomain] = useState<InventoryDomain>("unknown");
  const [zone, setZone] = useState<ZoneId>("unknown");
  const [collectionId, setCollectionId] = useState(draft.suggestedCollectionId ?? "");
  const [project, setProject] = useState(draft.suggestedProject ?? "");

  function toPatch(): Partial<PurchaseDraft> {
    return {
      suggestedName: name.trim() || null,
      suggestedQuantity: Math.max(1, quantity),
      suggestedBrand: brand.trim() || null,
      suggestedVendor: vendor.trim() || null,
      suggestedPrice: price.trim() ? parseFloat(price) : null,
      suggestedPurchaseDate: purchaseDate || null,
      productUrl: productUrl.trim() || null,
      suggestedCollectionId: collectionId || null,
      suggestedProject: project.trim() || null,
    };
  }

  function toApprovedFields(): ApprovedFields {
    return {
      name: name.trim() || "Untitled purchase",
      itemClass,
      domain: domain !== "unknown" ? domain : undefined,
      quantity: Math.max(1, quantity),
      currentZone: zone,
      collectionId: collectionId || null,
      project: project.trim() || null,
      notes: vendor.trim() ? `Purchased from ${vendor.trim()}.` : "",
    };
  }

  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.amber}50`,
      borderLeft: `4px solid ${C.amber}`, borderRadius: "8px", padding: "16px",
    }}>
      <div style={{ fontSize: "14px", fontWeight: 700, color: C.amber, marginBottom: "6px" }}>
        ✎ Filling in the details
      </div>
      <p style={{
        margin: "0 0 14px", fontSize: "12px", color: C.textDim, lineHeight: 1.5,
        borderLeft: `2px solid ${C.borderLo}`, paddingLeft: "8px", fontStyle: "italic",
      }}>
        {draft.rawText.length > 160 ? `${draft.rawText.slice(0, 160)}…` : draft.rawText}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
        <Field label="Name" full><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Quantity"><input style={inputStyle} type="number" min={1} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} /></Field>
        <Field label="Brand"><input style={inputStyle} value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
        <Field label="Vendor"><input style={inputStyle} value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
        <Field label="Price"><input style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Purchase Date"><input style={inputStyle} type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
        <Field label="Product URL" full><input style={inputStyle} value={productUrl} onChange={(e) => setProductUrl(e.target.value)} /></Field>
        <Field label="Class">
          <select style={inputStyle} value={itemClass} onChange={(e) => setItemClass(e.target.value as ItemClass)}>
            {ITEM_CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Domain">
          <select style={inputStyle} value={domain} onChange={(e) => setDomain(e.target.value as InventoryDomain)}>
            {DOMAINS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </Field>
        <Field label="Zone">
          <select style={inputStyle} value={zone} onChange={(e) => setZone(e.target.value as ZoneId)}>
            {ZONES.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </Field>
        <Field label="Collection">
          <select style={inputStyle} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            <option value="">— none —</option>
            {COLLECTIONS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Project" full><input style={inputStyle} value={project} onChange={(e) => setProject(e.target.value)} /></Field>
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button onClick={() => onSaveAndApprove(toApprovedFields())} style={{ ...smallBtnStyle(C.green, true), padding: "8px 16px", fontSize: "13px" }}>
          ✓ Save &amp; add
        </button>
        <button onClick={() => onSave(toPatch())} style={{ ...smallBtnStyle(C.amber, true), padding: "8px 16px", fontSize: "13px" }}>
          Save for now
        </button>
        <button onClick={onCancel} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMid, borderRadius: "6px", padding: "8px 14px", fontSize: "13px", cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Chip({ label, color = C.textMid }: { label: string; color?: string }) {
  return (
    <span style={{
      fontSize: "11px", fontWeight: 600, color, background: color + "18",
      border: `1px solid ${color}30`, borderRadius: "4px", padding: "2px 7px",
    }}>
      {label}
    </span>
  );
}

function ActionBtn({ label, color, onClick, outline = false, dim = false }: {
  label: string; color: string; onClick: () => void; outline?: boolean; dim?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      background: outline ? "transparent" : color,
      border: `1px solid ${color}${outline ? "60" : ""}`,
      color: outline ? (dim ? C.textDim : color) : "#111",
      borderRadius: "5px", padding: "6px 13px", fontSize: "12px", fontWeight: 700, cursor: "pointer",
    }}>
      {label}
    </button>
  );
}

function smallBtnStyle(color: string, solid = false): React.CSSProperties {
  return {
    background: solid ? color : "transparent",
    border: `1px solid ${color}`,
    color: solid ? "#111" : color,
    borderRadius: "5px", padding: "4px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer",
  };
}

function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={full ? { gridColumn: "1 / -1" } : undefined}>
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
  color: C.text, fontSize: "13px", outline: "none",
};
