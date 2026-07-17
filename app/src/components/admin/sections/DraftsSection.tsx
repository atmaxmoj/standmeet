// DraftsSection —— /admin/drafts。owner 看 job-loop 路径里 Claude 起的
// resume drafts，每个 card 可"open composer →"进 ResumeComposer。
//
// 设计源 docs/design/project/admin.js DraftsSection + DraftCard (1756-1822)。
//
// 数据走 GET /api/admin/drafts 真 fetch（后端 listResumeDraftsByOwner SQL
// 已落）。Composer 打开的 model 仍走 mockDraft 占位 —— 详情 jsonb fetch +
// patch endpoint 在后续 commit 上。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ResumeComposer } from '@/components/admin/ResumeComposer';
import { DraftThumb } from '@/components/admin/sections/drafts/DraftThumb';
import { useDraftDetail } from '@/lib/admin/draft-detail';
import type { DraftModel } from '@/lib/admin/draft-model';
import { listViewKind } from '@/lib/admin/list-view-kind';
import {
  draftActionKind,
  draftPillTone,
  useAdminDrafts,
  type AdminDraftRow,
} from '@/lib/admin/use-admin-drafts';

export function DraftsSection() {
  const { rows, loading, error } = useAdminDrafts();
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useDraftDetail(openId);
  return (
    <>
      <SectionHeader
        kicker="jobs · resume drafts"
        title="drafts"
        count={titleCount(rows.length, loading)}
      />
      <Intro />
      <DraftListBody rows={rows} loading={loading} error={error} onOpen={setOpenId} />
      <ComposerHost model={detail.model} onClose={() => setOpenId(null)} />
    </>
  );
}

function ComposerHost({
  model, onClose,
}: { model: DraftModel | null; onClose: () => void }) {
  return model === null
    ? null
    : <ResumeComposer initial={model} onClose={onClose} onSend={onClose} />;
}

function titleCount(n: number, loading: boolean): string {
  return loading ? 'loading…' : `${n} pending`;
}

// ink —— t.rich 的 <ink> 标签：把句中要强调的词提到 ink 色。
const ink = (chunks: React.ReactNode) => (
  <span className="text-(--color-ink)">{chunks}</span>
);

function Intro() {
  const t = useTranslations('adminJobs');
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      {t.rich('drafts.intro', { ink })}
    </p>
  );
}

function DraftListBody(props: {
  rows: readonly AdminDraftRow[];
  loading: boolean;
  error: string | null;
  onOpen: (id: string) => void;
}) {
  const kind = listViewKind(props.loading, props.error, props.rows.length);
  const map = {
    loading: <Loading />,
    error: <LoadError msg={props.error ?? ''} />,
    empty: <EmptyState />,
    list: <DraftList rows={props.rows} onOpen={props.onOpen} />,
  } as const;
  return map[kind];
}

function Loading() {
  const t = useTranslations('adminJobs');
  return (
    <p className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted)">
      {t('drafts.loading')}
    </p>
  );
}

function LoadError({ msg }: { msg: string }) {
  return (
    <p
      className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-accent)"
      data-testid="drafts-error"
    >
      {msg}
    </p>
  );
}

function EmptyState() {
  const t = useTranslations('adminJobs');
  return (
    <div className="p-6 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/40 text-center">
      <p className="font-serif text-(--color-ink) text-[18px]">{t('drafts.emptyTitle')}</p>
      <p className="reading text-(--color-muted) text-[14px] mt-1.5 max-w-[36em] mx-auto">
        {t.rich('drafts.emptyHint', {
          code: (chunks) => <code className="mono">{chunks}</code>,
        })}
      </p>
    </div>
  );
}

function DraftList({
  rows, onOpen,
}: {
  rows: readonly AdminDraftRow[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {rows.map((r) => <DraftCard key={r.id} row={r} onOpen={() => onOpen(r.id)} />)}
    </div>
  );
}

function DraftCard({
  row, onOpen,
}: { row: AdminDraftRow; onOpen: () => void }) {
  return (
    <article data-testid="draft-card" className="border border-(--color-rule) rounded-[3px] p-4 hover:border-(--color-ink) transition-colors grid grid-cols-[1fr_200px] gap-4">
      <div>
        <DraftCardHead company={row.company} role={row.role} status={row.status} />
        <DraftCardMeta updatedAt={row.updated_at} forJob={row.for_job} />
        <DraftDiff text={row.diff_text} />
        <DraftCardActions onOpen={onOpen} draftId={row.id} actionKind={draftActionKind(row.status)} />
      </div>
      <DraftThumb row={row} />
    </article>
  );
}

function DraftCardHead({ company, role, status }: { company: string; role: string; status?: AdminDraftRow['status'] }) {
  return (
    <header className="mb-3 flex items-baseline justify-between gap-3">
      <div>
        <h3 className="font-serif text-[18px] text-(--color-ink) font-medium tracking-[-0.005em]">
          {company}
        </h3>
        <p className="font-serif italic text-[14px] text-(--color-muted) mt-0.5">
          {role}
        </p>
      </div>
      <DraftStatusPill status={status} />
    </header>
  );
}

function DraftStatusPill({ status }: { status?: AdminDraftRow['status'] }) {
  const label = status ?? 'draft';
  return (
    <span data-testid="draft-status-pill" className={`sm-pill ${draftPillTone(status)}`}>
      <span className="sm-dot-mark" />
      {label}
    </span>
  );
}

function DraftCardMeta({ updatedAt, forJob }: { updatedAt: string; forJob: string }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) flex items-baseline gap-3 flex-wrap mb-4">
      <span>{t('drafts.metaUpdated', { date: formatDate(updatedAt) })}</span>
      <span className="text-(--color-faint)">·</span>
      <span>{t.rich('drafts.metaJob', { job: forJob, ink })}</span>
    </div>
  );
}

function DraftDiff({ text }: { text?: string }) {
  return text ? (
    <blockquote className="border-l-2 border-(--color-accent) pl-3 mb-3 mono text-[11px] text-(--color-muted) leading-[1.6]">
      {text}
    </blockquote>
  ) : null;
}


function formatDate(iso: string): string {
  return iso ? iso.slice(0, 10) : '—';
}

function DraftCardActions({ onOpen, draftId, actionKind }: { onOpen: () => void; draftId: string; actionKind: 'reviewing' | 'draft' | 'sent' }) {
  const map = {
    reviewing: <ReviewingActions onOpen={onOpen} draftId={draftId} />,
    draft: <DraftActions onOpen={onOpen} draftId={draftId} />,
    sent: <SentActions draftId={draftId} />,
  } as const;
  return map[actionKind];
}

function ReviewingActions({ onOpen, draftId }: { onOpen: () => void; draftId: string }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="flex items-baseline gap-3">
      <button
        type="button" onClick={onOpen}
        className="sm-btn sm-btn-outline sm-btn-sm"
        data-testid={`draft-open-${draftId}`}
      >
        {t('drafts.openComposer')}
      </button>
      <button type="button" className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted) hover:text-(--color-accent)">
        {t('drafts.edit')}
      </button>
      <button type="button" className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) hover:text-(--color-accent)">
        {t('drafts.regenerate')}
      </button>
    </div>
  );
}

function DraftActions({ onOpen, draftId }: { onOpen: () => void; draftId: string }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="flex items-baseline gap-3" data-testid={`draft-actions-${draftId}`}>
      <button
        type="button" onClick={onOpen}
        className="sm-btn sm-btn-outline sm-btn-sm"
        data-testid={`draft-open-${draftId}`}
      >
        {t('drafts.openComposer')}
      </button>
      <button type="button" className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) hover:text-(--color-accent)">
        {t('drafts.discard')}
      </button>
    </div>
  );
}

function SentActions({ draftId }: { draftId: string }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="flex items-baseline gap-3" data-testid={`draft-sent-${draftId}`}>
      <button type="button" className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted) hover:text-(--color-accent)">
        {t('drafts.viewApplication')}
      </button>
      <button type="button" className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) hover:text-(--color-accent)">
        {t('drafts.viewPdf')}
      </button>
    </div>
  );
}
