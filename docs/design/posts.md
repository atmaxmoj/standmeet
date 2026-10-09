# Posts — a timeline of short updates, each with its own audience

> Status: **built** (2026-10-08) — `backend/internal/corpus/posts/`. One change from the first
> draft: posts are not put in the Meili index (see "Search" below). Owner's words: "和发微博一样 … 没有标题 … 能设置私密公开，或者某个
> role可见，和朋友圈一样". Supersedes the "journal" sketch from the same day (a private post is the journal).
> Tests: [posts-tests.md](posts-tests.md) — written first; the implementation starts from their red.

## What it is

A post is a short, untitled piece of text the owner publishes to a timeline — X / Weibo / WeChat
Moments. The owner may post ten times a day or once a month; the product makes no assumption about
frequency and has no notion of "a day". Each post decides **who can see it**:

| visibility | who sees it |
|---|---|
| `private` | the owner only (admin panel, the owner's own AI over MCP) |
| `public` | everyone: anonymous readers, every visitor, every role |
| `roles` | the owner + visitors whose session role is in the post's role list ("部分可见") |

It is a genre beside raw / wiki / output / subjectivity / writing: same verbs, its own data shape.
Both entrances exist from day one: the admin panel (GUI) and the owner's MCP.

## Data shape

Its own table — a post has none of a corpus note's structure (title, tree, path, slug, published,
show_as_source), and forcing it into `corpus_notes` would mean every one of those columns lying.

```
posts
  id                uuid PK
  owner_id          uuid
  body              text            -- markdown; no title; no length cap (the owner sets the style)
  visibility        text            -- 'private' | 'public' | 'roles'  (CHECK); default 'private'
  visible_role_ids  uuid[]          -- non-empty iff visibility = 'roles'  (CHECK)
  created_at        timestamptz     -- the post time; the timeline's order; not editable
  updated_at        timestamptz     -- shown as "edited" when ≠ created_at
  deleted_at        timestamptz     -- trash, 90 days, then the daily purge (like every asset)
```

- **Order** is `created_at DESC, id DESC`, paged with the shared cursor util. No day grouping.
- **Images** reuse the global asset pool: the body references `standmeet-asset:<id>` and the post
  becomes an `asset_references` referrer (kind `post`), so the pool's delete guard and the
  serve-URL signing already apply. No attachments of its own. A trashed post keeps its references
  until purge.
- **A role deleted later** is dropped from `visible_role_ids` (FK-free uuid[] → cleaned on role
  delete); a `roles` post whose list becomes empty falls back to `private`, never to `public`.

## Who reads what — the one rule

Visibility belongs to the **post**, not to the role. A role's `corpus_uris` globs do not grant posts
and cannot widen them; `post://` is not a glob a role can hold. One rule decides it, used by every
reader (admin is owner, so it sees all). It lives in SQL — `post_visible(visibility,
visible_role_ids, role_id)` in `schema.sql` — and every posts query takes the reader as
`(owner_view, role_id)`, so no query can serve a post without it:

```
canSee(post, viewer) =
  viewer.isOwner
  || post.visibility == 'public'
  || (post.visibility == 'roles' && viewer.roleID ∈ post.visible_role_ids)
```

The session's role reaches the corpus tools inside the scope they already carry
(`CorpusScope.RoleID`); the timeline API reads it off the visitor session's RoleSnapshot.

`viewer.roleID` comes from the visitor session's frozen RoleSnapshot (the code's assumed role); an
anonymous reader and a BYOAI visitor have no role, so they see public posts only. An invisible post
and a non-existent one answer identically — no existence leak.

Readers, all through that function:

1. **Owner** — admin section + MCP (`corpus.list/get/search/create/update/delete`, `genre: "post"`).
2. **Visitor AI** — the agent's corpus tools (`corpus_search` / `corpus_read`) return the posts the
   session can see, so the stand-in can answer "what has he been up to lately". Private posts never
   reach the visitor index at all — no post does (see "Search" below).
3. **Public timeline** — an SDK component `<Posts />` (+ `usePosts`). The default homepage (both the
   `/` fallback and the shipped `home` template) carries it under "lately", hidden until there is a
   post to show; the owner can place it on any microsite. The API behind it answers with what the caller's session can see
   (no session → public only). Same rule as chat: the feature lives in the SDK, surfaces embed it.

## Every outbound surface, and what it does with posts

Inventoried from the code on 2026-10-08 (not from docs). A post reaches a non-owner **only** through
the posts service's two reads — `Service.List(viewer, …)` / `Service.Get(viewer, id)`, called
`VisibleTo` below — and a gate (`check-posts-one-reader`, planted self-test, in `make lint`) refuses
any other package that imports the posts DAO, any query outside `db/queries/posts/` that names the
`posts` table, and any search document built for a post. Each surface below either calls those
reads or never sees posts at all; there is no third option.

| surface (who reaches it) | posts behaviour |
|---|---|
| `POST /api/v1/agent/turn` SSE, incl. raw `tool_completed` frames (session, IM, embed) | corpus tools return only `VisibleTo(session)`; the frames carry nothing else |
| `POST /api/v1/sessions/{id}/tools/{tool}` direct tool call, no LLM (any session) | same tools, same function — the direct route is not a side door |
| `/api/pub/v1/tools/*` API-key facade, `/mcp/visitor` (key / code) | `corpus_search/read/list/links` → `VisibleTo(key's role)` |
| SDK `BlockWidget` / `useBlockTool` public session | public posts only |
| SDK `<Posts />` / `usePosts` → new `GET /api/v1/posts` (anon or session) | `VisibleTo(caller)`; no session → public only |
| `<standmeet-chat>` embed (JWT → a code session) | as that code's role |
| IM bridge visitor chat (code) | as that code's role; text goes to Telegram/Discord, so only what that role may see |
| BYOAI (instruction + tool results go to a visitor-chosen endpoint) | public only — never more than an anonymous reader |
| profile facts, cross-conversation digest, page text, ghost policy | posts are **not** injected into any instruction context; they arrive only through tools |
| `summarize_conversation` / `/report/{id}` / PDF, `/live/{token}` | they replay the conversation, so they hold only what the session was already shown |
| `send_email`, `send_confirmation`, `ext_*`, `op_*` tools (LLM-chosen egress) | can only carry text the session could read; no posts-specific path |
| webhooks, notify rules (email / IM), events list | `post.*` events carry `id` + `visibility` only — never a body, whatever the visibility |
| `/sitemap.xml`, OG/SEO | nothing — a post has no URL of its own in v1 (see Decisions) |
| prerendered microsite HTML (what a crawler gets) | no post — `<Posts />` loads in the reader's browser as that reader; a built page holding posts would keep one after it went private |
| Meili visitor index | nothing — no post of any audience is indexed (see "Search") |
| `/assets/{id}` | an image referenced only by private posts is never servable on a bare id |
| owner `/mcp`, admin API (owner only) | everything |

The same inventory surfaced pre-existing leak candidates outside posts (writings by slug, closed
microsite page text, conversation ids on the tool route, …); they are tracked and verified by test
separately — posts must not be built on top of an open one.

## Decisions

- **No post URL in v1.** A post lives in a timeline (`<Posts />` on a microsite) and nowhere else —
  no `/posts/<id>` page, not in the sitemap, no per-post OG. One fewer surface to gate. Add a
  permalink when a post needs to be shared on its own.
- **Posts are citable.** When the visitor AI answers from a post, the citation shows the post's
  time and an excerpt — inline, no link (there is no URL). A citation is produced only from a read
  that `VisibleTo` allowed, so it can never name an invisible post.
- **What a visitor was shown stays in their own record.** Narrowing a post (public → private)
  takes effect on every *new* read; a conversation that already quoted it keeps its transcript,
  report and live replay as they were — those are that visitor's record of what they were told,
  the same rule as an edited wiki note today. No retroactive redaction.
- **A code cannot narrow posts.** Per-code corpus denials (`code_corpus_denials`) govern corpus
  globs; posts are governed by the post's own audience only. One control per thing — if a code
  should see less, the post's role list is where to say it.
- **Events never carry a body** (any visibility): the existing "thin events" rule, with no exception.
- **Default visibility `private`; `created_at` immutable; a session's role is the one frozen at
  session start; an invisible post answers exactly like a missing one.**

## Verbs

Same verbs as every genre, `genre: "post"`:

| op | args (post-specific) | danger |
|---|---|---|
| `corpus.create` | `body`, `visibility`, `visible_role_ids` | write |
| `corpus.update` | `id`, `body?`, `visibility?`, `visible_role_ids?` | write |
| `corpus.delete` | `id` → trash (90 days) | destructive |
| `corpus.list` | cursor, `visibility?`, `q?` | read |
| `corpus.get` / `corpus.search` | — | read |

Changing visibility is an update — narrowing a public post to `roles` or `private` takes effect on
the very next read.

Events: `post.created` / `post.updated` (an edit, a new audience, or a restore) / `post.deleted` on
the outbox (webhooks and notify rules can use them); payload `post_id` + `visibility`.

## Search

A visitor's `corpus_search` finds posts in Postgres (substring + `simple` full-text) through the
same reads as everything else, appended after the note hits — the way writings are searched. The
first draft put `public` / `roles` posts into Meili with `visibility` / `visible_role_ids` filter
fields; it was dropped while building, for three reasons:

- the index would hold a second copy of every roles post's text and audience, kept in step by an
  event subscriber — a second place that can disagree with the post;
- the note search's filter admits a `**` glob, so a post document in the shared index needs its own
  exclusion there; a missed one serves a roles post to every `**` role;
- a timeline is read newest-first, and a personal timeline is small: ranking and typo tolerance buy
  little that `ILIKE` + full-text does not.

So a change of audience needs no index write and shows on the next read. Add an index when posts
outgrow Postgres search; it then needs its own index and its own filter, never the notes'.

## Admin

A "posts" (动态) section in the corpus group: a composer at the top (text, an image from the pool,
and a visibility picker: 私密 / 公开 / 指定角色 with a multi-select of roles), the timeline below with
each post's visibility shown, edit / change visibility / delete inline, a filter by visibility and a
search box. 9 locales. Trashed posts appear in the existing trash section (a "posts" group) and in
`corpus.trash` / `corpus.restore` with `genre: "post"`.

The SDK `<Posts />` shows each post's time in the reader's timezone and the page's language
(`<html lang>`); it shows no visibility badge to visitors (a visitor only ever sees what it may).

## Out (until asked)

Likes / comments / reposts, hashtags, mentions, scheduling, drafts, per-person visibility
(the unit is the role), an RSS feed, Obsidian sync, promoting a post into raw / wiki.
