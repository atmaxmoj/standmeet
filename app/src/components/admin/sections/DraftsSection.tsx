// DraftsSection —— /admin/drafts. On top, the owner's résumé masters (named, persistent; drafts
// start from one — docs/design/resume-masters.md). Below, the drafts: one per job, 24 h, each with
// the master it came from and how long it has left; a card's "open composer →" goes to the editor.
//
// Design source: docs/design/project/admin.js DraftsSection + DraftCard, and the masters mockups.
//
// Both lists page through the one paginator (docs/design/paging.md). The stores are module
// singletons, so the section re-reads both on mount: the composer (save, SEND, set as master) and
// the master editor change them while this page is not mounted.

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListPane } from '@/components/admin/ListPane';
import { LoadMore } from '@/components/admin/LoadMore';
import { NewDraftModal } from '@/components/admin/modals/NewDraftModal';
import { DraftThumb } from '@/components/admin/sections/drafts/DraftThumb';
import { MastersStrip } from '@/components/admin/sections/drafts/MastersStrip';
import { adminAPI } from '@/lib/api/admin';
import { resolveBtnClass } from '@/lib/admin/btn-styles';
import { useAction } from '@/lib/ui/use-action';
import { stampDay } from '@/lib/ui/format-time';
import { mastersPage } from '@/lib/admin/use-resume-masters';
import { totalLabel, usePaged } from '@/lib/state/create-paged-store';
import {
  draftActionKind,
  draftPillTone,
  draftsPage,
  hoursLeft,
  type AdminDraftRow,
} from '@/lib/admin/use-admin-drafts';

// Creating —— the new-draft modal is open, pre-selecting a master ('' = the default).
type Creating = { preselect: string } | null;

export function DraftsSection() {
  const t = useTranslations('adminJobs');
  const page = usePaged(draftsPage);
  const [creating, setCreating] = useState<Creating>(null);
  const [discardId, setDiscardId] = useState<string | null>(null);
  const run = useAction();
  const router = useRouter();
  useEffect(() => { void draftsPage.getState().reload(); void mastersPage.getState().reload(); }, []);
  // Open composer → the full-page Puck editor route. Editing / Save / SEND (commit) all live there
  // now (PuckComposer); this section is just the list + the way in.
  const openComposer = (id: string): void => { router.push(`/admin/edit-resume/${id}`); };
  // Discard → confirm modal → DELETE /drafts/{id} (same idempotent usecase as MCP resume.discard_draft)
  // → re-read so the thrown-away row leaves the list (F-E-9: a stale row reads as "it failed").
  const confirmDiscard = (id: string): void => {
    setDiscardId(null);
    void run(async () => {
      await adminAPI.deleteVoid(`/drafts/${id}`);
      await draftsPage.getState().reload();
    }, { success: t('drafts.discarded') });
  };
  return (
    <>
      <SectionHeader
        kicker={t('drafts.kicker')}
        slug="drafts"
        count={totalLabel(page.total, (count) => t('drafts.titlePending', { count }))}
        action={<NewDraftBtn onOpen={() => setCreating({ preselect: '' })} />}
      />
      <Intro />
      <MastersStrip onNewDraft={(preselect) => setCreating({ preselect })} />
      <ListPane status={page.status} count={page.items.length} empty={<EmptyState />}>
        <DraftList rows={page.items} onOpen={openComposer} onDiscard={setDiscardId} />
      </ListPane>
      <LoadMore page={page} testid="drafts-load-more" />
      {creating && (
        <NewDraftModal
          preselect={creating.preselect}
          onClose={() => setCreating(null)}
          onCreated={() => { setCreating(null); void draftsPage.getState().reload(); }}
        />
      )}
      <DiscardDraftModal discardId={discardId} onCancel={() => setDiscardId(null)} onConfirm={confirmDiscard} />
    </>
  );
}

// DiscardDraftModal —— confirm before throwing a draft away (delete is irreversible). Same overlay
// language as the composer's leave-guard; the confirm button carries the destructive accent. Owns its
// own open/closed guard (null discardId → renders nothing) so the section body stays flat.
function DiscardDraftModal({
  discardId, onCancel, onConfirm,
}: { discardId: string | null; onCancel: () => void; onConfirm: (id: string) => void }) {
  const t = useTranslations('adminJobs');
  return discardId === null ? null : (
    <div className="sm-fadein sm-composer-confirm-overlay" onClick={onCancel}>
      <div className="sm-composer-confirm-card sm-rise" onClick={(e) => e.stopPropagation()} data-testid="draft-discard-modal">
        <div className="sm-smallcaps">{t('drafts.discardTitle')}</div>
        <p className="sm-reading text-(--color-muted) text-[14.5px] mt-2">{t('drafts.discardBody')}</p>
        <div className="flex items-center justify-end gap-3 mt-5">
          <button type="button" onClick={onCancel} className="sm-btn sm-btn-ghost" data-testid="draft-discard-cancel">{t('drafts.cancel')}</button>
          <button type="button" onClick={() => onConfirm(discardId)} className="sm-btn sm-btn-accent" data-testid="draft-discard-confirm">{t('drafts.discard')}</button>
        </div>
      </div>
    </div>
  );
}

function NewDraftBtn({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('adminJobs');
  return <button type="button" onClick={onOpen} className={resolveBtnClass('solid')} data-testid="drafts-new">{t('drafts.new')}</button>;
}

// ink —— the <ink> tag for t.rich: lifts an emphasized word mid-sentence to ink color.
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

function EmptyState() {
  const t = useTranslations('adminJobs');
  return (
    <div className="sm-empty" data-testid="drafts-empty">
      <p className="sm-empty-title">{t('drafts.emptyTitle')}</p>
      <p className="sm-empty-hint reading">
        {t.rich('drafts.emptyHint', {
          code: (chunks) => <code className="mono">{chunks}</code>,
        })}
      </p>
    </div>
  );
}

function DraftList({
  rows, onOpen, onDiscard,
}: {
  rows: readonly AdminDraftRow[];
  onOpen: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {rows.map((r) => <DraftCard key={r.id} row={r} onOpen={() => onOpen(r.id)} onDiscard={() => onDiscard(r.id)} />)}
    </div>
  );
}

function DraftCard({
  row, onOpen, onDiscard,
}: { row: AdminDraftRow; onOpen: () => void; onDiscard: () => void }) {
  return (
    <article data-testid="draft-card" data-draft-id={row.id} className="border border-(--color-rule) rounded-[3px] p-4 hover:border-(--color-ink) transition-colors grid grid-cols-[1fr_200px] gap-4">
      <div>
        <DraftCardHead company={row.company} role={row.role} status={row.status} />
        <DraftCardMeta row={row} />
        <DraftDiff text={row.diff_text} />
        <DraftCardActions onOpen={onOpen} onDiscard={onDiscard} draftId={row.id} actionKind={draftActionKind(row.status)} />
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

// DraftCardMeta —— updated · job · based on <master> · N hours left.
function DraftCardMeta({ row }: { row: AdminDraftRow }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) flex items-baseline gap-3 flex-wrap mb-4">
      <span>{t('drafts.metaUpdated', { date: stampDay(row.updated_at) })}</span>
      <span className="text-(--color-faint)">·</span>
      <span>{t.rich('drafts.metaJob', { job: row.for_job, ink })}</span>
      {row.based_on_master_name !== '' && (
        <span data-testid="draft-based-on">{t('drafts.basedOn', { name: row.based_on_master_name })}</span>
      )}
      <span data-testid="draft-expiry" className="sm-pill">
        {t('drafts.hoursLeft', { count: hoursLeft(row.expires_at, Date.now()) })}
      </span>
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

function DraftCardActions({ onOpen, onDiscard, draftId, actionKind }: { onOpen: () => void; onDiscard: () => void; draftId: string; actionKind: 'reviewing' | 'draft' | 'sent' }) {
  const map = {
    reviewing: <ReviewingActions onOpen={onOpen} draftId={draftId} />,
    draft: <DraftActions onOpen={onOpen} onDiscard={onDiscard} draftId={draftId} />,
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

function DraftActions({ onOpen, onDiscard, draftId }: { onOpen: () => void; onDiscard: () => void; draftId: string }) {
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
      <button
        type="button" onClick={onDiscard}
        className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) hover:text-(--color-accent)"
        data-testid={`draft-discard-${draftId}`}
      >
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
