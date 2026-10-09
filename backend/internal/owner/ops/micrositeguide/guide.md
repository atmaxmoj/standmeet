# Building a StandMeet microsite

You are authoring a React page that StandMeet builds (Vite + Tailwind v4) and hosts on this
instance. Read this before you write `App.tsx`. The goal is a page that looks like it was
designed on purpose — not a generic AI layout — and that shows corpus content **inline**, not as
a wall of links that navigate away.

## The design system is already loaded

Every build ships the StandMeet theme (`theme.css`): the tokens, the two brand fonts, and a few
base classes. Use them — do not invent a second palette or import other fonts.

Tokens (use as Tailwind arbitrary values, e.g. `text-(--color-ink)`, `bg-(--color-paper)`,
`border-(--color-rule)`):

- `--color-paper` (page ground), `--color-surface`, `--color-raised` — warm cream.
- `--color-ink` (body text), `--color-muted` (secondary), `--color-faint` (tertiary/marks).
- `--color-rule` (hairlines), `--color-accent` (vermillion `#B5391C`), `--color-accent-soft`.
- Dark mode is automatic (follows the visitor's system preference). Only use the tokens — never a
  hard-coded hex — so both modes work.

Type:

- `font-serif` → Newsreader (body, headings, reading). This is the voice of the page.
- `.mono` → JetBrains Mono, for labels / metadata / small uppercase eyebrows only.
- `.reading` → comfortable measure + rhythm for body paragraphs.

## Widgets — prefer these, don't hand-write the blocks

There is ONE managed set of site widgets. Compose them; do not re-implement a chat, a corpus
browser, or a nav by hand. `import { CorpusWidget, AgentWidget, GateWidget, PageNavWidget,
AssetWidget, BlockWidget } from '@standmeet/sdk'`:

- `<CorpusWidget heading? limit? />` — every published corpus entry as a card; clicking one opens
  the note **inline** (no navigation), with a quiet "read in full ↗" to the reader.
- `<AgentWidget layout? placeholder? examples? lang? />` — the agent: the same chat the owner's
  own site runs (answers as rendered markdown and math, the retrieval card, citations, the code's
  suggested question, dock buttons). With no grant it hands the question to /gate; with a code it
  is the code's own agent (corpus scope, persona, quota inherited — nothing to wire). `layout`:
  - `"rail"` — **use this on a letter / a long page a reader reads top to bottom.** A column beside
    the page on a wide screen, always in view, so a question can be asked at the line that raised
    it; a floating dock on a phone. The page's column makes room by itself.
  - `"inline"` (default) — in the page flow where you put it (a page whose point IS the chat).
  - `"dock"` — the floating pill on every screen size.
  `examples` are the starter questions shown before the first turn.
- `<GateWidget label? sublabel? />` — the access CTA (enter a code / bring a key / request access).
- `<PageNavWidget exclude? heading? />` — links to the owner's other published pages.
- `<AssetWidget asset="standmeet-asset:<id>" alt? download? />` — embed one asset from the owner's
  pool by id (an image, or a download link with `download="file.pdf"`). Pass the id exactly as
  `standmeet-asset:<id>`; that records the page as using the asset, so it can't be deleted from the
  pool while this page embeds it.
- `<Posts />` — the owner's timeline of short posts, newest first, each in the reader's timezone and
  the page's language. It shows only what the reader may see: public posts to anyone, plus the posts
  addressed to the role of the reader's code once they hold one. Never a private post. For a custom
  layout, `import { usePosts } from '@standmeet/sdk'` → `{ items, loading, error, hasMore, loadMore }`.
- `<BlockWidget tool="…" args? runLabel? autoRun? />` — run ONE plugin (block) tool directly on the
  page, outside the chat loop: a booking action (`calendar_book`), a corpus search (`corpus_search`),
  an ask widget (`ask_visitor`). It runs the block over the visitor's own session (same grant as the
  chat agent — a tool the visiting code didn't grant is refused) and renders the block's result.
  `autoRun` fires it on load (a read-only card); otherwise it's a button (`runLabel`). For the
  primitive, `import { useBlockTool } from '@standmeet/sdk'` → `{ call, result, error, state, granted }`.
  **Needs a session first.** A block runs over the visitor's session, so it returns data only once a
  session exists. On a code-bound page the reader must present the code at `/gate` first — that mints
  the session and redirects back; opening `/p/<slug>?code=XXX` by itself does NOT establish one.
  Until then `granted` is `false` and the widget shows an "open with a code" line instead of a run
  button. Arg shape: the visitor-side `corpus_search` block takes only `{query, limit, offset}` — no
  `genre` (that's the owner tool's arg); a granted tool is refused only when the code's role lacks
  the matching scope (for `corpus_search`, the role's `corpus_uris`). `autoRun` is gated the same
  way — it fires only after the session exists (after the gate), so a page tested via `?code=`
  shows it sitting idle, not a bug.

## Lower-level pieces (only if a widget doesn't fit)

- `import React, { useState, useEffect } from 'react'`
- `import { createClient, type CorpusCard, type MicrositeLink } from '@standmeet/sdk-core'`
  - `const sm = createClient({ baseURL: '' })` (same origin — the instance serving this page).
  - `sm.fetchCorpusCards()` → published corpus cards; `sm.fetchWikiLanding(path)` → one note's body;
    `sm.fetchMicrosites()` → the owner's other published pages.
- `import { StandMeetProvider, useChatSession, AnswerText } from '@standmeet/sdk'`
  - `useChatSession(input)` → `{ messages, streaming, error, send(text), clear() }` — the same
    engine AgentWidget runs, as plain state, for a page that draws its own chat.
  - `<AnswerText text={…} />` renders an answer with StandMeet's paragraph/citation formatting.

## Persist state — the page's own store

A microsite can save and read back its **own** data — a poll tally, a sign-up sheet, a guestbook, an
edited-in-place document. This is a per-page key/value store, scoped automatically to this page (the
server keys every read/write to the page's slug from `/p/<slug>/…`, so you never pass an id).

```tsx
import { useMicrositeStore } from '@standmeet/sdk';

function Guestbook() {
  const { docs, save, error } = useMicrositeStore('entries'); // 'entries' = a collection name
  // docs: the published documents, oldest first. LIVE: another visitor's write, the agent's, the
  // owner's approval or delete appear on every open page without a reload.
  // save(doc): append one document; resolves when stored, or sets `error` if the write is refused.
  const add = (name: string, note: string) => { void save({ name, note, at: Date.now() }); };
  // …render docs as a list (key={d._id}, show d._author?.name), an input that calls add(), and
  // show `error` if present.
}
```

- `useMicrositeStore(collection, slugOverride?)` → `{ docs, save, error }`. `docs` is a `StoredDoc[]`:
  your own keys plus the host's, which start with `_` — `_id`, `_author` (`{kind: 'member' |
  'agent' | 'owner', name}`: the visitor who wrote it, or the agent writing for that visitor) and
  `_created_at`. A document you `save` may not contain a top-level `_` key; the host writes those.
- **Reads never throw** — they degrade to an empty list. **Writes can be refused**: the owner may
  have this page's store set to read-only, or it may be full, or the document invalid — surface
  `error` to the reader rather than assuming success.
- The store is **enabled per page by the owner** (`microsite.set_store_writable`). If writes always
  fail with a "not writable" error, that's why — the owner has to open the store for this page.
- **The owner's rules per page** (`microsite.set_store_policy`): `max_docs` (default 500) and
  `review` — with review on, a new document waits until the owner approves it
  (`microsite.store_approve`) and `docs` does not include it until then.

### Writing together through the agent

On a page with a store, the visitor's agent (`<AgentWidget>` / `<Agent>`) can read and write it:
`store_read` and `store_search` (passages with their authors) and `store_append` (adds one passage
for the visitor, stamped `_author.kind = 'agent'`). They act on the collection `passages` unless the
call names another, so a shared manuscript is `useMicrositeStore('passages')` with documents
`{ text }`. Make the agent the main way to write: put the chat next to the manuscript, and keep a
plain "add" box as the second way. What the agent adds appears live on every open page.

### A wiki kept in the page: `SiteWiki`

`import { SiteWiki } from '@standmeet/sdk'` and render `<SiteWiki />` for a page that reads like a
wiki: a tree of pages (paths with `/` make folders), `[[links]]` between pages (a link to a page not
written yet shows as missing and opens the editor), backlinks, each page's history, and an editor
for visitors the page lets write. The pages live in this page's own store (collection `wiki`;
`collection` prop to change it), not in the owner's corpus. Each save is a new version, so the
store's document limit counts versions: raise it for a busy wiki. Review, live updates and authors
work as for any store. `useSiteWiki()` gives the same pages without the UI.

The same wiki also comes in parts, for a page that lays itself out (they follow one another through
the address `#/<path>`, nothing to wire):

```tsx
import { SiteWikiLink, SiteWikiPage, SiteWikiProvider, SiteWikiTree } from '@standmeet/sdk';
<SiteWikiProvider>                 {/* optional: the parts share one read + one live stream */}
  <aside><SiteWikiTree /></aside>   {/* the page tree, current page marked */}
  <main><SiteWikiPage /></main>     {/* the page the address shows: view, edit, history, new */}
</SiteWikiProvider>
```

`<SiteWikiLink to="the-ledger">the ledger</SiteWikiLink>` links the page's own text to a wiki page
(by path or title), marked missing until someone writes it. `<SiteWiki tree={false} />` is the wiki
without its built-in tree. A save over a version someone else saved meanwhile asks first.

For deeper context (the current page, the owner, the active session), `import { useStandMeet } from
'@standmeet/sdk'` exposes the provider's context; most pages need only the widgets + the store above.

## Show corpus inline — do not just link out

The old default homepage's mistake: every corpus card was an `<a href="/wiki/…">` and the ask box
did `window.location = '/gate'`. Clicking anything left the page. Prefer **inline reveal**:

- Render `fetchCorpusCards()` as a list of title + excerpt. On click, expand the card **in place**
  to show more, rather than navigating away. (A "read the full note" link may still exist as a
  secondary affordance, but it is not the primary interaction.)
- Group/curate the cards yourself — a flat identical grid of every card is exactly the generic
  look to avoid. Lead with a few, in an order you chose.

## The chat rule (important)

A visitor with **no access code and no key can't chat inline** — that is by design (the corpus is
gated). For that visitor, an ask box hands off to the gate, carrying the question:
`window.location.href = '/gate?q=' + encodeURIComponent(q)` — the gate continues the answer once
they unlock. Only build an inline `useChatSession` chat when the page actually has a session
(a coded page, or a BYOAI-enabled page). Don't fake an inline chat that can't answer.

## Language and theme — never read the browser in the first render

Every page is prerendered at build time, so its first client render must produce the same HTML.
Reading `localStorage`, `navigator.language` or `matchMedia` inside `useState(() => …)` breaks that
for a visitor whose language or theme differs: React reports a hydration error (#418) for text,
and for an attribute (a `data-theme`) it keeps the server's value — a dark-mode visitor stays
light. Use the SDK's hooks, which render the default first and apply the visitor's choice right
after mount:

```tsx
import { usePageLang, usePageTheme } from '@standmeet/sdk';
const [lang, setLang] = usePageLang(['en', 'zh'] as const, 'en'); // setLang stores the choice
const theme = usePageTheme(); // 'light' | 'dark', follows the system until the visitor picks
```

Anything else that depends on the browser (a stored preference, the viewport, the time) goes in a
`useEffect`, never in the initial state.

## Make it not look AI-generated

Commit to one clear aesthetic and execute it precisely. Avoid the tells:

- No corporate-SaaS chrome: white cards on white, blue accents, evenly-rounded drop-shadow boxes.
- No AI palette: purple→blue gradients, neon-on-dark, gradient text on headings/metrics.
- No identical card grid repeated down the page; no glassmorphism; no icon-above-every-heading.
- Vary spacing to create rhythm (tight groupings, generous separation) — not the same pad
  everywhere. Left-aligned + asymmetric reads more designed than everything centered.
- Tint neutrals toward the accent hue; never pure `#000`/`#fff` (the tokens already do this).
- Motion, if any: transform/opacity only, ease-out, no bounce.

## Starter shape

```tsx
import React, { useEffect, useState } from 'react';
import { createClient, type CorpusCard } from '@standmeet/sdk-core';

const sm = createClient({ baseURL: '' });

export default function App() {
  const [cards, setCards] = useState<CorpusCard[]>([]);
  useEffect(() => { sm.fetchCorpusCards().then(setCards).catch(() => {}); }, []);
  const ask = (q: string) =>
    (window.location.href = q.trim() === '' ? '/gate' : `/gate?q=${encodeURIComponent(q.trim())}`);
  // …hero prose (font-serif) → an ask box → corpus cards revealed inline → where/contact.
}
```

## Then build and publish

`microsite.write_file` (path `App.tsx`) → `microsite.build` → poll `microsite.get_build` →
`microsite.promote_to_staging` (owner-only preview) → `microsite.promote_to_live`.
