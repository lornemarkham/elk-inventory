import { useState, useMemo, useEffect, useRef } from "react";
import type { InventoryItem, Zone, Container } from "../types/inventory";
import { C, CLASS_COLORS, CLASS_LABELS, STATE_COLORS, ZONE_COLORS } from "../styles";

// ── Life Inventory domains ─────────────────────────────────────────────────────
interface LifeDomain {
  id: string; label: string; icon: string; color: string; desc: string;
  countFn: (i: InventoryItem) => boolean; drillFilter: string;
}
const LIFE_DOMAINS: LifeDomain[] = [
  { id: "workshop",           label: "Workshop",            icon: "🔧", color: "#c04020", desc: "Tools, parts, equipment",       countFn: i => !i.domain || i.domain === "workshop",           drillFilter: "all" },
  { id: "electronics",        label: "Electronics",         icon: "🔌", color: "#4278a0", desc: "Boards, sensors, components",   countFn: i => i.domain === "electronics" || i.tags.some(t => ["electronics","esp32","raspberry-pi","solar"].includes(t)), drillFilter: "domain:electronics" },
  { id: "food-storage",       label: "Food Storage",        icon: "🥫", color: "#7a8c42", desc: "Canned goods, dry goods, freezer", countFn: i => i.domain === "food-storage",               drillFilter: "domain:food-storage" },
  { id: "kitchen-preserving", label: "Kitchen / Preserving",icon: "🫙", color: "#8c6a32", desc: "Jars, lids, preserving gear",   countFn: i => i.domain === "kitchen-preserving",             drillFilter: "domain:kitchen-preserving" },
  { id: "garden",             label: "Garden",              icon: "🌱", color: "#5a8c42", desc: "Sensors, irrigation, supplies", countFn: i => i.domain === "garden" || i.currentZone === "garden", drillFilter: "zone:garden" },
  { id: "pool",               label: "Pool",                icon: "🏊", color: "#3a8aa0", desc: "Chemicals, equipment",         countFn: i => i.domain === "pool" || i.tags.includes("pool"), drillFilter: "domain:pool" },
  { id: "vehicle",            label: "Vehicle",             icon: "🚗", color: "#c48c28", desc: "Parts, fluids, roadside gear", countFn: i => i.domain === "vehicle" || i.currentZone === "truck-kit", drillFilter: "zone:truck-kit" },
];

// ── Legacy zone-based collections (keep for Continue Working section) ──────────
interface DomainCollection {
  id: string; name: string; icon: string; color: string; description: string;
  matchFn: (i: InventoryItem) => boolean; drillFilter: string;
}
const DOMAIN_COLLECTIONS: DomainCollection[] = [
  { id: "garage",      name: "Garage",      icon: "🔧", color: C.red,     description: "Tools, equipment, mechanic bay",   matchFn: i => !["garden","truck-kit"].includes(i.currentZone) && !i.domain, drillFilter: "all" },
  { id: "electronics", name: "Electronics", icon: "🔌", color: C.blue,    description: "Boards, sensors, components",       matchFn: i => i.tags.some(t => ["electronics","esp32","raspberry-pi","solar","sensor"].includes(t)), drillFilter: "tag:electronics" },
  { id: "pool",        name: "Pool",        icon: "🏊", color: "#3a8aa0", description: "Chemicals, equipment, parts",       matchFn: i => i.tags.includes("pool"), drillFilter: "tag:pool" },
  { id: "garden",      name: "Garden",      icon: "🌱", color: C.green,   description: "Sensors, irrigation, plants",       matchFn: i => i.currentZone === "garden", drillFilter: "zone:garden" },
  { id: "truck-kit",   name: "Truck Kit",   icon: "🚛", color: C.amber,   description: "Emergency gear, roadside tools",    matchFn: i => i.currentZone === "truck-kit", drillFilter: "zone:truck-kit" },
];

// ── Filter chips ──────────────────────────────────────────────────────────────
type ChipId = "all" | "items" | "zones" | "containers" | "collections" | "ordered" | "repair" | "missing-photos";
const CHIPS: { id: ChipId; label: string }[] = [
  { id: "all",            label: "All" },
  { id: "items",          label: "Items" },
  { id: "zones",          label: "Zones" },
  { id: "containers",     label: "Containers" },
  { id: "collections",    label: "Collections" },
  { id: "ordered",        label: "Ordered" },
  { id: "repair",         label: "Needs Repair" },
  { id: "missing-photos", label: "Missing Photos" },
];

// ── Utils ─────────────────────────────────────────────────────────────────────
const RECENT_KEY = "elk-home-searches";

function loadRecentSearches(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
}
function saveRecentSearches(s: string[]) { localStorage.setItem(RECENT_KEY, JSON.stringify(s)); }

function timeAgo(iso: string | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 30) return `${Math.floor(d / 30)}mo ago`;
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

function parseTokens(q: string): string[] {
  return q.split(/[\n\r,]+/).map(s => s.trim()).filter(Boolean);
}

function matchesItem(item: InventoryItem, t: string): boolean {
  return [
    item.name, item.brand ?? "", item.notes, item.locationDetail,
    item.itemClass, item.lifecycleState, item.currentZone,
    item.project ?? "", item.category ?? "", item.subcategory ?? "",
    ...item.tags,
  ].some(f => f.toLowerCase().includes(t.toLowerCase()));
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  items: InventoryItem[];
  zones: Zone[];
  containers: Container[];
  onItemClick: (item: InventoryItem) => void;
  onDrillDown: (filter: string) => void;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Dashboard({ items, zones, containers, onItemClick, onDrillDown }: Props) {
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<ChipId>("all");
  const [gatherMode, setGatherMode] = useState(false);
  const [gathered, setGathered] = useState<Set<string>>(new Set());
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setGathered(new Set()); setGatherMode(false); }, [query]);

  const tokens = useMemo(() => parseTokens(query), [query]);
  const isMultiSearch = tokens.length > 1;
  const isSingleSearch = tokens.length === 1 && query.trim() !== "";
  const showResults = isSingleSearch || isMultiSearch || ["ordered","repair","missing-photos"].includes(chip);

  function recordSearch(q: string) {
    if (!q.trim()) return;
    const updated = [q.trim(), ...recentSearches.filter(s => s !== q.trim())].slice(0, 6);
    setRecentSearches(updated);
    saveRecentSearches(updated);
  }
  function clearRecentSearches() { setRecentSearches([]); saveRecentSearches([]); }
  function handleDrillFromSearch(filter: string) { recordSearch(query); onDrillDown(filter); }
  function handleItemClick(item: InventoryItem) { recordSearch(query); onItemClick(item); }
  function toggleGathered(id: string) {
    setGathered(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ── Multi-search: per-token results ──────────────────────────────────────────
  const tokenResults = useMemo(() => {
    if (!isMultiSearch) return [];
    return tokens.map(token => {
      const matches = items.filter(i => matchesItem(i, token));
      return { token, matches: matches.slice(0, 4), totalMatches: matches.length };
    });
  }, [tokens, isMultiSearch, items]);

  // ── Single search: grouped results ───────────────────────────────────────────
  const singleResults = useMemo(() => {
    const q = isSingleSearch ? tokens[0].toLowerCase() : "";

    let baseItems = items;
    if (chip === "ordered")             baseItems = items.filter(i => i.lifecycleState === "ordered");
    else if (chip === "repair")         baseItems = items.filter(i => i.lifecycleState === "needs-repair");
    else if (chip === "missing-photos") baseItems = items.filter(i => !i.photoPath?.trim());

    const mi = (i: InventoryItem) => !q || matchesItem(i, q);
    const mz = (z: Zone) => !q || [z.name, z.purpose, z.notes].some(s => s.toLowerCase().includes(q));
    const mc = (c: Container) => !q || [c.name, c.description].some(s => s.toLowerCase().includes(q));
    const md = (d: DomainCollection) => !q || [d.name, d.description].some(s => s.toLowerCase().includes(q));

    const showItems = ["all","items","ordered","repair","missing-photos"].includes(chip);
    const showZones = ["all","zones"].includes(chip);
    const showCont  = ["all","containers"].includes(chip);
    const showCols  = ["all","collections"].includes(chip);

    const matchedItems = showItems ? baseItems.filter(mi) : [];
    const matchedZones = showZones ? zones.filter(mz) : [];
    const matchedCont  = showCont  ? containers.filter(mc) : [];
    const matchedCols  = showCols  ? DOMAIN_COLLECTIONS.filter(md) : [];

    return {
      items: matchedItems.slice(0, chip === "items" ? 15 : 6), itemTotal: matchedItems.length,
      zones: matchedZones.slice(0, 4), zoneTotal: matchedZones.length,
      containers: matchedCont.slice(0, 4), contTotal: matchedCont.length,
      collections: matchedCols,
    };
  }, [tokens, isSingleSearch, chip, items, zones, containers]);

  // ── Empty-state computed values ───────────────────────────────────────────────
  const attention = useMemo(() => [
    { icon: "📷", label: "Missing Photos",   count: items.filter(i => !i.photoPath?.trim()).length,                                            filter: "missing-photos", color: C.textMid },
    { icon: "🔧", label: "Needs Repair",     count: items.filter(i => i.lifecycleState === "needs-repair").length,                             filter: "needs-repair",   color: C.red },
    { icon: "📦", label: "Incoming",         count: items.filter(i => i.lifecycleState === "ordered").length,                                  filter: "ordered",         color: C.amber },
    { icon: "❓", label: "Unknown Location", count: items.filter(i => i.currentZone === "unknown").length,                                     filter: "zone:unknown",    color: C.amber },
    { icon: "🔀", label: "Sort Required",    count: items.filter(i => ["sort-required","incorrect-part"].includes(i.lifecycleState)).length,   filter: "sort-required",   color: C.amber },
    { icon: "🚫", label: "Lost",             count: items.filter(i => i.lifecycleState === "lost").length,                                     filter: "lost",            color: "#8a2020" },
  ].filter(a => a.count > 0), [items]);

  const continueZones = useMemo(() =>
    zones.filter(z => z.id !== "unknown").map(zone => {
      const zi = items.filter(i => i.currentZone === zone.id);
      const ts = zi.map(i => i.updatedAt ?? i.createdAt ?? "").sort().at(-1);
      return { zone, count: zi.length, ts };
    }).filter(z => z.count > 0).sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? "")).slice(0, 6),
  [items, zones]);

  const activeCollections = useMemo(() =>
    DOMAIN_COLLECTIONS.map(col => {
      const ci = items.filter(col.matchFn);
      const ts = ci.map(i => i.updatedAt ?? i.createdAt ?? "").sort().at(-1);
      return { col, count: ci.length, ts };
    }).filter(c => c.count > 0),
  [items]);

  const lifeDomainCounts = useMemo(() =>
    LIFE_DOMAINS.map(d => ({ d, count: items.filter(d.countFn).length })),
  [items]);

  // Food storage aggregate stats
  const foodSummary = useMemo(() => {
    const foodItems = items.filter(i => i.domain === "food-storage");
    // Use new estimatedTotalCalories, fall back to legacy calories field
    const totalCal = foodItems.reduce((sum, i) =>
      sum + Number(i.attributes?.estimatedTotalCalories ?? i.attributes?.calories ?? 0), 0);

    // Named category groups: protein, fruit, vegetables, soup, dry-goods
    type CategoryItem = { name: string; qty: number; unit: string };
    const catGroups: Record<string, CategoryItem[]> = {};
    foodItems.forEach(i => {
      const cat = String(i.attributes?.foodCategory ?? i.attributes?.category ?? "other");
      if (!catGroups[cat]) catGroups[cat] = [];
      catGroups[cat].push({
        name: i.name,
        qty: i.quantity,
        unit: String(i.attributes?.unit ?? ""),
      });
    });

    // Named category display order
    const CATEGORY_ORDER = ["protein", "fruit", "vegetables", "soup", "dry-goods", "baking", "other"];
    const categories = CATEGORY_ORDER
      .filter(c => catGroups[c])
      .map(c => ({ name: c, items: catGroups[c] }));

    // Container/location breakdown
    const locSet = new Set<string>();
    foodItems.forEach(i => {
      const loc = String(i.attributes?.storageLocation ?? i.locationDetail ?? "");
      if (loc) locSet.add(loc);
    });
    const locations = [...locSet];

    return { itemCount: foodItems.length, totalCal, categories, locations };
  }, [items]);

  // Gather summary
  const gatherTotal = tokenResults.reduce((n, r) => n + r.matches.length, 0);
  const gatherFound = tokenResults.filter(r => r.matches.length > 0).length;
  const gatherMissing = tokenResults.filter(r => r.matches.length === 0).length;
  const gatherChecked = tokenResults.reduce((n, r) => n + r.matches.filter(i => gathered.has(i.id)).length, 0);

  const hasAnySingleResults = singleResults.itemTotal > 0 || singleResults.zoneTotal > 0 || singleResults.contTotal > 0 || singleResults.collections.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ paddingBottom: "60px" }}>

      {/* ── Hero search ───────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: "720px", margin: "0 auto 28px", paddingTop: "24px" }}>
        <p style={{
          margin: "0 0 14px", textAlign: "center",
          fontSize: "12px", fontWeight: 600, color: C.textDim,
          letterSpacing: "0.06em", textTransform: "uppercase",
        }}>
          Search your life.
        </p>

        <div style={{ position: "relative" }}>
          <span style={{
            position: "absolute", left: "16px", top: "50%", transform: "translateY(-50%)",
            fontSize: "18px", pointerEvents: "none", opacity: 0.55,
          }}>🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onPaste={e => {
              const pasted = e.clipboardData.getData("text");
              const lines = pasted.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean);
              if (lines.length > 1) {
                e.preventDefault();
                const el = e.currentTarget;
                const before = query.slice(0, el.selectionStart ?? query.length);
                const after  = query.slice(el.selectionEnd ?? query.length);
                const prefix = before.trim() ? before.trimEnd() + ", " : "";
                setQuery(prefix + lines.join(", ") + after);
              }
            }}
            onKeyDown={e => {
              if (e.key === "Enter" && query.trim()) {
                recordSearch(query);
                if (!isMultiSearch && singleResults.items.length === 1) handleItemClick(singleResults.items[0]);
              }
            }}
            placeholder={isMultiSearch ? `${tokens.length} search terms…` : "Search items, zones, containers, collections…"}
            style={{
              width: "100%", boxSizing: "border-box",
              background: C.bgCard,
              border: `1.5px solid ${query ? C.amber : C.border}`,
              borderRadius: "10px",
              padding: "15px 48px 15px 48px",
              fontSize: "17px", color: C.text, outline: "none", fontFamily: "inherit",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = C.amber; }}
            onBlur={e => { if (!query) e.currentTarget.style.borderColor = C.border; }}
          />
          {/* Multi-term token badge */}
          {isMultiSearch && (
            <span style={{
              position: "absolute", left: "46px", top: "50%", transform: "translateY(-50%)",
              fontSize: "11px", fontWeight: 700, color: C.amber,
              background: C.amber + "22", border: `1px solid ${C.amber}44`,
              borderRadius: "10px", padding: "1px 7px",
              pointerEvents: "none",
            }}>
              {tokens.length} terms
            </span>
          )}
          {query && (
            <button onClick={() => setQuery("")} style={{
              position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)",
              background: C.bgInset, border: `1px solid ${C.borderLo}`,
              borderRadius: "5px", color: C.textMid, fontSize: "11px", cursor: "pointer", padding: "3px 8px",
            }}>
              Clear
            </button>
          )}
        </div>

        {/* Hint when multi-search detected */}
        {isMultiSearch && (
          <p style={{ margin: "8px 0 0", textAlign: "center", fontSize: "12px", color: C.textDim }}>
            Comma or newline separated · {tokens.join("  ·  ")}
          </p>
        )}

        {/* Filter chips (hidden in multi-search — terms control filtering) */}
        {!isMultiSearch && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "12px", justifyContent: "center" }}>
            {CHIPS.map(c => {
              const active = chip === c.id;
              return (
                <button key={c.id} onClick={() => setChip(active ? "all" : c.id)} style={{
                  padding: "5px 13px",
                  background: active ? C.amber + "20" : "transparent",
                  border: `1px solid ${active ? C.amber : C.borderLo}`,
                  borderRadius: "14px",
                  color: active ? C.amber : C.textMid,
                  fontSize: "12px", fontWeight: active ? 700 : 400, cursor: "pointer",
                }}>
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Content area ──────────────────────────────────────────────────────── */}
      {showResults ? (

        /* ── MULTI-SEARCH ─────────────────────────────────────────────────────── */
        isMultiSearch ? (
          <div>
            {/* Gather mode header */}
            <div style={{
              display: "flex", alignItems: "center", gap: "12px",
              marginBottom: "20px", flexWrap: "wrap",
            }}>
              <span style={{ fontSize: "12px", color: C.textDim, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                Multi-Search
              </span>
              <span style={{ fontSize: "12px", color: C.textDim }}>
                {gatherFound} of {tokens.length} found
                {gatherMissing > 0 && <span style={{ color: C.red }}> · {gatherMissing} missing</span>}
              </span>
              {gatherMode && (
                <span style={{ fontSize: "12px", color: C.amber, fontWeight: 700 }}>
                  {gatherChecked} / {gatherTotal} gathered
                </span>
              )}
              <button
                onClick={() => setGatherMode(m => !m)}
                style={{
                  marginLeft: "auto",
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "6px 14px",
                  background: gatherMode ? C.amber + "20" : C.bgCard,
                  border: `1px solid ${gatherMode ? C.amber : C.border}`,
                  borderRadius: "7px",
                  color: gatherMode ? C.amber : C.textMid,
                  fontSize: "13px", fontWeight: gatherMode ? 700 : 400,
                  cursor: "pointer",
                }}
              >
                📋 {gatherMode ? "Exit Gather Mode" : "Gather Mode"}
              </button>
              {gatherMode && gathered.size > 0 && (
                <button onClick={() => setGathered(new Set())} style={{
                  background: "none", border: "none", color: C.textDim, fontSize: "12px", cursor: "pointer",
                }}>
                  Clear checks
                </button>
              )}
            </div>

            {/* Gather progress bar */}
            {gatherMode && gatherTotal > 0 && (
              <div style={{ marginBottom: "20px" }}>
                <div style={{ height: "4px", background: C.borderLo, borderRadius: "2px", overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${(gatherChecked / gatherTotal) * 100}%`,
                    background: C.amber,
                    borderRadius: "2px",
                    transition: "width 0.2s ease",
                  }} />
                </div>
              </div>
            )}

            {/* Per-token sections */}
            {tokenResults.map(({ token, matches, totalMatches }) => {
              const allGathered = matches.length > 0 && matches.every(i => gathered.has(i.id));
              return (
                <div key={token} style={{
                  borderTop: `1px solid ${C.borderLo}`,
                  paddingTop: "16px", marginBottom: "16px",
                  opacity: (gatherMode && allGathered) ? 0.45 : 1,
                }}>
                  {/* Token header */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                    {gatherMode && (
                      <div style={{
                        width: "18px", height: "18px", flexShrink: 0,
                        border: `2px solid ${allGathered ? C.amber : C.border}`,
                        borderRadius: "4px",
                        background: allGathered ? C.amber + "30" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {allGathered && <span style={{ fontSize: "11px", color: C.amber }}>✓</span>}
                      </div>
                    )}
                    <span style={{ fontSize: "14px", fontWeight: 700, color: C.text }}>
                      {token}
                    </span>
                    {matches.length > 0 ? (
                      <span style={{ fontSize: "12px", color: C.textDim }}>
                        {totalMatches} match{totalMatches !== 1 ? "es" : ""}
                        {totalMatches > matches.length && ` (showing ${matches.length})`}
                      </span>
                    ) : (
                      <span style={{
                        fontSize: "11px", color: C.red,
                        background: C.red + "15", border: `1px solid ${C.red}30`,
                        borderRadius: "4px", padding: "1px 7px",
                      }}>
                        Not in inventory
                      </span>
                    )}
                  </div>

                  {/* Item rows */}
                  {matches.map(item => {
                    const isGathered = gathered.has(item.id);
                    const classColor = CLASS_COLORS[item.itemClass] ?? C.textDim;
                    const zone = item.currentZone !== "unknown" ? item.currentZone.replace(/-/g, " ") : "unknown location";
                    const container = item.containerId ? containers.find(c => c.id === item.containerId) : null;
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: "flex", alignItems: "center", gap: "12px",
                          padding: "9px 12px",
                          marginLeft: gatherMode ? "28px" : "0",
                          borderRadius: "7px",
                          background: isGathered ? C.bgInset : "transparent",
                          opacity: isGathered ? 0.5 : 1,
                          cursor: "pointer",
                        }}
                        onClick={() => gatherMode ? toggleGathered(item.id) : handleItemClick(item)}
                        onMouseEnter={e => { if (!isGathered) (e.currentTarget as HTMLDivElement).style.background = C.bgCard; }}
                        onMouseLeave={e => { if (!isGathered) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                      >
                        {/* Gather checkbox */}
                        {gatherMode && (
                          <div style={{
                            width: "18px", height: "18px", flexShrink: 0,
                            border: `2px solid ${isGathered ? C.amber : C.border}`,
                            borderRadius: "4px",
                            background: isGathered ? C.amber + "30" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {isGathered && <span style={{ fontSize: "11px", color: C.amber }}>✓</span>}
                          </div>
                        )}
                        {/* Class bar */}
                        {!gatherMode && (
                          <div style={{ width: "3px", height: "34px", borderRadius: "2px", background: classColor, flexShrink: 0 }} />
                        )}
                        {/* Name + location */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: "14px", fontWeight: 600, color: C.text,
                            textDecoration: isGathered ? "line-through" : "none",
                          }}>
                            {item.name}
                          </div>
                          <div style={{ fontSize: "12px", color: C.textDim, marginTop: "2px" }}>
                            {zone}
                            {container && <span style={{ color: C.textDim }}> · {container.name}</span>}
                            {item.brand && <span> · {item.brand}</span>}
                          </div>
                        </div>
                        {/* State badge */}
                        <span style={{
                          fontSize: "11px",
                          color: STATE_COLORS[item.lifecycleState] ?? C.textDim,
                          background: (STATE_COLORS[item.lifecycleState] ?? C.textDim) + "18",
                          border: `1px solid ${(STATE_COLORS[item.lifecycleState] ?? C.textDim)}30`,
                          borderRadius: "4px", padding: "2px 7px", flexShrink: 0,
                        }}>
                          {item.lifecycleState}
                        </span>
                      </div>
                    );
                  })}

                  {/* No match empty row */}
                  {matches.length === 0 && (
                    <div style={{
                      marginLeft: gatherMode ? "28px" : "0",
                      padding: "8px 12px",
                      fontSize: "13px", color: C.textDim, fontStyle: "italic",
                    }}>
                      No matching items — not in inventory yet.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (

          /* ── SINGLE SEARCH ──────────────────────────────────────────────────── */
          !hasAnySingleResults ? (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px", opacity: 0.25 }}>∅</div>
              <p style={{ color: C.textMid, fontSize: "15px", margin: 0 }}>
                Nothing found for <span style={{ color: C.text }}>"{query}"</span>
              </p>
              <p style={{ color: C.textDim, fontSize: "13px", margin: "8px 0 0" }}>
                Not in inventory yet.
              </p>
            </div>
          ) : (
            <div>
              {singleResults.items.length > 0 && (
                <ResultSection heading="Items" total={singleResults.itemTotal} shown={singleResults.items.length}
                  onShowAll={() => handleDrillFromSearch(chip === "ordered" ? "ordered" : chip === "repair" ? "needs-repair" : chip === "missing-photos" ? "missing-photos" : "all")}>
                  {singleResults.items.map(item => {
                    const classColor = CLASS_COLORS[item.itemClass] ?? C.textDim;
                    const stateColor = STATE_COLORS[item.lifecycleState] ?? C.textDim;
                    const zone = item.currentZone !== "unknown" ? item.currentZone.replace(/-/g, " ") : null;
                    return (
                      <ResultRow key={item.id} onClick={() => handleItemClick(item)}>
                        <div style={{ width: "3px", height: "36px", borderRadius: "2px", background: classColor, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: C.text }}>{item.name}</div>
                          <div style={{ fontSize: "12px", color: C.textDim, marginTop: "2px" }}>
                            {CLASS_LABELS[item.itemClass] ?? item.itemClass}
                            {zone && <span> · {zone}</span>}
                            {item.brand && <span> · {item.brand}</span>}
                          </div>
                        </div>
                        <span style={{ fontSize: "11px", color: stateColor, background: stateColor + "18", border: `1px solid ${stateColor}30`, borderRadius: "4px", padding: "2px 7px", flexShrink: 0 }}>
                          {item.lifecycleState}
                        </span>
                      </ResultRow>
                    );
                  })}
                </ResultSection>
              )}

              {singleResults.zones.length > 0 && (
                <ResultSection heading="Zones" total={singleResults.zoneTotal} shown={singleResults.zones.length}>
                  {singleResults.zones.map(zone => {
                    const zc = ZONE_COLORS[zone.id] ?? C.textDim;
                    const count = items.filter(i => i.currentZone === zone.id).length;
                    return (
                      <ResultRow key={zone.id} onClick={() => handleDrillFromSearch(`zone:${zone.id}`)}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "6px", background: zc + "20", border: `1px solid ${zc}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", flexShrink: 0 }}>🗺</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: C.text }}>{zone.name}</div>
                          <div style={{ fontSize: "12px", color: C.textDim, marginTop: "2px" }}>{zone.purpose}</div>
                        </div>
                        <span style={{ fontSize: "12px", color: zc, fontWeight: 700, flexShrink: 0 }}>{count} items</span>
                      </ResultRow>
                    );
                  })}
                </ResultSection>
              )}

              {singleResults.containers.length > 0 && (
                <ResultSection heading="Containers" total={singleResults.contTotal} shown={singleResults.containers.length}>
                  {singleResults.containers.map(container => {
                    const count = items.filter(i => i.containerId === container.id).length;
                    const zone = zones.find(z => z.id === container.zoneId);
                    return (
                      <ResultRow key={container.id} onClick={() => handleDrillFromSearch(`con:${container.id}`)}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "6px", background: container.color + "30", border: `1px solid ${container.color}50`, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: C.text }}>{container.name}</div>
                          <div style={{ fontSize: "12px", color: C.textDim, marginTop: "2px" }}>{zone?.name} · {container.description.slice(0, 60)}</div>
                        </div>
                        <span style={{ fontSize: "12px", color: C.textDim, fontWeight: 700, flexShrink: 0 }}>{count} items</span>
                      </ResultRow>
                    );
                  })}
                </ResultSection>
              )}

              {singleResults.collections.length > 0 && (
                <ResultSection heading="Collections" total={singleResults.collections.length} shown={singleResults.collections.length}>
                  {singleResults.collections.map(col => {
                    const count = items.filter(col.matchFn).length;
                    return (
                      <ResultRow key={col.id} onClick={() => handleDrillFromSearch(col.drillFilter)}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "6px", background: col.color + "20", border: `1px solid ${col.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>{col.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: C.text }}>{col.name}</div>
                          <div style={{ fontSize: "12px", color: C.textDim, marginTop: "2px" }}>{col.description}</div>
                        </div>
                        <span style={{ fontSize: "12px", color: col.color, fontWeight: 700, flexShrink: 0 }}>{count} items</span>
                      </ResultRow>
                    );
                  })}
                </ResultSection>
              )}
            </div>
          )
        )
      ) : (

        /* ── EMPTY STATE ──────────────────────────────────────────────────────── */
        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>

          {/* Recent Searches */}
          {recentSearches.length > 0 && (
            <section>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <Label>Recent Searches</Label>
                <button onClick={clearRecentSearches} style={{ background: "none", border: "none", color: C.textDim, fontSize: "12px", cursor: "pointer" }}>Clear</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {recentSearches.map(s => (
                  <button key={s} onClick={() => setQuery(s)} style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "9px 12px", background: "transparent", border: "none",
                    borderRadius: "6px", cursor: "pointer", textAlign: "left", width: "100%", color: C.textMid,
                  }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = C.bgCard; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: "13px", opacity: 0.4 }}>↩</span>
                    <span style={{ fontSize: "14px", flex: 1 }}>{s}</span>
                    <span style={{ fontSize: "11px", color: C.textDim }}>search again</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Life Inventory domain cards */}
          <section>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <Label>Life Inventory</Label>
              <span style={{ fontSize: "11px", color: C.textDim }}>click to browse</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "8px" }}>
              {lifeDomainCounts.map(({ d, count }) => (
                <button
                  key={d.id}
                  onClick={() => onDrillDown(d.drillFilter)}
                  style={{
                    background: C.bgCard,
                    border: `1px solid ${C.border}`,
                    borderTop: `3px solid ${d.color}`,
                    borderRadius: "8px",
                    padding: "12px 14px",
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex", flexDirection: "column", gap: "4px",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = d.color; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; (e.currentTarget as HTMLButtonElement).style.borderTopColor = d.color; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <span style={{ fontSize: "16px" }}>{d.icon}</span>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{d.label}</span>
                  </div>
                  <div style={{ fontSize: "11px", color: C.textDim, lineHeight: 1.4 }}>{d.desc}</div>
                  <div style={{ marginTop: "4px", fontSize: "13px", fontWeight: 700, color: count > 0 ? d.color : C.textDim }}>
                    {count} item{count !== 1 ? "s" : ""}
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Food Storage Summary card */}
          {foodSummary.itemCount > 0 && (
            <section>
              <Label>Food Storage</Label>
              <div style={{
                marginTop: "10px",
                background: "#191d11",
                border: "1px solid #7a8c4235",
                borderLeft: "3px solid #7a8c42",
                borderRadius: "8px",
                padding: "16px 18px",
              }}>
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "18px" }}>🥫</span>
                    <span style={{ fontSize: "15px", fontWeight: 700, color: C.text }}>Pantry Overview</span>
                  </div>
                  <button
                    onClick={() => onDrillDown("domain:food-storage")}
                    style={{ background: "none", border: "none", color: "#7a8c42", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                  >
                    Browse all →
                  </button>
                </div>

                {/* Stats row */}
                <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", marginBottom: "16px" }}>
                  <FoodStat value={String(foodSummary.itemCount)} label="total items" icon="📦" />
                  {foodSummary.totalCal > 0 && (
                    <FoodStat value={`~${(foodSummary.totalCal / 1000).toFixed(0)}k`} label="est. calories" icon="⚡" />
                  )}
                  {foodSummary.locations.length > 0 && (
                    <FoodStat value={String(foodSummary.locations.length)} label={foodSummary.locations.length === 1 ? "storage location" : "storage locations"} icon="🗄" />
                  )}
                </div>

                {/* Named category rows: Protein, Fruit, Vegetables, Soups */}
                {foodSummary.categories.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {foodSummary.categories.map(({ name, items: catItems }) => (
                      <div key={name}>
                        <div style={{
                          fontSize: "10px", fontWeight: 700, color: C.textDim,
                          textTransform: "uppercase", letterSpacing: "0.08em",
                          marginBottom: "4px",
                          display: "flex", alignItems: "center", gap: "6px",
                        }}>
                          <span>{FOOD_CATEGORY_ICONS[name] ?? "•"}</span>
                          <span>{FOOD_CATEGORY_LABELS[name] ?? name}</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                          {catItems.map(ci => (
                            <span key={ci.name} style={{
                              fontSize: "12px", color: C.textMid,
                              background: C.bgCard, border: `1px solid ${C.border}`,
                              borderRadius: "4px", padding: "2px 8px",
                            }}>
                              {ci.name}
                              {ci.qty > 1 && (
                                <span style={{ color: C.textDim, marginLeft: "4px" }}>
                                  ×{ci.qty}{ci.unit ? ` ${ci.unit}` : ""}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Storage locations */}
                {foodSummary.locations.length > 0 && (
                  <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${C.borderLo}` }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {foodSummary.locations.map(loc => (
                        <span key={loc} style={{
                          fontSize: "11px", color: C.textDim,
                          background: C.bgInset, border: `1px solid ${C.borderLo}`,
                          borderRadius: "4px", padding: "2px 8px",
                        }}>
                          🗄 {loc}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Continue Working (zones) */}
          {continueZones.length > 0 && (
            <section>
              <Label>Continue Working</Label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                {continueZones.map(({ zone, count, ts }) => {
                  const zc = ZONE_COLORS[zone.id] ?? C.textDim;
                  return (
                    <button key={zone.id} onClick={() => onDrillDown(`zone:${zone.id}`)} style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "9px 14px", background: C.bgCard,
                      border: `1px solid ${C.border}`, borderLeft: `3px solid ${zc}`,
                      borderRadius: "8px", cursor: "pointer", textAlign: "left",
                    }}>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{zone.name}</div>
                        <div style={{ fontSize: "11px", color: C.textDim, marginTop: "1px" }}>
                          {count} item{count !== 1 ? "s" : ""}{ts && <span> · {timeAgo(ts)}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Collections */}
          {activeCollections.length > 0 && (
            <section>
              <Label>Collections</Label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                {activeCollections.map(({ col, count, ts }) => (
                  <button key={col.id} onClick={() => onDrillDown(col.drillFilter)} style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "9px 14px", background: C.bgCard,
                    border: `1px solid ${C.border}`, borderTop: `2px solid ${col.color}`,
                    borderRadius: "8px", cursor: "pointer", textAlign: "left",
                  }}>
                    <span style={{ fontSize: "18px" }}>{col.icon}</span>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{col.name}</div>
                      <div style={{ fontSize: "11px", color: C.textDim, marginTop: "1px" }}>
                        {count} item{count !== 1 ? "s" : ""}{ts && <span> · {timeAgo(ts)}</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Needs Attention */}
          {attention.length > 0 && (
            <section>
              <Label>Needs Attention</Label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                {attention.map(a => (
                  <button
                    key={a.filter}
                    onClick={() => onDrillDown(a.filter)}
                    style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      padding: "8px 14px",
                      background: C.bgCard,
                      border: `1px solid ${a.color}40`,
                      borderLeft: `3px solid ${a.color}`,
                      borderRadius: "7px",
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: "14px" }}>{a.icon}</span>
                    <span style={{ fontSize: "15px", fontWeight: 800, color: a.color, fontVariantNumeric: "tabular-nums" }}>{a.count}</span>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: C.text }}>{a.label}</div>
                      <div style={{ fontSize: "11px", color: C.textDim }}>View →</div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {items.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px", opacity: 0.3 }}>📦</div>
              <p style={{ color: C.textMid, fontSize: "16px", margin: 0 }}>No items yet.</p>
              <p style={{ color: C.textDim, fontSize: "13px", margin: "8px 0 0" }}>Use + Add Item in the nav to get started.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const FOOD_CATEGORY_ICONS: Record<string, string> = {
  protein:    "🫘",
  fruit:      "🍑",
  vegetables: "🍅",
  soup:       "🍲",
  "dry-goods":"🌾",
  baking:     "🧁",
  grains:     "🌾",
  beans:      "🫘",
  tomatoes:   "🍅",
  other:      "📦",
};

const FOOD_CATEGORY_LABELS: Record<string, string> = {
  protein:    "Protein Sources",
  fruit:      "Fruit",
  vegetables: "Vegetables",
  soup:       "Soups",
  "dry-goods":"Dry Goods",
  baking:     "Baking",
  grains:     "Grains",
  beans:      "Beans",
  tomatoes:   "Tomatoes",
  other:      "Other",
};

function FoodStat({ value, label, icon, suffix = "" }: { value: string; label: string; icon: string; suffix?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
        <span style={{ fontSize: "22px", fontWeight: 800, color: "#7a8c42", lineHeight: 1 }}>{value}{suffix}</span>
      </div>
      <div style={{ fontSize: "11px", color: C.textDim }}>
        <span style={{ marginRight: "4px" }}>{icon}</span>{label}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "11px", fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.09em" }}>
      {children}
    </span>
  );
}

function ResultSection({ heading, total, shown, onShowAll, children }: {
  heading: string; total: number; shown: number; onShowAll?: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ borderTop: `1px solid ${C.borderLo}`, paddingTop: "18px", marginBottom: "18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <Label>{heading}</Label>
        {total > shown && onShowAll && (
          <button onClick={onShowAll} style={{ background: "none", border: "none", color: C.amber, fontSize: "12px", cursor: "pointer", fontWeight: 600 }}>
            Show all {total} →
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

function ResultRow({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: "14px", width: "100%", padding: "9px 10px", background: "transparent", border: "none", borderRadius: "7px", cursor: "pointer", textAlign: "left" }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = C.bgCard; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}
