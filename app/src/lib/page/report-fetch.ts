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

export type PDFDownloadResult = { ok: true } | { ok: false; message: string };

// downloadReportPDF —— fetch the report's PDF (visitor-authed) as a blob and
// trigger a browser download. Bearer-authed so a plain <a href> won't do.
export async function downloadReportPDF(reportID: string): Promise<PDFDownloadResult> {
  const sess = loadStoredSession();
  if (sess === null) {
    return { ok: false, message: 'no session — open from chat first' };
  }
  const res = await fetch(`/api/v1/report/${reportID}/pdf`, {
    headers: { Authorization: `Bearer ${sess.session_token}` },
  });
  if (!res.ok) return { ok: false, message: `status ${res.status}` };
  triggerBlobDownload(await res.blob(), `report-${reportID}.pdf`);
  return { ok: true };
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Defer cleanup: revoking the object URL (or removing the anchor) synchronously
  // in the same tick as click() races Chromium's download start — it drops the
  // download attribute and the file lands as the bare blob UUID with no .pdf
  // extension. A macrotask later the download has been handed off; cleanup is safe.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

function pickReportHTML(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const v = body['html'];
  return typeof v === 'string' && v !== '' ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
