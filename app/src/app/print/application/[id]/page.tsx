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

function PrintBody({ payload }: { payload: PrintPayloadWire }) {
  const content = toResumeContent(payload.resume_content);
  const job: JobContext = {
    role: payload.job_snapshot.title,
    company: payload.job_snapshot.company,
  };
  const hasCover = (content.coverLetter ?? '').trim() !== '';
  return (
    <div className={styles.printSurface}>
      <ResumePage content={content} job={job} qrURL={payload.qr_url} pageIndex={0} />
      {hasCover ? (
        <ResumePage content={content} job={job} qrURL={payload.qr_url} pageIndex={1} />
      ) : null}
    </div>
  );
}
