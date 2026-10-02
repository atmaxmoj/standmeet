# SiteWiki — a microsite that reads like a wiki, stored in the microsite

Status: DESIGN (2026-10-02). Owner request: "make the site look like a wiki, but the storage is just
each microsite's db; the SDK is there so it is easy to use."

## What it is

`SiteWiki` is a part of `@standmeet/sdk`. A microsite author writes:

```tsx
import { SiteWiki } from '@standmeet/sdk';
export default function App() { return <SiteWiki />; }
```

and the page is a wiki: a tree of pages, each page rendered like the instance's own `/wiki` reader
(markdown, `[[links]]`, backlinks, math, mermaid, TikZ), with an editor for visitors the page lets
write. The pages live in the microsite's own store (one schema per page, dropped with it). They are
not corpus notes: the owner's corpus, its ACL and its index are not involved.

`useSiteWiki()` is the same data without the UI, for a page that draws its own.

## Names

- `SiteWiki` / `useSiteWiki` — the family of `useMicrositeStore` and `AgentWidget`. "Site" says
  where the data lives (this microsite), "Wiki" says how it reads.
- CSS classes `smw-*` in the SDK's stylesheet. No styles in TSX.

## Data: one document per page version

A page version is one document in the store collection `wiki` (the prop `collection` changes it):

```json
{ "path": "people/the-master", "title": "The master", "body": "markdown …" }
```

- `path` is the page's identity and its place in the tree (`/` separates levels).
- The store lets a visitor insert, not update. So an edit inserts a new version; the newest
  `_created_at` per `path` is the page. History comes for free, and two writers never overwrite
  each other's text: the later version wins, the earlier one stays in the history.
- Removing a page is a version `{ "path": …, "removed": true }`. The owner can delete documents
  for real from /admin/data.
- The host keys apply as everywhere: `_author` (who wrote the version), `_status` (review), `_id`.
- Owner policy applies unchanged: review on → a new version waits; the document limit counts
  versions. The guide says so, and says to raise the limit for a busy wiki.

## Reading

- The tree: every live path, grouped by `/`. A path whose parent has no page still shows the
  parent as a folder.
- `[[target]]` and `[[target|label]]` resolve by path first, then by title (case-insensitive). A
  target with no page renders as a "missing" link; following it opens the editor for that path.
- Backlinks: the pages whose newest version links to this one.
- Navigation is the URL hash (`#/people/the-master`): a microsite is static files, a reload or a
  shared link lands on the same page, and the host's own routes are untouched.
- Rendering is `ChatMarkdown` with the corpus plugins plus one SiteWiki remark plugin that turns
  `[[…]]` into hash links. One renderer, so a SiteWiki page and a /wiki note look alike.
- Live: `useMicrositeStore` already refetches on every change, so another writer's edit appears.

## Writing

- The editor is a plain markdown textarea with a preview tab, a title field and a path field
  (new page). Save inserts a version. A refusal (closed, full, invalid) shows the store's message.
- Shown only when the page's store is writable for this visitor.

## The agent

The `microsite.store` block reads a page's store already. In this slice the agent reads the wiki
(`store_read` / `store_search` on collection `wiki`). Writing wiki pages through the agent needs
`store_append` to take a page (path, title, body) instead of a passage; that is the next slice.

## Not in this slice

- Editing conflicts beyond "newest wins" (no merge, no lock).
- Attachments and images inside pages (the store holds JSON only).
- Per-page access rules: the whole microsite has one rule.

## Acceptance (e2e first, red before the code)

`e2e/test/site-wiki.spec.ts`, a microsite whose App is `<SiteWiki />`, two visitors:

1. An empty wiki says so and offers to write the first page.
2. A visitor creates `ledger` with a `[[the-master]]` link: the link shows as missing.
3. Following the missing link opens the editor at that path; saving creates the page; the link on
   `ledger` is no longer missing, and `the-master` lists `ledger` as a backlink.
4. The tree shows `people/` as a folder for `people/the-master`.
5. Editing `ledger` shows the new text; the history lists both versions with their authors.
6. The other visitor's open page shows the edit without a reload.
7. A reload on `#/ledger` lands on that page.
8. Review on: a new version waits; the page still shows the approved one.
