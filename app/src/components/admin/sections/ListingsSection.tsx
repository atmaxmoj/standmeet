// ListingsSection —— /admin/listings。design 源 admin.js ListingsSection
// (1348-1406)。5-tab status filter + table (role / match / comp / posted / status)。
// 当前无 admin REST for job_listings —— stub empty state。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';

export function ListingsSection() {
  return (
    <>
      <SectionHeader kicker="jobs · listings" title="listings" count="0 indexed" />
      <Intro />
      <EmptyState />
    </>
  );
}

function Intro() {
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      Jobs fetched from your registered sources, ranked by corpus match. Shortlist → tells Claude
      which to draft a resume for. Pool TTL 1 day; missed it, fetch again via MCP{' '}
      <span className="mono text-(--color-ink)">jobs.fetch_new</span>.
    </p>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-(--color-rule) rounded-[3px] p-9 text-center">
      <div className="sm-smallcaps mb-1.5">no listings indexed</div>
      <div className="font-serif text-[18px] text-(--color-ink)">Fetch jobs from your sources first.</div>
      <p className="reading text-[14px] text-(--color-muted) max-w-[36em] mx-auto mt-2">
        Ask Claude to run <span className="mono text-(--color-ink)">jobs.fetch_new</span> —
        results land here ranked by match score.
      </p>
    </div>
  );
}
