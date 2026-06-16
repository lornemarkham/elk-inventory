import { useState, useEffect } from "react";
import type { InventoryItem, Zone } from "../types/inventory";
import { ZONES } from "../data/zones";
import { C, CLASS_COLORS, CLASS_LABELS, STATE_COLORS, ZONE_COLORS, PRIORITY_COLORS, PRIORITY_LABELS } from "../styles";

interface Props {
  items: InventoryItem[];
  onItemClick: (item: InventoryItem) => void;
}

const CLASS_ORDER = ["tool", "material", "equipment", "project-asset", "installed-asset", "surplus"] as const;

export default function ZonePage({ items, onItemClick }: Props) {
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);

  return selectedZone ? (
    <ZoneDetail
      zone={selectedZone}
      items={items}
      onBack={() => setSelectedZone(null)}
      onItemClick={onItemClick}
    />
  ) : (
    <ZoneGrid items={items} onSelectZone={setSelectedZone} />
  );
}

// ── Zone grid ─────────────────────────────────────────────────────────────────

function ZoneGrid({ items, onSelectZone }: { items: InventoryItem[]; onSelectZone: (z: Zone) => void }) {
  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: "22px", fontWeight: 800, color: C.text }}>
          Workshop Zones
        </h2>
        <p style={{ margin: 0, fontSize: "16px", color: C.textMid }}>
          Click a zone to see all items, move recommendations, and zone details.
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: "14px",
      }}>
        {ZONES.map((zone) => {
          const zoneItems = items.filter((i) => i.currentZone === zone.id);
          const accent = ZONE_COLORS[zone.id] ?? C.textDim;
          const priorityColor = PRIORITY_COLORS[zone.priority] ?? C.textDim;

          const counts = {
            tool:             zoneItems.filter((i) => i.itemClass === "tool").length,
            material:         zoneItems.filter((i) => i.itemClass === "material").length,
            equipment:        zoneItems.filter((i) => i.itemClass === "equipment").length,
            "project-asset":  zoneItems.filter((i) => i.itemClass === "project-asset").length,
            "installed-asset":zoneItems.filter((i) => i.itemClass === "installed-asset").length,
            surplus:          zoneItems.filter((i) => i.itemClass === "surplus").length,
          };

          return (
            <div
              key={zone.id}
              onClick={() => onSelectZone(zone)}
              style={{
                background: C.bgCard,
                border: `1px solid ${C.border}`,
                borderTop: `3px solid ${accent}`,
                borderRadius: "8px",
                padding: "20px",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = C.amber;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = C.border;
                (e.currentTarget as HTMLDivElement).style.borderTopColor = accent;
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <div style={{ fontSize: "20px", fontWeight: 800, color: C.text }}>{zone.name}</div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "28px", fontWeight: 800, color: zoneItems.length > 0 ? accent : C.textDim, lineHeight: 1 }}>
                    {zoneItems.length}
                  </div>
                  <div style={{ fontSize: "11px", color: priorityColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {PRIORITY_LABELS[zone.priority]}
                  </div>
                </div>
              </div>

              <p style={{ fontSize: "14px", color: C.textMid, margin: "0 0 14px", lineHeight: 1.5 }}>
                {zone.purpose}
              </p>

              {zoneItems.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {CLASS_ORDER.map((cls) => counts[cls] > 0 && (
                    <span key={cls} style={{
                      fontSize: "12px", fontWeight: 600,
                      background: (CLASS_COLORS[cls] ?? C.textDim) + "20",
                      color: CLASS_COLORS[cls] ?? C.textDim,
                      border: `1px solid ${(CLASS_COLORS[cls] ?? C.textDim)}30`,
                      borderRadius: "4px", padding: "3px 9px",
                    }}>
                      {counts[cls]} {CLASS_LABELS[cls]}
                    </span>
                  ))}
                </div>
              )}

              {zoneItems.length === 0 && (
                <div style={{ fontSize: "14px", color: C.textDim }}>No items assigned.</div>
              )}

              <div style={{ marginTop: "12px", fontSize: "12px", color: C.textDim }}>
                Click to view details →
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Zone detail ───────────────────────────────────────────────────────────────

function ZoneDetail({
  zone, items, onBack, onItemClick,
}: {
  zone: Zone;
  items: InventoryItem[];
  onBack: () => void;
  onItemClick: (item: InventoryItem) => void;
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onBack(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onBack]);

  const accent = ZONE_COLORS[zone.id] ?? C.textDim;
  const priorityColor = PRIORITY_COLORS[zone.priority] ?? C.textDim;

  const currentItems = items.filter((i) => i.currentZone === zone.id);
  const incomingItems = items.filter((i) => i.recommendedZone === zone.id && i.currentZone !== zone.id);
  const movingOutItems = items.filter((i) => i.currentZone === zone.id && i.recommendedZone !== zone.id);

  return (
    <div>
      {/* Back button */}
      <button onClick={onBack} style={{
        background: "transparent",
        border: `1px solid ${C.border}`,
        color: C.textMid,
        borderRadius: "5px",
        padding: "8px 16px",
        fontSize: "14px",
        cursor: "pointer",
        marginBottom: "20px",
      }}>
        ← All Zones
      </button>

      {/* Zone header */}
      <div style={{
        background: C.bgCard,
        border: `1px solid ${C.border}`,
        borderTop: `4px solid ${accent}`,
        borderRadius: "8px",
        padding: "24px",
        marginBottom: "24px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "28px", fontWeight: 800, color: C.text, marginBottom: "6px" }}>
              {zone.name}
            </div>
            <div style={{
              display: "inline-block", fontSize: "12px", fontWeight: 700,
              color: priorityColor, textTransform: "uppercase", letterSpacing: "0.08em",
              background: priorityColor + "18", border: `1px solid ${priorityColor}30`,
              borderRadius: "4px", padding: "3px 10px", marginBottom: "12px",
            }}>
              {PRIORITY_LABELS[zone.priority]}
            </div>
            <p style={{ margin: 0, fontSize: "16px", color: C.textMid, lineHeight: 1.6, maxWidth: "540px" }}>
              {zone.purpose}
            </p>
          </div>
          <div style={{ fontSize: "48px", fontWeight: 800, color: accent, lineHeight: 1 }}>
            {currentItems.length}
          </div>
        </div>

        {zone.notes && (
          <p style={{
            margin: "16px 0 0",
            fontSize: "14px",
            color: C.textMid,
            lineHeight: 1.6,
            borderLeft: `3px solid ${accent}44`,
            paddingLeft: "12px",
          }}>
            {zone.notes}
          </p>
        )}
      </div>

      {/* Items in this zone, grouped by class */}
      {currentItems.length > 0 ? (
        <div style={{ marginBottom: "32px" }}>
          <SectionHeader>Items in {zone.name}</SectionHeader>
          {CLASS_ORDER.map((cls) => {
            const clsItems = currentItems.filter((i) => i.itemClass === cls);
            if (clsItems.length === 0) return null;
            return (
              <ClassGroup
                key={cls}
                cls={cls}
                items={clsItems}
                onItemClick={onItemClick}
              />
            );
          })}
        </div>
      ) : (
        <p style={{ fontSize: "16px", color: C.textDim, marginBottom: "32px" }}>
          No items currently assigned to {zone.name}.
        </p>
      )}

      {/* Should move here */}
      {incomingItems.length > 0 && (
        <div style={{ marginBottom: "32px" }}>
          <SectionHeader color={C.green}>
            Recommended to Move Here ({incomingItems.length})
          </SectionHeader>
          <p style={{ fontSize: "14px", color: C.textMid, margin: "0 0 12px" }}>
            These items are currently elsewhere but recommended for {zone.name}.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {incomingItems.map((item) => <InlineItemRow key={item.id} item={item} onItemClick={onItemClick} fromZone />)}
          </div>
        </div>
      )}

      {/* Should move out */}
      {movingOutItems.length > 0 && (
        <div>
          <SectionHeader color={C.amber}>
            Recommended to Move Out ({movingOutItems.length})
          </SectionHeader>
          <p style={{ fontSize: "14px", color: C.textMid, margin: "0 0 12px" }}>
            These items are here but recommended for a different zone.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {movingOutItems.map((item) => <InlineItemRow key={item.id} item={item} onItemClick={onItemClick} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Class group within zone detail ────────────────────────────────────────────

function ClassGroup({
  cls, items, onItemClick,
}: {
  cls: string;
  items: InventoryItem[];
  onItemClick: (item: InventoryItem) => void;
}) {
  const color = CLASS_COLORS[cls] ?? C.textDim;
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{
        fontSize: "14px", fontWeight: 700,
        color, textTransform: "uppercase", letterSpacing: "0.06em",
        marginBottom: "8px",
        display: "flex", alignItems: "center", gap: "8px",
      }}>
        <span style={{ width: "3px", height: "14px", background: color, display: "inline-block", borderRadius: "2px" }} />
        {CLASS_LABELS[cls]} ({items.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {items.map((item) => <InlineItemRow key={item.id} item={item} onItemClick={onItemClick} />)}
      </div>
    </div>
  );
}

// ── Inline item row ───────────────────────────────────────────────────────────

function InlineItemRow({
  item, onItemClick, fromZone,
}: {
  item: InventoryItem;
  onItemClick: (item: InventoryItem) => void;
  fromZone?: boolean;
}) {
  const stateColor = STATE_COLORS[item.lifecycleState] ?? C.textDim;
  const recZone = ZONES.find((z) => z.id === item.recommendedZone);
  const curZone = ZONES.find((z) => z.id === item.currentZone);

  return (
    <div
      onClick={() => onItemClick(item)}
      style={{
        background: C.bgInset,
        border: `1px solid ${C.borderLo}`,
        borderRadius: "6px",
        padding: "12px 14px",
        cursor: "pointer",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        flexWrap: "wrap",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = C.amber; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = C.borderLo; }}
    >
      <div style={{ flex: 1, minWidth: "140px" }}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: C.text }}>
          {item.name}
          {item.quantity > 1 && <span style={{ marginLeft: "6px", fontSize: "14px", color: C.textMid, fontWeight: 400 }}>×{item.quantity}</span>}
        </div>
        {item.project && (
          <div style={{ fontSize: "13px", color: C.purple, marginTop: "2px" }}>◆ {item.project}</div>
        )}
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <Chip label={item.lifecycleState} color={stateColor} />
        {fromZone && curZone && (
          <span style={{ fontSize: "13px", color: C.textMid }}>from {curZone.name}</span>
        )}
        {!fromZone && item.currentZone !== item.recommendedZone && recZone && (
          <span style={{ fontSize: "13px", color: C.amber }}>→ {recZone.name}</span>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionHeader({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <h3 style={{
      margin: "0 0 12px",
      fontSize: "18px",
      fontWeight: 700,
      color: color ?? C.text,
    }}>
      {children}
    </h3>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: "13px", fontWeight: 600,
      background: color + "18", color,
      border: `1px solid ${color}30`,
      borderRadius: "4px", padding: "3px 9px",
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}
