# Homepage as a fixed-path custom page (proposal)

Status: **proposal / seed** — a direction, not a decision. Raised 2026-09-02 by the owner:
"the homepage isn't quite right — it has a lot of odd stuff, but it's really just a custom
page with a fixed path."

## The observation

The public homepage (`/`) is served by a **bespoke content system** that exists only for that
one page, while the microsite system (`/p/<slug>`: author React with the SDK → sandbox
build → serve) already does the general case. The homepage is conceptually **one custom page
pinned to the fixed path `/`** — but it's built as a special case instead.

## What the bespoke machinery is

`entity.PageContent` (the "weird stuff"):

| field | what it is | who reads it |
|---|---|---|
| `hero_prose`, `hero_examples` | the hero block | display only (`Hero.tsx`) |
| `insights`, `projects` | **pin lists** over the corpus (wiki UUIDs) — a window onto pinned *published* entries, joined to title+excerpt at render | display (`Insights`/`Projects`), **plus a real invariant — see below** |
| `where` (status, closing, `looking_for`) | the "where I am" section | display only (`Where.tsx`) |
| `contact` (email, chat_line, `recruiter_prose`, `casual_prose`) | recruiter- vs casual-facing contact copy | display only (`Contact.tsx`) |

Plus: the `page.*` admin section (`PageSection` + bespoke editors), `GET /api/v1/page`, the
`page.put` / pin / unpin ops.

## The finding that unblocks it

**Grepped every consumer:** `looking_for` and `recruiter_prose` are read *only* to display
and to edit — **nothing else consumes them.** In particular the **job-loop does not read
`page.where.looking_for`** today (CLAUDE.md says it will, but that path is unimplemented). So
these structured fields are, right now, structured storage for **pure display content with
zero downstream consumer** — which is exactly why they read as "odd" sitting on the homepage.

So there is **no hard data dependency** stopping the homepage from becoming a freeform custom
page. If it were one, `recruiter_prose` / `casual_prose` / the hero / the "where" copy would
just be **prose the owner authors in that page**, not schema fields.

## What the move deletes

Turning the homepage into a custom page at `/` removes: the `PageContent` model, the
`PageSection` bespoke editors, the recruiter/casual prose fields, `GET /api/v1/page`'s
content half, and most of the pin plumbing — folding them into the one system that already
serves `/p/<slug>` (which the four live theme pages already prove can fetch + render curated
corpus views: `sijie.xyz/p/semiotics-lines`, `/cognitive-effects`, `/philosophy-theses`,
`/linguistics`).

## Two things that must NOT be flattened away

1. **The pin-list invariant.** `insights` / `projects` aren't prose — they're pins with a
   maintained invariant: `pinned ⊆ published`, and **unpublishing a note auto-unpins it**
   (page-corpus-pinning-design). A custom page can *fetch and render* corpus entries (the
   theme pages do), but it can't *maintain that invariant*. Decision: either drop pinning
   (the owner links what they want, and a dead link is their problem) or keep a small
   pin-helper the custom page can call. Dropping it is simpler and consistent with the theme
   pages; keeping it preserves the "never show an unpublished pin" guarantee.

2. **`looking_for` if the job-loop is to consume it.** The moment the job-loop reads
   `looking_for` to rank jobs (the CLAUDE.md intent), it becomes a **structured owner-fact
   with a real consumer** — and it must then live where that consumer reads it (**job-loop /
   owner config**), not as freeform page prose. This is the [[facts live where produced]]
   rule: the fact belongs to the side that owns it, and the homepage merely *displays* it (or
   doesn't). So the clean split is: **structured owner-facts → job-loop config; presentation
   → the homepage custom page.** Recruiter rules then vanish from the homepage — half becomes
   authored prose, half moves to the job-loop.

## Rough migration path (if pursued)

1. Land the "fixed-path custom page" capability: a custom page may claim `/` (one per
   instance), served by the same pipeline as `/p/<slug>` with the base at `/`.
2. Move `looking_for` (and any other structured owner-fact the job-loop will read) into a
   small owner/job-loop config surface; leave `recruiter_prose` etc. behind.
3. Ship a default homepage custom page (authored with the SDK) reproducing today's look, so
   a fresh instance still has a homepage out of the box.
4. Decide the pin question (drop vs helper); migrate any existing owner's homepage content
   into the default page's source.
5. Retire `PageContent` / `PageSection` / `GET /api/v1/page`'s content half.

## Open questions

- One-per-instance fixed-path page, or could the owner pick which page is the homepage?
- Pin invariant: drop, or expose a keyless "published corpus cards" helper the custom page
  calls (so the invariant lives in the backend, not in hand-rolled fetch)?
- The default homepage: shipped as a starter template the owner can then edit, or generated?
