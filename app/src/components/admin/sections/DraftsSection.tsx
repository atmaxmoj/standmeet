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

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ResumeComposer } from '@/components/admin/ResumeComposer';
import { mockDraft } from '@/lib/admin/draft-model';
import { listViewKind } from '@/lib/admin/list-view-kind';
import {
  useAdminDrafts,
  type AdminDraftRow,
} from '@/lib/admin/use-admin-drafts';

export function DraftsSection() {
  const { rows, loading, error } = useAdminDrafts();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <SectionHeader
        kicker="outbound · resumes"
        title="drafts"
        count={titleCount(rows.length, loading)}
      />
      <Intro />
      <DraftListBody rows={rows} loading={loading} error={error} onOpen={setOpenId} />
      {openId !== null && (
        <ResumeComposer
          initial={mockDraft(openId)}
          onClose={() => setOpenId(null)}
          onSend={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function titleCount(n: number, loading: boolean): string {
  return loading ? 'loading…' : `${n} pending`;
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Tailored resumes Claude drafted for jobs you said yes to. Open the composer to
      edit + preview; <span className="text-(--color-ink)">send</span> freezes the
      snapshot, renders the final PDF (with QR), and auto-issues an AccessCode.
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
  return (
    <p className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted)">
      loading…
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
  return (
    <div className="p-6 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/40 text-center">
      <p className="font-serif text-(--color-ink) text-[18px]">No drafts pending.</p>
      <p className="reading text-(--color-muted) text-[14px] mt-1.5 max-w-[36em] mx-auto">
        Ask Claude to draft a resume from a shortlisted job listing
        (MCP <code className="mono">resume.draft</code>) — it shows up here.
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
    <article className="border border-(--color-rule) rounded-[3px] p-4 hover:border-(--color-ink) transition-colors">
      <DraftCardHead company={row.company} role={row.role} />
      <DraftCardMeta updatedAt={row.updated_at} forJob={row.for_job} />
      <DraftCardActions onOpen={onOpen} draftId={row.id} />
    </article>
  );
}

function DraftCardHead({ company, role }: { company: string; role: string }) {
  return (
    <header className="mb-3">
      <h3 className="font-serif text-[18px] text-(--color-ink) font-medium tracking-[-0.005em]">
        {company}
      </h3>
      <p className="font-serif italic text-[14px] text-(--color-muted) mt-0.5">
        {role}
      </p>
    </header>
  );
}

function DraftCardMeta({ updatedAt, forJob }: { updatedAt: string; forJob: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) flex items-baseline gap-3 flex-wrap mb-4">
      <span>updated {formatDate(updatedAt)}</span>
      <span className="text-(--color-faint)">·</span>
      <span>job · <span className="text-(--color-ink)">{forJob}</span></span>
    </div>
  );
}

function formatDate(iso: string): string {
  return iso ? iso.slice(0, 10) : '—';
}

function DraftCardActions({ onOpen, draftId }: { onOpen: () => void; draftId: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <button
        type="button" onClick={onOpen}
        className="sm-btn sm-btn-outline sm-btn-sm"
        data-testid={`draft-open-${draftId}`}
      >
        open composer →
      </button>
    </div>
  );
}
