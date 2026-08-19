// SubjectivitySection —— /admin/subjectivity。**跟其余几个 genre 一样**:建 / 改 / 挂文件。
//
// 它以前在面板上一个界面都没有(只有 MCP 写得动),那不是产品决定 —— 只是一句被写进代码的
// 偏好。现在它跟 wiki / output 走同一套:同一个 CorpusEntryForm、同一个素材区、同一条
// `/corpus/{genre}` 路由。这个文件里**没有一处 if genre === 'subjectivity'**,
// 那正是"它不是特例,只是第四个 genre"该有的样子。

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { CorpusAssetsPanel } from '@/components/admin/sections/corpus/CorpusAssetsPanel';
import { CorpusEntryForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  useCorpusActions, type CorpusActionsHook, type CorpusEntryInput,
} from '@/lib/admin/use-corpus-actions';
import { useSubjectivityDetail } from '@/lib/admin/use-corpus-detail';
import { runWith } from '@/lib/admin/use-corpus-form';
import { useSubjectivity, type SubjectivityEntry } from '@/lib/admin/use-subjectivity';
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
  const [creating, setCreating] = useState(false);
  return (
    <>
      <SectionHeader
        kicker="corpus · self-model"
        slug="subjectivity"
        count={hook.state === 'list' ? `${hook.rows.length} notes` : ''}
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
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.createSubjectivity(input),
    () => { toast.success('Subjectivity note created'); onDone(); },
  );
  return (
    <CorpusEntryForm
      busy={actions.pending}
      submitLabel="create"
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
    list: <NoteList rows={hook.rows} actions={actions} />,
  } as const;
  return map[hook.state];
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

function NoteList(
  { rows, actions }: { rows: readonly SubjectivityEntry[]; actions: CorpusActionsHook },
) {
  return (
    <ul className="space-y-4" data-testid="subjectivity-list">
      {rows.map((row) => <NoteRow key={row.id} row={row} actions={actions} />)}
    </ul>
  );
}

function NoteRow(
  { row, actions }: { row: SubjectivityEntry; actions: CorpusActionsHook },
) {
  const [editing, setEditing] = useState(false);
  return (
    <li
      className="border border-(--color-rule) p-4 bg-(--color-surface)/30 rounded-sm"
      data-testid={`subjectivity-row-${row.id}`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className="reading-tight text-[16px] text-(--color-ink)">{row.title}</span>
        <EditToggle open={editing} onClick={() => setEditing(!editing)} id={row.id} />
      </div>
      <p className="reading-tight text-[13px] text-(--color-muted) mt-1">{row.preview}</p>
      {editing ? <EditForm row={row} actions={actions} onDone={() => setEditing(false)} /> : null}
    </li>
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
  const detail = useSubjectivityDetail(row.id, actions);
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.updateSubjectivity(row.id, input),
    () => { toast.success('Subjectivity note updated'); onDone(); },
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
            submitLabel="save"
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
