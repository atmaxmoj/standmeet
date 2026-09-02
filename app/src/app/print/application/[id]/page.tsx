// /print/application/[id] —— gotenberg's Chromium loads this page, prints
// it to PDF, returns the bytes through MCP. NOT for end-user navigation:
// it's a render target. The token in the query string is one-shot — once
// the print-session endpoint serves it the data is gone.
//
// Server component (no client JS, no client fetch) so the page is fully
// rendered HTML by the time Chromium runs print — avoids networkidle
// race conditions on the gotenberg side.

import { notFound } from 'next/navigation';

import { ResumePage, type JobContext } from '@/components/admin/resume-page/ResumePage';
import type { ResumeContent } from '@/lib/admin/resume-content';
import {
  fetchPrintPayload,
  toResumeContent,
  type PrintPayloadWire,
} from '@/lib/admin/print-payload';

import styles from '@/app/print/application/[id]/page.module.css';

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

// pagesFor — which pages this document actually renders. **Page count has
// only this one source**: the footer's "/ M" is derived from
// `pages.length`, so it can never drift from the document (F-E-14: M used
// to be hardcoded in i18n copy, so a one-page resume with no cover letter
// still printed "page 1 / 2").
function pagesFor(content: ResumeContent): (0 | 1)[] {
  return (content.coverLetter ?? '').trim() !== '' ? [0, 1] : [0];
}

function PrintBody({ payload }: { payload: PrintPayloadWire }) {
  const content = toResumeContent(payload.resume_content);
  const job: JobContext = {
    role: payload.job_snapshot.title,
    company: payload.job_snapshot.company,
  };
  // pageCount is the **same** judgment as "which pages render", so the
  // footer's "/ M" can never drift from the document (F-E-14: M used to be
  // hardcoded in i18n copy, so a one-page resume with no cover letter still
  // printed "1 / 2").
  const pages = pagesFor(content);
  return (
    <div className={styles.printSurface}>
      {pages.map((i) => (
        <ResumePage
          key={i} content={content} job={job} qrURL={payload.qr_url}
          pageIndex={i} pageCount={pages.length === 2 ? 2 : 1}
        />
      ))}
    </div>
  );
}
