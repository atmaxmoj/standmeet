// page.tsx —— SiteWikiPage: whatever the address (#/<path>) shows — the wiki's start, a page with
// its backlinks and history, or the editor (a new page, an edit, a page nobody has written yet) —
// and a "write a page" button. Put it in the page's main column.

'use client';

import { useEffect, useState } from 'react';

import { useChatT } from '../i18n.js';
import { cleanPath, type WikiPage, type WikiPages } from './model.js';
import { useHashPath, useSiteWiki, type PageDraft } from './use-site-wiki.js';
import { Editor, PageView } from './views.js';

export interface SiteWikiPageProps {
  // collection —— the store collection, when the page uses no <SiteWikiProvider> (default 'wiki').
  collection?: string;
}

// Editing —— the editor is open on this draft (isNew: the address can still be chosen).
interface Editing { draft: PageDraft; isNew: boolean }
interface Conflict { draft: PageDraft; theirs: WikiPage }

// editorFor —— the editor to show: the one asked for (edit, new page), else the page an address
// points at that nobody has written yet; null to show the address's page.
function editorFor(asked: Editing | null, path: string, pages: WikiPages): Editing | null {
  if (asked !== null) return asked;
  return path !== '' && !pages.has(path) ? { draft: { path, title: '', body: '' }, isNew: true } : null;
}

// newerThan —— the page's newest version when it is not the one this draft was written over:
// someone saved meanwhile (or created the page a new draft names).
function newerThan(d: PageDraft, pages: WikiPages): WikiPage | null {
  const now = pages.get(cleanPath(d.path));
  return now !== undefined && now.id !== (d.base ?? '') ? now : null;
}

export function SiteWikiPage({ collection = 'wiki' }: SiteWikiPageProps): React.ReactElement {
  const t = useChatT('wiki');
  const wiki = useSiteWiki(collection);
  const [path, go] = useHashPath();
  const [asked, setAsked] = useState<Editing | null>(null);
  // waiting —— the page whose new version waits for the owner's review (its notice shows there).
  const [waiting, setWaiting] = useState('');
  // conflict —— a save held back: someone saved this page while the draft was being written.
  const [conflict, setConflict] = useState<Conflict | null>(null);
  useEffect(() => { setAsked(null); setConflict(null); }, [path]);

  const save = async (d: PageDraft, force = false) => {
    const theirs = force ? null : newerThan(d, wiki.pages);
    if (theirs !== null) {
      setConflict({ draft: d, theirs });
      return;
    }
    const got = await wiki.save(d);
    if (got === null) return;
    setAsked(null);
    setConflict(null);
    setWaiting(got.pending ? cleanPath(d.path) : '');
    go(d.path);
  };
  const editing = editorFor(asked, path, wiki.pages);
  const page = wiki.pages.get(path);
  const newPage = () => { setConflict(null); setAsked({ draft: { path: '', title: '', body: '' }, isNew: true }); };
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
          onEdit={() => { setAsked({ draft: { path: page.path, title: page.title, body: page.body, base: page.id }, isNew: false }); }}
        />
      )
      : <Start empty={wiki.pages.size === 0} />;
  return (
    <div className="smw-main" data-testid="site-wiki">
      <div className="smw-main-bar">
        <button type="button" className="smw-action" data-testid="site-wiki-new" onClick={newPage}>{t('new')}</button>
      </div>
      {waiting !== '' && waiting === path && <p className="smw-notice" data-testid="site-wiki-pending">{t('pending')}</p>}
      {conflict !== null && (
        <ConflictNotice
          conflict={conflict}
          onKeepMine={() => { void save(conflict.draft, true); }}
          onSeeTheirs={() => { setConflict(null); setAsked(null); }}
        />
      )}
      {wiki.error !== null && <p className="smw-error">{wiki.error}</p>}
      {editing !== null && editing.isNew && path !== '' && asked === null && <p className="smw-empty">{t('notYet')}</p>}
      {main}
    </div>
  );
}

function ConflictNotice({ conflict, onKeepMine, onSeeTheirs }: {
  conflict: Conflict; onKeepMine: () => void; onSeeTheirs: () => void;
}): React.ReactElement {
  const t = useChatT('wiki');
  return (
    <div className="smw-conflict" data-testid="site-wiki-conflict">
      <p>{t('conflict', { name: conflict.theirs.author || '—' })}</p>
      <div className="smw-editor-actions">
        <button type="button" className="smw-action smw-action-primary" data-testid="site-wiki-keep-mine" onClick={onKeepMine}>
          {t('keepMine')}
        </button>
        <button type="button" className="smw-action" onClick={onSeeTheirs}>{t('seeTheirs')}</button>
      </div>
    </div>
  );
}

function Start({ empty }: { empty: boolean }): React.ReactElement {
  const t = useChatT('wiki');
  return empty
    ? <p className="smw-empty" data-testid="site-wiki-empty">{t('empty')}</p>
    : <p className="smw-empty">{t('pick')}</p>;
}
