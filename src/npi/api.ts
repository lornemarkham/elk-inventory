// ── NPI demo — browser client for api/npi-* (TEMPORARY DEMO) ─────────────────
import type { ConfidenceScore, ProviderDetail, SearchResponse, ValidationEvent, ValidationResult } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const searchProviders = (q: string) => getJson<SearchResponse>(`/api/npi-search?q=${encodeURIComponent(q)}`);

export const fetchProvider = (npi: string) =>
  getJson<{ provider: ProviderDetail; baseline: ConfidenceScore }>(`/api/npi-provider?npi=${npi}`);

export async function streamValidation(npi: string, fresh: boolean, onEvent: (e: ValidationEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/npi-validate?npi=${npi}${fresh ? "&fresh=1" : ""}`, { signal });
  if (!res.ok || !res.body) throw new Error(`Validation request failed (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as ValidationEvent);
    }
  }
}

// Client-side cache so repeat demos don't spend OpenAI credits.
const KEY = (npi: string) => `npi-validation:v1:${npi}`;

export function loadCachedValidation(npi: string): ValidationResult | null {
  try {
    const raw = localStorage.getItem(KEY(npi));
    return raw ? (JSON.parse(raw) as ValidationResult) : null;
  } catch {
    return null;
  }
}

export function saveCachedValidation(result: ValidationResult): void {
  try {
    localStorage.setItem(KEY(result.npi), JSON.stringify(result));
  } catch {
    /* storage full / private mode — caching is best-effort */
  }
}
