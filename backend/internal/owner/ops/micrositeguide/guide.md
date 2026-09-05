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
browser, or a nav by hand. `import { CorpusWidget, AgentWidget, GateWidget, PageNavWidget } from
'@standmeet/sdk'`:

- `<CorpusWidget heading? limit? />` — every published corpus entry as a card; clicking one opens
  the note **inline** (no navigation), with a quiet "read in full ↗" to the reader.
- `<AgentWidget placeholder? examples? />` — the agent. With no grant it hands the question to
  /gate; with a code it is the code's own agent inline (corpus scope, persona, quota, and the
  code's dock buttons all inherited — nothing to wire). Just drop it in.
- `<GateWidget label? sublabel? />` — the access CTA (enter a code / bring a key / request access).
- `<PageNavWidget exclude? heading? />` — links to the owner's other published pages.

## Lower-level pieces (only if a widget doesn't fit)

- `import React, { useState, useEffect } from 'react'`
- `import { createClient, type CorpusCard, type MicrositeLink } from '@standmeet/sdk-core'`
  - `const sm = createClient({ baseURL: '' })` (same origin — the instance serving this page).
  - `sm.fetchCorpusCards()` → published corpus cards; `sm.fetchWikiLanding(path)` → one note's body;
    `sm.fetchMicrosites()` → the owner's other published pages.
- `import { StandMeetProvider, useChatSession, AnswerText } from '@standmeet/sdk'`
  - `useChatSession(input)` → `{ messages, streaming, error, send(text) }` (what AgentWidget uses).
  - `<AnswerText text={…} />` renders an answer with StandMeet's paragraph/citation formatting.

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
