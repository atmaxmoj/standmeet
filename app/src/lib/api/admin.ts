// admin.ts —— admin API client。
//
// CSRF: backend 在 login / claim 时写 csrftoken cookie；admin 前端在
// mutating 请求里把 cookie 值塞 X-Csrftoken header。这里集中处理，
// 让 callers 写 admin.put('/page', body) 就够了。

const CSRF_COOKIE = 'csrftoken';

function readCSRFCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return match?.slice(CSRF_COOKIE.length + 1) ?? '';
}

async function adminFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const csrf = readCSRFCookie();
  csrf && (headers['X-Csrftoken'] = csrf);
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await readError(res, `${method} ${path}`);
    throw new Error(err);
  }
  if (res.status === 204) return undefined as unknown as T;
  return await res.json() as T;
}

async function readError(res: Response, op: string): Promise<string> {
  try {
    const body = await res.json() as { error?: { message?: string } };
    return body.error?.message ?? `${op} failed: ${res.status}`;
  } catch {
    return `${op} failed: ${res.status}`;
  }
}

export const adminAPI = {
  get: <T>(path: string) => adminFetch<T>('GET', path),
  put: <T>(path: string, body: unknown) => adminFetch<T>('PUT', path, body),
  post: <T>(path: string, body: unknown) => adminFetch<T>('POST', path, body),
  delete: <T>(path: string) => adminFetch<T>('DELETE', path),
};

// Typed views (re-export from public types where shapes match).
export interface RawAdminView {
  id: string;
  body: string;
  source: string;
  tags: string[];
  created_at: string;
  flagged_private: boolean;
  archived: boolean;
}

export type { PageContent, PageInsight, PageProject, PageWhere, PageContact } from './public';
