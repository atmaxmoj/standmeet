# Posts — a timeline of short updates, each with its own audience

> Status: **design, not built** (2026-10-08). Owner's words: "和发微博一样 … 没有标题 … 能设置私密公开，或者某个
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
and cannot widen them; `post://` is not a glob a role can hold. One function decides it, used by
every reader (admin is owner, so it sees all):

```
canSee(post, viewer) =
  viewer.isOwner
  || post.visibility == 'public'
  || (post.visibility == 'roles' && viewer.roleID ∈ post.visible_role_ids)
```

`viewer.roleID` comes from the visitor session's frozen RoleSnapshot (the code's assumed role); an
anonymous reader and a BYOAI visitor have no role, so they see public posts only. An invisible post
and a non-existent one answer identically — no existence leak.

Readers, all through that function:

1. **Owner** — admin section + MCP (`corpus.list/get/search/create/update/delete`, `genre: "post"`).
2. **Visitor AI** — the agent's corpus tools (`corpus_search` / `corpus_read`) return the posts the
   session can see, so the stand-in can answer "what has he been up to lately". Private posts never
   reach the visitor index at all (only `public` / `roles` posts are indexed, each carrying
   `visibility` + `visible_role_ids` as Meili filter fields — the ACL-before-limit filter from
   09454b1b9 extends to them).
3. **Public timeline** — an SDK component `<Posts />` (+ `usePosts`); the owner places it on the home
   microsite or any microsite. The API behind it answers with what the caller's session can see
   (no session → public only). Same rule as chat: the feature lives in the SDK, surfaces embed it.

## Every outbound surface, and what it does with posts

Inventoried from the code on 2026-10-08 (not from docs). A post reaches a non-owner **only** through
one read function — `posts.VisibleTo(viewer)` / `posts.GetVisible(viewer, id)` — and a gate
(`check-posts-one-reader`, planted self-test, in `make lint`) refuses any other package that reads
the `posts` table or the posts repo. Each surface below either calls that function or never sees
posts at all; there is no third option.

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
| webhooks, notify rules (email / IM), events list | `post.*` events carry `id` + `visibility` only, never the body of a non-public post |
| `/sitemap.xml`, OG/SEO, prerendered microsite HTML | public posts only (a microsite's prerender runs anonymous) |
| Meili visitor index | public + roles posts only, with `visibility` / `visible_role_ids` filter fields; private never indexed |
| `/assets/{id}` | an image referenced only by private posts is never servable on a bare id |
| owner `/mcp`, admin API (owner only) | everything |

The same inventory surfaced pre-existing leak candidates outside posts (writings by slug, closed
microsite page text, conversation ids on the tool route, …); they are tracked and verified by test
separately — posts must not be built on top of an open one.

## Verbs

Same verbs as every genre, `genre: "post"`:

| op | args (post-specific) | danger |
|---|---|---|
| `corpus.create` | `body`, `visibility`, `visible_role_ids` | write |
| `corpus.update` | `id`, `body?`, `visibility?`, `visible_role_ids?` | write |
| `corpus.delete` | `id` → trash (90 days) | destructive |
| `corpus.list` | cursor, `visibility?`, `q?` | read |
| `corpus.get` / `corpus.search` | — | read |

Changing visibility is an update — narrowing a public post to `roles` or `private` takes effect for
the next read (and the index entry is rewritten / removed by the same event that indexes it).

Events: `post.created` / `post.updated` / `post.deleted` on the outbox (index subscriber, webhooks,
notify rules can use them); payload `id` + `visibility`.

## Admin

A "posts" (动态) section in the corpus group: a composer at the top (text, an image from the pool,
and a visibility picker: 私密 / 公开 / 指定角色 with a multi-select of roles), the timeline below with
each post's visibility shown, edit / change visibility / delete inline, a filter by visibility and a
search box. 9 locales. Trashed posts appear in the existing trash section.

## Out (until asked)

Likes / comments / reposts, hashtags, mentions, scheduling, drafts, per-person visibility
(the unit is the role), an RSS feed, Obsidian sync, promoting a post into raw / wiki.
