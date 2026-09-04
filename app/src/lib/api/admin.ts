import { z } from 'zod';

import { APIError } from '@/lib/api/api-error';
import { safeJson } from '@/lib/api/typed-json';
import { logger } from '@/lib/logger';
import { markInstanceAnswered, markInstanceUnreachable } from '@/lib/state/instance-liveness';

const CSRF_COOKIE = 'csrftoken';

function readCSRFCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return match?.slice(CSRF_COOKIE.length + 1) ?? '';
}

function csrfHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const csrf = readCSRFCookie();
  csrf && (headers['X-Csrftoken'] = csrf);
  return headers;
}

async function doFetch(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: csrfHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
  }).catch((e: unknown) => {
    // Request never landed (network layer): the top-bar indicator needs to know
    // about this, then rethrow the error as usual.
    markInstanceUnreachable(0);
    throw e;
  });
  if (!res.ok) {
    return throwAPIError(res, `${method} ${path}`);
  }
  markInstanceAnswered();
  return res;
}

async function doFetchForm(method: string, path: string, form: FormData): Promise<Response> {
  const headers: Record<string, string> = {};
  const csrf = readCSRFCookie();
  csrf && (headers['X-Csrftoken'] = csrf);
  const res = await fetch(`/api/admin${path}`, {
    method, headers, body: form, credentials: 'include',
  });
  if (!res.ok) {
    return throwAPIError(res, `${method} ${path}`);
  }
  return res;
}

const ErrorBodySchema = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
});

// throwAPIError —— non-2xx → throws an APIError carrying status+code (reads code/message
// from the backend envelope; falls back to a canned sentence when it can't). Carrying status
// lets the caller branch (401 → login redirect / 409 → inline / everything else → toast).
// Always throws, return type is never.
async function throwAPIError(res: Response, op: string): Promise<never> {
  let code = '';
  let message = '';
  try {
    const body = await safeJson(res, ErrorBodySchema);
    code = body.error?.code ?? '';
    message = body.error?.message ?? '';
  } catch {
    // Envelope couldn't be read (not JSON / network layer) → leave message empty,
    // the fallback below supplies a human sentence.
  }
  // The request line goes to the log only: the owner needs it in the console
  // to locate the problem, but the screen must never show HTTP verbs or internal paths.
  logger.error(`admin api ${op} → ${res.status}`, message);
  markInstanceUnreachable(res.status);
  throw new APIError(res.status, code, message === '' ? humanFallback(res.status) : message);
}

// humanFallback —— when the backend doesn't supply a sentence, **this** must give
// one a human can read.
//
// The old fallback was `${method} ${path} failed: ${status}`, and about twenty
// sections printed message straight to the screen — when the backend actually
// went down in prod, `/admin/wiki` showed `GET /corpus/wiki failed: 500`
// (F-N-5). CLAUDE.md spells out the rule verbatim: "No raw stack traces, no exit
// codes, no technical jargon shown to the user." This lesson was already written
// into the product once (`use-obsidian.ts:70`: "a human sentence, never
// `import failed: 400`. The owner is not debugging"), it just hadn't been swept
// to this neighbor.
//
// Bucketed by status because the **next action** differs: 5xx means wait a
// moment and retry, 4xx means this particular request is invalid.
function humanFallback(status: number): string {
  if (status >= 500) {
    return 'the instance didn’t answer that — nothing was changed. Try again in a moment.';
  }
  if (status === 404) return 'that isn’t here any more — reload to see the current state.';
  if (status === 409) return 'something else changed this first — reload and redo your edit.';
  return 'that request was refused. Check the values and try again.';
}

export const adminAPI = {
  get:   <T>(path: string, s: z.ZodType<T>) => doFetch('GET', path).then((r) => safeJson(r, s)),
  put:   <T>(path: string, body: unknown, s: z.ZodType<T>) => doFetch('PUT', path, body).then((r) => safeJson(r, s)),
  post:  <T>(path: string, body: unknown, s: z.ZodType<T>) => doFetch('POST', path, body).then((r) => safeJson(r, s)),
  patch: <T>(path: string, body: unknown, s: z.ZodType<T>) => doFetch('PATCH', path, body).then((r) => safeJson(r, s)),

  deleteVoid:  (path: string) => doFetch('DELETE', path).then(() => undefined),
  postVoid:    (path: string, body: unknown) => doFetch('POST', path, body).then(() => undefined),
  putVoid:     (path: string, body: unknown) => doFetch('PUT', path, body).then(() => undefined),
  patchVoid:   (path: string, body: unknown) => doFetch('PATCH', path, body).then(() => undefined),

  postForm:  <T>(path: string, form: FormData, s: z.ZodType<T>) => doFetchForm('POST', path, form).then((r) => safeJson(r, s)),
  patchForm: <T>(path: string, form: FormData, s: z.ZodType<T>) => doFetchForm('PATCH', path, form).then((r) => safeJson(r, s)),
  postFormVoid:  (path: string, form: FormData) => doFetchForm('POST', path, form).then(() => undefined),
  patchFormVoid: (path: string, form: FormData) => doFetchForm('PATCH', path, form).then(() => undefined),
};

// ── schemas ─────────────────────────────────────────────────

export const AccessRequestViewSchema = z.object({
  id: z.string(), name: z.string(), org: z.string(), email: z.string(),
  message: z.string(), status: z.enum(['open', 'replied', 'closed']), created_at: z.string(),
});
export type AccessRequestView = z.infer<typeof AccessRequestViewSchema>;

export const RawMediaMetaSchema = z.object({ kind: z.string(), label: z.string() }).nullable().optional();

export const RawAdminViewSchema = z.object({
  id: z.string(), body: z.string(), source: z.string(), tags: z.array(z.string()),
  // preview —— a CLEAN lead excerpt (backend LeadLine: markup stripped). The card shows this,
  // not a raw substring of body, so excerpts read as rendered text not markup (F-R-1).
  preview: z.string().optional().default(''),
  created_at: z.string(),
  flagged_private: z.boolean().optional().default(false),
  media: RawMediaMetaSchema,
  // tree view only: this node can be drilled into (lazy layer).
  has_children: z.boolean().optional(),
});
export type RawAdminView = z.infer<typeof RawAdminViewSchema>;

export interface CreateRawInput { body: string; tags?: string[]; source?: string }

export const ConversationSummarySchema = z.object({
  id: z.string(), mode: z.string(), visitor_name: z.string(),
  sentiment: z.string().optional().default(''),
  started_at: z.string(), last_at: z.string(),
  turns: z.number(), private_hits: z.number().optional().default(0),
  hit_private: z.boolean().optional().default(false),
  code_id: z.string().nullable().optional(), code_label: z.string().nullable().optional(),
  code_value: z.string().nullable().optional(),
  client_ip: z.string().optional().default(''),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

const AISettingsViewSchema = z.object({
  provider: z.string(),
  endpoint: z.string().optional(),
  model: z.string().optional(),
  key_configured: z.boolean(),
});

const BYOAISettingsViewSchema = z.object({
  enabled: z.boolean(), providers: z.array(z.string()), public_blurb: z.string(),
});

export const SettingsViewSchema = z.object({ ai: AISettingsViewSchema, byoai: BYOAISettingsViewSchema });

export const OwnerProfileViewSchema = z.object({
  owner_id: z.string(), email: z.string(), handle: z.string(), full_name: z.string(),
  public_url: z.string(),
  // pending_email —— backend omitempty; the field is absent when there's nothing
  // pending confirmation → optional.
  pending_email: z.string().optional(),
});

export const MeViewSchema = z.object({ owner: OwnerProfileViewSchema, settings: SettingsViewSchema });
export type MeView = z.infer<typeof MeViewSchema>;

export const AIProviderPresetViewSchema = z.object({
  name: z.string(), label: z.string(), base_url: z.string(), key_prefix: z.string(),
});
export type AIProviderPresetView = z.infer<typeof AIProviderPresetViewSchema>;

export function fetchAIProviderPresets(): Promise<AIProviderPresetView[]> {
  return adminAPI.get('/ai-provider/presets', z.array(AIProviderPresetViewSchema));
}

export interface BYOAIUpdateInput { enabled: boolean; providers: string[]; blurb: string }

export const AllowedDomainsRespSchema = z.object({ domains: z.array(z.string()) });
