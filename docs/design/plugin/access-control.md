# Access control

Status: **2026-09-09.** What a visitor's code is allowed to do, and where that answer lives.
Assumes `block-model.md`'s vocabulary.

## Additive, over a bundle referenced by id

Today is subtractive — one global registry, three layers removing (`global ∧ role ∧ ¬code-deny`) —
so answering "what can this code do" means simulating an intersection. Additive: the owner assembles
a bundle, the ACL hangs on the bundle, a code is bound to one, and the answer is a list.

The objection that stalled this was revocation, and **binding by reference dissolves it**:

```
bundle "recruiter" = [corpus_read, calendar_book]     ← ACL lives here
ABC-123 → "recruiter"       (reference, not copy)
DEF-456 → "recruiter"
owner removes calendar_book → both codes lose it at once
```

dsh has exactly these semantics: a session's creation header freezes **which** bundle it started
under — the name, not the contents. Resume rebuilds the same bundle; the contents stay live.

Consequences: the ACL surface shrinks from "every capability × every code" to a handful of bundles,
which is also how an owner thinks. And absence becomes explicable again — *the bundle this code is
bound to does not contain it* — which is what a bare additive model would have lost.

## Bundles nest, and nesting yields a bundle

"Can a bundle reference a bundle" was a malformed question: the result is a bundle with its own id
and the code binds to that. Inclusion is by reference for the same reason binding is, and conflicts
resolve dsh's way — layers in listed order, a patch addresses a row by `id` and replaces that row's
whole config, last write wins per row.

## The owner assembles bundles in a UI

Not a new kind of interface for us: the résumé composer is already visual block assembly
(`PuckComposer.tsx` / `PuckResumeEditor.tsx`), and its traps carry over — every item needs a unique
`props.id` or the page collapses into one section and white-screens.

## Storage and sessions

- **A bundle is a new table.** It is a persistent object of its own — which blocks, each one's
  config, the ACL, and the codes that reference it — and nothing existing holds it.
  `microsite_builds.source_files` stores a *microsite's* composition and answers a different
  question; an earlier draft mistook one for the other.
- **A bundle is owner-scoped like everything else.** `owner_id` is already on every table and route;
  the owner *is* the tenant, so there is no new ACL surface here. Validation happens **at write**,
  against each block's `Config` schema (`block-model.md`) — a bad entry is refused rather than
  discovered when someone clicks.
- **Migrating today's rows is a one-off.** `owner_connectors` holds live connected accounts and
  encrypted credentials on the running instance; they move into the credentials block's storage
  once, with a migration. Not a design question.
- **A session freezes which bundle it opened under**, so resume and fork reproduce the same surface
  while the owner's edits still propagate. Whether a live session sees a mid-conversation change
  follows dsh's rule: an application that already owns work applies its layers once at start. A
  visitor's conversation is that kind of application; the owner's editor is the live kind.

## The cost, stated plainly

This changes a **product rule**, not just an implementation. The ACL specs (`acl-block-matrix`,
`acl-skill-matrix`, and their siblings) assert the subtractive model. They change — correctly,
because the definition of "what a code can do" changed. That is the one part of the test suite that
should break, and it must break deliberately, not as collateral.
