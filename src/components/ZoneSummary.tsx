import type { InventoryItem } from "../types/inventory";
import { C } from "../styles";

interface Props {
  items: InventoryItem[];
}

export default function ZoneSummary({ items }: Props) {
  const cards = [
    { label: "Total Items",    value: items.length,                                                    color: C.text },
    { label: "Tools",          value: items.filter((i) => i.itemClass === "tool").length,              color: C.tool },
    { label: "Materials",      value: items.filter((i) => i.itemClass === "material").length,          color: C.material },
    { label: "Equipment",      value: items.filter((i) => i.itemClass === "equipment").length,         color: C.equipment },
    { label: "Project Assets", value: items.filter((i) => i.itemClass === "project-asset").length,     color: C.projectAsset },
    { label: "Available",      value: items.filter((i) => i.lifecycleState === "available").length,    color: C.green },
    { label: "In Use",         value: items.filter((i) => i.lifecycleState === "in-use").length,       color: C.blue },
    { label: "Needs Repair",   value: items.filter((i) => i.lifecycleState === "needs-repair").length, color: C.red },
    { label: "Ordered",        value: items.filter((i) => i.lifecycleState === "ordered").length,      color: C.amber },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
      gap: "10px",
      marginBottom: "24px",
    }}>
      {cards.map((card) => (
        <div key={card.label} style={{
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: "7px",
          padding: "14px 12px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "30px", fontWeight: 800, color: card.color, lineHeight: 1 }}>
            {card.value}
          </div>
          <div style={{ fontSize: "12px", color: C.textMid, marginTop: "5px", lineHeight: 1.2 }}>
            {card.label}
          </div>
        </div>
      ))}
    </div>
  );
}
