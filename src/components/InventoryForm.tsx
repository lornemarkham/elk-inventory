import { useState, useEffect } from "react";
import type { InventoryItem, ItemClass, LifecycleState, ZoneId, InventoryDomain } from "../types/inventory";
import { ZONES } from "../data/zones";
import { COLLECTIONS } from "../data/collections";
import { CONTAINERS } from "../data/containers";
import { C } from "../styles";

// ── Type presets (step 1 of add flow) ─────────────────────────────────────────
interface TypePreset {
  label: string; icon: string; hint: string;
  itemClass: ItemClass; domain: InventoryDomain;
}
const PRESETS: TypePreset[] = [
  { label: "Tool",                 icon: "🔧", hint: "Drill, wrench, multimeter…",     itemClass: "tool",           domain: "workshop" },
  { label: "Material",             icon: "📦", hint: "Wire, ESP32, fasteners…",        itemClass: "material",       domain: "workshop" },
  { label: "Food",                 icon: "🥫", hint: "Cans, dry goods, preserves…",    itemClass: "material",       domain: "food-storage" },
  { label: "Kitchen / Preserving", icon: "🫙", hint: "Jars, lids, canning pots…",      itemClass: "equipment",      domain: "kitchen-preserving" },
  { label: "Pool / Chemical",      icon: "🏊", hint: "Chemicals, test kits…",          itemClass: "material",       domain: "pool" },
  { label: "Vehicle Part",         icon: "🚗", hint: "Parts, fluids, roadside kit…",   itemClass: "material",       domain: "vehicle" },
  { label: "Project Asset",        icon: "🔬", hint: "Active project items…",          itemClass: "project-asset",  domain: "project" },
  { label: "Other",                icon: "◻",  hint: "Equipment, gear, misc…",         itemClass: "equipment",      domain: "unknown" },
];

// ── Dropdown options ───────────────────────────────────────────────────────────
const ITEM_CLASSES: { value: ItemClass; label: string }[] = [
  { value: "tool",            label: "Tool" },
  { value: "material",        label: "Material" },
  { value: "equipment",       label: "Equipment" },
  { value: "project-asset",   label: "Project Asset" },
  { value: "installed-asset", label: "Installed Asset" },
  { value: "surplus",         label: "Surplus" },
];

const LIFECYCLE_STATES: LifecycleState[] = [
  "available", "in-use", "reserved", "ordered",
  "needs-repair", "retired", "deprecated", "consumed",
  "lost", "sort-required", "incorrect-part", "surplus",
];

const DOMAINS: { value: InventoryDomain; label: string }[] = [
  { value: "workshop",           label: "Workshop" },
  { value: "electronics",        label: "Electronics" },
  { value: "food-storage",       label: "Food Storage" },
  { value: "kitchen-preserving", label: "Kitchen / Preserving" },
  { value: "garden",             label: "Garden" },
  { value: "pool",               label: "Pool" },
  { value: "vehicle",            label: "Vehicle" },
  { value: "household",          label: "Household" },
  { value: "project",            label: "Project" },
  { value: "unknown",            label: "Other / Unknown" },
];

// ── Common suggested tags (add more over time) ─────────────────────────────────
const SUGGESTED_TAGS = [
  "electronics","solar","wiring","mechanics","woodworking","diagnostic",
  "automotive","elk-garden","elk-wrench","pool","sensor","camera","power",
  "measurement","small-engine","motorcycle","fasteners","hardware","yard",
  "food","preserving","seasonal","emergency","household",
];

// ── Styles ─────────────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: "100%",
  background: C.bgInput,
  border: `1px solid ${C.border}`,
  borderRadius: "4px",
  padding: "8px 10px",
  color: C.text,
  fontSize: "14px",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: "11px", color: C.textDim, marginBottom: "4px",
  display: "block", textTransform: "uppercase", letterSpacing: "0.08em",
};

// ── Form state shape ───────────────────────────────────────────────────────────
interface FormState {
  name: string;
  itemClass: ItemClass;
  domain: InventoryDomain;
  lifecycleState: LifecycleState;
  currentZone: ZoneId;
  recommendedZone: ZoneId;
  locationDetail: string;
  collectionId: string;
  containerId: string;
  project: string;
  notes: string;
  photoPath: string;
  quantity: number;
  tags: string[];
  tagInput: string;
  attributes: Record<string, string | number | boolean>;
}

const blank: FormState = {
  name: "",
  itemClass: "tool",
  domain: "unknown",
  lifecycleState: "available",
  currentZone: "unknown",
  recommendedZone: "unknown",
  locationDetail: "",
  collectionId: "",
  containerId: "",
  project: "",
  notes: "",
  photoPath: "",
  quantity: 1,
  tags: [],
  tagInput: "",
  attributes: {},
};

function itemToForm(item: InventoryItem): FormState {
  return {
    name: item.name,
    itemClass: item.itemClass,
    domain: item.domain ?? "unknown",
    lifecycleState: item.lifecycleState,
    currentZone: item.currentZone,
    recommendedZone: item.recommendedZone,
    locationDetail: item.locationDetail,
    collectionId: item.collectionId ?? "",
    containerId: item.containerId ?? "",
    project: item.project ?? "",
    notes: item.notes,
    photoPath: item.photoPath,
    quantity: item.quantity,
    tags: [...item.tags],
    tagInput: "",
    attributes: item.attributes ? { ...item.attributes } : {},
  };
}

// ── Props ──────────────────────────────────────────────────────────────────────
interface Props {
  onAdd?: (item: InventoryItem) => void;
  editItem?: InventoryItem | null;
  onUpdate?: (item: InventoryItem) => void;
  onCancelEdit?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function InventoryForm({ onAdd, editItem, onUpdate, onCancelEdit }: Props) {
  const isEditMode = !!editItem;
  const [open, setOpen] = useState(false);
  const [typeStep, setTypeStep] = useState(true); // step 1 of add flow
  const [form, setForm] = useState<FormState>(() => editItem ? itemToForm(editItem) : { ...blank });

  useEffect(() => {
    if (editItem) setForm(itemToForm(editItem));
  }, [editItem]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(p => ({ ...p, [key]: value }));
  }

  function toggleTag(tag: string) {
    setForm(p => ({
      ...p,
      tags: p.tags.includes(tag) ? p.tags.filter(t => t !== tag) : [...p.tags, tag],
    }));
  }

  function addTagsFromInput() {
    const raw = form.tagInput;
    const newTags = raw
      .split(",")
      .map(t => t.trim().toLowerCase().replace(/\s+/g, "-"))
      .filter(t => t.length >= 2 && !form.tags.includes(t));
    if (newTags.length === 0) { set("tagInput", ""); return; }
    setForm(p => ({ ...p, tags: [...p.tags, ...newTags], tagInput: "" }));
  }

  function selectPreset(preset: TypePreset) {
    setForm(p => ({ ...p, itemClass: preset.itemClass, domain: preset.domain }));
    setTypeStep(false);
  }

  function buildItem(): InventoryItem {
    const base = isEditMode && editItem ? editItem : ({} as Partial<InventoryItem>);
    return {
      ...base,
      id: isEditMode && editItem ? editItem.id : crypto.randomUUID(),
      name: form.name.trim(),
      itemClass: form.itemClass,
      domain: form.domain !== "unknown" ? form.domain : undefined,
      lifecycleState: form.lifecycleState,
      currentZone: form.currentZone,
      recommendedZone: form.recommendedZone,
      locationDetail: form.locationDetail.trim(),
      collectionId: form.collectionId || null,
      containerId: form.containerId || null,
      project: form.project.trim() || null,
      tags: form.tags,
      quantity: Math.max(1, form.quantity),
      photoPath: form.photoPath.trim(),
      notes: form.notes.trim(),
      attributes: Object.keys(form.attributes).length > 0 ? form.attributes : undefined,
    } as InventoryItem;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const item = buildItem();
    if (isEditMode) {
      onUpdate?.(item);
    } else {
      onAdd?.(item);
      setForm({ ...blank });
      setTypeStep(true);
      setOpen(false);
    }
  }

  function handleCancel() {
    if (isEditMode) {
      onCancelEdit?.();
    } else {
      setForm({ ...blank });
      setTypeStep(true);
      setOpen(false);
    }
  }

  // ── Edit mode: modal overlay ───────────────────────────────────────────────
  if (isEditMode) {
    return (
      <>
        <div onClick={handleCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 100 }} />
        <div style={{
          position: "fixed", top: "3vh", left: "50%", transform: "translateX(-50%)",
          width: "min(700px, 95vw)", maxHeight: "94vh", overflowY: "auto",
          background: C.bgCard, border: `1px solid ${C.amber}`, borderTop: `4px solid ${C.amber}`,
          borderRadius: "10px", zIndex: 101, padding: "24px 26px 32px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div style={{ fontSize: "20px", fontWeight: 800, color: C.text }}>Edit Item</div>
            <button onClick={handleCancel} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMid, borderRadius: "5px", padding: "6px 14px", fontSize: "16px", cursor: "pointer" }}>✕</button>
          </div>
          <FormBody form={form} set={set} toggleTag={toggleTag} addTagsFromInput={addTagsFromInput} onSubmit={handleSubmit} onCancel={handleCancel} submitLabel="Save Changes" />
        </div>
      </>
    );
  }

  // ── Add mode: inline accordion ─────────────────────────────────────────────
  return (
    <div style={{ marginBottom: "20px" }}>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          color: C.textMid, borderRadius: "5px", padding: "8px 16px",
          fontSize: "13px", cursor: "pointer", fontWeight: 600,
        }}>
          + Add Item
        </button>
      ) : (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "20px" }}>
          {typeStep ? (
            /* Step 1: type picker */
            <TypePicker onSelect={selectPreset} onCancel={handleCancel} />
          ) : (
            /* Step 2: form */
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: C.text }}>New Item</div>
                <button
                  type="button"
                  onClick={() => setTypeStep(true)}
                  style={{ background: "none", border: "none", color: C.textDim, fontSize: "12px", cursor: "pointer" }}
                >
                  ← Change type
                </button>
              </div>
              <FormBody form={form} set={set} toggleTag={toggleTag} addTagsFromInput={addTagsFromInput} onSubmit={handleSubmit} onCancel={handleCancel} submitLabel="Add Item" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Type picker (step 1) ──────────────────────────────────────────────────────
function TypePicker({ onSelect, onCancel }: { onSelect: (p: TypePreset) => void; onCancel: () => void }) {
  return (
    <div>
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "15px", fontWeight: 700, color: C.text, marginBottom: "4px" }}>What are you adding?</div>
        <div style={{ fontSize: "12px", color: C.textDim }}>Choose a type to get started. You can adjust it later.</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "8px", marginBottom: "16px" }}>
        {PRESETS.map(p => (
          <button
            key={p.label}
            type="button"
            onClick={() => onSelect(p)}
            style={{
              background: C.bgInset, border: `1px solid ${C.border}`,
              borderRadius: "7px", padding: "12px 10px",
              cursor: "pointer", textAlign: "left",
              display: "flex", flexDirection: "column", gap: "4px",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = C.amber; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }}
          >
            <span style={{ fontSize: "20px" }}>{p.icon}</span>
            <span style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{p.label}</span>
            <span style={{ fontSize: "11px", color: C.textDim, lineHeight: 1.4 }}>{p.hint}</span>
          </button>
        ))}
      </div>
      <button type="button" onClick={onCancel} style={{
        background: "none", border: "none", color: C.textDim, fontSize: "13px", cursor: "pointer",
      }}>
        Cancel
      </button>
    </div>
  );
}

// ── Form body ─────────────────────────────────────────────────────────────────
interface FormBodyProps {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  toggleTag: (tag: string) => void;
  addTagsFromInput: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  submitLabel: string;
}

function FormBody({ form, set, toggleTag, addTagsFromInput, onSubmit, onCancel, submitLabel }: FormBodyProps) {
  const [attrKey, setAttrKey] = useState("");
  const [attrVal, setAttrVal] = useState("");

  function addAttribute() {
    const k = attrKey.trim();
    if (!k) return;
    set("attributes", { ...form.attributes, [k]: attrVal.trim() });
    setAttrKey(""); setAttrVal("");
  }

  function removeAttribute(key: string) {
    const next = { ...form.attributes };
    delete next[key];
    set("attributes", next);
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "13px" }}>

      {/* Name */}
      <Field label="Name">
        <input style={inputStyle} value={form.name}
          onChange={e => set("name", e.target.value)}
          placeholder="e.g. ESP32, Soldering Iron, Mason Jars"
          required autoFocus />
      </Field>

      {/* Class + Domain */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <Field label="Class">
          <select style={inputStyle} value={form.itemClass} onChange={e => set("itemClass", e.target.value as ItemClass)}>
            {ITEM_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Domain">
          <select style={inputStyle} value={form.domain} onChange={e => set("domain", e.target.value as InventoryDomain)}>
            {DOMAINS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </Field>
      </div>

      {/* State + Qty */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <Field label="State">
          <select style={inputStyle} value={form.lifecycleState} onChange={e => set("lifecycleState", e.target.value as LifecycleState)}>
            {LIFECYCLE_STATES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Qty">
          <input style={inputStyle} type="number" min={1} value={form.quantity}
            onChange={e => set("quantity", parseInt(e.target.value) || 1)} />
        </Field>
      </div>

      {/* Domain-specific quick fields */}
      <DomainContextualFields form={form} set={set} />

      {/* Zones */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <Field label="Current Zone">
          <select style={inputStyle} value={form.currentZone} onChange={e => set("currentZone", e.target.value as ZoneId)}>
            {ZONES.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </Field>
        <Field label="Recommended Zone">
          <select style={inputStyle} value={form.recommendedZone} onChange={e => set("recommendedZone", e.target.value as ZoneId)}>
            {ZONES.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </Field>
      </div>

      {/* Location + Project */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <Field label="Location Detail">
          <input style={inputStyle} value={form.locationDetail}
            onChange={e => set("locationDetail", e.target.value)}
            placeholder="e.g. pegboard, shelf A, red toolbox" />
        </Field>
        <Field label="Project (optional)">
          <input style={inputStyle} value={form.project}
            onChange={e => set("project", e.target.value)}
            placeholder="e.g. ELK Garden, Solar Node" />
        </Field>
      </div>

      {/* Kit + Container */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <Field label="Kit / Collection (optional)">
          <select style={inputStyle} value={form.collectionId} onChange={e => set("collectionId", e.target.value)}>
            <option value="">— none —</option>
            {COLLECTIONS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Container (optional)">
          <select style={inputStyle} value={form.containerId} onChange={e => set("containerId", e.target.value)}>
            <option value="">— none —</option>
            {CONTAINERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>

      {/* Tags */}
      <Field label="Tags">
        {/* Selected tags as removable chips */}
        {form.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" }}>
            {form.tags.map(tag => (
              <button key={tag} type="button" onClick={() => toggleTag(tag)} style={{
                display: "flex", alignItems: "center", gap: "4px",
                background: C.amber + "1a", border: `1px solid ${C.amber}55`,
                color: C.amber, borderRadius: "4px",
                padding: "3px 9px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
              }}>
                {tag} <span style={{ opacity: 0.6, marginLeft: "2px", fontWeight: 400 }}>×</span>
              </button>
            ))}
          </div>
        )}
        {/* Suggested tags grid */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px" }}>
          {SUGGESTED_TAGS.filter(t => !form.tags.includes(t)).map(tag => (
            <button key={tag} type="button" onClick={() => toggleTag(tag)} style={{
              background: C.bgInput, border: `1px solid ${C.borderLo}`,
              color: C.textDim, borderRadius: "3px",
              padding: "2px 7px", fontSize: "11px", cursor: "pointer",
            }}>
              {tag}
            </button>
          ))}
        </div>
        {/* Custom tag input (comma-separated) */}
        <div style={{ display: "flex", gap: "6px" }}>
          <input style={{ ...inputStyle, flex: 1 }} value={form.tagInput}
            onChange={e => set("tagInput", e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTagsFromInput(); } }}
            placeholder="Custom tags, comma-separated…" />
          <button type="button" onClick={addTagsFromInput} style={{
            background: C.bgInput, border: `1px solid ${C.border}`,
            color: C.textDim, borderRadius: "4px", padding: "6px 10px",
            fontSize: "12px", cursor: "pointer",
          }}>
            Add
          </button>
        </div>
      </Field>

      {/* Photo Path */}
      <Field label="Photo Path">
        <input style={inputStyle} value={form.photoPath}
          onChange={e => set("photoPath", e.target.value)}
          placeholder="/inventory-images/tools/item.jpg" />
      </Field>

      {/* Notes */}
      <Field label="Notes">
        <textarea style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
          value={form.notes}
          onChange={e => set("notes", e.target.value)}
          placeholder="Quick notes, condition, purchase source…" />
      </Field>

      {/* Advanced / Additional Attributes */}
      <Field label={form.domain === "food-storage" || form.domain === "kitchen-preserving" ? "Additional Attributes" : "Custom Attributes (optional)"}>
        {Object.keys(form.attributes).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>
            {Object.entries(form.attributes).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: "8px", background: C.bgInset, borderRadius: "4px", padding: "5px 10px" }}>
                <span style={{ fontSize: "12px", color: C.amber, fontWeight: 700, minWidth: "80px" }}>{k}</span>
                <span style={{ fontSize: "13px", color: C.text, flex: 1 }}>{String(v)}</span>
                <button type="button" onClick={() => removeAttribute(k)} style={{
                  background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: "14px", padding: "0 4px",
                }}>×</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: "6px" }}>
          <input
            style={{ ...inputStyle, fontSize: "12px" }}
            value={attrKey}
            onChange={e => setAttrKey(e.target.value)}
            placeholder="key (e.g. expiry)"
          />
          <input
            style={{ ...inputStyle, fontSize: "12px" }}
            value={attrVal}
            onChange={e => setAttrVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addAttribute(); } }}
            placeholder="value (e.g. 2026-03)"
          />
          <button type="button" onClick={addAttribute} style={{
            background: C.bgInput, border: `1px solid ${C.border}`,
            color: C.textDim, borderRadius: "4px", padding: "6px 10px",
            fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap",
          }}>
            + Add
          </button>
        </div>
        <div style={{ fontSize: "11px", color: C.textDim, marginTop: "5px" }}>
          {form.domain === "food-storage" || form.domain === "kitchen-preserving"
            ? "Extra fields beyond the quick fields above — calories, brand, notes…"
            : "Domain-specific fields: condition, serialNum, calories, expiry…"
          }
        </div>
      </Field>

      {/* Actions */}
      <div style={{ display: "flex", gap: "8px", paddingTop: "4px" }}>
        <button type="submit" style={{
          background: C.bgInset, border: `1px solid ${C.green}44`,
          color: C.green, borderRadius: "5px", padding: "10px 20px",
          fontSize: "14px", cursor: "pointer", fontWeight: 700,
        }}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} style={{
          background: "transparent", border: `1px solid ${C.border}`,
          color: C.textDim, borderRadius: "5px", padding: "10px 16px",
          fontSize: "14px", cursor: "pointer",
        }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Domain-specific contextual quick fields ───────────────────────────────────
interface DomainFieldsProps {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}

function DomainContextualFields({ form, set }: DomainFieldsProps) {
  function attrStr(key: string): string { return String(form.attributes[key] ?? ""); }
  function setAttr(key: string, value: string | number | boolean) {
    set("attributes", { ...form.attributes, [key]: value });
  }

  if (form.domain === "food-storage") {
    return (
      <div style={{
        background: "#1a1e12", border: "1px solid #7a8c4240",
        borderLeft: "3px solid #7a8c42", borderRadius: "7px", padding: "14px",
        display: "flex", flexDirection: "column", gap: "12px",
      }}>
        <span style={{ fontSize: "11px", color: "#7a8c42", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
          🥫 Food Storage Fields
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Field label="Quantity">
            <input style={inputStyle} type="number" min={0} step="0.5"
              value={attrStr("quantity")}
              onChange={e => setAttr("quantity", parseFloat(e.target.value) || 0)}
              placeholder="0" />
          </Field>
          <Field label="Unit">
            <input style={inputStyle} value={attrStr("unit")}
              onChange={e => setAttr("unit", e.target.value)}
              list="elk-food-units" placeholder="cans, kg, bags, jars…" />
            <datalist id="elk-food-units">
              {["cans","kg","g","lbs","bags","jars","boxes","bottles","L","mL","servings","loaves"].map(u => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Field label="Expiry Date">
            <input style={inputStyle} type="month" value={attrStr("expiryDate")}
              onChange={e => setAttr("expiryDate", e.target.value)} />
          </Field>
          <Field label="Storage Type">
            <select style={inputStyle} value={attrStr("storageType")} onChange={e => setAttr("storageType", e.target.value)}>
              <option value="">— select —</option>
              <option value="pantry">Pantry</option>
              <option value="freezer">Freezer</option>
              <option value="fridge">Fridge</option>
              <option value="dry-storage">Dry Storage</option>
              <option value="cellar">Cellar</option>
              <option value="root-cellar">Root Cellar</option>
            </select>
          </Field>
        </div>
        <Field label="Opened?">
          <select style={inputStyle} value={attrStr("opened")} onChange={e => setAttr("opened", e.target.value)}>
            <option value="">— select —</option>
            <option value="unopened">Unopened / Sealed</option>
            <option value="opened">Opened</option>
            <option value="partial">Partially Used</option>
          </select>
        </Field>
      </div>
    );
  }

  if (form.domain === "kitchen-preserving") {
    return (
      <div style={{
        background: "#1c1710", border: "1px solid #8c6a3240",
        borderLeft: "3px solid #8c6a32", borderRadius: "7px", padding: "14px",
        display: "flex", flexDirection: "column", gap: "12px",
      }}>
        <span style={{ fontSize: "11px", color: "#8c6a32", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
          🫙 Kitchen / Preserving Fields
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Field label="Quantity">
            <input style={inputStyle} type="number" min={0}
              value={attrStr("quantity")}
              onChange={e => setAttr("quantity", parseInt(e.target.value) || 0)}
              placeholder="0" />
          </Field>
          <Field label="Unit">
            <input style={inputStyle} value={attrStr("unit")}
              onChange={e => setAttr("unit", e.target.value)}
              placeholder="jars, lids, pcs, sets…" />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Field label="Jar Size">
            <select style={inputStyle} value={attrStr("jarSize")} onChange={e => setAttr("jarSize", e.target.value)}>
              <option value="">— select —</option>
              <option value="125ml">125 ml</option>
              <option value="250ml">250 ml</option>
              <option value="500ml">500 ml</option>
              <option value="1L">1 Litre</option>
              <option value="1.5L">1.5 Litre</option>
              <option value="2L">2 Litre</option>
              <option value="4L">4 Litre</option>
            </select>
          </Field>
          <Field label="Lid Type">
            <select style={inputStyle} value={attrStr("lidType")} onChange={e => setAttr("lidType", e.target.value)}>
              <option value="">— select —</option>
              <option value="regular-mouth">Regular Mouth</option>
              <option value="wide-mouth">Wide Mouth</option>
              <option value="twist-off">Twist-Off</option>
              <option value="swing-top">Swing Top</option>
            </select>
          </Field>
        </div>
        <Field label="Storage Location">
          <input style={inputStyle} value={attrStr("storageLocation")}
            onChange={e => setAttr("storageLocation", e.target.value)}
            placeholder="e.g. pantry shelf, cellar, cabinet" />
        </Field>
      </div>
    );
  }

  return null;
}

// ── Field wrapper ─────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}
