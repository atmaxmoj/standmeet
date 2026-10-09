// PostsSection —— /admin/posts (动态): the owner's timeline. A composer on top (text, a pool image,
// who may see it), the posts below newest first, each with its audience shown and changeable in
// place. Visibility is the post's own (posts.md): private = the owner only, public = everyone,
// roles = visitors whose code carries one of the listed roles.

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChatMarkdown } from '@standmeet/sdk';

import { ListPane } from '@/components/admin/ListPane';
import { LoadMore } from '@/components/admin/LoadMore';
import { PickerSearchField } from '@/components/admin/PickerSearchField';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { PoolList } from '@/components/admin/sections/corpus/CorpusAssetsPanel';
import styles from '@/components/admin/sections/PostsSection.module.css';
import { SelectField } from '@/components/atoms/SelectField';
import {
  asVisibility, usePosts, VISIBILITIES, type PostsHook, type PostView, type Visibility,
} from '@/lib/admin/use-posts';
import { useRoles } from '@/lib/admin/use-roles';
import { totalLabel } from '@/lib/state/create-paged-store';
import { DANGER_ACTION_CLASS } from '@/lib/ui/danger-action';
import { useToast } from '@/lib/ui/toast';
import { useReportError } from '@/lib/ui/use-report-error';
import { expandURIsForReader } from '@/lib/writings/asset-transforms';

export function PostsSection() {
  const t = useTranslations('adminCorpus.posts');
  const hook = usePosts();
  return (
    <>
      <SectionHeader
        kicker={t('kicker')} slug="posts"
        count={totalLabel(hook.page.total, (n) => t('count', { n }))}
      />
      <Composer hook={hook} />
      <Filters hook={hook} />
      <ListPane
        status={hook.page.status} count={hook.page.items.length}
        empty={<p className="sm-empty-hint reading" data-testid="posts-empty">{t('empty')}</p>}
      >
        <div className={styles.list} data-testid="posts-list">
          {hook.page.items.map((p) => <PostRow key={p.id} post={p} hook={hook} />)}
        </div>
        <LoadMore page={hook.page} testid="posts-load-more" />
      </ListPane>
    </>
  );
}

function Composer({ hook }: { hook: PostsHook }) {
  const t = useTranslations('adminCorpus.posts');
  const toast = useToast();
  const report = useReportError();
  const [body, setBody] = useState('');
  const [vis, setVis] = useState<Visibility>('private');
  const [roleIDs, setRoleIDs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    setBusy(true);
    hook.create({ body, visibility: vis, visible_role_ids: vis === 'roles' ? roleIDs : [] })
      .then(() => { setBody(''); setRoleIDs([]); toast.success(t('posted')); }, report)
      .finally(() => setBusy(false));
  };
  return (
    <div className={styles.composer}>
      <textarea
        className={`sm-field-input ${styles.body}`} value={body} rows={4}
        placeholder={t('placeholder')} aria-label={t('placeholder')}
        onChange={(e) => setBody(e.target.value)} data-testid="posts-composer-body"
      />
      <PoolPicker insert={(md) => setBody((b) => `${b}${md}\n`)} />
      <div className={styles.controls}>
        <VisibilitySelect value={vis} onChange={setVis} testid="posts-composer-visibility" />
        <button
          type="button" className="sm-btn sm-btn-sm" onClick={submit}
          disabled={busy || body.trim() === ''} data-testid="posts-composer-submit"
        >
          {t('submit')}
        </button>
      </div>
      {vis === 'roles' && <RolePicker chosen={roleIDs} onChange={setRoleIDs} />}
    </div>
  );
}

function PoolPicker({ insert }: { insert: (markdown: string) => void }) {
  const t = useTranslations('adminCorpus.posts');
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.pool}>
      <button
        type="button" className={styles.link} onClick={() => setOpen((v) => !v)}
        data-testid="posts-composer-pool-toggle"
      >
        {open ? t('poolHide') : t('poolShow')}
      </button>
      {open && <PoolList onThisEntry={[]} insertIntoBody={insert} testid="posts-composer" />}
    </div>
  );
}

function RolePicker({ chosen, onChange }: { chosen: readonly string[]; onChange: (ids: string[]) => void }) {
  const t = useTranslations('adminCorpus.posts');
  const { roles } = useRoles();
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...chosen, id] : chosen.filter((x) => x !== id));
  return (
    <fieldset className={styles.roles} data-testid="posts-composer-roles">
      <legend className="sm-smallcaps">{t('rolesLabel')}</legend>
      {roles.map((r) => (
        <label key={r.id} className={styles.role}>
          <input
            type="checkbox" checked={chosen.includes(r.id)}
            onChange={(e) => toggle(r.id, e.target.checked)} data-testid={`posts-composer-role-${r.id}`}
          />
          {r.name}
        </label>
      ))}
    </fieldset>
  );
}

function VisibilitySelect({ value, onChange, testid }: {
  value: Visibility; onChange: (v: Visibility) => void; testid: string;
}) {
  const t = useTranslations('adminCorpus.posts');
  return (
    <SelectField mono value={value} onChange={(e) => onChange(asVisibility(e.target.value))} testid={testid}>
      {VISIBILITIES.map((v) => <option key={v} value={v}>{t(`vis.${v}`)}</option>)}
    </SelectField>
  );
}

function Filters({ hook }: { hook: PostsHook }) {
  const t = useTranslations('adminCorpus.posts');
  const { params, setParams } = hook.page;
  return (
    <div className={styles.filters}>
      <SelectField
        mono value={params.visibility ?? ''} onChange={(e) => setParams({ visibility: e.target.value })}
        testid="posts-filter-visibility"
      >
        <option value="">{t('filterAll')}</option>
        {VISIBILITIES.map((v) => <option key={v} value={v}>{t(`vis.${v}`)}</option>)}
      </SelectField>
      <PickerSearchField
        value={params.q ?? ''} onChange={(q) => setParams({ q })}
        placeholder={t('search')} testid="posts-search"
      />
    </div>
  );
}

function PostRow({ post, hook }: { post: PostView; hook: PostsHook }) {
  const t = useTranslations('adminCorpus.posts');
  const report = useReportError();
  return (
    <article className={styles.row} data-testid={`post-row-${post.id}`}>
      <div className={styles.meta}>
        <time dateTime={post.created_at}>{post.created_at.slice(0, 16).replace('T', ' ')}</time>
        {post.updated_at !== post.created_at && <span>{t('edited')}</span>}
        <span className={styles.badge} data-testid={`post-visibility-${post.id}`}>{t(`vis.${post.visibility}`)}</span>
        <VisibilitySelect
          value={post.visibility} testid={`post-visibility-edit-${post.id}`}
          onChange={(v) => { hook.setVisibility(post, v).catch(report); }}
        />
        <DeleteBtn id={post.id} hook={hook} />
      </div>
      <ChatMarkdown source={expandURIsForReader(post.body, post.asset_urls)} />
    </article>
  );
}

function DeleteBtn({ id, hook }: { id: string; hook: PostsHook }) {
  const t = useTranslations('adminCorpus.posts');
  const toast = useToast();
  const report = useReportError();
  const onClick = () => (confirm(t('confirmDelete'))
    ? void hook.remove(id).then(() => toast.success(t('deleted')), report)
    : null);
  return (
    <button type="button" onClick={onClick} data-testid={`post-delete-${id}`} className={DANGER_ACTION_CLASS}>
      {t('delete')}
    </button>
  );
}
