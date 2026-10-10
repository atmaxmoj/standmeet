// PostsSection —— /admin/posts (动态): the owner's timeline. A composer card on top (text, a pool
// image, who may see it, post), then the timeline with its own toolbar (show which audience, search),
// one ruled row per post with its audience and, on hover, the other audiences and delete.
// Visibility is the post's own (posts.md): private = the owner only, public = everyone,
// roles = visitors whose code carries one of the listed roles.

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChatMarkdown } from '@standmeet/sdk';

import { Btn } from '@/components/admin/atoms/Btn';
import { Chip } from '@/components/admin/atoms/Chip';
import { ListPane } from '@/components/admin/ListPane';
import { LoadMore } from '@/components/admin/LoadMore';
import { PickerSearchField } from '@/components/admin/PickerSearchField';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { PoolList } from '@/components/admin/sections/corpus/CorpusAssetsPanel';
import styles from '@/components/admin/sections/PostsSection.module.css';
import {
  usePosts, VISIBILITIES, type PostsHook, type PostView, type Visibility,
} from '@/lib/admin/use-posts';
import { usePostComposer } from '@/lib/admin/use-post-composer';
import { isPublicRole, useRoles } from '@/lib/admin/use-roles';
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
      <Toolbar hook={hook} />
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
  const c = usePostComposer(hook, () => toast.success(t('posted')), report);
  const [pool, setPool] = useState(false);
  return (
    <div className={styles.composer}>
      <textarea
        className={styles.body} value={c.body} rows={3}
        placeholder={t('placeholder')} aria-label={t('placeholder')} aria-keyshortcuts="Control+Enter Meta+Enter"
        onChange={(e) => c.setBody(() => e.target.value)} onKeyDown={c.onKey} data-testid="posts-composer-body"
      />
      <div className={styles.bar}>
        <Audience value={c.vis} onChange={c.setVis} roleIDs={c.roleIDs} onRoles={c.setRoleIDs} />
        <div className={styles.actions}>
          <Chip onClick={() => setPool((v) => !v)} active={pool} testid="posts-composer-pool-toggle">
            {pool ? t('poolHide') : t('poolShow')}
          </Chip>
          <Btn kind="solid" onClick={c.submit} disabled={!c.ready} testid="posts-composer-submit">{t('submit')}</Btn>
        </div>
      </div>
      {pool && (
        <div className={styles.pool}>
          <PoolList onThisEntry={[]} insertIntoBody={(md) => c.setBody((b) => `${b}${md}\n`)} testid="posts-composer" />
        </div>
      )}
    </div>
  );
}

// Audience —— who will see the post being written: three chips, and the roles when "roles".
function Audience({ value, onChange, roleIDs, onRoles }: {
  value: Visibility; onChange: (v: Visibility) => void;
  roleIDs: readonly string[]; onRoles: (ids: string[]) => void;
}) {
  const t = useTranslations('adminCorpus.posts');
  return (
    <div className={styles.audience}>
      <span className={styles.label}>{t('audience')}</span>
      {VISIBILITIES.map((v) => (
        <Chip key={v} active={value === v} onClick={() => onChange(v)} testid={`posts-composer-vis-${v}`}>
          {t(`vis.${v}`)}
        </Chip>
      ))}
      {value === 'roles' && <RolePicker chosen={roleIDs} onChange={onRoles} />}
    </div>
  );
}

function RolePicker({ chosen, onChange }: { chosen: readonly string[]; onChange: (ids: string[]) => void }) {
  const t = useTranslations('adminCorpus.posts');
  // Not the builtin public role: "every visitor without a code" is the public audience already.
  const roles = useRoles().roles.filter((r) => !isPublicRole(r));
  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  return (
    <span className={styles.roles} role="group" aria-label={t('rolesLabel')} data-testid="posts-composer-roles">
      {roles.map((r) => (
        <Chip key={r.id} active={chosen.includes(r.id)} onClick={() => toggle(r.id)} testid={`posts-composer-role-${r.id}`}>
          {r.name}
        </Chip>
      ))}
    </span>
  );
}

// Toolbar —— the timeline's own controls: which audience to show, and a search.
function Toolbar({ hook }: { hook: PostsHook }) {
  const t = useTranslations('adminCorpus.posts');
  const { params, setParams } = hook.page;
  const shown = params.visibility ?? '';
  return (
    <div className={styles.toolbar}>
      <div className={styles.audience}>
        <span className={styles.label}>{t('show')}</span>
        <Chip active={shown === ''} onClick={() => setParams({ visibility: '' })} testid="posts-filter-all">
          {t('filterAll')}
        </Chip>
        {VISIBILITIES.map((v) => (
          <Chip key={v} active={shown === v} onClick={() => setParams({ visibility: v })} testid={`posts-filter-${v}`}>
            {t(`vis.${v}`)}
          </Chip>
        ))}
      </div>
      <div className={styles.search}>
        <PickerSearchField
          value={params.q ?? ''} onChange={(q) => setParams({ q })}
          placeholder={t('search')} testid="posts-search"
        />
      </div>
    </div>
  );
}

function PostRow({ post, hook }: { post: PostView; hook: PostsHook }) {
  const t = useTranslations('adminCorpus.posts');
  return (
    <article className={styles.row} data-testid={`post-row-${post.id}`}>
      <div className={styles.meta}>
        <time dateTime={post.created_at}>{post.created_at.slice(0, 16).replace('T', ' ')}</time>
        {post.updated_at !== post.created_at && <span>{t('edited')}</span>}
        <span className={styles.badge} data-testid={`post-visibility-${post.id}`}>{t(`vis.${post.visibility}`)}</span>
        <RowActions post={post} hook={hook} />
      </div>
      <div className={styles.text}>
        <ChatMarkdown source={expandURIsForReader(post.body, post.asset_urls)} />
      </div>
    </article>
  );
}

// RowActions —— change the audience to another one, or delete. "roles" is offered only to a post
// that already names roles (a role list is chosen in the composer, not guessed here).
function RowActions({ post, hook }: { post: PostView; hook: PostsHook }) {
  const t = useTranslations('adminCorpus.posts');
  const report = useReportError();
  const others = VISIBILITIES.filter((v) => v !== post.visibility
    && (v !== 'roles' || post.visible_role_ids.length > 0));
  return (
    <span className={styles.rowActions}>
      <span className={styles.label}>{t('changeTo')}</span>
      {others.map((v) => (
        <Chip key={v} onClick={() => { hook.setVisibility(post, v).catch(report); }} testid={`post-visibility-set-${post.id}-${v}`}>
          {t(`vis.${v}`)}
        </Chip>
      ))}
      <DeleteBtn id={post.id} hook={hook} />
    </span>
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
