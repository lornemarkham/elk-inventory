import type { InventoryItem, InventoryDomain, Container } from "../types/inventory";
import { ZONES } from "../data/zones";
import { COLLECTIONS } from "../data/collections";
import { CONTAINERS } from "../data/containers";
import { C, CLASS_COLORS, CLASS_LABELS, STATE_COLORS, ZONE_COLORS } from "../styles";

const DOMAIN_COLORS: Partial<Record<InventoryDomain, string>> = {
  workshop:           "#c04020",
  electronics:        "#4278a0",
  "food-storage":     "#7a8c42",
  "kitchen-preserving":"#8c6a32",
  garden:             "#5a8c42",
  pool:               "#3a8aa0",
  vehicle:            "#c48c28",
  household:          "#7a6858",
  project:            "#7a52a0",
};

const DOMAIN_LABELS: Partial<Record<InventoryDomain, string>> = {
  workshop:           "Workshop",
  electronics:        "Electronics",
  "food-storage":     "Food Storage",
  "kitchen-preserving":"Kitchen / Preserving",
  garden:             "Garden",
  pool:               "Pool",
  vehicle:            "Vehicle",
  household:          "Household",
  project:            "Project",
};

interface Props {
  item: InventoryItem;
  onClick: (item: InventoryItem) => void;
}

export default function InventoryCard({ item, onClick }: Props) {
  const classColor = CLASS_COLORS[item.itemClass] ?? C.textDim;
  const stateColor = STATE_COLORS[item.lifecycleState] ?? C.textDim;
  const currentZone = ZONES.find((z) => z.id === item.currentZone);
  const recZone = ZONES.find((z) => z.id === item.recommendedZone);
  const zoneMismatch = item.currentZone !== item.recommendedZone;
  const collection = item.collectionId ? COLLECTIONS.find((c) => c.id === item.collectionId) : null;
  const container = item.containerId ? CONTAINERS.find((c) => c.id === item.containerId) : null;
  const isFood = item.domain === "food-storage";
  const isPreserving = item.domain === "kitchen-preserving";
  const domainColor = item.domain ? (DOMAIN_COLORS[item.domain] ?? C.textDim) : classColor;
  const cardAccentColor = (isFood || isPreserving) ? domainColor : classColor;

  return (
    <div
      onClick={() => onClick(item)}
      style={{
        background: C.bgCard,
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${cardAccentColor}`,
        borderRadius: "8px",
        padding: "16px 16px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "9px",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = C.amber;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = C.border;
        (e.currentTarget as HTMLDivElement).style.borderLeftColor = cardAccentColor;
      }}
    >
      {/* Photo — only for non-food items */}
      {!isFood && !isPreserving && <PhotoSlot photoPath={item.photoPath} name={item.name} />}

      {/* Domain badge row (food/preserving) — includes rotation priority or resilience badge */}
      {(isFood || isPreserving) && (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "5px",
            fontSize: "11px", fontWeight: 700,
            color: domainColor,
            background: domainColor + "18",
            border: `1px solid ${domainColor}30`,
            borderRadius: "4px", padding: "2px 8px",
          }}>
            {isFood ? "🥫" : "🫙"} {DOMAIN_LABELS[item.domain!]}
          </div>
          {isFood && item.attributes?.rotationPriority === "high" && (
            <span style={{
              fontSize: "10px", fontWeight: 700, color: C.amber,
              background: C.amber + "18", border: `1px solid ${C.amber}40`,
              borderRadius: "4px", padding: "2px 7px", letterSpacing: "0.04em",
            }}>
              ↑ USE FIRST
            </span>
          )}
          {isPreserving && item.attributes?.resilienceAsset && (
            <span style={{
              fontSize: "10px", fontWeight: 700, color: "#e0a832",
              background: "#e0a83218", border: "1px solid #e0a83240",
              borderRadius: "4px", padding: "2px 7px",
            }}>
              ⭐ Resilience Asset
            </span>
          )}
        </div>
      )}

      {/* Name */}
      <div style={{ fontSize: "17px", fontWeight: 700, color: C.text, lineHeight: 1.2 }}>
        {item.name}
      </div>

      {/* Food/Preserving metadata block — replaces class/state/zone for these domains */}
      {(isFood || isPreserving) && (
        <FoodMetaBadge item={item} domainColor={domainColor} container={container} />
      )}

      {/* Class + State — workshop/tool items */}
      {!isFood && !isPreserving && (
        <>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {item.domain && item.domain !== "unknown" && (
              <span style={{
                fontSize: "11px", fontWeight: 600,
                color: domainColor, background: domainColor + "18",
                border: `1px solid ${domainColor}30`, borderRadius: "4px", padding: "2px 7px",
              }}>
                {DOMAIN_LABELS[item.domain]}
              </span>
            )}
            <Chip label={CLASS_LABELS[item.itemClass]} color={classColor} />
            <Chip label={item.lifecycleState} color={stateColor} />
          </div>

          {/* Zone */}
          <div style={{ fontSize: "14px", display: "flex", flexDirection: "column", gap: "3px" }}>
            {currentZone && (
              <span style={{ color: ZONE_COLORS[item.currentZone] ?? C.textMid, fontWeight: 600 }}>
                ▸ {currentZone.name}
                {item.locationDetail && (
                  <span style={{ color: C.textMid, fontWeight: 400 }}> · {item.locationDetail}</span>
                )}
              </span>
            )}
            {zoneMismatch && recZone && (
              <span style={{ color: C.amber, fontSize: "13px" }}>→ move to {recZone.name}</span>
            )}
          </div>
        </>
      )}

      {/* Food: container / location row */}
      {(isFood || isPreserving) && container && (
        <div style={{ fontSize: "13px", color: C.textMid, display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{
            display: "inline-block", width: "8px", height: "8px",
            borderRadius: "2px", background: container.color, flexShrink: 0,
          }} />
          {container.name}
        </div>
      )}

      {/* Project */}
      {item.project && (
        <span style={{ fontSize: "13px", color: C.purple, fontWeight: 600 }}>◆ {item.project}</span>
      )}

      {/* Tags (compact for food items) */}
      {item.tags.length > 0 && !isFood && !isPreserving && (
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {item.tags.map((t) => (
            <span key={t} style={{
              background: C.bgInset, border: `1px solid ${C.borderLo}`,
              borderRadius: "3px", padding: "2px 6px", fontSize: "12px", color: C.textMid,
            }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Collection / Container — tool items only (food items show container inline above) */}
      {!isFood && !isPreserving && (collection || container) && (
        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
          {collection && (
            <span style={{ fontSize: "12px", color: C.textMid, background: C.bgInset, border: `1px solid ${C.borderLo}`, borderRadius: "3px", padding: "2px 7px" }}>
              ◈ {collection.name}
            </span>
          )}
          {container && (
            <span style={{ fontSize: "12px", color: C.textMid, background: C.bgInset, border: `1px solid ${container.color}44`, borderRadius: "3px", padding: "2px 7px" }}>
              ▣ {container.name}
            </span>
          )}
        </div>
      )}

      {/* Notes (truncated) */}
      {item.notes && (
        <p style={{ fontSize: "13px", color: C.textMid, margin: 0, lineHeight: 1.5,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {item.notes}
        </p>
      )}
    </div>
  );
}

// ── Photo slot ────────────────────────────────────────────────────────────────

function PhotoSlot({ photoPath, name }: { photoPath: string; name: string }) {
  if (!photoPath) return null;
  return (
    <div>
      <div style={{
        width: "100%", height: "200px",
        background: C.bgInset,
        borderRadius: "6px",
        overflow: "hidden",
        border: `1px solid ${C.borderLo}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <img
          src={photoPath}
          alt={name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={(e) => {
            const target = e.currentTarget;
            const parent = target.parentElement;
            if (!parent || parent.dataset.fallbackShown) return;
            parent.dataset.fallbackShown = "true";
            target.style.display = "none";
            const d = document.createElement("div");
            d.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px;text-align:center;width:100%;height:100%;box-sizing:border-box;";
            d.innerHTML = `<div style="font-size:28px;opacity:0.2">📷</div><div style="font-size:12px;color:#7a7068;font-family:monospace;word-break:break-all;line-height:1.4;">${photoPath.split("/").pop()}</div>`;
            parent.appendChild(d);
          }}
        />
      </div>
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: "12px", fontWeight: 600,
      background: color + "18", color,
      border: `1px solid ${color}30`,
      borderRadius: "4px", padding: "3px 8px",
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

const FOOD_CATEGORY_CHIP_ICONS: Record<string, string> = {
  protein:    "🫘",
  fruit:      "🍑",
  vegetables: "🍅",
  soup:       "🍲",
  "dry-goods":"🌾",
  baking:     "🥣",
};

const FOOD_CATEGORY_CHIP_COLORS: Record<string, string> = {
  protein:    "#c08030",
  fruit:      "#c06090",
  vegetables: "#7a8c42",
  soup:       "#4278a0",
  "dry-goods":"#8c8042",
  baking:     "#7a6858",
};

function FoodMetaBadge({ item, domainColor, container }: {
  item: InventoryItem;
  domainColor: string;
  container: Container | null;
}) {
  const attrs = item.attributes ?? {};
  const isPreserving = item.domain === "kitchen-preserving";

  // ── Preserving equipment card ──────────────────────────────────────────────
  if (isPreserving) {
    const equipmentType = attrs.equipmentType as string | undefined;
    const purpose = attrs.purpose as string | undefined;
    const unit = attrs.unit as string | undefined;
    return (
      <div style={{
        background: domainColor + "10",
        border: `1px solid ${domainColor}22`,
        borderRadius: "6px",
        padding: "10px 12px",
        display: "flex", flexDirection: "column", gap: "6px",
      }}>
        {equipmentType && (
          <div style={{ fontSize: "13px", fontWeight: 700, color: C.textMid }}>{equipmentType}</div>
        )}
        {purpose && (
          <div style={{
            fontSize: "12px", color: C.textDim, lineHeight: 1.45,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{purpose}</div>
        )}
        {item.quantity > 1 && (
          <div style={{ fontSize: "14px", fontWeight: 700, color: C.text }}>
            {item.quantity}
            {unit && <span style={{ fontSize: "12px", color: C.textDim, fontWeight: 400 }}> {unit}</span>}
          </div>
        )}
      </div>
    );
  }

  // ── Food storage card ──────────────────────────────────────────────────────
  const unit = attrs.unit as string | undefined;
  const totalCal = attrs.estimatedTotalCalories as number | undefined;
  const foodCategory = attrs.foodCategory as string | undefined;
  const expiry = attrs.expiryDate as string | undefined;

  let expiryColor = C.green;
  if (expiry) {
    const ms = new Date(expiry + "-01").getTime() - Date.now();
    const months = ms / (1000 * 60 * 60 * 24 * 30);
    if (months < 0) expiryColor = C.red;
    else if (months < 3) expiryColor = C.amber;
  }

  const catColor = foodCategory ? (FOOD_CATEGORY_CHIP_COLORS[foodCategory] ?? C.textDim) : C.textDim;
  const catIcon  = foodCategory ? (FOOD_CATEGORY_CHIP_ICONS[foodCategory]  ?? "•") : "";

  return (
    <div style={{
      background: domainColor + "10",
      border: `1px solid ${domainColor}22`,
      borderRadius: "6px",
      padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: "7px",
    }}>
      {/* Quantity row */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
          <span style={{ fontSize: "26px", fontWeight: 800, color: C.text, lineHeight: 1 }}>
            {item.quantity}
          </span>
          {unit && (
            <span style={{ fontSize: "13px", color: C.textMid, fontWeight: 500 }}>{unit}</span>
          )}
        </div>
        {foodCategory && (
          <span style={{
            fontSize: "11px", fontWeight: 700,
            color: catColor, background: catColor + "18",
            border: `1px solid ${catColor}30`,
            borderRadius: "4px", padding: "2px 7px",
          }}>
            {catIcon} {foodCategory}
          </span>
        )}
      </div>

      {/* Calories row */}
      {totalCal !== undefined && totalCal > 0 && (
        <div style={{ fontSize: "13px", color: C.textMid, display: "flex", gap: "10px" }}>
          <span>⚡ <strong style={{ color: C.text }}>{totalCal.toLocaleString()}</strong> cal est.</span>
          {expiry && (
            <span style={{ color: expiryColor }}>📅 exp {expiry}</span>
          )}
        </div>
      )}
    </div>
  );
}
