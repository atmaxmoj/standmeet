// Posts —— the owner's timeline, drop-in: `<Posts />` inside <StandMeetProvider>. Each post shows
// its time (absolute, in the reader's timezone and the page's language) and its body through the one
// corpus markdown renderer (sanitized, KaTeX). A visitor only ever receives what it may see, so no
// audience badge is shown. Styles: .smp-* in posts.css.

'use client';

import React from 'react';
import type { Post } from '@standmeet/sdk-core';

import { ChatMarkdown } from '../chat/markdown.js';
import { resolveLocale, useT } from '../i18n.js';
import { usePosts } from './use-posts.js';

export function Posts(): React.ReactElement {
  const t = useT();
  const { items, loading, error, hasMore, loadMore } = usePosts();
  return (
    <section data-testid="posts-widget" className="smp">
      {items.map((p) => <PostItem key={p.id} post={p} />)}
      {!loading && error && <p data-testid="posts-error" className="smp-note">{t('postsError')}</p>}
      {!loading && !error && items.length === 0 && (
        <p data-testid="posts-empty" className="smp-note">{t('postsEmpty')}</p>
      )}
      {hasMore && (
        <button type="button" className="smp-more" onClick={loadMore} disabled={loading}>
          {t('postsMore')}
        </button>
      )}
    </section>
  );
}

function PostItem({ post }: { post: Post }): React.ReactElement {
  const t = useT();
  return (
    <article data-testid={`posts-item-${post.id}`} className="smp-item">
      <div className="smp-meta">
        <time data-testid="posts-time" className="smp-time" dateTime={post.created_at}>
          {formatTime(post.created_at)}
        </time>
        {post.edited && <span data-testid="posts-edited" className="smp-edited">{t('postsEdited')}</span>}
      </div>
      <div data-testid="posts-body" className="smp-body">
        <ChatMarkdown source={withAssets(post.body, post.asset_urls ?? {})} variant="article" />
      </div>
    </article>
  );
}

// formatTime —— an absolute date + clock time in the reader's timezone (the browser's), worded in the
// page's language. Items only exist after the client fetch, so this never runs in the prerender.
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(resolveLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

const ASSET_IMAGE = /!\[[^\]]*\]\(\s*standmeet-asset:([0-9a-fA-F-]{36})\s*\)/g;
const ASSET_URI = /standmeet-asset:([0-9a-fA-F-]{36})/g;

// withAssets —— `standmeet-asset:<id>` → the URL the server gave this reader. An image the reader
// was given no URL for is dropped whole (its alt text is the owner's internal filename).
function withAssets(body: string, urls: Readonly<Record<string, string>>): string {
  return body
    .replace(ASSET_IMAGE, (m, id: string) => (urls[id] === undefined ? '' : m))
    .replace(ASSET_URI, (m, id: string) => urls[id] ?? m);
}
