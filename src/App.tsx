import { useState, useEffect } from "react";
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation, useParams } from "react-router-dom";
import type { InventoryItem } from "./types/inventory";
import type { PurchaseDraft } from "./types/purchase";
import type { ApproveAction } from "./lib/purchaseDrafts";
import { seedInventory } from "./data/inventory";
import { ZONES } from "./data/zones";
import { COLLECTIONS } from "./data/collections";
import { CONTAINERS } from "./data/containers";
import { supabase } from "./lib/supabase";
import * as db from "./lib/db";
import * as purchaseDb from "./lib/purchaseDrafts";
import { C } from "./styles";
import InventoryForm from "./components/InventoryForm";
import InventoryPage from "./components/InventoryPage";
import ZonePage from "./components/ZonePage";
import CollectionsPage from "./components/CollectionsPage";
import ItemDetailPanel from "./components/ItemDetailPanel";
import Dashboard from "./components/Dashboard";
import CommandBar from "./components/CommandBar";
import CapturePage from "./components/CapturePage";
import CapturedReviewQueue from "./components/CapturedReviewQueue";

// ── Routes ─────────────────────────────────────────────────────────────────
//
//   /                          Dashboard
//   /capture                   Capture (the front door — Capture→Analyzing→Confirm→Success)
//   /captured                  Saved-for-later drafts
//   /inventory                 Inventory browse
//   /items/:id                 Item detail — a modal *and* a real URL (see below)
//   /zones                     Zones
//   /collections               Kits & Collections
//
// /items/:id uses React Router's "background location" pattern: when you
// click an item from elsewhere in the app, we navigate to /items/:id but
// stash the page you were actually on in navigation state as
// `backgroundLocation`. Two <Routes> trees render off two different
// locations — the main one renders `backgroundLocation` (so whatever page
// you were on keeps rendering underneath), and a second one always renders
// the *real* location, matching /items/:id and layering the panel on top.
// Refreshing or pasting a bare /items/:id URL has no backgroundLocation in
// state, so the main tree falls back to rendering Inventory as a sensible
// background instead of nothing.

const navLinkStyle = (isActive: boolean): React.CSSProperties => ({
  background: isActive ? C.bgCard : "transparent",
  border: `1px solid ${isActive ? C.border : "transparent"}`,
  color: isActive ? C.text : C.textMid,
  borderRadius: "5px",
  padding: "6px 12px",
  fontSize: "13px",
  textDecoration: "none",
  display: "inline-block",
  fontWeight: isActive ? 700 : 400,
});

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const modalState = location.state as { backgroundLocation?: string } | null;

  const [items,       setItems]       = useState<InventoryItem[]>([]);
  const [dbLoading,   setDbLoading]   = useState(true);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [commandBarOpen, setCommandBarOpen] = useState(false);

  // ── Capture state ────────────────────────────────────────────────────────────
  const [purchaseDrafts, setPurchaseDrafts] = useState<PurchaseDraft[]>([]);
  const [sessionCaptureCount, setSessionCaptureCount] = useState(0);

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

  // ── Load pending purchase drafts from Supabase on mount ───────────────────
  useEffect(() => {
    async function loadPurchaseDrafts() {
      const fetched = await purchaseDb.fetchPendingDrafts();
      setPurchaseDrafts(fetched);
    }
    loadPurchaseDrafts();
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

  // "c" jumps straight to Capture — the front door should be one keystroke away.
  // Guarded so it never fires while typing anywhere else.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (!typing && !commandBarOpen && e.key === "c") {
        e.preventDefault();
        navigate("/capture");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandBarOpen]);

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
  }

  function handleDelete(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));  // optimistic
    db.deleteItem(id);                               // sync to DB
    closeItemModal();
  }

  async function handleReset() {
    if (window.confirm(
      `Reset to seed data?\n\nThis will delete all ${items.length} items and restore the original seed items. Export a backup first if needed.`
    )) {
      setItems(seedInventory);
      setEditingItem(null);
      if (location.pathname.startsWith("/items/")) closeItemModal();
      await db.deleteAllItems();
      await db.upsertItems(seedInventory);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  function handleEdit(item: InventoryItem) {
    setEditingItem(item);
    closeItemModal();
  }

  // Closes the /items/:id overlay — returns to whatever page it was opened
  // from (backgroundLocation), or to Inventory if there was none (a direct
  // page-load / refresh of the item URL).
  function closeItemModal() {
    navigate(modalState?.backgroundLocation ?? "/inventory");
  }

  // Shared "open this item" handler — used by Dashboard, Zones, Inventory,
  // and the command bar alike. Preserves whatever page you were on as the
  // background behind the panel.
  function handleItemClick(item: InventoryItem) {
    navigate(`/items/${item.id}`, { state: { backgroundLocation: location.pathname + location.search } });
  }

  // Dashboard drill-down: navigate to inventory with a specific filter applied
  function handleDrillDown(filter: string) {
    navigate("/inventory", { state: { applyFilter: filter } });
  }

  // Command bar: selecting an item opens its detail panel
  function handleCommandBarSelectItem(item: InventoryItem) {
    setCommandBarOpen(false);
    navigate(`/items/${item.id}`, { state: { backgroundLocation: location.pathname + location.search } });
  }

  // Command bar: selecting a zone or container applies a filter
  function handleCommandBarFilter(filter: string) {
    setCommandBarOpen(false);
    navigate("/inventory", { state: { applyFilter: filter } });
  }

  function handleAddItem() {
    navigate("/inventory", { state: { applyFilter: "all" } });
  }

  // ── Capture handlers ──────────────────────────────────────────────────────
  // The Capture screen itself runs the full Capture → Analyzing → Confirm →
  // Success flow inline (see CapturePage) — it never navigates away mid-flow.
  // This just keeps App's shared state (the drafts list, the session tally)
  // in sync as that flow produces a draft.

  function handleCaptured(drafts: PurchaseDraft[]) {
    setPurchaseDrafts(prev => [...drafts, ...prev]);
    setSessionCaptureCount(n => n + drafts.length);
  }

  // Returns a result instead of alerting, so callers (like the Capture flow's
  // Confirmation phase) can show the outcome inline and calmly, rather than
  // via a jarring window.alert.
  async function handleApprovePurchaseDraft(
    draft: PurchaseDraft, action: ApproveAction
  ): Promise<{ ok: true; item: InventoryItem } | { ok: false; error: string }> {
    const result = await purchaseDb.approveDraft(draft, action);
    if ("error" in result) return { ok: false, error: result.error };

    setItems(prev =>
      action.kind === "merge"
        ? prev.map(i => (i.id === result.item.id ? result.item : i))
        : [...prev, result.item]
    );
    setPurchaseDrafts(prev =>
      prev.map(d => (d.id === draft.id ? { ...d, status: "approved", resolvedItemId: result.item.id } : d))
    );
    return { ok: true, item: result.item };
  }

  // Success phase's "See it in Inventory" link.
  function handleViewItem(item: InventoryItem) {
    navigate(`/items/${item.id}`, { state: { backgroundLocation: "/inventory" } });
  }

  function handleRejectPurchaseDraft(draftId: string) {
    setPurchaseDrafts(prev => prev.map(d => (d.id === draftId ? { ...d, status: "rejected" } : d)));
    purchaseDb.rejectDraft(draftId);   // fire and forget — non-destructive status change
  }

  function handleSaveDraftForLater(draftId: string) {
    setPurchaseDrafts(prev => prev.map(d => (d.id === draftId ? { ...d, status: "saved-for-later" } : d)));
    purchaseDb.saveDraftForLater(draftId);
  }

  function handleUpdatePurchaseDraft(draftId: string, patch: Partial<PurchaseDraft>) {
    setPurchaseDrafts(prev => prev.map(d => (d.id === draftId ? { ...d, ...patch } : d)));
    purchaseDb.updateDraft(draftId, patch);
  }

  const pendingPurchaseDraftCount = purchaseDrafts.filter(
    d => d.status === "pending" || d.status === "saved-for-later"
  ).length;

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
            {/* Capture — the front door. Always the first, boldest thing in the header. */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                onClick={() => navigate("/capture")}
                title="Capture (press C)"
                style={{
                  background: location.pathname === "/capture" ? "#d89a30" : C.amber,
                  border: "none",
                  color: "#1c1a17",
                  borderRadius: "7px",
                  padding: "9px 16px",
                  fontSize: "13px",
                  fontWeight: 800,
                  cursor: "pointer",
                  boxShadow: `0 2px 10px ${C.amber}35`,
                }}
              >
                ⚡ Capture
              </button>
              {pendingPurchaseDraftCount > 0 && (
                <button
                  onClick={() => navigate("/captured")}
                  style={{
                    background: "transparent",
                    border: `1px solid ${C.amber}50`,
                    color: C.amber,
                    borderRadius: "20px",
                    padding: "5px 12px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {pendingPurchaseDraftCount} waiting →
                </button>
              )}
            </div>

            {/* Nav tabs */}
            <nav style={{
              display: "flex", gap: "3px",
              background: C.bgInset,
              border: `1px solid ${C.border}`,
              borderRadius: "7px",
              padding: "4px",
            }}>
              {[
                { path: "/", label: "Dashboard", end: true },
                { path: "/inventory", label: "Inventory", end: false },
                { path: "/zones", label: "Zones", end: false },
                { path: "/collections", label: "Kits & Collections", end: false },
              ].map((v) => (
                <NavLink key={v.path} to={v.path} end={v.end} style={({ isActive }) => navLinkStyle(isActive)}>
                  {v.label}
                </NavLink>
              ))}
            </nav>

            {/* Add item — manual entry */}
            <button
              onClick={handleAddItem}
              style={{
                background: C.amber, border: "none",
                color: "#1c1a17", padding: "8px 12px",
                borderRadius: "6px",
                fontSize: "13px", fontWeight: 700, cursor: "pointer",
              }}
            >
              + Add Item
            </button>
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
        {dbLoading ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: C.textDim, fontSize: "13px" }}>
            Loading inventory…
          </div>
        ) : (
          <Routes location={modalState?.backgroundLocation ?? location}>
            <Route path="/" element={<Dashboard items={items} zones={ZONES} containers={CONTAINERS} onItemClick={handleItemClick} onDrillDown={handleDrillDown} />} />
            <Route path="/inventory" element={<InventoryPage items={items} onAdd={handleAdd} onItemClick={handleItemClick} />} />
            {/* Direct-load fallback: /items/:id with no backgroundLocation renders Inventory underneath */}
            <Route path="/items/:id" element={<InventoryPage items={items} onAdd={handleAdd} onItemClick={handleItemClick} />} />
            <Route path="/zones" element={<ZonePage items={items} onItemClick={handleItemClick} />} />
            <Route path="/collections" element={<CollectionsPage items={items} />} />
            <Route
              path="/capture"
              element={
                <CapturePage
                  items={items}
                  collections={COLLECTIONS}
                  sessionCaptureCount={sessionCaptureCount}
                  onCaptured={handleCaptured}
                  onApprove={handleApprovePurchaseDraft}
                  onSaveForLater={handleSaveDraftForLater}
                  onReject={handleRejectPurchaseDraft}
                  onViewItem={handleViewItem}
                  onCancel={() => navigate("/")}
                />
              }
            />
            <Route
              path="/captured"
              element={
                <CapturedReviewQueue
                  drafts={purchaseDrafts}
                  items={items}
                  onApprove={handleApprovePurchaseDraft}
                  onReject={handleRejectPurchaseDraft}
                  onSaveForLater={handleSaveDraftForLater}
                  onUpdateDraft={handleUpdatePurchaseDraft}
                  onBack={() => navigate("/")}
                  onGoToCapture={() => navigate("/capture")}
                />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>

      {/* Item detail modal — a second Routes tree that always matches the
          *real* URL, layered on top of whichever background Routes above
          rendered. See the routing note at the top of this file. */}
      {!dbLoading && (
        <Routes>
          <Route path="/items/:id" element={<ItemDetailModalRoute items={items} onEdit={handleEdit} onDelete={handleDelete} />} />
        </Routes>
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

// ── Route-param wrapper components ────────────────────────────────────────────

function ItemDetailModalRoute({
  items, onEdit, onDelete,
}: {
  items: InventoryItem[];
  onEdit: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
}) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const item = items.find((i) => i.id === id);
  if (!item) return null; // items still loading, or the id doesn't exist

  const state = location.state as { backgroundLocation?: string } | null;
  function handleClose() {
    navigate(state?.backgroundLocation ?? "/inventory");
  }

  return <ItemDetailPanel item={item} onClose={handleClose} onEdit={onEdit} onDelete={onDelete} />;
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
