// ── /api/extract — recipe mode (for ELK Kitchen) ───────────────────────────────
// ELK Kitchen reaches this endpoint through a same-origin rewrite on its own
// Vercel project, so the OpenAI key stays here, behind the same family-only
// gate as Inventory's capture. A request opts in with `kind: "recipe"`; every
// other request is handled exactly as before.
//
// Input: one or more photos of a recipe card / book page (in reading order),
// optionally with typed text. Output: the recipe as written, for a person to
// review and correct before anything is saved. Nothing here writes data.

export const MAX_RECIPE_IMAGES = 6;
// Reading several handwritten pages can take longer than Vercel Edge's 25 s
// "first byte" limit, so the answer is streamed (see heartbeatJson).
export const RECIPE_OPENAI_TIMEOUT_MS = 70_000;
// Cost guard: a long recipe is well under this.
const RECIPE_MAX_OUTPUT_TOKENS = 4_000;
// Vercel rejects request bodies over ~4.5 MB; the Kitchen client shrinks
// photos well below this before sending.
export const MAX_RECIPE_IMAGE_TOTAL = 4_000_000;
const MAX_RECIPE_TEXT = 15_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const RECIPE_SYSTEM_PROMPT = `You transcribe family recipes from photos of recipe cards, cookbook pages, handwritten notes, or pasted text, for a family recipe app.

Several photos may be pages of ONE recipe, in order. Combine them into a single recipe.

Rules:
- Transcribe what is written. Never invent ingredients, amounts, times, temperatures, or steps that are not there. Keep the cook's own wording and units.
- ingredients: one entry per line as written, including amount and unit ("2 cups flour", "pinch of salt").
- instructions: one entry per step, in order. If the method is one paragraph, split it into sentences that are steps.
- servings, prepTime, cookTime, source: only if written; otherwise null. source is a person, book, or website named on the card ("Grandma Jean", "Joy of Cooking p. 212").
- notes: tips, variations, or margin notes written on the card; empty string if none.
- tags: up to 5 short lowercase words a family would search by (e.g. "dessert", "chicken", "soup"), based only on the recipe.
- unclear: list every word or amount you could not read with confidence, quoting what you think it says, e.g. "1 ? cups sugar — fraction smudged". Empty list if everything is legible.
- If the input contains no recipe at all, set title to "" and leave the lists empty.`;

export const RECIPE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    servings: { type: ["string", "null"] },
    prepTime: { type: ["string", "null"] },
    cookTime: { type: ["string", "null"] },
    source: { type: ["string", "null"] },
    ingredients: { type: "array", items: { type: "string" } },
    instructions: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    unclear: { type: "array", items: { type: "string" } },
  },
  required: ["title", "servings", "prepTime", "cookTime", "source", "ingredients", "instructions", "notes", "tags", "unclear"],
  additionalProperties: false,
};

export type RecipeRequest =
  | { ok: true; text: string; images: { base64: string; mediaType: string }[] }
  | { ok: false; error: string };

export function isRecipeRequest(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { kind?: unknown }).kind === "recipe";
}

export function parseRecipeRequest(body: unknown): RecipeRequest {
  const b = (body ?? {}) as { text?: unknown; images?: unknown };
  const text = typeof b.text === "string" ? b.text.trim().slice(0, MAX_RECIPE_TEXT) : "";
  const raw = Array.isArray(b.images) ? b.images : [];
  if (raw.length > MAX_RECIPE_IMAGES) return { ok: false, error: `At most ${MAX_RECIPE_IMAGES} photos per recipe` };
  const images: { base64: string; mediaType: string }[] = [];
  let total = 0;
  for (const img of raw) {
    const { base64, mediaType } = (img ?? {}) as { base64?: unknown; mediaType?: unknown };
    if (typeof base64 !== "string" || !base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
      return { ok: false, error: "Invalid photo" };
    }
    const type = typeof mediaType === "string" && IMAGE_TYPES.has(mediaType) ? mediaType : "image/jpeg";
    total += base64.length;
    images.push({ base64, mediaType: type });
  }
  if (total > MAX_RECIPE_IMAGE_TOTAL) return { ok: false, error: "Photos too large" };
  if (!text && images.length === 0) return { ok: false, error: "No text or photo provided" };
  return { ok: true, text, images };
}

export function buildRecipeOpenAIBody(input: { text: string; images: { base64: string; mediaType: string }[] }, model: string): string {
  const content: Array<Record<string, unknown>> = [];
  content.push({
    type: "text",
    text: input.text || (input.images.length > 1
      ? `Transcribe the recipe on these ${input.images.length} pages, in order.`
      : "Transcribe the recipe in this photo."),
  });
  for (const img of input.images) {
    // detail: high — handwriting and small print need the full resolution.
    content.push({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.base64}`, detail: "high" } });
  }
  return JSON.stringify({
    model,
    temperature: 0,
    max_tokens: RECIPE_MAX_OUTPUT_TOKENS,
    messages: [
      { role: "system", content: RECIPE_SYSTEM_PROMPT },
      { role: "user", content },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "recipe_transcription", strict: true, schema: RECIPE_RESPONSE_SCHEMA },
    },
  });
}

/**
 * A 200 JSON response that starts at once and sends a space every few seconds
 * (leading whitespace is valid JSON) until `work` finishes, then its result.
 * Keeps slow multi-page reads alive past Vercel Edge's 25 s first-byte limit.
 * Because the status is sent first, a failure arrives as `{ "error": … }`.
 */
export function heartbeatJson(work: () => Promise<unknown>, everyMs = 5_000): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(enc.encode(" "));
      const beat = setInterval(() => controller.enqueue(enc.encode(" ")), everyMs);
      let result: unknown;
      try {
        result = await work();
      } catch (err) {
        result = { error: `Extraction failed: ${err instanceof Error ? err.message : "Unknown error"}` };
      }
      clearInterval(beat);
      controller.enqueue(enc.encode(JSON.stringify(result)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
