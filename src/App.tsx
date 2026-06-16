import { useState, useMemo, useEffect, useRef } from "react";
import type { InventoryItem, ZoneId, ItemClass, InventoryDomain } from "./types/inventory";
import type { ImportBatch, ImportDraftItem } from "./types/import";
import { seedInventory } from "./data/inventory";
import { ZONES } from "./data/zones";
import { COLLECTIONS } from "./data/collections";
import { CONTAINERS } from "./data/containers";
import { loadBatches, saveBatches, loadDrafts, saveDrafts } from "./data/importStorage";
import { supabase } from "./lib/supabase";
import * as db from "./lib/db";
import { C } from "./styles";
import InventoryCard from "./components/InventoryCard";
import InventoryForm from "./components/InventoryForm";
import ZonePage from "./components/ZonePage";
import CollectionsPage from "./components/CollectionsPage";
import ItemDetailPanel from "./components/ItemDetailPanel";
import Dashboard from "./components/Dashboard";
import CommandBar from "./components/CommandBar";
import BulkImportPage from "./components/BulkImportPage";
import ImportReviewQueue from "./components/ImportReviewQueue";

// localStorage key kept only for the import batch/draft persistence (not inventory items)


type View = "dashboard" | "inventory" | "zones" | "collections" | "bulk-import" | "import-review";

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
  { id: "domain:food-storage" as FilterId,       label: "Food Storage" },
  { id: "domain:kitchen-preserving" as FilterId, label: "Kitchen / Preserving" },
  { id: "domain:garden" as FilterId,             label: "Garden" },
  { id: "domain:pool" as FilterId,               label: "Pool" },
  { id: "domain:vehicle" as FilterId,            label: "Vehicle" },
  { id: "domain:household" as FilterId,          label: "Household" },
  { id: "domain:project" as FilterId,            label: "Projects" },
];

const FILTER_GROUPS: { heading: string; filters: { id: FilterId; label: string }[] }[] = [
  {
    heading: "Domain",
    filters: DOMAIN_FILTERS,
  },
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
  {
    heading: "Collection",
    filters: COLLECTIONS.map((c) => ({ id: `col:${c.id}` as FilterId, label: c.name })),
  },
  {
    heading: "Container",
    filters: CONTAINERS.map((c) => ({ id: `con:${c.id}` as FilterId, label: c.name })),
  },
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

// Categorize a filter ID so AND-across-categories / OR-within logic works
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
  // Group by category
  const groups = new Map<FilterCat, FilterId[]>();
  for (const f of filters) {
    const cat = getFilterCat(f);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(f);
  }
  return items.filter(item =>
    [...groups.entries()].every(([cat, catFilters]) =>
      catFilters.some(f => {
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
      })
    )
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


function exportJSON(items: InventoryItem[]) {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventory-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}


const menuItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "10px",
  padding: "10px 14px", background: "transparent",
  border: "none", width: "100%", textAlign: "left",
  cursor: "pointer", transition: "background 0.1s",
};

export default function App() {
  const [items,       setItems]       = useState<InventoryItem[]>([]);
  const [dbLoading,   setDbLoading]   = useState(true);
  const [view,        setView]        = useState<View>("dashboard");
  const [activeFilters, setActiveFilters] = useState<FilterId[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [commandBarOpen, setCommandBarOpen] = useState(false);

  // ── Import state ──────────────────────────────────────────────────────────
  const [importBatches, setImportBatches] = useState<ImportBatch[]>(() => loadBatches());
  const [importDrafts, setImportDrafts]   = useState<ImportDraftItem[]>(() => loadDrafts());
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu]     = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  function toggleFilter(f: FilterId) {
    if (f === "all") { setActiveFilters([]); return; }
    setActiveFilters(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  }

  // ── Load items from Supabase on mount ─────────────────────────────────────
  useEffect(() => {
    async function loadItems() {
      setDbLoading(true);
      const fetched = await db.fetchItems();
      if (fetched.length === 0) {
        // First-time setup: seed the database with initial inventory
        console.info("[ELK] Empty database — seeding with initial inventory…");
        await db.upsertItems(seedInventory);
        setItems(seedInventory);
      } else {
        // Auto-merge: inject any new seed items whose IDs are not yet in the DB
        const existingIds = new Set(fetched.map(i => i.id));
        const missing = seedInventory.filter(i => !existingIds.has(i.id));
        if (missing.length > 0) {
          await db.upsertItems(missing);
          setItems([...fetched, ...missing]);
        } else {
          setItems(fetched);
        }
      }
      setDbLoading(false);
    }
    loadItems();
  }, []);

  useEffect(() => { saveBatches(importBatches); }, [importBatches]);
  useEffect(() => { saveDrafts(importDrafts);   }, [importDrafts]);

  // Close add-menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // CMD+K global shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandBarOpen(open => !open);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const searched = useMemo(() => searchItems(items, searchQuery), [items, searchQuery]);
  const filtered = useMemo(() => applyFilters(searched, activeFilters), [searched, activeFilters]);

  function handleAdd(item: InventoryItem) {
    const now = new Date().toISOString();
    const newItem = { ...item, createdAt: now, updatedAt: now };
    setItems((prev) => [...prev, newItem]);         // optimistic
    db.createItem(newItem);                          // sync to DB (fire and forget)
  }

  function handleUpdate(updated: InventoryItem) {
    const patched = { ...updated, updatedAt: new Date().toISOString() };
    setItems((prev) => prev.map((i) => i.id === updated.id ? patched : i));  // optimistic
    db.updateItem(patched);                          // sync to DB
    setEditingItem(null);
    setSelectedItem(null);
  }

  function handleDelete(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));  // optimistic
    db.deleteItem(id);                               // sync to DB
    setSelectedItem(null);
  }

  async function handleReset() {
    if (window.confirm(
      `Reset to seed data?\n\nThis will delete all ${items.length} items and restore the original seed items. Export a backup first if needed.`
    )) {
      setItems(seedInventory);
      setSelectedItem(null);
      setEditingItem(null);
      await db.deleteAllItems();
      await db.upsertItems(seedInventory);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  function handleEdit(item: InventoryItem) {
    setSelectedItem(null);
    setEditingItem(item);
  }

  // Dashboard drill-down: navigate to inventory with a specific filter applied
  function handleDrillDown(filter: string) {
    setView("inventory");
    setActiveFilters(filter && filter !== "all" ? [filter as FilterId] : []);
    setSearchQuery("");
  }

  // Command bar: selecting an item opens its detail panel
  function handleCommandBarSelectItem(item: InventoryItem) {
    setCommandBarOpen(false);
    setView("inventory");
    setSelectedItem(item);
    setActiveFilters([]);
    setSearchQuery("");
  }

  // Command bar: selecting a zone or container applies a filter
  function handleCommandBarFilter(filter: string) {
    setCommandBarOpen(false);
    setView("inventory");
    setActiveFilters(filter && filter !== "all" ? [filter as FilterId] : []);
    setSearchQuery("");
  }

  function handleAddItem() {
    setView("inventory");
    setActiveFilters([]);
  }

  // ── Bulk import handlers ──────────────────────────────────────────────────

  function handleBatchCreated(batch: ImportBatch, drafts: ImportDraftItem[]) {
    setImportBatches(prev => [...prev, batch]);
    setImportDrafts(prev => [...prev, ...drafts]);
    setActiveBatchId(batch.id);
    setView("import-review");
  }

  function handleApproveDraft(draftId: string) {
    const draft = importDrafts.find(d => d.id === draftId);
    if (!draft) return;

    const now = new Date().toISOString();
    const newItem: InventoryItem = {
      id: crypto.randomUUID(),
      name: draft.suggestedName,
      itemClass: draft.itemClass as ItemClass,
      domain: draft.domain as InventoryDomain | undefined,
      lifecycleState: "available",
      currentZone: (draft.zone as ZoneId) || "unknown",
      recommendedZone: (draft.zone as ZoneId) || "unknown",
      locationDetail: "",
      collectionId: null,
      containerId: draft.container,
      project: null,
      tags: [],
      quantity: draft.quantity,
      photoPath: draft.sourcePhotoUrl,   // preserves source photo reference
      photoType: "inventory",
      notes: draft.notes,
      attributes: {},
      createdAt: now,
      updatedAt: now,
    };

    const updatedItems = [...items, newItem];
    setItems(updatedItems);
    db.createItem(newItem);   // sync to DB

    const updatedDrafts = importDrafts.map(d =>
      d.id === draftId ? { ...d, status: "approved" as const, createdItemId: newItem.id } : d
    );
    setImportDrafts(updatedDrafts);
    syncBatchCounts(draft.batchId, updatedDrafts);
  }

  function handleRejectDraft(draftId: string) {
    const draft = importDrafts.find(d => d.id === draftId);
    if (!draft) return;
    const updatedDrafts = importDrafts.map(d =>
      d.id === draftId ? { ...d, status: "rejected" as const } : d
    );
    setImportDrafts(updatedDrafts);
    syncBatchCounts(draft.batchId, updatedDrafts);
  }

  function handleUpdateDraft(updated: ImportDraftItem) {
    setImportDrafts(prev => prev.map(d => d.id === updated.id ? updated : d));
  }

  function syncBatchCounts(batchId: string, currentDrafts: ImportDraftItem[]) {
    const bd = currentDrafts.filter(d => d.batchId === batchId);
    const approvedCount = bd.filter(d => d.status === "approved").length;
    const rejectedCount = bd.filter(d => d.status === "rejected").length;
    const allDone = approvedCount + rejectedCount === bd.length;
    setImportBatches(prev => prev.map(b =>
      b.id === batchId
        ? { ...b, approvedCount, rejectedCount, status: allDone ? "completed" : "ready-for-review" }
        : b
    ));
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      color: C.text,
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: "16px",
      paddingBottom: "80px",
    }}>
      {/* Header */}
      <header style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "16px 28px",
        maxWidth: "1200px",
        margin: "0 auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 800, letterSpacing: "-0.01em", color: C.text }}>
              ELK
            </h1>
            <p style={{ margin: "2px 0 0", color: C.textDim, fontSize: "12px" }}>
              Reduce friction. Increase capability. Create calm.
            </p>
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Nav tabs */}
            <nav style={{
              display: "flex", gap: "3px",
              background: C.bgInset,
              border: `1px solid ${C.border}`,
              borderRadius: "7px",
              padding: "4px",
            }}>
              {([
                { id: "dashboard", label: "Dashboard" },
                { id: "inventory", label: "Inventory" },
                { id: "zones",     label: "Zones" },
                { id: "collections", label: "Kits & Collections" },
              ] as { id: View; label: string }[]).map((v) => (
                <button key={v.id} onClick={() => setView(v.id)} style={{
                  background: view === v.id ? C.bgCard : "transparent",
                  border: `1px solid ${view === v.id ? C.border : "transparent"}`,
                  color: view === v.id ? C.text : C.textMid,
                  borderRadius: "5px",
                  padding: "6px 12px",
                  fontSize: "13px",
                  cursor: "pointer",
                  fontWeight: view === v.id ? 700 : 400,
                }}>
                  {v.label}
                </button>
              ))}
            </nav>

            {/* Add item — split button (single | bulk import) */}
            <div ref={addMenuRef} style={{ position: "relative" }}>
              <div style={{ display: "flex", borderRadius: "6px", overflow: "hidden" }}>
                <button
                  onClick={handleAddItem}
                  style={{
                    background: C.amber, border: "none",
                    color: "#1c1a17", padding: "8px 12px",
                    fontSize: "13px", fontWeight: 700, cursor: "pointer",
                    borderRight: "1px solid #c48c2860",
                  }}
                >
                  + Add Item
                </button>
                <button
                  onClick={() => setShowAddMenu(v => !v)}
                  title="Bulk photo import"
                  style={{
                    background: C.amber, border: "none",
                    color: "#1c1a17", padding: "8px 10px",
                    fontSize: "11px", cursor: "pointer",
                  }}
                >
                  📸
                </button>
              </div>
              {showAddMenu && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0,
                  background: C.bgCard, border: `1px solid ${C.border}`,
                  borderRadius: "8px", boxShadow: "0 6px 24px #0008",
                  minWidth: "200px", overflow: "hidden", zIndex: 200,
                }}>
                  <button
                    onClick={() => { setShowAddMenu(false); handleAddItem(); }}
                    style={menuItemStyle}
                  >
                    <span style={{ fontSize: "15px" }}>➕</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "13px", color: C.text }}>Add Single Item</div>
                      <div style={{ fontSize: "11px", color: C.textDim }}>Fill in details manually</div>
                    </div>
                  </button>
                  <div style={{ height: "1px", background: C.border }} />
                  <button
                    onClick={() => { setShowAddMenu(false); setView("bulk-import"); }}
                    style={menuItemStyle}
                  >
                    <span style={{ fontSize: "15px" }}>📸</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "13px", color: C.text }}>Bulk Photo Import</div>
                      <div style={{ fontSize: "11px", color: C.textDim }}>Upload photos → review drafts</div>
                    </div>
                  </button>
                  {importBatches.some(b => b.status !== "completed") && (
                    <>
                      <div style={{ height: "1px", background: C.border }} />
                      <button
                        onClick={() => {
                          setShowAddMenu(false);
                          const pending = importBatches.find(b => b.status !== "completed");
                          if (pending) { setActiveBatchId(pending.id); setView("import-review"); }
                        }}
                        style={menuItemStyle}
                      >
                        <span style={{ fontSize: "15px" }}>📋</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "13px", color: C.amber }}>Review Queue</div>
                          <div style={{ fontSize: "11px", color: C.textDim }}>
                            {importBatches.filter(b => b.status !== "completed").reduce((n, b) => n + (b.totalDrafts - b.approvedCount - b.rejectedCount), 0)} pending draft{importBatches.filter(b => b.status !== "completed").reduce((n, b) => n + (b.totalDrafts - b.approvedCount - b.rejectedCount), 0) !== 1 ? "s" : ""}
                          </div>
                        </div>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            <button onClick={() => exportJSON(items)} style={{
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.textMid,
              borderRadius: "6px",
              padding: "7px 12px",
              fontSize: "13px",
              cursor: "pointer",
            }}>
              Export
            </button>
            <button onClick={handleReset} title="Reset to seed data" style={{
              background: "transparent",
              border: `1px solid ${C.red}44`,
              color: C.textDim,
              borderRadius: "6px",
              padding: "7px 10px",
              fontSize: "12px",
              cursor: "pointer",
            }}>
              Reset
            </button>
            <button onClick={handleSignOut} title="Sign out" style={{
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.textDim,
              borderRadius: "6px",
              padding: "7px 10px",
              fontSize: "12px",
              cursor: "pointer",
            }}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 28px 0" }}>

        {/* ── DB loading state ── */}
        {dbLoading && (
          <div style={{ textAlign: "center", padding: "80px 0", color: C.textDim, fontSize: "13px" }}>
            Loading inventory…
          </div>
        )}

        {/* ── Views (only rendered after DB load) ── */}

        {/* ── Bulk photo import ── */}
        {!dbLoading && view === "bulk-import" && (
          <BulkImportPage
            onBatchCreated={handleBatchCreated}
            onCancel={() => setView("inventory")}
          />
        )}

        {/* ── Import review queue ── */}
        {!dbLoading && view === "import-review" && activeBatchId && (() => {
          const batch = importBatches.find(b => b.id === activeBatchId);
          return batch ? (
            <ImportReviewQueue
              batch={batch}
              drafts={importDrafts}
              onApprove={handleApproveDraft}
              onReject={handleRejectDraft}
              onUpdate={handleUpdateDraft}
              onBack={() => setView("bulk-import")}
              onGoToInventory={() => { setView("inventory"); setActiveFilters([]); }}
            />
          ) : null;
        })()}

        {/* ── Dashboard ── */}
        {!dbLoading && view === "dashboard" && (
          <Dashboard
            items={items}
            zones={ZONES}
            containers={CONTAINERS}
            onItemClick={setSelectedItem}
            onDrillDown={handleDrillDown}
          />
        )}

        {/* ── Zones ── */}
        {!dbLoading && view === "zones" && (
          <ZonePage items={items} onItemClick={setSelectedItem} />
        )}

        {/* ── Collections ── */}
        {!dbLoading && view === "collections" && (
          <CollectionsPage items={items} />
        )}

        {/* ── Inventory browse ── */}
        {!dbLoading && view === "inventory" && (
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
                {activeFilters.map(f => (
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
                onFocus={e => { e.currentTarget.style.borderColor = C.amber; }}
                onBlur={e => { if (!searchQuery) e.currentTarget.style.borderColor = C.border; }}
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

            <InventoryForm onAdd={handleAdd} />

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
                  <InventoryCard key={item.id} item={item} onClick={setSelectedItem} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Item detail panel */}
      {selectedItem && (
        <ItemDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      {/* Edit form — modal overlay */}
      {editingItem && (
        <InventoryForm
          key={editingItem.id}
          editItem={editingItem}
          onUpdate={handleUpdate}
          onCancelEdit={() => setEditingItem(null)}
        />
      )}

      {/* Command Bar */}
      <CommandBar
        isOpen={commandBarOpen}
        onClose={() => setCommandBarOpen(false)}
        items={items}
        zones={ZONES}
        containers={CONTAINERS}
        onSelectItem={handleCommandBarSelectItem}
        onFilterSelect={handleCommandBarFilter}
      />
    </div>
  );
}
