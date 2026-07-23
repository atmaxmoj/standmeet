# Page ↔ Corpus Pinning

Status: **decided** (owner-approved 2026-07-23; supersedes the hand-maintained page content
model for insights/projects). Not yet implemented — this doc is the implementation source.

## Problem

The public page's four sections (insights / projects / where / contact) are a config store
**parallel to the corpus**, filled by hand in `/admin/page` (or via MCP `page.put`). This
violates the product's own thesis — "you don't write; your AI curates your corpus" — and
guarantees drift: the corpus (the vault) holds the owner's actual current thinking, while the
page holds a second, stale copy. Discovered live on the real instance: an owner who has been
curating a 200+-entry vault for months still shows `THINGS I'VE BEEN THINKING ABOUT · 00`.

## Decision: thoughts live in the corpus; facts live in config; the page stores pointers

| Section | Model |
|---|---|
| insights ("things I've been thinking about") | **pin list** — ordered corpus URIs; page renders each pinned entry's `title` + `excerpt`, linking into `/wiki/…` |
| projects ("what I'm building") | **pin list** — same mechanism, same store, different section key |
| where ("where I am") | stays structured config (facts: location, status, `looking_for` — the job-loop ranking input) |
| contact ("how to talk to me") | stays structured config (email, chat/recruiter/casual lines) |

A thought is never stored twice: the page cannot hold prose that duplicates a corpus entry —
structurally impossible, because the pinned sections have no content fields, only refs + order.
Content edits happen in the vault (or via owner MCP) and the page follows automatically; the
Obsidian sync therefore *does* feed these lists, closing the corpus↔page gap.

Curation stays human: nothing is auto-promoted to the homepage (the observer/auto-distill
lesson). Pinning is one owner utterance in the thinking-out-loud flow:
"promote this to wiki, and pin it to my homepage" → `promote_to_wiki` + `page.pin`.

## Invariant: pinned ⊆ published — maintained at BOTH write ends

The homepage is the fully-public surface, so a pin may only reference public content.

- `page.pin(section, uri)` — **rejects** an unpublished entry ("publish it first"). Write-time
  rejection, same philosophy as sibling-slug uniqueness: the violation cannot be created.
- `unpublish(x)` where x is pinned — **succeeds, auto-unpins, and says so in the tool result**
  ("unpublished; also removed from homepage insights"). The operator is the owner's AI, so a
  side effect declared in the tool result is surfaced in conversation. Rejecting instead would
  add a mandatory two-step to the thinking flow — not worth it.
- Render-time `published` filtering stays as defense in depth, never the primary mechanism.

Both operations route through one usecase-layer maintainer of the invariant (no second code
path may mutate pins or published without it — the F-A-18 `roleUpdatePayload` pattern).

## Empty state

An empty section renders **nothing — header included**. An unconfigured instance's homepage is:
name + chat input + example questions. (Follows the F-A-21 sweep: no owner-facing placeholder,
no dangling labels, no `00` skeleton scaffolding.)

## Surface changes

- **Schema**: page insights/projects columns change from content arrays to ref arrays
  `[{uri, order}]`. Old content is dropped (real instances are empty; the prototype content in
  `docs/design/project/page-content.js` is design reference, not data).
- **Backend**: pin/unpin + publish/unpublish routed through the single invariant-maintaining
  usecase; page GET joins pinned refs → `{uri, title, excerpt}` (scope-filtered as backstop).
- **MCP (ownercore)**: `page.pin` / `page.unpin`; `page.put` keeps where/contact + hero but no
  longer accepts insights/projects content.
- **Admin UI**: `/admin/page` insights/projects editors become pin managers (pick from
  published entries, reorder), not text forms.
- **Public page**: insight/project cards render `excerpt` + link into the reader; empty
  sections fully hidden.

## Open points (decide at implementation, small)

- Per-pin one-line display override (e.g. a sharper thesis line than the entry's excerpt)?
  Default **no** — excerpt is the one summary field (vocabulary rule); an owner who wants a
  sharper line sharpens the excerpt, which improves every surface at once.
- `page.get` shape for pinned sections (refs only vs joined) — joined, so the AI sees what the
  visitor sees.
