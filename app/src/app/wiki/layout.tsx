// The /wiki shell — top bar + session strip + left tree, **mounted once,
// stable across articles**.
//
// Why this has to be a layout and not re-rendered per page:
//
// The top bar and tree used to live inside `wiki/page.tsx` and
// `wiki/[...path]/page.tsx` separately. Next **keeps the layout and only
// swaps the page** when navigating between sibling pages, but those two
// pieces lived in the page back then, so clicking into an article meant the
// whole shell remounted: the tree re-rendered, every level refetched, and
// the screen showed "the tree flashing."
// (`admin` was already a layout, which is why switching admin sections
// doesn't flicker its sidebar — same structure, wiki just never had it.)
//
// Moving it up here also fixed scrolling as a side effect: the shell is
// fixed, **only the body column scrolls on its own**, so as the reader
// scrolls down the top bar and tree stay put instead of scrolling away with
// it. The three regions are independent:
//   top bar + session strip — does not scroll
//   tree                    — scrolls on its own (when taller than viewport)
//   body                    — scrolls on its own
//
// The tree's highlight is derived from the **URL** (`usePathname` inside
// `WikiTreeView`), no longer passed as a prop from the page — passing it as
// a prop would force the layout to change with the current article, which
// puts us right back to "re-render per article."

import type { ReactNode } from 'react';

import { SessionStrip } from '@/components/visitor/SessionStrip';
import { WikiTopBar } from '@/components/visitor/WikiTopBar';
import { ReaderChatRail } from '@/components/visitor/ReaderChatRail';
import { WikiTreeView } from '@/components/visitor/WikiTreeView';
import { fetchInstance } from '@/lib/api/instance';
import { fetchWikiTreeStats } from '@/lib/api/public';

import styles from '@/app/wiki/wiki-shell.module.css';

export default async function WikiLayout({ children }: { children: ReactNode }) {
  const [instance, stats] = await Promise.all([fetchInstance(), fetchWikiTreeStats()]);
  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <WikiTopBar handle={instance.handle} />
      <SessionStrip />
      <div className="flex-1 flex min-h-0 relative">
        {/* Tree: absolutely positioned, takes no layout width — the body is
            therefore centered on the **viewport**, not in whatever's left
            after the tree. Its width = the margin itself (see
            wiki-shell.module.css): the wider the screen, the more readable
            the tree, and it can never crowd the body. It doesn't render at
            all when the margin is under 260px — the test is "does this tree
            have room to stand," not "is the screen big." */}
        <aside className={styles['rail']} data-testid="wiki-toc">
          <WikiTreeView stats={stats} />
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto" data-testid="wiki-scroll">
          <div className="mx-auto max-w-[920px] px-6">{children}</div>
        </main>
        {/* Right rail "ask about this," symmetric with the tree on the left.
            **Renders even with no session**: at that point it's the BYOAI
            entry point — the reader fills in their own key and can start
            asking, rather than only seeing a hint once they scroll to the
            very bottom of the body. */}
        <ReaderChatRail>{null}</ReaderChatRail>
      </div>
    </div>
  );
}
