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
    // 请求没到（网络层）：顶栏那颗灯要知道这件事，然后把错误照常抛出去。
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

// throwAPIError —— 非 2xx → 抛带 status+code 的 APIError（读后端 envelope 的 code/message；读不出用
// 兜底句）。带 status 让调用方能分流（401 跳登录 / 409 就地 / 其余 toast）。恒抛，返回 never。
async function throwAPIError(res: Response, op: string): Promise<never> {
  let code = '';
  let message = '';
  try {
    const body = await safeJson(res, ErrorBodySchema);
    code = body.error?.code ?? '';
    message = body.error?.message ?? '';
  } catch {
    // envelope 读不出（非 JSON / 网络层）→ message 留空，下面给人话
  }
  // 请求行只进日志：owner 要定位问题时它在控制台里，而屏幕上不该出现 HTTP 动词和内部路径。
  logger.error(`admin api ${op} → ${res.status}`, message);
  markInstanceUnreachable(res.status);
  throw new APIError(res.status, code, message === '' ? humanFallback(res.status) : message);
}

// humanFallback —— 后端没给出一句话时，**这里**必须给一句人能读的。
//
// 原来的兜底是 `${method} ${path} failed: ${status}`，而二十来处 section 直接把 message
// 印在屏幕上 —— prod 上真停一次 backend，`/admin/wiki` 写的就是 `GET /corpus/wiki failed: 500`
// （F-N-5）。CLAUDE.md 的规矩逐字写着「No raw stack traces, no exit codes, no technical
// jargon shown to the user」。这条经验产品里已经写过一次（`use-obsidian.ts:70`：
// 「a human sentence, never `import failed: 400`. The owner is not debugging」），只是没扫到邻居。
//
// 按状态分档，因为**下一步动作**不同：5xx 等一会儿再来，4xx 是这次请求本身不成立。
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

export type { PageWhere, PageContact } from '@/lib/api/public';

// AdminPage / pinnable —— admin /page 编辑面的形状 + pin 候选。insights/projects
// 在这一面是 corpus pin 列表(wiki id),渲染面在公开 /api/v1/page 才 join 成卡。
import {
  AdminPageSchema, PinnableListSchema,
  type AdminPage, type PinnableEntry,
} from '@/lib/api/public-schemas';

export { AdminPageSchema, PinnableListSchema };
export type { AdminPage, PinnableEntry };

export function fetchPinnable(): Promise<PinnableEntry[]> {
  return adminAPI.get('/page/pinnable', PinnableListSchema);
}
