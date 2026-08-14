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

// pagesFor —— 这份文档实际渲染哪几页。**页数只有这一个来源**：页脚的「/ M」由
// `pages.length` 得出，所以它不可能跟文档对不上（F-E-14：M 曾经写死在 i18n 文案里，
// 于是没有 cover letter 的一页简历也印着「page 1 / 2」）。
function pagesFor(content: ResumeContent): (0 | 1)[] {
  return (content.coverLetter ?? '').trim() !== '' ? [0, 1] : [0];
}

function PrintBody({ payload }: { payload: PrintPayloadWire }) {
  const content = toResumeContent(payload.resume_content);
  const job: JobContext = {
    role: payload.job_snapshot.title,
    company: payload.job_snapshot.company,
  };
  // pageCount 跟「渲染几页」是**同一个**判断，所以页脚的「/ M」不可能跟文档对不上
  // （F-E-14：M 曾经写死在 i18n 文案里，没有 cover letter 的一页简历也印「1 / 2」）。
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
