// SiteWiki —— a microsite that reads like a wiki: a tree of pages, [[links]], backlinks, history,
// and an editor, all kept in the microsite's own store (docs/design/site-wiki.md).
//
//   import { SiteWiki } from '@standmeet/sdk';
//   export default function App() { return <SiteWiki />; }

'use client';

import { useEffect, useState } from 'react';

import { ChatLangProvider, useChatT } from '../i18n.js';
import { cleanPath, type WikiPages } from './model.js';
import { useHashPath, useSiteWiki, type PageDraft } from './use-site-wiki.js';
import { Editor, PageView, Tree } from './views.js';

import './site-wiki.css';

export interface SiteWikiProps {
  // collection —— the store collection the pages live in (default 'wiki').
  collection?: string;
  // lang —— the UI's language; default the page's own (<html lang>).
  lang?: string;
}

export function SiteWiki({ collection = 'wiki', lang }: SiteWikiProps): React.ReactElement {
  const body = <SiteWikiBody collection={collection} />;
  return lang === undefined ? body : <ChatLangProvider lang={lang}>{body}</ChatLangProvider>;
}

// Editing —— the editor is open on this draft (isNew: the address can still be chosen).
interface Editing { draft: PageDraft; isNew: boolean }

// editorFor —— the editor to show: the one asked for (edit, new page), else the page an address
// points at that nobody has written yet; null to show the address's page.
function editorFor(asked: Editing | null, path: string, pages: WikiPages): Editing | null {
  if (asked !== null) return asked;
  return path !== '' && !pages.has(path) ? { draft: { path, title: '', body: '' }, isNew: true } : null;
}

function SiteWikiBody({ collection }: { collection: string }): React.ReactElement {
  const t = useChatT('wiki');
  const wiki = useSiteWiki(collection);
  const [path, go] = useHashPath();
  const [asked, setAsked] = useState<Editing | null>(null);
  // waiting —— the page whose new version waits for the owner's review (its notice shows there).
  const [waiting, setWaiting] = useState('');
  useEffect(() => { setAsked(null); }, [path]);

  const save = async (d: PageDraft) => {
    const got = await wiki.save(d);
    if (got === null) return;
    setAsked(null);
    setWaiting(got.pending ? cleanPath(d.path) : '');
    go(d.path);
  };
  const editing = editorFor(asked, path, wiki.pages);
  const page = wiki.pages.get(path);
  const main = editing !== null
    ? (
      <Editor
        key={`${editing.draft.path}:${String(editing.isNew)}`} draft={editing.draft} isNew={editing.isNew}
        onSave={(d) => { void save(d); }} onCancel={() => { setAsked(null); go(''); }}
      />
    )
    : page !== undefined
      ? (
        <PageView
          page={page} pages={wiki.pages}
          onEdit={() => { setAsked({ draft: { path: page.path, title: page.title, body: page.body }, isNew: false }); }}
        />
      )
      : <Start empty={wiki.pages.size === 0} />;
  return (
    <div className="smw" data-testid="site-wiki">
      <aside className="smw-aside">
        <p className="smw-label">{t('pages')}</p>
        <nav data-testid="site-wiki-tree"><Tree folder={wiki.tree} current={path} /></nav>
        <button
          type="button" className="smw-action" data-testid="site-wiki-new"
          onClick={() => { setAsked({ draft: { path: '', title: '', body: '' }, isNew: true }); }}
        >
          {t('new')}
        </button>
      </aside>
      <main className="smw-main">
        {waiting !== '' && waiting === path && <p className="smw-notice" data-testid="site-wiki-pending">{t('pending')}</p>}
        {wiki.error !== null && <p className="smw-error">{wiki.error}</p>}
        {editing !== null && editing.isNew && path !== '' && asked === null && <p className="smw-empty">{t('notYet')}</p>}
        {main}
      </main>
    </div>
  );
}

function Start({ empty }: { empty: boolean }): React.ReactElement {
  const t = useChatT('wiki');
  return empty
    ? <p className="smw-empty" data-testid="site-wiki-empty">{t('empty')}</p>
    : <p className="smw-empty">{t('pick')}</p>;
}
