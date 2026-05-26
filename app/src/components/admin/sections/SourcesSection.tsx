// SourcesSection —— /admin/sources。design 源 admin.js SourcesSection
// (1305-1343) + SourceConfigModal (1223-1303)。job 拉数据的 feed 源列表 +
// "+ board" / "+ rss/scraper" 入口。表格 (source / kind / new / total / last / status)。
//
// 当前没有 admin REST endpoint for job_sources list —— 直接用 MCP
// list_sources；admin 这里先走 stub 空态 + 按 design 画好 UI 结构，等
// 后端补 GET /api/admin/job-sources/ 再切真 fetch。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';

export function SourcesSection() {
  return (
    <>
      <SectionHeader
        kicker="jobs · sources"
        title="sources"
        count="0 active"
        action={<ActionBtns />}
      />
      <Intro />
      <EmptyState />
    </>
  );
}

function ActionBtns() {
  return (
    <div className="flex gap-2">
      <button className="sm-btn sm-btn-outline sm-btn-sm" type="button">+ rss / scraper</button>
      <button className="sm-btn sm-btn-solid sm-btn-sm" type="button">+ board</button>
    </div>
  );
}

function Intro() {
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      Where the loop pulls listings from. Greenhouse / Lever / Wellfound are first-class; RSS and HTML scrapers
      are also supported. Each source is scanned every 30 minutes. Register sources via MCP{' '}
      <span className="mono text-(--color-ink)">jobs.register_source</span>.
    </p>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-(--color-rule) rounded-[3px] p-9 text-center">
      <div className="sm-smallcaps mb-1.5">no sources registered</div>
      <div className="font-serif text-[18px] text-(--color-ink)">Connect a job board or RSS feed.</div>
      <p className="reading text-[14px] text-(--color-muted) max-w-[36em] mx-auto mt-2">
        Ask Claude to run <span className="mono text-(--color-ink)">jobs.register_source</span> with
        a Greenhouse / Lever / RSS URL — it shows up here automatically.
      </p>
    </div>
  );
}
