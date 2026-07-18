import { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryItem, ItemClass, InventoryDomain, ZoneId, Collection } from "../types/inventory";
import type { PurchaseDraft } from "../types/purchase";
import type { ApproveAction } from "../lib/purchaseDrafts";
import { extractInventoryDrafts, extractInventoryDraftsFromImage } from "../lib/purchaseParser";
import { createDrafts } from "../lib/purchaseDrafts";
import { findPossibleDuplicates } from "../lib/duplicateDetector";
import { ZONES } from "../data/zones";
import { COLLECTIONS } from "../data/collections";
import { C, ZONE_COLORS } from "../styles";

// ── The whole front door, one contained flow ──────────────────────────────────
// Capture → Analyzing → Confirm → Success, all in this one screen. It never
// navigates away mid-flow. A single paste can now contain many products (an
// entire Amazon order-history paste, for example) — Confirm renders one
// evidence-first card per detected product, with both an "Approve All" bulk
// action and full per-card control. The phase graph itself is unchanged from
// before; only what Confirm can hold (one item vs. many) is new. See
// docs/purchase-intake-v1-spec.md for the original single-item design, and
// src/lib/purchaseParser.ts / captureAdapters.ts / captureNormalize.ts for the
// Raw Text → Normalization → Product Detection → Inventory Drafts pipeline
// that feeds this screen.

type Phase = "capture" | "analyzing" | "confirm" | "success";
const PHASES: Phase[] = ["capture", "analyzing", "confirm", "success"];

type ApproveResult = { ok: true; item: InventoryItem } | { ok: false; error: string };

interface Props {
  items: InventoryItem[];
  collections: Collection[];
  sessionCaptureCount: number;
  onCaptured: (drafts: PurchaseDraft[]) => void;
  onApprove: (draft: PurchaseDraft, action: ApproveAction) => Promise<ApproveResult>;
  onSaveForLater: (draftId: string) => void;
  onReject: (draftId: string) => void;
  onViewItem: (item: InventoryItem) => void;
  onCancel: () => void;
}

const EXAMPLES: { label: string; text: string }[] = [
  { label: "Amazon title", text: "Ryobi 18V ONE+ Cordless Hand Vacuum — Qty: 1 — $39.99" },
  { label: "Product link", text: "https://www.amazon.com/dp/B08XYZ123-torque-wrench-3-8-drive" },
  { label: "Quick note", text: "need more zip ties for the garden wiring" },
];

// Shown as inspiration for where Capture is headed — none of these are wired up.
// Photo used to be here too — it's real now (see PhotoSourceControls).
const FUTURE_SOURCES: { icon: string; label: string }[] = [
  { icon: "🧾", label: "Receipt" },
  { icon: "🎙️", label: "Voice" },
  { icon: "🎥", label: "Video" },
  { icon: "🧩", label: "Browser Extension" },
];

// Real day-to-day usage showed the desktop/mobile distinction matters: a
// desktop browser can never actually open a camera (the `capture` attribute
// is simply ignored), so labeling that button "Take a Photo" there was
// misleading. Only offer the camera-opening button where it can really work.
const IS_MOBILE =
  typeof navigator !== "undefined" &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent)));

function fileToBase64(file: File): Promise<{ dataUrl: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      resolve({ dataUrl, base64 });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const ITEM_CLASSES: { value: ItemClass; label: string }[] = [
  { value: "tool", label: "Tool" },
  { value: "material", label: "Material" },
  { value: "equipment", label: "Equipment" },
  { value: "project-asset", label: "Project Asset" },
  { value: "installed-asset", label: "Installed Asset" },
  { value: "surplus", label: "Surplus" },
];

const DOMAINS: { value: InventoryDomain; label: string }[] = [
  { value: "workshop", label: "Workshop" },
  { value: "electronics", label: "Electronics" },
  { value: "food-storage", label: "Food Storage" },
  { value: "kitchen-preserving", label: "Kitchen / Preserving" },
  { value: "garden", label: "Garden" },
  { value: "pool", label: "Pool" },
  { value: "vehicle", label: "Vehicle" },
  { value: "household", label: "Household" },
  { value: "project", label: "Project" },
  { value: "unknown", label: "Other / Unknown" },
];

const BASE_ANALYZING_MS = 700;
const PER_PRODUCT_ANALYZING_MS = 90;
const MAX_ANALYZING_MS = 1800;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Per-card editable state ───────────────────────────────────────────────────

type ConfirmItemStatus = "pending" | "approving" | "done" | "error";

interface ConfirmItem {
  draft: PurchaseDraft;
  name: string;
  quantity: number;
  brand: string;
  vendor: string;
  price: string;
  purchaseDate: string;
  productUrl: string;
  model: string;
  category: string;
  itemClass: ItemClass;
  domain: InventoryDomain;
  zone: ZoneId;
  collectionId: string;
  project: string;
  showMore: boolean;
  status: ConfirmItemStatus;
  error: string | null;
  outcome: "added" | "updated" | "saved" | "discarded" | null;
  resolvedItem: InventoryItem | null;
}

function draftToConfirmItem(draft: PurchaseDraft): ConfirmItem {
  return {
    draft,
    name: draft.suggestedName?.trim() || draft.rawText.split("\n")[0].slice(0, 80),
    quantity: draft.suggestedQuantity ?? 1,
    brand: draft.suggestedBrand ?? "",
    vendor: draft.suggestedVendor ?? "",
    price: draft.suggestedPrice != null ? String(draft.suggestedPrice) : "",
    purchaseDate: draft.suggestedPurchaseDate ?? "",
    productUrl: draft.productUrl ?? "",
    model: draft.suggestedModel ?? "",
    category: draft.suggestedCategory ?? "",
    itemClass: "material",
    domain: "unknown",
    zone: "unknown",
    collectionId: draft.suggestedCollectionId ?? "",
    project: draft.suggestedProject ?? "",
    showMore: false,
    status: "pending",
    error: null,
    outcome: null,
    resolvedItem: null,
  };
}

export default function CapturePage({
  items, collections, sessionCaptureCount, onCaptured, onApprove, onSaveForLater, onReject, onViewItem, onCancel,
}: Props) {
  const [phase, setPhase] = useState<Phase>("capture");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Capture phase state ──────────────────────────────────────────────────
  const [text, setText] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturedImagePreview, setCapturedImagePreview] = useState<string | null>(null);

  // ── Confirm phase: one entry per detected product ────────────────────────
  const [confirmItems, setConfirmItems] = useState<ConfirmItem[]>([]);
  const [batchApproving, setBatchApproving] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  // ── Success phase state ──────────────────────────────────────────────────
  const [successItems, setSuccessItems] = useState<InventoryItem[]>([]);

  useEffect(() => {
    if (phase === "capture") textareaRef.current?.focus();
  }, [phase]);

  // Success auto-returns to a fresh Capture after a beat — but never traps you here.
  useEffect(() => {
    if (phase !== "success") return;
    const t = setTimeout(() => resetToCapture(), 2400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const pendingItems = confirmItems.filter((i) => i.status === "pending" || i.status === "error");

  function resetToCapture() {
    setPhase("capture");
    setText("");
    setCaptureError(null);
    setCapturedImagePreview(null);
    setConfirmItems([]);
    setBatchApproving(false);
    setBatchProgress(null);
    setSuccessItems([]);
  }

  function updateItem(draftId: string, patch: Partial<ConfirmItem>) {
    setConfirmItems((prev) => prev.map((i) => (i.draft.id === draftId ? { ...i, ...patch } : i)));
  }

  // Once every card in the batch has been resolved one way or another, either
  // celebrate what actually got added, or — if everything was discarded /
  // saved for later — just go back to a fresh Capture with no false fanfare.
  function checkForCompletion(all: ConfirmItem[]) {
    if (all.some((i) => i.status === "pending" || i.status === "approving")) return;
    const added = all.filter((i) => i.resolvedItem).map((i) => i.resolvedItem as InventoryItem);
    if (added.length > 0) {
      setSuccessItems(added);
      setPhase("success");
    } else {
      resetToCapture();
    }
  }

  async function handleCapture() {
    const raw = text.trim();
    if (!raw || phase !== "capture") return;
    setPhase("analyzing");
    setCaptureError(null);

    const start = Date.now();
    // Tries OpenAI Structured Outputs first, silently falls back to the
    // deterministic parser on any failure (network, timeout, bad schema,
    // OpenAI error, or zero products) — see extractInventoryDrafts.
    const extractedList = await extractInventoryDrafts(raw, { items, collections });
    const minDelay = Math.min(
      MAX_ANALYZING_MS,
      BASE_ANALYZING_MS + Math.max(0, extractedList.length - 1) * PER_PRODUCT_ANALYZING_MS,
    );

    const created = extractedList.length > 0
      ? await createDrafts(extractedList.map((extracted) => ({ rawText: raw, extracted })))
      : [];

    const elapsed = Date.now() - start;
    if (elapsed < minDelay) await sleep(minDelay - elapsed);

    if (created.length === 0) {
      setCaptureError("That didn't save. Your text is still here — try again.");
      setPhase("capture");
      return;
    }

    onCaptured(created);
    setConfirmItems(created.map(draftToConfirmItem));
    setPhase("confirm");
  }

  // Photo is just another input source feeding the same pipeline — the only
  // real difference is there's no deterministic fallback for an image, so a
  // failure here is a real "try again," not a silent handoff.
  async function handlePhotoCapture(file: File) {
    if (phase !== "capture") return;
    setCaptureError(null);

    let dataUrl: string;
    let base64: string;
    try {
      ({ dataUrl, base64 } = await fileToBase64(file));
    } catch {
      setCaptureError("Couldn't read that photo — try again.");
      return;
    }

    setCapturedImagePreview(dataUrl);
    setPhase("analyzing");

    const start = Date.now();
    const extractedList = await extractInventoryDraftsFromImage(
      base64,
      file.type || "image/jpeg",
      { items, collections },
    );
    const minDelay = Math.min(
      MAX_ANALYZING_MS,
      BASE_ANALYZING_MS + Math.max(0, extractedList.length - 1) * PER_PRODUCT_ANALYZING_MS,
    );

    const created = extractedList.length > 0
      ? await createDrafts(extractedList.map((extracted) => ({ rawText: "📷 Photo capture", extracted })))
      : [];

    const elapsed = Date.now() - start;
    if (elapsed < minDelay) await sleep(minDelay - elapsed);

    if (created.length === 0) {
      // extractInventoryDraftsFromImage already logged the AI's reason and
      // response body — add the original file's metadata here so a failed
      // capture is fully reproducible from the console alone.
      console.error("[ELK Capture] Photo capture produced no drafts", {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });
      setCaptureError("Couldn't find a product in that photo — try a clearer shot, or paste text instead.");
      setCapturedImagePreview(null);
      setPhase("capture");
      return;
    }

    onCaptured(created);
    setConfirmItems(created.map(draftToConfirmItem));
    setCapturedImagePreview(null);
    setPhase("confirm");
  }

  // ⌘V / Ctrl+V of an image (e.g. a screenshotted order or copied product
  // photo) is now the primary desktop capture path — route it through the
  // exact same photo pipeline as Upload Photo. Only active on the Capture
  // phase itself; leaves normal text pasting into the textarea untouched.
  useEffect(() => {
    if (phase !== "capture") return;
    function onWindowPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void handlePhotoCapture(file);
          }
          return;
        }
      }
    }
    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function resolveOne(item: ConfirmItem, action: ApproveAction): Promise<void> {
    updateItem(item.draft.id, { status: "approving", error: null });
    const outcome = await onApprove(item.draft, action);
    setConfirmItems((prev) => {
      const next = prev.map((i) => {
        if (i.draft.id !== item.draft.id) return i;
        if (!outcome.ok) return { ...i, status: "error" as const, error: outcome.error };
        return {
          ...i,
          status: "done" as const,
          outcome: (action.kind === "merge" ? "updated" : "added") as ConfirmItem["outcome"],
          resolvedItem: outcome.item,
        };
      });
      checkForCompletion(next);
      return next;
    });
  }

  function actionFor(item: ConfirmItem): ApproveAction {
    const price = item.price.trim() ? parseFloat(item.price) : null;
    return {
      kind: "new",
      fields: {
        name: item.name.trim() || "Untitled capture",
        itemClass: item.itemClass,
        domain: item.domain !== "unknown" ? item.domain : undefined,
        quantity: Math.max(1, item.quantity),
        currentZone: item.zone,
        collectionId: item.collectionId || null,
        project: item.project.trim() || null,
        notes: item.vendor.trim() ? `Purchased from ${item.vendor.trim()}.` : "",
        category: item.category.trim() || undefined,
        brand: item.brand.trim() || null,
        model: item.model.trim() || null,
        vendor: item.vendor.trim() || null,
        price: price != null && Number.isFinite(price) ? price : null,
        currency: item.draft.suggestedCurrency ?? null,
        purchaseDate: item.purchaseDate.trim() || null,
        productUrl: item.productUrl.trim() || null,
      },
    };
  }

  function handleApproveOne(item: ConfirmItem) {
    void resolveOne(item, actionFor(item));
  }

  function handleApproveMerge(item: ConfirmItem, existingItem: InventoryItem) {
    void resolveOne(item, { kind: "merge", existingItem, addQuantity: Math.max(1, item.quantity) });
  }

  async function handleApproveAll() {
    const toApprove = pendingItems;
    if (toApprove.length === 0 || batchApproving) return;
    setBatchApproving(true);
    setBatchProgress({ done: 0, total: toApprove.length });

    for (let i = 0; i < toApprove.length; i++) {
      await resolveOne(toApprove[i], actionFor(toApprove[i]));
      setBatchProgress({ done: i + 1, total: toApprove.length });
    }

    setBatchApproving(false);
    setBatchProgress(null);
  }

  function handleSaveForLaterOne(item: ConfirmItem) {
    onSaveForLater(item.draft.id);
    setConfirmItems((prev) => {
      const next = prev.map((i) =>
        i.draft.id === item.draft.id ? { ...i, status: "done" as const, outcome: "saved" as const } : i,
      );
      checkForCompletion(next);
      return next;
    });
  }

  function handleDiscardOne(item: ConfirmItem) {
    onReject(item.draft.id);
    setConfirmItems((prev) => {
      const next = prev.map((i) =>
        i.draft.id === item.draft.id ? { ...i, status: "done" as const, outcome: "discarded" as const } : i,
      );
      checkForCompletion(next);
      return next;
    });
  }

  return (
    <div style={{ maxWidth: "680px", margin: "0 auto", paddingBottom: "60px" }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes checkPop { 0% { transform: scale(0.5); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes scanSweep { 0% { transform: translateX(-120%); } 100% { transform: translateX(220%); } }
        @keyframes dotPulse { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
      `}</style>

      {(phase === "capture" || phase === "confirm") && (
        <button
          onClick={onCancel}
          style={{ background: "none", border: "none", color: C.textMid, fontSize: "13px", cursor: "pointer", padding: "0 0 20px" }}
        >
          ← Back to Inventory
        </button>
      )}

      <ProgressDots phase={phase} />

      {phase === "capture" && (
        <CapturePhaseView
          text={text}
          setText={setText}
          error={captureError}
          textareaRef={textareaRef}
          sessionCaptureCount={sessionCaptureCount}
          onCapture={() => void handleCapture()}
          onPhotoSelected={(file) => void handlePhotoCapture(file)}
        />
      )}

      {phase === "analyzing" && <AnalyzingPhaseView text={text} imagePreview={capturedImagePreview} />}

      {phase === "confirm" && (
        <ConfirmPhaseView
          items={confirmItems}
          pendingCount={pendingItems.length}
          allItems={items}
          batchApproving={batchApproving}
          batchProgress={batchProgress}
          onChange={updateItem}
          onApproveOne={handleApproveOne}
          onApproveMerge={handleApproveMerge}
          onApproveAll={() => void handleApproveAll()}
          onSaveForLater={handleSaveForLaterOne}
          onDiscard={handleDiscardOne}
        />
      )}

      {phase === "success" && (
        <SuccessPhaseView
          items={successItems}
          sessionCaptureCount={sessionCaptureCount}
          onCaptureAnother={resetToCapture}
          onViewItem={() => onViewItem(successItems[0])}
        />
      )}
    </div>
  );
}

// ── Phase 1: Capture ──────────────────────────────────────────────────────────

function CapturePhaseView({
  text, setText, error, textareaRef, sessionCaptureCount, onCapture, onPhotoSelected,
}: {
  text: string;
  setText: (v: string) => void;
  error: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  sessionCaptureCount: number;
  onCapture: () => void;
  onPhotoSelected: (file: File) => void;
}) {
  const [dragActive, setDragActive] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (file) onPhotoSelected(file);
  }

  return (
    <div
      style={{
        animation: "fadeIn 0.25s ease-out",
        outline: dragActive ? `2px dashed ${C.amber}` : "none",
        outlineOffset: "8px",
        borderRadius: "12px",
        transition: "outline-color 0.15s",
      }}
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      <div style={{ marginBottom: "22px" }}>
        <div style={{
          fontSize: "11px", fontWeight: 800, color: C.amber,
          letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: "8px",
        }}>
          ⚡ Capture
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: "28px", fontWeight: 800, color: C.text, lineHeight: 1.15 }}>
          Drop it in.
        </h2>
        <p style={{ margin: 0, color: C.textMid, fontSize: "15px", lineHeight: 1.55, maxWidth: "520px" }}>
          A receipt, a link, an order summary, a scribbled note — or your entire Amazon order
          history, ⌘A'd and pasted whole. We'll sort out what's actually a product.
        </p>
      </div>

      <textarea
        ref={textareaRef}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onCapture(); }
        }}
        placeholder="Paste a receipt, a link, an order page — anything — or just type what you got…"
        style={{
          width: "100%", minHeight: "200px", boxSizing: "border-box",
          background: C.bgInput, border: `1.5px solid ${text ? C.amber : C.border}`,
          borderRadius: "10px", padding: "18px", fontSize: "16px",
          color: C.text, fontFamily: "inherit", lineHeight: 1.6,
          resize: "vertical", outline: "none",
          boxShadow: text ? `0 0 0 3px ${C.amber}18` : "none",
          transition: "box-shadow 0.15s, border-color 0.15s",
        }}
      />

      {!text && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
          <span style={{ fontSize: "12px", color: C.textDim }}>Try one:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => { setText(ex.text); textareaRef.current?.focus(); }}
              style={{
                background: C.bgInset, border: `1px solid ${C.borderLo}`,
                borderRadius: "20px", color: C.textMid,
                fontSize: "12px", padding: "4px 12px", cursor: "pointer",
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{
          color: C.red, background: C.red + "12", border: `1px solid ${C.red}30`,
          borderRadius: "6px", padding: "10px 14px", fontSize: "13px", marginTop: "12px",
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "18px", flexWrap: "wrap" }}>
        <button
          onClick={onCapture}
          disabled={!text.trim()}
          style={{
            background: !text.trim() ? C.textDim : C.amber,
            border: "none",
            color: !text.trim() ? C.textMid : "#1c1a17",
            borderRadius: "9px", padding: "13px 26px",
            fontSize: "15px", fontWeight: 800,
            cursor: !text.trim() ? "default" : "pointer",
            boxShadow: !text.trim() ? "none" : `0 4px 16px ${C.amber}30`,
            transition: "transform 0.1s",
          }}
          onMouseDown={(e) => { if (text.trim()) e.currentTarget.style.transform = "scale(0.97)"; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        >
          ⚡ Capture
        </button>
        <span style={{ fontSize: "12px", color: C.textDim }}>⌘/Ctrl + Enter</span>
        <span style={{ color: C.textDim, fontSize: "13px" }}>or</span>
        <PhotoSourceControls onSelect={onPhotoSelected} />
      </div>

      <p style={{ margin: "12px 0 0", fontSize: "12px", color: C.textDim }}>
        {IS_MOBILE
          ? "Nothing is added to your inventory until you review and approve it."
          : "Paste an image (⌘V) or drag one in anywhere on this page. Nothing is added until you review and approve it."}
      </p>

      {sessionCaptureCount > 0 && (
        <p style={{ margin: "6px 0 0", fontSize: "12px", color: C.amber, fontWeight: 600 }}>
          {sessionCaptureCount} captured this session.
        </p>
      )}

      <div style={{ marginTop: "40px", paddingTop: "24px", borderTop: `1px solid ${C.borderLo}` }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "12px" }}>
          More ways to capture — someday
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {FUTURE_SOURCES.map((s) => (
            <div key={s.label} title="Coming soon" style={{
              display: "flex", alignItems: "center", gap: "7px",
              background: C.bgCard, border: `1px solid ${C.borderLo}`,
              borderRadius: "8px", padding: "9px 14px", opacity: 0.5,
            }}>
              <span style={{ fontSize: "15px" }}>{s.icon}</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: C.textDim }}>{s.label}</span>
              <span style={{ fontSize: "9px", color: C.textDim, background: C.bgInset, borderRadius: "3px", padding: "1px 5px", marginLeft: "2px" }}>
                SOON
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Phase 2: Analyzing ─────────────────────────────────────────────────────────

function AnalyzingPhaseView({ text, imagePreview }: { text: string; imagePreview: string | null }) {
  return (
    <div style={{ animation: "fadeIn 0.25s ease-out", textAlign: "center", paddingTop: "20px" }}>
      <div style={{
        position: "relative", overflow: "hidden",
        background: C.bgInput, border: `1.5px solid ${C.border}`,
        borderRadius: "10px", minHeight: "200px", maxHeight: "320px",
        textAlign: "left",
        padding: imagePreview ? 0 : "18px",
        display: imagePreview ? "flex" : "block",
        alignItems: imagePreview ? "center" : undefined,
        justifyContent: imagePreview ? "center" : undefined,
      }}>
        {imagePreview ? (
          <img src={imagePreview} alt="" style={{ width: "100%", maxHeight: "320px", objectFit: "contain", display: "block" }} />
        ) : (
          <p style={{ margin: 0, fontSize: "16px", color: C.textDim, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {text}
          </p>
        )}
        <div style={{
          position: "absolute", top: 0, bottom: 0, width: "40%",
          background: `linear-gradient(90deg, transparent, ${C.amber}22, transparent)`,
          animation: "scanSweep 1.6s ease-in-out infinite",
        }} />
      </div>
      <div style={{ marginTop: "18px", fontSize: "14px", color: C.textMid, fontWeight: 600 }}>
        Making sense of it
        <Dots />
      </div>
    </div>
  );
}

// Desktop can never actually open a camera through a file input — the
// `capture` attribute is simply a no-op there — so desktop gets one plain
// "Upload Photo" picker. Mobile gets two real, distinct choices: a button
// that opens the camera directly, and one that opens the photo library,
// because a single `capture` input on mobile doesn't reliably offer both.
function PhotoSourceControls({ onSelect }: { onSelect: (file: File) => void }) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onSelect(file);
    e.target.value = ""; // allow re-selecting the same file later
  }

  return (
    <>
      {IS_MOBILE && (
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handleChange}
        />
      )}
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleChange}
      />

      {IS_MOBILE ? (
        <>
          <PhotoButton icon="📷" label="Take a Photo" onClick={() => cameraInputRef.current?.click()} />
          <PhotoButton icon="🖼️" label="Choose Photo" onClick={() => libraryInputRef.current?.click()} />
        </>
      ) : (
        <PhotoButton icon="🖼️" label="Upload Photo" onClick={() => libraryInputRef.current?.click()} />
      )}
    </>
  );
}

function PhotoButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "7px",
        background: "transparent", border: `1.5px solid ${C.amber}`,
        borderRadius: "9px", padding: "11px 18px", cursor: "pointer",
      }}
    >
      <span style={{ fontSize: "15px" }}>{icon}</span>
      <span style={{ fontSize: "14px", fontWeight: 700, color: C.amber }}>{label}</span>
    </button>
  );
}

function Dots() {
  return (
    <span style={{ display: "inline-flex", gap: "3px", marginLeft: "6px", verticalAlign: "middle" }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: "4px", height: "4px", borderRadius: "50%", background: C.amber,
          animation: `dotPulse 1.2s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
    </span>
  );
}

// ── Phase 3: Confirm ───────────────────────────────────────────────────────────

function ConfirmPhaseView({
  items, pendingCount, allItems, batchApproving, batchProgress, onChange, onApproveOne, onApproveMerge, onApproveAll, onSaveForLater, onDiscard,
}: {
  items: ConfirmItem[];
  pendingCount: number;
  allItems: InventoryItem[];
  batchApproving: boolean;
  batchProgress: { done: number; total: number } | null;
  onChange: (draftId: string, patch: Partial<ConfirmItem>) => void;
  onApproveOne: (item: ConfirmItem) => void;
  onApproveMerge: (item: ConfirmItem, existingItem: InventoryItem) => void;
  onApproveAll: () => void;
  onSaveForLater: (item: ConfirmItem) => void;
  onDiscard: (item: ConfirmItem) => void;
}) {
  const visible = items.filter((i) => i.status !== "done");
  const isMultiple = items.length > 1;

  return (
    <div style={{ animation: "fadeIn 0.3s ease-out" }}>
      <div style={{ marginBottom: "18px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
          {batchProgress ? `Approving ${batchProgress.done} of ${batchProgress.total}…` : "Here's what we found"}
        </div>
        <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 800, color: C.text }}>
          Detected {items.length} product{items.length === 1 ? "" : "s"}
        </h2>
      </div>

      {isMultiple && pendingCount > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <button
            onClick={onApproveAll}
            disabled={batchApproving}
            style={{
              background: batchApproving ? C.textDim : C.green,
              border: "none", color: batchApproving ? C.textMid : "#0f1a0f",
              borderRadius: "9px", padding: "12px 24px",
              fontSize: "14px", fontWeight: 800,
              cursor: batchApproving ? "default" : "pointer",
              boxShadow: batchApproving ? "none" : `0 4px 16px ${C.green}30`,
            }}
          >
            {batchApproving ? "Adding…" : `✓ Approve All (${pendingCount})`}
          </button>
          <span style={{ marginLeft: "12px", fontSize: "12px", color: C.textDim }}>
            or review and approve each one below
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {visible.map((item) => (
          <ConfirmItemCard
            key={item.draft.id}
            item={item}
            allItems={allItems}
            disabled={batchApproving}
            onChange={(patch) => onChange(item.draft.id, patch)}
            onApprove={() => onApproveOne(item)}
            onApproveMerge={(existing) => onApproveMerge(item, existing)}
            onSaveForLater={() => onSaveForLater(item)}
            onDiscard={() => onDiscard(item)}
          />
        ))}
      </div>
    </div>
  );
}

function ConfirmItemCard({
  item, allItems, disabled, onChange, onApprove, onApproveMerge, onSaveForLater, onDiscard,
}: {
  item: ConfirmItem;
  allItems: InventoryItem[];
  disabled: boolean;
  onChange: (patch: Partial<ConfirmItem>) => void;
  onApprove: () => void;
  onApproveMerge: (existingItem: InventoryItem) => void;
  onSaveForLater: () => void;
  onDiscard: () => void;
}) {
  const duplicates = useMemo(
    () => findPossibleDuplicates({ name: item.name, brand: item.brand || null }, allItems),
    [item.name, item.brand, allItems],
  );
  const approving = item.status === "approving";

  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: "10px",
      padding: "18px 20px", opacity: approving ? 0.6 : 1, transition: "opacity 0.2s",
    }}>
      {/* The evidence — what you actually gave us, kept visible and primary */}
      <div style={{
        display: "flex", gap: "8px", alignItems: "flex-start",
        background: C.bgInset, border: `1px solid ${C.borderLo}`, borderRadius: "8px",
        padding: "10px 12px", marginBottom: "14px",
      }}>
        <span style={{ fontSize: "14px", color: C.textDim, lineHeight: 1, flexShrink: 0 }}>"</span>
        <p style={{
          margin: 0, fontSize: "12px", color: C.textMid, lineHeight: 1.5, fontStyle: "italic",
          whiteSpace: "pre-wrap",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {item.draft.rawText}
        </p>
      </div>

      <input
        value={item.name}
        onChange={(e) => onChange({ name: e.target.value })}
        style={{
          width: "100%", boxSizing: "border-box",
          background: "transparent", border: "none", borderBottom: `2px solid ${C.border}`,
          borderRadius: 0, padding: "4px 2px 8px", fontSize: "19px", fontWeight: 800,
          color: C.text, fontFamily: "inherit", outline: "none", marginBottom: "12px",
        }}
        onFocus={(e) => { e.currentTarget.style.borderBottomColor = C.amber; }}
        onBlur={(e) => { e.currentTarget.style.borderBottomColor = C.border; }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
        <QtyStepper value={item.quantity} onChange={(v) => onChange({ quantity: v })} />
        {item.brand && <Chip label={item.brand} />}
        {item.model && <Chip label={item.model} />}
        {item.vendor && <Chip label={item.vendor} />}
        {item.price && <Chip label={`$${item.price}`} color={C.green} />}
        {item.category && <Chip label={item.category} color={C.purple} />}
      </div>

      {duplicates.length > 0 && (
        <div style={{
          background: C.amber + "10", border: `1px solid ${C.amber}30`,
          borderRadius: "8px", padding: "10px 12px", marginBottom: "12px",
        }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: C.amber, marginBottom: "6px" }}>
            Might already have this →
          </div>
          {duplicates.map((match) => (
            <div key={match.itemId} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: "8px", padding: "3px 0", flexWrap: "wrap",
            }}>
              <span style={{ fontSize: "12px", color: C.text }}>
                {match.itemName}
                <span style={{ color: ZONE_COLORS[match.zone] ?? C.textDim, marginLeft: "6px", fontSize: "11px" }}>
                  · {match.zone.replace(/-/g, " ")} · {match.lifecycleState}
                </span>
              </span>
              <button
                onClick={() => {
                  const existing = allItems.find((i) => i.id === match.itemId);
                  if (existing) onApproveMerge(existing);
                }}
                disabled={disabled || approving}
                style={{
                  background: "transparent", border: `1px solid ${C.green}`, color: C.green,
                  borderRadius: "5px", padding: "3px 9px", fontSize: "10px", fontWeight: 700,
                  cursor: disabled || approving ? "default" : "pointer",
                }}
              >
                Same thing — update count
              </button>
            </div>
          ))}
        </div>
      )}

      {item.error && (
        <div style={{
          color: C.red, background: C.red + "12", border: `1px solid ${C.red}30`,
          borderRadius: "6px", padding: "8px 12px", fontSize: "12px", marginBottom: "12px",
        }}>
          {item.error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px", flexWrap: "wrap" }}>
        <button
          onClick={onApprove}
          disabled={disabled || approving}
          style={{
            background: disabled || approving ? C.textDim : C.green,
            border: "none", color: disabled || approving ? C.textMid : "#0f1a0f",
            borderRadius: "8px", padding: "9px 18px",
            fontSize: "13px", fontWeight: 800,
            cursor: disabled || approving ? "default" : "pointer",
          }}
        >
          {approving ? "Adding…" : "✓ Add it"}
        </button>
        <button
          onClick={() => onChange({ showMore: !item.showMore })}
          disabled={disabled}
          style={{ background: "none", border: "none", color: C.amber, fontSize: "12px", fontWeight: 600, cursor: disabled ? "default" : "pointer" }}
        >
          {item.showMore ? "Hide details ▲" : "Add more detail ▾"}
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={onSaveForLater} disabled={disabled} style={{ background: "none", border: "none", color: C.textDim, fontSize: "11px", cursor: disabled ? "default" : "pointer", padding: 0 }}>
          Not yet
        </button>
        <button onClick={onDiscard} disabled={disabled} style={{ background: "none", border: "none", color: C.textDim, fontSize: "11px", cursor: disabled ? "default" : "pointer", padding: 0 }}>
          Discard
        </button>
      </div>

      {item.showMore && (
        <div style={{
          marginTop: "16px", paddingTop: "16px", borderTop: `1px solid ${C.borderLo}`,
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px",
        }}>
          <Field label="Brand"><input style={inputStyle} value={item.brand} onChange={(e) => onChange({ brand: e.target.value })} /></Field>
          <Field label="Model"><input style={inputStyle} value={item.model} onChange={(e) => onChange({ model: e.target.value })} /></Field>
          <Field label="Vendor"><input style={inputStyle} value={item.vendor} onChange={(e) => onChange({ vendor: e.target.value })} /></Field>
          <Field label="Price"><input style={inputStyle} value={item.price} onChange={(e) => onChange({ price: e.target.value })} placeholder="0.00" /></Field>
          <Field label="Purchase Date"><input style={inputStyle} type="date" value={item.purchaseDate} onChange={(e) => onChange({ purchaseDate: e.target.value })} /></Field>
          <Field label="Product URL"><input style={inputStyle} value={item.productUrl} onChange={(e) => onChange({ productUrl: e.target.value })} /></Field>
          <Field label="Class">
            <select style={inputStyle} value={item.itemClass} onChange={(e) => onChange({ itemClass: e.target.value as ItemClass })}>
              {ITEM_CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Domain">
            <select style={inputStyle} value={item.domain} onChange={(e) => onChange({ domain: e.target.value as InventoryDomain })}>
              {DOMAINS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </Field>
          <Field label="Zone">
            <select style={inputStyle} value={item.zone} onChange={(e) => onChange({ zone: e.target.value as ZoneId })}>
              {ZONES.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </Field>
          <Field label="Collection">
            <select style={inputStyle} value={item.collectionId} onChange={(e) => onChange({ collectionId: e.target.value })}>
              <option value="">— none —</option>
              {COLLECTIONS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Project" full><input style={inputStyle} value={item.project} onChange={(e) => onChange({ project: e.target.value })} /></Field>
        </div>
      )}
    </div>
  );
}

// ── Phase 4: Success ───────────────────────────────────────────────────────────

function SuccessPhaseView({
  items, sessionCaptureCount, onCaptureAnother, onViewItem,
}: {
  items: InventoryItem[];
  sessionCaptureCount: number;
  onCaptureAnother: () => void;
  onViewItem: () => void;
}) {
  const isMultiple = items.length > 1;
  return (
    <div style={{ textAlign: "center", padding: "50px 0 30px", animation: "fadeIn 0.3s ease-out" }}>
      <div style={{ fontSize: "44px", animation: "checkPop 0.4s ease-out" }}>✓</div>
      <h3 style={{ margin: "14px 0 4px", fontSize: "20px", fontWeight: 800, color: C.text }}>
        {isMultiple ? `Added ${items.length} items to your inventory` : "Added to your inventory"}
      </h3>
      {isMultiple ? (
        <p style={{ margin: 0, fontSize: "14px", color: C.textMid, lineHeight: 1.6, maxWidth: "440px", marginLeft: "auto", marginRight: "auto" }}>
          {items.slice(0, 4).map((i) => i.name).join(", ")}
          {items.length > 4 ? `, and ${items.length - 4} more` : ""}
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: "16px", color: C.textMid, fontWeight: 600 }}>{items[0]?.name}</p>
      )}

      {sessionCaptureCount > 0 && (
        <p style={{ margin: "12px 0 0", fontSize: "12px", color: C.amber, fontWeight: 600 }}>
          {sessionCaptureCount} captured this session.
        </p>
      )}

      <div style={{ display: "flex", gap: "10px", justifyContent: "center", marginTop: "26px" }}>
        <button
          onClick={onCaptureAnother}
          style={{
            background: C.amber, border: "none", color: "#1c1a17",
            borderRadius: "9px", padding: "11px 22px", fontSize: "14px", fontWeight: 800, cursor: "pointer",
          }}
        >
          ⚡ Capture something else
        </button>
        <button
          onClick={onViewItem}
          style={{ background: "none", border: "none", color: C.textMid, fontSize: "13px", cursor: "pointer" }}
        >
          See it in Inventory →
        </button>
      </div>
    </div>
  );
}

// ── Shared small pieces ───────────────────────────────────────────────────────

function ProgressDots({ phase }: { phase: Phase }) {
  const idx = PHASES.indexOf(phase);
  return (
    <div style={{ display: "flex", gap: "4px", marginBottom: "18px" }}>
      {PHASES.map((p, i) => (
        <div key={p} style={{
          width: "22px", height: "3px", borderRadius: "2px",
          background: i <= idx ? C.amber : C.borderLo,
          transition: "background 0.3s",
        }} />
      ))}
    </div>
  );
}

function QtyStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "8px",
      background: C.bgInset, border: `1px solid ${C.borderLo}`, borderRadius: "20px", padding: "3px 6px",
    }}>
      <button onClick={() => onChange(Math.max(1, value - 1))} style={stepperBtnStyle}>−</button>
      <span style={{ fontSize: "13px", fontWeight: 700, color: C.text, minWidth: "18px", textAlign: "center" }}>{value}</span>
      <button onClick={() => onChange(value + 1)} style={stepperBtnStyle}>+</button>
    </div>
  );
}

const stepperBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: C.textMid,
  fontSize: "15px", fontWeight: 700, cursor: "pointer", width: "18px", lineHeight: 1,
};

function Chip({ label, color = C.textMid }: { label: string; color?: string }) {
  return (
    <span style={{
      fontSize: "11px", fontWeight: 600, color, background: color + "18",
      border: `1px solid ${color}30`, borderRadius: "4px", padding: "3px 8px",
    }}>
      {label}
    </span>
  );
}

function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label style={{ fontSize: "11px", fontWeight: 700, color: C.textDim, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: C.bgInset, border: `1px solid ${C.border}`,
  borderRadius: "5px", padding: "7px 10px",
  color: C.text, fontSize: "13px", outline: "none",
};
