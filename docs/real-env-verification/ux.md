# UX findings (continuous)

Judged live while driving the real UI (headed) during verification. Separate from functional Findings (`findings.md`) — this is about UI/UX quality: clarity, friction, feedback, affordances, aesthetics, error copy, responsiveness.

Severity: 🔴 broken/blocking · 🟠 friction/confusing · 🟡 polish · 💡 idea

| ID | Surface | Observation | Sev |
|----|---------|-------------|-----|
| UX-1 | all pages | `GET /favicon.ico` → 404; no favicon → broken/blank tab icon, looks unfinished. | 🟡 |
| UX-2 | login → admin | After sign-in the owner lands on `/admin/page` (Public Face editor), not a dashboard/overview. Odd default for a returning owner. | 🟠 |
| UX-3 | /login | "WHAT YOU GET" marketing column (01–04) shown on the **owner's own** login — they already deployed the instance; the pitch is redundant here. | 🟡 |
| UX-4 | admin shell | `ZodError` + a broken "requests" sidebar badge on every admin load (see F-C-1) — visible console noise + a nav badge that never renders a count. | 🟠 |
| UX-8 | /gate (BYOAI form) | Browser autofill drops the owner's saved **email into the "model" field and password into the "api key" field** (fields lack `autocomplete=off`/`new-password`) — a visitor's own saved creds would autofill the same way; risk of submitting a password as a key. | 🟠 |
| UX-9 | visitor chat | Two competing inputs: a "search the corpus…" box at the top and the "ask…" chat dock at the bottom. Which do I use? The search box (see F-A-2) shouldn't be there at all; even setting that aside, two inputs on one surface with different mental models is confusing. | 🟠 |
| UX-7 | /wiki (public reader tree) | The "WIKI TREE" sidebar advertises "33 entries · 24 roots · 32 gated" but **renders a single flat item** (orbit). Counts describe the whole corpus (incl. gated/unpublished) while the tree only draws published nodes → header promises a rich tree, body shows one orphan. Also mislabels a flat 1-item list as a "tree". Compounded by the data damage below (24 roots = shattered tree from F-L-2). | 🟠 |
| UX-6 | /admin/wiki (corpus views) | Corpus is inherently a **tree** (folder-notes, `Parent: [[..]]` parent-child, nested `wiki/math/`, `wiki/cybernetics/theory/`) but the admin renders it as a **flat card grid + tag chips**. On the real 190-note nested vault: hierarchy is invisible, no tree nav / collapse-expand, 190 flat cards is unwieldy, and card previews spill raw structure lines (`# X > Parent: [[corpus]]`). Loses the whole navigable structure Obsidian has. (Roadmap 1b graph likely addresses, but today it's flat + ugly at real scale.) | 🟠 |
| UX-5 | /admin/obsidian | Whole section reads as operational — a vault path, mode/notes/size/last-sync stats, "import/export" action buttons, a "recent events" log — but it's an **inert mockup** (buttons dead, stats fake). Owner will click "import vault zip", nothing happens, no feedback. The real import is unlabelled-as-such in the *writings* section. Deeply misleading. | 🔴 |
| — | /login | Positive: clean, on-brand (Newsreader serif + mono labels + vermillion), password show/hide, "recover with a phrase" affordance present. | ✅ |

## Detail
<!-- ### UX-1 · <surface> — <one-liner>  (screenshot: <file>)
- what I saw / expected:
- why it matters:
-->
