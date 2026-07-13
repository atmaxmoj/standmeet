import { z } from 'zod';

import { APIError } from '@/lib/api/api-error';
import { safeJson } from '@/lib/api/typed-json';

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
  });
  if (!res.ok) {
    return throwAPIError(res, `${method} ${path}`);
  }
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

// throwAPIError —— 非 2xx → 抛带 status+code 的 APIError（读后端 envelope 的 code/message；读不出用
// 兜底串）。带 status 让调用方能分流（401 跳登录 / 409 就地 / 其余 toast）。恒抛，返回 never。
async function throwAPIError(res: Response, op: string): Promise<never> {
  const fallback = `${op} failed: ${res.status}`;
  let code = '';
  let message = fallback;
  try {
    const body = await safeJson(res, ErrorBodySchema);
    code = body.error?.code ?? '';
    message = body.error?.message ?? fallback;
  } catch {
    // envelope 读不出（非 JSON / 网络层）→ 用兜底串
  }
  throw new APIError(res.status, code, message);
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
  created_at: z.string(),
  flagged_private: z.boolean().optional().default(false),
  archived: z.boolean().optional().default(false),
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
  owner_id: z.string(), email: z.string(), handle: z.string(), full_name: z.string(), public_url: z.string(),
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

export type { PageContent, PageInsight, PageProject, PageWhere, PageContact } from '@/lib/api/public';
