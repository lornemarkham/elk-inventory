import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { InventoryItem, ZoneId } from "../types/inventory";
import { ZONES } from "../data/zones";
import { COLLECTIONS } from "../data/collections";
import { CONTAINERS } from "../data/containers";
import { C } from "../styles";
import InventoryCard from "./InventoryCard";
import InventoryForm from "./InventoryForm";

// ── Filters — moved here verbatim from App.tsx during the routing migration.
// Nothing outside this page ever referenced these, so they're local now. ────

export type FilterId =
  | "all"
  | "missing-photos"
  | "lost"
  | "tool" | "material" | "equipment" | "project-asset" | "installed-asset" | "surplus"
  | "available" | "in-use" | "ordered" | "needs-repair" | "sort-required" | "incorrect-part" | "retired"
  | `zone:${ZoneId}`
  | `col:${string}`
  | `con:${string}`
  | "tag:elk-garden" | "tag:elk-wrench" | "tag:small-engine" | "tag:diagnostic"
  | `domain:${string}`;

const DOMAIN_FILTERS: { id: FilterId; label: string }[] = [
  { id: "domain:workshop" as FilterId,           label: "Workshop" },
  { id: "domain:electronics" as FilterId,        label: "Electronics" },
  { id: "domain:fitness" as FilterId,            label: "Fitness" },
  { id: "domain:food-storage" as FilterId,       label: "Food Storage" },
  { id: "domain:kitchen-preserving" as FilterId, label: "Kitchen / Preserving" },
  { id: "domain:garden" as FilterId,             label: "Garden" },
  { id: "domain:pool" as FilterId,               label: "Pool" },
  { id: "domain:vehicle" as FilterId,            label: "Vehicle" },
  { id: "domain:household" as FilterId,          label: "Household" },
  { id: "domain:project" as FilterId,            label: "Projects" },
];

const FILTER_GROUPS: { heading: string; filters: { id: FilterId; label: string }[] }[] = [
  { heading: "Domain", filters: DOMAIN_FILTERS },
  {
    heading: "Class",
    filters: [
      { id: "all",             label: "All" },
      { id: "tool",            label: "Tools" },
      { id: "material",        label: "Materials" },
      { id: "equipment",       label: "Equipment" },
      { id: "project-asset",   label: "Project Assets" },
      { id: "installed-asset", label: "Installed" },
      { id: "surplus",         label: "Surplus" },
    ],
  },
  {
    heading: "State",
    filters: [
      { id: "available",      label: "Available" },
      { id: "in-use",         label: "In Use" },
      { id: "ordered",        label: "Ordered" },
      { id: "needs-repair",   label: "Needs Repair" },
      { id: "sort-required",  label: "Sort Required" },
      { id: "incorrect-part", label: "Incorrect Part" },
      { id: "lost",           label: "Lost" },
      { id: "retired",        label: "Retired" },
    ],
  },
  {
    heading: "Zone",
    filters: ZONES.filter((z) => z.id !== "unknown").map((z) => ({
      id: `zone:${z.id}` as FilterId,
      label: z.name,
    })),
  },
  { heading: "Collection", filters: COLLECTIONS.map((c) => ({ id: `col:${c.id}` as FilterId, label: c.name })) },
  { heading: "Container", filters: CONTAINERS.map((c) => ({ id: `con:${c.id}` as FilterId, label: c.name })) },
  {
    heading: "Project",
    filters: [
      { id: "tag:elk-garden",   label: "ELK Garden" },
      { id: "tag:elk-wrench",   label: "ELK Wrench" },
      { id: "tag:small-engine", label: "Small Engine" },
      { id: "tag:diagnostic",   label: "Diagnostic" },
    ],
  },
];

type FilterCat = "class" | "state" | "zone" | "collection" | "container" | "tag" | "domain" | "special";
const CLASS_IDS = new Set<string>(["tool","material","equipment","project-asset","installed-asset","surplus"]);
const STATE_IDS = new Set<string>(["available","in-use","ordered","needs-repair","sort-required","incorrect-part","lost","retired"]);

function getFilterCat(f: FilterId): FilterCat {
  if (f === "missing-photos") return "special";
  if ((f as string).startsWith("domain:")) return "domain";
  if (CLASS_IDS.has(f as string)) return "class";
  if (STATE_IDS.has(f as string)) return "state";
  if ((f as string).startsWith("zone:")) return "zone";
  if ((f as string).startsWith("col:")) return "collection";
  if ((f as string).startsWith("con:")) return "container";
  if ((f as string).startsWith("tag:")) return "tag";
  return "special";
}

function applyFilters(items: InventoryItem[], filters: FilterId[]): InventoryItem[] {
  if (filters.length === 0) return items;
  const groups = new Map<FilterCat, FilterId[]>();
  for (const f of filters) {
    const cat = getFilterCat(f);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(f);
  }
  return items.filter((item) =>
    [...groups.entries()].every(([cat, catFilters]) =>
      catFilters.some((f) => {
        switch (cat) {
          case "class":      return item.itemClass === f;
          case "state":      return item.lifecycleState === f;
          case "zone":       return item.currentZone === (f as string).slice(5);
          case "collection": return item.collectionId === (f as string).slice(4);
          case "container":  return item.containerId === (f as string).slice(4);
          case "tag":        return item.tags.includes((f as string).slice(4));
          case "domain":     return item.domain === (f as string).slice(7);
          case "special":    return f === "missing-photos" ? !item.photoPath?.trim() : false;
          default: return false;
        }
      }),
    ),
  );
}

function getFilterLabel(f: FilterId): string {
  const known: Partial<Record<string, string>> = {
    "missing-photos": "Missing Photos",
    "needs-repair": "Needs Repair",
    "sort-required": "Sort Required",
    "incorrect-part": "Incorrect Part",
    "project-asset": "Project Asset",
    "installed-asset": "Installed Asset",
    "in-use": "In Use",
  };
  if (known[f as string]) return known[f as string]!;
  const stripped = (f as string).replace(/^(zone:|col:|con:|tag:)/, "").replace(/-/g, " ");
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function searchItems(items: InventoryItem[], q: string): InventoryItem[] {
  if (!q.trim()) return items;
  const lq = q.toLowerCase();
  return items.filter((i) =>
    i.name.toLowerCase().includes(lq) ||
    i.itemClass.includes(lq) ||
    i.lifecycleState.includes(lq) ||
    i.currentZone.includes(lq) ||
    i.recommendedZone.includes(lq) ||
    (i.project?.toLowerCase().includes(lq) ?? false) ||
    i.tags.some((t) => t.includes(lq)) ||
    i.notes.toLowerCase().includes(lq) ||
    i.locationDetail.toLowerCase().includes(lq) ||
    (i.brand?.toLowerCase().includes(lq) ?? false)
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

interface Props {
  items: InventoryItem[];
  onAdd: (item: InventoryItem) => void;
  onItemClick: (item: InventoryItem) => void;
}

export default function InventoryPage({ items, onAdd, onItemClick }: Props) {
  const location = useLocation();
  const navigate = useNavigate();

  const [activeFilters, setActiveFilters] = useState<FilterId[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // One-shot navigation instruction (from a Dashboard drill-down, the
  // CommandBar, or "+ Add Item") — e.g. navigate("/inventory", { state: {
  // applyFilter: "zone:mechanic-bay" } }). Runs on every arrival at this
  // page, including re-navigating here while already on it, then clears the
  // state so it doesn't reapply on a later back/forward.
  useEffect(() => {
    const state = location.state as { applyFilter?: string } | null;
    if (state?.applyFilter === undefined) return;
    setActiveFilters(state.applyFilter === "all" || !state.applyFilter ? [] : [state.applyFilter as FilterId]);
    setSearchQuery("");
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  function toggleFilter(f: FilterId) {
    if (f === "all") { setActiveFilters([]); return; }
    setActiveFilters((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  const searched = useMemo(() => searchItems(items, searchQuery), [items, searchQuery]);
  const filtered = useMemo(() => applyFilters(searched, activeFilters), [searched, activeFilters]);

  return (
    <>
      {/* Active filters banner */}
      {activeFilters.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px",
          background: C.bgCard,
          border: `1px solid ${C.amber}35`,
          borderLeft: `3px solid ${C.amber}`,
          borderRadius: "7px",
          padding: "9px 14px",
          marginBottom: "14px",
          fontSize: "13px",
        }}>
          <span style={{ color: C.textDim, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, flexShrink: 0 }}>
            Filtering
          </span>
          {activeFilters.map((f) => (
            <button key={f} onClick={() => toggleFilter(f)} style={{
              display: "flex", alignItems: "center", gap: "4px",
              background: C.amber + "18",
              border: `1px solid ${C.amber}44`,
              color: C.amber, borderRadius: "4px",
              padding: "2px 8px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
            }}>
              {getFilterLabel(f)} <span style={{ opacity: 0.7, marginLeft: "2px" }}>✕</span>
            </button>
          ))}
          <span style={{ color: C.textDim, fontSize: "12px", marginLeft: "4px" }}>{filtered.length} items</span>
          <button onClick={() => setActiveFilters([])} style={{
            marginLeft: "auto", background: "transparent",
            border: `1px solid ${C.borderLo}`, color: C.textMid,
            borderRadius: "5px", padding: "3px 10px", fontSize: "11px", cursor: "pointer",
          }}>
            Clear All
          </button>
        </div>
      )}

      {/* Inline search */}
      <div style={{ position: "relative", marginBottom: "16px" }}>
        <span style={{
          position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)",
          fontSize: "16px", pointerEvents: "none",
        }}>🔍</span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter by name, tag, brand, notes…"
          style={{
            width: "100%",
            background: C.bgCard,
            border: `1px solid ${searchQuery ? C.amber : C.border}`,
            borderRadius: "7px",
            padding: "11px 16px 11px 42px",
            fontSize: "15px",
            color: C.text,
            boxSizing: "border-box",
            outline: "none",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = C.amber; }}
          onBlur={(e) => { if (!searchQuery) e.currentTarget.style.borderColor = C.border; }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            style={{
              position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)",
              background: "transparent", border: "none", color: C.textMid,
              fontSize: "16px", cursor: "pointer",
            }}
          >✕</button>
        )}
      </div>

      <InventoryForm onAdd={onAdd} />

      {/* Filter bar — multi-select (OR within group, AND across groups) */}
      <div style={{
        background: C.bgCard,
        border: `1px solid ${C.border}`,
        borderRadius: "8px",
        padding: "12px 16px",
        marginBottom: "16px",
        display: "flex", flexWrap: "wrap", gap: "12px",
      }}>
        {FILTER_GROUPS.map((group) => (
          <div key={group.heading} style={{ display: "flex", alignItems: "flex-start", gap: "6px", flexWrap: "wrap" }}>
            <span style={{
              fontSize: "10px", color: C.textDim,
              textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 700,
              paddingTop: "5px", flexShrink: 0,
            }}>
              {group.heading}
            </span>
            {group.filters.map((f) => {
              const active = f.id === "all" ? activeFilters.length === 0 : activeFilters.includes(f.id);
              return (
                <button key={f.id} onClick={() => toggleFilter(f.id)} style={{
                  background: active ? C.bgInset : "transparent",
                  border: `1px solid ${active ? C.amber : C.borderLo}`,
                  color: active ? C.amber : C.textMid,
                  borderRadius: "5px",
                  padding: "3px 10px",
                  fontSize: "12px",
                  cursor: "pointer",
                  fontWeight: active ? 700 : 400,
                }}>
                  {f.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Result count */}
      <div style={{ fontSize: "13px", color: C.textDim, marginBottom: "12px" }}>
        {filtered.length} of {items.length} items
        {searchQuery && <span style={{ color: C.amber }}> · "{searchQuery}"</span>}
        {activeFilters.length > 0 && !searchQuery && (
          <span style={{ color: C.textDim }}> · {activeFilters.length} filter{activeFilters.length > 1 ? "s" : ""} active</span>
        )}
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "12px", opacity: 0.3 }}>🔍</div>
          <p style={{ fontSize: "16px", color: C.textMid }}>
            {searchQuery ? `No results for "${searchQuery}"` : "No items match this filter."}
          </p>
          <button
            onClick={() => { setActiveFilters([]); setSearchQuery(""); }}
            style={{
              marginTop: "12px",
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.textMid,
              borderRadius: "6px",
              padding: "8px 18px",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "14px",
        }}>
          {filtered.map((item) => (
            <InventoryCard key={item.id} item={item} onClick={onItemClick} />
          ))}
        </div>
      )}
    </>
  );
}
