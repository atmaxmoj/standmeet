// SiteWiki —— a microsite that reads like a wiki: a tree of pages, [[links]], backlinks, history,
// and an editor, all kept in the microsite's own store (docs/design/site-wiki.md).
//
// The whole wiki in one line:
//
//   <SiteWiki />                      (tree beside it; <SiteWiki tree={false} /> without)
//
// Or the parts, laid out by the page itself:
//
//   <SiteWikiProvider>                (optional: the parts share one read and one live stream)
//     <aside><SiteWikiTree /></aside>
//     <main><SiteWikiPage /></main>
//     … <SiteWikiLink to="the-ledger">the ledger</SiteWikiLink> anywhere in the page's own text
//   </SiteWikiProvider>
//
// The parts share nothing but the address (#/<path>), so they stay in step without wiring.

'use client';

import { ChatLangProvider, useChatT } from '../i18n.js';
import { hrefOf, resolve, cleanPath } from './model.js';
import { SiteWikiPage } from './page.js';
import { SiteWikiContext, useHashPath, useSiteWiki, useSiteWikiData } from './use-site-wiki.js';
import { Tree } from './views.js';

import './site-wiki.css';

interface CommonProps {
  // collection —— the store collection the pages live in (default 'wiki'). Under a
  // <SiteWikiProvider> the provider's collection is used.
  collection?: string;
  // lang —— the UI's language; default the page's own (<html lang>).
  lang?: string;
}

export interface SiteWikiProps extends CommonProps {
  // tree —— draw the page tree beside the wiki (default true).
  tree?: boolean;
}

export function SiteWiki({ collection = 'wiki', lang, tree = true }: SiteWikiProps): React.ReactElement {
  return (
    <SiteWikiProvider collection={collection} lang={lang}>
      <div className={tree ? 'smw' : 'smw smw-solo'}>
        {tree && <aside className="smw-aside"><SiteWikiTree /></aside>}
        <SiteWikiPage />
      </div>
    </SiteWikiProvider>
  );
}

// SiteWikiProvider —— one read and one live stream of the wiki for every part below it.
export function SiteWikiProvider(
  { collection = 'wiki', lang, children }: CommonProps & { children: React.ReactNode },
): React.ReactElement {
  const data = useSiteWikiData(collection);
  return withLang(lang, <SiteWikiContext.Provider value={data}>{children}</SiteWikiContext.Provider>);
}

// SiteWikiTree —— the page tree, for the page's own sidebar. The current page is marked.
export function SiteWikiTree({ collection = 'wiki', lang }: CommonProps): React.ReactElement {
  return withLang(lang, <TreePanel collection={collection} />);
}

// SiteWikiLink —— a link from the page's own content to a wiki page, by path or title. It says
// whether the page exists (data-missing); following a missing one opens the editor there.
export function SiteWikiLink({ to, collection = 'wiki', children }: {
  to: string; collection?: string; children?: React.ReactNode;
}): React.ReactElement {
  const wiki = useSiteWiki(collection);
  const path = resolve(to, wiki.pages);
  return (
    <a href={hrefOf(path ?? cleanPath(to))} className="smw-link" data-missing={path === null ? 'true' : 'false'}>
      {children ?? to}
    </a>
  );
}

function withLang(lang: string | undefined, body: React.ReactElement): React.ReactElement {
  return lang === undefined ? body : <ChatLangProvider lang={lang}>{body}</ChatLangProvider>;
}

function TreePanel({ collection }: { collection: string }): React.ReactElement {
  const t = useChatT('wiki');
  const wiki = useSiteWiki(collection);
  const [path] = useHashPath();
  return (
    <div className="smw-tree">
      <p className="smw-label">{t('pages')}</p>
      <nav data-testid="site-wiki-tree"><Tree folder={wiki.tree} current={path} /></nav>
    </div>
  );
}
