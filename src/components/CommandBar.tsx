import { useState, useMemo, useEffect, useRef } from "react";
import type { InventoryItem, Zone, Container } from "../types/inventory";
import { C, CLASS_COLORS, CLASS_LABELS, STATE_COLORS, ZONE_COLORS } from "../styles";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  zones: Zone[];
  containers: Container[];
  onSelectItem: (item: InventoryItem) => void;
  onFilterSelect: (filter: string) => void;
}

type ResultKind = "item" | "zone" | "container";

interface Hit {
  kind: ResultKind;
  id: string;
  title: string;
  sub: string;
  badge?: string;
  badgeColor?: string;
  data: InventoryItem | Zone | Container;
}

function matches(text: string, q: string): boolean {
  return text.toLowerCase().includes(q.toLowerCase());
}

export default function CommandBar({ isOpen, onClose, items, zones, containers, onSelectItem, onFilterSelect }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  const hits = useMemo((): Hit[] => {
    const q = query.trim();
    if (!q) return [];

    const itemHits: Hit[] = items
      .filter(i =>
        matches(i.name, q) ||
        matches(i.notes, q) ||
        matches(i.locationDetail, q) ||
        (i.brand && matches(i.brand, q)) ||
        i.tags.some(t => matches(t, q))
      )
      .slice(0, 7)
      .map(i => ({
        kind: "item",
        id: i.id,
        title: i.name,
        sub: `${CLASS_LABELS[i.itemClass] ?? i.itemClass} · ${i.currentZone.replace(/-/g, " ")}`,
        badge: i.lifecycleState,
        badgeColor: STATE_COLORS[i.lifecycleState] ?? C.textDim,
        data: i,
      }));

    const zoneHits: Hit[] = zones
      .filter(z => matches(z.name, q) || matches(z.purpose, q))
      .slice(0, 3)
      .map(z => ({
        kind: "zone",
        id: z.id,
        title: z.name,
        sub: z.purpose,
        badge: "Zone",
        badgeColor: ZONE_COLORS[z.id] ?? C.textDim,
        data: z,
      }));

    const containerHits: Hit[] = containers
      .filter(c => matches(c.name, q) || matches(c.description, q))
      .slice(0, 3)
      .map(c => ({
        kind: "container",
        id: c.id,
        title: c.name,
        sub: c.description,
        badge: "Container",
        badgeColor: c.color,
        data: c,
      }));

    return [...itemHits, ...zoneHits, ...containerHits];
  }, [query, items, zones, containers]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  function selectHit(hit: Hit) {
    if (hit.kind === "item") {
      onSelectItem(hit.data as InventoryItem);
    } else if (hit.kind === "zone") {
      onFilterSelect(`zone:${hit.id}`);
    } else {
      onFilterSelect(`con:${hit.id}`);
    }
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, hits.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    }
    if (e.key === "Enter" && hits[selectedIdx]) {
      selectHit(hits[selectedIdx]);
    }
  }

  if (!isOpen) return null;

  const groups: { heading: string; hits: (Hit & { flatIdx: number })[] }[] = [];
  let flat = 0;
  const itemHits = hits.filter(h => h.kind === "item");
  const zoneHits = hits.filter(h => h.kind === "zone");
  const containerHits = hits.filter(h => h.kind === "container");

  if (itemHits.length) groups.push({ heading: `Items (${itemHits.length})`, hits: itemHits.map(h => ({ ...h, flatIdx: flat++ })) });
  if (zoneHits.length) groups.push({ heading: `Zones (${zoneHits.length})`, hits: zoneHits.map(h => ({ ...h, flatIdx: flat++ })) });
  if (containerHits.length) groups.push({ heading: `Containers (${containerHits.length})`, hits: containerHits.map(h => ({ ...h, flatIdx: flat++ })) });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 9, 8, 0.82)",
        zIndex: 2000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        style={{
          width: "min(640px, 92vw)",
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: "12px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Search input */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "16px 18px",
          borderBottom: `1px solid ${C.border}`,
        }}>
          <span style={{ fontSize: "18px", opacity: 0.7, flexShrink: 0 }}>🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search items, zones, containers, tags…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: "17px",
              color: C.text,
              fontFamily: "inherit",
            }}
          />
          <kbd style={{
            fontSize: "11px",
            color: C.textDim,
            background: C.bgInset,
            border: `1px solid ${C.borderLo}`,
            borderRadius: "4px",
            padding: "3px 7px",
            flexShrink: 0,
            cursor: "pointer",
          }} onClick={onClose}>
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: "min(420px, 60vh)", overflowY: "auto" }}>
          {query.trim() === "" && (
            <div style={{ padding: "32px 20px", textAlign: "center" }}>
              <div style={{ fontSize: "28px", marginBottom: "10px", opacity: 0.35 }}>🔍</div>
              <p style={{ margin: 0, color: C.textDim, fontSize: "14px" }}>
                Type to search across items, zones, and containers
              </p>
              <div style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                {["tool", "ryobi", "mechanic", "ordered", "needs-repair", "elk-garden"].map(hint => (
                  <button
                    key={hint}
                    onClick={() => setQuery(hint)}
                    style={{
                      background: C.bgInset,
                      border: `1px solid ${C.borderLo}`,
                      borderRadius: "5px",
                      color: C.textMid,
                      fontSize: "12px",
                      padding: "4px 10px",
                      cursor: "pointer",
                    }}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          )}

          {query.trim() !== "" && hits.length === 0 && (
            <div style={{ padding: "32px 20px", textAlign: "center" }}>
              <div style={{ fontSize: "28px", marginBottom: "10px", opacity: 0.35 }}>∅</div>
              <p style={{ margin: 0, color: C.textDim, fontSize: "14px" }}>
                No results for <span style={{ color: C.text }}>"{query}"</span>
              </p>
              <p style={{ margin: "8px 0 0", color: C.textDim, fontSize: "13px" }}>
                This item may not be in inventory yet.
              </p>
            </div>
          )}

          {groups.map(group => (
            <div key={group.heading}>
              <div style={{
                padding: "8px 18px 4px",
                fontSize: "11px",
                fontWeight: 700,
                color: C.textDim,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}>
                {group.heading}
              </div>
              {group.hits.map(hit => {
                const isSelected = hit.flatIdx === selectedIdx;
                return (
                  <button
                    key={hit.id}
                    onClick={() => selectHit(hit)}
                    onMouseEnter={() => setSelectedIdx(hit.flatIdx)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      width: "100%",
                      padding: "10px 18px",
                      background: isSelected ? C.bgInset : "transparent",
                      border: "none",
                      borderLeft: isSelected ? `3px solid ${C.amber}` : "3px solid transparent",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "6px",
                      background: (hit.badgeColor ?? C.textDim) + "25",
                      border: `1px solid ${(hit.badgeColor ?? C.textDim) + "40"}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "13px",
                      flexShrink: 0,
                    }}>
                      {hit.kind === "item" ? "📦" : hit.kind === "zone" ? "🗺" : "📫"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {hit.title}
                      </div>
                      <div style={{ fontSize: "12px", color: C.textMid, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {hit.sub}
                      </div>
                    </div>
                    {hit.badge && (
                      <span style={{
                        fontSize: "11px",
                        color: hit.badgeColor ?? C.textDim,
                        background: (hit.badgeColor ?? C.textDim) + "20",
                        border: `1px solid ${(hit.badgeColor ?? C.textDim) + "40"}`,
                        borderRadius: "4px",
                        padding: "2px 7px",
                        flexShrink: 0,
                        maxWidth: "100px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {hit.badge}
                      </span>
                    )}
                    {isSelected && (
                      <kbd style={{
                        fontSize: "10px",
                        color: C.textDim,
                        background: C.bgInset,
                        border: `1px solid ${C.borderLo}`,
                        borderRadius: "3px",
                        padding: "1px 5px",
                        flexShrink: 0,
                      }}>
                        ↵
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        {hits.length > 0 && (
          <div style={{
            padding: "8px 18px",
            borderTop: `1px solid ${C.borderLo}`,
            display: "flex",
            gap: "16px",
            fontSize: "11px",
            color: C.textDim,
          }}>
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>Esc close</span>
          </div>
        )}
      </div>
    </div>
  );
}
