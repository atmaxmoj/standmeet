# Posts — test design

> Companion to [posts.md](posts.md). Written before any code (2026-10-08); every spec here must be
> **red on the main it is written against** and go green only with the implementation. Black box:
> each assertion is on what a reader actually receives — an HTTP body, an SSE frame, a delivered
> webhook, a rendered page — never on a table row or a UI element's absence.

## Decisions these tests pin

- **Default visibility is `private`.** A post created without one is private — a forgotten
  argument must never publish.
- **`created_at` is immutable.** Update cannot move a post in the timeline.
- **A trashed post keeps its asset references until it is purged**, so restoring it never comes
  back with a broken image (and the pool's delete guard still protects that image meanwhile).
- **Events and webhooks carry `id` + `visibility`, never the body of a non-public post.** A webhook
  endpoint or a notify rule is owner-configured, but it is outside the instance; a private post's
  text does not leave the instance by side channel. Consumers read the body through the API.
- **A visitor session's role is the one frozen at session start** (RoleSnapshot). Moving a code to
  another role affects new sessions only — the same rule as corpus scope today.
- **An invisible post and a non-existent one answer identically** — same status, same message.

## Method

Every privacy test plants a **unique marker** per post and checks "not leaked" by searching the
whole response for that marker. The visibility tests are **one matrix** generated from a table
(posts × readers × read paths), so a reader or read path added later is one row, not a forgotten
spec.

## A. The visibility matrix — `posts-visibility.spec.ts`

Seed four posts, each with its own marker: `private`, `public`, `roles=[hiring]`,
`roles=[hiring, invited]`.

Readers (rows) — one per outbound surface in [posts.md § Every outbound surface](posts.md):

| reader | private | public | roles=[hiring] | roles=[hiring,invited] |
|---|---|---|---|---|
| owner (admin API, owner MCP) | ✓ | ✓ | ✓ | ✓ |
| anonymous (`GET /api/v1/posts`, `<Posts />`) | ✗ | ✓ | ✗ | ✗ |
| public-tier session (no code) | ✗ | ✓ | ✗ | ✗ |
| BYOAI session | ✗ | ✓ | ✗ | ✗ |
| code session, role `hiring` | ✗ | ✓ | ✓ | ✓ |
| code session, role `invited` | ✗ | ✓ | ✗ | ✓ |
| code session, a role with corpus `**` | ✗ | ✓ | ✗ | ✗ |
| API-key facade `/api/pub/v1` (key on role `hiring`) | ✗ | ✓ | ✓ | ✓ |
| visitor MCP `/mcp/visitor` (code on `invited`) | ✗ | ✓ | ✗ | ✓ |
| SDK `BlockWidget` public session | ✗ | ✓ | ✗ | ✗ |
| embed `<standmeet-chat>` (JWT on a `hiring` code) | ✗ | ✓ | ✓ | ✓ |

Read paths (columns of the second axis) — each row is checked through **every** path it can reach:

1. the timeline API `GET /api/v1/posts` (paged to the end);
2. the agent turn: a scripted turn that calls `corpus_search` for the marker, then `corpus_read` —
   the SSE stream (answer **and** the `tool_completed` frames) is searched for the marker;
3. the direct tool route `POST /api/v1/sessions/{id}/tools/{corpus_search|corpus_read|corpus_list}`
   (no LLM — the side door must enforce the same rule);
4. `corpus_read` **by id and by URI** of each post: an invisible post answers exactly like a
   random uuid (status + body compared);
5. the nav tools `corpus_map / resolve / peek / grep / links`.

## B. Places text leaves without a reader asking — `posts-no-side-channel.spec.ts`

A private post's marker must appear in **none** of these (each grepped):

- the Meili visitor index (query the index for the marker → no hit; public / roles posts are hits);
- a public-tier chat on the home page, and its citations;
- the instruction context of a visitor turn (profile facts, cross-conversation digest, page text,
  ghost context) — read via the turn diagnostics;
- the conversation summary report (`summarize_conversation`, `/report/{id}`, its PDF) and the live
  transcript `/live/{token}`;
- webhook deliveries and notify-rule messages for `post.created` / `post.updated` / `post.deleted`
  (the webhook mock receiver, the Discord mock): `id` + `visibility` present, body absent — for a
  `public` post the body may be absent too, but never the other way round;
- `events.list`, page HTML / OG / SEO tags, `/sitemap.xml`;
- an IM-bridge visitor chat on a code;
- a BYOAI turn's request to the visitor-chosen endpoint (the BYOAI mock records the request body):
  only public-post markers may appear.

A `public` post's marker, by contrast, **does** appear in the anonymous timeline HTML a crawler
sees (the positive control: if this fails, the leak checks above prove nothing).

## C. Lifecycle — `posts-lifecycle.spec.ts`

- create → newest first; a tie on `created_at` ordered by id; `created_at` unchanged by update;
  `updated_at` moves and the timeline shows "edited".
- **narrow** public → private: gone from the anonymous timeline, search and `corpus_read` on the
  next read (wait on the index receipt, not a sleep); **widen** private → public: appears.
- roles → another role list: the old role's session loses it, the new one gains it.
- delete → gone from every reader in A and out of the index; the trash lists it; restore → back with
  the same visibility and timeline position; purge after 90 days (clock wound back) → `not in the
  trash`.
- delete a role a `roles` post names → the id leaves the list; delete its last role → the post reads
  as private for everyone but the owner (never public).
- restore a `roles` post whose role was deleted while it was in the trash → private.
- a code revoked mid-session → that session sees nothing more on its next read.

## D. Input that must be refused — `posts-validation.spec.ts`

Unknown visibility; `roles` with an empty list; a role id that does not exist or belongs to another
owner; `visible_role_ids` given with `public` / `private`; empty or whitespace-only body; an update
trying to set `created_at`. Each refused with a readable message, and **nothing written** (list
count unchanged before / after). Omitted visibility → private (read it back as a non-owner: absent).

## E. Images — `posts-assets.spec.ts`

- an image in a public post is served to an anonymous reader;
- an image referenced **only** by a private post is not servable anonymously — neither by its bare
  `/assets/{id}` nor by a URL lifted from the owner's view after the signature expires;
- the pool refuses to delete an image a post references, naming the post;
- a trashed post keeps the reference (pool delete still refused); purge frees it.

## F. Rendering safety — `posts-render.spec.ts`

A body with `<script>`, an `onerror` image and a `javascript:` link renders inert in `<Posts />`
(no script runs — a `window` flag the payload would set stays unset; the link is not clickable as
`javascript:`); markdown and KaTeX render as in the other genres.

## G. Paging — `posts-paging.spec.ts`

250 posts mixed across visibilities: an anonymous reader paging with the cursor gets every public
post exactly once, in order, with no empty page caused by hidden posts, and a `total` that counts
only what it can see (a private-post count is itself a leak). A post created between two page
fetches neither duplicates nor skips one.

## H. Key scopes — `posts-key-scopes.spec.ts`

An owner MCP key with only `read` lists and gets posts but cannot create or update; delete needs
`destructive` — the R7 danger classes hold for the new verbs (`genre: "post"`).

## I. Admin UI — `admin-posts.spec.ts`

Compose with each visibility (the role multi-select appears only when `roles` is picked), attach a
pool image, see the post on top of the timeline with its visibility badge, change visibility
inline, filter by visibility, search, delete → it shows in the trash section → restore. Empty and
error states come from `ListPane`. Copy present in 9 locales (i18n key gate).

## J. SDK / microsite — `posts-in-microsite.spec.ts`

A microsite with `<Posts />`: anonymous sees the public timeline; opened with a `hiring` code it
also shows the hiring posts; the home microsite with `<Posts />` the same. The component renders on
a page without Tailwind (embed rule: computed style, not class names). The prerendered HTML (what a
crawler gets) holds public posts only.

## K. The one-reader gate — `check-posts-one-reader` self-test

The gate refuses any package other than the posts usecase reading the `posts` table or repo. Its
self-test plants (1) a query on `posts` in another domain, (2) an import of the posts repo from a
route → both red; clean tree → green. Proved red on a tree with a planted violation before the
gate is wired into `make lint`.

## L. Upgrade — `upgrade-posts.spec.ts`

Old volume → deploy: the table and the asset referrer kind arrive through the real migration;
existing corpus, assets and references are untouched; the boot index rebuild indexes public / roles
posts and no private one. (Rollback also forgets every later migration touching the same tables —
memory: upgrade-spec-rollback-must-include-later-migrations.)

## M. Real model — a question added to `make eval-speed` (read every answer)

On a real instance with a real model: a `hiring` visitor asks "what has he been up to lately?" —
the answer draws on public and hiring posts and never says a private marker; asked directly about
the private post's topic, it does not reveal it. The privacy canary, with the model in the loop.
