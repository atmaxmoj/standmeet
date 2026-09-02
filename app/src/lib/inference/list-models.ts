// list-models.ts —— client wrapper for POST /api/v1/inference/models.
//
// Entry point for the "Load models" button: UI picks a provider + fills in
// endpoint + key, then clicks the button; the server proxies the upstream
// OpenAI-compat /v1/models to pull the real available list, and the UI
// swaps the input for a dropdown. **No auth**: the caller must know
// (endpoint, key) to call it — the server is just a proxy and holds no
// risky state.
//
// Error handling: HTTP 4xx/5xx → throw Error with server's message. Typical
// scenarios:
//   - Anthropic doesn't expose /v1/models → "list models: provider does not
//     expose a model list; type model id manually"
//   - upstream 401/403 → "list models: upstream 401: ..."
// The caller takes error.message and toasts it directly.

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { safeJson } from '@/lib/api/typed-json';

const ENDPOINT = '/api/v1/inference/models';

export interface ListModelsInput {
  provider: string;
  endpoint: string;
  key: string;
}

const ListModelsResponseSchema = z.object({ models: z.array(z.string()) });
const ErrorEnvelopeSchema = z.object({ error: z.object({ message: z.string().optional() }).optional() });

// listOwnerModels —— the owner's side: **sends no key**.
//
// The owner's key lives on the server and the page never reads it back, so
// this button used to send an empty key, the backend returned `key
// required` 400, and nothing showed up on screen — once saved once, the
// button was never clickable again (F-R-11). This path uses the owner's own
// authenticated route instead: the server takes the key it has stored and
// asks upstream with it.
export async function listOwnerModels(): Promise<string[]> {
  const body = await adminAPI.post('/providers/models', {}, ListModelsResponseSchema);
  return body.models;
}

export async function listModels(input: ListModelsInput): Promise<string[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const body = await safeJson(res, ListModelsResponseSchema);
  return body.models;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = await safeJson(res, ErrorEnvelopeSchema);
    return body.error?.message ?? `list models failed: ${res.status}`;
  } catch {
    return `list models failed: ${res.status}`;
  }
}
