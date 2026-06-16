import { useEffect, useState } from "react";
import type { InventoryItem, InventoryDomain } from "../types/inventory";
import { ZONES } from "../data/zones";
import { COLLECTIONS } from "../data/collections";
import { CONTAINERS } from "../data/containers";
import { C, CLASS_COLORS, CLASS_LABELS, STATE_COLORS, ZONE_COLORS } from "../styles";

interface Props {
  item: InventoryItem;
  onClose: () => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
}

export default function ItemDetailPanel({ item, onClose, onEdit, onDelete }: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Reset confirmation state when the item changes
  useEffect(() => { setConfirmingDelete(false); }, [item.id]);

  const classColor = CLASS_COLORS[item.itemClass] ?? C.textDim;
  const stateColor = STATE_COLORS[item.lifecycleState] ?? C.textDim;
  const currentZone = ZONES.find((z) => z.id === item.currentZone);
  const recZone = ZONES.find((z) => z.id === item.recommendedZone);
  const collection = item.collectionId ? COLLECTIONS.find((c) => c.id === item.collectionId) : null;
  const container = item.containerId ? CONTAINERS.find((c) => c.id === item.containerId) : null;
  const zoneMismatch = item.currentZone !== item.recommendedZone;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.72)",
        zIndex: 100,
      }} />

      {/* Panel */}
      <div style={{
        position: "fixed",
        top: "4vh",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(640px, 95vw)",
        maxHeight: "92vh",
        overflowY: "auto",
        background: C.bgCard,
        border: `1px solid ${C.border}`,
        borderTop: `4px solid ${classColor}`,
        borderRadius: "10px",
        zIndex: 101,
        padding: "24px 26px 32px",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
      }}>
        {/* Header row: name + action buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "24px", fontWeight: 800, color: C.text, lineHeight: 1.2 }}>
              {item.name}
              {item.quantity > 1 && (
                <span style={{ marginLeft: "10px", fontSize: "18px", color: C.textMid, fontWeight: 400 }}>
                  ×{item.quantity}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap", alignItems: "center" }}>
              <Chip label={CLASS_LABELS[item.itemClass]} color={classColor} big />
              <Chip label={item.lifecycleState} color={stateColor} big />
              {item.domain && item.domain !== "unknown" && (
                <span style={{ fontSize: "12px", color: C.textDim, background: C.bgInset, border: `1px solid ${C.borderLo}`, borderRadius: "4px", padding: "3px 9px" }}>
                  {DOMAIN_LABELS[item.domain] ?? item.domain}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "6px", flexShrink: 0, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {!confirmingDelete ? (
              <>
                <button onClick={() => onEdit(item)} style={{
                  background: C.amber + "18",
                  border: `1px solid ${C.amber}44`,
                  color: C.amber,
                  borderRadius: "5px",
                  padding: "6px 14px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}>
                  Edit
                </button>
                <button onClick={() => setConfirmingDelete(true)} style={{
                  background: "transparent",
                  border: `1px solid ${C.red}44`,
                  color: C.textDim,
                  borderRadius: "5px",
                  padding: "6px 12px",
                  fontSize: "13px",
                  cursor: "pointer",
                }}>
                  Delete
                </button>
              </>
            ) : (
              <div style={{
                display: "flex", gap: "6px", alignItems: "center",
                background: C.bgInset,
                border: `1px solid ${C.red}44`,
                borderRadius: "6px",
                padding: "6px 10px",
              }}>
                <span style={{ fontSize: "12px", color: C.red, fontWeight: 600, whiteSpace: "nowrap" }}>
                  Delete "{item.name}"?
                </span>
                <button onClick={() => { onDelete(item.id); onClose(); }} style={{
                  background: C.red,
                  border: "none",
                  color: "#fff",
                  borderRadius: "4px",
                  padding: "4px 10px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}>
                  Yes, delete
                </button>
                <button onClick={() => setConfirmingDelete(false)} style={{
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  color: C.textDim,
                  borderRadius: "4px",
                  padding: "4px 8px",
                  fontSize: "12px",
                  cursor: "pointer",
                }}>
                  Cancel
                </button>
              </div>
            )}
            <button onClick={onClose} style={{
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.textMid,
              borderRadius: "5px",
              padding: "6px 12px",
              fontSize: "16px",
              cursor: "pointer",
            }}>
              ✕
            </button>
          </div>
        </div>

        {/* Photo */}
        <LargePhoto photoPath={item.photoPath} name={item.name} />

        {/* Location */}
        <section>
          <Label>Location</Label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "8px" }}>
            <InfoBox label="Current Zone" accent={ZONE_COLORS[item.currentZone] ?? C.textMid}>
              {currentZone?.name ?? item.currentZone}
            </InfoBox>
            <InfoBox
              label="Recommended Zone"
              accent={zoneMismatch ? C.amber : (ZONE_COLORS[item.recommendedZone] ?? C.textMid)}
            >
              {recZone?.name ?? item.recommendedZone}
              {zoneMismatch && <span style={{ color: C.amber, marginLeft: "6px", fontSize: "13px" }}>← move</span>}
            </InfoBox>
          </div>
          {item.locationDetail && (
            <div style={{ marginTop: "8px", fontSize: "15px", color: C.textMid }}>
              Spot: <strong style={{ color: C.text }}>{item.locationDetail}</strong>
            </div>
          )}
        </section>

        {/* Project / Collection / Container */}
        {(item.project || collection || container) && (
          <section>
            <Label>Associations</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
              {item.project && (
                <div style={{ fontSize: "16px", color: C.purple, fontWeight: 600 }}>◆ {item.project}</div>
              )}
              {collection && (
                <div style={{ fontSize: "15px", color: C.textMid }}>◈ {collection.name}</div>
              )}
              {container && (
                <div style={{ fontSize: "15px", color: C.textMid }}>
                  ▣ {container.name}
                  <span style={{ marginLeft: "6px", fontSize: "12px", color: C.textDim }}>({container.description})</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Tags */}
        {item.tags.length > 0 && (
          <section>
            <Label>Tags</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
              {item.tags.map((t) => (
                <span key={t} style={{
                  background: C.bgInset,
                  border: `1px solid ${C.border}`,
                  borderRadius: "4px",
                  padding: "4px 10px",
                  fontSize: "14px",
                  color: C.textMid,
                }}>
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Notes */}
        {item.notes && (
          <section>
            <Label>Notes</Label>
            <p style={{
              margin: "8px 0 0",
              fontSize: "16px",
              color: C.textMid,
              lineHeight: 1.7,
              borderLeft: `3px solid ${C.borderLo}`,
              paddingLeft: "12px",
            }}>
              {item.notes}
            </p>
          </section>
        )}

        {/* Extended metadata */}
        {(item.brand || item.powerType || item.batteryPlatform) && (
          <section>
            <Label>Specs</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
              {item.brand && <MetaChip label="Brand" value={item.brand} />}
              {item.powerType && <MetaChip label="Power" value={item.powerType} />}
              {item.batteryPlatform && <MetaChip label="Platform" value={item.batteryPlatform} />}
            </div>
          </section>
        )}

        {/* Custom attributes */}
        {item.attributes && Object.keys(item.attributes).length > 0 && (
          <section>
            <Label>Attributes</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
              {Object.entries(item.attributes).map(([k, v]) => (
                <MetaChip key={k} label={k} value={String(v)} />
              ))}
            </div>
          </section>
        )}

        {/* Timestamps footer */}
        {(item.createdAt || item.updatedAt) && (
          <div style={{
            marginTop: "8px", paddingTop: "12px",
            borderTop: `1px solid ${C.borderLo}`,
            display: "flex", gap: "16px", flexWrap: "wrap",
          }}>
            {item.createdAt && (
              <span style={{ fontSize: "11px", color: C.textDim }}>
                Added {formatDate(item.createdAt)}
              </span>
            )}
            {item.updatedAt && item.updatedAt !== item.createdAt && (
              <span style={{ fontSize: "11px", color: C.textDim }}>
                Updated {formatDate(item.updatedAt)}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOMAIN_LABELS: Partial<Record<InventoryDomain, string>> = {
  workshop: "Workshop",
  electronics: "Electronics",
  "food-storage": "Food Storage",
  "kitchen-preserving": "Kitchen / Preserving",
  garden: "Garden",
  pool: "Pool",
  vehicle: "Vehicle",
  household: "Household",
  project: "Project",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function LargePhoto({ photoPath, name }: { photoPath: string; name: string }) {
  const baseStyle: React.CSSProperties = {
    width: "100%", height: "260px",
    background: C.bgInset,
    border: `1px solid ${C.borderLo}`,
    borderRadius: "6px",
    display: "flex", alignItems: "center", justifyContent: "center",
  };

  if (!photoPath) {
    return (
      <div style={baseStyle}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "36px", opacity: 0.2 }}>📷</div>
          <div style={{ fontSize: "14px", color: C.textDim, marginTop: "8px" }}>No photo path set</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...baseStyle, overflow: "hidden" }}>
      <img
        src={photoPath}
        alt={name}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
        onError={(e) => {
          const target = e.currentTarget;
          const parent = target.parentElement;
          if (!parent || parent.dataset.fallbackShown) return;
          parent.dataset.fallbackShown = "true";
          target.style.display = "none";
          const d = document.createElement("div");
          d.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:20px;text-align:center;width:100%;height:100%;";
          d.innerHTML = `<div style="font-size:40px;opacity:0.2">📷</div><div style="font-size:14px;color:#8a7a68;font-weight:600;">Photo missing</div><div style="font-size:12px;color:#6a5a48;font-family:monospace;word-break:break-all;max-width:380px;line-height:1.5;">${photoPath}</div>`;
          parent.appendChild(d);
        }}
      />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: "12px", color: C.textDim,
      textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700,
    }}>
      {children}
    </div>
  );
}

function InfoBox({ label, children, accent }: { label: string; children: React.ReactNode; accent: string }) {
  return (
    <div style={{
      background: C.bgInset,
      border: `1px solid ${C.borderLo}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: "5px",
      padding: "10px 12px",
    }}>
      <div style={{ fontSize: "11px", color: C.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
        {label}
      </div>
      <div style={{ fontSize: "16px", fontWeight: 700, color: accent }}>{children}</div>
    </div>
  );
}

function Chip({ label, color, big }: { label: string; color: string; big?: boolean }) {
  return (
    <span style={{
      fontSize: big ? "14px" : "12px",
      fontWeight: 600,
      background: color + "18", color,
      border: `1px solid ${color}30`,
      borderRadius: "4px",
      padding: big ? "5px 12px" : "3px 8px",
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: C.bgInset,
      border: `1px solid ${C.borderLo}`,
      borderRadius: "4px",
      padding: "4px 10px",
      fontSize: "13px",
    }}>
      <span style={{ color: C.textDim }}>{label}: </span>
      <span style={{ color: C.textMid, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
