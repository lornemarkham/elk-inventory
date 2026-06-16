import { useState, useRef } from "react";
import { C } from "../styles";
import { activeAnalyzer } from "../analysis";
import type { ImportBatch, ImportDraftItem } from "../types/import";

interface Props {
  onBatchCreated: (batch: ImportBatch, drafts: ImportDraftItem[]) => void;
  onCancel: () => void;
}

export default function BulkImportPage({ onBatchCreated, onCancel }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ url: string; name: string }[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: File[]) {
    const images = incoming.filter(f => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setFiles(prev => [...prev, ...images]);
    setPreviews(prev => [
      ...prev,
      ...images.map(f => ({ url: URL.createObjectURL(f), name: f.name })),
    ]);
  }

  function removeFile(index: number) {
    URL.revokeObjectURL(previews[index].url);
    setFiles(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  }

  async function handleAnalyze() {
    if (files.length === 0 || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const suggestions = await activeAnalyzer.analyzeInventoryPhotos(files);

      const batchId = crypto.randomUUID();
      const now = new Date().toISOString();

      const batch: ImportBatch = {
        id: batchId,
        createdAt: now,
        source: "bulk-photo",
        analyzerName: activeAnalyzer.name,
        isRealAI: activeAnalyzer.isReal,
        status: "ready-for-review",
        photoCount: files.length,
        totalDrafts: suggestions.length,
        approvedCount: 0,
        rejectedCount: 0,
      };

      const drafts: ImportDraftItem[] = suggestions.map(s => ({
        ...s,
        id: crypto.randomUUID(),
        batchId,
        status: "pending",
        createdAt: now,
      }));

      onBatchCreated(batch, drafts);
    } catch (e) {
      setError("Analysis failed. Try again.");
      console.error(e);
    } finally {
      setAnalyzing(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }
  function onDragLeave() { setIsDragging(false); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  return (
    <div style={{ maxWidth: "760px", margin: "0 auto", paddingBottom: "60px" }}>

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "24px" }}>
        <button
          onClick={onCancel}
          style={{
            background: "none", border: "none", color: C.textMid,
            fontSize: "13px", cursor: "pointer", padding: "0 0 12px",
            display: "flex", alignItems: "center", gap: "5px",
          }}
        >
          ← Back to Inventory
        </button>
        <h2 style={{ margin: "0 0 6px", fontSize: "22px", fontWeight: 800, color: C.text }}>
          Bulk Photo Import
        </h2>
        <p style={{ margin: 0, color: C.textMid, fontSize: "14px", lineHeight: 1.5 }}>
          Upload photos of tools, equipment, or supplies. The system generates draft
          items for your review — nothing is added to inventory without your approval.
        </p>
      </div>

      {/* ── Mock notice ─────────────────────────────────────────────────────── */}
      <div style={{
        background: "#1c1a10", border: "1px solid #c48c2840",
        borderLeft: `3px solid ${C.amber}`,
        borderRadius: "8px", padding: "10px 14px",
        fontSize: "13px", color: C.amber, marginBottom: "20px",
        display: "flex", gap: "8px", alignItems: "flex-start",
      }}>
        <span style={{ flexShrink: 0 }}>🤖</span>
        <div>
          <strong>Mock Analysis Mode</strong> — Draft items are randomly generated from a
          test catalog. No AI is running yet. Review all suggestions carefully.
          <br />
          <span style={{ color: C.textDim, fontSize: "12px" }}>
            Provider: {activeAnalyzer.name}
          </span>
        </div>
      </div>

      {/* ── Drop zone ───────────────────────────────────────────────────────── */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragging ? C.amber : C.border}`,
          borderRadius: "10px",
          padding: "36px 24px",
          textAlign: "center",
          cursor: "pointer",
          transition: "border-color 0.15s",
          background: isDragging ? C.amber + "08" : "transparent",
          marginBottom: "20px",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          style={{ display: "none" }}
          onChange={e => addFiles(Array.from(e.target.files ?? []))}
        />
        <div style={{ fontSize: "32px", marginBottom: "10px", opacity: 0.5 }}>📷</div>
        <div style={{ fontSize: "15px", fontWeight: 700, color: C.text, marginBottom: "6px" }}>
          Drop photos here, or click to browse
        </div>
        <div style={{ fontSize: "12px", color: C.textDim }}>
          JPG · PNG · HEIC · Multiple files supported
        </div>
      </div>

      {/* ── Photo preview grid ──────────────────────────────────────────────── */}
      {previews.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          <div style={{
            fontSize: "11px", fontWeight: 700, color: C.textDim,
            textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px",
          }}>
            {previews.length} Photo{previews.length !== 1 ? "s" : ""} Selected
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
            gap: "8px",
          }}>
            {previews.map((p, i) => (
              <div key={i} style={{ position: "relative" }}>
                <div style={{
                  width: "100%",
                  aspectRatio: "1",
                  borderRadius: "7px",
                  overflow: "hidden",
                  background: C.bgInset,
                  border: `1px solid ${C.border}`,
                }}>
                  <img
                    src={p.url}
                    alt={p.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
                <button
                  onClick={e => { e.stopPropagation(); removeFile(i); }}
                  style={{
                    position: "absolute", top: "4px", right: "4px",
                    width: "20px", height: "20px", lineHeight: "18px",
                    background: "#000a", border: "none", borderRadius: "50%",
                    color: "#fff", fontSize: "13px", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: 0,
                  }}
                  title="Remove"
                >
                  ×
                </button>
                <div style={{
                  fontSize: "10px", color: C.textDim, marginTop: "3px",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {p.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          color: C.red, background: C.red + "12", border: `1px solid ${C.red}30`,
          borderRadius: "6px", padding: "10px 14px", fontSize: "13px", marginBottom: "16px",
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Analyze button ───────────────────────────────────────────────────── */}
      {files.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            style={{
              background: analyzing ? C.textDim : C.amber,
              border: "none",
              color: analyzing ? C.textMid : "#1c1a17",
              borderRadius: "8px",
              padding: "12px 22px",
              fontSize: "14px",
              fontWeight: 700,
              cursor: analyzing ? "default" : "pointer",
              display: "flex", alignItems: "center", gap: "8px",
              transition: "background 0.15s",
            }}
          >
            {analyzing ? (
              <>
                <span style={{
                  display: "inline-block", width: "14px", height: "14px",
                  border: "2px solid #fff4", borderTop: "2px solid #fff",
                  borderRadius: "50%", animation: "spin 0.7s linear infinite",
                }} />
                Generating draft items…
              </>
            ) : (
              <>
                🔍 Analyze {files.length} Photo{files.length !== 1 ? "s" : ""} →
              </>
            )}
          </button>
          {analyzing && (
            <span style={{ fontSize: "12px", color: C.textDim }}>
              ~{files.length + 1}s remaining
            </span>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
