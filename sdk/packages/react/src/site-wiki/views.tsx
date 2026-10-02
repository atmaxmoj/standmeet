// views.tsx —— SiteWiki's parts: the tree, a page, the editor. Styles are classes in site-wiki.css.

'use client';

import { useState } from 'react';

import { ChatMarkdown } from '../chat/markdown.js';
import { useChatT } from '../i18n.js';
import {
  backlinksOf, hrefOf, pathOfHref, toMarkdown, type WikiFolder, type WikiPage, type WikiPages,
} from './model.js';
import type { PageDraft } from './use-site-wiki.js';

export function Tree({ folder, current }: { folder: WikiFolder; current: string }): React.ReactElement {
  return (
    <ul className="smw-tree-level">
      {folder.folders.map((f) => (
        <li key={`d:${f.name}`}>
          <span className="smw-folder" data-testid="site-wiki-folder">{f.name}/</span>
          <Tree folder={f} current={current} />
        </li>
      ))}
      {folder.pages.map((p) => (
        <li key={`p:${p.path}`}>
          <a href={hrefOf(p.path)} className="smw-tree-page" aria-current={p.path === current ? 'page' : undefined}>
            {p.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

// anchorFor —— a link in a page: an in-wiki link says whether its page exists (data-missing); any
// other link opens outside the wiki.
export function anchorFor(pages: WikiPages) {
  return function WikiAnchor(props: React.ComponentPropsWithoutRef<'a'>): React.ReactElement {
    const { href = '', ...rest } = props;
    const path = pathOfHref(href);
    return path === null
      ? <a href={href} target="_blank" rel="noopener noreferrer" {...rest} />
      : <a href={href} className="smw-link" data-missing={pages.has(path) ? 'false' : 'true'} {...rest} />;
  };
}

export function PageView({ page, pages, onEdit }: {
  page: WikiPage; pages: WikiPages; onEdit: () => void;
}): React.ReactElement {
  const t = useChatT('wiki');
  return (
    <article className="smw-page">
      <header className="smw-page-head">
        <h1 className="smw-page-title">{page.title}</h1>
        <button type="button" className="smw-action" data-testid="site-wiki-edit" onClick={onEdit}>
          {t('edit')}
        </button>
      </header>
      <div data-testid="site-wiki-page">
        <ChatMarkdown source={toMarkdown(page.body, pages)} variant="article" anchor={anchorFor(pages)} />
      </div>
      <Backlinks from={backlinksOf(page.path, pages)} />
      <History page={page} />
    </article>
  );
}

function Backlinks({ from }: { from: WikiPage[] }): React.ReactElement | null {
  const t = useChatT('wiki');
  return from.length === 0 ? null : (
    <section className="smw-backlinks" data-testid="site-wiki-backlinks">
      <h2 className="smw-label">{t('backlinks')}</h2>
      <ul>{from.map((p) => <li key={p.path}><a href={hrefOf(p.path)}>{p.title}</a></li>)}</ul>
    </section>
  );
}

function History({ page }: { page: WikiPage }): React.ReactElement {
  const t = useChatT('wiki');
  const [open, setOpen] = useState(false);
  return (
    <section className="smw-history">
      <button
        type="button" className="smw-label smw-history-toggle" data-testid="site-wiki-history-toggle"
        aria-expanded={open} onClick={() => { setOpen(!open); }}
      >
        {t('history', { count: page.versions.length })}
      </button>
      {open && (
        <ol className="smw-versions">
          {page.versions.map((v) => (
            <li key={v.id} className="smw-version" data-testid="site-wiki-version">
              <span>{t('by', { name: v.author || '—' })}</span>
              <time dateTime={v.at}>{v.at.slice(0, 16).replace('T', ' ')}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Editor —— one version of one page. A new page's address is typed; an existing page keeps its own.
export function Editor({ draft, isNew, onSave, onCancel }: {
  draft: PageDraft; isNew: boolean; onSave: (d: PageDraft) => void; onCancel: () => void;
}): React.ReactElement {
  const t = useChatT('wiki');
  const [d, setD] = useState(draft);
  const set = (k: keyof PageDraft) => (e: { target: { value: string } }) => { setD({ ...d, [k]: e.target.value }); };
  return (
    <form className="smw-editor" onSubmit={(e) => { e.preventDefault(); onSave(d); }}>
      <label className="smw-field">
        <span className="smw-label">{t('path')}</span>
        <input value={d.path} onChange={set('path')} readOnly={!isNew} required data-testid="site-wiki-path" />
      </label>
      <label className="smw-field">
        <span className="smw-label">{t('title')}</span>
        <input value={d.title} onChange={set('title')} data-testid="site-wiki-title" />
      </label>
      <label className="smw-field">
        <span className="smw-label">{t('body')}</span>
        <textarea value={d.body} onChange={set('body')} rows={14} data-testid="site-wiki-body" />
      </label>
      <div className="smw-editor-actions">
        <button type="submit" className="smw-action smw-action-primary" data-testid="site-wiki-save">{t('save')}</button>
        <button type="button" className="smw-action" onClick={onCancel}>{t('cancel')}</button>
      </div>
    </form>
  );
}
