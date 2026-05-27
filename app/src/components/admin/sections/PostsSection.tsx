// PostsSection —— /admin/posts。owner 手写 markdown post + edit + delete +
// publish/unpublish + cover image。MCP handoff 同一套 backend，所以这里
// 是 owner 不开 Claude Desktop 时的 web 备用路径。

'use client';

import { useCallback, useState } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { EditorSideRail } from '@/components/admin/sections/posts/EditorSideRail';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { CardGridSkeleton } from '@/components/skeletons/CardGridSkeleton';
import { ObsidianBar } from '@/components/admin/sections/posts/ObsidianBar';
import {
  PostForm, EMPTY_VALUES,
  type PostFormValues, type PostFormSubmit,
} from '@/components/admin/sections/posts/PostForm';
import {
  usePosts, type PostsHook, type AdminPostView,
  type PostSaveBundle, type PostSaveData,
} from '@/lib/admin/use-posts';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function PostsSection() {
  const hook = usePosts();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminPostView | null>(null);
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader
        kicker="corpus · writing"
        title="posts"
        count={titleCount(hook)}
        action={<Btn kind="primary" onClick={() => setCreating(true)}>＋ new post</Btn>}
      />
      <Intro />
      <ObsidianBar onImported={() => hook.refresh()} />
      <InlineOrList hook={hook} editing={editing} setEditing={setEditing} />
      {creating && (
        <PostCreateModal onClose={() => setCreating(false)} onCreate={hook.createPost} />
      )}
    </>
  );
}

function titleCount(hook: PostsHook): string {
  return hook.status === 'ready' ? formatPostCount(hook.posts) : '';
}

function formatPostCount(posts: PostsHook['posts']): string {
  const published = posts.filter((p) => p.published).length;
  const drafts = posts.length - published;
  return drafts === 0 ? `${published} posts` : `${published} posts · ${drafts} draft${drafts === 1 ? '' : 's'}`;
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Owner-curated blog posts. Use the block editor below — type `/` for a block menu,
      or hand off to Claude via the `post_create` MCP tool. Saved as canonical markdown either way.
    </p>
  );
}

type EditFn = (p: AdminPostView) => void;

function InlineOrList({ hook, editing, setEditing }: {
  hook: PostsHook; editing: AdminPostView | null; setEditing: (p: AdminPostView | null) => void;
}) {
  return editing
    ? <InlineEditor post={editing} hook={hook} onClose={() => setEditing(null)} />
    : <PostsListBody hook={hook} onEdit={setEditing} />;
}

function InlineEditor({ post, hook, onClose }: {
  post: AdminPostView; hook: PostsHook; onClose: () => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
      <div className="border border-(--color-rule) rounded-[3px] p-5 min-h-[580px]" data-testid="inline-editor">
        <div className="flex justify-between items-baseline mb-4">
          <div className="sm-smallcaps">composer · {post.slug}</div>
          <button type="button" onClick={onClose} className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)">
            ← back to list
          </button>
        </div>
        <PostEditModal post={post} onClose={onClose} onUpdate={hook.updatePost} />
      </div>
      <EditorSideRail bodyMD="" />
    </div>
  );
}

function PostsListBody({ hook, onEdit }: { hook: PostsHook; onEdit: EditFn }) {
  const loading = hook.status === 'idle' || hook.status === 'loading';
  return loading
    ? <CardGridSkeleton />
    : <PostsListReady hook={hook} onEdit={onEdit} />;
}

function PostsListReady({ hook, onEdit }: { hook: PostsHook; onEdit: EditFn }) {
  return hook.posts.length === 0
    ? <EmptyState />
    : <PostList hook={hook} onEdit={onEdit} />;
}

function EmptyState() {
  return (
    <p className="reading italic text-(--color-muted)" data-testid="post-list">
      No posts yet.
    </p>
  );
}

function PostList({ hook, onEdit }: { hook: PostsHook; onEdit: EditFn }) {
  return (
    <ul className="flex flex-col gap-4" data-testid="post-list">
      {hook.posts.map((p) => (
        <li key={p.id} data-testid={`post-row-${p.slug}`}>
          <PostCard post={p} hook={hook} onEdit={onEdit} />
        </li>
      ))}
    </ul>
  );
}

function PostCard({
  post, hook, onEdit,
}: { post: AdminPostView; hook: PostsHook; onEdit: EditFn }) {
  return (
    <div className="border border-(--color-rule) px-5 py-4 flex flex-col gap-2">
      <PostCardHead post={post} />
      {post.excerpt && (
        <p className="reading-tight text-[14px] text-(--color-muted)">{post.excerpt}</p>
      )}
      <PostCardActions post={post} hook={hook} onEdit={onEdit} />
    </div>
  );
}

function PostCardHead({ post }: { post: AdminPostView }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-serif text-[18px]">{post.title}</span>
      <span className="mono text-[10px] text-(--color-faint)">/{post.slug}</span>
      <span
        className={`mono text-[9px] tracking-[0.18em] uppercase ${post.published ? 'text-(--color-accent)' : 'text-(--color-muted)'}`}
        data-testid={`post-status-${post.slug}`}
      >
        {post.published ? 'published' : 'draft'}
      </span>
    </div>
  );
}

function PostCardActions({
  post, hook, onEdit,
}: { post: AdminPostView; hook: PostsHook; onEdit: EditFn }) {
  const toast = useToast();
  const togglePublish = useTogglePublish(post, hook, toast);
  const handleDelete = useHandleDelete(post.id, hook, toast);
  return (
    <div className="flex items-baseline gap-3 mt-1">
      <ActionBtn slug={post.slug} kind="edit" onClick={() => onEdit(post)} />
      <Sep />
      <ActionBtn slug={post.slug}
        kind={post.published ? 'unpublish' : 'publish'}
        onClick={() => void togglePublish()} />
      <Sep />
      <ActionBtn slug={post.slug} kind="delete" onClick={() => void handleDelete()} />
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
      data-testid={`post-${TESTID_NAME[kind]}-${slug}`}
      className={`mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) ${HOVER_CLASS[kind]}`}
    >
      {kind}
    </button>
  );
}

function useTogglePublish(
  post: AdminPostView, hook: PostsHook, toast: ReturnType<typeof useToast>,
) {
  return useCallback(async () => {
    const ok = await flipPublishOp(post, hook);
    ok && toast.success(post.published ? 'Unpublished' : 'Published');
  }, [post, hook, toast]);
}

function flipPublishOp(post: AdminPostView, hook: PostsHook): Promise<boolean> {
  return post.published ? hook.unpublishPost(post.id) : hook.publishPost(post.id);
}

function useHandleDelete(
  id: string, hook: PostsHook, toast: ReturnType<typeof useToast>,
) {
  return useCallback(async () => {
    const ok = await hook.deletePost(id);
    ok && toast.success('Post deleted');
  }, [hook, id, toast]);
}

function PostCreateModal({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (bundle: PostSaveBundle) => Promise<boolean>;
}) {
  return (
    <div
      className="fixed inset-0 bg-(--color-ink)/40 flex items-center justify-center z-40 p-6"
      data-testid="post-create-modal"
    >
      <PostForm
        heading="new post"
        initial={EMPTY_VALUES}
        slugReadOnly={false}
        showPublishToggle
        submitLabel="create"
        submitTestId="post-create-submit"
        onClose={onClose}
        onSubmit={(s) => onCreate(toBundle(s, true))}
      />
    </div>
  );
}

function PostEditModal({
  post, onClose, onUpdate,
}: {
  post: AdminPostView;
  onClose: () => void;
  onUpdate: (id: string, bundle: PostSaveBundle) => Promise<boolean>;
}) {
  return (
    <div
      className="fixed inset-0 bg-(--color-ink)/40 flex items-center justify-center z-40 p-6"
      data-testid="post-edit-modal"
    >
      <PostForm
        heading={`edit / ${post.slug}`}
        initial={postToValues(post)}
        slugReadOnly
        showPublishToggle={false}
        submitLabel="save"
        submitTestId="post-edit-submit"
        assetURLs={post.asset_urls ?? {}}
        onClose={onClose}
        onSubmit={(s) => onUpdate(post.id, toBundle(s, false))}
      />
    </div>
  );
}

function postToValues(p: AdminPostView): PostFormValues {
  return {
    slug: p.slug, title: p.title, excerpt: p.excerpt, bodyMD: p.body_md,
    coverHeadline: p.cover_headline, coverSub: p.cover_sub,
    coverHue: p.cover_hue,
    coverAsset: coverAssetFor(p),
    tags: p.tags.join(', '),
    publish: p.published,
  };
}

function coverAssetFor(p: AdminPostView): { id: string; url: string } {
  const id = p.cover_image_asset_id ?? '';
  return { id, url: lookupAssetURL(id, p.asset_urls ?? {}) };
}

function lookupAssetURL(id: string, map: Record<string, string>): string {
  return map[id] ?? '';
}

// toBundle —— PostForm 提交回来 (values + pending files) → 转 PostSaveBundle
// 给 createPost/updatePost。create 时附带 slug + publish 字段，edit 时不带
// （走单独 publish endpoint，slug 在 URL）。
function toBundle(s: PostFormSubmit, isCreate: boolean): PostSaveBundle {
  return { data: toSaveData(s.values, isCreate), files: s.files };
}

function toSaveData(v: PostFormValues, isCreate: boolean): PostSaveData {
  const base: PostSaveData = {
    title: v.title, excerpt: v.excerpt, body_md: v.bodyMD,
    cover_image_ref: v.coverAsset.id, cover_headline: v.coverHeadline,
    cover_sub: v.coverSub, cover_hue: v.coverHue,
    visibility: 'public', locked_body: '',
    tags: parseTags(v.tags), cross_refs: [],
  };
  return isCreate ? { ...base, slug: v.slug, publish: v.publish } : base;
}

function parseTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}
