// ── AI extraction client ───────────────────────────────────────────────────────
// Calls the server-side /api/extract function (../../api/extract.ts), which
// is the only place the OpenAI key ever lives. This file has exactly one job:
// call that endpoint with either text or a photo, and report whether it
// produced something usable. It has no opinion on what happens next if it
// fails — that's the caller's job. Text failures fall back to the
// deterministic parser (extractInventoryDrafts in purchaseParser.ts); photo
// failures have no deterministic fallback (see extractInventoryDraftsFromImage).

const TIMEOUT_MS = 25_000; // vision calls run slower than text-only

export interface RawAiProduct {
  name: string;
  quantity: number;
  brand: string | null;
  model: string | null;
  vendor: string | null;
  price: number | null;
  currency: string | null;
  purchaseDate: string | null;
  productUrl: string | null;
  category: string | null;
  confidence: number;
}

export type AiExtractionResult =
  | { ok: true; products: RawAiProduct[] }
  | { ok: false; reason: string; detail?: unknown };

export type AiExtractionInput =
  | { text: string }
  | { imageBase64: string; imageMediaType: string };

function isRawAiProduct(v: unknown): v is RawAiProduct {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.name === "string" && typeof p.quantity === "number";
}

export async function extractWithAI(input: AiExtractionInput): Promise<AiExtractionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return { ok: false, reason: `HTTP ${res.status}`, detail: bodyText };
    }

    const data: unknown = await res.json();
    const products = (data as { products?: unknown })?.products;

    if (!Array.isArray(products) || !products.every(isRawAiProduct)) {
      return { ok: false, reason: "response did not match the expected schema", detail: data };
    }
    if (products.length === 0) {
      // Not necessarily wrong, but the deterministic (text) parser always
      // finds *something* — treating a genuine zero as a soft failure keeps
      // "never block capture" true for text regardless of engine. For
      // photos there's no fallback either way, but the caller still wants
      // to know "AI looked and found nothing" distinctly from "AI broke."
      return { ok: false, reason: "AI found no products", detail: data };
    }

    return { ok: true, products };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    const reason = err instanceof Error ? err.message : "unknown error";
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
