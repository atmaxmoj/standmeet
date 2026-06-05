// report-fetch —— I.3: /report/[id] 客户端拿 chat_report 的小 helper。
// 从 lib 抽出来让组件层守 no-`if` + complexity ≤ 3。

import { loadStoredSession } from '@/lib/gate/use-gate';

export type ReportLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; html: string }
  | { kind: 'error'; message: string };

export async function fetchReport(reportID: string): Promise<ReportLoadState> {
  const sess = loadStoredSession();
  if (sess === null) {
    return { kind: 'error', message: 'no session — open from chat first' };
  }
  const res = await fetch(`/api/v1/report/${reportID}`, {
    headers: { Authorization: `Bearer ${sess.session_token}` },
  });
  if (!res.ok) return { kind: 'error', message: `status ${res.status}` };
  const body: unknown = await res.json();
  const html = pickReportHTML(body);
  if (html === null) return { kind: 'error', message: 'malformed report body' };
  return { kind: 'ready', html };
}

function pickReportHTML(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const v = body['html'];
  return typeof v === 'string' && v !== '' ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
