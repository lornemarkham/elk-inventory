// ── /api/extract — AI extraction endpoint ──────────────────────────────────────
// The ONLY place OPENAI_API_KEY is ever read. Never expose this key to the
// browser (never prefix it VITE_, never return it in a response). This is a
// Vercel Edge Function — plain Web-standard Request/Response, no Node APIs,
// no new npm dependency (calls OpenAI's REST API directly via fetch).
//
// Accepts EITHER `text` (pasted order pages, notes, receipts) OR `imageBase64`
// (a photo of a delivery, packing slip, or product) — same model
// (gpt-4o-mini is already multimodal, no model change needed), same schema,
// same response shape either way. The caller never needs a different code
// path for "I photographed something" vs. "I pasted something."
//
// Client caller: src/lib/aiExtractor.ts
// Fallback on failure — text only, images have no deterministic fallback:
//   src/lib/purchaseParser.ts's parseCaptureText / extractInventoryDrafts

export const config = { runtime: "edge" };

const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 30_000; // vision calls run slower than text-only; hard ceiling so the request can never hang forever
const MAX_INPUT_CHARS = 15_000; // cost/context guard — mirrors MAX_PRODUCTS_PER_CAPTURE's spirit on the input side
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // ~8MB base64 guard, generous for a phone photo

const SYSTEM_PROMPT = `You extract physical products worth tracking in a personal inventory app from either pasted text or a photo.

Text input might be an Amazon order history page, a Home Depot receipt, a forwarded order confirmation email, a product page, or just a short note about something someone bought or found.

Photo input might be a delivery box, a shipping label, a packing slip, or the product itself sitting on a counter or shelf. Read any visible text (labels, slips, boxes) the same way you would pasted text. If the photo just shows a recognizable product with no text, identify it from its appearance.

Rules:
- Return one entry per distinct physical product. If only one item is described or shown, return exactly one entry.
- Ignore site/packaging chrome: navigation, buttons ("Buy it again", "Track package", "Write a review"), account info, ads, shipping/delivery status text, barcodes, and anything that isn't naming an actual product.
- Never invent information that isn't present in the text or clearly visible in the photo. Use null for anything not stated or shown — do not guess a price, brand, or date that isn't there.
- quantity defaults to 1 if not stated.
- purchaseDate must be ISO 8601 (YYYY-MM-DD) if present, otherwise null.
- confidence (0 to 1) reflects how sure you are this is a genuine, distinct product rather than noise you're uncertain about.
- If you cannot find any real product, return an empty products array rather than fabricating one.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: "integer" },
          brand: { type: ["string", "null"] },
          model: { type: ["string", "null"] },
          vendor: { type: ["string", "null"] },
          price: { type: ["number", "null"] },
          currency: { type: ["string", "null"] },
          purchaseDate: { type: ["string", "null"], description: "ISO 8601 date, YYYY-MM-DD" },
          productUrl: { type: ["string", "null"] },
          category: { type: ["string", "null"], description: "A short general category guess, e.g. 'power tool', 'kitchen', 'automotive'" },
          confidence: { type: "number" },
        },
        required: ["name", "quantity", "brand", "model", "vendor", "price", "currency", "purchaseDate", "productUrl", "category", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["products"],
  additionalProperties: false,
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Debug instrumentation only — prefixes every step log with a timestamp so
// it can be correlated against public/debug-image.html's client-side timeline.
function ts(): string {
  return new Date().toISOString();
}

export default async function handler(request: Request): Promise<Response> {
  // 1. Request received
  console.log(`[api/extract] ${ts()} 1. Request received`, { method: request.method, url: request.url });

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[api/extract] OPENAI_API_KEY is not set");
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  let body: { text?: unknown; imageBase64?: unknown; imageMediaType?: unknown };
  try {
    body = await request.json();
    // 2. Request body parsed
    console.log(`[api/extract] ${ts()} 2. Request body parsed`, { keys: Object.keys(body) });
  } catch (err) {
    console.error("[api/extract] Failed to parse request body:", err);
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  const imageMediaType = typeof body.imageMediaType === "string" && body.imageMediaType ? body.imageMediaType : "image/jpeg";

  if (!text && !imageBase64) {
    return jsonResponse({ error: "No text or image provided" }, 400);
  }
  if (imageBase64.length > MAX_IMAGE_BYTES) {
    return jsonResponse({ error: "Image too large" }, 400);
  }

  // 3. Input validation complete
  console.log(`[api/extract] ${ts()} 3. Input validation complete`, {
    textLen: text.length,
    hasImage: !!imageBase64,
    imageBase64Len: imageBase64.length,
    imageMediaType,
  });

  // Build the same "content" shape either way — one text part, one image
  // part, or both. gpt-4o-mini reads both in the same request.
  const userContent: Array<Record<string, unknown>> = [];
  if (text) {
    userContent.push({ type: "text", text: text.slice(0, MAX_INPUT_CHARS) });
  }
  if (imageBase64) {
    if (!text) userContent.push({ type: "text", text: "Extract the products shown or described in this photo." });
    userContent.push({ type: "image_url", image_url: { url: `data:${imageMediaType};base64,${imageBase64}` } });
  }

  // Attached to every log line below so a failure or an empty result can be
  // traced back to what was actually sent, without dumping the base64 image
  // itself into the logs.
  const inputMeta = `text=${text ? `${text.length}chars` : "none"} image=${imageBase64 ? `${imageMediaType},${imageBase64.length}b64chars` : "none"}`;

  // This endpoint calls OpenAI's REST API directly via fetch (no SDK client
  // object to instantiate) — steps 4/5 below bracket the equivalent moment:
  // building the request we're about to send.
  // 4. Before creating the OpenAI client (n/a here — building the raw fetch request instead)
  console.log(`[api/extract] ${ts()} 4. Before building OpenAI request`, { inputMeta });

  const requestBody = JSON.stringify({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "inventory_drafts", strict: true, schema: RESPONSE_SCHEMA },
    },
  });

  // 5. After creating the OpenAI client (n/a here — request payload is built)
  console.log(`[api/extract] ${ts()} 5. OpenAI request payload built`, { bodyBytes: requestBody.length });

  try {
    // 6. Immediately before the OpenAI API call
    console.log(`[api/extract] ${ts()} 6. Calling OpenAI now`, { timeoutMs: OPENAI_TIMEOUT_MS });

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody,
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });

    // 7. Immediately after the OpenAI API call
    console.log(`[api/extract] ${ts()} 7. OpenAI call returned`, { status: openaiRes.status, ok: openaiRes.ok });

    if (!openaiRes.ok) {
      const detail = await openaiRes.text().catch(() => "");
      console.error(`[api/extract] OpenAI error ${openaiRes.status} (${inputMeta}):`, detail);
      const errRes = jsonResponse({ error: `OpenAI request failed (${openaiRes.status})` }, 502);
      console.log(`[api/extract] ${ts()} 8. Before returning the HTTP response`, { status: 502 });
      return errRes;
    }

    const completion = await openaiRes.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      console.error(`[api/extract] Unexpected OpenAI response shape (${inputMeta}). Full completion:`, JSON.stringify(completion));
      console.log(`[api/extract] ${ts()} 8. Before returning the HTTP response`, { status: 502 });
      return jsonResponse({ error: "Empty or malformed response from OpenAI" }, 502);
    }

    // Structured Outputs (strict mode) guarantees `content` is valid JSON
    // matching RESPONSE_SCHEMA exactly — still guarded in case that ever
    // isn't true (a bad deploy, a model change, a truncated response).
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error(`[api/extract] OpenAI content was not valid JSON (${inputMeta}):`, content);
      console.log(`[api/extract] ${ts()} 8. Before returning the HTTP response`, { status: 502 });
      return jsonResponse({ error: "OpenAI returned invalid JSON" }, 502);
    }

    const products = (parsed as { products?: unknown[] })?.products;
    if (Array.isArray(products) && products.length === 0) {
      // Not an error, but the single most useful case to have full context
      // for — "the model looked and decided there was nothing" is exactly
      // what a bad photo capture looks like from the outside. Log the whole
      // completion (finish_reason, usage, etc.), not just the empty array.
      console.info(`[api/extract] AI found zero products (${inputMeta}). Full completion:`, JSON.stringify(completion));
    }

    // 8. Before returning the HTTP response
    console.log(`[api/extract] ${ts()} 8. Before returning the HTTP response`, { status: 200, productCount: products?.length });
    return jsonResponse(parsed, 200);
  } catch (err) {
    // Full error object, not just .message — a hang/abort/network failure
    // needs .name and .cause too (e.g. AbortError vs TypeError vs DNS failure).
    console.error(`[api/extract] Extraction failed (${inputMeta}). Full error object:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    console.log(`[api/extract] ${ts()} 8. Before returning the HTTP response`, { status: 502 });
    return jsonResponse({ error: `Extraction failed: ${message}` }, 502);
  }
}
