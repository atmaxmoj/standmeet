// WritingsSection —— /admin/writings。owner 手写 markdown writing + edit +
// delete + publish/unpublish + cover image。MCP handoff 同一套 backend，所以
// 这里是 owner 不开 Claude Desktop 时的 web 备用路径。

'use client';

import { useCallback, useState } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { EditorSideRail } from '@/components/admin/sections/writings/EditorSideRail';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { CardGridSkeleton } from '@/components/skeletons/CardGridSkeleton';
import { ObsidianBar } from '@/components/admin/sections/writings/ObsidianBar';
import {
  WritingForm, EMPTY_VALUES,
  type WritingFormValues, type WritingFormSubmit, type ParentOption,
} from '@/components/admin/sections/writings/WritingForm';
import {
  useWritings, type WritingsHook, type AdminWritingView,
  type WritingSaveBundle, type WritingSaveData,
} from '@/lib/admin/use-writings';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function WritingsSection() {
  const hook = useWritings();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminWritingView | null>(null);
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader
        kicker="corpus · writing"
        title="writings"
        count={titleCount(hook)}
        action={<Btn kind="primary" onClick={() => setCreating(true)}>＋ new writing</Btn>}
      />
      <Intro />
      <ObsidianBar onImported={() => hook.refresh()} />
      <InlineOrList hook={hook} editing={editing} setEditing={setEditing} />
      {creating && (
        <WritingCreateModal
          onClose={() => setCreating(false)} onCreate={hook.createWriting}
          parentOptions={parentOptionsFor(hook.writings, '')}
        />
      )}
    </>
  );
}

function titleCount(hook: WritingsHook): string {
  return hook.status === 'ready' ? formatWritingCount(hook.writings) : '';
}

function formatWritingCount(writings: WritingsHook['writings']): string {
  const published = writings.filter((w) => w.published).length;
  const drafts = writings.length - published;
  return drafts === 0 ? `${published} writings` : `${published} writings · ${drafts} draft${drafts === 1 ? '' : 's'}`;
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Owner-curated writings. Use the block editor below — type `/` for a block menu,
      or hand off to Claude via the `writing_create` MCP tool. Saved as canonical markdown either way.
    </p>
  );
}

type EditFn = (w: AdminWritingView) => void;

function InlineOrList({ hook, editing, setEditing }: {
  hook: WritingsHook; editing: AdminWritingView | null; setEditing: (w: AdminWritingView | null) => void;
}) {
  return editing
    ? <InlineEditor writing={editing} hook={hook} onClose={() => setEditing(null)} />
    : <WritingsListBody hook={hook} onEdit={setEditing} />;
}

function InlineEditor({ writing, hook, onClose }: {
  writing: AdminWritingView; hook: WritingsHook; onClose: () => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
      <div className="border border-(--color-rule) rounded-[3px] p-5 min-h-[580px]" data-testid="inline-editor">
        <div className="flex justify-between items-baseline mb-4">
          <div className="sm-smallcaps">composer · {writing.slug}</div>
          <button type="button" onClick={onClose} className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)">
            ← back to list
          </button>
        </div>
        <WritingEditModal
          writing={writing} onClose={onClose} onUpdate={hook.updateWriting}
          parentOptions={parentOptionsFor(hook.writings, writing.id)}
        />
      </div>
      <EditorSideRail bodyMD="" />
    </div>
  );
}

function WritingsListBody({ hook, onEdit }: { hook: WritingsHook; onEdit: EditFn }) {
  const loading = hook.status === 'idle' || hook.status === 'loading';
  return loading
    ? <CardGridSkeleton />
    : <WritingsListReady hook={hook} onEdit={onEdit} />;
}

function WritingsListReady({ hook, onEdit }: { hook: WritingsHook; onEdit: EditFn }) {
  return hook.writings.length === 0
    ? <EmptyState />
    : <WritingList hook={hook} onEdit={onEdit} />;
}

function EmptyState() {
  return (
    <p className="reading italic text-(--color-muted)" data-testid="writing-list">
      No writings yet.
    </p>
  );
}

function WritingList({ hook, onEdit }: { hook: WritingsHook; onEdit: EditFn }) {
  return (
    <ul className="flex flex-col gap-4" data-testid="writing-list">
      {hook.writings.map((w) => (
        <li key={w.id} data-testid={`writing-row-${w.slug}`}>
          <WritingCard writing={w} hook={hook} onEdit={onEdit} />
        </li>
      ))}
    </ul>
  );
}

function WritingCard({
  writing, hook, onEdit,
}: { writing: AdminWritingView; hook: WritingsHook; onEdit: EditFn }) {
  return (
    <div className="border border-(--color-rule) px-5 py-4 flex flex-col gap-2">
      <WritingCardHead writing={writing} />
      {writing.excerpt && (
        <p className="reading-tight text-[14px] text-(--color-muted)">{writing.excerpt}</p>
      )}
      <WritingCardActions writing={writing} hook={hook} onEdit={onEdit} />
    </div>
  );
}

function WritingCardHead({ writing }: { writing: AdminWritingView }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-serif text-[18px]">{writing.title}</span>
      <span className="mono text-[10px] text-(--color-faint)">/{writing.slug}</span>
      <span
        className={`mono text-[9px] tracking-[0.18em] uppercase ${writing.published ? 'text-(--color-accent)' : 'text-(--color-muted)'}`}
        data-testid={`writing-status-${writing.slug}`}
      >
        {writing.published ? 'published' : 'draft'}
      </span>
    </div>
  );
}

function WritingCardActions({
  writing, hook, onEdit,
}: { writing: AdminWritingView; hook: WritingsHook; onEdit: EditFn }) {
  const toast = useToast();
  const togglePublish = useTogglePublish(writing, hook, toast);
  const handleDelete = useHandleDelete(writing.id, hook, toast);
  return (
    <div className="flex items-baseline gap-3 mt-1">
      <ActionBtn slug={writing.slug} kind="edit" onClick={() => onEdit(writing)} />
      <Sep />
      <ActionBtn slug={writing.slug}
        kind={writing.published ? 'unpublish' : 'publish'}
        onClick={() => void togglePublish()} />
      <Sep />
      <ActionBtn slug={writing.slug} kind="delete" onClick={() => void handleDelete()} />
    </div>
  );
}

function Sep() {
  return <span className="text-(--color-faint)">·</span>;
}

type ActionKind = 'edit' | 'publish' | 'unpublish' | 'delete';

const TESTID_NAME: Record<ActionKind, string> = {
  edit: 'edit', publish: 'toggle-publish', unpublish: 'toggle-publish', delete: 'delete',
};
const HOVER_CLASS: Record<ActionKind, string> = {
  edit: 'hover:text-(--color-ink)',
  publish: 'hover:text-(--color-ink)',
  unpublish: 'hover:text-(--color-ink)',
  delete: 'hover:text-(--color-accent)',
};

function ActionBtn({
  slug, kind, onClick,
}: { slug: string; kind: ActionKind; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`writing-${TESTID_NAME[kind]}-${slug}`}
      className={`mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) ${HOVER_CLASS[kind]}`}
    >
      {kind}
    </button>
  );
}

function useTogglePublish(
  writing: AdminWritingView, hook: WritingsHook, toast: ReturnType<typeof useToast>,
) {
  return useCallback(async () => {
    const ok = await flipPublishOp(writing, hook);
    ok && toast.success(writing.published ? 'Unpublished' : 'Published');
  }, [writing, hook, toast]);
}

function flipPublishOp(writing: AdminWritingView, hook: WritingsHook): Promise<boolean> {
  return writing.published ? hook.unpublishWriting(writing.id) : hook.publishWriting(writing.id);
}

function useHandleDelete(
  id: string, hook: WritingsHook, toast: ReturnType<typeof useToast>,
) {
  return useCallback(async () => {
    const ok = await hook.deleteWriting(id);
    ok && toast.success('Writing deleted');
  }, [hook, id, toast]);
}

function WritingCreateModal({
  onClose, onCreate, parentOptions,
}: {
  onClose: () => void;
  onCreate: (bundle: WritingSaveBundle) => Promise<boolean>;
  parentOptions: ParentOption[];
}) {
  return (
    <div
      className="fixed inset-0 bg-(--color-ink)/40 flex items-center justify-center z-40 p-6"
      data-testid="writing-create-modal"
    >
      <WritingForm
        heading="new writing"
        initial={EMPTY_VALUES}
        slugReadOnly={false}
        showPublishToggle
        submitLabel="create"
        submitTestId="writing-create-submit"
        parentOptions={parentOptions}
        onClose={onClose}
        onSubmit={(s) => onCreate(toBundle(s, true))}
      />
    </div>
  );
}

function WritingEditModal({
  writing, onClose, onUpdate, parentOptions,
}: {
  writing: AdminWritingView;
  onClose: () => void;
  onUpdate: (id: string, bundle: WritingSaveBundle) => Promise<boolean>;
  parentOptions: ParentOption[];
}) {
  return (
    <div
      className="fixed inset-0 bg-(--color-ink)/40 flex items-center justify-center z-40 p-6"
      data-testid="writing-edit-modal"
    >
      <WritingForm
        heading={`edit / ${writing.slug}`}
        initial={writingToValues(writing)}
        slugReadOnly
        showPublishToggle={false}
        submitLabel="save"
        submitTestId="writing-edit-submit"
        assetURLs={writing.asset_urls ?? {}}
        parentOptions={parentOptions}
        onClose={onClose}
        onSubmit={(s) => onUpdate(writing.id, toBundle(s, false))}
      />
    </div>
  );
}

// parentOptionsFor —— 「设父」候选 = 别的 writing(排除自己,防自挂;深层成环后端拦)。
function parentOptionsFor(
  writings: WritingsHook['writings'], excludeID: string,
): ParentOption[] {
  return writings
    .filter((w) => w.id !== excludeID)
    .map((w) => ({ id: w.id, title: w.title }));
}

function writingToValues(w: AdminWritingView): WritingFormValues {
  return {
    slug: w.slug, title: w.title, excerpt: w.excerpt, bodyMD: w.body_md,
    coverHeadline: w.cover_headline, coverSub: w.cover_sub,
    coverHue: w.cover_hue,
    coverAsset: coverAssetFor(w),
    tags: w.tags.join(', '),
    parentID: w.parent_id ?? '',
    publish: w.published,
  };
}

function coverAssetFor(w: AdminWritingView): { id: string; url: string } {
  const id = w.cover_image_asset_id ?? '';
  return { id, url: lookupAssetURL(id, w.asset_urls ?? {}) };
}

function lookupAssetURL(id: string, map: Record<string, string>): string {
  return map[id] ?? '';
}

// toBundle —— WritingForm 提交回来 (values + pending files) → 转
// WritingSaveBundle 给 createWriting/updateWriting。create 时附带 slug +
// publish 字段，edit 时不带（走单独 publish endpoint，slug 在 URL）。
function toBundle(s: WritingFormSubmit, isCreate: boolean): WritingSaveBundle {
  return { data: toSaveData(s.values, isCreate), files: s.files };
}

function toSaveData(v: WritingFormValues, isCreate: boolean): WritingSaveData {
  const base: WritingSaveData = {
    title: v.title, excerpt: v.excerpt, body_md: v.bodyMD,
    cover_image_ref: v.coverAsset.id, cover_headline: v.coverHeadline,
    cover_sub: v.coverSub, cover_hue: v.coverHue,
    visibility: 'public', locked_body: '',
    parent_id: v.parentID,
    tags: parseTags(v.tags), cross_refs: [],
  };
  return isCreate ? { ...base, slug: v.slug, publish: v.publish } : base;
}

function parseTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}
