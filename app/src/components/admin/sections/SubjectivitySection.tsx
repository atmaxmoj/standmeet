// SubjectivitySection —— /admin/subjectivity. **Same as the other genres**: create / edit / attach files.
//
// It used to have zero admin UI (only MCP could write it), and that wasn't a product decision —
// just a preference that had been baked into the code. Now it runs through the same pipeline as
// wiki / output: the same CorpusEntryForm, the same asset area, the same `/corpus/{genre}` route.
// There is **not a single `if genre === 'subjectivity'`** in this file, which is exactly what
// "it's not a special case, just the fourth genre" should look like.

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { Chip } from '@/components/admin/atoms/Chip';
import { CorpusViewToggle } from '@/components/admin/atoms/CorpusViewToggle';
import { CorpusTreeGrid } from '@/components/admin/sections/corpus/CorpusTreeGrid';
import { CorpusAssetsPanel } from '@/components/admin/sections/corpus/CorpusAssetsPanel';
import { CorpusEntryForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import { useCorpusView } from '@/lib/admin/corpus-view';
import {
  useCorpusActions, type CorpusActionsHook, type CorpusEntryInput,
} from '@/lib/admin/use-corpus-actions';
import { useSubjectivityDetail } from '@/lib/admin/use-corpus-detail';
import { runWith } from '@/lib/admin/use-corpus-form';
import {
  useSubjectivity, loadSubjectivityTreeChildren, type SubjectivityEntry,
} from '@/lib/admin/use-subjectivity';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function SubjectivitySection() {
  const hook = useSubjectivity();
  const actions = useCorpusActions();
  useEffectErrorToast(actions.error);
  return (
    <>
      <Header hook={hook} actions={actions} />
      <Intro />
      <Body hook={hook} actions={actions} />
    </>
  );
}

function Header(
  { hook, actions }: { hook: SubjectivityHookT; actions: CorpusActionsHook },
) {
  const tk = useTranslations('adminCorpus.kicker');
  const tc = useTranslations('adminCorpus.count');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <SectionHeader
        kicker={tk('subjectivity')}
        slug="subjectivity"
        count={hook.state === 'list' ? tc('notes', { n: hook.rows.length }) : ''}
        action={<NewBtn onClick={() => setCreating(true)} disabled={creating} />}
      />
      {creating ? (
        <div className="mb-6">
          <CreateForm actions={actions} onDone={() => setCreating(false)} />
        </div>
      ) : null}
    </>
  );
}

type SubjectivityHookT = ReturnType<typeof useSubjectivity>;

function NewBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const t = useTranslations('adminCorpus.subjectivity');
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      data-testid="subjectivity-new-btn"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      {t('new')}
    </button>
  );
}

function CreateForm(
  { actions, onDone }: { actions: CorpusActionsHook; onDone: () => void },
) {
  const toast = useToast();
  const ta = useTranslations('adminCorpus.action');
  const tt = useTranslations('adminCorpus.toast');
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.createSubjectivity(input),
    () => { toast.success(tt('subjectivityCreated')); onDone(); },
  );
  return (
    <CorpusEntryForm
      busy={actions.pending}
      submitLabel={ta('create')}
      testidPrefix="subjectivity-create"
      onSubmit={onSubmit}
      onCancel={onDone}
    />
  );
}

function Intro() {
  const t = useTranslations('adminCorpus.subjectivity');
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      {t('intro')}
    </p>
  );
}

function Body(
  { hook, actions }: { hook: SubjectivityHookT; actions: CorpusActionsHook },
) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <ReadyBody hook={hook} actions={actions} />,
  } as const;
  return map[hook.state];
}

// ReadyBody —— the tree/grid, same as wiki/output/raw: a lazy hierarchy from
// /corpus/subjectivity/tree (tree view) or the flat card wall over the loaded rows (grid view).
function ReadyBody(
  { hook, actions }: { hook: SubjectivityHookT; actions: CorpusActionsHook },
) {
  const [view, setView] = useCorpusView('subjectivity');
  return (
    <>
      <div className="flex justify-end mb-4">
        <CorpusViewToggle view={view} onChange={setView} />
      </div>
      <CorpusTreeGrid
        view={view} rows={hook.rows} testid="subjectivity-list"
        rowTestid={(r) => `subjectivity-row-${r.id}`}
        loadChildren={loadSubjectivityTreeChildren}
        renderCard={(row, { hasChildren }) => (
          <NoteCard row={row} actions={actions} hasChildren={hasChildren} />
        )}
      />
    </>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="subjectivity-error">
      {message}
    </p>
  );
}

function EmptyState() {
  const t = useTranslations('adminCorpus.subjectivity');
  return (
    <p
      className="reading-tight italic text-(--color-muted) mt-8"
      data-testid="subjectivity-empty"
    >
      {t('empty')}
    </p>
  );
}

// NoteCard —— one node in the tree/grid (CorpusTreeGrid wraps it with the row testid + indent).
// hasChildren shows the same ▾ marker wiki uses; edit is inline.
function NoteCard(
  { row, actions, hasChildren }: {
    row: SubjectivityEntry; actions: CorpusActionsHook; hasChildren: boolean;
  },
) {
  const [editing, setEditing] = useState(false);
  return (
    <article className="border-t border-(--color-rule) pt-4">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-serif text-[18px] font-normal leading-[1.25] text-(--color-ink) m-0 flex-1">
          {row.title}
          {hasChildren ? (
            <span className="ml-2 mono text-[9.5px] tracking-[0.08em] text-(--color-faint) align-middle">
              {'▾'}
            </span>
          ) : null}
        </h3>
        <EditToggle open={editing} onClick={() => setEditing(!editing)} id={row.id} />
      </div>
      <NotePreview preview={row.preview} />
      <NoteTags tags={row.tags} />
      {editing ? <EditForm row={row} actions={actions} onDone={() => setEditing(false)} /> : null}
    </article>
  );
}

function NotePreview({ preview }: { preview: string }) {
  return preview ? (
    <p className="reading-tight text-[13px] text-(--color-muted) mt-1 line-clamp-2">{preview}</p>
  ) : null;
}

function NoteTags({ tags }: { tags: readonly string[] }) {
  return tags.length === 0 ? null : (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {tags.map((t) => <Chip key={t}>{t}</Chip>)}
    </div>
  );
}

function EditToggle(
  { open, onClick, id }: { open: boolean; onClick: () => void; id: string },
) {
  const t = useTranslations('adminCorpus.common');
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`subjectivity-edit-${id}`}
      className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) hover:text-(--color-accent) shrink-0"
    >
      {open ? t('cancel') : t('edit')}
    </button>
  );
}

function EditForm(
  { row, actions, onDone }: {
    row: SubjectivityEntry; actions: CorpusActionsHook; onDone: () => void;
  },
) {
  const toast = useToast();
  const t = useTranslations('adminCorpus.common');
  const tt = useTranslations('adminCorpus.toast');
  const detail = useSubjectivityDetail(row.id, actions);
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.updateSubjectivity(row.id, input),
    () => { toast.success(tt('subjectivityUpdated')); onDone(); },
  );
  const prefix = `subjectivity-edit-form-${row.id}`;
  return (
    <div className="mt-4" data-testid={`subjectivity-edit-slot-${row.id}`}>
      {detail ? (
        <div data-testid={`subjectivity-edit-loaded-${row.id}`}>
          <CorpusEntryForm
            initial={{
              title: detail.title, body: detail.body, tags: detail.tags,
              show_as_source: detail.show_as_source,
              cover_image_asset_id: detail.cover_image_asset_id,
              cover_headline: detail.cover_headline,
              cover_hue: detail.cover_hue,
            }}
            busy={actions.pending}
            submitLabel={t('save')}
            testidPrefix={prefix}
            onSubmit={onSubmit}
            onCancel={onDone}
            renderAssets={(api) => (
              <CorpusAssetsPanel
                genre="subjectivity"
                entryID={row.id}
                testidPrefix={prefix}
                insertIntoBody={api.insertIntoBody}
                dropFromBody={api.dropFromBody}
                onSetCover={api.setCover}
                coverAssetID={api.coverAssetID}
              />
            )}
          />
        </div>
      ) : <LoadingLine />}
    </div>
  );
}

function LoadingLine() {
  const t = useTranslations('adminCorpus.common');
  return <p className="mono text-[10.5px] text-(--color-muted)">{t('loading')}</p>;
}
