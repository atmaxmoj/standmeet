# Posts — test design

> Companion to [posts.md](posts.md) (its § Decisions are what these tests pin). Written before any
> code (2026-10-08). Black box: each assertion is on what a reader actually receives — an HTTP
> body, an SSE frame, a delivered webhook, a rendered page — never on a table row.

## Method — three rules, because a privacy test fails silently

1. **Red for the right reason, not just red.** Before the feature exists every spec is red with a
   404, which proves nothing about the rules. So "red on main" is only the first gate; the real
   proof is the **mutation check** below, run once the feature is green: each planted bug must turn
   the named spec red. A privacy spec that survives a broken rule is not a test.
2. **Every absence has its own presence.** "The private marker is not in X" also passes when X never
   fired. Each place that is checked for absence is checked, in the same run, for the presence of
   something that proves it ran: the public marker in the same reply / index / page, or the event
   for the private post in the same webhook delivery log (with its id, without its body).
3. **One matrix, not many specs.** Posts × readers × read paths are generated from tables, so a
   reader or read path added later is one row. Every ✓ cell is the positive control of the ✗
   cells in its row: the same reader reaching the public marker through the same path proves the
   path works.

Markers: each post's body carries a unique token (`PRIV_<rand>`, `PUB_<rand>`, `HIR_<rand>`,
`HIRINV_<rand>`); a response "contains" a post iff it contains its token. Responses are searched
whole (answer text, `tool_completed` frames, JSON, HTML, mail bodies, IM messages, request bodies a
mock recorded).

## Mutation check — `make posts-mutation-check` (after green, before merge)

Each mutation is applied to a scratch copy of the tree, the named specs run, and the result is
recorded in the merge commit. The table lives as data in `infra/scripts/posts-mutations.tsv`; a row
whose substitution matches nothing fails, and a red counts only when an assertion made it. Every row must turn its spec red; a row that stays green means that
spec is decoration and is rewritten.

The rows live in `infra/scripts/posts-mutations.tsv`, each pointed at the line it breaks.

| planted bug | must turn red |
|---|---|
| the visibility rule (`post_visible`) returns true | A (every ✗ cell), G |
| the rule reads `roles` as public | A (invited / `**` rows) |
| the rule reads `roles` as private | A (hiring rows' ✓ cells) |
| the corpus tools read posts as the owner | A (paths 2–5) |
| an event payload carries the body | B (webhooks / notify) |
| an invisible id answers "denied" instead of "missing" | A (path 4) |
| default visibility `public` | D (omitted visibility) |
| `total` counts all posts | G |
| update may change `created_at` | C |
| the gate's pattern list emptied | K (self-test) |

Two rows of the first draft have no code left to break: "private posts are indexed" (no post is
indexed — B's index row is an absence with its presence, guarded by K's rule 3) and "`tool_completed`
frames carry the post body" (a frame carries only what the reader may read; the row above that reads
as the owner is the bug that would leak through it).

## A. The visibility matrix — `posts-visibility.spec.ts`

Seed four posts: `private`, `public`, `roles=[hiring]`, `roles=[hiring, invited]`.

| reader | private | public | roles=[hiring] | roles=[hiring,invited] |
|---|---|---|---|---|
| owner (admin API, owner MCP) | ✓ | ✓ | ✓ | ✓ |
| anonymous (`GET /api/v1/posts`, `<Posts />`) | ✗ | ✓ | ✗ | ✗ |
| public-tier session (no code) | ✗ | ✓ | ✗ | ✗ |
| BYOAI session | ✗ | ✓ | ✗ | ✗ |
| code session, role `hiring` | ✗ | ✓ | ✓ | ✓ |
| code session, role `invited` | ✗ | ✓ | ✗ | ✓ |
| code session, a role with corpus `**` | ✗ | ✓ | ✗ | ✗ |
| code session, role `hiring`, code denies `**` (posts ignore code denials) | ✗ | ✓ | ✓ | ✓ |
| API-key facade `/api/pub/v1` (key on role `hiring`) | ✗ | ✓ | ✓ | ✓ |
| visitor MCP `/mcp/visitor` (code on `invited`) | ✗ | ✓ | ✗ | ✓ |
| SDK `BlockWidget` public session | ✗ | ✓ | ✗ | ✗ |
| embed `<standmeet-chat>` (JWT on a `hiring` code) | ✗ | ✓ | ✓ | ✓ |

Read paths — each row through every path it can reach:

1. the timeline API `GET /api/v1/posts`, paged to the end;
2. the agent turn: a scripted turn calling `corpus_search` for each marker then `corpus_read` — the
   whole SSE stream (answer **and** `tool_completed` frames) is searched;
3. the direct tool route `POST /api/v1/sessions/{id}/tools/{corpus_search|corpus_read|corpus_list}`
   (no LLM — the side door enforces the same rule);
4. `corpus_read` by id and by URI: an invisible post's response is **byte-identical** to a random
   uuid's (status + body);
5. the nav tools `corpus_map / resolve / peek / grep / links`;
6. citations: a turn that reads a visible post produces a citation with its time + excerpt and no
   link; no citation ever names an invisible post.

## B. Places text leaves without a reader asking — `posts-no-side-channel.spec.ts`

Each row: the private marker absent **and** the row's own presence check holding in the same run.

| channel | absent | presence check (same run) |
|---|---|---|
| Meili index, every document (queried directly) | every post marker | a note written after the posts is there |
| public-tier chat on the home page + its citations | `PRIV_`, `HIR_` | `PUB_` cited |
| a visitor turn's instruction (profile facts, cross-conversation digest, page text, ghost context; turn diagnostics) | every marker | the diagnostics carry the turn's own page text |
| `summarize_conversation` report, `/report/{id}` + PDF, `/live/{token}` | `PRIV_` | the marker the conversation actually read is there |
| webhook deliveries (mock receiver) for `post.created/updated/deleted` | every marker (no body at all) | a delivery exists for each post's id with its `visibility` |
| notify-rule messages (Discord mock, owner email) | every marker | a message exists for the event |
| `events.list` | every marker | the events exist |
| microsite prerendered HTML / OG / `/sitemap.xml` | every post marker (the timeline loads in the browser, as the reader) | the page's own text is prerendered; the sitemap lists pages |
| IM-bridge visitor chat on a `hiring` code | `PRIV_` | `HIR_` in the answer |
| BYOAI: the request the visitor-chosen endpoint received (BYOAI mock records it) | `PRIV_`, `HIR_` | `PUB_` in it |

## C. Lifecycle — `posts-lifecycle.spec.ts`

- create → newest first; a tie on `created_at` ordered by id; update leaves `created_at` alone and
  the timeline shows "edited".
- **narrow** public → private: gone from the anonymous timeline, search and `corpus_read` on the
  very next read (search reads Postgres; there is nothing to wait on); **widen** private → public:
  appears everywhere it should.
- **narrowing is not retroactive**: a hiring visitor's conversation that quoted a roles post keeps
  that answer in its history, report and live replay after the post goes private; a new
  `corpus_read` in that same conversation is refused.
- roles → another role list: the old role's session loses it, the new one gains it.
- delete → gone from every reader in A; it shows in `corpus.trash` (genre `post`) and the admin
  trash; restore → back with the same visibility and timeline position; purge after 90 days (clock
  wound back) → `not in the trash`.
- delete a role a `roles` post names → the id leaves the list; delete its last role → private for
  everyone but the owner (never public); restoring a `roles` post whose role was deleted meanwhile
  → private.
- a code revoked mid-session → that session sees nothing more on its next read.

## D. Input that must be refused — `posts-validation.spec.ts`

Unknown visibility; `roles` with an empty list; a role id that does not exist or belongs to another
owner; `visible_role_ids` with `public` / `private`; empty or whitespace-only body; an update setting
`created_at`. Each refused with a readable message and **nothing written** (count before = after).
Omitted visibility → private (read back as a non-owner: absent; as the owner: `private`).

## E. Images — `posts-assets.spec.ts`

- an image in a public post is served to an anonymous reader (presence);
- an image referenced **only** by a private post is not servable anonymously — neither by bare
  `/assets/{id}` nor by a URL taken from the owner's view after its signature expires;
- the pool refuses to delete an image a post references, naming the post;
- a trashed post keeps the reference (pool delete still refused); purge frees it.

## F. Rendering safety — `posts-render.spec.ts`

A body with `<script>`, an `onerror` image and a `javascript:` link is inert in `<Posts />`, in the
admin timeline, and in a visitor answer that quotes it (a `window` flag the payload would set stays
unset; the link is not a `javascript:` link). Markdown and KaTeX render as in the other genres
(presence: a heading and a formula render).

## G. Paging — `posts-paging.spec.ts`

250 posts mixed across visibilities: an anonymous reader paging with the cursor gets every public
post exactly once, in order, no empty page caused by hidden posts, and a `total` counting only what
it can see. A post created between two page fetches neither duplicates nor skips one.

## H. Key scopes — `posts-key-scopes.spec.ts`

An owner MCP key with only `read` lists and gets posts but cannot create or update; delete needs
`destructive` (the R7 danger classes, `genre: "post"`).

## I. Admin UI — `admin-posts.spec.ts`

Compose with each visibility (the role multi-select appears only for `roles`), attach a pool image,
see the post on top with its visibility badge, change visibility inline, filter by visibility,
search, delete → the trash section's "posts" group → restore. Empty and error states from
`ListPane`; copy in 9 locales (i18n key gate).

## J. SDK / microsite — `posts-in-microsite.spec.ts`

A microsite with `<Posts />`: anonymous sees the public timeline; opened with a `hiring` code it also
shows the hiring posts; the home microsite the same. No visibility badge shown to a visitor. Times in
the reader's timezone (browser context with a fixed `timezoneId`), copy in the page's `<html lang>`.
The component renders on a page without Tailwind (computed style, not class names). An empty
timeline shows the empty state, not a blank box.

## K. The one-reader gate — `check-posts-one-reader` + self-test

The gate refuses, outside the posts package: a Go import of the posts repo; an sqlc query file
naming the `posts` table; a Meili document write for posts. Self-test plants each of the three →
red; clean tree → green.

## L. Upgrade — `upgrade-posts.spec.ts`

Old volume → deploy: the table and the asset referrer kind arrive through the real migration;
existing corpus, assets, references and trash are untouched; posts written before a deploy are read
after it by their own audience only, and the boot index rebuild indexes none of them. The rollback
forgets every later migration touching the same tables.

## M. Real model — two questions added to `make eval-speed` (read every answer)

On a real instance, a `hiring` code, the four marker posts written as plausible updates on four
different topics. (1) "What has he been up to lately?" (2) A direct question about the private
post's topic. Three runs each. Pass: no answer in any run names the private topic's marker or its
content; at least one answer in (1) draws on a public or hiring post (presence). Every answer is
read, not just scored.
