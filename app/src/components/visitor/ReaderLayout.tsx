// ReaderLayout —— the skeleton of the wiki reader: **the body centered to
// the viewport** + the tree hugging the left edge.
//
// ── Why the body uses absolute positioning to move the tree out of the way ──
//
// The previous version was `flex`: aside (resizable) + a divider + `main
// flex-1`. So the body was centered only within **whatever space was left
// over** — however wide the tree was, the body drifted right by that much.
// The reader saw a misaligned article, and the wider the tree the worse the
// drift. Now the body is `mx-auto max-w-[920px]` (centered to the
// **viewport**, matching the /writings home page), and the tree hangs
// `absolute` in the margin to its left, taking up no space — so the body's
// position is independent of the tree's width.
//
// This also removed the resizable divider along the way: its whole reason
// to exist was "the reader decides how wide the tree is", and once the tree
// no longer crowds the body, that degree of freedom stops solving anything
// and just leaves behind drag state to maintain.
//
// ── Cutting off the tree must be visible ──
//
// The tree being sticky and scrolling on its own is a **trade-off**, not an
// oversight: either it scrolls with the whole page (one scroll region,
// everything reachable, but scrolling to the middle of the article scrolls
// the tree out of view), or it stays put but becomes a second scroll
// region. We chose the latter.
//
// The cost is real, and has actually been hit: when the tree is taller than
// the viewport, its bottom half gets cut off, scrolling the mouse over the
// body doesn't move it, and the reader concludes "there's clearly more
// below, but I can't scroll to it". So the cutoff has to speak for itself —
// `styles.railFade` lays a fade-out along the bottom (the same convention
// as the sneak-peek card in UX-56: **anything that gets cut off needs a
// continue-reading signal at the cut**). Without it, being cut off reads as
// "broken" rather than "there's more".
//
// aside / children are both passed in from the server page (a client
// component can accept a server subtree as props).

'use client';

import type { ReactNode } from 'react';

import styles from '@/components/visitor/ReaderLayout.module.css';

// STICKY_TOP —— SessionStrip's height (sticky top:0). The tree pins below
// it — don't overlap.
const STICKY_TOP = 'top-[30px] max-h-[calc(100dvh-30px)]';

export function ReaderLayout({ aside, children, mainTestId }: {
  aside: ReactNode;
  children: ReactNode;
  mainTestId: string;
}) {
  return (
    <div className="relative">
      {/* Tree: doesn't render at all below xl — a narrow screen can't fit a
          tree, and squeezing it in makes the body unreadable. Absolute
          positioning = takes up no space = the body's centering doesn't
          depend on it. */}
      {/* `inset-y-0` rather than `top-0`: the track needs to be as tall as
          the document, or the sticky layer inside it has nowhere to travel.
          With just top-0 the track would only be as tall as its own
          content, and once scrolled past, sticky has nothing left to stick
          to — the tree stays pinned at the top of the document and
          vanishes entirely as you read further down (that's exactly what
          the first version did: scroll to the bottom and there's no tree
          at all). */}
      <aside
        className={`hidden xl:block absolute left-0 inset-y-0 w-[240px] pl-6 ${styles['rail']}`}
        data-testid="wiki-toc"
      >
        <div className={`sticky ${STICKY_TOP} overflow-y-auto ${styles['railInner']}`}>
          {aside}
        </div>
      </aside>
      <main className="mx-auto max-w-[920px] px-6 min-w-0" data-testid={mainTestId}>
        {children}
      </main>
    </div>
  );
}
