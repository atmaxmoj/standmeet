// /print/application/[id] —— gotenberg's Chromium loads this page, prints
// it to PDF, returns the bytes through MCP. NOT for end-user navigation:
// it's a render target. The token in the query string is one-shot — once
// the print-session endpoint serves it the data is gone.
//
// Server component (no client JS, no client fetch) so the page is fully
// rendered HTML by the time Chromium runs print — avoids networkidle
// race conditions on the gotenberg side.

import { notFound } from 'next/navigation';

import { ResumePuckRender } from '@/components/admin/resume-page/ResumePuckRender';
import {
  fetchPrintPayload,
  toResumeContent,
  type PrintPayloadWire,
} from '@/lib/admin/print-payload';

// Force dynamic — never cache; the token in the URL would defeat caching
// anyway, and the data is one-shot from Redis.
export const dynamic = 'force-dynamic';

interface SearchParams {
  t?: string;
}

export default async function PrintPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { t } = await searchParams;
  const payload = t ? await fetchPrintPayload(t) : null;
  return payload ? <PrintBody payload={payload} /> : notFound();
}

// The résumé is drawn by Puck's own <Render> from the same config as the editor (A3: one renderer).
// Pagination (résumé + optional cover-letter page) is handled inside that render via CSS breaks, so
// this route no longer computes pages or passes a separate job context — the job's role/company are
// draft metadata, not résumé content, so they are not printed.
function PrintBody({ payload }: { payload: PrintPayloadWire }) {
  const content = toResumeContent(payload.resume_content);
  return <ResumePuckRender content={content} qrURL={payload.qr_url} />;
}
