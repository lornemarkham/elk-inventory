import type { InventoryItem } from "../types/inventory";
import { COLLECTIONS } from "../data/collections";
import { CONTAINERS } from "../data/containers";
import { ZONES } from "../data/zones";
import { C, CLASS_COLORS } from "../styles";

interface Props {
  items: InventoryItem[];
}

export default function CollectionsPage({ items }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
      <CollectionsSection items={items} />
      <ContainersSection items={items} />
    </div>
  );
}

function CollectionsSection({ items }: { items: InventoryItem[] }) {
  return (
    <section>
      <SectionHeader
        title="Kits & Collections"
        subtitle="Logical groups of assets that span zones — tool kits, project kits, supply collections."
      />
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: "10px",
      }}>
        {COLLECTIONS.map((col) => {
          const colItems = items.filter((i) => i.collectionId === col.id);
          const counts = classCounts(colItems);
          return (
            <div key={col.id} style={{
              background: C.bgCard,
              border: `1px solid ${C.border}`,
              borderRadius: "6px",
              padding: "14px 16px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{col.name}</div>
                <span style={{ fontSize: "20px", fontWeight: 800, color: colItems.length > 0 ? C.amber : C.textDim }}>
                  {colItems.length}
                </span>
              </div>
              <p style={{ fontSize: "11px", color: C.textMid, margin: "0 0 10px", lineHeight: 1.4 }}>
                {col.description}
              </p>
              {colItems.length > 0 && (
                <>
                  <ClassPills counts={counts} />
                  <ItemList items={colItems} />
                </>
              )}
              {colItems.length === 0 && (
                <span style={{ fontSize: "10px", color: C.textDim }}>No items assigned.</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ContainersSection({ items }: { items: InventoryItem[] }) {
  return (
    <section>
      <SectionHeader
        title="Containers"
        subtitle="Physical storage: toolboxes, totes, cases, shelves."
      />
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: "10px",
      }}>
        {CONTAINERS.map((con) => {
          const conItems = items.filter((i) => i.containerId === con.id);
          const zone = ZONES.find((z) => z.id === con.zoneId);
          const counts = classCounts(conItems);
          return (
            <div key={con.id} style={{
              background: C.bgCard,
              border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${con.color}`,
              borderRadius: "6px",
              padding: "14px 16px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{con.name}</div>
                <span style={{ fontSize: "20px", fontWeight: 800, color: conItems.length > 0 ? C.text : C.textDim }}>
                  {conItems.length}
                </span>
              </div>
              {zone && (
                <div style={{ fontSize: "10px", color: C.textDim, marginBottom: "4px" }}>
                  ▸ {zone.name}
                </div>
              )}
              <p style={{ fontSize: "11px", color: C.textMid, margin: "0 0 10px", lineHeight: 1.4 }}>
                {con.description}
              </p>
              {conItems.length > 0 && (
                <>
                  <ClassPills counts={counts} />
                  <ItemList items={conItems} />
                </>
              )}
              {conItems.length === 0 && (
                <span style={{ fontSize: "10px", color: C.textDim }}>Empty.</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function classCounts(items: InventoryItem[]) {
  return {
    tool:             items.filter((i) => i.itemClass === "tool").length,
    material:         items.filter((i) => i.itemClass === "material").length,
    equipment:        items.filter((i) => i.itemClass === "equipment").length,
    "project-asset":  items.filter((i) => i.itemClass === "project-asset").length,
    "installed-asset":items.filter((i) => i.itemClass === "installed-asset").length,
    surplus:          items.filter((i) => i.itemClass === "surplus").length,
  };
}

function ClassPills({ counts }: { counts: ReturnType<typeof classCounts> }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;
  const labels: Record<string, string> = {
    tool: "Tools", material: "Materials", equipment: "Equipment",
    "project-asset": "Projects", "installed-asset": "Installed", surplus: "Surplus",
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px" }}>
      {entries.map(([cls, count]) => (
        <span key={cls} style={{
          fontSize: "9px", fontWeight: 600,
          background: (CLASS_COLORS[cls] ?? C.textDim) + "18",
          color: CLASS_COLORS[cls] ?? C.textDim,
          border: `1px solid ${(CLASS_COLORS[cls] ?? C.textDim)}28`,
          borderRadius: "3px", padding: "1px 5px",
        }}>
          {count} {labels[cls]}
        </span>
      ))}
    </div>
  );
}

function ItemList({ items }: { items: InventoryItem[] }) {
  return (
    <div style={{ borderTop: `1px solid ${C.borderLo}`, paddingTop: "7px" }}>
      {items.slice(0, 7).map((item) => (
        <div key={item.id} style={{
          fontSize: "11px", color: C.textDim,
          padding: "2px 0",
          display: "flex", justifyContent: "space-between", gap: "8px",
        }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.name}
            {item.quantity > 1 && (
              <span style={{ color: C.textDim, marginLeft: "3px", opacity: 0.5 }}>×{item.quantity}</span>
            )}
          </span>
          <span style={{ flexShrink: 0, color: C.textDim, opacity: 0.4, fontSize: "10px" }}>
            {item.lifecycleState}
          </span>
        </div>
      ))}
      {items.length > 7 && (
        <div style={{ fontSize: "10px", color: C.textDim, opacity: 0.4, marginTop: "3px" }}>
          +{items.length - 7} more
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <h2 style={{ margin: "0 0 3px", fontSize: "15px", fontWeight: 700, color: C.text }}>{title}</h2>
      <p style={{ margin: 0, fontSize: "11px", color: C.textDim }}>{subtitle}</p>
    </div>
  );
}
